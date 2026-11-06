import React from 'react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '../../src/app/providers';
import { createAppClient } from '../../src/data/client';
import { createSessionBridge } from '../../src/runtime/session-bridge';
import {
  THEME_MODE_KEY,
  usePreferences as useDesignPreferences,
} from '../../src/design/theme/usePreferences';
import { usePreferences as useShellPreferences } from '../../src/shell/usePreferences';
import { MobileApp } from '../../src/mobile/app/MobileApp';
import { mountMobileApp } from '../../src/mobile/app/main';

function createSilentClient() {
  return createAppClient({
    fetchImpl: vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify({ items: [], unreadCount: 0 }),
    })) as unknown as typeof fetch,
  });
}

describe('MB2-5 MobileShell (Ionic React 9 + Router 6)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-vc-device');
    document.documentElement.removeAttribute('data-vc-theme');
    document.documentElement.removeAttribute('data-vc-reduced-motion');
    document.documentElement.style.removeProperty('--vc-keyboard');
    window.history.replaceState(null, '', '/m');
    useDesignPreferences.getState().resetForTest?.();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('redirects /m -> /m/chat via Navigate, mounts 5 primary tabs with real /m/* URLs, 34/700 large title, 44px avatar settings trigger, and badge 99+ cap', async () => {
    const client = createSilentClient();
    const queryClient = createQueryClient();

    render(
      <MobileApp
        client={client}
        queryClient={queryClient}
        badges={{ inbox: 128 }}
        unreadDots={{ chat: true }}
      />,
    );

    const appRoot = document.querySelector('[data-vc-mobile-app]');
    expect(appRoot).toBeTruthy();

    // Wait for <Route path="/m" element={<Navigate to="/m/chat" replace />} /> and Ionic StackManager microtask
    await waitFor(() => {
      expect(window.location.pathname).toBe('/m/chat');
      expect(document.querySelector('[data-vc-large-title]')?.textContent).toBe('聊天');
    });

    // Verify 5 primary tab buttons exist with expected labels and icons
    const tabBar = document.querySelector('[data-vc-mobile-tabbar]');
    expect(tabBar).toBeTruthy();
    expect(tabBar?.hasAttribute('hidden')).toBe(false);

    const expectedTabs = [
      { key: 'chat', label: '聊天', path: '/m/chat' },
      { key: 'characters', label: '角色', path: '/m/characters' },
      { key: 'memory', label: '记忆', path: '/m/memory' },
      { key: 'inbox', label: '陪伴', path: '/m/inbox' },
      { key: 'story', label: '剧情', path: '/m/story' },
    ];

    for (const tab of expectedTabs) {
      const btn = tabBar?.querySelector(`[data-vc-tab="${tab.key}"]`);
      expect(btn, `missing tab button ${tab.key}`).toBeTruthy();
      expect(btn?.textContent).toContain(tab.label);
    }

    // Badge 99+ cap on inbox and unread dot on chat
    const inboxBadge = tabBar?.querySelector('[data-vc-tab="inbox"] [data-vc-tab-badge]');
    expect(inboxBadge?.textContent).toBe('99+');
    const chatDot = tabBar?.querySelector('[data-vc-tab="chat"] [data-vc-tab-dot]');
    expect(chatDot).toBeTruthy();
    // Tab without badge leaves no badge element
    const memoryBadge = tabBar?.querySelector('[data-vc-tab="memory"] [data-vc-tab-badge]');
    expect(memoryBadge).toBeNull();

    // Large title and 44px avatar trigger on /m/chat
    const largeTitle = document.querySelector('[data-vc-large-title]');
    expect(largeTitle?.textContent).toBe('聊天');
    const avatarBtn = document.querySelector('[data-vc-settings-trigger]');
    expect(avatarBtn).toBeTruthy();
    expect(avatarBtn?.getAttribute('aria-label')).toBe('打开设置');

    // Navigate across all 5 primary tabs and verify URL + large title + story aurora scene
    for (const tab of expectedTabs.slice(1)) {
      const btn = tabBar?.querySelector(`[data-vc-tab="${tab.key}"]`) as HTMLElement;
      await waitFor(() => {
        expect(btn.classList.contains('hydrated')).toBe(true);
      });
      await act(async () => {
        fireEvent.click(btn);
      });
      await waitFor(() => {
        expect(window.location.pathname).toBe(tab.path);
        expect(document.querySelector('[data-vc-large-title]')?.textContent).toBe(tab.label);
      });
    }

    // On /m/story, scene attribute switches to story (deep blue-cyan aurora tone)
    expect(appRoot?.getAttribute('data-vc-mobile-scene')).toBe('story');

    // Public ionKeyboardDidShow / ionKeyboardDidHide events hide and restore the floating tabbar
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('ionKeyboardDidShow', { detail: { keyboardHeight: 280 } }),
      );
    });
    expect(document.documentElement.style.getPropertyValue('--vc-keyboard')).toBe('280px');
    expect(tabBar?.hasAttribute('hidden')).toBe(true);

    await act(async () => {
      window.dispatchEvent(new CustomEvent('ionKeyboardDidHide'));
    });
    expect(document.documentElement.style.getPropertyValue('--vc-keyboard')).toBe('0px');
    expect(tabBar?.hasAttribute('hidden')).toBe(false);
  });

  it('pushes secondary route onto page stack, preserves per-page useParams on hidden routes, hides floating tabbar, and supports IonBackButton & real browser back/forward', async () => {
    const client = createSilentClient();
    const queryClient = createQueryClient();
    const observedKeys: string[] = [];

    window.history.replaceState(null, '', '/m/chat');

    render(
      <MobileApp
        client={client}
        queryClient={queryClient}
        initialPath="/m/chat"
        slots={{
          tabs: {
            chat: ({ navigate }) => (
              <button
                type="button"
                data-testid="open-conv"
                onClick={() => navigate('/m/chat/conv-alpha')}
              >
                进入会话
              </button>
            ),
          },
          chatDetail: ({ conversationKey, goBack }) => {
            observedKeys.push(conversationKey);
            return (
              <div data-testid="conv-detail">
                <span>会话:{conversationKey}</span>
                <button type="button" data-testid="custom-back" onClick={() => goBack('/m/chat')}>
                  返回列表
                </button>
              </div>
            );
          },
          secondaryTitles: {
            '/m/chat/conv-alpha': '林夕',
          },
        }}
      />,
    );

    await waitFor(() => {
      expect(window.location.pathname).toBe('/m/chat');
      expect(screen.getByTestId('open-conv')).toBeTruthy();
    });

    const tabBar = document.querySelector('[data-vc-mobile-tabbar]');
    expect(tabBar?.hasAttribute('hidden')).toBe(false);

    // Navigate to secondary route /m/chat/conv-alpha
    await act(async () => {
      fireEvent.click(screen.getByTestId('open-conv'));
    });

    await waitFor(() => {
      expect(window.location.pathname).toBe('/m/chat/conv-alpha');
      expect(screen.getByTestId('conv-detail').textContent).toContain('会话:conv-alpha');
    });

    // TabBar must be hidden on secondary routes
    expect(tabBar?.hasAttribute('hidden')).toBe(true);
    expect(tabBar?.getAttribute('data-hidden')).toBe('true');

    // Secondary header shows centered title and left IonBackButton
    const secTitle = document.querySelector('[data-vc-secondary-title]');
    expect(secTitle?.textContent).toBe('林夕');
    const backBtn = document.querySelector('[data-vc-back-button]') as HTMLElement;
    expect(backBtn).toBeTruthy();

    // Click IonBackButton to return to /m/chat (must pop history, not push)
    await act(async () => {
      fireEvent.click(backBtn);
    });

    await waitFor(() => {
      expect(window.location.pathname).toBe('/m/chat');
    });
    expect(tabBar?.hasAttribute('hidden')).toBe(false);

    // Hidden / leaving route must never receive an empty conversationKey from global pathname slicing
    expect(observedKeys.length).toBeGreaterThan(0);
    expect(observedKeys.every((k) => k === 'conv-alpha')).toBe(true);

    // Real browser history forward returns to /m/chat/conv-alpha, and real browser back returns to /m/chat
    await act(async () => {
      window.history.forward();
    });
    await waitFor(() => {
      expect(window.location.pathname).toBe('/m/chat/conv-alpha');
    });

    await act(async () => {
      window.history.back();
    });
    await waitFor(() => {
      expect(window.location.pathname).toBe('/m/chat');
    });
    expect(observedKeys.every((k) => k === 'conv-alpha')).toBe(true);
  });

  it('renders cardFullscreen slot at /m/chat/:conversationKey/card with conversationKey and message query param, and falls back to /m/chat/:conversationKey on back', async () => {
    const client = createSilentClient();
    const queryClient = createQueryClient();
    const observedCardCalls: Array<{
      conversationKey: string;
      message?: string;
      paramConversationKey?: string;
      paramMessage?: string;
    }> = [];

    const encodedKey = encodeURIComponent('["alice.png","chat-1"]');
    window.history.replaceState(null, '', `/m/chat/${encodedKey}/card?message=msg-42`);

    render(
      <MobileApp
        client={client}
        queryClient={queryClient}
        slots={{
          chatDetail: ({ conversationKey, navigate }) => (
            <div data-testid="chat-detail-view">
              <span>对话页:{conversationKey}</span>
              <button
                type="button"
                data-testid="open-card-msg-99"
                onClick={() => navigate(`/m/chat/${encodedKey}/card?message=msg-99`)}
              >
                打开卡片99
              </button>
            </div>
          ),
          cardFullscreen: ({ conversationKey, message, params, goBack }) => {
            observedCardCalls.push({
              conversationKey,
              message,
              paramConversationKey: params.conversationKey,
              paramMessage: params.message,
            });
            return (
              <div data-testid="card-fullscreen-view">
                <span>
                  卡片:{conversationKey}:{message}
                </span>
                <button type="button" data-testid="card-fallback-back" onClick={() => goBack()}>
                  关闭卡片
                </button>
              </div>
            );
          },
        }}
      />,
    );

    await waitFor(() => {
      expect(window.location.pathname).toBe(`/m/chat/${encodedKey}/card`);
      expect(screen.getByTestId('card-fullscreen-view').textContent).toContain(
        '卡片:["alice.png","chat-1"]:msg-42',
      );
    });

    expect(observedCardCalls.at(-1)).toEqual({
      conversationKey: '["alice.png","chat-1"]',
      message: 'msg-42',
      paramConversationKey: '["alice.png","chat-1"]',
      paramMessage: 'msg-42',
    });

    const activePages = document.querySelectorAll('[data-vc-page-active="true"]');
    expect(activePages.length).toBe(1);
    expect(activePages[0]?.getAttribute('data-vc-page')).toBe('secondary:card-fullscreen');

    const backBtn = document.querySelector('[data-vc-back-button]') as HTMLElement | null;
    expect(backBtn).toBeTruthy();
    expect(
      backBtn?.getAttribute('default-href') ?? (backBtn as any)?.defaultHref,
    ).toBe(`/m/chat/${encodedKey}`);

    // Deep-link fallback back navigates to /m/chat/<key>
    await act(async () => {
      fireEvent.click(screen.getByTestId('card-fallback-back'));
    });

    await waitFor(() => {
      expect(window.location.pathname).toBe(`/m/chat/${encodedKey}`);
      expect(screen.getByTestId('chat-detail-view').textContent).toContain(
        '对话页:["alice.png","chat-1"]',
      );
    });

    // Navigate from conversation to cardFullscreen with a new ?message=msg-99 query parameter
    await act(async () => {
      fireEvent.click(screen.getByTestId('open-card-msg-99'));
    });

    await waitFor(() => {
      expect(window.location.pathname).toBe(`/m/chat/${encodedKey}/card`);
      expect(window.location.search).toBe('?message=msg-99');
      expect(screen.getByTestId('card-fullscreen-view').textContent).toContain(
        '卡片:["alice.png","chat-1"]:msg-99',
      );
    });
    expect(observedCardCalls.at(-1)).toEqual({
      conversationKey: '["alice.png","chat-1"]',
      message: 'msg-99',
      paramConversationKey: '["alice.png","chat-1"]',
      paramMessage: 'msg-99',
    });

    // Click IonBackButton to return to /m/chat/<key>
    const activeBackBtn = document.querySelector('[data-vc-back-button]') as HTMLElement;
    expect(activeBackBtn).toBeTruthy();
    await act(async () => {
      fireEvent.click(activeBackBtn);
    });

    await waitFor(() => {
      expect(window.location.pathname).toBe(`/m/chat/${encodedKey}`);
    });
  });

  it('dispatches all 7 SecondarySlotKey routes (chat-detail, character-detail, memory-detail, story-run, card-fullscreen, tavern-section, settings-category) with expected context and title resolution', async () => {
    const client = createSilentClient();
    const queryClient = createQueryClient();

    window.history.replaceState(null, '', '/m/chat');

    render(
      <MobileApp
        client={client}
        queryClient={queryClient}
        initialPath="/m/chat"
        slots={{
          tabs: {
            chat: ({ navigate }) => (
              <div data-testid="dispatch-nav">
                <button
                  type="button"
                  data-testid="go-chat-detail"
                  onClick={() => navigate('/m/chat/conv-7')}
                >
                  chat-detail
                </button>
                <button
                  type="button"
                  data-testid="go-character-detail"
                  onClick={() => navigate('/m/characters/seraphina.png')}
                >
                  character-detail
                </button>
                <button
                  type="button"
                  data-testid="go-memory-detail"
                  onClick={() => navigate('/m/memory/mem-101')}
                >
                  memory-detail
                </button>
                <button
                  type="button"
                  data-testid="go-story-run"
                  onClick={() => navigate('/m/story/run-202')}
                >
                  story-run
                </button>
                <button
                  type="button"
                  data-testid="go-card-fullscreen"
                  onClick={() => navigate('/m/chat/conv-7/card?message=msg-77')}
                >
                  card-fullscreen
                </button>
                <button
                  type="button"
                  data-testid="go-tavern-fn"
                  onClick={() => navigate('/m/settings/tavern/WorldInfo')}
                >
                  tavern-fn
                </button>
                <button
                  type="button"
                  data-testid="go-tavern-node"
                  onClick={() => navigate('/m/settings/tavern/Preset')}
                >
                  tavern-node
                </button>
                <button
                  type="button"
                  data-testid="go-settings-fn"
                  onClick={() => navigate('/m/settings/appearance')}
                >
                  settings-fn
                </button>
                <button
                  type="button"
                  data-testid="go-settings-node"
                  onClick={() => navigate('/m/settings/account')}
                >
                  settings-node
                </button>
              </div>
            ),
          },
          chatDetail: ({ conversationKey, params, navigate }) => (
            <div data-testid="slot-chat-detail">
              <span>
                chat-detail:{conversationKey}:{params.conversationKey}
              </span>
              <button
                type="button"
                data-testid="return-chat"
                onClick={() => navigate('/m/chat')}
              >
                back
              </button>
            </div>
          ),
          characterDetail: ({ avatar, params, navigate }) => (
            <div data-testid="slot-character-detail">
              <span>
                character-detail:{avatar}:{params.avatar}
              </span>
              <button
                type="button"
                data-testid="return-from-char"
                onClick={() => navigate('/m/chat')}
              >
                back
              </button>
            </div>
          ),
          memoryDetail: ({ memoryId, params, navigate }) => (
            <div data-testid="slot-memory-detail">
              <span>
                memory-detail:{memoryId}:{params.memoryId}
              </span>
              <button
                type="button"
                data-testid="return-from-mem"
                onClick={() => navigate('/m/chat')}
              >
                back
              </button>
            </div>
          ),
          storyRun: ({ runId, params, navigate }) => (
            <div data-testid="slot-story-run">
              <span>
                story-run:{runId}:{params.runId}
              </span>
              <button
                type="button"
                data-testid="return-from-story"
                onClick={() => navigate('/m/chat')}
              >
                back
              </button>
            </div>
          ),
          cardFullscreen: ({ conversationKey, message, params, navigate }) => (
            <div data-testid="slot-card-fullscreen">
              <span>
                card-fullscreen:{conversationKey}:{message}:{params.message}
              </span>
              <button
                type="button"
                data-testid="return-from-card"
                onClick={() => navigate('/m/chat')}
              >
                back
              </button>
            </div>
          ),
          tavernSections: {
            WorldInfo: ({ section, params, navigate }) => (
              <div data-testid="slot-tavern-fn">
                <span>
                  tavern-section:{section}:{params.section}
                </span>
                <button
                  type="button"
                  data-testid="return-from-tavern-fn"
                  onClick={() => navigate('/m/chat')}
                >
                  back
                </button>
              </div>
            ),
            Preset: <div data-testid="slot-tavern-node">tavern-node:Preset</div>,
          },
          settingsCategories: {
            appearance: ({ category, params, navigate }) => (
              <div data-testid="slot-settings-fn">
                <span>
                  settings-category:{category}:{params.category}
                </span>
                <button
                  type="button"
                  data-testid="return-from-settings-fn"
                  onClick={() => navigate('/m/chat')}
                >
                  back
                </button>
              </div>
            ),
            account: <div data-testid="slot-settings-node">settings-node:account</div>,
          },
          secondaryTitles: {
            'msg-77': '全屏卡片标题77',
          },
        }}
      />,
    );

    await waitFor(() => {
      expect(window.location.pathname).toBe('/m/chat');
      expect(screen.getByTestId('dispatch-nav')).toBeTruthy();
    });

    const routeChecks: ReadonlyArray<{
      triggerTestId: string;
      expectedPath: string;
      expectedSlotAttr: string;
      slotTestId: string;
      expectedText: string;
      returnTestId?: string;
      expectedTitle?: string;
    }> = [
      {
        triggerTestId: 'go-chat-detail',
        expectedPath: '/m/chat/conv-7',
        expectedSlotAttr: 'secondary:chat-detail',
        slotTestId: 'slot-chat-detail',
        expectedText: 'chat-detail:conv-7:conv-7',
        returnTestId: 'return-chat',
      },
      {
        triggerTestId: 'go-character-detail',
        expectedPath: '/m/characters/seraphina.png',
        expectedSlotAttr: 'secondary:character-detail',
        slotTestId: 'slot-character-detail',
        expectedText: 'character-detail:seraphina.png:seraphina.png',
        returnTestId: 'return-from-char',
      },
      {
        triggerTestId: 'go-memory-detail',
        expectedPath: '/m/memory/mem-101',
        expectedSlotAttr: 'secondary:memory-detail',
        slotTestId: 'slot-memory-detail',
        expectedText: 'memory-detail:mem-101:mem-101',
        returnTestId: 'return-from-mem',
      },
      {
        triggerTestId: 'go-story-run',
        expectedPath: '/m/story/run-202',
        expectedSlotAttr: 'secondary:story-run',
        slotTestId: 'slot-story-run',
        expectedText: 'story-run:run-202:run-202',
        returnTestId: 'return-from-story',
      },
      {
        triggerTestId: 'go-card-fullscreen',
        expectedPath: '/m/chat/conv-7/card',
        expectedSlotAttr: 'secondary:card-fullscreen',
        slotTestId: 'slot-card-fullscreen',
        expectedText: 'card-fullscreen:conv-7:msg-77:msg-77',
        returnTestId: 'return-from-card',
        expectedTitle: '全屏卡片标题77',
      },
      {
        triggerTestId: 'go-tavern-fn',
        expectedPath: '/m/settings/tavern/WorldInfo',
        expectedSlotAttr: 'secondary:tavern-section',
        slotTestId: 'slot-tavern-fn',
        expectedText: 'tavern-section:WorldInfo:WorldInfo',
        returnTestId: 'return-from-tavern-fn',
      },
      {
        triggerTestId: 'go-tavern-node',
        expectedPath: '/m/settings/tavern/Preset',
        expectedSlotAttr: 'secondary:tavern-section',
        slotTestId: 'slot-tavern-node',
        expectedText: 'tavern-node:Preset',
      },
      {
        triggerTestId: 'go-settings-fn',
        expectedPath: '/m/settings/appearance',
        expectedSlotAttr: 'secondary:settings-category',
        slotTestId: 'slot-settings-fn',
        expectedText: 'settings-category:appearance:appearance',
        returnTestId: 'return-from-settings-fn',
      },
      {
        triggerTestId: 'go-settings-node',
        expectedPath: '/m/settings/account',
        expectedSlotAttr: 'secondary:settings-category',
        slotTestId: 'slot-settings-node',
        expectedText: 'settings-node:account',
      },
    ];

    for (const check of routeChecks) {
      await act(async () => {
        fireEvent.click(screen.getByTestId(check.triggerTestId));
      });

      await waitFor(() => {
        expect(window.location.pathname).toBe(check.expectedPath);
        expect(screen.getByTestId(check.slotTestId).textContent).toContain(check.expectedText);
      });

      const activeSlotEl = document.querySelector(
        `[data-vc-mobile-slot="${check.expectedSlotAttr}"]`,
      );
      expect(activeSlotEl, `missing active slot ${check.expectedSlotAttr}`).toBeTruthy();

      if (check.expectedTitle) {
        expect(document.querySelector('[data-vc-secondary-title]')?.textContent).toBe(
          check.expectedTitle,
        );
      }

      if (check.returnTestId) {
        await act(async () => {
          fireEvent.click(screen.getByTestId(check.returnTestId));
        });
      } else {
        const backBtn = document.querySelector('[data-vc-back-button]') as HTMLElement;
        expect(backBtn).toBeTruthy();
        await act(async () => {
          fireEvent.click(backBtn);
        });
      }

      await waitFor(() => {
        expect(window.location.pathname).toBe('/m/chat');
      });
    }
  });

  it('propagates updated slots and activePathname to subsequent same-pattern parameterized pages (A -> back -> B) and keeps exactly one active page', async () => {
    const client = createSilentClient();
    const queryClient = createQueryClient();

    window.history.replaceState(null, '', '/m/chat');

    function buildSlots(version: string) {
      return {
        tabs: {
          chat: ({ navigate }: { navigate: (to: string) => void }) => (
            <div>
              <button
                type="button"
                data-testid="open-conv-a"
                onClick={() => navigate('/m/chat/conv-a')}
              >
                打开A
              </button>
              <button
                type="button"
                data-testid="open-conv-b"
                onClick={() => navigate('/m/chat/conv-b')}
              >
                打开B
              </button>
            </div>
          ),
        },
        chatDetail: ({
          conversationKey,
          navigate,
          goBack,
        }: {
          conversationKey: string;
          navigate: (to: string) => void;
          goBack: (fallback?: string) => void;
        }) => (
          <div data-testid={`detail-${conversationKey}`}>
            <span>
              {conversationKey}:{version}
            </span>
            <button
              type="button"
              data-testid={`back-from-${conversationKey}`}
              onClick={() =>
                conversationKey === 'conv-a' ? navigate('/m/chat') : goBack('/m/chat')
              }
            >
              返回
            </button>
          </div>
        ),
        secondaryTitles: {
          '/m/chat/conv-a': `会话A-${version}`,
          '/m/chat/conv-b': `会话B-${version}`,
        },
      };
    }

    const { rerender } = render(
      <MobileApp
        client={client}
        queryClient={queryClient}
        initialPath="/m/chat"
        slots={buildSlots('v1')}
      />,
    );

    await waitFor(() => {
      expect(window.location.pathname).toBe('/m/chat');
      expect(screen.getByTestId('open-conv-a')).toBeTruthy();
    });

    // 1. Open conversation A
    await act(async () => {
      fireEvent.click(screen.getByTestId('open-conv-a'));
    });

    await waitFor(() => {
      expect(window.location.pathname).toBe('/m/chat/conv-a');
      expect(screen.getByTestId('detail-conv-a').textContent).toContain('conv-a:v1');
    });
    expect(document.querySelectorAll('[data-vc-page-active="true"]').length).toBe(1);

    // 2. Return to /m/chat
    await act(async () => {
      fireEvent.click(screen.getByTestId('back-from-conv-a'));
    });

    await waitFor(() => {
      expect(window.location.pathname).toBe('/m/chat');
    });
    expect(document.querySelectorAll('[data-vc-page-active="true"]').length).toBe(1);

    // 3. Open conversation B (second viewItem for /m/chat/:conversationKey)
    await act(async () => {
      fireEvent.click(screen.getByTestId('open-conv-b'));
    });

    await waitFor(() => {
      expect(window.location.pathname).toBe('/m/chat/conv-b');
      expect(screen.getByTestId('detail-conv-b').textContent).toContain('conv-b:v1');
    });
    expect(document.querySelectorAll('[data-vc-page-active="true"]').length).toBe(1);

    // 4. Parent updates slots while on conversation B -> B must receive v2 slots and title
    rerender(
      <MobileApp
        client={client}
        queryClient={queryClient}
        initialPath="/m/chat"
        slots={buildSlots('v2')}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('detail-conv-b').textContent).toContain('conv-b:v2');
      expect(document.querySelector('[data-vc-secondary-title]')?.textContent).toBe('会话B-v2');
    });
    expect(document.querySelectorAll('[data-vc-page-active="true"]').length).toBe(1);

    // 5. Return from B to /m/chat -> B must update activePathname so only /m/chat is active
    await act(async () => {
      fireEvent.click(screen.getByTestId('back-from-conv-b'));
    });

    await waitFor(() => {
      expect(window.location.pathname).toBe('/m/chat');
    });
    const activeAfterBackFromB = document.querySelectorAll('[data-vc-page-active="true"]');
    expect(activeAfterBackFromB.length).toBe(1);
    expect(activeAfterBackFromB[0]?.getAttribute('data-vc-page')).toBe('tab:chat');

    // 6. Re-open conversation A -> only conv-a is active, with v2 slots
    await act(async () => {
      fireEvent.click(screen.getByTestId('open-conv-a'));
    });

    await waitFor(() => {
      expect(window.location.pathname).toBe('/m/chat/conv-a');
      expect(screen.getByTestId('detail-conv-a').textContent).toContain('conv-a:v2');
    });
    const activeOnReopenA = document.querySelectorAll('[data-vc-page-active="true"]');
    expect(activeOnReopenA.length).toBe(1);
    expect(activeOnReopenA[0]?.getAttribute('data-vc-page')).toBe('secondary:chat-detail');
  });

  it('opens Settings large sheet with real history entry, supports browser back/forward, syncs theme radios with shared usePreferences, disables unimplemented items, and pushes formal settings subroutes that return to sheet on Back', async () => {
    const client = createSilentClient();
    const queryClient = createQueryClient();

    // Verify design and shell re-export the exact same singleton Zustand store
    expect(useDesignPreferences).toBe(useShellPreferences);

    window.history.replaceState(null, '', '/m/characters');

    render(
      <MobileApp
        client={client}
        queryClient={queryClient}
        initialPath="/m/characters"
        userName="星野"
        slots={{
          settingsCategories: {
            appearance: ({ category }) => (
              <div data-testid="slot-appearance">外观子页:{category}</div>
            ),
          },
          tavernSections: {
            WorldInfo: ({ section }) => (
              <div data-testid="slot-tavern-worldinfo">酒馆子页:{section}</div>
            ),
          },
        }}
      />,
    );

    await waitFor(() => {
      expect(window.location.pathname).toBe('/m/characters');
      expect(document.querySelector('[data-vc-settings-trigger]')).toBeTruthy();
      expect(document.querySelector('ion-modal')?.classList.contains('hydrated')).toBe(true);
    });

    const avatarBtn = document.querySelector('[data-vc-settings-trigger]') as HTMLElement;
    const modal = document.querySelector('ion-modal.vc-mobile-settings-modal') as any;
    expect(modal).toBeTruthy();
    expect(modal.breakpoints).toEqual([0, 0.56, 1]);
    expect(modal.initialBreakpoint).toBe(1);
    expect(modal.backdropBreakpoint).toBe(0);
    expect(modal.showBackdrop).toBe(true);
    expect(modal.handle).toBe(false);
    expect(modal.presentingElement).toBeUndefined();

    const sheet = document.querySelector('[data-vc-settings-sheet]');
    expect(sheet?.getAttribute('data-open')).toBe('false');

    // Open Settings sheet -> pushes history entry with settingsOpen: true
    await act(async () => {
      fireEvent.click(avatarBtn);
    });

    await waitFor(() => {
      expect(sheet?.getAttribute('data-open')).toBe('true');
    });

    // TabBar is hidden while Settings sheet is open
    const tabBar = document.querySelector('[data-vc-mobile-tabbar]');
    expect(tabBar?.hasAttribute('hidden')).toBe(true);

    // Real browser back closes the Settings sheet, and real browser forward re-opens it
    await act(async () => {
      window.history.back();
    });
    await waitFor(() => {
      expect(sheet?.getAttribute('data-open')).toBe('false');
    });
    expect(window.location.pathname).toBe('/m/characters');
    expect(tabBar?.hasAttribute('hidden')).toBe(false);

    await act(async () => {
      window.history.forward();
    });
    await waitFor(() => {
      expect(sheet?.getAttribute('data-open')).toBe('true');
    });
    expect(tabBar?.hasAttribute('hidden')).toBe(true);

    // Account card renders user name and subtitle (disabled when account slot is not injected)
    const accountCard = document.querySelector('[data-vc-settings-account]') as HTMLButtonElement;
    expect(accountCard?.textContent).toContain('星野');
    expect(accountCard?.textContent).toContain('密码与身份验证器');
    expect(accountCard?.disabled).toBe(true);

    // Theme mode native same-name radio inputs update shared usePreferences store and DOM immediately
    const darkRadio = document.querySelector(
      '[data-vc-theme-option="dark"] input[type="radio"][name="vc-mobile-theme-mode"]',
    ) as HTMLInputElement;
    const lightRadio = document.querySelector(
      '[data-vc-theme-option="light"] input[type="radio"][name="vc-mobile-theme-mode"]',
    ) as HTMLInputElement;
    const autoRadio = document.querySelector(
      '[data-vc-theme-option="auto"] input[type="radio"][name="vc-mobile-theme-mode"]',
    ) as HTMLInputElement;
    expect(darkRadio).toBeTruthy();
    expect(lightRadio).toBeTruthy();
    expect(autoRadio).toBeTruthy();

    await act(async () => {
      fireEvent.click(darkRadio);
    });
    expect(darkRadio.checked).toBe(true);
    expect(useDesignPreferences.getState().themeMode).toBe('dark');
    expect(useShellPreferences.getState().themeMode).toBe('dark');
    expect(document.documentElement.dataset.vcTheme).toBe('dark');
    expect(window.localStorage.getItem(THEME_MODE_KEY)).toBe('dark');

    await act(async () => {
      fireEvent.click(lightRadio);
    });
    expect(lightRadio.checked).toBe(true);
    expect(useDesignPreferences.getState().themeMode).toBe('light');
    expect(document.documentElement.dataset.vcTheme).toBe('light');

    // Unimplemented settings items (without injected slot) must remain disabled
    const modelItem = document.querySelector('[data-vc-settings-item="model"]') as HTMLButtonElement;
    expect(modelItem).toBeTruthy();
    expect(modelItem.disabled).toBe(true);
    expect(modelItem.getAttribute('aria-disabled')).toBe('true');

    // Clicking an enabled settings category ('appearance') clears settingsOpen marker and pushes /m/settings/appearance
    const appearanceItem = document.querySelector(
      '[data-vc-settings-item="appearance"]',
    ) as HTMLButtonElement;
    expect(appearanceItem).toBeTruthy();
    expect(appearanceItem.disabled).toBe(false);

    await act(async () => {
      fireEvent.click(appearanceItem);
    });

    await waitFor(() => {
      expect(window.location.pathname).toBe('/m/settings/appearance');
      expect(sheet?.getAttribute('data-open')).toBe('false');
      expect(screen.getByTestId('slot-appearance').textContent).toContain('外观子页:appearance');
    });

    // Clicking IonBackButton on /m/settings/appearance pops back to the open Settings sheet entry on /m/characters
    const subBackBtn = document.querySelector('[data-vc-back-button]') as HTMLElement;
    expect(subBackBtn).toBeTruthy();
    await act(async () => {
      fireEvent.click(subBackBtn);
    });

    await waitFor(() => {
      expect(window.location.pathname).toBe('/m/characters');
      expect(sheet?.getAttribute('data-open')).toBe('true');
    });

    // Clicking '完成' closes the Settings sheet via navigate(-1)
    const doneBtn = document.querySelector('[data-vc-settings-done]') as HTMLElement;
    expect(doneBtn).toBeTruthy();
    await act(async () => {
      fireEvent.click(doneBtn);
    });

    await waitFor(() => {
      expect(sheet?.getAttribute('data-open')).toBe('false');
    });
    expect(window.location.pathname).toBe('/m/characters');
    expect(tabBar?.hasAttribute('hidden')).toBe(false);
  });

  it('keeps engine runtime idle on initial load, supports children injection, and guards late bootstrap responses after destroy', async () => {
    let resolveBootstrap: (() => void) | null = null;
    const bootstrapPromise = new Promise<void>((resolve) => {
      resolveBootstrap = resolve;
    });

    const initializeMock = vi.fn(async () => {
      await bootstrapPromise;
    });
    const captureSessionMock = vi.fn(async () => ({ accountId: '1', sessionId: '1' }));
    const settingsSpy = vi.fn(async () => ({ settings: '{}' }));
    const charactersSpy = vi.fn(async () => []);

    const client = {
      initialize: initializeMock,
      settings: settingsSpy,
      characters: charactersSpy,
      go: {
        captureSessionContext: captureSessionMock,
      },
    } as unknown as ReturnType<typeof createAppClient>;

    const prepareRuntime = vi.fn(async () => ({}) as any);
    const sessionBridge = createSessionBridge(client, {
      prepareRuntime,
    });

    // 1. Direct MobileApp mount with children injection and idle engine check
    const { unmount } = render(
      <MobileApp client={client} sessionBridge={sessionBridge}>
        <div data-testid="injected-child">自定义注入节点</div>
      </MobileApp>,
    );
    expect(document.documentElement.dataset.vcDevice).toBe('mobile');
    expect(screen.getByTestId('injected-child').textContent).toBe('自定义注入节点');
    expect(prepareRuntime).not.toHaveBeenCalled();
    expect(settingsSpy).not.toHaveBeenCalled();
    expect(charactersSpy).not.toHaveBeenCalled();
    expect(sessionBridge.getSnapshot().runtime).toBe('idle');
    unmount();

    // 2. mountMobileApp bootstrap lifecycle + destroy guard before late bootstrap response
    const host = document.createElement('div');
    document.body.appendChild(host);

    const mounted = mountMobileApp(host, {
      client,
      sessionBridge,
      children: <div data-testid="boot-child">启动后子节点</div>,
    });

    try {
      expect(document.documentElement.dataset.vcDevice).toBe('mobile');
      expect(document.documentElement.dataset.vcApp).toBe('booting');
      expect(prepareRuntime).not.toHaveBeenCalled();

      // Destroy before bootstrap resolves
      mounted?.destroy();
      expect(document.documentElement.dataset.vcDevice).toBeUndefined();
      expect(document.documentElement.dataset.vcApp).toBeUndefined();

      // Resolve late bootstrap response after destroy — must not throw or mutate unmounted state
      await act(async () => {
        resolveBootstrap?.();
        await bootstrapPromise;
      });
      expect(document.documentElement.dataset.vcApp).toBeUndefined();
      expect(captureSessionMock).not.toHaveBeenCalled();
      expect(prepareRuntime).not.toHaveBeenCalled();
    } finally {
      host.remove();
    }
  });

  it('enforces mobile CSS & adaptation constraints (no 100vh, no negative margins, no !important, no innerWidth, safe-area-left/right, no manual history pushState/replaceState)', () => {
    const mobileSrcDir = resolve(__dirname, '../../src/mobile');
    function collectFiles(dir: string): string[] {
      const out: string[] = [];
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          out.push(...collectFiles(full));
        } else if (/\.(css|ts|tsx)$/.test(entry)) {
          out.push(full);
        }
      }
      return out;
    }

    const files = collectFiles(mobileSrcDir);
    const cssFiles = files.filter((f) => f.endsWith('.css'));
    expect(cssFiles.length).toBeGreaterThanOrEqual(1);

    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      expect(content, `${file} must not use 100vh`).not.toMatch(/\b100vh\b/);
      expect(content, `${file} must not use !important`).not.toContain('!important');
      expect(content, `${file} must not use innerWidth`).not.toContain('innerWidth');
      expect(content, `${file} must not call history.pushState`).not.toContain('history.pushState');
      expect(content, `${file} must not call history.replaceState`).not.toContain('history.replaceState');
      if (file.endsWith('.css')) {
        expect(
          content,
          `${file} must not use negative margins`,
        ).not.toMatch(/margin(?:-(?:top|right|bottom|left|inline|block|inline-start|inline-end|block-start|block-end))?\s*:\s*-[0-9.]/);
      }
    }

    const allMobileCss = cssFiles.map((f) => readFileSync(f, 'utf8')).join('\n');
    expect(allMobileCss).toContain('[data-vc-device="mobile"]');
    expect(allMobileCss).toContain('#eef0f6');
    expect(allMobileCss).toContain('#07070a');
    expect(allMobileCss).toContain('prefers-reduced-transparency: reduce');
    expect(allMobileCss).toContain('--ion-safe-area-left');
    expect(allMobileCss).toContain('--ion-safe-area-right');
    expect(allMobileCss).toContain('--mob-sheet-bg: rgba(242, 243, 248, 0.88);');
    expect(allMobileCss).toContain('--mob-sheet-bg: rgba(20, 20, 24, 0.90);');
    expect(allMobileCss).not.toContain('--ion-modal-offset-top');
    expect(allMobileCss).toContain('--mob-large-title-block:');
    expect(allMobileCss).toContain('html[data-vc-device="mobile"] body');
    expect(allMobileCss).toContain('min-height: var(--mob-large-title-block);');
    expect(allMobileCss).toContain('--height: calc(100% - var(--mob-large-title-block));');
    expect(allMobileCss).toContain('--border-radius: var(--vc-radius-sheet);');
    expect(allMobileCss).toContain('--background: transparent;');
    expect(allMobileCss).toContain('--backdrop-opacity: 1;');
    expect(allMobileCss).toContain('.vc-mobile-settings-modal::part(backdrop)');
    expect(allMobileCss).not.toContain('.vc-mobile-settings-modal::part(content)');
    expect(allMobileCss).toMatch(
      /@media\s*\(orientation:\s*landscape\)\s*and\s*\(max-height:\s*500px\)\s*\{\s*[^{]*\[data-vc-theme\][^{]*\{\s*--mob-header-pad-top:\s*6px;/,
    );

    const shellTsx = readFileSync(resolve(mobileSrcDir, 'shell/MobileShell.tsx'), 'utf8');
    expect(shellTsx).toContain('SECONDARY_SLOT_RENDERERS');
    expect(shellTsx).not.toMatch(/slotKey\s*===\s*'chat-detail'\s*\?/);
  });
});
