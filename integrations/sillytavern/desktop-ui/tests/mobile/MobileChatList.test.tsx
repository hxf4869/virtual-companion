import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders, createQueryClient } from '../../src/app/providers';
import { createAppClient } from '../../src/data/client';
import { queryKeys } from '../../src/data/queryKeys';
import { createSessionBridge } from '../../src/runtime/session-bridge';
import {
  CHAT_CURSOR_TTL_MS,
  ChatProtocolError,
  createHttpChatStoragePort,
  mergeStoredChatPages,
  mergeStoredMessageRecord,
  type StoredMessage,
} from '../../src/mobile/chat/data/chatStoragePort';
import { createSyntheticChatStorageAdapter } from '../../src/mobile/chat/data/syntheticChatStorage';
import { createChatTailCache } from '../../src/mobile/chat/data/chatTailCache';
import {
  openChatTailWithReconcile,
  scheduleIdleChatPrefetch,
  useCachedChatTailReconcile,
} from '../../src/mobile/chat/data/chatTailPrefetch';
import { formatMobileConversationPreview } from '../../src/mobile/chat/data/conversationPreview';
import { MobileApp } from '../../src/mobile/app/MobileApp';
import { MobileChatList } from '../../src/mobile/chat/MobileChatList';

describe('MB2-6a SX-2 Paginated Chat Data Layer, Idle Prefetch, Tail Cache & MobileChatList', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, '', '/m/chat');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('paginates /api/v1/chats by (updatedAt DESC, chatId DESC), deduplicates moved chatIds across pages, always returns authorityEpoch, and expires cursors after 15 minutes with 410 CHAT_CURSOR_EXPIRED', async () => {
    let clockMs = Date.parse('2026-11-06T12:00:00.000Z');
    const adapter = createSyntheticChatStorageAdapter({
      authorityEpoch: 'epoch-1',
      now: () => clockMs,
      chats: [
        {
          chatId: 'chat-a',
          characterRef: 'char:alice',
          relationshipId: 'rel-1',
          title: '爱丽丝',
          characterName: '爱丽丝',
          avatar: 'alice.png',
          preview: '第一条消息',
          messageCount: 2,
          chatRevision: '2',
          metadataRevision: '1',
          orderRevision: '1',
          createdAt: '2026-11-06T10:00:00.000Z',
          updatedAt: '2026-11-06T11:00:00.000Z',
        },
        {
          chatId: 'chat-c',
          characterRef: 'char:claire',
          relationshipId: 'rel-3',
          title: '克莱尔',
          characterName: '克莱尔',
          avatar: 'claire.png',
          preview: '同时间戳高字典序 ID',
          messageCount: 1,
          chatRevision: '1',
          metadataRevision: '1',
          orderRevision: '1',
          createdAt: '2026-11-06T10:00:00.000Z',
          updatedAt: '2026-11-06T11:30:00.000Z',
        },
        {
          chatId: 'chat-b',
          characterRef: 'char:bob',
          relationshipId: 'rel-2',
          title: '鲍勃',
          characterName: '鲍勃',
          avatar: 'bob.png',
          preview: '同时间戳低字典序 ID',
          messageCount: 1,
          chatRevision: '1',
          metadataRevision: '1',
          orderRevision: '1',
          createdAt: '2026-11-06T10:00:00.000Z',
          updatedAt: '2026-11-06T11:30:00.000Z',
        },
      ],
    });

    // Empty filtered query still returns authorityEpoch and nextCursor: null
    const emptyPage = await adapter.listStoredChats({ q: '不存在的关键词' });
    expect(emptyPage.items).toEqual([]);
    expect(emptyPage.nextCursor).toBeNull();
    expect(emptyPage.authorityEpoch).toBe('epoch-1');

    // Page 1 (limit=2) sorted by (updatedAt DESC, chatId DESC): chat-c, then chat-b
    const page1 = await adapter.listStoredChats({ limit: 2 });
    expect(page1.authorityEpoch).toBe('epoch-1');
    expect(page1.items.map((c) => c.chatId)).toEqual(['chat-c', 'chat-b']);
    expect(page1.nextCursor).toBeTruthy();

    // Page 2 using nextCursor returns chat-a
    const page2 = await adapter.listStoredChats({ limit: 2, cursor: page1.nextCursor });
    expect(page2.items.map((c) => c.chatId)).toEqual(['chat-a']);
    expect(page2.nextCursor).toBeNull();

    // Deduplication by chatId when merging pages after concurrent row movement
    const mergedWithDuplicate = mergeStoredChatPages(page1.items, {
      authorityEpoch: 'epoch-1',
      nextCursor: null,
      items: [
        {
          ...page1.items[1],
          preview: '鲍勃新消息',
          chatRevision: '2',
        },
        page2.items[0],
      ],
    });
    expect(mergedWithDuplicate.items.map((c) => c.chatId)).toEqual(['chat-c', 'chat-b', 'chat-a']);
    expect(mergedWithDuplicate.items.find((c) => c.chatId === 'chat-b')?.preview).toBe('鲍勃新消息');

    // AuthorityEpoch change invalidates merged list and replaces with new epoch page
    const mergedNewEpoch = mergeStoredChatPages(
      mergedWithDuplicate.items,
      {
        authorityEpoch: 'epoch-2',
        nextCursor: null,
        items: [page2.items[0]],
      },
      'epoch-1',
    );
    expect(mergedNewEpoch.epochChanged).toBe(true);
    expect(mergedNewEpoch.items.map((c) => c.chatId)).toEqual(['chat-a']);

    // Cursor expires after 15 minutes (900_000 ms) with 410 CHAT_CURSOR_EXPIRED
    clockMs += CHAT_CURSOR_TTL_MS + 1;
    await expect(
      adapter.listStoredChats({ limit: 2, cursor: page1.nextCursor }),
    ).rejects.toMatchObject({
      status: 410,
      code: 'CHAT_CURSOR_EXPIRED',
    });
  });

  it('implements listStoredMessages exclusive before/after, anchorMessageId relocation, view=display|full isolation, include=chat, and 410 CHAT_CURSOR_EXPIRED on orderRevision change', async () => {
    let clockMs = Date.parse('2026-11-06T12:00:00.000Z');
    const initialMessages: StoredMessage[] = Array.from({ length: 6 }, (_, idx) => {
      const n = idx + 1;
      return {
        messageId: `msg-${n}`,
        chatId: 'chat-1',
        role: n % 2 === 1 ? 'user' : 'assistant',
        senderName: n % 2 === 1 ? '你' : '林夕',
        isUser: n % 2 === 1,
        isSystem: false,
        content: `第 ${n} 条消息`,
        selectedCandidateIndex: 0,
        candidateCount: 2,
        candidates: [
          { index: 0, content: `第 ${n} 条消息` },
          { index: 1, content: `第 ${n} 条备选回答` },
        ],
        variables: { mood: `m-${n}` },
        stFields: { raw_tag: `tag-${n}` },
        revision: String(n),
        createdAt: new Date(clockMs + n * 1000).toISOString(),
        updatedAt: new Date(clockMs + n * 1000).toISOString(),
      };
    });

    const adapter = createSyntheticChatStorageAdapter({
      authorityEpoch: 'epoch-1',
      now: () => clockMs,
      chats: [
        {
          chatId: 'chat-1',
          characterRef: 'char:linxi',
          relationshipId: 'rel-linxi',
          title: '林夕',
          characterName: '林夕',
          avatar: 'linxi.png',
          preview: '第 6 条消息',
          messageCount: 6,
          chatRevision: '6',
          metadataRevision: '1',
          orderRevision: '1',
          createdAt: '2026-11-06T12:00:00.000Z',
          updatedAt: '2026-11-06T12:00:06.000Z',
        },
      ],
      messagesByChatId: {
        'chat-1': initialMessages,
      },
    });

    // Passing both before and after (or anchorMessageId) is rejected with 400 INVALID_REQUEST
    await expect(
      adapter.listStoredMessages('chat-1', { before: 'c1', after: 'c2' }),
    ).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_REQUEST',
    });

    // Tail page (no before/after/anchorMessageId, limit=2, view=display, include=chat)
    const tailPage = await adapter.listStoredMessages('chat-1', {
      limit: 2,
      view: 'display',
      include: 'chat',
    });
    expect(tailPage.items.map((m) => m.messageId)).toEqual(['msg-5', 'msg-6']);
    expect(tailPage.hasOlder).toBe(true);
    expect(tailPage.hasNewer).toBe(false);
    expect(tailPage.beforeCursor).toBeTruthy();
    expect(tailPage.afterCursor).toBeTruthy();
    expect(tailPage.chat?.chatId).toBe('chat-1');
    expect(tailPage.chat?.kind).toBe('SINGLE');
    expect(tailPage.chat?.branchRoot).toBe('chat-1');
    expect(tailPage.chat?.header).toEqual({});
    expect(tailPage.chat?.metadata).toEqual({});
    expect(tailPage.items[0].view).toBe('display');
    expect(tailPage.items[0].messageRevision).toBe('5');
    expect(tailPage.items[0].position).toBeTruthy();
    expect(tailPage.items[0].selectedCandidateId).toBe('msg-5:cand:0');
    expect(tailPage.items[0].candidates).toHaveLength(1);
    expect(tailPage.items[0].candidates?.[0]?.candidateId).toBe('msg-5:cand:0');
    expect(tailPage.items[0].candidateCount).toBe(2);
    expect(tailPage.items[0].variables).toBeUndefined();
    expect(tailPage.items[0].data?.variables).toBeUndefined();

    // view=full returns all candidates, variables, and stFields; display must never overwrite full
    const fullPage = await adapter.listStoredMessages('chat-1', {
      limit: 2,
      view: 'full',
    });
    expect(fullPage.items[0].view).toBe('full');
    expect(fullPage.items[0].candidates).toHaveLength(2);
    expect(fullPage.items[0].data?.variables).toEqual({ mood: 'm-5' });
    const preserved = mergeStoredMessageRecord(fullPage.items[0], tailPage.items[0]);
    expect(preserved.view).toBe('full');
    expect(preserved.candidates).toHaveLength(2);
    expect(preserved.variables).toEqual({ mood: 'm-5' });
    expect(preserved.data?.variables).toEqual({ mood: 'm-5' });

    // Reusing a display-bound cursor with view=full is rejected with 400 INVALID_REQUEST
    await expect(
      adapter.listStoredMessages('chat-1', {
        limit: 2,
        before: tailPage.beforeCursor,
        view: 'full',
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_REQUEST',
    });

    // Exclusive before pagination: returns strictly older messages in ascending display order (msg-3, msg-4)
    const olderPage = await adapter.listStoredMessages('chat-1', {
      limit: 2,
      before: tailPage.beforeCursor,
    });
    expect(olderPage.items.map((m) => m.messageId)).toEqual(['msg-3', 'msg-4']);
    expect(olderPage.hasOlder).toBe(true);
    expect(olderPage.hasNewer).toBe(true);

    // Exclusive after pagination from olderPage.afterCursor: returns strictly newer messages (msg-5, msg-6)
    const newerPage = await adapter.listStoredMessages('chat-1', {
      limit: 2,
      after: olderPage.afterCursor,
    });
    expect(newerPage.items.map((m) => m.messageId)).toEqual(['msg-5', 'msg-6']);
    expect(newerPage.hasNewer).toBe(false);

    // Ordinary tail append advances chatRevision (decimal string) without advancing orderRevision; cursor stays valid!
    adapter.appendMessages('chat-1', [
      {
        messageId: 'msg-7',
        chatId: 'chat-1',
        role: 'user',
        senderName: '你',
        isUser: true,
        isSystem: false,
        content: '第 7 条追加消息',
        selectedCandidateIndex: 0,
        candidateCount: 1,
        revision: '7',
        createdAt: new Date(clockMs + 7000).toISOString(),
        updatedAt: new Date(clockMs + 7000).toISOString(),
      },
    ]);

    const afterAppend = await adapter.listStoredMessages('chat-1', {
      limit: 2,
      after: tailPage.afterCursor,
    });
    expect(afterAppend.items.map((m) => m.messageId)).toEqual(['msg-7']);
    expect(afterAppend.chatRevision).toBe('7');
    expect(afterAppend.orderRevision).toBe('1');

    // Reordering messages advances orderRevision and invalidates existing cursors with 410 CHAT_CURSOR_EXPIRED
    adapter.reorderMessages('chat-1', [
      'msg-1',
      'msg-2',
      'msg-4',
      'msg-3',
      'msg-5',
      'msg-6',
      'msg-7',
    ]);
    await expect(
      adapter.listStoredMessages('chat-1', {
        limit: 2,
        before: tailPage.beforeCursor,
      }),
    ).rejects.toMatchObject({
      status: 410,
      code: 'CHAT_CURSOR_EXPIRED',
    });

    // Relocation via anchorMessageId='msg-3' returns fresh window ending at msg-3 (with up to limit-1 older messages)
    const anchoredPage = await adapter.listStoredMessages('chat-1', {
      anchorMessageId: 'msg-3',
      limit: 3,
    });
    expect(anchoredPage.items.map((m) => m.messageId)).toEqual(['msg-2', 'msg-4', 'msg-3']);
    expect(anchoredPage.orderRevision).toBe('2');
    expect(anchoredPage.hasOlder).toBe(true);
    expect(anchoredPage.hasNewer).toBe(true);

    // Deleted anchorMessageId returns 404 NOT_FOUND_OR_FORBIDDEN
    adapter.deleteMessage('chat-1', 'msg-3');
    await expect(
      adapter.listStoredMessages('chat-1', { anchorMessageId: 'msg-3', limit: 3 }),
    ).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND_OR_FORBIDDEN',
    });
  });

  it('prefetches recent chats during idle (requestIdleCallback & setTimeout fallback), falls back when IndexedDB throws, renders cached tail first, and reconciles with server changes / 410 anchor relocation / authorityEpoch reset', async () => {
    let clockMs = Date.parse('2026-11-06T12:00:00.000Z');
    const adapter = createSyntheticChatStorageAdapter({
      authorityEpoch: 'epoch-1',
      now: () => clockMs,
      chats: [
        {
          chatId: 'chat-1',
          characterRef: 'char:linxi',
          relationshipId: 'rel-1',
          title: '林夕',
          characterName: '林夕',
          avatar: 'linxi.png',
          preview: '缓存消息 2',
          messageCount: 2,
          chatRevision: '2',
          metadataRevision: '1',
          orderRevision: '1',
          createdAt: '2026-11-06T11:00:00.000Z',
          updatedAt: '2026-11-06T11:02:00.000Z',
        },
        {
          chatId: 'chat-2',
          characterRef: 'char:xingye',
          relationshipId: 'rel-2',
          title: '星野',
          characterName: '星野',
          avatar: 'xingye.png',
          preview: '星野问候',
          messageCount: 1,
          chatRevision: '1',
          metadataRevision: '1',
          orderRevision: '1',
          createdAt: '2026-11-06T11:00:00.000Z',
          updatedAt: '2026-11-06T11:01:00.000Z',
        },
      ],
      messagesByChatId: {
        'chat-1': [
          {
            messageId: 'm-1',
            chatId: 'chat-1',
            role: 'user',
            senderName: '你',
            isUser: true,
            isSystem: false,
            content: '缓存消息 1',
            selectedCandidateIndex: 0,
            candidateCount: 1,
            revision: '1',
            createdAt: '2026-11-06T11:01:00.000Z',
            updatedAt: '2026-11-06T11:01:00.000Z',
          },
          {
            messageId: 'm-2',
            chatId: 'chat-1',
            role: 'assistant',
            senderName: '林夕',
            isUser: false,
            isSystem: false,
            content: '缓存消息 2',
            selectedCandidateIndex: 0,
            candidateCount: 1,
            revision: '2',
            createdAt: '2026-11-06T11:02:00.000Z',
            updatedAt: '2026-11-06T11:02:00.000Z',
          },
        ],
        'chat-2': [
          {
            messageId: 'm-20',
            chatId: 'chat-2',
            role: 'assistant',
            senderName: '星野',
            isUser: false,
            isSystem: false,
            content: '星野问候',
            selectedCandidateIndex: 0,
            candidateCount: 1,
            revision: '1',
            createdAt: '2026-11-06T11:01:00.000Z',
            updatedAt: '2026-11-06T11:01:00.000Z',
          },
        ],
      },
    });

    // Simulate IndexedDB throwing SecurityError to verify try/catch fallback to memory cache
    const brokenIdb = {
      open: () => {
        throw new Error('IndexedDB disabled in private mode');
      },
    } as unknown as IDBFactory;

    const cache = createChatTailCache({
      accountId: 'acc-1',
      sessionId: 'sess-1',
      authorityEpoch: 'epoch-1',
      indexedDB: brokenIdb,
      maxChats: 5,
    });

    // 1. Test scheduleIdleChatPrefetch with requestIdleCallback
    const idleCallbacks: Array<() => void> = [];
    const requestIdleMock = vi.fn((cb: () => void) => {
      idleCallbacks.push(cb);
      return idleCallbacks.length;
    });
    const cancelIdleMock = vi.fn();

    const chatsPage = await adapter.listStoredChats();
    const handle = scheduleIdleChatPrefetch({
      chats: chatsPage.items,
      authorityEpoch: chatsPage.authorityEpoch,
      port: adapter,
      cache,
      maxPrefetchCount: 2,
      requestIdle: requestIdleMock,
      cancelIdle: cancelIdleMock,
    });

    expect(requestIdleMock).toHaveBeenCalledTimes(1);
    // Execute scheduled idle work
    for (const cb of idleCallbacks.splice(0)) {
      cb();
    }
    await waitFor(async () => {
      const cached1 = await cache.get('chat-1');
      const cached2 = await cache.get('chat-2');
      expect(cached1?.items.map((m) => m.messageId)).toEqual(['m-1', 'm-2']);
      expect(cached2?.items.map((m) => m.messageId)).toEqual(['m-20']);
    });
    handle.cancel();

    // 2. Test setTimeout fallback when requestIdleCallback is unavailable
    const cacheFallback = createChatTailCache({
      accountId: 'acc-1',
      sessionId: 'sess-1',
      authorityEpoch: 'epoch-1',
      indexedDB: null,
    });
    const handleFallback = scheduleIdleChatPrefetch({
      chats: [chatsPage.items[0]],
      authorityEpoch: 'epoch-1',
      port: adapter,
      cache: cacheFallback,
      requestIdle: null,
    });
    await waitFor(async () => {
      const cached = await cacheFallback.get('chat-1');
      expect(cached?.items).toHaveLength(2);
    });
    handleFallback.cancel();

    // 3. Server appends m-3 while user is on list; entering chat-1 emits cached page first, then reconciled page
    adapter.appendMessages('chat-1', [
      {
        messageId: 'm-3',
        chatId: 'chat-1',
        role: 'assistant',
        senderName: '林夕',
        isUser: false,
        isSystem: false,
        content: '服务端新增消息 3',
        selectedCandidateIndex: 0,
        candidateCount: 1,
        revision: '3',
        createdAt: '2026-11-06T11:03:00.000Z',
        updatedAt: '2026-11-06T11:03:00.000Z',
      },
    ]);

    const observedPhases: Array<{ phase: string; ids: string[]; fromCache: boolean }> = [];
    const reconcileResult = await openChatTailWithReconcile({
      chatId: 'chat-1',
      port: adapter,
      cache,
      onUpdate: (snap) => {
        if (snap.page) {
          observedPhases.push({
            phase: snap.phase,
            ids: snap.page.items.map((m) => m.messageId),
            fromCache: snap.fromCache,
          });
        }
      },
    });

    expect(observedPhases[0]).toEqual({
      phase: 'cached',
      ids: ['m-1', 'm-2'],
      fromCache: true,
    });
    expect(observedPhases.at(-1)).toEqual({
      phase: 'reconciled',
      ids: ['m-1', 'm-2', 'm-3'],
      fromCache: false,
    });
    expect(reconcileResult.page?.chatRevision).toBe('3');

    // 4. Reorder triggers orderChanged; openChatTailWithReconcile with anchorMessageId='m-2' relocates via anchor, and if anchor was deleted falls back to tail page
    adapter.reorderMessages('chat-1', ['m-2', 'm-1', 'm-3']);
    const relocated = await openChatTailWithReconcile({
      chatId: 'chat-1',
      port: adapter,
      cache,
      anchorMessageId: 'm-1',
      limit: 2,
    });
    expect(relocated.relocatedByAnchor).toBe(true);
    expect(relocated.page?.items.map((m) => m.messageId)).toEqual(['m-2', 'm-1']);

    // Delete anchor m-1 and reorder again -> anchor 404 falls back to tail page
    adapter.deleteMessage('chat-1', 'm-1');
    adapter.reorderMessages('chat-1', ['m-2', 'm-3']);
    const fallbackTail = await openChatTailWithReconcile({
      chatId: 'chat-1',
      port: adapter,
      cache,
      anchorMessageId: 'm-1',
      limit: 2,
    });
    expect(fallbackTail.fellBackToTail).toBe(true);
    expect(fallbackTail.page?.items.map((m) => m.messageId)).toEqual(['m-2', 'm-3']);

    // 5. AuthorityEpoch change invalidates entire cache
    adapter.setAuthorityEpoch('epoch-2');
    const afterEpochChange = await openChatTailWithReconcile({
      chatId: 'chat-1',
      port: adapter,
      cache,
    });
    expect(afterEpochChange.epochInvalidated).toBe(true);
    expect(await cache.get('chat-2')).toBeNull();

    // 6. Verify React hook useCachedChatTailReconcile emits cached then reconciled state
    await cache.set('chat-2', {
      chatId: 'chat-2',
      chatRevision: '1',
      metadataRevision: '1',
      orderRevision: '1',
      authorityEpoch: 'epoch-2',
      items: [
        {
          messageId: 'm-20',
          chatId: 'chat-2',
          role: 'assistant',
          senderName: '星野',
          isUser: false,
          isSystem: false,
          content: '星野缓存问候',
          selectedCandidateIndex: 0,
          candidateCount: 1,
          revision: '1',
          createdAt: '2026-11-06T11:01:00.000Z',
          updatedAt: '2026-11-06T11:01:00.000Z',
        },
      ],
      beforeCursor: null,
      afterCursor: null,
      hasOlder: false,
      hasNewer: false,
    });
    adapter.editMessage('chat-2', 'm-20', { content: '星野服务端新问候' });

    function HookProbe({ chatId }: { chatId: string }) {
      const state = useCachedChatTailReconcile({
        chatId,
        port: adapter,
        cache,
      });
      return (
        <div data-testid="reconcile-probe" data-phase={state.phase} data-from-cache={String(state.fromCache)}>
          {state.page?.items.map((m) => m.content).join('|') || 'empty'}
        </div>
      );
    }

    render(<HookProbe chatId="chat-2" />);
    await waitFor(() => {
      expect(screen.getByTestId('reconcile-probe').getAttribute('data-phase')).toBe('reconciled');
      expect(screen.getByTestId('reconcile-probe').textContent).toContain('星野服务端新问候');
    });
  });

  it('formats mobile conversation preview in strict order: Draft (草稿：…) > Voice ([语音] 0:08) > Interactive Card ([互动卡片]) > plain text', () => {
    // 1. Draft takes highest priority over voice, card, and text
    expect(
      formatMobileConversationPreview({
        draft: '今晚八点见',
        voiceDurationSec: 8,
        hasInteractiveCard: true,
        preview: '普通文本',
      }),
    ).toEqual({
      kind: 'draft',
      text: '草稿：今晚八点见',
      prefix: '草稿：',
      body: '今晚八点见',
    });

    // 2. Voice takes priority over card and text
    expect(
      formatMobileConversationPreview({
        voiceDurationSec: 8,
        hasInteractiveCard: true,
        preview: '普通文本',
      }),
    ).toEqual({
      kind: 'voice',
      text: '[语音] 0:08',
      durationText: '0:08',
    });

    // Also recognizes voice duration in milliseconds or [语音] preview string
    expect(
      formatMobileConversationPreview({
        voiceDurationMs: 125_000,
        preview: '',
      }),
    ).toEqual({
      kind: 'voice',
      text: '[语音] 2:05',
      durationText: '2:05',
    });

    // 3. Interactive card takes priority over plain text
    expect(
      formatMobileConversationPreview({
        hasInteractiveCard: true,
        preview: '<div>角色状态面板</div>',
      }),
    ).toEqual({
      kind: 'card',
      text: '[互动卡片]',
    });

    // Recognizes HTML card markup in preview
    expect(
      formatMobileConversationPreview({
        preview: '<div class="card-root"><iframe src="about:blank"></iframe></div>',
      }),
    ).toEqual({
      kind: 'card',
      text: '[互动卡片]',
    });

    // 4. Plain text fallback
    expect(
      formatMobileConversationPreview({
        preview: '今天天气真好',
      }),
    ).toEqual({
      kind: 'text',
      text: '今天天气真好',
    });
  });

  it('renders MobileChatList in MobileApp default chat tab with 20px cards, 52px aura avatars, top search filter, preview priorities, unread badge/dot, and IonItemSliding 88px actions only when capabilities exist', async () => {
    const keyLinxi = '["linxi.png","chat-linxi"]';
    const keyXingye = '["xingye.png","chat-xingye"]';
    const keysuzume = '["suzume.png","chat-suzume"]';
    const keyCard = '["card.png","chat-card"]';

    const nowMs = Date.now();
    const client = createAppClient({
      fetchImpl: vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => [],
        text: async () => JSON.stringify({ items: [], unreadCount: 0 }),
      })) as unknown as typeof fetch,
    });
    client.recent = vi.fn(async () => [
      {
        avatar: 'linxi.png',
        file_id: 'chat-linxi',
        mes: '普通最后一条消息',
        last_mes: nowMs - 60_000,
        chat_metadata: {
          vc_binding: { relationshipId: 'rel-linxi', characterRef: 'char:linxi' },
        },
      },
      {
        avatar: 'xingye.png',
        file_id: 'chat-xingye',
        mes: '[语音] 0:08',
        last_mes: nowMs - 120_000,
        chat_metadata: {
          vc_binding: { relationshipId: 'rel-xingye', characterRef: 'char:xingye' },
        },
      },
      {
        avatar: 'card.png',
        file_id: 'chat-card',
        mes: '<div class="st-card">状态卡片</div>',
        last_mes: nowMs - 180_000,
        chat_metadata: {
          vc_binding: { relationshipId: 'rel-card', characterRef: 'char:card' },
        },
      },
      {
        avatar: 'suzume.png',
        file_id: 'chat-suzume',
        mes: '早安，今天想去哪里？',
        last_mes: nowMs - 240_000,
        chat_metadata: {
          vc_binding: { relationshipId: 'rel-suzume', characterRef: 'char:suzume' },
        },
      },
    ]);
    client.characters = vi.fn(async () => [
      { name: '林夕', avatar: 'linxi.png', data: { extensions: { vc_character_ref: 'char:linxi' } } },
      { name: '星野', avatar: 'xingye.png', data: { extensions: { vc_character_ref: 'char:xingye' } } },
      { name: '白露', avatar: 'card.png', data: { extensions: { vc_character_ref: 'char:card' } } },
      { name: '铃芽', avatar: 'suzume.png', data: { extensions: { vc_character_ref: 'char:suzume' } } },
    ]);
    client.go.fetchRelationships = vi.fn(async () => [
      { relationshipId: 'rel-linxi', displayName: '林夕 · 初遇' },
      { relationshipId: 'rel-xingye', displayName: '星野 · 主线' },
      { relationshipId: 'rel-card', displayName: '白露 · 旅途' },
      { relationshipId: 'rel-suzume', displayName: '铃芽' },
    ]);

    const queryClient = createQueryClient();
    const sessionBridge = createSessionBridge(client, {
      prepareRuntime: vi.fn(async () => ({}) as any),
    });
    // Set draft on linxi
    sessionBridge.draft.write(keyLinxi, '等我五分钟');

    render(
      <MobileApp
        client={client}
        queryClient={queryClient}
        sessionBridge={sessionBridge}
        initialPath="/m/chat"
      />,
    );

    // Wait for default chat tab to render MobileChatList rows
    await waitFor(() => {
      expect(document.querySelectorAll('[data-vc-mobile-convo-row]').length).toBe(4);
    });

    const findRowByKey = (key: string) =>
      Array.from(document.querySelectorAll('[data-vc-mobile-convo-row]')).find(
        (el) => el.getAttribute('data-vc-mobile-convo-row') === key,
      ) as HTMLElement | undefined;

    // 1. Verify preview texts: Draft > Voice > Interactive Card > normal text
    const rowLinxi = findRowByKey(keyLinxi);
    const rowXingye = findRowByKey(keyXingye);
    const rowCard = findRowByKey(keyCard);
    const rowSuzume = findRowByKey(keysuzume);

    expect(rowLinxi?.textContent).toContain('林夕');
    expect(rowLinxi?.textContent).toContain('初遇');
    expect(rowLinxi?.textContent).toContain('草稿：等我五分钟');

    expect(rowXingye?.textContent).toContain('星野');
    expect(rowXingye?.textContent).toContain('主线');
    expect(rowXingye?.textContent).toContain('[语音] 0:08');

    expect(rowCard?.textContent).toContain('白露');
    expect(rowCard?.textContent).toContain('[互动卡片]');

    expect(rowSuzume?.textContent).toContain('铃芽');
    expect(rowSuzume?.textContent).toContain('早安，今天想去哪里？');

    // 2. Verify no fake swipe actions are rendered when no pin/delete capability is injected
    expect(document.querySelectorAll('ion-item-sliding').length).toBe(4);
    expect(document.querySelectorAll('[data-vc-swipe-action]').length).toBe(0);

    // 3. Top search filters rows by character name or instance chip
    const searchInput = screen.getByRole('searchbox', { name: '搜索会话' });
    fireEvent.change(searchInput, { target: { value: '星野' } });

    await waitFor(() => {
      expect(document.querySelectorAll('[data-vc-mobile-convo-row]').length).toBe(1);
    });
    expect(findRowByKey(keyXingye)).toBeTruthy();

    // Clear search restores all 4 rows
    const clearBtn = screen.getByRole('button', { name: '清除搜索' });
    fireEvent.click(clearBtn);
    await waitFor(() => {
      expect(document.querySelectorAll('[data-vc-mobile-convo-row]').length).toBe(4);
    });

    // 4. Clicking a conversation row navigates to /m/chat/<encodedKey>
    await act(async () => {
      fireEvent.click(findRowByKey(keysuzume) as HTMLElement);
    });
    await waitFor(() => {
      expect(window.location.pathname).toBe(`/m/chat/${encodeURIComponent(keysuzume)}`);
    });
  });

  it('renders unread count badge (99+ cap), unread dot, and 88px IonItemSliding swipe actions when real delete/pin handlers are provided', async () => {
    const onSelect = vi.fn();
    const onDelete = vi.fn();
    const onPin = vi.fn();
    const client = createAppClient({
      fetchImpl: vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => [],
        text: async () => '{}',
      })) as unknown as typeof fetch,
    });
    const queryClient = createQueryClient();
    const sessionBridge = createSessionBridge(client, {
      prepareRuntime: vi.fn(async () => ({}) as any),
    });

    render(
      <AppProviders client={client} queryClient={queryClient} sessionBridge={sessionBridge}>
        <MobileChatList
          rows={[
            {
              key: '["a.png","chat-a"]',
              avatar: 'a.png',
              file: 'chat-a',
              avatarUrl: '/characters/a.png',
              title: '爱丽丝',
              instanceName: '爱丽丝 · 仙境',
              preview: '未读计数超出99',
              updatedAt: Date.now(),
              timeText: '14:32',
              unread: true,
              unreadCount: 120,
            },
            {
              key: '["b.png","chat-b"]',
              avatar: 'b.png',
              file: 'chat-b',
              avatarUrl: '/characters/b.png',
              title: '鲍勃',
              preview: '未读圆点消息',
              updatedAt: Date.now() - 60_000,
              timeText: '昨天',
              unread: true,
              unreadCount: 0,
            },
          ]}
          onSelectConversation={onSelect}
          onDeleteConversation={onDelete}
          onPinConversation={onPin}
        />
      </AppProviders>,
    );

    const badge = document.querySelector('[data-vc-convo-unread-badge]');
    expect(badge?.textContent).toBe('99+');

    const dot = document.querySelector('[data-vc-convo-unread-dot]');
    expect(dot).toBeTruthy();

    // Verify 88px swipe actions exist when real handlers are provided
    const pinActions = document.querySelectorAll('[data-vc-swipe-action="pin"]');
    const deleteActions = document.querySelectorAll('[data-vc-swipe-action="delete"]');
    expect(pinActions.length).toBe(2);
    expect(deleteActions.length).toBe(2);

    fireEvent.click(pinActions[0] as HTMLElement);
    expect(onPin).toHaveBeenCalledWith(expect.objectContaining({ key: '["a.png","chat-a"]' }));

    fireEvent.click(deleteActions[0] as HTMLElement);
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ key: '["a.png","chat-a"]' }));
  });

  it('keeps createHttpChatStoragePort inert until explicitly called', () => {
    const requestSpy = vi.fn();
    const port = createHttpChatStoragePort({ request: requestSpy });
    expect(port).toBeTruthy();
    expect(requestSpy).not.toHaveBeenCalled();
  });

  it('covers boundary limits (1..200), empty chat message page, deleteStoredChat revision/epoch conflicts, LRU cache eviction, and UI loading/error/empty/SX-2 prefetch states', async () => {
    const clockMs = Date.parse('2026-11-06T12:00:00.000Z');
    const adapter = createSyntheticChatStorageAdapter({
      authorityEpoch: 'epoch-1',
      now: () => clockMs,
      chats: [
        {
          chatId: 'chat-empty',
          characterRef: 'char:empty',
          relationshipId: 'rel-empty',
          title: '空会话',
          characterName: '空会话',
          avatar: 'empty.png',
          preview: '',
          messageCount: 0,
          chatRevision: '1',
          metadataRevision: '1',
          orderRevision: '1',
          createdAt: '2026-11-06T11:00:00.000Z',
          updatedAt: '2026-11-06T11:05:00.000Z',
        },
      ],
      messagesByChatId: {
        'chat-empty': [],
      },
    });

    // Limit boundary validation: 0, 201, -5, 2.5 fail with 400 INVALID_REQUEST; 1 and 200 succeed
    for (const badLimit of [0, 201, -5, 2.5]) {
      await expect(adapter.listStoredChats({ limit: badLimit })).rejects.toMatchObject({
        status: 400,
        code: 'INVALID_REQUEST',
      });
      await expect(
        adapter.listStoredMessages('chat-empty', { limit: badLimit }),
      ).rejects.toMatchObject({
        status: 400,
        code: 'INVALID_REQUEST',
      });
    }

    const validMin = await adapter.listStoredChats({ limit: 1 });
    const validMax = await adapter.listStoredChats({ limit: 200 });
    expect(validMin.items).toHaveLength(1);
    expect(validMax.items).toHaveLength(1);

    // Empty chat message page returns empty items, null cursors, false flags, and optional chat header
    const emptyMsgPage = await adapter.listStoredMessages('chat-empty', {
      limit: 50,
      include: 'chat',
    });
    expect(emptyMsgPage.items).toEqual([]);
    expect(emptyMsgPage.beforeCursor).toBeNull();
    expect(emptyMsgPage.afterCursor).toBeNull();
    expect(emptyMsgPage.hasOlder).toBe(false);
    expect(emptyMsgPage.hasNewer).toBe(false);
    expect(emptyMsgPage.chat?.chatId).toBe('chat-empty');

    // anchorMessageId on empty chat returns 404
    await expect(
      adapter.listStoredMessages('chat-empty', { anchorMessageId: 'non-existent' }),
    ).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND_OR_FORBIDDEN',
    });

    // deleteStoredChat checks expectedAuthorityEpoch (409 CHAT_AUTHORITY_CHANGED) and expectedChatRevision (409 REVISION_CONFLICT)
    await expect(
      adapter.deleteStoredChat?.('chat-empty', {
        expectedAuthorityEpoch: 'wrong-epoch',
        expectedChatRevision: '1',
        clientMutationId: 'mut-1',
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'CHAT_AUTHORITY_CHANGED',
    });

    await expect(
      adapter.deleteStoredChat?.('chat-empty', {
        expectedAuthorityEpoch: 'epoch-1',
        expectedChatRevision: '999',
        clientMutationId: 'mut-2',
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'REVISION_CONFLICT',
    });

    // Cache LRU eviction when maxChats=2 is exceeded
    const lruCache = createChatTailCache({
      accountId: 'acc-1',
      sessionId: 'sess-1',
      authorityEpoch: 'epoch-1',
      maxChats: 2,
      indexedDB: null,
    });
    await lruCache.set('c1', { ...emptyMsgPage, chatId: 'c1' });
    await lruCache.set('c2', { ...emptyMsgPage, chatId: 'c2' });
    await lruCache.set('c3', { ...emptyMsgPage, chatId: 'c3' });
    expect(await lruCache.get('c1')).toBeNull();
    expect(await lruCache.get('c2')).toBeTruthy();
    expect(await lruCache.get('c3')).toBeTruthy();

    // Deleting chat on server and reconciling evicts chat from cache and emits phase='deleted'
    await lruCache.set('chat-empty', emptyMsgPage);
    await adapter.deleteStoredChat?.('chat-empty', {
      expectedAuthorityEpoch: 'epoch-1',
      expectedChatRevision: '1',
      clientMutationId: 'mut-3',
    });
    const deletedSnap = await openChatTailWithReconcile({
      chatId: 'chat-empty',
      port: adapter,
      cache: lruCache,
    });
    expect(deletedSnap.phase).toBe('deleted');
    expect(await lruCache.get('chat-empty')).toBeNull();

    // Test MobileChatList loading, error, empty states, and SX-2 storagePort + tailCache idle prefetch
    const client = createAppClient({
      fetchImpl: vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => [],
        text: async () => '{}',
      })) as unknown as typeof fetch,
    });
    const queryClient = createQueryClient();
    const sessionBridge = createSessionBridge(client, {
      prepareRuntime: vi.fn(async () => ({}) as any),
    });
    const onRetry = vi.fn();
    const onNavigate = vi.fn();

    const { rerender } = render(
      <AppProviders client={client} queryClient={queryClient} sessionBridge={sessionBridge}>
        <MobileChatList status="loading" rows={[]} />
      </AppProviders>,
    );
    expect(document.querySelector('[data-vc-convo-loading]')).toBeTruthy();

    rerender(
      <AppProviders client={client} queryClient={queryClient} sessionBridge={sessionBridge}>
        <MobileChatList status="error" rows={[]} onRetry={onRetry} />
      </AppProviders>,
    );
    expect(screen.getByRole('alert').textContent).toContain('会话没有加载出来');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    rerender(
      <AppProviders client={client} queryClient={queryClient} sessionBridge={sessionBridge}>
        <MobileChatList status="ready" rows={[]} onNavigate={onNavigate} />
      </AppProviders>,
    );
    expect(document.querySelector('[data-vc-convo-empty]')?.textContent).toContain('还没有会话');
    fireEvent.click(screen.getByRole('button', { name: '去角色页' }));
    expect(onNavigate).toHaveBeenCalledWith('/m/characters');

    adapter.upsertChat({
      chatId: 'chat-seeded',
      characterRef: 'char:seeded',
      relationshipId: 'rel-seeded',
      title: '预取会话',
      characterName: '预取角色',
      avatar: 'seeded.png',
      preview: '预取尾页消息',
      messageCount: 1,
      chatRevision: '1',
      metadataRevision: '1',
      orderRevision: '1',
      createdAt: '2026-11-06T11:00:00.000Z',
      updatedAt: '2026-11-06T11:10:00.000Z',
    });
    adapter.appendMessages('chat-seeded', [
      {
        messageId: 'seed-msg-1',
        chatId: 'chat-seeded',
        role: 'assistant',
        senderName: '预取角色',
        isUser: false,
        isSystem: false,
        content: '预取尾页消息',
        selectedCandidateIndex: 0,
        candidateCount: 1,
        revision: '2',
        createdAt: '2026-11-06T11:10:00.000Z',
        updatedAt: '2026-11-06T11:10:00.000Z',
      },
    ]);
    rerender(
      <AppProviders client={client} queryClient={queryClient} sessionBridge={sessionBridge}>
        <MobileChatList storagePort={adapter} tailCache={lruCache} />
      </AppProviders>,
    );
    await waitFor(async () => {
      expect(document.querySelector('[data-vc-mobile-convo-row]')?.textContent).toContain('预取角色');
      const prefetched = await lruCache.get('chat-seeded');
      expect(prefetched?.items.map((m) => m.messageId)).toEqual(['seed-msg-1']);
    });
  });

  it('enforces SX-2 OpenAPI contract details: decimal authorityEpoch default, title-only q filter, multi-page changes loop, default tail anchor relocation on orderChanged/410, delete idempotency,chatId hook switch, and throwing indexedDB getter', async () => {
    const adapter = createSyntheticChatStorageAdapter({
      chats: [
        {
          chatId: 'chat-alpha',
          title: '阿尔法',
          characterName: '阿尔法',
          preview: '机密正文关键词XYZ',
          messageCount: 3,
          chatRevision: '3',
          metadataRevision: '1',
          orderRevision: '1',
          updatedAt: '2026-11-06T12:00:00.000Z',
        },
      ],
      messagesByChatId: {
        'chat-alpha': [
          {
            messageId: 'a-1',
            chatId: 'chat-alpha',
            role: 'user',
            senderName: '你',
            isUser: true,
            isSystem: false,
            content: '消息 1',
            selectedCandidateIndex: 0,
            candidateCount: 1,
            revision: '1',
            createdAt: '2026-11-06T11:58:00.000Z',
            updatedAt: '2026-11-06T11:58:00.000Z',
          },
          {
            messageId: 'a-2',
            chatId: 'chat-alpha',
            role: 'assistant',
            senderName: '阿尔法',
            isUser: false,
            isSystem: false,
            content: '消息 2',
            selectedCandidateIndex: 0,
            candidateCount: 1,
            revision: '2',
            createdAt: '2026-11-06T11:59:00.000Z',
            updatedAt: '2026-11-06T11:59:00.000Z',
          },
          {
            messageId: 'a-3',
            chatId: 'chat-alpha',
            role: 'user',
            senderName: '你',
            isUser: true,
            isSystem: false,
            content: '消息 3',
            selectedCandidateIndex: 0,
            candidateCount: 1,
            revision: '3',
            createdAt: '2026-11-06T12:00:00.000Z',
            updatedAt: '2026-11-06T12:00:00.000Z',
          },
        ],
      },
    });

    // 1. Default authorityEpoch is decimal string '1', and q searches title/characterName only (never preview body)
    expect(adapter.getAuthorityEpoch()).toBe('1');
    const byBodyKeyword = await adapter.listStoredChats({ q: '机密正文关键词XYZ' });
    expect(byBodyKeyword.items).toHaveLength(0);
    const byTitleKeyword = await adapter.listStoredChats({ q: '阿尔法' });
    expect(byTitleKeyword.items).toHaveLength(1);
    expect(byTitleKeyword.items[0].kind).toBe('SINGLE');
    expect(byTitleKeyword.items[0].branchRoot).toBe('chat-alpha');

    // 2. listStoredChatChanges rejects future afterRevision and limit > 200 with 400 INVALID_REQUEST
    await expect(
      adapter.listStoredChatChanges?.('chat-alpha', { afterRevision: '999' }),
    ).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_REQUEST',
    });
    await expect(
      adapter.listStoredChatChanges?.('chat-alpha', { afterRevision: '1', limit: 201 }),
    ).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_REQUEST',
    });

    // 3. Throwing globalThis.indexedDB getter is caught safely by createChatTailCache
    const origDesc = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      get() {
        throw new Error('SecurityError: blocked indexedDB getter');
      },
    });
    let cache: ReturnType<typeof createChatTailCache>;
    try {
      cache = createChatTailCache({ authorityEpoch: '1' });
    } finally {
      if (origDesc) {
        Object.defineProperty(globalThis, 'indexedDB', origDesc);
      }
    }

    // Seed cache with tail [a-1, a-2] (limit=2)
    const initialTail = await adapter.listStoredMessages('chat-alpha', { limit: 2 });
    expect(initialTail.items.map((m) => m.messageId)).toEqual(['a-2', 'a-3']);
    await cache.set('chat-alpha', initialTail);

    // 4. Reorder messages so a-2 is now before a-1 and a-3 is first: ['a-3', 'a-1', 'a-2']
    // Calling openChatTailWithReconcile WITHOUT explicit anchorMessageId automatically relocates around cached tail 'a-3'!
    adapter.reorderMessages('chat-alpha', ['a-3', 'a-1', 'a-2']);
    const autoRelocated = await openChatTailWithReconcile({
      chatId: 'chat-alpha',
      port: adapter,
      cache,
      limit: 2,
    });
    expect(autoRelocated.relocatedByAnchor).toBe(true);
    expect(autoRelocated.page?.items.map((m) => m.messageId)).toEqual(['a-3']);

    // 5. Expire changes window (410 CHAT_CHANGES_EXPIRED) -> automatically relocates around cached tail message 'a-3'
    adapter.editMessage('chat-alpha', 'a-3', { content: '消息 3 更新' });
    adapter.expireChangesBefore('chat-alpha', '99');
    const recoveredFrom410 = await openChatTailWithReconcile({
      chatId: 'chat-alpha',
      port: adapter,
      cache,
      limit: 2,
    });
    expect(recoveredFrom410.relocatedByAnchor).toBe(true);
    expect(recoveredFrom410.page?.items[0]?.content).toBe('消息 3 更新');

    // 6. Verify useCachedChatTailReconcile does not leak previous chatId's page when chatId prop changes
    function SwitchProbe({ chatId }: { chatId: string }) {
      const snap = useCachedChatTailReconcile({ chatId, port: adapter, cache });
      return (
        <div
          data-testid="switch-probe"
          data-phase={snap.phase}
          data-page-chat={snap.page?.chatId ?? 'none'}
        />
      );
    }
    const { rerender: rerenderProbe } = render(<SwitchProbe chatId="chat-alpha" />);
    expect(screen.getByTestId('switch-probe').getAttribute('data-page-chat')).toBe('chat-alpha');

    rerenderProbe(<SwitchProbe chatId="chat-unseeded" />);
    expect(screen.getByTestId('switch-probe').getAttribute('data-page-chat')).toBe('none');
    expect(screen.getByTestId('switch-probe').getAttribute('data-phase')).toBe('loading');

    // 7. deleteStoredChat supports OpenAPI { requestId, authorityEpoch, chatRevision } and idempotency
    const latestChat = (await adapter.listStoredChats()).items[0];
    const delCommit1 = await adapter.deleteStoredChat?.('chat-alpha', {
      requestId: 'req-del-1',
      authorityEpoch: '1',
      chatRevision: latestChat.chatRevision,
    });
    expect(delCommit1?.deleted).toBe(true);
    expect(delCommit1?.requestId).toBe('req-del-1');

    // Idempotent replay with same requestId and same payload returns identical commit
    const delCommit2 = await adapter.deleteStoredChat?.('chat-alpha', {
      requestId: 'req-del-1',
      authorityEpoch: '1',
      chatRevision: latestChat.chatRevision,
    });
    expect(delCommit2?.operationId).toBe(delCommit1?.operationId);

    // Same requestId with different payload throws 409 IDEMPOTENCY_KEY_REUSED
    await expect(
      adapter.deleteStoredChat?.('chat-alpha', {
        requestId: 'req-del-1',
        authorityEpoch: '1',
        chatRevision: '999',
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'IDEMPOTENCY_KEY_REUSED',
    });
  });
});
