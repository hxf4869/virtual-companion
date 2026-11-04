// AGPL-3.0-only. JS-Slash-Runner 0af421068 / src/iframe/exported/worldbook.ts
// 保留本地预编译拷贝：上游为 TypeScript 源码且依赖原生世界书 UI，此处绑定 ejs-host.js、settings-documents.js 与 B2 setLorebookSettings 同步语义。
import { getCurrentChatId, chat, chat_metadata, characters, this_chid, name1, name2, extension_settings } from '../engine/ports.js';
import { substituteParamsExtended } from '../engine/st/script.js';
import { klona } from './klona.js';
import { RawCharacter, world_info, getWorldInfoSettings, world_names, loadWorldInfo, parseRegexFromString, METADATA_KEY, getCardHost, refreshCardHost } from './ejs-host.js';
import { documentChanges } from '../../../settings-documents.js';
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
export function setLorebookSettings(settings) {
    if (settings.selected_global_lorebooks !== undefined) {
        const inexisting_lorebooks = settings.selected_global_lorebooks.filter(
            lorebook => !world_names.includes(lorebook),
        );
        if (inexisting_lorebooks.length > 0) {
            throw Error(`尝试修改要全局启用的世界书, 但未找到以下世界书: ${JSON.stringify(inexisting_lorebooks)}`);
        }
    }
    const original_settings = getLorebookSettings();
    const diff_settings = _.omitBy(settings, (value, key) => value === undefined || value === original_settings[key]);
    if (Object.keys(diff_settings).length === 0) return;
    const host = getCardHost();
    const target = host.settings;
    target.world_info ||= {};
    if (diff_settings.selected_global_lorebooks !== undefined) {
        target.world_info.globalSelect = [...diff_settings.selected_global_lorebooks];
    }
    if (diff_settings.scan_depth !== undefined) {
        target.world_info_depth = diff_settings.scan_depth;
    }
    if (diff_settings.context_percentage !== undefined) {
        target.world_info_budget = diff_settings.context_percentage;
    }
    if (diff_settings.budget_cap !== undefined) {
        target.world_info_budget_cap = diff_settings.budget_cap;
    }
    if (diff_settings.min_activations !== undefined) {
        target.world_info_min_activations = diff_settings.min_activations;
    }
    if (diff_settings.max_depth !== undefined) {
        target.world_info_min_activations_depth_max = diff_settings.max_depth;
    }
    if (diff_settings.max_recursion_steps !== undefined) {
        target.world_info_max_recursion_steps = diff_settings.max_recursion_steps;
    }
    if (diff_settings.insertion_strategy !== undefined) {
        target.world_info_character_strategy = { evenly: 0, character_first: 1, global_first: 2 }[diff_settings.insertion_strategy];
    }
    if (diff_settings.include_names !== undefined) {
        target.world_info_include_names = diff_settings.include_names;
    }
    if (diff_settings.recursive !== undefined) {
        target.world_info_recursive = diff_settings.recursive;
    }
    if (diff_settings.case_sensitive !== undefined) {
        target.world_info_case_sensitive = diff_settings.case_sensitive;
    }
    if (diff_settings.match_whole_words !== undefined) {
        target.world_info_match_whole_words = diff_settings.match_whole_words;
    }
    if (diff_settings.use_group_scoring !== undefined) {
        target.world_info_use_group_scoring = diff_settings.use_group_scoring;
    }
    if (diff_settings.overflow_alert !== undefined) {
        target.world_info_overflow_alert = diff_settings.overflow_alert;
    }
    refreshCardHost();
    host.context.saveSettingsDebounced();
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

const KNOWN_RAW_WORLDBOOK_KEYS = new Set([
    'uid',
    'displayIndex',
    'comment',
    'disable',
    'constant',
    'vectorized',
    'selective',
    'position',
    'role',
    'depth',
    'order',
    'probability',
    'useProbability',
    'key',
    'keysecondary',
    'selectiveLogic',
    'scanDepth',
    'caseSensitive',
    'matchWholeWords',
    'useGroupScoring',
    'automationId',
    'excludeRecursion',
    'preventRecursion',
    'delayUntilRecursion',
    'content',
    'group',
    'groupOverride',
    'groupWeight',
    'sticky',
    'cooldown',
    'delay',
    ...Object.keys(_default_implicit_keys),
]);

function pickUnknownRawFields(entry) {
    const out = {};
    for (const [k, v] of Object.entries(entry || {})) {
        if (!KNOWN_RAW_WORLDBOOK_KEYS.has(k)) {
            out[k] = v;
        }
    }
    return out;
}

function toLorebookEntry(entry) {
    return {
        ...pickUnknownRawFields(entry),
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
    result = result.merge(_.pick(entry, Object.keys(_default_implicit_keys))).merge(pickUnknownRawFields(entry));
    return result.value();
}
export async function getWorldbook(worldbook_name) {
    if (!getWorldbookNames().includes(worldbook_name)) {
        throw Error(`未能找到世界书 '${worldbook_name}'`);
    }
    const original_worldbook_entries = await loadWorldInfo(worldbook_name).then(data => data ?? {});
    return klona(_(original_worldbook_entries.entries).values().sortBy('displayIndex').map(toWorldbookEntry).value());
}

// 原Helper的文档操作，保存/选择端口替换原生世界书编辑器和DOM点击。
async function commitWorldbookRaw(name, converted, raw) {
    const { client, context } = getCardHost();
    const next = { ...raw, entries: Object.fromEntries(converted.map(entry => [entry.uid, { ...raw?.entries?.[entry.uid], ...entry }])) };
    const changes = raw === undefined ? [{path:[],before:{exists:false},after:{exists:true,value:next}}] : documentChanges(raw, raw, next);
    await client.post('/api/worldinfo/edit', {name,vc_changes:changes});
    if (!world_names.includes(name)) world_names.push(name);
    client.documents.captureWorldbook(name,next);
    await context.eventSource.emit(context.eventTypes.WORLDINFO_UPDATED,name,next);
    return next;
}
async function writeWorldbook(name, entries, raw) {
    const converted = handleWorldbookEntriesCollision(entries).map(fromWorldbookEntry);
    return commitWorldbookRaw(name, converted, raw);
}
export async function createWorldbook(name, entries = []) {
    if (world_names.includes(name)) return false;
    await writeWorldbook(name, entries, undefined); return true;
}
export async function createOrReplaceWorldbook(name, entries = [], _options = {}) {
    const existing = world_names.includes(name);
    const raw = existing ? await loadWorldInfo(name) : undefined;
    await writeWorldbook(name,entries,raw); return !existing;
}
export async function replaceWorldbook(name, entries, options) {
    if (!world_names.includes(name)) throw new Error(`未能找到世界书 '${name}'`);
    await createOrReplaceWorldbook(name,entries,options);
}
export async function updateWorldbookWith(name, updater, _options) {
    if (!world_names.includes(name)) throw new Error(`未能找到世界书 '${name}'`);
    const raw = await loadWorldInfo(name);
    const current = klona(_(raw.entries).values().sortBy('displayIndex').map(toWorldbookEntry).value());
    const next = await updater(current);
    const saved = await writeWorldbook(name,next,raw);
    return klona(_(saved.entries).values().sortBy('displayIndex').map(toWorldbookEntry).value());
}
export async function createWorldbookEntries(name, entries, options) {
    let start;
    const worldbook = await updateWorldbookWith(name, data => { start=data.length;return [...data,...entries]; },options);
    return {worldbook,new_entries:worldbook.slice(start)};
}
export async function deleteWorldbookEntries(name,predicate,options) {
    let deleted_entries=[];
    const worldbook=await updateWorldbookWith(name,data=>{deleted_entries=_.remove(data,predicate);return data;},options);
    return {worldbook,deleted_entries};
}
export async function rebindGlobalWorldbooks(names) {
    const {settings,context}=getCardHost();
    settings.world_info.globalSelect=klona(names);refreshCardHost();
    context.saveSettingsDebounced();
}
export async function rebindCharWorldbooks(name, books) {
    if (name !== 'current') throw new Error('目前不支持对非当前角色卡调用 bindCharWorldbooks');
    const {client,context}=getCardHost(), card=RawCharacter.find();
    if (!card) throw new Error('未打开任何角色卡');
    const missing=[books.primary,...(books.additional || [])].filter(Boolean).filter(book=>!world_names.includes(book));
    if (missing.length) throw new Error('绑定的世界书不存在');
    if (books.primary !== undefined) {
        await client.post('/api/characters/merge-attributes',{avatar:card.avatar,data:{extensions:{world:books.primary || ''}}});
        card.data.extensions.world=books.primary || '';
    }
    if (books.additional !== undefined) {
        const filename=card.avatar.replace(/\.[^.]+$/,''),rows=world_info.charLore ||= [],index=rows.findIndex(row=>row.name===filename);
        if (index < 0 && books.additional.length) rows.push({name:filename,extraBooks:klona(books.additional)});
        else if(index >= 0) { if(books.additional.length)rows[index].extraBooks=klona(books.additional);else rows.splice(index,1); }
        context.saveSettingsDebounced();
    }
}
export async function rebindChatWorldbook(name, book) {
    if (name !== 'current' || !getCurrentChatId()) throw new Error('未打开当前聊天');
    if (book !== null && !world_names.includes(book)) throw new Error('绑定的世界书不存在');
    if(book === null) delete chat_metadata[METADATA_KEY];else chat_metadata[METADATA_KEY]=book;
    await getCardHost().context.saveMetadata();
}
export async function getOrCreateChatWorldbook(name, book) {
    if(name !== 'current') throw new Error('目前不支持非当前聊天');
    const existing=getChatWorldbookName(name);if(existing)return existing;
    const next=book || `Chat Book ${getCurrentChatId()}`.replace(/[^a-z0-9]/gi,'_').replace(/_{2,}/g,'_').substring(0,64);
    if(!await createWorldbook(next))throw new Error('同名世界书已存在');
    await rebindChatWorldbook(name,next);return next;
}
export async function deleteWorldbook(name) {
    if(!world_names.includes(name))return false;
    const {client,context,settings}=getCardHost();
    await client.post('/api/worldinfo/delete',{name});world_names.splice(world_names.indexOf(name),1);
    settings.world_info.globalSelect=settings.world_info.globalSelect.filter(book=>book!==name);
    const card=RawCharacter.find();
    if(card?.data.extensions.world===name)await rebindCharWorldbooks('current',{primary:null});
    if(settings.power_user.persona_description_lorebook===name){settings.power_user.persona_description_lorebook='';const descriptor=settings.power_user.persona_descriptions[context.userAvatar];if(descriptor)descriptor.lorebook='';}
    refreshCardHost();context.saveSettingsDebounced();return true;
}
export const getLorebooks=getWorldbookNames, setChatLorebook=book=>rebindChatWorldbook('current',book), getOrCreateChatLorebook=book=>getOrCreateChatWorldbook('current',book);
export const setCurrentCharLorebooks=books=>rebindCharWorldbooks('current',books);
export const createLorebook = (lorebook) => createWorldbook(lorebook);
export const deleteLorebook = (lorebook) => deleteWorldbook(lorebook);

const default_original_lorebook_entry = {
    key: [],
    keysecondary: [],
    comment: '',
    content: '',
    constant: false,
    vectorized: false,
    selective: true,
    selectiveLogic: 0,
    addMemo: true,
    order: 100,
    position: 0,
    disable: false,
    excludeRecursion: false,
    preventRecursion: false,
    matchPersonaDescription: false,
    matchCharacterDescription: false,
    matchCharacterPersonality: false,
    matchCharacterDepthPrompt: false,
    matchScenario: false,
    matchCreatorNotes: false,
    delayUntilRecursion: 0,
    probability: 100,
    useProbability: true,
    depth: 4,
    group: '',
    groupOverride: false,
    groupWeight: 100,
    scanDepth: null,
    caseSensitive: null,
    matchWholeWords: null,
    useGroupScoring: null,
    automationId: '',
    role: 0,
    sticky: null,
    cooldown: null,
    delay: null,
};

function fromPartialLorebookEntry(entry) {
    const transformers = {
        uid: value => ({ uid: value }),
        display_index: value => ({ displayIndex: value }),
        comment: value => ({ comment: value }),
        enabled: value => ({ disable: !value }),
        type: value => ({
            constant: value === 'constant',
            vectorized: value === 'vectorized',
            selective: value === 'selective',
        }),
        position: value => ({
            position: {
                before_character_definition: 0,
                after_character_definition: 1,
                before_example_messages: 5,
                after_example_messages: 6,
                before_author_note: 2,
                after_author_note: 3,
                at_depth_as_system: 4,
                at_depth_as_user: 4,
                at_depth_as_assistant: 4,
            }[value],
            role: _.get(
                {
                    at_depth_as_system: 0,
                    at_depth_as_user: 1,
                    at_depth_as_assistant: 2,
                },
                value,
                null,
            ),
        }),
        depth: value => ({ depth: value === null ? 4 : value }),
        order: value => ({ order: value }),
        probability: value => ({ probability: value }),
        key: value => (entry.keys !== undefined ? {} : { key: value }),
        keys: value => ({ key: value }),
        logic: value => ({
            selectiveLogic: {
                and_any: 0,
                not_all: 1,
                not_any: 2,
                and_all: 3,
            }[value],
        }),
        filter: value => (entry.filters !== undefined ? {} : { keysecondary: value }),
        filters: value => ({ keysecondary: value }),
        scan_depth: value => ({ scanDepth: value === 'same_as_global' ? null : value }),
        case_sensitive: value => ({ caseSensitive: value === 'same_as_global' ? null : value }),
        match_whole_words: value => ({ matchWholeWords: value === 'same_as_global' ? null : value }),
        use_group_scoring: value => ({ useGroupScoring: value === 'same_as_global' ? null : value }),
        automation_id: value => ({ automationId: value === null ? '' : value }),
        exclude_recursion: value => ({ excludeRecursion: value }),
        prevent_recursion: value => ({ preventRecursion: value }),
        delay_until_recursion: value => ({ delayUntilRecursion: value }),
        content: value => ({ content: value }),
        group: value => ({ group: value }),
        group_prioritized: value => ({ groupOverride: value }),
        group_weight: value => ({ groupWeight: value }),
        sticky: value => ({ sticky: value === null ? 0 : value }),
        cooldown: value => ({ cooldown: value === null ? 0 : value }),
        delay: value => ({ delay: value === null ? 0 : value }),
    };
    return _.merge(
        {},
        default_original_lorebook_entry,
        ...Object.entries(entry)
            .filter(([, value]) => value !== undefined)
            .map(([key, value]) => (transformers[key] ? transformers[key](value) : { [key]: value })),
    );
}

function handleLorebookEntriesCollision(entries) {
    const MAX_UID = 1_000_000;
    const uid_set = new Set();
    const handle_uid_collision = index => {
        if (index === undefined) {
            index = _.random(0, MAX_UID - 1);
        }
        let i = 1;
        while (true) {
            if (!uid_set.has(index)) {
                uid_set.add(index);
                return index;
            }
            index = (index + i * i) % MAX_UID;
            ++i;
        }
    };
    let max_display_index = _.max(entries.map(entry => entry.display_index ?? -1)) ?? -1;
    return entries.map(entry => ({
        ...entry,
        uid: handle_uid_collision(entry.uid),
        display_index: entry.display_index ?? ++max_display_index,
    }));
}

export async function replaceLorebookEntries(lorebook, entries) {
    if (!world_names.includes(lorebook)) {
        throw Error(`未能找到世界书 '${lorebook}'`);
    }
    const raw = await loadWorldInfo(lorebook);
    const converted = handleLorebookEntriesCollision(entries).map(fromPartialLorebookEntry);
    await commitWorldbookRaw(lorebook, converted, raw);
}

export async function updateLorebookEntriesWith(lorebook, updater) {
    await replaceLorebookEntries(lorebook, await updater(await getLorebookEntries(lorebook)));
    return getLorebookEntries(lorebook);
}

export async function setLorebookEntries(lorebook, entries) {
    return await updateLorebookEntriesWith(lorebook, data => {
        for (const entry_to_set of entries) {
            const data_entry = data.find(entry => entry.uid === entry_to_set.uid);
            if (data_entry) {
                _.merge(data_entry, entry_to_set);
            }
        }
        return data;
    });
}

export async function createLorebookEntries(lorebook, entries) {
    const MAX_UID = 1_000_000;
    const new_uids = [];
    const updated_entries = await updateLorebookEntriesWith(lorebook, data => {
        const uid_set = new Set(data.map(entry => entry.uid));
        const get_free_uid = () => {
            for (let i = 0; i < MAX_UID; ++i) {
                if (!uid_set.has(i)) {
                    uid_set.add(i);
                    new_uids.push(i);
                    return i;
                }
            }
            throw Error(`无法找到可用的世界书条目 uid`);
        };
        const next_entries = entries.map(entry => ({ ...entry, uid: get_free_uid() }));
        return [...data, ...next_entries];
    });
    return { entries: updated_entries, new_uids };
}

export async function deleteLorebookEntries(lorebook, uids) {
    let deleted = false;
    const updated_entries = await updateLorebookEntriesWith(lorebook, data => {
        const removed_data = _.remove(data, entry => uids.includes(entry.uid));
        deleted = removed_data.length > 0;
        return data;
    });
    return { entries: updated_entries, delete_occurred: deleted };
}

export async function createLorebookEntry(lorebook, field_values) {
    return (await createLorebookEntries(lorebook, [field_values])).new_uids[0];
}

export async function deleteLorebookEntry(lorebook, uid) {
    return (await deleteLorebookEntries(lorebook, [uid])).delete_occurred;
}

const KNOWN_WORLDBOOK_ENTRY_KEYS = new Set([
    'uid', 'name', 'enabled', 'strategy', 'position', 'content', 'probability', 'recursion', 'effect', 'extra',
    ...Object.keys(_default_implicit_keys),
]);

// Locked Helper worldbook.ts: original inverse conversion and UID collision algorithm.
function fromWorldbookEntry(entry, display_index) {
    const unknownFields = {};
    for (const [k, v] of Object.entries(entry || {})) {
        if (!KNOWN_WORLDBOOK_ENTRY_KEYS.has(k)) {
            unknownFields[k] = v;
        }
    }
    let result = _({})
        .set('uid', entry.uid)
        .set('displayIndex', display_index)
        .set('comment', entry.name ?? '')
        .set('disable', !(entry.enabled ?? true))
        .set('constant', entry?.strategy?.type ? entry?.strategy?.type === 'constant' : true)
        .set('selective', entry?.strategy?.type === 'selective')
        .set('key', entry?.strategy?.keys?.map(_.toString) ?? [])
        .set('selectiveLogic', {
        and_any: 0,
        not_all: 1,
        not_any: 2,
        and_all: 3,
    }[entry?.strategy?.keys_secondary?.logic ?? 'and_any'])
        .set('keysecondary', entry?.strategy?.keys_secondary?.keys?.map(_.toString) ?? [])
        .set('scanDepth', entry?.strategy?.scan_depth === 'same_as_global' ? null : (entry?.strategy?.scan_depth ?? null))
        .set('vectorized', entry?.strategy?.type === 'vectorized')
        .set('position', {
        before_character_definition: 0,
        after_character_definition: 1,
        before_example_messages: 5,
        after_example_messages: 6,
        before_author_note: 2,
        after_author_note: 3,
        at_depth: 4,
        outlet: 7,
    }[entry?.position?.type ?? 'at_depth'])
        .set('role', { system: 0, user: 1, assistant: 2 }[entry?.position?.role ?? 'system'])
        .set('depth', entry?.position?.depth ?? 4)
        .set('order', entry?.position?.order ?? 100)
        .set('content', entry.content ?? '')
        .set('useProbability', true)
        .set('probability', entry.probability ?? 100)
        .set('excludeRecursion', entry.recursion?.prevent_incoming ?? false)
        .set('preventRecursion', entry.recursion?.prevent_outgoing ?? false)
        .set('delayUntilRecursion', entry.recursion?.delay_until ?? false)
        .set('sticky', entry.effect?.sticky ?? null)
        .set('cooldown', entry.effect?.cooldown ?? null)
        .set('delay', entry.effect?.delay ?? null);
    if (entry.extra) {
        result = result.set('extra', entry.extra);
    }
    result = result.merge(_default_implicit_keys).merge(_.pick(entry, Object.keys(_default_implicit_keys))).merge(unknownFields);
    return result.value();
}
function handleWorldbookEntriesCollision(entries) {
    const MAX_UID = 1_000_000;
    const uid_set = new Set();
    const handle_uid_collision = (index) => {
        if (index === undefined) {
            index = _.random(0, MAX_UID - 1);
        }
        let i = 1;
        while (true) {
            if (!uid_set.has(index)) {
                uid_set.add(index);
                return index;
            }
            index = (index + i * i) % MAX_UID;
            ++i;
        }
    };
    return entries.map(entry => ({
        ...entry,
        uid: handle_uid_collision(entry.uid),
    }));
}
