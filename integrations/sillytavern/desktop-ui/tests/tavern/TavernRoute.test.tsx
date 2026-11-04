import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { applyDocumentValues } from '../../../extension/vc-model-settings/settings-documents.js';
import { AppProviders, createQueryClient, queryClient } from '../../src/app/providers';
import { createAppClient } from '../../src/data/client';
import { queryKeys } from '../../src/data/queryKeys';
import { SessionBridgeProvider, type SessionBridge } from '../../src/runtime/session-bridge';
import { TavernRoute } from '../../src/features/tavern/TavernRoute';

function setIdentityMeta(accountId = '9007199254740993', sessionId = '17') {
  document.head.innerHTML = `
    <meta name="vc-account-id" content="${accountId}">
    <meta name="vc-session-id" content="${sessionId}">
  `;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createFakeBridge(): SessionBridge {
  const ctx = {
    characters: [],
    chat: [],
    chatMetadata: {},
    characterId: undefined,
    chatId: '',
    canEditChatMetadata: false,
  };
  const snap = {
    key: '',
    status: 'empty' as const,
    messages: [],
    canSend: false,
    busy: false,
    streamingKey: null,
    notice: '',
    error: '',
    conflict: false,
    conflictSnapshot: null,
    popupRequest: null,
    personaChoice: null,
  };
  return {
    subscribe: () => () => {},
    getSnapshot: () => snap,
    getContext: () => ctx,
    applySettings: vi.fn(async () => {}),
    applyPreset: vi.fn(async () => {}),
    applyWorldbook: vi.fn(async () => {}),
    reloadCharacter: vi.fn(async () => {}),
    commitMetadata: vi.fn(async () => {}),
    deleteCharacter: vi.fn(async () => {}),
  } as unknown as SessionBridge;
}

describe('TavernRoute (409 conflict recovery & unknown keys preservation)', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    setIdentityMeta();
    queryClient.clear();
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    globalThis.fetch = originalFetch;
    document.head.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('409 conflict keeps form values and offers reload', async () => {
    let serverN = 1;
    let conflictNextSave = true;

    const makeSettings = (nVal: number) => ({
      oai_settings: {
        preset_settings_openai: 'Default',
        temp_openai: 1,
        top_p_openai: 1,
        openai_max_context: 4096,
        openai_max_tokens: 300,
        seed: -1,
        n: nVal,
        prompts: [],
        prompt_order: [{ character_id: 100001, order: [] }],
      },
      power_user: {},
      world_info_settings: { world_info: { globalSelect: [], charLore: [] } },
      extension_settings: {},
      background: { name: '__transparent.png', url: 'url("backgrounds/__transparent.png")', fitting: 'classic', animation: false },
    });

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/csrf-token') return jsonResponse({ token: 'csrf-1' });
      if (url === '/api/settings/get') {
        return jsonResponse({
          settings: JSON.stringify(makeSettings(serverN)),
          openai_setting_names: ['Default'],
          openai_settings: [JSON.stringify({})],
          context: [],
          instruct: [],
          sysprompt: [],
          reasoning: [],
        });
      }
      if (url.endsWith('/model-purposes')) return jsonResponse({ items: [] });
      if (url.endsWith('/providers')) return jsonResponse({ items: [] });
      if (url === '/api/settings/save') {
        if (conflictNextSave) {
          serverN = 3;
          return jsonResponse({ code: 'VC_SETTINGS_CONFLICT', message: 'Conflict' }, 409);
        }
        return jsonResponse({ ok: true });
      }
      return jsonResponse({});
    }) as typeof fetch;

    const client = createAppClient();
    await client.initialize();
    const bridge = createFakeBridge();

    render(
      <AppProviders client={client}>
        <SessionBridgeProvider bridge={bridge}>
          <TavernRoute section="left-nav-panel" />
        </SessionBridgeProvider>
      </AppProviders>,
    );

    const nInput = (await screen.findByLabelText('候选回复数')) as HTMLInputElement;
    expect(nInput.value).toBe('1');

    fireEvent.change(nInput, { target: { value: '2' } });
    expect(nInput.value).toBe('2');

    const saveButton = screen.getByRole('button', { name: '保存' });
    fireEvent.click(saveButton);

    const alertBanner = await screen.findByRole('alert');
    expect(alertBanner.textContent).toContain('设置已在另一处更新。当前输入仍保留；加载最新会放弃本次更改。');
    // Draft value '2' must be preserved on 409
    expect(nInput.value).toBe('2');

    // Click '加载最新' and confirm discard in alertdialog -> reloads server value '3'
    const reloadButton = screen.getByRole('button', { name: '加载最新' });
    fireEvent.click(reloadButton);

    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(
      Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === '放弃')!,
    );

    await waitFor(() => {
      expect((screen.getByLabelText('候选回复数') as HTMLInputElement).value).toBe('3');
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('unknown keys preserved on save', async () => {
    const savedBodies: Array<Record<string, unknown>> = [];

    const rawServerSettings = {
      unknown_top_flag: 'preserve-top',
      oai_settings: {
        preset_settings_openai: 'Default',
        temp_openai: 1,
        top_p_openai: 1,
        openai_max_context: 4096,
        openai_max_tokens: 300,
        seed: -1,
        n: 1,
        unknown_vendor_param: { nested: 42, flag: true },
        prompts: [],
        prompt_order: [{ character_id: 100001, order: [] }],
      },
      power_user: {
        custom_theme_blob: ['a', 'b', 'c'],
      },
      world_info_settings: { world_info: { globalSelect: [], charLore: [] } },
      extension_settings: {
        third_party_unknown_ext: { enabled: true, tokens: [10, 20] },
      },
      background: { name: '__transparent.png', url: 'url("backgrounds/__transparent.png")', fitting: 'classic', animation: false },
    };

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/csrf-token') return jsonResponse({ token: 'csrf-1' });
      if (url === '/api/settings/get') {
        return jsonResponse({
          settings: JSON.stringify(rawServerSettings),
          openai_setting_names: ['Default'],
          openai_settings: [JSON.stringify({})],
          context: [],
          instruct: [],
          sysprompt: [],
          reasoning: [],
        });
      }
      if (url.endsWith('/model-purposes')) return jsonResponse({ items: [] });
      if (url.endsWith('/providers')) return jsonResponse({ items: [] });
      if (url === '/api/settings/save') {
        savedBodies.push(JSON.parse(String(init?.body || '{}')));
        return jsonResponse({ ok: true });
      }
      return jsonResponse({});
    }) as typeof fetch;

    const client = createAppClient();
    await client.initialize();
    const bridge = createFakeBridge();

    render(
      <AppProviders client={client}>
        <SessionBridgeProvider bridge={bridge}>
          <TavernRoute section="left-nav-panel" />
        </SessionBridgeProvider>
      </AppProviders>,
    );

    const seedInput = (await screen.findByLabelText('随机种子')) as HTMLInputElement;
    expect(seedInput.value).toBe('-1');

    fireEvent.change(seedInput, { target: { value: '12345' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(savedBodies).toHaveLength(1);
    });

    const vcChanges = savedBodies[0].vc_changes as Array<{
      path: string[];
      before: { exists: boolean; value?: unknown };
      after: { exists: boolean; value?: unknown };
    }>;

    // Only the edited field path is included in vc_changes
    expect(vcChanges).toEqual([
      {
        path: ['oai_settings', 'seed'],
        before: { exists: true, value: -1 },
        after: { exists: true, value: 12345 },
      },
    ]);

    // Applying vc_changes to rawServerSettings preserves all unknown keys byte-for-value
    const merged = applyDocumentValues(structuredClone(rawServerSettings), vcChanges) as typeof rawServerSettings;
    expect(merged.unknown_top_flag).toBe('preserve-top');
    expect(merged.oai_settings.unknown_vendor_param).toEqual({ nested: 42, flag: true });
    expect(merged.power_user.custom_theme_blob).toEqual(['a', 'b', 'c']);
    expect(merged.extension_settings.third_party_unknown_ext).toEqual({ enabled: true, tokens: [10, 20] });
    expect(merged.oai_settings.seed).toBe(12345);
  });

  it('character card save calls reloadCharacter and commitMetadata passes captured expectedKey', async () => {
    let activeKey = '["Seraphina.png","chat-1"]';
    const ctx = {
      characters: [{ avatar: 'Seraphina.png', name: 'Seraphina', data: { name: 'Seraphina', extensions: {} } }],
      chat: [{ mes: 'hello' }],
      chatMetadata: { note_prompt: 'Initial note', note_interval: 1, note_depth: 4, note_position: 1, note_role: 0 },
      characterId: 0,
      chatId: 'chat-1',
      canEditChatMetadata: true,
    };
    const bridge = {
      ...createFakeBridge(),
      getSnapshot: () => ({
        key: activeKey,
        status: 'ready' as const,
        messages: [],
        canSend: true,
        busy: false,
        streamingKey: null,
        notice: '',
        error: '',
        conflict: false,
        conflictSnapshot: null,
        popupRequest: null,
        personaChoice: null,
      }),
      getContext: () => ctx,
      reloadCharacter: vi.fn(async () => {}),
      commitMetadata: vi.fn(async () => {}),
    } as unknown as SessionBridge;

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/csrf-token') return jsonResponse({ token: 'csrf-1' });
      if (url === '/api/settings/get') {
        return jsonResponse({
          settings: JSON.stringify({
            oai_settings: { preset_settings_openai: 'Default', prompts: [], prompt_order: [] },
            power_user: {},
            world_info_settings: { world_info: { globalSelect: [], charLore: [] } },
            extension_settings: {},
          }),
          openai_setting_names: ['Default'],
          openai_settings: [JSON.stringify({})],
          context: [],
          instruct: [],
          sysprompt: [],
          reasoning: [],
        });
      }
      if (url === '/api/characters/all') {
        return jsonResponse([
          {
            avatar: 'Seraphina.png',
            name: 'Seraphina',
          },
        ]);
      }
      if (url === '/api/characters/get') {
        return jsonResponse({
          avatar: 'Seraphina.png',
          name: 'Seraphina',
          description: 'Initial desc',
          data: {
            name: 'Seraphina',
            description: 'Initial desc',
            extensions: {
              depth_prompt: { prompt: '', depth: 4, role: 'system' },
              talkativeness: 0.5,
              fav: false,
            },
          },
        });
      }
      if (url === '/api/characters/merge-attributes') {
        return jsonResponse({ ok: true });
      }
      if (url.endsWith('/model-purposes')) return jsonResponse({ items: [] });
      if (url.endsWith('/providers')) return jsonResponse({ items: [] });
      return jsonResponse({});
    }) as typeof fetch;

    const client = createAppClient();
    await client.initialize();

    render(
      <AppProviders client={client}>
        <SessionBridgeProvider bridge={bridge}>
          <TavernRoute section="right-nav-panel" />
        </SessionBridgeProvider>
      </AppProviders>,
    );

    const descInput = (await screen.findByLabelText('描述')) as HTMLTextAreaElement;
    fireEvent.change(descInput, { target: { value: 'Updated desc' } });

    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(bridge.reloadCharacter).toHaveBeenCalledWith('Seraphina.png');
    });

    // Switch to Extensions (rm_extensions_block) where chat metadata author note lives
    fireEvent.click(screen.getByRole('button', { name: '扩展' }));

    const noteIntervalInput = (await screen.findByLabelText('插入间隔')) as HTMLInputElement;
    fireEvent.change(noteIntervalInput, { target: { value: '2' } });

    // Simulate active conversation key changing before save is clicked:
    // commitMetadata must still pass the captured expectedKey from when metadata was edited!
    activeKey = '["Other.png","chat-2"]';

    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(bridge.commitMetadata).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            path: ['note_interval'],
            after: { exists: true, value: 2 },
          }),
        ]),
        '["Seraphina.png","chat-1"]',
      );
    });
  });

  it('retries transient first settings read failure via QueryClient retry:1, populates settingsDoc/purposes/providers keys, and reloads fresh packet after save instead of memoized initialSettings', async () => {
    let settingsGetCount = 0;
    let serverSeed = 100;

    const makePacket = (seedVal: number) => ({
      settings: JSON.stringify({
        oai_settings: {
          preset_settings_openai: 'Default',
          temp_openai: 1,
          top_p_openai: 1,
          openai_max_context: 4096,
          openai_max_tokens: 300,
          seed: seedVal,
          n: 1,
          prompts: [],
          prompt_order: [{ character_id: 100001, order: [] }],
        },
        power_user: {},
        world_info_settings: { world_info: { globalSelect: [], charLore: [] } },
        extension_settings: {},
        background: {
          name: '__transparent.png',
          url: 'url("backgrounds/__transparent.png")',
          fitting: 'classic',
          animation: false,
        },
      }),
      openai_setting_names: ['Default'],
      openai_settings: [JSON.stringify({})],
      context: [],
      instruct: [],
      sysprompt: [],
      reasoning: [],
    });

    const rawPurposes = {
      items: [
        {
          purpose: 'conversation_Execution',
          providerId: 'prov-1',
          modelId: 'gpt-4.1',
          contextWindowTokens: 32000,
          maxOutputTokens: 4096,
        },
      ],
    };
    const rawProviders = {
      items: [
        {
          id: 'prov-1',
          label: 'OpenAI Prod',
          protocol: 'openai_chat_completions',
          enabled: true,
        },
      ],
    };

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/csrf-token') return jsonResponse({ token: 'csrf-1' });
      if (url === '/api/settings/get') {
        settingsGetCount += 1;
        // 1st call is client.settings() warm-up (seed=100);
        // 2nd call is TavernRoute's 1st query attempt -> transient 503 failure;
        // 3rd call is QueryClient retry:1 -> succeeds with seed=200!
        if (settingsGetCount === 2) {
          return jsonResponse({ message: 'Temporary error' }, 503);
        }
        return jsonResponse(makePacket( serverSeed ));
      }
      if (url.endsWith('/model-purposes')) return jsonResponse(rawPurposes);
      if (url.endsWith('/providers')) return jsonResponse(rawProviders);
      if (url === '/api/settings/save') {
        // Server advances seed to 999 after save
        serverSeed = 999;
        return jsonResponse({ ok: true });
      }
      return jsonResponse({});
    }) as typeof fetch;

    const client = createAppClient();
    await client.initialize();
    // Warm up client.settings() so initialSettings is permanently memoized with seed=100
    const memoizedInitial = await client.settings();
    expect(JSON.parse((memoizedInitial as { settings: string }).settings).oai_settings.seed).toBe(
      100,
    );

    // Server now has seed=200 before TavernRoute mounts
    serverSeed = 200;

    const qc = createQueryClient();
    const bridge = createFakeBridge();

    render(
      <AppProviders client={client} queryClient={qc}>
        <SessionBridgeProvider bridge={bridge}>
          <TavernRoute section="left-nav-panel" />
        </SessionBridgeProvider>
      </AppProviders>,
    );

    // Must recover from the transient 503 via QueryClient retry:1 and load seed=200 (not 100)
    const seedInput = (await screen.findByLabelText(
      '随机种子',
      {},
      { timeout: 3000 },
    )) as HTMLInputElement;
    expect(seedInput.value).toBe('200');
    expect(screen.queryByRole('alert')).toBeNull();

    // Real QueryClient holds settingsDoc, purposes, and providers
    expect(qc.getQueryData(queryKeys.settingsDoc)).toEqual(makePacket(200));
    expect(qc.getQueryData(queryKeys.purposes)).toEqual(rawPurposes);
    expect(qc.getQueryData(queryKeys.providers)).toEqual(rawProviders);

    // Edit seed to 300 and save -> invalidates settingsDoc
    fireEvent.change(seedInput, { target: { value: '300' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(bridge.applySettings).toHaveBeenCalledTimes(1);
    });
    expect(qc.getQueryState(queryKeys.settingsDoc)?.isInvalidated).toBe(true);

    // Switch section to API连接 and back to AI 回复配置 -> reads fresh packet (seed=999) from /api/settings/get, not memoized initialSettings (100)
    fireEvent.click(screen.getByRole('button', { name: 'API 连接' }));
    await screen.findByRole('heading', { name: 'API 连接', level: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'AI 回复配置' }));

    const refreshedSeedInput = (await screen.findByLabelText('随机种子')) as HTMLInputElement;
    await waitFor(() => {
      expect(refreshedSeedInput.value).toBe('999');
    });
    expect(qc.getQueryData(queryKeys.settingsDoc)).toEqual(makePacket(999));
  });

  it('character CAS preflight fetches fresh detail bypassing 30s QueryClient cache to detect concurrent edits', async () => {
    let serverDescription = 'Initial desc';
    const mergeCalls: unknown[] = [];

    const makeCharResponse = (desc: string) => ({
      avatar: 'Seraphina.png',
      name: 'Seraphina',
      description: desc,
      data: {
        name: 'Seraphina',
        description: desc,
        extensions: {
          depth_prompt: { prompt: '', depth: 4, role: 'system' },
          talkativeness: 0.5,
          fav: false,
        },
      },
    });

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/csrf-token') return jsonResponse({ token: 'csrf-1' });
      if (url === '/api/settings/get') {
        return jsonResponse({
          settings: JSON.stringify({
            oai_settings: { preset_settings_openai: 'Default', prompts: [], prompt_order: [] },
            power_user: {},
            world_info_settings: { world_info: { globalSelect: [], charLore: [] } },
            extension_settings: {},
          }),
          openai_setting_names: ['Default'],
          openai_settings: [JSON.stringify({})],
          context: [],
          instruct: [],
          sysprompt: [],
          reasoning: [],
        });
      }
      if (url === '/api/characters/all') {
        return jsonResponse([{ avatar: 'Seraphina.png', name: 'Seraphina' }]);
      }
      if (url === '/api/characters/get') {
        return jsonResponse(makeCharResponse(serverDescription));
      }
      if (url === '/api/characters/merge-attributes') {
        mergeCalls.push(JSON.parse(String(init?.body || '{}')));
        return jsonResponse({ ok: true });
      }
      return jsonResponse({});
    }) as typeof fetch;

    const client = createAppClient();
    await client.initialize();
    const qc = createQueryClient();
    const bridge = createFakeBridge();

    render(
      <AppProviders client={client} queryClient={qc}>
        <SessionBridgeProvider bridge={bridge}>
          <TavernRoute section="right-nav-panel" />
        </SessionBridgeProvider>
      </AppProviders>,
    );

    const descInput = (await screen.findByLabelText('描述')) as HTMLTextAreaElement;
    expect(descInput.value).toBe('Initial desc');
    expect(qc.getQueryData([...queryKeys.characters, 'Seraphina.png'])).toEqual(
      makeCharResponse('Initial desc'),
    );

    // Concurrent external modification occurs on server within the 30s staleTime window
    serverDescription = 'Concurrent external desc';

    // User edits description locally and clicks Save
    fireEvent.change(descInput, { target: { value: 'My local desc' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    // CAS preflight must fetch fresh from /api/characters/get (not 30s cached 'Initial desc') and raise 409 conflict
    const alertBanner = await screen.findByRole('alert');
    expect(alertBanner.textContent).toContain(
      '设置已在另一处更新。当前输入仍保留；加载最新会放弃本次更改。',
    );
    expect(descInput.value).toBe('My local desc');
    expect(mergeCalls).toHaveLength(0);
  });
});
