import React, { ReactElement, ReactNode } from 'react';
import { Popover as BasePopover } from '@base-ui/react/popover';
import { PortalNestedScope, usePortalContainer } from '../portal-host';
import './Popover.css';

export interface PopoverProps {
  trigger: ReactElement | ReactNode;
  children: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
  className?: string;
}

export function Popover({
  trigger,
  children,
  open,
  defaultOpen,
  onOpenChange,
  side = 'bottom',
  align = 'center',
  sideOffset = 8,
  className,
}: PopoverProps) {
  const mergedClassName = ['vc-popover', className].filter(Boolean).join(' ');
  const portalContainer = usePortalContainer();

  return (
    <BasePopover.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      {React.isValidElement(trigger) ? (
        <BasePopover.Trigger render={trigger as ReactElement<Record<string, unknown>>} />
      ) : (
        <BasePopover.Trigger className="vc-popover__trigger">{trigger}</BasePopover.Trigger>
      )}
      <BasePopover.Portal container={portalContainer}>
        <PortalNestedScope>
          <BasePopover.Positioner side={side} align={align} sideOffset={sideOffset} className="vc-popover__positioner">
            <BasePopover.Popup className={mergedClassName}>{children}</BasePopover.Popup>
          </BasePopover.Positioner>
        </PortalNestedScope>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
}
