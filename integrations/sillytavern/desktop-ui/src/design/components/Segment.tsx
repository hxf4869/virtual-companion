import type { ReactNode } from 'react';
import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import './Segment.css';

export interface SegmentOption<T extends string = string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}

export interface SegmentProps<T extends string = string> {
  value?: T;
  defaultValue?: T;
  onValueChange?: (value: T) => void;
  options: readonly SegmentOption<T>[];
  disabled?: boolean;
  'aria-label'?: string;
  className?: string;
}

export function Segment<T extends string = string>({
  value,
  defaultValue,
  onValueChange,
  options,
  disabled,
  'aria-label': ariaLabel,
  className,
}: SegmentProps<T>) {
  const mergedClassName = ['vc-segment', className].filter(Boolean).join(' ');

  return (
    <RadioGroup
      value={value}
      defaultValue={defaultValue}
      disabled={disabled}
      aria-label={ariaLabel}
      onValueChange={(nextValue) => {
        if (typeof nextValue === 'string') {
          onValueChange?.(nextValue as T);
        }
      }}
      className={mergedClassName}
    >
      {options.map((opt) => (
        <Radio.Root
          key={opt.value}
          value={opt.value}
          disabled={opt.disabled}
          className="vc-segment__item"
        >
          <span className="vc-segment__label">{opt.label}</span>
        </Radio.Root>
      ))}
    </RadioGroup>
  );
}
