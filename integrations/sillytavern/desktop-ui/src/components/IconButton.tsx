import { Button } from '@base-ui/react/button';
import { Icon } from './Icon';

export function IconButton({ sprite, icon, label, className = '', ...props }: Omit<Button.Props, 'children' | 'className'> & {
    sprite: string; icon: string; label: string; className?: string;
}) {
    return <Button type="button" className={`vc-circle vc-icon-button ${className}`} aria-label={label} {...props}>
        <Icon sprite={sprite} name={icon} />
    </Button>;
}
