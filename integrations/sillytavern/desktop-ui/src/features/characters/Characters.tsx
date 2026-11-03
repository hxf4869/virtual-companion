import { useEffect, useRef, useState, type CSSProperties, type ButtonHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../components/Icon';

export interface CharacterInstance {
    relationshipId: string;
    name: string;
    label: string;
    when: string;
}
export interface CharacterCard {
    characterRef: string;
    name: string;
    description: string;
    worldName: string;
    avatar: string;
    instances: CharacterInstance[];
}
export interface CharacterState {
    creating?: boolean;
    selectedCharacterRef?: string;
    selectedRelationshipId?: string;
    draftName?: string;
    savedName?: string;
    busy?: boolean;
    nameError?: string;
    importError?: string;
    loadError?: string;
    unsaved?: { type: string; id?: string } | null;
}
export interface CharacterEvents {
    action: (action: string, trigger: HTMLButtonElement) => void;
    name: (name: string) => void;
    save: () => void;
}
export interface CharactersProps {
    state: CharacterState;
    cards: CharacterCard[];
    loose: CharacterInstance[];
    instances: CharacterInstance[];
    sprite: string;
    unsavedCopy: string;
    screen?: string;
    detailRef?: string;
    loading?: boolean;
    descriptionOpen?: boolean;
    desktop?: boolean;
    query?: string;
    voiceAvailable?: boolean;
    events: CharacterEvents;
    search?: (query: string) => void;
    readTint: (url: string) => Promise<string>;
}
const initial = (name: string) => [...String(name || '').replace(/[^\p{L}\p{N}]/gu, '')][0] || '角';
const neutralTint = '140,140,150';
function useTint(src: string, read: CharactersProps['readTint']) {
    const [value, setValue] = useState({ src, tint: neutralTint });
    useEffect(() => {
        let live = true;
        if (src)
            void read(src).then((tint) => {
                if (live) setValue({ src, tint });
            });
        return () => {
            live = false;
        };
    }, [src, read]);
    return value.src === src ? value.tint : neutralTint;
}
function Face({ name, src, className }: { name: string; src: string; className: string }) {
    return <span className={className}>{src ? <img alt="" src={src} /> : initial(name)}</span>;
}
function Action({
    action,
    events,
    children,
    ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { action: string; events: CharacterEvents }) {
    return (
        <button type="button" data-action={action} {...props} onClick={(e) => events.action(action, e.currentTarget)}>
            {children}
        </button>
    );
}
function Instances({ items, p }: { items: CharacterInstance[]; p: CharactersProps }) {
    if (!items.length) return <p>还没有陪伴实例</p>;
    return items.map((item) => {
        const current = !p.state.creating && item.relationshipId === p.state.selectedRelationshipId;
        return (
            <Action
                key={item.relationshipId}
                action="select-instance"
                events={p.events}
                disabled={p.state.busy}
                className="vc-cell"
                data-id={item.relationshipId}
                aria-current={current ? 'true' : 'false'}
            >
                <span className="vc-grow">
                    <strong>{item.label}</strong>
                    {(item.when || current) && (
                        <span className="vc-instance-sub">
                            {item.when && <span className="vc-meta vc-num">{item.when}</span>}
                            {current && <span className="vc-instance-badge">正在编辑</span>}
                        </span>
                    )}
                </span>
                <span className="vc-chevron">
                    <Icon sprite={p.sprite} name="chevron-right" size={16} />
                </span>
            </Action>
        );
    });
}
function NameForm({ p, legacy = false }: { p: CharactersProps; legacy?: boolean }) {
    const s = p.state,
        dirty = s.draftName !== s.savedName && Boolean(s.creating || s.selectedRelationshipId);
    const editingName =
        p.instances.find((item) => item.relationshipId === s.selectedRelationshipId)?.name ||
        s.savedName ||
        '未命名实例';
    return (
        <form
            className="vc-instance-form"
            data-form="instance"
            onSubmit={(e) => {
                e.preventDefault();
                p.events.save();
            }}
        >
            {legacy && <h2>{s.creating ? '新建实例' : `正在编辑 · ${editingName}`}</h2>}
            <label>
                实例名称
                <input
                    name="displayName"
                    value={s.draftName || ''}
                    maxLength={64}
                    disabled={s.busy}
                    onChange={(e) => p.events.name(e.currentTarget.value)}
                />
            </label>
            {dirty && <p className={legacy ? undefined : 'vc-footnote'}>{p.unsavedCopy}</p>}
            {s.nameError && <p role="alert">{s.nameError}</p>}
            <div className="vc-instance-form-actions">
                <Action
                    action="cancel-edit"
                    events={p.events}
                    className={legacy ? undefined : 'vc-btn vc-btn-text'}
                    disabled={s.busy}
                >
                    取消
                </Action>
                <button
                    type="submit"
                    className={legacy ? 'vc-instance-primary' : 'vc-btn vc-btn-fill'}
                    disabled={s.busy}
                >
                    {s.creating ? '创建实例' : '保存更改'}
                </button>
            </div>
        </form>
    );
}
function Card({ card, p }: { card: CharacterCard; p: CharactersProps }) {
    const tint = useTint(card.avatar, p.readTint);
    const current = card.characterRef === p.detailRef;
    const text = `${card.avatar ? '' : initial(card.name)}${card.name || '未命名角色卡'}${card.instances.length} 个实例`;
    const hidden = Boolean(p.query) && !text.toLocaleLowerCase().includes(p.query!.trim().toLocaleLowerCase());
    return (
        <Action
            action="select-template"
            events={p.events}
            disabled={p.state.busy}
            className="vc-role"
            data-ref={card.characterRef}
            data-tint={card.avatar}
            style={{ '--vc-tint': tint } as CSSProperties}
            aria-current={current ? 'true' : 'false'}
            hidden={hidden}
            data-vc-light={p.desktop ? '' : undefined}
            data-vc-tilt={p.desktop ? '' : undefined}
        >
            <Face name={card.name} src={card.avatar} className="vc-role-avatar" />
            <b>{card.name || '未命名角色卡'}</b>
            <span>{`${card.instances.length} 个实例`}</span>
        </Action>
    );
}
function Detail({ card, p }: { card: CharacterCard; p: CharactersProps }) {
    const tint = useTint(card.avatar, p.readTint);
    const showForm =
        p.state.creating || card.instances.some((item) => item.relationshipId === p.state.selectedRelationshipId);
    return (
        <div className="vc-column">
            <div className="vc-poster" data-tint={card.avatar} style={{ '--vc-tint': tint } as CSSProperties}>
                <Face name={card.name} src={card.avatar} className="vc-poster-avatar" />
                <span className="vc-instance-badge">模板</span>
                <span className="vc-meta">{`${card.instances.length} 个实例`}</span>
            </div>
            {card.description && (
                <section
                    className={`vc-group vc-card-description${p.descriptionOpen ? ' is-open' : ''}`}
                    data-vc-description=""
                >
                    <p className="vc-card-description-text">{card.description}</p>
                    <Action
                        action="toggle-description"
                        events={p.events}
                        className="vc-btn vc-btn-text"
                        aria-expanded={Boolean(p.descriptionOpen)}
                    >
                        {p.descriptionOpen ? '收起' : '展开'}
                    </Action>
                </section>
            )}
            {card.worldName && (
                <div className="vc-group">
                    <div className="vc-cell">
                        <span className="vc-grow">
                            <span className="vc-instance-world">{`关联世界书 · ${card.worldName}`}</span>
                        </span>
                    </div>
                </div>
            )}
            <div className="vc-group">
                <Action action="edit-persona" events={p.events} disabled={p.state.busy} className="vc-cell">
                    <span className="vc-grow">人设</span>
                    <span className="vc-chevron">
                        <Icon sprite={p.sprite} name="chevron-right" size={16} />
                    </span>
                </Action>
            </div>
            {card.instances.length > 0 && p.voiceAvailable && (
                <div className="vc-group">
                    <Action action="edit-voice" events={p.events} disabled={p.state.busy} className="vc-cell">
                        <span className="vc-grow">声音</span>
                        <span className="vc-chevron">
                            <Icon sprite={p.sprite} name="chevron-right" size={16} />
                        </span>
                    </Action>
                </div>
            )}
            <div className="vc-group" aria-label="陪伴实例">
                <Instances items={card.instances} p={p} />
            </div>
            {card.instances.length > 0 && !p.state.creating && (
                <Action
                    action="create"
                    events={p.events}
                    disabled={p.state.busy}
                    className="vc-btn vc-btn-text vc-instance-create"
                >
                    创建实例
                </Action>
            )}
            {!card.instances.length && !showForm && (
                <Action
                    action="create"
                    events={p.events}
                    disabled={p.state.busy}
                    className="vc-btn vc-btn-fill vc-instance-create vc-instance-primary"
                >
                    创建实例
                </Action>
            )}
            {showForm && <NameForm p={p} />}
            {p.state.importError && (
                <p className="vc-instance-alert" role="alert">
                    {p.state.importError}
                </p>
            )}
            {p.state.loadError && (
                <p className="vc-instance-alert" role="alert">
                    {p.state.loadError}
                </p>
            )}
        </div>
    );
}
export function Characters(p: CharactersProps) {
    const [navProgress, setNavProgress] = useState(0);
    const card = p.cards.find((item) => item.characterRef === p.detailRef) || p.cards[0];
    const detail = p.screen === 'detail' && card;
    if (p.loading)
        return (
            <>
                <header className="vc-navbar">
                    <div className="vc-nav-title">角色</div>
                    <div className="vc-nav-spacer" />
                </header>
                <div className="vc-scroll" aria-busy="true">
                    <h1 className="vc-large-title">角色</h1>
                    <div className="vc-roles">
                        {[0, 1, 2, 3].map((key) => (
                            <div key={key} className="vc-role" aria-hidden="true">
                                <span className="vc-skeleton vc-skeleton-avatar" />
                                <span className="vc-skeleton vc-skeleton-line" />
                                <span className="vc-skeleton vc-skeleton-line is-short" />
                            </div>
                        ))}
                    </div>
                </div>
            </>
        );
    return (
        <>
            <header className="vc-navbar" style={{ '--vc-nav-p': detail ? 1 : navProgress } as CSSProperties}>
                {detail ? (
                    <>
                        <Action
                            action="back"
                            events={p.events}
                            className="vc-circle vc-glass"
                            disabled={p.state.busy}
                            aria-label="返回"
                        >
                            <Icon sprite={p.sprite} name="chevron-left" />
                        </Action>
                        <h1 className="vc-nav-title" tabIndex={-1}>
                            {card.name}
                        </h1>
                        <div className="vc-nav-spacer" />
                        <Action
                            action="edit-card"
                            events={p.events}
                            className="vc-circle vc-glass"
                            disabled={p.state.busy}
                            aria-label="编辑角色卡"
                        >
                            <Icon sprite={p.sprite} name="pencil" />
                        </Action>
                    </>
                ) : (
                    <>
                        <div className="vc-nav-title">角色</div>
                        <div className="vc-nav-spacer" />
                        {p.desktop && (
                            <input
                                type="search"
                                className="vc-character-search"
                                name="character-search"
                                aria-label="搜索角色"
                                placeholder="搜索角色"
                                value={p.query || ''}
                                onChange={(e) => p.search?.(e.currentTarget.value)}
                            />
                        )}
                        <Action
                            action="import"
                            events={p.events}
                            className="vc-circle vc-glass"
                            aria-label="导入角色卡"
                        >
                            <Icon sprite={p.sprite} name="plus" />
                        </Action>
                    </>
                )}
            </header>
            <div className="vc-scroll" onScroll={(e) => setNavProgress(Math.min(1, e.currentTarget.scrollTop / 48))}>
                {detail ? (
                    <Detail card={card} p={p} />
                ) : (
                    <div className="vc-column">
                        <h1 className="vc-large-title" tabIndex={-1}>
                            角色
                        </h1>
                        {p.state.importError && (
                            <p className="vc-instance-alert" role="alert">
                                {p.state.importError}
                            </p>
                        )}
                        {p.state.loadError && (
                            <>
                                <p className="vc-instance-alert" role="alert">
                                    {p.state.loadError}
                                </p>
                                <Action action="retry" events={p.events} className="vc-btn vc-btn-fill">
                                    重试
                                </Action>
                            </>
                        )}
                        {p.cards.length ? (
                            <>
                                <div className="vc-roles">
                                    {p.cards.map((item, i) => (
                                        <Card key={item.characterRef || i} card={item} p={p} />
                                    ))}
                                </div>
                                {p.loose.length > 0 && (
                                    <div className="vc-group" aria-label="陪伴实例">
                                        <Instances items={p.loose} p={p} />
                                    </div>
                                )}
                            </>
                        ) : (
                            <div className="vc-empty">
                                <Icon sprite={p.sprite} name="users-round" size={32} />
                                <p>还没有角色卡模板</p>
                                <Action action="import" events={p.events} className="vc-btn vc-btn-fill">
                                    导入角色卡
                                </Action>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </>
    );
}
function Unsaved({ p, host }: { p: CharactersProps; host: HTMLElement }) {
    const ref = useRef<HTMLDialogElement>(null);
    useEffect(() => {
        ref.current?.showModal();
        return () => ref.current?.close();
    }, []);
    return createPortal(
        <dialog
            ref={ref}
            className="vc-instance-unsaved"
            onCancel={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const button = ref.current?.querySelector<HTMLButtonElement>('[data-action="keep-editing"]');
                if (button) p.events.action('keep-editing', button);
            }}
        >
            <p>{p.unsavedCopy}</p>
            <div className="vc-instance-actions">
                <Action action="keep-editing" events={p.events}>
                    继续编辑
                </Action>
                <Action action="discard" events={p.events}>
                    放弃更改
                </Action>
            </div>
        </dialog>,
        host,
    );
}
export function InstanceContents(p: CharactersProps & { host: HTMLElement }) {
    const s = p.state,
        form = s.creating || s.selectedRelationshipId;
    return (
        <div className="vc-instance-page">
            <header className="vc-instance-bar">
                <h1>角色</h1>
                <div className="vc-instance-bar-actions">
                    <Action action="import" events={p.events} disabled={s.busy}>
                        导入角色卡
                    </Action>
                    <Action action="close" events={p.events} disabled={s.busy}>
                        关闭
                    </Action>
                </div>
            </header>
            {s.importError && (
                <p className="vc-instance-alert" role="alert">
                    {s.importError}
                </p>
            )}
            {s.loadError && (
                <p className="vc-instance-alert" role="alert">
                    {s.loadError}
                </p>
            )}
            <div className="vc-instance-columns">
                <section aria-label="角色卡模板">
                    <h2>角色卡模板</h2>
                    {p.cards.length ? (
                        <ul className="vc-instance-list">
                            {p.cards.map((item, i) => (
                                <li key={item.characterRef || i}>
                                    <Action
                                        action="select-template"
                                        events={p.events}
                                        className="vc-instance-template"
                                        data-ref={item.characterRef}
                                        disabled={s.busy}
                                        aria-current={item.characterRef === s.selectedCharacterRef ? 'true' : 'false'}
                                    >
                                        <span className="vc-instance-avatar" aria-hidden="true">
                                            {initial(item.name)}
                                        </span>
                                        <span className="vc-instance-template-copy">
                                            <strong>{item.name || '未命名角色卡'}</strong>
                                            <span className="vc-instance-badge">模板</span>
                                            {item.description && (
                                                <span className="vc-instance-secondary">{item.description}</span>
                                            )}
                                            {item.worldName && (
                                                <span className="vc-instance-world">{`关联世界书 · ${item.worldName}`}</span>
                                            )}
                                        </span>
                                    </Action>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p>还没有角色卡模板</p>
                    )}
                </section>
                <div className="vc-instance-main">
                    <section aria-label="陪伴实例">
                        <h2>陪伴实例</h2>
                        {p.instances.length ? (
                            <ul className="vc-instance-list">
                                {p.instances.map((item) => (
                                    <li key={item.relationshipId}>
                                        <Action
                                            action="select-instance"
                                            events={p.events}
                                            className="vc-instance-choice"
                                            data-id={item.relationshipId}
                                            disabled={s.busy}
                                            aria-current={
                                                !s.creating && item.relationshipId === s.selectedRelationshipId
                                                    ? 'true'
                                                    : 'false'
                                            }
                                        >
                                            <span className="vc-instance-avatar" aria-hidden="true">
                                                {initial(item.name)}
                                            </span>
                                            <span className="vc-instance-choice-copy">
                                                <strong>{item.name}</strong>
                                                {!s.creating && item.relationshipId === s.selectedRelationshipId && (
                                                    <span className="vc-instance-badge">正在编辑</span>
                                                )}
                                            </span>
                                        </Action>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p>还没有陪伴实例</p>
                        )}
                        <Action
                            action="create"
                            events={p.events}
                            disabled={s.busy}
                            className={`vc-instance-create${p.instances.length ? '' : ' vc-instance-primary'}`}
                        >
                            创建实例
                        </Action>
                    </section>
                    {form && <NameForm p={p} legacy />}
                </div>
            </div>
            {s.unsaved && <Unsaved p={p} host={p.host} />}
        </div>
    );
}
export interface PersonaProps {
    fields: Record<string, string>;
    busy: boolean;
    error: string;
    sprite: string;
    back: () => void;
    save: (fields: Record<string, string>) => void;
}
export function PersonaEditor(p: PersonaProps) {
    const [fields, setFields] = useState(p.fields);
    return (
        <>
            <header className="vc-navbar" style={{ '--vc-nav-p': 1 } as CSSProperties}>
                <button
                    type="button"
                    className="vc-circle vc-glass"
                    data-action="close-persona"
                    aria-label="返回"
                    disabled={p.busy}
                    onClick={p.back}
                >
                    <Icon sprite={p.sprite} name="chevron-left" />
                </button>
                <h1 className="vc-nav-title" tabIndex={-1}>
                    人设
                </h1>
                <div className="vc-nav-spacer" />
            </header>
            <div className="vc-scroll">
                <div className="vc-column">
                    <div className="vc-group">
                        {Object.entries({
                            description: '介绍',
                            personality: '性格',
                            scenario: '情景',
                            first_mes: '开场',
                            mes_example: '例句',
                        }).map(([key, label]) => (
                            <label key={key} className="vc-cell vc-persona-field">
                                <span className="vc-grow">{label}</span>
                                <textarea
                                    data-persona={key}
                                    aria-label={label}
                                    value={fields[key] || ''}
                                    disabled={p.busy}
                                    onChange={(e) => setFields({ ...fields, [key]: e.currentTarget.value })}
                                />
                            </label>
                        ))}
                    </div>
                    <p data-persona-error="" role="alert">
                        {p.error}
                    </p>
                    <button
                        type="button"
                        className="vc-btn vc-btn-fill"
                        data-action="save-persona"
                        disabled={p.busy}
                        onClick={() => p.save(fields)}
                    >
                        保存
                    </button>
                </div>
            </div>
        </>
    );
}
