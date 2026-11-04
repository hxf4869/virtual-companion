import { useDeliveries } from '../../data/queries/inbox';
import { EmptyState } from '../../design/components/EmptyState';
import { deliveryLabel } from '../../../../extension/vc-model-settings/inbox-logic.js';

export interface DeliveriesProps {
  relId?: string | null;
}

export function Deliveries({ relId }: DeliveriesProps) {
  const deliveriesQuery = useDeliveries(relId);
  const items = deliveriesQuery.data ?? [];

  return (
    <section className="vc-inbox-card vc-deliveries" aria-label="外部投递记录">
      <div className="vc-inbox-card__header">
        <h3 className="vc-inbox-card__title">投递状态</h3>
      </div>

      {items.length === 0 ? (
        <EmptyState icon="send" title="暂无外部投递记录" />
      ) : (
        <ul className="vc-deliveries__list">
          {items.map((row) => {
            const info = deliveryLabel(row);
            return (
              <li key={row.deliveryId} className="vc-deliveries__item">
                <div className="vc-deliveries__channel">
                  <strong>{row.channel === 'EMAIL' ? '邮箱' : row.channel === 'FEISHU' ? '飞书' : row.channel}</strong>
                  {row.configuredTarget ? (
                    <span className="vc-deliveries__target">{row.configuredTarget}</span>
                  ) : null}
                </div>
                <span className={`vc-inbox-badge vc-inbox-badge--${info.tone}`}>{info.text}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
