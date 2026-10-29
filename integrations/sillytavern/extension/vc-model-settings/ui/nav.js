// 页面栈：底层左移 28% 并压暗，新页从右侧滑入；头像在推入前测量。
import { animate, prefersReducedMotion } from './motion.js';

function commit(anim) {
    if (!anim) return;
    try { anim.commitStyles?.(); } catch { /* 旧实现没有 commitStyles */ }
    try { anim.cancel?.(); } catch { /* 已结束 */ }
}

export function flyAvatar(fromImg, toImg, { container, fromRect, toRect } = {}) {
    if (prefersReducedMotion() || !fromImg || !toImg) return null;
    const host = container || fromImg.ownerDocument?.body;
    if (!host) return null;
    const a = fromRect || fromImg.getBoundingClientRect();
    const b = toRect || toImg.getBoundingClientRect();
    if (!a.width || !a.height || !b.width) return null;
    const origin = host.getBoundingClientRect();
    const clone = fromImg.cloneNode(true);
    Object.assign(clone.style, {
        position: host === fromImg.ownerDocument.body ? 'fixed' : 'absolute',
        zIndex: 'var(--vc-z-fly)',
        left: `${a.left - (host === fromImg.ownerDocument.body ? 0 : origin.left)}px`,
        top: `${a.top - (host === fromImg.ownerDocument.body ? 0 : origin.top)}px`,
        width: `${a.width}px`,
        height: `${a.height}px`,
        margin: '0',
        pointerEvents: 'none',
    });
    host.append(clone);
    toImg.style.visibility = 'hidden';
    const dx = b.left - a.left + (b.width - a.width) / 2;
    const dy = b.top - a.top + (b.height - a.height) / 2;
    const scale = b.width / a.width;
    const anim = animate(clone, [
        { transform: 'none' },
        { transform: `translate(${dx}px, ${dy}px) scale(${scale})` },
    ], { duration: 620 });
    const finish = () => {
        toImg.style.visibility = '';
        clone.remove();
    };
    anim.finished?.then(finish, finish);
    return anim;
}

export function createNav(container) {
    if (!container) throw new Error('createNav requires a container');
    const stack = [];

    function baseEl() {
        if (stack.length) return stack[stack.length - 1].el;
        return container.querySelector(':scope > .vc-screen:not([hidden])');
    }

    function push(el, { prepare, fly } = {}) {
        const base = baseEl();
        const fromRect = fly?.from?.getBoundingClientRect?.() ?? null;
        el.classList.add('vc-screen');
        container.append(el);
        prepare?.(el);
        const toEl = typeof fly?.to === 'function' ? fly.to(el) : fly?.to;
        const toRect = toEl?.getBoundingClientRect?.() ?? null;
        const incoming = animate(el, [
            { opacity: 0, transform: 'translateX(100%)', boxShadow: '0 0 0 rgba(0,0,0,0)' },
            { opacity: 1, transform: 'none', boxShadow: '-20px 0 50px rgba(0,0,0,.12)' },
        ], { duration: 560 });
        let under = null;
        if (base) {
            const prev = stack.length ? stack[stack.length - 1] : null;
            commit(prev?.incoming);
            under = animate(base, [
                { transform: 'none', filter: 'brightness(1)' },
                { transform: 'translateX(-28%)', filter: 'brightness(0.9)' },
            ], { duration: 560 });
        }
        stack.push({ el, base, incoming, under });
        if (fly?.from && toEl) flyAvatar(fly.from, toEl, { container, fromRect, toRect });
        return el;
    }

    function pop() {
        const top = stack.pop();
        if (!top) return false;
        commit(top.incoming);
        commit(top.under);
        const { el, base } = top;
        if (base) {
            animate(base, [
                { transform: 'translateX(-28%)', filter: 'brightness(0.9)' },
                { transform: 'none', filter: 'brightness(1)' },
            ], { duration: 480 });
        }
        const leaving = animate(el, [
            { opacity: 1, transform: 'none' },
            { opacity: 0, transform: 'translateX(100%)' },
        ], { duration: 480 });
        const remove = () => el.remove();
        leaving.finished?.then(remove, remove);
        el.dispatchEvent(new Event('popped'));
        return true;
    }

    return { push, pop, flyAvatar, get depth() { return stack.length; } };
}
