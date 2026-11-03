// AGPL-3.0-only. Pure data copied from the locked SillyTavern / Helper / EJS defaults.
// Do not import ST defaults here: their imports initialize the original UI.
export const replyDefaults = {
    temp_openai: 1, freq_pen_openai: 0, pres_pen_openai: 0, top_p_openai: 1,
    top_k_openai: 0, min_p_openai: 0, top_a_openai: 0, repetition_penalty_openai: 1,
    stream_openai: false, openai_max_context: 4095, openai_max_tokens: 300,
    seed: -1, n: 1, reasoning_effort: 'auto', verbosity: 'auto', show_thoughts: true,
    continue_prefill: false, continue_postfix: ' ', assistant_prefill: '', assistant_impersonation: '',
    send_if_empty: '', squash_system_messages: false, media_inlining: true, inline_image_quality: 'auto',
    function_calling: false, tool_call_recurse_limit: 5, tool_reasoning_mode: 'disabled',
    enable_web_search: false, request_images: false, request_image_aspect_ratio: '', request_image_resolution: '',
    names_behavior: 0, custom_prompt_post_processing: '', extensions: {},
    impersonation_prompt: '[Write your next reply from the point of view of {{user}}, using the chat history so far as a guideline for the writing style of {{user}}. Don\'t write as {{char}} or system. Don\'t describe actions of {{char}}.]',
    new_chat_prompt: '[Start a new Chat]', new_group_chat_prompt: '[Start a new group chat. Group members: {{group}}]',
    new_example_chat_prompt: '[Example Chat]', continue_nudge_prompt: '[Continue your last message without repeating its original content.]',
    wi_format: '{0}', group_nudge_prompt: '[Write the next reply only as {{char}}.]', scenario_format: '{{scenario}}', personality_format: '{{personality}}',
    bias_preset_selected: 'Default (none)', bias_presets: { 'Default (none)': [], 'Anti-bond': [
        {id:'22154f79-dd98-41bc-8e34-87015d6a0eaf',text:' bond',value:-50},
        {id:'8ad2d5c4-d8ef-49e4-bc5e-13e7f4690e0f',text:' future',value:-50},
        {id:'52a4b280-0956-4940-ac52-4111f83e4046',text:' bonding',value:-50},
        {id:'e63037c7-c9d1-4724-ab2d-7756008b433b',text:' connection',value:-25},
    ] },
};
export const appearanceDefaults = { font_scale:1,chat_width:50,blur_strength:10,avatar_style:0,
    hideChatAvatars_enabled:false,timestamps_enabled:true,timestamp_model_icon:false,timer_enabled:true,
    mesIDDisplay_enabled:false,message_token_count_enabled:false,allow_name1_display:false,allow_name2_display:false,
    auto_scroll_chat_to_bottom:true,smooth_streaming:false,smooth_streaming_speed:50,smooth_streaming_no_think:false,reduced_motion:false,compact_input_area:true,
    confirm_message_delete:true,auto_save_msg_edits:false,auto_fix_generated_markdown:true,trim_spaces:true,
    enable_md_hotkeys:false,send_on_enter:0,custom_css:'',auto_continue:{enabled:false,allow_chat_completions:false,target_length:400},
    quick_continue:false,continue_on_send:false,custom_stopping_strings:'' };
export const formatDefaults = {
    context: { preset: 'Default', story_string: '{{#if system}}{{system}}\n{{/if}}{{#if description}}{{description}}\n{{/if}}{{#if personality}}{{char}}\'s personality: {{personality}}\n{{/if}}{{#if scenario}}Scenario: {{scenario}}\n{{/if}}{{#if persona}}{{persona}}\n{{/if}}', chat_start: '***', example_separator: '***', use_stop_strings: true, names_as_stop_strings: true, story_string_position: 0, story_string_role: 0, story_string_depth: 1 },
    instruct: { enabled: false, preset: 'Alpaca', input_sequence: '### Instruction:', input_suffix: '', output_sequence: '### Response:', output_suffix: '', system_sequence: '', system_suffix: '', last_system_sequence: '', first_input_sequence: '', first_output_sequence: '', last_input_sequence: '', last_output_sequence: '', story_string_prefix: '', story_string_suffix: '', stop_sequence: '', wrap: true, macro: true, names_behavior: 'force', activation_regex: '', bind_to_context: false, user_alignment_message: '', system_same_as_user: false, separator_sequence: '', sequences_as_stop_strings: true },
    sysprompt: { enabled: true, name: 'Neutral - Chat', content: 'Write {{char}}\'s next reply in a fictional chat between {{char}} and {{user}}.', post_history: '' },
    reasoning: { name: 'Think XML', auto_parse: false, add_to_prompts: false, auto_expand: false, show_hidden: false, prefix: '<think>', suffix: '</think>', separator: '\n', max_additions: 1 },
};
export const worldEntryDefaults = {
    key: [], keysecondary: [], comment: '', content: '', constant: false, vectorized: false,
    selective: true, selectiveLogic: 0, addMemo: false, order: 100, position: 0, disable: false,
    ignoreBudget: false, excludeRecursion: false, preventRecursion: false,
    matchPersonaDescription: false, matchCharacterDescription: false, matchCharacterPersonality: false,
    matchCharacterDepthPrompt: false, matchScenario: false, matchCreatorNotes: false,
    delayUntilRecursion: 0, probability: 100, useProbability: true, depth: 4, outletName: '',
    group: '', groupOverride: false, groupWeight: 100, scanDepth: null, caseSensitive: null,
    matchWholeWords: null, useGroupScoring: null, automationId: '', role: 0,
    sticky: null, cooldown: null, delay: null, triggers: [],
};
export const worldDefaults = { world_info: { globalSelect: [], charLore: [] }, world_info_depth: 2,
    world_info_min_activations: 0, world_info_min_activations_depth_max: 0, world_info_budget: 25,
    world_info_include_names: true, world_info_recursive: false, world_info_overflow_alert: false,
    world_info_case_sensitive: false, world_info_match_whole_words: false, world_info_character_strategy: 1,
    world_info_budget_cap: 0, world_info_use_group_scoring: false, world_info_max_recursion_steps: 0 };
export const personaDefaults = { description: '', position: 0, depth: 2, role: 0, lorebook: '', title: '', connections: [] };
export const ejsDefaults = { enabled: true, generate_enabled: true, generate_loader_enabled: true,
    render_enabled: true, render_loader_enabled: true, with_context_disabled: false, debug_enabled: false,
    autosave_enabled: false, preload_worldinfo_enabled: true, code_blocks_enabled: false,
    raw_message_evaluation_enabled: true, filter_message_enabled: true, cache_enabled: 0, cache_size: 64,
    cache_hasher: 'h32ToString', inject_loader_enabled: false, invert_enabled: true, depth_limit: -1,
    compile_workers: false, sandbox: false, code_editor: false, preload_only: true };
export const helperDefaults = {
    render: { enabled: true, collapse_code_block: 'frontend_only', allow_streaming: false, use_blob_url: false,
        use_cleanup_protector: false, optimize_hljs: true, depth: 0, depth_ignore_hidden: false },
    script: { enabled: { global: true, presets: [], characters: [] }, scripts: [] },
};

// Locked PromptManager defaults (pure data only).
export const chatCompletionDefaultPrompts = {
    'prompts': [
        {
            'name': 'Main Prompt',
            'system_prompt': true,
            'role': 'system',
            'content': 'Write {{char}}\'s next reply in a fictional chat between {{charIfNotGroup}} and {{user}}.',
            'identifier': 'main',
        },
        {
            'name': 'Auxiliary Prompt',
            'system_prompt': true,
            'role': 'system',
            'content': '',
            'identifier': 'nsfw',
        },
        {
            'identifier': 'dialogueExamples',
            'name': 'Chat Examples',
            'system_prompt': true,
            'marker': true,
        },
        {
            'name': 'Post-History Instructions',
            'system_prompt': true,
            'role': 'system',
            'content': '',
            'identifier': 'jailbreak',
        },
        {
            'identifier': 'chatHistory',
            'name': 'Chat History',
            'system_prompt': true,
            'marker': true,
        },
        {
            'identifier': 'worldInfoAfter',
            'name': 'World Info (after)',
            'system_prompt': true,
            'marker': true,
        },
        {
            'identifier': 'worldInfoBefore',
            'name': 'World Info (before)',
            'system_prompt': true,
            'marker': true,
        },
        {
            'identifier': 'enhanceDefinitions',
            'role': 'system',
            'name': 'Enhance Definitions',
            'content': 'If you have more knowledge of {{char}}, add to the character\'s lore and personality to enhance them but keep the Character Sheet\'s definitions absolute.',
            'system_prompt': true,
            'marker': false,
        },
        {
            'identifier': 'charDescription',
            'name': 'Char Description',
            'system_prompt': true,
            'marker': true,
        },
        {
            'identifier': 'charPersonality',
            'name': 'Char Personality',
            'system_prompt': true,
            'marker': true,
        },
        {
            'identifier': 'scenario',
            'name': 'Scenario',
            'system_prompt': true,
            'marker': true,
        },
        {
            'identifier': 'personaDescription',
            'name': 'Persona Description',
            'system_prompt': true,
            'marker': true,
        },
    ],
};

export const promptManagerDefaultPromptOrder = [
    {
        'identifier': 'main',
        'enabled': true,
    },
    {
        'identifier': 'worldInfoBefore',
        'enabled': true,
    },
    {
        'identifier': 'personaDescription',
        'enabled': true,
    },
    {
        'identifier': 'charDescription',
        'enabled': true,
    },
    {
        'identifier': 'charPersonality',
        'enabled': true,
    },
    {
        'identifier': 'scenario',
        'enabled': true,
    },
    {
        'identifier': 'enhanceDefinitions',
        'enabled': false,
    },
    {
        'identifier': 'nsfw',
        'enabled': true,
    },
    {
        'identifier': 'worldInfoAfter',
        'enabled': true,
    },
    {
        'identifier': 'dialogueExamples',
        'enabled': true,
    },
    {
        'identifier': 'chatHistory',
        'enabled': true,
    },
    {
        'identifier': 'jailbreak',
        'enabled': true,
    },
];
