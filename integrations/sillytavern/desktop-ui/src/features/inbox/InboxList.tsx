import { useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useAppClient } from '../../app/providers';
import { normalizeConversationKey } from '../../data/queries/chat';
import {
  useInbox,
  useMarkInboxRead,
  type InboxEvent,
  type InboxFilter,
} from '../../data/queries/inbox';
import { Button } from '../../design/components/Button';
import { EmptyState } from '../../design/components/EmptyState';
import { Segment } from '../../design/components/Segment';
import { resolveDesktopConversation } from '../../../../extension/vc-model-settings/desktop/standalone/business.js';
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
  const client = useAppClient();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<InboxFilter>(initialFilter);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const inboxQuery = useInbox(filter);
  const markReadMutation = useMarkInboxRead();

  const mountedRef = useRef(true);
  const openTicketRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      openTicketRef.current += 1;
    };
  }, []);

  const events = inboxQuery.data ?? [];

  const handleOpen = async (event: InboxEvent) => {
    if (event.linkStatus !== 'present') return;
    const ticket = ++openTicketRef.current;
    setErrorMessage(null);

    if (!event.read) {
      try {
        await markReadMutation.mutateAsync(event.eventId);
      } catch {
        if (mountedRef.current && openTicketRef.current === ticket) {
          setErrorMessage('没有记下已读，请重试。');
        }
        return;
      }
      if (!mountedRef.current || openTicketRef.current !== ticket) {
        return;
      }
    }

    let conversationKey = event.conversationKey ? String(event.conversationKey) : '';
    if (!conversationKey) {
      if (!event.relationshipId && !event.conversationId) {
        if (mountedRef.current && openTicketRef.current === ticket) {
          setErrorMessage('聊天没有加载出来，请重试。');
        }
        return;
      }
      try {
        const rows = await client.recent();
        if (!mountedRef.current || openTicketRef.current !== ticket) {
          return;
        }
        const resolved = resolveDesktopConversation(Array.isArray(rows) ? rows : [], {
          relationshipId: event.relationshipId,
          conversationId: event.conversationId,
        });
        if (resolved?.avatar && resolved?.file) {
          conversationKey = normalizeConversationKey(resolved.avatar, resolved.file);
        }
      } catch {
        if (mountedRef.current && openTicketRef.current === ticket) {
          setErrorMessage('聊天没有加载出来，请重试。');
        }
        return;
      }
    }

    if (!mountedRef.current || openTicketRef.current !== ticket) {
      return;
    }

    if (!conversationKey) {
      setErrorMessage('聊天没有加载出来，请重试。');
      return;
    }

    await navigate({
      to: '/chat/$conversationKey',
      params: { conversationKey },
    });

    if (!mountedRef.current || openTicketRef.current !== ticket) {
      return;
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

      {errorMessage ? (
        <p className="vc-inbox-error" role="alert">
          {errorMessage}
        </p>
      ) : null}

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
                    data-action="open-conversation"
                    data-event-id={item.eventId}
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
