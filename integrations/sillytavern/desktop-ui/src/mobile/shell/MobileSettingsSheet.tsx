import { IonModal } from '@ionic/react';
import {
  DEFAULT_TAVERN_CATEGORIES,
  PRODUCT_SETTINGS_CATEGORIES,
  type ProductSettingsCategory,
  type TavernCategoryItem,
} from '../../features/settings/SettingsNav';
import {
  usePreferences,
  type ThemeMode,
} from '../../design/theme/usePreferences';
import { MobileIcon } from '../components/MobileIcon';
import type { MobileShellSlots } from './MobileShell';

export type SettingsCategoryKey = ProductSettingsCategory;
export type TavernCategoryKey = TavernCategoryItem['panel'];

const THEME_OPTIONS: ReadonlyArray<{ mode: ThemeMode; label: string }> = [
  { mode: 'auto', label: '跟随系统' },
  { mode: 'light', label: '浅色' },
  { mode: 'dark', label: '深色' },
];

const PRIMARY_PRODUCT_ITEMS = PRODUCT_SETTINGS_CATEGORIES.filter(
  (item) => item.key !== 'account' && item.key !== 'data',
);
const DATA_PRODUCT_ITEMS = PRODUCT_SETTINGS_CATEGORIES.filter(
  (item) => item.key === 'data',
);

export interface MobileSettingsSheetProps {
  open: boolean;
  onRequestClose: () => void;
  onSelectCategory: (category: SettingsCategoryKey) => void;
  onSelectTavernSection: (section: TavernCategoryKey) => void;
  userName: string;
  userAvatarUrl?: string | null;
  slots?: MobileShellSlots;
}

export function MobileSettingsSheet({
  open,
  onRequestClose,
  onSelectCategory,
  onSelectTavernSection,
  userName,
  userAvatarUrl,
  slots,
}: MobileSettingsSheetProps) {
  const themeMode = usePreferences((s) => s.themeMode);
  const setThemeMode = usePreferences((s) => s.setThemeMode);

  const initialChar = (userName || '你').trim().charAt(0).toUpperCase() || '你';
  const hasAccountSlot = Boolean(slots?.settingsCategories?.account);

  return (
    <IonModal
      className="vc-mobile-settings-modal"
      data-vc-settings-modal=""
      isOpen={open}
      keepContentsMounted={true}
      breakpoints={[0, 0.56, 1]}
      initialBreakpoint={1}
      backdropBreakpoint={0}
      showBackdrop={true}
      handle={false}
      onDidDismiss={() => {
        onRequestClose();
      }}
    >
      <div
        className="vc-mobile-settings-sheet"
        data-vc-settings-sheet=""
        data-open={open ? 'true' : 'false'}
        hidden={!open}
        role="dialog"
        aria-modal="true"
        aria-label="设置"
      >
        <div className="vc-mobile-sheet-grabber-row" aria-hidden="true">
          <div className="vc-mobile-sheet-grabber" />
        </div>

        <header className="vc-mobile-sheet-header">
          <h2 className="vc-mobile-sheet-title" data-vc-settings-title="">
            设置
          </h2>

          <button
            type="button"
            className="vc-mobile-sheet-nav-btn vc-mobile-sheet-nav-btn--done"
            data-vc-settings-done=""
            onClick={onRequestClose}
          >
            完成
          </button>
        </header>

        <div className="vc-mobile-sheet-body">
          {/* Account & Immediate Theme Mode Card (M13-0) */}
          <section className="vc-mobile-settings-group" aria-label="账户与外观模式">
            <div className="vc-mobile-settings-card">
              <button
                type="button"
                className="vc-mobile-account-row"
                data-vc-settings-account=""
                data-vc-settings-item="account"
                data-vc-settings-item-disabled={hasAccountSlot ? undefined : 'true'}
                disabled={!hasAccountSlot}
                aria-disabled={!hasAccountSlot}
                onClick={() => {
                  if (!hasAccountSlot) return;
                  onSelectCategory('account');
                }}
              >
                <span className="vc-mobile-account-avatar">
                  {userAvatarUrl ? (
                    <img
                      className="vc-mobile-avatar-img"
                      src={userAvatarUrl}
                      alt={userName || '你'}
                    />
                  ) : (
                    <span aria-hidden="true">{initialChar}</span>
                  )}
                </span>
                <span className="vc-mobile-account-meta">
                  <span className="vc-mobile-account-name">{userName || '你'}</span>
                  <span className="vc-mobile-account-sub">密码与身份验证器</span>
                </span>
                <MobileIcon
                  name="chevron-right"
                  size={18}
                  className="vc-mobile-settings-chevron"
                />
              </button>

              <div className="vc-mobile-theme-row">
                <span className="vc-mobile-theme-row-label" id="vc-mobile-theme-group-label">
                  外观模式
                </span>
                <div
                  className="vc-mobile-theme-segment"
                  role="radiogroup"
                  aria-labelledby="vc-mobile-theme-group-label"
                  data-vc-theme-segment=""
                >
                  {THEME_OPTIONS.map((opt) => {
                    const isActive = themeMode === opt.mode;
                    return (
                      <label
                        key={opt.mode}
                        className="vc-mobile-theme-option"
                        data-vc-theme-option={opt.mode}
                        data-active={isActive ? 'true' : 'false'}
                      >
                        <input
                          type="radio"
                          name="vc-mobile-theme-mode"
                          value={opt.mode}
                          checked={isActive}
                          className="vc-mobile-theme-radio-input"
                          onChange={() => setThemeMode(opt.mode)}
                        />
                        <span>{opt.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>

          {/* Product Settings Categories (reused from desktop SettingsNav) */}
          <section className="vc-mobile-settings-group" aria-label="产品设置">
            <div className="vc-mobile-settings-card">
              {PRIMARY_PRODUCT_ITEMS.map((item) => {
                const hasSlot = Boolean(slots?.settingsCategories?.[item.key]);
                return (
                  <button
                    key={item.key}
                    type="button"
                    className="vc-mobile-settings-row"
                    data-vc-settings-item={item.key}
                    data-vc-settings-item-disabled={hasSlot ? undefined : 'true'}
                    disabled={!hasSlot}
                    aria-disabled={!hasSlot}
                    onClick={() => {
                      if (!hasSlot) return;
                      onSelectCategory(item.key);
                    }}
                  >
                    <span
                      className="vc-mobile-settings-tile"
                      data-tile={item.color}
                      aria-hidden="true"
                    >
                      <MobileIcon name={item.icon} size={17} />
                    </span>
                    <span className="vc-mobile-settings-row-text">
                      <span className="vc-mobile-settings-row-title">{item.label}</span>
                    </span>
                    <MobileIcon
                      name="chevron-right"
                      size={18}
                      className="vc-mobile-settings-chevron"
                    />
                  </button>
                );
              })}
            </div>
          </section>

          {/* Account & Data Group (M13-0 separate card above Tavern) */}
          <section className="vc-mobile-settings-group" aria-label="账户与数据">
            <div className="vc-mobile-settings-card">
              {DATA_PRODUCT_ITEMS.map((item) => {
                const hasSlot = Boolean(slots?.settingsCategories?.[item.key]);
                return (
                  <button
                    key={item.key}
                    type="button"
                    className="vc-mobile-settings-row"
                    data-vc-settings-item={item.key}
                    data-vc-settings-item-disabled={hasSlot ? undefined : 'true'}
                    disabled={!hasSlot}
                    aria-disabled={!hasSlot}
                    onClick={() => {
                      if (!hasSlot) return;
                      onSelectCategory(item.key);
                    }}
                  >
                    <span
                      className="vc-mobile-settings-tile"
                      data-tile={item.color}
                      aria-hidden="true"
                    >
                      <MobileIcon name={item.icon} size={17} />
                    </span>
                    <span className="vc-mobile-settings-row-text">
                      <span className="vc-mobile-settings-row-title">{item.label}</span>
                    </span>
                    <MobileIcon
                      name="chevron-right"
                      size={18}
                      className="vc-mobile-settings-chevron"
                    />
                  </button>
                );
              })}
            </div>
          </section>

          {/* Tavern Settings Categories (reused from desktop SettingsNav) */}
          <section className="vc-mobile-settings-group" aria-label="酒馆">
            <div className="vc-mobile-settings-group-header">酒馆</div>
            <div className="vc-mobile-settings-card">
              {DEFAULT_TAVERN_CATEGORIES.map((item) => {
                const hasSlot = Boolean(slots?.tavernSections?.[item.panel]);
                return (
                  <button
                    key={item.panel}
                    type="button"
                    className="vc-mobile-settings-row"
                    data-vc-tavern-item={item.panel}
                    data-vc-settings-item-disabled={hasSlot ? undefined : 'true'}
                    disabled={!hasSlot}
                    aria-disabled={!hasSlot}
                    onClick={() => {
                      if (!hasSlot) return;
                      onSelectTavernSection(item.panel);
                    }}
                  >
                    <span
                      className="vc-mobile-settings-tile"
                      data-tile={item.tile}
                      aria-hidden="true"
                    >
                      <MobileIcon name={item.icon} size={17} />
                    </span>
                    <span className="vc-mobile-settings-row-text">
                      <span className="vc-mobile-settings-row-title">{item.label}</span>
                    </span>
                    <MobileIcon
                      name="chevron-right"
                      size={18}
                      className="vc-mobile-settings-chevron"
                    />
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </IonModal>
  );
}
