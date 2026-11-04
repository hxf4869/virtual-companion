import { type ReactNode, useLayoutEffect, useRef } from 'react';
import { AlertDialog as BaseAlertDialog } from '@base-ui/react/alert-dialog';
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
  const openerRef = useRef<HTMLElement | null>(null);
  const cancelBtnRef = useRef<HTMLButtonElement | null>(null);

  useLayoutEffect(() => {
    if (open && typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      if (!document.activeElement.closest('.vc-alert-dialog')) {
        openerRef.current = document.activeElement;
      }
    }
  }, [open]);

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (!nextOpen) {
      const target = openerRef.current;
      if (target && typeof target.focus === 'function') {
        target.focus();
      }
    }
  };

  const mergedClassName = ['vc-alert-dialog', className].filter(Boolean).join(' ');

  return (
    <BaseAlertDialog.Root open={open} onOpenChange={handleOpenChange}>
      <BaseAlertDialog.Portal>
        <BaseAlertDialog.Backdrop className="vc-alert-dialog__backdrop" />
        <BaseAlertDialog.Popup
          initialFocus={cancelBtnRef}
          finalFocus={openerRef}
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
              <Icon name="alert" size={20} />
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
                <Button ref={cancelBtnRef} variant="gray" disabled={pending}>
                  {cancelLabel}
                </Button>
              }
            />
            <Button
              variant={danger ? 'danger' : 'filled'}
              pending={pending}
              onClick={() => {
                onConfirm();
                handleOpenChange(false);
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </BaseAlertDialog.Popup>
      </BaseAlertDialog.Portal>
    </BaseAlertDialog.Root>
  );
}
