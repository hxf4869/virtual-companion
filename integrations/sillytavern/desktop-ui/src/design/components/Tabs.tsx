import type { ReactNode } from 'react';
import { Tabs as BaseTabs } from '@base-ui/react/tabs';
import './Tabs.css';

export interface TabItemDef<T extends string = string> {
  value: T;
  label: ReactNode;
  content?: ReactNode;
  disabled?: boolean;
}

export interface TabsProps<T extends string = string> {
  value?: T;
  defaultValue?: T;
  onValueChange?: (value: T) => void;
  tabs: readonly TabItemDef<T>[];
  className?: string;
}

export function Tabs<T extends string = string>({
  value,
  defaultValue,
  onValueChange,
  tabs,
  className,
}: TabsProps<T>) {
  const mergedClassName = ['vc-tabs', className].filter(Boolean).join(' ');

  return (
    <BaseTabs.Root
      value={value}
      defaultValue={defaultValue ?? tabs[0]?.value}
      onValueChange={(nextValue) => {
        if (typeof nextValue === 'string') {
          onValueChange?.(nextValue as T);
        }
      }}
      className={mergedClassName}
    >
      <BaseTabs.List className="vc-tabs__list">
        {tabs.map((tab) => (
          <BaseTabs.Tab
            key={tab.value}
            value={tab.value}
            disabled={tab.disabled}
            className="vc-tabs__tab"
          >
            {tab.label}
          </BaseTabs.Tab>
        ))}
        <BaseTabs.Indicator className="vc-tabs__indicator" />
      </BaseTabs.List>
      {tabs.map((tab) =>
        tab.content !== undefined ? (
          <BaseTabs.Panel key={tab.value} value={tab.value} className="vc-tabs__panel">
            {tab.content}
          </BaseTabs.Panel>
        ) : null,
      )}
    </BaseTabs.Root>
  );
}
