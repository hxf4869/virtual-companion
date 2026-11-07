import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { factsInText, outboundMemoryText, readEvaluationResponse, evaluationQueryRows, diagnosticEvidence, assertDiagnosticControl, evaluateCoreOnStack, waitExtraction, createEvaluationReauthentication } from '../scripts/chat-memory-real-eval.mjs';
import { AI_FLAVOR_FIELDS, summarizeDiagnosticControls } from '../../../scripts/lib/chat-memory-scoring.mjs';
import { prepareSourceIdentities, sourceMessages } from '../server-plugin/virtual-companion/lib/source-identity.js';
import { getF2Store } from '../server-plugin/virtual-companion/lib/f2-store.js';
import { startEngineObservationProxy } from '../scripts/lib/chat-memory-engine-proxy.mjs';
import { generateChatMemoryDataset } from '../../../scripts/lib/chat-memory-dataset.mjs';
import { createRoundArtifacts } from '../../../scripts/lib/chat-memory-artifacts.mjs';
import { instrumentEvaluationBuild } from '../scripts/lib/chat-memory-observation-build.mjs';
import { createEvaluationStClient } from '../scripts/lib/chat-memory-isolated-stack.mjs';
import { refreshMemorySlot } from '../server-plugin/virtual-companion/lib/memory-guard.js';

test('evaluation reuses recent reauthentication within an account without exhausting the real attempt budget', async () => {
    let now = 0, calls = 0, otherCalls = 0;
    const ensure = createEvaluationReauthentication({ now: () => now });
    const admin = { reauth: async () => ({ status: ++calls <= 5 ? 200 : 429, json: { ok: true } }) };
    const other = { reauth: async () => { otherCalls++; return { status: 200, json: { ok: true } }; } };
    for (let i = 0; i < 12; i++) await ensure(admin, 'synthetic-password');
    assert.equal(calls, 1);
    await ensure(other, 'other-synthetic-password');
    assert.equal(otherCalls, 1);
    now = 5 * 60 * 1000;
    await ensure(admin, 'synthetic-password');
    assert.equal(calls, 2);
    let rejected = 0;
    const denied = { reauth: async () => { rejected++; return { status: 429, json: {} }; } };
    await assert.rejects(ensure(denied, 'synthetic-password'), /CM_HTTP_429/);
    await assert.rejects(ensure(denied, 'synthetic-password'), /CM_HTTP_429/);
    assert.equal(rejected, 2, 'a rejected authentication never creates a fresh proof');
});

test('terminal extraction failure does not hide an independently valid published profile', async () => {
    const jobs = [{ status: 'DEAD_LETTERED', published: 1, message_id: 'synthetic-message' }];
    const profile = { out_persona: '合成画像', out_scenes: [] };
    const local = { id: 'synthetic', mode: 'COMPANION', userCount: 1, finishedWriteAt: 1,
        account: { session: { accountId: '1' } }, relationshipId: '2', chats: [{ identity: 'synthetic-chat' }] };
    const measured = [];
    const result = await waitExtraction({ w08: { psql: query => JSON.stringify(query.includes('vc.work_item') ? jobs : profile) } }, 1,
        { timeoutMs: 1000, savedAt: new Map(), sourceMap: new Map([['synthetic-message', 'synthetic-turn-1']]),
            instances: new Map([['synthetic', local]]), measure: (...args) => measured.push(args) });
    assert.equal(result.jobs[0].status, 'DEAD_LETTERED');
    assert.equal(result.timedOut, false);
    assert.deepEqual(local.profile, profile);
    assert.equal(measured.filter(row => row[1] === 'profile_ready_ms').length, 1);
});

test('evaluation native generation forwards browser origin through final memory recheck', async () => {
    const baseUrl = 'http://127.0.0.1:18420';
    let checked = false;
    const client = createEvaluationStClient({ baseUrl,
        session: { accountId: '7', sessionId: '9', vcSession: 'synthetic-session', vcCsrf: 'synthetic-csrf' },
        fetchImpl: async (url, options) => {
            if (url.endsWith('/csrf-token')) return Response.json({ token: 'synthetic-st-csrf' });
            const request = { body: JSON.parse(options.body), headers: Object.fromEntries(new Headers(options.headers)) };
            await refreshMemorySlot({ config: { goBaseUrl: 'http://go.test', timeoutMs: 1000 }, request,
                response: { setHeader() {} }, finalBody: structuredClone(request.body), fetchImpl: async (_url, forwarded) => {
                    const headers = new Headers(forwarded.headers);
                    assert.equal(headers.get('origin'), baseUrl);
                    assert.equal(headers.get('x-csrf-token'), 'synthetic-csrf');
                    assert.equal(headers.get('x-vc-expected-account-id'), '7');
                    assert.equal(headers.get('x-vc-expected-session-id'), '9');
                    checked = true;
                    return Response.json({ status: 'skipped', block: '', memoryIds: [], summaryIds: [], sources: [] });
                } });
            return new Response('data: [DONE]\n\n');
        } });
    await client.generate({ stream: true, messages: [{ role: 'user', content: '合成查询' }],
        vc_memory: { chatIdentity: '00000000-0000-4000-8000-000000000001', revision: 1, enabled: true, budgetTokens: 128, block: '' } });
    assert.equal(checked, true);
});

test('evaluation query and antecedents remain readable and unsettled after native storage', async () => {
    const testCase = generateChatMemoryDataset().cases.find(row => row.recentMessages.length > 0);
    const rows = evaluationQueryRows(testCase, { identity: '00000000-0000-4000-8000-000000000001', mode: 'COMPANION', name: '合成角色' });
    prepareSourceIdentities(rows, { settled: false, sourceTimezone: 'Asia/Shanghai' });
    const source = sourceMessages(rows);
    assert.equal(source.length, testCase.recentMessages.length + 1);
    assert.equal(source.every(row => row.eligible && !row.settled), true);
    // applySTSourceSnapshot preserves text only for eligible sources. no_memory
    // therefore cannot be used to isolate evaluation query extraction.
    assert.equal(source.at(-1).eligible ? source.at(-1).text : '', testCase.query);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-cm-query-'));
    try {
        const store = getF2Store(root), file = path.join(root, 'chats/card/query.jsonl');
        const token = await store.save(file, rows, { expected: rows[0].chat_metadata.vc_f2 });
        await store.read(file);
        const snapshot = await store.sourceSnapshot(token.id);
        assert.equal(snapshot.messages.every(row => row.eligible && !row.settled), true);
        assert.equal(snapshot.messages.at(-1).text, testCase.query);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('outbound evidence checks only actual memory slots and matches subject plus value', () => {
    const data = generateChatMemoryDataset(), fact = data.facts.find(row => row.kind === 'durable');
    const text = `${fact.subject}：${fact.value}`;
    assert.deepEqual(factsInText(text, [fact]), [fact.factId]);
    assert.deepEqual(factsInText(fact.value, [fact]), []);
    const body = { messages: [{ role: 'system', content: `<vc-long-term-memory>${text}</vc-long-term-memory>` }, { role: 'user', content: '这句不属于记忆槽' }] };
    assert.equal(outboundMemoryText(body).includes('这句'), false);
    assert.deepEqual(factsInText(outboundMemoryText(body), [fact]), [fact.factId]);
    assert.deepEqual(factsInText('记忆：目标甲的日期是2026-11-01。\n记忆：目标乙的日期是2026-11-02。',
        [{ ...fact, subject: '目标甲', value: '2026-11-02', valueAliases: [] }]), []);
    assert.deepEqual(factsInText('目标甲的日期是2026-11-01并且目标乙的日期是2026-11-02', [
        { ...fact, subject: '目标甲', value: '2026-11-02', valueAliases: [] },
        { ...fact, factId: 'other', subject: '目标乙', value: '2026-11-02', valueAliases: [] },
    ]), []);
});

test('gold diagnostic exposes only allowed evidence and controls keep their own planned denominator', () => {
    const dataset = generateChatMemoryDataset(), selected = dataset.cases.filter((_row, index) => index % 20 === 0);
    assert.equal(new Set(selected.map(row => row.category)).size, 7);
    for (const testCase of selected) {
        const evidence = diagnosticEvidence(testCase, dataset.facts);
        if (!testCase.goldFactIds.length) assert.equal(evidence, '');
        else {
            const parsed = JSON.parse(evidence.split('\n')[2]);
            assert.equal(parsed.length, testCase.goldFactIds.length);
            assert.ok(parsed.every(row => dataset.facts.some(fact => testCase.goldFactIds.includes(fact.factId)
                && row.subject === fact.subject && row.value === fact.value)));
        }
        for (const forbidden of testCase.forbiddenTerms) assert.equal(evidence.includes(forbidden), false);
    }
    const testCase = selected[0], results = [{ caseId: testCase.id, status: 'COMPLETED', rule: { passed: true },
        judge: { correct: true, grounded: true, abstains: false } }];
    const summary = summarizeDiagnosticControls(selected, results);
    assert.equal(summary.planned, 7); assert.equal(summary.coverage.numerator, 1);
    assert.equal(summary.accuracy.denominator, 7); assert.equal(summary.accuracy.numerator, 1);
});

test('diagnostic controls accept empty observed memory and still require actual gold injection', () => {
    const dataset = generateChatMemoryDataset(), testCase = dataset.cases[0];
    const goldEvidence = diagnosticEvidence(testCase, dataset.facts);
    assert.ok(goldEvidence);
    // The observer inserts a separator even when the final body has no slot.
    const memoryText = '\n' + outboundMemoryText({ messages: [{ role: 'user', content: testCase.query }] });
    for (const control of ['memory-off', 'gold-evidence']) {
        assert.doesNotThrow(() => assertDiagnosticControl({ control, memoryText,
            goldEvidence: control === 'gold-evidence' ? goldEvidence : '', goldEvidenceObserved: true }));
        assert.throws(() => assertDiagnosticControl({ control,
            memoryText: outboundMemoryText({ messages: [{ role: 'system', content: '<vc-core-memory>真实非空记忆</vc-core-memory>' }] }) }),
        { message: 'CM_CONTROL_MEMORY_PRESENT' });
    }
    assert.throws(() => assertDiagnosticControl({ control: 'gold-evidence', memoryText, goldEvidence, goldEvidenceObserved: false }),
        { message: 'CM_CONTROL_GOLD_MISSING' });
});

test('diagnostics-only uses the real observer/ask/judge for 14 fixed controls without replaying sources or core', async () => {
    const dataset = generateChatMemoryDataset(), calls = [], queries = [], reviews = [], checkpoints = [];
    let observer, bindings = 0, memories = 0, omitGold = false;
    const ok = json => ({ status: 200, json });
    const admin = {
        reauth: async () => ok({}), saveProvider: async () => ok({}), savePurpose: async () => ok({}),
        listPurposes: async () => ok(['FOREGROUND_CHAT', 'MEMORY_EXTRACTION_DEDUP_SUMMARY'].map(purpose => ({ purpose, revision: 1 }))),
        listProviders: async () => ok(['extraction', 'foreground', 'judge'].map(name => ({ providerId: `cm-${name}`, revision: 1 }))),
        async call(method, route, body) {
            if (route === '/api/v1/admin/embedding-config') return ok({ revision: 1 });
            if (method === 'POST' && route === '/api/v1/st/bindings') {
                if (!body.relationshipId) bindings++;
                return ok({ relationshipId: '2', conversationId: '3', mode: body.mode });
            }
            if (method === 'POST' && route === '/api/v1/st/memory/recall') {
                assert.equal(body.enabled, false);
                return ok({ status: 'disabled', block: '', memoryIds: [] });
            }
            if (method === 'GET' && route.startsWith('/api/v1/relationships/2/memories?')) { memories++; return ok([]); }
            assert.fail(`unexpected admin operation: ${method} ${route}`);
        },
    };
    const generate = route => async body => {
        if (route === 1 && body.vc_memory) {
            assert.equal(body.vc_memory.enabled, false);
            queries.push(body);
        }
        if (route === 2) reviews.push(body);
        const id = calls.length + 1;
        calls.push({ id, state: 'SETTLED' });
        const observed = omitGold ? { ...body, messages: body.messages.filter(message => !message.content.includes('<cm-diagnostic-evidence>')) } : body;
        await observer({ route, id, body: observed });
        const answer = route === 2 ? JSON.stringify({ correct: true, grounded: true, abstains: false, reasonCode: 'OK',
            aiFlavor: Object.fromEntries(AI_FLAVOR_FIELDS.map(key => [key, false])) }) : '合成回答';
        return { res: new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: answer } }] })}\n\ndata: [DONE]\n\n`) };
    };
    const st = { generate: generate(1), async call(method, route, body) {
        if (route === '/api/characters/import') return ok({ file_name: 'synthetic-card' });
        if (route === '/api/chats/save') {
            assert.match(body.file_name, /^cm-q-\d+-(?:memory-off|gold-evidence)$/);
            assert.ok(body.chat.slice(1).every(row => row.extra.vc_source.settled === false));
            return ok({ vc_f2: body.chat[0].chat_metadata.vc_f2 });
        }
        assert.fail(`unexpected ST operation: ${method} ${route}`);
    } };
    const ctx = { admin, st, secrets: { password: 'synthetic', session: { accountId: '1' } }, second: {},
        judge: { st: { generate: generate(2) } }, meterBase: 'http://meter.test', scope: 'round-fixture',
        embeddingModel: { name: 'synthetic', digest: 'synthetic' },
        setOutboundObserver: value => { observer = value; },
        readEngineObservations: async () => ({ sequence: 0, searches: [], incomplete: false }),
        w08: { psql: sql => { assert.match(sql, /FROM vc\.memory_item/); return '[]'; } },
    };
    const roles = ['extraction', 'foreground', 'judge'].map(name => ({ name, profile: {
        modelId: 'synthetic', protocol: 'OPENAI_CHAT_COMPLETIONS', maxOutputTokens: 128, contextWindowTokens: 2048 } }));
    const options = { dataset, roles, modelRoutes: roles.map((_role, at) => ({ baseUrl: `http://meter.test/${at}`, credential: 'synthetic' })),
        meter: { snapshot: () => ({ calls }) }, budget: { snapshot: () => ({ calls: calls.length }) }, diagnosticsOnly: true,
        checkpoint: async partial => checkpoints.push(partial) };
    const result = await evaluateCoreOnStack(ctx, options);
    assert.equal(queries.length, 14);
    assert.equal(reviews.length, 14, 'controls have one review and never inherit core double reviews');
    assert.equal(calls.length, 29, 'only one provider probe plus 14 answers and 14 judges');
    assert.equal(bindings, 1); assert.equal(memories, 14);
    assert.deepEqual(Object.keys(result).sort(), ['diagnosticControls', 'modelCalls']);
    for (const control of ['memory-off', 'gold-evidence']) {
        assert.deepEqual(result.diagnosticControls[control].results.map(row => row.caseId),
            dataset.cases.filter((_row, at) => at % 20 === 0).map(row => row.id));
        assert.equal(result.diagnosticControls[control].planned, 7);
        assert.equal(result.diagnosticControls[control].coverage.value, 1);
    }
    assert.ok(checkpoints.every(row => ['diagnostic-control', 'judge'].includes(row.phase) && !row.results));
    // Dropping evidence at the final wire must still reject the affected gold
    // controls even though the evaluator put evidence into its initial body.
    omitGold = true;
    const missing = await evaluateCoreOnStack(ctx, options);
    assert.equal(missing.diagnosticControls['memory-off'].coverage.value, 1);
    const goldRows = missing.diagnosticControls['gold-evidence'].results;
    assert.ok(goldRows.some(row => row.failureCode === 'CM_CONTROL_GOLD_MISSING'));
    for (const row of goldRows) {
        const testCase = dataset.cases.find(testCase => testCase.id === row.caseId);
        assert.equal(row.status, testCase.goldFactIds.length ? 'FAILED' : 'COMPLETED');
    }
});

test('rank instrumentation changes only the disposable copy and observes before budget clipping', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-cm-observe-'));
    try {
        const goPath = 'backend/internal/store/postgres/st_memory.go';
        const nodePath = 'integrations/sillytavern/server-plugin/virtual-companion/lib/memory-guard.js';
        const repository = new URL('../../../', import.meta.url);
        const originalGo = await fs.readFile(new URL(goPath, repository), 'utf8');
        const originalNode = await fs.readFile(new URL(nodePath, repository), 'utf8');
        for (const [file, text] of [[goPath, originalGo], [nodePath, originalNode]]) {
            await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true }); await fs.writeFile(path.join(root, file), text);
        }
        instrumentEvaluationBuild(root);
        const observedGo = await fs.readFile(path.join(root, goPath), 'utf8');
        assert.ok(observedGo.indexOf('CMObservedMemoryIDs = append') < observedGo.indexOf('if stMemoryBlockTokens(next)'));
        assert.match(await fs.readFile(path.join(root, nodePath), 'utf8'), /X-CM-Recall-Ids/);
        assert.equal(await fs.readFile(new URL(goPath, repository), 'utf8'), originalGo);
        assert.equal(await fs.readFile(new URL(nodePath, repository), 'utf8'), originalNode);
        assert.throws(() => instrumentEvaluationBuild(root), /PATCH_MISMATCH/);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
});
test('real answer reader ignores role and reasoning, streams UTF-8 and requires a terminal', async () => {
    let observations = 0;
    const wire = ['data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
        'data: {"choices":[{"delta":{"reasoning_content":"合成思考"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"合成正文"}}]}\n\n', 'data: [DONE]\n\n'].join('');
    const bytes = new TextEncoder().encode(wire);
    const response = new Response(new ReadableStream({ start(controller) {
        for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3)); controller.close();
    } }), { headers: { 'content-type': 'text/event-stream' } });
    assert.equal(await readEvaluationResponse(response, { onBody: () => observations++ }), '合成正文');
    assert.equal(observations, 1);
    // Native ST forwardFetchResponse pipes bytes without forwarding Content-Type.
    assert.equal(await readEvaluationResponse(new Response(wire, { headers: { 'content-type': 'text/plain' } }), { stream: true }), '合成正文');
    await assert.rejects(() => readEvaluationResponse(new Response(wire.replace('data: [DONE]\n\n', ''),
        { headers: { 'content-type': 'text/event-stream' } })), /INTERRUPTED/);
    await assert.rejects(() => readEvaluationResponse(new Response('{}', { status: 503 })), /CM_HTTP_503/);
});
test('real answer reader drains terminal streams so downstream cancellation cannot interrupt usage settlement', async () => {
    let sent = false, cancelled = false, ended = false;
    const wire = new TextEncoder().encode('data: {"choices":[{"delta":{"content":"合成正文"}}]}\n\ndata: [DONE]\n\n');
    const response = new Response(new ReadableStream({
        async pull(controller) {
            if (!sent) { sent = true; controller.enqueue(wire); return; }
            // The proxy still has to persist aggregate usage before ending HTTP.
            await new Promise(resolve => setTimeout(resolve, 10));
            ended = true;
            if (!cancelled) controller.close();
        },
        cancel() { cancelled = true; },
    }), { headers: { 'content-type': 'text/event-stream' } });
    assert.equal(await readEvaluationResponse(response), '合成正文');
    assert.equal(cancelled, false);
    assert.equal(ended, true);
});
test('engine observation proxy preserves production calls and keeps only a bounded authenticated RAM trace', async () => {
    const token = 'synthetic-test-service-token-at-least-32';
    const upstream = http.createServer(async (req, res) => {
        for await (const _chunk of req) { /* consume synthetic body */ }
        res.setHeader('content-type', 'application/json');
        res.end(req.method === 'GET' ? '{"healthy":true}' : '{"hits":[{"record_id":"synthetic-record"}],"stats":{"rerankMs":2}}');
    });
    upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
    const proxy = await startEngineObservationProxy({ token, port: 0, target: `http://127.0.0.1:${upstream.address().port}`, capacity: 1 });
    const base = `http://127.0.0.1:${proxy.port}`, headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    try {
        assert.equal((await fetch(base + '/observations')).status, 401);
        assert.equal((await fetch(base + '/internal/local-models', { headers })).status, 200);
        for (let i = 0; i < 2; i++) {
            const response = await fetch(base + '/internal/search', { method: 'POST', headers,
                body: JSON.stringify({ scope: { ownerId: 'synthetic-owner', instanceId: 'synthetic-instance' }, query: '合成查询', allowedRecordIds: ['synthetic-record'] }) });
            assert.equal(response.status, 200);
        }
        const trace = await (await fetch(base + '/observations?after=0', { headers })).json();
        assert.equal(trace.sequence, 2); assert.equal(trace.incomplete, true); assert.equal(trace.searches.length, 1);
        assert.deepEqual(trace.searches[0].recordIds, ['synthetic-record']);
        assert.equal(trace.searches[0].stats.rerankMs, 2);
        assert.equal((await fetch(base + '/internal/search?target=elsewhere', { method: 'POST', headers, body: '{}' })).status, 404);
    } finally { await proxy.close(); upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)); }
});
test('artifact resume preserves an existing round and journal, and cannot silently reset a missing round', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-cm-resume-'));
    try {
        const first = await createRoundArtifacts(root, { round: 'round-resume' });
        await first.write('budget.json', { calls: 5 }); await first.close();
        const resumed = await createRoundArtifacts(root, { round: 'round-resume', resume: true });
        assert.deepEqual(JSON.parse(await fs.readFile(path.join(resumed.dir, 'budget.json'), 'utf8')), { calls: 5 });
        await resumed.close();
        await assert.rejects(() => createRoundArtifacts(root, { round: 'round-missing', resume: true }), /RESUME_MISSING/);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('artifact capacity scan tolerates the budget journal atomic rename without ignoring retained bytes', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-cm-artifact-race-'));
    const artifacts = await createRoundArtifacts(root, { round: 'round-budget-rename' });
    const budget = path.join(artifacts.dir, 'budget.json');
    const temporary = budget + '.0123456789abcdef.tmp';
    await fs.writeFile(budget, '{"calls":0}');
    await fs.writeFile(temporary, '{"calls":1}');
    const stat = fs.stat;
    t.mock.method(fs, 'stat', async (file, ...args) => {
        if (file === temporary) await fs.rename(temporary, budget);
        return stat(file, ...args);
    });
    try {
        await artifacts.write('summary.json', { processed: 104 });
        assert.deepEqual(JSON.parse(await fs.readFile(budget, 'utf8')), { calls: 1 });
        assert.deepEqual(JSON.parse(await fs.readFile(path.join(artifacts.dir, 'summary.json'), 'utf8')), { processed: 104 });
        // A rename that grows the retained journal must not bypass the cap.
        await fs.writeFile(temporary, 'x'.repeat(10 * 1024 * 1024));
        await assert.rejects(artifacts.write('summary.json', {}), { message: 'ARTIFACT_ROUND_CAPACITY' });
    } finally { await artifacts.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('forget observation holds only the selected record until final outbound has been checked', async () => {
    const token = 'synthetic-forget-control-token-at-least-32';
    let calls = 0;
    const upstream = http.createServer(async (req, res) => {
        for await (const _chunk of req) { /* consume synthetic body */ }
        calls++; res.setHeader('content-type', 'application/json'); res.end('{}');
    });
    upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
    const proxy = await startEngineObservationProxy({ token, port: 0, target: `http://127.0.0.1:${upstream.address().port}` });
    const base = `http://127.0.0.1:${proxy.port}`, headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const post = (route, body) => fetch(base + route, { method: 'POST', headers, body: JSON.stringify(body) });
    try {
        assert.equal((await post('/control/forget', { recordId: 'held-record' })).status, 200);
        assert.equal((await post('/internal/forget', { recordIds: ['other-record'] })).status, 200);
        const pending = post('/internal/forget', { recordIds: ['held-record'] });
        let reached = false;
        for (let attempt = 0; attempt < 50; attempt++) {
            reached = (await (await fetch(base + '/observations', { headers })).json()).forgetHold.reached;
            if (reached) break;
            await new Promise(resolve => setTimeout(resolve, 5));
        }
        assert.equal(reached, true); assert.equal(calls, 1);
        assert.equal((await post('/control/forget', { recordId: null })).status, 200);
        assert.equal((await pending).status, 200); assert.equal(calls, 2);
    } finally { await proxy.close(); upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)); }
});
