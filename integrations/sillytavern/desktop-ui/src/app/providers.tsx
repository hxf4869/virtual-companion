import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createAppClient, type AppClient } from '../data/client';

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
}

export function AppProviders({
    children,
    client,
    queryClient: customQueryClient,
}: AppProvidersProps) {
    const resolvedClient = useMemo(() => client ?? createAppClient(), [client]);
    const resolvedQueryClient = customQueryClient ?? queryClient;

    return (
        <QueryClientProvider client={resolvedQueryClient}>
            <AppClientContext.Provider value={resolvedClient}>
                {children}
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
