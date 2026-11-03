// AGPL-3.0-only. Locked upstream algorithms, adapted 2026-11-03 for explicit desktop ports.
import { getCurrentChatId, chat, chat_metadata, characters, this_chid, name1, name2, extension_settings } from '../engine/ports.js';
import { substituteParamsExtended } from '../engine/st/script.js';
import { klona } from './klona.js';
import { RawCharacter, world_info, getWorldInfoSettings, world_names, loadWorldInfo, parseRegexFromString, METADATA_KEY } from './ejs-host.js';
function toLorebookSettings(world_info_settings) {
    return {
        selected_global_lorebooks: world_info_settings.world_info.globalSelect,
        scan_depth: world_info_settings.world_info_depth,
        context_percentage: world_info_settings.world_info_budget,
        budget_cap: world_info_settings.world_info_budget_cap,
        min_activations: world_info_settings.world_info_min_activations,
        max_depth: world_info_settings.world_info_min_activations_depth_max,
        max_recursion_steps: world_info_settings.world_info_max_recursion_steps,
        insertion_strategy: { 0: 'evenly', 1: 'character_first', 2: 'global_first' }[world_info_settings.world_info_character_strategy],
        include_names: world_info_settings.world_info_include_names,
        recursive: world_info_settings.world_info_recursive,
        case_sensitive: world_info_settings.world_info_case_sensitive,
        match_whole_words: world_info_settings.world_info_match_whole_words,
        use_group_scoring: world_info_settings.world_info_use_group_scoring,
        overflow_alert: world_info_settings.world_info_overflow_alert,
    };
}
export function getLorebookSettings() {
    return klona(toLorebookSettings(getWorldInfoSettings()));
}
export function getCharLorebooks({ name = 'current' } = {}) {
    const character = RawCharacter.find({ name: name });
    const books = { primary: null, additional: [] };
    if (!character) {
        if (name === 'current') {
            return books;
        }
        throw Error(`未找到${`名为 '${name}' `}的角色卡`);
    }
    if (character.data?.extensions?.world) {
        books.primary = character.data?.extensions?.world || null;
    }
    // TODO: 提取成函数
    const filename = character.avatar.replace(/\.[^/.]+$/, '');
    const extra_charlore = world_info.charLore?.find(e => e.name === filename);
    if (extra_charlore && Array.isArray(extra_charlore.extraBooks)) {
        books.additional = extra_charlore.extraBooks;
    }
    return klona(books);
}
export function getCurrentCharPrimaryLorebook() {
    return getCharLorebooks().primary;
}
export function getChatLorebook() {
    const chat_id = getCurrentChatId();
    if (!chat_id) {
        throw Error(`未打开任何聊天, 不可获取聊天世界书`);
    }
    const existing_lorebook = _.get(chat_metadata, METADATA_KEY, '');
    if (world_names.includes(existing_lorebook)) {
        return existing_lorebook;
    }
    _.unset(chat_metadata, METADATA_KEY);
    return null;
}
function toLorebookEntry(entry) {
    return {
        uid: entry.uid,
        display_index: entry.displayIndex,
        comment: entry.comment,
        enabled: !entry.disable,
        type: entry.constant ? 'constant' : entry.vectorized ? 'vectorized' : 'selective',
        position: {
            0: 'before_character_definition',
            1: 'after_character_definition',
            5: 'before_example_messages',
            6: 'after_example_messages',
            2: 'before_author_note',
            3: 'after_author_note',
        }[entry.position] ??
            (entry.role === 1 ? 'at_depth_as_user' : entry.role === 2 ? 'at_depth_as_assistant' : 'at_depth_as_system'),
        depth: entry.position === 4 ? entry.depth : null,
        order: entry.order,
        probability: entry.probability,
        key: entry.key,
        keys: entry.key,
        logic: {
            0: 'and_any',
            1: 'not_all',
            2: 'not_any',
            3: 'and_all',
        }[entry.selectiveLogic],
        filter: entry.keysecondary,
        filters: entry.keysecondary,
        scan_depth: entry.scanDepth ?? 'same_as_global',
        case_sensitive: entry.caseSensitive ?? 'same_as_global',
        match_whole_words: entry.matchWholeWords ?? 'same_as_global',
        use_group_scoring: entry.useGroupScoring ?? 'same_as_global',
        automation_id: entry.automationId || null,
        exclude_recursion: entry.excludeRecursion,
        prevent_recursion: entry.preventRecursion,
        delay_until_recursion: entry.delayUntilRecursion,
        content: entry.content,
        group: entry.group,
        group_prioritized: entry.groupOverride,
        group_weight: entry.groupWeight,
        sticky: entry.sticky || null,
        cooldown: entry.cooldown || null,
        delay: entry.delay || null,
    };
}
export async function getLorebookEntries(lorebook, { filter = 'none' } = {}) {
    if (!world_names.includes(lorebook)) {
        throw Error(`未能找到世界书 '${lorebook}'`);
    }
    const data = (await loadWorldInfo(lorebook));
    let entries = _(data.entries).values().map(toLorebookEntry).value();
    if (filter !== 'none') {
        entries = entries.filter(entry => Object.entries(filter).every(([field, expected_value]) => {
            const entry_value = entry[field];
            if (Array.isArray(entry_value)) {
                return expected_value.every(value => entry_value.includes(value));
            }
            if (typeof entry_value === 'string') {
                return entry_value.includes(expected_value);
            }
            return entry_value === expected_value;
        }));
    }
    return klona(entries);
}
export function getWorldbookNames() {
    return klona(world_names);
}
export function getGlobalWorldbookNames() {
    return klona(getWorldInfoSettings().world_info.globalSelect);
}
export function getCharWorldbookNames(character_name_or_id) {
    return getCharLorebooks({ name: character_name_or_id });
}
export function getChatWorldbookName(chat_name) {
    if (chat_name !== 'current') {
        throw Error(`目前不支持对非当前聊天调用 getChatWorldbookName`);
    }
    return getChatLorebook();
}
function toWorldbookEntry(entry) {
    let result = _({})
        .set('uid', entry.uid)
        .set('name', entry.comment)
        .set('enabled', !entry.disable)
        .set('strategy.type', entry.constant ? 'constant' : entry.vectorized ? 'vectorized' : 'selective')
        .set('strategy.keys', entry.key.map(value => parseRegexFromString(value) ?? value))
        .set('strategy.keys_secondary', {
        logic: { 0: 'and_any', 1: 'not_all', 2: 'not_any', 3: 'and_all' }[entry.selectiveLogic],
        keys: entry.keysecondary.map(value => parseRegexFromString(value) ?? value),
    })
        .set('strategy.scan_depth', entry.scanDepth ?? 'same_as_global')
        .set('position.type', {
        0: 'before_character_definition',
        1: 'after_character_definition',
        5: 'before_example_messages',
        6: 'after_example_messages',
        2: 'before_author_note',
        3: 'after_author_note',
        4: 'at_depth',
        7: 'outlet',
    }[entry.position])
        .set('position.role', { 0: 'system', 1: 'user', 2: 'assistant' }[entry.role ?? 0])
        .set('position.depth', entry.depth)
        .set('position.order', entry.order)
        .set('content', entry.content)
        .set('probability', entry.useProbability ? entry.probability : 100)
        .set('recursion.prevent_incoming', entry.excludeRecursion)
        .set('recursion.prevent_outgoing', entry.preventRecursion)
        .set('recursion.delay_until', typeof entry.delayUntilRecursion === 'number' && entry.delayUntilRecursion > 0 ? entry.delayUntilRecursion : null)
        .set('effect.sticky', typeof entry.sticky === 'number' && entry.sticky > 0 ? entry.sticky : null)
        .set('effect.cooldown', typeof entry.cooldown === 'number' && entry.cooldown > 0 ? entry.cooldown : null)
        .set('effect.delay', typeof entry.delay === 'number' && entry.delay > 0 ? entry.delay : null);
    if (entry.extra) {
        result = result.set('extra', entry.extra);
    }
    result = result.merge(_.pick(entry, Object.keys(_default_implicit_keys)));
    return result.value();
}
export async function getWorldbook(worldbook_name) {
    if (!getWorldbookNames().includes(worldbook_name)) {
        throw Error(`未能找到世界书 '${worldbook_name}'`);
    }
    const original_worldbook_entries = await loadWorldInfo(worldbook_name).then(data => data ?? {});
    return klona(_(original_worldbook_entries.entries).values().sortBy('displayIndex').map(toWorldbookEntry).value());
}

const _default_implicit_keys = {
    addMemo: true,
    matchPersonaDescription: false,
    matchCharacterDescription: false,
    matchCharacterPersonality: false,
    matchCharacterDepthPrompt: false,
    matchScenario: false,
    matchCreatorNotes: false,
    group: '',
    groupOverride: false,
    groupWeight: 100,
    caseSensitive: null,
    matchWholeWords: null,
    useGroupScoring: null,
    automationId: '',
    ignoreBudget: false,
    outletName: '',
    triggers: [],
    characterFilter: {
        isExclude: false,
        names: [],
        tags: [],
    },
};
