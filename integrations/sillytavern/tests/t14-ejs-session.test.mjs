import test from 'node:test';
import assert from 'node:assert/strict';
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
const { bindEngineContext, getContext } = await import('../extension/vc-model-settings/desktop/standalone/engine/ports.js');
const { createChatEngine, runtimeSettings } = await import('../extension/vc-model-settings/desktop/standalone/engine/runtime.js');
const { openaiDefaults, powerUserDefaults } = await import('../extension/vc-model-settings/desktop/standalone/engine/defaults.js');
const { initializeCards } = await import('../extension/vc-model-settings/desktop/standalone/cards/index.js');
const {
    getCardHost,
    isHelperExtensionEnabled,
    isEjsExtensionEnabled,
    isCardExecutionAllowed,
    isEjsExecutionAllowed,
    isCardDisplayExecutionAllowed,
    getEnabledCardExtensions,
    enterTemplateScope,
} = await import('../extension/vc-model-settings/desktop/standalone/cards/ejs-host.js');
const { createDesktopSession } = await import('../extension/vc-model-settings/desktop/standalone/session.js');
const { prepareSourceIdentities } = await import('../server-plugin/virtual-companion/lib/source-identity.js');

function createRealSessionFixture({ packetOverrides = {}, settingsOverrides = {} } = {}) {
    const worldNames = ['测试世界书'];
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
                },
            },
        },
    };
    const presets = {
        Default: {
            ...structuredClone(openaiDefaults),
            temp_openai: 0.9,
            prompts: [
                { identifier: 'main', name: 'Main Prompt', role: 'system', content: 'System instruction', system_prompt: true, marker: false },
            ],
            prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }] }],
            extensions: {
                tavern_helper: {
                    scripts: [],
                    variables: { preset_var: 'p1' },
                },
            },
        },
    };
    const settings = {
        username: 'OwnerUser',
        user_avatar: 'user-default.png',
        character_Force_name2: true,
        main_api: 'openai',
        api_server: '',
        world_info: {
            globalSelect: ['测试世界书'],
            charLore: [{ name: 'helper-test', extraBooks: [] }],
        },
        world_info_depth: 4,
        world_info_budget: 25,
        world_info_budget_cap: 0,
        world_info_min_activations: 0,
        world_info_min_activations_depth_max: 0,
        world_info_max_recursion_steps: 2,
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
            chat_completion_source: 'openai',
            openai_model: 'gpt-4o-mini',
        },
        power_user: {
            ...structuredClone(powerUserDefaults),
            personas: { 'user-default.png': 'OwnerUser' },
            persona_descriptions: {
                'user-default.png': { description: '默认人设描述', position: 0, depth: 2, role: 0, lorebook: '' },
            },
        },
        extension_settings: {
            disabledExtensions: [],
            variables: { global: { g_init: 10 } },
            regex: [],
            tavern_helper: {
                enabled: true,
                render: { enabled: true, depth: 0, collapse_code_block: 'none' },
                script: {
                    enabled: { global: true, presets: ['Default'], characters: ['helper-test.png'] },
                    scripts: [
                        { id: 'global_script_1', name: '全局脚本', type: 'script', enabled: true, content: 'window.__vcGlobalScriptRan = true;', info: 'global info', button: { enabled: true, buttons: [{ name: '全局按钮', visible: true }] }, data: {} },
                    ],
                },
            },
            EjsTemplate: {
                enabled: true,
                render_enabled: true,
                generate_enabled: true,
                autosave_enabled: true,
                preload_worldinfo_enabled: true,
            },
        },
        ...settingsOverrides,
    };

    const initialRecords = [
        {
            user_name: 'OwnerUser',
            character_name: 'Alice',
            chat_metadata: {
                integrity: 'test-integrity',
                vc_f2: { id: 'chat-f2-1', revision: 1 },
                vc_binding: {
                    characterRef: 'helper-test-ref',
                    chatIdentity: 'chat-f2-1',
                    relationshipId: '1',
                    conversationId: 'chat-f2-1',
                    mode: 'COMPANION',
                },
                variables: { init_var: 'hello' },
                [Symbol.for('test')]: undefined,
            },
        },
        {
            name: 'Alice',
            is_user: false,
            is_system: false,
            mes: 'First greeting',
            swipe_id: 0,
            swipes: ['First greeting'],
            variables: [{ msg_var: 'v0' }],
            swipe_info: [{ send_date: '2026-01-01T00:00:00Z', extra: { token_count: 5 } }],
            extra: { token_count: 5 },
        },
        {
            name: 'OwnerUser',
            is_user: true,
            is_system: false,
            mes: 'Second user line',
            swipe_id: 0,
            swipes: ['Second user line'],
            variables: [{ user_var: 'u0' }],
            swipe_info: [{ send_date: '2026-01-01T00:01:00Z', extra: {} }],
            extra: {},
        },
    ];

    const f2Saves = [];
    const settingsSaves = [];
    let currentRevision = 1;
    let activeRecords = structuredClone(initialRecords);

    const container = happyWindow.document.createElement('div');
    container.id = 'chat';
    happyWindow.document.body.innerHTML = '';
    happyWindow.document.body.appendChild(container);

    const syncDom = messages => {
        container.innerHTML = '';
        messages.forEach((m, idx) => {
            const mesDiv = happyWindow.document.createElement('div');
            mesDiv.className = 'mes';
            mesDiv.setAttribute('mesid', String(idx));
            const textDiv = happyWindow.document.createElement('div');
            textDiv.className = 'mes_text';
            textDiv.innerHTML = m.extra?.display_text || m.mes || '';
            mesDiv.appendChild(textDiv);
            container.appendChild(mesDiv);
        });
    };

    const eventSource = new EventEmitter();
    const context = {
        chat: [],
        chatMetadata: initialRecords[0].chat_metadata,
        characters: [
            {
                name: 'Alice',
                avatar: 'helper-test.png',
                description: 'Alice character description',
                personality: 'Gentle',
                scenario: 'Test room',
                first_mes: 'First greeting',
                mes_example: '',
                creatorcomment: '',
                data: {
                    name: 'Alice',
                    description: 'Alice character description',
                    personality: 'Gentle',
                    scenario: 'Test room',
                    first_mes: 'First greeting',
                    mes_example: '',
                    creator_notes: 'Creator note',
                    system_prompt: '',
                    post_history_instructions: '',
                    alternate_greetings: ['Alt greeting 1'],
                    tags: ['companion'],
                    creator: 'Owner',
                    character_version: '1.0',
                    extensions: {
                        vc_character_ref: 'helper-test-ref',
                        world: '测试世界书',
                        regex_scripts: [],
                        tavern_helper: {
                            scripts: [
                                {
                                    id: 'char_script_1',
                                    name: '角色脚本1',
                                    type: 'script',
                                    enabled: true,
                                    content: 'window.__vcCharScriptRan = true;',
                                    info: '初始脚本说明',
                                    button: { enabled: true, buttons: [{ name: '按钮A', visible: true }] },
                                    data: { s_key: 's_val' },
                                },
                            ],
                            variables: { char_var: 'c_init' },
                        },
                    },
                },
            },
        ],
        characterId: 0,
        groups: [],
        groupId: null,
        name1: 'OwnerUser',
        name2: 'Alice',
        userAvatar: 'user-default.png',
        chatId: 'chat-file-1',
        mainApi: 'openai',
        onlineStatus: 'connected',
        maxContext: 8192,
        extensionPrompts: {},
        eventSource,
        eventTypes: event_types,
        settings,
        oaiSettings: settings.oai_settings,
        powerUserSettings: settings.power_user,
        extensionSettings: settings.extension_settings,
         getCurrentChatId() { return this.chatId; },
        saveSettingsDebounced() { settingsSaves.push(structuredClone(settings.extension_settings)); },
        saveMetadataDebounced() { this.metadataDirty = true; },
        saveChatConditional() { this.metadataDirty = true; },
    };

    const client = {
        headers: () => ({}),
        documents: {
            captureWorldbook() {},
        },
        saveSettings: async payload => {
            const value = typeof payload === 'function' ? payload() : payload;
            settingsSaves.push(structuredClone(value));
            return new Response('{}', { status: 200 });
        },
        settingsChanged: () => false,
        async request(url, body) {
            if (url === '/api/characters/get') {
                return structuredClone(context.characters[0]);
            }
            if (url === '/api/avatars/get') {
                return ['user-default.png'];
            }
            if (url === '/api/worldinfo/get') {
                return structuredClone(worldStore[body?.name] || { entries: {} });
            }
            if (url === '/api/worldinfo/edit') {
                worldStore[body.name] = structuredClone(body.data);
                return { ok: true };
            }
            if (url === '/api/settings/save') {
                settingsSaves.push(structuredClone(body));
                return { ok: true };
            }
            if (url === '/api/characters/merge-attributes') {
                return { ok: true };
            }
            return {};
        },
        async post(url, body) {
            return new Response(JSON.stringify(await this.request(url, body)), { status: 200 });
        },
        async raw(url, serialized) {
            if (url === '/api/chats/save') {
                const parsed = JSON.parse(serialized);
                f2Saves.push(parsed);
                const prevToken = parsed.chat?.[0]?.chat_metadata?.vc_f2 || { id: 'chat-f2-1', revision: 1 };
                const nextToken = {
                    ...prevToken,
                    revision: (prevToken.revision || 0) + 1,
                };
                if (parsed.chat?.[0]?.chat_metadata) {
                    parsed.chat[0].chat_metadata.vc_f2 = structuredClone(nextToken);
                }
                activeRecords = structuredClone(parsed.chat);
                return new Response(JSON.stringify({ result: 'ok', vc_f2: nextToken }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                });
            }
            return new Response('{}', { status: 200 });
        },
        async readChat() {
            return structuredClone(activeRecords);
        },
    };

    const engine = {
        context,
        settings,
        presets,
        bindContext() {
            bindEngineContext(context, settings, { models: [], extensions: [] });
            syncDom(context.chat);
        },
        settingsForSave() {
            return settings;
        },
        firstMessage() {
            return null;
        },
        userMessage: async text => ({
            message: {
                name: context.name1,
                mes: text,
                is_user: true,
                is_system: false,
                send_date: '2026-11-04T00:05:00Z',
                swipe_id: 0,
                swipes: [text],
                variables: [{}],
                extra: {},
            },
            bias: {},
        }),
        async prepare() {
            return { body: { model: 'synthetic', chat_completion_source: 'custom' } };
        },
        cleanResponse: text => text,
        editMessage: (_msg, text) => text,
        substituteMacros: text => String(text ?? ''),
        memory: { finalStatus() {} },
        generateHelper: async () => '合成脚本回复',
        cards: undefined,
    };
    engine.bindContext();

    let session;
    const packet = { world_names: worldNames, ...packetOverrides };
    return {
        context,
        settings,
        presets,
        packet,
        client,
        engine,
        container,
        f2Saves,
        settingsSaves,
        get session() { return session; },
        get savedChatCount() { return f2Saves.length; },
        get savedSettingsCount() { return settingsSaves.length; },
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
                onChange: () => {},
                readResponse: async (_response, { onUpdate }) => {
                    const result = { text: '合成回复', state: { reasoning: '' }, swipes: [], toolCalls: [], finishReason: 'stop' };
                    await onUpdate(result);
                    return result;
                },
            });
            const cards = await initializeCards({
                context,
                settings,
                packet,
                presets,
                models: [],
                client,
            });
            engine.cards = cards;
            await session.activate({ avatar: 'helper-test.png', file: 'chat-file-1.jsonl' }, structuredClone(initialRecords));
            f2Saves.length = 0;
            settingsSaves.length = 0;
            return cards;
        },
    };
}

test('T14-EJS-1: 独立合法 evalTemplate 内 execute 经 Session F2 持久化，同时保留无父 job 渲染期内防死锁守卫与结构刷新单次提交', async t => {
    const f = createRealSessionFixture();
    const cards = await f.init();
    t.after(() => f.session.destroySession());

    // 1. 独立非渲染 evalTemplate 正常提交并返回结果
    const savesBefore = f.savedChatCount;
    const out = await globalThis.EjsTemplate.evalTemplate('<%= await execute("/setvar key=standalone_ejs 77 | /getvar standalone_ejs") %>');
    assert.equal(out, '77');
    assert.equal(f.context.chatMetadata.variables.standalone_ejs, '77');
    assert.equal(f.savedChatCount, savesBefore + 1);
    assert.equal(f.f2Saves.at(-1).chat[0].chat_metadata.variables.standalone_ejs, '77');

    // 2. 渲染期内（isRendering=true 且无父 job）模板作用域调用 commitHelperChanges 仍立即拒绝，不死锁等待自身 settle
    const origIsRendering = cards.isRendering;
    let fakeRendering = true;
    let settleCalled = false;
    const origSettle = cards.settle;
    cards.isRendering = () => fakeRendering;
    cards.settle = async () => {
        settleCalled = true;
        return new Promise(() => {});
    };
    const renderLease = f.context.captureHelperScope();
    try {
        await assert.rejects(
            () => f.context.commitHelperChanges(f.context.chatMetadata),
            /VC_CHAT_MUTATION_REJECTED/,
            '渲染期内活动模板作用域调用 commitHelperChanges 必须立即拒绝以防自身 settle 死锁',
        );
        assert.equal(settleCalled, false, '不得进入 cards.settle 造成死锁');
    } finally {
        renderLease.release();
        fakeRendering = false;
        cards.isRendering = origIsRendering;
        cards.settle = origSettle;
    }

    // 3. 结构刷新 -> USER_MESSAGE_RENDERED 内执行 evalTemplate(execute) -> 父 mutation job 最终单次 F2 保存
    const savesBeforeSend = f.savedChatCount;
    const settingsBeforeSend = f.savedSettingsCount;
    const onRendered = async index => {
        const res = await globalThis.EjsTemplate.evalTemplate(
            '<%= await execute("/setvar key=from_rendered ok_val || /setglobalvar key=from_rendered_g g_val || /echo suffix_ok") %>',
        );
        f.context.chat[index].mes += ` [${res}]`;
    };
    f.context.eventSource.on(event_types.USER_MESSAGE_RENDERED, onRendered);
    try {
        const sendPipe = await globalThis.TavernHelper.triggerSlash('/send hello_world');
        assert.equal(sendPipe, '');
        assert.equal(f.context.chat.at(-1).mes, 'hello_world [suffix_ok]');
        assert.equal(f.context.chatMetadata.variables.from_rendered, 'ok_val');
        assert.equal(f.settings.extension_settings.variables.global.from_rendered_g, 'g_val');
        assert.equal(f.savedChatCount, savesBeforeSend + 1, '结构变更合并模板写入只进行一次 F2 保存');
        assert.equal(f.savedSettingsCount, settingsBeforeSend + 1, '结构变更合并全局设置只进行一次设置保存');
    } finally {
        f.context.eventSource.removeListener(event_types.USER_MESSAGE_RENDERED, onRendered);
    }
});

test('T14-EJS-2: 切换会话、原作用域结束后的 setTimeout/queueMicrotask 与并行模板隔离均正确生效，同步语义保留且原共享 data 不被污染', async t => {
    const f = createRealSessionFixture();
    await f.init();
    t.after(() => f.session.destroySession());

    const ejs = globalThis.EjsTemplate;

    // 1. 合法作用域内同步 Helper 方法保持同步返回语义（不返回 Promise）
    const syncOut = await ejs.evalTemplate('<% const r = insertOrAssignVariables({ sync_check: "ok_sync" }); const v = getVariables(); %><%= (r && typeof r.then === "function") ? "promise" : v.sync_check %>');
    assert.equal(syncOut, 'ok_sync');
    assert.equal(f.context.chatMetadata.variables.sync_check, 'ok_sync');

    // 2. 原作用域结束后的 setTimeout 与 queueMicrotask 实际回调（引用同一 scoped execute / TavernHelper / 顶层写方法 / EJS setLocalVar）一律失败且脱敏，且原 locals 从未被污染
    const timerDone = Promise.withResolvers();
    const microtaskDone = Promise.withResolvers();
    const customMarker = () => 'custom-kept';
    let runAfterTemplateMicrotask = null;
    const localsForTimer = await ejs.prepareContext({
        customMarker,
        registerPostTemplateRunner(fn) {
            runAfterTemplateMicrotask = fn;
        },
        captureTimerOutcomes(execP, thErr, topErr, setvarErr) {
            void Promise.resolve(execP).then(
                val => timerDone.resolve({ execOutcome: 'fulfilled', execVal: val, thErr, topErr, setvarErr }),
                err => timerDone.resolve({ execOutcome: 'rejected', execErr: err, thErr, topErr, setvarErr }),
            );
        },
        captureMicrotaskOutcomes(execP, topErr) {
            void Promise.resolve(execP).then(
                val => microtaskDone.resolve({ execOutcome: 'fulfilled', execVal: val, topErr }),
                err => microtaskDone.resolve({ execOutcome: 'rejected', execErr: err, topErr }),
            );
        },
    });
    const prevExecuteDesc = Object.getOwnPropertyDescriptor(localsForTimer, 'execute');
    const prevHelperDesc = Object.getOwnPropertyDescriptor(localsForTimer, 'TavernHelper');

    await ejs.evalTemplate(
        `<%
            registerPostTemplateRunner(() => {
                queueMicrotask(() => {
                    const mp = execute('/setvar key=secret_microtask_var leaked_micro');
                    let me = null;
                    try { insertOrAssignVariables({ secret_microtask_var: 'leaked' }); } catch (err) { me = err; }
                    captureMicrotaskOutcomes(mp, me);
                });
            });
            setTimeout(() => {
                const p = execute('/setvar key=secret_timer_var leaked_timer');
                let e1 = null, e2 = null, e3 = null;
                try { TavernHelper.insertOrAssignVariables({ secret_timer_var: 'leaked' }); } catch (err) { e1 = err; }
                try { insertOrAssignVariables({ secret_timer_var: 'leaked' }); } catch (err) { e2 = err; }
                try { setLocalVar('secret_timer_var', 'leaked'); } catch (err) { e3 = err; }
                captureTimerOutcomes(p, e1, e2, e3);
            }, 15);
        %>`,
        localsForTimer,
    );
    runAfterTemplateMicrotask();

    // 原对象从未被修改
    assert.deepEqual(Object.getOwnPropertyDescriptor(localsForTimer, 'execute'), prevExecuteDesc);
    assert.equal(Object.getOwnPropertyDescriptor(localsForTimer, 'TavernHelper'), prevHelperDesc);
    assert.equal(localsForTimer.customMarker, customMarker);

    const microRes = await microtaskDone.promise;
    assert.equal(microRes.execOutcome, 'rejected', '原模板作用域结束后 queueMicrotask 调用 execute 必须拒绝');
    assert.equal(microRes.execErr?.message, 'VC_SLASH_EXECUTION_ERROR');
    assert.equal(microRes.execErr?.message.includes('secret_microtask_var'), false);
    assert.equal(microRes.topErr?.message, '角色卡执行上下文已失效。');
    assert.equal(f.context.chatMetadata.variables.secret_microtask_var, undefined);

    const timerRes = await timerDone.promise;
    assert.equal(timerRes.execOutcome, 'rejected', '原模板作用域结束后 setTimeout 调用 execute 必须拒绝');
    assert.ok(timerRes.execErr instanceof Error);
    assert.equal(timerRes.execErr.message, 'VC_SLASH_EXECUTION_ERROR');
    assert.equal(timerRes.execErr.message.includes('secret_timer_var'), false);
    for (const syncErr of [timerRes.thErr, timerRes.topErr, timerRes.setvarErr]) {
        assert.ok(syncErr instanceof Error, '原模板作用域结束后计时器调用同步写方法必须同步抛错');
        assert.equal(syncErr.message, '角色卡执行上下文已失效。');
        assert.equal(syncErr.message.includes('secret_timer_var'), false);
    }
    assert.equal(f.context.chatMetadata.variables.secret_timer_var, undefined);

    // 3. 两个合法并行 template 共享同一 locals 时各自作用域互不覆盖（第二个结束后不影响第一个继续执行，且第二个迟到回调仍被拒绝）
    const parallel1Entered = Promise.withResolvers();
    const parallel1Resume = Promise.withResolvers();
    const parallel2LateDone = Promise.withResolvers();
    const sharedParallelLocals = await ejs.prepareContext({
        async waitParallel1() {
            parallel1Entered.resolve(true);
            await parallel1Resume.promise;
        },
        reportParallel2Late(err) {
            parallel2LateDone.resolve(err);
        },
    });
    const parallel1Promise = ejs.evalTemplate(
        '<% await waitParallel1(); insertOrAssignVariables({ parallel_sync: "p1_sync" }); %><%= await execute("/setvar key=parallel_exec p1_ok | /getvar parallel_exec") %>',
        sharedParallelLocals,
    );
    await parallel1Entered.promise;

    const parallel2Out = await ejs.evalTemplate(
        `<%
            setTimeout(() => {
                try {
                    insertOrAssignVariables({ parallel_late: 'should_not_write' });
                    reportParallel2Late(null);
                } catch (err) {
                    reportParallel2Late(err);
                }
            }, 10);
        %><%= await execute("/setvar key=parallel_2 p2_ok | /getvar parallel_2") %>`,
        sharedParallelLocals,
    );
    assert.equal(parallel2Out, 'p2_ok');
    assert.equal(f.context.chatMetadata.variables.parallel_2, 'p2_ok');

    const p2LateErr = await parallel2LateDone.promise;
    assert.ok(p2LateErr instanceof Error);
    assert.equal(p2LateErr.message, '角色卡执行上下文已失效。');
    assert.equal(f.context.chatMetadata.variables.parallel_late, undefined);

    parallel1Resume.resolve();
    assert.equal(await parallel1Promise, 'p1_ok');
    assert.equal(f.context.chatMetadata.variables.parallel_sync, 'p1_sync');
    assert.equal(f.context.chatMetadata.variables.parallel_exec, 'p1_ok');

    // 4. 切换真实 Session A -> B 后，旧模板恢复执行时所有写入入口均失败且不破坏新会话或新模板
    const entered = Promise.withResolvers();
    const resume = Promise.withResolvers();
    let syncSwitchError = null;
    const sharedLocals = await ejs.prepareContext({
        async vcPauseSwitch() {
            entered.resolve(true);
            await resume.promise;
        },
        recordSyncSwitchError(err) {
            syncSwitchError = err;
        },
    });
    const chatAMetadata = f.context.chatMetadata;
    const stalePending = ejs.evalTemplate(
        `<%
            await vcPauseSwitch();
            try {
                insertOrAssignVariables({ secret_stale_var: 'leaked_sync' });
            } catch (err) {
                recordSyncSwitchError(err);
            }
        %><%- await execute("/setvar key=secret_stale_var leaked_exec || /send secret_stale_msg") %>`,
        sharedLocals,
    );

    assert.equal(await entered.promise, true);
    const activated = await f.session.activate({ avatar: 'helper-test.png', file: 'chat-file-b.jsonl' }, [{
        chat_metadata: {
            integrity: 'test-integrity-b',
            vc_f2: { id: 'chat-f2-b', revision: 1 },
            vc_binding: { ...chatAMetadata.vc_binding, chatIdentity: 'chat-f2-b', conversationId: 'chat-f2-b' },
            variables: {},
        },
    }]);
    assert.equal(activated, true);
    const savesBeforeResume = f.savedChatCount;
    resume.resolve();

    await assert.rejects(
        stalePending,
        err => err instanceof Error
            && err.message === 'VC_SLASH_EXECUTION_ERROR'
            && !err.message.includes('secret_stale_var')
            && !err.message.includes('secret_stale_msg'),
        '旧模板在会话切换后调用 execute 必须抛固定脱敏错误且不含脚本或变量名',
    );
    assert.ok(syncSwitchError instanceof Error);
    assert.equal(syncSwitchError.message, '角色卡执行上下文已失效。');
    assert.equal(f.context.chatMetadata.variables.secret_stale_var, undefined);
    assert.equal(chatAMetadata.variables.secret_stale_var, undefined);
    assert.equal(f.savedChatCount, savesBeforeResume);

    // 旧模板解除后，新会话正常执行 EJS 不受破坏
    const freshOut = await ejs.evalTemplate('<%= await execute("/setvar key=b_ok 99 | /getvar b_ok") %>', sharedLocals);
    assert.equal(freshOut, '99');
    assert.equal(f.context.chatMetadata.variables.b_ok, '99');
});

test('T14-EJS-3: host.packet.enable_extensions===false 总体禁扩展时阻止已授权角色脚本与 EJS，且保留 global=false 脚本组区别', async t => {
    // 1. 服务器 packet.enable_extensions === false：即使角色已显式授权，也不得运行脚本或 EJS，getEnabledCardExtensions 为空
    const disabledHostFixture = createRealSessionFixture({
        packetOverrides: { enable_extensions: false },
    });
    const disabledCards = await disabledHostFixture.init();

    assert.equal(isHelperExtensionEnabled(), false);
    assert.equal(isEjsExtensionEnabled(), false);
    assert.equal(isCardExecutionAllowed(), false);
    assert.equal(isEjsExecutionAllowed(), false);
    assert.equal(isCardDisplayExecutionAllowed(), false);
    assert.deepEqual(getEnabledCardExtensions(), []);
    assert.deepEqual(disabledCards.getEnabledExtensions(), []);
    assert.deepEqual( globalThis.TavernHelper.getActiveScriptIds(), []);

    const mesNode = happyWindow.document.createElement('div');
    mesNode.className = 'mes';
    mesNode.setAttribute('mesid', '0');
    disabledHostFixture.container.replaceChildren(mesNode);
    disabledHostFixture.context.chat[0].mes = '<%- "EJS_RAN" %>\n```html\n<html><body><div>CARD_HTML</div></body></html>\n```';
    disabledHostFixture.context.chat[0].is_ejs_processed = [];
    const cleanupRender = disabledCards.renderMessage(mesNode, 0, disabledHostFixture.context.chat[0], false);
    await disabledCards.settle();
    assert.equal(mesNode.querySelector('iframe'), null, 'packet.enable_extensions===false 时不得挂载卡片 HTML iframe');
    assert.equal(mesNode.textContent.includes('EJS_RAN'), false, 'packet.enable_extensions===false 时不得执行 EJS 模板');
    cleanupRender();
    disabledHostFixture.session.destroySession();

    // 2. packet.enable_extensions === true 且 script.enabled.global === false：扩展总体仍启用，全局脚本不跑但已授权角色脚本与 EJS 正常工作
    const charOnlyFixture = createRealSessionFixture({
        packetOverrides: { enable_extensions: true },
    });
    charOnlyFixture.settings.extension_settings.tavern_helper.script.enabled.global = false;
    const charOnlyCards = await charOnlyFixture.init();
    t.after(() => charOnlyFixture.session.destroySession());

    assert.equal(isHelperExtensionEnabled(), true);
    assert.equal(isEjsExtensionEnabled(), true);
    assert.equal(isCardExecutionAllowed(), true);
    assert.equal(isEjsExecutionAllowed(), true);
    assert.deepEqual(charOnlyCards.getEnabledExtensions(), [
        'third-party/JS-Slash-Runner',
        'third-party/ST-Prompt-Template',
    ]);
    await charOnlyCards.open();
    assert.deepEqual(
        globalThis.TavernHelper.getActiveScriptIds(),
        ['char_script_1'],
        'global=false 时仅停用全局脚本组，已显式授权的角色脚本仍正常加载',
    );
});

test('T14-EJS-4: createChatEngine -> initializeCards -> locked EJS 跨实例 EventEmitter 快照回调与 handler 内部异步端口不会越主污染新实例 B', async () => {
    const makeEngineEnv = (suffix, { worldGetHandler } = {}) => {
        const avatar = `char-${suffix}.png`;
        const card = {
            name: `Char${suffix}`,
            avatar,
            description: `Description ${suffix}`,
            personality: 'Calm',
            scenario: 'Room',
            first_mes: 'Hello',
            mes_example: '',
            data: {
                name: `Char${suffix}`,
                description: `Description ${suffix}`,
                personality: 'Calm',
                scenario: 'Room',
                first_mes: 'Hello',
                mes_example: '',
                extensions: {
                    vc_character_ref: `ref-${suffix}`,
                    world: `world-${suffix}`,
                    tavern_helper: { scripts: [], variables: {} },
                },
            },
        };
        const settings = runtimeSettings({
            username: `User${suffix}`,
            user_avatar: 'user-default.png',
            world_info: { globalSelect: [`world-${suffix}`] },
            oai_settings: {
                ...structuredClone(openaiDefaults),
                preset_settings_openai: 'Default',
            },
            power_user: {
                ...structuredClone(powerUserDefaults),
                experimental_macro_engine: false,
            },
            extension_settings: {
                disabledExtensions: [],
                variables: { global: {} },
                regex: [],
                tavern_helper: {
                    enabled: true,
                    render: { enabled: true, depth: 0, collapse_code_block: 'none' },
                    script: {
                        enabled: { global: true, presets: ['Default'], characters: [avatar] },
                        scripts: [],
                    },
                },
                EjsTemplate: {
                    enabled: true,
                    generate_enabled: true,
                    render_enabled: true,
                    raw_message_evaluation_enabled: true,
                    autosave_enabled: true,
                    preload_worldinfo_enabled: true,
                    compile_workers: false,
                    sandbox: false,
                },
            },
        });
        const context = {
            characters: [card],
            characterId: 0,
            groups: [],
            groupId: null,
            chatId: `chat-${suffix}`,
            name1: `User${suffix}`,
            name2: `Char${suffix}`,
            userAvatar: 'user-default.png',
            chat: [
                {
                    name: `Char${suffix}`,
                    is_user: false,
                    is_system: false,
                    mes: `Greeting ${suffix}`,
                    swipe_id: 0,
                    swipes: [`Greeting ${suffix}`],
                    variables: [{ swipe_v: 's0' }, { swipe_v: 's1' }],
                    variables_initialized: [true, true],
                    is_ejs_processed: [true, true],
                    extra: {},
                },
            ],
            chatMetadata: {
                variables: {},
            },
            extensionPrompts: {},
            eventSource: new EventEmitter(),
            eventTypes: event_types,
            getCurrentChatId() { return this.chatId; },
            saveChatConditional() { this.metadataDirty = true; },
        };
        const client = {
            headers: () => ({}),
            saveSettings: async () => new Response('{}', { status: 200 }),
            request: async (url, body) => {
                if (url === '/api/worldinfo/get' && typeof worldGetHandler === 'function') {
                    return await worldGetHandler(body);
                }
                return { entries: {} };
            },
            post: async () => new Response('{}', { status: 200 }),
            generate: async () => new Response('{}', { status: 200 }),
        };
        return { context, settings, client };
    };

    const abortA = new AbortController();
    const worldInfoEnteredA = Promise.withResolvers();
    const worldInfoGateA = Promise.withResolvers();
    let pauseWorldInfoA = false;
    const envA = makeEngineEnv('A', {
        worldGetHandler: async () => {
            if (pauseWorldInfoA) {
                worldInfoEnteredA.resolve(true);
                await worldInfoGateA.promise;
            }
            return {
                entries: {
                    0: {
                        uid: 0,
                        key: [],
                        keysecondary: [],
                        comment: '[GENERATE:BEFORE]',
                        content: '<% setLocalVar("staleInFlight", "from_a_inflight") %>',
                        constant: true,
                        selective: false,
                        order: 100,
                        position: 0,
                        disable: false,
                    },
                },
            };
        },
    });
    const engineA = await createChatEngine({
        client: envA.client,
        context: envA.context,
        signal: abortA.signal,
        settings: envA.settings,
        decision: { eligible: false, modelId: 'model-a' },
        presets: { Default: structuredClone(envA.settings.oai_settings) },
        models: [],
        packet: { world_names: ['world-A'] },
        initializeCards: args => initializeCards({ ...args, packet: { world_names: ['world-A'] } }),
    });

    // 1. 在 A 的 EventEmitter 上挂 makeFirst 异步门控，暂停 js_generation_before_end 与 MESSAGE_SWIPE_DELETED
    const enteredBeforeEndA = Promise.withResolvers();
    const gateBeforeEndA = Promise.withResolvers();
    const enteredSwipeDeletedA = Promise.withResolvers();
    const gateSwipeDeletedA = Promise.withResolvers();

    envA.context.eventSource.makeFirst('js_generation_before_end', async () => {
        enteredBeforeEndA.resolve(true);
        await gateBeforeEndA.promise;
    });
    envA.context.eventSource.makeFirst(event_types.MESSAGE_SWIPE_DELETED, async () => {
        enteredSwipeDeletedA.resolve(true);
        await gateSwipeDeletedA.promise;
    });

    const staleEventA = {
        message: '<% setLocalVar("probeStale", "from_a") %>rendered_from_a',
    };
    const pendingBeforeEndA = envA.context.eventSource.emit('js_generation_before_end', staleEventA, 'gen-a');
    const pendingSwipeDeletedA = envA.context.eventSource.emit(event_types.MESSAGE_SWIPE_DELETED, 0, 1);

    // 同时让 A 的 CHAT_COMPLETION_SETTINGS_READY 已进入 Gg 内部 await se() (loadWorldInfo) 异步边界
    pauseWorldInfoA = true;
    const staleGenerateDataA = {
        messages: [{ role: 'user', content: '<% setLocalVar("probeStaleGenerate", "from_a_gen") %>msg_a' }],
        type: 'normal',
    };
    const pendingSettingsReadyA = envA.context.eventSource.emit(event_types.CHAT_COMPLETION_SETTINGS_READY, staleGenerateDataA);

    await Promise.all([
        enteredBeforeEndA.promise,
        enteredSwipeDeletedA.promise,
        worldInfoEnteredA.promise,
    ]);

    // 2. 终止并销毁 A，真正创建受信实例 B
    abortA.abort();
    engineA.destroy();

    const abortB = new AbortController();
    const envB = makeEngineEnv('B');
    const engineB = await createChatEngine({
        client: envB.client,
        context: envB.context,
        signal: abortB.signal,
        settings: envB.settings,
        decision: { eligible: false, modelId: 'model-b' },
        presets: { Default: structuredClone(envB.settings.oai_settings) },
        models: [],
        packet: { world_names: ['world-B'] },
        initializeCards: args => initializeCards({ ...args, packet: { world_names: ['world-B'] } }),
    });

    try {
        // 3. B 正向对照：js_generation_before_end 正常执行 setLocalVar 并改写消息
        const positiveEventB = {
            message: '<% setLocalVar("b_positive", "ok_from_b") %>clean_b_text',
        };
        await envB.context.eventSource.emit('js_generation_before_end', positiveEventB, 'gen-b');
        assert.equal(positiveEventB.message, 'clean_b_text');
        assert.equal(envB.context.chatMetadata.variables.b_positive, 'ok_from_b');
        assert.equal(envB.context.chat[0].variables.length, 2);

        // 4. 释放 A 的门控（包括 emit 快照队列门控与 handler 内部 await 门控）
        gateBeforeEndA.resolve();
        gateSwipeDeletedA.resolve();
        worldInfoGateA.resolve();
        await Promise.all([pendingBeforeEndA, pendingSwipeDeletedA, pendingSettingsReadyA]);

        // 验证 A 的旧消息未被求值改写，B 未被写入 probeStale，B 的 swipe 变量条数仍为 2，且 B 仍为当前 owner
        assert.equal(
            staleEventA.message,
            '<% setLocalVar("probeStale", "from_a") %>rendered_from_a',
            '已销毁实例 A 的排队 before_end 回调不得求值或改写旧消息',
        );
        assert.equal(envB.context.chatMetadata.variables.probeStale, undefined, 'A 的排队 before_end 不得写入 B.chatMetadata.variables');
        assert.equal(envB.context.chatMetadata.variables.staleInFlight, undefined, 'A 的 handler 内部 await 后不得越主写入 B');
        assert.equal(envB.context.chatMetadata.variables.probeStaleGenerate, undefined, 'A 的 Gg 在 await se() 后不得越主求值写入 B');
        assert.equal(envB.context.chat[0].variables.length, 2, 'A 的排队 MESSAGE_SWIPE_DELETED 不得删减 B 的 swipe 变量数组');
        assert.deepEqual(envB.context.chat[0].variables, [{ swipe_v: 's0' }, { swipe_v: 's1' }]);
        assert.equal(getCardHost()?.context, envB.context, 'B 必须仍为当前 CardHost owner');
        assert.equal(getContext().eventSource, envB.context.eventSource, 'B 必须仍为当前 engine ports owner');

        // 5. B 自身的 MESSAGE_SWIPE_DELETED 仍正常生效
        await envB.context.eventSource.emit(event_types.MESSAGE_SWIPE_DELETED, 0, 1);
        assert.equal(envB.context.chat[0].variables.length, 1);
        assert.deepEqual(envB.context.chat[0].variables, [{ swipe_v: 's0' }]);
    } finally {
        abortB.abort();
        engineB.destroy();
    }
});
