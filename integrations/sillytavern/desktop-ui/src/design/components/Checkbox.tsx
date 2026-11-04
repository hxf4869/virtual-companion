import type { ReactNode } from 'react';
import { Checkbox as BaseCheckbox } from '@base-ui/react/checkbox';
import { Icon } from './Icon';
import './Checkbox.css';

export interface CheckboxProps {
  checked?: boolean;
  defaultChecked?: boolean;
  indeterminate?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  name?: string;
  label?: ReactNode;
  'aria-label'?: string;
  className?: string;
}

export function Checkbox({
  checked,
  defaultChecked,
  indeterminate,
  onCheckedChange,
  disabled,
  name,
  label,
  className,
  ...rest
}: CheckboxProps) {
  const mergedClassName = ['vc-checkbox', className].filter(Boolean).join(' ');

  const control = (
    <BaseCheckbox.Root
      name={name}
      checked={checked}
      defaultChecked={defaultChecked}
      indeterminate={indeterminate}
      disabled={disabled}
      onCheckedChange={(next) => onCheckedChange?.(next)}
      className={label ? 'vc-checkbox__box' : `${mergedClassName} vc-checkbox__box`}
      {...rest}
    >
      <BaseCheckbox.Indicator className="vc-checkbox__indicator">
        <Icon name="check" size={12} />
      </BaseCheckbox.Indicator>
    </BaseCheckbox.Root>
  );

  if (!label) {
    return control;
  }

  return (
    <label className={mergedClassName}>
      {control}
      <span className="vc-checkbox__label">{label}</span>
    </label>
  );
}
