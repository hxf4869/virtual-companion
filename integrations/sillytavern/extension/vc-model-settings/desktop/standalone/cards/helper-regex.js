// PolyForm-Noncommercial-1.0.0. JS-Slash-Runner 0af421068 / src/function/tavern_regex.ts
import { characters, chat, extension_settings, oai_settings, this_chid } from '../engine/ports.js';
import { substituteParams } from '../engine/st/script.js';
import { regex_placement } from '../../locked-source/st/scripts/extensions/regex/engine.js';
import { getCardHost, getRegexedString, RawCharacter } from './ejs-host.js';
import { klona } from './klona.js';
import { replaceMacroLike } from './helper-util.js';
import { to_tavern_regex, from_tavern_regex } from '../../locked-source/helper/function/tavern_regex.js';

export { to_tavern_regex, from_tavern_regex };

export function formatAsTavernRegexedString(text, sourceOrOptions, destinationArg, optionsArg = {}) {
    let source = sourceOrOptions;
    let destination = destinationArg;
    let options = optionsArg;
    if (sourceOrOptions && typeof sourceOrOptions === 'object') {
        source = sourceOrOptions.source;
        destination = sourceOrOptions.destination;
        options = sourceOrOptions;
    }
    const { depth, character_name } = options || {};
    const placement = {
        user_input: regex_placement.USER_INPUT,
        ai_output: regex_placement.AI_OUTPUT,
        slash_command: regex_placement.SLASH_COMMAND,
        world_info: regex_placement.WORLD_INFO,
        reasoning: regex_placement.REASONING,
    }[source];
    let result = getRegexedString(text, placement, {
        characterOverride: character_name,
        isMarkdown: destination === 'display',
        isPrompt: destination === 'prompt',
        depth,
    });
    result = substituteParams(result, undefined, character_name, undefined, undefined);
    result = replaceMacroLike(result, {
        source: destination,
        role: {
            user_input: 'user',
            ai_output: 'assistant',
            slash_command: 'system',
            world_info: 'system',
            reasoning: 'system',
        }[source],
        message_id: depth !== undefined ? chat.length - depth - 1 : undefined,
    });
    return result;
}

export function get_tavern_regexes_without_clone(option) {
    let data = [];
    switch (option.type) {
        case 'global':
            data = extension_settings?.regex ?? [];
            break;
        case 'character': {
            const id = RawCharacter.findIndex(option.name ?? 'current');
            data = id >= 0 ? (characters.at(id)?.data?.extensions?.regex_scripts ?? []) : [];
            break;
        }
        case 'preset': {
            const host = getCardHost();
            const name = option.name ?? 'in_use';
            const preset = name === 'in_use' ? oai_settings : host?.presets?.[name];
            data = preset?.extensions?.regex_scripts ?? [];
            break;
        }
    }
    return data.map(to_tavern_regex);
}

export function isCharacterTavernRegexesEnabled() {
    return Boolean(extension_settings?.character_allowed_regex?.includes(
        characters.at(Number(this_chid))?.avatar ?? '',
    ));
}

export function getTavernRegexes(option) {
    if (option?.type === undefined) {
        option ??= { type: 'global' };
        const { scope = 'all', enable_state = 'all' } = option;
        if (!['all', 'enabled', 'disabled'].includes(enable_state)) {
            throw Error(`提供的 enable_state 无效, 请提供 'all', 'enabled' 或 'disabled', 你提供的是: ${enable_state}`);
        }
        if (!['all', 'global', 'character'].includes(scope)) {
            throw Error(`提供的 scope 无效, 请提供 'all', 'global' 或 'character', 你提供的是: ${scope}`);
        }
        let regexes = [];
        if (scope === 'all' || scope === 'global') {
            regexes = [
                ...regexes,
                ...get_tavern_regexes_without_clone({ type: 'global' }).map(regex => ({ ...regex, scope: 'global' })),
            ];
        }
        if (scope === 'all' || scope === 'character') {
            regexes = [
                ...regexes,
                ...get_tavern_regexes_without_clone({ type: 'character' }).map(regex => ({ ...regex, scope: 'character' })),
            ];
        }
        if (enable_state !== 'all') {
            regexes = regexes.filter(regex => regex.enabled === (enable_state === 'enabled'));
        }
        return klona(regexes);
    }
    return klona(get_tavern_regexes_without_clone(option));
}
