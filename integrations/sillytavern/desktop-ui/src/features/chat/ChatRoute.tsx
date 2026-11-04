import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from 'react';
import { useConversationsQuery } from '../../data/queries/chat';
import { useChatSnapshot, useSessionBridge } from '../../runtime/session-bridge';
import { ChatSearch } from './ChatSearch';
import { Composer, type ComposerQuote } from './Composer';
import { MessageList } from './MessageList';
import './chat.css';

export interface ChatUiContextValue {
    quote: ComposerQuote | null;
    setQuote: (quote: ComposerQuote | null) => void;
    searchOpen: boolean;
    setSearchOpen: (open: boolean) => void;
    toggleSearch: () => void;
    historyAll: boolean;
    setHistoryAll: (all: boolean) => void;
}

const ChatUiContext = createContext<ChatUiContextValue | null>(null);

export function ChatUiProvider({ children }: { children: ReactNode }) {
    const activeKey = useChatSnapshot(s => s.key);
    const [quote, setQuote] = useState<ComposerQuote | null>(null);
    const [searchOpen, setSearchOpen] = useState(false);
    const [historyAll, setHistoryAll] = useState(false);

    useEffect(() => {
        setQuote(null);
        setSearchOpen(false);
        setHistoryAll(false);
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
        }),
        [quote, searchOpen, handleSetSearchOpen, toggleSearch, historyAll],
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

    useEffect(() => {
        if (conversationKey) {
            if (conversationKey !== activeKey) {
                const matched = conversations.find(c => c.key === conversationKey);
                void bridge.open(matched ?? conversationKey);
            }
            return;
        }
        if (!activeKey && status === 'empty' && conversations.length > 0) {
            void bridge.open(conversations[0]);
        }
    }, [conversationKey, activeKey, status, conversations, bridge]);

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
                onEnsureAllHistory={() => {
                    ui.setHistoryAll(true);
                }}
            />

            <MessageList
                historyAll={ui.historyAll}
                onExpandHistory={() => ui.setHistoryAll(true)}
                onQuote={info => ui.setQuote(info)}
                onOpenSettings={onOpenSettings}
            />

            {!hideComposer ? (
                <Composer
                    quote={ui.quote}
                    onClearQuote={() => ui.setQuote(null)}
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
