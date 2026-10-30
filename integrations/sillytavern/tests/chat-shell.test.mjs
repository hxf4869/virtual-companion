import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as api from '../extension/vc-model-settings/api.js';
import { CHAT_UI_ROUTES } from '../extension/vc-model-settings/chat-ui-routes.js';
import {
    CHAT_EMPTY_COPY, CHAT_OFFLINE_COPY, CHAT_PICK_COPY,
    pendingInboxWrites, renderInboxStrip, renderChatEmpty, renderChannelBanner, renderChatNotices,
    loadInboxEvents, mountChatShell,
} from '../extension/vc-model-settings/chat-shell.js';
import { OPEN_MEMORY_EVENT } from '../extension/vc-model-settings/memory-page.js';
import { buttonByText, installMiniDom } from './mini-dom.mjs';

const SECRET = '秘密正文MARKER';
const event = (extra) => ({
    intent: 'BODY', stDelivered: false, linkStatus: 'present', conversationId: '20', relationshipId: '11', body: SECRET, ...extra,
});

test('待写入只数当前会话里尚未写入的正文', () => {
    const rows = [
        event(),
        event({ conversationId: '21' }),
        event({ intent: 'WAITING_HOST', body: null }),
        event({ stDelivered: true }),
        event({ linkStatus: 'removed' }),
        event({ linkStatus: 'invalidated' }),
        null,
    ];
    const pending = pendingInboxWrites(rows, { conversationId: '20', relationshipId: '11' });
    assert.equal(pending.length, 1);
    assert.equal(renderInboxStrip(pending.length).includes(SECRET), false);
    assert.match(renderInboxStrip(pending.length), /1 条消息待写入会话/);
    assert.match(renderInboxStrip(pending.length), /查看/);
    assert.equal(renderInboxStrip(0), '');
    assert.equal(renderInboxStrip(pending.length).includes('手机已收到'), false);
});

test('空会话、断线与模型状态不重复投影横幅', () => {
    assert.equal(renderChatEmpty({ characterName: '澄夏', messageCount: 0 }), renderChatEmpty({ characterName: '澄夏', messageCount: 0 }));
    assert.match(renderChatEmpty({ characterName: '澄夏', messageCount: 0 }), new RegExp(CHAT_EMPTY_COPY));
    assert.match(renderChatEmpty({ characterName: '', messageCount: 0 }), new RegExp(CHAT_PICK_COPY));
    assert.equal(renderChatEmpty({ characterName: '澄夏', messageCount: 2 }), '');
    assert.match(renderChannelBanner({ online: false }), new RegExp(CHAT_OFFLINE_COPY));
    assert.equal(renderChannelBanner({ online: true }), '');
    const html = renderChatNotices({
        characterName: '澄夏', messageCount: 0, online: false, inboxCount: 2, modelReason: 'credential-missing',
    });
    assert.match(html, new RegExp(CHAT_EMPTY_COPY));
    assert.match(html, new RegExp(CHAT_OFFLINE_COPY));
    assert.match(html, /2 条消息待写入会话/);
    assert.equal(html.includes('前台模型绑定'), false);
    assert.equal(html.includes('密钥'), false);
    assert.equal(html.includes('credential'), false);
});

test('inbox 数据函数只读取列表，渲染不带正文', async () => {
    const calls = [];
    const realFetch = globalThis.fetch;
    const realDocument = globalThis.document;
    globalThis.document = { cookie: 'vc_csrf=go-token' };
    api.setStHeadersProvider(() => ({ 'X-CSRF-Token': 'st-token' }));
    globalThis.fetch = async (url, init) => {
        calls.push({ url, ...init });
        return new Response(JSON.stringify([event(), event({ stDelivered: true })]), { status: 200 });
    };
    try {
        const rows = await loadInboxEvents();
        assert.equal(calls.length, 1);
        assert.equal(new URL(calls[0].url, 'https://example.invalid').pathname, `${api.BRIDGE_PREFIX}/api/v1/inbox`);
        assert.equal((calls[0].method || 'GET').toUpperCase(), 'GET');
        assert.equal(pendingInboxWrites(rows).length, 1);
        assert.equal(renderChatNotices({ characterName: '澄夏', messageCount: 1, online: true, inboxCount: pendingInboxWrites(rows).length }).includes(SECRET), false);
    } finally {
        globalThis.fetch = realFetch;
        globalThis.document = realDocument;
    }
});

test('聊天壳挂载空会话、断线、待写入条，不拉 inbox，记忆和角色只发事件', () => {
    const document = installMiniDom();
    const chat = document.createElement('div');
    chat.id = 'chat';
    document.body.append(chat);
    globalThis.ResizeObserver = class { observe() {} };
    const fetched = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url) => { fetched.push(url); throw new Error('mount must not fetch'); };
    const opened = [];
    const memoryEvents = [];
    globalThis.addEventListener('vc-open-characters', (event) => opened.push(event.detail));
    globalThis.addEventListener(OPEN_MEMORY_EVENT, (event) => memoryEvents.push(event.detail));
    const ctx = {
        groups: [], groupId: null, characters: [{ name: '澄夏' }], characterId: 0, chat: [],
        mainApi: 'openai', getChatCompletionModel: () => null,
        eventSource: { on() {} },
        eventTypes: { CHAT_CHANGED: 'chat', CHAT_COMPLETION_SETTINGS_READY: 'ready', SETTINGS_UPDATED: 'settings', OAI_PRESET_CHANGED_AFTER: 'preset' },
    };
    let charactersOpener = null;
    const shell = mountChatShell({
        getContext: () => ctx,
        openModels() {},
        openCharacters(opener) { charactersOpener = opener; },
    });
    assert.match(document.body.textContent, new RegExp(CHAT_EMPTY_COPY));
    assert.match(document.body.textContent, /模型待配置/);
    assert.equal(document.body.textContent.includes('前台模型绑定'), false);
    assert.equal(fetched.length, 0);
    shell.setChannel({ online: false });
    assert.match(document.body.textContent, new RegExp(CHAT_OFFLINE_COPY));
    shell.setInboxEvents([event(), event(), event({ body: '另一条也不可见', stDelivered: true })], { conversationId: '20' });
    assert.match(document.body.textContent, /2 条消息待写入会话/);
    assert.equal(document.body.textContent.includes(SECRET), false);
    assert.equal(document.body.textContent.includes('另一条也不可见'), false);
    shell.setChannel({ online: true });
    assert.equal(document.body.textContent.includes(CHAT_OFFLINE_COPY), false);
    shell.setBudgetInsufficient(true);
    assert.match(document.querySelector('#vc-chat-budget')?.textContent || '', /当月可用额度不足/);
    shell.setBudgetInsufficient(false);
    assert.equal(document.querySelector('#vc-chat-budget'), null);
    buttonByText(document, '记忆').click();
    assert.equal(memoryEvents.length, 1);
    assert.equal(memoryEvents[0].opener, buttonByText(document, '记忆'));
    buttonByText(document, '角色').click();
    assert.equal(opened.length, 1);
    assert.equal(charactersOpener, buttonByText(document, '角色'));
    assert.equal(document.body.textContent.includes('强制覆盖'), false);
    globalThis.fetch = realFetch;
});

function createEventSource() {
    const listeners = new Map();
    return {
        on(type, fn) {
            const list = listeners.get(type) || [];
            list.push(fn);
            listeners.set(type, list);
        },
        emit(type, ...args) {
            for (const fn of listeners.get(type) || []) fn(...args);
        },
    };
}

function shellContext(events, onlineStatus) {
    return {
        groups: [], groupId: null, characters: [{ name: '澄夏' }], characterId: 0, chat: [],
        mainApi: 'openai', getChatCompletionModel: () => null, onlineStatus,
        eventSource: events,
        eventTypes: {
            CHAT_CHANGED: 'chat', CHAT_COMPLETION_SETTINGS_READY: 'ready',
            SETTINGS_UPDATED: 'settings', OAI_PRESET_CHANGED_AFTER: 'preset',
            ONLINE_STATUS_CHANGED: 'online_status_changed',
        },
    };
}

test('聊天断线跟随宿主在线状态和浏览器离线，恢复后清除', () => {
    const previousAdd = globalThis.addEventListener;
    const previousRemove = globalThis.removeEventListener;
    const bus = { offline: [], online: [] };
    globalThis.addEventListener = (type, fn) => {
        if (type === 'offline' || type === 'online') bus[type].push(fn);
    };
    globalThis.removeEventListener = () => {};
    const fire = (type) => { for (const fn of bus[type]) fn(); };
    try {
        installMiniDom();
        const events = createEventSource();
        const ctx = shellContext(events, 'Valid');
        mountChatShell({ getContext: () => ctx, openModels() {} });
        assert.equal(document.body.textContent.includes(CHAT_OFFLINE_COPY), false);
        events.emit('online_status_changed', 'no_connection');
        assert.match(document.body.textContent, new RegExp(CHAT_OFFLINE_COPY));
        events.emit('online_status_changed', 'Valid');
        assert.equal(document.body.textContent.includes(CHAT_OFFLINE_COPY), false);
        fire('offline');
        assert.match(document.body.textContent, new RegExp(CHAT_OFFLINE_COPY));
        fire('online');
        assert.equal(document.body.textContent.includes(CHAT_OFFLINE_COPY), false);
        events.emit('online_status_changed', 'no_connection');
        fire('offline');
        fire('online');
        assert.match(document.body.textContent, new RegExp(CHAT_OFFLINE_COPY));
        events.emit('online_status_changed', 'Valid');
        assert.equal(document.body.textContent.includes(CHAT_OFFLINE_COPY), false);

        installMiniDom();
        mountChatShell({ getContext: () => shellContext(createEventSource(), 'no_connection'), openModels() {} });
        assert.match(document.body.textContent, new RegExp(CHAT_OFFLINE_COPY));
    } finally {
        if (previousAdd) globalThis.addEventListener = previousAdd;
        else delete globalThis.addEventListener;
        if (previousRemove) globalThis.removeEventListener = previousRemove;
        else delete globalThis.removeEventListener;
    }
});

test('旧导航主动陪伴只打开一次，新外观改为目的地事件', () => {
    installMiniDom();
    const events = createEventSource();
    const ctx = shellContext(events, 'Valid');
    let opens = 0;
    let legacy = 0;
    const navs = [];
    globalThis.addEventListener('vc-view-inbox', () => { legacy += 1; });
    globalThis.addEventListener('vc-shell-navigate', (event) => navs.push(event.detail));
    const shell = mountChatShell({
        getContext: () => ctx,
        openModels() {},
        openInbox() { opens += 1; },
    });
    buttonByText(document, '主动陪伴').click();
    assert.equal(opens, 1);
    assert.equal(legacy, 0);
    assert.deepEqual(navs, []);
    shell.setInboxEvents([event()], { conversationId: '20' });
    buttonByText(document, '查看').click();
    assert.equal(opens, 1);
    assert.equal(legacy, 1);
    assert.deepEqual(navs, []);

    installMiniDom();
    document.body.classList.add('vc-ui');
    opens = 0;
    legacy = 0;
    navs.length = 0;
    const next = mountChatShell({
        getContext: () => shellContext(createEventSource(), 'Valid'),
        openModels() {},
        openInbox() { opens += 1; },
        openCharacters() { opens += 1; },
    });
    buttonByText(document, '主动陪伴').click();
    buttonByText(document, '角色').click();
    next.setInboxEvents([event()], { conversationId: '20' });
    buttonByText(document, '查看').click();
    assert.equal(opens, 0);
    assert.equal(legacy, 0);
    assert.deepEqual(navs.map((detail) => detail.destination), ['inbox', 'characters', 'inbox']);
    assert.equal(navs[2].opener, buttonByText(document, '查看'));
});

test('新外观空状态不复用旧 #vc-chat-empty 字面色', () => {
    const css = fs.readFileSync(new URL('../extension/vc-model-settings/chat-shell.css', import.meta.url), 'utf8');
    const at = css.indexOf('#B7C1D2');
    assert.notEqual(at, -1);
    assert.match(css.slice(Math.max(0, at - 240), at), /body:not\(\.vc-ui\) #vc-chat-empty/);
});

test('子任务 4 需要并入的聊天路由还没在本文件之外写死实现', () => {
    assert.equal(CHAT_UI_ROUTES.some((route) => route.method === 'GET' && route.path.test('/api/v1/inbox') && !route.path.test('/api/v1/inbox/ev-1/claim')), true);
    assert.equal(CHAT_UI_ROUTES.some((route) => route.method === 'PATCH' && route.path.test('/api/v1/relationships/11') && !route.path.test('/api/v1/relationships/011')), true);
});
