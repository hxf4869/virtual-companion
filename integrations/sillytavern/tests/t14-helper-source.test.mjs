import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';
import { Window } from 'happy-dom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ST_ROOT = path.resolve(__dirname, '..');
const sourceIdentityUrl = new URL('../server-plugin/virtual-companion/lib/source-identity.js', import.meta.url).href;
const ejsHostUrl = new URL('../extension/vc-model-settings/desktop/standalone/cards/ejs-host.js', import.meta.url).href;
const lockedLibUrl = new URL('../extension/vc-model-settings/desktop/locked-source/st/lib.js', import.meta.url).href;
const lockedEjsUrl = new URL('../extension/vc-model-settings/desktop/locked-source/ejs/desktop.js', import.meta.url).href;

registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === '/lib.js') return { url: lockedLibUrl, shortCircuit: true };
        if (specifier === '/scripts/extensions/third-party/ST-Prompt-Template/dist/desktop.js') {
            return { url: lockedEjsUrl, shortCircuit: true };
        }
        if (specifier === '/scripts/extensions/third-party/vc-model-settings/desktop/standalone/cards/ejs-host.js') {
            return { url: ejsHostUrl, shortCircuit: true };
        }
        if (specifier === '/scripts/vc-runtime/source-identity.js') {
            return { url: sourceIdentityUrl, shortCircuit: true };
        }
        return nextResolve(specifier, context);
    },
});

const happyWindow = new Window({ url: 'http://localhost:8000/desktop/' });
const jQueryFn = selector => {
    if (typeof selector === 'string') {
        const nodes = [...happyWindow.document.querySelectorAll(selector)];
        return Object.assign(nodes, {
            on() { return this; },
            off() { return this; },
            triggerHandler: async () => {},
        });
    }
    if (typeof selector === 'function') {
        selector();
        return {};
    }
    return {
        on() { return this; },
        off() { return this; },
        triggerHandler: async () => {},
    };
};
jQueryFn.ui = {};

Object.assign(globalThis, {
    self: globalThis,
    window: happyWindow,
    document: happyWindow.document,
    location: happyWindow.location,
    localStorage: happyWindow.localStorage,
    Element: happyWindow.Element,
    Node: happyWindow.Node,
    HTMLElement: happyWindow.HTMLElement,
    HTMLUnknownElement: happyWindow.HTMLUnknownElement,
    NodeFilter: happyWindow.NodeFilter,
    DOMParser: happyWindow.DOMParser,
    CustomEvent: happyWindow.CustomEvent,
    Event: happyWindow.Event,
    EventTarget: happyWindow.EventTarget,
    MutationObserver: happyWindow.MutationObserver,
    getComputedStyle: happyWindow.getComputedStyle.bind(happyWindow),
    requestAnimationFrame: cb => setTimeout(cb, 0),
    jQuery: jQueryFn,
    $: jQueryFn,
    toastr: { info() {}, warning() {}, error() {}, success() {} },
    fetch: async url => {
        if (String(url).includes('/version')) {
            return new Response(JSON.stringify({ pkgVersion: '1.13.0' }), { status: 200 });
        }
        return new Response('', { status: 200 });
    },
});

const { lodash, klona } = await import(lockedLibUrl);
globalThis._ = lodash;
test.after(() => happyWindow.happyDOM.close());

const { desktopSourceModules } = await import('../scripts/lib/desktop-source-modules.mjs');
const { EventEmitter } = await import('../extension/vc-model-settings/desktop/standalone/engine/events.js');
const { event_types } = await import('../extension/vc-model-settings/desktop/standalone/engine/st/events.js');
const { bindEngineContext } = await import('../extension/vc-model-settings/desktop/standalone/engine/ports.js');
const { openaiDefaults, powerUserDefaults } = await import('../extension/vc-model-settings/desktop/standalone/engine/defaults.js');
const { initializeCards } = await import('../extension/vc-model-settings/desktop/standalone/cards/index.js');
const { createDesktopSession } = await import('../extension/vc-model-settings/desktop/standalone/session.js');
const { prepareSourceIdentities } = await import('../server-plugin/virtual-companion/lib/source-identity.js');
const { documentEqual, documentValue, applyDocumentValues } = await import('../extension/vc-model-settings/settings-documents.js');

const helperTypesMod = await import('../extension/vc-model-settings/desktop/standalone/engine/helper-types.js');
const helperPresetMod = await import('../extension/vc-model-settings/desktop/standalone/cards/helper-preset.js');
const helperRegexMod = await import('../extension/vc-model-settings/desktop/standalone/cards/helper-regex.js');
const helperWorldbookMod = await import('../extension/vc-model-settings/desktop/standalone/cards/helper-worldbook.js');
const helperCharacterMod = await import('../extension/vc-model-settings/desktop/standalone/cards/helper-character.js');
const helperPersonaMod = await import('../extension/vc-model-settings/desktop/standalone/cards/helper-persona.js');
const helperVariablesMod = await import('../extension/vc-model-settings/desktop/standalone/cards/helper-variables.js');

const lockedPreset = await import('../extension/vc-model-settings/desktop/locked-source/helper/function/preset.js');
const lockedRegex = await import('../extension/vc-model-settings/desktop/locked-source/helper/function/tavern_regex.js');
const lockedVariables = await import('../extension/vc-model-settings/desktop/locked-source/helper/function/variables.js');

function createRuntimeFixture() {
    const worldStore = {
        测试世界书: {
            entries: {
                0: {
                    uid: 0,
                    displayIndex: 0,
                    key: ['关键词A', '/regex_key/i'],
                    keysecondary: ['次要词B'],
                    comment: '初始条目',
                    content: '初始内容',
                    constant: false,
                    vectorized: false,
                    selective: true,
                    selectiveLogic: 0,
                    order: 100,
                    position: 4,
                    disable: false,
                    useProbability: true,
                    probability: 85,
                    depth: 4,
                    role: 0,
                    addMemo: false,
                    matchPersonaDescription: true,
                    ignoreBudget: true,
                    triggers: ['normal'],
                    characterFilter: { isExclude: true, names: ['测试角色'], tags: ['tagA'] },
                    custom_raw_field: 'preserved_0',
                },
            },
        },
    };
    const worldNames = ['测试世界书', '备用世界书'];
    const card = {
        avatar: 'helper-test.png',
        name: '测试角色',
        description: '角色描述',
        personality: '温柔',
        scenario: '书店',
        first_mes: '你好，欢迎来到书店。',
        mes_example: '<START>\n{{user}}: 你好\n{{char}}: 欢迎！',
        data: {
            name: '测试角色',
            description: '角色描述',
            personality: '温柔',
            scenario: '书店',
            first_mes: '你好，欢迎来到书店。',
            mes_example: '<START>\n{{user}}: 你好\n{{char}}: 欢迎！',
            creator_notes: '作者备注',
            system_prompt: '系统提示',
            post_history_instructions: '越狱提示',
            alternate_greetings: ['备选开场1'],
            character_version: '1.0',
            tags: ['tagA'],
            creator: 'creatorA',
            character_book: { name: '测试世界书', entries: [] },
            extensions: {
                world: '测试世界书',
                depth_prompt: { prompt: 'depth', depth: 4, role: 'system' },
                custom_ext_flag: 'keep_ext',
                regex_scripts: [
                    {
                        id: 'char-regex-1',
                        scriptName: '角色正则',
                        findRegex: '/CHAR_TOKEN/g',
                        replaceString: 'CHAR_REPLACED',
                        trimStrings: [],
                        placement: [2],
                        disabled: false,
                        markdownOnly: true,
                        promptOnly: false,
                        runOnEdit: false,
                        substituteRegex: 0,
                        minDepth: null,
                        maxDepth: null,
                    },
                ],
                tavern_helper: {
                    scripts: [],
                    variables: { char_init: 1 },
                },
            },
        },
    };
    const initialRecords = [
        {
            user_name: '测试用户',
            character_name: '测试角色',
            chat_metadata: {
                integrity: 'helper-test-integrity',
                vc_f2: { id: 'chat-f2-1', revision: 1 },
                vc_binding: {
                    characterRef: 'helper-test-ref',
                    chatIdentity: 'chat-f2-1',
                    relationshipId: '1',
                    conversationId: 'chat-f2-1',
                    mode: 'COMPANION',
                },
                variables: { init_var: 'hello' },
            },
        },
        {
            name: '测试角色',
            is_user: false,
            is_system: false,
            send_date: '2026-11-04T00:00:00Z',
            mes: '第一条消息 CHAR_TOKEN',
            swipe_id: 0,
            swipes: ['第一条消息 CHAR_TOKEN'],
            swipe_info: [{ send_date: '2026-11-04T00:00:00Z', extra: {} }],
            variables: [{ msg_var: 'v0' }],
            extra: {},
        },
    ];
    prepareSourceIdentities(initialRecords, { settled: true, sourceTimezone: 'UTC' });

    const context = {
        characters: [card],
        characterId: 0,
        chat: [],
        chatMetadata: {},
        chatId: 'chat-file-1.jsonl',
        name1: '测试用户',
        name2: '测试角色',
        userAvatar: 'user-default.png',
        extensionPrompts: {},
        eventSource: new EventEmitter(),
        eventTypes: event_types,
    };

    const settings = {
        username: '测试用户',
        user_avatar: 'user-default.png',
        world_info: { globalSelect: ['测试世界书'] },
        world_info_depth: 2,
        world_info_budget: 25,
        world_info_budget_cap: 0,
        world_info_min_activations: 0,
        world_info_min_activations_depth_max: 0,
        world_info_max_recursion_steps: 0,
        world_info_character_strategy: 0,
        world_info_include_names: true,
        world_info_recursive: true,
        world_info_case_sensitive: false,
        world_info_match_whole_words: false,
        world_info_use_group_scoring: false,
        world_info_overflow_alert: false,
        oai_settings: {
            ...structuredClone(openaiDefaults),
            preset_settings_openai: 'Default',
            temp_openai: 1.35,
            freq_pen_openai: 0.4,
            pres_pen_openai: 0.3,
            top_p_openai: 0.92,
            top_k_openai: 15,
            top_a_openai: 0.1,
            min_p_openai: 0.05,
            repetition_penalty_openai: 1.15,
            openai_max_context: 8192,
            openai_max_tokens: 800,
            seed: 77,
            prompts: [
                {
                    identifier: 'active_prompt',
                    name: 'Active Prompt',
                    system_prompt: false,
                    marker: false,
                    role: 'system',
                    content: 'ACTIVE_ONLY_PROMPT',
                    enabled: true,
                    injection_position: 0,
                },
            ],
            prompt_order: [{ character_id: 100001, order: [{ identifier: 'active_prompt', enabled: true }] }],
            extensions: {
                tavern_helper: { scripts: [], variables: { active_preset_var: 1 } },
                regex_scripts: [
                    {
                        id: 'active-preset-regex',
                        scriptName: '活动预设正则',
                        findRegex: '/ACTIVE_REGEX/g',
                        replaceString: 'ACTIVE_REPLACED',
                        trimStrings: [],
                        placement: [2],
                        disabled: false,
                        markdownOnly: true,
                        promptOnly: false,
                        runOnEdit: false,
                        substituteRegex: 0,
                        minDepth: null,
                        maxDepth: null,
                    },
                ],
            },
        },
        power_user: {
            ...structuredClone(powerUserDefaults),
            experimental_macro_engine: false,
            personas: {
                'user-default.png': '测试用户',
                'user-alt.png': '备用人设',
            },
            persona_descriptions: {
                'user-default.png': { description: '默认人设描述', position: 0, depth: 2, role: 0, lorebook: '测试世界书', title: '默认头衔' },
                'user-alt.png': { description: '备用人设描述', position: 4, depth: 4, role: 1, lorebook: '', title: '' },
            },
            persona_description: '默认人设描述',
            persona_description_lorebook: '测试世界书',
        },
        extension_settings: {
            disabledExtensions: [],
            variables: { global: { g_init: 10 } },
            character_allowed_regex: ['helper-test.png'],
            regex: [
                {
                    id: 'global-regex-1',
                    scriptName: '全局正则',
                    findRegex: '/GLOBAL_TOKEN/g',
                    replaceString: 'GLOBAL_REPLACED',
                    trimStrings: [],
                    placement: [1, 2],
                    disabled: false,
                    markdownOnly: true,
                    promptOnly: false,
                    runOnEdit: true,
                    substituteRegex: 0,
                    minDepth: 0,
                    maxDepth: 10,
                },
            ],
            tavern_helper: {
                script: {
                    enabled: { global: true, presets: [], characters: ['helper-test.png'] },
                    scripts: [],
                },
            },
        },
    };

    const savedNamedPreset = {
        openai_max_context: 16384,
        openai_max_tokens: 400,
        n: 1,
        stream_openai: true,
        temperature: 0.55,
        frequency_penalty: 0.1,
        presence_penalty: 0.2,
        top_p: 0.8,
        repetition_penalty: 1.05,
        min_p: 0.02,
        top_k: 40,
        top_a: 0.2,
        // 故意不设置 temp_openai 与 seed，验证不会把 settings.oai_settings 的 temp_openai(1.35) 或 seed(77) 混入保存预设
        squash_system_messages: false,
        reasoning_effort: 'medium',
        show_thoughts: false,
        request_images: false,
        function_calling: true,
        enable_web_search: false,
        image_inlining: true,
        inline_image_quality: 'high',
        video_inlining: false,
        names_behavior: 0,
        wrap_in_quotes: false,
        prompts: [
            {
                identifier: 'saved_prompt',
                name: 'Saved Prompt',
                system_prompt: false,
                marker: false,
                role: 'user',
                content: 'SAVED_ONLY_PROMPT',
                enabled: true,
                injection_position: 1,
                injection_depth: 3,
                injection_order: 120,
            },
        ],
        prompt_order: [{ character_id: 100001, order: [{ identifier: 'saved_prompt', enabled: true }] }],
        extensions: {
            tavern_helper: { scripts: [], variables: { saved_var: 2 } },
            regex_scripts: [
                {
                    id: 'saved-preset-regex',
                    scriptName: '保存预设正则',
                    findRegex: '/SAVED_REGEX/g',
                    replaceString: 'SAVED_REPLACED',
                    trimStrings: [],
                    placement: [1],
                    disabled: true,
                    markdownOnly: false,
                    promptOnly: true,
                    runOnEdit: false,
                    substituteRegex: 0,
                    minDepth: 1,
                    maxDepth: 5,
                },
            ],
        },
    };

    const presets = {
        Default: structuredClone(settings.oai_settings),
        NamedSaved: structuredClone(savedNamedPreset),
    };
    card.data.extensions.vc_character_ref = 'helper-test-ref';

    const capturedDocs = {};
    const f2Saves = [];
    const client = {
        headers: () => ({}),
        documents: {
            captureWorldbook(name, next) {
                capturedDocs[name] = structuredClone(next);
            },
        },
        saveSettings: async () => new Response('{}', { status: 200 }),
        settingsChanged: () => false,
        async raw(url, serialized) {
            if (url === '/api/chats/save') {
                const body = JSON.parse(serialized);
                f2Saves.push(body);
                return new Response(
                    JSON.stringify({
                        vc_f2: {
                            ...body.chat[0].chat_metadata.vc_f2,
                            revision: body.chat[0].chat_metadata.vc_f2.revision + 1,
                        },
                    }),
                    { status: 200 },
                );
            }
            return new Response('{}', { status: 200 });
        },
        async generate() {
            return new Response('{}', { status: 200 });
        },
        async request(url, body) {
            if (url === '/api/avatars/get') return ['user-default.png', 'user-alt.png'];
            if (url === '/api/characters/get') return structuredClone(card);
            if (url === '/api/worldinfo/get') return structuredClone(worldStore[body.name] || { entries: {} });
            if (url === '/api/characters/chats') {
                return [
                    { file_name: 'chat-file-1.jsonl', file_size: '1 KB', chat_items: 2, mes: '旧', last_mes: '2026-11-04T00:00:00Z' },
                    { file_name: 'chat-file-2.jsonl', file_size: '2 KB', chat_items: 3, mes: '新', last_mes: '2026-11-05T00:00:00Z' },
                ];
            }
            if (url === '/api/chats/get') {
                return [
                    { user_name: '测试用户', character_name: '测试角色', chat_metadata: {} },
                    { name: '测试角色', is_user: false, mes: `详情:${body.file_name}:${body.ch_name}:${body.avatar_url}` },
                ];
            }
            if (url === '/api/chats/group/get') {
                return [
                    { name: '群成员A', is_user: false, mes: `群聊:${body.id}` },
                ];
            }
            return {};
        },
        async post(url, body) {
            if (url === '/api/worldinfo/edit') {
                if (Array.isArray(body.vc_changes)) {
                    const current = worldStore[body.name];
                    for (const change of body.vc_changes) {
                        const actual = documentValue(current, change.path);
                        const expected = change.before;
                        if (Boolean(actual.exists) !== Boolean(expected?.exists) || (actual.exists && !documentEqual(actual.value, expected.value))) {
                            return new Response(JSON.stringify({ code: 'VC_CONFLICT' }), { status: 409 });
                        }
                    }
                    worldStore[body.name] = applyDocumentValues(current === undefined ? undefined : structuredClone(current), body.vc_changes);
                } else if (body.data) {
                    worldStore[body.name] = structuredClone(body.data);
                }
                if (!worldNames.includes(body.name)) worldNames.push(body.name);
                return new Response('{}', { status: 200 });
            }
            return new Response('{}', { status: 200 });
        },
    };

    const container = document.createElement('div');
    container.id = 'chat';
    document.body.innerHTML = '';
    document.body.appendChild(container);

    const engine = {
        settings,
        bindContext() {
            bindEngineContext(context, settings, { models: [], extensions: [] });
        },
        settingsForSave: () => settings,
        firstMessage: () => null,
        userMessage: async text => ({ message: { name: context.name1, mes: text, is_user: true, is_system: false }, bias: {} }),
        prepare: async () => ({ body: { model: 'synthetic', chat_completion_source: 'custom' } }),
        cleanResponse: text => text,
        memory: { finalStatus() {} },
        generateHelper: async () => '合成脚本回复',
        cards: undefined,
    };
    engine.bindContext();

    return {
        context,
        settings,
        presets,
        worldStore,
        worldNames,
        capturedDocs,
        f2Saves,
        async init() {
            const session = createDesktopSession({
                client,
                context,
                engine,
                prepareSourceIdentities,
                choosePersona: async () => 'user-default.png',
                resolveBinding: async value => ({
                    characterRef: 'helper-test-ref',
                    chatIdentity: value.chatIdentity,
                    relationshipId: '1',
                    conversationId: value.chatIdentity,
                    mode: value.mode || 'COMPANION',
                }),
                reconcileSources: async () => [],
                onChange: () => {},
                readResponse: async (_res, { onUpdate }) => {
                    const result = { text: '合成回复', state: { reasoning: '' }, swipes: [], toolCalls: [], finishReason: 'stop' };
                    await onUpdate(result);
                    return result;
                },
            });
            const cards = await initializeCards({
                context,
                settings,
                packet: { world_names: worldNames },
                presets,
                models: [],
                client,
            });
            engine.cards = cards;
            await session.activate({ avatar: 'helper-test.png', file: 'chat-file-1.jsonl' }, structuredClone(initialRecords));
            return { cards, session };
        },
    };
}

test('T14-1: helper-types 从 src/function/generate/types.ts 编译，且本批 Helper 模块统一使用 PolyForm 许可头', async () => {
    assert.ok(
        desktopSourceModules['helper/function/generate/types.js'],
        'desktop-source-modules.mjs 必须声明 helper/function/generate/types.js',
    );
    const lockedTypes = await import('../extension/vc-model-settings/desktop/locked-source/helper/function/generate/types.js');
    assert.equal(helperTypesMod.extension_prompt_roles, lockedTypes.extension_prompt_roles);
    assert.equal(helperTypesMod.createGenerateResult, lockedTypes.createGenerateResult);
    assert.equal(helperTypesMod.placeholder_prompt_default_order, lockedTypes.placeholder_prompt_default_order);
    assert.equal(helperTypesMod.roleTypes, lockedTypes.roleTypes);
    assert.equal(helperTypesMod.default_order, lockedTypes.default_order);
    assert.equal(helperTypesMod.character_names_behavior, lockedTypes.character_names_behavior);
    assert.equal(helperTypesMod.builtin_prompt_default_order, lockedTypes.placeholder_prompt_default_order);

    const ownedFiles = [
        'extension/vc-model-settings/desktop/standalone/engine/helper-types.js',
        'extension/vc-model-settings/desktop/standalone/cards/helper-preset.js',
        'extension/vc-model-settings/desktop/standalone/cards/helper-regex.js',
        'extension/vc-model-settings/desktop/standalone/cards/helper-worldbook.js',
        'extension/vc-model-settings/desktop/standalone/cards/helper-character.js',
        'extension/vc-model-settings/desktop/standalone/cards/helper-persona.js',
        'extension/vc-model-settings/desktop/standalone/cards/helper-variables.js',
    ];
    for (const rel of ownedFiles) {
        const firstLine = fs.readFileSync(path.join(ST_ROOT, rel), 'utf8').split('\n')[0];
        assert.match(firstLine, /^\/\/ PolyForm-Noncommercial-1\.0\.0\./, `${rel} 许可头必须为 PolyForm-Noncommercial-1.0.0`);
        assert.doesNotMatch(firstLine, /AGPL/, `${rel} 不得标错 AGPL`);
    }
});

test('T14-2: helper-preset 复用锁定 default_preset/isPreset*Prompt/toPreset/fromPreset/in_use_map，且 in_use 与保存预设不再混源合并', async () => {
    const f = createRuntimeFixture();
    await f.init();
    const th = globalThis.TavernHelper;

    // 1. default_preset 与分类函数直接复用 locked-source/helper/function/preset.js
    assert.equal(helperPresetMod.default_preset, lockedPreset.default_preset);
    assert.equal(helperPresetMod.isPresetNormalPrompt, lockedPreset.isPresetNormalPrompt);
    assert.equal(helperPresetMod.isPresetSystemPrompt, lockedPreset.isPresetSystemPrompt);
    assert.equal(helperPresetMod.isPresetPlaceholderPrompt, lockedPreset.isPresetPlaceholderPrompt);
    assert.equal(th.default_preset.prompts.length, 8, 'default_preset 必须包含上游 8 个默认占位提示词');
    assert.deepEqual(
        th.default_preset.prompts.map(p => p.id),
        [
            'worldInfoBefore',
            'personaDescription',
            'charDescription',
            'charPersonality',
            'scenario',
            'worldInfoAfter',
            'dialogueExamples',
            'chatHistory',
        ],
    );
    assert.equal(th.default_preset.settings.max_context, 2000000);
    assert.equal(th.default_preset.settings.should_stream, false);
    assert.equal(th.default_preset.settings.character_name_prefix, 'none');
    assert.deepEqual(th.default_preset.extensions, { tavern_helper: { scripts: [], variables: {} } });

    // 2. getPresetNames 包含 in_use 与保存预设列表
    assert.deepEqual(th.getPresetNames(), ['in_use', 'Default', 'NamedSaved']);
    assert.equal(th.getLoadedPresetName(), 'Default');

    // 3. active/in_use 与保存预设对象严格按各自源经 lockedPreset.toPreset 转换，不把 oai_settings 混入 NamedSaved
    const activePreset = th.getPreset('in_use');
    const expectedActive = klona(lockedPreset.toPreset(f.settings.oai_settings, { in_use: true }));
    assert.deepEqual(activePreset, expectedActive);
    assert.equal(activePreset.settings.temperature, 1.35);
    assert.equal(activePreset.settings.seed, 77);
    assert.deepEqual(activePreset.prompts.map(p => p.id), ['active_prompt']);

    const savedPreset = th.getPreset('NamedSaved');
    const expectedSaved = klona(lockedPreset.toPreset(f.presets.NamedSaved, { in_use: false }));
    assert.deepEqual(savedPreset, expectedSaved, 'getPreset(name) 必须与 lockedPreset.toPreset(presets[name], { in_use: false }) 完全一致，不得混入 oai_settings');
    assert.equal(savedPreset.settings.temperature, 0.55);
    assert.equal(Number.isNaN(savedPreset.settings.seed), true, '未设置 seed 的保存预设不得继承 oai_settings.seed(77)');
    assert.deepEqual(savedPreset.prompts.map(p => p.id), ['saved_prompt']);

    // 4. fromPreset 与 in_use_map 对照：回转为 ST 原始结构时同时产出 in_use 与保存文件字段映射
    const roundTrippedRaw = lockedPreset.fromPreset(klona(savedPreset));
    for (const [inUseKey, savedKey] of Object.entries(lockedPreset.in_use_map)) {
        assert.equal(roundTrippedRaw[inUseKey], roundTrippedRaw[savedKey], `in_use_map 映射 ${inUseKey} <-> ${savedKey} 必须一致`);
    }
    assert.equal(roundTrippedRaw.temp_openai, 0.55);
    assert.equal(roundTrippedRaw.temperature, 0.55);
});

test('T14-3: helper-regex 复用锁定 to_tavern_regex/from_tavern_regex 并保持与锁定纯函数同输入同输出', async () => {
    const f = createRuntimeFixture();
    await f.init();
    const th = globalThis.TavernHelper;

    assert.equal(helperRegexMod.to_tavern_regex, lockedRegex.to_tavern_regex);
    assert.equal(helperRegexMod.from_tavern_regex, lockedRegex.from_tavern_regex);

    const globalRegexes = th.getTavernRegexes({ type: 'global' });
    assert.deepEqual(
        globalRegexes,
        f.settings.extension_settings.regex.map(lockedRegex.to_tavern_regex),
    );

    const charRegexes = th.getTavernRegexes({ type: 'character', name: 'current' });
    assert.deepEqual(
        charRegexes,
        f.context.characters[0].data.extensions.regex_scripts.map(lockedRegex.to_tavern_regex),
    );

    const activePresetRegexes = th.getTavernRegexes({ type: 'preset', name: 'in_use' });
    assert.deepEqual(
        activePresetRegexes,
        f.settings.oai_settings.extensions.regex_scripts.map(lockedRegex.to_tavern_regex),
    );

    const savedPresetRegexes = th.getTavernRegexes({ type: 'preset', name: 'NamedSaved' });
    assert.deepEqual(
        savedPresetRegexes,
        f.presets.NamedSaved.extensions.regex_scripts.map(lockedRegex.to_tavern_regex),
    );
});

test('T14-4: helper-worldbook 复用锁定 worldbook/lorebook/lorebook_entry 转换，保留额外字段/implicit flags 与 CAS 权威结果', async () => {
    assert.ok(desktopSourceModules['helper/function/worldbook.js'], '必须配置 helper/function/worldbook.js');
    assert.ok(desktopSourceModules['helper/function/lorebook.js'], '必须配置 helper/function/lorebook.js');
    assert.ok(desktopSourceModules['helper/function/lorebook_entry.js'], '必须配置 helper/function/lorebook_entry.js');

    const lockedWorldbook = await import('../extension/vc-model-settings/desktop/locked-source/helper/function/worldbook.js');
    const lockedLorebook = await import('../extension/vc-model-settings/desktop/locked-source/helper/function/lorebook.js');
    const lockedLorebookEntry = await import('../extension/vc-model-settings/desktop/locked-source/helper/function/lorebook_entry.js');

    const f = createRuntimeFixture();
    await f.init();
    const th = globalThis.TavernHelper;

    // 1. Lorebook settings 与绑定读取复用锁定实现
    assert.equal(helperWorldbookMod.getLorebookSettings, lockedLorebook.getLorebookSettings);
    assert.equal(helperWorldbookMod.getCharLorebooks, lockedLorebook.getCharLorebooks);
    assert.equal(helperWorldbookMod.getCurrentCharPrimaryLorebook, lockedLorebook.getCurrentCharPrimaryLorebook);
    assert.equal(helperWorldbookMod.getChatLorebook, lockedLorebook.getChatLorebook);

    // 2. Worldbook 转换与锁定 toWorldbookEntry/fromWorldbookEntry 同输入对比（加上未知字段保留）
    const rawEntry0 = structuredClone(f.worldStore['测试世界书'].entries[0]);
    const wbEntries = await th.getWorldbook('测试世界书');
    assert.equal(wbEntries.length, 1);
    assert.deepEqual(wbEntries[0], {
        custom_raw_field: 'preserved_0',
        ...lockedWorldbook.toWorldbookEntry(rawEntry0),
    });
    assert.equal(wbEntries[0].addMemo, false);
    assert.equal(wbEntries[0].matchPersonaDescription, true);
    assert.equal(wbEntries[0].ignoreBudget, true);
    assert.deepEqual(wbEntries[0].triggers, ['normal']);

    // 3. LorebookEntry 转换与锁定 toLorebookEntry/fromPartialLorebookEntry 同输入对比
    const lbEntries = await th.getLorebookEntries('测试世界书');
    assert.equal(lbEntries.length, 1);
    assert.deepEqual(lbEntries[0], {
        custom_raw_field: 'preserved_0',
        ...lockedLorebookEntry.toLorebookEntry(rawEntry0),
    });

    // 4. updateWorldbookWith 异字段并发 CAS 合并、保留未知字段/flags 与同步权威快照，同字段冲突 409
    const updatedWb = await th.updateWorldbookWith('测试世界书', async entries => {
        f.worldStore['测试世界书'].entries[0].content = '远端世界书内容';
        entries[0].name = '世界书条目改名';
        return entries;
    });
    assert.equal(updatedWb[0].name, '世界书条目改名');
    assert.equal(updatedWb[0].content, '远端世界书内容');
    assert.equal(updatedWb[0].custom_raw_field, 'preserved_0');
    assert.equal(updatedWb[0].matchPersonaDescription, true);
    assert.equal(f.capturedDocs['测试世界书']?.entries?.[0]?.comment, '世界书条目改名');
    assert.equal(f.capturedDocs['测试世界书']?.entries?.[0]?.content, '远端世界书内容');

    await assert.rejects(
        () => th.updateWorldbookWith('测试世界书', async entries => {
            f.worldStore['测试世界书'].entries[0].comment = '远端抢先改名';
            entries[0].name = '本地冲突改名';
            return entries;
        }),
        err => err?.status === 409,
    );
});

test('T14-5: helper-character 与 helper-persona 复用锁定上游只读转换函数', async () => {
    assert.ok(desktopSourceModules['helper/function/character.js'], '必须配置 helper/function/character.js');
    assert.ok(desktopSourceModules['helper/function/raw_character.js'], '必须配置 helper/function/raw_character.js');
    assert.ok(desktopSourceModules['helper/function/persona.js'], '必须配置 helper/function/persona.js');

    const lockedCharacter = await import('../extension/vc-model-settings/desktop/locked-source/helper/function/character.js');
    const lockedRawCharacter = await import('../extension/vc-model-settings/desktop/locked-source/helper/function/raw_character.js');
    const lockedPersona = await import('../extension/vc-model-settings/desktop/locked-source/helper/function/persona.js');
    const { RawCharacter } = await import('../extension/vc-model-settings/desktop/standalone/cards/ejs-host.js');

    const f = createRuntimeFixture();
    await f.init();
    const th = globalThis.TavernHelper;

    assert.equal(helperCharacterMod.getCharacterNames, lockedCharacter.getCharacterNames);
    assert.equal(helperCharacterMod.getCharacterIds, lockedCharacter.getCharacterIds);
    assert.equal(helperCharacterMod.getCurrentCharacterName, lockedCharacter.getCurrentCharacterName);
    assert.equal(helperCharacterMod.getCurrentCharacterId, lockedCharacter.getCurrentCharacterId);
    assert.equal(helperCharacterMod.getCharacter, lockedCharacter.getCharacter);
    assert.equal(helperCharacterMod.getCharData, lockedRawCharacter.getCharData);
    assert.equal(helperCharacterMod.getCharAvatarPath, lockedRawCharacter.getCharAvatarPath);

    const lockedCharConverted = lockedCharacter.toCharacter(f.context.characters[0]);
    const actualChar = await th.getCharacter('current');
    assert.deepEqual(actualChar, lockedCharConverted);
    assert.deepEqual(await th.getCharacter('测试角色'), lockedCharConverted);
    assert.deepEqual(await th.getCharacter('helper-test.png'), lockedCharConverted);
    assert.equal('name' in actualChar, false, 'getCharacter 必须保持上游锁定返回结构，不附加本地 name 覆盖');
    assert.equal(actualChar.extensions.depth_prompt, undefined, 'toCharacter 必须按上游移除 depth_prompt/world');
    assert.equal(actualChar.extensions.custom_ext_flag, 'keep_ext');

    // getChatHistoryBrief / getChatHistoryDetail 契约与现有 RawCharacter.getChatsFromFiles 端口复用
    assert.equal(await th.getChatHistoryBrief('不存在的角色'), null);
    assert.equal(await th.getChatHistoryDetail('不存在的角色'), null);
    const brief = await th.getChatHistoryBrief('current');
    assert.equal(Array.isArray(brief), true);
    assert.deepEqual(brief.map(item => item.file_name), ['chat-file-2.jsonl', 'chat-file-1.jsonl']);
    assert.equal(brief[0].ch_name, '测试角色');
    assert.equal(brief[0].avatar_url, 'helper-test.png');
    assert.equal('chat_item' in brief[0], false, '不得向聊天摘要顺手注入非契约字段');
    assert.equal('last_message' in brief[0], false, '不得向聊天摘要顺手注入非契约字段');

    const detailByDefault = await th.getChatHistoryDetail();
    const detailByCurrent = await th.getChatHistoryDetail('current');
    const detailByArray = await th.getChatHistoryDetail(brief);
    assert.deepEqual(detailByDefault, detailByCurrent);
    assert.deepEqual(detailByCurrent, detailByArray);
    assert.equal(detailByCurrent['chat-file-2.jsonl']?.[0]?.mes, '详情:chat-file-2:测试角色:helper-test.png');
    assert.equal(detailByCurrent['chat-file-1.jsonl']?.[0]?.mes, '详情:chat-file-1:测试角色:helper-test.png');

    const groupDetail = await th.getChatHistoryDetail([{ file_name: 'group-chat-1.jsonl' }], true);
    assert.deepEqual(groupDetail, {
        'group-chat-1.jsonl': [{ name: '群成员A', is_user: false, mes: '群聊:group-chat-1.jsonl' }],
    });

    assert.equal(helperPersonaMod.getPersonaNames, lockedPersona.getPersonaNames);
    assert.equal(helperPersonaMod.getPersonaIds, lockedPersona.getPersonaIds);
    assert.equal(helperPersonaMod.getCurrentPersonaName, lockedPersona.getCurrentPersonaName);
    assert.equal(helperPersonaMod.getCurrentPersonaId, lockedPersona.getCurrentPersonaId);
    assert.equal(helperPersonaMod.getPersonaAvatarPath, lockedPersona.getPersonaAvatarPath);
    assert.equal(helperPersonaMod.getPersona, lockedPersona.getPersona);

    assert.deepEqual(th.getPersona('current'), lockedPersona.toPersona('user-default.png'));
    assert.deepEqual(th.getPersona('备用人设'), lockedPersona.toPersona('user-alt.png'));
    assert.equal(th.getPersona('备用人设').position, 4);
    assert.equal(th.getPersona('备用人设').depth, 4);
    assert.equal(th.getPersona('备用人设').role, 1);
});

test('T14-6: helper-variables 复用 createHelperVariableUpdates 且同步/异步更新与 deleteVariable 仍走单 owner lease 保护', async () => {
    const f = createRuntimeFixture();
    await f.init();
    const th = globalThis.TavernHelper;

    // 1. helper-variables.js 必须通过 createHelperVariableUpdates({ updateVariablesWith }) 产出三项纯更新函数，不再保留本地重复定义
    const variablesSrc = fs.readFileSync(
        path.join(ST_ROOT, 'extension/vc-model-settings/desktop/standalone/cards/helper-variables.js'),
        'utf8',
    );
    assert.match(variablesSrc, /createHelperVariableUpdates/);
    assert.doesNotMatch(variablesSrc, /function\s+insertOrAssignVariables\b/);
    assert.doesNotMatch(variablesSrc, /function\s+insertVariables\b/);
    assert.doesNotMatch(variablesSrc, /function\s+deleteVariable\b/);

    // 2. 直接对比 lockedVariables.createHelperVariableUpdates 纯变换与桌面 API 同输入结果
    const directAdapter = lockedVariables.createHelperVariableUpdates({
        updateVariablesWith(updater) {
            return updater(klona(th.getVariables({ type: 'chat' })));
        },
    });
    const probePatch = { nested: { arr: [1, 2, 3], keep: 'yes' } };
    const expectedAfterInsertOrAssign = directAdapter.insertOrAssignVariables(klona(probePatch), { type: 'chat' });
    const actualAfterInsertOrAssign = th.insertOrAssignVariables(klona(probePatch), { type: 'chat' });
    assert.deepEqual(actualAfterInsertOrAssign, expectedAfterInsertOrAssign);

    const probeInsert = { nested: { arr: [9, 9], keep: 'ignored', added: 'new' } };
    const expectedAfterInsert = directAdapter.insertVariables(klona(probeInsert), { type: 'chat' });
    const actualAfterInsert = th.insertVariables(klona(probeInsert), { type: 'chat' });
    assert.deepEqual(actualAfterInsert, expectedAfterInsert);
    assert.deepEqual(actualAfterInsert.nested, { arr: [1, 2, 3], keep: 'yes', added: 'new' });

    const expectedAfterDelete = directAdapter.deleteVariable('nested.added', { type: 'chat' });
    const actualAfterDelete = th.deleteVariable('nested.added', { type: 'chat' });
    assert.deepEqual(actualAfterDelete, expectedAfterDelete);
    assert.equal(actualAfterDelete.delete_occurred, true);
    assert.equal(actualAfterDelete.variables.nested.added, undefined);

    // 等待同步变更触发的异步 F2 revision 保存完成，再测试异步 updater
    await new Promise(resolve => setTimeout(resolve, 0));

    const asyncUpdated = await th.updateVariablesWith(async vars => {
        await new Promise(resolve => setTimeout(resolve, 5));
        vars.async_ok = 42;
        return vars;
    }, { type: 'chat' });
    assert.equal(asyncUpdated.async_ok, 42);
    assert.equal(f.context.chatMetadata.variables.async_ok, 42);

    await new Promise(resolve => setTimeout(resolve, 0));

    // 3. 异步 updater 进行中会话 lease 变更，必须在写回前被单 owner 守卫拒绝，不得污染新会话
    const realMetadata = f.context.chatMetadata;
    const stalePromise = th.updateVariablesWith(async vars => {
        await new Promise(resolve => setTimeout(resolve, 10));
        vars.polluted = 'bad';
        return vars;
    }, { type: 'chat' });
    const nextMetadata = { variables: { clean: true } };
    f.context.chatMetadata = nextMetadata;
    try {
        await assert.rejects(stalePromise, { code: 'VC_STALE_SOURCE' });
        assert.equal(nextMetadata.variables.polluted, undefined, '过期异步变量更新不得写入新会话');
    } finally {
        f.context.chatMetadata = realMetadata;
    }
});

test('T14-7: macro_like 句柄资源归属（重复注册与旧句柄不误删、实例隔离）及 chat_message.string_to_range 纯声明导出', async () => {
    assert.ok(desktopSourceModules['helper/function/macro_like.js'], '必须配置 helper/function/macro_like.js');
    assert.ok(desktopSourceModules['helper/function/chat_message.js'], '必须配置 helper/function/chat_message.js');

    const { createHelperMacroLike } = await import(
        '../extension/vc-model-settings/desktop/locked-source/helper/function/macro_like.js'
    );
    const { string_to_range } = await import(
        '../extension/vc-model-settings/desktop/locked-source/helper/function/chat_message.js'
    );

    const createInstance = () =>
        createHelperMacroLike({
            get_variables_without_clone: () => ({ a: 1 }),
            getChat: () => [],
        });

    const inst1 = createInstance();
    const inst2 = createInstance();
    const baseLen = inst1.macros.length;

    // 场景 1：重复 regex.source 注册未插入新条目，且重复返回的句柄 unregister() 不得删除已有条目
    const replace1 = () => 'FIRST';
    const replace2 = () => 'SECOND';
    const handle1 = inst1.registerMacroLike(/DUP_SOURCE_TEST/g, replace1);
    assert.equal(inst1.macros.length, baseLen + 1);
    assert.equal(inst2.macros.length, baseLen, '不同实例的 macros 必须隔离');

    const dupHandle = inst1.registerMacroLike(/DUP_SOURCE_TEST/g, replace2);
    assert.equal(inst1.macros.length, baseLen + 1, '相同 regex.source 不重复插入');
    dupHandle.unregister();
    assert.equal(inst1.macros.length, baseLen + 1, '重复注册返回的空句柄 unregister 不得误删原条目');
    assert.equal(inst1.macros[baseLen].replace, replace1);

    // 场景 2：显式 unregisterMacroLike(regex) 后重新注册同 regex.source，旧句柄再次调用不得误删新条目
    inst1.unregisterMacroLike(/DUP_SOURCE_TEST/g);
    assert.equal(inst1.macros.length, baseLen, '显式 unregisterMacroLike 应按 source 删除匹配条目');

    const handleNew = inst1.registerMacroLike(/DUP_SOURCE_TEST/g, replace2);
    assert.equal(inst1.macros.length, baseLen + 1);
    assert.equal(inst1.macros[baseLen].replace, replace2);

    handle1.unregister();
    assert.equal(inst1.macros.length, baseLen + 1, '已失效的旧句柄不得删除新注册的同 source 条目');
    assert.equal(inst1.macros[baseLen].replace, replace2);

    handleNew.unregister();
    assert.equal(inst1.macros.length, baseLen, '新句柄自身 unregister 应正常删除其创建的条目');

    // string_to_range 纯函数语义验证
    assert.deepEqual(string_to_range('2', 0, 5), { start: 2, end: 2 });
    assert.deepEqual(string_to_range('-1', 0, 5), { start: 5, end: 5 });
    assert.deepEqual(string_to_range('1-3', 0, 5), { start: 1, end: 3 });
    assert.deepEqual(string_to_range('4-1', 0, 5), { start: 1, end: 4 });
    assert.deepEqual(string_to_range('-3--1', 0, 5), { start: 3, end: 5 });
    assert.deepEqual(string_to_range('-99-99', 0, 5), { start: 0, end: 5 });
    assert.equal(string_to_range('invalid', 0, 5), null);
    assert.equal(string_to_range('1-2-3', 0, 5), null);
});
