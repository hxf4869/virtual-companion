// V2-W03-S3 · 模型设置页纯逻辑测试（Node --test）。
// 覆盖：endpoint 规范化（对齐 backend ResolveEndpoint 真源）、字段边界（V119）、
// 密钥三态、能力状态、推理等级（V140 小写约束与额外等级保留）、PUT 载荷、
// 用途绑定与计价显示。不测 DOM 结构。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    PROTOCOLS,
    normalizeEndpoint,
    validateProviderForm,
    validateModelForm,
    validateCredentialPlan,
    keyPlan,
    buildProviderPut,
    buildBindingPut,
    providerDraftFromApi,
    modelDraftFromApi,
    newProviderDraft,
    newModelDraft,
    cloneModelDraft,
    draftDiffers,
    canBindPurpose,
    buildBindingOptions,
    formatPricing,
    conflictInfo,
    unrecordedModels,
    REASONING_LEVELS,
    isLegalReasoningLevel,
    extraReasoningLevels,
    reasoningLevelLabel,
    CAPABILITY_FIELDS,
    TOOL_CALLS_UNVERIFIED_NOTE,
    TOOL_CALLS_VERIFY_ACTION,
    TOOL_CALLS_VERIFY_HINT,
    TOOL_CALLS_VERIFIED_NOTE,
    toolCallVerificationFailure,
} from '../extension/vc-model-settings/model-logic.js';

// ---------- endpoint 规范化（真源：ResolveEndpoint） ----------

test('normalizeEndpoint: 普通 Base 追加完整协议路径', () => {
    const r = normalizeEndpoint('https://api.example.com', 'ANTHROPIC_MESSAGES');
    assert.equal(r.ok, true);
    assert.equal(r.finalUrl, 'https://api.example.com/v1/messages');
    assert.equal(r.source, 'plain');
});

test('normalizeEndpoint: Base 已带 /v1 只追加后缀，不双拼', () => {
    for (const p of PROTOCOLS) {
        const r = normalizeEndpoint('https://api.example.com/v1', p.id);
        assert.equal(r.ok, true, p.id);
        assert.equal(r.finalUrl, `https://api.example.com${p.endpoint}`);
        assert.equal(r.source, 'with-v1');
    }
});

test('normalizeEndpoint: 以接口路径结尾被拒绝，并给出可转换的 Base URL', () => {
    const cases = [
        ['https://api.example.com/v1/messages', 'ANTHROPIC_MESSAGES', 'https://api.example.com/v1'],
        ['https://api.example.com/v1/chat/completions', 'OPENAI_CHAT_COMPLETIONS', 'https://api.example.com/v1'],
        ['https://api.example.com/api/v1/responses', 'OPENAI_RESPONSES', 'https://api.example.com/api/v1'],
        ['https://api.example.com/messages', 'ANTHROPIC_MESSAGES', 'https://api.example.com'],
        ['https://api.example.com/v1/models', 'OPENAI_CHAT_COMPLETIONS', 'https://api.example.com/v1'],
    ];
    for (const [input, protocol, suggested] of cases) {
        const r = normalizeEndpoint(input, protocol);
        assert.equal(r.ok, false, input);
        assert.equal(r.kind, 'full-endpoint', input);
        assert.equal(r.suggestedBaseUrl, suggested, input);
    }
});

test('normalizeEndpoint: 拒绝 userinfo / 查询参数 / 锚点 / 编码路径', () => {
    for (const input of [
        'https://user:pw@api.example.com',
        'https://user@api.example.com',
        'https://api.example.com/v1?key=1',
        'https://api.example.com#frag',
        'https://api.example.com/a%20b',
    ]) {
        const r = normalizeEndpoint(input, 'OPENAI_RESPONSES');
        assert.equal(r.ok, false, input);
        assert.ok(!r.kind, input);
    }
});

test('normalizeEndpoint: 拒绝非法路径片段、裸 IP、localhost、非 https', () => {
    for (const input of [
        'https://api.example.com/a//b',
        'https://api.example.com/a/./b',
        'https://api.example.com/a/../b',
        'https://api.example.com/a/..',
        'https://10.0.0.1',
        'https://localhost',
        'https://intranet',
        'http://api.example.com',
        'ftp://api.example.com',
        'api.example.com',
    ]) {
        const r = normalizeEndpoint(input, 'ANTHROPIC_MESSAGES');
        assert.equal(r.ok, false, input);
    }
});

test('normalizeEndpoint: 127.0.0.1 回环地址允许 http 并带提示', () => {
    const r = normalizeEndpoint('http://127.0.0.1:8743', 'OPENAI_CHAT_COMPLETIONS');
    assert.equal(r.ok, true);
    assert.equal(r.finalUrl, 'http://127.0.0.1:8743/v1/chat/completions');
    assert.match(r.hint, /本地/);
});

// ---------- 供应商表单边界（V119 / ValidateProviderID） ----------

test('providerId 规则：拒绝大写、下划线、数字开头，接受小写连字符', () => {
    const form = (id) => ({ displayName: 'x', protocol: 'OPENAI_RESPONSES', baseUrl: 'https://api.example.com', providerId: id });
    assert.ok(validateProviderForm(form('MyProvider'), { isNew: true }).errors.providerId);
    assert.ok(validateProviderForm(form('my_provider'), { isNew: true }).errors.providerId);
    assert.ok(validateProviderForm(form('1abc'), { isNew: true }).errors.providerId);
    assert.ok(!validateProviderForm(form('a'.repeat(64)), { isNew: true }).errors.providerId, '64 字符合法');
    assert.ok(validateProviderForm(form('a'.repeat(65)), { isNew: true }).errors.providerId);
    assert.ok(!validateProviderForm(form('a'.repeat(64 - 1)), { isNew: true }).errors.providerId);
    assert.ok(!validateProviderForm(form('my-provider-2'), { isNew: true }).errors.providerId);
});

test('显示名边界：80 字符通过，81 拒绝', () => {
    const form = (name) => ({ displayName: name, protocol: 'OPENAI_RESPONSES', baseUrl: 'https://api.example.com', providerId: 'x' });
    assert.ok(!validateProviderForm(form('a'.repeat(80))).errors.displayName);
    assert.ok(validateProviderForm(form('a'.repeat(81))).errors.displayName);
    assert.ok(validateProviderForm(form('   ')).errors.displayName);
});

// ---------- 模型表单边界 ----------

function modelFixture(overrides = {}) {
    return {
        profileKey: 'm1', modelId: 'model-x', displayName: '模型X',
        contextWindowTokens: 200000, maxOutputTokens: 8192,
        state: 'ENABLED', priority: 1,
        capabilities: {}, reasoningLevels: ['low', 'medium'],
        generationParams: { temperature: '', topP: '', reasoningEffort: '' },
        pricing: { currency: '', inputPerMillionTokens: '', outputPerMillionTokens: '', verifiedOn: null },
        boundPurposes: [], editedSubs: new Set(), touchedCaps: new Set(),
        isNew: false, isClone: false,
        ...overrides,
    };
}

test('token 边界：真实后端边界 + maxOutput < context；无 80% 比例限制', () => {
    assert.ok(validateModelForm(modelFixture({ maxOutputTokens: 200000 })).maxOutputTokens);
    // 90% 属于合法配置：预留是否足够由生成时完整请求校验负责，表单不额外限制。
    assert.ok(!validateModelForm(modelFixture({ contextWindowTokens: 100000, maxOutputTokens: 90000 })).maxOutputTokens);
    assert.ok(!validateModelForm(modelFixture({ contextWindowTokens: 100000, maxOutputTokens: 99999 })).maxOutputTokens);
    assert.ok(!validateModelForm(modelFixture({ contextWindowTokens: 100000, maxOutputTokens: 80000 })).maxOutputTokens);
    assert.ok(validateModelForm(modelFixture({ contextWindowTokens: 2000001 })).contextWindowTokens);
    assert.ok(validateModelForm(modelFixture({ maxOutputTokens: 262145 })).maxOutputTokens);
    assert.ok(validateModelForm(modelFixture({ maxOutputTokens: 0 })).maxOutputTokens);
});

test('modelId / 显示名边界按 V119', () => {
    assert.ok(validateModelForm(modelFixture({ modelId: 'x'.repeat(201) })).modelId);
    assert.ok(validateModelForm(modelFixture({ modelId: 'a\x01b' })).modelId);
    assert.ok(validateModelForm(modelFixture({ displayName: 'x'.repeat(101) })).displayName);
    assert.ok(!validateModelForm(modelFixture({ modelId: 'vendor/model.v2:8x' })).modelId);
});

test('参数就近校验：温度 / topP / 推理等级', () => {
    assert.ok(validateModelForm(modelFixture({ generationParams: { temperature: '2.5', topP: '', reasoningEffort: '' } })).temperature);
    assert.ok(validateModelForm(modelFixture({ generationParams: { temperature: '', topP: '1.2', reasoningEffort: '' } })).topP);
    assert.ok(validateModelForm(modelFixture({ generationParams: { temperature: '', topP: '', reasoningEffort: 'high' } })).reasoningEffort);
    assert.ok(validateModelForm(modelFixture({ reasoningLevels: [], generationParams: { temperature: '', topP: '', reasoningEffort: 'low' } })).reasoningEffort);
    assert.ok(!validateModelForm(modelFixture({ generationParams: { temperature: '1', topP: '0.9', reasoningEffort: 'low' } })).reasoningEffort);
});

test('计价：填价必须选币种；未知显示未配置而非免费', () => {
    const errs = validateModelForm(modelFixture({ pricing: { currency: '', inputPerMillionTokens: '3', outputPerMillionTokens: '', verifiedOn: null } }));
    assert.ok(errs.pricingCurrency);
    assert.ok(validateModelForm(modelFixture({ pricing: { currency: 'USD', inputPerMillionTokens: '-1', outputPerMillionTokens: '', verifiedOn: null } })).pricingInput);
    assert.equal(formatPricing({ currency: '', inputPerMillionTokens: '', outputPerMillionTokens: '' }), '未配置');
    assert.equal(formatPricing(null), '未配置');
    assert.ok(!formatPricing({ currency: 'USD', inputPerMillionTokens: '3', outputPerMillionTokens: '15' }).includes('免费'));
    assert.match(formatPricing({ currency: 'USD', inputPerMillionTokens: '3', outputPerMillionTokens: '15' }), /USD \$3\.00/);
    assert.match(formatPricing({ currency: 'CNY', inputPerMillionTokens: '3', outputPerMillionTokens: '15', verifiedOn: '2026-10-01' }), /核验/);
    assert.match(formatPricing({ currency: 'USD', inputPerMillionTokens: '3', outputPerMillionTokens: '' }), /未配置（币种未知）|未配置/);
});

// ---------- 密钥三态 ----------

test('keyPlan 三态：无 / 已配置 / 替换 / 清除', () => {
    assert.equal(keyPlan({ credential: '', clearCredential: false }, false).action, 'none');
    assert.equal(keyPlan({ credential: '', clearCredential: false }, true).action, 'keep');
    assert.equal(keyPlan({ credential: 'sk-new', clearCredential: false }, true).action, 'will-replace');
    assert.equal(keyPlan({ credential: '', clearCredential: true }, true).action, 'will-clear');
});

test('清除密钥必须停用；新供应商无密钥只能停用草稿', () => {
    assert.ok(validateCredentialPlan(
        { clearCredential: true, credential: '', state: 'ENABLED' },
        { isNew: false, credentialConfigured: true },
    ).state);
    assert.ok(!validateCredentialPlan(
        { clearCredential: true, credential: '', state: 'DISABLED' },
        { isNew: false, credentialConfigured: true },
    ).state);
    assert.ok(validateCredentialPlan(
        { clearCredential: false, credential: '', state: 'ENABLED' },
        { isNew: true, credentialConfigured: false },
    ).state);
    assert.ok(!validateCredentialPlan(
        { clearCredential: false, credential: '', state: 'DISABLED' },
        { isNew: true, credentialConfigured: false },
    ).state);
    assert.ok(!validateCredentialPlan(
        { clearCredential: false, credential: 'sk-x', state: 'ENABLED' },
        { isNew: true, credentialConfigured: false },
    ).state);
});

// ---------- 推理等级（V140 小写约束） ----------

test('推理等级内部值为小写，V140 合法性校验', () => {
    assert.deepEqual(REASONING_LEVELS, ['low', 'medium', 'high']);
    assert.equal(isLegalReasoningLevel('low'), true);
    assert.equal(isLegalReasoningLevel('minimal'), true);
    assert.equal(isLegalReasoningLevel('LOW'), false);
    assert.equal(isLegalReasoningLevel('a'.repeat(33)), false);
    assert.equal(isLegalReasoningLevel('has space'), false);
    assert.equal(reasoningLevelLabel('low'), '低');
    assert.equal(reasoningLevelLabel('minimal'), 'minimal');
});

test('服务端额外合法等级被保留，不静默丢弃', () => {
    const draft = modelDraftFromApi({
        profileKey: 'm', modelId: 'm', displayName: 'm', maxOutputTokens: 100,
        reasoningLevels: ['low', 'minimal', 'HIGH_ILLEGAL'],
    });
    assert.deepEqual(draft.reasoningLevels, ['low', 'minimal']);
    assert.deepEqual(extraReasoningLevels(draft.reasoningLevels), ['minimal']);
    draft.editedSubs.add('reasoningLevels');
    const put = buildProviderPut(providerDraftWithModels([draft]));
    assert.deepEqual(put.models[0].reasoningLevels, ['low', 'minimal']);
});

function providerDraftWithModels(models) {
    return { ...newProviderDraft(), displayName: 'p', baseUrl: 'https://api.example.com', protocol: 'OPENAI_RESPONSES', revision: 7, models };
}

// ---------- PUT 载荷 ----------

test('PUT：expectedRevision 必带；credential 只在输入时携带；clearCredential 显式', () => {
    const draft = providerDraftWithModels([]);
    draft.credential = '';
    draft.clearCredential = false;
    let put = buildProviderPut(draft);
    assert.equal(put.expectedRevision, 7);
    assert.ok(!('credential' in put));
    assert.ok(!('clearCredential' in put));
    draft.credential = 'sk-1';
    put = buildProviderPut(draft);
    assert.equal(put.credential, 'sk-1');
    draft.credential = '';
    draft.clearCredential = true;
    put = buildProviderPut(draft);
    assert.equal(put.clearCredential, true);
    assert.ok(!('credential' in put));
});

test('PUT models：未编辑模型不带四个子对象（保留语义）；编辑后整体替换', () => {
    const untouched = modelDraftFromApi({
        profileKey: 'a', modelId: 'a', displayName: 'a', maxOutputTokens: 10,
        capabilities: { toolCalls: 'VERIFIED' }, reasoningLevels: ['low'],
        generationParams: { temperature: 0.5 }, pricing: { currency: 'USD' },
    });
    let put = buildProviderPut(providerDraftWithModels([untouched]));
    assert.equal(put.models[0].profileKey, 'a');
    for (const key of ['capabilities', 'reasoningLevels', 'generationParams', 'pricing']) {
        assert.ok(!(key in put.models[0]), key);
    }
    const edited = modelDraftFromApi({
        profileKey: 'b', modelId: 'b', displayName: 'b', maxOutputTokens: 10,
        capabilities: { toolCalls: 'VERIFIED', imageInput: 'DECLARED' },
    });
    edited.editedSubs.add('capabilities');
    edited.touchedCaps.add('toolCalls');
    edited.capabilities.toolCalls = 'UNSUPPORTED';
    put = buildProviderPut(providerDraftWithModels([edited]));
    assert.equal(put.models[0].capabilities.toolCalls, 'UNSUPPORTED');
    assert.equal(put.models[0].capabilities.imageInput, 'DECLARED');
    assert.equal(Object.keys(put.models[0].capabilities).length, 9, '整体替换为完整能力对象');
});

test('PUT capabilities：未触碰的 VERIFIED 透传保留；触碰字段不得声明 VERIFIED', () => {
    const model = modelDraftFromApi({
        profileKey: 'c', modelId: 'c', displayName: 'c', maxOutputTokens: 10,
        capabilities: { toolCalls: 'VERIFIED', imageInput: 'DECLARED' },
    });
    model.editedSubs.add('capabilities'); // 用户改了 imageInput，toolCalls 未触碰
    model.capabilities.imageInput = 'UNSUPPORTED';
    const put = buildProviderPut(providerDraftWithModels([model]));
    assert.equal(put.models[0].capabilities.toolCalls, 'VERIFIED');
    assert.equal(put.models[0].capabilities.imageInput, 'UNSUPPORTED');

    const forged = modelFixture({ editedSubs: new Set(['capabilities']), touchedCaps: new Set(['toolCalls']), capabilities: { toolCalls: 'VERIFIED' } });
    assert.ok(validateModelForm(forged).capabilities);
});

test('克隆：整体替换子对象，VERIFIED 降级为 DECLARED，不影响原配置', () => {
    const source = modelDraftFromApi({
        profileKey: 'src', modelId: 'src', displayName: '原配置', maxOutputTokens: 10,
        capabilities: { toolCalls: 'VERIFIED' }, boundPurposes: ['FOREGROUND_CHAT'],
    });
    const clone = cloneModelDraft(source, { profileKey: 'src-copy', displayName: '原配置（副本）' });
    const put = buildProviderPut(providerDraftWithModels([source, clone]));
    assert.equal(put.models.find((m) => m.profileKey === 'src-copy').capabilities.toolCalls, 'DECLARED');
    assert.deepEqual(clone.boundPurposes, []);
    // 原配置未编辑：不带子对象，不受克隆影响。
    assert.ok(!('capabilities' in put.models.find((m) => m.profileKey === 'src')));
});

test('能力字段全集与四态合法', () => {
    assert.equal(CAPABILITY_FIELDS.length, 9);
    for (const field of CAPABILITY_FIELDS) {
        const model = modelFixture({ editedSubs: new Set(['capabilities']) });
        model.capabilities[field.key] = 'DECLARED';
        assert.ok(!validateModelForm(model).capabilities, field.key);
        model.capabilities[field.key] = 'BOGUS';
        assert.ok(validateModelForm(model).capabilities, field.key);
    }
});

// ---------- 用途绑定 ----------

test('EMBEDDING 不可绑定聊天模型；选项只含启用的供应商与模型', () => {
    assert.equal(canBindPurpose('EMBEDDING'), false);
    for (const p of ['FOREGROUND_CHAT', 'MEMORY_EXTRACTION_DEDUP_SUMMARY', 'BACKGROUND_GREETINGS', 'STORY_DIRECTOR', 'NPC_DIALOGUE']) {
        assert.equal(canBindPurpose(p), true);
    }
    const options = buildBindingOptions([
        { providerId: 'p1', displayName: '可用商', state: 'ENABLED', models: [{ profileKey: 'm1', displayName: 'M1', state: 'ENABLED' }, { profileKey: 'm2', displayName: 'M2', state: 'DISABLED' }] },
        { providerId: 'p2', displayName: '停用商', state: 'DISABLED', models: [{ profileKey: 'm3', displayName: 'M3', state: 'ENABLED' }] },
    ]);
    assert.deepEqual(options.map((o) => o.value), ['', 'p1::m1']);
});

test('绑定 PUT：形状与 expectedRevision；空引用不带 providerId', () => {
    let put = buildBindingPut({ providerId: 'p1', profileKey: 'm1', state: 'ENABLED', revision: 4 });
    assert.deepEqual(put, { providerId: 'p1', profileKey: 'm1', state: 'ENABLED', expectedRevision: 4 });
    put = buildBindingPut({ providerId: '', profileKey: '', state: 'ENABLED', revision: 4 });
    assert.ok(!('providerId' in put));
    assert.ok(!('profileKey' in put));
    assert.equal(put.expectedRevision, 4);
});

// ---------- 冲突与草稿 ----------

test('conflictInfo 只解析 revision 冲突的当前版本号', () => {
    assert.equal(conflictInfo({ kind: 'conflict-revision', details: { currentRevision: 12 } }).currentRevision, 12);
    assert.equal(conflictInfo({ kind: 'invalid' }), null);
    assert.equal(conflictInfo(null), null);
});

test('draftDiffers：未改不动、字段改动与密钥输入都识别', () => {
    const draft = providerDraftWithModels([modelDraftFromApi({ profileKey: 'a', modelId: 'a', displayName: 'a', maxOutputTokens: 10 })]);
    const original = structuredClone(draft);
    assert.equal(draftDiffers(draft, original), false);
    draft.displayName = '改名';
    assert.equal(draftDiffers(draft, original), true);
    draft.displayName = original.displayName;
    draft.credential = 'sk-typed';
    assert.equal(draftDiffers(draft, original), true);
    assert.equal(draftDiffers(draft, null), true);
});

test('新建模型草稿默认值为空，配置标识在保存前兜底为 modelId', () => {
    const m = newModelDraft();
    assert.equal(m.isNew, true);
    assert.equal(m.contextWindowTokens, '');
    m.modelId = 'gpt-example';
    m.profileKey = m.modelId;
    const put = buildProviderPut(providerDraftWithModels([m]));
    assert.equal(put.models[0].profileKey, 'gpt-example');
    assert.ok(put.models[0].capabilities, '新建模型整体替换子对象');
});

// ---------- 连接检查（check-only discover） ----------

test('unrecordedModels：筛出未收录模型；已收录 / 重复条目 / 空 ID 过滤', () => {
    const draftModels = [{ modelId: 'vendor/daily-chat' }, { modelId: 'vendor/kept' }];
    const found = [
        { modelId: 'vendor/daily-chat', displayName: '已收录' },
        { modelId: 'vendor/new-one', displayName: '新模型' },
        { modelId: 'vendor/new-one', displayName: '服务方重复条目' },
        { modelId: '   ', displayName: '空 ID' },
        { modelId: '', displayName: '缺 ID' },
    ];
    assert.deepEqual(unrecordedModels(found, draftModels), [
        { modelId: 'vendor/new-one', displayName: '新模型' },
    ]);
    assert.deepEqual(unrecordedModels(null, draftModels), []);
    assert.deepEqual(unrecordedModels(found, null), [
        { modelId: 'vendor/daily-chat', displayName: '已收录' },
        { modelId: 'vendor/new-one', displayName: '新模型' },
    ]);
    assert.deepEqual(unrecordedModels([], []), []);
});

test('工具调用验证失败只按原因码显示短句', () => {
    assert.equal(toolCallVerificationFailure({ code: 'TOOL_CALL_MISMATCH', message: '北京 leak_marker_xyz' }), '未通过：模型没有按要求调用指定工具');
    assert.equal(toolCallVerificationFailure({ code: 'UPSTREAM_MALFORMED' }), '未通过：模型返回的工具调用无法识别');
    assert.equal(toolCallVerificationFailure({ code: 'UPSTREAM_UNAVAILABLE' }), '未通过：模型服务暂时不可用');
    assert.equal(toolCallVerificationFailure({ code: 'CREDENTIAL_MISSING' }), '未通过：供应商密钥未配置');
    assert.equal(toolCallVerificationFailure({ code: 'MODEL_NOT_FOUND' }), '未通过：找不到这个模型配置');
    assert.equal(toolCallVerificationFailure({ code: 'USAGE_REJECTED' }), '未通过：这次调用的用量没有记上');
    assert.equal(toolCallVerificationFailure({ code: 'NO_SUCH', message: 'upstream body' }), '未通过：这次没有完成验证');
    assert.equal(TOOL_CALLS_VERIFIED_NOTE, '已验证');
});

test('采样参数能力在其他能力编辑中保留 VERIFIED，克隆降为 DECLARED', () => {
    const source = modelDraftFromApi({ profileKey: 'sampling', modelId: 'sampling', displayName: 'sampling', maxOutputTokens: 10,
        capabilities: { temperature: 'VERIFIED', topP: 'VERIFIED', toolCalls: 'UNKNOWN' } });
    source.editedSubs.add('capabilities'); source.touchedCaps.add('toolCalls'); source.capabilities.toolCalls = 'DECLARED';
    const put = buildProviderPut(providerDraftWithModels([source]));
    assert.equal(put.models[0].capabilities.temperature, 'VERIFIED'); assert.equal(put.models[0].capabilities.topP, 'VERIFIED');
    const clone = cloneModelDraft(source, { profileKey: 'sampling-copy', displayName: 'sampling copy' });
    const cloned = buildProviderPut(providerDraftWithModels([clone])).models[0];
    assert.equal(cloned.capabilities.temperature, 'DECLARED'); assert.equal(cloned.capabilities.topP, 'DECLARED');
});

test('模型页呈现空供应商、停用徽章、缺密钥、未知能力、检查中和共享配置提示', async () => {
    const listeners = new Map();
    const overlay = {
        innerHTML: '',
        hidden: true,
        isConnected: true,
        querySelector: () => null,
        querySelectorAll: () => [],
        contains: () => true,
        addEventListener(type, fn) { listeners.set(type, fn); },
        dispatch(type, event) { listeners.get(type)?.(event); },
    };
    const previousDocument = globalThis.document;
    const previousFetch = globalThis.fetch;
    globalThis.document = {
        cookie: 'vc_csrf=token',
        addEventListener() {},
        querySelector() { return null; },
        querySelectorAll() { return []; },
        createElement() {
            return {
                id: '',
                className: '',
                innerHTML: '',
                querySelector: (sel) => (sel === '.vcms-overlay' ? overlay : null),
                querySelectorAll: () => [],
            };
        },
        body: { appendChild() {}, classList: { add() {}, remove() {} } },
    };
    let providers = [];
    let hangDiscover = false;
    globalThis.fetch = async (url) => {
        const path = String(url);
        if (hangDiscover && path.includes('/models/discover')) return new Promise(() => {});
        let body = [];
        if (path.endsWith('/api/v1/auth/session')) body = { accountId: '7', sessionId: '8', nextStep: 'ACTIVE' };
        else if (path.endsWith('/api/v1/admin/providers')) body = providers;
        else if (path.endsWith('/api/v1/admin/model-purposes')) body = [];
        return {
            ok: true,
            status: 200,
            headers: { get() { return null; } },
            text: async () => JSON.stringify(body),
        };
    };
    const provider = (extra) => ({
        providerId: 'relay',
        displayName: '停用中转',
        protocol: 'OPENAI_CHAT_COMPLETIONS',
        baseUrl: 'https://relay.example.com/v1',
        credentialConfigured: false,
        state: 'DISABLED',
        revision: 2,
        models: [{
            profileKey: 'daily',
            modelId: 'daily-chat',
            displayName: '日常',
            contextWindowTokens: 8192,
            maxOutputTokens: 1024,
            state: 'ENABLED',
            capabilities: { toolCalls: 'UNKNOWN' },
            boundPurposes: ['FOREGROUND_CHAT', 'NPC_DIALOGUE'],
        }],
        ...extra,
    });
    try {
        const { mountModelSettings } = await import('../extension/vc-model-settings/page.js');
        const page = mountModelSettings();
        const ready = async (pred) => {
            for (let i = 0; i < 30; i += 1) {
                if (pred()) return;
                await new Promise((resolve) => setTimeout(resolve, 0));
            }
            assert.ok(pred(), overlay.innerHTML.slice(0, 180));
        };
        providers = [provider()];
        page.open();
        await ready(() => page._state.phase === 'ready' && page._state.draft?.providerId === 'relay');
        assert.match(overlay.innerHTML, /已停用/);
        assert.match(overlay.innerHTML, /缺密钥/);
        assert.match(overlay.innerHTML, /该供应商尚未配置 API Key。可以先保存为停用草稿；配置密钥并启用后才能用于生成。/);
        assert.match(overlay.innerHTML, /aria-pressed="true">未知/);
        assert.match(overlay.innerHTML, new RegExp(TOOL_CALLS_UNVERIFIED_NOTE));
        assert.match(overlay.innerHTML, new RegExp(TOOL_CALLS_VERIFY_ACTION));
        assert.match(overlay.innerHTML, new RegExp(TOOL_CALLS_VERIFY_HINT));
        assert.match(overlay.innerHTML, /该配置正被这些用途使用：前台聊天、剧情 NPC。此处的修改保存后会影响它们；如需不影响，请用「另存为新配置」。/);
        assert.equal(overlay.innerHTML.includes('检查中…'), false);

        providers = [provider({ credentialConfigured: true, state: 'ENABLED', displayName: '已接通' })];
        hangDiscover = true;
        page._state.phase = 'idle';
        page.open();
        await ready(() => page._state.phase === 'ready' && page._state.draft?.credentialConfigured === true);
        overlay.dispatch('click', {
            target: {
                closest: (sel) => (sel === '[data-action]'
                    ? { getAttribute: (name) => (name === 'data-action' ? 'check-connection' : null) }
                    : null),
            },
        });
        assert.match(overlay.innerHTML, /检查中…/);

        providers = [];
        hangDiscover = false;
        page._state.phase = 'idle';
        page.open();
        await ready(() => page._state.phase === 'ready' && page._state.providers.length === 0);
        assert.match(overlay.innerHTML, /还没有供应商/);
        assert.match(overlay.innerHTML, /新建供应商，选择一种接口协议并填写 Base URL 与密钥，再添加模型配置。/);
    } finally {
        globalThis.document = previousDocument;
        globalThis.fetch = previousFetch;
    }
});
