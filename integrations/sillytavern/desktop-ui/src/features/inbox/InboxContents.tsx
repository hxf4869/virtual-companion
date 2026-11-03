import { useLayoutEffect, useRef } from 'react';
import { Action, Badge, PolicyField, FieldSwitch, Modes, VoiceSlot, SecretField, ChannelTarget } from './Parts';
import type { InboxProps, ChannelDraft, InboxEvent } from './types';
function Primary({
    p,
    action,
    primary = false,
    children,
    ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { p: InboxProps; action: string; primary?: boolean }) {
    return (
        <Action
            {...props}
            action={action}
            run={p.events.action}
            className={primary ? 'vc-inbox-primary' : ''}
            disabled={p.state.busy || props.disabled}
        >
            {children}
        </Action>
    );
}
export function InboxLayers({ p }: { p: InboxProps }) {
    const refs = useRef<Record<string, HTMLDivElement | null>>({}),
        previous = useRef('');
    const kind = p.state.reauth.open
        ? 'reauth'
        : p.state.cancelAsk
          ? 'cancel'
          : p.state.policyConflict
            ? 'conflict'
            : '';
    useLayoutEffect(() => {
        const prior = previous.current;
        previous.current = kind;
        if (kind && !p.state.busy)
            refs.current[kind]?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
        else if (!kind && prior) p.events.returnFocus()?.focus();
    }, [kind, p.state.busy]);
    return (
        <>
            {p.state.reauth.open && (
                <div
                    ref={(node) => {
                        refs.current.reauth = node;
                    }}
                    className="vc-inbox-layer"
                    role="dialog"
                    aria-label="重新验证身份"
                >
                    <p>需要重新验证身份。</p>
                    <label>
                        密码
                        <input
                            type="password"
                            data-field="reauth-password"
                            autoComplete="current-password"
                            spellCheck={false}
                            disabled={p.state.busy}
                        />
                    </label>
                    <div className="vc-inbox-actions">
                        <Primary p={p} action="reauth-submit" primary>
                            验证并继续
                        </Primary>
                        <Primary p={p} action="reauth-cancel">
                            取消
                        </Primary>
                    </div>
                </div>
            )}
            {!p.state.reauth.open && p.state.cancelAsk && (
                <div
                    ref={(node) => {
                        refs.current.cancel = node;
                    }}
                    className="vc-inbox-layer"
                    role="dialog"
                    aria-label="取消跟进"
                >
                    <p>取消这条跟进？</p>
                    <div className="vc-inbox-actions">
                        <Primary p={p} action="confirm-cancel" primary>
                            取消跟进
                        </Primary>
                        <Primary p={p} action="dismiss-cancel">
                            返回
                        </Primary>
                    </div>
                </div>
            )}
            {p.state.policyConflict && (
                <div
                    ref={(node) => {
                        refs.current.conflict = node;
                    }}
                    className="vc-inbox-layer"
                    role="dialog"
                    aria-label="保存冲突"
                >
                    <p data-tone="warn">这些设置已在另一处更新。你的输入已保留。</p>
                    <div className="vc-inbox-actions">
                        <Primary p={p} action="view-latest-policy">
                            查看最新
                        </Primary>
                        <Primary p={p} action="keep-policy-draft" primary>
                            保留草稿
                        </Primary>
                    </div>
                </div>
            )}
        </>
    );
}
function ChannelCard({ p, draft }: { p: InboxProps; draft: ChannelDraft }) {
    return (
        <article
            className="vc-inbox-channel"
            data-channel-card=""
            data-key={draft.key}
            data-channel={draft.channel}
            data-preview={draft.previewBody ? 'true' : 'false'}
        >
            <div className="vc-inbox-card-head">
                <h3>{draft.channel === 'FEISHU' ? '飞书' : '邮箱'}</h3>
                <Badge text={p.format.channel(draft)} tone={draft.exists && draft.enabled ? 'ok' : 'warn'} />
            </div>
            {draft.channel === 'FEISHU' && <p>群成员可见</p>}
            <label className="vc-inbox-wide">
                {draft.channel === 'FEISHU' ? '群名称' : '收件地址'}
                <ChannelTarget p={p} draft={draft} />
            </label>
            <label className="vc-inbox-wide vc-inbox-credential">
                <span className="vc-inbox-credential-label">
                    凭据{' '}
                    <Badge
                        text={p.format.credential(draft)}
                        tone={draft.credentialState === 'configured' ? 'ok' : 'warn'}
                    />
                </span>
                <SecretField p={p} draft={draft} />
            </label>
            <FieldSwitch
                p={p}
                action="toggle-channel"
                label="启用"
                extra={{ 'data-key': draft.key, 'data-field': 'channel-enabled' }}
                on={draft.enabled}
                classic
            />
            <FieldSwitch
                p={p}
                action="toggle-preview"
                label="正文预览"
                extra={{ 'data-key': draft.key, 'data-field': 'previewBody' }}
                on={draft.previewBody}
                classic
            />
            <div className="vc-inbox-actions">
                <Primary p={p} action="clear-credential" data-key={draft.key}>
                    清除凭据
                </Primary>
                {p.state.relationships.map((item) => (
                    <Primary
                        key={item.relationshipId}
                        p={p}
                        action="toggle-relationship"
                        data-key={draft.key}
                        data-relationship-id={item.relationshipId}
                        aria-pressed={draft.relationshipIds.includes(item.relationshipId)}
                    >
                        {item.name}
                    </Primary>
                ))}
            </div>
            <div className="vc-inbox-actions vc-inbox-savebar">
                <Primary p={p} action="save-channel" data-key={draft.key} primary>
                    保存渠道
                </Primary>
            </div>
        </article>
    );
}
function EventCard({ p, item }: { p: InboxProps; item: InboxEvent }) {
    const name = p.state.relationships.find((row) => row.relationshipId === item.relationshipId)?.name || '',
        deliveries = p.state.deliveries.filter((row) => row.eventId === item.eventId),
        open = item.linkStatus === 'present';
    return (
        <article
            className="vc-inbox-card"
            data-event-id={item.eventId}
            data-link={item.linkStatus}
            data-write={item.stDelivered ? 'written' : 'pending'}
        >
            <div className="vc-inbox-card-head">
                <h3>{name}</h3>
                <Badge text={p.format.write(item)} tone={open && item.stDelivered ? 'ok' : 'warn'} />
            </div>
            {item.voice ? (
                <VoiceSlot p={p} item={item} />
            ) : item.intent === 'WAITING_HOST' ? (
                <p>需要打开此会话继续</p>
            ) : item.body ? (
                <p>{item.body}</p>
            ) : null}
            <p className="vc-inbox-states">
                <Badge text={item.read ? '应用已读' : '应用未读'} tone={item.read ? 'ok' : ''} />
                {!open && item.stDelivered && <Badge text="已写入" tone="ok" />}
            </p>
            {deliveries.length > 0 && (
                <ul className="vc-inbox-states">
                    {deliveries.map((row) => {
                        const label = p.format.delivery(row);
                        return (
                            <li key={row.deliveryId} className="vc-inbox-delivery" data-status={label.status}>
                                <span>{row.channel === 'FEISHU' ? '飞书' : '邮箱'}</span>
                                <Badge text={label.text} tone={label.tone} />
                            </li>
                        );
                    })}
                </ul>
            )}
            {open && (
                <div className="vc-inbox-actions">
                    <Primary p={p} action="open-conversation" data-event-id={item.eventId} primary>
                        打开此会话
                    </Primary>
                </div>
            )}
        </article>
    );
}
export function InboxContents(p: InboxProps) {
    const s = p.state,
        draft = s.policyDraft;
    if (s.loading && !s.relationships.length && !s.inbox.length)
        return (
            <div className="vc-inbox-page">
                <p role="status">正在加载</p>
            </div>
        );
    const events = s.inbox.filter((item) => p.format.passes(item, s.inboxFilter));
    return (
        <div className="vc-inbox-page">
            <InboxLayers p={p} />
            <header className="vc-inbox-bar">
                <Action action="close" run={p.events.action} className="vc-inbox-close" disabled={s.busy}>
                    关闭
                </Action>
                <h1 tabIndex={-1}>主动陪伴</h1>
                <label className="vc-inbox-character">
                    角色
                    <select
                        data-field="character"
                        aria-label="角色"
                        value={s.relationshipId}
                        disabled={s.busy}
                        onChange={(e) => p.events.relationship(e.currentTarget.value)}
                    >
                        {s.relationships.map((item) => (
                            <option key={item.relationshipId} value={item.relationshipId}>
                                {item.name}
                            </option>
                        ))}
                    </select>
                </label>
            </header>
            {s.error && <p role="alert">{s.error}</p>}
            <div className="vc-inbox-grid">
                <section className="vc-inbox-section" aria-label="跟进">
                    <h2>跟进</h2>
                    <div className="vc-inbox-switches">
                        {!draft.supportsMode && (
                            <FieldSwitch
                                p={p}
                                action="toggle-enabled"
                                label="主动问候"
                                extra={{ 'data-field': 'enabled' }}
                                on={draft.enabled}
                                classic
                            />
                        )}
                        <FieldSwitch
                            p={p}
                            action="toggle-offline"
                            label="离线生成"
                            extra={{ 'data-field': 'offlineCapable' }}
                            on={draft.offlineCapable}
                            classic
                        />
                    </div>
                    <Modes p={p} classic />
                    {draft.enabled && !draft.offlineCapable && <p>需要打开此会话继续</p>}
                    <div className="vc-inbox-summary">
                        <article className="vc-inbox-summary-card">
                            <h3>静默时段</h3>
                            <div className="vc-inbox-range">
                                <PolicyField
                                    p={p}
                                    classic
                                    field="quietHoursStart"
                                    aria-label="开始"
                                    inputMode="numeric"
                                    maxLength={5}
                                />
                                <span className="vc-inbox-range-sep" aria-hidden="true">
                                    –
                                </span>
                                <PolicyField
                                    p={p}
                                    classic
                                    field="quietHoursEnd"
                                    aria-label="结束"
                                    inputMode="numeric"
                                    maxLength={5}
                                />
                            </div>
                        </article>
                        <article className="vc-inbox-summary-card">
                            <h3>时区</h3>
                            <PolicyField p={p} classic field="quietHoursTimezone" aria-label="时区" maxLength={64} />
                        </article>
                        <article className="vc-inbox-summary-card">
                            <h3>每日上限</h3>
                            <PolicyField p={p} classic field="dailyLimit" aria-label="每日上限" inputMode="numeric" />
                            <label>
                                间隔（分钟）
                                <PolicyField
                                    p={p}
                                    classic
                                    field="recentInteractionMinutes"
                                    aria-label="间隔（分钟）"
                                    inputMode="numeric"
                                />
                            </label>
                        </article>
                    </div>
                    <div className="vc-inbox-actions">
                        <Primary
                            p={p}
                            action="toggle-mode"
                            data-mode="COMPANION"
                            aria-pressed={draft.allowedModes.includes('COMPANION')}
                        >
                            日常
                        </Primary>
                        <Primary
                            p={p}
                            action="toggle-mode"
                            data-mode="STORY"
                            aria-pressed={draft.allowedModes.includes('STORY')}
                        >
                            剧情
                        </Primary>
                    </div>
                    {s.policyError && <p role="alert">{s.policyError}</p>}
                    {s.policyNotice && <p role="status">{s.policyNotice}</p>}
                    <div className="vc-inbox-savebar">
                        <Primary p={p} action="save-policy" disabled={s.policyConflict} primary>
                            保存
                        </Primary>
                    </div>
                    {s.followUps.length ? (
                        s.followUps.map((item) => (
                            <article
                                key={item.followUpId}
                                className="vc-inbox-card vc-inbox-follow"
                                data-follow-up-id={item.followUpId}
                                data-status={item.status}
                            >
                                <div className="vc-inbox-card-head">
                                    <h3>{item.body}</h3>
                                    <Badge
                                        text={p.labels.follow[item.status] || '状态未知'}
                                        tone={item.status === 'CANCELLED' ? '' : 'warn'}
                                    />
                                </div>
                                {p.format.when(item) && <p>{p.format.when(item)}</p>}
                                {item.status !== 'CANCELLED' && (
                                    <div className="vc-inbox-actions">
                                        <Primary p={p} action="ask-cancel" data-follow-up-id={item.followUpId}>
                                            取消跟进
                                        </Primary>
                                    </div>
                                )}
                            </article>
                        ))
                    ) : (
                        <p role="status">没有跟进</p>
                    )}
                </section>
                <section className="vc-inbox-section" aria-label="消息">
                    <h2>消息</h2>
                    <div className="vc-inbox-filters">
                        {p.filters.map(([value, label]) => (
                            <Primary
                                key={value}
                                p={p}
                                action="filter-inbox"
                                data-filter={value}
                                aria-pressed={s.inboxFilter === value}
                            >
                                {label}
                            </Primary>
                        ))}
                    </div>
                    {events.length ? (
                        events.map((item) => <EventCard key={item.eventId} p={p} item={item} />)
                    ) : (
                        <p role="status">没有消息</p>
                    )}
                </section>
                <section className="vc-inbox-section vc-inbox-span" aria-label="渠道">
                    <h2>渠道</h2>
                    {s.channelError && <p role="alert">{s.channelError}</p>}
                    <div className="vc-inbox-channel-row">
                        {s.channelDrafts.map((item) => (
                            <ChannelCard key={item.key} p={p} draft={item} />
                        ))}
                    </div>
                </section>
            </div>
        </div>
    );
}
