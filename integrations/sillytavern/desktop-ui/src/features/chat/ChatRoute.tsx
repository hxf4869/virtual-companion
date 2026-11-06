import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from 'react';
import { useRouterState } from '@tanstack/react-router';
import { useConversationsQuery } from '../../data/queries/chat';
import { useChatSnapshot, useSessionBridge } from '../../runtime/session-bridge';
import { ChatSearch } from './ChatSearch';
import { Composer, type ComposerQuote } from './Composer';
import { MessageList } from './MessageList';
import './chat.css';
import type { ReadingPositionController } from './useReadingPosition';

export interface MessageJumpRequest {
    key: string;
    floor: number;
}

export interface ChatUiContextValue {
    quote: ComposerQuote | null;
    setQuote: (quote: ComposerQuote | null) => void;
    searchOpen: boolean;
    setSearchOpen: (open: boolean) => void;
    toggleSearch: () => void;
    historyAll: boolean;
    setHistoryAll: (all: boolean) => void;
    messageJump: MessageJumpRequest | null;
    requestMessageJump: (key: string, floor: number) => void;
    completeMessageJump: (request: MessageJumpRequest) => void;
    sendSequence: number;
    notifySent: () => void;
}

const ChatUiContext = createContext<ChatUiContextValue | null>(null);

export function ChatUiProvider({ children }: { children: ReactNode }) {
    const bridge = useSessionBridge();
    const activeKey = useChatSnapshot(s => s.key);
    const [quote, setQuote] = useState<ComposerQuote | null>(null);
    const [searchOpen, setSearchOpen] = useState(false);
    const [historyAll, setHistoryAll] = useState(false);
    const [messageJump, setMessageJump] = useState<MessageJumpRequest | null>(null);
    const [sendSequence, setSendSequence] = useState(0);
    const notifySent = useCallback(() => setSendSequence(sequence => sequence + 1), []);
    const requestMessageJump = useCallback((key: string, floor: number) => {
        if (key !== bridge.getSnapshot().key) return;
        setMessageJump({ key, floor });
    }, [bridge]);
    const completeMessageJump = useCallback((request: MessageJumpRequest) => {
        setMessageJump(current => current === request ? null : current);
    }, []);

    useLayoutEffect(() => {
        setQuote(null);
        setSearchOpen(false);
        setHistoryAll(false);
        setMessageJump(current => current?.key === activeKey ? current : null);
    }, [activeKey]);

    const handleSetSearchOpen = useCallback((open: boolean) => {
        setSearchOpen(open);
        if (open) {
            setHistoryAll(true);
        }
    }, []);

    const toggleSearch = useCallback(() => {
        setSearchOpen(prev => {
            const next = !prev;
            if (next) setHistoryAll(true);
            return next;
        });
    }, []);

    const value = useMemo<ChatUiContextValue>(
        () => ({
            quote,
            setQuote,
            searchOpen,
            setSearchOpen: handleSetSearchOpen,
            toggleSearch,
            historyAll,
            setHistoryAll,
            messageJump,
            requestMessageJump,
            completeMessageJump,
            sendSequence,
            notifySent,
        }),
        [quote, searchOpen, handleSetSearchOpen, toggleSearch, historyAll, messageJump, requestMessageJump, completeMessageJump, sendSequence, notifySent],
    );

    return <ChatUiContext.Provider value={value}>{children}</ChatUiContext.Provider>;
}

export function useChatUi(): ChatUiContextValue | null {
    return useContext(ChatUiContext);
}

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
}

function ChatRouteInner({
    conversationKey,
    hideComposer = false,
    onOpenSettings,
}: ChatRouteProps) {
    const bridge = useSessionBridge();
    const activeKey = useChatSnapshot(s => s.key);
    const status = useChatSnapshot(s => s.status);
    const messageCount = useChatSnapshot(s => s.messages.length);
    const { rows: conversations } = useConversationsQuery();
    const ui = useContext(ChatUiContext)!;
    const isChatRoute = useRouterState({ select: state => state.location.pathname.startsWith('/chat') });
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
            />

            <MessageList
                historyAll={ui.historyAll}
                onQuote={info => ui.setQuote(info)}
                onOpenSettings={onOpenSettings}
                onReadingPosition={registerReading}
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
