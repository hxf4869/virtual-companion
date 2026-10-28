// V2-W03-S4 桥接测试：Go 管理桥（白名单/cookie/CSRF 映射/服务令牌隔离/错误透传）、
// 生成桥会话认证与受管宿主策略、插件 init/exit、补丁可应用性。
// 纯 Node + 本地合成 HTTP；无真实模型调用、无外部费用。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EventEmitter } from 'node:events';

import { createAdminBridge, ADMIN_BRIDGE_ROUTES } from '../server-plugin/virtual-companion/lib/admin-bridge.js';
import { createGenerateBridge, BRIDGE_SYMBOL } from '../server-plugin/virtual-companion/lib/generate-bridge.js';
import { createStatusBridge } from '../server-plugin/virtual-companion/lib/status-bridge.js';
import { ToolContinuationStore } from '../server-plugin/virtual-companion/lib/responses-adapter.js';
import { createTokenCounter } from '../server-plugin/virtual-companion/lib/context-guard.js';
import { BridgeError, writeErrorResponse } from '../server-plugin/virtual-companion/lib/errors.js';
import { loadConfig } from '../server-plugin/virtual-companion/lib/config.js';
import { validateSpec, applySpecToText } from '../scripts/lib/patcher.mjs';
import { sha256 } from '../scripts/lib/util.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const counter = createTokenCounter({
    getTokenizerModel: (m) => m,
    getTiktokenTokenizer: () => ({ encode: (t) => new Array(Math.ceil(t.length / 4)) }),
});

function mockRes() {
    const res = {
        statusCode: 200, headers: {}, chunks: [], ended: false, _sent: false,
        setHeader(k, v) { this.headers[k] = v; },
        appendHeader(k, v) { this.headers[k] = [].concat(this.headers[k] ?? [], v); },
        flushHeaders() {},
        write(c) { this._sent = true; this.chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c))); return true; },
        end(c) { if (c !== undefined && c !== null) this.write(c); this._sent = true; this.ended = true; },
        body() { return Buffer.concat(this.chunks).toString('utf8'); },
        get headersSent() { return this._sent; },
        get writableEnded() { return this.ended; },
    };
    return res;
}

function bridgeReq({ method = 'GET', url = '/api/v1/admin/providers', headers = {}, body } = {}) {
    return { method, url, headers, body };
}

function startServer(handler) {
    return new Promise((resolve) => {
        const server = http.createServer(handler);
        server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
    });
}

// —— 合成 Go：捕获上游收到的请求，按配置回包 ——
function fakeGo(state) {
    return async (req, res) => {
        const url = new URL(req.url, 'http://go.local');
        let body = null;
        const chunks = [];
        for await (const c of req) chunks.push(c);
        if (chunks.length) body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        state.upstream.push({ method: req.method, path: url.pathname, search: url.search, headers: { ...req.headers }, body });
        const canned = state.responses[`${req.method} ${url.pathname}`];
        if (canned) {
            res.writeHead(canned.status ?? 200, { 'Content-Type': 'application/json', ...(canned.headers ?? {}) });
            return res.end(canned.body !== undefined ? JSON.stringify(canned.body) : '');
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: 'NOT_FOUND', message: 'no' }));
    };
}

const baseConfig = (goPort) => ({ goBaseUrl: `http://127.0.0.1:${goPort}`, serviceToken: 'S'.repeat(40), timeoutMs: 5000 });

// ---------------------------------------------------------------------------
// 管理桥
// ---------------------------------------------------------------------------

test('管理桥：白名单方法+路径可达并原样透传状态与响应体（含 ErrorEnvelope）', async () => {
    const state = { upstream: [], responses: {
        'GET /api/v1/admin/providers': { status: 200, body: { providers: [{ providerId: 'p1', revision: 3 }] } },
        'PUT /api/v1/admin/providers/p1': { status: 409, body: { code: 'REVISION_CONFLICT', message: 'expected 2' } },
        'POST /api/v1/admin/providers/p1/models/discover': { status: 200, body: { models: ['m1'] } },
        'GET /api/v1/admin/model-purposes': { status: 200, body: { purposes: [] } },
        'PUT /api/v1/admin/model-purposes/FOREGROUND_CHAT': { status: 200, body: { ok: true } },
        'GET /api/v1/auth/session': { status: 200, body: { accountId: '7' } },
        'POST /api/v1/auth/login': { status: 200, body: { nextStep: 'ACTIVE' } },
        'POST /api/v1/auth/reauth': { status: 200, body: { ok: true } },
    } };
    const { server, port } = await startServer(fakeGo(state));
    const handler = createAdminBridge({ config: baseConfig(port) });
    try {
        const cases = [
            { method: 'GET', url: '/api/v1/admin/providers', body: undefined },
            { method: 'PUT', url: '/api/v1/admin/providers/p1', body: { displayName: 'P', expectedRevision: 3 } },
            { method: 'POST', url: '/api/v1/admin/providers/p1/models/discover', body: {} },
            { method: 'GET', url: '/api/v1/admin/model-purposes', body: undefined },
            { method: 'PUT', url: '/api/v1/admin/model-purposes/FOREGROUND_CHAT', body: { providerId: 'p1' } },
            { method: 'GET', url: '/api/v1/auth/session', body: undefined },
            { method: 'POST', url: '/api/v1/auth/login', body: { username: 'owner' } },
            { method: 'POST', url: '/api/v1/auth/reauth', body: { password: 'x' } },
        ];
        for (const c of cases) {
            const res = mockRes();
            await handler(bridgeReq({ ...c, headers: { 'content-type': 'application/json', 'x-vc-csrf-token': 'VCTOK', cookie: 'vc_session=s1; vc_csrf=c1' } }), res);
            assert.equal(res.statusCode, c.method === 'PUT' && c.url.endsWith('providers/p1') ? 409 : 200, `${c.method} ${c.url}`);
            assert.match(res.headers['Content-Type'], /application\/json/);
            const sent = state.upstream.at(-1);
            assert.equal(sent.method, c.method);
            assert.equal(sent.path, c.url);
            if (c.body !== undefined) assert.deepEqual(sent.body, c.body);
        }
        // 错误信封原样透传
        const resPut = mockRes();
        await handler(bridgeReq({ method: 'PUT', url: '/api/v1/admin/providers/p1', headers: { 'content-type': 'application/json' }, body: {} }), resPut);
        assert.deepEqual(JSON.parse(resPut.body()), { code: 'REVISION_CONFLICT', message: 'expected 2' });
    } finally {
        server.close();
    }
});

test('管理桥：白名单外路径/方法/编码穿越一律 404，且不触达 Go', async () => {
    const state = { upstream: [], responses: {} };
    const { server, port } = await startServer(fakeGo(state));
    const handler = createAdminBridge({ config: baseConfig(port) });
    try {
        for (const c of [
            { method: 'GET', url: '/api/v1/admin/accounts' },
            { method: 'DELETE', url: '/api/v1/admin/providers/p1' },
            { method: 'GET', url: '/api/v1/admin/providers/../accounts' },
            { method: 'GET', url: '/api/v1/admin/providers/%2e%2e/accounts' },
            { method: 'GET', url: '/api/v1/admin/model-purposes/FOREGROUND_CHAT' }, // Go 未注册的单用途 GET
            { method: 'GET', url: '//api/v1/auth/session' },
            { method: 'POST', url: '/api/v1/service/model-purposes/FOREGROUND_CHAT/resolve' }, // 私有取用通道不进桥
        ]) {
            const res = mockRes();
            await handler(bridgeReq(c), res);
            assert.equal(res.statusCode, 404, `${c.method} ${c.url} 应 404`);
            assert.equal(JSON.parse(res.body()).error.code, 'VC_BRIDGE_ROUTE_NOT_ALLOWED');
        }
        assert.equal(state.upstream.length, 0, '白名单外请求不得触达 Go');
        assert.equal(ADMIN_BRIDGE_ROUTES.some((r) => r.path.test('/api/v1/service/model-purposes/X/resolve')), false);
    } finally {
        server.close();
    }
});

test('管理桥：仅转 vc_session/vc_csrf；X-VC-CSRF-Token→X-CSRF-Token；ST CSRF 头剥离；Origin 与 Expected 头透传；永不附加服务令牌', async () => {
    const state = { upstream: [], responses: { 'PUT /api/v1/admin/providers/p1': { status: 200, body: { ok: 1 } } } };
    const { server, port } = await startServer(fakeGo(state));
    const handler = createAdminBridge({ config: baseConfig(port) });
    try {
        const res = mockRes();
        await handler(bridgeReq({
            method: 'PUT', url: '/api/v1/admin/providers/p1',
            headers: {
                'content-type': 'application/json',
                'x-csrf-token': 'ST-TOKEN',
                'x-vc-csrf-token': 'VC-TOKEN',
                'x-vc-expected-account-id': '7',
                'x-vc-expected-session-id': '11',
                origin: 'http://127.0.0.1:8742',
                cookie: 'vc_session=S1; vc_csrf=C1; other_cookie=X; st_session=Y',
                authorization: 'Bearer should-not-forward',
            },
            body: { displayName: 'P' },
        }), res);
        assert.equal(res.statusCode, 200);
        const sent = state.upstream[0];
        assert.equal(sent.headers.cookie, 'vc_session=S1; vc_csrf=C1', '只转必要 vc cookie');
        assert.equal(sent.headers['x-csrf-token'], 'VC-TOKEN', '映射后的 Go CSRF 头');
        assert.notEqual(sent.headers['x-csrf-token'], 'ST-TOKEN');
        assert.equal(sent.headers['x-vc-expected-account-id'], '7');
        assert.equal(sent.headers['x-vc-expected-session-id'], '11');
        assert.equal(sent.headers.origin, 'http://127.0.0.1:8742', 'Origin 原样转发');
        assert.equal(sent.headers.authorization, undefined, '绝不附加 Authorization/服务令牌');
    } finally {
        server.close();
    }
});

test('管理桥：非 JSON 请求体 415；Go 不可达 502', async () => {
    const handler = createAdminBridge({ config: { goBaseUrl: 'http://127.0.0.1:1', serviceToken: 'S'.repeat(40), timeoutMs: 500 } });
    const res415 = mockRes();
    await handler(bridgeReq({ method: 'PUT', url: '/api/v1/admin/providers/p1', headers: { 'content-type': 'text/plain' }, body: 'x' }), res415);
    assert.equal(res415.statusCode, 415);
    const res502 = mockRes();
    await handler(bridgeReq({ method: 'GET', url: '/api/v1/auth/session' }), res502);
    assert.equal(res502.statusCode, 502);
    assert.equal(JSON.parse(res502.body()).error.code, 'VC_GO_UNREACHABLE');
});

// ---------------------------------------------------------------------------
// 生成桥：会话认证与受管宿主策略
// ---------------------------------------------------------------------------

function generateBody(over = {}) {
    return {
        chat_completion_source: 'custom',
        messages: [{ role: 'user', content: '你好' }],
        model: 'vc-profile-a',
        max_tokens: 100, stream: false,
        custom_url: 'vc-go://model-purposes/FOREGROUND_CHAT?provider=p1&profile=vc-profile-a&pr=3&br=9&scope=chatA',
        ...over,
    };
}

function mockGenReq({ body, headers = {} } = {}) {
    return { body, headers, user: { profile: { handle: 'default-user' } }, socket: new EventEmitter() };
}

test('生成桥：无 Go 会话 cookie → 401；Go 会话失效 → 401；不触达 resolve', async () => {
    const state = { upstream: [], responses: { 'GET /api/v1/auth/session': { status: 401, body: {} } } };
    const { server, port } = await startServer(fakeGo(state));
    const bridge = createGenerateBridge({ config: baseConfig(port), continuationStore: new ToolContinuationStore(), counter });
    try {
        const res1 = mockRes();
        assert.equal(await bridge.interceptGenerate(mockGenReq({ body: generateBody() }), res1), true);
        assert.equal(res1.statusCode, 401);
        assert.equal(JSON.parse(res1.body()).error.code, 'VC_GO_SESSION_REQUIRED');
        const res2 = mockRes();
        assert.equal(await bridge.interceptGenerate(mockGenReq({ body: generateBody(), headers: { cookie: 'vc_session=stale' } }), res2), true);
        assert.equal(res2.statusCode, 401);
        assert.equal(JSON.parse(res2.body()).error.code, 'VC_GO_SESSION_REQUIRED');
        assert.ok(!state.upstream.some((u) => u.path.includes('/resolve')), '未核验会话不得取用');
    } finally {
        server.close();
    }
});

test('生成桥：ownerAccountId 取自 Go 会话；伪造浏览器自报值无效', async () => {
    const state = { upstream: [], responses: {
        'GET /api/v1/auth/session': { status: 200, body: { accountId: '7', sessionId: '11', role: 'OWNER' } },
        'POST /api/v1/service/model-purposes/FOREGROUND_CHAT/resolve': { status: 502, body: { code: 'BOOM', message: 'x' } },
    } };
    const { server, port } = await startServer(fakeGo(state));
    const bridge = createGenerateBridge({ config: baseConfig(port), continuationStore: new ToolContinuationStore(), counter });
    try {
        const res = mockRes();
        // 浏览器伪造 ownerAccountId（真实链路不存在该字段，若 bridge 读取即会被 Go stub 断言捕获）
        const body = { ...generateBody(), ownerAccountId: '999' };
        await bridge.interceptGenerate(mockGenReq({ body, headers: { cookie: 'vc_session=s1' } }), res);
        const resolve = state.upstream.find((u) => u.path.includes('/resolve'));
        assert.ok(resolve, '应发起受控取用');
        assert.equal(resolve.body.ownerAccountId, '7', 'ownerAccountId 来自会话，不是浏览器');
        assert.equal(resolve.headers.authorization, `Bearer ${'S'.repeat(40)}`);
        assert.equal(resolve.headers.origin, undefined, '服务端取用不带 Origin');
        assert.ok(Number.isInteger(resolve.body.providerRevision) && Number.isInteger(resolve.body.bindingRevision));
    } finally {
        server.close();
    }
});

test('受管宿主策略：插件已装载即受管——无标记/伪标记明确拒绝，不回退原生旧 Key', async () => {
    const bridge = createGenerateBridge({
        config: { goBaseUrl: 'http://127.0.0.1:1', serviceToken: 'S'.repeat(40), timeoutMs: 500 },
        continuationStore: new ToolContinuationStore(), counter,
    });
    const noMarker = mockRes();
    assert.equal(await bridge.interceptGenerate(mockGenReq({ body: generateBody({ custom_url: 'http://native-old-key.example/v1', model: 'vc-profile-a' }) }), noMarker), true);
    assert.equal(noMarker.statusCode, 409);
    assert.equal(JSON.parse(noMarker.body()).error.code, 'VC_UNMANAGED_GENERATION');
    const badMarker = mockRes();
    assert.equal(await bridge.interceptGenerate(mockGenReq({ body: generateBody({ custom_url: 'vc-go://model-purposes/X?pr=abc' }) }), badMarker), true);
    assert.equal(JSON.parse(badMarker.body()).error.code, 'VC_MARKER_INVALID');
    const badPurpose = mockRes();
    assert.equal(await bridge.interceptGenerate(mockGenReq({ body: generateBody({ custom_url: 'vc-go://model-purposes/EMBEDDING?pr=1&br=1' }) }), badPurpose), true);
    assert.equal(JSON.parse(badPurpose.body()).error.code, 'VC_PURPOSE_UNSUPPORTED');
    const textMode = mockRes();
    assert.equal(await bridge.interceptGenerate(mockGenReq({ body: generateBody({ messages: 'plain prompt' }) }), textMode), true);
    assert.equal(JSON.parse(textMode.body()).error.code, 'VC_TEXT_COMPLETION_UNSUPPORTED');
    const noToken = mockRes();
    const bridgeNoToken = createGenerateBridge({
        config: { goBaseUrl: 'http://127.0.0.1:1', serviceToken: '', timeoutMs: 500 },
        continuationStore: new ToolContinuationStore(), counter,
    });
    // 无令牌：先过会话（本地 stub 不可达 → 502/504 均为显式失败，不回退原生）
    assert.equal(await bridgeNoToken.interceptGenerate(mockGenReq({ body: generateBody(), headers: { cookie: 'vc_session=s' } }), noToken), true);
    assert.ok([502, 504].includes(noToken.statusCode), '不得回退原生');
});

test('config：弱服务令牌拒绝；非法 Go 基地址拒绝', () => {
    assert.throws(() => loadConfig({ VC_ST_PLUGIN_SERVICE_TOKEN: 'short' }), /32 字节/);
    assert.throws(() => loadConfig({ VC_ST_GO_BASE_URL: 'ftp://x' }), /http/);
    const cfg = loadConfig({ VC_ST_GO_BASE_URL: 'http://127.0.0.1:8080/', VC_ST_PLUGIN_SERVICE_TOKEN: 'S'.repeat(40) });
    assert.equal(cfg.goBaseUrl, 'http://127.0.0.1:8080');
});

// ---------------------------------------------------------------------------
// 插件 init/exit（部署契约：全局桥对象 + /go 路由挂载）
// ---------------------------------------------------------------------------

test('插件 init/exit：按真实部署布局加载ST用户模块，注册认证/F2/生成桥并挂载 /go', async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-plugin-deploy-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const plugin = path.join(root, 'plugins/virtual-companion');
    fs.cpSync(path.join(HERE, '../server-plugin/virtual-companion'), plugin, { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
    // The production host provides node-persist; this isolated layout supplies
    // its storage contract without requiring a downloaded ST tree in unit CI.
    const persistence = path.join(root, 'node_modules/node-persist');
    fs.mkdirSync(persistence, { recursive: true });
    fs.writeFileSync(path.join(persistence, 'package.json'), '{"type":"module","exports":"./index.js"}');
    fs.writeFileSync(path.join(persistence, 'index.js'), 'export default { setItem: async () => {}, removeItem: async () => {} };');
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src/users.js'), 'export const getAllEnabledUsers = async () => []; export const getAccountVersion = () => "version"; export const getUserDirectories = () => ({});');
    const { init, exit, info } = await import(pathToFileURL(path.join(plugin, 'index.js')).href);
    const prev = process.env.VC_ST_GO_BASE_URL;
    const prevTok = process.env.VC_ST_PLUGIN_SERVICE_TOKEN;
    process.env.VC_ST_GO_BASE_URL = 'http://127.0.0.1:8080';
    process.env.VC_ST_PLUGIN_SERVICE_TOKEN = 'S'.repeat(40);
    const mounted = [];
    const router = { use: (p, h) => mounted.push({ p, h }) };
    try {
        await init(router);
        assert.equal(mounted.length, 1);
        assert.equal(mounted[0].p, '/go');
        assert.equal(typeof mounted[0].h, 'function');
        const bridge = globalThis[BRIDGE_SYMBOL];
        assert.ok(bridge && typeof bridge.interceptGenerate === 'function' && typeof bridge.finalOutboundGuard === 'function');
        assert.equal(typeof bridge.interceptStatus, 'function', '/status 钩子对端必须随插件注册');
        assert.equal(typeof bridge.hostAuth, 'function', '全入口认证钩子必须注册');
        assert.equal(typeof bridge.f2.save, 'function', '原生保存必须接入F2');
        exit();
        assert.equal(globalThis[BRIDGE_SYMBOL], undefined);
        assert.equal(info.id, 'virtual-companion');
    } finally {
        if (prev === undefined) delete process.env.VC_ST_GO_BASE_URL; else process.env.VC_ST_GO_BASE_URL = prev;
        if (prevTok === undefined) delete process.env.VC_ST_PLUGIN_SERVICE_TOKEN; else process.env.VC_ST_PLUGIN_SERVICE_TOKEN = prevTok;
        exit();
    }
});

// ---------------------------------------------------------------------------
// /status 受管接管：只在真实上游模型列表成功后应答，不伪造联网成功
// ---------------------------------------------------------------------------

const STATUS_MARKER = 'vc-go://model-purposes/FOREGROUND_CHAT?provider=p1&profile=vc-profile-a&pr=3&br=9&scope=chatA';

function statusGoResponses(providerPort, over = {}) {
    return {
        'GET /api/v1/auth/session': { status: 200, body: { accountId: '9007199254740993', sessionId: '11' } },
        'POST /api/v1/service/model-purposes/FOREGROUND_CHAT/resolve': {
            status: 200,
            body: {
                purpose: 'FOREGROUND_CHAT', bindingRevision: 9,
                provider: { providerId: 'p1', protocol: 'OPENAI_CHAT_COMPLETIONS', baseUrl: `http://127.0.0.1:${providerPort}/v1`, endpointUrl: `http://127.0.0.1:${providerPort}/v1/chat/completions`, revision: 3, credential: 'sk-go-managed' },
                model: { profileKey: 'vc-profile-a', modelId: 'upstream-model-x', contextWindowTokens: 4096, maxOutputTokens: 1024, generationParams: {} },
            },
        },
        ...over,
    };
}

test('/status 受管接管：无标记交回原生；有标记 → Go 会话核验 + resolve + 真实上游 GET /models 透传', async () => {
    const providerHits = [];
    const { server: provider, port: providerPort } = await startServer((req, res) => {
        providerHits.push({ url: req.url, auth: req.headers.authorization });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ object: 'list', data: [{ id: 'upstream-model-x' }, { id: 'upstream-model-y' }] }));
    });
    const state = { upstream: [], responses: statusGoResponses(providerPort) };
    const { server: go, port: goPort } = await startServer(fakeGo(state));
    const { interceptStatus } = createStatusBridge({ config: baseConfig(goPort) });
    try {
        const native = mockRes();
        assert.equal(await interceptStatus({ body: { chat_completion_source: 'custom', custom_url: 'https://plain.example/v1' }, headers: {} }, native), false);
        assert.equal(native.ended, false, '无标记不写响应');
        assert.equal(state.upstream.length, 0, '无标记不触达 Go');

        const res = mockRes();
        const handled = await interceptStatus({ body: { chat_completion_source: 'custom', custom_url: STATUS_MARKER }, headers: { cookie: 'vc_session=s1; st_other=x' } }, res);
        assert.equal(handled, true);
        assert.equal(res.statusCode, 200);
        assert.deepEqual(JSON.parse(res.body()).data.map((m) => m.id), ['upstream-model-x', 'upstream-model-y'], '原样透传真实上游列表');
        assert.equal(providerHits.length, 1, '恰好一次真实上游模型列表请求');
        assert.equal(providerHits[0].url, '/v1/models', '基地址剥去方法路径后追加 /models');
        assert.equal(providerHits[0].auth, 'Bearer sk-go-managed', '用 Go 受控取用的凭据');
        const resolve = state.upstream.find((u) => u.path.includes('/resolve'));
        assert.equal(resolve.body.ownerAccountId, '9007199254740993', 'ownerAccountId 十进制字符串原样直传（>2^53 不丢精度）');
        assert.equal(resolve.body.providerRevision, 3);
        assert.equal(resolve.headers.origin, undefined);
    } finally {
        provider.close(); go.close();
    }
});

test('/status 受管接管：无 Go 会话 401；revision 冲突 409；上游失败 502 固定文案不回显正文；源不匹配 400', async () => {
    const { server: provider, port: providerPort } = await startServer((req, res) => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'SECRET-UPSTREAM-DETAIL sk-leak' } }));
    });
    const state = { upstream: [], responses: statusGoResponses(providerPort) };
    const { server: go, port: goPort } = await startServer(fakeGo(state));
    const { interceptStatus } = createStatusBridge({ config: baseConfig(goPort) });
    try {
        const noSession = mockRes();
        assert.equal(await interceptStatus({ body: { chat_completion_source: 'custom', custom_url: STATUS_MARKER }, headers: {} }, noSession), true);
        // 无 vc_session：fakeGo 会话路由仍回 200，但真实 Go 回 401；这里改 stub 验证 401 映射
        state.responses['GET /api/v1/auth/session'] = { status: 401, body: {} };
        const noSession2 = mockRes();
        await interceptStatus({ body: { chat_completion_source: 'custom', custom_url: STATUS_MARKER }, headers: {} }, noSession2);
        assert.equal(noSession2.statusCode, 401);
        assert.equal(JSON.parse(noSession2.body()).error.code, 'VC_GO_SESSION_REQUIRED');
        state.responses = statusGoResponses(providerPort);

        const upstreamFail = mockRes();
        await interceptStatus({ body: { chat_completion_source: 'custom', custom_url: STATUS_MARKER }, headers: { cookie: 'vc_session=s1' } }, upstreamFail);
        assert.equal(upstreamFail.statusCode, 502);
        const err = JSON.parse(upstreamFail.body()).error;
        assert.equal(err.code, 'VC_UPSTREAM_ERROR');
        assert.ok(!upstreamFail.body().includes('SECRET-UPSTREAM-DETAIL'), '不回显上游正文');

        state.responses['POST /api/v1/service/model-purposes/FOREGROUND_CHAT/resolve'] = { status: 409, body: { code: 'REVISION_CONFLICT', message: 'stale' } };
        const conflict = mockRes();
        await interceptStatus({ body: { chat_completion_source: 'custom', custom_url: STATUS_MARKER }, headers: { cookie: 'vc_session=s1' } }, conflict);
        assert.equal(conflict.statusCode, 409);
        assert.equal(JSON.parse(conflict.body()).error.code, 'VC_REVISION_CONFLICT');

        const mismatch = mockRes();
        await interceptStatus({ body: { chat_completion_source: 'claude', custom_url: STATUS_MARKER }, headers: { cookie: 'vc_session=s1' } }, mismatch);
        assert.equal(mismatch.statusCode, 400);
        assert.equal(JSON.parse(mismatch.body()).error.code, 'VC_SOURCE_MISMATCH');
    } finally {
        provider.close(); go.close();
    }
});

// ---------------------------------------------------------------------------
// 补丁可应用性（真实锁定上游文件存在时核验 SHA；否则语义 fixture 兜底）
// ---------------------------------------------------------------------------

const PATCH_DIR = path.join(HERE, '..', 'patches');
const UPSTREAM_CC = path.join(HERE, '..', 'upstream', 'SillyTavern', 'src', 'endpoints', 'backends', 'chat-completions.js');
const UPSTREAM_UTIL = path.join(HERE, '..', 'upstream', 'SillyTavern', 'src', 'util.js');

for (const name of ['st-chat-completions-vc-bridge.json', 'st-util-stream-error-log.json']) {
    test(`补丁规格 ${name}：字段合法、from 唯一命中、输出 SHA 可复现`, async (t) => {
        const spec = JSON.parse(fs.readFileSync(path.join(PATCH_DIR, name), 'utf8'));
        assert.deepEqual(validateSpec(spec), []);
        const target = spec.target.endsWith('chat-completions.js') ? UPSTREAM_CC : UPSTREAM_UTIL;
        if (!fs.existsSync(target)) {
            t.skip(`本地无 ${path.relative(HERE, target)}（gitignored upstream/）；部署时由 bootstrap 补丁器强制校验，本测试以 fixture 兜底`);
        } else {
            const input = fs.readFileSync(target, 'utf8');
            const result = applySpecToText(input, spec);
            assert.equal(result.inputSha256, spec.expected_input_sha256);
            assert.equal(result.outputSha256, spec.expected_output_sha256);
        }
        // 语义 fixture：按规格自身构造含锚点的输入，验证替换语义
        const fixture = spec.replacements.map((r) => r.from).join('\n/*…*/\n');
        const fixtureSpec = { ...spec, expected_input_sha256: sha256(Buffer.from(fixture)), expected_output_sha256: undefined };
        const out = applySpecToText(fixture, fixtureSpec).output;
        for (const r of spec.replacements) {
            assert.ok(out.includes(r.to), `替换结果应包含 to（${r.where.slice(0, 24)}…）`);
        }
    });
}

test('补丁钩子形态：最终防线与拦截钩子都以可选链调用，插件缺失时为空操作', () => {
    const src = fs.readFileSync(path.join(PATCH_DIR, 'st-chat-completions-vc-bridge.json'), 'utf8');
    const spec = JSON.parse(src);
    const guard = spec.replacements.find((r) => r.to.includes('finalOutboundGuard') && r.to.includes('generateResponse')).to;
    assert.match(guard, /globalThis\[Symbol\.for\('virtual-companion\.bridge'\)\]\?\.finalOutboundGuard\?\.\(request, response, requestBody, apiUrl \+ '\/messages'\)/);
    const hook1 = spec.replacements[0].to;
    assert.match(hook1, /vcBridge\.interceptGenerate\(request, response\)/);
});

test('BridgeError 形态：status/code/message/extra；writeErrorResponse 输出 ST 可解析错误', () => {
    const e = new BridgeError(409, 'VC_X', 'msg', { a: 1 });
    assert.equal(e.status, 409);
    assert.equal(e.code, 'VC_X');
    const res = mockRes();
    writeErrorResponse(res, 409, 'VC_X', 'msg', { a: 1 });
    assert.equal(res.statusCode, 409);
    assert.deepEqual(JSON.parse(res.body()), { error: { message: 'msg', code: 'VC_X', a: 1 } });
});
