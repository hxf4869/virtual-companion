// UX-28 建议回复（桌面）：角色回复完成后在输入区上方显示 0–3 个 chip，点击只填入输入框。
// 规格 docs/planning/2026-11-02-ux24-desktop-experience.md §1 UX-28。
// chip 容器放在 #form_sheld 内、#send_form 之前，不碰 #chat；请求失败静默。
import { fetchReplySuggestions } from '../api.js';

export const SUGGEST_KEY = 'vc-reply-suggestions';
export const META_KEY = 'vc_suggestions';
export const MAX_MESSAGES = 8;
export const MAX_CHARS = 500;
export const MAX_ITEMS = 3;
const LABEL = '建议回复';

export function suggestEnabled(storage = globalThis.localStorage) {
    try { return !['off', '0', 'false'].includes(String(storage?.getItem(SUGGEST_KEY) ?? '').toLowerCase()); } catch { return true; }
}

// 去掉 <sticker …/>、<voice/> 等标记后的纯正文。
export function cleanText(text) {
    return String(text ?? '').replace(/<[^<>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS);
}

// 最近 ≤ 8 条非系统消息，旧到新。
export function buildMessages(chat, max = MAX_MESSAGES) {
    const out = [];
    for (const message of Array.isArray(chat) ? chat : []) {
        if (!message || message.is_system) continue;
        const text = cleanText(message.mes);
        if (text) out.push({ role: message.is_user ? 'user' : 'character', text });
    }
    return out.slice(-max);
}

export function normalizeItems(result) {
    const list = Array.isArray(result) ? result : result?.suggestions;
    if (!Array.isArray(list)) return [];
    return list.filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean).slice(0, MAX_ITEMS);
}

// 末条必须是角色的非系统消息，返回其下标；否则 -1。
export function lastCharacterIndex(chat) {
    if (!Array.isArray(chat) || !chat.length) return -1;
    const last = chat[chat.length - 1];
    return last && !last.is_user && !last.is_system && cleanText(last.mes) ? chat.length - 1 : -1;
}

// 保存的建议仍对应当前最后一条角色消息时才可显示。
export function storedFor(chat, metadata) {
    const saved = metadata?.[META_KEY];
    const index = lastCharacterIndex(chat);
    if (index < 0 || !saved || saved.mesid !== index) return [];
    return normalizeItems(saved.items);
}

export function mountSuggest({ getContext, document: doc = globalThis.document, fetchSuggestions = fetchReplySuggestions, storage } = {}) {
    if (!doc?.body || doc.body.getAttribute('data-vc-suggest') === 'on') return null;
    doc.body.setAttribute('data-vc-suggest', 'on');
    const root = doc.defaultView || globalThis;
    const context = () => { try { return getContext?.() || null; } catch { return null; } };
    const desktop = () => doc.documentElement?.dataset?.vcLayout === 'desktop';
    const box = () => doc.querySelector('#send_textarea');
    const enabled = () => suggestEnabled(storage ?? globalThis.localStorage);
    let el = null;
    let token = 0;
    let generating = false;

    function ensureEl() {
        const form = doc.querySelector('#send_form');
        if (!form?.parentElement) return null;
        if (!el || !el.isConnected) {
            el = doc.createElement('div');
            el.id = 'vc-suggest';
            el.setAttribute('role', 'group');
            el.setAttribute('aria-label', LABEL);
            el.hidden = true;
            el.addEventListener('click', (event) => {
                const chip = event.target.closest?.('.vc-suggest-chip');
                if (chip) fill(chip.textContent);
            });
        }
        if (el.nextElementSibling !== form) form.parentElement.insertBefore(el, form);
        return el;
    }

    function hide() {
        if (el) { el.hidden = true; el.replaceChildren(); }
    }

    function show(items) {
        const host = ensureEl();
        if (!host) return;
        if (!items.length || !desktop() || !enabled()) { hide(); return; }
        host.replaceChildren(...items.map((text, index) => {
            const chip = doc.createElement('button');
            chip.type = 'button';
            chip.className = 'vc-suggest-chip';
            chip.style.setProperty('--i', String(index));
            chip.textContent = text;
            return chip;
        }));
        host.hidden = false;
    }

    function fill(text) {
        const input = box();
        hide();
        if (!input) return;
        const proto = Object.getOwnPropertyDescriptor(globalThis.HTMLTextAreaElement.prototype, 'value');
        proto.set.call(input, text);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
        input.setSelectionRange?.(text.length, text.length);
    }

    function forget() {
        token += 1;
        hide();
        const ctx = context();
        if (ctx?.chatMetadata && META_KEY in ctx.chatMetadata) {
            delete ctx.chatMetadata[META_KEY];
            void ctx.saveMetadata?.();
        }
    }

    function restore() {
        token += 1;
        const ctx = context();
        show(ctx ? storedFor(ctx.chat, ctx.chatMetadata) : []);
    }

    async function request() {
        const ctx = context();
        if (!ctx || !desktop() || !enabled()) return;
        const index = lastCharacterIndex(ctx.chat);
        const relationshipId = ctx.chatMetadata?.vc_binding?.relationshipId;
        if (index < 0 || relationshipId == null || relationshipId === '') return;
        const messages = buildMessages(ctx.chat);
        const mine = ++token;
        let items;
        try { items = normalizeItems(await fetchSuggestions(relationshipId, messages)); } catch { return; }
        const now = context();
        // 期间用户发了话、开始新生成或切走会话：结果作废。
        if (mine !== token || generating || !now || lastCharacterIndex(now.chat) !== index) return;
        if (!items.length) return;
        now.chatMetadata = now.chatMetadata || {};
        now.chatMetadata[META_KEY] = { mesid: index, items };
        void now.saveMetadata?.();
        show(items);
    }

    const ctx0 = context();
    const events = ctx0?.eventSource;
    const types = ctx0?.eventTypes || {};
    const on = (name, fn) => { if (name && events?.on) events.on(name, fn); };
    on(types.GENERATION_STARTED, (type, _detail, dryRun) => {
        if (type === 'quiet' || type === 'impersonate' || dryRun) return;
        generating = true;
        forget();
    });
    on(types.GENERATION_ENDED, () => {
        if (!generating) return;
        generating = false;
        setTimeout(() => { void request(); }, 0); // 等最后一条消息写入 chat
    });
    on(types.GENERATION_STOPPED, () => { generating = false; });
    on(types.MESSAGE_SENT, forget);
    on(types.CHAT_CHANGED, () => { generating = false; restore(); });
    doc.addEventListener('input', (event) => {
        if (event.target?.id === 'send_textarea' && event.target.value) hide();
    }, true);
    root.addEventListener?.('resize', () => { if (!desktop()) hide(); });
    return { request, restore, hide, forget };
}
