import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import { RouterProvider } from '@tanstack/react-router';
import { App } from '../../src/app/main';
import { AppProviders } from '../../src/app/providers';
import { createDesktopRouter } from '../../src/app/router';
import { useLeaveGuard } from '../../src/shell/useLeaveGuard';
import type { AppClient } from '../../src/data/client';

function installMatchMedia() {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string): MediaQueryList => ({
      media: query,
      matches: query.includes('744') || query.includes('1180'),
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList)),
  );
}

function createFakeClient(): AppClient {
  return {
    initialize: vi.fn(async () => ({
      characters: [{ avatar: 'alice.png', name: 'Alice', description: 'Friend' }],
      chat: [],
      settings: {},
    })),
    go: {
      captureSessionContext: vi.fn(async () => ({ userId: 'u-1', sessionId: 's-1' })),
    },
    st: {},
    session: {},
    cardRuntime: {},
  } as unknown as AppClient;
}

describe('Desktop Router & useLeaveGuard', () => {
  beforeEach(() => {
    installMatchMedia();
    window.localStorage.clear();
    window.location.hash = '';
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('redirects / to /chat and supports all primary routes under hash history', async () => {
    const client = createFakeClient();
    const router = createDesktopRouter();

    render(
      <AppProviders client={client}>
        <RouterProvider router={router} />
      </AppProviders>,
    );

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/chat');
    });

    await act(async () => {
      await router.navigate({ to: '/characters' });
    });
    expect(router.state.location.pathname).toBe('/characters');

    await act(async () => {
      await router.navigate({ to: '/memory' });
    });
    expect(router.state.location.pathname).toBe('/memory');

    await act(async () => {
      await router.navigate({ to: '/inbox' });
    });
    expect(router.state.location.pathname).toBe('/inbox');

    await act(async () => {
      await router.navigate({ to: '/story' });
    });
    expect(router.state.location.pathname).toBe('/story');

    await act(async () => {
      await router.navigate({ to: '/settings/$category', params: { category: 'appearance' } });
    });
    expect(router.state.location.pathname).toBe('/settings/appearance');

    await act(async () => {
      await router.navigate({ to: '/settings/tavern/$section', params: { section: 'world-info' } });
    });
    expect(router.state.location.pathname).toBe('/settings/tavern/world-info');
  });

  it('useLeaveGuard blocks navigation with AlertDialog when dirty and proceeds on confirm or stays on cancel', async () => {
    const client = createFakeClient();

    function DirtyFormPage() {
      const [dirty, setDirty] = useState(true);
      const leaveGuardModal = useLeaveGuard(dirty);
      return (
        <div data-testid="dirty-form-page">
          <button type="button" onClick={() => setDirty(false)}>
            Clear Dirty
          </button>
          {leaveGuardModal}
        </div>
      );
    }

    const router = createDesktopRouter({
      routeOverrides: {
        memory: DirtyFormPage,
      },
    });

    render(
      <AppProviders client={client}>
        <RouterProvider router={router} />
      </AppProviders>,
    );

    await act(async () => {
      await router.navigate({ to: '/memory' });
    });
    expect(await screen.findByTestId('dirty-form-page')).toBeTruthy();

    // Attempt to navigate away while dirty -> blocked by AlertDialog
    act(() => {
      void router.navigate({ to: '/inbox' });
    });

    const alertTitle = await screen.findByText('放弃更改？');
    expect(alertTitle).toBeTruthy();
    expect(router.state.location.pathname).toBe('/memory');

    // Click cancel ("继续编辑") -> stays on /memory and closes AlertDialog
    fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
    await waitFor(() => {
      expect(screen.queryByText('放弃更改？')).toBeNull();
    });
    expect(router.state.location.pathname).toBe('/memory');

    // Attempt to navigate away again -> confirm ("放弃") -> proceeds to /inbox
    act(() => {
      void router.navigate({ to: '/inbox' });
    });
    await screen.findByText('放弃更改？');
    fireEvent.click(screen.getByRole('button', { name: '放弃' }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/inbox');
    });
  });

  it('App bootstrap initializes single AppClient owner and supports recoverable retry on failure', async () => {
    let attempts = 0;
    const client = {
      initialize: vi.fn(async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('初始化连接失败');
        }
        return { characters: [], chat: [], settings: {} };
      }),
      go: {
        captureSessionContext: vi.fn(async () => ({ userId: 'u-1', sessionId: 's-1' })),
      },
      st: {},
      session: {},
      cardRuntime: {},
    } as unknown as AppClient;

    render(<App client={client} />);
    expect(document.documentElement.dataset.vcApp).toBe('booting');
    expect(screen.getByRole('status').textContent).toBe('正在打开聊天…');

    // First attempt fails -> shows recoverable error alert
    const alertEl = await screen.findByRole('alert');
    expect(alertEl.textContent).toContain('初始化连接失败');
    expect(document.documentElement.dataset.vcApp).toBe('error');

    // Click retry -> succeeds and mounts shell in ready state
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => {
      expect(document.documentElement.dataset.vcApp).toBe('ready');
      expect(document.getElementById('vc-shell')).toBeTruthy();
    });
    expect(client.initialize).toHaveBeenCalledTimes(2);
    expect(client.go.captureSessionContext).toHaveBeenCalledTimes(1);
  });
});
