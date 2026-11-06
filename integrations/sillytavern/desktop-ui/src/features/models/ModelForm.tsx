import { Fragment } from 'react';
import { Icon } from '../../components/Icon';
import { Action, Input, Select, FieldError, type ModelEvents } from './fields';
import { extraReasoningLevels, reasoningLevelLabel, reasoningLevelPresets } from '../../../../extension/vc-model-settings/model-logic.js';

type FieldValue = string | number;
interface ModelDraft {
    profileKey: string; displayName: string; modelId: string;
    contextWindowTokens: FieldValue; maxOutputTokens: FieldValue;
    isNew?: boolean; isClone?: boolean;
    reasoningLevels: string[];
    generationParams: { reasoningEffort: string; temperature: FieldValue; topP: FieldValue };
    pricing: { currency: string; inputPerMillionTokens: FieldValue; outputPerMillionTokens: FieldValue };
}

export interface ModelFormProps {
    desktop: boolean; sprite: string; model: ModelDraft; errors: Record<string, string>;
    ledger: { status: string; copy: string }; shared: string; contextMissing: boolean; advancedOpen: boolean;
    reasoning: readonly { id: string; label: string }[]; extraReasoning: readonly string[];
    capabilities: readonly { id: string; label: string; value: string }[];
    capabilityStates: readonly { id: string; label: string }[];
    currencies: readonly { id: string; label: string }[]; pricingLabel: string;
    verification: { busy: boolean; error: string; verifiedNote: string; note: string; hint: string; action: string };
    deleting: boolean; deleteDisabled: boolean;
    clone?: { newProfileKey: string; newDisplayName: string; error: string | null };
    events: ModelEvents;
    onAdvancedChange: (open: boolean) => void;
}

export function ModelForm({ desktop, sprite, model: m, errors, ledger, shared, contextMissing, advancedOpen, reasoning, extraReasoning,
    capabilities, capabilityStates, currencies, pricingLabel, verification, deleting, deleteDisabled, clone, events, onAdvancedChange }: ModelFormProps) {
    const field = desktop ? 'vc-desk-field' : 'vcms-field';
    const grid = desktop ? 'vcms-desktop-grid' : 'vcms-grid2';
    const err = (name: string) => <FieldError name={name} errors={errors} />;
    const presets = reasoningLevelPresets(m);
    const reasoningPresets = presets.map((id: string) => ({
        id,
        label: reasoning.find(row => row.id === id)?.label ?? reasoningLevelLabel(id),
    }));
    const extraLevels = Array.from(new Set([
        ...(extraReasoningLevels(m.reasoningLevels, presets) as string[]),
        ...extraReasoning.filter(lv => !presets.includes(lv)),
    ]));
    const profileField = <div className={field}>
        <label htmlFor="vcms-m-profile">配置标识</label>
        <Input events={events} id="vcms-m-profile" type="text" className="vcms-mono" value={m.profileKey}
            bind={m.isNew || m.isClone ? 'model.profileKey' : undefined} readOnly={!m.isNew && !m.isClone}
            aria-readonly={!m.isNew && !m.isClone || undefined} placeholder={m.isNew || m.isClone ? '默认同模型 ID' : undefined} />
        <p className="vcms-muted">同一模型 ID 可以有多份配置（不同参数 / 计价）；「另存为新配置」会生成新的配置标识，不覆盖原配置。</p>
        {err('profileKey')}
    </div>;
    return <div className="vcms-model-form" data-profile={m.profileKey}>
        {ledger.copy && <p className="vcms-callout vcms-callout-warn" id={ledger.status === 'UNSUPPORTED_CURRENCY' ? 'vcms-currency-price' : 'vcms-no-price'} role="status" data-ledger={ledger.status}>{ledger.copy}</p>}
        {shared && (desktop ? <div className="vc-desk-field vcms-used-by"><span className="vcms-field-label">用于</span><span>{shared}</span></div> : <div className="vcms-callout vcms-callout-info"><i className="fa-solid fa-share-nodes" /><div>该配置正被这些用途使用：{shared}。此处的修改保存后会影响它们；如需不影响，请用「另存为新配置」。</div></div>)}
        <div className={grid}>
            <div className={field}><label htmlFor="vcms-m-display">模型显示名称</label><Input events={events} id="vcms-m-display" type="text" bind="model.displayName" value={m.displayName} maxLength={80} />{err('displayName')}</div>
            <div className={field}><label htmlFor="vcms-m-id">模型 ID</label><Input events={events} id="vcms-m-id" type="text" className="vcms-mono" bind="model.modelId" value={m.modelId} placeholder="服务方的模型 ID，可手填" spellCheck={false} />{err('modelId')}</div>
        </div>
        {!desktop && profileField}
        <div className={grid}>
            <div className={field}><label htmlFor="vcms-m-ctx">上下文窗口（token）</label><Input events={events} id="vcms-m-ctx" type="number" min="1" step="1" bind="model.contextWindowTokens" value={m.contextWindowTokens} placeholder="例如 200000" />{err('contextWindowTokens')}</div>
            <div className={field}><label htmlFor="vcms-m-max">最大输出（token 预留）</label><Input events={events} id="vcms-m-max" type="number" min="1" step="1" bind="model.maxOutputTokens" value={m.maxOutputTokens} placeholder="例如 8192" />{err('maxOutputTokens')}</div>
        </div>
        <p className="vcms-muted">上下文窗口包含历史消息、角色卡、世界书、记忆与工具结果；输出与工具结果需要预留空间。</p>
        <p className="vcms-callout vcms-callout-warn vcms-inline-note" data-note="ctx" role="alert" hidden={!contextMissing}><i className="fa-solid fa-triangle-exclamation" />未填写上下文窗口：配置不完整，绑定前台聊天前需要补齐。</p>
        <details className="vcms-advanced" open={advancedOpen} onToggle={event => onAdvancedChange(event.currentTarget.open)}>
            <summary>{desktop ? <><Icon sprite={sprite} name="chevron-right" size={16} />高级设置</> : '高级设置（推理 · 参数 · 能力 · 计价）'}</summary>
            <div className="vcms-advanced-body">
                <h4 className="vcms-subsection-title">推理</h4>
                <div className={field}><span className="vcms-field-label">可用思考档位</span>
                    <div className="vcms-checks">
                        {reasoningPresets.map(lv => <label className="vcms-check" key={lv.id}><Input events={events} type="checkbox" bind="model.reasoningLevels" value={lv.id} checked={m.reasoningLevels.includes(lv.id)} />{lv.label}</label>)}
                        {extraLevels.map(lv => <label className="vcms-check" key={lv} title="已保存的等级，继续保留"><input type="checkbox" checked disabled readOnly />{lv}</label>)}
                    </div>
                    <p className="vcms-muted">等级按当前协议映射为对应参数；未知映射保持待配置，不硬发统一字段。</p>
                </div>
                <div className={field}><label htmlFor="vcms-m-effort">思考深度</label>
                    <Select events={events} id="vcms-m-effort" bind="model.generationParams.reasoningEffort" value={m.generationParams.reasoningEffort}>
                        <option value="">模型默认</option>{m.reasoningLevels.map(lv => <option key={lv} value={lv}>{reasoning.find(row => row.id === lv)?.label ?? reasoningLevelLabel(lv)}</option>)}
                    </Select>{err('reasoningEffort')}
                </div>
                <h4 className="vcms-subsection-title">生成参数</h4>
                <div className={grid}>
                    <div className={field}><label htmlFor="vcms-m-temp">温度 temperature（0–2）</label><Input events={events} id="vcms-m-temp" type="number" min="0" max="2" step="0.1" bind="model.generationParams.temperature" value={m.generationParams.temperature} />{err('temperature')}</div>
                    <div className={field}><label htmlFor="vcms-m-topp">top P（0–1）</label><Input events={events} id="vcms-m-topp" type="number" min="0" max="1" step="0.05" bind="model.generationParams.topP" value={m.generationParams.topP} />{err('topP')}</div>
                </div>
                <h4 className="vcms-subsection-title">能力与输入类型</h4>
                {!desktop && <p className="vcms-muted">每项独立标记；「已验证」只能来自后端核验，不能手动选择。声明不代表实际可用。</p>}
                {err('capabilities')}
                <div className="vcms-capgrid">{capabilities.map(cap => <Fragment key={cap.id}>
                    <div className="vcms-caprow"><span className="vcms-capname">{cap.label}</span>
                        <div className={`vcms-seg${desktop ? ' vc-segment' : ''}`} role="group" aria-label={`${cap.label}状态`}>
                            {desktop && <i className="vc-segment-thumb" style={{ width: `calc((100% - 4px) / ${capabilityStates.length})`, transform: `translateX(${Math.max(0, capabilityStates.findIndex(row => row.id === cap.value)) * 100}%)` }} />}
                            {capabilityStates.map(s => <Action key={s.id} action="cap" events={events} className={`vcms-seg-btn vcms-cap-${s.id.toLowerCase()} ${cap.value === s.id ? 'is-active' : ''}`}
                                data-cap-key={cap.id} data-cap-state={s.id} disabled={s.id === 'VERIFIED' && cap.value !== s.id}
                                title={s.id === 'VERIFIED' ? '已验证状态来自后端核验，不能手动设置' : ''} aria-pressed={cap.value === s.id}>{s.label}</Action>)}
                        </div>
                    </div>
                    {cap.id === 'toolCalls' && (cap.value === 'VERIFIED' ? <p className="vcms-muted vcms-tool-verify" data-tool-calls-note="">{verification.verifiedNote}</p> : <div className="vcms-tool-verify" data-tool-calls-note="">
                        <p>{verification.note}</p><p className="vcms-muted">{verification.hint}</p>
                        <Action action="verify-tool-calls" events={events} className="vcms-btn vcms-btn-primary-outline vcms-btn-sm" disabled={verification.busy}>{verification.busy ? '验证中…' : verification.action}</Action>
                        {verification.error && <p className="vcms-field-err is-visible" data-tool-calls-error="">{verification.error}</p>}
                    </div>)}
                </Fragment>)}</div>
                <h4 className="vcms-subsection-title">计价（可选元数据）</h4>
                <p className="vcms-muted">当前显示：{pricingLabel}。价格未知显示「未配置」，不会当作免费。</p>
                <div className="vcms-grid3">
                    <div className={field}><label htmlFor="vcms-m-currency">币种</label><Select events={events} id="vcms-m-currency" bind="model.pricing.currency" value={m.pricing.currency}><option value="">未配置</option>{currencies.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</Select>{err('pricingCurrency')}</div>
                    <div className={field}><label htmlFor="vcms-m-pin">输入价格 / 百万 token</label><Input events={events} id="vcms-m-pin" type="number" min="0" step="0.01" bind="model.pricing.inputPerMillionTokens" value={m.pricing.inputPerMillionTokens} placeholder="未知" />{err('pricingInput')}</div>
                    <div className={field}><label htmlFor="vcms-m-pout">输出价格 / 百万 token</label><Input events={events} id="vcms-m-pout" type="number" min="0" step="0.01" bind="model.pricing.outputPerMillionTokens" value={m.pricing.outputPerMillionTokens} placeholder="未知" />{err('pricingOutput')}</div>
                </div>
            </div>
        </details>
        {desktop && <details className="vcms-internal" open={m.isNew || m.isClone}><summary><Icon sprite={sprite} name="chevron-right" size={16} />高级</summary>{profileField}</details>}
        <div className="vcms-model-actions">
            <Action action="clone-model" events={events} className="vcms-btn vcms-btn-ghost vcms-btn-sm"><i className="fa-solid fa-copy" /> 另存为新配置</Action>
            {deleting ? <span className="vcms-inline-confirm">删除该模型配置？
                <Action action="delete-model-confirm" events={events} className="vcms-btn vcms-btn-danger vcms-btn-sm">删除</Action>{' '}
                <Action action="delete-model-cancel" events={events} className="vcms-btn vcms-btn-ghost vcms-btn-sm">取消</Action>
            </span> : <Action action="delete-model" events={events} className="vcms-btn vcms-btn-danger-ghost vcms-btn-sm" disabled={deleteDisabled} title={deleteDisabled ? '该配置仍被用途绑定引用，先解除绑定' : undefined}><i className="fa-solid fa-trash-can" /> 删除</Action>}
        </div>
        {clone && <div className="vcms-clone-form">
            <p className="vcms-field-label">另存为新配置（不影响现有用途绑定）</p>
            <div className={grid}>
                <div className={field}><label htmlFor="vcms-clone-key">新配置标识 profileKey</label><Input events={events} id="vcms-clone-key" type="text" className="vcms-mono" bind="clone.newProfileKey" value={clone.newProfileKey} spellCheck={false} /></div>
                <div className={field}><label htmlFor="vcms-clone-name">新显示名称</label><Input events={events} id="vcms-clone-name" type="text" bind="clone.newDisplayName" value={clone.newDisplayName} maxLength={80} /></div>
            </div>
            {clone.error && <p className="vcms-field-err is-visible">{clone.error}</p>}
            <div className="vcms-callout-actions"><Action action="clone-confirm" events={events} className="vcms-btn vcms-btn-primary vcms-btn-sm">创建副本</Action><Action action="clone-cancel" events={events} className="vcms-btn vcms-btn-ghost vcms-btn-sm">取消</Action></div>
        </div>}
    </div>;
}
