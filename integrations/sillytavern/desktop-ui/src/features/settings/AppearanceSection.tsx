import { useEffect, useState } from 'react';
import { DESKTOP_THEMES } from '../../../../extension/vc-model-settings/desktop/themes/index.js';
import { characterThemeKey } from '../../../../extension/vc-model-settings/theme-logic.js';
import { Segment } from '../../design/components/Segment';
import { Switch } from '../../design/components/Switch';
import { useChatSnapshot, useSessionBridge } from '../../runtime/session-bridge';
import type { ReplyStyle, ThemeMode } from '../appearance/types';

export type { ReplyStyle, ThemeMode };

const THEME_MODES: readonly { value: ThemeMode; label: string }[] = [
  { value: 'auto', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
];

const REPLY_STYLES: readonly { value: ReplyStyle; label: string }[] = [
  { value: 'spread', label: '铺开' },
  { value: 'bubble', label: '气泡' },
];

const SUGGEST_KEY = 'vc-suggest-reply';
const EFFECTS_KEY = 'vc-keyword-effects';

function readBoolPref(key: string, defaultVal = true): boolean {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return defaultVal;
    return raw !== 'false' && raw !== '0' && raw !== 'off';
  } catch {
    return defaultVal;
  }
}

function writeBoolPref(key: string, val: boolean): void {
  try {
    window.localStorage.setItem(key, val ? 'on' : 'off');
  } catch {
    // ignore
  }
}

export interface AppearanceThemeOption {
  id: string;
  name: string;
}

export interface AppearanceThemeStoreData {
  global: string;
  characters: Record<string, string>;
}

export interface AppearancePreferencesBinding {
  themeMode: ThemeMode;
  desktopThemePrefs: AppearanceThemeStoreData;
  replyStyle: ReplyStyle;
  reducedMotion: boolean;
  setThemeMode: (mode: ThemeMode) => void;
  setGlobalDesktopTheme: (themeId: string) => void;
  setCharacterDesktopTheme: (characterId: string, themeId: string | null) => void;
  setReplyStyle: (style: ReplyStyle) => void;
  setReducedMotion: (reduced: boolean) => void;
  syncFromStorage: (characterId?: string | null) => void;
}

export interface AppearanceSectionProps {
  preferences: AppearancePreferencesBinding;
  themes?: readonly AppearanceThemeOption[];
}

function ThemeSelect({
  label,
  scope,
  value,
  options,
  onChange,
}: {
  label: string;
  scope: 'global' | 'character';
  value: string;
  options: readonly AppearanceThemeOption[];
  onChange: (value: string) => void;
}) {
  const selected = options.some((option) => option.id === value) ? value : options[0]?.id ?? '';
  return (
    <label className="vc-desk-field">
      <span>{label}</span>
      <select
        aria-label={label}
        data-theme-scope={scope}
        value={selected}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function AppearanceSection({
  preferences,
  themes = DESKTOP_THEMES as unknown as readonly AppearanceThemeOption[],
}: AppearanceSectionProps) {
  const bridge = useSessionBridge();
  const snapshotCharacter = useChatSnapshot((s) => s.characterRef || s.avatar || '');
  const currentCharacter =
    snapshotCharacter || characterThemeKey(bridge.getContext?.()) || '';

  const {
    themeMode,
    desktopThemePrefs,
    replyStyle,
    reducedMotion,
    setThemeMode,
    setGlobalDesktopTheme,
    setCharacterDesktopTheme,
    setReplyStyle,
    setReducedMotion,
    syncFromStorage,
  } = preferences;

  const [suggest, setSuggest] = useState<boolean>(() => readBoolPref(SUGGEST_KEY, true));
  const [effects, setEffects] = useState<boolean>(() => readBoolPref(EFFECTS_KEY, true));

  // B11: Re-read persisted preferences and bind active character every time AppearanceSection mounts or conversation character changes
  useEffect(() => {
    syncFromStorage(currentCharacter || null);
  }, [currentCharacter, syncFromStorage]);

  const globalThemeId = desktopThemePrefs.global || themes[0]?.id || '';
  const characterThemeId =
    currentCharacter &&
    Object.prototype.hasOwnProperty.call(desktopThemePrefs.characters, currentCharacter)
      ? desktopThemePrefs.characters[currentCharacter] || ''
      : '';

  return (
    <section className="vc-desk-group vc-settings-section" data-vc-appearance="">
      <h2>外观</h2>
      <div className="vc-desk-field">
        <span>外观</span>
        <Segment
          aria-label="外观"
          value={themeMode}
          options={THEME_MODES}
          onValueChange={(val) => setThemeMode(val as ThemeMode)}
        />
      </div>
      <div className="vc-desk-field">
        <span>回复样式</span>
        <Segment
          aria-label="回复样式"
          value={replyStyle}
          options={REPLY_STYLES}
          onValueChange={(val) => setReplyStyle(val as ReplyStyle)}
        />
      </div>
      <div className="vc-desk-field">
        <span>减弱动态效果</span>
        <Switch
          aria-label="减弱动态效果"
          checked={reducedMotion}
          onCheckedChange={(val) => setReducedMotion(val)}
        />
      </div>
      <div className="vc-desk-field">
        <span>建议回复</span>
        <Switch
          aria-label="建议回复"
          checked={suggest}
          onCheckedChange={(val) => {
            writeBoolPref(SUGGEST_KEY, val);
            setSuggest(val);
          }}
        />
      </div>
      <div className="vc-desk-field">
        <span>关键词特效</span>
        <Switch
          aria-label="关键词特效"
          checked={effects}
          onCheckedChange={(val) => {
            writeBoolPref(EFFECTS_KEY, val);
            setEffects(val);
          }}
        />
      </div>

      {themes.length > 1 && (
        <>
          <ThemeSelect
            label="主题"
            scope="global"
            value={globalThemeId}
            options={themes}
            onChange={(val) => setGlobalDesktopTheme(val)}
          />
          {currentCharacter && (
            <ThemeSelect
              label="当前角色主题"
              scope="character"
              value={characterThemeId}
              options={[{ id: '', name: '跟随全局' }, ...themes]}
              onChange={(val) => setCharacterDesktopTheme(currentCharacter, val || null)}
            />
          )}
        </>
      )}
    </section>
  );
}
export default AppearanceSection;
