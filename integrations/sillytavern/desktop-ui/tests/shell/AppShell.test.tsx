import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppProviders } from '../../src/app/providers';
import { AppShell } from '../../src/shell/AppShell';
import { Aurora, timeOfDayShift } from '../../src/shell/Aurora';
import { THEME_PREF_EVENT, usePreferences } from '../../src/shell/usePreferences';
import { useReducedMotion } from '../../src/shell/useReducedMotion';
import { Dialog } from '../../src/design/components/Dialog';
import { Select } from '../../src/design/components/Select';
import { Menu } from '../../src/design/components/Menu';
import { toast } from '../../src/design/components/Toast';
import type { AppClient } from '../../src/data/client';

type ChangeListener = () => void;

function setupMatchMedia(initialWidth: number, initialReducedMotion = false) {
  let width = initialWidth;
  let reducedMotion = initialReducedMotion;
  const queries = new Map<string, { listeners: Set<ChangeListener>; mql: MediaQueryList }>();

  const evalQuery = (query: string): boolean => {
    if (query.includes('prefers-reduced-motion')) return reducedMotion;
    const match = query.match(/\(min-width:\s*(\d+)px\)/);
    if (match) return width >= Number(match[1]);
    return false;
  };

  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string): MediaQueryList => {
      const existing = queries.get(query);
      if (existing) return existing.mql;
      const listeners = new Set<ChangeListener>();
      const mql = {
        media: query,
        get matches() {
          return evalQuery(query);
        },
        onchange: null,
        addEventListener: vi.fn((type: string, cb: EventListenerOrEventListenerObject) => {
          if (type === 'change' && typeof cb === 'function') listeners.add(cb as ChangeListener);
        }),
        removeEventListener: vi.fn((type: string, cb: EventListenerOrEventListenerObject) => {
          if (type === 'change' && typeof cb === 'function') listeners.delete(cb as ChangeListener);
        }),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      } as unknown as MediaQueryList;
      queries.set(query, { listeners, mql });
      return mql;
    }),
  );

  return {
    setWidth(nextWidth: number) {
      width = nextWidth;
      for (const { listeners } of queries.values()) {
        for (const l of listeners) l();
      }
    },
    setReducedMotion(next: boolean) {
      reducedMotion = next;
      for (const { listeners } of queries.values()) {
        for (const l of listeners) l();
      }
    },
  };
}

function createFakeClient(): AppClient {
  return {
    initialize: vi.fn(async () => ({
      characters: [
        { avatar: 'alice.png', name: 'Alice', description: 'Friend' },
        { avatar: 'bob.png', name: 'Bob', description: 'Companion' },
      ],
      chat: [],
      settings: {},
    })),
    go: {
      captureSessionContext: vi.fn(async () => ({
        userId: 'u-1',
        sessionId: 's-1',
      })),
    },
  } as unknown as AppClient;
}

describe('AppShell layout, portal host & reduced motion', () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.chrome;
    delete document.documentElement.dataset.vcReducedMotion;
    delete document.documentElement.dataset.vcTheme;
    delete document.documentElement.dataset.vcThemeId;
    document.documentElement.removeAttribute('data-vc-variant-bubble');
    usePreferences.getState().resetForTest?.();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('compact hides list after entering conversation and list button reopens it', () => {
    setupMatchMedia(900);
    const client = createFakeClient();

    const { rerender } = render(
      <AppProviders client={client}>
        <AppShell
          destination="chat"
          activeConversationKey={null}
          conversations={[
            { key: 'conv-alice', title: 'Alice', avatar: 'alice.png', relationshipId: 'rel-1' },
          ]}
        >
          <div data-testid="chat-slot">Chat Content</div>
        </AppShell>
      </AppProviders>,
    );

    const listEl = document.querySelector('[data-convo-list]') as HTMLElement;
    expect(listEl).toBeTruthy();
    expect(listEl.hidden).toBe(false);

    // Entering a conversation on compact hides the list
    rerender(
      <AppProviders client={client}>
        <AppShell
          destination="chat"
          activeConversationKey="conv-alice"
          conversations={[
            { key: 'conv-alice', title: 'Alice', avatar: 'alice.png', relationshipId: 'rel-1' },
          ]}
        >
          <div data-testid="chat-slot">Chat Content</div>
        </AppShell>
      </AppProviders>,
    );

    expect(listEl.hidden).toBe(true);
    const activeRow = document.querySelector('[data-conversation-key="conv-alice"]') as HTMLElement;
    expect(activeRow.getAttribute('aria-current')).toBe('true');

    // Clicking the header return-to-list / list toggle button reopens the list
    const listBtn = document.querySelector('[data-list-toggle]') as HTMLButtonElement;
    expect(listBtn).toBeTruthy();
    fireEvent.click(listBtn);
    expect(listEl.hidden).toBe(false);
  });

  it('wide shows four columns with panel open by default', () => {
    setupMatchMedia(1680);
    const client = createFakeClient();

    render(
      <AppProviders client={client}>
        <AppShell
          destination="chat"
          activeConversationKey="conv-alice"
          conversations={[
            { key: 'conv-alice', title: 'Alice', avatar: 'alice.png', relationshipId: 'rel-1' },
          ]}
          characterPanel={<div data-testid="char-panel-content">Alice Profile</div>}
        >
          <div data-testid="chat-slot">Chat Content</div>
        </AppShell>
      </AppProviders>,
    );

    const shell = document.getElementById('vc-shell') as HTMLElement;
    expect(shell.dataset.chrome).toBe('wide');

    const sidebar = document.querySelector('.vc-sidebar') as HTMLElement;
    const listEl = document.querySelector('[data-convo-list]') as HTMLElement;
    const mainEl = document.querySelector('[data-shell-main]') as HTMLElement;
    const panelEl = document.querySelector('[data-char-panel]') as HTMLElement;

    expect(sidebar).toBeTruthy();
    expect(listEl.hidden).toBe(false);
    expect(mainEl).toBeTruthy();
    expect(panelEl).toBeTruthy();
    expect(panelEl.hidden).toBe(false);
    expect(shell.dataset.panelOpen).toBe('true');
  });

  it('regular yields conversation list when character panel opens', () => {
    setupMatchMedia(1360);
    const client = createFakeClient();

    render(
      <AppProviders client={client}>
        <AppShell
          destination="chat"
          activeConversationKey="conv-alice"
          conversations={[
            { key: 'conv-alice', title: 'Alice', avatar: 'alice.png', relationshipId: 'rel-1' },
          ]}
          characterPanel={<div data-testid="char-panel-content">Alice Profile</div>}
        >
          <div data-testid="chat-slot">Chat Content</div>
        </AppShell>
      </AppProviders>,
    );

    const listEl = document.querySelector('[data-convo-list]') as HTMLElement;
    const panelEl = document.querySelector('[data-char-panel]') as HTMLElement;
    expect(listEl.hidden).toBe(false);
    expect(panelEl.hidden).toBe(true);

    // Open character panel -> 320px conversation list yields
    const panelToggle = document.querySelector('[data-panel-toggle]') as HTMLButtonElement;
    expect(panelToggle).toBeTruthy();
    fireEvent.click(panelToggle);

    expect(panelEl.hidden).toBe(false);
    expect(listEl.hidden).toBe(true);

    // Close character panel -> conversation list restores
    fireEvent.click(panelToggle);
    expect(panelEl.hidden).toBe(true);
    expect(listEl.hidden).toBe(false);
  });

  it('narrow enforces list-only vs main-only mutual exclusion, 72px icon sidebar, 32px dialog margin, and floating panel inside chat body', () => {
    setupMatchMedia(375);
    const client = createFakeClient();

    const { rerender } = render(
      <AppProviders client={client}>
        <AppShell
          destination="chat"
          activeConversationKey={null}
          conversations={[
            { key: 'conv-alice', title: 'Alice', avatar: 'alice.png', relationshipId: 'rel-1' },
          ]}
          characterPanel={<div data-testid="char-panel-content">Alice Profile</div>}
          composer={<div data-testid="composer-slot">Composer</div>}
        >
          <div data-testid="chat-slot">Chat Content</div>
        </AppShell>
      </AppProviders>,
    );

    const shell = document.getElementById('vc-shell') as HTMLElement;
    const sidebar = document.querySelector('.vc-sidebar') as HTMLElement;
    const listEl = document.querySelector('[data-convo-list]') as HTMLElement;
    const mainEl = document.querySelector('[data-shell-main]') as HTMLElement;

    expect(sidebar.classList.contains('is-collapsed')).toBe(true);
    // Before entering conversation on narrow: list-only, main is hidden
    expect(shell.dataset.layout).toBe('list-only');
    expect(listEl.hidden).toBe(false);
    expect(mainEl.hidden).toBe(true);

    // Enter conversation on narrow: main-only, list is hidden, main is shown
    rerender(
      <AppProviders client={client}>
        <AppShell
          destination="chat"
          activeConversationKey="conv-alice"
          conversations={[
            { key: 'conv-alice', title: 'Alice', avatar: 'alice.png', relationshipId: 'rel-1' },
          ]}
          characterPanel={<div data-testid="char-panel-content">Alice Profile</div>}
          composer={<div data-testid="composer-slot">Composer</div>}
        >
          <div data-testid="chat-slot">Chat Content</div>
        </AppShell>
      </AppProviders>,
    );

    expect(shell.dataset.layout).toBe('main-only');
    expect(listEl.hidden).toBe(true);
    expect(mainEl.hidden).toBe(false);

    // Open character panel in narrow mode: must live inside [data-chat-body], not covering header or composer
    const panelToggle = document.querySelector('[data-panel-toggle]') as HTMLButtonElement;
    fireEvent.click(panelToggle);

    const chatHeader = document.querySelector('[data-chat-header]') as HTMLElement;
    const chatBody = document.querySelector('[data-chat-body]') as HTMLElement;
    const chatComposer = document.querySelector('[data-chat-composer]') as HTMLElement;
    const panelEl = document.querySelector('[data-char-panel]') as HTMLElement;

    expect(chatHeader).toBeTruthy();
    expect(chatBody).toBeTruthy();
    expect(chatComposer).toBeTruthy();
    expect(chatBody.contains(panelEl)).toBe(true);
    expect(chatHeader.contains(panelEl)).toBe(false);
    expect(chatComposer.contains(panelEl)).toBe(false);

    // Clicking return-to-list button on narrow flips back to list-only (main hidden, list shown)
    const listToggle = document.querySelector('[data-list-toggle]') as HTMLButtonElement;
    fireEvent.click(listToggle);
    expect(shell.dataset.layout).toBe('list-only');
    expect(listEl.hidden).toBe(false);
    expect(mainEl.hidden).toBe(true);

    // Verify CSS contract for narrow viewport dialog margin and min-width: 0
    const cssText = readFileSync(
      resolve(__dirname, '../../src/shell/AppShell.css'),
      'utf8',
    );
    expect(cssText).toMatch(/html\[data-chrome="narrow"\][\s\S]*?--vc-dialog-viewport-margin:\s*32px/);
    expect(cssText).not.toMatch(/data-chrome="narrow"[\s\S]*?560px/);
  });

  it('enforces L1/L2 glass hierarchy in AppShell.css and renders sliding Sidebar selection lens', () => {
    setupMatchMedia(1440);
    const client = createFakeClient();

    const { rerender } = render(
      <AppProviders client={client}>
        <AppShell destination="chat" settingsActive={false}>
          <div>Content</div>
        </AppShell>
      </AppProviders>,
    );

    const sidebar = document.querySelector('.vc-sidebar') as HTMLElement;
    const lens = sidebar.querySelector('.vc-desktop-lens') as HTMLElement;
    expect(lens).toBeTruthy();
    expect(lens.getAttribute('aria-hidden')).toBe('true');
    expect(lens.dataset.lensTarget).toBe('chat');
    // Without layout geometry (0x0 rect in HappyDOM), lens stays hidden instead of using magic fallback dimensions
    expect(lens.style.opacity).toBe('0');
    expect(lens.style.width).toBe('');

    // Simulate 1px border on sidebar (clientLeft/clientTop = 1) and provide bounding boxes for sidebar + nav items
    Object.defineProperty(sidebar, 'clientLeft', { value: 1, configurable: true });
    Object.defineProperty(sidebar, 'clientTop', { value: 1, configurable: true });
    vi.spyOn(sidebar, 'getBoundingClientRect').mockReturnValue({
      left: 24,
      top: 24,
      width: 200,
      height: 800,
      right: 224,
      bottom: 824,
      x: 24,
      y: 24,
      toJSON: () => ({}),
    });
    const chatBtn = sidebar.querySelector('[data-nav="chat"]') as HTMLElement;
    const memoryBtn = sidebar.querySelector('[data-nav="memory"]') as HTMLElement;
    const settingsBtn = sidebar.querySelector('[data-settings]') as HTMLElement;
    vi.spyOn(chatBtn, 'getBoundingClientRect').mockReturnValue({
      left: 37,
      top: 85,
      width: 176,
      height: 44,
      right: 213,
      bottom: 129,
      x: 37,
      y: 85,
      toJSON: () => ({}),
    });
    let memoryWidth = 176;
    vi.spyOn(memoryBtn, 'getBoundingClientRect').mockImplementation(() => ({
      left: 37,
      top: 173,
      width: memoryWidth,
      height: 44,
      right: 37 + memoryWidth,
      bottom: 217,
      x: 37,
      y: 173,
      toJSON: () => ({}),
    }));
    vi.spyOn(settingsBtn, 'getBoundingClientRect').mockReturnValue({
      left: 37,
      top: 761,
      width: 176,
      height: 44,
      right: 213,
      bottom: 805,
      x: 37,
      y: 761,
      toJSON: () => ({}),
    });

    // Switching destination updates lens target and real position/dimensions (subtracting sidebar border clientLeft/clientTop = 1)
    rerender(
      <AppProviders client={client}>
        <AppShell destination="memory" settingsActive={false}>
          <div>Content</div>
        </AppShell>
      </AppProviders>,
    );
    expect(lens.dataset.lensTarget).toBe('memory');
    expect(lens.style.opacity).toBe('1');
    expect(lens.style.width).toBe('176px');
    expect(lens.style.height).toBe('44px');
    expect(lens.style.transform).toBe('translate(12px, 148px)');

    // Collapsing sidebar reflows the lens to the collapsed item width
    memoryWidth = 44;
    const collapseBtn = sidebar.querySelector('[data-collapse]') as HTMLButtonElement;
    fireEvent.click(collapseBtn);
    expect(lens.style.width).toBe('44px');
    expect(lens.style.height).toBe('44px');

    rerender(
      <AppProviders client={client}>
        <AppShell destination="memory" settingsActive={true}>
          <div>Content</div>
        </AppShell>
      </AppProviders>,
    );
    expect(lens.dataset.lensTarget).toBe('settings');
    expect(lens.style.transform).toBe('translate(12px, 736px)');

    // Check L1 (.vc-sidebar: --vc-glass-1 + --vc-blur-1) vs L2 (--vc-glass-2 + --vc-blur-2) in AppShell.css
    const cssText = readFileSync(
      resolve(__dirname, '../../src/shell/AppShell.css'),
      'utf8',
    );
    expect(cssText).toMatch(/\.vc-sidebar\s*\{[\s\S]*?--vc-glass-1[\s\S]*?--vc-blur-1/);
    expect(cssText).toMatch(/\.vc-panel\s*\{[\s\S]*?--vc-glass-2[\s\S]*?--vc-blur-2/);
    expect(cssText).toMatch(/\.vc-desktop-lens\s*\{[\s\S]*?--vc-select-fill[\s\S]*?--vc-spring/);
  });

  it('portal host renders overlays and Toast inside shell OverlayHost and preserves nested Dialog -> Select/Menu portal hierarchy & focus', async () => {
    setupMatchMedia(1440);
    const client = createFakeClient();

    function OverlayConsumer() {
      const [dialogOpen, setDialogOpen] = useState(false);
      const [fruit, setFruit] = useState('apple');

      return (
        <div>
          <button
            type="button"
            data-testid="open-dialog-btn"
            onClick={() => setDialogOpen(true)}
          >
            打开弹窗
          </button>
          <button
            type="button"
            data-testid="show-toast-btn"
            onClick={() => toast.show({ title: '已保存设置', kind: 'success' })}
          >
            弹Toast
          </button>
          <Dialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            title="偏好弹窗"
            description="测试嵌套浮层"
          >
            <div data-testid="dialog-inner">
              <Select
                aria-label="水果选择"
                value={fruit}
                onValueChange={setFruit}
                options={[
                  { value: 'apple', label: '苹果' },
                  { value: 'pear', label: '梨子' },
                ]}
              />
              <Menu
                trigger={<button type="button" data-testid="nested-menu-trigger">更多操作</button>}
                items={[
                  { id: 'copy', label: '复制', onSelect: () => {} },
                ]}
              />
            </div>
          </Dialog>
        </div>
      );
    }

    render(
      <AppProviders client={client}>
        <AppShell destination="chat">
          <OverlayConsumer />
        </AppShell>
      </AppProviders>,
    );

    const overlayHost = document.getElementById('vc-overlay-host') as HTMLElement;
    const toastHost = document.querySelector('[data-vc-toast-host]') as HTMLElement;
    const mainEl = document.querySelector('[data-shell-main]') as HTMLElement;
    expect(overlayHost).toBeTruthy();
    expect(toastHost).toBeTruthy();
    expect(overlayHost.contains(toastHost)).toBe(true);
    expect(mainEl.contains(toastHost)).toBe(false);

    // 1. Trigger Toast -> renders inside toastHost (inside overlayHost, outside mainEl scroll/stacking context)
    fireEvent.click(screen.getByTestId('show-toast-btn'));
    const toastViewport = document.querySelector('.vc-toast-viewport') as HTMLElement;
    expect(toastViewport).toBeTruthy();
    expect(toastHost.contains(toastViewport)).toBe(true);
    expect(overlayHost.contains(toastViewport)).toBe(true);

    // 2. Open Dialog -> renders inside overlayHost
    fireEvent.click(screen.getByTestId('open-dialog-btn'));
    const dialogPopup = document.querySelector('.vc-dialog') as HTMLElement;
    expect(dialogPopup).toBeTruthy();
    expect(overlayHost.contains(dialogPopup)).toBe(true);
    const dialogPortal = dialogPopup.closest('[data-base-ui-portal]') as HTMLElement;
    expect(dialogPortal).toBeTruthy();

    // 3. Open nested Menu inside Dialog -> stays inside dialogPortal (Base UI parent-child portal hierarchy)
    const menuTrigger = screen.getByTestId('nested-menu-trigger');
    menuTrigger.focus();
    fireEvent.click(menuTrigger);

    const menuPopup = document.querySelector('.vc-menu') as HTMLElement;
    expect(menuPopup).toBeTruthy();
    expect(overlayHost.contains(menuPopup)).toBe(true);
    const menuPortal = menuPopup.closest('[data-base-ui-portal]') as HTMLElement;
    expect(menuPortal).toBeTruthy();
    expect(menuPortal).not.toBe(dialogPortal);
    expect(dialogPortal.contains(menuPortal)).toBe(true);

    // 4. Press Escape -> closes ONLY nested Menu, Dialog remains open and focus stays inside Dialog
    fireEvent.keyDown(menuPopup, { key: 'Escape', code: 'Escape' });
    expect(document.querySelector('.vc-dialog')).toBeTruthy();
    expect(dialogPopup.contains(document.activeElement)).toBe(true);
  });

  it('reduced motion preference, theme-logic delegation, and Aurora cross-fade / period / spot positions follow canonical contract', () => {
    vi.useFakeTimers();
    try {
      const ctl = setupMatchMedia(1440, false);

      // Verify theme-logic timeOfDayShift canonical boundaries (6/10/17/20 -> morning/noon/evening/night)
      expect(timeOfDayShift(new Date(2026, 10, 4, 8, 0))).toBe('morning');
      expect(timeOfDayShift(new Date(2026, 10, 4, 10, 30))).toBe('noon');
      expect(timeOfDayShift(new Date(2026, 10, 4, 18, 0))).toBe('evening');
      expect(timeOfDayShift(new Date(2026, 10, 4, 20, 30))).toBe('night');

      function Probe() {
        const reduced = useReducedMotion();
        const themeMode = usePreferences((s) => s.themeMode);
        const replyStyle = usePreferences((s) => s.replyStyle);
        const characterTint = usePreferences((s) => s.characterTint);
        return (
          <div>
            <span data-testid="reduced-val">{String(reduced)}</span>
            <span data-testid="theme-val">{themeMode}</span>
            <span data-testid="reply-val">{replyStyle}</span>
            <Aurora characterTint={characterTint} reducedMotion={reduced} />
          </div>
        );
      }

      render(<Probe />);

      expect(screen.getByTestId('reduced-val').textContent).toBe('false');
      expect(document.documentElement.dataset.vcReducedMotion).toBeUndefined();
      // Default mode 'auto' writes data-vc-theme="auto", data-vc-theme-id="aurora", and data-vc-variant-bubble="grouped"
      expect(document.documentElement.dataset.vcTheme).toBe('auto');
      expect(document.documentElement.dataset.vcThemeId).toBe('aurora');
      expect(document.documentElement.getAttribute('data-vc-variant-bubble')).toBe('grouped');
      expect(document.documentElement.dataset.vcDesktopTheme).toBeUndefined();

      // OS prefers-reduced-motion: reduce -> sets data-vc-reduced-motion="true"
      act(() => ctl.setReducedMotion(true));
      expect(screen.getByTestId('reduced-val').textContent).toBe('true');
      expect(document.documentElement.dataset.vcReducedMotion).toBe('true');

      act(() => ctl.setReducedMotion(false));
      expect(screen.getByTestId('reduced-val').textContent).toBe('false');
      expect(document.documentElement.dataset.vcReducedMotion).toBeUndefined();

      // App-level vc-reduced-motion toggle -> also sets data-vc-reduced-motion="true"
      act(() => usePreferences.getState().setReducedMotion(true));
      expect(screen.getByTestId('reduced-val').textContent).toBe('true');
      expect(document.documentElement.dataset.vcReducedMotion).toBe('true');
      expect(window.localStorage.getItem('vc-reduced-motion')).toBe('true');

      // Aurora cross-fade on characterTint change: new set enters with .is-entering, old set gets .is-leaving, max 2 sets
      act(() => usePreferences.getState().setCharacterTint('210,120,160'));
      expect(document.querySelectorAll('.vc-aurora-set').length).toBe(2);
      expect(document.querySelector('.vc-aurora-set.is-entering')).toBeTruthy();
      expect(document.querySelector('.vc-aurora-set.is-leaving')).toBeTruthy();

      // Rapid consecutive tint switch still keeps at most 2 sets
      act(() => usePreferences.getState().setCharacterTint('120,200,180'));
      expect(document.querySelectorAll('.vc-aurora-set').length).toBe(2);

      act(() => {
        vi.advanceTimersByTime(900);
      });
      expect(document.querySelectorAll('.vc-aurora-set').length).toBe(1);
      expect(document.querySelector('.vc-aurora-set.is-leaving')).toBeNull();

      // Preserves unknown theme strings in localStorage while resolving active theme to registry fallback ('aurora')
      const prefEvents: Event[] = [];
      const onPrefEvent = (e: Event) => prefEvents.push(e);
      window.addEventListener(THEME_PREF_EVENT, onPrefEvent);
      try {
        act(() => usePreferences.getState().setGlobalDesktopTheme('custom-future-theme'));
        expect(prefEvents.length).toBeGreaterThanOrEqual(1);
        const stored = JSON.parse(window.localStorage.getItem('vc-desktop-theme') || '{}');
        expect(stored.global).toBe('custom-future-theme');
        expect(usePreferences.getState().activeDesktopTheme).toBe('aurora');
        expect(document.documentElement.dataset.vcThemeId).toBe('aurora');
      } finally {
        window.removeEventListener(THEME_PREF_EVENT, onPrefEvent);
      }

      // Re-reading preferences from localStorage when switching page/character (fixes B11)
      window.localStorage.setItem('vc-theme', 'dark');
      window.localStorage.setItem('vc-reply-style', 'spread');
      act(() => usePreferences.getState().syncFromStorage('alice.png'));
      expect(screen.getByTestId('theme-val').textContent).toBe('dark');
      expect(screen.getByTestId('reply-val').textContent).toBe('spread');
      expect(document.documentElement.dataset.vcTheme).toBe('dark');

      // Check Aurora.css uses canonical calc() spot coordinates and has no fictional paper/smoke rules
      const auroraCss = readFileSync(
        resolve(__dirname, '../../src/design/theme/Aurora.css'),
        'utf8',
      );
      expect(auroraCss).toContain('calc(15vw - 30vmax)');
      expect(auroraCss).toContain('calc(85vw - 30vmax)');
      expect(auroraCss).toContain('calc(50vw - 30vmax)');
      expect(auroraCss).not.toMatch(/paper|smoke/);
    } finally {
      vi.useRealTimers();
    }
  });
});
