import {
    createContext,
    useCallback,
    useContext,
    useLayoutEffect,
    useMemo,
    useState,
    type ReactNode,
} from 'react';
import { useChatSnapshot, useSessionBridge } from '../../runtime/session-bridge';
import type { ComposerQuote } from './useComposer';

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

export const ChatUiContext = createContext<ChatUiContextValue | null>(null);

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
        [
            quote,
            searchOpen,
            handleSetSearchOpen,
            toggleSearch,
            historyAll,
            messageJump,
            requestMessageJump,
            completeMessageJump,
            sendSequence,
            notifySent,
        ],
    );

    return <ChatUiContext.Provider value={value}>{children}</ChatUiContext.Provider>;
}

export function useChatUi(): ChatUiContextValue | null {
    return useContext(ChatUiContext);
}
