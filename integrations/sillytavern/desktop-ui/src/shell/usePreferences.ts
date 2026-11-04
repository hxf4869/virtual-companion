import { create } from 'zustand';

export type ThemeMode = 'auto' | 'light' | 'dark';
export type ResolvedThemeMode = 'light' | 'dark';
export type DesktopMaterialTheme = 'aurora' | 'paper' | 'smoke';
export type ReplyStyle = 'spread' | 'bubble';

export const THEME_MODE_KEY = 'vc-theme';
export const REPLY_STYLE_KEY = 'vc-reply-style';
export const REDUCED_MOTION_KEY = 'vc-reduced-motion';
export const DESKTOP_THEME_KEY = 'vc-desktop-theme';
export const SIDEBAR_COLLAPSED_KEY = 'vc-sidebar-collapsed';
const LEGACY_SIDEBAR_KEY = 'vc-sidebar';

const DESKTOP_THEMES = new Set<DesktopMaterialTheme>(['aurora', 'paper', 'smoke']);

export interface DesktopThemeStoreData {
  global: DesktopMaterialTheme;
  characters: Record<string, DesktopMaterialTheme>;
}

function getStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function parseThemeMode(raw: unknown): ThemeMode {
  return raw === 'light' || raw === 'dark' ? raw : 'auto';
}

export function resolveThemeMode(mode: ThemeMode, prefersDark = false): ResolvedThemeMode {
  const parsed = parseThemeMode(mode);
  if (parsed === 'light' || parsed === 'dark') return parsed;
  return prefersDark ? 'dark' : 'light';
}

export function parseDesktopMaterialTheme(raw: unknown): DesktopMaterialTheme {
  return typeof raw === 'string' && DESKTOP_THEMES.has(raw as DesktopMaterialTheme)
    ? (raw as DesktopMaterialTheme)
    : 'aurora';
}

export function readDesktopThemePreferences(
  storage: Storage | null = getStorage(),
): DesktopThemeStoreData {
  const fallback: DesktopThemeStoreData = { global: 'aurora', characters: {} };
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(DESKTOP_THEME_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<DesktopThemeStoreData>;
    if (!parsed || typeof parsed !== 'object') return fallback;
    const globalTheme = parseDesktopMaterialTheme(parsed.global);
    const characters: Record<string, DesktopMaterialTheme> = {};
    if (parsed.characters && typeof parsed.characters === 'object') {
      for (const [k, v] of Object.entries(parsed.characters)) {
        if (k && typeof v === 'string' && DESKTOP_THEMES.has(v as DesktopMaterialTheme)) {
          characters[String(k)] = v as DesktopMaterialTheme;
        }
      }
    }
    return { global: globalTheme, characters };
  } catch {
    return fallback;
  }
}

export function resolveDesktopTheme(
  characterId?: string | null,
  prefs: DesktopThemeStoreData = readDesktopThemePreferences(),
): DesktopMaterialTheme {
  const key = characterId == null ? '' : String(characterId);
  if (key && prefs.characters[key]) {
    return prefs.characters[key];
  }
  return prefs.global;
}

function readThemeModeFromStorage(storage: Storage | null = getStorage()): ThemeMode {
  try {
    return parseThemeMode(storage?.getItem(THEME_MODE_KEY));
  } catch {
    return 'auto';
  }
}

function readReplyStyleFromStorage(storage: Storage | null = getStorage()): ReplyStyle {
  try {
    const v = storage?.getItem(REPLY_STYLE_KEY);
    return v === 'spread' || v === 'bubble' ? v : 'bubble';
  } catch {
    return 'bubble';
  }
}

function readReducedMotionFromStorage(storage: Storage | null = getStorage()): boolean {
  try {
    const v = storage?.getItem(REDUCED_MOTION_KEY);
    return v === 'true' || v === '1';
  } catch {
    return false;
  }
}

function readSidebarCollapsedFromStorage(storage: Storage | null = getStorage()): boolean {
  try {
    const v = storage?.getItem(SIDEBAR_COLLAPSED_KEY);
    if (v === 'true' || v === '1') return true;
    if (v === 'false' || v === '0') return false;
    const legacy = storage?.getItem(LEGACY_SIDEBAR_KEY);
    return legacy === 'collapsed';
  } catch {
    return false;
  }
}

export function isOsReducedMotion(): boolean {
  try {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      return Boolean(window.matchMedia('(prefers-reduced-motion: reduce)')?.matches);
    }
  } catch {
    // ignore
  }
  return false;
}

export function syncReducedMotionDomAttribute(appReducedMotion: boolean, osReduced?: boolean): boolean {
  const effective = Boolean(appReducedMotion || (osReduced ?? isOsReducedMotion()));
  if (typeof document !== 'undefined' && document.documentElement) {
    if (effective) {
      if (document.documentElement.dataset.vcReducedMotion !== 'true') {
        document.documentElement.dataset.vcReducedMotion = 'true';
      }
    } else if ('vcReducedMotion' in document.documentElement.dataset) {
      delete document.documentElement.dataset.vcReducedMotion;
    }
  }
  return effective;
}

export function syncThemeDomAttributes(
  themeMode: ThemeMode,
  desktopTheme: DesktopMaterialTheme,
): void {
  if (typeof document === 'undefined' || !document.documentElement) return;
  if (themeMode === 'light' || themeMode === 'dark') {
    document.documentElement.dataset.vcTheme = themeMode;
  } else {
    delete document.documentElement.dataset.vcTheme;
  }
  document.documentElement.dataset.vcDesktopTheme = desktopTheme;
}

export interface PreferencesState {
  themeMode: ThemeMode;
  desktopThemePrefs: DesktopThemeStoreData;
  activeDesktopTheme: DesktopMaterialTheme;
  replyStyle: ReplyStyle;
  reducedMotion: boolean;
  sidebarCollapsed: boolean;
  activeCharacterId: string | null;
  characterTint: string;
  setThemeMode: (mode: ThemeMode) => void;
  setGlobalDesktopTheme: (theme: DesktopMaterialTheme) => void;
  setCharacterDesktopTheme: (characterId: string, theme: DesktopMaterialTheme | null) => void;
  setReplyStyle: (style: ReplyStyle) => void;
  setReducedMotion: (reduced: boolean) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebarCollapsed: () => void;
  setCharacterTint: (tint: string) => void;
  syncFromStorage: (characterId?: string | null) => void;
  resetForTest?: () => void;
}

function readInitialSnapshot(characterId: string | null = null) {
  const storage = getStorage();
  const themeMode = readThemeModeFromStorage(storage);
  const desktopThemePrefs = readDesktopThemePreferences(storage);
  const activeDesktopTheme = resolveDesktopTheme(characterId, desktopThemePrefs);
  const replyStyle = readReplyStyleFromStorage(storage);
  const reducedMotion = readReducedMotionFromStorage(storage);
  const sidebarCollapsed = readSidebarCollapsedFromStorage(storage);
  return {
    themeMode,
    desktopThemePrefs,
    activeDesktopTheme,
    replyStyle,
    reducedMotion,
    sidebarCollapsed,
  };
}

export const usePreferences = create<PreferencesState>((set, get) => {
  const initial = readInitialSnapshot(null);

  return {
    ...initial,
    activeCharacterId: null,
    characterTint: '',

    setThemeMode(mode) {
      const parsed = parseThemeMode(mode);
      try {
        getStorage()?.setItem(THEME_MODE_KEY, parsed);
      } catch {
        // ignore
      }
      syncThemeDomAttributes(parsed, get().activeDesktopTheme);
      set({ themeMode: parsed });
    },

    setGlobalDesktopTheme(theme) {
      const valid = parseDesktopMaterialTheme(theme);
      const current = readDesktopThemePreferences();
      const nextPrefs: DesktopThemeStoreData = {
        global: valid,
        characters: { ...current.characters },
      };
      try {
        getStorage()?.setItem(DESKTOP_THEME_KEY, JSON.stringify(nextPrefs));
      } catch {
        // ignore
      }
      const activeDesktopTheme = resolveDesktopTheme(get().activeCharacterId, nextPrefs);
      syncThemeDomAttributes(get().themeMode, activeDesktopTheme);
      set({ desktopThemePrefs: nextPrefs, activeDesktopTheme });
    },

    setCharacterDesktopTheme(characterId, theme) {
      const current = readDesktopThemePreferences();
      const characters = { ...current.characters };
      if (!theme) {
        delete characters[String(characterId)];
      } else {
        characters[String(characterId)] = parseDesktopMaterialTheme(theme);
      }
      const nextPrefs: DesktopThemeStoreData = {
        global: current.global,
        characters,
      };
      try {
        getStorage()?.setItem(DESKTOP_THEME_KEY, JSON.stringify(nextPrefs));
      } catch {
        // ignore
      }
      const activeDesktopTheme = resolveDesktopTheme(get().activeCharacterId, nextPrefs);
      syncThemeDomAttributes(get().themeMode, activeDesktopTheme);
      set({ desktopThemePrefs: nextPrefs, activeDesktopTheme });
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
        getStorage()?.setItem(REDUCED_MOTION_KEY, flag ? 'true' : 'false');
      } catch {
        // ignore
      }
      syncReducedMotionDomAttribute(flag);
      set({ reducedMotion: flag });
    },

    setSidebarCollapsed(collapsed) {
      const flag = Boolean(collapsed);
      try {
        getStorage()?.setItem(SIDEBAR_COLLAPSED_KEY, flag ? 'true' : 'false');
        getStorage()?.setItem(LEGACY_SIDEBAR_KEY, flag ? 'collapsed' : 'expanded');
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
      const snap = readInitialSnapshot(nextCharId);
      syncThemeDomAttributes(snap.themeMode, snap.activeDesktopTheme);
      syncReducedMotionDomAttribute(snap.reducedMotion);
      set({
        ...snap,
        activeCharacterId: nextCharId,
      });
    },

    resetForTest() {
      const snap = readInitialSnapshot(null);
      syncThemeDomAttributes(snap.themeMode, snap.activeDesktopTheme);
      syncReducedMotionDomAttribute(snap.reducedMotion);
      set({
        ...snap,
        activeCharacterId: null,
        characterTint: '',
      });
    },
  };
});
