import { Button } from '@base-ui/react/button';
import { Icon } from '../../components/Icon';
export interface ConversationItem {
    id: string;
    name: string;
    instance: string;
    label: string;
    sameName: boolean;
    avatar: string;
    preview: string;
    time: string;
    timeMs?: number;
    unread: boolean;
    unreadCount: number;
    current: boolean;
    desktop: boolean;
}
export interface ConversationsProps {
    rows: ConversationItem[];
    status: string;
    sprite: string;
}
export function Conversations(p: ConversationsProps) {
    if (p.status === 'loading')
        return (
            <>
                {[0, 1, 2].map((n) => (
                    <div className="vc-skeleton-row" key={n}>
                        <span className="vc-skeleton vc-skeleton-avatar" />
                        <span className="vc-grow">
                            <span className="vc-skeleton vc-skeleton-line" />
                            <span className="vc-skeleton vc-skeleton-line is-short" />
                        </span>
                    </div>
                ))}
            </>
        );
    if (p.status === 'error' || !p.rows.length)
        return (
            <div className="vc-empty">
                <span data-empty-icon="">
                    <Icon sprite={p.sprite} name={p.status === 'error' ? 'circle-alert' : 'message-circle'} size={32} />
                </span>
                <p>{p.status === 'error' ? '会话没有加载出来' : '还没有会话'}</p>
                <Button
                    type="button"
                    className="vc-btn vc-btn-fill"
                    data-retry={p.status === 'error' ? '' : undefined}
                    data-goto={p.status === 'error' ? undefined : 'characters'}
                >
                    {p.status === 'error' ? '重试' : '去角色页'}
                </Button>
            </div>
        );
    return (
        <>
            {p.rows.map((row) => (
                <Button
                    key={row.id}
                    type="button"
                    className="vc-cell vc-convo"
                    data-relationship-id={row.id}
                    data-same-name={row.sameName ? '' : undefined}
                    aria-label={row.label}
                    aria-current={row.desktop ? (String(row.current) as 'true' | 'false') : undefined}
                    data-vc-light={row.desktop ? '' : undefined}
                >
                    <span className="vc-convo-avatar-slot">
                        {row.avatar ? (
                            <img className="vc-convo-avatar" alt="" src={row.avatar} data-fly-from="" />
                        ) : (
                            <span className="vc-convo-avatar" aria-hidden="true" data-fly-from="">
                                {[...row.name][0] || ''}
                            </span>
                        )}
                    </span>
                    <span className="vc-grow">
                        <span className="vc-convo-top">
                            <span className="vc-convo-name">{row.name}</span>
                            {row.instance && <span className="vc-convo-inst">{row.instance}</span>}
                            {row.time && (
                                <span className="vc-convo-time vc-num" data-time={row.timeMs}>
                                    {row.time}
                                </span>
                            )}
                        </span>
                        <span className="vc-convo-preview">{row.preview}</span>
                    </span>
                    {row.unread && (
                        <i
                            className="vc-convo-unread"
                            aria-hidden="true"
                            data-count={
                                row.unreadCount > 0 ? (row.unreadCount > 99 ? '99+' : row.unreadCount) : undefined
                            }
                        />
                    )}
                </Button>
            ))}
        </>
    );
}
