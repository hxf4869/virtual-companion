// SX-5：真实生成入口与私有登记的离线契约测试。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { createAdminBridge } from '../server-plugin/virtual-companion/lib/admin-bridge.js';
import { createGenerateBridge } from '../server-plugin/virtual-companion/lib/generate-bridge.js';
import { ToolContinuationStore } from '../server-plugin/virtual-companion/lib/responses-adapter.js';

const HEADER = 'x-vc-stored-chat-generation';
const ACCOUNT_ID = '9007199254740993';
const SCOPE = Object.freeze({
    chatId: 'b0000000-0000-4000-8000-000000000001',
    requestId: 'b0000000-0000-4000-8000-000000000002',
    generationRunId: 'b0000000-0000-4000-8000-000000000003',
    authorityEpoch: '12',
    chatRevision: '9007199254740995',
    inputMessageId: 'b0000000-0000-4000-8000-000000000004',
    inputCandidateId: 'b0000000-0000-4000-8000-000000000005',
});
const REGISTRATION_PATH = `/api/v1/service/chats/${SCOPE.chatId}/generation-runs`;
const ACK = {
    ...SCOPE,
    inputMessageRevision: '2',
    inputSourceRevision: '3',
    inputSourceGeneration: '1',
    metadataRevision: '0',
    orderRevision: '3',
    branchRoot: 'b0000000-0000-4000-8000-000000000006',
    registeredAt: '2026-11-07T01:02:03.123456Z',
    expiresAt: '2026-11-07T01:17:03.123456Z',
};
const SESSION = { accountId: ACCOUNT_ID, sessionId: '11', nextStep: 'ACTIVE' };
const CONFIG = { goBaseUrl: 'https://go.invalid', serviceToken: 'synthetic-service-token', timeoutMs: 5000 };
const USAGE = { input_tokens: 12, output_tokens: 4 };

function mockResponse() {
    return {
        statusCode: 200,
        headers: {},
        setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
        end(body) { this.text = body; this.headersSent = this.writableEnded = true; },
    };
}

function generateRequest(protocol, { tool = false, header = JSON.stringify(SCOPE) } = {}) {
    const marker = 'vc-go://model-purposes/FOREGROUND_CHAT?scope=legacy-marker-scope';
    const anthropic = protocol === 'ANTHROPIC_MESSAGES';
    return Object.assign(new EventEmitter(), {
        socket: new EventEmitter(),
        headers: {
            cookie: 'vc_session=synthetic; vc_csrf=synthetic-csrf; other=excluded',
            origin: 'https://browser.invalid',
            'x-vc-expected-account-id': ACCOUNT_ID,
            'x-vc-expected-session-id': '11',
            'x-vc-owner-account-id': '99',
            ...(header !== null ? { [HEADER]: header } : {}),
        },
        vcIdentity: { accountId: ACCOUNT_ID, sessionId: '11', handle: 'synthetic' },
        body: {
            chat_completion_source: anthropic ? 'claude' : 'custom',
            [anthropic ? 'reverse_proxy' : 'custom_url']: marker,
            messages: [{ role: 'user', content: 'synthetic input' }],
            ...(tool ? {
                vc_chat_identity: 'b0000000-0000-4000-8000-000000000007',
                tools: [{ type: 'function', function: {
                    name: 'query_scheduled_follow_ups', parameters: { type: 'object', properties: {} },
                } }],
            } : {}),
        },
    });
}

function stack(t, {
    protocol = 'OPENAI_RESPONSES',
    registration = () => Response.json(ACK, { status: 201 }),
    providerFailure = false,
    tool = false,
    beforeNative,
} = {}) {
    const events = [];
    const registrations = [];
    const providerCalls = [];
    t.mock.method(globalThis, 'fetch', async (url, init) => {
        const pathname = new URL(url).pathname;
        switch (pathname) {
            case '/api/v1/auth/session':
                events.push('session');
                return Response.json(SESSION);
            case '/api/v1/service/model-purposes/FOREGROUND_CHAT/resolve':
                events.push('resolve');
                return Response.json({
                    bindingRevision: 9,
                    provider: {
                        providerId: 'p1', protocol, revision: 3,
                        baseUrl: 'https://provider.invalid/v1', credential: 'synthetic-provider-key',
                    },
                    model: {
                        profileKey: 'test-profile', modelId: 'test-model',
                        contextWindowTokens: 8192, maxOutputTokens: 128,
                        capabilities: { toolCalls: 'VERIFIED' },
                    },
                });
            case REGISTRATION_PATH: {
                events.push('register');
                registrations.push({ url, init });
                const result = await registration(init);
                events.push('ack');
                return result;
            }
            case '/api/v1/service/model-usage/reservations':
                events.push('reserve');
                return Response.json({ status: 'HELD', reservationId: '1' });
            case '/api/v1/service/model-usage/reservations/1/settle':
            case '/api/v1/service/model-usage/reservations/1/cancel':
                return Response.json({});
            case '/api/v1/st/tools/execute':
                events.push('tool');
                assert.equal(new Headers(init.headers).has(HEADER), false);
                assert.equal(JSON.stringify(JSON.parse(init.body)).includes(SCOPE.generationRunId), false);
                return Response.json({ executionId: 'synthetic-exec', result: { followUps: [] } });
            default:
                assert.fail(`unexpected Go request: ${pathname}`);
        }
    });
    const fetchImpl = async (url, init) => {
        events.push('provider');
        providerCalls.push({ url, init });
        if (providerFailure) return new Response('', { status: 503 });
        return Response.json({
            id: 'synthetic-response',
            output: tool && providerCalls.length === 1
                ? [{ type: 'function_call', name: 'query_scheduled_follow_ups', call_id: 'call_1', arguments: '{}' }]
                : [{ type: 'message', content: [{ type: 'output_text', text: 'synthetic reply' }] }],
            usage: USAGE,
        });
    };
    const bridge = createGenerateBridge({ config: CONFIG, continuationStore: new ToolContinuationStore(), fetchImpl });
    const generate = async (request) => {
        const response = mockResponse();
        if (!await bridge.interceptGenerate(request, response)) {
            // 模拟两条原生链对转换后请求体的最终钩子与发出请求。
            beforeNative?.(request);
            const body = { model: request.body.model, messages: request.body.messages, max_tokens: request.body.max_tokens };
            const url = request.vcManaged.expectedUrl;
            if (!await bridge.finalOutboundGuard(request, response, body, url)) {
                await fetchImpl(url, { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
            }
        }
        return response;
    };
    return { events, registrations, providerCalls, generate };
}

test('无登记头的现有请求继续生成，不借用绑定标记或工具聊天身份登记', async (t) => {
    const { events, generate } = stack(t);
    const response = await generate(generateRequest('OPENAI_RESPONSES', { header: null }));
    assert.equal(response.statusCode, 200);
    assert.deepEqual(events, ['session', 'resolve', 'reserve', 'provider']);
});

for (const protocol of ['OPENAI_RESPONSES', 'OPENAI_CHAT_COMPLETIONS', 'ANTHROPIC_MESSAGES']) {
    test(`${protocol} 等待 Go 201 后才预留及发出，并隔离登记 scope 和服务凭据`, async (t) => {
        const entered = Promise.withResolvers();
        const reply = Promise.withResolvers();
        const { events, registrations, providerCalls, generate } = stack(t, {
            protocol,
            registration() {
                entered.resolve();
                return reply.promise;
            },
        });
        const request = generateRequest(protocol);
        const pending = generate(request);
        await entered.promise;
        assert.deepEqual(events, ['session', 'resolve', 'register']);
        reply.resolve(Response.json(ACK, { status: 201 }));
        assert.equal((await pending).statusCode, 200);
        assert.deepEqual(events, ['session', 'resolve', 'register', 'ack', 'reserve', 'provider']);

        const [{ url, init }] = registrations;
        const { chatId, ...payload } = SCOPE;
        assert.equal(url, `${CONFIG.goBaseUrl}/api/v1/service/chats/${chatId}/generation-runs`);
        assert.equal(init.method, 'POST');
        assert.equal(init.redirect, 'manual');
        assert.deepEqual(Object.fromEntries(new Headers(init.headers)), {
            accept: 'application/json', authorization: `Bearer ${CONFIG.serviceToken}`, 'content-type': 'application/json',
        });
        assert.deepEqual(JSON.parse(init.body), { ...payload, ownerAccountId: ACCOUNT_ID });

        const [outbound] = providerCalls;
        const outboundHeaders = new Headers(outbound.init.headers);
        assert.equal(outboundHeaders.has(HEADER), false);
        assert.equal(outboundHeaders.has('cookie'), false);
        assert.equal(outboundHeaders.has('origin'), false);
        assert.notEqual(outboundHeaders.get('authorization'), `Bearer ${CONFIG.serviceToken}`);
        for (const field of Object.keys(SCOPE)) {
            assert.equal(Object.hasOwn(request.body, field), false);
            assert.equal(Object.hasOwn(JSON.parse(outbound.init.body), field), false);
        }
    });
}

test('嵌套 HTTP 生成原样重用登记请求，工具续轮不再次登记', async (t) => {
    const { events, registrations, generate } = stack(t, { tool: true });
    assert.equal((await generate(generateRequest('OPENAI_RESPONSES', { tool: true }))).statusCode, 200);
    assert.deepEqual(events, ['session', 'resolve', 'register', 'ack', 'reserve', 'provider', 'tool', 'reserve', 'provider']);
    assert.equal((await generate(generateRequest('OPENAI_RESPONSES'))).statusCode, 200);
    assert.equal(registrations.length, 2);
    assert.equal(registrations[0].init.body, registrations[1].init.body);
    assert.equal(registrations[0].url, registrations[1].url);
});

test('登记 ACK 不触发上游失败后的自动重发', async (t) => {
    const { events, generate } = stack(t, { providerFailure: true });
    const response = await generate(generateRequest('OPENAI_RESPONSES'));
    assert.equal(JSON.parse(response.text).error.code, 'VC_UPSTREAM_ERROR');
    assert.deepEqual(events, ['session', 'resolve', 'register', 'ack', 'reserve', 'provider']);
});

test('无效登记头与注入 Owner 字段在任何出站前拒绝', async (t) => {
    const { events, generate } = stack(t);
    for (const header of [
        '{invalid',
        'null',
        JSON.stringify([SCOPE]),
        JSON.stringify({ ...SCOPE, inputCandidateId: undefined }),
        JSON.stringify({ ...SCOPE, chatId: '../foreign' }),
        JSON.stringify({ ...SCOPE, chatRevision: 3 }),
        JSON.stringify({ ...SCOPE, authorityEpoch: '012' }),
        JSON.stringify({ ...SCOPE, ownerAccountId: '99' }),
        [JSON.stringify(SCOPE)],
    ]) {
        const response = await generate(generateRequest('OPENAI_RESPONSES', { header }));
        assert.equal(response.statusCode, 400);
        assert.equal(JSON.parse(response.text).error.code, 'INVALID_REQUEST');
    }
    assert.deepEqual(events, []);
});

test('登记前核对宿主与 Go 当前会话，浏览器预期身份头不能代替可信身份', async (t) => {
    const { registrations, providerCalls, generate } = stack(t);
    for (const identity of [undefined, { accountId: '99', sessionId: '11' }, { accountId: ACCOUNT_ID, sessionId: '12' }]) {
        const request = generateRequest('OPENAI_RESPONSES');
        request.vcIdentity = identity;
        const response = await generate(request);
        assert.equal(JSON.parse(response.text).error.code, 'ACCOUNT_CONTEXT_CHANGED');
    }
    assert.equal(registrations.length, 0);
    assert.equal(providerCalls.length, 0);
});

test('非 201、Go 拒绝和无效回执停止生成，浏览器只收到固定错误码和文案', async (t) => {
    const rejected = (code) => Response.json({
        code, message: 'private Go body', details: { value: 'private Go details' },
    }, { status: 409, headers: { 'x-private': 'private Go header' } });
    const failure = 'VC_CHAT_GENERATION_REGISTRATION_FAILED';
    for (const [label, registration, expectedStatus, expectedCode] of [
        ['200', () => Response.json(ACK), 502, failure],
        ['redirect', () => Response.redirect('https://foreign.invalid/', 307), 502, failure],
        ['authority', () => rejected('CHAT_AUTHORITY_CHANGED'), 409, 'CHAT_AUTHORITY_CHANGED'],
        ['fenced', () => rejected('CHAT_GENERATION_FENCED'), 409, 'CHAT_GENERATION_FENCED'],
        ['revision', () => rejected('REVISION_CONFLICT'), 409, 'REVISION_CONFLICT'],
        ['unknown code', () => rejected('private Go code'), 502, failure],
        ['bad JSON', () => new Response('private Go body', { status: 201 }), 502, failure],
        ['wrong scope', () => Response.json({ ...ACK, chatRevision: '123' }, { status: 201 }), 502, failure],
        ['missing field', () => Response.json({ ...ACK, branchRoot: undefined }, { status: 201 }), 502, failure],
        ['wrong expiry', () => Response.json({ ...ACK, expiresAt: ACK.registeredAt }, { status: 201 }), 502, failure],
    ]) {
        await t.test(label, async (subtest) => {
            const { events, generate } = stack(subtest, { registration });
            const response = await generate(generateRequest('OPENAI_RESPONSES', { tool: true }));
            assert.equal(response.statusCode, expectedStatus);
            assert.equal(JSON.parse(response.text).error.code, expectedCode);
            assert.doesNotMatch(response.text, /private Go/);
            assert.equal(response.headers['x-private'], undefined);
            assert.deepEqual(events, ['session', 'resolve', 'register', 'ack']);
        });
    }
});

test('客户端在登记前、等待回执或原生交接时断开，工具、预留与 provider 调用均为零', async (t) => {
    const waiting = Promise.withResolvers();
    const { events, generate } = stack(t, {
        registration({ signal }) {
            // 模拟 Go 已完成事务但客户端正好取消等待。
            const reply = Promise.withResolvers();
            signal.addEventListener('abort', () => reply.resolve(Response.json(ACK, { status: 201 })), { once: true });
            waiting.resolve();
            return reply.promise;
        },
    });
    const closed = generateRequest('OPENAI_CHAT_COMPLETIONS');
    closed.socket.destroyed = true;
    assert.equal((await generate(closed)).statusCode, 504);
    assert.deepEqual(events, ['session', 'resolve']);

    const request = generateRequest('OPENAI_RESPONSES', { tool: true });
    const pending = generate(request);
    await waiting.promise;
    request.socket.emit('close');
    assert.equal((await pending).statusCode, 504);
    assert.deepEqual(events, ['session', 'resolve', 'session', 'resolve', 'register', 'ack']);
    assert.equal(request.socket.listenerCount('close'), 0);

    await t.test('原生交接', async (subtest) => {
        const native = stack(subtest, {
            protocol: 'ANTHROPIC_MESSAGES',
            beforeNative(request) { request.socket.destroyed = true; },
        });
        assert.equal((await native.generate(generateRequest('ANTHROPIC_MESSAGES'))).statusCode, 504);
        assert.deepEqual(native.events, ['session', 'resolve', 'register', 'ack']);
    });
});

test('浏览器管理桥拒绝代理私有生成登记路由', async () => {
    const handler = createAdminBridge({ config: CONFIG, fetchImpl() { assert.fail('service path reached Go'); } });
    const response = mockResponse();
    await handler({ method: 'POST', url: REGISTRATION_PATH, headers: {} }, response);
    assert.equal(response.statusCode, 404);
    assert.equal(JSON.parse(response.text).error.code, 'VC_BRIDGE_ROUTE_NOT_ALLOWED');
});
