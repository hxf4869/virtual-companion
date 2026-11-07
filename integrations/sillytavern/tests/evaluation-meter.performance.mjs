// Run after the parallel offline suite: durable-journal latency requires an
// otherwise idle test process. Both npm test and check.sh include this file.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRoundBudget } from '../../../scripts/lib/chat-memory-budget.mjs';
import { startEvaluationMeter } from '../scripts/lib/real-model-meter.mjs';

const TEST_MESSAGE = 'fixture-only body';
const UPSTREAM_CREDENTIAL = 'fixture-only-upstream-credential';
const MODEL = 'fixture-model';
const USAGE = { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18, prompt_tokens_details: { cached_tokens: 3 } };
const RESPONSE = { choices: [{ message: { content: 'fixture reply' } }], usage: { ...USAGE, cost: 0.7 } };
const PRICED_PROFILE = {
    modelId: MODEL, protocol: 'OPENAI_CHAT_COMPLETIONS', contextWindowTokens: 1000, maxOutputTokens: 100,
    billableOutputCapIncludesReasoning: true,
    pricing: { currency: 'CNY', inputPerMillionTokens: '1', outputPerMillionTokens: '2', verifiedOn: '2026-11-07', otherFeesBounded: true },
};
const REQUEST = { model: MODEL, max_tokens: 16, messages: [{ role: 'user', content: TEST_MESSAGE }] };

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

function budgetStub({ maxCalls = Infinity, deny = null, persist = null, settleError = null } = {}) {
    const entries = [];
    return {
        async reserve({ route, outputCap }) {
            if (deny) throw new Error(deny);
            if (entries.length >= maxCalls) throw new Error('BUDGET_STOP');
            const id = entries.length + 1;
            const entry = { id, route, outputCap, state: 'PERSISTING' };
            entries.push(entry);
            await persist?.promise;
            entry.state = 'RESERVED';
            return { id };
        },
        async settle(id, usage) {
            assert.equal(entries[id - 1].state, 'RESERVED');
            if (settleError) throw new Error(settleError);
            Object.assign(entries[id - 1], usage, { state: 'SETTLED' });
        },
        async unknown(id, reason) {
            assert.equal(entries[id - 1].state, 'RESERVED');
            Object.assign(entries[id - 1], { state: 'UNKNOWN', reason });
        },
        async notSent(id) {
            assert.equal(entries[id - 1].state, 'RESERVED');
            entries[id - 1].state = 'NOT_SENT';
        },
        snapshot: () => entries.map((entry) => ({ ...entry })),
    };
}

async function pricedBudget(t) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-evaluation-meter-'));
    let budget;
    t.after(async () => {
        try { await budget?.close(); }
        finally { await fs.rm(dir, { recursive: true, force: true }); }
    });
    budget = await createRoundBudget({
        file: path.join(dir, 'budget.json'), round: 'round-evaluation-meter',
        profiles: [PRICED_PROFILE], capMicroCny: 100_000_000, maxCalls: 100,
    });
    return budget;
}

async function listen(t, handler) {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(async () => {
        const closed = new Promise((done) => server.close(done));
        server.closeAllConnections();
        await closed;
    });
    return `http://127.0.0.1:${server.address().port}`;
}

function routeFor(origin, extra) {
    return {
        baseUrl: `${origin}/private-fixture-prefix/v1`, credential: UPSTREAM_CREDENTIAL, modelId: MODEL,
        protocol: 'OPENAI_CHAT_COMPLETIONS', contextWindowTokens: 1_000_000, maxOutputTokens: 393_216,
        ...extra,
    };
}

async function setup(t, { handler, budget = budgetStub(), options, secondRoute, profile } = {}) {
    const seen = [];
    const origin = await listen(t, async (req, res) => {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks));
        seen.push({ url: req.url, authorization: req.headers.authorization, body });
        if (handler) return handler(req, res, body);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(RESPONSE));
    });
    const routes = [routeFor(origin, profile)];
    if (secondRoute) routes.push(routeFor(origin, { baseUrl: origin + '/judge', ...secondRoute }));
    const meter = await startEvaluationMeter({ routes, budget, ...options });
    t.after(() => meter.stop());
    return { meter, seen };
}

function send(route, overrides = {}, options = {}) {
    return fetch(options.url ?? `${route.baseUrl}/chat/completions`, {
        method: options.method ?? 'POST',
        headers: { authorization: `Bearer ${options.credential ?? route.credential}`, 'content-type': 'application/json' },
        body: options.method === 'GET' ? undefined : JSON.stringify({ ...REQUEST, ...overrides }),
        redirect: 'manual',
        signal: options.signal,
    });
}

const event = (value) => `data: ${JSON.stringify(value)}\r\n\r\n`;
const done = 'data: [DONE]\r\n\r\n';

test('meter locks each destination and meters initial chat, tool continuation, rewrite, and judge', async (t) => {
    const outbound = [];
    const { meter, seen } = await setup(t, {
        options: { onOutbound: (entry) => outbound.push(entry) },
        secondRoute: { modelId: 'fixture-judge-model' },
    });
    const [chat, judge] = meter.routes;
    assert.equal(new URL(chat.baseUrl).hostname, '127.0.0.1');
    assert.equal(chat.baseUrl.includes('private-fixture-prefix'), false);
    assert.notEqual(chat.credential, UPSTREAM_CREDENTIAL);
    assert.notEqual(chat.credential, judge.credential);
    const invalid = [
        send(judge, { model: 'fixture-judge-model' }, { credential: chat.credential }),
        send(chat, {}, { credential: UPSTREAM_CREDENTIAL }),
        send(chat, { model: 'other-model' }),
        send(chat, { max_tokens: undefined }),
        send(chat, { max_tokens: 393_217 }),
        send(chat, { max_completion_tokens: 8 }),
        send(chat, { n: 2 }),
        send(chat, { base_url: 'https://fixture.invalid' }),
        send(chat, { tools: [{ type: 'web_search' }] }),
        send(chat, { messages: [{ role: 'user', content: [{ type: 'image_url', image_url: {} }] }] }),
        send(chat, {}, { url: `${chat.baseUrl}/chat/completions?target=https://fixture.invalid` }),
        send(chat, {}, { url: `${chat.baseUrl}/models` }),
        send(chat, {}, { method: 'GET' }),
    ];
    assert.deepEqual((await Promise.all(invalid)).map((r) => r.status), [401, 401, 400, 400, 400, 400, 400, 400, 400, 400, 404, 404, 405]);
    assert.equal(seen.length, 0);
    assert.deepEqual(meter.snapshot().budget, []);

    const toolMessages = [...REQUEST.messages,
        { role: 'assistant', tool_calls: [{ id: 'fixture-call', type: 'function', function: { name: 'lookup', arguments: '{}' } }] },
        { role: 'tool', tool_call_id: 'fixture-call', content: 'fixture result' },
    ];
    for (const response of await Promise.all([
        send(chat), send(chat, { messages: toolMessages }),
        send(chat, { max_tokens: undefined, max_completion_tokens: 12 }),
        send(judge, { model: 'fixture-judge-model' }),
    ])) {
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), RESPONSE);
    }
    assert.equal(seen.length, 4);
    assert.deepEqual(seen.map((call) => call.url).sort(), [
        '/judge/v1/chat/completions', ...Array(3).fill('/private-fixture-prefix/v1/chat/completions'),
    ]);
    assert.ok(seen.every((call) => call.authorization === `Bearer ${UPSTREAM_CREDENTIAL}`));
    assert.equal(outbound.length, 4);
    assert.deepEqual(outbound.map(entry => entry.id).sort((a, b) => a - b), [1, 2, 3, 4]);
    assert.ok(outbound.some((entry) => entry.body.messages.length === 3));
    const snapshot = meter.snapshot();
    assert.equal(snapshot.calls.length, 4);
    assert.equal(snapshot.budget.length, 4);
    assert.ok(snapshot.calls.every((entry) => entry.state === 'SETTLED'));
    assert.ok(snapshot.budget.every((entry) => entry.state === 'SETTLED' && entry.inputTokens === 11
        && entry.outputTokens === 7 && entry.cachedInputTokens === 3 && !('cost' in entry)));
    assert.ok(snapshot.calls.every((entry) => entry.firstByteMs <= entry.firstBodyMs && entry.lastBodyMs <= entry.endMs));
    const serialized = JSON.stringify(snapshot);
    for (const privateValue of [TEST_MESSAGE, UPSTREAM_CREDENTIAL, chat.credential, 'private-fixture-prefix', 'fixture-model', 'fixture reply']) {
        assert.equal(serialized.includes(privateValue), false);
    }
});

test('concurrent requests wait for durable reserve and refusals send zero packets', { timeout: 3000 }, async (t) => {
    const gate = deferred();
    const budget = budgetStub({ maxCalls: 1, persist: gate });
    const { meter, seen } = await setup(t, { budget });
    const first = send(meter.routes[0]);
    try {
        while (budget.snapshot().length === 0) await new Promise(setImmediate);
        const rejected = await Promise.all(Array.from({ length: 8 }, () => send(meter.routes[0])));
        for (const response of rejected) {
            assert.equal(response.status, 429);
            assert.deepEqual(await response.json(), { error: 'BUDGET_STOP' });
        }
        assert.equal(seen.length, 0);
    } finally {
        gate.resolve();
    }
    assert.equal((await first).status, 200);
    assert.equal(seen.length, 1);

    const denied = await setup(t, { budget: budgetStub({ deny: 'CONFIG_NOT_READY' }) });
    const noPrice = await send(denied.meter.routes[0]);
    assert.equal(noPrice.status, 503);
    assert.deepEqual(await noPrice.json(), { error: 'CONFIG_NOT_READY' });
    assert.equal(denied.seen.length, 0);
});

test('stream forwards the first reasoning and text before usage or upstream completion', { timeout: 3000 }, async (t) => {
    const afterReasoning = deferred();
    const afterText = deferred();
    const reasoning = Buffer.from(event({ choices: [{ delta: { reasoning_content: '推理' } }] }));
    const text = event({ choices: [{ delta: { content: '正文' } }] });
    const finalText = event({ choices: [{ delta: { content: '结尾' } }] });
    const tail = finalText + event({ usage: USAGE }) + done;
    const { meter, seen } = await setup(t, {
        handler: async (_req, res) => {
            res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
            const splitAt = reasoning.indexOf(Buffer.from('推')) + 1;
            res.write(reasoning.subarray(0, splitAt));
            await afterReasoning.promise;
            res.write(reasoning.subarray(splitAt));
            res.write(text);
            await afterText.promise;
            res.end(tail);
        },
    });
    t.after(() => { afterReasoning.resolve(); afterText.resolve(); });
    try {
        const response = await send(meter.routes[0], { stream: true, stream_options: { include_usage: false } });
        const reader = response.body.getReader();
        let received = Buffer.from((await reader.read()).value);
        assert.ok(received.length < reasoning.length);
        assert.equal(meter.snapshot().calls[0].state, 'RESERVED');
        afterReasoning.resolve();
        while (!received.includes(text)) received = Buffer.concat([received, Buffer.from((await reader.read()).value)]);
        assert.equal(received.toString(), reasoning.toString() + text);
        const live = meter.snapshot().calls[0];
        assert.ok(live.firstByteMs <= live.firstReasoningMs && live.firstReasoningMs <= live.firstBodyMs);
        assert.equal(live.lastBodyMs, live.firstBodyMs);
        assert.equal(live.endMs, null);
        afterText.resolve();
        for (let part = await reader.read(); !part.done; part = await reader.read()) {
            received = Buffer.concat([received, Buffer.from(part.value)]);
        }
        assert.equal(received.toString(), reasoning.toString() + text + tail);
        assert.equal(seen[0].body.stream_options.include_usage, true);
        const settled = meter.snapshot().calls[0];
        assert.equal(settled.state, 'SETTLED');
        assert.ok(settled.lastBodyMs > settled.firstBodyMs && settled.lastBodyMs <= settled.endMs);
    } finally {
        afterReasoning.resolve();
        afterText.resolve();
    }
});

test('missing, malformed, unclosed stream usage and settlement failures keep UNKNOWN', async (t) => {
    const cases = [
        { payload: done, reason: 'MISSING_USAGE' },
        { payload: event({ usage: { ...USAGE, total_tokens: 17 } }) + done, reason: 'MISSING_USAGE' },
        { payload: event({ usage: USAGE }), reason: 'MISSING_USAGE' },
        { payload: event({ choices: [{ delta: { content: 'x'.repeat(1024 * 1024) } }] }) + event({ usage: USAGE }) + done, reason: 'MISSING_USAGE' },
        { payload: event({ usage: USAGE }) + done, settleError: 'private settlement error', reason: 'SETTLEMENT_FAILED' },
    ];
    for (const { payload, settleError, reason } of cases) {
        const { meter } = await setup(t, {
            budget: budgetStub({ settleError }),
            handler: (_req, res) => {
                res.writeHead(200, { 'content-type': 'text/event-stream' });
                res.end(payload);
            },
        });
        const response = await send(meter.routes[0], { stream: true });
        if (settleError) await assert.rejects(response.text());
        else assert.equal(await response.text(), payload);
        assert.equal(meter.snapshot().budget[0].state, 'UNKNOWN');
        assert.equal(meter.snapshot().calls[0].reason, reason);
    }
});

test('meter preserves an earlier UNKNOWN when the real journal refuses a transition', async (t) => {
    const budget = await pricedBudget(t);
    const { meter, seen } = await setup(t, {
        budget,
        profile: PRICED_PROFILE,
        options: {
            async onOutbound({ body }) {
                assert.equal(await budget.unknown(budget.snapshot().calls, 'OTHER'), true);
                if (body.seed === 2) throw new Error('fixture inspection rejection');
            },
        },
        handler: (_req, res, body) => {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify(body.seed === 3 ? {} : RESPONSE));
        },
    });
    for (const seed of [1, 2, 3]) {
        const response = await send(meter.routes[0], { seed });
        assert.equal(response.status, seed === 2 ? 502 : 200);
        await response.text();
    }
    assert.equal(seen.length, 2);
    const snapshot = meter.snapshot();
    assert.deepEqual(snapshot.calls.map(({ state, reason }) => [state, reason]), [
        ['UNKNOWN', 'SETTLEMENT_FAILED'], ['UNKNOWN', 'SETTLEMENT_FAILED'], ['UNKNOWN', 'SETTLEMENT_FAILED'],
    ]);
    assert.equal(snapshot.budget.unknown, 3);
    assert.equal(snapshot.budget.settled, 0);
    assert.equal(snapshot.budget.notSent, 0);
    assert.equal(snapshot.budget.committedMicroCny, 3 * (1000 + 16 * 2));
});

test('journal write failure keeps the prior reservation and closes new admissions', async (t) => {
    const budget = budgetStub();
    let attempts = 0;
    budget.unknown = async () => { attempts++; throw new Error('BUDGET_JOURNAL_FAILED'); };
    const { meter, seen } = await setup(t, {
        budget,
        handler: (_req, res) => {
            res.writeHead(200, { 'content-type': 'text/event-stream' });
            res.end(done);
        },
    });
    const response = await send(meter.routes[0], { stream: true });
    await assert.rejects(response.text());
    assert.equal(meter.snapshot().calls[0].state, 'UNKNOWN');
    assert.equal(meter.snapshot().budget[0].state, 'RESERVED');
    const rejected = await send(meter.routes[0]);
    assert.equal(rejected.status, 503);
    assert.deepEqual(await rejected.json(), { error: 'METER_UNAVAILABLE' });
    assert.equal(attempts, 1);
    assert.equal(seen.length, 1);
});

test('redirect, timeout, and upstream disconnect stay UNKNOWN', async (t) => {
    let redirected = 0;
    const redirectTo = await listen(t, (_req, res) => { redirected++; res.end(); });
    const cases = [
        { handler: (_req, res) => res.writeHead(307, { location: redirectTo }).end(), reason: 'HTTP_ERROR', status: 502 },
        { handler: () => {}, reason: 'TIMEOUT', status: 504, options: { upstreamTimeoutMs: 80 } },
        {
            handler: (_req, res) => {
                res.writeHead(200, { 'content-type': 'text/event-stream' });
                res.write(event({ choices: [{ delta: { content: 'x' } }] }));
                setTimeout(() => res.destroy(), 30);
            },
            reason: 'TRANSPORT', status: 200,
        },
    ];
    for (const { handler, reason, status, options } of cases) {
        const { meter } = await setup(t, { handler, options });
        const response = await send(meter.routes[0], { stream: true });
        assert.equal(response.status, status);
        if (status === 200) await assert.rejects(response.text());
        else await response.text();
        assert.equal(meter.snapshot().calls[0].reason, reason);
        assert.equal(meter.snapshot().budget[0].state, 'UNKNOWN');
    }
    assert.equal(redirected, 0);
});

test('cancellation before sending releases its hold and stopping in flight keeps UNKNOWN', { timeout: 3000 }, async (t) => {
    const budget = budgetStub();
    const { meter, seen } = await setup(t, {
        budget, options: { onOutbound: () => { throw new Error('fixture-only details'); } },
    });
    const rejected = await send(meter.routes[0]);
    assert.equal(rejected.status, 502);
    assert.equal(budget.snapshot()[0].state, 'NOT_SENT');
    assert.equal(seen.length, 0);

    const running = await setup(t, {
        handler: (_req, res) => res.writeHead(200, { 'content-type': 'text/event-stream' }).write(event({ choices: [] })),
    });
    const response = await send(running.meter.routes[0], { stream: true });
    await running.meter.stop();
    await assert.rejects(response.text());
    assert.equal(running.meter.snapshot().budget[0].state, 'UNKNOWN');
    assert.equal(running.meter.snapshot().calls[0].reason, 'CLOSED');

    const upstreamClosed = deferred();
    const cancelled = await setup(t, {
        handler: (_req, res) => {
            res.once('close', upstreamClosed.resolve);
            res.writeHead(200, { 'content-type': 'text/event-stream' }).write(event({ choices: [] }));
        },
    });
    const client = new AbortController();
    const clientResponse = await send(cancelled.meter.routes[0], { stream: true }, { signal: client.signal });
    client.abort();
    await assert.rejects(clientResponse.text());
    await upstreamClosed.promise;
    await cancelled.meter.stop();
    assert.equal(cancelled.meter.snapshot().calls[0].reason, 'ABORTED');
});

test('protocols outside the audited chat endpoint fail closed', async () => {
    for (const protocol of ['OPENAI_RESPONSES', 'ANTHROPIC_MESSAGES', 'unknown']) {
        await assert.rejects(startEvaluationMeter({
            routes: [routeFor('https://fixture.invalid', { protocol })], budget: budgetStub(),
        }), { message: 'METER_UNSUPPORTED_PROTOCOL' });
    }
});

test('token anomaly at final stream usage aborts in-flight requests without waiting for upstream EOF', { timeout: 3000 }, async t => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-meter-token-'));
    const recipe = { fixture: 'concurrent-token-stop' };
    const budget = await createRoundBudget({ file: path.join(dir, 'budget.json'), round: 'round-token-stop',
        profiles: [PRICED_PROFILE], mode: 'tokens', ownerTokenOnly: true, recipe,
        tokenReference: { schemaVersion: 1,
            source: { round: 'round-reference', attempt: 1, firstCallId: 1, lastCallId: 1, flowComplete: true },
            recipe, profiles: [PRICED_PROFILE], usage: { inputTokens: 4, outputTokens: 4, settledCalls: 1, unknownCalls: 0 } } });
    t.after(async () => { await budget.close(); await fs.rm(dir, { recursive: true, force: true }); });
    const { meter, seen } = await setup(t, { budget, profile: PRICED_PROFILE,
        handler: (_req, res, body) => {
            if (body.seed === 99) res.writeHead(200, { 'content-type': 'text/event-stream' }).write(event({ choices: [] }));
            else res.writeHead(200, { 'content-type': 'text/event-stream' }).write(event({ usage: USAGE }) + done);
        } });
    const waiting = await send(meter.routes[0], { stream: true, seed: 99 });
    const cancelled = assert.rejects(waiting.text());
    const response = await send(meter.routes[0]);
    await response.text();
    await cancelled;
    assert.equal(budget.signal.aborted, true);
    const denied = await send(meter.routes[0]);
    assert.equal(denied.status, 429);
    assert.deepEqual(await denied.json(), { error: 'BUDGET_TOKEN_ANOMALY' });
    await meter.stop();
    assert.equal(seen.length, 2);
    assert.equal(budget.snapshot().settled, 1);
    assert.equal(budget.snapshot().unknown, 1);
    assert.equal(meter.snapshot().calls[0].reason, 'TOKEN_ANOMALY');
    assert.equal(meter.snapshot().calls[1].state, 'SETTLED');
    assert.deepEqual(budget.callRecords().map(({ id, state }) => [id, state]), [[1, 'UNKNOWN'], [2, 'SETTLED']]);
    assert.equal(await budget.notSent(1), false);
    assert.equal(await budget.unknown(2, 'TOKEN_ANOMALY'), false);
    assert.equal(await budget.notSent(2), false);
    assert.equal(budget.snapshot().tokenUsage.knownTokens, 18);
    assert.equal(budget.snapshot().notSent, 0);
});

test('local streaming first-chunk overhead p95 is at most 20 ms', { timeout: 8000 }, async (t) => {
    let firstWrite = 0;
    const first = event({ choices: [{ delta: { content: 'fixture' } }] });
    const tail = event({ usage: USAGE }) + done;
    const origin = await listen(t, (req, res) => {
        req.resume();
        req.once('end', () => {
            res.writeHead(200, { 'content-type': 'text/event-stream' });
            firstWrite = performance.now();
            res.write(first);
            setImmediate(() => res.end(tail));
        });
    });
    const budget = await pricedBudget(t);
    const meter = await startEvaluationMeter({ routes: [routeFor(origin, PRICED_PROFILE)], budget });
    t.after(() => meter.stop());
    const direct = { baseUrl: routeFor(origin).baseUrl, credential: UPSTREAM_CREDENTIAL };
    const proxied = meter.routes[0];
    const measure = async (route) => {
        const started = performance.now();
        const response = await send(route, { stream: true });
        const reader = response.body.getReader();
        const firstChunk = await reader.read();
        const received = performance.now();
        assert.ok(Buffer.from(firstChunk.value).toString().startsWith(first));
        while (!(await reader.read()).done) { /* drain before next sample */ }
        return { forwarding: received - firstWrite, overall: received - started, complete: performance.now() - started };
    };
    for (let i = 0; i < 5; i++) {
        await measure(direct);
        await measure(proxied);
    }
    const forwarding = [];
    const overall = [];
    const complete = [];
    for (let i = 0; i < 60; i++) {
        const [baseline, candidate] = i % 2 === 0
            ? [await measure(direct), await measure(proxied)]
            : [await measure(proxied), await measure(direct)].reverse();
        forwarding.push(candidate.forwarding - baseline.forwarding);
        overall.push(candidate.overall - baseline.overall);
        complete.push(candidate.complete - baseline.complete);
    }
    const p95 = (added) => added.sort((a, b) => a - b)[Math.ceil(added.length * 0.95) - 1];
    const forwardingP95 = p95(forwarding);
    const overallP95 = p95(overall);
    const completeP95 = p95(complete);
    t.diagnostic(`paired streaming samples=60 with durable journal, forwarding p95=${forwardingP95.toFixed(3)} ms, first chunk overall p95=${overallP95.toFixed(3)} ms, complete p95=${completeP95.toFixed(3)} ms`);
    assert.equal(budget.snapshot().settled, 65);
    assert.equal(budget.snapshot().settledMicroCny, 65 * (11 + 7 * 2));
    assert.ok(forwardingP95 <= 20 && overallP95 <= 20);
});
