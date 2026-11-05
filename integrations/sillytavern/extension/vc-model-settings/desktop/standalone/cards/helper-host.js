// Helper 的实际状态/持久化/渲染端口。原变量、事件和消息算法保留在 helper-*.js。
import { getCardHost, getThumbnailUrl, isCardExecutionAllowed } from './ejs-host.js';
import { chat, this_chid, characters } from '../engine/ports.js';
import { getStringHash } from '../engine/st/scripts/utils.js';
import { klona } from './klona.js';
export { isCardExecutionAllowed };

export const GLOBAL_INSTANCE_TOKEN = Object.freeze({ global: true });
let instanceSeq = 0;
const knownTokens = new WeakSet();
const disposedTokens = new WeakSet();
const frameTokens = new WeakMap();
const callerTokens = new WeakMap();
const instanceCleanups = new WeakMap();
const frameOwners = new WeakMap();

export function bindFrameInstance(frame, owner = getCardHost()) {
    if (!frame || (typeof frame !== 'object' && typeof frame !== 'function')) return GLOBAL_INSTANCE_TOKEN;
    if (owner) {
        frameOwners.set(frame, owner);
    }
    let token = frameTokens.get(frame);
    if (!token) {
        token = { id: ++instanceSeq };
        knownTokens.add(token);
        frameTokens.set(frame, token);
    }
    try {
        if (frame.contentWindow && typeof frame.contentWindow === 'object') {
            frameTokens.set(frame.contentWindow, token);
            callerTokens.set(frame.contentWindow, token);
            if (owner) {
                frameOwners.set(frame.contentWindow, owner);
            }
        }
    } catch {
        // Ignore cross-origin or detached contentWindow errors
    }
    return token;
}

export function getFrameOwner(frameOrCaller) {
    if (!frameOrCaller || (typeof frameOrCaller !== 'object' && typeof frameOrCaller !== 'function')) return undefined;
    if (frameOwners.has(frameOrCaller)) return frameOwners.get(frameOrCaller);
    try {
        if (frameOrCaller.frameElement && frameOwners.has(frameOrCaller.frameElement)) {
            return frameOwners.get(frameOrCaller.frameElement);
        }
    } catch {
        // ignore detached frameElement errors
    }
    return undefined;
}

export function resolveInstanceToken(target, create = true) {
    if (
        !target ||
        target === globalThis ||
        target === 'global' ||
        target === GLOBAL_INSTANCE_TOKEN ||
        (typeof target !== 'object' && typeof target !== 'function')
    ) {
        return GLOBAL_INSTANCE_TOKEN;
    }
    if (knownTokens.has(target)) {
        return target;
    }
    let frame = null;
    try {
        if (target.frameElement && (typeof target.frameElement === 'object' || typeof target.frameElement === 'function')) {
            frame = target.frameElement;
        }
    } catch {
        frame = null;
    }
    if (frame) {
        let token = frameTokens.get(frame);
        if (!token && create) {
            token = bindFrameInstance(frame);
        }
        if (token) {
            callerTokens.set(target, token);
            return token;
        }
        if (!create) return null;
    }
    const existing = frameTokens.get(target) || callerTokens.get(target);
    if (existing) return existing;
    if (!create) return null;
    const token = { id: ++instanceSeq };
    knownTokens.add(token);
    callerTokens.set(target, token);
    return token;
}

export function getInstanceToken(caller) {
    return resolveInstanceToken(caller, true);
}

export function registerInstanceCleanup(target, fn) {
    if (typeof fn !== 'function') return () => {};
    const token = resolveInstanceToken(target, true);
    if (!token || token === GLOBAL_INSTANCE_TOKEN) return () => {};
    if (disposedTokens.has(token)) {
        try { fn(); } catch { /* ignore cleanup error */ }
        return () => {};
    }
    let set = instanceCleanups.get(token);
    if (!set) {
        set = new Set();
        instanceCleanups.set(token, set);
    }
    set.add(fn);
    return () => {
        set.delete(fn);
    };
}

export function disposeFrameInstance(frameOrCaller) {
    const token = resolveInstanceToken(frameOrCaller, false);
    if (!token || token === GLOBAL_INSTANCE_TOKEN) return;
    disposedTokens.add(token);
    const set = instanceCleanups.get(token);
    if (!set) return;
    instanceCleanups.delete(token);
    for (const fn of [...set]) {
        try {
            fn();
        } catch {
            // Ensure all cleanups run even if one throws
        }
    }
}

export function isInstanceDisposed(target) {
    const token = resolveInstanceToken(target, false);
    return Boolean(token && token !== GLOBAL_INSTANCE_TOKEN && disposedTokens.has(token));
}

export let z;
export const setHelperSchemaLibrary = value => { z = value; };
const fallbackScripts = new Map();
let fallbackNotifyScriptButtons = () => {};
const fallbackSchemas = {};
export function getOwnerScripts(host = getCardHost()) {
    if (!host) return fallbackScripts;
    return (host.scripts ||= new Map());
}
export const scripts = {
    get(id) { return getOwnerScripts().get(id); },
    set(id, value) { return getOwnerScripts().set(id, value); },
    has(id) { return getOwnerScripts().has(id); },
    delete(id) { return getOwnerScripts().delete(id); },
    clear() { getOwnerScripts().clear(); },
    keys() { return getOwnerScripts().keys(); },
    values() { return getOwnerScripts().values(); },
    entries() { return getOwnerScripts().entries(); },
    [Symbol.iterator]() { return getOwnerScripts()[Symbol.iterator](); },
    get size() { return getOwnerScripts().size; },
};
export const notifyScriptButtons = (host = getCardHost()) => {
    const fn = host?.notifyScriptButtons || fallbackNotifyScriptButtons;
    fn();
};
export const onScriptButtonsChanged = (callback, host = getCardHost()) => {
    if (host) {
        host.notifyScriptButtons = callback;
    } else {
        fallbackNotifyScriptButtons = callback;
    }
};
export const useVariableSchemasStore = (host = getCardHost()) => {
    if (!host) return fallbackSchemas;
    return (host.schemas ||= {});
};
export const useScriptIframeRuntimesStore = (host = getCardHost()) => {
    const activeScripts = getOwnerScripts(host);
    return {
        get: id => activeScripts.get(id),
        get button_map() {
            return Object.fromEntries(
                [...activeScripts]
                    .filter(([, script]) => script.button.enabled)
                    .map(([id, script]) => [
                        id,
                        script.button.buttons
                            .filter(button => button.visible)
                            .map(button => ({
                                button_id: getButtonId(id, button.name),
                                button_name: button.name,
                            })),
                    ]),
            );
        },
    };
};
export const getButtonId = (id, name) => `${id}_${getStringHash(name)}`;
export const normalizeMessageId = id => id < 0 ? chat.length + id : id;
export const saveChatConditionalDebounced = () => getCardHost().context.saveMetadataDebounced();
export const saveMetadataDebounced = saveChatConditionalDebounced;
export const saveSettingsDebounced = () => getCardHost().context.saveSettingsDebounced();
export const useCharacterSettingsStore = () => ({ avatar: characters[this_chid]?.avatar,
    settings: characters[this_chid].data.extensions.tavern_helper ||= { scripts: [], variables: {} } });
export const usePresetSettingsStore = () => {
    const { settings, presets } = getCardHost();
    const preset = presets[settings.oai_settings.preset_settings_openai] || settings.oai_settings;
    preset.extensions ||= {}; return { settings: preset.extensions.tavern_helper ||= { scripts: [], variables: {} } };
};
export function toRef(object, key) {
    return { get value() { return object[key]; }, set value(value) {
        object[key] = value;
        const { context, client, settings, presets } = getCardHost(), card = characters[this_chid];
        if (object === card?.data.extensions.tavern_helper) {
            queueScopeWrite('/api/characters/merge-attributes', { avatar: card.avatar,
                data: { extensions: { tavern_helper: object } } });
        } else {
            const name = settings.oai_settings.preset_settings_openai, preset = presets[name] || settings.oai_settings;
            settings.oai_settings.extensions ||= {}; settings.oai_settings.extensions.tavern_helper = object;
            context.saveSettingsDebounced();
            queueScopeWrite('/api/presets/save', { apiId: 'openai', name, preset });
        }
    } };
}
export async function refreshMessages(refresh, indices, options) {
    const { context, surface } = getCardHost();
    context.saveMetadataDebounced();
    if (refresh !== 'none') await surface.refresh(refresh === 'all' ? chat.map((_, index) => index) : indices, options);
}
export async function waitUntil(predicate, { timeout = 5000, intervalBetweenAttempts = 50 } = {}) {
    const start = Date.now();
    while (!await predicate()) {
        if (Date.now() - start >= timeout) throw new Error('卡片运行模块等待超时');
        await new Promise(resolve => setTimeout(resolve, intervalBetweenAttempts));
    }
}
export const getCharAvatarPath = () => getThumbnailUrl('avatar', characters[this_chid]?.avatar);
export const getUserAvatarPath = () => getThumbnailUrl('persona', getCardHost().context.userAvatar);

// 对接原Helper store的三个可写脚本字段，不创建第二份持久化模型。
export function createScriptState(script, type, host = getCardHost()) {
    const ownerScripts = getOwnerScripts(host);
    const card = characters[this_chid], presetName = host.settings.oai_settings.preset_settings_openai;
    const state = klona(script);
    state.button ||= { enabled: false, buttons: [] };
    let proxyState;
    const isActiveState = () => Boolean(proxyState && !host?.destroyed && getCardHost() === host && ownerScripts.get(state.id) === proxyState);
    const persist = () => {
        if (!isActiveState()) return;
        Object.assign(script, { data: klona(state.data), button: klona(state.button), info: state.info });
        if (type === 'global') { host.context.saveSettingsDebounced(); return; }
        if (type === 'character') queueScopeWrite('/api/characters/merge-attributes', { avatar: card.avatar,
            data: { extensions: { tavern_helper: card.data.extensions.tavern_helper } } }, host);
        else {
            const preset = host.presets[presetName];
            host.settings.oai_settings.extensions ||= {};
            host.settings.oai_settings.extensions.tavern_helper = preset.extensions.tavern_helper;
            host.context.saveSettingsDebounced();
            queueScopeWrite('/api/presets/save', { apiId: 'openai', name: presetName, preset }, host);
        }
    };
    state.button = new Proxy(state.button, {
        set(target, key, value) {
            if (!isActiveState()) return true;
            target[key] = value;
            persist();
            return true;
        },
    });
    proxyState = new Proxy(state, {
        set(target, key, value) {
            if (!isActiveState()) return true;
            target[key] = value;
            if (['data', 'info', 'button'].includes(key)) persist();
            return true;
        },
    });
    return proxyState;
}

let scopeWrite = Promise.resolve();
function queueScopeWrite(url, body, host = getCardHost()) {
    const { client, context } = host, frozen = JSON.stringify(body);
    const write = scopeWrite.catch(() => {}).then(() => {
        if (url === '/api/presets/save') { const body = JSON.parse(frozen); return client.savePreset(body.apiId, body.name, () => host.presets[body.name] || host.settings.oai_settings); }
        return client.post(url, frozen);
    });
    scopeWrite = write;
    context.cardWrites ||= []; context.cardWrites.push(write);
    void write.catch(() => {}); // owner.settle保留并报告失败，不产生未处理Promise。
}
