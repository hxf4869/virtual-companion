import test from 'node:test';
import assert from 'node:assert/strict';
import { createHostAuth } from '../server-plugin/virtual-companion/lib/host-auth.js';
import { LEGACY_CHAT_ROUTES } from '../server-plugin/virtual-companion/lib/legacy-chat-routes.js';

const sessionPath = '/api/v1/auth/session';
const includedPath = sessionPath + '?include=chatStorage';
const identity = {
    accountId: '42', sessionId: '7', nextStep: 'ACTIVE',
    stDataConfigured: true, authenticatorEnabled: true, passwordMustChange: false,
};
const session = { handle: 'owner', vcAccountId: '42', vcSessionId: '7' };
const expectedIdentity = { 'x-vc-expected-account-id': '42', 'x-vc-expected-session-id': '7' };
const authority = (mode) => ({ mode, authorityEpoch: '9007199254740993' });

function harness() {
    const requests = [];
    let state = authority('ST');
    const gate = createHostAuth({
        config: { serviceToken: 'synthetic', goBaseUrl: 'http://go.local', timeoutMs: 1000, accountHandles: { '42': 'owner' } },
        getUser: async (handle) => ({ enabled: true, handle }),
        accountVersion: () => 'v1',
        indexHtml: () => '<html><head></head></html>',
        desktopHtml: () => '<html><head></head></html>',
        async fetchImpl(url, options) {
            const parsed = new URL(url);
            requests.push({ path: parsed.pathname + parsed.search, options });
            if (url.endsWith('/service/st/profile')) return new Response(options.body);
            if (parsed.searchParams.has('include')) {
                if (parsed.searchParams.getAll('include').join(',') !== 'chatStorage') {
                    return Response.json({ code: 'INVALID_REQUEST' }, { status: 400 });
                }
                if (state === 401) return Response.json({ code: 'AUTHENTICATION_REQUIRED' }, { status: 401 });
                if (state === 503) return Response.json({ code: 'SCHEMA_UNAVAILABLE' }, { status: 503 });
                return Response.json({ ...identity, chatStorage: state });
            }
            return Response.json(identity);
        },
    });
    return {
        setState(value) { state = value; },
        async call(url, { method = 'POST', body, contentType, expected = expectedIdentity, bound = session } = {}) {
            requests.length = 0;
            const path = url.split('?')[0];
            const req = {
                path, url, method, session: { ...bound }, body,
                headers: { cookie: 'vc_session=synthetic; st_session=not-forwarded', 'content-type': contentType, ...expected },
            };
            const res = {
                statusCode: 200, headers: {}, body: undefined,
                setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
                status(code) { this.statusCode = code; return this; },
                json(value) { this.body = value; },
                end(value) { this.body = value; },
                redirect(code, location) { this.statusCode = code; this.setHeader('Location', location); },
            };
            const diskCalls = [];
            await gate(req, res, () => diskCalls.push({ operation: 'native chat storage handler', path }));
            return { req, res, diskCalls, requests: [...requests] };
        },
    };
}

function assertSessionRequest(requests, path) {
    const sessionRequests = requests.filter((request) => request.path.startsWith(sessionPath));
    assert.deepEqual(sessionRequests.map((request) => request.path), [path]);
    assert.equal(sessionRequests[0].options.headers.Cookie, 'vc_session=synthetic');
}

test('旧聊天保存每次读取当前权威，切到 FROZEN 时立即拒绝且零下游调用', async () => {
    const h = harness();
    const path = '/api/chats/save';
    const saved = await h.call(path);
    assert.deepEqual(saved.diskCalls, [{ operation: 'native chat storage handler', path }]);
    assertSessionRequest(saved.requests, includedPath);
    h.setState(authority('FROZEN'));
    const frozen = await h.call(path);
    assert.equal(frozen.res.statusCode, 409);
    assert.equal(frozen.res.body.code, 'CHAT_AUTHORITY_CHANGED');
    assert.deepEqual(frozen.diskCalls, []);
    assertSessionRequest(frozen.requests, includedPath);
});

test('清单中的每个旧入口在 GO、FROZEN 和权威不可用时零触盘，ST 保留原入口', async () => {
    const h = harness();
    for (const [method, path] of LEGACY_CHAT_ROUTES) {
        const options = { method };
        if (path === '/api/characters/delete') {
            options.contentType = 'application/x-www-form-urlencoded';
            options.body = { delete_chats: '1' };
        }
        if (path === '/api/characters/import') options.contentType = 'multipart/form-data; boundary=test';
        for (const [state, status, code] of [
            [authority('GO'), 409, 'CHAT_AUTHORITY_CHANGED'],
            [authority('FROZEN'), 409, 'CHAT_AUTHORITY_CHANGED'],
            [503, 503, 'SCHEMA_UNAVAILABLE'],
            [undefined, 503, 'SCHEMA_UNAVAILABLE'],
            [{ mode: 'ST', authorityEpoch: 1 }, 503, 'SCHEMA_UNAVAILABLE'],
            [authority('ST'), 200, undefined],
        ]) {
            h.setState(state);
            const result = await h.call(path, options);
            const label = `${method} ${path}, ${JSON.stringify(state)}`;
            assert.equal(result.res.statusCode, status, label);
            assert.equal(result.res.body?.code, code, label);
            assert.equal(result.diskCalls.length, status === 200 ? 1 : 0, label);
            assert.equal(result.res.headers['cache-control'], 'no-store', label);
            assert.equal(result.res.headers['set-cookie'], undefined, label);
            assert.equal(result.res.headers.location, undefined, label);
            assert.deepEqual(result.req.session, session, label);
            assertSessionRequest(result.requests, includedPath);
        }
    }
});

test('旧路由别名、迟解析的 multipart 删除、异常 hint 均不能绕过守卫', async () => {
    const h = harness();
    h.setState(authority('FROZEN'));
    for (const [method, path, contentType] of [
        ['POST', '/API/CHATS/GROUP/SAVE/'],
        ['POST', '/api/chats//save'],
        ['POST', '/API/CHARACTERS//CHATS/?unused=true'],
        ['HEAD', '/API/DATA-MAID/VIEW/'],
        ['POST', '/api/characters/delete', 'Multipart/Form-Data; boundary=test'],
    ]) {
        const result = await h.call(path, { method, contentType });
        assert.equal(result.res.statusCode, 409, path);
        assert.deepEqual(result.diskCalls, [], path);
        assertSessionRequest(result.requests, includedPath);
    }
    for (const hint of [null, 'ST', authority('OTHER'), { ...authority('ST'), authorityEpoch: '01' },
        { ...authority('ST'), authorityEpoch: '0' }, { ...authority('ST'), authorityEpoch: '1"' }]) {
        h.setState(hint);
        const result = await h.call('/api/chats/get');
        assert.equal(result.res.statusCode, 503);
        assert.deepEqual(result.diskCalls, []);
        assertSessionRequest(result.requests, includedPath);
    }
    const backupAlias = await h.call('/API/USERS//BACKUP/');
    assert.equal(backupAlias.res.statusCode, 403);
    assert.deepEqual(backupAlias.requests, []);
    assert.deepEqual(backupAlias.diskCalls, []);
});

test('权威查询故障隔离于原有资源、模型和显式角色卡投影', async () => {
    const h = harness();
    h.setState(503);
    for (const [path, options] of [
        ['/characters/card.png', { method: 'GET' }],
        ['/api/worldinfo/get', {}],
        ['/api/groups/edit', {}],
        ['/api/characters/delete', { body: { delete_chats: false } }],
        ['/api/characters/all', { body: { vc_resource_only: true } }],
        ['/API/CHARACTERS//GET/', { body: { vc_resource_only: true } }],
        ['/api/backends/chat-completions/generate', {}],
        ['/api/plugins/virtual-companion/go/api/v1/admin/model-purposes', { method: 'GET' }],
    ]) {
        const result = await h.call(path, options);
        assert.equal(result.diskCalls.length, 1, path);
        assertSessionRequest(result.requests, sessionPath);
    }
    const oldCardList = await h.call('/api/characters/all', { body: { vc_resource_only: 'true' } });
    assert.equal(oldCardList.res.statusCode, 503);
    assert.deepEqual(oldCardList.diskCalls, []);
    assertSessionRequest(oldCardList.requests, includedPath);
});

test('页面注入核验过的身份及权威，503 保留身份且不重定向', async () => {
    const h = harness();
    for (const path of ['/', '/desktop/', '/native/']) {
        h.setState(authority('FROZEN'));
        const page = await h.call(path, { method: 'GET', bound: {} });
        assert.equal(page.res.statusCode, 200);
        assert.match(page.res.body, /name="vc-account-id" content="42"/);
        assert.match(page.res.body, /name="vc-session-id" content="7"/);
        assert.match(page.res.body, /name="vc-chat-mode" content="FROZEN"/);
        assert.match(page.res.body, /name="vc-chat-authority-epoch" content="9007199254740993"/);
        assert.equal(page.req.session.vcAccountId, '42');
        assertSessionRequest(page.requests, includedPath);

        h.setState(503);
        const unavailable = await h.call(path, { method: 'GET' });
        assert.equal(unavailable.res.statusCode, 503);
        assert.equal(unavailable.res.body.code, 'SCHEMA_UNAVAILABLE');
        assert.equal(unavailable.res.headers.location, undefined);
        assert.equal(unavailable.res.headers['set-cookie'], undefined);
        assert.deepEqual(unavailable.req.session, session);
        assert.equal(unavailable.requests.length, 1);
        assertSessionRequest(unavailable.requests, includedPath);
    }
    h.setState(401);
    const expired = await h.call('/api/chats/save');
    assert.equal(expired.res.statusCode, 401);
    assert.deepEqual(expired.diskCalls, []);
    assertSessionRequest(expired.requests, includedPath);
    h.setState(authority('ST'));
    const stalePage = await h.call('/api/chats/save', { expected: { ...expectedIdentity, 'x-vc-expected-session-id': '8' } });
    assert.equal(stalePage.res.body.code, 'ACCOUNT_CONTEXT_CHANGED');
    assert.deepEqual(stalePage.diskCalls, []);
    assertSessionRequest(stalePage.requests, includedPath);
});

test('Session 发现代理原样透传查询和响应，每次只有一次会话调用', async () => {
    const h = harness();
    const path = '/auth/api/session';
    for (const [suffix, status] of [['', 200], ['?include=chatStorage', 200], ['?include=chatStorage&include=chatStorage', 400]]) {
        const result = await h.call(path + suffix, { method: 'GET' });
        assert.equal(result.res.statusCode, status);
        assertSessionRequest(result.requests, sessionPath + suffix);
        if (status === 200) assert.deepEqual(JSON.parse(result.res.body).chatStorage, suffix ? authority('ST') : undefined);
    }
    h.setState(503);
    const included = await h.call(path + '?include=chatStorage', { method: 'GET' });
    assert.equal(included.res.statusCode, 503);
    assert.equal(JSON.parse(included.res.body).code, 'SCHEMA_UNAVAILABLE');
    assertSessionRequest(included.requests, includedPath);
    assert.equal((await h.call(path, { method: 'GET' })).res.statusCode, 200);
});
