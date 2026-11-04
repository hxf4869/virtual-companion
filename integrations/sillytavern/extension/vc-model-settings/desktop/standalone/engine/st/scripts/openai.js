// AGPL-3.0-only. SillyTavern 7e8663cd9c184a550b37238218bdd32c6efc68e9 / scripts/openai.js
// 保留本地裁剪拷贝：保留 OpenAI/Claude/Google/xAI 消息转换、预填与请求体构造算法，剥离设置面板 DOM 与原生传输并绑定 ../../ports.js。
import { getCurrentChatId } from '../../ports.js';
import { getCustomStoppingStrings } from './stopping.js';
import { clamp } from './utils.js';
import { IGNORE_SYMBOL, MEDIA_TYPE, MEDIA_DISPLAY, system_message_types, persona_description_positions } from '../constants.js';
import { getMediaIndex, getMediaDisplay } from '../script.js';
import { name1, name2, selected_group, getGroupNames, main_api, oai_settings, power_user, model_list, openrouter_website_model } from '../../ports.js';
import { substituteParams, substituteParamsExtended, extension_prompt_types, extension_prompt_roles, getExtensionPrompt, getExtensionPromptMaxDepth } from '../script.js';
import { PromptManager, Prompt, PromptCollection, INJECTION_POSITION } from './PromptManager.js';
import { stringFormat } from './utils.js';
import { quietConsole } from '../../diagnostics.js';
export const chat_completion_sources = {
    OPENAI: 'openai',
    CLAUDE: 'claude',
    OPENROUTER: 'openrouter',
    AI21: 'ai21',
    MAKERSUITE: 'makersuite',
    VERTEXAI: 'vertexai',
    MISTRALAI: 'mistralai',
    CUSTOM: 'custom',
    COHERE: 'cohere',
    PERPLEXITY: 'perplexity',
    GROQ: 'groq',
    ELECTRONHUB: 'electronhub',
    CHUTES: 'chutes',
    NANOGPT: 'nanogpt',
    DEEPSEEK: 'deepseek',
    AIMLAPI: 'aimlapi',
    XAI: 'xai',
    POLLINATIONS: 'pollinations',
    MOONSHOT: 'moonshot',
    FIREWORKS: 'fireworks',
    COMETAPI: 'cometapi',
    AZURE_OPENAI: 'azure_openai',
    ZAI: 'zai',
    SILICONFLOW: 'siliconflow',
    WORKERS_AI: 'workers_ai',
    MINIMAX: 'minimax',
};

export const character_names_behavior = {
    NONE: -1,
    DEFAULT: 0,
    COMPLETION: 1,
    CONTENT: 2,
};

export const tool_reasoning_modes = {
    DISABLED: 'disabled',
    SINCE_LAST_USER: 'since_last_user',
    ACTIVE_CHAIN: 'active_chain',
};

export const interleaved_reasoning_providers = [
    chat_completion_sources.OPENROUTER,
    chat_completion_sources.CUSTOM,
];
export function parseExampleIntoIndividual(messageExampleString, appendNamesForGroup = true) {
    const groupBotNames = getGroupNames().map(name => `${name}:`);

    let result = []; // array of msgs
    let tmp = messageExampleString.split('\n');
    let cur_msg_lines = [];
    let in_user = false;
    let in_bot = false;
    let botName = name2;

    // DRY my cock and balls :)
    function add_msg(name, role, system_name) {
        // join different newlines (we split them by \n and join by \n)
        // remove char name
        // strip to remove extra spaces
        let parsed_msg = cur_msg_lines.join('\n').replace(name + ':', '').trim();

        if (appendNamesForGroup && selected_group && ['example_user', 'example_assistant'].includes(system_name)) {
            parsed_msg = `${name}: ${parsed_msg}`;
        }

        result.push({ 'role': role, 'content': parsed_msg, 'name': system_name });
        cur_msg_lines = [];
    }
    // skip first line as it'll always be "This is how {bot name} should talk"
    for (let i = 1; i < tmp.length; i++) {
        let cur_str = tmp[i];
        // if it's the user message, switch into user mode and out of bot mode
        // yes, repeated code, but I don't care
        if (cur_str.startsWith(name1 + ':')) {
            in_user = true;
            // we were in the bot mode previously, add the message
            if (in_bot) {
                add_msg(botName, 'system', 'example_assistant');
            }
            in_bot = false;
        } else if (cur_str.startsWith(name2 + ':') || groupBotNames.some(n => cur_str.startsWith(n))) {
            if (!cur_str.startsWith(name2 + ':') && groupBotNames.length) {
                botName = cur_str.split(':')[0];
            }

            in_bot = true;
            // we were in the user mode previously, add the message
            if (in_user) {
                add_msg(name1, 'system', 'example_user');
            }
            in_user = false;
        }
        // push the current line into the current message array only after checking for presence of user/bot
        cur_msg_lines.push(cur_str);
    }
    // Special case for last message in a block because we don't have a new message to trigger the switch
    if (in_user) {
        add_msg(name1, 'system', 'example_user');
    } else if (in_bot) {
        add_msg(botName, 'system', 'example_assistant');
    }
    return result;
}

export function getChatCompletionModel(settings = null) {
    settings = settings ?? oai_settings;
    const source = settings.chat_completion_source;
    switch (source) {
        case chat_completion_sources.CLAUDE:
            return settings.claude_model;
        case chat_completion_sources.OPENAI:
            return settings.openai_model;
        case chat_completion_sources.MAKERSUITE:
            return settings.google_model;
        case chat_completion_sources.VERTEXAI:
            return settings.vertexai_model;
        case chat_completion_sources.OPENROUTER:
            return settings.openrouter_model !== openrouter_website_model ? settings.openrouter_model : null;
        case chat_completion_sources.AI21:
            return settings.ai21_model;
        case chat_completion_sources.MISTRALAI:
            return settings.mistralai_model;
        case chat_completion_sources.CUSTOM:
            return settings.custom_model;
        case chat_completion_sources.COHERE:
            return settings.cohere_model;
        case chat_completion_sources.PERPLEXITY:
            return settings.perplexity_model;
        case chat_completion_sources.GROQ:
            return settings.groq_model;
        case chat_completion_sources.SILICONFLOW:
            return settings.siliconflow_model;
        case chat_completion_sources.MINIMAX:
            return settings.minimax_model;
        case chat_completion_sources.ELECTRONHUB:
            return settings.electronhub_model;
        case chat_completion_sources.CHUTES:
            return settings.chutes_model;
        case chat_completion_sources.NANOGPT:
            return settings.nanogpt_model;
        case chat_completion_sources.DEEPSEEK:
            return settings.deepseek_model;
        case chat_completion_sources.AIMLAPI:
            return settings.aimlapi_model;
        case chat_completion_sources.XAI:
            return settings.xai_model;
        case chat_completion_sources.POLLINATIONS:
            return settings.pollinations_model;
        case chat_completion_sources.COMETAPI:
            return settings.cometapi_model;
        case chat_completion_sources.MOONSHOT:
            return settings.moonshot_model;
        case chat_completion_sources.FIREWORKS:
            return settings.fireworks_model;
        case chat_completion_sources.AZURE_OPENAI:
            return settings.azure_openai_model;
        case chat_completion_sources.ZAI:
            return settings.zai_model;
        case chat_completion_sources.WORKERS_AI:
            return settings.workers_ai_model;
        default:
            console.error(`Unknown chat completion source: ${source}`);
            return '';
    }
}

export function isImageInliningSupported() {
    if (main_api !== 'openai') {
        return false;
    }

    if (!oai_settings.media_inlining) {
        return false;
    }

    // gultra just isn't being offered as multimodal, thanks google.
    const visionSupportedModels = [
        // OpenAI
        'chatgpt-4o-latest',
        'gpt-4-turbo',
        'gpt-4-vision',
        'gpt-4.1',
        'gpt-4.5-preview',
        'gpt-4o',
        'gpt-6-astra',
        'gpt-5',
        'o1',
        'o3',
        'o4-mini',
        // Claude
        'claude-3',
        'claude-fable',
        'claude-opus-4',
        'claude-opus-5',
        'claude-sonnet-4',
        'claude-sonnet-5',
        'claude-haiku-4',
        // Cohere
        'c4ai-aya-vision',
        'command-a-vision',
        // Google AI Studio
        'gemini-2.0',
        'gemini-2.5',
        'gemini-3',
        'gemini-exp-1206',
        'learnlm',
        'gemini-robotics',
        'gemma-3-27b',
        'gemma-3-12b',
        'gemma-3-4b',
        'gemma-4',
        // MistralAI
        'mistral-small-2503',
        'mistral-small-2506',
        'mistral-small-latest',
        'mistral-medium-latest',
        'mistral-medium-2505',
        'mistral-medium-2508',
        'pixtral',
        // xAI (Grok)
        'grok-4',
        'grok-2-vision',
        // Moonshot
        'moonshot-v1-8k-vision-preview',
        'moonshot-v1-32k-vision-preview',
        'moonshot-v1-128k-vision-preview',
        'kimi-k2.5',
        'kimi-latest',
        // DeepSeek
        'deepseek-v4-flash-vision-exp',
        // Z.AI (GLM)
        'glm-4.5v',
        'glm-4.6v',
        'glm-5v-turbo',
        'autoglm-phone',
        // SiliconFlow
        'Qwen/Qwen3-VL-32B-Instruct',
        'Qwen/Qwen3-VL-8B-Instruct',
        'Qwen/Qwen3-VL-235B-A22B-Instruct',
        'Qwen/Qwen3-VL-30B-A3B-Instruct',
        'zai-org/GLM-4.5V',
    ];

    switch (oai_settings.chat_completion_source) {
        case chat_completion_sources.OPENAI:
        case chat_completion_sources.AZURE_OPENAI: {
            const modelToCheck = oai_settings.chat_completion_source === chat_completion_sources.AZURE_OPENAI
                ? oai_settings.azure_openai_model
                : oai_settings.openai_model;
            return visionSupportedModels.some(model =>
                modelToCheck.includes(model)
                && ['gpt-4-turbo-preview', 'o1-mini', 'o3-mini'].some(x => !modelToCheck.includes(x)),
            );
        }
        case chat_completion_sources.MAKERSUITE:
            return visionSupportedModels.some(model => oai_settings.google_model.includes(model));
        case chat_completion_sources.VERTEXAI:
            return visionSupportedModels.some(model => oai_settings.vertexai_model.includes(model));
        case chat_completion_sources.CLAUDE:
            return visionSupportedModels.some(model => oai_settings.claude_model.includes(model));
        case chat_completion_sources.OPENROUTER:
            return (Array.isArray(model_list) && model_list.find(m => m.id === oai_settings.openrouter_model)?.architecture?.input_modalities?.includes('image'));
        case chat_completion_sources.CUSTOM:
            return true;
        case chat_completion_sources.MISTRALAI:
            return (Array.isArray(model_list) && model_list.find(m => m.id === oai_settings.mistralai_model)?.capabilities?.vision);
        case chat_completion_sources.COHERE:
            return visionSupportedModels.some(model => oai_settings.cohere_model.includes(model));
        case chat_completion_sources.XAI:
            // TODO: xAI's /models endpoint doesn't return modality info
            return visionSupportedModels.some(model => oai_settings.xai_model.includes(model));
        case chat_completion_sources.AIMLAPI:
            return (Array.isArray(model_list) && model_list.find(m => m.id === oai_settings.aimlapi_model)?.features?.includes('openai/chat-completion.vision'));
        case chat_completion_sources.CHUTES:
            return (Array.isArray(model_list) && model_list.find(m => m.id === oai_settings.chutes_model)?.input_modalities?.includes('image'));
        case chat_completion_sources.ELECTRONHUB:
            return (Array.isArray(model_list) && model_list.find(m => m.id === oai_settings.electronhub_model)?.metadata?.vision);
        case chat_completion_sources.POLLINATIONS:
            return (Array.isArray(model_list) && model_list.find(m => m.id === oai_settings.pollinations_model)?.input_modalities?.includes('image'));
        case chat_completion_sources.COMETAPI:
            return true;
        case chat_completion_sources.MOONSHOT:
            return (Array.isArray(model_list) && model_list.find(m => m.id === oai_settings.moonshot_model)?.supports_image_in);
        case chat_completion_sources.NANOGPT:
            return (Array.isArray(model_list) && model_list.find(m => m.id === oai_settings.nanogpt_model)?.capabilities?.vision);
        case chat_completion_sources.ZAI:
            return visionSupportedModels.some(model => oai_settings.zai_model.includes(model));
        case chat_completion_sources.SILICONFLOW:
            return visionSupportedModels.some(model => oai_settings.siliconflow_model.includes(model));
        case chat_completion_sources.DEEPSEEK:
            return visionSupportedModels.some(model => oai_settings.deepseek_model.includes(model));
        case chat_completion_sources.WORKERS_AI: {
            const waiModel = Array.isArray(model_list) && model_list.find(m => m.id === oai_settings.workers_ai_model);
            return Boolean(waiModel && Array.isArray(waiModel.properties) && waiModel.properties.some(p => p.property_id === 'vision' && p.value === 'true'));
        }
        case chat_completion_sources.FIREWORKS:
            return (Array.isArray(model_list) && model_list.find(m => m.id === oai_settings.fireworks_model)?.supports_image_input);
        default:
            return false;
    }
}

export function isVideoInliningSupported() {
    if (main_api !== 'openai') {
        return false;
    }

    if (!oai_settings.media_inlining) {
        return false;
    }

    const videoSupportedModels = [
        // Gemini
        'gemini-2.0',
        'gemini-2.5',
        'gemini-exp-1206',
        'gemini-3',
        'gemma-4',
        // Z.AI (GLM)
        'glm-4.5v',
        'glm-4.6v',
        'glm-5v-turbo',
    ];

    switch (oai_settings.chat_completion_source) {
        case chat_completion_sources.MAKERSUITE:
            return videoSupportedModels.some(model => oai_settings.google_model.includes(model));
        case chat_completion_sources.VERTEXAI:
            return videoSupportedModels.some(model => oai_settings.vertexai_model.includes(model));
        case chat_completion_sources.OPENROUTER:
            return (Array.isArray(model_list) && model_list.find(m => m.id === oai_settings.openrouter_model)?.architecture?.input_modalities?.includes('video'));
        case chat_completion_sources.ZAI:
            return videoSupportedModels.some(model => oai_settings.zai_model.includes(model));
        default:
            return false;
    }
}

export function isAudioInliningSupported() {
    if (main_api !== 'openai') {
        return false;
    }

    if (!oai_settings.media_inlining) {
        return false;
    }

    const audioSupportedModels = [
        'gemini-2.0',
        'gemini-2.5',
        'gemini-3',
        'gemini-exp-1206',
        'gpt-4o-audio',
        'gpt-4o-realtime',
        'gpt-4o-mini-audio',
        'gpt-4o-mini-realtime',
        'gpt-audio',
        'gpt-realtime',
    ];

    switch (oai_settings.chat_completion_source) {
        case chat_completion_sources.OPENAI:
            return audioSupportedModels.some(model => oai_settings.openai_model.includes(model));
        case chat_completion_sources.MAKERSUITE:
            return audioSupportedModels.some(model => oai_settings.google_model.includes(model));
        case chat_completion_sources.VERTEXAI:
            return audioSupportedModels.some(model => oai_settings.vertexai_model.includes(model));
        case chat_completion_sources.OPENROUTER:
            return (Array.isArray(model_list) && model_list.find(m => m.id === oai_settings.openrouter_model)?.architecture?.input_modalities?.includes('audio'));
        case chat_completion_sources.CUSTOM:
            return true;
        default:
            return false;
    }
}

export function getToolReasoningMode(settings = oai_settings) {
    const mode = String(settings.tool_reasoning_mode ?? '');
    if (Object.values(tool_reasoning_modes).includes(mode)) {
        return mode;
    }
    return tool_reasoning_modes.DISABLED;
}

export function getEffectiveToolReasoningMode(settings = oai_settings) {
    if (!settings.show_thoughts) {
        return tool_reasoning_modes.DISABLED;
    }

    return getToolReasoningMode(settings);
}

export function isReasoningSignatureSupported(settings = oai_settings) {
    // If it's Vertex AI or Makersuite, that's OK - convertGooglePrompt() will handle it later
    const isGoogle = [chat_completion_sources.VERTEXAI, chat_completion_sources.MAKERSUITE].includes(settings.chat_completion_source);
    // Need a more crunchy check for OpenRouter: look for Gemini models
    const isOpenRouterGemini = settings.chat_completion_source === chat_completion_sources.OPENROUTER && /google\/gemini/i.test(settings.openrouter_model);
    return isGoogle || isOpenRouterGemini;
}
export const reasoning_effort_types = {
    auto: 'auto',
    low: 'low',
    medium: 'medium',
    high: 'high',
    min: 'min',
    max: 'max',
};
export const verbosity_levels = {
    auto: 'auto',
    low: 'low',
    medium: 'medium',
    high: 'high',
};
export const custom_prompt_post_processing_types = {
    NONE: '',
    /** @deprecated Use MERGE instead. */
    CLAUDE: 'claude',
    MERGE: 'merge',
    MERGE_TOOLS: 'merge_tools',
    SEMI: 'semi',
    SEMI_TOOLS: 'semi_tools',
    STRICT: 'strict',
    STRICT_TOOLS: 'strict_tools',
    SINGLE: 'single',
};
export const ZAI_ENDPOINT = {
    COMMON: 'common',
    CODING: 'coding',
};
export const POLLINATIONS_ENDPOINT = {
    AUTHENTICATED: 'authenticated',
    ANONYMOUS: 'anonymous',
};
export const SILICONFLOW_ENDPOINT = {
    GLOBAL: 'global',
    CN: 'cn',
};
export const MINIMAX_ENDPOINT = {
    GLOBAL: 'global',
    CN: 'cn',
};
export function createPromptRuntime(dependencies) {
 const { countTokensOpenAIAsync, eventSource, event_types, ToolManager, validateReverseProxy, getTokenizerModel, getRequestHeaders,
 getBase64Async, createThumbnail, getImageSizeFromDataURL, getVideoDurationFromDataURL,
 getAudioDurationFromDataURL, isDataURL, fetch, render = () => {}, t, toast } = dependencies;
 const console=quietConsole, toastr=toast;
 const default_settings={inline_image_quality:'auto'};
 let biasCache;
 const openai_max_stop_strings = 4;
function getReasoningEffort(settings = null, model = null) {
    settings = settings ?? oai_settings;
    model = model ?? getChatCompletionModel(settings);

    // These sources expect the effort as string.
    const reasoningEffortSources = [
        chat_completion_sources.OPENAI,
        chat_completion_sources.AZURE_OPENAI,
        chat_completion_sources.CUSTOM,
        chat_completion_sources.XAI,
        chat_completion_sources.AIMLAPI,
        chat_completion_sources.OPENROUTER,
        chat_completion_sources.POLLINATIONS,
        chat_completion_sources.PERPLEXITY,
        chat_completion_sources.COMETAPI,
        chat_completion_sources.ELECTRONHUB,
        chat_completion_sources.CHUTES,
        chat_completion_sources.DEEPSEEK,
        chat_completion_sources.FIREWORKS,
    ];

    if (!reasoningEffortSources.includes(settings.chat_completion_source)) {
        return settings.reasoning_effort;
    }

    function resolveReasoningEffort() {
        if (settings.chat_completion_source === chat_completion_sources.DEEPSEEK) {
            switch (settings.reasoning_effort) {
                case reasoning_effort_types.auto:
                    return undefined;
                case reasoning_effort_types.min:
                case reasoning_effort_types.low:
                    return reasoning_effort_types.low;
                case reasoning_effort_types.max:
                    return reasoning_effort_types.max;
                default:
                    return reasoning_effort_types.high;
            }
        }

        if (settings.chat_completion_source === chat_completion_sources.FIREWORKS) {
            switch (settings.reasoning_effort) {
                case reasoning_effort_types.auto:
                    return undefined;
                case reasoning_effort_types.min:
                    return reasoning_effort_types.low;
                default:
                    return settings.reasoning_effort;
            }
        }

        if (settings.chat_completion_source === chat_completion_sources.CUSTOM && /^koboldcpp\/(.+)$/.test(model)) {
            switch (settings.reasoning_effort) {
                case reasoning_effort_types.auto:
                    return undefined;
                case reasoning_effort_types.min:
                    return 'minimal';
                case reasoning_effort_types.low:
                    return 'low';
                case reasoning_effort_types.medium:
                    return 'medium';
                case reasoning_effort_types.high:
                    return 'high';
                case reasoning_effort_types.max:
                    return 'xhigh';
                default:
                    return settings.reasoning_effort;
            }
        }

        switch (settings.reasoning_effort) {
            case reasoning_effort_types.auto:
                return undefined;
            case reasoning_effort_types.min:
                if (chat_completion_sources.OPENROUTER === settings.chat_completion_source && !settings.show_thoughts) {
                    return 'none';
                }

                if ([chat_completion_sources.OPENAI, chat_completion_sources.AZURE_OPENAI].includes(settings.chat_completion_source)) {
                    if (/^gpt-5\.(4|5|6)/.test(model)) {
                        return 'none';
                    }
                    if (/^gpt-5/.test(model)) {
                        return reasoning_effort_types.min;
                    }
                }

                return reasoning_effort_types.low;
            case reasoning_effort_types.max:
                if ([chat_completion_sources.OPENAI, chat_completion_sources.AZURE_OPENAI].includes(settings.chat_completion_source)
                    && /^gpt-6-astra/.test(model)) {
                    return reasoning_effort_types.max;
                }
                if ([chat_completion_sources.OPENAI, chat_completion_sources.AZURE_OPENAI].includes(settings.chat_completion_source)
                    && /^gpt-5\.6/.test(model)) {
                    // GPT-5.6 reserves "max" effort for the Responses API.
                    return 'xhigh';
                }
                return reasoning_effort_types.high;
            default:
                return settings.reasoning_effort;
        }
    }

    const reasoningEffort = resolveReasoningEffort();

    // Check if the resolved effort supported by the model
    if (settings.chat_completion_source === chat_completion_sources.ELECTRONHUB) {
        if (Array.isArray(model_list) && reasoningEffort) {
            const currentModel = model_list.find(m => m.id === model);
            const supportedEfforts = currentModel?.metadata?.supported_reasoning_efforts;
            if (Array.isArray(supportedEfforts) && supportedEfforts.includes(reasoningEffort)) {
                return reasoningEffort;
            }
            return undefined;
        }
    }

    return reasoningEffort;
}
function getVerbosity(settings = null) {
    settings = settings ?? oai_settings;

    if (settings.verbosity === verbosity_levels.auto) {
        return undefined;
    }

    // TODO: Adjust verbosity based on model capabilities
    return settings.verbosity;
}
async function calculateLogitBias() {
    const body = JSON.stringify(oai_settings.bias_presets[oai_settings.bias_preset_selected]);
    let result = {};

    try {
        const reply = await fetch(`/api/backends/chat-completions/bias?model=${getTokenizerModel()}`, {
            method: 'POST',
            headers: getRequestHeaders(),
            body,
        });

        result = await reply.json();
    } catch (err) {
        result = {};
        console.error(err);
    }
    return result;
}
async function createGenerationParameters(settings, model, type, messages, { jsonSchema = null } = {}) {
    // HACK: Filter out null and non-object messages
    if (!Array.isArray(messages)) {
        throw new Error('messages must be an array');
    }
    messages = messages.filter(msg => msg && typeof msg === 'object');

    // DeepSeek only accepts image blocks in user messages. Media can also be
    // attached to system and assistant messages by the shared inlining path.
    const isDeepSeekVisionModel = typeof model === 'string' && model.toLowerCase().includes('deepseek-v4-flash-vision-exp');
    if (isDeepSeekVisionModel) {
        messages = messages.flatMap((message) => {
            if (!['system', 'assistant'].includes(message.role) || !Array.isArray(message.content)) {
                return [message];
            }

            const content = message.content.filter(block => block?.type !== 'image_url');
            return content.length > 0 ? [{ ...message, content }] : [];
        });
    }

    // "OpenAI-like" sources
    const gptSources = [
        chat_completion_sources.OPENAI,
        chat_completion_sources.AZURE_OPENAI,
        chat_completion_sources.OPENROUTER,
    ];

    // Sources that support the "seed" parameter
    const seedSupportedSources = [
        chat_completion_sources.OPENAI,
        chat_completion_sources.AZURE_OPENAI,
        chat_completion_sources.OPENROUTER,
        chat_completion_sources.MISTRALAI,
        chat_completion_sources.CUSTOM,
        chat_completion_sources.COHERE,
        chat_completion_sources.GROQ,
        chat_completion_sources.ELECTRONHUB,
        chat_completion_sources.NANOGPT,
        chat_completion_sources.XAI,
        chat_completion_sources.POLLINATIONS,
        chat_completion_sources.AIMLAPI,
        chat_completion_sources.VERTEXAI,
        chat_completion_sources.MAKERSUITE,
        chat_completion_sources.CHUTES,
    ];

    // Sources that support proxying
    const proxySupportedSources = [
        chat_completion_sources.CLAUDE,
        chat_completion_sources.OPENAI,
        chat_completion_sources.MISTRALAI,
        chat_completion_sources.MAKERSUITE,
        chat_completion_sources.VERTEXAI,
        chat_completion_sources.DEEPSEEK,
        chat_completion_sources.XAI,
        chat_completion_sources.ZAI,
        chat_completion_sources.MOONSHOT,
    ];

    // Sources that support logprobs
    const logprobsSupportedSources = [
        chat_completion_sources.OPENAI,
        chat_completion_sources.AZURE_OPENAI,
        chat_completion_sources.OPENROUTER,
        chat_completion_sources.CUSTOM,
        chat_completion_sources.DEEPSEEK,
        chat_completion_sources.XAI,
        chat_completion_sources.AIMLAPI,
        chat_completion_sources.CHUTES,
    ];

    // Sources that support logit bias
    const logitBiasSources = [
        chat_completion_sources.OPENAI,
        chat_completion_sources.AZURE_OPENAI,
        chat_completion_sources.OPENROUTER,
        chat_completion_sources.ELECTRONHUB,
        chat_completion_sources.CHUTES,
        chat_completion_sources.CUSTOM,
    ];

    // Sources that support "n" parameter for multi-swipe
    const multiswipeSources = [
        chat_completion_sources.OPENAI,
        chat_completion_sources.AZURE_OPENAI,
        chat_completion_sources.CUSTOM,
        chat_completion_sources.XAI,
        chat_completion_sources.AIMLAPI,
        chat_completion_sources.MOONSHOT,
    ];

    const isO1 = gptSources.includes(settings.chat_completion_source) && ['o1-2024-12-17', 'o1'].includes(model);
    const isWorkersAIJsonMode = settings.chat_completion_source === chat_completion_sources.WORKERS_AI && jsonSchema;
    const stream = settings.stream_openai && type !== 'quiet' && !isO1 && !isWorkersAIJsonMode;

    const noMultiSwipeTypes = ['quiet', 'impersonate', 'continue'];
    const canMultiSwipe = settings.n > 1 && !noMultiSwipeTypes.includes(type) && multiswipeSources.includes(settings.chat_completion_source);

    let logit_bias = {};
    if (settings.bias_preset_selected
        && logitBiasSources.includes(settings.chat_completion_source)
        && Array.isArray(settings.bias_presets[settings.bias_preset_selected])
        && settings.bias_presets[settings.bias_preset_selected].length) {
        logit_bias = biasCache || await calculateLogitBias();
        biasCache = logit_bias;
    }

    if (Object.keys(logit_bias).length === 0) {
        logit_bias = undefined;
    }

    const generate_data = {
        'type': type,
        'messages': messages,
        'model': model,
        'temperature': Number(settings.temp_openai),
        'frequency_penalty': Number(settings.freq_pen_openai),
        'presence_penalty': Number(settings.pres_pen_openai),
        'top_p': Number(settings.top_p_openai),
        'max_tokens': settings.openai_max_tokens,
        'stream': stream,
        'logit_bias': logit_bias,
        'stop': getCustomStoppingStrings(openai_max_stop_strings),
        'chat_completion_source': settings.chat_completion_source,
        'n': canMultiSwipe ? settings.n : undefined,
        'user_name': name1,
        'char_name': name2,
        'group_names': getGroupNames(),
        'include_reasoning': Boolean(settings.show_thoughts),
        'reasoning_effort': getReasoningEffort(settings, model),
        'enable_web_search': Boolean(settings.enable_web_search),
        'request_images': Boolean(settings.request_images),
        'request_image_resolution': String(settings.request_image_resolution),
        'request_image_aspect_ratio': String(settings.request_image_aspect_ratio),
        'custom_prompt_post_processing': settings.custom_prompt_post_processing,
        'verbosity': getVerbosity(settings),
    };

    if (settings.chat_completion_source === chat_completion_sources.AZURE_OPENAI) {
        generate_data.azure_base_url = settings.azure_base_url;
        generate_data.azure_deployment_name = settings.azure_deployment_name;
        generate_data.azure_api_version = settings.azure_api_version;
        // Reasoning effort is not supported on some Azure models (e.g. GPT-3.x, GPT-4.x)
        if (/^gpt-[34]/.test(model)) {
            delete generate_data.reasoning_effort;
        }
    }

    if (!canMultiSwipe && ToolManager.canPerformToolCalls(type, settings, model)) {
        await ToolManager.registerFunctionToolsOpenAI(generate_data);
    }

    // Empty array will produce a validation error
    if (!Array.isArray(generate_data.stop) || !generate_data.stop.length) {
        delete generate_data.stop;
    }

    if (settings.reverse_proxy && proxySupportedSources.includes(settings.chat_completion_source)) {
        await validateReverseProxy();
        generate_data.reverse_proxy = settings.reverse_proxy;
        generate_data.proxy_password = settings.proxy_password;
    }

    // Add logprobs request (max 5 per OpenAI docs)
    const useLogprobs = !!power_user.request_token_probabilities;
    if (useLogprobs && logprobsSupportedSources.includes(settings.chat_completion_source)) {
        generate_data.logprobs = 5;
    }

    // Remove logit bias/logprobs/stop-strings if not supported by the model
    const isVision = (m) => ['gpt', 'vision'].every(x => typeof m === 'string' && m.includes(x));
    if (gptSources.includes(settings.chat_completion_source) && isVision(model)) {
        delete generate_data.logit_bias;
        delete generate_data.stop;
        delete generate_data.logprobs;
    }
    if (gptSources.includes(settings.chat_completion_source) && /gpt-4.5/.test(model)) {
        delete generate_data.logprobs;
    }

    if (settings.chat_completion_source === chat_completion_sources.CLAUDE) {
        generate_data.top_k = Number(settings.top_k_openai);
        generate_data.use_sysprompt = settings.use_sysprompt;
        generate_data.stop = getCustomStoppingStrings(); // Claude shouldn't have limits on stop strings.
        // Don't add a prefill on quiet gens (summarization) and when using continue prefill.
        if (type !== 'quiet' && !(type === 'continue' && settings.continue_prefill)) {
            generate_data.assistant_prefill = type === 'impersonate'
                ? substituteParams(settings.assistant_impersonation)
                : substituteParams(settings.assistant_prefill);
        }
    }

    if (settings.chat_completion_source === chat_completion_sources.OPENROUTER) {
        generate_data.top_k = Number(settings.top_k_openai);
        generate_data.min_p = Number(settings.min_p_openai);
        generate_data.repetition_penalty = Number(settings.repetition_penalty_openai);
        generate_data.top_a = Number(settings.top_a_openai);
        generate_data.use_fallback = settings.openrouter_use_fallback;
        generate_data.provider = settings.openrouter_providers;
        generate_data.quantizations = settings.openrouter_quantizations;
        generate_data.allow_fallbacks = settings.openrouter_allow_fallbacks;
        generate_data.middleout = settings.openrouter_middleout;
    }

    if (settings.chat_completion_source === chat_completion_sources.NANOGPT) {
        generate_data.nanogpt_provider = settings.nanogpt_provider;
        generate_data.nanogpt_payg_override = settings.nanogpt_payg_override;
    }

    if (settings.chat_completion_source === chat_completion_sources.FIREWORKS && type !== 'quiet') {
        generate_data.chat_id = getCurrentChatId();
    }

    if ([chat_completion_sources.MAKERSUITE, chat_completion_sources.VERTEXAI].includes(settings.chat_completion_source)) {
        const stopStringsLimit = 5;
        generate_data.top_k = Number(settings.top_k_openai);
        generate_data.stop = getCustomStoppingStrings(stopStringsLimit).slice(0, stopStringsLimit).filter(x => x.length >= 1 && x.length <= 16);
        generate_data.use_sysprompt = settings.use_sysprompt;
        if (settings.chat_completion_source === chat_completion_sources.VERTEXAI) {
            generate_data.vertexai_auth_mode = settings.vertexai_auth_mode;
            generate_data.vertexai_region = settings.vertexai_region;
            generate_data.vertexai_express_project_id = settings.vertexai_express_project_id;
        }
    }

    if (settings.chat_completion_source === chat_completion_sources.MISTRALAI) {
        generate_data.safe_prompt = false; // already defaults to false, but just incase they change that in the future.
        generate_data.stop = getCustomStoppingStrings(); // Mistral shouldn't have limits on stop strings.
    }

    if (settings.chat_completion_source === chat_completion_sources.CUSTOM) {
        generate_data.custom_url = settings.custom_url;
        generate_data.custom_include_body = substituteParams(settings.custom_include_body);
        generate_data.custom_exclude_body = substituteParams(settings.custom_exclude_body);
        generate_data.custom_include_headers = substituteParams(settings.custom_include_headers);
    }

    if (settings.chat_completion_source === chat_completion_sources.COHERE) {
        // Clamp to 0.01 -> 0.99
        generate_data.top_p = Math.min(Math.max(Number(settings.top_p_openai), 0.01), 0.99);
        generate_data.top_k = Number(settings.top_k_openai);
        // Clamp to 0 -> 1
        generate_data.frequency_penalty = Math.min(Math.max(Number(settings.freq_pen_openai), 0), 1);
        generate_data.presence_penalty = Math.min(Math.max(Number(settings.pres_pen_openai), 0), 1);
        generate_data.stop = getCustomStoppingStrings(5);
    }

    if (settings.chat_completion_source === chat_completion_sources.PERPLEXITY) {
        generate_data.top_k = Number(settings.top_k_openai);
        generate_data.frequency_penalty = Number(settings.freq_pen_openai);
        generate_data.presence_penalty = Number(settings.pres_pen_openai);
        delete generate_data.stop;
    }

    // https://console.groq.com/docs/openai
    if (settings.chat_completion_source === chat_completion_sources.GROQ) {
        delete generate_data.logprobs;
        delete generate_data.logit_bias;
        delete generate_data.top_logprobs;
        delete generate_data.n;
    }

    // https://api-docs.deepseek.com/api/create-chat-completion
    if (settings.chat_completion_source === chat_completion_sources.DEEPSEEK) {
        generate_data.top_p = generate_data.top_p || Number.EPSILON;
    }

    if (settings.chat_completion_source === chat_completion_sources.XAI) {
        if (model.includes('grok-3-mini')) {
            delete generate_data.presence_penalty;
            delete generate_data.frequency_penalty;
            delete generate_data.stop;
        } else {
            // As of 2025/09/21, only grok-3-mini accepts reasoning_effort
            delete generate_data.reasoning_effort;
        }

        if (model.includes('grok-4') || model.includes('grok-code')) {
            delete generate_data.presence_penalty;
            delete generate_data.frequency_penalty;

            // grok-4-fast-non-reasoning accepts stop
            if (!model.includes('grok-4-fast-non-reasoning')) {
                delete generate_data.stop;
            }
        }
    }

    // https://docs.electronhub.ai/api-reference/chat/completions
    if (settings.chat_completion_source === chat_completion_sources.ELECTRONHUB) {
        generate_data.top_k = Number(settings.top_k_openai);
    }

    if (settings.chat_completion_source === chat_completion_sources.CHUTES) {
        generate_data.min_p = Number(settings.min_p_openai);
        generate_data.top_k = settings.top_k_openai > 0 ? Number(settings.top_k_openai) : undefined;
        generate_data.repetition_penalty = Number(settings.repetition_penalty_openai);
        generate_data.stop = getCustomStoppingStrings();
    }

    // https://docs.z.ai/api-reference/llm/chat-completion
    if (settings.chat_completion_source === chat_completion_sources.ZAI) {
        generate_data.top_p = generate_data.top_p || 0.01;
        generate_data.stop = getCustomStoppingStrings(1);
        generate_data.zai_endpoint = settings.zai_endpoint || ZAI_ENDPOINT.COMMON;
        delete generate_data.presence_penalty;
        delete generate_data.frequency_penalty;
    }

    if (settings.chat_completion_source === chat_completion_sources.POLLINATIONS) {
        generate_data.pollinations_endpoint = settings.pollinations_endpoint || POLLINATIONS_ENDPOINT.AUTHENTICATED;
    }

    if (settings.chat_completion_source === chat_completion_sources.SILICONFLOW) {
        generate_data.siliconflow_endpoint = settings.siliconflow_endpoint || SILICONFLOW_ENDPOINT.GLOBAL;
    }

    if (settings.chat_completion_source === chat_completion_sources.MINIMAX) {
        generate_data.minimax_endpoint = settings.minimax_endpoint || MINIMAX_ENDPOINT.GLOBAL;
        // MiniMax requires temperature in (0.0, 1.0]; zero is rejected.
        if (Number.isFinite(generate_data.temperature)) {
            generate_data.temperature = clamp(generate_data.temperature, Number.EPSILON, 1.0);
        }
    }

    if (settings.chat_completion_source === chat_completion_sources.WORKERS_AI) {
        generate_data.workers_ai_account_id = settings.workers_ai_account_id;
        generate_data.top_k = settings.top_k_openai > 0 ? Math.min(Number(settings.top_k_openai), 50) : undefined;
        generate_data.repetition_penalty = Number(settings.repetition_penalty_openai);
        generate_data.seed = settings.seed >= 1 ? Number(settings.seed) : undefined;
        generate_data.top_p = Math.max(Number(settings.top_p_openai), 0.001);
        delete generate_data.n;
        delete generate_data.logit_bias;
    }

    // https://docs.nano-gpt.com/api-reference/endpoint/chat-completion#temperature-&-nucleus
    if (settings.chat_completion_source === chat_completion_sources.NANOGPT) {
        generate_data.top_k = Number(settings.top_k_openai);
        generate_data.min_p = Number(settings.min_p_openai);
        generate_data.repetition_penalty = Number(settings.repetition_penalty_openai);
        generate_data.top_a = Number(settings.top_a_openai);
    }

    // https://platform.moonshot.ai/docs/api/chat#public-service-address
    if (settings.chat_completion_source === chat_completion_sources.MOONSHOT) {
        // >Kimi API is fully compatible with OpenAI's API format
        if (/kimi-k2.5/.test(model)) {
            delete generate_data.temperature;
            delete generate_data.top_p;
            delete generate_data.frequency_penalty;
            delete generate_data.presence_penalty;
        }
    }

    if (seedSupportedSources.includes(settings.chat_completion_source) && settings.seed >= 0) {
        generate_data.seed = settings.seed;
    }

    if ([chat_completion_sources.OPENAI, chat_completion_sources.AZURE_OPENAI].includes(settings.chat_completion_source) && /^(o1|o3|o4)/.test(model) ||
        (chat_completion_sources.OPENROUTER === settings.chat_completion_source && /^openai\/(o1|o3|o4)/.test(model))) {
        generate_data.max_completion_tokens = generate_data.max_tokens;
        delete generate_data.max_tokens;
        delete generate_data.logprobs;
        delete generate_data.top_logprobs;
        delete generate_data.stop;
        delete generate_data.logit_bias;
        delete generate_data.temperature;
        delete generate_data.top_p;
        delete generate_data.frequency_penalty;
        delete generate_data.presence_penalty;
        if (/^(openai\/)?(o1)/.test(model)) {
            generate_data.messages.forEach((msg) => {
                if (msg.role === 'system') {
                    msg.role = 'user';
                }
            });
            delete generate_data.n;
            delete generate_data.tools;
            delete generate_data.tool_choice;
        }
    }

    if (gptSources.includes(settings.chat_completion_source) && /gpt-5/.test(model)) {
        generate_data.max_completion_tokens = generate_data.max_tokens;
        delete generate_data.max_tokens;
        delete generate_data.logprobs;
        delete generate_data.top_logprobs;
        if (/gpt-5-chat-latest/.test(model)) {
            delete generate_data.tools;
            delete generate_data.tool_choice;
        } else if (/gpt-5\.(1|2|3|4)/.test(model) && !/chat-latest/.test(model) && !generate_data.reasoning_effort) {
            delete generate_data.frequency_penalty;
            delete generate_data.presence_penalty;
            delete generate_data.logit_bias;
            delete generate_data.stop;
        } else {
            delete generate_data.temperature;
            delete generate_data.top_p;
            delete generate_data.frequency_penalty;
            delete generate_data.presence_penalty;
            delete generate_data.logit_bias;
            delete generate_data.stop;
        }
    }

    if (gptSources.includes(settings.chat_completion_source) && /gpt-6-astra/.test(model)) {
        generate_data.max_completion_tokens = generate_data.max_tokens;
        delete generate_data.max_tokens;
        delete generate_data.temperature;
        delete generate_data.top_p;
        delete generate_data.logprobs;
        delete generate_data.top_logprobs;
    }

    // Claude Fable / Claude 5 models removed sampling parameters and reject them with HTTP 400,
    // including via OpenAI-compatible proxies. Unanchored to also match prefixed ids
    // like 'anthropic/claude-fable-5' or 'anthropic/claude-opus-5'.
    if (/claude-(fable|opus-5|sonnet-5)/.test(model)) {
        delete generate_data.temperature;
        delete generate_data.top_p;
        delete generate_data.top_k;
        delete generate_data.frequency_penalty;
        delete generate_data.presence_penalty;
        // Keep reasoning_effort for the native Claude source, where the backend maps it to
        // adaptive thinking; proxies may translate it into a thinking budget that these models reject.
        if (settings.chat_completion_source !== chat_completion_sources.CLAUDE) {
            delete generate_data.reasoning_effort;
        }
    }

    if (jsonSchema) {
        generate_data.json_schema = jsonSchema;
    }

    return { generate_data, stream, canMultiSwipe };
}
 let openai_messages_count=0, openai_msgs=[], openai_mes_examples=[];
 const default_main_prompt = 'Write {{char}}\'s next reply in a fictional chat between {{charIfNotGroup}} and {{user}}.';

const default_nsfw_prompt = '';

const default_jailbreak_prompt = '';

const default_enhance_definitions_prompt = 'If you have more knowledge of {{char}}, add to the character\'s lore and personality to enhance them but keep the Character Sheet\'s definitions absolute.';
 function formatWorldInfo(value, { wiFormat = null } = {}) {
    if (!value) {
        return '';
    }

    const format = wiFormat ?? oai_settings.wi_format;

    if (!format.trim()) {
        return value;
    }

    return stringFormat(format, value);
}

async function populationInjectionPrompts(prompts, messages) {
    let totalInsertedMessages = 0;

    const roleTypes = {
        'system': extension_prompt_roles.SYSTEM,
        'user': extension_prompt_roles.USER,
        'assistant': extension_prompt_roles.ASSISTANT,
    };

    const maxDepth = getExtensionPromptMaxDepth();
    for (let i = 0; i <= maxDepth; i++) {
        // Get prompts for current depth
        const depthPrompts = prompts.filter(prompt => prompt.injection_depth === i && prompt.content);

        const roleMessages = [];
        const separator = '\n';
        const wrap = false;

        // Group prompts by priority
        const extensionPromptsOrder = '100';
        const orderGroups = {
            [extensionPromptsOrder]: [],
        };
        for (const prompt of depthPrompts) {
            const order = prompt.injection_order ?? 100;
            if (!orderGroups[order]) {
                orderGroups[order] = [];
            }
            orderGroups[order].push(prompt);
        }

        // Process each order group in order (b - a = low to high ; a - b = high to low)
        const orders = Object.keys(orderGroups).sort((a, b) => +b - +a);
        for (const order of orders) {
            const orderPrompts = orderGroups[order];

            // Order of priority for roles (most important go lower)
            const roles = ['system', 'user', 'assistant'];
            for (const role of roles) {
                const rolePrompts = orderPrompts
                    .filter(prompt => prompt.role === role)
                    .map(x => x.content)
                    .join(separator);

                // Get extension prompt
                const extensionPrompt = order === extensionPromptsOrder
                    ? await getExtensionPrompt(extension_prompt_types.IN_CHAT, i, separator, roleTypes[role], wrap)
                    : '';
                const jointPrompt = [rolePrompts, extensionPrompt].filter(x => x).map(x => x.trim()).join(separator);

                if (jointPrompt && jointPrompt.length) {
                    roleMessages.push({ 'role': role, 'content': jointPrompt, injected: true });
                }
            }
        }

        if (roleMessages.length) {
            const injectIdx = i + totalInsertedMessages;
            messages.splice(injectIdx, 0, ...roleMessages);
            totalInsertedMessages += roleMessages.length;
        }
    }

    messages = messages.reverse();
    return messages;
}

async function populateChatHistory(messages, prompts, chatCompletion, type = null, cyclePrompt = null) {
    if (!prompts.has('chatHistory')) {
        return;
    }

    chatCompletion.add(new MessageCollection('chatHistory'), prompts.index('chatHistory'));

    // Reserve budget for new chat message
    const newChat = selected_group ? oai_settings.new_group_chat_prompt : oai_settings.new_chat_prompt;
    const newChatMessage = await Message.createAsync('system', substituteParams(newChat), 'newMainChat');
    chatCompletion.reserveBudget(newChatMessage);

    // Reserve budget for group nudge
    let groupNudgeMessage = null;
    const noGroupNudgeTypes = ['impersonate'];
    if (selected_group && prompts.has('groupNudge') && !noGroupNudgeTypes.includes(type)) {
        groupNudgeMessage = await Message.fromPromptAsync(prompts.get('groupNudge'));
        chatCompletion.reserveBudget(groupNudgeMessage);
    }

    // Reserve budget for continue nudge
    let continueMessageCollection = null;
    if (type === 'continue' && cyclePrompt && !oai_settings.continue_prefill) {
        const promptObject = {
            identifier: 'continueNudge',
            role: 'system',
            content: substituteParamsExtended(oai_settings.continue_nudge_prompt, { lastChatMessage: String(cyclePrompt).trim() }),
            system_prompt: true,
        };
        continueMessageCollection = new MessageCollection('continueNudge');
        const continueMessageIndex = messages.findLastIndex(x => !x.injected);
        if (continueMessageIndex >= 0) {
            const continueMessage = messages.splice(continueMessageIndex, 1)[0];
            const prompt = new Prompt(continueMessage);
            const chatMessage = await Message.fromPromptAsync(promptManager.preparePrompt(prompt));
            continueMessageCollection.add(chatMessage);
        }
        const continueNudgePrompt = new Prompt(promptObject);
        const preparedNudgePrompt = promptManager.preparePrompt(continueNudgePrompt);
        const continueNudgeMessage = await Message.fromPromptAsync(preparedNudgePrompt);
        continueMessageCollection.add(continueNudgeMessage);
        chatCompletion.reserveBudget(continueMessageCollection);
    }

    const lastChatPrompt = messages[messages.length - 1];
    const message = await Message.createAsync('user', oai_settings.send_if_empty, 'emptyUserMessageReplacement');
    if (lastChatPrompt && lastChatPrompt.role === 'assistant' && oai_settings.send_if_empty && chatCompletion.canAfford(message)) {
        chatCompletion.insert(message, 'chatHistory');
    }

    const imageInlining = isImageInliningSupported();
    const videoInlining = isVideoInliningSupported();
    const audioInlining = isAudioInliningSupported();
    const canUseTools = ToolManager.isToolCallingSupported();
    const includeSignature = isReasoningSignatureSupported();
    const isToolReasoningProvider = interleaved_reasoning_providers.includes(oai_settings.chat_completion_source);
    const toolReasoningMode = isToolReasoningProvider
        ? getEffectiveToolReasoningMode()
        : tool_reasoning_modes.DISABLED;
    const includeToolReasoning = toolReasoningMode !== tool_reasoning_modes.DISABLED;
    const lastUserIdx = messages.findLastIndex(x => x.role === 'user');

    // Insert chat messages as long as there is budget available
    const chatPool = [...messages].reverse();
    for (let index = 0; index < chatPool.length; index++) {
        const chatPrompt = chatPool[index];

        // We do not want to mutate the prompt
        const prompt = new Prompt(chatPrompt);
        prompt.identifier = `chatHistory-${messages.length - index}`;
        const chatMessage = await Message.fromPromptAsync(promptManager.preparePrompt(prompt));

        if (promptManager.serviceSettings.names_behavior === character_names_behavior.COMPLETION && prompt.name) {
            const messageName = promptManager.isValidName(prompt.name) ? prompt.name : promptManager.sanitizeName(prompt.name);
            await chatMessage.setName(messageName);
        }

        /**
         * Inline a media attachment into the chat message.
         * @param {MediaAttachment} media - The media attachment to inline.
         */
        async function inlineMediaAttachment(media) {
            if (!media || !media.url) {
                return;
            }
            if (!media.type) {
                media.type = MEDIA_TYPE.IMAGE;
            }
            if (imageInlining && media.type === MEDIA_TYPE.IMAGE) {
                await chatMessage.addImage(media.url);
            }
            if (videoInlining && media.type === MEDIA_TYPE.VIDEO) {
                await chatMessage.addVideo(media.url);
            }
            if (audioInlining && media.type === MEDIA_TYPE.AUDIO) {
                await chatMessage.addAudio(media.url);
            }
        }

        if (Array.isArray(chatPrompt.media) && chatPrompt.media.length) {
            if (chatPrompt.mediaDisplay === MEDIA_DISPLAY.LIST) {
                for (const media of chatPrompt.media) {
                    await inlineMediaAttachment(media);
                }
            }
            if (chatPrompt.mediaDisplay === MEDIA_DISPLAY.GALLERY) {
                const media = chatPrompt.media[chatPrompt.mediaIndex];
                await inlineMediaAttachment(media);
            }
        }

        if (canUseTools && Array.isArray(chatPrompt.invocations)) {
            const promptIdx = messages.indexOf(chatPrompt);
            const reasoningIsEligible = toolReasoningMode !== tool_reasoning_modes.DISABLED
                && promptIdx > lastUserIdx;
            let previousAssistantReasoning = '';
            if (reasoningIsEligible) {
                if (toolReasoningMode === tool_reasoning_modes.ACTIVE_CHAIN) {
                    // Strict chain mode: skip tool/tool-call messages, then use only the first assistant text boundary.
                    for (let idx = promptIdx - 1; idx > lastUserIdx; idx--) {
                        const candidate = messages[idx];
                        if (candidate?.role === 'tool') {
                            continue;
                        }
                        if (candidate?.role === 'assistant' && Array.isArray(candidate.invocations)) {
                            continue;
                        }
                        const hasAssistantText = candidate?.role === 'assistant'
                            && !Array.isArray(candidate.invocations)
                            && typeof candidate.content === 'string'
                            && candidate.content.trim().length > 0;
                        if (hasAssistantText) {
                            previousAssistantReasoning = String(candidate.reasoning ?? '');
                        }
                        break;
                    }
                } else if (toolReasoningMode === tool_reasoning_modes.SINCE_LAST_USER) {
                    // Broad mode: use the latest assistant text reasoning anywhere since the last user.
                    for (let idx = promptIdx - 1; idx > lastUserIdx; idx--) {
                        const candidate = messages[idx];
                        const hasAssistantText = candidate?.role === 'assistant'
                            && !Array.isArray(candidate.invocations)
                            && typeof candidate.content === 'string'
                            && candidate.content.trim().length > 0;
                        if (!hasAssistantText) {
                            continue;
                        }
                        const candidateReasoning = String(candidate.reasoning ?? '');
                        if (candidateReasoning) {
                            previousAssistantReasoning = candidateReasoning;
                            break;
                        }
                    }
                }
            }
            /** @type {import('./tool-calling.js').ToolInvocation[]} */
            const invocations = chatPrompt.invocations.map(invocation => {
                const clone = structuredClone(invocation);
                if (!reasoningIsEligible) {
                    delete clone.reasoning;
                } else if (previousAssistantReasoning && !clone.reasoning) {
                    // Fall back to adjacent assistant-text reasoning only when the invocation has none of its own.
                    clone.reasoning = previousAssistantReasoning;
                }
                return clone;
            });
            const toolCallMessage = await Message.createAsync(chatMessage.role, undefined, 'toolCall-' + chatMessage.identifier);
            const toolResultMessages = await Promise.all(invocations.slice().reverse().map((invocation) => Message.createAsync('tool', invocation.result || '[No content]', invocation.id)));
            await toolCallMessage.setToolCalls(invocations, includeSignature, includeToolReasoning);
            if (chatCompletion.canAffordAll([toolCallMessage, ...toolResultMessages])) {
                for (const resultMessage of toolResultMessages) {
                    chatCompletion.insertAtStart(resultMessage, 'chatHistory');
                }
                chatCompletion.insertAtStart(toolCallMessage, 'chatHistory');
            } else {
                break;
            }

            continue;
        }

        if (includeSignature && chatPrompt.signature) {
            chatMessage.signature = chatPrompt.signature;
        }

        if (chatCompletion.canAfford(chatMessage)) {
            chatCompletion.insertAtStart(chatMessage, 'chatHistory');
        } else {
            break;
        }
    }

    // RQ-1: use native token counts and preserve complete tool turns.
    await eventSource.emit('vc-chat-history-ready', { messages, chatCompletion, type });

    // Insert and free the bounded chat
    chatCompletion.freeBudget(newChatMessage);
    chatCompletion.insertAtStart(newChatMessage, 'chatHistory');

    // Reserve budget for group nudge
    if (selected_group && groupNudgeMessage) {
        chatCompletion.freeBudget(groupNudgeMessage);
        chatCompletion.insertAtEnd(groupNudgeMessage, 'chatHistory');
    }

    // Insert and free continue nudge
    if (type === 'continue' && continueMessageCollection) {
        chatCompletion.freeBudget(continueMessageCollection);
        chatCompletion.add(continueMessageCollection, -1);
    }
}

async function populateDialogueExamples(prompts, chatCompletion, messageExamples) {
    if (!prompts.has('dialogueExamples')) {
        return;
    }

    chatCompletion.add(new MessageCollection('dialogueExamples'), prompts.index('dialogueExamples'));
    if (Array.isArray(messageExamples) && messageExamples.length) {
        const newExampleChat = await Message.createAsync('system', substituteParams(oai_settings.new_example_chat_prompt), 'newChat');
        for (const dialogue of [...messageExamples]) {
            const dialogueIndex = messageExamples.indexOf(dialogue);
            const chatMessages = [];

            for (let promptIndex = 0; promptIndex < dialogue.length; promptIndex++) {
                const prompt = dialogue[promptIndex];
                const role = 'system';
                const content = prompt.content || '';
                const identifier = `dialogueExamples ${dialogueIndex}-${promptIndex}`;

                const chatMessage = await Message.createAsync(role, content, identifier);
                await chatMessage.setName(prompt.name);
                chatMessages.push(chatMessage);
            }

            if (!chatCompletion.canAffordAll([newExampleChat, ...chatMessages])) {
                break;
            }

            chatCompletion.insert(newExampleChat, 'dialogueExamples');
            for (const chatMessage of chatMessages) {
                chatCompletion.insert(chatMessage, 'dialogueExamples');
            }
        }
    }
}

function getPromptPosition(position) {
    if (position == extension_prompt_types.BEFORE_PROMPT) {
        return 'start';
    }

    if (position == extension_prompt_types.IN_PROMPT) {
        return 'end';
    }

    return false;
}

function getPromptRole(role) {
    switch (role) {
        case extension_prompt_roles.SYSTEM:
            return 'system';
        case extension_prompt_roles.USER:
            return 'user';
        case extension_prompt_roles.ASSISTANT:
            return 'assistant';
        default:
            return 'system';
    }
}

async function populateChatCompletion(prompts, chatCompletion, { bias, quietPrompt, quietImage, type, cyclePrompt, messages, messageExamples }) {
    // Helper function for preparing a prompt, that already exists within the prompt collection, for completion
    const addToChatCompletion = async (source, target = null) => {
        // We need the prompts array to determine a position for the source.
        if (false === prompts.has(source)) return;

        if (promptManager.isPromptDisabledForActiveCharacter(source) && source !== 'main') {
            promptManager.log(`Skipping prompt ${source} because it is disabled`);
            return;
        }

        const prompt = prompts.get(source);

        if (prompt.injection_position === INJECTION_POSITION.ABSOLUTE) {
            promptManager.log(`Skipping prompt ${source} because it is an absolute prompt`);
            return;
        }

        const index = target ? prompts.index(target) : prompts.index(source);
        const collection = new MessageCollection(source);
        const message = await Message.fromPromptAsync(prompt);
        collection.add(message);
        chatCompletion.add(collection, index);
    };

    chatCompletion.reserveBudget(3); // every reply is primed with <|start|>assistant<|message|>
    // Character and world information
    await addToChatCompletion('worldInfoBefore');
    await addToChatCompletion('main');
    await addToChatCompletion('worldInfoAfter');
    await addToChatCompletion('charDescription');
    await addToChatCompletion('charPersonality');
    await addToChatCompletion('scenario');
    await addToChatCompletion('personaDescription');

    // Collection of control prompts that will always be positioned last
    chatCompletion.setOverriddenPrompts(prompts.overriddenPrompts);
    const controlPrompts = new MessageCollection('controlPrompts');

    const impersonateMessage = await Message.fromPromptAsync(prompts.get('impersonate')) ?? null;
    if (type === 'impersonate') controlPrompts.add(impersonateMessage);

    // Add quiet prompt to control prompts
    // This should always be last, even in control prompts. Add all further control prompts BEFORE this prompt
    const quietPromptMessage = await Message.fromPromptAsync(prompts.get('quietPrompt')) ?? null;
    if (quietPromptMessage && quietPromptMessage.content) {
        if (isImageInliningSupported() && quietImage) {
            await quietPromptMessage.addImage(quietImage);
        }

        controlPrompts.add(quietPromptMessage);
    }

    chatCompletion.reserveBudget(controlPrompts);

    // Add ordered system and user prompts
    const systemPrompts = ['nsfw', 'jailbreak'];
    const userRelativePrompts = prompts.collection
        .filter((prompt) => false === prompt.system_prompt && prompt.injection_position !== INJECTION_POSITION.ABSOLUTE)
        .reduce((acc, prompt) => {
            acc.push(prompt.identifier);
            return acc;
        }, []);
    const absolutePrompts = prompts.collection
        .filter((prompt) => prompt.injection_position === INJECTION_POSITION.ABSOLUTE)
        .reduce((acc, prompt) => {
            acc.push(prompt);
            return acc;
        }, []);

    for (const identifier of [...systemPrompts, ...userRelativePrompts]) {
        await addToChatCompletion(identifier);
    }

    // Add enhance definition instruction
    if (prompts.has('enhanceDefinitions')) await addToChatCompletion('enhanceDefinitions');

    // Bias
    if (bias && bias.trim().length) await addToChatCompletion('bias');

    const injectToMain = async (/** @type {Prompt} */ prompt, /** @type {string|number} */ position) => {
        if (chatCompletion.has('main')) {
            const message = await Message.fromPromptAsync(prompt);
            chatCompletion.insert(message, 'main', position);
        } else {
            // Convert the relative prompt to an injection and place it relative to main prompt
            // Keeping prompts in the same order bucket will squash them together during in-chat injection
            const indexOfMain = absolutePrompts.findIndex(p => p.identifier === 'main');
            if (indexOfMain >= 0) {
                const main = absolutePrompts[indexOfMain];
                const promptCopy = new Prompt(prompt);
                promptCopy.role = main.role;
                promptCopy.injection_position = main.injection_position;
                promptCopy.injection_depth = main.injection_depth;
                promptCopy.injection_order = main.injection_order;
                const newIndex = position === 'end' ? indexOfMain + 1 : indexOfMain;
                absolutePrompts.splice(newIndex, 0, promptCopy);
            }
        }
    };

    const knownPrompts = [
        'summary',
        'authorsNote',
        'vectorsMemory',
        'vectorsDataBank',
        'smartContext',
    ];

    // Known relative extension prompts
    for (const key of knownPrompts) {
        if (prompts.has(key)) {
            const prompt = prompts.get(key);
            if (prompt.position) {
                await injectToMain(prompt, prompt.position);
            }
        }
    }

    // Other relative extension prompts
    for (const prompt of prompts.collection.filter(p => p.extension && p.position)) {
        await injectToMain(prompt, prompt.position);
    }

    // Pre-allocation of tokens for tool data
    if (ToolManager.canPerformToolCalls(type)) {
        const toolData = {};
        await ToolManager.registerFunctionToolsOpenAI(toolData);
        const toolMessage = [{ role: 'user', content: JSON.stringify(toolData) }];
        const toolTokens = await tokenHandler.countAsync(toolMessage);
        chatCompletion.reserveBudget(toolTokens);
    }

    // Displace the message to be continued from its original position before performing in-chat injections
    // In case if it is an assistant message, we want to prepend the users assistant prefill on the message
    if (type === 'continue' && oai_settings.continue_prefill && messages.length) {
        const chatMessage = messages.shift();
        const isAssistantRole = chatMessage.role === 'assistant';
        const supportsAssistantPrefill = oai_settings.chat_completion_source === chat_completion_sources.CLAUDE;
        const namesInCompletion = oai_settings.names_behavior === character_names_behavior.COMPLETION;
        const assistantPrefill = isAssistantRole && supportsAssistantPrefill ? substituteParams(oai_settings.assistant_prefill) : '';
        const messageContent = [assistantPrefill, chatMessage.content].filter(x => x).join('\n\n');
        const continueMessage = await Message.createAsync(chatMessage.role, messageContent, 'continuePrefill');
        chatMessage.name && namesInCompletion && await continueMessage.setName(promptManager.sanitizeName(chatMessage.name));
        controlPrompts.add(continueMessage);
        chatCompletion.reserveBudget(continueMessage);
    }

    // Add in-chat injections
    messages = await populationInjectionPrompts(absolutePrompts, messages);

    // Decide whether dialogue examples should always be added
    if (power_user.pin_examples) {
        await populateDialogueExamples(prompts, chatCompletion, messageExamples);
        await populateChatHistory(messages, prompts, chatCompletion, type, cyclePrompt);
    } else {
        await populateChatHistory(messages, prompts, chatCompletion, type, cyclePrompt);
        await populateDialogueExamples(prompts, chatCompletion, messageExamples);
    }

    chatCompletion.freeBudget(controlPrompts);
    if (controlPrompts.collection.length) chatCompletion.add(controlPrompts);
}

async function preparePromptsForChatCompletion({ scenario, charPersonality, name2, worldInfoBefore, worldInfoAfter, charDescription, quietPrompt, bias, extensionPrompts, systemPromptOverride, jailbreakPromptOverride, type }) {
    const scenarioText = scenario && oai_settings.scenario_format ? substituteParams(oai_settings.scenario_format) : (scenario || '');
    const charPersonalityText = charPersonality && oai_settings.personality_format ? substituteParams(oai_settings.personality_format) : (charPersonality || '');
    const groupNudge = substituteParams(oai_settings.group_nudge_prompt);
    const impersonationPrompt = oai_settings.impersonation_prompt ? substituteParams(oai_settings.impersonation_prompt) : '';

    // Create entries for system prompts
    const systemPrompts = [
        // Ordered prompts for which a marker should exist
        { role: 'system', content: formatWorldInfo(worldInfoBefore), identifier: 'worldInfoBefore' },
        { role: 'system', content: formatWorldInfo(worldInfoAfter), identifier: 'worldInfoAfter' },
        { role: 'system', content: charDescription, identifier: 'charDescription' },
        { role: 'system', content: charPersonalityText, identifier: 'charPersonality' },
        { role: 'system', content: scenarioText, identifier: 'scenario' },
        // Unordered prompts without marker
        { role: 'system', content: impersonationPrompt, identifier: 'impersonate' },
        { role: 'system', content: quietPrompt, identifier: 'quietPrompt' },
        { role: 'system', content: groupNudge, identifier: 'groupNudge' },
        { role: 'assistant', content: bias, identifier: 'bias' },
    ];

    // Tavern Extras - Summary
    const summary = extensionPrompts['1_memory'];
    if (summary && summary.value) systemPrompts.push({
        role: getPromptRole(summary.role),
        content: summary.value,
        identifier: 'summary',
        position: getPromptPosition(summary.position),
    });

    // Authors Note
    const authorsNote = extensionPrompts['2_floating_prompt'];
    if (authorsNote && authorsNote.value) systemPrompts.push({
        role: getPromptRole(authorsNote.role),
        content: authorsNote.value,
        identifier: 'authorsNote',
        position: getPromptPosition(authorsNote.position),
    });

    // Vectors Memory
    const vectorsMemory = extensionPrompts['3_vectors'];
    if (vectorsMemory && vectorsMemory.value) systemPrompts.push({
        role: 'system',
        content: vectorsMemory.value,
        identifier: 'vectorsMemory',
        position: getPromptPosition(vectorsMemory.position),
    });

    const vectorsDataBank = extensionPrompts['4_vectors_data_bank'];
    if (vectorsDataBank && vectorsDataBank.value) systemPrompts.push({
        role: getPromptRole(vectorsDataBank.role),
        content: vectorsDataBank.value,
        identifier: 'vectorsDataBank',
        position: getPromptPosition(vectorsDataBank.position),
    });

    // Smart Context (ChromaDB)
    const smartContext = extensionPrompts.chromadb;
    if (smartContext && smartContext.value) systemPrompts.push({
        role: 'system',
        content: smartContext.value,
        identifier: 'smartContext',
        position: getPromptPosition(smartContext.position),
    });

    // Persona Description
    if (power_user.persona_description && power_user.persona_description_position === persona_description_positions.IN_PROMPT) {
        systemPrompts.push({ role: 'system', content: power_user.persona_description, identifier: 'personaDescription' });
    }

    const knownExtensionPrompts = [
        '1_memory',
        '2_floating_prompt',
        '3_vectors',
        '4_vectors_data_bank',
        'chromadb',
        'PERSONA_DESCRIPTION',
        'QUIET_PROMPT',
        'DEPTH_PROMPT',
    ];

    // Anything that is not a known extension prompt
    for (const key in extensionPrompts) {
        if (Object.hasOwn(extensionPrompts, key)) {
            const prompt = extensionPrompts[key];
            if (knownExtensionPrompts.includes(key)) continue;
            if (!extensionPrompts[key].value) continue;
            if (![extension_prompt_types.BEFORE_PROMPT, extension_prompt_types.IN_PROMPT].includes(prompt.position)) continue;

            const hasFilter = typeof prompt.filter === 'function';
            if (hasFilter && !await prompt.filter()) continue;

            systemPrompts.push({
                identifier: key.replace(/\W/g, '_'),
                position: getPromptPosition(prompt.position),
                role: getPromptRole(prompt.role),
                content: prompt.value,
                extension: true,
            });
        }
    }

    // This is the prompt order defined by the user
    const prompts = promptManager.getPromptCollection(type);

    // Merge system prompts with prompt manager prompts
    systemPrompts.forEach(prompt => {
        const collectionPrompt = prompts.get(prompt.identifier);

        // Apply system prompt role/depth overrides if they set in the prompt manager
        if (collectionPrompt) {
            // In-Chat / Relative
            prompt.injection_position = collectionPrompt.injection_position ?? prompt.injection_position;
            // Depth for In-Chat
            prompt.injection_depth = collectionPrompt.injection_depth ?? prompt.injection_depth;
            // Priority for In-Chat
            prompt.injection_order = collectionPrompt.injection_order ?? prompt.injection_order;
            // Role (system, user, assistant)
            prompt.role = collectionPrompt.role ?? prompt.role;
        }

        const newPrompt = promptManager.preparePrompt(prompt);
        const markerIndex = prompts.index(prompt.identifier);

        if (-1 !== markerIndex) prompts.collection[markerIndex] = newPrompt;
        else prompts.add(newPrompt);
    });

    // Apply character-specific main prompt
    const systemPrompt = prompts.get('main') ?? null;
    const isSystemPromptDisabled = promptManager.isPromptDisabledForActiveCharacter('main');
    if (systemPromptOverride && systemPrompt && systemPrompt.forbid_overrides !== true && !isSystemPromptDisabled) {
        const mainOriginalContent = systemPrompt.content;
        systemPrompt.content = systemPromptOverride;
        const mainReplacement = promptManager.preparePrompt(systemPrompt, mainOriginalContent);
        prompts.override(mainReplacement, prompts.index('main'));
    }

    // Apply character-specific jailbreak
    const jailbreakPrompt = prompts.get('jailbreak') ?? null;
    const isJailbreakPromptDisabled = promptManager.isPromptDisabledForActiveCharacter('jailbreak');
    if (jailbreakPromptOverride && jailbreakPrompt && jailbreakPrompt.forbid_overrides !== true && !isJailbreakPromptDisabled) {
        const jbOriginalContent = jailbreakPrompt.content;
        jailbreakPrompt.content = jailbreakPromptOverride;
        const jbReplacement = promptManager.preparePrompt(jailbreakPrompt, jbOriginalContent);
        prompts.override(jbReplacement, prompts.index('jailbreak'));
    }

    return prompts;
}

async function prepareOpenAIMessages({
    name2,
    charDescription,
    charPersonality,
    scenario,
    worldInfoBefore,
    worldInfoAfter,
    bias,
    type,
    quietPrompt,
    quietImage,
    extensionPrompts,
    cyclePrompt,
    systemPromptOverride,
    jailbreakPromptOverride,
    messages,
    messageExamples,
}, dryRun) {
    // Without a character selected, there is no way to accurately calculate tokens
    if (!promptManager.activeCharacter && dryRun) return [null, false];

    const chatCompletion = new ChatCompletion();
    if (power_user.console_log_prompts) chatCompletion.enableLogging();

    const userSettings = promptManager.serviceSettings;
    chatCompletion.setTokenBudget(userSettings.openai_max_context, userSettings.openai_max_tokens);

    try {
        // Merge markers and ordered user prompts with system prompts
        const prompts = await preparePromptsForChatCompletion({
            scenario,
            charPersonality,
            name2,
            worldInfoBefore,
            worldInfoAfter,
            charDescription,
            quietPrompt,
            bias,
            extensionPrompts,
            systemPromptOverride,
            jailbreakPromptOverride,
            type,
        });

        // Fill the chat completion with as much context as the budget allows
        await populateChatCompletion(prompts, chatCompletion, { bias, quietPrompt, quietImage, type, cyclePrompt, messages, messageExamples });
    } catch (error) {
        if (error instanceof TokenBudgetExceededError) {
            toastr.error(t`Mandatory prompts exceed the context size.`);
            chatCompletion.log('Mandatory prompts exceed the context size.');
            promptManager.error = t`Not enough free tokens for mandatory prompts. Raise your token limit or disable custom prompts.`;
        } else if (error instanceof InvalidCharacterNameError) {
            toastr.warning(t`An error occurred while counting tokens: Invalid character name`);
            chatCompletion.log('Invalid character name');
            promptManager.error = t`The name of at least one character contained whitespaces or special characters. Please check your user and character name.`;
        } else {
            toastr.error(t`An unknown error occurred while counting tokens. Further information may be available in console.`);
            chatCompletion.log('----- Unexpected error while preparing prompts -----');
            chatCompletion.log(error);
            chatCompletion.log(error.stack);
            chatCompletion.log('----------------------------------------------------');
        }
    } finally {
        // Pass chat completion to prompt manager for inspection
        promptManager.setChatCompletion(chatCompletion);

        if (oai_settings.squash_system_messages && dryRun == false) {
            await chatCompletion.squashSystemMessages();
        }

        // All information is up-to-date, render.
        if (false === dryRun) promptManager.render(false);
    }

    const chat = chatCompletion.getChat();

    const eventData = { chat, dryRun };
    await eventSource.emit(event_types.CHAT_COMPLETION_PROMPT_READY, eventData);

    openai_messages_count = chat.filter(x => !x?.tool_calls && ['user', 'assistant', 'tool'].includes(x?.role)).length || 0;

    return [chat, promptManager.tokenHandler.counts];
}

class TokenHandler {
    /**
     * @param {(messages: object[] | object, full?: boolean) => Promise<number>} countTokenAsyncFn Function to count tokens
     */
    constructor(countTokenAsyncFn) {
        this.countTokenAsyncFn = countTokenAsyncFn;
        this.counts = {
            'start_chat': 0,
            'prompt': 0,
            'bias': 0,
            'nudge': 0,
            'jailbreak': 0,
            'impersonate': 0,
            'examples': 0,
            'conversation': 0,
        };
    }

    getCounts() {
        return this.counts;
    }

    resetCounts() {
        Object.keys(this.counts).forEach((key) => this.counts[key] = 0);
    }

    setCounts(counts) {
        this.counts = counts;
    }

    uncount(value, type) {
        this.counts[type] -= value;
    }

    /**
     * Count tokens for a message or messages.
     * @param {object|any[]} messages Messages to count tokens for
     * @param {boolean} [full] Count full tokens
     * @param {string} [type] Identifier for the token count
     * @returns {Promise<number>} The token count
     */
    async countAsync(messages, full, type) {
        const token_count = await this.countTokenAsyncFn(messages, full);
        this.counts[type] += token_count;

        return token_count;
    }

    getTokensForIdentifier(identifier) {
        return this.counts[identifier] ?? 0;
    }

    getTotal() {
        return Object.values(this.counts).reduce((a, b) => a + (isNaN(b) ? 0 : b), 0);
    }

    log() {
        console.table({ ...this.counts, 'total': this.getTotal() });
    }
}

class IdentifierNotFoundError extends Error {
    constructor(identifier) {
        super(`Identifier ${identifier} not found.`);
        this.name = 'IdentifierNotFoundError';
    }
}

class TokenBudgetExceededError extends Error {
    constructor(identifier = '') {
        super(`Token budged exceeded. Message: ${identifier}`);
        this.name = 'TokenBudgetExceeded';
    }
}

class InvalidCharacterNameError extends Error {
    constructor(identifier = '') {
        super(`Invalid character name. Message: ${identifier}`);
        this.name = 'InvalidCharacterName';
    }
}

class Message {
    static tokensPerImage = 85;

    /** @type {number} */
    tokens;
    /** @type {string} */
    identifier;
    /** @type {string} */
    role;
    /** @type {string|any[]} */
    content;
    /** @type {string} */
    name;
    /** @type {object} */
    tool_call = null;
    /** @type {string?} */
    signature = null;
    /** @type {string?} */
    reasoning = null;

    /**
     * @constructor
     * @param {string} role - The role of the entity creating the message.
     * @param {string} content - The actual content of the message.
     * @param {string} identifier - A unique identifier for the message.
     * @private Don't use this constructor directly. Use createAsync instead.
     */
    constructor(role, content, identifier) {
        this.identifier = identifier;
        this.role = role;
        this.content = content;

        if (!this.role) {
            console.log(`Message role not set, defaulting to 'system' for identifier '${this.identifier}'`);
            this.role = 'system';
        }

        this.tokens = 0;
    }

    /**
     * Create a new Message instance.
     * @param {string} role
     * @param {string} content
     * @param {string} identifier
     * @returns {Promise<Message>} Message instance
     */
    static async createAsync(role, content, identifier) {
        const message = new Message(role, content, identifier);

        if (typeof message.content === 'string' && message.content.length > 0) {
            message.tokens = await tokenHandler.countAsync({ role: message.role, content: message.content });
        }

        return message;
    }

    /**
     * Reconstruct the message from a tool invocation.
     * @param {import('./tool-calling.js').ToolInvocation[]} invocations - The tool invocations to reconstruct the message from.
     * @param {boolean} includeSignature Whether to include the signature in the tool calls.
     * @param {boolean} includeReasoning Whether to include plaintext reasoning fallback.
     * @returns {Promise<void>}
     */
    async setToolCalls(invocations, includeSignature, includeReasoning = false) {
        this.tool_calls = invocations.map(i => ({
            id: i.id,
            type: 'function',
            function: {
                arguments: i.parameters,
                name: i.name,
            },
            ...(includeSignature && i.signature ? { signature: i.signature } : {}),
        }));
        const fallbackReasoning = invocations.find(i => typeof i.reasoning === 'string' && i.reasoning.length > 0)?.reasoning || null;
        this.reasoning = includeReasoning ? fallbackReasoning : null;
        this.tokens = await tokenHandler.countAsync({
            role: this.role,
            tool_calls: JSON.stringify(this.tool_calls),
            ...(this.reasoning ? { reasoning: this.reasoning } : {}),
        });
    }

    /**
     * Add a name to the message.
     * @param {string} name Name to set for the message.
     * @returns {Promise<void>}
     */
    async setName(name) {
        this.name = name;
        this.tokens = await tokenHandler.countAsync({ role: this.role, content: this.content, name: this.name });
    }

    /**
     * Ensures the content is an array. If it's a string, converts it to an array with a single text object.
     * @returns {any[]} Content as an array
     */
    ensureContentIsArray() {
        const textContent = this.content;
        if (!Array.isArray(this.content)) {
            this.content = [];
            if (typeof textContent === 'string') {
                this.content.push({ type: 'text', text: textContent });
            }
        }
        return this.content;
    }

    /**
     * Adds an image to the message.
     * @param {string} image Image URL or Data URL.
     * @returns {Promise<void>}
     */
    async addImage(image) {
        this.content = this.ensureContentIsArray();
        const isDataUrl = isDataURL(image);
        if (!isDataUrl) {
            try {
                const response = await fetch(image, { method: 'GET', cache: 'force-cache' });
                if (!response.ok) throw new Error('Failed to fetch image');
                const blob = await response.blob();
                image = await getBase64Async(blob);
            } catch (error) {
                console.error('Image adding skipped', error);
                return;
            }
        }

        image = await this.compressImage(image);

        const quality = oai_settings.inline_image_quality || default_settings.inline_image_quality;
        this.content.push({ type: 'image_url', image_url: { 'url': image, 'detail': quality } });

        try {
            const tokens = await this.getImageTokenCost(image, quality);
            this.tokens += tokens;
        } catch (error) {
            this.tokens += Message.tokensPerImage;
            console.error('Failed to get image token cost', error);
        }
    }

    /**
     * Adds a video to the message.
     * @param {string} video Video URL or Data URL.
     * @returns {Promise<void>}
     */
    async addVideo(video) {
        this.content = this.ensureContentIsArray();
        const isDataUrl = isDataURL(video);
        if (!isDataUrl) {
            try {
                const response = await fetch(video, { method: 'GET', cache: 'force-cache' });
                if (!response.ok) throw new Error('Failed to fetch video');
                const blob = await response.blob();
                video = await getBase64Async(blob);
            } catch (error) {
                console.error('Video adding skipped', error);
                return;
            }
        }

        // Note: No compression for videos (unlike images)
        const quality = oai_settings.inline_image_quality || default_settings.inline_image_quality;
        this.content.push({ type: 'video_url', video_url: { 'url': video, 'detail': quality } });

        try {
            // Using Gemini calculation (263 tokens per second)
            const duration = await getVideoDurationFromDataURL(video);
            this.tokens += 263 * Math.ceil(duration);
        } catch (error) {
            // Convservative estimate for video token cost without knowing duration
            this.tokens += 263 * 40; // ~40 second video (60 seconds max)
            console.error('Failed to get video token cost', error);
        }
    }

    /**
     * Adds a audio to the message.
     * @param {string} audio Audio URL or Data URL.
     * @returns {Promise<void>}
     */
    async addAudio(audio) {
        this.content = this.ensureContentIsArray();
        const isDataUrl = isDataURL(audio);
        if (!isDataUrl) {
            try {
                const response = await fetch(audio, { method: 'GET', cache: 'force-cache' });
                if (!response.ok) throw new Error('Failed to fetch audio');
                const blob = await response.blob();
                audio = await getBase64Async(blob);
            } catch (error) {
                console.error('Audio adding skipped', error);
                return;
            }
        }

        this.content.push({ type: 'audio_url', audio_url: { 'url': audio } });

        try {
            // Using Gemini calculation (32 tokens per second)
            const duration = await getAudioDurationFromDataURL(audio);
            this.tokens += 32 * Math.ceil(duration);
        } catch (error) {
            // Estimate for audio token cost without knowing duration
            const tokens = 32 * 300; // ~5 minute audio
            this.tokens += tokens;
            console.error('Failed to get audio token cost', error);
        }
    }

    /**
     * Compress an image if it exceeds the size threshold for the current chat completion source.
     * @param {string} image Data URL of the image.
     * @returns {Promise<string>} Compressed image as a Data URL.
     */
    async compressImage(image) {
        const compressImageSources = [
            chat_completion_sources.OPENROUTER,
            chat_completion_sources.MAKERSUITE,
            chat_completion_sources.MISTRALAI,
            chat_completion_sources.VERTEXAI,
        ];
        const sizeThreshold = 2 * 1024 * 1024;
        const dataSize = image.length * 0.75;
        const safeMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
        const mimeType = image?.split(';')?.[0]?.split(':')?.[1];
        if (compressImageSources.includes(oai_settings.chat_completion_source) && dataSize > sizeThreshold) {
            const maxSide = 2048;
            image = await createThumbnail(image, maxSide, maxSide);
        } else if (!safeMimeTypes.includes(mimeType)) {
            image = await createThumbnail(image, null, null);
        }
        return image;
    }

    /**
     * Get the token cost of an image.
     * @param {string} dataUrl Data URL of the image.
     * @param {string} quality String representing the quality of the image. Can be 'low', 'auto', or 'high'.
     * @returns {Promise<number>} The token cost of the image.
     */
    async getImageTokenCost(dataUrl, quality) {
        if (quality === 'low') {
            return Message.tokensPerImage;
        }

        const size = await getImageSizeFromDataURL(dataUrl);

        // If the image is small enough, we can use the low quality token cost
        if (quality === 'auto' && size.width <= 512 && size.height <= 512) {
            return Message.tokensPerImage;
        }

        /*
        * Images are first scaled to fit within a 2048 x 2048 square, maintaining their aspect ratio.
        * Then, they are scaled such that the shortest side of the image is 768px long.
        * Finally, we count how many 512px squares the image consists of.
        * Each of those squares costs 170 tokens. Another 85 tokens are always added to the final total.
        * https://platform.openai.com/docs/guides/vision/calculating-costs
        */

        const scale = 2048 / Math.min(size.width, size.height);
        const scaledWidth = Math.round(size.width * scale);
        const scaledHeight = Math.round(size.height * scale);

        const finalScale = 768 / Math.min(scaledWidth, scaledHeight);
        const finalWidth = Math.round(scaledWidth * finalScale);
        const finalHeight = Math.round(scaledHeight * finalScale);

        const squares = Math.ceil(finalWidth / 512) * Math.ceil(finalHeight / 512);
        const tokens = squares * 170 + 85;
        return tokens;
    }

    /**
     * Create a new Message instance from a prompt asynchronously.
     * @static
     * @param {Object} prompt - The prompt object.
     * @returns {Promise<Message>} A new instance of Message.
     */
    static fromPromptAsync(prompt) {
        return Message.createAsync(prompt.role, prompt.content, prompt.identifier);
    }

    /**
     * Returns the number of tokens in the message.
     * @returns {number} Number of tokens in the message.
     */
    getTokens() { return this.tokens; }
}

class MessageCollection {
    collection = [];
    identifier;

    /**
     * @constructor
     * @param {string} identifier - A unique identifier for the MessageCollection.
     * @param {...Object} items - An array of Message or MessageCollection instances to be added to the collection.
     */
    constructor(identifier, ...items) {
        for (let item of items) {
            if (!(item instanceof Message || item instanceof MessageCollection)) {
                throw new Error('Only Message and MessageCollection instances can be added to MessageCollection');
            }
        }

        this.collection.push(...items);
        this.identifier = identifier;
    }

    /**
     * Get chat in the format of {role, name, content, tool_calls}.
     * @returns {Array} Array of objects with role, name, and content properties.
     */
    getChat() {
        return this.collection.reduce((acc, message) => {
            if (message.content || message.tool_calls) {
                acc.push({
                    role: message.role,
                    content: message.content,
                    ...(message.name && { name: message.name }),
                    ...(message.tool_calls && { tool_calls: message.tool_calls }),
                    ...(message.role === 'tool' && { tool_call_id: message.identifier }),
                    ...(message.signature && { signature: message.signature }),
                    ...(message.reasoning && { reasoning: message.reasoning }),
                });
            }
            return acc;
        }, []);
    }

    /**
     * Method to get the collection of messages.
     * @returns {Array} The collection of Message instances.
     */
    getCollection() {
        return this.collection;
    }

    /**
     * Add a new item to the collection.
     * @param {Object} item - The Message or MessageCollection instance to be added.
     */
    add(item) {
        this.collection.push(item);
    }

    /**
     * Get an item from the collection by its identifier.
     * @param {string} identifier - The identifier of the item to be found.
     * @returns {Object} The found item, or undefined if no item was found.
     */
    getItemByIdentifier(identifier) {
        return this.collection.find(item => item?.identifier === identifier);
    }

    /**
     * Check if an item with the given identifier exists in the collection.
     * @param {string} identifier - The identifier to check.
     * @returns {boolean} True if an item with the given identifier exists, false otherwise.
     */
    hasItemWithIdentifier(identifier) {
        return this.collection.some(message => message.identifier === identifier);
    }

    /**
     * Get the total number of tokens in the collection.
     * @returns {number} The total number of tokens.
     */
    getTokens() {
        return this.collection.reduce((tokens, message) => tokens + message.getTokens(), 0);
    }

    /**
     * Combines message collections into a single collection.
     * @returns {Message[]} The collection of messages flattened into a single array.
     */
    flatten() {
        return this.collection.reduce((acc, message) => {
            if (message instanceof MessageCollection) {
                acc.push(...message.flatten());
            } else {
                acc.push(message);
            }
            return acc;
        }, []);
    }
}

class ChatCompletion {
    /**
     * Combines consecutive system messages into one if they have no name attached.
     * @returns {Promise<void>}
     */
    async squashSystemMessages() {
        const excludeList = ['newMainChat', 'newChat', 'groupNudge'];
        this.messages.collection = this.messages.flatten();

        let lastMessage = null;
        let squashedMessages = [];

        for (let message of this.messages.collection) {
            // Force exclude empty messages
            if (message.role === 'system' && !message.content) {
                continue;
            }

            const shouldSquash = (message) => {
                return !excludeList.includes(message.identifier) && message.role === 'system' && !message.name;
            };

            if (shouldSquash(message)) {
                if (lastMessage && shouldSquash(lastMessage)) {
                    lastMessage.content += '\n' + message.content;
                    lastMessage.tokens = await tokenHandler.countAsync({ role: lastMessage.role, content: lastMessage.content });
                } else {
                    squashedMessages.push(message);
                    lastMessage = message;
                }
            } else {
                squashedMessages.push(message);
                lastMessage = message;
            }
        }

        this.messages.collection = squashedMessages;
    }

    /**
     * Initializes a new instance of ChatCompletion.
     * Sets up the initial token budget and a new message collection.
     */
    constructor() {
        this.tokenBudget = 0;
        this.messages = new MessageCollection('root');
        this.loggingEnabled = false;
        this.overriddenPrompts = [];
    }

    /**
     * Retrieves all messages.
     *
     * @returns {MessageCollection} The MessageCollection instance holding all messages.
     */
    getMessages() {
        return this.messages;
    }

    /**
     * Calculates and sets the token budget based on context and response.
     *
     * @param {number} context - Number of tokens in the context.
     * @param {number} response - Number of tokens in the response.
     */
    setTokenBudget(context, response) {
        this.log(`Prompt tokens: ${context}`);
        this.log(`Completion tokens: ${response}`);

        this.tokenBudget = context - response;

        this.log(`Token budget: ${this.tokenBudget}`);
    }

    /**
     * Adds a message or message collection to the collection.
     *
     * @param {Message|MessageCollection} collection - The message or message collection to add.
     * @param {number|null} position - The position at which to add the collection.
     * @returns {ChatCompletion} The current instance for chaining.
     */
    add(collection, position = null) {
        this.validateMessageCollection(collection);
        this.checkTokenBudget(collection, collection.identifier);

        if (null !== position && -1 !== position) {
            this.messages.collection[position] = collection;
        } else {
            this.messages.collection.push(collection);
        }

        this.decreaseTokenBudgetBy(collection.getTokens());

        this.log(`Added ${collection.identifier}. Remaining tokens: ${this.tokenBudget}`);

        return this;
    }

    /**
     * Inserts a message at the start of the specified collection.
     *
     * @param {Message} message - The message to insert.
     * @param {string} identifier - The identifier of the collection where to insert the message.
     */
    insertAtStart(message, identifier) {
        this.insert(message, identifier, 'start');
    }

    /**
     * Inserts a message at the end of the specified collection.
     *
     * @param {Message} message - The message to insert.
     * @param {string} identifier - The identifier of the collection where to insert the message.
     */
    insertAtEnd(message, identifier) {
        this.insert(message, identifier, 'end');
    }

    /**
     * Inserts a message at the specified position in the specified collection.
     *
     * @param {Message} message - The message to insert.
     * @param {string} identifier - The identifier of the collection where to insert the message.
     * @param {string|number} position - The position at which to insert the message ('start' or 'end').
     */
    insert(message, identifier, position = 'end') {
        this.validateMessage(message);
        this.checkTokenBudget(message, message.identifier);

        const index = this.findMessageIndex(identifier);
        if (message.content || message.tool_calls) {
            if ('start' === position) this.messages.collection[index].collection.unshift(message);
            else if ('end' === position) this.messages.collection[index].collection.push(message);
            else if (typeof position === 'number') this.messages.collection[index].collection.splice(position, 0, message);

            this.decreaseTokenBudgetBy(message.getTokens());

            this.log(`Inserted ${message.identifier} into ${identifier}. Remaining tokens: ${this.tokenBudget}`);
        }
    }

    /**
     * Remove the last item of the collection
     *
     * @param identifier
     */
    removeLastFrom(identifier) {
        const index = this.findMessageIndex(identifier);
        const message = this.messages.collection[index].collection.pop();

        if (!message) {
            this.log(`No message to remove from ${identifier}`);
            return;
        }

        this.increaseTokenBudgetBy(message.getTokens());

        this.log(`Removed ${message.identifier} from ${identifier}. Remaining tokens: ${this.tokenBudget}`);
    }

    /**
     * Checks if the token budget can afford the tokens of the specified message.
     *
     * @param {Message|MessageCollection} message - The message to check for affordability.
     * @returns {boolean} True if the budget can afford the message, false otherwise.
     */
    canAfford(message) {
        return 0 <= this.tokenBudget - message.getTokens();
    }

    /**
     * Checks if the token budget can afford the tokens of all the specified messages.
     * @param {Message[]} messages - The messages to check for affordability.
     * @returns {boolean} True if the budget can afford all the messages, false otherwise.
     */
    canAffordAll(messages) {
        return 0 <= this.tokenBudget - messages.reduce((total, message) => total + message.getTokens(), 0);
    }

    /**
     * Checks if a message with the specified identifier exists in the collection.
     *
     * @param {string} identifier - The identifier to check for existence.
     * @returns {boolean} True if a message with the specified identifier exists, false otherwise.
     */
    has(identifier) {
        return this.messages.hasItemWithIdentifier(identifier);
    }

    /**
     * Retrieves the total number of tokens in the collection.
     *
     * @returns {number} The total number of tokens.
     */
    getTotalTokenCount() {
        return this.messages.getTokens();
    }

    /**
     * Retrieves the chat as a flattened array of messages.
     *
     * @returns {Array} The chat messages.
     */
    getChat() {
        const chat = [];
        for (let item of this.messages.collection) {
            if (item instanceof MessageCollection) {
                chat.push(...item.getChat());
            } else if (item instanceof Message && (item.content || item.tool_calls)) {
                const message = {
                    role: item.role,
                    content: item.content,
                    ...(item.name ? { name: item.name } : {}),
                    ...(item.tool_calls ? { tool_calls: item.tool_calls } : {}),
                    ...(item.role === 'tool' ? { tool_call_id: item.identifier } : {}),
                    ...(item.signature ? { signature: item.signature } : {}),
                    ...(item.reasoning ? { reasoning: item.reasoning } : {}),
                };
                chat.push(message);
            } else {
                this.log(`Skipping invalid or empty message in collection: ${JSON.stringify(item)}`);
            }
        }
        return chat;
    }

    /**
     * Logs an output message to the console if logging is enabled.
     *
     * @param {string} output - The output message to log.
     */
    log(output) {
        if (this.loggingEnabled) console.log('[ChatCompletion] ' + output);
    }

    /**
     * Enables logging of output messages to the console.
     */
    enableLogging() {
        this.loggingEnabled = true;
    }

    /**
     * Disables logging of output messages to the console.
     */
    disableLogging() {
        this.loggingEnabled = false;
    }

    /**
     * Validates if the given argument is an instance of MessageCollection.
     * Throws an error if the validation fails.
     *
     * @param {MessageCollection|Message} collection - The collection to validate.
     */
    validateMessageCollection(collection) {
        if (!(collection instanceof MessageCollection)) {
            console.log(collection);
            throw new Error('Argument must be an instance of MessageCollection');
        }
    }

    /**
     * Validates if the given argument is an instance of Message.
     * Throws an error if the validation fails.
     *
     * @param {Message} message - The message to validate.
     */
    validateMessage(message) {
        if (!(message instanceof Message)) {
            console.log(message);
            throw new Error('Argument must be an instance of Message');
        }
    }

    /**
     * Checks if the token budget can afford the tokens of the given message.
     * Throws an error if the budget can't afford the message.
     *
     * @param {Message|MessageCollection} message - The message to check.
     * @param {string} identifier - The identifier of the message.
     */
    checkTokenBudget(message, identifier) {
        if (!this.canAfford(message)) {
            throw new TokenBudgetExceededError(identifier);
        }
    }

    /**
     * Reserves the tokens required by the given message from the token budget.
     *
     * @param {Message|MessageCollection|number} message - The message whose tokens to reserve.
     */
    reserveBudget(message) {
        const tokens = typeof message === 'number' ? message : message.getTokens();
        this.decreaseTokenBudgetBy(tokens);
    }

    /**
     * Frees up the tokens used by the given message from the token budget.
     *
     * @param {Message|MessageCollection} message - The message whose tokens to free.
     */
    freeBudget(message) { this.increaseTokenBudgetBy(message.getTokens()); }

    /**
     * Increases the token budget by the given number of tokens.
     * This function should be used sparingly, per design the completion should be able to work with its initial budget.
     *
     * @param {number} tokens - The number of tokens to increase the budget by.
     */
    increaseTokenBudgetBy(tokens) {
        this.tokenBudget += tokens;
    }

    /**
     * Decreases the token budget by the given number of tokens.
     * This function should be used sparingly, per design the completion should be able to work with its initial budget.
     *
     * @param {number} tokens - The number of tokens to decrease the budget by.
     */
    decreaseTokenBudgetBy(tokens) {
        this.tokenBudget -= tokens;
    }

    /**
     * Finds the index of a message in the collection by its identifier.
     * Throws an error if a message with the given identifier is not found.
     *
     * @param {string} identifier - The identifier of the message to find.
     * @returns {number} The index of the message in the collection.
     */
    findMessageIndex(identifier) {
        const index = this.messages.collection.findIndex(item => item?.identifier === identifier);
        if (index < 0) {
            throw new IdentifierNotFoundError(identifier);
        }
        return index;
    }

    /**
     * Sets the list of overridden prompts.
     * @param {string[]} list A list of prompts that were overridden.
     */
    setOverriddenPrompts(list) {
        this.overriddenPrompts = list;
    }

    getOverriddenPrompts() {
        return this.overriddenPrompts ?? [];
    }
}

function setOpenAIMessages(chat) {
    let j = 0;
    // clean openai msgs
    const messages = [];
    // Get current API and model for thought signature validation
    const currentApi = oai_settings.chat_completion_source;
    const currentModel = getChatCompletionModel();

    for (let i = chat.length - 1; i >= 0; i--) {
        let role = chat[j].is_user ? 'user' : 'assistant';
        let content = chat[j].mes;

        // If this symbol flag is set, completely ignore the message.
        // This can be used to hide messages without affecting the number of messages in the chat.
        if (chat[j].extra?.[IGNORE_SYMBOL]) {
            j++;
            continue;
        }

        // 100% legal way to send a message as system
        if (chat[j].extra?.type === system_message_types.NARRATOR) {
            role = 'system';
        }

        // for groups or sendas command - prepend a character's name
        switch (oai_settings.names_behavior) {
            case character_names_behavior.NONE:
                break;
            case character_names_behavior.DEFAULT:
                if ((selected_group && chat[j].name !== name1) || (chat[j].force_avatar && chat[j].name !== name1 && chat[j].extra?.type !== system_message_types.NARRATOR)) {
                    content = `${chat[j].name}: ${content}`;
                }
                break;
            case character_names_behavior.CONTENT:
                if (chat[j].extra?.type !== system_message_types.NARRATOR) {
                    content = `${chat[j].name}: ${content}`;
                }
                break;
            case character_names_behavior.COMPLETION:
                break;
            default:
                break;
        }

        // remove caret return (waste of tokens)
        content = content.replace(/\r/gm, '');

        const name = chat[j].name;
        const media = chat[j]?.extra?.media;
        const mediaDisplay = getMediaDisplay(chat[j]);
        const mediaIndex = getMediaIndex(chat[j]);
        const invocations = chat[j]?.extra?.tool_invocations?.slice();

        // Only send thought signatures if they were generated by the same API and model
        const originApi = chat[j]?.extra?.api;
        const originModel = chat[j]?.extra?.model;
        const isSameModel = originApi === currentApi && originModel === currentModel;
        // In group chats, only include reasoning from the currently generating character
        const isOtherGroupMember = selected_group && chat[j].name !== name2;
        const signature = isSameModel && !isOtherGroupMember ? chat[j]?.extra?.reasoning_signature : null;
        const reasoning = isSameModel && !isOtherGroupMember ? String(chat[j]?.extra?.reasoning ?? '') : '';

        // Remove reasoning metadata from invocations if the API/model don't match
        if (Array.isArray(invocations) && invocations.length > 0) {
            invocations.forEach((invocation, index) => {
                if (!isSameModel && (invocation.signature || invocation.reasoning)) {
                    const cloneInvocation = structuredClone(invocation);
                    delete cloneInvocation.signature;
                    delete cloneInvocation.reasoning;
                    invocations[index] = cloneInvocation;
                }
            });
        }

        messages[i] = { 'role': role, 'content': content, name: name, 'media': media, 'mediaDisplay': mediaDisplay, 'mediaIndex': mediaIndex, 'invocations': invocations, 'signature': signature, 'reasoning': reasoning };
        j++;
    }

    return messages;
}

function setOpenAIMessageExamples(mesExamplesArray) {
    // get a nice array of all blocks of all example messages = array of arrays (important!)
    const examples = [];
    for (let item of mesExamplesArray) {
        // remove <START> {Example Dialogue:} and replace \r\n with just \n
        let replaced = item.replace(/<START>/i, '{Example Dialogue:}').replace(/\r/gm, '');
        let parsed = parseExampleIntoIndividual(replaced, true);
        // add to the example message blocks array
        examples.push(parsed);
    }
    return examples;
}
 const tokenHandler=new TokenHandler(countTokensOpenAIAsync);
 const promptManager=new PromptManager(oai_settings,tokenHandler,{main:default_main_prompt,nsfw:default_nsfw_prompt,jailbreak:default_jailbreak_prompt,enhanceDefinitions:default_enhance_definitions_prompt},render);
 return { createGenerationParameters, prepareOpenAIMessages, setOpenAIMessages, setOpenAIMessageExamples, ChatCompletion, Message, MessageCollection, Prompt, PromptCollection, get messageCount(){return openai_messages_count;}, get messages(){return openai_msgs;}, get examples(){return openai_mes_examples;}, get manager(){return promptManager;} };
}
