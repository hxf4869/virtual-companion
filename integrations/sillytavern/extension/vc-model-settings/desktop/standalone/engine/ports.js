// 仅供摘取的 ST 计算模块消费的状态端口；无页面、启动器、生成服务或持久化副本。
import * as variables from './st/scripts/variables.js';
import { event_types } from './st/events.js';
export { quietConsole } from './diagnostics.js';
export { inject_ids } from './st/constants.js';
export { event_types };
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

function stripThirdPartyPrefix(name) {
    return String(name || '').replace(/^third-party\//i, '');
}

function isExtensionEnabledInSettings(rawName, baseEnabled = true) {
    if (!baseEnabled) return false;
    if (current?.enableExtensions === false) return false;
    const shortName = stripThirdPartyPrefix(rawName);
    const shortLower = shortName.toLowerCase();
    const fullLower = `third-party/${shortLower}`;
    const disabled = Array.isArray(extension_settings?.disabledExtensions)
        ? extension_settings.disabledExtensions.map(item => String(item).toLowerCase())
        : [];
    if (disabled.includes(shortLower) || disabled.includes(fullLower)) {
        return false;
    }
    if (shortLower === 'js-slash-runner' || shortLower === 'tavern_helper') {
        if (extension_settings?.tavern_helper?.enabled === false) return false;
    }
    if (shortLower === 'st-prompt-template' || shortLower === 'ejstemplate') {
        if (extension_settings?.EjsTemplate?.enabled === false) return false;
    }
    return true;
}

export function resolveRuntimeExtensions(rawExtensions = [], settingsObj = current?.settings, packet = current?.packet) {
    const extSettings = settingsObj?.extension_settings ?? extension_settings;
    const enableAll = packet?.enable_extensions !== false;
    const byKey = new Map();
    const register = item => {
        const name = typeof item === 'string' ? item : item?.name;
        if (!name) return;
        const baseEnabled = typeof item === 'object' && item !== null && 'enabled' in item ? Boolean(item.enabled) : true;
        const key = stripThirdPartyPrefix(name).toLowerCase();
        byKey.set(key, { name, baseEnabled });
    };
    if (Array.isArray(packet?.extensions)) {
        for (const ext of packet.extensions) register(ext);
    }
    const ownerExtensions = typeof current?.getEnabledExtensions === 'function' ? current.getEnabledExtensions() : [];
    if (Array.isArray(ownerExtensions)) {
        for (const ext of ownerExtensions) register(ext);
    }
    const explicitList = typeof rawExtensions === 'function' ? rawExtensions() : rawExtensions;
    if (Array.isArray(explicitList)) {
        for (const ext of explicitList) register(ext);
    }
    const prevSettings = extension_settings;
    const prevCurrent = current;
    try {
        if (extSettings) extension_settings = extSettings;
        if (!enableAll && current) current = { ...current, enableExtensions: false };
        return [...byKey.values()].map(({ name, baseEnabled }) => ({
            name,
            enabled: enableAll && isExtensionEnabledInSettings(name, baseEnabled),
        }));
    } finally {
        extension_settings = prevSettings;
        current = prevCurrent;
    }
}

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
export const readInput = () => current.readInput();
export function readFirstDisplayedMessageId() {
    const reader = current?.readFirstDisplayedMessageId ?? current?.context?.readFirstDisplayedMessageId;
    if (typeof reader === 'function') {
        const value = reader();
        if (value === null || value === undefined) return null;
        const num = Number(value);
        return Number.isInteger(num) && num >= 0 ? num : null;
    }
    const ctxVal = current?.context?.firstDisplayedMessageId;
    if (typeof ctxVal === 'number' && Number.isInteger(ctxVal) && ctxVal >= 0) {
        return ctxVal;
    }
    const fallback = current?.firstDisplayedMessageId;
    return typeof fallback === 'number' && Number.isInteger(fallback) && fallback >= 0 ? fallback : null;
}
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
export function findExtension(name) {
    if (!name || !current) return undefined;
    const targetRaw = String(name).trim();
    if (!targetRaw) return undefined;
    const targetShort = stripThirdPartyPrefix(targetRaw).toLowerCase();
    const list = resolveRuntimeExtensions(current.rawExtensions, current.settings, current.packet);
    const found = list.find(ext => {
        const extName = String(ext?.name || '');
        return extName.toLowerCase() === targetRaw.toLowerCase() || stripThirdPartyPrefix(extName).toLowerCase() === targetShort;
    });
    if (!found || !found.enabled) {
        return undefined;
    }
    return { ...found, enabled: true };
}
const macroBindings = new WeakMap();
let boundMacroBinding = null;
let lastGenerationType = '';
export const getLastGenerationType = () => lastGenerationType;
export function disposeMacroEventSource(targetEventSource = boundMacroBinding?.eventSource) {
    const binding = (targetEventSource && typeof targetEventSource === 'object')
        ? (macroBindings.get(targetEventSource) ?? (boundMacroBinding?.eventSource === targetEventSource ? boundMacroBinding : null))
        : boundMacroBinding;
    if (binding) {
        binding.active = false;
        binding.eventSource?.removeListener?.(event_types.GENERATION_STARTED, binding.onGenerationStarted);
        binding.eventSource?.removeListener?.(event_types.CHAT_CHANGED, binding.onChatChanged);
        if (typeof binding.eventSource === 'object' && binding.eventSource !== null) {
            macroBindings.delete(binding.eventSource);
        }
    }
    if (!targetEventSource || boundMacroBinding?.eventSource === targetEventSource) {
        boundMacroBinding = null;
        lastGenerationType = '';
    }
}
export function bindMacroEventSource(targetEventSource = eventSource) {
    if (boundMacroBinding && boundMacroBinding.eventSource !== targetEventSource) {
        disposeMacroEventSource(boundMacroBinding.eventSource);
    }
    if (targetEventSource && boundMacroBinding?.eventSource !== targetEventSource) {
        const binding = {
            active: true,
            eventSource: targetEventSource,
            onGenerationStarted: (type, _params, isDryRun) => {
                if (!binding.active || boundMacroBinding !== binding || isDryRun) return;
                lastGenerationType = type || 'normal';
            },
            onChatChanged: () => {
                if (!binding.active || boundMacroBinding !== binding) return;
                lastGenerationType = '';
            },
        };
        boundMacroBinding = binding;
        if (typeof targetEventSource === 'object') {
            macroBindings.set(targetEventSource, binding);
        }
        lastGenerationType = '';
        targetEventSource.on?.(event_types.GENERATION_STARTED, binding.onGenerationStarted);
        targetEventSource.on?.(event_types.CHAT_CHANGED, binding.onChatChanged);
    }
}
export const saveMetadataDebounced = () => { current.context.metadataDirty = true; };
export const saveSettingsDebounced = () => { current.context.settingsDirty = true; };

const retiredPromptRefs = new WeakSet();
const activeInjectedPromptRefs = new WeakMap();
export function registerInjectedPrompt(promptsMap, id, promptRef) {
    if (!promptsMap || typeof promptsMap !== 'object' || !promptRef || typeof promptRef !== 'object') return;
    let byId = activeInjectedPromptRefs.get(promptsMap);
    if (!byId) {
        byId = new Map();
        activeInjectedPromptRefs.set(promptsMap, byId);
    }
    let refs = byId.get(id);
    if (!refs) {
        refs = new Set();
        byId.set(id, refs);
    }
    refs.add(promptRef);
}
export function retireInjectedPrompt(promptsMap, id, promptRef) {
    if (promptRef && typeof promptRef === 'object') {
        retiredPromptRefs.add(promptRef);
    }
    if (!promptsMap || typeof promptsMap !== 'object') return;
    const byId = activeInjectedPromptRefs.get(promptsMap);
    const refs = byId?.get(id);
    if (refs) {
        refs.delete(promptRef);
        if (refs.size === 0) byId.delete(id);
    }
}
export function retireInjectedPromptsById(promptsMap, id) {
    if (!promptsMap || typeof promptsMap !== 'object') return;
    const byId = activeInjectedPromptRefs.get(promptsMap);
    const refs = byId?.get(id);
    if (!refs) return;
    for (const ref of refs) {
        if (ref && typeof ref === 'object') {
            retiredPromptRefs.add(ref);
        }
    }
    byId.delete(id);
}
export function isInjectedPromptRetired(promptRef) {
    return Boolean(promptRef && typeof promptRef === 'object' && retiredPromptRefs.has(promptRef));
}
