// 桌面卡片运行入口。只运行卡片HTML/脚本iframe与锁定EJS handler；没有ST页面宿主。
import { lodash, yaml, showdown } from '/lib.js';
import { bindCardHost, refreshCardHost, messageFormatting, getCardHost, getChatCompletionModel, getTokenCountAsync, loadWorldInfo,
    getRegexedString, getThumbnailUrl, MessageFormatter } from './ejs-host.js';
import { scripts, createScriptState, setHelperSchemaLibrary, notifyScriptButtons, onScriptButtonsChanged, waitUntil, getButtonId } from './helper-host.js';
import * as variables from './helper-variables.js';
import * as events from './helper-event.js';
import * as util from './helper-util.js';
import * as scriptApi from './helper-script.js';
import * as globals from './helper-global.js';
import * as messages from './helper-message.js';
import * as books from './helper-worldbook.js';
import { klona } from './klona.js';
import { ToolManager } from '../engine/tools.js';
import { substituteParamsExtended, getCharacterCardFields } from '../engine/st/script.js';
import { MacrosParser } from '../engine/st/scripts/macros.js';
import { openSheet } from '../../../ui/sheet.js';
import { renderReplyBubbles } from '../../../chat-view.js';
import { confirmAlert } from '../../../ui/alert.js';

const base = new URL('./', import.meta.url).href;
const vendor = '/scripts/extensions/third-party/JS-Slash-Runner/lib/vendor/';
const loadScript = src => new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = src; script.onload = resolve; script.onerror = reject; document.head.append(script);
});

export async function initializeCards(options) {
    const { context, settings, client } = options;
    const version = await fetch('/version').then(response => response.json()).then(value => value.pkgVersion);
    if (!globalThis.jQuery) await loadScript('/lib/jquery-3.5.1.min.js');
    if (!globalThis.jQuery.ui) await loadScript('/lib/jquery-ui.min.js');
    if (!globalThis.toastr) { await loadScript('/lib/toastr.min.js'); const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/css/toastr.min.css'; document.head.append(css); }
    Object.assign(globalThis, { _: lodash, YAML: yaml, showdown, klona });
    const nodes = new Map(), pending = new Set(), frameUrls = new Map();
    let ejs, serial = 0, activeMetadata, renderQueue = Promise.resolve();
    const actions = document.createElement('div'); actions.className = 'vc-card-actions';
    const scriptFrames = document.createElement('div'); scriptFrames.dataset.vcCardScripts = '';
    document.body.append(scriptFrames);
    function valid(node, index, message, ticket) {
        return node.isConnected && nodes.get(index)?.ticket === ticket && context.chat[index] === message;
    }
    function format(index, message = context.chat[index]) {
        const node = nodes.get(index)?.node;
        if (node && message) {
            releaseFrames(node);
            const entry = nodes.get(index); for (const timer of entry.timers) clearTimeout(timer); entry.timers.clear();
            node.removeAttribute('data-vc-segs'); node.classList.remove('vc-segmented');
            const content = document.createElement('div'); content.className = 'mes_text';
            content.innerHTML = messageFormatting(message.extra?.display_text || message.mes,
                message.name, message.is_system, message.is_user, index);
            content.dataset.vcFormatted = ''; node.replaceChildren(content);
        }
    }
    async function render(index, { evaluate = true } = {}) {
        const entry = nodes.get(index), message = context.chat[index];
        if (!entry || !message) return;
        const { node, ticket } = entry;
        format(index, message);
        if (evaluate) await ejs.render(String(index), 'desktop', true);
        if (!valid(node, index, message, ticket)) return;
        mountHtml(node, index);
        if (context.chatMetadata.vc_binding?.mode === 'COMPANION' && !message.is_user && !message.is_system
            && !message.extra?.vc_voice && !/<%|<script|```/.test(message.mes) && !node.querySelector('iframe, img, video, .TH-render')) {
            renderReplyBubbles(node, message.extra?.display_text || message.mes, { reducedMotion: message !== context.liveReply,
                schedule(fn, delay) { const timer = setTimeout(() => { entry.timers.delete(timer); if (valid(node, index, message, ticket)) fn(); }, delay); entry.timers.add(timer); } });
        }
    }
    const track = promise => { pending.add(promise); void promise.finally(() => pending.delete(promise)).catch(() => {}); return promise; };
    const schedule = (index, options) => {
        // 原EJS STATE/cache是单一可变闭包，历史渲染必须沿消息顺序串行。
        const operation = renderQueue.catch(() => {}).then(() => render(index, options));
        renderQueue = operation; return track(operation);
    };
    const surface = { format, async refresh(indices, options) {
        await new Promise(resolve => requestAnimationFrame(resolve));
        for (const index of indices) await schedule(index, options);
    }, codeBlocks() {}, media() {}, reasoning() {} };
    bindCardHost({ ...options, surface });
    Object.assign(context, { getRequestHeaders: client.headers, getChatCompletionModel, getTokenCountAsync, loadWorldInfo,
        ToolManager, getCharacterCardFields, registerFunctionTool: spec => ToolManager.registerFunctionTool(spec),
        unregisterFunctionTool: name => ToolManager.unregisterFunctionTool(name), messageFormatter: MessageFormatter,
        registerMacro: (...args) => MacrosParser.registerMacro(...args), unregisterMacro: name => MacrosParser.unregisterMacro(name),
        POPUP_TYPE: { TEXT: 1, CONFIRM: 2, INPUT: 3 }, POPUP_RESULT: { AFFIRMATIVE: 1, NEGATIVE: 0, CANCELLED: null },
        async callGenericPopup(content, type, initial = '') {
            if (type === 2) return await confirmAlert({ title: '角色卡', message: String(content), action: '确认' }) ? 1 : 0;
            return new Promise(resolve => {
                const body = document.createElement('div');
                const text = document.createElement('div'); text.innerHTML = content; body.append(text);
                let input;
                if (type === 3) { input = document.createElement('input'); input.value = initial; input.className = 'vc-input'; body.append(input); }
                let result = null;
                const sheet = openSheet({ title: '角色卡', body, onDone: () => resolve(result) });
                sheet.done.addEventListener('click', () => { result = input ? input.value : 1; }, { capture: true });
            });
        } });
    Object.assign(globalThis, { SillyTavern: { getContext: () => context } });
    const runtime = await import('/scripts/extensions/third-party/ST-Prompt-Template/dist/desktop.js');
    ejs = await runtime.initializeDesktop(); setHelperSchemaLibrary(ejs.z); globalThis.z = ejs.z;

    function assertFrame(frame) {
        if (!frame.isConnected || context.chatMetadata !== activeMetadata) throw new Error('VC_STALE_CARD_RUNTIME');
    }
    const bind = {};
    for (const [name, fn] of Object.entries({ ...variables, ...events, ...util, ...scriptApi, ...globals })) {
        if (!name.startsWith('_') || typeof fn !== 'function') continue;
        bind[name] = function (...args) {
            if (!name.startsWith('_eventClear') && name !== '_eventRemoveListener') assertFrame(this.frameElement);
            const result = fn.apply(this, args);
            if (/^_(replaceScriptButtons|updateScriptButtonsWith|appendInexistentScriptButtons)$/.test(name)) {
                if (result?.then) return result.then(value => { notifyScriptButtons(); return value; });
                notifyScriptButtons();
            }
            return result;
        };
    }
    for (const [name, fn] of Object.entries({ ...messages, ...books })) {
        if (typeof fn === 'function') bind['_' + name] = function (...args) { assertFrame(this.frameElement); return fn(...args); };
    }
    const publicApi = { ...variables, ...messages, ...books, ...globals,
        getActiveScriptIds: () => [...scripts.keys()],
        getTavernHelperVersion: () => '4.11.3', getTavernVersion: () => version,
        getLastMessageId: util.getLastMessageId, getMessageId: util.getMessageId, substitudeMacros: util.substitudeMacros,
        tavern_events: events.tavern_events, iframe_events: events.iframe_events,
        builtin: { saveSettings: () => context.saveSettingsDebounced() },
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
        const jquery = script ? `<script src="${base}parent_jquery.js"></script>` : `<link rel="stylesheet" href="${vendor}fontawesome-free-7.3.1/css/all.min.css"><script src="/scripts/extensions/third-party/JS-Slash-Runner/lib/tailwindcss.min.js"></script><script src="${vendor}jquery-4.0.0/jquery.min.js"></script><script src="${vendor}jquery-ui-1.14.2/jquery-ui.min.js"></script><link rel="stylesheet" href="${vendor}jquery-ui-1.14.2/theme.css"><script src="${vendor}jquery-ui-touch-punch-0.2.3/jquery.ui.touch-punch.min.js"></script>`;
        const config = settings.extension_settings.tavern_helper?.render || {};
        const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base href="${location.origin}/">${jquery}<script src="${vendor}vue-3.5.44/vue.runtime.global.prod.js"></script><script src="${vendor}vue-router-5.4.0/vue-router.global.prod.js"></script><script src="${base}predefine.js"></script>${script ? config.use_cleanup_protector ? `<script src="${base}cleanup_protector.js"></script>` : '' : `<script src="${base}adjust_viewport.js"></script><script src="${base}adjust_iframe_height.js"></script>`}</head><body>${content}</body></html>`;
        if (config.use_blob_url) { const url = URL.createObjectURL(new Blob([html], { type: 'text/html' })); frame.src = url; frameUrls.set(frame, url); }
        else frame.srcdoc = html;
        frame.addEventListener('load', () => { void context.eventSource.emit('message_iframe_render_ended', id); });
        return frame;
    }
    function releaseFrames(node) {
        for (const frame of node.querySelectorAll('iframe')) {
            const url = frameUrls.get(frame); if (url) { URL.revokeObjectURL(url); frameUrls.delete(frame); }
            frame.remove();
        }
    }
    async function closeScripts() {
        // Helper/MVU使用真实pagehide生命周期，等待其取消、解绑和唯一实例注销后才更换context。
        for (const frame of scriptFrames.querySelectorAll('iframe')) {
            const view = frame.contentWindow, jquery = view?.jQuery;
            if (jquery) { await jquery(view).triggerHandler('pagehide'); jquery(view).off('pagehide'); }
        }
        releaseFrames(scriptFrames); scriptFrames.replaceChildren(); scripts.clear(); actions.replaceChildren();
    }
    function mountHtml(node, index) {
        if (settings.extension_settings.tavern_helper?.render?.enabled === false) return;
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
    const drawActions = () => {
        actions.replaceChildren();
        for (const [id, script] of scripts) {
            if (!script.button.enabled) continue;
            for (const button of script.button.buttons) {
                if (!button.visible) continue;
                const node = document.createElement('button'); node.type = 'button'; node.className = 'vc-btn'; node.textContent = button.name;
                node.addEventListener('click', () => { void context.eventSource.emit(getButtonId(id, button.name)); }); actions.append(node);
            }
        }
    };
    onScriptButtonsChanged(drawActions);
    return { surface, bindContext: refreshCardHost, closeScripts,
        mountCardActions(node) { node.append(actions); return () => actions.remove(); },
        renderMessage(node, index, message, streaming) {
            const ticket = ++serial; nodes.set(index, { node, ticket, timers: new Set() });
            const ready = context.chat[index] === message;
            if (!ready) { const text = document.createElement('div'); text.className = 'mes_text'; text.textContent = message.mes; node.replaceChildren(text); }
            else if (streaming) format(index, message);
            else void schedule(index).catch(() => { node.setAttribute('data-card-error', ''); });
            return () => { const entry = nodes.get(index); if (entry?.ticket === ticket) { for (const timer of entry.timers) clearTimeout(timer); nodes.delete(index); } node.removeAttribute('data-vc-segs'); releaseFrames(node); node.replaceChildren(); };
        },
        async settle() { await Promise.allSettled([...pending]); await Promise.all(context.cardWrites?.splice(0) || []); },
        async open({ signal } = {}) {
            await Promise.allSettled([...pending]);
            releaseFrames(scriptFrames); scriptFrames.replaceChildren(); scripts.clear(); actions.replaceChildren(); delete globalThis.Mvu;
            activeMetadata = context.chatMetadata;
            const helper = settings.extension_settings.tavern_helper || {};
            const enabled = helper.script?.enabled || {};
            const card = context.characters[context.characterId];
            const trees = [];
            if (enabled.global !== false) trees.push({ type: 'global', entries: helper.script?.scripts || [] });
            const presetName = settings.oai_settings.preset_settings_openai;
            if (enabled.presets?.includes(presetName)) trees.push({ type: 'preset', entries: options.presets[presetName]?.extensions?.tavern_helper?.scripts || [] });
            if (enabled.characters?.includes(card.avatar)) trees.push({ type: 'character', entries: card.data.extensions.tavern_helper?.scripts || [] });
            const flatten = entries => entries.flatMap(entry => entry.type === 'folder' ? (entry.enabled === false ? [] : flatten(entry.scripts || entry.children || [])) : entry.enabled === false ? [] : [entry]);
            const enabledScripts = trees.flatMap(group => flatten(group.entries).map(script => ({ script, type: group.type })));
            for (const { script, type } of enabledScripts.sort((a, b) => a.script.id.localeCompare(b.script.id))) {
                const value = createScriptState(script, type);
                scripts.set(value.id, value);
                const content = value.content.replaceAll('/user/files/mvu-bundle-d03b7dc8.js', '/scripts/extensions/third-party/JS-Slash-Runner/lib/mvu-desktop.js');
                scriptFrames.append(iframe(`TH-script--character--${value.id}`, `<script type="module">${content}</script>`, true));
            }
            drawActions();
            if (enabledScripts.some(({ script }) => script.content?.includes('/user/files/mvu-bundle-d03b7dc8.js'))) {
                await waitUntil(() => { signal?.throwIfAborted(); return globalThis.Mvu && context.chat.some(message => message.variables?.some(value => value?.stat_data)); }, { timeout: 25000 });
            }
        },
    };
}
