import { type ChangeEvent, type FocusEvent, type TextareaHTMLAttributes, forwardRef } from 'react';
import { Field as BaseField } from '@base-ui/react/field';
import './Textarea.css';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  onValueChange?: (value: string) => void;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  {
    className,
    id,
    name,
    value,
    defaultValue,
    disabled,
    autoFocus,
    onValueChange,
    onChange,
    onFocus,
    onBlur,
    ...rest
  },
  ref,
) {
  const mergedClassName = ['vc-textarea', className].filter(Boolean).join(' ');

  return (
    <BaseField.Control
      ref={ref}
      id={id}
      name={name}
      value={value}
      defaultValue={defaultValue}
      disabled={disabled}
      autoFocus={autoFocus}
      className={mergedClassName}
      onValueChange={onValueChange ? (val) => onValueChange(val) : undefined}
      render={
        <textarea
          {...rest}
          onChange={onChange as ((event: ChangeEvent<HTMLTextAreaElement>) => void) | undefined}
          onFocus={onFocus as ((event: FocusEvent<HTMLTextAreaElement>) => void) | undefined}
          onBlur={onBlur as ((event: FocusEvent<HTMLTextAreaElement>) => void) | undefined}
        />
      }
    />
  );
});
