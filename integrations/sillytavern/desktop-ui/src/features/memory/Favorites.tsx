import { useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useAppClient } from '../../app/providers';
import { normalizeConversationKey } from '../../data/queries/chat';
import {
  useDeleteFavorite,
  useDeleteReminder,
  useFavorites,
  useReminders,
  type FavoriteItem,
} from '../../data/queries/memory';
import { useSessionBridge } from '../../runtime/session-bridge';
import { useChatUi } from '../chat/ChatRoute';
import { Button } from '../../design/components/Button';
import { EmptyState } from '../../design/components/EmptyState';
import { Segment } from '../../design/components/Segment';
import {
  chatSnapshotsFromRecent,
  FAVORITES_EMPTY,
  FAVORITES_SEGMENTS,
  monthDay,
  openMessageSource,
  REMINDERS_EMPTY,
  reminderWhen,
} from '../../../../extension/vc-model-settings/memory-logic.js';
import { isCurrentConversation, type LocateMessagePayload } from './MemoryItemDetail';

const SEGMENT_OPTIONS = FAVORITES_SEGMENTS.map(([value, label]) => ({
  value: String(value),
  label: String(label),
}));

export interface FavoritesProps {
  relId: string | null;
  onNavigateToMessage?: (payload: LocateMessagePayload) => void | Promise<void>;
}

export function Favorites({ relId, onNavigateToMessage }: FavoritesProps) {
  const client = useAppClient();
  const navigate = useNavigate();
  const [segment, setSegment] = useState<'favorites' | 'reminders'>('favorites');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const favoritesQuery = useFavorites(relId);
  const remindersQuery = useReminders(relId);
  const deleteFavMutation = useDeleteFavorite(relId);
  const deleteRemMutation = useDeleteReminder(relId);
  const bridge = useSessionBridge();
  const chatUi = useChatUi();

  const mountedRef = useRef(true);
  const jumpTicketRef = useRef(0);
  const navigatingSelfRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (!navigatingSelfRef.current) {
        jumpTicketRef.current += 1;
      }
    };
  }, []);

  useEffect(() => {
    jumpTicketRef.current += 1;
    setErrorMessage(null);
  }, [relId, segment]);

  const favorites = favoritesQuery.data ?? [];
  const reminders = remindersQuery.data ?? [];

  const handleJumpFavorite = async (fav: FavoriteItem) => {
    const ticket = ++jumpTicketRef.current;
    setErrorMessage(null);
    const relationshipId = String(fav.relationshipId ?? relId ?? '');
    const detail = {
      relationshipId,
      chatFile: fav.chatFile,
      body: fav.body ?? fav.content ?? '',
      role: fav.role ?? 'character',
      messageAt: fav.messageAt ?? fav.createdAt,
    };
    let openedTarget = null as {
      relationshipId?: string;
      file?: string;
      avatar?: string;
    } | null;

    try {
      const floor = await openMessageSource(detail, {
        getContext: () => bridge.getContext(),
        loadChats: async () => chatSnapshotsFromRecent(await client.recent()),
        openConversation: async (target: {
          relationshipId?: string;
          file?: string;
          avatar?: string;
        }) => {
          if (!mountedRef.current || jumpTicketRef.current !== ticket) {
            return false;
          }
          const avatar = target.avatar || bridge.getSnapshot().avatar;
          openedTarget = { ...target, avatar };
          const status = await bridge.open(openedTarget);
          return (
            status === 'opened' &&
            mountedRef.current &&
            jumpTicketRef.current === ticket
          );
        },
        ensureVisible: () => {},
      });

      if (!mountedRef.current || jumpTicketRef.current !== ticket) {
        return;
      }

      const ctx = bridge.getContext();
      const currentChatFile = String(
        ctx?.getCurrentChatId?.() || ctx?.chatId || '',
      ).replace(/\.jsonl$/i, '');
      const currentAvatar =
        ctx?.characters?.[ctx?.characterId]?.avatar || bridge.getSnapshot().avatar;
      const resolvedFile =
        openedTarget?.file ||
        String(fav.chatFile ?? '').replace(/\.jsonl$/i, '') ||
        currentChatFile;
      const resolvedAvatar = openedTarget?.avatar || currentAvatar;
      const conversationKey =
        resolvedAvatar && resolvedFile
          ? normalizeConversationKey(resolvedAvatar, resolvedFile)
          : bridge.getSnapshot().key;

      if (!conversationKey || !isCurrentConversation(bridge, conversationKey)) {
        return;
      }

      navigatingSelfRef.current = true;
      try {
        if (onNavigateToMessage) {
          await onNavigateToMessage({
            relationshipId,
            chatFile: resolvedFile,
            avatar: resolvedAvatar,
            conversationKey,
            floor,
            excerpt: detail.body,
          });
        } else {
          await navigate({
            to: '/chat/$conversationKey',
            params: { conversationKey },
          });
        }
      } finally {
        navigatingSelfRef.current = false;
      }

      if (
        jumpTicketRef.current !== ticket ||
        !isCurrentConversation(bridge, conversationKey)
      ) {
        return;
      }

      chatUi?.requestMessageJump(conversationKey, floor);
    } catch {
      if (mountedRef.current && jumpTicketRef.current === ticket) {
        setErrorMessage('原消息无法定位或所在会话不可用。');
      }
    }
  };

  return (
    <section className="vc-memory-favorites" aria-label="收藏与提醒">
      <div className="vc-memory-favorites__header">
        <Segment
          aria-label="收藏与提醒切换"
          value={segment}
          options={SEGMENT_OPTIONS}
          onValueChange={(val) => setSegment(val === 'reminders' ? 'reminders' : 'favorites')}
        />
      </div>

      {errorMessage ? (
        <div className="vc-memory-detail-pane__error" role="alert">
          {errorMessage}
        </div>
      ) : null}

      {segment === 'favorites' ? (
        favorites.length === 0 ? (
          <EmptyState icon="star" title={FAVORITES_EMPTY} />
        ) : (
          <ul className="vc-memory-favorites__grid">
            {favorites.map((fav) => {
              const favId = String(fav.favoriteId ?? fav.id ?? '');
              const dateText = monthDay(fav.messageAt ?? fav.createdAt ?? '');
              return (
                <li key={favId} className="vc-memory-favorite-card">
                  <div className="vc-memory-favorite-card__meta">
                    <span>{fav.speakerName || (fav.role === 'user' ? '我' : '角色')}</span>
                    {dateText ? <span>{dateText}</span> : null}
                  </div>
                  <p className="vc-memory-favorite-card__body">{fav.body ?? fav.content}</p>
                  <div className="vc-memory-favorite-card__actions">
                    <Button
                      variant="gray"
                      size="sm"
                      onClick={() => void handleJumpFavorite(fav)}
                    >
                      回到对话
                    </Button>
                    <Button
                      variant="danger-soft"
                      size="sm"
                      disabled={deleteFavMutation.isPending}
                      onClick={() => void deleteFavMutation.mutateAsync(favId)}
                    >
                      移除收藏
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )
      ) : reminders.length === 0 ? (
        <EmptyState icon="clock" title={REMINDERS_EMPTY} />
      ) : (
        <ul className="vc-memory-reminders__list">
          {reminders.map((rem) => {
            const remId = String(rem.reminderId ?? rem.id ?? '');
            const whenText = reminderWhen(rem.remindAt ?? rem.dueAt ?? '');
            return (
              <li key={remId} className="vc-memory-reminder-item">
                <div className="vc-memory-reminder-item__main">
                  <strong>{rem.text ?? rem.title}</strong>
                  {whenText ? <span>{whenText}</span> : null}
                </div>
                <Button
                  variant="danger-soft"
                  size="sm"
                  disabled={deleteRemMutation.isPending}
                  onClick={() => void deleteRemMutation.mutateAsync(remId)}
                >
                  取消提醒
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
