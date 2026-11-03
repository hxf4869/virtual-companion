// 引擎适配层的纯逻辑：服务端读取的身份头与重置、消息映射、事件、等待、弹窗摘要。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, toMessage, stripJsonl, ServerError } from '../src/engine/server.mjs';
import { createEngine, createEmitter, until, popupSummary, needsUser } from '../src/engine/engine.mjs';

function fakeFetch(routes) {
    const calls = [];
    const impl = async (path, init = {}) => {
        calls.push({ path, init });
        const r = routes[path];
        const out = typeof r === 'function' ? r(init, calls) : r;
        return { ok: out.status === undefined || out.status < 400, status: out.status ?? 200, json: async () => out.body };
    };
    return { impl, calls };
}

test('写请求带 Go 会话身份头与 CSRF，且只取一次身份', async () => {
    const f = fakeFetch({
        '/auth/api/session': { body: { accountId: 42, sessionId: '7' } },
        '/csrf-token': { body: { token: 'csrf-1' } },
        '/api/chats/get': { body: [{ chat_metadata: { a: 1 } }, { is_user: true, mes: '你好', name: 'u' }, { mes: '嗨', swipes: ['嗨', '哈'], swipe_id: 1, name: 'c' }] },
    });
    const s = createServer({ fetchImpl: f.impl });
    const chat = await s.chat('a.png', 'f.jsonl', 'A');
    assert.deepEqual(chat.meta, { a: 1 });
    assert.equal(chat.messages.length, 2);
    assert.deepEqual(chat.messages[1], { id: 1, user: false, system: false, name: 'c', text: '嗨', time: '', swipes: 2, swipe: 1 });
    const post = f.calls.find((c) => c.path === '/api/chats/get');
    assert.equal(post.init.headers['x-vc-expected-account-id'], '42');
    assert.equal(post.init.headers['x-vc-expected-session-id'], '7');
    assert.equal(post.init.headers['X-CSRF-Token'], 'csrf-1');
    assert.equal(JSON.parse(post.init.body).file_name, 'f');
    await s.chat('a.png', 'f', 'A');
    assert.equal(f.calls.filter((c) => c.path === '/auth/api/session').length, 1);
});

test('409 / 401 后保留页面身份；错误带状态码', async () => {
    let n = 0;
    const f = fakeFetch({
        '/auth/api/session': { body: { accountId: '42', sessionId: '7' } },
        '/csrf-token': { body: { token: 't' } },
        '/api/chats/recent': () => (++n === 1 ? { status: 409, body: {} } : { body: [{ avatar: 'a.png', file_name: 'x.jsonl', mes: '最后一句', last_mes: 5, chat_items: 3 }, { file_name: 'root.jsonl' }] }),
    });
    const s = createServer({ fetchImpl: f.impl });
    await assert.rejects(s.recentChats(), (e) => e instanceof ServerError && e.status === 409);
    const rows = await s.recentChats();
    assert.deepEqual(rows, [{ avatar: 'a.png', file: 'x', preview: '最后一句', updated: 5, items: 3, binding: null }]);
    assert.equal(f.calls.filter((c) => c.path === '/auth/api/session').length, 1);
});

test('列表与角色并行加载共享首次身份快照，迟到身份不能覆盖原页面', async () => {
    let sessions = 0; const identities = [];
    const server = createServer({ fetchImpl: async (path, init = {}) => {
        if (path === '/auth/api/session') return Response.json({ accountId: ++sessions === 1 ? 'A' : 'B', sessionId: 'session' });
        if (path === '/csrf-token') return Response.json({ token: 'csrf' });
        identities.push(init.headers['x-vc-expected-account-id']);
        return Response.json([]);
    } });
    await Promise.all([server.recentChats(), server.characters()]);
    assert.deepEqual(identities, ['A', 'A']);
    assert.equal(sessions, 1);
});

test('消息映射与文件名', () => {
    assert.equal(stripJsonl('a.jsonl'), 'a');
    assert.equal(toMessage({}, 3).swipes, 1);
    assert.equal(toMessage({ is_system: true }, 0).system, true);
});

test('事件：退订生效，监听者异常不影响其他监听者', () => {
    const bus = createEmitter();
    const got = [];
    const off = bus.on('x', (v) => got.push(`a${v}`));
    bus.on('x', () => { throw new Error('bad'); });
    bus.on('x', (v) => got.push(`c${v}`));
    bus.emit('x', 1); off(); bus.emit('x', 2);
    assert.deepEqual(got, ['a1', 'c1', 'c2']);
});

test('等待：取值成功返回，超时报错', async () => {
    let i = 0;
    assert.equal(await until(() => (++i > 2 ? 'ok' : null), { interval: 1 }), 'ok');
    await assert.rejects(until(() => null, { timeout: 20, interval: 5, label: 'x' }), /engine timeout: x/);
});

test('弹窗摘要', () => {
    const dialog = { textContent: '  This character has an\\n embedded World  ', querySelector: (s) => (s === '.onboarding' ? null : null) };
    assert.deepEqual(popupSummary(dialog), { onboarding: false, text: 'This character has an\\n embedded World' });
});

test('只有带操作控件的弹窗需要用户处理', () => {
    const shown = { getClientRects: () => [1] };
    const hidden = { getClientRects: () => [] };
    assert.equal(needsUser({ querySelectorAll: () => [hidden, shown] }), true);
    assert.equal(needsUser({ querySelectorAll: () => [hidden] }), false, '加载提示的隐藏按钮不算');
    assert.equal(needsUser({ querySelectorAll: () => [] }), false);
});


test('引擎默认从明确原生入口启动，保持手机外壳与原生页面分离', async () => {
    const script = { settingsReady: true };
    const frame = { setAttribute() {}, contentWindow: {
        SillyTavern: { getContext: () => ({ eventTypes: {}, eventSource: { on() {} } }) },
        eval: async () => script,
        document: { querySelector: () => null, addEventListener() {} },
    } };
    const doc = { documentElement: { dataset: {} }, createElement: () => frame, body: { appendChild() {} } };
    const engine = createEngine({ doc });
    await engine.start();
    assert.equal(engine.frame.src, '/native/');
    assert.equal(engine.state, 'ready');
    assert.equal(doc.documentElement.dataset.vcEngine, 'ready');
});
