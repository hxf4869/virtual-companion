// AGPL-3.0-only. JS-Slash-Runner 0af421068 / src/iframe/exported/util.ts
// 保留本地预编译拷贝：上游为 TypeScript 源码，此处绑定 ../engine/st/script.js 的 substituteParamsExtended 与 helper-host.js 的 zod 实例。
import { chat } from '../engine/ports.js';
import { substituteParamsExtended } from '../engine/st/script.js';
import { createHelperMacroLike } from '../../locked-source/helper/function/macro_like.js';
import { getCardHost } from './ejs-host.js';
import { GLOBAL_INSTANCE_TOKEN, z, getFrameOwner, getInstanceToken, registerInstanceCleanup } from './helper-host.js';
import { get_variables_without_clone } from './helper-variables.js';
const isPromise=value=>value!=null&&typeof value.then==='function';

const { macros: builtinMacros } = createHelperMacroLike({
    get_variables_without_clone,
    getChat: () => getCardHost()?.context?.chat ?? chat,
});
const fallbackCustomMacros = [];
function getOwnerCustomMacros(host = getCardHost()) {
    if (!host) return fallbackCustomMacros;
    return (host.customMacros ||= []);
}

export function registerMacroLike(regex, replace) {
    const frameOwner = getFrameOwner(this);
    if (frameOwner && (frameOwner.destroyed || getCardHost() !== frameOwner)) {
        return { unregister: () => {} };
    }
    const host = getCardHost();
    const customMacros = getOwnerCustomMacros(host);
    if (
        builtinMacros.some(macro => macro.regex.source === regex.source) ||
        customMacros.some(macro => macro.regex.source === regex.source)
    ) {
        return { unregister: () => {} };
    }
    const entry = { regex, replace, owner: host };
    customMacros.push(entry);
    let removed = false;
    return {
        unregister: () => {
            if (removed) return;
            removed = true;
            const index = customMacros.indexOf(entry);
            if (index !== -1) {
                customMacros.splice(index, 1);
            }
        },
    };
}
export function _registerMacroLike(regex, replace) {
    const frameOwner = getFrameOwner(this);
    if (frameOwner && (frameOwner.destroyed || getCardHost() !== frameOwner)) {
        return { unregister: () => {} };
    }
    const host = getCardHost();
    const { unregister } = registerMacroLike.call(this, regex, replace);
    let cleaned = false;
    let disposeCleanup = null;
    const win = this && this !== globalThis.TavernHelper ? (this.window ?? this) : null;
    const jq = win?.jQuery ?? globalThis.jQuery ?? globalThis.$;
    const onceUnregister = () => {
        if (cleaned) return;
        cleaned = true;
        disposeCleanup?.();
        try {
            jq?.(win)?.off?.('pagehide', onceUnregister);
            win?.removeEventListener?.('pagehide', onceUnregister);
        } catch {}
        unregister();
    };
    const rawToken = getInstanceToken(this);
    const token = rawToken === GLOBAL_INSTANCE_TOKEN && host ? getInstanceToken(host) : rawToken;
    disposeCleanup = registerInstanceCleanup(token, onceUnregister);
    try {
        jq?.(win)?.on?.('pagehide', onceUnregister);
        win?.addEventListener?.('pagehide', onceUnregister, { once: true });
    } catch {}
    return { unregister: onceUnregister };
}
export function unregisterMacroLike(regex) {
    const frameOwner = getFrameOwner(this);
    if (frameOwner && (frameOwner.destroyed || getCardHost() !== frameOwner)) {
        return;
    }
    const customMacros = getOwnerCustomMacros(getCardHost());
    const index = customMacros.findIndex(macro => macro.regex.source === regex.source);
    if (index !== -1) {
        customMacros.splice(index, 1);
    }
}
export const _unregisterMacroLike = unregisterMacroLike;
export function replaceMacroLike(text, context = {}) {
    if (typeof text !== 'string') return text;
    const ctx = { source: 'other', ...context };
    const customMacros = getOwnerCustomMacros(getCardHost());
    return [...builtinMacros, ...customMacros].reduce((acc, macro) => {
        macro.regex.lastIndex = 0;
        return acc.replace(macro.regex, (...args) => macro.replace(ctx, ...args));
    }, text);
}
export function demacroOnPrompt(event_data, dry_run = false) {
    if (dry_run || !event_data) return;
    if (typeof event_data.prompt === 'string') {
        event_data.prompt = replaceMacroLike(event_data.prompt, { source: 'prompt' });
    } else if (Array.isArray(event_data.prompt)) {
        for (const data of event_data.prompt) {
            if (!data) continue;
            const ctx = { source: 'prompt', role: data.role };
            if (typeof data.content === 'string') {
                data.content = replaceMacroLike(data.content, ctx);
            } else if (Array.isArray(data.content)) {
                for (const item of data.content) {
                    if (item?.type === 'text' && typeof item.text === 'string') {
                        item.text = replaceMacroLike(item.text, ctx);
                    }
                }
            }
        }
    }
}
export function _reloadIframe() {
    this.location.reload();
}
export function reloadIframe(iframe_name) {
    document.querySelector(`iframe[id="${String(iframe_name).replace(/"/g, '\\"')}"]`)?.contentWindow?.location.reload();
}
export function substitudeMacros(text) {
    return replaceMacroLike(substituteParamsExtended(text), { source: 'other' });
}
export function getLastMessageId() {
    return Number(substitudeMacros('{{lastMessageId}}'));
}
export function errorCatched(fn) {
    const onError = (error) => {
        toastr.error(`<pre style="white-space: pre-wrap">${error.stack ? (error instanceof z.ZodError ? [error.message, error.stack].join('\n') : error.stack) : error.message}</pre>`, error.name, {
            escapeHtml: false,
            toastClass: 'toastr w-fit! min-w-[300px]',
        });
        throw error;
    };
    return (...args) => {
        try {
            const result = fn(...args);
            if (isPromise(result)) {
                return result.then(undefined, error => {
                    onError(error);
                });
            }
            return result;
        }
        catch (error) {
            return onError(error);
        }
    };
}
export function _errorCatched(fn) {
    const onError = (error) => {
        const iframe_name = _getIframeName.call(this);
        const message = error.stack
            ? error instanceof z.ZodError
                ? [error.message, error.stack].join('\n')
                : error.stack
            : error.message;
        toastr.error(`<pre style="white-space: pre-wrap">${message}</pre>`, `[${iframe_name}] ${error.name}`, {
            escapeHtml: false,
            toastClass: 'toastr w-fit! min-w-[300px]',
        });
        // @ts-expect-error _th_impl 是存在的
        this._th_impl._log(iframe_name, 'error', message);
        throw error;
    };
    return (...args) => {
        try {
            const result = fn(...args);
            if (isPromise(result)) {
                return result.then(undefined, error => {
                    onError(error);
                });
            }
            return result;
        }
        catch (error) {
            return onError(error);
        }
    };
}
export function _getIframeName() {
    const frameElement = this.frameElement;
    const cachedId = this.__TH_IFRAME_ID || this.name;
    if (frameElement?.id) {
        // Persist id so we can still resolve it after the iframe is removed (Firefox srcdoc teardown).
        this.__TH_IFRAME_ID = frameElement.id;
        if (!this.name) {
            this.name = frameElement.id;
        }
        return frameElement.id;
    }
    if (cachedId) {
        if (!this.name) {
            this.name = cachedId;
        }
        return cachedId;
    }
    throw new TypeError('frameElement is null while resolving iframe id');
}
export function _getScriptId() {
    const iframe_name = _getIframeName.call(this);
    if (!iframe_name.startsWith('TH-script--')) {
        throw new Error('你只能在脚本 iframe 内获取 getScriptId!');
    }
    return iframe_name.replace(/TH-script--.+--/, '');
}
export function _getCurrentMessageId() {
    return getMessageId(_getIframeName.call(this));
}
export function getMessageId(iframe_name) {
    const match = iframe_name.match(/^TH-message--(\d+)--\d+(_\d+)?$/);
    if (!match) {
        throw Error(`获取 ${iframe_name} 所在楼层 id 时出错: 不要对全局脚本 iframe 调用 getMessageId!`);
    }
    return parseInt(match[1].toString());
}
