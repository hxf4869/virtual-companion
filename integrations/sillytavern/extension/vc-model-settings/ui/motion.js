// 弹簧曲线、元素动画与拖拽弹簧积分器（刚度 380、阻尼 34、质量 1）。
export const SPRING = 'linear(0, .006, .025 2.8%, .101 6.1%, .539 18.9%, .721 25.3%, .849 31.5%, .937 38.1%, .968 41.8%, .991 45.7%, 1.006 50.1%, 1.015 55%, 1.017 63.9%, 1.001 85.9%, 1)';
export const SPRING_FALLBACK = 'cubic-bezier(.32,.72,0,1)';
export const EASE_IN_OUT = 'cubic-bezier(.7,0,.2,1)';
export const EASE_OUT = 'cubic-bezier(.2,.8,.2,1)';
export const SPRING_K = 380;
export const SPRING_C = 34;
export const SPRING_MASS = 1;
export const PROJECT_SECONDS = 0.18;

export function prefersReducedMotion() {
    try {
        return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
    } catch {
        return false;
    }
}

function fadeFrames(keyframes) {
    const tagged = keyframes.some((frame) => frame && frame.opacity != null);
    if (!tagged) return keyframes.map(() => ({ opacity: 1 }));
    return keyframes.map((frame, index, all) => ({
        opacity: frame.opacity ?? (index === all.length - 1 ? 1 : 0),
    }));
}

function inertAnimation() {
    const finished = Promise.resolve();
    return { finished, cancel() {}, onfinish: null };
}

export function animate(el, keyframes, opts = {}) {
    if (!el || typeof el.animate !== 'function') return inertAnimation();
    const reduced = typeof opts.reduced === 'boolean' ? opts.reduced : prefersReducedMotion();
    const duration = reduced ? 150 : (opts.duration ?? opts.d ?? 560);
    const easing = reduced ? 'ease' : (opts.easing ?? opts.e ?? SPRING);
    const frames = reduced ? fadeFrames(keyframes) : keyframes;
    try {
        return el.animate(frames, {
            duration,
            easing,
            fill: 'forwards',
            delay: reduced ? 0 : (opts.delay || 0),
        });
    } catch {
        return inertAnimation();
    }
}

/** 单步半隐式欧拉：a = (-k (x - to) - c v) / m。 */
export function integrateSpring(x, v, to, dt, opts = {}) {
    const k = opts.k ?? SPRING_K;
    const c = opts.c ?? SPRING_C;
    const mass = opts.mass ?? SPRING_MASS;
    const step = Math.min(0.032, Math.max(0, dt));
    const a = (-k * (x - to) - c * v) / mass;
    const nextV = v + a * step;
    return { x: x + nextV * step, v: nextV };
}

export function spring(from, to, v0, onStep, onDone, opts = {}) {
    const k = opts.k ?? SPRING_K;
    const c = opts.c ?? SPRING_C;
    const mass = opts.mass ?? SPRING_MASS;
    const raf = globalThis.requestAnimationFrame;
    if (typeof raf !== 'function' || typeof globalThis.performance?.now !== 'function') {
        onStep?.(to);
        onDone?.();
        return () => {};
    }
    let x = from;
    let v = v0 || 0;
    let last = globalThis.performance.now();
    let id = 0;
    let stopped = false;
    const tick = (t) => {
        if (stopped) return;
        const dt = Math.min(0.032, Math.max(0, (t - last) / 1000));
        last = t;
        if (dt > 0) {
            const next = integrateSpring(x, v, to, dt, { k, c, mass });
            x = next.x;
            v = next.v;
        }
        onStep?.(x);
        if (Math.abs(v) < 4 && Math.abs(x - to) < 0.5) {
            onStep?.(to);
            onDone?.();
            return;
        }
        id = raf(tick);
    };
    id = raf(tick);
    return () => {
        stopped = true;
        globalThis.cancelAnimationFrame?.(id);
    };
}
