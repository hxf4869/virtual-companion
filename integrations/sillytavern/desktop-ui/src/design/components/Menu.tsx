import React, { ReactElement, ReactNode, useRef } from 'react';
import { Menu as BaseMenu } from '@base-ui/react/menu';
import { Icon, IconName } from './Icon';
import './Menu.css';

export interface MenuItemDef {
  id: string;
  label: ReactNode;
  icon?: IconName;
  danger?: boolean;
  separator?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
}

export interface MenuProps {
  trigger: ReactElement | ReactNode;
  items: readonly MenuItemDef[];
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
  className?: string;
}

export function Menu({
  trigger,
  items,
  open,
  defaultOpen,
  onOpenChange,
  align = 'end',
  sideOffset = 6,
  className,
}: MenuProps) {
  const triggerRef = useRef<HTMLElement | null>(null);
  const mergedPopupClassName = ['vc-menu', className].filter(Boolean).join(' ');

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen && typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      triggerRef.current = document.activeElement;
    }
    onOpenChange?.(nextOpen);
    if (!nextOpen) {
      const target = triggerRef.current;
      if (target && typeof target.focus === 'function') {
        target.focus();
      }
    }
  };

  return (
    <BaseMenu.Root open={open} defaultOpen={defaultOpen} onOpenChange={handleOpenChange}>
      {React.isValidElement(trigger) ? (
        <BaseMenu.Trigger ref={triggerRef as React.Ref<HTMLButtonElement>} render={trigger as ReactElement<Record<string, unknown>>} />
      ) : (
        <BaseMenu.Trigger ref={triggerRef as React.Ref<HTMLButtonElement>} className="vc-menu__trigger">
          {trigger}
        </BaseMenu.Trigger>
      )}
      <BaseMenu.Portal>
        <BaseMenu.Positioner align={align} sideOffset={sideOffset} className="vc-menu__positioner">
          <BaseMenu.Popup className={mergedPopupClassName}>
            {items.map((item) => (
              <React.Fragment key={item.id}>
                {item.separator ? <BaseMenu.Separator className="vc-menu__separator" /> : null}
                <BaseMenu.Item
                  disabled={item.disabled}
                  onClick={() => item.onSelect?.()}
                  className={[
                    'vc-menu__item',
                    item.danger ? 'vc-menu__item--danger' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {item.icon ? (
                    <span className="vc-menu__item-icon" aria-hidden="true">
                      <Icon name={item.icon} size={16} />
                    </span>
                  ) : null}
                  <span className="vc-menu__item-label">{item.label}</span>
                </BaseMenu.Item>
              </React.Fragment>
            ))}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
}
