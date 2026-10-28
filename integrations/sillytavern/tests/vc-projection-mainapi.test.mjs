// V2-W03 · 投影 main_api 接线离线测试（Node --test，无真 DOM / 无 ST）。
// 缺口：受管栈首启 ST 默认 main_api=koboldhorde，投影若不切族，原生发送会路由到
// Kobold 而非投影的 custom/claude 链。覆盖：
//   - 决策映射：三协议 mainApi 均 'openai'（#main_api 无 claude 选项，Anthropic 走族内 source='claude'）；
//   - applyProjection 先切 #main_api（val + trigger('change')，jQuery 形态）再写
//     #chat_completion_source（切族触发面板重载，后写才落在新面板上）；
//   - 幂等：已处于目标值时不重复 trigger；
//   - 资格缺失（无绑定）时不动 main_api。
import test from 'node:test';
import assert from 'node:assert/strict';

// ---------- 最小 DOM / jQuery stub ----------

const ops = []; // 跨元素操作序列，用于断言 main_api 先于 source
const els = {};

function makeElement(selector, initialValue = '') {
    const el = {
        selector,
        value: initialValue,
        triggers: [],
        options: [],
    };
    els[selector] = el;
    return el;
}

const fakeJq = (el) => ({
    val(v) {
        if (v === undefined) return el.value;
        el.value = String(v);
        ops.push({ sel: el.selector, op: 'val', value: el.value });
        return this;
    },
    trigger(evt) {
        el.triggers.push(evt);
        ops.push({ sel: el.selector, op: 'trigger', event: evt });
        return this;
    },
});

function resetDom() {
    for (const key of Object.keys(els)) delete els[key];
    ops.length = 0;
    for (const sel of [
        '#main_api', '#chat_completion_source', '#custom_api_url_text', '#openai_reverse_proxy',
        '#custom_model_id', '#model_claude_select', '#openai_max_context', '#openai_max_tokens',
        '#temp_openai', '#top_p_openai', '#openai_reasoning_effort',
    ]) {
        makeElement(sel, '');
    }
    els['#main_api'].value = 'koboldhorde'; // 受管栈首启真实默认（已实测）
    els['#model_claude_select'].options = [{ value: 'vendor/claude-x' }, { value: 'vendor/claude-y' }];
}

globalThis.document = {
    querySelector: (sel) => els[sel] ?? null,
    getElementById: () => null,
    addEventListener() {},
    createElement: () => ({ prepend() {}, addEventListener() {}, querySelector: () => null }),
};
globalThis.window = { jQuery: fakeJq };

const { createProjectionController, resolveForegroundProjection } = await import('../extension/vc-model-settings/projection.js');

// ---------- fixtures ----------

function catalog(protocol) {
    return {
        providers: [{
            providerId: 'main-relay', displayName: '主中转', protocol,
            baseUrl: 'https://relay.example.com/v1', credentialConfigured: true, state: 'ENABLED', revision: 12,
            models: [{
                profileKey: 'daily-chat', modelId: 'vendor/daily-chat', displayName: '日常对话',
                contextWindowTokens: 128000, maxOutputTokens: 8192, state: 'ENABLED',
                generationParams: { temperature: 0.8, topP: 0.95 },
            }],
        }],
        purposes: [{
            purpose: 'FOREGROUND_CHAT', providerId: 'main-relay', profileKey: 'daily-chat',
            state: 'ENABLED', status: 'READY', revision: 8,
        }],
    };
}

function makeHost({ protocol = 'OPENAI_CHAT_COMPLETIONS', purposes, providers } = {}) {
    const cat = catalog(protocol);
    const oai = {
        chat_completion_source: 'openai', custom_url: '', reverse_proxy: '',
        custom_model: '', claude_model: '', openai_max_context: 4096, openai_max_tokens: 512,
        temp_openai: 1, top_p_openai: 1, reasoning_effort: 'auto',
    };
    return {
        getContext: () => ({
            chatCompletionSettings: oai,
            saveSettingsDebounced() {},
            chatId: 'c1', characterId: 0, groupId: null,
            characters: [{ avatar: 'seraphina.png' }],
            eventSource: { on() {} },
            eventTypes: { CHAT_COMPLETION_SETTINGS_READY: 'ready', CHAT_CHANGED: 'changed' },
        }),
        fetchPurposes: async () => purposes ?? cat.purposes,
        fetchProviders: async () => providers ?? cat.providers,
        openModelSettings() {},
    };
}

test('决策映射：三协议 mainApi 均 openai（#main_api 无 claude 选项，Anthropic 走族内 source=claude）', () => {
    const custom = resolveForegroundProjection(catalog('OPENAI_CHAT_COMPLETIONS').purposes, catalog('OPENAI_CHAT_COMPLETIONS').providers);
    assert.equal(custom.mainApi, 'openai');
    const responses = resolveForegroundProjection(catalog('OPENAI_RESPONSES').purposes, catalog('OPENAI_RESPONSES').providers);
    assert.equal(responses.mainApi, 'openai');
    const claude = resolveForegroundProjection(catalog('ANTHROPIC_MESSAGES').purposes, catalog('ANTHROPIC_MESSAGES').providers);
    assert.equal(claude.mainApi, 'openai');
    assert.equal(claude.source, 'claude');
});

test('applyProjection：#main_api 收到 val+change，且先于 #chat_completion_source 的写入', async () => {
    resetDom();
    const controller = createProjectionController(makeHost());
    await controller.init();
    const mainApi = els['#main_api'];
    assert.equal(mainApi.value, 'openai', 'koboldhorde → openai');
    assert.deepEqual(mainApi.triggers, ['change']);
    const mainApiTrigger = ops.findIndex((o) => o.sel === '#main_api' && o.op === 'trigger');
    const sourceWrite = ops.findIndex((o) => o.sel === '#chat_completion_source');
    assert.ok(mainApiTrigger >= 0 && sourceWrite >= 0);
    assert.ok(mainApiTrigger < sourceWrite, '先切族（触发面板重载），再写 source / 标记 / 模型');
    assert.equal(els['#chat_completion_source'].value, 'custom');
});

test('幂等：已处于目标 main_api 时重新投影不重复 trigger（面板不重载）', async () => {
    resetDom();
    const controller = createProjectionController(makeHost());
    await controller.init();
    assert.equal(els['#main_api'].triggers.length, 1);
    controller.reproject();
    assert.equal(els['#main_api'].triggers.length, 1, '值未变时 setField 早退，不重复 change');
    assert.equal(els['#main_api'].value, 'openai');
});

test('claude 源：#main_api 同为 openai（koboldhorde 首启场景切一次），source 切 claude', async () => {
    resetDom();
    const controller = createProjectionController(makeHost({ protocol: 'ANTHROPIC_MESSAGES' }));
    await controller.init();
    assert.equal(els['#main_api'].value, 'openai');
    assert.deepEqual(els['#main_api'].triggers, ['change']);
    assert.equal(els['#chat_completion_source'].value, 'claude');
});

test('资格缺失（无绑定）：不动 #main_api', async () => {
    resetDom();
    const controller = createProjectionController(makeHost({ purposes: [] }));
    await controller.init();
    assert.equal(els['#main_api'].value, 'koboldhorde');
    assert.deepEqual(els['#main_api'].triggers, []);
});

test.after(() => {
    delete globalThis.document;
    delete globalThis.window;
});
