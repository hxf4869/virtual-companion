// V2-W03 createStClient 离线契约测试：按上游 ST 源码确认的会话/CSRF 契约起本地 stub，
// 验证客户端把 /csrf-token 响应的全部 Set-Cookie（动态名 session-<hash> + <name>.sig）
// 回带到 POST /api/backends/chat-completions/generate。纯 Node 本地 HTTP + 随机端口，
// 无 docker / Go / 真实 ST / 真实网络。
// W05 增补：受管登录后的请求形状 —— GET /csrf-token 携带 Go 会话、unsafe 冻结期望身份双头、通用 call。
// 契约依据（upstream SillyTavern，受管副本一致）：
//   - src/server-main.js:156-162 cookie-session：会话内容序列化进 cookie 本身，
//     signed → cookies 包额外下发 `<name>.sig` 签名 cookie；
//   - src/users.js:612-617 getCookieSessionName：cookie 名 = `session-<sha256(hostname).slice(0,8)>`
//     （随宿主机名变化，不是 connect.sid）；
//   - src/server-main.js:168-202 + csrf-sync 4.2.1：POST 头 x-csrf-token 必须与
//     req.session.csrfToken 严格相等，GET /csrf-token 返回 {token} 且复用已有会话 token。
// 许可：AGPL-3.0-only（见 integrations/sillytavern/README；ADR-0009 §3）。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';

import { createStClient, parseSSEText } from '../scripts/managed-lib.mjs';

// 模拟 getCookieSessionName 的动态名（真实值随宿主机名变化；测试用固定 hash 后缀）
const SESSION_NAME = `session-${crypto.createHash('sha256').update('stub-host').digest('hex').slice(0, 8)}`;
const SIG_NAME = `${SESSION_NAME}.sig`;

let server;
let baseUrl;
const hits = { csrfToken: 0, generate: 0, lastGenerateReq: null, lastCsrfReq: null, lastSaveReq: null };

/** 模拟 cookie-session：会话 JSON 序列化进 cookie 值；缺主 cookie 或缺 .sig 视为无效会话。 */
function readSession(req) {
    const cookieHeader = req.headers.cookie ?? '';
    const pairs = new Map(cookieHeader.split(';').map((p) => p.trim()).filter(Boolean).map((p) => {
        const i = p.indexOf('=');
        return [p.slice(0, i), p.slice(i + 1)];
    }));
    if (!pairs.has(SESSION_NAME) || !pairs.has(SIG_NAME)) return null; // cookies 包验签失败 → 新空会话
    try {
        return JSON.parse(Buffer.from(pairs.get(SESSION_NAME), 'base64url').toString('utf8'));
    } catch {
        return null;
    }
}

before(async () => {
    server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        if (req.method === 'GET' && url.pathname === '/csrf-token') {
            hits.csrfToken += 1;
            hits.lastCsrfReq = { headers: req.headers };
            // csrf-sync generateToken(req, overwrite=false)：已有 token 复用，否则新签发
            const session = readSession(req) ?? {};
            const token = typeof session.csrfToken === 'string'
                ? session.csrfToken
                : crypto.randomBytes(32).toString('hex');
            const sessionValue = Buffer.from(JSON.stringify({ csrfToken: token })).toString('base64url');
            res.setHeader('content-type', 'application/json');
            // cookie-session 写回（cookies 包 signed=true → 主 cookie + .sig 两行 Set-Cookie）
            res.setHeader('set-cookie', [
                `${SESSION_NAME}=${sessionValue}; path=/; expires=Fri, 31 Dec 2027 00:00:00 GMT; samesite=Lax; httponly`,
                `${SIG_NAME}=${crypto.randomBytes(16).toString('base64url')}; path=/; httponly`,
            ]);
            res.end(JSON.stringify({ token }));
            return;
        }
        if (req.method === 'POST' && (url.pathname === '/api/backends/chat-completions/generate' || url.pathname === '/api/settings/save')) {
            const isGenerate = url.pathname === '/api/backends/chat-completions/generate';
            if (isGenerate) hits.generate += 1;
            let body = '';
            req.on('data', (c) => { body += c; });
            req.on('end', () => {
                const record = { headers: req.headers, body: body ? JSON.parse(body) : null };
                if (isGenerate) hits.lastGenerateReq = record; else hits.lastSaveReq = record;
                const session = readSession(req);
                const received = req.headers['x-csrf-token'];
                // csrf-sync isRequestValid：头与 req.session.csrfToken 必须同为 string 且相等
                if (typeof received !== 'string' || typeof session?.csrfToken !== 'string' || received !== session.csrfToken) {
                    res.writeHead(403, { 'content-type': 'text/html; charset=utf-8' });
                    res.end('<!DOCTYPE html><html><body>ForbiddenError: Invalid CSRF token. Please refresh the page and try again.</body></html>');
                    return;
                }
                if (!isGenerate) {
                    res.writeHead(200, { 'content-type': 'application/json' });
                    res.end(JSON.stringify({ saved: true }));
                    return;
                }
                const parsed = JSON.parse(body);
                if (parsed.stream === true) {
                    res.writeHead(200, { 'content-type': 'text/event-stream' });
                    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\n`);
                    res.write('data: [DONE]\n\n');
                    res.end();
                    return;
                }
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
            });
            return;
        }
        res.writeHead(404).end();
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    await new Promise((resolve) => server.close(resolve));
});

test('generate 非流式：动态名会话 cookie + .sig 全量回带，x-csrf-token 与会话一致 → 200', async () => {
    const client = createStClient({ baseUrl });
    const out = await client.generate({ chat_completion_source: 'custom', stream: false, messages: [] });
    assert.equal(out.status, 200);
    assert.equal(out.ok, true);
    assert.equal(out.json?.choices?.[0]?.message?.content, 'ok');
    assert.ok(out.text.includes('ok'));

    const req = hits.lastGenerateReq;
    assert.equal(req.headers['content-type'], 'application/json');
    assert.equal(typeof req.headers['x-csrf-token'], 'string');
    // 回归点：ST 无 connect.sid；必须回带 cookie-session 的动态名主 cookie 与 .sig 签名 cookie
    const cookie = req.headers.cookie ?? '';
    assert.ok(!cookie.includes('connect.sid'), `不应出现 connect.sid：${cookie}`);
    const pairs = cookie.split('; ');
    assert.equal(pairs.length, 2, `应恰好回带两个 cookie：${cookie}`);
    assert.ok(pairs[0].startsWith(`${SESSION_NAME}=`), `主会话 cookie 缺失：${cookie}`);
    assert.ok(pairs[1].startsWith(`${SIG_NAME}=`), `.sig 签名 cookie 缺失：${cookie}`);
    // 回带的 token 与会话内 csrfToken 一致（stub 端已校验，这里显式断言请求头值形状：64 hex）
    assert.match(req.headers['x-csrf-token'], /^[0-9a-f]{64}$/);
});

test('同一 client 多次 generate：token/会话复用，不重复请求 /csrf-token', async () => {
    hits.csrfToken = 0;
    hits.generate = 0;
    const client = createStClient({ baseUrl });
    const token1 = await client.ensureCsrf();
    await client.generate({ stream: false });
    await client.generate({ stream: false });
    assert.equal(hits.csrfToken, 1, 'ensureCsrf 缓存后不应重复 GET /csrf-token');
    assert.equal(hits.generate, 2);
    const token2 = await client.ensureCsrf();
    assert.equal(token2, token1);
});

test('generate 流式：返回 {status, res}，SSE 可解析', async () => {
    const client = createStClient({ baseUrl });
    const out = await client.generate({ stream: true });
    assert.equal(out.status, 200);
    assert.ok(out.res, '流式应返回原始 res');
    const text = await out.res.text();
    const events = parseSSEText(text);
    assert.equal(events.at(-1).data, '[DONE]');
    assert.equal(events[0].data?.choices?.[0]?.delta?.content, 'ok');
});

test('extraCookies：Go 会话 cookie 追加回带（桥 pickSessionCookies 的取用形状），ST 会话 cookie 不受影响', async () => {
    const extra = 'vc_session=raw-session-token; vc_csrf=csrf-token';
    const client = createStClient({ baseUrl, extraCookies: extra });
    const out = await client.generate({ stream: false });
    assert.equal(out.status, 200);
    const cookieHeader = hits.lastGenerateReq.headers.cookie ?? '';
    assert.ok(cookieHeader.includes(`${SESSION_NAME}=`), '动态名 ST 会话 cookie 必须回带');
    assert.ok(cookieHeader.includes(`${SIG_NAME}=`), '.sig 签名 cookie 必须回带');
    assert.ok(cookieHeader.includes('vc_session=raw-session-token'), 'Go 会话 cookie 必须追加');
    assert.ok(cookieHeader.includes('vc_csrf=csrf-token'), 'Go CSRF cookie 必须追加');
});

test('stub 契约自检：不回带会话 cookie 的裸 POST 必须被 403 HTML 拒绝（csrf-sync 行为）', async () => {
    const res = await fetch(`${baseUrl}/api/backends/chat-completions/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': '0'.repeat(64) },
        body: JSON.stringify({ stream: false }),
    });
    assert.equal(res.status, 403);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.match(await res.text(), /Invalid CSRF token/);
});

test('缺 x-csrf-token 头（仅有 cookie）同样 403：双条件缺一不可', async () => {
    // 先经真实端点取 token/cookie，再用原生 fetch 裸发（带 cookie、不带 token 头）
    const csrfRes = await fetch(`${baseUrl}/csrf-token`);
    const token = (await csrfRes.json()).token;
    const cookiePairs = csrfRes.headers.getSetCookie().map((l) => /^([^;]+)/.exec(l)[1]);
    const res = await fetch(`${baseUrl}/api/backends/chat-completions/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: cookiePairs.join('; ') },
        body: JSON.stringify({ stream: false }),
    });
    assert.equal(res.status, 403);
    assert.ok(token, '前置：/csrf-token 已返回 token');
});

// ---------- W05：受管登录后的请求形状（Go 会话 + 冻结期望身份 + 通用 call） ----------

const GO_EXTRA = 'vc_session=raw-session-token; vc_csrf=csrf-token';
const PAGE_IDENTITY = { accountId: '12345678901234567', sessionId: '987654321' };

test('W05 ensureCsrf：GET /csrf-token 本身携带 Go 会话 cookie（host-auth 在其前核验）', async () => {
    const client = createStClient({ baseUrl, extraCookies: GO_EXTRA, expectedIdentity: PAGE_IDENTITY });
    await client.ensureCsrf();
    const req = hits.lastCsrfReq;
    assert.ok(req, '应已请求 /csrf-token');
    const cookie = req.headers.cookie ?? '';
    assert.ok(cookie.includes('vc_session=raw-session-token'), `GET 须带 Go 会话 cookie：${cookie}`);
    assert.ok(cookie.includes('vc_csrf=csrf-token'));
    assert.equal(req.headers['x-csrf-token'], undefined, 'GET 是安全方法，不带 CSRF 头');
    assert.equal(req.headers['x-vc-expected-account-id'], undefined, 'GET 不带期望身份双头');
});

test('W05 call unsafe：ST CSRF 双提交 + 冻结期望身份双头 + ST 两颗与 Go 两颗 cookie 全部回带', async () => {
    const suppliedIdentity = { ...PAGE_IDENTITY };
    const client = createStClient({ baseUrl, extraCookies: GO_EXTRA, expectedIdentity: suppliedIdentity });
    const token = await client.ensureCsrf();
    hits.csrfToken = 0;
    const out = await client.call('POST', '/api/settings/save', { note: 'x' });
    assert.equal(out.status, 200);
    assert.deepEqual(out.json, { saved: true });
    assert.equal(hits.csrfToken, 0, 'unsafe 复用已保存 csrf，不重复 GET /csrf-token');
    let req = hits.lastSaveReq;
    assert.equal(req.headers['x-csrf-token'], token, 'x-csrf-token 与会话 token 双提交一致');
    assert.equal(req.headers['x-vc-expected-account-id'], PAGE_IDENTITY.accountId, '期望身份只来自创建时的页面身份副本');
    assert.equal(req.headers['x-vc-expected-session-id'], PAGE_IDENTITY.sessionId);
    const cookie = req.headers.cookie ?? '';
    assert.equal(cookie.split('; ').length, 4, `应回带 4 颗 cookie：${cookie}`);
    assert.ok(cookie.startsWith(`${SESSION_NAME}=`) && cookie.includes(`${SIG_NAME}=`), 'cookie-session 两颗 cookie 全部回带');
    assert.ok(cookie.includes('vc_session=raw-session-token') && cookie.includes('vc_csrf=csrf-token'), 'Go 会话两颗 cookie 全部回带');
    // 再次 unsafe：期望身份保持创建时副本，绝不随后续响应/cookie 自动换身份
    suppliedIdentity.accountId = 'other-account'; suppliedIdentity.sessionId = 'other-session';
    await client.call('POST', '/api/settings/save', { note: 'y' });
    req = hits.lastSaveReq;
    assert.equal(req.headers['x-vc-expected-account-id'], PAGE_IDENTITY.accountId);
    assert.equal(req.headers['x-vc-expected-session-id'], PAGE_IDENTITY.sessionId);
});

test('W05 call GET：懒 csrf（不额外预取）、无期望身份头、cookie 回带；JSON 与非 JSON 正文均可解析', async () => {
    const client = createStClient({ baseUrl, extraCookies: GO_EXTRA, expectedIdentity: PAGE_IDENTITY });
    const csrfBefore = hits.csrfToken;
    const jsonOut = await client.call('GET', '/csrf-token');
    assert.equal(jsonOut.ok, true);
    assert.equal(typeof jsonOut.json?.token, 'string', 'JSON 正文解析为 json');
    assert.equal(hits.csrfToken, csrfBefore + 1, '只发生目标请求本身这一次 GET，无额外 csrf 预取');
    assert.equal(hits.lastCsrfReq.headers['x-csrf-token'], undefined);
    assert.equal(hits.lastCsrfReq.headers['x-vc-expected-account-id'], undefined);
    assert.ok((hits.lastCsrfReq.headers.cookie ?? '').includes('vc_session=raw-session-token'), 'GET 仍回带 cookie');
    const htmlOut = await client.call('GET', '/');
    assert.equal(htmlOut.status, 404);
    assert.equal(htmlOut.ok, false);
    assert.equal(htmlOut.json, null, '非 JSON 正文 json=null');
});
