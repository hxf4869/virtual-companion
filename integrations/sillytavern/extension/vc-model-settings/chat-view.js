// F2 聊天外观。只在 body.vc-ui 时挂载；关闭时不改宿主节点。
// 海报是 #chat 的前一个兄弟（在 #sheld 内绝对定位）。clearChat 只移除 #chat 的子节点。
// 流式渐清：把宿主 powerUserSettings.stream_fade_in 设为 true，不同步设置里的 input 事件，因此不调用 saveSettingsDebounced。
import { CHAT_PICK_COPY, requestShellDestination } from './chat-shell.js';
import { FORGET_NOTICE, createMemoryPage, requestOpenMemory } from './memory-controller.js';
import { MEMORY_NOTICE_EVENT, MEMORY_QUIET_COPY } from './memory-injection.js';
import { confirmAlert } from './ui/alert.js';
import { mountMemoryInspectorView, mountMessageToolsView } from './desktop/build/index.js';
import { icon, iconSpriteUrl } from './ui/icons.js';
import { popMenu } from './ui/menu.js';
import { prefersReducedMotion } from './ui/motion.js';
import {
    TYPING_COPY,
    armRewrite,
    createSendBurst,
    noteTurn,
    lengthTierFor,
    planReplyAction,
    shouldQueueSend,
    splitReply,
    typingDelay,
} from './reply-pipeline.js';
import { openSheet } from './ui/sheet.js';
import { highlightMessage as jumpHighlight, mountChatScroll } from './chat-scroll.js';
import { actionLine, mountChatMotion, pagerPlan, shouldArrive, typingVisible } from './chat-motion.js';
import { mountQuickSwitch } from './desktop/quick-switch.js';
import { NEUTRAL_TINT, tintOf } from './ui/tint.js';
import { clearMessageVoice, renderMessageVoice, voicePlayer } from './voice.js';
import { chatVoiceAvailable, readReplyAloud, requestChatVoice } from './voice-chat.js';
import {
    REPLY_STYLE_KEY,
    PRESS_MS,
    PRESS_SLOP,
    NEAR_BOTTOM_PX,
    GROUP_GAP_MS,
    PILL_GAP_MS,
    SENT_COPY,
    isNearBottom,
    keepsTail,
    shouldShowNewReply,
    pressExceeded,
    isDirectChat,
    parseSendDate,
    clockText,
    gapLabel,
    planMessageMarks,
    safeAvatarUrl,
    recalledItems,
} from './chat-logic.js';
import {
    clearReplyBubbles,
    appendReplySegment,
    renderReplyBubbles,
} from './desktop/standalone/cards/reply-bubbles.js';

export {
    REPLY_STYLE_KEY,
    PRESS_MS,
    PRESS_SLOP,
    NEAR_BOTTOM_PX,
    GROUP_GAP_MS,
    PILL_GAP_MS,
    SENT_COPY,
    isNearBottom,
    keepsTail,
    shouldShowNewReply,
    pressExceeded,
    isDirectChat,
    parseSendDate,
    clockText,
    gapLabel,
    planMessageMarks,
    safeAvatarUrl,
    recalledItems,
    clearReplyBubbles,
    appendReplySegment,
    renderReplyBubbles,
};
const MEMORY_PROMPT = 'vc_long_term_memory';

let contextGetter = null;
let memoryNotice = '';
const MEMORY_SKIP_TOAST = ['本轮已跳过', '长期记忆已关闭', '来源已变化'];
let memoryPage = null;
let inspectorMode = 'recall';
let userStopped = false;
let generationFailed = false;
let stickToBottom = true;
let seenScrollHeight = 0;
let pendingReply = false;
let pinBottom = true;
let pinTries = 0;
let pinFrame = 0;
let pinUntil = 0;
let applyingScroll = 0;
let userScroll = false;
let chatWasLaidOut = false;
let watchedChatColumn = null;
const PIN_TRIES = 8;
const PIN_MS = 600;
const LAID_OUT_PX = 48;
let lastChatId;
let arrivalsPrimed = false;
let inspectorEntry = null;
const messageToolViews = new Map();
let posterFrame = 0;
let scrollFrame = 0;
let chatFrame = 0;
let statusFrame = 0;
let shellFrame = 0;
let generatingMes = null;
let generationLive = false;
let rewriteCount = 0;
let pendingRewrite = null;
let revealMesId = '';
const seenMessages = new WeakSet();
let foldSequence = 0;
let scrollApi = null;
let motionApi = null;
let quickSwitch = null;
let chatChangedAt = Date.now();
let typingSince = 0;
let typingTimer = 0;
const arrivalSeen = new WeakSet();

/** 引用、搜索、记忆来源跳到某条消息：滚动并高亮。桌面之外或未打开会话时返回 false。 */
export function highlightMessage(mesid, options) {
    return jumpHighlight(mesid, options);
}

export function readReplyStyle(storage) {
    let stored = null;
    try {
        const store = storage ?? globalThis.localStorage;
        stored = store?.getItem?.(REPLY_STYLE_KEY);
    } catch { /* 偏好读不到时按布局给默认 */ }
    if (stored === 'bubble' || stored === 'spread') return stored;
    return desktopLayout() ? 'bubble' : 'spread';
}

function desktopLayout() {
    return globalThis.document?.documentElement?.getAttribute?.('data-vc-layout') === 'desktop';
}

export function writeReplyStyle(style, storage) {
    const next = style === 'bubble' ? 'bubble' : 'spread';
    try {
        const store = storage ?? globalThis.localStorage;
        store?.setItem?.(REPLY_STYLE_KEY, next);
    } catch { /* 偏好写不进去时仍更新当前页 */ }
    applyReplyStyle(document, next);
    return next;
}

export function applyReplyStyle(doc, style) {
    const bubble = style === 'bubble';
    const body = doc?.body;
    if (!body?.classList) return;
    if (bubble) body.classList.add('vc-reply-bubble');
    else removeClass(body, 'vc-reply-bubble');
}

export function syncDirectChat(doc, ctx) {
    const body = doc?.body;
    if (!body?.classList) return;
    if (isDirectChat(ctx)) body.classList.add('vc-direct');
    else body.classList.remove('vc-direct');
}

export function markSpeakers(rows) {
    let previous = null;
    return rows.map((row) => {
        const key = row?.system ? 'system' : row?.user ? 'user' : `c:${row?.name || ''}`;
        const show = !row?.user && !row?.system && key !== previous;
        previous = key;
        return show;
    });
}

export function refreshIndexes(count, streaming) {
    const total = Number(count) || 0;
    if (total <= 0) return [];
    if (streaming) return [total - 1];
    return Array.from({ length: total }, (_, index) => index);
}

function nodeConnected(node, doc) {
    if (!node) return false;
    if (node.isConnected === true) return true;
    if (node.isConnected === false) return false;
    let current = node;
    while (current) {
        if (current === doc.body || current === doc.documentElement) return true;
        current = current.parentElement || current.parent || null;
    }
    return false;
}

export function inspectorOverlayRoot(doc = document) {
    const host = doc.querySelector?.('#vc-memory-sheet-host');
    if (nodeConnected(host, doc)) return host;
    const rail = doc.querySelector?.('#vc-memory-rail');
    if (nodeConnected(rail, doc)) return rail;
    return null;
}

export function commitHostDelete(mes, ctx) {
    const raw = mes?.getAttribute?.('mesid');
    const id = typeof raw === 'string' && /^(0|[1-9]\d*)$/.test(raw) ? Number(raw) : Number.NaN;
    const remove = ctx?.deleteMessage;
    if (typeof remove !== 'function' || !Number.isInteger(id)) {
        return { ok: false, reason: 'missing-delete' };
    }
    return {
        ok: true,
        run: () => remove(id, undefined, false, true),
    };
}

/** 只改内存中的宿主开关，不派发 input，避免 saveSettingsDebounced。 */
export function armStreamFade(powerUser, doc = document) {
    if (!powerUser || typeof powerUser !== 'object') return { wrote: false, persisted: false };
    if (powerUser.stream_fade_in === true) return { wrote: false, persisted: false, already: true };
    powerUser.stream_fade_in = true;
    const box = doc?.querySelector?.('#stream_fade_in');
    if (box) box.checked = true;
    return { wrote: true, persisted: false };
}

export function posterTarget() {
    return document.querySelector('#vc-poster-avatar') || document.querySelector('#vc-chat-poster');
}

export function openChatMoreMenu(anchorEl) {
    if (!anchorEl || !document.body?.classList?.contains('vc-ui')) return null;
    const bubble = readReplyStyle() === 'bubble';
    const menu = popMenu(anchorEl, [
        { label: '回复铺开', check: !bubble, run: () => writeReplyStyle('spread') },
        { label: '回复气泡', check: bubble, run: () => writeReplyStyle('bubble') },
        '-',
        { label: '新对话', icon: 'square-pen', run: () => document.querySelector('#option_start_new_chat')?.click() },
        { label: '分支', icon: 'git-branch', run: () => lastCharacterMessage()?.querySelector('.mes_create_branch')?.click() },
    ], { below: true, note: memoryNotice });
    return menu;
}

export function openMemoryInspector(opener) {
    if (!document.body?.classList?.contains('vc-ui')) return null;
    mountChatView();
    return presentInspector(opener);
}

export function mountChatView({ getContext, document: doc = document } = {}) {
    if (!doc?.body?.classList?.contains('vc-ui')) return { enabled: false };
    contextGetter = typeof getContext === 'function' ? getContext : contextGetter;
    if (doc.body.getAttribute('data-vc-chat-view') === 'on') return liveApi();
    doc.body.setAttribute('data-vc-chat-view', 'on');
    ensureCss(doc);
    applyReplyStyle(doc, readReplyStyle());
    armStreamFade(safeContext()?.powerUserSettings, doc);
    const chat = doc.querySelector('#chat');
    placePoster(chat);
    placeStatus(doc);
    placeJump(chat);
    placeGen(chat);
    dressComposer(doc);
    tuckWand(doc);
    bindComposer(doc);
    installSendBurst(doc);
    bindScroll(chat);
    watchChatBox(chat);
    watchChatColumn(doc);
    bindPress(chat);
    bindActions(chat);
    bindStop(doc);
    subscribe(doc);
    refreshAll();
    const syncShell = () => {
        watchChatColumn(doc);
        tuckWand(doc);
        dressComposer(doc);
        watchStatus();
        placeStatus(doc);
        enhanceStatus();
        syncStatusSpace();
        enhanceEmpty();
    };
    syncShell();
    watch(doc.body, { childList: true, subtree: true }, () => scheduleShell(syncShell));
    if (chat) {
        watch(chat, { childList: true, subtree: true, characterData: true }, scheduleChatMutations);
    }
    watchComposerHeight(doc);
    ensureDesktopModules();
    // 窗口在手机 / 桌面布局间切换时，回复样式的布局默认值随之变化。
    watch(doc.documentElement, { attributes: true, attributeFilter: ['data-vc-layout'] }, () => {
        applyReplyStyle(doc, readReplyStyle());
        ensureDesktopModules();
        scrollApi?.refresh();
        refreshMessages();
    });
    watch(doc.body, { attributes: true, attributeFilter: ['data-generating'] }, () => {
        syncGenerating();
        if (document.body?.getAttribute?.('data-generating') !== 'true') refreshMessages();
    });
    const toasts = doc.querySelector('#toast-container');
    if (toasts) watch(toasts, { childList: true, subtree: true }, () => { absorbMemoryToasts(); noteFailure(); syncStatusSpace(); });
    const onMemoryNotice = (event) => applyMemoryNotice(event?.detail?.text || '');
    doc.addEventListener?.('vc-memory-notice', onMemoryNotice);
    doc.body?.addEventListener?.(MEMORY_NOTICE_EVENT, onMemoryNotice);
    return liveApi();
}

function liveApi() {
    return {
        enabled: true,
        openMemoryInspector,
        openChatMoreMenu,
        posterTarget,
        refresh: refreshAll,
    };
}

function safeContext() {
    try {
        const read = contextGetter || (() => globalThis.SillyTavern?.getContext?.());
        return read() || null;
    } catch {
        return null;
    }
}

function applyMemoryNotice(text) {
    memoryNotice = String(text || '');
    const note = ensureMemoryNote();
    if (note) note.textContent = memoryNotice;
    schedulePoster();
}

function ensureMemoryNote() {
    const poster = document.querySelector('#vc-chat-poster');
    if (!poster) return null;
    let note = document.querySelector('#vc-memory-note');
    if (!note) {
        note = document.createElement('p');
        note.id = 'vc-memory-note';
        note.className = 'vc-memory-note';
        poster.append(note);
    }
    return note;
}

function absorbMemoryToasts() {
    const root = document.querySelector('#toast-container');
    if (!root?.querySelectorAll) return;
    for (const toast of [...root.querySelectorAll('.toast')]) {
        const text = toast.textContent || '';
        if (text.includes('部分长期记忆暂不可用')) {
            applyMemoryNotice(MEMORY_QUIET_COPY);
            removeNode(toast);
            continue;
        }
        if (MEMORY_SKIP_TOAST.some((part) => text.includes(part))) removeNode(toast);
    }
}

function refreshAll() {
    const ctx = safeContext();
    absorbMemoryToasts();
    ensureMemoryNote();
    refreshPoster(ctx);
    refreshMessages();
    enhanceStatus();
    syncStatusSpace();
    enhanceEmpty();
    syncGenerating();
    syncLoad(ctx);
    followIfNeeded();
}

function subscribe(doc) {
    const ctx = safeContext();
    const events = ctx?.eventSource;
    const types = ctx?.eventTypes || {};
    const on = (name, fn) => { if (name && events?.on) events.on(name, fn); };
    on(types.CHAT_CHANGED, () => {
        voicePlayer.stop();
        closeInspector();
        if (memoryPage?.state.open && String(memoryPage.state.relationshipId) !== relationshipId()) memoryPage.close();
        pendingRewrite = null;
        rewriteCount = 0;
        revealMesId = '';
        const id = String(safeContext()?.chatId ?? '');
        if (lastChatId && id && id !== lastChatId) {
            userStopped = false;
            generationFailed = false;
        }
        if (id) lastChatId = id;
        chatChangedAt = Date.now();
        armPin();
        scrollApi?.openChat();
        refreshAll();
    });
    on(types.MESSAGE_SENT, () => {
        rewriteCount = 0;
        pendingRewrite = null;
        if (scrollApi) { scrollApi.sent(); attachFollow(); }
    });
    on(types.CHARACTER_MESSAGE_RENDERED, (id, type) => {
        const live = generationLive;
        generationLive = false;
        if (live && type !== 'first_message') { settleReply(id); scrollApi?.replyRendered(id); }
        refreshAll();
    });
    on(types.MESSAGE_SWIPED, () => { refreshMessages(); followIfNeeded(); });
    on(types.GENERATION_STARTED, (type, _detail, dryRun) => {
        noteTurn(type || 'normal');
        // 宿主 PromptManager 在生成结束后用 dryRun 的 Generate('normal') 重算上下文，
        // 仍会发出 GENERATION_STARTED。那不是用户新发的一轮，不能清掉「已停止」。
        if (type === 'quiet' || type === 'impersonate' || dryRun) return;
        pendingRewrite = null;
        generationLive = true;
        userStopped = false;
        generationFailed = false;
        syncGenerating();
    });
    on(types.GENERATION_STOPPED, () => {
        pendingRewrite = null;
        generationLive = false;
        userStopped = true;
        syncGenerating();
    });
    on(types.GENERATION_ENDED, syncGenerating);
    doc.addEventListener?.('vc-chat-retry', () => refreshAll());
}

function ensureCss(doc) {
    if (doc.getElementById?.('vc-chat-view-css') || doc.querySelector?.('#vc-chat-view-css')) return;
    const link = doc.createElement('link');
    link.id = 'vc-chat-view-css';
    link.setAttribute('id', 'vc-chat-view-css');
    link.setAttribute('rel', 'stylesheet');
    link.setAttribute('href', new URL('./chat-view.css', import.meta.url).href);
    (doc.head || doc.documentElement).append(link);
}

function placePoster(chat) {
    if (!chat || document.querySelector('#vc-chat-poster')) return document.querySelector('#vc-chat-poster');
    const parent = chat.parentElement || chat.parent;
    if (!parent) return null;
    const poster = document.createElement('div');
    poster.id = 'vc-chat-poster';
    poster.innerHTML = `<span class="vc-poster-avatar-slot"><img id="vc-poster-avatar" class="vc-poster-avatar" alt=""></span><h2></h2><p class="vc-poster-instance" hidden></p><p id="vc-memory-note" class="vc-memory-note"></p><div class="vc-poster-acts"></div>`;
    const acts = poster.querySelector('.vc-poster-acts');
    for (const spec of [
        ['memory', 'brain', '记忆', (button) => openMemoryInspector(button)],
        ['character', 'user-round', '角色', (button) => openCharacters(button)],
        ['more', 'sliders-horizontal', '更多', (button) => openChatMoreMenu(button)],
    ]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('data-vc-poster', spec[0]);
        button.innerHTML = `<span class="vc-poster-glyph">${icon(spec[1], { size: 22 })}</span>${spec[2]}`;
        button.addEventListener('click', () => spec[3](button));
        acts.append(button);
    }
    insertBefore(parent, poster, chat);
    watchPoster(poster);
    return poster;
}

function refreshPoster(ctx) {
    const poster = document.querySelector('#vc-chat-poster');
    if (!poster) return;
    const group = ctx?.groups?.find?.((item) => String(item.id) === String(ctx.groupId));
    const character = ctx?.characters?.[ctx.characterId];
    const name = group?.name || character?.name || '';
    const title = poster.querySelector('h2');
    if (title) title.textContent = name || CHAT_PICK_COPY;
    const instance = poster.querySelector('.vc-poster-instance');
    const label = typeof ctx?.chatMetadata?.vc_binding?.displayName === 'string' ? ctx.chatMetadata.vc_binding.displayName : '';
    if (instance) {
        instance.textContent = label;
        instance.hidden = !label;
        if (label) instance.removeAttribute('hidden');
        else instance.setAttribute('hidden', '');
    }
    const img = poster.querySelector('#vc-poster-avatar');
    const src = avatarSrc(ctx, character);
    if (img && src && img.getAttribute('src') !== src) {
        img.alt = name || '';
        img.setAttribute('src', src);
        tintOf(src).then((value) => document.body?.style?.setProperty?.('--vc-tint', value || NEUTRAL_TINT)).catch(() => {
            document.body?.style?.setProperty?.('--vc-tint', NEUTRAL_TINT);
        });
    } else if (!src) {
        document.body?.style?.setProperty?.('--vc-tint', NEUTRAL_TINT);
    }
    schedulePoster();
}

function avatarSrc(ctx, character) {
    const fromCharacter = safeAvatarUrl(character?.avatar || ctx?.characters?.[ctx?.characterId]?.avatar);
    if (fromCharacter) return fromCharacter;
    return safeAvatarUrl(document.querySelector('#chat .mes[is_user="false"] .avatar img')?.getAttribute?.('src'));
}

function openPage(destination, opener) {
    if (document.body?.classList?.contains('vc-ui')) {
        requestShellDestination(destination, opener);
        return;
    }
    if (destination === 'characters') {
        globalThis.dispatchEvent?.(new CustomEvent('vc-open-characters', { detail: { opener } }));
        document.querySelector('[data-nav="characters"]')?.click();
        return;
    }
    if (destination === 'models') document.querySelector('[data-nav="models"]')?.click();
}

function openCharacters(button) {
    openPage('characters', button);
}

function placeStatus(doc) {
    const sheld = doc.querySelector?.('#sheld');
    const chat = doc.querySelector?.('#chat');
    if (!sheld || !chat) return;
    for (const node of [doc.querySelector?.('#vc-chat-status'), doc.querySelector?.('#toast-container')]) {
        if (!node) continue;
        const parent = node.parentElement || node.parent;
        if (parent !== sheld) insertBefore(sheld, node, chat);
    }
}

function syncStatusSpace() {
    if (statusFrame) return;
    const apply = () => {
        statusFrame = 0;
        const sheld = document.querySelector('#sheld');
        if (!sheld?.style?.setProperty) return;
        const status = document.querySelector('#sheld > #vc-chat-status');
        const toast = document.querySelector('#toast-container .toast');
        const statusHeight = status && status.childElementCount ? 12 + Math.ceil(status.getBoundingClientRect?.().height || 0) + 8 : 0;
        const toastBox = toast ? Math.ceil(toast.getBoundingClientRect?.().height || 0) : 0;
        const toastHeight = toast ? Math.max(56, toastBox) + 12 : 0;
        sheld.style.setProperty('--vc-status-block', `${statusHeight}px`);
        sheld.style.setProperty('--vc-status-space', `${statusHeight + toastHeight}px`);
    };
    const frame = globalThis.requestAnimationFrame;
    if (typeof frame === 'function') statusFrame = frame(apply) || 1;
    else apply();
}

function placeJump(chat) {
    if (!chat || document.querySelector('#vc-new-reply')) return;
    const parent = chat.parentElement || chat.parent;
    if (!parent) return;
    const jump = document.createElement('button');
    jump.id = 'vc-new-reply';
    jump.type = 'button';
    jump.className = 'vc-glass';
    jump.innerHTML = `${icon('arrow-down', { size: 16 })}新回复`;
    jump.addEventListener('click', () => {
        stickToBottom = true;
        pendingReply = false;
        const top = chat.scrollHeight || 0;
        if (typeof chat.scrollTo === 'function') chat.scrollTo({ top, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
        else chat.scrollTop = top;
        removeClass(jump, 'is-on');
        toggleClass(chat, 'vc-jump-pad', false);
    });
    parent.append(jump);
}

function placeGen(chat) {
    if (!chat || document.querySelector('#vc-chat-gen')) return;
    const parent = chat.parentElement || chat.parent || document.body;
    const line = document.createElement('p');
    line.id = 'vc-chat-gen';
    line.className = 'vc-glass';
    line.setAttribute('role', 'status');
    line.hidden = true;
    line.setAttribute('hidden', '');
    parent.append(line);
}

function childMes(chat) {
    return [...(chat?.children || [])].filter((node) => hasClass(node, 'mes'));
}

function isUser(mes) {
    return mes?.getAttribute?.('is_user') === 'true';
}

function isSystem(mes) {
    return mes?.getAttribute?.('is_system') === 'true';
}

function refreshMessages() {
    cleanupMessageTools();
    syncDirectChat(document, safeContext());
    const chat = document.querySelector('#chat');
    if (!chat) return;
    const list = childMes(chat);
    const streaming = document.body?.getAttribute?.('data-generating') === 'true';
    const indexes = refreshIndexes(list.length, streaming);
    const flags = markSpeakers(list.map((mes) => ({
        user: isUser(mes),
        system: isSystem(mes),
        name: mes.getAttribute?.('ch_name') || mes.querySelector?.('.name_text')?.textContent || '',
    })));
    const pin = [...list].reverse().find((mes) => !isUser(mes) && !isSystem(mes));
    for (const index of indexes) {
        const mes = list[index];
        toggleClass(mes, 'vc-speaker', flags[index] === true);
        toggleClass(mes, 'vc-system', isSystem(mes));
        toggleClass(mes, 'vc-tools-pin', mes === pin);
        if (!seenMessages.has(mes)) {
            seenMessages.add(mes);
            if (!desktopLayout() && arrivalsPrimed && isUser(mes)) addClass(mes, 'vc-arrive');
        }
        ensureTools(mes, { character: !isUser(mes) && !isSystem(mes), last: mes === pin });
    }
    if (desktopLayout()) markArrivals(list, streaming);
    if (!streaming) arrivalsPrimed = true;
    syncGenerating();
    paintReplyMessages(list);
    syncTimeline(list);
}

/** 桌面入场：只有会话稳定后末尾新到的消息动一次；流式产生的回复、历史、切会话不动。 */
function markArrivals(list, streaming) {
    list.forEach((mes, i) => {
        if (arrivalSeen.has(mes)) return;
        arrivalSeen.add(mes);
        const play = shouldArrive({
            primed: arrivalsPrimed,
            sinceChatMs: Date.now() - chatChangedAt,
            streaming: streaming && !isUser(mes),
            system: isSystem(mes),
            isLast: i >= list.length - 2,
        });
        if (!play) return;
        addClass(mes, 'vc-arrive');
        mes.addEventListener?.('animationend', () => removeClass(mes, 'vc-arrive'), { once: true });
    });
}

/** 桌面气泡：分组、日期胶囊、组尾时间与「已发送」都写成 .mes 上的 data-vc-*，由 CSS 渲染，不插节点。 */
export function desktopBubble() {
    return desktopLayout() && Boolean(document.body?.classList?.contains('vc-reply-bubble'));
}

const MARK_ATTRS = ['data-vc-gap', 'data-vc-time', 'data-vc-pos', 'data-vc-foot', 'data-vc-tail'];
let marksOn = false;

function writeMark(mes, name, value) {
    if (value === '') {
        if (mes.hasAttribute?.(name)) mes.removeAttribute(name);
    } else if (mes.getAttribute?.(name) !== value) {
        mes.setAttribute(name, value);
    }
}

function syncTimeline(list) {
    if (!desktopBubble()) {
        if (!marksOn) return;
        marksOn = false;
        for (const mes of list) {
            for (const name of MARK_ATTRS) mes.removeAttribute?.(name);
            removeClass(mes, 'vc-rich');
        }
        return;
    }
    marksOn = true;
    const ctx = safeContext();
    const story = ctx?.chatMetadata?.vc_binding?.mode === 'STORY';
    const log = Array.isArray(ctx?.chat) ? ctx.chat : [];
    const rows = list.map((mes) => {
        const text = mes.querySelector?.('.mes_text')?.textContent?.trim() || '';
        const row = log[Number(mes.getAttribute?.('mesid'))];
        const media = richMessage(mes);
        return {
            user: isUser(mes),
            system: isSystem(mes),
            name: mes.getAttribute?.('ch_name') || mes.querySelector?.('.name_text')?.textContent || '',
            ts: parseSendDate(row?.send_date, ctx?.timestampToMoment),
            rich: story || media,
            empty: !text && !media && !mes.querySelector?.('.edit_textarea'),
        };
    });
    const marks = planMessageMarks(rows);
    list.forEach((mes, i) => {
        toggleClass(mes, 'vc-rich', rows[i].rich && !rows[i].system);
        writeMark(mes, 'data-vc-gap', marks[i].gap);
        writeMark(mes, 'data-vc-time', marks[i].time);
        writeMark(mes, 'data-vc-pos', marks[i].pos);
        writeMark(mes, 'data-vc-foot', marks[i].foot);
        if (!marks[i].tail) mes.removeAttribute?.('data-vc-tail');
        else if (!mes.hasAttribute?.('data-vc-tail')) mes.setAttribute('data-vc-tail', '');
    });
}

function releaseMessageTools(mes, entry) {
    entry.view?.unmount(); messageToolViews.delete(mes);
}
function cleanupMessageTools() {
    for (const [mes, entry] of messageToolViews) if (!mes.isConnected || !entry.el.isConnected) releaseMessageTools(mes, entry);
}
function paintMessageTools(entry) {
    const { busy, playing, failed } = entry.voice;
    const props = { ...entry.props, voice: { busy, playing, failed }, retry: entry.retry };
    if (entry.view) entry.view.update(props); else entry.view = mountMessageToolsView(entry.el, props);
}
function ensureTools(mes, { character, last = true, retry }) {
    let tools = mes.querySelector('.vc-mes-tools'), entry = messageToolViews.get(mes);
    if (entry && tools !== entry.el) { releaseMessageTools(mes, entry); entry = null; }
    if (!tools) { tools = document.createElement('div'); tools.className = 'vc-mes-tools'; mes.append(tools); }
    if (!entry) {
        entry = { el: tools, view: null, retry: null, voice: { busy: false, playing: false, failed: false, clip: null }, props: null };
        messageToolViews.set(mes, entry);
    }
    const context = safeContext(), message = context?.chat?.[Number(mes.getAttribute('mesid'))];
    const scope = { chat: context?.chat, message, text: message?.mes, relationshipId: String(context?.chatMetadata?.vc_binding?.relationshipId || '') };
    if (entry.readScope && Object.keys(scope).some(key => scope[key] !== entry.readScope[key])) entry.voice = { busy: false, playing: false, failed: false, clip: null };
    entry.readScope = scope;
    if (retry !== undefined) entry.retry = retry;
    const swipe = swipeLabel(mes), plan = desktopLayout() ? pagerPlan({ last, at: swipe?.at, n: swipe?.n }) : null;
    const showPager = desktopLayout() ? Boolean(plan) : Boolean(swipe);
    entry.props = { sprite: iconSpriteUrl(), character,
        read: character && companionMode() && (chatVoiceAvailable(context) || entry.voice.busy || entry.voice.playing),
        pager: character && swipe && showPager ? { ...swipe, prev: plan?.prev || '上一个候选', next: plan?.next || '下一个候选' } : null,
    };
    paintMessageTools(entry);
}
export function setMessageRetry(mes, retry) {
    const entry = messageToolViews.get(mes);
    if (!mes?.isConnected) { if (entry) releaseMessageTools(mes, entry); return; }
    if (!entry && !retry) return;
    ensureTools(mes, { character: !isUser(mes) && !isSystem(mes), last: mes === lastCharacterMessage(), retry });
}
export async function readMessageAloud(mes) {
    const entry = messageToolViews.get(mes);
    if (!entry?.props.read || !mes.isConnected) return;
    const state = entry.voice;
    await readReplyAloud(Number(mes.getAttribute('mesid')), state, () => {
        if (messageToolViews.get(mes) === entry && entry.voice === state && mes.isConnected && entry.el.isConnected) paintMessageTools(entry);
    });
}

function swipeLabel(mes) {
    const text = mes.querySelector?.('.swipes-counter')?.textContent || '';
    const match = String(text).replace(/\u200b/g, '').match(/(\d+)\s*\/\s*(\d+)/);
    if (!match || Number(match[2]) <= 1) return null;
    return { at: match[1], n: match[2] };
}

function bindActions(chat) {
    chat?.addEventListener?.('click', (event) => {
        const button = closest(event.target, (node) => node.getAttribute?.('data-vc-act'));
        if (!button || !chat.contains?.(button) && !containsNode(chat, button)) return;
        const mes = closest(button, (node) => hasClass(node, 'mes'));
        if (!mes) return;
        event.preventDefault?.();
        runAction(button.getAttribute('data-vc-act'), mes);
    });
}

function runAction(act, mes) {
    if (act === 'read') { void readMessageAloud(mes); return; }
    if (act === 'swipe-prev') {
        animateSwipe(mes, -1);
        mes.querySelector('.swipe_left')?.click();
        return;
    }
    if (act === 'swipe-next') {
        animateSwipe(mes, 1);
        mes.querySelector('.swipe_right')?.click();
        return;
    }
    if (act === 'edit') {
        mes.querySelector('.mes_edit')?.click();
        return;
    }
    if (act === 'copy') {
        // 宿主的复制按钮监听 pointerup（文档委托），click() 触发不了。
        mes.querySelector('.mes_copy')?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
        return;
    }
    if (act === 'regen') regenerate();
}

function regenerate() {
    const button = document.querySelector('#option_regenerate');
    if (button) {
        button.click();
        return;
    }
    const generate = safeContext()?.generate;
    if (typeof generate === 'function') generate('regenerate');
}

function companionMode() {
    const ctx = safeContext();
    if (!ctx || ctx.groupId) return false;
    return ctx.chatMetadata?.vc_binding?.mode === 'COMPANION';
}

function writeBox(box, value) {
    const proto = globalThis.HTMLTextAreaElement && Object.getOwnPropertyDescriptor(globalThis.HTMLTextAreaElement.prototype, 'value');
    if (proto?.set) proto.set.call(box, value);
    else box.value = value;
    box.dispatchEvent?.(new Event('input', { bubbles: true }));
}

function installSendBurst(doc) {
    if (doc.body?.getAttribute?.('data-vc-reply-debounce') === 'on') return;
    doc.body?.setAttribute?.('data-vc-reply-debounce', 'on');
    const box = doc.querySelector('#send_textarea');
    const send = doc.querySelector('#send_but');
    if (!box || !send) return;
    let bypass = false;
    let burstChat = '';
    const chatKey = () => { const ctx = safeContext(); return String(ctx?.getCurrentChatId?.() ?? ctx?.chatId ?? ''); };
    // 连发合并只延后「回复」：用户每条消息立刻显示并保存，安静一段时间后用空输入触发一次原生生成。
    const burst = createSendBurst({
        onFlush() {
            bypass = true;
            try {
                if (String(box.value || '').trim()) return; // 用户已开始输入下一句，交给下一次发送
                if (chatKey() !== burstChat) return; // 等待期间切换了会话：消息已留在原会话，不在新会话里触发生成
                send.click();
            } finally {
                bypass = false;
            }
        },
    });
    const postNow = (text) => import('../../../../script.js')
        .then(async (native) => {
            await native.sendMessageAsUser(text, '');
            await native.saveChatConditional?.();
        })
        .catch(() => { writeBox(box, text); }); // 失败时把文字还给输入框，不丢草稿
    const queue = (event) => {
        if (bypass || !companionMode()) return;
        const text = String(box.value || '');
        if (!shouldQueueSend(text, burst.pending())) return;
        event.preventDefault?.();
        event.stopPropagation?.();
        event.stopImmediatePropagation?.();
        writeBox(box, '');
        burstChat = chatKey();
        void postNow(text.trim());
        burst.push(text.trim());
    };
    send.addEventListener('click', queue, true);
    doc.addEventListener?.('keydown', (event) => {
        if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return;
        if (doc.activeElement !== box && event.target !== box) return;
        queue(event);
    }, true);
}

function messageSource(mes) {
    const raw = mes?.getAttribute?.('mesid');
    const id = typeof raw === 'string' && /^(0|[1-9]\d*)$/.test(raw) ? Number(raw) : NaN;
    const chat = safeContext()?.chat;
    if (!Number.isInteger(id) || !Array.isArray(chat)) return '';
    const message = chat[id];
    return typeof message?.mes === 'string' ? message.mes : '';
}

function richMessage(mes) {
    return Boolean(mes.querySelector?.('.mes_text')?.querySelector?.('iframe, img, video, .TH-render'));
}

function paintReplyMessages(list) {
    if (!companionMode()) {
        for (const mes of list) { clearReplyBubbles(mes); clearMessageVoice(mes); }
        return;
    }
    const streaming = document.body?.getAttribute?.('data-generating') === 'true';
    const live = streaming ? [...list].reverse().find((mes) => !isUser(mes) && !isSystem(mes)) : null;
    for (const mes of list) {
        const message = safeContext()?.chat?.[Number(mes.getAttribute?.('mesid'))];
        if (!(streaming && mes === live) && message && renderMessageVoice(mes, message, { onPlayed: () => safeContext()?.saveChat?.() })) {
            clearReplyBubbles(mes);
            mes.querySelector?.('.mes_text')?.setAttribute?.('aria-hidden', 'true');
            continue;
        }
        clearMessageVoice(mes);
        if (isUser(mes) || isSystem(mes)) {
            clearReplyBubbles(mes);
            continue;
        }
        const reveal = revealMesId !== '' && mes.getAttribute?.('mesid') === revealMesId;
        if (richMessage(mes) || (streaming && mes === live)) {
            clearReplyBubbles(mes);
            continue;
        }
        const raw = messageSource(mes) || mes.querySelector?.('.mes_text')?.textContent || '';
        renderReplyBubbles(mes, raw, { reducedMotion: reveal ? prefersReducedMotion() : true });
    }
}

function settleReply(id) {
    if (!companionMode()) return;
    const index = Number(id);
    const chat = safeContext()?.chat;
    if (!Number.isInteger(index) || !Array.isArray(chat)) return;
    const message = chat[index];
    if (!message || message.is_user || message.is_system) return;
    const plan = planReplyAction({ text: message.mes, rewritten: rewriteCount > 0 });
    if (plan.action === 'rewrite') {
        rewriteCount += 1;
        const pending = { chat, message, text: message.mes };
        pendingRewrite = pending;
        // Do not await inside the render event: the native generator must
        // finish its save and release its busy flag before regeneration.
        void Promise.all([import('../../../../script.js'), import('../../../../scripts/utils.js')]).then(async ([native, { waitUntilCondition }]) => {
            const current = () => pendingRewrite === pending && safeContext()?.chat === chat
                && chat.at(-1) === message && message.mes === pending.text;
            await waitUntilCondition(() => !current() || !native.isGenerating() && !native.isChatSaving, 10000, 50);
            if (!current()) return;
            pendingRewrite = null;
            armRewrite(plan.hint);
            regenerate();
        }).catch(() => { if (pendingRewrite === pending) pendingRewrite = null; });
        return;
    }
    const textChanged = plan.processed.text !== message.mes;
    if (textChanged) {
        message.mes = plan.processed.text;
        if (Array.isArray(message.swipes)) {
            const swipe = Number.isInteger(message.swipe_id) ? message.swipe_id : message.swipes.length - 1;
            if (swipe >= 0 && swipe < message.swipes.length) message.swipes[swipe] = plan.processed.text;
        }
    }
    const tier = lengthTierFor(chat);
    if (tier) {
        message.extra ||= {};
        message.extra.vc_reply_length_tier = tier;
        const swipe = message.swipe_info?.[message.swipe_id];
        if (swipe) { swipe.extra ||= {}; swipe.extra.vc_reply_length_tier = tier; }
    }
    // MESSAGE_RECEIVED precedes the native save; the tier joins that same save.
    if (textChanged) {
        try { safeContext()?.saveChat?.(); } catch { /* 原生保存仍保留完整消息。 */ }
    }
    revealMesId = String(index);
    void requestChatVoice(index);
}

function animateSwipe(mes, direction) {
    const text = mes.querySelector('.mes_text');
    if (!text) return;
    text.style.setProperty('--vc-swipe-x', `${direction * -24}px`);
    addClass(mes, 'vc-swipe-out');
    setTimeout(() => {
        removeClass(mes, 'vc-swipe-out');
        text.style.setProperty('--vc-swipe-x', `${direction * 24}px`);
        addClass(mes, 'vc-swipe-in');
        setTimeout(() => removeClass(mes, 'vc-swipe-in'), 420);
    }, 160);
}

function bindPress(chat) {
    if (!chat?.addEventListener) return;
    let timer = 0;
    let x = 0;
    let y = 0;
    const cancel = () => { clearTimeout(timer); timer = 0; };
    chat.addEventListener('pointerdown', (event) => {
        if (event.button > 0) return;
        const mes = messageFrom(event.target);
        if (!mes || skipPress(event.target) || hasClass(mes, 'vc-selectable')) return;
        if (document.body?.getAttribute('data-generating') === 'true') return;
        x = event.clientX;
        y = event.clientY;
        cancel();
        timer = setTimeout(() => { timer = 0; liftMessage(mes); }, PRESS_MS);
    });
    chat.addEventListener('pointermove', (event) => {
        if (timer && pressExceeded(event.clientX - x, event.clientY - y)) cancel();
    });
    chat.addEventListener('pointerup', cancel);
    chat.addEventListener('pointercancel', cancel);
    chat.addEventListener('scroll', cancel);
    chat.addEventListener('contextmenu', (event) => {
        const mes = messageFrom(event.target);
        if (!mes || skipPress(event.target) || hasClass(mes, 'vc-selectable')) return;
        event.preventDefault?.();
        cancel();
        liftMessage(mes);
    });
}

function skipPress(target) {
    return Boolean(closest(target, (node) => hasClass(node, 'swipes-counter') || hasClass(node, 'mes_swipe_picker')
        || hasClass(node, 'swipe_left') || hasClass(node, 'swipe_right') || hasClass(node, 'vc-mes-tools')
        || hasClass(node, 'mes_buttons') || hasClass(node, 'mes_edit_buttons')
        || node.tag === 'button' || node.tagName === 'BUTTON' || node.tagName === 'A' || node.tagName === 'INPUT' || node.tagName === 'TEXTAREA'));
}

function messageFrom(target) {
    const mes = closest(target, (node) => hasClass(node, 'mes'));
    if (!mes) return null;
    const parent = mes.parentElement || mes.parent;
    return parent?.id === 'chat' ? mes : null;
}

const LIFT_CHROME = [
    '.vc-mes-tools',
    '.mes_buttons',
    '.swipe_left',
    '.swipe_right',
    '.swipes-counter',
    '.swipeRightBlock',
    '.mes_edit_buttons',
    '.timestamp',
    '.timestamp-icon',
    '.mes_ghost',
    '.mesAvatarWrapper',
    '.avatar',
    '.ch_name',
    '.mesIDDisplay',
];

export function prepareLiftGhost(ghost, rect, viewportWidth) {
    const pad = 16;
    const width = Math.max(0, Number(viewportWidth) - pad * 2);
    ghost.style.left = `${pad}px`;
    ghost.style.top = `${rect?.top ?? 0}px`;
    ghost.style.width = `${width}px`;
    for (const selector of LIFT_CHROME) {
        for (const node of [...(ghost.querySelectorAll?.(selector) || [])]) node.remove?.();
    }
    return ghost;
}

function liftMessage(mes) {
    if (typeof mes.getBoundingClientRect !== 'function') return;
    const rect = mes.getBoundingClientRect();
    const ghost = mes.cloneNode(true);
    ghost.classList?.add?.('vc-lift');
    prepareLiftGhost(ghost, rect, globalThis.innerWidth || rect.width + 32);
    document.body.append(ghost);
    addClass(mes, 'vc-lift-source');
    const frame = globalThis.requestAnimationFrame;
    if (frame) frame(() => addClass(ghost, 'is-up'));
    else addClass(ghost, 'is-up');
    const character = !isUser(mes) && !isSystem(mes);
    const items = [
        { label: '复制', icon: 'copy', run: () => runAction('copy', mes) },
        { label: '编辑', icon: 'pencil', run: () => runAction('edit', mes) },
    ];
    if (character) items.push({ label: '重新生成', icon: 'refresh-cw', run: () => runAction('regen', mes) });
    items.push(
        { label: '选择文本', icon: 'text-cursor', run: () => selectMessageText(mes) },
        '-',
        { label: '删除', icon: 'trash-2', danger: true, run: () => { void deleteMessage(mes); } },
    );
    const below = rect.bottom < (globalThis.innerHeight || 0) * 0.6;
    const finish = () => {
        removeNode(ghost);
        removeClass(mes, 'vc-lift-source');
    };
    popMenu(ghost, items, { blur: true, below, onClosed: finish });
}

function selectMessageText(mes) {
    addClass(mes, 'vc-selectable');
    const text = mes.querySelector('.mes_text');
    const range = document.createRange?.();
    const selection = globalThis.getSelection?.();
    if (!text || !range || !selection) return;
    range.selectNodeContents(text);
    selection.removeAllRanges();
    selection.addRange(range);
}

async function deleteMessage(mes) {
    const ok = await confirmAlert({
        title: '删除这条消息？',
        message: '删除后无法恢复。',
        action: '删除',
        opener: document.activeElement,
    });
    if (!ok) return;
    const planned = commitHostDelete(mes, safeContext());
    if (!planned.ok) {
        reportDeleteFailure();
        return;
    }
    try {
        await planned.run();
    } catch {
        reportDeleteFailure();
    }
}

function reportDeleteFailure() {
    const line = document.querySelector('#vc-chat-gen');
    if (!line) return;
    clearChildren(line);
    line.textContent = '这条消息没有删掉';
    show(line);
}

function dressComposer(doc) {
    const box = doc.querySelector('#send_textarea');
    if (box && doc.body?.classList?.contains('vc-ui')) box.setAttribute('placeholder', '发消息');
    const plus = doc.querySelector('#options_button');
    if (plus) {
        addClass(plus, 'vc-glass');
        if (!plus.getAttribute('aria-label')) plus.setAttribute('aria-label', '输入选项');
        if (!plus.querySelector('.vc-icon')) {
            if (plus.insertAdjacentHTML) plus.insertAdjacentHTML('beforeend', icon('plus', { size: 22 }));
            else appendIcon(plus, 'plus', 22);
        }
    }
    paintGlyph(doc.querySelector('#send_but'), 'arrow-up', 20);
    paintGlyph(doc.querySelector('#mes_stop'), 'square', 14);
    if (doc.querySelector('#send_but') && !doc.querySelector('#send_but').getAttribute('aria-label')) {
        doc.querySelector('#send_but').setAttribute('aria-label', '发送');
    }
    if (doc.querySelector('#mes_stop') && !doc.querySelector('#mes_stop').getAttribute('aria-label')) {
        doc.querySelector('#mes_stop').setAttribute('aria-label', '停止');
    }
    const options = doc.querySelector('#options');
    if (options) {
        addClass(options, 'vc-menu');
        addClass(options, 'vc-glass');
    }
}

function paintGlyph(el, name, size) {
    if (!el || el.querySelector?.('.vc-icon')) return;
    if (el.insertAdjacentHTML) el.insertAdjacentHTML('beforeend', icon(name, { size }));
    else appendIcon(el, name, size);
}

function appendIcon(el, name, size) {
    const holder = document.createElement('span');
    holder.innerHTML = icon(name, { size });
    const glyph = holder.querySelector?.('.vc-icon') || holder.children?.[0];
    if (glyph) el.append(glyph);
}

function tuckWand(doc) {
    const wand = doc.querySelector('#extensionsMenuButton');
    const menu = doc.querySelector('#options');
    if (!wand || !menu) return;
    const parent = wand.parentElement || wand.parent;
    if (parent === menu) return;
    prependNode(menu, wand);
}

function bindComposer(doc) {
    const box = doc.querySelector('#send_textarea');
    const form = doc.querySelector('#send_form');
    if (!box || !form || box.dataset?.vcFit === 'on' || box.getAttribute?.('data-vc-fit') === 'on') return;
    box.setAttribute('data-vc-fit', 'on');
    const fit = () => {
        const idle = !String(box.value || '').trim();
        toggleClass(form, 'vc-send-idle', idle);
        // 桌面高度由 chat-compose.js 按行数计算；这里再写 auto 会退回 rows=2 的高度，发送后输入框不回缩。
        if (desktopLayout()) return;
        const max = readMaxHeight(box);
        box.style.height = 'auto';
        const next = Math.min(max, Number(box.scrollHeight) || 0);
        if (next) box.style.height = `${next}px`;
    };
    box.addEventListener('input', fit);
    fit();
}

/** 窄桌面的角色面板是浮层，要让出输入区；输入区高度由这里量给 CSS（--vc-composer-h）。 */
function watchComposerHeight(doc) {
    const form = doc.querySelector?.('#form_sheld') || doc.querySelector?.('#send_form');
    const root = doc.documentElement;
    if (!form || !root?.style?.setProperty || typeof globalThis.ResizeObserver !== 'function') return;
    const paint = () => root.style.setProperty('--vc-composer-h', `${Math.ceil(form.getBoundingClientRect?.().height || 0)}px`);
    new globalThis.ResizeObserver(paint).observe(form);
    paint();
}

function readMaxHeight(box) {
    try {
        const max = Number.parseFloat(globalThis.getComputedStyle?.(box)?.maxHeight);
        if (Number.isFinite(max) && max > 0) return max;
    } catch { /* 用样式表里的 140 */ }
    return 140;
}

function nowMs() {
    const clock = globalThis.performance?.now;
    return typeof clock === 'function' ? clock.call(globalThis.performance) : Date.now();
}

function attachFollow() {
    stickToBottom = true;
    pinBottom = true;
    pendingReply = false;
    followIfNeeded();
}

function detachFollow() {
    stickToBottom = false;
    pinBottom = false;
    pinUntil = 0;
}

/** 桌面专属模块（滚动与阅读、动效与快捷键、会话快速切换）；手机布局不挂载，切到桌面时才挂。 */
function ensureDesktopModules() {
    if (!desktopLayout()) return;
    const chat = document.querySelector('#chat');
    if (!chat?.parentElement) return;
    if (!scrollApi) {
        scrollApi = mountChatScroll({
            chat,
            hooks: {
                isDesktop: desktopLayout,
                attach: attachFollow,
                detach: detachFollow,
                getChatId: () => String(safeContext()?.chatId ?? ''),
                dateLabel: (mesid) => {
                    const ctx = safeContext();
                    const ms = parseSendDate(ctx?.chat?.[mesid]?.send_date, ctx?.timestampToMoment);
                    return ms === null ? '' : gapLabel(ms);
                },
            },
        });
    }
    if (!motionApi) {
        quickSwitch = mountQuickSwitch({ doc: document });
        motionApi = mountChatMotion({ chat, hooks: { isDesktop: desktopLayout, toggleQuickSwitch: () => quickSwitch.toggle() } });
    }
}

function armPin() {
    if (scrollApi?.holding()) return;
    pinBottom = true;
    stickToBottom = true;
    pendingReply = false;
    seenScrollHeight = 0;
    pinTries = 0;
    pinUntil = nowMs() + PIN_MS;
}

function pinActive() {
    return pinBottom && nowMs() < pinUntil;
}

function chatLaidOut(chat) {
    return (Number(chat?.clientHeight) || 0) >= LAID_OUT_PX;
}

function schedulePin() {
    scheduleFrame({
        get current() { return pinFrame; },
        set current(value) { pinFrame = value; },
    }, () => {
        if (!pinBottom && !stickToBottom) return;
        followIfNeeded();
    });
}

function watchChatBox(chat) {
    if (!chat || chat.getAttribute?.('data-vc-size-watch') === 'on') return;
    if (typeof globalThis.ResizeObserver !== 'function') return;
    chat.setAttribute('data-vc-size-watch', 'on');
    const observer = new globalThis.ResizeObserver(() => {
        const laidOut = chatLaidOut(chat);
        if (laidOut && !chatWasLaidOut) {
            armPin();
            followIfNeeded();
        } else if (laidOut && (pinBottom || stickToBottom)) {
            followIfNeeded();
        }
        chatWasLaidOut = laidOut;
    });
    observer.observe(chat);
    chatWasLaidOut = chatLaidOut(chat);
}

function watchChatColumn(doc) {
    const shell = doc.querySelector?.('#vc-shell');
    if (!shell || shell === watchedChatColumn) return;
    watchedChatColumn = shell;
    let open = shell.getAttribute('data-chat') === 'open';
    watch(shell, { attributes: true, attributeFilter: ['data-chat', 'data-open-state'] }, () => {
        syncLoad(safeContext());
        enhanceEmpty();
        const next = shell.getAttribute('data-chat') === 'open';
        if (next === open) return;
        open = next;
        if (!open) {
            chatWasLaidOut = false;
            return;
        }
        scrollApi?.openChat();
        armPin();
        followIfNeeded();
    });
}

function bindScroll(chat) {
    if (!chat?.addEventListener) return;
    const markUserScroll = () => { userScroll = true; };
    chat.addEventListener('wheel', markUserScroll, { passive: true });
    chat.addEventListener('touchmove', markUserScroll, { passive: true });
    chat.addEventListener('pointerdown', (event) => {
        if (event.target === chat) markUserScroll();
    });
    const run = () => {
        scrollFrame = 0;
        applyPosterFrame();
        if (applyingScroll) {
            seenScrollHeight = Number(chat.scrollHeight) || 0;
            return;
        }
        if (userScroll) {
            userScroll = false;
            pinUntil = 0;
            pinBottom = false;
            stickToBottom = keepsTail(chat, { pin: false });
        } else if (pinActive() && chatLaidOut(chat) && !isNearBottom(chat) && pinTries < PIN_TRIES) {
            schedulePin();
            return;
        } else {
            stickToBottom = keepsTail(chat, { pin: pinActive() });
            if (!stickToBottom) pinBottom = false;
        }
        seenScrollHeight = Number(chat.scrollHeight) || 0;
        if (stickToBottom) pendingReply = false;
        const show = shouldShowNewReply({ nearBottom: stickToBottom, pending: pendingReply });
        const jump = document.querySelector('#vc-new-reply');
        toggleClass(jump, 'is-on', show);
        toggleClass(chat, 'vc-jump-pad', show);
    };
    chat.addEventListener('scroll', () => {
        if (scrollFrame) return;
        const raf = globalThis.requestAnimationFrame;
        if (typeof raf === 'function') scrollFrame = raf(run) || 1;
        else run();
    });
}

function scheduleFrame(slot, run) {
    if (slot.current) return;
    const raf = globalThis.requestAnimationFrame;
    const fire = () => {
        slot.current = 0;
        run();
    };
    if (typeof raf === 'function') slot.current = raf(fire) || 1;
    else fire();
}

function scheduleChatMutations() {
    scheduleFrame({
        get current() { return chatFrame; },
        set current(value) { chatFrame = value; },
    }, () => {
        refreshMessages();
        syncGenerating();
        followIfNeeded();
        enhanceEmpty();
    });
}

function scheduleShell(syncShell) {
    scheduleFrame({
        get current() { return shellFrame; },
        set current(value) { shellFrame = value; },
    }, syncShell);
}

function schedulePoster() {
    scheduleFrame({
        get current() { return posterFrame; },
        set current(value) { posterFrame = value; },
    }, applyPosterFrame);
}

function watchPoster(poster) {
    if (!poster || poster.getAttribute?.('data-vc-poster-watch') === 'on') return;
    poster.setAttribute('data-vc-poster-watch', 'on');
    if (typeof globalThis.ResizeObserver === 'function') {
        const observer = new globalThis.ResizeObserver(() => schedulePoster());
        observer.observe(poster);
    }
    schedulePoster();
}

function applyPosterFrame() {
    const poster = document.querySelector('#vc-chat-poster');
    const chat = document.querySelector('#chat');
    const height = Number(poster?.offsetHeight) || 0;
    if (height) document.body?.style?.setProperty?.('--vc-poster-pad', `${height}px`);
    if (!poster?.style) return;
    const top = Number(chat?.scrollTop) || 0;
    const shift = height ? Math.min(Math.max(0, top), height) : 0;
    const away = height && shift >= height - 1 ? shift + height : shift;
    poster.style.transform = away ? `translateY(${-away}px)` : '';
}

function followIfNeeded() {
    const chat = document.querySelector('#chat');
    if (!chat) return;
    if (scrollApi?.holding()) return; // 落地 / 还原阅读位置 / 平滑回到最新期间由 chat-scroll.js 接管
    const height = Number(chat.scrollHeight) || 0;
    const grew = height > seenScrollHeight + 1;
    const jump = document.querySelector('#vc-new-reply');
    const pinning = pinActive();
    const topNow = Number(chat.scrollTop) || 0;
    const gapNow = height - topNow - (Number(chat.clientHeight) || 0);
    // 溢出仍在跟随区内、人已经停在顶端：这一帧不要拽回底部。更长的距离仍按原贴底处理。
    if ((stickToBottom || pinning) && !pinning && topNow <= 1 && gapNow > 1 && gapNow <= NEAR_BOTTOM_PX) {
        stickToBottom = false;
        pinBottom = false;
    } else if (stickToBottom || pinning) {
        // 会话列在 display:none 或 1px 折叠时写 scrollTop 会被浏览器丢掉，旧位置会留到打开之后。
        if (!chatLaidOut(chat)) {
            if (pinActive() && pinTries < PIN_TRIES) {
                pinTries += 1;
                schedulePin();
            }
            return;
        }
        const top = Number(chat.scrollTop) || 0;
        if (height && top < height - 1) {
            applyingScroll += 1;
            chat.scrollTop = height;
            applyingScroll = Math.max(0, applyingScroll - 1);
        }
        pendingReply = false;
        seenScrollHeight = Number(chat.scrollHeight) || height;
        removeClass(jump, 'is-on');
        toggleClass(chat, 'vc-jump-pad', false);
        if (pinActive() && !isNearBottom(chat) && pinTries < PIN_TRIES) {
            pinTries += 1;
            schedulePin();
        }
        return;
    }
    if (grew) pendingReply = true;
    seenScrollHeight = height;
    const show = shouldShowNewReply({ nearBottom: false, grew, pending: pendingReply });
    toggleClass(jump, 'is-on', show);
    toggleClass(chat, 'vc-jump-pad', show);
}

function bindStop(doc) {
    doc.querySelector('#mes_stop')?.addEventListener?.('click', () => {
        userStopped = true;
        syncGenerating();
    });
}

function syncGenerating() {
    const on = document.body?.getAttribute?.('data-generating') === 'true';
    const chat = document.querySelector('#chat');
    const list = childMes(chat);
    let last = [...list].reverse().find((mes) => !isUser(mes) && !isSystem(mes));
    // 新回复节点出现前，最后一条角色消息在用户最新消息之上；不能把思考态挂到旧回复上。
    const lastUser = [...list].reverse().find(isUser);
    if (on && last && lastUser && list.indexOf(last) < list.indexOf(lastUser)) last = null;
    const targets = on ? [generatingMes, last].filter(Boolean) : list;
    const seen = new Set();
    for (const mes of targets) {
        if (seen.has(mes)) continue;
        seen.add(mes);
        const active = on && mes === last;
        toggleClass(mes, 'vc-generating', active);
        const text = mes.querySelector?.('.mes_text')?.textContent?.trim() || '';
        toggleClass(mes, 'vc-thinking', active && text.length === 0);
        let label = mes.querySelector?.('.vc-sr');
        if (active && text.length === 0) {
            if (!label) {
                label = document.createElement('span');
                label.className = 'vc-sr';
                label.textContent = '思考中';
                mes.append(label);
            }
        } else if (label) removeNode(label);
    }
    generatingMes = on ? last : null;
    const line = document.querySelector('#vc-chat-gen');
    if (!line) return;
    clearChildren(line);
    line.removeAttribute?.('data-vc-typing');
    clearTimeout(typingTimer);
    if (!on) typingSince = 0;
    const lastMes = list[list.length - 1];
    const canContinue = desktopLayout() && userStopped && !on && Boolean(lastMes) && !isUser(lastMes) && !isSystem(lastMes)
        && Boolean(lastMes.querySelector?.('.mes_text')?.textContent?.trim());
    for (const mes of list) toggleClass(mes, 'vc-stopped', canContinue && mes === lastMes);
    if (on) {
        // 桌面气泡下，空回复节点本身不画（CSS 隐藏），由这一行给出「正在输入」。
        const typing = desktopBubble();
        const waiting = generatingMes && !generatingMes.querySelector?.('.mes_text')?.textContent?.trim();
        // 回复节点还没出现时，在输入区上方给出可见的思考态。
        if (generatingMes && !(typing && waiting)) { hide(line); return; }
        // 桌面：生成开始 450ms 内就有内容的不显示「正在输入」，避免一闪而过。
        if (desktopLayout()) {
            if (!typingSince) typingSince = nowMs();
            const elapsed = nowMs() - typingSince;
            if (!typingVisible(elapsed)) {
                hide(line);
                typingTimer = setTimeout(syncGenerating, Math.max(16, 450 - elapsed));
                return;
            }
        }
        const dots = document.createElement('span');
        dots.className = 'vc-gen-dots';
        dots.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        if (typing) {
            // 与角色消息同构：头像 + 气泡（三点 + 正在输入）。
            const src = avatarSrc(safeContext());
            if (src) {
                const avatar = document.createElement('img');
                avatar.className = 'vc-gen-avatar';
                avatar.alt = '';
                avatar.src = src;
                line.append(avatar);
            }
            const bubble = document.createElement('span');
            bubble.className = 'vc-gen-bubble';
            label.textContent = TYPING_COPY;
            bubble.append(dots, label);
            line.setAttribute('data-vc-typing', '');
            line.append(bubble);
        } else {
            label.textContent = '思考中';
            line.append(dots, label);
        }
        show(line);
        return;
    }
    if (userStopped) {
        if (canContinue) {
            const label = document.createElement('span');
            label.textContent = '已停止 · ';
            line.append(label, textButton('继续', continueGeneration));
        } else {
            line.textContent = '已停止';
        }
        show(line);
        return;
    }
    if (generationFailed) {
        const span = document.createElement('span');
        span.textContent = '回复没有完成';
        const retry = textButton('重试', () => regenerate());
        line.append(span, retry);
        show(line);
        return;
    }
    hide(line);
}

/** 停止后接着写：走宿主原生 continue（选项菜单里的「继续」）。 */
async function continueGeneration(control) {
    const context = safeContext();
    const metadata = context?.chatMetadata;
    const message = context?.chat?.at(-1);
    control.disabled = true;
    try {
        // 停止会立即显示续写入口，但宿主仍可能在保存半截回复。
        // 先排完 F2 保存队列，避免召回期间修订号更新把续写取消。
        await context?.saveChat?.();
        const current = safeContext();
        if (current?.chatMetadata !== metadata || current?.chat?.at(-1) !== message) return;
        const button = document.querySelector('#option_continue');
        if (button) button.click();
        else if (typeof current?.generate === 'function') current.generate('continue');
    } catch { /* 原生 F2 保存会保留草稿并显示冲突，保存失败不开始续写。 */ }
    finally { control.disabled = false; }
}

function noteFailure() {
    if (userStopped || !document.querySelector('#toast-container .toast-error')) return;
    generationFailed = true;
    syncGenerating();
}

function syncLoad(ctx) {
    let skeleton = document.querySelector('#vc-chat-skeleton');
    let error = document.querySelector('#vc-chat-load-error');
    const chat = document.querySelector('#chat');
    if (!chat) return;
    if (!skeleton) {
        skeleton = document.createElement('div');
        skeleton.id = 'vc-chat-skeleton';
        skeleton.className = 'vc-skeleton-row';
        skeleton.innerHTML = '<span class="vc-skeleton vc-skeleton-avatar"></span><span><span class="vc-skeleton vc-skeleton-line"></span><span class="vc-skeleton vc-skeleton-line is-short"></span></span>';
        const parent = chat.parentElement || chat.parent;
        if (parent) insertBefore(parent, skeleton, chat);
    }
    if (!desktopLayout() && skeleton.hasAttribute?.('data-vc-bubbles')) {
        skeleton.removeAttribute('data-vc-bubbles');
        skeleton.innerHTML = '<span class="vc-skeleton vc-skeleton-avatar"></span><span><span class="vc-skeleton vc-skeleton-line"></span><span class="vc-skeleton vc-skeleton-line is-short"></span></span>';
    }
    const known = Boolean(ctx);
    if (!known && contextGetter) {
        if (!error) {
            error = document.createElement('p');
            error.id = 'vc-chat-load-error';
            error.className = 'vc-glass';
            error.setAttribute('role', 'alert');
            const span = document.createElement('span');
            span.textContent = '暂时打不开这段对话';
            error.append(span, textButton('重试', () => refreshAll()));
            (chat.parentElement || chat.parent || document.body).append(error);
        }
        show(error);
        hide(skeleton);
        return;
    }
    hide(error);
    if (desktopLayout()) {
        syncDesktopLoad(skeleton, chat);
        return;
    }
    const waiting = !known && !childMes(chat).length && !document.querySelector('#vc-chat-empty')?.textContent?.trim();
    if (waiting) show(skeleton);
    else hide(skeleton);
}

const BUBBLE_SKELETON = [['in', 'w52'], ['out', 'w36'], ['in', 'w64 tall'], ['out', 'w28'], ['in', 'w44']]
    .map(([side, size]) => `<span class="vc-sk-row" data-side="${side}">${side === 'in' ? '<span class="vc-skeleton vc-sk-avatar"></span>' : ''}<span class="vc-skeleton vc-sk-bubble ${size}"></span></span>`).join('');
let loadSince = 0;
let loadTimer = 0;
const SKELETON_DELAY_MS = 300;

/** 桌面会话加载骨架：与真实气泡同尺寸；300ms 内完成就不显示。 */
function syncDesktopLoad(skeleton, chat) {
    if (!skeleton.hasAttribute('data-vc-bubbles')) {
        skeleton.setAttribute('data-vc-bubbles', '');
        skeleton.innerHTML = BUBBLE_SKELETON;
    }
    clearTimeout(loadTimer);
    const shell = document.querySelector('#vc-shell');
    const open = shell?.getAttribute?.('data-chat') === 'open';
    const waiting = shell?.dataset.openState === 'pending'
        || (open && !childMes(chat).length && !document.querySelector('#vc-chat-empty')?.textContent?.trim());
    if (!waiting) {
        loadSince = 0;
        hide(skeleton);
        return;
    }
    if (!loadSince) loadSince = nowMs();
    const elapsed = nowMs() - loadSince;
    if (elapsed >= SKELETON_DELAY_MS) {
        show(skeleton);
        return;
    }
    hide(skeleton);
    loadTimer = setTimeout(() => syncDesktopLoad(skeleton, chat), SKELETON_DELAY_MS - elapsed + 16);
}

function enhanceEmpty() {
    const empty = document.querySelector('#vc-chat-empty');
    if (!empty) return;
    const text = empty.textContent.trim();
    let wrap = document.querySelector('#vc-chat-empty-wrap');
    if (!text || (desktopLayout() && document.querySelector('#vc-shell')?.dataset.openState === 'pending')) {
        hide(wrap);
        return;
    }
    if (!wrap) {
        wrap = document.createElement('div');
        wrap.id = 'vc-chat-empty-wrap';
        wrap.className = 'vc-empty';
        const parent = empty.parentElement || empty.parent;
        insertBefore(parent, wrap, empty);
        moveNode(wrap, empty);
        appendIcon(wrap, 'message-circle', 32);
        const iconNode = wrap.querySelector('.vc-icon');
        if (iconNode && wrap.children[0] !== iconNode) prependNode(wrap, iconNode);
        const action = textButton('', () => {
            if (empty.textContent.trim() === CHAT_PICK_COPY) openCharacters(action);
            else document.querySelector('#send_textarea')?.focus?.();
        });
        wrap.append(action);
    }
    show(wrap);
    const action = wrap.querySelector('button');
    const label = text === CHAT_PICK_COPY ? '选择角色' : '发消息';
    if (action && action.textContent !== label) action.textContent = label;
}

function watchStatus() {
    const status = document.querySelector('#vc-chat-status');
    if (!status || status.getAttribute('data-vc-watch') === 'on') return;
    status.setAttribute('data-vc-watch', 'on');
    watch(status, { childList: true }, () => enhanceStatus());
}

function enhanceStatus() {
    const status = document.querySelector('#vc-chat-status');
    if (!status) return;
    for (const row of status.querySelectorAll?.('.vc-chat-offline, .vc-chat-inbox') || []) {
        addClass(row, 'vc-glass');
        if (row.id === 'vc-chat-budget') ensureTextButton(row, '设置', openModels);
        else if (hasClass(row, 'vc-chat-inbox')) { wrapStatusCopy(row); continue; }
        else ensureTextButton(row, '重试', () => {
            globalThis.dispatchEvent?.(new Event('online'));
            globalThis.dispatchEvent?.(new CustomEvent('vc-chat-retry'));
        });
        wrapStatusCopy(row);
    }
    const model = document.querySelector('.vc-chat-model');
    const unconfigured = model?.textContent?.trim() === '模型待配置';
    let gap = status.querySelector('#vc-chat-unconfigured') || document.querySelector('#vc-chat-unconfigured');
    if (unconfigured) {
        if (!gap) {
            gap = document.createElement('p');
            gap.id = 'vc-chat-unconfigured';
            gap.className = 'vc-chat-offline vc-glass';
            gap.setAttribute('role', 'status');
            const span = document.createElement('span');
            span.textContent = '模型待配置';
            gap.append(span);
            status.append(gap);
        }
        ensureTextButton(gap, '配置', openModels);
        wrapStatusCopy(gap);
    } else if (gap && (gap.parentElement === status || gap.parent === status)) {
        removeNode(gap);
    }
}

function openModels() {
    openPage('models');
}

function wrapStatusCopy(row) {
    if (!row || row.querySelector?.('.vc-status-copy')) return;
    const copy = document.createElement('span');
    copy.className = 'vc-status-copy';
    const nodes = [...(row.childNodes || [])];
    for (const node of nodes) {
        if (node.nodeType === 3 || (node.nodeType === 1 && node.tagName !== 'BUTTON')) copy.append(node);
    }
    if (!copy.textContent) return;
    const button = row.querySelector?.('button');
    if (button) insertBefore(row, copy, button);
    else row.append(copy);
}

function ensureTextButton(row, label, run) {
    if (row.querySelector?.('button')) return;
    row.append(textButton(label, run));
}

function textButton(label, run) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'vc-btn vc-btn-text';
    button.textContent = label;
    button.addEventListener('click', (event) => {
        event.preventDefault?.();
        event.stopPropagation?.();
        run(button);
    });
    return button;
}

function ensureMemorySheetHost() {
    let host = document.querySelector('#vc-memory-sheet-host');
    if (!host) {
        host = document.createElement('div');
        host.id = 'vc-memory-sheet-host';
        host.setAttribute('popover', 'manual');
        document.body.append(host);
    }
    const height = Math.round(Number(globalThis.innerHeight) || Number(globalThis.visualViewport?.height) || 0);
    if (height && host.style) host.style.height = `${height}px`;
    try { host.showPopover?.(); } catch { /* 已经打开，或当前文档不支持 popover */ }
    return host;
}

function currentInspector(entry) { return inspectorEntry === entry && entry.root.isConnected; }
function presentInspector(opener) {
    let entry = inspectorEntry;
    if (!entry) {
        const root = document.createElement('div'); root.id = 'vc-memory-inspector';
        entry = { root, header: null, rail: null, sheet: null, view: null, events: null };
        inspectorEntry = entry;
        const current = entry;
        entry.events = {
            mode(value) { if (currentInspector(current)) { inspectorMode = value; paintInspector(); } },
            draft(value) { if (currentInspector(current)) inspectorPage().setDraft(value); },
            retry() { if (currentInspector(current)) void inspectorPage().loadList(); },
            edit(id) { if (currentInspector(current)) void beginCorrect(id); },
            forget(id) { if (currentInspector(current)) void beginForget(id); },
            save() { if (currentInspector(current)) void inspectorPage().save(); },
            cancel() { if (currentInspector(current)) inspectorPage().cancelEdit(); },
            close() { if (currentInspector(current)) closeInspector(); },
            dispose() {
                if (inspectorEntry === current) { inspectorEntry = null; inspectorMode = 'recall'; }
                current.sheet?.dismiss(); current.rail?.remove(); root.remove();
            },
        };
        if (globalThis.matchMedia?.('(min-width: 744px)')?.matches === true) {
            const rail = document.createElement('aside'); rail.id = 'vc-memory-rail'; rail.setAttribute('aria-label', '记忆');
            const header = document.createElement('header'); rail.append(header, root); document.body.append(rail);
            entry.rail = rail; entry.header = header;
        } else {
            const host = ensureMemorySheetHost();
            entry.sheet = openSheet({ title: '记忆', body: root, root: host, opener: opener || document.activeElement,
                canClose: () => !inspectorPage().state.busy,
                onDone() {
                    try { host.hidePopover?.(); } catch { /* 宿主已卸下 */ }
                    host.remove();
                    if (inspectorEntry === current) closeInspector(); else current.events.dispose();
                },
            });
        }
    }
    const ctl = inspectorPage(), rel = relationshipId(), current = entry;
    const task = !ctl.state.open ? ctl.open(rel) : String(ctl.state.relationshipId) !== String(rel) && rel ? ctl.changeRelationship(rel) : Promise.resolve();
    const paint = () => { if (currentInspector(current)) paintInspector(); return current.root; };
    return Promise.resolve(task).then(paint, paint);
}
function closeInspector() {
    const current = inspectorEntry;
    if (!current) return;
    inspectorEntry = null; inspectorMode = 'recall';
    current.view?.unmount(); current.events.dispose();
}

function inspectorPage() {
    if (!memoryPage) memoryPage = createMemoryPage({ onChange: () => { if (inspectorEntry?.root.isConnected) paintInspector(); } });
    return memoryPage;
}

function relationshipId() {
    const id = safeContext()?.chatMetadata?.vc_binding?.relationshipId;
    return id == null ? '' : String(id);
}

function currentBlock() {
    const row = safeContext()?.extensionPrompts?.[MEMORY_PROMPT];
    return typeof row?.value === 'string' ? row.value : '';
}

function paintInspector() {
    const entry = inspectorEntry;
    if (!entry?.root.isConnected) return;
    const state = inspectorPage().state;
    const rows = inspectorMode === 'all' ? state.items : recalledItems(state.items, currentBlock());
    const props = { header: entry.header, sprite: iconSpriteUrl(), mode: inspectorMode,
        loading: state.loading && !state.items.length, error: state.listError, busy: state.busy,
        items: rows.map(item => ({ id: String(item.memoryId ?? ''), summary: item.summary || '' })),
        editing: state.editing, selected: String(state.selectedId ?? ''), draft: state.draft || '', events: entry.events,
    };
    if (entry.view) entry.view.update(props); else entry.view = mountMemoryInspectorView(entry.root, props);
}

async function beginCorrect(id) {
    const entry = inspectorEntry;
    if (!entry || !currentInspector(entry)) return;
    const ctl = inspectorPage();
    await ctl.select(id);
    if (!currentInspector(entry) || String(ctl.state.selectedId) !== String(id)) return;
    ctl.edit();
}

async function beginForget(id) {
    const entry = inspectorEntry;
    if (!entry || !currentInspector(entry)) return;
    const ok = await confirmAlert({
        title: '删除这条记忆？',
        message: FORGET_NOTICE,
        action: '删除',
        root: inspectorOverlayRoot() || undefined,
        opener: document.activeElement,
    });
    if (!ok || !currentInspector(entry)) return;
    const ctl = inspectorPage();
    await ctl.select(id);
    if (!currentInspector(entry) || String(ctl.state.selectedId) !== String(id)) return;
    if (ctl.state.reauthAction) {
        requestOpenMemory(document.activeElement);
        return;
    }
    await ctl.forget();
    if (currentInspector(entry) && ctl.state.reauthAction) requestOpenMemory(document.activeElement);
}

function clearChildren(node) {
    if (!node) return;
    if (typeof node.replaceChildren === 'function') {
        node.replaceChildren();
        return;
    }
    if (Array.isArray(node.children)) node.children.length = 0;
}

function lastCharacterMessage() {
    return [...childMes(document.querySelector('#chat'))].reverse().find((mes) => !isUser(mes) && !isSystem(mes)) || null;
}

function watch(node, options, fn) {
    if (!node || typeof MutationObserver !== 'function') return null;
    const observer = new MutationObserver(() => fn());
    observer.observe(node, options);
    return observer;
}

function show(node) {
    if (!node) return;
    node.hidden = false;
    node.removeAttribute?.('hidden');
}

function hide(node) {
    if (!node) return;
    node.hidden = true;
    node.setAttribute?.('hidden', '');
}

function writeClasses(node, names) {
    const unique = [...new Set(names.filter(Boolean))];
    node.className = unique.join(' ');
    if (Array.isArray(node._classes)) node._classes = unique;
}

function addClass(node, name) {
    if (!node || hasClass(node, name)) return;
    if (typeof node.classList?.remove === 'function') {
        node.classList.add(name);
        return;
    }
    writeClasses(node, [...String(node.className || '').split(/\s+/), name]);
}

function removeClass(node, name) {
    if (!node || !hasClass(node, name)) return;
    if (typeof node.classList?.remove === 'function') {
        node.classList.remove(name);
        return;
    }
    writeClasses(node, String(node.className || '').split(/\s+/).filter((item) => item !== name));
}

function toggleClass(node, name, on) {
    if (on) addClass(node, name);
    else removeClass(node, name);
}

function hasClass(node, name) {
    return node?.classList?.contains?.(name) === true || node?.className?.split?.(/\s+/)?.includes?.(name) === true;
}

function closest(node, predicate) {
    let current = node;
    while (current) {
        if (predicate(current)) return current;
        current = current.parentElement || current.parent || null;
    }
    return null;
}

function containsNode(root, node) {
    let current = node;
    while (current) {
        if (current === root) return true;
        current = current.parentElement || current.parent || null;
    }
    return false;
}

function insertBefore(parent, node, ref) {
    if (!parent || !node) return;
    if (typeof parent.insertBefore === 'function') {
        parent.insertBefore(node, ref || null);
        return;
    }
    const list = parent.children;
    if (!Array.isArray(list)) {
        parent.append(node);
        return;
    }
    node.parent = parent;
    const index = ref ? list.indexOf(ref) : -1;
    if (index < 0) list.push(node);
    else list.splice(index, 0, node);
}

function prependNode(parent, node) {
    if (!parent || !node) return;
    if (typeof parent.prepend === 'function') {
        parent.prepend(node);
        return;
    }
    const first = parent.children?.[0];
    if (first) insertBefore(parent, node, first);
    else parent.append(node);
}

function moveNode(parent, node) {
    if (!parent || !node) return;
    const old = node.parentElement || node.parent;
    if (old && old !== parent && Array.isArray(old.children)) {
        const index = old.children.indexOf(node);
        if (index >= 0) old.children.splice(index, 1);
    }
    parent.append(node);
}

function removeNode(node) {
    if (!node) return;
    if (typeof node.remove === 'function') {
        node.remove();
        return;
    }
    const parent = node.parent;
    if (!parent?.children) return;
    const index = parent.children.indexOf(node);
    if (index >= 0) parent.children.splice(index, 1);
    node.parent = null;
}
