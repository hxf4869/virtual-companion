import { Fragment } from 'react';
import { Action } from './fields';

export interface BindingRow {
    id: string;
    label: string;
    description: string;
    bindable: boolean;
    current: string;
    enabled: boolean;
    dirty: boolean;
    status: string;
    statusLabel: string;
    statusClass: string;
    revision?: number;
    updated: string;
    error?: string;
}

export interface BindingsProps {
    desktop: boolean;
    rows: readonly BindingRow[];
    options: readonly { value: string; label: string }[];
    dirtyCount: number;
    saving: boolean;
    disabled?: boolean;
    contextChanged?: string;
    conflict?: { purpose: string; label: string; latest: boolean; revision?: number; mine: string; target: string };
    onAction: (action: string, target: HTMLElement) => void;
    onEdit: (bind: string, value: string, checked?: boolean) => void;
}

export function Bindings({ desktop, rows, options, dirtyCount, saving, disabled, contextChanged, conflict, onAction, onEdit }: BindingsProps) {
    const events = { onAction, onEdit, disabled: saving || disabled };
    return <>
        {conflict && <div className="vcms-callout vcms-callout-warn" role="alert">
            <i className="fa-solid fa-code-merge" />
            <div>
                {!conflict.latest ? <>
                    <p>「{conflict.label}」的绑定已在另一处更新。你的选择已保留，未被覆盖。</p>
                    <div className="vcms-callout-actions">
                        <Action action="bindings-view-latest" events={events} className="vcms-btn vcms-btn-primary vcms-btn-sm">查看最新</Action>
                        <Action action="bindings-keep" events={events} className="vcms-btn vcms-btn-ghost vcms-btn-sm">暂不处理</Action>
                    </div>
                </> : <>
                    <p>「{conflict.label}」的绑定已在另一处更新（最新配置版本 v{conflict.revision ?? '—'}）。请对比后选择：</p>
                    <div className="vcms-conflict-compare">
                        <div><span className="vcms-muted">最新内容</span><br />{conflict.target}</div>
                        <div><span className="vcms-muted">我的选择（未保存）</span><br />{conflict.mine}</div>
                    </div>
                    <div className="vcms-callout-actions">
                        <Action action="bindings-adopt-latest" data-purpose={conflict.purpose} events={events} className="vcms-btn vcms-btn-ghost vcms-btn-sm">采用最新，放弃我的修改</Action>
                        <Action action="bindings-retry-latest" data-purpose={conflict.purpose} events={events} className="vcms-btn vcms-btn-primary vcms-btn-sm">基于最新重试我的选择</Action>
                        <Action action="bindings-keep" events={events} className="vcms-btn vcms-btn-ghost vcms-btn-sm">暂不处理</Action>
                    </div>
                </>}
            </div>
        </div>}
        {contextChanged && <div className="vcms-callout vcms-callout-warn vcms-conflict" role="alert">
            <i className="fa-solid fa-user-shield" />
            <div><p>{contextChanged}</p><div className="vcms-callout-actions">
                <Action action="context-reload" events={events} className="vcms-btn vcms-btn-primary vcms-btn-sm">重新加载页面数据</Action>
                <Action action="context-keep" events={events} className="vcms-btn vcms-btn-ghost vcms-btn-sm">保留草稿，暂不重载</Action>
            </div></div>
        </div>}
        <div className={desktop ? 'vcms-desktop-section' : 'vcms-section'}>
            <h3 className="vcms-section-title">用途绑定</h3>
            {!desktop && <p className="vcms-muted vcms-section-note">每个用途独立绑定自己的模型配置；可以共用同一配置，但切换某一用途不影响其他用途。待配置的用途不会自动回退到其他 Key 或模型。</p>}
            <div className="vcms-table-wrap">
                <table className="vcms-bindings-table">
                    <thead><tr><th>用途</th><th>模型配置</th><th>状态</th><th>生效版本</th><th>更新时间</th></tr></thead>
                    <tbody>{rows.map(row => <Fragment key={row.id}>
                        <tr className={`vcms-binding-row ${row.dirty ? 'is-dirty' : ''} ${!row.bindable ? 'is-embed' : ''}`}>
                            <td className="vcms-binding-purpose">
                                <span className="vcms-binding-name">{row.label}</span>
                                {!desktop && <span className="vcms-muted vcms-binding-desc">{row.description}</span>}
                            </td>
                            <td className="vcms-binding-select">{row.bindable ? <>
                                <select data-bind={`binding.${row.id}`} aria-label={`${row.label}绑定的模型配置`} value={row.current} disabled={events.disabled}
                                    onChange={event => onEdit(`binding.${row.id}`, event.currentTarget.value)}>
                                    {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                </select>
                                <label className="vcms-check vcms-binding-enabled"><input type="checkbox" data-bind={`bindingState.${row.id}`}
                                    checked={row.enabled} disabled={events.disabled || !row.current}
                                    onChange={event => onEdit(`bindingState.${row.id}`, event.currentTarget.value, event.currentTarget.checked)} />启用</label>
                            </> : !desktop && <><span className="vcms-badge vcms-badge-warn">待配置</span><span className="vcms-muted vcms-binding-embednote">Embedding 使用独立接口；本轮不可绑定，三种聊天协议不能用作 embedding。</span></>}</td>
                            <td className="vcms-binding-status">{desktop ? <span className="vc-status"><i className={`vc-dot vc-dot-${row.status === 'READY' ? 'ok' : 'warn'}`} />{row.statusLabel}</span> : <span className={`vcms-badge ${row.statusClass}`}>{row.statusLabel}</span>}</td>
                            <td className="vcms-binding-revision vcms-mono">v {row.revision ?? '—'}{row.dirty ? ' *' : ''}</td>
                            <td className="vcms-binding-updated vcms-muted">{row.updated}</td>
                        </tr>
                        {row.error && <tr className="vcms-binding-errorrow"><td colSpan={5}><p className="vcms-field-err is-visible">{row.error}</p></td></tr>}
                    </Fragment>)}</tbody>
                </table>
            </div>
            {dirtyCount > 0 && <div className="vcms-bindings-save">
                <span className="vcms-muted">{dirtyCount} 个用途待保存</span>
                <Action action="save-bindings" events={events} className="vcms-btn vcms-btn-primary" disabled={saving}>{saving ? '保存中…' : '保存用途绑定'}</Action>
                <Action action="discard-bindings" events={events} className="vcms-btn vcms-btn-ghost">放弃修改</Action>
            </div>}
        </div>
    </>;
}
