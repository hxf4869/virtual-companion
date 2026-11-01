// 加主题：新增同目录 CSS（只声明语义变量），再登记名称、路径与组件变体。
// 明暗模式沿用 data-vc-theme；主题标识与模式互相独立。
export const DEFAULT_THEME_ID = 'aurora';
export const THEME_VARIANTS = Object.freeze({ bubble: Object.freeze(['grouped', 'rounded']) });
export const DESKTOP_THEMES = Object.freeze([
    Object.freeze({ id: 'aurora', name: '极光', css: new URL('./aurora.css', import.meta.url).href, variants: Object.freeze({ bubble: 'grouped' }) }),
]);
