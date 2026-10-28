import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startMeter } from '../scripts/lib/real-model-meter.mjs';

function listen(handler) {
    const server = http.createServer(handler);
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve(server));
    });
}

test('meter keeps the upstream path and records only shape, tokens and cost', async () => {
    const seen = [];
    const secret = 'synthetic-body-must-not-be-stored';
    const upstream = await listen(async (req, res) => {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        seen.push({ url: req.url, body: Buffer.concat(chunks).toString('utf8') });
        if (req.url.endsWith('/fail')) {
            res.writeHead(500, { 'content-type': 'text/plain' });
            res.end(`failure ${secret}`);
            return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ success: true, data: { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: `前缀 {"text":"ok"} ${secret}`, reasoning_content: 'hidden' } }], usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18, cost: 0.125 } } }));
    });
    const address = upstream.address();
    const meter = await startMeter(`http://127.0.0.1:${address.port}/custom/v1`);
    try {
        assert.equal(new URL(meter.baseUrl).pathname, '/custom/v1');
        const ok = await fetch(`${meter.baseUrl}/chat/completions`, { method: 'POST', headers: { authorization: 'Bearer synthetic-token', 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: secret }] }) });
        assert.equal(ok.status, 200);
        const failed = await fetch(`${meter.baseUrl}/fail`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: secret }] }) });
        assert.equal(failed.status, 500);
        assert.deepEqual(seen.map((call) => call.url), ['/custom/v1/chat/completions', '/custom/v1/fail']);
        const snapshot = meter.snapshot();
        assert.equal(snapshot.length, 2);
        assert.deepEqual(snapshot[0], { status: 200, success: true, roles: ['user'], kind: 'embedded-json', chars: `前缀 {"text":"ok"} ${secret}`.length, keys: ['text'], leadingChars: 3, finish: 'stop', reasoningChars: 6, promptTokens: 11, completionTokens: 7, totalTokens: 18, cost: 0.125, wire: { contentType: 'application/json', envelope: true, outerObject: null, object: null, choices: 1, index: null, content: 'string', usageBalanced: true }, structure: { fieldNames: ['choices', 'usage'], outerFieldNames: ['data', 'success'], messageFields: ['content', 'reasoning_content', 'role'], choiceFields: ['finish_reason', 'message'], finishReason: 'stop', contentEmpty: false, reasoningEmpty: false, toolCalls: false, contentChars: `前缀 {"text":"ok"} ${secret}`.length, reasoningChars: 6, toolCallCount: 0, usageShapes: { prompt: 'int', completion: 'int', total: 'int' } } });
        assert.equal(snapshot[1].status, 500);
        assert.equal(snapshot[1].success, false);
        assert.equal(snapshot[1].kind, 'unparsed');
        assert.equal(JSON.stringify(snapshot).includes(secret), false);
        assert.equal(JSON.stringify(snapshot).includes('synthetic-token'), false);
        const capped = await startMeter(`http://127.0.0.1:${address.port}/custom/v1`, { maxCalls: 1 });
        try {
            const first = await fetch(`${capped.baseUrl}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: secret }] }) });
            const second = await fetch(`${capped.baseUrl}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: secret }] }) });
            assert.equal(first.status, 200);
            assert.equal(second.status, 429);
            assert.equal(capped.snapshot().length, 1);
            assert.equal(seen.filter((call) => call.url === '/custom/v1/chat/completions').length, 2);
        } finally {
            await capped.stop();
        }
    } finally {
        await meter.stop();
        await new Promise((resolve) => upstream.close(resolve));
    }
});

test('meter records an envelope success false without the response text', async () => {
    const secret = 'synthetic-envelope-body';
    const upstream = await listen(async (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ success: false, data: { choices: [{ message: { content: secret } }] } }));
    });
    const address = upstream.address();
    const meter = await startMeter(`http://127.0.0.1:${address.port}/v1`);
    try {
        const response = await fetch(`${meter.baseUrl}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
        assert.equal(response.status, 200);
        assert.equal(meter.snapshot()[0].success, false);
        assert.equal(JSON.stringify(meter.snapshot()).includes(secret), false);
    } finally {
        await meter.stop();
        await new Promise((resolve) => upstream.close(resolve));
    }
});

test('meter records response structure without tool arguments or decimal token text', async () => {
    const secret = 'tool-argument-must-not-be-stored';
    const upstream = await listen(async (req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(`{"object":"chat.completion","choices":[{"index":0,"finish_reason":"stop","message":{"role":"assistant","content":"","tool_calls":[{"id":"call","type":"function","function":{"name":"write","arguments":"${secret}"}}]}}],"usage":{"prompt_tokens":11.0,"completion_tokens":7,"total_tokens":18.0,"cost":1.5}}`);
    });
    const address = upstream.address();
    const meter = await startMeter(`http://127.0.0.1:${address.port}/v1`);
    try {
        const response = await fetch(`${meter.baseUrl}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
        assert.equal(response.status, 200);
        const call = meter.snapshot()[0];
        assert.equal(call.structure.toolCalls, true);
        assert.equal(call.structure.toolCallCount, 1);
        assert.equal(call.structure.contentEmpty, true);
        assert.equal(call.structure.finishReason, 'stop');
        assert.deepEqual(call.structure.usageShapes, { prompt: 'decimal', completion: 'int', total: 'decimal' });
        assert.equal(call.wire.usageBalanced, true);
        assert.equal(JSON.stringify(call).includes(secret), false);
    } finally {
        await meter.stop();
        await new Promise((resolve) => upstream.close(resolve));
    }
});
