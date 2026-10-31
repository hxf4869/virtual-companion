// Go 是身份权威；此中间件位于 ST 用户解析、静态资源和原生 API 之前。
// 不信任 Remote-User / X-Authentik-Username，也不缓存会话准入结果。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRIVATE_ST_PATHS } from './source-bridge.js';

const ASSETS = new Map([['/auth/', 'index.html'], ['/auth/index.js', 'index.js'], ['/auth/style.css', 'style.css']]);
// 首屏反馈随 HTML 返回，不等待宿主脚本或扩展初始化；由原生 preloader 一并移除。
const STARTUP_HTML = fs.readFileSync(new URL('../auth/startup.html', import.meta.url), 'utf8');
const AUTH_API = [
    ['GET', /^session$/], ['POST', /^(login|logout|password|reauth)$/],
    ['DELETE', /^account$/],
    ['POST', /^challenges\/[A-Za-z0-9_-]{43}\/(authenticator-setup|authenticator-confirm|totp|recovery-code)$/],
];
const COOKIE_NAMES = new Set(['vc_session', 'vc_csrf', 'vc_trusted_device']);
export function goCookies(header = '') {
    return String(header).split(';').map((p) => p.trim()).filter((p) => COOKIE_NAMES.has(p.split('=')[0])).join('; ');
}
function fail(res, status, code, message) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(status).json({ code, message });
}
export function parseAccountHandles(raw) {
    if (!raw) return {};
    const map = JSON.parse(raw);
    if (!map || Array.isArray(map) || typeof map !== 'object') throw new Error('VC_ST_ACCOUNT_HANDLES 必须是账号ID到ST handle的对象');
    const seen = new Set();
    for (const [account, handle] of Object.entries(map)) {
        if (!/^[1-9][0-9]{0,18}$/.test(account) || typeof handle !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(handle) || seen.has(handle)) {
            throw new Error('VC_ST_ACCOUNT_HANDLES 需要有效且互不重复的账号与ST handle');
        }
        seen.add(handle);
    }
    return map;
}

export function createHostAuth({ config, getUser, accountVersion, indexHtml, fetchImpl = fetch,
    sourceBridge, accountData,
    authDir = fileURLToPath(new URL('../auth/', import.meta.url)) }) {
    async function proxyAuth(req, res, suffix) {
        if (!AUTH_API.some(([method, pattern]) => req.method === method && pattern.test(suffix))) return fail(res, 404, 'NOT_FOUND_OR_FORBIDDEN', '未找到此入口');
        const headers = { Accept: 'application/json', Cookie: goCookies(req.headers.cookie) };
        for (const h of ['origin', 'x-csrf-token', 'x-vc-expected-account-id', 'x-vc-expected-session-id']) {
            if (typeof req.headers[h] === 'string') headers[h] = req.headers[h];
        }
        const write = !['GET', 'HEAD'].includes(req.method);
        if (write) headers['Content-Type'] = 'application/json';
        const upstream = await fetchImpl(`${config.goBaseUrl}/api/v1/auth/${suffix}`, {
            method: req.method, headers, ...(write ? { body: JSON.stringify(req.body ?? {}) } : {}),
            redirect: 'error', signal: AbortSignal.timeout(config.timeoutMs),
        });
        res.status(upstream.status); res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Type', 'application/json');
        if (upstream.headers.has('retry-after')) res.setHeader('Retry-After', upstream.headers.get('retry-after'));
        for (const cookie of upstream.headers.getSetCookie?.() ?? []) res.appendHeader('Set-Cookie', cookie);
        // Go 注销/改密会使每条后续请求的在线核验失效；不在迟到响应中清共享 ST cookie。
        res.end(Buffer.from(await upstream.arrayBuffer()));
    }
    return async function hostAuth(req, res, next) {
        try {
            if (req.method === 'POST' && PRIVATE_ST_PATHS.includes(req.path)) {
                if (!sourceBridge) return fail(res, 503, 'VC_SOURCE_UNAVAILABLE', '来源读取暂不可用');
                return await sourceBridge(req, res);
            }
            if (req.method === 'GET' && req.path === '/index.html') return res.redirect(303, '/');
            if (req.method === 'GET' && ['/auth', '/login'].includes(req.path)) return res.redirect(303, '/auth/');
            if (req.method === 'GET' && ASSETS.has(req.path)) {
                const file = ASSETS.get(req.path);
                res.setHeader('Cache-Control', 'no-store');
                res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8');
                return res.end(fs.readFileSync(path.join(authDir, file)));
            }
            if (!config.goBaseUrl) return fail(res, 503, 'VC_AUTH_UNAVAILABLE', '登录服务暂不可用');
            if (req.path.startsWith('/auth/api/')) return await proxyAuth(req, res, req.path.slice('/auth/api/'.length));
            // ST 自己的登录、恢复与账号管理不构成第二套入口。
            if ((req.path === '/api/users' || req.path.startsWith('/api/users/'))
                && !(req.method === 'GET' && req.path === '/api/users/me')) return fail(res, 403, 'ACCESS_DENIED', '请使用账户登录入口');
            const response = await fetchImpl(`${config.goBaseUrl}/api/v1/auth/session`, {
                headers: { Accept: 'application/json', Cookie: goCookies(req.headers.cookie) },
                redirect: 'error', signal: AbortSignal.timeout(config.timeoutMs),
            });
            if (!response.ok) {
                if (response.status === 401 && req.method === 'GET' && req.path === '/') return res.redirect(303, '/auth/');
                return fail(res, response.status === 401 ? 401 : 503, 'AUTHENTICATION_REQUIRED', '请重新登录');
            }
            const identity = await response.json();
            const handle = config.accountHandles[identity.accountId];
            if (identity.deletionPending) return fail(res, 409, 'ACCOUNT_DELETION_PENDING', '账号删除处理中，聊天已暂停。');
            if (identity.nextStep !== 'ACTIVE' || identity.authenticatorEnabled !== true || identity.passwordMustChange !== false || !handle
                || !/^[1-9][0-9]*$/.test(identity.sessionId)) {
                if (req.method === 'GET' && req.path === '/') return res.redirect(303, '/auth/');
                return fail(res, 403, 'ACCESS_DENIED', '请完成登录与身份验证');
            }
            if (identity.stDataConfigured !== true) return fail(res, 503, 'VC_DATA_NOT_CONFIGURED', '聊天数据服务尚未配置');
            const user = await getUser(handle);
            if (!user?.enabled || user.handle !== handle) return fail(res, 403, 'ACCESS_DENIED', '此账号尚未绑定可用的聊天空间');
            const mismatch = req.session?.vcAccountId !== identity.accountId || req.session?.vcSessionId !== identity.sessionId || req.session?.handle !== handle;
            const canBind = req.method === 'GET' && (['/', '/auth/access'].includes(req.path) || req.path === '/csrf-token' && !req.session?.vcSessionId);
            if (mismatch && !canBind) return fail(res, 409, 'ACCOUNT_CONTEXT_CHANGED', '登录状态已变化，请重新打开聊天');
            if (canBind) {
                const registered = await fetchImpl(`${config.goBaseUrl}/api/v1/service/st/profile`, {
                    method: 'POST', headers: { Authorization: `Bearer ${config.serviceToken}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ownerAccountId: identity.accountId, handle }), redirect: 'error', signal: AbortSignal.timeout(config.timeoutMs),
                });
                const scope = registered.ok ? await registered.json() : null;
                if (scope?.ownerAccountId !== identity.accountId || scope?.handle !== handle) return fail(res, 503, 'VC_DATA_NOT_CONFIGURED', '聊天空间登记尚未完成');
            }
            if (mismatch) req.session = { handle, version: accountVersion(user), vcAccountId: identity.accountId, vcSessionId: identity.sessionId };
            if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
                if (req.headers['x-vc-expected-account-id'] !== identity.accountId || req.headers['x-vc-expected-session-id'] !== identity.sessionId) {
                    return fail(res, 409, 'ACCOUNT_CONTEXT_CHANGED', '此页面的登录状态已变化，请重新打开聊天');
                }
            }
            req.vcIdentity = { accountId: identity.accountId, sessionId: identity.sessionId, handle };
            if (accountData && !await accountData.enter(identity.accountId, handle, res)) return fail(res, 409, 'ACCOUNT_DELETION_PENDING', '账号删除处理中，聊天已暂停。');
            res.setHeader('Cache-Control', 'no-store'); res.setHeader('Vary', 'Cookie');
            if (req.method === 'GET' && req.path === '/auth/access') return res.json({ allowed: true });
            if (req.method === 'GET' && req.path === '/') {
                // 只输出非凭据十进制 ID；getRequestHeaders 在模块初始化时捕获，旧页不能冒用新 cookie。
                const meta = `<meta name="vc-account-id" content="${identity.accountId}"><meta name="vc-session-id" content="${identity.sessionId}">`;
                res.setHeader('Cache-Control', 'no-store'); res.setHeader('Vary', 'Cookie');
                res.setHeader('Content-Type', 'text/html; charset=utf-8');
                return res.end(indexHtml().replace('<head>', `<head>${meta}`)
                    .replace('<div id="preloader"></div>', STARTUP_HTML));
            }
            next();
        } catch { fail(res, 503, 'VC_AUTH_UNAVAILABLE', '登录服务暂不可用，请稍后重试'); }
    };
}
