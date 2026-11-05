// PolyForm-Noncommercial-1.0.0. JS-Slash-Runner 0af421068 / src/function/worldbook.ts + lorebook.ts + lorebook_entry.ts
import { getCurrentChatId, chat_metadata } from '../engine/ports.js';
import { klona } from './klona.js';
import {
    RawCharacter,
    world_info,
    world_names,
    loadWorldInfo,
    METADATA_KEY,
    getCardHost,
    refreshCardHost,
} from './ejs-host.js';
import { documentChanges } from '../../../settings-documents.js';
import {
    getLorebookSettings,
    getCharLorebooks,
    getCurrentCharPrimaryLorebook,
    getChatLorebook,
} from '../../locked-source/helper/function/lorebook.js';
import {
    getWorldbookNames,
    getGlobalWorldbookNames,
    getCharWorldbookNames,
    getChatWorldbookName,
    _default_implicit_keys,
    toWorldbookEntry as toLockedWorldbookEntry,
    fromWorldbookEntry as fromLockedWorldbookEntry,
    handleWorldbookEntriesCollision,
} from '../../locked-source/helper/function/worldbook.js';
import {
    default_original_lorebook_entry,
    toLorebookEntry as toLockedLorebookEntry,
    fromPartialLorebookEntry as fromLockedPartialLorebookEntry,
    MAX_UID,
    handleLorebookEntriesCollision,
} from '../../locked-source/helper/function/lorebook_entry.js';

export {
    getLorebookSettings,
    getCharLorebooks,
    getCurrentCharPrimaryLorebook,
    getChatLorebook,
    getWorldbookNames,
    getGlobalWorldbookNames,
    getCharWorldbookNames,
    getChatWorldbookName,
};

const KNOWN_RAW_WORLDBOOK_KEYS = new Set([
    'uid',
    'displayIndex',
    'extra',
    ...Object.keys(default_original_lorebook_entry),
    ...Object.keys(_default_implicit_keys),
]);

const KNOWN_LOREBOOK_ENTRY_KEYS = new Set(
    Object.keys(toLockedLorebookEntry({ uid: 0, displayIndex: 0, ...default_original_lorebook_entry })),
);

const KNOWN_WORLDBOOK_ENTRY_KEYS = new Set([
    'uid',
    'name',
    'enabled',
    'strategy',
    'position',
    'content',
    'probability',
    'recursion',
    'effect',
    'extra',
    ...Object.keys(_default_implicit_keys),
]);

function pickUnknown(entry, knownKeys) {
    const out = {};
    for (const [k, v] of Object.entries(entry || {})) {
        if (!knownKeys.has(k)) {
            out[k] = v;
        }
    }
    return out;
}

function toLorebookEntry(entry) {
    return {
        ...pickUnknown(entry, KNOWN_RAW_WORLDBOOK_KEYS),
        ...toLockedLorebookEntry(entry),
    };
}

function fromPartialLorebookEntry(entry) {
    const normalized = {
        ...entry,
        ...(entry?.keys === undefined && entry?.key !== undefined ? { keys: entry.key } : {}),
        ...(entry?.filters === undefined && entry?.filter !== undefined ? { filters: entry.filter } : {}),
    };
    return {
        ...fromLockedPartialLorebookEntry(normalized),
        ...(entry?.type !== undefined ? { selective: entry.type === 'selective' } : {}),
        ...pickUnknown(entry, KNOWN_LOREBOOK_ENTRY_KEYS),
    };
}

function toWorldbookEntry(entry) {
    return {
        ...pickUnknown(entry, KNOWN_RAW_WORLDBOOK_KEYS),
        ...toLockedWorldbookEntry(entry),
    };
}

function fromWorldbookEntry(entry, display_index) {
    return {
        ...fromLockedWorldbookEntry(entry, display_index),
        ...pickUnknown(entry, KNOWN_WORLDBOOK_ENTRY_KEYS),
    };
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

export async function getLorebookEntries(lorebook, { filter = 'none' } = {}) {
    if (!world_names.includes(lorebook)) {
        throw Error(`未能找到世界书 '${lorebook}'`);
    }
    const data = await loadWorldInfo(lorebook);
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

export async function getWorldbook(worldbook_name) {
    if (!getWorldbookNames().includes(worldbook_name)) {
        throw Error(`未能找到世界书 '${worldbook_name}'`);
    }
    const original_worldbook_entries = await loadWorldInfo(worldbook_name).then(data => data ?? {});
    return klona(_(original_worldbook_entries.entries).values().sortBy('displayIndex').map(toWorldbookEntry).value());
}

// 原Helper的文档操作，保存/选择端口替换原生世界书编辑器和DOM点击。
async function commitWorldbookRaw(name, converted, raw, before = raw) {
    const { client, context } = getCardHost();
    const next = { ...raw, entries: Object.fromEntries(converted.map(entry => [entry.uid, { ...raw?.entries?.[entry.uid], ...entry }])) };
    const changes = raw === undefined ? [{ path: [], before: { exists: false }, after: { exists: true, value: next } }] : documentChanges(raw, before, next);
    const response = await client.post('/api/worldinfo/edit', { name, vc_changes: changes });
    if (response && response.ok === false) {
        const body = await response.clone?.().json?.().catch(() => null);
        const error = new Error(response.status === 409 ? '配置已在另一处更新，你的修改尚未保存。' : '配置没有保存，请重试。');
        error.status = response.status; error.code = body?.code; error.details = body?.details ?? body;
        throw error;
    }
    if (!world_names.includes(name)) world_names.push(name);
    const authoritative = (await loadWorldInfo(name)) ?? next;
    client.documents.captureWorldbook(name, authoritative);
    await context.eventSource.emit(context.eventTypes.WORLDINFO_UPDATED, name, authoritative);
    return authoritative;
}

async function writeWorldbook(name, entries, raw, before = raw) {
    const converted = handleWorldbookEntriesCollision(entries).map(fromWorldbookEntry);
    return commitWorldbookRaw(name, converted, raw, before);
}

export async function createWorldbook(name, entries = []) {
    if (world_names.includes(name)) return false;
    await writeWorldbook(name, entries, undefined);
    return true;
}

export async function createOrReplaceWorldbook(name, entries = [], _options = {}) {
    const existing = world_names.includes(name);
    const raw = existing ? await loadWorldInfo(name) : undefined;
    await writeWorldbook(name, entries, raw);
    return !existing;
}

export async function replaceWorldbook(name, entries, options) {
    if (!world_names.includes(name)) throw new Error(`未能找到世界书 '${name}'`);
    await createOrReplaceWorldbook(name, entries, options);
}

export async function updateWorldbookWith(name, updater, _options) {
    if (!world_names.includes(name)) throw new Error(`未能找到世界书 '${name}'`);
    const raw = await loadWorldInfo(name);
    const current = klona(_(raw.entries).values().sortBy('displayIndex').map(toWorldbookEntry).value());
    const beforeConverted = handleWorldbookEntriesCollision(klona(current)).map(fromWorldbookEntry);
    const before = { ...raw, entries: Object.fromEntries(beforeConverted.map(entry => [entry.uid, { ...raw?.entries?.[entry.uid], ...entry }])) };
    const next = await updater(current);
    const saved = await writeWorldbook(name, next, raw, before);
    return klona(_(saved.entries).values().sortBy('displayIndex').map(toWorldbookEntry).value());
}

export async function createWorldbookEntries(name, entries, options) {
    let start;
    const worldbook = await updateWorldbookWith(name, data => { start = data.length; return [...data, ...entries]; }, options);
    return { worldbook, new_entries: worldbook.slice(start) };
}

export async function deleteWorldbookEntries(name, predicate, options) {
    let deleted_entries = [];
    const worldbook = await updateWorldbookWith(name, data => { deleted_entries = _.remove(data, predicate); return data; }, options);
    return { worldbook, deleted_entries };
}

export async function rebindGlobalWorldbooks(names) {
    const { settings, context } = getCardHost();
    settings.world_info.globalSelect = klona(names);
    refreshCardHost();
    context.saveSettingsDebounced();
}

export async function rebindCharWorldbooks(name, books) {
    if (name !== 'current') throw new Error('目前不支持对非当前角色卡调用 bindCharWorldbooks');
    const { client, context } = getCardHost(), card = RawCharacter.find();
    if (!card) throw new Error('未打开任何角色卡');
    const missing = [books.primary, ...(books.additional || [])].filter(Boolean).filter(book => !world_names.includes(book));
    if (missing.length) throw new Error('绑定的世界书不存在');
    if (books.primary !== undefined) {
        await client.post('/api/characters/merge-attributes', { avatar: card.avatar, data: { extensions: { world: books.primary || '' } } });
        card.data.extensions.world = books.primary || '';
    }
    if (books.additional !== undefined) {
        const filename = card.avatar.replace(/\.[^.]+$/, ''), rows = world_info.charLore ||= [], index = rows.findIndex(row => row.name === filename);
        if (index < 0 && books.additional.length) rows.push({ name: filename, extraBooks: klona(books.additional) });
        else if (index >= 0) {
            if (books.additional.length) rows[index].extraBooks = klona(books.additional);
            else rows.splice(index, 1);
        }
        context.saveSettingsDebounced();
    }
}

export async function rebindChatWorldbook(name, book) {
    if (name !== 'current' || !getCurrentChatId()) throw new Error('未打开当前聊天');
    if (book !== null && !world_names.includes(book)) throw new Error('绑定的世界书不存在');
    if (book === null) delete chat_metadata[METADATA_KEY];
    else chat_metadata[METADATA_KEY] = book;
    await getCardHost().context.saveMetadata();
}

export async function getOrCreateChatWorldbook(name, book) {
    if (name !== 'current') throw new Error('目前不支持非当前聊天');
    const existing = getChatWorldbookName(name);
    if (existing) return existing;
    const expectedMetadata = chat_metadata;
    const expectedChatId = getCurrentChatId();
    const next = book || `Chat Book ${expectedChatId}`.replace(/[^a-z0-9]/gi, '_').replace(/_{2,}/g, '_').substring(0, 64);
    if (!await createWorldbook(next)) throw new Error('同名世界书已存在');
    if (chat_metadata !== expectedMetadata || getCurrentChatId() !== expectedChatId) throw Error('VC_STALE_SOURCE');
    await rebindChatWorldbook(name, next);
    return next;
}

export async function deleteWorldbook(name) {
    if (!world_names.includes(name)) return false;
    const { client, context, settings } = getCardHost();
    await client.post('/api/worldinfo/delete', { name });
    world_names.splice(world_names.indexOf(name), 1);
    settings.world_info.globalSelect = settings.world_info.globalSelect.filter(book => book !== name);
    const card = RawCharacter.find();
    if (card?.data.extensions.world === name) await rebindCharWorldbooks('current', { primary: null });
    if (settings.power_user.persona_description_lorebook === name) {
        settings.power_user.persona_description_lorebook = '';
        const descriptor = settings.power_user.persona_descriptions[context.userAvatar];
        if (descriptor) descriptor.lorebook = '';
    }
    refreshCardHost();
    context.saveSettingsDebounced();
    return true;
}

export const getLorebooks = getWorldbookNames;
export const setChatLorebook = book => rebindChatWorldbook('current', book);
export const getOrCreateChatLorebook = book => getOrCreateChatWorldbook('current', book);
export const setCurrentCharLorebooks = books => rebindCharWorldbooks('current', books);
export const createLorebook = lorebook => createWorldbook(lorebook);
export const deleteLorebook = lorebook => deleteWorldbook(lorebook);

export async function replaceLorebookEntries(lorebook, entries) {
    if (!world_names.includes(lorebook)) {
        throw Error(`未能找到世界书 '${lorebook}'`);
    }
    const raw = await loadWorldInfo(lorebook);
    const preservedKeys = [
        'useProbability',
        ...Object.keys(_default_implicit_keys),
    ];
    const converted = handleLorebookEntriesCollision(entries).map((entry, index) => {
        const next = fromPartialLorebookEntry(entry);
        const existing = entries[index]?.uid === entry.uid ? raw?.entries?.[entry.uid] : undefined;
        if (!existing) return next;
        for (const key of preservedKeys) {
            if (entry?.[key] === undefined && existing[key] !== undefined && !KNOWN_LOREBOOK_ENTRY_KEYS.has(key)) {
                next[key] = existing[key];
            }
        }
        return next;
    });
    await commitWorldbookRaw(lorebook, converted, raw);
}

export async function updateLorebookEntriesWith(lorebook, updater) {
    if (!world_names.includes(lorebook)) {
        throw Error(`未能找到世界书 '${lorebook}'`);
    }
    const raw = await loadWorldInfo(lorebook);
    const current = klona(_(raw.entries).values().map(toLorebookEntry).value());
    const beforeConverted = handleLorebookEntriesCollision(klona(current)).map(fromPartialLorebookEntry);
    const before = { ...raw, entries: Object.fromEntries(beforeConverted.map(entry => [entry.uid, { ...raw?.entries?.[entry.uid], ...entry }])) };
    const next = await updater(current);
    const converted = handleLorebookEntriesCollision(next).map(fromPartialLorebookEntry);
    const saved = await commitWorldbookRaw(lorebook, converted, raw, before);
    return klona(_(saved.entries).values().map(toLorebookEntry).value());
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
