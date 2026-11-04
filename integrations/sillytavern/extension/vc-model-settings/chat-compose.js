// UX-23 桌面聊天的右键菜单、引用、「+」菜单、输入框高度、草稿与发送失败。
// 只在 html[data-vc-layout="desktop"] 生效；手机的长按抬起、宿主选项菜单保持原样。
// 所有动作转发宿主原生入口；不往 .mes_text 子树和 #chat 插节点。
import { createFavorite, createReminder } from './api.js';
import { commitHostDelete, setMessageRetry, readMessageAloud } from './chat-view.js';
import { glyph } from './favorites-page.js';
import { confirmAlert } from './ui/alert.js';
import { iconSpriteUrl } from './ui/icons.js';
import { mountQuoteView } from './desktop/build/index.js';
import { popMenu } from './ui/menu.js';
import { showToast } from './ui/toast.js';
import { chatVoiceAvailable } from './voice-chat.js';
import {
    QUOTE_MAX,
    SLOW_MS,
    COMPOSE_COPY as COPY,
    REMIND_MAX,
    COMPOSER_MAX_LINES,
    quoteSummary,
    quoteLine,
    withQuote,
    draftKey,
    readDraft,
    writeDraft,
    sendsOnEnter,
    takesError,
    isCopiedToast,
    messageMenuPlan,
    rfc3339,
    reminderChoices,
    messageInstant,
    composerHeight,
} from './chat-logic.js';

export {
    QUOTE_MAX,
    SLOW_MS,
    COPY,
    REMIND_MAX,
    quoteSummary,
    quoteLine,
    withQuote,
    draftKey,
    readDraft,
    writeDraft,
    sendsOnEnter,
    takesError,
    isCopiedToast,
    messageMenuPlan,
    rfc3339,
    reminderChoices,
    messageInstant,
    composerHeight,
};

const DRAFT_MS = 500;

// ---- 挂载 ----

export function mountChatCompose({ getContext, document: doc = document } = {}) {
    if (!doc?.body?.classList?.contains('vc-ui')) return { enabled: false };
    if (doc.body.getAttribute('data-vc-chat-compose') === 'on') return { enabled: true };
    doc.body.setAttribute('data-vc-chat-compose', 'on');
    ensureCss(doc);

    // 在 window 的捕获阶段接管：chat-view 的发送合并挂在 document 捕获上，会先吞掉回车。
    const root = doc.defaultView || globalThis;
    const context = () => { try { return getContext?.() || null; } catch { return null; } };
    const desktop = () => doc.documentElement.getAttribute('data-vc-layout') === 'desktop';
    const chatId = () => { const ctx = context(); return String(ctx?.getCurrentChatId?.() ?? ctx?.chatId ?? ''); };
    const generating = () => doc.body.getAttribute('data-generating') === 'true';
    const box = () => doc.querySelector('#send_textarea');

    let quote = null, quoteView = null, quoteBar = null;
    let pendingDraft = null;
    let draftTimer = 0;
    let currentId = chatId();
    let pendingSend = null;
    let failed = null;
    let slowTimer = 0;
    let menuAnchor = null;

    // ---- 输入框 ----
    function setValue(el, value) {
        const proto = Object.getOwnPropertyDescriptor(globalThis.HTMLTextAreaElement.prototype, 'value');
        proto.set.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function fit(el) {
        if (!desktop()) return;
        const style = getComputedStyle(el);
        const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.5 || 25;
        const padding = (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0);
        el.style.height = '0px';
        const contentHeight = el.scrollHeight;
        const min = Number.parseFloat(style.minHeight) || 0;
        const height = composerHeight({ contentHeight, lineHeight, padding, min });
        el.style.setProperty('max-height', `${Math.round(lineHeight * COMPOSER_MAX_LINES + padding)}px`, 'important'); // 压过 chat-view.css 的 140px !important
        el.style.height = `${height}px`;
        el.style.overflowY = contentHeight > height ? 'auto' : 'hidden';
    }

    function bindBox() {
        const el = box();
        if (!el || el.getAttribute('data-vc-compose') === 'on') return;
        el.setAttribute('data-vc-compose', 'on');
        const proto = Object.getOwnPropertyDescriptor(globalThis.HTMLTextAreaElement.prototype, 'value');
        // 宿主发送后用 jQuery .val('') 清空，不触发 input；在赋值处补一次回缩。
        Object.defineProperty(el, 'value', {
            configurable: true,
            get() { return proto.get.call(this); },
            set(next) { proto.set.call(this, next); fit(this); },
        });
        el.addEventListener('input', () => {
            fit(el);
            queueDraft(el.value);
        });
        globalThis.addEventListener('resize', () => fit(el));
        fit(el);
    }

    // ---- 草稿 ----
    function flushDraft() {
        clearTimeout(draftTimer);
        draftTimer = 0;
        if (!pendingDraft) return;
        const { id, text } = pendingDraft;
        pendingDraft = null;
        writeDraft(id, text);
        doc.dispatchEvent(new CustomEvent('vc-draft-changed', { detail: { chatId: id, text } }));
    }

    function queueDraft(text) {
        const id = chatId();
        if (!id || !desktop()) return;
        pendingDraft = { id, text };
        clearTimeout(draftTimer);
        draftTimer = setTimeout(flushDraft, DRAFT_MS);
    }

    function restoreDraft() {
        const el = box();
        if (!el || !desktop()) return;
        const text = readDraft(currentId);
        if (el.value !== text) setValue(el, text);
    }

    // ---- 引用 ----
    function paintQuote() {
        if (!quote) { quoteView?.unmount(); quoteView = null; quoteBar?.remove(); quoteBar = null; return; }
        if (!quoteBar?.isConnected) {
            const form = doc.querySelector('#send_form'), parent = form?.parentElement;
            if (!parent) return;
            quoteView?.unmount(); quoteView = null;
            quoteBar = doc.createElement('div'); quoteBar.id = 'vc-quote-bar'; parent.insertBefore(quoteBar, form);
        }
        const props = { label: COPY.quote, text: `${quote.name ? `${quote.name}：` : ''}${quoteSummary(quote.text)}`, sprite: iconSpriteUrl(), close() { setQuote(null); box()?.focus(); } };
        if (quoteView) quoteView.update(props); else quoteView = mountQuoteView(quoteBar, props);
    }

    function setQuote(next) {
        quote = next;
        paintQuote();
    }

    // ---- 消息右键菜单 ----
    const isUser = (mes) => mes.getAttribute('is_user') === 'true';
    const isSystem = (mes) => mes.getAttribute('is_system') === 'true';
    const messages = () => [...(doc.querySelector('#chat')?.children || [])].filter((node) => node.classList?.contains('mes'));
    function messageFrom(target) {
        const mes = target?.closest?.('.mes');
        return mes && mes.parentElement?.id === 'chat' ? mes : null;
    }
    function skipTarget(target) {
        return Boolean(target?.closest?.('button, a, input, textarea, select, .vc-mes-tools, .mes_buttons, .mes_edit_buttons, .swipes-counter, .mes_swipe_picker, .swipe_left, .swipe_right'));
    }
    function messageText(mes) {
        const id = Number(mes.getAttribute('mesid'));
        const raw = context()?.chat?.[id]?.mes;
        return typeof raw === 'string' ? raw : (mes.querySelector('.mes_text')?.textContent || '');
    }
    function speakerName(mes) {
        if (isUser(mes)) return context()?.name1 || mes.getAttribute('ch_name') || '';
        return mes.getAttribute('ch_name') || context()?.name2 || '';
    }
    function companionVoice(mes) {
        const ctx = context();
        if (!ctx || ctx.groupId || ctx.chatMetadata?.vc_binding?.mode !== 'COMPANION') return false;
        return !isUser(mes) && !isSystem(mes) && Boolean(chatVoiceAvailable(ctx));
    }
    function regenerate() {
        const button = doc.querySelector('#option_regenerate');
        if (button) { button.click(); return; }
        const generate = context()?.generate;
        if (typeof generate === 'function') generate('regenerate');
    }
    async function removeMessage(mes) {
        const ok = await confirmAlert({ title: COPY.deleteTitle, message: COPY.deleteBody, action: COPY.remove, opener: doc.activeElement });
        if (!ok) return;
        const planned = commitHostDelete(mes, context());
        try {
            if (!planned.ok) throw new Error('delete');
            await planned.run();
        } catch {
            showToast(COPY.deleteFailed, { type: 'failure' });
        }
    }
    function copyMessage(mes) {
        // 宿主复制挂在 .mes_copy 的 pointerup 上；成功后宿主发「Copied!」，由 toastr 接管统一提示。
        mes.querySelector('.mes_copy')?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    }

    // ---- 收藏与稍后提醒（UX-32） ----
    const relationshipOf = () => {
        const id = context()?.chatMetadata?.vc_binding?.relationshipId;
        return id === undefined || id === null || id === '' ? '' : String(id);
    };
    const bound = () => Boolean(relationshipOf() && chatId());
    function actionFailed() { showToast(COPY.actionFailed, { type: 'failure' }); }
    async function favoriteMessage(mes) {
        const id = Number(mes.getAttribute('mesid'));
        const body = messageText(mes).trim();
        if (!body || !Number.isInteger(id) || !bound()) return;
        const messageAt = messageInstant(context()?.chat?.[id]?.send_date);
        try {
            await createFavorite(relationshipOf(), {
                chatFile: chatId().replace(/\.jsonl$/, ''),
                mesId: id,
                role: isUser(mes) ? 'user' : 'character',
                ...(messageAt ? { messageAt } : {}),
                body,
            });
            showToast(COPY.favorited);
        } catch { actionFailed(); }
    }
    async function remindMessage(mes, at) {
        const text = quoteSummary(messageText(mes), REMIND_MAX);
        if (!text || !bound()) return;
        try {
            await createReminder(relationshipOf(), { text, remindAt: rfc3339(at) });
            showToast(COPY.reminded);
        } catch { actionFailed(); }
    }
    // 原生时间选择：隐形输入框放在菜单旁，选定后创建提醒。
    function pickReminderTime(mes, rect) {
        const input = doc.createElement('input');
        input.type = 'datetime-local';
        input.setAttribute('aria-label', COPY.remindPick);
        input.min = `${rfc3339(new Date()).slice(0, 16)}`;
        Object.assign(input.style, { position: 'fixed', left: `${rect?.left ?? 0}px`, top: `${rect?.top ?? 0}px`, width: '1px', height: '1px', opacity: '0', pointerEvents: 'none' });
        doc.body.append(input);
        const done = () => input.remove();
        input.addEventListener('change', () => {
            const at = new Date(input.value);
            done();
            if (!Number.isNaN(at.getTime())) void remindMessage(mes, at);
        });
        input.addEventListener('blur', () => setTimeout(done, 300));
        input.focus();
        try { input.showPicker?.(); } catch { input.click(); }
    }
    // 二级菜单：主菜单收起后在原位置右侧弹出时间选项。
    function openRemindMenu(mes, rect) {
        const anchor = anchorAt((rect?.right ?? 0) + 4, (rect?.top ?? 0) - 8);
        const items = [
            ...reminderChoices().map((choice) => ({ label: choice.label, run: () => { void remindMessage(mes, choice.at); } })),
            { label: COPY.remindPick, run: () => pickReminderTime(mes, rect) },
        ];
        popMenu(anchor, items, { below: true, className: 'vc-compose-menu' });
    }

    const ACTIONS = {
        favorite: { label: COPY.favorite, glyph: 'star', run: (mes) => { void favoriteMessage(mes); } },
        remind: { label: COPY.remind, icon: 'chevron-right', run: () => {} },
        quote: { label: COPY.quote, icon: 'quote', run: (mes) => { setQuote({ name: speakerName(mes), text: messageText(mes) }); box()?.focus(); } },
        copy: { label: COPY.copy, icon: 'copy', run: copyMessage },
        read: { label: COPY.read, icon: 'volume-2', run: (mes) => { void readMessageAloud(mes); } },
        edit: { label: COPY.edit, icon: 'pencil', run: (mes) => mes.querySelector('.mes_edit')?.click() },
        regenerate: { label: COPY.regenerate, icon: 'refresh-cw', run: regenerate },
        remove: { label: COPY.remove, icon: 'trash-2', danger: true, run: (mes) => { void removeMessage(mes); } },
    };

    function anchorAt(x, y) {
        if (!menuAnchor || !menuAnchor.isConnected) {
            menuAnchor = doc.createElement('div');
            menuAnchor.id = 'vc-ctx-anchor';
            menuAnchor.setAttribute('aria-hidden', 'true');
            doc.body.append(menuAnchor);
        }
        menuAnchor.style.left = `${x}px`;
        menuAnchor.style.top = `${y}px`;
        return menuAnchor;
    }

    let lifted = null;

    function unlift() {
        const was = lifted;
        lifted?.classList.remove('vc-ctx-target');
        lifted = null;
        if (was) doc.dispatchEvent(new CustomEvent('vc-menu-closed', { detail: { mes: was } })); // UX-26 回应条随菜单收起
    }

    function openMessageMenu(mes, event) {
        unlift();
        const list = messages();
        const plan = messageMenuPlan({
            system: isSystem(mes),
            character: !isUser(mes) && !isSystem(mes),
            last: list.at(-1) === mes,
            voice: companionVoice(mes),
            busy: generating(),
            bound: bound(),
        });
        let opened = null;
        const items = plan.map((id, index) => {
            if (id === '-') return '-';
            if (id === 'remind') {
                return { ...ACTIONS[id], run: () => openRemindMenu(mes, opened?.menu?.querySelector(`[data-i="${index}"]`)?.getBoundingClientRect()) };
            }
            return { ...ACTIONS[id], mark: ACTIONS[id].glyph ? glyph(ACTIONS[id].glyph, 19) : undefined, run: () => ACTIONS[id].run(mes) };
        });
        const below = event.clientY < globalThis.innerHeight * 0.6;
        // popMenu 以锚点为界上下偏 8px；锚点放在指针上下 8px，菜单边缘正好贴在指针处。
        const anchor = anchorAt(event.clientX, below ? event.clientY - 8 : event.clientY + 8);
        opened = popMenu(anchor, items, { below, className: 'vc-compose-menu', onClose: unlift });
        lifted = mes;
        mes.classList.add('vc-ctx-target');
        doc.dispatchEvent(new CustomEvent('vc-menu-opened', { detail: { mes, close: opened.close } })); // UX-26 在菜单上方加回应条

    }

    root.addEventListener('contextmenu', (event) => {
        if (!desktop()) return;
        const mes = messageFrom(event.target);
        if (!mes || skipTarget(event.target) || mes.classList.contains('vc-selectable')) return;
        event.preventDefault();
        event.stopPropagation(); // 手机长按的克隆抬起挂在 #chat 上，桌面不走它
        openMessageMenu(mes, event);
    }, true);

    // 桌面鼠标按住不触发手机长按抬起。
    root.addEventListener('pointerdown', (event) => {
        if (!desktop() || event.pointerType !== 'mouse') return;
        const mes = messageFrom(event.target);
        if (mes && !skipTarget(event.target)) event.stopPropagation();
    }, true);

    // ---- 「+」菜单 ----
    function openPlusMenu(plus) {
        const items = [];
        const hostItem = (id, label, glyph) => {
            const node = doc.querySelector(`#${id}`);
            if (!node || node.classList.contains('displayNone')) return;
            items.push({ label, icon: glyph, run: () => node.click() });
        };
        hostItem('option_regenerate', COPY.regenerate, 'refresh-cw');
        hostItem('option_continue', COPY.continue, 'play');
        if (items.length) popMenu(plus, items, { below: false, className: 'vc-compose-menu' });
    }

    // ---- 发送：引用前缀、记录原文 ----
    function onSendIntent() {
        const el = box();
        if (!el || generating()) return;
        let text = el.value;
        if (!text.trim()) return;
        if (quote) {
            text = withQuote(quote, text);
            setValue(el, text);
            setQuote(null);
        }
        pendingSend = { text, length: context()?.chat?.length ?? 0 };
    }

    root.addEventListener('click', (event) => {
        if (!desktop()) return;
        const plus = event.target?.closest?.('#options_button');
        if (plus) {
            event.preventDefault();
            event.stopImmediatePropagation(); // 不让宿主弹出原生黑色菜单
            openPlusMenu(plus);
            return;
        }
        if (event.target?.closest?.('#send_but')) onSendIntent();
    }, true);

    root.addEventListener('keydown', (event) => {
        if (!desktop() || event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return;
        if (event.target !== box() || !sendsOnEnter(context()?.powerUserSettings)) return;
        onSendIntent();
    }, true);

    // ---- 失败与慢提示 ----
    function clearFailure() {
        if (!failed) return;
        failed.removeAttribute('data-vc-failed');
        setMessageRetry(failed, null);
        failed = null;
    }

    function retry() {
        clearFailure();
        regenerate();
    }

    function paintFailure(mes) {
        clearFailure();
        failed = mes;
        mes.setAttribute('data-vc-failed', 'true');
        setMessageRetry(mes, { failed: COPY.failed, label: COPY.retry, run: retry });
    }

    function onGenerationFailed() {
        const ctx = context();
        const landed = !pendingSend || (ctx?.chat?.length ?? 0) > pendingSend.length;
        if (!landed) {
            // 用户消息没有落地：原文回填输入框，让它不丢。
            const el = box();
            if (el && !el.value.trim()) setValue(el, pendingSend.text);
            pendingSend = null;
            showToast(COPY.failed, { type: 'failure' });
            return;
        }
        const lastUser = messages().findLast(isUser);
        if (lastUser) paintFailure(lastUser);
        else showToast(COPY.failed, { type: 'failure' });
    }

    function stopSlow() {
        clearTimeout(slowTimer);
        slowTimer = 0;
        doc.querySelector('#vc-chat-gen')?.removeAttribute('data-vc-slow');
    }

    function startSlow() {
        stopSlow();
        slowTimer = setTimeout(() => {
            slowTimer = 0;
            if (generating()) doc.querySelector('#vc-chat-gen')?.setAttribute('data-vc-slow', COPY.slow);
        }, SLOW_MS);
    }

    function wrapToastr() {
        const host = globalThis.toastr;
        if (!host || host.vcCompose) return;
        const { error, info } = host;
        host.error = function vcComposeError(message, title, ...rest) {
            if (desktop() && takesError({ generating: generating(), title, message })) {
                onGenerationFailed();
                return undefined;
            }
            return error.call(this, message, title, ...rest);
        };
        host.info = function vcComposeInfo(message, ...rest) {
            if (desktop() && isCopiedToast(message)) {
                showToast(COPY.copied);
                return undefined;
            }
            return info.call(this, message, ...rest);
        };
        host.vcCompose = true;
    }

    // ---- 宿主事件 ----
    const ctx0 = context();
    const events = ctx0?.eventSource;
    const types = ctx0?.eventTypes || {};
    const on = (name, fn) => { if (name && events?.on) events.on(name, fn); };
    on(types.CHAT_CHANGED, () => {
        flushDraft();
        stopSlow();
        clearFailure();
        pendingSend = null;
        const next = chatId();
        if (next === currentId) return;
        currentId = next;
        setQuote(null);
        restoreDraft();
    });
    on(types.MESSAGE_SENT, () => {
        pendingSend = null;
        pendingDraft = null;
        clearTimeout(draftTimer);
        writeDraft(currentId, '');
        doc.dispatchEvent(new CustomEvent('vc-draft-changed', { detail: { chatId: currentId, text: '' } }));
    });
    on(types.GENERATION_STARTED, (type, _detail, dryRun) => {
        if (type === 'quiet' || type === 'impersonate' || dryRun) return;
        clearFailure();
        startSlow();
    });
    on(types.GENERATION_ENDED, () => { stopSlow(); pendingSend = null; });
    on(types.GENERATION_STOPPED, stopSlow);

    wrapToastr();
    bindBox();
    restoreDraft();
    return { enabled: true, flushDraft };
}

function ensureCss(doc) {
    if (doc.getElementById?.('vc-desktop-chat-compose-css')) return;
    const link = doc.createElement('link');
    link.id = 'vc-desktop-chat-compose-css';
    link.media = '(min-width: 744px)';
    link.setAttribute('rel', 'stylesheet');
    link.setAttribute('href', new URL('./desktop/chat-compose.css', import.meta.url).href);
    (doc.head || doc.documentElement).append(link);
}
