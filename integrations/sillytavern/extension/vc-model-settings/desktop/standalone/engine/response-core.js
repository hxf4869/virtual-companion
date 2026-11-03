// AGPL-3.0-only. SillyTavern 7e8663cd9c184a550b37238218bdd32c6efc68e9 / scripts/openai.js、reasoning.js、script.js
// 原文本/reasoning/logprobs算法；固定本次请求设置，不读在途变化的页面设置。
import {isDataURL} from './resources.js';
import {chat_completion_sources, getChatCompletionModel as modelOf} from './st/scripts/openai.js';
export function createResponseParser(settings) {
const oai_settings=structuredClone(settings),main_api='openai';
const getChatCompletionModel=()=>modelOf(oai_settings);
function getStreamingReply(data, state, { chatCompletionSource = null, overrideShowThoughts = null } = {}) {
    const chat_completion_source = chatCompletionSource ?? oai_settings.chat_completion_source;
    const show_thoughts = overrideShowThoughts ?? oai_settings.show_thoughts;

    if (chat_completion_source === chat_completion_sources.CLAUDE) {
        if (show_thoughts) {
            state.reasoning += data?.delta?.thinking || '';
        }
        return data?.delta?.text || '';
    } else if ([chat_completion_sources.MAKERSUITE, chat_completion_sources.VERTEXAI].includes(chat_completion_source)) {
        const inlineData = data?.candidates?.[0]?.content?.parts?.filter(x => x.inlineData && !x.thought)?.map(x => x.inlineData) || [];
        if (Array.isArray(inlineData) && inlineData.length > 0) {
            state.images.push(...inlineData.map(x => `data:${x.mimeType};base64,${x.data}`).filter(isDataURL));
        }
        if (show_thoughts) {
            state.reasoning += (data?.candidates?.[0]?.content?.parts?.filter(x => x.thought)?.map(x => x.text)?.[0] || '');
        }
        // Extract thought signatures from streaming chunks (typically in final chunk)
        const parts = data?.candidates?.[0]?.content?.parts || [];
        parts.forEach((part) => {
            if (part.thoughtSignature && typeof part.text === 'string') {
                state.signature = part.thoughtSignature;
            }
        });
        return data?.candidates?.[0]?.content?.parts?.filter(x => !x.thought)?.map(x => x.text)?.[0] || '';
    } else if (chat_completion_source === chat_completion_sources.COHERE) {
        return data?.delta?.message?.content?.text || data?.delta?.message?.tool_plan || '';
    } else if (chat_completion_source === chat_completion_sources.DEEPSEEK) {
        if (show_thoughts) {
            state.reasoning += (data.choices?.filter(x => x?.delta?.reasoning_content)?.[0]?.delta?.reasoning_content || '');
        }
        return data.choices?.[0]?.delta?.content || '';
    } else if (chat_completion_source === chat_completion_sources.XAI) {
        if (show_thoughts) {
            state.reasoning += (data.choices?.filter(x => x?.delta?.reasoning_content)?.[0]?.delta?.reasoning_content || '');
        }
        return data.choices?.[0]?.delta?.content || '';
    } else if (chat_completion_source === chat_completion_sources.OPENROUTER) {
        const imageUrls = data?.choices?.[0]?.delta?.images?.filter(x => x.type === 'image_url')?.map(x => x?.image_url?.url) || [];
        if (Array.isArray(imageUrls) && imageUrls.length > 0) {
            state.images.push(...imageUrls.filter(isDataURL));
        }
        if (show_thoughts) {
            state.reasoning +=
                data.choices?.filter(x => x?.delta?.reasoning)?.[0]?.delta?.reasoning ??
                data.choices?.filter(x => x?.delta?.reasoning_content)?.[0]?.delta?.reasoning_content ??
                data.choices?.filter(x => x?.message?.reasoning)?.[0]?.message?.reasoning ??
                data.choices?.filter(x => x?.message?.reasoning_content)?.[0]?.message?.reasoning_content ??
                '';
        }
        // Extract thought signatures from OpenRouter streaming.
        const reasoningDetails = [
            ...(data?.choices?.[0]?.delta?.reasoning_details || []),
            ...(data?.choices?.[0]?.message?.reasoning_details || []),
        ];
        reasoningDetails.forEach((detail) => {
            if (detail.type === 'reasoning.encrypted' && detail.data) {
                const isToolLikeId = typeof detail.id === 'string' && /^(tool_|call_)/.test(detail.id);
                if (typeof detail.id === 'string' && detail.id.length > 0) {
                    state.toolSignatures[detail.id] = detail.data;
                }
                if (!isToolLikeId) {
                    state.signature = detail.data;
                }
            }
        });
        return data.choices?.[0]?.delta?.content ?? data.choices?.[0]?.message?.content ?? data.choices?.[0]?.text ?? '';
    } else if ([chat_completion_sources.CUSTOM, chat_completion_sources.POLLINATIONS, chat_completion_sources.AIMLAPI, chat_completion_sources.MOONSHOT, chat_completion_sources.COMETAPI, chat_completion_sources.ELECTRONHUB, chat_completion_sources.NANOGPT, chat_completion_sources.ZAI, chat_completion_sources.SILICONFLOW, chat_completion_sources.CHUTES, chat_completion_sources.WORKERS_AI, chat_completion_sources.FIREWORKS].includes(chat_completion_source)) {
        if (show_thoughts) {
            state.reasoning +=
                data.choices?.filter(x => x?.delta?.reasoning_content)?.[0]?.delta?.reasoning_content ??
                data.choices?.filter(x => x?.delta?.reasoning)?.[0]?.delta?.reasoning ??
                '';
        }
        return data.choices?.[0]?.delta?.content ?? data.choices?.[0]?.message?.content ?? data.choices?.[0]?.text ?? '';
    } else if (chat_completion_source === chat_completion_sources.MISTRALAI) {
        if (show_thoughts) {
            state.reasoning += (data.choices?.filter(x => x?.delta?.content?.[0]?.thinking)?.[0]?.delta?.content?.[0]?.thinking?.[0]?.text || '');
        }
        const content = data.choices?.[0]?.delta?.content ?? data.choices?.[0]?.message?.content ?? data.choices?.[0]?.text ?? '';
        return Array.isArray(content) ? content.map(x => x.text).filter(x => x).join('') : content;
    } else {
        return data.choices?.[0]?.delta?.content ?? data.choices?.[0]?.message?.content ?? data.choices?.[0]?.text ?? '';
    }
}
function parseChatCompletionLogprobs(data) {
    if (!data) {
        return null;
    }

    switch (oai_settings.chat_completion_source) {
        case chat_completion_sources.AIMLAPI:
            return Object.keys(data?.choices?.[0]?.logprobs ?? {}).includes('content')
                ? parseOpenAIChatLogprobs(data.choices[0]?.logprobs)
                : parseOpenAITextLogprobs(data.choices[0]?.logprobs);
        case chat_completion_sources.OPENAI:
        case chat_completion_sources.AZURE_OPENAI:
        case chat_completion_sources.OPENROUTER:
        case chat_completion_sources.DEEPSEEK:
        case chat_completion_sources.XAI:
        case chat_completion_sources.CUSTOM:
        case chat_completion_sources.CHUTES:
            if (!data.choices?.length) {
                return null;
            }
            // OpenAI Text Completion API is treated as a chat completion source
            // by SillyTavern, hence its presence in this function.
            return textCompletionModels.includes(getChatCompletionModel())
                ? parseOpenAITextLogprobs(data.choices[0]?.logprobs)
                : parseOpenAIChatLogprobs(data.choices[0]?.logprobs);
        default:
        // implement other chat completion sources here
    }
    return null;
}
function parseOpenAIChatLogprobs(logprobs) {
    const { content } = logprobs ?? {};

    if (!Array.isArray(content)) {
        return null;
    }

    /** @type {(x: { token: string, logprob: number }) => [string, number]} */
    const toTuple = (x) => [x.token, x.logprob];

    return content.map(({ token, logprob, top_logprobs = [] }) => {
        // Add the chosen token to top_logprobs if it's not already there, then
        // convert to a list of [token, logprob] pairs
        const chosenTopToken = top_logprobs.some((top) => token === top.token);
        /** @type {import('./logprobs.js').Candidate[]} */
        const topLogprobs = chosenTopToken
            ? top_logprobs.map(toTuple)
            : [...top_logprobs.map(toTuple), [token, logprob]];
        return { token, topLogprobs };
    });
}
function parseOpenAITextLogprobs(logprobs) {
    const { tokens, token_logprobs, top_logprobs } = logprobs ?? {};

    if (!Array.isArray(tokens)) {
        return null;
    }

    return tokens.map((token, i) => {
        // Add the chosen token to top_logprobs if it's not already there, then
        // convert to a list of [token, logprob] pairs
        /** @type {any[]} */
        const topLogprobs = top_logprobs[i] ? Object.entries(top_logprobs[i]) : [];
        const chosenTopToken = topLogprobs.some(([topToken]) => token === topToken);
        if (!chosenTopToken) {
            topLogprobs.push([token, token_logprobs[i]]);
        }
        return { token, topLogprobs };
    });
}
const textCompletionModels = [
    'gpt-3.5-turbo-instruct',
    'gpt-3.5-turbo-instruct-0914',
    'text-davinci-003',
    'text-davinci-002',
    'text-davinci-001',
    'text-curie-001',
    'text-babbage-001',
    'text-ada-001',
    'code-davinci-002',
    'code-davinci-001',
    'code-cushman-002',
    'code-cushman-001',
    'text-davinci-edit-001',
    'code-davinci-edit-001',
    'text-embedding-ada-002',
    'text-similarity-davinci-001',
    'text-similarity-curie-001',
    'text-similarity-babbage-001',
    'text-similarity-ada-001',
    'text-search-davinci-doc-001',
    'text-search-curie-doc-001',
    'text-search-babbage-doc-001',
    'text-search-ada-doc-001',
    'code-search-babbage-code-001',
    'code-search-ada-code-001',
];
function extractMessageFromData(data, activeApi = null) {
    function getResult() {
        if (typeof data === 'string') {
            return data;
        }

        switch (activeApi ?? main_api) {
            case 'kobold':
                return data.results[0].text;
            case 'koboldhorde':
                return data.text;
            case 'textgenerationwebui':
                return data.choices?.[0]?.text ?? data.choices?.[0]?.message?.content ?? data.content ?? data.response ?? data[0]?.content ?? '';
            case 'novel':
                return data.output;
            case 'openai':
                return data?.content?.filter(p => p.type === 'text')?.map(p => p.text)?.join('\n\n') ?? data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? data?.text ?? data?.message?.content?.[0]?.text ?? data?.message?.tool_plan ?? '';
            default:
                return '';
        }
    }

    const result = getResult();
    return Array.isArray(result) ? result.map(x => x.text).filter(x => x).join('') : result;
}
function extractReasoningFromData(data, {
    mainApi = null,
    ignoreShowThoughts = false,
    textGenType = null,
    chatCompletionSource = null,
} = {}) {
    switch (mainApi ?? main_api) {
        case 'openai':
            if (!ignoreShowThoughts && !oai_settings.show_thoughts) break;

            switch (chatCompletionSource ?? oai_settings.chat_completion_source) {
                case chat_completion_sources.DEEPSEEK:
                    return data?.choices?.[0]?.message?.reasoning_content ?? '';
                case chat_completion_sources.XAI:
                    return data?.choices?.[0]?.message?.reasoning_content ?? '';
                case chat_completion_sources.OPENROUTER:
                    return data?.choices?.[0]?.message?.reasoning
                        ?? data?.choices?.[0]?.message?.reasoning_content
                        ?? '';
                case chat_completion_sources.MAKERSUITE:
                case chat_completion_sources.VERTEXAI:
                    return data?.responseContent?.parts?.filter(part => part.thought)?.map(part => part.text)?.join('\n\n') ?? '';
                case chat_completion_sources.CLAUDE:
                    return data?.content?.filter(part => part.type === 'thinking')?.map(part => part.thinking)?.join('\n\n') ?? '';
                case chat_completion_sources.MISTRALAI:
                    return data?.choices?.[0]?.message?.content?.[0]?.thinking?.map(part => part.text)?.filter(x => x)?.join('\n\n') ?? '';
                case chat_completion_sources.AIMLAPI:
                case chat_completion_sources.POLLINATIONS:
                case chat_completion_sources.MOONSHOT:
                case chat_completion_sources.COMETAPI:
                case chat_completion_sources.CHUTES:
                case chat_completion_sources.ELECTRONHUB:
                case chat_completion_sources.NANOGPT:
                case chat_completion_sources.SILICONFLOW:
                case chat_completion_sources.ZAI:
                case chat_completion_sources.WORKERS_AI:
                case chat_completion_sources.FIREWORKS:
                case chat_completion_sources.CUSTOM: {
                    return data?.choices?.[0]?.message?.reasoning_content
                        ?? data?.choices?.[0]?.message?.reasoning
                        ?? '';
                }
            }
            break;
    }

    return '';
}
return {getStreamingReply,extractMessageFromData,extractReasoningFromData,parseChatCompletionLogprobs};
}
