// 仅供摘取的 ST 计算模块消费的状态端口；无页面、启动器、生成服务或持久化副本。
import * as variables from './st/scripts/variables.js';
export { quietConsole } from './diagnostics.js';
export { inject_ids } from './st/constants.js';
export { event_types } from './st/events.js';
export { getGroupNames, getGroupCharacterCardsLazy } from './st/scripts/group-chats.js';
export { parseExampleIntoIndividual } from './st/scripts/openai.js';

export let chat, chat_metadata, characters, this_chid, name1, name2, groups, selected_group;
export let power_user, extension_settings, extension_prompts, eventSource, oai_settings;
export let model_list, openrouter_website_model;
export const main_api = 'openai'; // 本项目受控三协议均使用现有 ST chat-completions 桥。
export let textgenerationwebui_banned_in_macros = [];
let current;
const local = { get: variables.getLocalVariable, set: variables.setLocalVariable, add: variables.addLocalVariable,
    inc: variables.incrementLocalVariable, dec: variables.decrementLocalVariable, has: variables.existsLocalVariable, del: variables.deleteLocalVariable };
const global = { get: variables.getGlobalVariable, set: variables.setGlobalVariable, add: variables.addGlobalVariable,
    inc: variables.incrementGlobalVariable, dec: variables.decrementGlobalVariable, has: variables.existsGlobalVariable, del: variables.deleteGlobalVariable };
const macroContext = { variables: { local, global } };

export function bindEngineContext(context, settings, environment) {
    current = { context, settings, ...environment };
    chat = context.chat; chat_metadata = context.chatMetadata; characters = context.characters; this_chid = context.characterId;
    name1 = context.name1; name2 = context.name2; groups = context.groups || []; selected_group = context.groupId || null;
    power_user = settings.power_user; extension_settings = settings.extension_settings; oai_settings = settings.oai_settings;
    extension_prompts = context.extensionPrompts; eventSource = context.eventSource;
    model_list = environment.models; openrouter_website_model = environment.openrouterWebsiteModel;
    Object.assign(macroContext, context, { variables: { local, global } });
    textgenerationwebui_banned_in_macros = [];
}
export const getContext = () => macroContext;
export const readInput = () => current.input;
export const readFirstDisplayedMessageId = () => current.firstDisplayedMessageId;
export const getCurrentChatId = () => current.context.chatId;
export const getGeneratingModel = () => current.model;
export const getMaxContextTokens = () => oai_settings.openai_max_context;
export const getMaxResponseTokens = () => oai_settings.openai_max_tokens;
export function getMaxPromptTokens(override = null) {
    if (typeof override !== 'number' || override <= 0 || isNaN(override)) override = null;
    return getMaxContextTokens() - (override || getMaxResponseTokens());
}
export const isMobile = () => current.mobile;
export const getCurrentLocale = () => current.locale;
export const findExtension = name => current.extensions.find(extension => extension.name === name && extension.enabled);
export const saveMetadataDebounced = () => { current.context.metadataDirty = true; };
export const saveSettingsDebounced = () => { current.context.settingsDirty = true; };
