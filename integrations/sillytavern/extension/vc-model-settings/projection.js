// Virtual Companion · 前台投影 — 把 Go FOREGROUND_CHAT 绑定投影进 ST 原生 chatCompletionSettings。
// 许可：AGPL-3.0-only（见目录 README；ADR-0009 §3）。
// 分层：本文件上半部分是纯逻辑（无 DOM / 无 ST import，Node --test 直接可测）；
// 下半部分 createProjectionController 是 ST 胶水（DOM 写入、事件接线、受管横幅），
// ST 宿主 API 一律经参数注入，index.js 是唯一注入真实 getContext 的入口。
//
// 冻结契约（V2-W03 收口，与服务端 generate-bridge.js 严格一致）：
//   标记：vc-go://model-purposes/FOREGROUND_CHAT?provider=<id>&profile=<profileKey>
//         &pr=<providerRevision 十进制>&br=<bindingRevision 十进制>&scope=<opaque>
//   scope = `${characterKey}|${chatKey}|${runId}`（整体作为一个 query 值，URLSearchParams 编码）；
//   服务端把 scope 当 opaque 续接隔离键，前端不解释其内容。

export const MARKER_SCHEME = 'vc-go://';
export const FOREGROUND_PURPOSE = 'FOREGROUND_CHAT';

// ---------- 绑定标记（构建 / 解析） ----------

/**
 * 构建绑定标记。provider/profile 缺省时省略对应 query（服务端按可选字段解析）；
 * pr/br 必须是十进制整数的字符串形式，与服务端 parseRevisionDigits 对齐。
 */
export function buildBindingMarker({
    purpose = FOREGROUND_PURPOSE,
    providerId,
    profileKey,
    providerRevision,
    bindingRevision,
    scope,
} = {}) {
    const params = new URLSearchParams();
    if (providerId !== undefined && providerId !== null && providerId !== '') {
        params.set('provider', String(providerId));
    }
    if (profileKey !== undefined && profileKey !== null && profileKey !== '') {
        params.set('profile', String(profileKey));
    }
    params.set('pr', String(providerRevision));
    params.set('br', String(bindingRevision));
    if (scope !== undefined && scope !== null && scope !== '') {
        params.set('scope', String(scope));
    }
    return `vc-go://model-purposes/${encodeURIComponent(purpose)}?${params.toString()}`;
}

function parseRevisionDigits(value) {
    if (value === null || value === undefined) return undefined;
    if (!/^\d+$/.test(value)) return null; // 非十进制整数：按无效标记处理
    const num = Number(value);
    return Number.isSafeInteger(num) ? num : null;
}

/**
 * 解析绑定标记，语义与服务端 generate-bridge.js parseBindingMarker 逐行对齐：
 * 非 vc-go:// 开头返回 null；URL 解析失败 / host 不符 / pr 或 br 非十进制 → {invalid:true}。
 */
export function parseBindingMarker(raw) {
    if (typeof raw !== 'string' || !raw.startsWith(MARKER_SCHEME)) return null;
    let url;
    try {
        url = new URL(raw);
    } catch {
        return { invalid: true };
    }
    if (url.host !== 'model-purposes' || !url.pathname) return { invalid: true };
    const purpose = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    if (!purpose) return { invalid: true };
    const q = url.searchParams;
    const providerRevision = parseRevisionDigits(q.get('pr'));
    const bindingRevision = parseRevisionDigits(q.get('br'));
    if (providerRevision === null || bindingRevision === null) return { invalid: true };
    return {
        purpose,
        providerId: q.get('provider') ?? undefined,
        profileKey: q.get('profile') ?? undefined,
        ...(providerRevision !== undefined ? { providerRevision } : {}),
        ...(bindingRevision !== undefined ? { bindingRevision } : {}),
        scope: q.get('scope') ?? undefined,
    };
}

/** 标记身份（除 scope 外的全部字段）是否一致；scope 属于每请求概念，不参与偏离判定。 */
export function sameMarkerIdentity(a, b) {
    if (!a || a.invalid || !b || b.invalid) return false;
    return a.purpose === b.purpose
        && (a.providerId ?? '') === (b.providerId ?? '')
        && (a.profileKey ?? '') === (b.profileKey ?? '')
        && (a.providerRevision ?? '') === (b.providerRevision ?? '')
        && (a.bindingRevision ?? '') === (b.bindingRevision ?? '');
}

// ---------- scope 组成与 runId 生命周期 ----------

export function buildScope(characterKey, chatKey, runId) {
    return `${characterKey}|${chatKey}|${String(runId)}`;
}

/**
 * characterKey = 当前角色 avatar 文件名；群聊固定 'group'；无角色 'none'。
 * 依据 st-context.js：getContext().characters[this_chid].avatar / groupId(selected_group)。
 */
export function characterKeyOf({ groupId, characters, characterId } = {}) {
    if (groupId !== undefined && groupId !== null && groupId !== '') return 'group';
    const idx = Number(characterId);
    if (!Number.isInteger(idx) || idx < 0) return 'none';
    const avatar = characters?.[idx]?.avatar;
    const key = typeof avatar === 'string' ? avatar.trim() : '';
    return key || 'none';
}

/** chatKey = 当前聊天文件名（characters[chid].chat / 群聊 chat_id）；无则 'blank'。 */
export function chatKeyOf(chatId) {
    const key = String(chatId ?? '').trim();
    return key || 'blank';
}

/**
 * runId 判据（与服务端 trailingToolRound 同算法）：
 * messages 尾部为若干 tool 结果、其前是一条带非空 tool_calls 的 assistant 消息
 * （或尾部直接是这条 assistant）→ 同轮工具递归，保持 runId；否则视为新用户回合。
 */
export function isToolContinuation(messages) {
    if (!Array.isArray(messages)) return false;
    let i = messages.length;
    while (i > 0 && messages[i - 1]?.role === 'tool' && messages[i - 1]?.tool_call_id) i -= 1;
    return i > 0 && Array.isArray(messages[i - 1]?.tool_calls) && messages[i - 1].tool_calls.length > 0;
}

/** runId 推进：工具续接轮保持；新回合自增；CHAT_CHANGED 由 resetRunState 归零。 */
export function advanceRunState(runState, keepRunId) {
    if (!keepRunId) runState.runId += 1;
    return runState.runId;
}

export function resetRunState(runState) {
    runState.runId = 0;
    return runState;
}

// ---------- 投影资格与决策（目录 DTO → 原生设置期望值） ----------

const PROTOCOL_TO_SOURCE = {
    OPENAI_CHAT_COMPLETIONS: {
        source: 'custom', mainApi: 'openai', markerField: 'custom_url', modelField: 'custom_model', modelSelector: '#custom_model_id',
    },
    OPENAI_RESPONSES: {
        source: 'custom', mainApi: 'openai', markerField: 'custom_url', modelField: 'custom_model', modelSelector: '#custom_model_id',
    },
    ANTHROPIC_MESSAGES: {
        // #main_api 只有 textgenerationwebui/openai/novel/koboldhorde/kobold（index.html），
        // 没有 claude 族：Anthropic 走 Chat Completion 下的 chat_completion_source='claude'
        source: 'claude', mainApi: 'openai', markerField: 'reverse_proxy', modelField: 'claude_model', modelSelector: '#model_claude_select',
    },
};

// ST 原生 #openai_reasoning_effort 的六档选项（openai.js reasoning_effort_types /
// index.html select）；Go 允许 ^[a-z0-9_-]{1,32}$ 的扩展等级不在原生选项内。
export const NATIVE_REASONING_EFFORTS = ['auto', 'low', 'medium', 'high', 'min', 'max'];

/**
 * 钉住推理等级的写入计划：
 * - 六档内 → 原生 select val + trigger('input')（ST 监听 input：openai.js:7179，
 *   trigger('change') 不会同步 oai_settings.reasoning_effort）；
 * - 扩展值（如 'xhigh'）→ 直写 oai_settings.reasoning_effort，不 trigger 原生 select
 *   （下拉无该选项，val 会落空；直写即终值，服务端按请求值核对）；
 * - 未钉住 → null（不动用户值）。
 */
export function reasoningEffortWritePlan(value) {
    if (value === undefined || value === null || value === '') return null;
    const text = String(value);
    if (NATIVE_REASONING_EFFORTS.includes(text)) {
        return { kind: 'native-option', selector: '#openai_reasoning_effort', eventName: 'input', value: text };
    }
    return { kind: 'direct', field: 'reasoning_effort', value: text };
}

const INELIGIBLE_REASONS = {
    'no-binding': '尚未配置前台聊天（FOREGROUND_CHAT）绑定',
    'binding-not-ready': '前台聊天绑定尚未就绪（待配置或暂不可用）',
    'binding-disabled': '前台聊天绑定已停用',
    'provider-missing': '绑定的供应商已不存在',
    'provider-disabled': '绑定的供应商已停用',
    'credential-missing': '绑定的供应商未配置密钥',
    'model-missing': '绑定的模型配置已不存在',
    'model-disabled': '绑定的模型配置已停用',
    'context-missing': '绑定的模型配置缺少上下文窗口',
    'protocol-unsupported': '绑定的协议不在受管三协议内',
};

export function ineligibleReasonLabel(reason) {
    return INELIGIBLE_REASONS[reason] ?? String(reason);
}

/**
 * 投影资格（冻结判定）：绑定 status==='READY' 且 state!=='DISABLED'；
 * provider.state==='ENABLED' 且 credentialConfigured===true；
 * 模型 state==='ENABLED' 且 contextWindowTokens!=null。
 * 返回 eligible 决策（含原生写入所需全部值）或 {eligible:false, reason}。
 */
export function resolveForegroundProjection(purposes, providers) {
    const binding = (Array.isArray(purposes) ? purposes : []).find((b) => b?.purpose === FOREGROUND_PURPOSE) ?? null;
    if (!binding) return { eligible: false, reason: 'no-binding' };
    if (binding.state === 'DISABLED') return { eligible: false, reason: 'binding-disabled' };
    if (binding.status !== 'READY') return { eligible: false, reason: 'binding-not-ready' };
    if (!binding.providerId || !binding.profileKey) return { eligible: false, reason: 'binding-not-ready' };

    const provider = (Array.isArray(providers) ? providers : []).find((p) => p?.providerId === binding.providerId) ?? null;
    if (!provider) return { eligible: false, reason: 'provider-missing' };
    if (provider.state !== 'ENABLED') return { eligible: false, reason: 'provider-disabled' };
    if (provider.credentialConfigured !== true) return { eligible: false, reason: 'credential-missing' };

    const model = (provider.models ?? []).find((m) => m?.profileKey === binding.profileKey) ?? null;
    if (!model) return { eligible: false, reason: 'model-missing' };
    if (model.state !== 'ENABLED') return { eligible: false, reason: 'model-disabled' };
    if (model.contextWindowTokens == null) return { eligible: false, reason: 'context-missing' };

    const mapping = PROTOCOL_TO_SOURCE[provider.protocol];
    if (!mapping) return { eligible: false, reason: 'protocol-unsupported' };

    const params = model.generationParams ?? {};
    const pinned = {};
    if (params.temperature !== undefined && params.temperature !== null) pinned.temperature = Number(params.temperature);
    if (params.topP !== undefined && params.topP !== null) pinned.topP = Number(params.topP);
    // 钉住推理等级仅对 custom 源两协议生效。投影把钉住值写入 oai_settings，界面显示该值；
    // ST getReasoningEffort 对 CUSTOM 会把 max 收成 high、min 收成 low（openai.js，
    // gpt-6-astra 除外）。发送前 restoreManagedReasoningEffort 按界面值写回，
    // 服务端仍按钉住值 409 VC_NATIVE_DRIFT。Anthropic 的推理由原生 thinking 预算承载，
    // 服务端对该协议跳过该字段核对，不在此钉住。
    if (provider.protocol !== 'ANTHROPIC_MESSAGES'
        && params.reasoningEffort !== undefined && params.reasoningEffort !== null && params.reasoningEffort !== '') {
        pinned.reasoningEffort = String(params.reasoningEffort);
    }

    return {
        eligible: true,
        purpose: FOREGROUND_PURPOSE,
        protocol: provider.protocol,
        ...mapping,
        providerId: provider.providerId,
        providerLabel: provider.displayName || provider.providerId,
        providerRevision: Number(provider.revision),
        profileKey: model.profileKey,
        profileLabel: model.displayName || model.modelId,
        modelId: model.modelId,
        bindingRevision: Number(binding.revision),
        contextWindowTokens: Number(model.contextWindowTokens),
        maxOutputTokens: Number(model.maxOutputTokens),
        pinned,
    };
}

/**
 * 由决策生成写入设置用的标记（含当前 scope）。runId 为 0（尚无请求）时按 1 写入，
 * 保证设置里保存的标记始终是完整合法形态；每请求 scope 由 rewriteGenerateData 重写。
 */
export function settingsMarkerFor(decision, scope) {
    return buildBindingMarker({
        purpose: decision.purpose,
        providerId: decision.providerId,
        profileKey: decision.profileKey,
        providerRevision: decision.providerRevision,
        bindingRevision: decision.bindingRevision,
        scope,
    });
}

// ---------- 偏离检测（编辑期；服务端仍每请求强制） ----------

const NUMBER_EPSILON = 1e-6;

function nearlyEqual(a, b) {
    return Math.abs(Number(a) - Number(b)) <= NUMBER_EPSILON;
}

/**
 * 比较 oai_settings 当前快照与投影决策，返回偏离字段列表（空数组 = 一致）。
 * - 标记身份不含 scope（每请求变），非当前协议的标记字段残留 vc-go 前缀也算偏离
 *   （服务端按 custom_url 优先解析标记，残留会劫持判定）；
 * - 钉住的 temperature/topP 差 > 1e-6 才算偏离；未钉住参数不比较（用户自由值）；
 * - 钉住的 reasoningEffort 按 OAI 六档 / 扩展值字符串全等比较（原生默认 'auto' 也算偏离）。
 */
export function diffProjection(settings, decision) {
    const drifts = [];
    if (!settings || !decision?.eligible) return drifts;

    if (settings.chat_completion_source !== decision.source) drifts.push('source');

    const raw = settings[decision.markerField] ?? '';
    const parsed = parseBindingMarker(raw);
    const expected = {
        purpose: decision.purpose,
        providerId: decision.providerId,
        profileKey: decision.profileKey,
        providerRevision: decision.providerRevision,
        bindingRevision: decision.bindingRevision,
    };
    if (!parsed || parsed.invalid || !sameMarkerIdentity(parsed, expected)) drifts.push('marker');

    const otherField = decision.markerField === 'custom_url' ? 'reverse_proxy' : 'custom_url';
    if (String(settings[otherField] ?? '').startsWith(MARKER_SCHEME)) drifts.push('marker-residue');

    const modelValue = String(settings[decision.modelField] ?? '');
    if (modelValue !== String(decision.modelId)) drifts.push('model');

    if (!nearlyEqual(settings.openai_max_context, decision.contextWindowTokens)) drifts.push('max-context');
    if (!nearlyEqual(settings.openai_max_tokens, decision.maxOutputTokens)) drifts.push('max-tokens');

    if (decision.pinned.temperature !== undefined
        && !nearlyEqual(settings.temp_openai, decision.pinned.temperature)) drifts.push('temperature');
    if (decision.pinned.topP !== undefined
        && !nearlyEqual(settings.top_p_openai, decision.pinned.topP)) drifts.push('top-p');
    // 钉住推理等级：当前值为 'auto'（投影前的 ST 默认）或任何 ≠ 钉住值的状态都算偏离；
    // 未钉住时不检测（用户自由值；Anthropic 协议不进入 pinned，天然不检测）。
    if (decision.pinned.reasoningEffort !== undefined
        && String(settings.reasoning_effort ?? '') !== decision.pinned.reasoningEffort) drifts.push('reasoning-effort');

    return drifts;
}

export const DRIFT_FIELD_LABELS = {
    source: '连接源',
    marker: '绑定标记',
    'marker-residue': '残留的旧绑定标记',
    model: '模型',
    'max-context': '上下文窗口',
    'max-tokens': '输出上限',
    temperature: '温度',
    'top-p': 'top P',
    'reasoning-effort': '推理等级',
};

export function driftSummary(drifts) {
    return (drifts ?? []).map((d) => DRIFT_FIELD_LABELS[d] ?? d).join('、');
}

// ---------- 每请求 scope 重写（CHAT_COMPLETION_SETTINGS_READY） ----------

/**
 * 把带新 scope 的标记写进 generate_data（按引用传递，emit 会吞 handler 异常）。
 * runId 推进由调用方先行完成；decision 未就绪时不改写（服务端按无标记拒绝，属预期防线）。
 */
export function rewriteGenerateData(generateData, decision, scope) {
    if (!decision?.eligible || !generateData || typeof generateData !== 'object') return false;
    const marker = settingsMarkerFor(decision, scope);
    if (decision.source === 'custom') generateData.custom_url = marker;
    else generateData.reverse_proxy = marker;
    return true;
}

/**
 * SETTINGS_READY：受管 custom 源把 generateData.reasoning_effort 恢复成界面值。
 * 受管资格与 rewriteGenerateData 相同（decision.eligible）；custom 用已有的
 * decision.source（PROTOCOL_TO_SOURCE），不另建判断。
 * oai_settings.reasoning_effort 为 auto 或空时不写入，保持 ST 对 auto 留下的 undefined。
 * 写入界面值而不是 Go 钉住值：手改成与钉住值不同的等级会原样进入请求，由服务端拒绝。
 * @returns {boolean} 是否写入
 */
export function restoreManagedReasoningEffort(generateData, decision, settings) {
    if (!decision?.eligible || decision.source !== 'custom') return false;
    if (!generateData || typeof generateData !== 'object') return false;
    const ui = settings?.reasoning_effort;
    if (ui === undefined || ui === null || ui === '' || ui === 'auto') return false;
    generateData.reasoning_effort = String(ui);
    return true;
}

// ---------- 受管横幅状态机（纯模型；DOM 渲染在控制器） ----------

export const BANNER_TEST_NOTE = '连接测试只验证模型列表与鉴权，不代表生成可用；真实生成以聊天为准。';

/**
 * 横幅三态：ready（目录配置就绪）/ pending（待配置）/ drift（已偏离）；
 * 目录加载失败时降级为 pending 并附错误说明。返回纯数据，不产生 HTML。
 */
export function bannerModel({ phase, decision, drifts, loadError } = {}) {
    if (phase === 'error') {
        return {
            phase: 'pending',
            title: '前台模型绑定待配置',
            detail: `无法加载模型目录：${loadError ?? '服务暂不可用'}。`,
            revisions: null,
            actions: ['open-settings'],
        };
    }
    if (!decision || !decision.eligible) {
        return {
            phase: 'pending',
            title: '前台模型绑定待配置',
            detail: `${ineligibleReasonLabel(decision?.reason ?? 'no-binding')}。未完成配置前，前台生成会被服务端拒绝（预期防线）。`,
            revisions: null,
            actions: ['open-settings'],
        };
    }
    const revisions = `目录版本 pr ${decision.providerRevision} · br ${decision.bindingRevision}`;
    if (drifts?.length) {
        return {
            phase: 'drift',
            title: '这里的设置与模型页不一致',
            detail: `和模型页不一致的有：${driftSummary(drifts)}。按现在的设置发送会被拒绝，也不会自动改回去。`,
            revisions,
            actions: ['reproject', 'open-settings'],
        };
    }
    return {
        phase: 'ready',
        title: '前台聊天使用模型页的设置',
        detail: `绑定：${decision.providerLabel} · ${decision.profileLabel}（${decision.modelId}）`,
        revisions,
        actions: [],
    };
}

// ---------- ST 胶水控制器（依赖注入；Node 测试只覆盖上方纯逻辑） ----------

const BANNER_ID = 'vc_foreground_banner';
const MARKER_HOST_PANEL = '#openai_api'; // 原生 API 连接面板；横幅注入其顶部，不改 online_status

// 投影管理的原生字段（冻结清单）；用户对这些字段的编辑触发偏离检测。
const MANAGED_EDIT_SELECTORS = [
    '#chat_completion_source',
    '#custom_api_url_text',
    '#openai_reverse_proxy',
    '#custom_model_id',
    '#model_claude_select',
    '#openai_max_context',
    '#openai_max_tokens',
    '#temp_openai',
    '#top_p_openai',
    '#openai_reasoning_effort',
].join(',');

function escHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * @param {object} host
 * @param {() => any} host.getContext ST getContext()：chatCompletionSettings（oai_settings 活引用）、
 *   saveSettingsDebounced、chatId、characterId、groupId、characters、eventSource、eventTypes。
 * @param {() => Promise<any>} host.fetchPurposes GET /api/v1/admin/model-purposes
 * @param {() => Promise<any>} host.fetchProviders GET /api/v1/admin/providers
 * @param {() => void} host.openModelSettings 打开模型设置页（横幅跳转入口）
 */
export function createProjectionController(host) {
    const doc = typeof document !== 'undefined' ? document : null;
    const runState = { runId: 0 };
    const state = { phase: 'loading', decision: null, loadError: null, drifts: [] };
    let writing = false; // 程序写入期间屏蔽偏离检测（jQuery trigger 同样走 DOM 事件）
    let listenersBound = false;

    function jquery() {
        return typeof window !== 'undefined' ? (window.jQuery ?? window.$ ?? null) : null;
    }

    /** 原生 DOM 写入：jQuery val + trigger；值未变时跳过（幂等，避免重复触发 status check）。 */
    function setField(selector, value, eventName, { force = false } = {}) {
        if (!doc) return false;
        const el = doc.querySelector(selector);
        if (!el) return false;
        const $ = jquery();
        if ($) {
            const wrapped = $(el);
            if (!force && String(wrapped.val() ?? '') === String(value)) return true;
            wrapped.val(value).trigger(eventName);
            return true;
        }
        if (!force && String(el.value ?? '') === String(value)) return true;
        el.value = String(value);
        const EventCtor = doc.defaultView?.Event ?? globalThis.Event;
        el.dispatchEvent(new EventCtor(eventName, { bubbles: true }));
        return true;
    }

    /**
     * 模型字段写入。custom 是文本输入，直接 val+trigger('input')；
     * claude 是原生 select，onModelChange 会做 '-v'→'-' 改写并把空值回退为默认 Claude 模型
     * （都会造成 body.model ≠ 绑定 modelId），因此仅当下拉包含目标选项且值不含 '-v' 时走原生
     * change，否则只写 oai_settings 活引用（服务端每请求覆写 body.model，显示值不参与判定）。
     */
    function writeModelField(decision) {
        const ctx = safeContext();
        if (!ctx) return;
        if (decision.modelField === 'custom_model') {
            setField('#custom_model_id', decision.modelId, 'input');
            return;
        }
        const select = doc?.querySelector('#model_claude_select');
        const hasOption = Boolean(select && [...select.options].some((o) => o.value === decision.modelId));
        const safeForNative = hasOption && !String(decision.modelId).includes('-v');
        if (safeForNative) {
            setField('#model_claude_select', decision.modelId, 'change');
        } else if (select) {
            writing = true;
            try {
                jquery()?.(select).val(decision.modelId); // 仅同步显示，不触发 onModelChange 改写
                if (ctx.chatCompletionSettings) ctx.chatCompletionSettings.claude_model = decision.modelId;
                ctx.saveSettingsDebounced?.();
            } finally {
                writing = false;
            }
        }
    }

    function safeContext() {
        try {
            return host.getContext();
        } catch {
            return null;
        }
    }

    /** 当前 scope（设置内标记用）；runId 为 0（尚无生成请求）时按 1 落一个完整合法标记。 */
    function currentScope() {
        const ctx = safeContext();
        return buildScope(
            characterKeyOf(ctx ?? {}),
            chatKeyOf(ctx?.chatId),
            runState.runId > 0 ? runState.runId : 1,
        );
    }

    /**
     * 投影写入（或资格缺失时的清空）。绝不写任何密钥字段 / api key 输入框。
     * 只清空标记承载字段里以 vc-go:// 开头的值（投影自己写入的），不动用户手工 URL。
     */
    function applyProjection() {
        const ctx = safeContext();
        if (!ctx?.chatCompletionSettings) return;
        const oai = ctx.chatCompletionSettings;
        writing = true;
        try {
            const decision = state.decision;
            if (decision?.eligible && state.phase === 'ready') {
                const marker = settingsMarkerFor(decision, currentScope());
                // 写入顺序：标记 / 模型 / 参数先落（进 oai_settings 持久状态），main_api 与
                // source 的 change 最后切 —— ST 在 main_api / source 变更时会发起连接检查，
                // 必须让它读到完整 vc-go:// 标记才能经桥真实取到模型列表并连上（否则
                // no_connection 会隐藏发送键，用户需手动点连接）。三协议 main_api 均为
                // 'openai'（#main_api 无 claude 选项）；setField 幂等，不重复 trigger。
                if (decision.markerField === 'custom_url') {
                    setField('#custom_api_url_text', marker, 'input');
                    if (String(oai.reverse_proxy ?? '').startsWith(MARKER_SCHEME)) {
                        setField('#openai_reverse_proxy', '', 'input');
                    }
                } else {
                    setField('#openai_reverse_proxy', marker, 'input');
                    if (String(oai.custom_url ?? '').startsWith(MARKER_SCHEME)) {
                        setField('#custom_api_url_text', '', 'input');
                    }
                }
                writeModelField(decision);
                setField('#openai_max_context', decision.contextWindowTokens, 'input');
                setField('#openai_max_tokens', decision.maxOutputTokens, 'input');
                if (decision.pinned.temperature !== undefined) {
                    setField('#temp_openai', decision.pinned.temperature, 'input');
                }
                if (decision.pinned.topP !== undefined) {
                    setField('#top_p_openai', decision.pinned.topP, 'input');
                }
                if (decision.pinned.reasoningEffort !== undefined) {
                    const plan = reasoningEffortWritePlan(decision.pinned.reasoningEffort);
                    if (plan?.kind === 'native-option') {
                        setField(plan.selector, plan.value, plan.eventName);
                    } else if (plan && String(oai.reasoning_effort ?? '') !== plan.value) {
                        // 扩展等级不在原生六档内：直写活引用（幂等），不 trigger 原生 select；
                        // saveSettingsDebounced 在本函数尾部统一调用。
                        oai.reasoning_effort = plan.value;
                    }
                }
                // 标记与参数已就位：main_api 的原生 change 只切族与面板（openai 分支不发起
                // 请求，script.js changeMainAPI），保留 change 触发；source 绝不能 trigger
                // change —— 原生处理链 openai.js:6967 会 reconnectOpenAi(:6188) 自动点
                // "连接"发起真实上游 /models 拉取，违反"保存/投影零上游请求"契约
                // （page.js 保存不自动拉取/试连/生成、MASTER_PLAN:103）。只写 select 值与
                // oai_settings 活引用；连接由用户显式点击"连接"完成。
                setField('#main_api', decision.mainApi, 'change');
                const sourceSelect = doc?.querySelector('#chat_completion_source');
                if (sourceSelect && String(sourceSelect.value ?? '') !== decision.source) {
                    const $$ = jquery();
                    if ($$) $$(sourceSelect).val(decision.source);
                    else sourceSelect.value = decision.source;
                }
                oai.chat_completion_source = decision.source;
            } else if (state.phase === 'ready') {
                // 目录明确判定不满足资格：只清标记字段，保留模型文本与用户其他设置。
                if (String(oai.custom_url ?? '').startsWith(MARKER_SCHEME)) setField('#custom_api_url_text', '', 'input');
                if (String(oai.reverse_proxy ?? '').startsWith(MARKER_SCHEME)) setField('#openai_reverse_proxy', '', 'input');
            }
            ctx.saveSettingsDebounced?.();
        } finally {
            writing = false;
        }
        evaluateDrift();
    }

    function evaluateDrift() {
        const ctx = safeContext();
        if (!ctx?.chatCompletionSettings || !state.decision?.eligible || state.phase !== 'ready') {
            state.drifts = [];
        } else {
            state.drifts = diffProjection(ctx.chatCompletionSettings, state.decision);
        }
        renderBanner();
    }

    function onManagedEdit(ev) {
        if (writing) return;
        const target = ev.target;
        if (!target || typeof target.matches !== 'function') return;
        if (!target.matches(MANAGED_EDIT_SELECTORS)) return;
        evaluateDrift();
    }

    function onSettingsReady(generateData) {
        try {
            if (!state.decision?.eligible || state.phase !== 'ready') return;
            advanceRunState(runState, isToolContinuation(generateData?.messages));
            const ctx = safeContext();
            const scope = buildScope(characterKeyOf(ctx ?? {}), chatKeyOf(ctx?.chatId), runState.runId);
            rewriteGenerateData(generateData, state.decision, scope);
            // getReasoningEffort 已把 CUSTOM 的 max/min 收成 high/low；这里按界面值写回。
            // 注册早于 memory.attach / attachCompanionIdentity / story.install，后三者不改该字段。
            restoreManagedReasoningEffort(generateData, state.decision, ctx?.chatCompletionSettings);
        } catch {
            // emit 会吞 handler 异常；此处再自保一次，绝不打断生成链。
        }
    }

    function onChatChanged() {
        try {
            resetRunState(runState);
            applyProjection(); // chatKey 变化 → 设置内标记的 scope 同步刷新
        } catch {
            // 同上：切换会话路径上的任何异常都不外抛。
        }
    }

    function renderBanner() {
        if (!doc) return;
        const panel = doc.querySelector(MARKER_HOST_PANEL);
        if (!panel) return;
        const model = bannerModel({
            phase: state.phase === 'error' ? 'error' : (state.phase === 'ready' ? 'ready' : 'pending'),
            decision: state.phase === 'ready' ? state.decision : null,
            drifts: state.drifts,
            loadError: state.loadError,
        });
        let el = doc.getElementById(BANNER_ID);
        if (!el) {
            el = doc.createElement('div');
            el.id = BANNER_ID;
            panel.prepend(el);
        }
        el.className = `vcfg-banner vcfg-banner-${model.phase}`;
        const icons = { ready: 'fa-circle-check', pending: 'fa-triangle-exclamation', drift: 'fa-code-compare' };
        el.innerHTML = `
            <div class="vcfg-banner-main">
                <i class="fa-solid ${icons[model.phase]}"></i>
                <div>
                    <p class="vcfg-banner-title">${escHtml(model.title)}</p>
                    <p class="vcfg-banner-detail">${escHtml(model.detail)}</p>
                    <p class="vcfg-banner-meta">${escHtml(BANNER_TEST_NOTE)}</p>
                </div>
            </div>
            <div class="vcfg-banner-actions">
                ${model.actions.includes('reproject') ? '<button type="button" class="vcfg-banner-btn" data-vcfg-action="reproject">恢复为模型页设置</button>' : ''}
                ${model.actions.includes('open-settings') ? '<button type="button" class="vcfg-banner-btn" data-vcfg-action="open-settings">打开模型设置</button>' : ''}
            </div>`;
        el.querySelector('[data-vcfg-action="reproject"]')?.addEventListener('click', () => {
            applyProjection();
        });
        el.querySelector('[data-vcfg-action="open-settings"]')?.addEventListener('click', () => {
            try {
                host.openModelSettings();
            } catch {
                // 打开页面失败不阻断横幅其余功能。
            }
        });
    }

    async function refresh() {
        state.phase = 'loading';
        renderBanner();
        try {
            const [purposes, providers] = await Promise.all([
                host.fetchPurposes(),
                host.fetchProviders(),
            ]);
            state.decision = resolveForegroundProjection(purposes, providers);
            state.phase = 'ready';
            state.loadError = null;
        } catch (err) {
            // 目录加载失败：不动已投影的设置（可能是瞬时故障），横幅降级为待配置并说明错误。
            state.decision = null;
            state.phase = 'error';
            state.loadError = err?.message ?? '服务暂时不可用';
        }
        applyProjection();
        renderBanner();
    }

    function bindListeners() {
        if (listenersBound || !doc) return;
        const ctx = safeContext();
        if (!ctx?.eventSource || !ctx?.eventTypes) {
            console.warn('[vc-projection] ST 事件接口不可用，投影事件接线未完成');
            return;
        }
        ctx.eventSource.on(ctx.eventTypes.CHAT_COMPLETION_SETTINGS_READY, onSettingsReady);
        ctx.eventSource.on(ctx.eventTypes.CHAT_CHANGED, onChatChanged);
        doc.addEventListener('input', onManagedEdit);
        doc.addEventListener('change', onManagedEdit);
        listenersBound = true;
    }

    return {
        init() {
            bindListeners();
            return refresh();
        },
        refresh,
        /** 页面保存目录成功后的回调（index.js 经 page controller.onCatalogSaved 接入）。 */
        onCatalogSaved() {
            return refresh();
        },
        /** 恢复为模型页设置（横幅按钮同款入口，供外部诊断调用）。 */
        reproject() {
            applyProjection();
        },
        _state: state, // 仅 harness / 测试观察用，不作为产品接口
    };
}
