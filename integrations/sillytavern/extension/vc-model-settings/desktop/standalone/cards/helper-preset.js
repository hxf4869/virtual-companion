// AGPL-3.0-only. Locked Helper 0af421068e4 preset/read conversion, explicit desktop document ports.
import {getCardHost,regex_placement} from './ejs-host.js';
import {klona} from './klona.js';
const uuidv4=()=>crypto.randomUUID();
function isPresetSystemPrompt(prompt) {
    return ['main', 'nsfw', 'jailbreak', 'enhanceDefinitions'].includes(prompt.id);
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
function toPresetPrompt(prompt, prompt_order) {
    const is_normal_prompt = prompt.system_prompt === false && (prompt.marker === undefined || prompt.marker === false);
    const is_system_prompt = prompt.system_prompt === true && (prompt.marker === undefined || prompt.marker === false);
    const is_placeholder_prompt = prompt.marker === true;
    let result = _({})
        .set('id', prompt.identifier ?? uuidv4())
        .set('name', prompt.name ?? 'unnamed')
        .set('enabled', prompt_order.find(order => order.identifier === prompt.identifier)?.enabled ?? prompt.enabled ?? true);
    if (is_normal_prompt || is_placeholder_prompt) {
        result = result.set('position.type', { 0: 'relative', 1: 'in_chat' }[prompt.injection_position ?? 0]);
        if (prompt.injection_position === 1) {
            result = result.set('position.depth', prompt.injection_depth ?? 4);
            result = result.set('position.order', prompt.injection_order ?? 100);
        }
    }
    result = result.set('role', prompt.role ?? 'system');
    if (is_normal_prompt || is_system_prompt) {
        result = result.set('content', prompt.content ?? '');
    }
    if (prompt.extra) {
        result = result.set('extra', prompt.extra);
    }
    return result.value();
}
function toPreset(preset, { in_use }) {
    const prompt_order = preset.prompt_order.find(order => order.character_id === 100001)?.order ?? [];
    const prompts_all = preset.prompts.map(prompt => toPresetPrompt(prompt, prompt_order));
    const prompt_order_identifiers = prompt_order.map(order => order.identifier);
    const [prompts_used, prompts_unused] = _.partition(prompts_all, prompt => prompt_order_identifiers.includes(prompt.id));
    const prompts = prompt_order_identifiers.map(identifier => prompts_used.find(prompt => prompt.id === identifier));
    const extensions = klona(preset.extensions);
    _.set(extensions, 'regex_scripts', (extensions?.regex_scripts ?? []).map(to_tavern_regex));
    return {
        settings: {
            max_context: Number(preset.openai_max_context),
            max_completion_tokens: Number(preset.openai_max_tokens),
            reply_count: Number(preset.n),
            should_stream: Boolean(preset.stream_openai),
            temperature: Number(in_use ? preset.temp_openai : preset.temperature),
            frequency_penalty: Number(in_use ? preset.freq_pen_openai : preset.frequency_penalty),
            presence_penalty: Number(in_use ? preset.pres_pen_openai : preset.presence_penalty),
            top_p: Number(in_use ? preset.top_p_openai : preset.top_p),
            repetition_penalty: Number(in_use ? preset.repetition_penalty_openai : preset.repetition_penalty),
            min_p: Number(in_use ? preset.min_p_openai : preset.min_p),
            top_k: Number(in_use ? preset.top_k_openai : preset.top_k),
            top_a: Number(in_use ? preset.top_a_openai : preset.top_a),
            seed: Number(preset.seed),
            squash_system_messages: Boolean(preset.squash_system_messages),
            reasoning_effort: String(preset.reasoning_effort),
            request_thoughts: Boolean(preset.show_thoughts),
            request_images: Boolean(preset.request_images),
            enable_function_calling: Boolean(preset.function_calling),
            enable_web_search: Boolean(preset.enable_web_search),
            allow_sending_images: Boolean(preset.image_inlining) === false
                ? 'disabled'
                : String(preset.inline_image_quality),
            allow_sending_videos: Boolean(preset.video_inlining),
            character_name_prefix: {
                [-1]: 'none',
                [0]: 'default',
                [2]: 'content',
                [1]: 'completion',
            }[Number(preset.names_behavior)],
            wrap_user_messages_in_quotes: Boolean(preset.wrap_in_quotes),
        },
        prompts,
        prompts_unused,
        // @ts-expect-error 类型是正确的, extensions 里必然有 tavern_helper
        extensions,
    };
}
function to_tavern_regex(regex_script_data) {
    return {
        id: regex_script_data.id,
        script_name: regex_script_data.scriptName,
        enabled: !regex_script_data.disabled,
        find_regex: regex_script_data.findRegex,
        trim_strings: regex_script_data.trimStrings || [],
        replace_string: regex_script_data.replaceString,
        source: {
            user_input: regex_script_data.placement.includes(regex_placement.USER_INPUT),
            ai_output: regex_script_data.placement.includes(regex_placement.AI_OUTPUT),
            slash_command: regex_script_data.placement.includes(regex_placement.SLASH_COMMAND),
            world_info: regex_script_data.placement.includes(regex_placement.WORLD_INFO),
            reasoning: regex_script_data.placement.includes(regex_placement.REASONING),
        },
        destination: {
            display: regex_script_data.markdownOnly,
            prompt: regex_script_data.promptOnly,
        },
        run_on_edit: regex_script_data.runOnEdit,
        min_depth: typeof regex_script_data.minDepth === 'number' ? regex_script_data.minDepth : null,
        max_depth: typeof regex_script_data.maxDepth === 'number' ? regex_script_data.maxDepth : null,
    };
}

export const getPresetNames=()=>Object.keys(getCardHost().presets);
export const getLoadedPresetName=()=>getCardHost().settings.oai_settings.preset_settings_openai;
export function getPreset(name='in_use'){const {settings,presets}=getCardHost();const raw=name==='in_use'?settings.oai_settings:presets[name];if(!raw)throw new Error('预设不存在');return klona(toPreset({...settings.oai_settings,...raw,extensions:raw.extensions || {}},{in_use:name==='in_use'}));}
