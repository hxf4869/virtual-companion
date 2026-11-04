// PolyForm-Noncommercial-1.0.0. JS-Slash-Runner 0af42106 / src/function/persona.ts
import { power_user } from '../engine/ports.js';
import { getCardHost, user_avatar } from './ejs-host.js';
import { klona } from './klona.js';

const PERSONA_DESCRIPTION_POSITION_IN_PROMPT = 0;
const DEFAULT_DEPTH = 2;
const DEFAULT_ROLE = 0;

function getCurrentAvatarId() {
    return user_avatar || getCardHost()?.context?.userAvatar || getCardHost()?.settings?.user_avatar || '';
}

export function getPersonaNames() {
    return Object.values(power_user?.personas ?? {}).map(String);
}

export function getPersonaIds() {
    return Object.keys(power_user?.personas ?? {});
}

export function getCurrentPersonaName() {
    const avatar_id = getCurrentAvatarId();
    return power_user?.personas?.[avatar_id] ?? null;
}

export function getCurrentPersonaId() {
    return getCurrentAvatarId() || null;
}

function findPersonaIdsByName(name) {
    const lowered_name = String(name).toLowerCase();
    return Object.entries(power_user?.personas ?? {})
        .filter(([, persona_name]) => String(persona_name).toLowerCase() === lowered_name)
        .map(([avatar_id]) => avatar_id);
}

function findPersonaId(persona_id) {
    if (!persona_id || persona_id === 'current') {
        return getCurrentAvatarId() || null;
    }
    if (power_user?.personas?.[persona_id] !== undefined) {
        return persona_id;
    }
    const matches = findPersonaIdsByName(persona_id);
    return matches.length === 1 ? matches[0] : null;
}

function getDefaultDescriptor() {
    return {
        description: '',
        position: PERSONA_DESCRIPTION_POSITION_IN_PROMPT,
        depth: DEFAULT_DEPTH,
        role: DEFAULT_ROLE,
        lorebook: '',
        connections: [],
        title: '',
    };
}

function toPersona(avatar_id) {
    const descriptor = { ...getDefaultDescriptor(), ...(power_user?.persona_descriptions?.[avatar_id] ?? {}) };
    return {
        avatar_id,
        avatar: avatar_id,
        name: String(power_user?.personas?.[avatar_id] ?? ''),
        title: descriptor.title,
        description: descriptor.description,
        position: descriptor.position,
        depth: descriptor.depth,
        role: descriptor.role,
        lorebook: descriptor.lorebook,
        connections: klona(descriptor.connections ?? []),
        is_default: power_user?.default_persona === avatar_id,
    };
}

export function getPersonaAvatarPath(persona_id = 'current') {
    const avatar_id = findPersonaId(persona_id);
    return avatar_id ? `./User Avatars/${avatar_id}` : null;
}

export function getPersona(persona_id = 'current') {
    const avatar_id = findPersonaId(persona_id);
    if (!avatar_id) {
        throw Error(`persona '${persona_id}' 不存在或名称不唯一`);
    }
    return klona(toPersona(avatar_id));
}
