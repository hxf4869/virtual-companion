// 正式电脑端的开发入口。不导入 ST script.js、st-context、扩展启动器或原生页面。
import { createDesktopClient } from './client.js';
import { setStHeadersProvider, captureSessionContext } from '../../api.js';
import { mountShell, registerShellTabs } from '../../shell.js';
import { chatSnapshotsFromRecent, avatarUrl } from '../../conversations.js';
import { enableVcUi } from '../../ui/theme.js';
import { iconSpriteUrl } from '../../ui/icons.js';
import { mountDesktopChatView } from '../build/index.js';
import { mountDesktopShell } from '../host.js';
import { mountSettingsShell } from '../settings-shell.js';

const client = createDesktopClient();
const listeners = new Map();
const eventSource = {
    on(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeListener(type, fn) { listeners.get(type)?.delete(fn); },
    emit(type, ...args) { for (const fn of listeners.get(type) || []) fn(...args); },
};
const context = { characters: [], chat: [], chatMetadata: {}, characterId: undefined, chatId: '', name1: '', name2: '',
    eventSource, eventTypes: { CHAT_CHANGED: 'chat-changed', MESSAGE_RECEIVED: 'message-received' } };
const getContext = () => context;
const drafts = new Map();
let runtime, view, shell, currentRow, read = 0, readAbort;
const chat = { messages: [], status: 'empty', draft: '', sprite: iconSpriteUrl(), avatar: '', canSend: false, error: '', conversation: '',
    onDraft(value) { chat.draft = value; drafts.set(chat.conversation, value); paint(); },
    onSend() { if (typeof runtime?.generate === 'function') void runtime.generate(); },
    onRetry() { if (currentRow) void shell.openConversation(currentRow); },
};
function paint() { view?.update(chat); }
const chatKey = row => JSON.stringify([row.avatar, row.file]);

async function openConversation(row) {
    if (!row?.avatar || !row?.file) return false;
    currentRow = row;
    readAbort?.abort(); readAbort = new AbortController();
    const ticket = ++read;
    chat.conversation = chatKey(row); chat.draft = drafts.get(chat.conversation) || '';
    chat.status = 'loading'; chat.error = ''; paint();
    try {
        const records = await client.readChat(row, { signal: readAbort.signal });
        if (ticket !== read) return false;
        if (!Array.isArray(records) || !records[0]?.chat_metadata) throw new Error('聊天没有加载出来');
        Object.assign(context, { chatMetadata: records[0].chat_metadata, chat: records.slice(1), chatId: row.file,
            characterId: context.characters.findIndex(card => card.avatar === row.avatar), name1: records[0].user_name || '', name2: records[0].character_name || '' });
        Object.assign(chat, { messages: context.chat, status: 'ready', avatar: avatarUrl(row.avatar) });
        paint(); eventSource.emit(context.eventTypes.CHAT_CHANGED);
        return true;
    } catch (error) {
        if (ticket !== read) return false;
        chat.status = 'error'; chat.error = error.status === 401 || error.status === 409
            ? '登录状态或聊天已变化，请重新打开页面。' : '聊天没有加载出来，请重试。';
        paint(); return true;
    }
}

// 页面控制器按需加载；仅在各自空槽位内渲染，不依赖聊天运行模块就绪。
function lazyPage(load, mount) {
    return (container, args) => {
        let handle, dead = false;
        const pending = load().then(module => { if (!dead) handle = mount(module, container, args); }).catch(() => {
            if (!dead) { const message = document.createElement('p'); message.setAttribute('role', 'alert'); message.textContent = '页面没有加载出来，请重新打开。'; container.append(message); }
        });
        return { refresh() { void pending.then(() => { if (!dead) handle?.refresh?.(); }); }, destroy() { dead = true; handle?.destroy?.(); } };
    };
}

async function start() {
    enableVcUi();
    await client.initialize();
    setStHeadersProvider(client.headers);
    const session = await captureSessionContext();
    if (session.accountId !== client.identity.accountId || session.sessionId !== client.identity.sessionId) throw new Error('登录状态已变化，请重新打开页面。');
    registerShellTabs({
        characters: lazyPage(() => import('../../instance-page.js'), (module, container, args) => module.mountCharactersTab(container, {
            ...args, getContext, getCards: () => module.cardsFromContext(context), getBindings: () => module.bindingsFromContext(context),
            onOpenInstance: row => shell.openConversation(row),
        })),
        memory: lazyPage(() => import('../../memory-page.js'), (module, container, args) => module.mountMemoryTab(container, {
            ...args, getRelationshipId: () => context.chatMetadata.vc_binding?.relationshipId || '',
        })),
        inbox: lazyPage(() => import('../../inbox-page.js'), (module, container, args) => module.mountInboxTab(container, args)),
        story: lazyPage(() => import('../../story-page.js'), (module, container, args) => module.mountStoryTab(container, args)),
    });
    shell = mountShell({ getContext, storage: { getItem(key) { return key === 'vc-ui' ? 'on' : localStorage.getItem(key); }, setItem: (key, value) => localStorage.setItem(key, value) },
        loadChatSnapshots: async () => chatSnapshotsFromRecent(await client.recent()), openConversation,
        mountDesktopSettings: container => mountSettingsShell(container, { getContext }),
        mountChatSurface(container) {
            const host = document.createElement('div'); host.className = 'vc-desktop-chat-root'; container.append(host);
            view = mountDesktopChatView(host, chat);
        },
    });
    mountDesktopShell({ shell, getContext });
    document.querySelector('#vc-desktop-startup')?.remove();
    document.documentElement.dataset.vcApp = 'ready';
    void client.characters().then(characters => {
        context.characters = characters;
        eventSource.emit(context.eventTypes.CHAT_CHANGED);
    }).catch(() => { document.documentElement.dataset.vcCharacters = 'error'; });
    // 不 await 聊天准备：导航、历史和设置拥有各自生命周期。
    void import('./runtime.js').then(module => module.prepareChatRuntime()).then(value => {
        runtime = value; chat.canSend = typeof runtime.generate === 'function'; paint();
        document.documentElement.dataset.vcRuntime = 'prepared';
    }).catch(() => { document.documentElement.dataset.vcRuntime = 'error'; });
}
void start().catch(error => {
    const node = document.querySelector('#vc-desktop-startup');
    if (node) { node.setAttribute('role', 'alert'); node.textContent = error.message || '页面没有加载出来，请重新打开。'; }
});
