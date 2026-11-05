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

export const ICON_ALIASES: Readonly<Record<string, string>> = {
  close: 'x',
  send: 'arrow-up',
  stop: 'square',
  edit: 'pencil',
  refresh: 'refresh-cw',
  volume: 'volume-2',
  alert: 'circle-alert',
};

export function resolveIconName(name: string, sprite: string = DEFAULT_SPRITE): string {
  if (sprite !== DEFAULT_SPRITE) return name;
  return ICON_ALIASES[name] ?? name;
}

export function Icon({
  name,
  sprite = DEFAULT_SPRITE,
  size = 18,
  label,
  className = '',
  style,
  ...rest
}: IconProps) {
  const sizePx = typeof size === 'number' ? `${size}px` : size;
  const mergedClassName = ['vc-icon', className].filter(Boolean).join(' ');
  const resolvedName = resolveIconName(name, sprite);

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      aria-hidden={label ? undefined : 'true'}
      aria-label={label || undefined}
      role={label ? 'img' : undefined}
      className={mergedClassName}
      style={{ '--vc-icon-size': sizePx, ...style } as CSSProperties}
      {...rest}
    >
      <use href={`${sprite}#${resolvedName}`} />
    </svg>
  );
}
