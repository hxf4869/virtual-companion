// 自有消息操作端口；只调用唯一Session，不点击或创建ST原生控件。
import { COPY, messageMenuPlan, messageInstant, quoteSummary, withQuote, reminderChoices, rfc3339 } from '../../chat-compose.js';
import { createFavorite, createReminder } from '../../api.js';
import { confirmAlert } from '../../ui/alert.js';
import { openSheet } from '../../ui/sheet.js';
import { popMenu } from '../../ui/menu.js';
import { showToast } from '../../ui/toast.js';
import { iconSpriteUrl } from '../../ui/icons.js';
import { chatVoiceAvailable, readReplyAloud } from '../../voice-chat.js';
import { mountEmojiPanelView, mountReactionToolbarView } from '../build/index.js';
import { REACTIONS, searchEmoji, searchStickers, stickerMarkup, pushRecent, readRecent, writeRecent } from '../../chat-react.js';
import { listStickerPicks } from '../../stickers.js';

export function createChatActions({ getContext, getSession, chat, paint }) {
    let quote, menu, sheet, panel, recent = readRecent();
    const voices = new WeakMap();
    const failure = () => showToast(COPY.actionFailed, { type: 'failure' });
    const active = (key, index, message) => key === chat.conversation && chat.messages[index] === message;
    const state = message => {
        let value = voices.get(message);
        if (!value || value.text !== message.mes) { value = { text: message.mes, busy: false, playing: false, failed: false, clip: null }; voices.set(message, value); }
        return value;
    };
    function setQuote(value) {
        quote = value;
        chat.quote = value ? { label: COPY.quote, text: `${value.name ? `${value.name}：` : ''}${quoteSummary(value.text)}`, sprite: chat.sprite,
            close() { setQuote(null); document.querySelector('#send_textarea')?.focus(); } } : null;
        paint();
    }
    const bodyText = message => message.extra?.display_text || message.mes;
    function edit(index, message) {
        const key = chat.conversation, body = document.createElement('div'); body.className = 'vc-column';
        const input = document.createElement('textarea'); input.className = 'vc-input'; input.rows = 10; input.value = message.mes; input.setAttribute('aria-label', '消息内容'); body.append(input);
        sheet = openSheet({ title: COPY.edit, body, isDirty: () => input.value !== message.mes,
            async onSubmit() { if (!active(key, index, message)) return true; return await getSession().edit(index, input.value, message); },
            onDone() { sheet = null; } });
    }
    async function remind(message, at) {
        const id = getContext().chatMetadata.vc_binding?.relationshipId;
        if (!id) return;
        try { await createReminder(String(id), { text: quoteSummary(bodyText(message), 30), remindAt: rfc3339(at) }); showToast(COPY.reminded); } catch { failure(); }
    }
    async function run(action, index, message, anchor) {
        const key = chat.conversation;
        if (!active(key, index, message)) return;
        try {
            const session = getSession();
            if (action === 'more') { openMenu(index, message, anchor); return; }
            if (action === 'copy') { await navigator.clipboard.writeText(bodyText(message)); showToast(COPY.copied); return; }
            if (action === 'quote') { setQuote({ name: message.name, text: bodyText(message) }); document.querySelector('#send_textarea')?.focus(); return; }
            if (action === 'read') { await readReplyAloud(index, state(message), paint); return; }
            if (!chat.canSend || !session) return;
            if (action === 'edit') { edit(index, message); return; }
            if (action === 'remove') {
                if (await confirmAlert({ title: COPY.deleteTitle, message: COPY.deleteBody, action: COPY.remove, opener: anchor }) && active(key, index, message)) await session.remove(index, message);
            } else if (action === 'regen' || action === 'regenerate') {
                if (index === chat.messages.length - 1) await session.regenerate();
            } else if (action === 'continue') {
                if (index === chat.messages.length - 1) await session.continue();
            } else if (action === 'swipe-prev' || action === 'swipe-next') await session.swipe(index, action === 'swipe-prev' ? -1 : 1, message);
            else if (action === 'favorite') {
                const context = getContext(), relationship = context.chatMetadata.vc_binding?.relationshipId;
                if (!relationship) return;
                const at = messageInstant(message.send_date);
                await createFavorite(String(relationship), { chatFile: context.chatId.replace(/\.jsonl$/, ''), mesId: index,
                    role: message.is_user ? 'user' : 'character', ...(at ? { messageAt: at } : {}), body: bodyText(message).trim() });
                showToast(COPY.favorited);
            } else if (action === 'remind') {
                menu?.close(); menu = popMenu(anchor, [
                    ...reminderChoices().map(choice => ({ label: choice.label, run: () => { void remind(message, choice.at); } })),
                    { label: COPY.remindPick, run() {
                        const body = document.createElement('div'), input = document.createElement('input'); input.type = 'datetime-local'; input.className = 'vc-input'; input.setAttribute('aria-label', COPY.remindPick); body.append(input);
                        sheet = openSheet({ title: COPY.remindPick, body, isDirty: () => Boolean(input.value), onSubmit() { const at = new Date(input.value); if (Number.isNaN(at.getTime()) || at <= new Date()) { input.focus(); return false; } return remind(message, at).then(() => true); }, onDone() { sheet = null; } });
                    } },
                ]);
            }
        } catch { failure(); }
    }
    function openMenu(index, message, anchor) {
        menu?.close();
        const character = !message.is_user && !message.is_system, last = index === chat.messages.length - 1;
        const plan = messageMenuPlan({ system: message.is_system, character, last, voice: character && (!chat.busy || index < chat.messages.length - 1) && chatVoiceAvailable(getContext()), busy: chat.busy,
            bound: Boolean(getContext().chatMetadata.vc_binding?.relationshipId) });
        if (character && last && !chat.busy) plan.splice(plan.indexOf('regenerate') + 1, 0, 'continue');
        let reaction; const host = document.createElement('div'); host.id = 'vc-react-bar'; host.className = 'vc-glass';
        menu = popMenu(anchor, plan.map(id => id === '-' ? '-' : { label: COPY[id], danger: id === 'remove', run: () => { void run(id, index, message, anchor); } }), { className: 'vc-compose-menu', onClosed() { reaction?.unmount(); host.remove(); } });
        if (!message.is_system && chat.canSend) {
            document.body.append(host); reaction = mountReactionToolbarView(host, { reactions: REACTIONS, selected: message.extra?.vc_reactions || [] });
            host.addEventListener('click', event => {
                const button = event.target.closest('button'); if (!button) return;
                if (button.dataset.more !== undefined) { menu.close(); emoji(anchor, { index, message }); }
                else if (button.dataset.emoji) { void getSession().react(index, button.dataset.emoji, message); menu.close(); }
            });
            requestAnimationFrame(() => { if (!host.isConnected) return; const rect = menu.menu.getBoundingClientRect(); host.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - host.offsetWidth - 8))}px`; host.style.top = `${Math.max(8, rect.top - host.offsetHeight - 8)}px`; });
        }
    }
    function emoji(anchor, target) {
        panel?.unmount();
        const key = chat.conversation, host = document.createElement('div'); host.style.display = 'contents'; document.body.append(host);
        const props = { mode: target ? 'react' : 'compose', style: {}, groups(query, tab) {
            const entries = target || tab === 'emoji' ? searchEmoji(query).map(([value, label]) => ({ kind: 'e', value, label: label.split(' ')[0], text: value }))
                : searchStickers(query, listStickerPicks()).map(pick => ({ kind: 's', value: pick.tag, label: pick.tag, src: pick.src, text: pick.text }));
            const favorites = query.trim() ? [] : recent.filter(item => item.k === (tab === 'emoji' ? 'e' : 's')).map(item => entries.find(entry => entry.value === item.v)).filter(Boolean);
            return [...(favorites.length ? [{ title: '最近', items: favorites }] : []), { title: '', items: entries }];
        }, pick(kind, value) {
            if (key !== chat.conversation) return;
            recent = pushRecent(recent, { k: kind, v: value }); writeRecent(recent);
            if (target) { if (active(key, target.index, target.message)) void getSession().react(target.index, value, target.message); panel?.unmount(); return; }
            if (kind === 'e') {
                const box = document.querySelector('#send_textarea'), start = box?.selectionStart ?? chat.draft.length, end = box?.selectionEnd ?? start;
                chat.onDraft(chat.draft.slice(0, start) + value + chat.draft.slice(end));
                requestAnimationFrame(() => { box?.focus(); box?.setSelectionRange(start + value.length, start + value.length); });
            } else if (chat.canSend) { void getSession().send(stickerMarkup(value), { draftInput: null }); panel?.unmount(); }
        }, close() { panel?.unmount(); }, returnFocus: () => anchor.isConnected ? anchor : false, dispose() { host.remove(); panel = null; } };
        panel = mountEmojiPanelView(host, props, anchor);
        const rect = anchor.getBoundingClientRect(); props.style = { left: Math.max(8, Math.min(rect.left, innerWidth - panel.el.offsetWidth - 8)), bottom: innerHeight - rect.top + 8 };
        panel.update(props);
    }
    return { run, emoji, send() { const input = chat.draft; void getSession()?.send(withQuote(quote, input), { draftInput: input }); if (getSession()?.busy) setQuote(null); },
        tools(index, message) {
            const character = !message.is_user && !message.is_system, count = message.swipes?.length || 1, last = index === chat.messages.length - 1;
            return { sprite: chat.sprite, character: character && last, read: character && (!chat.busy || !last) && chatVoiceAvailable(getContext()), pager: character && (last || count > 1) ? {
                at: String((message.swipe_id ?? 0) + 1), n: String(count), prev: '上一个候选', next: last ? '下一个候选，或生成新候选' : '下一个候选' } : null,
                voice: state(message), retry: null };
        }, changed() { menu?.close(); sheet?.dismiss(); panel?.unmount(); setQuote(null); },
        destroy() { menu?.close(); sheet?.dismiss(); panel?.unmount(); },
    };
}
