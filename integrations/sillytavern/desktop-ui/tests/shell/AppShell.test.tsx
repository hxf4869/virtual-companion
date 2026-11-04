import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppProviders } from '../../src/app/providers';
import { AppShell } from '../../src/shell/AppShell';
import { Aurora } from '../../src/shell/Aurora';
import { usePreferences } from '../../src/shell/usePreferences';
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
    st: {},
    session: {},
    cardRuntime: {},
  } as unknown as AppClient;
}

describe('AppShell layout, portal host & reduced motion', () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.chrome;
    delete document.documentElement.dataset.vcReducedMotion;
    delete document.documentElement.dataset.vcTheme;
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

  it('narrow keeps 72px icon sidebar, overrides --vc-dialog-viewport-margin to 32px, and constrains floating character panel to chat body', () => {
    setupMatchMedia(680);
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
          composer={<div data-testid="composer-slot">Composer</div>}
        >
          <div data-testid="chat-slot">Chat Content</div>
        </AppShell>
      </AppProviders>,
    );

    const sidebar = document.querySelector('.vc-sidebar') as HTMLElement;
    expect(sidebar.classList.contains('is-collapsed')).toBe(true);

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

    // Verify CSS contract for narrow viewport dialog margin and min-width: 0
    const cssText = readFileSync(
      resolve(__dirname, '../../src/shell/AppShell.css'),
      'utf8',
    );
    expect(cssText).toMatch(/html\[data-chrome="narrow"\][\s\S]*?--vc-dialog-viewport-margin:\s*32px/);
    expect(cssText).not.toMatch(/data-chrome="narrow"[\s\S]*?560px/);
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

  it('reduced motion preference and OS media query both set data-vc-reduced-motion and pause Aurora, and preferences re-read on switch', () => {
    vi.useFakeTimers();
    try {
      const ctl = setupMatchMedia(1440, false);

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
            <Aurora characterTint={characterTint} />
          </div>
        );
      }

      render(<Probe />);

      expect(screen.getByTestId('reduced-val').textContent).toBe('false');
      expect(document.documentElement.dataset.vcReducedMotion).toBeUndefined();

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

      // Aurora cross-fade on characterTint change (900ms)
      act(() => usePreferences.getState().setCharacterTint('210, 120, 160'));
      expect(document.querySelectorAll('.vc-aurora-set').length).toBe(2);
      expect(document.querySelector('.vc-aurora-set.is-leaving')).toBeTruthy();

      act(() => {
        vi.advanceTimersByTime(900);
      });
      expect(document.querySelectorAll('.vc-aurora-set').length).toBe(1);

      // Re-reading preferences from localStorage when switching page/character (fixes B11)
      window.localStorage.setItem('vc-theme', 'dark');
      window.localStorage.setItem('vc-reply-style', 'spread');
      act(() => usePreferences.getState().syncFromStorage('alice.png'));
      expect(screen.getByTestId('theme-val').textContent).toBe('dark');
      expect(screen.getByTestId('reply-val').textContent).toBe('spread');
      expect(document.documentElement.dataset.vcTheme).toBe('dark');
    } finally {
      vi.useRealTimers();
    }
  });
});
