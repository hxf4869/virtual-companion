import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { Button } from '@base-ui/react/button';
import { Segment } from '../../components/Segment';

export interface EmojiItem {
    kind: 'e' | 's';
    value: string;
    label: string;
    text?: string;
    src?: string;
}
export interface EmojiPanelProps {
    mode: string;
    style: CSSProperties;
    groups(query: string, tab: string): { title: string; items: EmojiItem[] }[];
    pick(kind: string, value: string): void;
    close(restoreFocus: boolean): void;
    returnFocus(): HTMLElement | false | null;
    dispose(): void;
}
export function EmojiPanel({
    p,
    host,
    popup,
    onPopup,
    nested,
}: {
    p: EmojiPanelProps;
    host: HTMLElement;
    popup: RefObject<HTMLDivElement | null>;
    onPopup(node: HTMLElement): void;
    nested: ReactNode;
}) {
    const input = useRef<HTMLInputElement>(null);
    const zoomRef = useRef<HTMLDivElement>(null);
    const [query, setQuery] = useState('');
    const [tab, setTab] = useState('emoji');
    const [zoom, setZoom] = useState<{ item: EmojiItem; left: number; top: number } | null>(null);
    const groups = p.groups(query, tab);
    useEffect(() => p.dispose, [p.dispose]);
    const preview = (item: EmojiItem, button: HTMLButtonElement) => {
        const panel = popup.current;
        if (!panel) return;
        const hostRect = panel.getBoundingClientRect(),
            rect = button.getBoundingClientRect();
        const zoomNode = zoomRef.current;
        const size = zoomNode ? zoomNode.offsetWidth || parseFloat(getComputedStyle(zoomNode).width) : 72;
        setZoom({
            item,
            left: Math.max(
                8,
                Math.min(rect.left - hostRect.left + rect.width / 2 - size / 2, hostRect.width - size - 8),
            ),
            top: rect.top - hostRect.top - size - 6,
        });
    };
    const contents = (item: EmojiItem) => (item.src ? <img src={item.src} alt="" draggable={false} /> : item.text);
    return (
        <Dialog.Root
            defaultOpen
            modal={false}
            onOpenChange={(open, details) => {
                if (open) return;
                // 插入表情会把焦点交还给酒馆输入框；保持非模态选择面板可连续使用。
                const target = details.event.target as Element | null;
                if (
                    details.reason === 'focus-out' ||
                    (details.reason === 'outside-press' && target?.closest?.('#vc-emoji-btn, #vc-react-bar'))
                ) {
                    details.cancel();
                } else p.close(details.reason === 'escape-key');
            }}
        >
            <Dialog.Portal container={host} style={{ display: 'contents' }}>
                <Dialog.Popup
                    id="vc-emoji-panel"
                    className="vc-glass"
                    aria-label="表情"
                    style={p.style}
                    ref={(node) => {
                        popup.current = node;
                        if (node) onPopup(node);
                    }}
                    initialFocus={input}
                    finalFocus={p.returnFocus}
                >
                    <input
                        ref={input}
                        type="search"
                        className="vc-emoji-search"
                        placeholder="搜索表情"
                        aria-label="搜索表情"
                        value={query}
                        onChange={(e) => {
                            setQuery(e.target.value);
                            setZoom(null);
                        }}
                    />
                    {p.mode !== 'react' && (
                        <Segment
                            className="vc-emoji-segment"
                            label="表情与贴纸"
                            preference="emoji-tab"
                            value={tab}
                            options={[
                                { value: 'emoji', label: '表情' },
                                { value: 'sticker', label: '贴纸' },
                            ]}
                            onValueChange={(value) => {
                                setTab(value);
                                setZoom(null);
                            }}
                        />
                    )}
                    <div className="vc-emoji-body" onPointerLeave={() => setZoom(null)} onScroll={() => setZoom(null)}>
                        {groups.length ? (
                            groups.map((group, index) => (
                                <section key={index}>
                                    {group.title && <h3>{group.title}</h3>}
                                    <div className="vc-emoji-grid">
                                        {group.items.map((item) => (
                                            <Button
                                                key={item.value}
                                                type="button"
                                                className={`vc-emoji-cell${item.kind === 's' ? ' is-sticker' : ''}`}
                                                aria-label={item.label}
                                                data-k={item.kind}
                                                data-v={item.value}
                                                onPointerOver={(e) => preview(item, e.currentTarget)}
                                                onFocus={(e) => preview(item, e.currentTarget)}
                                                onClick={() => p.pick(item.kind, item.value)}
                                            >
                                                {contents(item)}
                                            </Button>
                                        ))}
                                    </div>
                                </section>
                            ))
                        ) : (
                            <p className="vc-emoji-none">没有找到</p>
                        )}
                    </div>
                    <div
                        ref={zoomRef}
                        className="vc-emoji-zoom"
                        hidden={!zoom}
                        aria-hidden="true"
                        style={zoom ? { left: zoom.left, top: zoom.top } : undefined}
                    >
                        {zoom && (
                            <button
                                type="button"
                                tabIndex={-1}
                                className={`vc-emoji-cell${zoom.item.kind === 's' ? ' is-sticker' : ''}`}
                            >
                                {contents(zoom.item)}
                            </button>
                        )}
                    </div>
                </Dialog.Popup>
            </Dialog.Portal>
            {nested}
        </Dialog.Root>
    );
}
