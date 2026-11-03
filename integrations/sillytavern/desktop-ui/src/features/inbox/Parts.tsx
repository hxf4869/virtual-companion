import { useLayoutEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes } from 'react';
import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import { Switch as SwitchPrimitive } from '@base-ui/react/switch';
import { Switch } from '../../components/Switch';
import type { InboxProps, InboxAction, ChannelDraft, InboxEvent } from './types';
export function Action({
    action,
    run,
    children,
    ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { action: string; run: InboxAction }) {
    return (
        <button type="button" {...props} data-action={action} onClick={(event) => run(action, event.currentTarget)}>
            {children}
        </button>
    );
}
export function Badge({ text, tone = '' }: { text: string; tone?: string }) {
    return (
        <span className="vc-inbox-badge" data-tone={tone || undefined}>
            {text}
        </span>
    );
}
export function Clip({ text }: { text: string }) {
    return (
        <span className="vc-clip" aria-hidden="true">
            {text}
        </span>
    );
}
export function Status({ text, tone = '', dot }: { text: string; tone?: string; dot?: string }) {
    const name =
        tone === 'ok'
            ? 'ok'
            : tone === 'danger'
              ? 'danger'
              : tone === 'warn'
                ? 'warn'
                : tone === 'quiet'
                  ? 'quiet'
                  : 'neutral';
    return (
        <span className={`vc-status vc-status-${name}`}>
            <i className={`vc-dot vc-dot-${dot || name}`} aria-hidden="true" />
            <Badge text={text} tone={tone === 'quiet' ? '' : tone} />
        </span>
    );
}
export function PolicyField({
    p,
    field,
    classic = false,
    ...props
}: InputHTMLAttributes<HTMLInputElement> & { p: InboxProps; field: string; classic?: boolean }) {
    const draft = p.state.policyDraft,
        value = draft[field as keyof typeof draft];
    const display = field === 'quietHoursTimezone' && !classic ? p.format.zone(draft.quietHoursTimezone) : value;
    return (
        <input
            {...props}
            data-field={field}
            data-zone={field === 'quietHoursTimezone' && !classic ? draft.quietHoursTimezone || '' : undefined}
            value={typeof display === 'string' || typeof display === 'number' ? display : ''}
            disabled={p.state.busy || p.state.loading}
            onChange={(event) => p.events.policy(field, event.currentTarget.value)}
        />
    );
}
export function FieldSwitch({
    p,
    action,
    label,
    on,
    classic = false,
    extra = {},
}: {
    p: InboxProps;
    action: string;
    label: string;
    on: boolean;
    classic?: boolean;
    extra?: Record<string, string>;
}) {
    const ref = useRef<HTMLButtonElement>(null),
        change = () => {
            if (ref.current) p.events.action(action, ref.current);
        };
    if (classic)
        return (
            <SwitchPrimitive.Root
                {...extra}
                ref={ref}
                nativeButton
                render={<button type="button" />}
                className="vc-inbox-switch"
                data-action={action}
                checked={on}
                aria-checked={on}
                aria-pressed={on}
                disabled={p.state.busy}
                onCheckedChange={change}
            >
                <span className="vc-inbox-switch-label">{label}</span>
                <span className="vc-inbox-switch-track" aria-hidden="true">
                    <SwitchPrimitive.Thumb className="vc-inbox-switch-knob" />
                </span>
            </SwitchPrimitive.Root>
        );
    return (
        <div className="vc-cell">
            <span className="vc-grow">{label}</span>
            <Switch
                {...extra}
                ref={ref}
                label={label}
                action={action}
                className="vc-inbox-switch vc-switch"
                thumbClassName="vc-clip"
                checked={on}
                aria-pressed={on}
                disabled={p.state.busy}
                onCheckedChange={change}
            />
        </div>
    );
}
export function Modes({ p, classic = false }: { p: InboxProps; classic?: boolean }) {
    const draft = p.state.policyDraft;
    if (!draft.supportsMode && !draft.supportsCheckIn) return null;
    const heading = <h2 className="vc-group-title">模式</h2>;
    return (
        <>
            {draft.supportsMode && (
                <>
                    {(!p.desktop || classic) && heading}
                    <RadioGroup
                        className="vc-group vc-proactive-modes"
                        aria-label="模式"
                        value={draft.mode}
                        disabled={p.state.busy}
                        onValueChange={(value) => {
                            if (typeof value === 'string') p.events.mode(value);
                        }}
                    >
                        {p.desktop && !classic && heading}
                        {p.modes.map((value) => (
                            <Radio.Root
                                key={value}
                                nativeButton
                                render={<button type="button" />}
                                value={value}
                                className="vc-cell"
                                data-action="set-proactive-mode"
                                data-mode={value}
                                aria-pressed={draft.mode === value}
                            >
                                <span className="vc-grow">{p.labels.proactive[value]}</span>
                            </Radio.Root>
                        ))}
                    </RadioGroup>
                </>
            )}
            {draft.supportsCheckIn && (
                <div className="vc-group">
                    <label className="vc-cell">
                        <span className="vc-grow">多久没聊</span>
                        <PolicyField
                            p={p}
                            classic={classic}
                            field="checkInAfterMinutes"
                            aria-label="多久没聊"
                            inputMode="numeric"
                        />
                    </label>
                </div>
            )}
        </>
    );
}
export function VoiceSlot({ p, item }: { p: InboxProps; item: InboxEvent }) {
    const ref = useRef<HTMLDivElement>(null),
        voice = p.events.voice;
    useLayoutEffect(() => {
        const node = ref.current;
        if (!node) return;
        const bubble = voice(item.eventId);
        if (bubble) node.append(bubble);
        return () => {
            node.replaceChildren();
        };
    }, [voice, item.eventId, item.body, item.voice?.clipId, item.voice?.status, item.voice?.durationMs]);
    return <div ref={ref} data-vc-inbox-voice={item.eventId} />;
}
export function SecretField({
    p,
    draft,
    ...props
}: InputHTMLAttributes<HTMLInputElement> & { p: InboxProps; draft: ChannelDraft }) {
    const ref = useRef<HTMLInputElement>(null),
        read = p.events.readSecret,
        key = draft.key;
    useLayoutEffect(() => {
        const input = ref.current;
        if (!input) return;
        input.value = read(key);
        return () => {
            input.value = '';
        };
    }, [key, read]);
    useLayoutEffect(() => {
        if (draft.credentialMode !== 'set' && ref.current) ref.current.value = '';
    }, [draft.credentialMode]);
    return (
        <input
            {...props}
            ref={ref}
            type="password"
            data-field="credential"
            aria-label="凭据"
            placeholder={p.format.credentialPlaceholder(draft)}
            autoComplete="off"
            spellCheck={false}
            disabled={p.state.busy}
            onChange={(event) => p.events.channel(key, 'credential', event.currentTarget.value)}
        />
    );
}
export function ChannelTarget({ p, draft, modern = false }: { p: InboxProps; draft: ChannelDraft; modern?: boolean }) {
    const label = draft.channel === 'FEISHU' ? '群名称' : '收件地址';
    return (
        <input
            data-field="configuredTarget"
            maxLength={320}
            autoComplete="off"
            aria-label={modern ? label : undefined}
            placeholder={modern ? '未填写' : undefined}
            value={draft.configuredTarget}
            disabled={p.state.busy}
            onChange={(event) => p.events.channel(draft.key, 'configuredTarget', event.currentTarget.value)}
        />
    );
}
