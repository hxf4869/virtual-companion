import { createPortal } from 'react-dom';
import type { RefObject } from 'react';
import { Button } from '@base-ui/react/button';
import { Icon } from '../../components/Icon';

export interface ChatSearchProps {
    toggleHost: HTMLElement;
    sprite: string;
    open: boolean;
    query: string;
    count: string;
    disabled: boolean;
    events: {
        open(): void;
        close(): void;
        change(value: string): void;
        step(delta: number): void;
        key(event: KeyboardEvent): void;
    };
}
export interface ChatSearchRefs {
    toggle: RefObject<HTMLButtonElement | null>;
    bar: RefObject<HTMLDivElement | null>;
    input: RefObject<HTMLInputElement | null>;
}

export function ChatSearch({ p, refs }: { p: ChatSearchProps; refs: ChatSearchRefs }) {
    return (
        <>
            {createPortal(
                <Button
                    ref={refs.toggle}
                    type="button"
                    className="vc-circle vc-desk-search-toggle"
                    aria-label="搜索"
                    onClick={p.events.open}
                >
                    <Icon sprite={p.sprite} name="search" size={20} />
                </Button>,
                p.toggleHost,
            )}
            <div
                ref={refs.bar}
                className="vc-chat-search"
                hidden={!p.open}
                role="search"
                onKeyDown={(event) => p.events.key(event.nativeEvent)}
            >
                <label className="vc-chat-search-field">
                    <span className="vc-chat-search-icon">
                        <Icon sprite={p.sprite} name="search" size={18} />
                    </span>
                    <input
                        ref={refs.input}
                        type="text"
                        autoComplete="off"
                        enterKeyHint="search"
                        placeholder="搜索"
                        aria-label="搜索"
                        value={p.query}
                        onChange={(event) => p.events.change(event.currentTarget.value)}
                    />
                    <span className="vc-chat-search-count vc-num" aria-live="polite">
                        {p.count}
                    </span>
                </label>
                <Button
                    type="button"
                    className="vc-circle"
                    aria-label="上一条"
                    disabled={p.disabled}
                    onClick={() => p.events.step(-1)}
                >
                    <Icon sprite={p.sprite} name="arrow-up" size={18} />
                </Button>
                <Button
                    type="button"
                    className="vc-circle"
                    aria-label="下一条"
                    disabled={p.disabled}
                    onClick={() => p.events.step(1)}
                >
                    <Icon sprite={p.sprite} name="arrow-down" size={18} />
                </Button>
                <Button type="button" className="vc-btn vc-btn-gray vc-chat-search-done" onClick={p.events.close}>
                    完成
                </Button>
            </div>
        </>
    );
}
