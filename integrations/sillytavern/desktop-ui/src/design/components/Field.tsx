import type { ReactNode } from 'react';
import { Field as BaseField } from '@base-ui/react/field';
import './Field.css';

export interface FieldProps {
  label?: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  invalid?: boolean;
  disabled?: boolean;
  name?: string;
  className?: string;
  children: ReactNode;
}

export function Field({
  label,
  description,
  error,
  invalid,
  disabled,
  name,
  className,
  children,
}: FieldProps) {
  const isInvalid = invalid ?? Boolean(error);
  const mergedClassName = ['vc-field', className].filter(Boolean).join(' ');

  return (
    <BaseField.Root
      name={name}
      invalid={isInvalid}
      disabled={disabled}
      className={mergedClassName}
    >
      <div className="vc-field__row">
        {label ? (
          <div className="vc-field__label-col">
            <BaseField.Label className="vc-field__label">{label}</BaseField.Label>
            {description ? (
              <BaseField.Description className="vc-field__description">
                {description}
              </BaseField.Description>
            ) : null}
          </div>
        ) : null}
        <div className="vc-field__control-col">
          {children}
          {error ? (
            <BaseField.Error match={true} className="vc-field__error">
              {error}
            </BaseField.Error>
          ) : null}
        </div>
      </div>
    </BaseField.Root>
  );
}
