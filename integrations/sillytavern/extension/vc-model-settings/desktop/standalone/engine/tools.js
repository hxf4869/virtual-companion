// AGPL-3.0-only. SillyTavern 7e8663cd9 / scripts/tool-calling.js
// 原工具registry与能力判定；不复制模型调用/工具执行链。
import { main_api, oai_settings, model_list } from './ports.js';
import { chat_completion_sources, custom_prompt_post_processing_types, getChatCompletionModel } from './st/scripts/openai.js';
import { quietConsole as console } from './diagnostics.js';
class ToolDefinition {
    /**
     * A unique name for the tool.
     * @type {string}
     */
    #name;

    /**
     * A user-friendly display name for the tool.
     * @type {string}
     */
    #displayName;

    /**
     * A description of what the tool does.
     * @type {string}
     */
    #description;

    /**
     * A JSON schema for the parameters that the tool accepts.
     * @type {object}
     */
    #parameters;

    /**
     * A function that will be called when the tool is executed.
     * @type {function}
     */
    #action;

    /**
     * A function that will be called to format the tool call toast.
     * @type {function}
     */
    #formatMessage;

    /**
     * A function that will be called to determine if the tool should be registered.
     * @type {function}
     */
    #shouldRegister;

    /**
     * A tool call result will not be shown in the chat. No follow-up generation will be performed.
     * @type {boolean}
     */
    #stealth;

    /**
     * Creates a new ToolDefinition.
     * @param {string} name A unique name for the tool.
     * @param {string} displayName A user-friendly display name for the tool.
     * @param {string} description A description of what the tool does.
     * @param {object} parameters A JSON schema for the parameters that the tool accepts.
     * @param {function} action A function that will be called when the tool is executed.
     * @param {function} formatMessage A function that will be called to format the tool call toast.
     * @param {function} shouldRegister A function that will be called to determine if the tool should be registered.
     * @param {boolean} stealth A tool call result will not be shown in the chat. No follow-up generation will be performed.
     */
    constructor(name, displayName, description, parameters, action, formatMessage, shouldRegister, stealth) {
        this.#name = name;
        this.#displayName = displayName;
        this.#description = description;
        this.#parameters = parameters;
        this.#action = action;
        this.#formatMessage = formatMessage;
        this.#shouldRegister = shouldRegister;
        this.#stealth = stealth;
    }

    /**
     * Converts the ToolDefinition to an OpenAI API representation
     * @returns {ToolDefinitionOpenAI} OpenAI API representation of the tool.
     */
    toFunctionOpenAI() {
        return {
            type: 'function',
            function: {
                name: this.#name,
                description: this.#description,
                parameters: this.#parameters,
            },
            toString: function () {
                return `<div><b>${this.function.name}</b></div><div><small>${this.function.description}</small></div><pre class="justifyLeft wordBreakAll"><code class="flex padding5">${JSON.stringify(this.function.parameters, null, 2)}</code></pre><hr>`;
            },
        };
    }

    /**
     * Invokes the tool with the given parameters.
     * @param {object} parameters The parameters to pass to the tool.
     * @returns {Promise<any>} The result of the tool's action function.
     */
    async invoke(parameters) {
        return await this.#action(parameters);
    }

    /**
     * Formats a message with the tool invocation.
     * @param {object} parameters The parameters to pass to the tool.
     * @returns {Promise<string>} The formatted message.
     */
    async formatMessage(parameters) {
        return typeof this.#formatMessage === 'function'
            ? await this.#formatMessage(parameters)
            : `Invoking tool: ${this.#displayName || this.#name}`;
    }

    async shouldRegister() {
        return typeof this.#shouldRegister === 'function'
            ? await this.#shouldRegister()
            : true;
    }

    get displayName() {
        return this.#displayName;
    }

    get stealth() {
        return this.#stealth;
    }
}
export class ToolManager {
static RECURSE_LIMIT = 5;
static #tools = new Map();
static get tools() {
        return Array.from(this.#tools.values());
    }
static registerFunctionTool({ name, displayName, description, parameters, action, formatMessage, shouldRegister, stealth }) {
        // Convert WIP arguments
        if (typeof arguments[0] !== 'object') {
            [name, description, parameters, action] = arguments;
        }

        if (this.#tools.has(name)) {
            console.warn(`[ToolManager] A tool with the name "${name}" has already been registered. The definition will be overwritten.`);
        }

        const definition = new ToolDefinition(
            name,
            displayName,
            description,
            parameters,
            action,
            formatMessage,
            shouldRegister,
            stealth,
        );
        this.#tools.set(name, definition);
        console.log('[ToolManager] Registered function tool:', definition);
    }
static unregisterFunctionTool(name) {
        if (!this.#tools.has(name)) {
            return;
        }

        this.#tools.delete(name);
        console.log(`[ToolManager] Unregistered function tool: ${name}`);
    }
static async registerFunctionToolsOpenAI(data) {
        const tools = [];

        for (const tool of ToolManager.tools) {
            const register = await tool.shouldRegister();
            if (!register) {
                console.log('[ToolManager] Skipping tool registration:', tool);
                continue;
            }
            tools.push(tool.toFunctionOpenAI());
        }

        if (tools.length) {
            console.log('[ToolManager] Registered function tools:', tools);

            data.tools = tools;
            data.tool_choice = 'auto';
        }
    }
static isToolCallingSupported(settings = null, model = null) {
        settings = settings ?? oai_settings;
        model = model ?? getChatCompletionModel(settings);

        if (main_api !== 'openai' || !settings.function_calling) {
            return false;
        }

        // GPT-6 Astra supports tool calling only through the Responses API.
        if ([chat_completion_sources.OPENAI, chat_completion_sources.AZURE_OPENAI].includes(settings.chat_completion_source)
            && /^gpt-6-astra/.test(model)) {
            return false;
        }

        // Post-processing will forcefully remove past tool calls from the prompt, making them useless
        const { NONE, MERGE_TOOLS, SEMI_TOOLS, STRICT_TOOLS } = custom_prompt_post_processing_types;
        const allowedPromptPostProcessing = [NONE, MERGE_TOOLS, SEMI_TOOLS, STRICT_TOOLS];
        if (!allowedPromptPostProcessing.includes(settings.custom_prompt_post_processing)) {
            return false;
        }

        const currentModel = Array.isArray(model_list) ? model_list.find(m => m.id === model) : null;
        if (currentModel) {
            switch (settings.chat_completion_source) {
                case chat_completion_sources.POLLINATIONS:
                    return currentModel.tools;
                case chat_completion_sources.FIREWORKS:
                    return currentModel.supports_tools;
                case chat_completion_sources.OPENROUTER:
                    return currentModel.supported_parameters?.includes('tools');
                case chat_completion_sources.MISTRALAI:
                    return currentModel.capabilities?.function_calling;
                case chat_completion_sources.AIMLAPI:
                    return currentModel.features?.includes('openai/chat-completion.function');
                case chat_completion_sources.CHUTES:
                    return currentModel.supported_features?.includes('tools');
                case chat_completion_sources.ELECTRONHUB:
                    return currentModel.metadata?.function_call;
                case chat_completion_sources.WORKERS_AI:
                    return Array.isArray(currentModel.properties) && currentModel.properties.some(p => p.property_id === 'function_calling' && p.value === 'true');
            }
        }

        const supportedSources = [
            chat_completion_sources.OPENAI,
            chat_completion_sources.CUSTOM,
            chat_completion_sources.MISTRALAI,
            chat_completion_sources.CLAUDE,
            chat_completion_sources.OPENROUTER,
            chat_completion_sources.AIMLAPI,
            chat_completion_sources.GROQ,
            chat_completion_sources.COHERE,
            chat_completion_sources.DEEPSEEK,
            chat_completion_sources.MAKERSUITE,
            chat_completion_sources.VERTEXAI,
            chat_completion_sources.AI21,
            chat_completion_sources.XAI,
            chat_completion_sources.POLLINATIONS,
            chat_completion_sources.MOONSHOT,
            chat_completion_sources.FIREWORKS,
            chat_completion_sources.COMETAPI,
            chat_completion_sources.CHUTES,
            chat_completion_sources.ELECTRONHUB,
            chat_completion_sources.AZURE_OPENAI,
            chat_completion_sources.ZAI,
            chat_completion_sources.SILICONFLOW,
            chat_completion_sources.NANOGPT,
            chat_completion_sources.WORKERS_AI,
            chat_completion_sources.MINIMAX,
        ];
        return supportedSources.includes(settings.chat_completion_source);
    }
static canPerformToolCalls(type, settings = null, model = null) {
        settings = settings ?? oai_settings;
        model = model ?? getChatCompletionModel(settings);
        const noToolCallTypes = ['impersonate', 'quiet', 'continue'];
        const isSupported = ToolManager.isToolCallingSupported(settings, model);
        return isSupported && !noToolCallTypes.includes(type);
    }
static #INPUT_DELTA_KEY = '__input_json_delta';
static parseToolCalls(toolCalls, parsed, toolSignatures = {}, settings = null, model = null) {
        if (!this.isToolCallingSupported(settings, model)) {
            return;
        }
        if (Array.isArray(parsed?.choices)) {
            for (const choice of parsed.choices) {
                const choiceIndex = (typeof choice.index === 'number') ? choice.index : null;
                const choiceDelta = choice.delta;

                if (choiceIndex === null || !choiceDelta) {
                    continue;
                }

                const toolCallDeltas = choiceDelta?.tool_calls;

                if (!Array.isArray(toolCallDeltas)) {
                    continue;
                }

                if (!Array.isArray(toolCalls[choiceIndex])) {
                    toolCalls[choiceIndex] = [];
                }

                for (const toolCallDelta of toolCallDeltas) {
                    const toolCallIndex = toolCallDelta?.index >= 0 ? toolCallDelta.index : toolCallDeltas.indexOf(toolCallDelta);

                    if (isNaN(toolCallIndex)) {
                        continue;
                    }

                    if (toolCalls[choiceIndex][toolCallIndex] === undefined) {
                        toolCalls[choiceIndex][toolCallIndex] = {};
                    }

                    const targetToolCall = toolCalls[choiceIndex][toolCallIndex];

                    ToolManager.#applyToolCallDelta(targetToolCall, toolCallDelta);

                    // Transfer thought signature if available
                    if (Object.hasOwn(toolSignatures, targetToolCall.id)) {
                        targetToolCall.signature = toolSignatures[targetToolCall.id];
                    }
                }
            }
        }
        const cohereToolEvents = ['message-start', 'tool-call-start', 'tool-call-delta', 'tool-call-end'];
        if (cohereToolEvents.includes(parsed?.type) && typeof parsed?.delta?.message === 'object') {
            const choiceIndex = 0;
            const toolCallIndex = parsed?.index ?? 0;

            if (!Array.isArray(toolCalls[choiceIndex])) {
                toolCalls[choiceIndex] = [];
            }

            if (toolCalls[choiceIndex][toolCallIndex] === undefined) {
                toolCalls[choiceIndex][toolCallIndex] = {};
            }

            const targetToolCall = toolCalls[choiceIndex][toolCallIndex];
            ToolManager.#applyToolCallDelta(targetToolCall, parsed.delta.message);
        }
        if (typeof parsed?.content_block === 'object') {
            const choiceIndex = 0;
            const toolCallIndex = parsed?.index ?? 0;

            if (parsed?.content_block?.type === 'tool_use') {
                if (!Array.isArray(toolCalls[choiceIndex])) {
                    toolCalls[choiceIndex] = [];
                }
                if (toolCalls[choiceIndex][toolCallIndex] === undefined) {
                    toolCalls[choiceIndex][toolCallIndex] = {};
                }
                const targetToolCall = toolCalls[choiceIndex][toolCallIndex];
                ToolManager.#applyToolCallDelta(targetToolCall, parsed.content_block);
            }
        }
        if (typeof parsed?.delta === 'object') {
            const choiceIndex = 0;
            const toolCallIndex = parsed?.index ?? 0;
            const targetToolCall = toolCalls[choiceIndex]?.[toolCallIndex];
            if (targetToolCall) {
                if (parsed?.delta?.type === 'input_json_delta') {
                    const jsonDelta = parsed?.delta?.partial_json;
                    if (!targetToolCall[this.#INPUT_DELTA_KEY]) {
                        targetToolCall[this.#INPUT_DELTA_KEY] = '';
                    }
                    targetToolCall[this.#INPUT_DELTA_KEY] += jsonDelta;
                }
            }
        }
        if (parsed?.type === 'content_block_stop') {
            const choiceIndex = 0;
            const toolCallIndex = parsed?.index ?? 0;
            const targetToolCall = toolCalls[choiceIndex]?.[toolCallIndex];
            if (targetToolCall) {
                const jsonDeltaString = targetToolCall[this.#INPUT_DELTA_KEY];
                if (jsonDeltaString) {
                    try {
                        const jsonDelta = { input: JSON.parse(jsonDeltaString) };
                        delete targetToolCall[this.#INPUT_DELTA_KEY];
                        ToolManager.#applyToolCallDelta(targetToolCall, jsonDelta);
                    } catch (error) {
                        console.warn('[ToolManager] Failed to apply input JSON delta:', error);
                    }
                }
            }
        }
        if (Array.isArray(parsed?.candidates)) {
            for (let choiceIndex = 0; choiceIndex < parsed.candidates.length; choiceIndex++) {
                const candidate = parsed.candidates[choiceIndex];
                if (Array.isArray(candidate?.content?.parts)) {
                    for (let partIndex = 0; partIndex < candidate.content.parts.length; partIndex++) {
                        const part = candidate.content.parts[partIndex];
                        if (part.functionCall) {
                            if (!Array.isArray(toolCalls[choiceIndex])) {
                                toolCalls[choiceIndex] = [];
                            }
                            const toolCallIndex = toolCalls[choiceIndex].length;
                            if (toolCalls[choiceIndex][toolCallIndex] === undefined) {
                                toolCalls[choiceIndex][toolCallIndex] = {};
                            }
                            const targetToolCall = toolCalls[choiceIndex][toolCallIndex];
                            if (part.thoughtSignature) {
                                targetToolCall.thoughtSignature = part.thoughtSignature;
                            }
                            ToolManager.#applyToolCallDelta(targetToolCall, part.functionCall);
                        }
                    }
                }
            }
        }
    }
static #applyToolCallDelta(target, delta) {
        for (const key in delta) {
            if (!Object.prototype.hasOwnProperty.call(delta, key)) continue;
            if (key === '__proto__' || key === 'constructor') continue;

            const deltaValue = delta[key];
            const targetValue = target[key];

            if (deltaValue === null || deltaValue === undefined) {
                // Don't reset the value if it already exists
                if (targetValue) {
                    continue;
                }
                target[key] = deltaValue;
                continue;
            }

            if (typeof deltaValue === 'string') {
                // `id`, `name`, `type` are sent in full by some providers on every
                // streaming chunk; concatenating them would duplicate the value.
                if (key === 'id' || key === 'name' || key === 'type') {
                    if (!targetValue) {
                        target[key] = deltaValue;
                    }
                } else if (typeof targetValue === 'string') {
                    // Concatenate strings
                    target[key] = targetValue + deltaValue;
                } else {
                    target[key] = deltaValue;
                }
            } else if (typeof deltaValue === 'object' && !Array.isArray(deltaValue)) {
                if (typeof targetValue !== 'object' || targetValue === null || Array.isArray(targetValue)) {
                    target[key] = {};
                }
                // Recursively apply deltas to nested objects
                ToolManager.#applyToolCallDelta(target[key], deltaValue);
            } else {
                // Assign other types directly
                target[key] = deltaValue;
            }
        }
    }
static #getToolCallsFromData(data) {
        const getRandomId = () => Math.random().toString(36).substring(2);
        const isClaudeToolCall = c => Array.isArray(c) ? c.filter(x => x).every(isClaudeToolCall) : c?.input && c?.name && c?.id;
        const isGoogleToolCall = c => Array.isArray(c) ? c.filter(x => x).every(isGoogleToolCall) : c?.name && c?.args;
        const convertClaudeToolCall = c => ({ id: c.id, function: { name: c.name, arguments: c.input } });
        const convertGoogleToolCall = (c, signature = null) => ({ id: getRandomId(), function: { name: c.name, arguments: c.args }, signature });

        // Parsed tool calls from streaming data
        if (Array.isArray(data) && data.length > 0 && Array.isArray(data[0])) {
            if (isClaudeToolCall(data[0])) {
                return data[0].filter(x => x).map(convertClaudeToolCall);
            }

            if (isGoogleToolCall(data[0])) {
                return data[0].filter(x => x).map((c) => convertGoogleToolCall(c, c.thoughtSignature));
            }

            if (typeof data[0]?.[0]?.tool_calls === 'object') {
                return Array.isArray(data[0]?.[0]?.tool_calls) ? data[0][0].tool_calls : [data[0][0].tool_calls];
            }

            return data[0];
        }

        // Google AI Studio tool calls
        if (Array.isArray(data?.responseContent?.parts)) {
            return data.responseContent.parts.filter(p => p.functionCall).map(p => convertGoogleToolCall(p.functionCall, p.thoughtSignature));
        }

        // Parsed tool calls from non-streaming data
        if (Array.isArray(data?.choices)) {
            // Find a choice with 0-index
            const choice = data.choices.find(choice => choice.index === 0);

            if (choice && typeof choice.message === 'object' && Array.isArray(choice.message.tool_calls)) {
                // Add OpenRouter signatures
                if (Array.isArray(choice.message.reasoning_details)) {
                    for (const toolCall of choice.message.tool_calls) {
                        const reasoningDetail = choice.message.reasoning_details.find(rd => rd.id === toolCall.id);
                        if (reasoningDetail && reasoningDetail.type === 'reasoning.encrypted' && reasoningDetail.data) {
                            toolCall.signature = reasoningDetail.data;
                        }
                    }
                }

                return choice.message.tool_calls;
            }
        }

        // Claude tool calls to OpenAI tool calls
        if (Array.isArray(data?.content)) {
            const content = data.content.filter(c => c.type === 'tool_use').map(convertClaudeToolCall);

            if (content) {
                return content;
            }
        }

        // Cohere tool calls
        if (typeof data?.message?.tool_calls === 'object') {
            return Array.isArray(data?.message?.tool_calls) ? data.message.tool_calls : [data.message.tool_calls];
        }
    }
static toolCallsFrom(data) { return this.#getToolCallsFromData(data) || []; }
}
