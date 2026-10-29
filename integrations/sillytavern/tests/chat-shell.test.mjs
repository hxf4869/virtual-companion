import test from 'node:test';
import assert from 'node:assert/strict';
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

test('子任务 4 需要并入的聊天路由还没在本文件之外写死实现', () => {
    assert.equal(CHAT_UI_ROUTES.some((route) => route.method === 'GET' && route.path.test('/api/v1/inbox') && !route.path.test('/api/v1/inbox/ev-1/claim')), true);
    assert.equal(CHAT_UI_ROUTES.some((route) => route.method === 'PATCH' && route.path.test('/api/v1/relationships/11') && !route.path.test('/api/v1/relationships/011')), true);
});
