import type { ReactElement, ReactNode } from 'react';
import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';
import './Tooltip.css';

export interface TooltipProps {
  content: ReactNode;
  children: ReactElement;
  side?: 'top' | 'bottom' | 'left' | 'right';
  sideOffset?: number;
  className?: string;
}

export function Tooltip({
  content,
  children,
  side = 'top',
  sideOffset = 6,
  className,
}: TooltipProps) {
  const mergedClassName = ['vc-tooltip', className].filter(Boolean).join(' ');

  return (
    <BaseTooltip.Provider delay={300}>
      <BaseTooltip.Root>
        <BaseTooltip.Trigger render={children as ReactElement<Record<string, unknown>>} />
        <BaseTooltip.Portal>
          <BaseTooltip.Positioner side={side} sideOffset={sideOffset} className="vc-tooltip__positioner">
            <BaseTooltip.Popup className={mergedClassName}>{content}</BaseTooltip.Popup>
          </BaseTooltip.Positioner>
        </BaseTooltip.Portal>
      </BaseTooltip.Root>
    </BaseTooltip.Provider>
  );
}
