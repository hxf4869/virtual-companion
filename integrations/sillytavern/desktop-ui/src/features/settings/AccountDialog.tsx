import { type RefObject, type ReactNode, useCallback } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { AccountContents, type AccountContentsProps } from './AccountContents';
export interface AccountDialogProps extends AccountContentsProps {
    host: HTMLElement; open: boolean; opener: HTMLElement | null; onDismiss: () => void; onPopup: (node: HTMLDialogElement) => void; nested?: ReactNode;
}
export function AccountDialog({ host, open, opener, onDismiss, onPopup, dialogRef, nested, ...contents }: AccountDialogProps & { dialogRef: RefObject<HTMLDialogElement | null> }) {
    const setDialog = useCallback((node: HTMLDialogElement | null) => { dialogRef.current = node; if (node) onPopup(node); }, [dialogRef, onPopup]);
    return <Dialog.Root open={open} disablePointerDismissal onOpenChange={(next, details) => { if (!next) { details.cancel(); onDismiss(); } }}>
        <Dialog.Portal container={host} keepMounted style={{ display: 'contents' }}>
            <Dialog.Backdrop className="vc-data-backdrop" style={{ position: 'fixed', inset: 0, background: contents.vc ? 'transparent' : 'var(--vcms-bg)', zIndex: 'var(--vc-z-page, 40)' }} />
            <Dialog.Popup render={<dialog ref={setDialog} open={open} />} className="vc-data-dialog" style={{ zIndex: 'var(--vc-z-page, 40)' }} data-vc-screen={contents.vc ? contents.screen : undefined} aria-labelledby="vc-data-title"
                initialFocus={() => dialogRef.current?.querySelector<HTMLElement>(contents.vc ? '[data-vc-account-back]' : 'h1') || null} finalFocus={() => opener?.isConnected ? opener : null}>
                <AccountContents {...contents} />
            </Dialog.Popup>
        </Dialog.Portal>{nested}
    </Dialog.Root>;
}
