import { useRef, useCallback, type ReactNode } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { Icon } from '../../components/Icon';
import { IconButton } from '../../components/IconButton';
import { Bindings, type BindingsProps } from './Bindings';
import { Usage, type UsageProps } from './Usage';
import { Providers, type ProvidersProps } from './Providers';
import { ProviderPane, type ProviderPaneProps } from './ProviderPane';
import { LocalModels, type LocalModelsProps } from './LocalModels';
import { Action, Input, type ModelEvents } from './fields';

export interface ModelPageProps {
    host: HTMLElement; onPopup: (node: HTMLDivElement) => void; nested?: ReactNode;
    vc: boolean; desktop: boolean; sprite: string; inSettings: boolean;
    phase: string; screen: string; tab: string; nav: { back: string; title: string };
    providerCount: number; modelCount: number; purposeCount: number;
    saving: boolean; saveDisabled: boolean; clean: boolean; dirty: boolean; hasErrors: boolean;
    budgetInsufficient: boolean; budgetCopy: string; loadError: { title: string; message: string };
    reauth: { open: boolean; busy: boolean; password: string; error: string | null; retry: string | null };
    toast?: { kind: string; message: string };
    bindings: BindingsProps; usage: UsageProps; providers: ProvidersProps; provider: ProviderPaneProps; local: LocalModelsProps;
    events: ModelEvents;
}

export function ModelPage(p: ModelPageProps) {
    const { vc, desktop, events } = p;
    const panel = useRef<HTMLDivElement>(null);
    const setPanel = useCallback((node: HTMLDivElement | null) => { panel.current = node; if (node) p.onPopup(node); }, [p.onPopup]);
    const Panel = p.inSettings ? 'div' : Dialog.Popup;
    const saveProps = { disabled: p.saveDisabled, 'data-vc-clean': p.clean ? '' : undefined, title: p.hasErrors ? '存在校验错误，请先按提示修改' : undefined };
    const headerActions = <>
        <Action action="discard" events={events} className={vc ? 'vc-btn vc-btn-text' : 'vcms-btn vcms-btn-ghost'} id="vcms-discard" hidden={!p.dirty}>放弃修改</Action>
        <Action action="save" events={events} className={vc ? 'vc-btn vc-btn-fill' : 'vcms-btn vcms-btn-primary'} id="vcms-save" {...saveProps}>{p.saving ? '保存中…' : '保存更改'}</Action>
    </>;
    const titles = <><h2 className="vcms-title" tabIndex={-1}>模型设置</h2><p className="vcms-subtitle">供应商 {p.providerCount} · 模型配置 {p.modelCount} · 用途绑定 {p.purposeCount}</p></>;
    const tabs = <div className="vcms-tabs" role="tablist">{['provider', 'bindings'].map(tab => <Action key={tab} action="tab" events={events} role="tab" className={`vcms-tab ${p.tab === tab ? 'is-active' : ''}`} aria-selected={p.tab === tab} data-tab={tab}>{tab === 'provider' ? '供应商与模型' : '用途绑定'}</Action>)}</div>;
    const provider = <ProviderPane {...p.provider} />;
    const bindings = <Bindings {...p.bindings} />;
    const contents = <>
        <Panel ref={setPanel} {...(!p.inSettings ? { initialFocus: () => panel.current?.querySelector<HTMLElement>('.vc-nav-title, .vcms-title') || panel.current } : {})} className="vcms-panel" data-vc-screen={vc ? p.screen : undefined} tabIndex={-1} role={p.inSettings ? 'region' : 'dialog'} aria-modal={p.inSettings ? undefined : true} aria-label="模型设置">
            {vc ? <header className="vcms-header vc-navbar" style={{ '--vc-nav-p': 1 } as React.CSSProperties}>
                {p.inSettings && <span className="vc-settings-category-control"><IconButton sprite={p.sprite} icon="settings" label="设置" disabled={events.disabled} className="vc-settings-category-toggle" data-settings-categories="" /></span>}
                <Action action="vc-back" events={events} className="vc-circle vc-glass" aria-label={`返回${p.nav.back}`}><Icon sprite={p.sprite} name="chevron-left" size={22} /></Action>
                <div className="vc-nav-title" tabIndex={-1}>{p.nav.title}</div><div className="vc-nav-spacer" />
                {headerActions}<Action action="close" events={events} className="vcms-dismiss" aria-hidden="true" tabIndex={-1}>关闭</Action>{titles}
            </header> : <header className="vcms-header"><div className="vcms-header-titles">{titles}</div><div className="vcms-header-actions">{headerActions}<Action action="close" events={events} className="vcms-iconbtn" aria-label="关闭模型设置" title="关闭（Esc）"><i className="fa-solid fa-xmark" /></Action></div></header>}
            <div className="vcms-body">
                {p.reauth.open && <div className="vcms-reauth-bar" role="alertdialog" aria-label="重新验证身份">
                    <div className="vcms-reauth-main"><i className="fa-solid fa-user-shield" /><p>写入前需要重新验证身份。输入当前登录密码完成验证，{p.reauth.retry === 'verify-tool-calls' ? '验证成功后将继续验证工具调用。' : '验证成功后将继续未完成的保存。'}</p></div>
                    <div className="vcms-reauth-form"><Input events={events} id="vcms-reauth-password" type="password" bind="reauth.password" value={p.reauth.password} placeholder="当前登录密码" autoComplete="current-password" spellCheck={false}
                        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); events.onAction('reauth-submit', event.currentTarget); } }} />
                        {p.reauth.error && <p className="vcms-field-err is-visible">{p.reauth.error}</p>}
                        <div className="vcms-callout-actions"><Action action="reauth-submit" events={events} className="vcms-btn vcms-btn-primary vcms-btn-sm" disabled={p.reauth.busy}>{p.reauth.busy ? '验证中…' : p.reauth.retry === 'verify-tool-calls' ? '验证并继续' : '验证并继续保存'}</Action><Action action="reauth-cancel" events={events} className="vcms-btn vcms-btn-ghost vcms-btn-sm" disabled={p.reauth.busy}>取消</Action></div>
                    </div>
                </div>}
                {p.phase === 'loading' && <div className="vcms-skeleton"><div className="vcms-sk-col">{Array.from({ length: 3 }, (_, i) => <div className="vcms-sk-card" key={i} />)}</div><div className="vcms-sk-main">{Array.from({ length: 8 }, (_, i) => <div className="vcms-sk-line" key={i} />)}</div></div>}
                {p.phase === 'load-error' && <div className="vcms-stateblock"><i className="fa-solid fa-plug-circle-xmark vcms-stateblock-icon" /><h3>{p.loadError.title}</h3><p>{p.loadError.message}</p><Action action="retry-load" events={events} className="vcms-btn vcms-btn-primary"><i className="fa-solid fa-rotate-right" /> 重试</Action></div>}
                {p.budgetInsufficient && <p className="vcms-callout vcms-callout-warning" role="status" id="vcms-budget">{p.budgetCopy}</p>}
                {p.phase === 'ready' && <>
                    {!vc && <Usage {...p.usage} />}
                    <div className="vcms-layout">
                        <aside className="vcms-providers" aria-label="供应商列表">
                            {!vc && <div className="vcms-providers-head"><span className="vcms-section-label">接入的供应商</span><Action action="new-provider" events={events} className="vcms-btn vcms-btn-ghost vcms-btn-sm"><i className="fa-solid fa-plus" /> 新建</Action></div>}
                            {vc && p.screen === 'home' && !desktop && <h2 className="vcms-providers-title">供应商</h2>}
                            <div className="vcms-provider-list" id="vcms-provider-list"><Providers {...p.providers} /></div>
                        </aside>
                        <main className="vcms-main">{tabs}<div className="vcms-tabpanes">{(vc ? ['provider', 'model'].includes(p.screen) : p.tab === 'provider') ? provider : bindings}</div></main>
                    </div>
                    {vc && <><LocalModels {...p.local} /><Usage {...p.usage} /></>}
                </>}
            </div>
            <footer className="vcms-footer"><Action action="close" events={events} className="vcms-btn vcms-btn-ghost">取消并返回</Action><Action action="save" events={events} className="vcms-btn vcms-btn-primary" id="vcms-save-footer" {...saveProps}>{p.saving ? '保存中…' : '保存配置'}</Action></footer>
        </Panel>
        {p.toast && <div className={`vcms-toast vcms-toast-${p.toast.kind}`} data-action="toast-dismiss" onClick={event => events.onAction('toast-dismiss', event.currentTarget)}>{p.toast.message}</div>}
    </>;
    return p.inSettings ? <>{contents}{p.nested}</> : <Dialog.Root defaultOpen modal="trap-focus" disablePointerDismissal onOpenChange={(open, details) => { if (!open) { details.cancel(); events.onAction('close', panel.current!); } }}>
        <Dialog.Portal container={p.host} style={{ display: 'contents' }}>{contents}</Dialog.Portal>{p.nested}
    </Dialog.Root>;
}
