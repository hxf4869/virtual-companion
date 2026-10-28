import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { createGenerateBridge } from '../server-plugin/virtual-companion/lib/generate-bridge.js';
import { ToolContinuationStore } from '../server-plugin/virtual-companion/lib/responses-adapter.js';

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
