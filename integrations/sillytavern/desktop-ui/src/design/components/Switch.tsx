import { Switch as BaseSwitch } from '@base-ui/react/switch';
import './Switch.css';

export interface SwitchProps {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  name?: string;
  id?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  className?: string;
}

export function Switch({
  checked,
  defaultChecked,
  onCheckedChange,
  disabled,
  name,
  id,
  className,
  ...rest
}: SwitchProps) {
  const mergedClassName = ['vc-switch', className].filter(Boolean).join(' ');

  return (
    <BaseSwitch.Root
      id={id}
      name={name}
      checked={checked}
      defaultChecked={defaultChecked}
      disabled={disabled}
      onCheckedChange={(nextChecked) => onCheckedChange?.(nextChecked)}
      className={mergedClassName}
      {...rest}
    >
      <span className="vc-switch__track">
        <BaseSwitch.Thumb className="vc-switch__thumb" />
      </span>
    </BaseSwitch.Root>
  );
}
