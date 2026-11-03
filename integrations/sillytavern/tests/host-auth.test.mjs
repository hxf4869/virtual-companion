import test from 'node:test';
import assert from 'node:assert/strict';
import { createHostAuth, parseAccountHandles } from '../server-plugin/virtual-companion/lib/host-auth.js';

const active = { stDataConfigured: true, nextStep: 'ACTIVE', accountId: '42', sessionId: '7', authenticatorEnabled: true, passwordMustChange: false };
function harness({ identity = active, status = 200, fetchImpl } = {}) {
    const requests = [];
    const gate = createHostAuth({
        config: { serviceToken: 'synthetic-service-token-0123456789', goBaseUrl: 'http://go.local', timeoutMs: 1000, accountHandles: { '42': 'owner', '43': 'other' } },
        getUser: async (handle) => ({ handle, enabled: true }), accountVersion: () => 'v1', indexHtml: () => '<html><head></head><body><div id="preloader"></div><a href="#bg_global_tab">global</a><a href="#bg_chat_tab">chat</a></body></html>',
        fetchImpl: fetchImpl || (async (url, options) => { requests.push({ url, options }); if(url.endsWith('/service/st/profile')) return new Response(options.body, { status:200 }); return new Response(JSON.stringify(identity), { status }); }),
    });
    async function call(path = '/', { method = 'GET', session = {}, headers = {}, body, requestUrl = path } = {}) {
        const req = { path, url: requestUrl, method, session, headers: { cookie: 'vc_session=synthetic; st_session=not-forwarded', ...headers }, body };
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

test('根入口与桌面别名绑定同一身份并返回同一自有HTML；明确原生入口保留', async () => {
    const h = harness();
    const desktop = await h.call('/desktop/');
    assert.equal(desktop.res.statusCode, 200);
    assert.equal(desktop.next, false);
    assert.equal(desktop.req.session.vcAccountId, '42');
    assert.equal(desktop.req.session.vcSessionId, '7');
    assert.match(desktop.res.payload, /name="vc-account-id" content="42"/);
    assert.match(desktop.res.payload, /desktop\/standalone\/app.js/);
    assert.doesNotMatch(desktop.res.payload, /<iframe|src=["']\/?script\.js|id="preloader"/);
    assert.equal((await harness({ status: 401 }).call('/desktop/')).res.headers.Location, '/auth/');
    assert.equal((await harness({ identity: { ...active, nextStep: 'TOTP_REQUIRED' } }).call('/desktop/')).res.headers.Location, '/auth/');
    assert.equal((await harness({ identity: { ...active, deletionPending: true } }).call('/desktop/')).res.statusCode, 409);
    assert.equal((await h.call('/desktop')).res.headers.Location, '/desktop/');
    const root = await h.call('/');
    assert.equal(root.res.statusCode, 200);
    assert.equal(root.next, false);
    assert.equal(root.res.payload, desktop.res.payload);
    assert.match((await h.call('/native/')).res.payload, /id="preloader"/);
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
    assert.match(page.res.payload, /role="status">正在打开聊天…/);
    assert.match(page.res.payload, /data-vc-standalone/);
    assert.doesNotMatch(page.res.payload, /id="preloader"/);
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

test('没有Go数据通道时拒绝原生空间，首次入口必须登记实际私有profile', async()=>{
    const missing=await harness({identity:{...active,stDataConfigured:false}}).call('/');
    assert.equal(missing.res.statusCode,503);assert.equal(missing.next,false);
    const h=harness();await h.call('/');
    const registration=h.requests.find((r)=>r.url.endsWith('/service/st/profile'));
    assert.ok(registration);assert.deepEqual(JSON.parse(registration.options.body),{ownerAccountId:'42',handle:'owner'});
    assert.match(registration.options.headers.Authorization,/^Bearer /);assert.equal(registration.options.headers.Origin,undefined);
});


test('明确原生入口 /native/：共用准入与页面身份，base 保持原生资源位于根路径', async () => {
    const h = harness();
    for (const alias of ['/native', '/native/index.html']) {
        const r = await h.call(alias);
        assert.equal(r.res.statusCode, 303);
        assert.equal(r.res.headers.Location, '/native/');
    }
    assert.equal((await h.call('/index.html')).res.headers.Location, '/');
    const page = await h.call('/native/');
    assert.equal(page.res.statusCode, 200);
    assert.equal(page.next, false);
    assert.equal(page.req.session.handle, 'owner');
    assert.equal(page.req.session.vcAccountId, '42');
    assert.equal(page.req.session.vcSessionId, '7');
    assert.match(page.res.payload, /<head><base href="\/">/);
    assert.match(page.res.payload, /name="vc-account-id" content="42"/);
    assert.match(page.res.payload, /name="vc-session-id" content="7"/);
    assert.match(page.res.payload, /id="preloader"/);
    assert.match(page.res.payload, /href="\/native\/">重新加载/);
    assert.match(page.res.payload, /href="\/native\/#bg_global_tab"/);
    assert.match(page.res.payload, /href="\/native\/#bg_chat_tab"/);
    const query = await h.call('/native/', { requestUrl: '/native/?panel=x&name=%22' });
    assert.match(query.res.payload, /href="\/native\/\?panel=x&amp;name=%22#bg_global_tab"/);
    assert.equal(page.res.headers['Cache-Control'], 'no-store');
    assert.equal(page.res.headers.Vary, 'Cookie');
    assert.ok(h.requests.some((r) => r.url.endsWith('/service/st/profile')));
    assert.doesNotMatch((await h.call('/')).res.payload, /<base/);
    assert.equal((await harness({ status: 401 }).call('/native/')).res.headers.Location, '/auth/');
    assert.equal((await harness({ identity: { ...active, nextStep: 'TOTP_REQUIRED' } }).call('/native/')).res.headers.Location, '/auth/');
    assert.equal((await harness({ identity: { ...active, deletionPending: true } }).call('/native/')).res.statusCode, 409);
    assert.equal((await harness({ identity: { ...active, stDataConfigured: false } }).call('/native/')).res.statusCode, 503);
    const headers = { 'x-vc-expected-account-id': '42', 'x-vc-expected-session-id': '7' };
    assert.equal((await h.call('/api/chats/save', { method: 'POST', session: page.req.session, headers })).next, true);
    const changed = harness({ identity: { ...active, accountId: '43', sessionId: '8' } });
    assert.equal((await changed.call('/api/chats/save', { method: 'POST', session: page.req.session, headers })).res.statusCode, 409);
    const fresh = await changed.call('/native/');
    assert.equal(fresh.req.session.handle, 'other');
    assert.equal((await changed.call('/api/chats/save', { method: 'POST', session: fresh.req.session, headers })).res.statusCode, 409);
});


test('手机界面 /m/：未登录跳登录页；入口绑定会话；只读产物目录；入口不缓存', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-m-'));
    try {
        fs.writeFileSync(path.join(dir, 'index.html'), '<html>m</html>');
        fs.mkdirSync(path.join(dir, 'assets'));
        fs.writeFileSync(path.join(dir, 'assets', 'a-1.js'), 'x');
        fs.writeFileSync(path.join(path.dirname(dir), 'vc-m-secret.txt'), 's');
        // 直接构造一个指向临时产物目录的网关。
        const { createHostAuth: create } = await import('../server-plugin/virtual-companion/lib/host-auth.js');
        const gateFor = (identity, status = 200) => create({
            config: { serviceToken: 'synthetic-service-token-0123456789', goBaseUrl: 'http://go.local', timeoutMs: 1000, accountHandles: { '42': 'owner' } },
            getUser: async (handle) => ({ handle, enabled: true }), accountVersion: () => 'v1', indexHtml: () => '<html><head></head><body></body></html>',
            fetchImpl: async (url, options) => url.endsWith('/service/st/profile') ? new Response(options.body, { status: 200 }) : new Response(JSON.stringify(identity), { status }),
            mobileDir: dir,
        });
        const run = async (gate, p, session = {}, method = 'GET') => {
            const req = { path: p, method, session, headers: { cookie: 'vc_session=synthetic' } };
            const res = { statusCode: 200, headers: {}, payload: undefined, setHeader(n, v) { this.headers[n] = v; }, appendHeader(n, v) { this.headers[n] = v; },
                status(c) { this.statusCode = c; return this; }, json(v) { this.payload = v; return this; }, end(v) { this.payload = v; }, redirect(c, u) { this.statusCode = c; this.headers.Location = u; } };
            let next = false; await gate(req, res, () => { next = true; }); return { req, res, next };
        };
        assert.equal((await run(gateFor(active, 401), '/m/')).res.headers.Location, '/auth/');
        assert.equal((await run(gateFor(active), '/m')).res.headers.Location, '/m/');
        const gate = gateFor(active);
        const entry = await run(gate, '/m/');
        assert.equal(String(entry.res.payload), '<html>m</html>');
        assert.equal(entry.res.headers['Cache-Control'], 'no-store');
        assert.equal(entry.req.session.vcSessionId, '7');
        assert.equal(entry.next, false);
        assert.equal(entry.res.headers['Content-Type'], 'text/html; charset=utf-8');
        assert.doesNotMatch(String(entry.res.payload), /desktop|vc-account-id|preloader/);
        assert.equal((await run(gateFor({ ...active, nextStep: 'TOTP_REQUIRED' }), '/m/')).res.headers.Location, '/auth/');
        const asset = await run(gate, '/m/assets/a-1.js', entry.req.session);
        assert.match(asset.res.headers['Cache-Control'], /immutable/);
        assert.equal(asset.res.headers['Content-Type'], 'text/javascript; charset=utf-8');
        assert.equal(asset.res.headers['X-Content-Type-Options'], 'nosniff');
        const head = await run(gate, '/m/assets/a-1.js', entry.req.session, 'HEAD');
        assert.equal(head.res.statusCode, 200);
        assert.equal(head.res.payload, undefined);
        assert.equal(head.res.headers['Content-Type'], asset.res.headers['Content-Type']);
        assert.equal((await run(gateFor(active, 401), '/m/assets/a-1.js', entry.req.session)).res.statusCode, 401);
        for (const bad of ['/m/../vc-m-secret.txt', '/m/%2e%2e/vc-m-secret.txt', '/m/assets//a-1.js', '/m/assets', '/m/missing.js', '/m/%ZZ', '/m/%5csecret', '/m/%00secret']) {
            const r = await run(gate, bad, entry.req.session);
            assert.equal(r.res.statusCode, bad === '/m/%ZZ' ? 400 : 404, bad); assert.equal(r.next, false);
        }
        // 其他路径首个请求仍不能绑定会话。
        assert.equal((await run(gate, '/m/assets/a-1.js')).res.statusCode, 409);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
        fs.rmSync(path.join(path.dirname(dir), 'vc-m-secret.txt'), { force: true });
    }
});
