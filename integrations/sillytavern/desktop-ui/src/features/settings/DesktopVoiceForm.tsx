import { useRef, type CSSProperties } from 'react';
import { Button } from '../../design/components/Button';
import { Field } from '../../design/components/Field';
import { Icon } from '../../design/components/Icon';
import { Select, type SelectOption } from '../../design/components/Select';
import { Switch } from '../../design/components/Switch';
import { TextInput } from '../../design/components/TextInput';
import { Textarea } from '../../design/components/Textarea';
import type { VoiceFormProps } from './VoiceForm';

const scenes: Record<string, string> = {
  morning: '早安',
  night: '晚安',
  care: '关心',
  share: '分享',
  default: '其他',
};

const moods = [
  '开心',
  '黏人',
  '好奇',
  '得意',
  '懒洋洋',
  '有点累',
  '想独处',
  '有点烦',
  '困',
];

const globalFrequencyOptions: readonly SelectOption<string>[] = [
  { value: 'LOW', label: '少' },
  { value: 'STANDARD', label: '标准' },
  { value: 'HIGH', label: '多' },
];

const relationshipFrequencyOptions: readonly SelectOption<string>[] = [
  { value: '', label: '跟随全局' },
  { value: 'OFF', label: '关' },
  { value: 'LOW', label: '少' },
  { value: 'STANDARD', label: '标准' },
  { value: 'HIGH', label: '多' },
];

const proactiveEngineOptions: readonly SelectOption<string>[] = [
  { value: '', label: '默认' },
  { value: 'kokoro', label: 'Kokoro' },
  { value: 'cosyvoice', label: 'CosyVoice' },
];

interface EngineInfo {
  engine?: string;
  configured?: boolean;
  enabled?: boolean;
  healthy?: boolean;
  voices?: readonly { id: string; name?: string; gender?: string }[];
}

const engineState = (engine?: EngineInfo) =>
  !engine?.configured ? '未配置' : engine.healthy ? '可用' : '不可用';

export function DesktopVoiceForm(p: VoiceFormProps) {
  const text = (key: string) => String(p.values[key] ?? '');

  const numberInput = (
    key: string,
    label: string,
    min: number,
    max: number,
    step = 1,
  ) => (
    <TextInput
      type="number"
      aria-label={label}
      data-voice-field={key}
      value={text(key)}
      min={min}
      max={max}
      step={step}
      required
      disabled={p.disabled}
      onValueChange={(value) => p.onFieldChange(key, value)}
    />
  );

  const selectControl = (
    key: string,
    label: string,
    options: readonly SelectOption<string>[],
  ) => (
    <div className="vc-voice-select-wrap" data-voice-select={key}>
      <Select
        aria-label={label}
        value={text(key)}
        options={options}
        disabled={p.disabled}
        onValueChange={(value) => p.onFieldChange(key, value)}
      />
    </div>
  );

  const toggle = (key: string, label: string, disabled = false) => (
    <Switch
      aria-label={label}
      checked={p.values[key] === true}
      disabled={p.disabled || disabled}
      onCheckedChange={(value) => p.onFieldChange(key, value)}
      {...({ 'data-voice-field': key } as Record<string, string>)}
    />
  );

  if (p.mode === 'global') {
    const engineGroup = (
      title: string,
      key: string,
      info: EngineInfo | undefined,
      timeout: string,
      limit: string,
    ) => {
      const limitLabel =
        limit === 'maxRecordingSeconds' ? '最长录音（秒）' : '每日上限';
      return (
        <div className="vc-group vc-desk-group" key={key}>
          <Field label={title} disabled={p.disabled} className="vc-desk-field">
            <div className="vc-voice-engine-control">
              <span className="vc-value">{engineState(info)}</span>
              {toggle(key, title, !info?.configured)}
            </div>
          </Field>
          <Field label="超时（秒）" disabled={p.disabled} className="vc-desk-field">
            {numberInput(
              timeout,
              `${title}超时（秒）`,
              1,
              timeout === 'asrTimeoutSeconds' ? 120 : 3600,
            )}
          </Field>
          <Field label={limitLabel} disabled={p.disabled} className="vc-desk-field">
            {numberInput(
              limit,
              limitLabel,
              limit === 'maxRecordingSeconds' ? 1 : 0,
              limit === 'maxRecordingSeconds' ? 60 : 2147483647,
            )}
          </Field>
        </div>
      );
    };

    return (
      <>
        {engineGroup(
          '聊天语音',
          'kokoroEnabled',
          p.engines.tts.find((e) => e.engine === 'kokoro'),
          'kokoroTimeoutSeconds',
          'dailyChatLimit',
        )}
        {engineGroup(
          '主动语音',
          'cosyVoiceEnabled',
          p.engines.tts.find((e) => e.engine === 'cosyvoice'),
          'cosyVoiceTimeoutSeconds',
          'dailyProactiveLimit',
        )}
        {engineGroup(
          '语音输入',
          'asrEnabled',
          p.engines.asr,
          'asrTimeoutSeconds',
          'maxRecordingSeconds',
        )}

        <div className="vc-group vc-desk-group">
          <Field label="语音频率" disabled={p.disabled} className="vc-desk-field">
            {selectControl('voiceFrequency', '语音频率', globalFrequencyOptions)}
          </Field>
        </div>

        <details className="vc-group vc-desk-group vc-voice-details">
          <summary className="vc-voice-summary">
            <span>场景指令</span>
            <Icon name="chevron-down" size={16} className="vc-voice-chevron" />
          </summary>
          <div className="vc-voice-details-body">
            {Object.entries(scenes).map(([id, label]) => (
              <Field
                key={id}
                label={label}
                disabled={p.disabled}
                className="vc-desk-field vc-voice-setting-text"
              >
                <Textarea
                  aria-label={label}
                  data-voice-instruction={id}
                  data-voice-field={`instruction:${id}`}
                  value={text(`instruction:${id}`)}
                  maxLength={1000}
                  required
                  disabled={p.disabled}
                  onValueChange={(value) =>
                    p.onFieldChange(`instruction:${id}`, value)
                  }
                />
              </Field>
            ))}
          </div>
        </details>

        <details className="vc-group vc-desk-group vc-voice-details">
          <summary className="vc-voice-summary">
            <span>发送比例</span>
            <Icon name="chevron-down" size={16} className="vc-voice-chevron" />
          </summary>
          <div className="vc-voice-details-body">
            {Object.entries(scenes).map(([id, label]) => (
              <Field
                key={id}
                label={`${label}（%）`}
                disabled={p.disabled}
                className="vc-desk-field"
              >
                {numberInput(`rate:${id}`, `${label}（%）`, 0, 100)}
              </Field>
            ))}
          </div>
        </details>

        <details className="vc-group vc-desk-group vc-voice-details">
          <summary className="vc-voice-summary">
            <span>心情语速</span>
            <Icon name="chevron-down" size={16} className="vc-voice-chevron" />
          </summary>
          <div className="vc-voice-details-body">
            {moods.map((mood) => (
              <Field
                key={mood}
                label={mood}
                disabled={p.disabled}
                className="vc-desk-field"
              >
                {numberInput(`mood:${mood}`, mood, 0.5, 2, 0.01)}
              </Field>
            ))}
          </div>
        </details>
      </>
    );
  }

  return (
    <>
      {(['kokoro', 'cosyvoice'] as const).map((id) => {
        const engine = p.engines.tts.find((row) => row.engine === id);
        if (!engine?.configured) return null;
        const key = id === 'kokoro' ? 'kokoroVoice' : 'cosyVoice';
        const label = id === 'kokoro' ? '聊天语音' : '主动语音音色';
        return (
          <div className="vc-group vc-desk-group" key={id}>
            <Field label={label} disabled={p.disabled} className="vc-desk-field">
              <select
                className="vc-select vc-voice-native-select"
                data-voice-field={key}
                aria-label={label}
                value={text(key)}
                disabled={p.disabled}
                onChange={(event) =>
                  p.onFieldChange(key, event.currentTarget.value)
                }
              >
                <option value="">默认</option>
                {(['FEMALE', 'MALE', 'NEUTRAL'] as const).map((gender) => (
                  <optgroup
                    key={gender}
                    label={{ FEMALE: '女生', MALE: '男生', NEUTRAL: '其他' }[gender]}
                  >
                    {(engine.voices ?? [])
                      .filter((voice) => (voice.gender || 'NEUTRAL') === gender)
                      .map((voice) => (
                        <option key={voice.id} value={voice.id}>
                          {voice.name || voice.id}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
            </Field>
            <div className="vc-cell">
              <span className="vc-grow">{engineState(engine)}</span>
              <Preview
                engine={id}
                disabled={Boolean(p.disabled || !engine.enabled || !engine.healthy)}
                state={p.preview[id]}
                onPreview={p.onPreview}
              />
            </div>
          </div>
        );
      })}
      <div className="vc-group vc-desk-group">
        <Field label="语速" disabled={p.disabled} className="vc-desk-field">
          <div className="vc-voice-speed-control">
            <input
              type="range"
              aria-label="语速"
              data-voice-field="speed"
              min="0.5"
              max="2"
              step="0.05"
              value={text('speed')}
              disabled={p.disabled}
              onChange={(event) =>
                p.onFieldChange('speed', event.currentTarget.value)
              }
            />
            <output>{`${Number(p.values.speed).toFixed(2)}×`}</output>
          </div>
        </Field>
        <Field label="语音频率" disabled={p.disabled} className="vc-desk-field">
          {selectControl(
            'voiceFrequency',
            '语音频率',
            relationshipFrequencyOptions,
          )}
        </Field>
        <Field label="主动语音引擎" disabled={p.disabled} className="vc-desk-field">
          {selectControl(
            'proactiveEngine',
            '主动语音引擎',
            proactiveEngineOptions,
          )}
        </Field>
        <Field label="主动发送语音" disabled={p.disabled} className="vc-desk-field">
          {toggle('proactiveVoice', '主动发送语音')}
        </Field>
      </div>
    </>
  );
}

function Preview({
  engine,
  disabled,
  state,
  onPreview,
}: {
  engine: string;
  disabled: boolean;
  state?: { busy?: boolean; playing?: boolean };
  onPreview: (engine: string) => void;
}) {
  const width = useRef<number | undefined>(undefined);
  const style: CSSProperties | undefined =
    width.current === undefined
      ? undefined
      : {
          whiteSpace: 'nowrap',
          justifyContent: 'flex-end',
          width: width.current,
          minWidth: width.current,
        };
  return (
    <Button
      type="button"
      variant="text"
      className="vc-btn-text"
      data-preview-engine={engine}
      style={style}
      disabled={disabled || Boolean(state?.busy)}
      onClick={(event) => {
        width.current = event.currentTarget.getBoundingClientRect().width;
        onPreview(engine);
      }}
    >
      {state?.busy ? '正在生成语音…' : state?.playing ? '暂停语音' : '试听'}
    </Button>
  );
}
