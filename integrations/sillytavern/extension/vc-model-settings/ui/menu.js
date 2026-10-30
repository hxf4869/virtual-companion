// 从锚点弹出的玻璃菜单：勾选、图标、分隔、危险项，Esc 关闭并归还焦点。
import { animate } from './motion.js';
import { icon } from './icons.js';

function esc(value) {
    return String(value ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

function holds(root, node) {
    let current = node;
    while (current) {
        if (current === root) return true;
        current = current.parentElement || current.parent || null;
    }
    return false;
}

function isSeparator(item) {
    return item === '-' || item?.separator === true || item?.type === 'separator';
}

function mark(item) {
    if (item.check) return icon('check', { size: 19 });
    if (item.icon) return icon(item.icon, { size: 19 });
    return '';
}

export function popMenu(anchor, items, { blur = false, below = true, root } = {}) {
    const host = root || anchor?.ownerDocument?.body || document.body;
    const doc = host.ownerDocument || document;
    const opener = doc.activeElement;
    if (host !== doc.body && getComputedStyle(host).position === 'static') host.style.position = 'relative';
    const scrim = doc.createElement('div');
    scrim.className = `vc-scrim${blur ? ' is-blur' : ' is-clear'}`;
    const menu = doc.createElement('div');
    menu.className = 'vc-menu vc-glass';
    menu.setAttribute('role', 'menu');
    menu.innerHTML = items.map((item, index) => {
        if (isSeparator(item)) return '<hr>';
        const cls = item.danger ? ' class="is-danger"' : '';
        const checked = item.check ? ' aria-checked="true"' : '';
        return `<button type="button" role="menuitem" data-i="${index}"${cls}${checked}><span class="vc-menu-label">${esc(item.label)}</span><span class="vc-menu-mark">${mark(item)}</span></button>`;
    }).join('');
    const fixed = host === doc.body;
    scrim.style.position = fixed ? 'fixed' : 'absolute';
    menu.style.position = fixed ? 'fixed' : 'absolute';
    menu.style.visibility = 'hidden';
    host.append(scrim, menu);
    const origin = fixed ? { left: 0, top: 0, width: doc.defaultView.innerWidth, height: doc.defaultView.innerHeight } : host.getBoundingClientRect();
    const vw = fixed ? origin.width : host.clientWidth;
    const vh = fixed ? origin.height : host.clientHeight;
    const rect = anchor.getBoundingClientRect();
    const right = rect.left - origin.left > vw / 2;
    let x = right ? Math.min(vw - 16, rect.right - origin.left) - menu.offsetWidth : Math.max(16, rect.left - origin.left);
    let y = below ? rect.bottom - origin.top + 8 : rect.top - origin.top - menu.offsetHeight - 8;
    x = Math.max(8, Math.min(x, vw - menu.offsetWidth - 8));
    y = Math.max(8, Math.min(y, vh - menu.offsetHeight - 8));
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.style.setProperty('--vc-ox', right ? '100%' : '0%');
    menu.style.setProperty('--vc-oy', below ? '0%' : '100%');
    menu.style.visibility = '';
    requestAnimationFrame(() => scrim.classList.add('is-on'));
    const openAnim = animate(menu, [
        { opacity: 0, transform: 'scale(0.4)', filter: 'blur(6px)' },
        { opacity: 1, transform: 'none', filter: 'blur(0px)' },
    ], { duration: 520 });
    let closed = false;
    const buttons = () => [...menu.querySelectorAll('[role="menuitem"]')];
    function close(restore) {
        if (closed) return;
        closed = true;
        doc.removeEventListener('keydown', onKey, true);
        scrim.classList.remove('is-on');
        const done = () => { menu.remove(); scrim.remove(); };
        const leaving = animate(menu, [
            { opacity: 1, transform: 'none' },
            { opacity: 0, transform: 'scale(0.6)' },
        ], { duration: 260, easing: 'ease-in' });
        leaving.finished?.then(done, done);
        if (restore) {
            const back = anchor && typeof anchor.focus === 'function' ? anchor : opener;
            back?.focus?.();
        }
        openAnim.cancel?.();
    }
    function onKey(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close(true);
            return;
        }
        if (event.key === 'Tab') {
            const list = buttons();
            const first = list[0];
            const last = list[list.length - 1];
            if (!first || !last) {
                event.preventDefault();
                return;
            }
            const active = doc.activeElement;
            if (event.shiftKey && (active === first || !holds(menu, active))) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && (active === last || !holds(menu, active))) {
                event.preventDefault();
                first.focus();
            }
            return;
        }
        const list = buttons();
        if (!list.length) return;
        const index = list.indexOf(doc.activeElement);
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
            event.preventDefault();
            const next = event.key === 'Home' ? 0
                : event.key === 'End' ? list.length - 1
                    : event.key === 'ArrowDown' ? (index + 1) % list.length
                        : (index - 1 + list.length) % list.length;
            list[next].focus();
        }
    }
    doc.addEventListener('keydown', onKey, true);
    scrim.addEventListener('click', () => close(true));
    menu.addEventListener('click', (event) => {
        const btn = event.target.closest('button');
        if (!btn || !menu.contains(btn)) return;
        const item = items[Number(btn.dataset.i)];
        close(false);
        item?.run?.();
        item?.onSelect?.();
        if (typeof anchor?.focus === 'function') anchor.focus();
    });
    buttons()[0]?.focus();
    return { close: () => close(true), menu, scrim };
}
