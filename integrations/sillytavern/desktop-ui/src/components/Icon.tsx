import type { CSSProperties } from 'react';

export function Icon({ sprite, name, size = 22 }: { sprite: string; name: string; size?: number }) {
    return <svg className="vc-icon" style={{ '--vc-icon-size': `${size}px` } as CSSProperties}
        width={size} height={size} aria-hidden="true"><use href={`${sprite}#${name}`} /></svg>;
}
