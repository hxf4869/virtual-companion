import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  IonApp,
  IonBackButton,
  IonPage,
  IonRouterOutlet,
  IonTabBar,
  IonTabButton,
  IonTabs,
  setupIonicReact,
  useIonRouter,
} from '@ionic/react';
import { IonReactRouter } from '@ionic/react-router';
import {
  Navigate,
  Route,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';
import '@ionic/react/css/core.css';
import { Aurora } from '../../design/theme/Aurora';
import { usePreferences } from '../../design/theme/usePreferences';
import {
  DEFAULT_TAVERN_CATEGORIES,
  PRODUCT_SETTINGS_CATEGORIES,
} from '../../features/settings/SettingsNav';
import { MobileIcon } from '../components/MobileIcon';
import {
  MobileSettingsSheet,
  type SettingsCategoryKey,
  type TavernCategoryKey,
} from './MobileSettingsSheet';
import './mobile.css';

export type { SettingsCategoryKey, TavernCategoryKey } from './MobileSettingsSheet';

setupIonicReact({
  mode: 'ios',
});

export type MobileTabKey = 'chat' | 'characters' | 'memory' | 'inbox' | 'story';

export interface MobileTabDefinition {
  key: MobileTabKey;
  path: string;
  label: string;
  icon: string;
}

export const MOBILE_TABS: readonly MobileTabDefinition[] = [
  { key: 'chat', path: '/m/chat', label: '聊天', icon: 'message-circle' },
  { key: 'characters', path: '/m/characters', label: '角色', icon: 'user-round' },
  { key: 'memory', path: '/m/memory', label: '记忆', icon: 'book-open' },
  { key: 'inbox', path: '/m/inbox', label: '陪伴', icon: 'heart' },
  { key: 'story', path: '/m/story', label: '剧情', icon: 'clapperboard' },
];

const STORY_AURORA_TINT = '24,132,208';

export interface MobileRouteSlotContext {
  pathname: string;
  params: Record<string, string | undefined>;
  navigate: (to: string, options?: { replace?: boolean }) => void;
  goBack: (fallbackPath?: string) => void;
  openSettings: () => void;
  setCharacterContext: (characterId: string | null, tint?: string) => void;
}

export interface MobileShellSlots {
  tabs?: Partial<
    Record<MobileTabKey, React.ReactNode | ((ctx: MobileRouteSlotContext) => React.ReactNode)>
  >;
  headerActions?: Partial<
    Record<MobileTabKey, React.ReactNode | ((ctx: MobileRouteSlotContext) => React.ReactNode)>
  >;
  chatDetail?: (ctx: MobileRouteSlotContext & { conversationKey: string }) => React.ReactNode;
  characterDetail?: (ctx: MobileRouteSlotContext & { avatar: string }) => React.ReactNode;
  memoryDetail?: (ctx: MobileRouteSlotContext & { memoryId: string }) => React.ReactNode;
  storyRun?: (ctx: MobileRouteSlotContext & { runId: string }) => React.ReactNode;
  cardFullscreen?: (ctx: MobileRouteSlotContext & { cardKey: string }) => React.ReactNode;
  settingsCategories?: Partial<
    Record<
      SettingsCategoryKey,
      React.ReactNode | ((ctx: MobileRouteSlotContext & { category: SettingsCategoryKey }) => React.ReactNode)
    >
  >;
  tavernSections?: Partial<
    Record<
      TavernCategoryKey,
      React.ReactNode | ((ctx: MobileRouteSlotContext & { section: TavernCategoryKey }) => React.ReactNode)
    >
  >;
  secondaryTitles?: Partial<Record<string, string>>;
  secondaryHeaderActions?: (ctx: MobileRouteSlotContext) => React.ReactNode;
}

export interface MobileShellProps {
  children?: React.ReactNode;
  initialPath?: string;
  slots?: MobileShellSlots;
  badges?: Partial<Record<MobileTabKey, number>>;
  unreadDots?: Partial<Record<MobileTabKey, boolean>>;
  userName?: string;
  userAvatarUrl?: string | null;
}

function formatBadgeCount(count: number | undefined): string | null {
  if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) {
    return null;
  }
  const rounded = Math.floor(count);
  return rounded >= 100 ? '99+' : String(rounded);
}

function normalizeMobilePathname(pathname: string): string {
  if (!pathname || pathname === '/' || pathname === '/m' || pathname === '/m/') {
    return '/m/chat';
  }
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

function isPrimaryTabPathname(pathname: string): MobileTabDefinition | undefined {
  const normalized = normalizeMobilePathname(pathname);
  return MOBILE_TABS.find((t) => t.path === normalized);
}

function resolveSettingsCategoryLabel(category: string): string {
  return PRODUCT_SETTINGS_CATEGORIES.find((item) => item.key === category)?.label ?? '设置';
}

function resolveTavernSectionLabel(section: string): string {
  return DEFAULT_TAVERN_CATEGORIES.find((item) => item.panel === section)?.label ?? '酒馆设置';
}

interface PrimaryTabPageProps {
  tab: MobileTabDefinition;
  activePathname: string;
  userName: string;
  userAvatarUrl?: string | null;
  onOpenSettings: () => void;
  slots?: MobileShellSlots;
  createContext: (
    pagePathname: string,
    params?: Record<string, string | undefined>,
  ) => MobileRouteSlotContext;
}

function PrimaryTabPage({
  tab,
  activePathname,
  userName,
  userAvatarUrl,
  onOpenSettings,
  slots,
  createContext,
}: PrimaryTabPageProps) {
  const isActive = normalizeMobilePathname(activePathname) === tab.path;
  const ctx = useMemo(() => createContext(tab.path, {}), [createContext, tab.path]);
  const headerActionNode = slots?.headerActions?.[tab.key];
  const slotNode = slots?.tabs?.[tab.key];
  const initialChar = (userName || '你').trim().charAt(0).toUpperCase() || '你';

  return (
    <IonPage
      className="vc-mobile-page"
      data-vc-page={`tab:${tab.key}`}
      data-vc-page-active={isActive ? 'true' : 'false'}
    >
      <header className="vc-mobile-primary-header">
        <h1
          className="vc-mobile-large-title"
          data-vc-large-title={isActive ? '' : undefined}
        >
          {tab.label}
        </h1>
        <div className="vc-mobile-header-actions">
          {headerActionNode
            ? typeof headerActionNode === 'function'
              ? headerActionNode(ctx)
              : headerActionNode
            : null}
          <button
            type="button"
            className="vc-mobile-avatar-trigger"
            aria-label="打开设置"
            data-vc-settings-trigger={isActive ? '' : undefined}
            onClick={onOpenSettings}
          >
            {userAvatarUrl ? (
              <img className="vc-mobile-avatar-img" src={userAvatarUrl} alt={userName || '你'} />
            ) : (
              <span className="vc-mobile-avatar-fallback" aria-hidden="true">
                {initialChar}
              </span>
            )}
          </button>
        </div>
      </header>

      <main
        className="vc-mobile-slot-container"
        data-vc-mobile-slot={isActive ? `tab:${tab.key}` : undefined}
      >
        {slotNode ? (typeof slotNode === 'function' ? slotNode(ctx) : slotNode) : null}
      </main>
    </IonPage>
  );
}

interface SecondaryRoutePageProps {
  slotKey: string;
  routePrefix: string;
  paramName: string;
  fallbackBackPath: string;
  defaultTitle: string | ((paramValue: string) => string);
  activePathname: string;
  slots?: MobileShellSlots;
  createContext: (
    pagePathname: string,
    params?: Record<string, string | undefined>,
  ) => MobileRouteSlotContext;
  renderContent?: (ctx: MobileRouteSlotContext, paramValue: string) => React.ReactNode;
}

function SecondaryRoutePage({
  slotKey,
  routePrefix,
  paramName,
  fallbackBackPath,
  defaultTitle,
  activePathname,
  slots,
  createContext,
  renderContent,
}: SecondaryRoutePageProps) {
  const routeParams = useParams<Record<string, string | undefined>>();
  const rawParam = routeParams[paramName] ?? '';
  const paramValue = useMemo(() => {
    try {
      return decodeURIComponent(rawParam);
    } catch {
      return rawParam;
    }
  }, [rawParam]);

  const pagePathname = rawParam ? `${routePrefix}/${rawParam}` : routePrefix;
  const normalizedActive = normalizeMobilePathname(activePathname);
  const isActive = normalizedActive === pagePathname || normalizedActive === `${routePrefix}/${paramValue}`;

  const ctx = useMemo(
    () => createContext(pagePathname, { ...routeParams, [paramName]: paramValue }),
    [createContext, pagePathname, paramName, paramValue, routeParams],
  );

  const fallbackTitleText =
    typeof defaultTitle === 'function' ? defaultTitle(paramValue) : defaultTitle;
  const customTitle =
    slots?.secondaryTitles?.[pagePathname] ??
    slots?.secondaryTitles?.[`${routePrefix}/${paramValue}`] ??
    slots?.secondaryTitles?.[paramValue] ??
    fallbackTitleText;

  return (
    <IonPage
      className="vc-mobile-page vc-mobile-page--secondary"
      data-vc-page={`secondary:${slotKey}`}
      data-vc-page-active={isActive ? 'true' : 'false'}
    >
      <header className="vc-mobile-secondary-header">
        <IonBackButton
          defaultHref={fallbackBackPath}
          text=""
          className="vc-mobile-glass-circle-btn"
          aria-label="返回"
          data-vc-back-button={isActive ? '' : undefined}
        />

        <h1
          className="vc-mobile-secondary-title"
          data-vc-secondary-title={isActive ? '' : undefined}
        >
          {customTitle}
        </h1>

        <div className="vc-mobile-secondary-right">
          {slots?.secondaryHeaderActions ? slots.secondaryHeaderActions(ctx) : null}
        </div>
      </header>

      <main
        className="vc-mobile-slot-container vc-mobile-slot-container--secondary"
        data-vc-mobile-slot={isActive ? `secondary:${slotKey}` : undefined}
      >
        {renderContent ? renderContent(ctx, paramValue) : null}
      </main>
    </IonPage>
  );
}

interface MobileShellInnerProps {
  children?: React.ReactNode;
  initialPath?: string;
  slots?: MobileShellSlots;
  badges?: Partial<Record<MobileTabKey, number>>;
  unreadDots?: Partial<Record<MobileTabKey, boolean>>;
  userName: string;
  userAvatarUrl?: string | null;
}

function readSettingsOpenFromState(state: unknown): boolean {
  if (!state || typeof state !== 'object') return false;
  return Boolean((state as Record<string, unknown>).settingsOpen);
}

function MobileShellInner({
  children,
  initialPath,
  slots,
  badges,
  unreadDots,
  userName,
  userAvatarUrl,
}: MobileShellInnerProps) {
  const location = useLocation();
  const routerNavigate = useNavigate();
  const ionRouter = useIonRouter();
  const characterTint = usePreferences((s) => s.characterTint);
  const setCharacterTint = usePreferences((s) => s.setCharacterTint);
  const syncFromStorage = usePreferences((s) => s.syncFromStorage);

  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const locationRef = useRef(location);
  locationRef.current = location;
  const closingSettingsRef = useRef(false);

  const initialPathAppliedRef = useRef(false);
  useEffect(() => {
    if (initialPathAppliedRef.current) return;
    initialPathAppliedRef.current = true;
    if (initialPath) {
      const target = normalizeMobilePathname(initialPath);
      if (normalizeMobilePathname(location.pathname) !== target) {
        routerNavigate(target, { replace: true });
      }
    }
  }, [initialPath, location.pathname, routerNavigate]);

  const settingsOpen = readSettingsOpenFromState(location.state);
  if (!settingsOpen) {
    closingSettingsRef.current = false;
  }
  const normalizedPathname = normalizeMobilePathname(location.pathname);
  const activePrimaryTab = isPrimaryTabPathname(normalizedPathname);
  const isStoryScene =
    normalizedPathname === '/m/story' || normalizedPathname.startsWith('/m/story/');

  // Subscribe only to Ionic's public ionKeyboardDidShow / ionKeyboardDidHide events
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const onKeyboardShow = (ev: Event) => {
      const detail = (ev as CustomEvent<{ keyboardHeight?: number }>).detail;
      const height = Math.max(0, Number(detail?.keyboardHeight ?? 0));
      document.documentElement.style.setProperty('--vc-keyboard', `${height}px`);
      setKeyboardOpen(true);
    };

    const onKeyboardHide = () => {
      document.documentElement.style.setProperty('--vc-keyboard', '0px');
      setKeyboardOpen(false);
    };

    window.addEventListener('ionKeyboardDidShow', onKeyboardShow);
    window.addEventListener('ionKeyboardDidHide', onKeyboardHide);

    return () => {
      window.removeEventListener('ionKeyboardDidShow', onKeyboardShow);
      window.removeEventListener('ionKeyboardDidHide', onKeyboardHide);
      document.documentElement.style.setProperty('--vc-keyboard', '0px');
    };
  }, []);

  const navigate = useCallback(
    (to: string, options?: { replace?: boolean }) => {
      if (options?.replace) {
        ionRouter.push(to, 'none', 'replace');
      } else {
        ionRouter.push(to, 'forward', 'push');
      }
    },
    [ionRouter],
  );

  const goBack = useCallback(
    (fallbackPath = '/m/chat') => {
      if (ionRouter.canGoBack()) {
        ionRouter.goBack();
        return;
      }
      ionRouter.push(fallbackPath, 'back', 'pop');
    },
    [ionRouter],
  );

  const openSettings = useCallback(() => {
    const cur = locationRef.current;
    if (readSettingsOpenFromState(cur.state)) return;
    closingSettingsRef.current = false;
    const prevState =
      cur.state && typeof cur.state === 'object'
        ? (cur.state as Record<string, unknown>)
        : {};
    const currentUrl = `${cur.pathname}${cur.search}${cur.hash}`;
    routerNavigate(currentUrl, {
      state: { ...prevState, settingsOpen: true },
    });
  }, [routerNavigate]);

  const closeSettings = useCallback(() => {
    if (closingSettingsRef.current || !readSettingsOpenFromState(locationRef.current.state)) {
      return;
    }
    closingSettingsRef.current = true;
    routerNavigate(-1);
  }, [routerNavigate]);

  const pushSettingsSubRoute = useCallback(
    (targetPath: string) => {
      const cur = locationRef.current;
      const prevState =
        cur.state && typeof cur.state === 'object'
          ? (cur.state as Record<string, unknown>)
          : {};
      const nextState: Record<string, unknown> = { ...prevState };
      delete nextState.settingsOpen;
      routerNavigate(targetPath, {
        state: nextState,
      });
    },
    [routerNavigate],
  );

  const handleSelectSettingsCategory = useCallback(
    (category: SettingsCategoryKey) => {
      pushSettingsSubRoute(`/m/settings/${encodeURIComponent(category)}`);
    },
    [pushSettingsSubRoute],
  );

  const handleSelectTavernSection = useCallback(
    (section: TavernCategoryKey) => {
      pushSettingsSubRoute(`/m/settings/tavern/${encodeURIComponent(section)}`);
    },
    [pushSettingsSubRoute],
  );

  const setCharacterContext = useCallback(
    (characterId: string | null, tint?: string) => {
      syncFromStorage(characterId);
      if (tint !== undefined) {
        setCharacterTint(tint);
      }
    },
    [setCharacterTint, syncFromStorage],
  );

  const createContext = useCallback(
    (
      pagePathname: string,
      params: Record<string, string | undefined> = {},
    ): MobileRouteSlotContext => ({
      pathname: pagePathname,
      params,
      navigate,
      goBack,
      openSettings,
      setCharacterContext,
    }),
    [goBack, navigate, openSettings, setCharacterContext],
  );

  const effectiveAuroraTint = isStoryScene ? STORY_AURORA_TINT : characterTint;
  const hideTabBar = !activePrimaryTab || settingsOpen || keyboardOpen;

  return (
    <div
      className="vc-mobile-app"
      data-vc-mobile-app=""
      data-vc-mobile-scene={isStoryScene ? 'story' : 'default'}
      data-vc-mobile-route={normalizedPathname}
    >
      <Aurora characterTint={effectiveAuroraTint} />

      <div className="vc-mobile-shell-frame">
        <IonTabs>
          <IonRouterOutlet id="vc-mobile-router-outlet">
            <Route path="/" element={<Navigate to="/m/chat" replace />} />
            <Route path="/m" element={<Navigate to="/m/chat" replace />} />

            {MOBILE_TABS.map((tab) => (
              <Route
                key={tab.key}
                path={tab.path}
                element={
                  <PrimaryTabPage
                    tab={tab}
                    activePathname={normalizedPathname}
                    userName={userName}
                    userAvatarUrl={userAvatarUrl}
                    onOpenSettings={openSettings}
                    slots={slots}
                    createContext={createContext}
                  />
                }
              />
            ))}

            <Route
              path="/m/chat/:conversationKey"
              element={
                <SecondaryRoutePage
                  slotKey="chat-detail"
                  routePrefix="/m/chat"
                  paramName="conversationKey"
                  fallbackBackPath="/m/chat"
                  defaultTitle="对话"
                  activePathname={normalizedPathname}
                  slots={slots}
                  createContext={createContext}
                  renderContent={(ctx, conversationKey) =>
                    slots?.chatDetail ? slots.chatDetail({ ...ctx, conversationKey }) : null
                  }
                />
              }
            />

            <Route
              path="/m/characters/:avatar"
              element={
                <SecondaryRoutePage
                  slotKey="character-detail"
                  routePrefix="/m/characters"
                  paramName="avatar"
                  fallbackBackPath="/m/characters"
                  defaultTitle="角色详情"
                  activePathname={normalizedPathname}
                  slots={slots}
                  createContext={createContext}
                  renderContent={(ctx, avatar) =>
                    slots?.characterDetail ? slots.characterDetail({ ...ctx, avatar }) : null
                  }
                />
              }
            />

            <Route
              path="/m/memory/:memoryId"
              element={
                <SecondaryRoutePage
                  slotKey="memory-detail"
                  routePrefix="/m/memory"
                  paramName="memoryId"
                  fallbackBackPath="/m/memory"
                  defaultTitle="记忆详情"
                  activePathname={normalizedPathname}
                  slots={slots}
                  createContext={createContext}
                  renderContent={(ctx, memoryId) =>
                    slots?.memoryDetail ? slots.memoryDetail({ ...ctx, memoryId }) : null
                  }
                />
              }
            />

            <Route
              path="/m/story/:runId"
              element={
                <SecondaryRoutePage
                  slotKey="story-run"
                  routePrefix="/m/story"
                  paramName="runId"
                  fallbackBackPath="/m/story"
                  defaultTitle="剧情进行中"
                  activePathname={normalizedPathname}
                  slots={slots}
                  createContext={createContext}
                  renderContent={(ctx, runId) =>
                    slots?.storyRun ? slots.storyRun({ ...ctx, runId }) : null
                  }
                />
              }
            />

            <Route
              path="/m/cards/:cardKey"
              element={
                <SecondaryRoutePage
                  slotKey="card-fullscreen"
                  routePrefix="/m/cards"
                  paramName="cardKey"
                  fallbackBackPath="/m/chat"
                  defaultTitle="互动卡片"
                  activePathname={normalizedPathname}
                  slots={slots}
                  createContext={createContext}
                  renderContent={(ctx, cardKey) =>
                    slots?.cardFullscreen ? slots.cardFullscreen({ ...ctx, cardKey }) : null
                  }
                />
              }
            />

            <Route
              path="/m/settings/tavern/:section"
              element={
                <SecondaryRoutePage
                  slotKey="tavern-section"
                  routePrefix="/m/settings/tavern"
                  paramName="section"
                  fallbackBackPath="/m/chat"
                  defaultTitle={resolveTavernSectionLabel}
                  activePathname={normalizedPathname}
                  slots={slots}
                  createContext={createContext}
                  renderContent={(ctx, section) => {
                    const slot = slots?.tavernSections?.[section as TavernCategoryKey];
                    if (typeof slot === 'function') {
                      return slot({ ...ctx, section: section as TavernCategoryKey });
                    }
                    return slot ?? null;
                  }}
                />
              }
            />

            <Route
              path="/m/settings/:category"
              element={
                <SecondaryRoutePage
                  slotKey="settings-category"
                  routePrefix="/m/settings"
                  paramName="category"
                  fallbackBackPath="/m/chat"
                  defaultTitle={resolveSettingsCategoryLabel}
                  activePathname={normalizedPathname}
                  slots={slots}
                  createContext={createContext}
                  renderContent={(ctx, category) => {
                    const slot = slots?.settingsCategories?.[category as SettingsCategoryKey];
                    if (typeof slot === 'function') {
                      return slot({ ...ctx, category: category as SettingsCategoryKey });
                    }
                    return slot ?? null;
                  }}
                />
              }
            />
          </IonRouterOutlet>

          <IonTabBar
            slot="bottom"
            className="vc-mobile-tabbar"
            data-vc-mobile-tabbar=""
            data-hidden={hideTabBar ? 'true' : 'false'}
            hidden={hideTabBar}
          >
            {MOBILE_TABS.map((tab) => {
              const isSelected = activePrimaryTab?.key === tab.key;
              const badgeText = formatBadgeCount(badges?.[tab.key]);
              const showDot = !badgeText && Boolean(unreadDots?.[tab.key]);

              return (
                <IonTabButton
                  key={tab.key}
                  tab={tab.key}
                  href={tab.path}
                  selected={isSelected}
                  className="vc-mobile-tab-button"
                  data-vc-tab={tab.key}
                  data-active={isSelected ? 'true' : 'false'}
                >
                  <span className="vc-mobile-tab-icon-wrap">
                    <MobileIcon name={tab.icon} size={24} />
                    {badgeText ? (
                      <span className="vc-mobile-tab-badge" data-vc-tab-badge="">
                        {badgeText}
                      </span>
                    ) : showDot ? (
                      <span className="vc-mobile-tab-dot" data-vc-tab-dot="" />
                    ) : null}
                  </span>
                  <span className="vc-mobile-tab-label">{tab.label}</span>
                </IonTabButton>
              );
            })}
          </IonTabBar>
        </IonTabs>

        {children ? <div className="vc-mobile-injected-children">{children}</div> : null}
      </div>

      <MobileSettingsSheet
        open={settingsOpen}
        onRequestClose={closeSettings}
        onSelectCategory={handleSelectSettingsCategory}
        onSelectTavernSection={handleSelectTavernSection}
        userName={userName}
        userAvatarUrl={userAvatarUrl}
        slots={slots}
      />
    </div>
  );
}

export function MobileShell({
  children,
  initialPath,
  slots,
  badges,
  unreadDots,
  userName = '你',
  userAvatarUrl = null,
}: MobileShellProps) {
  useLayoutEffect(() => {
    if (typeof document === 'undefined' || !document.documentElement) return;
    if (!document.documentElement.dataset.vcDevice) {
      document.documentElement.dataset.vcDevice = 'mobile';
    }
  }, []);

  return (
    <IonApp className="vc-mobile-ion-app">
      <IonReactRouter>
        <MobileShellInner
          children={children}
          initialPath={initialPath}
          slots={slots}
          badges={badges}
          unreadDots={unreadDots}
          userName={userName}
          userAvatarUrl={userAvatarUrl}
        />
      </IonReactRouter>
    </IonApp>
  );
}
