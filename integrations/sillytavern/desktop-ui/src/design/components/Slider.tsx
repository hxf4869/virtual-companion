import { Slider as BaseSlider } from '@base-ui/react/slider';
import './Slider.css';

export interface SliderProps {
  value?: number;
  defaultValue?: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  onValueChange?: (value: number) => void;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  className?: string;
}

export function Slider({
  value,
  defaultValue,
  min = 0,
  max = 100,
  step = 1,
  disabled,
  onValueChange,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  className,
}: SliderProps) {
  const mergedClassName = ['vc-slider', className].filter(Boolean).join(' ');

  return (
    <BaseSlider.Root
      value={value}
      defaultValue={defaultValue}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      onValueChange={(nextValue) => {
        const numeric = Array.isArray(nextValue) ? nextValue[0] : nextValue;
        if (typeof numeric === 'number') {
          onValueChange?.(numeric);
        }
      }}
      className={mergedClassName}
    >
      <BaseSlider.Control className="vc-slider__control">
        <BaseSlider.Track className="vc-slider__track">
          <BaseSlider.Indicator className="vc-slider__indicator" />
          <BaseSlider.Thumb aria-label={ariaLabel} className="vc-slider__thumb" />
        </BaseSlider.Track>
      </BaseSlider.Control>
    </BaseSlider.Root>
  );
}
