import type { ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { Action } from './Auxiliary';
import type { MemoryProps, MemoryRecord } from './types';
export const idOf = (m: MemoryRecord) => String(m.memoryId);
function Dot({ kind, state, tone, text }: { kind: string; state: string; tone: string; text: string }) {
    return (
        <span className={`vc-status vc-status-${tone} vc-memory-${kind}`} data-state={state}>
            <i className={`vc-dot vc-dot-${tone}`} aria-hidden="true" />
            {text}
        </span>
    );
}
export function Statuses({ item, p, classic = false }: { item: MemoryRecord; p: MemoryProps; classic?: boolean }) {
    const life = p.labels.lifecycle[item.lifecycle] || '状态未知',
        source = p.labels.source[item.sourceStatus] || '来源状态未知';
    return classic ? (
        <>
            <span className="vc-memory-state" data-state={item.lifecycle}>
                {life}
            </span>
            <span className="vc-memory-source" data-state={item.sourceStatus}>
                {source}
            </span>
        </>
    ) : (
        <>
            <Dot kind="state" state={item.lifecycle} tone={p.format.lifeTone(item.lifecycle)} text={life} />
            <Dot kind="source" state={item.sourceStatus} tone={p.format.sourceTone(item.sourceStatus)} text={source} />
        </>
    );
}
export function ListStatus({ item, p }: { item: MemoryRecord; p: MemoryProps }) {
    if (item.lifecycle === 'FORGETTING' || item.cleanup?.state === 'PENDING')
        return (
            <Dot
                kind="state"
                state={item.lifecycle || 'FORGETTING'}
                tone="danger"
                text={p.labels.lifecycle.FORGETTING}
            />
        );
    if (item.lifecycle === 'FORGOTTEN' || item.lifecycle === 'SUPERSEDED')
        return (
            <Dot
                kind="state"
                state={item.lifecycle}
                tone={item.lifecycle === 'SUPERSEDED' ? 'warn' : 'danger'}
                text={p.labels.lifecycle[item.lifecycle]}
            />
        );
    if (item.sourceStatus === 'INVALID' || item.sourceStatus === 'PENDING_VERIFICATION')
        return (
            <Dot
                kind="source"
                state={item.sourceStatus}
                tone={item.sourceStatus === 'INVALID' ? 'danger' : 'warn'}
                text={p.labels.source[item.sourceStatus]}
            />
        );
    return null;
}
export function Cleanup({ item }: { item: MemoryRecord }) {
    const c = item.cleanup;
    if (!c || c.state === 'NONE') return null;
    const texts: Record<string, string> = {
        PENDING: '清理中：已停止召回，正在清理派生记忆。',
        DONE: '本次记忆清理已完成。聊天原文和备份不在本次删除范围内。',
        PARTIAL: '清理部分完成：记忆已停止召回，仍有内容未清理。',
    };
    return (
        <div className="vc-memory-notice" role="status">
            {texts[c.state] || '清理状态未知，请刷新详情。'}
            {c.detail && <p>{c.detail}</p>}
        </div>
    );
}
export function Button({
    p,
    action,
    children,
    fill = false,
    danger = false,
    disabled = false,
    classic = false,
}: {
    p: MemoryProps;
    action: string;
    children: ReactNode;
    fill?: boolean;
    danger?: boolean;
    disabled?: boolean;
    classic?: boolean;
}) {
    return (
        <Action
            action={action}
            run={p.action}
            className={
                classic
                    ? `vcms-btn vcms-btn-${danger ? 'danger' : fill ? 'primary' : 'ghost'}`
                    : fill
                      ? 'vc-btn vc-btn-fill'
                      : `vc-btn vc-btn-text${danger ? ' is-danger' : ''}`
            }
            disabled={disabled}
        >
            {children}
        </Action>
    );
}
export function Instance({ p }: { p: MemoryProps }) {
    const s = p.state,
        current = s.relationships.find((r) => String(r.relationshipId) === String(s.relationshipId));
    if (!s.relationships.length) return null;
    return (
        <div className="vc-group">
            <Action
                action="pick-instance"
                run={p.action}
                className="vc-cell"
                id="vc-memory-instance"
                aria-haspopup="menu"
                disabled={s.busy || s.editing || s.loading}
            >
                <span className="vc-grow">实例</span>
                <span className="vc-value vc-select-value">
                    {current ? p.format.relationship(current, s.relationships) : '未命名角色'}
                    <Icon sprite={p.sprite} name="chevrons-up-down" size={16} />
                </span>
            </Action>
        </div>
    );
}
export function Dates({ p, classic = false }: { p: MemoryProps; classic?: boolean }) {
    const s = p.state;
    return (
        <div className="vc-memory-dates">
            <label>
                从
                <input
                    type="date"
                    name="eventDateFrom"
                    value={s.filterDraft?.eventDateFrom || ''}
                    disabled={s.busy || s.editing}
                    onChange={(e) => {
                        (
                            e.currentTarget.form?.elements.namedItem('eventDateTo') as HTMLInputElement | null
                        )?.setCustomValidity('');
                        p.filter('eventDateFrom', e.currentTarget.value);
                    }}
                />
            </label>
            <label>
                至
                <input
                    type="date"
                    name="eventDateTo"
                    value={s.filterDraft?.eventDateTo || ''}
                    disabled={s.busy || s.editing}
                    onChange={(e) => {
                        e.currentTarget.setCustomValidity('');
                        p.filter('eventDateTo', e.currentTarget.value);
                    }}
                />
            </label>
            <button
                className={classic ? 'vcms-btn vcms-btn-ghost' : 'vc-btn vc-btn-text'}
                type="submit"
                disabled={s.busy || s.editing}
            >
                应用日期
            </button>
        </div>
    );
}
export function Search({ p, classic = false }: { p: MemoryProps; classic?: boolean }) {
    const s = p.state;
    const input = (
        <input
            type="search"
            name="q"
            aria-label="搜索记忆"
            placeholder="搜索记忆"
            value={s.filterDraft?.q || ''}
            disabled={s.busy || s.editing}
            onChange={(e) => p.filter('q', e.currentTarget.value)}
        />
    );
    return classic ? (
        <div className="vc-memory-search">
            {input}
            <button className="vcms-btn vcms-btn-ghost" type="submit" disabled={s.busy || s.editing}>
                搜索
            </button>
        </div>
    ) : (
        <label className="vc-search">
            <span className="vc-clip">搜索记忆</span>
            <Icon sprite={p.sprite} name="search" size={18} />
            {input}
            <button className="vc-clip" type="submit" disabled={s.busy || s.editing}>
                搜索
            </button>
        </label>
    );
}
export function Empty({
    p,
    glyph = 'brain',
    text,
    action,
    label,
}: {
    p: MemoryProps;
    glyph?: string;
    text: string;
    action?: string;
    label?: string;
}) {
    return (
        <div className="vc-empty">
            <Icon sprite={p.sprite} name={glyph} size={32} />
            <p className="vc-memory-empty" role="status">
                {text}
            </p>
            {action && (
                <Button p={p} action={action} fill>
                    {label}
                </Button>
            )}
        </div>
    );
}
export function Skeleton() {
    return (
        <>
            <div className="vc-group" aria-hidden="true">
                {[0, 1, 2].map((i) => (
                    <div key={i} className="vc-skeleton-row">
                        <span className="vc-grow">
                            <span className="vc-skeleton vc-skeleton-line" />
                            <span className="vc-skeleton vc-skeleton-line is-short" />
                        </span>
                    </div>
                ))}
            </div>
            <p className="vc-clip" role="status">
                正在加载记忆…
            </p>
        </>
    );
}
