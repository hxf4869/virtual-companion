import { type ButtonHTMLAttributes, forwardRef, useLayoutEffect, useRef, useState } from 'react';
import { Spinner } from './Spinner';
import './Button.css';

export type ButtonVariant = 'filled' | 'gray' | 'danger' | 'text';
export type ButtonSize = 'md' | 'sm';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  pending?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'gray',
    size = 'md',
    pending = false,
    disabled = false,
    type = 'button',
    className,
    style,
    children,
    ...rest
  },
  forwardedRef,
) {
  const innerRef = useRef<HTMLButtonElement | null>(null);
  const measuredWidthRef = useRef<number | null>(null);
  const [lockedWidth, setLockedWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    if (!pending) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0) {
        measuredWidthRef.current = rect.width;
      }
      setLockedWidth(null);
      return;
    }
    const widthToKeep = measuredWidthRef.current ?? el.getBoundingClientRect().width;
    if (widthToKeep > 0) {
      setLockedWidth(widthToKeep);
    }
  }, [pending, children]);

  const setRefs = (node: HTMLButtonElement | null) => {
    innerRef.current = node;
    if (node && !pending) {
      const rect = node.getBoundingClientRect();
      if (rect.width > 0) {
        measuredWidthRef.current = rect.width;
      }
    }
    if (typeof forwardedRef === 'function') {
      forwardedRef(node);
    } else if (forwardedRef) {
      forwardedRef.current = node;
    }
  };

  const mergedClassName = [
    'vc-btn',
    `vc-btn--${variant}`,
    `vc-btn--${size}`,
    pending ? 'vc-btn--pending' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const mergedStyle =
    pending && lockedWidth !== null ? { ...style, width: `${lockedWidth}px` } : style;

  return (
    <button
      ref={setRefs}
      type={type}
      disabled={disabled || pending}
      aria-busy={pending ? 'true' : undefined}
      className={mergedClassName}
      style={mergedStyle}
      {...rest}
    >
      {pending ? <Spinner size={16} /> : children}
    </button>
  );
});
