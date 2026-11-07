import test from 'node:test';
import assert from 'node:assert/strict';
import { createDesktopClient } from '../extension/vc-model-settings/desktop/standalone/client.js';

test('独立客户端的每次ST请求绑定HTML初始身份；换页身份后旧实例不能自动冒用', async () => {
    let account = '9007199254740993', session = '17';
    const calls = [];
    const client = createDesktopClient({ document: { querySelector(selector) { return { content: selector.includes('account-id') ? account : session }; } },
        fetchImpl: async (url, options) => {
            calls.push({ url, ...options });
            return new Response(JSON.stringify(url === '/csrf-token' ? { token: 'synthetic-token' } : url === '/auth/api/session?include=chatStorage'
                ? { accountId: account, sessionId: session, chatStorage: { mode: 'ST', authorityEpoch: '1' } } : []), { status: 200 });
        } });
    await client.initialize();
    account = '52'; session = '18';
    await client.readChat({ avatar: 'synthetic.png', file: 'synthetic' });
    const chat = calls.find(call => call.url === '/api/chats/get');
    assert.ok(chat);
    assert.equal(chat.headers['X-VC-Expected-Account-ID'], '9007199254740993');
    assert.equal(chat.headers['X-VC-Expected-Session-ID'], '17');
    assert.equal(chat.headers['X-CSRF-Token'], 'synthetic-token');
    assert.equal(chat.credentials, 'same-origin');
});

test('身份验证失败或缺失时不发聊天请求；F2/身份冲突响应保留结构供界面处理', async () => {
    const client = createDesktopClient({ document: { querySelector() { return { content: '1' }; } }, fetchImpl: async url =>
        new Response(JSON.stringify(url === '/csrf-token' ? { token: 'synthetic' } : url === '/auth/api/session?include=chatStorage'
            ? { accountId: '1', sessionId: '1', chatStorage: { mode: 'ST', authorityEpoch: '1' } } : { code: 'ACCOUNT_CONTEXT_CHANGED' }),
        { status: url === '/csrf-token' || url === '/auth/api/session?include=chatStorage' ? 200 : 409 }) });
    await client.initialize();
    await assert.rejects(client.readChat({ avatar: 'synthetic.png', file: 'synthetic' }), error => error.status === 409 && error.details.code === 'ACCOUNT_CONTEXT_CHANGED');
    const absent = createDesktopClient({ document: { querySelector() { return null; } }, fetchImpl() { assert.fail('无身份不得发请求'); } });
    await assert.rejects(absent.initialize());
});

test('GO recent keeps canonical filenames/aliases while ChatStore uses stable chat identity', async () => {
    const chatId = '1593eac1-7c91-4f03-83ca-be28dca58d01';
    const client = createDesktopClient({ document: { querySelector: () => ({ content: '1' }) }, fetchImpl: async url => {
        if (url === '/csrf-token') return Response.json({ token: 'synthetic' });
        if (url === '/auth/api/session?include=chatStorage') return Response.json({ accountId: '1', sessionId: '1', chatStorage: { mode: 'GO', authorityEpoch: '2' } });
        if (url === '/api/characters/all') return Response.json([{ avatar: 'synthetic.png', data: { extensions: { vc_character_ref: 'card' } } }]);
        return Response.json({ authorityEpoch: '2', nextCursor: null, items: [{ chatId, fileName: 'renamed.jsonl', fileAliases: ['old.jsonl'], characterRef: 'card', chatRevision: '4' }] });
    } });
    await client.initialize();
    const [row] = await client.recent();
    assert.equal(row.file_name, 'renamed.jsonl'); assert.equal(row.file_id, 'renamed'); assert.deepEqual(row.fileAliases, ['old.jsonl']);
    const store = client.createChatStore({ file: 'renamed', chatIdentity: chatId });
    assert.equal(store.chatId, chatId); store.close();
});
