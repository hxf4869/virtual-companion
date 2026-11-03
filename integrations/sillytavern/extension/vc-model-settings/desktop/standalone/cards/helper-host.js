// Helper 的实际状态/持久化/渲染端口。原变量、事件和消息算法保留在 helper-*.js。
import { getCardHost, getThumbnailUrl } from './ejs-host.js';
import { chat, this_chid, characters } from '../engine/ports.js';
import { getStringHash } from '../engine/st/scripts/utils.js';
import { klona } from './klona.js';

export let z;
export const setHelperSchemaLibrary = value => { z = value; };
export const scripts = new Map();
export let notifyScriptButtons = () => {};
export const onScriptButtonsChanged = callback => { notifyScriptButtons = callback; };
const schemas = {};
export const useVariableSchemasStore = () => schemas;
export const useScriptIframeRuntimesStore = () => ({ get: id => scripts.get(id), get button_map() {
    return Object.fromEntries([...scripts].filter(([, script]) => script.button.enabled).map(([id, script]) => [id,
        script.button.buttons.filter(button => button.visible).map(button => ({ button_id: getButtonId(id, button.name), button_name: button.name }))]));
} });
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
export function createScriptState(script, type) {
    const host = getCardHost(), card = characters[this_chid], presetName = host.settings.oai_settings.preset_settings_openai;
    const state = klona(script);
    state.button ||= { enabled: false, buttons: [] };
    const persist = () => {
        Object.assign(script, { data: klona(state.data), button: klona(state.button), info: state.info });
        if (type === 'global') { host.context.saveSettingsDebounced(); return; }
        if (type === 'character') queueScopeWrite('/api/characters/merge-attributes', { avatar: card.avatar,
            data: { extensions: { tavern_helper: card.data.extensions.tavern_helper } } });
        else {
            const preset = host.presets[presetName];
            host.settings.oai_settings.extensions ||= {};
            host.settings.oai_settings.extensions.tavern_helper = preset.extensions.tavern_helper;
            host.context.saveSettingsDebounced();
            queueScopeWrite('/api/presets/save', { apiId: 'openai', name: presetName, preset });
        }
    };
    state.button = new Proxy(state.button, { set(target, key, value) { target[key] = value; persist(); return true; } });
    return new Proxy(state, { set(target, key, value) { target[key] = value; if (['data', 'info', 'button'].includes(key)) persist(); return true; } });
}

let scopeWrite = Promise.resolve();
function queueScopeWrite(url, body) {
    const { client, context } = getCardHost(), frozen = JSON.stringify(body);
    const write = scopeWrite.catch(() => {}).then(() => client.post(url, frozen));
    scopeWrite = write;
    context.cardWrites ||= []; context.cardWrites.push(write);
    void write.catch(() => {}); // owner.settle保留并报告失败，不产生未处理Promise。
}
