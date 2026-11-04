// AGPL-3.0-only. Locked Helper 0af421068e4, generate/types.ts runtime constants.
/**
 * 角色类型（复制自@sillytavern/script以避免依赖）
 */
export const extension_prompt_roles = {
    SYSTEM: 0,
    USER: 1,
    ASSISTANT: 2,
};
/**
 * 仅在显式要求返回 reasoning，或存在非空 tool_calls 时返回普通详情对象。
 * 否则保持原始字符串返回；对象只包含实际存在的元数据字段。
 */
export function createGenerateResult(content, details = {}, shouldReturnReasoning = false) {
    const metadata = {
        ...(details.reasoning ? { reasoning: details.reasoning } : {}),
        ...(details.reasoning_signature ? { reasoning_signature: details.reasoning_signature } : {}),
    };
    const toolCalls = details.tool_calls?.length ? { tool_calls: details.tool_calls } : {};
    if (!shouldReturnReasoning && !('tool_calls' in toolCalls)) {
        return content;
    }
    return { content, ...metadata, ...toolCalls };
}
/**
 * 默认内置提示词顺序
 */
export const placeholder_prompt_default_order = [
    'world_info_before',
    'persona_description',
    'char_description',
    'char_personality',
    'scenario',
    'world_info_after',
    'dialogue_examples',
    'chat_history',
    'user_input',
];
export const builtin_prompt_default_order = placeholder_prompt_default_order;
/**
 * 角色类型映射
 */
export const roleTypes = {
    system: extension_prompt_roles.SYSTEM,
    user: extension_prompt_roles.USER,
    assistant: extension_prompt_roles.ASSISTANT,
};
/**
 * 默认提示词顺序
 */
export const default_order = [
    'world_info_before',
    'persona_description',
    'char_description',
    'char_personality',
    'scenario',
    'world_info_after',
    'dialogue_examples',
    'chat_history',
    'user_input',
];
/**
 * 角色名称行为常量
 */
export const character_names_behavior = {
    NONE: -1,
    DEFAULT: 0,
    COMPLETION: 1,
    CONTENT: 2,
};
