import { Switch as SwitchPrimitive } from '@base-ui/react/switch';

interface SwitchProps extends Omit<SwitchPrimitive.Root.Props, 'render' | 'children' | 'className' | 'checked' | 'defaultChecked' | 'onCheckedChange'> {
    label: string;
    preference?: string;
    action?: string;
    disabled?: boolean;
    className?: string;
    thumbClassName?: string;
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
}

// Base UI 管理键盘与状态，既有 .vc-switch 管理全部可见皮肤。
export function Switch({ label, preference, action, disabled, className = 'vc-switch', thumbClassName, checked, onCheckedChange, ...props }: SwitchProps) {
    return <SwitchPrimitive.Root {...props} nativeButton render={<button type="button" />} className={className} aria-label={label}
        data-preference={preference} data-action={action} disabled={disabled} aria-disabled={disabled || undefined} checked={checked} onCheckedChange={onCheckedChange}>
        <SwitchPrimitive.Thumb className={thumbClassName} />
    </SwitchPrimitive.Root>;
}
