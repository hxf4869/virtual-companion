import { type ReactNode } from 'react';
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
  const mergedClassName = ['vc-dialog', className].filter(Boolean).join(' ');

  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="vc-dialog__backdrop" />
        <BaseDialog.Popup
          data-width={width}
          className={mergedClassName}
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
