// 陪伴会话的有界工具循环：先执行 Go，再把原始执行体送回上游。
// 许可：AGPL-3.0-only（见目录 README；ADR-0009 §3）。

import crypto from 'node:crypto';
import { BridgeError, upstreamErrorText, writeErrorResponse } from './errors.js';
import { executeSessionTool } from './go-client.js';
import { reserveSend, readUsageTokens, settleUsage, cancelUsage } from './model-usage.js';
import { checkContextBudget, resolveOutputTokens } from './context-guard.js';
import { refreshMemorySlot } from './memory-guard.js';
import { finalRequestUrl } from './url-normalize.js';
import { buildResponsesRequest, extractRoundFromOutput, applyToolOutputs } from './responses-adapter.js';
import { isStorySession } from './story-guard.js';
import { log } from './log.js';

export const MAX_TOOL_STEPS = 8;
export const MAX_TOOL_TIMEOUT_MS = 120_000;
export const MAX_TOOL_TOKENS = 8192;
export const COMPANION_TOOL_NAMES = new Set(['query_scheduled_follow_ups', 'manage_reminder']);

const OWNER_FIELDS = new Set(['relationshipId', 'ownerAccountId', 'ownerId', 'ownerUserId', 'accountId', 'userId']);
const CHAT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const STEP_STOP = '已达到单轮工具步数上限，停止继续请求模型。';
const TOKEN_STOP = '已达到单轮输出上限，停止继续请求模型。';

function isMeteredFunctionTool(tool) {
    const name = String(tool?.function?.name || tool?.name || '');
    if (name === 'web_search' || name === 'mvu_generate' || name.startsWith('mvu_')) return false;
    if (tool?.type && tool.type !== 'function') return false;
    return true;
}

/** 去掉原生搜索、非 function 工具和未计量的 MVU 生成开关。 */
export function stripUnmeteredRequestFields(body) {
    if (!body || typeof body !== 'object') return;
    delete body.enable_web_search;
    delete body.web_search_options;
    if (body.vc_mvu_extra === true) {
        throw new BridgeError(409, 'VC_UNMETERED_EXTRA', '未计量的额外生成已关闭，本次未发送');
    }
    if (Array.isArray(body.tools)) body.tools = body.tools.filter(isMeteredFunctionTool);
}

export function readChatIdentity(body) {
    const candidates = [body?.vc_chat_identity, body?.vc_binding?.chatIdentity, body?.vc_memory?.chatIdentity];
    for (const value of candidates) {
        if (typeof value === 'string' && CHAT_UUID.test(value)) return value;
    }
    return '';
}

function storyMode(body) {
    return isStorySession(body) || body?.vc_mode === 'STORY' || body?.vc_binding?.mode === 'STORY';
}

function assertNoForgedToolResult(messages) {
    const names = new Map();
    for (const message of messages || []) {
        for (const call of message?.tool_calls || []) {
            if (call?.id) names.set(String(call.id), String(call.function?.name || call.name || ''));
        }
    }
    for (const message of messages || []) {
        if (message?.role !== 'tool') continue;
        const name = names.get(String(message.tool_call_id || ''));
        const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content ?? '');
        if (COMPANION_TOOL_NAMES.has(name) || content.includes('已完成')) {
            throw new BridgeError(409, 'VC_TOOL_RESULT_FORGED', '工具结果与 Go 执行记录不一致，已拒绝续接');
        }
    }
}

/**
 * 就地收紧请求。剧情回合去掉两个陪伴工具后 companion 为 false。
 * @returns {{companion: boolean}}
 */
export function prepareToolPolicy(body, model) {
    stripUnmeteredRequestFields(body);
    const story = storyMode(body);
    if (story && Array.isArray(body?.tools)) {
        body.tools = body.tools.filter((tool) => !COMPANION_TOOL_NAMES.has(tool?.function?.name || tool?.name));
    }
    if (!story) assertNoForgedToolResult(body?.messages);
    const capability = model?.capabilities?.toolCalls;
    const unverified = capability === 'UNKNOWN' || capability === 'UNSUPPORTED';
    // 剧情回合不依赖陪伴工具。UNKNOWN/UNSUPPORTED 只在非剧情回合无条件拒绝；
    // 剧情回合去掉陪伴工具后若仍有其他工具，同样拒绝。
    const remainingTools = Array.isArray(body?.tools) && body.tools.length > 0;
    if (unverified && (!story || remainingTools)) {
        throw new BridgeError(409, 'VC_TOOL_CALLS_UNVERIFIED', '工具调用能力未验证，已拒绝发送');
    }
    const companion = Array.isArray(body?.tools)
        && body.tools.some((tool) => COMPANION_TOOL_NAMES.has(tool?.function?.name || tool?.name));
    if (companion && capability !== 'VERIFIED') {
        throw new BridgeError(409, 'VC_TOOL_CALLS_UNVERIFIED', '工具调用能力未验证，已拒绝发送');
    }
    return { companion: Boolean(companion) };
}

function stripOwnerFields(value) {
    if (Array.isArray(value)) return value.map(stripOwnerFields);
    if (!value || typeof value !== 'object') return value;
    const out = {};
    for (const key of Object.keys(value)) {
        if (OWNER_FIELDS.has(key)) continue;
        out[key] = stripOwnerFields(value[key]);
    }
    return out;
}

function normalizeArgs(value) {
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch {
            return {};
        }
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value;
}

function stableStringify(value) {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

export function canonicalArguments(value) {
    return stableStringify(stripOwnerFields(normalizeArgs(value)));
}

export function idempotencyKey(tool, args) {
    let key = `${tool}.${canonicalArguments(args)}`.replace(/[^A-Za-z0-9._:~-]/g, '');
    if (key.length < 8) key = `${key}.tool`.padEnd(8, '0');
    if (key.length > 200) key = `${key.slice(0, 120)}~${key.slice(-79)}`;
    return key;
}

function textOf(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('');
    return '';
}

function requestedOutput(body) {
    return body.max_completion_tokens !== undefined && body.max_completion_tokens !== null
        ? body.max_completion_tokens
        : body.max_tokens;
}

function sessionPieces(request) {
    const pairs = String(request.headers?.cookie || '').split(';').map((part) => part.trim()).filter(Boolean);
    const kept = pairs.filter((part) => /^(vc_session|vc_csrf)=/.test(part));
    const csrf = kept.find((part) => part.startsWith('vc_csrf='));
    const originHeader = request.headers?.origin;
    const host = request.headers?.host;
    const origin = typeof originHeader === 'string' && originHeader.trim()
        ? originHeader
        : (typeof host === 'string' && host.trim() ? `http://${host}` : '');
    return {
        cookieHeader: kept.join('; '),
        csrfToken: csrf ? decodeURIComponent(csrf.slice('vc_csrf='.length)) : '',
        origin,
        expectedAccountId: request.headers?.['x-vc-expected-account-id'] || '',
        expectedSessionId: request.headers?.['x-vc-expected-session-id'] || '',
    };
}

function isAbort(error) {
    const name = error?.name;
    const cause = error?.cause?.name;
    return name === 'TimeoutError' || name === 'AbortError' || error?.code === 'ABORT_ERR'
        || cause === 'TimeoutError' || cause === 'AbortError';
}

function writeCompletion(response, body, content, usage) {
    const completion = {
        id: `chatcmpl-vc-${Date.now().toString(36)}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: body.model || '',
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
        ...(usage ? { usage } : {}),
    };
    if (body.stream === true) {
        response.statusCode = 200;
        response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        response.setHeader('Cache-Control', 'no-cache');
        const chunk = (delta, finish) => ({
            id: completion.id,
            object: 'chat.completion.chunk',
            created: completion.created,
            model: completion.model,
            choices: [{ index: 0, delta, finish_reason: finish }],
        });
        response.write(`data: ${JSON.stringify(chunk({ role: 'assistant', content }, null))}\n\n`);
        response.write(`data: ${JSON.stringify({ ...chunk({}, 'stop'), ...(usage ? { usage } : {}) })}\n\n`);
        response.write('data: [DONE]\n\n');
        response.end();
        return;
    }
    response.statusCode = 200;
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Cache-Control', 'no-store');
    response.end(JSON.stringify(completion));
}

function chatUsage(tokens) {
    if (!tokens) return undefined;
    return {
        prompt_tokens: tokens.inputTokens,
        completion_tokens: tokens.outputTokens,
        total_tokens: tokens.inputTokens + tokens.outputTokens,
    };
}

function extractCalls(protocol, json) {
    if (protocol === 'OPENAI_RESPONSES') {
        const round = extractRoundFromOutput(json?.output);
        return {
            text: round.text || '',
            calls: round.toolCalls.map((call) => ({
                id: String(call.id || ''),
                name: String(call.function?.name || ''),
                arguments: String(call.function?.arguments ?? ''),
            })),
        };
    }
    if (protocol === 'ANTHROPIC_MESSAGES') {
        const calls = [];
        let text = '';
        for (const block of json?.content || []) {
            if (block?.type === 'text' && typeof block.text === 'string') text += block.text;
            if (block?.type === 'tool_use') {
                calls.push({
                    id: String(block.id || ''),
                    name: String(block.name || ''),
                    arguments: JSON.stringify(block.input ?? {}),
                });
            }
        }
        return { text, calls };
    }
    const message = json?.choices?.[0]?.message ?? {};
    const calls = (message.tool_calls || []).map((call) => ({
        id: String(call.id || ''),
        name: String(call.function?.name || ''),
        arguments: typeof call.function?.arguments === 'string'
            ? call.function.arguments
            : JSON.stringify(call.function?.arguments ?? {}),
    }));
    return { text: textOf(message.content), calls };
}

function providerBody(protocol, body, messages, model, outputCap) {
    const tools = (body.tools || []).filter(isMeteredFunctionTool);
    if (protocol === 'OPENAI_RESPONSES') {
        const source = {
            messages,
            model: model.modelId,
            max_tokens: outputCap,
            stream: false,
            tools,
        };
        if (body.temperature != null && body.temperature !== '') source.temperature = body.temperature;
        if (body.top_p != null && body.top_p !== '') source.top_p = body.top_p;
        if (body.reasoning_effort != null && body.reasoning_effort !== '') source.reasoning_effort = body.reasoning_effort;
        if (body.tool_choice != null) source.tool_choice = body.tool_choice;
        return buildResponsesRequest({ body: source, model }).requestBody;
    }
    if (protocol === 'ANTHROPIC_MESSAGES') return anthropicBody(tools, messages, model, outputCap, body);
    const outbound = {
        model: model.modelId,
        messages,
        stream: false,
        max_tokens: outputCap,
    };
    if (tools.length) outbound.tools = tools;
    if (body.temperature != null && body.temperature !== '') outbound.temperature = body.temperature;
    if (body.top_p != null && body.top_p !== '') outbound.top_p = body.top_p;
    if (body.reasoning_effort != null && body.reasoning_effort !== '') outbound.reasoning_effort = body.reasoning_effort;
    if (body.tool_choice != null) outbound.tool_choice = body.tool_choice;
    return outbound;
}

function anthropicBody(tools, messages, model, outputCap, body) {
    const system = [];
    const converted = [];
    for (const message of messages) {
        if (message.role === 'system') {
            const text = textOf(message.content);
            if (text) system.push(text);
            continue;
        }
        if (message.role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length) {
            const content = [];
            const text = textOf(message.content);
            if (text) content.push({ type: 'text', text });
            for (const call of message.tool_calls) {
                let input = {};
                try {
                    input = JSON.parse(call.function?.arguments || '{}');
                } catch { /* 无法解析的参数按空对象交给上游 */ }
                content.push({ type: 'tool_use', id: call.id, name: call.function?.name, input });
            }
            converted.push({ role: 'assistant', content });
            continue;
        }
        if (message.role === 'tool') {
            const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content ?? '');
            converted.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: message.tool_call_id, content }] });
            continue;
        }
        converted.push({
            role: message.role === 'assistant' ? 'assistant' : 'user',
            content: textOf(message.content),
        });
    }
    const merged = [];
    for (const message of converted) {
        const prev = merged.at(-1);
        if (prev && prev.role === 'user' && message.role === 'user') {
            const left = Array.isArray(prev.content) ? prev.content : [{ type: 'text', text: String(prev.content || '') }];
            const right = Array.isArray(message.content) ? message.content : [{ type: 'text', text: String(message.content || '') }];
            prev.content = [...left, ...right];
            continue;
        }
        merged.push(message);
    }
    const request = { model: model.modelId, max_tokens: outputCap, messages: merged, stream: false };
    if (system.length) request.system = system.join('\n\n');
    if (tools.length) {
        request.tools = tools.filter((tool) => tool?.function?.name).map((tool) => ({
            name: tool.function.name,
            ...(tool.function.description ? { description: tool.function.description } : {}),
            input_schema: tool.function.parameters ?? { type: 'object', properties: {} },
        }));
    }
    if (body.temperature != null && body.temperature !== '') request.temperature = body.temperature;
    if (body.top_p != null && body.top_p !== '') request.top_p = body.top_p;
    return request;
}

async function cancelQuiet(config, reservation, disposition) {
    if (!reservation?.reservationId) return;
    try {
        await cancelUsage(config, reservation.reservationId, {
            ownerAccountId: reservation.ownerAccountId,
            disposition,
        });
    } catch { /* 记账失败不掩盖上游结果 */ }
}

/**
 * 插件独占陪伴工具回合。出站工具结果等于 Go 的原始执行体。
 * @returns {Promise<boolean>}
 */
export async function runBoundedToolLoop({ config, request, response, body, resolved, session, counter, fetchImpl, now }) {
    const protocol = resolved.provider.protocol;
    const model = resolved.model;
    const outputCap = resolveOutputTokens(requestedOutput(body), model.maxOutputTokens);
    const tokenLimit = Math.min(MAX_TOOL_TOKENS, Math.max(1, Math.trunc(Number(outputCap))));
    const turnMs = Math.min(MAX_TOOL_TIMEOUT_MS, Math.max(1, Number(config.timeoutMs) || 1));
    const deadline = now() + turnMs;
    const remainingMs = () => Math.max(1, deadline - now());
    const chatIdentity = readChatIdentity(body);
    const sessionAuth = sessionPieces(request);
    const modelRevision = `provider:${resolved.provider.revision};binding:${resolved.bindingRevision}`.slice(0, 128);
    const messages = JSON.parse(JSON.stringify(Array.isArray(body.messages) ? body.messages : []));
    const cache = new Map();
    let sends = 0;
    let executions = 0;
    let completionSum = 0;

    const stop = (content) => {
        writeCompletion(response, body, content);
        return true;
    };

    while (sends < MAX_TOOL_STEPS) {
        if (sends > 0 && completionSum + tokenLimit > MAX_TOOL_TOKENS) return stop(TOKEN_STOP);
        const outbound = providerBody(protocol, body, messages, model, tokenLimit);
        const signal = AbortSignal.timeout(remainingMs());
        await refreshMemorySlot({ config, request, response, finalBody: outbound, signal });
        const budget = checkContextBudget({ model, finalBody: outbound, outputTokens: tokenLimit, counter });
        const purpose = sends === 0 ? 'FOREGROUND_CHAT' : 'TOOL_TURN';
        const reserved = await reserveSend(config, {
            ownerAccountId: session.accountId,
            purpose,
            attemptId: crypto.randomUUID(),
            providerId: resolved.provider.providerId,
            modelId: model.modelId,
            estimatedInputTokens: Math.max(0, Math.round(Number(budget.estimatedInputTokens) || 0)),
            estimatedOutputTokens: tokenLimit,
        });
        const reservation = reserved?.reservationId
            ? { reservationId: reserved.reservationId, ownerAccountId: session.accountId }
            : null;
        let upstream;
        try {
            const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
            if (protocol === 'ANTHROPIC_MESSAGES') {
                headers['x-api-key'] = resolved.provider.credential;
                headers['anthropic-version'] = '2023-06-01';
            } else {
                headers.Authorization = `Bearer ${resolved.provider.credential}`;
            }
            upstream = await fetchImpl(finalRequestUrl(protocol, resolved.provider), {
                method: 'POST',
                headers,
                body: JSON.stringify(outbound),
                signal: AbortSignal.timeout(remainingMs()),
            });
        } catch (error) {
            await cancelQuiet(config, reservation, 'UNKNOWN');
            if (error instanceof BridgeError) throw error;
            if (isAbort(error)) throw new BridgeError(504, 'VC_UPSTREAM_TIMEOUT', '上游模型服务响应超时');
            throw error;
        }
        if (!upstream.ok) {
            await cancelQuiet(config, reservation, 'UNKNOWN');
            writeErrorResponse(response, 502, 'VC_UPSTREAM_ERROR', upstreamErrorText(upstream.status, upstream.statusText));
            return true;
        }
        let json = null;
        try {
            json = await upstream.json();
        } catch { /* 没有可解析的用量 */ }
        const usage = readUsageTokens(json?.usage);
        if (!json || !usage) {
            await cancelQuiet(config, reservation, 'UNKNOWN');
            throw new BridgeError(502, 'VC_USAGE_UNKNOWN', '上游没有返回用量，本次预留已标为未知');
        }
        if (reservation) {
            try {
                await settleUsage(config, reservation.reservationId, {
                    ownerAccountId: reservation.ownerAccountId,
                    inputTokens: usage.inputTokens,
                    outputTokens: usage.outputTokens,
                });
            } catch (error) {
                await cancelQuiet(config, reservation, 'UNKNOWN');
                throw error;
            }
        }
        completionSum += usage.outputTokens;
        sends += 1;
        const extracted = extractCalls(protocol, json);
        if (!extracted.calls.length) {
            writeCompletion(response, body, extracted.text, chatUsage(usage));
            return true;
        }
        if (!chatIdentity) {
            throw new BridgeError(409, 'VC_CHAT_UNBOUND', '当前会话没有绑定的聊天身份，工具未执行，也未继续请求模型');
        }
        const jobs = [];
        const seen = new Set();
        for (const call of extracted.calls) {
            const key = idempotencyKey(call.name, call.arguments);
            if (cache.has(key) || seen.has(key)) {
                jobs.push({ call, key, cached: true });
                continue;
            }
            seen.add(key);
            if (executions >= MAX_TOOL_STEPS) {
                jobs.push({ call, key, skipped: true });
                continue;
            }
            executions += 1;
            jobs.push({ call, key, step: executions });
        }
        const pending = new Map();
        const materialize = (job) => {
            if (cache.has(job.key)) return Promise.resolve(cache.get(job.key));
            if (pending.has(job.key)) return pending.get(job.key);
            const task = executeJob(job).then((text) => {
                cache.set(job.key, text);
                return text;
            });
            pending.set(job.key, task);
            return task;
        };
        const executeJob = async (job) => {
            const parsed = await executeSessionTool(config, {
                ...sessionAuth,
                signal: AbortSignal.timeout(remainingMs()),
                payload: {
                    chatIdentity,
                    idempotencyKey: job.key,
                    tool: job.call.name,
                    arguments: stripOwnerFields(normalizeArgs(job.call.arguments)),
                    purpose: 'TOOL_TURN',
                    modelRevision,
                    step: job.step,
                    timeoutMs: turnMs,
                    tokenLimit,
                },
            });
            let row = null;
            try {
                row = parsed.text ? JSON.parse(parsed.text) : null;
            } catch { /* 非 JSON 不能当成执行记录 */ }
            if (!parsed.ok || !row?.executionId) {
                throw new BridgeError(502, 'VC_TOOL_EXECUTE_FAILED', '工具执行失败，已停止继续请求模型');
            }
            return parsed.text;
        };
        let chain = Promise.resolve();
        for (const job of jobs) {
            if (job.skipped) continue;
            if (job.call.name === 'manage_reminder') {
                const run = chain.then(() => materialize(job));
                chain = run.then(() => undefined, () => undefined);
                job.done = run;
            } else {
                job.done = materialize(job);
            }
        }
        try {
            await Promise.all(jobs.filter((job) => job.done).map((job) => job.done));
        } catch (error) {
            if (error instanceof BridgeError) throw error;
            if (isAbort(error)) throw new BridgeError(504, 'VC_UPSTREAM_TIMEOUT', '上游模型服务响应超时');
            throw new BridgeError(502, 'VC_TOOL_EXECUTE_FAILED', '工具执行失败，已停止继续请求模型');
        }
        if (jobs.some((job) => job.skipped)) return stop(STEP_STOP);
        const outputs = {};
        messages.push({
            role: 'assistant',
            content: extracted.text || '',
            tool_calls: extracted.calls.map((call) => ({
                id: call.id,
                type: 'function',
                function: { name: call.name, arguments: call.arguments },
            })),
        });
        for (const job of jobs) {
            const text = cache.get(job.key);
            outputs[job.call.id] = text;
            messages.push({ role: 'tool', tool_call_id: job.call.id, content: text });
        }
        applyToolOutputs(messages, outputs);
    }
    log.info(`工具循环达到步数上限：model=${model.modelId} sends=${sends}`);
    return stop(STEP_STOP);
}
