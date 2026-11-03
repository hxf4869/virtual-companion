// React 需要真实 DOM API；只供壳层挂载单测，布局由受管 Chrome 场景验证。
import { Window } from 'happy-dom';

export function installReactDom(t) {
    const win = new Window({ url: 'http://127.0.0.1/', settings: {
        disableCSSFileLoading: true, disableJavaScriptFileLoading: true, disableIframePageLoading: true,
    } });
    const names = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'SVGElement', 'Image',
        'Event', 'CustomEvent', 'MutationObserver', 'ResizeObserver', 'localStorage', 'getComputedStyle', 'matchMedia',
        'requestAnimationFrame', 'cancelAnimationFrame', 'addEventListener', 'removeEventListener', 'dispatchEvent'];
    const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
    for (const name of names) {
        const value = name === 'window' ? win : win[name];
        Object.defineProperty(globalThis, name, { configurable: true, writable: true,
            value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(win) : value });
    }
    // 清理本次壳层的既有轮询/延迟任务，避免它们跨测试使用下一个 DOM。
    const timeouts = new Set(), intervals = new Set();
    const timeout = globalThis.setTimeout, interval = globalThis.setInterval;
    globalThis.setTimeout = (...args) => { const id = timeout(...args); timeouts.add(id); return id; };
    globalThis.setInterval = (...args) => { const id = interval(...args); intervals.add(id); return id; };
    t.after(async () => {
        for (const id of timeouts) clearTimeout(id);
        for (const id of intervals) clearInterval(id);
        globalThis.setTimeout = timeout; globalThis.setInterval = interval;
        await win.happyDOM.abort();
        for (const [name, descriptor] of previous) {
            if (descriptor) Object.defineProperty(globalThis, name, descriptor);
            else delete globalThis[name];
        }
    });
    return win.document;
}
