// 两档可拖拽 sheet：约 56% 与全高，内部可推入下一层，Esc 关闭并归还焦点。
import { animate, prefersReducedMotion, spring, PROJECT_SECONDS } from './motion.js';
import { confirmDiscard } from './alert.js';
import { iconSpriteUrl } from './icons.js';
import { mountSheetView, mountSheetLayerView } from '../desktop/build/index.js';

export const SHEET_TOP_GAP = 54;
export const SHEET_HALF_RATIO = 0.56;
export const DRAG_SLOP = 8;
const sheetHeaders = new WeakMap();
export function setSheetHeader(element, header) { const update = sheetHeaders.get(element); if (!update) return false; update(header); return true; }

export function selectDetent({
    y,
    velocity = 0,
    containerHeight,
    large = false,
    topGap = SHEET_TOP_GAP,
    halfRatio = SHEET_HALF_RATIO,
    projectSeconds = PROJECT_SECONDS,
} = {}) {
    const H = containerHeight - topGap;
    const M = Math.round(containerHeight * halfRatio);
    const detents = large ? [0] : [H - M, 0];
    const proj = y + velocity * projectSeconds;
    const closeLine = large ? H * 0.28 : H - M * 0.62;
    if (proj > closeLine) return { action: 'close', translateY: H + 20, detents, H, M, proj, closeLine };
    let target = detents[0];
    for (const detent of detents) {
        if (Math.abs(detent - proj) < Math.abs(target - proj)) target = detent;
    }
    return { action: 'move', translateY: target, detents, H, M, proj, closeLine };
}

export function openSheet({ title = '', body, content, root, large = false, initial, onDone, opener, owner, isDirty = () => false, onSubmit, canClose = () => true, ariaLabel } = {}) {
    const doc = (root || document.body).ownerDocument || document;
    const host = root || doc.body;
    const view = doc.defaultView || globalThis;
    const previous = opener || doc.activeElement;
    const fixed = host === doc.body;
    if (!fixed && getComputedStyle(host).position === 'static') host.style.position = 'relative';
    let covered = false, resumeFocus = null;
    let header = {}, doneProps = {}, sheetStyle = { position: fixed ? 'fixed' : 'absolute' }, scrimStyle = { position: fixed ? 'fixed' : 'absolute' };
    const props = () => ({ host, title: header.title ?? title, body, content, open: !covered, resumeFocus, opener: previous, style: sheetStyle, scrimStyle, ariaLabel, headerActions: header.actions, doneProps,
        onRequestClose(reason) { if (reason !== 'escape-key' || !popLayer()) void close(); }, onComplete() { void complete(); } });
    const component = mountSheetView(props(), owner);
    const { el, scrim } = component;
    const bodyEl = el.querySelector('.vc-sheet-body');
    const setCovered = next => { if (closed || covered === Boolean(next)) return; covered = Boolean(next); if (covered) resumeFocus = el.contains(doc.activeElement) ? doc.activeElement : null; component.update(props()); };
    const setHeader = (next) => { header = { ...header, ...next }; if (next.done) doneProps = { ...doneProps, ...next.done }; component.update(props()); };
    sheetHeaders.set(el, setHeader);
    const setContent = next => { if (closed) return; content = next; component.update(props()); };

    const geometry = () => {
        const containerHeight = fixed
            ? (view.visualViewport?.height || view.innerHeight)
            : host.clientHeight;
        const desktop = fixed && view.innerWidth >= 744;
        const H = desktop ? Math.min(containerHeight - 64, large ? 760 : 560) : containerHeight - SHEET_TOP_GAP;
        const M = desktop ? H : Math.round(containerHeight * SHEET_HALF_RATIO);
        return { containerHeight, H, M, desktop };
    };

    let y = 0;
    let stopSpring = () => {};
    let closed = false;
    let finished = false, closingAnimation = null;
    let springToken = 0;
    const layers = [];
    const leavingLayers = new Set();
    const ac = new AbortController();

    const set = (value, token) => {
        if (token != null && token !== springToken) return;
        y = value;
        const { containerHeight, H, M, desktop } = geometry();
        // 宿主 html 有 -webkit-transform，fixed 包含块高度会变成 0。
        // 这时 bottom: 0 把整张 sheet 摆到视口上方，弹簧停稳后就看不见。
        sheetStyle = { ...sheetStyle, top: `${desktop ? (containerHeight - H) / 2 : SHEET_TOP_GAP}px`, bottom: 'auto', left: desktop ? '50%' : '0', right: desktop ? 'auto' : '0',
            width: desktop ? 'min(720px, calc(100vw - 64px))' : 'auto', height: `${Math.max(0, H)}px`,
            transform: desktop ? `translate(-50%, ${Math.max(-12, Math.min(24, value / H * 24))}px)` : `translateY(${Math.max(value, -60)}px)` };
        const opacity = M > 0 ? Math.max(0, Math.min(1, 1 - (value - (H - M)) / M)) : 1;
        sheetStyle.opacity = desktop ? String(opacity) : '1';
        scrimStyle = { ...scrimStyle, top: '0', right: '0', bottom: 'auto', left: '0', height: `${Math.max(0, containerHeight)}px`, opacity: String(opacity) };
        component.update(props());
    };
    const to = (target, v0 = 0, done) => {
        const token = ++springToken;
        stopSpring();
        if (prefersReducedMotion()) {
            set(target, token);
            done?.();
            return;
        }
        stopSpring = spring(y, target, v0, (value) => set(value, token), done);
    };

    function finish() {
        if (finished) return;
        finished = true;
        sheetHeaders.delete(el);
        for (const layer of [...layers.splice(0), ...leavingLayers]) layer.dispose();
        leavingLayers.clear();
        onDone?.();
        component.unmount();
    }
    function finishClose() {
        if (closed) return;
        closed = true;
        ac.abort();
        stopSpring();
        const { H } = geometry();
        if (prefersReducedMotion()) {
            closingAnimation = animate(el, [{ opacity: 1 }, { opacity: 0 }], { duration: 150, reduced: false });
            closingAnimation.finished?.then(finish, finish);
            return;
        }
        to(H + 20, 0, finish);
    }
    let confirming = false;
    async function close() {
        if (closed || confirming || !canClose()) return false;
        if (isDirty()) {
            confirming = true;
            const discard = await confirmDiscard({ opener: doc.activeElement });
            confirming = false;
            if (!discard || closed) return false;
        }
        finishClose();
        return true;
    }
    async function complete() {
        if (onSubmit && isDirty()) {
            if (await onSubmit()) finishClose();
        } else await close();
    }
    function dismiss() {
        if (finished) return;
        closed = true;
        ac.abort();
        stopSpring();
        closingAnimation?.cancel();
        finish();
    }
    function popLayer() {
        const layer = layers.pop();
        if (!layer) return false;
        const pane = layer.el;
        leavingLayers.add(layer);
        const done = () => { layer.dispose(); leavingLayers.delete(layer); syncLayerInert(); };
        syncLayerInert();
        const leaving = animate(pane, [
            { opacity: 1, transform: 'none' },
            { opacity: 0, transform: 'translateX(100%)' },
        ], { duration: 420 });
        leaving.finished?.then(done, done);
        return true;
    }
    function syncLayerInert() {
        const top = layers.at(-1)?.el;
        for (const node of bodyEl.children) node.inert = Boolean(top && node !== top);
    }
    function push(layer = {}) {
        const pane = doc.createElement('div');
        pane.className = 'vc-sheet-pane';
        const parentTitle = (layers.at(-1)?.el.querySelector('h3') || el.querySelector('.vc-sheet-head h3'))?.textContent?.trim() || '';
        const backText = layer.backLabel ?? parentTitle;
        bodyEl.append(pane);
        const unmount = mountSheetLayerView(pane, { title: layer.title || '', backLabel: backText, body: layer.body, sprite: iconSpriteUrl(), onBack: () => popLayer() });
        const back = pane.querySelector('button');
        let disposed = false;
        layers.push({ el: pane, dispose() { if (disposed) return; disposed = true; unmount(); pane.remove(); } });
        syncLayerInert();
        const entering = animate(pane, [
            { opacity: 0, transform: 'translateX(100%)' },
            { opacity: 1, transform: 'none' },
        ], { duration: 560 });
        // 最终值就是 CSS 默认值；结束后释放 fill，避免保留动画合成层。
        entering.finished?.then(() => entering.cancel?.(), () => {});
        back.focus({ preventScroll: true });
        return { el: pane, close: () => popLayer() };
    }

    let pending = false;
    let drag = false;
    let sy = 0;
    let st = 0;
    let lastY = 0;
    let lastT = 0;
    let vel = 0;
    const handles = [el.querySelector('.vc-sheet-grab'), el.querySelector('.vc-sheet-head')];
    const down = (event) => {
        if (geometry().desktop) return;
        if (event.button > 0 || event.target.closest('button')) return;
        pending = true;
        drag = false;
        stopSpring();
        if (event.pointerId != null) {
            try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* 指针已经释放 */ }
        }
        sy = event.clientY;
        st = y;
        lastY = event.clientY;
        lastT = view.performance.now();
        vel = 0;
    };
    const move = (event) => {
        if (!pending && !drag) return;
        const dy = event.clientY - sy;
        if (!drag) {
            if (Math.abs(dy) < DRAG_SLOP) return;
            drag = true;
        }
        let next = st + dy;
        if (next < 0) next = -Math.pow(-next, 0.7);
        set(next);
        const t = view.performance.now();
        vel = (event.clientY - lastY) / Math.max(1, t - lastT) * 1000;
        lastY = event.clientY;
        lastT = t;
    };
    const up = () => {
        if (!pending && !drag) return;
        const moved = drag;
        pending = false;
        drag = false;
        if (!moved) return;
        const { containerHeight } = geometry();
        const choice = selectDetent({ y, velocity: vel, containerHeight, large });
        if (choice.action === 'close') { void close().then((didClose) => { if (!didClose && !closed) to(st); }); }
        else to(choice.translateY, vel);
    };
    for (const handle of handles) {
        handle.addEventListener('pointerdown', down, { signal: ac.signal });
        handle.addEventListener('pointermove', move, { signal: ac.signal });
        handle.addEventListener('pointerup', up, { signal: ac.signal });
        handle.addEventListener('pointercancel', up, { signal: ac.signal });
    }

    const { H, M, desktop } = geometry();
    const openAt = desktop || large || initial === 'full' ? 0 : H - M;
    set(H);
    scrimStyle.transition = 'none';
    to(openAt);
    const resize = () => {
        stopSpring();
        springToken += 1;
        const next = geometry();
        set(Math.min(y, Math.max(0, next.H - next.M)));
    };
    view.addEventListener('resize', resize, { signal: ac.signal });
    view.visualViewport?.addEventListener('resize', resize, { signal: ac.signal });
    // 宿主若还能滚动，focus 会把 scrollTop 加到和 translateY 一样，半档被拉回全高，拖动也被抵消。
    el.focus({ preventScroll: true });
    return { el, scrim, close, dismiss, push, setHeader, setContent, setCovered, done: el.querySelector('.vc-sheet-done') };
}
