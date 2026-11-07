import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { AppProviders, queryClient } from '../../src/app/providers';
import { createAppClient } from '../../src/data/client';
import { SessionBridgeProvider, type SessionBridge } from '../../src/runtime/session-bridge';
import { ReplyConfig } from '../../src/features/tavern/ReplyConfig';
import { PromptOrder } from '../../src/features/tavern/PromptOrder';
import { TavernDialogs } from '../../src/features/tavern/CodeField';
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

function createFakeBridge(overrides: Partial<SessionBridge> = {}): SessionBridge {
  const ctx = {
    characters: [{ avatar: 'alice.png', name: 'Alice' }],
    chat: [],
    chatMetadata: {},
    characterId: 0,
    chatId: 'chat-1',
    canEditChatMetadata: true,
  };
  const snap = {
    key: '["alice.png","chat-1"]',
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
    ...overrides,
  } as unknown as SessionBridge;
}

function ReplyConfigTestHarness() {
  const controller = useTavernController('left-nav-panel');
  return (
    <div>
      <header className="vc-settings-header">
        <button
          type="button"
          hidden={!controller.dirty}
          disabled={controller.busy}
          onClick={() => controller.discard()}
        >
          放弃修改
        </button>
        <button
          type="button"
          data-tavern-save=""
          disabled={controller.loading || controller.busy || !controller.dirty}
          onClick={() => controller.save()}
        >
          保存
        </button>
      </header>
      <ReplyConfig controller={controller} />
      <TavernDialogs controller={controller} />
    </div>
  );
}

describe('ReplyConfig (B8 preset save-as / import active preset & orphan cleanup)', () => {
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

  it('save-as preset updates active preset and leaves no dirty orphan', async () => {
    const presetSavePayloads: Array<Record<string, unknown>> = [];
    const settingsSavePayloads: Array<Record<string, unknown>> = [];

    const initialSettings = {
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
      background: { name: '__transparent.png', url: 'url("backgrounds/__transparent.png")', fitting: 'classic', animation: false },
    };

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/csrf-token') return jsonResponse({ token: 'csrf-1' });
      if (url === ST_CHAT_STORAGE_SESSION_URL) return jsonResponse(stChatStorageSession);
      if (url === '/api/settings/get') {
        return jsonResponse({
          settings: JSON.stringify(initialSettings),
          openai_setting_names: ['Default'],
          openai_settings: [JSON.stringify({ temp_openai: 1, top_p_openai: 1 })],
          context: [],
          instruct: [],
          sysprompt: [],
          reasoning: [],
        });
      }
      if (url.endsWith('/model-purposes')) return jsonResponse({ items: [] });
      if (url.endsWith('/providers')) return jsonResponse({ items: [] });
      if (url === '/api/presets/save') {
        const body = JSON.parse(String(init?.body || '{}'));
        presetSavePayloads.push(body);
        return jsonResponse({ ok: true });
      }
      if (url === '/api/settings/save') {
        const body = JSON.parse(String(init?.body || '{}'));
        settingsSavePayloads.push(body);
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
          <ReplyConfigTestHarness />
        </SessionBridgeProvider>
      </AppProviders>,
    );

    const presetSelect = (await screen.findByLabelText('回复预设')) as HTMLSelectElement;
    expect(presetSelect.value).toBe('Default');

    const saveButton = screen.getByRole('button', { name: '保存' }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);

    // 1. Save-as 'Orphan Preset'
    fireEvent.click(screen.getByRole('button', { name: '另存预设' }));
    const nameInput1 = await screen.findByLabelText('名称');
    fireEvent.change(nameInput1, { target: { value: 'Orphan Preset' } });
    fireEvent.click(screen.getByRole('button', { name: '完成' }));

    await waitFor(() => {
      expect(presetSelect.value).toBe('Orphan Preset');
      expect(saveButton.disabled).toBe(false);
    });

    // 2. Switch back to 'Default' before saving -> orphan preset must be cleaned up and dirty cleared
    fireEvent.change(presetSelect, { target: { value: 'Default' } });
    await waitFor(() => {
      expect(presetSelect.value).toBe('Default');
      expect(saveButton.disabled).toBe(true);
    });
    expect(within(presetSelect).queryByRole('option', { name: 'Orphan Preset' })).toBeNull();

    // 3. Save-as 'First Unsaved' then immediately save-as 'Final Preset' -> only 'Final Preset' remains and updates oai_settings.preset_settings_openai
    fireEvent.click(screen.getByRole('button', { name: '另存预设' }));
    const nameInput2 = await screen.findByLabelText('名称');
    fireEvent.change(nameInput2, { target: { value: 'First Unsaved' } });
    fireEvent.click(screen.getByRole('button', { name: '完成' }));

    await waitFor(() => {
      expect(presetSelect.value).toBe('First Unsaved');
    });

    fireEvent.click(screen.getByRole('button', { name: '另存预设' }));
    const nameInput3 = await screen.findByLabelText('名称');
    fireEvent.change(nameInput3, { target: { value: 'Final Preset' } });
    fireEvent.click(screen.getByRole('button', { name: '完成' }));

    await waitFor(() => {
      expect(presetSelect.value).toBe('Final Preset');
    });
    expect(within(presetSelect).queryByRole('option', { name: 'First Unsaved' })).toBeNull();

    // 4. Click Save -> commits 'Final Preset' and updates oai_settings.preset_settings_openai to 'Final Preset'
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(saveButton.disabled).toBe(true);
    });

    expect(presetSavePayloads).toHaveLength(1);
    expect(presetSavePayloads[0].name).toBe('Final Preset');
    expect(presetSavePayloads[0].apiId).toBe('openai');

    expect(settingsSavePayloads).toHaveLength(1);
    const changes = settingsSavePayloads[0].vc_changes as Array<{
      path: string[];
      before: { exists: boolean; value?: unknown };
      after: { exists: boolean; value?: unknown };
    }>;
    expect(changes).toContainEqual({
      path: ['oai_settings', 'preset_settings_openai'],
      before: { exists: true, value: 'Default' },
      after: { exists: true, value: 'Final Preset' },
    });
  });

  it('PromptOrder supports @dnd-kit keyboard sorting and disables all actions and sorting when busy', async () => {
    const items = [
      { id: 'main', name: 'Main Prompt', enabled: true },
      { id: 'nsfw', name: 'Auxiliary Prompt', enabled: true },
      { id: 'jailbreak', name: 'Post History', enabled: false },
    ];
    const onSelect = vi.fn();
    const onToggle = vi.fn();
    const onMoveUp = vi.fn();
    const onMoveDown = vi.fn();
    const onReorder = vi.fn();

    // Provide deterministic bounding boxes for @dnd-kit KeyboardSensor + sortableKeyboardCoordinates
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        const row = this.closest('.vc-tavern-order-row') ?? this;
        const rows = Array.from(document.querySelectorAll('.vc-tavern-order-row'));
        const idx = Math.max(0, rows.indexOf(row as Element));
        const top = idx * 44;
        return {
          x: 0,
          y: top,
          top,
          bottom: top + 40,
          left: 0,
          right: 320,
          width: 320,
          height: 40,
          toJSON: () => ({}),
        } as DOMRect;
      });

    const { rerender } = render(
      <PromptOrder
        items={items}
        busy={false}
        onSelect={onSelect}
        onToggle={onToggle}
        onMoveUp={onMoveUp}
        onMoveDown={onMoveDown}
        onReorder={onReorder}
      />,
    );

    const firstHandle = screen.getByRole('button', { name: 'Main Prompt' });
    firstHandle.focus();

    // Activate keyboard drag with Space, wait for active drag state, move down with ArrowDown, drop with Space
    fireEvent.keyDown(firstHandle, { key: ' ', code: 'Space' });
    await waitFor(() => {
      expect(firstHandle.getAttribute('aria-pressed')).toBe('true');
    });

    fireEvent.keyDown(firstHandle, {
      key: 'ArrowDown',
      code: 'ArrowDown',
    });
    fireEvent.keyDown(firstHandle, { key: ' ', code: 'Space' });

    await waitFor(() => {
      expect(onReorder).toHaveBeenCalledWith(['nsfw', 'main', 'jailbreak']);
    });

    // Re-render with busy=true: all buttons, switches, and keyboard sorting must be disabled
    onReorder.mockClear();
    rerender(
      <PromptOrder
        items={items}
        busy={true}
        onSelect={onSelect}
        onToggle={onToggle}
        onMoveUp={onMoveUp}
        onMoveDown={onMoveDown}
        onReorder={onReorder}
      />,
    );

    for (const btn of screen.getAllByRole('button')) {
      expect((btn as HTMLButtonElement).disabled).toBe(true);
    }
    for (const sw of screen.getAllByRole('switch')) {
      expect(
        sw.hasAttribute('disabled') || sw.getAttribute('aria-disabled') === 'true',
      ).toBe(true);
    }

    const busyHandle = screen.getByRole('button', { name: 'Main Prompt' });
    fireEvent.keyDown(busyHandle, { key: ' ', code: 'Space' });
    fireEvent.keyDown(busyHandle, { key: 'ArrowDown', code: 'ArrowDown' });
    fireEvent.keyDown(busyHandle, { key: ' ', code: 'Space' });
    expect(onReorder).not.toHaveBeenCalled();

    rectSpy.mockRestore();
  });
});
