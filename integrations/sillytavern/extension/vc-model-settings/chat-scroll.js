// UX-24 桌面聊天滚动与阅读：跟随 / 脱离、长回复落地、回到最新、历史锚定、新消息分割线、阅读位置、浮动日期、跳转高亮。
// 不改宿主 #chat 结构：标记只写在 .mes 的 data-vc-* 上，浮层（回到最新、日期胶囊）放在 #chat 外。
import { icon } from './ui/icons.js';
import { prefersReducedMotion } from './ui/motion.js';
import {
    ATTACH_PX,
    LATEST_PX,
    LAND_OFFSET,
    LAND_MS,
    READ_DWELL_MS,
    RESTORE_FRAMES,
    CHIP_HIDE_MS,
    FLASH_MS,
    UNREAD_OFFSET,
    nextFollow,
    latestVisible,
    badgeText,
    latestLabel,
    landingTop,
    shouldLand,
    centerTop,
    scrollDuration,
    nextRead,
    unreadInfo,
    anchorDelta,
    readKey,
    posKey,
    readStoredNumber,
    writeStoredNumber,
} from './chat-logic.js';

export {
    ATTACH_PX,
    LATEST_PX,
    LAND_OFFSET,
    LAND_MS,
    READ_DWELL_MS,
    RESTORE_FRAMES,
    CHIP_HIDE_MS,
    FLASH_MS,
    UNREAD_OFFSET,
    nextFollow,
    latestVisible,
    badgeText,
    latestLabel,
    landingTop,
    shouldLand,
    centerTop,
    scrollDuration,
    nextRead,
    unreadInfo,
    anchorDelta,
    readKey,
    posKey,
    readStoredNumber,
    writeStoredNumber,
};

/** 独立桌面的跟随端口；沿用上面的用户滚动规则，异步HTML/iframe增长不改变阅读状态。 */
export function mountDesktopFollow(chat, { floatingHost, getChatId = () => '', dateLabel = () => '', getAutoFollow = () => true } = {}) {
    const view = chat.ownerDocument.defaultView;
    let attached = true, frame = 0, wasBusy = false, dead = false, explicit = false;
    const schedule = () => {
        if (dead || frame) return;
        frame = view.requestAnimationFrame(() => {
            frame = 0;
            const host = chat.parentElement;
            host.style.setProperty('--vc-composer-h', `${Math.max(0, host.getBoundingClientRect().bottom - chat.getBoundingClientRect().bottom)}px`);
            if (attached && !api.holding() && (getAutoFollow() || explicit)) chat.scrollTop = chat.scrollHeight;
            explicit=false;
        });
    };
    const api = mountChatScroll({ chat, doc: chat.ownerDocument, overlayHost: floatingHost,
        hooks: { isDesktop: () => true, attach() { attached = true; schedule(); }, detach() { attached = false; }, getChatId, dateLabel } });
    const resize = new view.ResizeObserver(() => { api.layout(); schedule(); });
    const observe = () => { resize.disconnect(); resize.observe(chat); for (const node of chat.children) resize.observe(node); schedule(); };
    const mutation = new view.MutationObserver(observe);
    mutation.observe(chat, { childList: true, subtree: true, characterData: true }); observe();
    view.addEventListener('resize', schedule);
    return { beforeHistory() { api.captureAnchor(); }, open() { api.openChat(); schedule(); }, sent() { explicit=true;api.sent(); attached = true; schedule(); },
        update(state = {}) { api.refresh(); if (wasBusy && !state.busy) api.replyRendered(state.lastIndex); wasBusy = Boolean(state.busy); schedule(); },
        destroy() { dead = true; resize.disconnect(); mutation.disconnect(); view.cancelAnimationFrame(frame); view.removeEventListener('resize', schedule); api.destroy(); } };
}

const readNumber = readStoredNumber;
const writeNumber = writeStoredNumber;

const nowMs = () => (typeof globalThis.performance?.now === 'function' ? globalThis.performance.now() : Date.now());
const raf = (fn) => (typeof globalThis.requestAnimationFrame === 'function' ? globalThis.requestAnimationFrame(fn) : setTimeout(fn, 16));
const toId = (value) => {
    const n = Number(value);
    return Number.isInteger(n) && n >= 0 && String(value).trim() !== '' ? n : null;
};

let active = null;

/** 供引用、搜索、记忆来源调用：滚到某条消息并高亮。未挂载（手机或未打开）时返回 false。 */
export function jumpToMessage(mesid, options) {
    return active ? active.jump(mesid, options) : false;
}
export const highlightMessage = jumpToMessage;

export function mountChatScroll({ chat, doc = document, hooks, overlayHost }) {
    if (!chat || active) return active;
    const listeners = new AbortController();
    const listen = (target, name, fn, options = {}) => target.addEventListener(name, fn, { ...options, signal: listeners.signal });
    let observer;
    const desktop = () => hooks.isDesktop();
    const conversationVisible = () => {
        const shell = doc.querySelector('#vc-shell');
        return shell?.dataset.chat === 'open' && shell.dataset.destination === 'chat' && shell.dataset.settings !== 'page';
    };
    let state = 'follow';
    let lastTop = Number(chat.scrollTop) || 0;
    let lastInput = -1e9;
    let dragging = false;
    let holding = false;
    let glideToken = null;
    let chatId = '';
    let lastRead = null;
    let openRead = null;
    let dividerId = null;
    let anchor = null;
    let nodes = null;
    let scrollFrame = 0;
    let readTimer = 0;
    let posTimer = 0;
    let chipTimer = 0;
    let flashTimer = 0;
    let openToken = null, programTop = null, width = chat.clientWidth, height = chat.clientHeight;

    const gap = () => (Number(chat.scrollHeight) || 0) - (Number(chat.scrollTop) || 0) - (Number(chat.clientHeight) || 0);
    const maxTop = () => Math.max(0, (Number(chat.scrollHeight) || 0) - (Number(chat.clientHeight) || 0));
    const rows = () => [...chat.children].filter((n) => n.classList?.contains('mes'))
        .map((el) => ({ el, id: toId(el.getAttribute('mesid')), user: el.getAttribute('is_user') === 'true', system: el.getAttribute('is_system') === 'true' }))
        .filter((r) => r.id !== null);
    const byId = (id) => rows().find((r) => r.id === Number(id))?.el || null;

    function ensureNodes() {
        if (nodes) return nodes;
        const parent = overlayHost || chat.parentElement;
        if (!parent) return null;
        const latest = doc.createElement('button');
        latest.id = 'vc-latest';
        latest.type = 'button';
        latest.className = 'vc-glass';
        latest.hidden = true;
        latest.setAttribute('aria-label', latestLabel(0));
        latest.innerHTML = `${icon('arrow-down', { size: 18 })}<span class="vc-latest-count" hidden></span>`;
        listen(latest, 'click', goLatest);
        const chip = doc.createElement('div');
        chip.id = 'vc-date-chip';
        chip.setAttribute('aria-hidden', 'true');
        parent.append(latest, chip);
        nodes = { latest, chip, count: latest.querySelector('.vc-latest-count') };
        return nodes;
    }

    // ---- 程序滚动：目标可随布局变化，用户一操作即放手 ----
    function releaseHold() {
        glideToken = null;
        holding = false;
    }
    function glide({ target, duration, hold = 0, onDone }) {
        const token = {};
        glideToken = token;
        holding = true;
        const from = Number(chat.scrollTop) || 0;
        const started = nowMs();
        const dur = prefersReducedMotion() ? 0 : duration;
        const end = started + Math.max(dur, hold);
        const tick = () => {
            if (glideToken !== token) return;
            const to = Math.min(Math.max(0, target()), maxTop());
            const p = dur <= 0 ? 1 : Math.min(1, (nowMs() - started) / dur);
            const pos = p >= 1 ? to : from + (to - from) * (1 - (1 - p) ** 3);
            if (Math.abs((Number(chat.scrollTop) || 0) - pos) > 0.5) chat.scrollTop = pos;
            if (p < 1 || nowMs() < end) { raf(tick); return; }
            releaseHold();
            onDone?.();
        };
        tick();
    }

    function markInput() {
        programTop = null;
        lastInput = nowMs();
        if (holding) { releaseHold(); openToken = null; }
    }

    function setDetached() {
        if (state === 'detached') return;
        state = 'detached';
        hooks.detach();
    }

    // ---- 回到最新 ----
    function goLatest({ instant = false } = {}) {
        openToken = null; releaseHold();
        state = 'follow';
        const distance = maxTop() - (Number(chat.scrollTop) || 0);
        glide({
            target: maxTop,
            duration: instant ? 0 : scrollDuration(distance),
            onDone: () => {
                hooks.attach();
                const settle = () => { if (!holding && gap() > 1) chat.scrollTop = maxTop(); };
                if ('onscrollend' in chat) listen(chat, 'scrollend', settle, { once: true });
                setTimeout(settle, 120);
            },
        });
    }

    function unreadCount() {
        return unreadInfo(lastRead, rows()).count;
    }

    function refreshLatest() {
        if (!desktop()) {
            if (nodes) { nodes.latest.hidden = true; nodes.chip.hidden = true; }
            return;
        }
        const n = ensureNodes();
        if (!n) return;
        n.chip.hidden = false;
        const show = latestVisible(gap());
        const count = show ? unreadCount() : 0;
        const text = badgeText(count);
        n.latest.hidden = !show;
        n.latest.setAttribute('aria-label', latestLabel(count));
        n.count.textContent = text;
        n.count.hidden = !text;
    }

    // ---- 浮动日期 ----
    function firstVisible() {
        const top = chat.getBoundingClientRect().top;
        return rows().find((r) => !r.system && r.el.getBoundingClientRect().bottom > top + 8) || null;
    }
    function showChip() {
        if (!desktop() || gap() <= ATTACH_PX) return;
        const n = ensureNodes();
        const first = firstVisible();
        const label = first ? hooks.dateLabel(first.id) : '';
        if (!n || !label) return;
        const box = chat.getBoundingClientRect();
        const host = chat.parentElement.getBoundingClientRect();
        n.chip.textContent = label;
        n.chip.style.left = `${box.left - host.left + box.width / 2}px`;
        n.chip.style.top = `${box.top - host.top}px`;
        n.chip.classList.add('is-on');
        clearTimeout(chipTimer);
        chipTimer = setTimeout(() => n.chip.classList.remove('is-on'), CHIP_HIDE_MS);
    }

    // ---- 已读 / 阅读位置 ----
    function visibleBottomId() {
        const box = chat.getBoundingClientRect();
        let id = null;
        for (const r of rows()) {
            const rect = r.el.getBoundingClientRect();
            if (rect.top < box.bottom - 8 && rect.bottom > box.top) id = r.id;
        }
        return id;
    }
    function scheduleRead() {
        clearTimeout(readTimer);
        readTimer = setTimeout(() => {
            if (!desktop() || !conversationVisible() || doc.hidden || holding || !chatId) return;
            const id = visibleBottomId();
            const next = nextRead(lastRead, id);
            if (next !== lastRead) {
                lastRead = next;
                writeNumber(readKey(chatId), lastRead);
                refreshLatest();
            }
        }, READ_DWELL_MS);
    }
    function schedulePos() {
        clearTimeout(posTimer);
        posTimer = setTimeout(() => {
            if (!desktop() || !conversationVisible() || holding || !chatId) return;
            if (gap() <= ATTACH_PX) { writeNumber(posKey(chatId), null); return; }
            const first = firstVisible();
            if (first) writeNumber(posKey(chatId), first.id);
        }, 300);
    }

    // ---- 分割线 ----
    function applyDivider() {
        for (const r of rows()) {
            const want = dividerId !== null && r.id === dividerId && desktop();
            if (want) { if (!r.el.hasAttribute('data-vc-unread')) r.el.setAttribute('data-vc-unread', ''); }
            else if (r.el.hasAttribute('data-vc-unread')) r.el.removeAttribute('data-vc-unread');
        }
    }

    // ---- 向上加载历史：以视口首条 .mes 为锚 ----
    function recordAnchor() {
        const first = firstVisible();
        anchor = first ? { el: first.el, id: first.id, off: first.el.getBoundingClientRect().top - chat.getBoundingClientRect().top } : null;
    }
    function compensate(records) {
        if (!anchor || !anchor.el.isConnected || holding) return;
        const prepended = records.some((rec) => [...rec.addedNodes].some((n) => n.classList?.contains('mes')
            && (n.compareDocumentPosition(anchor.el) & 4)));
        if (!prepended) return;
        const off = anchor.el.getBoundingClientRect().top - chat.getBoundingClientRect().top;
        const delta = anchorDelta(anchor.off, off);
        if (Math.abs(delta) > 0.5) { chat.scrollTop = (Number(chat.scrollTop) || 0) + delta; programTop = chat.scrollTop; }
    }

    // ---- 打开会话：分割线 > 阅读位置 > 底部（交给宿主的贴底） ----
    function openChat() {
        chatId = String(hooks.getChatId() || '');
        clearTimeout(posTimer);
        dividerId = null;
        state = 'follow';
        anchor = null;
        openToken = null;
        if (!desktop() || !conversationVisible() || !chatId) { releaseHold(); applyDivider(); return; }
        lastRead = readNumber(readKey(chatId));
        openRead = lastRead;
        holding = true;
        const token = {};
        openToken = token;
        let frames = 0;
        const decide = () => {
            if (openToken !== token) return;
            const list = rows();
            frames += 1;
            if (!list.length || (Number(chat.clientHeight) || 0) < 48) {
                if (frames < RESTORE_FRAMES) { raf(decide); return; }
                holding = false; openToken = null; return;
            }
            const last = list[list.length - 1].id;
            let targetId = null;
            let offset = LAND_OFFSET;
            if (openRead === null) {
                lastRead = last;
                writeNumber(readKey(chatId), last);
            } else {
                const info = unreadInfo(openRead, list);
                if (info.first !== null) { dividerId = info.first; targetId = info.first; offset = UNREAD_OFFSET; }
                else {
                    const saved = readNumber(posKey(chatId));
                    if (saved !== null && list.some((r) => r.id === saved)) targetId = saved;
                }
            }
            applyDivider();
            if (targetId === null) { holding = false; openToken = null; hooks.attach(); refreshLatest(); return; }
            // 图片等晚到的内容会改变位置：最多重试 RESTORE_FRAMES 帧，稳定后结束。
            let stable = 0;
            let used = 0;
            const place = () => {
                if (openToken !== token) return;
                const el = byId(targetId);
                used += 1;
                if (el) {
                    const want = landingTop({ chatTop: chat.getBoundingClientRect().top, mesTop: el.getBoundingClientRect().top, scrollTop: Number(chat.scrollTop) || 0, offset });
                    const to = Math.min(want, maxTop());
                    if (Math.abs((Number(chat.scrollTop) || 0) - to) > 1) { chat.scrollTop = to; stable = 0; } else stable += 1;
                }
                if (stable >= 3 || used >= RESTORE_FRAMES) {
                    holding = false; openToken = null;
                    state = 'detached';
                    hooks.detach();
                    recordAnchor();
                    refreshLatest();
                    scheduleRead();
                    return;
                }
                raf(place);
            };
            place();
        };
        raf(decide);
    }

    // ---- 长回复落地 ----
    function replyRendered(index) {
        if (!desktop() || state !== 'follow') return;
        raf(() => {
            const mes = byId(index);
            if (!mes || mes.getAttribute('is_user') === 'true') return;
            const list = rows();
            if (list[list.length - 1]?.el !== mes) return;
            if (!shouldLand({ following: state === 'follow', mesHeight: mes.getBoundingClientRect().height, viewHeight: chat.clientHeight })) return;
            const target = () => landingTop({
                chatTop: chat.getBoundingClientRect().top,
                mesTop: mes.getBoundingClientRect().top,
                scrollTop: Number(chat.scrollTop) || 0,
                offset: LAND_OFFSET,
            });
            glide({
                target,
                duration: scrollDuration(Math.abs(target() - (Number(chat.scrollTop) || 0))),
                hold: LAND_MS,
                onDone: () => { state = 'detached'; hooks.detach(); refreshLatest(); },
            });
        });
    }

    // ---- 跳转高亮 ----
    function flash(mes) {
        for (const other of chat.querySelectorAll(':scope > .mes[data-vc-flash]')) other.removeAttribute('data-vc-flash');
        void mes.offsetWidth;
        mes.setAttribute('data-vc-flash', '');
        clearTimeout(flashTimer);
        flashTimer = setTimeout(() => mes.removeAttribute('data-vc-flash'), FLASH_MS);
    }
    function jump(mesid, { highlight = true } = {}) {
        const mes = byId(mesid);
        if (!mes || !desktop()) return false;
        openToken = null; releaseHold();
        const target = () => centerTop({
            chatTop: chat.getBoundingClientRect().top,
            mesTop: mes.getBoundingClientRect().top,
            mesHeight: mes.getBoundingClientRect().height,
            viewHeight: chat.clientHeight,
            scrollTop: Number(chat.scrollTop) || 0,
            max: maxTop(),
        });
        const distance = Math.abs(target() - (Number(chat.scrollTop) || 0));
        setDetached();
        glide({ target, duration: scrollDuration(distance), onDone: () => { recordAnchor(); refreshLatest(); } });
        if (highlight) flash(mes);
        return true;
    }

    // ---- 事件 ----
    const KEYS = new Set(['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', ' ']);
    listen(chat, 'wheel', markInput, { passive: true });
    listen(chat, 'touchmove', markInput, { passive: true });
    listen(chat, 'pointerdown', (event) => { if (event.target === chat) { dragging = true; markInput(); } });
    listen(chat, 'pointermove', () => { if (dragging) markInput(); });
    const endDrag = () => { dragging = false; };
    listen(chat, 'pointerup', endDrag);
    listen(chat, 'pointercancel', endDrag);
    listen(doc, 'keydown', (event) => {
        if (!KEYS.has(event.key) || event.metaKey || event.ctrlKey || event.altKey) return;
        const tag = event.target?.tagName;
        if (tag === 'TEXTAREA' || tag === 'INPUT' || event.target?.isContentEditable) return;
        markInput();
        if (event.key === 'End' && desktop() && conversationVisible() && (doc.activeElement === chat || chat.contains(doc.activeElement))) { event.preventDefault(); goLatest({ instant: true }); }
    }, { capture: true });

    const onScroll = () => {
        scrollFrame = 0;
        if (!desktop() || !conversationVisible()) return;
        const top = Number(chat.scrollTop) || 0;
        const user = nowMs() - lastInput < 250;
        if (user) {
            const prev = state;
            state = nextFollow(state, { type: 'user-scroll', up: top < lastTop, gap: gap() });
            if (prev !== state) { if (state === 'detached') hooks.detach(); else hooks.attach(); }
        }
        lastTop = top;
        refreshLatest();
        if (!holding) {
            if (user || !anchor) recordAnchor();
            showChip();
            scheduleRead();
            schedulePos();
        }
    };
    listen(chat, 'scroll', () => {
        // 用户滚动先同步脱离；前插补偿和窗口布局产生的scroll不重新选中阅读锚点。
        if (width !== chat.clientWidth || height !== chat.clientHeight) { width = chat.clientWidth; height = chat.clientHeight; lastInput = -1e9; }
        const top = Number(chat.scrollTop) || 0;
        if (programTop !== null && Math.abs(top - programTop) < 1) { lastInput = -1e9; programTop = null; }
        if (nowMs() - lastInput < 250) {
            const previous = state;
            state = nextFollow(state, { type: 'user-scroll', up: top < lastTop, gap: gap() });
            if (previous !== state) { if (state === 'detached') hooks.detach(); else hooks.attach(); }
        }
        lastTop = top;
        if (!scrollFrame) scrollFrame = raf(onScroll) || 1;
    });

    if (typeof globalThis.MutationObserver === 'function') {
        observer = new globalThis.MutationObserver((records) => {
            if (!desktop()) return;
            compensate(records);
            applyDivider();
            refreshLatest();
            scheduleRead();
            if (!holding && !anchor) recordAnchor();
        }); observer.observe(chat, { childList: true });
    }
    if (doc.defaultView) listen(doc.defaultView, 'resize', () => { lastInput = -1e9; });
    listen(doc, 'visibilitychange', () => { if (!doc.hidden) scheduleRead(); });

    const api = {
        jump, captureAnchor: recordAnchor,
        holding: () => holding,
        state: () => state,
        sent() { openToken = null; releaseHold(); state = 'follow'; hooks.attach(); },
        openChat,
        replyRendered,
        refresh() { applyDivider(); refreshLatest(); },
        layout() {
            if (state !== 'detached' || holding || !anchor) return;
            if (!anchor.el?.isConnected) anchor.el = byId(anchor.id);
            if (!anchor.el) return;
            const off = anchor.el.getBoundingClientRect().top - chat.getBoundingClientRect().top;
            const delta = anchorDelta(anchor.off, off);
            if (Math.abs(delta) > 0.5) { chat.scrollTop += delta; programTop = chat.scrollTop; }
        },
        destroy() {
            listeners.abort(); observer?.disconnect(); releaseHold(); openToken = null;
            for (const timer of [readTimer, posTimer, chipTimer, flashTimer]) clearTimeout(timer);
            if (scrollFrame) globalThis.cancelAnimationFrame?.(scrollFrame);
            nodes?.latest.remove(); nodes?.chip.remove();
            if (active === api) active = null;
        },
    };
    active = api;
    openChat();
    return api;
}
