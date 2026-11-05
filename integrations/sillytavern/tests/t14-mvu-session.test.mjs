import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
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

test.after(() => happyWindow.happyDOM.close());

const { EventEmitter } = await import('../extension/vc-model-settings/desktop/standalone/engine/events.js');
const { event_types } = await import('../extension/vc-model-settings/desktop/standalone/engine/st/events.js');
const { bindEngineContext } = await import('../extension/vc-model-settings/desktop/standalone/engine/ports.js');
const { runtimeSettings } = await import('../extension/vc-model-settings/desktop/standalone/engine/runtime.js');
const { openaiDefaults, powerUserDefaults } = await import('../extension/vc-model-settings/desktop/standalone/engine/defaults.js');
const { createDesktopSession } = await import('../extension/vc-model-settings/desktop/standalone/session.js');
const { bindCardHost } = await import('../extension/vc-model-settings/desktop/standalone/cards/ejs-host.js');
const { getChatMessages, setChatMessages, createChatMessages } = await import('../extension/vc-model-settings/desktop/standalone/cards/helper-message.js');
const { getVariables, updateVariablesWith } = await import('../extension/vc-model-settings/desktop/standalone/cards/helper-variables.js');
const { klona } = await import('../extension/vc-model-settings/desktop/standalone/cards/klona.js');
const { prepareSourceIdentities } = await import('../server-plugin/virtual-companion/lib/source-identity.js');

function createDeferred() {
    let resolve, reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function loadDesktopPatchedMvuArtifacts() {
    const sharedSpec = JSON.parse(
        fs.readFileSync(new URL('../patches/mvu-current-message-lifecycle.json', import.meta.url), 'utf8'),
    );
    const desktopSpec = JSON.parse(
        fs.readFileSync(new URL('../patches/mvu-desktop-runtime.json', import.meta.url), 'utf8'),
    );
    let cnSource = sharedSpec.replacements.find(r => r.where === 'W05 actual MVU source')?.to;
    assert.ok(cnSource, 'mvu-current-message-lifecycle.json 必须包含 cn 补丁');
    const cnReplacements = desktopSpec.replacements.filter(
        r => r.from.includes('setChatMessages') && !r.from.includes('label_key'),
    );
    assert.equal(cnReplacements.length, 2, 'mvu-desktop-runtime.json 必须包含 cn 两处 setChatMessages 补丁');
    for (const rep of cnReplacements) {
        const parts = cnSource.split(rep.from);
        assert.equal(parts.length - 1, rep.count, '桌面补丁必须精确命中 shared cn 片段 1 次');
        cnSource = parts.join(rep.to);
    }
    const reprocessReplacement = desktopSpec.replacements.find(r =>
        r.from.includes("label_key:'panel.button.reprocessVariables'"),
    );
    assert.ok(reprocessReplacement, 'mvu-desktop-runtime.json 必须包含 reprocessVariables 按钮补丁');
    const replayReplacement = desktopSpec.replacements.find(r =>
        r.from.includes("label_key:'panel.button.replayFloor'"),
    );
    assert.ok(replayReplacement, 'mvu-desktop-runtime.json 必须包含 replayFloor 按钮补丁');
    assert.equal(
        replayReplacement.to.includes('content:n.mes') || replayReplacement.to.includes('replayingFloorLog'),
        false,
        '桌面 replayFloor 补丁不得在日志输出对话正文 content:n.mes',
    );
    return {
        cnSource,
        reprocessSource: reprocessReplacement.to,
        replaySource: replayReplacement.to,
    };
}

function createMvuSessionEnv() {
    const settings = runtimeSettings({
        username: '测试用户',
        user_avatar: 'user-default.png',
        world_info: { globalSelect: [] },
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
                script: {
                    enabled: { global: true, presets: [], characters: [] },
                    scripts: [],
                },
            },
        },
    });
    const card = {
        name: '澄夏',
        avatar: 'mvu-test.png',
        data: {
            name: '澄夏',
            extensions: { vc_character_ref: 'mvu-test-ref' },
        },
    };
    const initialRecords = [
        {
            user_name: '测试用户',
            character_name: '澄夏',
            chat_metadata: {
                integrity: 'mvu-test-integrity',
                vc_f2: { id: 'chat-mvu-1', revision: 2 },
                vc_binding: {
                    characterRef: 'mvu-test-ref',
                    chatIdentity: 'chat-mvu-1',
                    relationshipId: '1',
                    conversationId: 'chat-mvu-1',
                    mode: 'COMPANION',
                },
                variables: { stat_data: { trust: 10 } },
            },
        },
        {
            name: '澄夏',
            is_user: false,
            is_system: false,
            send_date: '2026-11-06T00:00:00Z',
            mes: '初始问候\n\n<StatusPlaceHolderImpl/>',
            swipe_id: 0,
            swipes: ['初始问候\n\n<StatusPlaceHolderImpl/>'],
            swipe_info: [{ send_date: '2026-11-06T00:00:00Z', extra: {} }],
            variables: [{ stat_data: { trust: 10 } }],
            extra: {},
        },
    ];
    prepareSourceIdentities(initialRecords, { settled: true, sourceTimezone: 'UTC' });

    const f2Saves = [];
    const conflicts = [];
    const context = {
        characters: [card],
        characterId: 0,
        chat: [],
        chatMetadata: {},
        chatId: 'chat-mvu-1.jsonl',
        name1: '测试用户',
        name2: '澄夏',
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
        async post() {
            return new Response('{}', { status: 200 });
        },
    };

    const syncDom = () => {
        document.body.innerHTML = `<div id="chat">${context.chat
            .map((_, idx) => `<div class="mes" mesid="${idx}"><div class="mes_text"></div></div>`)
            .join('')}</div>`;
    };

    let settleHook = null;
    let pendingSurfaceRender = false;
    let lastRenderedTextSignature = '';
    const refreshSurface = async () => {
        syncDom();
    };

    const engine = {
        settings,
        bindContext() {
            bindEngineContext(context, settings, { models: [], extensions: [] });
        },
        settingsForSave: () => settings,
        firstMessage: () => null,
        userMessage: async text => ({
            message: { name: context.name1, mes: text, is_user: true, is_system: false, extra: {} },
            bias: {},
        }),
        prepare: async () => ({ body: {} }),
        cleanResponse: t => t,
        memory: { finalStatus() {} },
        generateHelper: async () => '',
        cards: {
            open: async () => {},
            closeScripts: async () => {},
            settle: async () => {
                if (settleHook) await settleHook();
                pendingSurfaceRender = false;
            },
            reset: () => {},
            bindContext: () => {},
            isRendering: () => pendingSurfaceRender,
            surface: { refresh: refreshSurface },
        },
    };
    engine.bindContext();

    const session = createDesktopSession({
        client,
        context,
        engine,
        prepareSourceIdentities,
        choosePersona: async () => 'user-default.png',
        onChange: state => {
            const sig = (state?.messages || []).map(m => m?.mes ?? '').join('\u0000');
            if (sig !== lastRenderedTextSignature) {
                lastRenderedTextSignature = sig;
                pendingSurfaceRender = true;
                setTimeout(() => {
                    pendingSurfaceRender = false;
                }, 10);
            }
        },
        onConflict: (snapshot, error) => conflicts.push({ snapshot, error }),
        resolveBinding: async val => ({
            characterRef: 'mvu-test-ref',
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
        surface: { refresh: refreshSurface },
    });

    return {
        context,
        session,
        f2Saves,
        conflicts,
        initialRecords,
        setSettleHook(fn) {
            settleHook = fn;
        },
        createMvuRunner({ onBeforeSettle, onAfterApplied, onLn, popupInputs = [] } = {}) {
            const { cnSource, reprocessSource, replaySource } = loadDesktopPatchedMvuArtifacts();
            const wrappedSetChatMessages = (msgs, opts, internal) => {
                if (internal?.onApplied && typeof onAfterApplied === 'function') {
                    const origOnApplied = internal.onApplied;
                    internal = {
                        ...internal,
                        onApplied() {
                            origOnApplied();
                            onAfterApplied();
                        },
                    };
                }
                if (typeof onBeforeSettle === 'function') {
                    onBeforeSettle(msgs, opts, internal);
                }
                return setChatMessages(msgs, opts, internal);
            };
            const toasts = { warning: [], error: [], info: [], success: [] };
            let popupIdx = 0;
            const stRuntime = {
                get chat() {
                    return context.chat;
                },
                POPUP_TYPE: { INPUT: 2 },
                callGenericPopup: async () => popupInputs[popupIdx++],
                saveChat: () => session.save(),
            };
            const vmCtx = vm.createContext({
                globalThis,
                parent: globalThis,
                Symbol,
                console,
                parseInt,
                isNaN,
                Object,
                SillyTavern: stRuntime,
                getLastMessageId: () => context.chat.length - 1,
                getChatMessages,
                getVariables,
                setChatMessages: wrappedSetChatMessages,
                updateVariablesWith,
                eventEmit: async () => {},
                gt: { BEFORE_MESSAGE_UPDATE: 'mvu_before_message_update' },
                Tt: floor => {
                    const prev = Math.max(0, floor - 1);
                    const base = context.chat[prev]?.variables?.[0]?.stat_data ?? { trust: 10 };
                    return {
                        initialized_lorebooks: ['book-1'],
                        stat_data: structuredClone(base),
                        display_data: {},
                        delta_data: {},
                        schema: { type: 'object', properties: {} },
                    };
                },
                Et: floor => {
                    for (let i = floor - 1; i >= 0; i--) {
                        const v = context.chat[i]?.variables?.[0];
                        if (v?.stat_data && v?.schema) return i;
                    }
                    return 0;
                },
                yt: { klona },
                Nt: { D: () => ({ effective_settings: { 兼容性: { 更新到聊天变量: true } } }) },
                _: lib.lodash,
                ln: async (text, vars) => {
                    await new Promise(r => setTimeout(r, 5));
                    if (typeof onLn === 'function') {
                        await onLn(text, vars);
                        return;
                    }
                    const addMatch = String(text ?? '').match(/add\('trust',\s*(\d+)\)/);
                    const setMatch = String(text ?? '').match(/set\('trust',\s*(\d+)\)/);
                    if (addMatch) {
                        vars.stat_data.trust = Number(vars.stat_data.trust ?? 10) + Number(addMatch[1]);
                    } else if (setMatch) {
                        vars.stat_data.trust = Number(setMatch[1]);
                    } else {
                        vars.stat_data.trust = 15;
                    }
                    vars.display_data = { trust: String(vars.stat_data.trust) };
                    vars.delta_data = { trust: 5 };
                },
                toastr: {
                    warning: (msg, title) => toasts.warning.push({ msg, title }),
                    error: (msg, title) => toasts.error.push({ msg, title }),
                    info: (msg, title) => toasts.info.push({ msg, title }),
                    success: (msg, title) => toasts.success.push({ msg, title }),
                },
                xt: { tr: (k, params) => (params ? `${k}:${JSON.stringify(params)}` : k) },
            });
            const compiled = vm.runInContext(
                `${cnSource}; ({ cn, reprocess: (${reprocessSource}).function, replay: (${replaySource}).function })`,
                vmCtx,
            );
            return Object.assign(compiled.cn, {
                reprocessVariables: compiled.reprocess,
                replayFloor: compiled.replay,
                toasts,
            });
        },
    };
}

test('T14-MVU 1: 真实桌面 MVU cn 补丁经 onApplied 同步捕获完整快照（含 legacy 对象型 variables 规范化），配合 createChatMessages + 异步 CHARACTER_MESSAGE_RENDERED 回调仅单次 F2 保存且 revision+1', async () => {
    const env = createMvuSessionEnv();
    await env.session.activate({ avatar: 'mvu-test.png', file: 'chat-mvu-1.jsonl' }, structuredClone(env.initialRecords));
    env.f2Saves.length = 0;

    try {
        const cn = env.createMvuRunner();
        const onMessageReceived = async id => {
            // 模拟旧数据/插件将新消息的 variables 置为 plain object，验证 setChatMessages 规范化后由 onApplied 捕获完整投影
            env.context.chat[id].variables = { legacy_obj_var: 1 };
            await cn(id);
        };
        env.context.eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);

        const targetIndex = env.context.chat.length;
        let domReady = false;
        let rendered = false;
        const onRendered = async id => {
            if (Number(id) !== targetIndex) return;
            env.context.eventSource.removeListener(event_types.CHARACTER_MESSAGE_RENDERED, onRendered);
            domReady = Boolean(document.querySelector(`#chat > .mes[mesid="${targetIndex}"]`));
            await new Promise(r => setTimeout(r, 30));
            await updateVariablesWith(vars => ({ ...vars, dr2_render_probe: 1 }), { type: 'chat' });
            rendered = true;
        };
        env.context.eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, onRendered);

        const priorRevision = env.context.chatMetadata.vc_f2.revision;
        try {
            await createChatMessages([{ role: 'assistant', message: 'DR2_RENDER_PROBE' }]);
        } finally {
            env.context.eventSource.removeListener(event_types.MESSAGE_RECEIVED, onMessageReceived);
            env.context.eventSource.removeListener(event_types.CHARACTER_MESSAGE_RENDERED, onRendered);
        }

        assert.equal(rendered, true, 'CHARACTER_MESSAGE_RENDERED 异步回调必须执行完毕');
        assert.equal(domReady, true, 'CHARACTER_MESSAGE_RENDERED 触发时对应楼层 DOM 必须已就绪');
        assert.equal(env.conflicts.length, 0, 'MVU 自身异步写入不得触发 VC_STALE_SOURCE 冲突');
        assert.equal(env.f2Saves.length, 1, 'createChatMessages + MVU + 异步 RENDERED 写变量只应触发 1 次 F2 保存');
        assert.equal(env.context.chatMetadata.vc_f2.revision, priorRevision + 1, 'revision 必须恰好 +1');
        assert.equal(
            env.context.chat[targetIndex].mes,
            'DR2_RENDER_PROBE\n\n<StatusPlaceHolderImpl/>',
            '消息文本必须追加 <StatusPlaceHolderImpl/>',
        );
        assert.equal(Array.isArray(env.context.chat[targetIndex].variables), true, 'variables 必须规范化为数组');
        assert.deepEqual(env.context.chat[targetIndex].variables[0].stat_data, { trust: 15 });
        assert.equal(env.context.chatMetadata.variables.dr2_render_probe, 1);
        assert.deepEqual(env.context.chatMetadata.variables.stat_data, { trust: 15 });
    } finally {
        env.session.destroySession?.();
    }
});

test('T14-MVU 2: 可控 cards.settle 等待期间外部修改文本或切换会话，必须在 setChatMessages 应用前拒绝且不覆盖外部修改', async () => {
    const env = createMvuSessionEnv();
    const baseRecords = structuredClone(env.initialRecords);
    baseRecords[1].mes = '需要追加占位符的回复正文';
    baseRecords[1].swipes = ['需要追加占位符的回复正文'];
    await env.session.activate({ avatar: 'mvu-test.png', file: 'chat-mvu-1.jsonl' }, structuredClone(baseRecords));
    env.f2Saves.length = 0;

    try {
        // (a) settle 期间外部修改 message.mes：必须在 change/onApplied 前拒绝，保留外部文本且不写变量
        const settleGate = createDeferred();
        const enteredSettle = createDeferred();
        let onAppliedCount = 0;
        env.setSettleHook(async () => {
            enteredSettle.resolve();
            await settleGate.promise;
        });

        const cn = env.createMvuRunner({
            onAfterApplied() {
                onAppliedCount += 1;
            },
        });

        const pendingCn = cn(0);
        await enteredSettle.promise;
        env.context.chat[0].mes = 'EXTERNAL_EDIT_DURING_SETTLE';
        settleGate.resolve();

        await assert.rejects(pendingCn, { code: 'VC_STALE_SOURCE' });
        assert.equal(onAppliedCount, 0, 'settle 期间外部修改文本时不得调用 onApplied');
        assert.equal(env.context.chat[0].mes, 'EXTERNAL_EDIT_DURING_SETTLE', '不得覆盖 settle 期间的外部文本修改');
        assert.deepEqual(env.context.chat[0].variables[0].stat_data, { trust: 10 }, '冲突拒绝后不得写入新 stat_data');
        env.setSettleHook(null);

        // 重新激活干净会话测试 (b) settle 期间切换会话
        await env.session.activate({ avatar: 'mvu-test.png', file: 'chat-mvu-1.jsonl' }, structuredClone(baseRecords));
        env.f2Saves.length = 0;
        env.conflicts.length = 0;

        const switchGate = createDeferred();
        const enteredSwitchSettle = createDeferred();
        let switchAppliedCount = 0;
        env.setSettleHook(async () => {
            enteredSwitchSettle.resolve();
            await switchGate.promise;
        });
        const cnSwitch = env.createMvuRunner({
            onAfterApplied() {
                switchAppliedCount += 1;
            },
        });

        const pendingSwitchCn = cnSwitch(0);
        await enteredSwitchSettle.promise;
        env.setSettleHook(null);

        const chatBRecords = structuredClone(env.initialRecords);
        chatBRecords[0].chat_metadata.vc_f2 = { id: 'chat-mvu-2', revision: 1 };
        chatBRecords[0].chat_metadata.vc_binding.chatIdentity = 'chat-mvu-2';
        chatBRecords[0].chat_metadata.vc_binding.conversationId = 'chat-mvu-2';
        chatBRecords[1].mes = '会话B原始首条消息';
        prepareSourceIdentities(chatBRecords, { settled: true, sourceTimezone: 'UTC' });

        const activateB = env.session.activate({ avatar: 'mvu-test.png', file: 'chat-mvu-2.jsonl' }, chatBRecords);
        switchGate.resolve();

        await assert.rejects(pendingSwitchCn, /VC_CHAT_MUTATION_REJECTED|VC_STALE_SOURCE/);
        await activateB;
        assert.equal(switchAppliedCount, 0, 'settle 期间切换会话不得执行 onApplied');
        assert.equal(env.context.chatId, 'chat-mvu-2.jsonl');
        assert.equal(env.context.chat[0].mes, '会话B原始首条消息', '旧会话 MVU 不得串写到新会话 B');
        assert.deepEqual(env.context.chat[0].variables[0].stat_data, { trust: 10 });
        assert.equal(env.f2Saves.length, 0, '切会话期间取消的旧 MVU 不得产生额外 F2 保存');
    } finally {
        env.session.destroySession?.();
    }
});

test('T14-MVU 3: 同步 onApplied 执行后、await vcWrite 返回前的微任务窗口内发生外部变化，必须被 await 后 vcCheck 拒绝', async () => {
    const env = createMvuSessionEnv();
    await env.session.activate({ avatar: 'mvu-test.png', file: 'chat-mvu-1.jsonl' }, structuredClone(env.initialRecords));
    env.f2Saves.length = 0;

    const targetIndex = env.context.chat.length;
    let onMessageReceived;
    try {
        let onAppliedRan = false;
        let mvuError;
        const cn = env.createMvuRunner({
            onAfterApplied() {
                onAppliedRan = true;
                // 在同步 change+onApplied 已完成、但 await vcWrite 尚未向调用方返回前的微任务中注入外部文本变化
                queueMicrotask(() => {
                    env.context.chat[targetIndex].mes = 'EXTERNAL_MUTATION_AFTER_APPLIED_BEFORE_AWAIT_RESUME';
                });
            },
        });
        onMessageReceived = async id => {
            if (Number(id) !== targetIndex) return;
            env.context.chat[id].variables = [{ stat_data: { trust: 10 } }];
            try {
                await cn(id);
            } catch (error) {
                mvuError = error;
                throw error;
            }
        };
        env.context.eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);

        // 与正常自写用例一样由 createChatMessages 拥有父操作，排除独立 cn 自己保存后 revision 变化的假阳性。
        await assert.rejects(createChatMessages([{ role: 'assistant', message: 'DR2_RENDER_PROBE' }]), /VC_CHAT_MUTATION_REJECTED|VC_STALE_SOURCE/);
        assert.equal(mvuError?.code, 'VC_STALE_SOURCE', '必须由 MVU 的 await 后来源检查拒绝');
        assert.equal(onAppliedRan, true, 'onApplied 应已在同步写入末尾执行');
        assert.equal(
            env.context.chat[targetIndex].mes,
            'EXTERNAL_MUTATION_AFTER_APPLIED_BEFORE_AWAIT_RESUME',
            'await vcWrite 后的 vcCheck 必须检出微任务外部改动并中止后续变量覆盖',
        );
        assert.deepEqual(
            env.context.chat[targetIndex].variables[0].stat_data,
            { trust: 10 },
            'await vcWrite 后 vcCheck 拒绝后不得执行后续 updateVariablesWith',
        );
        assert.equal(env.f2Saves.length, 0, '来源冲突后父操作不得提交 F2 保存');
    } finally {
        if (onMessageReceived) env.context.eventSource.removeListener(event_types.MESSAGE_RECEIVED, onMessageReceived);
        env.session.destroySession?.();
    }
});

test('T14-MVU 4: 真实桌面 reprocessVariables 按钮补丁（清变量 + cn）全程无中途 save，最终 text/chat/message 变量一致、F2 恰好 1 次且 revision+1；异常或外部改动/新楼层不吞错误且不保存', async () => {
    const env = createMvuSessionEnv();
    const records = structuredClone(env.initialRecords);
    records.push({
        name: '澄夏',
        is_user: false,
        is_system: false,
        send_date: '2026-11-06T00:01:00Z',
        mes: "编辑后的回复正文 _.add('trust', 9)",
        swipe_id: 0,
        swipes: ["编辑后的回复正文 _.add('trust', 9)"],
        swipe_info: [{ send_date: '2026-11-06T00:01:00Z', extra: {} }],
        variables: [
            {
                stat_data: { trust: 17 },
                delta_data: { trust: 2 },
                display_data: { trust: '17' },
                schema: { type: 'object', properties: {} },
                custom_preserved: 'keep-me',
            },
        ],
        extra: {},
    });
    prepareSourceIdentities(records, { settled: true, sourceTimezone: 'UTC' });
    await env.session.activate({ avatar: 'mvu-test.png', file: 'chat-mvu-1.jsonl' }, structuredClone(records));
    env.f2Saves.length = 0;

    try {
        let midSaves = 0;
        const mvu = env.createMvuRunner({
            onBeforeSettle() {
                midSaves += env.f2Saves.length;
            },
        });
        const priorRevision = env.context.chatMetadata.vc_f2.revision;

        await mvu.reprocessVariables();
        await env.session.whenIdle();

        assert.equal(midSaves, 0, 'reprocess 清变量及 cn 内部 setChatMessages 期间不得产生中途 F2 保存');
        assert.equal(env.conflicts.length, 0, '独立 reprocessVariables 不得自触发 VC_STALE_SOURCE 冲突');
        assert.equal(env.f2Saves.length, 1, '独立 reprocessVariables 完整链路必须恰好 1 次 F2 保存');
        assert.equal(env.context.chatMetadata.vc_f2.revision, priorRevision + 1, 'revision 必须恰好 +1');
        assert.equal(
            env.context.chat[1].mes,
            "编辑后的回复正文 _.add('trust', 9)\n\n<StatusPlaceHolderImpl/>",
            '目标楼层文本必须补齐 <StatusPlaceHolderImpl/>',
        );
        assert.deepEqual(env.context.chat[1].variables[0].stat_data, { trust: 19 });
        assert.equal(env.context.chat[1].variables[0].custom_preserved, 'keep-me');
        assert.deepEqual(env.context.chatMetadata.variables.stat_data, { trust: 19 });
        assert.equal(env.f2Saves[0].chat[2].extra?.vc_source?.settled, true, '最终落盘 vc_source.settled 必须为 true');

        // 负向验证：清变量后、ln 期间若外部插入新楼层或修改文本，必须抛错且不保存
        env.f2Saves.length = 0;
        const mvuConflict = env.createMvuRunner({
            onLn: async () => {
                env.context.chat.push({
                    name: '测试用户',
                    is_user: true,
                    is_system: false,
                    mes: '并发新增楼层',
                    extra: {},
                });
            },
        });
        await assert.rejects(mvuConflict.reprocessVariables(), { code: 'VC_STALE_SOURCE' });
        await env.session.whenIdle();
        assert.equal(env.f2Saves.length, 0, 'reprocess 期间新增楼层冲突后不得提交 F2 保存');
    } finally {
        env.session.destroySession?.();
    }
});

test('T14-MVU 5: 真实桌面 replayFloor 按钮补丁收敛为单次 Session.mutate（写目标 data 保留其他 swipe → refresh → 异步 RENDERED → 单次 F2 / revision+1 → toast），取消或外部冲突安全中止', async () => {
    const env = createMvuSessionEnv();
    const records = structuredClone(env.initialRecords);
    records[1].variables = [
        {
            stat_data: { trust: 20 },
            display_data: { trust: '20' },
            delta_data: {},
            initialized_lorebooks: ['book-0'],
            schema: { type: 'object', properties: { trust: { type: 'number' } } },
        },
    ];
    records.push(
        {
            name: '澄夏',
            is_user: false,
            is_system: false,
            send_date: '2026-11-06T00:01:00Z',
            mes: "第一段演进 _.add('trust', 4)\n\n<StatusPlaceHolderImpl/>",
            swipe_id: 0,
            swipes: ["第一段演进 _.add('trust', 4)\n\n<StatusPlaceHolderImpl/>"],
            swipe_info: [{ send_date: '2026-11-06T00:01:00Z', extra: {} }],
            variables: [{ stat_data: { trust: 14 }, schema: { type: 'object', properties: {} } }],
            extra: {},
        },
        {
            name: '澄夏',
            is_user: false,
            is_system: false,
            send_date: '2026-11-06T00:02:00Z',
            mes: "第二段演进 _.add('trust', 1)\n\n<StatusPlaceHolderImpl/>",
            swipe_id: 1,
            swipes: ['候选0文本', "第二段演进 _.add('trust', 1)\n\n<StatusPlaceHolderImpl/>"],
            swipe_info: [
                { send_date: '2026-11-06T00:02:00Z', extra: {} },
                { send_date: '2026-11-06T00:02:00Z', extra: {} },
            ],
            variables: [
                { stat_data: { trust: 99 }, swipe0_only: 'preserved-swipe-0' },
                {
                    stat_data: { trust: 15 },
                    schema: { type: 'object', properties: {} },
                    active_custom: 'preserved-active-swipe',
                },
            ],
            extra: {},
        },
    );
    prepareSourceIdentities(records, { settled: true, sourceTimezone: 'UTC' });
    await env.session.activate({ avatar: 'mvu-test.png', file: 'chat-mvu-1.jsonl' }, structuredClone(records));
    env.f2Saves.length = 0;

    try {
        // (1) 弹窗取消（返回空字符串）：不修改变量、不发 F2 保存
        const mvuCancel = env.createMvuRunner({ popupInputs: [''] });
        await mvuCancel.replayFloor();
        assert.equal(env.f2Saves.length, 0, '取消重演楼层不得触发 F2 保存');
        assert.equal(mvuCancel.toasts.success.length, 0);

        // (2) 正常重演 0 -> 2，配合 CHARACTER_MESSAGE_RENDERED 异步 20ms 写变量，验证仅单次 F2 保存且保留其他 swipe 变量
        let renderedRan = false;
        const onRendered = async id => {
            if (Number(id) !== 2) return;
            env.context.eventSource.removeListener(event_types.CHARACTER_MESSAGE_RENDERED, onRendered);
            await new Promise(r => setTimeout(r, 20));
            await updateVariablesWith(vars => ({ ...vars, replay_rendered_probe: true }), { type: 'chat' });
            renderedRan = true;
        };
        env.context.eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, onRendered);

        const priorRevision = env.context.chatMetadata.vc_f2.revision;
        const mvuReplay = env.createMvuRunner({ popupInputs: ['2', '0'] });
        try {
            await mvuReplay.replayFloor();
        } finally {
            env.context.eventSource.removeListener(event_types.CHARACTER_MESSAGE_RENDERED, onRendered);
        }

        assert.equal(renderedRan, true, 'replayFloor refresh:affected 必须等待异步 CHARACTER_MESSAGE_RENDERED 完成');
        assert.equal(env.conflicts.length, 0, 'replayFloor 不得产生冲突');
        assert.equal(env.f2Saves.length, 1, 'replayFloor + 异步 RENDERED 只应触发 1 次 F2 保存');
        assert.equal(env.context.chatMetadata.vc_f2.revision, priorRevision + 1, 'revision 必须恰好 +1');
        assert.deepEqual(env.context.chat[2].variables[1].stat_data, { trust: 25 }, '目标楼层当前候选变量应重演为 20+4+1=25');
        assert.equal(
            env.context.chat[2].variables[1].active_custom,
            'preserved-active-swipe',
            '目标楼层当前候选非五字段属性必须保留',
        );
        assert.deepEqual(
            env.context.chat[2].variables[0],
            { stat_data: { trust: 99 }, swipe0_only: 'preserved-swipe-0' },
            '目标楼层其他 swipe 的变量必须原样保留',
        );
        assert.equal(env.context.chatMetadata.variables.replay_rendered_probe, true);
        assert.equal(mvuReplay.toasts.success.length, 1, 'await setChatMessages 完成后应弹出完成 toast');

        // (3) ln 计算期间外部修改目标楼层，必须在真正写前通过 assertActive -> beforeMutation 拒绝，不覆盖且不弹成功 toast
        env.f2Saves.length = 0;
        const mvuStale = env.createMvuRunner({
            popupInputs: ['2', '0'],
            onLn: async (_text, vars) => {
                vars.stat_data.trust = 88;
                env.context.chat[2].mes = 'EXTERNAL_EDIT_DURING_REPLAY_LN';
            },
        });
        await assert.rejects(mvuStale.replayFloor(), { code: 'VC_STALE_SOURCE' });
        assert.equal(env.context.chat[2].mes, 'EXTERNAL_EDIT_DURING_REPLAY_LN');
        assert.deepEqual(env.context.chat[2].variables[1].stat_data, { trust: 25 }, '冲突拒绝后不得覆盖目标楼层变量');
        assert.equal(mvuStale.toasts.success.length, 0, '冲突拒绝后不得弹出成功 toast');
        assert.equal(env.f2Saves.length, 0, '冲突拒绝后不得提交 F2 保存');
    } finally {
        env.session.destroySession?.();
    }
});

test('T14-MVU 6: 普通无 deferChatSave 的 UI setChatMessages 在 guard failed 时仍正常落盘（settled:false），不因 guard 未收敛而静默丢保存', async () => {
    const env = createMvuSessionEnv();
    await env.session.activate({ avatar: 'mvu-test.png', file: 'chat-mvu-1.jsonl' }, structuredClone(env.initialRecords));
    env.f2Saves.length = 0;

    try {
        // 先让某次 updateVariablesWith 抛错，使 guard 将第 0 楼标记为 failed（guard.isSettled() === false）
        assert.throws(() => {
            updateVariablesWith(() => {
                throw new Error('SYNTHETIC_UPDATER_FAILURE');
            }, { type: 'message', message_id: 0 });
        }, /SYNTHETIC_UPDATER_FAILURE/);

        const guard = globalThis[Symbol.for('virtual-companion.f2-source')];
        assert.equal(guard.isSettled(), false, 'updater 失败后 guard.isSettled() 应为 false');

        const priorRevision = env.context.chatMetadata.vc_f2.revision;
        await setChatMessages([{ message_id: 0, message: '普通 UI 编辑后的文本' }]);

        assert.equal(env.f2Saves.length, 1, '普通无 deferChatSave 的 setChatMessages 仍必须发起 F2 保存');
        assert.equal(env.context.chatMetadata.vc_f2.revision, priorRevision + 1);
        assert.equal(env.context.chat[0].mes, '普通 UI 编辑后的文本');
        assert.equal(env.f2Saves[0].chat[1].extra?.vc_source?.settled, false, '未收敛时落盘 settled 标记应为 false');
    } finally {
        env.session.destroySession?.();
    }
});
