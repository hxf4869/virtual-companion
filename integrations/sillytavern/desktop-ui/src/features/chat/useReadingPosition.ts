import { useCallback, useEffect, useRef, useState } from 'react';
import {
    ATTACH_PX,
    CHIP_HIDE_MS,
    FLASH_MS,
    LAND_MS,
    LAND_OFFSET,
    RESTORE_FRAMES,
    READ_DWELL_MS,
    UNREAD_OFFSET,
    anchorDelta,
    badgeText,
    centerTop,
    gapLabel,
    landingTop,
    latestLabel,
    latestVisible,
    nextFollow,
    nextRead,
    parseSendDate,
    posKey,
    readKey,
    readStoredNumber,
    scrollDuration,
    shouldLand,
    unreadInfo,
    writeStoredNumber,
} from '../../../../extension/vc-model-settings/chat-logic.js';
import { useReducedMotion } from '../../shell/useReducedMotion';
import type { ChatMessage } from '../../runtime/session-bridge';

export interface ReadingPositionOptions {
    chatRef: React.RefObject<HTMLDivElement | null>;
    chatStorageId: string;
    status: string;
    busy: boolean;
    messages: readonly ChatMessage[];
    autoFollow?: boolean;
}

export interface ReadingPositionController {
    latestShown: boolean;
    latestAriaLabel: string;
    unreadBadgeText: string;
    dateChipText: string;
    dateChipVisible: boolean;
    goLatest: (opts?: { instant?: boolean }) => void;
    capturePrependAnchor: () => void;
    notifySent: () => void;
    jumpToMessage: (mesid: number, opts?: { highlight?: boolean }) => boolean;
}

const SCROLL_KEYS = new Set([
    'PageUp',
    'PageDown',
    'Home',
    'End',
    'ArrowUp',
    'ArrowDown',
    ' ',
]);

function toMesId(value: string | null): number | null {
    if (value === null || value.trim() === '') return null;
    const n = Number(value);
    return Number.isInteger(n) && n >= 0 ? n : null;
}

export function useReadingPosition({
    chatRef,
    chatStorageId,
    status,
    busy,
    messages,
    autoFollow = true,
}: ReadingPositionOptions): ReadingPositionController {
    const reducedMotion = useReducedMotion();
    const reducedRef = useRef(reducedMotion);
    reducedRef.current = reducedMotion;

    const autoFollowRef = useRef(autoFollow);
    autoFollowRef.current = autoFollow;

    const messagesRef = useRef(messages);
    messagesRef.current = messages;

    const chatStorageIdRef = useRef(chatStorageId);
    chatStorageIdRef.current = chatStorageId;

    const [latestShown, setLatestShown] = useState(false);
    const [latestAriaLabel, setLatestAriaLabel] = useState(() => latestLabel(0));
    const [unreadBadgeText, setUnreadBadgeText] = useState('');
    const [dateChipText, setDateChipText] = useState('');
    const [dateChipVisible, setDateChipVisible] = useState(false);

    const stateRef = useRef<'follow' | 'detached'>('follow');
    const attachedRef = useRef(true);
    const holdingRef = useRef(false);
    const explicitRef = useRef(false);
    const glideTokenRef = useRef<object | null>(null);
    const openTokenRef = useRef<object | null>(null);
    const lastTopRef = useRef(0);
    const lastInputRef = useRef(-1e9);
    const programTopRef = useRef<number | null>(null);
    const lastReadRef = useRef<number | null>(null);
    const openReadRef = useRef<number | null>(null);
    const dividerIdRef = useRef<number | null>(null);
    const anchorRef = useRef<{ el: HTMLElement; id: number; off: number } | null>(null);
    const wasBusyRef = useRef(false);

    const readTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const posTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const chipTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const flashTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const followFrameRef = useRef<number>(0);

    const isConversationVisible = useCallback(() => {
        const chat = chatRef.current;
        if (!chat || chat.closest('[hidden]')) return false;
        const shell = document.getElementById('vc-shell');
        if (!shell) return true;
        return (
            shell.dataset.destination === 'chat' &&
            shell.dataset.settings !== 'open'
        );
    }, [chatRef]);

    const getRows = useCallback(() => {
        const chat = chatRef.current;
        if (!chat) return [];
        const result: Array<{
            el: HTMLElement;
            id: number;
            user: boolean;
            system: boolean;
        }> = [];
        for (const child of Array.from(chat.children)) {
            if (!(child instanceof HTMLElement) || !child.classList.contains('mes')) continue;
            const id = toMesId(child.getAttribute('mesid'));
            if (id === null) continue;
            result.push({
                el: child,
                id,
                user: child.getAttribute('is_user') === 'true',
                system: child.getAttribute('is_system') === 'true',
            });
        }
        return result;
    }, [chatRef]);

    const getById = useCallback(
        (id: number): HTMLElement | null => {
            return getRows().find(r => r.id === Number(id))?.el ?? null;
        },
        [getRows],
    );

    const getGap = useCallback(() => {
        const chat = chatRef.current;
        if (!chat) return 0;
        return (
            (Number(chat.scrollHeight) || 0) -
            (Number(chat.scrollTop) || 0) -
            (Number(chat.clientHeight) || 0)
        );
    }, [chatRef]);

    const getMaxTop = useCallback(() => {
        const chat = chatRef.current;
        if (!chat) return 0;
        return Math.max(
            0,
            (Number(chat.scrollHeight) || 0) - (Number(chat.clientHeight) || 0),
        );
    }, [chatRef]);

    const firstVisibleRow = useCallback(() => {
        const chat = chatRef.current;
        if (!chat) return null;
        const top = chat.getBoundingClientRect().top;
        return (
            getRows().find(
                r => !r.system && r.el.getBoundingClientRect().bottom > top + 8,
            ) ?? null
        );
    }, [chatRef, getRows]);

    const recordAnchor = useCallback(() => {
        const chat = chatRef.current;
        if (!chat) return;
        const first = firstVisibleRow();
        anchorRef.current = first
            ? {
                  el: first.el,
                  id: first.id,
                  off: first.el.getBoundingClientRect().top - chat.getBoundingClientRect().top,
              }
            : null;
    }, [chatRef, firstVisibleRow]);

    const refreshLatestState = useCallback(() => {
        const show = latestVisible(getGap());
        const count = show ? unreadInfo(lastReadRef.current, getRows()).count : 0;
        const text = badgeText(count);
        setLatestShown(show);
        setLatestAriaLabel(latestLabel(count));
        setUnreadBadgeText(text);
    }, [getGap, getRows]);

    const applyDivider = useCallback(() => {
        const divId = dividerIdRef.current;
        for (const r of getRows()) {
            const want = divId !== null && r.id === divId;
            if (want) {
                if (!r.el.hasAttribute('data-vc-unread')) {
                    r.el.setAttribute('data-vc-unread', '');
                }
            } else if (r.el.hasAttribute('data-vc-unread')) {
                r.el.removeAttribute('data-vc-unread');
            }
        }
    }, [getRows]);

    const scheduleFollowScroll = useCallback(() => {
        const chat = chatRef.current;
        if (!chat || followFrameRef.current) return;
        followFrameRef.current = window.requestAnimationFrame(() => {
            followFrameRef.current = 0;
            const currentChat = chatRef.current;
            if (!currentChat) return;
            if (
                attachedRef.current &&
                !holdingRef.current &&
                (autoFollowRef.current || explicitRef.current)
            ) {
                currentChat.scrollTop = currentChat.scrollHeight;
            }
            explicitRef.current = false;
            refreshLatestState();
        });
    }, [chatRef, refreshLatestState]);

    const releaseHold = useCallback(() => {
        glideTokenRef.current = null;
        holdingRef.current = false;
    }, []);

    const glide = useCallback(
        ({
            target,
            duration,
            hold = 0,
            onDone,
        }: {
            target: () => number;
            duration: number;
            hold?: number;
            onDone?: () => void;
        }) => {
            const chat = chatRef.current;
            if (!chat) return;
            const token = {};
            glideTokenRef.current = token;
            holdingRef.current = true;
            const from = Number(chat.scrollTop) || 0;
            const started = performance.now();
            const dur = reducedRef.current ? 0 : duration;
            const end = started + Math.max(dur, hold);

            const tick = () => {
                if (glideTokenRef.current !== token) return;
                const currentChat = chatRef.current;
                if (!currentChat) return;
                const to = Math.min(Math.max(0, target()), getMaxTop());
                const p = dur <= 0 ? 1 : Math.min(1, (performance.now() - started) / dur);
                const pos = p >= 1 ? to : from + (to - from) * (1 - (1 - p) ** 3);
                if (Math.abs((Number(currentChat.scrollTop) || 0) - pos) > 0.5) {
                    currentChat.scrollTop = pos;
                }
                if (p < 1 || performance.now() < end) {
                    window.requestAnimationFrame(tick);
                    return;
                }
                releaseHold();
                onDone?.();
            };
            tick();
        },
        [chatRef, getMaxTop, releaseHold],
    );

    const goLatest = useCallback(
        ({ instant = false }: { instant?: boolean } = {}) => {
            const chat = chatRef.current;
            if (!chat) return;
            openTokenRef.current = null;
            releaseHold();
            stateRef.current = 'follow';
            attachedRef.current = true;
            if (chatStorageIdRef.current) {
                writeStoredNumber(posKey(chatStorageIdRef.current), null);
            }
            const distance = getMaxTop() - (Number(chat.scrollTop) || 0);
            glide({
                target: getMaxTop,
                duration: instant ? 0 : scrollDuration(distance),
                onDone: () => {
                    attachedRef.current = true;
                    const currentChat = chatRef.current;
                    if (currentChat && !holdingRef.current && getGap() > 1) {
                        currentChat.scrollTop = getMaxTop();
                    }
                    refreshLatestState();
                },
            });
        },
        [chatRef, getGap, getMaxTop, glide, refreshLatestState, releaseHold],
    );

    const notifySent = useCallback(() => {
        openTokenRef.current = null;
        releaseHold();
        stateRef.current = 'follow';
        attachedRef.current = true;
        explicitRef.current = true;
        scheduleFollowScroll();
    }, [releaseHold, scheduleFollowScroll]);

    const jumpToMessage = useCallback(
        (mesid: number, { highlight = true }: { highlight?: boolean } = {}): boolean => {
            const chat = chatRef.current;
            const mes = getById(mesid);
            if (!chat || !mes) return false;
            openTokenRef.current = null;
            releaseHold();
            stateRef.current = 'detached';
            attachedRef.current = false;

            const target = () =>
                centerTop({
                    chatTop: chat.getBoundingClientRect().top,
                    mesTop: mes.getBoundingClientRect().top,
                    mesHeight: mes.getBoundingClientRect().height,
                    viewHeight: chat.clientHeight,
                    scrollTop: Number(chat.scrollTop) || 0,
                    max: getMaxTop(),
                });
            const distance = Math.abs(target() - (Number(chat.scrollTop) || 0));
            glide({
                target,
                duration: scrollDuration(distance),
                onDone: () => {
                    recordAnchor();
                    refreshLatestState();
                },
            });

            if (highlight) {
                for (const other of Array.from(
                    chat.querySelectorAll(':scope > .mes[data-vc-flash]'),
                )) {
                    other.removeAttribute('data-vc-flash');
                }
                mes.setAttribute('data-vc-flash', '');
                if (flashTimerRef.current !== undefined) clearTimeout(flashTimerRef.current);
                flashTimerRef.current = setTimeout(() => {
                    mes.removeAttribute('data-vc-flash');
                }, FLASH_MS);
            }
            return true;
        },
        [chatRef, getById, getMaxTop, glide, recordAnchor, refreshLatestState, releaseHold],
    );

    // Open / restore reading position when conversation becomes ready
    useEffect(() => {
        if (status !== 'ready' || !chatStorageId) return undefined;
        const chat = chatRef.current;
        if (!chat) return undefined;

        if (posTimerRef.current !== undefined) clearTimeout(posTimerRef.current);
        dividerIdRef.current = null;
        stateRef.current = 'follow';
        attachedRef.current = true;
        anchorRef.current = null;

        const savedRead = readStoredNumber(readKey(chatStorageId));
        lastReadRef.current = savedRead;
        openReadRef.current = savedRead;

        const token = {};
        openTokenRef.current = token;
        holdingRef.current = true;
        let frames = 0;

        const decide = () => {
            if (openTokenRef.current !== token) return;
            const currentChat = chatRef.current;
            if (!currentChat) return;
            const list = getRows();
            frames += 1;
            if (!list.length || (Number(currentChat.clientHeight) || 0) < 48) {
                if (frames < RESTORE_FRAMES) {
                    window.requestAnimationFrame(decide);
                    return;
                }
                holdingRef.current = false;
                openTokenRef.current = null;
                scheduleFollowScroll();
                return;
            }

            const lastId = list[list.length - 1].id;
            let targetId: number | null = null;
            let offset = LAND_OFFSET;

            if (openReadRef.current === null) {
                lastReadRef.current = lastId;
                writeStoredNumber(readKey(chatStorageId), lastId);
            } else {
                const info = unreadInfo(openReadRef.current, list);
                if (info.first !== null) {
                    dividerIdRef.current = info.first;
                    targetId = info.first;
                    offset = UNREAD_OFFSET;
                } else {
                    const savedPos = readStoredNumber(posKey(chatStorageId));
                    if (savedPos !== null && list.some(r => r.id === savedPos)) {
                        targetId = savedPos;
                    }
                }
            }

            applyDivider();

            if (targetId === null) {
                holdingRef.current = false;
                openTokenRef.current = null;
                attachedRef.current = true;
                scheduleFollowScroll();
                return;
            }

            let stable = 0;
            let used = 0;
            const place = () => {
                if (openTokenRef.current !== token) return;
                const el = getById(targetId!);
                const hostEl = chatRef.current;
                if (!hostEl) return;
                used += 1;
                if (el) {
                    const want = landingTop({
                        chatTop: hostEl.getBoundingClientRect().top,
                        mesTop: el.getBoundingClientRect().top,
                        scrollTop: Number(hostEl.scrollTop) || 0,
                        offset,
                    });
                    const to = Math.min(want, getMaxTop());
                    if (Math.abs((Number(hostEl.scrollTop) || 0) - to) > 1) {
                        hostEl.scrollTop = to;
                        stable = 0;
                    } else {
                        stable += 1;
                    }
                }
                if (stable >= 3 || used >= RESTORE_FRAMES) {
                    holdingRef.current = false;
                    openTokenRef.current = null;
                    stateRef.current = 'detached';
                    attachedRef.current = false;
                    recordAnchor();
                    refreshLatestState();
                    return;
                }
                window.requestAnimationFrame(place);
            };
            place();
        };

        window.requestAnimationFrame(decide);
        return () => {
            if (openTokenRef.current === token) {
                openTokenRef.current = null;
                holdingRef.current = false;
            }
        };
    }, [
        applyDivider,
        chatRef,
        chatStorageId,
        getById,
        getMaxTop,
        getRows,
        recordAnchor,
        refreshLatestState,
        scheduleFollowScroll,
        status,
    ]);

    // Update scroll when messages or busy state changes
    useEffect(() => {
        applyDivider();
        refreshLatestState();
        const lastIdx = messages.length - 1;
        if (wasBusyRef.current && !busy && stateRef.current === 'follow' && lastIdx >= 0) {
            window.requestAnimationFrame(() => {
                const chat = chatRef.current;
                const mes = getById(lastIdx);
                if (!chat || !mes || mes.getAttribute('is_user') === 'true') return;
                const list = getRows();
                if (list[list.length - 1]?.el !== mes) return;
                if (
                    !shouldLand({
                        following: stateRef.current === 'follow',
                        mesHeight: mes.getBoundingClientRect().height,
                        viewHeight: chat.clientHeight,
                    })
                ) {
                    return;
                }
                const target = () =>
                    landingTop({
                        chatTop: chat.getBoundingClientRect().top,
                        mesTop: mes.getBoundingClientRect().top,
                        scrollTop: Number(chat.scrollTop) || 0,
                        offset: LAND_OFFSET,
                    });
                glide({
                    target,
                    duration: scrollDuration(Math.abs(target() - (Number(chat.scrollTop) || 0))),
                    hold: LAND_MS,
                    onDone: () => {
                        stateRef.current = 'detached';
                        attachedRef.current = false;
                        refreshLatestState();
                    },
                });
            });
        }
        wasBusyRef.current = busy;
        scheduleFollowScroll();
    }, [
        applyDivider,
        busy,
        chatRef,
        getById,
        getRows,
        glide,
        messages.length,
        messages.at(-1)?.mes,
        refreshLatestState,
        scheduleFollowScroll,
    ]);

    // Attach DOM listeners & observers on #chat
    useEffect(() => {
        const chat = chatRef.current;
        if (!chat) return undefined;

        let width = chat.clientWidth;
        let height = chat.clientHeight;
        let dragging = false;
        let scrollFrame = 0;

        const markInput = () => {
            programTopRef.current = null;
            lastInputRef.current = performance.now();
            if (holdingRef.current) {
                releaseHold();
                openTokenRef.current = null;
            }
        };

        const scheduleRead = () => {
            if (readTimerRef.current !== undefined) clearTimeout(readTimerRef.current);
            readTimerRef.current = setTimeout(() => {
                const storageId = chatStorageIdRef.current;
                if (
                    !isConversationVisible() ||
                    document.hidden ||
                    holdingRef.current ||
                    !storageId
                ) {
                    return;
                }
                const box = chat.getBoundingClientRect();
                let bottomId: number | null = null;
                for (const r of getRows()) {
                    const rect = r.el.getBoundingClientRect();
                    if (rect.top < box.bottom - 8 && rect.bottom > box.top) {
                        bottomId = r.id;
                    }
                }
                const next = nextRead(lastReadRef.current, bottomId);
                if (next !== lastReadRef.current) {
                    lastReadRef.current = next;
                    writeStoredNumber(readKey(storageId), next);
                    refreshLatestState();
                }
            }, READ_DWELL_MS);
        };

        const schedulePos = () => {
            if (posTimerRef.current !== undefined) clearTimeout(posTimerRef.current);
            posTimerRef.current = setTimeout(() => {
                const storageId = chatStorageIdRef.current;
                if (!isConversationVisible() || holdingRef.current || !storageId) return;
                if (getGap() <= ATTACH_PX) {
                    writeStoredNumber(posKey(storageId), null);
                    return;
                }
                const first = firstVisibleRow();
                if (first) {
                    writeStoredNumber(posKey(storageId), first.id);
                }
            }, 300);
        };

        const showDateChip = () => {
            if (getGap() <= ATTACH_PX) return;
            const first = firstVisibleRow();
            const ms = first
                ? parseSendDate(messagesRef.current[first.id]?.send_date)
                : null;
            const label = ms !== null ? gapLabel(ms) : '';
            if (!label) return;
            setDateChipText(label);
            setDateChipVisible(true);
            if (chipTimerRef.current !== undefined) clearTimeout(chipTimerRef.current);
            chipTimerRef.current = setTimeout(() => {
                setDateChipVisible(false);
            }, CHIP_HIDE_MS);
        };

        const onScrollTick = () => {
            scrollFrame = 0;
            if (!isConversationVisible()) return;
            const top = Number(chat.scrollTop) || 0;
            const user = performance.now() - lastInputRef.current < 250;
            if (user) {
                const prev = stateRef.current;
                const next = nextFollow(stateRef.current, {
                    type: 'user-scroll',
                    up: top < lastTopRef.current,
                    gap: getGap(),
                });
                stateRef.current = next;
                if (prev !== next) {
                    attachedRef.current = next === 'follow';
                    if (attachedRef.current) scheduleFollowScroll();
                }
            }
            lastTopRef.current = top;
            refreshLatestState();
            if (!holdingRef.current) {
                if (user || !anchorRef.current) recordAnchor();
                showDateChip();
                scheduleRead();
                schedulePos();
            }
        };

        const onScroll = () => {
            if (width !== chat.clientWidth || height !== chat.clientHeight) {
                width = chat.clientWidth;
                height = chat.clientHeight;
                lastInputRef.current = -1e9;
            }
            const top = Number(chat.scrollTop) || 0;
            if (
                programTopRef.current !== null &&
                Math.abs(top - programTopRef.current) < 1
            ) {
                lastInputRef.current = -1e9;
                programTopRef.current = null;
            }
            if (performance.now() - lastInputRef.current < 250) {
                const prev = stateRef.current;
                const next = nextFollow(stateRef.current, {
                    type: 'user-scroll',
                    up: top < lastTopRef.current,
                    gap: getGap(),
                });
                stateRef.current = next;
                if (prev !== next) {
                    attachedRef.current = next === 'follow';
                    if (attachedRef.current) scheduleFollowScroll();
                }
            }
            lastTopRef.current = top;
            if (!scrollFrame) {
                scrollFrame = window.requestAnimationFrame(onScrollTick);
            }
        };

        const onPointerDown = (e: PointerEvent) => {
            if (e.target === chat) {
                dragging = true;
                markInput();
            }
        };
        const onPointerMove = () => {
            if (dragging) markInput();
        };
        const onPointerEnd = () => {
            dragging = false;
        };

        const onKeyDown = (e: KeyboardEvent) => {
            if (!SCROLL_KEYS.has(e.key) || e.metaKey || e.ctrlKey || e.altKey) return;
            const target = e.target as HTMLElement | null;
            const tag = target?.tagName;
            if (tag === 'TEXTAREA' || tag === 'INPUT' || target?.isContentEditable) return;
            markInput();
            if (
                e.key === 'End' &&
                isConversationVisible() &&
                (document.activeElement === chat || chat.contains(document.activeElement))
            ) {
                e.preventDefault();
                goLatest({ instant: true });
            }
        };

        const compensateLayout = () => {
            if (stateRef.current !== 'detached' || holdingRef.current || !anchorRef.current) {
                return;
            }
            if (!anchorRef.current.el.isConnected) {
                const found = getById(anchorRef.current.id);
                if (!found) return;
                anchorRef.current.el = found;
            }
            const off =
                anchorRef.current.el.getBoundingClientRect().top -
                chat.getBoundingClientRect().top;
            const delta = anchorDelta(anchorRef.current.off, off);
            if (Math.abs(delta) > 0.5) {
                chat.scrollTop += delta;
                programTopRef.current = chat.scrollTop;
            }
        };

        const mutationObserver =
            typeof MutationObserver === 'function'
                ? new MutationObserver(records => {
                      const anchor = anchorRef.current;
                      if (anchor && anchor.el.isConnected && !holdingRef.current) {
                          const prepended = records.some(rec =>
                              Array.from(rec.addedNodes).some(
                                  n =>
                                      n instanceof HTMLElement &&
                                      n.classList.contains('mes') &&
                                      Boolean(n.compareDocumentPosition(anchor.el) & 4),
                              ),
                          );
                          if (prepended) {
                              const off =
                                  anchor.el.getBoundingClientRect().top -
                                  chat.getBoundingClientRect().top;
                              const delta = anchorDelta(anchor.off, off);
                              if (Math.abs(delta) > 0.5) {
                                  chat.scrollTop = (Number(chat.scrollTop) || 0) + delta;
                                  programTopRef.current = chat.scrollTop;
                              }
                          }
                      }
                      applyDivider();
                      refreshLatestState();
                      scheduleRead();
                      if (!holdingRef.current && !anchorRef.current) {
                          recordAnchor();
                      }
                      scheduleFollowScroll();
                  })
                : null;

        mutationObserver?.observe(chat, {
            childList: true,
            subtree: true,
            characterData: true,
        });

        const resizeObserver =
            typeof ResizeObserver === 'function'
                ? new ResizeObserver(() => {
                      compensateLayout();
                      scheduleFollowScroll();
                  })
                : null;
        resizeObserver?.observe(chat);

        const onWindowResize = () => {
            lastInputRef.current = -1e9;
            scheduleFollowScroll();
        };

        chat.addEventListener('wheel', markInput, { passive: true });
        chat.addEventListener('touchmove', markInput, { passive: true });
        chat.addEventListener('pointerdown', onPointerDown);
        chat.addEventListener('pointermove', onPointerMove);
        chat.addEventListener('pointerup', onPointerEnd);
        chat.addEventListener('pointercancel', onPointerEnd);
        chat.addEventListener('scroll', onScroll);
        document.addEventListener('keydown', onKeyDown, { capture: true });
        window.addEventListener('resize', onWindowResize);

        return () => {
            mutationObserver?.disconnect();
            resizeObserver?.disconnect();
            if (scrollFrame) window.cancelAnimationFrame(scrollFrame);
            if (followFrameRef.current) {
                window.cancelAnimationFrame(followFrameRef.current);
                followFrameRef.current = 0;
            }
            for (const timer of [
                readTimerRef.current,
                posTimerRef.current,
                chipTimerRef.current,
                flashTimerRef.current,
            ]) {
                if (timer !== undefined) clearTimeout(timer);
            }
            chat.removeEventListener('wheel', markInput);
            chat.removeEventListener('touchmove', markInput);
            chat.removeEventListener('pointerdown', onPointerDown);
            chat.removeEventListener('pointermove', onPointerMove);
            chat.removeEventListener('pointerup', onPointerEnd);
            chat.removeEventListener('pointercancel', onPointerEnd);
            chat.removeEventListener('scroll', onScroll);
            document.removeEventListener('keydown', onKeyDown, { capture: true });
            window.removeEventListener('resize', onWindowResize);
        };
    }, [
        applyDivider,
        chatRef,
        firstVisibleRow,
        getById,
        getGap,
        getRows,
        goLatest,
        isConversationVisible,
        recordAnchor,
        refreshLatestState,
        releaseHold,
        scheduleFollowScroll,
    ]);

    return {
        latestShown,
        latestAriaLabel,
        unreadBadgeText,
        dateChipText,
        dateChipVisible,
        goLatest,
        capturePrependAnchor: recordAnchor,
        notifySent,
        jumpToMessage,
    };
}
