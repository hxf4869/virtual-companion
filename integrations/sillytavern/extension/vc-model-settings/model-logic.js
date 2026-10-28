// Virtual Companion · 模型设置页 — 纯逻辑模块（无 DOM / 无网络，Node 可测）。
// 语义来源：docs/product/v2-design.md §5、快照 ARCH §17、V2-W03-S2 管理契约（2026-10-28）。

export const PROTOCOLS = [
    {
        id: 'ANTHROPIC_MESSAGES',
        label: 'Anthropic Messages',
        endpoint: '/v1/messages',
        hint: 'Anthropic Messages 协议，最终路径 /v1/messages',
    },
    {
        id: 'OPENAI_CHAT_COMPLETIONS',
        label: 'Chat Completions',
        endpoint: '/v1/chat/completions',
        hint: 'OpenAI Chat Completions 兼容协议，最终路径 /v1/chat/completions',
    },
    {
        id: 'OPENAI_RESPONSES',
        label: 'Responses',
        endpoint: '/v1/responses',
        hint: 'OpenAI Responses 协议，最终路径 /v1/responses',
    },
];

export const PROVIDER_STATE_LABELS = {
    ENABLED: '已启用',
    DISABLED: '已停用',
};

// 能力四态：UNKNOWN/DECLARED/UNSUPPORTED 可由用户选择；VERIFIED 只能来自后端核验，
// 页面展示但不可选、不可伪造（契约：后端明确拒绝手动声明 VERIFIED）。
export const CAPABILITY_STATES = ['UNKNOWN', 'DECLARED', 'VERIFIED', 'UNSUPPORTED'];
export const USER_CAPABILITY_STATES = ['UNKNOWN', 'DECLARED', 'UNSUPPORTED'];
export const CAPABILITY_STATE_LABELS = {
    UNKNOWN: '未知',
    DECLARED: '已声明',
    VERIFIED: '已验证',
    UNSUPPORTED: '不支持',
};

// capabilities 对象的字段清单（契约固定键名），kind 仅用于分组展示。
export const CAPABILITY_FIELDS = [
    { key: 'imageInput', label: '图片输入', kind: 'inputType' },
    { key: 'videoInput', label: '视频输入', kind: 'inputType' },
    { key: 'pdfInput', label: 'PDF 输入', kind: 'inputType' },
    { key: 'structuredOutput', label: '结构化输出', kind: 'capability' },
    { key: 'toolCalls', label: '工具调用', kind: 'capability' },
    { key: 'nativeWebSearch', label: '原生联网搜索', kind: 'capability' },
    { key: 'systemMessage', label: 'system 消息', kind: 'capability' },
];

// 推理等级内部值与后端 V140 约束一致：^[a-z0-9_-]{1,32}$（小写）。
// 预设三档之外的服务端合法值必须保留展示与回传，不静默丢弃。
export const REASONING_LEVELS = ['low', 'medium', 'high'];
export const REASONING_LEVEL_LABELS = { low: '低', medium: '中', high: '高' };
const REASONING_LEVEL_RE = /^[a-z0-9_-]{1,32}$/;

export function isLegalReasoningLevel(value) {
    return REASONING_LEVEL_RE.test(String(value ?? ''));
}

export function reasoningLevelLabel(value) {
    return REASONING_LEVEL_LABELS[value] ?? String(value);
}

// 预设档之外、已保存的合法等级（页面只读保留）。
export function extraReasoningLevels(levels) {
    return (Array.isArray(levels) ? levels : []).filter((v) => isLegalReasoningLevel(v) && !REASONING_LEVELS.includes(v));
}

// 用途绑定（契约固定 6 条）。EMBEDDING 暂只能空引用待配置。
export const PURPOSES = [
    { id: 'FOREGROUND_CHAT', label: '前台聊天', desc: '前台对话生成' },
    { id: 'MEMORY_EXTRACTION_DEDUP_SUMMARY', label: '记忆提取与摘要', desc: '后台提取 / 去重 / 摘要' },
    { id: 'BACKGROUND_GREETINGS', label: '后台问候', desc: '主动问候与跟进' },
    { id: 'STORY_DIRECTOR', label: '剧情导演', desc: '剧情生成与执行' },
    { id: 'NPC_DIALOGUE', label: '剧情 NPC', desc: '剧情角色对话' },
    { id: 'EMBEDDING', label: 'Embedding', desc: '独立向量接口；暂不可绑定，聊天协议不能用作 embedding' },
];

export const BINDING_STATUS_LABELS = {
    PENDING_CONFIGURATION: '待配置',
    DISABLED: '已停用',
    UNAVAILABLE: '暂不可用',
    READY: '已就绪',
};

export const CURRENCIES = ['USD', 'CNY', 'EUR', 'JPY'];
export const CURRENCY_LABELS = { USD: 'USD $', CNY: 'CNY ¥', EUR: 'EUR €', JPY: 'JPY ¥' };

const URL_PROTOCOL_RE = /^https?:\/\//i;

function isBlank(v) {
    return v === '' || v === null || v === undefined;
}

export function protocolMeta(protocolId) {
    return PROTOCOLS.find((p) => p.id === protocolId) || null;
}

const TERMINAL_ENDPOINT_SUFFIXES = ['/chat/completions', '/responses', '/messages', '/models'];

/**
 * 校验并规范化「Base URL + 协议」→ 最终请求地址。
 * 规则与后端真源一致（backend/internal/provider/modelhttp/endpoint.go ResolveEndpoint）：
 * - 拒绝 userinfo、查询参数、锚点、编码路径、// 与 /./ 、/../ 等路径片段；
 * - 拒绝以接口路径（/messages、/chat/completions、/responses、/models）结尾的输入，
 *   并给出可一键采用的 suggestedBaseUrl（显式转换，实际更新提交的 baseUrl）；
 * - 非回环地址必须 https，拒绝裸 IP / 非完整域名 / IPv6 字面量；
 * - Base URL 已带 /v1 时只追加接口后缀，不重复拼接。
 * 返回 {ok:true, finalUrl, source, hint} 或 {ok:false, error, kind?, suggestedBaseUrl?}。
 */
export function normalizeEndpoint(rawBaseUrl, protocolId) {
    const meta = protocolMeta(protocolId);
    if (!meta) {
        return { ok: false, error: '请选择接口协议' };
    }
    const raw = String(rawBaseUrl ?? '').trim();
    if (!raw) {
        return { ok: false, error: '请填写 Base URL' };
    }
    if (raw.length > 2048) {
        return { ok: false, error: 'Base URL 过长（上限 2048 字符）' };
    }
    if (!URL_PROTOCOL_RE.test(raw)) {
        return { ok: false, error: 'Base URL 需以 http:// 或 https:// 开头' };
    }
    let url;
    try {
        url = new URL(raw);
    } catch {
        return { ok: false, error: 'Base URL 不是合法地址' };
    }
    if (url.username || url.password) {
        return { ok: false, error: 'Base URL 不能包含用户名 / 密码信息' };
    }
    if (url.search || url.hash) {
        return { ok: false, error: 'Base URL 不能包含查询参数（?…）或锚点（#…）' };
    }
    // 路径段检查用原始输入：JS URL 会规范化掉 /./ 等片段，而后端按原始路径拒绝。
    const afterScheme = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
    const pathStart = afterScheme.indexOf('/');
    const rawPath = pathStart === -1 ? '' : afterScheme.slice(pathStart).split(/[?#]/)[0];
    if (rawPath.includes('%')) {
        return { ok: false, error: 'Base URL 路径不能包含编码字符（%…）' };
    }
    if (rawPath.includes('//') || rawPath.includes('/./') || rawPath.includes('/../')
        || rawPath.endsWith('/..') || rawPath.endsWith('/.')) {
        return { ok: false, error: 'Base URL 路径不合法（不能包含 //、/./、/../ 等片段）' };
    }
    const basePath = rawPath.replace(/\/+$/, '');
    const terminal = TERMINAL_ENDPOINT_SUFFIXES.find((t) => basePath.endsWith(t));
    if (terminal) {
        let suggested = `${url.origin}${basePath.slice(0, basePath.length - terminal.length)}`.replace(/\/+$/, '');
        if (!suggested || suggested === '') {
            suggested = url.origin;
        }
        return {
            ok: false,
            kind: 'full-endpoint',
            error: `Base URL 不能以接口路径（${terminal}）结尾。请去掉接口后缀，或点「转换为 Base URL」`,
            suggestedBaseUrl: suggested,
        };
    }

    const host = url.hostname;
    const scheme = url.protocol.replace(':', '').toLowerCase();
    if (host.includes(':')) {
        return { ok: false, error: 'Base URL 不能使用 IPv6 地址' };
    }
    if (host === '127.0.0.1') {
        if (scheme !== 'https' && scheme !== 'http') {
            return { ok: false, error: 'Base URL 需以 http:// 或 https:// 开头' };
        }
        const endpoint = meta.endpoint;
        const suffix = endpoint.slice(endpoint.indexOf('/', 1));
        const finalUrl = basePath.endsWith('/v1')
            ? `${url.origin}${basePath}${suffix}`
            : `${url.origin}${basePath}${endpoint}`;
        return {
            ok: true,
            finalUrl,
            source: basePath.endsWith('/v1') ? 'with-v1' : 'plain',
            hint: basePath.endsWith('/v1')
                ? 'Base URL 已含 /v1，只追加接口后缀；本地回环 http 需开启本地调试后才能实际使用'
                : `按协议追加 ${endpoint}；本地回环 http 需开启本地调试后才能实际使用`,
        };
    }
    if (scheme !== 'https') {
        return { ok: false, error: 'Base URL 需使用 https（本地调试地址 127.0.0.1 除外）' };
    }
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
        return { ok: false, error: 'Base URL 不能使用裸 IP 地址，请填写域名（本地调试请用 127.0.0.1）' };
    }
    if (host === 'localhost' || !host.includes('.')) {
        return { ok: false, error: 'Base URL 主机名需为完整域名（本地调试请用 127.0.0.1）' };
    }
    if (host.startsWith('.') || host.endsWith('.')
        || host.split('.').some((label) => !label || label.startsWith('-') || label.endsWith('-'))) {
        return { ok: false, error: 'Base URL 主机名不合法' };
    }

    const endpoint = meta.endpoint;
    const suffix = endpoint.slice(endpoint.indexOf('/', 1));
    if (basePath.endsWith('/v1')) {
        return {
            ok: true,
            finalUrl: `${url.origin}${basePath}${suffix}`,
            source: 'with-v1',
            hint: `Base URL 已含 /v1，只追加 ${suffix}，不会重复拼接`,
        };
    }
    return {
        ok: true,
        finalUrl: `${url.origin}${basePath}${endpoint}`,
        source: 'plain',
        hint: `按协议追加 ${endpoint}`,
    };
}

// ---------- 表单校验（错误就近字段；返回 {field: message}，空对象 = 通过） ----------

function parseIntField(value) {
    if (value === '' || value === null || value === undefined) return { empty: true };
    const n = Number(value);
    if (!Number.isFinite(n) || !Number.isInteger(n) || String(value).trim() === '') return { bad: true };
    return { value: n };
}

// 与后端真源一致的边界（V119 约束 / ValidateProviderID / ValidateBaseURL）：
// providerId ^[a-z][a-z0-9-]{0,63}$；供应商显示名 1–80；模型显示名 1–100；
// modelId 去空格后 1–200 且无控制字符；context 1–2,000,000；maxOutput 1–262,144。
export function validateProviderForm(form, { isNew = false } = {}) {
    const errors = {};
    const displayName = String(form.displayName ?? '').trim();
    if (!displayName) {
        errors.displayName = '请填写显示名称';
    } else if (displayName.length > 80) {
        errors.displayName = '显示名称需在 1–80 个字符之间';
    }
    if (isNew) {
        const id = String(form.providerId ?? '').trim();
        if (!id) {
            errors.providerId = '请填写供应商 ID';
        } else if (!/^[a-z][a-z0-9-]{0,63}$/.test(id)) {
            errors.providerId = '供应商 ID 需小写字母开头，可含小写字母、数字、连字符（-），不超过 64 字符';
        }
    }
    if (!protocolMeta(form.protocol)) {
        errors.protocol = '请选择接口协议';
    }
    const endpoint = normalizeEndpoint(form.baseUrl, form.protocol);
    if (!endpoint.ok) {
        errors.baseUrl = endpoint.error;
    }
    return { errors, endpoint };
}

/**
 * 密钥与启停的组合校验（契约语义）。
 * - clearCredential:true 必须伴随 DISABLED；
 * - 新供应商无密钥（本次也未填写）只能保存为 DISABLED 草稿。
 */
export function validateCredentialPlan(form, { isNew = false, credentialConfigured = false } = {}) {
    const errors = {};
    const key = keyPlan(form, credentialConfigured);
    if (form.clearCredential && form.state === 'ENABLED') {
        errors.state = '清除密钥后供应商必须保持停用；请先停用再清除';
    }
    if (isNew && !credentialConfigured && key.finalKey === 'none' && form.state === 'ENABLED') {
        errors.state = '未配置 API Key 的供应商不能启用；请先填写密钥，或保存为停用草稿';
    }
    return errors;
}

export function validateModelForm(model) {
    const errors = {};
    const displayName = String(model.displayName ?? '').trim();
    if (!displayName) {
        errors.displayName = '请填写模型显示名称';
    } else if (displayName.length > 100) {
        errors.displayName = '模型显示名称需在 1–100 个字符之间';
    }
    const modelId = String(model.modelId ?? '').trim();
    if (!modelId) {
        errors.modelId = '请填写模型 ID';
    } else if (modelId.length > 200 || /[\x00-\x1f\x7f]/.test(modelId)) {
        errors.modelId = '模型 ID 需在 1–200 个字符之间，且不含控制字符';
    }
    if ((model.isNew || model.isClone) && !isBlank(model.profileKey)) {
        const profileKey = String(model.profileKey).trim();
        if (profileKey.length > 200 || /[\x00-\x1f\x7f]/.test(profileKey)) {
            errors.profileKey = '配置标识需在 1–200 个字符之间，且不含控制字符';
        }
    }

    const ctx = parseIntField(model.contextWindowTokens);
    if (ctx.bad || (ctx.value !== undefined && (ctx.value < 1 || ctx.value > 2000000))) {
        errors.contextWindowTokens = '上下文窗口需为 1–2,000,000 之间的整数（单位：token）';
    }
    const maxOut = parseIntField(model.maxOutputTokens);
    if (maxOut.bad || maxOut.empty || maxOut.value < 1 || maxOut.value > 262144) {
        errors.maxOutputTokens = '最大输出 token 需为 1–262,144 之间的整数';
    } else if (ctx.value && ctx.value > 0 && maxOut.value >= ctx.value) {
        // 预算是否够给历史与工具结果留空间，由生成时的完整请求校验负责；此处只做边界。
        errors.maxOutputTokens = '最大输出 token 必须小于上下文窗口';
    }

    if (model.generationParams) {
        const { temperature, topP, reasoningEffort } = model.generationParams;
        if (temperature !== '' && temperature !== null && temperature !== undefined) {
            const t = Number(temperature);
            if (!Number.isFinite(t) || t < 0 || t > 2) {
                errors.temperature = '温度需在 0–2 之间';
            }
        }
        if (topP !== '' && topP !== null && topP !== undefined) {
            const p = Number(topP);
            if (!Number.isFinite(p) || p < 0 || p > 1) {
                errors.topP = 'top P 需在 0–1 之间';
            }
        }
        if (reasoningEffort) {
            const levels = Array.isArray(model.reasoningLevels) ? model.reasoningLevels : [];
            if (levels.length === 0) {
                errors.reasoningEffort = '该模型未声明可用推理等级；请先在下方声明，或保持未设置';
            } else if (!levels.includes(reasoningEffort)) {
                errors.reasoningEffort = '推理等级必须在声明的可用等级内';
            }
        }
    }

    // 用户手动保存不得声明 VERIFIED；已验证状态只能来自后端核验（页面只读展示）。
    if (model.editedSubs?.has?.('capabilities')) {
        for (const field of CAPABILITY_FIELDS) {
            const state = model.capabilities?.[field.key];
            if (state === undefined || state === null) continue;
            if (!CAPABILITY_STATES.includes(state)) {
                errors.capabilities = `能力状态不合法：${field.label}`;
            } else if (state === 'VERIFIED' && model.touchedCaps?.has?.(field.key)) {
                errors.capabilities = `「${field.label}」不能手动标记为已验证；已验证只能来自后端核验`;
            }
        }
    }

    Object.assign(errors, validatePricing(model.pricing));
    return errors;
}

export function validatePricing(pricing) {
    const errors = {};
    if (!pricing) return errors;
    const hasInput = pricing.inputPerMillionTokens !== '' && pricing.inputPerMillionTokens !== null && pricing.inputPerMillionTokens !== undefined;
    const hasOutput = pricing.outputPerMillionTokens !== '' && pricing.outputPerMillionTokens !== null && pricing.outputPerMillionTokens !== undefined;
    const hasCurrency = Boolean(pricing.currency);
    if ((hasInput || hasOutput) && !hasCurrency) {
        errors.pricingCurrency = '已填写价格，请选择币种；未知计价显示“未配置”，不能当作免费';
    }
    for (const [key, has] of [['pricingInput', hasInput], ['pricingOutput', hasOutput]]) {
        if (has) {
            const n = Number(key === 'pricingInput' ? pricing.inputPerMillionTokens : pricing.outputPerMillionTokens);
            if (!Number.isFinite(n) || n < 0) {
                errors[key] = '价格需为不小于 0 的数字';
            }
        }
    }
    return errors;
}

// ---------- 密钥三态 ----------

export function keyPlan(form, credentialConfigured) {
    let finalKey;
    let action;
    if (form.clearCredential) {
        finalKey = 'none';
        action = 'will-clear';
    } else if (String(form.credential ?? '').length > 0) {
        finalKey = 'configured';
        action = 'will-replace';
    } else if (credentialConfigured) {
        finalKey = 'configured';
        action = 'keep';
    } else {
        finalKey = 'none';
        action = 'none';
    }
    return { finalKey, action };
}

export const KEY_STATE_LABELS = {
    none: '未配置',
    configured: '已配置（不回显）',
    'will-replace': '保存后替换为新密钥',
    'will-clear': '保存后清除密钥',
};

// ---------- 计价显示（未知 ≠ 免费） ----------

export function formatPricing(pricing) {
    if (!pricing) return '未配置';
    const { currency, inputPerMillionTokens, outputPerMillionTokens, verifiedOn } = pricing;
    const hasIn = inputPerMillionTokens !== '' && inputPerMillionTokens !== null && inputPerMillionTokens !== undefined;
    const hasOut = outputPerMillionTokens !== '' && outputPerMillionTokens !== null && outputPerMillionTokens !== undefined;
    if (!currency && !hasIn && !hasOut) return '未配置';
    if (!currency) return '未配置（币种未知）';
    const unit = CURRENCY_LABELS[currency] ?? currency;
    const fmt = (v) => (hasXX(v) ? `${unit}${Number(v).toFixed(2)}` : '未配置');
    const base = `输入 ${fmt(inputPerMillionTokens)} / 输出 ${fmt(outputPerMillionTokens)} 每百万 token`;
    return verifiedOn ? `${base}（核验 ${verifiedOn}）` : `${base}（未核验）`;
}

function hasXX(v) {
    return v !== '' && v !== null && v !== undefined;
}

// ---------- 连接检查（check-only discover；不自动改草稿） ----------

/**
 * 从连接检查结果中筛出「未收录」的模型（草稿里不存在同 modelId）。
 * 返回 [{modelId, displayName}]；已收录的不重复加入，手填模型 ID 的能力不受影响。
 */
export function unrecordedModels(found, models) {
    const known = new Set((Array.isArray(models) ? models : [])
        .map((m) => String(m?.modelId ?? '').trim())
        .filter(Boolean));
    const out = [];
    for (const item of Array.isArray(found) ? found : []) {
        const modelId = String(item?.modelId ?? '').trim();
        if (!modelId || known.has(modelId)) continue;
        known.add(modelId); // 服务方重复条目只提示一次
        out.push({ modelId, displayName: String(item?.displayName ?? modelId) });
    }
    return out;
}

// ---------- 用途绑定 ----------

export function purposeMeta(purposeId) {
    return PURPOSES.find((p) => p.id === purposeId) || { id: purposeId, label: purposeId, desc: '' };
}

// EMBEDDING 本轮只能空引用待配置；聊天协议不能当 embedding。
export function canBindPurpose(purposeId) {
    return purposeId !== 'EMBEDDING';
}

export function modelUsageImpact(model) {
    const purposes = Array.isArray(model?.boundPurposes) ? model.boundPurposes : [];
    return purposes.map(purposeMeta);
}

export function buildBindingOptions(providers) {
    // 选项：待配置 + 各启用供应商下的模型。EMBEDDING 不可选聊天模型（页面另行禁用）。
    const options = [{ value: '', label: '待配置（不绑定任何模型）' }];
    for (const provider of providers) {
        for (const model of provider.models ?? []) {
            if (model.state !== 'ENABLED' || provider.state !== 'ENABLED') continue;
            options.push({
                value: `${provider.providerId}::${model.profileKey}`,
                label: `${provider.displayName} · ${model.displayName || model.modelId}`,
            });
        }
    }
    return options;
}

// ---------- PUT 载荷构建（契约：models 为整体快照；四个子对象缺省=保留，出现=整体替换） ----------

function sanitizePrice(value) {
    if (value === '' || value === null || value === undefined) return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
}

function modelToPutEntry(draftModel) {
    const entry = {
        profileKey: draftModel.profileKey,
        modelId: String(draftModel.modelId ?? '').trim(),
        displayName: String(draftModel.displayName ?? '').trim(),
        maxOutputTokens: Number(draftModel.maxOutputTokens),
        state: draftModel.state ?? 'ENABLED',
    };
    const ctx = parseIntField(draftModel.contextWindowTokens);
    if (!ctx.empty && !ctx.bad && ctx.value > 0) {
        entry.contextWindowTokens = ctx.value;
    }
    if (typeof draftModel.priority === 'number' && Number.isFinite(draftModel.priority)) {
        entry.priority = draftModel.priority;
    }
    // 子对象只在被编辑 / 新建 / 克隆时携带：出现即整体替换，缺省即保留服务端值。
    // capabilities 内未被用户触碰的字段原样透传（含 VERIFIED，避免一次编辑抹掉后端核验）；
    // 克隆到新 profileKey 时 VERIFIED 降级为 DECLARED，不在新配置上声称已验证。
    const subs = draftModel.editedSubs ?? new Set();
    const sendCapabilities = draftModel.isNew || draftModel.isClone || subs.has('capabilities');
    if (sendCapabilities) {
        const capabilities = {};
        for (const field of CAPABILITY_FIELDS) {
            const state = draftModel.capabilities?.[field.key];
            if (draftModel.isClone && state === 'VERIFIED') {
                capabilities[field.key] = 'DECLARED';
            } else if (USER_CAPABILITY_STATES.includes(state)
                || (state === 'VERIFIED' && !draftModel.touchedCaps?.has?.(field.key))) {
                capabilities[field.key] = state;
            } else {
                capabilities[field.key] = 'UNKNOWN';
            }
        }
        entry.capabilities = capabilities;
    }
    if (draftModel.isNew || draftModel.isClone || subs.has('reasoningLevels')) {
        entry.reasoningLevels = (Array.isArray(draftModel.reasoningLevels) ? draftModel.reasoningLevels : [])
            .filter(isLegalReasoningLevel);
    }
    if (draftModel.isNew || draftModel.isClone || subs.has('generationParams')) {
        const params = {};
        const { temperature, topP, reasoningEffort } = draftModel.generationParams ?? {};
        if (temperature !== '' && temperature !== null && temperature !== undefined) params.temperature = Number(temperature);
        if (topP !== '' && topP !== null && topP !== undefined) params.topP = Number(topP);
        if (reasoningEffort) params.reasoningEffort = reasoningEffort;
        entry.generationParams = params;
    }
    if (draftModel.isNew || draftModel.isClone || subs.has('pricing')) {
        const pricing = {};
        const p = draftModel.pricing ?? {};
        if (p.currency) pricing.currency = p.currency;
        const inPrice = sanitizePrice(p.inputPerMillionTokens);
        const outPrice = sanitizePrice(p.outputPerMillionTokens);
        if (inPrice !== undefined) pricing.inputPerMillionTokens = inPrice;
        if (outPrice !== undefined) pricing.outputPerMillionTokens = outPrice;
        if (p.verifiedOn) pricing.verifiedOn = p.verifiedOn;
        entry.pricing = pricing;
    }
    return entry;
}

export function buildProviderPut(draft, { isNew = false } = {}) {
    const payload = {
        displayName: String(draft.displayName ?? '').trim(),
        protocol: draft.protocol,
        baseUrl: String(draft.baseUrl ?? '').trim(),
        state: draft.state ?? 'DISABLED',
        expectedRevision: draft.revision,
        models: (draft.models ?? []).map(modelToPutEntry),
    };
    if (String(draft.credential ?? '').length > 0) {
        payload.credential = draft.credential;
    }
    if (draft.clearCredential) {
        payload.clearCredential = true;
    }
    return payload;
}

export function buildBindingPut(bindingDraft) {
    const put = {
        state: bindingDraft.state ?? 'PENDING_CONFIGURATION',
        expectedRevision: bindingDraft.revision,
    };
    if (bindingDraft.providerId) put.providerId = bindingDraft.providerId;
    if (bindingDraft.profileKey) put.profileKey = bindingDraft.profileKey;
    return put;
}

// ---------- 冲突与草稿 ----------

export function conflictInfo(apiError) {
    if (!apiError || apiError.kind !== 'conflict-revision') return null;
    const current = apiError.details?.currentRevision;
    return {
        currentRevision: typeof current === 'number' ? current : null,
    };
}

export function providerDraftFromApi(provider) {
    return {
        providerId: provider.providerId,
        displayName: provider.displayName ?? '',
        protocol: provider.protocol ?? PROTOCOLS[0].id,
        baseUrl: provider.baseUrl ?? '',
        state: provider.state ?? 'DISABLED',
        revision: provider.revision ?? 0,
        endpointUrl: provider.endpointUrl ?? null,
        credentialConfigured: Boolean(provider.credentialConfigured),
        updatedAt: provider.updatedAt ?? null,
        credential: '',
        clearCredential: false,
        models: (provider.models ?? []).map(modelDraftFromApi),
    };
}

export function modelDraftFromApi(model) {
    return {
        profileKey: model.profileKey ?? model.modelId,
        modelId: model.modelId ?? '',
        displayName: model.displayName ?? '',
        contextWindowTokens: model.contextWindowTokens ?? '',
        maxOutputTokens: model.maxOutputTokens ?? '',
        state: model.state ?? 'ENABLED',
        priority: model.priority ?? 0,
        capabilities: { ...(model.capabilities ?? {}) },
        reasoningLevels: (Array.isArray(model.reasoningLevels) ? model.reasoningLevels : []).filter(isLegalReasoningLevel),
        generationParams: {
            temperature: model.generationParams?.temperature ?? '',
            topP: model.generationParams?.topP ?? '',
            reasoningEffort: model.generationParams?.reasoningEffort ?? '',
        },
        pricing: {
            currency: model.pricing?.currency ?? '',
            inputPerMillionTokens: model.pricing?.inputPerMillionTokens ?? '',
            outputPerMillionTokens: model.pricing?.outputPerMillionTokens ?? '',
            verifiedOn: model.pricing?.verifiedOn ?? null,
        },
        boundPurposes: [...(model.boundPurposes ?? [])],
        updatedAt: model.updatedAt ?? null,
        editedSubs: new Set(),
        touchedCaps: new Set(),
        isNew: false,
        isClone: false,
    };
}

export function newProviderDraft() {
    return {
        providerId: '',
        displayName: '',
        protocol: PROTOCOLS[0].id,
        baseUrl: '',
        state: 'DISABLED',
        revision: 0,
        endpointUrl: null,
        credentialConfigured: false,
        updatedAt: null,
        credential: '',
        clearCredential: false,
        models: [],
    };
}

export function newModelDraft() {
    return {
        profileKey: '',
        modelId: '',
        displayName: '',
        contextWindowTokens: '',
        maxOutputTokens: '',
        state: 'ENABLED',
        priority: 0,
        capabilities: {},
        reasoningLevels: [],
        generationParams: { temperature: '', topP: '', reasoningEffort: '' },
        pricing: { currency: '', inputPerMillionTokens: '', outputPerMillionTokens: '', verifiedOn: null },
        boundPurposes: [],
        updatedAt: null,
        editedSubs: new Set(),
        touchedCaps: new Set(),
        isNew: true,
        isClone: false,
    };
}

export function cloneModelDraft(source, { profileKey, displayName }) {
    return {
        ...structuredClone({ ...source, editedSubs: null, touchedCaps: null }),
        profileKey,
        displayName,
        boundPurposes: [],
        updatedAt: null,
        editedSubs: new Set(['capabilities', 'reasoningLevels', 'generationParams', 'pricing']),
        touchedCaps: new Set(CAPABILITY_FIELDS.map((f) => f.key)),
        isNew: false,
        isClone: true,
    };
}

// 草稿是否有未保存修改（用于关闭保护 / 放弃按钮）。
export function draftDiffers(draft, original) {
    if (!original) return true;
    if (draft.displayName !== original.displayName) return true;
    if (draft.protocol !== original.protocol) return true;
    if (draft.baseUrl !== original.baseUrl) return true;
    if (draft.state !== original.state) return true;
    if (draft.credential || draft.clearCredential) return true;
    const strip = ({ editedSubs, touchedCaps, ...rest }) => rest;
    const a = JSON.stringify(draft.models.map(strip));
    const b = JSON.stringify(original.models.map(strip));
    return a !== b;
}
