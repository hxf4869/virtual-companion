import { useRef } from 'react';
import { Button } from '@base-ui/react/button';
import { Switch } from '../../components/Switch';
import { Icon } from '../../components/Icon';
import { IconButton } from '../../components/IconButton';

export interface TavernField {
    key: string; label: string; value: string | number | boolean | null | readonly string[];
    kind?: 'text' | 'number' | 'textarea' | 'code' | 'json' | 'boolean' | 'select' | 'list' | 'multiselect';
    options?: readonly { value: string | number; label: string }[];
    min?: number; max?: number; step?: number | 'any'; required?: boolean; disabled?: boolean; error?: string;
}
export interface TavernAction { id: string; label: string; icon?: string; accept?: string; disabled?: boolean }
export interface TavernEditorProps {
    sprite: string; loading: boolean; busy: boolean; error?: string; conflict?: boolean;
    resources: readonly { key: string; label: string; value: string; options: readonly { value: string; label: string }[] }[];
    actions: readonly TavernAction[];
    items?: readonly { id: string; name: string; selected?: boolean; disabled?: boolean }[];
    groups: readonly { id: string; title: string; fields: readonly TavernField[]; actions?: readonly TavernAction[] }[];
    order?: readonly { id: string; name: string; enabled: boolean }[];
    gallery?: readonly { id: string; name: string; src: string; selected: boolean }[];
    onField(key: string, value: string | boolean | string[]): void;
    onAction(action: string, value?: string | File): void;
}

function Action({ action, p }: { action: TavernAction; p: TavernEditorProps }) {
    const input = useRef<HTMLInputElement>(null);
    return <><Button type="button" className="vc-btn vc-btn-gray" data-tavern-action={action.id}
        disabled={p.busy || action.disabled} onClick={() => action.accept ? input.current?.click() : p.onAction(action.id)}>
        {action.icon && <Icon sprite={p.sprite} name={action.icon} size={16} />}{action.label}</Button>
        {action.accept && <input ref={input} type="file" accept={action.accept} hidden data-tavern-upload={action.id}
            onChange={event => { const file = event.currentTarget.files?.[0]; if (file) p.onAction(action.id, file); event.currentTarget.value = ''; }} />}</>;
}
function Field({ field: f, p }: { field: TavernField; p: TavernEditorProps }) {
    const disabled = p.busy || f.disabled, id = `vc-tavern-${f.key}`;
    const value = typeof f.value === 'boolean' || Array.isArray(f.value) ? '' : String(f.value ?? '');
    const edit = (value: string | boolean | string[]) => p.onField(f.key, value);
    const options = f.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>);
    let control;
    if (!f.kind && f.disabled) control = <output id={id} data-tavern-field={f.key}>{value}</output>;
    else if (f.kind === 'boolean') control = <Switch label={f.label} checked={f.value === true} disabled={disabled} data-tavern-field={f.key} onCheckedChange={edit} />;
    else if (f.kind === 'select' || f.kind === 'multiselect') control = <select id={id} data-tavern-field={f.key} disabled={disabled} required={f.required}
        multiple={f.kind === 'multiselect'} value={f.kind === 'multiselect' ? f.value as string[] : value}
        onChange={event => edit(f.kind === 'multiselect' ? [...event.currentTarget.selectedOptions].map(option => option.value) : event.currentTarget.value)}>{options}</select>;
    else if (f.kind === 'list') {
        const values = Array.isArray(f.value) ? f.value : [];
        control = <div className="vc-tavern-values" data-tavern-field={f.key}>{values.map((value, index) => <div key={index}>
            <input aria-label={`${f.label} ${index + 1}`} value={value} disabled={disabled} onChange={event => edit(values.map((old, i) => i === index ? event.currentTarget.value : old))} />
            <IconButton sprite={p.sprite} icon="trash-2" label={`删除${f.label} ${index + 1}`} disabled={disabled} onClick={() => edit(values.filter((_, i) => i !== index))} />
        </div>)}<Button type="button" className="vc-btn vc-btn-text" disabled={disabled} onClick={() => edit([...values, ''])}>添加</Button></div>;
    } else if (['textarea','code','json'].includes(f.kind || '')) control = <textarea id={id} className={f.kind === 'textarea' ? undefined : 'vc-tavern-code'}
        data-tavern-field={f.key} value={value} disabled={disabled} required={f.required} spellCheck={f.kind === 'textarea'} onChange={event => edit(event.currentTarget.value)} />;
    else control = <input id={id} type="text" inputMode={f.kind === 'number' ? 'decimal' : undefined} data-tavern-field={f.key} value={value} min={f.min} max={f.max} step={f.step}
        disabled={disabled} required={f.required} onChange={event => edit(event.currentTarget.value)} />;
    return <div className={`vc-desk-field${['textarea','code','json','list'].includes(f.kind || '') ? ' vc-tavern-wide' : ''}`}>
        <label htmlFor={f.kind === 'boolean' || f.kind === 'list' ? undefined : id}>{f.label}</label>{control}
        {f.error && <p role="alert">{f.error}</p>}
    </div>;
}

export function TavernEditor(p: TavernEditorProps) {
    if (p.loading) return <p role="status">正在加载…</p>;
    return <form className="vc-tavern-form" data-tavern-editor="" aria-busy={p.busy} onSubmit={event => { event.preventDefault(); p.onAction('save'); }}>
        {p.error && <div className="vc-tavern-error" role="status"><p>{p.error}</p><Button type="button" className="vc-btn vc-btn-text" disabled={p.busy}
            data-tavern-action="reload" onClick={() => p.onAction('reload')}>{p.conflict ? '加载最新' : '重新加载'}</Button></div>}
        <div className="vc-tavern-toolbar">{p.resources.map(resource => <select key={resource.key} aria-label={resource.label} data-tavern-resource={resource.key}
            value={resource.value} disabled={p.busy} onChange={event => p.onAction(`select-${resource.key}`, event.currentTarget.value)}>
            {resource.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>)}{p.actions.map(action => <Action key={action.id} action={action} p={p} />)}</div>
        {p.gallery && <div className="vc-tavern-gallery">{p.gallery.map(image => <Button type="button" key={image.id} disabled={p.busy}
            data-tavern-image={image.id} aria-pressed={image.selected} onClick={() => p.onAction('select-image', image.id)}>
            <img src={image.src} alt="" loading="lazy" /><span>{image.name}</span>
        </Button>)}</div>}
        <div className={p.items ? 'vc-tavern-columns' : undefined}>
            {p.items && <nav className="vc-tavern-list" aria-label="条目">{p.items.map(item => <Button type="button" key={item.id} disabled={p.busy}
                data-tavern-item={item.id} aria-current={item.selected ? 'true' : undefined} onClick={() => p.onAction('select-item', item.id)}>{item.name}</Button>)}</nav>}
            <div className="vc-tavern-details">
                {p.order && <section className="vc-desk-group"><h2>提示词顺序</h2><div className="vc-tavern-order">{p.order.map((row, index) => <div key={row.id} data-prompt-order={row.id}>
                    <Switch label={row.name} checked={row.enabled} disabled={p.busy} onCheckedChange={enabled => p.onField(`order:${row.id}`, enabled)} />
                    <Button type="button" className="vc-btn vc-btn-text" onClick={() => p.onAction('select-item', row.id)}>{row.name}</Button>
                    <Button type="button" className="vc-btn vc-btn-text" aria-label={`上移${row.name}`} disabled={p.busy || index === 0} onClick={() => p.onAction('prompt-up', row.id)}>上移</Button>
                    <Button type="button" className="vc-btn vc-btn-text" aria-label={`下移${row.name}`} disabled={p.busy || index === p.order!.length - 1} onClick={() => p.onAction('prompt-down', row.id)}>下移</Button>
                </div>)}</div></section>}
                {p.groups.map(group => <section className="vc-desk-group" key={group.id} data-tavern-group={group.id}><h2>{group.title}</h2>
                    {group.fields.map(field => <Field key={field.key} field={field} p={p} />)}
                    {group.actions && <div className="vc-tavern-toolbar">{group.actions.map(action => <Action key={action.id} action={action} p={p} />)}</div>}
                </section>)}
            </div>
        </div>
    </form>;
}
