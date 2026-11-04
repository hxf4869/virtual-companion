import { type TextareaHTMLAttributes, forwardRef } from 'react';
import './Textarea.css';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  onValueChange?: (value: string) => void;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, onValueChange, onChange, ...rest },
  ref,
) {
  const mergedClassName = ['vc-textarea', className].filter(Boolean).join(' ');

  return (
    <textarea
      ref={ref}
      className={mergedClassName}
      onChange={(event) => {
        onChange?.(event);
        onValueChange?.(event.target.value);
      }}
      {...rest}
    />
  );
});
