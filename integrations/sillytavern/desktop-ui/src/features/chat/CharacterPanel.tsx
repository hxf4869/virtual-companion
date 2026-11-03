import { createPortal } from 'react-dom';
import { useEffect, useRef, type CSSProperties, type RefObject } from 'react';
import { Button } from '@base-ui/react/button';
import { Icon } from '../../components/Icon';
export interface CharacterPanelProps {
    sprite: string;
    name: string;
    avatar: string;
    displayName: string;
    mood: string;
    open: boolean;
    memories: { id: string; summary: string }[];
    followups: { id: string; body: string; time: string }[];
    events: {
        toggle(): void;
        close(): void;
        voice(opener: HTMLElement): void;
        memory(opener: HTMLElement): void;
        settings(opener: HTMLElement): void;
        edit(id: string): void;
        forget(id: string): void;
    };
}
export function CharacterPanel({
    p,
    tools,
    toggle,
}: {
    p: CharacterPanelProps;
    tools: HTMLElement;
    toggle: RefObject<HTMLButtonElement | null>;
}) {
    const action = (label: string, glyph: string, run: (opener: HTMLElement) => void, className = '', size = 24) => (
        <Button
            type="button"
            className={`vc-circle${className ? ' ' + className : ''}`}
            aria-label={label}
            onClick={(e) => run(e.currentTarget)}
        >
            <Icon sprite={p.sprite} name={glyph} size={size} />
        </Button>
    );
    return (
        <>
            {createPortal(
                <Button
                    ref={toggle}
                    type="button"
                    className="vc-circle vc-desk-character-toggle"
                    aria-label="角色面板"
                    aria-controls="vc-desktop-character-panel"
                    aria-expanded={p.open}
                    onClick={p.events.toggle}
                >
                    <Icon sprite={p.sprite} name="user-round" size={20} />
                </Button>,
                tools,
            )}
            {action('关闭角色面板', 'x', p.events.close, 'vc-desk-character-close', 20)}
            <div className="vc-desk-character-identity">
                {p.name && (
                    <>
                        <span className="vc-desk-character-avatar">
                            {p.avatar ? <img src={p.avatar} alt="" /> : p.name.slice(0, 1)}
                        </span>
                        <h1>{p.name}</h1>
                        {p.displayName && <p className="vc-meta">{p.displayName}</p>}
                        {p.mood && <p className="vc-desk-character-mood">{p.mood}</p>}
                    </>
                )}
            </div>
            <div className="vc-desk-character-actions">
                {p.name && (
                    <>
                        {[
                            ['声音', 'volume-2', p.events.voice],
                            ['记忆', 'brain', p.events.memory],
                            ['设置', 'settings', p.events.settings],
                        ].map(([label, glyph, run]) => (
                            <div key={label as string}>
                                {action(label as string, glyph as string, run as (el: HTMLElement) => void)}
                                <span>{label as string}</span>
                            </div>
                        ))}
                    </>
                )}
            </div>
            <section className="vc-desk-character-section" hidden={!p.memories.length}>
                {p.memories.length > 0 && (
                    <>
                        <h2>本次想起</h2>
                        {p.memories.map((row) => (
                            <article key={row.id} className="vc-desk-recalled" data-memory-id={row.id}>
                                <p>{row.summary}</p>
                                <div className="vc-desk-recalled-actions">
                                    <Button
                                        type="button"
                                        className="vc-btn vc-btn-text"
                                        onClick={() => p.events.edit(row.id)}
                                    >
                                        纠正
                                    </Button>
                                    <Button
                                        type="button"
                                        className="vc-btn vc-btn-text is-danger"
                                        onClick={() => p.events.forget(row.id)}
                                    >
                                        删除
                                    </Button>
                                </div>
                            </article>
                        ))}
                    </>
                )}
            </section>
            <section className="vc-desk-character-section" hidden={!p.followups.length}>
                {p.followups.length > 0 && (
                    <>
                        <h2>跟进</h2>
                        {p.followups.map((row) => (
                            <article key={row.id} className="vc-desk-recalled">
                                <p>{row.body}</p>
                                <time className="vc-meta">{row.time}</time>
                            </article>
                        ))}
                    </>
                )}
            </section>
        </>
    );
}
export interface RecalledEditorProps {
    draft: string;
    busy: boolean;
    dirty: boolean;
    error: string;
    change(value: string): void;
    save(): void;
    cancel(): void;
    dispose(): void;
}
export function RecalledEditor(p: RecalledEditorProps) {
    const input = useRef<HTMLTextAreaElement>(null),
        save = useRef<HTMLButtonElement>(null),
        width = useRef<number | undefined>(undefined);
    if (p.busy && width.current === undefined) width.current = save.current?.getBoundingClientRect().width;
    useEffect(() => {
        input.current?.focus();
        return p.dispose;
    }, [p.dispose]);
    return (
        <form
            className="vc-desk-memory-editor"
            onSubmit={(e) => {
                e.preventDefault();
                p.save();
            }}
        >
            <label htmlFor="vc-desk-recall-draft">纠正记忆</label>
            <textarea
                ref={input}
                id="vc-desk-recall-draft"
                value={p.draft}
                disabled={p.busy}
                onChange={(e) => p.change(e.target.value)}
            />
            <p className="vc-desk-error" role="alert">
                {p.error}
            </p>
            <div className="vc-desk-editor-actions">
                <Button type="button" className="vc-btn vc-btn-gray" disabled={p.busy} onClick={p.cancel}>
                    取消
                </Button>
                <Button
                    ref={save}
                    type="submit"
                    className="vc-btn vc-btn-fill"
                    disabled={p.busy || !p.dirty || !p.draft.trim()}
                    style={width.current === undefined ? undefined : ({ width: width.current } as CSSProperties)}
                >
                    {p.busy ? '保存中…' : '保存'}
                </Button>
            </div>
        </form>
    );
}
