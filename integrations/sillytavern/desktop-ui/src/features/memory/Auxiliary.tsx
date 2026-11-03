import { useLayoutEffect, useRef, type ButtonHTMLAttributes } from 'react';
import { RadioGroup } from '@base-ui/react/radio-group';
import { Radio } from '@base-ui/react/radio';
import { Icon } from '../../components/Icon';
export type MemoryAction = (action: string, trigger: HTMLButtonElement) => void;
export function Action({
    action,
    run,
    children,
    ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { action: string; run: MemoryAction }) {
    return (
        <button type="button" {...props} data-action={action} onClick={(e) => run(action, e.currentTarget)}>
            {children}
        </button>
    );
}
// 复用现有 Lucide/ISC 静态路径；这几枚尚不在扩展 sprite 中。
export function Glyph({ name, size = 20, paths }: { name: string; size?: number; paths: Record<string, string> }) {
    return (
        <svg
            className="vc-icon"
            style={{ '--vc-icon-size': `${size}px` } as React.CSSProperties}
            width={size}
            height={size}
            viewBox="0 0 24 24"
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: paths[name] || '' }}
        />
    );
}
export interface DiaryEntry {
    day: string;
    body: string;
    vibe?: string;
    moments?: string[];
}
export interface DiaryState {
    month: string;
    selectedDay: string;
    entries: Record<string, DiaryEntry>;
    loading?: boolean;
    error?: string;
}
export interface DiaryProps {
    state: DiaryState;
    font?: string;
    sprite: string;
    action: MemoryAction;
    days: (month: string) => string[];
    monthLabel: (month: string) => string;
    title: (day: string) => string;
}
export function Diary(p: DiaryProps) {
    const strip = useRef<HTMLDivElement>(null),
        s = p.state,
        entry = s.entries[s.selectedDay];
    useLayoutEffect(() => {
        const el = strip.current,
            day = el?.querySelector<HTMLElement>('[aria-pressed="true"]');
        if (el && day) el.scrollLeft = day.offsetLeft - el.clientWidth / 2 + day.offsetWidth / 2;
    }, [s.month, s.selectedDay]);
    return (
        <div className="vc-diary">
            <div className="vc-diary-strip">
                <Action action="diary-month" run={p.action} className="vc-circle" data-delta="-1" aria-label="上个月">
                    <Icon sprite={p.sprite} name="chevron-left" size={18} />
                </Action>
                <div className="vc-diary-days" ref={strip} role="group" aria-label={p.monthLabel(s.month)}>
                    <span className="vc-diary-month">{p.monthLabel(s.month)}</span>
                    {p.days(s.month).map((day) => (
                        <Action
                            key={day}
                            action="diary-day"
                            run={p.action}
                            className="vc-diary-day"
                            data-day={day}
                            aria-pressed={day === s.selectedDay}
                            data-has={s.entries[day] ? 'true' : undefined}
                        >
                            <span>{Number(day.slice(8))}</span>
                        </Action>
                    ))}
                </div>
                <Action action="diary-month" run={p.action} className="vc-circle" data-delta="1" aria-label="下个月">
                    <Icon sprite={p.sprite} name="chevron-right" size={18} />
                </Action>
            </div>
            {s.error ? (
                <div className="vc-empty">
                    <p role="alert">{s.error}</p>
                    <Action action="diary-retry" run={p.action} className="vc-btn vc-btn-fill">
                        重试
                    </Action>
                </div>
            ) : s.loading && !entry ? (
                <div className="vc-diary-paper is-loading" aria-busy="true" />
            ) : !entry ? (
                <div className="vc-empty">
                    <Icon sprite={p.sprite} name="file-text" size={32} />
                    <p className="vc-memory-empty" role="status">
                        还没有日记
                    </p>
                </div>
            ) : (
                <article className={`vc-diary-paper${p.font === 'hand' ? ' is-hand' : ''}`} data-day={entry.day}>
                    <header>
                        <h2>{p.title(entry.day)}</h2>
                        {entry.vibe && <span className="vc-diary-vibe">{entry.vibe}</span>}
                        <Action
                            action="diary-font"
                            run={p.action}
                            className="vc-circle vc-diary-aa"
                            aria-haspopup="menu"
                            aria-label="Aa"
                        >
                            Aa
                        </Action>
                    </header>
                    <p className="vc-diary-body">{entry.body}</p>
                    {Boolean(entry.moments?.length) && (
                        <div className="vc-diary-moments">
                            <h3>今天的瞬间</h3>
                            <ul>
                                {entry.moments!.map((moment, i) => (
                                    <li key={i}>{moment}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                </article>
            )}
        </div>
    );
}
export interface Favorite {
    favoriteId: string;
    relationshipId: string;
    body: string;
    messageAt?: string;
    createdAt?: string;
}
export interface Reminder {
    reminderId: string;
    remindAt: string;
    text: string;
}
export interface FavoritesState {
    segment: string;
    favorites: Favorite[];
    reminders: Reminder[];
    nextCursor?: string;
    loading?: boolean;
    error?: string;
}
export interface FavoritesProps {
    state: FavoritesState;
    names: Record<string, string>;
    now: Date;
    sprite: string;
    action: MemoryAction;
    segment: (next: string) => void;
    monthDay: (at?: string) => string;
    when: (at: string, now: Date) => string;
}
function ReminderRow({ item, p }: { item: Reminder; p: FavoritesProps }) {
    return (
        <li className="vc-fav-reminder">
            <span className="vc-fav-bell">
                <Icon sprite={p.sprite} name="bell" size={18} />
            </span>
            <span className="vc-grow">
                <time dateTime={item.remindAt}>{p.when(item.remindAt, p.now)}</time>
                <span className="vc-fav-text">{item.text}</span>
            </span>
            <Action
                action="cancel-reminder"
                run={p.action}
                className="vc-circle"
                data-reminder-id={item.reminderId}
                aria-label="取消提醒"
            >
                <Icon sprite={p.sprite} name="x" size={16} />
            </Action>
        </li>
    );
}
export function Favorites(p: FavoritesProps) {
    const s = p.state;
    const segment = (
        <RadioGroup
            className="vc-fav-seg"
            aria-label="收藏与提醒"
            value={s.segment}
            onValueChange={(next) => {
                if (next === 'favorites' || next === 'reminders') p.segment(next);
            }}
        >
            {[
                ['favorites', '收藏'],
                ['reminders', '提醒'],
            ].map(([key, label]) => (
                <Radio.Root
                    key={key}
                    nativeButton
                    render={<button type="button" />}
                    value={key}
                    data-action="fav-segment"
                    data-segment={key}
                    aria-pressed={s.segment === key}
                >
                    {label}
                </Radio.Root>
            ))}
        </RadioGroup>
    );
    if (s.error)
        return (
            <div className="vc-fav">
                {segment}
                <div className="vc-empty">
                    <p role="alert">{s.error}</p>
                    <Action action="fav-retry" run={p.action} className="vc-btn vc-btn-fill">
                        重试
                    </Action>
                </div>
            </div>
        );
    if (s.segment === 'reminders')
        return (
            <div className="vc-fav" data-segment="reminders">
                {segment}
                {s.reminders.length ? (
                    <ul className="vc-fav-reminders">
                        {s.reminders.map((item) => (
                            <ReminderRow key={item.reminderId} item={item} p={p} />
                        ))}
                    </ul>
                ) : (
                    <div className="vc-empty">
                        <p className="vc-memory-empty" role="status">
                            还没有提醒
                        </p>
                    </div>
                )}
            </div>
        );
    return (
        <div className="vc-fav" data-segment="favorites">
            {segment}
            <div className="vc-fav-split">
                <div className="vc-fav-main">
                    {s.favorites.length ? (
                        <>
                            <ul className="vc-fav-wall">
                                {s.favorites.map((item) => (
                                    <li key={item.favoriteId} className="vc-fav-card">
                                        <p className="vc-fav-body">{item.body}</p>
                                        <p className="vc-fav-meta">{`${p.names[item.relationshipId] || ''}${p.names[item.relationshipId] ? ' · ' : ''}${p.monthDay(item.messageAt || item.createdAt)}`}</p>
                                        <Action
                                            action="open-favorite"
                                            run={p.action}
                                            className="vc-btn vc-btn-text"
                                            data-favorite-id={item.favoriteId}
                                        >
                                            回到对话
                                            <Icon sprite={p.sprite} name="chevron-right" size={16} />
                                        </Action>
                                        <Action
                                            action="remove-favorite"
                                            run={p.action}
                                            className="vc-circle vc-fav-remove"
                                            data-favorite-id={item.favoriteId}
                                            aria-label="取消收藏"
                                        >
                                            <Icon sprite={p.sprite} name="x" size={16} />
                                        </Action>
                                    </li>
                                ))}
                            </ul>
                            {s.nextCursor && (
                                <Action action="fav-more" run={p.action} className="vc-btn vc-btn-text">
                                    加载更多
                                </Action>
                            )}
                        </>
                    ) : (
                        <div className="vc-empty">
                            <p className="vc-memory-empty" role="status">
                                {s.loading ? '' : '还没有收藏'}
                            </p>
                        </div>
                    )}
                </div>
                {s.reminders.length > 0 && (
                    <aside className="vc-fav-aside" aria-label="即将提醒">
                        <h2>即将提醒</h2>
                        <ul className="vc-fav-reminders">
                            {s.reminders.slice(0, 6).map((item) => (
                                <ReminderRow key={item.reminderId} item={item} p={p} />
                            ))}
                        </ul>
                    </aside>
                )}
            </div>
        </div>
    );
}
