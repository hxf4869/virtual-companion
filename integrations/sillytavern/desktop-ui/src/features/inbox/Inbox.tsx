import { Fragment } from 'react';
import { Icon } from '../../components/Icon';
import { Segment } from '../../components/Segment';
import { Action, Clip, Status, PolicyField, FieldSwitch, Modes, VoiceSlot, SecretField, ChannelTarget } from './Parts';
import type { InboxProps, InboxEvent, Delivery } from './types';
export function MessageMeta({ p, item }: { p: InboxProps; item: InboxEvent }) {
    const write = p.format.write(item),
        warn = write === '链接失效' || write === '当前链接已移除';
    const bits = [
        <Status
            key="write"
            text={write}
            tone={warn ? 'warn' : 'quiet'}
            dot={warn ? 'warn' : write === '已写入' ? 'ok' : 'neutral'}
        />,
    ];
    if (write !== '已写入' && item.linkStatus !== 'present' && item.stDelivered)
        bits.push(<Status key="written" text="已写入" tone="quiet" dot="ok" />);
    bits.push(
        <Fragment key="read">
            <Status text={item.read ? '已读' : '未读'} tone="quiet" dot={item.read ? 'ok' : 'neutral'} />
            <Clip text={item.read ? '应用已读' : '应用未读'} />
        </Fragment>,
    );
    const deliveries = p.state.deliveries.filter((row) => row.eventId === item.eventId);
    return (
        <span className="vc-inbox-meta">
            {bits.map((bit, i) => (
                <span key={i} className="vc-inbox-meta-item">
                    {bit}
                </span>
            ))}
            {deliveries.map((row) => (
                <span key={row.deliveryId} className="vc-inbox-meta-item">
                    <DeliveryMeta p={p} row={row} />
                </span>
            ))}
        </span>
    );
}
function DeliveryMeta({ p, row }: { p: InboxProps; row: Delivery }) {
    const label = p.format.delivery(row),
        short =
            (
                {
                    accepted: '已接受',
                    pending: '待发送',
                    sending: '发送中',
                    failed: '失败',
                    unknown: '结果未知',
                    expired: '过期',
                    stopped: '已停止',
                } as Record<string, string>
            )[label.status] || label.text;
    const danger = label.status === 'failed',
        warn = label.status === 'unknown';
    return (
        <span className="vc-inbox-delivery" data-status={label.status}>
            <Status
                text={`${row.channel === 'FEISHU' ? '飞书' : '邮箱'} ${short}`}
                tone={danger ? 'danger' : warn ? 'warn' : 'quiet'}
                dot={danger ? 'danger' : warn ? 'warn' : label.status === 'accepted' ? 'ok' : 'neutral'}
            />
            {label.text !== short && <Clip text={label.text} />}
        </span>
    );
}
function Message({ p, item }: { p: InboxProps; item: InboxEvent }) {
    const name = p.state.relationships.find((row) => row.relationshipId === item.relationshipId)?.name || '未命名角色',
        open = item.linkStatus === 'present',
        body = item.intent === 'WAITING_HOST' ? '需要打开此会话继续' : item.body;
    const avatar = (
        <span className="vc-avatar" aria-hidden="true">
            {[...name][0] || '·'}
        </span>
    );
    if (item.voice)
        return (
            <div className="vc-cell vc-inbox-card vc-inbox-msg" data-event-id={item.eventId}>
                {avatar}
                <div className="vc-grow">
                    <b>{name}</b>
                    <VoiceSlot p={p} item={item} />
                    <MessageMeta p={p} item={item} />
                    {open && (
                        <Action
                            action="open-conversation"
                            run={p.events.action}
                            className="vc-btn vc-btn-text"
                            data-event-id={item.eventId}
                            disabled={p.state.busy}
                        >
                            打开此会话
                        </Action>
                    )}
                </div>
            </div>
        );
    const copy = (
        <>
            {avatar}
            <span className="vc-grow">
                <span className="vc-line">
                    <b>{name}</b>
                </span>
                {body && <span className="vc-inbox-body">{body}</span>}
                <MessageMeta p={p} item={item} />
                {open && <span className="vc-clip">打开此会话</span>}
            </span>
        </>
    );
    const attrs = {
        className: 'vc-cell vc-inbox-card vc-inbox-msg',
        'data-event-id': item.eventId,
        'data-link': item.linkStatus,
        'data-write': item.stDelivered ? 'written' : 'pending',
    };
    return open ? (
        <Action action="open-conversation" run={p.events.action} {...attrs} disabled={p.state.busy}>
            {copy}
        </Action>
    ) : (
        <div {...attrs}>{copy}</div>
    );
}
function FollowGroup({ p }: { p: InboxProps }) {
    const rows = p.state.followUps.map((item) => {
        const name = p.state.relationships.find((row) => row.relationshipId === item.relationshipId)?.name || '',
            meta = [name, p.format.trigger(item)].filter(Boolean).join(' · '),
            cancelled = item.status === 'CANCELLED';
        const contents = (
            <>
                <span className="vc-grow">
                    <span className="vc-inbox-body">{item.body}</span>
                    {meta && <span className="vc-meta">{meta}</span>}
                </span>
                <span className="vc-value">
                    <Status
                        text={p.labels.follow[item.status] || '状态未知'}
                        tone={item.status === 'WAITING_HOST' || item.status === 'NEEDS_CLARIFICATION' ? 'warn' : ''}
                    />
                </span>
            </>
        );
        return (
            <article
                key={item.followUpId}
                className="vc-cell vc-inbox-follow"
                data-follow-up-id={item.followUpId}
                data-status={item.status}
            >
                {cancelled ? (
                    <div className="vc-inbox-follow-main">{contents}</div>
                ) : (
                    <>
                        <Action
                            action="open-follow"
                            run={p.events.action}
                            className="vc-inbox-follow-main"
                            data-follow-up-id={item.followUpId}
                            aria-haspopup="menu"
                            disabled={p.state.busy}
                        >
                            {contents}
                        </Action>
                        <Action
                            action="ask-cancel"
                            run={p.events.action}
                            className="vc-clip"
                            data-follow-up-id={item.followUpId}
                            disabled={p.state.busy}
                        >
                            取消跟进
                        </Action>
                    </>
                )}
            </article>
        );
    });
    const heading = <h2 className="vc-group-title">跟进</h2>;
    return (
        <section aria-label="跟进">
            {!p.desktop && heading}
            <div className="vc-group">
                {p.desktop && heading}
                {rows.length ? (
                    rows
                ) : (
                    <div className="vc-cell" role="status">
                        没有跟进
                    </div>
                )}
            </div>
        </section>
    );
}
function Preferences({ p }: { p: InboxProps }) {
    const s = p.state,
        draft = s.policyDraft,
        channelHeading = <h2 className="vc-group-title">渠道</h2>;
    return (
        <div className="vc-inbox-preferences">
            {p.desktop && <FollowGroup p={p} />}
            <section aria-label="主动设置">
                <Modes p={p} />
                {!p.desktop && <h2 className="vc-group-title">静默时段</h2>}
                <div className={`vc-group${p.desktop ? ' vc-inbox-quiet' : ''}`}>
                    {p.desktop && <h2 className="vc-group-title">静默时段</h2>}
                    <label className="vc-cell">
                        <span className="vc-grow">开始</span>
                        <PolicyField
                            p={p}
                            field="quietHoursStart"
                            aria-label="开始"
                            placeholder="22:00"
                            inputMode="numeric"
                            maxLength={5}
                        />
                    </label>
                    <label className="vc-cell">
                        <span className="vc-grow">结束</span>
                        <PolicyField
                            p={p}
                            field="quietHoursEnd"
                            aria-label="结束"
                            placeholder="22:00"
                            inputMode="numeric"
                            maxLength={5}
                        />
                    </label>
                    <label className="vc-cell">
                        <span className="vc-grow">时区</span>
                        <PolicyField
                            p={p}
                            field="quietHoursTimezone"
                            aria-label="时区"
                            placeholder="中国标准时间"
                            maxLength={64}
                        />
                    </label>
                </div>
                <div className="vc-group vc-inbox-summary">
                    <label className="vc-cell">
                        <span className="vc-grow">每日上限</span>
                        <PolicyField p={p} field="dailyLimit" aria-label="每日上限" inputMode="numeric" />
                    </label>
                    <label className="vc-cell">
                        <span className="vc-grow">间隔（分钟）</span>
                        <PolicyField
                            p={p}
                            field="recentInteractionMinutes"
                            aria-label="间隔（分钟）"
                            inputMode="numeric"
                        />
                    </label>
                    {!draft.supportsMode && (
                        <FieldSwitch
                            p={p}
                            action="toggle-enabled"
                            label="主动问候"
                            extra={{ 'data-field': 'enabled' }}
                            on={draft.enabled}
                        />
                    )}
                    <FieldSwitch
                        p={p}
                        action="toggle-offline"
                        label="离线生成"
                        extra={{ 'data-field': 'offlineCapable' }}
                        on={draft.offlineCapable}
                    />
                    <FieldSwitch
                        p={p}
                        action="toggle-mode"
                        label="日常"
                        extra={{ 'data-mode': 'COMPANION' }}
                        on={draft.allowedModes.includes('COMPANION')}
                    />
                    <FieldSwitch
                        p={p}
                        action="toggle-mode"
                        label="剧情"
                        extra={{ 'data-mode': 'STORY' }}
                        on={draft.allowedModes.includes('STORY')}
                    />
                    {s.policyError && <p role="alert">{s.policyError}</p>}
                    {s.policyNotice && <p role="status">{s.policyNotice}</p>}
                </div>
                {draft.enabled && !draft.offlineCapable && (
                    <p className="vc-footnote" role="status">
                        需要打开此会话继续
                    </p>
                )}
            </section>
            <section aria-label="渠道">
                {(!p.desktop || s.channelError) && channelHeading}
                {s.channelError && <p role="alert">{s.channelError}</p>}
                <div className="vc-group vc-inbox-channel-row">
                    {p.desktop && !s.channelError && channelHeading}
                    {s.channelDrafts.map((item) => (
                        <Action
                            key={item.key}
                            action="open-channel"
                            run={p.events.action}
                            className="vc-cell vc-inbox-channel-link"
                            data-key={item.key}
                            data-channel={item.channel}
                            data-preview={item.previewBody ? 'true' : 'false'}
                            disabled={s.busy}
                        >
                            <span className={`vc-tile ${item.channel === 'FEISHU' ? 'vc-tile-teal' : 'vc-tile-blue'}`}>
                                <Icon sprite={p.sprite} name={item.channel === 'FEISHU' ? 'link' : 'bell'} size={18} />
                            </span>
                            <span className="vc-grow">
                                <span className="vc-inbox-name">{item.channel === 'FEISHU' ? '飞书' : '邮箱'}</span>
                                <span className="vc-meta">{p.format.channel(item)}</span>
                            </span>
                            <span className="vc-chevron">
                                <Icon sprite={p.sprite} name="chevron-right" size={16} />
                            </span>
                        </Action>
                    ))}
                </div>
            </section>
        </div>
    );
}
export function InboxList(p: InboxProps) {
    const s = p.state,
        loading = s.loading && !s.relationships.length && !s.inbox.length && !s.error,
        current = s.relationships.find((item) => item.relationshipId === s.relationshipId);
    const title = (
        <h1 className="vc-large-title" tabIndex={-1} data-vc-owned-title="">
            陪伴
        </h1>
    );
    const header = (
        <header className={`vc-navbar${p.desktop ? ' vc-inbox-heading' : ''}`}>
            {p.desktop && title}
            <div className="vc-nav-spacer" />
            {(p.dirty || p.desktop) && (
                <Action
                    action="save-policy"
                    run={p.events.action}
                    className={p.desktop ? 'vc-btn vc-btn-fill' : 'vc-nav-save'}
                    data-save-policy={p.desktop ? '' : undefined}
                    disabled={!s.relationshipId || s.policyConflict || s.busy || s.loading || !p.dirty}
                >
                    保存
                </Action>
            )}
        </header>
    );
    const events = s.inbox.filter((item) => p.format.passes(item, s.inboxFilter));
    let messages;
    if (s.error && !events.length && !s.inbox.length)
        messages = (
            <div className="vc-empty">
                <Icon sprite={p.sprite} name="wifi-off" size={32} />
                <p role="alert">{s.error}</p>
                <Action action="retry-open" run={p.events.action} className="vc-btn vc-btn-text">
                    重试
                </Action>
            </div>
        );
    else if (events.length)
        messages = (
            <div className="vc-group">
                {events.map((item) => (
                    <Message key={item.eventId} p={p} item={item} />
                ))}
            </div>
        );
    else
        messages = (
            <div className="vc-empty">
                <Icon sprite={p.sprite} name="heart" size={32} />
                <p role="status">没有消息</p>
                {s.inboxFilter !== 'all' && (
                    <Action
                        action="filter-inbox"
                        run={p.events.action}
                        className="vc-btn vc-btn-text"
                        data-filter="all"
                    >
                        全部
                    </Action>
                )}
            </div>
        );
    return (
        <>
            {!p.desktop && header}
            <div className={`vc-scroll${p.desktop ? ' vc-desktop-inbox' : ''}`}>
                <div className={loading ? 'vc-column' : 'vc-column vc-inbox-layout'}>
                    {p.desktop ? header : title}
                    {loading ? (
                        <>
                            <div className="vc-group" aria-hidden="true">
                                {[0, 1, 2].map((i) => (
                                    <div key={i} className="vc-skeleton-row">
                                        <span className="vc-skeleton vc-skeleton-avatar" />
                                        <span className="vc-grow">
                                            <span className="vc-skeleton vc-skeleton-line" />
                                            <span className="vc-skeleton vc-skeleton-line is-short" />
                                        </span>
                                    </div>
                                ))}
                            </div>
                            <p className="vc-clip" role="status">
                                正在加载
                            </p>
                        </>
                    ) : (
                        <>
                            {s.error && <p role="alert">{s.error}</p>}
                            {s.relationships.length > 0 && (
                                <div className="vc-group">
                                    <Action
                                        action="pick-character"
                                        run={p.events.action}
                                        className="vc-cell"
                                        aria-haspopup="menu"
                                        aria-label="角色"
                                        disabled={s.busy}
                                    >
                                        <span className="vc-grow">角色</span>
                                        <span className="vc-value vc-select-value">
                                            {current?.name || '未命名角色'}
                                            <Icon sprite={p.sprite} name="chevrons-up-down" size={16} />
                                        </span>
                                    </Action>
                                    <select
                                        className="vc-clip"
                                        data-field="character"
                                        aria-label="角色"
                                        tabIndex={-1}
                                        aria-hidden="true"
                                        value={s.relationshipId}
                                        onChange={(e) => p.events.relationship(e.currentTarget.value)}
                                    >
                                        {s.relationships.map((item) => (
                                            <option key={item.relationshipId} value={item.relationshipId}>
                                                {item.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}
                            <div className="vc-inbox-workspace">
                                <div className="vc-inbox-activity">
                                    <section aria-label="消息">
                                        <Segment
                                            label="消息筛选"
                                            preference="inbox-filter"
                                            data-vc-inbox-segment=""
                                            value={s.inboxFilter}
                                            options={p.filters.map(([value, label]) => ({ value, label }))}
                                            onValueChange={p.events.filter}
                                        />
                                        {messages}
                                    </section>
                                    {!p.desktop && <FollowGroup p={p} />}
                                </div>
                                <Preferences p={p} />
                            </div>
                        </>
                    )}
                </div>
            </div>
        </>
    );
}
export function InboxChannel({ p, channelKey }: { p: InboxProps; channelKey: string }) {
    const draft = p.state.channelDrafts.find((item) => item.key === channelKey);
    if (!draft) return null;
    const title = draft.channel === 'FEISHU' ? '飞书' : '邮箱';
    return (
        <>
            <header className="vc-navbar is-solid">
                <Action
                    action="pop-channel"
                    run={p.events.action}
                    className="vc-circle"
                    aria-label="返回"
                    disabled={p.state.busy}
                >
                    <Icon sprite={p.sprite} name="chevron-left" />
                </Action>
                <div className="vc-nav-title">{title}</div>
                <div className="vc-nav-spacer" />
            </header>
            <div className="vc-scroll">
                <div className="vc-column">
                    <article
                        className="vc-inbox-channel"
                        data-channel-card=""
                        data-key={draft.key}
                        data-channel={draft.channel}
                        data-preview={draft.previewBody ? 'true' : 'false'}
                    >
                        <div className="vc-group">
                            <label className="vc-cell vc-inbox-wide">
                                <span className="vc-grow">{draft.channel === 'FEISHU' ? '群名称' : '收件地址'}</span>
                                <ChannelTarget p={p} draft={draft} modern />
                            </label>
                            <label className="vc-cell vc-inbox-wide vc-inbox-credential">
                                <span className="vc-grow">
                                    <span>凭据</span>
                                    <Clip text={p.format.credential(draft)} />
                                </span>
                                <SecretField p={p} draft={draft} />
                            </label>
                            <FieldSwitch
                                p={p}
                                action="toggle-channel"
                                label="启用"
                                extra={{ 'data-key': draft.key, 'data-field': 'channel-enabled' }}
                                on={draft.enabled}
                            />
                            <FieldSwitch
                                p={p}
                                action="toggle-preview"
                                label="正文预览"
                                extra={{ 'data-key': draft.key, 'data-field': 'previewBody' }}
                                on={draft.previewBody}
                            />
                        </div>
                        {p.state.relationships.length > 0 && (
                            <>
                                <h2 className="vc-group-title">角色</h2>
                                <div className="vc-group">
                                    {p.state.relationships.map((item) => (
                                        <FieldSwitch
                                            key={item.relationshipId}
                                            p={p}
                                            action="toggle-relationship"
                                            label={p.format.instance(item, p.state.relationships)}
                                            extra={{
                                                'data-key': draft.key,
                                                'data-relationship-id': item.relationshipId,
                                            }}
                                            on={draft.relationshipIds.includes(item.relationshipId)}
                                        />
                                    ))}
                                </div>
                            </>
                        )}
                        <div className="vc-group">
                            <Action
                                action="clear-credential"
                                run={p.events.action}
                                className="vc-cell is-danger"
                                data-key={draft.key}
                                disabled={p.state.busy}
                            >
                                清除凭据
                            </Action>
                        </div>
                        <div className="vc-inbox-actions">
                            <Action
                                action="save-channel"
                                run={p.events.action}
                                className="vc-btn vc-btn-fill"
                                data-key={draft.key}
                                disabled={p.state.busy}
                            >
                                保存渠道
                            </Action>
                        </div>
                        {draft.channel === 'FEISHU' && <p className="vc-footnote">群成员可见</p>}
                        {p.state.channelError && <p role="alert">{p.state.channelError}</p>}
                    </article>
                </div>
            </div>
        </>
    );
}
