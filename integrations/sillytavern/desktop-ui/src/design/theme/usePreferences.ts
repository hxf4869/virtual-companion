import { create } from 'zustand';
import {
  DEFAULT_THEME_ID,
  DESKTOP_THEMES,
  THEME_VARIANTS,
} from '../../../../extension/vc-model-settings/desktop/themes/index.js';
import {
  THEME_KEY,
  THEME_PREF_EVENT,
  THEME_PREF_KEY,
  parseThemeMode,
  readThemeMode,
  readThemePreferences,
  resolveDesktopTheme,
  resolveThemeMode,
  setCharacterThemePreference,
  setGlobalThemePreference,
  writeThemeMode,
} from '../../../../extension/vc-model-settings/theme-logic.js';

export type ThemeMode = 'auto' | 'light' | 'dark';
export type ResolvedThemeMode = 'light' | 'dark';
export type ReplyStyle = 'spread' | 'bubble';

export const THEME_MODE_KEY = THEME_KEY;
export const DESKTOP_THEME_KEY = THEME_PREF_KEY;
export const REPLY_STYLE_KEY = 'vc-reply-style';
export const REDUCED_MOTION_KEY = 'vc-reduced-motion';
export const SIDEBAR_COLLAPSED_KEY = 'vc-sidebar-collapsed';

export {
  DEFAULT_THEME_ID,
  DESKTOP_THEMES,
  THEME_VARIANTS,
  THEME_PREF_EVENT,
  parseThemeMode,
  readThemeMode,
  writeThemeMode,
  resolveThemeMode,
  readThemePreferences,
  setGlobalThemePreference,
  setCharacterThemePreference,
  resolveDesktopTheme,
};

export interface DesktopThemeStoreData {
  global: string;
  characters: Record<string, string>;
}

export interface DesktopThemeDefinition {
  id: string;
  name: string;
  css: string;
  variants?: Record<string, string>;
}

function getStorage(): Storage | undefined {
  try {
    return typeof window !== 'undefined' ? window.localStorage : undefined;
  } catch {
    return undefined;
  }
}

function readReplyStyleFromStorage(storage = getStorage()): ReplyStyle {
  try {
    const v = storage?.getItem(REPLY_STYLE_KEY);
    return v === 'spread' || v === 'bubble' ? v : 'bubble';
  } catch {
    return 'bubble';
  }
}

function readReducedMotionFromStorage(storage = getStorage()): boolean {
  try {
    return storage?.getItem(REDUCED_MOTION_KEY) === 'true';
  } catch {
    return false;
  }
}

function readSidebarCollapsedFromStorage(storage = getStorage()): boolean {
  try {
    return storage?.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
}

function resolveActiveThemeObject(
  characterId: string | null | undefined,
  prefs: DesktopThemeStoreData,
): DesktopThemeDefinition {
  const key = characterId == null ? '' : String(characterId);
  const character =
    key && Object.prototype.hasOwnProperty.call(prefs.characters, key)
      ? prefs.characters[key]
      : undefined;
  const resolved = resolveDesktopTheme(
    { global: prefs.global, character },
    DESKTOP_THEMES,
  ) as DesktopThemeDefinition | undefined;
  return (
    resolved ??
    ((DESKTOP_THEMES as unknown as DesktopThemeDefinition[])[0] as DesktopThemeDefinition)
  );
}

export function syncThemeDomAttributes(
  themeMode: ThemeMode,
  theme: DesktopThemeDefinition,
): void {
  if (typeof document === 'undefined' || !document.documentElement) return;
  const root = document.documentElement;
  root.dataset.vcTheme = parseThemeMode(themeMode) as ThemeMode;
  if (theme?.id) {
    root.dataset.vcThemeId = theme.id;
  }
  for (const [name, allowed] of Object.entries(
    THEME_VARIANTS as Record<string, readonly string[]>,
  )) {
    const value = theme?.variants?.[name];
    root.setAttribute(
      `data-vc-variant-${name}`,
      value && allowed.includes(value) ? value : allowed[0],
    );
  }
}

export interface PreferencesState {
  themeMode: ThemeMode;
  desktopThemePrefs: DesktopThemeStoreData;
  activeDesktopTheme: string;
  replyStyle: ReplyStyle;
  reducedMotion: boolean;
  sidebarCollapsed: boolean;
  activeCharacterId: string | null;
  characterTint: string;
  setThemeMode: (mode: ThemeMode) => void;
  setGlobalDesktopTheme: (themeId: string) => void;
  setCharacterDesktopTheme: (characterId: string, themeId: string | null) => void;
  setReplyStyle: (style: ReplyStyle) => void;
  setReducedMotion: (reduced: boolean) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebarCollapsed: () => void;
  setCharacterTint: (tint: string) => void;
  syncFromStorage: (characterId?: string | null) => void;
  resetForTest?: () => void;
}

function readSnapshot(characterId: string | null = null) {
  const storage = getStorage();
  const themeMode = readThemeMode(storage) as ThemeMode;
  const desktopThemePrefs = readThemePreferences(storage) as DesktopThemeStoreData;
  const themeObj = resolveActiveThemeObject(characterId, desktopThemePrefs);
  const replyStyle = readReplyStyleFromStorage(storage);
  const reducedMotion = readReducedMotionFromStorage(storage);
  const sidebarCollapsed = readSidebarCollapsedFromStorage(storage);
  return {
    themeMode,
    desktopThemePrefs,
    themeObj,
    activeDesktopTheme: themeObj?.id ?? DEFAULT_THEME_ID,
    replyStyle,
    reducedMotion,
    sidebarCollapsed,
  };
}

export const usePreferences = create<PreferencesState>((set, get) => {
  const initial = readSnapshot(null);
  syncThemeDomAttributes(initial.themeMode, initial.themeObj);

  return {
    themeMode: initial.themeMode,
    desktopThemePrefs: initial.desktopThemePrefs,
    activeDesktopTheme: initial.activeDesktopTheme,
    replyStyle: initial.replyStyle,
    reducedMotion: initial.reducedMotion,
    sidebarCollapsed: initial.sidebarCollapsed,
    activeCharacterId: null,
    characterTint: '',

    setThemeMode(mode) {
      const parsed = writeThemeMode(mode, getStorage()) as ThemeMode;
      const themeObj = resolveActiveThemeObject(
        get().activeCharacterId,
        get().desktopThemePrefs,
      );
      syncThemeDomAttributes(parsed, themeObj);
      set({ themeMode: parsed });
    },

    setGlobalDesktopTheme(themeId) {
      const storage = getStorage();
      setGlobalThemePreference(String(themeId ?? ''), storage);
      const desktopThemePrefs = readThemePreferences(storage) as DesktopThemeStoreData;
      const themeObj = resolveActiveThemeObject(get().activeCharacterId, desktopThemePrefs);
      syncThemeDomAttributes(get().themeMode, themeObj);
      set({
        desktopThemePrefs,
        activeDesktopTheme: themeObj?.id ?? DEFAULT_THEME_ID,
      });
    },

    setCharacterDesktopTheme(characterId, themeId) {
      const storage = getStorage();
      setCharacterThemePreference(
        String(characterId ?? ''),
        themeId ? String(themeId) : '',
        storage,
      );
      const desktopThemePrefs = readThemePreferences(storage) as DesktopThemeStoreData;
      const themeObj = resolveActiveThemeObject(get().activeCharacterId, desktopThemePrefs);
      syncThemeDomAttributes(get().themeMode, themeObj);
      set({
        desktopThemePrefs,
        activeDesktopTheme: themeObj?.id ?? DEFAULT_THEME_ID,
      });
    },

    setReplyStyle(style) {
      const valid: ReplyStyle = style === 'spread' ? 'spread' : 'bubble';
      try {
        getStorage()?.setItem(REPLY_STYLE_KEY, valid);
      } catch {
        // ignore
      }
      set({ replyStyle: valid });
    },

    setReducedMotion(reduced) {
      const flag = Boolean(reduced);
      try {
        getStorage()?.setItem(REDUCED_MOTION_KEY, String(flag));
      } catch {
        // ignore
      }
      set({ reducedMotion: flag });
    },

    setSidebarCollapsed(collapsed) {
      const flag = Boolean(collapsed);
      try {
        getStorage()?.setItem(SIDEBAR_COLLAPSED_KEY, String(flag));
      } catch {
        // ignore
      }
      set({ sidebarCollapsed: flag });
    },

    toggleSidebarCollapsed() {
      const next = !get().sidebarCollapsed;
      get().setSidebarCollapsed(next);
    },

    setCharacterTint(tint) {
      set({ characterTint: String(tint ?? '').trim() });
    },

    syncFromStorage(characterId) {
      const nextCharId = characterId === undefined ? get().activeCharacterId : characterId;
      const snap = readSnapshot(nextCharId);
      syncThemeDomAttributes(snap.themeMode, snap.themeObj);
      set({
        themeMode: snap.themeMode,
        desktopThemePrefs: snap.desktopThemePrefs,
        activeDesktopTheme: snap.activeDesktopTheme,
        replyStyle: snap.replyStyle,
        reducedMotion: snap.reducedMotion,
        sidebarCollapsed: snap.sidebarCollapsed,
        activeCharacterId: nextCharId,
      });
    },

    resetForTest() {
      const snap = readSnapshot(null);
      syncThemeDomAttributes(snap.themeMode, snap.themeObj);
      set({
        themeMode: snap.themeMode,
        desktopThemePrefs: snap.desktopThemePrefs,
        activeDesktopTheme: snap.activeDesktopTheme,
        replyStyle: snap.replyStyle,
        reducedMotion: snap.reducedMotion,
        sidebarCollapsed: snap.sidebarCollapsed,
        activeCharacterId: null,
        characterTint: '',
      });
    },
  };
});
