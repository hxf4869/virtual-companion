import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { PortalHostProvider } from '../design/portal-host';
import { Avatar } from '../design/components/Avatar';
import { Icon } from '../design/components/Icon';
import { Aurora } from './Aurora';
import { OverlayHost } from './OverlayHost';
import { QuickSwitch, type QuickSwitchItem } from './QuickSwitch';
import { Sidebar, type ShellDestination } from './Sidebar';
import { useChrome, type ChromeTier } from './useChrome';
import { usePreferences } from './usePreferences';
import { useReducedMotion } from './useReducedMotion';
import './AppShell.css';

export interface ShellConversationItem extends QuickSwitchItem {
  unread?: boolean;
}

export interface ShellLayoutContextValue {
  chrome: ChromeTier;
  characterPanelOpen: boolean;
  setCharacterPanelOpen: (open: boolean) => void;
  toggleCharacterPanel: () => void;
  conversationListOpen: boolean;
  setConversationListOpen: (open: boolean) => void;
  openQuickSwitch: () => void;
}

const ShellLayoutContext = createContext<ShellLayoutContextValue | null>(null);

export function useShellLayout(): ShellLayoutContextValue {
  const ctx = useContext(ShellLayoutContext);
  if (!ctx) {
    throw new Error('useShellLayout must be used within <AppShell>');
  }
  return ctx;
}

export interface AppShellProps {
  destination: ShellDestination;
  settingsActive?: boolean;
  activeConversationKey?: string | null;
  activeCharacterId?: string | null;
  activeCharacterName?: string;
  activeCharacterAvatar?: string;
  conversations?: readonly ShellConversationItem[];
  inboxBadge?: number;
  chatDot?: boolean;
  conversationListSlot?: React.ReactNode;
  chatHeaderSlot?: React.ReactNode;
  characterPanel?: React.ReactNode;
  composer?: React.ReactNode;
  onSelectDestination?: (nav: ShellDestination) => void;
  onOpenSettings?: () => void;
  onSelectConversation?: (item: ShellConversationItem) => void;
  children?: React.ReactNode;
}

export function AppShell({
  destination,
  settingsActive = false,
  activeConversationKey = null,
  activeCharacterId = null,
  activeCharacterName = '',
  activeCharacterAvatar = '',
  conversations = [],
  inboxBadge = 0,
  chatDot = false,
  conversationListSlot,
  chatHeaderSlot,
  characterPanel,
  composer,
  onSelectDestination,
  onOpenSettings,
  onSelectConversation,
  children,
}: AppShellProps) {
  const chrome = useChrome();
  useReducedMotion();

  const sidebarCollapsed = usePreferences((s) => s.sidebarCollapsed);
  const toggleSidebarCollapsed = usePreferences((s) => s.toggleSidebarCollapsed);
  const characterTint = usePreferences((s) => s.characterTint);
  const syncFromStorage = usePreferences((s) => s.syncFromStorage);

  const isCompactOrNarrow = chrome === 'compact' || chrome === 'narrow';
  const effectiveSidebarCollapsed = isCompactOrNarrow ? true : sidebarCollapsed;

  const [panelOpen, setPanelOpen] = useState<boolean>(() => chrome === 'wide');
  const [compactListOpen, setCompactListOpen] = useState<boolean>(
    () => !activeConversationKey,
  );
  const [quickSwitchOpen, setQuickSwitchOpen] = useState(false);

  const prevChromeRef = useRef<ChromeTier>(chrome);
  useLayoutEffect(() => {
    if (prevChromeRef.current !== chrome) {
      prevChromeRef.current = chrome;
      setPanelOpen(chrome === 'wide');
      if (chrome === 'compact' || chrome === 'narrow') {
        setCompactListOpen(!activeConversationKey);
      }
    }
  }, [chrome, activeConversationKey]);

  const prevConversationKeyRef = useRef<string | null>(activeConversationKey);
  useLayoutEffect(() => {
    if (prevConversationKeyRef.current !== activeConversationKey) {
      prevConversationKeyRef.current = activeConversationKey;
      if (isCompactOrNarrow) {
        setCompactListOpen(!activeConversationKey);
      }
    }
  }, [activeConversationKey, isCompactOrNarrow]);

  // Re-read persisted preferences when switching destination or character (fixes B11)
  useEffect(() => {
    syncFromStorage(activeCharacterId ?? activeConversationKey ?? null);
  }, [destination, settingsActive, activeCharacterId, activeConversationKey, syncFromStorage]);

  const isChatMode = destination === 'chat' && !settingsActive;

  // Conversation list visibility across the 4 chrome tiers:
  // - wide (>=1600): always visible in chat mode
  // - regular (1180-1599): yields when 340px character panel is open
  // - compact / narrow (<1180): visible before entering conversation, or when reopened via list toggle
  const listVisible = isChatMode
    ? chrome === 'wide'
      ? true
      : chrome === 'regular'
        ? !panelOpen
        : compactListOpen
    : false;

  const toggleCharacterPanel = useCallback(() => {
    setPanelOpen((prev) => !prev);
  }, []);

  const handleReopenList = useCallback(() => {
    setCompactListOpen(true);
    if (chrome === 'regular' && panelOpen) {
      setPanelOpen(false);
    }
  }, [chrome, panelOpen]);

  const overlayHostRef = useRef<HTMLDivElement | null>(null);
  const toastHostRef = useRef<HTMLDivElement | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const mainEl = mainRef.current;
    const toastEl = toastHostRef.current;
    if (!mainEl || !toastEl) return undefined;

    const syncToastBounds = () => {
      const rect = mainEl.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        toastEl.style.top = `${rect.top}px`;
        toastEl.style.left = `${rect.left}px`;
        toastEl.style.width = `${rect.width}px`;
        toastEl.style.height = `${rect.height}px`;
        toastEl.style.right = 'auto';
        toastEl.style.bottom = 'auto';
      }
    };

    syncToastBounds();

    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(syncToastBounds);
      ro.observe(mainEl);
      return () => ro.disconnect();
    }
    return undefined;
  }, [chrome, listVisible, panelOpen, effectiveSidebarCollapsed, destination, settingsActive]);

  const layoutMode = useMemo(() => {
    if (!isChatMode) return 'single-main';
    if (!isCompactOrNarrow) {
      if (listVisible && panelOpen) return 'four-col';
      if (!listVisible && panelOpen) return 'main-panel';
      return 'list-main';
    }
    return listVisible ? 'list-main' : 'main-only';
  }, [isChatMode, isCompactOrNarrow, listVisible, panelOpen]);

  const layoutContextValue = useMemo<ShellLayoutContextValue>(
    () => ({
      chrome,
      characterPanelOpen: panelOpen,
      setCharacterPanelOpen: setPanelOpen,
      toggleCharacterPanel,
      conversationListOpen: listVisible,
      setConversationListOpen: setCompactListOpen,
      openQuickSwitch: () => setQuickSwitchOpen(true),
    }),
    [chrome, panelOpen, toggleCharacterPanel, listVisible],
  );

  const activeConversation = useMemo(
    () => conversations.find((c) => c.key === activeConversationKey) ?? null,
    [conversations, activeConversationKey],
  );

  const resolvedTitle =
    activeCharacterName || activeConversation?.title || '选择一个会话开始聊天';
  const resolvedAvatar =
    activeCharacterAvatar || activeConversation?.avatar || '';

  return (
    <PortalHostProvider container={overlayHostRef} toastContainer={toastHostRef}>
      <ShellLayoutContext.Provider value={layoutContextValue}>
        <Aurora characterTint={characterTint} />
        <OverlayHost ref={overlayHostRef} toastRef={toastHostRef} />

        <div
          id="vc-shell"
          className="vc-shell"
          data-chrome={chrome}
          data-destination={destination}
          data-settings={settingsActive ? 'open' : 'closed'}
          data-sidebar={effectiveSidebarCollapsed ? 'collapsed' : 'expanded'}
          data-layout={layoutMode}
          data-panel-open={panelOpen ? 'true' : 'false'}
          data-list-open={listVisible ? 'true' : 'false'}
        >
          <Sidebar
            chrome={chrome}
            activeDestination={destination}
            settingsActive={settingsActive}
            collapsed={effectiveSidebarCollapsed}
            inboxBadge={inboxBadge}
            chatDot={chatDot}
            characterName={resolvedTitle}
            characterAvatarUrl={resolvedAvatar}
            onSelectDestination={onSelectDestination}
            onOpenSettings={onOpenSettings}
            onToggleCollapse={toggleSidebarCollapsed}
          />

          {isChatMode ? (
            <section
              className="vc-convo-list vc-panel"
              data-convo-list=""
              aria-label="会话列表"
              hidden={!listVisible}
            >
              {conversationListSlot ?? (
                <>
                  <header className="vc-convo-head">
                    <h2 className="vc-convo-title">会话</h2>
                    <button
                      type="button"
                      className="vc-icon-btn"
                      data-quick-switch-trigger=""
                      aria-label="搜索会话 (⌘K)"
                      title="搜索会话 (⌘K)"
                      onClick={() => setQuickSwitchOpen(true)}
                    >
                      <Icon name="search" size={18} />
                    </button>
                  </header>
                  <div className="vc-convo-items">
                    {conversations.map((item) => {
                      const isActive = item.key === activeConversationKey;
                      return (
                        <button
                          key={item.key}
                          type="button"
                          className={['vc-convo-row', isActive ? 'is-active' : '']
                            .filter(Boolean)
                            .join(' ')}
                          data-conversation-key={item.key}
                          data-relationship-id={item.relationshipId || undefined}
                          onClick={() => {
                            if (isCompactOrNarrow) {
                              setCompactListOpen(false);
                            }
                            onSelectConversation?.(item);
                          }}
                        >
                          <Avatar src={item.avatar} name={item.title || '伴'} size={40} />
                          <span className="vc-convo-meta">
                            <span className="vc-convo-name">{item.title}</span>
                            {item.preview ? (
                              <span className="vc-convo-preview">{item.preview}</span>
                            ) : null}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </section>
          ) : null}

          <main
            ref={mainRef}
            className={['vc-main', 'vc-panel', isChatMode ? 'vc-chat-main' : '']
              .filter(Boolean)
              .join(' ')}
            data-shell-main=""
          >
            {isChatMode ? (
              <>
                <header className="vc-chat-header" data-chat-header="">
                  {chatHeaderSlot ?? (
                    <>
                      <div className="vc-chat-header__lead">
                        <button
                          type="button"
                          className="vc-icon-btn"
                          data-list-toggle=""
                          data-chat-back=""
                          aria-label="返回会话列表"
                          title="会话列表"
                          onClick={handleReopenList}
                        >
                          <Icon name="panel-left" size={18} />
                        </button>
                        <h1 className="vc-chat-header__title">{resolvedTitle}</h1>
                      </div>
                      <div className="vc-chat-header__actions">
                        <button
                          type="button"
                          className="vc-icon-btn"
                          data-panel-toggle=""
                          aria-label={panelOpen ? '收起角色档案' : '展开角色档案'}
                          aria-expanded={panelOpen}
                          title="角色档案"
                          onClick={toggleCharacterPanel}
                        >
                          <Icon name="user-round" size={18} />
                        </button>
                      </div>
                    </>
                  )}
                </header>

                <div className="vc-chat-body" data-chat-body="">
                  <div className="vc-chat-content" data-chat-content="">
                    {children}
                  </div>
                  {isCompactOrNarrow ? (
                    <aside
                      className="vc-char-panel vc-char-panel--floating"
                      data-char-panel=""
                      aria-label="角色小档案"
                      hidden={!panelOpen}
                    >
                      {characterPanel}
                    </aside>
                  ) : null}
                </div>

                {composer !== undefined ? (
                  <div className="vc-chat-composer" data-chat-composer="">
                    {composer}
                  </div>
                ) : null}
              </>
            ) : (
              children
            )}
          </main>

          {isChatMode && !isCompactOrNarrow ? (
            <aside
              className="vc-char-panel vc-panel"
              data-char-panel=""
              aria-label="角色小档案"
              hidden={!panelOpen}
            >
              {characterPanel}
            </aside>
          ) : null}
        </div>

        <QuickSwitch
          open={quickSwitchOpen}
          onOpenChange={setQuickSwitchOpen}
          items={conversations}
          onSelect={(item) => {
            if (isCompactOrNarrow) {
              setCompactListOpen(false);
            }
            onSelectConversation?.(item);
          }}
        />
      </ShellLayoutContext.Provider>
    </PortalHostProvider>
  );
}
