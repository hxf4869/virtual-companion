// Virtual Companion ST 桥接插件 — 剧情回合最终出站重写与核对。
// 许可：AGPL-3.0-only（见目录 README；ADR-0009 §3）。
// STORY 会话在两个最终调用点重写转换后的 body：只保留 Go ActorView 的规范文本、
// 本轮玩家话语、已核对的工具定义与工具记录。角色卡、世界书、宏、EJS 与晚注册追加
// 都不出站。重写前后的文本桶一并交给 Go outbound-check；非通过即不联系上游。

import { BridgeError } from './errors.js';
import { checkStoryOutbound, fetchStoryActorView } from './go-client.js';

const DECIMAL = /^(?:0|[1-9]\d{0,18})$/;
const ACTOR = /^[a-z][a-z0-9_-]{0,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PROTOCOLS = new Set(['OPENAI_CHAT_COMPLETIONS', 'OPENAI_RESPONSES', 'ANTHROPIC_MESSAGES']);

/** 有 vc_story，或显式声明 STORY 会话。两者都没有则按 COMPANION 处理。 */
export function isStorySession(body) {
    if (!body || typeof body !== 'object') return false;
    if (Object.prototype.hasOwnProperty.call(body, 'vc_story')) return true;
    return body.vc_session_mode === 'STORY';
}

/** 剧情回合身份。缺字段、多角色或类型不对都拒绝，不回退原始正文。 */
export function requireStoryIdentity(body) {
    const story = body?.vc_story;
    if (!story || typeof story !== 'object' || Array.isArray(story)) {
        throw new BridgeError(409, 'VC_STORY_IDENTITY_REQUIRED', '剧情会话缺少 vc_story，已拒绝出站');
    }
    if (Object.prototype.hasOwnProperty.call(story, 'actorIds') || Array.isArray(story.actorId)) {
        throw new BridgeError(409, 'VC_STORY_IDENTITY_REQUIRED', '剧情回合一次只能核对一个角色');
    }
    if (typeof story.runId !== 'string' || !DECIMAL.test(story.runId)
        || typeof story.branchId !== 'string' || !DECIMAL.test(story.branchId)
        || typeof story.actorId !== 'string' || !ACTOR.test(story.actorId)
        || typeof story.worldVersion !== 'number' || !Number.isSafeInteger(story.worldVersion) || story.worldVersion < 0
        || typeof story.chatIdentity !== 'string' || !UUID.test(story.chatIdentity)) {
        throw new BridgeError(409, 'VC_STORY_IDENTITY_REQUIRED', '剧情回合身份无效，已拒绝出站');
    }
    return {
        runId: story.runId, branchId: story.branchId, actorId: story.actorId,
        worldVersion: story.worldVersion, chatIdentity: story.chatIdentity,
    };
}

function emptyBuckets() {
    return {
        messages: [], system: [], instructions: [], toolDefinitions: [], toolResults: [],
        hasPreviousResponseId: false, hasConversation: false,
    };
}

function push(list, value) {
    if (typeof value !== 'string' || value === '') return;
    list.push(value);
}

function textOf(content) {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content.map((part) => {
        if (typeof part === 'string') return part;
        if (!part || typeof part !== 'object') return '';
        if (typeof part.text === 'string') return part.text;
        if (typeof part.thinking === 'string') return part.thinking;
        if (typeof part.content === 'string') return part.content;
        if (Array.isArray(part.content)) return textOf(part.content);
        return '';
    }).join('');
}

function present(value) {
    return value !== undefined && value !== null && value !== '' && value !== false;
}

function looseText(value, bucket) {
    if (typeof value === 'string') push(bucket, value);
    else if (Array.isArray(value)) {
        for (const item of value) push(bucket, typeof item === 'string' ? item : JSON.stringify(item));
    } else if (value !== undefined && value !== null) push(bucket, JSON.stringify(value));
}

function walkBlocks(blocks, buckets, destination) {
    for (const block of blocks ?? []) {
        if (typeof block === 'string') { push(buckets[destination], block); continue; }
        if (!block || typeof block !== 'object') continue;
        if (block.type === 'tool_result') {
            push(buckets.toolResults, typeof block.content === 'string' ? block.content : textOf(block.content));
        } else if (block.type === 'tool_use') {
            push(buckets.toolResults, `${block.name ?? ''} ${JSON.stringify(block.input ?? {})}`);
        } else if (block.type === 'thinking') {
            push(buckets.messages, block.thinking);
        } else if (typeof block.text === 'string') {
            push(buckets[destination], block.text);
        }
    }
}

/** 从一种协议形态抽出全部文本桶。空串跳过；工具对象整份序列化，保留调用方附加字段。 */
export function extractOutboundBuckets(body, protocol) {
    const buckets = emptyBuckets();
    if (!body || typeof body !== 'object') return buckets;
    if (protocol === 'OPENAI_RESPONSES' && Array.isArray(body.input)) {
        for (const item of body.input) {
            if (item?.type === 'message') {
                const dest = item.role === 'system' || item.role === 'developer' ? 'system' : 'messages';
                if (Array.isArray(item.content)) walkBlocks(item.content, buckets, dest);
                else push(buckets[dest], textOf(item.content));
            } else if (item?.type === 'function_call') {
                const args = typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments ?? {});
                push(buckets.toolResults, `${item.name ?? ''} ${args}`);
            } else if (item?.type === 'function_call_output') {
                push(buckets.toolResults, typeof item.output === 'string' ? item.output : textOf(item.output));
            } else if (item?.type === 'reasoning') {
                for (const part of item.summary ?? []) push(buckets.messages, part?.text);
                for (const part of item.content ?? []) push(buckets.messages, typeof part?.text === 'string' ? part.text : textOf(part?.content));
                push(buckets.messages, item.encrypted_content);
            }
        }
    }
    if (protocol === 'ANTHROPIC_MESSAGES') {
        if (typeof body.system === 'string') push(buckets.system, body.system);
        else if (Array.isArray(body.system)) walkBlocks(body.system, buckets, 'system');
    }
    if (Array.isArray(body.messages) && protocol !== 'OPENAI_RESPONSES') {
        for (const message of body.messages) {
            if (!message || typeof message !== 'object') continue;
            if (message.role === 'tool') {
                push(buckets.toolResults, textOf(message.content));
                continue;
            }
            if (Array.isArray(message.content) && (protocol === 'ANTHROPIC_MESSAGES' || message.content.some((part) => part?.type))) {
                const dest = message.role === 'system' || message.role === 'developer' ? 'system' : 'messages';
                walkBlocks(message.content, buckets, dest);
            } else if (message.role === 'system' || message.role === 'developer') {
                push(buckets.system, textOf(message.content));
            } else {
                push(buckets.messages, textOf(message.content));
            }
            for (const call of message.tool_calls ?? []) {
                const args = call?.function?.arguments;
                push(buckets.toolResults, typeof args === 'string' ? args : JSON.stringify(args ?? {}));
            }
        }
    }
    if (protocol !== 'ANTHROPIC_MESSAGES' && body.system !== undefined && !Array.isArray(body.messages)) {
        looseText(body.system, buckets.system);
    }
    looseText(body.instructions, buckets.instructions);
    for (const key of ['prompt', 'json_schema', 'response_format']) looseText(body[key], buckets.instructions);
    if (body.text !== undefined) looseText(body.text, buckets.instructions);
    if (Array.isArray(body.tools)) {
        for (const tool of body.tools) push(buckets.toolDefinitions, JSON.stringify(tool));
    }
    buckets.hasPreviousResponseId = present(body.previous_response_id);
    buckets.hasConversation = present(body.conversation);
    return buckets;
}

function mergeBuckets(parts) {
    const out = emptyBuckets();
    for (const part of parts) {
        for (const key of ['messages', 'system', 'instructions', 'toolDefinitions', 'toolResults']) out[key].push(...part[key]);
        out.hasPreviousResponseId = out.hasPreviousResponseId || part.hasPreviousResponseId;
        out.hasConversation = out.hasConversation || part.hasConversation;
    }
    return out;
}

function isToolOnly(message) {
    if (message?.role === 'tool') return true;
    if (!Array.isArray(message?.content) || message.content.length === 0) return false;
    return message.content.every((block) => block?.type === 'tool_result' || block?.type === 'tool_use');
}

function chatPlayer(messages) {
    const list = messages ?? [];
    let end = list.length;
    while (end > 0 && list[end - 1]?.role === 'tool') end -= 1;
    if (end > 0 && Array.isArray(list[end - 1]?.tool_calls) && list[end - 1].tool_calls.length > 0) end -= 1;
    for (let i = end - 1; i >= 0; i -= 1) {
        if (list[i]?.role === 'user') return textOf(list[i].content);
    }
    return '';
}

function anthropicPlayer(messages) {
    const list = messages ?? [];
    let end = list.length;
    while (end > 0 && isToolOnly(list[end - 1])) end -= 1;
    for (let i = end - 1; i >= 0; i -= 1) {
        if (list[i]?.role !== 'user' || isToolOnly(list[i])) continue;
        const text = textOf(list[i].content);
        if (text) return text;
    }
    return '';
}

function responsesPlayer(input) {
    const list = input ?? [];
    let end = list.length;
    while (end > 0 && ['function_call_output', 'function_call', 'reasoning'].includes(list[end - 1]?.type)) end -= 1;
    for (let i = end - 1; i >= 0; i -= 1) {
        if (list[i]?.type === 'message' && list[i].role === 'user') return textOf(list[i].content);
    }
    return '';
}

function chatToolMessages(messages) {
    const list = messages ?? [];
    let end = list.length;
    while (end > 0 && list[end - 1]?.role === 'tool') end -= 1;
    if (end === list.length || end === 0 || !Array.isArray(list[end - 1]?.tool_calls) || list[end - 1].tool_calls.length === 0) return [];
    const calls = list[end - 1].tool_calls.map((call) => ({
        id: String(call?.id ?? ''),
        type: 'function',
        function: {
            name: String(call?.function?.name ?? ''),
            arguments: typeof call?.function?.arguments === 'string' ? call.function.arguments : JSON.stringify(call?.function?.arguments ?? {}),
        },
    }));
    const out = [{ role: 'assistant', content: null, tool_calls: calls }];
    for (const message of list.slice(end)) {
        if (message?.role !== 'tool') continue;
        out.push({ role: 'tool', tool_call_id: String(message.tool_call_id ?? ''), content: textOf(message.content) });
    }
    return out;
}

function isToolResultOnly(message) {
    return Array.isArray(message?.content) && message.content.length > 0
        && message.content.every((block) => block?.type === 'tool_result');
}

function toolResultContent(block) {
    return typeof block?.content === 'string' ? block.content : textOf(block?.content);
}

// 只取贴在末尾的这一轮：assistant 的 tool_use，加上紧随的 tool_result。
// 更早的工具往返留在原文里供核对，但不进入重写后的上游。
function anthropicToolMessages(messages) {
    const list = messages ?? [];
    let end = list.length;
    while (end > 0 && isToolResultOnly(list[end - 1])) end -= 1;
    if (end === list.length || end === 0) return [];
    const assistant = list[end - 1];
    const uses = Array.isArray(assistant?.content) ? assistant.content.filter((block) => block?.type === 'tool_use') : [];
    if (!uses.length) return [];
    const out = [{
        role: 'assistant',
        content: uses.map((block) => ({ type: 'tool_use', id: block.id, name: block.name, input: block.input ?? {} })),
    }];
    for (const message of list.slice(end)) {
        const results = (message?.content ?? []).filter((block) => block?.type === 'tool_result');
        if (!results.length) continue;
        out.push({
            role: 'user',
            content: results.map((block) => ({ type: 'tool_result', tool_use_id: block.tool_use_id, content: toolResultContent(block) })),
        });
    }
    return out;
}

function responsesToolItems(input) {
    const list = input ?? [];
    let end = list.length;
    while (end > 0 && list[end - 1]?.type === 'function_call_output') end -= 1;
    if (end === list.length) return [];
    let start = end;
    while (start > 0 && list[start - 1]?.type === 'function_call') start -= 1;
    if (start === end) return [];
    return list.slice(start).map((item) => (item.type === 'function_call'
        ? {
            type: 'function_call', call_id: String(item.call_id ?? ''), name: String(item.name ?? ''),
            arguments: typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments ?? {}),
        }
        : {
            type: 'function_call_output', call_id: String(item.call_id ?? ''),
            output: typeof item.output === 'string' ? item.output : textOf(item.output),
        }));
}

function sanitizeTools(tools, protocol) {
    if (!Array.isArray(tools)) return undefined;
    const out = [];
    for (const tool of tools) {
        if (protocol === 'ANTHROPIC_MESSAGES') {
            if (!tool?.name) continue;
            out.push({
                name: tool.name,
                description: typeof tool.description === 'string' ? tool.description : '',
                input_schema: tool.input_schema ?? { type: 'object', properties: {} },
            });
        } else if (protocol === 'OPENAI_RESPONSES') {
            const name = tool?.name ?? tool?.function?.name;
            if (!name) continue;
            const description = tool?.description ?? tool?.function?.description;
            out.push({
                type: 'function', name,
                ...(typeof description === 'string' ? { description } : {}),
                parameters: tool?.parameters ?? tool?.function?.parameters ?? { type: 'object', properties: {} },
            });
        } else {
            const fn = tool?.function;
            if (!fn?.name) continue;
            out.push({
                type: 'function',
                function: {
                    name: fn.name,
                    description: typeof fn.description === 'string' ? fn.description : '',
                    parameters: fn.parameters ?? { type: 'object', properties: {} },
                },
            });
        }
    }
    return out;
}

function canonicalView(view, story) {
    if (!view || typeof view !== 'object' || Array.isArray(view)) {
        throw new BridgeError(502, 'VC_STORY_VIEW_FAILED', '剧情视角响应无效');
    }
    if (view.runId !== story.runId || view.branchId !== story.branchId
        || view.actorId !== story.actorId || view.worldVersion !== story.worldVersion) {
        throw new BridgeError(409, 'VC_STORY_VIEW_MISMATCH', '剧情视角与当前回合身份不一致，已拒绝出站');
    }
    const list = (value) => (Array.isArray(value) ? value : []);
    return JSON.stringify({
        conversationId: typeof view.conversationId === 'string' ? view.conversationId : '',
        runId: view.runId,
        branchId: view.branchId,
        actorId: view.actorId,
        worldVersion: view.worldVersion,
        publicLore: {
            setting: view.publicLore?.setting ?? '',
            locations: list(view.publicLore?.locations),
            knownEvent: view.publicLore?.knownEvent ?? '',
        },
        knowledge: list(view.knowledge).map((item) => ({ id: item?.id ?? '', fact: item?.fact ?? '', marker: item?.marker ?? '' })),
        events: list(view.events).map((item) => ({
            eventId: item?.eventId ?? '', actorId: item?.actorId ?? '', worldVersion: item?.worldVersion ?? 0, body: item?.body ?? {},
        })),
        participants: list(view.participants).map((item) => ({
            actorId: item?.actorId ?? '', name: item?.name ?? '', publicPersona: item?.publicPersona ?? '',
        })),
    });
}

function blankOutbound(body) {
    if (!body || typeof body !== 'object') return;
    if (Array.isArray(body.messages)) body.messages = [];
    if (Array.isArray(body.input)) body.input = [];
    if ('system' in body) body.system = '';
    if ('instructions' in body) body.instructions = '';
    if ('tools' in body) body.tools = [];
    for (const key of ['previous_response_id', 'conversation', 'prompt', 'text', 'response_format', 'json_schema']) delete body[key];
}

function rewriteBody(body, protocol, { viewText, player, continuationItems }) {
    const tools = sanitizeTools(body.tools, protocol);
    if (protocol === 'OPENAI_RESPONSES') {
        const input = [{ type: 'message', role: 'system', content: viewText }];
        if (player) input.push({ type: 'message', role: 'user', content: player });
        if (continuationItems?.length) input.push(...continuationItems);
        input.push(...responsesToolItems(body.input));
        body.input = input;
    } else if (protocol === 'ANTHROPIC_MESSAGES') {
        body.system = [{ type: 'text', text: viewText }];
        body.messages = [
            ...(player ? [{ role: 'user', content: player }] : []),
            ...anthropicToolMessages(body.messages),
        ];
    } else {
        body.messages = [
            { role: 'system', content: viewText },
            ...(player ? [{ role: 'user', content: player }] : []),
            ...chatToolMessages(body.messages),
        ];
    }
    if (tools) body.tools = tools;
    for (const key of ['previous_response_id', 'conversation', 'instructions', 'prompt', 'text', 'response_format', 'json_schema']) delete body[key];
}

/**
 * 重写最终 body 并调用 outbound-check。失败时清空文本桶后再抛出。
 * @param {object} args
 * @param {object} args.finalBody 转换后的最终请求，就地改写
 * @param {Array} [args.continuationItems] 已按剧情身份取到的 reasoning items
 */
export async function enforceStoryOutbound({ config, request, finalBody, protocol, ownerAccountId, continuationItems = [], signal }) {
    try {
        const story = requireStoryIdentity(request?.body);
        if (!PROTOCOLS.has(protocol) || typeof ownerAccountId !== 'string' || !DECIMAL.test(ownerAccountId)) {
            throw new BridgeError(409, 'VC_STORY_IDENTITY_REQUIRED', '剧情出站缺少已核验的账号或协议身份');
        }
        const before = mergeBuckets([
            extractOutboundBuckets(finalBody, protocol),
            extractOutboundBuckets(request.body, 'OPENAI_CHAT_COMPLETIONS'),
        ]);
        const player = protocol === 'OPENAI_RESPONSES'
            ? responsesPlayer(finalBody?.input)
            : protocol === 'ANTHROPIC_MESSAGES' ? anthropicPlayer(finalBody?.messages) : chatPlayer(finalBody?.messages);
        const records = protocol === 'OPENAI_RESPONSES'
            ? responsesToolItems(finalBody?.input)
            : protocol === 'ANTHROPIC_MESSAGES' ? anthropicToolMessages(finalBody?.messages) : chatToolMessages(finalBody?.messages);
        if (!player && records.length === 0) {
            throw new BridgeError(409, 'VC_STORY_PLAYER_MISSING', '剧情回合缺少玩家话语，已拒绝出站');
        }
        const view = await fetchStoryActorView(config, { request, signal, ...story });
        rewriteBody(finalBody, protocol, { viewText: canonicalView(view, story), player, continuationItems });
        const merged = mergeBuckets([before, extractOutboundBuckets(finalBody, protocol)]);
        await checkStoryOutbound(config, {
            runId: story.runId, actorId: story.actorId, signal,
            body: {
                ownerAccountId, branchId: story.branchId, worldVersion: story.worldVersion,
                chatIdentity: story.chatIdentity, protocol,
                messages: merged.messages, system: merged.system, instructions: merged.instructions,
                toolDefinitions: merged.toolDefinitions, toolResults: merged.toolResults,
                hasPreviousResponseId: merged.hasPreviousResponseId, hasConversation: merged.hasConversation,
            },
        });
    } catch (error) {
        blankOutbound(finalBody);
        throw error;
    }
}
