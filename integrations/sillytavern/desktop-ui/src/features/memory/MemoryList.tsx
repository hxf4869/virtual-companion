import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { Segment } from '../../components/Segment';
import { Switch } from '../../components/Switch';
import { Action, Diary, Favorites, Glyph } from './Auxiliary';
import type { MemoryProps, MemoryRecord } from './types';
import { idOf, ListStatus, Button, Instance, Dates, Search, Empty, Skeleton } from './MemoryParts';
function CollapsingItem({
    id,
    p,
    children,
    ...attributes
}: { id: string; p: MemoryProps; children: ReactNode } & React.LiHTMLAttributes<HTMLLIElement>) {
    const ref = useRef<HTMLLIElement>(null),
        collapse = p.collapse?.ids.has(id),
        animate = p.collapse?.animate,
        done = p.collapse?.done;
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el || !collapse || !animate || !done) return;
        let live = true;
        const motion = animate(
            el,
            [
                { height: `${el.offsetHeight}px`, opacity: 1 },
                { height: '0px', opacity: 0, paddingTop: '0px', paddingBottom: '0px' },
            ],
            { duration: 420 },
        );
        const finish = () => {
            if (live) done(id);
        };
        void motion.finished.then(finish, finish);
        return () => {
            live = false;
            motion.cancel();
        };
    }, [id, collapse, animate, done]);
    return (
        <li
            {...attributes}
            ref={ref}
            className={`${attributes.className || ''}${collapse ? ' is-collapsing' : ''}`.trim() || undefined}
            data-collapse-id={collapse ? id : undefined}
            style={collapse ? { overflow: 'hidden' } : undefined}
        >
            {children}
        </li>
    );
}
function MemoryRow({ item, p }: { item: MemoryRecord; p: MemoryProps }) {
    const s = p.state,
        id = idOf(item),
        locked = s.busy || s.editing,
        current = s.detail && idOf(s.detail) === id;
    const relation = s.relationships.find((r) => String(r.relationshipId) === String(item.relationshipId));
    return (
        <CollapsingItem id={id} p={p}>
            <button
                type="button"
                className="vc-cell vc-memory-row"
                data-memory-id={id}
                aria-current={current ? 'true' : 'false'}
                disabled={locked}
                onClick={(e) => p.action('select', e.currentTarget)}
            >
                <span className="vc-grow">
                    <span className="vc-memory-summary vc-memory-content">{item.summary}</span>
                    <span className="vc-meta">{`${relation?.companionName || '未命名角色'} · ${p.format.mode(item.mode)} · ${p.format.day(item.time?.eventDate)}`}</span>
                    <ListStatus item={item} p={p} />
                </span>
                <span className="vc-chevron">
                    <Icon sprite={p.sprite} name="chevron-right" size={16} />
                </span>
            </button>
        </CollapsingItem>
    );
}
function TimelineCard({ item, p }: { item: MemoryRecord; p: MemoryProps }) {
    const s = p.state,
        id = idOf(item),
        locked = s.busy || s.editing,
        pinned = Boolean(item.pinnedAt),
        source = p.ui.sources?.get(id),
        editing = p.ui.inlineId === id && s.editing;
    const sourceButton = (
        <Action action="open-source" run={p.action} className="vc-mem-source" data-mid={id} hidden={!source}>
            {source?.line || ''}
        </Action>
    );
    if (editing)
        return (
            <CollapsingItem
                id={id}
                p={p}
                className="vc-mem-card is-editing"
                data-mid={id}
                onKeyDown={(e) => {
                    if (e.key === 'Escape' && !e.defaultPrevented && !s.busy) {
                        e.preventDefault();
                        e.stopPropagation();
                        p.action(
                            'cancel-inline',
                            e.currentTarget.querySelector<HTMLButtonElement>('[data-action="cancel-inline"]')!,
                        );
                    }
                }}
            >
                <div className="vc-mem-edit">
                    <textarea
                        id="vc-memory-draft"
                        name="summary"
                        rows={2}
                        aria-label="编辑"
                        required
                        disabled={s.busy}
                        value={s.draft || ''}
                        onChange={(e) => p.draft(e.currentTarget.value)}
                    />
                    <div className="vc-mem-edit-actions">
                        <Action action="cancel-inline" run={p.action} className="vc-btn vc-btn-gray" disabled={s.busy}>
                            取消
                        </Action>
                        <Action action="save-inline" run={p.action} className="vc-btn vc-btn-fill" disabled={s.busy}>
                            保存
                        </Action>
                    </div>
                </div>
                {sourceButton}
            </CollapsingItem>
        );
    return (
        <CollapsingItem id={id} p={p} className="vc-mem-card" data-pinned={pinned ? 'true' : 'false'}>
            <button
                type="button"
                className="vc-cell vc-memory-row vc-mem-row"
                data-memory-id={id}
                aria-current={s.detail && idOf(s.detail) === id ? 'true' : 'false'}
                disabled={locked}
                onClick={(e) => p.action('select', e.currentTarget)}
            >
                <span className="vc-grow">
                    <span className="vc-memory-summary vc-memory-content">{item.summary}</span>
                    <ListStatus item={item} p={p} />
                </span>
            </button>
            {sourceButton}
            <div className="vc-mem-side">
                <div className="vc-mem-actions">
                    <Action
                        action="pin"
                        run={p.action}
                        className="vc-circle"
                        data-mid={id}
                        aria-pressed={pinned}
                        aria-label={pinned ? '取消钉住' : '钉住'}
                        disabled={locked || item.lifecycle !== 'ACTIVE'}
                    >
                        <Glyph paths={p.glyphs} name="pin" size={18} />
                    </Action>
                    {item.lifecycle === 'ACTIVE' && (
                        <Action
                            action="edit-inline"
                            run={p.action}
                            className="vc-circle"
                            data-mid={id}
                            aria-label="编辑"
                            disabled={locked}
                        >
                            <Icon sprite={p.sprite} name="pencil" size={18} />
                        </Action>
                    )}
                    {!['FORGETTING', 'FORGOTTEN'].includes(item.lifecycle) && (
                        <Action
                            action="forget-inline"
                            run={p.action}
                            className="vc-circle"
                            data-mid={id}
                            aria-label="忘记"
                            disabled={locked}
                        >
                            <Icon sprite={p.sprite} name="trash-2" size={18} />
                        </Action>
                    )}
                </div>
                <time className="vc-mem-time">{p.format.clock(p.format.moment(item))}</time>
                {pinned && (
                    <span className="vc-mem-pin" role="img" aria-label="已钉住">
                        <Glyph paths={p.glyphs} name="pin" size={16} />
                    </span>
                )}
            </div>
        </CollapsingItem>
    );
}
function Results({ p, items }: { p: MemoryProps; items: MemoryRecord[] }) {
    const s = p.state;
    if (s.listError)
        return (
            <div className="vc-empty">
                <Icon sprite={p.sprite} name="wifi-off" size={32} />
                <p role="alert">{s.listError}</p>
                <Button p={p} action="retry-list" fill>
                    重试
                </Button>
            </div>
        );
    if (s.loading && !items.length) return <Skeleton />;
    if (!s.relationships.length)
        return <Empty p={p} text="还没有角色实例，请先在聊天中绑定角色。" action="retry-list" label="重试" />;
    if (!items.length) {
        const filtered = Object.entries(s.filters || {}).some(
            ([key, value]) => (!p.desktop || key !== 'status') && String(value ?? '').trim() !== '',
        );
        return (
            <Empty
                p={p}
                text="没有找到记忆"
                action={filtered || !p.desktop ? 'clear-filters' : undefined}
                label="清除筛选"
            />
        );
    }
    return (
        <>
            {p.desktop ? (
                p.format.group(items, p.ui.now).map((group) => (
                    <section key={group.key} className="vc-mem-day" aria-label={group.label}>
                        <h2>{group.label}</h2>
                        <ul className="vc-memory-list">
                            {group.items.map((item) => (
                                <TimelineCard key={idOf(item)} item={item} p={p} />
                            ))}
                        </ul>
                    </section>
                ))
            ) : (
                <div className="vc-group">
                    <ul className="vc-memory-list">
                        {items.map((item) => (
                            <MemoryRow key={idOf(item)} item={item} p={p} />
                        ))}
                    </ul>
                </div>
            )}
            {s.loading && <p role="status">正在加载记忆…</p>}
            {s.nextCursor && (
                <Button p={p} action="more" disabled={s.loading || s.busy || s.editing}>
                    加载更多
                </Button>
            )}
        </>
    );
}
export function MemoryList(p: MemoryProps) {
    const s = p.state,
        locked = s.busy || s.editing,
        section = p.ui.section || 'timeline',
        memorySection = p.sections.some(([key]) => key === section);
    const items = section === 'pinned' ? s.items.filter((item) => item.pinnedAt) : s.items,
        loaded = !s.loading && !s.listError && s.relationships.length > 0;
    function navItem([key, label, mark]: readonly string[]) {
        return (
            <Action
                key={key}
                action="section"
                run={p.action}
                className="vc-mem-nav-item"
                data-section={key}
                aria-pressed={section === key}
                disabled={locked}
            >
                {key === 'diary' ? (
                    <Icon sprite={p.sprite} name="file-text" size={20} />
                ) : (
                    <Glyph paths={p.glyphs} name={mark} size={20} />
                )}
                <span className="vc-grow">{label}</span>
                {key === section && memorySection && loaded && (
                    <span className="vc-mem-count">{`${items.length}${s.nextCursor ? '+' : ''}`}</span>
                )}
            </Action>
        );
    }
    const results = (
        <div className="vc-memory-results" aria-busy={Boolean(s.loading)} aria-label="记忆列表">
            <Results p={p} items={items} />
        </div>
    );
    const content = p.desktop ? (
        <div className="vc-column" data-vc-section={section}>
            <h1 className="vc-large-title" tabIndex={-1} data-vc-owned-title="">
                记忆
            </h1>
            <div className="vc-memory-filters">
                <aside className="vc-memory-sidebar">
                    <Instance p={p} />
                    <nav className="vc-mem-nav" aria-label="记忆">
                        {p.sections.map(navItem)}
                        <hr />
                        {navItem(['diary', '日记', ''])}
                        <Action
                            action="section"
                            run={p.action}
                            className="vc-mem-nav-item"
                            data-section="favorites"
                            aria-pressed={section === 'favorites'}
                            disabled={locked}
                        >
                            <Glyph paths={p.glyphs} name="star" size={20} />
                            <span className="vc-grow">收藏</span>
                        </Action>
                    </nav>
                    <div className="vc-mem-incognito">
                        <span className="vc-grow">新对话不记</span>
                        <Switch
                            label="新对话不记"
                            data-vc-incognito=""
                            checked={Boolean(p.ui.incognito)}
                            onCheckedChange={p.incognito}
                        />
                    </div>
                </aside>
                <div className="vc-memory-main">
                    {section === 'diary' ? (
                        p.diary && <Diary {...p.diary} />
                    ) : section === 'favorites' ? (
                        p.favorites && <Favorites {...p.favorites} />
                    ) : (
                        <>
                            <form
                                className="vc-mem-search"
                                data-form="dfilters"
                                onSubmit={(e) => {
                                    e.preventDefault();
                                    p.submit('dfilters', e.currentTarget);
                                }}
                            >
                                <Search p={p} />
                                <details className="vc-mem-dates">
                                    <summary className="vc-circle" aria-label="发生日期">
                                        <Icon sprite={p.sprite} name="sliders-horizontal" size={18} />
                                    </summary>
                                    <Dates p={p} />
                                </details>
                            </form>
                            {results}
                        </>
                    )}
                </div>
            </div>
        </div>
    ) : (
        <div className="vc-column">
            <h1 className="vc-large-title" tabIndex={-1} data-vc-owned-title="">
                记忆
            </h1>
            <form
                className="vc-memory-filters"
                data-form="filters"
                onSubmit={(e) => {
                    e.preventDefault();
                    p.submit('filters', e.currentTarget);
                }}
            >
                <select
                    className="vc-clip"
                    name="relationshipId"
                    aria-label="角色实例"
                    tabIndex={-1}
                    aria-hidden="true"
                    disabled={locked || s.loading}
                    value={s.relationshipId}
                    onChange={(e) => p.filter('relationshipId', e.currentTarget.value)}
                >
                    {s.relationships.map((r) => (
                        <option key={r.relationshipId} value={String(r.relationshipId)}>
                            {p.format.relationship(r, s.relationships)}
                        </option>
                    ))}
                </select>
                <select
                    className="vc-clip"
                    name="status"
                    aria-label="记忆状态"
                    tabIndex={-1}
                    aria-hidden="true"
                    disabled={locked}
                    value={s.filterDraft?.status || ''}
                    onChange={(e) => p.status(e.currentTarget.value)}
                >
                    {p.statusOptions.map(([value, label]) => (
                        <option key={value} value={value}>
                            {label}
                        </option>
                    ))}
                </select>
                <Instance p={p} />
                <Search p={p} />
                <Segment
                    label="记忆状态"
                    preference="memory-status"
                    data-vc-memory-segment=""
                    disabled={locked}
                    value={
                        p.segments.some(([v]) => v === (s.filters?.status || ''))
                            ? s.filters?.status || ''
                            : p.segments[0][0]
                    }
                    options={p.segments.map(([value, label]) => ({ value, label }))}
                    onValueChange={p.status}
                />
                <div className="vc-group">
                    <details>
                        <summary className="vc-cell">
                            <span className="vc-grow">发生日期</span>
                            <span className="vc-value vc-select-value">
                                {p.format.dates(s.filterDraft)}
                                <Icon sprite={p.sprite} name="chevrons-up-down" size={16} />
                            </span>
                        </summary>
                        <Dates p={p} />
                    </details>
                </div>
            </form>
            {results}
        </div>
    );
    return <div className={`vc-scroll${p.desktop ? ' vc-desktop-memory' : ''}`}>{content}</div>;
}
