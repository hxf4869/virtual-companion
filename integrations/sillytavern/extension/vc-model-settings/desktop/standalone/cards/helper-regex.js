// PolyForm-Noncommercial-1.0.0. JS-Slash-Runner 437412b20c8c33bcd4dbbe1ffaeae5abebfd2fb6 / src/function/tavern_regex.ts
import { characters, chat, extension_settings, oai_settings, this_chid } from '../engine/ports.js';
import { getRegexedString, regex_placement, substituteParams, getCardHost, RawCharacter } from './ejs-host.js';
import { replaceMacroLike } from './helper-util.js';
import { klona } from './klona.js';

export function formatAsTavernRegexedString(text, source, destination, options = {}) {
    if (typeof source === 'object' && source !== null) {
        options = source;
        source = options.source ?? 'ai_output';
        destination = options.destination ?? 'display';
    }
    const { depth, character_name } = options;
    let result = getRegexedString(
        text,
        {
            user_input: regex_placement.USER_INPUT,
            ai_output: regex_placement.AI_OUTPUT,
            slash_command: regex_placement.SLASH_COMMAND,
            world_info: regex_placement.WORLD_INFO,
            reasoning: regex_placement.REASONING,
        }[source],
        {
            characterOverride: character_name,
            isMarkdown: destination === 'display',
            isPrompt: destination === 'prompt',
            depth,
        },
    );
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
            data = (id !== -1 ? characters?.at(id)?.data?.extensions?.regex_scripts : undefined) ?? [];
            break;
        }
        case 'preset': {
            const name = option.name ?? 'in_use';
            const host = getCardHost();
            const preset = name === 'in_use' ? oai_settings : host?.presets?.[name];
            data = preset?.extensions?.regex_scripts ?? [];
            break;
        }
    }
    return data.map(to_tavern_regex);
}

export function to_tavern_regex(regex_script_data) {
    return {
        id: regex_script_data.id,
        script_name: regex_script_data.scriptName,
        enabled: !regex_script_data.disabled,
        find_regex: regex_script_data.findRegex,
        trim_strings: regex_script_data.trimStrings || [],
        replace_string: regex_script_data.replaceString,
        source: {
            user_input: Boolean(regex_script_data.placement?.includes(regex_placement.USER_INPUT)),
            ai_output: Boolean(regex_script_data.placement?.includes(regex_placement.AI_OUTPUT)),
            slash_command: Boolean(regex_script_data.placement?.includes(regex_placement.SLASH_COMMAND)),
            world_info: Boolean(regex_script_data.placement?.includes(regex_placement.WORLD_INFO)),
            reasoning: Boolean(regex_script_data.placement?.includes(regex_placement.REASONING)),
        },
        destination: {
            display: Boolean(regex_script_data.markdownOnly),
            prompt: Boolean(regex_script_data.promptOnly),
        },
        run_on_edit: Boolean(regex_script_data.runOnEdit),
        min_depth: typeof regex_script_data.minDepth === 'number' ? regex_script_data.minDepth : null,
        max_depth: typeof regex_script_data.maxDepth === 'number' ? regex_script_data.maxDepth : null,
    };
}

export function from_tavern_regex(tavern_regex) {
    return {
        id: tavern_regex.id,
        scriptName: tavern_regex.script_name,
        disabled: !tavern_regex.enabled,
        runOnEdit: tavern_regex.run_on_edit,
        findRegex: tavern_regex.find_regex,
        trimStrings: tavern_regex.trim_strings || [],
        replaceString: tavern_regex.replace_string,
        placement: [
            ...(tavern_regex.source?.user_input ? [regex_placement.USER_INPUT] : []),
            ...(tavern_regex.source?.ai_output ? [regex_placement.AI_OUTPUT] : []),
            ...(tavern_regex.source?.slash_command ? [regex_placement.SLASH_COMMAND] : []),
            ...(tavern_regex.source?.world_info ? [regex_placement.WORLD_INFO] : []),
            ...(tavern_regex.source?.reasoning ? [regex_placement.REASONING] : []),
        ],
        substituteRegex: 0,
        minDepth: tavern_regex.min_depth ?? null,
        maxDepth: tavern_regex.max_depth ?? null,
        markdownOnly: Boolean(tavern_regex.destination?.display),
        promptOnly: Boolean(tavern_regex.destination?.prompt),
    };
}

export function isCharacterTavernRegexesEnabled() {
    return Boolean(
        extension_settings?.character_allowed_regex?.includes(
            characters?.at(Number(this_chid))?.avatar ?? '',
        ),
    );
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
