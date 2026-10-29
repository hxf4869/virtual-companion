// 确认框：一句标题、一句后果、取消与红色动作，返回是否确认。
import { animate } from './motion.js';

let seq = 0;

function focusable(root) {
    return [...root.querySelectorAll('button, [href], input, select, textarea, [tabindex]')].filter((el) => !el.hasAttribute('disabled') && el.tabIndex >= 0);
}

export function confirmAlert({ title = '', message = '', action = '删除', root, opener } = {}) {
    const doc = (root || document.body).ownerDocument || document;
    const host = root || doc.body;
    const previous = opener || doc.activeElement;
    return new Promise((resolve) => {
        const scrim = doc.createElement('div');
        scrim.className = 'vc-scrim';
        const dialog = doc.createElement('div');
        dialog.className = 'vc-alert vc-glass';
        dialog.setAttribute('role', 'alertdialog');
        dialog.setAttribute('aria-modal', 'true');
        const titleId = `vc-alert-title-${++seq}`;
        const textId = `vc-alert-text-${seq}`;
        dialog.setAttribute('aria-labelledby', titleId);
        dialog.setAttribute('aria-describedby', textId);
        dialog.innerHTML = `<div class="vc-alert-copy"><h4 id="${titleId}"></h4><p id="${textId}"></p></div><div class="vc-alert-actions"><button type="button" data-vc-cancel>取消</button><button type="button" class="is-danger" data-vc-ok></button></div>`;
        dialog.querySelector('h4').textContent = title;
        dialog.querySelector('p').textContent = message;
        dialog.querySelector('[data-vc-ok]').textContent = action;
        const fixed = host === doc.body;
        scrim.style.position = fixed ? 'fixed' : 'absolute';
        dialog.style.position = fixed ? 'fixed' : 'absolute';
        if (!fixed && getComputedStyle(host).position === 'static') host.style.position = 'relative';
        host.append(scrim, dialog);
        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            doc.removeEventListener('keydown', onKey, true);
            scrim.classList.remove('is-on');
            const done = () => {
                dialog.remove();
                scrim.remove();
                resolve(value);
                if (previous && typeof previous.focus === 'function') previous.focus();
            };
            const leaving = animate(dialog, [
                { opacity: 1, transform: 'translate(-50%, -50%) scale(1)' },
                { opacity: 0, transform: 'translate(-50%, -50%) scale(0.95)' },
            ], { duration: 200, easing: 'ease-in' });
            leaving.finished?.then(done, done);
        };
        function onKey(event) {
            if (!dialog.isConnected) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                finish(false);
                return;
            }
            if (event.key !== 'Tab') return;
            const items = focusable(dialog);
            if (!items.length) {
                event.preventDefault();
                return;
            }
            const first = items[0];
            const last = items[items.length - 1];
            const active = doc.activeElement;
            if (event.shiftKey && (active === first || !dialog.contains(active))) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
                event.preventDefault();
                first.focus();
            }
        }
        doc.addEventListener('keydown', onKey, true);
        scrim.addEventListener('click', () => finish(false));
        dialog.querySelector('[data-vc-cancel]').addEventListener('click', () => finish(false));
        dialog.querySelector('[data-vc-ok]').addEventListener('click', () => finish(true));
        requestAnimationFrame(() => scrim.classList.add('is-on'));
        animate(dialog, [
            { opacity: 0, transform: 'translate(-50%, -50%) scale(1.15)' },
            { opacity: 1, transform: 'translate(-50%, -50%) scale(1)' },
        ], { duration: 520 });
        dialog.querySelector('[data-vc-ok]').focus();
    });
}
