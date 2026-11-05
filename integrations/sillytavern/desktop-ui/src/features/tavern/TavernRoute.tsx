import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import { Icon } from '../../design/components/Icon';
import { IconButton } from '../../design/components/IconButton';
import { Menu, type MenuItemDef } from '../../design/components/Menu';
import {
  TAVERN_SECTIONS,
  normalizeTavernSection,
  useTavernController,
} from '../../data/queries/tavern';
import { useLeaveGuard } from '../../shell/useLeaveGuard';
import {
  PRODUCT_SETTINGS_CATEGORIES,
  SettingsNav,
} from '../settings/SettingsNav';
import { ApiConnection } from './ApiConnection';
import { Backgrounds } from './Backgrounds';
import { CharacterCard } from './CharacterCard';
import { Extensions } from './Extensions';
import { InterfacePrefs } from './InterfacePrefs';
import { Personas } from './Personas';
import { ReplyConfig } from './ReplyConfig';
import { WorldInfo } from './WorldInfo';
import '../settings/settings.css';
import './tavern.css';

const Formatting = lazy(() =>
  import('./Formatting').then((mod) => ({ default: mod.Formatting })),
);

function ActiveLeaveGuard({ dirty }: { dirty: boolean }) {
  const modal = useLeaveGuard(dirty);
  return <>{modal}</>;
}

export interface TavernRouteProps {
  section?: string;
  initialCharacter?: string;
  embedded?: boolean;
  onNavigateCategory?: (category: string) => void;
  onNavigateTavern?: (section: string) => void;
}

export function TavernRoute({
  section = 'left-nav-panel',
  initialCharacter,
  embedded = false,
  onNavigateCategory,
  onNavigateTavern,
}: TavernRouteProps) {
  const [activeSection, setActiveSection] = useState(() => normalizeTavernSection(section));

  useEffect(() => {
    setActiveSection(normalizeTavernSection(section));
  }, [section]);

  const navigateToCategory = useCallback(
    (category: string) => {
      if (onNavigateCategory) {
        onNavigateCategory(category);
        return;
      }
      if (typeof window !== 'undefined') {
        window.location.hash = `#/settings/${category}`;
      }
    },
    [onNavigateCategory],
  );

  const controller = useTavernController(activeSection, {
    initialCharacter,
    onOpenModels: () => navigateToCategory('model'),
    onOpenAppearance: () => navigateToCategory('appearance'),
  });

  let hasRouter = false;
  try {
    hasRouter = Boolean(useRouter({ warn: false } as any));
  } catch {
    hasRouter = false;
  }
  const leaveGuardModal = hasRouter ? <ActiveLeaveGuard dirty={controller.dirty} /> : null;

  const handleSelectTavern = useCallback(
    async (panelKey: string) => {
      const normalized = normalizeTavernSection(panelKey);
      if (normalized === controller.sectionKey) return;
      if (controller.busy) return;
      if (controller.dirty) {
        const discarded = await controller.discard();
        if (!discarded) return;
      }
      setActiveSection(normalized);
      if (onNavigateTavern) {
        onNavigateTavern(normalized);
      } else if (typeof window !== 'undefined' && window.location.hash.startsWith('#/settings/tavern')) {
        window.location.hash = `#/settings/tavern/${normalized}`;
      }
    },
    [controller, onNavigateTavern],
  );

  const handleSelectProductCategory = useCallback(
    async (category: string) => {
      if (controller.busy) return;
      if (controller.dirty && onNavigateCategory) {
        const discarded = await controller.discard();
        if (!discarded) return;
      }
      navigateToCategory(category);
    },
    [controller, navigateToCategory, onNavigateCategory],
  );

  const categoryMenuItems: MenuItemDef[] = [
    ...PRODUCT_SETTINGS_CATEGORIES.map((item) => ({
      id: `cat-${item.key}`,
      label: item.label,
      onSelect: () => void handleSelectProductCategory(item.key),
    })),
    ...TAVERN_SECTIONS.map((item, idx) => ({
      id: `tavern-${item.panel}`,
      label: item.label,
      separator: idx === 0,
      onSelect: () => void handleSelectTavern(item.panel),
    })),
  ];

  const renderSectionBody = () => {
    switch (controller.sectionKey) {
      case 'left-nav-panel':
        return <ReplyConfig controller={controller} />;
      case 'AdvancedFormatting':
        return (
          <Suspense fallback={null}>
            <Formatting controller={controller} />
          </Suspense>
        );
      case 'WorldInfo':
        return <WorldInfo controller={controller} />;
      case 'rm_extensions_block':
        return <Extensions controller={controller} />;
      case 'PersonaManagement':
        return <Personas controller={controller} />;
      case 'Backgrounds':
        return <Backgrounds controller={controller} />;
      case 'user-settings-block':
        return <InterfacePrefs controller={controller} />;
      case 'rm_api_block':
        return <ApiConnection controller={controller} />;
      case 'right-nav-panel':
        return <CharacterCard controller={controller} />;
      default:
        return <ReplyConfig controller={controller} />;
    }
  };

  const contentPane = (
    <div key={controller.sectionKey} className="vc-settings-content vc-desk-panel">
      <header className="vc-settings-header">
        <span className="vc-settings-category-control">
          <Menu
            items={categoryMenuItems}
            trigger={
              <IconButton
                icon="settings"
                aria-label="设置"
                className="vc-settings-category-toggle"
                data-settings-categories=""
              />
            }
          />
        </span>
        <h1 tabIndex={-1}>{controller.title}</h1>
        <button
          type="button"
          className="vc-btn vc-btn-text"
          hidden={!controller.dirty}
          disabled={controller.busy}
          onClick={() => void controller.discard()}
        >
          放弃修改
        </button>
        <button
          type="button"
          className="vc-btn vc-btn-fill"
          data-tavern-save=""
          disabled={controller.loading || controller.busy || !controller.dirty}
          onClick={() => void controller.save()}
        >
          {controller.busy ? (
            <>
              <Icon name="refresh-cw" size={16} />
              保存中…
            </>
          ) : (
            '保存'
          )}
        </button>
      </header>
      <div className="vc-settings-body">{renderSectionBody()}</div>
    </div>
  );

  if (embedded) {
    return (
      <>
        {contentPane}
        {controller.modals}
        {leaveGuardModal}
      </>
    );
  }

  return (
    <section className="vc-settings-shell" data-category={controller.sectionKey}>
      <SettingsNav
        current={controller.sectionKey}
        onSelectCategory={(key) => void handleSelectProductCategory(key)}
        onSelectTavern={(panel) => void handleSelectTavern(panel)}
      />
      {contentPane}
      {controller.modals}
      {leaveGuardModal}
    </section>
  );
}
