export type ThemeMode = 'auto' | 'light' | 'dark';
export type ReplyStyle = 'spread' | 'bubble';

export interface ThemeOption {
    id: string;
    name: string;
}

export interface AppearancePreferences {
    theme: ThemeMode;
    reply: ReplyStyle;
    motion: boolean;
    suggest: boolean;
    effects: boolean;
    globalTheme: string;
    characterTheme: string;
}

export interface AppearanceProps {
    initial: AppearancePreferences;
    themes: readonly ThemeOption[];
    character: string;
    onChange: <K extends keyof AppearancePreferences>(key: K, value: AppearancePreferences[K]) => void;
}
