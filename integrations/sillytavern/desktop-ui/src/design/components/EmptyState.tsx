import type { HTMLAttributes } from 'react';
import { Button } from './Button';
import { Icon, IconName } from './Icon';
import './EmptyState.css';

export interface EmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  icon: IconName;
  title: string;
  actionLabel?: string;
  actionIcon?: IconName;
  onAction?: () => void;
}

export function EmptyState({
  icon,
  title,
  actionLabel,
  actionIcon,
  onAction,
  className,
  ...rest
}: EmptyStateProps) {
  const mergedClassName = ['vc-empty-state', className].filter(Boolean).join(' ');

  return (
    <div className={mergedClassName} {...rest}>
      <div className="vc-empty-state__icon-box" aria-hidden="true">
        <Icon name={icon} size={22} />
      </div>
      <h3 className="vc-empty-state__title">{title}</h3>
      {actionLabel && onAction ? (
        <Button variant="gray" onClick={onAction} className="vc-empty-state__action">
          {actionIcon ? <Icon name={actionIcon} size={16} /> : null}
          <span>{actionLabel}</span>
        </Button>
      ) : null}
    </div>
  );
}
