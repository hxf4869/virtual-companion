// 锁定 EJS 的直接宿主端口。只读同一会话状态；不导回原生页面/初始化器。
import { lodash, yaml } from '/lib.js';
import { createRegexRuntime } from '../engine/regex.js';
import { createTokenizer } from '../engine/tokenizers.js';
import { getChatCompletionModel as modelOf } from '../engine/st/scripts/openai.js';
import { getCharaFilename } from '../engine/st/scripts/utils.js';
import { substituteParams, substituteParamsExtended } from '../engine/st/script.js';
import { getContext, characters, this_chid, groups, selected_group, power_user, oai_settings } from '../engine/ports.js';
import { configureFormatting, messageFormatting, MessageFormatter } from './format.js';
import { accountStorage, configureAccountStorage } from './account-storage.js';
export * from '../engine/ports.js';
export { substituteParams, substituteParamsExtended, getCharaFilename, messageFormatting, MessageFormatter };

let owner;
export let user_avatar, world_info, selected_world_info, world_names;
export let world_info_case_sensitive, world_info_match_whole_words, world_info_use_group_scoring, world_info_max_recursion_steps;
export const DEFAULT_DEPTH = 4, DEFAULT_WEIGHT = 100, METADATA_KEY = 'world_info';
export const world_info_logic = { AND_ANY: 0, NOT_ALL: 1, NOT_ANY: 2, AND_ALL: 3 };
export const world_info_position = { before: 0, after: 1, ANTop: 2, ANBottom: 3, atDepth: 4, EMTop: 5, EMBottom: 6, outlet: 7 };
export const regex_placement = { USER_INPUT: 1, AI_OUTPUT: 2, SLASH_COMMAND: 3, WORLD_INFO: 5, REASONING: 6 };

export function bindCardHost(options) {
    owner = options;
    const { context, settings, packet } = owner;
    user_avatar = context.userAvatar;
    world_info = settings.world_info ||= {};
    selected_world_info = world_info.globalSelect ||= [];
    world_names = packet.world_names || [];
    world_info_case_sensitive = settings.world_info_case_sensitive ?? false;
    world_info_match_whole_words = settings.world_info_match_whole_words ?? false;
    world_info_use_group_scoring = settings.world_info_use_group_scoring ?? false;
    world_info_max_recursion_steps = settings.world_info_max_recursion_steps ?? 0;
    configureAccountStorage(() => { settings.accountStorage = accountStorage.getState(); context.saveSettingsDebounced(); });
    accountStorage.init(settings.accountStorage);
    configureFormatting({ getRegexedString, regex_placement, accountStorage, toastr: globalThis.toastr,
        t: (strings, ...values) => String.raw({ raw: strings }, ...values) });
}
export const getCardHost = () => owner;
// 每次模板求值拥有可撤销的生成作用域；异步计时器不能沿用已结束模板的授权。
export function enterTemplateScope(data) {
    const lease = owner.context.captureHelperScope?.();
    const metadata = owner.context.chatMetadata; let valid = true;
    const generate = (name, config) => {
        if (!valid || owner.context.chatMetadata !== metadata) return Promise.reject(new Error('角色卡执行上下文已失效。'));
        return owner.context.generateHelper(name,config,lease?.scope);
    };
    const previous = Object.getOwnPropertyDescriptor(data,'TavernHelper');
    Object.defineProperty(data,'TavernHelper',{configurable:true,enumerable:true,writable:true,value:{...globalThis.TavernHelper,
        generate:config=>generate('generate',config),
        generateRaw:config=>generate('generateRaw',config),
    }});
    return () => {valid=false;lease?.release();if(previous)Object.defineProperty(data,'TavernHelper',previous);else delete data.TavernHelper;};
}
export function refreshCardHost() {
    user_avatar = owner.context.userAvatar;
    world_info = owner.settings.world_info ||= {};
    selected_world_info = world_info.globalSelect ||= [];
    world_info_case_sensitive = owner.settings.world_info_case_sensitive ?? false;
    world_info_match_whole_words = owner.settings.world_info_match_whole_words ?? false;
    world_info_use_group_scoring = owner.settings.world_info_use_group_scoring ?? false;
    world_info_max_recursion_steps = owner.settings.world_info_max_recursion_steps ?? 0;
}
export const getThumbnailUrl = (type, file) => `/thumbnail?type=${encodeURIComponent(type)}&file=${encodeURIComponent(file)}`;
export const getUserAvatar = () => getThumbnailUrl('persona', owner.context.userAvatar);
export const getChatCompletionModel = () => modelOf(oai_settings);
export const getTokenCountAsync = (...args) => createTokenizer({ settings: owner.settings, models: owner.models,
    request: (url, body) => owner.client.request(url, body) }).getTokenCountAsync(...args);
export const getGroupMembers = () => groups.find(group => group.id === selected_group)?.members || [];
export const copyText = text => navigator.clipboard.writeText(text);
export const loadWorldInfo = name => owner.client.request('/api/worldinfo/get', { name });
export const getWorldInfoSettings = () => ({ ...owner.settings, world_info, world_names });
export const saveChatConditional = () => owner.context.saveChatConditional();
export const saveSettingsDebounced = () => owner.context.saveSettingsDebounced();
export function getRegexedString(...args) {
    const presetName = oai_settings.preset_settings_openai, preset = owner.presets[presetName] || oai_settings;
    return createRegexRuntime({ characters, characterId: this_chid, extensionSettings: owner.settings.extension_settings,
        substituteParams, substituteParamsExtended, getPresetManager: () => ({ apiId: 'openai', getSelectedPresetName: () => presetName,
            readPresetExtensionField: ({ path }) => lodash.get(preset.extensions, path) }) }).getRegexedString(...args);
}
// 与当前锁定 RawCharacter 的查找规则相同；不接触原生角色列表。
export const RawCharacter = { find({ name = 'current' } = {}) {
    if (name === 'current') return characters[this_chid] ?? null;
    const lowered = name.toLowerCase();
    return characters.find(character => character.name.toLowerCase() === lowered || character.avatar.toLowerCase() === lowered) ?? null;
} };
// 原解析规则，供 EJS/Helper 世界书条目的正则键使用。
export function parseRegexFromString(input) {
    const match = input.match(/^\/([\w\W]+?)\/([gimsuy]*)$/);
    if (!match) return null;
    let [, pattern, flags] = match;
    if (pattern.match(/(^|[^\\])\//)) return null;
    pattern = pattern.replace('\\/', '/');
    try { return new RegExp(pattern, flags); } catch { return null; }
}
export function updateMessageBlock(index, message) { owner.surface?.format(index, message); }
export function addCopyToCodeBlocks(parent) { owner.surface?.codeBlocks(parent?.jquery ? parent[0] : parent); }
export function appendMediaToMessage(message, parent) { owner.surface?.media(message, parent); }
export function updateReasoningUI(parent) { owner.surface?.reasoning(parent); }
export const getSTContext = getContext;
export { yaml };
