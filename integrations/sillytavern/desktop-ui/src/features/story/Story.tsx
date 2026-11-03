import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@base-ui/react/button';
import { Icon } from '../../components/Icon';

interface Person {
    id: string;
    name: string;
    initial: string;
    persona: string;
    selected: boolean;
}
interface Step {
    id: string;
    label: string;
    visible: boolean;
    className: string;
    group: string;
}
export interface StoryProps {
    legacy: boolean;
    desktop: boolean;
    gate: boolean;
    loading: boolean;
    mode: string;
    stage: string;
    title: string;
    caseTitle: string;
    busy: boolean;
    playing: boolean;
    ended: boolean;
    version: number;
    percent: number;
    config: string;
    error: string;
    reason: string;
    notice: string;
    sync: string;
    epilogue: string;
    people: Person[];
    cover: Person[];
    setting: string;
    known: string;
    locations: string[];
    knowledge: string[];
    lines: { id: string; text: string; say: boolean; fresh: boolean }[];
    cards: { name: string; detail: string; glyph: string; fresh: boolean; flipped: boolean }[];
    steps: Step[];
    versions: number[];
    selected: string;
    companions: { actor: string; relationship: string; label: string }[] | null;
    draftSay: string;
    draftSummary: string;
    sprite: string;
    rewind: { version: number; title: string; message: string; recalc: string; devices: string } | null;
    rewindHost?: HTMLElement;
    motion: { reduced: boolean; duration: number; easing: string };
    reveal(name: string): void;
    field(name: string, value: string): void;
    cancelRewind(): void;
}
const groups = [
    { id: 'lin', title: '林岚' },
    { id: 'su', title: '苏禾' },
    { id: 'zhou', title: '周澈' },
    { id: 'place', title: '地点' },
];
const list = (items: string[]) => items.map((item, index) => <li key={index}>{item}</li>);
function Config({ p }: { p: StoryProps }) {
    return p.config ? (
        <div className={`vc-story-config${p.legacy ? '' : ' vc-note vc-glass'}`} data-config="missing" role="status">
            <p>{p.config}</p>
            <Button type="button" className="vcms-btn" data-action="configure">
                打开模型设置
            </Button>
        </div>
    ) : null;
}
function Companions({ p }: { p: StoryProps }) {
    const className = p.legacy ? 'vcms-btn' : 'vc-cell';
    return p.companions ? (
        p.companions.map((row) => (
            <Button
                key={`${row.relationship}:${row.actor}`}
                type="button"
                className={className}
                data-action="map-companion"
                data-actor={row.actor}
                data-relationship={row.relationship}
            >
                {row.label}
            </Button>
        ))
    ) : (
        <Button type="button" className={className} data-action="show-companions">
            选择陪伴入局
        </Button>
    );
}
function Ending({ p }: { p: StoryProps }) {
    if (!p.ended) return null;
    const buttons = (
        <>
            <Button type="button" className={p.legacy ? 'vcms-btn' : 'vc-btn vc-btn-fill'} data-action="save-epilogue">
                保存共同游玩摘要
            </Button>
            <Button
                type="button"
                className={p.legacy ? 'vcms-btn' : 'vc-btn vc-btn-text is-danger'}
                data-action="discard-epilogue"
            >
                放弃共同游玩摘要
            </Button>
        </>
    );
    return (
        <section className={`${p.legacy ? '' : 'vc-group '}vc-story-ending`}>
            <h2>结局</h2>
            {p.epilogue && <p>{p.epilogue}</p>}
            <textarea
                data-field="summary"
                maxLength={2000}
                aria-label="共同游玩摘要"
                value={p.draftSummary}
                onChange={(e) => p.field('summary', e.target.value)}
            />
            {p.legacy ? buttons : <div className="vc-ending-actions">{buttons}</div>}
        </section>
    );
}
function Evidence({ card, p }: { card: StoryProps['cards'][number]; p: StoryProps }) {
    const ref = useRef<HTMLElement>(null);
    const [flipped, setFlipped] = useState(card.flipped);
    useLayoutEffect(() => {
        if (!card.fresh || flipped || !ref.current) return;
        const done = () => {
            setFlipped(true);
            p.reveal(card.name);
        };
        if (p.motion.reduced) {
            done();
            return;
        }
        const animation = ref.current.animate([{ transform: 'rotateY(180deg)' }, { transform: 'rotateY(0deg)' }], {
            duration: p.motion.duration,
            easing: p.motion.easing,
        });
        animation.finished.then(done, () => {});
        return () => animation.cancel();
    }, [card.fresh, card.name, flipped, p.motion.reduced, p.motion.duration, p.motion.easing, p.reveal]);
    return (
        <article
            ref={ref}
            className={`vc-evi${card.fresh && !flipped ? ' is-back' : ''}`}
            data-evidence={card.fresh ? 'show' : undefined}
        >
            <div className="vc-evi-face">
                <Icon sprite={p.sprite} name={card.glyph} size={18} />
                <b>{card.name}</b>
                {card.detail && <span>{card.detail}</span>}
            </div>
            <div className="vc-evi-back">
                <Icon sprite={p.sprite} name="sparkles" size={22} />
            </div>
            {card.fresh && flipped && <span className="vc-evi-new">+1</span>}
        </article>
    );
}
function Rewind({ p }: { p: StoryProps }) {
    const ref = useRef<HTMLDialogElement>(null),
        title = useRef<HTMLHeadingElement>(null);
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        el.showModal();
        title.current?.focus();
        return () => {
            if (el.open) el.close();
        };
    }, []);
    if (!p.rewind || !p.rewindHost) return null;
    return createPortal(
        <dialog
            ref={ref}
            className="vc-story-rewind-dialog"
            aria-labelledby="vc-story-rewind-title"
            onCancel={(e) => {
                e.preventDefault();
                e.stopPropagation();
                p.cancelRewind();
            }}
        >
            <h2 ref={title} id="vc-story-rewind-title" tabIndex={-1}>
                {p.rewind.title}
            </h2>
            <p>{p.rewind.message}</p>
            <p>{p.rewind.recalc}</p>
            <p>{p.rewind.devices}</p>
            <div className="vc-story-rewind-actions">
                <Button type="button" className="vcms-btn" data-action="cancel-rewind">
                    取消
                </Button>
                <Button type="button" className="vcms-btn" data-action="confirm-rewind">
                    确认回档
                </Button>
            </div>
        </dialog>,
        p.rewindHost,
    );
}
export function Story(p: StoryProps) {
    const glyph = (name: string, size = 22) => <Icon sprite={p.sprite} name={name} size={size} />;
    const attr = {
        className: 'vc-story',
        'data-state': p.loading ? 'unstarted' : p.mode,
        'data-world-version': p.playing && !p.loading ? p.version : undefined,
    };
    const input = (
        <input
            data-field="say"
            maxLength={4000}
            aria-label="对所选角色说"
            placeholder={p.selected ? `对${p.selected}说` : '先选择一位角色'}
            disabled={p.busy}
            value={p.draftSay}
            onChange={(e) => p.field('say', e.target.value)}
        />
    );
    if (p.legacy)
        return (
            <div className="vc-story-page">
                <div {...attr}>
                    <header className="vc-story-bar">
                        <h1 tabIndex={-1}>{p.playing ? p.title : '雨夜旅馆'}</h1>
                        {p.playing && p.stage && (
                            <p className="vc-story-stage">
                                <span className="vc-story-badge">{p.stage}</span>
                            </p>
                        )}
                        <Button
                            type="button"
                            className={`vcms-btn vcms-btn-ghost${p.playing ? ' vc-story-close' : ''}`}
                            data-action="close"
                        >
                            关闭
                        </Button>
                    </header>
                    <Config p={p} />
                    {!p.playing ? (
                        <section className="vc-story-gate">
                            <h2>{p.caseTitle}</h2>
                            {p.error && <p role="alert">{p.error}</p>}
                            <Button
                                type="button"
                                className="vcms-btn vcms-btn-primary"
                                data-action="start"
                                disabled={p.busy}
                            >
                                开局
                            </Button>
                        </section>
                    ) : (
                        <>
                            {p.mode === 'generating' && (
                                <p className="vc-story-generating" role="status">
                                    正在生成这一步
                                </p>
                            )}
                            {p.sync && <p className="vc-story-sync">{p.sync}</p>}
                            {p.reason && <p role="alert">{p.reason}</p>}
                            {p.notice && (
                                <p className="vc-story-evidence" data-evidence="show">
                                    {p.notice}
                                </p>
                            )}
                            <section className="vc-story-panel" aria-label="公开设定">
                                <h2>公开设定</h2>
                                <p className="vc-story-setting">{p.setting}</p>
                            </section>
                            <section className="vc-story-cast">
                                {p.people.map((person) => (
                                    <Button
                                        key={person.id}
                                        type="button"
                                        className="vc-story-person"
                                        data-action="select-actor"
                                        data-actor={person.id}
                                        aria-pressed={person.selected}
                                    >
                                        <span className="vc-story-person-mark" aria-hidden="true">
                                            {person.initial}
                                        </span>
                                        <span className="vc-story-person-copy">
                                            <h3>{person.name}</h3>
                                            {person.selected && <span className="vc-story-badge">当前</span>}
                                            {person.persona && <p>{person.persona}</p>}
                                        </span>
                                    </Button>
                                ))}
                            </section>
                            <section className="vc-story-panel" aria-label="地点">
                                <h2>地点</h2>
                                <ul className="vc-story-places">{list(p.locations)}</ul>
                            </section>
                            <section className="vc-story-panel" aria-label="线索">
                                <h2>线索</h2>
                                <ul className="vc-story-clues">{list(p.knowledge)}</ul>
                            </section>
                            <section className="vc-story-panel" aria-label="公开时间线">
                                <h2>公开时间线</h2>
                                {p.known && <p className="vc-story-known">{p.known}</p>}
                                <ul className="vc-story-events">{list(p.lines.map((line) => line.text))}</ul>
                            </section>
                            {!p.ended && (
                                <section className="vc-story-actions">
                                    {groups.map((group) => (
                                        <div key={group.id} className="vc-story-action-group" data-group={group.id}>
                                            <h3>{group.title}</h3>
                                            {p.steps
                                                .filter((step) => step.group === group.id)
                                                .map((step) => (
                                                    <Button
                                                        key={step.id}
                                                        type="button"
                                                        className={step.className}
                                                        data-action="act"
                                                        data-step={step.id}
                                                        disabled={p.busy}
                                                    >
                                                        {step.label}
                                                    </Button>
                                                ))}
                                        </div>
                                    ))}
                                    <div className="vc-story-say">
                                        <label className="vc-story-say-row">
                                            {input}
                                            <Button
                                                type="button"
                                                className="vcms-btn vcms-btn-primary"
                                                data-action="say"
                                                disabled={p.busy}
                                            >
                                                对所选角色说
                                            </Button>
                                        </label>
                                    </div>
                                </section>
                            )}
                            {p.versions.length > 0 && (
                                <section className="vc-story-rewind">
                                    {p.versions.map((version) => (
                                        <Button
                                            key={version}
                                            type="button"
                                            className="vcms-btn"
                                            data-action="ask-rewind"
                                            data-version={version}
                                            disabled={p.busy}
                                        >
                                            回到版本 {version}
                                        </Button>
                                    ))}
                                </section>
                            )}
                            <section className="vc-story-companions">
                                <Companions p={p} />
                            </section>
                            <Ending p={p} />
                        </>
                    )}
                </div>
                {p.rewind && <Rewind key={p.rewind.version} p={p} />}
            </div>
        );
    const start = (
        <Button
            type="button"
            className="vc-btn vc-btn-fill"
            data-action={p.playing ? 'enter' : 'start'}
            disabled={p.busy}
        >
            {glyph('play', 18)}
            {p.playing ? '继续' : '开局'}
        </Button>
    );
    if (p.gate || p.loading)
        return (
            <>
                <header className="vc-navbar">
                    <div
                        className="vc-nav-title"
                        role={p.desktop ? 'heading' : undefined}
                        aria-level={p.desktop ? 1 : undefined}
                        tabIndex={p.desktop ? -1 : undefined}
                    >
                        剧情
                    </div>
                    <div className="vc-nav-spacer" />
                    {p.desktop && !p.playing && !p.loading && start}
                </header>
                <div className="vc-scroll">
                    {!p.desktop && (
                        <h1 className="vc-large-title" tabIndex={-1}>
                            剧情
                        </h1>
                    )}
                    <div {...attr}>
                        <Config p={p} />
                        {p.error && (
                            <p className="vc-note vc-glass" role="alert">
                                {p.error}
                            </p>
                        )}
                        {p.loading && (
                            <div className="vc-skeleton-row" aria-busy="true">
                                <span className="vc-skeleton vc-skeleton-avatar" />
                                <span className="vc-grow">
                                    <span className="vc-skeleton vc-skeleton-line" />
                                    <span className="vc-skeleton vc-skeleton-line is-short" />
                                </span>
                            </div>
                        )}
                        <article className="vc-case">
                            <div className="vc-case-cover">
                                <div className="vc-case-fog" />
                                {p.cover.map((person) => (
                                    <span key={person.id} className="vc-case-face" aria-label={person.name}>
                                        {person.initial}
                                    </span>
                                ))}
                            </div>
                            <div className="vc-case-info">
                                <h3>{p.caseTitle}</h3>
                                {p.stage && <span className="vc-meta">{p.stage}</span>}
                                <div className="vc-case-bar" aria-hidden="true">
                                    <i style={{ width: `${p.percent}%` }} />
                                </div>
                                {!p.loading && (!p.desktop || p.playing) && start}
                            </div>
                        </article>
                    </div>
                </div>
            </>
        );
    return (
        <>
            <header className="vc-navbar" style={{ '--vc-nav-p': 1 } as CSSProperties}>
                <Button type="button" className="vc-circle vc-glass" data-action="close" aria-label="离开剧情">
                    {glyph('x')}
                </Button>
                <h1 className="vc-nav-title" tabIndex={-1}>
                    {p.title}
                    {p.stage && <span className="vc-meta">{p.stage}</span>}
                </h1>
                <div className="vc-nav-spacer" />
                <Button
                    type="button"
                    className="vc-circle vc-glass"
                    data-action={p.versions.length ? 'ask-rewind' : undefined}
                    data-version={p.versions[0]}
                    aria-label="回档"
                    disabled={p.busy || !p.versions.length}
                >
                    {glyph('history')}
                </Button>
            </header>
            <div className="vc-scroll">
                <div {...attr}>
                    <p className="vc-sr">{p.caseTitle}</p>
                    <Config p={p} />
                    <div className="vc-story-notes">
                        {p.mode === 'generating' && (
                            <p className="vc-note vc-glass vc-story-generating" role="status">
                                <span className="vc-thinking" aria-hidden="true">
                                    <i />
                                    <i />
                                    <i />
                                </span>
                                正在生成这一步
                            </p>
                        )}
                        {p.sync && (
                            <p className="vc-note vc-glass vc-story-sync" role="status">
                                {p.sync}
                            </p>
                        )}
                        {p.reason && (
                            <p className="vc-note vc-glass" role="alert">
                                {p.reason}
                            </p>
                        )}
                    </div>
                    <div className={`vc-npcs${p.people.some((person) => person.selected) ? ' is-focus' : ''}`}>
                        {p.people
                            .filter((person) => person.id !== 'player')
                            .map((person) => (
                                <Button
                                    key={person.id}
                                    type="button"
                                    className={`vc-npc vc-story-person${person.selected ? ' is-on' : ''}`}
                                    data-action="select-actor"
                                    data-actor={person.id}
                                    aria-pressed={person.selected}
                                    aria-label={[person.name, person.persona].filter(Boolean).join('，')}
                                >
                                    <span className="vc-npc-avatar" aria-hidden="true">
                                        {person.initial}
                                    </span>
                                    <span className="vc-npc-name">{person.name}</span>
                                </Button>
                            ))}
                    </div>
                    <div className="vc-narr">
                        <section aria-label="公开设定">
                            {p.setting && <p className="vc-dim vc-story-setting">{p.setting}</p>}
                            {p.known && <p className="vc-story-known">{p.known}</p>}
                        </section>
                        <section aria-label="地点">
                            <ul className="vc-story-places">{list(p.locations)}</ul>
                        </section>
                        <section aria-label="公开时间线">
                            <ul className="vc-story-events">
                                {p.lines.map((line) => (
                                    <li
                                        key={line.id}
                                        className={`${line.say ? 'vc-say' : ''}${line.fresh ? ' vc-stream' : ''}`}
                                    >
                                        {line.text}
                                    </li>
                                ))}
                            </ul>
                        </section>
                    </div>
                    <section aria-label="线索">
                        {p.cards.length > 0 && (
                            <>
                                <div className="vc-meta vc-evi-label">证物</div>
                                <div className="vc-evis">
                                    {p.cards.map((card) => (
                                        <Evidence key={card.name} card={card} p={p} />
                                    ))}
                                </div>
                            </>
                        )}
                    </section>
                    <Ending p={p} />
                    {p.versions.length > 0 && (
                        <section className="vc-group" aria-label="回档">
                            {p.versions.map((version) => (
                                <Button
                                    key={version}
                                    type="button"
                                    className="vc-cell"
                                    data-action="ask-rewind"
                                    data-version={version}
                                    disabled={p.busy}
                                >
                                    回到版本 {version}
                                </Button>
                            ))}
                        </section>
                    )}
                    <section className="vc-group" aria-label="陪伴">
                        <Companions p={p} />
                    </section>
                </div>
            </div>
            {!p.ended && (
                <div className="vc-dock vc-glass">
                    <div className="vc-acts">
                        {p.steps.map((step) => (
                            <Button
                                key={step.id}
                                type="button"
                                className={step.className}
                                data-action="act"
                                data-step={step.id}
                                hidden={!step.visible}
                                disabled={p.busy}
                            >
                                {step.label}
                            </Button>
                        ))}
                    </div>
                    <div className="vc-story-say">
                        <label className="vc-story-say-row vc-field vc-composer-field vc-glass">
                            <textarea
                                data-field="say"
                                maxLength={4000}
                                rows={1}
                                aria-label="对所选角色说"
                                placeholder={p.selected ? `对${p.selected}说` : '先选择一位角色'}
                                disabled={p.busy}
                                value={p.draftSay}
                                onChange={(e) => p.field('say', e.target.value)}
                            />
                            <Button
                                type="button"
                                className="vc-send"
                                data-action={p.mode === 'generating' ? 'stop' : 'say'}
                                aria-label={p.mode === 'generating' ? '停止' : '发送'}
                                disabled={p.mode === 'generating' || !p.draftSay.trim()}
                            >
                                {glyph(p.mode === 'generating' ? 'square' : 'arrow-up', 18)}
                            </Button>
                        </label>
                    </div>
                </div>
            )}
        </>
    );
}
