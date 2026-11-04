import React, { useMemo } from 'react';
import {
  Outlet,
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  useParams,
  useRouterState,
  useNavigate,
  type RouterHistory,
} from '@tanstack/react-router';
import { AppShell, type ShellConversationItem } from '../shell/AppShell';
import type { ShellDestination } from '../shell/Sidebar';

export interface ChatRouteProps {
  conversationKey?: string;
}

export interface CharactersRouteProps {
  avatar?: string;
}

export interface StoryRouteProps {
  runId?: string;
}

export interface SettingsRouteProps {
  category: string;
}

export interface TavernSettingsRouteProps {
  section: string;
}

/**
 * Minimal route component slots for T5–T10 feature modules.
 */
export interface DesktopRouteComponents {
  chat?: React.ComponentType<ChatRouteProps>;
  characters?: React.ComponentType<CharactersRouteProps>;
  memory?: React.ComponentType;
  inbox?: React.ComponentType;
  story?: React.ComponentType<StoryRouteProps>;
  settings?: React.ComponentType<SettingsRouteProps>;
  tavernSettings?: React.ComponentType<TavernSettingsRouteProps>;
}

export interface CreateDesktopRouterOptions {
  history?: RouterHistory;
  routeOverrides?: DesktopRouteComponents;
  conversations?: readonly ShellConversationItem[];
}

function DefaultChatPlaceholder({ conversationKey }: ChatRouteProps) {
  return (
    <div className="vc-route-placeholder" data-route="chat" data-conversation-key={conversationKey ?? ''}>
      <p>{conversationKey ? `会话：${conversationKey}` : '选择一个会话开始聊天'}</p>
    </div>
  );
}

function DefaultCharactersPlaceholder({ avatar }: CharactersRouteProps) {
  return (
    <div className="vc-route-placeholder" data-route="characters" data-avatar={avatar ?? ''}>
      <h1 className="vc-large-title" data-vc-owned-title="">角色</h1>
    </div>
  );
}

function DefaultMemoryPlaceholder() {
  return (
    <div className="vc-route-placeholder" data-route="memory">
      <h1 className="vc-large-title" data-vc-owned-title="">记忆</h1>
    </div>
  );
}

function DefaultInboxPlaceholder() {
  return (
    <div className="vc-route-placeholder" data-route="inbox">
      <h1 className="vc-large-title" data-vc-owned-title="">陪伴</h1>
    </div>
  );
}

function DefaultStoryPlaceholder({ runId }: StoryRouteProps) {
  return (
    <div className="vc-route-placeholder" data-route="story" data-run-id={runId ?? ''}>
      <h1 className="vc-large-title" data-vc-owned-title="">剧情</h1>
    </div>
  );
}

function DefaultSettingsPlaceholder({ category }: SettingsRouteProps) {
  return (
    <div className="vc-route-placeholder" data-route="settings" data-category={category}>
      <h1 className="vc-large-title" data-vc-owned-title="">设置</h1>
    </div>
  );
}

function DefaultTavernSettingsPlaceholder({ section }: TavernSettingsRouteProps) {
  return (
    <div className="vc-route-placeholder" data-route="settings-tavern" data-section={section}>
      <h1 className="vc-large-title" data-vc-owned-title="">酒馆设置</h1>
    </div>
  );
}

function resolveShellStateFromPath(pathname: string): {
  destination: ShellDestination;
  settingsActive: boolean;
  conversationKey: string | null;
} {
  const clean = pathname.replace(/^\/+/, '');
  const parts = clean.split('/').filter(Boolean);
  const head = parts[0] ?? 'chat';

  if (head === 'settings') {
    return {
      destination: 'chat',
      settingsActive: true,
      conversationKey: null,
    };
  }
  if (head === 'characters' || head === 'memory' || head === 'inbox' || head === 'story') {
    return {
      destination: head,
      settingsActive: false,
      conversationKey: null,
    };
  }
  return {
    destination: 'chat',
    settingsActive: false,
    conversationKey: parts[1] ? decodeURIComponent(parts[1]) : null,
  };
}

export function createDesktopRouter(options: CreateDesktopRouterOptions = {}) {
  const history = options.history ?? createHashHistory();
  const overrides = options.routeOverrides ?? {};
  const initialConversations = options.conversations ?? [];

  const ChatComp = overrides.chat ?? DefaultChatPlaceholder;
  const CharactersComp = overrides.characters ?? DefaultCharactersPlaceholder;
  const MemoryComp = overrides.memory ?? DefaultMemoryPlaceholder;
  const InboxComp = overrides.inbox ?? DefaultInboxPlaceholder;
  const StoryComp = overrides.story ?? DefaultStoryPlaceholder;
  const SettingsComp = overrides.settings ?? DefaultSettingsPlaceholder;
  const TavernSettingsComp = overrides.tavernSettings ?? DefaultTavernSettingsPlaceholder;

  function RootShellComponent() {
    const pathname = useRouterState({ select: (s) => s.location.pathname });
    const navigate = useNavigate();

    const shellState = useMemo(() => resolveShellStateFromPath(pathname), [pathname]);

    return (
      <AppShell
        destination={shellState.destination}
        settingsActive={shellState.settingsActive}
        activeConversationKey={shellState.conversationKey}
        conversations={initialConversations}
        onSelectDestination={(nav) => {
          void navigate({ to: `/${nav}` });
        }}
        onOpenSettings={() => {
          void navigate({ to: '/settings/$category', params: { category: 'account' } });
        }}
        onSelectConversation={(item) => {
          void navigate({
            to: '/chat/$conversationKey',
            params: { conversationKey: item.key },
          });
        }}
      >
        <Outlet />
      </AppShell>
    );
  }

  const rootRoute = createRootRoute({
    component: RootShellComponent,
  });

  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    beforeLoad: () => {
      throw redirect({ to: '/chat' });
    },
  });

  const chatIndexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/chat',
    component: function ChatIndexPage() {
      return <ChatComp />;
    },
  });

  const chatConversationRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/chat/$conversationKey',
    component: function ChatConversationPage() {
      const { conversationKey } = useParams({ from: chatConversationRoute.id });
      return <ChatComp conversationKey={conversationKey} />;
    },
  });

  const charactersIndexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/characters',
    component: function CharactersIndexPage() {
      return <CharactersComp />;
    },
  });

  const characterDetailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/characters/$avatar',
    component: function CharacterDetailPage() {
      const { avatar } = useParams({ from: characterDetailRoute.id });
      return <CharactersComp avatar={avatar} />;
    },
  });

  const memoryRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/memory',
    component: function MemoryPage() {
      return <MemoryComp />;
    },
  });

  const inboxRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/inbox',
    component: function InboxPage() {
      return <InboxComp />;
    },
  });

  const storyIndexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/story',
    component: function StoryIndexPage() {
      return <StoryComp />;
    },
  });

  const storyRunRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/story/$runId',
    component: function StoryRunPage() {
      const { runId } = useParams({ from: storyRunRoute.id });
      return <StoryComp runId={runId} />;
    },
  });

  const settingsIndexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/settings',
    beforeLoad: () => {
      throw redirect({ to: '/settings/$category', params: { category: 'account' } });
    },
  });

  const settingsCategoryRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/settings/$category',
    component: function SettingsCategoryPage() {
      const { category } = useParams({ from: settingsCategoryRoute.id });
      return <SettingsComp category={category} />;
    },
  });

  const settingsTavernRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/settings/tavern/$section',
    component: function SettingsTavernPage() {
      const { section } = useParams({ from: settingsTavernRoute.id });
      return <TavernSettingsComp section={section} />;
    },
  });

  const routeTree = rootRoute.addChildren([
    indexRoute,
    chatIndexRoute,
    chatConversationRoute,
    charactersIndexRoute,
    characterDetailRoute,
    memoryRoute,
    inboxRoute,
    storyIndexRoute,
    storyRunRoute,
    settingsIndexRoute,
    settingsCategoryRoute,
    settingsTavernRoute,
  ]);

  return createRouter({
    routeTree,
    history,
  });
}
