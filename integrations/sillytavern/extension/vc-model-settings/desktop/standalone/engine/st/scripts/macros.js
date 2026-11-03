// AGPL-3.0-only. SillyTavern 7e8663cd9c184a550b37238218bdd32c6efc68e9 / scripts/macros.js
// 原计算模块；只适配显式状态、输入/首显消息与无正文诊断端口。
import { quietConsole as console, readInput, readFirstDisplayedMessageId } from "../../ports.js";
import { moment, seedrandom, droll } from "../lib.js";
import { chat, chat_metadata, main_api, getMaxPromptTokens, getMaxContextTokens, getMaxResponseTokens, getCurrentChatId, substituteParams, eventSource, event_types, extension_prompts } from "../script.js";
import { timestampToMoment, isDigitsOnly, getStringHash, escapeRegex, uuidv4 } from "./utils.js";
import { textgenerationwebui_banned_in_macros } from "../../ports.js";
import { getInstructMacros } from "./instruct-mode.js";
import { getVariableMacros } from "./variables.js";
import { isMobile } from "../../ports.js";
import { inject_ids } from "../../ports.js";
import { initRegisterMacros, macros as macroSystem } from "./macros/macro-system.js";
import { power_user } from "../../ports.js";
export class MacrosParser {
    /**
     * A map of registered macros.
     * @type {Map<string, string|MacroFunction>}
     */
    static #macros = new Map();

    /**
     * A map of macro descriptions.
     * @type {Map<string, string>}
     */
    static #descriptions = new Map();

    /**
     * Logs a deprecation warning for MacrosParser APIs, pointing callers to
     * the new macro engine registration surface.
     *
     * @param {string} method
     * @param {string} replacement
     * @param {IArguments} [methodArgs=null]
     * @returns {void}
     */
    static #logDeprecated(method, replacement, methodArgs = null) {
        console.warn(`[DEPRECATED] MacrosParser.${method} is deprecated and will be removed in a future version. Use ${replacement} instead. Arguments:`, (methodArgs ?? 'none'));
    }

    /**
     * Bridges a legacy MacrosParser macro registration into the new macro
     * engine when the experimental macro engine flag is enabled.
     *
     * This mirrors the simple "{{key}}" replacement behavior by registering
     * a 0-arg macro in MacroRegistry that does not take arguments and returns
     * the sanitized value from the legacy registry.
     *
     * @param {string} key
     * @param {string|MacroFunction} value
     * @param {string} description
     * @returns {void}
     */
    static #registerMacroInNewEngine(key, value, description) {
        if (!power_user.experimental_macro_engine) {
            return;
        }

        // Like the old MacrosParser, we explicitly allow overriding macros, and only warn
        if (macroSystem.registry.hasMacro(key)) {
            console.warn(`Macro ${key} is already registered`);
        }

        const legacyValue = value;

        macroSystem.registry.registerMacro(key, {
            // Legacy MacrosParser macros never took arguments; keep the
            // contract that only {{key}} without arguments is valid.
            category: 'legacy',
            description: typeof description === 'string' ? description : 'Automatically registered macro from MacrosParser',
            handler: () => {
                /** @type {string|MacroFunction|undefined} */
                let stored = legacyValue;

                if (typeof stored === 'function') {
                    try {
                        const nonce = uuidv4();
                        stored = stored(nonce);
                    } catch (e) {
                        console.warn(`Macro "${key}" function threw an error.`, e);
                        stored = '';
                    }
                }

                // Let the new macro engine's normalizeMacroResult handle type
                // normalization for the returned value.
                return stored;
            },
        });
    }

    /**
     * Bridges a legacy MacrosParser macro unregistration into the new macro
     * engine when the experimental macro engine flag is enabled.
     *
     * @param {string} key
     * @returns {void}
     */
    static #unregisterMacroInNewEngine(key) {
        if (!power_user.experimental_macro_engine) {
            return;
        }

        macroSystem.registry.unregisterMacro(key);
    }

    /**
     * Returns an iterator over all registered macros.
     * @returns {IterableIterator<CustomMacro>}
     */
    static [Symbol.iterator] = function* () {
        // When experimental macro engine is active, yield from the new registry
        if (power_user.experimental_macro_engine) {
            // Exclude hidden aliases for consistency with autocomplete behavior
            for (const def of macroSystem.registry.getAllMacros({ excludeHiddenAliases: true })) {
                yield { key: def.name, description: def.description || '' };
            }
            return;
        }

        for (const macro of MacrosParser.#macros.keys()) {
            yield { key: macro, description: MacrosParser.#descriptions.get(macro) };
        }
    };

    /**
     * Access a macro by its name.
     * @param {string} key Macro name (key)
     * @returns {string|MacroFunction|undefined} The macro value
     */
    static get(key) {
        MacrosParser.#logDeprecated('get', 'macros.registry.getMacro (from scripts/macros/macro-system.js)', arguments);
        return MacrosParser.#macros.get(key);
    }

    /**
     * Checks if a macro is registered.
     * @param {string} key Macro name (key)
     * @returns {boolean} True if the macro is registered, false otherwise
     */
    static has(key) {
        MacrosParser.#logDeprecated('has', 'macros.registry.hasMacro (from scripts/macros/macro-system.js)', arguments);
        if (power_user.experimental_macro_engine) {
            return macroSystem.registry.hasMacro(key);
        }

        return MacrosParser.#macros.has(key);
    }

    /**
     * Registers a global macro that can be used anywhere where substitution is allowed.
     * @param {string} key Macro name (key)
     * @param {string|MacroFunction} value A string or a function that returns a string
     * @param {string} [description] Optional description of the macro
     */
    static registerMacro(key, value, description = '') {
        MacrosParser.#logDeprecated('registerMacro', 'macros.registry.registerMacro (from scripts/macros/macro-system.js) or substituteParams({ dynamicMacros })', arguments);
        if (typeof key !== 'string') {
            throw new Error('Macro key must be a string');
        }

        // Allowing surrounding whitespace would just create more confusion...
        key = key.trim();

        if (!key) {
            throw new Error('Macro key must not be empty or whitespace only');
        }

        if (key.startsWith('{{') || key.endsWith('}}')) {
            throw new Error('Macro key must not include the surrounding braces');
        }

        if (typeof value !== 'string' && typeof value !== 'function') {
            console.warn(`Macro value for "${key}" will be converted to a string`);
            value = this.sanitizeMacroValue(value);
        }

        MacrosParser.#registerMacroInNewEngine(key, value, description);
        if (power_user.experimental_macro_engine) {
            return;
        }

        if (this.#macros.has(key)) {
            console.warn(`Macro ${key} is already registered`);
        }

        this.#macros.set(key, value);

        if (typeof description === 'string' && description) {
            this.#descriptions.set(key, description);
        }
    }

    /**
     * Unregisters a global macro with the given key
     *
     * @param {string} key Macro name (key)
     */
    static unregisterMacro(key) {
        MacrosParser.#logDeprecated('unregisterMacro', 'macros.registry.unregisterMacro (from scripts/macros/macro-system.js)', arguments);
        if (typeof key !== 'string') {
            throw new Error('Macro key must be a string');
        }

        // Allowing surrounding whitespace would just create more confusion...
        key = key.trim();

        if (!key) {
            throw new Error('Macro key must not be empty or whitespace only');
        }

        if (power_user.experimental_macro_engine) {
            MacrosParser.#unregisterMacroInNewEngine(key);
            return;
        }

        const deleted = this.#macros.delete(key);

        if (!deleted) {
            console.warn(`Macro ${key} was not registered`);
        }

        this.#descriptions.delete(key);
    }

    /**
     * Populate the env object with macro values from the current context.
     * @param {EnvObject} env Env object for the current evaluation context
     * @returns {void}
     */
    static populateEnv(env) {
        if (!env || typeof env !== 'object') {
            console.warn('Env object is not provided');
            return;
        }

        // No macros are registered
        if (this.#macros.size === 0) {
            return;
        }

        for (const [key, value] of this.#macros) {
            env[key] = value;
        }
    }

    /**
     * Performs a type-check on the macro value and returns a sanitized version of it.
     * @param {any} value Value returned by a macro
     * @returns {string} Sanitized value
     */
    static sanitizeMacroValue(value) {
        if (typeof value === 'string') {
            return value;
        }

        if (value === null || value === undefined) {
            return '';
        }

        if (value instanceof Promise) {
            console.warn('Promises are not supported as macro values');
            return '';
        }

        if (typeof value === 'function') {
            console.warn('Functions are not supported as macro values');
            return '';
        }

        if (value instanceof Date) {
            return value.toISOString();
        }

        if (typeof value === 'object') {
            return JSON.stringify(value);
        }

        return String(value);
    }
}

export function getChatIdHash() {
    const cachedIdHash = chat_metadata.chat_id_hash;

    // If chat_id_hash is not already set, calculate it
    if (!cachedIdHash) {
        // Use the main_chat if it's available, otherwise get the current chat ID
        const chatId = chat_metadata.main_chat ?? getCurrentChatId();
        const chatIdHash = getStringHash(chatId);
        chat_metadata.chat_id_hash = chatIdHash;
        return chatIdHash;
    }

    return cachedIdHash;
}

export function getLastMessageId({ exclude_swipe_in_propress = true, filter = null } = {}) {
    for (let i = chat?.length - 1; i >= 0; i--) {
        let message = chat[i];

        // If ignoring swipes and the message is being swiped, continue
        // We can check if a message is being swiped by checking whether the current swipe id is not in the list of finished swipes yet
        if (exclude_swipe_in_propress && message.swipes && message.swipe_id >= message.swipes.length) {
            continue;
        }

        // Check if no filter is provided, or if the message passes the filter
        if (!filter || filter(message)) {
            return i;
        }
    }

    return null;
}

export function getFirstIncludedMessageId() {
    return chat_metadata.lastInContextMessageId;
}

function getFirstDisplayedMessageId() { return readFirstDisplayedMessageId(); }

export function getLastMessage() {
    const mid = getLastMessageId();
    return chat[mid]?.mes ?? '';
}

export function getLastUserMessage() {
    const mid = getLastMessageId({ filter: m => m.is_user && !m.is_system });
    return chat[mid]?.mes ?? '';
}

export function getLastCharMessage() {
    const mid = getLastMessageId({ filter: m => !m.is_user && !m.is_system });
    return chat[mid]?.mes ?? '';
}

export function getLastSwipeId() {
    // For swipe macro, we are accepting using the message that is currently being swiped
    const mid = getLastMessageId({ exclude_swipe_in_propress: false });
    const swipes = chat[mid]?.swipes;
    return swipes?.length;
}

export function getCurrentSwipeId() {
    // For swipe macro, we are accepting using the message that is currently being swiped
    const mid = getLastMessageId({ exclude_swipe_in_propress: false });
    const swipeId = chat[mid]?.swipe_id;
    return swipeId !== null ? swipeId + 1 : null;
}

export function getBannedWordsMacro() {
    const banPattern = /{{banned "(.*)"}}/gi;
    const banReplace = (match, bannedWord) => {
        if (main_api == 'textgenerationwebui') {
            console.log('Found banned word in macros: ' + bannedWord);
            textgenerationwebui_banned_in_macros.push(bannedWord);
        }
        return '';
    };

    return { regex: banPattern, replace: banReplace };
}

export function getTimeSinceLastMessage() {
    const now = moment();

    if (Array.isArray(chat) && chat.length > 0) {
        let lastMessage;
        let takeNext = false;

        for (let i = chat.length - 1; i >= 0; i--) {
            const message = chat[i];

            if (message.is_system) {
                continue;
            }

            if (message.is_user && takeNext) {
                lastMessage = message;
                break;
            }

            takeNext = true;
        }

        if (lastMessage?.send_date) {
            const lastMessageDate = timestampToMoment(lastMessage.send_date);
            const duration = moment.duration(now.diff(lastMessageDate));
            return duration.humanize();
        }
    }

    return 'just now';
}

export function getRandomReplaceMacro() {
    const randomPattern = /{{random\s?::?([^}]+)}}/gi;
    const randomReplace = (match, listString) => {
        // Split on either double colons or comma. If comma is the separator, we are also trimming all items.
        const list = listString.includes('::')
            ? listString.split('::')
            // Replaced escaped commas with a placeholder to avoid splitting on them
            : listString.replace(/\\,/g, '##�COMMA�##').split(',').map(item => item.trim().replace(/##�COMMA�##/g, ','));

        if (list.length === 0) {
            return '';
        }
        const rng = seedrandom('added entropy.', { entropy: true });
        const randomIndex = Math.floor(rng() * list.length);
        return list[randomIndex];
    };

    return { regex: randomPattern, replace: randomReplace };
}

export function getPickReplaceMacro(rawContent) {
    // We need to have a consistent chat hash, otherwise we'll lose rolls on chat file rename or branch switches
    // No need to save metadata here - branching and renaming will implicitly do the save for us, and until then loading it like this is consistent
    const chatIdHash = getChatIdHash();
    const rawContentHash = getStringHash(rawContent);

    const pickPattern = /{{pick\s?::?([^}]+)}}/gi;
    const pickReplace = (match, listString, offset) => {
        // Split on either double colons or comma. If comma is the separator, we are also trimming all items.
        const list = listString.includes('::')
            ? listString.split('::')
            // Replaced escaped commas with a placeholder to avoid splitting on them
            : listString.replace(/\\,/g, '##�COMMA�##').split(',').map(item => item.trim().replace(/##�COMMA�##/g, ','));

        if (list.length === 0) {
            return '';
        }

        // We build a hash seed based on: unique chat file, raw content, and the placement inside this content
        // This allows us to get unique but repeatable picks in nearly all cases
        const combinedSeedString = `${chatIdHash}-${rawContentHash}-${offset}`;
        const finalSeed = getStringHash(combinedSeedString);
        // @ts-ignore - have to use numbers for legacy picks
        const rng = seedrandom(finalSeed);
        const randomIndex = Math.floor(rng() * list.length);
        return list[randomIndex];
    };

    return { regex: pickPattern, replace: pickReplace };
}

export function getDiceRollMacro() {
    const rollPattern = /{{roll[ : ]([^}]+)}}/gi;
    const rollReplace = (match, matchValue) => {
        let formula = matchValue.trim();

        if (isDigitsOnly(formula)) {
            formula = `1d${formula}`;
        }

        const isValid = droll.validate(formula);

        if (!isValid) {
            console.debug(`Invalid roll formula: ${formula}`);
            return '';
        }

        const result = droll.roll(formula);
        if (result === false) return '';
        return String(result.total);
    };

    return { regex: rollPattern, replace: rollReplace };
}

export function getTimeDiffMacro() {
    const timeDiffPattern = /{{timeDiff::(.*?)::(.*?)}}/gi;
    const timeDiffReplace = (_match, matchPart1, matchPart2) => {
        const time1 = moment(matchPart1);
        const time2 = moment(matchPart2);

        const timeDifference = moment.duration(time1.diff(time2));
        return timeDifference.humanize(true);
    };

    return { regex: timeDiffPattern, replace: timeDiffReplace };
}

export function getOutletPrompt(key) {
    const value = extension_prompts[inject_ids.CUSTOM_WI_OUTLET(key)]?.value;
    return value || '';
}

export function evaluateMacros(content, env, postProcessFn) {
    if (!content) {
        return '';
    }

    postProcessFn = typeof postProcessFn === 'function' ? postProcessFn : (x => x);
    const rawContent = content;

    /**
     * Built-ins running before the env variables
     * @type {Macro[]}
     * */
    const preEnvMacros = [
        // Legacy non-curly macros
        { regex: /<USER>/gi, replace: () => typeof env.user === 'function' ? env.user() : env.user },
        { regex: /<BOT>/gi, replace: () => typeof env.char === 'function' ? env.char() : env.char },
        { regex: /<CHAR>/gi, replace: () => typeof env.char === 'function' ? env.char() : env.char },
        { regex: /<CHARIFNOTGROUP>/gi, replace: () => typeof env.group === 'function' ? env.group() : env.group },
        { regex: /<GROUP>/gi, replace: () => typeof env.group === 'function' ? env.group() : env.group },
        getDiceRollMacro(),
        ...getInstructMacros(env),
        ...getVariableMacros(),
        { regex: /{{newline}}/gi, replace: () => '\n' },
        { regex: /(?:\r?\n)*{{trim}}(?:\r?\n)*/gi, replace: () => '' },
        { regex: /{{noop}}/gi, replace: () => '' },
        { regex: /{{input}}/gi, replace: () => readInput() },
    ];

    /**
     * Built-ins running after the env variables
     * @type {Macro[]}
    */
    const postEnvMacros = [
        { regex: /{{maxPrompt}}/gi, replace: () => String(getMaxPromptTokens()) },
        { regex: /{{maxPromptTokens}}/gi, replace: () => String(getMaxPromptTokens()) },
        { regex: /{{maxContext}}/gi, replace: () => String(getMaxContextTokens()) },
        { regex: /{{maxContextTokens}}/gi, replace: () => String(getMaxContextTokens()) },
        { regex: /{{maxResponse}}/gi, replace: () => String(getMaxResponseTokens()) },
        { regex: /{{maxResponseTokens}}/gi, replace: () => String(getMaxResponseTokens()) },
        { regex: /{{lastMessage}}/gi, replace: () => getLastMessage() },
        { regex: /{{lastMessageId}}/gi, replace: () => String(getLastMessageId() ?? '') },
        { regex: /{{lastUserMessage}}/gi, replace: () => getLastUserMessage() },
        { regex: /{{lastCharMessage}}/gi, replace: () => getLastCharMessage() },
        { regex: /{{firstIncludedMessageId}}/gi, replace: () => String(getFirstIncludedMessageId() ?? '') },
        { regex: /{{firstDisplayedMessageId}}/gi, replace: () => String(getFirstDisplayedMessageId() ?? '') },
        { regex: /{{lastSwipeId}}/gi, replace: () => String(getLastSwipeId() ?? '') },
        { regex: /{{currentSwipeId}}/gi, replace: () => String(getCurrentSwipeId() ?? '') },
        { regex: /{{allChatRange}}/gi, replace: () => chat.length === 0 ? '' : `0-${chat.length - 1}` },
        { regex: /{{reverse:(.+?)}}/gi, replace: (_, str) => Array.from(str).reverse().join('') },
        { regex: /\{\{\/\/([\s\S]*?)\}\}/gm, replace: () => '' },
        { regex: /{{time}}/gi, replace: () => moment().format('LT') },
        { regex: /{{date}}/gi, replace: () => moment().format('LL') },
        { regex: /{{weekday}}/gi, replace: () => moment().format('dddd') },
        { regex: /{{isotime}}/gi, replace: () => moment().format('HH:mm') },
        { regex: /{{isodate}}/gi, replace: () => moment().format('YYYY-MM-DD') },
        { regex: /{{datetimeformat +([^}]*)}}/gi, replace: (_, format) => moment().format(format) },
        { regex: /{{idle_duration}}/gi, replace: () => getTimeSinceLastMessage() },
        { regex: /{{time_UTC([-+]\d+)}}/gi, replace: (_, offset) => moment().utc().utcOffset(parseInt(offset, 10)).format('LT') },
        { regex: /{{outlet::(.+?)}}/gi, replace: (_, key) => getOutletPrompt(key.trim()) || '' },
        getTimeDiffMacro(),
        getBannedWordsMacro(),
        getRandomReplaceMacro(),
        getPickReplaceMacro(rawContent),
    ];

    // Add all registered macros to the env object
    MacrosParser.populateEnv(env);
    const nonce = uuidv4();
    const envMacros = [];

    // Substitute passed-in variables
    for (const varName in env) {
        if (!Object.hasOwn(env, varName)) continue;

        const envRegex = new RegExp(`{{${escapeRegex(varName)}}}`, 'gi');
        const envReplace = () => {
            const param = env[varName];
            const value = MacrosParser.sanitizeMacroValue(typeof param === 'function' ? param(nonce) : param);
            return value;
        };

        envMacros.push({ regex: envRegex, replace: envReplace });
    }

    const macros = [...preEnvMacros, ...envMacros, ...postEnvMacros];

    for (const macro of macros) {
        // Stop if the content is empty
        if (!content) {
            break;
        }

        // Short-circuit if no curly braces are found
        if (!macro.regex.source.startsWith('<') && !content.includes('{{')) {
            break;
        }

        try {
            content = content.replace(macro.regex, (...args) => postProcessFn(macro.replace(...args)));
        } catch (e) {
            console.warn(`Macro content can't be replaced: ${macro.regex} in ${content}`, e);
        }
    }

    return content;
}

export function initMacros() {
    // Only manually register those is new macro engine is not on. In the new one, they are already registered automatically
    if (!power_user.experimental_macro_engine) {
        function initLastGenerationType() {
            let lastGenerationType = '';

            MacrosParser.registerMacro('lastGenerationType',
                () => lastGenerationType,
                'Returns the type of the last generation (e.g., "normal", "swipe", "continue", "impersonate", "quiet").',
            );

            eventSource.on(event_types.GENERATION_STARTED, (type, _params, isDryRun) => {
                if (isDryRun) return;
                lastGenerationType = type || 'normal';
            });

            eventSource.on(event_types.CHAT_CHANGED, () => {
                lastGenerationType = '';
            });
        }

        MacrosParser.registerMacro('isMobile',
            () => String(isMobile()),
            'Returns "true" if the user is on a mobile device, "false" otherwise.',
        );
        initLastGenerationType();
    }

    // TODO: Needs to be moved once old macros are deprecated and removed
    initRegisterMacros();
}