// Virtual Companion ST 桥接插件 — Go 服务端客户端（受控取用 + 会话核验）。
// 许可：AGPL-3.0-only（见目录 README；ADR-0009 §3）。
// 约束（W03 已定契约）：
//  - 受控取用 POST /api/v1/service/model-purposes/{purpose}/resolve 仅服务端调用，
//    Bearer VC_ST_PLUGIN_SERVICE_TOKEN，请求绝不携带 Origin（Go 对带 Origin 的取用拒绝 403）；
//  - 管理桥绝不使用该令牌；本模块不打印任何响应体/凭据。

import { BridgeError } from './errors.js';

async function goFetch(config, path, init = {}) {
    if (!config.goBaseUrl) {
        throw new BridgeError(503, 'VC_GO_NOT_CONFIGURED', '未配置 VC_ST_GO_BASE_URL，无法访问 Go 服务');
    }
    const timeout = AbortSignal.timeout(config.timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    return fetch(config.goBaseUrl + path, { ...init, signal });
}

function serviceHeaders(config) {
    if (!config.serviceToken) {
        throw new BridgeError(503, 'VC_SERVICE_TOKEN_MISSING', '未配置 VC_ST_PLUGIN_SERVICE_TOKEN，受控取用通道不可用');
    }
    return {
        Authorization: `Bearer ${config.serviceToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
    };
}

async function readJsonResponse(res) {
    const text = await res.text();
    let json = null;
    try {
        json = text ? JSON.parse(text) : null;
    } catch { /* 保持 null，按状态码处理 */ }
    return { status: res.status, ok: res.ok, json, text, headers: res.headers };
}

/** 服务通道预留。返回状态与 JSON。调用方只接受契约 200。不携带 Origin。 */
export async function reserveModelUsage(config, payload) {
    const res = await goFetch(config, '/api/v1/service/model-usage/reservations', {
        method: 'POST',
        headers: serviceHeaders(config),
        body: JSON.stringify(payload),
    });
    return readJsonResponse(res);
}

/** 单次结算。同一 reservationId 再次结算由 Go 返回 idempotent:true，金额保持第一次。重试在 model-usage.js。 */
export async function settleModelUsage(config, reservationId, payload) {
    const res = await goFetch(config, `/api/v1/service/model-usage/reservations/${encodeURIComponent(reservationId)}/settle`, {
        method: 'POST',
        headers: serviceHeaders(config),
        body: JSON.stringify(payload),
    });
    const parsed = await readJsonResponse(res);
    if (!parsed.ok) {
        throw new BridgeError(502, 'VC_USAGE_SETTLE_FAILED', '用量结算失败');
    }
    return parsed.json;
}

/** 单次取消。disposition 为 NOT_SENT（未发送）或 UNKNOWN（已发送但没有可信 usage）。重试在 model-usage.js。 */
export async function cancelModelUsage(config, reservationId, payload) {
    const res = await goFetch(config, `/api/v1/service/model-usage/reservations/${encodeURIComponent(reservationId)}/cancel`, {
        method: 'POST',
        headers: serviceHeaders(config),
        body: JSON.stringify(payload),
    });
    const parsed = await readJsonResponse(res);
    if (!parsed.ok) {
        throw new BridgeError(502, 'VC_USAGE_CANCEL_FAILED', '用量预留取消失败');
    }
    return parsed.json;
}

/**
 * 浏览器会话执行工具。Cookie + CSRF + Origin，不使用服务令牌。
 * 返回原始响应文本，调用方不得改写成另一份「已完成」。
 */
export async function executeSessionTool(config, { cookieHeader, origin, csrfToken, expectedAccountId, expectedSessionId, payload, signal }) {
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (cookieHeader) headers.Cookie = cookieHeader;
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
    if (origin) headers.Origin = origin;
    if (expectedAccountId) headers['X-VC-Expected-Account-ID'] = expectedAccountId;
    if (expectedSessionId) headers['X-VC-Expected-Session-ID'] = expectedSessionId;
    const res = await goFetch(config, '/api/v1/st/tools/execute', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        ...(signal ? { signal } : {}),
    });
    return readJsonResponse(res);
}

/** 用浏览器同主机携带的 vc_session 核验真实 Owner；GET 无需 CSRF。返回 sessionIdentityJSON。 */
export async function authSession(config, { cookieHeader }) {
    const headers = { Accept: 'application/json' };
    if (cookieHeader) headers.Cookie = cookieHeader;
    const res = await goFetch(config, '/api/v1/auth/session', { method: 'GET', headers });
    if (res.status === 401) {
        throw new BridgeError(401, 'VC_GO_SESSION_REQUIRED', '尚未登录 Go 会话（vc_session）；请先完成 Go 登录后再生成');
    }
    if (!res.ok) {
        throw new BridgeError(502, 'VC_GO_SESSION_UNAVAILABLE', `Go 会话核验失败（HTTP ${res.status}）`);
    }
    const session = await res.json();
    if (!session?.accountId) {
        throw new BridgeError(502, 'VC_GO_SESSION_INVALID', 'Go 会话响应缺少 accountId，拒绝生成');
    }
    return session;
}

/**
 * 受控取用。每次实时读库；Go 对 revision 不符返回 409 REVISION_CONFLICT。
 * @returns {Promise<{json: object, status: number}>}
 */
export async function resolveModelPurpose(config, { purpose, ownerAccountId, providerId, profileKey, providerRevision, bindingRevision }) {
    if (!config.serviceToken) {
        throw new BridgeError(503, 'VC_SERVICE_TOKEN_MISSING', '未配置 VC_ST_PLUGIN_SERVICE_TOKEN，受控取用通道不可用');
    }
    const body = { ownerAccountId };
    if (providerId !== undefined) body.providerId = providerId;
    if (profileKey !== undefined) body.profileKey = profileKey;
    if (providerRevision !== undefined) body.providerRevision = providerRevision;
    if (bindingRevision !== undefined) body.bindingRevision = bindingRevision;
    const res = await goFetch(config, `/api/v1/service/model-purposes/${encodeURIComponent(purpose)}/resolve`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${config.serviceToken}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
        },
        body: JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try {
        json = text ? JSON.parse(text) : null;
    } catch { /* 保持 null，按状态码处理 */ }
    const code = json?.code ?? json?.error?.code ?? null;
    if (res.status === 409 && code === 'REVISION_CONFLICT') {
        throw new BridgeError(409, 'VC_REVISION_CONFLICT', '模型配置已在 Go 侧更新（revision 不符）；请重新加载模型设置后再试');
    }
    if (res.status === 409 && code === 'MODEL_NO_ELIGIBLE_DEPLOYMENT') {
        throw new BridgeError(409, 'VC_MODEL_NO_ELIGIBLE_DEPLOYMENT', '当前绑定没有可用的模型部署（禁用/撤销或不满足条件）；请检查模型设置');
    }
    if (!res.ok) {
        throw new BridgeError(502, 'VC_RESOLVE_FAILED', `Go 受控取用失败（HTTP ${res.status}${code ? `，${code}` : ''}）`);
    }
    if (!json?.provider || !json?.model || !json?.provider?.protocol) {
        throw new BridgeError(502, 'VC_RESOLVE_INVALID', 'Go 受控取用响应缺少 provider/model 结构');
    }
    return json;
}
