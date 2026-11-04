import type { SVGProps } from 'react';
import './Spinner.css';

export interface SpinnerProps extends SVGProps<SVGSVGElement> {
  size?: number | string;
  label?: string;
}

export function Spinner({ size = 16, label, className, ...rest }: SpinnerProps) {
  const mergedClassName = ['vc-spinner', className].filter(Boolean).join(' ');

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden={label ? undefined : true}
      aria-label={label || undefined}
      role={label ? 'status' : undefined}
      className={mergedClassName}
      {...rest}
    >
      <circle className="vc-spinner__track" cx="12" cy="12" r="9" />
      <path className="vc-spinner__arc" d="M21 12a9 9 0 0 0-9-9" />
    </svg>
  );
}
