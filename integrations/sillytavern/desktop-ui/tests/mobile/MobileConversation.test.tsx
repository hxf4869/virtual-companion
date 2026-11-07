import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders, createQueryClient } from '../../src/app/providers';
import { createAppClient } from '../../src/data/client';
import { parseConversationKey } from '../../src/data/queries/chat';
import {
  type ChatMessage,
  type ChatSnapshot,
  type OpenResult,
  type SessionBridge,
} from '../../src/runtime/session-bridge';
import { createChatTailCache } from '../../src/mobile/chat/data/chatTailCache';
import {
  readCachedConversationTail,
  readCachedConversationTailSync,
  resetSharedMobileTailCacheForTest,
  resolveConversationCacheKey,
  snapshotToStoredTailPage,
  writeCachedConversationTail,
} from '../../src/mobile/chat/data/mobileConversationCache';
import { buildMobileConversationRows } from '../../src/mobile/chat/conversation/messageGrouping';
import { MobileConversation } from '../../src/mobile/chat/conversation/MobileConversation';
import { MobileApp } from '../../src/mobile/app/MobileApp';
import { usePreferences } from '../../src/design/theme/usePreferences';

const DEFAULT_CHAT_SNAPSHOT: ChatSnapshot = {
  key: '',
  messages: [],
  busy: false,
  canSend: true,
  notice: '',
  conflict: false,
  catalogBlocked: false,
  settingsRequired: false,
  enterToSend: true,
  runtime: 'prepared',
  status: 'empty',
  phase: '',
  streamingKey: null,
  error: '',
  avatar: '',
  avatarUrl: '',
  characterName: '',
  conflictSnapshot: null,
  popupRequest: null,
  personaChoice: null,
  preferences: {},
  recalledPrompt: '',
};

function createMockSessionBridge(
  initialSnapshot?: Partial<ChatSnapshot>,
  options?: { accountId?: string },
) {
  let accountId = options?.accountId ?? 'acc-default';
  let snapshot: ChatSnapshot = {
    ...DEFAULT_CHAT_SNAPSHOT,
    ...initialSnapshot,
  };
  const listeners = new Set<() => void>();
  const drafts = new Map<string, string>();

  const publish = (patch: Partial<ChatSnapshot>) => {
    snapshot = {
      ...snapshot,
      ...patch,
    };
    for (const listener of Array.from(listeners)) {
      listener();
    }
  };

  const storageId = (key: string = snapshot.key): string => {
    if (!key) return '';
    const parsed = parseConversationKey(key);
    if (parsed && accountId) {
      return JSON.stringify([accountId, parsed.avatar, parsed.file]);
    }
    return key;
  };

  const draftObj: SessionBridge['draft'] = {
    read(key: string = snapshot.key): string {
      const id = storageId(key);
      return id ? drafts.get(id) || '' : '';
    },
    write(key: string, value: string): void {
      const id = storageId(key || snapshot.key);
      if (!id) return;
      const prev = drafts.get(id) || '';
      if (value) drafts.set(id, value);
      else drafts.delete(id);
      if (prev !== value) {
        publish({});
      }
    },
    storageId,
  };

  const bridge: SessionBridge & {
    publish: (patch: Partial<ChatSnapshot>) => void;
    getCurrentSnapshot: () => ChatSnapshot;
    setAccountId: (nextAccountId: string) => void;
  } = {
    getSnapshot: () => snapshot,
    getCurrentSnapshot: () => snapshot,
    publish,
    setAccountId: (nextAccountId: string) => {
      accountId = nextAccountId;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    open: vi.fn(async (rowOrKey: any): Promise<OpenResult> => {
      const key = typeof rowOrKey === 'string' ? rowOrKey : rowOrKey?.key || '';
      publish({
        status: 'ready',
        canSend: true,
        key,
      });
      return 'opened';
    }),
    send: vi.fn(async (text: string, sendOpts?: { draftInput?: string | null }) => {
      const trimmed = text.trim();
      if (!trimmed) return false;
      const draftInput = sendOpts?.draftInput !== undefined ? sendOpts.draftInput : text;
      if (snapshot.key && draftInput && draftObj.read(snapshot.key) === draftInput) {
        draftObj.write(snapshot.key, '');
      }
      const nextMsg: ChatMessage = {
        key: `msg-${snapshot.messages.length + 1}`,
        index: snapshot.messages.length,
        name: '你',
        mes: text,
        is_user: true,
        is_system: false,
        send_date: new Date().toISOString(),
      };
      publish({
        messages: [...snapshot.messages, nextMsg],
        notice: '',
      });
      return true;
    }),
    stop: vi.fn(async () => {
      publish({
        busy: false,
        phase: '',
        notice: '已停止',
      });
    }),
    retry: vi.fn(async () => {
      publish({
        busy: false,
        notice: '',
        error: '',
      });
      return true;
    }),
    continue: vi.fn(async () => true),
    regenerate: vi.fn(async () => true),
    edit: vi.fn(async () => true),
    remove: vi.fn(async () => true),
    swipe: vi.fn(async () => true),
    react: vi.fn(async () => true),
    pat: vi.fn(async () => true),
    whenIdle: vi.fn(async () => undefined),
    createConversation: vi.fn(async () => undefined),
    projectStory: vi.fn(async () => undefined),
    story: {
      setRun: vi.fn(async () => undefined),
      selectActor: vi.fn(async () => undefined),
      advance: vi.fn(async () => undefined),
      clear: vi.fn(async () => undefined),
    },
    applySettings: vi.fn(async () => undefined),
    applyPreset: vi.fn(async () => undefined),
    applyWorldbook: vi.fn(async () => undefined),
    reloadCharacter: vi.fn(async () => undefined),
    commitMetadata: vi.fn(async () => undefined),
    deleteCharacter: vi.fn(async () => undefined),
    refreshCatalog: vi.fn(async () => undefined),
    setBudget: vi.fn(async () => undefined),
    mountLeaf: vi.fn((index: number, element: HTMLElement) => {
      const renderInto = () => {
        const msg = snapshot.messages[index];
        element.innerHTML = `<div class="mes_text">${msg?.mes || ''}</div>`;
      };
      renderInto();
      const unsub = bridge.subscribe(renderInto);
      return () => {
        unsub();
        element.innerHTML = '';
      };
    }),
    draft: draftObj,
    mountCardActions: vi.fn(() => undefined),
    resolvePopup: vi.fn(),
    resolvePersonaChoice: vi.fn(),
    copyRejected: vi.fn(async () => ''),
    resolveConflictLatest: vi.fn(async () => 'opened' as const),
    dismissConflict: vi.fn(),
    markVoicePlayed: vi.fn(),
    cancelForCharacterDelete: vi.fn(async () => undefined),
    setFirstDisplayedMessageId: vi.fn(),
    getContext: vi.fn(() => ({ name1: '你' })),
    destroy: vi.fn(),
  };

  return bridge;
}

function createMockClient() {
  const client = createAppClient({
    fetchImpl: vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => [],
      text: async () => JSON.stringify({ items: [], unreadCount: 0 }),
    })) as unknown as typeof fetch,
  });
  client.recent = vi.fn(async () => []);
  client.characters = vi.fn(async () => []);
  client.go.fetchRelationships = vi.fn(async () => []);
  return client;
}

describe('MB2-6b-1 MobileConversation Skeleton, Grouping, Date Capsules, Write-Through Tail Cache & Drafts', () => {
  beforeEach(() => {
    window.localStorage.clear();
    usePreferences.getState().resetForTest?.();
    resetSharedMobileTailCacheForTest(null);
    window.history.replaceState(null, '', '/m/chat');

    // Provide layout metrics in happy-dom so react-virtuoso's internal scroll/viewport engine operates
    const origGetComputedStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element, pseudo?: string | null) => {
      const style = origGetComputedStyle(el, pseudo);
      return new Proxy(style, {
        get(target, prop) {
          if ((prop === 'rowGap' || prop === 'columnGap') && !Reflect.get(target, prop, target)) {
            return 'normal';
          }
          const val = Reflect.get(target, prop, target);
          return typeof val === 'function' ? val.bind(target) : val;
        },
      });
    });
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      cb(performance.now());
      return 0;
    });
    const observedElements = new WeakSet<Element>();
    vi.stubGlobal(
      'ResizeObserver',
      class MockResizeObserver {
        private cb: ResizeObserverCallback;
        constructor(cb: ResizeObserverCallback) {
          this.cb = cb;
        }
        observe(target: Element) {
          if (observedElements.has(target)) return;
          observedElements.add(target);
          this.cb([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver);
        }
        unobserve(target: Element) {
          observedElements.delete(target);
        }
        disconnect() {}
      },
    );
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get() {
        if ((this as HTMLElement).dataset?.virtuosoScroller !== undefined) return 600;
        return 72;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get() {
        const el = this as HTMLElement;
        if (el.dataset?.virtuosoScroller !== undefined) {
          const list = el.querySelector('[data-testid="virtuoso-item-list"]') as HTMLElement | null;
          if (list) {
            const pt = Number.parseFloat(list.style.paddingTop || '0') || 0;
            const pb = Number.parseFloat(list.style.paddingBottom || '0') || 0;
            const lastIdxAttr = list.lastElementChild?.getAttribute('data-index');
            const byIndex =
              lastIdxAttr !== null && lastIdxAttr !== undefined
                ? (Number.parseInt(lastIdxAttr, 10) + 1) * 72
                : 0;
            const total = Math.max(pt + pb + list.children.length * 72, byIndex);
            return Math.max(600, total);
          }
          return 600;
        }
        return 72;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
      configurable: true,
      get() {
        return document.body;
      },
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const isViewportOrScroller =
        this.dataset?.virtuosoScroller !== undefined ||
        this.dataset?.viewportType !== undefined;
      const h = isViewportOrScroller ? 600 : 72;
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 390,
        bottom: h,
        width: 390,
        height: h,
        toJSON: () => ({}),
      } as DOMRect;
    });
    HTMLElement.prototype.scrollTo = function (
      this: HTMLElement,
      options?: ScrollToOptions | number,
      y?: number,
    ) {
      const nextTop =
        typeof options === 'number' ? (y ?? 0) : typeof options?.top === 'number' ? options.top : this.scrollTop;
      this.scrollTop = nextTop;
      this.dispatchEvent(new Event('scroll'));
    };
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    usePreferences.getState().resetForTest?.();
    resetSharedMobileTailCacheForTest(null);
    vi.restoreAllMocks();
  });

  it('groups consecutive same-sender messages with 4/6/12 rules, puts tail & 36px avatar only on group end, and shows 已发送 below last user message', async () => {
    const baseMs = Date.parse('2026-11-06T20:00:00.000Z');
    const messages: ChatMessage[] = [
      {
        key: 'm-1',
        index: 0,
        name: '林夕',
        mes: '第一条角色消息',
        is_user: false,
        is_system: false,
        send_date: new Date(baseMs).toISOString(),
      },
      {
        key: 'm-2',
        index: 1,
        name: '林夕',
        mes: '第二条角色消息（中间）',
        is_user: false,
        is_system: false,
        send_date: new Date(baseMs + 60_000).toISOString(),
      },
      {
        key: 'm-3',
        index: 2,
        name: '林夕',
        mes: '第三条角色消息（组尾带尾巴和头像）',
        is_user: false,
        is_system: false,
        send_date: new Date(baseMs + 120_000).toISOString(),
      },
      {
        key: 'm-4',
        index: 3,
        name: '你',
        mes: '用户第一条消息',
        is_user: true,
        is_system: false,
        send_date: new Date(baseMs + 180_000).toISOString(),
      },
      {
        key: 'm-5',
        index: 4,
        name: '你',
        mes: '用户最后一条消息',
        is_user: true,
        is_system: false,
        send_date: new Date(baseMs + 210_000).toISOString(),
      },
      {
        key: 'm-6',
        index: 5,
        name: '林夕',
        mes: '角色单独回复',
        is_user: false,
        is_system: false,
        send_date: new Date(baseMs + 240_000).toISOString(),
      },
    ];

    const rows = buildMobileConversationRows(messages, { now: baseMs + 300_000 });
    expect(rows.map((r) => r.groupPosition)).toEqual(['start', 'mid', 'end', 'start', 'end', 'solo']);
    expect(rows.map((r) => r.hasTail)).toEqual([false, false, true, false, true, true]);
    expect(rows.map((r) => r.showAvatar)).toEqual([false, false, true, false, false, true]);
    expect(rows.map((r) => r.spacingBeforePx)).toEqual([0, 4, 4, 12, 4, 12]);
    expect(rows.map((r) => r.adjacentTopCornerPx)).toEqual([18, 6, 6, 18, 6, 18]);
    expect(rows.map((r) => r.adjacentBottomCornerPx)).toEqual([6, 6, 18, 6, 18, 18]);
    expect(rows.map((r) => r.isLastUserMessage)).toEqual([false, false, false, false, true, false]);

    const keyLinxi = '["linxi.png","chat-linxi"]';
    const bridge = createMockSessionBridge({
      status: 'ready',
      key: keyLinxi,
      characterName: '林夕',
      avatar: 'linxi.png',
      avatarUrl: '/thumbnail?type=avatar&file=linxi.png',
      messages,
    });
    const client = createMockClient();
    const queryClient = createQueryClient();

    render(
      <AppProviders client={client} queryClient={queryClient} sessionBridge={bridge}>
        <MobileConversation conversationKey={keyLinxi} now={() => baseMs + 300_000} />
      </AppProviders>,
    );

    const renderedItems = Array.from(document.querySelectorAll('[data-vc-chat-msg]'));
    expect(renderedItems.length).toBe(6);
    expect(renderedItems.map((el) => el.getAttribute('data-vc-group-pos'))).toEqual([
      'start',
      'mid',
      'end',
      'start',
      'end',
      'solo',
    ]);
    expect(renderedItems.map((el) => el.getAttribute('data-vc-has-tail'))).toEqual([
      'false',
      'false',
      'true',
      'false',
      'true',
      'true',
    ]);

    // Only group end / solo assistant messages render the 36px avatar
    const avatars = document.querySelectorAll('[data-vc-message-avatar]');
    expect(avatars.length).toBe(2);

    // Only the last user message (m-5) renders "已发送"
    const sentReceipts = document.querySelectorAll('[data-vc-sent-receipt]');
    expect(sentReceipts.length).toBe(1);
    expect(sentReceipts[0].textContent).toBe('已发送');
    expect(renderedItems[4].querySelector('[data-vc-sent-receipt]')?.textContent).toBe('已发送');
  });

  it('inserts a date capsule when adjacent messages are more than 20 minutes apart and splits sender groups across the capsule', async () => {
    const baseMs = Date.parse('2026-11-06T14:00:00.000Z');
    const messages: ChatMessage[] = [
      {
        key: 'm-1',
        index: 0,
        name: '林夕',
        mes: '14:00 的第一条消息',
        is_user: false,
        is_system: false,
        send_date: new Date(baseMs).toISOString(),
      },
      {
        key: 'm-2',
        index: 1,
        name: '林夕',
        mes: '14:05 的第二条消息（间隔 5 分钟，不插日期胶囊）',
        is_user: false,
        is_system: false,
        send_date: new Date(baseMs + 5 * 60_000).toISOString(),
      },
      {
        key: 'm-3',
        index: 2,
        name: '林夕',
        mes: '14:30 的第三条消息（间隔 25 分钟 > 20 分钟，插入日期胶囊并重新分组）',
        is_user: false,
        is_system: false,
        send_date: new Date(baseMs + 30 * 60_000).toISOString(),
      },
    ];

    const rows = buildMobileConversationRows(messages, { now: baseMs + 35 * 60_000 });
    expect(rows[0].dateLabel).toBeNull();
    expect(rows[1].dateLabel).toBeNull();
    expect(rows[2].dateLabel).toBeTruthy();
    expect(rows[2].dateLabel).toContain('今天');
    // m-1 and m-2 form a group (start -> end); m-3 after date capsule starts a new group (solo)
    expect(rows.map((r) => r.groupPosition)).toEqual(['start', 'end', 'solo']);
    expect(rows.map((r) => r.hasTail)).toEqual([false, true, true]);
    expect(rows.map((r) => r.spacingBeforePx)).toEqual([0, 4, 12]);

    const keyLinxi = '["linxi.png","chat-linxi"]';
    const bridge = createMockSessionBridge({
      status: 'ready',
      key: keyLinxi,
      characterName: '林夕',
      avatar: 'linxi.png',
      avatarUrl: '/thumbnail?type=avatar&file=linxi.png',
      messages,
    });
    const client = createMockClient();
    const queryClient = createQueryClient();

    render(
      <AppProviders client={client} queryClient={queryClient} sessionBridge={bridge}>
        <MobileConversation conversationKey={keyLinxi} now={() => baseMs + 35 * 60_000} />
      </AppProviders>,
    );

    const pills = Array.from(document.querySelectorAll('[data-vc-date-pill]'));
    expect(pills.length).toBe(1);
    expect(pills[0].textContent).toContain('今天');
  });

  it('shows skeleton on first uncached entry, writes through display-only tail to memory + IndexedDB on open/idle, renders cached tail immediately (<300 ms) on re-entry before bridge.open finishes, and falls back to memory when IndexedDB throws', async () => {
    const keyLinxi = '["linxi.png","chat-linxi"]';
    let idbBroken = false;
    const dbMap = new Map<string, any>();

    const mockIdb = {
      open: () => {
        if (idbBroken) throw new Error('IDB_OPEN_DISABLED');
        const req: any = {
          result: {
            objectStoreNames: { contains: () => true },
            createObjectStore: () => ({}),
            transaction: () => ({
              objectStore: () => ({
                get: (key: string) => {
                  if (idbBroken) throw new Error('IDB_READ_DISABLED');
                  const r: any = { result: dbMap.get(key) ?? null };
                  queueMicrotask(() => r.onsuccess?.());
                  return r;
                },
                put: (value: any, key: string) => {
                  if (idbBroken) throw new Error('IDB_WRITE_DISABLED');
                  dbMap.set(key, structuredClone(value));
                  const r: any = { result: key };
                  queueMicrotask(() => r.onsuccess?.());
                  return r;
                },
                delete: (key: string) => {
                  dbMap.delete(key);
                  const r: any = {};
                  queueMicrotask(() => r.onsuccess?.());
                  return r;
                },
                clear: () => {
                  dbMap.clear();
                  const r: any = {};
                  queueMicrotask(() => r.onsuccess?.());
                  return r;
                },
              }),
            }),
          },
        };
        queueMicrotask(() => req.onsuccess?.());
        return req;
      },
    } as unknown as IDBFactory;

    const tailCache = createChatTailCache({ indexedDB: mockIdb });

    // Defer bridge.open resolution to observe initial uncached vs cached render
    let resolveOpen!: (value: OpenResult) => void;
    const bridge = createMockSessionBridge({
      status: 'switching',
      key: '',
      messages: [],
    });
    bridge.open = vi.fn(
      () =>
        new Promise<OpenResult>((resolve) => {
          resolveOpen = resolve;
        }),
    );

    const client = createMockClient();
    const queryClient = createQueryClient();

    // 1. First entry (no cache): must show skeleton and NOT fabricate any messages
    const { unmount } = render(
      <AppProviders client={client} queryClient={queryClient} sessionBridge={bridge}>
        <MobileConversation conversationKey={keyLinxi} tailCache={tailCache} />
      </AppProviders>,
    );

    expect(document.querySelector('[data-vc-chat-skeleton]')).toBeTruthy();
    expect(document.querySelectorAll('[data-vc-chat-msg]').length).toBe(0);

    // 2. Complete bridge.open -> live snapshot arrives with messages + heavy non-display fields
    const liveMessages: ChatMessage[] = [
      {
        key: 'm-10',
        index: 0,
        name: '林夕',
        mes: '缓存里的历史问候',
        is_user: false,
        is_system: false,
        send_date: '2026-11-06T10:00:00.000Z',
        swipes: ['缓存里的历史问候', '巨大的冗余候选文本'],
        variables: [{ huge_state: 'should_be_stripped' }],
      } as ChatMessage,
      {
        key: 'm-11',
        index: 1,
        name: '你',
        mes: '我回来啦',
        is_user: true,
        is_system: false,
        send_date: '2026-11-06T10:01:00.000Z',
      },
    ];

    await act(async () => {
      bridge.publish({
        status: 'ready',
        busy: false,
        canSend: true,
        key: keyLinxi,
        characterName: '林夕',
        avatar: 'linxi.png',
        avatarUrl: '/thumbnail?type=avatar&file=linxi.png',
        messages: liveMessages,
      });
      resolveOpen('opened');
    });

    await waitFor(() => {
      expect(document.querySelector('[data-vc-chat-skeleton]')).toBeNull();
      expect(document.querySelectorAll('[data-vc-chat-msg]').length).toBe(2);
    });

    // Verify write-through cache populated both memory and IndexedDB with display-only fields
    const cachedSync = readCachedConversationTailSync(
      tailCache,
      keyLinxi,
      bridge.draft.storageId,
    );
    expect(cachedSync).toBeTruthy();
    expect(cachedSync?.characterName).toBe('林夕');
    expect(cachedSync?.messages.map((m) => m.mes)).toEqual(['缓存里的历史问候', '我回来啦']);
    // Non-display heavy fields like variables must be stripped
    expect((cachedSync?.messages[0] as any).variables).toBeUndefined();
    await waitFor(() => {
      expect(dbMap.size).toBeGreaterThan(0);
    });

    unmount();

    // 3. Re-entry when bridge is opening another/same session: renders cached history immediately (<300 ms) BEFORE bridge.open resolves, then reconciles seamlessly to updated live snapshot
    bridge.publish({
      status: 'switching',
      key: '',
      messages: [],
    });
    let resolveReopen!: (value: OpenResult) => void;
    bridge.open = vi.fn(
      () =>
        new Promise<OpenResult>((resolve) => {
          resolveReopen = resolve;
        }),
    );

    const t0 = performance.now();
    const { unmount: unmount2 } = render(
      <AppProviders client={client} queryClient={queryClient} sessionBridge={bridge}>
        <MobileConversation conversationKey={keyLinxi} tailCache={tailCache} />
      </AppProviders>,
    );
    const elapsedMs = performance.now() - t0;

    // Immediately visible from write-through cache without waiting for bridge.open
    expect(elapsedMs).toBeLessThan(300);
    expect(document.querySelector('[data-vc-chat-skeleton]')).toBeNull();
    expect(document.querySelectorAll('[data-vc-chat-msg]').length).toBe(2);
    expect(document.body.textContent).toContain('缓存里的历史问候');
    expect(document.body.textContent).toContain('我回来啦');

    // Now bridge.open completes with a newer message reconciled from live snapshot
    await act(async () => {
      bridge.publish({
        status: 'ready',
        busy: false,
        canSend: true,
        key: keyLinxi,
        characterName: '林夕',
        avatar: 'linxi.png',
        avatarUrl: '/thumbnail?type=avatar&file=linxi.png',
        messages: [
          ...liveMessages,
          {
            key: 'm-12',
            index: 2,
            name: '林夕',
            mes: '对账后的实时新消息',
            is_user: false,
            is_system: false,
            send_date: '2026-11-06T10:02:00.000Z',
          },
        ],
      });
      resolveReopen('opened');
    });

    await waitFor(() => {
      expect(document.querySelectorAll('[data-vc-chat-msg]').length).toBe(3);
      expect(document.body.textContent).toContain('对账后的实时新消息');
    });

    // 4. Simulate IndexedDB throwing on both read and write: fallback to memory cache must not throw
    idbBroken = true;
    await expect(
      writeCachedConversationTail(
        tailCache,
        {
          ...bridge.getCurrentSnapshot(),
          messages: [
            ...bridge.getCurrentSnapshot().messages,
            {
              key: 'm-13',
              index: 3,
              name: '你',
              mes: '仅内存回退消息',
              is_user: true,
              is_system: false,
            },
          ],
        },
        bridge.draft.storageId,
      ),
    ).resolves.toBeUndefined();

    const memoryFallback = await readCachedConversationTail(
      tailCache,
      keyLinxi,
      bridge.draft.storageId,
    );
    expect(memoryFallback?.messages.map((m) => m.mes)).toContain('仅内存回退消息');

    unmount2();
  });

  it('ignores late bridge.open results (superseded or stale conversationKey) when user switches conversations', async () => {
    const keyA = '["alice.png","chat-alice"]';
    const keyB = '["bob.png","chat-bob"]';
    const tailCache = createChatTailCache();

    let resolveOpenA!: (value: OpenResult) => void;
    let resolveOpenB!: (value: OpenResult) => void;

    const bridge = createMockSessionBridge({
      status: 'switching',
      key: '',
      messages: [],
    });

    bridge.open = vi.fn((rowOrKey: any) => {
      const key = typeof rowOrKey === 'string' ? rowOrKey : rowOrKey?.key || '';
      if (key === keyA) {
        return new Promise<OpenResult>((resolve) => {
          resolveOpenA = resolve;
        });
      }
      return new Promise<OpenResult>((resolve) => {
        resolveOpenB = resolve;
      });
    });

    const client = createMockClient();
    const queryClient = createQueryClient();

    // Start opening conversation A
    const { rerender } = render(
      <AppProviders client={client} queryClient={queryClient} sessionBridge={bridge}>
        <MobileConversation conversationKey={keyA} tailCache={tailCache} />
      </AppProviders>,
    );

    // Switch to conversation B before A's open resolves
    rerender(
      <AppProviders client={client} queryClient={queryClient} sessionBridge={bridge}>
        <MobileConversation conversationKey={keyB} tailCache={tailCache} />
      </AppProviders>,
    );

    // Conversation B finishes opening first
    await act(async () => {
      bridge.publish({
        status: 'ready',
        busy: false,
        canSend: true,
        key: keyB,
        characterName: '鲍勃',
        avatar: 'bob.png',
        avatarUrl: '/thumbnail?type=avatar&file=bob.png',
        messages: [
          {
            key: 'bob-1',
            index: 0,
            name: '鲍勃',
            mes: '我是鲍勃的当前会话消息',
            is_user: false,
            is_system: false,
          },
        ],
      });
      resolveOpenB('opened');
    });

    await waitFor(() => {
      expect(document.body.textContent).toContain('我是鲍勃的当前会话消息');
      expect(document.querySelector('[data-vc-identity-capsule]')?.textContent).toContain('鲍勃');
    });

    // Now conversation A's delayed open resolves with 'superseded'
    await act(async () => {
      resolveOpenA('superseded');
    });

    // Current conversation B must NOT be overwritten by A
    expect(document.body.textContent).toContain('我是鲍勃的当前会话消息');
    expect(document.querySelector('[data-vc-identity-capsule]')?.textContent).toContain('鲍勃');
    expect(readCachedConversationTailSync(tailCache, keyA, bridge.draft.storageId)).toBeNull();
    expect(
      readCachedConversationTailSync(tailCache, keyB, bridge.draft.storageId)?.characterName,
    ).toBe('鲍勃');
  });

  it('auto-saves and restores draft across leaving/re-entering, switches between send and stop during streaming, retains input text and shows retry on send failure, and hides the + button', async () => {
    const keyLinxi = '["linxi.png","chat-linxi"]';
    const bridge = createMockSessionBridge({
      status: 'ready',
      busy: false,
      canSend: true,
      key: keyLinxi,
      characterName: '林夕',
      avatar: 'linxi.png',
      avatarUrl: '/thumbnail?type=avatar&file=linxi.png',
      messages: [
        {
          key: 'm-1',
          index: 0,
          name: '林夕',
          mes: '今天过得怎么样？',
          is_user: false,
          is_system: false,
        },
      ],
    });
    const client = createMockClient();
    const queryClient = createQueryClient();

    // 1. Enter conversation, type a draft without sending, then leave (unmount)
    const { unmount } = render(
      <AppProviders client={client} queryClient={queryClient} sessionBridge={bridge}>
        <MobileConversation conversationKey={keyLinxi} />
      </AppProviders>,
    );

    // Verify no fake "+" button is rendered
    expect(document.querySelector('[data-vc-composer-plus]')).toBeNull();

    const textarea = screen.getByRole('textbox', { name: '输入消息' }) as HTMLTextAreaElement;
    expect(textarea.value).toBe('');
    // Send button is stably mounted in the action slot and disabled when draft is empty
    const initialSendBtn = document.querySelector('[data-vc-composer-send]') as HTMLButtonElement;
    expect(initialSendBtn).toBeTruthy();
    expect(initialSendBtn.disabled).toBe(true);
    expect(document.querySelector('[data-vc-composer-stop]')).toBeNull();

    fireEvent.change(textarea, { target: { value: '离开前写了一半的草稿' } });
    expect(bridge.draft.read(keyLinxi)).toBe('离开前写了一半的草稿');
    // After typing text, the exact same send button node remains mounted and becomes enabled
    const afterTypeSendBtn = document.querySelector('[data-vc-composer-send]') as HTMLButtonElement;
    expect(afterTypeSendBtn).toBe(initialSendBtn);
    expect(afterTypeSendBtn.isConnected).toBe(true);
    expect(afterTypeSendBtn.disabled).toBe(false);

    unmount();

    // 2. Re-enter conversation: draft is restored into the textarea
    render(
      <AppProviders client={client} queryClient={queryClient} sessionBridge={bridge}>
        <MobileConversation conversationKey={keyLinxi} />
      </AppProviders>,
    );

    const restoredTextarea = screen.getByRole('textbox', { name: '输入消息' }) as HTMLTextAreaElement;
    expect(restoredTextarea.value).toBe('离开前写了一半的草稿');

    // 3. Simulate send failure (session.js onTakeDraft -> save fails -> onRestoreDraft + notice):
    // text MUST be retained in the input box AND retryable status shown
    bridge.send = vi.fn(async (_text: string, opts?: { draftInput?: string | null }) => {
      if (opts?.draftInput) {
        bridge.draft.write(keyLinxi, opts.draftInput);
      }
      bridge.publish({
        busy: false,
        notice: '没有发送成功',
      });
      return false;
    });

    await act(async () => {
      fireEvent.click(document.querySelector('[data-vc-composer-send]') as HTMLElement);
    });

    expect(restoredTextarea.value).toBe('离开前写了一半的草稿');
    expect(bridge.draft.read(keyLinxi)).toBe('离开前写了一半的草稿');
    const retryBtn = document.querySelector('[data-vc-chat-retry]') as HTMLElement;
    expect(retryBtn).toBeTruthy();

    await act(async () => {
      fireEvent.click(retryBtn);
    });
    expect(bridge.retry).toHaveBeenCalledTimes(1);

    // 4. Simulate streaming generation -> shows streaming text and Stop button in the same button slot; clicking Stop calls bridge.stop()
    const actionBtnBeforeStream = document.querySelector(
      '.vc-mobile-composer-action-btn',
    ) as HTMLButtonElement;
    await act(async () => {
      bridge.publish({
        busy: true,
        phase: 'streaming',
        messages: [
          ...bridge.getCurrentSnapshot().messages,
          {
            key: 'm-stream',
            index: 1,
            name: '林夕',
            mes: '正在流式生成中的半截回复……',
            is_user: false,
            is_system: false,
          },
        ],
      });
    });

    expect(document.body.textContent).toContain('正在流式生成中的半截回复……');
    const stopBtn = document.querySelector('[data-vc-composer-stop]') as HTMLButtonElement;
    expect(stopBtn).toBe(actionBtnBeforeStream);

    await act(async () => {
      fireEvent.click(stopBtn);
    });
    expect(bridge.stop).toHaveBeenCalledTimes(1);
  });

  it('wires MobileConversation into MobileApp default slots.chatDetail when navigating from MobileChatList to /m/chat/:conversationKey', async () => {
    const keyLinxi = '["linxi.png","chat-linxi"]';
    const nowMs = Date.now();
    const client = createMockClient();
    client.recent = vi.fn(async () => [
      {
        avatar: 'linxi.png',
        file_id: 'chat-linxi',
        mes: '点击进入对话页',
        last_mes: nowMs - 10_000,
        chat_metadata: {
          vc_binding: { relationshipId: 'rel-linxi', characterRef: 'char:linxi' },
        },
      },
    ]);
    client.characters = vi.fn(async () => [
      { name: '林夕', avatar: 'linxi.png', data: { extensions: { vc_character_ref: 'char:linxi' } } },
    ]);
    client.go.fetchRelationships = vi.fn(async () => [
      { relationshipId: 'rel-linxi', displayName: '林夕' },
    ]);

    const bridge = createMockSessionBridge({
      status: 'ready',
      canSend: true,
      key: keyLinxi,
      characterName: '林夕',
      avatar: 'linxi.png',
      avatarUrl: '/thumbnail?type=avatar&file=linxi.png',
      messages: [
        {
          key: 'm-1',
          index: 0,
          name: '林夕',
          mes: '欢迎进入手机对话页',
          is_user: false,
          is_system: false,
        },
      ],
    });
    const queryClient = createQueryClient();

    render(
      <MobileApp
        client={client}
        queryClient={queryClient}
        sessionBridge={bridge}
        initialPath="/m/chat"
      />,
    );

    await waitFor(() => {
      expect(document.querySelectorAll('[data-vc-mobile-convo-row]').length).toBe(1);
    });

    await act(async () => {
      fireEvent.click(document.querySelector('[data-vc-mobile-convo-row]') as HTMLElement);
    });

    await waitFor(() => {
      expect(window.location.pathname).toBe(`/m/chat/${encodeURIComponent(keyLinxi)}`);
      expect(document.querySelector('[data-vc-mobile-conversation]')).toBeTruthy();
      expect(document.body.textContent).toContain('欢迎进入手机对话页');
    });
  });

  it('virtualizes long message lists via react-virtuoso (only mounting visible window items) and shows 回到底部 button when scrolled away from bottom', async () => {
    const keyLong = '["linxi.png","chat-long"]';
    const baseMs = Date.parse('2026-11-06T10:00:00.000Z');
    const sixtyMessages: ChatMessage[] = Array.from({ length: 60 }, (_, idx) => ({
      key: `msg-${idx + 1}`,
      index: idx,
      name: idx % 2 === 0 ? '林夕' : '你',
      mes: `第 ${idx + 1} 条长会话消息`,
      is_user: idx % 2 === 1,
      is_system: false,
      send_date: new Date(baseMs + idx * 30_000).toISOString(),
    }));

    const bridge = createMockSessionBridge({
      status: 'ready',
      canSend: true,
      key: keyLong,
      characterName: '林夕',
      avatar: 'linxi.png',
      avatarUrl: '/thumbnail?type=avatar&file=linxi.png',
      messages: sixtyMessages,
    });
    const client = createMockClient();
    const queryClient = createQueryClient();

    render(
      <AppProviders client={client} queryClient={queryClient} sessionBridge={bridge}>
        <MobileConversation conversationKey={keyLong} now={() => baseMs + 60 * 30_000} />
      </AppProviders>,
    );

    const mountedNodes = document.querySelectorAll('[data-vc-chat-msg]');
    // Only the bottom window (<= 20 items) is mounted in DOM, never all 60 items
    expect(mountedNodes.length).toBeGreaterThan(0);
    expect(mountedNodes.length).toBeLessThanOrEqual(20);
    // And the last message (第 60 条长会话消息) is mounted at the bottom
    expect(document.body.textContent).toContain('第 60 条长会话消息');
    expect(document.body.textContent).not.toContain('第 1 条长会话消息');

    // Simulate user scrolling up away from the bottom via Virtuoso's scroll container
    const scroller = document.querySelector('[data-vc-chat-virtuoso]') as HTMLElement;
    expect(scroller).toBeTruthy();
    Object.defineProperty(scroller, 'scrollHeight', { value: 2400, configurable: true });
    Object.defineProperty(scroller, 'scrollTop', { value: 200, configurable: true, writable: true });

    await act(async () => {
      fireEvent.scroll(scroller);
    });

    await waitFor(() => {
      const scrollBottomBtn = document.querySelector('[data-vc-scroll-bottom]') as HTMLElement;
      expect(scrollBottomBtn).toBeTruthy();
      expect(scrollBottomBtn.textContent).toContain('回到底部');
    });

    // Clicking "回到底部" scrolls back to bottom and hides the button
    await act(async () => {
      fireEvent.click(document.querySelector('[data-vc-scroll-bottom]') as HTMLElement);
    });
    expect(document.querySelector('[data-vc-scroll-bottom]')).toBeNull();
  });

  it('keeps [data-vc-composer-send] as a stable DOM node across typing, cached phase, and snapshot updates without detaching', async () => {
    const keyLinxi = '["linxi.png","chat-linxi"]';
    const tailCache = createChatTailCache();

    let resolveOpen!: (value: OpenResult) => void;
    const bridge = createMockSessionBridge({
      status: 'switching',
      key: '',
      canSend: false,
      messages: [],
    });
    await writeCachedConversationTail(
      tailCache,
      {
        ...DEFAULT_CHAT_SNAPSHOT,
        status: 'ready',
        key: keyLinxi,
        characterName: '林夕',
        avatar: 'linxi.png',
        avatarUrl: '/thumbnail?type=avatar&file=linxi.png',
        messages: [
          {
            key: 'm-1',
            index: 0,
            name: '林夕',
            mes: '缓存阶段的问候',
            is_user: false,
            is_system: false,
          },
        ],
      },
      bridge.draft.storageId,
    );
    bridge.draft.write(keyLinxi, '缓存阶段预存草稿');
    bridge.open = vi.fn(
      () =>
        new Promise<OpenResult>((resolve) => {
          resolveOpen = resolve;
        }),
    );

    const client = createMockClient();
    const queryClient = createQueryClient();

    render(
      <AppProviders client={client} queryClient={queryClient} sessionBridge={bridge}>
        <MobileConversation conversationKey={keyLinxi} tailCache={tailCache} />
      </AppProviders>,
    );

    const textarea = screen.getByRole('textbox', { name: '输入消息' }) as HTMLTextAreaElement;
    // While still in cached phase (not yet live), shows bridge.draft.read(conversationKey) but forbids sending
    expect(textarea.value).toBe('缓存阶段预存草稿');
    const sendBtnBefore = document.querySelector('[data-vc-composer-send]') as HTMLButtonElement;
    expect(sendBtnBefore).toBeTruthy();
    expect(sendBtnBefore.disabled).toBe(true);

    // User types new text while session is still opening
    fireEvent.change(textarea, { target: { value: '输入文字后发送按钮稳定存在' } });
    expect(textarea.value).toBe('输入文字后发送按钮稳定存在');
    expect(bridge.draft.read(keyLinxi)).toBe('输入文字后发送按钮稳定存在');
    expect(document.querySelector('[data-vc-composer-send]')).toBe(sendBtnBefore);
    expect(sendBtnBefore.isConnected).toBe(true);
    expect(sendBtnBefore.disabled).toBe(true);

    // Snapshot transitions to ready & canSend=true
    await act(async () => {
      bridge.publish({
        status: 'ready',
        key: keyLinxi,
        canSend: true,
        busy: false,
        characterName: '林夕',
        avatar: 'linxi.png',
        avatarUrl: '/thumbnail?type=avatar&file=linxi.png',
        messages: [
          {
            key: 'm-1',
            index: 0,
            name: '林夕',
            mes: '缓存阶段的问候',
            is_user: false,
            is_system: false,
          },
        ],
      });
      resolveOpen('opened');
    });

    const sendBtnAfterReady = document.querySelector('[data-vc-composer-send]') as HTMLButtonElement;
    expect(sendBtnAfterReady).toBe(sendBtnBefore);
    expect(sendBtnAfterReady.isConnected).toBe(true);
    expect(sendBtnAfterReady.disabled).toBe(false);
    expect(textarea.value).toBe('输入文字后发送按钮稳定存在');
  });

  it('maintains identical bubble structure and keeps reading position pinned at the bottom without jumping when transitioning from cached phase to live snapshot', async () => {
    const keyLinxi = '["linxi.png","chat-linxi"]';
    const tailCache = createChatTailCache();
    const baseMs = Date.parse('2026-11-06T12:00:00.000Z');
    const twentyMessages: ChatMessage[] = Array.from({ length: 20 }, (_, idx) => ({
      key: `cached-key-${idx}`,
      index: idx,
      name: idx % 2 === 0 ? '林夕' : '你',
      mes: `第 ${idx + 1} 条消息内容`,
      is_user: idx % 2 === 1,
      is_system: false,
      send_date: new Date(baseMs + idx * 60_000).toISOString(),
    }));

    let resolveOpen!: (value: OpenResult) => void;
    const bridge = createMockSessionBridge({
      status: 'switching',
      key: '',
      canSend: false,
      messages: [],
    });

    await writeCachedConversationTail(
      tailCache,
      {
        ...DEFAULT_CHAT_SNAPSHOT,
        status: 'ready',
        key: keyLinxi,
        characterName: '林夕',
        avatar: 'linxi.png',
        avatarUrl: '/thumbnail?type=avatar&file=linxi.png',
        messages: twentyMessages,
      },
      bridge.draft.storageId,
    );

    bridge.open = vi.fn(
      () =>
        new Promise<OpenResult>((resolve) => {
          resolveOpen = resolve;
        }),
    );

    const client = createMockClient();
    const queryClient = createQueryClient();

    render(
      <AppProviders client={client} queryClient={queryClient} sessionBridge={bridge}>
        <MobileConversation conversationKey={keyLinxi} tailCache={tailCache} />
      </AppProviders>,
    );

    // In cached phase: renders plain text inside .vc-mobile-bubble-leaf > .vc-desktop-message-content > .mes_text
    const convoRoot = document.querySelector('[data-vc-mobile-conversation]') as HTMLElement;
    expect(convoRoot.getAttribute('data-vc-conversation-from-cache')).toBe('true');
    expect(convoRoot.getAttribute('data-vc-conversation-ready')).toBe('false');
    expect(bridge.mountLeaf).not.toHaveBeenCalled();

    const scroller = document.querySelector('[data-vc-chat-virtuoso]') as HTMLElement;
    const scrollTopDuringCache = scroller.scrollTop;
    expect(document.body.textContent).toContain('第 20 条消息内容');
    expect(document.querySelector('[data-vc-scroll-bottom]')).toBeNull();

    const lastBubbleBefore = Array.from(document.querySelectorAll('[data-vc-bubble]')).at(-1) as HTMLElement;
    expect(lastBubbleBefore.querySelector('.vc-desktop-message-content > .mes_text')?.textContent).toBe(
      '第 20 条消息内容',
    );

    // Transition to live snapshot where session.js generated new ephemeral message keys for the same messages
    await act(async () => {
      bridge.publish({
        status: 'ready',
        key: keyLinxi,
        canSend: true,
        busy: false,
        characterName: '林夕',
        avatar: 'linxi.png',
        avatarUrl: '/thumbnail?type=avatar&file=linxi.png',
        messages: twentyMessages.map((m, idx) => ({
          ...m,
          key: `live-ephemeral-seq-${idx + 100}`,
        })),
      });
      resolveOpen('opened');
    });

    expect(convoRoot.getAttribute('data-vc-conversation-from-cache')).toBe('false');
    expect(convoRoot.getAttribute('data-vc-conversation-ready')).toBe('true');
    expect(bridge.mountLeaf).toHaveBeenCalled();

    const lastBubbleAfter = Array.from(document.querySelectorAll('[data-vc-bubble]')).at(-1) as HTMLElement;
    // The bubble wrapper DOM node is preserved (not unmounted/remounted) and reading position stays at bottom
    expect(lastBubbleAfter).toBe(lastBubbleBefore);
    expect(lastBubbleAfter.querySelector('.vc-desktop-message-content > .mes_text')?.textContent).toBe(
      '第 20 条消息内容',
    );
    expect(scroller.scrollTop).toBe(scrollTopDuringCache);
    expect(document.querySelector('[data-vc-scroll-bottom]')).toBeNull();
  });

  it('stores conversation metadata only in StoredMessagePage.chat with null cursors and isolates cache keys by account scope', async () => {
    const keyLinxi = '["linxi.png","chat-linxi"]';
    const tailCache = createChatTailCache();
    const bridgeAccountA = createMockSessionBridge(
      {
        status: 'ready',
        key: keyLinxi,
        characterName: '账号A的林夕',
        avatar: 'linxi.png',
        avatarUrl: '/thumbnail?type=avatar&file=linxi.png',
        relationshipId: 'rel-acc-a',
        conversationId: 'conv-acc-a',
        messages: [
          {
            key: 'msg-a-1',
            index: 0,
            name: '林夕',
            mes: '账号A的私密聊天记录',
            is_user: false,
            is_system: false,
            extra: { model: 'gpt-test' },
          },
        ],
      },
      { accountId: 'account-A' },
    );

    const pageA = snapshotToStoredTailPage(
      bridgeAccountA.getSnapshot(),
      30,
      'epoch-1',
      bridgeAccountA.draft.storageId,
    );
    expect(pageA).toBeTruthy();
    // Cursors must be null (never messageId)
    expect(pageA?.beforeCursor).toBeNull();
    expect(pageA?.afterCursor).toBeNull();
    // Metadata must only live in page.chat, never injected into items[0].extra
    expect(pageA?.chat?.characterName).toBe('账号A的林夕');
    expect(pageA?.chat?.relationshipId).toBe('rel-acc-a');
    expect(pageA?.items[0].extra).toEqual({ model: 'gpt-test' });
    expect((pageA?.items[0].extra as any)?.__vc_mobile_meta).toBeUndefined();

    // Write cache under Account A
    await writeCachedConversationTail(
      tailCache,
      bridgeAccountA.getSnapshot(),
      bridgeAccountA.draft.storageId,
    );

    // Account A reads its own cached tail
    const readA = readCachedConversationTailSync(
      tailCache,
      keyLinxi,
      bridgeAccountA.draft.storageId,
    );
    expect(readA?.characterName).toBe('账号A的林夕');
    expect(readA?.messages[0].mes).toBe('账号A的私密聊天记录');

    // Switch to Account B on the same device sharing the same tailCache instance
    const bridgeAccountB = createMockSessionBridge(
      {
        status: 'switching',
        key: '',
        messages: [],
      },
      { accountId: 'account-B' },
    );
    expect(
      resolveConversationCacheKey(keyLinxi, bridgeAccountA.draft.storageId),
    ).not.toBe(resolveConversationCacheKey(keyLinxi, bridgeAccountB.draft.storageId));

    // Account B must NOT see Account A's cached conversation tail
    expect(
      readCachedConversationTailSync(tailCache, keyLinxi, bridgeAccountB.draft.storageId),
    ).toBeNull();
    expect(
      await readCachedConversationTail(tailCache, keyLinxi, bridgeAccountB.draft.storageId),
    ).toBeNull();
  });

  it('hides skeleton and shows retryable error notice when bridge.open fails on an uncached conversation, and updates MobileApp chat list draft preview when bridge.draft.write emits without refetching recentChats', async () => {
    const keyLinxi = '["linxi.png","chat-linxi"]';
    const tailCache = createChatTailCache();
    const bridge = createMockSessionBridge({
      status: 'switching',
      key: '',
      messages: [],
    });

    let openAttempts = 0;
    bridge.open = vi.fn(async () => {
      openAttempts += 1;
      if (openAttempts === 1) {
        bridge.publish({
          status: 'error',
          key: '',
          error: '聊天没有加载出来，请重试。',
          messages: [],
        });
        return 'failed';
      }
      bridge.publish({
        status: 'ready',
        key: keyLinxi,
        canSend: true,
        busy: false,
        error: null,
        characterName: '林夕',
        avatar: 'linxi.png',
        avatarUrl: '/thumbnail?type=avatar&file=linxi.png',
        messages: [
          {
            key: 'm-ok-1',
            index: 0,
            name: '林夕',
            mes: '重试后成功打开会话',
            is_user: false,
            is_system: false,
          },
        ],
      });
      return 'opened';
    });
    bridge.retry = vi.fn(async () => false);

    const client = createMockClient();
    const nowMs = Date.now();
    client.recent = vi.fn(async () => [
      {
        avatar: 'linxi.png',
        file_id: 'chat-linxi',
        mes: '初始摘要',
        last_mes: nowMs - 5_000,
        chat_metadata: {
          vc_binding: { relationshipId: 'rel-linxi', characterRef: 'char:linxi' },
        },
      },
    ]);
    client.characters = vi.fn(async () => [
      { name: '林夕', avatar: 'linxi.png', data: { extensions: { vc_character_ref: 'char:linxi' } } },
    ]);
    client.go.fetchRelationships = vi.fn(async () => [
      { relationshipId: 'rel-linxi', displayName: '林夕' },
    ]);
    const queryClient = createQueryClient();

    const { unmount } = render(
      <AppProviders client={client} queryClient={queryClient} sessionBridge={bridge}>
        <MobileConversation conversationKey={keyLinxi} tailCache={tailCache} />
      </AppProviders>,
    );

    await waitFor(() => {
      expect(document.querySelector('[data-vc-chat-skeleton]')).toBeNull();
      expect(document.querySelector('[data-vc-chat-error]')?.textContent).toContain(
        '聊天没有加载出来，请重试。',
      );
    });

    await act(async () => {
      fireEvent.click(document.querySelector('[data-vc-chat-retry]') as HTMLElement);
    });

    await waitFor(() => {
      expect(document.querySelector('[data-vc-chat-error]')).toBeNull();
      expect(document.body.textContent).toContain('重试后成功打开会话');
    });

    unmount();

    // Verify MobileApp chat list recomputes draft preview when bridge.draft.write emits without refetching
    render(
      <MobileApp
        client={client}
        queryClient={queryClient}
        sessionBridge={bridge}
        initialPath="/m/chat"
      />,
    );

    await waitFor(() => {
      expect(document.querySelector('[data-vc-mobile-convo-row]')?.textContent).toContain(
        '初始摘要',
      );
    });

    await act(async () => {
      bridge.draft.write(keyLinxi, '实时更新的草稿预览');
    });

    await waitFor(() => {
      expect(document.querySelector('[data-vc-mobile-convo-row]')?.textContent).toContain(
        '草稿：实时更新的草稿预览',
      );
    });
  });

  it('shows [data-vc-composer-stop] and stops generation on consecutive send when post-merge bridge publishes busy=false/canSend=true before previous send promise settles', async () => {
    const keyLinxi = '["林夕MB2_6cfc4b.png","MB2-chat-stop"]';
    const bridge = createMockSessionBridge({
      status: 'ready',
      canSend: true,
      busy: false,
      streamingKey: null,
      key: keyLinxi,
      characterName: '林夕',
      avatar: '林夕MB2_6cfc4b.png',
      avatarUrl: '/thumbnail?type=avatar&file=%E6%9E%97%E5%A4%95MB2_6cfc4b.png',
      messages: [
        {
          key: `${keyLinxi}:2026-11-07T00:00:00.000Z:0:1`,
          index: 0,
          name: '林夕',
          mes: '欢迎回家，今天累不累？',
          is_user: false,
          is_system: false,
          send_date: '2026-11-07T00:00:00.000Z',
        },
      ],
    });

    let resolveFirstSendPostHook!: (value: boolean) => void;
    let sendCallCount = 0;

    bridge.send = vi.fn((text: string, sendOpts?: { draftInput?: string | null }) => {
      sendCallCount += 1;
      const draftInput = sendOpts?.draftInput !== undefined ? sendOpts.draftInput : text;
      if (draftInput && bridge.draft.read(keyLinxi) === draftInput) {
        bridge.draft.write(keyLinxi, '');
      }

      if (sendCallCount === 1) {
        const userMsg: ChatMessage = {
          key: `${keyLinxi}:2026-11-07T00:00:01.000Z:1:2`,
          index: 1,
          name: '你',
          mes: text,
          is_user: true,
          is_system: false,
          send_date: '2026-11-07T00:00:01.000Z',
        };
        const streamReplyKey = `${keyLinxi}:2026-11-07T00:00:02.000Z:2:3`;
        const replyMsg: ChatMessage = {
          key: streamReplyKey,
          index: 2,
          name: '林夕',
          mes: '测试流式回复：今晚的姜茶已经煮好了，趁热喝一杯吧。',
          is_user: false,
          is_system: false,
          send_date: '2026-11-07T00:00:02.000Z',
        };
        // 1) User message appended -> busy=true, canSend=false, streamingKey=null
        bridge.publish({
          status: 'ready',
          key: keyLinxi,
          busy: true,
          canSend: false,
          streamingKey: null,
          messages: [...bridge.getCurrentSnapshot().messages, userMsg],
        });
        // 2) Streaming reply chunk -> busy=true, canSend=false, streamingKey=streamReplyKey
        bridge.publish({
          status: 'ready',
          key: keyLinxi,
          busy: true,
          canSend: false,
          streamingKey: streamReplyKey,
          messages: [...bridge.getCurrentSnapshot().messages, replyMsg],
        });
        // 3) Post-merge session.js clears job=null before GENERATION_ENDED finishes, and intermediate saveChat()
        // publishes busy=false, canSend=true, streamingKey=null while bridge.send() promise is still awaiting
        // post-stream source reconciliation.
        bridge.publish({
          status: 'ready',
          key: keyLinxi,
          busy: false,
          canSend: true,
          streamingKey: null,
        });
        return new Promise<boolean>((resolve) => {
          resolveFirstSendPostHook = resolve;
        });
      }

      // Second turn: user sends message and stops mid-stream
      const userMsg2: ChatMessage = {
        key: `${keyLinxi}:2026-11-07T00:00:03.000Z:3:4`,
        index: 3,
        name: '你',
        mes: text,
        is_user: true,
        is_system: false,
        send_date: '2026-11-07T00:00:03.000Z',
      };
      const streamReplyKey2 = `${keyLinxi}:2026-11-07T00:00:04.000Z:4:5`;
      const partialReplyMsg2: ChatMessage = {
        key: streamReplyKey2,
        index: 4,
        name: '林夕',
        mes: '测试中途停止：窗外的风声渐渐小了，慢慢聊着今天发生的事。',
        is_user: false,
        is_system: false,
        send_date: '2026-11-07T00:00:04.000Z',
      };
      bridge.publish({
        status: 'ready',
        key: keyLinxi,
        busy: true,
        canSend: false,
        streamingKey: streamReplyKey2,
        messages: [...bridge.getCurrentSnapshot().messages, userMsg2, partialReplyMsg2],
      });
      return Promise.resolve(true);
    });

    const client = createMockClient();
    const queryClient = createQueryClient();

    render(
      <AppProviders client={client} queryClient={queryClient} sessionBridge={bridge}>
        <MobileConversation conversationKey={keyLinxi} />
      </AppProviders>,
    );

    const textarea = screen.getByRole('textbox', { name: '输入消息' }) as HTMLTextAreaElement;

    // Step 3 equivalent: send first message
    fireEvent.change(textarea, { target: { value: '测试：我换好衣服啦' } });
    await act(async () => {
      fireEvent.click(document.querySelector('[data-vc-composer-send]') as HTMLElement);
    });

    expect(document.body.textContent).toContain('今晚的姜茶已经煮好了，趁热喝一杯吧。');
    expect(document.querySelector('[data-vc-composer-stop]')).toBeNull();
    expect(textarea.value).toBe('');

    // Step 4 equivalent: immediately type and send second message while first send's post-hook promise is still pending
    fireEvent.change(textarea, { target: { value: '测试：继续讲讲今天的事' } });
    const sendBtnTurn2 = document.querySelector('[data-vc-composer-send]') as HTMLButtonElement;
    expect(sendBtnTurn2).toBeTruthy();
    expect(sendBtnTurn2.disabled).toBe(false);

    await act(async () => {
      fireEvent.click(sendBtnTurn2);
    });

    // Stop button MUST be visible during Turn 2 streaming
    const stopBtn = document.querySelector('[data-vc-composer-stop]') as HTMLButtonElement;
    expect(stopBtn).toBeTruthy();
    expect(document.body.textContent).toContain('窗外的风声渐渐小了');

    // First send's post-hook promise settling late must not break Turn 2
    await act(async () => {
      resolveFirstSendPostHook(true);
    });
    expect(document.querySelector('[data-vc-composer-stop]')).toBeTruthy();

    // Clicking Stop button stops generation and preserves partial streamed text
    await act(async () => {
      fireEvent.click(stopBtn);
    });
    expect(bridge.stop).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-vc-composer-stop]')).toBeNull();
    expect(document.body.textContent).toContain('窗外的风声渐渐小了');
  });
});
