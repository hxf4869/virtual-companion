// AGPL-3.0-only. Locked Helper 0af421068e4 generate/index.ts conversions with explicit preset/macro ports.
export function fromOverrides(overrides) {
    return {
        world_info_before: overrides.world_info_before,
        persona_description: overrides.persona_description,
        char_description: overrides.char_description,
        char_personality: overrides.char_personality,
        scenario: overrides.scenario,
        world_info_after: overrides.world_info_after,
        dialogue_examples: overrides.dialogue_examples,
        with_depth_entries: overrides.chat_history?.with_depth_entries,
        author_note: overrides.chat_history?.author_note,
        chat_history: overrides.chat_history?.prompts,
    };
}
export function fromGenerateConfig(config) {
    return {
        generation_id: config.generation_id,
        user_input: config.user_input,
        use_preset: true,
        image: config.image,
        stream: config.should_stream ?? false,
        bindToStopButton: !(config.should_silence ?? false),
        overrides: config.overrides !== undefined ? fromOverrides(config.overrides) : undefined,
        inject: config.injects,
        max_chat_history: typeof config.max_chat_history === 'number' ? config.max_chat_history : undefined,
        custom_api: config.custom_api,
        tools: config.tools,
        tool_choice: config.tool_choice,
        json_schema: config.json_schema,
        should_return_reasoning: config.should_return_reasoning,
    };
}
export function fromGenerateRawConfig(config) {
    return {
        generation_id: config.generation_id,
        user_input: config.user_input,
        use_preset: false,
        image: config.image,
        stream: config.should_stream ?? false,
        bindToStopButton: !(config.should_silence ?? false),
        max_chat_history: typeof config.max_chat_history === 'number' ? config.max_chat_history : undefined,
        overrides: config.overrides ? fromOverrides(config.overrides) : undefined,
        inject: config.injects,
        order: config.ordered_prompts,
        custom_api: config.custom_api,
        tools: config.tools,
        tool_choice: config.tool_choice,
        json_schema: config.json_schema,
        should_return_reasoning: config.should_return_reasoning,
    };
}
function isPresetPlaceholderPrompt(prompt) {
    return [
        'worldInfoBefore',
        'personaDescription',
        'charDescription',
        'charPersonality',
        'scenario',
        'worldInfoAfter',
        'dialogueExamples',
        'chatHistory',
    ].includes(prompt.id);
}
export function convertGenerateWithCustomPreset(config, getPreset, substitudeMacros) {
    function toOrderedPrompt(prompt) {
        if (isPresetPlaceholderPrompt(prompt)) {
            return _.snakeCase(prompt.id);
        }
        return {
            role: prompt.role,
            content: substitudeMacros(prompt.content),
        };
    }
    function toInChatPrompt(prompt) {
        // Assert (prompt.position.type === 'in_chat' && prompt.content is string)
        prompt.content = substitudeMacros(prompt.content);
        return {
            position: 'in_chat',
            depth: prompt.position.depth,
            role: prompt.role,
            content: substitudeMacros(prompt.content),
        };
    }
    const preset = getPreset(config.preset_name ?? 'in_use');
    const prompts = preset.prompts.filter(prompt => prompt.enabled);
    const [in_chat, ordered] = _.partition(prompts, prompt => prompt.position?.type === 'in_chat');
    const ordered_prompts = ordered
        .map(toOrderedPrompt)
        .filter(prompt => typeof prompt === 'string' || prompt.content.trim() !== '');
    const injects = _.concat(config.injects ?? [], _(in_chat)
        .sortBy(['position.depth', 'position.order'])
        .map(toInChatPrompt)
        .filter(prompt => prompt.content.trim() !== '')
        .value());
    const custom_api = { ...config.custom_api };
    const setValidly = (param, value, min = null, max = null) => {
        if (typeof value !== 'number') {
            return;
        }
        if (min !== null) {
            value = Math.max(min, value);
        }
        if (max !== null) {
            value = Math.min(max, value);
        }
        _.set(custom_api, param, value);
    };
    setValidly('max_tokens', preset.settings.max_completion_tokens);
    setValidly('temperature', preset.settings.temperature, 0, 2);
    setValidly('frequency_penalty', preset.settings.frequency_penalty, -2, 2);
    setValidly('presence_penalty', preset.settings.presence_penalty, -2, 2);
    setValidly('top_p', preset.settings.top_p, 0, 1);
    setValidly('top_k', preset.settings.top_k, 0, 100);
    return {
        ...config,
        ordered_prompts,
        injects,
        custom_api,
    };
}
