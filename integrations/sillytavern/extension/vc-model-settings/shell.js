// F1 外壳：五目的地导航、会话列表、对话页定位、设置入口。vc-ui 为 off 时不挂载。
import { icon, iconSpriteUrl } from './ui/icons.js';
import { mountSidebarView, mountShellFrameView, mountChatIdentityView, mountConversationsView } from './desktop/build/index.js';
import { flyAvatar } from './ui/nav.js';
import { openSheet } from './ui/sheet.js';
import { bindSegment } from './ui/controls.js';
import { popMenu } from './ui/menu.js';
import { readThemeMode, readVcUiFlag, setThemeMode } from './ui/theme.js';
import { readViewport } from './ui/viewport.js';
import { fetchRelationships } from './api.js';
import { sharedTransition } from './desktop/transition.js';
import { loadInboxEvents, pendingInboxWrites, unreadInboxEvents } from './chat-shell.js';
import { markInboxRead } from './inbox-client.js';
import { createNotifier, POLL_MS } from './desktop/notify.js';
import {
    avatarUrl,
    chatSnapshotFromContext,
    conversationRows,
    conversationTitle,
    loadRecentChatSnapshots,
    desktopConversationTime,
    conversationViewItems,
} from './conversations.js';

export const REPLY_STYLE_KEY = 'vc-reply-style';
export const SIDEBAR_KEY = 'vc-sidebar';

export const DESTINATIONS = [
    { nav: 'chat', label: '聊天', icon: 'message-circle' },
    { nav: 'characters', label: '角色', icon: 'users-round' },
    { nav: 'memory', label: '记忆', icon: 'brain' },
    { nav: 'inbox', label: '陪伴', icon: 'heart' },
    { nav: 'story', label: '剧情', icon: 'book-open' },
];

export const TAVERN_ENTRIES = [
    { id: 'ai-config-button', panel: 'left-nav-panel', label: 'AI 回复配置', icon: 'sliders-horizontal', tile: 'indigo' },
    { id: 'advanced-formatting-button', panel: 'AdvancedFormatting', label: '提示词格式', icon: 'quote', tile: 'purple' },
    { id: 'WI-SP-button', panel: 'WorldInfo', label: '世界书', icon: 'book-marked', tile: 'teal' },
    { id: 'extensions-settings-button', panel: 'rm_extensions_block', label: '扩展', icon: 'puzzle', tile: 'orange' },
    { id: 'persona-management-button', panel: 'PersonaManagement', label: '人设', icon: 'user-round', tile: 'green' },
    { id: 'backgrounds-button', panel: 'Backgrounds', label: '背景', icon: 'image', tile: 'cyan' },
    { id: 'user-settings-button', panel: 'user-settings-block', label: '界面', icon: 'monitor', tile: 'pink' },
    { id: 'sys-settings-button', panel: 'rm_api_block', label: 'API 连接', icon: 'link', tile: 'gray' },
    { id: 'rightNavHolder', panel: 'right-nav-panel', label: '角色卡', icon: 'square-pen', tile: 'blue' },
];

export function whoTintBackground(raw) {
    const value = String(raw ?? '').trim();
    if (!/^\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}$/.test(value)) return '';
    return `color-mix(in srgb, rgb(${value}) 6%, var(--vc-glass))`;
}

export function chromeForWidth(width) {
    const value = Number(width);
    const w = Number.isFinite(value) ? value : 0;
    if (w < 744) return { nav: 'tabbar', sidebar: 0, collapsible: false, wide: false, list: 0 };
    if (w < 1180) return { nav: 'sidebar', sidebar: 72, collapsible: true, wide: false, list: 0 };
    return { nav: 'sidebar', sidebar: 200, collapsible: false, wide: true, list: 320 };
}

export const CHAT_EMPTY_COPY = '选择一个会话开始聊天';

export function sidebarCssWidth(width, collapsed) {
    const chrome = chromeForWidth(width);
    if (chrome.nav !== 'sidebar') return 0;
    return chrome.sidebar;
}

const DESTINATION_MOUNTS = {
    characters: 'mountCharactersTab',
    memory: 'mountMemoryTab',
    inbox: 'mountInboxTab',
    story: 'mountStoryTab',
    chat: 'mountChatView',
};

const shellTabMounts = new Map();

export function registerShellTabs(tabs = {}) {
    shellTabMounts.clear();
    for (const [nav, mount] of Object.entries(tabs || {})) {
        if (typeof mount === 'function') shellTabMounts.set(nav, mount);
    }
}

function hideDuplicateTitle(container) {
    if (typeof container?.querySelector !== 'function') return;
    if (!container.querySelector('[data-vc-owned-title]')) return;
    const titles = typeof container.querySelectorAll === 'function'
        ? [...container.querySelectorAll('.vc-large-title')]
        : [];
    for (const title of titles) {
        if (title?.getAttribute?.('data-vc-owned-title') == null) {
            title.hidden = true;
            title.setAttribute?.('hidden', '');
        }
    }
}

export function createDestinationHost({ enabled = false, load, onFallback, registry = false } = {}) {
    const handles = new Map();
    const pending = new Map();
    return {
        async enter(nav, container, args) {
            if (!enabled) return 'off';
            const ready = handles.get(nav);
            if (ready) {
                ready.refresh();
                hideDuplicateTitle(container);
                return 'refresh';
            }
            const inflight = pending.get(nav);
            if (inflight) {
                try { await inflight; } catch { /* 首次进入失败时按未挂载处理。 */ }
                const after = handles.get(nav);
                if (after) {
                    after.refresh();
                    hideDuplicateTitle(container);
                    return 'refresh';
                }
                return 'fallback';
            }
            const job = (async () => {
                if (registry) {
                    const registered = shellTabMounts.get(nav);
                    if (typeof registered === 'function') {
                        const handle = registered(container, args) || {};
                        handles.set(nav, {
                            refresh() { handle.refresh?.(); },
                            destroy() { handle.destroy?.(); },
                        });
                        hideDuplicateTitle(container);
                        return 'mount';
                    }
                }
                let mod = null;
                try {
                    mod = await load?.(nav);
                } catch {
                    mod = null;
                }
                const mount = mod?.[DESTINATION_MOUNTS[nav]];
                if (typeof mount !== 'function') return 'fallback';
                const handle = nav === 'chat' ? (mount() || {}) : (mount(container, args) || {});
                handles.set(nav, {
                    refresh() { handle.refresh?.(); },
                    destroy() { handle.destroy?.(); },
                });
                hideDuplicateTitle(container);
                return 'mount';
            })();
            pending.set(nav, job);
            try {
                const result = await job;
                if (result === 'fallback') onFallback?.(nav, args);
                return result;
            } catch {
                onFallback?.(nav, args);
                return 'fallback';
            } finally {
                pending.delete(nav);
            }
        },
        leave(nav) {
            return handles.has(nav) ? 'kept' : 'absent';
        },
    };
}

export async function openSurfaceAction(kind, { enabled = true, load, opener, drawerId, fallback } = {}) {
    if (!enabled) return 'off';
    let mod = null;
    try {
        mod = await load?.();
    } catch {
        mod = null;
    }
    if (kind === 'drawer' && typeof mod?.openDrawerPage === 'function') {
        await mod.openDrawerPage(drawerId);
        return 'module';
    }
    if (kind === 'models' && typeof mod?.openModelSettings === 'function') {
        await mod.openModelSettings(opener);
        return 'module';
    }
    if (kind === 'account' && typeof mod?.openAccountData === 'function') {
        await mod.openAccountData(opener);
        return 'module';
    }
    await fallback?.(kind, opener, drawerId);
    return 'fallback';
}

export async function openChatAction(kind, { enabled = true, load, anchor, fallback } = {}) {
    if (!enabled) return 'off';
    let mod = null;
    try {
        mod = await load?.();
    } catch {
        mod = null;
    }
    if (kind === 'memory' && typeof mod?.openMemoryInspector === 'function') {
        await mod.openMemoryInspector();
        return 'module';
    }
    if (kind === 'more' && typeof mod?.openChatMoreMenu === 'function') {
        await mod.openChatMoreMenu(anchor);
        return 'module';
    }
    await fallback?.(kind, anchor);
    return 'fallback';
}

export function parseReplyStyle(value) {
    return value === 'bubble' || value === 'spread' ? value : 'spread';
}

export function readReplyStyle(storage) {
    try {
        const store = storage ?? globalThis.localStorage;
        return parseReplyStyle(store?.getItem?.(REPLY_STYLE_KEY));
    } catch {
        return 'spread';
    }
}

export function writeReplyStyle(style, storage) {
    const parsed = parseReplyStyle(style);
    try {
        const store = storage ?? globalThis.localStorage;
        store?.setItem?.(REPLY_STYLE_KEY, parsed);
    } catch {
        /* 存储不可用时仍返回解析后的值。 */
    }
    return parsed;
}

export function readSidebarCollapsed(storage) {
    try {
        const store = storage ?? globalThis.localStorage;
        return store?.getItem?.(SIDEBAR_KEY) !== 'open';
    } catch {
        return true;
    }
}

export function writeSidebarCollapsed(collapsed, storage) {
    try {
        const store = storage ?? globalThis.localStorage;
        store?.setItem?.(SIDEBAR_KEY, collapsed ? 'collapsed' : 'open');
    } catch {
        /* 忽略不可用的存储。 */
    }
    return collapsed === true;
}

export function settingOpener(action) {
    if (action === 'account' || action === 'data') return 'account';
    if (action === 'models') return 'models';
    if (action === 'notifications') return 'inbox';
    if (TAVERN_ENTRIES.some((item) => item.id === action)) return action;
    return '';
}

export function openHostDrawer(id, doc = globalThis.document) {
    if (!doc || typeof id !== 'string' || !id) return false;
    const root = doc.getElementById?.(id) || doc.querySelector?.(`#${id}`);
    if (!root) return false;
    const toggle = root.classList?.contains?.('drawer-toggle') ? root : root.querySelector?.('.drawer-toggle');
    const icon = toggle?.querySelector?.('.drawer-icon');
    const target = icon || toggle || root;
    if (typeof target.click !== 'function') return false;
    target.click();
    return true;
}

function chatFile(value) {
    return String(value || '').replace(/\.jsonl$/, '');
}

export async function openInstanceChat(row, { getContext, loadNative } = {}) {
    const ctx = typeof getContext === 'function' ? (getContext() || {}) : {};
    const indexFromRow = Number.isInteger(row?.characterIndex) ? row.characterIndex : -1;
    const file = chatFile(row?.file);
    const currentFile = chatFile(ctx.chatId);
    const sameFile = !file || currentFile === file;
    const bindingId = ctx.chatMetadata?.vc_binding?.relationshipId;
    const sameBinding = bindingId != null && bindingId !== '' && String(bindingId) === String(row?.relationshipId || '');
    if (sameFile && (sameBinding || (indexFromRow >= 0 && String(ctx.characterId) === String(indexFromRow)))) return true;
    if (typeof loadNative !== 'function') return false;
    let native;
    try {
        native = await loadNative();
    } catch {
        return false;
    }
    const characters = ctx.characters || native?.characters || [];
    let index = indexFromRow;
    if (index < 0 && row?.characterRef) {
        index = characters.findIndex((item) => item?.data?.extensions?.vc_character_ref === row.characterRef);
    }
    if (index < 0 || typeof native?.selectCharacterById !== 'function') return false;
    await native.selectCharacterById(index, { switchMenu: false });
    if (file && typeof native.openCharacterChat === 'function') await native.openCharacterChat(file);
    return true;
}

function iconEl(name, size = 22) {
    const holder = document.createElement('span');
    holder.innerHTML = icon(name, { size });
    return holder.firstElementChild || holder;
}

export function subtitleBeside(name, inst) {
    const title = String(name ?? '').trim();
    const sub = String(inst ?? '').trim();
    if (!sub || sub === title) return '';
    const prefix = `${title} · `;
    if (title && sub.startsWith(prefix) && /^\d+$/.test(sub.slice(prefix.length))) return '';
    return sub;
}

function titlesOf(row) {
    const title = conversationTitle(row);
    return { name: title.name, inst: subtitleBeside(title.name, title.inst) };
}

function ensureFlyLayer(doc) {
    const existing = doc.getElementById?.('vc-fly-layer');
    if (existing) return existing;
    const layer = doc.createElement('div');
    layer.id = 'vc-fly-layer';
    layer.style.position = 'fixed';
    layer.style.inset = '0';
    layer.style.overflow = 'hidden';
    layer.style.pointerEvents = 'none';
    layer.style.zIndex = 'var(--vc-z-fly)';
    doc.body.append(layer);
    return layer;
}

function accountLabel(context) {
    const name = context?.name1;
    if (typeof name === 'string' && name.trim()) return name.trim();
    return '账户';
}

function inboxScope(context) {
    const binding = context?.chatMetadata?.vc_binding || {};
    return {
        conversationId: binding.conversationId,
        relationshipId: binding.relationshipId,
    };
}

function ensureShellCss(doc) {
    if (doc.getElementById?.('vc-shell-css')) return;
    const link = doc.createElement('link');
    link.id = 'vc-shell-css';
    link.rel = 'stylesheet';
    link.href = new URL('./shell.css', import.meta.url).href;
    (doc.head || doc.documentElement).append(link);
}

function bindNavScroll(scroll, navbar, host = navbar) {
    if (!scroll || !navbar) return;
    const paint = () => {
        const distance = Number(scroll.scrollTop) || 0;
        const amount = Math.min(1, Math.max(0, distance / 48));
        host.style.setProperty('--vc-nav-p', String(amount));
    };
    scroll.addEventListener('scroll', paint, { passive: true });
    paint();
}

function buildSettings(doc, { accountName, theme, reply, onTheme, onReply, onAction, voiceAvailable }) {
    const form = doc.createElement('div');
    form.className = 'vc-settings-form';

    const account = doc.createElement('button');
    account.type = 'button';
    account.className = 'vc-cell';
    account.dataset.action = 'account';
    const face = doc.createElement('span');
    face.className = 'vc-settings-account';
    face.append(iconEl('user-round', 28));
    const accountCopy = doc.createElement('span');
    accountCopy.className = 'vc-grow vc-settings-copy';
    const accountTitle = doc.createElement('span');
    accountTitle.className = 'vc-settings-name';
    accountTitle.textContent = accountName || '账户';
    const accountMeta = doc.createElement('span');
    accountMeta.className = 'vc-meta vc-settings-meta';
    accountMeta.textContent = '密码与身份验证器';
    accountCopy.append(accountTitle, accountMeta);
    const accountChev = doc.createElement('span');
    accountChev.className = 'vc-chevron';
    accountChev.append(iconEl('chevron-right', 16));
    account.append(face, accountCopy, accountChev);

    const accountGroup = doc.createElement('div');
    accountGroup.className = 'vc-group';
    accountGroup.append(account);

    const link = (action, label, glyph, tile) => {
        const button = doc.createElement('button');
        button.type = 'button';
        button.className = 'vc-cell';
        button.dataset.action = action;
        const mark = doc.createElement('span');
        mark.className = `vc-tile vc-tile-${tile}`;
        mark.append(iconEl(glyph, 18));
        const grow = doc.createElement('span');
        grow.className = 'vc-grow';
        grow.textContent = label;
        const chev = doc.createElement('span');
        chev.className = 'vc-chevron';
        chev.append(iconEl('chevron-right', 16));
        button.append(mark, grow, chev);
        return button;
    };

    const links = doc.createElement('div');
    links.className = 'vc-group';
    links.append(
        link('models', '模型', 'layers', 'blue'),
        link('notifications', '通知', 'bell', 'red'),
        link('companion-style', '陪伴风格', 'heart', 'pink'),
        link('data', '账户与数据', 'shield', 'gray'),
    );
    if(voiceAvailable)links.append(link('voice','语音','volume-2','blue'));

    const appearance = doc.createElement('div');
    appearance.className = 'vc-group-title';
    appearance.textContent = '外观';

    const themeSeg = doc.createElement('div');
    themeSeg.className = 'vc-segment';
    themeSeg.setAttribute('aria-label', '外观');
    const themeThumb = doc.createElement('i');
    themeThumb.className = 'vc-segment-thumb';
    themeSeg.append(themeThumb);
    for (const item of [['auto', '自动'], ['light', '浅色'], ['dark', '深色']]) {
        const button = doc.createElement('button');
        button.type = 'button';
        button.dataset.value = item[0];
        button.textContent = item[1];
        if (item[0] === theme) button.setAttribute('aria-pressed', 'true');
        themeSeg.append(button);
    }

    const replySeg = doc.createElement('div');
    replySeg.className = 'vc-segment';
    replySeg.setAttribute('aria-label', '回复样式');
    const replyThumb = doc.createElement('i');
    replyThumb.className = 'vc-segment-thumb';
    replySeg.append(replyThumb);
    for (const item of [['spread', '铺开'], ['bubble', '气泡']]) {
        const button = doc.createElement('button');
        button.type = 'button';
        button.dataset.value = item[0];
        button.textContent = item[1];
        if (item[0] === reply) button.setAttribute('aria-pressed', 'true');
        replySeg.append(button);
    }

    const tavernTitle = doc.createElement('div');
    tavernTitle.className = 'vc-group-title';
    tavernTitle.textContent = '酒馆';
    const tavern = doc.createElement('div');
    tavern.className = 'vc-group';
    for (const entry of TAVERN_ENTRIES) {
        tavern.append(link(entry.id, entry.label, entry.icon, entry.tile));
    }

    const tavernSection = doc.createElement('div');
    tavernSection.className = 'vc-settings-tavern';
    tavernSection.append(tavernTitle, tavern);
    form.append(accountGroup, links, appearance, themeSeg, replySeg, tavernSection);
    form.addEventListener('click', (event) => {
        const button = event.target.closest?.('button[data-action]');
        if (!button || !form.contains(button)) return;
        if (TAVERN_ENTRIES.some((item) => item.id === button.dataset.action)) event.stopPropagation();
        onAction?.(button.dataset.action, button);
    });
    bindSegment(themeSeg, {
        onChange(_index, button) { onTheme?.(button?.dataset?.value); },
    });
    bindSegment(replySeg, {
        onChange(_index, button) { onReply?.(button?.dataset?.value); },
    });
    return form;
}

function defaultLoadNative() {
    return import('../../../../script.js');
}

export function mountShell(options = {}) {
    if (!readVcUiFlag(options.storage)) return null;
    const doc = options.document || globalThis.document;
    if (!doc?.body || !doc.createElement) return null;
    if (doc.getElementById?.('vc-shell')) return doc.getElementById('vc-shell');

    ensureShellCss(doc);
    const oldNav = doc.querySelector('#vc-chat-nav');
    if (oldNav) {
        oldNav.inert = true;
        oldNav.setAttribute('aria-hidden', 'true');
    }
    for (const toggle of doc.querySelectorAll('#top-bar .drawer-toggle')) {
        toggle.inert = true;
        toggle.setAttribute('aria-hidden', 'true');
    }
    const getContext = () => {
        try { return options.getContext?.() || {}; } catch { return {}; }
    };
    const loadRelationships = options.loadRelationships || fetchRelationships;
    const loadInbox = options.loadInbox || loadInboxEvents;
    const loadNative = options.loadNative || defaultLoadNative;
    const readChatSnapshots = options.loadChatSnapshots || (() => loadRecentChatSnapshots(loadNative));
    const openConversation = options.openConversation || (row => openInstanceChat(row, { getContext, loadNative }));

    const root = doc.createElement('div');
    root.id = 'vc-shell';
    root.dataset.chat = 'closed';
    const sidebar = doc.createElement('aside');
    sidebar.className = 'vc-sidebar';
    sidebar.setAttribute('aria-label', '陪伴导航');
    // 镜片由既有桌面动效控制，置于 React 边界外；侧栏内容只由 React 渲染。
    const sidebarContent = doc.createElement('div');
    sidebarContent.className = 'vc-sidebar-content';
    sidebar.append(sidebarContent);
    const sidebarState = { items: DESTINATIONS, sprite: iconSpriteUrl(), active: 'chat', collapsed: false,
        unreadCount: 0, chatUnread: false, avatar: { fallback: '' } };
    const sidebarView = mountSidebarView(sidebarContent, sidebarState);
    const tabbar = doc.createElement('nav');
    tabbar.className = 'vc-tabbar vc-glass';
    tabbar.setAttribute('aria-label', '陪伴导航');
    const body = doc.createElement('div'); body.className = 'vc-shell-body';
    root.append(sidebar, body, tabbar); doc.body.append(root);
    const frameState = { items: DESTINATIONS, sprite: iconSpriteUrl(), active: '', entering: '', listLabel: '隐藏会话列表', searchOpen: false, labels: options.navigationTitles || {} };
    const frame = mountShellFrameView(body, tabbar, frameState);
    const pages = body.querySelector('.vc-shell-pages');
    let convoList = null;
    // 业务页挂载点没有React children，页面控制器与ST保持其内部节点的唯一owner。
    for (const item of DESTINATIONS) {
        const page = pages.querySelector(`[data-page="${item.nav}"]`), scroll = page.querySelector('.vc-shell-scroll');
        const heading = doc.createElement('h1'); heading.className = 'vc-large-title'; heading.setAttribute('data-shell-title', ''); heading.textContent = item.label; scroll.append(heading);
        if (item.nav === 'chat') { convoList = doc.createElement('div'); convoList.setAttribute('data-convo-list', ''); convoList.setAttribute('aria-label', '会话'); scroll.append(convoList); }
        bindNavScroll(scroll, page.querySelector('header'));
    }
    const conversationState = { rows: [], status: 'loading', sprite: iconSpriteUrl() };
    const conversationView = mountConversationsView(convoList, conversationState);
    function paintConversations() {
        const desktop = doc.documentElement.dataset.vcLayout === 'desktop';
        const current = String(getContext().chatMetadata?.vc_binding?.relationshipId ?? '');
        conversationState.rows = conversationViewItems([...rowById.values()], { desktop, current, getDraft: options.getConversationDraft });
        conversationView.update(conversationState);
    }
    const chatPane = body.querySelector('.vc-shell-chat'), chatNav = chatPane.querySelector('header'), chatBody = chatPane.querySelector('.vc-shell-chat-body');
    const whoSlot = chatNav.querySelector('.vc-who-slot');
    const identityState = { sprite: iconSpriteUrl(), name: '', instance: '', avatar: '', subtitle: '', interactive: false, expanded: false };
    const identityView = mountChatIdentityView(whoSlot, identityState);
    const who = whoSlot.querySelector('.vc-who'), whoAvatar = who.querySelector('[data-who-avatar]');
    const chatEmpty = doc.createElement('div'); chatEmpty.className = 'vc-empty vc-chat-empty';
    const emptyIcon = doc.createElement('span'); emptyIcon.setAttribute('data-empty-icon', '');
    const emptyCopy = doc.createElement('p'); emptyCopy.textContent = CHAT_EMPTY_COPY;
    chatEmpty.append(emptyIcon, emptyCopy); fillIcon(chatEmpty, 'message-circle'); chatBody.append(chatEmpty);
    const settingsPane = body.querySelector('.vc-shell-settings'), settingsNav = settingsPane.querySelector('header'), settingsScroll = settingsPane.querySelector('.vc-shell-scroll');
    const settingsHeading = doc.createElement('h1'); settingsHeading.className = 'vc-large-title'; settingsHeading.textContent = '设置'; settingsScroll.append(settingsHeading);
    let desktopSettings = null;
    bindNavScroll(settingsScroll, settingsNav, settingsPane);

    let collapsed = readSidebarCollapsed(options.storage);
    let entered = false;
    let listHeld = false;
    let listHeldFor = '';
    let leavingChat = false;
    let destinationHost = null;
    let keyboardOn = false;
    let inboxRows = [];
    let rowById = new Map();
    let sheetHandle = null;
    let reloadToken = 0;
    const timers = new Set();
    const chatBound = new WeakSet();

    let statusCard = null;
    let statusLoading = false;
    let lastIdentityRow = null;
    // UX-29 状态卡只在桌面用：桌面首次画标题栏时才加载，手机不多拉模块。
    function loadStatusCard() {
        if (statusLoading || chromeForWidth(globalThis.innerWidth).nav === 'tabbar') return;
        if (typeof doc.addEventListener !== 'function' || typeof whoAvatar.addEventListener !== 'function') return;
        statusLoading = true;
        import('./desktop/status-card.js').then(({ mountStatusCard }) => {
            statusCard = mountStatusCard({ getContext, document: doc, who, avatar: whoAvatar, onSubtitle(text) { identityState.subtitle = text; identityView.update(identityState); }, onTriggerState(next) { Object.assign(identityState, next); identityView.update(identityState); } });
            if (lastIdentityRow) statusCard?.setRelationship(lastIdentityRow);
        }).catch(() => { statusLoading = false; });
    }
    const viewingRelationship = () => {
        if (root.dataset.chat !== 'open' || root.dataset.destination !== 'chat' || root.dataset.settings === 'page') return null;
        const id = inboxScope(getContext()).relationshipId;
        return id == null || id === '' ? null : String(id);
    };
    const notifier = createNotifier({
        document: doc,
        describe(id) {
            const row = rowById.get(String(id));
            return row ? { name: titlesOf(row).name, avatar: avatarUrl(row.avatar) || '' } : {};
        },
        onOpen(id) {
            const row = rowById.get(String(id));
            void openFromInstance(row || { relationshipId: String(id) }, null);
        },
    });

    function paintBadge(count) {
        sidebarState.unreadCount = count;
        sidebarState.chatUnread = unreadInboxEvents(inboxRows).length > 0;
        sidebarView.update(sidebarState);
        frame.updateTabs({ ...frameState, unreadCount: count });
    }

    function paintIdentity(row) {
        const title = titlesOf(row);
        Object.assign(identityState, { name: title.name, instance: title.inst, avatar: avatarUrl(row?.avatar) || '' });
        identityView.update(identityState);
        lastIdentityRow = row;
        if (statusCard) statusCard.setRelationship(row);
        else loadStatusCard();
    }

    function placeSheld() {
        const sheld = doc.getElementById?.('sheld');
        if (!sheld) return false;
        if (sheld.parentElement !== chatBody) chatBody.append(sheld);
        const chat = doc.getElementById?.('chat');
        if (chat && !chatBound.has(chat)) {
            chatBound.add(chat);
            bindNavScroll(chat, chatNav);
        }
        return true;
    }

    function releaseMotion(el) {
        if (!el || el.classList?.contains('is-push') || el.classList?.contains('is-pop')) return;
        if (typeof el.getAnimations === 'function') {
            for (const anim of el.getAnimations()) anim.cancel();
        }
        el.style?.removeProperty?.('transform');
        el.style?.removeProperty?.('filter');
        el.style?.removeProperty?.('opacity');
    }

    function applyChrome() {
        const chrome = chromeForWidth(globalThis.innerWidth);
        doc.documentElement.dataset.vcLayout = chrome.nav === 'tabbar' ? 'mobile' : 'desktop';
        root.classList.toggle('vc-desktop-shell', chrome.nav !== 'tabbar');
        root.dataset.chrome = chrome.nav;
        root.dataset.wide = chrome.wide ? '1' : '0';
        const mediumChat = !chrome.wide && root.dataset.destination === 'chat' && entered;
        if (!mediumChat) root.dataset.list = 'open';
        else if (listHeld) root.dataset.list = 'open';
        else root.dataset.list = 'hidden';
        frameState.listLabel = root.dataset.list === 'hidden' ? '显示会话列表' : '隐藏会话列表';
        frame.update(frameState);
        sidebar.classList.toggle('is-collapsed', chrome.collapsible && collapsed);
        sidebarState.collapsed = chrome.collapsible && collapsed;
        const sidebarPx = sidebarCssWidth(globalThis.innerWidth, collapsed);
        doc.documentElement?.style?.setProperty?.('--vc-sidebar', `${sidebarPx}px`);
        if (chrome.nav !== 'tabbar') chatPane.classList.remove('is-push', 'is-pop');
        const visibleChat = entered && (chrome.nav !== 'tabbar' || root.dataset.destination === 'chat');
        if (!leavingChat) root.dataset.chat = visibleChat ? 'open' : 'closed';
        if (chrome.nav === 'tabbar') tabbar.classList.toggle('is-hidden', visibleChat || keyboardOn);
        else tabbar.classList.remove('is-hidden');
        releaseMotion(chatPane);
        releaseMotion(pages);
        syncKeyboard();
        releaseCoveredSettings();
        if (!options.independent && chrome.nav === 'tabbar' && desktopSettings && root.dataset.settings === 'page') closeSettings({ immediate: true });
        syncSidebarCurrent();
        paintConversations();
    }

    function syncKeyboard() {
        keyboardOn = readViewport(globalThis).keyboard > 0;
        doc.body.classList.toggle('is-keyboard', keyboardOn);
        if (root.dataset.chrome === 'tabbar') {
            tabbar.classList.toggle('is-hidden', entered && root.dataset.destination === 'chat' || keyboardOn);
        }
    }

    function seamArgs(nav, opener) {
        if (nav === 'memory') {
            return {
                getRelationshipId: () => {
                    const id = getContext().chatMetadata?.vc_binding?.relationshipId;
                    return id == null || id === '' ? '' : String(id);
                },
            };
        }
        if (nav === 'inbox') {
            return { onOpenConversation: (payload) => { void openFromInstance(typeof payload === 'object' ? payload : { relationshipId: payload }, opener); } };
        }
        if (nav === 'characters') {
            return {
                onOpenInstance: (instance) => { void openFromInstance(instance, opener); },
                getContext,
            };
        }
        if (nav === 'story') return { getContext };
        return { opener };
    }

    function pageContainer(nav) {
        if (nav === 'chat') return chatBody;
        return root.querySelector(`.vc-shell-page[data-page="${nav}"] .vc-shell-scroll`);
    }

    function selectDestination(nav, opener, { legacy = true } = {}) {
        const index = DESTINATIONS.findIndex((item) => item.nav === nav);
        if (index < 0) return;
        if (root.dataset.settings === 'page') {
            const closed = closeSettings();
            if (closed?.then) return closed.then(ok => ok ? selectDestination(nav, opener, { legacy }) : false);
            if (!closed) return false;
        }
        const previous = root.dataset.destination || '';
        if (previous && previous !== nav) listHeld = false;
        root.dataset.destination = nav;
        globalThis.dispatchEvent?.(new Event('vc-shell-destination'));
        tabbar.style.setProperty('--vc-tab', String(index));
        if (frameState.active !== nav) {
            frameState.active = nav; frameState.entering = ''; frame.update(frameState);
            void pages.querySelector(`[data-page="${nav}"]`)?.offsetWidth;
            frameState.entering = nav;
        }
        frame.update(frameState); frame.updateTabs({ ...frameState, unreadCount: sidebarState.unreadCount });
        syncSidebarCurrent();
        const phone = chromeForWidth(globalThis.innerWidth).nav === 'tabbar';
        if (nav === 'chat') {
            if (phone && entered) hideChat();
        } else if (phone) {
            hideChat();
        }
        applyChrome();
        if (destinationHost && (nav === 'chat' || legacy)) {
            if (previous && previous !== nav) destinationHost.leave(previous);
            void destinationHost.enter(nav, pageContainer(nav), seamArgs(nav, opener));
        }
    }

    function openLegacy(nav, opener) {
        selectDestination(nav, opener);
    }

    function hideChat() {
        const phoneOpen = root.dataset.chrome === 'tabbar' && root.dataset.chat === 'open';
        if (!phoneOpen) {
            leavingChat = false;
            entered = false;
            root.dataset.chat = 'closed';
            root.dataset.list = 'open';
            chatPane.classList.remove('is-push', 'is-pop');
            tabbar.classList.remove('is-hidden');
            releaseMotion(chatPane);
            releaseMotion(pages);
            syncKeyboard();
            return;
        }
        leavingChat = true;
        entered = false;
        tabbar.classList.remove('is-hidden');
        chatPane.classList.remove('is-push');
        chatPane.classList.add('is-pop');
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            leavingChat = false;
            chatPane.classList.remove('is-pop', 'is-push');
            root.dataset.chat = 'closed';
            releaseMotion(chatPane);
            releaseMotion(pages);
            syncKeyboard();
        };
        chatPane.addEventListener?.('animationend', finish, { once: true });
        setTimeout(finish, 900);
    }

    function showChat(row, fromButton) {
        entered = true;
        paintIdentity(row);
        releaseMotion(chatPane);
        releaseMotion(pages);
        root.dataset.chat = 'open';
        tabbar.classList.add('is-hidden');
        chatPane.classList.remove('is-pop');
        chatPane.classList.remove('is-push');
        if (chatPane.offsetWidth >= 0) chatPane.classList.add('is-push');
        let flew = false;
        const fly = () => {
            if (flew) return;
            flew = true;
            const from = fromButton?.querySelector?.('[data-fly-from]');
            const to = whoAvatar.querySelector?.('[data-fly-target]');
            if (from && to) flyAvatar(from, to, { container: ensureFlyLayer(doc) });
        };
        const stopPush = () => {
            chatPane.classList.remove('is-push');
            fly();
        };
        chatPane.addEventListener?.('animationend', stopPush, { once: true });
        setTimeout(stopPush, 900);
    }

    async function openChatColumn(row, fromButton) {
        if (await selectDestination('chat', null, { legacy: false }) === false) return false;
        const nextId = row?.relationshipId == null || row.relationshipId === '' ? '' : String(row.relationshipId);
        if (nextId !== listHeldFor) {
            listHeld = false;
            listHeldFor = nextId;
        }
        entered = true;
        const phone = chromeForWidth(globalThis.innerWidth).nav === 'tabbar';
        if (phone) {
            paintIdentity(row);
            showChat(row, fromButton);
            return true;
        }
        // 桌面：会话列表头像到标题栏头像的共享元素过渡（不支持或减少动效时同步直接更新）。
        await sharedTransition(() => {
            paintIdentity(row);
            chatPane.classList.remove('is-push', 'is-pop');
            root.dataset.chat = 'open';
            releaseMotion(chatPane);
            releaseMotion(pages);
            applyChrome();
        }, { from: fromButton?.querySelector?.('[data-fly-from]'), to: () => whoAvatar.querySelector?.('[data-fly-target]'), name: 'vc-shared' }).then(() => refreshInbox());
        return true;
    }

    async function openFromInstance(instance, opener, { latest = false } = {}) {
        if (root.dataset.settings === 'page' && !await closeSettings()) return false;
        const id = instance?.relationshipId == null ? '' : String(instance.relationshipId);
        const row = (instance?.file || instance?.conversationId || instance?.chatIdentity ? instance : id && rowById.get(id)) || {
            relationshipId: id,
            name: instance?.name,
            instanceName: instance?.instanceName,
            avatar: instance?.avatar,
            file: instance?.file,
            characterIndex: instance?.characterIndex,
            characterRef: instance?.characterRef,
            conversationId: instance?.conversationId,
            chatIdentity: instance?.chatIdentity,
        };
        if (!row.relationshipId && !row.file && !Number.isInteger(row.characterIndex)) return false;
        const ok = await openConversation(row, { latest, beforeCommit: () => root.dataset.settings === 'page' ? closeSettings() : true });
        if (!ok) return false;
        // 打开会话返回时对话栏已展开（桌面过渡把更新推迟到下一帧，这里等它完成）。
        return await openChatColumn(row, opener);
    }

    function fillIcon(host, name) {
        const slot = host.querySelector?.('[data-empty-icon]');
        if (!slot) return;
        slot.replaceChildren(iconEl(name, 32));
    }

    async function refreshInbox() {
        try {
            const rows = await loadInbox();
            inboxRows = Array.isArray(rows) ? rows : [];
        } catch {
            inboxRows = [];
        }
        const viewing = viewingRelationship();
        if (root.dataset.chrome === 'sidebar' && viewing && !doc.hidden) {
            for (const row of unreadInboxEvents(inboxRows, { relationshipId: viewing })) {
                try {
                    const saved = await markInboxRead(row.eventId);
                    inboxRows = inboxRows.map(item => item.eventId === row.eventId ? saved : item);
                } catch { /* 未确认的已读写入保留未读状态。 */ }
            }
        }
        paintBadge(pendingInboxWrites(inboxRows, inboxScope(getContext())).length);
        notifier.ingest(inboxRows, { viewing: viewingRelationship() });
    }

    async function reload() {
        const token = ++reloadToken;
        if (!convoList) return;
        try {
            const relationships = await loadRelationships();
            if (token !== reloadToken) return;
            const context = getContext();
            const snap = chatSnapshotFromContext(context);
            let discovered = [];
            let chatsComplete = false;
            try {
                discovered = await readChatSnapshots();
                if (token !== reloadToken) return;
                chatsComplete = true;
            } catch {
                // 聊天目录暂时列不出时仍按实例展示，避免把已有会话藏掉。
            }
            const rows = conversationRows(relationships, {
                chats: [...discovered, ...(snap ? [snap] : [])],
                chatsComplete,
                inboxRows,
                characters: context.characters,
            });
            rowById = new Map(rows.map((row) => [row.relationshipId, row]));
            conversationState.status = 'ready'; paintConversations();
            const current = snap && rowById.get(snap.relationshipId);
            if (current && entered) paintIdentity(current);
        } catch {
            if (token !== reloadToken) return;
            conversationState.status = 'error'; paintConversations();
        }
    }

    function schedule() {
        for (const id of timers) clearTimeout(id);
        timers.clear();
        const run = () => { void refreshInbox().then(reload); };
        run();
        for (const delay of [700, 2000, 5000]) timers.add(setTimeout(run, delay));
    }

    function coveringPageOpen() {
        const list = (sel) => (typeof doc.querySelectorAll === 'function' ? [...doc.querySelectorAll(sel)] : []);
        if (list('.vc-data-dialog').some((node) => node.hasAttribute?.('open') || node.open === true)) return true;
        return list('.vcms-overlay').some((node) => !node.closest?.('.vc-settings-shell') && node.hidden !== true && node.getAttribute?.('hidden') == null);
    }

    // 侧栏恰好一项 aria-current：设置页与酒馆抽屉只高亮底部「设置」，五个目的地都不高亮。
    function syncSidebarCurrent() {
        const settingsOn = root.dataset.chrome !== 'tabbar'
            && (root.dataset.settings === 'page' || doc.body?.classList?.contains('vc-host-drawer') === true);
        sidebarState.active = settingsOn ? 'settings' : root.dataset.destination;
        if (root.dataset.chrome !== 'tabbar') syncSideAvatar();
        sidebarView.update(sidebarState);
        globalThis.dispatchEvent?.(new Event('vc-shell-destination'));
    }

    function syncSideAvatar() {
        const context = getContext(), name = String(context?.name1 || '').trim();
        const persona = context?.userAvatar ?? doc.querySelector?.('#user_avatar_block .avatar-container.selected')?.getAttribute?.('data-avatar-id');
        sidebarState.avatar = { src: persona ? `/thumbnail?type=persona&file=${encodeURIComponent(persona)}` : undefined,
            fallback: [...name][0] || '' };
    }

    function closeSettings({ immediate = false } = {}) {
        if (root.dataset.settings === 'page' && (desktopSettings?.isDirty?.() || desktopSettings?.isBusy?.())) {
            return desktopSettings.requestLeave().then(ok => ok ? finishCloseSettings(immediate) : false);
        }
        return finishCloseSettings(immediate);
    }
    function finishCloseSettings(immediate) {
        desktopSettings?.close();
        const handle = sheetHandle;
        sheetHandle = null;
        if (handle) {
            if (immediate && typeof handle.dismiss === 'function') handle.dismiss();
            else handle.close?.();
        }
        delete root.dataset.settings;
        syncSidebarCurrent();
        return true;
    }

    function releaseCoveredSettings() {
        if (options.independent) return;
        if (chromeForWidth(globalThis.innerWidth).nav === 'tabbar') return;
        if (!coveringPageOpen()) return;
        closeSettings({ immediate: true });
    }

    function openSettings(opener) {
        if ((options.independent || chromeForWidth(globalThis.innerWidth).nav !== 'tabbar') && options.mountDesktopSettings) {
            desktopSettings ??= options.mountDesktopSettings(settingsScroll);
            desktopSettings.resume();
            root.dataset.settings = 'page';
            syncSidebarCurrent();
            return;
        }
        const form = buildSettings(doc, {
            voiceAvailable: options.voiceAvailable?.()===true,
            accountName: accountLabel(getContext()),
            theme: readThemeMode(options.storage),
            reply: readReplyStyle(options.storage),
            onTheme: (value) => setThemeMode(value, options.storage, doc),
            onReply: (value) => writeReplyStyle(value, options.storage),
            onAction: (action, button) => {
                if (action === 'companion-style') {
                    options.openCompanionStyle?.(button);
                    return;
                }
                if(action==='voice'){void options.openVoiceSettings?.(button);return;}
                const target = settingOpener(action);
                const surface = () => loadSeam('surface');
                if (target === 'account') {
                    void openSurfaceAction('account', {
                        load: surface,
                        opener: button,
                        fallback: () => options.openAccount?.(button),
                    }).then((result) => {
                        if (result === 'off' || chromeForWidth(globalThis.innerWidth).nav === 'tabbar') return;
                        closeSettings({ immediate: true });
                    });
                } else if (target === 'models') {
                    void openSurfaceAction('models', {
                        load: surface,
                        opener: button,
                        fallback: () => options.openModels?.(button),
                    });
                } else if (target === 'inbox') options.openInbox?.(button);
                else if (target) {
                    void openSurfaceAction('drawer', {
                        load: surface,
                        opener: button,
                        drawerId: target,
                        fallback: () => {
                            openHostDrawer(target, doc);
                            closeSettings();
                        },
                    }).then((result) => {
                        if (result === 'module') closeSettings();
                    });
                }
            },
        });
        if (chromeForWidth(globalThis.innerWidth).nav === 'tabbar') {
            closeSettings();
            let coverWatch;
            const handle = openSheet({
                title: '设置',
                large: true,
                body: form,
                opener,
                root: doc.body,
                onDone: () => { coverWatch?.disconnect(); if (sheetHandle === handle) sheetHandle = null; },
            });
            sheetHandle = handle;
            // 独立账户/模型页保留返回用的设置DOM，覆盖期间暂停后层的Dialog状态，避免跨Root抢Escape/焦点。
            if (typeof MutationObserver === 'function') {
                const syncCover = () => { if (sheetHandle === handle) handle.setCovered(coveringPageOpen()); };
                coverWatch = new MutationObserver(syncCover);
                coverWatch.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open', 'hidden'] });
                syncCover();
            }
            return;
        }
        settingsScroll.replaceChildren(settingsHeading, form);
        root.dataset.settings = 'page';
        syncSidebarCurrent();
    }

    function syncHostDrawer() {
        const open = TAVERN_ENTRIES.some((entry) => doc.getElementById?.(entry.panel)?.classList?.contains('openDrawer'));
        doc.body.classList.toggle('vc-host-drawer', open === true);
        syncSidebarCurrent();
    }

    root.addEventListener('click', (event) => {
        if (root.dataset.wide === '0' && root.dataset.chrome === 'sidebar' && !collapsed && !event.target?.closest?.('.vc-sidebar')) {
            collapsed = writeSidebarCollapsed(true, options.storage);
            applyChrome();
        }
        const node = event.target?.closest?.('[data-nav], [data-settings], [data-relationship-id], [data-goto], [data-retry], [data-back], [data-list-toggle], [data-collapse], [data-memory], [data-more], [data-settings-done]');
        if (!node || !root.contains(node)) return;
        if (node.hasAttribute('data-settings-done')) {
            closeSettings();
            return;
        }
        if (node !== root && node.hasAttribute('data-settings')) {
            openSettings(node);
            return;
        }
        if (node.hasAttribute('data-collapse')) {
            collapsed = writeSidebarCollapsed(!collapsed, options.storage);
            applyChrome();
            return;
        }
        if (node.hasAttribute('data-list-toggle')) {
            if (root.dataset.wide === '1') return;
            const opening = root.dataset.list === 'hidden';
            root.dataset.list = opening ? 'open' : 'hidden';
            listHeld = opening && root.dataset.destination === 'chat' && entered;
            frameState.listLabel = root.dataset.list === 'hidden' ? '显示会话列表' : '隐藏会话列表';
        frame.update(frameState);
            return;
        }
        if (node.hasAttribute('data-back')) {
            hideChat();
            return;
        }
        if (node.hasAttribute('data-memory')) {
            void openChatAction('memory', {
                load: () => loadSeam('chat'),
                anchor: node,
                fallback: () => openLegacy('memory', node),
            });
            return;
        }
        if (node.hasAttribute('data-more')) {
            void openChatAction('more', {
                load: () => loadSeam('chat'),
                anchor: node,
                fallback: () => popMenu(node, [
                    { label: '陪伴', icon: 'heart', run: () => openLegacy('inbox', node) },
                    { label: '剧情', icon: 'book-open', run: () => openLegacy('story', node) },
                    { label: '账户', icon: 'shield', run: () => options.openAccount?.(node) },
                ]),
            });
            return;
        }
        if (node.hasAttribute('data-retry')) {
            schedule();
            return;
        }
        if (node.hasAttribute('data-goto')) {
            selectDestination(node.getAttribute('data-goto'), node);
            return;
        }
        const nav = node.getAttribute('data-nav');
        if (nav) {
            selectDestination(nav, node);
            return;
        }
        const relationshipId = node.getAttribute('data-relationship-id');
        if (!relationshipId) return;
        const row = rowById.get(relationshipId);
        if (!row) {
            root.dataset.openState = 'missing';
            return;
        }
        root.dataset.openState = 'pending';
        void openFromInstance(row, node).then((ok) => {
            if (!ok) {
                root.dataset.openState = 'miss';
                return;
            }
            root.dataset.openState = 'open';
        }).catch(() => {
            root.dataset.openState = 'error';
        });
    });

    const events = getContext();
    if (events.eventSource?.on && events.eventTypes?.CHAT_CHANGED) {
        events.eventSource.on(events.eventTypes.CHAT_CHANGED, schedule);
    }
    if (events.eventSource?.on && events.eventTypes?.PERSONA_CHANGED) {
        events.eventSource.on(events.eventTypes.PERSONA_CHANGED, () => { syncSideAvatar(); sidebarView.update(sidebarState); });
    }
    globalThis.addEventListener?.('resize', applyChrome);
    globalThis.visualViewport?.addEventListener?.('resize', syncKeyboard);
    globalThis.visualViewport?.addEventListener?.('scroll', syncKeyboard);

    for (const entry of TAVERN_ENTRIES) {
        const panel = doc.getElementById?.(entry.panel);
        if (!panel || typeof MutationObserver !== 'function') continue;
        const observer = new MutationObserver(syncHostDrawer);
        observer.observe(panel, { attributes: true, attributeFilter: ['class'] });
    }

    if (typeof options.mountChatSurface === 'function') {
        options.mountChatSurface(chatBody);
    } else if (!placeSheld() && typeof MutationObserver === 'function') {
        const observer = new MutationObserver(() => {
            if (placeSheld()) observer.disconnect();
        });
        observer.observe(doc.body, { childList: true, subtree: true });
    }

    function loadSeam(nav) {
        if (typeof options.seams?.[nav] === 'function') return options.seams[nav]();
        return Promise.resolve(null);
    }


    destinationHost = createDestinationHost({
        enabled: true,
        registry: true,
        load: loadSeam,
        onFallback() {
            // 新外观不退回旧对话框。
        },
    });
    function syncWhoTint() {
        const raw = doc.body?.style?.getPropertyValue?.('--vc-tint')
            || doc.documentElement?.style?.getPropertyValue?.('--vc-tint')
            || '';
        const next = whoTintBackground(raw);
        identityState.tint = next || undefined;
        identityView.update(identityState);
    }
    const routeExternal = (nav, opener) => {
        if (nav === 'settings') {
            openSettings(opener);
            return;
        }
        if (!DESTINATIONS.some((item) => item.nav === nav)) return;
        selectDestination(nav, opener);
    };
    globalThis.addEventListener?.('vc-shell-navigate', (event) => {
        routeExternal(event.detail?.destination, event.detail?.opener);
    });
    globalThis.addEventListener?.('vc-open-characters', (event) => {
        routeExternal('characters', event.detail?.opener);
    });
    globalThis.addEventListener?.('vc-open-memory', (event) => {
        routeExternal('memory', event.detail?.opener);
    });
    globalThis.addEventListener?.('vc-view-inbox', (event) => {
        routeExternal('inbox', event.detail?.opener);
    });
    if (typeof MutationObserver === 'function' && doc.body) {
        const tintObserver = new MutationObserver(syncWhoTint);
        tintObserver.observe(doc.body, { attributes: true, attributeFilter: ['style'] });
    }
    syncWhoTint();
    // UX-30 桌面每 30s 轮询收件箱，有新增 / 已读变化时刷新会话列表未读数。
    const pendingSignature = () => unreadInboxEvents(inboxRows).map((item) => item.eventId).join();
    setInterval(async () => {
        if (root.dataset.chrome === 'tabbar') return;
        const before = pendingSignature();
        await refreshInbox();
        if (pendingSignature() !== before) void reload();
    }, POLL_MS).unref?.();
    selectDestination('chat', null, { legacy: false });
    applyChrome();
    schedule();
    root.setChatSearchOpen = on => { frameState.searchOpen = on; frame.update(frameState); };
    root.registerCharacterImport = onClick => {
        frameState.characterImport = onClick; frame.update(frameState);
        return () => {
            if (frameState.characterImport !== onClick) return;
            frameState.characterImport = undefined; frame.update(frameState);
        };
    };
    root.refreshConversationDrafts = paintConversations;
    root.refreshConversations = schedule;
    root.updateConversationSnapshot = snap => {
        const row = snap?.preview && rowById.get(snap.relationshipId);
        if (!row) return;
        row.preview = snap.preview;
        if (desktopConversationTime(snap.time)) row.timeMs = Date.parse(snap.time) || snap.time;
        paintConversations();
    };
    root.openConversation = (instance, opener, options) => openFromInstance(instance, opener, options);
    root.openSettings = async (category, opener) => { openSettings(opener); if (category && desktopSettings) await desktopSettings.select(category); };
    return root;
}
