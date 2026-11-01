import { DEFAULT_THEME_ID, DESKTOP_THEMES, THEME_VARIANTS } from './themes/index.js';

export const THEME_PREF_KEY = 'vc-desktop-theme';
export const THEME_PREF_EVENT = 'vc-desktop-theme-preference';

// 只有这一处负责偏好存取；移动端 MB-2 确定同步契约后在这里接入服务器。
export function readThemePreferences(storage = globalThis.localStorage) {
    try {
        const value = JSON.parse(storage?.getItem(THEME_PREF_KEY) || 'null');
        return {
            global: typeof value?.global === 'string' ? value.global : DEFAULT_THEME_ID,
            characters: value?.characters && typeof value.characters === 'object' && !Array.isArray(value.characters)
                ? Object.fromEntries(Object.entries(value.characters).filter(([, id]) => typeof id === 'string')) : {},
        };
    } catch { return { global: DEFAULT_THEME_ID, characters: {} }; }
}

function writePreferences(preferences, storage) {
    storage?.setItem(THEME_PREF_KEY, JSON.stringify(preferences));
    globalThis.dispatchEvent?.(new Event(THEME_PREF_EVENT));
}

export function setGlobalThemePreference(id, storage = globalThis.localStorage) {
    const preferences = readThemePreferences(storage);
    preferences.global = id;
    writePreferences(preferences, storage);
}

export function setCharacterThemePreference(character, id, storage = globalThis.localStorage) {
    if (!character) return;
    const preferences = readThemePreferences(storage);
    if (id) Object.defineProperty(preferences.characters, character, { value: id, enumerable: true, configurable: true, writable: true });
    else delete preferences.characters[character];
    writePreferences(preferences, storage);
}

export function resolveTheme({ global, character } = {}, registry = DESKTOP_THEMES) {
    return registry.find(theme => theme.id === character)
        || registry.find(theme => theme.id === global)
        || registry.find(theme => theme.id === DEFAULT_THEME_ID);
}

export function characterThemeKey(context = {}) {
    const card = context.characters?.[context.characterId];
    return String(context.chatMetadata?.vc_binding?.characterRef || card?.data?.extensions?.vc_character_ref || card?.avatar || '');
}

// 极光随 base.css 同步加载，首屏与旧版一致。其他主题加载完成后才一次性切换，失败保留当前主题。
export function mountDesktopTheme({ shell, getContext = () => ({}), document: doc = globalThis.document,
    storage = globalThis.localStorage, registry = DESKTOP_THEMES } = {}) {
    const root = doc.documentElement;
    const win = doc.defaultView || globalThis;
    let current = DEFAULT_THEME_ID;
    let activeLink = null;
    let cancelPending = null;
    let request = 0;
    let destroyed = false;

    function apply(theme) {
        root.dataset.vcThemeId = theme.id;
        for (const [name, allowed] of Object.entries(THEME_VARIANTS)) {
            const value = theme.variants?.[name];
            root.setAttribute(`data-vc-variant-${name}`, allowed.includes(value) ? value : allowed[0]);
        }
        current = theme.id;
        win.dispatchEvent?.(new CustomEvent('vc-desktop-theme-applied', { detail: { themeId: current } }));
    }

    async function refresh() {
        if (destroyed) return false;
        const ticket = ++request;
        cancelPending?.();
        cancelPending = null;
        if (root.dataset.vcLayout !== 'desktop') {
            root.removeAttribute('data-vc-theme-id');
            for (const name of Object.keys(THEME_VARIANTS)) root.removeAttribute(`data-vc-variant-${name}`);
            return true;
        }
        const preferences = readThemePreferences(storage);
        const inConversation = shell?.dataset.destination === 'chat' && shell?.dataset.chat === 'open' && shell?.dataset.settings !== 'page';
        const key = inConversation ? characterThemeKey(getContext()) : '';
        const character = key && Object.hasOwn(preferences.characters, key) ? preferences.characters[key] : undefined;
        const theme = resolveTheme({ global: preferences.global, character }, registry);
        if (!theme) return false;
        if (theme.id === current) { apply(theme); return true; }
        if (theme.id === DEFAULT_THEME_ID) {
            activeLink?.remove(); activeLink = null;
            apply(theme);
            return true;
        }
        const link = doc.createElement('link');
        link.rel = 'stylesheet';
        link.href = theme.css; // URL 只能来自本机代码注册表，不由存储中的 id 拼路径。
        link.media = 'not all';
        link.dataset.vcThemeSheet = theme.id;
        const loaded = await new Promise(resolve => {
            const finish = ok => { link.onload = link.onerror = null; resolve(ok); };
            link.onload = () => finish(true);
            link.onerror = () => finish(false);
            cancelPending = () => { link.remove(); finish(false); };
            doc.head.append(link);
        });
        if (!loaded || ticket !== request || destroyed) { link.remove(); return false; }
        cancelPending = null;
        link.media = '(min-width: 744px)';
        activeLink?.remove(); activeLink = link;
        apply(theme);
        return true;
    }

    const sync = () => { void refresh(); };
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ['data-vc-layout'] });
    if (shell) observer.observe(shell, { attributes: true, attributeFilter: ['data-chat', 'data-destination', 'data-settings'] });
    win.addEventListener(THEME_PREF_EVENT, sync);
    const onStorage = event => { if (event.key === THEME_PREF_KEY || event.key === null) sync(); };
    win.addEventListener('storage', onStorage);
    const context = getContext();
    const changed = context.eventTypes?.CHAT_CHANGED;
    if (changed) context.eventSource?.on(changed, sync);
    const ready = refresh();
    return { ready, refresh, destroy() {
        destroyed = true; request += 1;
        cancelPending?.(); activeLink?.remove(); observer.disconnect();
        win.removeEventListener(THEME_PREF_EVENT, sync);
        win.removeEventListener('storage', onStorage);
        if (changed) context.eventSource?.removeListener(changed, sync);
        root.removeAttribute('data-vc-theme-id');
        for (const name of Object.keys(THEME_VARIANTS)) root.removeAttribute(`data-vc-variant-${name}`);
    } };
}
