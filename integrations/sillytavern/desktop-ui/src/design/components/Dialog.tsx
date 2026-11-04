import { type ReactNode, useEffect, useRef } from 'react';
import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { IconButton } from './IconButton';
import './Dialog.css';

export type DialogWidth = 420 | 560 | 720 | 760;

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  width?: DialogWidth;
  showCloseButton?: boolean;
  className?: string;
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  actions,
  width = 560,
  showCloseButton = true,
  className,
}: DialogProps) {
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open && typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      openerRef.current = document.activeElement;
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

  const mergedClassName = ['vc-dialog', className].filter(Boolean).join(' ');

  return (
    <BaseDialog.Root open={open} onOpenChange={handleOpenChange}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="vc-dialog__backdrop" />
        <BaseDialog.Popup
          data-width={width}
          finalFocus={openerRef}
          className={mergedClassName}
          style={{ width: `min(${width}px, calc(100vw - 32px))` }}
        >
          <div className="vc-dialog__header">
            <div className="vc-dialog__titles">
              <BaseDialog.Title className="vc-dialog__title">{title}</BaseDialog.Title>
              {description ? (
                <BaseDialog.Description className="vc-dialog__description">
                  {description}
                </BaseDialog.Description>
              ) : null}
            </div>
            {showCloseButton ? (
              <BaseDialog.Close
                render={<IconButton icon="close" size={32} iconSize={16} aria-label="关闭弹窗" />}
              />
            ) : null}
          </div>
          <div className="vc-dialog__body">{children}</div>
          {actions ? <div className="vc-dialog__footer">{actions}</div> : null}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}
