// Virtual Companion · 前台投影纯逻辑 — 无 DOM / 无 ST 宿主依赖。
// 许可：AGPL-3.0-only（见目录 README；ADR-0009 §3）。

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
