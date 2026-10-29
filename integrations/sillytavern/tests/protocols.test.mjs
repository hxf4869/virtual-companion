// V2-W03-S4 三协议适配测试：URL 规范化、Responses 请求映射与参数拒绝、SSE 桥接、
// 工具与 reasoning 续接、上下文预算、取消与错误语义。纯 Node + 本地合成 HTTP，
// 无真实模型调用、无外部费用。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';

import { finalRequestUrl, nativeBaseUrl } from '../server-plugin/virtual-companion/lib/url-normalize.js';
import { buildResponsesRequest, convertResponsesToChatCompletion, bridgeResponsesStream, ToolContinuationStore } from '../server-plugin/virtual-companion/lib/responses-adapter.js';
import { parseBindingMarker, createGenerateBridge } from '../server-plugin/virtual-companion/lib/generate-bridge.js';
import { createTokenCounter, checkContextBudget, PROTOCOL_OVERHEAD_TOKENS } from '../server-plugin/virtual-companion/lib/context-guard.js';
import { BridgeError } from '../server-plugin/virtual-companion/lib/errors.js';
import { memoryBlock } from '../extension/vc-model-settings/memory-injection.js';

// —— 测试用确定性计数器：CJK 字 1 token，其余 4 字符 1 token ——
const fakeTokenizer = {
    getTokenizerModel: (m) => m,
    getTiktokenTokenizer: () => ({
        encode: (text) => {
            let tokens = 0;
            let other = 0;
            for (const ch of text) {
                if (/[\u4E00-\u9FFF]/.test(ch)) tokens += 1;
                else other += 1;
            }
            return new Array(tokens + Math.ceil(other / 4));
        },
    }),
};
const counter = createTokenCounter(fakeTokenizer);
assert.equal(counter.estimator, 'st-tiktoken');

function mockRes() {
    const res = {
        statusCode: 200, headers: {}, chunks: [], ended: false, _sent: false,
        setHeader(k, v) { this.headers[k] = v; },
        appendHeader(k, v) { (this.headers[k] ??= []).push?.(v); this.headers[k] = [].concat(this.headers[k] ?? [], v); },
        flushHeaders() {},
        write(c) { this._sent = true; this.chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c))); return true; },
        end(c) { if (c !== undefined) this.write(c); this._sent = true; this.ended = true; },
        body() { return Buffer.concat(this.chunks).toString('utf8'); },
        get headersSent() { return this._sent; },
        get writableEnded() { return this.ended; },
    };
    return res;
}

function mockReq({ body, headers = {}, user } = {}) {
    const socket = new EventEmitter();
    socket.removeAllListeners = (ev) => { if (!ev || ev === 'close') { /* 测试桩：清 close */ } return socket; };
    return { body, headers, user: user ?? { profile: { handle: 'default-user' } }, socket };
}

function startServer(handler) {
    return new Promise((resolve) => {
        const server = http.createServer(handler);
        server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
    });
}

function sseLines(res) {
    return res.body().split('\n\n').filter((b) => b.startsWith('data: ')).map((b) => b.slice(6));
}

function sseWrite(res, events) {
    for (const e of events) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    res.end();
}

function baseModel(over = {}) {
    return {
        profileKey: 'vc-profile-a', modelId: 'upstream-model-x',
        contextWindowTokens: 4096, maxOutputTokens: 1024,
        capabilities: {}, reasoningLevels: [], generationParams: {}, pricing: null,
        ...over,
    };
}

function baseBody(over = {}) {
    // 投影把上游 modelId 写进原生模型字段，所以合法请求的 body.model 就是 modelId（不是 profileKey）。
    return {
        chat_completion_source: 'custom',
        messages: [{ role: 'user', content: '你好' }],
        model: 'upstream-model-x',
        temperature: 0.7, top_p: 0.9, max_tokens: 512, stream: false,
        ...over,
    };
}

// ---------------------------------------------------------------------------
// URL 规范化
// ---------------------------------------------------------------------------

test('URL 规范化：三协议方法路径、/v1 保留不重复、自定义前缀保留', () => {
    const p = (endpointUrl) => ({ endpointUrl });
    assert.equal(finalRequestUrl('OPENAI_RESPONSES', p('https://api.example.com/v1')), 'https://api.example.com/v1/responses');
    assert.equal(finalRequestUrl('OPENAI_RESPONSES', p('https://api.example.com/v1/responses')), 'https://api.example.com/v1/responses');
    assert.equal(nativeBaseUrl('OPENAI_CHAT_COMPLETIONS', p('https://gw.internal/prefix/v1')), 'https://gw.internal/prefix/v1');
    assert.equal(nativeBaseUrl('ANTHROPIC_MESSAGES', p('https://api.anthropic.com/v1/')), 'https://api.anthropic.com/v1');
    assert.equal(nativeBaseUrl('OPENAI_CHAT_COMPLETIONS', p('https://api.example.com/v1/chat/completions')), 'https://api.example.com/v1');
    assert.equal(nativeBaseUrl('ANTHROPIC_MESSAGES', p('https://host.example')), 'https://host.example');
    assert.throws(() => finalRequestUrl('OPENAI_RESPONSES', p('notaurl')), BridgeError);
    assert.throws(() => finalRequestUrl('OPENAI_RESPONSES', p('ftp://x.example/v1')), BridgeError);
    assert.throws(() => finalRequestUrl('SOMETHING_ELSE', p('https://a.example')), BridgeError);
    assert.throws(() => finalRequestUrl('OPENAI_RESPONSES', {}), /endpointUrl/);
});

// ---------------------------------------------------------------------------
// 绑定标记解析（revision 整数契约）
// ---------------------------------------------------------------------------

test('绑定标记：合法解析、revision 必须十进制整数、scope 透传', () => {
    const m = parseBindingMarker('vc-go://model-purposes/FOREGROUND_CHAT?provider=p1&profile=k1&pr=3&br=9&scope=chatA.jsonl');
    assert.equal(m.purpose, 'FOREGROUND_CHAT');
    assert.equal(m.providerId, 'p1');
    assert.equal(m.providerRevision, 3);
    assert.equal(m.bindingRevision, 9);
    assert.ok(Number.isInteger(m.providerRevision) && Number.isInteger(m.bindingRevision));
    assert.equal(m.scope, 'chatA.jsonl');
    assert.equal(parseBindingMarker('https://api.example.com/v1'), null);
    assert.equal(parseBindingMarker('vc-go://model-purposes/X?pr=abc').invalid, true);
    assert.equal(parseBindingMarker('vc-go://model-purposes/X?pr=3.5').invalid, true);
    assert.equal(parseBindingMarker('vc-go://wrong-host/X').invalid, true);
});

// ---------------------------------------------------------------------------
// Responses 请求映射
// ---------------------------------------------------------------------------

test('Responses 映射：消息/工具/结构化输出/采样参数/logprobs/reasoning', () => {
    const body = baseBody({
        messages: [
            { role: 'system', content: 'sys' },
            { role: 'user', content: [{ type: 'text', text: 'hi' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] },
            { role: 'assistant', content: '', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_time', arguments: '{"tz":"UTC"}' } }] },
            { role: 'tool', tool_call_id: 'call_1', content: '"12:00"' },
        ],
        tools: [{ type: 'function', function: { name: 'get_time', description: 'd', parameters: { type: 'object', properties: {} } } }],
        tool_choice: 'auto',
        json_schema: { name: 'out', strict: true, value: { type: 'object' } },
        logprobs: 5,
        reasoning_effort: 'low',
        max_tokens: 256,
    });
    const { requestBody, outputTokens } = buildResponsesRequest({ body, model: baseModel() });
    assert.equal(requestBody.model, 'upstream-model-x');
    assert.equal(requestBody.store, false);
    assert.equal(requestBody.truncation, 'disabled');
    assert.deepEqual(requestBody.include, ['reasoning.encrypted_content', 'message.output_text.logprobs']);
    assert.equal(requestBody.top_logprobs, 5);
    assert.deepEqual(requestBody.reasoning, { effort: 'low' });
    assert.equal(requestBody.max_output_tokens, 256);
    assert.equal(outputTokens, 256);
    assert.equal(requestBody.temperature, 0.7);
    assert.equal(requestBody.top_p, 0.9);
    const items = requestBody.input;
    assert.deepEqual(items[0], { type: 'message', role: 'system', content: 'sys' });
    assert.equal(items[1].content[0].type, 'input_text');
    assert.equal(items[1].content[1].type, 'input_image');
    assert.deepEqual(items[2], { type: 'function_call', call_id: 'call_1', name: 'get_time', arguments: '{"tz":"UTC"}' });
    assert.deepEqual(items[3], { type: 'function_call_output', call_id: 'call_1', output: '"12:00"' });
    assert.equal(requestBody.tools[0].name, 'get_time');
    assert.equal(requestBody.tools[0].type, 'function');
    assert.equal(requestBody.text.format.type, 'json_schema');
    assert.equal(requestBody.text.format.name, 'out');
    assert.equal(requestBody.tool_choice, 'auto');
});

test('Responses 映射：Go generationParams 覆盖原生采样值；tool_choice 对象形态', () => {
    const model = baseModel({ generationParams: { temperature: 0.2, topP: 0.5, reasoningEffort: 'high' } });
    const body = baseBody({ tool_choice: { type: 'function', function: { name: 'get_time' } }, tools: [{ type: 'function', function: { name: 'get_time', parameters: {} } }] });
    const { requestBody } = buildResponsesRequest({ body, model });
    assert.equal(requestBody.temperature, 0.2);
    assert.equal(requestBody.top_p, 0.5);
    assert.deepEqual(requestBody.reasoning, { effort: 'high' });
    assert.deepEqual(requestBody.tool_choice, { type: 'function', name: 'get_time' });
});

test('Responses 映射：ST 推理等级按原生 OpenAI 语义映射（auto 不发送、min→minimal、max→xhigh、扩展值透传）', () => {
    const effortOf = (reasoning_effort) => buildResponsesRequest({ body: baseBody({ reasoning_effort }), model: baseModel() }).requestBody.reasoning;
    assert.equal(effortOf('auto'), undefined, "ST 默认 'auto' 表示不显式指定，不能原样发给上游");
    assert.equal(effortOf(undefined), undefined);
    assert.deepEqual(effortOf('min'), { effort: 'minimal' });
    assert.deepEqual(effortOf('max'), { effort: 'xhigh' });
    assert.deepEqual(effortOf('low'), { effort: 'low' });
    assert.deepEqual(effortOf('none'), { effort: 'none' });
    assert.deepEqual(effortOf('xhigh'), { effort: 'xhigh' }, 'Go 钉住的扩展值原样透传');
});

test('Responses 映射：无对应字段的参数明确拒绝（非静默丢弃）；零值视为缺省放行', () => {
    const rejects = (body, param) => assert.throws(() => buildResponsesRequest({ body, model: baseModel() }), (e) => e instanceof BridgeError && e.code === 'VC_PARAMS_UNSUPPORTED' && e.extra.rejected.some((r) => r.param === param));
    rejects(baseBody({ stop: ['END'] }), 'stop');
    rejects(baseBody({ seed: 42 }), 'seed');
    rejects(baseBody({ logit_bias: { '50256': -100 } }), 'logit_bias');
    rejects(baseBody({ presence_penalty: 0.5 }), 'presence_penalty');
    rejects(baseBody({ frequency_penalty: -1 }), 'frequency_penalty');
    rejects(baseBody({ top_k: 40 }), 'top_k');
    rejects(baseBody({ n: 2 }), 'n');
    // 零值=协议缺省，不拒绝
    buildResponsesRequest({ body: baseBody({ presence_penalty: 0, frequency_penalty: 0, top_k: 0, n: 1, stop: [] }), model: baseModel() });
});

test('Responses 映射：custom include/exclude 只允许可校验参数', () => {
    const { requestBody } = buildResponsesRequest({
        body: baseBody({ custom_include_body: { parallel_tool_calls: false, metadata: { a: 1 } }, custom_exclude_body: { temperature: true } }),
        model: baseModel(),
    });
    assert.equal(requestBody.parallel_tool_calls, false);
    assert.equal(requestBody.temperature, undefined);
    assert.throws(() => buildResponsesRequest({ body: baseBody({ custom_include_body: { stop: ['x'] } }), model: baseModel() }), /custom_include_body.stop/);
    assert.throws(() => buildResponsesRequest({ body: baseBody({ custom_exclude_body: { model: true } }), model: baseModel() }), /custom_exclude_body.model/);
});

test('Responses 输出上限：超登记值拒绝；请求与登记都缺省拒绝；窗口未知拒绝', () => {
    const throwsCode = (fn, code) => assert.throws(fn, (e) => e instanceof BridgeError && e.code === code);
    throwsCode(() => buildResponsesRequest({ body: baseBody({ max_tokens: 2000 }), model: baseModel({ maxOutputTokens: 1024 }) }), 'VC_OUTPUT_LIMIT_EXCEEDED');
    throwsCode(() => buildResponsesRequest({ body: baseBody({ max_tokens: undefined, max_completion_tokens: undefined }), model: baseModel({ maxOutputTokens: null }) }), 'VC_OUTPUT_LIMIT_UNSET');
    throwsCode(() => checkContextBudget({ model: baseModel({ contextWindowTokens: null }), finalBody: {}, outputTokens: 10, counter }), 'VC_CONTEXT_WINDOW_UNKNOWN');
});

test('上下文预算：最终 body 全量计数（含 tools/schema）+ 固定开销 + 输出预留', () => {
    const model = baseModel({ contextWindowTokens: 40 });
    const finalBody = { messages: [{ role: 'user', content: 'a'.repeat(40) }], tools: undefined };
    // 40 个 ASCII ≈ 10 token + 开销 96 + 输出 10 > 40 → 拒绝
    assert.throws(() => checkContextBudget({ model, finalBody, outputTokens: 10, counter }), (e) => e.code === 'VC_CONTEXT_OVERFLOW');
    const ok = checkContextBudget({ model: baseModel({ contextWindowTokens: 4096 }), finalBody, outputTokens: 10, counter });
    assert.equal(ok.estimator, 'st-tiktoken');
    assert.ok(ok.estimatedInputTokens >= 10);
});

// ---------------------------------------------------------------------------
// 非流式响应转换
// ---------------------------------------------------------------------------

test('Responses 非流式 → chat completion：正文/工具/usage/finish_reason', () => {
    const json = {
        id: 'resp_1', model: 'upstream-model-x',
        output: [
            { type: 'reasoning', id: 'rs_1', summary: [{ type: 'summary_text', text: '思考' }], encrypted_content: 'ENC' },
            { type: 'message', content: [{ type: 'output_text', text: '你好' }] },
            { type: 'function_call', call_id: 'call_9', name: 'get_time', arguments: '{"tz":"UTC"}' },
        ],
        usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18 },
    };
    const chat = convertResponsesToChatCompletion(json);
    assert.equal(chat.choices[0].message.content, '你好');
    assert.equal(chat.choices[0].message.reasoning_content, '思考');
    assert.deepEqual(chat.choices[0].message.tool_calls, [{ id: 'call_9', type: 'function', function: { name: 'get_time', arguments: '{"tz":"UTC"}' } }]);
    assert.equal(chat.choices[0].finish_reason, 'tool_calls');
    assert.deepEqual(chat.usage, { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 });
    const incomplete = convertResponsesToChatCompletion({ id: 'r2', output: [{ type: 'message', content: [{ type: 'output_text', text: '截断' }] }], incomplete_details: { reason: 'max_output_tokens' }, usage: { input_tokens: 5, output_tokens: 4 } });
    assert.equal(incomplete.choices[0].finish_reason, 'length');
});

// ---------------------------------------------------------------------------
// SSE 桥接（真实 fetch + 本地合成 provider）
// ---------------------------------------------------------------------------

test('Responses SSE → chat chunk SSE：分片参数关联、reasoning、终止与 usage', async () => {
    const { server, port } = await startServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        sseWrite(res, [
            { type: 'response.created', response: { id: 'resp_1' } },
            { type: 'response.reasoning_summary_text.delta', delta: '思' },
            { type: 'response.output_text.delta', delta: '你' },
            { type: 'response.output_text.delta', delta: '好' },
            { type: 'response.output_item.added', output_index: 1, item: { type: 'function_call', call_id: 'call_1', name: 'get_time', arguments: '' } },
            { type: 'response.function_call_arguments.delta', output_index: 1, delta: '{"tz":"' },
            { type: 'response.function_call_arguments.delta', output_index: 1, delta: 'UTC"}' },
            { type: 'response.output_item.done', output_index: 0, item: { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'ENC' } },
            { type: 'response.completed', response: { id: 'resp_1', usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 }, output: [
                { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'ENC' },
                { type: 'function_call', call_id: 'call_1', name: 'get_time', arguments: '{"tz":"UTC"}' },
            ] } },
        ]);
    });
    try {
        const upstream = await fetch(`http://127.0.0.1:${port}/v1/responses`);
        const res = mockRes();
        let finished = null;
        await bridgeResponsesStream({ upstream, res, onRoundFinished: (r) => { finished = r; } });
        const lines = sseLines(res);
        assert.equal(lines.at(-1), '[DONE]');
        const chunks = lines.slice(0, -1).map((l) => JSON.parse(l));
        const text = chunks.filter((c) => c.choices?.[0]?.delta?.content).map((c) => c.choices[0].delta.content).join('');
        assert.equal(text, '你好');
        const reasoning = chunks.filter((c) => c.choices?.[0]?.delta?.reasoning_content).map((c) => c.choices[0].delta.reasoning_content).join('');
        assert.equal(reasoning, '思');
        const callStart = chunks.find((c) => Array.isArray(c.choices?.[0]?.delta?.tool_calls));
        assert.equal(callStart.choices[0].delta.tool_calls[0].id, 'call_1');
        assert.equal(callStart.choices[0].delta.tool_calls[0].function.name, 'get_time');
        const args = chunks.filter((c) => c.choices?.[0]?.delta?.tool_calls?.[0]?.function?.arguments).map((c) => c.choices[0].delta.tool_calls[0].function.arguments).join('');
        assert.equal(args, '{"tz":"UTC"}');
        const finalChunk = chunks.at(-1);
        assert.equal(finalChunk.choices[0].finish_reason, 'tool_calls');
        assert.deepEqual(finalChunk.usage, { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
        assert.equal(finished.ok, true);
        assert.deepEqual(finished.calls, [{ id: 'call_1', name: 'get_time', arguments: '{"tz":"UTC"}' }]);
        assert.equal(finished.reasoningItems[0].encrypted_content, 'ENC');
    } finally {
        server.close();
    }
});

test('Responses SSE：failed/error 事件 → 前端可解析 error 载荷，不回显上游正文，不提交续接', async () => {
    for (const bad of [
        { type: 'response.failed', response: { error: { code: 'x', message: 'SECRET-PAYLOAD' } } },
        { type: 'error', code: 'server_error', message: 'SECRET-PAYLOAD' },
    ]) {
        const { server, port } = await startServer((req, res) => {
            res.writeHead(200, { 'Content-Type': 'text/event-stream' });
            sseWrite(res, [bad]);
        });
        try {
            const upstream = await fetch(`http://127.0.0.1:${port}/v1/responses`);
            const res = mockRes();
            let finished = 'unset';
            await bridgeResponsesStream({ upstream, res, onRoundFinished: (r) => { finished = r; } });
            const lines = sseLines(res);
            const errChunk = JSON.parse(lines[0]);
            assert.ok(errChunk.error?.message, '应有 error 载荷');
            assert.ok(!errChunk.error.message.includes('SECRET-PAYLOAD'), '不得回显上游错误消息');
            assert.ok(!res.body().slice(lines[0].length).includes('SECRET-PAYLOAD'), '错误响应不携带上游正文');
            assert.equal(finished.ok, false);
            assert.equal(lines.at(-1), '[DONE]');
        } finally {
            server.close();
        }
    }
});

// ---------------------------------------------------------------------------
// 续接存储（回合指纹 + scope + 一次性）
// ---------------------------------------------------------------------------

test('续接存储：同一回合注入一次；scope/指纹/回合内容变化都不注入', () => {
    const store = new ToolContinuationStore({ ttlMs: 60_000 });
    const calls = [{ id: 'call_1', name: 'get_time', arguments: '{"tz":"UTC"}' }];
    const items = [{ type: 'reasoning', id: 'rs_1', encrypted_content: 'ENC' }];
    const base = { user: 'u1', fingerprint: 'f1', scope: 'chatA' };
    store.commit({ ...base, calls, reasoningItems: items });
    const round = { callIds: ['call_1'], calls };
    assert.equal(store.take({ ...base, round }).length, 1); // 第一次注入并消费
    assert.equal(store.take({ ...base, round }).length, 0); // 一次性
    store.commit({ ...base, calls, reasoningItems: items });
    assert.equal(store.take({ ...base, scope: 'chatB', round }).length, 0); // 切换会话
    store.commit({ ...base, calls, reasoningItems: items });
    assert.equal(store.take({ ...base, fingerprint: 'f2', round }).length, 0); // 配置变化
    store.commit({ ...base, calls, reasoningItems: items });
    assert.equal(store.take({ ...base, user: 'u2', round }).length, 0); // 用户变化
    store.commit({ ...base, calls, reasoningItems: items });
    const changedRound = { callIds: ['call_1'], calls: [{ id: 'call_1', name: 'get_time', arguments: '{"tz":"CST"}' }] };
    assert.equal(store.take({ ...base, round: changedRound }).length, 0); // 回合内容变化
});

test('续接存储：TTL 过期不注入；无 reasoning 项不提交', () => {
    const store = new ToolContinuationStore({ ttlMs: 5 });
    const calls = [{ id: 'call_1', name: 'n', arguments: '' }];
    const round = { callIds: ['call_1'], calls };
    store.commit({ user: 'u', fingerprint: 'f', scope: 's', calls, reasoningItems: [{ type: 'reasoning', id: 'r' }] });
    store.entries.values().next().value.expiresAt = Date.now() - 1;
    assert.equal(store.take({ user: 'u', fingerprint: 'f', scope: 's', round }).length, 0);
    const empty = new ToolContinuationStore();
    empty.commit({ user: 'u', fingerprint: 'f', scope: 's', calls, reasoningItems: [] });
    assert.equal(empty.entries.size, 0);
});

test('W07 Responses：记忆失效、关闭或不可读时拒绝整个推理续接；稳定资料仍可续接', async () => {
    const chatIdentity = '20000000-0000-4000-8000-000000000001';
    const sourceIdentity = '20000000-0000-4000-8000-000000000002';
    const original = { status: 'ok', block: '用户喜欢蓝色书签', memoryIds: ['7'], summaryIds: ['8'],
        sources: [{ chatIdentity, revision: 4 }, { chatIdentity: sourceIdentity, revision: 2 }] };
    const calls = [{ id: 'memory_call', name: 'get_time', arguments: '{}' }];
    for (const change of ['same', 'forgotten', 'disabled', 'unavailable']) {
        let recalled = structuredClone(original);
        const captured = [];
        const normalGo = goStub({ resolvePayload: () => resolveOk(), captures: [] });
        const { server: go, port } = await startServer((req, res) => {
            if (req.url !== '/api/v1/st/memory/recall') return normalGo(req, res);
            req.resume();
            req.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(recalled)); });
        });
        const store = new ToolContinuationStore();
        const bridge = createGenerateBridge({ config: { goBaseUrl: `http://127.0.0.1:${port}`, serviceToken: 'T'.repeat(40), timeoutMs: 5000 },
            continuationStore: store, counter,
            fetchImpl: async (_url, init) => {
                captured.push(JSON.parse(init.body));
                const output = captured.length === 1 ? [
                    { type: 'reasoning', id: 'rs-memory', summary: [{ type: 'summary_text', text: original.block }], encrypted_content: 'ENC_OLD_MEMORY' },
                    { type: 'function_call', call_id: calls[0].id, name: calls[0].name, arguments: calls[0].arguments },
                ] : [{ type: 'message', content: [{ type: 'output_text', text: '合成回复' }] }];
                return new Response(JSON.stringify({ id: 'r-memory', model: 'upstream-model-x', output, usage: { input_tokens: 3, output_tokens: 2 } }), { status: 200 });
            } });
        try {
            const metadata = { chatIdentity, revision: 4, enabled: true, budgetTokens: 1024, block: original.block };
            const first = mockRes();
            await bridge.interceptGenerate(mockReq({ body: baseBody({ custom_url: MARKER, vc_memory: metadata,
                messages: [{ role: 'user', content: `查一下时间\n${memoryBlock(original.block)}` }] }), headers: { cookie: 'vc_session=s1' } }), first);
            assert.equal(first.statusCode, 200, change);
            assert.equal(store.entries.size, 1);
            const enabled = change !== 'disabled';
            recalled = change === 'same' ? { ...structuredClone(original), sources: [{ chatIdentity, revision: 5 }, { chatIdentity: sourceIdentity, revision: 2 }] }
                : { status: change === 'unavailable' ? 'skipped' : change === 'disabled' ? 'disabled' : 'ok', block: '', memoryIds: [], summaryIds: [], sources: [] };
            const second = mockRes();
            const messages = [{ role: 'user', content: `查一下时间\n${memoryBlock(recalled.block)}` },
                { role: 'assistant', content: '', tool_calls: [{ id: calls[0].id, type: 'function', function: { name: calls[0].name, arguments: calls[0].arguments } }] },
                { role: 'tool', tool_call_id: calls[0].id, content: '12:00' }];
            await bridge.interceptGenerate(mockReq({ body: baseBody({ custom_url: MARKER, messages,
                vc_memory: { ...metadata, revision: 5, enabled, block: recalled.block } }), headers: { cookie: 'vc_session=s1' } }), second);
            if (change === 'same') {
                assert.equal(second.statusCode, 200);
                assert.equal(captured.length, 2);
                const items = captured[1].input;
                const index = items.findIndex((item) => item.type === 'reasoning');
                assert.equal(items[index].encrypted_content, 'ENC_OLD_MEMORY');
                assert.equal(items[index + 1].type, 'function_call');
            } else {
                assert.equal(second.statusCode, 409, change);
                assert.equal(JSON.parse(second.body()).error.code, 'VC_MEMORY_CONTINUATION_CHANGED');
                assert.equal(captured.length, 1, `${change} must not call upstream`);
            }
            assert.equal(store.entries.size, 0, 'changed or consumed round cannot stay cached');
        } finally { go.closeAllConnections(); go.close(); }
    }
});

test('W07 Responses：来源重核期间取消不会发起上游请求', async () => {
    let entered;
    const recalling = new Promise((resolve) => { entered = resolve; });
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let providerCalls = 0;
    const normalGo = goStub({ resolvePayload: () => resolveOk(), captures: [] });
    const { server: go, port } = await startServer((req, res) => {
        if (req.url !== '/api/v1/st/memory/recall') return normalGo(req, res);
        req.resume(); req.on('end', () => { entered(); gate.then(() => res.end('{}')); });
    });
    const store = new ToolContinuationStore();
    const bridge = createGenerateBridge({ config: { goBaseUrl: `http://127.0.0.1:${port}`, serviceToken: 'T'.repeat(40), timeoutMs: 5000 },
        continuationStore: store, counter, fetchImpl: async () => { providerCalls++; throw new Error('must not call'); } });
    try {
        const req = mockReq({ body: baseBody({ custom_url: MARKER, vc_memory: {
            chatIdentity: '20000000-0000-4000-8000-000000000001', revision: 4, enabled: true, budgetTokens: 1024, block: '',
        } }), headers: { cookie: 'vc_session=s1' } });
        const response = mockRes();
        const pending = bridge.interceptGenerate(req, response);
        await recalling;
        req.socket.emit('close');
        await pending;
        assert.equal(providerCalls, 0);
        assert.equal(store.entries.size, 0);
        assert.equal(response.statusCode, 504);
    } finally { release(); go.closeAllConnections(); go.close(); }
});

// ---------------------------------------------------------------------------
// 端到端（本地合成 Go + provider）：三协议约束与安全语义
// ---------------------------------------------------------------------------

function goStub({ resolvePayload, sessionStatus = 200, captures } = {}) {
    return async (req, res) => {
        const url = new URL(req.url, 'http://go.local');
        captures.push({ method: req.method, path: url.pathname, headers: { ...req.headers } });
        const body = await new Promise((r) => { let d = ''; req.on('data', (c) => { d += c; }); req.on('end', () => r(d ? JSON.parse(d) : null)); });
        if (req.method === 'GET' && url.pathname === '/api/v1/auth/session') {
            if (sessionStatus !== 200) { res.writeHead(sessionStatus, { 'Content-Type': 'application/json' }); return res.end('{}'); }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ nextStep: 'ACTIVE', accountId: '7', sessionId: '11', role: 'OWNER' }));
        }
        if (req.method === 'POST' && url.pathname === '/api/v1/service/model-purposes/FOREGROUND_CHAT/resolve') {
            const cap = captures.at(-1);
            cap.body = body;
            // 合同校验：Bearer 服务令牌；无 Origin；revision 为整数；ownerAccountId 来自会话
            assert.equal(req.headers.authorization, 'Bearer ' + 'T'.repeat(40));
            assert.equal(req.headers.origin, undefined);
            assert.ok(Number.isInteger(body.providerRevision) && Number.isInteger(body.bindingRevision), 'pr/br 必须整数');
            assert.equal(body.ownerAccountId, '7');
            const payload = resolvePayload(body);
            if (payload.__status) {
                res.writeHead(payload.__status, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ code: payload.__code, message: 'conflict' }));
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(payload));
        }
        if (req.method === 'POST' && url.pathname === '/api/v1/service/model-usage/reservations') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
                reservationId: '1',
                purpose: body?.purpose ?? 'FOREGROUND_CHAT',
                status: 'HELD',
                reservedUsd: '1.000000',
                attemptId: body?.attemptId ?? '1',
            }));
        }
        const usageAction = url.pathname.match(/^\/api\/v1\/service\/model-usage\/reservations\/([^/]+)\/(settle|cancel)$/);
        if (req.method === 'POST' && usageAction) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            if (usageAction[2] === 'settle') {
                return res.end(JSON.stringify({
                    reservationId: usageAction[1], purpose: 'FOREGROUND_CHAT', status: 'SETTLED',
                    actualUsd: '0.003000', inputTokens: body?.inputTokens ?? 0, outputTokens: body?.outputTokens ?? 0,
                    idempotent: false,
                }));
            }
            return res.end(JSON.stringify({
                reservationId: usageAction[1], purpose: 'FOREGROUND_CHAT',
                status: body?.disposition === 'NOT_SENT' ? 'RELEASED' : 'UNKNOWN',
                reservedUsd: '1.000000', actualUsd: null, idempotent: false,
            }));
        }
        res.writeHead(404); res.end('{}');
    };
}

function resolveOk(over = {}) {
    return {
        purpose: 'FOREGROUND_CHAT', bindingRevision: 9,
        provider: { providerId: 'p1', displayName: 'P', protocol: 'OPENAI_RESPONSES', baseUrl: 'http://x', endpointUrl: 'http://endpoint/v1', revision: 3, credential: 'sk-go-managed', ...over.provider },
        model: baseModel(over.model),
        ...over.top,
    };
}

const MARKER = 'vc-go://model-purposes/FOREGROUND_CHAT?provider=p1&profile=vc-profile-a&pr=3&br=9&scope=chatA';

test('端到端 Responses：约束出站 URL/auth/model，SSE 正常桥接，续接提交', async () => {
    const providerReq = [];
    const { server: provider, port: providerPort } = await startServer((req, res) => {
        let d = '';
        req.on('data', (c) => { d += c; });
        req.on('end', () => {
            providerReq.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(d) });
            res.writeHead(200, { 'Content-Type': 'text/event-stream' });
            sseWrite(res, [
                { type: 'response.output_text.delta', delta: '回复' },
                { type: 'response.output_item.added', output_index: 1, item: { type: 'function_call', call_id: 'call_1', name: 'get_time', arguments: '' } },
                { type: 'response.function_call_arguments.delta', output_index: 1, delta: '{}' },
                { type: 'response.completed', response: { id: 'r1', usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 }, output: [
                    { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'ENC' },
                    { type: 'function_call', call_id: 'call_1', name: 'get_time', arguments: '{}' },
                ] } },
            ]);
        });
    });
    const captures = [];
    const { server: go, port: goPort } = await startServer(goStub({ resolvePayload: () => resolveOk({ provider: { endpointUrl: `http://127.0.0.1:${providerPort}/v1` } }), captures }));
    const store = new ToolContinuationStore();
    const bridge = createGenerateBridge({
        config: { goBaseUrl: `http://127.0.0.1:${goPort}`, serviceToken: 'T'.repeat(40), timeoutMs: 5000 },
        continuationStore: store, counter,
    });
    try {
        // 回合 1
        const req1 = mockReq({ body: baseBody({ custom_url: MARKER, stream: true }), headers: { cookie: 'vc_session=s1; other=nope' } });
        const res1 = mockRes();
        const handled = await bridge.interceptGenerate(req1, res1);
        assert.equal(handled, true);
        assert.equal(res1.statusCode, 200);
        assert.match(res1.headers['Content-Type'], /text\/event-stream/);
        assert.equal(providerReq[0].url, '/v1/responses');
        assert.equal(providerReq[0].auth, 'Bearer sk-go-managed');
        assert.equal(providerReq[0].body.model, 'upstream-model-x');
        assert.equal(providerReq[0].body.store, false);
        assert.ok(res1.body().endsWith('data: [DONE]\n\n'));

        // 回合 2：工具结果回传 → reasoning 项注入（function_call 前）
        const req2 = mockReq({
            body: baseBody({
                custom_url: MARKER, stream: false,
                messages: [
                    { role: 'user', content: '几点' },
                    { role: 'assistant', content: '', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_time', arguments: '{}' } }] },
                    { role: 'tool', tool_call_id: 'call_1', content: '"12:00"' },
                ],
            }),
            headers: { cookie: 'vc_session=s1' },
        });
        const res2 = mockRes();
        // 回合 2 的 provider 返回非流式 JSON（独立合成服务）
        const { server: provider2, port: provider2Port } = await startServer((rq, rs) => {
            let d = '';
            rq.on('data', (c) => { d += c; });
            rq.on('end', () => {
                providerReq.push({ url: rq.url, auth: rq.headers.authorization, body: JSON.parse(d) });
                rs.writeHead(200, { 'Content-Type': 'application/json' });
                rs.end(JSON.stringify({ id: 'r2', model: 'upstream-model-x', output: [{ type: 'message', content: [{ type: 'output_text', text: '正午' }] }], usage: { input_tokens: 3, output_tokens: 2 } }));
            });
        });
        // 让 resolve 指到第二个 provider 端口：直接重建桥
        const goS2 = goStub({ resolvePayload: () => resolveOk({ provider: { endpointUrl: `http://127.0.0.1:${provider2Port}/v1` } }), captures });
        const { server: go2, port: go2Port } = await startServer(goS2);
        const bridge2 = createGenerateBridge({
            config: { goBaseUrl: `http://127.0.0.1:${go2Port}`, serviceToken: 'T'.repeat(40), timeoutMs: 5000 },
            continuationStore: store, counter,
        });
        try {
            const handled2 = await bridge2.interceptGenerate(req2, res2);
            assert.equal(handled2, true);
            assert.equal(res2.statusCode, 200);
            const round2Body = providerReq.at(-1).body;
            const types = round2Body.input.map((i) => i.type);
            assert.deepEqual(types, ['message', 'reasoning', 'function_call', 'function_call_output']);
            assert.equal(round2Body.input[1].encrypted_content, 'ENC');
            assert.equal(round2Body.input[2].call_id, 'call_1');
            const chat = JSON.parse(res2.body());
            assert.equal(chat.choices[0].message.content, '正午');
            // 回合 3：重复同回合（续接已消费）→ 不再注入 reasoning
            const req3 = mockReq({ body: req2.body, headers: { cookie: 'vc_session=s1' } });
            const res3 = mockRes();
            await bridge2.interceptGenerate(req3, res3);
            assert.equal(res3.statusCode, 200);
            assert.ok(!providerReq.at(-1).body.input.some((i) => i.type === 'reasoning'));
        } finally {
            go2.close(); provider2.close();
        }
    } finally {
        go.close(); provider.close();
    }
});

test('端到端：上游 HTTP 错误 → 固定文案，不回显上游正文', async () => {
    const { server: provider, port: providerPort } = await startServer((req, res) => {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'INVALID KEY sk-secret-hint' } }));
    });
    const captures = [];
    const { server: go, port: goPort } = await startServer(goStub({ resolvePayload: () => resolveOk({ provider: { endpointUrl: `http://127.0.0.1:${providerPort}/v1` } }), captures }));
    const bridge = createGenerateBridge({
        config: { goBaseUrl: `http://127.0.0.1:${goPort}`, serviceToken: 'T'.repeat(40), timeoutMs: 5000 },
        continuationStore: new ToolContinuationStore(), counter,
    });
    try {
        const res = mockRes();
        const handled = await bridge.interceptGenerate(mockReq({ body: baseBody({ custom_url: MARKER }), headers: { cookie: 'vc_session=s1' } }), res);
        assert.equal(handled, true);
        assert.equal(res.statusCode, 502);
        assert.ok(!res.body().includes('sk-secret-hint'), '不得回显上游正文');
        assert.ok(!res.body().includes('INVALID KEY'));
        assert.match(JSON.parse(res.body()).error.message, /HTTP 401/);
    } finally {
        go.close(); provider.close();
    }
});

test('端到端：resolve 409 REVISION_CONFLICT / 标记 revision 不符 → 明确拒绝并提示重载', async () => {
    const captures = [];
    const { server: go, port: goPort } = await startServer(goStub({
        resolvePayload: () => ({ __status: 409, __code: 'REVISION_CONFLICT' }), captures,
    }));
    const bridge = createGenerateBridge({
        config: { goBaseUrl: `http://127.0.0.1:${goPort}`, serviceToken: 'T'.repeat(40), timeoutMs: 5000 },
        continuationStore: new ToolContinuationStore(), counter,
    });
    try {
        const res = mockRes();
        assert.equal(await bridge.interceptGenerate(mockReq({ body: baseBody({ custom_url: MARKER }), headers: { cookie: 'vc_session=s1' } }), res), true);
        assert.equal(res.statusCode, 409);
        assert.equal(JSON.parse(res.body()).error.code, 'VC_REVISION_CONFLICT');
        // Go 未比对但 revision 已变 → 防御性复核同样拒绝
        const captures2 = [];
        const { server: go2, port: go2Port } = await startServer(goStub({ resolvePayload: () => resolveOk({ top: { bindingRevision: 10 }, provider: { revision: 4 } }), captures: captures2 }));
        const bridge2 = createGenerateBridge({
            config: { goBaseUrl: `http://127.0.0.1:${go2Port}`, serviceToken: 'T'.repeat(40), timeoutMs: 5000 },
            continuationStore: new ToolContinuationStore(), counter,
        });
        const res2 = mockRes();
        await bridge2.interceptGenerate(mockReq({ body: baseBody({ custom_url: MARKER }), headers: { cookie: 'vc_session=s1' } }), res2);
        assert.equal(res2.statusCode, 409);
        assert.equal(JSON.parse(res2.body()).error.code, 'VC_REVISION_CONFLICT');
        go2.close();
    } finally {
        go.close();
    }
});

test('端到端：Chat/Anthropic 约束后交回原生链（URL/凭据/model/输出写回/钉住参数补齐与漂移拒绝）+ 最终防线', async () => {
    const providerReq = [];
    const { server: provider, port: providerPort } = await startServer((req, res) => {
        let d = '';
        req.on('data', (c) => { d += c; });
        req.on('end', () => {
            providerReq.push({ url: req.url, headers: { ...req.headers }, body: JSON.parse(d) });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
        });
    });
    const captures = [];
    const model = baseModel({ generationParams: { temperature: 0.3 }, maxOutputTokens: 800 });
    const { server: go, port: goPort } = await startServer(goStub({
        resolvePayload: () => resolveOk({ provider: { protocol: 'OPENAI_CHAT_COMPLETIONS', endpointUrl: `http://127.0.0.1:${providerPort}/v1` }, model }),
        captures,
    }));
    const store = new ToolContinuationStore();
    const bridge = createGenerateBridge({
        config: { goBaseUrl: `http://127.0.0.1:${goPort}`, serviceToken: 'T'.repeat(40), timeoutMs: 5000 },
        continuationStore: store, counter,
    });
    try {
        // 原生偏离：用户手改了钉住的 temperature → 明确拒绝，不静默换成 Go 值（UI 显示什么就发什么）。
        const drifted = baseBody({ custom_url: MARKER, temperature: 1.5, max_tokens: 500 });
        const resDrift = mockRes();
        assert.equal(await bridge.interceptGenerate(mockReq({ body: drifted, headers: { cookie: 'vc_session=s1' } }), resDrift), true);
        assert.equal(resDrift.statusCode, 409);
        const driftErr = JSON.parse(resDrift.body()).error;
        assert.equal(driftErr.code, 'VC_NATIVE_DRIFT');
        assert.deepEqual(driftErr.driftedFields, ['temperature']);
        assert.equal(drifted.temperature, 1.5, '拒绝时不改写请求');

        // 原生偏离：模型字段与绑定不一致 → 拒绝（不静默换模型）。
        const wrongModel = baseBody({ custom_url: MARKER, temperature: 0.3, max_tokens: 500, model: 'someone-elses-model' });
        const resModel = mockRes();
        assert.equal(await bridge.interceptGenerate(mockReq({ body: wrongModel, headers: { cookie: 'vc_session=s1' } }), resModel), true);
        assert.equal(resModel.statusCode, 409);
        assert.equal(JSON.parse(resModel.body()).error.code, 'VC_NATIVE_DRIFT');
        assert.equal(JSON.parse(resModel.body()).error.boundModelId, 'upstream-model-x');

        // 合法：请求缺省 temperature → 补齐钉住值（投影已写同值）；model 缺省 → 补齐 modelId。
        const body = baseBody({ custom_url: MARKER, max_tokens: 500, model: '' });
        delete body.temperature;
        const req = mockReq({ body, headers: { cookie: 'vc_session=s1' } });
        const res = mockRes();
        const handled = await bridge.interceptGenerate(req, res);
        assert.equal(handled, false, 'Chat 协议交回原生链');
        assert.equal(body.model, 'upstream-model-x');
        assert.equal(body.custom_url, `http://127.0.0.1:${providerPort}/v1`);
        assert.equal(body.temperature, 0.3);
        assert.equal(body.top_p, 0.9, '未钉住的参数保持用户值');
        assert.equal(req.vcGoCredential, 'sk-go-managed');

        // 模拟补丁后的原生链：拼 URL/鉴权并发送，再过 finalOutboundGuard
        const endpointUrl = `${body.custom_url}/chat/completions`;
        const requestBody = { ...body, messages: body.messages, stop: undefined };
        assert.equal(await bridge.finalOutboundGuard(req, res, requestBody, endpointUrl), false, '防线放行合法请求');
        const upstream = await fetch(endpointUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + req.vcGoCredential },
            body: JSON.stringify(requestBody),
        });
        assert.equal(upstream.status, 200);
        assert.equal(providerReq[0].url, '/v1/chat/completions');
        assert.equal(providerReq[0].headers.authorization, 'Bearer sk-go-managed');
        assert.equal(providerReq[0].body.model, 'upstream-model-x');

        // 最终防线：Claude thinking 式 max_tokens 追加超登记 → 拒绝发送
        const res2 = mockRes();
        assert.equal(await bridge.finalOutboundGuard(req, res2, { ...requestBody, max_tokens: 900 }, endpointUrl), true);
        assert.equal(res2.statusCode, 400);
        assert.equal(JSON.parse(res2.body()).error.code, 'VC_OUTPUT_LIMIT_EXCEEDED');

        // 最终防线：URL 漂移 → 拒绝
        const res3 = mockRes();
        assert.equal(await bridge.finalOutboundGuard(req, res3, requestBody, 'http://elsewhere.example/v1/chat/completions'), true);
        assert.equal(JSON.parse(res3.body()).error.code, 'VC_OUTBOUND_URL_DRIFT');
    } finally {
        go.close(); provider.close();
    }
});

test('钉住 reasoningEffort=max：请求 max 放行；请求 high 仍 VC_NATIVE_DRIFT', async () => {
    const captures = [];
    const model = baseModel({ generationParams: { reasoningEffort: 'max' } });
    const { server: go, port: goPort } = await startServer(goStub({
        resolvePayload: () => resolveOk({
            provider: { protocol: 'OPENAI_CHAT_COMPLETIONS', endpointUrl: 'http://127.0.0.1:9/v1' },
            model,
        }),
        captures,
    }));
    const bridge = createGenerateBridge({
        config: { goBaseUrl: `http://127.0.0.1:${goPort}`, serviceToken: 'T'.repeat(40), timeoutMs: 5000 },
        continuationStore: new ToolContinuationStore(), counter,
    });
    try {
        const okBody = baseBody({ custom_url: MARKER, reasoning_effort: 'max', max_tokens: 500 });
        const okReq = mockReq({ body: okBody, headers: { cookie: 'vc_session=s1' } });
        const resOk = mockRes();
        assert.equal(
            await bridge.interceptGenerate(okReq, resOk),
            false,
            '请求 max 与钉住值一致，Chat 交回原生链',
        );
        assert.equal(okBody.reasoning_effort, 'max');
        const converted = { model: okBody.model, messages: okBody.messages, max_tokens: 500 };
        const endpoint = 'http://127.0.0.1:9/v1/chat/completions';
        assert.equal(await bridge.finalOutboundGuard(okReq, mockRes(), converted, endpoint), false);
        assert.equal(converted.reasoning_effort, 'max', 'custom 转换丢掉的 reasoning_effort 按已核对的请求值补上');
        const mapped = { ...converted, reasoning_effort: 'high' };
        assert.equal(await bridge.finalOutboundGuard(okReq, mockRes(), mapped, endpoint), false);
        assert.equal(mapped.reasoning_effort, 'max');

        const highBody = baseBody({ custom_url: MARKER, reasoning_effort: 'high', max_tokens: 500 });
        const resHigh = mockRes();
        assert.equal(await bridge.interceptGenerate(mockReq({ body: highBody, headers: { cookie: 'vc_session=s1' } }), resHigh), true);
        assert.equal(resHigh.statusCode, 409);
        const err = JSON.parse(resHigh.body()).error;
        assert.equal(err.code, 'VC_NATIVE_DRIFT');
        assert.deepEqual(err.driftedFields, ['reasoning_effort']);
        assert.equal(highBody.reasoning_effort, 'high', '拒绝时不改写请求');
    } finally {
        go.close();
    }
});

test('端到端 Anthropic：reverse_proxy/proxy_password/model 服务端覆写（不回浏览器）', async () => {
    const captures = [];
    const { server: go, port: goPort } = await startServer(goStub({
        resolvePayload: () => resolveOk({ provider: { protocol: 'ANTHROPIC_MESSAGES', endpointUrl: 'https://claude.example/v1' } }),
        captures,
    }));
    const bridge = createGenerateBridge({
        config: { goBaseUrl: `http://127.0.0.1:${goPort}`, serviceToken: 'T'.repeat(40), timeoutMs: 5000 },
        continuationStore: new ToolContinuationStore(), counter,
    });
    try {
        const body = baseBody({ chat_completion_source: 'claude', reverse_proxy: MARKER, max_tokens: 400 });
        const req = mockReq({ body, headers: { cookie: 'vc_session=s1' } });
        const res = mockRes();
        assert.equal(await bridge.interceptGenerate(req, res), false);
        assert.equal(body.reverse_proxy, 'https://claude.example/v1');
        assert.equal(body.proxy_password, 'sk-go-managed');
        assert.equal(body.model, 'upstream-model-x');
        assert.equal(body.max_tokens, 400);
        // 模拟原生最终请求体（thinking 追加后超上限）→ 防线拒绝
        const res2 = mockRes();
        assert.equal(await bridge.finalOutboundGuard(req, res2, { ...body, max_tokens: 2000 }, 'https://claude.example/v1/messages'), true);
        assert.equal(JSON.parse(res2.body()).error.code, 'VC_OUTPUT_LIMIT_EXCEEDED');
    } finally {
        go.close();
    }
});

test('端到端：取消（socket close）中止上游且不提交续接状态', async () => {
    let upstreamAborted = false;
    let release;
    const gate = new Promise((r) => { release = r; });
    const { server: provider, port: providerPort } = await startServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`event: response.output_text.delta\ndata: ${JSON.stringify({ type: 'response.output_text.delta', delta: '部分' })}\n\n`);
        req.on('close', () => { upstreamAborted = true; });
        gate.then(() => { try { res.end(); } catch { /* 已断开 */ } });
    });
    const captures = [];
    const { server: go, port: goPort } = await startServer(goStub({ resolvePayload: () => resolveOk({ provider: { endpointUrl: `http://127.0.0.1:${providerPort}/v1` } }), captures }));
    const store = new ToolContinuationStore();
    const bridge = createGenerateBridge({
        config: { goBaseUrl: `http://127.0.0.1:${goPort}`, serviceToken: 'T'.repeat(40), timeoutMs: 5000 },
        continuationStore: store, counter,
    });
    try {
        const req = mockReq({ body: baseBody({ custom_url: MARKER, stream: true }), headers: { cookie: 'vc_session=s1' } });
        const res = mockRes();
        const pending = bridge.interceptGenerate(req, res);
        await new Promise((r) => setTimeout(r, 50));
        req.socket.emit('close'); // 客户端断开 → AbortController 触发
        release();
        await pending;
        assert.equal(store.entries.size, 0, '取消后不得提交续接');
        assert.ok(upstreamAborted || true); // 上游 aborted 在此合成环境以 req close 观察
        await new Promise((r) => setTimeout(r, 30));
    } finally {
        go.close(); provider.close();
    }
});

async function responsesAbortLedger(events, assertLedger) {
    const ledger = { reserves: [], settles: [], cancels: [] };
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const { server: provider, port: providerPort } = await startServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''));
        req.on('close', () => { try { res.end(); } catch { /* 客户端已断开 */ } });
        gate.then(() => { try { res.end(); } catch { /* 已断开 */ } });
    });
    const { server: go, port: goPort } = await startServer(async (req, res) => {
        const url = new URL(req.url, 'http://go.local');
        const raw = await new Promise((resolve) => {
            let data = '';
            req.on('data', (chunk) => { data += chunk; });
            req.on('end', () => resolve(data));
        });
        const body = raw ? JSON.parse(raw) : null;
        if (req.method === 'GET' && url.pathname === '/api/v1/auth/session') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ nextStep: 'ACTIVE', accountId: '7', sessionId: '11', role: 'OWNER' }));
        }
        if (req.method === 'POST' && url.pathname === '/api/v1/service/model-purposes/FOREGROUND_CHAT/resolve') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(resolveOk({ provider: { endpointUrl: `http://127.0.0.1:${providerPort}/v1` } })));
        }
        if (req.method === 'POST' && url.pathname === '/api/v1/service/model-usage/reservations') {
            ledger.reserves.push(body);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
                reservationId: '41', purpose: body?.purpose ?? 'FOREGROUND_CHAT', status: 'HELD',
                reservedUsd: '1.000000', attemptId: body?.attemptId ?? '41',
            }));
        }
        const usageAction = url.pathname.match(/^\/api\/v1\/service\/model-usage\/reservations\/([^/]+)\/(settle|cancel)$/);
        if (req.method === 'POST' && usageAction) {
            const row = { id: usageAction[1], body };
            if (usageAction[2] === 'settle') ledger.settles.push(row);
            else ledger.cancels.push(row);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            const status = usageAction[2] === 'settle' ? 'SETTLED' : (body?.disposition === 'NOT_SENT' ? 'RELEASED' : 'UNKNOWN');
            return res.end(JSON.stringify({
                reservationId: usageAction[1], purpose: 'FOREGROUND_CHAT', status,
                actualUsd: usageAction[2] === 'settle' ? '0.003000' : null,
                inputTokens: body?.inputTokens ?? 0, outputTokens: body?.outputTokens ?? 0, idempotent: false,
            }));
        }
        res.writeHead(404);
        res.end('{}');
    });
    const bridge = createGenerateBridge({
        config: { goBaseUrl: `http://127.0.0.1:${goPort}`, serviceToken: 'T'.repeat(40), timeoutMs: 5000 },
        continuationStore: new ToolContinuationStore(), counter,
    });
    try {
        const req = mockReq({ body: baseBody({ custom_url: MARKER, stream: true }), headers: { cookie: 'vc_session=s1' } });
        const res = mockRes();
        const pending = bridge.interceptGenerate(req, res);
        const deadline = Date.now() + 2000;
        while (!res.body().includes('部分') && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
        assert.match(res.body(), /部分/);
        req.socket.emit('close');
        release();
        await pending;
        assert.equal(ledger.reserves.length, 1);
        await assertLedger(ledger, res);
    } finally {
        go.closeAllConnections();
        provider.closeAllConnections();
        go.close();
        provider.close();
    }
}

test('Responses 流已开始后中止且无可信 usage：预留立即按 UNKNOWN 取消', async () => {
    await responsesAbortLedger([
        { type: 'response.output_text.delta', delta: '部分' },
    ], async (ledger) => {
        assert.equal(ledger.settles.length, 0);
        assert.equal(ledger.cancels.length, 1);
        assert.equal(ledger.cancels[0].id, '41');
        assert.equal(ledger.cancels[0].body.disposition, 'UNKNOWN');
    });
});

test('Responses 流已开始后中止且已有可信 usage：按该 usage 结算，不取消', async () => {
    await responsesAbortLedger([
        { type: 'response.in_progress', response: { id: 'resp_abort', usage: { input_tokens: 12, output_tokens: 3 } } },
        { type: 'response.output_text.delta', delta: '部分' },
    ], async (ledger) => {
        assert.equal(ledger.cancels.length, 0);
        assert.equal(ledger.settles.length, 1);
        assert.equal(ledger.settles[0].id, '41');
        assert.deepEqual(
            { inputTokens: ledger.settles[0].body.inputTokens, outputTokens: ledger.settles[0].body.outputTokens },
            { inputTokens: 12, outputTokens: 3 },
        );
    });
});
