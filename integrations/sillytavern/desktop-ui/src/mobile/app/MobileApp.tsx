import type { ReactNode } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { AppProviders } from '../../app/providers';
import type { AppClient } from '../../data/client';
import type { SessionBridge } from '../../runtime/session-bridge';

export interface MobileAppProps {
    children?: ReactNode;
    client?: AppClient;
    queryClient?: QueryClient;
    sessionBridge?: SessionBridge;
}

export function MobileApp({
    children,
    client,
    queryClient,
    sessionBridge,
}: MobileAppProps) {
    return (
        <AppProviders
            client={client}
            queryClient={queryClient}
            sessionBridge={sessionBridge}
        >
            <div className="vc-mobile-app" data-vc-mobile-app="">
                {children}
            </div>
        </AppProviders>
    );
}
