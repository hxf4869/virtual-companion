import { memo, useLayoutEffect, useRef } from 'react';
import { useSessionBridge, type ChatMessage } from '../../runtime/session-bridge';

export interface MessageLeafProps {
    message: ChatMessage;
    index: number;
}

export const MessageLeaf = memo(
    function MessageLeaf({ message, index }: MessageLeafProps) {
        const bridge = useSessionBridge();
        const leafRef = useRef<HTMLDivElement | null>(null);
        const indexRef = useRef(index);
        indexRef.current = index;

        useLayoutEffect(() => {
            const node = leafRef.current;
            if (!node) return undefined;
            return bridge.mountLeaf(indexRef.current, node);
        }, [bridge, message.key]);

        const voice = message.extra?.vc_voice;
        const hiddenForVoice =
            Boolean(message.extra?.vc_voice_input) ||
            Boolean(voice && ['queued', 'running', 'ready'].includes(String(voice.status || '')));

        return (
            <div
                ref={leafRef}
                className="vc-desktop-message-content"
                aria-hidden={hiddenForVoice ? true : undefined}
            />
        );
    },
    (prev, next) =>
        prev.message.key === next.message.key &&
        prev.message.extra?.vc_voice?.status === next.message.extra?.vc_voice?.status &&
        Boolean(prev.message.extra?.vc_voice_input) === Boolean(next.message.extra?.vc_voice_input),
);
