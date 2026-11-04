import { useEffect, useRef, useState } from 'react';
import {
    COPY,
    avatarUrl,
    firstGlyph,
    formatMessageDuration,
    formatMessageTimeLabel,
    messageTimestampMs,
} from '../../../../extension/vc-model-settings/chat-logic.js';
import {
    chatVoiceAvailable,
    readReplyAloud,
    requestChatVoice,
} from '../../../../extension/vc-model-settings/voice-logic.js';
import { Icon } from '../../design/components/Icon';
import { toast } from '../../design/components/Toast';
import { useChatSnapshot, useSessionBridge, type ChatMessage } from '../../runtime/session-bridge';
import { MessageLeaf } from './MessageLeaf';
import { MessageMenu } from './MessageMenu';
import { VoiceBubble } from './VoiceBubble';

export interface MessageItemProps {
    message: ChatMessage;
    index: number;
    totalCount: number;
    prevMessage?: ChatMessage;
    onQuote: (info: { name?: string; text: string }) => void;
    onEdit: (index: number, currentText: string) => void;
    onRemove: (index: number, anchor: HTMLElement | null) => void;
    onRemind: (index: number, text: string) => void;
    onOpenReactionPicker: (index: number, anchor: HTMLElement | null) => void;
    onOpenLightbox: (url: string, alt: string) => void;
    highlighted?: boolean;
    searchMatch?: { current: boolean } | null;
}

export function MessageItem({
    message,
    index,
    totalCount,
    prevMessage,
    onQuote,
    onEdit,
    onRemove,
    onRemind,
    onOpenReactionPicker,
    onOpenLightbox,
    highlighted,
    searchMatch,
}: MessageItemProps) {
    const bridge = useSessionBridge();
    const busy = useChatSnapshot(s => s.busy);
    const canSend = useChatSnapshot(s => s.canSend);
    const streamingKey = useChatSnapshot(s => s.streamingKey);
    const charAvatarUrl = useChatSnapshot(s => s.avatarUrl);
    const charName = useChatSnapshot(s => s.characterName);
    const preferences = useChatSnapshot(s => s.preferences);

    const [menuOpen, setMenuOpen] = useState(false);
    const [avatarBroken, setAvatarBroken] = useState(false);
    const [, setReadAloudVersion] = useState(0);
    const moreBtnRef = useRef<HTMLButtonElement | null>(null);
    const aliveRef = useRef(true);
    useEffect(() => {
        aliveRef.current = true;
        return () => {
            aliveRef.current = false;
        };
    }, []);

    const messageKey = String(message.key ?? index);
    const messageText = String(message.mes ?? '');
    const readAloudRef = useRef<{
        key: string;
        text: string;
        busy: boolean;
        playing: boolean;
        failed: boolean;
        clip: unknown;
    } | null>(null);
    if (
        !readAloudRef.current ||
        readAloudRef.current.key !== messageKey ||
        readAloudRef.current.text !== messageText
    ) {
        readAloudRef.current = {
            key: messageKey,
            text: messageText,
            busy: false,
            playing: false,
            failed: false,
            clip: null,
        };
    }
    const readAloudState = readAloudRef.current;

    const isLast = index === totalCount - 1;
    const isUser = Boolean(message.is_user);
    const isSystem = Boolean(message.is_system);
    const isCharacter = !isUser && !isSystem;
    const isStreaming = streamingKey === message.key;

    const prevSameRole =
        prevMessage &&
        Boolean(prevMessage.is_user) === isUser &&
        Boolean(prevMessage.is_system) === isSystem &&
        (prevMessage.name || '') === (message.name || '');

    const prevMs = prevMessage ? messageTimestampMs(prevMessage) : null;
    const currMs = messageTimestampMs(message);
    const within5Min =
        prevMs !== null &&
        currMs !== null &&
        Math.abs(currMs - prevMs) < 5 * 60 * 1000;
    const grouped = Boolean(prevSameRole && (within5Min || (prevMs === null && currMs === null)));
    const showSender = !grouped;

    const senderName =
        message.name || (isUser ? '你' : isSystem ? '系统' : charName || '角色');
    const resolvedAvatarUrl = isCharacter
        ? charAvatarUrl || avatarUrl((message as any).avatar)
        : '';

    const voice = message.extra?.vc_voice;
    const voiceInput = message.extra?.vc_voice_input;
    const sticker = message.extra?.vc_sticker;
    const mediaList: any[] = Array.isArray(message.extra?.media) ? message.extra.media : [];
    const reactions: string[] = Array.isArray(message.extra?.vc_reactions)
        ? message.extra.vc_reactions
        : [];

    const swipeCount = Array.isArray(message.swipes) ? message.swipes.length : 1;
    const swipeId = Number(message.swipe_id ?? 0);
    const showSwipes =
        isCharacter &&
        preferences?.swipes !== false &&
        (swipeCount > 1 || (isLast && canSend));

    const timeLabel =
        preferences?.timestamps_enabled && message.send_date
            ? formatMessageTimeLabel(message)
            : '';
    const durationLabel =
        preferences?.mes_timer && !isUser ? formatMessageDuration(message) : '';
    const metaParts = [timeLabel, durationLabel].filter(Boolean);

    const voiceEnabled =
        isCharacter &&
        (!busy || !isLast) &&
        (chatVoiceAvailable(bridge.getContext()) ||
            readAloudState.busy ||
            readAloudState.playing);

    const handleAction = async (action: string, anchor: HTMLElement | null) => {
        if (action === 'copy') {
            if (typeof navigator !== 'undefined' && navigator.clipboard) {
                await navigator.clipboard.writeText(String(message.mes ?? ''));
            }
            toast.show({ title: COPY.copied || '已复制', kind: 'success' });
            return;
        }
        if (action === 'quote') {
            onQuote({
                name: senderName,
                text: String(message.mes ?? ''),
            });
            return;
        }
        if (action === 'edit') {
            onEdit(index, String(message.mes ?? ''));
            return;
        }
        if (action === 'remove') {
            onRemove(index, anchor);
            return;
        }
        if (action === 'regenerate' || action === 'regen') {
            await bridge.regenerate();
            return;
        }
        if (action === 'continue') {
            await bridge.continue();
            return;
        }
        if (action === 'voice' || action === 'read') {
            const targetState = readAloudRef.current;
            if (!targetState) return;
            await readReplyAloud(index, targetState, () => {
                if (aliveRef.current && readAloudRef.current === targetState) {
                    setReadAloudVersion(v => v + 1);
                }
            });
            if (aliveRef.current && readAloudRef.current === targetState && targetState.failed) {
                toast.show({
                    title: COPY.actionFailed || '没有完成，请重试。',
                    kind: 'error',
                });
            }
            return;
        }
        if (action === 'remind') {
            onRemind(index, String(message.mes ?? ''));
        }
    };

    const classNames = [
        'mes',
        isLast ? 'last_mes' : '',
        isStreaming ? 'vc-streaming' : '',
        grouped ? 'vc-msg-grouped' : '',
        highlighted ? 'vc-mes-highlight' : '',
        searchMatch?.current
            ? 'vc-search-current'
            : searchMatch
              ? 'vc-search-match'
              : '',
        menuOpen ? 'vc-menu-open' : '',
    ]
        .filter(Boolean)
        .join(' ');

    const customDomAttrs: Record<string, string | undefined> = {
        mesid: String(index),
        is_user: String(isUser),
        is_system: String(isSystem),
        'data-vc-search-current': searchMatch?.current ? '' : undefined,
        'data-vc-search-match': searchMatch ? '' : undefined,
    };

    return (
        <article
            {...customDomAttrs}
            className={classNames}
        >
            {isCharacter ? (
                <div
                    className="mesAvatarWrapper"
                    title="双击拍一拍"
                    onDoubleClick={() => {
                        void bridge.pat();
                    }}
                >
                    {resolvedAvatarUrl && !avatarBroken ? (
                        <div className="avatar">
                            <img
                                src={resolvedAvatarUrl}
                                alt={senderName}
                                onError={() => setAvatarBroken(true)}
                            />
                        </div>
                    ) : (
                        <div className="avatar vc-avatar-fallback" aria-hidden="true">
                            <span>{firstGlyph(senderName)}</span>
                        </div>
                    )}
                </div>
            ) : null}

            <div className="mes_block">
                {showSender ? (
                    <div className="ch_name">
                        <span className="name_text">{senderName}</span>
                    </div>
                ) : null}

                <MessageLeaf message={message} index={index} />

                <div className="vc-mes-media">
                    {voiceInput ||
                    (voice && ['queued', 'running', 'ready'].includes(String(voice.status || ''))) ? (
                        <VoiceBubble
                            voice={voice}
                            input={voiceInput}
                            text={message.mes}
                            onPlayed={() => bridge.markVoicePlayed(index)}
                        />
                    ) : voice?.status === 'failed' ? (
                        <button
                            type="button"
                            className="vc-voice-retry"
                            onClick={() => {
                                void requestChatVoice(index);
                            }}
                        >
                            {COPY.retry || '重试'}
                        </button>
                    ) : null}

                    {sticker?.url ? (
                        <figure className="vc-sticker-bubble">
                            <img
                                src={sticker.url}
                                alt={sticker.label || sticker.tag || '表情包'}
                                loading="lazy"
                            />
                        </figure>
                    ) : null}

                    {mediaList.map((item, mediaIdx) => {
                        const url = item?.url || item?.src;
                        if (!url) return null;
                        const type = String(item?.type || '').toLowerCase();
                        const title = String(item?.title || item?.alt || '图片预览');
                        if (type === 'video' || /\.(mp4|webm|mov)$/i.test(url)) {
                            return (
                                <video
                                    key={`${url}-${mediaIdx}`}
                                    className="vc-chat-video"
                                    src={url}
                                    controls
                                    preload="metadata"
                                />
                            );
                        }
                        if (type === 'audio' || /\.(mp3|wav|ogg|m4a)$/i.test(url)) {
                            return (
                                <audio
                                    key={`${url}-${mediaIdx}`}
                                    className="vc-chat-audio"
                                    src={url}
                                    controls
                                    preload="metadata"
                                />
                            );
                        }
                        return (
                            <button
                                key={`${url}-${mediaIdx}`}
                                type="button"
                                className="vc-chat-image-btn"
                                aria-label={title}
                                onClick={() => onOpenLightbox(url, title)}
                            >
                                <img
                                    className="vc-chat-image"
                                    src={url}
                                    alt={title}
                                    loading="lazy"
                                />
                            </button>
                        );
                    })}
                </div>

                {reactions.length > 0 ? (
                    <div className="vc-react-badges" aria-label="消息回应">
                        {reactions.map(emoji => (
                            <button
                                key={emoji}
                                type="button"
                                className="vc-react-badge"
                                disabled={!canSend}
                                onClick={() => {
                                    void bridge.react(index, emoji);
                                }}
                            >
                                {emoji}
                            </button>
                        ))}
                    </div>
                ) : null}

                {metaParts.length > 0 ? (
                    <div className="vc-message-metadata">{metaParts.join(' · ')}</div>
                ) : null}
            {!isSystem ? (
                <div className="vc-mes-tools" role="toolbar" aria-label="消息工具">
                    {showSwipes ? (
                        <div className="vc-mes-swipes" data-vc-pager="">
                            <button
                                type="button"
                                data-vc-act="swipe-prev"
                                aria-label="上一条候选"
                                disabled={busy || swipeId <= 0}
                                onClick={() => {
                                    void bridge.swipe(index, -1);
                                }}
                            >
                                ‹
                            </button>
                            <span className="vc-swipe-count">
                                {`${swipeId + 1}/${Math.max(1, swipeCount)}`}
                            </span>
                            <button
                                type="button"
                                data-vc-act="swipe-next"
                                aria-label="下一条候选"
                                disabled={busy || (!isLast && swipeId >= swipeCount - 1)}
                                onClick={() => {
                                    void bridge.swipe(index, 1);
                                }}
                            >
                                ›
                            </button>
                        </div>
                    ) : null}

                    {isCharacter && isLast ? (
                        <button
                            type="button"
                            data-vc-act="regen"
                            aria-label="重新生成"
                            disabled={!canSend || busy}
                            onClick={() => {
                                void handleAction('regenerate', null);
                            }}
                        >
                            <Icon name="refresh" size={16} />
                        </button>
                    ) : null}

                    <button
                        type="button"
                        data-vc-act="edit"
                        aria-label="编辑"
                        disabled={!canSend || busy}
                        onClick={() => {
                            void handleAction('edit', null);
                        }}
                    >
                        <Icon name="edit" size={16} />
                    </button>

                    <button
                        type="button"
                        data-vc-act="copy"
                        aria-label="复制"
                        onClick={() => {
                            void handleAction('copy', null);
                        }}
                    >
                        <Icon name="copy" size={16} />
                    </button>

                    {voiceEnabled ? (
                        <button
                            type="button"
                            data-vc-act="read"
                            aria-label="读出来"
                            aria-pressed={readAloudState.playing}
                            aria-busy={readAloudState.busy || undefined}
                            disabled={readAloudState.busy}
                            onClick={() => {
                                void handleAction('voice', null);
                            }}
                        >
                            <Icon name="volume" size={16} />
                        </button>
                    ) : null}

                    <MessageMenu
                        message={message}
                        index={index}
                        isLast={isLast}
                        open={menuOpen}
                        onOpenChange={setMenuOpen}
                        onAction={handleAction}
                        onOpenReactionPicker={anchor => onOpenReactionPicker(index, anchor)}
                        triggerRef={moreBtnRef}
                    />
                </div>
            ) : null}
            </div>
        </article>
    );
}
