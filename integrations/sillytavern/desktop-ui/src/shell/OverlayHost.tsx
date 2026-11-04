import React, { forwardRef } from 'react';
import { ToastRegion } from '../design/components/Toast';

export interface OverlayHostProps {
  toastRef?: React.Ref<HTMLDivElement>;
  className?: string;
}

/**
 * Single root host container for all Base UI overlays (Dialog, AlertDialog,
 * Menu, Popover, Tooltip, Select) and main-panel-aligned Toast notifications.
 */
export const OverlayHost = forwardRef<HTMLDivElement, OverlayHostProps>(
  function OverlayHost({ toastRef, className }, forwardedRef) {
    const mergedClass = ['vc-overlay-host', className].filter(Boolean).join(' ');
    return (
      <div
        id="vc-overlay-host"
        ref={forwardedRef}
        className={mergedClass}
        data-vc-overlay-host=""
      >
        <div
          ref={toastRef}
          className="vc-overlay-host__toast"
          data-vc-toast-host=""
        />
        <ToastRegion />
      </div>
    );
  },
);
