import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createAppClient, type AppClient } from '../data/client';
import {
    createSessionBridge,
    SessionBridgeProvider,
    type SessionBridge,
} from '../runtime/session-bridge';

export function createQueryClient(): QueryClient {
    return new QueryClient({
        defaultOptions: {
            queries: {
                retry: 1,
                staleTime: 30_000,
                refetchOnWindowFocus: false,
            },
        },
    });
}

export const queryClient = createQueryClient();

const AppClientContext = createContext<AppClient | null>(null);

export interface AppProvidersProps {
    children?: ReactNode;
    client?: AppClient;
    queryClient?: QueryClient;
    sessionBridge?: SessionBridge;
}

export function AppProviders({
    children,
    client,
    queryClient: customQueryClient,
    sessionBridge,
}: AppProvidersProps) {
    const resolvedClient = useMemo(() => client ?? createAppClient(), [client]);
    const resolvedQueryClient = customQueryClient ?? queryClient;
    const resolvedBridge = useMemo(
        () => sessionBridge ?? createSessionBridge(resolvedClient, { queryClient: resolvedQueryClient }),
        [sessionBridge, resolvedClient, resolvedQueryClient],
    );

    useEffect(() => {
        if (sessionBridge) return undefined;
        return () => {
            resolvedBridge.destroy();
        };
    }, [sessionBridge, resolvedBridge]);

    return (
        <QueryClientProvider client={resolvedQueryClient}>
            <AppClientContext.Provider value={resolvedClient}>
                <SessionBridgeProvider bridge={resolvedBridge}>
                    {children}
                </SessionBridgeProvider>
            </AppClientContext.Provider>
        </QueryClientProvider>
    );
}

export function useAppClient(): AppClient {
    const context = useContext(AppClientContext);
    if (!context) {
        throw new Error('useAppClient must be used within AppProviders');
    }
    return context;
}
