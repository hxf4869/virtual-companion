import { useState } from 'react';
import { Segment } from '../../components/Segment';
import { Switch } from '../../components/Switch';
import type { AppearancePreferences, AppearanceProps, ReplyStyle, ThemeMode, ThemeOption } from './types';

const THEME_MODES: readonly { value: ThemeMode; label: string }[] = [
    { value: 'auto', label: '跟随系统' }, { value: 'light', label: '浅色' }, { value: 'dark', label: '深色' },
];
const REPLY_STYLES: readonly { value: ReplyStyle; label: string }[] = [
    { value: 'spread', label: '铺开' }, { value: 'bubble', label: '气泡' },
];

function ThemeSelect({ label, value, options, onChange }: {
    label: string; value: string; options: readonly ThemeOption[]; onChange: (value: string) => void;
}) {
    const selected = options.some(option => option.id === value) ? value : options[0]?.id;
    return <label className="vc-desk-field"><span>{label}</span>
        <select aria-label={label} value={selected} onChange={event => onChange(event.target.value)}>
            {options.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
        </select>
    </label>;
}

export function Appearance({ initial, themes, character, onChange }: AppearanceProps) {
    const [preferences, setPreferences] = useState(initial);
    function change<K extends keyof AppearancePreferences>(key: K, value: AppearancePreferences[K]) {
        onChange(key, value);
        setPreferences(current => ({ ...current, [key]: value }));
    }
    return <section className="vc-desk-group" data-vc-appearance="">
        <h2>外观</h2>
        <div className="vc-desk-field"><span>外观</span><Segment label="外观" preference="theme" value={preferences.theme}
            options={THEME_MODES} onValueChange={value => change('theme', value)} /></div>
        <div className="vc-desk-field"><span>回复样式</span><Segment label="回复样式" preference="reply" value={preferences.reply}
            options={REPLY_STYLES} onValueChange={value => change('reply', value)} /></div>
        <div className="vc-desk-field"><span>减弱动态效果</span><Switch label="减弱动态效果" preference="motion"
            checked={preferences.motion} onCheckedChange={value => change('motion', value)} /></div>
        <div className="vc-desk-field"><span>建议回复</span><Switch label="建议回复" preference="suggest"
            checked={preferences.suggest} onCheckedChange={value => change('suggest', value)} /></div>
        <div className="vc-desk-field"><span>关键词特效</span><Switch label="关键词特效" preference="effects"
            checked={preferences.effects} onCheckedChange={value => change('effects', value)} /></div>
        {themes.length > 1 && <>
            <ThemeSelect label="主题" value={preferences.globalTheme} options={themes} onChange={value => change('globalTheme', value)} />
            {character && <ThemeSelect label="当前角色主题" value={preferences.characterTheme}
                options={[{ id: '', name: '跟随全局' }, ...themes]} onChange={value => change('characterTheme', value)} />}
        </>}
    </section>;
}
