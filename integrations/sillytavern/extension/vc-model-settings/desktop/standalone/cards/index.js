// 桌面卡片运行入口。只运行卡片HTML/脚本iframe与锁定EJS handler；没有ST页面宿主。
import { lodash, yaml, showdown, hljs } from '../../locked-source/st/lib.js';
import { bindCardHost, clearCardHost, refreshCardHost, messageFormatting, getCardHost, getChatCompletionModel, getTokenCountAsync, loadWorldInfo,
    getRegexedString, getThumbnailUrl, MessageFormatter, parseRegexFromString, isHelperExtensionEnabled, isEjsExtensionEnabled,
    isEjsExecutionAllowed, getEnabledCardExtensions, cardHistoryArgs, createScopedRawCharacter } from './ejs-host.js';
import { renderMarkdown } from './format.js';
import { createScriptState, setHelperSchemaLibrary, notifyScriptButtons, onScriptButtonsChanged, waitUntil, getButtonId,
    isCardExecutionAllowed, bindFrameInstance, disposeFrameInstance, getFrameOwner, isInstanceDisposed, registerInstanceCleanup } from './helper-host.js';
import * as variables from './helper-variables.js';
import * as events from './helper-event.js';
import * as util from './helper-util.js';
import * as scriptApi from './helper-script.js';
import * as globals from './helper-global.js';
import * as messages from './helper-message.js';
import * as books from './helper-worldbook.js';
import * as generation from './helper-generate.js';
import * as presetsApi from './helper-preset.js';
import * as charactersApi from './helper-character.js';
import * as personasApi from './helper-persona.js';
import * as slashApi from './helper-slash.js';
import * as injectApi from './helper-inject.js';
import * as regexApi from './helper-regex.js';
import { builtin_prompt_default_order, placeholder_prompt_default_order } from '../engine/helper-types.js';
import { klona } from './klona.js';
import { ToolManager } from '../engine/tools.js';
import { substituteParamsExtended, getCharacterCardFields } from '../engine/st/script.js';
import { uuidv4 } from '../engine/st/scripts/utils.js';
import { MacrosParser } from '../engine/st/scripts/macros.js';
import { renderReplyBubbles } from './reply-bubbles.js';
import { icon } from '../../../ui/icons.js';

const base = '/scripts/extensions/third-party/vc-model-settings/desktop/standalone/cards/';
const iframeBase = '/scripts/extensions/third-party/JS-Slash-Runner/src/iframe/';
const vendor = '/scripts/extensions/third-party/JS-Slash-Runner/lib/vendor/';
const desktopToastPorts = new WeakSet();
const loadScript = src => new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = src; script.onload = resolve; script.onerror = reject; document.head.append(script);
});

export async function initializeCards(options) {
    const { context, settings, client, signal } = options;
    signal?.throwIfAborted?.();
    const [version] = await Promise.all([
        fetch('/version').then(response => response.json()).then(value => value.pkgVersion),
        (async () => {
            if (!globalThis.jQuery) await loadScript('/lib/jquery-3.5.1.min.js');
            // 两个插件都需要 jQuery；toastr 不依赖 jQuery UI。
            await Promise.all([
                globalThis.jQuery.ui ? undefined : loadScript('/lib/jquery-ui.min.js'),
                (async () => {
                    if (globalThis.toastr) return;
                    await loadScript('/lib/toastr.min.js');
                    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/css/toastr.min.css'; document.head.append(css);
                })(),
            ]);
        })(),
    ]);
    signal?.throwIfAborted?.();
    if (globalThis.toastr && document.querySelector?.('[data-vc-toast-host]')) {
        const toastOptions = (globalThis.toastr.options ||= {});
        if (!toastOptions.target || toastOptions.target === 'body') {
            toastOptions.target = '[data-vc-toast-host]';
        }
        if (!desktopToastPorts.has(globalThis.toastr)) {
            const toastr = globalThis.toastr;
            for (const kind of ['success', 'info', 'warning', 'error']) {
                const notify = toastr[kind];
                toastr[kind] = (message, title, overrides = {}) => {
                    const previous = toastr.getContainer().children();
                    const next = notify(message, title, {
                        ...(kind === 'error' ? {
                            timeOut: 0,
                            extendedTimeOut: 0,
                            closeButton: true,
                            closeHtml: `<button type="button" aria-label="关闭提示">${icon('x', { size: 16 })}</button>`,
                        } : {}),
                        ...overrides,
                    });
                    if (next) {
                        next.addClass('toast');
                        previous.each((_, element) => {
                            const oldToast = globalThis.jQuery(element);
                            toastr.clear(oldToast, { force: true });
                            oldToast.finish();
                        });
                    }
                    return next;
                };
            }
            desktopToastPorts.add(toastr);
        }
    }
    const nodes = new Map(), byNode = new WeakMap(), pending = new Set(), frameUrls = new Map();
    const ownerScripts = new Map();
    const frameHistoryScopes = new WeakMap();
    let historyLifetime = new AbortController();
    let chatOpenSignal;
    let ejs, serial = 0, openSerial = 0, activeMetadata, destroyed = false, renderQueue = Promise.resolve();
    const actions = document.createElement('div'); actions.className = 'vc-card-actions';
    const scriptFrames = document.createElement('div'); scriptFrames.dataset.vcCardScripts = '';
    function signatureOf(message) {
        return `${message?.swipe_id ?? 0}:${message?.extra?.display_text ?? ''}\u0000${message?.mes ?? ''}`;
    }
    function rebindMessageFrames(node, index) {
        let number = 0;
        for (const frame of node.querySelectorAll('iframe')) {
            const match = /^TH-message--\d+--(\d+(?:_\d+)?)$/.exec(frame.id || frame.name || '');
            const suffix = match ? match[1] : String(number);
            const nextId = `TH-message--${index}--${suffix}`;
            frame.id = nextId;
            frame.name = nextId;
            try {
                if (frame.contentWindow) {
                    frame.contentWindow.name = nextId;
                    frame.contentWindow.__TH_IFRAME_ID = nextId;
                }
            } catch { /* same-origin srcdoc/blob frames allow name update */ }
            number++;
        }
    }
    function valid(entry, ticket) {
        return Boolean(!destroyed && !hostOwner.destroyed && entry && entry.node.isConnected && byNode.get(entry.node) === entry && entry.ticket === ticket && context.chat[entry.index] === entry.message);
    }
    function format(index, message = context.chat[index]) {
        if (destroyed || hostOwner.destroyed) return;
        const entry = nodes.get(index), node = entry?.node;
        if (node && message) {
            entry.rendered = false;
            entry.formattedSignature = signatureOf(message);
            releaseFrames(node);
            for (const timer of entry.timers) clearTimeout(timer); entry.timers.clear();
            node.removeAttribute('data-vc-segs'); node.classList.remove('vc-segmented');
            const content = document.createElement('div'); content.className = 'mes_text';
            const rawMes = isHelperExtensionEnabled(hostOwner)
                ? util.replaceMacroLike(message.extra?.display_text || message.mes, {
                    source: 'display',
                    message_id: index,
                    role: message.is_user ? 'user' : message.is_system ? 'system' : 'assistant',
                })
                : (message.extra?.display_text || message.mes);
            content.innerHTML = messageFormatting(rawMes,
                message.name, message.is_system, message.is_user, index);
            content.dataset.vcFormatted = ''; node.replaceChildren(content);
        }
    }
    async function render(index, { evaluate = true } = {}) {
        if (destroyed || hostOwner.destroyed) return;
        const entry = nodes.get(index), message = context.chat[index];
        if (!entry || !message) return;
        const { node, ticket } = entry;
        const nextSignature = signatureOf(message);
        const rawText = String(message.extra?.display_text || message.mes || '');
        if (entry.message === message && entry.formattedSignature === nextSignature && node.querySelector('iframe') && !/<%/.test(rawText) && isCardExecutionAllowed(hostOwner)) {
            rebindMessageFrames(node, entry.index);
            decorateCodes(node, { afterHtml: true });
            entry.signature = nextSignature;
            entry.rendered = true;
            return;
        }
        format(entry.index, message);
        const canExecuteEjs = isEjsExecutionAllowed(hostOwner);
        const canExecuteCard = isCardExecutionAllowed(hostOwner);
        if (evaluate && canExecuteEjs) await ejs.render(String(entry.index), 'desktop', true);
        if (!valid(entry, ticket)) return;
        if (canExecuteCard) mountHtml(node, entry.index);
        decorateCodes(node,{afterHtml:true});
        entry.signature = nextSignature;
        entry.rendered = true;
        if (context.chatMetadata.vc_binding?.mode === 'COMPANION' && !message.is_user && !message.is_system
            && !message.extra?.vc_voice && !/<%|<script|```/.test(message.mes) && !node.querySelector('iframe, img, video, .TH-render')) {
            renderReplyBubbles(node, message.extra?.display_text || message.mes, { reducedMotion: message !== context.liveReply,
                schedule(fn, delay) { const timer = setTimeout(() => { entry.timers.delete(timer); if (valid(entry, ticket)) fn(); }, delay); entry.timers.add(timer); } });
        }
    }
    const track = promise => { pending.add(promise); void promise.finally(() => pending.delete(promise)).catch(() => {}); return promise; };
    const schedule = (index, options) => {
        // 原EJS STATE/cache是单一可变闭包，历史渲染必须沿消息顺序串行。
        const operation = renderQueue.catch(() => {}).then(() => render(index, options));
        renderQueue = operation; return track(operation);
    };
    const surface = { format, async refresh(indices, options) {
        if (destroyed || hostOwner.destroyed) return;
        await new Promise(resolve => requestAnimationFrame(resolve));
        if (destroyed || hostOwner.destroyed) return;
        for (const index of indices) await schedule(index, options);
    }, codeBlocks:decorateCodes, media() {}, reasoning() {} };
    const hostOwner = {
        ...options,
        get historySignal() {
            return chatOpenSignal ? AbortSignal.any([historyLifetime.signal, chatOpenSignal]) : historyLifetime.signal;
        },
        surface,
        scripts: ownerScripts,
        notifyScriptButtons: () => {},
        schemas: {},
        customMacros: [],
        destroyed: false,
        ejs: null,
        mvu: null,
    };
    Object.assign(globalThis, { _: lodash, YAML: yaml, showdown, klona });
    const runtime = await import('../../locked-source/ejs/desktop.js');
    signal?.throwIfAborted?.();
    ejs = await runtime.initializeDesktop();
    if (signal?.aborted) {
        destroyed = true;
        hostOwner.destroyed = true;
        ejs?.destroy?.();
        disposeFrameInstance(hostOwner);
        clearCardHost(hostOwner);
        signal.throwIfAborted();
    }
    hostOwner.ejs = ejs;
    bindCardHost(hostOwner);
    document.body.append(scriptFrames);
    Object.assign(context, { getRequestHeaders: client.headers, getChatCompletionModel, getTokenCountAsync, loadWorldInfo,
        ToolManager, getCharacterCardFields, registerFunctionTool: spec => ToolManager.registerFunctionTool(spec),
        unregisterFunctionTool: name => ToolManager.unregisterFunctionTool(name), messageFormatter: MessageFormatter,
        registerMacro: (...args) => MacrosParser.registerMacro(...args), unregisterMacro: name => MacrosParser.unregisterMacro(name),
        POPUP_TYPE: { TEXT: 1, CONFIRM: 2, INPUT: 3 }, POPUP_RESULT: { AFFIRMATIVE: 1, NEGATIVE: 0, CANCELLED: null },
        async callGenericPopup(content, type, initial = '') {
            if (typeof options.callGenericPopup !== 'function') {
                throw new Error('callGenericPopup port is not configured');
            }
            return options.callGenericPopup(content, type, initial);
        } });
    Object.assign(globalThis, { SillyTavern: { getContext: () => context } });
    setHelperSchemaLibrary(ejs.z);
    globalThis.z = ejs.z;
    const onGenerateAfterData = (eventData, dryRun) => {
        if (destroyed || hostOwner.destroyed || getCardHost() !== hostOwner || !isHelperExtensionEnabled(hostOwner)) return;
        util.demacroOnPrompt(eventData, dryRun);
    };
    context.eventSource.on(context.eventTypes.GENERATE_AFTER_DATA, onGenerateAfterData);

    function assertHostOwner() {
        if (destroyed || hostOwner.destroyed || signal?.aborted || getCardHost() !== hostOwner) {
            throw new Error('VC_STALE_CARD_RUNTIME');
        }
    }
    function assertFrame(frame) {
        assertHostOwner();
        if (
            !frame ||
            !frame.isConnected ||
            (getFrameOwner(frame) && getFrameOwner(frame) !== hostOwner) ||
            context.chatMetadata !== activeMetadata
        ) {
            throw new Error('VC_STALE_CARD_RUNTIME');
        }
    }
    function frameHistoryScope(frame) {
        if (frameHistoryScopes.has(frame)) return frameHistoryScopes.get(frame);
        const metadata = context.chatMetadata;
        const lifetime = new AbortController();
        const historySignal = AbortSignal.any([hostOwner.historySignal, lifetime.signal]);
        const scope = {
            signal: historySignal,
            assertActive() {
                assertFrame(frame);
                if (historySignal.aborted || context.chatMetadata !== metadata || isInstanceDisposed(frame)) {
                    throw new Error('VC_STALE_CARD_RUNTIME');
                }
            },
        };
        if (frame) {
            registerInstanceCleanup(frame, () => lifetime.abort());
            frameHistoryScopes.set(frame, scope);
        }
        return scope;
    }
    const unsupportedHelper = name => function () {
        console.warn(`[TavernHelper] Unsupported helper interface called: ${name}`);
        throw new Error(`VC_HELPER_UNSUPPORTED:${name}`);
    };
    const UNSUPPORTED_TOP_NAMES = [
        // audio (13 + playSound alias)
        'audioEnable', 'audioImport', 'audioMode', 'audioPlay', 'audioSelect',
        'playAudio', 'pauseAudio', 'getAudioList', 'replaceAudioList', 'appendAudioList',
        'getAudioSettings', 'setAudioSettings', 'getCurrentAudio', 'playSound',
        // extension (9 + aliases)
        'isAdmin', 'getTavernHelperExtensionId', 'getExtensionType',
        'getExtensionInstallationInfo', 'getExtensionStatus', 'isInstalledExtension',
        'installExtension', 'uninstallExtension', 'reinstallExtension', 'updateExtension',
        // file (3)
        'getTavernFile', 'uploadTavernFile', 'deleteTavernFile',
        // import_raw (5)
        'importRawCharacter', 'importRawPreset', 'importRawChat', 'importRawWorldbook', 'importRawTavernRegex',
        // version update / frontend check
        'updateTavernHelper', 'updateFrontendVersion', 'isFrontend',
        // character write
        'createCharacter', 'deleteCharacter', 'replaceCharacter', 'updateCharacterWith', 'createOrReplaceCharacter', 'setCurrentCharacter',
        // persona write
        'createPersona', 'deletePersona', 'replacePersona', 'updatePersonaWith', 'createOrReplacePersona', 'setCurrentPersona',
        // preset write / model & proxy list
        'loadPreset', 'createPreset', 'deletePreset', 'createOrReplacePreset', 'renamePreset', 'replacePreset', 'updatePresetWith', 'setPreset',
        'getModelList', 'getProxyPresetNames',
        // script tree management
        'getScriptTrees',
        // regex write
        'replaceTavernRegexes', 'updateTavernRegexesWith',
    ];
    const unsupportedApi = Object.fromEntries(UNSUPPORTED_TOP_NAMES.map(name => [name, unsupportedHelper(name)]));
    const bind = {
        _createRawCharacter() { return createScopedRawCharacter(frameHistoryScope(this.frameElement)); },
    };
    for (const [name, fn] of Object.entries({ ...variables, ...events, ...util, ...scriptApi, ...globals, ...slashApi, ...injectApi })) {
        if (!name.startsWith('_') || typeof fn !== 'function') continue;
        bind[name] = function (...args) {
            const frame = this.frameElement;
            if (!name.startsWith('_eventClear') && name !== '_eventRemoveListener') assertFrame(frame);
            if (frame && !destroyed && !hostOwner.destroyed && getCardHost() === hostOwner) bindFrameInstance(frame, hostOwner);
            const result = fn.apply(this, args);
            if (/^_(replaceScriptButtons|updateScriptButtonsWith|appendInexistentScriptButtons)$/.test(name)) {
                if (result?.then) return result.then(value => { if (!destroyed && !hostOwner.destroyed && getCardHost() === hostOwner && frame?.isConnected && context.chatMetadata === activeMetadata) notifyScriptButtons(hostOwner); return value; });
                if (!destroyed && !hostOwner.destroyed && getCardHost() === hostOwner) notifyScriptButtons(hostOwner);
            }
            return result;
        };
    }
    for (const [name, fn] of Object.entries({ ...messages, ...books, ...generation, ...presetsApi, ...charactersApi, ...personasApi, ...injectApi, ...regexApi, ...unsupportedApi })) {
        if (name.startsWith('_') || name === 'RawCharacter' || typeof fn !== 'function' || Object.hasOwn(bind, '_' + name)) continue;
        bind['_' + name] = function (...args) {
            const frame = this.frameElement;
            assertFrame(frame);
            if (name === 'getChatHistoryBrief' || name === 'getChatHistoryDetail') {
                args = cardHistoryArgs(name, args, frameHistoryScope(frame));
            }
            return fn.apply(this, args);
        };
    }
    const INTERNAL_HELPER_EXPORTS = new Set([
        'get_variables_without_clone',
        'get_tavern_regexes_without_clone',
        'to_tavern_regex',
        'from_tavern_regex',
        'replaceMacroLike',
        'demacroOnPrompt',
    ]);
    const publicOnly = mod => Object.fromEntries(
        Object.entries(mod).filter(([name]) => !name.startsWith('_') && !INTERNAL_HELPER_EXPORTS.has(name)),
    );
    const publicApi = {
        ...unsupportedApi,
        ...publicOnly(variables),
        ...publicOnly(messages),
        ...publicOnly(books),
        ...publicOnly(globals),
        ...publicOnly(generation),
        ...publicOnly(presetsApi),
        ...publicOnly(scriptApi),
        ...publicOnly(charactersApi),
        RawCharacter: createScopedRawCharacter({ assertActive: assertHostOwner }),
        async getChatHistoryBrief(...args) {
            assertHostOwner();
            return charactersApi.getChatHistoryBrief(...args);
        },
        async getChatHistoryDetail(...args) {
            assertHostOwner();
            return charactersApi.getChatHistoryDetail(...args);
        },
        ...publicOnly(personasApi),
        ...publicOnly(injectApi),
        ...publicOnly(regexApi),
        triggerSlash: slashApi.triggerSlash,
        triggerSlashWithResult: slashApi.triggerSlashWithResult,
        registerMacroLike: util.registerMacroLike,
        unregisterMacroLike: util.unregisterMacroLike,
        builtin_prompt_default_order,
        placeholder_prompt_default_order,
        getActiveScriptIds: () => (destroyed || hostOwner.destroyed ? [] : [...ownerScripts.keys()]),
        getTavernHelperVersion: () => '4.11.3',
        getFrontendVersion: () => '4.11.3',
        getTavernVersion: () => version,
        getLastMessageId: util.getLastMessageId,
        getMessageId: util.getMessageId,
        substitudeMacros: util.substitudeMacros,
        errorCatched: util.errorCatched,
        reloadIframe: util.reloadIframe,
        tavern_events: events.tavern_events,
        iframe_events: events.iframe_events,
        builtin: {
            saveSettings: () => context.saveSettingsDebounced(),
            uuidv4,
            copyText: async text => { await globalThis.navigator?.clipboard?.writeText?.(String(text ?? '')); },
            renderMarkdown,
            parseRegexFromString,
            duringGenerating: () => Boolean(context.isGenerating),
            addOneMessage: unsupportedHelper('builtin.addOneMessage'),
            getImageTokenCost: unsupportedHelper('builtin.getImageTokenCost'),
            getVideoTokenCost: unsupportedHelper('builtin.getVideoTokenCost'),
            promptManager: new Proxy({}, { get: () => unsupportedHelper('builtin.promptManager') }),
            reloadAndRenderChatWithoutEvents: unsupportedHelper('builtin.reloadAndRenderChatWithoutEvents'),
            reloadChatWithoutEvents: unsupportedHelper('builtin.reloadChatWithoutEvents'),
            reloadEditor: unsupportedHelper('builtin.reloadEditor'),
            reloadEditorDebounced: unsupportedHelper('builtin.reloadEditorDebounced'),
            renderPromptManager: unsupportedHelper('builtin.renderPromptManager'),
            renderPromptManagerDebounced: unsupportedHelper('builtin.renderPromptManagerDebounced'),
        },
        _bind: bind, _th_impl: { _init() {}, _log() {}, _clearLog() {},
            writeExtensionField: async (characterId, key, value) => {
                const card = context.characters[characterId];
                await client.post('/api/characters/merge-attributes', { avatar: card.avatar, data: { extensions: { [key]: value } } });
                card.data.extensions[key] = value;
            } },
    };
    globalThis.TavernHelper = publicApi;
    for (const [name, value] of Object.entries(publicApi)) if (!name.startsWith('_')) globalThis[name] = value;

    function iframe(id, content, script = false) {
        const frame = document.createElement('iframe'); frame.id = frame.name = id;
        frame.title = script ? '角色卡脚本' : '角色卡内容'; frame.style.width = '100%';
        frame.dataset.vcCardKind = script ? 'script' : 'html'; frame.setAttribute('frameborder', '0');
        if (script) frame.hidden = true;
        const jquery = script ? `<script src="${iframeBase}parent_jquery.js"></script>` : `<link rel="stylesheet" href="${vendor}fontawesome-free-7.3.1/css/all.min.css"><script src="/scripts/extensions/third-party/JS-Slash-Runner/lib/tailwindcss.min.js"></script><script src="${vendor}jquery-4.0.0/jquery.min.js"></script><script src="${vendor}jquery-ui-1.14.2/jquery-ui.min.js"></script><link rel="stylesheet" href="${vendor}jquery-ui-1.14.2/theme.css"><script src="${vendor}jquery-ui-touch-punch-0.2.3/jquery.ui.touch-punch.min.js"></script>`;
        const config = settings.extension_settings.tavern_helper?.render || {};
        const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base href="${location.origin}/">${jquery}<script src="${vendor}vue-3.5.44/vue.runtime.global.prod.js"></script><script src="${vendor}vue-router-5.4.0/vue-router.global.prod.js"></script><script src="${base}predefine.js"></script>${script ? config.use_cleanup_protector ? `<script src="${iframeBase}cleanup_protector.js"></script>` : '' : `<script src="${iframeBase}adjust_viewport.js"></script><script src="${iframeBase}adjust_iframe_height.js"></script>`}</head><body>${content}</body></html>`;
        if (config.use_blob_url) { const url = URL.createObjectURL(new Blob([html], { type: 'text/html' })); frame.src = url; frameUrls.set(frame, url); }
        else frame.srcdoc = html;
        bindFrameInstance(frame, hostOwner);
        frame.addEventListener('load', () => {
            if (destroyed || hostOwner.destroyed) return;
            bindFrameInstance(frame, hostOwner);
            if (script && globalThis.Mvu) hostOwner.mvu = globalThis.Mvu;
            void context.eventSource.emit('message_iframe_render_ended', frame.id);
        });
        return frame;
    }
    function releaseFrames(node) {
        if (!node) return;
        for (const frame of node.querySelectorAll('iframe')) {
            disposeFrameInstance(frame);
            const url = frameUrls.get(frame); if (url) { URL.revokeObjectURL(url); frameUrls.delete(frame); }
            frame.remove();
        }
    }
    async function closeScripts() {
        historyLifetime.abort();
        historyLifetime = new AbortController();
        chatOpenSignal = undefined;
        const activeMvu = hostOwner.mvu;
        // Helper/MVU使用真实pagehide生命周期，等待其取消、解绑和唯一实例注销后才更换context。
        for (const frame of scriptFrames.querySelectorAll('iframe')) {
            const view = frame.contentWindow, jquery = view?.jQuery;
            if (jquery) { await jquery(view).triggerHandler('pagehide'); jquery(view).off('pagehide'); }
        }
        releaseFrames(scriptFrames); scriptFrames.replaceChildren(); ownerScripts.clear(); actions.replaceChildren();
        if (getCardHost() === hostOwner || (activeMvu && globalThis.Mvu === activeMvu)) {
            delete globalThis.Mvu;
        }
        hostOwner.mvu = null;
    }
    function mountHtml(node, index) {
        if (destroyed || hostOwner.destroyed || !isCardExecutionAllowed(hostOwner)) return;
        const config=settings.extension_settings.tavern_helper?.render || {};
        if (config.enabled === false || !eligible(index,config.depth || 0,config.depth_ignore_hidden)) return;
        let number = 0;
        for (const pre of node.querySelectorAll('pre')) {
            const content = pre.textContent || '';
            if (!['html>', '<head>', '<body'].some(tag => content.includes(tag))) continue;
            const frame = iframe(`TH-message--${index}--${number++}`, content);
            const container = document.createElement('div'); container.className = 'TH-render';
            pre.replaceWith(container); container.append(frame);
            void context.eventSource.emit('message_iframe_render_started', frame.id);
        }
    }
    function eligible(index,depth,ignoreHidden) {
        if(ignoreHidden&&context.chat[index]?.is_system)return false;
        if(depth===0)return true;
        let remaining=depth;
        for(let at=context.chat.length-1;at>=0;at--){if(ignoreHidden&&context.chat[at]?.is_system)continue;if(at===index)return remaining>0;if(--remaining===0)return false;}
        return false;
    }
    function decorateCodes(parent,{afterHtml=false}={}) {
        const config=settings.extension_settings.tavern_helper?.render || {};
        for(const pre of parent.querySelectorAll('pre')){
            if(Object.hasOwn(pre.dataset,'vcCode'))continue;
            const text=pre.textContent || '',frontend=['html>','<head>','<body'].some(tag=>text.includes(tag)),code=pre.querySelector('code');
            if(frontend&&!afterHtml)continue;pre.dataset.vcCode='';
            if(code&&(!config.optimize_hljs||!frontend))hljs.highlightElement(code);
            const copy=document.createElement('button');copy.type='button';copy.className='vc-link vc-code-copy';copy.textContent='复制';
            copy.addEventListener('click',()=>{if(copy.isConnected)void navigator.clipboard.writeText(text);});pre.append(copy);
            if(config.enabled!==false&&(config.collapse_code_block==='all'||config.collapse_code_block==='frontend_only'&&frontend)){
                const details=document.createElement('details'),summary=document.createElement('summary');details.className='vc-code-block';summary.textContent=frontend?'显示前端代码块':'显示代码块';
                pre.replaceWith(details);details.append(summary,pre);details.addEventListener('toggle',()=>{summary.textContent=(details.open?'隐藏':'显示')+(frontend?'前端代码块':'代码块');});
            }
        }
    }
    const drawActions = () => {
        if (destroyed || hostOwner.destroyed) return;
        actions.replaceChildren();
        for (const [id, script] of ownerScripts) {
            if (!script.button.enabled) continue;
            for (const button of script.button.buttons) {
                if (!button.visible) continue;
                const node = document.createElement('button'); node.type = 'button'; node.className = 'vc-btn'; node.textContent = button.name;
                node.addEventListener('click', () => { if (!destroyed && !hostOwner.destroyed) void context.eventSource.emit(getButtonId(id, button.name)); }); actions.append(node);
            }
        }
    };
    onScriptButtonsChanged(drawActions, hostOwner);
    const api = { surface, bindContext: refreshCardHost, closeScripts, getPreset: presetsApi.getPreset,
        getEnabledExtensions: () => getEnabledCardExtensions(hostOwner),
        destroy() {
            if (destroyed) return;
            destroyed = true;
            hostOwner.destroyed = true;
            historyLifetime.abort();
            openSerial++;
            context.eventSource.removeListener?.(context.eventTypes.GENERATE_AFTER_DATA, onGenerateAfterData);
            ejs?.destroy?.();
            disposeFrameInstance(hostOwner);
            for (const entry of nodes.values()) {
                for (const timer of entry.timers) clearTimeout(timer);
                entry.timers.clear();
                releaseFrames(entry.node);
            }
            nodes.clear();
            for (const frame of scriptFrames.querySelectorAll('iframe')) {
                const view = frame.contentWindow, jquery = view?.jQuery;
                try {
                    if (jquery) {
                        jquery(view).triggerHandler('pagehide');
                        jquery(view).off('pagehide');
                    }
                } catch {}
            }
            releaseFrames(scriptFrames);
            scriptFrames.remove();
            ownerScripts.clear();
            actions.replaceChildren();
            actions.remove();
            if (getCardHost() === hostOwner) {
                if (globalThis.SillyTavern?.getContext?.() === context) delete globalThis.SillyTavern;
                if (globalThis.TavernHelper === publicApi) {
                    delete globalThis.TavernHelper;
                    for (const [name, value] of Object.entries(publicApi)) {
                        if (!name.startsWith('_') && globalThis[name] === value) delete globalThis[name];
                    }
                }
                delete globalThis.Mvu;
                delete globalThis.EjsTemplate;
                if (ejs?.z && globalThis.z === ejs.z) delete globalThis.z;
                clearCardHost(hostOwner);
            } else if (hostOwner.mvu && globalThis.Mvu === hostOwner.mvu) {
                delete globalThis.Mvu;
            }
            hostOwner.mvu = null;
        },
        async configure({ restartScripts = false } = {}) {
            if (destroyed || hostOwner.destroyed) return;
            if (ejs?.settings) {
                Object.assign(ejs.settings, settings.extension_settings.EjsTemplate || {});
                if (!isEjsExtensionEnabled(hostOwner)) {
                    ejs.settings.enabled = false;
                }
            }
            refreshCardHost();
            if (!isHelperExtensionEnabled(hostOwner)) {
                await closeScripts();
            } else if (restartScripts && context.characters[context.characterId]) {
                await closeScripts();
                if (destroyed || hostOwner.destroyed) return;
                await api.open();
            }
            if (destroyed || hostOwner.destroyed) return;
            await surface.refresh([...nodes.keys()]);
        },
        mountCardActions(node) { node.append(actions); return () => actions.remove(); },
        renderMessage(node, index, message, streaming) {
            if (destroyed || hostOwner.destroyed) return () => {};
            const signature = signatureOf(message);
            const isStreaming = Boolean(streaming);
            const prev = byNode.get(node);
            if (prev && prev.message === message && prev.signature === signature && prev.streaming === isStreaming && node.querySelector('.mes_text')) {
                if (prev.index !== index) {
                    if (nodes.get(prev.index) === prev) nodes.delete(prev.index);
                    prev.index = index;
                    rebindMessageFrames(node, index);
                }
                nodes.set(index, prev);
                return prev.cleanup;
            }
            if (prev) {
                for (const timer of prev.timers) clearTimeout(timer);
                prev.timers.clear();
                if (nodes.get(prev.index) === prev) nodes.delete(prev.index);
            }
            const ticket = ++serial;
            const entry = {
                node,
                index,
                message,
                ticket,
                timers: new Set(),
                signature,
                formattedSignature: prev && prev.message === message ? prev.formattedSignature : '',
                streaming: isStreaming,
                rendered: false,
                cleanup: () => {
                    if (byNode.get(node) !== entry) return;
                    byNode.delete(node);
                    for (const timer of entry.timers) clearTimeout(timer);
                    entry.timers.clear();
                    if (nodes.get(entry.index) === entry) nodes.delete(entry.index);
                    node.removeAttribute('data-vc-segs');
                    releaseFrames(node);
                    node.replaceChildren();
                },
            };
            byNode.set(node, entry);
            nodes.set(index, entry);
            const ready = context.chat[index] === message;
            if (!ready) { const text = document.createElement('div'); text.className = 'mes_text'; text.textContent = message.mes; node.replaceChildren(text); }
            else if (isStreaming) {format(index, message);if(settings.extension_settings.tavern_helper?.render?.allow_streaming)mountHtml(node,index);}
            else {
                if (!node.querySelector('.mes_text')) format(index, message);
                void schedule(index).catch(() => { node.setAttribute('data-card-error', ''); });
            }
            return entry.cleanup;
        },
        isRendering: () => pending.size > 0,
        async settle() { await Promise.allSettled([...pending]); await Promise.all(context.cardWrites?.splice(0) || []); },
        async open({ signal } = {}) {
            if (destroyed || hostOwner.destroyed) return;
            const myOpenTicket = ++openSerial;
            await Promise.allSettled([...pending]);
            if (destroyed || hostOwner.destroyed || myOpenTicket !== openSerial) return;
            await closeScripts();
            if (destroyed || hostOwner.destroyed || myOpenTicket !== openSerial) return;
            activeMetadata = context.chatMetadata;
            chatOpenSignal = signal;
            if (!isHelperExtensionEnabled(hostOwner)) {
                drawActions();
                return;
            }
            const helper = settings.extension_settings.tavern_helper || {};
            const enabled = helper.script?.enabled || {};
            const card = context.characters[context.characterId];
            const trees = [];
            if (enabled.global !== false) trees.push({ type: 'global', entries: helper.script?.scripts || [] });
            const presetName = settings.oai_settings.preset_settings_openai;
            if (enabled.presets?.includes(presetName)) trees.push({ type: 'preset', entries: options.presets[presetName]?.extensions?.tavern_helper?.scripts || [] });
            if (card && enabled.characters?.includes(card.avatar)) trees.push({ type: 'character', entries: card.data.extensions.tavern_helper?.scripts || [] });
            const flatten = entries => entries.flatMap(entry => entry.type === 'folder' ? (entry.enabled === false ? [] : flatten(entry.scripts || entry.children || [])) : entry.enabled === false ? [] : [entry]);
            const enabledScripts = trees.flatMap(group => flatten(group.entries).map(script => ({ script, type: group.type })));
            for (const { script, type } of enabledScripts.sort((a, b) => a.script.id.localeCompare(b.script.id))) {
                const value = createScriptState(script, type, hostOwner);
                ownerScripts.set(value.id, value);
                const content = value.content.replaceAll('/user/files/mvu-bundle-d03b7dc8.js', '/scripts/extensions/third-party/JS-Slash-Runner/lib/mvu-desktop.js');
                scriptFrames.append(iframe(`TH-script--character--${value.id}`, `<script type="module">${content}</script>`, true));
            }
            drawActions();
            if (enabledScripts.some(({ script }) => script.content?.includes('/user/files/mvu-bundle-d03b7dc8.js'))) {
                try {
                    await waitUntil(() => {
                        signal?.throwIfAborted();
                        if (destroyed || hostOwner.destroyed || myOpenTicket !== openSerial) return true;
                        const ready = Boolean(globalThis.Mvu && (context.chat.length === 0 || context.chat.some(message => message.variables?.some(value => value?.stat_data))));
                        if (ready) hostOwner.mvu = globalThis.Mvu;
                        return ready;
                    }, { timeout: 25000 });
                } catch (error) {
                    if (myOpenTicket === openSerial && !destroyed && !hostOwner.destroyed) {
                        await closeScripts();
                    }
                    throw error;
                }
            }
        },
    };
    signal?.addEventListener?.('abort', () => api.destroy(), { once: true });
    return api;
}
