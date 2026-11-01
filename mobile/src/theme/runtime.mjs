// 主题运行时：解析（全局 + 角色覆盖）、生成 CSS 自定义属性、写到根元素。
// 纯函数部分不依赖 DOM，便于离线单测；applyTheme 只在浏览器调用。
import BASE from '../themes/base.mjs';
import { THEMES, DEFAULT_THEME_ID } from '../themes/index.mjs';

export const MODES = ['light', 'dark', 'auto'];
// 组件变体的有限枚举：每个组件只认这里列出的值，主题只能在其中选择（首版每项只实现第一个）。
export const VARIANTS = {
    bubble: ['tail'],
    tabbar: ['floating'],
    icons: ['line'],
    sound: ['soft'],
};
const CACHE_KEY = 'vc-mobile-theme';

export function findTheme(id, themes = THEMES) {
    return themes.find((t) => t.id === id) || themes.find((t) => t.id === DEFAULT_THEME_ID) || themes[0];
}

// 角色单独指定的主题优先，其次全局主题，最后默认主题；未知 id 回到默认。
export function resolveTheme({ global, character } = {}, themes = THEMES) {
    const pick = [character, global].find((id) => typeof id === 'string' && themes.some((t) => t.id === id));
    return findTheme(pick || DEFAULT_THEME_ID, themes);
}

export function resolveMode(mode, prefersDark) {
    if (mode === 'light' || mode === 'dark') return mode;
    return prefersDark ? 'dark' : 'light';
}

export function resolveVariants(theme) {
    const out = {};
    for (const [name, allowed] of Object.entries(VARIANTS)) {
        const want = theme.variants?.[name];
        out[name] = allowed.includes(want) ? want : allowed[0];
    }
    return out;
}

// 返回 { '--vc-canvas': '#…', … }：基础 token 先铺，主题当前模式覆盖。
export function cssVars(theme, mode) {
    const values = { ...BASE, ...(theme.base || {}), ...(theme.modes?.[mode] || theme.modes?.light || {}) };
    return Object.fromEntries(Object.entries(values).map(([k, v]) => [`--vc-${k}`, String(v)]));
}

export function applyTheme(root, { theme, mode, tint } = {}) {
    const vars = cssVars(theme, mode);
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    if (typeof tint === 'string' && /^\d{1,3},\d{1,3},\d{1,3}$/.test(tint)) root.style.setProperty('--tint', tint);
    if (!tint) root.style.removeProperty('--tint');
    root.dataset.vcThemeId = theme.id;
    root.dataset.vcTheme = mode;
    for (const [name, value] of Object.entries(resolveVariants(theme))) root.dataset[`vcVariant${name[0].toUpperCase()}${name.slice(1)}`] = value;
    return vars;
}

// 启动时先用本机缓存上色，服务器设置读到后再对齐（ADR-0011 §7.1 存储）。
export function readCache(storage) {
    try {
        const v = JSON.parse(storage?.getItem(CACHE_KEY) || '{}');
        return { global: typeof v.global === 'string' ? v.global : undefined, mode: MODES.includes(v.mode) ? v.mode : 'auto' };
    } catch {
        return { global: undefined, mode: 'auto' };
    }
}

export function writeCache(storage, { global, mode }) {
    try { storage?.setItem(CACHE_KEY, JSON.stringify({ global, mode })); } catch { /* 隐私模式等不可写时忽略 */ }
}
