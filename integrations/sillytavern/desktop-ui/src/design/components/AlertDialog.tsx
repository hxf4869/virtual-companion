import { type ReactNode, useRef } from 'react';
import { AlertDialog as BaseAlertDialog } from '@base-ui/react/alert-dialog';
import { PortalNestedScope, usePortalContainer } from '../portal-host';
import { Button } from './Button';
import { Icon } from './Icon';
import './AlertDialog.css';

export interface AlertDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  pending?: boolean;
  onConfirm: () => void;
  className?: string;
}

export function AlertDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  danger = false,
  pending = false,
  onConfirm,
  className,
}: AlertDialogProps) {
  const cancelBtnRef = useRef<HTMLButtonElement | null>(null);
  const mergedClassName = ['vc-alert-dialog', className].filter(Boolean).join(' ');
  const portalContainer = usePortalContainer();

  return (
    <BaseAlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <BaseAlertDialog.Portal container={portalContainer}>
        <PortalNestedScope>
          <BaseAlertDialog.Backdrop className="vc-alert-dialog__backdrop" />
          <BaseAlertDialog.Popup
            initialFocus={cancelBtnRef}
            className={mergedClassName}
          >
            <div className="vc-alert-dialog__content">
              <div
                className={[
                  'vc-alert-dialog__icon',
                  danger ? 'vc-alert-dialog__icon--danger' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                aria-hidden="true"
              >
                <Icon name="circle-alert" size={20} />
              </div>
              <div className="vc-alert-dialog__text">
                <BaseAlertDialog.Title className="vc-alert-dialog__title">
                  {title}
                </BaseAlertDialog.Title>
                {description ? (
                  <BaseAlertDialog.Description className="vc-alert-dialog__description">
                    {description}
                  </BaseAlertDialog.Description>
                ) : null}
              </div>
            </div>
            <div className="vc-alert-dialog__actions">
              <BaseAlertDialog.Close
                render={
                  <Button
                    ref={cancelBtnRef}
                    variant={danger ? 'filled' : 'gray'}
                    disabled={pending}
                  >
                    {cancelLabel}
                  </Button>
                }
              />
              <Button
                variant={danger ? 'danger-soft' : 'filled'}
                pending={pending}
                onClick={() => {
                  onConfirm();
                  onOpenChange(false);
                }}
              >
                {confirmLabel}
              </Button>
            </div>
          </BaseAlertDialog.Popup>
        </PortalNestedScope>
      </BaseAlertDialog.Portal>
    </BaseAlertDialog.Root>
  );
}
