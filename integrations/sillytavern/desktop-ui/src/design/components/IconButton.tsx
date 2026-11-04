import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { Icon, IconName } from './Icon';
import './IconButton.css';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  'aria-label': string;
  size?: number;
  iconSize?: number;
  active?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, size = 40, iconSize = 20, active = false, type = 'button', className, style, children, ...rest },
  ref,
) {
  const mergedClassName = ['vc-icon-button', active ? 'vc-icon-button--active' : '', className]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      ref={ref}
      type={type}
      className={mergedClassName}
      style={{ width: `${size}px`, height: `${size}px`, ...style }}
      {...rest}
    >
      <Icon name={icon} size={iconSize} />
      {children}
    </button>
  );
});
