import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import { RouterProvider } from '@tanstack/react-router';
import { AppProviders, createQueryClient } from '../../src/app/providers';
import { createDesktopRouter } from '../../src/app/router';
import { SessionBridgeProvider, createSessionBridge } from '../../src/runtime/session-bridge';
import type { AppClient } from '../../src/data/client';
import { MemoryRoute } from '../../src/features/memory/MemoryRoute';
import { MemoryItemDetail } from '../../src/features/memory/MemoryItemDetail';
import { useRelationshipMemoriesQuery } from '../../src/data/queries/chat';

function setupMatchMedia(initialWidth = 1440) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string): MediaQueryList => {
      const match = query.match(/\(min-width:\s*(\d+)px\)/);
      const matches = match ? initialWidth >= Number(match[1]) : false;
      return {
        media: query,
        matches,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      } as unknown as MediaQueryList;
    }),
  );
}

function createMemoryTestClient(overrides: Partial<AppClient['go']> = {}) {
  const page1Items = [
    {
      memoryId: 'mem-1',
      relationshipId: '11',
      type: 'FACT',
      sourceStatus: 'VALID',
      lifecycle: 'ACTIVE',
      summary: '喜欢桂花拿铁',
      version: 1,
      pinnedAt: null,
      time: {
        eventDate: '2026-11-01',
        recordedAt: '2026-11-01T10:30:00Z',
      },
      createdAt: '2026-11-01T10:30:00Z',
    },
  ];
  const page2Items = [
    {
      memoryId: 'mem-2',
      relationshipId: '11',
      type: 'PREFERENCE',
      sourceStatus: 'PENDING_VERIFICATION',
      lifecycle: 'ACTIVE',
      summary: '周末喜欢去海边散步',
      version: 2,
      pinnedAt: '2026-11-02T14:00:00Z',
      time: {
        eventDate: '2026-11-02',
        recordedAt: '2026-11-02T14:00:00Z',
      },
      createdAt: '2026-11-02T14:00:00Z',
    },
  ];

  const fetchMemories = vi.fn(async (_relId: string, filters: Record<string, unknown> = {}) => {
    if (filters.cursor === 'cursor-page-2') {
      return {
        items: page2Items,
        nextCursor: null,
      };
    }
    return {
      items: [...page1Items, ...page2Items],
      nextCursor: 'cursor-page-2',
    };
  });

  const client: AppClient = {
    initialize: vi.fn(async () => ({
      characters: [{ avatar: 'alice.png', name: '阿梨' }],
      chat: [],
      settings: {},
    })),
    recent: vi.fn(async () => [
      {
        avatar: 'alice.png',
        file_name: 'chat-a.jsonl',
        chat_metadata: {
          vc_binding: { relationshipId: '11', characterRef: 'char-alice' },
          vc_f2: { id: 'chat-uuid-1' },
        },
      },
    ]),
    getContext: vi.fn(() => ({
      characters: [{ avatar: 'alice.png', name: '阿梨' }],
      characterId: 0,
      chatId: 'chat-a',
      chatMetadata: {
        vc_binding: { relationshipId: '11' },
        vc_f2: { id: 'chat-uuid-1' },
      },
      chat: [
        { name: 'User', is_user: true, mes: '你好', vc_message_id: 'msg-uuid-0' },
        {
          name: '阿梨',
          is_user: false,
          mes: '我平时最喜欢喝桂花拿铁',
          vc_message_id: '550e8400-e29b-41d4-a716-446655440000',
        },
      ],
    })),
    go: {
      captureSessionContext: vi.fn(() => ({ userId: 'u-1', sessionId: 's-1' })),
      fetchRelationships: vi.fn(async () => [
        {
          relationshipId: '9',
          personaRef: 'gentle-listener',
          companionName: null,
          active: false,
        },
        {
          relationshipId: '11',
          personaRef: 'st-character',
          companionName: '阿梨',
          characterRef: 'char-alice',
          active: true,
        },
      ]),
      fetchMemories,
      fetchMemory: vi.fn(async (memoryId: string) => ({
        memoryId,
        relationshipId: '11',
        type: 'FACT',
        sourceStatus: 'VALID',
        lifecycle: 'ACTIVE',
        summary: '喜欢桂花拿铁',
        version: 1,
        pinnedAt: null,
        time: {
          eventDate: '2026-11-01',
          recordedAt: '2026-11-01T10:30:00Z',
        },
        createdAt: '2026-11-01T10:30:00Z',
      })),
      fetchMemoryEvidence: vi.fn(async () => [
        {
          evidenceId: 'ev-1',
          sourceRef: 'st:chat-uuid-1:550e8400-e29b-41d4-a716-446655440000:1',
          chatDisplayName: '桂花拿铁对话',
          messageId: '550e8400-e29b-41d4-a716-446655440000',
          revision: 1,
          status: 'VALID',
          sourceTimestamp: '2026-11-01T10:30:00Z',
          sourceTimezone: 'Asia/Shanghai',
          excerpt: '我平时最喜欢喝桂花拿铁',
        },
      ]),
      correctMemory: vi.fn(),
      forgetMemory: vi.fn(),
      pinMemory: vi.fn(),
      unpinMemory: vi.fn(),
      listFavorites: vi.fn(async () => ({ items: [], nextCursor: '' })),
      createFavorite: vi.fn(),
      deleteFavorite: vi.fn(),
      listReminders: vi.fn(async () => ({ items: [] })),
      createReminder: vi.fn(),
      deleteReminder: vi.fn(),
      fetchDiaryMonth: vi.fn(async () => []),
      fetchDiaryEntry: vi.fn(async () => null),
      getIncognitoPref: vi.fn(async () => ({ incognito: false })),
      setIncognitoPref: vi.fn(async (incognito: boolean) => ({ incognito })),
      reauth: vi.fn(async () => ({ ok: true })),
      ...overrides,
    },
  } as unknown as AppClient;

  return { client, fetchMemories, page1Items, page2Items };
}

describe('MemoryRoute', () => {
  beforeEach(() => {
    setupMatchMedia(1440);
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState(null, '', '/');
    window.location.hash = '';
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('ignores a reauth challenge for a memory that is no longer selected', async () => {
    let rejectForget!: (error: Error) => void;
    const request = new Promise<void>((_resolve, reject) => { rejectForget = reject; });
    const forget = vi.fn((_id: string) => request);
    const { client, page1Items, page2Items } = createMemoryTestClient({ forgetMemory: forget });
    const queryClient = createQueryClient();
    const view = (item: (typeof page1Items)[number] | (typeof page2Items)[number]) => (
      <AppProviders client={client} queryClient={queryClient}>
        <MemoryItemDetail item={item} />
      </AppProviders>
    );
    const { rerender } = render(view(page1Items[0]));
    fireEvent.click(await screen.findByRole('button', { name: '遗忘' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认遗忘' }));
    await waitFor(() => expect(forget).toHaveBeenCalledWith('mem-1'));
    rerender(view(page2Items[0]));
    await act(async () => {
      rejectForget(Object.assign(new Error('recent reauthentication required'), { status: 403 }));
      await request.catch(() => {});
    });
    await waitFor(() => expect(queryClient.isMutating()).toBe(0));
    expect(screen.queryByRole('dialog', { name: '验证身份' })).toBeNull();
    expect(forget).toHaveBeenCalledTimes(1);
  });

  it('opens the memory page after the chat preview has populated the same cache', async () => {
    const { client, fetchMemories } = createMemoryTestClient();
    function ChatMemoryPreview() {
      const memories = useRelationshipMemoriesQuery('11');
      return <p>{memories.isSuccess ? '聊天记忆已加载' : '聊天记忆加载中'}</p>;
    }
    const router = createDesktopRouter({
      initialEntry: '/chat',
      routeOverrides: {
        chat: ChatMemoryPreview,
        memory: () => <MemoryRoute initialRelationshipId="11" />,
      },
    });
    render(
      <AppProviders client={client} queryClient={createQueryClient()}>
        <RouterProvider router={router} />
      </AppProviders>,
    );
    await screen.findByText('聊天记忆已加载');
    await act(async () => {
      await router.navigate({ to: '/memory' });
    });
    await waitFor(() => {
      expect(screen.getAllByText('喜欢桂花拿铁').length).toBeGreaterThan(0);
      expect(screen.getAllByText('周末喜欢去海边散步').length).toBeGreaterThan(0);
    });
    expect(fetchMemories).toHaveBeenCalledTimes(1);
  });

  it('filters combine type+source+date and survive navigation', async () => {
    const { client, fetchMemories } = createMemoryTestClient();
    const router = createDesktopRouter({
      routeOverrides: {
        memory: () => <MemoryRoute />,
      },
    });

    render(
      <AppProviders client={client} queryClient={createQueryClient()}>
        <RouterProvider router={router} />
      </AppProviders>,
    );

    await act(async () => {
      await router.navigate({ to: '/memory' });
    });

    await waitFor(() => {
      expect(screen.getAllByText('喜欢桂花拿铁').length).toBeGreaterThan(0);
      expect(screen.getAllByText('周末喜欢去海边散步').length).toBeGreaterThan(0);
    });

    // Combine type=fact + source=chat_turn + date=2026-11-01
    fireEvent.click(screen.getByRole('button', { name: '事实' }));
    fireEvent.click(screen.getByRole('button', { name: '对话提取' }));
    const dateInput = screen.getByLabelText('按日期筛选') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '2026-11-01' } });

    await waitFor(() => {
      expect(fetchMemories).toHaveBeenCalledWith(
        '11',
        expect.objectContaining({
          type: 'fact',
          source: 'chat_turn',
          date: '2026-11-01',
        }),
      );
      expect(screen.getAllByText('喜欢桂花拿铁').length).toBeGreaterThan(0);
      expect(screen.queryByText('周末喜欢去海边散步')).toBeNull();
    });

    // Navigate away to another route and return
    await act(async () => {
      await router.navigate({ to: '/characters' });
    });
    expect(router.state.location.pathname).toBe('/characters');

    await act(async () => {
      await router.navigate({ to: '/memory' });
    });
    expect(router.state.location.pathname).toBe('/memory');

    await waitFor(() => {
      expect(screen.getAllByText('喜欢桂花拿铁').length).toBeGreaterThan(0);
    });
    expect((screen.getByLabelText('按日期筛选') as HTMLInputElement).value).toBe('2026-11-01');
    expect(screen.getByRole('button', { name: '事实' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '对话提取' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByText('周末喜欢去海边散步')).toBeNull();
  });

  it('waits for bridge.open to resolve, navigates to /chat/$conversationKey, and calls chatUi.requestMessageJump(key, floor)', async () => {
    const { client } = createMemoryTestClient();
    const order: string[] = [];
    let resolveOpen: ((val: 'opened') => void) | null = null;
    let bridgeContext: Record<string, unknown> = {
      characters: [{ avatar: 'alice.png', name: '阿梨' }],
      characterId: 0,
      chatId: 'other-chat',
      chatMetadata: {},
      chat: [],
    };

    const baseBridge = createSessionBridge(client);
    const fakeBridge = {
      ...baseBridge,
      getContext: () => bridgeContext,
      open: vi.fn(() => {
        order.push('bridge.open:start');
        return new Promise<'opened'>((resolve) => {
          resolveOpen = (val) => {
            bridgeContext = {
              characters: [{ avatar: 'alice.png', name: '阿梨' }],
              characterId: 0,
              chatId: 'chat-a',
              chatMetadata: {
                vc_binding: { relationshipId: '11' },
                vc_f2: { id: 'chat-uuid-1' },
              },
              chat: [
                { name: 'User', is_user: true, mes: '你好', vc_message_id: 'msg-uuid-0' },
                {
                  name: '阿梨',
                  is_user: false,
                  mes: '我平时最喜欢喝桂花拿铁',
                  vc_message_id: '550e8400-e29b-41d4-a716-446655440000',
                },
              ],
            };
            order.push('bridge.open:resolved');
            resolve(val);
          };
        });
      }),
    };

    const onLocateMessage = vi.fn(
      async (payload: {
        floor: number | null;
        messageId?: string;
        chatFile?: string;
        conversationKey?: string;
      }) => {
        order.push(
          `navigate:${payload.conversationKey}#${payload.floor}:${payload.messageId}`,
        );
      },
    );

    const router = createDesktopRouter({
      routeOverrides: {
        chat: () => <div data-route="chat" />,
        memory: () => <MemoryRoute onNavigateToMessage={onLocateMessage} />,
      },
    });

    render(
      <AppProviders client={client} queryClient={createQueryClient()}>
        <SessionBridgeProvider bridge={fakeBridge}>
          <RouterProvider router={router} />
        </SessionBridgeProvider>
      </AppProviders>,
    );

    await act(async () => {
      await router.navigate({ to: '/memory' });
    });

    await waitFor(() => {
      expect(screen.getAllByText('喜欢桂花拿铁').length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByText('喜欢桂花拿铁')[0]);

    const jumpBtn = await waitFor(() => screen.getByRole('button', { name: /跳转原消息/ }));
    fireEvent.click(jumpBtn);

    await waitFor(() => {
      expect(client.recent).toHaveBeenCalled();
      expect(fakeBridge.open).toHaveBeenCalledWith(
        expect.objectContaining({
          avatar: 'alice.png',
          file: 'chat-a',
          relationshipId: '11',
          chatIdentity: 'chat-uuid-1',
        }),
      );
    });
    expect(onLocateMessage).not.toHaveBeenCalled();

    resolveOpen?.('opened');

    await waitFor(() => {
      expect(onLocateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationKey: '["alice.png","chat-a"]',
          chatFile: 'chat-a',
          floor: 1,
          messageId: '550e8400-e29b-41d4-a716-446655440000',
        }),
      );
    });
    expect(order).toEqual([
      'bridge.open:start',
      'bridge.open:resolved',
      'navigate:["alice.png","chat-a"]#1:550e8400-e29b-41d4-a716-446655440000',
    ]);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows load more button when first page has zero local filter matches but hasNextPage is true', async () => {
    const { page1Items, page2Items } = createMemoryTestClient();
    const fetchMemories = vi.fn(async (_relId: string, params: Record<string, unknown> = {}) => {
      if (params.cursor === 'cursor-page-2') {
        return { items: page2Items, nextCursor: null };
      }
      // First page only has FACT item, no PREFERENCE item
      return { items: page1Items, nextCursor: 'cursor-page-2' };
    });
    const { client } = createMemoryTestClient({ fetchMemories });

    const router = createDesktopRouter({
      routeOverrides: {
        memory: () => <MemoryRoute />,
      },
    });

    render(
      <AppProviders client={client} queryClient={createQueryClient()}>
        <RouterProvider router={router} />
      </AppProviders>,
    );

    await act(async () => {
      await router.navigate({ to: '/memory' });
    });

    await waitFor(() => {
      expect(screen.getAllByText('喜欢桂花拿铁').length).toBeGreaterThan(0);
    });

    // Filter by '偏好' (PREFERENCE) -> page 1 has 0 matches, but nextCursor is 'cursor-page-2'
    fireEvent.click(screen.getByRole('button', { name: '偏好' }));

    await waitFor(() => {
      expect(screen.getByText('没有找到记忆')).toBeTruthy();
    });

    // Empty state must still provide the load more button when hasNextPage is true!
    const moreBtn = screen.getByRole('button', { name: '加载更多' });
    fireEvent.click(moreBtn);

    await waitFor(() => {
      expect(fetchMemories).toHaveBeenCalledWith(
        '11',
        expect.objectContaining({ cursor: 'cursor-page-2' }),
      );
      expect(screen.getAllByText('周末喜欢去海边散步').length).toBeGreaterThan(0);
    });
  });

  it('supports pagination, diary tab, and favorites tab', async () => {
    const { client, fetchMemories } = createMemoryTestClient({
      fetchDiaryMonth: vi.fn(async () => [
        {
          id: 'diary-1',
          day: '2026-11-01',
          title: '深秋的午后',
          body: '今天一起聊了桂花拿铁。',
          moments: ['记住了咖啡口味'],
        },
      ]),
      listFavorites: vi.fn(async () => ({
        items: [
          {
            favoriteId: 'fav-1',
            relationshipId: '11',
            chatFile: 'chat-a.jsonl',
            role: 'character',
            speakerName: '阿梨',
            messageAt: '2026-11-01T10:30:00Z',
            body: '下次给你带桂花拿铁',
          },
        ],
        nextCursor: '',
      })),
    });

    const router = createDesktopRouter({
      routeOverrides: {
        memory: () => <MemoryRoute />,
      },
    });

    render(
      <AppProviders client={client} queryClient={createQueryClient()}>
        <RouterProvider router={router} />
      </AppProviders>,
    );

    await act(async () => {
      await router.navigate({ to: '/memory' });
    });

    await waitFor(() => {
      expect(screen.getAllByText('喜欢桂花拿铁').length).toBeGreaterThan(0);
    });

    // Load more pagination button is visible because nextCursor is 'cursor-page-2'
    const moreBtn = await screen.findByRole('button', { name: '加载更多' });
    fireEvent.click(moreBtn);
    await waitFor(() => {
      expect(fetchMemories).toHaveBeenCalledWith(
        '11',
        expect.objectContaining({ cursor: 'cursor-page-2' }),
      );
    });

    // Switch to Diary tab
    fireEvent.click(screen.getByRole('tab', { name: '日记' }));
    await waitFor(() => {
      expect(screen.getByText('今天一起聊了桂花拿铁。')).toBeTruthy();
      expect(screen.getByText('记住了咖啡口味')).toBeTruthy();
    });

    // Switch to Favorites tab
    fireEvent.click(screen.getByRole('tab', { name: '收藏' }));
    await waitFor(() => {
      expect(screen.getByText('下次给你带桂花拿铁')).toBeTruthy();
    });
  });

  it('paginates favorites with after=<nextCursor> and keeps delete-favorite invalidation working', async () => {
    const deletedIds = new Set<string>();
    const listFavorites = vi.fn(
      async (_relId: string, params: { limit?: number; after?: string } = {}) => {
        if (params.after === 'fav-cursor-2') {
          return {
            items: [
              {
                favoriteId: 'fav-2',
                relationshipId: '11',
                chatFile: 'chat-a.jsonl',
                role: 'character',
                speakerName: '阿梨',
                messageAt: '2026-11-02T10:30:00Z',
                body: '第二页收藏：海边日落',
              },
            ].filter((item) => !deletedIds.has(item.favoriteId)),
            nextCursor: '',
          };
        }
        return {
          items: [
            {
              favoriteId: 'fav-1',
              relationshipId: '11',
              chatFile: 'chat-a.jsonl',
              role: 'character',
              speakerName: '阿梨',
              messageAt: '2026-11-01T10:30:00Z',
              body: '第一页收藏：桂花拿铁',
            },
          ].filter((item) => !deletedIds.has(item.favoriteId)),
          nextCursor: 'fav-cursor-2',
        };
      },
    );
    const deleteFavorite = vi.fn(async (id: string) => {
      deletedIds.add(id);
    });

    const { client } = createMemoryTestClient({
      listFavorites,
      deleteFavorite,
    });

    const router = createDesktopRouter({
      routeOverrides: {
        memory: () => <MemoryRoute />,
      },
    });

    render(
      <AppProviders client={client} queryClient={createQueryClient()}>
        <RouterProvider router={router} />
      </AppProviders>,
    );

    await act(async () => {
      await router.navigate({ to: '/memory' });
    });

    await waitFor(() => {
      expect(screen.getAllByText('喜欢桂花拿铁').length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole('tab', { name: '收藏' }));

    await waitFor(() => {
      expect(screen.getByText('第一页收藏：桂花拿铁')).toBeTruthy();
    });
    expect(listFavorites).toHaveBeenCalledWith('11', { limit: 50 });
    expect(screen.queryByText('第二页收藏：海边日落')).toBeNull();

    const loadMoreBtn = await screen.findByRole('button', { name: '加载更多' });
    fireEvent.click(loadMoreBtn);

    await waitFor(() => {
      expect(listFavorites).toHaveBeenCalledWith('11', {
        limit: 50,
        after: 'fav-cursor-2',
      });
      expect(screen.getByText('第二页收藏：海边日落')).toBeTruthy();
    });
    expect(screen.getByText('第一页收藏：桂花拿铁')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '加载更多' })).toBeNull();

    // Delete first favorite and verify invalidation refreshes the list
    const removeButtons = screen.getAllByRole('button', { name: '移除收藏' });
    fireEvent.click(removeButtons[0]);

    await waitFor(() => {
      expect(deleteFavorite).toHaveBeenCalledWith('fav-1');
      expect(screen.queryByText('第一页收藏：桂花拿铁')).toBeNull();
    });
    expect(screen.getByText('第二页收藏：海边日落')).toBeTruthy();
  });
});
