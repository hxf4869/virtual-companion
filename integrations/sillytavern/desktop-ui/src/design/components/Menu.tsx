import React, { ReactElement, ReactNode } from 'react';
import { Menu as BaseMenu } from '@base-ui/react/menu';
import { PortalNestedScope, usePortalContainer } from '../portal-host';
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
  const mergedPopupClassName = ['vc-menu', className].filter(Boolean).join(' ');
  const portalContainer = usePortalContainer();

  return (
    <BaseMenu.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      {React.isValidElement(trigger) ? (
        <BaseMenu.Trigger render={trigger as ReactElement<Record<string, unknown>>} />
      ) : (
        <BaseMenu.Trigger className="vc-menu__trigger">
          {trigger}
        </BaseMenu.Trigger>
      )}
      <BaseMenu.Portal container={portalContainer}>
        <PortalNestedScope>
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
        </PortalNestedScope>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
}
