// F1 外壳：五目的地导航、会话列表、对话页定位、设置入口。vc-ui 为 off 时不挂载。
import { icon } from './ui/icons.js';
import { flyAvatar } from './ui/nav.js';
import { openSheet } from './ui/sheet.js';
import { bindSegment } from './ui/controls.js';
import { popMenu } from './ui/menu.js';
import { readThemeMode, readVcUiFlag, setThemeMode } from './ui/theme.js';
import { readViewport } from './ui/viewport.js';
import { fetchRelationships } from './api.js';
import { loadInboxEvents, pendingInboxWrites } from './chat-shell.js';
import {
    avatarUrl,
    chatSnapshotFromContext,
    conversationRows,
    conversationTitle,
    loadRecentChatSnapshots,
    renderConversationEmpty,
    renderConversationError,
    renderConversationRows,
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
    if (w < 1180) return { nav: 'sidebar', sidebar: 240, collapsible: true, wide: false, list: 0 };
    return { nav: 'sidebar', sidebar: 240, collapsible: false, wide: true, list: 320 };
}

export const CHAT_EMPTY_COPY = '选择一个会话开始聊天';

export function sidebarCssWidth(width, collapsed) {
    const chrome = chromeForWidth(width);
    if (chrome.nav !== 'sidebar') return 0;
    if (chrome.collapsible && collapsed) return 72;
    return 240;
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

    form.append(accountGroup, links, appearance, themeSeg, replySeg, tavernTitle, tavern);
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
    const getContext = () => {
        try { return options.getContext?.() || {}; } catch { return {}; }
    };
    const loadRelationships = options.loadRelationships || fetchRelationships;
    const loadInbox = options.loadInbox || loadInboxEvents;
    const loadNative = options.loadNative || defaultLoadNative;

    const root = doc.createElement('div');
    root.id = 'vc-shell';
    root.dataset.chat = 'closed';
    const sidebar = doc.createElement('aside');
    sidebar.className = 'vc-sidebar';
    sidebar.setAttribute('aria-label', '陪伴导航');
    const collapse = doc.createElement('button');
    collapse.type = 'button';
    collapse.className = 'vc-side-link vc-side-collapse';
    collapse.setAttribute('data-collapse', '');
    collapse.setAttribute('aria-label', '收起侧边栏');
    collapse.append(iconEl('chevron-left', 22));
    sidebar.append(collapse);
    const tabbar = doc.createElement('nav');
    tabbar.className = 'vc-tabbar vc-glass';
    tabbar.setAttribute('aria-label', '陪伴导航');
    const lens = doc.createElement('i');
    lens.className = 'vc-tab-lens';
    tabbar.append(lens);

    const makeSettingsButton = () => {
        const button = doc.createElement('button');
        button.type = 'button';
        button.className = 'vc-circle vc-glass';
        button.setAttribute('aria-label', '设置');
        button.setAttribute('data-settings', '');
        button.append(iconEl('user-round', 22));
        return button;
    };

    for (const item of DESTINATIONS) {
        const side = doc.createElement('button');
        side.type = 'button';
        side.className = 'vc-side-link';
        side.setAttribute('data-nav', item.nav);
        side.append(iconEl(item.icon, 24));
        const label = doc.createElement('span');
        label.className = 'vc-side-label';
        label.textContent = item.label;
        const badge = doc.createElement('span');
        badge.setAttribute('data-badge', 'inbox');
        side.append(label, badge);
        if (item.nav !== 'inbox') badge.remove();
        sidebar.append(side);

        const tab = doc.createElement('button');
        tab.type = 'button';
        tab.className = 'vc-tab';
        tab.setAttribute('data-nav', item.nav);
        tab.append(iconEl(item.icon, 24));
        const tabLabel = doc.createElement('span');
        tabLabel.textContent = item.label;
        tab.append(tabLabel);
        if (item.nav === 'inbox') {
            const tabBadge = doc.createElement('span');
            tabBadge.setAttribute('data-badge', 'inbox');
            tab.append(tabBadge);
        }
        tabbar.append(tab);
    }
    const foot = doc.createElement('div');
    foot.className = 'vc-side-foot';
    foot.append(makeSettingsButton());
    sidebar.append(foot);

    const body = doc.createElement('div');
    body.className = 'vc-shell-body';
    const pages = doc.createElement('div');
    pages.className = 'vc-shell-pages';
    let convoList = null;
    for (const item of DESTINATIONS) {
        const page = doc.createElement('section');
        page.className = 'vc-shell-page';
        page.setAttribute('data-page', item.nav);
        const navbar = doc.createElement('header');
        navbar.className = 'vc-navbar';
        const navTitle = doc.createElement('span');
        navTitle.className = 'vc-nav-title';
        navTitle.textContent = item.label;
        const spacer = doc.createElement('span');
        spacer.className = 'vc-nav-spacer';
        navbar.append(spacer, navTitle, makeSettingsButton());
        const scroll = doc.createElement('div');
        scroll.className = 'vc-shell-scroll';
        const heading = doc.createElement('h1');
        heading.className = 'vc-large-title';
        heading.setAttribute('data-shell-title', '');
        heading.textContent = item.label;
        scroll.append(heading);
        if (item.nav === 'chat') {
            convoList = doc.createElement('div');
            convoList.setAttribute('data-convo-list', '');
            convoList.setAttribute('aria-label', '会话');
            scroll.append(convoList);
        }
        page.append(navbar, scroll);
        bindNavScroll(scroll, navbar);
        pages.append(page);
    }

    const chatPane = doc.createElement('section');
    chatPane.className = 'vc-shell-chat';
    chatPane.setAttribute('aria-label', '对话');
    const chatNav = doc.createElement('header');
    chatNav.className = 'vc-navbar';
    const back = doc.createElement('button');
    back.type = 'button';
    back.className = 'vc-circle vc-glass vc-chat-back';
    back.setAttribute('aria-label', '返回');
    back.setAttribute('data-back', '');
    back.append(iconEl('chevron-left', 22));
    const listToggle = doc.createElement('button');
    listToggle.type = 'button';
    listToggle.className = 'vc-circle vc-glass vc-list-toggle';
    listToggle.setAttribute('aria-label', '隐藏会话列表');
    listToggle.setAttribute('data-list-toggle', '');
    listToggle.append(iconEl('message-circle', 22));
    const whoSlot = doc.createElement('div');
    whoSlot.className = 'vc-who-slot';
    const who = doc.createElement('div');
    who.className = 'vc-who vc-glass';
    const whoAvatar = doc.createElement('span');
    whoAvatar.setAttribute('data-who-avatar', '');
    const whoCopy = doc.createElement('span');
    whoCopy.className = 'vc-who-copy';
    const whoName = doc.createElement('b');
    whoName.setAttribute('data-who-name', '');
    const whoInst = doc.createElement('small');
    whoInst.setAttribute('data-who-inst', '');
    whoInst.hidden = true;
    whoCopy.append(whoName, whoInst);
    who.append(whoAvatar, whoCopy);
    whoSlot.append(who);
    const capsule = doc.createElement('div');
    capsule.className = 'vc-capsule vc-glass';
    const memoryBtn = doc.createElement('button');
    memoryBtn.type = 'button';
    memoryBtn.setAttribute('aria-label', '记忆');
    memoryBtn.setAttribute('data-memory', '');
    memoryBtn.append(iconEl('brain', 22));
    const moreBtn = doc.createElement('button');
    moreBtn.type = 'button';
    moreBtn.setAttribute('aria-label', '更多');
    moreBtn.setAttribute('data-more', '');
    moreBtn.append(iconEl('ellipsis', 22));
    capsule.append(memoryBtn, moreBtn);
    const chatSpacer = doc.createElement('span');
    chatSpacer.className = 'vc-nav-spacer';
    chatNav.append(back, listToggle, whoSlot, chatSpacer, capsule);
    const chatBody = doc.createElement('div');
    chatBody.className = 'vc-shell-chat-body';
    const chatEmpty = doc.createElement('div');
    chatEmpty.className = 'vc-empty vc-chat-empty';
    const emptyIcon = doc.createElement('span');
    emptyIcon.setAttribute('data-empty-icon', '');
    const emptyCopy = doc.createElement('p');
    emptyCopy.textContent = CHAT_EMPTY_COPY;
    chatEmpty.append(emptyIcon, emptyCopy);
    fillIcon(chatEmpty, 'message-circle');
    chatBody.append(chatEmpty);
    chatPane.append(chatNav, chatBody);

    const settingsPane = doc.createElement('section');
    settingsPane.className = 'vc-shell-settings';
    settingsPane.setAttribute('aria-label', '设置');
    const settingsNav = doc.createElement('header');
    settingsNav.className = 'vc-navbar';
    const done = doc.createElement('button');
    done.type = 'button';
    done.className = 'vc-btn vc-btn-text';
    done.setAttribute('data-settings-done', '');
    done.textContent = '完成';
    const settingsTitle = doc.createElement('span');
    settingsTitle.className = 'vc-nav-title';
    settingsTitle.textContent = '设置';
    const settingsSpacer = doc.createElement('span');
    settingsSpacer.className = 'vc-nav-spacer';
    settingsNav.append(done, settingsTitle, settingsSpacer);
    const settingsScroll = doc.createElement('div');
    settingsScroll.className = 'vc-shell-scroll';
    const settingsHeading = doc.createElement('h1');
    settingsHeading.className = 'vc-large-title';
    settingsHeading.textContent = '设置';
    settingsScroll.append(settingsHeading);
    settingsPane.append(settingsNav, settingsScroll);
    bindNavScroll(settingsScroll, settingsNav, settingsPane);

    body.append(pages, chatPane, settingsPane);
    root.append(sidebar, body, tabbar);
    doc.body.append(root);

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

    function paintBadge(count) {
        const text = count > 99 ? '99+' : String(count);
        for (const slot of root.querySelectorAll('[data-badge="inbox"]')) {
            slot.replaceChildren();
            if (count > 0) {
                const badge = doc.createElement('span');
                badge.className = 'vc-badge';
                badge.textContent = text;
                slot.append(badge);
            }
        }
    }

    function paintIdentity(row) {
        const title = titlesOf(row);
        whoName.textContent = title.name;
        whoInst.textContent = title.inst;
        whoInst.hidden = !title.inst;
        who.setAttribute('aria-label', title.name || '对话');
        whoAvatar.replaceChildren();
        const src = avatarUrl(row?.avatar);
        if (src) {
            const image = doc.createElement('img');
            image.className = 'vc-convo-avatar';
            image.alt = '';
            image.src = src;
            image.setAttribute('data-fly-target', '');
            whoAvatar.append(image);
        } else {
            const letter = doc.createElement('span');
            letter.className = 'vc-convo-avatar';
            letter.setAttribute('data-fly-target', '');
            letter.textContent = [...title.name][0] || '';
            whoAvatar.append(letter);
        }
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
        root.dataset.chrome = chrome.nav;
        root.dataset.wide = chrome.wide ? '1' : '0';
        const mediumChat = !chrome.wide && root.dataset.destination === 'chat' && entered;
        if (!mediumChat) root.dataset.list = 'open';
        else if (listHeld) root.dataset.list = 'open';
        else root.dataset.list = 'hidden';
        listToggle.setAttribute('aria-label', root.dataset.list === 'hidden' ? '显示会话列表' : '隐藏会话列表');
        sidebar.classList.toggle('is-collapsed', chrome.collapsible && collapsed);
        collapse.setAttribute('aria-label', collapsed && chrome.collapsible ? '展开侧边栏' : '收起侧边栏');
        const iconName = collapsed && chrome.collapsible ? 'chevron-right' : 'chevron-left';
        collapse.replaceChildren(iconEl(iconName, 22));
        const sidebarPx = sidebarCssWidth(globalThis.innerWidth, collapsed);
        doc.documentElement?.style?.setProperty?.('--vc-sidebar', `${sidebarPx}px`);
        if (chrome.nav !== 'tabbar') chatPane.classList.remove('is-push', 'is-pop');
        if (!leavingChat) root.dataset.chat = entered ? 'open' : 'closed';
        if (chrome.nav === 'tabbar') tabbar.classList.toggle('is-hidden', entered || keyboardOn);
        else tabbar.classList.remove('is-hidden');
        releaseMotion(chatPane);
        releaseMotion(pages);
        syncKeyboard();
        releaseCoveredSettings();
    }

    function syncKeyboard() {
        keyboardOn = readViewport(globalThis).keyboard > 0;
        doc.body.classList.toggle('is-keyboard', keyboardOn);
        if (root.dataset.chrome === 'tabbar') {
            tabbar.classList.toggle('is-hidden', entered || keyboardOn);
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
            return { onOpenConversation: (id) => { void openFromInstance({ relationshipId: id }, opener); } };
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
        const previous = root.dataset.destination || '';
        if (previous && previous !== nav) listHeld = false;
        if (root.dataset.settings === 'page') delete root.dataset.settings;
        root.dataset.destination = nav;
        tabbar.style.setProperty('--vc-tab', String(index));
        for (const button of root.querySelectorAll('[data-nav]')) {
            if (button.getAttribute('data-nav') === nav) button.setAttribute('aria-current', 'page');
            else button.removeAttribute('aria-current');
        }
        for (const page of root.querySelectorAll('.vc-shell-page')) {
            const on = page.getAttribute('data-page') === nav;
            const wasOn = page.classList.contains('is-on');
            page.classList.toggle('is-on', on);
            if (on && !wasOn) {
                page.classList.remove('is-enter');
                if (page.offsetWidth >= 0) page.classList.add('is-enter');
            }
        }
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

    function openChatColumn(row, fromButton) {
        const nextId = row?.relationshipId == null || row.relationshipId === '' ? '' : String(row.relationshipId);
        if (nextId !== listHeldFor) {
            listHeld = false;
            listHeldFor = nextId;
        }
        entered = true;
        paintIdentity(row);
        const phone = chromeForWidth(globalThis.innerWidth).nav === 'tabbar';
        if (phone) {
            showChat(row, fromButton);
            return;
        }
        chatPane.classList.remove('is-push', 'is-pop');
        root.dataset.chat = 'open';
        releaseMotion(chatPane);
        releaseMotion(pages);
        selectDestination('chat', null, { legacy: false });
    }

    async function openFromInstance(instance, opener) {
        const id = instance?.relationshipId == null ? '' : String(instance.relationshipId);
        const row = (id && rowById.get(id)) || {
            relationshipId: id,
            name: instance?.name,
            instanceName: instance?.instanceName,
            avatar: instance?.avatar,
            file: instance?.file,
            characterIndex: instance?.characterIndex,
            characterRef: instance?.characterRef,
        };
        if (!row.relationshipId && !row.file && !Number.isInteger(row.characterIndex)) return false;
        const ok = await openInstanceChat(row, { getContext, loadNative });
        if (!ok) return false;
        openChatColumn(row, opener);
        return true;
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
        paintBadge(pendingInboxWrites(inboxRows, inboxScope(getContext())).length);
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
                discovered = await loadRecentChatSnapshots(loadNative);
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
            if (!rows.length) {
                convoList.innerHTML = renderConversationEmpty();
                fillIcon(convoList, 'message-circle');
            } else {
                convoList.innerHTML = renderConversationRows(rows);
            }
            const current = snap && rowById.get(snap.relationshipId);
            if (current && entered) paintIdentity(current);
        } catch {
            if (token !== reloadToken) return;
            convoList.innerHTML = renderConversationError();
            fillIcon(convoList, 'circle-alert');
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
        return list('.vcms-overlay').some((node) => node.hidden !== true && node.getAttribute?.('hidden') == null);
    }

    function closeSettings({ immediate = false } = {}) {
        const handle = sheetHandle;
        sheetHandle = null;
        if (handle) {
            if (immediate && typeof handle.dismiss === 'function') handle.dismiss();
            else handle.close?.();
        }
        delete root.dataset.settings;
    }

    function releaseCoveredSettings() {
        if (chromeForWidth(globalThis.innerWidth).nav === 'tabbar') return;
        if (!coveringPageOpen()) return;
        closeSettings({ immediate: true });
    }

    function openSettings(opener) {
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
            sheetHandle = openSheet({
                title: '设置',
                large: true,
                body: form,
                opener,
                root: doc.body,
                onDone: () => { sheetHandle = null; },
            });
            return;
        }
        settingsScroll.replaceChildren(settingsHeading, form);
        root.dataset.settings = 'page';
    }

    function syncHostDrawer() {
        const open = TAVERN_ENTRIES.some((entry) => doc.getElementById?.(entry.panel)?.classList?.contains('openDrawer'));
        doc.body.classList.toggle('vc-host-drawer', open === true);
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
            listToggle.setAttribute('aria-label', root.dataset.list === 'hidden' ? '显示会话列表' : '隐藏会话列表');
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
        void openInstanceChat(row, { getContext, loadNative }).then((ok) => {
            if (!ok) {
                root.dataset.openState = 'miss';
                return;
            }
            root.dataset.openState = 'open';
            openChatColumn(row, node);
        }).catch(() => {
            root.dataset.openState = 'error';
        });
    });

    const events = getContext();
    if (events.eventSource?.on && events.eventTypes?.CHAT_CHANGED) {
        events.eventSource.on(events.eventTypes.CHAT_CHANGED, schedule);
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

    if (!placeSheld() && typeof MutationObserver === 'function') {
        const observer = new MutationObserver(() => {
            if (placeSheld()) observer.disconnect();
        });
        observer.observe(doc.body, { childList: true, subtree: true });
    }

    function loadSeam(nav) {
        if (typeof options.seams?.[nav] === 'function') return options.seams[nav]();
        return Promise.resolve(null);
    }

    convoList.innerHTML = '<div class="vc-skeleton-row"><span class="vc-skeleton vc-skeleton-avatar"></span><span class="vc-grow"><span class="vc-skeleton vc-skeleton-line"></span><span class="vc-skeleton vc-skeleton-line is-short"></span></span></div>'.repeat(3);
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
        if (next) who.style.background = next;
        else if (typeof who.style.removeProperty === 'function') who.style.removeProperty('background');
    }
    const routeExternal = (nav, opener) => {
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
    selectDestination('chat', null, { legacy: false });
    applyChrome();
    schedule();
    root.openConversation = (instance, opener) => openFromInstance(instance, opener);
    return root;
}
