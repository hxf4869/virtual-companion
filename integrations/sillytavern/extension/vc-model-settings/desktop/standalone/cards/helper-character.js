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
        file_name: chat.chatId + '.jsonl',
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
        const ids = list.map(({ file_name }) => {
            const id = file_name.replace(/\.jsonl$/, '').toLowerCase();
            if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id)) {
                throw new Error('聊天记录缺少有效标识。');
            }
            return id;
        });
        const snapshots = await readChatHistories(ids, {
            authorityEpoch: storage.authorityEpoch, signal,
            request: (...args) => {
                assertCurrent();
                return client.chatRequest(...args);
            },
        });
        const kind = isGroupChat ? 'GROUP' : 'SINGLE';
        return Object.fromEntries(snapshots.flatMap((snapshot, index) => snapshot.chat.kind === kind
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
