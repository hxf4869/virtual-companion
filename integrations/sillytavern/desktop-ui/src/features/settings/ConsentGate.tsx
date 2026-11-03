import { useCallback, useRef, type ReactNode } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { Collapsible } from '@base-ui/react/collapsible';
import { Button } from '@base-ui/react/button';
import { Icon } from '../../components/Icon';
export interface ConsentGateProps {
    host: HTMLElement; sprite: string; open: boolean; busy: boolean; error: string; reauthOpen: boolean; reauthError: string; reset: number;
    items: readonly { type: string; label: string; icon: string; body: string }[];
    onAccept: () => void; onLogout: () => void; onVerify: (form: HTMLFormElement) => void; onCancelReauth: () => void; onPopup: (node: HTMLDialogElement) => void; nested?: ReactNode;
}
export function ConsentGate(p: ConsentGateProps) {
    const dialog = useRef<HTMLDialogElement>(null), title = useRef<HTMLHeadingElement>(null);
    const setDialog = useCallback((node: HTMLDialogElement | null) => { dialog.current = node; if (node) p.onPopup(node); }, [p.onPopup]);
    return <Dialog.Root defaultOpen open={p.open} disablePointerDismissal onOpenChange={(open, details) => { if (!open) details.cancel(); }}>
        <Dialog.Portal container={p.host} style={{ display: 'contents' }}>
            <Dialog.Backdrop className="vc-consent-backdrop" style={{ position: 'fixed', inset: 0, background: 'var(--vc-sheet, Canvas)', zIndex: 'var(--vc-z-alert)' }} />
            <Dialog.Popup render={<dialog ref={setDialog} open={p.open} onCancel={event => event.preventDefault()} />} id="vc-consent" className="vc-consent" style={{ zIndex: 'var(--vc-z-alert, 60)' }} aria-labelledby="vc-consent-title" initialFocus={title}>
                <div className="vc-consent-scroll" inert={p.reauthOpen || undefined}>
                    <h1 ref={title} id="vc-consent-title" className="vc-large-title" tabIndex={-1}>开始之前</h1>
                    <div className="vc-group">{p.items.map(item => <Collapsible.Root key={item.type} className={state => `vc-consent-item${state.open ? ' is-open' : ''}`}>
                        <Collapsible.Trigger className="vc-cell" data-consent-toggle={item.type}><Icon sprite={p.sprite} name={item.icon} size={22} /><span className="vc-grow">{item.label}</span><span className="vc-consent-chevron"><Icon sprite={p.sprite} name="chevron-right" size={18} /></span></Collapsible.Trigger>
                        <Collapsible.Panel keepMounted render={<p />} className="vc-consent-copy">{item.body}</Collapsible.Panel>
                    </Collapsible.Root>)}</div>
                    <p className="vc-consent-error" data-consent-error="" role="alert" hidden={!p.error}>{p.error}</p>
                </div>
                <div className="vc-consent-bar" inert={p.reauthOpen || undefined}><Button className="vc-btn vc-btn-fill" data-consent-accept="" disabled={p.busy} onClick={p.onAccept}>同意并继续</Button><Button className="vc-btn vc-btn-text" data-consent-logout="" onClick={p.onLogout}>退出登录</Button></div>
                <form data-consent-reauth="" hidden={!p.reauthOpen} onSubmit={event => { event.preventDefault(); p.onVerify(event.currentTarget); }}>
                    <h2>重新验证身份</h2><label>当前密码<input key={p.reset} type="password" autoComplete="current-password" data-consent-reauth-password="" /></label>
                    <p className="vc-consent-error" data-consent-reauth-status="" role="alert" hidden={!p.reauthError}>{p.reauthError}</p>
                    <Button type="submit" className="vc-btn vc-btn-fill" disabled={p.busy}>验证并继续</Button><Button className="vc-btn vc-btn-text" data-consent-reauth-cancel="" onClick={p.onCancelReauth}>取消</Button>
                </form>
            </Dialog.Popup>
        </Dialog.Portal>{p.nested}
    </Dialog.Root>;
}
