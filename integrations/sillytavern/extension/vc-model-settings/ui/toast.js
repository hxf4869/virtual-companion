// 顶部玻璃提示条：1.8 秒后消失，失败类型保持到手动关闭。
import { icon } from './icons.js';

export const TOAST_MS = 1800;

const timers = new WeakMap();

function failure(type) {
    return type === 'failure' || type === 'fail' || type === 'error';
}

export function showToast(message, { type = 'ok', icon: iconName, root, duration = TOAST_MS } = {}) {
    const doc = (root || document.body).ownerDocument || document;
    const host = root || doc.body;
    const sticky = failure(type);
    let toast = host.querySelector(':scope > .vc-toast');
    if (!toast) {
        toast = doc.createElement('div');
        toast.className = 'vc-toast vc-glass';
        host.append(toast);
    }
    const existing = timers.get(toast);
    if (existing) clearTimeout(existing);
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
        const timer = setTimeout(() => {
            toast.classList.remove('is-on');
            setTimeout(() => { if (!toast.classList.contains('is-on')) toast.remove(); }, 400);
        }, duration);
        timers.set(toast, timer);
    }
    return toast;
}

export { showToast as toast };
