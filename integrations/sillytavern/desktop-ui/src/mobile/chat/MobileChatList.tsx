import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import {
  IonItem,
  IonItemOption,
  IonItemOptions,
  IonItemSliding,
} from '@ionic/react';
import { useQuery } from '@tanstack/react-query';
import {
  avatarUrl,
  CONVERSATIONS_EMPTY_ACTION,
  CONVERSATIONS_ERROR_COPY,
  CONVERSATIONS_RETRY_LABEL,
  desktopConversationTime,
  EMPTY_CONVERSATIONS_COPY,
  instanceTail,
} from '../../../../extension/vc-model-settings/conversations.js';
import { NEUTRAL_TINT, tintOf } from '../../../../extension/vc-model-settings/ui/tint.js';
import {
  normalizeConversationKey,
  useConversationsQuery,
  type ConversationRow,
} from '../../data/queries/chat';
import { usePreferences } from '../../design/theme/usePreferences';
import {
  DEFAULT_AUTHORITY_EPOCH,
  type ChatAuthorityEpoch,
  type ChatRevision,
  type ChatStoragePort,
  type StoredChatSummary,
} from './data/chatStoragePort';
import type { ChatTailCache } from './data/chatTailCache';
import { scheduleIdleChatPrefetch } from './data/chatTailPrefetch';
import { formatMobileConversationPreview } from './data/conversationPreview';
import { MobileIcon } from '../components/MobileIcon';
import './mobile-chat-list.css';

const FALLBACK_AURA_TINTS: readonly string[] = [
  '124, 92, 246',
  '56, 139, 253',
  '236, 108, 158',
  '48, 176, 199',
  '245, 158, 66',
  '76, 195, 138',
];

function fallbackTintForSeed(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % FALLBACK_AURA_TINTS.length;
  return FALLBACK_AURA_TINTS[idx];
}

export interface MobileConversationRow extends ConversationRow {
  pinned?: boolean;
  unreadCount?: number;
  voiceDurationSec?: number;
  voiceDurationMs?: number;
  hasInteractiveCard?: boolean;
  tint?: string;
  chatId?: string;
  chatRevision?: ChatRevision;
  orderRevision?: ChatRevision;
}

export interface MobileChatListProps {
  rows?: readonly MobileConversationRow[];
  activeKey?: string | null;
  status?: 'loading' | 'error' | 'ready';
  storagePort?: ChatStoragePort | null;
  tailCache?: ChatTailCache | null;
  readDraft?: (key: string) => string;
  onSelectConversation?: (row: MobileConversationRow) => void;
  onNavigate?: (to: string) => void;
  onPinConversation?: (row: MobileConversationRow) => void;
  onTogglePin?: (row: MobileConversationRow) => void;
  onDeleteConversation?: (row: MobileConversationRow) => void;
  onRetry?: () => void;
  renderList?: (
    items: readonly MobileConversationRow[],
    renderRow: (row: MobileConversationRow, index: number) => ReactNode,
  ) => ReactNode;
}

function storedChatSummaryToMobileRow(
  summary: StoredChatSummary,
  readDraft?: (key: string) => string,
): MobileConversationRow {
  const rawAvatar = String(summary.avatar || `${summary.characterName || summary.title || 'chat'}.png`);
  const key = normalizeConversationKey(rawAvatar, summary.chatId);
  const updatedMs = Date.parse(summary.updatedAt);
  const safeMs = Number.isFinite(updatedMs) ? updatedMs : 0;
  const draft = readDraft ? readDraft(key) : '';
  return {
    key,
    chatId: summary.chatId,
    avatar: rawAvatar,
    file: summary.chatId,
    avatarUrl: summary.avatar ? avatarUrl(summary.avatar) : '',
    title: summary.characterName || summary.title || summary.chatId,
    instanceName:
      summary.title && summary.characterName && summary.title !== summary.characterName
        ? summary.title
        : undefined,
    preview: summary.preview || '暂无消息',
    updatedAt: safeMs,
    timeText: safeMs > 0 ? desktopConversationTime(safeMs) : undefined,
    relationshipId: summary.relationshipId ?? undefined,
    characterRef: summary.characterRef ?? undefined,
    chatRevision: summary.chatRevision,
    orderRevision: summary.orderRevision,
    draft: draft || undefined,
  };
}

export function MobileChatList({
  rows: propRows,
  activeKey = null,
  status: propStatus,
  storagePort,
  tailCache,
  readDraft: readDraftProp,
  onSelectConversation,
  onNavigate,
  onPinConversation,
  onTogglePin,
  onDeleteConversation,
  onRetry,
  renderList,
}: MobileChatListProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [sampledTints, setSampledTints] = useState<Record<string, string>>({});
  const pinnedConversationKeys = usePreferences((s) => s.pinnedConversationKeys);
  const togglePinnedConversation = usePreferences((s) => s.togglePinnedConversation);
  const pinnedSet = useMemo(() => new Set(pinnedConversationKeys), [pinnedConversationKeys]);

  const conversationsQuery = useConversationsQuery(readDraftProp);

  const storedChatsQuery = useQuery({
    queryKey: ['mobileStoredChats', Boolean(storagePort)] as const,
    enabled: !propRows && Boolean(storagePort),
    queryFn: async () => {
      if (!storagePort) {
        return {
          items: [] as StoredChatSummary[],
          nextCursor: null,
          authorityEpoch: DEFAULT_AUTHORITY_EPOCH as ChatAuthorityEpoch,
        };
      }
      return storagePort.listStoredChats({ limit: 50 });
    },
  });

  // Schedule idle prefetch of recent conversations' last pages when SX-2 storagePort & tailCache are present
  useEffect(() => {
    if (!storagePort || !tailCache || !storedChatsQuery.data?.items.length) {
      return;
    }
    const handle = scheduleIdleChatPrefetch({
      chats: storedChatsQuery.data.items,
      authorityEpoch: storedChatsQuery.data.authorityEpoch,
      port: storagePort,
      cache: tailCache,
      maxPrefetchCount: 5,
    });
    return () => {
      handle.cancel();
    };
  }, [storagePort, tailCache, storedChatsQuery.data]);

  const baseRows = useMemo<readonly MobileConversationRow[]>(() => {
    if (propRows) {
      return propRows.map((row) => {
        const bridgeDraft = readDraftProp ? readDraftProp(row.key) : '';
        return {
          ...row,
          draft: row.draft ?? (bridgeDraft || undefined),
        };
      });
    }

    if (storagePort && storedChatsQuery.data) {
      return storedChatsQuery.data.items.map((summary) =>
        storedChatSummaryToMobileRow(summary, readDraftProp),
      );
    }

    return conversationsQuery.rows;
  }, [
    propRows,
    storagePort,
    storedChatsQuery.data,
    conversationsQuery.rows,
    readDraftProp,
  ]);

  // Sample avatar aura tint asynchronously when avatar URLs are available
  useEffect(() => {
    let cancelled = false;
    for (const row of baseRows) {
      const src = row.avatarUrl || '';
      if (!src || sampledTints[src] || row.tint) continue;
      void tintOf(src).then((rgb: string) => {
        if (cancelled || !rgb || rgb === NEUTRAL_TINT) return;
        setSampledTints((prev) => (prev[src] === rgb ? prev : { ...prev, [src]: rgb }));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [baseRows, sampledTints]);

  const orderedRows = useMemo<readonly MobileConversationRow[]>(() => {
    const indexed = baseRows.map((row, idx) => ({ row, idx }));
    const isRowPinned = (row: MobileConversationRow) =>
      row.pinned ?? pinnedSet.has(row.key);
    const sortByTimeDesc = (
      a: { row: MobileConversationRow; idx: number },
      b: { row: MobileConversationRow; idx: number },
    ) => {
      const timeA = Number.isFinite(a.row.updatedAt) ? a.row.updatedAt : 0;
      const timeB = Number.isFinite(b.row.updatedAt) ? b.row.updatedAt : 0;
      const diff = timeB - timeA;
      return diff !== 0 ? diff : a.idx - b.idx;
    };
    const pinned = indexed.filter((item) => isRowPinned(item.row)).sort(sortByTimeDesc);
    const unpinned = indexed.filter((item) => !isRowPinned(item.row)).sort(sortByTimeDesc);
    return [...pinned, ...unpinned].map((item) => item.row);
  }, [baseRows, pinnedSet]);

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return orderedRows;
    return orderedRows.filter((row) => {
      const inst = row.instanceName ? instanceTail(row.title, row.instanceName) : '';
      const haystack = [row.title, row.instanceName, inst, row.preview, row.draft]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [orderedRows, searchQuery]);

  const resolvedStatus: 'loading' | 'error' | 'ready' = useMemo(() => {
    if (propStatus) return propStatus;
    if (propRows) return 'ready';
    if (storagePort) {
      if (storedChatsQuery.isLoading) return 'loading';
      if (storedChatsQuery.isError) return 'error';
      return 'ready';
    }
    if (conversationsQuery.isLoading) return 'loading';
    if (conversationsQuery.isError) return 'error';
    return 'ready';
  }, [
    propStatus,
    propRows,
    storagePort,
    storedChatsQuery.isLoading,
    storedChatsQuery.isError,
    conversationsQuery.isLoading,
    conversationsQuery.isError,
  ]);

  const externalPinHandler = onPinConversation ?? onTogglePin;
  const canDelete = typeof onDeleteConversation === 'function';

  const handlePinAction = (
    row: MobileConversationRow,
    event: ReactMouseEvent<HTMLIonItemOptionElement>,
  ) => {
    const slidingEl = event.currentTarget.closest('ion-item-sliding') as
      | (HTMLElement & { close?: () => Promise<void> })
      | null;
    if (typeof externalPinHandler === 'function') {
      externalPinHandler(row);
    } else {
      togglePinnedConversation(row.key);
    }
    void slidingEl?.close?.();
  };

  const handleRowSelect = (row: MobileConversationRow) => {
    if (onSelectConversation) {
      onSelectConversation(row);
      return;
    }
    const targetPath = `/m/chat/${encodeURIComponent(row.key)}`;
    if (onNavigate) {
      onNavigate(targetPath);
    }
  };

  const handleRetry = () => {
    if (onRetry) {
      onRetry();
      return;
    }
    if (storagePort) {
      void storedChatsQuery.refetch();
      return;
    }
    void conversationsQuery.refetch();
  };

  const renderConversationRow = (row: MobileConversationRow) => {
    const isActive = Boolean(activeKey && row.key === activeKey);
    const isPinned = row.pinned ?? pinnedSet.has(row.key);
    const instChip = row.instanceName
      ? instanceTail(row.title, row.instanceName)
      : '';
    const displayTime =
      row.timeText ||
      (row.updatedAt > 0 ? desktopConversationTime(row.updatedAt) : '');
    const formattedPreview = formatMobileConversationPreview({
      draft: row.draft,
      voiceDurationSec: row.voiceDurationSec,
      voiceDurationMs: row.voiceDurationMs,
      hasInteractiveCard: row.hasInteractiveCard,
      preview: row.preview,
    });
    const unreadCount = typeof row.unreadCount === 'number' ? row.unreadCount : 0;
    const showUnreadBadge = unreadCount > 0;
    const showUnreadDot = !showUnreadBadge && Boolean(row.unread);
    const resolvedTint =
      row.tint ||
      (row.avatarUrl ? sampledTints[row.avatarUrl] : undefined) ||
      fallbackTintForSeed(row.title || row.key);
    const initialGlyph = Array.from((row.title || '伴').trim())[0] || '伴';

    const rowStyle = {
      '--tint': resolvedTint,
      '--vc-char-tint': resolvedTint,
    } as CSSProperties;

    return (
      <IonItemSliding key={row.key} className="vc-mobile-convo-sliding">
        <IonItem lines="none" className="vc-mobile-convo-ion-item">
          <button
            type="button"
            className="vc-mobile-convo-card"
            style={rowStyle}
            data-vc-mobile-convo-row={row.key}
            data-conversation-key={row.key}
            data-relationship-id={row.relationshipId || undefined}
            data-vc-pinned={isPinned ? 'true' : undefined}
            data-active={isActive ? 'true' : 'false'}
            aria-current={isActive ? 'true' : undefined}
            onClick={() => handleRowSelect(row)}
          >
            <span className="vc-mobile-convo-avatar" data-vc-convo-avatar="">
              {row.avatarUrl ? (
                <img
                  className="vc-mobile-convo-avatar-img"
                  src={row.avatarUrl}
                  alt={row.title || ''}
                />
              ) : (
                <span className="vc-mobile-convo-avatar-fallback" aria-hidden="true">
                  {initialGlyph}
                </span>
              )}
            </span>

            <span className="vc-mobile-convo-body">
              <span className="vc-mobile-convo-top">
                <span className="vc-mobile-convo-title-group">
                  <span className="vc-mobile-convo-name">{row.title}</span>
                  {instChip && instChip !== row.title ? (
                    <span
                      className="vc-mobile-convo-instance-chip"
                      data-vc-convo-instance=""
                    >
                      {instChip}
                    </span>
                  ) : null}
                </span>
                {isPinned || displayTime ? (
                  <span className="vc-mobile-convo-meta">
                    {isPinned ? (
                      <span
                        className="vc-mobile-convo-pin-mark"
                        data-vc-convo-pin-mark=""
                        role="img"
                        aria-label="已置顶"
                      >
                        <MobileIcon name="pin" size={12} />
                      </span>
                    ) : null}
                    {displayTime ? (
                      <span className="vc-mobile-convo-time">{displayTime}</span>
                    ) : null}
                  </span>
                ) : null}
              </span>

              <span className="vc-mobile-convo-bottom">
                <span
                  className="vc-mobile-convo-preview"
                  data-vc-convo-preview={formattedPreview.kind}
                >
                  {formattedPreview.kind === 'draft' ? (
                    <>
                      <span className="vc-mobile-convo-draft-prefix">
                        {formattedPreview.prefix}
                      </span>
                      {formattedPreview.body}
                    </>
                  ) : formattedPreview.kind === 'voice' ? (
                    <span className="vc-mobile-convo-voice-preview">
                      <MobileIcon name="mic" size={14} />
                      <span>{formattedPreview.text}</span>
                    </span>
                  ) : formattedPreview.kind === 'card' ? (
                    <span className="vc-mobile-convo-card-preview">
                      {formattedPreview.text}
                    </span>
                  ) : (
                    formattedPreview.text
                  )}
                </span>

                {showUnreadBadge ? (
                  <span
                    className="vc-mobile-convo-unread-badge"
                    data-vc-convo-unread-badge=""
                  >
                    {unreadCount > 99 ? '99+' : String(unreadCount)}
                  </span>
                ) : showUnreadDot ? (
                  <span
                    className="vc-mobile-convo-unread-dot"
                    data-vc-convo-unread-dot=""
                    aria-label="未读"
                  />
                ) : null}
              </span>
            </span>
          </button>
        </IonItem>

        <IonItemOptions side="end" className="vc-mobile-convo-options">
          <IonItemOption
            className="vc-mobile-swipe-option vc-mobile-swipe-option--pin"
            data-vc-swipe-action="pin"
            onClick={(event) => handlePinAction(row, event)}
          >
            <span className="vc-mobile-swipe-option-content">
              <MobileIcon name={isPinned ? 'pin-off' : 'pin'} size={18} />
              <span>{isPinned ? '取消置顶' : '置顶'}</span>
            </span>
          </IonItemOption>
          {canDelete ? (
            <IonItemOption
              className="vc-mobile-swipe-option vc-mobile-swipe-option--delete"
              data-vc-swipe-action="delete"
              onClick={() => onDeleteConversation?.(row)}
            >
              <span className="vc-mobile-swipe-option-content">
                <MobileIcon name="trash-2" size={18} />
                <span>删除</span>
              </span>
            </IonItemOption>
          ) : null}
        </IonItemOptions>
      </IonItemSliding>
    );
  };

  return (
    <div className="vc-mobile-chat-tab" data-vc-mobile-chat-list="">
      <div className="vc-mobile-search-bar">
        <MobileIcon name="search" size={18} className="vc-mobile-search-icon" />
        <input
          type="search"
          role="searchbox"
          className="vc-mobile-search-input"
          placeholder="搜索"
          aria-label="搜索会话"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchQuery ? (
          <button
            type="button"
            className="vc-mobile-search-clear"
            aria-label="清除搜索"
            onClick={() => setSearchQuery('')}
          >
            <MobileIcon name="x" size={14} />
          </button>
        ) : null}
      </div>

      {resolvedStatus === 'loading' ? (
        <div className="vc-mobile-convo-list" data-vc-convo-loading="">
          {[0, 1, 2].map((idx) => (
            <div key={idx} className="vc-mobile-convo-skeleton-card">
              <span className="vc-mobile-convo-skeleton-avatar" />
              <span className="vc-mobile-convo-skeleton-lines">
                <span className="vc-mobile-convo-skeleton-line" />
                <span className="vc-mobile-convo-skeleton-line vc-mobile-convo-skeleton-line--short" />
              </span>
            </div>
          ))}
        </div>
      ) : resolvedStatus === 'error' ? (
        <div className="vc-mobile-convo-state" role="alert">
          <MobileIcon name="circle-alert" size={28} />
          <p className="vc-mobile-convo-state-text">{CONVERSATIONS_ERROR_COPY}</p>
          <button
            type="button"
            className="vc-mobile-convo-state-btn"
            onClick={handleRetry}
          >
            {CONVERSATIONS_RETRY_LABEL}
          </button>
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="vc-mobile-convo-state" data-vc-convo-empty="">
          <MobileIcon name="message-circle" size={28} />
          <p className="vc-mobile-convo-state-text">
            {searchQuery.trim() ? '没有找到' : EMPTY_CONVERSATIONS_COPY}
          </p>
          {!searchQuery.trim() && onNavigate ? (
            <button
              type="button"
              className="vc-mobile-convo-state-btn"
              onClick={() => onNavigate('/m/characters')}
            >
              {CONVERSATIONS_EMPTY_ACTION}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="vc-mobile-convo-list" role="list">
          {renderList
            ? renderList(filteredRows, (row) => renderConversationRow(row))
            : filteredRows.map((row) => renderConversationRow(row))}
        </div>
      )}
    </div>
  );
}
