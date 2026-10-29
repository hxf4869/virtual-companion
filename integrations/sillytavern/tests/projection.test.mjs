// V2-W03 · 前台投影纯逻辑测试（Node --test，无 DOM / 无 ST）。
// 覆盖：绑定标记构建与解析（与服务端 generate-bridge.js 语义对齐）、scope 组成、
// runId 生命周期（工具递归判据）、投影资格决策、原生设置期望值、偏离检测、
// 每请求 generate_data 重写、受管横幅三态模型。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    MARKER_SCHEME,
    buildBindingMarker,
    parseBindingMarker,
    sameMarkerIdentity,
    buildScope,
    characterKeyOf,
    chatKeyOf,
    isToolContinuation,
    advanceRunState,
    resetRunState,
    resolveForegroundProjection,
    settingsMarkerFor,
    diffProjection,
    driftSummary,
    rewriteGenerateData,
    restoreManagedReasoningEffort,
    bannerModel,
    ineligibleReasonLabel,
    NATIVE_REASONING_EFFORTS,
    reasoningEffortWritePlan,
} from '../extension/vc-model-settings/projection.js';

// ---------- 绑定标记 ----------

test('buildBindingMarker：冻结形状与 query 顺序（provider/profile/pr/br/scope）', () => {
    const marker = buildBindingMarker({
        providerId: 'main-relay', profileKey: 'daily-chat',
        providerRevision: 12, bindingRevision: 8, scope: 'seraphina.png|2026-10-28|1',
    });
    assert.equal(
        marker,
        'vc-go://model-purposes/FOREGROUND_CHAT?provider=main-relay&profile=daily-chat&pr=12&br=8'
        + '&scope=seraphina.png%7C2026-10-28%7C1',
    );
    // scope 整体作为一个 query 值（| 经 URLSearchParams 编码为 %7C）
    const back = parseBindingMarker(marker);
    assert.equal(back.scope, 'seraphina.png|2026-10-28|1');
});

test('buildBindingMarker：provider/profile/scope 缺省时省略 query；pr/br 必须可字符串化', () => {
    const marker = buildBindingMarker({ providerRevision: 0, bindingRevision: 3 });
    assert.equal(marker, 'vc-go://model-purposes/FOREGROUND_CHAT?pr=0&br=3');
    assert.ok(!marker.includes('provider='));
    assert.ok(!marker.includes('scope='));
});

test('parseBindingMarker：非 vc-go 前缀返回 null（与服务端一致）', () => {
    assert.equal(parseBindingMarker('https://api.example.com/v1'), null);
    assert.equal(parseBindingMarker(''), null);
    assert.equal(parseBindingMarker(undefined), null);
});

test('parseBindingMarker：pr/br 非十进制整数 → invalid（服务端拒绝口径）', () => {
    for (const raw of [
        'vc-go://model-purposes/FOREGROUND_CHAT?provider=a&profile=b&pr=x&br=1',
        'vc-go://model-purposes/FOREGROUND_CHAT?provider=a&profile=b&pr=1.5&br=1',
        'vc-go://model-purposes/FOREGROUND_CHAT?provider=a&profile=b&pr=-1&br=1',
        'vc-go://model-purposes/FOREGROUND_CHAT?provider=a&profile=b&pr=0x10&br=1',
    ]) {
        const parsed = parseBindingMarker(raw);
        assert.ok(parsed && parsed.invalid === true, raw);
    }
});

test('parseBindingMarker：合法标记字段全解析；缺 provider/profile 按可选处理', () => {
    const parsed = parseBindingMarker('vc-go://model-purposes/FOREGROUND_CHAT?provider=p1&profile=k1&pr=12&br=8&scope=a%7Cb%7C2');
    assert.deepEqual(
        { ...parsed },
        { purpose: 'FOREGROUND_CHAT', providerId: 'p1', profileKey: 'k1', providerRevision: 12, bindingRevision: 8, scope: 'a|b|2' },
    );
    const minimal = parseBindingMarker('vc-go://model-purposes/FOREGROUND_CHAT?pr=1&br=1');
    assert.equal(minimal.providerId, undefined);
    assert.equal(minimal.scope, undefined);
    // 与服务端 parseRevisionDigits 同口径：缺 pr/br 视为「未携带」而非非法（防御复核跳过）
    const noPr = parseBindingMarker('vc-go://model-purposes/FOREGROUND_CHAT?br=1');
    assert.equal(noPr.invalid, undefined);
    assert.equal(noPr.providerRevision, undefined);
});

test('sameMarkerIdentity：scope 不参与；任一身份字段不同即不同', () => {
    const base = parseBindingMarker('vc-go://model-purposes/FOREGROUND_CHAT?provider=p&profile=k&pr=1&br=2&scope=x|y|1');
    const sameScopeChanged = parseBindingMarker('vc-go://model-purposes/FOREGROUND_CHAT?provider=p&profile=k&pr=1&br=2&scope=x|y|9');
    assert.equal(sameMarkerIdentity(base, sameScopeChanged), true, 'scope 变化不算身份变化');
    for (const other of [
        'vc-go://model-purposes/FOREGROUND_CHAT?provider=p&profile=k&pr=2&br=2&scope=x|y|1',
        'vc-go://model-purposes/FOREGROUND_CHAT?provider=p&profile=k&pr=1&br=3&scope=x|y|1',
        'vc-go://model-purposes/FOREGROUND_CHAT?provider=q&profile=k&pr=1&br=2&scope=x|y|1',
        'vc-go://model-purposes/FOREGROUND_CHAT?provider=p&profile=j&pr=1&br=2&scope=x|y|1',
        'vc-go://model-purposes/OTHER?provider=p&profile=k&pr=1&br=2&scope=x|y|1',
    ]) {
        assert.equal(sameMarkerIdentity(base, parseBindingMarker(other)), false, other);
    }
    assert.equal(sameMarkerIdentity(base, { invalid: true }), false);
});

// ---------- scope 组成 ----------

test('buildScope：`${characterKey}|${chatKey}|${runId}` 原样拼接（编码只发生在标记构建）', () => {
    assert.equal(buildScope('seraphina.png', '2026-10-28 深夜', 3), 'seraphina.png|2026-10-28 深夜|3');
    assert.equal(buildScope('group', 'blank', 0), 'group|blank|0');
});

test('characterKeyOf：群聊 group / 无角色 none / 取 avatar 文件名', () => {
    const characters = [{ avatar: 'seraphina.png' }, { avatar: 'miya.png' }];
    assert.equal(characterKeyOf({ groupId: 'grp1', characters, characterId: 0 }), 'group');
    assert.equal(characterKeyOf({ groupId: null, characters, characterId: 1 }), 'miya.png');
    assert.equal(characterKeyOf({ groupId: null, characters, characterId: -1 }), 'none');
    assert.equal(characterKeyOf({ groupId: null, characters: [], characterId: 5 }), 'none');
    assert.equal(characterKeyOf({}), 'none');
});

test('chatKeyOf：空 / null → blank；其余原样', () => {
    assert.equal(chatKeyOf('2026-10-28'), '2026-10-28');
    assert.equal(chatKeyOf(''), 'blank');
    assert.equal(chatKeyOf(null), 'blank');
    assert.equal(chatKeyOf(undefined), 'blank');
    assert.equal(chatKeyOf('  '), 'blank');
});

// ---------- runId 生命周期 ----------

test('isToolContinuation：尾部 tool 结果 + 前一条 assistant tool_calls → 续接轮', () => {
    const messages = [
        { role: 'user', content: '查天气' },
        { role: 'assistant', content: '', tool_calls: [{ id: 't1', function: { name: 'weather', arguments: '{}' } }] },
        { role: 'tool', tool_call_id: 't1', content: '晴' },
    ];
    assert.equal(isToolContinuation(messages), true);
    assert.equal(isToolContinuation([
        { role: 'user', content: '查天气' },
        { role: 'assistant', content: '', tool_calls: [{ id: 't1', function: {} }] },
        { role: 'tool', tool_call_id: 't1', content: '晴' },
        { role: 'tool', tool_call_id: 't1', content: '补充' },
    ]), true, '多条 tool 结果同属一轮');
});

test('isToolContinuation：普通回合与异常形态 → 非续接', () => {
    assert.equal(isToolContinuation([{ role: 'user', content: '你好' }]), false);
    assert.equal(isToolContinuation([
        { role: 'user', content: '你好' },
        { role: 'assistant', content: '好' },
    ]), false);
    // 尾部是 tool 结果，但前一条不是带 tool_calls 的 assistant（结果无主）
    assert.equal(isToolContinuation([
        { role: 'user', content: '你好' },
        { role: 'assistant', content: '好' },
        { role: 'tool', tool_call_id: 't9', content: '?' },
    ]), false);
    // 与服务端 trailingToolRound 同口径：尾部直接是带 tool_calls 的 assistant 也算工具轮
    assert.equal(isToolContinuation([
        { role: 'user', content: '查天气' },
        { role: 'assistant', content: '', tool_calls: [{ id: 't1', function: {} }] },
    ]), true);
    assert.equal(isToolContinuation([]), false);
    assert.equal(isToolContinuation(undefined), false);
});

test('runId：新回合自增、续接保持、CHAT_CHANGED 归零后重新自增', () => {
    const runState = { runId: 0 };
    assert.equal(advanceRunState(runState, isToolContinuation([{ role: 'user', content: 'hi' }])), 1);
    assert.equal(advanceRunState(runState, isToolContinuation([
        { role: 'assistant', tool_calls: [{ id: 't1' }] }, { role: 'tool', tool_call_id: 't1' },
    ])), 1, '工具递归保持');
    assert.equal(advanceRunState(runState, isToolContinuation([{ role: 'user', content: 'again' }])), 2);
    resetRunState(runState);
    assert.equal(runState.runId, 0);
    assert.equal(advanceRunState(runState, false), 1);
});

// ---------- 投影资格决策 ----------

function catalogFixture(overrides = {}) {
    const providers = [{
        providerId: 'main-relay', displayName: '主中转服务', protocol: 'OPENAI_CHAT_COMPLETIONS',
        baseUrl: 'https://relay.example.com/v1', credentialConfigured: true, state: 'ENABLED',
        revision: 12,
        models: [{
            profileKey: 'daily-chat', modelId: 'vendor/daily-chat', displayName: '日常对话',
            contextWindowTokens: 128000, maxOutputTokens: 8192, state: 'ENABLED',
            generationParams: { temperature: 0.8, topP: 0.95 },
        }],
    }];
    const purposes = [{
        purpose: 'FOREGROUND_CHAT', providerId: 'main-relay', profileKey: 'daily-chat',
        state: 'ENABLED', status: 'READY', revision: 8,
    }];
    return { providers, purposes, ...overrides };
}

test('resolveForegroundProjection：全部满足 → custom 源映射与期望值', () => {
    const { providers, purposes } = catalogFixture();
    const d = resolveForegroundProjection(purposes, providers);
    assert.equal(d.eligible, true);
    assert.equal(d.source, 'custom');
    assert.equal(d.markerField, 'custom_url');
    assert.equal(d.modelField, 'custom_model');
    assert.equal(d.modelSelector, '#custom_model_id');
    assert.equal(d.modelId, 'vendor/daily-chat');
    assert.equal(d.providerRevision, 12);
    assert.equal(d.bindingRevision, 8);
    assert.equal(d.contextWindowTokens, 128000);
    assert.equal(d.maxOutputTokens, 8192);
    assert.deepEqual(d.pinned, { temperature: 0.8, topP: 0.95 });
});

test('resolveForegroundProjection：RESPONSES/ANTHROPIC 协议分别映射 custom 与 claude', () => {
    const { purposes } = catalogFixture();
    const responses = resolveForegroundProjection(purposes, [{
        ...catalogFixture().providers[0], protocol: 'OPENAI_RESPONSES',
    }]);
    assert.equal(responses.source, 'custom');
    assert.equal(responses.markerField, 'custom_url');

    const anthropic = resolveForegroundProjection(purposes, [{
        ...catalogFixture().providers[0],
        protocol: 'ANTHROPIC_MESSAGES',
        models: [{ ...catalogFixture().providers[0].models[0], generationParams: {} }],
    }]);
    assert.equal(anthropic.source, 'claude');
    assert.equal(anthropic.markerField, 'reverse_proxy');
    assert.equal(anthropic.modelField, 'claude_model');
    assert.equal(anthropic.modelSelector, '#model_claude_select');
    assert.deepEqual(anthropic.pinned, {}, '未登记参数不钉住');
});

test('resolveForegroundProjection：资格失败分支给出具体 reason', () => {
    const { providers } = catalogFixture();
    const bind = (patch) => [{ purpose: 'FOREGROUND_CHAT', providerId: 'main-relay', profileKey: 'daily-chat', state: 'ENABLED', status: 'READY', revision: 8, ...patch }];
    assert.equal(resolveForegroundProjection([], providers).reason, 'no-binding');
    assert.equal(resolveForegroundProjection([{ purpose: 'EMBEDDING' }], providers).reason, 'no-binding');
    assert.equal(resolveForegroundProjection(bind({ status: 'PENDING_CONFIGURATION' }), providers).reason, 'binding-not-ready');
    assert.equal(resolveForegroundProjection(bind({ state: 'DISABLED' }), providers).reason, 'binding-disabled');
    assert.equal(resolveForegroundProjection(bind({ providerId: 'gone' }), providers).reason, 'provider-missing');
    assert.equal(resolveForegroundProjection(bind({}), [{ ...providers[0], state: 'DISABLED' }]).reason, 'provider-disabled');
    assert.equal(resolveForegroundProjection(bind({}), [{ ...providers[0], credentialConfigured: false }]).reason, 'credential-missing');
    assert.equal(resolveForegroundProjection(bind({ profileKey: 'gone' }), providers).reason, 'model-missing');
    assert.equal(resolveForegroundProjection(bind({}), [{
        ...providers[0], models: [{ ...providers[0].models[0], state: 'DISABLED' }],
    }]).reason, 'model-disabled');
    assert.equal(resolveForegroundProjection(bind({}), [{
        ...providers[0], models: [{ ...providers[0].models[0], contextWindowTokens: null }],
    }]).reason, 'context-missing');
    assert.equal(resolveForegroundProjection(bind({}), [{
        ...providers[0], protocol: 'SOMETHING_ELSE',
    }]).reason, 'protocol-unsupported');
    assert.ok(ineligibleReasonLabel('provider-disabled').includes('停用'));
});

// ---------- 设置内标记与偏离检测 ----------

test('settingsMarkerFor：决策 + scope → 设置内完整合法标记', () => {
    const { providers, purposes } = catalogFixture();
    const decision = resolveForegroundProjection(purposes, providers);
    const marker = settingsMarkerFor(decision, 'seraphina.png|blank|1');
    const parsed = parseBindingMarker(marker);
    assert.equal(parsed.providerId, 'main-relay');
    assert.equal(parsed.profileKey, 'daily-chat');
    assert.equal(parsed.providerRevision, 12);
    assert.equal(parsed.bindingRevision, 8);
    assert.equal(parsed.scope, 'seraphina.png|blank|1');
});

function settingsFixture(decision, patch = {}) {
    // 默认空串先落位，再按决策写入标记与模型字段（计算属性须在静态键之后，避免被覆盖）。
    return {
        chat_completion_source: decision.source,
        custom_url: '',
        reverse_proxy: '',
        custom_model: '',
        claude_model: '',
        [decision.markerField]: settingsMarkerFor(decision, 'a|b|1'),
        [decision.modelField]: decision.modelId,
        openai_max_context: decision.contextWindowTokens,
        openai_max_tokens: decision.maxOutputTokens,
        temp_openai: decision.pinned.temperature,
        top_p_openai: decision.pinned.topP,
        reasoning_effort: decision.pinned.reasoningEffort ?? 'auto',
        ...patch,
    };
}

test('diffProjection：投影刚写入的状态无偏离（scope 为 1 不等于刚生成 scope 也不算）', () => {
    const { providers, purposes } = catalogFixture();
    const decision = resolveForegroundProjection(purposes, providers);
    assert.deepEqual(diffProjection(settingsFixture(decision), decision), []);
    // scope 漂移（旧标记）不算偏离：身份字段一致
    assert.deepEqual(diffProjection(
        settingsFixture(decision, { [decision.markerField]: settingsMarkerFor(decision, 'other|chat|99') }),
        decision,
    ), []);
});

test('diffProjection：source / model / 窗口 / 输出 / 标记身份 各自独立检出', () => {
    const { providers, purposes } = catalogFixture();
    const decision = resolveForegroundProjection(purposes, providers);
    assert.deepEqual(diffProjection(settingsFixture(decision, { chat_completion_source: 'openai' }), decision), ['source']);
    assert.deepEqual(diffProjection(settingsFixture(decision, { custom_model: 'other-model' }), decision), ['model']);
    assert.deepEqual(diffProjection(settingsFixture(decision, { openai_max_context: 64000 }), decision), ['max-context']);
    assert.deepEqual(diffProjection(settingsFixture(decision, { openai_max_tokens: 4096 }), decision), ['max-tokens']);
    // pr 漂移（目录别处更新）→ 标记身份变化
    const driftedDecision = { ...decision, providerRevision: 13 };
    assert.deepEqual(diffProjection(settingsFixture(decision), driftedDecision), ['marker']);
    // 标记被清空 / 换成普通 URL
    assert.deepEqual(diffProjection(settingsFixture(decision, { custom_url: '' }), decision), ['marker']);
    assert.deepEqual(diffProjection(settingsFixture(decision, { custom_url: 'https://x.example/v1' }), decision), ['marker']);
});

test('diffProjection：非当前标记字段残留 vc-go 标记 → marker-residue（服务端按 custom_url 优先解析）', () => {
    const anthropic = resolveForegroundProjection(catalogFixture().purposes, [{
        ...catalogFixture().providers[0],
        protocol: 'ANTHROPIC_MESSAGES',
        models: [{ ...catalogFixture().providers[0].models[0], generationParams: {} }],
    }]);
    assert.deepEqual(diffProjection(settingsFixture(anthropic, {
        custom_url: 'vc-go://model-purposes/FOREGROUND_CHAT?provider=old&profile=x&pr=1&br=1',
    }), anthropic), ['marker-residue']);
    // 用户自己的普通 custom URL 不算残留
    assert.deepEqual(diffProjection(settingsFixture(anthropic, {
        custom_url: 'https://user-own.example/v1',
    }), anthropic), []);
});

test('diffProjection：钉住参数差 >1e-6 才算偏离；未钉住参数不比较', () => {
    const { providers, purposes } = catalogFixture();
    const decision = resolveForegroundProjection(purposes, providers);
    assert.deepEqual(diffProjection(settingsFixture(decision, { temp_openai: 0.8 + 1e-9 }), decision), [], '1e-9 内不算');
    assert.deepEqual(diffProjection(settingsFixture(decision, { temp_openai: 0.9 }), decision), ['temperature']);
    assert.deepEqual(diffProjection(settingsFixture(decision, { top_p_openai: 0.95 - 1e-9 }), decision), []);
    assert.deepEqual(diffProjection(settingsFixture(decision, { top_p_openai: 0.5 }), decision), ['top-p']);
    // 未钉住（目录无 generationParams 数值）时用户自由改不算偏离
    const unpinned = resolveForegroundProjection(purposes, [{
        ...providers[0], models: [{ ...providers[0].models[0], generationParams: {} }],
    }]);
    assert.deepEqual(diffProjection(settingsFixture(unpinned, { temp_openai: 1.7, top_p_openai: 0.1 }), unpinned), []);
});

test('driftSummary：字段列表映射为中文标签', () => {
    assert.equal(driftSummary(['source', 'model']), '连接源、模型');
    assert.equal(driftSummary([]), '');
    assert.equal(driftSummary(['marker-residue']), '残留的旧绑定标记');
    assert.equal(driftSummary(['reasoning-effort']), '推理等级（Go 已钉住）');
});

// ---------- 钉住推理等级（custom 源始终发送 reasoning_effort，必须投影） ----------

test('resolveForegroundProjection：custom 两协议提取 reasoningEffort；ANTHROPIC 不提取', () => {
    const { purposes } = catalogFixture();
    const withEffort = (protocol) => resolveForegroundProjection(purposes, [{
        ...catalogFixture().providers[0],
        protocol,
        models: [{
            ...catalogFixture().providers[0].models[0],
            generationParams: { temperature: 0.8, topP: 0.95, reasoningEffort: 'low' },
        }],
    }]);
    assert.equal(withEffort('OPENAI_CHAT_COMPLETIONS').pinned.reasoningEffort, 'low');
    assert.equal(withEffort('OPENAI_RESPONSES').pinned.reasoningEffort, 'low');
    // Anthropic 由原生 thinking 预算承载，服务端对该协议跳过该字段核对 → 不进 pinned
    assert.equal(withEffort('ANTHROPIC_MESSAGES').pinned.reasoningEffort, undefined);
    // 空串视为未钉住
    const empty = resolveForegroundProjection(purposes, [{
        ...catalogFixture().providers[0],
        models: [{
            ...catalogFixture().providers[0].models[0],
            generationParams: { reasoningEffort: '' },
        }],
    }]);
    assert.equal(empty.pinned.reasoningEffort, undefined);
});

test('reasoningEffortWritePlan：六档走原生 select（input 事件）；扩展值直写；未钉住为 null', () => {
    assert.deepEqual(NATIVE_REASONING_EFFORTS, ['auto', 'low', 'medium', 'high', 'min', 'max']);
    // ST 监听 input（openai.js:7179）：trigger('change') 不会同步 oai_settings.reasoning_effort
    assert.deepEqual(
        reasoningEffortWritePlan('low'),
        { kind: 'native-option', selector: '#openai_reasoning_effort', eventName: 'input', value: 'low' },
    );
    for (const lv of ['auto', 'medium', 'high', 'min', 'max']) {
        assert.equal(reasoningEffortWritePlan(lv).kind, 'native-option', lv);
    }
    assert.deepEqual(
        reasoningEffortWritePlan('xhigh'),
        { kind: 'direct', field: 'reasoning_effort', value: 'xhigh' },
    );
    assert.equal(reasoningEffortWritePlan(undefined), null);
    assert.equal(reasoningEffortWritePlan(null), null);
    assert.equal(reasoningEffortWritePlan(''), null);
});

test('diffProjection：钉住推理等级时 auto / 任何不同值都算偏离；相等与未钉住不检测', () => {
    const { purposes } = catalogFixture();
    const pinnedDecision = resolveForegroundProjection(purposes, [{
        ...catalogFixture().providers[0],
        models: [{
            ...catalogFixture().providers[0].models[0],
            generationParams: { reasoningEffort: 'low' },
        }],
    }]);
    assert.equal(pinnedDecision.pinned.reasoningEffort, 'low');
    assert.deepEqual(diffProjection(settingsFixture(pinnedDecision), pinnedDecision), [], '投影刚写入（=low）无偏离');
    assert.deepEqual(
        diffProjection(settingsFixture(pinnedDecision, { reasoning_effort: 'auto' }), pinnedDecision),
        ['reasoning-effort'],
        '投影前的 ST 默认 auto 也算偏离',
    );
    assert.deepEqual(
        diffProjection(settingsFixture(pinnedDecision, { reasoning_effort: 'high' }), pinnedDecision),
        ['reasoning-effort'],
    );

    const unpinnedDecision = resolveForegroundProjection(purposes, [{
        ...catalogFixture().providers[0],
        models: [{
            ...catalogFixture().providers[0].models[0],
            generationParams: { temperature: 0.8, topP: 0.95 },
        }],
    }]);
    assert.equal(unpinnedDecision.pinned.reasoningEffort, undefined);
    assert.deepEqual(
        diffProjection(settingsFixture(unpinnedDecision, { reasoning_effort: 'max' }), unpinnedDecision),
        [],
        '未钉住时用户自由改不算偏离',
    );
});

// ---------- 每请求 generate_data 重写 ----------

test('rewriteGenerateData：custom 源写 custom_url；claude 源写 reverse_proxy；decision 未就绪不动', () => {
    const { providers, purposes } = catalogFixture();
    const custom = resolveForegroundProjection(purposes, providers);
    const customData = { chat_completion_source: 'custom', custom_url: settingsMarkerFor(custom, 'a|b|1') };
    assert.equal(rewriteGenerateData(customData, custom, 'a|b|2'), true);
    assert.equal(parseBindingMarker(customData.custom_url).scope, 'a|b|2');

    const claude = resolveForegroundProjection(purposes, [{
        ...providers[0], protocol: 'ANTHROPIC_MESSAGES',
        models: [{ ...providers[0].models[0], generationParams: {} }],
    }]);
    const claudeData = { chat_completion_source: 'claude' };
    assert.equal(rewriteGenerateData(claudeData, claude, 'g|c|1'), true);
    assert.ok(claudeData.reverse_proxy.startsWith(MARKER_SCHEME));
    assert.equal(parseBindingMarker(claudeData.reverse_proxy).scope, 'g|c|1');

    assert.equal(rewriteGenerateData({ custom_url: '' }, { eligible: false, reason: 'no-binding' }, 'x'), false);
    assert.equal(rewriteGenerateData(null, custom, 'x'), false);
    // 资格未就绪时保留原值：无标记生成会被服务端 VC_UNMANAGED_GENERATION 拒绝（预期防线）
    const untouched = { chat_completion_source: 'custom', custom_url: 'https://plain.example/v1' };
    rewriteGenerateData(untouched, { eligible: false }, 'x');
    assert.equal(untouched.custom_url, 'https://plain.example/v1');
});

function managedCustomDecision() {
    const { purposes } = catalogFixture();
    return resolveForegroundProjection(purposes, [{
        ...catalogFixture().providers[0],
        models: [{
            ...catalogFixture().providers[0].models[0],
            generationParams: { temperature: 0.8, topP: 0.95, reasoningEffort: 'max' },
        }],
    }]);
}

test('受管 custom：ST 已把 max 映射成 high 时，恢复为界面值 max', () => {
    const decision = managedCustomDecision();
    assert.equal(decision.eligible, true);
    assert.equal(decision.source, 'custom');
    assert.equal(decision.pinned.reasoningEffort, 'max');
    // getReasoningEffort 对 CUSTOM 把 max 收成 high 之后，generate_data 里已是 high。
    const data = { chat_completion_source: 'custom', reasoning_effort: 'high', custom_url: 'keep' };
    assert.equal(restoreManagedReasoningEffort(data, decision, { reasoning_effort: 'max' }), true);
    assert.equal(data.reasoning_effort, 'max');
    assert.equal(data.custom_url, 'keep');
    // 写入的是界面值，不是钉住值：手改成 high 必须原样留下，交给服务端 409。
    const handEdited = { reasoning_effort: 'low' };
    assert.equal(restoreManagedReasoningEffort(handEdited, decision, { reasoning_effort: 'high' }), true);
    assert.equal(handEdited.reasoning_effort, 'high');
});

test('受管 custom：界面为 auto 时不写入 reasoning_effort', () => {
    const decision = managedCustomDecision();
    const data = { chat_completion_source: 'custom', reasoning_effort: undefined, custom_url: 'keep' };
    assert.equal(restoreManagedReasoningEffort(data, decision, { reasoning_effort: 'auto' }), false);
    assert.equal(data.reasoning_effort, undefined);
    assert.equal(data.custom_url, 'keep');
});

test('非受管：不改 reasoning_effort', () => {
    const unmanaged = { chat_completion_source: 'custom', reasoning_effort: 'high', custom_url: 'https://plain.example/v1' };
    assert.equal(
        restoreManagedReasoningEffort(unmanaged, { eligible: false, reason: 'no-binding' }, { reasoning_effort: 'max' }),
        false,
    );
    assert.equal(unmanaged.reasoning_effort, 'high');
    assert.equal(unmanaged.custom_url, 'https://plain.example/v1');

    const { purposes, providers } = catalogFixture();
    const claude = resolveForegroundProjection(purposes, [{
        ...providers[0],
        protocol: 'ANTHROPIC_MESSAGES',
        models: [{ ...providers[0].models[0], generationParams: { reasoningEffort: 'max' } }],
    }]);
    assert.equal(claude.eligible, true);
    assert.equal(claude.source, 'claude');
    const claudeData = { chat_completion_source: 'claude', reasoning_effort: 'high' };
    assert.equal(restoreManagedReasoningEffort(claudeData, claude, { reasoning_effort: 'max' }), false);
    assert.equal(claudeData.reasoning_effort, 'high');
});

test('生命周期串测：READY 多轮 + CHAT_CHANGED 后 scope 变化符合冻结判据', () => {
    const { providers, purposes } = catalogFixture();
    const decision = resolveForegroundProjection(purposes, providers);
    const runState = { runId: 0 };
    const hostCtx = () => ({ groupId: null, characters: [{ avatar: 'seraphina.png' }], characterId: 0, chatId: 'chat-a' });

    // 回合 1：用户消息 → runId 1
    let data = { custom_url: '' };
    advanceRunState(runState, isToolContinuation([{ role: 'user', content: 'hi' }]));
    rewriteGenerateData(data, decision, buildScope(characterKeyOf(hostCtx()), chatKeyOf(hostCtx().chatId), runState.runId));
    assert.equal(parseBindingMarker(data.custom_url).scope, 'seraphina.png|chat-a|1');

    // 同轮工具递归（assistant tool_calls + tool 结果）→ runId 保持
    data = { custom_url: '' };
    advanceRunState(runState, isToolContinuation([
        { role: 'assistant', tool_calls: [{ id: 't1' }] }, { role: 'tool', tool_call_id: 't1' },
    ]));
    rewriteGenerateData(data, decision, buildScope(characterKeyOf(hostCtx()), chatKeyOf(hostCtx().chatId), runState.runId));
    assert.equal(parseBindingMarker(data.custom_url).scope, 'seraphina.png|chat-a|1');

    // 新用户回合 → runId 2
    advanceRunState(runState, isToolContinuation([{ role: 'user', content: 'next' }]));
    assert.equal(runState.runId, 2);

    // 切换聊天：归零后新回合从 1 开始，且 chatKey 变化形成新的续接隔离键
    resetRunState(runState);
    const newCtx = { ...hostCtx(), chatId: 'chat-b' };
    advanceRunState(runState, false);
    data = { custom_url: '' };
    rewriteGenerateData(data, decision, buildScope(characterKeyOf(newCtx), chatKeyOf(newCtx.chatId), runState.runId));
    assert.equal(parseBindingMarker(data.custom_url).scope, 'seraphina.png|chat-b|1');
});

// ---------- 横幅三态模型 ----------

test('bannerModel：ready / drift / pending 三态与固定测试说明', () => {
    const { providers, purposes } = catalogFixture();
    const decision = resolveForegroundProjection(purposes, providers);

    const ready = bannerModel({ phase: 'ready', decision, drifts: [] });
    assert.equal(ready.phase, 'ready');
    assert.ok(ready.detail.includes('主中转服务'));
    assert.ok(ready.detail.includes('日常对话'));
    assert.equal(ready.revisions, '目录版本 pr 12 · br 8');
    assert.deepEqual(ready.actions, []);

    const drift = bannerModel({ phase: 'ready', decision, drifts: ['source', 'model'] });
    assert.equal(drift.phase, 'drift');
    assert.ok(drift.detail.includes('连接源、模型'));
    assert.deepEqual(drift.actions, ['reproject', 'open-settings']);

    const pending = bannerModel({ phase: 'ready', decision: { eligible: false, reason: 'credential-missing' }, drifts: [] });
    assert.equal(pending.phase, 'pending');
    assert.ok(pending.detail.includes('未配置密钥'));
    assert.deepEqual(pending.actions, ['open-settings']);
    assert.ok(pending.detail.includes('拒绝'), '说明未配置会被服务端拒绝');

    const error = bannerModel({ phase: 'error', decision: null, drifts: [], loadError: '网络中断' });
    assert.equal(error.phase, 'pending');
    assert.ok(error.detail.includes('网络中断'));
});
