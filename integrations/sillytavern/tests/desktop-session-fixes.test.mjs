import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Window } from 'happy-dom';

const sourceIdentityUrl = new URL('../server-plugin/virtual-companion/lib/source-identity.js', import.meta.url).href;

registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === '/lib.js') {
            return { url: 'virtual:///lib.js', shortCircuit: true };
        }
        if (specifier === '/scripts/extensions/third-party/ST-Prompt-Template/dist/desktop.js') {
            return { url: 'virtual:///ejs-desktop.js', shortCircuit: true };
        }
        if (specifier === '/scripts/vc-runtime/source-identity.js') {
            return { url: sourceIdentityUrl, shortCircuit: true };
        }
        return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
        if (url === 'virtual:///lib.js') {
            return {
                format: 'module',
                shortCircuit: true,
                source: `
                    function chain(obj) {
                        let current = obj;
                        return {
                            merge(...sources) {
                                Object.assign(current, ...sources);
                                return this;
                            },
                            value() {
                                return current;
                            },
                        };
                    }
                    export const lodash = Object.assign(chain, {
                        get(obj, path, def) {
                            if (!obj) return def;
                            const parts = Array.isArray(path) ? path : String(path).split('.');
                            let cur = obj;
                            for (const p of parts) {
                                if (cur == null) return def;
                                cur = cur[p];
                            }
                            return cur === undefined ? def : cur;
                        },
                        set(obj, path, value) {
                            const parts = Array.isArray(path) ? path : String(path).split('.');
                            let cur = obj;
                            for (let i = 0; i < parts.length - 1; i++) {
                                const p = parts[i];
                                if (cur[p] == null || typeof cur[p] !== 'object') cur[p] = {};
                                cur = cur[p];
                            }
                            cur[parts[parts.length - 1]] = value;
                            return obj;
                        },
                        has(obj, key) {
                            return Boolean(obj && key in obj);
                        },
                        pick(obj, keys) {
                            const out = {};
                            for (const k of keys) if (obj && k in obj) out[k] = obj[k];
                            return out;
                        },
                        omit(obj, keys) {
                            const set = new Set(Array.isArray(keys) ? keys : [keys]);
                            const out = {};
                            for (const [k, v] of Object.entries(obj || {})) if (!set.has(k)) out[k] = v;
                            return out;
                        },
                        omitBy(obj, predicate) {
                            const out = {};
                            for (const [k, v] of Object.entries(obj || {})) {
                                if (!predicate(v, k)) out[k] = v;
                            }
                            return out;
                        },
                        isEqual(a, b) {
                            return JSON.stringify(a) === JSON.stringify(b);
                        },
                        cloneDeep(v) {
                            return structuredClone(v);
                        },
                    });
                    export const yaml = { parse: JSON.parse, stringify: JSON.stringify };
                    export const showdown = {
                        Converter: class {
                            addExtension() {}
                            makeHtml(t) {
                                const s = String(t ?? '');
                                if (s.includes('html>')) {
                                    const escaped = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                                    return '<pre><code>' + escaped + '</code></pre>';
                                }
                                return s;
                            }
                        },
                    };
                    export const hljs = { highlightElement() {} };
                    export const DOMPurify = { sanitize: s => String(s ?? ''), addHook() {} };
                    export const css = { parse() { return {}; }, stringify() { return ''; } };
                    export const chevrotain = { createToken: cfg => ({ ...cfg, name: cfg?.name }), Lexer: class { static SKIPPED = 'SKIPPED'; }, CstParser: class { RULE(n, fn) { return fn; } performSelfAnalysis() {} } };
                    export const moment = () => ({ format: () => '', valueOf: () => 0 });
                    export const seedrandom = () => () => 0.5;
                    export const droll = { roll: () => ({ total: 1 }) };
                    export const Handlebars = { compile: () => () => '' };
                    export const Bowser = { getParser: () => ({ getBrowserName: () => 'Chrome' }) };
                `,
            };
        }
        if (url === 'virtual:///ejs-desktop.js') {
            return {
                format: 'module',
                shortCircuit: true,
                source: `
                    export async function initializeDesktop() {
                        const schema = {
                            any: () => schema,
                            string: () => schema,
                            number: () => schema,
                            boolean: () => schema,
                            array: () => schema,
                            object: () => schema,
                            enum: () => schema,
                            optional: () => schema,
                            nullable: () => schema,
                            default: () => schema,
                            describe: () => schema,
                            passthrough: () => schema,
                            union: () => schema,
                            record: () => schema,
                            literal: () => schema,
                            tuple: () => schema,
                            function: () => ({ args: () => ({ returns: () => ({ implement: fn => fn }) }), implement: fn => fn }),
                             parse: v => v,
                            safeParse: v => ({ success: true, data: v }),
                        };
                        return {
                            z: schema,
                            settings: {},
                            async render() {},
                        };
                    }
                `,
            };
        }
        return nextLoad(url, context);
    },
});

const happyWindow = new Window({ url: 'http://localhost:8000/desktop/' });
Object.assign(globalThis, {
    window: happyWindow,
    document: happyWindow.document,
    location: happyWindow.location,
    localStorage: happyWindow.localStorage,
    HTMLElement: happyWindow.HTMLElement,
    CustomEvent: happyWindow.CustomEvent,
    Event: happyWindow.Event,
    MutationObserver: happyWindow.MutationObserver,
    requestAnimationFrame: cb => setTimeout(cb, 0),
    jQuery: Object.assign(() => ({ triggerHandler: async () => {}, off: () => {} }), { ui: {} }),
    toastr: { info() {}, warning() {}, error() {}, success() {} },
});
test.after(() => happyWindow.happyDOM.close());

const { createDesktopSession } = await import('../extension/vc-model-settings/desktop/standalone/session.js');
const { EventEmitter } = await import('../extension/vc-model-settings/desktop/standalone/engine/events.js');
const { event_types } = await import('../extension/vc-model-settings/desktop/standalone/engine/st/events.js');
const { prepareSourceIdentities } = await import('../server-plugin/virtual-companion/lib/source-identity.js');
const { initializeCards } = await import('../extension/vc-model-settings/desktop/standalone/cards/index.js');
const books = await import('../extension/vc-model-settings/desktop/standalone/cards/helper-worldbook.js');
const { bindCardHost, getCardHost } = await import('../extension/vc-model-settings/desktop/standalone/cards/ejs-host.js');
const { bindEngineContext } = await import('../extension/vc-model-settings/desktop/standalone/engine/ports.js');

const deferred = () => {
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
};

function createSessionFixture({
    firstMes = '',
    save,
    saveSettings,
    shouldAutoContinue,
    cardsOpen,
} = {}) {
    const card = {
        avatar: 'synthetic.png',
        name: '合成角色',
        first_mes: firstMes,
        data: { extensions: { vc_character_ref: 'synthetic-ref' } },
    };
    const context = {
        characters: [card],
        chat: [],
        chatMetadata: {},
        extensionPrompts: {},
        eventSource: new EventEmitter(),
        eventTypes: event_types,
    };
    const binding = id => ({
        characterRef: 'synthetic-ref',
        chatIdentity: id,
        relationshipId: '1',
        conversationId: id,
        mode: 'COMPANION',
    });
    const records = (id, withHistory = true) => [
        {
            user_name: 'unused',
            character_name: 'unused',
            chat_metadata: {
                integrity: 'synthetic-integrity',
                vc_f2: { id, revision: 1 },
                vc_binding: binding(id),
            },
        },
        ...(withHistory ? [{ name: card.name, mes: '合成历史', is_user: false }] : []),
    ];
    const sent = [], settingsSaves = [], states = [];
    let generations = 0;
    const client = {
        request: async path => (path === '/api/avatars/get' ? [] : structuredClone(card)),
        post: async () => new Response('{}'),
        saveSettings: async payload => {
            const value = typeof payload === 'function' ? payload() : payload;
            settingsSaves.push(structuredClone(value));
            if (saveSettings) return saveSettings(value);
            return new Response('{}');
        },
        settingsChanged: () => false,
        async raw(path, serialized) {
            const body = JSON.parse(serialized);
            sent.push(body);
            if (save) return save(body);
            return new Response(
                JSON.stringify({
                    vc_f2: {
                        ...body.chat[0].chat_metadata.vc_f2,
                        revision: body.chat[0].chat_metadata.vc_f2.revision + 1,
                    },
                }),
            );
        },
        async generate() {
            generations++;
            return new Response('{}');
        },
    };
    const engine = {
        settings: {
            username: '合成用户',
            user_avatar: '',
            power_user: { personas: {}, persona_descriptions: {} },
            oai_settings: {},
            extension_settings: {},
        },
        bindContext() {},
        settingsForSave() {
            return this.settings;
        },
        firstMessage() {
            return card.first_mes ? { name: card.name, is_user: false, is_system: false, mes: card.first_mes, extra: {} } : null;
        },
        userMessage: async text => ({ message: { name: context.name1, mes: text, is_user: true, extra: {} }, bias: {} }),
        async prepare() {
            return { body: { model: 'synthetic', chat_completion_source: 'custom' } };
        },
        cleanResponse: text => text,
        memory: { finalStatus() {} },
        generateHelper: async () => '合成脚本回复',
        shouldAutoContinue,
        cards: cardsOpen ? { open: cardsOpen, async settle() {}, async closeScripts() {}, surface: { async refresh() {} } } : undefined,
    };
    const session = createDesktopSession({
        client,
        context,
        engine,
        prepareSourceIdentities,
        choosePersona: async () => '',
        resolveBinding: async value => ({ ...binding(value.chatIdentity), mode: value.mode }),
        reconcileSources: async () => [],
        onChange: value => states.push(value),
        readResponse: async (_response, { onUpdate }) => {
            const result = { text: '合成回复', state: { reasoning: '' }, swipes: [], toolCalls: [], finishReason: 'stop' };
            await onUpdate(result);
            return result;
        },
    });
    return {
        session,
        context,
        engine,
        client,
        sent,
        settingsSaves,
        states,
        records,
        get generations() {
            return generations;
        },
    };
}

test('B1: 空会话开场白在 CHAT_CHANGED 与 cards.open 之前写入 context.chat，真实空 MVU 卡不死等不存在的消息楼层', async () => {
    const order = [];
    const f = createSessionFixture({
        firstMes: '合成开场白',
        cardsOpen: async () => {
            order.push({ step: 'cards.open', len: f.context.chat.length, first: f.context.chat[0]?.mes });
        },
    });
    f.context.eventSource.on(event_types.CHAT_CHANGED, () => {
        order.push({ step: 'CHAT_CHANGED', len: f.context.chat.length, first: f.context.chat[0]?.mes });
    });

    await f.session.activate({ avatar: 'synthetic.png', file: 'empty-with-greeting' }, f.records('empty-with-greeting', false));

    assert.equal(order.length, 2);
    assert.deepEqual(order[0], { step: 'CHAT_CHANGED', len: 1, first: '合成开场白' });
    assert.deepEqual(order[1], { step: 'cards.open', len: 1, first: '合成开场白' });
    assert.equal(f.sent.length, 1);
    assert.equal(f.sent[0].chat.at(-1).mes, '合成开场白');

    // B1(b): 真实空 MVU 卡（无开场白，context.chat 为空）在 Mvu 初始化后立即完成 open，不等待不存在的楼层变量
    const prevFetch = globalThis.fetch;
    globalThis.fetch = async url => {
        if (String(url).endsWith('/version')) {
            return new Response(JSON.stringify({ pkgVersion: '1.12.0' }));
        }
        return new Response('{}');
    };
    try {
        const mvuCard = {
            avatar: 'mvu-empty.png',
            name: '空MVU角色',
            first_mes: '',
            data: {
                extensions: {
                    tavern_helper: {
                        scripts: [
                            {
                                type: 'script',
                                id: 'mvu-script-1',
                                name: 'MVU',
                                enabled: true,
                                content: "import '/user/files/mvu-bundle-d03b7dc8.js'",
                                button: { enabled: false, buttons: [] },
                            },
                        ],
                    },
                },
            },
        };
        const mvuContext = {
            characters: [mvuCard],
            characterId: 0,
            chat: [],
            chatMetadata: { vc_f2: { id: 'mvu-empty', revision: 1 } },
            eventSource: new EventEmitter(),
            eventTypes: event_types,
            saveSettingsDebounced() {},
            saveMetadataDebounced() {},
            saveChatConditional() {},
        };
        const mvuSettings = {
            oai_settings: { preset_settings_openai: 'Default' },
            power_user: {},
            world_info: { globalSelect: [] },
            extension_settings: {
                tavern_helper: {
                    script: { enabled: { global: true, presets: [], characters: ['mvu-empty.png'] }, scripts: [] },
                },
            },
        };
        bindEngineContext(mvuContext, mvuSettings, {});
        const cards = await initializeCards({
            context: mvuContext,
            settings: mvuSettings,
            packet: { world_names: [] },
            presets: {},
            client: { headers: () => ({}), post: async () => new Response('{}') },
        });
        setTimeout(() => {
            globalThis.Mvu = { ready: true };
        }, 20);
        const start = Date.now();
        await cards.open();
        assert.ok(Date.now() - start < 1000, '空 MVU 卡在 Mvu 就绪后应立即完成，不超时等待楼层变量');
        await cards.closeScripts();
    } finally {
        globalThis.fetch = prevFetch;
    }
});

test('B2: helper-worldbook 导出并暴露 setLorebookSettings，校验未知世界书并同步更新宿主设置', async () => {
    assert.equal(typeof books.setLorebookSettings, 'function', 'helper-worldbook 必须导出 setLorebookSettings');
    assert.equal(typeof globalThis.TavernHelper?.setLorebookSettings, 'function', 'TavernHelper 必须暴露 setLorebookSettings');

    let savedSettingsCount = 0;
    const hostContext = {
        characters: [{ avatar: 'synthetic.png', name: '合成角色', data: { extensions: {} } }],
        characterId: 0,
        chat: [],
        chatMetadata: {},
        eventSource: new EventEmitter(),
        eventTypes: event_types,
        saveSettingsDebounced() {
            savedSettingsCount++;
        },
    };
    const hostSettings = {
        world_info: { globalSelect: ['全局书A'] },
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
        oai_settings: {},
        power_user: {},
        extension_settings: {},
    };
    bindCardHost({
        context: hostContext,
        settings: hostSettings,
        packet: { world_names: ['全局书A', '全局书B'] },
        presets: {},
        client: { headers: () => ({}), post: async () => new Response('{}') },
        surface: { format() {}, async refresh() {}, codeBlocks() {}, media() {}, reasoning() {} },
    });

    assert.throws(
        () => books.setLorebookSettings({ selected_global_lorebooks: ['不存在的世界书'] }),
        /未找到以下世界书/,
    );

    books.setLorebookSettings({
        selected_global_lorebooks: ['全局书B'],
        scan_depth: 6,
        context_percentage: 40,
        budget_cap: 2048,
        min_activations: 2,
        max_depth: 10,
        max_recursion_steps: 4,
        insertion_strategy: 'character_first',
        include_names: false,
        recursive: false,
        case_sensitive: true,
        match_whole_words: true,
        use_group_scoring: true,
        overflow_alert: true,
    });

    const updated = getCardHost().settings;
    assert.deepEqual(updated.world_info.globalSelect, ['全局书B']);
    assert.equal(updated.world_info_depth, 6);
    assert.equal(updated.world_info_budget, 40);
    assert.equal(updated.world_info_budget_cap, 2048);
    assert.equal(updated.world_info_min_activations, 2);
    assert.equal(updated.world_info_min_activations_depth_max, 10);
    assert.equal(updated.world_info_max_recursion_steps, 4);
    assert.equal(updated.world_info_character_strategy, 1);
    assert.equal(updated.world_info_include_names, false);
    assert.equal(updated.world_info_recursive, false);
    assert.equal(updated.world_info_case_sensitive, true);
    assert.equal(updated.world_info_match_whole_words, true);
    assert.equal(updated.world_info_use_group_scoring, true);
    assert.equal(updated.world_info_overflow_alert, true);
    assert.equal(savedSettingsCount, 1);
});

test('B3: 保存在途期间的新 metadata 修改保持脏标记并按序落盘，cards.open 期间的 setLorebookSettings 在激活完成前保存', async () => {
    const firstSaveStarted = deferred();
    const allowFirstSaveFinish = deferred();
    const secondSaveStarted = deferred();
    const allowSecondSaveFinish = deferred();
    let saveCalls = 0;

    const f = createSessionFixture({
        cardsOpen: async () => {
            f.context.saveSettingsDebounced();
        },
        save: async body => {
            saveCalls++;
            if (saveCalls === 1) {
                firstSaveStarted.resolve();
                await allowFirstSaveFinish.promise;
            } else if (saveCalls === 2) {
                secondSaveStarted.resolve();
                await allowSecondSaveFinish.promise;
            }
            return new Response(
                JSON.stringify({
                    vc_f2: {
                        ...body.chat[0].chat_metadata.vc_f2,
                        revision: body.chat[0].chat_metadata.vc_f2.revision + 1,
                    },
                }),
            );
        },
    });

    await f.session.activate({ avatar: 'synthetic.png', file: 'b3-dirty' }, f.records('b3-dirty'));
    assert.equal(f.settingsSaves.length, 1, 'cards.open 期间产生的 settingsDirty 在 activate 完成前必须落盘');
    assert.equal(f.context.settingsDirty, false);

    f.context.chatMetadata.note = 'v1';
    f.context.metadataDirty = true;
    const inflightSave = f.session.save();
    await firstSaveStarted.promise;

    // 在第一次保存尚未返回时，卡片/会话又产生了新的 metadata 修改
    f.context.chatMetadata.note = 'v2';
    f.context.saveMetadataDebounced();

    allowFirstSaveFinish.resolve();
    await inflightSave;

    assert.equal(f.context.metadataDirty, true, '在途保存期间产生的新修改不能被旧保存完成清除脏状态');
    await secondSaveStarted.promise;
    allowSecondSaveFinish.resolve();
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(f.sent.length, 2, '同一 F2 队列应继续提交第二次修改');
    assert.equal(f.sent.at(-1).chat[0].chat_metadata.note, 'v2');
    assert.equal(f.context.metadataDirty, false);
});

test('B4: stop 覆盖 shouldAutoContinue 等待阶段，且多轮自动续写整条链只发一次 GENERATION_ENDED', async () => {
    let autoRound = 0;
    let endedEvents = 0;
    const f1 = createSessionFixture({
        shouldAutoContinue: async () => ++autoRound === 1,
    });
    f1.context.eventSource.on(event_types.GENERATION_ENDED, () => {
        endedEvents++;
    });

    await f1.session.activate({ avatar: 'synthetic.png', file: 'b4-chain' }, f1.records('b4-chain'));
    assert.equal(await f1.session.send('触发自动续写'), true);
    assert.equal(f1.generations, 2);
    assert.equal(endedEvents, 1, '多轮自动续写整条生成链只应触发一次 GENERATION_ENDED');

    // 在 shouldAutoContinue 等待期间调用 stop()，不应进入第二轮生成
    const autoCheckEntered = deferred();
    const allowAutoCheckFinish = deferred();
    let seenSignal;
    const f2 = createSessionFixture({
        shouldAutoContinue: async (_reply, options) => {
            seenSignal = options?.signal;
            autoCheckEntered.resolve();
            await allowAutoCheckFinish.promise;
            return true;
        },
    });
    await f2.session.activate({ avatar: 'synthetic.png', file: 'b4-stop' }, f2.records('b4-stop'));
    const sendPromise = f2.session.send('测试停止续写');
    await autoCheckEntered.promise;

    const stopPromise = f2.session.stop();
    allowAutoCheckFinish.resolve();
    await Promise.all([sendPromise, stopPromise]);

    assert.equal(f2.generations, 1, 'stop 后绝不能继续发起第二轮自动续写生成');
    assert.equal(seenSignal?.aborted, true, 'shouldAutoContinue 应收到被 abort 的 signal');
});

test('B6: frameElement 为 null 或通过 iframe window.TavernHelper 调用均受 VC_STALE_CARD_RUNTIME 守卫保护', async () => {
    const prevFetch = globalThis.fetch;
    globalThis.fetch = async url => {
        if (String(url).endsWith('/version')) {
            return new Response(JSON.stringify({ pkgVersion: '1.12.0' }));
        }
        return new Response('{}');
    };
    try {
        if (!globalThis.TavernHelper) {
            const ctx = {
                characters: [{ avatar: 'synthetic.png', name: '合成角色', data: { extensions: {} } }],
                characterId: 0,
                chat: [],
                chatMetadata: {},
                eventSource: new EventEmitter(),
                eventTypes: event_types,
                saveSettingsDebounced() {},
                saveMetadataDebounced() {},
                saveChatConditional() {},
            };
            const settings = {
                oai_settings: { preset_settings_openai: 'Default' },
                power_user: {},
                world_info: { globalSelect: [] },
                extension_settings: {},
            };
            await initializeCards({
                context: ctx,
                settings,
                packet: { world_names: [] },
                presets: {},
                client: { headers: () => ({}), post: async () => new Response('{}') },
            });
        }

        assert.throws(
            () => globalThis.TavernHelper._bind._getVariables.call({ frameElement: null }, { type: 'chat' }),
            err => err?.message === 'VC_STALE_CARD_RUNTIME',
            'frameElement 为 null 时必须抛出 VC_STALE_CARD_RUNTIME 而不是 TypeError',
        );

        const predefineCode = readFileSync(
            new URL('../extension/vc-model-settings/desktop/standalone/cards/predefine.js', import.meta.url),
            'utf8',
        );
        const fakeFrame = happyWindow.document.createElement('iframe');
        fakeFrame.id = 'TH-message--0--0';
        const iframeWindow = {
            parent: globalThis,
            frameElement: fakeFrame,
            name: 'TH-message--0--0',
            $: () => ({ on() {} }),
        };
        iframeWindow.window = iframeWindow;
        vm.runInNewContext(predefineCode, iframeWindow);

        assert.throws(
            () => iframeWindow.getVariables({ type: 'chat' }),
            err => err?.message === 'VC_STALE_CARD_RUNTIME',
            '旧 iframe 顶层 getVariables 必须抛出 VC_STALE_CARD_RUNTIME',
        );
        assert.throws(
            () => iframeWindow.TavernHelper.getVariables({ type: 'chat' }),
            err => err?.message === 'VC_STALE_CARD_RUNTIME',
            '旧 iframe 经 window.TavernHelper.getVariables 调用也必须抛出 VC_STALE_CARD_RUNTIME',
        );
    } finally {
        globalThis.fetch = prevFetch;
    }
});

test('B12: 稳定消息 key 保存在 Session 只读快照且不向 F2 提交包写入 UI 字段；删除前序消息后 cards.renderMessage 迁移楼层并保留 iframe', async () => {
    const f = createSessionFixture();
    const initialRecords = [
        f.records('b12-test')[0],
        { name: '合成角色', mes: '第0层消息', is_user: false, send_date: '2026-11-04T00:00:00.000Z' },
        { name: '合成角色', mes: '```html\n<html><body><div>卡片楼层</div></body></html>\n```', is_user: false, send_date: '2026-11-04T00:01:00.000Z' },
    ];
    await f.session.activate({ avatar: 'synthetic.png', file: 'b12-test' }, initialRecords);

    // 原始消息在未触发保存前不应被塞入 UI 字段或提前改写 vc_message_id
    assert.equal('id' in f.context.chat[0], false);
    assert.equal('vc_message_id' in f.context.chat[0], false);

    const keysBefore = f.states.at(-1).messageKeys;
    assert.equal(keysBefore.length, 2);
    const secondKeyBefore = keysBefore[1];

    const prevFetch = globalThis.fetch;
    globalThis.fetch = async url => {
        if (String(url).endsWith('/version')) {
            return new Response(JSON.stringify({ pkgVersion: '1.12.0' }));
        }
        return new Response('{}');
    };
    try {
        const cardSettings = {
            oai_settings: { preset_settings_openai: 'Default' },
            power_user: {
                reasoning: { prefix: '', suffix: '' },
                context: {},
                external_media_allowed_overrides: [],
                external_media_forbidden_overrides: [],
            },
            world_info: { globalSelect: [] },
            extension_settings: {
                disabledExtensions: [],
                tavern_helper: { render: { enabled: true, depth: 0, allow_streaming: true } },
            },
        };
        bindEngineContext(f.context, cardSettings, {});
        const cards = await initializeCards({
            context: f.context,
            settings: cardSettings,
            packet: { world_names: [] },
            presets: {},
            client: { headers: () => ({}), post: async () => new Response('{}') },
            callGenericPopup: async () => 1,
        });
        await cards.open();

        const host0 = happyWindow.document.createElement('div');
        const host1 = happyWindow.document.createElement('div');
        happyWindow.document.body.append(host0, host1);

        const cleanup0 = cards.renderMessage(host0, 0, f.context.chat[0], false);
        cards.renderMessage(host1, 1, f.context.chat[1], true);
        const streamFrame = host1.querySelector('iframe');
        assert.equal(Boolean(streamFrame), true, 'allow_streaming 开启时流式阶段应挂载卡片 iframe');
        const streamWin = streamFrame.contentWindow;

        const cleanup1 = cards.renderMessage(host1, 1, f.context.chat[1], false);
        await cards.settle();

        const frameBefore = host1.querySelector('iframe');
        assert.equal(Boolean(frameBefore), true, '第1层应挂载卡片 iframe');
        assert.equal(frameBefore === streamFrame, true, '流式结束且纯 HTML 未变化时必须保持同一 iframe 实例');
        assert.equal(frameBefore.contentWindow === streamWin, true, '流式结束且纯 HTML 未变化时必须保持同一 contentWindow 实例');
        assert.equal(frameBefore.id, 'TH-message--1--0');
        const winBefore = frameBefore.contentWindow;

        // 删除第0层消息
        assert.equal(await f.session.remove(0), true);
        const keysAfter = f.states.at(-1).messageKeys;
        assert.equal(keysAfter.length, 1);
        assert.equal(keysAfter[0], secondKeyBefore, '删除前序消息后，后续消息的 Session UI key 必须保持不变');

        // 检查 F2 提交包不含新增 UI 字段 id
        const savedMsg = f.sent.at(-1).chat[1];
        assert.equal('id' in savedMsg, false, 'F2 保存包不得增加 UI id 字段');

        // 卸载旧第0层宿主，并将原第1层宿主重绑到新索引 0
        cleanup0();
        const cleanup1After = cards.renderMessage(host1, 0, f.context.chat[0], false);
        await cards.surface.refresh([0]);
        await cards.settle();

        const frameAfter = host1.querySelector('iframe');
        assert.equal(frameAfter, frameBefore, '删除前序消息后，后续楼层的真实 iframe 元素必须保持同一实例');
        assert.equal(frameAfter.contentWindow, winBefore, 'iframe contentWindow 必须保持存活');
        assert.equal(frameAfter.id, 'TH-message--0--0', 'iframe id 必须同步迁移到新楼层 0');
        assert.equal(frameAfter.name, 'TH-message--0--0', 'iframe name 必须同步迁移到新楼层 0');
        assert.equal(globalThis.TavernHelper.getMessageId(frameAfter.id), 0, 'Helper getMessageId 必须解析到新楼层 0');

        cleanup1After();
        host0.remove();
        host1.remove();
        await cards.closeScripts();
    } finally {
        globalThis.fetch = prevFetch;
    }
});
