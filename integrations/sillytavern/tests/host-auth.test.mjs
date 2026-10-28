import test from 'node:test';
import assert from 'node:assert/strict';
import { createHostAuth, parseAccountHandles } from '../server-plugin/virtual-companion/lib/host-auth.js';

const active = { nextStep: 'ACTIVE', accountId: '42', sessionId: '7', authenticatorEnabled: true, passwordMustChange: false };
function harness({ identity = active, status = 200, fetchImpl } = {}) {
    const requests = [];
    const gate = createHostAuth({
        config: { goBaseUrl: 'http://go.local', timeoutMs: 1000, accountHandles: { '42': 'owner', '43': 'other' } },
        getUser: async (handle) => ({ handle, enabled: true }), accountVersion: () => 'v1', indexHtml: () => '<html><head></head><body></body></html>',
        fetchImpl: fetchImpl || (async (url, options) => { requests.push({ url, options }); return new Response(JSON.stringify(identity), { status }); }),
    });
    async function call(path = '/', { method = 'GET', session = {}, headers = {}, body } = {}) {
        const req = { path, method, session, headers: { cookie: 'vc_session=synthetic; st_session=not-forwarded', ...headers }, body };
        const res = { statusCode: 200, headers: {}, payload: undefined,
            setHeader(name, value) { this.headers[name] = value; }, appendHeader(name, value) { this.headers[name] = value; },
            status(code) { this.statusCode = code; return this; }, json(value) { this.payload = value; return this; },
            end(value) { this.payload = value; }, redirect(code, url) { this.statusCode = code; this.headers.Location = url; },
        };
        let next = false;
        await gate(req, res, () => { next = true; });
        return { req, res, next };
    }
    return { call, requests };
}

test('所有原生资源由Go会话准入；伪造身份头和旧ST cookie均无效', async () => {
    const h = harness({ status: 401 });
    for (const path of ['/characters/a.png', '/scripts/extensions/third-party/x/index.js', '/version', '/api/chats/get']) {
        const result = await h.call(path, { session: { handle: 'owner', vcAccountId: '42', vcSessionId: '7' }, headers: { 'remote-user': 'owner', 'x-authentik-username': 'owner' } });
        assert.equal(result.res.statusCode, 401); assert.equal(result.next, false);
    }
    assert.equal((await h.call('/')).res.headers.Location, '/auth/');
    for (const { options } of h.requests) assert.equal(options.headers.Cookie, 'vc_session=synthetic');
});

test('完整TOTP/改密与明确handle映射均不可缺少；Go故障不放行', async () => {
    for (const identity of [{ ...active, authenticatorEnabled: false }, { ...active, passwordMustChange: true }, { ...active, accountId: '99' }]) {
        const r = await harness({ identity }).call('/characters/a.png');
        assert.equal(r.res.statusCode, 403); assert.equal(r.next, false);
    }
    const r = await harness({ fetchImpl: async () => { throw new Error('offline'); } }).call('/');
    assert.equal(r.res.statusCode, 503);
});

test('页面绑定捕获身份；换账号/会话后的旧页面写入被拒绝', async () => {
    const h = harness();
    const page = await h.call('/');
    assert.match(page.res.payload, /name="vc-session-id" content="7"/);
    assert.equal(page.req.session.handle, 'owner');
    const headers = { 'x-vc-expected-account-id': '42', 'x-vc-expected-session-id': '7' };
    assert.equal((await h.call('/api/chats/save', { method: 'POST', session: page.req.session, headers })).next, true);
    const changed = harness({ identity: { ...active, accountId: '43', sessionId: '8' } });
    assert.equal((await changed.call('/api/chats/get', { method: 'POST', session: page.req.session, headers })).res.statusCode, 409);
    const fresh = await changed.call('/');
    assert.equal(fresh.req.session.handle, 'other');
    assert.equal((await changed.call('/api/chats/save', { method: 'POST', session: fresh.req.session, headers })).res.statusCode, 409);
});

test('单一登录入口，原生登录恢复禁用；auth代理保留Origin/CSRF/身份与限流', async () => {
    const h = harness();
    assert.equal((await h.call('/login')).res.headers.Location, '/auth/');
    assert.equal((await h.call('/api/users/login', { method: 'POST' })).res.statusCode, 403);
    assert.equal((await h.call('/auth/api/../../admin/providers', { method: 'POST' })).res.statusCode, 404);
    let forwarded;
    const proxy = harness({ fetchImpl: async (url, options) => {
        forwarded = { url, options }; return new Response('{}', { status: 429, headers: { 'Retry-After': '30' } });
    } });
    const r = await proxy.call('/auth/api/login', { method: 'POST', body: { account: 'synthetic', password: 'synthetic' }, headers: { origin: 'http://local', 'x-csrf-token': 'csrf' } });
    assert.equal(forwarded.url, 'http://go.local/api/v1/auth/login');
    assert.equal(forwarded.options.headers.origin, 'http://local');
    assert.equal(forwarded.options.headers['x-csrf-token'], 'csrf');
    assert.equal(r.res.statusCode, 429); assert.equal(r.res.headers['Retry-After'], '30');
});

test('账号映射拒绝路径穿越与不同账号复用同一ST空间', () => {
    assert.deepEqual(parseAccountHandles('{"42":"default-user"}'), { '42': 'default-user' });
    for (const raw of ['[]', '{"42":"../other"}', '{"42":"owner","43":"owner"}']) assert.throws(() => parseAccountHandles(raw));
});
