// 监听 visualViewport，把键盘高度与可视高度写成 --vc-keyboard、--vc-vh。
export function readViewport(win = globalThis) {
    const inner = Number(win.innerHeight) || 0;
    const vv = win.visualViewport;
    const height = Number(vv?.height ?? inner) || 0;
    const offsetTop = Number(vv?.offsetTop) || 0;
    const keyboard = Math.max(0, Math.round(inner - height - offsetTop));
    return { keyboard, height: Math.round(height) };
}

export function applyViewport(target, win = globalThis) {
    const el = target ?? win.document?.documentElement;
    if (!el?.style) return;
    const { keyboard, height } = readViewport(win);
    el.style.setProperty('--vc-keyboard', `${keyboard}px`);
    el.style.setProperty('--vc-vh', `${height}px`);
}

export function bindViewport(target, win = globalThis) {
    const update = () => applyViewport(target, win);
    const vv = win.visualViewport;
    vv?.addEventListener?.('resize', update);
    vv?.addEventListener?.('scroll', update);
    win.addEventListener?.('resize', update);
    update();
    return () => {
        vv?.removeEventListener?.('resize', update);
        vv?.removeEventListener?.('scroll', update);
        win.removeEventListener?.('resize', update);
    };
}
