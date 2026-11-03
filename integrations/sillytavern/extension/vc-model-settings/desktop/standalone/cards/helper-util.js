// AGPL-3.0-only. Locked upstream algorithms, adapted 2026-11-03 for explicit desktop ports.
import { substituteParamsExtended } from '../engine/st/script.js';
import { z } from './helper-host.js';
const isPromise=value=>value!=null&&typeof value.then==='function';
export function _reloadIframe() {
    this.location.reload();
}
export function substitudeMacros(text) {
    return substituteParamsExtended(text);
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
