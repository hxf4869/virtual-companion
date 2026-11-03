import {names_behavior_types} from './st/scripts/instruct-mode.js';
import {extension_prompt_types,extension_prompt_roles} from './st/script.js';
import {MEDIA_DISPLAY} from './st/constants.js';
// AGPL-3.0-only. SillyTavern 7e8663cd9 / 已锁定设置缺省值。
import {chat_completion_sources,character_names_behavior,custom_prompt_post_processing_types,reasoning_effort_types,verbosity_levels} from './st/scripts/openai.js';
import {chatCompletionDefaultPrompts,promptManagerDefaultPromptOrders} from './st/scripts/PromptManager.js';
import {persona_description_positions} from './st/constants.js';
const max_4k = 4095;
const default_impersonation_prompt = '[Write your next reply from the point of view of {{user}}, using the chat history so far as a guideline for the writing style of {{user}}. Don\'t write as {{char}} or system. Don\'t describe actions of {{char}}.]';
const default_new_chat_prompt = '[Start a new Chat]';
const default_new_group_chat_prompt = '[Start a new group chat. Group members: {{group}}]';
const default_new_example_chat_prompt = '[Example Chat]';
const default_continue_nudge_prompt = '[Continue your last message without repeating its original content.]';
const default_bias = 'Default (none)';
const default_bias_presets = {
    [default_bias]: [],
    'Anti-bond': [
        { id: '22154f79-dd98-41bc-8e34-87015d6a0eaf', text: ' bond', value: -50 },
        { id: '8ad2d5c4-d8ef-49e4-bc5e-13e7f4690e0f', text: ' future', value: -50 },
        { id: '52a4b280-0956-4940-ac52-4111f83e4046', text: ' bonding', value: -50 },
        { id: 'e63037c7-c9d1-4724-ab2d-7756008b433b', text: ' connection', value: -25 },
    ],
};
const default_wi_format = '{0}';
const default_group_nudge_prompt = '[Write the next reply only as {{char}}.]';
const default_scenario_format = '{{scenario}}';
const default_personality_format = '{{personality}}';
const SILICONFLOW_ENDPOINT = {
    GLOBAL: 'global',
    CN: 'cn',
};
const MINIMAX_ENDPOINT = {
    GLOBAL: 'global',
    CN: 'cn',
};
const POLLINATIONS_ENDPOINT = {
    AUTHENTICATED: 'authenticated',
    ANONYMOUS: 'anonymous',
};
const ZAI_ENDPOINT = {
    COMMON: 'common',
    CODING: 'coding',
};
const openrouter_website_model = 'OR_Website';
const openrouter_middleout_types = {
    AUTO: 'auto',
    ON: 'on',
    OFF: 'off',
};
const tool_reasoning_modes = {
    DISABLED: 'disabled',
    SINCE_LAST_USER: 'since_last_user',
    ACTIVE_CHAIN: 'active_chain',
};
const continue_postfix_types = {
    NONE: '',
    SPACE: ' ',
    NEWLINE: '\n',
    DOUBLE_NEWLINE: '\n\n',
};
const default_settings = {
    preset_settings_openai: 'Default',
    temp_openai: 1.0,
    freq_pen_openai: 0,
    pres_pen_openai: 0,
    top_p_openai: 1.0,
    top_k_openai: 0,
    min_p_openai: 0,
    top_a_openai: 0,
    repetition_penalty_openai: 1,
    stream_openai: false,
    openai_max_context: max_4k,
    openai_max_tokens: 300,
    ...chatCompletionDefaultPrompts,
    ...promptManagerDefaultPromptOrders,
    send_if_empty: '',
    impersonation_prompt: default_impersonation_prompt,
    new_chat_prompt: default_new_chat_prompt,
    new_group_chat_prompt: default_new_group_chat_prompt,
    new_example_chat_prompt: default_new_example_chat_prompt,
    continue_nudge_prompt: default_continue_nudge_prompt,
    bias_preset_selected: default_bias,
    bias_presets: default_bias_presets,
    wi_format: default_wi_format,
    group_nudge_prompt: default_group_nudge_prompt,
    scenario_format: default_scenario_format,
    personality_format: default_personality_format,
    sort_models: 'alphabetically',
    group_models: false,
    openai_model: 'gpt-5.6-terra',
    claude_model: 'claude-sonnet-5',
    google_model: 'gemini-3.7-flash',
    vertexai_model: 'gemini-3.7-flash',
    ai21_model: 'jamba-large',
    mistralai_model: 'mistral-large-latest',
    cohere_model: 'command-r-plus',
    perplexity_model: 'sonar-pro',
    groq_model: 'llama-3.3-70b-versatile',
    chutes_model: 'deepseek-ai/DeepSeek-V3-0324',
    siliconflow_model: 'deepseek-ai/DeepSeek-V3',
    siliconflow_endpoint: SILICONFLOW_ENDPOINT.GLOBAL,
    minimax_model: 'MiniMax-M2.7',
    minimax_endpoint: MINIMAX_ENDPOINT.GLOBAL,
    electronhub_model: 'gpt-4o-mini',
    nanogpt_model: 'gpt-4o-mini',
    nanogpt_provider: '',
    nanogpt_payg_override: false,
    deepseek_model: 'deepseek-v4-flash',
    aimlapi_model: 'chatgpt-4o-latest',
    xai_model: 'grok-3-beta',
    pollinations_model: 'openai',
    pollinations_endpoint: POLLINATIONS_ENDPOINT.AUTHENTICATED,
    cometapi_model: 'gpt-4o',
    moonshot_model: 'kimi-latest',
    fireworks_model: 'accounts/fireworks/models/kimi-k2-instruct',
    zai_model: 'glm-4.6',
    zai_endpoint: ZAI_ENDPOINT.COMMON,
    workers_ai_model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    workers_ai_account_id: '',
    azure_base_url: '',
    azure_deployment_name: '',
    azure_api_version: '2024-02-15-preview',
    azure_openai_model: '',
    custom_model: '',
    custom_url: '',
    custom_include_body: '',
    custom_exclude_body: '',
    custom_include_headers: '',
    openrouter_model: openrouter_website_model,
    openrouter_use_fallback: false,
    openrouter_providers: [],
    openrouter_quantizations: [],
    openrouter_allow_fallbacks: true,
    openrouter_middleout: openrouter_middleout_types.ON,
    tool_reasoning_mode: tool_reasoning_modes.DISABLED,
    reverse_proxy: '',
    chat_completion_source: chat_completion_sources.OPENAI,
    max_context_unlocked: false,
    show_external_models: false,
    proxy_password: '',
    assistant_prefill: '',
    assistant_impersonation: '',
    use_sysprompt: false,
    vertexai_auth_mode: 'express',
    vertexai_region: 'us-central1',
    vertexai_express_project_id: '',
    squash_system_messages: false,
    media_inlining: true,
    inline_image_quality: 'auto',
    bypass_status_check: false,
    continue_prefill: false,
    function_calling: false,
    tool_call_recurse_limit: 5,
    names_behavior: character_names_behavior.DEFAULT,
    continue_postfix: continue_postfix_types.SPACE,
    custom_prompt_post_processing: custom_prompt_post_processing_types.NONE,
    show_thoughts: true,
    reasoning_effort: reasoning_effort_types.auto,
    verbosity: verbosity_levels.auto,
    enable_web_search: false,
    request_images: false,
    request_image_aspect_ratio: '',
    request_image_resolution: '',
    seed: -1,
    n: 1,
    bind_preset_to_connection: true,
    extensions: {},
};
const avatar_styles = {
    ROUND: 0,
    RECTANGULAR: 1,
    SQUARE: 2,
    ROUNDED: 3,
};
const chat_styles = {
    DEFAULT: 0,
    BUBBLES: 1,
    DOCUMENT: 2,
};
const defaultToastPosition = 'toast-top-center';
const send_on_enter_options = {
    DISABLED: -1,
    AUTO: 0,
    ENABLED: 1,
};
const defaultStoryString = '{{#if system}}{{system}}\n{{/if}}{{#if description}}{{description}}\n{{/if}}{{#if personality}}{{char}}\'s personality: {{personality}}\n{{/if}}{{#if scenario}}Scenario: {{scenario}}\n{{/if}}{{#if persona}}{{persona}}\n{{/if}}';
const defaultChatStart = '***';
const defaultExampleSeparator = '***';
const tokenizers = {
    NONE: 0,
    GPT2: 1,
    OPENAI: 2,
    LLAMA: 3,
    NERD: 4,
    NERD2: 5,
    API_CURRENT: 6,
    MISTRAL: 7,
    YI: 8,
    API_TEXTGENERATIONWEBUI: 9,
    API_KOBOLD: 10,
    CLAUDE: 11,
    LLAMA3: 12,
    GEMMA: 13,
    JAMBA: 14,
    QWEN2: 15,
    COMMAND_R: 16,
    NEMO: 17,
    DEEPSEEK: 18,
    COMMAND_A: 19,
    BEST_MATCH: 99,
};
const tag_import_setting = {
    ASK: 1,
    NONE: 2,
    ALL: 3,
    ONLY_EXISTING: 4,
};
const tag_sort_mode = {
    MANUAL: 'manual',
    ALPHABETICAL: 'alphabetical',
    BY_ENTRIES: 'by_entries',
};
const DEFAULT_REASONING_TEMPLATE = 'Think XML';
const AUTOCOMPLETE_STATE = {
    DISABLED: 0,
    MIN_LENGTH: 1,
    ALWAYS: 2,
};
const AUTOCOMPLETE_WIDTH = {
    'INPUT': 0,
    'CHAT': 1,
    'FULL': 2,
};
const AUTOCOMPLETE_SELECT_KEY = {
    'TAB': 1, // 2^0
    'ENTER': 2, // 2^1
};
const IMAGE_OVERSWIPE = {
    GENERATE: 'generate',
    ROLLOVER: 'rollover',
};
const power_user = {
    charListGrid: false,
    tokenizer: tokenizers.BEST_MATCH,
    token_padding: 64,
    collapse_newlines: false,
    pin_examples: false,
    strip_examples: false,
    trim_sentences: false,
    always_force_name2: false,
    user_prompt_bias: '',
    show_user_prompt_bias: true,
    auto_continue: {
        enabled: false,
        allow_chat_completions: false,
        target_length: 400,
    },
    markdown_escape_strings: '',
    chat_truncation: 100,
    streaming_fps: 30,
    smooth_streaming: false,
    smooth_streaming_no_think: false,
    smooth_streaming_speed: 50,
    stream_fade_in: false,

    fast_ui_mode: true,
    avatar_style: avatar_styles.ROUND,
    chat_display: chat_styles.DEFAULT,
    toastr_position: defaultToastPosition,
    chat_width: 50,
    never_resize_avatars: false,
    show_card_avatar_urls: false,
    play_message_sound: false,
    play_sound_unfocused: true,
    auto_save_msg_edits: false,
    confirm_message_delete: true,

    sort_field: 'name',
    sort_order: 'asc',
    sort_rule: null,
    font_scale: 1,
    blur_strength: 10,
    shadow_width: 2,

    main_text_color: `${getComputedStyle(document.documentElement).getPropertyValue('--SmartThemeBodyColor').trim()}`,
    italics_text_color: `${getComputedStyle(document.documentElement).getPropertyValue('--SmartThemeEmColor').trim()}`,
    underline_text_color: `${getComputedStyle(document.documentElement).getPropertyValue('--SmartThemeUnderlineColor').trim()}`,
    quote_text_color: `${getComputedStyle(document.documentElement).getPropertyValue('--SmartThemeQuoteColor').trim()}`,
    blur_tint_color: `${getComputedStyle(document.documentElement).getPropertyValue('--SmartThemeBlurTintColor').trim()}`,
    chat_tint_color: `${getComputedStyle(document.documentElement).getPropertyValue('--SmartThemeChatTintColor').trim()}`,
    user_mes_blur_tint_color: `${getComputedStyle(document.documentElement).getPropertyValue('--SmartThemeUserMesBlurTintColor').trim()}`,
    bot_mes_blur_tint_color: `${getComputedStyle(document.documentElement).getPropertyValue('--SmartThemeBotMesBlurTintColor').trim()}`,
    shadow_color: `${getComputedStyle(document.documentElement).getPropertyValue('--SmartThemeShadowColor').trim()}`,
    border_color: `${getComputedStyle(document.documentElement).getPropertyValue('--SmartThemeBorderColor').trim()}`,

    custom_css: '',

    waifuMode: false,
    movingUI: false,
    movingUIState: {},
    movingUIPreset: '',
    noShadows: false,
    theme: 'Default (Dark) 1.7.1',

    gestures: true,
    auto_swipe: false,
    auto_swipe_minimum_length: 0,
    auto_swipe_blacklist: [],
    auto_swipe_blacklist_threshold: 2,
    auto_scroll_chat_to_bottom: true,
    auto_fix_generated_markdown: true,
    send_on_enter: send_on_enter_options.AUTO,
    console_log_prompts: false,
    request_token_probabilities: false,
    show_group_chat_queue: false,
    allow_name1_display: false,
    allow_name2_display: false,
    hotswap_enabled: true,
    timer_enabled: true,
    timestamps_enabled: true,
    timestamp_model_icon: false,
    mesIDDisplay_enabled: false,
    hideChatAvatars_enabled: false,
    max_context_unlocked: false,
    message_token_count_enabled: false,
    expand_message_actions: false,
    enableZenSliders: false,
    enableLabMode: false,
    prefer_character_prompt: true,
    prefer_character_jailbreak: true,
    quick_continue: false,
    quick_impersonate: false,
    continue_on_send: false,
    trim_spaces: true,
    relaxed_api_urls: false,
    world_import_dialog: true,
    enable_auto_select_input: false,
    enable_md_hotkeys: false,
    tag_import_setting: tag_import_setting.ASK,
    tag_sort_mode: tag_sort_mode.MANUAL,
    disable_group_trimming: false,
    single_line: false,

    instruct: {
        enabled: false,
        preset: 'Alpaca',
        input_sequence: '### Instruction:',
        input_suffix: '',
        output_sequence: '### Response:',
        output_suffix: '',
        system_sequence: '',
        system_suffix: '',
        last_system_sequence: '',
        first_input_sequence: '',
        first_output_sequence: '',
        last_input_sequence: '',
        last_output_sequence: '',
        story_string_prefix: '',
        story_string_suffix: '',
        stop_sequence: '',
        wrap: true,
        macro: true,
        names_behavior: names_behavior_types.FORCE,
        activation_regex: '',
        bind_to_context: false,
        user_alignment_message: '',
        system_same_as_user: false,
        /** @deprecated Use output_suffix instead */
        separator_sequence: '',
        sequences_as_stop_strings: true,
    },

    context: {
        preset: 'Default',
        story_string: defaultStoryString,
        chat_start: defaultChatStart,
        example_separator: defaultExampleSeparator,
        use_stop_strings: true,
        names_as_stop_strings: true,
        story_string_position: extension_prompt_types.IN_PROMPT,
        story_string_role: extension_prompt_roles.SYSTEM,
        story_string_depth: 1,
    },

    instruct_derived: false,
    context_derived: false,
    context_size_derived: false,
    /** User-defined model identifier / chat template hash to instruct/context template mappings */
    model_templates_mappings: {},
    /** The chat template hash of the currently loaded model, if any; used when deriving mappings */
    chat_template_hash: '',

    sysprompt: {
        enabled: true,
        name: 'Neutral - Chat',
        content: 'Write {{char}}\'s next reply in a fictional chat between {{char}} and {{user}}.',
        post_history: '',
    },

    reasoning: {
        name: DEFAULT_REASONING_TEMPLATE,
        auto_parse: false,
        add_to_prompts: false,
        auto_expand: false,
        show_hidden: false,
        prefix: '<think>',
        suffix: '</think>',
        separator: '\n',
        max_additions: 1,
    },

    personas: {},
    default_persona: null,
    persona_descriptions: {},

    persona_description: '',
    persona_description_position: persona_description_positions.IN_PROMPT,
    persona_description_role: 0,
    persona_description_depth: 2,
    persona_description_lorebook: '',
    persona_show_notifications: true,
    persona_sort_order: 'asc',

    custom_stopping_strings: '',
    custom_stopping_strings_macro: true,
    fuzzy_search: false,
    encode_tags: false,
    experimental_macro_engine: true,
    servers: [],
    bogus_folders: false,
    zoomed_avatar_magnification: false,
    show_tag_filters: false,
    aux_field: 'character_version',
    stscript: {
        matching: 'fuzzy',
        autocomplete: {
            state: AUTOCOMPLETE_STATE.ALWAYS,
            autoHide: false,
            style: 'theme',
            font: {
                scale: 0.8,
            },
            width: {
                left: AUTOCOMPLETE_WIDTH.CHAT,
                right: AUTOCOMPLETE_WIDTH.CHAT,
            },
            select: AUTOCOMPLETE_SELECT_KEY.TAB + AUTOCOMPLETE_SELECT_KEY.ENTER,
            /** Whether to show macro autocomplete in all macro-enabled fields (not just expanded editors) */
            showInAllMacroFields: false,
        },
        parser: {
            /**@type {Object.<PARSER_FLAG,boolean>} */
            flags: {},
        },
    },
    restore_user_input: true,
    reduced_motion: false,
    compact_input_area: true,
    show_swipe_num_all_messages: false,
    auto_connect: false,
    auto_load_chat: false,
    forbid_external_media: true,
    external_media_allowed_overrides: [],
    external_media_forbidden_overrides: [],
    pin_styles: true,
    click_to_edit: false,
    media_display: MEDIA_DISPLAY.LIST,
    image_overswipe: IMAGE_OVERSWIPE.GENERATE,
};
export {default_settings as openaiDefaults,power_user as powerUserDefaults};
