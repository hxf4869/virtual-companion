import type { HTMLAttributes, ReactNode } from 'react';
import { ScrollArea as BaseScrollArea } from '@base-ui/react/scroll-area';
import './ScrollArea.css';

export interface ScrollAreaProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  viewportClassName?: string;
}

export function ScrollArea({
  children,
  className,
  viewportClassName,
  ...rest
}: ScrollAreaProps) {
  const mergedRootClassName = ['vc-scroll-area', className].filter(Boolean).join(' ');
  const mergedViewportClassName = ['vc-scroll-area__viewport', viewportClassName]
    .filter(Boolean)
    .join(' ');

  return (
    <BaseScrollArea.Root className={mergedRootClassName} {...rest}>
      <BaseScrollArea.Viewport className={mergedViewportClassName}>
        <BaseScrollArea.Content className="vc-scroll-area__content">
          {children}
        </BaseScrollArea.Content>
      </BaseScrollArea.Viewport>
      <BaseScrollArea.Scrollbar orientation="vertical" className="vc-scroll-area__scrollbar">
        <BaseScrollArea.Thumb className="vc-scroll-area__thumb" />
      </BaseScrollArea.Scrollbar>
    </BaseScrollArea.Root>
  );
}
