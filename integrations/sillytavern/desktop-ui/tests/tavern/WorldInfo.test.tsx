import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { AppProviders, createQueryClient, queryClient } from '../../src/app/providers';
import { createAppClient } from '../../src/data/client';
import { queryKeys } from '../../src/data/queryKeys';
import { SessionBridgeProvider, type SessionBridge } from '../../src/runtime/session-bridge';
import { WorldInfo } from '../../src/features/tavern/WorldInfo';
import {
  CODE_EDITOR_STORAGE_KEY,
  CodeField,
  WorldCodeEditorDialog,
  codeEditorDefaults,
} from '../../src/features/tavern/CodeField';
import { useTavernController } from '../../src/data/queries/tavern';

interface FakeMonacoRecord {
  lastCreatedOptions: Record<string, unknown> | null;
  lastUpdatedOptions: Record<string, unknown> | null;
  lastTheme: string;
  lastLanguage: string;
  currentValue: string;
  setEditorText: ((text: string) => void) | null;
}

const monacoRecord: FakeMonacoRecord = {
  lastCreatedOptions: null,
  lastUpdatedOptions: null,
  lastTheme: '',
  lastLanguage: '',
  currentValue: '',
  setEditorText: null,
};

vi.mock(
  '/scripts/extensions/third-party/ST-Prompt-Template/dist/desktop-editor.js',
  () => ({
    loadDesktopMonaco: async () => {
      return {
        Uri: {
          parse: (p: string) => ({ path: p, toString: () => p }),
        },
        editor: {
          EditorOption: { readOnly: 'readOnly' },
          getModel: () => null,
          createModel: (val: string, lang: string) => {
            monacoRecord.currentValue = val;
            monacoRecord.lastLanguage = lang;
            return {
              uri: { path: '' },
              getFullModelRange: () => ({}),
              dispose: () => {},
            };
          },
          setModelLanguage: (_model: unknown, lang: string) => {
            monacoRecord.lastLanguage = lang;
          },
          setTheme: (theme: string) => {
            monacoRecord.lastTheme = theme;
          },
          onDidChangeMarkers: () => ({ dispose: () => {} }),
          getModelMarkers: () => [],
          create: (host: HTMLElement, opts: Record<string, unknown>) => {
            monacoRecord.lastCreatedOptions = opts;
            let readOnly = Boolean(opts.readOnly);
            const changeListeners = new Set<(e: unknown) => void>();
            const domNode = document.createElement('div');
            domNode.className = 'monaco-editor';
            domNode.textContent = monacoRecord.currentValue;
            host.appendChild(domNode);

            monacoRecord.setEditorText = (next: string) => {
              monacoRecord.currentValue = next;
              domNode.textContent = next;
              for (const fn of changeListeners) fn({});
            };

            return {
              getModel: () => opts.model ?? { uri: { path: '' }, getFullModelRange: () => ({}), dispose: () => {} },
              setModel: () => {},
              getOption: (opt: string) => (opt === 'readOnly' ? readOnly : undefined),
              getValue: () => monacoRecord.currentValue,
              setValue: (next: string) => {
                monacoRecord.currentValue = next;
                domNode.textContent = next;
              },
              executeEdits: (_source: string, edits: Array<{ text: string }>) => {
                if (edits[0]) {
                  monacoRecord.currentValue = edits[0].text;
                  domNode.textContent = edits[0].text;
                }
                for (const fn of changeListeners) fn({});
              },
              pushUndoStop: () => {},
              updateOptions: (nextOpts: Record<string, unknown>) => {
                monacoRecord.lastUpdatedOptions = nextOpts;
                if (typeof nextOpts.readOnly === 'boolean') {
                  readOnly = nextOpts.readOnly;
                }
              },
              onDidChangeModelContent: (cb: (e: unknown) => void) => {
                changeListeners.add(cb);
                return {
                  dispose: () => changeListeners.delete(cb),
                };
              },
              saveViewState: () => null,
              restoreViewState: () => {},
              revealLine: () => {},
              dispose: () => {
                domNode.remove();
              },
            };
          },
        },
      };
    },
  }),
);

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

function WorldInfoTestHarness() {
  const controller = useTavernController('WorldInfo');
  return (
    <div>
      <header className="vc-settings-header">
        <button
          type="button"
          data-tavern-save=""
          disabled={controller.loading || controller.busy || !controller.dirty}
          onClick={() => controller.save()}
        >
          保存
        </button>
      </header>
      <WorldInfo controller={controller} />
      {controller.modals}
    </div>
  );
}

describe('WorldInfo (B14 deleting world clears global/char/chat references in one commit)', () => {
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

  it('deleting world clears global/char/chat references in one commit', async () => {
    const deletedWorlds: string[] = [];
    const settingsSaves: Array<Record<string, unknown>> = [];
    const characterMerges: Array<Record<string, unknown>> = [];
    const commitMetadataSpy = vi.fn(async () => {});
    const applyWorldbookSpy = vi.fn(async () => {});

    const initialSettings = {
      oai_settings: {
        preset_settings_openai: 'Default',
        prompts: [],
        prompt_order: [{ character_id: 100001, order: [] }],
      },
      power_user: {},
      world_info_settings: {
        world_info: {
          globalSelect: ['Lore Alpha', 'Lore Beta'],
          charLore: [{ name: 'alice', extraBooks: ['Lore Alpha', 'Lore Beta'] }],
        },
        world_info_depth: 2,
        world_info_min_activations: 0,
        world_info_min_activations_depth_max: 0,
        world_info_budget: 25,
        world_info_budget_cap: 0,
        world_info_include_names: true,
        world_info_recursive: true,
        world_info_overflow_alert: false,
        world_info_case_sensitive: false,
        world_info_match_whole_words: true,
        world_info_character_strategy: 0,
      },
      extension_settings: {},
      background: { name: '__transparent.png', url: 'url("backgrounds/__transparent.png")', fitting: 'classic', animation: false },
    };

    const aliceCard = {
      avatar: 'alice.png',
      name: 'Alice',
      data: {
        name: 'Alice',
        description: 'Heroine',
        personality: '',
        scenario: '',
        first_mes: 'Hi',
        mes_example: '',
        extensions: {
          world: 'Lore Alpha',
          vc_character_ref: 'char-alice',
        },
      },
    };

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/csrf-token') return jsonResponse({ token: 'csrf-1' });
      if (url === '/api/settings/get') {
        return jsonResponse({
          settings: JSON.stringify(initialSettings),
          openai_setting_names: ['Default'],
          openai_settings: [JSON.stringify({})],
          context: [],
          instruct: [],
          sysprompt: [],
          reasoning: [],
        });
      }
      if (url === '/api/characters/all') {
        return jsonResponse([{ avatar: 'alice.png', name: 'Alice' }]);
      }
      if (url === '/api/characters/get') {
        return jsonResponse(aliceCard);
      }
      if (url === '/api/worldinfo/list') {
        return jsonResponse([{ file_id: 'Lore Alpha' }, { file_id: 'Lore Beta' }]);
      }
      if (url === '/api/worldinfo/get') {
        const body = JSON.parse(String(init?.body || '{}'));
        return jsonResponse({
          entries: {
            '0': { uid: 0, comment: `${body.name} Entry`, content: 'lore content', key: ['alpha'] },
          },
        });
      }
      if (url === '/api/worldinfo/delete') {
        const body = JSON.parse(String(init?.body || '{}'));
        deletedWorlds.push(body.name);
        return jsonResponse({ ok: true });
      }
      if (url === '/api/settings/save') {
        const body = JSON.parse(String(init?.body || '{}'));
        settingsSaves.push(body);
        return jsonResponse({ ok: true });
      }
      if (url === '/api/characters/merge-attributes') {
        const body = JSON.parse(String(init?.body || '{}'));
        characterMerges.push(body);
        return jsonResponse({ ok: true });
      }
      return jsonResponse({});
    }) as typeof fetch;

    const client = createAppClient();
    await client.initialize();

    const ctx = {
      characters: [aliceCard],
      chat: [],
      chatMetadata: { world_info: 'Lore Alpha' },
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

    const bridge = {
      subscribe: () => () => {},
      getSnapshot: () => snap,
      getContext: () => ctx,
      applySettings: vi.fn(async () => {}),
      applyPreset: vi.fn(async () => {}),
      applyWorldbook: applyWorldbookSpy,
      reloadCharacter: vi.fn(async () => {}),
      commitMetadata: commitMetadataSpy,
      deleteCharacter: vi.fn(async () => {}),
    } as unknown as SessionBridge;

    const qc = createQueryClient();

    render(
      <AppProviders client={client} queryClient={qc}>
        <SessionBridgeProvider bridge={bridge}>
          <WorldInfoTestHarness />
        </SessionBridgeProvider>
      </AppProviders>,
    );

    const worldSelect = (await screen.findByLabelText('世界书')) as HTMLSelectElement;
    await waitFor(() => {
      expect(worldSelect.value).toBe('Lore Alpha');
    });

    // QueryClient holds real values for settingsDoc, characters, character detail, worldbookList, and worldbook(name)
    expect(qc.getQueryData(queryKeys.settingsDoc)).toBeDefined();
    expect(qc.getQueryData(queryKeys.characters)).toEqual([{ avatar: 'alice.png', name: 'Alice' }]);
    expect(qc.getQueryData([...queryKeys.characters, 'alice.png'])).toEqual(aliceCard);
    expect(qc.getQueryData(['settingsDoc', 'worldbookList'])).toEqual([
      { file_id: 'Lore Alpha' },
      { file_id: 'Lore Beta' },
    ]);
    expect(qc.getQueryData(queryKeys.worldbook('Lore Alpha'))).toEqual({
      entries: {
        '0': { uid: 0, comment: 'Lore Alpha Entry', content: 'lore content', key: ['alpha'] },
      },
    });

    // Click '删除世界书' and confirm in alertdialog
    fireEvent.click(screen.getByRole('button', { name: '删除世界书' }));
    const alertDialog = await screen.findByRole('alertdialog');
    fireEvent.click(
      Array.from(alertDialog.querySelectorAll('button')).find((b) => b.textContent === '删除')!,
    );

    await waitFor(() => {
      expect(deletedWorlds).toEqual(['Lore Alpha']);
      expect(settingsSaves).toHaveLength(1);
      expect(characterMerges).toHaveLength(1);
      expect(commitMetadataSpy).toHaveBeenCalledTimes(1);
    });

    // Verify settings save cleared 'Lore Alpha' from globalSelect and charLore
    const settingsChanges = settingsSaves[0].vc_changes as Array<{
      path: string[];
      before: { exists: boolean; value?: unknown };
      after: { exists: boolean; value?: unknown };
    }>;
    expect(settingsChanges).toContainEqual({
      path: ['world_info_settings', 'world_info', 'globalSelect'],
      before: { exists: true, value: ['Lore Alpha', 'Lore Beta'] },
      after: { exists: true, value: ['Lore Beta'] },
    });
    expect(settingsChanges).toContainEqual({
      path: ['world_info_settings', 'world_info', 'charLore'],
      before: {
        exists: true,
        value: [{ name: 'alice', extraBooks: ['Lore Alpha', 'Lore Beta'] }],
      },
      after: {
        exists: true,
        value: [{ name: 'alice', extraBooks: ['Lore Beta'] }],
      },
    });

    // Verify character merge cleared data.extensions.world
    expect(characterMerges[0]).toEqual({
      avatar: 'alice.png',
      data: {
        extensions: {
          world: '',
        },
      },
    });

    // Verify chat metadata commit cleared world_info and passed captured expectedKey
    expect(commitMetadataSpy).toHaveBeenCalledWith(
      [
        {
          path: ['world_info'],
          before: { exists: true, value: 'Lore Alpha' },
          after: { exists: true, value: '' },
        },
      ],
      '["alice.png","chat-1"]',
    );

    // Verify form is clean after one-commit deletion
    const saveButton = screen.getByRole('button', { name: '保存' }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
  });

  it('WorldCodeEditorDialog 30-item prefs & text act as drafts: Cancel discards both without writing localStorage, Apply saves and preserves unknown keys', async () => {
    localStorage.setItem(
      CODE_EDITOR_STORAGE_KEY,
      JSON.stringify({
        fontSize: 15,
        unknown_legacy_pref: 'keep-me',
        nested_unknown: { a: 1 },
      }),
    );

    const onApply = vi.fn();
    const onClose = vi.fn();
    const dirtyStates: boolean[] = [];

    const { unmount } = render(
      <WorldCodeEditorDialog
        open={true}
        initialValue="<% if (user) { %>Hello<% } %>"
        onApply={onApply}
        onClose={onClose}
        onDirtyChange={(d) => dirtyStates.push(d)}
      />,
    );

    // Wait for Monaco editor to mount via @monaco-editor/react + loadDesktopMonaco
    await waitFor(() => {
      expect(document.querySelector('.monaco-editor')).not.toBeNull();
    });
    expect(monacoRecord.lastLanguage).toBe('ejs');
    expect(monacoRecord.lastTheme).toBe('ejsTheme');
    expect(monacoRecord.lastCreatedOptions).toMatchObject({
      fontSize: 15,
      wordWrap: 'off',
      lineNumbers: 'on',
      minimap: { enabled: true },
      readOnly: false,
    });

    // All 30 preferences are rendered in the settings panel
    expect(Object.keys(codeEditorDefaults)).toHaveLength(30);
    const fontSizeInput = screen.getByLabelText('字号') as HTMLInputElement;
    expect(fontSizeInput.value).toBe('15');
    const wordBasedSelect = screen.getByLabelText('词语建议') as HTMLSelectElement;
    expect(wordBasedSelect.value).toBe('currentDocument');

    // Change a preference (fontSize -> 18) WITHOUT changing text:
    // 1) dirty becomes true
    // 2) Monaco options update live
    // 3) localStorage is NOT written yet!
    fireEvent.change(fontSizeInput, { target: { value: '18' } });
    await waitFor(() => {
      expect(dirtyStates.at(-1)).toBe(true);
      expect(monacoRecord.lastUpdatedOptions).toMatchObject({ fontSize: 18 });
    });
    expect(JSON.parse(localStorage.getItem(CODE_EDITOR_STORAGE_KEY)!).fontSize).toBe(15);

    // Click '取消' -> opens discard confirmation AlertDialog because prefs are dirty
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    const discardDialog = await screen.findByRole('alertdialog');
    fireEvent.click(
      Array.from(discardDialog.querySelectorAll('button')).find((b) => b.textContent === '放弃')!,
    );

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
    // localStorage remains untouched after Cancel!
    expect(JSON.parse(localStorage.getItem(CODE_EDITOR_STORAGE_KEY)!)).toEqual({
      fontSize: 15,
      unknown_legacy_pref: 'keep-me',
      nested_unknown: { a: 1 },
    });

    unmount();

    // Re-open dialog, edit both preferences and text, then click '完成' (Apply)
    onClose.mockClear();
    render(
      <WorldCodeEditorDialog
        open={true}
        initialValue="<% if (user) { %>Hello<% } %>"
        onApply={onApply}
        onClose={onClose}
      />,
    );

    await waitFor(() => {
      expect(document.querySelector('.monaco-editor')).not.toBeNull();
    });

    fireEvent.change(screen.getByLabelText('字号'), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText('主题'), { target: { value: 'vs-dark' } });
    monacoRecord.setEditorText?.('<% if (user) { %>Updated<% } %>');

    await waitFor(() => {
      expect(monacoRecord.lastTheme).toBe('vs-dark');
    });

    const applyBtn = screen.getByRole('button', { name: '完成' }) as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(false);
    fireEvent.click(applyBtn);

    expect(onApply).toHaveBeenCalledWith('<% if (user) { %>Updated<% } %>');
    expect(onClose).toHaveBeenCalledTimes(1);

    const savedStorage = JSON.parse(localStorage.getItem(CODE_EDITOR_STORAGE_KEY)!);
    expect(savedStorage.fontSize).toBe(20);
    expect(savedStorage.theme).toBe('vs-dark');
    // Unknown keys preserved!
    expect(savedStorage.unknown_legacy_pref).toBe('keep-me');
    expect(savedStorage.nested_unknown).toEqual({ a: 1 });
    // Full 30 defaults present
    for (const key of Object.keys(codeEditorDefaults)) {
      expect(savedStorage).toHaveProperty(key);
    }
  });

  it('CodeField supports controlled value, disabled readOnly sync, and 4 planned languages + ejs', async () => {
    const onChange = vi.fn();

    const { rerender } = render(
      <CodeField
        mode="monaco"
        language="json"
        value='{"a":1}'
        disabled={false}
        onChange={onChange}
      />,
    );

    await waitFor(() => {
      expect(document.querySelector('.monaco-editor')).not.toBeNull();
    });
    expect(monacoRecord.lastLanguage).toBe('json');
    expect(monacoRecord.currentValue).toBe('{"a":1}');

    // Update controlled value, language, and disabled=true
    rerender(
      <CodeField
        mode="monaco"
        language="css"
        value=".body { color: red; }"
        disabled={true}
        onChange={onChange}
      />,
    );

    await waitFor(() => {
      expect(monacoRecord.lastLanguage).toBe('css');
      expect(monacoRecord.currentValue).toBe('.body { color: red; }');
      expect(monacoRecord.lastUpdatedOptions).toMatchObject({ readOnly: true });
    });
  });
});
