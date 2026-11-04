import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Popover as BasePopover } from '@base-ui/react/popover';
import * as emojiDataModule from '@emoji-mart/data';
import type { EmojiMartData } from '@emoji-mart/data';
import { Picker } from 'emoji-mart';
import {
    pushRecent,
    readRecent,
    searchStickers,
    stickerMarkup,
    writeRecent,
} from '../../../../extension/vc-model-settings/chat-logic.js';
import { listStickerPicks } from '../../../../extension/vc-model-settings/stickers-logic.js';
import { PortalNestedScope, usePortalContainer } from '../../design/portal-host';
import { Icon } from '../../design/components/Icon';
import { Tabs } from '../../design/components/Tabs';
import { useChatSnapshot, useSessionBridge } from '../../runtime/session-bridge';

const EMOJI_DATA: EmojiMartData =
    (emojiDataModule as unknown as { default?: EmojiMartData }).default ??
    (emojiDataModule as unknown as EmojiMartData);

const ZH_I18N = {
    search: '搜索表情',
    search_no_results_1: '没有找到',
    search_no_results_2: '换个词试试',
    pick: '选择一个表情…',
    add_custom: '添加自定义表情',
    categories: {
        activity: '活动',
        custom: '自定义',
        flags: '旗帜',
        foods: '食物与饮品',
        frequent: '最近使用',
        nature: '动物与自然',
        objects: '物品',
        people: '表情与人物',
        places: '旅行与地点',
        search: '搜索结果',
        symbols: '符号',
    },
    skins: {
        choose: '选择默认肤色',
        1: '默认',
        2: '浅肤色',
        3: '中浅肤色',
        4: '中等肤色',
        5: '中深肤色',
        6: '深肤色',
    },
};

function ensureIntersectionObserver() {
    if (typeof globalThis.IntersectionObserver !== 'undefined') return;
    class NoopIntersectionObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
        takeRecords() {
            return [];
        }
    }
    (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver =
        NoopIntersectionObserver;
}

export interface EmojiPickerEntry {
    kind: 'e' | 's';
    value: string;
    label: string;
    text?: string;
    src?: string;
}

export interface EmojiPickerProps {
    mode?: 'compose' | 'react';
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    onSelectReaction?: (emoji: string) => void;
    trigger?: React.ReactElement;
}

export function EmojiPicker({
    mode = 'compose',
    open: controlledOpen,
    onOpenChange,
    onSelectReaction,
    trigger,
}: EmojiPickerProps) {
    const bridge = useSessionBridge();
    const canSend = useChatSnapshot(s => s.canSend);
    const activeKey = useChatSnapshot(s => s.key);
    const portalContainer = usePortalContainer();

    const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
    const isOpen = controlledOpen ?? uncontrolledOpen;
    const setOpen = (next: boolean) => {
        if (controlledOpen === undefined) {
            setUncontrolledOpen(next);
        }
        onOpenChange?.(next);
    };

    const [stickerQuery, setStickerQuery] = useState('');
    const [tab, setTab] = useState<'emoji' | 'sticker'>('emoji');
    const [recent, setRecent] = useState<Array<{ k: string; v: string }>>(() => readRecent());
    const [pickerHost, setPickerHost] = useState<HTMLDivElement | null>(null);
    const popupRef = useRef<HTMLDivElement | null>(null);
    const stickerSearchInputRef = useRef<HTMLInputElement | null>(null);

    const effectiveTab = mode === 'react' ? 'emoji' : tab;

    const stickerGroups = useMemo(() => {
        if (effectiveTab !== 'sticker') return [];
        const entries: EmojiPickerEntry[] = searchStickers(stickerQuery, listStickerPicks()).map(
            (pick: any) => ({
                kind: 's' as const,
                value: pick.tag,
                label: pick.tag,
                src: pick.src,
                text: pick.text,
            }),
        );
        const favs = stickerQuery.trim()
            ? []
            : recent
                  .filter(r => r.k === 's')
                  .map(r => entries.find(e => e.value === r.v))
                  .filter((e): e is EmojiPickerEntry => Boolean(e));

        return [
            ...(favs.length ? [{ title: '最近', items: favs }] : []),
            { title: '', items: entries },
        ];
    }, [effectiveTab, stickerQuery, recent]);

    const handlePickEmoji = (nativeEmoji: string) => {
        if (!nativeEmoji) return;
        const nextRecent = pushRecent(readRecent(), { k: 'e', v: nativeEmoji });
        setRecent(nextRecent);
        writeRecent(nextRecent);

        if (mode === 'react') {
            onSelectReaction?.(nativeEmoji);
            setOpen(false);
            return;
        }

        const box = document.querySelector<HTMLTextAreaElement>('#send_textarea');
        const currentDraft = bridge.draft.read(activeKey);
        const start = box?.selectionStart ?? currentDraft.length;
        const end = box?.selectionEnd ?? start;
        const nextDraft = currentDraft.slice(0, start) + nativeEmoji + currentDraft.slice(end);
        bridge.draft.write(activeKey, nextDraft);
        window.requestAnimationFrame(() => {
            box?.focus();
            box?.setSelectionRange(start + nativeEmoji.length, start + nativeEmoji.length);
        });
    };

    const handlePickSticker = (item: EmojiPickerEntry) => {
        const nextRecent = pushRecent(recent, { k: 's', v: item.value });
        setRecent(nextRecent);
        writeRecent(nextRecent);

        if (canSend) {
            void bridge.send(stickerMarkup(item.value), { draftInput: null });
            setOpen(false);
        }
    };

    const handlePickEmojiRef = useRef(handlePickEmoji);
    handlePickEmojiRef.current = handlePickEmoji;

    useEffect(() => {
        if (!isOpen || effectiveTab !== 'emoji' || !pickerHost) return undefined;
        const host = pickerHost;

        ensureIntersectionObserver();
        const themeAttr =
            typeof document !== 'undefined'
                ? document.documentElement.getAttribute('data-vc-theme')
                : null;
        const pickerTheme = themeAttr === 'dark' ? 'dark' : 'light';

        const picker = new Picker({
            data: () => structuredClone(EMOJI_DATA),
            i18n: ZH_I18N,
            locale: 'zh',
            set: 'native',
            theme: pickerTheme,
            previewPosition: 'none',
            skinTonePosition: 'search',
            navPosition: 'top',
            searchPosition: 'sticky',
            perLine: 8,
            emojiSize: 22,
            emojiButtonSize: 34,
            maxFrequentRows: 2,
            autoFocus: true,
            onEmojiSelect: (emoji: { native?: string; id?: string }) => {
                const value = emoji?.native || emoji?.id || '';
                if (value) {
                    handlePickEmojiRef.current(value);
                }
            },
        }) as unknown as HTMLElement;

        const tagShadowButtons = () => {
            const sr = picker.shadowRoot;
            if (!sr) return;
            const buttons = sr.querySelectorAll<HTMLButtonElement>('button[aria-posinset]');
            for (const btn of buttons) {
                if (btn.getAttribute('data-k') !== 'e') {
                    btn.setAttribute('data-k', 'e');
                    const val = btn.getAttribute('aria-label') || btn.textContent || '';
                    if (val) btn.setAttribute('data-v', val);
                }
            }
        };

        let observer: MutationObserver | null = null;
        if (picker.shadowRoot && typeof MutationObserver !== 'undefined') {
            observer = new MutationObserver(() => {
                tagShadowButtons();
            });
            observer.observe(picker.shadowRoot, { childList: true, subtree: true });
        }

        host.replaceChildren(picker);
        tagShadowButtons();
        const raf = window.requestAnimationFrame(tagShadowButtons);

        return () => {
            window.cancelAnimationFrame(raf);
            observer?.disconnect();
            host.replaceChildren();
        };
    }, [isOpen, effectiveTab, pickerHost]);

    const defaultTrigger = (
        <button
            type="button"
            id="vc-emoji-btn"
            className="vc-icon-btn"
            aria-label="表情"
            aria-haspopup="dialog"
        >
            <Icon name="smile" size={20} />
        </button>
    );

    return (
        <BasePopover.Root
            open={isOpen}
            onOpenChange={(nextOpen, details) => {
                if (!nextOpen && details.reason === 'focus-out') {
                    return;
                }
                if (
                    !nextOpen &&
                    details.reason === 'outside-press' &&
                    popupRef.current &&
                    typeof details.event?.composedPath === 'function' &&
                    details.event.composedPath().includes(popupRef.current)
                ) {
                    return;
                }
                setOpen(nextOpen);
            }}
        >
            <BasePopover.Trigger
                render={(trigger ?? defaultTrigger) as React.ReactElement<Record<string, unknown>>}
            />
            <BasePopover.Portal container={portalContainer}>
                <PortalNestedScope>
                    <BasePopover.Positioner side="top" align="end" sideOffset={8} className="vc-popover__positioner">
                        <BasePopover.Popup
                            ref={popupRef}
                            id="vc-emoji-panel"
                            className="vc-popover vc-glass vc-emoji-panel"
                            aria-label="表情"
                            initialFocus={effectiveTab === 'sticker' ? stickerSearchInputRef : undefined}
                        >
                            {mode !== 'react' ? (
                                <Tabs
                                    className="vc-emoji-segment"
                                    value={tab}
                                    onValueChange={val => setTab(val as 'emoji' | 'sticker')}
                                    tabs={[
                                        { value: 'emoji', label: '表情' },
                                        { value: 'sticker', label: '贴纸' },
                                    ]}
                                />
                            ) : null}
                            {effectiveTab === 'emoji' ? (
                                <div
                                    ref={setPickerHost}
                                    className="vc-emoji-mart-host"
                                    data-vc-emoji-mart=""
                                />
                            ) : (
                                <>
                                    <input
                                        ref={stickerSearchInputRef}
                                        type="search"
                                        className="vc-emoji-search"
                                        placeholder="搜索贴纸"
                                        aria-label="搜索贴纸"
                                        value={stickerQuery}
                                        onChange={e => setStickerQuery(e.target.value)}
                                    />
                                    <div className="vc-emoji-body">
                                        {stickerGroups.some(g => g.items.length > 0) ? (
                                            stickerGroups.map((group, gIdx) => (
                                                <section key={gIdx}>
                                                    {group.title ? <h3>{group.title}</h3> : null}
                                                    <div className="vc-emoji-grid">
                                                        {group.items.map(item => (
                                                            <button
                                                                key={`${item.kind}:${item.value}`}
                                                                type="button"
                                                                className="vc-emoji-cell is-sticker"
                                                                aria-label={item.label}
                                                                data-k={item.kind}
                                                                data-v={item.value}
                                                                onClick={() => handlePickSticker(item)}
                                                            >
                                                                {item.src ? (
                                                                    <img src={item.src} alt="" draggable={false} />
                                                                ) : (
                                                                    item.text
                                                                )}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </section>
                                            ))
                                        ) : (
                                            <p className="vc-emoji-none">没有找到</p>
                                        )}
                                    </div>
                                </>
                            )}
                        </BasePopover.Popup>
                    </BasePopover.Positioner>
                </PortalNestedScope>
            </BasePopover.Portal>
        </BasePopover.Root>
    );
}
