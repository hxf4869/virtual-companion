import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createAppClient, type AppClient } from '../../data/client';
import { MobileApp, type MobileAppProps } from './MobileApp';
import '../../design/tokens.css';
import '../../design/base.css';

type BootState = 'booting' | 'ready' | 'error';

export type MountedMobileRoot = Root & {
    destroy: () => void;
};

export function MobileBootstrapApp({
    client: externalClient,
    queryClient,
    sessionBridge,
    children,
    initialPath,
    slots,
    badges,
    unreadDots,
    userName,
    userAvatarUrl,
}: MobileAppProps = {}) {
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
    const destroyedRef = useRef(false);

    const runBootstrap = useCallback(async () => {
        if (destroyedRef.current) return;
        const token = ++bootTokenRef.current;
        setBootState('booting');
        setErrorMessage('');
        if (typeof document !== 'undefined' && document.documentElement) {
            document.documentElement.dataset.vcDevice = 'mobile';
            document.documentElement.dataset.vcApp = 'booting';
        }
        try {
            await client.initialize();
            if (destroyedRef.current || bootTokenRef.current !== token) return;
            await client.go.captureSessionContext();
            if (destroyedRef.current || bootTokenRef.current !== token) return;
            if (typeof document !== 'undefined' && document.documentElement) {
                document.documentElement.dataset.vcDevice = 'mobile';
                document.documentElement.dataset.vcApp = 'ready';
            }
            setBootState('ready');
        } catch (err) {
            if (destroyedRef.current || bootTokenRef.current !== token) return;
            if (typeof document !== 'undefined' && document.documentElement) {
                document.documentElement.dataset.vcDevice = 'mobile';
                document.documentElement.dataset.vcApp = 'error';
            }
            setErrorMessage(err instanceof Error ? err.message : '加载失败，请稍后重试');
            setBootState('error');
        }
    }, [client]);

    useEffect(() => {
        destroyedRef.current = false;
        void runBootstrap();
        return () => {
            destroyedRef.current = true;
            bootTokenRef.current += 1;
        };
    }, [runBootstrap]);

    if (bootState === 'booting') {
        return <div data-vc-app="booting" data-vc-device="mobile" />;
    }

    if (bootState === 'error') {
        return (
            <div id="vc-mobile-startup-error" role="alert">
                <p>{errorMessage || '加载失败，请稍后重试'}</p>
                <button type="button" onClick={() => void runBootstrap()}>
                    重试
                </button>
            </div>
        );
    }

    return (
        <MobileApp
            client={client}
            queryClient={queryClient}
            sessionBridge={sessionBridge}
            initialPath={initialPath}
            slots={slots}
            badges={badges}
            unreadDots={unreadDots}
            userName={userName}
            userAvatarUrl={userAvatarUrl}
        >
            {children}
        </MobileApp>
    );
}

export function mountMobileApp(
    container: HTMLElement | null = typeof document !== 'undefined'
        ? document.getElementById('root')
        : null,
    props?: MobileAppProps,
): MountedMobileRoot | null {
    if (typeof document !== 'undefined' && document.documentElement) {
        document.documentElement.dataset.vcDevice = 'mobile';
        document.documentElement.dataset.vcApp = 'booting';
    }
    if (!container) return null;
    const root = createRoot(container) as MountedMobileRoot;
    let destroyed = false;
    const origUnmount = root.unmount.bind(root);
    const cleanup = () => {
        if (destroyed) return;
        destroyed = true;
        origUnmount();
        if (typeof document !== 'undefined' && document.documentElement) {
            delete document.documentElement.dataset.vcDevice;
            delete document.documentElement.dataset.vcApp;
        }
    };
    root.destroy = cleanup;
    root.unmount = cleanup;
    root.render(<MobileBootstrapApp {...props} />);
    return root;
}

if (typeof document !== 'undefined') {
    const autoRoot = document.getElementById('root');
    if (autoRoot && !autoRoot.hasAttribute('data-vc-manual-mount')) {
        mountMobileApp(autoRoot);
    }
}
