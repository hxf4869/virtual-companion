#!/usr/bin/env node
// V2-W03 受管端到端验收 — 固定合成上游 provider（三协议单进程多路由）。
// 许可：AGPL-3.0-only（见 integrations/sillytavern/README；ADR-0009 §3）。
//
// 面向 accept-managed.mjs 的可指令化假上游，覆盖：
//   GET  <base>/models                       固定合成模型清单（含剧本标记模型）
//   POST <base>/chat/completions             OpenAI Chat Completions（SSE 与非流式）
//   POST <base>/responses                    OpenAI Responses（SSE 事件流与非流式同构）
//   POST <base>/messages                     Anthropic Messages（SSE 与非流式）
// 指令化控制（优先级从高到低）：
//   1) 请求体里的合成标记字段 vc_fixture（经 ST CUSTOM 源可用 custom_include_body 注入）；
//   2) 请求头 x-vc-fixture: <JSON>（直接请求自测用）；
//   3) 控制端点 POST /__ctl 设置的按模型或通配覆盖（经 ST 链路改变行为的主通道）；
//   4) modelId 绑定的固定剧本（见 SCRIPTS）。
// 捕获与隐私约束：
//   - 每请求在内存记录 方法/最终 URL/协议/auth 是否匹配合成令牌（只记布尔与方案）/
//     完整请求体/响应状态/耗时/是否中途取消；断言后可经 /__captures/clear 丢弃；
//   - 日志只输出：合成请求 id、协议、端点、状态、计数、耗时；
//     绝不把请求体/响应体/令牌写日志或文件；无任何落盘。
// 管理/控制路由（同样仅 127.0.0.1）：GET /__health、GET /__captures、
// POST /__captures/clear、GET/POST /__ctl。
//
// CLI：node scripts/managed-protocol-provider.mjs [--port 8753] [--expect-key <合成key>]
//   默认端口 8753（受管冻结约定）；--expect-key 缺省用进程内合成值（与 accept-managed 生成逻辑解耦时显式传入）。
// 也可作为模块导入：createProtocolFixtureServer({ port, expectKey, host })（tests 使用随机端口）。
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// 合成常量与剧本表
// ---------------------------------------------------------------------------

/** 默认合成 API Key（与 mock-provider.mjs 的 S1 端口/键均不同，不共用状态）。 */
export const DEFAULT_EXPECT_KEY = 'vc03m-synthetic-upstream-key';

/** 固定模型清单：id 即剧本选择器；display 供 /models 与 discover 断言。 */
export const FIXTURE_MODELS = [
    { id: 'vc03m-chat', display_name: 'VC03M Chat (文本)' },
    { id: 'vc03m-chat-slow', display_name: 'VC03M Chat Slow (取消用例)' },
    { id: 'vc03m-tools', display_name: 'VC03M Tools (工具分片)' },
    { id: 'vc03m-tools-slow', display_name: 'VC03M Tools Slow (工具+取消)' },
    { id: 'vc03m-reasoning', display_name: 'VC03M Reasoning (Responses reasoning+工具)' },
    { id: 'vc03m-usage', display_name: 'VC03M Usage (固定用量)' },
    { id: 'vc03m-error', display_name: 'VC03M Error (HTTP 500)' },
    { id: 'vc03m-error-429', display_name: 'VC03M Rate Limited (HTTP 429)' },
    { id: 'vc03m-huge', display_name: 'VC03M Huge (超窗输入用例)' },
];

/**
 * modelId → 默认剧本。字段即标准化 plan 的输入：
 *   text            文本回复（按 chunks 分片流出）
 *   reasoning       Responses 的 reasoning item（encrypted_content 形态）
 *   tool            工具调用（argumentsPieces 为多轮 arguments 分片）
 *   usage           固定用量（缺省 {prompt:21, completion:13}）
 *   error           可控错误 {status, message?, retryAfterMs?}
 *   delay           {firstMs, perChunkMs} 可控延迟（测取消）
 *   chunks          文本分片数（缺省 3）
 *   abortAfterChunks 写完 N 片后主动断流（测取消）
 */
export const SCRIPTS = {
    'vc03m-chat': { text: '收到。这是受管验收的合成回复，内容固定可断言。' },
    'vc03m-chat-slow': { text: '慢速流输出，用于观察与中断取消。', delay: { firstMs: 120, perChunkMs: 220 }, chunks: 8 },
    'vc03m-tools': {
        tool: {
            name: 'lookup_weather',
            argumentsPieces: ['{"city":"', '北', '京","unit":"celsius"}'],
        },
    },
    'vc03m-tools-slow': {
        tool: { name: 'lookup_weather', argumentsPieces: ['{"city":"', '上海"}'] },
        delay: { firstMs: 100, perChunkMs: 200 },
    },
    'vc03m-reasoning': {
        reasoning: { text: '先核对城市参数再调用工具。', encrypted: true },
        tool: { name: 'lookup_weather', argumentsPieces: ['{"city":"', '广州"}'] },
    },
    'vc03m-usage': { text: '带固定用量的回复。', usage: { prompt: 101, completion: 37 } },
    'vc03m-error': { error: { status: 500, message: 'synthetic upstream failure' } },
    'vc03m-error-429': { error: { status: 429, message: 'synthetic rate limit', retryAfterMs: 2000 } },
    'vc03m-huge': { text: '大输入用例：' + '很长'.repeat(120) + '。', chunks: 2 },
};

const DEFAULT_USAGE = { prompt: 21, completion: 13 };

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

function readBody(req) {
    return new Promise((resolve) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
}

function splitText(text, chunks) {
    const n = Math.max(1, Number(chunks) || 3);
    if (!text) return [];
    const size = Math.max(1, Math.ceil(text.length / n));
    const pieces = [];
    for (let i = 0; i < text.length; i += size) pieces.push(text.slice(i, i + size));
    return pieces;
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function classifyAuth(req, expectKey) {
    const auth = String(req.headers.authorization || '');
    const xkey = String(req.headers['x-api-key'] || '');
    if (auth.startsWith('Bearer ')) {
        return { scheme: 'bearer', matched: auth.slice(7).trim() === expectKey };
    }
    if (auth) {
        return { scheme: 'bearer-raw', matched: auth.trim() === expectKey };
    }
    if (xkey) {
        return { scheme: 'x-api-key', matched: xkey.trim() === expectKey };
    }
    return { scheme: 'none', matched: false };
}

/**
 * 合成最终响应 plan：指令覆盖链 请求体 vc_fixture > x-vc-fixture 头 > __ctl 覆盖 > 剧本。
 * 返回值只含合成材料，不含任何请求回显。
 */
// Only enabled by the in-memory synthetic test controller. This is a fixture,
// never a fallback extractor or a route for a real model credential.
function memorycoreFixture(body, documents) {
    const messages = body?.messages || [];
    const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
    const prompt = messages.find(m => m.role === 'user')?.content || '';
    if (system.includes('Only supplied staging files are accessible.')) {
        if (messages.some(m => m.role === 'user' && m.content.includes('"toolResult"'))) return JSON.stringify({ text: 'done' });
        const persona = /persona|画像/i.test(system) && !prompt.includes('New Memories List');
        const content = documents.filter(d => prompt.includes(d.content)).map(d => d.content).join('\n');
        return JSON.stringify({ tool: { name: 'write_to_file', path: persona ? 'persona.md' : 'scene_blocks/synthetic.md',
            content: persona ? '# 合成画像\n' + content : '-----META-START-----\ncreated: 2026-10-28\nupdated: 2026-10-28\nsummary: 合成来源摘要\nheat: 1\n-----META-END-----\n' + content } });
    }
    const fresh = [...prompt.matchAll(/条新记忆 \(record_id: ([a-zA-Z0-9_-]+)\)/g)].map(m => m[1]);
    if (fresh.length) return JSON.stringify(fresh.map(record_id => ({ record_id, action: 'store', target_ids: [] })));
    const memories = documents.filter(d => prompt.includes(d.content)).map(d => ({ content: d.content, type: d.type || 'episodic',
        priority: 50, source_message_ids: ['synthetic-source'], metadata: d.eventDate ? { eventDate: d.eventDate } : {} }));
    return JSON.stringify(memories.length ? [{ scene_name: 'synthetic', message_ids: ['synthetic-source'], memories }] : []);
}

function requestHasToolResult(body) {
    if (!body || typeof body !== 'object') return false;
    if (Array.isArray(body.messages)) {
        for (const message of body.messages) {
            if (message?.role === 'tool') return true;
            if (Array.isArray(message?.content) && message.content.some((part) => part?.type === 'tool_result')) return true;
        }
    }
    return Array.isArray(body.input) && body.input.some((item) => item?.type === 'function_call_output');
}

export function buildPlan(model, body, headerDirective, ctlOverride) {
    const base = SCRIPTS[model] || SCRIPTS['vc03m-chat'];
    const bodyDirective = body && typeof body === 'object' && body.vc_fixture && typeof body.vc_fixture === 'object'
        ? body.vc_fixture
        : null;
    const merged = { ...base, ...(ctlOverride || {}), ...(headerDirective || {}), ...(bodyDirective || {}) };
    const usage = { ...DEFAULT_USAGE, ...(merged.usage || {}) };
    let text = Array.isArray(merged.memorycoreDocuments) ? memorycoreFixture(body, merged.memorycoreDocuments) : typeof merged.text === 'string' ? merged.text : base.text ?? '';
    let tool = merged.tool ?? null;
    // 只在显式打开时，把「已带工具结果的后续请求」收成纯文本。默认剧本保持原样。
    if (merged.stopAfterToolResult === true && requestHasToolResult(body)) {
        tool = null;
        if (!text) text = '已根据工具结果回复。';
    }
    return {
        model,
        text,
        reasoning: merged.reasoning ?? null,
        tool,
        usage,
        error: merged.error ?? null,
        delay: merged.delay ?? null,
        chunks: merged.chunks ?? 3,
        abortAfterChunks: merged.abortAfterChunks ?? null,
        stream: body?.stream === true,
    };
}

// ---------------------------------------------------------------------------
// 可控错误（各协议按自身错误形状写出）
// ---------------------------------------------------------------------------

function errorPayload(protocol, error, res) {
    const status = Number(error?.status) || 500;
    const message = typeof error?.message === 'string' ? error.message : 'synthetic upstream error';
    if (Number.isFinite(Number(error?.retryAfterMs))) res.setHeader('Retry-After', String(Math.ceil(error.retryAfterMs / 1000)));
    res.writeHead(status, { 'content-type': 'application/json' });
    if (protocol === 'anthropic') {
        res.end(JSON.stringify({ type: 'error', error: { type: status === 429 ? 'rate_limit_error' : 'api_error', message } }));
        return;
    }
    res.end(JSON.stringify({ error: { message, code: status === 429 ? 'rate_limited' : 'synthetic_error', type: status === 429 ? 'rate_limit_error' : 'server_error' } }));
}

/**
 * 流式写出器：统一处理首包延迟、逐片延迟、客户端断开（取消）与主动断流。
 * writeChunk(pieceIndex, isFirst) 由调用方提供实际写片逻辑。
 * 返回 'done' | 'aborted'（客户端取消/断开）。
 */
async function streamOut(res, plan, writeChunk) {
    const firstMs = Number(plan.delay?.firstMs) || 0;
    const perChunkMs = Number(plan.delay?.perChunkMs) || 0;
    if (firstMs) await sleep(firstMs);
    let aborted = false;
    const onClose = () => { aborted = true; };
    res.on('close', onClose);
    try {
        const total = Number(plan.abortAfterChunks);
        let index = 0;
        for await (const piece of writeChunk()) {
            if (aborted || res.writableEnded || res.destroyed) return 'aborted';
            piece(index);
            index += 1;
            if (total && index >= total) {
                // 主动断流：模拟上游中途失败/挂起，供取消语义断言
                res.destroy();
                return 'aborted';
            }
            if (perChunkMs) await sleep(perChunkMs);
            if (aborted || res.writableEnded || res.destroyed) return 'aborted';
        }
        if (!aborted && !res.writableEnded && !res.destroyed) res.end();
        return aborted ? 'aborted' : 'done';
    } finally {
        res.off('close', onClose);
    }
}

// ---------------------------------------------------------------------------
// OpenAI Chat Completions
// ---------------------------------------------------------------------------

function renderChatNonStream(plan, res) {
    const id = `chatcmpl-vc03m-${plan.seq}`;
    const created = Math.floor(Date.now() / 1000);
    const message = { role: 'assistant', content: plan.text || null };
    if (plan.tool) message.tool_calls = [{
        id: plan.tool.callId || `call-vc03m-${plan.seq}`,
        type: 'function',
        function: { name: plan.tool.name, arguments: (plan.tool.argumentsPieces || []).join('') },
    }];
    const usage = {
        prompt_tokens: plan.usage.prompt,
        completion_tokens: plan.usage.completion,
        total_tokens: plan.usage.prompt + plan.usage.completion,
    };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
        id, object: 'chat.completion', created, model: plan.model,
        choices: [{ index: 0, message, finish_reason: plan.tool ? 'tool_calls' : 'stop' }],
        usage,
    }));
}

async function renderChatStream(plan, res) {
    res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
    });
    const id = `chatcmpl-vc03m-${plan.seq}`;
    const created = Math.floor(Date.now() / 1000);
    const chunk = (delta, finish = null) =>
        `data: ${JSON.stringify({
            id, object: 'chat.completion.chunk', created, model: plan.model,
            choices: [{ index: 0, delta, finish_reason: finish }],
        })}\n\n`;
    return streamOut(res, plan, async function* write() {
        let first = true;
        for (const piece of splitText(plan.text, plan.chunks)) {
            const withRole = first;
            yield (index) => res.write(chunk(index === 0 && withRole ? { role: 'assistant', content: piece } : { content: piece }));
            first = false;
        }
        if (plan.tool) {
            const callId = plan.tool.callId || `call-vc03m-${plan.seq}`;
            yield () => res.write(chunk({ tool_calls: [{ index: 0, id: callId, type: 'function', function: { name: plan.tool.name, arguments: '' } }] }));
            for (const part of (plan.tool.argumentsPieces || [])) {
                yield () => res.write(chunk({ tool_calls: [{ index: 0, function: { arguments: part } }] }));
            }
        }
        yield () => res.write(chunk({}, plan.tool ? 'tool_calls' : 'stop'));
        yield () => res.write('data: [DONE]\n\n');
    });
}

// ---------------------------------------------------------------------------
// OpenAI Responses（事件序与 server-plugin responses-adapter 的消费面对齐：
// response.created → output_item.added(reasoning) → [reasoning delta] → output_item.done(reasoning,
// encrypted_content) → output_item.added(function_call/message) → function_call_arguments.delta 分片 →
// output_item.done → response.completed（含 usage 与完整 output））
// ---------------------------------------------------------------------------

function responsesItems(plan, seq) {
    const items = [];
    if (plan.reasoning) {
        items.push({
            type: 'reasoning',
            id: `rs-vc03m-${seq}`,
            summary: [],
            content: plan.reasoning.text ? [{ type: 'reasoning_text', text: plan.reasoning.text }] : [],
            ...(plan.reasoning.encrypted ? { encrypted_content: `enc-vc03m-${seq}-${crypto.randomBytes(12).toString('base64url')}` } : {}),
        });
    }
    if (plan.tool) {
        items.push({
            type: 'function_call',
            id: `fc-vc03m-${seq}`,
            call_id: plan.tool.callId || `call-vc03m-${seq}`,
            name: plan.tool.name,
            arguments: (plan.tool.argumentsPieces || []).join(''),
        });
    }
    if (plan.text) {
        items.push({
            type: 'message',
            id: `msg-vc03m-${seq}`,
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'output_text', text: plan.text, annotations: [] }],
        });
    }
    return items;
}

function renderResponsesNonStream(plan, res) {
    const id = `resp-vc03m-${plan.seq}`;
    const output = responsesItems(plan, plan.seq);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
        id,
        object: 'response',
        created_at: Math.floor(Date.now() / 1000),
        status: 'completed',
        model: plan.model,
        output,
        usage: {
            input_tokens: plan.usage.prompt,
            output_tokens: plan.usage.completion,
            total_tokens: plan.usage.prompt + plan.usage.completion,
        },
    }));
}

async function renderResponsesStream(plan, res) {
    res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
    });
    const id = `resp-vc03m-${plan.seq}`;
    const ev = (type, payload) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`);
    return streamOut(res, plan, async function* write() {
        yield () => ev('response.created', { response: { id, object: 'response', status: 'in_progress', model: plan.model } });
        let outputIndex = 0;
        if (plan.reasoning) {
            const item = responsesItems(plan, plan.seq)[0];
            yield () => ev('response.output_item.added', { output_index: outputIndex, item: { type: 'reasoning', id: item.id, summary: [] } });
            for (const piece of splitText(plan.reasoning.text || '', 2)) {
                yield () => ev('response.reasoning_text.delta', { item_id: item.id, output_index: outputIndex, delta: piece });
            }
            yield () => ev('response.output_item.done', { output_index: outputIndex, item });
            outputIndex += 1;
        }
        if (plan.tool) {
            const items = responsesItems(plan, plan.seq);
            const call = items.find((i) => i.type === 'function_call');
            yield () => ev('response.output_item.added', {
                output_index: outputIndex,
                item: { type: 'function_call', id: call.id, call_id: call.call_id, name: call.name, arguments: '' },
            });
            for (const part of (plan.tool.argumentsPieces || [])) {
                yield () => ev('response.function_call_arguments.delta', {
                    item_id: call.id, output_index: outputIndex, delta: part,
                });
            }
            yield () => ev('response.output_item.done', { output_index: outputIndex, item: call });
            outputIndex += 1;
        }
        if (plan.text) {
            const items = responsesItems(plan, plan.seq);
            const message = items.find((i) => i.type === 'message');
            yield () => ev('response.output_item.added', { output_index: outputIndex, item: { type: 'message', id: message.id, role: 'assistant', status: 'in_progress', content: [] } });
            for (const piece of splitText(plan.text, plan.chunks)) {
                yield () => ev('response.output_text.delta', { item_id: message.id, output_index: outputIndex, delta: piece });
            }
            yield () => ev('response.output_item.done', { output_index: outputIndex, item: message });
            outputIndex += 1;
        }
        yield () => ev('response.completed', {
            response: {
                id, object: 'response', status: 'completed', model: plan.model,
                output: responsesItems(plan, plan.seq),
                usage: {
                    input_tokens: plan.usage.prompt,
                    output_tokens: plan.usage.completion,
                    total_tokens: plan.usage.prompt + plan.usage.completion,
                },
            },
        });
    });
}

// ---------------------------------------------------------------------------
// Anthropic Messages（请求形状 system/messages/max_tokens；SSE：
// message_start → content_block_start → content_block_delta(text_delta/input_json_delta)
// → content_block_stop → message_delta(stop_reason+usage) → message_stop）
// ---------------------------------------------------------------------------

function anthropicBlocks(plan, seq) {
    const blocks = [];
    if (plan.text) blocks.push({ type: 'text', text: plan.text });
    if (plan.tool) {
        blocks.push({
            type: 'tool_use',
            id: plan.tool.callId || `toolu-vc03m-${seq}`,
            name: plan.tool.name,
            input: JSON.parse((plan.tool.argumentsPieces || []).join('') || '{}'),
        });
    }
    return blocks;
}

function renderAnthropicNonStream(plan, res) {
    const blocks = anthropicBlocks(plan, plan.seq);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
        id: `msg-vc03m-${plan.seq}`,
        type: 'message',
        role: 'assistant',
        model: plan.model,
        content: blocks,
        stop_reason: plan.tool ? 'tool_use' : 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: plan.usage.prompt, output_tokens: plan.usage.completion },
    }));
}

async function renderAnthropicStream(plan, res) {
    res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
    });
    const ev = (type, payload) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`);
    return streamOut(res, plan, async function* write() {
        yield () => ev('message_start', {
            message: {
                id: `msg-vc03m-${plan.seq}`, type: 'message', role: 'assistant',
                model: plan.model, content: [], stop_reason: null,
                usage: { input_tokens: plan.usage.prompt, output_tokens: 1 },
            },
        });
        let index = 0;
        if (plan.text) {
            yield () => ev('content_block_start', { index, content_block: { type: 'text', text: '' } });
            for (const piece of splitText(plan.text, plan.chunks)) {
                yield () => ev('content_block_delta', { index, delta: { type: 'text_delta', text: piece } });
            }
            yield () => ev('content_block_stop', { index });
            index += 1;
        }
        if (plan.tool) {
            const blocks = anthropicBlocks(plan, plan.seq);
            const use = blocks.find((b) => b.type === 'tool_use');
            yield () => ev('content_block_start', { index, content_block: { type: 'tool_use', id: use.id, name: use.name, input: {} } });
            for (const part of (plan.tool.argumentsPieces || [])) {
                yield () => ev('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: part } });
            }
            yield () => ev('content_block_stop', { index });
            index += 1;
        }
        yield () => ev('message_delta', {
            delta: { stop_reason: plan.tool ? 'tool_use' : 'end_turn', stop_sequence: null },
            usage: { output_tokens: plan.usage.completion },
        });
        yield () => ev('message_stop', {});
    });
}

// ---------------------------------------------------------------------------
// server 组装
// ---------------------------------------------------------------------------

const MAX_CAPTURES = 500;

/**
 * @param {{port?: number, host?: string, expectKey?: string}} [options]
 * @returns {Promise<{server: import('node:http').Server, url: string, port: number, api: {
 *   captures(options?: {since?: number, protocol?: string, endpointSuffix?: string}): Promise<Array>,
 *   count(options?: {since?: number, protocol?: string, endpointSuffix?: string}): Promise<number>,
 *   clear(): Promise<void>,
 *   setOverride(model: string, directive: object|null): Promise<void>,
 *   overrides(): Promise<object>,
 *   close(): Promise<void>,
 * } }>}
 */
export async function createProtocolFixtureServer(options = {}) {
    const port = options.port ?? 0;
    const host = options.host ?? '127.0.0.1';
    const expectKey = options.expectKey || DEFAULT_EXPECT_KEY;
    /** @type {Array} 内存捕获环形缓冲；断言后可 clear 丢弃，绝不落盘 */
    const captures = [];
    /** @type {Map<string, object>} __ctl 覆盖（'*' 通配；null 值表示删除） */
    const ctlOverrides = new Map();
    let seq = 0;
    const startedAt = Date.now();

    function ctlOverrideFor(model) {
        return ctlOverrides.get(model) ?? ctlOverrides.get('*') ?? null;
    }

    function pushCapture(rec) {
        captures.push(rec);
        if (captures.length > MAX_CAPTURES) captures.shift();
    }

    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url || '/', `http://${host}`);
        const p = url.pathname.replace(/\/+$/, '') || '/';
        const started = Date.now();

        // —— 管理/控制面（仅内存，不参与剧本） ——
        if (req.method === 'GET' && p === '/__health') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ ok: true, since: startedAt, captured: captures.length, port: server.address().port }));
            return;
        }
        if (req.method === 'GET' && p === '/__captures') {
            const since = Number(url.searchParams.get('since') || 0);
            const protocol = url.searchParams.get('protocol') || undefined;
            const suffix = url.searchParams.get('endpoint') || undefined;
            const rows = captures.filter((c) => c.seq > since
                && (!protocol || c.protocol === protocol)
                && (!suffix || c.endpoint.endsWith(suffix)));
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ captures: rows, total: captures.length }));
            return;
        }
        if (req.method === 'POST' && p === '/__captures/clear') {
            await readBody(req);
            captures.length = 0;
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end('{"ok":true}');
            return;
        }
        if (p === '/__ctl') {
            if (req.method === 'GET') {
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ models: [...ctlOverrides.keys()], captured: captures.length }));
                return;
            }
            if (req.method === 'POST') {
                const bodyText = await readBody(req);
                let body;
                try {
                    body = JSON.parse(bodyText);
                } catch {
                    res.writeHead(400, { 'content-type': 'application/json' });
                    res.end('{"error":"invalid json"}');
                    return;
                }
                if (body && body.reset === true) ctlOverrides.clear();
                for (const [model, directive] of Object.entries(body?.overrides || {})) {
                    if (directive === null) ctlOverrides.delete(model);
                    else ctlOverrides.set(model, directive);
                }
                console.log(`[fixture] ctl 更新：models=${[...ctlOverrides.keys()].join(',') || '(无)'}（指令内容不打印）`);
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end('{"ok":true}');
                return;
            }
        }

        // —— 模型面：/models 与三协议生成端点 ——
        if (req.method === 'GET' && p.endsWith('/models')) {
            seq += 1;
            const auth = classifyAuth(req, expectKey);
            pushCapture({
                seq, id: `vc03m-req-${seq}`, receivedAt: started, method: 'GET',
                finalUrl: p, protocol: 'models', endpoint: 'models',
                auth: { scheme: auth.scheme, matched: auth.matched },
                stream: false, model: null, body: null, responseStatus: 200,
                durationMs: Date.now() - started, aborted: false,
            });
            console.log(`[fixture] #${seq} models GET -> 200 (captured=${captures.length})`);
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
                object: 'list',
                data: FIXTURE_MODELS.map((m) => ({ id: m.id, object: 'model', owned_by: 'vc03m-fixture', display_name: m.display_name, display: m.display_name })),
            }));
            return;
        }

        const protocol = p.endsWith('/chat/completions') ? 'chat'
            : p.endsWith('/responses') ? 'responses'
                : p.endsWith('/messages') ? 'anthropic' : null;
        if (req.method === 'POST' && protocol) {
            seq += 1;
            const id = `vc03m-req-${seq}`;
            const bodyText = await readBody(req);
            let body = null;
            try {
                body = bodyText ? JSON.parse(bodyText) : null;
            } catch {
                body = { _unparsed_length: bodyText.length };
            }
            const auth = classifyAuth(req, expectKey);
            let headerDirective = null;
            const headerRaw = req.headers['x-vc-fixture'];
            if (typeof headerRaw === 'string' && headerRaw) {
                try {
                    headerDirective = JSON.parse(headerRaw);
                } catch {
                    headerDirective = null;
                }
            }
            const model = typeof body?.model === 'string' ? body.model : 'vc03m-chat';
            const plan = buildPlan(model, body, headerDirective, ctlOverrideFor(model));
            plan.seq = seq;
            const rec = {
                seq, id, receivedAt: started, method: 'POST',
                finalUrl: p, protocol, endpoint: protocol === 'chat' ? 'chat/completions' : protocol === 'responses' ? 'responses' : 'messages',
                auth: { scheme: auth.scheme, matched: auth.matched },
                stream: plan.stream, model, body,
                responseStatus: null, durationMs: null, aborted: false,
            };
            pushCapture(rec);
            let outcome = 'done';
            try {
                if (plan.error) {
                    errorPayload(protocol, plan.error, res);
                    rec.responseStatus = Number(plan.error.status) || 500;
                } else if (protocol === 'chat') {
                    if (plan.stream) outcome = await renderChatStream(plan, res);
                    else renderChatNonStream(plan, res);
                } else if (protocol === 'responses') {
                    if (plan.stream) outcome = await renderResponsesStream(plan, res);
                    else renderResponsesNonStream(plan, res);
                } else if (plan.stream) {
                    outcome = await renderAnthropicStream(plan, res);
                } else {
                    renderAnthropicNonStream(plan, res);
                }
                rec.responseStatus ??= outcome === 'aborted' ? 200 : 200;
            } catch {
                rec.responseStatus = res.statusCode || 500;
            }
            rec.aborted = outcome === 'aborted' || res.destroyed;
            rec.durationMs = Date.now() - started;
            console.log(`[fixture] #${seq} ${protocol} ${rec.endpoint} -> ${rec.responseStatus} ${rec.aborted ? '(aborted)' : ''} (${rec.durationMs}ms, captured=${captures.length})`);
            return;
        }

        seq += 1;
        console.log(`[fixture] #${seq} ${req.method} ${p} -> 404 (无此路由)`);
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: `fixture has no route for ${req.method} ${p}` } }));
    });

    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, resolve);
    });
    const bound = server.address().port;

    async function apiFetch(path, init) {
        const r = await fetch(`http://${host}:${bound}${path}`, init);
        return r.json();
    }
    return {
        server,
        url: `http://${host}:${bound}`,
        port: bound,
        api: {
            async captures(opts = {}) {
                const q = new URLSearchParams();
                if (opts.since) q.set('since', String(opts.since));
                if (opts.protocol) q.set('protocol', opts.protocol);
                if (opts.endpointSuffix) q.set('endpoint', opts.endpointSuffix);
                const j = await apiFetch(`/__captures?${q}`);
                return j.captures;
            },
            async count(opts = {}) {
                return (await this.captures(opts)).length;
            },
            async clear() {
                await apiFetch('/__captures/clear', { method: 'POST' });
            },
            async setOverride(model, directive) {
                await apiFetch('/__ctl', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ overrides: { [model]: directive } }),
                });
            },
            async overrides() {
                return apiFetch('/__ctl');
            },
            async close() {
                await new Promise((resolve) => server.close(resolve));
            },
        },
    };
}

// ---------------------------------------------------------------------------
// CLI 独立运行
// ---------------------------------------------------------------------------

const isDirectRun = process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href;
if (isDirectRun) {
    const argv = process.argv.slice(2);
    const arg = (n, d) => {
        const i = argv.indexOf(n);
        return i >= 0 ? argv[i + 1] : d;
    };
    const PORT = Number(arg('--port', process.env.VC_W03_FIXTURE_PORT || 8753));
    const KEY = arg('--expect-key', process.env.VC_W03_FIXTURE_KEY || DEFAULT_EXPECT_KEY);
    const fixture = await createProtocolFixtureServer({ port: PORT, expectKey: KEY });
    console.log(`[fixture] 受管合成上游 listening ${fixture.url}（捕获仅内存；GET /__health，GET /__captures，POST /__ctl）`);
    const shutdown = () => {
        console.log('[fixture] 收到退出信号，关闭（不落盘任何捕获）');
        fixture.server.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 500).unref();
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}
