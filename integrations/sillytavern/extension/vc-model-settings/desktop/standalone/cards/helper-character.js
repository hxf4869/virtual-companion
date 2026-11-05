// PolyForm-Noncommercial-1.0.0. JS-Slash-Runner 0af421068 / src/function/character.ts + src/function/raw_character.ts
import { getCardHost, RawCharacter } from './ejs-host.js';
import {
    getCharacterNames,
    getCharacterIds,
    getCurrentCharacterName,
    getCurrentCharacterId,
    getCharacter,
} from '../../locked-source/helper/function/character.js';
import {
    getSortedChatList,
    attachCharacterToChats,
    getCharData,
    getCharAvatarPath,
    getChatHistoryDetail as lockedGetChatHistoryDetail,
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

export async function getChatHistoryBrief(name = 'current') {
    name = !name ? 'current' : name;
    const character = RawCharacter.find({ name });
    if (!character) {
        return null;
    }
    const index = RawCharacter.findIndex(character.getAvatarId());
    if (index === -1) {
        return null;
    }
    const host = getCardHost();
    const chats = await host.client.request('/api/characters/chats', { avatar_url: character.getAvatarId() });
    if (!chats || typeof chats !== 'object' || (!Array.isArray(chats) && 'error' in chats)) {
        return [];
    }
    return attachCharacterToChats(getSortedChatList(chats), character);
}

export async function getChatHistoryDetail(data = 'current', isGroupChat = false) {
    if (typeof data === 'string') {
        const brief = await getChatHistoryBrief(data);
        if (!brief) return null;
        return lockedGetChatHistoryDetail(brief, isGroupChat);
    }
    return lockedGetChatHistoryDetail(data, isGroupChat);
}
