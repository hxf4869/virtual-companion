import React, { type ReactNode, Suspense, useCallback } from 'react';
import './settings.css';
import './model-settings.css';
import { IconButton } from '../../design/components/IconButton';
import { Menu, type MenuItemDef } from '../../design/components/Menu';
import { AccountSection } from './AccountSection';
import {
  AppearanceSection,
  type AppearancePreferencesBinding,
} from './AppearanceSection';
import { CompanionStyle } from './CompanionStyle';
import { DataSection } from './DataSection';
import { ModelSection } from './ModelSection';
import {
  DEFAULT_TAVERN_CATEGORIES,
  PRODUCT_SETTINGS_CATEGORIES,
  SettingsNav,
  type ProductSettingsCategory,
} from './SettingsNav';
import { StickerSettings } from './StickerSettings';
import { VoiceSection } from './VoiceSection';
import {
  useSettingsForm,
  type SettingsConflictState,
  type SettingsFormMutationLike,
  type SettingsFormQueryLike,
  type UseSettingsFormConfig,
  type UseSettingsFormOptions,
  type UseSettingsFormReturn,
} from './useSettingsForm';

export {
  useSettingsForm,
  PRODUCT_SETTINGS_CATEGORIES,
  DEFAULT_TAVERN_CATEGORIES,
  SettingsNav,
  type ProductSettingsCategory,
  type SettingsConflictState,
  type SettingsFormMutationLike,
  type SettingsFormQueryLike,
  type UseSettingsFormConfig,
  type UseSettingsFormOptions,
  type UseSettingsFormReturn,
};

const NotificationSectionLazy = React.lazy(() => import('./NotificationSection'));

export interface SettingsLeaveGuardState {
  dirty: boolean;
  busy?: boolean;
}

export type RenderSettingsLeaveGuard = (state: SettingsLeaveGuardState) => ReactNode;

export interface SettingsRouteProps {
  category?: string;
  relationshipId?: string;
  onSelectCategory: (
    category: ProductSettingsCategory,
    options?: { relationshipId?: string },
  ) => void;
  onSelectTavern: (section: string) => void;
  onOpenInbox: () => void;
  preferences: AppearancePreferencesBinding;
  renderLeaveGuard?: RenderSettingsLeaveGuard;
  onNavigateAuth?: (url: string) => void;
}

function normalizeCategory(raw?: string): ProductSettingsCategory {
  const clean = String(raw || 'account').trim().toLowerCase();
  const matched = PRODUCT_SETTINGS_CATEGORIES.find((item) => item.key === clean);
  return matched ? matched.key : 'account';
}

export function SettingsRoute({
  category = 'account',
  relationshipId,
  onSelectCategory,
  onSelectTavern,
  onOpenInbox,
  preferences,
  renderLeaveGuard,
  onNavigateAuth,
}: SettingsRouteProps) {
  const activeCategory = normalizeCategory(category);
  const activeMeta =
    PRODUCT_SETTINGS_CATEGORIES.find((item) => item.key === activeCategory) ??
    PRODUCT_SETTINGS_CATEGORIES[0];

  const handleSelectCategory = useCallback(
    (nextCategory: string) => {
      const normalized = normalizeCategory(nextCategory);
      onSelectCategory(normalized);
    },
    [onSelectCategory],
  );

  const handleSelectTavern = useCallback(
    (section: string) => {
      onSelectTavern(section);
    },
    [onSelectTavern],
  );

  const categoryMenuItems: MenuItemDef[] = [
    ...PRODUCT_SETTINGS_CATEGORIES.map((item) => ({
      id: `cat-${item.key}`,
      label: item.label,
      onSelect: () => handleSelectCategory(item.key),
    })),
    ...DEFAULT_TAVERN_CATEGORIES.map((item, index) => ({
      id: `tavern-${item.panel}`,
      label: item.label,
      separator: index === 0,
      onSelect: () => handleSelectTavern(item.panel),
    })),
  ];

  const renderSection = () => {
    switch (activeCategory) {
      case 'account':
        return <AccountSection onNavigateAuth={onNavigateAuth} />;
      case 'model':
        return <ModelSection renderLeaveGuard={renderLeaveGuard} />;
      case 'voice':
        return (
          <VoiceSection
            key={relationshipId ?? 'global'}
            relationshipId={relationshipId}
            renderLeaveGuard={renderLeaveGuard}
          />
        );
      case 'notifications':
        return (
          <Suspense fallback={null}>
            <NotificationSectionLazy onOpenInbox={onOpenInbox} />
          </Suspense>
        );
      case 'appearance':
        return <AppearanceSection preferences={preferences} />;
      case 'companion':
        return <CompanionStyle renderLeaveGuard={renderLeaveGuard} />;
      case 'stickers':
        return <StickerSettings />;
      case 'data':
        return <DataSection onNavigateAuth={onNavigateAuth} />;
      default:
        return <AccountSection onNavigateAuth={onNavigateAuth} />;
    }
  };

  return (
    <div className="vc-settings-shell" data-vc-settings="" data-category={activeCategory}>
      <SettingsNav
        current={activeCategory}
        onSelectCategory={handleSelectCategory}
        onSelectTavern={handleSelectTavern}
      />
      <div className="vc-settings-detail" data-vc-settings-category={activeCategory}>
        <header className="vc-settings-detail-head">
          <span className="vc-settings-category-control">
            <Menu
              items={categoryMenuItems}
              trigger={<IconButton icon="settings" aria-label="设置" data-settings-categories="" />}
            />
          </span>
          <h1 className="vc-settings-detail-title" data-vc-owned-title="">
            {activeMeta.label}
          </h1>
        </header>
        <div className="vc-settings-detail-body">{renderSection()}</div>
      </div>
    </div>
  );
}

export default SettingsRoute;
