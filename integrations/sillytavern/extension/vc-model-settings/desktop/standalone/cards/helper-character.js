// PolyForm-Noncommercial-1.0.0. JS-Slash-Runner 0af421068 / src/function/character.ts + src/function/raw_character.ts
import { captureCardHistoryScope, findRawCharacterIndex, RawCharacter } from './ejs-host.js';
import { readChatHistories } from '../chat-history.js';
import { storedChatRecords } from '../chat-store.js';
import {
    getCharacterNames,
    getCharacterIds,
    getCurrentCharacterName,
    getCurrentCharacterId,
    getCharacter,
} from '../../locked-source/helper/function/character.js';
import {
    getSortedChatList,
    hasChatFileName,
    attachCharacterToChats,
    getCharData,
    getCharAvatarPath,
} from '../../locked-source/helper/function/raw_character.js';

export {
    RawCharacter,
    getCharacterNames,
    getCharacterIds,
    getCurrentCharacterName,
    getCurrentCharacterId,
    getCharacter,
    getCharData,
    getCharAvatarPath,
};

function authorityError(mode) {
    return Object.assign(new Error(mode === 'FROZEN' ? '正在迁移' : '聊天存储已变化，请重新加载。'),
        { status: 409, code: 'CHAT_AUTHORITY_CHANGED' });
}

async function readInScope(options, read) {
    const scope = captureCardHistoryScope(options);
    const { client } = scope;
    const storage = client.getChatStorage();
    if (storage.mode !== 'ST' && storage.mode !== 'GO') throw authorityError(storage.mode);
    const assertCurrent = () => {
        scope.assertCurrent();
        const current = client.getChatStorage();
        if (current.mode !== storage.mode || current.authorityEpoch !== storage.authorityEpoch) throw authorityError(current.mode);
    };
    try {
        return await read({ ...scope, storage, assertCurrent });
    } catch (error) {
        if (storage.mode === 'ST' && error?.code === 'CHAT_AUTHORITY_CHANGED') {
            scope.assertCurrent();
            await client.refreshChatStorage().catch(() => {});
        }
        throw error;
    } finally {
        assertCurrent();
    }
}

async function listCharacterChats(scope, avatar, characterRef) {
    const { client, storage, signal } = scope;
    if (storage.mode === 'ST') {
        const chats = await client.request('/api/characters/chats', { avatar_url: avatar }, { signal });
        if (!chats || (typeof chats === 'object' && 'error' in chats)) return undefined;
        return chats;
    }
    if (!characterRef) return [];
    const rows = await client.listStoredChats({ characterRef, signal });
    return rows.map(chat => ({
        file_name: chat.fileName || chat.chatId + '.jsonl',
        chatId: chat.chatId, fileAliases: chat.fileAliases || [], characterRef: chat.characterRef,
        title: chat.title,
        chat_items: chat.messageCount,
        last_mes: chat.updatedAt,
    }));
}

async function readBrief(scope, name) {
    const card = scope.context.characters[findRawCharacterIndex(scope.context, name || 'current')];
    if (!card) return null;
    const character = new RawCharacter(card);
    const chats = await listCharacterChats(scope, character.getAvatarId(), card.data?.extensions?.vc_character_ref);
    if (!chats || typeof chats !== 'object') return [];
    const summaries = scope.storage.mode === 'GO' ? chats : getSortedChatList(chats);
    return attachCharacterToChats(summaries, character);
}

async function readDetail(scope, data, isGroupChat) {
    const { context, client, storage, signal, assertCurrent } = scope;
    if (storage.mode === 'GO') {
        const list = Object.values(data ?? {}).filter(hasChatFileName);
        const listings = new Map();
        const scoped = await Promise.all(list.map(async item => {
            if (isGroupChat && !item.groupRef) {
                // Legacy explicit UUID remains an owner-scoped identifier. An
                // arbitrary group filename requires its stable group scope.
                const id = item.file_name.replace(/\.jsonl$/, '').toLowerCase();
                if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id)) throw new Error('聊天记录缺少有效标识。');
                return { id };
            }
            let characterRef;
            if (!isGroupChat) {
                let card = item.avatar_url
                    ? context.characters.find(card => card.avatar === item.avatar_url)
                    : context.characters[findRawCharacterIndex(context, item.ch_name || item.character_name || 'current')];
                if (!card && item.avatar_url) {
                    card = await client.request('/api/characters/get', { avatar_url: item.avatar_url, vc_resource_only: true }, { signal });
                    assertCurrent();
                }
                characterRef = card?.data?.extensions?.vc_character_ref;
                if (!characterRef) throw new Error('聊天记录缺少有效标识。');
            }
            const key = JSON.stringify([isGroupChat ? 'GROUP' : 'SINGLE', isGroupChat ? item.groupRef : characterRef]);
            if (!listings.has(key)) listings.set(key, client.listStoredChats({ ...(isGroupChat ? { kind: 'GROUP', groupRef: item.groupRef } : { characterRef }), signal }));
            const rows = await listings.get(key);
            assertCurrent();
            const name = item.file_name.endsWith('.jsonl') ? item.file_name : item.file_name + '.jsonl';
            const matches = rows.filter(row => (isGroupChat ? row.kind === 'GROUP' && row.groupRef === item.groupRef
                : row.kind === 'SINGLE' && row.characterRef === characterRef)
                && (row.fileName === name || row.fileAliases?.includes(name) || (!row.fileName && row.chatId + '.jsonl' === name))
                && (!item.chatId || row.chatId === item.chatId));
            if (matches.length !== 1) throw new Error('聊天记录缺少有效标识。');
            return { id: matches[0].chatId, characterRef, groupRef: item.groupRef };
        }));
        const ids = scoped.map(row => row.id);
        const snapshots = await readChatHistories(ids, {
            authorityEpoch: storage.authorityEpoch, signal,
            request: (...args) => {
                assertCurrent();
                return client.chatRequest(...args);
            },
        });
        const kind = isGroupChat ? 'GROUP' : 'SINGLE';
        return Object.fromEntries(snapshots.flatMap((snapshot, index) => snapshot.chat.kind === kind
            && (!scoped[index].characterRef || snapshot.chat.characterRef === scoped[index].characterRef)
            && (!scoped[index].groupRef || snapshot.chat.groupRef === scoped[index].groupRef)
            ? [[list[index].file_name, storedChatRecords(snapshot).slice(1)]]
            : []));
    }

    const result = {};
    for (const item of getSortedChatList(data)) {
        assertCurrent();
        const ch_name = item.ch_name ?? item.character_name ?? item.file_name.split(' - ')[0];
        const avatar_url = item.avatar_url || context.characters[findRawCharacterIndex(context, ch_name)]?.avatar || '';
        const records = isGroupChat
            ? await client.request('/api/chats/group/get', { id: item.file_name }, { signal })
            : await client.request('/api/chats/get', { ch_name, avatar_url, file_name: item.file_name.replace('.jsonl', '') }, { signal });
        if (Array.isArray(records)) result[item.file_name] = records.slice(isGroupChat ? 0 : 1);
    }
    return result;
}

export function getChatHistoryBrief(name = 'current', scope) {
    return readInScope(scope, readScope => readBrief(readScope, name));
}

export function getChatHistoryDetail(data = 'current', isGroupChat = false, scope) {
    return readInScope(scope, async readScope => {
        if (typeof data === 'string') {
            data = await readBrief(readScope, data);
            readScope.assertCurrent();
            if (!data) return null;
        }
        return readDetail(readScope, data, isGroupChat);
    });
}

export function readCharacterChats(data, isGroupChat, scope) {
    return readInScope(scope, async readScope => {
        if (typeof data !== 'string') return readDetail(readScope, data, isGroupChat);
        if (readScope.storage.mode === 'ST') return listCharacterChats(readScope, data);

        let card = readScope.context.characters.find(card => card.avatar === data);
        if (!card) {
            card = await readScope.client.request('/api/characters/get', { avatar_url: data, vc_resource_only: true }, { signal: readScope.signal });
            readScope.assertCurrent();
        }
        return listCharacterChats(readScope, data, card?.data?.extensions?.vc_character_ref);
    });
}
