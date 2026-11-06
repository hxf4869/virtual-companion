import { Icon as DesignIcon } from '../../design/components/Icon';

export type MobileIconName =
  | 'message-circle'
  | 'user-round'
  | 'book-open'
  | 'heart'
  | 'clapperboard'
  | 'chevron-left'
  | 'chevron-right'
  | string;

export interface MobileIconProps {
  name: MobileIconName;
  size?: number;
  className?: string;
}

export function MobileIcon({ name, size = 24, className = '' }: MobileIconProps) {
  const classes = ['vc-mobile-icon', className].filter(Boolean).join(' ');
  return <DesignIcon name={name} size={size} className={classes} />;
}
