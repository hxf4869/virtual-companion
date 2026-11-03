import { VoiceBubble, type VoiceBubbleProps } from './features/story/VoiceBubble';
import { Stickers, StickerEntry, type StickersProps } from './features/story/Stickers';
import { Lightbox, type LightboxProps } from './features/story/Lightbox';
import { Story, type StoryProps } from './features/story/Story';
import { StatusCard, type StatusCardProps } from './features/chat/StatusCard';
import { Conversations, type ConversationsProps } from './features/chat/Conversations';
import { CharacterPanel, RecalledEditor, type CharacterPanelProps, type RecalledEditorProps } from './features/chat/CharacterPanel';
import { Suggestions } from './features/chat/Suggestions';
import { EmojiPanel, type EmojiPanelProps } from './features/chat/EmojiPanel';
import { ReactionToolbar, type ReactionToolbarProps } from './features/chat/ReactionToolbar';
import { QuoteBar, MessageTools, type QuoteProps, type MessageToolsProps } from './features/chat/ComposeBits';
import { MemoryInspector, type InspectorProps } from './features/chat/MemoryInspector';
import { QuickSwitch, type QuickSwitchProps } from './features/chat/QuickSwitch';
import { ChatSearch, type ChatSearchProps } from './features/chat/Search';
import { ConsentGate, type ConsentGateProps } from './features/settings/ConsentGate';
import { ShellFrame, Tabbar, ChatIdentity, type ShellFrameProps, type ChatIdentityProps } from './features/shell/ShellFrame';
import { SettingsFrame, DrawerEntry, type SettingsFrameProps } from './features/settings/SettingsFrame';
import { createRef, Fragment, type ReactNode } from 'react';
import { MenuView, AlertView, SheetView, SheetLayer, type MenuViewProps, type AlertViewProps, type SheetViewProps } from './components/Overlays';
import type { Menu } from '@base-ui/react/menu';
import type { AlertDialog } from '@base-ui/react/alert-dialog';
import type { Dialog } from '@base-ui/react/dialog';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Appearance } from './features/appearance/Appearance';
import type { AppearanceProps } from './features/appearance/types';
import { Sidebar, type SidebarProps } from './components/Sidebar';
import { IconButton } from './components/IconButton';
import { ModelPage, type ModelPageProps } from './features/models/ModelPage';
import { VoiceForm, type VoiceFormProps } from './features/settings/VoiceForm';
import { SettingsOverview, type SettingsOverviewProps } from './features/settings/SettingsOverview';
import { AccountDialog, type AccountDialogProps } from './features/settings/AccountDialog';
import { Characters, InstanceContents, PersonaEditor, type CharactersProps, type PersonaProps } from './features/characters/Characters';
import { MemoryList, MemoryDetail, MemoryContents, MemoryLayer, type MemoryProps, type MemoryLayerProps } from './features/memory/Memory';
import { InboxList, InboxChannel } from './features/inbox/Inbox';
import { InboxContents } from './features/inbox/InboxContents';
import { InboxConflict, InboxReauth } from './features/inbox/Layers';
import type { InboxProps } from './features/inbox/types';
export { voiceFormValues } from './features/settings/VoiceForm';

export type { AppearanceProps } from './features/appearance/types';
export type { SidebarProps } from './components/Sidebar';
export type { ModelPageProps } from './features/models/ModelPage';

export function mountVoiceBubbleView(container: HTMLElement, props: VoiceBubbleProps) {
    const root = createRoot(container); flushSync(() => root.render(<VoiceBubble {...props} />));
    return () => root.unmount();
}
export function mountStickerEntryView(host: HTMLElement, props: { sprite: string; open(button: HTMLElement): void }) {
    const button = createRef<HTMLButtonElement>();
    const mount = overlayMount(host, null, nested => <StickerEntry {...props} host={host} button={button} nested={nested} />);
    mount.render(); mount.own(button.current!);
    return { button: button.current!, unmount: mount.unmount };
}
export function mountStickerContentsView(container: HTMLElement, props: StickersProps, opener: HTMLElement | null = null) {
    let current = props;
    const mount = overlayMount(container, opener, nested => <Stickers p={current} container={container} nested={nested} />, container);
    mount.own(container); mount.render();
    return { update(next: StickersProps) { current = next; mount.render(); }, unmount: mount.unmount };
}
export function mountLightboxView(container: HTMLElement, props: LightboxProps, opener: HTMLElement | null) {
    let current = props; const popup = createRef<HTMLDivElement>(), img = createRef<HTMLImageElement>();
    const mount = overlayMount(container, opener, nested => <Lightbox p={current} host={container} popup={popup} img={img} onPopup={node => mount.own(node)} nested={nested} />);
    mount.render();
    return { el: popup.current!, img: img.current!, update(next: LightboxProps) { current = next; mount.render(); }, unmount: mount.unmount };
}
export function mountStoryView(container: HTMLElement, props: StoryProps, owner: HTMLElement = container) {
    let current = props;
    const mount = overlayMount(container, null, nested => <><Story {...current} />{nested}</>, container);
    mount.own(owner); mount.render();
    return { update(next: StoryProps) { current = next; mount.render(); }, unmount: mount.unmount };
}
export function mountStatusCardView(container: HTMLElement, props: StatusCardProps) {
    let current = props; const popup = createRef<HTMLDivElement>();
    const mount = overlayMount(container, props.anchor, nested => <StatusCard p={current} host={container} popup={popup} onPopup={node => mount.own(node)} nested={nested} />);
    mount.render();
    return { el: popup.current!, update(next: StatusCardProps) { current = next; mount.render(); }, unmount: mount.unmount };
}
export function mountConversationsView(container: HTMLElement, props: ConversationsProps) {
    const root = createRoot(container); let disposed = false;
    const update = (next: ConversationsProps) => { if (!disposed) flushSync(() => root.render(<Conversations {...next} />)); }; update(props);
    return { update, unmount() { if (disposed) return; disposed = true; root.unmount(); } };
}
export function mountCharacterPanelView(container: HTMLElement, tools: HTMLElement, props: CharacterPanelProps) {
    const toggle = createRef<HTMLButtonElement>();
    let current = props;
    const mount = overlayMount(container, null, nested => <><CharacterPanel p={current} tools={tools} toggle={toggle} />{nested}</>, container);
    mount.own(container); mount.render();
    return { toggle: toggle.current!, update(next: CharacterPanelProps) { current = next; mount.render(); }, unmount: mount.unmount };
}
export function recalledEditorContent(props: RecalledEditorProps) { return <RecalledEditor {...props} />; }
export function mountSuggestionsView(container: HTMLElement, props: Parameters<typeof Suggestions>[0]) {
    const root = createRoot(container); let disposed = false;
    const update = (next: typeof props) => { if (!disposed) flushSync(() => root.render(<Suggestions {...next} />)); }; update(props);
    return { update, unmount() { if (disposed) return; disposed = true; root.unmount(); } };
}
export function mountEmojiPanelView(container: HTMLElement, props: EmojiPanelProps, opener: HTMLElement | null) {
    let current = props;
    const popup = createRef<HTMLDivElement>();
    const mount = overlayMount(container, opener, nested => <EmojiPanel p={current} host={container} popup={popup} onPopup={node => mount.own(node)} nested={nested} />);
    mount.render();
    return { el: popup.current!, update(next: EmojiPanelProps) { current = next; mount.render(); }, unmount: mount.unmount };
}
export function mountReactionToolbarView(container: HTMLElement, props: ReactionToolbarProps) {
    const root = createRoot(container); let disposed = false;
    const update = (next: ReactionToolbarProps) => { if (!disposed) flushSync(() => root.render(<ReactionToolbar {...next} />)); }; update(props);
    return { update, unmount() { if (disposed) return; disposed = true; root.unmount(); } };
}
export function mountQuoteView(container: HTMLElement, props: QuoteProps) {
    const root = createRoot(container); let disposed = false;
    const update = (next: QuoteProps) => { if (!disposed) flushSync(() => root.render(<QuoteBar {...next} />)); }; update(props);
    return { update, unmount() { if (disposed) return; disposed = true; root.unmount(); } };
}
export function mountMessageToolsView(container: HTMLElement, props: MessageToolsProps) {
    const root = createRoot(container); let disposed = false;
    const update = (next: MessageToolsProps) => { if (!disposed) flushSync(() => root.render(<MessageTools {...next} />)); }; update(props);
    return { update, unmount() { if (disposed) return; disposed = true; root.unmount(); } };
}

export function mountMemoryInspectorView(container: HTMLElement, props: InspectorProps) {
    let current = props;
    const mount = overlayMount(container, null, nested => <MemoryInspector p={current} container={container} nested={nested} />);
    mount.own(container); mount.render();
    return { update(next: InspectorProps) { current = next; mount.render(); }, unmount: mount.unmount };
}

export function mountQuickSwitchView(container: HTMLElement, props: QuickSwitchProps) {
    const mount = overlayMount(container, props.opener, nested => <QuickSwitch p={props} host={container} onPopup={node => mount.own(node)} nested={nested} />);
    mount.render();
    return { unmount: mount.unmount };
}

export function mountChatSearchView(container: HTMLElement, props: ChatSearchProps) {
    const root = createRoot(container), refs = { toggle: createRef<HTMLButtonElement>(), bar: createRef<HTMLDivElement>(), input: createRef<HTMLInputElement>() };
    let disposed = false;
    const update = (next: ChatSearchProps) => { if (!disposed) flushSync(() => root.render(<ChatSearch p={next} refs={refs} />)); };
    update(props);
    return { toggle: refs.toggle.current!, bar: refs.bar.current!, input: refs.input.current!, update, unmount() { if (disposed) return; disposed = true; root.unmount(); } };
}

// 兼容现有同步挂载入口；只有本容器子树归 React，ST 原生节点不进入此 root。
export function mountAppearanceView(container: HTMLElement, props: AppearanceProps): () => void {
    const mount = overlayMount(container, null, nested => <><Appearance {...props} />{nested}</>, container);
    mount.own(container); mount.render();
    return mount.unmount;
}

export function mountSidebarView(container: HTMLElement, props: SidebarProps) {
    const root = createRoot(container);
    const update = (next: SidebarProps) => flushSync(() => root.render(<Sidebar {...next} />));
    update(props);
    return { update, unmount: () => root.unmount() };
}

export function mountSettingsHeaderView(container: HTMLElement, { sprite }: { sprite: string }): () => void {
    const root = createRoot(container);
    flushSync(() => root.render(<IconButton sprite={sprite} icon="settings" label="设置"
        className="vc-settings-category-toggle" data-settings-categories="" />));
    return () => root.unmount();
}

export function mountModelPageView(container: HTMLElement, props: Omit<ModelPageProps, 'host' | 'onPopup' | 'nested'>) {
    let current = props;
    const mount = overlayMount(container, null, nested => <ModelPage {...current} host={container} nested={nested} onPopup={node => mount.own(node)} />, container);
    mount.render(); return { update(next: typeof props) { current = next; mount.render(); }, unmount: mount.unmount };
}

export function mountVoiceFormView(container: HTMLElement, props: VoiceFormProps) {
    const root = createRoot(container);
    const update = (next: VoiceFormProps) => flushSync(() => root.render(<VoiceForm {...next} />));
    update(props);
    return { update, unmount: () => root.unmount() };
}

export function mountCharactersView(container: HTMLElement, props: CharactersProps) {
    let current = props;
    const mount = overlayMount(container, null, nested => <><Characters {...current} />{nested}</>, container);
    mount.own(container); mount.render();
    return { update(next: CharactersProps) { current = next; mount.render(); }, unmount: mount.unmount };
}
export function mountInstanceContentsView(container: HTMLElement, props: CharactersProps) {
    const root = createRoot(container);
    const update = (next: CharactersProps) => flushSync(() => root.render(<InstanceContents {...next} host={container.ownerDocument.body} />));
    update(props); return { update, unmount: () => root.unmount() };
}
export function mountPersonaView(container: HTMLElement, props: PersonaProps) {
    const root = createRoot(container);
    const update = (next: PersonaProps) => flushSync(() => root.render(<PersonaEditor {...next} />));
    update(props); return { update, unmount: () => root.unmount() };
}
export function mountMemoryListView(container: HTMLElement, props: MemoryProps) {
    let current = props;
    const mount = overlayMount(container, null, nested => <><MemoryList {...current} />{nested}</>, container);
    mount.own(container); mount.render();
    return { update(next: MemoryProps) { current = next; mount.render(); }, unmount: mount.unmount };
}
export function mountMemoryDetailView(container: HTMLElement, props: MemoryProps) {
    const root = createRoot(container);
    const update = (next: MemoryProps) => flushSync(() => root.render(<MemoryDetail {...next} />));
    update(props); return { update, unmount: () => root.unmount() };
}
export function mountMemoryContentsView(container: HTMLElement, props: MemoryProps) {
    const root = createRoot(container);
    const update = (next: MemoryProps) => flushSync(() => root.render(<MemoryContents {...next} />));
    update(props); return { update, unmount: () => root.unmount() };
}
export function mountMemoryLayerView(container: HTMLElement, props: Omit<MemoryLayerProps, 'onPopup' | 'nested' | 'container'>) {
    const popupRef = createRef<HTMLDivElement>(); let current = props;
    const mount = overlayMount(container, null, nested => <MemoryLayer {...current} container={container} popupRef={popupRef} onPopup={node => mount.own(node)} nested={nested} />, container);
    mount.render(); return { update(next: typeof props) { current = next; mount.render(); }, unmount: mount.unmount };
}
export function mountInboxListView(container: HTMLElement, props: InboxProps) {
    let current = props;
    const mount = overlayMount(container, null, nested => <><InboxList {...current} />{nested}</>, container);
    mount.own(container); mount.render();
    return { update(next: InboxProps) { current = next; mount.render(); }, unmount: mount.unmount };
}
export function mountInboxChannelView(container: HTMLElement, props: InboxProps & { channelKey: string }) {
    let current = props;
    const mount = overlayMount(container, null, nested => <><InboxChannel p={current} channelKey={current.channelKey} />{nested}</>, container);
    mount.own(container); mount.render();
    return { update(next: typeof props) { current = next; mount.render(); }, unmount: mount.unmount };
}
export function mountInboxContentsView(container: HTMLElement, props: InboxProps) {
    let current = props;
    const mount = overlayMount(container, null, nested => <><InboxContents {...current} />{nested}</>, container);
    mount.own(container); mount.render();
    return { update(next: InboxProps) { current = next; mount.render(); }, unmount: mount.unmount };
}
export function inboxConflictContent(props: InboxProps) { return <div><InboxConflict p={props} /></div>; }
export function mountInboxReauthView(container: HTMLElement, props: InboxProps) {
    const root = createRoot(container);
    const update = (next: InboxProps) => flushSync(() => root.render(<InboxReauth p={next} />));
    update(props); return { update, unmount: () => root.unmount() };
}

export function mountSettingsOverviewView(container: HTMLElement, props: SettingsOverviewProps) {
    const root = createRoot(container);
    const update = (next: SettingsOverviewProps) => flushSync(() => root.render(<SettingsOverview {...next} />));
    update(props);
    return { update, unmount: () => root.unmount() };
}

// imperative入口仍属于原控制器；实际页面/Popup登记owner，子弹层随父视图卸载。
// 同一React树让Base UI管理嵌套层级与Escape；普通页面也需要释放其未完成确认。
const popupOwners = new WeakMap<HTMLElement, ReturnType<typeof overlayMount>>();
let overlayKey = 0;
function overlayMount(host: HTMLElement, opener: HTMLElement | null, content: (nested: ReactNode) => ReactNode, container?: HTMLElement) {
    let parent: ReturnType<typeof overlayMount> | undefined;
    for (const start of [host, opener]) for (let node = start; node && !parent; node = node.parentElement) parent = popupOwners.get(node);
    // FloatingPortal 的 Tab 出口也属于 React 树；独立 root 不能悬空。
    const standalone = !parent && !container ? host.ownerDocument.createElement('div') : null;
    if (standalone) { standalone.style.display = 'contents'; standalone.dataset.vcOverlayRoot = ''; host.append(standalone); }
    const root = parent ? null : createRoot(container || standalone!);
    const key = ++overlayKey, children = new Map<number, ReactNode>();
    let owner: HTMLElement | null = null, disposed = false;
    const render = () => { if (disposed) return; flushSync(() => {
        const view = content([...children].map(([id, child]) => <Fragment key={id}>{child}</Fragment>));
        if (parent) parent.set(key, view); else root!.render(view);
    }); };
    const mount = {
        render,
        set(id: number, child?: ReactNode) { if (disposed) return; if (child === undefined) children.delete(id); else children.set(id, child); render(); },
        own(node: HTMLElement) { owner = node; popupOwners.set(node, mount); },
        unmount() { if (disposed) return; disposed = true; children.clear(); if (owner) popupOwners.delete(owner); if (parent) parent.set(key); else root!.unmount(); standalone?.remove(); },
    };
    return mount;
}
export function mountAccountContentsView(container: HTMLElement, props: Omit<AccountDialogProps, 'host' | 'onPopup'>) {
    const dialogRef = createRef<HTMLDialogElement>(); let current = props;
    const mount = overlayMount(container, null, nested => <AccountDialog {...current} host={container} dialogRef={dialogRef} onPopup={node => mount.own(node)} nested={nested} />, container);
    mount.render();
    return { update(next: typeof props) { current = next; mount.render(); }, dialog: dialogRef.current!, unmount: mount.unmount };
}
export function mountMenuView(props: Omit<MenuViewProps, 'actions' | 'popupRef' | 'backdropRef'>) {
    const actions = createRef<Menu.Root.Actions>(), popupRef = createRef<HTMLDivElement>(), backdropRef = createRef<HTMLDivElement>();
    const mount = overlayMount(props.host, props.anchor, nested => <MenuView {...props} actions={actions} popupRef={popupRef} backdropRef={backdropRef} nested={nested} />);
    mount.render(); mount.own(popupRef.current!);
    return { menu: popupRef.current!, scrim: backdropRef.current!, close: () => actions.current?.close(), unmount: mount.unmount };
}
export function mountAlertView(props: Omit<AlertViewProps, 'actions' | 'popupRef'>, owner?: HTMLElement) {
    const actions = createRef<AlertDialog.Root.Actions>(), popupRef = createRef<HTMLDivElement>();
    const mount = overlayMount(props.host, owner || props.opener, nested => <AlertView {...props} actions={actions} popupRef={popupRef} nested={nested} />);
    mount.render(); mount.own(popupRef.current!);
    return { popup: popupRef.current!, close: () => actions.current?.close(), unmount: mount.unmount };
}
export function mountSheetView(props: Omit<SheetViewProps, 'actions' | 'popupRef' | 'backdropRef'>, owner?: HTMLElement) {
    const actions = createRef<Dialog.Root.Actions>(), popupRef = createRef<HTMLDivElement>(), backdropRef = createRef<HTMLDivElement>(); let current = props;
    const mount = overlayMount(props.host, owner || props.opener, nested => <SheetView {...current} actions={actions} popupRef={popupRef} backdropRef={backdropRef} nested={nested} />);
    mount.render(); mount.own(popupRef.current!);
    return { update(next: typeof props) { current = next; mount.render(); }, el: popupRef.current!, scrim: backdropRef.current!, unmount: mount.unmount };
}
export function mountSheetLayerView(container: HTMLElement, props: Parameters<typeof SheetLayer>[0]) {
    const root = createRoot(container);
    flushSync(() => root.render(<SheetLayer {...props} />));
    return () => root.unmount();
}

export function mountSettingsFrameView(container: HTMLElement, props: SettingsFrameProps) {
    const root = createRoot(container), bodyRef = createRef<HTMLDivElement>(), contentRef = createRef<HTMLDivElement>();
    const update = (next: SettingsFrameProps) => flushSync(() => root.render(<SettingsFrame {...next} bodyRef={bodyRef} contentRef={contentRef} />));
    update(props);
    return { update, get body() { return bodyRef.current!; }, get content() { return contentRef.current!; }, unmount: () => root.unmount() };
}
export function mountDrawerEntryView(container: HTMLElement, props: Parameters<typeof DrawerEntry>[0]) {
    const root = createRoot(container); flushSync(() => root.render(<DrawerEntry {...props} />)); return () => root.unmount();
}

export function mountShellFrameView(body: HTMLElement, tabbar: HTMLElement, props: ShellFrameProps) {
    const root = createRoot(body), tabs = createRoot(tabbar);
    const update = (next: ShellFrameProps) => flushSync(() => root.render(<ShellFrame {...next} />));
    const updateTabs = (next: Parameters<typeof Tabbar>[0]) => flushSync(() => tabs.render(<Tabbar {...next} />));
    update(props); updateTabs({ ...props, unreadCount: 0 });
    return { update, updateTabs, unmount() { root.unmount(); tabs.unmount(); } };
}
export function mountChatIdentityView(container: HTMLElement, props: ChatIdentityProps) {
    const root = createRoot(container);
    const update = (next: ChatIdentityProps) => flushSync(() => root.render(<ChatIdentity {...next} />)); update(props);
    return { update, unmount: () => root.unmount() };
}

export function mountConsentGateView(props: Omit<ConsentGateProps, 'onPopup'>) {
    let current = props; let resolveReady: (node: HTMLDialogElement) => void;
    const ready = new Promise<HTMLDialogElement>(resolve => { resolveReady = resolve; });
    const mount = overlayMount(props.host, null, nested => <ConsentGate {...current} nested={nested} onPopup={node => { mount.own(node); resolveReady(node); }} />);
    mount.render(); return { ready, update(next: typeof props) { current = next; mount.render(); }, unmount: mount.unmount };
}
