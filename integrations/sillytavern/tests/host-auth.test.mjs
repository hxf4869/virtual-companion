import test from 'node:test';
import assert from 'node:assert/strict';
import { createHostAuth, isMobileRoutePath, parseAccountHandles } from '../server-plugin/virtual-companion/lib/host-auth.js';

const active = { stDataConfigured: true, nextStep: 'ACTIVE', accountId: '42', sessionId: '7', authenticatorEnabled: true, passwordMustChange: false };
function sessionResponse(url, identity, status) {
    const body = status === 200 && url.endsWith('/auth/session?include=chatStorage')
        ? { ...identity, chatStorage: { mode: 'ST', authorityEpoch: '1' } } : identity;
    return Response.json(body, { status });
}
function harness({ identity = active, status = 200, fetchImpl } = {}) {
    const requests = [];
    const gate = createHostAuth({
        config: { serviceToken: 'synthetic-service-token-0123456789', goBaseUrl: 'http://go.local', timeoutMs: 1000, accountHandles: { '42': 'owner', '43': 'other' } },
        getUser: async (handle) => ({ handle, enabled: true }), accountVersion: () => 'v1', indexHtml: () => '<html><head></head><body><div id="preloader"></div><a href="#bg_global_tab">global</a><a href="#bg_chat_tab">chat</a></body></html>',
        fetchImpl: fetchImpl || (async (url, options) => { requests.push({ url, options }); if(url.endsWith('/service/st/profile')) return new Response(options.body, { status:200 }); return sessionResponse(url, identity, status); }),
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
    assert.match(desktop.res.payload, /\/desktop\/assets\/index-[A-Za-z0-9_-]+\.js/);
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


test('手机界面 /m/：未登录跳登录页；入口绑定会话并注入meta；子路由刷新真实匹配；只读产物目录；缺产物503', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-m-'));
    try {
        fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><head><title>VC Mobile</title></head><body><div id="root"></div></body></html>');
        fs.mkdirSync(path.join(dir, 'assets'));
        fs.writeFileSync(path.join(dir, 'assets', 'a-1.js'), 'x');
        fs.writeFileSync(path.join(path.dirname(dir), 'vc-m-secret.txt'), 's');
        // 直接构造一个指向临时产物目录的网关。
        const { createHostAuth: create } = await import('../server-plugin/virtual-companion/lib/host-auth.js');
        const gateFor = (identity, status = 200, customMobileDir = dir) => create({
            config: { serviceToken: 'synthetic-service-token-0123456789', goBaseUrl: 'http://go.local', timeoutMs: 1000, accountHandles: { '42': 'owner' } },
            getUser: async (handle) => ({ handle, enabled: true }), accountVersion: () => 'v1', indexHtml: () => '<html><head></head><body><div id="preloader"></div>native</body></html>',
            desktopHtml: () => '<!doctype html><html><head><title>VC Desktop</title></head><body>desktop</body></html>',
        fetchImpl: async (url, options) => url.endsWith('/service/st/profile') ? new Response(options.body, { status: 200 }) : sessionResponse(url, identity, status),
            mobileDir: customMobileDir,
        });
        const run = async (gate, p, session = {}, method = 'GET') => {
            const [pathname] = p.split('?');
            const req = { path: pathname, url: p, originalUrl: p, method, session, headers: { cookie: 'vc_session=synthetic' } };
            const res = { statusCode: 200, headers: {}, payload: undefined, setHeader(n, v) { this.headers[n] = v; }, appendHeader(n, v) { this.headers[n] = v; },
                status(c) { this.statusCode = c; return this; }, json(v) { this.payload = v; return this; }, end(v) { this.payload = v; }, redirect(c, u) { this.statusCode = c; this.headers.Location = u; } };
            let next = false; await gate(req, res, () => { next = true; }); return { req, res, next };
        };
        assert.equal(isMobileRoutePath('/m/chat/%5B%22alice.png%22%2C%22chat-1%22%5D/card'), true);
        assert.equal(isMobileRoutePath('/m/chat/%5B%22alice.png%22%2C%22chat-1%22%5D/card?message=msg-42'), true);
        assert.equal(isMobileRoutePath('/m/cards/x'), false);

        assert.equal((await run(gateFor(active, 401), '/m/')).res.headers.Location, '/auth/');
        assert.equal((await run(gateFor(active, 401), '/m/chat/%5B%22alice.png%22%2C%22chat-1%22%5D')).res.headers.Location, '/auth/');
        assert.equal((await run(gateFor(active, 401), '/m/chat/%5B%22alice.png%22%2C%22chat-1%22%5D/card')).res.headers.Location, '/auth/');
        assert.equal((await run(gateFor(active, 401), '/m/chat/%5B%22alice.png%22%2C%22chat-1%22%5D/card?message=msg-42')).res.headers.Location, '/auth/');
        assert.equal((await run(gateFor(active, 401), '/m/cards/x')).res.statusCode, 401);
        assert.equal((await run(gateFor(active), '/m')).res.headers.Location, '/m/');

        // 缺少构建产物时返回 503
        const missingDir = path.join(dir, 'unbuilt-mobile-app');
        const unbuiltRes = await run(gateFor(active, 200, missingDir), '/m/');
        assert.equal(unbuiltRes.res.statusCode, 503);
        assert.equal(unbuiltRes.res.payload?.code, 'VC_MOBILE_UNAVAILABLE');
        const unbuiltSubRes = await run(gateFor(active, 200, missingDir), '/m/chat');
        assert.equal(unbuiltSubRes.res.statusCode, 503);
        assert.equal(unbuiltSubRes.res.payload?.code, 'VC_MOBILE_UNAVAILABLE');

        const gate = gateFor(active);
        const entry = await run(gate, '/m/');
        assert.equal(entry.res.statusCode, 200);
        assert.match(String(entry.res.payload), /VC Mobile/);
        assert.match(String(entry.res.payload), /<meta name="vc-account-id" content="42"><meta name="vc-session-id" content="7">/);
        assert.match(String(entry.res.payload), /<meta name="vc-chat-mode" content="ST"><meta name="vc-chat-authority-epoch" content="1">/);
        assert.equal(entry.res.headers['Cache-Control'], 'no-store');
        assert.equal(entry.res.headers['Vary'], 'Cookie');
        assert.equal(entry.res.headers['X-Content-Type-Options'], 'nosniff');
        assert.equal(entry.req.session.vcAccountId, '42');
        assert.equal(entry.req.session.vcSessionId, '7');
        assert.equal(entry.next, false);
        assert.equal(entry.res.headers['Content-Type'], 'text/html; charset=utf-8');
        assert.doesNotMatch(String(entry.res.payload), /desktop|preloader/);

        // 真实子路由刷新返回注入身份 meta 的 HTML 并允许绑定会话
        for (const subroute of [
            '/m/chat',
            '/m/chat/%5B%22alice.png%22%2C%22chat-1%22%5D',
            '/m/chat/%5B%22alice.png%22%2C%22chat-1%22%5D/card',
            '/m/chat/%5B%22alice.png%22%2C%22chat-1%22%5D/card?message=msg-42',
            '/m/characters',
            '/m/characters/alice.png',
            '/m/memory',
            '/m/inbox',
            '/m/story/12',
            '/m/settings',
            '/m/settings/account',
            '/m/settings/tavern/rm_api_block',
        ]) {
            const sub = await run(gate, subroute, {});
            assert.equal(sub.res.statusCode, 200, subroute);
            assert.equal(sub.res.headers['Content-Type'], 'text/html; charset=utf-8', subroute);
            assert.equal(sub.res.headers['Cache-Control'], 'no-store', subroute);
            assert.match(String(sub.res.payload), /<meta name="vc-account-id" content="42"><meta name="vc-session-id" content="7">/, subroute);
            assert.equal(sub.req.session.vcAccountId, '42', subroute);
            assert.equal(sub.req.session.vcSessionId, '7', subroute);
        }

        // / 与 /desktop/、/native/ 不受影响，/ 不会自动跳 /m/
        const rootEntry = await run(gate, '/');
        assert.equal(rootEntry.res.statusCode, 200);
        assert.match(String(rootEntry.res.payload), /VC Desktop/);
        assert.doesNotMatch(String(rootEntry.res.payload), /VC Mobile/);

        assert.equal((await run(gateFor({ ...active, nextStep: 'TOTP_REQUIRED' }), '/m/')).res.headers.Location, '/auth/');
        assert.equal((await run(gateFor({ ...active, nextStep: 'TOTP_REQUIRED' }), '/m/settings/account')).res.headers.Location, '/auth/');
        const asset = await run(gate, '/m/assets/a-1.js', entry.req.session);
        assert.match(asset.res.headers['Cache-Control'], /immutable/);
        assert.equal(asset.res.headers['Content-Type'], 'text/javascript; charset=utf-8');
        assert.equal(asset.res.headers['X-Content-Type-Options'], 'nosniff');
        const head = await run(gate, '/m/assets/a-1.js', entry.req.session, 'HEAD');
        assert.equal(head.res.statusCode, 200);
        assert.equal(head.res.payload, undefined);
        assert.equal(head.res.headers['Content-Type'], asset.res.headers['Content-Type']);
        assert.equal((await run(gateFor(active, 401), '/m/assets/a-1.js', entry.req.session)).res.statusCode, 401);
        for (const bad of [
            '/m/../vc-m-secret.txt',
            '/m/%2e%2e/vc-m-secret.txt',
            '/m/chat/..',
            '/m/chat/%2e%2e',
            '/m/chat/a%2fb',
            '/m/assets//a-1.js',
            '/m/assets',
            '/m/missing.js',
            '/m/cards/x',
            '/m/unknown-route',
            '/m/%ZZ',
            '/m/%5csecret',
            '/m/%00secret',
        ]) {
            const r = await run(gate, bad, entry.req.session);
            assert.equal(r.res.statusCode, bad === '/m/%ZZ' ? 400 : 404, bad); assert.equal(r.next, false);
        }
        // 其他非页面入口路径首个请求仍不能绑定会话。
        assert.equal((await run(gate, '/m/assets/a-1.js')).res.statusCode, 409);
        assert.equal((await run(gate, '/m/cards/x')).res.statusCode, 409);
        assert.equal((await run(gate, '/m/unknown-route')).res.statusCode, 409);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
        fs.rmSync(path.join(path.dirname(dir), 'vc-m-secret.txt'), { force: true });
    }
});

test('serves built desktop app shell with identity meta', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-desktop-app-'));
    try {
        fs.writeFileSync(
            path.join(dir, 'index.html'),
            '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body class="vc-ui" data-vc-standalone=""><div id="root"><p id="vc-desktop-startup" role="status">正在打开聊天…</p></div><script type="module" src="/desktop/assets/app-abc.js"></script></body></html>',
        );
        fs.mkdirSync(path.join(dir, 'assets'));
        fs.writeFileSync(path.join(dir, 'assets', 'app-abc.js'), 'console.log("app");');
        const identity = { ...active, accountId: '1', sessionId: '7' };
        const gate = createHostAuth({
            config: { serviceToken: 'synthetic-service-token-0123456789', goBaseUrl: 'http://go.local', timeoutMs: 1000, accountHandles: { '1': 'owner' } },
            getUser: async (handle) => ({ handle, enabled: true }),
            accountVersion: () => 'v1',
            indexHtml: () => '<html><head></head><body></body></html>',
            fetchImpl: async (url, options) => url.endsWith('/service/st/profile') ? new Response(options.body, { status: 200 }) : sessionResponse(url, identity, 200),
            desktopAppDir: dir,
        });
        const call = async (p, session = {}) => {
            const req = { path: p, url: p, method: 'GET', session, headers: { cookie: 'vc_session=synthetic' } };
            const res = {
                statusCode: 200, headers: {}, payload: undefined,
                setHeader(n, v) { this.headers[n] = v; this.headers[n.toLowerCase()] = v; },
                appendHeader(n, v) { this.headers[n] = v; this.headers[n.toLowerCase()] = v; },
                status(c) { this.statusCode = c; return this; },
                json(v) { this.payload = v; return this; },
                end(v) { this.payload = v; },
                redirect(c, u) { this.statusCode = c; this.headers.Location = u; },
            };
            let next = false;
            await gate(req, res, () => { next = true; });
            return { req, res, next };
        };
        const { res } = await call('/desktop/');
        const body = String(res.payload);
        assert.equal(res.statusCode, 200);
        assert.match(body, /<meta name="vc-account-id" content="1">/);
        assert.match(body, /<meta name="vc-session-id" content="7">/);
        assert.match(body, /<script type="module" src="\/desktop\/assets\/app-abc\.js">/);
        const root = await call('/');
        assert.equal(root.res.statusCode, 200);
        assert.equal(String(root.res.payload), body);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('serves hashed desktop assets immutable and rejects traversal', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-desktop-assets-'));
    try {
        fs.writeFileSync(path.join(dir, 'index.html'), '<html><head></head><body></body></html>');
        fs.mkdirSync(path.join(dir, 'assets'));
        fs.writeFileSync(path.join(dir, 'assets', 'app-abc.js'), 'console.log("app");');
        fs.writeFileSync(path.join(dir, 'assets', 'app-abc.css'), 'body{}');
        const identity = { ...active, accountId: '1', sessionId: '7' };
        const gateFor = (status = 200) => createHostAuth({
            config: { serviceToken: 'synthetic-service-token-0123456789', goBaseUrl: 'http://go.local', timeoutMs: 1000, accountHandles: { '1': 'owner' } },
            getUser: async (handle) => ({ handle, enabled: true }),
            accountVersion: () => 'v1',
            indexHtml: () => '<html><head></head><body></body></html>',
            fetchImpl: async (url, options) => url.endsWith('/service/st/profile') ? new Response(options.body, { status: 200 }) : sessionResponse(url, identity, status),
            desktopAppDir: dir,
        });
        const gate = gateFor(200);
        const call = async (g, p, session = {}, method = 'GET') => {
            const req = { path: p, url: p, method, session, headers: { cookie: 'vc_session=synthetic' } };
            const res = {
                statusCode: 200, headers: {}, payload: undefined,
                setHeader(n, v) { this.headers[n] = v; this.headers[n.toLowerCase()] = v; },
                appendHeader(n, v) { this.headers[n] = v; this.headers[n.toLowerCase()] = v; },
                status(c) { this.statusCode = c; return this; },
                json(v) { this.payload = v; return this; },
                end(v) { this.payload = v; },
                redirect(c, u) { this.statusCode = c; this.headers.Location = u; },
            };
            let next = false;
            await g(req, res, () => { next = true; });
            return { req, res, next };
        };
        const entry = await call(gate, '/desktop/');
        const session = entry.req.session;
        const { res: assetRes, next: assetNext } = await call(gate, '/desktop/assets/app-abc.js', session);
        assert.equal(assetRes.statusCode, 200);
        assert.equal(assetNext, false);
        assert.equal(assetRes.headers['cache-control'], 'private, max-age=31536000, immutable');
        assert.equal(assetRes.headers['x-content-type-options'], 'nosniff');
        assert.equal(assetRes.headers['content-type'], 'text/javascript; charset=utf-8');
        const { res: cssRes } = await call(gate, '/desktop/assets/app-abc.css', session);
        assert.equal(cssRes.statusCode, 200);
        assert.equal(cssRes.headers['content-type'], 'text/css; charset=utf-8');
        const { res: headRes } = await call(gate, '/desktop/assets/app-abc.js', session, 'HEAD');
        assert.equal(headRes.statusCode, 200);
        assert.equal(headRes.payload, undefined);
        assert.equal((await call(gateFor(401), '/desktop/assets/app-abc.js', session)).res.statusCode, 401);
        const { res: traversalRes, next: traversalNext } = await call(gate, '/desktop/assets/../index.html', session);
        assert.equal(traversalRes.statusCode, 404);
        assert.equal(traversalNext, false);
        for (const bad of ['/desktop/assets/%2e%2e/index.html', '/desktop/assets//app-abc.js', '/desktop/assets/', '/desktop/assets/missing.js', '/desktop/assets/%ZZ', '/desktop/assets/%5csecret', '/desktop/assets/%00secret']) {
            const r = await call(gate, bad, session);
            assert.equal(r.res.statusCode, bad === '/desktop/assets/%ZZ' ? 400 : 404, bad);
            assert.equal(r.next, false);
        }
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
