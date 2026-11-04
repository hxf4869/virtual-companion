import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import './settings.css';
import './model-settings.css';
import { IconButton } from '../../design/components/IconButton';
import { Menu, type MenuItemDef } from '../../design/components/Menu';
import { AccountSection } from './AccountSection';
import { AppearanceSection } from './AppearanceSection';
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

export interface SettingsRouteProps {
  category?: string;
}

function normalizeCategory(raw?: string): ProductSettingsCategory {
  const clean = String(raw || 'account').trim().toLowerCase();
  const matched = PRODUCT_SETTINGS_CATEGORIES.find((item) => item.key === clean);
  return matched ? matched.key : 'account';
}

export function SettingsRoute({ category = 'account' }: SettingsRouteProps = {}) {
  const router = useRouter({ warn: false });
  const [localCategory, setLocalCategory] = useState<ProductSettingsCategory>(() =>
    normalizeCategory(category),
  );

  useEffect(() => {
    setLocalCategory(normalizeCategory(category));
  }, [category]);

  const activeCategory = router ? normalizeCategory(category) : localCategory;
  const activeMeta =
    PRODUCT_SETTINGS_CATEGORIES.find((item) => item.key === activeCategory) ??
    PRODUCT_SETTINGS_CATEGORIES[0];

  const handleSelectCategory = useCallback(
    (nextCategory: string) => {
      const normalized = normalizeCategory(nextCategory);
      if (router) {
        void router.navigate({
          to: '/settings/$category',
          params: { category: normalized },
        });
      } else {
        setLocalCategory(normalized);
      }
    },
    [router],
  );

  const handleSelectTavern = useCallback(
    (section: string) => {
      if (router) {
        void router.navigate({
          to: '/settings/tavern/$section',
          params: { section },
        });
      }
    },
    [router],
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
        return <AccountSection />;
      case 'model':
        return <ModelSection />;
      case 'voice':
        return <VoiceSection />;
      case 'notifications':
        return (
          <Suspense fallback={null}>
            <NotificationSectionLazy />
          </Suspense>
        );
      case 'appearance':
        return <AppearanceSection />;
      case 'companion':
        return <CompanionStyle />;
      case 'stickers':
        return <StickerSettings />;
      case 'data':
        return <DataSection />;
      default:
        return <AccountSection />;
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
