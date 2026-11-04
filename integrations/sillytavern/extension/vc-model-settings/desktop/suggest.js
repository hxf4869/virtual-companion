// UX-28 建议回复（桌面）：角色回复完成后在输入区上方显示 0–3 个 chip，点击只填入输入框。
// 规格 docs/planning/2026-11-02-ux24-desktop-experience.md §1 UX-28。
// chip 容器放在 #form_sheld 内、#send_form 之前，不碰 #chat；请求失败静默。
import { fetchReplySuggestions } from '../api.js';
import { mountSuggestionsView } from './build/index.js';
import {
    SUGGEST_KEY,
    META_KEY,
    MAX_MESSAGES,
    MAX_CHARS,
    MAX_ITEMS,
    suggestEnabled,
    cleanText,
    buildMessages,
    normalizeItems,
    lastCharacterIndex,
    storedFor,
} from '../status-logic.js';

export {
    SUGGEST_KEY,
    META_KEY,
    MAX_MESSAGES,
    MAX_CHARS,
    MAX_ITEMS,
    suggestEnabled,
    cleanText,
    buildMessages,
    normalizeItems,
    lastCharacterIndex,
    storedFor,
};

const LABEL = '建议回复';

export function mountSuggest({ getContext, document: doc = globalThis.document, fetchSuggestions = fetchReplySuggestions, storage } = {}) {
    if (!doc?.body || doc.body.getAttribute('data-vc-suggest') === 'on') return null;
    doc.body.setAttribute('data-vc-suggest', 'on');
    const root = doc.defaultView || globalThis;
    const context = () => { try { return getContext?.() || null; } catch { return null; } };
    const desktop = () => doc.documentElement?.dataset?.vcLayout === 'desktop';
    const box = () => doc.querySelector('#send_textarea');
    const enabled = () => suggestEnabled(storage ?? globalThis.localStorage);
    let el = null, view = null;
    let token = 0;
    let generating = false;

    function ensureEl() {
        const form = doc.querySelector('#send_form');
        if (!form?.parentElement) return null;
        if (!el || !el.isConnected) {
            view?.unmount(); view = null;
            el = doc.createElement('div');
            el.id = 'vc-suggest';
            el.setAttribute('role', 'group');
            el.setAttribute('aria-label', LABEL);
            el.hidden = true;

        }
        if (el.nextElementSibling !== form) form.parentElement.insertBefore(el, form);
        view ||= mountSuggestionsView(el, { items: [], pick: fill });
        return el;
    }

    function hide() {
        if (el) { el.hidden = true; view?.update({ items: [], pick: fill }); }
    }

    function show(items) {
        const host = ensureEl();
        if (!host) return;
        if (!items.length || !desktop() || !enabled()) { hide(); return; }
        view.update({ items, pick: fill });
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
