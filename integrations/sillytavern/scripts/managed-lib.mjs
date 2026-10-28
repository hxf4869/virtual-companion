// V2-W03 受管端到端验收 — 共享夹具库（合成材料、精确断言、HTTP 客户端、场景表）。
// 许可：AGPL-3.0-only（见 integrations/sillytavern/README；ADR-0009 §3）。
//
// 本模块只包含可独立验证的纯逻辑与本地 HTTP 客户端：
//   - 合成材料：全部随机生成（密钥/令牌/DSN 口令），绝不读取真实 .env 或凭据；
//   - 精确断言：ownerAccountId 十进制字符串按 BigInt 语义精确比对（9007199254740993
//     与其 float 邻值必须可区分），任何 Number() 转换路径都被禁止；
//   - SSE 解析：供三协议流式断言复用；
//   - Go/ST HTTP 客户端：真实 HTTP 形状（cookie、CSRF 双提交、期望头、服务令牌）；
//   - 场景表：accept-managed 的 --filter 依赖闭包来源。
import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// 合成材料（随机生成；不读任何真实凭据）
// ---------------------------------------------------------------------------

/** 合成上游 API Key（与 fixture provider 的 expectKey 配对）。 */
export function synthApiKey() {
    return `vc03m-${crypto.randomBytes(18).toString('base64url')}`;
}

/** 合成服务令牌（>=32 字节，满足 Go VC_ST_PLUGIN_SERVICE_TOKEN 校验）。 */
export function synthServiceToken() {
    return `vc03m-st-${crypto.randomBytes(24).toString('base64url')}`;
}

/** 合成 AES-256 REST key（标准 padded base64，32 字节，满足 VC_CRYPTO_REST_KEY 校验）。 */
export function synthRestKey() {
    return crypto.randomBytes(32).toString('base64');
}

/** 合成数据库口令 / OwnerBinding secret（>=32 字节）。 */
export function synthSecret(bytes = 32) {
    return crypto.randomBytes(bytes).toString('base64url');
}

/**
 * 复刻 backend/internal/auth NewSessionToken：raw = base64url(32B)，hash = sha256(raw) hex。
 * raw 只进进程内存与请求 cookie，绝不写日志/文件。
 */
export function synthSessionToken() {
    const raw = crypto.randomBytes(32).toString('base64url');
    return { raw, hash: crypto.createHash('sha256').update(raw).digest('hex') };
}

/** 合成 CSRF 双提交值（64 hex）。 */
export function synthCsrfToken() {
    return crypto.randomBytes(32).toString('hex');
}

// ---------------------------------------------------------------------------
// 精确 ID 断言（十进制字符串语义；JS safe-integer 之上必须可区分）
// ---------------------------------------------------------------------------

/** 十进制字符串严格相等（去空白；非法十进制一律不等）。不做任何 Number() 转换。 */
export function decimalStringsEqual(a, b) {
    const norm = (v) => (typeof v === 'string' ? v.trim() : null);
    const x = norm(a);
    const y = norm(b);
    if (x === null || y === null) return false;
    if (!/^-?\d+$/.test(x) || !/^-?\d+$/.test(y)) return false;
    return BigInt(x) === BigInt(y);
}

/**
 * 断言 ownerAccountId 为精确期望值（十进制字符串）。actual 允许 string；
 * number 类型在此直接失败——数字路径就是丢精度的来源（9007199254740993 会变成 ...992）。
 */
export function assertExactAccountId(actual, expectedDecimalString, label = 'ownerAccountId') {
    const okPass = typeof actual === 'string' && decimalStringsEqual(actual, expectedDecimalString);
    if (!okPass) {
        throw new Error(`${label} 精确比对失败：期望十进制字符串 ${expectedDecimalString}，实际 ${typeof actual} ${String(actual)}`);
    }
    return true;
}

/** 断言响应为 Go 错误信封且 code 匹配（{code, message, details?}）。 */
export function assertApiError(status, body, expectedCode, label = '') {
    const code = body && typeof body === 'object' ? body.code : undefined;
    if (typeof code !== 'string' || code !== expectedCode) {
        throw new Error(`${label} 错误信封不匹配：HTTP ${status}，期望 code=${expectedCode}，实际 ${JSON.stringify(body).slice(0, 200)}`);
    }
    if (typeof body.message !== 'string') {
        throw new Error(`${label} 错误信封缺少 message`);
    }
    return true;
}

// ---------------------------------------------------------------------------
// SSE 解析（text/event-stream → [{event, data:object}]；容忍无 event: 行）
// ---------------------------------------------------------------------------

export function parseSSEText(text) {
    const out = [];
    for (const block of String(text).split(/\r?\n\r?\n/)) {
        if (!block.trim()) continue;
        let event = null;
        const dataLines = [];
        for (const line of block.split(/\r?\n/)) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
        }
        if (dataLines.length === 0) continue;
        const dataText = dataLines.join('\n');
        if (dataText === '[DONE]') {
            out.push({ event: event || 'done', data: '[DONE]' });
            continue;
        }
        let data;
        try {
            data = JSON.parse(dataText);
        } catch {
            data = dataText;
        }
        out.push({ event: event || 'message', data });
    }
    return out;
}

/** 依 event.type 收集 Responses SSE 事件序（无 event 行时按 data.type）。 */
export function responsesEventTypes(events) {
    return events.map((e) => e.data?.type || e.event);
}

/** 拼接 chat chunk 流的 content / tool_calls arguments / usage。 */
export function collectChatStream(events) {
    const content = [];
    const toolCalls = new Map();
    let finish = null;
    let usage = null;
    let sawDone = false;
    for (const { data } of events) {
        if (data === '[DONE]') { sawDone = true; continue; }
        const delta = data?.choices?.[0]?.delta;
        if (typeof delta?.content === 'string') content.push(delta.content);
        if (Array.isArray(delta?.tool_calls)) {
            for (const call of delta.tool_calls) {
                const cur = toolCalls.get(call.index) || { id: '', name: '', arguments: '' };
                if (call.id) cur.id = call.id;
                if (call.function?.name) cur.name = call.function.name;
                if (typeof call.function?.arguments === 'string') cur.arguments += call.function.arguments;
                toolCalls.set(call.index, cur);
            }
        }
        if (data?.choices?.[0]?.finish_reason) finish = data.choices[0].finish_reason;
        if (data?.usage) usage = data.usage;
    }
    return { content: content.join(''), toolCalls: [...toolCalls.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v), finish, usage, sawDone };
}

/** 拼接 Anthropic SSE：text、tool_use input 分片、stop_reason、usage。 */
export function collectAnthropicStream(events) {
    const text = [];
    const tools = [];
    let stopReason = null;
    let usage = null;
    for (const { data } of events) {
        if (data?.type === 'content_block_delta' && data.delta?.type === 'text_delta') text.push(data.delta.text);
        if (data?.type === 'content_block_start' && data.content_block?.type === 'tool_use') {
            tools.push({ id: data.content_block.id, name: data.content_block.name, inputParts: [] });
        }
        if (data?.type === 'content_block_delta' && data.delta?.type === 'input_json_delta') {
            tools.at(-1)?.inputParts.push(data.delta.partial_json);
        }
        if (data?.type === 'message_delta') {
            stopReason = data.delta?.stop_reason ?? stopReason;
            if (data.usage) usage = data.usage;
        }
        if (data?.type === 'message_start' && data.message?.usage) {
            usage = { ...(usage || {}), input_tokens: data.message.usage.input_tokens };
        }
    }
    return {
        content: text.join(''),
        tools: tools.map((t) => ({ id: t.id, name: t.name, input: t.inputParts.join('') })),
        stopReason, usage,
    };
}

/** 拼接 Responses SSE（经 responsesEventTypes 断言事件序后取内容）。 */
export function collectResponsesStream(events) {
    const text = [];
    const calls = new Map();
    let completed = null;
    for (const { data } of events) {
        if (data?.type === 'response.output_text.delta') text.push(data.delta);
        if (data?.type === 'response.function_call_arguments.delta') {
            const cur = calls.get(data.item_id) || { name: '', arguments: '' };
            cur.arguments += data.delta ?? '';
            calls.set(data.item_id, cur);
        }
        if (data?.type === 'response.output_item.added' && data.item?.type === 'function_call') {
            calls.set(data.item.id, { name: data.item.name ?? '', arguments: '' });
        }
        if (data?.type === 'response.completed') completed = data.response;
    }
    return {
        content: text.join(''),
        calls: [...calls.entries()].map(([id, v]) => ({ id, ...v })),
        completedUsage: completed?.usage ?? null,
        completedOutput: completed?.output ?? null,
    };
}

// ---------------------------------------------------------------------------
// Go HTTP 客户端（真实形状：cookie 会话、CSRF 双提交、期望头、服务令牌通道）
// ---------------------------------------------------------------------------

/**
 * 管理面客户端：浏览器（经桥）看到的同款请求形状，由脚本直接对 Go 发出。
 * 写请求自动携带 X-CSRF-Token / X-VC-Expected-Account-ID / X-VC-Expected-Session-ID；
 * 所有请求携带 origin（Go 的 auth.AllowOrigin 拒绝空 Origin，必须命中允许列表；
 * 传 ST origin = 浏览器经 ST 同源桥访问 Go 的真实来源）。
 * @param {{baseUrl: string, origin: string, session: {vcSession: string, vcCsrf: string, accountId: string, sessionId: string}}} args
 */
export function createGoAdminClient({ baseUrl, session, origin }) {
    async function call(method, path, body) {
        const headers = { Accept: 'application/json' };
        if (origin) headers.Origin = origin;
        const write = method !== 'GET' && method !== 'HEAD';
        if (write) {
            headers['Content-Type'] = 'application/json';
            headers['X-CSRF-Token'] = session.vcCsrf;
            headers['X-VC-Expected-Account-ID'] = session.accountId;
            headers['X-VC-Expected-Session-ID'] = session.sessionId;
        }
        headers.Cookie = `vc_session=${session.vcSession}; vc_csrf=${session.vcCsrf}`;
        const res = await fetch(baseUrl + path, {
            method,
            headers,
            ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
        const text = await res.text();
        let json = null;
        try {
            json = text ? JSON.parse(text) : null;
        } catch {
            json = null;
        }
        return { status: res.status, ok: res.ok, json, text };
    }
    return {
        call,
        listProviders: () => call('GET', '/api/v1/admin/providers'),
        saveProvider: (providerId, body) => call('PUT', `/api/v1/admin/providers/${encodeURIComponent(providerId)}`, body),
        discover: (providerId, body) => call('POST', `/api/v1/admin/providers/${encodeURIComponent(providerId)}/models/discover`, body),
        listPurposes: () => call('GET', '/api/v1/admin/model-purposes'),
        savePurpose: (purpose, body) => call('PUT', `/api/v1/admin/model-purposes/${encodeURIComponent(purpose)}`, body),
        sessionIdentity: () => call('GET', '/api/v1/auth/session'),
        reauth: (password) => call('POST', '/api/v1/auth/reauth', { password }),
    };
}

/**
 * 服务通道受控取用：POST /api/v1/service/model-purposes/{purpose}/resolve，
 * Bearer 服务令牌、绝不携带 Origin（与 server-plugin go-client 同形状）。
 */
export async function serviceResolve({ baseUrl, serviceToken, body, fetchImpl = fetch }) {
    const res = await fetchImpl(`${baseUrl}/api/v1/service/model-purposes/${encodeURIComponent(body.purpose)}/resolve`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${serviceToken}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
        },
        body: JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try {
        json = text ? JSON.parse(text) : null;
    } catch {
        json = null;
    }
    return { status: res.status, ok: res.ok, json };
}

// ---------------------------------------------------------------------------
// ST HTTP 客户端（/generate 真实端点 + 通用 call + CSRF）
// ---------------------------------------------------------------------------

export function createStClient({ baseUrl, fetchImpl = fetch, extraCookies, expectedIdentity }) {
    const pageIdentity = expectedIdentity ? Object.freeze({ accountId: expectedIdentity.accountId, sessionId: expectedIdentity.sessionId }) : null;
    // ST 1.19 用 cookie-session（server-main.js）+ csrf-sync 同步模式：
    // 会话内容序列化进 cookie 本身，cookie 名为 `session-<sha256(hostname).slice(0,8)>`
    // （users.js getCookieSessionName，随宿主机名变化），签名另发 `<name>.sig` cookie；
    // 不是 express-session 的 connect.sid。csrf-sync 要求 POST 的 x-csrf-token 头与
    // req.session.csrfToken 严格相等，因此必须把 /csrf-token 响应的全部 Set-Cookie
    // （会话 cookie + .sig）原样回带，不能按固定 cookie 名挑拣。
    // extraCookies：追加的浏览器同源 cookie（如 Go 会话 vc_session/vc_csrf）——生产链路里
    // 浏览器经 ST 同源桥持有 Go 会话，generate 请求会一并带上，桥的 pickSessionCookies
    // 从中取 vc_session/vc_csrf 做 Go 会话核验（generate-bridge.js）。
    // W05：受管栈中 /csrf-token 也在 host-auth 之后，GET 本身必须携带 Go 会话 cookie（extraCookies）。
    // expectedIdentity：创建时传入的页面身份副本（页面 meta vc-account-id / vc-session-id 的值）；
    // 不安全请求固定携带 X-VC-Expected-Account-ID / X-VC-Expected-Session-ID，值冻结于创建时刻，
    // 绝不依据后续响应或新 cookie 自动换身份——会话漂移必须以 409 暴露给调用方处理。
    let csrf = null;
    const cookieJar = new Map();
    function absorbSetCookies(res) {
        const setCookies = typeof res.headers?.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
        for (const line of setCookies) {
            const m = /^\s*([^=;,]+)=([^;]*)/.exec(line);
            if (m) cookieJar.set(m[1].trim(), m[2]);
        }
    }
    /** ST 签名 cookie jar 与追加的 Go 会话 cookie 统一拼接（ensureCsrf / generate / call 复用）。 */
    function joinCookies() {
        const parts = [...cookieJar].map(([n, v]) => `${n}=${v}`);
        if (extraCookies) parts.push(extraCookies);
        return parts.length > 0 ? parts.join('; ') : null;
    }
    /** 不安全请求携带冻结的期望身份双头（host-auth 对非 GET/HEAD/OPTIONS 强制双头一致）。 */
    function applyExpectedIdentity(headers) {
        if (pageIdentity) {
            headers['X-VC-Expected-Account-ID'] = pageIdentity.accountId;
            headers['X-VC-Expected-Session-ID'] = pageIdentity.sessionId;
        }
        return headers;
    }
    async function ensureCsrf() {
        if (csrf) return csrf;
        const headers = {};
        const cookie = joinCookies();
        if (cookie) headers.Cookie = cookie;
        const res = await fetchImpl(`${baseUrl}/csrf-token`, { headers });
        const j = await res.json();
        csrf = j.token;
        if (!csrf) throw new Error('ST /csrf-token 未返回 token');
        absorbSetCookies(res);
        return csrf;
    }
    /**
     * 真实 ST 生成端点（upstream src/endpoints/backends/chat-completions.js 的 /generate）。
     * body 形如浏览器请求：{chat_completion_source, model, custom_url|reverse_proxy, messages, ...}。
     * stream:true 时返回 {status, res} 供逐块消费/中断；否则返回 {status, json, text}。
     */
    async function generate(body, { signal } = {}) {
        const token = await ensureCsrf();
        const headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': token };
        applyExpectedIdentity(headers);
        const cookie = joinCookies();
        if (cookie) headers.Cookie = cookie;
        const res = await fetchImpl(`${baseUrl}/api/backends/chat-completions/generate`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            ...(signal ? { signal } : {}),
        });
        if (body.stream === true) return { status: res.status, res };
        const text = await res.text();
        let json = null;
        try {
            json = text ? JSON.parse(text) : null;
        } catch {
            json = null;
        }
        return { status: res.status, ok: res.ok, json, text };
    }
    /**
     * 通用受管 ST 测试客户端入口（任意原生端点）：GET/HEAD 懒 csrf、只带 cookie；
     * 不安全方法自动补 ST CSRF 双提交与冻结期望身份双头。返回 {status, ok, json, text}
     * （非 JSON 正文 json=null）；不打印请求/响应正文与任何凭据。
     */
    async function call(method, path, body, { signal } = {}) {
        const headers = { Accept: 'application/json' };
        const multipart = body instanceof FormData;
        const unsafe = method !== 'GET' && method !== 'HEAD';
        if (unsafe) {
            const token = await ensureCsrf();
            if (!multipart) headers['Content-Type'] = 'application/json';
            headers['X-CSRF-Token'] = token;
            applyExpectedIdentity(headers);
        }
        const cookie = joinCookies();
        if (cookie) headers.Cookie = cookie;
        const res = await fetchImpl(baseUrl + path, {
            method,
            headers,
            ...(body !== undefined ? { body: multipart ? body : JSON.stringify(body) } : {}),
            ...(signal ? { signal } : {}),
        });
        const text = await res.text();
        let json = null;
        try {
            json = text ? JSON.parse(text) : null;
        } catch {
            json = null;
        }
        return { status: res.status, ok: res.ok, json, text };
    }
    return { generate, ensureCsrf, call };
}

// ---------------------------------------------------------------------------
// 场景表（--filter 依赖闭包；改 id 需同步文档与主会话串联说明）
// ---------------------------------------------------------------------------

/** accept-managed 的验收场景注册表。needs 声明运行依赖，编排按需补齐。 */
export const SCENES = [
    { id: 'memorycore-native', title: 'W08 受控 MemoryCore 固定源码、SQLite、范围与本机 embedding', needs: ['memorycore'], default: false },
    { id: 'memorycore-foundation', title: 'W08 MemoryCore 固定源码基础服务、鉴权、重启与数据保留', needs: ['memorycore'], default: false },
    { id: 'login-shape', title: '合成 Owner 登录请求形状（真实 POST /api/v1/auth/login）', needs: ['go'], default: true },
    { id: 'catalog-admin', title: 'Go 侧建 provider/模型/用途绑定 + UI03 API 面（保存/读回/Key 三态/独立用途/409 保留草稿）', needs: ['go', 'fixture'], default: true },
    { id: 'zero-upstream-on-save', title: '保存与仅配置投影零上游请求（fixture 计数为 0）', needs: ['go', 'fixture'], default: true },
    { id: 'service-resolve', title: '受控取用精确 ID/revision 冲突/邻值拒绝', needs: ['catalog'], default: true },
    { id: 'e2e-chat', title: 'Chat Completions 经真实 ST /generate（流式/非流式/形状/auth/URL）', needs: ['catalog', 'stack'], default: true },
    { id: 'e2e-responses', title: 'Responses 经真实 ST /generate（事件序/工具/续接 encrypted_content）', needs: ['catalog', 'stack'], default: true },
    { id: 'e2e-anthropic', title: 'Anthropic Messages 经真实 ST /generate（system/messages 转换/usage/错误）', needs: ['catalog', 'stack'], default: true },
    { id: 'tool-round', title: '工具回合：分片参数回传、Responses 同轮 reasoning 续接', needs: ['catalog', 'stack'], default: true },
    { id: 'cancel-stream', title: '取消：慢速流中断后上游感知 + 不提交续接', needs: ['catalog', 'stack'], default: true },
    { id: 'context-budget', title: '上下文预算与输出预留真实计数（长对话 VC_CONTEXT_OVERFLOW）', needs: ['catalog', 'stack'], default: true },
    { id: 'native-drift', title: '原生偏离拒绝（改 model/钉住采样 → VC_NATIVE_DRIFT）', needs: ['catalog', 'stack'], default: true },
    { id: 'key-revoke', title: 'Key 撤销：clearCredential 后 resolve/生成拒绝', needs: ['catalog', 'stack'], default: true },
    { id: 'revision-conflict', title: 'revision 冲突：另改 provider 后旧 br 生成 → VC_REVISION_CONFLICT', needs: ['catalog', 'stack'], default: true },
    { id: 'continuation-hygiene', title: '切换 chat/新回合/取消不混旧工具续接', needs: ['catalog', 'stack'], default: true },
    { id: 'ui03-browser', title: 'UI03 浏览器场景（真实浏览器，主会话串联执行；截图进 artifacts）', needs: ['catalog', 'stack', 'browser'], default: false },
    { id: 'ui04-browser', title: 'W04 复杂卡与聊天界面（真实 Helper/EJS/MVU + Go 投影）', needs: ['catalog', 'stack', 'browser'], default: false },
    { id: 'auth-browser', title: 'W05 B01 唯一登录、TOTP、全入口保护与账号切换', needs: ['go', 'stack', 'browser'], default: false },
    { id: 'source-native', title: 'W06 ST→Go持久来源、漏报、迟到结果、读取故障和删除', needs: ['go', 'stack'], default: false },
    { id: 'f2-native', title: 'W05 B05/B07 原生写入口CAS、删除身份与分支父版本', needs: ['go', 'stack'], default: false },
    { id: 'f2-browser', title: 'W05 B07 两个真实页面冲突保留草稿与迟到脚本拒绝', needs: ['go', 'stack', 'browser'], default: false },
    { id: 'rights-browser', title: 'W06 D02/D05 原生数据权利页面、一次性下载与手机布局', needs: ['go', 'stack'], default: false },
    { id: 'rights-native', title: 'W06 D03/D04 离线重试与独立合成账号删号', needs: ['go', 'stack'], default: false },
    { id: 'memory-browser', title: 'W07 M01/M09 原生长期记忆、摘要与最终请求', needs: ['catalog', 'stack', 'browser'], default: false },
];

/** 展开过滤器：具名场景 + 依赖闭包（needs 中的内部能力不算场景，'catalog' 由 catalog-admin 提供）。 */
export function resolveSceneFilter(filterArg) {
    const wanted = new Set();
    if (!filterArg) {
        for (const s of SCENES) if (s.default) wanted.add(s.id);
        return [...wanted];
    }
    for (const name of String(filterArg).split(',').map((s) => s.trim()).filter(Boolean)) {
        if (!SCENES.some((s) => s.id === name)) {
            throw new Error(`未知场景：${name}（可用：${SCENES.map((s) => s.id).join(', ')}）`);
        }
        wanted.add(name);
    }
    // 依赖闭包：需要 catalog 的场景自动补 catalog-admin（提供 provider/绑定/标记快照）
    for (const id of [...wanted]) {
        const scene = SCENES.find((s) => s.id === id);
        if (scene?.needs.includes('catalog')) wanted.add('catalog-admin');
    }
    // 按 SCENES 声明序输出：依赖（catalog-admin 等）声明在前，必须先于依赖方执行
    return SCENES.filter((s) => wanted.has(s.id)).map((s) => s.id);
}

// ---------------------------------------------------------------------------
// 轮询等待（不 sleep 空转）
// ---------------------------------------------------------------------------

export async function waitFor(probe, { timeoutMs = 30000, intervalMs = 300, label = '就绪' } = {}) {
    const deadline = Date.now() + timeoutMs;
    let lastError = null;
    while (Date.now() < deadline) {
        try {
            const value = await probe();
            if (value) return value;
        } catch (e) {
            lastError = e;
        }
        await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(`等待超时：${label}${lastError ? `（最后错误：${lastError.message}）` : ''}`);
}
