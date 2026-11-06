import {
    useCallback,
    useContext,
    useEffect,
    useRef,
} from 'react';
import { useConversationsQuery } from '../../data/queries/chat';
import { useChatSnapshot, useSessionBridge } from '../../runtime/session-bridge';
import { ChatSearch } from './ChatSearch';
import { Composer, type ComposerQuote } from './Composer';
import { MessageList } from './MessageList';
import './chat.css';
import {
    ChatUiContext,
    ChatUiProvider,
    useChatUi,
    type ChatUiContextValue,
    type MessageJumpRequest,
} from './useChatUi';
import type { ReadingPositionController } from './useReadingPosition';

export {
    ChatUiProvider,
    useChatUi,
    type ChatUiContextValue,
    type ComposerQuote,
    type MessageJumpRequest,
};

export function ChatComposerSlot() {
    const ui = useContext(ChatUiContext);
    return (
        <Composer
            quote={ui?.quote ?? null}
            onClearQuote={() => ui?.setQuote(null)}
            onSent={ui?.notifySent}
        />
    );
}

export interface ChatRouteProps {
    conversationKey?: string;
    hideComposer?: boolean;
    onOpenSettings?: () => void;
    active?: boolean;
    reducedMotion?: boolean;
}

function ChatRouteInner({
    conversationKey,
    hideComposer = false,
    onOpenSettings,
    active = true,
    reducedMotion = false,
}: ChatRouteProps) {
    const bridge = useSessionBridge();
    const activeKey = useChatSnapshot(s => s.key);
    const status = useChatSnapshot(s => s.status);
    const messageCount = useChatSnapshot(s => s.messages.length);
    const { rows: conversations } = useConversationsQuery();
    const ui = useContext(ChatUiContext)!;
    const isChatRoute = active;
    const readingRef = useRef<ReadingPositionController | null>(null);
    const registerReading = useCallback((controller: ReadingPositionController | null) => {
        readingRef.current = controller;
    }, []);
    const ensureAllHistory = useCallback(async () => {
        ui.setHistoryAll(true);
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }, [ui.setHistoryAll]);
    const jumpToMessage = useCallback((floor: number) => readingRef.current?.jumpToMessage(floor) ?? false, []);

    useEffect(() => {
        if (ui.sendSequence > 0) readingRef.current?.notifySent();
    }, [ui.sendSequence]);

    const wasChatRouteRef = useRef(isChatRoute);

    useEffect(() => {
        const leftChatRoute = wasChatRouteRef.current && !isChatRoute;
        wasChatRouteRef.current = isChatRoute;
        const request = ui.messageJump;
        if (!request) return;
        if (leftChatRoute || request.key !== bridge.getSnapshot().key) {
            ui.completeMessageJump(request);
            return;
        }
        if (!isChatRoute || request.key !== activeKey || status !== 'ready') return;
        if (!ui.historyAll) {
            ui.setHistoryAll(true);
            return;
        }
        if (jumpToMessage(request.floor)) {
            ui.completeMessageJump(request);
            return;
        }
        const frame = requestAnimationFrame(() => {
            if (jumpToMessage(request.floor)) ui.completeMessageJump(request);
        });
        return () => cancelAnimationFrame(frame);
    }, [ui.messageJump, ui.completeMessageJump, ui.historyAll, activeKey, status, isChatRoute, jumpToMessage, bridge]);

    const conversationsRef = useRef(conversations);
    conversationsRef.current = conversations;

    useEffect(() => {
        if (!isChatRoute || !conversationKey) return undefined;
        const currentSnap = bridge.getSnapshot();
        if (currentSnap.status === 'ready' && currentSnap.key === conversationKey) {
            return undefined;
        }
        const controller = new AbortController();
        const matched = conversationsRef.current.find(c => c.key === conversationKey);
        void bridge.open(matched ?? conversationKey, { signal: controller.signal });
        return () => {
            controller.abort();
        };
    }, [conversationKey, isChatRoute, bridge]);

    return (
        <div
            className="vc-desktop-chat-root"
            data-route="chat"
            data-conversation-key={conversationKey ?? activeKey ?? ''}
        >
            <ChatSearch
                open={ui.searchOpen}
                onOpenChange={ui.setSearchOpen}
                activeKey={activeKey}
                messageCount={messageCount}
                onEnsureAllHistory={ensureAllHistory}
                onJumpToMessage={jumpToMessage}
                reducedMotion={reducedMotion}
            />

            <MessageList
                historyAll={ui.historyAll}
                onQuote={info => ui.setQuote(info)}
                onOpenSettings={onOpenSettings}
                onReadingPosition={registerReading}
                reducedMotion={reducedMotion}
            />

            {!hideComposer ? (
                <Composer
                    quote={ui.quote}
                    onClearQuote={() => ui.setQuote(null)}
                    onSent={ui.notifySent}
                />
            ) : null}
        </div>
    );
}

export function ChatRoute(props: ChatRouteProps) {
    const existingUi = useContext(ChatUiContext);
    if (existingUi) {
        return <ChatRouteInner {...props} />;
    }
    return (
        <ChatUiProvider>
            <ChatRouteInner {...props} />
        </ChatUiProvider>
    );
}
