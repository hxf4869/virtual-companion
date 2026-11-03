// 锚定、碰撞、键盘与焦点由 Base UI Menu 管理；此处保留现有 imperative 入口。
import { mountMenuView } from '../desktop/build/index.js';
import { iconSpriteUrl } from './icons.js';
import { animate } from './motion.js';

export function popMenu(anchor, items, { blur = false, below = true, root, className, note, onClose, onClosed } = {}) {
    const host = root || anchor.ownerDocument.body;
    if (host !== host.ownerDocument.body && getComputedStyle(host).position === 'static') host.style.position = 'relative';
    let closed = false, disposed = false, opening;
    function dispose() { if (disposed) return; disposed = true; if (!closed) { closed = true; onClose?.(); } onClosed?.(); }
    const view = mountMenuView({ host, anchor, items, sprite: iconSpriteUrl(), below, blur, className, note,
        onClose() { opening?.cancel(); if (!closed) { closed = true; onClose?.(); } },
        onClosed() { queueMicrotask(() => { view.unmount(); dispose(); }); }, onDispose: dispose,
    });
    opening = animate(view.menu, [{ opacity: 0, transform: 'scale(0.4)', filter: 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'blur(0px)' }], { duration: 520 });
    opening.finished?.then(() => opening.cancel(), () => {});
    return { close: view.close, menu: view.menu, scrim: view.scrim };
}
