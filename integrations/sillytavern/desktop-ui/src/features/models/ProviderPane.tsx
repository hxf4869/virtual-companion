import { Button } from '@base-ui/react/button';
import { Icon } from '../../components/Icon';
import { Switch } from '../../components/Switch';
import { Action, Input, FieldError, type ModelEvents } from './fields';
import { ModelForm, type ModelFormProps } from './ModelForm';

interface ProviderDraft {
    providerId: string; displayName: string; baseUrl: string; protocol: string; state: string; credential: string;
    revision: number; endpointUrl?: string; credentialConfigured: boolean;
}

export interface ProviderPaneProps {
    desktop: boolean; vc: boolean; sprite: string; screen: string; creatingNew: boolean;
    draft: ProviderDraft | null; updated: string; stateLabel: string; errors: Record<string, string>;
    protocols: readonly { id: string; label: string; endpoint: string }[];
    endpoint: { blank: boolean; ok?: boolean; finalUrl?: string; hint?: string; kind?: string; error?: string; suggestedBaseUrl?: string };
    keyPlan: { action: string; finalKey: string }; keyEditing: boolean; keyClearing: boolean; keyLabels: Record<string, string>;
    conflict?: { message: string; currentRevision: number | null }; stashBanner: boolean; contextChanged?: string;
    discoverBusy: boolean; discoverError?: string; budgetInsufficient: boolean; budgetCopy: string;
    models: readonly { key: number; index: number; profileKey: string; selected: boolean; name: string; id: string; incomplete: boolean; bound: number; error?: string }[];
    model?: ModelFormProps & { identity: number };
    check: { busy: boolean; error: string | null; result: { total: number; unrecorded: readonly { modelId: string; displayName: string }[] } | null };
    testTarget: string; testUrl: string; saveError?: string;
    events: ModelEvents;
}

export function ProviderPane(p: ProviderPaneProps) {
    const { desktop, vc, sprite, draft: d, events } = p;
    if (!d) return <div className="vcms-stateblock"><p>请选择或新建一个供应商。</p></div>;
    const field = desktop ? 'vc-desk-field' : 'vcms-field';
    const section = desktop ? 'vcms-desktop-section' : 'vcms-section';
    const err = (name: string) => <FieldError name={name} errors={p.errors} />;
    const providerIdField = <div className={field}>
        <label htmlFor="vcms-f-id">供应商 ID</label>
        <Input events={events} id="vcms-f-id" type="text" className={p.creatingNew ? undefined : 'vcms-mono'}
            bind={p.creatingNew ? 'provider.providerId' : undefined} value={d.providerId} readOnly={!p.creatingNew} aria-readonly={!p.creatingNew || undefined}
            placeholder={p.creatingNew ? '小写字母 / 数字 / - / _' : undefined} autoComplete={p.creatingNew ? 'off' : undefined} spellCheck={p.creatingNew ? false : undefined} />
        {err('providerId')}
    </div>;
    return <>
        {p.conflict && <div className="vcms-callout vcms-callout-warn vcms-conflict" role="alert"><i className="fa-solid fa-code-merge" /><div>
            <p>{p.conflict.message}{p.conflict.currentRevision !== null ? `（最新配置版本 v${p.conflict.currentRevision}）` : ''}</p>
            <div className="vcms-callout-actions"><Action action="conflict-view-latest" events={events} className="vcms-btn vcms-btn-primary vcms-btn-sm">查看最新</Action><Action action="conflict-keep" events={events} className="vcms-btn vcms-btn-ghost vcms-btn-sm">保留草稿</Action></div>
        </div></div>}
        {p.stashBanner && <div className="vcms-callout vcms-callout-info" role="status"><i className="fa-solid fa-circle-info" /><div>
            <p>已加载最新内容（配置版本 v{d.revision ?? '—'}），未保存的输入已暂存。</p>
            <div className="vcms-callout-actions"><Action action="restore-stash" events={events} className="vcms-btn vcms-btn-primary-outline vcms-btn-sm">恢复未保存的草稿</Action><Action action="dismiss-stash-banner" events={events} className="vcms-btn vcms-btn-ghost vcms-btn-sm">保留最新内容</Action></div>
        </div></div>}
        {p.contextChanged && <div className="vcms-callout vcms-callout-warn vcms-conflict" role="alert"><i className="fa-solid fa-user-shield" /><div>
            <p>{p.contextChanged}</p><div className="vcms-callout-actions"><Action action="context-reload" events={events} className="vcms-btn vcms-btn-primary vcms-btn-sm">重新加载页面数据</Action><Action action="context-keep" events={events} className="vcms-btn vcms-btn-ghost vcms-btn-sm">保留草稿，暂不重载</Action></div>
        </div></div>}
        <div className="vcms-form">
            {!d.credentialConfigured && p.keyPlan.finalKey === 'none' && <div className="vcms-callout vcms-callout-warn" role="alert"><i className="fa-solid fa-triangle-exclamation" /><div>该供应商尚未配置 API Key。可以先保存为停用草稿；配置密钥并启用后才能用于生成。</div></div>}
            <section className={section}>
                <h3 className="vcms-section-title">基本信息</h3>
                <div className={desktop ? 'vcms-desktop-grid' : 'vcms-grid2'}>
                    <div className={field}><label htmlFor="vcms-f-display">显示名称</label><Input events={events} id="vcms-f-display" type="text" bind="provider.displayName" value={d.displayName} placeholder="例如：我的模型服务" maxLength={60} />{err('displayName')}</div>
                    {!desktop && providerIdField}
                </div>
                <div className={`${field}${vc ? ' vcms-state-row' : ''}`}><span className="vcms-field-label">{vc ? p.stateLabel : '状态'}</span>
                    <div className="vcms-switch-row">
                        <Switch label="启用或停用该供应商" action="toggle-provider-state" disabled={events.disabled} checked={d.state === 'ENABLED'}
                            className={vc ? 'vc-switch' : `vcms-switch ${d.state === 'ENABLED' ? 'is-on' : ''}`} thumbClassName={vc ? undefined : 'vcms-switch-knob'}
                            onCheckedChange={enabled => events.onEdit('provider.state', enabled ? 'ENABLED' : 'DISABLED')} />
                        {!vc && <span>{p.stateLabel}</span>}
                    </div>{err('state')}
                </div>
                <div className={field}><label htmlFor="vcms-f-base">Base URL</label><Input events={events} id="vcms-f-base" type="url" bind="provider.baseUrl" value={d.baseUrl} placeholder="https://api.example.com" spellCheck={false} />{err('baseUrl')}</div>
                <div className={field}><span className="vcms-field-label">接口协议</span>
                    <div className="vcms-protocols" role="radiogroup" aria-label="接口协议">{p.protocols.map(protocol => <label key={protocol.id} className={`vcms-protocol ${d.protocol === protocol.id ? 'is-selected' : ''}`}>
                        <Input events={events} type="radio" name="vcms-protocol" value={protocol.id} checked={d.protocol === protocol.id} bind="provider.protocol" />
                        <span className="vcms-protocol-name">{protocol.label}</span><span className="vcms-protocol-endpoint vcms-mono">{protocol.endpoint}</span>
                        {vc && d.protocol === protocol.id && <Icon sprite={sprite} name="check" size={18} />}
                    </label>)}</div>{err('protocol')}
                </div>
                <div className={`vcms-endpoint-line${!p.endpoint.blank && !p.endpoint.ok ? ' is-error' : ''}`} id="vcms-endpoint-line">
                    {p.endpoint.blank ? <span className="vcms-muted">填写 Base URL 后显示规范化最终请求地址。</span> : p.endpoint.ok ? <>
                        <span className="vcms-muted">{desktop ? '请求地址' : '最终请求地址'}</span>{' '}
                        <span className="vcms-mono vcms-endpoint-url">{p.endpoint.finalUrl}</span>{' '}
                        {!desktop && <span className="vcms-muted">（{p.endpoint.hint}；最终地址以保存后的结果为准）</span>}
                    </> : p.endpoint.kind === 'full-endpoint' && p.endpoint.suggestedBaseUrl ? <>
                        <span className="vcms-field-err is-visible">{p.endpoint.error}</span>{' '}
                        <Action action="endpoint-convert" events={events} className="vcms-btn vcms-btn-primary-outline vcms-btn-sm" data-suggested={p.endpoint.suggestedBaseUrl}>转换为 Base URL</Action>{' '}
                        <span className="vcms-mono vcms-endpoint-url">{p.endpoint.suggestedBaseUrl}</span>
                    </> : <span className="vcms-field-err is-visible">{p.endpoint.error ?? 'Base URL 未通过校验'}</span>}
                </div>
            </section>
            <section className={section}><h3 className="vcms-section-title">API 密钥</h3><KeySection {...p} draft={d} /></section>
            <section className={section}>
                <div className="vcms-section-head"><h3 className="vcms-section-title">模型配置</h3><div className="vcms-section-tools">
                    <Action action="discover" events={events} className="vcms-btn vcms-btn-ghost vcms-btn-sm" disabled={p.discoverBusy || p.budgetInsufficient}><i className={`fa-solid fa-cloud-arrow-down ${p.discoverBusy ? 'fa-spin' : ''}`} /> {p.discoverBusy ? '拉取中…' : '拉取模型列表'}</Action>
                    <Action action="add-model" events={events} className="vcms-btn vcms-btn-ghost vcms-btn-sm"><i className="fa-solid fa-plus" /> 新增模型</Action>
                </div></div>
                <p className="vcms-muted vcms-section-note">拉取是显式操作，只在你点击时访问服务商接口；保存不会自动拉取、试连或生成。模型 ID 始终可以手填。</p>
                {p.discoverError && <div className="vcms-callout vcms-callout-danger" role="alert"><i className="fa-solid fa-triangle-exclamation" /><div>{p.discoverError}</div></div>}
                {p.models.length ? <div className="vcms-model-list" id="vcms-model-list">{p.models.map(row => <Button key={row.key} disabled={events.disabled} nativeButton={false} render={<div />} className={`vcms-model-row ${row.selected ? 'is-selected' : ''}`}
                    data-action="select-model" data-key={row.profileKey} data-model-index={row.index} aria-pressed={row.selected} onClick={event => events.onAction('select-model', event.currentTarget)}>
                    <div className="vcms-model-row-main"><span className="vcms-model-name">{row.name}</span><span className="vcms-model-id vcms-mono">{row.id}</span></div>
                    <div className="vcms-model-row-badges">
                        {row.incomplete && <span className="vcms-badge vcms-badge-warn">配置不完整</span>}
                        {row.bound > 0 && <span className="vcms-badge vcms-badge-info">{row.bound} 个用途在用</span>}
                        {row.error && <span className="vcms-badge vcms-badge-danger" title={row.error}>有校验错误</span>}
                    </div>
                </Button>)}</div> : <div className="vcms-empty-models"><p>还没有模型配置。</p><p className="vcms-muted">手填新增，或先配置密钥后从服务商拉取列表。</p></div>}
                {p.model && <ModelForm key={p.model.identity} {...p.model} />}
            </section>
            <section className={section}>
                <h3 className="vcms-section-title">连接检查</h3><div className="vcms-testbox">
                    <div className="vcms-test-target"><span className="vcms-muted">目标</span><span className="vcms-test-name">{p.testTarget}</span><span className="vcms-mono vcms-test-url">{p.testUrl}</span></div>
                    <p className="vcms-callout vcms-callout-info vcms-inline-note"><i className="fa-solid fa-circle-info" />连接检查只调用一次「拉取模型列表」接口：仅验证所选供应商的模型列表与鉴权，不发起生成调用，也不代表生成可用；真实生成以聊天为准。检查不会修改当前草稿。</p>
                    {p.check.error && <div className="vcms-callout vcms-callout-danger" role="alert"><i className="fa-solid fa-triangle-exclamation" /><div>{p.check.error}</div></div>}
                    {p.check.result && <div className="vcms-check-result">
                        <p className="vcms-check-line"><i className="fa-solid fa-circle-check" /> 已连通：服务方返回 {p.check.result.total} 个模型，其中 {p.check.result.unrecorded.length} 个未收录。</p>
                        {p.check.result.unrecorded.length ? <><ul className="vcms-check-list">{p.check.result.unrecorded.map(row => <li key={row.modelId}><span className="vcms-mono">{row.modelId}</span><span className="vcms-muted">{row.displayName}</span></li>)}</ul>
                            <div className="vcms-callout-actions"><Action action="check-add-models" events={events} className="vcms-btn vcms-btn-primary-outline vcms-btn-sm">把未收录模型加入列表（可选）</Action></div>
                        </> : <p className="vcms-muted">返回的模型都已收录；如需其他模型可继续手填模型 ID。</p>}
                    </div>}
                    <div className="vcms-callout-actions">
                        {p.budgetInsufficient && <p className="vcms-callout vcms-callout-warning" role="status">{p.budgetCopy}</p>}
                        <Action action="check-connection" events={events} className="vcms-btn vcms-btn-primary" disabled={p.check.busy || p.budgetInsufficient}><i className={`fa-solid fa-plug-circle-check ${p.check.busy ? 'fa-spin' : ''}`} /> {p.check.busy ? '检查中…' : '检查连接'}</Action>
                        <span className="vcms-muted">模型 ID 始终可以手填新增，检查不是必经步骤。</span>
                    </div>
                </div>
            </section>
            {p.saveError && <div className="vcms-callout vcms-callout-danger" role="alert" id="vcms-save-error"><i className="fa-solid fa-triangle-exclamation" /><div>{p.saveError} <Action action="save" events={events} className="vcms-btn vcms-btn-ghost vcms-btn-sm">重试保存</Action></div></div>}
            {desktop && p.screen !== 'model' && <details className="vcms-internal" open={p.creatingNew}><summary><Icon sprite={sprite} name="chevron-right" size={16} />高级</summary>{providerIdField}</details>}
            <div className="vcms-update-meta vcms-muted">更新于 {p.updated} · 配置版本 v{d.revision}{d.endpointUrl ? ` · 最终地址 ${d.endpointUrl}` : ''}</div>
        </div>
    </>;
}

function KeySection({ desktop, draft: d, keyPlan: key, keyEditing, keyClearing, keyLabels, events }: ProviderPaneProps & { draft: ProviderDraft }) {
    const field = desktop ? 'vc-desk-field' : 'vcms-field';
    if (keyEditing && key.action !== 'will-clear') return <div className={field}>
        <label htmlFor="vcms-f-key">新密钥（保存后替换）</label><Input events={events} id="vcms-f-key" type="password" bind="provider.credential" value={d.credential} placeholder="粘贴新密钥；留空则不替换" autoComplete="new-password" spellCheck={false} />
        <p className="vcms-muted">保存后只显示“已配置”，不会回显原值，也不会写入聊天记录或日志。</p>
        <Action action="key-undo" events={events} className="vcms-btn vcms-btn-ghost vcms-btn-sm">取消替换</Action>
    </div>;
    if (key.action === 'keep') return <>
        <div className="vcms-keybox"><div className="vcms-keybox-state"><i className="fa-solid fa-key" /><span>{keyLabels.configured}</span><span className="vcms-muted">密钥不回显、不写入页面数据；只在本页替换或清除。</span></div>
            <div className="vcms-keybox-actions"><Action action="key-replace" events={events} className="vcms-btn vcms-btn-ghost vcms-btn-sm">替换密钥</Action><Action action="key-clear" events={events} className="vcms-btn vcms-btn-danger-ghost vcms-btn-sm">清除密钥</Action></div>
        </div>
        {keyClearing && <div className="vcms-keyclear-confirm" role="alertdialog" aria-label="确认清除密钥"><p>清除后供应商将保持停用，后续请求不再携带该密钥。确认清除？</p>
            <div className="vcms-callout-actions"><Action action="key-clear-confirm" events={events} className="vcms-btn vcms-btn-danger vcms-btn-sm">确认清除</Action><Action action="key-clear-cancel" events={events} className="vcms-btn vcms-btn-ghost vcms-btn-sm">取消</Action></div>
        </div>}
    </>;
    if (key.action === 'will-clear') return <div className="vcms-keybox"><div className="vcms-keybox-state"><i className="fa-solid fa-key" /><span className="vcms-badge vcms-badge-danger">{keyLabels['will-clear']}</span></div><div className="vcms-keybox-actions"><Action action="key-undo" events={events} className="vcms-btn vcms-btn-ghost vcms-btn-sm">撤销</Action></div></div>;
    return <><div className={field}><label htmlFor="vcms-f-key">{key.action === 'will-replace' ? '新密钥（保存后替换）' : 'API 密钥'}</label>
        <Input events={events} id="vcms-f-key" type="password" bind="provider.credential" value={d.credential} placeholder="粘贴服务方提供的密钥" autoComplete="new-password" spellCheck={false} />
        <p className="vcms-muted">保存后只显示“已配置”，不回显原值，也不会写入聊天记录或日志。</p>
    </div>{key.action === 'will-replace' && <Action action="key-undo" events={events} className="vcms-btn vcms-btn-ghost vcms-btn-sm">撤销替换</Action>}</>;
}
