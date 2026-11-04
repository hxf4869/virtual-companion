import { useEffect, useState } from 'react';
import { Command } from 'cmdk';
import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { PortalNestedScope, usePortalContainer } from '../design/portal-host';
import { Avatar } from '../design/components/Avatar';
import { Icon } from '../design/components/Icon';

export interface QuickSwitchItem {
  key: string;
  title: string;
  preview?: string;
  timeText?: string;
  avatar?: string;
  relationshipId?: string;
  characterId?: string;
}

export interface QuickSwitchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: readonly QuickSwitchItem[];
  onSelect: (item: QuickSwitchItem) => void;
}

export function QuickSwitch({
  open,
  onOpenChange,
  items,
  onSelect,
}: QuickSwitchProps) {
  const [search, setSearch] = useState('');
  const portalContainer = usePortalContainer();

  useEffect(() => {
    if (!open) {
      setSearch('');
    }
  }, [open]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onOpenChange]);

  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      <BaseDialog.Portal container={portalContainer}>
        <PortalNestedScope>
          <BaseDialog.Backdrop className="vc-dialog__backdrop vc-quick-backdrop" />
          <BaseDialog.Popup
            id="vc-quick-switch"
            aria-label="快速切换会话"
            className="vc-dialog vc-quick-dialog"
            data-width={560}
          >
            <Command className="vc-quick-cmdk" label="搜索会话" loop>
              <div className="vc-quick-head">
                <Icon name="search" size={18} />
                <Command.Input
                  autoFocus
                  value={search}
                  onValueChange={setSearch}
                  placeholder="搜索会话"
                  aria-label="搜索会话"
                  className="vc-quick-input"
                />
                <kbd className="vc-quick-kbd">ESC</kbd>
              </div>
              <Command.List className="vc-quick-list">
                <Command.Empty className="vc-quick-empty">没有找到</Command.Empty>
                {items.map((item) => {
                  const searchValue = `${item.title} ${item.preview ?? ''} ${item.key}`;
                  return (
                    <Command.Item
                      key={item.key}
                      value={searchValue}
                      onSelect={() => {
                        onSelect(item);
                        onOpenChange(false);
                      }}
                      className="vc-quick-row"
                      data-conversation-key={item.key}
                      data-relationship-id={item.relationshipId || undefined}
                    >
                      <Avatar src={item.avatar} name={item.title || '伴'} size={36} />
                      <span className="vc-quick-meta">
                        <span className="vc-quick-name">{item.title}</span>
                        {item.preview ? (
                          <span className="vc-quick-preview">{item.preview}</span>
                        ) : null}
                      </span>
                      {item.timeText ? (
                        <span className="vc-quick-time">{item.timeText}</span>
                      ) : null}
                    </Command.Item>
                  );
                })}
              </Command.List>
            </Command>
          </BaseDialog.Popup>
        </PortalNestedScope>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}
