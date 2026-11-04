import { Icon } from '../../design/components/Icon';

export type ProductSettingsCategory =
  | 'account'
  | 'model'
  | 'voice'
  | 'notifications'
  | 'appearance'
  | 'companion'
  | 'stickers'
  | 'data';

export interface SettingsCategoryItem {
  key: ProductSettingsCategory;
  label: string;
  icon: string;
  color: string;
}

export interface TavernCategoryItem {
  panel: string;
  label: string;
  icon: string;
  tile: string;
}

export const PRODUCT_SETTINGS_CATEGORIES: readonly SettingsCategoryItem[] = [
  { key: 'account', label: '账户', icon: 'user-round', color: 'gray' },
  { key: 'model', label: '模型', icon: 'cpu', color: 'blue' },
  { key: 'voice', label: '语音', icon: 'mic', color: 'orange' },
  { key: 'notifications', label: '通知', icon: 'bell', color: 'pink' },
  { key: 'appearance', label: '外观', icon: 'monitor', color: 'purple' },
  { key: 'companion', label: '陪伴风格', icon: 'heart', color: 'pink' },
  { key: 'stickers', label: '表情包', icon: 'image', color: 'orange' },
  { key: 'data', label: '账户与数据', icon: 'shield', color: 'green' },
] as const;

export const DEFAULT_TAVERN_CATEGORIES: readonly TavernCategoryItem[] = [
  { panel: 'left-nav-panel', label: 'AI 回复配置', icon: 'sliders-horizontal', tile: 'indigo' },
  { panel: 'AdvancedFormatting', label: '提示词格式', icon: 'quote', tile: 'purple' },
  { panel: 'WorldInfo', label: '世界书', icon: 'book-marked', tile: 'teal' },
  { panel: 'rm_extensions_block', label: '扩展', icon: 'puzzle', tile: 'orange' },
  { panel: 'PersonaManagement', label: '人设', icon: 'user-round', tile: 'green' },
  { panel: 'Backgrounds', label: '背景', icon: 'image', tile: 'cyan' },
  { panel: 'user-settings-block', label: '界面', icon: 'monitor', tile: 'pink' },
  { panel: 'rm_api_block', label: 'API 连接', icon: 'link', tile: 'gray' },
  { panel: 'right-nav-panel', label: '角色卡', icon: 'square-pen', tile: 'blue' },
] as const;

export interface SettingsNavProps {
  current: string;
  onSelectCategory: (category: string) => void;
  onSelectTavern?: (section: string) => void;
  showTavernSection?: boolean;
}

export function SettingsNav({
  current,
  onSelectCategory,
  onSelectTavern,
  showTavernSection = true,
}: SettingsNavProps) {
  return (
    <aside className="vc-settings-categories" aria-label="设置分类">
      <h2 className="vc-settings-categories-title">设置</h2>
      {PRODUCT_SETTINGS_CATEGORIES.map((item) => {
        const active = current === item.key;
        return (
          <button
            key={item.key}
            type="button"
            className={`vc-settings-category${active ? ' is-active' : ''}`}
            data-category={item.key}
            aria-current={active ? 'page' : undefined}
            onClick={() => onSelectCategory(item.key)}
          >
            <span className={`vc-tile vc-tile-${item.color}`}>
              <Icon name={item.icon} size={16} />
            </span>
            <span>{item.label}</span>
          </button>
        );
      })}
      {showTavernSection ? (
        <>
          <div className="vc-settings-categories-section" role="presentation">
            酒馆设置
          </div>
          {DEFAULT_TAVERN_CATEGORIES.map((row) => {
            const active = current === row.panel;
            return (
              <button
                key={row.panel}
                type="button"
                className={`vc-settings-category${active ? ' is-active' : ''}`}
                data-category={row.panel}
                aria-current={active ? 'page' : undefined}
                onClick={() => {
                  if (onSelectTavern) {
                    onSelectTavern(row.panel);
                  } else {
                    onSelectCategory(row.panel);
                  }
                }}
              >
                <span className={`vc-tile vc-tile-${row.tile}`}>
                  <Icon name={row.icon} size={16} />
                </span>
                <span>{row.label}</span>
              </button>
            );
          })}
        </>
      ) : null}
    </aside>
  );
}
