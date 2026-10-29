// Virtual Companion ST 桥接插件 — Go 管理桥（固定路径白名单代理）。
// 许可：AGPL-3.0-only（见目录 README；ADR-0009 §3）。
// 挂载：/api/plugins/virtual-companion/go/<Go 完整路径>（S3 前端已按此写 API 模块）。
// 安全约束（W03 边界）：
//  - 仅白名单内的「方法 + 精确路径」可转发；目标地址只来自服务配置 VC_ST_GO_BASE_URL，
//    禁止任意 URL / 任意 path 代理；
//  - 只转发 vc_session / vc_csrf 两个 cookie；X-VC-CSRF-Token 映射为 Go 的 X-CSRF-Token；
//    ST 自己的 X-CSRF-Token 不透传；X-VC-Expected-Account-ID / X-VC-Expected-Session-ID 透传；
//    Origin 原样转发（Go 侧需把确切 ST 来源加入白名单）；
//  - 绝不附加 Authorization / 服务令牌 —— 管理操作必须以调用者本人的 Go 会话授权，
//    服务令牌不得提升浏览器权限；
//  - 响应体原样透传（Go writeJSON / ErrorEnvelope），不记录任何请求或响应体。

import { writeErrorResponse } from './errors.js';
import { log } from './log.js';
import { INBOX_UI_ROUTES } from './inbox-ui-routes.js';
import { STORY_UI_ROUTES } from './story-ui-routes.js';

// 路径段字符集：字母数字与有限符号；显式排除 %、/、..，防编码穿越。
const SEG = '[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,200})';
// 配置标识允许 @（如 m@chat）。仍排除 % 与 /，避免编码穿越。
const PROFILE = '[A-Za-z0-9@](?:[A-Za-z0-9@._:-]{0,200})';

// 白名单：模型设置页真实所需 + 既有会话/登录。新增路径在这里加一行并注明消费者；
// 权限判断全部由 Go 决定，本桥不做角色判定。
const ADMIN_BRIDGE_BASE = [
    { method: 'GET', path: /^\/api\/v1\/relationships$/, where: 'W08 记忆页角色实例' },
    { method: 'GET', path: /^\/api\/v1\/relationships\/[1-9][0-9]*\/memories$/, where: 'W08 记忆列表' },
    { method: 'GET', path: /^\/api\/v1\/memories\/[1-9][0-9]*(?:\/evidence)?$/, where: 'W08 记忆详情与证据' },
    { method: 'PATCH', path: /^\/api\/v1\/memories\/[1-9][0-9]*$/, where: 'W08 版本纠正' },
    { method: 'DELETE', path: /^\/api\/v1\/memories\/[1-9][0-9]*$/, where: 'W08 记忆遗忘' },
    { method: 'GET', path: /^\/api\/v1\/auth\/session$/, where: '会话核验（生成与页面）' },
    { method: 'POST', path: /^\/api\/v1\/auth\/login$/, where: '既有登录入口（合成登录，不新造平台）' },
    { method: 'POST', path: /^\/api\/v1\/auth\/reauth$/, where: '既有写入再认证（FreshReauth）' },
    { method: 'POST', path: /^\/api\/v1\/st\/bindings$/, where: 'W05 原生聊天的角色实例与会话绑定' },
    { method: 'POST', path: /^\/api\/v1\/st\/sources\/reconcile$/, where: 'W06 打开、重连与保存后的持久来源核对' },
    { method: 'POST', path: /^\/api\/v1\/st\/memory\/recall$/, where: 'W07 当前已绑定聊天的相关记忆与摘要' },
    { method: 'POST', path: /^\/api\/v1\/story\/runs$/, where: 'W12 玩家开局（固定案件）' },
    { method: 'GET', path: /^\/api\/v1\/story\/runs\/[1-9][0-9]*\/actors\/player\/view$/, where: 'W12 玩家 ActorView（只放行 player）' },
    { method: 'POST', path: /^\/api\/v1\/story\/runs\/[1-9][0-9]*\/actions$/, where: 'W14 提交行动' },
    { method: 'POST', path: /^\/api\/v1\/story\/runs\/[1-9][0-9]*\/rewind$/, where: 'W14 回档' },
    { method: 'GET', path: /^\/api\/v1\/story\/runs\/[1-9][0-9]*\/projections$/, where: 'W16 未确认投影只读补写' },
    { method: 'POST', path: /^\/api\/v1\/story\/runs\/[1-9][0-9]*\/projections\/[1-9][0-9]*\/confirm$/, where: 'W14 确认投影' },
    { method: 'POST', path: /^\/api\/v1\/story\/runs\/[1-9][0-9]*\/participants\/[a-z][a-z0-9_-]{0,63}$/, where: 'W14 陪伴入局' },
    { method: 'POST', path: /^\/api\/v1\/story\/runs\/[1-9][0-9]*\/epilogue$/, where: 'W14 结局摘要' },
    { method: 'POST', path: /^\/api\/v1\/exports(?:\/recover)?$/, where: 'W06 数据副本创建和取回' },
    { method: 'GET', path: /^\/api\/v1\/exports\/[1-9][0-9]*(?:\/download)?$/, where: 'W06 副本状态和一次性下载' },
    { method: 'GET', path: /^\/api\/v1\/admin\/providers$/, where: '供应商列表' },
    { method: 'PUT', path: new RegExp(`^/api/v1/admin/providers/${SEG}$`), where: '保存供应商（含凭据引用与 expectedRevision）' },
    { method: 'POST', path: new RegExp(`^/api/v1/admin/providers/${SEG}/models/discover$`), where: '拉取模型列表（辅助，显式操作）' },
    { method: 'POST', path: new RegExp(`^/api/v1/admin/providers/${SEG}/models/${PROFILE}/verify-tool-calls$`), where: '验证工具调用（真实调用一次该模型）' },
    { method: 'GET', path: /^\/api\/v1\/auth\/admin\/usage$/, where: '模型页用量区（只读，ADMIN 由 Go 判定）' },
    { method: 'GET', path: /^\/api\/v1\/admin\/model-purposes$/, where: '用途绑定列表' },
    { method: 'PUT', path: new RegExp(`^/api/v1/admin/model-purposes/${SEG}$`), where: '保存用途绑定' },
    { method: 'POST', path: /^\/api\/v1\/auth\/password$/, where: 'W15 账户改密' },
    { method: 'GET', path: /^\/api\/v1\/auth\/sessions$/, where: 'W15 当前会话列表' },
    { method: 'DELETE', path: /^\/api\/v1\/auth\/sessions\/[1-9][0-9]*$/, where: 'W15 撤销单个会话' },
    { method: 'POST', path: /^\/api\/v1\/auth\/sessions\/revoke-all$/, where: 'W15 撤销全部会话' },
    { method: 'POST', path: /^\/api\/v1\/auth\/logout$/, where: 'W15 登出当前会话' },
    { method: 'POST', path: /^\/api\/v1\/admin\/accounts\/[1-9][0-9]*\/authenticator-reset$/, where: 'W15 重置验证器（响应不回密钥）' },
    // 聊天页常量在扩展里。插件运行时不能跨目录导入，这里按同一路径并入。
    { method: 'GET', path: /^\/api\/v1\/inbox$/, where: 'W15 聊天页待写入会话条' },
    { method: 'PATCH', path: /^\/api\/v1\/relationships\/[1-9][0-9]*$/, where: 'W15 陪伴实例名称' },
];

function routeKey(route) {
    return `${route.method} ${String(route.path.source).replace(/\\\//g, '/')}`;
}

function mergeRoutes(base, extra) {
    const seen = new Set(base.map(routeKey));
    const out = base.slice();
    for (const route of extra) {
        const key = routeKey(route);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(route);
    }
    return out;
}

// inbox 的 claim / ack 不在 INBOX_UI_ROUTES 中，合并后仍然拒绝。
export const ADMIN_BRIDGE_ROUTES = mergeRoutes(ADMIN_BRIDGE_BASE, [...INBOX_UI_ROUTES, ...STORY_UI_ROUTES]);

const FORWARD_HEADERS = ['x-vc-expected-account-id', 'x-vc-expected-session-id'];
const FORWARD_COOKIES = new Set(['vc_session', 'vc_csrf']);

function pickCookies(cookieHeader) {
    if (!cookieHeader) return '';
    const kept = [];
    for (const pair of cookieHeader.split(';')) {
        const name = pair.split('=')[0].trim();
        if (FORWARD_COOKIES.has(name)) kept.push(pair.trim());
    }
    return kept.join('; ');
}

/**
 * @param {object} args
 * @param {{goBaseUrl: string, timeoutMs: number}} args.config
 * @param {typeof fetch} [args.fetchImpl]
 * @returns {(req: import('express').Request, res: import('express').ServerResponse) => Promise<void>}
 */
export function createAdminBridge({ config, fetchImpl = fetch }) {
    return async function adminBridgeHandler(req, res) {
        try {
            const raw = String(req.url || '');
            const path = raw.split('?')[0];
            const search = raw.includes('?') ? raw.slice(raw.indexOf('?')) : '';
            const method = String(req.method || 'GET').toUpperCase();

            const matched = ADMIN_BRIDGE_ROUTES.some((route) => route.method === method && route.path.test(path));
            if (!matched) {
                log.warn(`管理桥拒绝未登记路由：${method} ${path}`);
                writeErrorResponse(res, 404, 'VC_BRIDGE_ROUTE_NOT_ALLOWED', '该路径/方法不在管理桥白名单内');
                return;
            }
            if (!config.goBaseUrl) {
                writeErrorResponse(res, 503, 'VC_GO_NOT_CONFIGURED', '未配置 VC_ST_GO_BASE_URL，管理桥不可用');
                return;
            }

            const headers = { Accept: 'application/json' };
            const contentType = req.headers['content-type'];
            const hasBody = method !== 'GET' && method !== 'HEAD';
            if (hasBody) {
                if (contentType && !String(contentType).toLowerCase().includes('application/json')) {
                    writeErrorResponse(res, 415, 'VC_BRIDGE_BODY_UNSUPPORTED', '管理桥只转发 application/json 请求体');
                    return;
                }
                headers['Content-Type'] = 'application/json';
            }
            const vcCsrf = req.headers['x-vc-csrf-token'];
            if (typeof vcCsrf === 'string' && vcCsrf) headers['X-CSRF-Token'] = vcCsrf;
            for (const name of FORWARD_HEADERS) {
                const value = req.headers[name];
                if (typeof value === 'string' && value) headers[name.replace(/(^|-)([a-z])/g, (m) => m.toUpperCase())] = value;
            }
            const origin = req.headers.origin;
            if (typeof origin === 'string' && origin) headers.Origin = origin;
            const cookie = pickCookies(req.headers.cookie);
            if (cookie) headers.Cookie = cookie;

            let body;
            if (hasBody && req.body !== undefined && req.body !== null) {
                body = JSON.stringify(req.body);
            }

            const upstream = await fetchImpl(config.goBaseUrl + path + search, {
                method,
                headers,
                ...(body !== undefined ? { body } : {}),
                signal: AbortSignal.timeout(config.timeoutMs),
            });

            const buffer = Buffer.from(await upstream.arrayBuffer());
            res.statusCode = upstream.status;
            const respType = upstream.headers.get('content-type');
            if (respType) res.setHeader('Content-Type', respType);
            res.setHeader('Cache-Control', 'no-store');
            const cursor = upstream.headers.get('x-next-cursor');
            if (cursor) res.setHeader('X-Next-Cursor', cursor);
            for (const setCookie of upstream.headers.getSetCookie?.() ?? []) {
                res.appendHeader('Set-Cookie', setCookie);
            }
            res.end(buffer);
        } catch (error) {
            if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
                writeErrorResponse(res, 504, 'VC_GO_TIMEOUT', 'Go 服务响应超时');
                return;
            }
            log.error(`管理桥转发失败：${error?.name ?? 'unknown'}（不记录请求体）`);
            writeErrorResponse(res, 502, 'VC_GO_UNREACHABLE', 'Go 服务不可达');
        }
    };
}
