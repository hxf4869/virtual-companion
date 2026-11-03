// 保留 Promise<boolean> 入口；AlertDialog 统一管理嵌套、Escape、焦点和卸载时机。
import { mountAlertView } from '../desktop/build/index.js';
import { iconSpriteUrl } from './icons.js';
import { animate } from './motion.js';
export function confirmAlert({ title = '', message = '', action = '删除', cancel = '取消', root, opener, owner } = {}) {
    const host = root || document.body;
    if (host !== host.ownerDocument.body && getComputedStyle(host).position === 'static') host.style.position = 'relative';
    const previous = opener || host.ownerDocument.activeElement;
    return new Promise(resolve => {
        let value = false, completed = false, opening;
        const view = mountAlertView({ host, title, message, action, cancel, sprite: iconSpriteUrl(), opener: previous,
            onChoose(next) { value = next; view.close(); }, onClose() { opening?.cancel(); },
            onClosed() { completed = true; queueMicrotask(() => { view.unmount(); resolve(value); }); },
            onDispose() { if (!completed) resolve(false); },
        }, owner);
        opening = animate(view.popup, [{ opacity: 0, transform: 'translate(-50%, -50%) scale(1.15)' }, { opacity: 1, transform: 'translate(-50%, -50%) scale(1)' }], { duration: 520 });
        opening.finished?.then(() => opening.cancel(), () => {});
    });
}
export function confirmDiscard(options = {}) {
    return confirmAlert({ ...options, title: '放弃更改？', message: '关闭后本次输入将丢失。', cancel: '继续编辑', action: '放弃' });
}
