import type { ReactNode } from 'react';
import { Select as BaseSelect } from '@base-ui/react/select';
import { Icon } from './Icon';
import './Select.css';

export interface SelectOption<T extends string = string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}

export interface SelectProps<T extends string = string> {
  value?: T;
  defaultValue?: T;
  onValueChange?: (value: T) => void;
  options: readonly SelectOption<T>[];
  placeholder?: string;
  disabled?: boolean;
  'aria-label'?: string;
  className?: string;
}

export function Select<T extends string = string>({
  value,
  defaultValue,
  onValueChange,
  options,
  placeholder,
  disabled,
  'aria-label': ariaLabel,
  className,
}: SelectProps<T>) {
  const mergedClassName = ['vc-select', className].filter(Boolean).join(' ');
  const items = options.map((opt) => ({ value: opt.value, label: opt.label }));

  return (
    <BaseSelect.Root
      value={value}
      defaultValue={defaultValue}
      disabled={disabled}
      items={items}
      onValueChange={(nextValue) => {
        if (typeof nextValue === 'string') {
          onValueChange?.(nextValue as T);
        }
      }}
    >
      <BaseSelect.Trigger aria-label={ariaLabel} className={mergedClassName}>
        <BaseSelect.Value className="vc-select__value" placeholder={placeholder} />
        <BaseSelect.Icon className="vc-select__icon">
          <Icon name="chevron-down" size={16} />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner sideOffset={6} className="vc-select__positioner">
          <BaseSelect.Popup className="vc-select__popup">
            <BaseSelect.List className="vc-select__list">
              {options.map((opt) => (
                <BaseSelect.Item
                  key={opt.value}
                  value={opt.value}
                  disabled={opt.disabled}
                  className="vc-select__item"
                >
                  <BaseSelect.ItemIndicator className="vc-select__item-indicator">
                    <Icon name="check" size={14} />
                  </BaseSelect.ItemIndicator>
                  <BaseSelect.ItemText className="vc-select__item-text">
                    {opt.label}
                  </BaseSelect.ItemText>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
