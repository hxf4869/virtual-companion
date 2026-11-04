import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { F2_CONFLICT_COPY } from '../../../../extension/vc-model-settings/f2-logic.js';
import { PortalNestedScope, usePortalContainer } from '../../design/portal-host';
import { Button } from '../../design/components/Button';
import { useChatSnapshot, useSessionBridge } from '../../runtime/session-bridge';

export function ConflictSheet() {
    const bridge = useSessionBridge();
    const conflict = useChatSnapshot(s => s.conflict);
    const conflictSnapshot = useChatSnapshot(s => s.conflictSnapshot);
    const portalContainer = usePortalContainer();

    const isOpen = Boolean(conflict && conflictSnapshot);
    if (!isOpen) return null;

    return (
        <BaseDialog.Root
            open={isOpen}
            onOpenChange={nextOpen => {
                if (!nextOpen) {
                    bridge.dismissConflict();
                    document.querySelector<HTMLTextAreaElement>('#send_textarea')?.focus();
                }
            }}
        >
            <BaseDialog.Portal container={portalContainer}>
                <PortalNestedScope>
                    <BaseDialog.Backdrop className="vc-dialog__backdrop" />
                    <BaseDialog.Popup
                        render={<dialog id="vc-f2-conflict" open />}
                        aria-labelledby="vc-f2-title"
                        data-width={420}
                        className="vc-dialog vc-f2-conflict-dialog"
                    >
                        <div className="vc-f2-panel">
                            <BaseDialog.Title id="vc-f2-title" className="vc-dialog__title">
                                对话已更新
                            </BaseDialog.Title>
                            <p role="alert" className="vc-dialog__description">
                                {F2_CONFLICT_COPY}
                            </p>
                            <div className="vc-f2-actions vc-dialog__footer">
                                <Button
                                    type="button"
                                    variant="filled"
                                    data-action="view-latest"
                                    onClick={() => {
                                        void bridge.resolveConflictLatest().then(res => {
                                            if (res === 'opened') {
                                                document
                                                    .querySelector<HTMLTextAreaElement>(
                                                        '#send_textarea',
                                                    )
                                                    ?.focus();
                                            }
                                        });
                                    }}
                                >
                                    查看最新
                                </Button>
                                <Button
                                    type="button"
                                    variant="gray"
                                    data-action="keep-draft"
                                    onClick={() => {
                                        bridge.dismissConflict();
                                        document
                                            .querySelector<HTMLTextAreaElement>('#send_textarea')
                                            ?.focus();
                                    }}
                                >
                                    保留草稿
                                </Button>
                                <Button
                                    type="button"
                                    variant="text"
                                    data-action="copy-input"
                                    onClick={() => {
                                        void bridge.copyRejected();
                                    }}
                                >
                                    复制
                                </Button>
                            </div>
                        </div>
                    </BaseDialog.Popup>
                </PortalNestedScope>
            </BaseDialog.Portal>
        </BaseDialog.Root>
    );
}
