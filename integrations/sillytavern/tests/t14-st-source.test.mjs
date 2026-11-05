import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ST_ROOT = path.resolve(__dirname, '..');

const happyWindow = new Window({ url: 'http://localhost:8000/desktop/' });
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
});
test.after(() => happyWindow.happyDOM.close());

const lockedLib = await import('../extension/vc-model-settings/desktop/locked-source/st/lib.js');
globalThis._ = lockedLib.lodash;

const { desktopSourceModules } = await import('../scripts/lib/desktop-source-modules.mjs');
const { isWhitelistedExtensionModule } = await import('../scripts/lib/desktop-source-boundary.mjs');

const engineEvents = await import('../extension/vc-model-settings/desktop/standalone/engine/events.js');
const stEvents = await import('../extension/vc-model-settings/desktop/standalone/engine/st/events.js');
const stConstants = await import('../extension/vc-model-settings/desktop/standalone/engine/st/constants.js');
const stLib = await import('../extension/vc-model-settings/desktop/standalone/engine/st/lib.js');
const stUtils = await import('../extension/vc-model-settings/desktop/standalone/engine/st/scripts/utils.js');
const stVariables = await import('../extension/vc-model-settings/desktop/standalone/engine/st/scripts/variables.js');
const stMacros = await import('../extension/vc-model-settings/desktop/standalone/engine/st/scripts/macros.js');
const stScript = await import('../extension/vc-model-settings/desktop/standalone/engine/st/script.js');
const enginePorts = await import('../extension/vc-model-settings/desktop/standalone/engine/ports.js');
const { openaiDefaults, powerUserDefaults } = await import('../extension/vc-model-settings/desktop/standalone/engine/defaults.js');

const lockedEventEmitter = await import('../extension/vc-model-settings/desktop/locked-source/st/lib/eventemitter.js');
const lockedEvents = await import('../extension/vc-model-settings/desktop/locked-source/st/scripts/events.js');
const lockedConstants = await import('../extension/vc-model-settings/desktop/locked-source/st/scripts/constants.js');
const lockedSystemMessages = await import('../extension/vc-model-settings/desktop/locked-source/st/scripts/system-messages.js');
const lockedPersonas = await import('../extension/vc-model-settings/desktop/locked-source/st/scripts/personas.js');
const lockedUtils = await import('../extension/vc-model-settings/desktop/locked-source/st/scripts/utils.js');
const lockedSlashUtils = await import('../extension/vc-model-settings/desktop/locked-source/st/scripts/desktop-slash-utils.js');
const lockedMacroSystem = await import('../extension/vc-model-settings/desktop/locked-source/st/scripts/macros/macro-system.js');
const lockedMacroRegistry = await import('../extension/vc-model-settings/desktop/locked-source/st/scripts/macros/engine/MacroRegistry.js');
const lockedMacroDiagnostics = await import('../extension/vc-model-settings/desktop/locked-source/st/scripts/macros/engine/MacroDiagnostics.js');

function createMacroTestContext({
    experimentalMacroEngine = true,
    readFirstDisplayedMessageId,
    firstDisplayedMessageId,
    rawExtensions,
    getEnabledExtensions,
    packet = { enable_extensions: true },
    disabledExtensions = [],
    mobile = false,
    input = '测试输入框文本',
} = {}) {
    const eventSource = new engineEvents.EventEmitter();
    const card = {
        avatar: 'macro-char.png',
        name: '艾莉丝',
        description: '来自王都的魔法师',
        personality: '冷静、博学',
        scenario: '高塔图书馆',
        first_mes: '欢迎来到高塔。',
        mes_example: '<START>\n{{user}}: 你好\n{{char}}: 欢迎。',
        data: {
            name: '艾莉丝',
            description: '来自王都的魔法师',
            personality: '冷静、博学',
            scenario: '高塔图书馆',
            first_mes: '欢迎来到高塔。',
            mes_example: '<START>\n{{user}}: 你好\n{{char}}: 欢迎。',
            creator_notes: '作者备注内容',
            system_prompt: '角色系统提示词',
            post_history_instructions: '角色越狱提示词',
            character_version: '2.1',
            extensions: {
                depth_prompt: { prompt: '深度提示词', depth: 4, role: 'system' },
            },
        },
    };
    const context = {
        characters: [card],
        characterId: 0,
        chat: [
            { name: '旅行者', is_user: true, is_system: false, mes: '第一条用户消息', send_date: '2026-11-05T10:00:00Z' },
            {
                name: '艾莉丝',
                is_user: false,
                is_system: false,
                mes: '第一条角色回复',
                swipe_id: 1,
                swipes: ['候选回复1', '第一条角色回复', '候选回复3'],
                send_date: '2026-11-05T10:01:00Z',
            },
        ],
        chatMetadata: {
            lastInContextMessageId: 0,
            variables: { init_local: 'local_val' },
        },
        chatId: 'macro-test-chat',
        name1: '旅行者',
        name2: '艾莉丝',
        groups: [],
        groupId: null,
        extensionPrompts: {
            [stConstants.inject_ids.CUSTOM_WI_OUTLET('testOutlet')]: {
                value: 'OUTLET_VALUE_OK',
                position: -1,
                depth: 0,
                scan: false,
                role: 0,
                filter: null,
            },
        },
        eventSource,
        eventTypes: stEvents.event_types,
    };
    if (firstDisplayedMessageId !== undefined) {
        context.firstDisplayedMessageId = firstDisplayedMessageId;
    }
    const settings = {
        oai_settings: {
            ...structuredClone(openaiDefaults),
            openai_max_context: 4096,
            openai_max_tokens: 512,
        },
        power_user: {
            ...structuredClone(powerUserDefaults),
            experimental_macro_engine: experimentalMacroEngine,
            persona_description: '勇敢的冒险者',
            prefer_character_prompt: true,
            prefer_character_jailbreak: true,
        },
        extension_settings: {
            disabledExtensions,
            variables: { global: { init_global: 'global_val' } },
            tavern_helper: { enabled: true, script: { enabled: { global: true } } },
            EjsTemplate: { enabled: true },
        },
    };
    const environment = {
        readInput: () => input,
        readFirstDisplayedMessageId,
        model: 'claude-3-7-sonnet',
        models: [],
        openrouterWebsiteModel: '',
        locale: 'en',
        mobile,
        rawExtensions,
        getEnabledExtensions,
        packet,
    };
    return {
        context,
        settings,
        environment,
        eventSource,
        bind() {
            enginePorts.bindEngineContext(context, settings, environment);
        },
    };
}

test('T14-ST-1: ST 常量/事件/库/工具/变量/宏核心统一消费 locked-source，且已删除 standalone/engine/st/scripts/macros 重复实现', async () => {
    assert.ok(desktopSourceModules['st/scripts/variables.js'], 'desktop-source-modules.mjs 必须声明 st/scripts/variables.js');
    assert.ok(desktopSourceModules['st/scripts/macros.js'], 'desktop-source-modules.mjs 必须声明 st/scripts/macros.js');

    const lockedVariables = await import('../extension/vc-model-settings/desktop/locked-source/st/scripts/variables.js');
    const lockedMacros = await import('../extension/vc-model-settings/desktop/locked-source/st/scripts/macros.js');

    // 1. EventEmitter / event_types / constants / lib 引用同一锁定生成物
    assert.equal(engineEvents.EventEmitter, lockedEventEmitter.EventEmitter);
    assert.equal(stEvents.event_types, lockedEvents.event_types);
    assert.equal(stConstants.inject_ids, lockedConstants.inject_ids);
    assert.equal(stConstants.IGNORE_SYMBOL, lockedConstants.IGNORE_SYMBOL);
    assert.equal(stConstants.MEDIA_TYPE, lockedConstants.MEDIA_TYPE);
    assert.equal(stConstants.MEDIA_DISPLAY, lockedConstants.MEDIA_DISPLAY);
    assert.equal(stConstants.GENERATION_TYPE_TRIGGERS, lockedConstants.GENERATION_TYPE_TRIGGERS);
    assert.equal(stConstants.system_message_types, lockedSystemMessages.system_message_types);
    assert.equal(stConstants.persona_description_positions, lockedPersonas.persona_description_positions);

    assert.equal(stLib.chevrotain, lockedLib.chevrotain);
    assert.equal(stLib.moment, lockedLib.moment);
    assert.equal(stLib.seedrandom, lockedLib.seedrandom);
    assert.equal(stLib.droll, lockedLib.droll);
    assert.equal(stLib.lodash, lockedLib.lodash);
    assert.equal(stLib.Handlebars, lockedLib.Handlebars);
    assert.equal(stLib.Bowser, lockedLib.Bowser);

    // 2. utils.js 与 variables.js 均复用 locked-source
    for (const name of [
        'getStringHash',
        'escapeRegex',
        'isTrueBoolean',
        'isFalseBoolean',
        'isDigitsOnly',
        'uuidv4',
        'stringFormat',
        'dateCache',
        'timestampToMoment',
        'parseTimestamp',
        'collapseNewlines',
        'clamp',
        'getCharaFilename',
        'trimToEndSentence',
        'isOdd',
        'countOccurrences',
    ]) {
        assert.equal(stUtils[name], lockedUtils[name], `utils.${name} 必须引用 locked-source/st/scripts/utils.js`);
    }
    assert.equal(stUtils.convertValueType, lockedSlashUtils.convertValueType);

    for (const name of [
        'getLocalVariable',
        'setLocalVariable',
        'getGlobalVariable',
        'setGlobalVariable',
        'addLocalVariable',
        'addGlobalVariable',
        'incrementLocalVariable',
        'incrementGlobalVariable',
        'decrementLocalVariable',
        'decrementGlobalVariable',
        'getVariableMacros',
        'existsLocalVariable',
        'existsGlobalVariable',
        'deleteLocalVariable',
        'deleteGlobalVariable',
    ]) {
        assert.equal(stVariables[name], lockedVariables[name], `variables.${name} 必须引用 locked-source/st/scripts/variables.js`);
    }

    // 3. macros.js 的 MacrosParser 与 evaluateMacros 等核心来自 locked-source/st/scripts/macros.js
    assert.equal(stMacros.MacrosParser, lockedMacros.MacrosParser);
    assert.equal(stMacros.evaluateMacros, lockedMacros.evaluateMacros);
    assert.equal(stMacros.getLastMessageId, lockedMacros.getLastMessageId);

    // 4. standalone/engine/st/scripts/macros/** 下全部 16 个重复文件（含 MacroDiagnostics.js）已物理删除且移出白名单，改为生成到 locked-source
    const deletedMacroFiles = [
        'desktop/standalone/engine/st/scripts/macros/macro-system.js',
        'desktop/standalone/engine/st/scripts/macros/definitions/chat-macros.js',
        'desktop/standalone/engine/st/scripts/macros/definitions/core-macros.js',
        'desktop/standalone/engine/st/scripts/macros/definitions/env-macros.js',
        'desktop/standalone/engine/st/scripts/macros/definitions/instruct-macros.js',
        'desktop/standalone/engine/st/scripts/macros/definitions/state-macros.js',
        'desktop/standalone/engine/st/scripts/macros/definitions/time-macros.js',
        'desktop/standalone/engine/st/scripts/macros/definitions/variable-macros.js',
        'desktop/standalone/engine/st/scripts/macros/engine/MacroCstWalker.js',
        'desktop/standalone/engine/st/scripts/macros/engine/MacroDiagnostics.js',
        'desktop/standalone/engine/st/scripts/macros/engine/MacroEngine.js',
        'desktop/standalone/engine/st/scripts/macros/engine/MacroEnvBuilder.js',
        'desktop/standalone/engine/st/scripts/macros/engine/MacroFlags.js',
        'desktop/standalone/engine/st/scripts/macros/engine/MacroLexer.js',
        'desktop/standalone/engine/st/scripts/macros/engine/MacroParser.js',
        'desktop/standalone/engine/st/scripts/macros/engine/MacroRegistry.js',
    ];
    for (const rel of deletedMacroFiles) {
        const full = path.join(ST_ROOT, 'extension/vc-model-settings', rel);
        assert.equal(fs.existsSync(full), false, `重复算法文件应已删除: ${rel}`);
        assert.equal(isWhitelistedExtensionModule(rel), false, `已删除文件不应留在白名单: ${rel}`);
    }
    const generatedDiagnosticsRel = 'desktop/locked-source/st/scripts/macros/engine/MacroDiagnostics.js';
    assert.equal(fs.existsSync(path.join(ST_ROOT, 'extension/vc-model-settings', generatedDiagnosticsRel)), true);
    assert.equal(isWhitelistedExtensionModule(generatedDiagnosticsRel), true);
    for (const fnName of [
        'createMacroRuntimeError',
        'logMacroRuntimeWarning',
        'logMacroInternalError',
        'logMacroRegisterWarning',
        'logMacroRegisterError',
        'logMacroGeneralError',
        'logMacroSyntaxWarning',
    ]) {
        assert.equal(typeof lockedMacroDiagnostics[fnName], 'function', `generated MacroDiagnostics must export ${fnName}`);
    }
    assert.equal('onboardingExperimentalMacroEngine' in lockedMacroDiagnostics, false, 'onboarding UI must not be selected into generated MacroDiagnostics');
});

test('T14-ST-2: 同一 MacroRegistry 单例及现代/legacy 双模式真实宏求值与宏标志', () => {
    const f = createMacroTestContext({ experimentalMacroEngine: true, firstDisplayedMessageId: 0, mobile: false });
    f.bind();
    stMacros.initMacros(f.eventSource);

    // 验证 MacrosParser 桥接与 substituteParams 共用 locked-source/st/scripts/macros/engine/MacroRegistry.js 同一实例
    assert.equal(lockedMacroSystem.macros.registry, lockedMacroRegistry.MacroRegistry);
    stMacros.MacrosParser.registerMacro('t14BridgeProbe', () => 'BRIDGE_OK', 'probe macro');
    try {
        assert.equal(lockedMacroRegistry.MacroRegistry.hasMacro('t14BridgeProbe'), true);
        assert.equal(stScript.substituteParams('{{t14BridgeProbe}}'), 'BRIDGE_OK');
    } finally {
        stMacros.MacrosParser.unregisterMacro('t14BridgeProbe');
    }
    assert.equal(lockedMacroRegistry.MacroRegistry.hasMacro('t14BridgeProbe'), false);

    // 现代引擎模式求值：环境、聊天、变量、核心、时间与条件/标志
    assert.equal(
        stScript.substituteParams('{{user}}|{{char}}|{{description}}|{{personality}}|{{scenario}}|{{persona}}|{{model}}'),
        '旅行者|艾莉丝|来自王都的魔法师|冷静、博学|高塔图书馆|勇敢的冒险者|claude-3-7-sonnet',
    );
    assert.equal(
        stScript.substituteParams('{{input}}|{{lastMessage}}|{{lastMessageId}}|{{lastUserMessage}}|{{lastCharMessage}}|{{currentSwipeId}}/{{lastSwipeId}}|{{allChatRange}}'),
        '测试输入框文本|第一条角色回复|1|第一条用户消息|第一条角色回复|2/3|0-1',
    );
    assert.equal(
        stScript.substituteParams('{{maxContext}}-{{maxResponse}}={{maxPrompt}}|{{outlet::testOutlet}}|{{reverse:ABC}}'),
        '4096-512=3584|OUTLET_VALUE_OK|CBA',
    );
    assert.equal(
        stScript.substituteParams('{{setvar::counter::10}}{{incvar::counter}}|{{.counter}}|{{setglobalvar::g_counter::3}}{{addglobalvar::g_counter::4}}{{$g_counter}}'),
        '11|11|7',
    );
    assert.equal(f.context.chatMetadata.variables.counter, 11);
    assert.equal(f.settings.extension_settings.variables.global.g_counter, 7);

    // 现代引擎宏标志（/ 闭合块默认自动 trim、# 保留空白标志）与 trim 宏
    assert.equal(
        stScript.substituteParams('{{setvar::scoped_trimmed}}\n  保留中心  \n{{/setvar}}{{#setvar::scoped_raw}}  保留空白  {{/setvar}}[{{.scoped_trimmed}}]|[{{.scoped_raw}}]'),
        '[保留中心]|[  保留空白  ]',
    );
    assert.equal(stScript.substituteParams('A\n{{trim}}\nB'), 'AB');

    // Legacy 模式求值
    f.settings.power_user.experimental_macro_engine = false;
    assert.equal(
        stScript.substituteParams('<USER>|<CHAR>|{{user}}|{{char}}|{{input}}|{{lastMessage}}|{{lastUserMessage}}|{{lastCharMessage}}|{{outlet::testOutlet}}|{{reverse:XYZ}}'),
        '旅行者|艾莉丝|旅行者|艾莉丝|测试输入框文本|第一条角色回复|第一条用户消息|第一条角色回复|OUTLET_VALUE_OK|ZYX',
    );
    assert.equal(
        stScript.substituteParams('{{setvar::leg_v::5}}{{addvar::leg_v::2}}{{getvar::leg_v}}|{{setglobalvar::leg_g::8}}{{decglobalvar::leg_g}}|{{getglobalvar::leg_g}}'),
        '7|7|7',
    );

    stMacros.disposeMacros(f.eventSource);
});

test('T14-ST-3: 真实两引擎 emitter 换绑与 disposeMacros 隔离（旧 engine 销毁不清空新 engine 状态，现代/legacy 同步）', async () => {
    const engine1 = createMacroTestContext({ experimentalMacroEngine: true });
    const engine2 = createMacroTestContext({ experimentalMacroEngine: true });

    // 1. 绑定 engine1 并触发 GENERATION_STARTED('swipe')
    engine1.bind();
    stMacros.initMacros(engine1.eventSource);
    assert.equal(stScript.substituteParams('{{lastGenerationType}}'), '');

    await engine1.eventSource.emit(stEvents.event_types.GENERATION_STARTED, 'swipe', {}, false);
    assert.equal(stScript.substituteParams('{{lastGenerationType}}'), 'swipe');
    engine1.settings.power_user.experimental_macro_engine = false;
    assert.equal(stScript.substituteParams('{{lastGenerationType}}'), 'swipe');
    engine1.settings.power_user.experimental_macro_engine = true;

    // dryRun 不应改写 lastGenerationType
    await engine1.eventSource.emit(stEvents.event_types.GENERATION_STARTED, 'impersonate', {}, true);
    assert.equal(stScript.substituteParams('{{lastGenerationType}}'), 'swipe');

    // 2. 切换到 engine2 并绑定新 emitter
    engine2.bind();
    stMacros.initMacros(engine2.eventSource);
    assert.equal(stScript.substituteParams('{{lastGenerationType}}'), '', '切换到新 emitter 后初始状态应重置为空');

    await engine2.eventSource.emit(stEvents.event_types.GENERATION_STARTED, 'continue', {}, false);
    assert.equal(stScript.substituteParams('{{lastGenerationType}}'), 'continue');

    // 3. 旧 emitter1 的事件与迟到 disposeMacros(engine1.eventSource) 均不得影响 engine2
    await engine1.eventSource.emit(stEvents.event_types.GENERATION_STARTED, 'quiet', {}, false);
    await engine1.eventSource.emit(stEvents.event_types.CHAT_CHANGED);
    assert.equal(stScript.substituteParams('{{lastGenerationType}}'), 'continue');

    stMacros.disposeMacros(engine1.eventSource);
    assert.equal(stScript.substituteParams('{{lastGenerationType}}'), 'continue', '旧 engine 销毁不得清空新 engine 的 lastGenerationType');
    engine2.settings.power_user.experimental_macro_engine = false;
    assert.equal(stScript.substituteParams('{{lastGenerationType}}'), 'continue', 'legacy 模式下新 engine 状态同样保持');
    engine2.settings.power_user.experimental_macro_engine = true;

    // 4. 真实锁定 EventEmitter.makeFirst gate 回归：
    // 旧 emitter 已快照 listeners 并阻塞在前置异步回调时，切绑新 emitter 并 dispose 旧 emitter；
    // 释放 gate 后旧快照回调不得覆写新 emitter 的 lastGenerationType。
    const engine3 = createMacroTestContext({ experimentalMacroEngine: true });
    let releaseSwipeGate;
    const swipeGate = new Promise(resolve => {
        releaseSwipeGate = resolve;
    });
    engine2.eventSource.makeFirst(stEvents.event_types.GENERATION_STARTED, () => swipeGate);
    const pendingOldSwipe = engine2.eventSource.emit(stEvents.event_types.GENERATION_STARTED, 'swipe', {}, false);

    engine3.bind();
    stMacros.initMacros(engine3.eventSource);
    stMacros.disposeMacros(engine2.eventSource);

    await engine3.eventSource.emit(stEvents.event_types.GENERATION_STARTED, 'continue', {}, false);
    assert.equal(stScript.substituteParams('{{lastGenerationType}}'), 'continue');

    releaseSwipeGate();
    await pendingOldSwipe;
    assert.equal(
        stScript.substituteParams('{{lastGenerationType}}'),
        'continue',
        '旧 emitter 在 await 前快照的 GENERATION_STARTED 回调释放后不得覆写新 emitter 状态',
    );
    engine3.settings.power_user.experimental_macro_engine = false;
    assert.equal(stScript.substituteParams('{{lastGenerationType}}'), 'continue');
    engine3.settings.power_user.experimental_macro_engine = true;

    // 5. 新 emitter3 自身 CHAT_CHANGED 与 disposeMacros 正常工作
    await engine3.eventSource.emit(stEvents.event_types.CHAT_CHANGED);
    assert.equal(stScript.substituteParams('{{lastGenerationType}}'), '');

    await engine3.eventSource.emit(stEvents.event_types.GENERATION_STARTED, 'regenerate', {}, false);
    assert.equal(stScript.substituteParams('{{lastGenerationType}}'), 'regenerate');

    stMacros.disposeMacros(engine3.eventSource);
    assert.equal(stScript.substituteParams('{{lastGenerationType}}'), '');
});

test('T14-ST-4: readFirstDisplayedMessageId 窗口 getter（未挂载 null / 挂载后动态窗口索引）与 findExtension 真实运行状态消费', () => {
    let mountedWindowFirstId = null;
    let enabledList = [
        { name: 'third-party/JS-Slash-Runner', enabled: true },
        { name: 'third-party/ST-Prompt-Template', enabled: true },
        { name: 'CustomMemoryExt', enabled: true },
    ];

    const f = createMacroTestContext({
        experimentalMacroEngine: true,
        readFirstDisplayedMessageId: () => mountedWindowFirstId,
        getEnabledExtensions: () => enabledList,
    });
    f.bind();
    stMacros.initMacros(f.eventSource);

    // 1. MessageList 未挂载时返回 null，宏展开为空串
    assert.equal(enginePorts.readFirstDisplayedMessageId(), null);
    assert.equal(stScript.substituteParams('{{firstDisplayedMessageId}}'), '');
    f.settings.power_user.experimental_macro_engine = false;
    assert.equal(stScript.substituteParams('{{firstDisplayedMessageId}}'), '');

    // 2. MessageList 挂载并随 80 条窗口滚动更新首条索引
    mountedWindowFirstId = 20;
    f.settings.power_user.experimental_macro_engine = true;
    assert.equal(enginePorts.readFirstDisplayedMessageId(), 20);
    assert.equal(stScript.substituteParams('{{firstDisplayedMessageId}}'), '20');
    f.settings.power_user.experimental_macro_engine = false;
    assert.equal(stScript.substituteParams('{{firstDisplayedMessageId}}'), '20');

    mountedWindowFirstId = 0;
    f.settings.power_user.experimental_macro_engine = true;
    assert.equal(enginePorts.readFirstDisplayedMessageId(), 0);
    assert.equal(stScript.substituteParams('{{firstDisplayedMessageId}}'), '0');

    // 3. findExtension 与 {{hasExtension::...}} 动态读取真实已加载与启用状态
    assert.equal(stScript.substituteParams('{{hasExtension::JS-Slash-Runner}}|{{hasExtension::third-party/JS-Slash-Runner}}|{{hasExtension::CustomMemoryExt}}|{{hasExtension::UnknownExt}}'), 'true|true|true|false');

    // disabledExtensions 禁用 CustomMemoryExt
    f.settings.extension_settings.disabledExtensions = ['custommemoryext'];
    assert.equal(enginePorts.findExtension('CustomMemoryExt'), undefined);
    assert.equal(stScript.substituteParams('{{hasExtension::CustomMemoryExt}}'), 'false');

    // R1 契约：tavern_helper.script.enabled.global=false 仅跳过全局脚本组，角色/预设脚本仍按名单运行，Helper 扩展整体仍为启用
    f.settings.extension_settings.tavern_helper.script.enabled.global = false;
    f.settings.extension_settings.tavern_helper.script.enabled.characters = ['macro-char.png'];
    assert.deepEqual(enginePorts.findExtension('JS-Slash-Runner'), {
        name: 'third-party/JS-Slash-Runner',
        enabled: true,
    });
    assert.equal(stScript.substituteParams('{{hasExtension::JS-Slash-Runner}}'), 'true');

    // tavern_helper.enabled=false 或总体 enable_extensions=false 时视为未启用
    f.settings.extension_settings.tavern_helper.enabled = false;
    assert.equal(enginePorts.findExtension('JS-Slash-Runner'), undefined);
    assert.equal(stScript.substituteParams('{{hasExtension::JS-Slash-Runner}}'), 'false');

    f.settings.extension_settings.tavern_helper.enabled = true;
    f.environment.packet.enable_extensions = false;
    assert.equal(enginePorts.findExtension('JS-Slash-Runner'), undefined);
    assert.equal(stScript.substituteParams('{{hasExtension::JS-Slash-Runner}}'), 'false');

    stMacros.disposeMacros(f.eventSource);
});

test('T14-ST-5: 诊断脱敏（variables.js 删除不存在变量、EventEmitter 异常/tracing、宏错误均不向 console 泄露键名/输入/stack）与端口标脏', async () => {
    const f = createMacroTestContext({ experimentalMacroEngine: true, input: 'SECRET_USER_INPUT_7788' });
    f.bind();
    stMacros.initMacros(f.eventSource);

    const leakedLogs = [];
    const origConsole = {
        log: console.log,
        info: console.info,
        warn: console.warn,
        error: console.error,
        debug: console.debug,
        trace: console.trace,
    };
    for (const method of Object.keys(origConsole)) {
        console[method] = (...args) => {
            leakedLogs.push({ method, text: args.map(a => (a instanceof Error ? `${a.message}\n${a.stack}` : String(a))).join(' ') });
        };
    }

    try {
        // 1. variables.js 删除不存在的变量（对应 /flushvar nonexistent_key）不得向全局 console.warn 泄露变量名
        f.context.metadataDirty = false;
        f.context.settingsDirty = false;
        stVariables.deleteLocalVariable('SECRET_NONEXISTENT_LOCAL_KEY');
        stVariables.deleteGlobalVariable('SECRET_NONEXISTENT_GLOBAL_KEY');
        assert.equal(f.context.metadataDirty, false);
        assert.equal(f.context.settingsDirty, false);

        // 存在的变量设置与删除走 engine/ports saveMetadataDebounced / saveSettingsDebounced 标脏
        stVariables.setLocalVariable('existing_local', 'v1');
        assert.equal(f.context.metadataDirty, true);
        f.context.metadataDirty = false;
        stVariables.deleteLocalVariable('existing_local');
        assert.equal(f.context.metadataDirty, true);

        stVariables.setGlobalVariable('existing_global', 'g1');
        assert.equal(f.context.settingsDirty, true);
        f.context.settingsDirty = false;
        stVariables.deleteGlobalVariable('existing_global');
        assert.equal(f.context.settingsDirty, true);

        // 2. EventEmitter 开启 eventTracing 且监听器抛错，不得泄露事件参数与错误 stack
        localStorage.setItem('eventTracing', 'true');
        const emitter = new engineEvents.EventEmitter();
        emitter.on('secret_event', () => {
            throw new Error('SECRET_LISTENER_ERROR_STACK');
        });
        await emitter.emit('secret_event', 'SECRET_EVENT_ARG_PAYLOAD');
        emitter.emitAndWait('secret_event', 'SECRET_EVENT_ARG_PAYLOAD');

        // 3. 宏求值异常与未知标志不得向全局 console 泄露原文、变量名或 stack；直接调用生成的 MacroDiagnostics.logMacro* 同样走 quietConsole
        const runtimeErr = lockedMacroDiagnostics.createMacroRuntimeError({
            message: 'Arity mismatch',
            call: { name: '  customCallName  ', range: { startOffset: 1, endOffset: 5 }, rawInner: 'SECRET_MACRO_DIAG_PAYLOAD' },
        });
        assert.equal(runtimeErr.name, 'MacroRuntimeError');
        assert.equal(runtimeErr.isMacroRuntimeError, true);
        assert.equal(runtimeErr.macroName, 'customCallName');
        assert.deepEqual(runtimeErr.macroRange, { startOffset: 1, endOffset: 5 });

        lockedMacroDiagnostics.logMacroRuntimeWarning({
            message: 'SECRET_MACRO_DIAG_PAYLOAD',
            call: { name: 'secretMacro', rawInner: 'SECRET_MACRO_DIAG_PAYLOAD' },
        });
        lockedMacroDiagnostics.logMacroInternalError({
            message: 'SECRET_MACRO_DIAG_PAYLOAD',
            macroName: 'secretMacro',
            error: new Error('SECRET_MACRO_DIAG_PAYLOAD'),
        });
        lockedMacroDiagnostics.logMacroRegisterWarning({ message: 'SECRET_MACRO_DIAG_PAYLOAD', macroName: 'secretMacro' });
        lockedMacroDiagnostics.logMacroRegisterError({ message: 'SECRET_MACRO_DIAG_PAYLOAD', macroName: 'secretMacro' });
        lockedMacroDiagnostics.logMacroGeneralError({ message: 'SECRET_MACRO_DIAG_PAYLOAD', error: new Error('SECRET_MACRO_DIAG_PAYLOAD') });
        lockedMacroDiagnostics.logMacroSyntaxWarning({
            phase: 'lexing',
            input: 'SECRET_MACRO_SYNTAX_INPUT',
            errors: [{ message: 'lex err', line: 1, column: 1, length: 3 }],
        });

        stMacros.MacrosParser.registerMacro('throwingMacro', () => {
            throw new Error('SECRET_MACRO_HANDLER_STACK');
        });
        stScript.substituteParams('{{throwingMacro}} {{banned "SECRET_BANNED_WORD"}}');
        f.settings.power_user.experimental_macro_engine = false;
        stScript.substituteParams('{{throwingMacro}} {{banned "SECRET_BANNED_WORD"}}');
    } finally {
        Object.assign(console, origConsole);
        localStorage.removeItem('eventTracing');
        stMacros.disposeMacros(f.eventSource);
    }

    const combined = leakedLogs.map(item => item.text).join('\n');
    for (const secret of [
        'SECRET_NONEXISTENT_LOCAL_KEY',
        'SECRET_NONEXISTENT_GLOBAL_KEY',
        'SECRET_LISTENER_ERROR_STACK',
        'SECRET_EVENT_ARG_PAYLOAD',
        'SECRET_MACRO_HANDLER_STACK',
        'SECRET_MACRO_DIAG_PAYLOAD',
        'SECRET_MACRO_SYNTAX_INPUT',
        'SECRET_BANNED_WORD',
        'SECRET_USER_INPUT_7788',
    ]) {
        assert.equal(combined.includes(secret), false, `console 不得泄露敏感内容: ${secret}`);
    }
    assert.deepEqual(leakedLogs, [], '受控引擎与宏诊断必须走 quietConsole，不向全局 console 输出');
});
