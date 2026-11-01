// UX-23 桌面聊天的右键菜单、引用、「+」菜单、输入框高度、草稿与发送失败。
// 只在 html[data-vc-layout="desktop"] 生效；手机的长按抬起、宿主选项菜单保持原样。
// 所有动作转发宿主原生入口；不往 .mes_text 子树和 #chat 插节点。
import { commitHostDelete } from './chat-view.js';
import { confirmAlert } from './ui/alert.js';
import { icon } from './ui/icons.js';
import { popMenu } from './ui/menu.js';
import { showToast } from './ui/toast.js';
import { chatVoiceAvailable, readReplyAloud } from './voice-chat.js';

export const QUOTE_MAX = 30;
export const SLOW_MS = 60000;
export const COPY = Object.freeze({
    quote: '引用',
    copy: '复制',
    read: '朗读',
    edit: '编辑',
    regenerate: '重新生成',
    continue: '继续',
    remove: '删除',
    copied: '已复制',
    failed: '没有发送成功',
    retry: '重试',
    slow: '回复较慢，可以继续等或停止',
    deleteTitle: '删除这条消息？',
    deleteBody: '删除后无法恢复。',
    deleteFailed: '这条消息没有删掉',
});
const DRAFT_PREFIX = 'vc-draft:';
const DRAFT_MS = 500;
const COMPOSER_MAX_LINES = 6;

// ---- 纯逻辑（单测直接覆盖） ----

export function quoteSummary(text, max = QUOTE_MAX) {
    const body = String(text ?? '')
        .split(/\r?\n/)
        .filter((line) => !/^\s*>/.test(line)) // 被引用的消息本身带的引用行不再套娃
        .join(' ')
        .replace(/<[^>]*>/g, '')
        .replace(/[*_`~]+/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    const chars = [...body];
    return chars.length > max ? `${chars.slice(0, max).join('')}…` : body;
}

export function quoteLine(name, text) {
    const who = String(name ?? '').replace(/\s+/g, ' ').trim();
    const summary = quoteSummary(text);
    return `> ${who ? `${who}：` : ''}${summary}`;
}

export function withQuote(quote, text) {
    const body = String(text ?? '');
    if (!quote || !body.trim()) return body;
    return `${quoteLine(quote.name, quote.text)}\n\n${body}`;
}

export function draftKey(chatId) {
    const id = String(chatId ?? '').trim();
    return id ? `${DRAFT_PREFIX}${id}` : '';
}

export function readDraft(chatId, storage = globalThis.localStorage) {
    const key = draftKey(chatId);
    if (!key) return '';
    try { return storage?.getItem(key) || ''; } catch { return ''; }
}

export function writeDraft(chatId, text, storage = globalThis.localStorage) {
    const key = draftKey(chatId);
    if (!key) return;
    try {
        if (String(text ?? '').trim()) storage?.setItem(key, String(text));
        else storage?.removeItem(key);
    } catch { /* 隐私模式下草稿只是不保存 */ }
}

// 与宿主 shouldSendOnEnter 同一判定：桌面窗口里 AUTO 等于回车发送。
export function sendsOnEnter(powerUser) {
    const mode = Number(powerUser?.send_on_enter ?? 0);
    return mode !== -1;
}

// 生成中的宿主错误 toast 由本模块接管；保存类错误仍交给宿主。
export function takesError({ generating, title = '', message = '' } = {}) {
    if (!generating) return false;
    return !/saved|保存/i.test(`${title} ${message}`);
}

export function isCopiedToast(message) {
    return /^(copied!?|已复制)$/i.test(String(message ?? '').trim());
}

export function messageMenuPlan({ system = false, character = false, last = false, voice = false, busy = false } = {}) {
    const plan = [];
    if (!system) plan.push('quote');
    plan.push('copy');
    if (voice) plan.push('read');
    plan.push('-', 'edit');
    if (character && last && !busy) plan.push('regenerate');
    plan.push('-', 'remove');
    return plan;
}

export function composerHeight({ contentHeight = 0, lineHeight = 0, padding = 0, min = 0, lines = COMPOSER_MAX_LINES } = {}) {
    const max = Math.round(lineHeight * lines + padding);
    return Math.max(min, Math.min(max, Math.ceil(contentHeight)));
}

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

    let quote = null;
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
        let bar = doc.querySelector('#vc-quote-bar');
        if (!quote) { bar?.remove(); return; }
        if (!bar) {
            const form = doc.querySelector('#send_form');
            const parent = form?.parentElement;
            if (!parent) return;
            bar = doc.createElement('div');
            bar.id = 'vc-quote-bar';
            bar.innerHTML = `<span class="vc-quote-label">${COPY.quote}</span><span class="vc-quote-text"></span><button type="button" class="vc-quote-close" aria-label="关闭引用">${icon('x', { size: 16 })}</button>`;
            bar.querySelector('.vc-quote-close').addEventListener('click', () => { setQuote(null); box()?.focus(); });
            parent.insertBefore(bar, form);
        }
        const who = quote.name ? `${quote.name}：` : '';
        bar.querySelector('.vc-quote-text').textContent = `${who}${quoteSummary(quote.text)}`;
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

    const ACTIONS = {
        quote: { label: COPY.quote, icon: 'quote', run: (mes) => { setQuote({ name: speakerName(mes), text: messageText(mes) }); box()?.focus(); } },
        copy: { label: COPY.copy, icon: 'copy', run: copyMessage },
        read: { label: COPY.read, icon: 'volume-2', run: (mes) => { void readReplyAloud(Number(mes.getAttribute('mesid')), mes.querySelector('[data-vc-act="read"]')); } },
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
    let liftWatch = null;
    function unlift() {
        lifted?.classList.remove('vc-ctx-target');
        lifted = null;
        liftWatch?.disconnect();
        liftWatch = null;
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
        });
        const items = plan.map((id) => (id === '-' ? '-' : { ...ACTIONS[id], run: () => ACTIONS[id].run(mes) }));
        const below = event.clientY < globalThis.innerHeight * 0.6;
        // popMenu 以锚点为界上下偏 8px；锚点放在指针上下 8px，菜单边缘正好贴在指针处。
        const anchor = anchorAt(event.clientX, below ? event.clientY - 8 : event.clientY + 8);
        const opened = popMenu(anchor, items, { below });
        opened.menu.classList.add('vc-compose-menu');
        lifted = mes;
        mes.classList.add('vc-ctx-target');
        if (opened?.scrim && typeof MutationObserver === 'function') {
            let seenOn = false;
            liftWatch = new MutationObserver(() => {
                const on = opened.scrim.classList.contains('is-on');
                if (on) seenOn = true;
                else if (seenOn) unlift();
            });
            liftWatch.observe(opened.scrim, { attributes: true, attributeFilter: ['class'] });
        }
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
        if (items.length) popMenu(plus, items, { below: false }).menu.classList.add('vc-compose-menu');
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
        failed.querySelector('.vc-send-retry')?.remove();
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
        let tools = mes.querySelector('.vc-mes-tools');
        if (!tools) {
            tools = doc.createElement('div');
            tools.className = 'vc-mes-tools';
            mes.append(tools);
        }
        const button = doc.createElement('button');
        button.type = 'button';
        button.className = 'vc-send-retry';
        button.innerHTML = `<span>${COPY.failed}</span><span aria-hidden="true">·</span><span class="vc-send-retry-act">${COPY.retry}</span>`;
        button.addEventListener('click', retry);
        tools.append(button);
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
    link.setAttribute('rel', 'stylesheet');
    link.setAttribute('href', new URL('./desktop/chat-compose.css', import.meta.url).href);
    (doc.head || doc.documentElement).append(link);
}
