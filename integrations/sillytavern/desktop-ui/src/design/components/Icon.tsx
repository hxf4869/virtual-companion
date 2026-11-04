import type { CSSProperties, SVGProps } from 'react';
import './Icon.css';

export type IconName = string;

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  sprite?: string;
  size?: number | string;
  label?: string;
}

const DEFAULT_SPRITE = '/scripts/extensions/third-party/vc-model-settings/ui/icons/lucide.svg';

export function Icon({
  name,
  sprite = DEFAULT_SPRITE,
  size = 18,
  label,
  className,
  style,
  ...rest
}: IconProps) {
  const mergedClassName = ['vc-icon', className].filter(Boolean).join(' ');
  const sizePx = typeof size === 'number' ? `${size}px` : size;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : 'true'}
      aria-label={label || undefined}
      role={label ? 'img' : undefined}
      className={mergedClassName}
      style={{ '--vc-icon-size': sizePx, ...style } as CSSProperties}
      {...rest}
    >
      <use href={`${sprite}#${name}`} />
    </svg>
  );
}
