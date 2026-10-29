import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { createGenerateBridge } from '../server-plugin/virtual-companion/lib/generate-bridge.js';
import { abandonOutbound, armUsageHold, installUsageFetch, readProviderUsage, settleArmedResponse, uninstallUsageFetch } from '../server-plugin/virtual-companion/lib/model-usage.js';
import { ToolContinuationStore } from '../server-plugin/virtual-companion/lib/responses-adapter.js';

test('供应商信封里的 usage 可结算，且不带回正文', () => {
    assert.deepEqual(
        readProviderUsage({ success: true, data: { usage: { prompt_tokens: 38, completion_tokens: 32 } } }),
        { inputTokens: 38, outputTokens: 32 },
    );
    assert.deepEqual(
        readProviderUsage({ usage: { prompt_tokens: 1, completion_tokens: 2 } }),
        { inputTokens: 1, outputTokens: 2 },
    );
    assert.equal(readProviderUsage({ success: true, data: { choices: [] } }), undefined);
    const packed = JSON.stringify(readProviderUsage({
        success: true,
        data: { usage: { prompt_tokens: 1, completion_tokens: 0 }, choices: [{ message: { content: 'secret-body' } }] },
    }));
    assert.equal(packed.includes('secret-body'), false);
});

test('node-fetch 响应结算已武装预留：SSE usage 入账，正文不入账', async () => {
    const hits = [];
    const server = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
            hits.push({ path: req.url || '', body: Buffer.concat(chunks).toString('utf8') });
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end('{"reservationId":"7","status":"SETTLED","idempotent":false}');
        });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    installUsageFetch();
    try {
        const expectedUrl = 'http://127.0.0.1:9/v1/chat/completions';
        const request = {};
        armUsageHold({
            reservationId: '7',
            ownerAccountId: '1',
            expectedUrl,
            config: { goBaseUrl: `http://127.0.0.1:${port}`, serviceToken: 'synthetic', timeoutMs: 2000 },
            request,
        });
        const sse = [
            'data: {"choices":[{"delta":{"content":"secret-body"}}]}',
            '',
            'data: {"choices":[],"usage":{"prompt_tokens":263,"completion_tokens":283}}',
            '',
            'data: [DONE]',
            '',
        ].join('\n');
        settleArmedResponse(new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } }), 'http://127.0.0.1:9/elsewhere', request);
        assert.equal(hits.length, 0);
        settleArmedResponse(new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } }), expectedUrl, request);
        const deadline = Date.now() + 2000;
        while (hits.length === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
        assert.equal(hits.length, 1);
        assert.match(hits[0].path, /\/reservations\/7\/settle$/);
        const payload = JSON.parse(hits[0].body);
        assert.deepEqual(
            { inputTokens: payload.inputTokens, outputTokens: payload.outputTokens },
            { inputTokens: 263, outputTokens: 283 },
        );
        assert.equal(hits[0].body.includes('secret-body'), false);
    } finally {
        uninstallUsageFetch();
        await new Promise((resolve) => server.close(resolve));
    }
});

function claudeSse(secret) {
    const ev = (type, payload) => `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`;
    return [
        ev('message_start', {
            message: {
                id: 'msg_1', type: 'message', role: 'assistant', content: [],
                usage: { input_tokens: 25, output_tokens: 1 },
            },
        }),
        ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: secret } }),
        ev('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 15 } }),
        ev('message_stop', {}),
    ].join('');
}

async function listenLedger() {
    const hits = [];
    const server = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
            hits.push({ path: req.url || '', body: Buffer.concat(chunks).toString('utf8') });
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end('{"reservationId":"1","status":"SETTLED","idempotent":false}');
        });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const config = { goBaseUrl: `http://127.0.0.1:${server.address().port}`, serviceToken: 'synthetic', timeoutMs: 2000 };
    return {
        hits,
        config,
        close: () => new Promise((resolve) => server.close(resolve)),
    };
}

test('Claude SSE 与非流式 JSON 的用量都能结算，正文不入账', async () => {
    const ledger = await listenLedger();
    const expectedUrl = 'http://127.0.0.1:9/v1/messages';
    installUsageFetch();
    try {
        const request = {};
        armUsageHold({
            reservationId: '21', ownerAccountId: '1', expectedUrl, config: ledger.config, request,
        });
        settleArmedResponse(new Response(claudeSse('secret-claude'), {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
        }), expectedUrl, request);
        const deadline = Date.now() + 2000;
        while (!ledger.hits.some((hit) => hit.path.includes('/21/settle')) && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 20));
        }
        const sseHit = ledger.hits.find((hit) => hit.path.includes('/21/settle'));
        assert.ok(sseHit, 'message_start 与 message_delta 应结算');
        const ssePayload = JSON.parse(sseHit.body);
        assert.deepEqual(
            { inputTokens: ssePayload.inputTokens, outputTokens: ssePayload.outputTokens },
            { inputTokens: 25, outputTokens: 15 },
        );
        assert.equal(sseHit.body.includes('secret-claude'), false);

        armUsageHold({
            reservationId: '22', ownerAccountId: '1', expectedUrl, config: ledger.config, request,
        });
        settleArmedResponse(Response.json({
            id: 'msg_2',
            type: 'message',
            content: [{ type: 'text', text: 'secret-json' }],
            usage: { input_tokens: 10, output_tokens: 4 },
        }), expectedUrl, request);
        while (!ledger.hits.some((hit) => hit.path.includes('/22/settle')) && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 20));
        }
        const jsonHit = ledger.hits.find((hit) => hit.path.includes('/22/settle'));
        assert.ok(jsonHit, '非流式 usage 应结算');
        const jsonPayload = JSON.parse(jsonHit.body);
        assert.deepEqual(
            { inputTokens: jsonPayload.inputTokens, outputTokens: jsonPayload.outputTokens },
            { inputTokens: 10, outputTokens: 4 },
        );
        assert.equal(jsonHit.body.includes('secret-json'), false);
    } finally {
        uninstallUsageFetch();
        await ledger.close();
    }
});

test('原生 fetch 抛错时按 UNKNOWN 取消已武装预留，地址不符不取消', async () => {
    const ledger = await listenLedger();
    const expectedUrl = 'http://127.0.0.1:9/v1/messages';
    installUsageFetch();
    try {
        const request = {};
        await armUsageHold({
            reservationId: '9', ownerAccountId: '1', expectedUrl, config: ledger.config, request,
        });
        await abandonOutbound('http://127.0.0.1:9/elsewhere', request);
        assert.equal(ledger.hits.length, 0);
        await Promise.resolve().then(() => {
            const error = new Error('socket hang up');
            error.name = 'AbortError';
            throw error;
        }).catch(async (error) => {
            await abandonOutbound(expectedUrl, request);
            throw error;
        }).then(() => assert.fail('fetch 抛错必须继续抛出'), () => {});
        assert.equal(ledger.hits.length, 1);
        assert.match(ledger.hits[0].path, /\/reservations\/9\/cancel$/);
        assert.equal(JSON.parse(ledger.hits[0].body).disposition, 'UNKNOWN');
        settleArmedResponse(Response.json({ usage: { input_tokens: 1, output_tokens: 1 } }), expectedUrl, request);
        await new Promise((resolve) => setTimeout(resolve, 40));
        assert.equal(ledger.hits.length, 1, '取消后不能再结算同一预留');
    } finally {
        uninstallUsageFetch();
        await ledger.close();
    }
});

test('再次武装时按 UNKNOWN 取消仍未结算的旧预留', async () => {
    const ledger = await listenLedger();
    const expectedUrl = 'http://127.0.0.1:9/v1/chat/completions';
    installUsageFetch();
    try {
        const request = {};
        await armUsageHold({
            reservationId: '11', ownerAccountId: '1', expectedUrl, config: ledger.config, request,
        });
        await armUsageHold({
            reservationId: '12', ownerAccountId: '1', expectedUrl, config: ledger.config, request,
        });
        const cancelled = ledger.hits.find((hit) => hit.path.includes('/11/cancel'));
        assert.ok(cancelled, '旧预留必须取消');
        assert.equal(JSON.parse(cancelled.body).disposition, 'UNKNOWN');
        assert.equal(ledger.hits.some((hit) => hit.path.includes('/12/')), false);
        settleArmedResponse(Response.json({ usage: { input_tokens: 3, output_tokens: 4 } }), expectedUrl, request);
        const deadline = Date.now() + 2000;
        while (!ledger.hits.some((hit) => hit.path.includes('/12/settle')) && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 20));
        }
        const settled = ledger.hits.find((hit) => hit.path.includes('/12/settle'));
        assert.ok(settled);
        assert.deepEqual(
            { inputTokens: JSON.parse(settled.body).inputTokens, outputTokens: JSON.parse(settled.body).outputTokens },
            { inputTokens: 3, outputTokens: 4 },
        );
        assert.equal(ledger.hits.some((hit) => hit.path.includes('/11/settle')), false);
    } finally {
        uninstallUsageFetch();
        await ledger.close();
    }
});

test('两路重叠且上游 URL 相同：各自结算自己的用量，互不取消', async () => {
    const ledger = await listenLedger();
    const expectedUrl = 'http://127.0.0.1:9/v1/chat/completions';
    installUsageFetch();
    try {
        const requestA = { id: 'A' };
        const requestB = { id: 'B' };
        await armUsageHold({
            reservationId: '31', ownerAccountId: '1', expectedUrl, config: ledger.config, request: requestA,
        });
        await armUsageHold({
            reservationId: '32', ownerAccountId: '1', expectedUrl, config: ledger.config, request: requestB,
        });
        assert.equal(ledger.hits.some((hit) => hit.path.includes('/cancel')), false, '后到的预留不得取消先到的预留');
        settleArmedResponse(Response.json({
            usage: { prompt_tokens: 10, completion_tokens: 1 },
            choices: [{ message: { content: 'secret-a' } }],
        }), expectedUrl, requestA);
        settleArmedResponse(Response.json({
            usage: { prompt_tokens: 20, completion_tokens: 2 },
            choices: [{ message: { content: 'secret-b' } }],
        }), expectedUrl, requestB);
        const deadline = Date.now() + 2000;
        while (ledger.hits.filter((hit) => hit.path.includes('/settle')).length < 2 && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 20));
        }
        const settleA = ledger.hits.find((hit) => hit.path.includes('/31/settle'));
        const settleB = ledger.hits.find((hit) => hit.path.includes('/32/settle'));
        assert.ok(settleA, '第一路必须按自己的预留结算');
        assert.ok(settleB, '第二路必须按自己的预留结算');
        assert.deepEqual(
            { inputTokens: JSON.parse(settleA.body).inputTokens, outputTokens: JSON.parse(settleA.body).outputTokens },
            { inputTokens: 10, outputTokens: 1 },
        );
        assert.deepEqual(
            { inputTokens: JSON.parse(settleB.body).inputTokens, outputTokens: JSON.parse(settleB.body).outputTokens },
            { inputTokens: 20, outputTokens: 2 },
        );
        assert.equal(ledger.hits.some((hit) => hit.path.includes('/cancel')), false);
        assert.equal(settleA.body.includes('secret-a'), false);
        assert.equal(settleB.body.includes('secret-b'), false);
    } finally {
        uninstallUsageFetch();
        await ledger.close();
    }
});

const marker = 'vc-go://model-purposes/FOREGROUND_CHAT?provider=p&profile=m&pr=1&br=1&scope=fixture-chat-1';
const resolveBody = {
    bindingRevision: 1,
    provider: {
        providerId: 'p', protocol: 'OPENAI_RESPONSES', revision: 1,
        credential: 'synthetic', endpointUrl: 'http://fixture-model/v1',
    },
    model: { profileKey: 'm', modelId: 'fixture-model', contextWindowTokens: 8192, maxOutputTokens: 512 },
};
const held = {
    reservationId: '1', purpose: 'FOREGROUND_CHAT', status: 'HELD',
    reservedUsd: '1.000000', attemptId: 'attempt-1',
};
const settled = {
    reservationId: '1', purpose: 'FOREGROUND_CHAT', status: 'SETTLED',
    actualUsd: '0.003000', inputTokens: 1, outputTokens: 1, idempotent: false,
};

function request() {
    return {
        socket: new EventEmitter(),
        headers: { cookie: 'vc_session=synthetic' },
        user: { profile: { handle: 'fixture' } },
        body: {
            chat_completion_source: 'custom', custom_url: marker, model: 'fixture-model',
            max_tokens: 512, stream: false,
            messages: [{ role: 'user', content: '合成问题' }],
        },
    };
}

function response() {
    return {
        statusCode: 200, headers: {}, headersSent: false, body: '',
        setHeader(name, value) { this.headers[name] = value; },
        end(value) { this.body = value || ''; this.headersSent = true; },
    };
}

function bridge(t, fetchImpl, provider) {
    return createGenerateBridge({
        config: { goBaseUrl: 'http://fixture-go', serviceToken: 'synthetic', timeoutMs: 1000 },
        continuationStore: new ToolContinuationStore(),
        fetchImpl: async () => {
            provider.push(1);
            return fetchImpl();
        },
    });
}

function providerReply() {
    return Response.json({
        id: 'response-fixture',
        output: [{ type: 'message', content: [{ type: 'output_text', text: '合成回复' }] }],
        usage: { input_tokens: 1, output_tokens: 1 },
    });
}

test('计费门禁：只有契约 200 且 status=HELD 才放行，否则上游请求数为 0', async (t) => {
    const cases = [
        ['404', 404, { leak: 'sk-closed-404' }],
        ['500', 500, { leak: 'sk-closed-500' }],
        ['network', 'network', { leak: 'sk-closed-network' }],
        ['not-held', 200, {
            reservationId: '1', purpose: 'FOREGROUND_CHAT', status: 'RELEASED',
            reservedUsd: '1.000000', attemptId: 'attempt-1', leak: 'sk-closed-not-held',
        }],
    ];
    for (const [name, status, body] of cases) {
        await t.test(name, async (t) => {
            const provider = [];
            t.mock.method(globalThis, 'fetch', async (url) => {
                const path = String(url);
                if (path.endsWith('/auth/session')) return Response.json({ accountId: '7', sessionId: '11' });
                if (path.includes('/service/model-purposes/')) return Response.json(resolveBody);
                if (path.includes('/service/model-usage/reservations')) {
                    if (status === 'network') throw new TypeError(`fetch failed ${body.leak}`);
                    return new Response(JSON.stringify(body), {
                        status, headers: { 'content-type': 'application/json' },
                    });
                }
                assert.fail(`意外的 Go 请求：${path}`);
            });
            const res = response();
            await bridge(t, providerReply, provider).interceptGenerate(request(), res);
            const error = JSON.parse(res.body).error;
            assert.equal(provider.length, 0, name);
            assert.notEqual(res.statusCode, 200, name);
            assert.equal(error.code, 'VC_USAGE_CLOSED', name);
            assert.match(error.message, /未发送/, name);
            assert.equal(res.body.includes(body.leak), false, name);
            assert.equal(error.message.includes(body.leak), false, name);
        });
    }

    await t.test('held', async (t) => {
        const provider = [];
        t.mock.method(globalThis, 'fetch', async (url) => {
            const path = String(url);
            if (path.endsWith('/auth/session')) return Response.json({ accountId: '7', sessionId: '11' });
            if (path.includes('/service/model-purposes/')) return Response.json(resolveBody);
            if (path.endsWith('/reservations')) return Response.json(held);
            if (path.endsWith('/settle')) return Response.json(settled);
            assert.fail(`意外的 Go 请求：${path}`);
        });
        const res = response();
        await bridge(t, providerReply, provider).interceptGenerate(request(), res);
        assert.equal(res.statusCode, 200);
        assert.equal(provider.length, 1);
    });
});

test('预留超时按闭合原因拒绝，不当成上游模型超时，且不重试预留', async () => {
    const provider = [];
    let reserves = 0;
    const go = http.createServer((req, res) => {
        if (req.url.startsWith('/api/v1/auth/session')) {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ accountId: '7', sessionId: '11' }));
            return;
        }
        if (req.url.includes('/service/model-purposes/')) {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify(resolveBody));
            return;
        }
        if (req.url.includes('/service/model-usage/reservations')) {
            reserves += 1;
            return;
        }
        res.writeHead(500);
        res.end('{}');
    });
    await new Promise((resolve) => go.listen(0, '127.0.0.1', resolve));
    const port = go.address().port;
    try {
        const gate = createGenerateBridge({
            config: { goBaseUrl: `http://127.0.0.1:${port}`, serviceToken: 'synthetic', timeoutMs: 80 },
            continuationStore: new ToolContinuationStore(),
            fetchImpl: async () => { provider.push(1); return providerReply(); },
        });
        const res = response();
        await gate.interceptGenerate(request(), res);
        const error = JSON.parse(res.body).error;
        assert.equal(provider.length, 0);
        assert.equal(reserves, 1);
        assert.equal(error.code, 'VC_USAGE_CLOSED');
        assert.match(error.message, /超时/);
        assert.equal(error.message.includes('上游模型'), false);
    } finally {
        go.closeAllConnections();
        await new Promise((resolve) => go.close(resolve));
    }
});

test('结算失败有界重试后仍取消为 UNKNOWN，取消失败同样有界重试并只记录错误码', async (t) => {
    const provider = [];
    const settles = [];
    const cancels = [];
    const logs = [];
    t.mock.method(console, 'error', (...args) => { logs.push(args.map(String).join(' ')); });
    t.mock.method(globalThis, 'fetch', async (url, init) => {
        const path = String(url);
        if (path.endsWith('/auth/session')) return Response.json({ accountId: '7', sessionId: '11' });
        if (path.includes('/service/model-purposes/')) return Response.json(resolveBody);
        if (path.endsWith('/reservations')) return Response.json(held);
        if (path.endsWith('/settle')) {
            settles.push(JSON.parse(init.body));
            return new Response(JSON.stringify({ leak: 'sk-settle-secret' }), {
                status: 500, headers: { 'content-type': 'application/json' },
            });
        }
        if (path.endsWith('/cancel')) {
            cancels.push(JSON.parse(init.body));
            if (cancels.length < 3) {
                return new Response(JSON.stringify({ leak: 'sk-cancel-secret' }), {
                    status: 500, headers: { 'content-type': 'application/json' },
                });
            }
            return Response.json({
                reservationId: '1', purpose: 'FOREGROUND_CHAT', status: 'UNKNOWN',
                reservedUsd: '1.000000', actualUsd: null, idempotent: false,
            });
        }
        assert.fail(`意外的 Go 请求：${path}`);
    });
    const res = response();
    await bridge(t, providerReply, provider).interceptGenerate(request(), res);
    const logged = logs.join('\n');
    assert.equal(provider.length, 1);
    assert.equal(settles.length, 3);
    assert.equal(cancels.length, 3);
    assert.equal(cancels.every((row) => row.disposition === 'UNKNOWN'), true);
    assert.match(logged, /VC_USAGE_SETTLE_FAILED/);
    assert.equal(logged.includes('VC_USAGE_CANCEL_FAILED'), false);
    assert.equal(logged.includes('sk-settle-secret'), false);
    assert.equal(logged.includes('sk-cancel-secret'), false);
    assert.equal(res.body.includes('sk-settle-secret'), false);
    assert.equal(res.body.includes('sk-cancel-secret'), false);
});
