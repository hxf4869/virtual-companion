import { useState } from 'react';
import {
  useInbox,
  useMarkInboxRead,
  type InboxEvent,
  type InboxFilter,
} from '../../data/queries/inbox';
import { useSessionBridge } from '../../runtime/session-bridge';
import { Button } from '../../design/components/Button';
import { EmptyState } from '../../design/components/EmptyState';
import { Segment } from '../../design/components/Segment';
import { FILTERS, previewOf, writeLabel } from '../../../../extension/vc-model-settings/inbox-logic.js';

const FILTER_OPTIONS = FILTERS.map(([value, label]) => ({
  value: String(value),
  label: String(label),
}));

export interface InboxListProps {
  initialFilter?: InboxFilter;
  onOpenEvent?: (event: InboxEvent) => void | Promise<void>;
}

export function InboxList({ initialFilter = 'all', onOpenEvent }: InboxListProps) {
  const [filter, setFilter] = useState<InboxFilter>(initialFilter);
  const inboxQuery = useInbox(filter);
  const markReadMutation = useMarkInboxRead();
  const bridge = useSessionBridge();

  const events = inboxQuery.data ?? [];

  const handleOpen = async (event: InboxEvent) => {
    if (event.linkStatus !== 'present') return;
    if (!event.read) {
      try {
        await markReadMutation.mutateAsync(event.eventId);
      } catch {
        // Keep navigation available even if read-receipt fails transiently
      }
    }
    if (event.conversationKey && bridge) {
      await bridge.open(event.conversationKey);
    }
    await onOpenEvent?.(event);
  };

  return (
    <section className="vc-inbox-card vc-inbox-list" aria-label="收件箱消息">
      <div className="vc-inbox-card__header">
        <h3 className="vc-inbox-card__title">收件箱</h3>
        <Segment
          aria-label="收件箱筛选"
          value={filter}
          options={FILTER_OPTIONS}
          onValueChange={(next) => setFilter(next)}
        />
      </div>

      {events.length === 0 ? (
        <EmptyState icon="inbox" title="没有符合条件的陪伴消息" />
      ) : (
        <ul className="vc-inbox-list__items">
          {events.map((item) => {
            const statusText = writeLabel(item);
            const preview = item.intent === 'WAITING_HOST' ? '需要打开此会话继续' : previewOf(item);
            const canOpen = item.linkStatus === 'present';

            return (
              <li
                key={item.eventId}
                className={[
                  'vc-inbox-list__item',
                  !item.read ? 'vc-inbox-list__item--unread' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <div className="vc-inbox-list__content">
                  <div className="vc-inbox-list__meta">
                    <span className="vc-inbox-badge">{statusText}</span>
                    {!item.read ? <span className="vc-inbox-unread-dot" aria-label="未读" /> : null}
                  </div>
                  <p className="vc-inbox-list__preview">{preview || '新陪伴消息'}</p>
                </div>
                {canOpen ? (
                  <Button
                    variant="gray"
                    size="sm"
                    onClick={() => void handleOpen(item)}
                  >
                    打开对话
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
