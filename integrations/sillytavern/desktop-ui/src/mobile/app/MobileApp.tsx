import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { AppProviders } from '../../app/providers';
import type { AppClient } from '../../data/client';
import { useSessionBridge, type SessionBridge } from '../../runtime/session-bridge';
import { MobileChatList } from '../chat/MobileChatList';
import { MobileConversation } from '../chat/conversation/MobileConversation';
import {
    MobileShell,
    type MobileShellSlots,
    type MobileTabKey,
} from '../shell/MobileShell';

function MobileChatTabSlot({
    navigate,
    readDraftProp,
}: {
    navigate: (href: string) => void;
    readDraftProp?: (conversationKey: string) => string;
}) {
    const bridge = useSessionBridge();
    const [draftRevision, setDraftRevision] = useState(0);

    useEffect(() => {
        return bridge.subscribe(() => {
            setDraftRevision(rev => rev + 1);
        });
    }, [bridge]);

    const readDraft = useCallback(
        (key: string) => {
            void draftRevision;
            if (readDraftProp) return readDraftProp(key);
            return bridge.draft.read(key);
        },
        [bridge, draftRevision, readDraftProp],
    );

    return <MobileChatList onNavigate={navigate} readDraft={readDraft} />;
}

export type {
    MobileRouteSlotContext,
    MobileShellProps,
    MobileShellSlots,
    MobileTabDefinition,
    MobileTabKey,
} from '../shell/MobileShell';
export { MOBILE_TABS, MobileShell } from '../shell/MobileShell';

export interface MobileAppProps {
    children?: ReactNode;
    client?: AppClient;
    queryClient?: QueryClient;
    sessionBridge?: SessionBridge;
    initialPath?: string;
    slots?: MobileShellSlots;
    badges?: Partial<Record<MobileTabKey, number>>;
    unreadDots?: Partial<Record<MobileTabKey, boolean>>;
    userName?: string;
    userAvatarUrl?: string | null;
}

export function MobileApp({
    children,
    client,
    queryClient,
    sessionBridge,
    initialPath,
    slots,
    badges,
    unreadDots,
    userName,
    userAvatarUrl,
}: MobileAppProps) {
    const contextName =
        userName ||
        (typeof sessionBridge?.getContext === 'function'
            ? String(sessionBridge.getContext()?.name1 || '').trim()
            : '') ||
        '你';

    const resolvedSlots = useMemo<MobileShellSlots>(() => {
        if (slots?.tabs?.chat !== undefined && slots?.chatDetail !== undefined) {
            return slots;
        }
        const readDraft =
            typeof sessionBridge?.draft?.read === 'function'
                ? (key: string) => sessionBridge.draft.read(key)
                : undefined;
        return {
            ...slots,
            tabs: {
                ...slots?.tabs,
                chat:
                    slots?.tabs?.chat ??
                    (({ navigate }) => (
                        <MobileChatTabSlot navigate={navigate} readDraftProp={readDraft} />
                    )),
            },
            chatDetail:
                slots?.chatDetail ??
                (({ conversationKey, goBack }) => {
                    const isChatDetailRoute =
                        typeof window === 'undefined' ||
                        window.location.pathname.startsWith('/m/chat/');
                    if (!isChatDetailRoute) return null;
                    return (
                        <MobileConversation
                            key={conversationKey}
                            conversationKey={conversationKey}
                            goBack={goBack}
                        />
                    );
                }),
        };
    }, [slots, sessionBridge]);

    return (
        <AppProviders
            client={client}
            queryClient={queryClient}
            sessionBridge={sessionBridge}
        >
            <MobileShell
                initialPath={initialPath}
                slots={resolvedSlots}
                badges={badges}
                unreadDots={unreadDots}
                userName={contextName}
                userAvatarUrl={userAvatarUrl}
            >
                {children}
            </MobileShell>
        </AppProviders>
    );
}
