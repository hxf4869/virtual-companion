import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useParams,
} from '@tanstack/react-router';
import { applyDocumentValues } from '../../../extension/vc-model-settings/settings-documents.js';
import { AppProviders, createQueryClient, queryClient } from '../../src/app/providers';
import { TavernRouteAdapter } from '../../src/app/TavernRouteAdapter';
import { createAppClient } from '../../src/data/client';
import * as tavernQueries from '../../src/data/queries/tavern';
import { queryKeys } from '../../src/data/queryKeys';
import { SessionBridgeProvider, type SessionBridge } from '../../src/runtime/session-bridge';
import { TavernRoute, type TavernRouteProps } from '../../src/features/tavern/TavernRoute';
import { useTavernController } from '../../src/features/tavern/useTavernController';
import { ST_CHAT_STORAGE_SESSION_URL, stChatStorageSession, stSessionIdentity } from '../st-session-fixture';

function setIdentityMeta() {
  const { accountId, sessionId } = stSessionIdentity;
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
      if (url === ST_CHAT_STORAGE_SESSION_URL) return jsonResponse(stChatStorageSession);
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
      if (url === ST_CHAT_STORAGE_SESSION_URL) return jsonResponse(stChatStorageSession);
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
      if (url === ST_CHAT_STORAGE_SESSION_URL) return jsonResponse(stChatStorageSession);
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
      if (url === ST_CHAT_STORAGE_SESSION_URL) return jsonResponse(stChatStorageSession);
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
      if (url === ST_CHAT_STORAGE_SESSION_URL) return jsonResponse(stChatStorageSession);
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

  it('MB2-4: data/queries/tavern is pure data and useTavernController exposes dialog states, checkValidity, onDownload, and onNotify without modals or formRef', async () => {
    expect('useTavernController' in tavernQueries).toBe(false);
    expect(typeof tavernQueries.createTavernReads).toBe('function');

    const downloads: Array<{ value: unknown; name: string }> = [];
    const notifications: string[] = [];
    let allowValid = false;

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/csrf-token') return jsonResponse({ token: 'csrf-1' });
      if (url === ST_CHAT_STORAGE_SESSION_URL) return jsonResponse(stChatStorageSession);
      if (url === '/api/settings/get') {
        return jsonResponse({
          settings: JSON.stringify({
            oai_settings: {
              preset_settings_openai: 'Default',
              temp_openai: 1,
              top_p_openai: 1,
              openai_max_context: 4096,
              openai_max_tokens: 300,
              seed: -1,
              n: 1,
              prompts: [],
              prompt_order: [{ character_id: 100001, order: [] }],
            },
            power_user: {},
            world_info_settings: { world_info: { globalSelect: [], charLore: [] } },
            extension_settings: {},
          }),
          openai_setting_names: ['Default'],
          openai_settings: [JSON.stringify({ temp_openai: 1 })],
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
      if (url === '/api/characters/export') {
        return new Response(JSON.stringify({ exported: 'Seraphina' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url === '/api/characters/merge-attributes') {
        return jsonResponse({ ok: true });
      }
      return jsonResponse({});
    }) as typeof fetch;

    let latestCtrl: ReturnType<typeof useTavernController> | null = null;
    function HookProbe() {
      const ctrl = useTavernController('right-nav-panel', {
        checkValidity: () => allowValid,
        onDownload: (value, name) => downloads.push({ value, name }),
        onNotify: (msg) => notifications.push(msg),
      });
      latestCtrl = ctrl;
      return <div data-testid="probe">{ctrl.loading ? 'loading' : ctrl.state.selectedCharacter}</div>;
    }

    const client = createAppClient();
    await client.initialize();
    const bridge = createFakeBridge();

    render(
      <AppProviders client={client}>
        <SessionBridgeProvider bridge={bridge}>
          <HookProbe />
        </SessionBridgeProvider>
      </AppProviders>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('probe').textContent).toBe('Seraphina.png');
    });

    expect(latestCtrl).not.toBeNull();
    expect('modals' in (latestCtrl as unknown as Record<string, unknown>)).toBe(false);
    expect('formRef' in (latestCtrl as unknown as Record<string, unknown>)).toBe(false);
    expect(latestCtrl!.askNameDialog.open).toBe(false);
    expect(latestCtrl!.confirmDialog.open).toBe(false);
    expect(latestCtrl!.charDeleteDialog.open).toBe(false);
    expect(latestCtrl!.codeEditorDialog.open).toBe(false);

    // Edit description and attempt save while checkValidity returns false
    latestCtrl!.onField(
      latestCtrl!.state.groups[0].fields.find((f) => f.label === '描述')!.key,
      'Changed description',
    );
    const blockedSave = await latestCtrl!.save();
    expect(blockedSave).toBe(false);
    await waitFor(() => {
      expect(latestCtrl!.error).toBe('请先修正标出的输入。');
    });

    // Enable validity and save -> triggers onNotify('已保存')
    allowValid = true;
    const okSave = await latestCtrl!.save();
    expect(okSave).toBe(true);
    expect(notifications).toEqual(['已保存']);

    // Export character -> triggers onDownload callback with Blob and filename
    latestCtrl!.onAction('character-export');
    await waitFor(() => {
      expect(downloads).toHaveLength(1);
    });
    expect(downloads[0].name).toBe('Seraphina.json');
    expect(downloads[0].value).toBeInstanceOf(Blob);
  });

  it('MB2-4: TavernRoute delegates category/section navigation and leave guard via props without mutating window.location.hash', async () => {
    window.location.hash = '#/settings/tavern/left-nav-panel';
    const onNavigateCategory = vi.fn();
    const onNavigateTavern = vi.fn();
    const dirtyRecords: boolean[] = [];

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/csrf-token') return jsonResponse({ token: 'csrf-1' });
      if (url === ST_CHAT_STORAGE_SESSION_URL) return jsonResponse(stChatStorageSession);
      if (url === '/api/settings/get') {
        return jsonResponse({
          settings: JSON.stringify({
            oai_settings: {
              preset_settings_openai: 'Default',
              temp_openai: 1,
              top_p_openai: 1,
              openai_max_context: 4096,
              openai_max_tokens: 300,
              seed: -1,
              n: 1,
              prompts: [],
              prompt_order: [{ character_id: 100001, order: [] }],
            },
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
      if (url.endsWith('/model-purposes')) return jsonResponse({ items: [] });
      if (url.endsWith('/providers')) return jsonResponse({ items: [] });
      return jsonResponse({});
    }) as typeof fetch;

    const client = createAppClient();
    await client.initialize();
    const bridge = createFakeBridge();

    render(
      <AppProviders client={client}>
        <SessionBridgeProvider bridge={bridge}>
          <TavernRoute
            section="left-nav-panel"
            onNavigateCategory={onNavigateCategory}
            onNavigateTavern={onNavigateTavern}
            onDirtyChange={(d) => dirtyRecords.push(d)}
            renderLeaveGuard={(dirty) => (
              <div data-testid="custom-leave-guard">{dirty ? 'dirty' : 'clean'}</div>
            )}
          />
        </SessionBridgeProvider>
      </AppProviders>,
    );

    const seedInput = (await screen.findByLabelText('随机种子')) as HTMLInputElement;
    expect(screen.getByTestId('custom-leave-guard').textContent).toBe('clean');

    fireEvent.change(seedInput, { target: { value: '42' } });
    expect(screen.getByTestId('custom-leave-guard').textContent).toBe('dirty');
    expect(dirtyRecords.at(-1)).toBe(true);

    // Clicking another tavern section while dirty opens discard confirmation before navigating
    fireEvent.click(screen.getByRole('button', { name: 'API 连接' }));
    const discardDialog = await screen.findByRole('alertdialog');
    fireEvent.click(
      Array.from(discardDialog.querySelectorAll('button')).find((b) => b.textContent === '放弃')!,
    );

    await waitFor(() => {
      expect(onNavigateTavern).toHaveBeenCalledWith('rm_api_block');
    });
    expect(window.location.hash).toBe('#/settings/tavern/left-nav-panel');

    // Clicking '模型设置' triggers onNavigateCategory('model') without mutating window.location.hash
    const openModelBtn = await screen.findByRole('button', { name: '模型设置' });
    fireEvent.click(openModelBtn);
    await waitFor(() => {
      expect(onNavigateCategory).toHaveBeenCalledWith('model');
    });
    expect(window.location.hash).toBe('#/settings/tavern/left-nav-panel');
  });

  it('MB2-4: TavernRouteAdapter wires router search/navigation, useLeaveGuard, and View override', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/csrf-token') return jsonResponse({ token: 'csrf-1' });
      if (url === ST_CHAT_STORAGE_SESSION_URL) return jsonResponse(stChatStorageSession);
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
          { avatar: 'Alice.png', name: 'Alice' },
          { avatar: 'Seraphina.png', name: 'Seraphina' },
        ]);
      }
      if (url === '/api/characters/get') {
        return jsonResponse({
          avatar: 'Seraphina.png',
          name: 'Seraphina',
          description: 'Seraphina desc',
          data: {
            name: 'Seraphina',
            description: 'Seraphina desc',
            extensions: {
              depth_prompt: { prompt: '', depth: 4, role: 'system' },
              talkativeness: 0.5,
              fav: false,
            },
          },
        });
      }
      return jsonResponse({});
    }) as typeof fetch;

    const capturedProps: TavernRouteProps[] = [];
    function SpyTavernView(props: TavernRouteProps) {
      capturedProps.push(props);
      return <TavernRoute {...props} />;
    }

    const rootRoute = createRootRoute({
      component: () => <Outlet />,
    });
    const settingsCategoryRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/settings/$category',
      component: function CategoryPage() {
        const { category } = useParams({ from: settingsCategoryRoute.id });
        return <div data-testid="category-page">{category}</div>;
      },
    });
    const settingsTavernRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/settings/tavern/$section',
      component: function TavernPage() {
        const { section } = useParams({ from: settingsTavernRoute.id });
        return <TavernRouteAdapter section={section} View={SpyTavernView} />;
      },
    });
    const routeTree = rootRoute.addChildren([settingsCategoryRoute, settingsTavernRoute]);
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({
        initialEntries: ['/settings/tavern/right-nav-panel?character=Seraphina.png'],
      }),
    });

    const client = createAppClient();
    await client.initialize();
    const bridge = createFakeBridge();

    render(
      <AppProviders client={client}>
        <SessionBridgeProvider bridge={bridge}>
          <RouterProvider router={router} />
        </SessionBridgeProvider>
      </AppProviders>,
    );

    const descInput = (await screen.findByLabelText('描述')) as HTMLTextAreaElement;
    expect(descInput.value).toBe('Seraphina desc');
    expect(capturedProps.at(-1)?.initialCharacter).toBe('Seraphina.png');

    // Make form dirty and attempt router navigation -> blocked by useLeaveGuard
    fireEvent.change(descInput, { target: { value: 'Dirty desc' } });

    void router.navigate({ to: '/settings/$category', params: { category: 'account' } });
    const leaveDialog = await screen.findByRole('alertdialog');
    expect(leaveDialog.textContent).toContain('放弃更改？');

    // Confirm leave -> navigates to /settings/account
    fireEvent.click(
      Array.from(leaveDialog.querySelectorAll('button')).find((b) => b.textContent === '放弃')!,
    );

    await waitFor(() => {
      expect(screen.getByTestId('category-page').textContent).toBe('account');
    });
  });

  it('MB2-4: preserves fast section switch late-load guard, form aria-invalid checkValidity, and character delete two-step dialog', async () => {
    let resolveLateWorldbook: ((res: Response) => void) | null = null;
    const worldbookGate = new Promise<Response>((resolve) => {
      resolveLateWorldbook = resolve;
    });

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/csrf-token') return jsonResponse({ token: 'csrf-1' });
      if (url === ST_CHAT_STORAGE_SESSION_URL) return jsonResponse(stChatStorageSession);
      if (url === '/api/settings/get') {
        return jsonResponse({
          settings: JSON.stringify({
            oai_settings: {
              preset_settings_openai: 'Default',
              temp_openai: 1,
              top_p_openai: 1,
              openai_max_context: 4096,
              openai_max_tokens: 300,
              seed: -1,
              n: 1,
              prompts: [],
              prompt_order: [{ character_id: 100001, order: [] }],
            },
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
      if (url === '/api/worldinfo/list') {
        return jsonResponse([{ file_id: 'DelayedBook' }]);
      }
      if (url === '/api/worldinfo/get') {
        return worldbookGate;
      }
      if (url === '/api/characters/all') {
        return jsonResponse([
          { avatar: 'Seraphina.png', name: 'Seraphina' },
          { avatar: 'Alice.png', name: 'Alice' },
        ]);
      }
      if (url === '/api/characters/get') {
        return jsonResponse({
          avatar: 'Seraphina.png',
          name: 'Seraphina',
          description: 'Seraphina desc',
          data: {
            name: 'Seraphina',
            description: 'Seraphina desc',
            extensions: {
              depth_prompt: { prompt: '', depth: 4, role: 'system' },
              talkativeness: 0.5,
              fav: false,
            },
          },
        });
      }
      return jsonResponse({});
    }) as typeof fetch;

    const client = createAppClient();
    await client.initialize();
    const bridge = createFakeBridge();

    const { rerender } = render(
      <AppProviders client={client}>
        <SessionBridgeProvider bridge={bridge}>
          <TavernRoute section="WorldInfo" />
        </SessionBridgeProvider>
      </AppProviders>,
    );

    // Rapidly switch section to right-nav-panel before WorldInfo finishes loading DelayedBook
    rerender(
      <AppProviders client={client}>
        <SessionBridgeProvider bridge={bridge}>
          <TavernRoute section="right-nav-panel" />
        </SessionBridgeProvider>
      </AppProviders>,
    );

    const descInput = (await screen.findByLabelText('描述')) as HTMLTextAreaElement;
    expect(descInput.value).toBe('Seraphina desc');

    // Resolve the late WorldInfo response after switching -> must not overwrite CharacterCard section
    resolveLateWorldbook!(
      jsonResponse({
        entries: {
          '0': { uid: 0, comment: 'Late Entry', content: 'late', key: ['k'] },
        },
      }),
    );

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('角色卡');
    expect((screen.getByLabelText('描述') as HTMLTextAreaElement).value).toBe('Seraphina desc');

    // Form DOM aria-invalid="true" blocks save via TavernFormContainer setCheckValidity
    fireEvent.change(descInput, { target: { value: 'Edited desc' } });
    descInput.setAttribute('aria-invalid', 'true');
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    const invalidBanner = await screen.findByRole('alert');
    expect(invalidBanner.textContent).toContain('请先修正标出的输入。');
    descInput.removeAttribute('aria-invalid');

    // Character deletion two-step modal flow via TavernDialogs
    fireEvent.click(screen.getByRole('button', { name: '删除角色卡' }));
    const deleteChatsBtn = await screen.findByRole('button', { name: '同时删除聊天' });
    fireEvent.click(deleteChatsBtn);

    const confirmAlert = await screen.findByRole('alertdialog');
    expect(confirmAlert.textContent).toContain('同时删除聊天？');
    fireEvent.click(
      Array.from(confirmAlert.querySelectorAll('button')).find((b) => b.textContent === '删除')!,
    );

    await waitFor(() => {
      expect(bridge.deleteCharacter).toHaveBeenCalledWith('Seraphina.png', true);
    });
  });
});
