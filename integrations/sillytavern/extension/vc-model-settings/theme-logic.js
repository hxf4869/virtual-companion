import { DEFAULT_THEME_ID, DESKTOP_THEMES } from './desktop/themes/index.js';

export const THEME_KEY = 'vc-theme';
export const UI_FLAG_KEY = 'vc-ui';
export const THEME_COLOR = { light: '#f5f5f7', dark: '#000000' };

export const THEME_PREF_KEY = 'vc-desktop-theme';
export const THEME_PREF_EVENT = 'vc-desktop-theme-preference';

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

export function resolveThemeMode(mode, dark) {
  if (mode === 'light' || mode === 'dark') return mode;
  return dark ? 'dark' : 'light';
}

export function themeColorFor(scheme) {
  return scheme === 'dark' ? THEME_COLOR.dark : THEME_COLOR.light;
}

// 只有这一处负责偏好存取；移动端 MB-2 确定同步契约后在这里接入服务器。
export function readThemePreferences(storage = globalThis.localStorage) {
  try {
    const value = JSON.parse(storage?.getItem(THEME_PREF_KEY) || 'null');
    return {
      global: typeof value?.global === 'string' ? value.global : DEFAULT_THEME_ID,
      characters:
        value?.characters && typeof value.characters === 'object' && !Array.isArray(value.characters)
          ? Object.fromEntries(Object.entries(value.characters).filter(([, id]) => typeof id === 'string'))
          : {},
    };
  } catch {
    return { global: DEFAULT_THEME_ID, characters: {} };
  }
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
  if (id) {
    Object.defineProperty(preferences.characters, character, {
      value: id,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  } else {
    delete preferences.characters[character];
  }
  writePreferences(preferences, storage);
}

export function resolveDesktopTheme({ global, character } = {}, registry = DESKTOP_THEMES) {
  return (
    registry.find((theme) => theme.id === character) ||
    registry.find((theme) => theme.id === global) ||
    registry.find((theme) => theme.id === DEFAULT_THEME_ID)
  );
}

export { resolveDesktopTheme as resolveTheme };

export function characterThemeKey(context = {}) {
  const card = context.characters?.[context.characterId];
  return String(
    context.chatMetadata?.vc_binding?.characterRef || card?.data?.extensions?.vc_character_ref || card?.avatar || '',
  );
}

export function rotateHue(rgb, degrees = 40) {
  const [r, g, b] = rgb.split(',').map((v) => Number(v.trim()) / 255);
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min,
    l = (max + min) / 2;
  if (!d) return rgb;
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (((h * 60 + degrees) % 360) + 360) % 360 / 60;
  const s = d / (1 - Math.abs(2 * l - 1)),
    c = (1 - Math.abs(2 * l - 1)) * s,
    x = c * (1 - Math.abs((h % 2) - 1)),
    m = l - c / 2;
  const result = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
  return result.map((v) => Math.round((v + m) * 255)).join(',');
}

// UX-34 晨昏氛围：本地时段 -> 时段名；色相 / 亮度偏移量由主题 CSS 变量按 data-vc-period 提供。
export function timeOfDayShift(date = new Date()) {
  const h = date.getHours();
  return h >= 6 && h < 10 ? 'morning' : h >= 10 && h < 17 ? 'noon' : h >= 17 && h < 20 ? 'evening' : 'night';
}
