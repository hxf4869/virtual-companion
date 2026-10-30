// UI-P01：只给原生聊天增加导航、身份摘要和状态条，不接管生成、消息 DOM 或卡内 iframe。
import { storyRequest } from './api.js';
import { mountInstancePage } from './instance-page.js';
import { BUDGET_COPY } from './model-logic.js';
import { requestOpenMemory } from './memory-page.js';

export const CHAT_EMPTY_COPY = '这段会话还没有消息。';
export const CHAT_OFFLINE_COPY = '聊天通道已断开';
export const CHAT_PICK_COPY = '选择一位角色';

// 新外观目的地事件。detail.destination：
// chat | characters | memory | inbox | story | models | account。
// detail.opener 是触发元素或 null。外壳在 shell.js 监听后切换目的地；
// models / account 不在五个标签里，下一轮改走设置页。body.vc-ui 时本文件只发这个事件。
export const SHELL_NAVIGATE_EVENT = 'vc-shell-navigate';

export function requestShellDestination(destination, opener, target = globalThis) {
    const name = String(destination || '');
    if (!name) return null;
    const event = new CustomEvent(SHELL_NAVIGATE_EVENT, {
        detail: { destination: name, opener: opener ?? null },
    });
    target.dispatchEvent?.(event);
    return event;
}

export function pendingInboxWrites(rows, scope = {}) {
    if (!Array.isArray(rows)) return [];
    const conversationId = scope?.conversationId;
    const relationshipId = scope?.relationshipId;
    return rows.filter((row) => {
        if (!row || row.intent !== 'BODY' || row.stDelivered !== false || row.linkStatus !== 'present') return false;
        if (conversationId != null && conversationId !== '' && String(row.conversationId) !== String(conversationId)) return false;
        if (relationshipId != null && relationshipId !== '' && String(row.relationshipId) !== String(relationshipId)) return false;
        return true;
    });
}

export function renderInboxStrip(count) {
    const total = Number(count);
    if (!Number.isInteger(total) || total <= 0) return '';
    return `<div class="vc-chat-inbox" role="status"><span>${total} 条消息待写入会话</span><button type="button" data-action="view-inbox">查看</button></div>`;
}

export function renderChatEmpty({ characterName = '', messageCount = 0 } = {}) {
    if (Number(messageCount) > 0) return '';
    return `<p id="vc-chat-empty">${characterName ? CHAT_EMPTY_COPY : CHAT_PICK_COPY}</p>`;
}

export function renderChannelBanner({ online = true } = {}) {
    if (online) return '';
    return `<p class="vc-chat-offline" role="status">${CHAT_OFFLINE_COPY}</p>`;
}

export function renderChatNotices({ characterName = '', messageCount = 0, online = true, inboxCount = 0 } = {}) {
    return `${renderChatEmpty({ characterName, messageCount })}${renderChannelBanner({ online })}${renderInboxStrip(inboxCount)}`;
}

export async function loadInboxEvents() {
    const data = await storyRequest('GET', '/api/v1/inbox');
    return Array.isArray(data) ? data : [];
}

function ensureChatStyles() {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return;
    const links = typeof document.querySelectorAll === 'function' ? document.querySelectorAll('link') : [];
    if ([...links].some((node) => node.getAttribute?.('data-vc-chat-shell') != null)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.setAttribute('data-vc-chat-shell', '');
    link.href = new URL('./chat-shell.css', import.meta.url).href;
    (document.head || document.documentElement).append(link);
}

function visibleMessages(chat) {
    if (!Array.isArray(chat)) return 0;
    return chat.filter((message) => message && !message.is_system).length;
}

let charactersPage;
function fallbackOpenCharacters(opener) {
    if (!charactersPage) charactersPage = mountInstancePage();
    charactersPage.open(opener);
}

export function mountChatShell({
    getContext, openModels, openCharacters, openInbox, openStory, openAccount, openMemory,
} = {}) {
    ensureChatStyles();
    if (document.querySelector('#vc-chat-nav')) return;
    document.body.classList.add('vc-chat-shell');
    const nav = document.createElement('nav');
    nav.id = 'vc-chat-nav';
    nav.setAttribute('aria-label', '陪伴导航');
    const identity = document.createElement('div');
    identity.className = 'vc-chat-identity';
    const name = document.createElement('strong');
    const model = document.createElement('span');
    model.className = 'vc-chat-model';
    const memory = document.createElement('button');
    memory.type = 'button';
    memory.className = 'vc-chat-memory';
    memory.append(document.createTextNode('记忆'));
    memory.addEventListener('click', () => requestOpenMemory(memory));
    identity.setAttribute('aria-live', 'polite');
    identity.append(name, model, memory);
    const status = document.createElement('div');
    status.id = 'vc-chat-status';
    nav.append(identity, status);
    function button(label, icon, navName, action) {
        const control = document.createElement('button');
        control.type = 'button';
        control.setAttribute('data-nav', navName);
        const glyph = document.createElement('i');
        glyph.className = `fa-solid ${icon}`;
        glyph.setAttribute('aria-hidden', 'true');
        control.append(glyph, document.createTextNode(label));
        control.addEventListener('click', () => action(control));
        nav.append(control);
        return control;
    }
    const moreDialog = document.createElement('dialog');
    moreDialog.id = 'vc-chat-more';
    moreDialog.setAttribute('aria-label', '更多');
    let moreOpener = null;
    function closeMore() {
        if (moreDialog.open) moreDialog.close();
        moreOpener?.focus?.();
    }
    function openMore(opener) {
        moreOpener = opener;
        if (!moreDialog.open) moreDialog.showModal();
        moreDialog.querySelector('button')?.focus?.();
    }
    function moreItem(label, action) {
        const control = document.createElement('button');
        control.type = 'button';
        control.textContent = label;
        control.addEventListener('click', () => {
            closeMore();
            action(control);
        });
        moreDialog.append(control);
        return control;
    }
    const back = document.createElement('button');
    back.type = 'button';
    back.textContent = '返回';
    back.addEventListener('click', closeMore);
    moreDialog.append(back);
    const openMemoryPage = (opener) => (typeof openMemory === 'function' ? openMemory(opener) : requestOpenMemory(opener));
    function legacyOrShell(destination, opener, legacy) {
        if (document.body?.classList?.contains('vc-ui')) {
            requestShellDestination(destination, opener);
            return;
        }
        legacy?.(opener);
    }
    moreItem('记忆', (opener) => legacyOrShell('memory', opener, openMemoryPage));
    moreItem('主动陪伴', (opener) => legacyOrShell('inbox', opener, (control) => openInbox?.(control)));
    moreItem('剧情', (opener) => legacyOrShell('story', opener, (control) => openStory?.(control)));
    moreItem('账户', (opener) => legacyOrShell('account', opener, (control) => openAccount?.(control)));
    moreDialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        closeMore();
    });
    button('聊天', 'fa-comments', 'chat', () => document.querySelector('#send_textarea')?.focus());
    button('角色', 'fa-address-card', 'characters', (opener) => {
        legacyOrShell('characters', opener, (control) => {
            globalThis.dispatchEvent(new CustomEvent('vc-open-characters', { detail: { opener: control } }));
            (typeof openCharacters === 'function' ? openCharacters : fallbackOpenCharacters)(control);
        });
    });
    button('记忆', 'fa-brain', 'memory', (opener) => legacyOrShell('memory', opener, openMemoryPage));
    button('主动陪伴', 'fa-bell', 'inbox', (opener) => legacyOrShell('inbox', opener, (control) => openInbox?.(control)));
    button('剧情', 'fa-book-open', 'story', (opener) => legacyOrShell('story', opener, (control) => openStory?.(control)));
    button('模型', 'fa-microchip', 'models', (opener) => legacyOrShell('models', opener, (control) => openModels?.(control)));
    button('账户', 'fa-user-shield', 'account', (opener) => legacyOrShell('account', opener, (control) => openAccount?.(control)));
    button('更多', 'fa-ellipsis', 'more', openMore);
    document.body.append(nav, moreDialog);
    // 断线只认两路真实信号：宿主 online_status === 'no_connection'
    // （st-context onlineStatus，变更经 ONLINE_STATUS_CHANGED），以及浏览器 offline。
    // 生成失败本身不会把 online_status 写成 no_connection，不在这里当成断线。
    const readBrowserOnline = () => {
        try {
            return typeof navigator === 'undefined' || navigator.onLine !== false;
        } catch {
            return true;
        }
    };
    let browserOnline = readBrowserOnline();
    let apiStatus;
    let online = true;
    let inboxCount = 0;
    let budgetInsufficient = false;
    const updateHeight = () => {
        const rect = nav.getBoundingClientRect?.();
        if (rect) document.body.style.setProperty('--vc-chat-nav-height', `${rect.height}px`);
        const statusRect = status.getBoundingClientRect?.();
        const space = status.childNodes?.length && statusRect ? statusRect.height : 0;
        document.body.style.setProperty('--vc-chat-status-space', `${space}px`);
    };
    if (typeof ResizeObserver === 'function') {
        const resizeObserver = new ResizeObserver(updateHeight);
        resizeObserver.observe(nav);
    }
    function syncEmpty(text) {
        const host = document.querySelector('#chat') || status;
        let empty = document.querySelector('#vc-chat-empty');
        if (!text) {
            if (empty) empty.textContent = '';
            return;
        }
        if (!empty) {
            empty = document.createElement('p');
            empty.id = 'vc-chat-empty';
            host.append(empty);
        }
        empty.textContent = text;
    }
    function paintStatus() {
        status.textContent = '';
        if (!online) {
            const offline = document.createElement('p');
            offline.className = 'vc-chat-offline';
            offline.setAttribute('role', 'status');
            offline.textContent = CHAT_OFFLINE_COPY;
            status.append(offline);
        }
        if (budgetInsufficient) {
            const budget = document.createElement('p');
            budget.id = 'vc-chat-budget';
            budget.className = 'vc-chat-offline';
            budget.setAttribute('role', 'status');
            budget.textContent = BUDGET_COPY;
            status.append(budget);
        }
        if (inboxCount > 0) {
            const row = document.createElement('div');
            row.className = 'vc-chat-inbox';
            row.setAttribute('role', 'status');
            const label = document.createElement('span');
            label.textContent = `${inboxCount} 条消息待写入会话`;
            const view = document.createElement('button');
            view.type = 'button';
            view.setAttribute('data-action', 'view-inbox');
            view.textContent = '查看';
            view.addEventListener('click', () => {
                if (document.body?.classList?.contains('vc-ui')) {
                    requestShellDestination('inbox', view);
                    return;
                }
                globalThis.dispatchEvent(new CustomEvent('vc-view-inbox', { detail: { count: inboxCount, opener: view } }));
            });
            row.append(label, view);
            status.append(row);
        }
    }
    const refresh = () => {
        const context = getContext();
        const group = context.groups?.find((item) => String(item.id) === String(context.groupId));
        const characterName = group?.name || context.characters?.[context.characterId]?.name || '';
        name.textContent = characterName || CHAT_PICK_COPY;
        name.title = name.textContent;
        const selectedModel = context.mainApi === 'openai' ? context.getChatCompletionModel?.() : null;
        model.textContent = selectedModel || '模型待配置';
        model.title = model.textContent;
        const messageCount = visibleMessages(context.chat);
        syncEmpty(messageCount > 0 ? '' : (characterName ? CHAT_EMPTY_COPY : CHAT_PICK_COPY));
        paintStatus();
    };
    const context = getContext();
    apiStatus = context.onlineStatus;
    online = browserOnline && apiStatus !== 'no_connection';
    const applyChannel = () => {
        online = browserOnline && apiStatus !== 'no_connection';
        paintStatus();
    };
    context.eventSource.on(context.eventTypes.CHAT_CHANGED, refresh);
    context.eventSource.on(context.eventTypes.CHAT_COMPLETION_SETTINGS_READY, refresh);
    context.eventSource.on(context.eventTypes.SETTINGS_UPDATED, refresh);
    context.eventSource.on(context.eventTypes.OAI_PRESET_CHANGED_AFTER, refresh);
    if (context.eventTypes?.ONLINE_STATUS_CHANGED) {
        context.eventSource.on(context.eventTypes.ONLINE_STATUS_CHANGED, (status) => {
            apiStatus = status;
            applyChannel();
        });
    }
    if (typeof globalThis.addEventListener === 'function') {
        globalThis.addEventListener('offline', () => {
            browserOnline = false;
            applyChannel();
        });
        globalThis.addEventListener('online', () => {
            browserOnline = true;
            applyChannel();
        });
    }
    refresh();
    updateHeight();
    return {
        setChannel(next = {}) {
            if (typeof next.online === 'boolean') online = next.online;
            paintStatus();
        },
        setInboxEvents(events, scope) {
            inboxCount = pendingInboxWrites(events, scope).length;
            paintStatus();
        },
        setBudgetInsufficient(on) {
            budgetInsufficient = on === true;
            paintStatus();
        },
        refresh,
    };
}
