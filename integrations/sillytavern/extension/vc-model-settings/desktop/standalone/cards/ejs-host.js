// 锁定 EJS 的直接宿主端口。只读同一会话状态；不导回原生页面/初始化器。
import { DOMPurify, lodash, yaml } from '../../locked-source/st/lib.js';
import { createRegexRuntime } from '../engine/regex.js';
import { createTokenizer } from '../engine/tokenizers.js';
import { getChatCompletionModel as modelOf } from '../engine/st/scripts/openai.js';
import { getCharaFilename } from '../engine/st/scripts/utils.js';
import { substituteParams, substituteParamsExtended, setExtensionPrompt } from '../engine/st/script.js';
import { getContext, characters, this_chid, groups, selected_group, power_user, oai_settings } from '../engine/ports.js';
import { configureFormatting, messageFormatting, MessageFormatter } from './format.js';
import { accountStorage, configureAccountStorage } from './account-storage.js';
import { readCharacterChats } from './helper-character.js';
import {
    ARGUMENT_TYPE,
    SlashCommand,
    SlashCommandArgument,
    SlashCommandNamedArgument,
    SlashCommandParser,
    executeSlashCommands,
    executeSlashCommandsWithOptions as executeHelperSlashCommandsWithOptions,
} from './helper-slash.js';
export * from '../engine/ports.js';
export {
    substituteParams,
    substituteParamsExtended,
    setExtensionPrompt,
    getCharaFilename,
    messageFormatting,
    MessageFormatter,
    ARGUMENT_TYPE,
    SlashCommand,
    SlashCommandArgument,
    SlashCommandNamedArgument,
    SlashCommandParser,
    executeSlashCommands,
};
const STALE_SCOPE_ERROR_MESSAGE = '角色卡执行上下文已失效。';
const SLASH_EXECUTION_ERROR_MESSAGE = 'VC_SLASH_EXECUTION_ERROR';

function createSanitizedError(message = STALE_SCOPE_ERROR_MESSAGE) {
    const error = new Error(message);
    Object.defineProperty(error, 'message', {
        get: () => message,
        set: () => {},
        enumerable: false,
        configurable: true,
    });
    return error;
}

export async function executeSlashCommandsWithOptions(text, options) {
    let result;
    try {
        result = await executeHelperSlashCommandsWithOptions(text, options);
    } catch {
        throw createSanitizedError(SLASH_EXECUTION_ERROR_MESSAGE);
    }
    if (result?.isError) {
        throw createSanitizedError(SLASH_EXECUTION_ERROR_MESSAGE);
    }
    return result;
}

let owner, ownerHistory;
export let user_avatar, world_info, selected_world_info, world_names;
export let world_info_case_sensitive, world_info_match_whole_words, world_info_use_group_scoring, world_info_max_recursion_steps;
export const DEFAULT_DEPTH = 4, DEFAULT_WEIGHT = 100, METADATA_KEY = 'world_info';
export const world_info_logic = { AND_ANY: 0, NOT_ALL: 1, NOT_ANY: 2, AND_ALL: 3 };
export const world_info_position = { before: 0, after: 1, ANTop: 2, ANBottom: 3, atDepth: 4, EMTop: 5, EMBottom: 6, outlet: 7 };
export const regex_placement = { USER_INPUT: 1, AI_OUTPUT: 2, SLASH_COMMAND: 3, WORLD_INFO: 5, REASONING: 6 };

export function bindCardHost(options) {
    if (owner !== options) {
        ownerHistory?.abort();
        ownerHistory = new AbortController();
    }
    owner = options;
    const { context, settings, packet } = owner;
    user_avatar = context.userAvatar;
    world_info = settings.world_info ||= {};
    selected_world_info = world_info.globalSelect ||= [];
    world_names = packet?.world_names || [];
    world_info_case_sensitive = settings.world_info_case_sensitive ?? false;
    world_info_match_whole_words = settings.world_info_match_whole_words ?? false;
    world_info_use_group_scoring = settings.world_info_use_group_scoring ?? false;
    world_info_max_recursion_steps = settings.world_info_max_recursion_steps ?? 0;
    configureAccountStorage({
        saveSettingsDebounced: () => {
            settings.accountStorage = accountStorage.getState();
            return context.saveSettingsDebounced?.();
        },
        persistSettings: () => {
            settings.accountStorage = accountStorage.getState();
            if (typeof owner.persistSettings === 'function') {
                return owner.persistSettings();
            }
            return undefined;
        },
        syncState: state => {
            settings.accountStorage = state;
        },
    });
    accountStorage.init(settings.accountStorage);
    configureFormatting({ getRegexedString, regex_placement, accountStorage, toastr: globalThis.toastr,
        t: (strings, ...values) => String.raw({ raw: strings }, ...values) });
}
export const getCardHost = () => owner;
export function clearCardHost(targetOwner) {
    if (!targetOwner || owner === targetOwner) {
        ownerHistory?.abort();
        ownerHistory = undefined;
        owner = undefined;
    }
}
function isExtensionDisabled(settings, names, packet) {
    if (!settings || typeof settings !== 'object') return true;
    if (
        packet?.enable_extensions === false
        || settings.enable_extensions === false
        || settings.extension_settings?.enable_extensions === false
    ) {
        return true;
    }
    const disabled = settings.extension_settings?.disabledExtensions;
    if (!Array.isArray(disabled)) return false;
    const lowered = new Set(disabled.map(item => String(item).toLowerCase()));
    return names.some(name => lowered.has(name.toLowerCase()));
}
export function isHelperExtensionEnabled(host = owner) {
    const settings = host?.settings;
    if (!settings || host?.destroyed) return false;
    if (isExtensionDisabled(settings, ['JS-Slash-Runner', 'third-party/JS-Slash-Runner', 'tavern_helper'], host?.packet)) {
        return false;
    }
    if (settings.extension_settings?.tavern_helper?.enabled === false) {
        return false;
    }
    return true;
}
export function isEjsExtensionEnabled(host = owner) {
    const settings = host?.settings;
    if (!settings || host?.destroyed) return false;
    if (isExtensionDisabled(settings, ['ST-Prompt-Template', 'third-party/ST-Prompt-Template', 'EjsTemplate'], host?.packet)) {
        return false;
    }
    if (settings.extension_settings?.EjsTemplate?.enabled === false) {
        return false;
    }
    return true;
}
export function hasExplicitCardAuthorization(host = owner) {
    const context = host?.context;
    const settings = host?.settings;
    if (!context || !settings || host?.destroyed) return false;
    const enabled = settings.extension_settings?.tavern_helper?.script?.enabled;
    if (!enabled || typeof enabled !== 'object') return false;
    const card = context.characters?.[context.characterId];
    const avatar = card?.avatar;
    if (typeof avatar === 'string' && avatar.length > 0 && Array.isArray(enabled.characters) && enabled.characters.includes(avatar)) {
        return true;
    }
    const presetName = settings.oai_settings?.preset_settings_openai;
    if (typeof presetName === 'string' && presetName.length > 0 && Array.isArray(enabled.presets) && enabled.presets.includes(presetName)) {
        return true;
    }
    return false;
}
export function isCardExecutionAllowed(host = owner) {
    return isHelperExtensionEnabled(host) && hasExplicitCardAuthorization(host);
}
export function isEjsExecutionAllowed(host = owner) {
    return isEjsExtensionEnabled(host) && hasExplicitCardAuthorization(host);
}
export const isCardDisplayExecutionAllowed = () => isEjsExecutionAllowed(owner);
export function getEnabledCardExtensions(host = owner) {
    if (!host || host.destroyed || host !== owner) {
        return [];
    }
    const list = [];
    if (isHelperExtensionEnabled(host)) {
        list.push('third-party/JS-Slash-Runner');
    }
    if (host.ejs && isEjsExtensionEnabled(host)) {
        list.push('third-party/ST-Prompt-Template');
    }
    return list;
}
export function sanitizeRenderedHtml(html) {
    return DOMPurify.sanitize(String(html ?? ''), {
        ADD_TAGS: ['custom-style'],
        FORCE_BODY: true,
    });
}
export function captureCardHistoryScope({ assertActive, signal: callerSignal } = {}) {
    assertActive?.();
    const activeOwner = owner;
    const context = activeOwner?.context;
    if (!context || activeOwner.destroyed) throw createSanitizedError();
    const metadata = context.chatMetadata;
    const chatId = context.chatId;
    const signals = [ownerHistory.signal, activeOwner.signal, activeOwner.historySignal, callerSignal].filter(Boolean);
    const signal = AbortSignal.any(signals);
    const assertCurrent = () => {
        assertActive?.();
        if (signal.aborted || owner !== activeOwner || activeOwner.destroyed ||
            activeOwner.context !== context || context.chatMetadata !== metadata || context.chatId !== chatId) {
            throw createSanitizedError();
        }
    };
    assertCurrent();
    return { context, client: activeOwner.client, signal, assertCurrent };
}

export function cardHistoryArgs(name, args, scope) {
    if (name === 'getChatHistoryBrief') return [args[0], scope];
    if (name === 'getChatHistoryDetail') return [args[0], args[1], scope];
    return args;
}

const MESSAGE_MUTATION_INTERNAL_INDEX = new Map([
    ['setChatMessages', 2],
    ['createChatMessages', 2],
    ['deleteChatMessages', 2],
    ['setChatMessage', 3],
    ['rotateChatMessages', 4],
]);

const UPDATER_HELPER_INDEX = new Map([
    ['updateVariablesWith', 0],
    ['updateWorldbookWith', 1],
    ['updateLorebookEntriesWith', 1],
]);

const EJS_SCOPED_DATA_METHODS = [
    'setvar', 'setLocalVar', 'setGlobalVar', 'setMessageVar',
    'getvar', 'getLocalVar', 'getGlobalVar', 'getMessageVar',
    'incvar', 'incLocalVar', 'incGlobalVar', 'incMessageVar',
    'decvar', 'decLocalVar', 'decGlobalVar', 'decMessageVar',
    'delvar', 'delLocalVar', 'delGlobalVar', 'delMessageVar',
    'insvar', 'insertLocalVar', 'insertGlobalVar', 'insertMessageVar',
    'patchVariables', 'applyVarYamlAnnotate', 'setVariableSchema', 'define',
    'injectPrompt', 'activateWorldInfo', 'activewi', 'activateWorldInfoByKeywords', 'activateRegex',
    'evalTemplate', 'getwi', 'getWorldInfo', 'getchr', 'getchar', 'getChara',
    'getprp', 'getpreset', 'getPresetPrompt', 'getqr', 'getQuickReply',
];

// 每次模板求值创建独立浅层执行数据并拥有可撤销作用域；异步计时器或跨会话恢复不能沿用已结束模板的授权。
export function enterTemplateScope(data) {
    const activeOwner = owner;
    const activeContext = activeOwner?.context;
    const lease = activeContext?.captureHelperScope?.();
    const metadata = activeContext?.chatMetadata;
    const chatSignal = activeOwner?.historySignal;
    const lifetime = new AbortController();
    let released = false;
    const release = () => {
        if (released) return;
        released = true;
        lifetime.abort();
        lease?.release();
    };
    if (!data || typeof data !== 'object') {
        return { data, release };
    }

    const isScopeValid = () => Boolean(
        !lifetime.signal.aborted
        && !chatSignal?.aborted
        && !activeOwner?.signal?.aborted
        && activeOwner
        && !activeOwner.destroyed
        && owner === activeOwner
        && activeContext
        && activeOwner.context === activeContext
        && activeContext.chatMetadata === metadata
        && (!lease?.scope || lease.scope.valid),
    );
    const assertScopeValid = (message = STALE_SCOPE_ERROR_MESSAGE) => {
        if (!isScopeValid()) {
            throw createSanitizedError(message);
        }
    };

    const historyScope = { assertActive: assertScopeValid, signal: lifetime.signal };
    const scopedData = Object.create(
        Object.getPrototypeOf(data),
        Object.getOwnPropertyDescriptors(data),
    );

    const prepareCallArgs = (name, args) => {
        if (MESSAGE_MUTATION_INTERNAL_INDEX.has(name)) {
            const internalIndex = MESSAGE_MUTATION_INTERNAL_INDEX.get(name);
            const nextArgs = [...args];
            const existingInternal = nextArgs[internalIndex] && typeof nextArgs[internalIndex] === 'object'
                ? nextArgs[internalIndex]
                : {};
            const prevAssert = typeof existingInternal.assertActive === 'function'
                ? existingInternal.assertActive
                : null;
            nextArgs[internalIndex] = {
                ...existingInternal,
                assertActive: () => {
                    prevAssert?.();
                    assertScopeValid(STALE_SCOPE_ERROR_MESSAGE);
                },
            };
            return nextArgs;
        }
        if (UPDATER_HELPER_INDEX.has(name)) {
            const updaterIndex = UPDATER_HELPER_INDEX.get(name);
            const origUpdater = args[updaterIndex];
            if (typeof origUpdater === 'function') {
                const nextArgs = [...args];
                nextArgs[updaterIndex] = function (...uArgs) {
                    assertScopeValid(STALE_SCOPE_ERROR_MESSAGE);
                    const out = origUpdater.apply(this, uArgs);
                    return out && typeof out.then === 'function'
                        ? out.then(val => {
                            assertScopeValid(STALE_SCOPE_ERROR_MESSAGE);
                            return val;
                        })
                        : (assertScopeValid(STALE_SCOPE_ERROR_MESSAGE), out);
                };
                return nextArgs;
            }
        }
        return cardHistoryArgs(name, args, historyScope);
    };

    let scopedHelper;
    const wrapMethod = (name, fn, receiver) =>
        function (...args) {
            assertScopeValid(STALE_SCOPE_ERROR_MESSAGE);
            const callArgs = prepareCallArgs(name, args);
            const target = this === scopedData || this === scopedHelper ? receiver : this;
            const result = fn.apply(target, callArgs);
            if (name === 'define' && (typeof args[0] === 'string' || Array.isArray(args[0]))) {
                lodash.set(scopedData, args[0], lodash.get(data, args[0]));
            }
            if (result && typeof result.then === 'function') {
                return result.then(
                    value => {
                        assertScopeValid(STALE_SCOPE_ERROR_MESSAGE);
                        return value;
                    },
                    error => {
                        if (!isScopeValid()) {
                            throw createSanitizedError(STALE_SCOPE_ERROR_MESSAGE);
                        }
                        throw error;
                    },
                );
            }
            return result;
        };

    const generate = (name, config) => {
        if (!isScopeValid()) {
            return Promise.reject(createSanitizedError(STALE_SCOPE_ERROR_MESSAGE));
        }
        return Promise.resolve(activeContext.generateHelper(name, config, lease?.scope)).then(
            value => {
                assertScopeValid(STALE_SCOPE_ERROR_MESSAGE);
                return value;
            },
            error => {
                if (!isScopeValid()) {
                    throw createSanitizedError(STALE_SCOPE_ERROR_MESSAGE);
                }
                throw error;
            },
        );
    };

    const rawHelper = globalThis.TavernHelper;
    scopedHelper = {};
    if (rawHelper && typeof rawHelper === 'object') {
        for (const [key, value] of Object.entries(rawHelper)) {
            if (key === 'generate' || key === 'generateRaw') {
                scopedHelper[key] = config => generate(key, config);
            } else if (key === 'builtin' && value && typeof value === 'object') {
                const scopedBuiltin = {};
                for (const [bKey, bVal] of Object.entries(value)) {
                    scopedBuiltin[bKey] = typeof bVal === 'function'
                        ? wrapMethod(`builtin.${bKey}`, bVal, value)
                        : bVal;
                }
                scopedHelper.builtin = scopedBuiltin;
            } else if (key === 'RawCharacter') {
                scopedHelper[key] = createScopedRawCharacter(historyScope);
            } else if (typeof value === 'function') {
                scopedHelper[key] = wrapMethod(key, value, rawHelper);
            } else {
                scopedHelper[key] = value;
            }
        }
    } else {
        scopedHelper.generate = config => generate('generate', config);
        scopedHelper.generateRaw = config => generate('generateRaw', config);
    }

    const rawExecute = typeof data.execute === 'function' ? data.execute : null;
    const scopedExecute = async (...args) => {
        assertScopeValid(SLASH_EXECUTION_ERROR_MESSAGE);
        if (!rawExecute) {
            throw createSanitizedError(SLASH_EXECUTION_ERROR_MESSAGE);
        }
        try {
            const value = await rawExecute.apply(scopedData, args);
            assertScopeValid(SLASH_EXECUTION_ERROR_MESSAGE);
            return value;
        } catch {
            throw createSanitizedError(SLASH_EXECUTION_ERROR_MESSAGE);
        }
    };

    const defineScopedValue = (key, value, enumerable = true) => {
        Object.defineProperty(scopedData, key, {
            configurable: true,
            enumerable,
            writable: true,
            value,
        });
    };

    defineScopedValue('TavernHelper', scopedHelper);
    defineScopedValue('execute', scopedExecute, Object.getOwnPropertyDescriptor(data, 'execute')?.enumerable ?? true);

    for (const [key, fn] of Object.entries(scopedHelper)) {
        if (key.startsWith('_') || key === 'TavernHelper' || typeof fn !== 'function') continue;
        if (!Object.hasOwn(data, key) || data[key] === rawHelper?.[key]) {
            const prevEnum = Object.getOwnPropertyDescriptor(data, key)?.enumerable ?? false;
            defineScopedValue(key, fn, prevEnum);
        }
    }

    for (const key of EJS_SCOPED_DATA_METHODS) {
        if (Object.hasOwn(data, key) && typeof data[key] === 'function') {
            const prevEnum = Object.getOwnPropertyDescriptor(data, key)?.enumerable ?? true;
            defineScopedValue(key, wrapMethod(key, data[key], data), prevEnum);
        }
    }

    if (Object.hasOwn(data, 'SillyTavern')) {
        const prevStDesc = Object.getOwnPropertyDescriptor(data, 'SillyTavern');
        Object.defineProperty(scopedData, 'SillyTavern', {
            configurable: true,
            enumerable: prevStDesc?.enumerable ?? true,
            get() {
                assertScopeValid(STALE_SCOPE_ERROR_MESSAGE);
                return activeContext;
            },
        });
    }

    return { data: scopedData, release };
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
// Each public class closes over its caller's scope, including static methods extracted from the class.
export function createScopedRawCharacter(scope) {
    function currentContext() {
        scope?.assertActive?.();
        return owner?.context;
    }

    return class RawCharacter {
        constructor(character) {
            Object.assign(this, character);
            this.character = character;
        }
        getCardData() { return this.character; }
        getAvatarId() { return this.character.avatar || ''; }
        getRegexScripts() { return this.character.data?.extensions?.regex_scripts || []; }
        getCharacterBook() { return this.character.data?.character_book || null; }
        getWorldName() { return this.character.data?.extensions?.world || ''; }

        static find({ name = 'current' } = {}) {
            const context = currentContext();
            const card = context?.characters[findRawCharacterIndex(context, name)];
            return card ? new RawCharacter(card) : null;
        }

        static findIndex(arg = 'current') {
            const name = (typeof arg === 'object' && arg !== null ? arg.name : arg) ?? 'current';
            return findRawCharacterIndex(currentContext(), name);
        }

        static async getChatsFromFiles(data, isGroupChat = false) {
            return readCharacterChats(data, isGroupChat, scope);
        }
    };
}

export function findRawCharacterIndex(context, name) {
    if (!context) return -1;
    const { characters: cards, characterId } = context;
    if (name === 'current') return characterId != null && cards[characterId] ? Number(characterId) : -1;
    const lowered = String(name).toLowerCase();
    return cards.findIndex(card => card.name?.toLowerCase() === lowered || card.avatar?.toLowerCase() === lowered);
}

export const RawCharacter = createScopedRawCharacter();
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
export function addCopyToCodeBlocks(parent) {
    const node = parent?.jquery || Array.isArray(parent) ? parent[0] : parent;
    if (node?.querySelectorAll) owner.surface?.codeBlocks(node);
}
export function appendMediaToMessage(message, parent) { owner.surface?.media(message, parent); }
export function updateReasoningUI(parent) { owner.surface?.reasoning(parent); }
export const getSTContext = getContext;
export { yaml };
