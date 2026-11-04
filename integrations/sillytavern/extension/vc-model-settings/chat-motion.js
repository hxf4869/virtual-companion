// UX-25 桌面生成控制与动效：入场规则、正在输入防闪、候选切换标注、编辑 / 切换时的气泡高度过渡、快捷键、页面不可见时暂停动画。
// 时长与曲线全部来自 CSS 语义变量（--vc-motion-*），这里只读取，不写样式值。
import { prefersReducedMotion } from './ui/motion.js';
import {
    TYPING_DELAY_MS,
    ARRIVE_SETTLE_MS,
    shouldArrive,
    typingVisible,
    pagerPlan,
    heightMotion,
    keyAction,
    actionLine,
} from './chat-logic.js';

export {
    TYPING_DELAY_MS,
    ARRIVE_SETTLE_MS,
    shouldArrive,
    typingVisible,
    pagerPlan,
    heightMotion,
    keyAction,
    actionLine,
};

function cssMs(name, fallback) {
    try {
        const raw = globalThis.getComputedStyle(globalThis.document.documentElement).getPropertyValue(name).trim();
        if (raw.endsWith('ms')) return Number.parseFloat(raw) || fallback;
        if (raw.endsWith('s')) return (Number.parseFloat(raw) || 0) * 1000 || fallback;
    } catch { /* 取默认 */ }
    return fallback;
}
function cssValue(name, fallback) {
    try {
        return globalThis.getComputedStyle(globalThis.document.documentElement).getPropertyValue(name).trim() || fallback;
    } catch { return fallback; }
}

const FLIP_TRIGGER = '[data-vc-act="edit"], [data-vc-act="swipe-prev"], [data-vc-act="swipe-next"], .mes_edit_done, .mes_edit_cancel';

export function mountChatMotion({ doc = document, chat, hooks }) {
    if (!chat) return null;
    const win = doc.defaultView || globalThis;

    // 页面不可见时暂停所有循环动画（CSS 读这个属性）。
    const syncVisible = () => {
        if (doc.hidden) doc.documentElement.setAttribute('data-vc-hidden', 'true');
        else doc.documentElement.removeAttribute('data-vc-hidden');
    };
    doc.addEventListener('visibilitychange', syncVisible);
    syncVisible();

    // 编辑 / 切换候选：气泡高度 FLIP，新内容淡入。生成中的内容不做高度过渡。
    chat.addEventListener('click', (event) => {
        if (!hooks.isDesktop()) return;
        const trigger = event.target?.closest?.(FLIP_TRIGGER);
        const mes = trigger?.closest?.('.mes');
        const block = mes?.querySelector?.(':scope > .mes_block');
        if (!mes || !block) return;
        const before = block.getBoundingClientRect().height;
        const observer = new MutationObserver(() => {
            observer.disconnect();
            win.requestAnimationFrame(() => {
                if (doc.body.getAttribute('data-generating') === 'true') return;
                play(block, before);
            });
        });
        observer.observe(mes, { childList: true, subtree: true, characterData: true });
        setTimeout(() => observer.disconnect(), 1500);
    }, true);

    function play(block, before) {
        const reduced = prefersReducedMotion() || doc.documentElement.getAttribute('data-vc-reduced-motion') === 'true';
        const after = block.getBoundingClientRect().height;
        const plan = heightMotion(before, after, reduced);
        const ease = cssValue('--vc-ease-arrive', 'ease-out');
        if (plan.height && typeof block.animate === 'function') {
            block.animate(
                [{ height: `${before}px`, overflow: 'hidden' }, { height: `${after}px`, overflow: 'hidden' }],
                { duration: cssMs('--vc-motion-height', 250), easing: ease },
            );
        }
        const body = block.querySelector('.mes_text, .vc-segs, .edit_textarea');
        if (body && typeof body.animate === 'function') {
            body.animate([{ opacity: 0 }, { opacity: 1 }], { duration: reduced ? cssMs('--vc-motion-fade', 180) : cssMs('--vc-motion-height', 250), easing: ease });
        }
    }

    // 快捷键
    doc.addEventListener('keydown', (event) => {
        if (!hooks.isDesktop()) return;
        const box = doc.querySelector('#send_textarea');
        const action = keyAction(event, {
            inputEmpty: event.target === box && !String(box?.value || '').trim(),
            overlayOpen: Boolean(doc.querySelector('.vc-alert, #vc-quick-switch')),
        });
        if (action === 'quick-switch') {
            event.preventDefault();
            event.stopPropagation();
            hooks.toggleQuickSwitch();
            return;
        }
        if (action === 'edit-last') {
            const users = [...chat.querySelectorAll(':scope > .mes[is_user="true"]')];
            const edit = users.at(-1)?.querySelector('.mes_edit');
            if (!edit) return;
            event.preventDefault();
            event.stopImmediatePropagation(); // 宿主的 ↑ 会编辑最后一条任意消息，这里只编辑自己的
            edit.click();
        }
    }, true);

    return { syncVisible };
}
