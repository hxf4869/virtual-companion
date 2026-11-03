import { useLayoutEffect, useRef, useCallback, useEffect, type CSSProperties, type RefObject, type ReactNode } from 'react';
import { Menu } from '@base-ui/react/menu';
import { AlertDialog } from '@base-ui/react/alert-dialog';
import { Dialog } from '@base-ui/react/dialog';
import { Button } from '@base-ui/react/button';
import { Icon } from './Icon';

export type MenuEntry = '-' | { separator?: boolean; type?: string; label?: string; icon?: string; check?: boolean; mark?: string; danger?: boolean; run?: () => void; onSelect?: () => void };
export interface MenuViewProps {
    host: HTMLElement; anchor: HTMLElement; items: MenuEntry[]; sprite: string; below: boolean; blur: boolean;
    className?: string; note?: string; actions: RefObject<Menu.Root.Actions | null>;
    onClose: () => void; onClosed: () => void; onDispose: () => void; nested?: ReactNode; popupRef: RefObject<HTMLDivElement | null>; backdropRef: RefObject<HTMLDivElement | null>;
}
export function MenuView({ host, anchor, items, sprite, below, blur, className = '', note, actions, onClose, onClosed, popupRef: popup, backdropRef, nested, onDispose }: MenuViewProps) {
    useEffect(() => onDispose, [onDispose]);
    const fixed = host === host.ownerDocument.body;
    const right = anchor.getBoundingClientRect().left > (fixed ? host.ownerDocument.defaultView!.innerWidth / 2 : host.getBoundingClientRect().left + host.clientWidth / 2);
    return <Menu.Root defaultOpen modal={false} actionsRef={actions} onOpenChange={open => { if (!open) onClose(); }} onOpenChangeComplete={open => { if (!open) onClosed(); }}>
        <Menu.Portal container={host} style={{ display: 'contents' }}>
            <Menu.Backdrop ref={backdropRef} className={state => `vc-scrim ${blur ? 'is-blur' : 'is-clear'}${state.open ? ' is-on' : ''}`} style={{ position: fixed ? 'fixed' : 'absolute' }} />
            <Menu.Positioner anchor={anchor} side={below ? 'bottom' : 'top'} align={right ? 'end' : 'start'} sideOffset={8}
                positionMethod={fixed ? 'fixed' : 'absolute'} collisionPadding={8} collisionBoundary={fixed ? 'clipping-ancestors' : host}
                collisionAvoidance={{ side: 'shift', align: 'shift', fallbackAxisSide: 'none' }} className="vc-menu-positioner" style={{ zIndex: 'var(--vc-z-menu)' }}>
                <Menu.Popup ref={popup} finalFocus={() => anchor.isConnected ? anchor : null} onKeyDown={event => {
                    // imperative 调用的外部锚点没有 Menu.Trigger；Tab 仅请求库关闭，
                    // 不取消浏览器默认导航、不计算焦点、不实现首尾循环。
                    if (event.key === 'Tab') actions.current?.close();
                }} className={`vc-menu vc-glass ${className}`} style={{ position: 'relative', maxHeight: 'var(--available-height)', overflowY: 'auto' }}>
                    <Menu.List>
                    {note && <p className="vc-memory-note">{note}</p>}
                    {items.map((item, i) => item === '-' || item.separator || item.type === 'separator' ? <hr key={i} /> :
                        <Menu.Item key={i} render={<button type="button" />} nativeButton data-i={i} className={item.danger ? 'is-danger' : undefined}
                            aria-checked={item.check ? true : undefined} onClick={() => { item.run?.(); item.onSelect?.(); }}>
                            <span className="vc-menu-label">{item.label}</span>{item.mark ? <span className="vc-menu-mark" dangerouslySetInnerHTML={{ __html: item.mark }} /> :
                                <span className="vc-menu-mark">{(item.check || item.icon) && <Icon sprite={sprite} name={item.check ? 'check' : item.icon!} size={19} />}</span>}
                        </Menu.Item>)}
                    </Menu.List>
                </Menu.Popup>
            </Menu.Positioner>
        </Menu.Portal>{nested}
    </Menu.Root>;
}
export interface AlertViewProps {
    host: HTMLElement; title: string; message: string; action: string; cancel: string; sprite: string; opener: HTMLElement | null;
    actions: RefObject<AlertDialog.Root.Actions | null>; onChoose: (value: boolean) => void; onClose: () => void; onClosed: () => void; onDispose: () => void; nested?: ReactNode; popupRef: RefObject<HTMLDivElement | null>;
}
export function AlertView({ host, title, message, action, cancel, sprite, opener, actions, onChoose, onClose, onClosed, popupRef, nested, onDispose }: AlertViewProps) {
    useEffect(() => onDispose, [onDispose]);
    const cancelRef = useRef<HTMLButtonElement>(null);
    const fixed = host === host.ownerDocument.body;
    return <AlertDialog.Root defaultOpen actionsRef={actions} onOpenChange={open => { if (!open) onClose(); }} onOpenChangeComplete={open => { if (!open) onClosed(); }}>
        <AlertDialog.Portal container={host} style={{ display: 'contents' }}>
            <AlertDialog.Backdrop forceRender className={state => `vc-scrim${state.open ? ' is-on' : ''}`} style={{ position: fixed ? 'fixed' : 'absolute', zIndex: 'var(--vc-z-alert)' }} onClick={() => onChoose(false)} />
            <AlertDialog.Popup ref={popupRef} className="vc-alert vc-glass" initialFocus={cancelRef} finalFocus={() => opener?.isConnected ? opener : null} style={{ position: fixed ? 'fixed' : 'absolute' }}>
                <span className="vc-alert-icon" hidden={!host.ownerDocument.body.classList.contains('vc-ui')} aria-hidden="true"><Icon sprite={sprite} name="circle-alert" size={22} /></span>
                <div className="vc-alert-copy"><AlertDialog.Title render={<h4 />}>{title}</AlertDialog.Title><AlertDialog.Description render={<p />}>{message}</AlertDialog.Description></div>
                <div className="vc-alert-actions"><Button ref={cancelRef} data-vc-cancel="" onClick={() => onChoose(false)}>{cancel}</Button><Button className="is-danger" data-vc-ok="" onClick={() => onChoose(true)}>{action}</Button></div>
            </AlertDialog.Popup>
        </AlertDialog.Portal>{nested}
    </AlertDialog.Root>;
}
export interface SheetViewProps {
    host: HTMLElement; title: string; open: boolean; resumeFocus?: HTMLElement | null; body?: Node | string; content?: ReactNode; style?: CSSProperties; scrimStyle?: CSSProperties; opener: HTMLElement | null;
    actions: RefObject<Dialog.Root.Actions | null>; onRequestClose: (reason: string) => void; onComplete: () => void;
    popupRef: RefObject<HTMLDivElement | null>; backdropRef: RefObject<HTMLDivElement | null>;
    headerActions?: { label: string; hidden?: boolean; disabled?: boolean; onClick: (trigger: HTMLButtonElement) => void }[];
    nested?: ReactNode; doneProps?: { label?: string; hidden?: boolean; disabled?: boolean; style?: CSSProperties }; ariaLabel?: string;
}
export function SheetView({ host, title, open, resumeFocus, body, content, style, scrimStyle, opener, actions, onRequestClose, onComplete, popupRef: popup, backdropRef, headerActions = [], doneProps = {}, ariaLabel, nested }: SheetViewProps) {
    // Portal的节点建立后才接入外部表单；槽位没有React children。
    const bodyRef = useCallback((slot: HTMLDivElement | null) => {
        if (!slot) return;
        if (body && typeof body !== 'string') slot.append(body);
        else if (body != null) { const p = slot.ownerDocument.createElement('p'); p.textContent = body; slot.append(p); }
        return () => { slot.replaceChildren(); };
    }, [body]);
    return <Dialog.Root defaultOpen open={open} actionsRef={actions} onOpenChange={(open, details) => { if (!open) { details.cancel(); onRequestClose(details.reason); } }}>
        <Dialog.Portal container={host} keepMounted style={{ display: 'contents' }}>
            <Dialog.Backdrop forceRender ref={backdropRef} className="vc-scrim is-on" style={{ ...scrimStyle, display: open ? undefined : 'none' }} onClick={() => onRequestClose('outside-press')} />
            <Dialog.Popup ref={popup} className="vc-sheet" style={{ ...style, display: open ? undefined : 'none' }} aria-label={ariaLabel} initialFocus={() => resumeFocus?.isConnected ? resumeFocus : popup.current} finalFocus={() => opener?.isConnected ? opener : null}>
                <div className="vc-sheet-grab" /><div className="vc-sheet-head"><Dialog.Title render={<h3 />}>{title}</Dialog.Title>{headerActions.map((action, i) => <Button key={i} className="vc-btn vc-btn-text" hidden={action.hidden} disabled={action.disabled} style={{ display: action.hidden ? 'none' : undefined }} onClick={e => action.onClick(e.currentTarget)}>{action.label}</Button>)}<Button className="vc-sheet-done" hidden={doneProps.hidden} disabled={doneProps.disabled} style={doneProps.style} onClick={onComplete}>{doneProps.label || '完成'}</Button></div><div ref={content === undefined ? bodyRef : undefined} className="vc-sheet-body">{content}</div>
            </Dialog.Popup>
        </Dialog.Portal>{nested}
    </Dialog.Root>;
}

export function SheetLayer({ title, backLabel, body, sprite, onBack }: { title: string; backLabel: string; body?: Node; sprite: string; onBack: () => void }) {
    const slot = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => { if (body) slot.current!.append(body); return () => { if (body?.parentNode === slot.current) body.parentNode?.removeChild(body); }; }, [body]);
    return <><div className="vc-sheet-head"><Button className="vc-btn vc-btn-text vc-sheet-back" aria-label={backLabel ? `返回${backLabel}` : '返回'} onClick={onBack}><Icon sprite={sprite} name="chevron-left" size={22} /><span>{backLabel}</span></Button><h3>{title}</h3></div><div ref={slot} style={{ display: 'contents' }} /></>;
}
