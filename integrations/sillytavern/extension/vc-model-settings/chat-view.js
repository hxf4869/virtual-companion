// F2 聊天外观。只在 body.vc-ui 时挂载；关闭时不改宿主节点。
// 海报是 #chat 的前一个兄弟（在 #sheld 内绝对定位）。clearChat 只移除 #chat 的子节点。
// 流式渐清：把宿主 powerUserSettings.stream_fade_in 设为 true，不同步设置里的 input 事件，因此不调用 saveSettingsDebounced。
import { CHAT_PICK_COPY, requestShellDestination } from './chat-shell.js';
import { FORGET_NOTICE, createMemoryPage, requestOpenMemory } from './memory-page.js';
import { MEMORY_NOTICE_EVENT, MEMORY_QUIET_COPY } from './memory-injection.js';
import { confirmAlert } from './ui/alert.js';
import { bindSegment } from './ui/controls.js';
import { icon } from './ui/icons.js';
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
import { NEUTRAL_TINT, tintOf } from './ui/tint.js';
import { clearMessageVoice, renderMessageVoice, voicePlayer } from './voice.js';
import { chatVoiceAvailable, readReplyAloud, requestChatVoice } from './voice-chat.js';

export const REPLY_STYLE_KEY = 'vc-reply-style';
export const PRESS_MS = 420;
export const PRESS_SLOP = 8;
export const NEAR_BOTTOM_PX = 80;
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
const PIN_TRIES = 8;
const PIN_MS = 600;
const LAID_OUT_PX = 48;
let lastChatId;
let arrivalsPrimed = false;
let inspectorSegment = null;
let posterFrame = 0;
let scrollFrame = 0;
let chatFrame = 0;
let statusFrame = 0;
let shellFrame = 0;
let generatingMes = null;
let generationLive = false;
let rewriteCount = 0;
let revealMesId = '';
const seenMessages = new WeakSet();
let foldSequence = 0;

export function readReplyStyle(storage) {
    try {
        const store = storage ?? globalThis.localStorage;
        return store?.getItem?.(REPLY_STYLE_KEY) === 'bubble' ? 'bubble' : 'spread';
    } catch {
        return 'spread';
    }
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

export function isNearBottom(metrics, threshold = NEAR_BOTTOM_PX) {
    const height = Number(metrics?.scrollHeight);
    const top = Number(metrics?.scrollTop);
    const client = Number(metrics?.clientHeight);
    if (![height, top, client].every(Number.isFinite)) return true;
    return height - top - client <= threshold;
}

/** 打开后的短时贴底仍用 80px。人已经停在可滚列的最顶上时，即使总溢出还不到 80px，也不再拽回底部。 */
export function keepsTail(metrics, { pin = false, threshold = NEAR_BOTTOM_PX } = {}) {
    const height = Number(metrics?.scrollHeight);
    const top = Number(metrics?.scrollTop);
    const client = Number(metrics?.clientHeight);
    if (![height, top, client].every(Number.isFinite)) return true;
    const gap = height - top - client;
    if (gap <= 1) return true;
    if (!pin && top <= 1) return false;
    return gap <= threshold;
}

export function shouldShowNewReply({ nearBottom, grew = false, pending = false } = {}) {
    if (nearBottom) return false;
    return Boolean(grew || pending);
}

export function pressExceeded(dx, dy, slop = PRESS_SLOP) {
    return Math.hypot(Number(dx) || 0, Number(dy) || 0) > slop;
}

export function isDirectChat(ctx) {
    return !String(ctx?.groupId ?? '').trim();
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

const DATA_IMAGE = /^data:image\/(png|jpeg|webp|gif)(;|,)/i;

export function safeAvatarUrl(value) {
    const raw = String(value ?? '').trim();
    if (!raw || raw.startsWith('//')) return '';
    if (raw.startsWith('/')) return raw;
    if (/^https?:\/\//i.test(raw)) return raw;
    if (DATA_IMAGE.test(raw)) return raw;
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return '';
    return `/thumbnail?type=avatar&file=${encodeURIComponent(raw)}`;
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

export function recalledItems(items, block) {
    const text = String(block || '');
    if (!text.trim()) return [];
    return (Array.isArray(items) ? items : []).filter((item) => typeof item?.summary === 'string' && item.summary.length > 0 && text.includes(item.summary));
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
    ], { below: true });
    if (memoryNotice && menu?.menu) {
        const note = document.createElement('p');
        note.className = 'vc-memory-note';
        note.textContent = memoryNotice;
        if (typeof menu.menu.prepend === 'function') menu.menu.prepend(note);
        else menu.menu.append(note);
    }
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
        rewriteCount = 0;
        revealMesId = '';
        const id = String(safeContext()?.chatId ?? '');
        if (lastChatId && id && id !== lastChatId) {
            userStopped = false;
            generationFailed = false;
        }
        if (id) lastChatId = id;
        armPin();
        refreshAll();
    });
    on(types.MESSAGE_SENT, () => { rewriteCount = 0; });
    on(types.CHARACTER_MESSAGE_RENDERED, (id, type) => {
        const live = generationLive;
        generationLive = false;
        if (live && type !== 'first_message') settleReply(id);
        refreshAll();
    });
    on(types.MESSAGE_SWIPED, () => { refreshMessages(); followIfNeeded(); });
    on(types.GENERATION_STARTED, (type, _detail, dryRun) => {
        noteTurn(type || 'normal');
        // 宿主 PromptManager 在生成结束后用 dryRun 的 Generate('normal') 重算上下文，
        // 仍会发出 GENERATION_STARTED。那不是用户新发的一轮，不能清掉「已停止」。
        if (type === 'quiet' || type === 'impersonate' || dryRun) return;
        generationLive = true;
        userStopped = false;
        generationFailed = false;
        syncGenerating();
    });
    on(types.GENERATION_STOPPED, () => {
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
    const fromMes = safeAvatarUrl(document.querySelector('#chat .mes .avatar img')?.getAttribute?.('src'));
    if (fromMes) return fromMes;
    return safeAvatarUrl(character?.avatar || ctx?.characters?.[ctx?.characterId]?.avatar);
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
            if (arrivalsPrimed && isUser(mes)) addClass(mes, 'vc-arrive');
        }
        ensureTools(mes, { character: !isUser(mes) && !isSystem(mes) });
    }
    if (!streaming) arrivalsPrimed = true;
    syncGenerating();
    paintReplyMessages(list);
}

function ensureTools(mes, { character }) {
    let tools = mes.querySelector?.('.vc-mes-tools');
    if (!tools) {
        tools = document.createElement('div');
        tools.className = 'vc-mes-tools';
        mes.append(tools);
    }
    const swipe = swipeLabel(mes);
    let pager = tools.querySelector('[data-vc-pager]');
    if (character && swipe) {
        if (!pager) {
            pager = document.createElement('div');
            pager.className = 'vc-mes-pager';
            pager.setAttribute('data-vc-pager', '');
            pager.innerHTML = `<button type="button" data-vc-act="swipe-prev" aria-label="上一个候选">${icon('chevron-left', { size: 18 })}</button><span class="vc-num"></span><button type="button" data-vc-act="swipe-next" aria-label="下一个候选">${icon('chevron-right', { size: 18 })}</button>`;
            prependNode(tools, pager);
        }
        const num = pager.querySelector('.vc-num');
        const text = `${swipe.at}/${swipe.n}`;
        if (num && num.textContent !== text) num.textContent = text;
    } else if (pager) {
        removeNode(pager);
    }
    ensureAct(tools, 'regen', 'refresh-cw', '重新生成', character);
    ensureAct(tools, 'edit', 'pencil', '编辑', true);
    ensureAct(tools, 'copy', 'copy', '复制', true);
    ensureAct(tools,'read','volume-2','朗读',character && companionMode() && chatVoiceAvailable(safeContext()));
    if (!tools.querySelector('.vc-mes-gap')) {
        const gap = document.createElement('span');
        gap.className = 'vc-mes-gap';
        const firstAct = tools.querySelector('[data-vc-act="regen"], [data-vc-act="edit"]');
        if (firstAct) insertBefore(tools, gap, firstAct);
        else tools.append(gap);
    }
}

function ensureAct(tools, act, glyph, label, show) {
    let button = tools.querySelector(`[data-vc-act="${act}"]`);
    if (!show) {
        removeNode(button);
        return;
    }
    if (button) return;
    button = document.createElement('button');
    button.type = 'button';
    button.dataset.vcAct = act;
    button.setAttribute('data-vc-act', act);
    button.setAttribute('aria-label', label);
    button.innerHTML = icon(glyph, { size: 18 });
    tools.append(button);
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
    if(act==='read'){void readReplyAloud(Number(mes.getAttribute('mesid')),mes.querySelector('[data-vc-act="read"]'));return;}
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
        mes.querySelector('.mes_copy')?.click();
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
    const burst = createSendBurst({
        onFlush(text) {
            bypass = true;
            try {
                writeBox(box, text);
                send.click();
            } finally {
                bypass = false;
            }
        },
    });
    const queue = (event) => {
        if (bypass || !companionMode()) return;
        const text = String(box.value || '');
        if (!shouldQueueSend(text, burst.pending())) return;
        event.preventDefault?.();
        event.stopPropagation?.();
        event.stopImmediatePropagation?.();
        writeBox(box, '');
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

function clearReplyBubbles(mes) {
    removeNode(mes.querySelector?.('.vc-segs'));
    removeClass(mes, 'vc-segmented');
    mes.removeAttribute?.('data-vc-segs');
    mes.querySelector?.('.mes_text')?.removeAttribute?.('aria-hidden');
}

function segmentMark(segment) {
    if (segment && typeof segment === 'object' && segment.type === 'sticker') {
        return `sticker:${segment.tag || ''}:${segment.kind || ''}:${segment.text || segment.src || ''}`;
    }
    return String(segment ?? '');
}

function appendReplySegment(box, segment) {
    if (segment && typeof segment === 'object' && segment.type === 'sticker') {
        const node = document.createElement('div');
        node.className = 'vc-sticker-bubble';
        node.setAttribute('data-vc-sticker', segment.tag || '');
        if (segment.kind === 'kaomoji') {
            const span = document.createElement('span');
            span.className = 'vc-sticker-kaomoji';
            span.textContent = segment.text || '';
            node.append(span);
        } else {
            const img = document.createElement('img');
            img.alt = segment.tag || '';
            img.src = segment.src || '';
            node.append(img);
        }
        box.append(node);
        return;
    }
    const text = String(segment ?? '');
    const seg = document.createElement('p');
    seg.className = text.startsWith('<sticker') ? 'vc-seg vc-seg-sticker' : 'vc-seg';
    seg.textContent = text;
    box.append(seg);
}

export function renderReplyBubbles(mes, text, { reducedMotion = false, schedule = setTimeout } = {}) {
    if (!mes) return;
    const segments = splitReply(String(text ?? ''));
    const prose = segments.filter((item) => typeof item === 'string' && !item.startsWith('<sticker')).join('\n');
    const foldable = [...prose].length > 360;
    if (segments.length <= 1 && !foldable) {
        clearReplyBubbles(mes);
        return;
    }
    const key = segments.map(segmentMark).join('\u0001');
    const existing = mes.querySelector?.('.vc-segs');
    if (mes.getAttribute?.('data-vc-segs') === key && existing) return;
    clearReplyBubbles(mes);
    mes.setAttribute?.('data-vc-segs', key);
    addClass(mes, 'vc-segmented');
    const textEl = mes.querySelector?.('.mes_text');
    textEl?.setAttribute?.('aria-hidden', 'true');
    const box = document.createElement('div');
    box.className = 'vc-segs';
    const parent = textEl?.parentElement || textEl?.parent || mes;
    if (textEl) insertBefore(parent, box, textEl.nextSibling || null);
    else parent.append?.(box);
    if (foldable) {
        const content = document.createElement('div');
        content.className = 'vc-segs';
        content.id = `vc-reply-full-${++foldSequence}`;
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'vc-btn vc-btn-text vc-reply-expand';
        toggle.setAttribute('aria-controls', content.id);
        let expanded = false;
        const paintFold = () => {
            clearChildren(content);
            const visible = expanded ? segments : splitReply(`${[...prose].slice(0,180).join('')}…`);
            for (const segment of visible) appendReplySegment(content, segment);
            if (!expanded) for (const segment of segments.filter((item) => typeof item === 'object' || item.startsWith('<sticker'))) appendReplySegment(content, segment);
            toggle.setAttribute('aria-expanded', String(expanded));
            toggle.textContent = expanded ? '收起' : '展开全文';
        };
        toggle.addEventListener('click', () => { expanded = !expanded; paintFold(); });
        box.append(content,toggle);
        paintFold();
        return;
    }
    const paint = (count, typing) => {
        clearChildren(box);
        for (let index = 0; index < count; index += 1) appendReplySegment(box, segments[index]);
        if (typing) {
            const note = document.createElement('p');
            note.className = 'vc-typing';
            note.setAttribute('role', 'status');
            note.textContent = TYPING_COPY;
            box.append(note);
        }
    };
    if (reducedMotion || prefersReducedMotion()) {
        paint(segments.length, false);
        return;
    }
    let spent = 0;
    const step = (index) => {
        if (mes.getAttribute?.('data-vc-segs') !== key) return;
        paint(index + 1, index + 1 < segments.length);
        if (index + 1 >= segments.length) return;
        const delay = typingDelay(segmentMark(segments[index + 1]), index + 1, { spentMs: spent });
        spent += delay;
        schedule(() => step(index + 1), delay);
    };
    const first = typingDelay(segments[0], 0, { spentMs: 0 });
    paint(0, true);
    spent = first;
    schedule(() => step(0), first);
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
        armRewrite(plan.hint);
        regenerate();
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
    if (tier) { message.extra ||= {}; message.extra.vc_reply_length_tier = tier; }
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
    const opened = popMenu(ghost, items, { blur: true, below });
    const finish = () => {
        removeNode(ghost);
        removeClass(mes, 'vc-lift-source');
    };
    opened?.scrim?.addEventListener?.('click', finish);
    opened?.menu?.addEventListener?.('click', () => setTimeout(finish, 260));
    document.addEventListener?.('keydown', function onKey(event) {
        if (event.key !== 'Escape') return;
        document.removeEventListener?.('keydown', onKey, true);
        finish();
    }, true);
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
        const max = readMaxHeight(box);
        box.style.height = 'auto';
        const next = Math.min(max, Number(box.scrollHeight) || 0);
        if (next) box.style.height = `${next}px`;
        const idle = !String(box.value || '').trim();
        toggleClass(form, 'vc-send-idle', idle);
    };
    box.addEventListener('input', fit);
    fit();
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

function armPin() {
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
    if (!shell) return;
    watch(shell, { attributes: true, attributeFilter: ['data-chat'] }, () => {
        if (shell.getAttribute?.('data-chat') !== 'open') {
            chatWasLaidOut = false;
            return;
        }
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
    const last = [...list].reverse().find((mes) => !isUser(mes) && !isSystem(mes));
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
    if (on) {
        hide(line);
        return;
    }
    if (userStopped) {
        line.textContent = '已停止';
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
    const waiting = !known && !childMes(chat).length && !document.querySelector('#vc-chat-empty')?.textContent?.trim();
    if (waiting) show(skeleton);
    else hide(skeleton);
}

function enhanceEmpty() {
    const empty = document.querySelector('#vc-chat-empty');
    if (!empty) return;
    const text = empty.textContent.trim();
    let wrap = document.querySelector('#vc-chat-empty-wrap');
    if (!text) {
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

function presentInspector(opener) {
    const wide = globalThis.matchMedia?.('(min-width: 744px)')?.matches === true;
    let root = document.querySelector('#vc-memory-inspector');
    if (!root) {
        root = document.createElement('div');
        root.id = 'vc-memory-inspector';
        root.innerHTML = '<div class="vc-segment"><i class="vc-segment-thumb"></i><button type="button" aria-pressed="true">本次召回</button><button type="button">全部</button></div><div data-vc-memory-list></div>';
        bindInspectorSegment(root.querySelector('.vc-segment'));
    }
    if (wide) {
        let rail = document.querySelector('#vc-memory-rail');
        if (!rail) {
            rail = document.createElement('aside');
            rail.id = 'vc-memory-rail';
            rail.setAttribute('aria-label', '记忆');
            rail.innerHTML = '<header><h2>记忆</h2></header>';
            const done = textButton('完成', () => closeInspector());
            rail.querySelector('header').append(done);
            rail.append(root);
            document.body.append(rail);
        }
    } else if (!root.isConnected) {
        const host = ensureMemorySheetHost();
        openSheet({
            title: '记忆',
            body: root,
            root: host,
            opener: opener || document.activeElement,
            onDone: () => {
                try { host.hidePopover?.(); } catch { /* 宿主已卸下 */ }
                host.remove();
                closeInspector();
            },
        });
    }
    const ctl = inspectorPage();
    const rel = relationshipId();
    const task = !ctl.state.open ? ctl.open(rel) : (String(ctl.state.relationshipId) !== String(rel) && rel ? ctl.changeRelationship(rel) : Promise.resolve());
    return Promise.resolve(task).then(() => { paintInspector(); return root; }).catch(() => { paintInspector(); return root; });
}

function bindInspectorSegment(segment) {
    inspectorSegment?.dispose?.();
    inspectorSegment = null;
    if (!segment || typeof bindSegment !== 'function') return;
    inspectorSegment = bindSegment(segment, {
        onChange: (index) => {
            inspectorMode = index === 1 ? 'all' : 'recall';
            paintInspector();
        },
    });
}

function closeInspector() {
    inspectorSegment?.dispose?.();
    inspectorSegment = null;
    removeNode(document.querySelector('#vc-memory-rail'));
    inspectorMode = 'recall';
}

function inspectorPage() {
    if (!memoryPage) memoryPage = createMemoryPage({ onChange: () => { if (document.querySelector('#vc-memory-inspector')) paintInspector(); } });
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
    const list = document.querySelector('#vc-memory-inspector [data-vc-memory-list]');
    if (!list) return;
    const state = inspectorPage().state;
    clearChildren(list);
    if (state.loading && !state.items.length) {
        list.append(skeletonBlock());
        return;
    }
    if (state.listError) {
        const block = document.createElement('div');
        block.className = 'vc-empty';
        appendIcon(block, 'circle-alert', 32);
        const p = document.createElement('p');
        p.textContent = state.listError;
        block.append(p, textButton('重试', () => { void inspectorPage().loadList(); }));
        list.append(block);
        return;
    }
    const rows = inspectorMode === 'all' ? state.items : recalledItems(state.items, currentBlock());
    if (!rows.length) {
        const block = document.createElement('div');
        block.className = 'vc-empty';
        appendIcon(block, 'brain', 32);
        const p = document.createElement('p');
        p.textContent = inspectorMode === 'all' ? '没有相关记忆' : '这次没有召回';
        block.append(p, textButton('刷新', () => { void inspectorPage().loadList(); }));
        list.append(block);
        return;
    }
    const group = document.createElement('div');
    group.className = 'vc-group';
    for (const item of rows) group.append(memoryRow(item, state));
    list.append(group);
}

function skeletonBlock() {
    const row = document.createElement('div');
    row.className = 'vc-skeleton-row';
    row.innerHTML = '<span class="vc-skeleton vc-skeleton-line"></span><span class="vc-skeleton vc-skeleton-line is-short"></span>';
    return row;
}

function memoryRow(item, state) {
    const row = document.createElement('div');
    row.className = 'vc-cell';
    const id = String(item.memoryId ?? '');
    row.setAttribute('data-memory-id', id);
    if (state.editing && String(state.selectedId) === id) {
        const box = document.createElement('textarea');
        box.setAttribute('aria-label', '纠正记忆');
        box.value = state.draft || item.summary || '';
        box.addEventListener('input', () => inspectorPage().setDraft(box.value));
        const save = textButton('保存', () => { void inspectorPage().save(); });
        const cancel = textButton('取消', () => inspectorPage().cancelEdit());
        row.append(box, save, cancel);
        return row;
    }
    const grow = document.createElement('div');
    grow.className = 'vc-grow';
    grow.textContent = item.summary || '';
    const correct = textButton('纠正', () => { void beginCorrect(id); });
    const remove = textButton('删除', () => { void beginForget(id); });
    addClass(remove, 'is-danger');
    row.append(grow, correct, remove);
    return row;
}

async function beginCorrect(id) {
    const ctl = inspectorPage();
    await ctl.select(id);
    ctl.edit();
}

async function beginForget(id) {
    const ok = await confirmAlert({
        title: '删除这条记忆？',
        message: FORGET_NOTICE,
        action: '删除',
        root: inspectorOverlayRoot() || undefined,
        opener: document.activeElement,
    });
    if (!ok) return;
    const ctl = inspectorPage();
    await ctl.select(id);
    if (ctl.state.reauthAction) {
        requestOpenMemory(document.activeElement);
        return;
    }
    await ctl.forget();
    if (ctl.state.reauthAction) requestOpenMemory(document.activeElement);
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
