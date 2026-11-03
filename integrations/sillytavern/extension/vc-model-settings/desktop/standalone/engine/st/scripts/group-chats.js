// AGPL-3.0-only. SillyTavern 7e8663cd9c184a550b37238218bdd32c6efc68e9 / scripts/group-chats.js
// 原计算模块；只适配显式状态、输入/首显消息与无正文诊断端口。
import { chat_metadata, characters, groups, selected_group, power_user, quietConsole as console } from '../../ports.js';
import { baseChatReplace, createLazyFields, depth_prompt_depth_default, depth_prompt_role_default } from '../script.js';
export const group_generation_mode = {
    SWAP: 0,
    APPEND: 1,
    APPEND_DISABLED: 2,
};

export function getGroupNames() {
    if (!selected_group) {
        return [];
    }
    const groupMembers = groups.find(x => x.id == selected_group)?.members;
    return Array.isArray(groupMembers)
        ? groupMembers.map(x => characters.find(y => y.avatar === x)?.name).filter(x => x)
        : [];
}

export function getGroupCharacterCardsLazy(groupId, characterId) {
    const group = groups.find(x => x.id === groupId);

    // If no group cards should be generated, return null so caller knows to fall back
    if (!group || !group?.generation_mode || !Array.isArray(group.members) || !group.members.length) {
        return null;
    }

    /**
     * Runs baseChatReplace on a text, with custom <FIELDNAME> replace
     * @param {string} value Value to replace
     * @param {string} fieldName Name of the field
     * @param {string} characterName Name of the character
     * @param {boolean} trim Whether to trim the value
     * @returns {string} Replaced text
     */
    function customTransform(value, fieldName, characterName, trim) {
        if (!value) return '';
        value = value.replace(/<FIELDNAME>/gi, fieldName);
        value = trim ? value.trim() : value;
        return baseChatReplace(value, null, characterName);
    }

    /**
     * Prepares text with prefix/suffix for a character field
     * @param {string} value Value to replace
     * @param {string} characterName Name of the character
     * @param {string} fieldName Name of the field
     * @param {function(string): string} [preprocess] Preprocess function
     * @returns {string} Prepared text
     */
    function replaceAndPrepareForJoin(value, characterName, fieldName, preprocess = null) {
        value = value?.trim() ?? '';
        if (!value) return '';
        if (typeof preprocess === 'function') {
            value = preprocess(value);
        }
        const prefix = customTransform(group.generation_mode_join_prefix, fieldName, characterName, false);
        const suffix = customTransform(group.generation_mode_join_suffix, fieldName, characterName, false);
        value = customTransform(value, fieldName, characterName, true);
        return `${prefix}${value}${suffix}`;
    }

    /**
     * Collects and joins field values from all group members
     * @param {string} fieldName Display name of the field
     * @param {function(Character): string} getter Function to get field value from character
     * @param {function(string): string} [preprocess] Optional preprocess function
     * @returns {string} Combined field values
     */
    function collectField(fieldName, getter, preprocess = null) {
        const values = [];
        for (const member of group.members) {
            const index = characters.findIndex(x => x.avatar === member);
            const character = characters[index];
            if (index === -1 || !character) continue;
            if (group.disabled_members.includes(member) && characterId !== index && group.generation_mode !== group_generation_mode.APPEND_DISABLED) {
                continue;
            }
            values.push(replaceAndPrepareForJoin(getter(character), character.name, fieldName, preprocess));
        }
        return values.filter(x => x.length).join('\n');
    }

    const scenarioOverride = String(chat_metadata.scenario || '');
    const mesExamplesOverride = String(chat_metadata.mes_example || '');

    return createLazyFields({
        description: () => collectField('Description', c => c.description),
        personality: () => collectField('Personality', c => c.personality),
        scenario: () => baseChatReplace(scenarioOverride?.trim()) || collectField('Scenario', c => c.scenario),
        mesExamples: () => baseChatReplace(mesExamplesOverride?.trim()) ||
            collectField('Example Messages', c => c.mes_example, x => !x.startsWith('<START>') ? `<START>\n${x}` : x),
    });
}

export function getGroupDepthPrompts(groupId, characterId) {
    if (!groupId) {
        return [];
    }

    console.debug('getGroupDepthPrompts entered for group: ', groupId);
    const group = groups.find(x => x.id === groupId);

    if (!group || !Array.isArray(group.members) || !group.members.length) {
        return [];
    }

    if (group.generation_mode === group_generation_mode.SWAP) {
        return [];
    }

    const depthPrompts = [];

    for (const member of group.members) {
        const index = characters.findIndex(x => x.avatar === member);
        const character = characters[index];

        if (index === -1 || !character) {
            console.debug(`Skipping missing member: ${member}`);
            continue;
        }

        if (group.disabled_members.includes(member) && characterId !== index) {
            console.debug(`Skipping disabled group member: ${member}`);
            continue;
        }

        const depthPromptText = baseChatReplace(character.data?.extensions?.depth_prompt?.prompt?.trim(), null, character.name) || '';
        const depthPromptDepth = character.data?.extensions?.depth_prompt?.depth ?? depth_prompt_depth_default;
        const depthPromptRole = character.data?.extensions?.depth_prompt?.role ?? depth_prompt_role_default;

        if (depthPromptText) {
            depthPrompts.push({ text: depthPromptText, depth: depthPromptDepth, role: depthPromptRole });
        }
    }

    return depthPrompts;
}
