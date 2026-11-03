import type { ComponentProps } from 'react';
import { Button } from '@base-ui/react/button';

export interface ModelEvents {
    disabled?: boolean;
    onAction: (action: string, target: HTMLElement) => void;
    onEdit: (bind: string, value: string, checked?: boolean) => void;
}

export function Action({ action, events, children, ...props }: Omit<ComponentProps<typeof Button>, 'onClick'> & {
    action: string; events: ModelEvents;
}) {
    return <Button type="button" {...props} disabled={events.disabled || props.disabled} data-action={action}
        onClick={event => events.onAction(action, event.currentTarget)}>{children}</Button>;
}

// 原生输入控件已满足当前表单；统一受控值与控制器动作，不增加第二份草稿。
export function Input({ bind, events, ...props }: Omit<ComponentProps<'input'>, 'onChange'> & { bind?: string; events: ModelEvents }) {
    return <input {...props} disabled={events.disabled || props.disabled} data-bind={bind} onChange={event => {
        if (bind) events.onEdit(bind, event.currentTarget.value, event.currentTarget.checked);
    }} />;
}

export function Select({ bind, events, ...props }: Omit<ComponentProps<'select'>, 'onChange'> & { bind: string; events: ModelEvents }) {
    return <select {...props} disabled={events.disabled || props.disabled} data-bind={bind} onChange={event => events.onEdit(bind, event.currentTarget.value)} />;
}

export function FieldError({ name, errors }: { name: string; errors: Record<string, string> }) {
    return <p className={`vcms-field-err${errors[name] ? ' is-visible' : ''}`} data-err-for={name}>{errors[name] ?? ''}</p>;
}
