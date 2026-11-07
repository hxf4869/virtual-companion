import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createAdminBridge } from '../server-plugin/virtual-companion/lib/admin-bridge.js';

async function server(t, handler) {
    const host = http.createServer(handler);
    host.listen(0, '127.0.0.1'); await once(host, 'listening');
    t.after(async () => { host.closeAllConnections(); await new Promise(resolve => host.close(resolve)); });
    return `http://127.0.0.1:${host.address().port}`;
}

const id = '00000000-0000-4000-8000-000000000001';

test('public JSONL bridge streams multipart before request end and forwards only cookie authority', { timeout: 5000 }, async t => {
    let entered; const first = new Promise(resolve => { entered = resolve; });
    let seen;
    const go = await server(t, async (req, res) => {
        let body = '';
        req.once('data', entered);
        for await (const part of req) body += part.toString();
        seen = { headers: req.headers, body };
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(202); res.end('{"status":"PENDING"}');
    });
    const bridge = await server(t, createAdminBridge({ config: { goBaseUrl: go, timeoutMs: 1 } }));
    const req = http.request(bridge + '/api/v1/chats/imports', { method: 'POST', headers: {
        'Content-Type': 'multipart/form-data; boundary=synthetic',
        Cookie: 'vc_session=synthetic; vc_csrf=csrf; st_session=discard',
        Authorization: 'Bearer must-not-forward', Origin: 'https://vc.test',
        'X-VC-CSRF-Token': 'csrf', 'X-VC-Expected-Account-ID': '42', 'X-VC-Expected-Session-ID': '7',
    } });
    const done = new Promise((resolve, reject) => {
        req.once('error', reject); req.once('response', async res => {
            let text = ''; for await (const chunk of res) text += chunk;
            resolve({ status: res.statusCode, text });
        });
    });
    const head = '--synthetic\r\nContent-Disposition: form-data; name="file"; filename="unused.jsonl"\r\n\r\n';
    req.write(head + '{}\n');
    await first; // Waiting for request.end() here would prove buffering.
    req.end('--synthetic--\r\n');
    assert.deepEqual(await done, { status: 202, text: '{"status":"PENDING"}' });
    assert.equal(seen.body, head + '{}\n--synthetic--\r\n');
    assert.equal(seen.headers.cookie, 'vc_session=synthetic; vc_csrf=csrf');
    assert.equal(seen.headers.authorization, undefined);
    assert.equal(seen.headers['x-csrf-token'], 'csrf');
    assert.equal(seen.headers['x-vc-expected-account-id'], '42');
    assert.equal(seen.headers['x-vc-expected-session-id'], '7');
});

test('JSONL export proxy preserves exact bytes and response preconditions, with no ordinary short timeout', async t => {
    const text = '{"chat_metadata":{"vc_f2":{"id":"' + id + '","revision":7}},"huge":900719925474099312345}\n';
    const go = await server(t, async (req, res) => {
        assert.equal(req.url, `/api/v1/chats/${id}/export?revision=7`);
        assert.equal(req.headers.accept, 'application/x-ndjson');
        await new Promise(resolve => setTimeout(resolve, 10));
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Content-Length': Buffer.byteLength(text), 'X-Chat-Revision': '7', 'Content-Disposition': 'attachment; filename="chat.jsonl"' });
        res.end(text);
    });
    const bridge = await server(t, createAdminBridge({ config: { goBaseUrl: go, timeoutMs: 1 } }));
    const response = await fetch(`${bridge}/api/v1/chats/${id}/export?revision=7`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-chat-revision'), '7');
    assert.equal(response.headers.get('content-length'), String(Buffer.byteLength(text)));
    assert.equal(response.headers.get('content-disposition'), 'attachment; filename="chat.jsonl"');
    assert.equal(await response.text(), text);
});

test('disconnecting a streamed export cancels its upstream delivery rather than completing in the background', { timeout: 5000 }, async t => {
    let cancelled; const stopped = new Promise(resolve => { cancelled = resolve; });
    const go = await server(t, (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Content-Length': '999999' });
        res.write('{}\n');
        res.once('close', cancelled);
    });
    const bridge = await server(t, createAdminBridge({ config: { goBaseUrl: go, timeoutMs: 1 } }));
    const req = http.get(`${bridge}/api/v1/chats/${id}/export`);
    const [res] = await once(req, 'response');
    await once(res, 'data');
    res.destroy(); req.destroy();
    await stopped;
});

test('public transfer whitelist never exposes service native endpoints and rejects oversized envelopes', async t => {
    let calls = 0;
    const bridge = await server(t, createAdminBridge({ config: { goBaseUrl: 'http://synthetic.invalid', timeoutMs: 1 }, fetchImpl: () => { calls++; throw new Error('must not call'); } }));
    const forbidden = await fetch(bridge + '/api/v1/service/chats/native/list', { method: 'POST' });
    assert.equal(forbidden.status, 404);
    const req = http.request(bridge + '/api/v1/chats/imports', { method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=synthetic', 'Content-Length': String(264*1024*1024+1), Connection: 'close' } });
    req.end(); const [res] = await once(req, 'response');
    assert.equal(res.statusCode, 413); res.resume(); await once(res, 'end');
    assert.equal(calls, 0);
});

test('export failure before response bytes removes stale success length and returns a typed unavailable response', async t => {
    const bridge = await server(t, createAdminBridge({ config: { goBaseUrl: 'http://synthetic.invalid', timeoutMs: 1 }, fetchImpl: async () => new Response(new ReadableStream({
        start(controller) { controller.error(new Error('synthetic upstream body failure')); },
    }), { headers: { 'Content-Length': '999999', 'X-Chat-Revision': '7', 'Content-Type': 'application/x-ndjson' } }) }));
    const response = await fetch(`${bridge}/api/v1/chats/${id}/export`);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('x-chat-revision'), null);
    assert.equal((await response.json()).code, 'SCHEMA_UNAVAILABLE');
});
