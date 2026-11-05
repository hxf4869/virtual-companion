import React, { useCallback, useEffect, useRef, useState } from 'react';
import { spanOf, textMatches } from '../../../../extension/vc-model-settings/chat-logic.js';
import { Icon } from '../../design/components/Icon';
import { IconButton } from '../../design/components/IconButton';
import { useReducedMotion } from '../../shell/useReducedMotion';

export interface ChatSearchProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    activeKey: string;
    messageCount: number;
    onEnsureAllHistory?: () => Promise<void> | void;
    onJumpToMessage?: (mesid: number) => boolean;
    toggleButtonRef?: React.RefObject<HTMLButtonElement | null>;
}

interface SearchMatch {
    mes: HTMLElement;
    range: Range;
}

function collectTextNodes(root: Element): Text[] {
    const doc = root.ownerDocument;
    const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */, {
        acceptNode: node =>
            /^(SCRIPT|STYLE)$/.test(node.parentElement?.tagName || '') ? 2 : 1,
    });
    const nodes: Text[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        nodes.push(node as Text);
    }
    return nodes;
}

function visibleRoots(mes: Element): Element[] {
    return Array.from(mes.querySelectorAll('.mes_text, .vc-segs')).filter(
        el => !el.closest('[aria-hidden="true"]'),
    );
}

function collectDomMatches(chat: HTMLElement, query: string): SearchMatch[] {
    const matches: SearchMatch[] = [];
    for (const mes of Array.from(chat.querySelectorAll<HTMLElement>(':scope > .mes'))) {
        for (const root of visibleRoots(mes)) {
            const nodes = collectTextNodes(root);
            const parts = nodes.map(n => n.data);
            for (const [start, end] of textMatches(parts.join(''), query)) {
                const span = spanOf(parts, start, end);
                if (!span) continue;
                const range = root.ownerDocument.createRange();
                range.setStart(nodes[span.from.part], span.from.offset);
                range.setEnd(nodes[span.to.part], span.to.offset);
                matches.push({ mes, range });
            }
        }
    }
    return matches;
}

function isHighlightSupported(): boolean {
    return (
        typeof (globalThis as any).CSS?.highlights?.set === 'function' &&
        typeof (globalThis as any).Highlight === 'function'
    );
}

function clearDomHighlights() {
    if (isHighlightSupported()) {
        (globalThis as any).CSS.highlights.delete('vc-search');
        (globalThis as any).CSS.highlights.delete('vc-search-current');
    }
    for (const mes of Array.from(
        document.querySelectorAll('#chat > .mes[data-vc-search-current]'),
    )) {
        mes.removeAttribute('data-vc-search-current');
    }
}

export function ChatSearch({
    open,
    onOpenChange,
    activeKey,
    messageCount,
    onEnsureAllHistory,
    onJumpToMessage,
    toggleButtonRef,
}: ChatSearchProps) {
    const reducedMotion = useReducedMotion();
    const [query, setQuery] = useState('');
    const [matchTotal, setMatchTotal] = useState(0);
    const [currentIdx, setCurrentIdx] = useState(-1);

    const inputRef = useRef<HTMLInputElement | null>(null);
    const barRef = useRef<HTMLDivElement | null>(null);
    const matchesRef = useRef<SearchMatch[]>([]);
    const currentIdxRef = useRef(-1);
    const queryRef = useRef('');
    const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    const markCurrent = useCallback(
        (scroll: boolean) => {
            clearDomHighlights();
            const list = matchesRef.current;
            const idx = currentIdxRef.current;
            setMatchTotal(list.length);
            setCurrentIdx(idx);
            if (!list.length || idx < 0 || idx >= list.length) return;

            if (isHighlightSupported()) {
                const HighlightCtor = (globalThis as any).Highlight;
                (globalThis as any).CSS.highlights.set(
                    'vc-search',
                    new HighlightCtor(...list.map(m => m.range)),
                );
                const current = new HighlightCtor(list[idx].range);
                current.priority = 1;
                (globalThis as any).CSS.highlights.set('vc-search-current', current);
            }

            const { mes, range } = list[idx];
            mes.setAttribute('data-vc-search-current', '');
            if (scroll) {
                const mesidAttr = mes.getAttribute('mesid');
                const mesid = mesidAttr !== null ? Number(mesidAttr) : NaN;
                const jumped = Number.isInteger(mesid) ? onJumpToMessage?.(mesid) : false;
                if (!jumped) {
                    (range.startContainer.parentElement || mes).scrollIntoView({
                        block: 'center',
                        behavior: reducedMotion ? 'auto' : 'smooth',
                    });
                }
            }
        },
        [onJumpToMessage, reducedMotion],
    );

    const executeSearch = useCallback(
        async ({ keep = false }: { keep?: boolean } = {}) => {
            if (timerRef.current !== undefined) {
                clearTimeout(timerRef.current);
                timerRef.current = undefined;
            }
            const requested = queryRef.current;
            if (!requested.trim()) {
                matchesRef.current = [];
                currentIdxRef.current = -1;
                clearDomHighlights();
                setMatchTotal(0);
                setCurrentIdx(-1);
                return;
            }
            await onEnsureAllHistory?.();
            if (queryRef.current !== requested) return;

            const chat = document.getElementById('chat');
            const matches = chat ? collectDomMatches(chat, requested.trim()) : [];
            matchesRef.current = matches;

            if (!matches.length) {
                currentIdxRef.current = -1;
            } else if (keep && currentIdxRef.current >= 0) {
                currentIdxRef.current = Math.min(currentIdxRef.current, matches.length - 1);
            } else {
                const top = chat?.getBoundingClientRect().top ?? 0;
                const at = matches.findIndex(m => m.range.getBoundingClientRect().bottom >= top);
                currentIdxRef.current = at < 0 ? matches.length - 1 : at;
            }
            markCurrent(!keep);
        },
        [markCurrent, onEnsureAllHistory],
    );

    const handleStep = useCallback(
        (delta: number) => {
            const list = matchesRef.current;
            if (!list.length) return;
            currentIdxRef.current = (currentIdxRef.current + delta + list.length) % list.length;
            markCurrent(true);
        },
        [markCurrent],
    );

    const handleClose = useCallback(() => {
        if (timerRef.current !== undefined) {
            clearTimeout(timerRef.current);
            timerRef.current = undefined;
        }
        matchesRef.current = [];
        currentIdxRef.current = -1;
        clearDomHighlights();
        setMatchTotal(0);
        setCurrentIdx(-1);
        onOpenChange(false);
        if (
            document.activeElement === document.body ||
            barRef.current?.contains(document.activeElement)
        ) {
            toggleButtonRef?.current?.focus();
        }
    }, [onOpenChange, toggleButtonRef]);

    useEffect(() => {
        if (open) {
            window.requestAnimationFrame(() => {
                inputRef.current?.focus();
                inputRef.current?.select();
            });
            void executeSearch();
        } else {
            clearDomHighlights();
        }
    }, [open, executeSearch]);

    // Close search when switching conversations
    const prevKeyRef = useRef(activeKey);
    useEffect(() => {
        if (prevKeyRef.current !== activeKey) {
            prevKeyRef.current = activeKey;
            if (open) {
                handleClose();
            }
        }
    }, [activeKey, handleClose, open]);

    // Re-evaluate search when messageCount changes while open
    useEffect(() => {
        if (open && queryRef.current.trim()) {
            if (timerRef.current !== undefined) clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => {
                void executeSearch({ keep: true });
            }, 150);
        }
    }, [messageCount, open, executeSearch]);

    // Global Ctrl+F / Cmd+F and Escape listener
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (
                (e.metaKey || e.ctrlKey) &&
                !e.altKey &&
                !e.shiftKey &&
                e.key.toLowerCase() === 'f'
            ) {
                const chat = document.getElementById('chat');
                if (!chat || chat.closest('[hidden]')) return;
                e.preventDefault();
                onOpenChange(true);
                window.requestAnimationFrame(() => {
                    inputRef.current?.focus();
                    inputRef.current?.select();
                });
                return;
            }
            if (e.key === 'Escape' && !e.defaultPrevented && open) {
                e.preventDefault();
                handleClose();
            }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('keydown', onKeyDown);
            clearDomHighlights();
        };
    }, [handleClose, onOpenChange, open]);

    const countLabel = !query.trim()
        ? ''
        : matchTotal > 0
          ? `${currentIdx + 1} / ${matchTotal}`
          : '没有找到';

    return (
        <div
            ref={barRef}
            className="vc-chat-search"
            hidden={!open}
            role="search"
            onKeyDown={e => {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    handleClose();
                    return;
                }
                if (
                    e.key === 'Enter' &&
                    !e.nativeEvent.isComposing &&
                    e.target === inputRef.current
                ) {
                    e.preventDefault();
                    if (timerRef.current !== undefined) {
                        clearTimeout(timerRef.current);
                        timerRef.current = undefined;
                        void executeSearch();
                        return;
                    }
                    handleStep(e.shiftKey ? -1 : 1);
                }
            }}
        >
            <label className="vc-chat-search-field">
                <span className="vc-chat-search-icon">
                    <Icon name="search" size={18} />
                </span>
                <input
                    ref={inputRef}
                    type="text"
                    autoComplete="off"
                    enterKeyHint="search"
                    placeholder="搜索"
                    aria-label="搜索"
                    value={query}
                    onChange={e => {
                        const val = e.currentTarget.value;
                        setQuery(val);
                        queryRef.current = val;
                        if (timerRef.current !== undefined) clearTimeout(timerRef.current);
                        timerRef.current = setTimeout(() => {
                            void executeSearch();
                        }, 120);
                    }}
                />
                <span className="vc-chat-search-count vc-num" aria-live="polite">
                    {countLabel}
                </span>
            </label>
            <IconButton
                icon="arrow-up"
                size={36}
                iconSize={18}
                className="vc-icon-btn"
                aria-label="上一条"
                disabled={matchTotal < 2}
                onClick={() => handleStep(-1)}
            />
            <IconButton
                icon="arrow-down"
                size={36}
                iconSize={18}
                className="vc-icon-btn"
                aria-label="下一条"
                disabled={matchTotal < 2}
                onClick={() => handleStep(1)}
            />
            <button
                type="button"
                className="vc-btn vc-btn-gray vc-chat-search-done"
                onClick={handleClose}
            >
                完成
            </button>
        </div>
    );
}
