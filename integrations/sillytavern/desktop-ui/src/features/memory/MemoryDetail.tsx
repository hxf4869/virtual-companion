import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { Icon } from '../../components/Icon';
import { Action } from './Auxiliary';
import type { MemoryProps } from './types';
import { Statuses, Cleanup, Button, Skeleton } from './MemoryParts';
function EvidenceList({ p, classic = false }: { p: MemoryProps; classic?: boolean }) {
    const s = p.state;
    if (s.evidenceError) return <p role="alert">{s.evidenceError}</p>;
    if (s.detailLoading) return <p role={classic ? undefined : 'status'}>正在核对来源…</p>;
    if (!s.evidence?.length) return <p>暂无可展示的来源。</p>;
    return s.evidence.map((e, i) => (
        <article key={e.evidenceId || i} className={`${classic ? '' : 'vc-cell '}vc-memory-evidence`}>
            <strong>{e.chatDisplayName || '来源会话'}</strong>
            {classic && (
                <span className="vc-memory-source" data-state={e.status}>
                    {p.labels.source[e.status || ''] || '来源状态未知'}
                </span>
            )}
            <p className="vc-memory-secondary">{`消息 ${e.messageId ?? ''} · 修订 ${e.revision ?? ''} · ${p.format.stamp(e.sourceTimestamp, e.sourceTimezone)}${e.sourceTimezone ? ` · ${e.sourceTimezone}` : ''}`}</p>
            {e.excerpt ? <blockquote>{e.excerpt}</blockquote> : <p>原文片段不可用。</p>}
        </article>
    ));
}
function Facts({ p, classic = false }: { p: MemoryProps; classic?: boolean }) {
    const m = p.state.detail!,
        t = m.time || {},
        rel = p.state.relationships.find((r) => String(r.relationshipId) === String(m.relationshipId));
    return (
        <dl className={`${classic ? '' : 'vc-group '}vc-memory-facts`}>
            <div className={classic ? undefined : 'vc-cell'}>
                <dt>发生日期</dt>
                <dd>{`${t.eventDate || '未知'}${t.eventTime ? ` ${t.eventTime}` : ''}${t.eventTimezone ? ` · ${t.eventTimezone}` : ''}`}</dd>
            </div>
            <div className={classic ? undefined : 'vc-cell'}>
                <dt>记录时间</dt>
                <dd>{p.format.stamp(t.recordedAt)}</dd>
            </div>
            <div className={classic ? undefined : 'vc-cell'}>
                <dt>作用范围</dt>
                <dd>{`${rel?.companionName || '当前角色'} · ${p.format.mode(m.mode)} · 仅此角色实例`}</dd>
            </div>
            <div className={classic ? undefined : 'vc-cell'}>
                <dt>召回资格</dt>
                <dd>{m.recallEligible ? '具备资格，实际使用取决于会话与分支' : '当前不参与召回'}</dd>
            </div>
            {!classic && p.labels.type[m.type || ''] && (
                <div className="vc-cell">
                    <dt>类型</dt>
                    <dd>{p.labels.type[m.type!]}</dd>
                </div>
            )}
        </dl>
    );
}
function History({ p, classic = false }: { p: MemoryProps; classic?: boolean }) {
    const history = p.state.detail?.history;
    if (!history?.length) return <p>暂无更早的修订。</p>;
    return (
        <ol className="vc-memory-history">
            {history.map((h, i) => (
                <li key={h.version ?? i} className={classic ? undefined : 'vc-cell vc-memory-rev'}>
                    {classic ? (
                        <div className="vc-memory-meta">
                            <strong>{`修订 ${h.version ?? ''}`}</strong>
                            <span>{p.labels.lifecycle[h.lifecycle] || '状态未知'}</span>
                            <time>{p.format.stamp(h.time?.recordedAt)}</time>
                        </div>
                    ) : (
                        <>
                            <strong>{`修订 ${h.version ?? ''}`}</strong>
                            <span className="vc-meta">{`${p.labels.lifecycle[h.lifecycle] || '状态未知'} · ${p.format.stamp(h.time?.recordedAt)}`}</span>
                        </>
                    )}
                    <p>{h.summary}</p>
                </li>
            ))}
        </ol>
    );
}
function EditForm({ p, classic = false }: { p: MemoryProps; classic?: boolean }) {
    const s = p.state,
        m = s.detail!;
    if (!s.editing) return null;
    return (
        <form
            className={classic ? undefined : 'vc-group'}
            data-form="edit"
            onSubmit={(e) => {
                e.preventDefault();
                p.submit('edit', e.currentTarget);
            }}
        >
            {classic ? (
                <label htmlFor="vc-memory-draft">纠正记忆</label>
            ) : (
                <label className="vc-cell" htmlFor="vc-memory-draft">
                    <span className="vc-grow">纠正记忆</span>
                </label>
            )}
            <textarea
                id="vc-memory-draft"
                name="summary"
                rows={5}
                required
                disabled={s.busy}
                value={s.draft || ''}
                onChange={(e) => p.draft(e.currentTarget.value)}
            />
            <div className="vc-memory-actions">
                <Button p={p} action="cancel-edit" disabled={s.busy} classic={classic}>
                    取消编辑
                </Button>
                <button
                    className={classic ? 'vcms-btn vcms-btn-primary' : 'vc-btn vc-btn-fill'}
                    type="submit"
                    disabled={s.busy || s.conflict || s.detailLoading || m.lifecycle !== 'ACTIVE'}
                >
                    {s.busy ? '保存中…' : '保存修订'}
                </button>
            </div>
        </form>
    );
}
export function Reauth({ p, classic = false }: { p: MemoryProps; classic?: boolean }) {
    const ref = useRef<HTMLDialogElement>(null);
    useLayoutEffect(() => {
        if (classic) ref.current?.showModal();
        return () => {
            if (classic) ref.current?.close();
        };
    }, [classic]);
    const contents = (
        <>
            <h2 id="vc-memory-reauth-title">重新验证身份</h2>
            <form
                data-form="reauth"
                onSubmit={(e) => {
                    e.preventDefault();
                    p.submit('reauth', e.currentTarget);
                }}
            >
                <label>
                    当前密码
                    <input
                        type="password"
                        name="password"
                        autoComplete="current-password"
                        required
                        disabled={p.state.busy}
                    />
                </label>
                {p.state.detailError && <p role="alert">{p.state.detailError}</p>}
                <div className="vc-memory-actions">
                    <Button p={p} action="cancel-reauth" disabled={p.state.busy} classic={classic}>
                        取消
                    </Button>
                    <button
                        className={classic ? 'vcms-btn vcms-btn-primary' : 'vc-btn vc-btn-fill'}
                        type="submit"
                        disabled={p.state.busy}
                    >
                        验证并继续
                    </button>
                </div>
            </form>
        </>
    );
    return classic ? (
        <dialog
            ref={ref}
            className="vc-memory-confirm"
            data-reauth-dialog=""
            aria-labelledby="vc-memory-reauth-title"
            onCancel={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!p.state.busy)
                    p.action(
                        'cancel-reauth',
                        ref.current!.querySelector<HTMLButtonElement>('[data-action="cancel-reauth"]')!,
                    );
            }}
        >
            {contents}
        </dialog>
    ) : (
        <div className="vc-group" data-reauth-dialog="" role="dialog" aria-labelledby="vc-memory-reauth-title">
            {contents}
        </div>
    );
}
export function ForgetDialog({ p }: { p: MemoryProps }) {
    const ref = useRef<HTMLDialogElement>(null);
    useLayoutEffect(() => {
        const dialog = ref.current;
        if (!dialog) return;
        if (p.confirmForget && !dialog.open) dialog.showModal();
        else if (!p.confirmForget && dialog.open) dialog.close();
    }, [p.confirmForget]);
    return (
        <dialog
            ref={ref}
            className="vc-memory-confirm"
            data-forget-dialog=""
            aria-labelledby="vc-memory-forget-title"
            onCancel={(e) => {
                e.preventDefault();
                e.stopPropagation();
                p.action(
                    'cancel-forget',
                    ref.current!.querySelector<HTMLButtonElement>('[data-action="cancel-forget"]')!,
                );
            }}
        >
            <h2 id="vc-memory-forget-title">删除这条长期记忆？</h2>
            <p>{p.forgetNotice}</p>
            <p>将停止召回这条记忆并清理相关派生内容，不会自动删除聊天原文或全部备份。</p>
            <div className="vc-memory-actions">
                <Button p={p} action="cancel-forget" classic>
                    取消
                </Button>
                <Button p={p} action="forget" classic danger>
                    删除长期记忆
                </Button>
            </div>
        </dialog>
    );
}
export function MemoryDetailBody({ p, classic = false }: { p: MemoryProps; classic?: boolean }) {
    const s = p.state,
        m = s.detail;
    if (!m) {
        if (classic)
            return (
                <>
                    <p className="vc-memory-empty" role="status">
                        {s.detailLoading ? '正在加载记忆…' : s.detailError || '选择一条记忆，查看来源与修订。'}
                    </p>
                    {s.detailError && (
                        <Button p={p} action="refresh-detail" disabled={s.detailLoading} classic>
                            重试详情
                        </Button>
                    )}
                </>
            );
        if (s.detailLoading) return <Skeleton />;
        return (
            <div className="vc-empty">
                <Icon sprite={p.sprite} name={s.detailError ? 'wifi-off' : 'brain'} size={32} />
                <p className="vc-memory-empty" role={s.detailError ? 'alert' : 'status'}>
                    {s.detailError || '选择一条记忆，查看来源与修订。'}
                </p>
                {s.detailError && (
                    <Button p={p} action="refresh-detail" fill disabled={s.detailLoading}>
                        重试详情
                    </Button>
                )}
            </div>
        );
    }
    const notices = (
        <>
            {m.sourceStatus === 'PENDING_VERIFICATION' && (
                <p className="vc-memory-notice">来源待核验，暂不能作为已确认事实。</p>
            )}
            {m.sourceStatus === 'INVALID' && <p className="vc-memory-notice">来源已失效，不用于后续召回。</p>}
            <Cleanup item={m} />
        </>
    );
    const feedback = (
        <>
            {s.conflict && (
                <div className="vc-memory-notice" role="alert">
                    这条记忆已在另一处更新。你的输入已保留，请刷新详情后继续。
                </div>
            )}
            {s.detailError && <p role="alert">{s.detailError}</p>}
            {s.notice && <p role="status">{s.notice}</p>}
        </>
    );
    const actions = (
        <div className={classic ? 'vc-memory-actions' : 'vc-memory-actions vc-memory-detail-actions'}>
            {!s.editing && m.lifecycle === 'ACTIVE' && (
                <Button p={p} action="edit" fill disabled={s.busy || s.detailLoading} classic={classic}>
                    纠正
                </Button>
            )}
            {classic && (
                <Button p={p} action="refresh-detail" disabled={s.busy || s.detailLoading} classic>
                    刷新详情
                </Button>
            )}
            {!['FORGETTING', 'FORGOTTEN'].includes(m.lifecycle) && (
                <Button p={p} action="confirm-forget" danger disabled={s.busy || s.detailLoading} classic={classic}>
                    删除长期记忆
                </Button>
            )}
        </div>
    );
    return classic ? (
        <div className="vc-memory-detail-body">
            <div className="vc-memory-meta">
                <Statuses item={m} p={p} classic />
                <span>{`修订 ${m.version ?? ''}`}</span>
            </div>
            <p className="vc-memory-content">{m.summary}</p>
            <Facts p={p} classic />
            {notices}
            <section>
                <h3>来源</h3>
                <EvidenceList p={p} classic />
            </section>
            <section>
                <h3>修订历史</h3>
                <History p={p} classic />
            </section>
            {feedback}
            <EditForm p={p} classic />
            {actions}
        </div>
    ) : (
        <>
            <h1 className="vc-memory-title" tabIndex={-1}>
                {m.summary}
            </h1>
            <p className="vc-meta vc-memory-status">
                <Statuses item={m} p={p} />
                <span>{`修订 ${m.version ?? ''}`}</span>
            </p>
            <Facts p={p} />
            {notices}
            <h3 className="vc-group-title">来源</h3>
            <div className="vc-group">
                <EvidenceList p={p} />
            </div>
            <h3 className="vc-group-title">修订历史</h3>
            <div className="vc-group">
                <History p={p} />
            </div>
            {feedback}
            <EditForm p={p} />
            {!s.editing && actions}
            <p className="vc-footnote">将停止召回这条记忆并清理相关派生内容，不会自动删除聊天原文或全部备份。</p>
            {s.reauthAction && <Reauth key={s.reauthAction} p={p} />}
        </>
    );
}
export function MemoryDetail(p: MemoryProps) {
    return (
        <>
            <header className="vc-navbar is-solid">
                <Action
                    action="back"
                    run={p.action}
                    className="vc-circle"
                    aria-label="返回列表"
                    disabled={p.state.busy || p.state.editing}
                >
                    <Icon sprite={p.sprite} name="chevron-left" />
                </Action>
                <div className="vc-nav-title">记忆详情</div>
                <div className="vc-nav-spacer" />
                <Action
                    action="refresh-detail"
                    run={p.action}
                    className="vc-circle"
                    aria-label="刷新详情"
                    disabled={p.state.busy || p.state.detailLoading || p.state.editing}
                >
                    <Icon sprite={p.sprite} name="refresh-cw" />
                </Action>
            </header>
            <div className="vc-scroll">
                <div className="vc-column">
                    <MemoryDetailBody p={p} />
                </div>
            </div>
        </>
    );
}
export interface MemoryLayerProps extends MemoryProps {
    active: boolean;
    host: HTMLElement;
    container: HTMLElement;
    close: () => void;
    onPopup: (node: HTMLDivElement) => void;
    nested?: ReactNode;
}
export function MemoryLayer(p: MemoryLayerProps & { popupRef: RefObject<HTMLDivElement | null> }) {
    return (
        <Dialog.Root
            open
            modal={p.active && p.desktop ? 'trap-focus' : false}
            disablePointerDismissal={!p.active || !p.desktop}
            onOpenChange={(open, details) => {
                if (!open) {
                    details.cancel();
                    if (p.active && p.desktop) p.close();
                }
            }}
        >
            {p.active && p.desktop && (
                <Dialog.Portal container={p.host} style={{ display: 'contents' }}>
                    <Dialog.Backdrop forceRender className="vc-memory-editor-scrim" />
                </Dialog.Portal>
            )}
            <Dialog.Portal container={p.container} keepMounted style={{ display: 'contents' }}>
                <Dialog.Popup
                    ref={(node) => {
                        p.popupRef.current = node;
                        if (node) p.onPopup(node);
                    }}
                    style={{ display: 'contents' }}
                    aria-label="记忆详情"
                    initialFocus={false}
                    finalFocus={false}
                >
                    <MemoryDetail {...p} />
                </Dialog.Popup>
            </Dialog.Portal>
            {p.nested}
        </Dialog.Root>
    );
}
