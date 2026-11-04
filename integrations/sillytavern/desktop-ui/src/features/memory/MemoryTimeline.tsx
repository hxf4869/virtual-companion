import type { MemoryItem } from '../../data/queries/memory';
import { Button } from '../../design/components/Button';
import { EmptyState } from '../../design/components/EmptyState';
import { Spinner } from '../../design/components/Spinner';
import {
  clockOf,
  groupTimeline,
  idOf,
  lifecycleLabels,
  MEMORY_EMPTY_TAB,
  memoryMoment,
  sourceLabels,
  toneForLifecycle,
  typeLabels,
} from '../../../../extension/vc-model-settings/memory-logic.js';

const EXTRA_TYPE_LABELS: Record<string, string> = {
  ...(typeLabels as Record<string, string>),
  fact: '事实',
  preference: '偏好',
  event: '事件',
  boundary: '边界',
  promise: '约定',
  SharedEpisode: '共同经历',
  Commitment: '承诺',
  ConflictRepair: '和解',
  InsideJoke: '暗号与梗',
};

const EXTRA_SOURCE_LABELS: Record<string, string> = {
  ...(sourceLabels as Record<string, string>),
  chat_turn: '对话提取',
  consolidation: '睡眠巩固',
  user_explicit: '主动记住',
  user_edit: '手动纠正',
};

const EXTRA_LIFECYCLE_LABELS: Record<string, string> = {
  ...(lifecycleLabels as Record<string, string>),
  active: '生效中',
  corrected: '已纠正',
  forgotten: '已遗忘',
  forgetting: '清理中',
  superseded: '已被替代',
  candidate: '待确认',
};

export interface MemoryTimelineProps {
  items: MemoryItem[];
  selectedId: string | null;
  loading?: boolean;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  onSelect: (item: MemoryItem) => void;
  onLoadMore?: () => void;
}

export function MemoryTimeline({
  items,
  selectedId,
  loading = false,
  hasNextPage = false,
  isFetchingNextPage = false,
  onSelect,
  onLoadMore,
}: MemoryTimelineProps) {
  if (loading && items.length === 0) {
    return (
      <div className="vc-memory-timeline vc-memory-timeline--loading">
        <Spinner size={24} label="加载记忆中" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="vc-memory-timeline vc-memory-timeline--empty" role="region" aria-label="记忆时间线">
        <EmptyState icon="brain" title={MEMORY_EMPTY_TAB} />
        {hasNextPage && onLoadMore ? (
          <div className="vc-memory-timeline__more">
            <Button
              variant="gray"
              pending={isFetchingNextPage}
              onClick={onLoadMore}
            >
              加载更多
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  const groups = groupTimeline(items);

  return (
    <div className="vc-memory-timeline" role="region" aria-label="记忆时间线">
      {groups.map((group) => (
        <section key={group.key || 'unknown'} className="vc-memory-timeline__group">
          <h3 className="vc-memory-timeline__day">{group.label}</h3>
          <ul className="vc-memory-timeline__list">
            {group.items.map((item: MemoryItem) => {
              const itemId = idOf(item);
              const isSelected = selectedId === itemId;
              const typeLabel =
                EXTRA_TYPE_LABELS[String(item.type ?? '')] || String(item.type || '记忆');
              const sourceLabel =
                EXTRA_SOURCE_LABELS[String(item.source ?? item.sourceStatus ?? '')] ||
                String(item.source || '');
              const lifeLabel =
                EXTRA_LIFECYCLE_LABELS[String(item.lifecycle ?? '')] ||
                String(item.lifecycle || '生效中');
              const lifeTone = toneForLifecycle(item.lifecycle);
              const timeStr = clockOf(memoryMoment(item));
              const isPinned = Boolean(item.pinned || item.pinnedAt);

              return (
                <li key={itemId} className="vc-memory-timeline__item-wrap">
                  <button
                    type="button"
                    aria-current={isSelected ? 'true' : undefined}
                    className={[
                      'vc-memory-card',
                      isSelected ? 'vc-memory-card--selected' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => onSelect(item)}
                  >
                    <div className="vc-memory-card__meta">
                      <span className="vc-memory-badge">{typeLabel}</span>
                      {sourceLabel ? (
                        <span className="vc-memory-badge vc-memory-badge--muted">
                          {sourceLabel}
                        </span>
                      ) : null}
                      <span className={`vc-memory-badge vc-memory-badge--${lifeTone}`}>
                        {lifeLabel}
                      </span>
                      {isPinned ? (
                        <span className="vc-memory-badge vc-memory-badge--accent">已置顶</span>
                      ) : null}
                      {timeStr ? <span className="vc-memory-card__time">{timeStr}</span> : null}
                    </div>
                    <p className="vc-memory-card__summary">{item.summary}</p>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {hasNextPage && onLoadMore ? (
        <div className="vc-memory-timeline__more">
          <Button
            variant="gray"
            pending={isFetchingNextPage}
            onClick={onLoadMore}
          >
            加载更多
          </Button>
        </div>
      ) : null}
    </div>
  );
}
