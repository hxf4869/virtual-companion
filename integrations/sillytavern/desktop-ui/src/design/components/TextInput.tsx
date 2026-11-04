import { type InputHTMLAttributes, forwardRef } from 'react';
import { Input as BaseInput } from '@base-ui/react/input';
import './TextInput.css';

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  onValueChange?: (value: string) => void;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { type = 'text', className, onValueChange, onChange, ...rest },
  ref,
) {
  const mergedClassName = [
    'vc-text-input',
    type === 'number' ? 'vc-text-input--number' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <BaseInput
      ref={ref}
      type={type}
      className={mergedClassName}
      onChange={(event) => {
        onChange?.(event);
        onValueChange?.(event.target.value);
      }}
      {...rest}
    />
  );
});
