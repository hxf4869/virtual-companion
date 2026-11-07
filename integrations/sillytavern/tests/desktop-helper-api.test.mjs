import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import { Window } from 'happy-dom';

const sourceIdentityUrl = new URL('../server-plugin/virtual-companion/lib/source-identity.js', import.meta.url).href;

registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === '/scripts/vc-runtime/source-identity.js') {
            return { url: sourceIdentityUrl, shortCircuit: true };
        }
        return nextResolve(specifier, context);
    },
});

const happyWindow = new Window({ url: 'http://localhost:8000/desktop/' });
const wrapJqNodes = nodes => Object.assign(nodes, {
    on() { return this; },
    off() { return this; },
    triggerHandler: async () => {},
    find: sel => wrapJqNodes(nodes.flatMap(n => [...(n.querySelectorAll?.(sel) || [])])),
    text: () => nodes.map(n => n.textContent ?? '').join(''),
    html(val) {
        if (val === undefined) return nodes[0]?.innerHTML ?? '';
        for (const n of nodes) n.innerHTML = String(val);
        return this;
    },
    empty() {
        for (const n of nodes) n.innerHTML = '';
        return this;
    },
    append(val) {
        for (const n of nodes) {
            if (typeof val === 'string') n.insertAdjacentHTML('beforeend', val);
            else if (val) n.appendChild(val);
        }
        return this;
    },
});
const jqHandlers = new WeakMap();
const getJqBucket = (target, event) => {
    if (!target || (typeof target !== 'object' && typeof target !== 'function')) return [];
    let map = jqHandlers.get(target);
    if (!map) {
        map = new Map();
        jqHandlers.set(target, map);
    }
    let list = map.get(event);
    if (!list) {
        list = [];
        map.set(event, list);
    }
    return list;
};
const jQueryFn = selector => {
    if (typeof selector === 'string') {
        return wrapJqNodes([...happyWindow.document.querySelectorAll(selector)]);
    }
    if (typeof selector === 'function') {
        selector();
        return {};
    }
    return {
        on(event, handler) {
            if (typeof handler === 'function') {
                getJqBucket(selector, event).push(handler);
            }
            return this;
        },
        off(event, handler) {
            const list = getJqBucket(selector, event);
            if (!handler) {
                list.length = 0;
            } else {
                const idx = list.indexOf(handler);
                if (idx >= 0) list.splice(idx, 1);
            }
            return this;
        },
        async triggerHandler(event) {
            const list = [...getJqBucket(selector, event)];
            let last;
            for (const fn of list) {
                last = await fn.call(selector, { type: event, target: selector });
            }
            return last;
        },
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
const { lodash } = await import('../extension/vc-model-settings/desktop/locked-source/st/lib.js');
globalThis._ = lodash;
test.after(() => happyWindow.happyDOM.close());

const { EventEmitter } = await import('../extension/vc-model-settings/desktop/standalone/engine/events.js');
const { event_types } = await import('../extension/vc-model-settings/desktop/standalone/engine/st/events.js');
const { bindEngineContext } = await import('../extension/vc-model-settings/desktop/standalone/engine/ports.js');
const { openaiDefaults, powerUserDefaults } = await import('../extension/vc-model-settings/desktop/standalone/engine/defaults.js');
const { initializeCards } = await import('../extension/vc-model-settings/desktop/standalone/cards/index.js');
const {
    executeSlashCommandsWithOptions,
    SlashCommandAbortController,
    SlashCommandParser,
    SlashCommandScope,
} = await import('../extension/vc-model-settings/desktop/standalone/cards/helper-slash.js');
const { createDesktopSession } = await import('../extension/vc-model-settings/desktop/standalone/session.js');
const { prepareSourceIdentities } = await import('../server-plugin/virtual-companion/lib/source-identity.js');
const { documentEqual, documentValue, applyDocumentValues } = await import('../extension/vc-model-settings/settings-documents.js');

function createFixture() {
    const worldStore = {
        测试世界书: {
            entries: {
                0: {
                    uid: 0,
                    key: ['关键词A'],
                    keysecondary: [],
                    comment: '初始条目',
                    content: '初始内容',
                    constant: false,
                    selective: true,
                    selectiveLogic: 0,
                    order: 100,
                    position: 0,
                    disable: false,
                    useProbability: true,
                    probability: 100,
                    depth: 4,
                    role: 0,
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
        mes_example: '',
        data: {
            name: '测试角色',
            description: '角色描述',
            personality: '温柔',
            scenario: '书店',
            first_mes: '你好，欢迎来到书店。',
            mes_example: '',
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
                    scripts: [
                        {
                            type: 'script',
                            id: 'script-1',
                            name: '测试脚本1',
                            enabled: true,
                            content: '',
                            info: '脚本信息',
                            button: {
                                enabled: true,
                                buttons: [
                                    { name: '按钮A', visible: true },
                                    { name: '隐藏按钮', visible: false },
                                ],
                            },
                            data: {},
                        },
                    ],
                    variables: {},
                },
            },
        },
    };
    const initialMessages = [
        {
            name: '测试角色',
            is_user: false,
            is_system: false,
            send_date: '2026-11-04T00:00:00Z',
            mes: '第一条消息 CHAR_TOKEN',
            swipe_id: 0,
            swipes: ['第一条消息 CHAR_TOKEN', '第一条备选'],
            swipe_info: [{ send_date: '2026-11-04T00:00:00Z', extra: { tag: 's0' } }, { send_date: '2026-11-04T00:00:01Z', extra: { tag: 's1' } }],
            variables: [{ msg_var: 'v0' }, { msg_var: 'v0_alt' }],
            extra: { tag: 's0' },
        },
        {
            name: '测试用户',
            is_user: true,
            is_system: false,
            send_date: '2026-11-04T00:01:00Z',
            mes: '第二条消息',
            swipe_id: 0,
            swipes: ['第二条消息'],
            swipe_info: [{ send_date: '2026-11-04T00:01:00Z', extra: { tag: 'u0' } }],
            variables: [{ user_var: 'u0' }],
            extra: { tag: 'u0' },
        },
    ];
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
        ...structuredClone(initialMessages),
    ];
    prepareSourceIdentities(initialRecords, { settled: true, sourceTimezone: 'UTC' });
    let generations = 0;
    const settingsSaves = [];
    const f2Saves = [];
    const sessionStates = [];
    const refreshed = [];
    let generateGate = null;
    let notifyGenerateEntered = null;
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
            temp_openai: 1,
            top_p_openai: 1,
            openai_max_context: 4096,
            openai_max_tokens: 512,
            prompts: [],
            prompt_order: [{ character_id: 100001, order: [] }],
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
                'user-alt.png': { description: '备用人设描述', position: 1, depth: 4, role: 1, lorebook: '', title: '' },
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
    const presets = { Default: structuredClone(settings.oai_settings) };
    card.data.extensions.vc_character_ref = 'helper-test-ref';
    const capturedDocs = {};
    const client = {
        headers: () => ({}),
        getChatStorage: () => ({ mode: 'ST', authorityEpoch: '1' }),
        documents: {
            captureWorldbook(name, next) {
                capturedDocs[name] = structuredClone(next);
            },
        },
        saveSettings: async payload => {
            const value = typeof payload === 'function' ? payload() : payload;
            settingsSaves.push(structuredClone(value));
            return new Response('{}', { status: 200 });
        },
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
            generations++;
            if (notifyGenerateEntered) notifyGenerateEntered();
            if (generateGate) await generateGate;
            return new Response('{}', { status: 200 });
        },
        async request(url, body) {
            if (url === '/api/avatars/get') {
                return ['user-default.png', 'user-alt.png'];
            }
            if (url === '/api/characters/get') {
                return structuredClone(card);
            }
            if (url === '/api/worldinfo/get') {
                return structuredClone(worldStore[body.name] || { entries: {} });
            }
            if (url === '/api/characters/chats') {
                return [
                    {
                        file_name: 'chat-file-1.jsonl',
                        file_size: '1.2 KB',
                        chat_items: 2,
                        mes: '第二条消息',
                        last_mes: '2026-11-04T00:01:00Z',
                    },
                ];
            }
            if (url === '/api/chats/get') {
                return [
                    { user_name: '测试用户', character_name: '测试角色', chat_metadata: context.chatMetadata },
                    ...structuredClone(context.chat),
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
            if (url === '/api/worldinfo/delete') {
                delete worldStore[body.name];
                const idx = worldNames.indexOf(body.name);
                if (idx >= 0) worldNames.splice(idx, 1);
                return new Response('{}', { status: 200 });
            }
            return new Response('{}', { status: 200 });
        },
    };
    const container = document.createElement('div');
    container.id = 'chat';
    container.innerHTML = `
        <div class="mes" mesid="0"><div class="mes_text"><p>第一条消息</p></div></div>
        <div class="mes" mesid="1" is_user="true"><div class="mes_text"><p>第二条消息</p></div></div>
    `;
    document.body.innerHTML = '';
    document.body.appendChild(container);
    const engine = {
        settings,
        bindContext() {
            bindEngineContext(context, settings, { models: [], extensions: [] });
        },
        settingsForSave() {
            return settings;
        },
        firstMessage() {
            return null;
        },
        userMessage: async text => ({
            message: { name: context.name1, mes: text, is_user: true, is_system: false, send_date: '2026-11-04T00:05:00Z', swipe_id: 0, swipes: [text], variables: [{}], extra: {} },
            bias: {},
        }),
        async prepare() {
            return { body: { model: 'synthetic', chat_completion_source: 'custom' } };
        },
        cleanResponse: text => text,
        memory: { finalStatus() {} },
        generateHelper: async () => '合成脚本回复',
        cards: undefined,
    };
    engine.bindContext();
    let session;
    return {
        context,
        settings,
        presets,
        client,
        engine,
        worldStore,
        worldNames,
        container,
        refreshed,
        f2Saves,
        settingsSaves,
        capturedDocs,
        sessionStates,
        get session() { return session; },
        get savedChatCount() { return f2Saves.length; },
        get savedSettingsCount() { return settingsSaves.length; },
        get generations() { return generations; },
        pauseNextGenerate() {
            let release;
            generateGate = new Promise(resolve => { release = resolve; });
            const entered = new Promise(resolve => { notifyGenerateEntered = resolve; });
            return {
                entered,
                release() {
                    generateGate = null;
                    notifyGenerateEntered = null;
                    release();
                },
            };
        },
        async init() {
            session = createDesktopSession({
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
                onChange: state => sessionStates.push(state),
                readResponse: async (_response, { onUpdate }) => {
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
            f2Saves.length = 0;
            const origRefresh = cards.surface.refresh.bind(cards.surface);
            cards.surface.refresh = async (indices, opts) => {
                refreshed.push(...(Array.isArray(indices) ? indices : [indices]));
                return origRefresh(indices, opts);
            };
            return cards;
        },
    };
}

test('Batch 1: 补挂漏挂接口并移除 10 个内部 _ 函数顶层泄漏', async () => {
    const f = createFixture();
    await f.init();
    const th = globalThis.TavernHelper;

    // 1. 漏挂的 6 组接口
    assert.equal(typeof th.getAllEnabledScriptButtons, 'function');
    const enabledBtns = th.getAllEnabledScriptButtons();
    assert.equal(enabledBtns['script-1']?.length, 1);
    assert.equal(enabledBtns['script-1'][0].button_name, '按钮A');
    assert.equal(typeof enabledBtns['script-1'][0].button_id, 'string');

    assert.equal(typeof th.errorCatched, 'function');
    const safeFn = th.errorCatched(() => {
        throw new Error('boom');
    });
    assert.throws(() => safeFn(), /boom/);

    assert.equal(typeof th.isPresetSystemPrompt, 'function');
    assert.equal(typeof th.isPresetNormalPrompt, 'function');
    assert.equal(typeof th.isPresetPlaceholderPrompt, 'function');
    assert.equal(typeof th.default_preset, 'object');
    assert.equal(th.isPresetSystemPrompt({ id: 'main' }), true);
    assert.equal(th.isPresetPlaceholderPrompt({ id: 'chatHistory' }), true);
    assert.equal(th.isPresetPlaceholderPrompt({ id: 'chat_history' }), false);
    assert.equal(th.isPresetNormalPrompt({ id: 'custom_prompt_1' }), true);
    assert.equal(th.isPresetNormalPrompt({ id: 'main' }), false);
    assert.equal(th.isPresetNormalPrompt({ id: 'chatHistory' }), false);
    assert.equal(th.isPresetNormalPrompt({ id: 'chat_history' }), true);

    assert.equal(typeof th.RawCharacter, 'function');
    const rawChar = th.RawCharacter.find({ name: 'current' });
    assert.ok(rawChar);
    assert.equal(rawChar.getAvatarId(), 'helper-test.png');
    assert.equal(rawChar.getWorldName(), '测试世界书');
    assert.equal(th.RawCharacter.findIndex({ name: '测试角色' }), 0);

    assert.ok(Array.isArray(th.builtin_prompt_default_order));
    assert.deepEqual(th.builtin_prompt_default_order, th.placeholder_prompt_default_order);

    assert.equal(typeof th.getFrontendVersion, 'function');
    assert.equal(th.getFrontendVersion(), th.getTavernHelperVersion());

    // 2. 移除 10 个内部函数顶层泄漏，但保留 _bind
    const leaked = [
        '_getVariables',
        '_getAllVariables',
        '_replaceVariables',
        '_updateVariablesWith',
        '_insertOrAssignVariables',
        '_insertVariables',
        '_deleteVariable',
        'get_variables_without_clone',
        '_initializeGlobal',
        '_waitGlobalInitialized',
    ];
    for (const name of leaked) {
        assert.equal(Object.hasOwn(th, name), false, `顶层 TavernHelper 不应泄漏内部函数 ${name}`);
    }
    const underscoreKeys = Object.keys(th).filter(k => k.startsWith('_')).sort();
    assert.deepEqual(underscoreKeys, ['_bind', '_th_impl']);
    for (const name of leaked.filter(n => n.startsWith('_'))) {
        assert.equal(typeof th._bind[name], 'function', `_bind 仍须保留 ${name}`);
    }
});

test('Batch 2: setLorebookSettings、triggerSlash/triggerSlashWithResult 与 _registerMacroLike/EJS 生效', async () => {
    const f = createFixture();
    await f.init();
    const th = globalThis.TavernHelper;

    // 1. setLorebookSettings
    assert.equal(typeof th.setLorebookSettings, 'function');
    assert.equal(typeof th._bind._setLorebookSettings, 'function');
    th.setLorebookSettings({ scan_depth: 6, selected_global_lorebooks: ['备用世界书'] });
    assert.equal(th.getLorebookSettings().scan_depth, 6);
    assert.deepEqual(th.getLorebookSettings().selected_global_lorebooks, ['备用世界书']);

    // 2. triggerSlash / triggerSlashWithResult 与 EJS execute()
    assert.equal(typeof th.triggerSlash, 'function');
    assert.equal(typeof th.triggerSlashWithResult, 'function');
    assert.equal(typeof th._bind._triggerSlash, 'function');
    assert.equal(typeof th._bind._triggerSlashWithResult, 'function');

    const slashRes = await th.triggerSlash('/setvar key=score 40 | /addvar key=score 2 | /getvar score');
    assert.equal(slashRes, '42');
    assert.equal(f.context.chatMetadata.variables.score, 42);

    const withRes = await th.triggerSlashWithResult('/incvar score | /getvar score');
    assert.equal(withRes, '43');

    const savesBeforeEjs = f.savedChatCount;
    const ejsSlash = await globalThis.EjsTemplate.evalTemplate('<%= await execute("/setvar key=from_ejs 77 | /getvar from_ejs") %>');
    assert.equal(ejsSlash, '77');
    assert.equal(f.context.chatMetadata.variables.from_ejs, '77');
    assert.equal(f.savedChatCount, savesBeforeEjs + 1);
    assert.equal(f.f2Saves.at(-1).chat[0].chat_metadata.variables.from_ejs, '77');

    // 3. registerMacroLike / _bind._registerMacroLike / unregisterMacroLike
    assert.equal(typeof th.registerMacroLike, 'function');
    assert.equal(typeof th.unregisterMacroLike, 'function');
    assert.equal(typeof th._bind._registerMacroLike, 'function');

    // EjsTemplate.evalTemplate 保持原生 ST-Prompt-Template 行为，不叠加全局宏前后包裹
    let ejsProbeCalls = 0;
    const probeHandle = th.registerMacroLike(/DR2_EJS_MACRO_PROBE/g, (_ctx, match) => {
        ejsProbeCalls++;
        return `${match}x`;
    });
    try {
        const probeOut = await globalThis.EjsTemplate.evalTemplate('DR2_EJS_MACRO_PROBE<%= 1 + 1 %>', null, {});
        assert.equal(ejsProbeCalls, 0, 'EjsTemplate.evalTemplate 不得在模板求值前后直接执行 replaceMacroLike');
        assert.equal(probeOut, 'DR2_EJS_MACRO_PROBE2');
        assert.equal(probeOut.length, 20);
    } finally {
        probeHandle.unregister();
    }

    const mockIframeWin = Object.assign(new EventTarget(), {
        frameElement: { isConnected: true },
    });
    const handle = th._bind._registerMacroLike.call(
        mockIframeWin,
        /\{\{custom_tag::(.*?)\}\}/g,
        (_ctx, _full, val) => `[TAG:${val}]`,
    );
    assert.equal(typeof handle?.unregister, 'function');

    // 在真实展示渲染管线中生效
    const displayOut = th.formatAsDisplayedMessage('结果={{custom_tag::DISPLAY_OK}} {{get_chat_variable::from_ejs}}', { message_id: 0 });
    assert.ok(displayOut.includes('结果=[TAG:DISPLAY_OK] 77'));

    // 在生成提示词事件钩子中生效
    const promptData = { prompt: [{ role: 'user', content: '请处理 {{custom_tag::PROMPT_OK}}' }] };
    await f.context.eventSource.emit(f.context.eventTypes.GENERATE_AFTER_DATA, promptData);
    assert.equal(promptData.prompt[0].content, '请处理 [TAG:PROMPT_OK]');

    // iframe pagehide 自动卸载
    mockIframeWin.dispatchEvent(new Event('pagehide'));
    const afterUnload = th.formatAsDisplayedMessage('{{custom_tag::DISPLAY_OK}}', { message_id: 0 });
    assert.ok(!afterUnload.includes('[TAG:DISPLAY_OK]'));
});

test('Batch 3: 世界书旧名包装、消息增删旋转、提示词注入、只读角色/人设、展示/正则、builtin 与不支持接口报错', async () => {
    const f = createFixture();
    await f.init();
    const th = globalThis.TavernHelper;

    // 1. 世界书旧名包装（保留未知字段）
    assert.equal(await th.createLorebook('新世界书X'), true);
    const uid1 = await th.createLorebookEntry('新世界书X', {
        comment: '条目A',
        content: '内容A',
        keys: ['keyA'],
        custom_meta: 'keep_meta_A',
    });
    assert.equal(typeof uid1, 'number');
    const createdMulti = await th.createLorebookEntries('新世界书X', [
        { comment: '条目B', content: '内容B', keys: ['keyB'], custom_meta: 'keep_meta_B' },
    ]);
    assert.equal(createdMulti.new_uids.length, 1);
    assert.equal(createdMulti.entries.length, 2);

    let entries = await th.getLorebookEntries('新世界书X');
    assert.equal(entries.length, 2);
    assert.equal(entries[0].custom_meta, 'keep_meta_A');
    assert.equal(entries[1].custom_meta, 'keep_meta_B');

    await th.setLorebookEntries('新世界书X', [{ uid: uid1, content: '内容A-更新' }]);
    entries = await th.getLorebookEntries('新世界书X');
    assert.equal(entries.find(e => e.uid === uid1).content, '内容A-更新');
    assert.equal(entries.find(e => e.uid === uid1).custom_meta, 'keep_meta_A');

    await th.updateLorebookEntriesWith('新世界书X', list =>
        list.map(item => ({ ...item, order: 250 })),
    );
    entries = await th.getLorebookEntries('新世界书X');
    assert.equal(entries[0].order, 250);
    assert.equal(entries[0].custom_meta, 'keep_meta_A');

    await th.replaceLorebookEntries('新世界书X', [
        { uid: 0, comment: '替换后', content: '替换内容', keys: ['k'], replaced_custom: 999 },
    ]);
    entries = await th.getLorebookEntries('新世界书X');
    assert.equal(entries.length, 1);
    assert.equal(entries[0].replaced_custom, 999);

    assert.equal(await th.deleteLorebookEntry('新世界书X', 0), true);
    assert.equal((await th.getLorebookEntries('新世界书X')).length, 0);
    assert.equal(await th.deleteLorebook('新世界书X'), true);

    // 2. 消息增删与旋转（经唯一 Session / F2 保存，单次 save、保留对象/候选/UI key/source 身份、拒绝忙或过期）
    const m0 = f.context.chat[0];
    const m1 = f.context.chat[1];
    const key0 = f.session.messageKey(m0, 0);
    const key1 = f.session.messageKey(m1, 1);
    const src0 = structuredClone(m0.extra?.vc_source);
    const src1 = structuredClone(m1.extra?.vc_source);
    const swipeInfo0 = structuredClone(m0.swipe_info);
    assert.ok(src0?.id);
    assert.ok(src1?.id);

    const emittedEvents = [];
    f.context.eventSource.on(event_types.MESSAGE_RECEIVED, (idx, tag) => emittedEvents.push(['MESSAGE_RECEIVED', idx, tag]));
    f.context.eventSource.on(event_types.MESSAGE_SENT, (idx, tag) => emittedEvents.push(['MESSAGE_SENT', idx, tag]));
    f.context.eventSource.on(event_types.MESSAGE_DELETED, idx => emittedEvents.push(['MESSAGE_DELETED', idx]));

    const beforeSave = f.savedChatCount;
    const revBeforeCreate = f.context.chatMetadata.vc_f2.revision;
    await th.createChatMessages([
        { role: 'assistant', message: '第三条消息', data: { step: 3 } },
    ]);
    assert.equal(f.savedChatCount, beforeSave + 1, 'createChatMessages 必须恰好触发 1 次 F2 保存');
    assert.equal(f.context.chatMetadata.vc_f2.revision, revBeforeCreate + 1);
    assert.equal(f.context.chat.length, 3);
    assert.equal(f.context.chat[0], m0);
    assert.equal(f.context.chat[1], m1);
    const m2 = f.context.chat[2];
    assert.equal(m2.mes, '第三条消息');
    assert.deepEqual(m2.variables[0], { user_var: 'u0', step: 3 });
    assert.ok(m2.extra?.vc_source?.id, '新消息必须由 prepareSourceIdentities/F2 分配 vc_source');
    const key2 = f.session.messageKey(m2, 2);
    assert.equal(f.session.messageKey(f.context.chat[0], 0), key0);
    assert.equal(f.session.messageKey(f.context.chat[1], 1), key1);
    assert.deepEqual(emittedEvents, [['MESSAGE_RECEIVED', 2, 'extension']]);
    for (const savedRecord of f.f2Saves.at(-1).chat.slice(1)) {
        assert.equal(Object.hasOwn(savedRecord, 'key'), false, 'JSONL 不得写入 UI key');
    }

    const src2 = structuredClone(m2.extra.vc_source);
    const beforeRotateSave = f.savedChatCount;
    await th.rotateChatMessages(0, 2, 3);
    assert.equal(f.savedChatCount, beforeRotateSave + 1, 'rotateChatMessages 必须恰好触发 1 次 F2 保存');
    assert.equal(f.context.chat[0], m2);
    assert.equal(f.context.chat[1], m0);
    assert.equal(f.context.chat[2], m1);
    assert.deepEqual(f.context.chat[1].swipes, ['第一条消息 CHAR_TOKEN', '第一条备选']);
    assert.deepEqual(f.context.chat[1].swipe_info, swipeInfo0);
    assert.deepEqual(f.context.chat[1].variables, [{ msg_var: 'v0' }, { msg_var: 'v0_alt' }]);
    assert.equal(f.session.messageKey(f.context.chat[0], 0), key2);
    assert.equal(f.session.messageKey(f.context.chat[1], 1), key0);
    assert.equal(f.session.messageKey(f.context.chat[2], 2), key1);
    assert.deepEqual(f.context.chat[0].extra.vc_source, src2);
    assert.deepEqual(f.context.chat[1].extra.vc_source, src0);
    assert.deepEqual(f.context.chat[2].extra.vc_source, src1);

    // 批量删除两条消息：再追加一条后一次性删除 [0, 3]，验证恰好保存 1 次且保留中间 m0/m1 对象与身份
    await th.createChatMessages([{ role: 'user', message: '第四条消息' }]);
    assert.equal(f.context.chat.length, 4);
    emittedEvents.length = 0;
    const beforeBatchDeleteSave = f.savedChatCount;
    await th.deleteChatMessages([0, 3]);
    assert.equal(f.savedChatCount, beforeBatchDeleteSave + 1, '批量 deleteChatMessages 必须恰好触发 1 次 F2 保存');
    assert.equal(f.context.chat.length, 2);
    assert.equal(f.context.chat[0], m0);
    assert.equal(f.context.chat[1], m1);
    assert.equal(f.session.messageKey(f.context.chat[0], 0), key0);
    assert.equal(f.session.messageKey(f.context.chat[1], 1), key1);
    assert.deepEqual(f.context.chat[0].extra.vc_source, src0);
    assert.deepEqual(f.context.chat[1].extra.vc_source, src1);
    assert.deepEqual(emittedEvents, [['MESSAGE_DELETED', 0], ['MESSAGE_DELETED', 3]]);

    // 过期 metadata：零写入、零保存、明确抛错
    const realMetadata = f.context.chatMetadata;
    const savesBeforeStale = f.savedChatCount;
    f.context.chatMetadata = { vc_f2: { id: 'stale-chat', revision: 1 } };
    try {
        await assert.rejects(
            () => th.createChatMessages([{ role: 'assistant', message: '过期写入' }]),
            /VC_CHAT_MUTATION_REJECTED/,
        );
        await assert.rejects(
            () => th.deleteChatMessages([0]),
            /VC_CHAT_MUTATION_REJECTED/,
        );
        await assert.rejects(
            () => th.rotateChatMessages(0, 1, 2),
            /VC_CHAT_MUTATION_REJECTED/,
        );
    } finally {
        f.context.chatMetadata = realMetadata;
    }
    assert.equal(f.savedChatCount, savesBeforeStale);
    assert.equal(f.context.chat.length, 2);
    assert.equal(f.context.chat[0], m0);
    assert.equal(f.context.chat[1], m1);

    // 生成 busy 期间：零写入、零保存、明确抛错
    const gate = f.pauseNextGenerate();
    const sendPromise = f.session.send('正在生成的用户输入');
    await gate.entered;
    assert.equal(f.session.busy, true);
    const savesDuringBusy = f.savedChatCount;
    const lenDuringBusy = f.context.chat.length;
    await assert.rejects(
        () => th.createChatMessages([{ role: 'assistant', message: 'busy写入' }]),
        /VC_CHAT_MUTATION_REJECTED/,
    );
    await assert.rejects(
        () => th.deleteChatMessages([0]),
        /VC_CHAT_MUTATION_REJECTED/,
    );
    await assert.rejects(
        () => th.rotateChatMessages(0, 1, 2),
        /VC_CHAT_MUTATION_REJECTED/,
    );
    assert.equal(f.savedChatCount, savesDuringBusy, 'busy 拒绝不得产生额外 F2 保存');
    assert.equal(f.context.chat.length, lenDuringBusy, 'busy 拒绝不得修改消息数组');
    gate.release();
    assert.equal(await sendPromise, true);
    await th.deleteChatMessages([-2, -1]);
    assert.equal(f.context.chat.length, 2);

    // 可重入 EJS / render 期间调用：通过真实 cards.renderMessage -> ejs.render 触发，立即明确拒绝且不挂起 cards.settle()
    const savesBeforeReentrant = f.savedChatCount;
    const origMes = m0.mes;
    const reentrantErrors = [];
    globalThis.__testReentrantCapture = err => { reentrantErrors.push(String(err?.message || err)); };
    m0.mes = '<%_ for (const fn of [() => createChatMessages([{ role: "assistant", message: "重入写入" }]), () => deleteChatMessages([0]), () => rotateChatMessages(0, 1, 2)]) { try { await fn(); } catch (e) { globalThis.__testReentrantCapture(e); } } _%>第一条消息 CHAR_TOKEN';
    m0.swipes[0] = m0.mes;
    try {
        const renderCell = f.container.querySelector('.mes[mesid="0"]');
        f.engine.cards.renderMessage(renderCell, 0, m0, false);
        assert.equal(f.engine.cards.isRendering(), true, 'renderMessage 调度期间 cards.isRendering() 必须为 true');
        await f.engine.cards.settle();
        assert.equal(f.engine.cards.isRendering(), false);
        assert.deepEqual(reentrantErrors, [
            'VC_CHAT_MUTATION_REJECTED',
            'VC_CHAT_MUTATION_REJECTED',
            'VC_CHAT_MUTATION_REJECTED',
        ]);
        assert.equal(f.savedChatCount, savesBeforeReentrant);
        assert.equal(f.context.chat.length, 2);
    } finally {
        delete globalThis.__testReentrantCapture;
        m0.mes = origMes;
        m0.swipes[0] = origMes;
    }

    // 3. 提示词注入
    th.injectPrompts([
        { id: 'inj-1', position: 'in_chat', depth: 2, role: 'system', content: '注入系统提示', should_scan: true },
    ]);
    assert.equal(f.context.extensionPrompts['inj-1']?.value, '注入系统提示');
    th.uninjectPrompts(['inj-1']);
    assert.equal(f.context.extensionPrompts['inj-1'], undefined);

    th.injectPrompts(
        [{ id: 'inj-once', position: 'in_chat', depth: 1, role: 'user', content: '单次注入提示' }],
        { once: true },
    );
    assert.equal(f.context.extensionPrompts['inj-once']?.value, '单次注入提示');
    await f.context.eventSource.emit(event_types.GENERATION_ENDED);
    assert.equal(f.context.extensionPrompts['inj-once'], undefined);

    // 4. 只读角色与人设
    assert.equal(th.getCurrentCharacterName(), '测试角色');
    assert.equal(th.getCurrentCharacterId(), 'helper-test.png');
    assert.deepEqual(th.getCharacterNames(), ['测试角色']);
    assert.deepEqual(th.getCharacterIds(), ['helper-test.png']);
    assert.equal(th.getCharData('current').name, '测试角色');
    assert.equal(th.getCharAvatarPath('current'), '/characters/helper-test.png');
    const currentCharacter = await th.getCharacter('current');
    assert.equal('name' in currentCharacter, false);
    assert.equal(currentCharacter.avatar, 'helper-test.png');
    assert.equal(currentCharacter.version, '1.0');
    assert.equal(currentCharacter.creator, 'creatorA');
    assert.equal(currentCharacter.creator_notes, '作者备注');
    assert.equal(currentCharacter.description, '角色描述');
    assert.deepEqual(currentCharacter.first_messages, ['你好，欢迎来到书店。', '备选开场1']);
    assert.equal(currentCharacter.worldbook, '测试世界书');
    assert.equal(currentCharacter.extensions.world, undefined);
    assert.equal(currentCharacter.extensions.regex_scripts[0].script_name, '角色正则');
    assert.equal(currentCharacter.extensions.tavern_helper.scripts[0].id, 'script-1');
    const brief = await th.getChatHistoryBrief('current');
    assert.equal(brief.length, 1);
    const detail = await th.getChatHistoryDetail(brief);
    assert.equal(Object.keys(detail).length, 1);
    assert.equal(detail['chat-file-1.jsonl'].length, 2);

    assert.equal(th.getCurrentPersonaName(), '测试用户');
    assert.equal(th.getCurrentPersonaId(), 'user-default.png');
    assert.equal(th.getPersonaAvatarPath('current'), './User Avatars/user-default.png');
    assert.deepEqual(th.getPersonaIds(), ['user-default.png', 'user-alt.png']);
    assert.deepEqual(th.getPersonaNames(), ['测试用户', '备用人设']);
    assert.equal(th.getPersona('current').description, '默认人设描述');

    // 5. 展示格式化、节点获取、单条刷新与酒馆正则
    assert.equal(th.isCharacterTavernRegexesEnabled(), true);
    const regexes = th.getTavernRegexes({ scope: 'all' });
    assert.equal(regexes.length, 2);
    const regexed = th.formatAsTavernRegexedString('测试 GLOBAL_TOKEN 与 CHAR_TOKEN', 'ai_output', 'display');
    assert.equal(regexed, '测试 GLOBAL_REPLACED 与 CHAR_REPLACED');
    const regexedObj = th.formatAsTavernRegexedString('测试 GLOBAL_TOKEN 与 CHAR_TOKEN', {
        source: 'ai_output',
        destination: 'display',
    });
    assert.equal(regexedObj, '测试 GLOBAL_REPLACED 与 CHAR_REPLACED');

    const displayed = th.formatAsDisplayedMessage('**加粗** CHAR_TOKEN', { message_id: 0 });
    assert.ok(displayed.includes('<strong>加粗</strong>'));
    assert.ok(displayed.includes('CHAR_REPLACED'));

    const domNode = th.retrieveDisplayedMessage(0);
    assert.equal(domNode.length, 1);

    await th.refreshOneMessage(0);
    assert.ok(f.refreshed.includes(0));

    // 6. builtin
    assert.match(th.builtin.uuidv4(), /^[0-9a-f-]{36}$/i);
    assert.deepEqual(th.builtin.parseRegexFromString('/hello/gi'), /hello/gi);
    assert.ok(th.builtin.renderMarkdown('**hi**').includes('<strong>hi</strong>'));
    assert.equal(typeof th.builtin.duringGenerating(), 'boolean');
    const prevSettingsSaved = f.savedSettingsCount;
    th.builtin.saveSettings();
    assert.equal(f.savedSettingsCount, prevSettingsSaved + 1);
    await th.builtin.copyText('test-copy');
    assert.equal(th.getTavernVersion(), '1.13.0');

    // 7. 计划“不做”接口明确报 VC_HELPER_UNSUPPORTED:<name>
    const unsupported = [
        'playSound', 'getAudioList', 'appendAudioList', 'replaceAudioList',
        'getAudioSettings', 'setAudioSettings', 'pauseAudio', 'playAudio',
        'isInstalledExtension', 'getExtensionInstallationInfo', 'updateTavernHelper', 'updateFrontendVersion', 'isFrontend',
        'importRawCharacter', 'importRawChat', 'importRawPreset', 'importRawWorldbook', 'importRawTavernRegex',
        'createCharacter', 'deleteCharacter', 'replaceCharacter', 'updateCharacterWith', 'createOrReplaceCharacter', 'setCurrentCharacter',
        'createPersona', 'deletePersona', 'replacePersona', 'updatePersonaWith', 'createOrReplacePersona', 'setCurrentPersona',
        'loadPreset', 'createPreset', 'deletePreset', 'createOrReplacePreset',
        'replaceTavernRegexes', 'updateTavernRegexesWith',
    ];
    for (const name of unsupported) {
        assert.equal(typeof th[name], 'function', `不支持接口 ${name} 必须存在于 TavernHelper`);
        assert.throws(
            () => th[name]('sensitive-secret-arg'),
            err => err instanceof Error && err.message === `VC_HELPER_UNSUPPORTED:${name}`,
            `${name} 应抛 VC_HELPER_UNSUPPORTED:${name}`,
        );
    }

    // 8. iframe window 经 predefine.js 绑定后同样挂载全部 Batch 1-3 接口且 RawCharacter 保持静态方法
    const predefineSource = fs.readFileSync(
        new URL('../extension/vc-model-settings/desktop/standalone/cards/predefine.js', import.meta.url),
        'utf8',
    );
    const frameEl = document.createElement('iframe');
    frameEl.id = 'TH-message--0--0';
    document.body.appendChild(frameEl);
    const iframeWin = {
        parent: globalThis,
        frameElement: frameEl,
        name: 'TH-message--0--0',
        addEventListener() {},
    };
    iframeWin.window = iframeWin;
    new Function('window', '$', '_', `with (window) {\n${predefineSource}\n}`)(iframeWin, globalThis.$, globalThis._);
    const batchNames = [
        'getAllEnabledScriptButtons', 'errorCatched', 'isPresetSystemPrompt', 'isPresetNormalPrompt',
        'isPresetPlaceholderPrompt', 'default_preset', 'RawCharacter', 'builtin_prompt_default_order',
        'getFrontendVersion', 'setLorebookSettings', 'triggerSlash', 'triggerSlashWithResult',
        'registerMacroLike', 'unregisterMacroLike', 'setLorebookEntries', 'createLorebookEntries',
        'createLorebookEntry', 'deleteLorebookEntries', 'deleteLorebookEntry', 'replaceLorebookEntries',
        'updateLorebookEntriesWith', 'createLorebook', 'deleteLorebook', 'createChatMessages',
        'deleteChatMessages', 'rotateChatMessages', 'injectPrompts', 'uninjectPrompts', 'getCharData',
        'getCharAvatarPath', 'getCurrentCharacterName', 'getCurrentCharacterId', 'getCharacterNames',
        'getCharacterIds', 'getCharacter', 'getChatHistoryBrief', 'getChatHistoryDetail',
        'getCurrentPersonaName', 'getCurrentPersonaId', 'getPersonaAvatarPath', 'getPersonaNames',
        'getPersonaIds', 'getPersona', 'formatAsTavernRegexedString', 'formatAsDisplayedMessage',
        'retrieveDisplayedMessage', 'refreshOneMessage', 'getTavernRegexes',
        'isCharacterTavernRegexesEnabled', 'builtin',
    ];
    for (const name of batchNames) {
        assert.notEqual(iframeWin.TavernHelper[name], undefined, `iframe.TavernHelper 缺少 ${name}`);
        assert.notEqual(iframeWin[name], undefined, `iframe window 缺少 ${name}`);
    }
    assert.equal(typeof iframeWin.TavernHelper.RawCharacter.find, 'function');
    assert.equal(iframeWin.TavernHelper.RawCharacter.find({ name: 'current' })?.getAvatarId(), 'helper-test.png');
});

test('Audit 1 & 2: iframe _injectPrompts 与 _registerMacroLike 经生产 [data-vc-card-scripts] 与 closeScripts() 立即同步清理且幂等', async () => {
    const f = createFixture();
    const cards = await f.init();
    const th = globalThis.TavernHelper;
    const predefineSource = fs.readFileSync(
        new URL('../extension/vc-model-settings/desktop/standalone/cards/predefine.js', import.meta.url),
        'utf8',
    );
    const scriptHost = document.querySelector('[data-vc-card-scripts]');
    assert.ok(scriptHost, 'initializeCards 必须创建生产 [data-vc-card-scripts] 容器');
    const frameEl = document.createElement('iframe');
    frameEl.id = 'TH-script--script-1';
    scriptHost.appendChild(frameEl);
    const iframeWin = Object.assign(new EventTarget(), {
        parent: globalThis,
        frameElement: frameEl,
        name: 'TH-script--script-1',
        jQuery: globalThis.jQuery,
        $: globalThis.$,
    });
    iframeWin.window = iframeWin;
    Object.defineProperty(frameEl, 'contentWindow', { value: iframeWin, configurable: true });
    new Function('window', '$', '_', `with (window) {\n${predefineSource}\n}`)(iframeWin, globalThis.$, globalThis._);

    iframeWin.injectPrompts(
        [{ id: 'iframe-leak-check', position: 'in_chat', depth: 1, role: 'system', content: '来自子frame的持久注入' }],
        { once: false },
    );
    assert.equal(f.context.extensionPrompts['iframe-leak-check']?.value, '来自子frame的持久注入');

    iframeWin.registerMacroLike(/\{\{iframe_macro\}\}/g, () => 'IFRAME_MACRO_ACTIVE');
    assert.ok(th.formatAsDisplayedMessage('{{iframe_macro}}', { message_id: 0 }).includes('IFRAME_MACRO_ACTIVE'));
    const activePrompt = { prompt: [{ role: 'user', content: '{{iframe_macro}}' }] };
    await f.context.eventSource.emit(event_types.GENERATE_AFTER_DATA, activePrompt, false);
    assert.equal(activePrompt.prompt[0].content, 'IFRAME_MACRO_ACTIVE');

    // closeScripts 遍历生产 [data-vc-card-scripts] 并触发 jQuery pagehide；不派发原生 Event('pagehide') 前即须完成清理
    await cards.closeScripts();

    assert.equal(f.context.extensionPrompts['iframe-leak-check'], undefined, 'closeScripts 后（未触发原生 pagehide 前）子 frame 的 once:false 注入必须立即清空');
    assert.ok(
        !th.formatAsDisplayedMessage('{{iframe_macro}}', { message_id: 0 }).includes('IFRAME_MACRO_ACTIVE'),
        'closeScripts 后（未触发原生 pagehide 前）子 frame 的展示宏必须立即注销',
    );
    const closedPrompt = { prompt: [{ role: 'user', content: '{{iframe_macro}}' }] };
    await f.context.eventSource.emit(event_types.GENERATE_AFTER_DATA, closedPrompt, false);
    assert.equal(closedPrompt.prompt[0].content, '{{iframe_macro}}', 'closeScripts 后生成提示词宏必须立即注销');

    // 即使随后再触发原生 pagehide 也应幂等不报错
    iframeWin.dispatchEvent(new Event('pagehide'));
});

test('Audit 3: createChatMessages 事件顺序 (SENT/RECEIVED -> refresh -> RENDERED -> 单次 F2 保存含 MVU 回调写入)', async () => {
    const f = createFixture();
    await f.init();
    const th = globalThis.TavernHelper;

    const trace = [];
    const origRefresh = f.engine.cards.surface.refresh.bind(f.engine.cards.surface);
    f.engine.cards.surface.refresh = async (indices, opts) => {
        trace.push(`refresh:${Array.isArray(indices) ? indices.join(',') : indices}`);
        return origRefresh(indices, opts);
    };

    f.context.eventSource.on(event_types.MESSAGE_SENT, idx => trace.push(`MESSAGE_SENT:${idx}`));
    f.context.eventSource.on(event_types.MESSAGE_RECEIVED, (idx, tag) => trace.push(`MESSAGE_RECEIVED:${idx}:${tag}`));
    f.context.eventSource.on(event_types.USER_MESSAGE_RENDERED, idx => {
        trace.push(`USER_MESSAGE_RENDERED:${idx}`);
    });
    f.context.eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, idx => {
        trace.push(`CHARACTER_MESSAGE_RENDERED:${idx}`);
        // 模拟 MVU 在 CHARACTER_MESSAGE_RENDERED 回调中非阻塞 applyResult 写入 chatMetadata 与楼层变量
        f.context.chatMetadata.variables.mvu_rendered_applied = `applied_at_${idx}`;
        f.context.chat[idx].variables[0].mvu_floor_applied = true;
    });

    const savesBefore = f.savedChatCount;
    await th.createChatMessages([
        { role: 'user', message: '新增用户消息' },
        { role: 'assistant', message: '新增助手消息' },
    ]);

    assert.equal(f.savedChatCount, savesBefore + 1, '包含 RENDERED 回调修改的 createChatMessages 仍只能触发 1 次 F2 保存');
    assert.deepEqual(trace, [
        'MESSAGE_SENT:2',
        'MESSAGE_RECEIVED:3:extension',
        'refresh:2,3',
        'USER_MESSAGE_RENDERED:2',
        'CHARACTER_MESSAGE_RENDERED:3',
    ]);
    const savedPayload = f.f2Saves.at(-1);
    assert.equal(savedPayload.chat[0].chat_metadata.variables.mvu_rendered_applied, 'applied_at_3', 'RENDERED 回调写入的 chatMetadata 必须进入同一次 F2 保存');
    assert.equal(savedPayload.chat[4].variables[0].mvu_floor_applied, true, 'RENDERED 回调写入的楼层变量必须进入同一次 F2 保存');
});

test('T14: /send 的 at 与 return 经真实 Session 提交，并等待 RENDERED 中的 EJS 变量回写', async t => {
    const f = createFixture();
    await f.init();
    t.after(() => f.session.destroySession());
    const th = globalThis.TavernHelper;
    const initial = f.context.chat.map(message => message.mes);

    const appended = await th.triggerSlash('/send at=-0 return=pipe appended');
    assert.equal(appended, 'appended');
    assert.deepEqual(f.context.chat.map(message => message.mes), [...initial, 'appended']);
    assert.equal(f.savedChatCount, 1);

    const rendered = Promise.withResolvers();
    const finishRendered = Promise.withResolvers();
    f.context.eventSource.on(event_types.USER_MESSAGE_RENDERED, async index => {
        rendered.resolve(index);
        await finishRendered.promise;
        const suffix = await globalThis.EjsTemplate.evalTemplate(
            '<%= await execute("/setvar key=rendered committed || /setglobalvar key=rendered_pref stored") %>',
        );
        f.context.chat[index].mes += ` ${suffix}`;
    });
    f.refreshed.length = 0;
    const revisionBefore = f.context.chatMetadata.vc_f2.revision;
    const settingsBefore = f.savedSettingsCount;
    const pending = th.triggerSlash('/send at=-1 name=Fixture return=object inserted');
    try {
        assert.equal(await Promise.race([rendered.promise, pending]), initial.length);
        assert.deepEqual(f.context.chat.map(message => message.mes), [...initial, 'inserted', 'appended']);
        assert.deepEqual(f.refreshed, [initial.length, initial.length + 1]);
        assert.equal(f.savedChatCount, 1, '异步 RENDERED 回写完成前不得提交 F2');
        assert.equal(f.savedSettingsCount, settingsBefore);
    } finally {
        finishRendered.resolve();
    }

    const inserted = JSON.parse(await pending);
    assert.equal(inserted.name, 'Fixture');
    assert.equal(inserted.is_user, true);
    assert.equal(inserted.mes, 'inserted stored');
    assert.equal(f.savedChatCount, 2);
    assert.equal(f.f2Saves.at(-1).chat[initial.length + 1].mes, inserted.mes);
    const savedMetadata = f.f2Saves.at(-1).chat[0].chat_metadata;
    assert.equal(savedMetadata.vc_f2.revision, revisionBefore);
    assert.equal(f.context.chatMetadata.vc_f2.revision, revisionBefore + 1);
    assert.equal(savedMetadata.variables.rendered, 'committed');
    assert.equal(f.savedSettingsCount, settingsBefore + 1);
    assert.equal(f.settingsSaves.at(-1).extension_settings.variables.global.rendered_pref, 'stored');
    assert.equal(f.generations, 0);
});

test('T14: 在真实 Session 等待 cards.settle 时取消 /send，消息、变量和 F2 均保持原值', async t => {
    const f = createFixture();
    const cards = await f.init();
    t.after(() => f.session.destroySession());
    const messagesBefore = structuredClone(f.context.chat);
    const { variables: variablesBefore, vc_f2: tokenBefore } = structuredClone(f.context.chatMetadata);
    const settingsBefore = f.savedSettingsCount;
    const cardWrite = Promise.withResolvers();
    const settling = Promise.withResolvers();
    f.context.cardWrites = [cardWrite.promise];
    const settle = cards.settle.bind(cards);
    cards.settle = () => {
        const pending = settle();
        settling.resolve(true);
        return pending;
    };

    const abortController = new SlashCommandAbortController();
    const pending = executeSlashCommandsWithOptions('/send cancelled-in-settle', { abortController });
    try {
        assert.equal(await Promise.race([settling.promise, pending]), true);
        assert.equal(f.session.busy, true);
        abortController.abort('fixture cancellation', true);
    } finally {
        cardWrite.resolve();
    }
    const result = await pending;
    assert.equal(result.isAborted, true);
    assert.equal(result.isError, false);
    assert.deepEqual(f.context.chat, messagesBefore);
    assert.deepEqual(f.context.chatMetadata.variables, variablesBefore);
    assert.deepEqual(f.context.chatMetadata.vc_f2, tokenBefore);
    assert.equal(f.context.metadataDirty, false);
    assert.deepEqual(f.refreshed, []);
    assert.equal(f.savedChatCount, 0);
    assert.equal(f.savedSettingsCount, settingsBefore);
});

test('T14: 同一 Session 并行运行含 EJS 的共享闭包，各自使用当前的控制器并保留词法作用域', async t => {
    const f = createFixture();
    await f.init();
    t.after(() => f.session.destroySession());
    const entered = Promise.withResolvers();
    const resume = Promise.withResolvers();
    const defines = globalThis.EjsTemplate.defines;
    let calls = 0;
    defines.vcTestPause = async () => {
        if (++calls === 1) {
            entered.resolve(true);
            await resume.promise;
        }
        return '';
    };
    const scope = new SlashCommandScope();
    scope.letVariable('lexicalText', 'from-lexical-scope');
    const definitionController = new SlashCommandAbortController();
    const closure = new SlashCommandParser().parse(
        '/ejs block=true await vcTestPause() || /send return=pipe {{var::lexicalText}}',
        true,
        {},
        definitionController,
    );
    closure.scope.parent = scope;
    scope.letVariable('shared', closure);

    const firstController = new SlashCommandAbortController();
    const secondController = new SlashCommandAbortController();
    const first = executeSlashCommandsWithOptions('/run shared', { scope, abortController: firstController });
    try {
        assert.equal(await Promise.race([entered.promise, first]), true);
        const second = await executeSlashCommandsWithOptions('/:shared', { scope, abortController: secondController });
        assert.equal(second.isError, false);
        assert.equal(second.pipe, 'from-lexical-scope');
        assert.equal(f.savedChatCount, 1);
        secondController.abort('fixture completed execution', true);
    } finally {
        resume.resolve();
        delete defines.vcTestPause;
    }

    const result = await first;
    assert.equal(result.isError, false);
    assert.equal(result.isAborted, false);
    assert.equal(result.pipe, 'from-lexical-scope');
    assert.equal(f.savedChatCount, 2);
    assert.deepEqual(f.context.chat.slice(-2).map(message => message.mes), ['from-lexical-scope', 'from-lexical-scope']);
    assert.equal(closure.abortController, definitionController);
    assert.equal(closure.scope.parent, scope);
});

test('T14: 切换真实 Session 聊天后，旧 EJS 模板延后调用 execute 不得写入新会话', async t => {
    const f = createFixture();
    await f.init();
    t.after(() => f.session.destroySession());
    const ejs = globalThis.EjsTemplate;
    const entered = Promise.withResolvers();
    const resume = Promise.withResolvers();
    const locals = await ejs.prepareContext({
        async vcTestPause() {
            entered.resolve(true);
            await resume.promise;
        },
    });
    const previousMetadata = f.context.chatMetadata;
    const previousChat = f.context.chat;
    const previousMessages = structuredClone(previousChat);
    const pending = ejs.evalTemplate(
        '<% await vcTestPause() %><%- await execute("/setvar key=stale_ejs leaked || /send stale-ejs") %>',
        locals,
    );
    const nextId = 'chat-f2-next';
    let savesBeforeResume;
    try {
        assert.equal(await Promise.race([entered.promise, pending]), true);
        const activated = await f.session.activate({ avatar: 'helper-test.png', file: 'chat-file-next.jsonl' }, [{
            chat_metadata: {
                integrity: 'next-test-integrity',
                vc_f2: { id: nextId, revision: 1 },
                vc_binding: { ...previousMetadata.vc_binding, chatIdentity: nextId, conversationId: nextId },
                variables: {},
            },
        }]);
        assert.equal(activated, true);
        savesBeforeResume = f.savedChatCount;
    } finally {
        resume.resolve();
    }
    const outcome = await pending.then(() => 'fulfilled', () => 'rejected');
    assert.equal(f.context.chatMetadata.vc_f2.id, nextId);
    assert.deepEqual({
        variable: f.context.chatMetadata.variables.stale_ejs,
        messageCount: f.context.chat.length,
        saves: f.savedChatCount,
    }, {
        variable: undefined,
        messageCount: 0,
        saves: savesBeforeResume,
    });
    assert.equal(f.context.metadataDirty, false);
    assert.equal(previousMetadata.variables.stale_ejs, undefined);
    assert.deepEqual(previousChat, previousMessages);
    assert.equal(outcome, 'rejected');
});

test('Audit 4, 5, 6: 楼层变量宏 message_id 上下文、GENERATE_AFTER_DATA 单次替换与 formatAsTavernRegexedString role/depth 传递', async () => {
    const f = createFixture();
    await f.init();
    const th = globalThis.TavernHelper;

    // Audit 4: 两楼层不同变量经真实展示/正则管线按 message_id 读取对应楼层变量
    f.context.chat[0].variables[0].floor_only = 'FLOOR_ZERO';
    f.context.chat[1].variables[0].floor_only = 'FLOOR_ONE';
    const outFloor0 = th.formatAsTavernRegexedString(
        '{{get_message_variable::floor_only}}|{{format_message_variable::floor_only}}|{{format_message_variable_quoted::floor_only}}',
        'ai_output',
        'display',
        { depth: 1 },
    );
    const outFloor1 = th.formatAsTavernRegexedString(
        '{{get_message_variable::floor_only}}|{{format_message_variable::floor_only}}|{{format_message_variable_quoted::floor_only}}',
        'user_input',
        'display',
        { depth: 0 },
    );
    // 锁定 Helper macro_like 直接返回字符串，quoted 只配置其他值的 YAML 序列化。
    assert.equal(outFloor0, 'FLOOR_ZERO|FLOOR_ZERO|FLOOR_ZERO');
    assert.equal(outFloor1, 'FLOOR_ONE|FLOOR_ONE|FLOOR_ONE');

    // Audit 5: 同一生成连续触发 GENERATE_AFTER_DATA 与 CHAT_COMPLETION_SETTINGS_READY 时，非幂等宏只能替换 1 次且带每行 role
    let count = 0;
    const handle = th.registerMacroLike(/NON_IDEMPOTENT_TOKEN/g, ctx => `NON_IDEMPOTENT_TOKEN_${++count}_${ctx.role}`);
    try {
        const messages = [
            { role: 'system', content: 'sys: NON_IDEMPOTENT_TOKEN' },
            { role: 'user', content: 'usr: NON_IDEMPOTENT_TOKEN' },
            { role: 'assistant', content: 'ast: NON_IDEMPOTENT_TOKEN' },
        ];
        await f.context.eventSource.emit(event_types.GENERATE_AFTER_DATA, { prompt: messages }, false);
        await f.context.eventSource.emit(event_types.CHAT_COMPLETION_SETTINGS_READY, { messages });
        assert.deepEqual(messages.map(m => m.content), [
            'sys: NON_IDEMPOTENT_TOKEN_1_system',
            'usr: NON_IDEMPOTENT_TOKEN_2_user',
            'ast: NON_IDEMPOTENT_TOKEN_3_assistant',
        ]);
    } finally {
        handle.unregister();
    }

    // Audit 6: formatAsTavernRegexedString 调用中宏回调必须拿到真实 role/source/message_id（含 depth:0 的最后一条消息索引）
    const roleHandle = th.registerMacroLike(/CTX_ROLE_CHECK/g, ctx => `${ctx.source}:${ctx.role}:${ctx.message_id}`);
    try {
        const formatted = th.formatAsTavernRegexedString('CTX_ROLE_CHECK', 'ai_output', 'display', { depth: 0 });
        assert.equal(formatted, 'display:assistant:1');
    } finally {
        roleHandle.unregister();
    }
});

test('Audit 7, 9, 10: RawCharacter.getCardData 完整角色对象与缺省值、getChatHistoryBrief 倒序、预设分类精确列表', async () => {
    const f = createFixture();
    await f.init();
    const th = globalThis.TavernHelper;

    // Audit 7: getCardData() 返回完整 v1CharData（含顶层 avatar 与 data），缺省字段返回安全默认值
    const rawCurrent = th.RawCharacter.find({ name: 'current' });
    assert.equal(rawCurrent.getCardData().avatar, 'helper-test.png');
    assert.equal(rawCurrent.getCardData().data.name, '测试角色');
    assert.equal(th.getCharData('current').avatar, 'helper-test.png');

    f.context.characters.push({ name: '空字段角色', avatar: '', data: {} });
    const rawMinimal = th.RawCharacter.find({ name: '空字段角色' });
    assert.equal(rawMinimal.getAvatarId(), '');
    assert.deepEqual(rawMinimal.getRegexScripts(), []);
    assert.equal(rawMinimal.getCharacterBook(), null);
    assert.equal(rawMinimal.getWorldName(), '');
    f.context.characters.pop();

    // Audit 9: getChatHistoryBrief 按 file_name 倒序排序并保留原始字段
    const origRequest = f.client.request.bind(f.client);
    f.client.request = async (url, body) => {
        if (url === '/api/characters/chats') {
            return {
                a: { file_name: '2026-11-03@01h00m.jsonl', file_size: '1 KB', chat_items: 2, mes: '旧消息', last_mes: '2026-11-03T01:00:00Z', extra_tag: 'old' },
                b: { file_name: '2026-11-04@09h30m.jsonl', file_size: '2 KB', chat_items: 5, mes: '新消息', last_mes: '2026-11-04T09:30:00Z', extra_tag: 'new' },
            };
        }
        return origRequest(url, body);
    };
    try {
        const briefs = await th.getChatHistoryBrief('current');
        assert.deepEqual(briefs.map(b => b.file_name), [
            '2026-11-04@09h30m.jsonl',
            '2026-11-03@01h00m.jsonl',
        ]);
        assert.equal(briefs[0].extra_tag, 'new');
        assert.equal(briefs[0].avatar_url, 'helper-test.png');
        assert.equal(briefs[0].ch_name, '测试角色');
    } finally {
        f.client.request = origRequest;
    }

    // Audit 10: isPresetSystemPrompt / isPresetPlaceholderPrompt 仅识别锁定上游精确列表
    for (const id of ['main', 'nsfw', 'jailbreak', 'enhanceDefinitions']) {
        assert.equal(th.isPresetSystemPrompt({ id }), true, `${id} 应为 system prompt`);
        assert.equal(th.isPresetNormalPrompt({ id }), false);
    }
    for (const id of ['worldInfoBefore', 'personaDescription', 'charDescription', 'charPersonality', 'scenario', 'worldInfoAfter', 'dialogueExamples', 'chatHistory']) {
        assert.equal(th.isPresetPlaceholderPrompt({ id }), true, `${id} 应为 placeholder prompt`);
        assert.equal(th.isPresetNormalPrompt({ id }), false);
    }
    for (const snakeId of ['enhance_definitions', 'world_info_before', 'persona_description', 'char_description', 'char_personality', 'world_info_after', 'dialogue_examples', 'chat_history', 'authors_note']) {
        assert.equal(th.isPresetSystemPrompt({ id: snakeId }), false, `${snakeId} 不应被误判为 system prompt`);
        assert.equal(th.isPresetPlaceholderPrompt({ id: snakeId }), false, `${snakeId} 不应被误判为 placeholder prompt`);
        assert.equal(th.isPresetNormalPrompt({ id: snakeId }), true, `${snakeId} 应归为 normal prompt`);
    }
});

test('Audit 8: updateLorebookEntriesWith 单次读取基线与字段级 CAS（异字段并发保留远端修改并同步返回值/capture/WORLDINFO_UPDATED，同字段并发冲突报 409）', async () => {
    const f = createFixture();
    await f.init();
    const th = globalThis.TavernHelper;

    const updatedEvents = [];
    const onWorldInfoUpdated = (name, doc) => {
        updatedEvents.push({ name, doc: structuredClone(doc) });
    };
    f.context.eventSource.on(event_types.WORLDINFO_UPDATED, onWorldInfoUpdated);
    try {
        // 1. 异字段并发：updater 修改 comment 期间远端修改了 content，提交应成功且磁盘、返回值、captureWorldbook 与 WORLDINFO_UPDATED 均包含远端 content 与未知字段
        const returnedEntries = await th.updateLorebookEntriesWith('测试世界书', async entries => {
            // 模拟在初次读取之后、写回之前，另一处并发更新了同一条目的 content
            f.worldStore['测试世界书'].entries[0].content = '远端并发新内容';
            entries[0].comment = '本地更新备注';
            return entries;
        });
        assert.equal(f.worldStore['测试世界书'].entries[0].comment, '本地更新备注');
        assert.equal(f.worldStore['测试世界书'].entries[0].content, '远端并发新内容', '不得用 updater 内部的旧快照覆盖未修改的远端字段');
        assert.equal(f.worldStore['测试世界书'].entries[0].custom_raw_field, 'preserved_0');

        assert.equal(returnedEntries[0].comment, '本地更新备注');
        assert.equal(returnedEntries[0].content, '远端并发新内容', 'updateLorebookEntriesWith 返回值必须包含远端保留的并发字段');
        assert.equal(returnedEntries[0].custom_raw_field, 'preserved_0', 'updateLorebookEntriesWith 返回值必须保留未知字段');

        assert.equal(f.capturedDocs['测试世界书']?.entries?.[0]?.comment, '本地更新备注');
        assert.equal(f.capturedDocs['测试世界书']?.entries?.[0]?.content, '远端并发新内容', 'captureWorldbook 缓存必须接收合并后的权威文档');
        assert.equal(f.capturedDocs['测试世界书']?.entries?.[0]?.custom_raw_field, 'preserved_0');

        assert.equal(updatedEvents.length, 1);
        assert.equal(updatedEvents[0].name, '测试世界书');
        assert.equal(updatedEvents[0].doc?.entries?.[0]?.comment, '本地更新备注');
        assert.equal(updatedEvents[0].doc?.entries?.[0]?.content, '远端并发新内容', 'WORLDINFO_UPDATED 事件必须接收合并后的权威文档');
        assert.equal(updatedEvents[0].doc?.entries?.[0]?.custom_raw_field, 'preserved_0');
    } finally {
        f.context.eventSource.removeListener(event_types.WORLDINFO_UPDATED, onWorldInfoUpdated);
    }

    // 2. 同字段并发：updater 修改 comment 期间远端也修改了 comment，提交必须因 CAS 基线不匹配抛 409 且不覆盖远端值
    await assert.rejects(
        () =>
            th.updateLorebookEntriesWith('测试世界书', async entries => {
                f.worldStore['测试世界书'].entries[0].comment = '远端抢先修改备注';
                entries[0].comment = '本地冲突备注';
                return entries;
            }),
        err => err?.status === 409,
    );
    assert.equal(f.worldStore['测试世界书'].entries[0].comment, '远端抢先修改备注');
});

test('Audit 11, 12, 13: builtin.duringGenerating 真实生成态、builtin.renderMarkdown 复用配置化 converter、Slash /let 与 /var 局部作用域', async () => {
    const f = createFixture();
    await f.init();
    const th = globalThis.TavernHelper;

    // Audit 11: builtin.duringGenerating() 在空闲与非生成动作时为 false，真实生成与 Helper 生成中为 true，结束后恢复 false
    assert.equal(th.builtin.duringGenerating(), false);
    let duringMutation = null;
    const onMutSent = () => { duringMutation = th.builtin.duringGenerating(); };
    f.context.eventSource.on(event_types.MESSAGE_SENT, onMutSent);
    try {
        await th.createChatMessages([{ role: 'user', message: '非生成动作消息' }]);
        assert.equal(duringMutation, false, '消息修改期间 builtin.duringGenerating() 必须为 false');
    } finally {
        f.context.eventSource.removeListener(event_types.MESSAGE_SENT, onMutSent);
    }

    const gate = f.pauseNextGenerate();
    const sendPromise = f.session.send('测试生成态');
    await gate.entered;
    let duringGenWhileRunning;
    try {
        duringGenWhileRunning = th.builtin.duringGenerating();
    } finally {
        gate.release();
        await sendPromise;
    }
    assert.equal(duringGenWhileRunning, true, '真实生成进行中 builtin.duringGenerating() 必须为 true');
    assert.equal(th.builtin.duringGenerating(), false, '生成结束后 builtin.duringGenerating() 必须恢复 false');

    let duringHelperGen = false;
    const origGenerateHelper = f.engine.generateHelper;
    f.engine.generateHelper = async (...args) => {
        duringHelperGen = th.builtin.duringGenerating();
        return origGenerateHelper(...args);
    };
    try {
        await f.context.generateHelper('generate', { user_input: 'helper生成测试' });
        assert.equal(duringHelperGen, true, 'Helper 生成进行中 builtin.duringGenerating() 必须为 true');
        assert.equal(th.builtin.duringGenerating(), false, 'Helper 生成结束后 builtin.duringGenerating() 必须恢复 false');
    } finally {
        f.engine.generateHelper = origGenerateHelper;
    }

    // Audit 12: builtin.renderMarkdown 复用 cards/format.js 的配置化 converter（支持表格、删除线、单换行等）
    const mdHtml = th.builtin.renderMarkdown('| A | B |\n| --- | --- |\n| 1 | 2 |\n\n~~删除线~~\n\n第一行\n第二行');
    assert.ok(mdHtml.includes('<table>'), 'renderMarkdown 应支持表格');
    assert.ok(mdHtml.includes('<del>删除线</del>'), 'renderMarkdown 应支持删除线');
    const renderedMarkdown = happyWindow.document.createElement('div');
    renderedMarkdown.innerHTML = mdHtml;
    const lineBreak = renderedMarkdown.querySelector('br');
    assert.equal(lineBreak?.previousSibling?.textContent?.trimEnd().endsWith('第一行'), true, '单换行前保留原文字');
    assert.equal(lineBreak?.nextSibling?.textContent?.trimStart(), '第二行', '单换行须渲染为两行之间的 br 节点');

    // Audit 13: /let 与 /var 严格复用锁定 SlashCommandScope 语义（前导零数值归一、非 JSON 索引 catch 分支、同次共享/跨次隔离、不写 chat_metadata）
    const leadingZeroOut = await th.triggerSlash('/let x 001 | /var x');
    assert.equal(leadingZeroOut, '1', 'SlashCommandScope.getVariable 必须将 "001" 数值归一为 1');
    assert.equal(f.context.chatMetadata.variables.x, undefined, '/let 与 /var 不得写入持久化 chat_metadata.variables');

    const scopedOut = await th.triggerSlash('/let x 10 | /var x 25 | /var x');
    assert.equal(scopedOut, '25');
    assert.equal(f.context.chatMetadata.variables.x, undefined);

    const namedScopedOut = await th.triggerSlash('/let key=arr [10,20] | /var index=1 arr 99 | /var index=1 arr');
    assert.equal(namedScopedOut, '99');
    assert.equal(f.context.chatMetadata.variables.arr, undefined);

    const objScopedOut = await th.triggerSlash('/let key=obj {"a":1} | /var index=b as=number obj 2 | /var obj');
    assert.equal(objScopedOut, '{"a":1,"b":2}');

    const indexedScope = new SlashCommandScope();
    indexedScope.letVariable('s', 'hello');
    const sanitizedError = { name: 'Error', message: 'Slash command execution failed' };
    await assert.rejects(() => th.triggerSlash('/var index=0 s X', { scope: indexedScope }), sanitizedError);
    assert.equal(indexedScope.getVariable('s'), 'hello', '非法索引赋值不得覆盖原局部变量');

    // 跨次执行不泄漏上次局部作用域，读取未声明局部变量抛错，重复 /let 同名变量抛错
    await assert.rejects(() => th.triggerSlash('/var x'), sanitizedError);
    await assert.rejects(() => th.triggerSlash('/let dup 1 | /let dup 2'), sanitizedError);

    // 顶层 || 禁止下一命令隐式 pipe 注入，单 | 保持隐式注入。
    assert.equal(await th.triggerSlash('/echo piped | /echo'), 'piped');
    assert.equal(await th.triggerSlash('/echo piped || /echo'), '');
    assert.equal(await th.triggerSlash('/echo piped || /echo {{pipe}}'), 'piped');
    // 锁定 /echo 默认 rawQuotes；raw=false 与 STRICT_ESCAPING 保留引号内的 ||，未转义 {:...:} 解析为闭包。
    assert.equal(await th.triggerSlash('/echo "a || b" | /echo'), '');
    assert.equal(await th.triggerSlash('/echo raw=false "a || b" | /echo', {
        parserFlags: { STRICT_ESCAPING: true },
    }), 'a || b');
    assert.equal(await th.triggerSlash('/echo {:a || b:} | /echo'), '[Closure]');

    const lenBeforeDoublePipeDel = f.context.chat.length;
    assert.ok(lenBeforeDoublePipeDel >= 4);
    await th.triggerSlash('/echo 3 || /del');
    assert.equal(f.context.chat.length, lenBeforeDoublePipeDel - 1, '/echo 3 || /del 中无参 /del 不应隐式继承 pipe，只删 1 条');
    await th.triggerSlash('/echo 2 | /del');
    assert.equal(f.context.chat.length, lenBeforeDoublePipeDel - 3, '/echo 2 | /del 单竖线保持隐式 pipe 注入，应删 2 条');
});

test('Residual 1: cards.destroy() 公开销毁入口不抛 ReferenceError 且完整移除脚本容器、全局 API 与事件监听', async () => {
    const f = createFixture();
    const cards = await f.init();
    assert.ok(document.querySelector('[data-vc-card-scripts]'), '销毁前 [data-vc-card-scripts] 应存在');
    assert.ok(globalThis.TavernHelper, '销毁前 globalThis.TavernHelper 应存在');
    const handle = globalThis.TavernHelper.registerMacroLike(/DESTROY_CHECK_MACRO/g, () => 'REPLACED');

    try {
        assert.doesNotThrow(() => cards.destroy(), '公开 cards.destroy() 不得因悬空监听器抛错');
        assert.equal(document.querySelector('[data-vc-card-scripts]'), null, 'destroy() 后 [data-vc-card-scripts] 必须移除');
        assert.equal(globalThis.TavernHelper, undefined, 'destroy() 后 globalThis.TavernHelper 必须清理');
        assert.equal(globalThis.triggerSlash, undefined, 'destroy() 后顶层 helper 导出必须清理');

        const promptData = { prompt: [{ role: 'user', content: 'DESTROY_CHECK_MACRO' }] };
        await f.context.eventSource.emit(event_types.GENERATE_AFTER_DATA, promptData, false);
        assert.equal(promptData.prompt[0].content, 'DESTROY_CHECK_MACRO', 'destroy() 后 GENERATE_AFTER_DATA 监听必须已移除');
    } finally {
        handle.unregister();
    }
});
