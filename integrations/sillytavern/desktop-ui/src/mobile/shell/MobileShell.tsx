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
  cardFullscreen?: (
    ctx: MobileRouteSlotContext & {
      conversationKey: string;
      message?: string;
    },
  ) => React.ReactNode;
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
  const clean = (pathname || '').split('?')[0];
  if (!clean || clean === '/' || clean === '/m' || clean === '/m/') {
    return '/m/chat';
  }
  return clean.length > 1 && clean.endsWith('/') ? clean.slice(0, -1) : clean;
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

function resolveCardFallbackBackPath(conversationKey: string): string {
  return conversationKey ? `/m/chat/${encodeURIComponent(conversationKey)}` : '/m/chat';
}

interface MobileShellRuntimeContextValue {
  activePathname: string;
  activeSearch: string;
  userName: string;
  userAvatarUrl?: string | null;
  onOpenSettings: () => void;
  slots?: MobileShellSlots;
  createContext: (
    pagePathname: string,
    params?: Record<string, string | undefined>,
    defaultFallbackBackPath?: string,
  ) => MobileRouteSlotContext;
}

const MobileShellRuntimeContext = React.createContext<MobileShellRuntimeContextValue | null>(null);

function useMobileShellRuntime(): MobileShellRuntimeContextValue {
  const ctx = React.useContext(MobileShellRuntimeContext);
  if (!ctx) {
    throw new Error('useMobileShellRuntime must be used within MobileShellInner');
  }
  return ctx;
}

interface PrimaryTabPageProps {
  tab: MobileTabDefinition;
}

function PrimaryTabPage({ tab }: PrimaryTabPageProps) {
  const {
    activePathname,
    userName,
    userAvatarUrl,
    onOpenSettings,
    slots,
    createContext,
  } = useMobileShellRuntime();
  const isActive = normalizeMobilePathname(activePathname) === tab.path;
  const ctx = useMemo(() => createContext(tab.path, {}, '/m/chat'), [createContext, tab.path]);
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

type SecondarySlotKey =
  | 'chat-detail'
  | 'character-detail'
  | 'memory-detail'
  | 'story-run'
  | 'card-fullscreen'
  | 'tavern-section'
  | 'settings-category';

interface SecondaryRoutePageProps {
  slotKey: SecondarySlotKey;
  routePrefix: string;
  routeSuffix?: string;
  paramName: string;
  fallbackBackPath: string | ((paramValue: string, rawParam: string) => string);
  defaultTitle: string | ((paramValue: string) => string);
}

function SecondaryRoutePage({
  slotKey,
  routePrefix,
  routeSuffix = '',
  paramName,
  fallbackBackPath,
  defaultTitle,
}: SecondaryRoutePageProps) {
  const { activePathname, activeSearch, slots, createContext } = useMobileShellRuntime();
  const routeParams = useParams<Record<string, string | undefined>>();
  const rawParam = routeParams[paramName] ?? '';
  const paramValue = useMemo(() => {
    try {
      return decodeURIComponent(rawParam);
    } catch {
      return rawParam;
    }
  }, [rawParam]);

  const encodedParam = useMemo(() => encodeURIComponent(paramValue), [paramValue]);
  const rawPath = rawParam
    ? `${routePrefix}/${rawParam}${routeSuffix}`
    : `${routePrefix}${routeSuffix}`;
  const decodedPath = rawParam
    ? `${routePrefix}/${paramValue}${routeSuffix}`
    : `${routePrefix}${routeSuffix}`;
  const encodedPath = rawParam
    ? `${routePrefix}/${encodedParam}${routeSuffix}`
    : `${routePrefix}${routeSuffix}`;

  const normalizedActive = normalizeMobilePathname(activePathname);
  const decodedActive = useMemo(() => {
    try {
      return decodeURIComponent(normalizedActive);
    } catch {
      return normalizedActive;
    }
  }, [normalizedActive]);
  const isActive =
    normalizedActive === rawPath ||
    normalizedActive === decodedPath ||
    normalizedActive === encodedPath ||
    decodedActive === decodedPath;

  const lastActivePathnameRef = useRef(isActive ? normalizedActive : encodedPath);
  if (isActive) {
    lastActivePathnameRef.current = normalizedActive;
  }

  const lastActiveSearchRef = useRef(activeSearch);
  if (isActive) {
    lastActiveSearchRef.current = activeSearch;
  }
  const effectiveSearch = isActive ? activeSearch : lastActiveSearchRef.current;

  const messageParam = useMemo(() => {
    if (!effectiveSearch) return undefined;
    const val = new URLSearchParams(effectiveSearch).get('message');
    return val && val.length > 0 ? val : undefined;
  }, [effectiveSearch]);

  const resolvedFallbackBackPath = useMemo(
    () =>
      typeof fallbackBackPath === 'function'
        ? fallbackBackPath(paramValue, rawParam)
        : fallbackBackPath,
    [fallbackBackPath, paramValue, rawParam],
  );

  const pagePathname = isActive ? normalizedActive : lastActivePathnameRef.current;

  const ctx = useMemo(
    () =>
      createContext(
        pagePathname,
        {
          ...routeParams,
          [paramName]: paramValue,
          ...(slotKey === 'card-fullscreen' && messageParam !== undefined
            ? { message: messageParam }
            : {}),
        },
        resolvedFallbackBackPath,
      ),
    [
      createContext,
      messageParam,
      pagePathname,
      paramName,
      paramValue,
      resolvedFallbackBackPath,
      routeParams,
      slotKey,
    ],
  );

  const fallbackTitleText =
    typeof defaultTitle === 'function' ? defaultTitle(paramValue) : defaultTitle;
  const customTitle =
    (effectiveSearch
      ? slots?.secondaryTitles?.[`${pagePathname}${effectiveSearch}`] ??
        slots?.secondaryTitles?.[`${decodedPath}${effectiveSearch}`] ??
        slots?.secondaryTitles?.[`${encodedPath}${effectiveSearch}`]
      : undefined) ??
    slots?.secondaryTitles?.[pagePathname] ??
    slots?.secondaryTitles?.[rawPath] ??
    slots?.secondaryTitles?.[decodedPath] ??
    slots?.secondaryTitles?.[encodedPath] ??
    (slotKey === 'card-fullscreen' && messageParam
      ? slots?.secondaryTitles?.[messageParam]
      : undefined) ??
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
          defaultHref={resolvedFallbackBackPath}
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
        {slotKey === 'chat-detail'
          ? slots?.chatDetail
            ? slots.chatDetail({ ...ctx, conversationKey: paramValue })
            : null
          : slotKey === 'character-detail'
            ? slots?.characterDetail
              ? slots.characterDetail({ ...ctx, avatar: paramValue })
              : null
            : slotKey === 'memory-detail'
              ? slots?.memoryDetail
                ? slots.memoryDetail({ ...ctx, memoryId: paramValue })
                : null
              : slotKey === 'story-run'
                ? slots?.storyRun
                  ? slots.storyRun({ ...ctx, runId: paramValue })
                  : null
                : slotKey === 'card-fullscreen'
                  ? slots?.cardFullscreen
                    ? slots.cardFullscreen({
                        ...ctx,
                        conversationKey: paramValue,
                        message: messageParam,
                      })
                    : null
                  : slotKey === 'tavern-section'
                    ? (() => {
                        const slot = slots?.tavernSections?.[paramValue as TavernCategoryKey];
                        if (typeof slot === 'function') {
                          return slot({ ...ctx, section: paramValue as TavernCategoryKey });
                        }
                        return slot ?? null;
                      })()
                    : slotKey === 'settings-category'
                      ? (() => {
                          const slot =
                            slots?.settingsCategories?.[paramValue as SettingsCategoryKey];
                          if (typeof slot === 'function') {
                            return slot({ ...ctx, category: paramValue as SettingsCategoryKey });
                          }
                          return slot ?? null;
                        })()
                      : null}
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
      const [rawInitPathname, ...searchParts] = initialPath.split('?');
      const targetPathname = normalizeMobilePathname(rawInitPathname);
      const targetSearch = searchParts.length > 0 ? `?${searchParts.join('?')}` : '';
      if (
        normalizeMobilePathname(location.pathname) !== targetPathname ||
        location.search !== targetSearch
      ) {
        routerNavigate(`${targetPathname}${targetSearch}`, { replace: true });
      }
    }
  }, [initialPath, location.pathname, location.search, routerNavigate]);

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
      defaultFallbackBackPath = '/m/chat',
    ): MobileRouteSlotContext => ({
      pathname: pagePathname,
      params,
      navigate,
      goBack: (fallbackPath = defaultFallbackBackPath) => goBack(fallbackPath),
      openSettings,
      setCharacterContext,
    }),
    [goBack, navigate, openSettings, setCharacterContext],
  );

  const runtimeContextValue = useMemo<MobileShellRuntimeContextValue>(
    () => ({
      activePathname: normalizedPathname,
      activeSearch: location.search,
      userName,
      userAvatarUrl,
      onOpenSettings: openSettings,
      slots,
      createContext,
    }),
    [
      createContext,
      location.search,
      normalizedPathname,
      openSettings,
      slots,
      userAvatarUrl,
      userName,
    ],
  );

  const effectiveAuroraTint = isStoryScene ? STORY_AURORA_TINT : characterTint;
  const hideTabBar = !activePrimaryTab || settingsOpen || keyboardOpen;

  return (
    <MobileShellRuntimeContext.Provider value={runtimeContextValue}>
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
                  element={<PrimaryTabPage tab={tab} />}
                />
              ))}

              <Route
                path="/m/chat/:conversationKey/card"
                element={
                  <SecondaryRoutePage
                    slotKey="card-fullscreen"
                    routePrefix="/m/chat"
                    routeSuffix="/card"
                    paramName="conversationKey"
                    fallbackBackPath={resolveCardFallbackBackPath}
                    defaultTitle="互动卡片"
                  />
                }
              />

              <Route
                path="/m/chat/:conversationKey"
                element={
                  <SecondaryRoutePage
                    slotKey="chat-detail"
                    routePrefix="/m/chat"
                    paramName="conversationKey"
                    fallbackBackPath="/m/chat"
                    defaultTitle="对话"
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
    </MobileShellRuntimeContext.Provider>
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
