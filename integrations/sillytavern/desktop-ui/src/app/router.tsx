import React, { useMemo } from 'react';
import {
    Outlet,
    createHashHistory,
    createMemoryHistory,
    createRootRoute,
    createRoute,
    createRouter,
    redirect,
    useNavigate,
    useParams,
    useRouterState,
    type RouterHistory,
} from '@tanstack/react-router';
import { useConversationsQuery } from '../data/queries/chat';
import { IconButton } from '../design/components/IconButton';
import { ChatCharacterPanel } from '../features/chat/ChatCharacterPanel';
import {
    ChatComposerSlot,
    ChatRoute,
    ChatUiProvider,
    useChatUi,
    type ChatRouteProps,
} from '../features/chat/ChatRoute';
import { ChatStatusCard } from '../features/chat/ChatStatusCard';
import { ConversationList } from '../features/chat/ConversationList';
import {
    CharactersRoute,
    type CharactersRouteProps,
} from '../features/characters/CharactersRoute';
import { InboxRoute } from '../features/inbox/InboxRoute';
import { MemoryRoute } from '../features/memory/MemoryRoute';
import {
    SettingsRoute,
    type SettingsRouteProps,
} from '../features/settings/SettingsRoute';
import {
    StoryRoute,
    type StoryRouteProps,
} from '../features/story/StoryRoute';
import { TavernRoute } from '../features/tavern/TavernRoute';
import { useChatSnapshot } from '../runtime/session-bridge';
import { AppShell, useShellLayout, type ShellConversationItem } from '../shell/AppShell';
import type { ShellDestination } from '../shell/Sidebar';

export type { ChatRouteProps, CharactersRouteProps, StoryRouteProps, SettingsRouteProps };

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
    initialEntry?: string;
    routeOverrides?: DesktopRouteComponents;
    conversations?: readonly ShellConversationItem[];
}

function DefaultStoryRoute({ runId }: StoryRouteProps) {
    const navigate = useNavigate();
    return (
        <StoryRoute
            runId={runId}
            onConfigure={() => {
                void navigate({ to: '/settings/$category', params: { category: 'model' } });
            }}
        />
    );
}

function DefaultTavernSettingsRoute({ section }: TavernSettingsRouteProps) {
    const navigate = useNavigate();
    const initialCharacter = useRouterState({
        select: s => {
            const raw = (s.location.search as Record<string, unknown> | undefined)
                ?.character;
            return typeof raw === 'string' && raw ? raw : undefined;
        },
    });
    return (
        <TavernRoute
            section={section}
            initialCharacter={initialCharacter}
            onNavigateCategory={category => {
                void navigate({ to: '/settings/$category', params: { category } });
            }}
            onNavigateTavern={nextSection => {
                void navigate({
                    to: '/settings/tavern/$section',
                    params: { section: nextSection },
                });
            }}
        />
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
    if (
        head === 'characters' ||
        head === 'memory' ||
        head === 'inbox' ||
        head === 'story'
    ) {
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

function DesktopChatHeader({
    title,
    hasActiveConversation,
    onOpenMemory,
}: {
    title: string;
    hasActiveConversation: boolean;
    onOpenMemory: () => void;
}) {
    const {
        chrome,
        characterPanelOpen,
        setCharacterPanelOpen,
        toggleCharacterPanel,
        setConversationListOpen,
    } = useShellLayout();
    const chatUi = useChatUi();

    const handleReopenList = () => {
        setConversationListOpen(true);
        if (chrome === 'regular' && characterPanelOpen) {
            setCharacterPanelOpen(false);
        }
    };

    return (
        <>
            <div className="vc-chat-header__lead">
                <IconButton
                    icon="panel-left"
                    iconSize={18}
                    className="vc-icon-btn"
                    data-list-toggle=""
                    data-chat-back=""
                    aria-label="返回会话列表"
                    title="会话列表"
                    onClick={handleReopenList}
                />
                <ChatStatusCard
                    onOpenMemory={onOpenMemory}
                    trigger={
                        <button type="button" className="vc-chat-header__title-btn">
                            <h1 className="vc-chat-header__title">{title}</h1>
                        </button>
                    }
                />
            </div>
            <div className="vc-chat-header__actions">
                <IconButton
                    icon="search"
                    iconSize={18}
                    className="vc-icon-btn vc-desk-search-toggle"
                    aria-label="搜索聊天内容"
                    title="搜索聊天内容 (⌘F)"
                    onClick={() => chatUi?.toggleSearch()}
                />
                <IconButton
                    icon="user-round"
                    iconSize={18}
                    active={characterPanelOpen}
                    className="vc-icon-btn"
                    data-panel-toggle=""
                    hidden={!hasActiveConversation}
                    disabled={!hasActiveConversation}
                    aria-label={characterPanelOpen ? '收起角色档案' : '展开角色档案'}
                    aria-expanded={characterPanelOpen}
                    title="角色档案"
                    onClick={toggleCharacterPanel}
                />
            </div>
        </>
    );
}

export function createDesktopRouter(
    optionsOrInitialEntry: CreateDesktopRouterOptions | string = {},
) {
    const options: CreateDesktopRouterOptions =
        typeof optionsOrInitialEntry === 'string'
            ? { initialEntry: optionsOrInitialEntry }
            : optionsOrInitialEntry;

    const history =
        options.history ??
        (options.initialEntry
            ? createMemoryHistory({ initialEntries: [options.initialEntry] })
            : createHashHistory());
    const overrides = options.routeOverrides ?? {};
    const staticConversations = options.conversations ?? [];

    const CustomChatComp = overrides.chat;
    const CharactersComp = overrides.characters ?? CharactersRoute;
    const MemoryComp = overrides.memory ?? MemoryRoute;
    const InboxComp = overrides.inbox ?? InboxRoute;
    const StoryComp = overrides.story ?? DefaultStoryRoute;
    const SettingsComp = overrides.settings ?? SettingsRoute;
    const TavernSettingsComp =
        overrides.tavernSettings ?? DefaultTavernSettingsRoute;

    function RootShellComponent() {
        const pathname = useRouterState({ select: s => s.location.pathname });
        const navigate = useNavigate();
        const activeSnapshotKey = useChatSnapshot(s => s.key);
        const activeCharName = useChatSnapshot(s => s.characterName);
        const activeCharAvatar = useChatSnapshot(s => s.avatar);
        const activeCharAvatarUrl = useChatSnapshot(s => s.avatarUrl);
        const { rows: queriedConversations } = useConversationsQuery();

        const shellState = useMemo(() => resolveShellStateFromPath(pathname), [pathname]);
        const effectiveConversationKey =
            shellState.conversationKey ?? (activeSnapshotKey || null);

        const mergedConversations = useMemo<readonly ShellConversationItem[]>(() => {
            if (staticConversations.length > 0) return staticConversations;
            return queriedConversations.map(row => ({
                key: row.key,
                title: row.title,
                avatar: row.avatarUrl || row.avatar,
                preview: row.preview,
                updatedAt: row.timeText,
                relationshipId: row.relationshipId,
            }));
        }, [staticConversations, queriedConversations]);

        const resolvedTitle =
            activeCharName ||
            mergedConversations.find(c => c.key === effectiveConversationKey)?.title ||
            '选择一个会话开始聊天';

        const handleOpenSettings = () => {
            void navigate({ to: '/settings/$category', params: { category: 'account' } });
        };

        const handleOpenMemory = () => {
            void navigate({ to: '/memory' });
        };

        return (
            <ChatUiProvider>
                <AppShell
                    destination={shellState.destination}
                    settingsActive={shellState.settingsActive}
                    activeConversationKey={effectiveConversationKey}
                    activeCharacterId={activeCharAvatar || null}
                    activeCharacterName={activeCharName}
                    activeCharacterAvatar={activeCharAvatarUrl}
                    conversations={mergedConversations}
                    conversationListSlot={
                        <ConversationList
                            rows={queriedConversations}
                            activeKey={effectiveConversationKey}
                            onSelectConversation={row => {
                                void navigate({
                                    to: '/chat/$conversationKey',
                                    params: { conversationKey: row.key },
                                });
                            }}
                        />
                    }
                    chatHeaderSlot={
                        <DesktopChatHeader
                            title={resolvedTitle}
                            hasActiveConversation={Boolean(effectiveConversationKey)}
                            onOpenMemory={handleOpenMemory}
                        />
                    }
                    characterPanel={<ChatCharacterPanel />}
                    composer={<ChatComposerSlot />}
                    persistentChatSlot={
                        CustomChatComp ? undefined : (
                            <ChatRoute
                                conversationKey={shellState.conversationKey ?? undefined}
                                hideComposer
                                onOpenSettings={() => {
                                    void navigate({
                                        to: '/settings/$category',
                                        params: { category: 'model' },
                                    });
                                }}
                            />
                        )
                    }
                    onSelectDestination={nav => {
                        void navigate({ to: `/${nav}` });
                    }}
                    onOpenSettings={handleOpenSettings}
                    onSelectConversation={item => {
                        void navigate({
                            to: '/chat/$conversationKey',
                            params: { conversationKey: item.key },
                        });
                    }}
                >
                    <Outlet />
                </AppShell>
            </ChatUiProvider>
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
            return CustomChatComp ? <CustomChatComp /> : null;
        },
    });

    const chatConversationRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: '/chat/$conversationKey',
        component: function ChatConversationPage() {
            const { conversationKey } = useParams({ from: chatConversationRoute.id });
            return CustomChatComp ? (
                <CustomChatComp conversationKey={conversationKey} />
            ) : null;
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
