import React from 'react';
import { useBlocker } from '@tanstack/react-router';
import { AlertDialog } from '../design/components/AlertDialog';

export interface LeaveGuardOptions {
  title?: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
}

/**
 * Route leave guard powered by TanStack Router's `useBlocker` and T3 `AlertDialog`.
 * Uses canonical copy from `2026-10-30-companion-copy.md`:
 * Title: `放弃更改？`, Description: `关闭后本次输入将丢失。`,
 * Cancel (default focus): `继续编辑`, Confirm (danger): `放弃`.
 */
export function useLeaveGuard(
  dirty: boolean,
  messageOrOptions?: string | LeaveGuardOptions,
): React.ReactNode {
  const opts: LeaveGuardOptions =
    typeof messageOrOptions === 'string'
      ? { description: messageOrOptions }
      : messageOrOptions ?? {};

  const shouldBlock = Boolean(dirty || opts.busy);

  const blocker = useBlocker({
    shouldBlockFn: () => shouldBlock,
    enableBeforeUnload: shouldBlock,
    withResolver: true,
  });

  React.useEffect(() => {
    if (opts.busy && blocker.status === 'blocked') {
      blocker.reset?.();
    }
  }, [opts.busy, blocker]);

  const title = opts.title ?? '放弃更改？';
  const description = opts.description ?? '关闭后本次输入将丢失。';
  const confirmLabel = opts.confirmLabel ?? '放弃';
  const cancelLabel = opts.cancelLabel ?? '继续编辑';

  const isBlocked = blocker.status === 'blocked' && !opts.busy;

  return React.createElement(AlertDialog, {
    open: isBlocked,
    onOpenChange: (open: boolean) => {
      if (!open && blocker.status === 'blocked') {
        blocker.reset?.();
      }
    },
    title,
    description,
    confirmLabel,
    cancelLabel,
    danger: true,
    onConfirm: () => {
      if (blocker.status === 'blocked') {
        blocker.proceed?.();
      }
    },
  });
}
