// 明暗模式、body.vc-ui 开关，以及把 theme-color 写回当前明暗。
import { bindViewport } from './viewport.js';
import { bindRangeFills } from './controls.js';

export const THEME_KEY = 'vc-theme';
export const UI_FLAG_KEY = 'vc-ui';
export const THEME_COLOR = { light: '#f5f5f7', dark: '#000000' };

let watching = false;
let attrObserver = null;
let headObserver = null;
let observedMeta = null;

export function parseThemeMode(value) {
    return value === 'light' || value === 'dark' || value === 'auto' ? value : 'auto';
}

export function readThemeMode(storage) {
    try {
        const store = storage ?? globalThis.localStorage;
        return parseThemeMode(store?.getItem?.(THEME_KEY));
    } catch {
        return 'auto';
    }
}

export function writeThemeMode(mode, storage) {
    const parsed = parseThemeMode(mode);
    try {
        const store = storage ?? globalThis.localStorage;
        store.setItem(THEME_KEY, parsed);
    } catch {
        /* 存储不可用时仍返回解析结果，调用方继续应用。 */
    }
    return parsed;
}

export function readVcUiFlag(storage) {
    try {
        const store = storage ?? globalThis.localStorage;
        return store?.getItem?.(UI_FLAG_KEY) !== 'off';
    } catch {
        return true;
    }
}

export function writeVcUiFlag(value, storage) {
    const flag = value === 'off' || value === false ? 'off' : 'on';
    try {
        const store = storage ?? globalThis.localStorage;
        store?.setItem?.(UI_FLAG_KEY, flag);
    } catch {
        /* 存储不可用时不抛出；调用方仍按传入值理解开关。 */
    }
    return flag;
}

export function prefersDark(win = globalThis) {
    try {
        return win.matchMedia?.('(prefers-color-scheme: dark)')?.matches === true;
    } catch {
        return false;
    }
}

export function resolveTheme(mode, dark) {
    if (mode === 'light' || mode === 'dark') return mode;
    return dark ? 'dark' : 'light';
}

export function themeColorFor(scheme) {
    return scheme === 'dark' ? THEME_COLOR.dark : THEME_COLOR.light;
}

export function currentScheme(doc = globalThis.document, win = globalThis) {
    const forced = doc?.documentElement?.getAttribute('data-vc-theme');
    if (forced === 'light' || forced === 'dark') return forced;
    return prefersDark(win) ? 'dark' : 'light';
}

function ensureMeta(doc) {
    let meta = doc.querySelector('meta[name="theme-color"]');
    if (!meta) {
        meta = doc.createElement('meta');
        meta.setAttribute('name', 'theme-color');
        doc.head?.append(meta);
    }
    return meta;
}

export function syncThemeColor(doc = globalThis.document, win = globalThis) {
    if (!doc?.head) return;
    const meta = ensureMeta(doc);
    if (!meta) return;
    const want = themeColorFor(currentScheme(doc, win));
    if (meta.getAttribute('content') === want) return;
    meta.setAttribute('content', want);
}

export function applyTheme(mode, doc = globalThis.document, win = globalThis) {
    const parsed = parseThemeMode(mode);
    const root = doc?.documentElement;
    if (!root) return parsed;
    if (parsed === 'auto') root.removeAttribute('data-vc-theme');
    else root.setAttribute('data-vc-theme', parsed);
    syncThemeColor(doc, win);
    return parsed;
}

export function setThemeMode(mode, storage, doc = globalThis.document) {
    const parsed = writeThemeMode(mode, storage);
    if (doc?.documentElement) applyTheme(parsed, doc);
    return parsed;
}

export function watchThemeColor(doc = globalThis.document) {
    if (!doc?.head || watching) return;
    watching = true;
    const hook = () => {
        const meta = ensureMeta(doc);
        if (meta && meta !== observedMeta) {
            observedMeta = meta;
            attrObserver?.disconnect();
            attrObserver = new MutationObserver(() => syncThemeColor(doc));
            attrObserver.observe(meta, { attributes: true, attributeFilter: ['content'] });
        }
        syncThemeColor(doc);
    };
    hook();
    headObserver = new MutationObserver(hook);
    headObserver.observe(doc.head, { childList: true });
    const mq = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
    mq?.addEventListener?.('change', () => {
        if (readThemeMode() === 'auto') applyTheme('auto', doc);
    });
}

export function enableVcUi(doc = globalThis.document) {
    doc?.body?.classList.add('vc-ui');
    applyTheme(readThemeMode(), doc);
    watchThemeColor(doc);
    bindViewport(doc?.documentElement);
    bindRangeFills(doc);
}
