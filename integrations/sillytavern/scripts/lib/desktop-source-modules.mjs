// Keys are served paths. Imports are exact upstream literals, mapped to served paths
// or to explicit ports in the extension. "@port/" is resolved at generation time.
const diagnostics = '@port/engine/diagnostics.js';
const enginePorts = '@port/engine/ports.js';
const engineScript = '@port/engine/st/script.js';
const engineUtils = 'st/scripts/utils.js';
const macroDiagnostics = 'st/scripts/macros/engine/MacroDiagnostics.js';
const ejsHost = '@port/cards/ejs-host.js';
const quiet = { [diagnostics]: 'quietConsole as console' };
const macro = 'st/scripts/macros';
const slash = 'st/scripts/slash-commands';

export const desktopSourceModules = {
    'st/scripts/constants.js': {},
    'st/scripts/utils.js': {
        select: ['getStringHash', 'delay', 'isTrueBoolean', 'isFalseBoolean', 'isDigitsOnly', 'stringFormat',
            'dateCache', 'timestampToMoment', 'parseTimestamp', 'escapeRegex', 'trimToEndSentence', 'countOccurrences',
            'isOdd', 'getCharaFilename', 'clamp', 'canUseNegativeLookbehind', 'escapeHtml'],
        bindings: {
            'st/lib.js': 'moment',
            [enginePorts]: 'getCurrentLocale, getContext',
            'st/scripts/uuid.js': 'uuidv4',
            'st/scripts/power-user.js': 'collapseNewlines',
        },
        expose: ['uuidv4', 'dateCache', 'parseTimestamp', 'collapseNewlines'],
    },
    'st/scripts/power-user.js': {
        select: ['collapseNewlines', 'fixMarkdown'],
        bindings: { [engineUtils]: 'countOccurrences, isOdd' },
    },
    'st/scripts/comment-name.js': {
        from: 'public/scripts/slash-commands.js',
        select: ['COMMENT_NAME_DEFAULT'],
    },
    'st/scripts/showdown-underscore.js': {
        replace: [
            [`    } catch (e) {\n        console.error('Error in Showdown-underscore extension:', e);\n        return [];\n    }`,
                `    } catch {\n        console.error('Error in Showdown-underscore extension');\n        return [];\n    }`],
        ],
    },
    'st/scripts/showdown-exclusion.js': {
        imports: {
            './power-user.js': enginePorts,
            '../script.js': engineScript,
        },
    },
    'st/scripts/chats.js': {
        select: ['encodeStyleTags', 'decodeStyleTags', 'getCurrentEntityId', 'isExternalMediaAllowed', 'addDOMPurifyHooks'],
        bindings: {
            'st/lib.js': 'DOMPurify, css',
            [enginePorts]: 'characters, power_user, selected_group, this_chid',
            '@port/cards/format.js': 'accountStorage, toastr, t',
        },
        replace: [
            [`        } catch (error) {\n            return \`CSS ERROR: \${error}\`;\n        }`,
                `        } catch {\n            return 'CSS ERROR';\n        }`],
            ['return characters[this_chid]?.avatar ?? null;', 'return characters?.[this_chid]?.avatar ?? null;'],
            ['!power_user.forbid_external_media', '!power_user?.forbid_external_media', 2],
            ['power_user.external_media_allowed_overrides.includes(entityId)', 'power_user?.external_media_allowed_overrides?.includes(entityId)'],
            ['power_user.external_media_forbidden_overrides.includes(entityId)', 'power_user?.external_media_forbidden_overrides?.includes(entityId)'],
            [`export function addDOMPurifyHooks() {
    // Allow target="_blank" in links
    DOMPurify.addHook('afterSanitizeAttributes', function (node) {
        if ('target' in node) {
            node.setAttribute('target', '_blank');
            node.setAttribute('rel', 'noopener');
        }
    });`, `let domPurifyHooksAdded = false;
export function addDOMPurifyHooks() {
    if (domPurifyHooksAdded) {
        return;
    }
    domPurifyHooksAdded = true;
    const pendingBlockedMedia = new Set();
    const hasNextTraversalNode = (node) => {
        if (node.firstChild) return true;
        let cur = node;
        while (cur && cur.tagName !== 'BODY') {
            if (cur.nextSibling) return true;
            cur = cur.parentNode;
        }
        return false;
    };
    DOMPurify.addHook('beforeSanitizeElements', (node) => {
        for (const blocked of pendingBlockedMedia) {
            if (blocked !== node && !blocked.contains?.(node)) {
                blocked.remove();
                pendingBlockedMedia.delete(blocked);
            }
        }
    });
    // Allow target="_blank" in links
    DOMPurify.addHook('afterSanitizeAttributes', function (node) {
        if ('target' in node) {
            node.setAttribute('target', '_blank');
            node.setAttribute('rel', 'noopener');
        }
        if (pendingBlockedMedia.size > 0 && !hasNextTraversalNode(node)) {
            for (const blocked of pendingBlockedMedia) {
                blocked.remove();
            }
            pendingBlockedMedia.clear();
        }
    });`],
            [`                const isExternalUrl = (url) => (url.indexOf('://') > 0 || url.indexOf('//') === 0) && !url.startsWith(window.location.origin);
                const src = node.getAttribute('src');
                const data = node.getAttribute('data');
                const srcset = node.getAttribute('srcset');

                if (srcset) {
                    const srcsetUrls = srcset.split(',');

                    for (const srcsetUrl of srcsetUrls) {
                        const [url] = srcsetUrl.trim().split(' ');

                        if (isExternalUrl(url)) {
                            console.warn('External media blocked', url);
                            node.remove();
                            mediaBlocked = true;
                            break;
                        }
                    }
                }

                if (src && isExternalUrl(src)) {
                    console.warn('External media blocked', src);
                    mediaBlocked = true;
                    node.remove();
                }

                if (data && isExternalUrl(data)) {
                    console.warn('External media blocked', data);
                    mediaBlocked = true;
                    node.remove();
                }`, `                const isExternalUrl = (rawUrl) => {
                    if (typeof rawUrl !== 'string') return false;
                    const trimmed = rawUrl.trim();
                    if (!trimmed) return false;
                    if (/^data:/i.test(trimmed)) return false;
                    const baseOrigin = window?.location?.origin || globalThis.location?.origin;
                    if (!baseOrigin || baseOrigin === 'null') return true;
                    if (trimmed.includes('\\\\')) return true;
                    try {
                        const parsed = new URL(trimmed, baseOrigin);
                        if (parsed.username || parsed.password) return true;
                        if (parsed.protocol === 'blob:') {
                            return parsed.origin !== baseOrigin;
                        }
                        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                            return true;
                        }
                        return parsed.origin !== baseOrigin;
                    } catch {
                        return true;
                    }
                };
                const src = node.getAttribute('src');
                const data = node.getAttribute('data');
                const srcset = node.getAttribute('srcset');

                if (srcset) {
                    const srcsetUrls = srcset.split(',');

                    for (const srcsetUrl of srcsetUrls) {
                        const [url] = srcsetUrl.trim().split(' ');

                        if (isExternalUrl(url)) {
                            console.warn('External media blocked');
                            node.removeAttribute('srcset');
                            pendingBlockedMedia.add(node);
                            mediaBlocked = true;
                            break;
                        }
                    }
                }

                if (src && isExternalUrl(src)) {
                    console.warn('External media blocked');
                    mediaBlocked = true;
                    node.removeAttribute('src');
                    pendingBlockedMedia.add(node);
                }

                if (data && isExternalUrl(data)) {
                    console.warn('External media blocked');
                    mediaBlocked = true;
                    node.removeAttribute('data');
                    pendingBlockedMedia.add(node);
                }`],
            ['if (accountStorage.getItem(warningShownKey) === null) {', 'if (accountStorage && accountStorage.getItem(warningShownKey) === null) {'],
        ],
    },
    'st/scripts/desktop-formatting.js': {
        from: 'public/script.js',
        select: ['mesForShowdownParse', 'converter', 'systemUserName', 'reloadMarkdownProcessor', 'messageFormatting'],
        bindings: {
            'st/lib.js': 'DOMPurify, showdown',
            [enginePorts]: 'chat, power_user',
            [engineScript]: 'substituteParams',
            [engineUtils]: 'canUseNegativeLookbehind, escapeHtml, escapeRegex',
            'st/scripts/power-user.js': 'fixMarkdown',
            'st/scripts/showdown-exclusion.js': 'markdownExclusionExt',
            'st/scripts/showdown-underscore.js': 'markdownUnderscoreExt',
            'st/scripts/message-formatter.js': 'MessageFormatter',
            'st/scripts/chats.js': 'decodeStyleTags, encodeStyleTags',
            'st/scripts/comment-name.js': 'COMMENT_NAME_DEFAULT',
            '@port/cards/format.js': 'getRegexedString, regex_placement',
        },
        replace: [
            ['power_user.user_prompt_bias', 'power_user?.user_prompt_bias', 2],
            ['!power_user.show_user_prompt_bias', '!power_user?.show_user_prompt_bias'],
            ['power_user.auto_fix_generated_markdown', 'power_user?.auto_fix_generated_markdown'],
            ['power_user.encode_tags', 'power_user?.encode_tags', 3],
            ['[power_user.reasoning.prefix, power_user.reasoning.suffix]', '[power_user?.reasoning?.prefix, power_user?.reasoning?.suffix]'],
            ['!power_user.allow_name2_display', '!power_user?.allow_name2_display'],
        ],
    },
    'st/scripts/util/AccountStorage.js': {
        imports: { '../../script.js': '@port/cards/account-storage.js' },
        bindings: {
            '@port/cards/account-storage.js': 'persistSettings, syncAccountStorageState',
        },
        replace: [
            ['class AccountStorage {', 'export class AccountStorage {'],
            [`    #migrateLocalStorage() {
        const localStorageKeys = [];
        for (let i = 0; i < globalThis.localStorage.length; i++) {
            localStorageKeys.push(globalThis.localStorage.key(i));
        }
        for (const key of localStorageKeys) {
            if (MIGRATABLE_KEYS.some(k => k.test(key))) {
                const value = globalThis.localStorage.getItem(key);
                this.#state[key] = value;
                globalThis.localStorage.removeItem(key);
            }
        }
    }

    /**
     * Initialize the account storage.
     * @param {Object} state Initial state
     */
    init(state) {
        if (state && typeof state === 'object') {
            this.#state = Object.assign(this.#state, state);
        }

        if (!Object.hasOwn(this.#state, MIGRATED_MARKER)) {
            this.#migrateLocalStorage();
            this.#state[MIGRATED_MARKER] = '1';
            saveSettingsDebounced();
        }

        this.#ready = true;
    }`, `    #collectMigratableLocalStorage() {
        const migratedEntries = new Map();
        const localStorageKeys = [];
        for (let i = 0; i < globalThis.localStorage.length; i++) {
            const key = globalThis.localStorage.key(i);
            if (key != null) {
                localStorageKeys.push(key);
            }
        }
        for (const key of localStorageKeys) {
            if (MIGRATABLE_KEYS.some(k => k.test(key))) {
                const value = globalThis.localStorage.getItem(key);
                if (value !== null) {
                    this.#state[key] = value;
                    migratedEntries.set(key, value);
                }
            }
        }
        return migratedEntries;
    }

    /**
     * Initialize the account storage.
     * @param {Object} state Initial state
     */
    init(state) {
        this.#state = state && typeof state === 'object' ? { ...state } : {};
        this.#ready = true;

        if (!Object.hasOwn(this.#state, MIGRATED_MARKER)) {
            const migratedEntries = this.#collectMigratableLocalStorage();
            this.#state[MIGRATED_MARKER] = '1';
            const targetState = this.#state;
            const rollbackMigration = () => {
                if (this.#state !== targetState) return;
                delete targetState[MIGRATED_MARKER];
                syncAccountStorageState(this.getState());
            };
            const commitLocalStorageCleanup = () => {
                if (this.#state !== targetState) return;
                for (const [key, snapshotValue] of migratedEntries.entries()) {
                    if (globalThis.localStorage.getItem(key) === snapshotValue) {
                        globalThis.localStorage.removeItem(key);
                    }
                }
            };
            if (migratedEntries.size > 0) {
                try {
                    const saveResult = persistSettings();
                    if (saveResult && typeof saveResult.then === 'function') {
                        void saveResult.then(
                            res => {
                                if (res !== undefined && res !== null && res !== false && res?.ok !== false) {
                                    commitLocalStorageCleanup();
                                } else {
                                    rollbackMigration();
                                }
                            },
                            () => {
                                rollbackMigration();
                            },
                        );
                    } else {
                        rollbackMigration();
                    }
                } catch {
                    rollbackMigration();
                }
            } else if (state !== undefined) {
                try {
                    const saveResult = saveSettingsDebounced();
                    if (saveResult && typeof saveResult.then === 'function') {
                        void saveResult.catch(() => {});
                    }
                } catch {}
            }
        }
    }`],
            ['console.warn(`AccountStorage not ready (trying to read from ${key})`);', "console.warn('AccountStorage not ready (trying to read)');"],
            ['console.warn(`AccountStorage not ready (trying to write to ${key})`);', "console.warn('AccountStorage not ready (trying to write)');"],
            ['console.warn(`AccountStorage not ready (trying to remove ${key})`);', "console.warn('AccountStorage not ready (trying to remove)');"],
        ],
    },
    'st/scripts/variables.js': {
        select: [
            'getLocalVariable',
            'setLocalVariable',
            'getGlobalVariable',
            'setGlobalVariable',
            'addLocalVariable',
            'addGlobalVariable',
            'incrementLocalVariable',
            'incrementGlobalVariable',
            'decrementLocalVariable',
            'decrementGlobalVariable',
            'getVariableMacros',
            'existsLocalVariable',
            'existsGlobalVariable',
            'deleteLocalVariable',
            'deleteGlobalVariable',
        ],
        bindings: {
            ...quiet,
            [enginePorts]: 'chat_metadata, extension_settings, saveMetadataDebounced, saveSettingsDebounced',
            'st/scripts/desktop-slash-utils.js': 'convertValueType',
        },
    },
    'st/scripts/macros.js': {
        select: [
            'MacrosParser',
            'getChatIdHash',
            'getLastMessageId',
            'getFirstIncludedMessageId',
            'getFirstDisplayedMessageId',
            'getLastMessage',
            'getLastUserMessage',
            'getLastCharMessage',
            'getLastSwipeId',
            'getCurrentSwipeId',
            'getBannedWordsMacro',
            'getTimeSinceLastMessage',
            'getRandomReplaceMacro',
            'getPickReplaceMacro',
            'getDiceRollMacro',
            'getTimeDiffMacro',
            'getOutletPrompt',
            'evaluateMacros',
        ],
        bindings: {
            ...quiet,
            'st/lib.js': 'moment, seedrandom, droll',
            'st/scripts/constants.js': 'inject_ids',
            [engineUtils]: 'timestampToMoment, isDigitsOnly, getStringHash, escapeRegex, uuidv4',
            [enginePorts]: 'chat, chat_metadata, main_api, getMaxPromptTokens, getMaxContextTokens, getMaxResponseTokens, getCurrentChatId, extension_prompts, textgenerationwebui_banned_in_macros, power_user, readInput, readFirstDisplayedMessageId',
            '@port/engine/st/scripts/instruct-mode.js': 'getInstructMacros',
            'st/scripts/variables.js': 'getVariableMacros',
            [`${macro}/macro-system.js`]: 'macros as macroSystem',
        },
        replace: [
            [`function getFirstDisplayedMessageId() {
    const mesId = Number(document.querySelector('#chat .mes')?.getAttribute('mesid'));

    if (!isNaN(mesId) && mesId >= 0) {
        return mesId;
    }

    return null;
}`, 'function getFirstDisplayedMessageId() { return readFirstDisplayedMessageId(); }'],
            [`String($('#send_textarea').val())`, 'readInput()'],
            ['power_user.experimental_macro_engine', 'power_user?.experimental_macro_engine', 6],
        ],
        expose: [
            'getChatIdHash',
            'getFirstIncludedMessageId',
            'getFirstDisplayedMessageId',
            'getLastMessage',
            'getLastUserMessage',
            'getLastCharMessage',
            'getLastSwipeId',
            'getCurrentSwipeId',
            'getBannedWordsMacro',
            'getTimeSinceLastMessage',
            'getRandomReplaceMacro',
            'getPickReplaceMacro',
            'getDiceRollMacro',
            'getTimeDiffMacro',
            'getOutletPrompt',
        ],
    },
    'st/scripts/uuid.js': { from: 'public/scripts/utils.js', select: ['uuidv4'] },
    'st/scripts/system-messages.js': { select: ['system_message_types'] },
    'st/scripts/personas.js': { select: ['persona_description_positions'] },
    'st/scripts/extensions/regex/engine.js': { select: ['regex_placement'] },
    'st/scripts/events.js': { imports: { '../lib/eventemitter.js': 'st/lib/eventemitter.js' } },
    'st/lib/eventemitter.js': {
        replace: [
            [`    if (localStorage.getItem('eventTracing') === 'true') {
        console.trace('Event emitted: ' + event, args);
    } else {
        console.debug('Event emitted: ' + event);
    }`, '', 2],
            ['console.error(err);', '', 2],
        ],
        bindings: quiet,
    },
    'st/scripts/message-formatter.js': {
        imports: { '../script.js': '@port/cards/format.js' },
        replace: [
            [`            } catch (e) {\n                console.error(\`[MessageFormatter] Hook error at stage '\${stage}':\`, e);\n            }`,
                `            } catch {\n                console.error(\`[MessageFormatter] Hook error at stage '\${stage}'\`);\n            }`],
        ],
    },
    'helper/type/scripts.js': {
        imports: { '@/util/color': 'helper/util/color.js', '@sillytavern/scripts/utils': 'st/scripts/uuid.js' },
        bindings: { 'st/lib.js': 'helperZod as z, lodash as _' },
    },
    'helper/type/settings.js': {
        imports: { '@/type/scripts': 'helper/type/scripts.js' },
        bindings: { 'st/lib.js': 'helperZod as z' },
    },
    'helper/type/backward.js': {
        imports: { '@/type/scripts': 'helper/type/scripts.js', '@/type/settings': 'helper/type/settings.js',
            '@/util/color': 'helper/util/color.js', '@sillytavern/scripts/utils': 'st/scripts/uuid.js' },
        bindings: { 'st/lib.js': 'helperZod as z, lodash as _, klona' },
    },
    'helper/util/color.js': {},
    'helper/function/tavern_regex.js': {
        select: ['to_tavern_regex', 'from_tavern_regex'],
        bindings: { 'st/scripts/extensions/regex/engine.js': 'regex_placement' },
    },
    'helper/function/preset.js': {
        select: ['isPresetNormalPrompt', 'isPresetSystemPrompt', 'isPresetPlaceholderPrompt', 'default_preset',
            'in_use_map', 'toPresetPrompt', 'fromPresetPrompt', 'toPreset', 'fromPreset'],
        bindings: {
            'helper/function/tavern_regex.js': 'from_tavern_regex, to_tavern_regex',
            'st/lib.js': 'klona, lodash as _',
            'st/scripts/uuid.js': 'uuidv4',
        },
        expose: ['in_use_map', 'toPreset', 'fromPreset'],
    },
    'helper/function/variables.js': {
        select: ['insertOrAssignVariables', 'insertVariables', 'deleteVariable'],
        bindings: { 'st/lib.js': 'lodash as _' },
        factory: {
            name: 'createHelperVariableUpdates',
            params: '{ updateVariablesWith }',
            exports: ['insertOrAssignVariables', 'insertVariables', 'deleteVariable'],
        },
    },
    'helper/function/macro_like.js': {
        select: ['getVariableOption', 'getWithout$', 'format_variable_regex', 'applyFormatVariable',
            'format_message_variable_quoted_regex', 'applyFormatMessageVariableQuoted', 'macros',
            'registerMacroLike', 'unregisterMacroLike'],
        bindings: { 'st/lib.js': 'lodash as _, omitDeepBy, helperYaml as YAML' },
        replace: [
            ['chat.findLastIndex(', 'getChat().findLastIndex('],
            [
                `  if (!macros.some(macro => macro.regex.source === regex.source)) {
    macros.push({ regex, replace });
  }
  return { unregister: () => unregisterMacroLike(regex) };`,
                `  if (macros.some(macro => macro.regex.source === regex.source)) {
    return { unregister: () => {} };
  }
  const entry = { regex, replace };
  macros.push(entry);
  return {
    unregister: () => {
      const index = macros.indexOf(entry);
      if (index !== -1) {
        macros.splice(index, 1);
      }
    },
  };`,
            ],
        ],
        factory: {
            name: 'createHelperMacroLike',
            params: '{ get_variables_without_clone, getChat }',
            exports: ['macros', 'registerMacroLike', 'unregisterMacroLike'],
        },
    },
    'helper/function/chat_message.js': {
        select: ['string_to_range'],
        bindings: { 'st/lib.js': 'lodash as _' },
        expose: ['string_to_range'],
    },
    'helper/function/generate/types.js': {
        select: ['extension_prompt_roles', 'createGenerateResult', 'placeholder_prompt_default_order',
            'roleTypes', 'default_order', 'character_names_behavior'],
    },
    'helper/function/worldbook.js': {
        select: ['getWorldbookNames', 'getGlobalWorldbookNames', 'getCharWorldbookNames', 'getChatWorldbookName',
            '_default_implicit_keys', 'toWorldbookEntry', 'fromWorldbookEntry', 'handleWorldbookEntriesCollision'],
        bindings: {
            'helper/function/lorebook.js': 'getCharLorebooks, getChatLorebook',
            'st/lib.js': 'klona, lodash as _',
            [ejsHost]: 'getWorldInfoSettings, parseRegexFromString, world_names',
        },
        expose: ['_default_implicit_keys', 'toWorldbookEntry', 'fromWorldbookEntry', 'handleWorldbookEntriesCollision'],
    },
    'helper/function/lorebook.js': {
        select: ['toLorebookSettings', 'getLorebookSettings', 'getCharLorebooks', 'getCurrentCharPrimaryLorebook',
            'getChatLorebook'],
        bindings: {
            'st/lib.js': 'klona, lodash as _',
            [enginePorts]: 'chat_metadata, getCurrentChatId',
            [ejsHost]: 'METADATA_KEY, RawCharacter, getWorldInfoSettings, world_info, world_names',
        },
        expose: ['toLorebookSettings'],
    },
    'helper/function/lorebook_entry.js': {
        select: ['default_original_lorebook_entry', 'toLorebookEntry', 'fromPartialLorebookEntry', 'MAX_UID',
            'handleLorebookEntriesCollision'],
        bindings: { 'st/lib.js': 'lodash as _' },
        expose: ['default_original_lorebook_entry', 'toLorebookEntry', 'fromPartialLorebookEntry', 'MAX_UID',
            'handleLorebookEntriesCollision'],
    },
    'helper/function/character.js': {
        select: ['getCharacterNames', 'getCharacterIds', 'getCurrentCharacterName', 'getCurrentCharacterId',
            'toCharacter', 'getCharacter'],
        bindings: {
            'helper/function/tavern_regex.js': 'to_tavern_regex',
            'helper/function/worldbook.js': 'getCharWorldbookNames',
            'st/lib.js': 'klona, lodash as _',
            [enginePorts]: 'characters, name2, this_chid',
            [ejsHost]: 'RawCharacter',
        },
        replace: [['\n  await unshallowCharacter(String(index));', '']],
        expose: ['toCharacter'],
    },
    'helper/function/raw_character.js': {
        select: ['hasChatFileName', 'getSortedChatList', 'attachCharacterToChats', 'getCharData', 'getCharAvatarPath',
            'getChatHistoryDetail'],
        bindings: { [ejsHost]: 'RawCharacter, getThumbnailUrl' },
        replace: [['const character = new RawCharacter(characterData);', 'const character = characterData;', 2]],
        expose: ['hasChatFileName', 'getSortedChatList', 'attachCharacterToChats'],
    },
    'helper/function/persona.js': {
        select: ['DEFAULT_DEPTH', 'DEFAULT_ROLE', 'getPersonaNames', 'getPersonaIds', 'getCurrentPersonaName',
            'getCurrentPersonaId', 'findPersonaIdsByName', 'findPersonaId', 'getDefaultDescriptor', 'toPersona',
            'getPersonaAvatarPath', 'getPersona'],
        bindings: {
            'st/lib.js': 'klona',
            'st/scripts/personas.js': 'persona_description_positions',
            [enginePorts]: 'power_user',
            [ejsHost]: 'user_avatar',
        },
        expose: ['DEFAULT_DEPTH', 'DEFAULT_ROLE', 'findPersonaIdsByName', 'findPersonaId', 'getDefaultDescriptor',
            'toPersona'],
    },
    'ejs/desktop.js': {
        imports: {
            '/scripts/extensions/third-party/vc-model-settings/desktop/standalone/cards/ejs-host.js': ejsHost,
            '../../../../../lib.js': 'st/lib.js',
            '../libs/faker.mjs': 'ejs/libs/faker.mjs',
        },
        bindings: quiet,
    },
    'ejs/libs/faker.mjs': { imports: { './buffer.mjs': 'ejs/libs/buffer.mjs' } },
    'ejs/libs/buffer.mjs': {},
    [`${macro}/macro-system.js`]: {
        imports: {
            './engine/MacroEngine.js': 'st/scripts/macros/engine/MacroEngine.js',
            './engine/MacroRegistry.js': 'st/scripts/macros/engine/MacroRegistry.js',
            './engine/MacroLexer.js': 'st/scripts/macros/engine/MacroLexer.js',
            './engine/MacroParser.js': 'st/scripts/macros/engine/MacroParser.js',
            './engine/MacroCstWalker.js': 'st/scripts/macros/engine/MacroCstWalker.js',
            './engine/MacroEnvBuilder.js': 'st/scripts/macros/engine/MacroEnvBuilder.js',
            './definitions/core-macros.js': 'st/scripts/macros/definitions/core-macros.js',
            './definitions/env-macros.js': 'st/scripts/macros/definitions/env-macros.js',
            './definitions/state-macros.js': 'st/scripts/macros/definitions/state-macros.js',
            './definitions/chat-macros.js': 'st/scripts/macros/definitions/chat-macros.js',
            './definitions/time-macros.js': 'st/scripts/macros/definitions/time-macros.js',
            './definitions/variable-macros.js': 'st/scripts/macros/definitions/variable-macros.js',
            './definitions/instruct-macros.js': 'st/scripts/macros/definitions/instruct-macros.js',
        },
    },
    [`${macro}/definitions/core-macros.js`]: {
        imports: {
            '../../../lib.js': 'st/lib.js',
            '../../../script.js': engineScript,
            '../../utils.js': engineUtils,
            '../../textgen-settings.js': enginePorts,
            '../../constants.js': 'st/scripts/constants.js',
            '../engine/MacroRegistry.js': 'st/scripts/macros/engine/MacroRegistry.js',
            '../engine/MacroLexer.js': 'st/scripts/macros/engine/MacroLexer.js',
            '../engine/MacroParser.js': 'st/scripts/macros/engine/MacroParser.js',
            '../engine/MacroCstWalker.js': 'st/scripts/macros/engine/MacroCstWalker.js',
        },
        bindings: { ...quiet, [enginePorts]: 'readInput' },
        replace: [[`handler: () => (/** @type {HTMLTextAreaElement} */(document.querySelector('#send_textarea')))?.value ?? ''`, 'handler: readInput']],
    },
    [`${macro}/definitions/env-macros.js`]: {
        imports: {
            '../engine/MacroRegistry.js': 'st/scripts/macros/engine/MacroRegistry.js',
            '../../RossAscends-mods.js': enginePorts,
            '../../../script.js': engineScript,
            '../../power-user.js': enginePorts,
            '../../instruct-mode.js': '@port/engine/st/scripts/instruct-mode.js',
        },
    },
    [`${macro}/definitions/state-macros.js`]: {
        select: ['registerStateMacros'],
        bindings: {
            'st/scripts/macros/engine/MacroRegistry.js': 'MacroRegistry, MacroCategory',
            [enginePorts]: 'findExtension, getLastGenerationType',
        },
        replace: [
            ['    ensureLastGenerationTypeTracking();\n\n', ''],
            ['handler: () => lastGenerationTypeValue', 'handler: getLastGenerationType'],
        ],
    },
    [`${macro}/definitions/chat-macros.js`]: {
        imports: {
            '../engine/MacroRegistry.js': 'st/scripts/macros/engine/MacroRegistry.js',
            '../../../script.js': engineScript,
        },
        bindings: { ...quiet, [enginePorts]: 'readFirstDisplayedMessageId' },
        replace: [[`function getFirstDisplayedMessageId() {
    const mesElement = document.querySelector('#chat .mes');
    const mesId = Number(mesElement?.getAttribute('mesid'));
    if (!Number.isNaN(mesId) && mesId >= 0) {
        return mesId;
    }
    return null;
}`, 'function getFirstDisplayedMessageId() { return readFirstDisplayedMessageId(); }']],
    },
    [`${macro}/definitions/time-macros.js`]: {
        imports: {
            '../../../lib.js': 'st/lib.js',
            '../../../script.js': engineScript,
            '../../utils.js': engineUtils,
            '../engine/MacroRegistry.js': 'st/scripts/macros/engine/MacroRegistry.js',
        },
    },
    [`${macro}/definitions/variable-macros.js`]: {
        imports: {
            '../engine/MacroRegistry.js': 'st/scripts/macros/engine/MacroRegistry.js',
        },
        bindings: { ...quiet, [enginePorts]: 'getContext' },
        replace: [['SillyTavern.getContext()', 'getContext()']],
    },
    [`${macro}/definitions/instruct-macros.js`]: {
        imports: {
            '../engine/MacroRegistry.js': 'st/scripts/macros/engine/MacroRegistry.js',
            '../../power-user.js': enginePorts,
        },
    },
    [`${macro}/engine/MacroDiagnostics.js`]: {
        select: [
            'createMacroRuntimeError',
            'logMacroRuntimeWarning',
            'logMacroInternalError',
            'logMacroRegisterWarning',
            'logMacroRegisterError',
            'logMacroGeneralError',
            'logMacroSyntaxWarning',
            'buildMacroPayload',
            'inferMacroName',
        ],
        bindings: quiet,
    },
    [`${macro}/engine/MacroEngine.js`]: {
        imports: {
            './MacroParser.js': 'st/scripts/macros/engine/MacroParser.js',
            './MacroCstWalker.js': 'st/scripts/macros/engine/MacroCstWalker.js',
            './MacroRegistry.js': 'st/scripts/macros/engine/MacroRegistry.js',
            './MacroDiagnostics.js': macroDiagnostics,
            '../definitions/core-macros.js': 'st/scripts/macros/definitions/core-macros.js',
        },
    },
    [`${macro}/engine/MacroRegistry.js`]: {
        imports: {
            './MacroLexer.js': 'st/scripts/macros/engine/MacroLexer.js',
            '../../utils.js': engineUtils,
            './MacroEngine.js': 'st/scripts/macros/engine/MacroEngine.js',
            './MacroDiagnostics.js': macroDiagnostics,
        },
    },
    [`${macro}/engine/MacroCstWalker.js`]: {
        imports: {
            './MacroDiagnostics.js': macroDiagnostics,
            './MacroEngine.js': 'st/scripts/macros/engine/MacroEngine.js',
            './MacroFlags.js': 'st/scripts/macros/engine/MacroFlags.js',
            './MacroParser.js': 'st/scripts/macros/engine/MacroParser.js',
            './MacroRegistry.js': 'st/scripts/macros/engine/MacroRegistry.js',
            '/scripts/utils.js': engineUtils,
        },
        bindings: { ...quiet, [enginePorts]: 'getContext' },
        replace: [['SillyTavern.getContext()', 'getContext()']],
    },
    [`${macro}/engine/MacroFlags.js`]: {
        bindings: quiet,
    },
    [`${macro}/engine/MacroParser.js`]: {
        imports: {
            '../../../lib.js': 'st/lib.js',
            './MacroLexer.js': 'st/scripts/macros/engine/MacroLexer.js',
        },
    },
    [`${macro}/engine/MacroLexer.js`]: {
        imports: {
            '../../../lib.js': 'st/lib.js',
        },
    },
    [`${macro}/engine/MacroEnvBuilder.js`]: {
        imports: {
            '../../../script.js': engineScript,
            '../../../scripts/group-chats.js': enginePorts,
            './MacroDiagnostics.js': macroDiagnostics,
            '/scripts/utils.js': engineUtils,
        },
    },

    'st/scripts/autocomplete/EnhancedMacroAutoCompleteOption.js': {
        select: ['VARIABLE_SHORTHAND_NAME_PATTERN', 'isShortOperatorPrefix', 'VariableOperatorDefinitions', 'parseMacroContext'],
        bindings: {
            [`${macro}/engine/MacroFlags.js`]: 'ValidFlagSymbols',
            [`${macro}/engine/MacroLexer.js`]: 'MACRO_VARIABLE_SHORTHAND_PATTERN',
        },
    },
    [`${slash}/SlashCommandCommonEnumsProvider.js`]: {
        select: ['enumIcons', 'commonEnumProviders'],
        objectMembers: { enumIcons: ['true', 'false', 'boolean'], commonEnumProviders: ['boolean'] },
        bindings: { [`${slash}/SlashCommandEnumValue.js`]: 'SlashCommandEnumValue' },
    },
    'st/scripts/desktop-slash-utils.js': {
        from: 'public/scripts/utils.js',
        select: ['convertValueType'],
        bindings: {
            [`${slash}/SlashCommandClosure.js`]: 'SlashCommandClosure',
            [engineUtils]: 'isTrueBoolean',
        },
    },
    [`${slash}/SlashCommandParser.js`]: {
        omitUi: {
            methods: ['getHelpString', 'getNameAt'],
            imports: [
                '../autocomplete/AutoCompleteNameResult.js',
                './SlashCommandQuickReplyAutoCompleteOption.js',
                './SlashCommandVariableAutoCompleteOption.js',
                './SlashCommandAutoCompleteNameResult.js',
                '../autocomplete/MacroAutoCompleteHelper.js',
            ],
        },
        imports: {
            '../../lib.js': 'st/lib.js',
            '../power-user.js': enginePorts,
            '../utils.js': engineUtils,
            './SlashCommand.js': 'st/scripts/slash-commands/SlashCommand.js',
            './SlashCommandArgument.js': 'st/scripts/slash-commands/SlashCommandArgument.js',
            './SlashCommandClosure.js': 'st/scripts/slash-commands/SlashCommandClosure.js',
            './SlashCommandExecutor.js': 'st/scripts/slash-commands/SlashCommandExecutor.js',
            './SlashCommandParserError.js': 'st/scripts/slash-commands/SlashCommandParserError.js',
            './SlashCommandScope.js': 'st/scripts/slash-commands/SlashCommandScope.js',
            './SlashCommandNamedArgumentAssignment.js': 'st/scripts/slash-commands/SlashCommandNamedArgumentAssignment.js',
            './SlashCommandAbortController.js': 'st/scripts/slash-commands/SlashCommandAbortController.js',
            './SlashCommandUnnamedArgumentAssignment.js': 'st/scripts/slash-commands/SlashCommandUnnamedArgumentAssignment.js',
            './SlashCommandEnumValue.js': 'st/scripts/slash-commands/SlashCommandEnumValue.js',
            './SlashCommandBreakPoint.js': 'st/scripts/slash-commands/SlashCommandBreakPoint.js',
            './SlashCommandDebugController.js': 'st/scripts/slash-commands/SlashCommandDebugController.js',
            './SlashCommandCommonEnumsProvider.js': 'st/scripts/slash-commands/SlashCommandCommonEnumsProvider.js',
            './SlashCommandBreak.js': 'st/scripts/slash-commands/SlashCommandBreak.js',
            '../autocomplete/EnhancedMacroAutoCompleteOption.js': 'st/scripts/autocomplete/EnhancedMacroAutoCompleteOption.js',
        },
        bindings: quiet,
        replace: [
            ['power_user.stscript.parser.flags[', 'power_user?.stscript?.parser?.flags?.['],
            ['power_user.experimental_macro_engine', 'power_user?.experimental_macro_engine'],
        ],
    },
    [`${slash}/SlashCommandClosure.js`]: {
        imports: {
            '../../script.js': engineScript,
            '../power-user.js': enginePorts,
            '../utils.js': engineUtils,
            './SlashCommand.js': 'st/scripts/slash-commands/SlashCommand.js',
            './SlashCommandAbortController.js': 'st/scripts/slash-commands/SlashCommandAbortController.js',
            './SlashCommandBreak.js': 'st/scripts/slash-commands/SlashCommandBreak.js',
            './SlashCommandBreakController.js': 'st/scripts/slash-commands/SlashCommandBreakController.js',
            './SlashCommandBreakPoint.js': 'st/scripts/slash-commands/SlashCommandBreakPoint.js',
            './SlashCommandClosureResult.js': 'st/scripts/slash-commands/SlashCommandClosureResult.js',
            './SlashCommandDebugController.js': 'st/scripts/slash-commands/SlashCommandDebugController.js',
            './SlashCommandExecutionError.js': 'st/scripts/slash-commands/SlashCommandExecutionError.js',
            './SlashCommandExecutor.js': 'st/scripts/slash-commands/SlashCommandExecutor.js',
            './SlashCommandNamedArgumentAssignment.js': 'st/scripts/slash-commands/SlashCommandNamedArgumentAssignment.js',
            './SlashCommandScope.js': 'st/scripts/slash-commands/SlashCommandScope.js',
        },
        bindings: quiet,
        replace: [['power_user.experimental_macro_engine', 'power_user?.experimental_macro_engine']],
    },
    [`${slash}/SlashCommandScope.js`]: {
        imports: {
            './SlashCommandClosure.js': 'st/scripts/slash-commands/SlashCommandClosure.js',
            '../utils.js': 'st/scripts/desktop-slash-utils.js',
        },
    },
    [`${slash}/SlashCommand.js`]: {
        omitUi: {
            methods: ['renderHelpItem', 'renderHelpDetails'],
            imports: [
                '../../lib.js',
                '../i18n.js',
            ],
        },
        imports: {
            './SlashCommandAbortController.js': 'st/scripts/slash-commands/SlashCommandAbortController.js',
            './SlashCommandArgument.js': 'st/scripts/slash-commands/SlashCommandArgument.js',
            './SlashCommandClosure.js': 'st/scripts/slash-commands/SlashCommandClosure.js',
            './SlashCommandDebugController.js': 'st/scripts/slash-commands/SlashCommandDebugController.js',
            './SlashCommandScope.js': 'st/scripts/slash-commands/SlashCommandScope.js',
        },
    },
    [`${slash}/SlashCommandArgument.js`]: {
        imports: {
            './SlashCommandClosure.js': 'st/scripts/slash-commands/SlashCommandClosure.js',
            './SlashCommandCommonEnumsProvider.js': 'st/scripts/slash-commands/SlashCommandCommonEnumsProvider.js',
            './SlashCommandEnumValue.js': 'st/scripts/slash-commands/SlashCommandEnumValue.js',
            './SlashCommandExecutor.js': 'st/scripts/slash-commands/SlashCommandExecutor.js',
            './SlashCommandScope.js': 'st/scripts/slash-commands/SlashCommandScope.js',
        },
    },
    [`${slash}/SlashCommandExecutor.js`]: {
        imports: {
            '../utils.js': engineUtils,
            './SlashCommand.js': 'st/scripts/slash-commands/SlashCommand.js',
            './SlashCommandClosure.js': 'st/scripts/slash-commands/SlashCommandClosure.js',
            './SlashCommandNamedArgumentAssignment.js': 'st/scripts/slash-commands/SlashCommandNamedArgumentAssignment.js',
            './SlashCommandUnnamedArgumentAssignment.js': 'st/scripts/slash-commands/SlashCommandUnnamedArgumentAssignment.js',
        },
    },
    [`${slash}/SlashCommandParserError.js`]: {
    },
    [`${slash}/SlashCommandNamedArgumentAssignment.js`]: {
        imports: {
            './SlashCommandClosure.js': 'st/scripts/slash-commands/SlashCommandClosure.js',
        },
    },
    [`${slash}/SlashCommandAbortController.js`]: {
        imports: {
            './AbstractEventTarget.js': 'st/scripts/slash-commands/AbstractEventTarget.js',
        },
    },
    [`${slash}/SlashCommandUnnamedArgumentAssignment.js`]: {
        imports: {
            './SlashCommandClosure.js': 'st/scripts/slash-commands/SlashCommandClosure.js',
        },
    },
    [`${slash}/SlashCommandEnumValue.js`]: {
    },
    [`${slash}/SlashCommandBreakPoint.js`]: {
        imports: {
            './SlashCommandExecutor.js': 'st/scripts/slash-commands/SlashCommandExecutor.js',
        },
    },
    [`${slash}/SlashCommandDebugController.js`]: {
        imports: {
            './SlashCommandClosure.js': 'st/scripts/slash-commands/SlashCommandClosure.js',
            './SlashCommandExecutor.js': 'st/scripts/slash-commands/SlashCommandExecutor.js',
        },
    },
    [`${slash}/SlashCommandBreak.js`]: {
        imports: {
            './SlashCommandExecutor.js': 'st/scripts/slash-commands/SlashCommandExecutor.js',
        },
    },
    [`${slash}/SlashCommandBreakController.js`]: {
    },
    [`${slash}/SlashCommandClosureResult.js`]: {
    },
    [`${slash}/SlashCommandExecutionError.js`]: {
    },
    [`${slash}/AbstractEventTarget.js`]: {
    },
};
