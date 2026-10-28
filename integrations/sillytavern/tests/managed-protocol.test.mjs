// V2-W03 受管端到端夹具测试：固定合成上游 provider 的三协议请求/响应/SSE 事件序、
// 指令化控制（请求体合成标记 / x-vc-fixture 头 / __ctl 覆盖 / modelId 剧本）、
// auth 捕获只记布尔与方案、捕获过滤与计数。纯 Node 本地 HTTP + 随机端口，
// 无 docker / Go / ST / 真实模型调用。
// 许可：AGPL-3.0-only（见 integrations/sillytavern/README；ADR-0009 §3）。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import {
    createProtocolFixtureServer, DEFAULT_EXPECT_KEY, FIXTURE_MODELS, SCRIPTS, buildPlan,
} from '../scripts/managed-protocol-provider.mjs';
import { parseSSEText, collectChatStream, collectAnthropicStream, collectResponsesStream, responsesEventTypes } from '../scripts/managed-lib.mjs';

const KEY = 'vc03m-test-key-0123456789abcdef';
let fixture;

before(async () => {
    fixture = await createProtocolFixtureServer({ port: 0, expectKey: KEY });
});

after(async () => {
    await fixture.api.close();
});

async function post(pathname, body, { headers = {} } = {}) {
    return fetch(fixture.url + pathname, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}`, ...headers },
        body: JSON.stringify(body),
    });
}

async function readSSE(res) {
    assert.equal(res.headers.get('content-type') || '', 'text/event-stream');
    return parseSSEText(await res.text());
}

// ---------------------------------------------------------------------------
// 剧本合成（buildPlan 纯逻辑）
// ---------------------------------------------------------------------------

test('buildPlan：modelId 剧本为缺省，指令按 请求体 > 头 > __ctl 优先级覆盖', () => {
    const base = buildPlan('vc03m-chat', { stream: false }, null, null);
    assert.equal(base.text, SCRIPTS['vc03m-chat'].text);
    assert.equal(base.stream, false);

    const ctl = buildPlan('vc03m-chat', {}, null, { text: 'ctl 覆盖' });
    assert.equal(ctl.text, 'ctl 覆盖');

    const header = buildPlan('vc03m-chat', {}, { text: '头覆盖' }, { text: 'ctl 覆盖' });
    assert.equal(header.text, '头覆盖');

    const body = buildPlan('vc03m-chat', { vc_fixture: { text: '体覆盖' } }, { text: '头覆盖' }, { text: 'ctl 覆盖' });
    assert.equal(body.text, '体覆盖');

    const unknownModel = buildPlan('no-such-model', {}, null, null);
    assert.equal(unknownModel.model, 'no-such-model');
    assert.equal(typeof unknownModel.text, 'string');
});

// ---------------------------------------------------------------------------
// /models 与捕获
// ---------------------------------------------------------------------------

test('GET /models 返回固定清单并可被捕获过滤', async () => {
    const res = await fetch(`${fixture.url}/v1/models`, { headers: { authorization: `Bearer ${KEY}` } });
    const j = await res.json();
    assert.equal(res.status, 200);
    assert.ok(j.data.some((m) => m.id === 'vc03m-chat' && typeof m.display === 'string'));
    assert.equal(j.data.length, FIXTURE_MODELS.length);

    const rows = await fixture.api.captures({ protocol: 'models' });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].auth.matched, true);
    assert.equal(rows[0].auth.scheme, 'bearer');
    assert.equal(rows[0].body, null);
});

test('auth 捕获只记录方案与是否匹配（错误令牌 matched=false，不记录令牌值）', async () => {
    await post('/chat/completions', { model: 'vc03m-chat', messages: [] }, { headers: { authorization: 'Bearer wrong-key' } });
    const rows = await fixture.api.captures({ protocol: 'chat' });
    const wrong = rows.at(-1);
    assert.equal(wrong.auth.matched, false);
    assert.deepEqual(Object.keys(wrong.auth).sort(), ['matched', 'scheme']);
    assert.equal(JSON.stringify(wrong).includes('wrong-key'), false);
});

// ---------------------------------------------------------------------------
// Chat Completions
// ---------------------------------------------------------------------------

test('chat/completions 非流式：工具剧本返回完整 arguments 与 usage', async () => {
    const res = await post('/v1/chat/completions', { model: 'vc03m-tools', messages: [{ role: 'user', content: 'hi' }], stream: false });
    const j = await res.json();
    assert.equal(res.status, 200);
    assert.equal(j.object, 'chat.completion');
    assert.equal(j.choices[0].finish_reason, 'tool_calls');
    assert.equal(j.choices[0].message.tool_calls[0].function.name, 'lookup_weather');
    assert.equal(j.choices[0].message.tool_calls[0].function.arguments, '{"city":"北京","unit":"celsius"}');
    assert.equal(j.usage.total_tokens, j.usage.prompt_tokens + j.usage.completion_tokens);
});

test('chat/completions 流式：分片重组与 [DONE]', async () => {
    const res = await post('/v1/chat/completions', { model: 'vc03m-chat', messages: [], stream: true });
    const events = await readSSE(res);
    const collected = collectChatStream(events);
    assert.equal(collected.content, SCRIPTS['vc03m-chat'].text);
    assert.equal(collected.finish, 'stop');
    assert.equal(collected.sawDone, true);
});

test('chat/completions 指令化错误：状态码与 Retry-After', async () => {
    const res = await post('/chat/completions', {
        model: 'vc03m-chat',
        messages: [],
        stream: false,
        vc_fixture: { error: { status: 429, message: 'synthetic rate limit', retryAfterMs: 2000 } },
    });
    assert.equal(res.status, 429);
    assert.equal(res.headers.get('retry-after'), '2');
    const j = await res.json();
    assert.equal(j.error.code, 'rate_limited');
});

test('chat/completions 延迟指令：首包延迟可观测（取消路径）', async () => {
    const started = Date.now();
    const res = await post('/chat/completions', {
        model: 'vc03m-chat',
        messages: [],
        stream: true,
        vc_fixture: { delay: { firstMs: 260 }, chunks: 2 },
    });
    await res.text();
    assert.ok(Date.now() - started >= 250, '首包延迟应生效');
});

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

test('responses 非流式：reasoning(encrypted_content) + function_call + usage 同构', async () => {
    const res = await post('/v1/responses', { model: 'vc03m-reasoning', stream: false });
    const j = await res.json();
    assert.equal(res.status, 200);
    assert.equal(j.object, 'response');
    const reasoning = j.output.find((i) => i.type === 'reasoning');
    const call = j.output.find((i) => i.type === 'function_call');
    assert.ok(reasoning && typeof reasoning.encrypted_content === 'string' && reasoning.encrypted_content.length > 0);
    assert.equal(call.name, 'lookup_weather');
    assert.equal(call.arguments, '{"city":"广州"}');
    assert.ok(j.output.indexOf(reasoning) < j.output.indexOf(call));
    assert.equal(j.usage.input_tokens, 21);
});

test('responses 流式：事件序 response.created → reasoning → function_call 分片 → response.completed', async () => {
    const res = await post('/v1/responses', { model: 'vc03m-reasoning', stream: true });
    const events = await readSSE(res);
    const types = responsesEventTypes(events);
    assert.equal(types[0], 'response.created');
    assert.ok(types.includes('response.output_item.added'));
    assert.ok(types.includes('response.reasoning_text.delta'));
    assert.ok(types.includes('response.output_item.done'));
    assert.equal(types.filter((t) => t === 'response.function_call_arguments.delta').length, 2, 'arguments 应分两片');
    assert.equal(types.at(-1), 'response.completed');
    const collected = collectResponsesStream(events);
    assert.equal(collected.calls[0].arguments, '{"city":"广州"}');
    assert.equal(collected.completedUsage.output_tokens, 13);
});

test('responses 文本剧本（vc03m-usage）：output_text delta 与固定用量', async () => {
    const res = await post('/v1/responses', { model: 'vc03m-usage', stream: true });
    const events = await readSSE(res);
    const collected = collectResponsesStream(events);
    assert.ok(collected.content.length > 0);
    assert.deepEqual(collected.completedUsage, { input_tokens: 101, output_tokens: 37, total_tokens: 138 });
});

test('responses 指令化错误：error 事件前的 HTTP 状态', async () => {
    const res = await post('/v1/responses', {
        model: 'vc03m-reasoning',
        stream: false,
        vc_fixture: { error: { status: 503, message: 'down' } },
    });
    assert.equal(res.status, 503);
    assert.ok((await res.json()).error);
});

// ---------------------------------------------------------------------------
// Anthropic Messages
// ---------------------------------------------------------------------------

test('messages 非流式：system/messages 请求形状被捕获；文本块与 usage', async () => {
    const res = await post('/v1/messages', {
        model: 'vc03m-chat',
        system: '受管验收系统提示',
        messages: [{ role: 'user', content: '你好' }],
        max_tokens: 512,
        stream: false,
    });
    const j = await res.json();
    assert.equal(res.status, 200);
    assert.equal(j.type, 'message');
    assert.equal(j.content[0].type, 'text');
    assert.equal(j.stop_reason, 'end_turn');
    assert.equal(j.usage.input_tokens, 21);

    const cap = (await fixture.api.captures({ protocol: 'anthropic' })).at(-1);
    assert.equal(cap.body.system, '受管验收系统提示');
    assert.equal(cap.body.messages[0].role, 'user');
    assert.equal(cap.body.max_tokens, 512);
    assert.equal(cap.finalUrl.endsWith('/v1/messages'), true);
});

test('messages 流式：content_block 事件序与 tool_use 分片', async () => {
    const res = await post('/v1/messages', {
        model: 'vc03m-tools',
        messages: [{ role: 'user', content: '查天气' }],
        max_tokens: 256,
        stream: true,
    });
    const events = await readSSE(res);
    const collected = collectAnthropicStream(events);
    assert.equal(collected.stopReason, 'tool_use');
    assert.equal(collected.tools.length, 1);
    assert.equal(collected.tools[0].name, 'lookup_weather');
    assert.equal(collected.tools[0].input, '{"city":"北京","unit":"celsius"}');
    const types = events.map((e) => e.data?.type);
    assert.equal(types[0], 'message_start');
    assert.ok(types.includes('content_block_delta') && types.includes('content_block_stop'));
    assert.equal(types.at(-1), 'message_stop');
    assert.ok(types.indexOf('message_delta') < types.indexOf('message_stop'));
});

test('messages x-api-key 方案：同值匹配通过', async () => {
    const res = await fetch(`${fixture.url}/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': KEY },
        body: JSON.stringify({ model: 'vc03m-chat', messages: [{ role: 'user', content: 'x' }], max_tokens: 8 }),
    });
    assert.equal(res.status, 200);
    const cap = (await fixture.api.captures({ protocol: 'anthropic' })).at(-1);
    assert.equal(cap.auth.scheme, 'x-api-key');
    assert.equal(cap.auth.matched, true);
});

// ---------------------------------------------------------------------------
// __ctl 覆盖与捕获清理
// ---------------------------------------------------------------------------

test('__ctl 通配与按模型覆盖经 x-vc-fixture 头路径生效并可复位', async () => {
    await fixture.api.setOverride('*', { text: '通配覆盖文本' });
    const res = await post('/chat/completions', { model: 'vc03m-chat', messages: [], stream: false });
    const j = await res.json();
    assert.equal(j.choices[0].message.content, '通配覆盖文本');
    await fixture.api.setOverride('*', null);
    const res2 = await post('/chat/completions', { model: 'vc03m-chat', messages: [], stream: false });
    const j2 = await res2.json();
    assert.equal(j2.choices[0].message.content, SCRIPTS['vc03m-chat'].text);
    const ctl = await fixture.api.overrides();
    assert.deepEqual(ctl.models, []);
});

test('__captures/clear 丢弃内存捕获；since 过滤只取增量', async () => {
    await fixture.api.clear();
    const before = await fixture.api.count();
    assert.equal(before, 0);
    const seqMark = (await fixture.api.captures({})).length;
    assert.equal(seqMark, 0);
    await post('/chat/completions', { model: 'vc03m-chat', messages: [] });
    await post('/v1/responses', { model: 'vc03m-usage' });
    assert.equal(await fixture.api.count(), 2);
    assert.equal(await fixture.api.count({ protocol: 'responses' }), 1);
    const first = (await fixture.api.captures({ protocol: 'chat' }))[0];
    assert.equal((await fixture.api.captures({ since: first.seq, protocol: 'chat' })).length, 0);
});

test('客户端中途断开：流式请求标记 aborted 且不写后续分片', async () => {
    const controller = new AbortController();
    const res = await fetch(`${fixture.url}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
        body: JSON.stringify({ model: 'vc03m-chat', messages: [], stream: true, vc_fixture: { delay: { perChunkMs: 150 }, chunks: 8 } }),
        signal: controller.signal,
    }).catch(() => null);
    assert.ok(res, '应先建立连接');
    setTimeout(() => controller.abort(), 120);
    await res.text().catch(() => { /* 预期中断 */ });
    // handler 在最后一片延迟后落 aborted 标记：轮询等待，避免读早于赋值
    let cap = null;
    for (let i = 0; i < 20 && cap?.aborted !== true; i += 1) {
        cap = (await fixture.api.captures({ protocol: 'chat' })).at(-1);
        if (cap?.aborted !== true) await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(cap.aborted, true);
});
