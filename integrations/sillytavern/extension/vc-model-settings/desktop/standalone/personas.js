// AGPL-3.0-only. 适配锁定ST personas.js 的聊天选择/描述规则，不加载原生人设控件。
import { persona_description_positions as positions } from './engine/st/constants.js';

export function createPersonaSelection({ client, context, settings, choose, onSelected }) {
    let loaded = '';
    context.name1 = settings.username || 'User';
    context.userAvatar = settings.user_avatar || '';
    const power = settings.power_user;
    async function select(avatar) {
        if (avatar === context.userAvatar) return;
        context.userAvatar = settings.user_avatar = avatar;
        context.settingsDirty = true;
        const name = power.personas[avatar];
        if (name) {
            context.name1 = settings.username = name || 'User';
            const descriptor = power.persona_descriptions[avatar] ||= { description: '', position: positions.IN_PROMPT,
                depth: 2, role: 0, lorebook: '', connections: [], title: '' };
            power.persona_description = descriptor.description ?? '';
            power.persona_description_position = descriptor.position ?? positions.IN_PROMPT;
            if (power.persona_description_position === positions.AFTER_CHAR) power.persona_description_position = positions.IN_PROMPT;
            power.persona_description_depth = descriptor.depth ?? 2;
            power.persona_description_role = descriptor.role ?? 0;
            power.persona_description_lorebook = descriptor.lorebook ?? '';
            if (power.persona_auto_lock && avatar !== context.chatMetadata.persona) {
                context.chatMetadata.persona = avatar; context.metadataDirty = true;
            }
        }
        await onSelected(avatar);
    }
    return {
        async load(key, { signal } = {}) {
            if (key === loaded) return;
            const avatars = await client.request('/api/avatars/get', {}, { signal });
            signal?.throwIfAborted();
            if (avatars.length && !avatars.includes(context.userAvatar)) await select(avatars[0]);
            const metadata = context.chatMetadata;
            let selected = metadata.persona || '';
            if (selected && !avatars.includes(selected)) {
                delete metadata.persona; context.metadataDirty = true; context.settingsDirty = true; selected = '';
            }
            if (!selected) {
                const target = context.groupId || context.characters[context.characterId]?.avatar;
                const connected = Object.entries(power.persona_descriptions)
                    .filter(([, descriptor]) => descriptor.connections?.some(connection => connection.id === target)).map(([avatar]) => avatar);
                if (connected.length === 1 || (connected.length > 1 && !power.persona_allow_multi_connections)) selected = connected[0];
                else if (connected.length > 1) selected = await choose(connected.map(avatar => ({ avatar, name: power.personas[avatar] || avatar })), { signal });
            }
            signal?.throwIfAborted();
            if (!selected) selected = power.default_persona || '';
            if (power.default_persona && !avatars.includes(power.default_persona)) {
                power.default_persona = null; context.settingsDirty = true;
            }
            if (selected && context.userAvatar !== selected) await select(selected);
            else if (selected && power.persona_auto_lock && !metadata.persona) {
                metadata.persona = context.userAvatar; context.metadataDirty = true;
            }
            loaded = key;
        },
    };
}
