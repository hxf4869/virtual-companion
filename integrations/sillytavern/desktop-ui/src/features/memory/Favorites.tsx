import { Button } from '../../design/components/Button';
import { EmptyState } from '../../design/components/EmptyState';
import { Segment } from '../../design/components/Segment';
import {
  FAVORITES_EMPTY,
  monthDay,
  REMINDERS_EMPTY,
  reminderWhen,
} from '../../../../extension/vc-model-settings/memory-logic.js';
import {
  FAVORITE_SEGMENT_OPTIONS,
  useFavoritesState,
  type LocateMessagePayload,
} from './useMemoryState';

export interface FavoritesProps {
  relId: string | null;
  onNavigateToMessage: (payload: LocateMessagePayload) => void | Promise<void>;
}

export function Favorites({ relId, onNavigateToMessage }: FavoritesProps) {
  const {
    segment,
    setSegment,
    errorMessage,
    favorites,
    reminders,
    favoritesQuery,
    deleteFavPending,
    deleteRemPending,
    handleJumpFavorite,
    handleRemoveFavorite,
    handleRemoveReminder,
  } = useFavoritesState({
    relId,
    onNavigateToMessage,
  });

  return (
    <section className="vc-memory-favorites" aria-label="收藏与提醒">
      <div className="vc-memory-favorites__header">
        <Segment
          aria-label="收藏与提醒切换"
          value={segment}
          options={FAVORITE_SEGMENT_OPTIONS}
          onValueChange={(val) => setSegment(val === 'reminders' ? 'reminders' : 'favorites')}
        />
      </div>

      {errorMessage ? (
        <div className="vc-memory-detail-pane__error" role="alert">
          {errorMessage}
        </div>
      ) : null}

      {segment === 'favorites' ? (
        <>
          {favorites.length === 0 ? (
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
                        disabled={deleteFavPending}
                        onClick={() => void handleRemoveFavorite(favId)}
                      >
                        移除收藏
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {favoritesQuery.hasNextPage ? (
            <div className="vc-memory-timeline__more">
              <Button
                variant="gray"
                className="vc-btn-text"
                data-action="fav-more"
                pending={favoritesQuery.isFetchingNextPage}
                onClick={() => void favoritesQuery.fetchNextPage()}
              >
                加载更多
              </Button>
            </div>
          ) : null}
        </>
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
                  disabled={deleteRemPending}
                  onClick={() => void handleRemoveReminder(remId)}
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
