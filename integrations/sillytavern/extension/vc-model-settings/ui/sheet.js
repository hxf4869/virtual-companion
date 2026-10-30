// 两档可拖拽 sheet：约 56% 与全高，内部可推入下一层，Esc 关闭并归还焦点。
import { animate, prefersReducedMotion, spring, PROJECT_SECONDS } from './motion.js';
import { icon } from './icons.js';

export const SHEET_TOP_GAP = 54;
export const SHEET_HALF_RATIO = 0.56;
export const DRAG_SLOP = 8;

let seq = 0;

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

function focusable(root) {
    return [...root.querySelectorAll('button, [href], input, select, textarea, [tabindex]')].filter((el) => {
        if (el.hasAttribute('disabled') || el.getAttribute('aria-hidden') === 'true') return false;
        if (el.tabIndex < 0) return false;
        return true;
    });
}

export function openSheet({ title = '', body, root, large = false, initial, onDone, opener } = {}) {
    const doc = (root || document.body).ownerDocument || document;
    const host = root || doc.body;
    const view = doc.defaultView || window;
    const previous = opener || doc.activeElement;
    const scrim = doc.createElement('div');
    scrim.className = 'vc-scrim';
    const el = doc.createElement('div');
    el.className = 'vc-sheet';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    const titleId = `vc-sheet-title-${++seq}`;
    el.setAttribute('aria-labelledby', titleId);
    el.tabIndex = -1;
    el.innerHTML = `<div class="vc-sheet-grab"></div><div class="vc-sheet-head"><h3 id="${titleId}"></h3><button type="button" class="vc-sheet-done">完成</button></div><div class="vc-sheet-body"></div>`;
    el.querySelector('h3').textContent = title;
    const bodyEl = el.querySelector('.vc-sheet-body');
    if (body instanceof Node) bodyEl.append(body);
    else if (body != null) {
        const text = doc.createElement('p');
        text.textContent = String(body);
        bodyEl.append(text);
    }
    const fixed = host === doc.body;
    scrim.style.position = fixed ? 'fixed' : 'absolute';
    el.style.position = fixed ? 'fixed' : 'absolute';
    if (!fixed && getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.append(scrim, el);

    const geometry = () => {
        const containerHeight = fixed
            ? (view.visualViewport?.height || view.innerHeight)
            : host.clientHeight;
        const H = containerHeight - SHEET_TOP_GAP;
        const M = Math.round(containerHeight * SHEET_HALF_RATIO);
        return { containerHeight, H, M };
    };

    let y = 0;
    let stopSpring = () => {};
    let closed = false;
    let springToken = 0;
    const layers = [];
    const ac = new AbortController();

    const set = (value, token) => {
        if (token != null && token !== springToken) return;
        y = value;
        const { containerHeight, H, M } = geometry();
        // 宿主 html 有 -webkit-transform，fixed 包含块高度会变成 0。
        // 这时 bottom: 0 把整张 sheet 摆到视口上方，弹簧停稳后就看不见。
        el.style.top = `${SHEET_TOP_GAP}px`;
        el.style.bottom = 'auto';
        el.style.left = '0';
        el.style.right = '0';
        el.style.height = `${Math.max(0, H)}px`;
        el.style.transform = `translateY(${Math.max(value, -60)}px)`;
        const opacity = M > 0 ? Math.max(0, Math.min(1, 1 - (value - (H - M)) / M)) : 1;
        scrim.style.top = '0';
        scrim.style.right = '0';
        scrim.style.bottom = 'auto';
        scrim.style.left = '0';
        scrim.style.height = `${Math.max(0, containerHeight)}px`;
        scrim.style.opacity = String(opacity);
        scrim.classList.add('is-on');
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
        el.remove();
        scrim.remove();
        onDone?.();
        if (previous && typeof previous.focus === 'function') previous.focus();
    }
    function close() {
        if (closed) return;
        closed = true;
        ac.abort();
        stopSpring();
        const { H } = geometry();
        if (prefersReducedMotion()) {
            const leaving = animate(el, [{ opacity: 1 }, { opacity: 0 }], { duration: 150, reduced: false });
            leaving.finished?.then(finish, finish);
            return;
        }
        to(H + 20, 0, finish);
    }
    function popLayer() {
        const pane = layers.pop();
        if (!pane) return false;
        const done = () => pane.remove();
        const leaving = animate(pane, [
            { opacity: 1, transform: 'none' },
            { opacity: 0, transform: 'translateX(100%)' },
        ], { duration: 420 });
        leaving.finished?.then(done, done);
        return true;
    }
    function push(layer = {}) {
        const pane = doc.createElement('div');
        pane.className = 'vc-sheet-pane';
        const head = doc.createElement('div');
        head.className = 'vc-sheet-head';
        const parentTitle = (layers.at(-1)?.querySelector('h3') || el.querySelector('.vc-sheet-head h3'))?.textContent?.trim() || '';
        const backText = layer.backLabel ?? parentTitle;
        const back = doc.createElement('button');
        back.type = 'button';
        back.className = 'vc-btn vc-btn-text vc-sheet-back';
        back.setAttribute('aria-label', backText ? `返回${backText}` : '返回');
        const glyph = doc.createElement('span');
        glyph.innerHTML = icon('chevron-left', { size: 22 });
        const label = doc.createElement('span');
        label.textContent = backText;
        back.replaceChildren(glyph.firstElementChild || glyph, label);
        const heading = doc.createElement('h3');
        heading.textContent = layer.title || '';
        head.append(back, heading);
        pane.append(head);
        if (layer.body instanceof Node) pane.append(layer.body);
        bodyEl.append(pane);
        layers.push(pane);
        animate(pane, [
            { opacity: 0, transform: 'translateX(100%)' },
            { opacity: 1, transform: 'none' },
        ], { duration: 560 });
        back.addEventListener('click', () => popLayer());
        back.focus({ preventScroll: true });
        return { el: pane, close: () => popLayer() };
    }

    scrim.addEventListener('click', () => close(), { signal: ac.signal });
    el.querySelector('.vc-sheet-done').addEventListener('click', () => close(), { signal: ac.signal });
    el.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            if (!popLayer()) close();
            return;
        }
        if (event.key !== 'Tab') return;
        const items = focusable(el);
        if (!items.length) {
            event.preventDefault();
            return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        const active = doc.activeElement;
        const outside = active === el || !el.contains(active);
        if (event.shiftKey && (active === first || outside)) {
            event.preventDefault();
            last.focus({ preventScroll: true });
        } else if (!event.shiftKey && (active === last || outside)) {
            event.preventDefault();
            first.focus({ preventScroll: true });
        }
    }, { signal: ac.signal });

    let pending = false;
    let drag = false;
    let sy = 0;
    let st = 0;
    let lastY = 0;
    let lastT = 0;
    let vel = 0;
    const handles = [el.querySelector('.vc-sheet-grab'), el.querySelector('.vc-sheet-head')];
    const down = (event) => {
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
        if (choice.action === 'close') close();
        else to(choice.translateY, vel);
    };
    for (const handle of handles) {
        handle.addEventListener('pointerdown', down, { signal: ac.signal });
        handle.addEventListener('pointermove', move, { signal: ac.signal });
        handle.addEventListener('pointerup', up, { signal: ac.signal });
        handle.addEventListener('pointercancel', up, { signal: ac.signal });
    }

    const { H, M } = geometry();
    const openAt = large || initial === 'full' ? 0 : H - M;
    set(H);
    scrim.style.transition = 'none';
    to(openAt);
    // 宿主若还能滚动，focus 会把 scrollTop 加到和 translateY 一样，半档被拉回全高，拖动也被抵消。
    el.focus({ preventScroll: true });
    return { el, scrim, close, push };
}
