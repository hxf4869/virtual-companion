import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { AppProviders } from './providers';
import { createDesktopRouter, type DesktopRouteComponents } from './router';
import { createAppClient, type AppClient } from '../data/client';
import '../design/tokens.css';
import '../design/base.css';

export interface AppProps {
  client?: AppClient;
  routeOverrides?: DesktopRouteComponents;
}

type BootState = 'booting' | 'ready' | 'error';

export function App({ client: externalClient, routeOverrides }: AppProps = {}) {
  const clientRef = useRef<AppClient | null>(externalClient ?? null);
  if (!clientRef.current) {
    clientRef.current = createAppClient();
  }
  const client = clientRef.current;

  const [bootState, setBootState] = useState<BootState>('booting');
  const [errorMessage, setErrorMessage] = useState<string>('');

  const router = useMemo(
    () => createDesktopRouter({ routeOverrides }),
    [routeOverrides],
  );

  const runBootstrap = useCallback(async () => {
    setBootState('booting');
    setErrorMessage('');
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.dataset.vcApp = 'booting';
    }
    try {
      await client.initialize();
      await client.go.captureSessionContext();
      if (typeof document !== 'undefined' && document.documentElement) {
        document.documentElement.dataset.vcApp = 'ready';
      }
      setBootState('ready');
    } catch (err) {
      if (typeof document !== 'undefined' && document.documentElement) {
        document.documentElement.dataset.vcApp = 'error';
      }
      setErrorMessage(err instanceof Error ? err.message : '加载失败，请稍后重试');
      setBootState('error');
    }
  }, [client]);

  useEffect(() => {
    void runBootstrap();
  }, [runBootstrap]);

  if (bootState === 'booting') {
    return (
      <p id="vc-desktop-startup" role="status">
        正在打开聊天…
      </p>
    );
  }

  if (bootState === 'error') {
    return (
      <div id="vc-desktop-startup-error" role="alert">
        <p>{errorMessage || '加载失败，请稍后重试'}</p>
        <button type="button" onClick={() => void runBootstrap()}>
          重试
        </button>
      </div>
    );
  }

  return (
    <AppProviders client={client}>
      <RouterProvider router={router} />
    </AppProviders>
  );
}

export function mountDesktopApp(
  container: HTMLElement | null = document.getElementById('vc-app-root'),
  props?: AppProps,
): Root | null {
  if (!container) return null;
  document.documentElement.dataset.vcApp = 'booting';
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <App {...props} />
    </React.StrictMode>,
  );
  return root;
}

if (typeof document !== 'undefined') {
  const autoRoot = document.getElementById('vc-app-root');
  if (autoRoot && !autoRoot.hasAttribute('data-vc-manual-mount')) {
    mountDesktopApp(autoRoot);
  }
}
