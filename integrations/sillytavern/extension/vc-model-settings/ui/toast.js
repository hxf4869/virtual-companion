// 顶部玻璃提示条：1.8 秒后消失，失败类型保持到手动关闭。
import { icon } from './icons.js';

export const TOAST_MS = 1800;

const timers = new WeakMap();
const instances = new WeakMap();

function failure(type) {
    return type === 'failure' || type === 'fail' || type === 'error';
}

export function showToast(message, { type = 'ok', icon: iconName, root, duration = TOAST_MS } = {}) {
    const doc = (root || document.body).ownerDocument || document;
    const host = root || doc.body;
    const sticky = failure(type);
    let toast = instances.get(doc);
    if (toast && toast.parentNode !== host) { toast.remove(); host.append(toast); }
    if (!toast) {
        toast = doc.createElement('div');
        toast.className = 'vc-toast vc-glass';
        host.append(toast);
        instances.set(doc, toast);
    }
    const existing = timers.get(toast);
    if (existing) { clearTimeout(existing.expire); clearTimeout(existing.remove); }
    if (doc.defaultView?.innerWidth >= 744) {
        const panel = [...doc.querySelectorAll('.vcms-panel, [data-vc-content-panel], .vc-shell-page')].findLast((node) => node.getBoundingClientRect().width > 0);
        // 页面自带标题栏被隐藏时（陪伴 / 记忆用页内标题），取第一个真正可见的标题栏，避免提示条贴到窗口顶部。
        const header = panel && [...panel.querySelectorAll('.vcms-header, header, .vc-navbar')].find((node) => node.getBoundingClientRect().height > 0);
        const rect = panel?.getBoundingClientRect();
        if (rect) {
            toast.style.left = `${rect.left + rect.width / 2}px`;
            toast.style.top = `calc(${header?.getBoundingClientRect().bottom ?? rect.top + 64}px + var(--vc-space-sm))`;
        }
    } else { toast.style.left = ''; toast.style.top = ''; }
    toast.classList.toggle('is-failure', sticky);
    toast.setAttribute('role', sticky ? 'alert' : 'status');
    toast.replaceChildren();
    const glyph = doc.createElement('span');
    glyph.innerHTML = icon(iconName || (sticky ? 'circle-alert' : 'check'), { size: 18 });
    const text = doc.createElement('span');
    text.textContent = String(message ?? '');
    toast.append(glyph.firstElementChild || glyph, text);
    if (sticky) {
        const close = doc.createElement('button');
        close.type = 'button';
        close.className = 'vc-toast-close';
        close.setAttribute('aria-label', '关闭');
        close.innerHTML = icon('x', { size: 16 });
        close.addEventListener('click', () => {
            toast.classList.remove('is-on');
            toast.remove();
        });
        toast.append(close);
    }
    requestAnimationFrame(() => toast.classList.add('is-on'));
    if (!sticky) {
        const pending = {};
        pending.expire = setTimeout(() => {
            toast.classList.remove('is-on');
            pending.remove = setTimeout(() => { if (!toast.classList.contains('is-on')) toast.remove(); }, 400);
        }, duration);
        timers.set(toast, pending);
    }
    return toast;
}

export { showToast as toast };
