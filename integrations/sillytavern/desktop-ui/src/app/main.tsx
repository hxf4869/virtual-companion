import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { AppProviders } from './providers';
import { createDesktopRouter, type DesktopRouteComponents } from './router';
import { createAppClient, type AppClient } from '../data/client';
import { AppConsentGate } from '../features/settings/AppConsentGate';
import { DesktopPreferences } from '../shell/DesktopPreferences';
import '../design/tokens.css';
import '../design/base.css';

export interface AppProps {
  client?: AppClient;
  routeOverrides?: DesktopRouteComponents;
}

type BootState = 'booting' | 'ready' | 'error';

export function App({ client: externalClient, routeOverrides }: AppProps = {}) {
  const clientRef = useRef<AppClient | null>(externalClient ?? null);
  if (externalClient && clientRef.current !== externalClient) {
    clientRef.current = externalClient;
  }
  if (!clientRef.current) {
    clientRef.current = createAppClient();
  }
  const client = clientRef.current;

  const [bootState, setBootState] = useState<BootState>('booting');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const bootTokenRef = useRef(0);

  const router = useMemo(
    () => createDesktopRouter({ routeOverrides }),
    [routeOverrides],
  );

  const runBootstrap = useCallback(async () => {
    const token = ++bootTokenRef.current;
    setBootState('booting');
    setErrorMessage('');
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.dataset.vcApp = 'booting';
    }
    try {
      await client.initialize();
      if (bootTokenRef.current !== token) return;
      await client.go.captureSessionContext();
      if (bootTokenRef.current !== token) return;
      if (typeof document !== 'undefined' && document.documentElement) {
        document.documentElement.dataset.vcApp = 'ready';
      }
      setBootState('ready');
    } catch (err) {
      if (bootTokenRef.current !== token) return;
      if (typeof document !== 'undefined' && document.documentElement) {
        document.documentElement.dataset.vcApp = 'error';
      }
      setErrorMessage(err instanceof Error ? err.message : '加载失败，请稍后重试');
      setBootState('error');
    }
  }, [client]);

  useEffect(() => {
    void runBootstrap();
    return () => {
      bootTokenRef.current += 1;
    };
  }, [runBootstrap]);

  if (bootState === 'booting') {
    return (
      <div data-vc-app="booting">
        <p id="vc-desktop-startup" role="status">
          正在打开聊天…
        </p>
      </div>
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
    <AppProviders client={client} eagerRuntime>
      <AppConsentGate>
        <DesktopPreferences />
        <RouterProvider router={router} />
      </AppConsentGate>
    </AppProviders>
  );
}

export function mountApp(
  container: HTMLElement | null = typeof document !== 'undefined'
    ? document.getElementById('root')
    : null,
  props?: AppProps,
): Root | null {
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.dataset.vcApp = 'booting';
  }
  if (!container) return null;
  const root = createRoot(container);
  root.render(<App {...props} />);
  return root;
}

export { mountApp as mountDesktopApp };

if (typeof document !== 'undefined') {
  const autoRoot = document.getElementById('root');
  if (autoRoot && !autoRoot.hasAttribute('data-vc-manual-mount')) {
    mountApp(autoRoot);
  }
}
