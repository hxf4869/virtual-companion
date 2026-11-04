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

const PRODUCT_CATEGORIES: ReadonlyArray<readonly [string, string, string, string]> = [
  ['account', '账户', 'user-round', 'gray'],
  ['model', '模型', 'cpu', 'blue'],
  ['voice', '语音', 'mic', 'orange'],
  ['notifications', '通知', 'bell', 'pink'],
  ['appearance', '外观', 'monitor', 'purple'],
  ['companion', '陪伴风格', 'heart', 'pink'],
  ['stickers', '表情包', 'image', 'orange'],
  ['data', '账户与数据', 'shield', 'green'],
];

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
    ...PRODUCT_CATEGORIES.map(([key, label]) => ({
      id: `cat-${key}`,
      label,
      onSelect: () => void handleSelectProductCategory(key),
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
      <nav className="vc-settings-categories vc-desk-panel" aria-label="设置分类">
        <h1>设置</h1>
        {PRODUCT_CATEGORIES.map(([key, title, glyph, tile]) => (
          <button
            key={key}
            type="button"
            data-category={key}
            data-vc-light=""
            aria-current="false"
            onClick={() => void handleSelectProductCategory(key)}
          >
            <span className={`vc-tile vc-tile-${tile}`}>
              <Icon name={glyph} size={18} />
            </span>
            <span>{title}</span>
          </button>
        ))}
        <h2>酒馆</h2>
        {TAVERN_SECTIONS.map((item) => (
          <button
            key={item.panel}
            type="button"
            data-category={item.panel}
            data-vc-light=""
            aria-current={controller.sectionKey === item.panel ? 'page' : 'false'}
            onClick={() => void handleSelectTavern(item.panel)}
          >
            <span className={`vc-tile vc-tile-${item.tile}`}>
              <Icon name={item.icon} size={18} />
            </span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
      {contentPane}
      {controller.modals}
      {leaveGuardModal}
    </section>
  );
}
