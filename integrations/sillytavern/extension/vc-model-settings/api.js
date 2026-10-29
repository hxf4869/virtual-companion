// Virtual Companion · 模型设置页 — 后端唯一边界（窄接口模块）。
// 契约：V2-W03-S2 管理契约（2026-10-28 定稿）。路径、DTO、错误码以契约为准；
// 后端形状再有变化时只改本文件，不改页面。
//
// 浏览器 → ST 同源桥（W03-S4 实现）→ Go：
//   固定前缀 /api/plugins/virtual-companion/go + 完整 Go 路径。
//   写请求携带 X-CSRF-Token（ST 原生 getRequestHeaders() 令牌）与
//   X-VC-CSRF-Token（JS 可读的 vc_csrf cookie 值）；S4 桥把后者转为 Go 的
//   X-CSRF-Token 并保留 Origin / vc cookies。不用 ST 令牌代替 Go 令牌。
//
// 会话上下文快照（core.go expectedAccount/SessionMatches，VC-R169）：
//   页面加载时经 captureSessionContext() 取一次 GET /api/v1/auth/session 的
//   accountId / sessionId（Go sessionIdentityJSON 两者均为十进制字符串，
//   accountId 可能超出 Number 安全整数——全程按字符串持有，禁止 Number()），
//   此后所有写请求携带 X-VC-Expected-Account-ID / X-VC-Expected-Session-ID。
//   不在写前静默刷新快照，也不从 cookie 自动补最新值：那会绕过 Go 的
//   跨账号 / 旧会话页防护；上下文变更只能由用户显式重新加载（页面 load）解决。
//
// Go 响应解包：writeJSON 直接输出原始 body（无 data 包裹）；
// 错误为 {code, message, details?}。

export const BRIDGE_PREFIX = '/api/plugins/virtual-companion/go';
export const GO_PREFIX = '/api/v1/admin';

let stHeadersProvider = () => ({});

// 页面生命周期内持有的会话上下文快照；null = 尚未取得（写请求就地失败，不发出去）。
let sessionContext = null;

/**
 * 由 ST 宿主入口（index.js）注入原生 getRequestHeaders；
 * harness / 独立页面注入测试桩。未注入时仅发送 Go 双提交令牌。
 */
export function setStHeadersProvider(fn) {
    stHeadersProvider = typeof fn === 'function' ? fn : () => ({});
}

function readCookie(name) {
    if (typeof document === 'undefined' || !document.cookie) return '';
    for (const part of document.cookie.split(';')) {
        const idx = part.indexOf('=');
        if (idx < 0) continue;
        if (part.slice(0, idx).trim() === name) {
            return decodeURIComponent(part.slice(idx + 1).trim());
        }
    }
    return '';
}

function writeHeaders(write) {
    const headers = { 'Content-Type': 'application/json' };
    try {
        Object.assign(headers, stHeadersProvider());
    } catch {
        // ST 令牌不可用时仍发送 Go 侧令牌，由服务端判定。
    }
    const vcCsrf = readCookie('vc_csrf');
    if (vcCsrf) {
        headers['X-VC-CSRF-Token'] = vcCsrf;
    }
    if (write && sessionContext) {
        headers['X-VC-Expected-Account-ID'] = sessionContext.accountId;
        headers['X-VC-Expected-Session-ID'] = sessionContext.sessionId;
    }
    return headers;
}

export class ApiError extends Error {
    constructor(kind, message, { status = 0, code = '', details = null } = {}) {
        super(message);
        this.name = 'ApiError';
        this.kind = kind;
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

function classify(status, body) {
    const code = body?.code ?? '';
    const details = body?.details ?? null;
    if (status === 401) {
        return new ApiError('unauthenticated', '尚未登录或登录已过期，请先登录 Go 服务后再操作。', { status, code, details });
    }
    if (status === 403) {
        return new ApiError('forbidden', '没有管理权限，或需要重新验证身份后重试。', { status, code, details });
    }
    if (status === 404) {
        return new ApiError('not-found', '请求的资源不存在，可能已被删除。', { status, code, details });
    }
    if (status === 409 && code === 'REVISION_CONFLICT') {
        return new ApiError('conflict-revision', '这段配置已在另一处更新。', { status, code, details });
    }
    if (status === 409 && code === 'ACCOUNT_CONTEXT_CHANGED') {
        return new ApiError('context-changed', '登录会话已变更（可能在别处登录或退出），本次写入未执行。', { status, code, details });
    }
    if (status === 409 && code === 'MODEL_PROFILE_IN_USE') {
        return new ApiError('profile-in-use', '该模型配置仍被用途绑定引用。', { status, code, details });
    }
    if (status === 409 && code === 'MODEL_NO_ELIGIBLE_DEPLOYMENT') {
        return new ApiError('no-eligible', '所选模型当前不可用，不能完成该操作。', { status, code, details });
    }
    if (status === 400 || code === 'INVALID_REQUEST') {
        return new ApiError('invalid', '请求内容未通过校验，请检查表单。', { status, code, details });
    }
    if (status >= 500) {
        return new ApiError('server', '模型配置服务暂时不可用，请稍后重试。', { status, code, details });
    }
    return new ApiError('error', body?.message || '请求失败。', { status, code, details });
}

async function request(method, goPath, body, { page = false } = {}) {
    const write = method !== 'GET' && method !== 'HEAD';
    if (write && !sessionContext) {
        // 快照未取得前不发写请求：发出去也必然被 Go 以 409 拒绝，
        // 就地失败给出可指引重新加载的错误形状。
        throw new ApiError('context-changed', '页面会话上下文缺失，无法发起写入；请重新加载页面。', {
            status: 0,
            code: 'VC_SESSION_CONTEXT_MISSING',
        });
    }
    let response;
    try {
        const accountDelete = goPath === '/api/v1/auth/account';
        const headers = writeHeaders(write);
        if (accountDelete) headers['X-CSRF-Token'] = readCookie('vc_csrf');
        response = await fetch(accountDelete ? '/auth/api/account' : `${BRIDGE_PREFIX}${goPath}`, {
            method,
            headers,
            credentials: 'same-origin',
            cache: 'no-store',
            body: body === undefined ? undefined : JSON.stringify(body),
        });
    } catch (err) {
        if (err instanceof ApiError) throw err;
        throw new ApiError('network', '暂时无法连接模型配置服务，请检查服务状态后重试。', { status: 0 });
    }
    let data = null;
    const text = await response.text();
    if (text) {
        try {
            data = JSON.parse(text);
        } catch {
            data = null;
        }
    }
    if (!response.ok) {
        const error = classify(response.status, data ?? {});
        if (Array.isArray(data?.pendingDomains)) error.pendingDomains = data.pendingDomains;
        throw error;
    }
    return page ? { items: data, nextCursor: response.headers.get('X-Next-Cursor') || null } : data;
}

/**
 * GET /api/v1/auth/session → 捕获并持有本页的会话上下文快照。
 * 返回 {accountId, sessionId}（十进制字符串原样；accountId 可能超出
 * Number 安全整数，全程字符串处理）。只在页面 load / 显式重新加载时调用，
 * 绝不在写请求前静默刷新——快照过期应由服务端 409 拒绝，由用户显式重载解决。
 */
/** GET /api/v1/auth/admin/usage?month=YYYY-MM。只读；非 ADMIN 由 Go 返回 403。 */
export async function fetchUsageSummary(month) {
    const query = month ? `?month=${encodeURIComponent(month)}` : '';
    return request('GET', `/api/v1/auth/admin/usage${query}`);
}

export async function captureSessionContext() {
    const data = await request('GET', '/api/v1/auth/session');
    const accountId = data?.accountId;
    const sessionId = data?.sessionId;
    if (typeof accountId !== 'string' || !/^\d+$/.test(accountId)
        || typeof sessionId !== 'string' || !/^\d+$/.test(sessionId)) {
        throw new ApiError('error', '会话信息返回异常，请重新加载页面。', {
            status: 200,
            code: 'VC_SESSION_CONTEXT_INVALID',
        });
    }
    sessionContext = { accountId, sessionId };
    return { accountId, sessionId };
}

/** GET /api/v1/admin/providers → AdminModelProvider[] */
export function fetchProviders() {
    return request('GET', `${GO_PREFIX}/providers`);
}

/** POST /api/v1/st/bindings → 稳定实例/会话绑定（ID 保持十进制字符串）。 */
export function resolveSTBinding(payload) {
    return request('POST', '/api/v1/st/bindings', payload);
}

export function recallSTMemory(payload) {
    return request('POST', '/api/v1/st/memory/recall', payload);
}

export function reconcileSTSources(chatIdentities) {
    return request('POST', '/api/v1/st/sources/reconcile', { chatIdentities });
}

/** PUT /api/v1/admin/providers/{providerId} → {ok, revision}；body 含 expectedRevision / credential / clearCredential / models 快照 */
export function saveProvider(providerId, payload) {
    return request('PUT', `${GO_PREFIX}/providers/${encodeURIComponent(providerId)}`, payload);
}

/** GET /api/v1/admin/model-purposes → 固定 6 条用途绑定 */
export function fetchModelPurposes() {
    return request('GET', `${GO_PREFIX}/model-purposes`);
}

/** PUT /api/v1/admin/model-purposes/{purpose} → 更新后的绑定；body {providerId?, profileKey?, state, expectedRevision} */
export function saveModelPurpose(purpose, payload) {
    return request('PUT', `${GO_PREFIX}/model-purposes/${encodeURIComponent(purpose)}`, payload);
}

/**
 * POST /api/v1/admin/providers/{providerId}/models/discover
 * 显式操作（仅用户点击触发；保存流程绝不自动调用）。
 * body 沿用现有 discover 接口 {protocol, baseUrl, credential?}；credential 只带用户本次输入。
 */
export function discoverProviderModels(providerId, { protocol, baseUrl, credential }) {
    const body = { protocol, baseUrl };
    if (credential) {
        body.credential = credential;
    }
    return request('POST', `${GO_PREFIX}/providers/${encodeURIComponent(providerId)}/models/discover`, body);
}

/**
 * POST /api/v1/auth/reauth → {ok:true}；body {password}。
 * 写操作 403（FreshReauth 过期）后的最小再验证；成功后由页面重试保存。
 * 请求形状依据 backend/internal/httpapi/auth.go handleReauth（已认证 + CSRF 双提交）。
 */
export function reauth(password) {
    return request('POST', '/api/v1/auth/reauth', { password });
}

export const fetchSession = () => request('GET', '/api/v1/auth/session');
export const changePassword = (currentPassword, newPassword) => request('POST', '/api/v1/auth/password', { currentPassword, newPassword });
export const listSessions = () => request('GET', '/api/v1/auth/sessions');
export const revokeSession = (sessionId) => request('DELETE', `/api/v1/auth/sessions/${encodeURIComponent(sessionId)}`);
export const logoutCurrent = () => request('POST', '/api/v1/auth/logout', {});
export const resetAuthenticator = (accountId) => request('POST', `/api/v1/admin/accounts/${encodeURIComponent(accountId)}/authenticator-reset`, {});

export const createDataExport = (currentPassword) => request('POST', '/api/v1/exports', { currentPassword });
export const recoverDataExport = (currentPassword) => request('POST', '/api/v1/exports/recover', { currentPassword });
export const getDataExport = (id) => request('GET', `/api/v1/exports/${encodeURIComponent(id)}`);
export const deleteOwnAccount = (currentPassword) => request('DELETE', '/api/v1/auth/account', { currentPassword });
export async function downloadDataExport(url) {
    if (!/^\/api\/v1\/exports\/[1-9][0-9]*\/download\?token=[A-Za-z0-9_-]+$/.test(url)) throw new ApiError('invalid', '下载链接无效');
    const response = await fetch(`${BRIDGE_PREFIX}${url}`, { headers: writeHeaders(false), credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) throw classify(response.status, {});
    return response.blob();
}

// UI-P03 沿用 Go 的 memoryId / summary / time.*，不另建响应信封。
export const fetchRelationships = () => request('GET', '/api/v1/relationships');
export function fetchMemories(relationshipId, filters = {}) {
    const query = new URLSearchParams();
    for (const key of ['q', 'status', 'eventDateFrom', 'eventDateTo', 'cursor', 'limit']) {
        if (filters[key] !== undefined && filters[key] !== null && filters[key] !== '') query.set(key, String(filters[key]));
    }
    return request('GET', `/api/v1/relationships/${encodeURIComponent(relationshipId)}/memories?${query}`, undefined, { page: true });
}
export const fetchMemory = (id) => request('GET', `/api/v1/memories/${encodeURIComponent(id)}`);
export const fetchMemoryEvidence = (id) => request('GET', `/api/v1/memories/${encodeURIComponent(id)}/evidence`);
export const correctMemory = (id, { summary, expectedVersion }) => request('PATCH', `/api/v1/memories/${encodeURIComponent(id)}`, { summary, expectedVersion });
export const forgetMemory = (id) => request('DELETE', `/api/v1/memories/${encodeURIComponent(id)}`);

const STORY_DECIMAL_ID = /^[1-9][0-9]{0,18}$/;
const STORY_WORLD_VERSION = /^(0|[1-9][0-9]{0,18})$/;

function requireStoryId(value, pattern) {
    if (typeof value !== 'string' || !pattern.test(value)) {
        throw new ApiError('invalid', '请求内容未通过校验，请检查表单。', { status: 0, code: 'INVALID_REQUEST' });
    }
}

/** POST /api/v1/story/runs。只开固定案件，不提交行动。 */
export function startStoryRun(conversationId) {
    requireStoryId(conversationId, STORY_DECIMAL_ID);
    return request('POST', '/api/v1/story/runs', { conversationId, caseId: 'rainy-inn-v1' });
}

/** GET 玩家 ActorView。actor 固定为 player，不读取其他角色。 */
export function fetchStoryActorView({ runId, branchId, worldVersion } = {}) {
    const version = typeof worldVersion === 'number' && Number.isSafeInteger(worldVersion) ? String(worldVersion) : worldVersion;
    requireStoryId(runId, STORY_DECIMAL_ID);
    requireStoryId(branchId, STORY_DECIMAL_ID);
    requireStoryId(version, STORY_WORLD_VERSION);
    const query = new URLSearchParams({ branchId, worldVersion: version });
    return request('GET', `/api/v1/story/runs/${runId}/actors/player/view?${query}`);
}

/** 剧情写接口与开局共用会话头。request 保持模块私有。 */
export function storyRequest(method, goPath, body) {
    return request(method, goPath, body);
}
