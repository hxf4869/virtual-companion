import type { MemoryProps } from './types';
import { idOf, Statuses, Button, Dates, Search } from './MemoryParts';
import { MemoryDetailBody, ForgetDialog, Reauth } from './MemoryDetail';
export function MemoryContents(p: MemoryProps) {
    const s = p.state,
        locked = s.busy || s.editing;
    return (
        <>
            <header className="vcms-header">
                <h1 className="vcms-title" tabIndex={-1}>
                    记忆
                </h1>
                <Button p={p} action="close" disabled={s.busy} classic>
                    返回聊天
                </Button>
            </header>
            <main className="vc-memory-layout" data-view={s.view}>
                <section className="vc-memory-list-pane" aria-label="记忆列表">
                    <form
                        className="vc-memory-filters"
                        data-form="filters"
                        onSubmit={(e) => {
                            e.preventDefault();
                            p.submit('filters', e.currentTarget);
                        }}
                    >
                        <label htmlFor="vc-memory-instance">角色实例</label>
                        <select
                            id="vc-memory-instance"
                            name="relationshipId"
                            disabled={locked || s.loading}
                            value={s.relationshipId}
                            onChange={(e) => p.filter('relationshipId', e.currentTarget.value)}
                        >
                            {s.relationships.map((r) => (
                                <option
                                    key={r.relationshipId}
                                    value={String(r.relationshipId)}
                                >{`${r.companionName || '未命名角色'} · 实例 ${r.relationshipId}`}</option>
                            ))}
                        </select>
                        <Search p={p} classic />
                        <div className="vc-memory-filter-row">
                            <select
                                name="status"
                                aria-label="记忆状态"
                                disabled={locked}
                                value={s.filterDraft?.status || ''}
                                onChange={(e) => p.filter('status', e.currentTarget.value)}
                            >
                                {p.statusOptions.map(([value, label]) => (
                                    <option key={value} value={value}>
                                        {label}
                                    </option>
                                ))}
                            </select>
                            <details>
                                <summary>发生日期</summary>
                                <Dates p={p} classic />
                            </details>
                        </div>
                    </form>
                    <div className="vc-memory-results" aria-busy={Boolean(s.loading)}>
                        {s.listError && (
                            <>
                                <p role="alert">{s.listError}</p>
                                <Button p={p} action="retry-list" classic>
                                    重试
                                </Button>
                            </>
                        )}
                        {!s.relationships.length && !s.loading && !s.listError ? (
                            <p className="vc-memory-empty">还没有角色实例，请先在聊天中绑定角色。</p>
                        ) : !s.items.length && !s.loading && !s.listError ? (
                            <p className="vc-memory-empty" role="status">
                                {p.emptyDialog}
                            </p>
                        ) : null}
                        <ul className="vc-memory-list">
                            {s.items.map((m) => (
                                <li key={idOf(m)}>
                                    <button
                                        type="button"
                                        className="vc-memory-row"
                                        data-memory-id={idOf(m)}
                                        aria-current={s.detail && idOf(s.detail) === idOf(m) ? 'true' : 'false'}
                                        disabled={locked}
                                        onClick={(e) => p.action('select', e.currentTarget)}
                                    >
                                        <span className="vc-memory-meta">
                                            <Statuses item={m} p={p} classic />
                                            {p.labels.type[m.type || ''] && <span>{p.labels.type[m.type!]}</span>}
                                        </span>
                                        <span className="vc-memory-content">{m.summary}</span>
                                        <span className="vc-memory-secondary">{`发生 ${m.time?.eventDate || '日期未知'} · 记录 ${p.format.stamp(m.time?.recordedAt)}`}</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                        {s.loading && <p role="status">正在加载记忆…</p>}
                        {s.nextCursor && (
                            <Button p={p} action="more" disabled={s.loading || locked} classic>
                                加载更多
                            </Button>
                        )}
                    </div>
                </section>
                <section className="vc-memory-detail" aria-label="记忆详情" aria-busy={Boolean(s.detailLoading)}>
                    <header className="vc-memory-detail-header">
                        <Button p={p} action="back" disabled={s.busy || s.editing} classic>
                            返回列表
                        </Button>
                        <h2 tabIndex={-1}>记忆详情</h2>
                    </header>
                    <MemoryDetailBody p={p} classic />
                </section>
            </main>
            <ForgetDialog p={p} />
            {s.reauthAction && <Reauth key={s.reauthAction} p={p} classic />}
        </>
    );
}
