import type { HTMLAttributes } from 'react';
import { Avatar as BaseAvatar } from '@base-ui/react/avatar';
import './Avatar.css';

export interface AvatarProps extends HTMLAttributes<HTMLSpanElement> {
  src?: string | null;
  name?: string;
  alt?: string;
  size?: number;
  glow?: boolean;
}

export function Avatar({ src, name = '', alt, size = 36, glow = false, className, style, ...rest }: AvatarProps) {
  const initial = Array.from((name || alt || '?').trim())[0]?.toUpperCase() || '?';
  const mergedClassName = ['vc-avatar', glow ? 'vc-avatar--glow' : '', className].filter(Boolean).join(' ');

  return (
    <BaseAvatar.Root
      className={mergedClassName}
      style={{ width: `${size}px`, height: `${size}px`, ...style }}
      {...rest}
    >
      {src ? <BaseAvatar.Image className="vc-avatar__image" src={src} alt={alt || name} /> : null}
      <BaseAvatar.Fallback className="vc-avatar__fallback">{initial}</BaseAvatar.Fallback>
    </BaseAvatar.Root>
  );
}
