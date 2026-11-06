import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { factsInText, outboundMemoryText, readEvaluationResponse, evaluationQueryRows, diagnosticEvidence } from '../scripts/chat-memory-real-eval.mjs';
import { summarizeDiagnosticControls } from '../../../scripts/lib/chat-memory-scoring.mjs';
import { prepareSourceIdentities, sourceMessages } from '../server-plugin/virtual-companion/lib/source-identity.js';
import { getF2Store } from '../server-plugin/virtual-companion/lib/f2-store.js';
import { startEngineObservationProxy } from '../scripts/lib/chat-memory-engine-proxy.mjs';
import { generateChatMemoryDataset } from '../../../scripts/lib/chat-memory-dataset.mjs';
import { createRoundArtifacts } from '../../../scripts/lib/chat-memory-artifacts.mjs';
import { instrumentEvaluationBuild } from '../scripts/lib/chat-memory-observation-build.mjs';

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
