// 主题状态：全局主题 + 模式 + 当前角色覆盖。页面只调用这里的函数，不直接写 token。
import { reactive } from 'vue';
import { applyTheme, readCache, resolveMode, resolveTheme, writeCache } from './runtime.mjs';

export const themeState = reactive({ global: undefined, mode: 'auto', character: undefined, tint: undefined, themeId: '', resolvedMode: 'light' });
let media = null;

function apply() {
    if (typeof document === 'undefined') return;
    const theme = resolveTheme({ global: themeState.global, character: themeState.character });
    const mode = resolveMode(themeState.mode, Boolean(media?.matches));
    applyTheme(document.documentElement, { theme, mode, tint: themeState.tint });
    themeState.themeId = theme.id;
    themeState.resolvedMode = mode;
}

export function startTheme() {
    const cached = readCache(globalThis.localStorage);
    themeState.global = cached.global;
    themeState.mode = cached.mode;
    if (typeof matchMedia === 'function' && !media) {
        media = matchMedia('(prefers-color-scheme: dark)');
        media.addEventListener?.('change', apply);
    }
    apply();
}

export function setGlobalTheme(id) { themeState.global = id; writeCache(globalThis.localStorage, themeState); apply(); }
export function setThemeMode(mode) { themeState.mode = mode; writeCache(globalThis.localStorage, themeState); apply(); }
// 进入某角色的对话 / 通话 / 来电时调用；离开时传 undefined 恢复全局。
export function setCharacterTheme(id, tint) { themeState.character = id; themeState.tint = tint; apply(); }
