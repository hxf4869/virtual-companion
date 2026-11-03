// 既有偏好与 React 外观页的边界：存储、事件和默认值继续由原模块提供。
import { readThemeMode, setThemeMode } from '../ui/theme.js';
import { readReplyStyle, writeReplyStyle } from '../chat-view.js';
import { readReducedMotion, writeReducedMotion } from './transition.js';
import { SUGGEST_KEY, suggestEnabled } from './suggest.js';
import { EFFECTS_KEY, effectsEnabled } from '../chat-react.js';
import { DESKTOP_THEMES } from './themes/index.js';
import { readThemePreferences, setGlobalThemePreference, setCharacterThemePreference, characterThemeKey } from './theme.js';
import { mountAppearanceView } from './build/index.js';

export function mountAppearance(body, getContext) {
    const preferences = readThemePreferences();
    const character = characterThemeKey(getContext()) || '';
    const writeLocalPreference = (key, on) => {
        try { localStorage.setItem(key, on ? 'on' : 'off'); } catch { /* 保留原有隐私模式下的本页状态。 */ }
    };
    const actions = {
        theme: setThemeMode,
        reply: writeReplyStyle,
        motion: writeReducedMotion,
        suggest: on => writeLocalPreference(SUGGEST_KEY, on),
        effects: on => writeLocalPreference(EFFECTS_KEY, on),
        globalTheme: setGlobalThemePreference,
        characterTheme: id => setCharacterThemePreference(character, id),
    };
    return mountAppearanceView(body, {
        initial: {
            theme: readThemeMode(), reply: readReplyStyle(), motion: readReducedMotion(),
            suggest: suggestEnabled(), effects: effectsEnabled(), globalTheme: preferences.global,
            characterTheme: preferences.characters[character] || '',
        },
        themes: DESKTOP_THEMES,
        character,
        onChange: (key, value) => actions[key](value),
    });
}
