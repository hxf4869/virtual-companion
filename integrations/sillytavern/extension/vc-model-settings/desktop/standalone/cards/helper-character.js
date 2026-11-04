// PolyForm-Noncommercial-1.0.0. JS-Slash-Runner 0af42106 / src/function/raw_character.ts, character.ts
import { characters, name2 } from '../engine/ports.js';
import { RawCharacter, getCardHost, getThumbnailUrl } from './ejs-host.js';
import { getCharWorldbookNames } from './helper-worldbook.js';
import { to_tavern_regex } from './helper-regex.js';
import { klona } from './klona.js';

export { RawCharacter };

export function getCharacterNames() {
    return (characters || []).map(character => character.name);
}

export function getCharacterIds() {
    return (characters || []).map(character => character.avatar);
}

export function getCurrentCharacterName() {
    return !name2 ? null : name2;
}

export function getCurrentCharacterId() {
    const current_character = RawCharacter.find({ name: 'current' });
    return current_character?.avatar ?? null;
}

export function getCharData(name = 'current') {
    try {
        name = !name ? 'current' : name;
        const characterData = RawCharacter.find({ name });
        if (!characterData) return null;
        return klona(characterData.getCardData());
    } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        throw Error(`获取${name ? ` '${name}' ` : '未知'}角色卡数据失败: ${error.message}`);
    }
}

export function getCharAvatarPath(name = 'current') {
    name = !name ? 'current' : name;
    const character = RawCharacter.find({ name });
    if (!character) {
        return null;
    }
    const avatarId = character.getAvatarId();
    const thumbnailPath = getThumbnailUrl('avatar', avatarId);
    const targetAvatarImg = thumbnailPath.includes('=')
        ? thumbnailPath.substring(thumbnailPath.lastIndexOf('=') + 1)
        : avatarId;
    return '/characters/' + targetAvatarImg;
}

function attachCharacterToChats(chats, character) {
    return (chats || []).map(chat => ({
        ...chat,
        ch_name: character.getCardData()?.name ?? character.name,
        avatar_url: character.getAvatarId(),
    }));
}

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
    const sorted = Object.values(chats)
        .filter(item => typeof item?.file_name === 'string' && item.file_name.length > 0)
        .sort((a, b) => a.file_name.localeCompare(b.file_name))
        .reverse();
    return attachCharacterToChats(sorted, character);
}

export async function getChatHistoryDetail(data = 'current', isGroupChat = false) {
    if (typeof data === 'string') {
        const brief = await getChatHistoryBrief(data);
        if (!brief) return null;
        return RawCharacter.getChatsFromFiles(brief, isGroupChat);
    }
    return RawCharacter.getChatsFromFiles(data, isGroupChat);
}

function toCharacter(character) {
    const data = character.data ?? {};
    const first_messages = [character.first_mes ?? data.first_mes ?? '', ...(data.alternate_greetings ?? [])];
    let extensions = klona(data.extensions ?? {});
    if (_.has(extensions, 'regex_scripts')) {
        _.set(extensions, 'regex_scripts', _.get(extensions, 'regex_scripts', []).map(to_tavern_regex));
    }
    if (_.has(extensions, 'tavern_helper')) {
        const tavern_helper = _.get(extensions, 'tavern_helper', {});
        _.set(
            extensions,
            'tavern_helper',
            Array.isArray(tavern_helper) ? Object.fromEntries(tavern_helper) : tavern_helper,
        );
    }
    extensions = _.omit(extensions, [
        'TavernHelper_scripts',
        'TavernHelper_characterScriptVariables',
        'fav',
        'talkativeness',
        'world',
        'depth_prompt',
        'pygmalion_id',
        'github_repo',
        'source_url',
        'chub',
        'risuai',
        'sd_character_prompt',
    ]);
    return {
        name: character.name ?? data.name ?? '',
        avatar: character.avatar ?? `${data.name}.png`,
        version: data.character_version ?? '',
        creator: data.creator ?? '',
        creator_notes: character.creatorcomment ?? data.creator_notes ?? '',
        description: character.description ?? data.description ?? '',
        first_messages,
        worldbook: getCharWorldbookNames(character.avatar ?? character.name).primary,
        extensions,
    };
}

export function getCharacter(character_name_or_id = 'current') {
    const index = RawCharacter.findIndex(character_name_or_id);
    if (index === -1) {
        throw Error(`角色卡 '${character_name_or_id}' 不存在`);
    }
    return klona(toCharacter(characters[index]));
}
