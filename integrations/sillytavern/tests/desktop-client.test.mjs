import test from 'node:test';
import assert from 'node:assert/strict';
import { createDesktopClient } from '../extension/vc-model-settings/desktop/standalone/client.js';

test('独立客户端的每次ST请求绑定HTML初始身份；换页身份后旧实例不能自动冒用', async () => {
    let account = '9007199254740993', session = '17';
    const calls = [];
    const client = createDesktopClient({ document: { querySelector(selector) { return { content: selector.includes('account-id') ? account : session }; } },
        fetchImpl: async (url, options) => {
            calls.push({ url, ...options });
            return new Response(JSON.stringify(url === '/csrf-token' ? { token: 'synthetic-token' } : []), { status: 200 });
        } });
    await client.initialize();
    account = '52'; session = '18';
    await client.readChat({ avatar: 'synthetic.png', file: 'synthetic' });
    assert.equal(calls[1].headers['X-VC-Expected-Account-ID'], '9007199254740993');
    assert.equal(calls[1].headers['X-VC-Expected-Session-ID'], '17');
    assert.equal(calls[1].headers['X-CSRF-Token'], 'synthetic-token');
    assert.equal(calls[1].credentials, 'same-origin');
});

test('身份验证失败或缺失时不发聊天请求；F2/身份冲突响应保留结构供界面处理', async () => {
    const client = createDesktopClient({ document: { querySelector() { return { content: '1' }; } }, fetchImpl: async url =>
        new Response(JSON.stringify(url === '/csrf-token' ? { token: 'synthetic' } : { code: 'ACCOUNT_CONTEXT_CHANGED' }), { status: url === '/csrf-token' ? 200 : 409 }) });
    await client.initialize();
    await assert.rejects(client.readChat({ avatar: 'synthetic.png', file: 'synthetic' }), error => error.status === 409 && error.details.code === 'ACCOUNT_CONTEXT_CHANGED');
    const absent = createDesktopClient({ document: { querySelector() { return null; } }, fetchImpl() { assert.fail('无身份不得发请求'); } });
    await assert.rejects(absent.initialize());
});
