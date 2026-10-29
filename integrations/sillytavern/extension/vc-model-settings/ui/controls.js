// 分段控件与开关的键盘、aria 绑定，以及滑杆已填比例。
export function syncRangePct(input) {
    if (!input || input.type !== 'range') return;
    const min = Number(input.min);
    const max = Number(input.max);
    const lo = Number.isFinite(min) ? min : 0;
    const hi = Number.isFinite(max) ? max : 100;
    const val = Number(input.value);
    const pct = hi === lo ? 0 : Math.min(100, Math.max(0, ((val - lo) / (hi - lo)) * 100));
    input.style.setProperty('--vc-pct', `${pct}%`);
}

let rangesBound = false;

export function bindRangeFills(doc = globalThis.document) {
    if (!doc || rangesBound) return;
    rangesBound = true;
    doc.addEventListener('input', (event) => syncRangePct(event.target), true);
    for (const input of doc.querySelectorAll('input[type="range"]')) syncRangePct(input);
}

export function bindSegment(root, { onChange } = {}) {
    const buttons = [...root.querySelectorAll(':scope > button')];
    const thumb = root.querySelector(':scope > .vc-segment-thumb');
    root.setAttribute('role', 'radiogroup');
    if (thumb && buttons.length) thumb.style.width = `calc((100% - 4px) / ${buttons.length})`;

    const currentIndex = () => {
        const pressed = buttons.findIndex((btn) => btn.getAttribute('aria-pressed') === 'true');
        if (pressed >= 0) return pressed;
        return buttons.findIndex((btn) => btn.getAttribute('aria-checked') === 'true');
    };

    const place = (index, animate) => {
        if (!thumb || !buttons.length) return;
        const transform = `translateX(${index * 100}%)`;
        if (animate) {
            thumb.style.transform = transform;
            return;
        }
        const previous = thumb.style.transition;
        thumb.style.transition = 'none';
        thumb.style.transform = transform;
        void thumb.offsetWidth;
        thumb.style.transition = previous === 'none' ? '' : previous;
    };

    const apply = (index, { animate, notify }) => {
        if (index < 0 || index >= buttons.length) return;
        buttons.forEach((btn, i) => {
            const on = i === index;
            btn.setAttribute('role', 'radio');
            btn.setAttribute('aria-checked', on ? 'true' : 'false');
            btn.setAttribute('aria-pressed', on ? 'true' : 'false');
            btn.tabIndex = on ? 0 : -1;
        });
        place(index, animate);
        if (notify) onChange?.(index, buttons[index]);
    };

    const sync = () => {
        const index = currentIndex();
        apply(index >= 0 ? index : 0, { animate: false, notify: false });
    };

    buttons.forEach((btn, index) => {
        btn.setAttribute('role', 'radio');
        btn.addEventListener('click', () => apply(index, { animate: true, notify: true }));
        btn.addEventListener('keydown', (event) => {
            const dir = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1
                : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
            if (!dir && event.key !== 'Home' && event.key !== 'End') return;
            event.preventDefault();
            const cur = Math.max(0, currentIndex());
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (cur + dir + buttons.length) % buttons.length;
            apply(next, { animate: true, notify: true });
            buttons[next].focus();
        });
    });

    sync();
    const onResize = () => place(Math.max(0, currentIndex()), false);
    root.ownerDocument?.defaultView?.addEventListener?.('resize', onResize);
    if (typeof globalThis.ResizeObserver === 'function') {
        const observer = new globalThis.ResizeObserver(onResize);
        observer.observe(root);
    }
    return { select: (index) => apply(index, { animate: true, notify: true }), sync };
}

export function bindSwitch(el, { onChange } = {}) {
    if (!el.hasAttribute('role')) el.setAttribute('role', 'switch');
    if (!el.hasAttribute('aria-checked')) el.setAttribute('aria-checked', 'false');
    if (el.tabIndex < 0) el.tabIndex = 0;
    const toggle = () => {
        if (el.disabled || el.getAttribute('aria-disabled') === 'true') return;
        const next = el.getAttribute('aria-checked') !== 'true';
        el.setAttribute('aria-checked', next ? 'true' : 'false');
        onChange?.(next);
    };
    el.addEventListener('click', (event) => {
        if (el.tagName !== 'BUTTON') event.preventDefault();
        toggle();
    });
    if (el.tagName !== 'BUTTON') {
        el.addEventListener('keydown', (event) => {
            if (event.key !== ' ' && event.key !== 'Enter') return;
            event.preventDefault();
            toggle();
        });
    }
    return { toggle };
}

export function bindSwitches(root, opts) {
    const nodes = [...root.querySelectorAll('.vc-switch')];
    for (const node of nodes) bindSwitch(node, opts);
    return nodes;
}
