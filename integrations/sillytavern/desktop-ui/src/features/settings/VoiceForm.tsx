import { useRef, type CSSProperties, type ReactNode } from 'react';
import { Button } from '@base-ui/react/button';
import { Switch } from '../../components/Switch';

export type VoiceValues = Record<string, string | boolean>;
interface Engine { engine?: string; configured?: boolean; enabled?: boolean; healthy?: boolean; voices?: readonly { id: string; name?: string; gender?: string }[] }
interface VoiceFieldsProps {
    values: VoiceValues; engines: { tts: readonly Engine[]; asr: Engine };
    disabled: boolean;
    onFieldChange: (key: string, value: string | boolean) => void;
}
export type VoiceFormProps = VoiceFieldsProps & ({ mode: 'global' } | {
    mode: 'relationship'; preview: Record<string, { busy?: boolean; playing?: boolean }>;
    onPreview: (engine: string) => void;
});

const scenes = { morning: '早安', night: '晚安', care: '关心', share: '分享', default: '其他' };
const frequencies = { OFF: '关', LOW: '少', STANDARD: '标准', HIGH: '多' };
const moods = ['开心', '黏人', '好奇', '得意', '懒洋洋', '有点累', '想独处', '有点烦', '困'];
const globalFields = ['kokoroEnabled', 'cosyVoiceEnabled', 'asrEnabled', 'kokoroTimeoutSeconds', 'cosyVoiceTimeoutSeconds', 'asrTimeoutSeconds', 'dailyChatLimit', 'dailyProactiveLimit', 'maxRecordingSeconds', 'voiceFrequency'];
const relationshipFields = ['kokoroVoice', 'cosyVoice', 'speed', 'voiceFrequency', 'proactiveEngine', 'proactiveVoice'];

// 只保存当前表单的原始输入值，数字清空时保留空串；API 载荷仍由原模块读取/转换。
export function voiceFormValues(settings: Record<string, unknown>, relationship?: Record<string, unknown>): VoiceValues {
    const source = relationship ?? settings;
    const result: VoiceValues = {};
    for (const key of relationship ? relationshipFields : globalFields) result[key] = typeof source[key] === 'boolean' ? source[key] : String(source[key] ?? '');
    if (!relationship) {
        const instructions = settings.cosyVoiceInstructions as Record<string, string>;
        const rates = settings.proactiveVoiceRates as Record<string, number>;
        const speeds = settings.kokoroMoodSpeeds as Record<string, number>;
        for (const key of Object.keys(scenes)) {
            result[`instruction:${key}`] = instructions[key];
            result[`rate:${key}`] = String(Math.round(rates[key] * 100));
        }
        for (const mood of moods) result[`mood:${mood}`] = String(speeds[mood] ?? 1);
    }
    return result;
}

function Group({ children }: { children: ReactNode }) { return <div className="vc-group">{children}</div>; }
function Row({ label, children }: { label: string; children: ReactNode }) { return <label className="vc-cell"><span className="vc-grow">{label}</span>{children}</label>; }
const engineState = (engine?: Engine) => !engine?.configured ? '未配置' : engine.healthy ? '可用' : '不可用';

export function VoiceForm(p: VoiceFormProps) {
    const text = (key: string) => String(p.values[key] ?? '');
    const number = (key: string, min: number, max: number, step = 1) => <input type="number" data-voice-field={key} value={text(key)} min={min} max={max} step={step} required disabled={p.disabled} onChange={event => p.onFieldChange(key, event.currentTarget.value)} />;
    const select = (key: string, options: Record<string, string>) => <select data-voice-field={key} value={text(key)} disabled={p.disabled} onChange={event => p.onFieldChange(key, event.currentTarget.value)}>{Object.entries(options).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>;
    const toggle = (key: string, label: string, disabled = false) => <Switch label={label} data-voice-field={key} checked={p.values[key] === true} disabled={p.disabled || disabled} onCheckedChange={value => p.onFieldChange(key, value)} />;
    if (p.mode === 'global') {
        const engine = (title: string, key: string, info: Engine | undefined, timeout: string, limit: string) => <Group>
            <div className="vc-cell"><span className="vc-grow">{title}</span><span className="vc-value">{engineState(info)}</span>{toggle(key, title, !info?.configured)}</div>
            <Row label="超时（秒）">{number(timeout, 1, timeout === 'asrTimeoutSeconds' ? 120 : 3600)}</Row>
            <Row label={limit === 'maxRecordingSeconds' ? '最长录音（秒）' : '每日上限'}>{number(limit, limit === 'maxRecordingSeconds' ? 1 : 0, limit === 'maxRecordingSeconds' ? 60 : 2147483647)}</Row>
        </Group>;
        return <>
            {engine('聊天语音', 'kokoroEnabled', p.engines.tts.find(e => e.engine === 'kokoro'), 'kokoroTimeoutSeconds', 'dailyChatLimit')}
            {engine('主动语音', 'cosyVoiceEnabled', p.engines.tts.find(e => e.engine === 'cosyvoice'), 'cosyVoiceTimeoutSeconds', 'dailyProactiveLimit')}
            {engine('语音输入', 'asrEnabled', p.engines.asr, 'asrTimeoutSeconds', 'maxRecordingSeconds')}
            <Group><Row label="语音频率">{select('voiceFrequency', { LOW: '少', STANDARD: '标准', HIGH: '多' })}</Row></Group>
            <details><summary>场景指令</summary><Group>{Object.entries(scenes).map(([id, label]) => <label className="vc-cell vc-voice-setting-text" key={id}><span>{label}</span><textarea data-voice-instruction={id} value={text(`instruction:${id}`)} maxLength={1000} required disabled={p.disabled} onChange={event => p.onFieldChange(`instruction:${id}`, event.currentTarget.value)} /></label>)}</Group></details>
            <details><summary>发送比例</summary><Group>{Object.entries(scenes).map(([id, label]) => <Row key={id} label={`${label}（%）`}>{number(`rate:${id}`, 0, 100)}</Row>)}</Group></details>
            <details><summary>心情语速</summary><Group>{moods.map(mood => <Row key={mood} label={mood}>{number(`mood:${mood}`, .5, 2, .01)}</Row>)}</Group></details>
        </>;
    }
    return <>
        {(['kokoro', 'cosyvoice'] as const).map(id => {
            const engine = p.engines.tts.find(row => row.engine === id);
            if (!engine?.configured) return null;
            const key = id === 'kokoro' ? 'kokoroVoice' : 'cosyVoice', label = id === 'kokoro' ? '聊天语音' : '主动语音音色';
            return <Group key={id}>
                <Row label={label}><select data-voice-field={key} aria-label={label} value={text(key)} disabled={p.disabled} onChange={event => p.onFieldChange(key, event.currentTarget.value)}>
                    <option value="">默认</option>{['FEMALE', 'MALE', 'NEUTRAL'].map(gender => <optgroup key={gender} label={{ FEMALE: '女生', MALE: '男生', NEUTRAL: '其他' }[gender]}>
                        {(engine.voices ?? []).filter(voice => (voice.gender || 'NEUTRAL') === gender).map(voice => <option key={voice.id} value={voice.id}>{voice.name || voice.id}</option>)}
                    </optgroup>)}
                </select></Row>
                <div className="vc-cell"><span className="vc-grow">{engineState(engine)}</span><Preview engine={id} disabled={p.disabled || !engine.enabled || !engine.healthy} state={p.preview[id]} onPreview={p.onPreview} /></div>
            </Group>;
        })}
        <Group>
            <Row label="语速"><input type="range" data-voice-field="speed" min="0.5" max="2" step="0.05" value={text('speed')} disabled={p.disabled} onChange={event => p.onFieldChange('speed', event.currentTarget.value)} /><output>{`${Number(p.values.speed).toFixed(2)}×`}</output></Row>
            <Row label="语音频率">{select('voiceFrequency', { '': '跟随全局', ...frequencies })}</Row>
            <Row label="主动语音引擎">{select('proactiveEngine', { '': '默认', kokoro: 'Kokoro', cosyvoice: 'CosyVoice' })}</Row>
            <div className="vc-cell"><span className="vc-grow">主动发送语音</span>{toggle('proactiveVoice', '主动发送语音')}</div>
        </Group>
    </>;
}

function Preview({ engine, disabled, state, onPreview }: { engine: string; disabled: boolean; state?: { busy?: boolean; playing?: boolean }; onPreview: (engine: string) => void }) {
    const width = useRef<number | undefined>(undefined);
    const style: CSSProperties | undefined = width.current === undefined ? undefined : { whiteSpace: 'nowrap', justifyContent: 'flex-end', width: width.current, minWidth: width.current };
    return <Button type="button" className="vc-btn vc-btn-text" data-preview-engine={engine} style={style} disabled={disabled || state?.busy}
        onClick={event => { width.current = event.currentTarget.getBoundingClientRect().width; onPreview(engine); }}>{state?.busy ? '正在生成语音…' : state?.playing ? '暂停语音' : '试听'}</Button>;
}
