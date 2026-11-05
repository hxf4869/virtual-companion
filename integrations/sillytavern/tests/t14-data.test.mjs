import test from 'node:test';
import assert from 'node:assert/strict';
import module from 'node:module';
import { Window } from 'happy-dom';

const happyWindow = new Window({ url: 'http://localhost:8000' });
Object.assign(globalThis, {
    window: happyWindow,
    document: happyWindow.document,
    Element: happyWindow.Element,
    HTMLElement: happyWindow.HTMLElement,
    HTMLIFrameElement: happyWindow.HTMLIFrameElement,
    Node: happyWindow.Node,
    Event: happyWindow.Event,
    CustomEvent: happyWindow.CustomEvent,
    MutationObserver: happyWindow.MutationObserver,
    localStorage: happyWindow.localStorage,
    sessionStorage: happyWindow.sessionStorage,
    getComputedStyle: happyWindow.getComputedStyle.bind(happyWindow),
});
Object.defineProperty(globalThis, 'navigator', {
    value: happyWindow.navigator,
    configurable: true,
    writable: true,
});
Object.defineProperty(happyWindow, 'parent', { value: globalThis, configurable: true });
Object.defineProperty(happyWindow, 'top', { value: globalThis, configurable: true });

const lockedLibUrl = new URL('../extension/vc-model-settings/desktop/locked-source/st/lib.js', import.meta.url).href;
const sourceIdentityUrl = new URL('../server-plugin/virtual-companion/lib/source-identity.js', import.meta.url).href;

module.registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === '/lib.js') {
            return { url: lockedLibUrl, shortCircuit: true };
        }
        if (specifier === '/scripts/vc-runtime/source-identity.js') {
            return { url: sourceIdentityUrl, shortCircuit: true };
        }
        return nextResolve(specifier, context);
    },
});

const lib = await import('../extension/vc-model-settings/desktop/locked-source/st/lib.js');
Object.assign(globalThis, {
    _: lib.lodash,
    lodash: lib.lodash,
    DOMPurify: lib.DOMPurify,
    showdown: lib.showdown,
    hljs: lib.hljs,
    Handlebars: lib.Handlebars,
    moment: lib.moment,
});

const { EventEmitter } = await import('../extension/vc-model-settings/desktop/standalone/engine/events.js');
const { event_types } = await import('../extension/vc-model-settings/desktop/standalone/engine/st/events.js');
const { persona_description_positions } = await import('../extension/vc-model-settings/desktop/standalone/engine/st/constants.js');
const { bindEngineContext, getContext, findExtension, readFirstDisplayedMessageId } = await import('../extension/vc-model-settings/desktop/standalone/engine/ports.js');
const { getExtensionPrompt, setExtensionPrompt, extension_prompt_types, substituteParams } = await import('../extension/vc-model-settings/desktop/standalone/engine/st/script.js');
const { createHelperPromptRuntime } = await import('../extension/vc-model-settings/desktop/standalone/engine/helper-computation.js');
const { createChatEngine, runtimeSettings } = await import('../extension/vc-model-settings/desktop/standalone/engine/runtime.js');
const { prepareChatRuntime } = await import('../extension/vc-model-settings/desktop/standalone/runtime.js');
const { openaiDefaults, powerUserDefaults } = await import('../extension/vc-model-settings/desktop/standalone/engine/defaults.js');
const { createDesktopSession } = await import('../extension/vc-model-settings/desktop/standalone/session.js');
const { bindCardHost, getCardHost } = await import('../extension/vc-model-settings/desktop/standalone/cards/ejs-host.js');
const { getChatMessages, setChatMessages, setChatMessage, createChatMessages, deleteChatMessages } = await import('../extension/vc-model-settings/desktop/standalone/cards/helper-message.js');
const { injectPrompts, uninjectPrompts } = await import('../extension/vc-model-settings/desktop/standalone/cards/helper-inject.js');
const { string_to_range } = await import('../extension/vc-model-settings/desktop/locked-source/helper/function/chat_message.js');
const { prepareSourceIdentities } = await import('../server-plugin/virtual-companion/lib/source-identity.js');

function createDeferred() {
    let resolve, reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

test.after(() => happyWindow.happyDOM.close());

function createBaseSettings() {
    return runtimeSettings({
        username: '测试用户',
        user_avatar: 'user-default.png',
        world_info: { globalSelect: [] },
        oai_settings: {
            ...structuredClone(openaiDefaults),
            preset_settings_openai: 'Default',
            openai_max_context: 4096,
            openai_max_tokens: 512,
            prompts: [
                { identifier: 'main', name: 'Main', role: 'system', content: '系统主提示词', system_prompt: true },
                { identifier: 'personaDescription', name: 'Persona', role: 'system', content: '', system_prompt: true, marker: true },
                { identifier: 'charDescription', name: 'Char', role: 'system', content: '', system_prompt: true, marker: true },
                { identifier: 'chatHistory', name: 'History', role: 'system', content: '', system_prompt: true, marker: true },
            ],
            prompt_order: [{
                character_id: 100001,
                order: [
                    { identifier: 'main', enabled: true },
                    { identifier: 'personaDescription', enabled: true },
                    { identifier: 'charDescription', enabled: true },
                    { identifier: 'chatHistory', enabled: true },
                ],
            }],
        },
        power_user: {
            ...structuredClone(powerUserDefaults),
            experimental_macro_engine: false,
            persona_description: '用户人设描述文本',
            persona_description_position: persona_description_positions.TOP_AN,
        },
        extension_settings: {
            disabledExtensions: [],
            variables: { global: {} },
            note: { default: '默认作者注释', allowWIScan: true },
            regex: [],
            tavern_helper: {
                script: {
                    enabled: { global: true, presets: [], characters: [] },
                    scripts: [],
                },
            },
        },
    });
}

test('t14-data 1: helper-computation 作者注释原文保留（不串接 [object Object]）、CHAT_COMPLETION_PROMPT_READY 异步等待与钩子改写 chat、异步 filter(false) 过滤生效', async () => {
    const settings = createBaseSettings();
    const card = {
        name: '测试角色',
        avatar: 'char.png',
        description: '角色描述',
        personality: '性格',
        scenario: '场景',
        first_mes: '你好',
        mes_example: '',
        data: {
            name: '测试角色',
            description: '角色描述',
            personality: '性格',
            scenario: '场景',
            first_mes: '你好',
            mes_example: '',
            extensions: { vc_character_ref: 'ref-1' },
        },
    };
    const context = {
        characters: [card],
        characterId: 0,
        chat: [{ name: '测试用户', is_user: true, is_system: false, mes: '历史消息1' }],
        chatMetadata: { note_prompt: '会话作者注释原文', note_interval: 1, note_depth: 1, note_position: 1, note_role: 0 },
        chatId: 'chat-1',
        name1: '测试用户',
        name2: '测试角色',
        userAvatar: 'user-default.png',
        extensionPrompts: {
            '2_floating_prompt': {
                value: '会话作者注释原文',
                position: extension_prompt_types.IN_CHAT,
                depth: 1,
                role: 0,
                scan: false,
            },
            'async_false_ext': {
                value: 'SHOULD_BE_FILTERED_OUT_EXT',
                position: extension_prompt_types.IN_PROMPT,
                depth: 0,
                role: 0,
                filter: async () => {
                    await new Promise(resolve => setTimeout(resolve, 5));
                    return false;
                },
            },
            'async_true_ext': {
                value: 'SHOULD_BE_KEPT_EXT',
                position: extension_prompt_types.IN_PROMPT,
                depth: 0,
                role: 0,
                filter: async () => {
                    await new Promise(resolve => setTimeout(resolve, 5));
                    return true;
                },
            },
        },
        eventSource: new EventEmitter(),
        eventTypes: event_types,
    };
    bindEngineContext(context, settings, { models: [], extensions: [] });

    // 1. engine/st/script.js getExtensionPrompt 异步 filter(false) 必须被过滤
    const extPromptStr = await getExtensionPrompt(extension_prompt_types.IN_PROMPT, 0, '\n', 0, false);
    assert.ok(!extPromptStr.includes('SHOULD_BE_FILTERED_OUT_EXT'), 'script.js getExtensionPrompt 不得保留 filter 返回 Promise<false> 的项');
    assert.ok(extPromptStr.includes('SHOULD_BE_KEPT_EXT'), 'script.js getExtensionPrompt 应保留 filter 返回 Promise<true> 的项');

    // 2. helper-computation (via real createChatEngine -> generateHelper): 作者注释拼接 + 异步 filter + CHAT_COMPLETION_PROMPT_READY 异步钩子等待与 chat 变更
    let hookFinished = false;
    let capturedGenerateBody = null;
    let floatingDuringPrepare = null;
    context.eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, async eventData => {
        await new Promise(resolve => setTimeout(resolve, 15));
        hookFinished = true;
        floatingDuringPrepare = structuredClone(context.extensionPrompts['2_floating_prompt']);
        eventData.chat = [
            ...eventData.chat,
            { role: 'system', content: 'ASYNC_HOOK_APPENDED_MESSAGE' },
        ];
    });

    const engine = await createChatEngine({
        client: {
            headers: () => ({}),
            request: async () => ({ token_count: 5, entries: {} }),
            generate: async ({ body }) => {
                capturedGenerateBody = body;
                return new Response(
                    JSON.stringify({
                        choices: [{ message: { content: '测试回复' }, finish_reason: 'stop' }],
                    }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } },
                );
            },
        },
        context,
        settings,
        decision: {
            eligible: true,
            source: 'custom',
            markerField: 'custom_url',
            modelField: 'custom_model_id',
            modelId: 'test-model',
            contextWindowTokens: 4096,
            maxOutputTokens: 512,
            pinned: {},
        },
        presets: { Default: structuredClone(settings.oai_settings) },
        models: [{ id: 'test-model', modelId: 'test-model' }],
    });

    try {
        await engine.generateHelper(
            {
                generation_id: 'gen-t14-1',
                user_input: '测试输入',
                max_chat_history: 'all',
                stream: false,
                should_return_reasoning: false,
                ordered_prompts: [
                    'persona_description',
                    'char_description',
                    'chat_history',
                    'user_input',
                ],
                injects: [
                    {
                        role: 'system',
                        content: 'CUSTOM_INJECT_ASYNC_FALSE',
                        position: 'in_chat',
                        depth: 0,
                        should_scan: false,
                        filter: async () => {
                            await new Promise(resolve => setTimeout(resolve, 5));
                            return false;
                        },
                    },
                    {
                        role: 'system',
                        content: 'CUSTOM_INJECT_ASYNC_TRUE',
                        position: 'in_chat',
                        depth: 0,
                        should_scan: false,
                        filter: async () => {
                            await new Promise(resolve => setTimeout(resolve, 5));
                            return true;
                        },
                    },
                ],
            },
            { signal: new AbortController().signal },
        );

        assert.equal(hookFinished, true, 'helper-computation 必须 await CHAT_COMPLETION_PROMPT_READY 异步钩子');
        const floatingVal = floatingDuringPrepare?.value ?? '';
        assert.ok(floatingVal.includes('会话作者注释原文'), '2_floating_prompt 必须保留原会话作者注释文本');
        assert.ok(floatingVal.includes('用户人设描述文本'), '2_floating_prompt 应拼入 TOP_AN 用户人设描述');
        assert.ok(!floatingVal.includes('[object Object]'), '2_floating_prompt 不得将对象串接为 [object Object]');
        assert.equal(floatingDuringPrepare?.scan, true, 'extension_settings.note.allowWIScan 应正确传入');

        const contents = (capturedGenerateBody?.messages || []).map(m => String(m.content || ''));
        assert.ok(contents.some(c => c.includes('ASYNC_HOOK_APPENDED_MESSAGE')), 'CHAT_COMPLETION_PROMPT_READY 钩子替换/修改的 chat 必须反映到最终 prompt');
        assert.ok(!contents.some(c => c.includes('SHOULD_BE_FILTERED_OUT_EXT')), 'filteredGetExtensionPrompt 必须过滤异步返回 false 的扩展提示词');
        assert.ok(contents.some(c => c.includes('SHOULD_BE_KEPT_EXT')), 'filteredGetExtensionPrompt 应保留异步返回 true 的扩展提示词');
        assert.ok(!contents.some(c => c.includes('CUSTOM_INJECT_ASYNC_FALSE')), 'populationInjectionPrompts 必须过滤异步返回 false 的 customInject');
        assert.ok(contents.some(c => c.includes('CUSTOM_INJECT_ASYNC_TRUE')), 'populationInjectionPrompts 应保留异步返回 true 的 customInject');

        // 预设路径 (use_preset: true) 同样等待 CHAT_COMPLETION_PROMPT_READY 并反映 chat 数组替换
        hookFinished = false;
        capturedGenerateBody = null;
        await engine.generateHelper(
            {
                generation_id: 'gen-t14-preset',
                user_input: '预设路径输入',
                use_preset: true,
                max_chat_history: 'all',
                stream: false,
                should_return_reasoning: false,
            },
            { signal: new AbortController().signal },
        );
        assert.equal(hookFinished, true);
        const presetContents = (capturedGenerateBody?.messages || []).map(m => String(m.content || ''));
        assert.ok(presetContents.some(c => c.includes('ASYNC_HOOK_APPENDED_MESSAGE')), 'handlePresetPath 必须反映 CHAT_COMPLETION_PROMPT_READY 钩子替换的 chat');
    } finally {
        engine.destroy?.();
    }
});

test('t14-data 2: helper-message 与 session.js 候选更新不清空其他候选、swipe_info/extra 对齐及单次 F2 保存重载', async () => {
    const settings = createBaseSettings();
    const card = {
        name: '测试角色',
        avatar: 'helper-test.png',
        data: {
            name: '测试角色',
            extensions: { vc_character_ref: 'helper-test-ref' },
        },
    };
    const initialMessages = [
        {
            name: '测试角色',
            is_user: false,
            is_system: false,
            send_date: '2026-11-04T00:00:00Z',
            mes: '候选0文本',
            swipe_id: 0,
            swipes: ['候选0文本', '候选1文本'],
            swipe_info: [
                { send_date: '2026-11-04T00:00:00Z', gen_started: '2026-11-04T00:00:00Z', gen_finished: '2026-11-04T00:00:01Z', extra: { tag: 's0', score: 1 } },
                { send_date: '2026-11-04T00:00:02Z', gen_started: '2026-11-04T00:00:02Z', gen_finished: '2026-11-04T00:00:03Z', extra: { tag: 's1', score: 2 } },
            ],
            variables: [{ v: 'v0' }, { v: 'v1' }],
            extra: { tag: 's0', score: 1 },
        },
    ];
    const initialRecords = [
        {
            user_name: '测试用户',
            character_name: '测试角色',
            chat_metadata: {
                integrity: 'test-integrity',
                vc_f2: { id: 'chat-f2-swipe', revision: 1 },
                vc_binding: {
                    characterRef: 'helper-test-ref',
                    chatIdentity: 'chat-f2-swipe',
                    relationshipId: '1',
                    conversationId: 'chat-f2-swipe',
                    mode: 'COMPANION',
                },
                variables: {},
            },
        },
        ...structuredClone(initialMessages),
    ];
    prepareSourceIdentities(initialRecords, { settled: true, sourceTimezone: 'UTC' });

    const f2Saves = [];
    const context = {
        characters: [card],
        characterId: 0,
        chat: [],
        chatMetadata: {},
        chatId: 'chat-swipe.jsonl',
        name1: '测试用户',
        name2: '测试角色',
        userAvatar: 'user-default.png',
        extensionPrompts: {},
        eventSource: new EventEmitter(),
        eventTypes: event_types,
    };
    const client = {
        headers: () => ({}),
        documents: { captureWorldbook() {} },
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
        async request(url) {
            if (url === '/api/characters/get') return structuredClone(card);
            if (url === '/api/avatars/get') return ['user-default.png'];
            return {};
        },
        async post() { return new Response('{}', { status: 200 }); },
    };

    document.body.innerHTML = '<div id="chat"><div class="mes" mesid="0"><div class="mes_text"></div></div></div>';
    let surfaceRefreshDelayMs = 0;
    const refreshSurface = async () => {
        if (surfaceRefreshDelayMs > 0) {
            await new Promise(resolve => setTimeout(resolve, surfaceRefreshDelayMs));
        }
    };
    const engine = {
        settings,
        bindContext() { bindEngineContext(context, settings, { models: [], extensions: [] }); },
        settingsForSave: () => settings,
        firstMessage: () => null,
        userMessage: async text => ({ message: { name: context.name1, mes: text, is_user: true, is_system: false, extra: {} }, bias: {} }),
        prepare: async () => ({ body: {} }),
        cleanResponse: t => t,
        memory: { finalStatus() {} },
        generateHelper: async () => '',
        cards: {
            open: async () => {},
            closeScripts: async () => {},
            settle: async () => {},
            reset: () => {},
            bindContext: () => {},
            isRendering: () => false,
            surface: { refresh: refreshSurface },
        },
    };
    engine.bindContext();

    let savedSettingsCount = 0;
    client.saveSettings = async () => {
        savedSettingsCount += 1;
        return new Response('{}', { status: 200 });
    };

    const session = createDesktopSession({
        client,
        context,
        engine,
        prepareSourceIdentities,
        choosePersona: async () => 'user-default.png',
        resolveBinding: async val => ({
            characterRef: 'helper-test-ref',
            chatIdentity: val.chatIdentity,
            relationshipId: '1',
            conversationId: val.chatIdentity,
            mode: 'COMPANION',
        }),
        reconcileSources: async () => [],
        readResponse: async () => ({ text: '', state: {}, swipes: [], toolCalls: [], finishReason: 'stop' }),
    });
    bindCardHost({
        context,
        settings,
        packet: { world_names: [] },
        surface: {
            refresh: refreshSurface,
        },
    });
    await session.activate({ avatar: 'helper-test.png', file: 'chat-swipe.jsonl' }, structuredClone(initialRecords));
    f2Saves.length = 0;

    const th = { getChatMessages, setChatMessages, setChatMessage, createChatMessages };
    try {
        // getChatMessages(0) 默认不带 include_swipes 时 extra 应对齐 info.extra，不是包含 send_date 的外层包装
        const [msgSingle] = th.getChatMessages(0);
        assert.equal(msgSingle.extra.tag, 's0');
        assert.equal(msgSingle.extra.score, 1);
        assert.equal(Object.hasOwn(msgSingle.extra, 'send_date'), false, '非 include_swipes 的 extra 应为候选 extra 对象而非 swipe_info 包装');

        // Audit 1: 默认 refresh:'affected' + 异步受控 surface.refresh + 异步受控 CHARACTER_MESSAGE_RENDERED 写回与 settingsDirty -> 仅触发 1 次 F2 保存且落盘 settings
        surfaceRefreshDelayMs = 25;
        let renderedAsyncHookRan = false;
        const onCharRendered = async idx => {
            await new Promise(resolve => setTimeout(resolve, 20));
            renderedAsyncHookRan = true;
            context.chat[idx].extra.renderedWriteback = 'from-async-rendered';
            context.saveMetadataDebounced();
            context.settingsDirty = true;
            await context.commitHelperChanges(context.chatMetadata);
        };
        context.eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, onCharRendered);
        const savesBeforeExtra = f2Saves.length;
        const settingsBeforeExtra = savedSettingsCount;
        try {
            await th.setChatMessages([{ message_id: 0, extra: { tag: 's0-updated', score: 10 } }]);
        } finally {
            context.eventSource.removeListener(event_types.CHARACTER_MESSAGE_RENDERED, onCharRendered);
            surfaceRefreshDelayMs = 0;
        }
        assert.equal(renderedAsyncHookRan, true, '默认 refresh:affected 必须等待 CHARACTER_MESSAGE_RENDERED 异步回调');
        assert.equal(f2Saves.length, savesBeforeExtra + 1, 'setChatMessages 默认 refresh:affected + 25ms surface.refresh + 异步 RENDERED 回调必须恰好 1 次 F2 保存');
        assert.equal(savedSettingsCount, settingsBeforeExtra + 1, 'mutation afterRefresh 中设置 settingsDirty 并 commitHelperChanges 必须在 mutate 收尾 await saveSettings');
        assert.equal(f2Saves.at(-1).chat[1].extra.renderedWriteback, 'from-async-rendered', '异步 RENDERED 回调写回必须包含在同一单次 F2 保存中');
        assert.equal(Object.hasOwn(context.chat[0], 'swipes_info'), false, '不得在 message 上残留错误键名 swipes_info');
        assert.equal(context.chat[0].extra.tag, 's0-updated');
        assert.equal(context.chat[0].swipe_info[0].extra.tag, 's0-updated');
        assert.equal(context.chat[0].swipe_info[0].send_date, '2026-11-04T00:00:00Z', '更新当前候选 extra 不得丢失原候选 send_date');
        assert.equal(context.chat[0].swipe_info[1].extra.tag, 's1', '更新候选 0 的 extra 不得清空候选 1 的 swipe_info');
        assert.equal(context.chat[0].swipe_info[1].send_date, '2026-11-04T00:00:02Z');

        // Audit 2: 顶层 message.extra 是当前选中候选的实时权威；修改非当前候选不得覆盖顶层 live extra，include_swipes 亦读取实时顶层
        context.chat[0].extra.newLiveField = true;
        const [withSwipesLive] = th.getChatMessages(0, { include_swipes: true });
        assert.equal(withSwipesLive.swipes_info[0].extra.newLiveField, true, 'getChatMessages include_swipes 必须从当前候选实时顶层 extra 投影');

        const savesBeforeSetMsg = f2Saves.length;
        await th.setChatMessage({ data: { test: true } }, 0, { swipe_id: 1, refresh: 'none' });
        assert.equal(f2Saves.length, savesBeforeSetMsg + 1, 'setChatMessage 应通过 Session 单次 F2 保存');
        assert.equal(context.chat[0].extra.newLiveField, true, 'setChatMessage 更新非当前候选 (swipe_id:1) 不得覆盖当前候选顶层 live extra');
        assert.equal(context.chat[0].swipe_info[0].extra.newLiveField, true, '当前候选的 swipe_info[0].extra 必须同步保留 newLiveField');
        assert.deepEqual(context.chat[0].variables[1], { test: true });

        // 局部更新候选 1 的 swipes_data / swipes_info（不传 swipes 或候选 0）：不得清空候选 0 的文本、变量或顶层 live extra
        context.chat[0].extra.secondLiveField = 'stay-alive';
        const savesBeforePartial = f2Saves.length;
        await th.setChatMessages([
            {
                message_id: 0,
                swipes_data: [undefined, { v: 'v1-updated' }],
                swipes_info: [undefined, { extra: { tag: 's1-updated', score: 20 } }],
            },
        ], { refresh: 'none' });
        assert.equal(f2Saves.length, savesBeforePartial + 1);
        assert.equal(context.chat[0].extra.newLiveField, true);
        assert.equal(context.chat[0].extra.secondLiveField, 'stay-alive');
        assert.deepEqual(context.chat[0].swipes, ['候选0文本', '候选1文本']);
        assert.deepEqual(context.chat[0].variables, [{ v: 'v0' }, { v: 'v1-updated' }]);
        assert.equal(context.chat[0].swipe_info[0].extra.tag, 's0-updated');
        assert.equal(context.chat[0].swipe_info[0].extra.secondLiveField, 'stay-alive');
        assert.equal(context.chat[0].swipe_info[1].extra.tag, 's1-updated');
        assert.equal(context.chat[0].swipe_info[1].send_date, '2026-11-04T00:00:02Z');

        // Audit 2 (vc_source 跨候选隔离): 候选 0 含 inbox_event_id，候选 1 为缺 vc_source 的 legacy 候选；切换并保存重载后不得串用 vc_source 或 inbox_event_id
        context.chat[0].extra.vc_source = {
            ...context.chat[0].extra.vc_source,
            inbox_event_id: 'inbox-evt-candidate-0',
        };
        const candidate0SourceId = context.chat[0].extra.vc_source.id;
        delete context.chat[0].swipe_info[1].extra.vc_source;

        const swipedTo1 = await session.swipe(0, 1);
        assert.equal(swipedTo1, true);
        assert.equal(context.chat[0].swipe_id, 1);
        assert.equal(context.chat[0].mes, '候选1文本');
        assert.equal(context.chat[0].extra.tag, 's1-updated');
        assert.equal(context.chat[0].extra.score, 20);
        assert.ok(context.chat[0].extra.vc_source?.id, '缺标识 legacy 候选在 F2 保存时由 prepareSourceIdentities 分配独立 vc_source');
        assert.notEqual(context.chat[0].extra.vc_source.id, candidate0SourceId, '新候选不得复制前候选的 vc_source.id');
        assert.equal(context.chat[0].extra.vc_source.inbox_event_id, undefined, '新候选不得复制前候选的 inbox_event_id');

        const lastSavedRecords = structuredClone(f2Saves.at(-1).chat);
        await session.activate({ avatar: 'helper-test.png', file: 'chat-swipe.jsonl' }, lastSavedRecords);
        assert.equal(context.chat[0].swipe_id, 1);
        assert.equal(context.chat[0].mes, '候选1文本');
        assert.equal(context.chat[0].extra.tag, 's1-updated');
        assert.deepEqual(context.chat[0].swipes, ['候选0文本', '候选1文本']);
        assert.deepEqual(context.chat[0].variables, [{ v: 'v0' }, { v: 'v1-updated' }]);
        assert.equal(context.chat[0].swipe_info[0].extra.tag, 's0-updated');
        assert.equal(context.chat[0].swipe_info[0].extra.vc_source.id, candidate0SourceId);
        assert.equal(context.chat[0].swipe_info[0].extra.vc_source.inbox_event_id, 'inbox-evt-candidate-0');
        assert.equal(context.chat[0].swipe_info[1].extra.tag, 's1-updated');
        assert.notEqual(context.chat[0].swipe_info[1].extra.vc_source.id, candidate0SourceId);
        assert.equal(context.chat[0].swipe_info[1].extra.vc_source.inbox_event_id, undefined);

        // R5 端口验证: createChatMessages 返回实际插入的消息对象数组（允许 RENDERED 监听器改写 mes 后返回最终值），commitHelperChanges 校验 metadata/归属并单次提交
        const savesBeforeCreate = f2Saves.length;
        const onUserRenderedRewrite = idx => {
            context.chat[idx].mes = `${context.chat[idx].mes}:RENDERED_FINAL`;
        };
        context.eventSource.on(event_types.USER_MESSAGE_RENDERED, onUserRenderedRewrite);
        let inserted;
        try {
            inserted = await th.createChatMessages([{ role: 'user', message: 'R5返回验证', data: { fromR5: true } }], { refresh: 'affected' });
        } finally {
            context.eventSource.removeListener(event_types.USER_MESSAGE_RENDERED, onUserRenderedRewrite);
        }
        assert.equal(f2Saves.length, savesBeforeCreate + 1);
        assert.equal(Array.isArray(inserted), true);
        assert.equal(inserted.length, 1);
        assert.equal(inserted[0], context.chat[1]);
        assert.equal(inserted[0].mes, 'R5返回验证:RENDERED_FINAL', 'createChatMessages 返回值必须反映 RENDERED 回调对 mes 的最终修改');
        assert.equal(f2Saves.at(-1).chat[2].mes, 'R5返回验证:RENDERED_FINAL');

        await assert.rejects(
            () => context.commitHelperChanges({ vc_f2: { id: 'wrong', revision: 0 } }),
            /VC_CHAT_MUTATION_REJECTED/,
        );
        const savesBeforeCommit = f2Saves.length;
        const settingsBeforeCommit = savedSettingsCount;
        context.chatMetadata.variables.slashVar = 'committed';
        context.metadataDirty = true;
        context.settingsDirty = true;
        assert.equal(await context.commitHelperChanges(context.chatMetadata), true);
        assert.equal(f2Saves.length, savesBeforeCommit + 1);
        assert.equal(savedSettingsCount, settingsBeforeCommit + 1);
        assert.equal(context.metadataDirty, false);
    } finally {
        session.destroySession?.();
    }
});

test('t14-data 4: 跨组合同收口（opening/无父渲染 commitHelperChanges、refresh:all 事件范围、R5 internal.assertActive 守卫、persistSettings 端口、once 注入不复活与 string_to_range 锁定复用）', async () => {
    const settings = createBaseSettings();
    const card = {
        name: '测试角色',
        avatar: 'helper-test.png',
        first_mes: '开场白问候',
        data: {
            name: '测试角色',
            first_mes: '开场白问候',
            extensions: { vc_character_ref: 'helper-test-ref' },
        },
    };
    const f2Saves = [];
    let savedSettingsCount = 0;
    const context = {
        characters: [card],
        characterId: 0,
        chat: [],
        chatMetadata: {},
        chatId: 'chat-a.jsonl',
        name1: '测试用户',
        name2: '测试角色',
        userAvatar: 'user-default.png',
        extensionPrompts: {},
        eventSource: new EventEmitter(),
        eventTypes: event_types,
    };
    const client = {
        headers: () => ({}),
        documents: { captureWorldbook() {} },
        saveSettings: async () => {
            savedSettingsCount += 1;
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
        async request(url) {
            if (url === '/api/characters/get') return structuredClone(card);
            if (url === '/api/avatars/get') return ['user-default.png'];
            return { token_count: 5, entries: {} };
        },
        async post() { return new Response('{}', { status: 200 }); },
        async generate() {
            return new Response(
                JSON.stringify({
                    choices: [{ message: { content: '模型回复' }, finish_reason: 'stop' }],
                }),
                { status: 200, headers: { 'Content-Type': 'application/json' } },
            );
        },
    };

    // 4.1 R1 persistSettings 端口：initializeCards 在 Session 创建前可通过 persistSettings() 直接触发 client.saveSettings
    let initPersistCalled = false;
    const refreshedRanges = [];
    let isRenderingFlag = false;
    let settleHook = null;

    const realEngine = await createChatEngine({
        client,
        context,
        settings,
        decision: {
            eligible: true,
            source: 'custom',
            markerField: 'custom_url',
            modelField: 'custom_model_id',
            modelId: 'test-model',
            contextWindowTokens: 4096,
            maxOutputTokens: 512,
            pinned: {},
        },
        presets: { Default: structuredClone(settings.oai_settings) },
        models: [{ id: 'test-model', modelId: 'test-model' }],
        initializeCards: async ({ persistSettings }) => {
            assert.equal(typeof persistSettings, 'function', 'initializeCards 必须收到 persistSettings 端口');
            settings.accountStorage = { migratedKey: 'migratedVal' };
            await persistSettings();
            initPersistCalled = true;
            return {
                getEnabledExtensions: () => ['third-party/JS-Slash-Runner', 'third-party/ST-Prompt-Template'],
                open: async () => {},
                closeScripts: async () => {},
                settle: async () => {
                    if (settleHook) await settleHook();
                },
                bindContext: () => {},
                destroy: () => {},
                isRendering: () => isRenderingFlag,
                surface: {
                    refresh: async indices => {
                        refreshedRanges.push([...indices]);
                    },
                },
            };
        },
    });
    assert.equal(initPersistCalled, true);
    assert.equal(savedSettingsCount, 1, 'initializeCards 调用 persistSettings 必须走 client.saveSettings');

    const session = createDesktopSession({
        client,
        context,
        engine: realEngine,
        prepareSourceIdentities,
        choosePersona: async () => 'user-default.png',
        resolveBinding: async val => ({
            characterRef: 'helper-test-ref',
            chatIdentity: val.chatIdentity,
            relationshipId: '1',
            conversationId: val.chatIdentity,
            mode: 'COMPANION',
        }),
        reconcileSources: async () => [],
        readResponse: async () => ({ text: '', state: {}, swipes: [], toolCalls: [], finishReason: 'stop' }),
    });
    bindCardHost({
        context,
        settings,
        packet: { world_names: [] },
        surface: realEngine.cards.surface,
    });

    try {
        // 4.2 Item 1: opening 父 job 在 ready=false 时触发 CHARACTER_MESSAGE_RENDERED，commitHelperChanges 允许有效父 owner 委托并由 open 结尾落盘 F2 与 settings
        const emptyChatHeader = [
            {
                user_name: '测试用户',
                character_name: '测试角色',
                chat_metadata: {
                    integrity: 'open-integrity',
                    vc_f2: { id: 'chat-open-empty', revision: 1 },
                    vc_binding: {
                        characterRef: 'helper-test-ref',
                        chatIdentity: 'chat-open-empty',
                        relationshipId: '1',
                        conversationId: 'chat-open-empty',
                        mode: 'COMPANION',
                    },
                    variables: {},
                },
            },
        ];
        let openingCommitResult = null;
        let readyDuringOpeningRendered = null;
        const onOpeningRendered = async () => {
            readyDuringOpeningRendered = session.ready;
            context.chatMetadata.variables.openingVar = 'from-opening-rendered';
            context.metadataDirty = true;
            context.settingsDirty = true;
            openingCommitResult = await context.commitHelperChanges(context.chatMetadata);
        };
        context.eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, onOpeningRendered);
        const settingsBeforeOpen = savedSettingsCount;
        try {
            await session.activate({ avatar: 'helper-test.png', file: 'chat-open-empty.jsonl' }, structuredClone(emptyChatHeader));
        } finally {
            context.eventSource.removeListener(event_types.CHARACTER_MESSAGE_RENDERED, onOpeningRendered);
        }
        assert.equal(readyDuringOpeningRendered, false, 'opening 期间 CHARACTER_MESSAGE_RENDERED 触发时 session.ready 应仍为 false');
        assert.equal(openingCommitResult, true, 'opening 父 job 必须允许 commitHelperChanges 委托而非因 ready=false 拒绝');
        assert.equal(f2Saves.at(-1).chat[0].chat_metadata.variables.openingVar, 'from-opening-rendered', 'opening 结尾必须保存 RENDERED 期间的 metadata 变更');
        assert.equal(savedSettingsCount, settingsBeforeOpen + 1, 'opening 结尾必须保存 RENDERED 期间的 settingsDirty');

        // 4.3 Item 1: 无 job 时 isRendering=true 的两种情况：
        // (a) 模板求值作用域内（captureHelperScope 激活且无父 job）立即拒绝，不死锁等待 settle
        isRenderingFlag = true;
        const neverSettle = createDeferred();
        settleHook = () => neverSettle.promise;
        const templateLease = context.captureHelperScope();
        try {
            await assert.rejects(
                () => context.commitHelperChanges(context.chatMetadata),
                /VC_CHAT_MUTATION_REJECTED/,
                '无父 job 的模板渲染重入调用 commitHelperChanges 必须立即拒绝而非死锁等待 settle',
            );
        } finally {
            templateLease.release();
            neverSettle.resolve();
        }

        // (b) 外部在后台 renderMessage 尚未 settle 时调用 commitHelperChanges：必须 await settle 完成后执行真实 idle 保存，不能假成功提前返回
        const renderSettleGate = createDeferred();
        isRenderingFlag = true;
        settleHook = async () => {
            await renderSettleGate.promise;
            isRenderingFlag = false;
        };
        const savesBeforeIdleRender = f2Saves.length;
        const settingsBeforeIdleRender = savedSettingsCount;
        context.chatMetadata.variables.afterSettleVar = 'saved-after-settle';
        context.metadataDirty = true;
        context.settingsDirty = true;
        let commitSettled = false;
        const pendingCommit = context.commitHelperChanges(context.chatMetadata).then(res => {
            commitSettled = true;
            return res;
        });
        await Promise.resolve();
        assert.equal(commitSettled, false, 'isRendering=true 且无 job 时 commitHelperChanges 不得未等待 settle 就提前返回 true');
        assert.equal(f2Saves.length, savesBeforeIdleRender, 'settle 完成前不得提前保存 F2');
        renderSettleGate.resolve();
        assert.equal(await pendingCommit, true);
        assert.equal(f2Saves.length, savesBeforeIdleRender + 1, 'settle 完成后必须按 idle 执行真实 F2 保存');
        assert.equal(savedSettingsCount, settingsBeforeIdleRender + 1, 'settle 完成后必须按 idle 执行真实 settings 保存');
        settleHook = null;

        // (c) 无父 job 且 F2 sourceGuard 失败未 settle (guard.begin(0)(false))、metadataDirty=true 时：commitHelperChanges 必须明确拒绝而非返回 true 假成功
        const f2Guard = globalThis[Symbol.for('virtual-companion.f2-source')];
        const finishFailedSource = f2Guard.begin(0);
        finishFailedSource(false);
        const savesBeforeFailedGuard = f2Saves.length;
        context.chatMetadata.variables.failedGuardVar = 'must-reject';
        context.metadataDirty = true;
        try {
            await assert.rejects(
                () => context.commitHelperChanges(context.chatMetadata),
                /VC_CHAT_MUTATION_REJECTED/,
                '无父 job 且 F2 sourceGuard 失败未 settle 时 commitHelperChanges 必须拒绝而非返回 true',
            );
            assert.equal(f2Saves.length, savesBeforeFailedGuard, 'sourceGuard 失败未 settle 时不得触发 F2 保存');
        } finally {
            const recoverSource = f2Guard.begin(0);
            recoverSource(true);
            delete context.chatMetadata.variables.failedGuardVar;
            context.metadataDirty = false;
        }

        // 4.4 Item 2: setChatMessages / setChatMessage 的 refresh:'all' 仅控制 surface.refresh 显示范围，RENDERED 事件只对实际变更行触发
        await createChatMessages(
            [
                { role: 'user', message: '历史消息1' },
                { role: 'assistant', message: '历史消息2' },
            ],
            { refresh: 'none' },
        );
        assert.equal(context.chat.length, 3);
        refreshedRanges.length = 0;
        const renderedEventIds = [];
        const onTrackUserRendered = idx => { renderedEventIds.push(`user:${idx}`); };
        const onTrackCharRendered = idx => { renderedEventIds.push(`char:${idx}`); };
        context.eventSource.on(event_types.USER_MESSAGE_RENDERED, onTrackUserRendered);
        context.eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, onTrackCharRendered);
        try {
            await setChatMessages([{ message_id: 1, message: '仅改第1楼' }], { refresh: 'all' });
            assert.deepEqual(refreshedRanges, [[0, 1, 2]], 'refresh:all 必须通知 surface.refresh 重绘全部楼层');
            assert.deepEqual(renderedEventIds, ['user:1'], 'setChatMessages(refresh:all) 只能对实际变更的 affectedIds 触发 RENDERED 事件');

            refreshedRanges.length = 0;
            renderedEventIds.length = 0;
            await setChatMessage({ message: '仅改第2楼' }, 2, { refresh: 'all' });
            assert.deepEqual(refreshedRanges, [[0, 1, 2]], 'setChatMessage(refresh:all) 必须通知 surface.refresh 重绘全部楼层');
            assert.deepEqual(renderedEventIds, ['char:2'], 'setChatMessage(refresh:all) 只能对实际修改楼层触发 RENDERED 事件');
        } finally {
            context.eventSource.removeListener(event_types.USER_MESSAGE_RENDERED, onTrackUserRendered);
            context.eventSource.removeListener(event_types.CHARACTER_MESSAGE_RENDERED, onTrackCharRendered);
        }

        // 4.5 Item 3: R5 内部 { assertActive } 守卫合同
        // (a) 取消发生在 cards.settle 等待中：4 个入口均不改消息、不触发 F2 保存
        for (const runOp of [
            assertActive => createChatMessages([{ role: 'user', message: '不应插入' }], { refresh: 'none' }, { assertActive }),
            assertActive => setChatMessages([{ message_id: 1, message: '不应修改' }], { refresh: 'none' }, { assertActive }),
            assertActive => setChatMessage({ message: '不应修改单条' }, 2, { refresh: 'none' }, { assertActive }),
            assertActive => deleteChatMessages([2], { refresh: 'none' }, { assertActive }),
        ]) {
            const gate = createDeferred();
            const enteredSettle = createDeferred();
            settleHook = async () => {
                enteredSettle.resolve();
                await gate.promise;
            };
            let abortedDuringSettle = false;
            const snapshotBefore = structuredClone(context.chat);
            const savesBefore = f2Saves.length;
            const opPromise = runOp(() => {
                if (abortedDuringSettle) throw new Error('VC_SLASH_ABORTED_IN_SETTLE');
            });
            await enteredSettle.promise;
            abortedDuringSettle = true;
            gate.resolve();
            await assert.rejects(opPromise, /VC_SLASH_ABORTED_IN_SETTLE/);
            assert.deepEqual(context.chat, snapshotBefore, 'settle 等待期间取消不得修改任何消息');
            assert.equal(f2Saves.length, savesBefore, 'settle 等待期间取消不得产生任何 F2 保存');
        }
        settleHook = null;

        // (b) 会话从旧 A 切换到 B 发生在 cards.settle 等待中：旧 A 的修改拒绝，对 B 无串写、无多余 F2 保存
        const switchGate = createDeferred();
        const enteredSwitchSettle = createDeferred();
        settleHook = async () => {
            enteredSwitchSettle.resolve();
            await switchGate.promise;
        };
        const savesBeforeSwitch = f2Saves.length;
        const staleMutationPromise = setChatMessages(
            [{ message_id: 0, message: '旧会话A迟到写入' }],
            { refresh: 'none' },
            { assertActive: () => true },
        );
        await enteredSwitchSettle.promise;
        settleHook = null;
        const chatBRecords = [
            {
                user_name: '测试用户',
                character_name: '测试角色',
                chat_metadata: {
                    integrity: 'b-integrity',
                    vc_f2: { id: 'chat-b', revision: 1 },
                    vc_binding: {
                        characterRef: 'helper-test-ref',
                        chatIdentity: 'chat-b',
                        relationshipId: '1',
                        conversationId: 'chat-b',
                        mode: 'COMPANION',
                    },
                    variables: {},
                },
            },
            {
                name: '测试角色',
                is_user: false,
                is_system: false,
                send_date: '2026-11-04T00:00:00Z',
                mes: '会话B原始首条消息',
                extra: {},
            },
        ];
        prepareSourceIdentities(chatBRecords, { settled: true, sourceTimezone: 'UTC' });
        const activateBPromise = session.activate({ avatar: 'helper-test.png', file: 'chat-b.jsonl' }, structuredClone(chatBRecords));
        switchGate.resolve();
        await assert.rejects(staleMutationPromise, /VC_CHAT_MUTATION_REJECTED/);
        await activateBPromise;
        assert.equal(context.chatId, 'chat-b.jsonl');
        assert.equal(context.chat[0].mes, '会话B原始首条消息', '旧会话 A 的迟到 mutation 绝不能串写到新会话 B');
        assert.equal(f2Saves.length, savesBeforeSwitch, 'settle 期间切会话 A->B 不得产生额外 F2 保存');

        // (c) 同步 assertActive 检查通过后立即 queueMicrotask(abort)：不得因 await beforeMutation 产生微任务窗口导致旧消息被修改和 F2+1
        let microtaskAborted = false;
        let checkCount = 0;
        const savesBeforeMicrotaskAbort = f2Saves.length;
        const msgBeforeMicrotaskAbort = context.chat[0].mes;
        await assert.rejects(
            () =>
                setChatMessages(
                    [{ message_id: 0, message: '不应因微任务TOCTOU被写入' }],
                    { refresh: 'none' },
                    {
                        assertActive: () => {
                            checkCount += 1;
                            if (microtaskAborted) throw new Error('VC_SLASH_ABORTED_MICROTASK');
                            queueMicrotask(() => {
                                microtaskAborted = true;
                            });
                        },
                    },
                ),
            /VC_SLASH_ABORTED_MICROTASK/,
        );
        assert.equal(checkCount >= 2, true, '必须在 settle 等待后同步复核 assertActive');
        assert.equal(context.chat[0].mes, msgBeforeMicrotaskAbort, 'queueMicrotask(abort) 触发后不得修改旧消息');
        assert.equal(f2Saves.length, savesBeforeMicrotaskAbort, 'queueMicrotask(abort) 触发后不得产生 F2 保存');

        // (d) 异步 assertActive gate 等待期间 session.activate(next) 增加 epoch，放行后 stale 修改必须被同步复核拦截（零修改、零 F2）
        const asyncGuardGate = createDeferred();
        const enteredAsyncGuard = createDeferred();
        const staleAsyncGuardMutation = setChatMessages(
            [{ message_id: 0, message: '异步guard放行后的过期修改' }],
            { refresh: 'none' },
            {
                assertActive: async () => {
                    enteredAsyncGuard.resolve();
                    await asyncGuardGate.promise;
                },
            },
        );
        await enteredAsyncGuard.promise;
        const savesBeforeAsyncGuardRelease = f2Saves.length;
        const activateBFromAsyncGuard = session.activate({ avatar: 'helper-test.png', file: 'chat-b.jsonl' }, structuredClone(chatBRecords));
        asyncGuardGate.resolve();
        await assert.rejects(staleAsyncGuardMutation, /VC_CHAT_MUTATION_REJECTED/);
        await activateBFromAsyncGuard;
        assert.equal(context.chat[0].mes, '会话B原始首条消息', 'async guard 放行后 epoch 已变，不得修改消息');
        assert.equal(f2Saves.length, savesBeforeAsyncGuardRelease, 'async guard 放行后 epoch 已变，不得产生 F2 保存');

        // 4.6 Item 5: generateHelper 的临时 extensionPrompts 回收不复活 once 注入（含被 clear 的 customDepthWI 与被 set 的 2_floating_prompt / DEPTH_PROMPT），保留持久同名与生成期同 ID 更新
        const baselineFloatingRef = {
            value: '基线作者注释',
            position: extension_prompt_types.IN_CHAT,
            depth: 1,
            role: 0,
            scan: false,
            filter: null,
        };
        context.extensionPrompts['2_floating_prompt'] = baselineFloatingRef;
        injectPrompts(
            [
                { id: 'once-prompt-id', content: 'ONCE_INJECT_CONTENT', position: 'in_chat', depth: 1, role: 'system' },
                { id: 'customDepthWI-1-0', content: 'ONCE_CLEARED_WI_CONTENT', position: 'in_chat', depth: 1, role: 'system' },
            ],
            { once: true },
        );
        injectPrompts(
            [
                { id: 'same-id-prompt', content: 'BEFORE_GEN_CONTENT', position: 'in_chat', depth: 1, role: 'system' },
                { id: 'customDepthWI-2-0', content: 'PERSIST_CLEARED_WI_CONTENT', position: 'in_chat', depth: 1, role: 'system' },
                { id: 'customDepthWI-3-0', content: 'BEFORE_GEN_REPLACED_WI', position: 'in_chat', depth: 1, role: 'system' },
                { id: 'customDepthWI-4-0', content: 'UNINJECTED_DURING_GEN_WI', position: 'in_chat', depth: 1, role: 'system' },
            ],
            { once: false },
        );
        const persistClearedWiRef = context.extensionPrompts['customDepthWI-2-0'];
        assert.ok(context.extensionPrompts['once-prompt-id'], 'once 注入应在生成前存在');
        assert.ok(context.extensionPrompts['customDepthWI-1-0'], 'customDepthWI-1-0 once 注入应在生成前存在');

        const onAfterDataHookDepthPrompt = () => {
            setExtensionPrompt('DEPTH_PROMPT', 'HOOK_UPDATED_DEPTH_PROMPT', extension_prompt_types.IN_CHAT, 3, false, true, null, 0);
        };
        context.eventSource.once(event_types.GENERATE_AFTER_DATA, onAfterDataHookDepthPrompt);

        const onGenStartedInject = () => {
            injectPrompts(
                [
                    { id: 'same-id-prompt', content: 'UPDATED_DURING_GEN_CONTENT', position: 'in_chat', depth: 2, role: 'user' },
                    { id: 'customDepthWI-3-0', content: 'REPLACED_DURING_GEN_WI', position: 'in_chat', depth: 2, role: 'user' },
                    { id: 'new-during-gen-prompt', content: 'NEW_DURING_GEN_CONTENT', position: 'in_chat', depth: 1, role: 'system' },
                ],
                { once: false },
            );
            uninjectPrompts(['customDepthWI-4-0']);
        };
        context.eventSource.once('js_generation_started', onGenStartedInject);

        await realEngine.generateHelper(
            {
                generation_id: 'gen-once-test',
                user_input: '测试 once 注入与临时 overlay',
                use_preset: true,
                max_chat_history: 'all',
                stream: false,
                should_return_reasoning: false,
                overrides: {
                    author_note: '本次临时覆盖作者注释',
                },
                inject: [
                    { content: 'HELPER_TEMP_INJECT', position: 'in_chat', depth: 1, role: 'system' },
                ],
            },
            { signal: new AbortController().signal },
        );

        assert.equal(context.extensionPrompts['DEPTH_PROMPT']?.value, 'HOOK_UPDATED_DEPTH_PROMPT', 'GENERATE_AFTER_DATA hook 写入的 DEPTH_PROMPT 不得被误认为 Helper 临时项而清除');
        assert.equal(context.extensionPrompts['once-prompt-id'], undefined, 'once:true 注入在 js_generation_ended 卸载后不得被 generateHelper finally 复活');
        assert.equal(context.extensionPrompts['customDepthWI-1-0'], undefined, '被 processWorldInfo clear 的 customDepthWI-1-0 once:true 注入在生成结束后绝不能被 finally 复活');
        assert.equal(context.extensionPrompts['customDepthWI-2-0'], persistClearedWiRef, '被 processWorldInfo 临时 clear 的持久 customDepthWI-2-0 注入必须在生成结束后恢复原对象引用');
        assert.equal(context.extensionPrompts['customDepthWI-3-0']?.value, 'REPLACED_DURING_GEN_WI', '生成期间同 ID replacement 的 customDepthWI-3-0 必须保留新注册值');
        assert.equal(context.extensionPrompts['customDepthWI-4-0'], undefined, '生成期间经 uninjectPrompts 卸载的 customDepthWI-4-0 不得被 finally 复活');
        assert.equal(context.extensionPrompts['same-id-prompt']?.value, 'UPDATED_DURING_GEN_CONTENT', '生成期间同 ID 重新注册的提示词不得被旧快照覆写');
        assert.equal(context.extensionPrompts['new-during-gen-prompt']?.value, 'NEW_DURING_GEN_CONTENT', '生成期间新增注册的提示词必须保留');
        assert.equal(context.extensionPrompts['2_floating_prompt'], baselineFloatingRef, 'helper-computation 临时覆盖的 2_floating_prompt 必须按原对象引用恢复基线');
        assert.equal(context.extensionPrompts['TEMP_USER_MESSAGE'], undefined, 'TEMP_USER_MESSAGE 临时项必须在结束后清理');
        assert.equal(
            Object.keys(context.extensionPrompts).some(k => k.startsWith('TH-CustomInjects-')),
            false,
            'TH-CustomInjects-* 临时项必须在结束后清理',
        );

        // 验证同名 once 被 set 覆盖（2_floating_prompt / DEPTH_PROMPT）与 returned uninject 卸载不复活，且持久同名被 set 覆盖后仍恢复
        injectPrompts(
            [
                { id: '2_floating_prompt', content: 'ONCE_SET_FLOATING_AN', position: 'in_chat', depth: 1, role: 'system' },
                { id: 'DEPTH_PROMPT', content: 'ONCE_SET_DEPTH_PROMPT', position: 'in_chat', depth: 1, role: 'system' },
            ],
            { once: true },
        );
        const manualUninjectHandle = injectPrompts(
            [{ id: 'customDepthWI-5-0', content: 'RETURNED_UNINJECT_WI', position: 'in_chat', depth: 1, role: 'system' }],
            { once: false },
        );
        context.eventSource.once('js_generation_started', () => {
            manualUninjectHandle.uninject();
        });
        await realEngine.generateHelper(
            {
                generation_id: 'gen-once-set-test',
                user_input: '测试被 set 覆盖的同名 once 注入',
                use_preset: true,
                max_chat_history: 'all',
                stream: false,
                should_return_reasoning: false,
                overrides: {
                    author_note: '第二次临时覆盖作者注释',
                },
            },
            { signal: new AbortController().signal },
        );
        assert.equal(context.extensionPrompts['2_floating_prompt'], undefined, '被 setAuthorNotePrompt 临时覆盖的 2_floating_prompt once:true 注入在结束后不得复活');
        assert.equal(context.extensionPrompts['DEPTH_PROMPT'], undefined, '被 handleCharDepthPrompt 临时覆盖的 DEPTH_PROMPT once:true 注入在结束后不得复活');
        assert.equal(context.extensionPrompts['customDepthWI-5-0'], undefined, '生成期间调用 returned uninject() 卸载的提示词不得被 finally 复活');

        injectPrompts(
            [{ id: '2_floating_prompt', content: 'PERSIST_INJECTED_FLOATING_AN', position: 'in_chat', depth: 1, role: 'system' }],
            { once: false },
        );
        const persistFloatingInjectRef = context.extensionPrompts['2_floating_prompt'];
        await realEngine.generateHelper(
            {
                generation_id: 'gen-persist-set-test',
                user_input: '测试被 set 覆盖的持久同名注入恢复',
                use_preset: true,
                max_chat_history: 'all',
                stream: false,
                should_return_reasoning: false,
                overrides: {
                    author_note: '第三次临时覆盖作者注释',
                },
            },
            { signal: new AbortController().signal },
        );
        assert.equal(context.extensionPrompts['2_floating_prompt'], persistFloatingInjectRef, '被 setAuthorNotePrompt 临时覆盖的持久同名 2_floating_prompt 注入必须在结束后恢复');

        // 4.7 Item 6: locked-source string_to_range 与 getChatMessages 范围解析一致性
        await createChatMessages(
            [
                { role: 'user', message: 'B消息1' },
                { role: 'assistant', message: 'B消息2' },
                { role: 'user', message: 'B消息3' },
            ],
            { refresh: 'none' },
        );
        const maxIdx = context.chat.length - 1;
        for (const expr of ['0', '-1', '1-2', '2-1', '-2--1', '-10-1', 'invalid-range']) {
            const expectedRange = string_to_range(expr, 0, maxIdx);
            const actualMsgs = getChatMessages(expr);
            if (expectedRange === null) {
                assert.deepEqual(actualMsgs, []);
            } else {
                const expectedIds = [];
                for (let i = expectedRange.start; i <= expectedRange.end; i++) expectedIds.push(i);
                assert.deepEqual(actualMsgs.map(m => m.message_id), expectedIds, `getChatMessages(${expr}) 必须与 locked-source string_to_range 完全一致`);
            }
        }

        // 4.8 A 在 js_generation_before_end 异步 gate 暂停期间 abort + destroy 并创建真实 engineB：放行 A 后 A 不发 ended、finally 不回退 B 的全局 context / eventSource / CardHost，且 A 局部 prompt 恢复正常
        injectPrompts(
            [{ id: 'customDepthWI-abort-once', content: 'ABORT_ONCE_WI', position: 'in_chat', depth: 1, role: 'system' }],
            { once: true },
        );
        const beforeEndGate = createDeferred();
        const enteredBeforeEnd = createDeferred();
        let aEndedCount = 0;
        const onABeforeEnd = async () => {
            enteredBeforeEnd.resolve();
            await beforeEndGate.promise;
        };
        const onAEnded = () => {
            aEndedCount += 1;
        };
        context.eventSource.once('js_generation_before_end', onABeforeEnd);
        context.eventSource.once('js_generation_ended', onAEnded);

        const controllerA = new AbortController();
        const genAPromise = realEngine.generateHelper(
            {
                generation_id: 'gen-a-late-finally',
                user_input: 'A 在 before_end 暂停后被取消销毁',
                use_preset: true,
                max_chat_history: 'all',
                stream: false,
                should_return_reasoning: false,
                overrides: {
                    author_note: 'A 的临时作者注释',
                },
                inject: [
                    { content: 'A_TEMP_INJECT', position: 'in_chat', depth: 1, role: 'system' },
                ],
            },
            { signal: controllerA.signal },
        );

        await enteredBeforeEnd.promise;
        controllerA.abort();
        await context.eventSource.emit(event_types.GENERATION_STOPPED);
        realEngine.destroy();

        const settingsB = createBaseSettings();
        const contextB = {
            characters: [card],
            characterId: 0,
            chat: [{ name: '测试角色', is_user: false, is_system: false, mes: 'B会话首条' }],
            chatMetadata: { vc_f2: { id: 'chat-engine-b-next', revision: 1 }, variables: {} },
            chatId: 'chat-engine-b-next.jsonl',
            name1: 'B用户',
            name2: '测试角色',
            userAvatar: 'user-default.png',
            extensionPrompts: {},
            eventSource: new EventEmitter(),
            eventTypes: event_types,
        };
        const engineB = await createChatEngine({
            client,
            context: contextB,
            settings: settingsB,
            decision: {
                eligible: true,
                source: 'custom',
                markerField: 'custom_url',
                modelField: 'custom_model_id',
                modelId: 'test-model',
                contextWindowTokens: 4096,
                maxOutputTokens: 512,
                pinned: {},
            },
            presets: { Default: structuredClone(settingsB.oai_settings) },
            models: [{ id: 'test-model', modelId: 'test-model' }],
            initializeCards: async ({ context: ctx, settings: st }) => {
                const surfaceB = { refresh: async () => {} };
                bindCardHost({
                    context: ctx,
                    settings: st,
                    packet: { world_names: [] },
                    surface: surfaceB,
                });
                return {
                    getEnabledExtensions: () => ['third-party/JS-Slash-Runner', 'third-party/ST-Prompt-Template'],
                    bindContext: () => {},
                    destroy: () => {},
                    surface: surfaceB,
                };
            },
        });
        try {
            assert.equal(getContext().chatId, 'chat-engine-b-next.jsonl');
            assert.equal(getContext().eventSource, contextB.eventSource);
            assert.equal(getCardHost().context, contextB);

            beforeEndGate.resolve();
            await assert.rejects(genAPromise, /AbortError|aborted|destroyed/i);

            assert.equal(aEndedCount, 0, 'A 在 js_generation_before_end 期间取消后不得继续发出 js_generation_ended');
            assert.equal(getContext().chatId, 'chat-engine-b-next.jsonl', 'A 的 generateHelper finally 不得将 ports.getContext().chatId 从 B 回退到 A');
            assert.equal(getContext().eventSource, contextB.eventSource, 'A 的 generateHelper finally 不得回退 B 的 eventSource');
            assert.equal(getCardHost().context, contextB, 'A 的 generateHelper finally 不得回退 B 的 CardHost');

            realEngine.bindContext();
            assert.equal(getContext().chatId, 'chat-engine-b-next.jsonl', '已销毁 engineA 调用 bindContext 不得覆盖 B 的全局端口');
            await assert.rejects(
                () => realEngine.userMessage('已销毁引擎用户输入'),
                err => err?.name === 'AbortError',
                '已销毁 engineA 调用 userMessage 必须明确抛 AbortError',
            );
            assert.throws(
                () => realEngine.editMessage({ is_user: true, mes: '原文本', extra: {} }, '已销毁引擎编辑文本'),
                err => err?.name === 'AbortError',
                '已销毁 engineA 调用 editMessage 必须明确抛 AbortError',
            );
            assert.equal(getContext().chatId, 'chat-engine-b-next.jsonl', '已销毁 engineA 调用 userMessage/editMessage 拒绝后 B 的全局端口保持不变');

            assert.equal(context.extensionPrompts['2_floating_prompt'], persistFloatingInjectRef, 'A 局部持久 2_floating_prompt 仍应在 finally 中恢复');
            assert.equal(context.extensionPrompts['customDepthWI-abort-once'], undefined, 'A 局部已取消卸载的 once 注入不得在 finally 中复活');
            assert.equal(context.extensionPrompts['TEMP_USER_MESSAGE'], undefined, 'A 局部临时 TEMP_USER_MESSAGE 必须在 finally 中清理');
            assert.equal(
                Object.keys(context.extensionPrompts).some(k => k.startsWith('TH-CustomInjects-')),
                false,
                'A 局部临时 TH-CustomInjects-* 必须在 finally 中清理',
            );
        } finally {
            context.eventSource.removeListener('js_generation_before_end', onABeforeEnd);
            context.eventSource.removeListener('js_generation_ended', onAEnded);
            engineB.destroy();
        }
    } finally {
        session.destroySession?.();
        realEngine.destroy?.();
    }
});

test('t14-data 3: engine/runtime.js 多次创建与销毁时宏事件绑定当前 emitter、firstDisplayedMessageId 与 extensions 真实动态供值', async () => {
    const settings1 = createBaseSettings();
    const card = {
        name: '测试角色',
        avatar: 'char.png',
        data: { name: '测试角色', extensions: { vc_character_ref: 'ref-1' } },
    };
    const context1 = {
        characters: [card],
        characterId: 0,
        chat: [{ name: '测试角色', is_user: false, is_system: false, mes: '你好' }],
        chatMetadata: { vc_f2: { id: 'c1', revision: 1 } },
        chatId: 'c1',
        name1: '用户1',
        name2: '角色1',
        userAvatar: 'user-default.png',
        extensionPrompts: {},
        eventSource: new EventEmitter(),
        eventTypes: event_types,
    };
    const noopClient = {
        headers: () => ({}),
        request: async () => ({}),
        generate: async () => new Response('{}', { status: 200 }),
    };

    const engine1 = await createChatEngine({
        client: noopClient,
        context: context1,
        settings: settings1,
        decision: { eligible: false, modelId: 'm1' },
        presets: { Default: structuredClone(settings1.oai_settings) },
        models: [],
    });

    await context1.eventSource.emit(event_types.GENERATION_STARTED, 'impersonate', {}, false);
    assert.equal(engine1.substituteMacros('{{lastGenerationType}}'), 'impersonate');
    engine1.destroy?.();

    // 创建第二个 engine 实例（新的 eventSource2）
    const settings2 = createBaseSettings();
    let dynamicFirstId = 25;
    const context2 = {
        characters: [card],
        characterId: 0,
        chat: Array.from({ length: 100 }, (_, i) => ({ name: '测试角色', is_user: i % 2 === 1, is_system: false, mes: `msg-${i}` })),
        chatMetadata: { vc_f2: { id: 'c2', revision: 1 } },
        chatId: 'c2',
        name1: '用户2',
        name2: '角色2',
        userAvatar: 'user-default.png',
        extensionPrompts: {},
        eventSource: new EventEmitter(),
        eventTypes: event_types,
        get firstDisplayedMessageId() {
            return dynamicFirstId;
        },
    };

    const engine2 = await createChatEngine({
        client: noopClient,
        context: context2,
        settings: settings2,
        decision: { eligible: false, modelId: 'm2' },
        presets: { Default: structuredClone(settings2.oai_settings) },
        models: [],
        initializeCards: async () => ({
            getEnabledExtensions: () => ['third-party/JS-Slash-Runner', 'third-party/ST-Prompt-Template'],
            bindContext() {},
            destroy() {},
        }),
    });

    try {
        // 旧 emitter 触发不得影响新 engine2
        await context1.eventSource.emit(event_types.GENERATION_STARTED, 'quiet', {}, false);
        assert.equal(engine2.substituteMacros('{{lastGenerationType}}'), '');

        // 新 emitter 触发必须更新 lastGenerationType（覆盖旧引擎与实验宏引擎）
        await context2.eventSource.emit(event_types.GENERATION_STARTED, 'swipe', {}, false);
        assert.equal(engine2.substituteMacros('{{lastGenerationType}}'), 'swipe');
        settings2.power_user.experimental_macro_engine = true;
        assert.equal(substituteParams('{{lastGenerationType}}'), 'swipe');
        settings2.power_user.experimental_macro_engine = false;

        await context2.eventSource.emit(event_types.CHAT_CHANGED);
        assert.equal(engine2.substituteMacros('{{lastGenerationType}}'), '');

        // firstDisplayedMessageId 必须实时反映窗口/折叠/删除变化，未挂载时返回 null / 空串
        assert.equal(readFirstDisplayedMessageId(), 25);
        assert.equal(engine2.substituteMacros('{{firstDisplayedMessageId}}'), '25');
        dynamicFirstId = 5;
        assert.equal(engine2.substituteMacros('{{firstDisplayedMessageId}}'), '5');
        dynamicFirstId = null;
        assert.equal(readFirstDisplayedMessageId(), null);
        assert.equal(engine2.substituteMacros('{{firstDisplayedMessageId}}'), '');

        // Audit 3: extensions 仅来自真实已初始化的 owner（engine regex + cards.getEnabledExtensions），不伪称未初始化模块，不因 settings key 存在把 MVU 当扩展，且 applySettings 禁用->再启用必须恢复
        settings2.power_user.experimental_macro_engine = true;
        settings2.extension_settings.MagVarUpdate = { enabled: true };
        assert.equal(findExtension('memory'), undefined, '未初始化的 memory 不得报告启用');
        assert.equal(substituteParams('{{hasExtension::memory}}'), 'false');
        assert.equal(findExtension('MagVarUpdate'), undefined, 'MVU 是脚本而非 ST 扩展，不得因 settings key 存在报告启用');
        assert.equal(substituteParams('{{hasExtension::MagVarUpdate}}'), 'false');

        assert.equal(Boolean(findExtension('regex')?.enabled), true);
        assert.equal(substituteParams('{{hasExtension::regex}}'), 'true');
        assert.equal(substituteParams('{{hasExtension::JS-Slash-Runner}}'), 'true');
        assert.equal(substituteParams('{{hasExtension::ST-Prompt-Template}}'), 'true');

        // 生产 applySettings 禁用 regex -> 再启用 regex 回归
        engine2.applySettings([
            {
                path: ['extension_settings', 'disabledExtensions'],
                before: { exists: true, value: [] },
                after: { exists: true, value: ['regex'] },
            },
        ]);
        assert.equal(findExtension('regex'), undefined);
        assert.equal(substituteParams('{{hasExtension::regex}}'), 'false');

        engine2.applySettings([
            {
                path: ['extension_settings', 'disabledExtensions'],
                before: { exists: true, value: ['regex'] },
                after: { exists: true, value: [] },
            },
        ]);
        assert.equal(Boolean(findExtension('regex')?.enabled), true, 'applySettings 重新启用 regex 后不得因上次 context.extensions 缓存而永久 disabled');
        assert.equal(substituteParams('{{hasExtension::regex}}'), 'true');

        engine2.applySettings([
            {
                path: ['extension_settings', 'tavern_helper', 'enabled'],
                before: { exists: false },
                after: { exists: true, value: false },
            },
        ]);
        assert.equal(substituteParams('{{hasExtension::JS-Slash-Runner}}'), 'false');

        engine2.applySettings([
            {
                path: ['extension_settings', 'tavern_helper', 'enabled'],
                before: { exists: true, value: false },
                after: { exists: true, value: true },
            },
        ]);
        assert.equal(substituteParams('{{hasExtension::JS-Slash-Runner}}'), 'true');
    } finally {
        engine2.destroy?.();
    }
});

test('t14-data 5: prepareChatRuntime 与 createChatEngine 遵循 AbortSignal，迟到完成不接管或清除实例 B 的全局 context / CardHost / 宏 emitter', async () => {
    const prevFetch = globalThis.fetch;
    globalThis.fetch = async url => {
        const path = String(url);
        if (path.endsWith('/model-purposes')) {
            return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (path.endsWith('/providers')) {
            return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        throw new Error(`Unexpected fetch in t14-data 5: ${path}`);
    };

    try {
        // 5.1 真实 prepareChatRuntime 在 await purposes/providers/settings 后、进入 captureSettings/createChatEngine 前检查 signal.throwIfAborted()
        const settingsGateA = createDeferred();
        const abortA = new AbortController();
        let captureSettingsCalledA = 0;
        const toastsA = [];
        const contextA = {
            characters: [],
            characterId: undefined,
            chat: [],
            chatMetadata: {},
            chatId: 'chat-a',
            name1: 'UserA',
            name2: 'CharA',
            extensionPrompts: {},
            eventSource: new EventEmitter(),
            eventTypes: event_types,
        };
        const clientA = {
            headers: () => ({}),
            settings: () => settingsGateA.promise,
            documents: {
                captureSettings() {
                    captureSettingsCalledA += 1;
                },
                seedPresets() {},
                projectSettings() {},
            },
        };

        const preparePromiseA = prepareChatRuntime({
            client: clientA,
            context: contextA,
            signal: abortA.signal,
            onToast: msg => toastsA.push(msg),
        });

        // A 销毁（同步 abort），随后 B 完成初始化并绑定全局 context / CardHost / SillyTavern / 宏 emitter
        abortA.abort();

        const settingsB = createBaseSettings();
        const contextB = {
            characters: [],
            characterId: undefined,
            chat: [],
            chatMetadata: {},
            chatId: 'chat-b',
            name1: 'UserB',
            name2: 'CharB',
            extensionPrompts: {},
            eventSource: new EventEmitter(),
            eventTypes: event_types,
        };
        const noopClientB = {
            headers: () => ({}),
            request: async () => ({}),
            generate: async () => new Response('{}', { status: 200 }),
        };
        const engineB = await createChatEngine({
            client: noopClientB,
            context: contextB,
            settings: settingsB,
            decision: { eligible: false, modelId: 'm-b' },
            presets: { Default: structuredClone(settingsB.oai_settings) },
            models: [],
            initializeCards: async () => {
                bindCardHost({ context: contextB, settings: settingsB, presets: {}, models: [], packet: { world_names: [] } });
                return {
                    getEnabledExtensions: () => [],
                    bindContext() {
                        bindCardHost({ context: contextB, settings: settingsB, presets: {}, models: [], packet: { world_names: [] } });
                    },
                    destroy() {},
                };
            },
        });
        globalThis.SillyTavern = { getContext: () => contextB };

        try {
            // 释放 A 的 settings Promise：A 必须在进入 captureSettings / createChatEngine 前直接抛出 AbortError
            settingsGateA.resolve({
                settings: JSON.stringify(createBaseSettings()),
                openai_setting_names: ['Default'],
                openai_settings: [JSON.stringify(openaiDefaults)],
            });

            await assert.rejects(
                preparePromiseA,
                err => err?.name === 'AbortError',
                '已取消的 prepareChatRuntime 在异步读取完成后必须抛出 AbortError',
            );
            assert.equal(captureSettingsCalledA, 0, '已取消的 prepareChatRuntime 不得进入 captureSettings 或 createChatEngine');
            assert.equal(getContext().eventSource, contextB.eventSource, 'B 的 ports.js context 不得被迟到的 A 覆盖或清除');
            assert.equal(getContext().chatId, 'chat-b', 'B 的 ports.js chatId 不得被迟到的 A 覆盖或清除');
            assert.equal(getCardHost()?.context, contextB, 'B 的 CardHost context 不得被迟到的 A 覆盖或清除');
            assert.equal(globalThis.SillyTavern?.getContext(), contextB, 'B 的全局 SillyTavern.getContext() 不得被迟到的 A 覆盖或清除');
            assert.deepEqual(toastsA, []);

            // 5.2 createChatEngine 在 initializeCards 异步边界前已进入、随后被取消且 B 已完成初始化：
            // A2 迟到完成时只清理自身局部 cards/listeners，绝不覆盖 B 的 context/CardHost/宏 emitter
            const cardsGateA2 = createDeferred();
            const abortA2 = new AbortController();
            let a2SignalReceived = null;
            let a2CardsDestroyed = 0;
            const contextA2 = {
                characters: [],
                characterId: undefined,
                chat: [],
                chatMetadata: {},
                chatId: 'chat-a2',
                name1: 'UserA2',
                name2: 'CharA2',
                extensionPrompts: {},
                eventSource: new EventEmitter(),
                eventTypes: event_types,
            };
            const enginePromiseA2 = createChatEngine({
                client: noopClientB,
                context: contextA2,
                signal: abortA2.signal,
                settings: createBaseSettings(),
                decision: { eligible: false, modelId: 'm-a2' },
                presets: { Default: structuredClone(openaiDefaults) },
                models: [],
                onToast: msg => toastsA.push(msg),
                initializeCards: async ({ signal }) => {
                    a2SignalReceived = signal;
                    return await cardsGateA2.promise;
                },
            });

            await Promise.resolve();
            assert.equal(a2SignalReceived, abortA2.signal, 'createChatEngine 必须把 signal 传给 initializeCards');

            // A2 取消，B 重新绑定为当前活跃实例
            abortA2.abort();
            engineB.bindContext();
            bindCardHost({ context: contextB, settings: settingsB, presets: {}, models: [], packet: { world_names: [] } });

            // 释放 A2 的 initializeCards
            cardsGateA2.resolve({
                getEnabledExtensions: () => ['third-party/JS-Slash-Runner'],
                bindContext() {
                    bindCardHost({ context: contextA2, settings: {}, presets: {}, models: [], packet: { world_names: [] } });
                },
                destroy() {
                    a2CardsDestroyed += 1;
                },
            });

            await assert.rejects(
                enginePromiseA2,
                err => err?.name === 'AbortError',
                'initializeCards 等待期间取消的 createChatEngine 必须抛出 AbortError',
            );
            assert.equal(a2CardsDestroyed, 1, '取消的 createChatEngine 必须销毁自身已创建的局部 cards 实例');
            assert.equal(getContext().eventSource, contextB.eventSource, 'A2 取消后不得执行 bindEngineContext 覆盖 B 的 context');
            assert.equal(getContext().chatId, 'chat-b', 'A2 取消后不得覆盖 B 的 ports.js chatId');
            assert.equal(getCardHost()?.context, contextB, 'A2 取消后不得覆盖 B 的 CardHost');

            // 验证 A2 的事件源已解绑，且 B 的宏 emitter 正常工作
            await contextA2.eventSource.emit(event_types.GENERATION_STARTED, 'impersonate', {}, false);
            assert.equal(engineB.substituteMacros('{{lastGenerationType}}'), '');
            await contextB.eventSource.emit(event_types.GENERATION_STARTED, 'swipe', {}, false);
            assert.equal(engineB.substituteMacros('{{lastGenerationType}}'), 'swipe');
        } finally {
            engineB.destroy?.();
        }
    } finally {
        globalThis.fetch = prevFetch;
    }
});
