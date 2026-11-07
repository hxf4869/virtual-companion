import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import {
  COPY,
  NEAR_BOTTOM_PX,
  avatarUrl as formatAvatarUrl,
  composerHeight,
  keepsTail,
} from '../../../../../extension/vc-model-settings/chat-logic.js';
import {
  parseConversationKey,
  useConversationsQuery,
} from '../../../data/queries/chat';
import { Icon } from '../../../design/components/Icon';
import { MessageLeaf } from '../../../features/chat/MessageLeaf';
import { useComposer } from '../../../features/chat/useComposer';
import {
  useChatSnapshot,
  useSessionBridge,
  type ChatMessage,
  type OpenResult,
} from '../../../runtime/session-bridge';
import type { ChatTailCache } from '../data/chatTailCache';
import {
  DEFAULT_MOBILE_TAIL_LIMIT,
  getSharedMobileTailCache,
  readCachedConversationTail,
  readCachedConversationTailSync,
  writeCachedConversationTail,
  type CachedConversationTail,
} from '../data/mobileConversationCache';
import { buildMobileConversationRows, type MobileConversationRowItem } from './messageGrouping';
import './mobile-conversation.css';

const MOBILE_COMPOSER_MAX_LINES = 5;
const MOBILE_COMPOSER_LINE_HEIGHT_PX = 22;
const MOBILE_COMPOSER_PADDING_PX = 12;
const MOBILE_COMPOSER_MIN_HEIGHT_PX = 34;
const INITIAL_TOP_MOST_ITEM_INDEX = { index: 'LAST' as const };

function VirtuosoListHeader() {
  return <div className="vc-mobile-chat-list-pad-top" />;
}

function VirtuosoListFooter() {
  return <div className="vc-mobile-chat-list-pad-bottom" />;
}

const VIRTUOSO_COMPONENTS = {
  Header: VirtuosoListHeader,
  Footer: VirtuosoListFooter,
};

export interface MobileConversationProps {
  conversationKey: string;
  isActive?: boolean;
  goBack?: (defaultHref?: string) => void;
  tailCache?: ChatTailCache | null;
  now?: () => number;
}

export function MobileConversation({
  conversationKey,
  isActive = true,
  goBack,
  tailCache,
  now,
}: MobileConversationProps): React.ReactElement {
  const bridge = useSessionBridge();
  const snapshot = useChatSnapshot();
  const { rows: conversations } = useConversationsQuery();
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;
  const effectiveCache = tailCache === undefined ? getSharedMobileTailCache() : tailCache;

  const storageIdResolver = useMemo(
    () =>
      typeof bridge.draft?.storageId === 'function'
        ? (key: string) => bridge.draft.storageId(key)
        : undefined,
    [bridge.draft],
  );

  const activeKeyRef = useRef(conversationKey);
  activeKeyRef.current = conversationKey;

  const syncCached = useMemo(
    () => readCachedConversationTailSync(effectiveCache, conversationKey, storageIdResolver),
    [effectiveCache, conversationKey, storageIdResolver],
  );
  const [asyncCached, setAsyncCached] = useState<CachedConversationTail | null>(null);
  const [openFailed, setOpenFailed] = useState(false);

  const cachedTail = useMemo(() => {
    if (syncCached && syncCached.conversationKey === conversationKey) {
      return syncCached;
    }
    if (asyncCached && asyncCached.conversationKey === conversationKey) {
      return asyncCached;
    }
    return null;
  }, [asyncCached, conversationKey, syncCached]);

  const isLiveForKey = snapshot.status === 'ready' && snapshot.key === conversationKey;
  const openAllowedWriteRef = useRef<string | null>(isLiveForKey ? conversationKey : null);
  if (isLiveForKey && openAllowedWriteRef.current === null) {
    openAllowedWriteRef.current = conversationKey;
  }

  // Load IndexedDB fallback cache if memory cache missed
  useEffect(() => {
    if (syncCached && syncCached.conversationKey === conversationKey) {
      return undefined;
    }
    let cancelled = false;
    void readCachedConversationTail(effectiveCache, conversationKey, storageIdResolver).then(
      (loaded) => {
        if (cancelled || activeKeyRef.current !== conversationKey) return;
        if (loaded) {
          setAsyncCached(loaded);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [conversationKey, effectiveCache, storageIdResolver, syncCached]);

  // Open conversation via session-bridge and guard against superseded / late results
  useEffect(() => {
    setOpenFailed(false);
    if (!isActive || !conversationKey) return undefined;
    let cancelled = false;
    const targetKey = conversationKey;
    const controller = new AbortController();

    const currentSnap = bridge.getSnapshot();
    if (currentSnap.status === 'ready' && currentSnap.key === targetKey) {
      openAllowedWriteRef.current = targetKey;
      void writeCachedConversationTail(
        effectiveCache,
        currentSnap,
        DEFAULT_MOBILE_TAIL_LIMIT,
        storageIdResolver,
      );
      return () => {
        cancelled = true;
        controller.abort();
      };
    }

    const matched = conversationsRef.current.find((c) => c.key === targetKey);
    void bridge.open(matched ?? targetKey, { signal: controller.signal }).then((result: OpenResult) => {
      if (
        cancelled ||
        controller.signal.aborted ||
        result === 'superseded' ||
        activeKeyRef.current !== targetKey
      ) {
        return;
      }
      if (result === 'failed') {
        setOpenFailed(true);
        return;
      }
      if (result === 'opened') {
        openAllowedWriteRef.current = targetKey;
        const latest = bridge.getSnapshot();
        if (latest.status === 'ready' && latest.key === targetKey) {
          void writeCachedConversationTail(
            effectiveCache,
            latest,
            DEFAULT_MOBILE_TAIL_LIMIT,
            storageIdResolver,
          );
        }
      }
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [bridge, conversationKey, effectiveCache, isActive, storageIdResolver]);

  // Write-through cache whenever live snapshot for current key is ready and idle
  useEffect(() => {
    if (!isLiveForKey || snapshot.busy) return;
    if (activeKeyRef.current !== conversationKey) return;
    if (openAllowedWriteRef.current !== conversationKey) return;
    void writeCachedConversationTail(
      effectiveCache,
      snapshot,
      DEFAULT_MOBILE_TAIL_LIMIT,
      storageIdResolver,
    );
  }, [
    conversationKey,
    effectiveCache,
    isLiveForKey,
    snapshot,
    snapshot.busy,
    snapshot.messages,
    storageIdResolver,
  ]);

  const virtuosoRef = useRef<VirtuosoHandle | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const scrollToBottom = useCallback((behavior: 'auto' | 'smooth' = 'auto') => {
    setIsAtBottom(true);
    virtuosoRef.current?.scrollToIndex({
      index: 'LAST',
      align: 'end',
      behavior,
    });
  }, []);

  const handleSent = useCallback(() => {
    scrollToBottom('auto');
  }, [scrollToBottom]);

  const {
    draft,
    canSubmit,
    busy,
    enterToSend,
    setDraft,
    submitComposer,
    stopGeneration,
  } = useComposer({
    conversationKey,
    onSent: handleSent,
  });

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-grow textarea up to 5 lines using chat-logic composerHeight
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const measured = el.scrollHeight;
    if (measured > 0) {
      const style = typeof window !== 'undefined' ? window.getComputedStyle(el) : null;
      const lineHeight =
        Number.parseFloat(style?.lineHeight || '') || MOBILE_COMPOSER_LINE_HEIGHT_PX;
      const paddingTop = Number.parseFloat(style?.paddingTop || '') || 0;
      const paddingBottom = Number.parseFloat(style?.paddingBottom || '') || 0;
      const padding =
        paddingTop + paddingBottom > 0 ? paddingTop + paddingBottom : MOBILE_COMPOSER_PADDING_PX;
      const minHeight =
        Number.parseFloat(style?.minHeight || '') || MOBILE_COMPOSER_MIN_HEIGHT_PX;
      const nextHeight = composerHeight({
        contentHeight: measured,
        lineHeight,
        padding,
        min: minHeight,
        lines: MOBILE_COMPOSER_MAX_LINES,
      });
      el.style.height = `${nextHeight}px`;
    }
  }, [draft]);

  const displayMessages: readonly ChatMessage[] = useMemo(() => {
    if (isLiveForKey) {
      return snapshot.messages;
    }
    if (cachedTail) {
      return cachedTail.messages;
    }
    return [];
  }, [cachedTail, isLiveForKey, snapshot.messages]);

  const isCurrentConversationSnap = snapshot.key === conversationKey;
  const canRetryNotice =
    isCurrentConversationSnap &&
    Boolean(snapshot.notice) &&
    !snapshot.busy &&
    !snapshot.conflict &&
    !snapshot.catalogBlocked &&
    !snapshot.settingsRequired &&
    snapshot.notice !== '已停止';
  const hasSessionError =
    openFailed ||
    (isCurrentConversationSnap &&
      (snapshot.status === 'error' || Boolean(snapshot.error) || snapshot.conflict));
  const hasErrorNotice = hasSessionError || canRetryNotice;
  const errorNoticeText =
    (isCurrentConversationSnap && (snapshot.error || snapshot.notice)) ||
    snapshot.error ||
    (openFailed ? '聊天没有加载出来，请重试。' : COPY.failed);

  const showSkeleton = !isLiveForKey && cachedTail === null && !hasSessionError;

  const rows = useMemo(
    () =>
      buildMobileConversationRows(displayMessages, {
        now: now ? now() : Date.now(),
        busy: isLiveForKey && snapshot.busy,
      }),
    [displayMessages, isLiveForKey, now, snapshot.busy],
  );

  const parsedKey = useMemo(() => parseConversationKey(conversationKey), [conversationKey]);
  const matchedConversation = useMemo(
    () => conversations.find((c) => c.key === conversationKey),
    [conversationKey, conversations],
  );

  const displayTitle = useMemo(() => {
    if (isLiveForKey && snapshot.characterName) return snapshot.characterName;
    if (cachedTail?.characterName) return cachedTail.characterName;
    if (matchedConversation?.title) return matchedConversation.title;
    if (parsedKey?.avatar) return parsedKey.avatar.replace(/\.[a-z0-9]+$/i, '');
    return '对话';
  }, [
    cachedTail?.characterName,
    isLiveForKey,
    matchedConversation?.title,
    parsedKey?.avatar,
    snapshot.characterName,
  ]);

  const resolvedAvatarUrl = useMemo(() => {
    if (isLiveForKey && snapshot.avatarUrl) return snapshot.avatarUrl;
    if (cachedTail?.avatarUrl) return cachedTail.avatarUrl;
    if (matchedConversation?.avatarUrl) return matchedConversation.avatarUrl;
    if (parsedKey?.avatar) return formatAvatarUrl(parsedKey.avatar);
    return '';
  }, [
    cachedTail?.avatarUrl,
    isLiveForKey,
    matchedConversation?.avatarUrl,
    parsedKey?.avatar,
    snapshot.avatarUrl,
  ]);

  const avatarInitial = useMemo(() => {
    const trimmed = displayTitle.trim();
    return trimmed ? Array.from(trimmed)[0] : '伴';
  }, [displayTitle]);

  const handleBackClick = useCallback(() => {
    goBack?.('/m/chat');
  }, [goBack]);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setDraft(e.target.value);
    },
    [setDraft],
  );

  const handleRetry = useCallback(async () => {
    const wasOpenFailed = openFailed;
    setOpenFailed(false);
    const retried = await bridge.retry();
    if (!retried && (wasOpenFailed || snapshot.status === 'error')) {
      const target = conversationsRef.current.find((c) => c.key === conversationKey);
      const result = await bridge.open(target ?? conversationKey);
      if (result === 'failed' && activeKeyRef.current === conversationKey) {
        setOpenFailed(true);
      }
    }
  }, [bridge, conversationKey, openFailed, snapshot.status]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const isComposing =
        e.nativeEvent.isComposing || (e as any).isComposing || e.keyCode === 229;
      if (enterToSend && e.key === 'Enter' && !e.shiftKey && !isComposing) {
        e.preventDefault();
        submitComposer();
      }
    },
    [enterToSend, submitComposer],
  );

  const renderMessageRow = useCallback(
    (_index: number, item: MobileConversationRowItem) => {
      const spaceClass =
        item.spacingBeforePx === 0
          ? 'vc-mobile-msg-item--space-0'
          : item.spacingBeforePx === 4
            ? 'vc-mobile-msg-item--space-4'
            : 'vc-mobile-msg-item--space-12';

      return (
        <div
          className={`vc-mobile-msg-item ${spaceClass}`}
          data-vc-chat-msg={item.key}
          data-vc-msg-role={item.role}
          data-vc-group-pos={item.groupPosition}
          data-vc-has-tail={item.hasTail ? 'true' : 'false'}
          data-vc-spacing-before={String(item.spacingBeforePx)}
        >
          {item.dateLabel ? (
            <div className="vc-mobile-date-pill-wrap">
              <span className="vc-mobile-date-pill" data-vc-date-pill="">
                {item.dateLabel}
              </span>
            </div>
          ) : null}

          <div className={`vc-mobile-msg-line vc-mobile-msg-line--${item.role}`}>
            {item.role === 'assistant' ? (
              <div className="vc-mobile-msg-avatar-slot">
                {item.showAvatar ? (
                  <span className="vc-mobile-msg-avatar" data-vc-message-avatar="">
                    {resolvedAvatarUrl ? (
                      <img src={resolvedAvatarUrl} alt="" className="vc-mobile-msg-avatar-img" />
                    ) : (
                      <span aria-hidden="true">{avatarInitial}</span>
                    )}
                  </span>
                ) : null}
              </div>
            ) : null}

            <div className="vc-mobile-bubble-col">
              <div
                className={`vc-mobile-bubble vc-mobile-bubble--${item.role}`}
                data-vc-bubble=""
                data-vc-group-pos={item.groupPosition}
                data-vc-has-tail={item.hasTail ? 'true' : 'false'}
              >
                <div className="vc-mobile-bubble-leaf">
                  {isLiveForKey ? (
                    <MessageLeaf message={item.message} index={item.index} />
                  ) : (
                    <div className="vc-desktop-message-content">
                      <div className="mes_text">{item.message.mes}</div>
                    </div>
                  )}
                </div>
                {item.isStreaming ? (
                  <span
                    className="vc-mobile-streaming-dot"
                    data-vc-streaming-indicator=""
                    aria-label="生成中"
                  />
                ) : null}
              </div>

              {item.isLastUserMessage ? (
                <div className="vc-mobile-sent-receipt" data-vc-sent-receipt="">
                  已发送
                </div>
              ) : null}
            </div>
          </div>
        </div>
      );
    },
    [avatarInitial, isLiveForKey, resolvedAvatarUrl],
  );

  return (
    <div
      className="vc-mobile-conversation"
      data-vc-mobile-conversation={conversationKey}
      data-vc-conversation-ready={isLiveForKey ? 'true' : 'false'}
      data-vc-conversation-from-cache={!isLiveForKey && cachedTail !== null ? 'true' : 'false'}
    >
      <header className="vc-mobile-chat-header" data-vc-chat-header="">
        <button
          type="button"
          className="vc-mobile-chat-back-btn"
          aria-label="返回"
          data-vc-chat-back=""
          data-vc-back-button={isActive ? '' : undefined}
          onClick={handleBackClick}
        >
          <Icon name="chevron-left" size={20} className="vc-mobile-icon" />
        </button>

        <div
          className="vc-mobile-identity-capsule"
          data-vc-identity-capsule=""
          data-vc-secondary-title={isActive ? '' : undefined}
        >
          <span className="vc-mobile-identity-avatar" data-vc-identity-avatar="">
            {resolvedAvatarUrl ? (
              <img src={resolvedAvatarUrl} alt="" className="vc-mobile-identity-avatar-img" />
            ) : (
              <span aria-hidden="true">{avatarInitial}</span>
            )}
          </span>
          <span className="vc-mobile-identity-name">{displayTitle}</span>
        </div>

        <div className="vc-mobile-chat-header-right" aria-hidden="true" />
      </header>

      <div className="vc-mobile-chat-stage">
        {showSkeleton ? (
          <div
            className="vc-mobile-chat-skeleton"
            data-vc-chat-skeleton=""
            aria-label="正在加载对话"
          >
            <div className="vc-mobile-chat-skeleton-row">
              <span className="vc-mobile-chat-skeleton-avatar" />
              <span className="vc-mobile-chat-skeleton-bubble" />
            </div>
            <div className="vc-mobile-chat-skeleton-row vc-mobile-chat-skeleton-row--user">
              <span className="vc-mobile-chat-skeleton-bubble" />
            </div>
            <div className="vc-mobile-chat-skeleton-row">
              <span className="vc-mobile-chat-skeleton-avatar" />
              <span className="vc-mobile-chat-skeleton-bubble" />
            </div>
          </div>
        ) : (
          <Virtuoso
            ref={virtuosoRef}
            className="vc-mobile-chat-scroller"
            data-vc-chat-virtuoso=""
            data={rows}
            alignToBottom
            initialTopMostItemIndex={INITIAL_TOP_MOST_ITEM_INDEX}
            computeItemKey={(idx, item) =>
              `${conversationKey}:${item.index}:${item.role}:${String(item.message.send_date ?? idx)}`
            }
            followOutput={(atBottom) =>
              keepsTail(
                {
                  scrollHeight: NEAR_BOTTOM_PX,
                  scrollTop: atBottom ? NEAR_BOTTOM_PX : 0,
                  clientHeight: 0,
                },
                { pin: true, threshold: NEAR_BOTTOM_PX },
              )
                ? 'auto'
                : false
            }
            atBottomThreshold={NEAR_BOTTOM_PX}
            atBottomStateChange={setIsAtBottom}
            components={VIRTUOSO_COMPONENTS}
            itemContent={renderMessageRow}
          />
        )}

        {!showSkeleton && !isAtBottom ? (
          <button
            type="button"
            className="vc-mobile-scroll-bottom-btn"
            data-vc-scroll-bottom=""
            aria-label="回到底部"
            onClick={() => scrollToBottom('smooth')}
          >
            <Icon name="chevron-down" size={16} className="vc-mobile-icon" />
            <span>回到底部</span>
          </button>
        ) : null}
      </div>

      {hasErrorNotice ? (
        <div className="vc-mobile-chat-error-bar" data-vc-chat-error="" role="status">
          <span>{errorNoticeText}</span>
          <button
            type="button"
            className="vc-mobile-chat-retry-btn"
            data-vc-chat-retry=""
            onClick={() => void handleRetry()}
          >
            {COPY.retry}
          </button>
        </div>
      ) : null}

      <div className="vc-mobile-composer-bar" data-vc-mobile-composer="">
        <div className="vc-mobile-composer-capsule">
          <textarea
            ref={textareaRef}
            rows={1}
            className="vc-mobile-composer-input"
            data-vc-composer-input=""
            aria-label="输入消息"
            placeholder="发消息…"
            value={draft}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
          />

          <button
            type="button"
            className={`vc-mobile-composer-action-btn${busy ? ' vc-mobile-composer-action-btn--stop' : ''}`}
            data-vc-composer-send={busy ? undefined : ''}
            data-vc-composer-stop={busy ? '' : undefined}
            aria-label={busy ? '停止生成' : '发送'}
            disabled={busy ? false : !canSubmit}
            onClick={() => {
              if (busy) {
                stopGeneration();
              } else {
                submitComposer();
              }
            }}
          >
            <Icon name={busy ? 'square' : 'arrow-up'} size={busy ? 16 : 18} className="vc-mobile-icon" />
          </button>
        </div>
      </div>
    </div>
  );
}
