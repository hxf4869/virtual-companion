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
  });
});
