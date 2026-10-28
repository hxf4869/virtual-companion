// Virtual Companion ST 桥接插件 — OpenAI Responses 协议适配。
// 许可：AGPL-3.0-only（见目录 README；ADR-0009 §3）。
// 事实依据（官方当前接口，非记忆）：
//  - POST /v1/responses 请求参数没有 stop/seed/logit_bias/presence_penalty/
//    frequency_penalty/n/logprobs；有 temperature/top_p/top_logprobs/max_output_tokens/
//    reasoning.effort/text.format/tools/tool_choice/parallel_tool_calls/truncation/store/include
//    （openai-node ResponseCreateParamsBase，2026-10 核对）；
//  - 工具回合续接需把 reasoning item（encrypted_content，经 include 请求）与
//    function_call/function_call_output 一并回传；跨回合 reasoning 会被上游丢弃
//    （developers.openai.com cookbook：responses_api/reasoning_items）。
//  - ST 1.19.0 前端把 CUSTOM 源按 OpenAI Chat Completions 分片解析
//    （choices[].delta.content / delta.tool_calls[].index 累积 / delta.reasoning_content），
//    故流式桥接重组为 chat chunk SSE，非流式重组为 chat completion JSON。
// 范围约束：reasoning 续接只在同一受控工具回合内（用户+配置指纹+call_id，一次性消费）；
// 不使用 conversation/previous_response_id，不跨新用户回合继承远端历史（ARCH §17.2）。

import { BridgeError } from './errors.js';
import { log } from './log.js';

const RESPONSES_PARAM_ALLOWLIST = new Set([
    'temperature', 'top_p', 'top_logprobs', 'truncation', 'parallel_tool_calls',
    'metadata', 'user', 'service_tier', 'text', 'reasoning', 'tools', 'tool_choice',
    'max_output_tokens', 'include',
]);
const RESPONSES_EXCLUDABLE = new Set(['temperature', 'top_p', 'top_logprobs', 'reasoning', 'truncation', 'parallel_tool_calls']);

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function rejectParams(rejected) {
    const names = rejected.map((r) => r.param).join('、');
    throw new BridgeError(
        400,
        'VC_PARAMS_UNSUPPORTED',
        `以下请求参数在 OpenAI Responses 协议无对应字段，已明确拒绝而非静默丢弃：${names}`,
        { rejected },
    );
}

/** content（string | OpenAI parts）→ Responses 消息 content（string | input_text/input_image parts）。 */
function mapContent(content, where, rejected) {
    if (content == null) return '';
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) {
        rejected.push({ param: `${where}.content`, reason: '内容既不是字符串也不是分片数组' });
        return '';
    }
    const parts = [];
    let asText = true;
    for (const part of content) {
        if (part?.type === 'text' && typeof part.text === 'string') {
            parts.push({ type: 'input_text', text: part.text });
        } else if (part?.type === 'image_url' && typeof part?.image_url?.url === 'string') {
            parts.push({ type: 'input_image', image_url: part.image_url.url });
            asText = false;
        } else {
            rejected.push({ param: `${where}.content[]`, reason: `不支持的内容分片类型：${part?.type ?? String(part)}` });
        }
    }
    if (asText && parts.every((p) => p.type === 'input_text')) {
        return parts.map((p) => p.text).join('');
    }
    return parts;
}

function contentToText(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content.map((p) => (typeof p?.text === 'string' ? p.text : '')).join('');
    return '';
}

/** 用调用方给出的工具结果覆盖对应 tool 消息。字符串原样保留，供 Responses 映射。 */
export function applyToolOutputs(messages, outputsByCallId) {
    if (!Array.isArray(messages) || !outputsByCallId) return messages;
    for (const message of messages) {
        if (message?.role !== 'tool' || !message.tool_call_id) continue;
        if (Object.prototype.hasOwnProperty.call(outputsByCallId, message.tool_call_id)) {
            message.content = outputsByCallId[message.tool_call_id];
        }
    }
    return messages;
}

/** 找到末尾的受控工具回合（assistant(tool_calls) + 其后全部 tool 结果）在 messages 中的起点。 */
function trailingToolRoundStart(messages) {
    let i = messages.length;
    while (i > 0 && messages[i - 1]?.role === 'tool') i -= 1;
    if (i > 0 && Array.isArray(messages[i - 1]?.tool_calls) && messages[i - 1].tool_calls.length > 0) {
        return i - 1;
    }
    return -1;
}

/**
 * ST 推理等级 → Responses reasoning.effort（与 ST 原生 OpenAI 源的 getReasoningEffort 同语义）：
 * 'auto' 表示不显式指定（返回 undefined，不发送）；'min'→'minimal'、'max'→'xhigh'；
 * 其余（low/medium/high/none 与 Go 钉住的扩展值）原样透传。
 */
export function mapReasoningEffort(raw) {
    if (raw === undefined || raw === null) return undefined;
    const value = String(raw).trim();
    if (value === '' || value === 'auto') return undefined;
    if (value === 'min') return 'minimal';
    if (value === 'max') return 'xhigh';
    return value;
}

/**
 * 把 ST 的 Chat Completions 形态 generate body 转成 Responses 请求体。
 * @param {object} args
 * @param {object} args.body ST /generate 的 request.body（switch 前的原始形态）
 * @param {object} args.model Go resolve 的 model（modelId/generationParams）
 * @param {Array} [args.continuationItems] 本回合注入的 reasoning items（可为空）
 * @returns {{requestBody: object, outputTokens: number}}
 */
export function buildResponsesRequest({ body, model, continuationItems = [] }) {
    const rejected = [];
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
        throw new BridgeError(400, 'VC_MESSAGES_INVALID', 'Responses 适配需要非空 messages 数组（文本补全模式不支持）');
    }

    // —— 显式参数策略：可映射的映射，无对应字段的拒绝，零值视为协议缺省不发送 ——
    const has = (v) => v !== undefined && v !== null;
    if (has(body.stop) && (Array.isArray(body.stop) ? body.stop.length > 0 : String(body.stop) !== '')) {
        rejected.push({ param: 'stop', reason: 'Responses API 无 stop/stop_sequences 参数' });
    }
    if (has(body.seed) && typeof body.seed === 'number') {
        rejected.push({ param: 'seed', reason: 'Responses API 无 seed 参数' });
    }
    if (isPlainObject(body.logit_bias) && Object.keys(body.logit_bias).length > 0) {
        rejected.push({ param: 'logit_bias', reason: 'Responses API 无 logit_bias 参数' });
    }
    for (const p of ['presence_penalty', 'frequency_penalty']) {
        if (has(body[p]) && Number(body[p]) !== 0) {
            rejected.push({ param: p, reason: `Responses API 无 ${p} 参数，且当前值非 0（非协议缺省）` });
        }
    }
    if (has(body.top_k) && Number(body.top_k) > 0) {
        rejected.push({ param: 'top_k', reason: 'Responses API 无 top_k 参数' });
    }
    if (has(body.n) && Number(body.n) > 1) {
        rejected.push({ param: 'n', reason: 'Responses API 不支持多选（n>1）' });
    }
    if (rejected.length) rejectParams(rejected);

    // —— input items ——
    const roundStart = trailingToolRoundStart(body.messages);
    const input = [];
    for (let index = 0; index < body.messages.length; index++) {
        const message = body.messages[index];
        if (!isPlainObject(message)) {
            throw new BridgeError(400, 'VC_MESSAGES_INVALID', `messages[${index}] 不是对象`);
        }
        if (index === roundStart && continuationItems.length > 0) {
            input.push(...continuationItems);
        }
        if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
            if (message.role !== 'assistant') {
                rejected.push({ param: `messages[${index}].tool_calls`, reason: `只有 assistant 消息可携带 tool_calls（当前 ${message.role}）` });
                continue;
            }
            for (const call of message.tool_calls) {
                if (!call?.id || !call?.function?.name) {
                    rejected.push({ param: `messages[${index}].tool_calls[]`, reason: 'tool call 缺少 id 或 function.name' });
                    continue;
                }
                input.push({
                    type: 'function_call',
                    call_id: call.id,
                    name: call.function.name,
                    arguments: typeof call.function.arguments === 'string' ? call.function.arguments : JSON.stringify(call.function.arguments ?? {}),
                });
            }
            // assistant 文本与工具调用同消息时，文本仍以 assistant 消息回传（置于 function_call 之后）
            const text = contentToText(message.content);
            if (text) input.push({ type: 'message', role: 'assistant', content: text });
            continue;
        }
        if (message.role === 'tool') {
            if (!message.tool_call_id) {
                rejected.push({ param: `messages[${index}]`, reason: 'tool 消息缺少 tool_call_id' });
                continue;
            }
            input.push({ type: 'function_call_output', call_id: message.tool_call_id, output: contentToText(message.content) });
            continue;
        }
        if (message.role !== 'user' && message.role !== 'assistant' && message.role !== 'system' && message.role !== 'developer') {
            rejected.push({ param: `messages[${index}].role`, reason: `不支持的角色：${message.role}` });
            continue;
        }
        const content = mapContent(message.content, `messages[${index}]`, rejected);
        const item = { type: 'message', role: message.role, content };
        if (typeof message.name === 'string' && message.name) item.name = message.name;
        input.push(item);
    }
    if (rejected.length) rejectParams(rejected);

    const requestBody = {
        model: model.modelId,
        input,
        stream: body.stream === true,
        store: false,
        // 上下文防线已保证不超窗口；禁止上游自动截断导致静默丢上下文。
        truncation: 'disabled',
        include: ['reasoning.encrypted_content'],
    };

    // —— 可映射采样参数（Go 目录 generationParams 优先于 ST 原生值） ——
    const override = model.generationParams ?? {};
    const temperature = has(override.temperature) ? override.temperature : body.temperature;
    const topP = has(override.topP) ? override.topP : body.top_p;
    if (has(temperature)) requestBody.temperature = temperature;
    if (has(topP)) requestBody.top_p = topP;
    if (has(body.logprobs) && Number(body.logprobs) > 0) {
        requestBody.top_logprobs = Math.round(Number(body.logprobs));
        requestBody.include.push('message.output_text.logprobs');
    }
    // ST 推理等级 → reasoning.effort，按 ST 原生 OpenAI 语义映射（public/scripts/openai.js
    // getReasoningEffort）：'auto' = 不显式指定（不发送）、'min'→'minimal'、'max'→'xhigh'，
    // low/medium/high/none 原样；Go 钉住的扩展值（^[a-z0-9_-]{1,32}$）原样透传由上游判定。
    const effortRaw = has(override.reasoningEffort) ? override.reasoningEffort : body.reasoning_effort;
    const effort = mapReasoningEffort(effortRaw);
    if (has(effort)) {
        requestBody.reasoning = { effort };
    }

    // —— 工具 ——
    if (Array.isArray(body.tools) && body.tools.length > 0) {
        const tools = [];
        for (const tool of body.tools) {
            if (tool?.type !== 'function' || !tool?.function?.name) {
                rejected.push({ param: 'tools[]', reason: '仅支持 type=function 的工具定义' });
                continue;
            }
            tools.push({
                type: 'function',
                name: tool.function.name,
                ...(has(tool.function.description) ? { description: tool.function.description } : {}),
                parameters: tool.function.parameters ?? { type: 'object', properties: {} },
            });
        }
        if (rejected.length) rejectParams(rejected);
        if (tools.length) requestBody.tools = tools;
        if (has(body.tool_choice)) {
            const choice = body.tool_choice;
            if (typeof choice === 'string') {
                requestBody.tool_choice = choice;
            } else if (choice?.type === 'function' && (choice.function?.name || choice.name)) {
                requestBody.tool_choice = { type: 'function', name: choice.function?.name ?? choice.name };
            } else {
                rejected.push({ param: 'tool_choice', reason: '无法映射的 tool_choice 形态' });
            }
        }
        if (rejected.length) rejectParams(rejected);
    } else if (has(body.tool_choice) && body.tool_choice !== 'none') {
        rejected.push({ param: 'tool_choice', reason: '未定义 tools 却要求特定 tool_choice' });
        rejectParams(rejected);
    }

    // —— 结构化输出 ——
    if (body.json_schema) {
        if (!body.json_schema.name || !body.json_schema.value) {
            throw new BridgeError(400, 'VC_JSON_SCHEMA_INVALID', 'json_schema 缺少 name 或 value，无法映射到 text.format');
        }
        requestBody.text = {
            format: {
                type: 'json_schema',
                name: body.json_schema.name,
                strict: body.json_schema.strict ?? true,
                schema: body.json_schema.value,
            },
        };
    }

    // —— 输出上限（含推理 token）——
    const requestedOutput = has(body.max_completion_tokens) ? body.max_completion_tokens : body.max_tokens;
    const outputTokens = resolveOutputTokensLocal(requestedOutput, model.maxOutputTokens);
    requestBody.max_output_tokens = outputTokens;

    // —— custom include/exclude（CUSTOM 源透传字段），仅允许可校验的协议参数 ——
    if (isPlainObject(body.custom_include_body) && Object.keys(body.custom_include_body).length > 0) {
        const unknown = Object.keys(body.custom_include_body).filter((k) => !RESPONSES_PARAM_ALLOWLIST.has(k));
        if (unknown.length) {
            rejectParams(unknown.map((k) => ({ param: `custom_include_body.${k}`, reason: '不属于 Responses 协议可校验参数，拒绝以避免静默丢弃' })));
        }
        for (const [key, value] of Object.entries(body.custom_include_body)) {
            if (key === 'include') {
                const merged = new Set([...(requestBody.include ?? []), ...(Array.isArray(value) ? value : [])]);
                requestBody.include = [...merged];
            } else {
                requestBody[key] = value;
            }
        }
    }
    if (isPlainObject(body.custom_exclude_body) && Object.keys(body.custom_exclude_body).length > 0) {
        const unknown = Object.keys(body.custom_exclude_body).filter((k) => !RESPONSES_EXCLUDABLE.has(k));
        if (unknown.length) {
            rejectParams(unknown.map((k) => ({ param: `custom_exclude_body.${k}`, reason: '该字段不属于桥接自行设置的可排除集合' })));
        }
        for (const key of Object.keys(body.custom_exclude_body)) delete requestBody[key];
    }
    if (Array.isArray(requestBody.include) && requestBody.include.length === 0) delete requestBody.include;

    // Go 目录 generationParams 的最终覆盖（在 include/exclude 之后再固定一次，防止被透传改掉约束参数）
    if (has(override.temperature)) requestBody.temperature = override.temperature;
    if (has(override.topP)) requestBody.top_p = override.topP;
    requestBody.store = false;
    requestBody.truncation ??= 'disabled';

    return { requestBody, outputTokens };
}

function resolveOutputTokensLocal(requested, modelMax) {
    if (modelMax != null && requested != null && Number(requested) > Number(modelMax)) {
        throw new BridgeError(400, 'VC_OUTPUT_LIMIT_EXCEEDED', `请求的最大输出 ${requested} 超过模型登记上限 ${modelMax}；请在模型设置页重新加载配置`);
    }
    if (requested != null) return Number(requested);
    if (modelMax != null) return Number(modelMax);
    throw new BridgeError(400, 'VC_OUTPUT_LIMIT_UNSET', '请求未携带输出上限且模型目录未登记 maxOutputTokens，拒绝无界生成');
}

// ---------------------------------------------------------------------------
// 响应方向：Responses → Chat Completions
// ---------------------------------------------------------------------------

function mapUsage(usage) {
    if (!usage) return undefined;
    return {
        prompt_tokens: usage.input_tokens ?? 0,
        completion_tokens: usage.output_tokens ?? 0,
        total_tokens: usage.total_tokens ?? (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
    };
}

function mapLogprobs(contentPart) {
    const logprobs = contentPart?.logprobs;
    if (!Array.isArray(logprobs) || logprobs.length === 0) return undefined;
    return {
        content: logprobs.map((l) => ({
            token: l.token,
            logprob: l.logprob,
            bytes: l.bytes,
            top_logprobs: Array.isArray(l.top_logprobs) ? l.top_logprobs : [],
        })),
    };
}

export function extractRoundFromOutput(output) {
    /** @type {Array} */ const reasoningItems = [];
    /** @type {Array} */ const toolCalls = [];
    let text = '';
    let refusal = null;
    for (const item of output ?? []) {
        if (item?.type === 'message') {
            for (const part of item.content ?? []) {
                if (part?.type === 'output_text' && typeof part.text === 'string') text += part.text;
                if (part?.type === 'refusal' && typeof part.refusal === 'string') refusal = part.refusal;
            }
        } else if (item?.type === 'reasoning') {
            reasoningItems.push({
                type: 'reasoning',
                id: item.id,
                summary: Array.isArray(item.summary) ? item.summary : [],
                ...(item.content ? { content: item.content } : {}),
                ...(item.encrypted_content ? { encrypted_content: item.encrypted_content } : {}),
            });
        } else if (item?.type === 'function_call') {
            toolCalls.push({ id: item.call_id, type: 'function', function: { name: item.name, arguments: item.arguments ?? '' } });
        }
    }
    return { reasoningItems, toolCalls, text, refusal };
}

export function chatFinishReason({ toolCalls, incompleteReason }) {
    if (toolCalls.length > 0) return 'tool_calls';
    if (incompleteReason === 'max_output_tokens') return 'length';
    if (incompleteReason === 'content_filter') return 'content_filter';
    return 'stop';
}

/** 非流式：Responses 响应 → ST 可消费的 chat completion JSON。 */
export function convertResponsesToChatCompletion(responseJson) {
    const round = extractRoundFromOutput(responseJson.output);
    const finish = chatFinishReason({ toolCalls: round.toolCalls, incompleteReason: responseJson.incomplete_details?.reason });
    const message = { role: 'assistant', content: round.text || round.refusal || null };
    const reasoningText = [
        ...round.reasoningItems.flatMap((r) => (r.content ?? []).map((c) => c.text)),
        ...round.reasoningItems.flatMap((r) => (r.summary ?? []).map((s) => s.text)),
    ].join('');
    if (reasoningText) message.reasoning_content = reasoningText;
    if (round.toolCalls.length) message.tool_calls = round.toolCalls;
    const messageLogprobs = mapLogprobs((responseJson.output ?? []).find((i) => i?.type === 'message')?.content?.[0]);
    const choice = { index: 0, message, finish_reason: finish, ...(messageLogprobs ? { logprobs: messageLogprobs } : {}) };
    return {
        id: responseJson.id ?? `chatcmpl-${Math.random().toString(36).slice(2)}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: responseJson.model ?? '',
        choices: [choice],
        ...(mapUsage(responseJson.usage) ? { usage: mapUsage(responseJson.usage) } : {}),
    };
}

// ---------------------------------------------------------------------------
// 流式：Responses SSE → OpenAI chat chunk SSE
// ---------------------------------------------------------------------------

class SseBuffer {
    constructor() { this.buf = ''; this.decoder = new TextDecoder(); }
    /** @returns {Array<string>} 完整 data 负载 */
    push(chunk) {
        const text = typeof chunk === 'string' ? chunk : this.decoder.decode(chunk, { stream: true });
        this.buf += text;
        const payloads = [];
        let idx;
        while ((idx = this.buf.indexOf('\n\n')) >= 0) {
            const block = this.buf.slice(0, idx);
            this.buf = this.buf.slice(idx + 2);
            for (const line of block.split('\n')) {
                if (line.startsWith('data:')) payloads.push(line.slice(5).trim());
            }
        }
        return payloads;
    }
}

/**
 * 桥接流式响应。完成后调用 onRoundFinished（仅 completed/incomplete 且非 abort）。
 * @param {object} args
 * @param {import('node:http').IncomingMessage|Response} args.upstream fetch 响应
 * @param {import('node:http').ServerResponse} args.res ST 客户端响应
 * @param {(round: {ok: boolean, reasoningItems: Array, callIds: string[], finishReason: string, usage: object|undefined}) => void} [args.onRoundFinished]
 */
export async function bridgeResponsesStream({ upstream, res, onRoundFinished }) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    const id = `chatcmpl-${Math.random().toString(36).slice(2)}`;
    const created = Math.floor(Date.now() / 1000);
    const modelName = '';
    const write = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
    const chunk = (delta, finish = null, extra = {}) => ({
        id, object: 'chat.completion.chunk', created, model: modelName,
        choices: [{ index: 0, delta, finish_reason: finish, ...extra }],
    });

    const callIndexByOutputIndex = new Map();
    let callCounter = 0;
    /** @type {Map<string, {id: string, name: string, arguments: string}>} */
    const trackedCalls = new Map();
    let sawToolCall = false;
    let roundCommitted = false;
    const reasoningItems = [];
    const buffer = new SseBuffer();

    const finishRound = async (finishReason, usage, responseJson) => {
        if (roundCommitted) return;
        roundCommitted = true;
        let items = reasoningItems;
        /** @type {Array<{id: string, name: string, arguments: string}>} */
        let calls = [...trackedCalls.values()].map((c) => ({ ...c }));
        if (responseJson) {
            const extracted = extractRoundFromOutput(responseJson.output);
            if (extracted.reasoningItems.length) items = extracted.reasoningItems;
            if (extracted.toolCalls.length) {
                calls = extracted.toolCalls.map((c) => ({ id: c.id, name: c.function.name, arguments: c.function.arguments }));
            }
        }
        const finalChunk = { ...chunk({}, finishReason), ...(usage ? { usage } : {}) };
        write(finalChunk);
        res.write('data: [DONE]\n\n');
        res.end();
        if (onRoundFinished) await onRoundFinished({ ok: true, reasoningItems: items, calls, finishReason, usage });
    };

    const failRound = async (reason) => {
        if (roundCommitted) { res.end(); return; }
        roundCommitted = true;
        // 固定文案：不回显上游错误消息（可能包含回显正文或敏感值）
        write({ error: { message: reason, code: 'VC_UPSTREAM_STREAM_ERROR' } });
        res.write('data: [DONE]\n\n');
        res.end();
        if (onRoundFinished) await onRoundFinished({ ok: false, reasoningItems: [], calls: [], finishReason: 'error', usage: undefined });
    };

    try {
        for await (const bytes of upstream.body) {
            for (const data of buffer.push(bytes)) {
                if (!data) continue;
                let event;
                try {
                    event = JSON.parse(data);
                } catch {
                    continue;
                }
                switch (event?.type) {
                    case 'response.output_text.delta':
                        write(chunk({ content: event.delta }));
                        break;
                    case 'response.reasoning_summary_text.delta':
                    case 'response.reasoning_text.delta':
                        write(chunk({ reasoning_content: event.delta }));
                        break;
                    case 'response.output_item.added':
                        if (event.item?.type === 'function_call' && event.item.call_id) {
                            sawToolCall = true;
                            const callIndex = callCounter++;
                            callIndexByOutputIndex.set(event.output_index, callIndex);
                            if (!trackedCalls.has(event.item.call_id)) {
                                trackedCalls.set(event.item.call_id, { id: event.item.call_id, name: event.item.name ?? '', arguments: '' });
                            }
                            write(chunk({ tool_calls: [{ index: callIndex, id: event.item.call_id, type: 'function', function: { name: event.item.name ?? '', arguments: '' } }] }));
                        }
                        break;
                    case 'response.function_call_arguments.delta': {
                        const callIndex = callIndexByOutputIndex.get(event.output_index);
                        if (callIndex !== undefined) {
                            write(chunk({ tool_calls: [{ index: callIndex, function: { arguments: event.delta ?? '' } }] }));
                        }
                        break;
                    }
                    case 'response.output_item.done':
                        if (event.item?.type === 'reasoning') {
                            reasoningItems.push({
                                type: 'reasoning',
                                id: event.item.id,
                                summary: Array.isArray(event.item.summary) ? event.item.summary : [],
                                ...(event.item.content ? { content: event.item.content } : {}),
                                ...(event.item.encrypted_content ? { encrypted_content: event.item.encrypted_content } : {}),
                            });
                        } else if (event.item?.type === 'function_call' && event.item.call_id && trackedCalls.has(event.item.call_id)) {
                            const tracked = trackedCalls.get(event.item.call_id);
                            tracked.name = event.item.name ?? tracked.name;
                            if (typeof event.item.arguments === 'string' && event.item.arguments) tracked.arguments = event.item.arguments;
                        }
                        break;
                    case 'response.completed':
                        await finishRound(sawToolCall ? 'tool_calls' : 'stop', mapUsage(event.response?.usage), event.response);
                        return;
                    case 'response.incomplete': {
                        const reason = event.response?.incomplete_details?.reason;
                        const finish = reason === 'max_output_tokens' ? 'length' : reason === 'content_filter' ? 'content_filter' : 'stop';
                        await finishRound(finish, mapUsage(event.response?.usage), event.response);
                        return;
                    }
                    case 'response.failed':
                        await failRound('上游流式生成失败（response.failed）');
                        return;
                    case 'error':
                        await failRound('上游流错误（error 事件）');
                        return;
                    default:
                        break;
                }
            }
        }
        // 上游流自然结束但没有任何终止事件：按协议缺陷处理，不伪造成功。
        await failRound('上游 SSE 流未发送终止事件即结束');
    } catch (error) {
        if (error?.name === 'AbortError' || error?.code === 'ABORT_ERR') {
            roundCommitted = true; // 取消不提交续接状态
            res.end();
            log.info('上游请求被取消，续接状态未提交');
            return;
        }
        throw error;
    }
}

// ---------------------------------------------------------------------------
// 受控工具回合的短生命周期续接存储（进程内；W03 范围）
// 键 = 回合指纹（该回合 assistant function_call 的完整调用清单）；
// 条目绑定 user（ST handle + Go 账号）、配置指纹、scope（projection 携带的当前会话标识）。
// 一次性消费：取用即删除；取消/失败不提交；新用户回合（尾部不再是工具回合）不查表；
// 切换 chat/角色 → scope 变化或回合指纹不匹配 → 不注入。跨回合远端会话平台不存在。
// ---------------------------------------------------------------------------

function roundKey(calls) {
    return JSON.stringify(calls.map((c) => [c.id, c.name, c.arguments]));
}

export class ToolContinuationStore {
    /** @param {{ttlMs?: number, maxEntries?: number}} [options] */
    constructor({ ttlMs = 10 * 60_000, maxEntries = 64 } = {}) {
        this.ttlMs = ttlMs;
        this.maxEntries = maxEntries;
        /** @type {Map<string, {user: string, fingerprint: string, scope: string|undefined, items: Array, memorySnapshot: object|null, expiresAt: number}>} */
        this.entries = new Map();
    }

    /** 仅当本回合产生了工具调用与 reasoning 项时写入一条（按回合指纹键控）。 */
    commit({ user, fingerprint, scope, calls, reasoningItems, memorySnapshot = null }) {
        if (!Array.isArray(calls) || calls.length === 0 || !Array.isArray(reasoningItems) || reasoningItems.length === 0) return;
        this.sweep();
        while (this.entries.size >= this.maxEntries) {
            this.entries.delete(this.entries.keys().next().value);
        }
        this.entries.set(roundKey(calls), { user, fingerprint, scope, items: reasoningItems,
            memorySnapshot: structuredClone(memorySnapshot), expiresAt: Date.now() + this.ttlMs });
    }

    /**
     * 取出并一次性消费。当前请求的尾部工具回合必须与提交时的调用清单逐项完全一致
     * （id、name、arguments），且 user/配置指纹/scope 匹配；任一不符即丢弃不注入。
     */
    take({ user, fingerprint, scope, round, memorySnapshot = null }) {
        this.sweep();
        const key = roundKey(round.calls);
        const entry = this.entries.get(key);
        if (!entry) return [];
        this.entries.delete(key);
        if (entry.user !== user || entry.fingerprint !== fingerprint || entry.scope !== scope) {
            log.info('工具回合续接状态因用户/会话/配置变化被丢弃（不注入）');
            return [];
        }
        if (entry.memorySnapshot?.status === 'skipped' || memorySnapshot?.status === 'skipped'
            || JSON.stringify(entry.memorySnapshot) !== JSON.stringify(memorySnapshot)) {
            throw new BridgeError(409, 'VC_MEMORY_CONTINUATION_CHANGED', '工具回合的长期记忆来源已变化或暂不可核验，请重新发起本轮互动');
        }
        return entry.items;
    }

    discard({ round }) { this.entries.delete(roundKey(round.calls)); }

    sweep() {
        const now = Date.now();
        for (const [key, entry] of this.entries) {
            if (entry.expiresAt <= now) this.entries.delete(key);
        }
    }

    clear() { this.entries.clear(); }
}
