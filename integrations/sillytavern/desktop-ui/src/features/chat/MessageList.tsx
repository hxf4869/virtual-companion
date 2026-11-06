import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Lightbox from 'yet-another-react-lightbox';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import 'yet-another-react-lightbox/styles.css';
import {
    COPY,
    REMIND_PRESETS,
    dateLabel,
    posKey,
    readKey,
    readStoredNumber,
} from '../../../../extension/vc-model-settings/chat-logic.js';
import { AlertDialog } from '../../design/components/AlertDialog';
import { Dialog } from '../../design/components/Dialog';
import { toast } from '../../design/components/Toast';
import { usePortalContainer } from '../../design/portal-host';
import type { ComposerQuote } from './Composer';
import { ConflictSheet } from './ConflictSheet';
import { EmojiPicker } from './EmojiPicker';
import { MessageItem } from './MessageItem';
import {
    editMessageSchema,
    remindMessageSchema,
    resolveMessageActionTarget,
    useMessageActions,
    type EditMessageFormValues,
    type MessageActionTarget,
    type MessageTextTarget,
    type RemindMessageFormValues,
    type UseMessageActionsOptions,
} from './useMessageActions';
import { useReadingPosition, type ReadingPositionController } from './useReadingPosition';

export {
    editMessageSchema,
    remindMessageSchema,
    resolveMessageActionTarget,
    useMessageActions,
    type EditMessageFormValues,
    type MessageActionTarget,
    type MessageTextTarget,
    type RemindMessageFormValues,
    type UseMessageActionsOptions,
};

const PAGE_SIZE = 80;

export interface MessageListProps {
    historyAll: boolean;
    onQuote: (info: ComposerQuote) => void;
    onOpenSettings?: () => void;
    onReadingPosition?: (controller: ReadingPositionController | null) => void;
    reducedMotion?: boolean;
}

export function MessageList({
    historyAll,
    onQuote,
    onOpenSettings,
    onReadingPosition,
    reducedMotion = false,
}: MessageListProps) {
    const {
        bridge,
        activeKey,
        status,
        messages,
        busy,
        notice,
        error,
        settingsRequired,
        popupRequest,
        personaChoice,
        editing,
        setEditing,
        editForm,
        openEditDialog,
        submitEdit,
        removing,
        setRemoving,
        openRemoveDialog,
        confirmRemove,
        reminding,
        setReminding,
        remindForm,
        remindPresetId,
        remindCustomDueAt,
        openRemindDialog,
        submitRemind,
        reactionTarget,
        setReactionTarget,
        openReactionTarget,
        selectReaction,
        popupInput,
        setPopupInput,
        confirmPopup,
        cancelPopup,
        selectPersonaChoice,
        cancelPersonaChoice,
        canRetryNotice,
    } = useMessageActions({
        onRemindSuccess: () => {
            toast.show({ title: COPY.reminded || '已记下提醒', kind: 'success' });
        },
        onRemindError: () => {
            toast.show({ title: COPY.actionFailed || '没有完成，请重试。', kind: 'error' });
        },
    });
    const portalContainer = usePortalContainer();

    const chatRef = useRef<HTMLDivElement | null>(null);
    const cardActionsRef = useRef<HTMLDivElement | null>(null);

    const [lightbox, setLightbox] = useState<{ url: string; alt: string } | null>(null);
    const [reactionAnchor, setReactionAnchor] = useState<HTMLElement | null>(null);

    useEffect(() => {
        if (!reactionTarget) {
            setReactionAnchor(null);
        }
    }, [reactionTarget]);

    useEffect(() => {
        const node = cardActionsRef.current;
        if (!node) return undefined;
        return bridge.mountCardActions(node);
    }, [bridge, activeKey]);

    const reading = useReadingPosition({
        chatRef,
        chatStorageId: bridge.draft.storageId(activeKey),
        status,
        busy,
        messages,
        reducedMotion,
    });
    const {
        latestShown,
        latestAriaLabel,
        unreadBadgeText,
        dateChipText,
        dateChipVisible,
        goLatest,
        capturePrependAnchor,
    } = reading;
    useEffect(() => {
        onReadingPosition?.(reading);
        return () => onReadingPosition?.(null);
    }, [onReadingPosition, reading.jumpToMessage, reading.notifySent]);

    // Keep the opening boundary stable as replies arrive or earlier rows are deleted.
    const initialPage = useRef({ key: '', ready: false, firstKey: '' });
    if (
        initialPage.current.key !== activeKey ||
        (!initialPage.current.ready && (messages.length > 0 || status === 'ready'))
    ) {
        const storageId = bridge.draft.storageId(activeKey);
        const savedPosition = readStoredNumber(posKey(storageId));
        const savedRead = readStoredNumber(readKey(storageId));
        const restoreFloor = savedPosition ?? (savedRead === null ? null : savedRead + 1);
        const pageCount =
            restoreFloor === null
                ? 1
                : Math.max(1, Math.ceil((messages.length - restoreFloor) / PAGE_SIZE));
        initialPage.current = {
            key: activeKey,
            ready: messages.length > 0 || status === 'ready',
            firstKey: messages[Math.max(0, messages.length - pageCount * PAGE_SIZE)]?.key ?? '',
        };
    }
    const [pageStart, setPageStart] = useState<{
        opening: typeof initialPage.current;
        firstKey: string;
    } | null>(null);
    const firstKey =
        pageStart?.opening === initialPage.current
            ? pageStart.firstKey
            : initialPage.current.firstKey;
    const hiddenCount = historyAll
        ? 0
        : Math.max(0, messages.findIndex(message => message.key === firstKey));
    const visibleMessages = useMemo(
        () => (hiddenCount > 0 ? messages.slice(hiddenCount) : messages),
        [messages, hiddenCount],
    );
    const firstDisplayedMessageId =
        visibleMessages.length > 0 ? visibleMessages[0].index : null;

    useLayoutEffect(() => {
        if (!activeKey) return undefined;
        bridge.setFirstDisplayedMessageId(activeKey, firstDisplayedMessageId);
        return () => {
            bridge.setFirstDisplayedMessageId(activeKey, null);
        };
    }, [bridge, activeKey, firstDisplayedMessageId]);

    const lightboxSlides = useMemo(() => {
        const slides: Array<{ src: string; alt: string }> = [];
        for (const msg of visibleMessages) {
            const mediaList = Array.isArray(msg.extra?.media) ? msg.extra.media : [];
            for (const item of mediaList) {
                if (item && item.type === 'image' && item.url) {
                    slides.push({
                        src: String(item.url),
                        alt: String(item.title || item.alt || '图片预览'),
                    });
                }
            }
        }
        if (lightbox && !slides.some(s => s.src === lightbox.url)) {
            slides.push({ src: lightbox.url, alt: lightbox.alt || '图片预览' });
        }
        return slides;
    }, [visibleMessages, lightbox]);

    const lightboxIndex = useMemo(() => {
        if (!lightbox) return 0;
        const idx = lightboxSlides.findIndex(s => s.src === lightbox.url);
        return idx >= 0 ? idx : 0;
    }, [lightbox, lightboxSlides]);

    return (
        <div className="vc-chat-stage">
            <div
                id="chat"
                ref={chatRef}
                tabIndex={0}
                role="log"
                aria-label="聊天消息"
            >
                {status === 'empty' && !activeKey ? (
                    <div className="vc-chat-empty-state">
                        <p>从左侧选择一个会话开始聊天</p>
                    </div>
                ) : status === 'error' && visibleMessages.length === 0 ? (
                    <div className="vc-chat-empty-state vc-chat-error-state" role="alert">
                        <p>{error || '聊天没有加载出来，请重试。'}</p>
                        <button
                            type="button"
                            className="vc-btn vc-btn--secondary"
                            onClick={() => {
                                void bridge.retry();
                            }}
                        >
                            重试
                        </button>
                    </div>
                ) : (
                    <>
                        {hiddenCount > 0 ? (
                            <div className="vc-history-more">
                                <button
                                    type="button"
                                    className="vc-btn vc-btn--secondary"
                                    onClick={() => {
                                        capturePrependAnchor();
                                        setPageStart({
                                            opening: initialPage.current,
                                            firstKey:
                                                messages[Math.max(0, hiddenCount - PAGE_SIZE)]?.key ??
                                                '',
                                        });
                                    }}
                                >
                                    显示更早的消息
                                </button>
                            </div>
                        ) : null}

                        {visibleMessages.map((msg, visIdx) => {
                            const absIndex = hiddenCount + visIdx;
                            const prevMsg = absIndex > 0 ? messages[absIndex - 1] : undefined;
                            const prevDate = prevMsg ? dateLabel(prevMsg.send_date) : '';
                            const currDate = dateLabel(msg.send_date);
                            const showDateSep = Boolean(currDate && currDate !== prevDate);

                            return (
                                <React.Fragment key={msg.key}>
                                    {showDateSep ? (
                                        <div className="vc-date-sep" role="separator">
                                            <span>{currDate}</span>
                                        </div>
                                    ) : null}
                                    <MessageItem
                                        message={msg}
                                        index={absIndex}
                                        totalCount={messages.length}
                                        prevMessage={prevMsg}
                                        reducedMotion={reducedMotion}
                                        onQuote={onQuote}
                                        onEdit={openEditDialog}
                                        onRemove={idx => {
                                            openRemoveDialog(idx);
                                        }}
                                        onRemind={openRemindDialog}
                                        onOpenReactionPicker={(idx, anchor) => {
                                            setReactionAnchor(anchor);
                                            openReactionTarget(idx);
                                        }}
                                        onOpenLightbox={(url, alt) => setLightbox({ url, alt })}
                                    />
                                </React.Fragment>
                            );
                        })}
                    </>
                )}
            </div>

            <div className="vc-chat-floating">
                <div
                    id="vc-date-chip"
                    className={dateChipVisible ? 'vc-visible' : undefined}
                    aria-hidden={!dateChipVisible}
                >
                    {dateChipText}
                </div>

                <button
                    id="vc-latest"
                    type="button"
                    className={latestShown ? 'vc-visible' : undefined}
                    hidden={!latestShown}
                    aria-label={latestAriaLabel}
                    onClick={() => goLatest()}
                >
                    <span>回到底部</span>
                    {unreadBadgeText ? (
                        <span className="vc-latest-badge">{unreadBadgeText}</span>
                    ) : null}
                </button>
            </div>

            {busy || notice ? (
                <div
                    id="vc-chat-gen"
                    className="vc-visible"
                    role="status"
                    aria-live="polite"
                >
                    {busy ? (
                        <span className="vc-chat-typing">
                            <span className="vc-typing-dots" aria-hidden="true" />
                            <span>{notice || '正在回复…'}</span>
                        </span>
                    ) : notice ? (
                        <div className="vc-chat-notice-bar">
                            <span className="vc-chat-notice-text">{notice}</span>
                            {settingsRequired && onOpenSettings ? (
                                <button
                                    type="button"
                                    className="vc-btn vc-btn--secondary vc-btn--sm"
                                    onClick={onOpenSettings}
                                >
                                    去设置
                                </button>
                            ) : canRetryNotice ? (
                                <button
                                    type="button"
                                    className="vc-btn vc-btn--secondary vc-btn--sm"
                                    onClick={() => {
                                        void bridge.retry();
                                    }}
                                >
                                    重试
                                </button>
                            ) : null}
                        </div>
                    ) : null}
                </div>
            ) : null}

            <div ref={cardActionsRef} className="vc-desktop-card-actions" />

            <Dialog
                open={editing !== null}
                onOpenChange={open => {
                    if (!open) setEditing(null);
                }}
                title={COPY.edit || '编辑'}
                className="vc-sheet"
                actions={
                    <>
                        <button
                            type="button"
                            className="vc-btn vc-btn--secondary"
                            onClick={() => setEditing(null)}
                        >
                            取消
                        </button>
                        <button
                            type="button"
                            className="vc-btn vc-btn--primary vc-sheet-done"
                            onClick={() => {
                                void submitEdit();
                            }}
                        >
                            保存
                        </button>
                    </>
                }
            >
                <form
                    onSubmit={e => {
                        void submitEdit(e);
                    }}
                >
                    <textarea
                        className="vc-textarea"
                        aria-label="消息内容"
                        rows={5}
                        {...editForm.register('text')}
                    />
                </form>
            </Dialog>

            <AlertDialog
                open={removing !== null}
                onOpenChange={open => {
                    if (!open) setRemoving(null);
                }}
                title={COPY.deleteTitle || '删除这条消息？'}
                description={COPY.deleteBody || '删除后无法恢复。'}
                confirmLabel={COPY.remove || '删除'}
                cancelLabel="取消"
                danger
                onConfirm={() => void confirmRemove()}
            />

            <Dialog
                open={reminding !== null}
                onOpenChange={open => {
                    if (!open) setReminding(null);
                }}
                title={COPY.remind || '稍后提醒'}
                className="vc-sheet"
                actions={
                    <>
                        <button
                            type="button"
                            className="vc-btn vc-btn--secondary"
                            onClick={() => setReminding(null)}
                        >
                            取消
                        </button>
                        <button
                            type="button"
                            className="vc-btn vc-btn--primary vc-sheet-done"
                            onClick={() => {
                                void submitRemind();
                            }}
                        >
                            保存
                        </button>
                    </>
                }
            >
                <form
                    className="vc-remind-form"
                    onSubmit={e => {
                        void submitRemind(e);
                    }}
                >
                    <textarea
                        className="vc-textarea"
                        aria-label="提醒内容"
                        placeholder="到时候想聊什么"
                        rows={3}
                        {...remindForm.register('topic')}
                    />
                    <div className="vc-remind-presets">
                        {REMIND_PRESETS.map((p: any) => (
                            <label key={p.id} className="vc-remind-preset">
                                <input
                                    type="radio"
                                    name="remindPreset"
                                    value={p.id}
                                    checked={remindPresetId === p.id}
                                    onChange={() =>
                                        remindForm.setValue('presetId', p.id, { shouldDirty: true })
                                    }
                                />
                                <span>{p.label}</span>
                            </label>
                        ))}
                    </div>
                    <input
                        type="datetime-local"
                        className="vc-input"
                        aria-label={COPY.remindPick || '选择时间…'}
                        value={remindCustomDueAt}
                        onChange={e => {
                            remindForm.setValue('customDueAt', e.target.value, {
                                shouldDirty: true,
                            });
                            remindForm.setValue('presetId', 'custom', { shouldDirty: true });
                        }}
                    />
                </form>
            </Dialog>

            <Lightbox
                open={lightbox !== null}
                close={() => setLightbox(null)}
                index={lightboxIndex}
                slides={lightboxSlides}
                plugins={[Zoom]}
                portal={{
                    root: () =>
                        portalContainer && 'current' in portalContainer
                            ? portalContainer.current
                            : (portalContainer ?? null),
                }}
                controller={{ closeOnBackdropClick: true }}
                carousel={{ finite: lightboxSlides.length <= 1 }}
                render={{
                    buttonPrev: lightboxSlides.length <= 1 ? () => null : undefined,
                    buttonNext: lightboxSlides.length <= 1 ? () => null : undefined,
                }}
                labels={{
                    Close: '关闭',
                    Next: '下一张',
                    Previous: '上一张',
                    'Zoom in': '放大',
                    'Zoom out': '缩小',
                }}
            />

            <EmojiPicker
                mode="react"
                anchor={reactionAnchor}
                open={reactionTarget !== null}
                onOpenChange={open => {
                    if (!open) {
                        setReactionAnchor(null);
                        setReactionTarget(null);
                    }
                }}
                onSelectReaction={emoji => {
                    setReactionAnchor(null);
                    selectReaction(emoji);
                }}
            />

            <Dialog
                key={popupRequest?.id ?? 'no-popup'}
                open={popupRequest !== null}
                onOpenChange={open => {
                    if (!open && popupRequest) {
                        cancelPopup();
                    }
                }}
                title="提示"
                className="vc-sheet"
                width={420}
                actions={
                    <>
                        {popupRequest?.type === 2 || popupRequest?.type === 3 ? (
                            <button
                                type="button"
                                className="vc-btn vc-btn--secondary"
                                onClick={cancelPopup}
                            >
                                取消
                            </button>
                        ) : null}
                        <button
                            type="button"
                            className="vc-btn vc-btn--primary vc-sheet-done"
                            onClick={confirmPopup}
                        >
                            确定
                        </button>
                    </>
                }
            >
                <div className="vc-popup-body">
                    <p>{popupRequest?.content}</p>
                    {popupRequest?.type === 3 ? (
                        <input
                            type="text"
                            className="vc-input"
                            value={popupInput}
                            onChange={e => setPopupInput(e.target.value)}
                            autoFocus
                        />
                    ) : null}
                </div>
            </Dialog>

            <Dialog
                open={personaChoice !== null}
                onOpenChange={open => {
                    if (!open && personaChoice) {
                        cancelPersonaChoice();
                    }
                }}
                title="选择这个人要见到的人设"
                className="vc-sheet"
                width={420}
            >
                <div className="vc-persona-choice-list">
                    {personaChoice?.options.map(option => (
                        <button
                            key={option.avatar}
                            type="button"
                            className="vc-btn vc-btn--secondary vc-persona-choice-item"
                            onClick={() => selectPersonaChoice(option.avatar)}
                        >
                            <span>{option.name || option.avatar}</span>
                            {option.description ? <small>{option.description}</small> : null}
                        </button>
                    ))}
                </div>
            </Dialog>

            <ConflictSheet />
        </div>
    );
}
