// 正式电脑端的开发入口。不导入 ST script.js、st-context、扩展启动器或原生页面。
import { createDesktopClient } from './client.js';
import { setStHeadersProvider, captureSessionContext } from '../../api.js';
import { mountShell, registerShellTabs } from '../../shell.js';
import { chatSnapshotsFromRecent, avatarUrl } from '../../conversations.js';
import { enableVcUi } from '../../ui/theme.js';
import { iconSpriteUrl } from '../../ui/icons.js';
import { openSheet } from '../../ui/sheet.js';
import { showToast } from '../../ui/toast.js';
import { readDraft, writeDraft } from '../../chat-compose.js';
import { mergeInput, showF2Draft } from '../../f2-client.js';
import { mountDesktopChatView } from '../build/index.js';
import { mountDesktopShell } from '../host.js';
import { mountSettingsShell } from '../settings-shell.js';
import { EventEmitter } from './engine/events.js';
import { event_types } from './engine/st/events.js';

const client = createDesktopClient();
const eventSource = new EventEmitter([event_types.APP_INITIALIZED, event_types.APP_READY]);
const context = { characters: [], chat: [], chatMetadata: {}, characterId: undefined, chatId: '', name1: '', name2: '',
    extensionPrompts: {}, eventSource, eventTypes: event_types };
const getContext = () => context;
const drafts = new Map();
let runtime, view, shell, currentRow, currentRecords, charactersReady, read = 0, activated = 0, readAbort;
const draftId = key => JSON.stringify([client.identity.accountId, ...JSON.parse(key)]);
const draftOf = key => drafts.has(key) ? drafts.get(key) : readDraft(draftId(key));
function setDraft(key, value) {
    drafts.set(key, value); writeDraft(draftId(key), value);
    if (chat.conversation === key) { chat.draft = value; paint(); }
}
const chat = { messages: [], status: 'empty', draft: '', sprite: iconSpriteUrl(), avatar: '', canSend: false, busy: false,
    notice: '', conflict: false, enterToSend: true, error: '', conversation: '',
    onDraft(value) { setDraft(chat.conversation, value); },
    onSend() { void runtime?.send(chat.draft); },
    onStop() { void runtime?.stop(); },
    onRetry() { if (currentRow) return openConversation(currentRow, { latest: true }).then(opened => { if (opened) document.querySelector('#send_textarea')?.focus(); }); },
    onNoticeRetry() {
        if (!runtime || chat.notice === '登录状态或聊天已变化，请重新打开页面。') { location.reload(); return; }
        if (chat.conflict || !chat.canSend) return chat.onRetry();
        else void runtime.retry();
    },
    async onCopyDraft() {
        try { const text = await runtime?.copyRejected(); if (text) { await navigator.clipboard.writeText(text); showToast('已复制'); } }
        catch { showToast('没有完成，请重试。', { type: 'failure' }); }
    },
};
function paint() { document.body.dataset.generating = String(chat.busy); view?.update(chat); }
const chatKey = row => JSON.stringify([row.avatar, row.file]);

async function activateCurrent(ticket, latest) {
    if (!runtime || !currentRecords || activated === ticket) return;
    activated = ticket;
    const row = currentRow, records = currentRecords, signal = readAbort.signal;
    await charactersReady;
    if (ticket !== read) return;
    try { await runtime.activate(row, records, { signal, latest }); }
    catch (error) {
        if (ticket !== read || signal.aborted) return;
        chat.canSend = false; chat.notice = error.status === 401 || error.status === 409
            ? '登录状态或聊天已变化，请重新打开页面。' : '聊天没有加载出来，请重试。'; paint();
    }
}

async function openConversation(row, { latest = false } = {}) {
    if (!row?.avatar || !row?.file) return false;
    currentRow = row;
    readAbort?.abort(); readAbort = new AbortController();
    void runtime?.stop();
    currentRecords = null;
    const ticket = ++read;
    chat.conversation = chatKey(row); chat.draft = draftOf(chat.conversation) || '';
    chat.status = 'loading'; chat.error = ''; chat.notice = ''; chat.conflict = false; chat.canSend = false; chat.busy = false; paint();
    try {
        const records = await client.readChat(row, { signal: readAbort.signal });
        if (ticket !== read) return false;
        if (!Array.isArray(records) || !records[0]?.chat_metadata) throw new Error('聊天没有加载出来');
        currentRecords = records;
        Object.assign(chat, { messages: records.slice(1), status: 'ready', avatar: avatarUrl(row.avatar) });
        paint();
        void activateCurrent(ticket, latest);
        return true;
    } catch (error) {
        if (ticket !== read) return false;
        chat.status = 'error'; chat.error = error.status === 401 || error.status === 409
            ? '登录状态或聊天已变化，请重新打开页面。' : '聊天没有加载出来，请重试。';
        paint(); return true;
    }
}

function choosePersona(options, { signal }) {
    return new Promise(resolve => {
        let selected = '';
        const body = document.createElement('div'); body.className = 'vc-column';
        const sheet = openSheet({ title: '人设', body, onDone() { signal?.removeEventListener('abort', abort); resolve(selected); } });
        const abort = () => sheet.dismiss();
        signal?.addEventListener('abort', abort, { once: true });
        for (const option of options) {
            const button = document.createElement('button'); button.type = 'button'; button.className = 'vc-btn'; button.textContent = option.name;
            button.addEventListener('click', () => { selected = option.avatar; void sheet.close(); }); body.append(button);
        }
    });
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
    charactersReady = client.characters().then(characters => {
        context.characters = characters;
    }).catch(() => { document.documentElement.dataset.vcCharacters = 'error'; });
    // 不 await 聊天准备：导航、历史和设置拥有各自生命周期。
    void import('./runtime.js').then(module => module.prepareChatRuntime({ client, context, choosePersona, readInput: () => chat.draft,
        onConflict(snapshot, error) { showF2Draft(snapshot, error, { latest: () => chat.onNoticeRetry(), copy: () => chat.onCopyDraft() }); },
        onChange(state) { if (state.key !== chat.conversation || chat.status !== 'ready') return; Object.assign(chat, state); paint(); },
        onTakeDraft(key, input) { if (draftOf(key) === input) setDraft(key, ''); },
        onRestoreDraft(key, input) {
            if (input) setDraft(key, mergeInput(draftOf(key), input));
        },
    })).then(async value => {
        runtime = value;
        document.documentElement.dataset.vcRuntime = 'prepared';
        await eventSource.emit(event_types.APP_INITIALIZED); await eventSource.emit(event_types.APP_READY);
        void activateCurrent(read, false);
    }).catch(() => { document.documentElement.dataset.vcRuntime = 'error'; chat.notice = '聊天没有加载出来，请重试。'; paint(); });
}
void start().catch(error => {
    const node = document.querySelector('#vc-desktop-startup');
    if (node) { node.setAttribute('role', 'alert'); node.textContent = error.message || '页面没有加载出来，请重新打开。'; }
});
