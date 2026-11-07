import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createControlledEngine, mapScope } from '../memorycore-service/business.mjs';
import { createCallbackRunner, forgetCallbackResume } from '../memorycore-service/llm-runner.mjs';

const scope = { ownerId: '1', instanceId: '7', mode: 'COMPANION', domainId: 'daily-7', profileScopeId: 'main' };
const embedding = { provider: 'OLLAMA', endpoint: 'http://127.0.0.1:11438', model: 'synthetic-model',
    artifactVersion: 'artifact-1', dimensions: 2, queryPreprocessingVersion: 'identity-v1',
    documentPreprocessingVersion: 'identity-v1', normalization: 'l2', state: 'ENABLED', revision: 1, spaceId: 'space1' };
function fakeNative() {
    const scopes = new Map(), operations = new Map(), records = new Map(), sources = new Map(); let space;
    return { records, async ready() { return true; }, getScope: key => ({ revision: scopes.get(key) || 0 }),
        getSpace: () => space, configureSpace: (id, dimensions) => { if (space?.spaceId !== id) space = { spaceId: id, dimensions, rebuilding: true }; },
        finishSpaceRebuild: () => { space.rebuilding = false; },
        getOperation: id => operations.get(id),
        invalidateScope: key => { scopes.set(key, (scopes.get(key) || 0) + 1); for (const op of operations.values()) if (op.scopeKey === key) op.status = 'revoked'; return scopes.get(key); },
        async prepare({ messages, scope: mapped }) { return { records: [{ id: 'record1', content: messages[0].content, metadata: {}, ...mapped }], targets: [] }; },
        commitPrepared(p) {
            if (p.revision !== (scopes.get(p.scopeKey) || 0)) throw new Error('MEMORYCORE_REVISION_CONFLICT');
            if (space.spaceId !== p.spaceId) throw new Error('MEMORYCORE_SPACE_CONFLICT');
            if (operations.has(p.operationId)) return operations.get(p.operationId);
            for (const target of p.targets || []) records.delete(target.id);
            for (const r of p.records) records.set(r.record.id, r.record);
            for (const source of p.l0Records || []) sources.set(source.id, source);
            const op = { operationId: p.operationId, scopeKey: p.scopeKey, revision: p.revision, spaceId: p.spaceId, recordIds: p.records.map(r => r.record.id), status: 'committed' };
            operations.set(p.operationId, op); return op;
        },
        list: (ids, mapped) => [...records.values()].filter(r => (!ids || ids.includes(r.id)) && (!mapped || r.agentId === mapped.agentId)),
        listSources: () => [...sources.values()], forgetSources: ids => ids.forEach(id => sources.delete(id)),
        forgetRecords: ids => ids.forEach(id => records.delete(id)),
        async search({ allowedRecordIds }) { return [...records.values()].filter(r => allowedRecordIds.includes(r.id)); },
        async rebuildProfile({ stagingDir }) { await fs.writeFile(path.join(stagingDir, 'persona.md'), 'synthetic profile'); }, close() {},
    };
}
async function fixture(t, options = {}) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-controlled-')); const native = fakeNative();
    const engine = createControlledEngine({ dataRoot: root, nativeFactory: async () => native,
        embeddingFactory: async () => ({ embedBatch: async rows => rows.map(() => new Float32Array([1, 0])) }), runnerFactory: () => ({}), ...options });
    t.after(async () => { await engine.close(); await fs.rm(root, { recursive: true, force: true }); });
    return { engine, native, root };
}
const proposalInput = () => ({ scope, revision: 0, operationId: 'op1', embedding, allowedRecordIds: [], operationToken: 'ephemeral',
    messages: [{ id: 'message1', content: 'synthetic content', timestamp: '2026-10-28T00:00:00Z' }] });
test('extraction window keeps actual support through replay and omits unused context from native evidence', async t => {
    const { engine, native } = await fixture(t);
    const input = proposalInput();
    input.messages = [
        { id: 'unused', role: 'user', content: '未被引用的上下文', timestamp: '2026-10-26T00:00:00Z' },
        { id: 'assistant1', role: 'assistant', content: '你说的是每周三去游泳？', timestamp: '2026-10-27T00:00:00Z' },
        { ...input.messages[0], role: 'user', content: '对，每周都去。' },
    ];
    input.primarySourceId = 'message1';
    let seen;
    native.prepare = async p => {
        seen = p;
        return { records: [{ id: 'record1', content: '用户每周三游泳。', source_message_ids: ['assistant1', 'message1'] }], targets: [] };
    };
    const proposal = await engine.invoke('propose', input);
    assert.equal(seen.primarySourceId, 'message1');
    assert.equal(seen.recordedAt, input.messages[2].timestamp);
    assert.deepEqual(proposal.dependencies, ['assistant1', 'message1']);
    assert.deepEqual(proposal.contextDependencies, ['unused', 'assistant1', 'message1']);
    assert.equal(proposal.records[0].metadata.vcPrimarySourceId, 'message1');
    assert.deepEqual(await engine.invoke('propose', structuredClone(input)), proposal);
    await assert.rejects(engine.invoke('propose', { ...input, primarySourceId: 'assistant1' }), /PRIMARY_SOURCE/);
    await assert.rejects(engine.invoke('propose', { ...input, messages: [input.messages[0], { ...input.messages[1], content: '改过的澄清' }, input.messages[2]] }), /OPERATION_CONFLICT/);
    await engine.invoke('commit', { scope, revision: 0, operationId: input.operationId });
    assert.deepEqual(native.listSources().map(s => [s.id, s.role]), [['assistant1', 'assistant'], ['message1', 'user']]);
});
test('sibling facts retain only their citations and own conflict target evidence', async t => {
    const { engine, native } = await fixture(t);
    native.records.set('old-a', { id: 'old-a', ...mapScope(scope), metadata: { vcDependencies: ['old-source-a'] } });
    native.records.set('old-b', { id: 'old-b', ...mapScope(scope), metadata: { vcDependencies: ['old-source-b'] } });
    const input = { ...proposalInput(), primarySourceId: 'message1', allowedRecordIds: ['old-a', 'old-b'],
        messages: [
            { id: 'user-a', role: 'user', content: '用户事实 A', timestamp: '2026-10-27T00:00:00Z' },
            { id: 'assistant-b', role: 'assistant', content: '澄清 B', timestamp: '2026-10-27T00:00:01Z' },
            { ...proposalInput().messages[0], role: 'user', content: '用户确认 B' },
        ] };
    native.prepare = async () => ({ targets: [{ id: 'old-a', version: 1 }, { id: 'old-b', version: 1 }], records: [
        { id: 'record-a', content: '独立事实 A', source_message_ids: ['user-a'], conflictTargetIds: ['old-a'] },
        { id: 'record-b', content: '独立事实 B', source_message_ids: ['assistant-b', 'message1'], conflictTargetIds: ['old-b'] },
    ] });
    const proposal = await engine.invoke('propose', input);
    const a = ['user-a', 'old-source-a'], b = ['assistant-b', 'message1', 'old-source-b'];
    assert.deepEqual(proposal.records.map(r => r.source_message_ids), [a, b]);
    assert.deepEqual(proposal.records.map(r => r.metadata.vcDependencies), [a, b]);
    assert.deepEqual(proposal.records.map(r => r.metadata.vcPrimarySourceId), ['user-a', 'message1']);
    assert.deepEqual(proposal.dependencies, [...a, ...b]);
    await engine.invoke('commit', input);
    await engine.invoke('forget', { scope, revision: 0, recordIds: ['record-b'], sourceIds: b });
    const exported = await engine.invoke('export-owner', { scope });
    assert.deepEqual(exported.records.map(r => r.id), ['record-a']);
    assert.deepEqual(exported.jsonl.map(shard => JSON.parse(shard.content).id), ['record-a']);
});
test('prepare rejects a batch with an undeclared target before changing either old fact', async t => {
    const { engine, native } = await fixture(t);
    const old = ['old-a', 'old-b'].map(id => ({ id, content: `synthetic ${id}`, ...mapScope(scope),
        metadata: { vcDependencies: [`source-${id}`] } }));
    for (const record of old) native.records.set(record.id, structuredClone(record));
    const input = { ...proposalInput(), primarySourceId: 'message1', allowedRecordIds: ['old-a', 'old-b'] };
    native.prepare = async () => ({ targets: [{ id: 'old-a', version: 1 }, { id: 'old-b', version: 1 }],
        records: [{ id: 'replacement-a', content: 'synthetic replacement', source_message_ids: ['message1'], conflictTargetIds: ['old-a'] }] });
    await assert.rejects(engine.invoke('propose', input), /MEMORYCORE_TARGET_NOT_ALLOWED/);
    assert.deepEqual([...native.records.values()], old);
    assert.equal((await engine.invoke('operation-status', input)).status, 'failed');
});
test('assistant-only request or fact cannot become a user fact', async t => {
    const { engine, native } = await fixture(t);
    const input = proposalInput();
    await assert.rejects(engine.invoke('propose', { ...input, messages: [{ ...input.messages[0], role: 'assistant' }] }), /PRIMARY_SOURCE/);
    input.messages = [{ ...input.messages[0], id: 'assistant1', role: 'assistant' }, { ...input.messages[0], role: 'user' }];
    input.primarySourceId = 'message1';
    native.prepare = async () => ({ records: [{ id: 'record1', content: '助手猜测的用户事实', source_message_ids: ['assistant1'] }], targets: [] });
    await assert.rejects(engine.invoke('propose', input), /PRIMARY_SOURCE/);
    assert.equal(native.records.size, 0);
});
test('failed and orphaned legacy operations expose only replay keys and retain exact singleton requests', async t => {
    for (const state of ['failed', 'preparing']) {
        await t.test(state, async t => {
            const { engine, native, root } = await fixture(t);
            const input = proposalInput();
            // The old Go map encoder ordered keys alphabetically. The new
            // typed messages may have a different JSON object key order.
            input.messages = [{ content: input.messages[0].content, id: 'message1', role: 'user', timestamp: input.messages[0].timestamp }];
            native.prepare = async () => { throw new Error('MEMORYCORE_CALLBACK_TIMEOUT'); };
            await assert.rejects(engine.invoke('propose', input), /CALLBACK_TIMEOUT/);
            if (state === 'preparing') {
                const file = path.join(root, 'owners', '1', 'operations', 'op1.json');
                const stored = JSON.parse(await fs.readFile(file, 'utf8'));
                stored.status = 'preparing';
                await fs.writeFile(file, JSON.stringify(stored));
            }
            const status = await engine.invoke('operation-status', { scope, operationId: input.operationId });
            assert.equal(status.status, 'failed');
            assert.deepEqual(status.extractionInput, { messages: [{ id: 'message1', timestamp: input.messages[0].timestamp }] });
            assert.equal(JSON.stringify(status).includes(input.messages[0].content), false);
            native.prepare = async ({ messages }) => ({ records: [{ id: 'record1', content: messages[0].content }], targets: [] });
            const proposal = await engine.invoke('propose', { ...input, messages: input.messages.map(m => ({ id: m.id, content: m.content, role: m.role, timestamp: m.timestamp })) });
            assert.deepEqual(proposal.dependencies, ['message1']);
        });
    }
});
test('trusted identity maps logical memory domain, never real chat', () => {
    const s = mapScope(scope); assert.equal(s.teamId, 'owner:1'); assert.equal(s.agentId, 'instance:7:mode:COMPANION');
    assert.equal(s.sessionId, s.sessionKey); assert.equal(s.sessionId, 'daily-7');
    assert.throws(() => mapScope({ ...scope, ownerId: '../bad' }));
    assert.throws(() => mapScope({ ...scope, mode: 'DAILY' }));
});
test('deterministic dedup failure drops journaled calls while a timeout keeps them', async t => {
    let fetches = 0;
    const text = JSON.stringify([{ record_id: 'm1', action: 'store' }]);
    const fetchImpl = async () => { fetches += 1; return Response.json({ text }); };
    const runnerFactory = (token) => createCallbackRunner({ baseURL: 'http://127.0.0.1:9', token: 'k'.repeat(32), operationToken: token, stage: 'l1-extraction', fetchImpl, counter: { value: 0 } });
    const { engine, native, root } = await fixture(t, { runnerFactory });
    const token = 'journal-dedup';
    t.after(() => forgetCallbackResume(token));
    native.prepare = async ({ runner }) => {
        await runner.run({ prompt: 'p', systemPrompt: 's', taskId: 'l1-extraction' });
        throw new Error('DEDUP_INVALID');
    };
    const input = { ...proposalInput(), operationId: 'op-dedup', operationToken: token };
    await assert.rejects(engine.invoke('propose', input), /DEDUP_INVALID/);
    const stored = JSON.parse(await fs.readFile(path.join(root, 'owners', '1', 'operations', 'op-dedup.json'), 'utf8'));
    assert.equal(stored.status, 'failed');
    assert.equal(stored.calls, undefined);
    assert.equal(JSON.stringify(stored).includes(text), false);
    fetches = 0;
    await assert.rejects(engine.invoke('propose', input), /DEDUP_INVALID/);
    assert.equal(fetches, 1);
    native.prepare = async ({ runner }) => {
        await runner.run({ prompt: 'p', systemPrompt: 's', taskId: 'l1-extraction' });
        throw new Error('MEMORYCORE_CALLBACK_TIMEOUT');
    };
    const timeoutToken = 'journal-timeout';
    t.after(() => forgetCallbackResume(timeoutToken));
    const timeoutInput = { ...proposalInput(), operationId: 'op-timeout', operationToken: timeoutToken };
    await assert.rejects(engine.invoke('propose', timeoutInput), /MEMORYCORE_CALLBACK_TIMEOUT/);
    const kept = JSON.parse(await fs.readFile(path.join(root, 'owners', '1', 'operations', 'op-timeout.json'), 'utf8'));
    assert.equal(kept.calls.length, 1);
    assert.equal(kept.calls[0].status, 'ok');
    fetches = 0;
    await assert.rejects(engine.invoke('propose', timeoutInput), /MEMORYCORE_CALLBACK_TIMEOUT/);
    assert.equal(fetches, 0);
});
test('proposal does not publish; commit and replay are idempotent; allowlist empty remains empty', async t => {
    const { engine, native } = await fixture(t); const p = proposalInput();
    const first = await engine.invoke('propose', p); assert.equal(native.records.size, 0);
    assert.deepEqual(first.records[0].source_message_ids, ['message1']);
    assert.deepEqual(await engine.invoke('propose', p), first);
    await assert.rejects(engine.invoke('propose', { ...p, messages: [{ ...p.messages[0], content: 'different' }] }), /OPERATION_CONFLICT/);
    const c = { scope, revision: 0, operationId: p.operationId };
    const receipt = await engine.invoke('commit', c); assert.equal(receipt.status, 'published');
    assert.deepEqual(await engine.invoke('commit', c), receipt); assert.equal(native.records.size, 1);
    assert.deepEqual(await engine.invoke('search', { scope, embedding, allowedRecordIds: [], query: 'content' }), []);
    assert.equal((await engine.invoke('search', { scope, embedding, allowedRecordIds: ['record1'], query: 'content' })).length, 1);
});
test('search passes owner and scope into the embedding client and native cache identity', async (t) => {
    let embeddingOptions;
    const { engine, native } = await fixture(t, {
        embeddingFactory: async (_snapshot, options) => {
            embeddingOptions = options;
            return { embedBatch: async (rows) => rows.map(() => new Float32Array([1, 0])) };
        },
    });
    const p = proposalInput();
    await engine.invoke('propose', p);
    await engine.invoke('commit', { scope, revision: 0, operationId: p.operationId });
    native.configureSpace = () => {};
    native.getSpace = () => ({ spaceId: embedding.spaceId, dimensions: 2, rebuilding: false });
    let seen;
    native.search = async (input) => { seen = input; return []; };
    await engine.invoke('search', { scope, embedding, allowedRecordIds: ['record1'], query: 'content' });
    assert.equal(embeddingOptions.ownerId, '1');
    assert.equal(embeddingOptions.scope, '7:COMPANION:daily-7:main');
    assert.equal(seen.cacheOwnerId, '1');
    assert.equal(seen.cacheScope, '7:COMPANION:daily-7:main');
});
test('search passes rerankEnabled false through to native search', async (t) => {
    const { engine, native } = await fixture(t);
    const p = proposalInput();
    await engine.invoke('propose', p);
    await engine.invoke('commit', { scope, revision: 0, operationId: p.operationId });
    let seen;
    const original = native.search.bind(native);
    native.search = async (input) => { seen = input.rerank; return original(input); };
    const found = await engine.invoke('search', {
        scope, embedding, allowedRecordIds: ['record1'], query: 'content', rerankEnabled: false,
    });
    assert.equal(found.length, 1);
    assert.equal(seen, false);
});
test('forget advances revision, revokes derived work and rejects late proposal', async t => {
    const { engine, native } = await fixture(t); const p = proposalInput(); await engine.invoke('propose', p);
    await engine.invoke('forget', { scope, revision: 0, recordIds: [] });
    await assert.rejects(engine.invoke('commit', { scope, revision: 0, operationId: 'op1' }), /REVISION/);
    assert.equal(native.records.size, 0);
});
test('changed space rejects old proposal; timeout never becomes a successful empty proposal', async t => {
    const { engine, native } = await fixture(t); await engine.invoke('propose', proposalInput());
    native.configureSpace('space2', 3);
    await assert.rejects(engine.invoke('commit', { scope, revision: 0, operationId: 'op1' }), /SPACE/);
    native.prepare = async () => { throw new Error('MEMORYCORE_CALLBACK_FAILED'); };
    await assert.rejects(engine.invoke('propose', { ...proposalInput(), operationId: 'op2', embedding: { ...embedding, spaceId: 'space2', dimensions: 3, revision: 2 } }), /CALLBACK_FAILED/);
    assert.equal((await engine.invoke('operation-status', { scope, operationId: 'op2' })).status, 'failed');
});
test('partial file publication resumes same commit without repeating native write', async t => {
    let count = 0;
    const { engine, native } = await fixture(t, { publishHook: async () => { if (++count === 1) throw new Error('INJECTED_PUBLICATION_FAILURE'); } });
    await engine.invoke('propose', proposalInput());
    const input = { scope, revision: 0, operationId: 'op1' };
    await assert.rejects(engine.invoke('commit', input), /PUBLICATION_FAILURE/);
    assert.equal((await engine.invoke('operation-status', input)).status, 'publishing');
    assert.deepEqual(await engine.invoke('search', { scope, embedding, allowedRecordIds: ['record1'], query: 'x' }), []);
    assert.equal((await engine.invoke('commit', input)).status, 'published'); assert.equal(native.records.size, 1);
});
test('rebuild-profile HTTP returns a closed tool code and drops free-form errors', async t => {
    const { createMemoryCoreServer } = await import('../memorycore-service/http.mjs');
    const { engine, native } = await fixture(t);
    await engine.invoke('propose', proposalInput());
    await engine.invoke('commit', { scope, revision: 0, operationId: 'op1' });
    const token = 't'.repeat(32), server = createMemoryCoreServer({ engine, token, commit: 'fixed' });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    const post = async (operationId) => {
        const res = await fetch(`http://127.0.0.1:${server.address().port}/internal/rebuild-profile`, {
            method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            body: JSON.stringify({ scope, revision: 0, operationId, allowedRecordIds: ['record1'] }),
        });
        return { status: res.status, json: await res.json() };
    };
    native.rebuildProfile = async () => { throw new Error('MEMORYCORE_TOOL_PATH'); };
    const closed = await post('profile-closed');
    assert.equal(closed.status, 422);
    assert.equal(closed.json.code, 'MEMORYCORE_TOOL_PATH');
    const leaked = 'synthetic secret sentence';
    native.rebuildProfile = async () => { throw new Error(`boom ${leaked}`); };
    const open = await post('profile-open');
    assert.equal(open.status, 422);
    assert.equal(open.json.code, 'MEMORYCORE_OPERATION_FAILED');
    assert.equal(JSON.stringify(open.json).includes(leaked), false);
    native.rebuildProfile = async () => { throw new Error('DEDUP_INVALID'); };
    const bare = await post('profile-bare');
    assert.equal(bare.status, 422);
    assert.equal(bare.json.code, 'MEMORYCORE_ENGINE_DEDUP_INVALID');
    assert.equal(JSON.stringify(bare.json).includes('DEDUP_INVALID detail'), false);
    native.rebuildProfile = async () => { throw new Error(`DEDUP_INVALID ${leaked}`); };
    const mixed = await post('profile-mixed');
    assert.equal(mixed.status, 422);
    assert.equal(mixed.json.code, 'MEMORYCORE_OPERATION_FAILED');
    assert.equal(JSON.stringify(mixed.json).includes(leaked), false);
});
test('failed forget profile survives same-revision cleanup and a new operation can publish', async t => {
    const calls = [];
    const runnerFactory = (operationToken, stagingDir) => createCallbackRunner({
        baseURL: 'http://127.0.0.1:9', token: 'k'.repeat(32), operationToken, stagingDir, stage: 'l2-scene',
        fetchImpl: async (_url, options) => {
            const { operationToken, stage, callSequence } = JSON.parse(options.body);
            calls.push({ operationToken, stage, callSequence });
            return calls.length === 1
                ? Response.json({ code: 'MEMORYCORE_UPSTREAM_FAILED' }, { status: 500 })
                : Response.json({ text: JSON.stringify({ text: 'complete' }) });
        },
    });
    const { engine, native, root } = await fixture(t, { runnerFactory });
    await engine.invoke('propose', proposalInput());
    await engine.invoke('commit', { scope, revision: 0, operationId: 'op1' });
    await engine.invoke('invalidate-scope', { scope, revision: 1 });
    native.rebuildProfile = async ({ runner, stagingDir }) => {
        await runner.run({ prompt: 'synthetic scene', systemPrompt: 'synthetic instructions' });
        await fs.writeFile(path.join(stagingDir, 'persona.md'), 'synthetic recovered profile');
    };
    const failed = { scope, revision: 1, operationId: 'forget-9-profile', operationToken: 'profile-first',
        allowedRecordIds: ['record1'], verifiedDependencies: ['message1'] };
    await assert.rejects(engine.invoke('rebuild-profile', failed), /MEMORYCORE_UPSTREAM_FAILED/);
    await assert.rejects(fs.access(path.join(root, 'owners/1/staging', failed.operationId)), { code: 'ENOENT' });

    // Periodic recovery repeats the completed forget at the already-advanced revision.
    const cleanup = { scope, revision: 1, revisionAdvanced: true,
        recordIds: ['forgotten-record'], sourceIds: ['forgotten-source'] };
    assert.equal((await engine.invoke('forget', cleanup)).status, 'cleared');
    assert.deepEqual(await engine.invoke('operation-status', failed), { status: 'failed', revision: 1 });
    await assert.rejects(engine.invoke('rebuild-profile', failed), /MEMORYCORE_OPERATION_CONFLICT/);
    assert.equal(calls.length, 1, 'the failed operation must not repeat its callback sequence');

    // Go can now observe failed and rebind to a fresh profile operation/capability.
    const rebound = { ...failed, operationId: 'forget-9-profile-a1', operationToken: 'profile-rebound' };
    assert.deepEqual(await engine.invoke('rebuild-profile', rebound), { status: 'staged', dependencies: ['message1'] });
    assert.equal((await engine.invoke('rebuild-profile', { ...rebound, publish: true })).status, 'published');
    assert.deepEqual(await engine.invoke('read-profile', rebound), {
        dependencies: ['message1'], files: { 'persona.md': 'synthetic recovered profile' },
    });
    assert.equal((await engine.invoke('forget', cleanup)).status, 'cleared');
    assert.equal((await engine.invoke('operation-status', rebound)).status, 'profile-published');
    assert.deepEqual(calls, [
        { operationToken: 'profile-first', stage: 'l2-scene', callSequence: 1 },
        { operationToken: 'profile-rebound', stage: 'l2-scene', callSequence: 1 },
    ]);
});
test('HTTP business operations reject missing token and browser Origin', async t => {
    const { createMemoryCoreServer } = await import('../memorycore-service/http.mjs');
    const { engine } = await fixture(t);
    const token = 't'.repeat(32), server = createMemoryCoreServer({ engine, token, commit: 'fixed' });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    const url = `http://127.0.0.1:${server.address().port}/internal/propose`;
    assert.equal((await fetch(url, { method: 'POST', body: '{}' })).status, 401);
    assert.equal((await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, origin: 'http://browser.test' }, body: '{}' })).status, 403);
    assert.equal((await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(proposalInput()) })).status, 200);
});
test('revision advance during propose is a distinct conflict and a stale retry makes no model call', async t => {
    const { createMemoryCoreServer } = await import('../memorycore-service/http.mjs');
    const { engine, native } = await fixture(t);
    let prepares = 0;
    native.prepare = async ({ messages, scope: mapped }) => {
        prepares++;
        native.invalidateScope('7:COMPANION:daily-7:main');
        return { records: [{ id: 'record-advanced', content: messages[0].content, metadata: {}, ...mapped }], targets: [] };
    };
    const token = 't'.repeat(32), server = createMemoryCoreServer({ engine, token, commit: 'fixed' });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    const post = async (body) => {
        const res = await fetch(`http://127.0.0.1:${server.address().port}/internal/propose`, {
            method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            body: JSON.stringify(body),
        });
        return { status: res.status, json: await res.json() };
    };
    const first = await post(proposalInput());
    assert.equal(first.status, 409);
    assert.equal(first.json.code, 'MEMORYCORE_REVISION_CONFLICT');
    assert.equal(JSON.stringify(first.json).includes('synthetic content'), false);
    const beforeRetry = prepares;
    const retry = await post(proposalInput());
    assert.equal(retry.status, 409);
    assert.equal(retry.json.code, 'MEMORYCORE_REVISION_CONFLICT');
    assert.equal(prepares, beforeRetry);
    const running = deferred();
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    native.prepare = async ({ messages, scope: mapped }) => {
        prepares++;
        running.resolve();
        await gate;
        return { records: [{ id: 'record-live', content: messages[0].content, metadata: {}, ...mapped }], targets: [] };
    };
    const live = engine.invoke('propose', { ...proposalInput(), operationId: 'op-live', revision: native.getScope('7:COMPANION:daily-7:main').revision });
    await running.promise;
    assert.equal((await engine.invoke('operation-status', { scope, operationId: 'op-live' })).status, 'preparing');
    release();
    await live;
});

function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
const searchInput = ids => ({ scope, embedding, allowedRecordIds: ids, query: 'content' });
test('concurrent same operation reserves exactly one extraction', async t => {
    const { engine, native } = await fixture(t); const entered = deferred(), release = deferred(); let calls = 0;
    const prepare = native.prepare;
    native.prepare = async input => { calls++; entered.resolve(); await release.promise; return prepare(input); };
    const one = engine.invoke('propose', proposalInput()); await entered.promise;
    const two = engine.invoke('propose', proposalInput()); release.resolve();
    const [a, b] = await Promise.all([one, two]); assert.deepEqual(a, b); assert.equal(calls, 1);
});
test('forget preserves unrelated shard records and rejects stale commit without request body', async t => {
    const { engine, native } = await fixture(t);
    native.prepare = async ({ scope: mapped }) => ({ records: ['record1','record2'].map(id => ({ id, content: id, ...mapped })), targets: [] });
    await engine.invoke('propose', proposalInput()); await engine.invoke('commit', { scope, revision: 0, operationId: 'op1' });
    assert.equal((await engine.invoke('forget', { scope, revision: 0, recordIds: ['record1'] })).status, 'cleared');
    await assert.rejects(engine.invoke('commit', { scope, revision: 1, operationId: 'op1' }), /REVISION/);
    assert.deepEqual((await engine.invoke('search', searchInput(['record1','record2']))).map(r => r.id), ['record2']);
    assert.equal(native.listSources().length, 1, 'retained record still depends on source');
});
test('forget during extraction cannot restore cleared source text in failure status', async t => {
    const { engine, native, root } = await fixture(t); const entered = deferred(), release = deferred();
    native.prepare = async () => { entered.resolve(); await release.promise; throw new Error('INJECTED_TIMEOUT'); };
    const task = engine.invoke('propose', proposalInput()); const rejected = assert.rejects(task, /TIMEOUT|REVISION/); await entered.promise;
    const pending = await engine.invoke('forget', { scope, revision: 0, recordIds: [] }); assert.equal(pending.status, 'pending');
    release.resolve(); await rejected;
    const done = await engine.invoke('forget', { scope, revision: 0, recordIds: [] }); assert.equal(done.status, 'cleared');
    const status = await fs.readFile(path.join(root, 'owners/1/operations/op1.json'), 'utf8');
    assert.equal(status.includes('synthetic content'), false); assert.equal(JSON.parse(status).status, 'revoked');
});
test('profile finishing after forget cannot recreate staging or publish', async t => {
    const { engine, native, root } = await fixture(t); const entered = deferred(), release = deferred();
    native.rebuildProfile = async ({ stagingDir }) => { entered.resolve(); await release.promise; await fs.mkdir(stagingDir, { recursive: true }); await fs.writeFile(path.join(stagingDir,'persona.md'),'obsolete profile'); };
    const input = { scope, revision: 0, operationId: 'profile1', allowedRecordIds: [] };
    const task = engine.invoke('rebuild-profile', input), rejected = assert.rejects(task, /REVISION/); await entered.promise;
    assert.equal((await engine.invoke('forget', { scope, revision: 0, recordIds: [] })).status, 'pending');
    release.resolve(); await rejected;
    assert.equal((await engine.invoke('forget', { scope, revision: 0, recordIds: [] })).status, 'cleared');
    await assert.rejects(fs.access(path.join(root,'owners/1/staging/profile1')));
    await assert.rejects(engine.invoke('rebuild-profile', { ...input, revision: 1, publish: true, verifiedDependencies: [] }), /PROFILE/);
});
test('failed cleanup remains pending and retries with original revision', async t => {
    const { engine, native } = await fixture(t); await engine.invoke('propose', proposalInput()); await engine.invoke('commit', { scope, revision: 0, operationId: 'op1' });
    const forget = native.forgetRecords; let fail = true;
    native.forgetRecords = (...args) => { if (fail) { fail = false; throw new Error('INJECTED_CLEANUP_FAILURE'); } return forget(...args); };
    const input = { scope, revision: 0, recordIds: ['record1'] };
    assert.equal((await engine.invoke('forget', input)).status, 'pending');
    assert.deepEqual(await engine.invoke('search', searchInput(['record1'])), []);
    assert.equal((await engine.invoke('forget', input)).status, 'cleared'); assert.equal(native.records.size, 0); assert.equal(native.listSources().length,0);
});
test('legacy forget cleanup resumes after restart only for the same request with revisionAdvanced', async t => {
    const owners = new Map([['1', fakeNative()], ['2', fakeNative()]]);
    const nativeFactory = async dir => owners.get(path.basename(dir));
    const { engine, root } = await fixture(t, { nativeFactory });
    const native = owners.get(scope.ownerId);
    await engine.invoke('propose', proposalInput());
    await engine.invoke('commit', { scope, revision: 0, operationId: 'op1' });
    await engine.invoke('invalidate-scope', { scope, revision: 1 });

    const input = { scope, revision: 1, recordIds: ['record1'], sourceIds: ['message1'] };
    const advance = native.invalidateScope;
    native.invalidateScope = () => { throw new Error('INJECTED_CLEANUP_INTERRUPTION'); };
    assert.equal((await engine.invoke('forget', input)).status, 'pending');
    const file = path.join(root, 'owners', scope.ownerId, 'cleanup.json');
    const saved = await fs.readFile(file, 'utf8');
    const intent = JSON.parse(saved);
    assert.deepEqual(intent.request, { action: 'forget', ...input });
    assert.deepEqual(intent.scopes, [{ key: '7:COMPANION:daily-7:main', revision: 2 }]);
    assert.deepEqual(await engine.invoke('scope-status', { scope }), { revision: 1 });
    await engine.close();

    // Reopen the service with the same durable native state and intent.
    native.invalidateScope = advance;
    const restarted = createControlledEngine({ dataRoot: root, nativeFactory });
    t.after(() => restarted.close());
    const retry = { ...input, revisionAdvanced: true };
    await assert.rejects(restarted.invoke('clear-owner', retry), { message: 'MEMORYCORE_CLEANUP_PENDING' }, 'action');
    for (const [field, value] of Object.entries({
        scope: { ...scope, profileScopeId: 'sibling' },
        revision: 0,
        recordIds: ['record2'],
        sourceIds: ['message2'],
        matchSourceRecords: false,
    })) {
        await assert.rejects(restarted.invoke('forget', { ...retry, [field]: value }),
            { message: 'MEMORYCORE_CLEANUP_PENDING' }, field);
    }
    const otherScope = { ...scope, ownerId: '2' };
    const other = await restarted.invoke('forget', { ...retry, scope: otherScope, revision: 0 });
    assert.equal(other.status, 'cleared');
    assert.equal(other.revision, 0);
    assert.equal(await fs.readFile(file, 'utf8'), saved);
    assert.equal(native.records.has('record1'), true);
    assert.deepEqual(await restarted.invoke('scope-status', { scope }), { revision: 1 });

    const result = await restarted.invoke('forget', retry);
    assert.equal(result.status, 'cleared');
    assert.equal(result.revision, intent.scopes[0].revision);
    assert.deepEqual(await restarted.invoke('scope-status', { scope }), { revision: 2 });
    assert.equal(native.records.has('record1'), false);
    assert.equal(native.listSources().length, 0);
    await assert.rejects(fs.access(file), { code: 'ENOENT' });

    const replay = await restarted.invoke('forget', retry);
    assert.equal(replay.status, 'cleared');
    assert.equal(replay.revision, intent.scopes[0].revision);
    assert.equal(native.records.size, 0);
    assert.equal(native.listSources().length, 0);
});
test('pending cleanup finishes its original intent before a stronger recovery', async t => {
    const { engine, native, root } = await fixture(t);
    const proposal = { ...proposalInput(), primarySourceId: 'source-b', messages: [
        { id: 'source-a', role: 'user', content: '独立事实 A', timestamp: '2026-11-04T00:00:00Z' },
        { id: 'source-b', role: 'user', content: '独立事实 B', timestamp: '2026-11-06T00:00:00Z' },
    ] };
    native.prepare = async () => ({ targets: [], records: proposal.messages.map((m, i) => ({
        id: i === 0 ? 'record-a' : 'record-b', content: m.content, source_message_ids: [m.id],
    })) });
    await engine.invoke('propose', proposal);
    await engine.invoke('commit', proposal);
    await engine.invoke('invalidate-scope', { scope, revision: 1 });
    let blocked = true;
    native.checkpoint = () => { if (blocked) throw new Error('SYNTHETIC_CHECKPOINT_PENDING'); };
    const first = { scope, revision: 1, revisionAdvanced: true, matchSourceRecords: false,
        recordIds: ['record-b'], sourceIds: ['source-b'] };
    assert.equal((await engine.invoke('forget', first)).status, 'pending');
    assert.deepEqual([...native.records.keys()], ['record-a']);
    const file = path.join(root, 'owners/1/cleanup.json');
    const old = await fs.readFile(file, 'utf8');
    const stronger = { ...first, revision: 2, recordIds: ['record-a', 'record-b'], sourceIds: ['source-a', 'source-b'] };
    await assert.rejects(engine.invoke('invalidate-scope', { scope, revision: 2 }), /CLEANUP_PENDING/);
    assert.equal((await engine.invoke('scope-status', { scope })).revision, 1);
    await assert.rejects(engine.invoke('forget', stronger), /CLEANUP_PENDING/);
    assert.equal(await fs.readFile(file, 'utf8'), old);
    // A pre-upgrade invalidator could have moved the fence while this same
    // durable intent was already blocking native commits.
    native.invalidateScope('7:COMPANION:daily-7:main');
    await assert.rejects(engine.invoke('commit', { ...proposal, revision: 2 }), /CLEANUP_PENDING/);
    blocked = false;
    await assert.rejects(engine.invoke('forget', stronger), /CLEANUP_PENDING/);
    assert.equal(await fs.readFile(file, 'utf8'), old);
    assert.deepEqual(await engine.invoke('invalidate-scope', { scope, revision: 2 }), { revision: 2 });
    await assert.rejects(fs.access(file));
    assert.deepEqual([...native.records.keys()], ['record-a']);
    for (let i = 0; i < 2; i++) assert.equal((await engine.invoke('forget', stronger)).status, 'cleared');
    const state = await engine.invoke('export-owner', { scope });
    assert.deepEqual([state.records, state.sources, state.jsonl], [[], [], []]);
    assert.equal(state.cleanup, 'clear');
});
test('replacement scrubs superseded JSONL and proposal and exports published profiles without capability', async t => {
    const { engine, native, root } = await fixture(t);
    await engine.invoke('propose', proposalInput()); await engine.invoke('commit', { scope, revision: 0, operationId: 'op1' });
    const profile = { scope, revision: 0, operationId: 'profile1', allowedRecordIds: ['record1'] };
    await engine.invoke('rebuild-profile', profile); await engine.invoke('rebuild-profile', { ...profile, publish: true, verifiedDependencies: ['message1'] });
    const exported = await engine.invoke('export-owner', { scope });
    assert.equal(exported.profiles[0].files['persona.md'], 'synthetic profile'); assert.equal(exported.sources.length, 1);
    assert.equal(JSON.stringify(exported).includes('ephemeral'), false);
    native.prepare = async ({ scope: mapped }) => ({ records: [{ id:'record2', content:'corrected content', conflictTargetIds: ['record1'], ...mapped }], targets:[{id:'record1',version:1}] });
    await engine.invoke('propose', { ...proposalInput(), operationId:'op2', allowedRecordIds:['record1'], messages:[{...proposalInput().messages[0],id:'message2',content:'corrected content'}] });
    await engine.invoke('commit', { scope, revision:0,operationId:'op2' });
    const old = await fs.readFile(path.join(root,'owners/1/operations/op1.json'),'utf8'); assert.equal(old.includes('synthetic content'),false);
    await assert.rejects(fs.access(path.join(root,'owners/1/records/op1.jsonl')));
    assert.deepEqual((await engine.invoke('export-owner', { scope })).profiles,[]);
});

test('branch inherits only trusted allowlisted records in the same logical domain', async t => {
    const { engine, native } = await fixture(t);
    await engine.invoke('propose', proposalInput());
    await engine.invoke('commit', { scope, revision: 0, operationId: 'op1' });
    const branch = { ...scope, profileScopeId: 'branch-b' };
    assert.deepEqual((await engine.invoke('search', { ...searchInput(['record1']), scope: branch })).map(r => r.id), ['record1']);
    assert.deepEqual(await engine.invoke('search', { ...searchInput([]), scope: branch }), []);
    native.prepare = async ({ scope: mapped }) => ({ records: [{ id: 'branch-record', content: 'branch only', ...mapped }], targets: [] });
    await engine.invoke('propose', { ...proposalInput(), scope: branch, operationId: 'branch-op' });
    await engine.invoke('commit', { scope: branch, revision: 0, operationId: 'branch-op' });
    assert.deepEqual((await engine.invoke('search', searchInput(['record1']))).map(r => r.id), ['record1']);
    assert.deepEqual((await engine.invoke('search', { ...searchInput(['branch-record']), scope: branch })).map(r => r.id), ['branch-record']);
    assert.deepEqual(await engine.invoke('search', { ...searchInput(['record1']), scope: { ...branch, domainId: 'other-domain' } }), []);
});

test('profile omits records whose dependencies were not verified by Go', async t => {
    const { engine, native } = await fixture(t);
    const p = proposalInput();
    await engine.invoke('propose', p);
    await engine.invoke('commit', { scope, revision: 0, operationId: p.operationId });
    const mapped = mapScope(scope);
    native.records.set('seed', { id: 'seed', content: 'seed fact', ...mapped, version: 1, metadata: { vcDependencies: ['deployment-source'], vcScopeKey: 'seed' } });
    let profiled;
    native.rebuildProfile = async ({ records, stagingDir }) => {
        profiled = records.map(record => record.id).sort();
        await fs.writeFile(path.join(stagingDir, 'persona.md'), 'synthetic profile');
    };
    const staged = await engine.invoke('rebuild-profile', { scope, revision: 0, operationId: 'profile-mixed', allowedRecordIds: ['record1', 'seed'], verifiedDependencies: ['message1'] });
    assert.deepEqual(profiled, ['record1']);
    assert.deepEqual(staged.dependencies, ['message1']);
    const published = await engine.invoke('rebuild-profile', { scope, revision: 0, operationId: 'profile-mixed', allowedRecordIds: ['record1', 'seed'], publish: true, verifiedDependencies: ['message1'] });
    assert.deepEqual(published.dependencies, ['message1']);
    let called = false;
    native.rebuildProfile = async () => { called = true; };
    const empty = await engine.invoke('rebuild-profile', { scope, revision: 0, operationId: 'profile-foreign', allowedRecordIds: ['seed'], verifiedDependencies: ['message1'] });
    assert.equal(called, false);
    assert.deepEqual(empty.dependencies, []);
    const publishedEmpty = await engine.invoke('rebuild-profile', { scope, revision: 0, operationId: 'profile-foreign', allowedRecordIds: ['seed'], publish: true, verifiedDependencies: ['message1'] });
    assert.deepEqual(publishedEmpty.dependencies, []);
});

test('profile refuses missing allowed records instead of publishing incomplete dependencies', async t => {
    const { engine, native } = await fixture(t); let calls = 0;
    native.rebuildProfile = async () => { calls++; };
    await assert.rejects(engine.invoke('rebuild-profile', { scope, revision: 0, operationId: 'missing-profile', allowedRecordIds: ['missing-record'] }), /PROFILE_INPUT/);
    assert.equal(calls, 0);
    assert.equal((await engine.invoke('operation-status', { scope, operationId: 'missing-profile' })).status, 'unknown');
});

test('older embedding snapshot cannot roll search back or revive an old proposal across restart', async t => {
    const { engine, native, root } = await fixture(t);
    await engine.invoke('propose', proposalInput());
    const newer = { ...embedding, revision: 2, spaceId: 'space2', dimensions: 3 };
    await engine.invoke('search', { ...searchInput(['record1']), embedding: newer });
    await assert.rejects(engine.invoke('search', searchInput(['record1'])), /SPACE_CONFIG_REVISION/);
    await assert.rejects(engine.invoke('commit', { scope, revision: 0, operationId: 'op1' }), /SPACE/);
    assert.equal(native.getSpace().spaceId, 'space2');
    const file = path.join(root, 'owners/1/space-config.json');
    assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), newer);
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
    const restarted = createControlledEngine({ dataRoot: root, nativeFactory: async () => fakeNative(),
        embeddingFactory: async () => ({}), runnerFactory: () => ({}) });
    t.after(() => restarted.close());
    await assert.rejects(restarted.invoke('search', searchInput(['record1'])), /SPACE_CONFIG_REVISION/);
    await restarted.invoke('search', { ...searchInput(['record1']), embedding: newer });
    assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), newer);
});

test('same revision is immutable and same space only permits a newer state revision', async t => {
    const { engine, native } = await fixture(t);
    await engine.invoke('propose', proposalInput());
    await assert.rejects(engine.invoke('search', { ...searchInput(['record1']),
        embedding: { ...embedding, state: 'DISABLED' } }), /SPACE_CONFIG_CONFLICT/);
    for (const changes of [{ dimensions: 3 }, { artifactVersion: 'artifact-2' },
        { queryPreprocessingVersion: 'qwen3-retrieval-v1' }, { normalization: 'none' }]) {
        await assert.rejects(engine.invoke('search', { ...searchInput(['record1']),
            embedding: { ...embedding, revision: 2, ...changes } }), /SPACE_CONFIG_CONFLICT/);
    }
    await engine.invoke('search', { ...searchInput(['record1']), embedding: { ...embedding, revision: 2, state: 'DISABLED' } });
    assert.equal(native.getSpace().spaceId, embedding.spaceId);
    await assert.rejects(engine.invoke('commit', { scope, revision: 0, operationId: 'op1' }), /SPACE_CONFIG_REVISION/);
});

test('space configuration serializes concurrent revisions and survives clear-owner', async t => {
    const { engine, native, root } = await fixture(t);
    await engine.invoke('propose', proposalInput());
    await engine.invoke('commit', { scope, revision: 0, operationId: 'op1' });
    const newer = { ...embedding, revision: 3, spaceId: 'space3' };
    const older = { ...embedding, revision: 2, spaceId: 'space2' };
    const entered = deferred();
    const release = deferred();
    const search = native.search.bind(native);
    let held = false;
    native.search = async input => {
        if (!held) {
            held = true;
            entered.resolve();
            await release.promise;
        }
        return search(input);
    };
    // The older revision passes configure first and stays inside retrieval.
    // The newer revision then commits. The older call must not succeed after that.
    const stale = engine.invoke('search', { ...searchInput(['record1']), embedding: older });
    await entered.promise;
    const accepted = await engine.invoke('search', { ...searchInput(['record1']), embedding: newer });
    assert.deepEqual(accepted.map(row => row.id), ['record1']);
    release.resolve();
    await assert.rejects(stale, /SPACE_CONFIG_REVISION/);
    assert.equal(native.getSpace().spaceId, 'space3');
    const unpublished = engine.invoke('search', { ...searchInput(['missing-record']), embedding: older });
    await assert.rejects(unpublished, /SPACE_CONFIG_REVISION/);
    assert.equal((await engine.invoke('clear-owner', { scope, revision: 0 })).status, 'cleared');
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'owners/1/space-config.json'), 'utf8')), newer);
    await assert.rejects(engine.invoke('search', searchInput(['record1'])), /SPACE_CONFIG_REVISION/);
    await assert.rejects(engine.invoke('propose', { ...proposalInput(), operationId: 'after-clear', revision: 1 }), /SPACE_CONFIG_REVISION/);
});

test('a newer state snapshot fences a proposal finishing after the configuration change', async t => {
    const { engine, native } = await fixture(t); const entered = deferred(), release = deferred();
    const prepare = native.prepare;
    native.prepare = async input => { entered.resolve(); await release.promise; return prepare(input); };
    const task = engine.invoke('propose', proposalInput());
    const rejected = assert.rejects(task, /SPACE_CONFIG_REVISION/);
    await entered.promise;
    await engine.invoke('search', { ...searchInput(['record1']), embedding: { ...embedding, revision: 2, state: 'DISABLED' } });
    release.resolve(); await rejected;
    assert.equal(native.records.size, 0);
    assert.equal((await engine.invoke('operation-status', { scope, operationId: 'op1' })).status, 'failed');
});

test('explicit correction stages replacement, preserves dependencies and rejects stale target', async t => {
    const { engine, native } = await fixture(t);
    await engine.invoke('propose', proposalInput()); await engine.invoke('commit', { scope, revision: 0, operationId: 'op1' });
    native.records.get('record1').version = 1;
    const input = { scope, revision: 0, operationId: 'correction1', embedding, recordId: 'record1', expectedVersion: 1, summary: 'corrected content' };
    const proposal = await engine.invoke('correct-propose', input);
    assert.equal(native.records.get('record1').content, 'synthetic content');
    assert.deepEqual(proposal.dependencies, ['message1']);
    assert.deepEqual(await engine.invoke('correct-propose', input), proposal);
    await assert.rejects(engine.invoke('correct-propose', { ...input, operationId: 'stale', expectedVersion: 2 }), /VERSION_CONFLICT/);
    await engine.invoke('commit', { scope, revision: 0, operationId: 'correction1' });
    assert.equal(native.records.has('record1'), false);
    assert.equal(native.records.get(proposal.records[0].id).content, 'corrected content');
});

test('account deletion is durable, idempotent and fences every instance including late new scopes', async t => {
    const { engine, native, root } = await fixture(t);
    await engine.invoke('propose', proposalInput());
    await engine.invoke('commit', { scope, revision: 0, operationId: 'op1' });
    const accountScope = { ownerId: '1', instanceId: '1', mode: 'COMPANION', domainId: 'account-rights', profileScopeId: 'account-rights' };
    const request = { scope: accountScope, accountDeletion: true };
    assert.equal((await engine.invoke('clear-owner', request)).status, 'cleared');
    assert.equal((await engine.invoke('clear-owner', request)).status, 'cleared');
    assert.equal(native.records.size, 0);
    assert.equal(JSON.parse(await fs.readFile(path.join(root, 'owners/1/deleted.json'), 'utf8')).status, 'cleared');
    await assert.rejects(engine.invoke('propose', { ...proposalInput(), scope: { ...scope, instanceId: '22' }, operationId: 'late' }), /OWNER_DELETED/);
});

test('account deletion closes the owner store and removes sqlite files, including a cleared retry', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-erase-'));
    const databaseFiles = ['vectors.db', 'vectors.db-wal', 'vectors.db-shm'];
    let closes = 0;
    const engine = createControlledEngine({
        dataRoot: root,
        nativeFactory: async dir => {
            const native = fakeNative();
            const held = [];
            for (const name of databaseFiles) {
                const handle = await fs.open(path.join(dir, name), 'w');
                await handle.writeFile('owner plaintext vectors');
                held.push(handle);
            }
            await fs.writeFile(path.join(dir, 'notes.bin'), 'other owner data');
            native.close = async () => {
                closes++;
                while (held.length) await held.pop().close();
            };
            return native;
        },
        embeddingFactory: async () => ({}),
        runnerFactory: () => ({}),
    });
    t.after(async () => { await engine.close(); await fs.rm(root, { recursive: true, force: true }); });
    const ownerDir = path.join(root, 'owners', '1');
    const request = { scope: { ownerId: '1', instanceId: '1', mode: 'COMPANION', domainId: 'account-rights', profileScopeId: 'account-rights' }, accountDeletion: true };
    const absent = async () => {
        for (const name of [...databaseFiles, 'notes.bin']) {
            await assert.rejects(fs.lstat(path.join(ownerDir, name)), err => err.code === 'ENOENT');
        }
    };
    const first = await engine.invoke('clear-owner', request);
    assert.equal(first.status, 'cleared');
    assert.equal(first.physicalErasure, true);
    assert.equal(closes, 1);
    await absent();
    assert.equal(JSON.parse(await fs.readFile(path.join(ownerDir, 'deleted.json'), 'utf8')).status, 'cleared');
    const second = await engine.invoke('clear-owner', request);
    assert.equal(second.status, 'cleared');
    assert.equal(second.physicalErasure, true);
    assert.equal(closes, 2);
    await absent();
    const third = await engine.invoke('clear-owner', request);
    assert.equal(third.physicalErasure, true);
    assert.equal(closes, 3);
    await absent();
    assert.equal(JSON.parse(await fs.readFile(path.join(ownerDir, 'deleted.json'), 'utf8')).status, 'cleared');
});

test('restore applies current Go allowlist before any read and keeps the gate on malformed rights', async t => {
    const { engine, native, root } = await fixture(t);
    await engine.invoke('propose', proposalInput());
    await engine.invoke('commit', { scope, revision: 0, operationId: 'op1' });
    await fs.writeFile(path.join(root, 'restore-pending.json'), JSON.stringify({ blocked: true }));
    await assert.rejects(engine.invoke('export-owner', { scope }), /RESTORE/);
    await fs.writeFile(path.join(root, 'restore-pending.json'), JSON.stringify({ version: 1, owners: { '1': { deleted: false, recordIds: [], sourceIds: [] } }, deletions: [] }));
    const result = await engine.invoke('export-owner', { scope });
    assert.equal(result.records.length, 0); assert.equal(result.sources.length, 0);
    assert.equal(result.jsonl.length, 0); assert.equal(native.records.size, 0);
    assert.equal(await fs.stat(path.join(root, 'restore-pending.json')).then(() => true, () => false), false);
    await assert.rejects(engine.invoke('commit', { scope, revision: 0, operationId: 'op1' }), /MEMORYCORE_PROPOSAL_REQUIRED/);
});

test('read-profile returns only current published profiles with complete allowed dependencies', async t => {
    const { engine } = await fixture(t);
    await engine.invoke('propose', proposalInput());
    await engine.invoke('commit', { scope, revision: 0, operationId: 'op1' });
    const request = { scope, revision: 0, operationId: 'profile-read', allowedRecordIds: ['record1'], operationToken: 'ephemeral' };
    await engine.invoke('rebuild-profile', request);
    assert.deepEqual(await engine.invoke('read-profile', request), {});
    await engine.invoke('rebuild-profile', { ...request, publish: true, verifiedDependencies: ['message1'] });
    const profile = await engine.invoke('read-profile', request);
    assert.deepEqual(profile.dependencies, ['message1']); assert.equal(profile.files['persona.md'], 'synthetic profile');
    assert.deepEqual(await engine.invoke('read-profile', { ...request, allowedRecordIds: [] }), {});
    assert.deepEqual(await engine.invoke('read-profile', { ...request, scope: { ...scope, profileScopeId: 'sibling' } }), {});
    await engine.invoke('forget', { scope, revision: 0, recordIds: ['record1'] });
    assert.deepEqual(await engine.invoke('read-profile', request), {});
});

test('Go invalidation before cleanup does not advance the engine beyond the Go fence', async t => {
    const { engine } = await fixture(t); await engine.invoke('propose', proposalInput());
    await engine.invoke('commit', { scope, revision: 0, operationId: 'op1' });
    await engine.invoke('invalidate-scope', { scope, revision: 1 });
    const result = await engine.invoke('forget', { scope, revision: 0, recordIds: ['record1'] });
    assert.equal(result.status, 'cleared'); assert.equal(result.revision, 1);
    await engine.invoke('invalidate-scope', { scope, revision: 1 });
    assert.deepEqual(await engine.invoke('scope-status', { scope }), { revision: 1 });
});

test('revoked partial commit preserves body-free receipt IDs for recovery and forget removes every live copy', async t => {
    let publish = 0;
    const { engine } = await fixture(t, { publishHook: async () => { if (++publish === 1) throw new Error('PUBLICATION_LOST'); } });
    await engine.invoke('propose', proposalInput());
    await assert.rejects(engine.invoke('commit', { scope, revision: 0, operationId: 'op1' }), /PUBLICATION_LOST/);
    await engine.invoke('invalidate-scope', { scope, revision: 1 });
    const status = await engine.invoke('operation-status', { scope, operationId: 'op1' });
    assert.equal(status.status, 'revoked');
    assert.deepEqual(status.receipt.recordIds, ['record1']);
    assert.equal(status.proposal, undefined);
    assert.equal((await engine.invoke('forget', { scope, revision: 1, revisionAdvanced: true, recordIds: status.receipt.recordIds })).status, 'cleared');
    const exported = await engine.invoke('export-owner', { scope });
    assert.deepEqual(exported.records, []); assert.deepEqual(exported.sources, []); assert.deepEqual(exported.jsonl, []);
    assert.deepEqual(exported.profiles, []); assert.deepEqual(exported.staging, {});
    assert.ok(exported.operations.every(op => !op.proposal));
});

test('forgetting trusted source dependencies removes a committed correction before Go publication', async t => {
    const { engine, native } = await fixture(t);
    await engine.invoke('propose', proposalInput());await engine.invoke('commit', { scope, revision: 0, operationId: 'op1' });
    const replacement=await engine.invoke('correct-propose',{scope,revision:0,operationId:'unpublished-correction',embedding,recordId:'record1',expectedVersion:1,summary:'corrected'});
    await engine.invoke('commit',{scope,revision:0,operationId:'unpublished-correction'});
    assert.equal(native.records.has(replacement.records[0].id),true);
    const result=await engine.invoke('forget',{scope,revision:0,recordIds:['record1'],sourceIds:['message1']});
    assert.equal(result.status,'cleared');assert.equal(native.records.size,0);assert.equal(native.listSources().length,0);
});

test('failed extraction keeps the request and the same operation can be proposed again', async t => {
    const { engine, root } = await fixture(t);
    await engine.invoke('export-owner', { scope });
    const input = { ...proposalInput(), operationId: 'retry-failed' };
    const request = { scope: input.scope, revision: input.revision, embedding: input.embedding, allowedRecordIds: input.allowedRecordIds, messages: input.messages };
    const file = path.join(root, 'owners/1/operations/retry-failed.json');
    await fs.writeFile(file, JSON.stringify({ scope, request, status: 'preparing' }));
    assert.equal((await engine.invoke('operation-status', { scope, operationId: 'retry-failed' })).status, 'failed');
    const stored = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.equal(stored.status, 'failed');
    assert.deepEqual(stored.request, request);
    const proposal = await engine.invoke('propose', input);
    assert.equal(proposal.records[0].content, 'synthetic content');
});

test('operation status marks restart-orphaned preparing and profile work failed without replay', async t => {
    const { engine, root } = await fixture(t);
    await engine.invoke('export-owner', { scope });
    for (const status of ['preparing', 'building-profile']) {
        const operationId = 'orphan-' + status;
        await fs.writeFile(path.join(root, 'owners/1/operations', operationId + '.json'), JSON.stringify({ scope, status }));
        assert.equal((await engine.invoke('operation-status', { scope, operationId })).status, 'failed');
        assert.equal(JSON.parse(await fs.readFile(path.join(root, 'owners/1/operations', operationId + '.json'), 'utf8')).status, 'failed');
    }
});

test('correction embedding failure retries the same durable request without changing live memory', async t => {
    let fail = false;
    const {engine,native}=await fixture(t,{embeddingFactory:async()=>({embedBatch:async values=>{if(fail){fail=false;throw new Error('synthetic embedding unavailable')};return values.map(()=>new Float32Array([1,0]))}})});
    await engine.invoke('propose',proposalInput());await engine.invoke('commit',{scope,revision:0,operationId:'op1'});
    const input={scope,revision:0,operationId:'retry-correct',embedding,recordId:'record1',expectedVersion:1,summary:'changed'};
    fail=true;await assert.rejects(engine.invoke('correct-propose',input),/embedding unavailable/);
    assert.equal((await engine.invoke('operation-status',input)).status,'failed');assert.equal(native.records.get('record1').content,'synthetic content');
    const proposal=await engine.invoke('correct-propose',input);assert.equal(proposal.records[0].content,'changed');
    await engine.invoke('commit',input);assert.equal(native.records.has('record1'),false);
});

test('abandoned merge cleanup preserves valid old targets while collecting only unreferenced L0', async t => {
    const { engine, native } = await fixture(t);
    await engine.invoke('propose', proposalInput());
    await engine.invoke('commit', { scope, revision: 0, operationId: 'op1' });
    native.prepare = async () => ({ records: [{ id: 'abandoned-record', content: 'never published', conflictTargetIds: ['record1'], metadata: {}, ...mapScope(scope) }], targets: [{ id: 'record1', version: 1 }] });
    await engine.invoke('propose', { ...proposalInput(), operationId: 'abandoned-merge', allowedRecordIds: ['record1'],
        messages: [{ id: 'message2', content: 'pending correction', timestamp: '2026-10-29T00:00:00Z' }] });
    await engine.invoke('invalidate-scope', { scope, revision: 1 });
    const result = await engine.invoke('forget', { scope, revision: 1, revisionAdvanced: true, recordIds: ['abandoned-record'],
        sourceIds: ['message1', 'message2'], matchSourceRecords: false });
    assert.equal(result.status, 'cleared');
    const exported = await engine.invoke('export-owner', { scope });
    assert.deepEqual(exported.records.map(r => r.id), ['record1']);
    assert.deepEqual(exported.sources.map(r => r.id || r.record_id), ['message1']);
    assert.equal(exported.jsonl.length, 1); assert.match(exported.jsonl[0].content, /synthetic content/);
});

test('correction rebases an already committed replacement after unrelated scope invalidation', async t => {
    const {engine,native}=await fixture(t);await engine.invoke('propose',proposalInput());await engine.invoke('commit',{scope,revision:0,operationId:'op1'});
    const input={scope,revision:0,operationId:'correct-old-epoch',embedding,recordId:'record1',expectedVersion:1,summary:'same explicit correction'};
    const proposal=await engine.invoke('correct-propose',input);await engine.invoke('commit',input);
    await engine.invoke('invalidate-scope',{scope,revision:1});
    const next={...input,revision:1,operationId:'correct-new-epoch',previousOperationId:input.operationId};
    const rebased=await engine.invoke('correct-propose',next);assert.equal(rebased.records[0].id,proposal.records[0].id);
    const receipt=await engine.invoke('commit',next);assert.deepEqual(receipt.recordIds,[proposal.records[0].id]);assert.equal(native.records.size,1);
    assert.equal((await engine.invoke('search',searchInput(receipt.recordIds))).length,1);
    await assert.rejects(engine.invoke('correct-propose',{...next,operationId:'different-content',summary:'untrusted changed content'}),/VERSION_CONFLICT/);
});

test('ready embedding space rebuild is idempotent without embedding I/O', async t => {
    let opens = 0;
    const { engine } = await fixture(t, { embeddingFactory: async () => { opens++; return {}; } });
    assert.equal((await engine.invoke('rebuild-space', { scope, embedding })).ready, true);
    assert.equal(opens, 1);
    assert.deepEqual(await engine.invoke('rebuild-space', { scope, embedding }), { spaceId: embedding.spaceId, failures: 0, ready: true });
    assert.equal(opens, 1, 'ready current space must not reopen embedding or rewrite vectors');
    const changed = { ...embedding, revision: 2, spaceId: 'space-next' };
    assert.equal((await engine.invoke('rebuild-space', { scope, embedding: changed })).ready, true);
    assert.equal(opens, 2, 'a changed space still executes rebuild');
});

test('cleanup of a revoked operation preserves an unrelated current epoch proposal', async t => {
    const { engine, native } = await fixture(t);
    await engine.invoke('propose', proposalInput());
    await engine.invoke('invalidate-scope', { scope, revision: 1 });
    native.prepare = async ({ messages, scope: mapped }) => ({ records: [{ id: 'current-record', content: messages[0].content, metadata: {}, ...mapped }], targets: [] });
    const current = { ...proposalInput(), operationId: 'current-op', revision: 1,
        messages: [{ id: 'current-source', content: 'current valid fact', timestamp: '2026-10-29T00:00:00Z' }] };
    await engine.invoke('propose', current);
    const cleanup = await engine.invoke('forget', { scope, revision: 1, revisionAdvanced: true,
        recordIds: ['record1'], sourceIds: ['message1'], matchSourceRecords: false });
    assert.equal(cleanup.status, 'cleared');
    assert.equal((await engine.invoke('operation-status', current)).status, 'proposed');
    await engine.invoke('commit', current);
    assert.ok(native.records.has('current-record'));
});

test('publishing a new profile retires the previous profile-published directory', async t => {
    const { engine, native, root } = await fixture(t);
    native.rebuildProfile = async ({ stagingDir }) => {
        const marker = stagingDir.endsWith('profile-old') ? 'persona-old-beijing' : 'persona-new-shanghai';
        await fs.writeFile(path.join(stagingDir, 'persona.md'), marker);
    };
    await engine.invoke('propose', proposalInput());
    await engine.invoke('commit', { scope, revision: 0, operationId: 'op1' });
    const first = { scope, revision: 0, operationId: 'profile-old', allowedRecordIds: ['record1'] };
    await engine.invoke('rebuild-profile', first);
    await engine.invoke('rebuild-profile', { ...first, publish: true, verifiedDependencies: ['message1'] });
    const second = { ...first, operationId: 'profile-new' };
    await engine.invoke('rebuild-profile', second);
    await engine.invoke('rebuild-profile', { ...second, publish: true, verifiedDependencies: ['message1'] });
    const retired = JSON.parse(await fs.readFile(path.join(root, 'owners/1/operations/profile-old.json'), 'utf8'));
    assert.equal(retired.status, 'profile-retired');
    assert.equal(JSON.stringify(retired).includes('persona-old-beijing'), false);
    await assert.rejects(fs.access(path.join(root, 'owners/1/profiles/profile-old')));
    assert.equal(await fs.readFile(path.join(root, 'owners/1/retired-profiles/profile-old/persona.md'), 'utf8'), 'persona-old-beijing');
    const published = (await engine.invoke('operation-status', { scope, operationId: 'profile-old' })).status;
    assert.notEqual(published, 'profile-published');
    const exported = JSON.stringify(await engine.invoke('export-owner', { scope }));
    assert.equal(exported.includes('persona-old-beijing'), false);
    assert.equal(exported.includes('persona-new-shanghai'), true);
    assert.equal((await engine.invoke('forget', { scope, revision: 0, recordIds: ['record1'] })).status, 'cleared');
    const afterForget = JSON.stringify(await engine.invoke('export-owner', { scope }));
    assert.equal(afterForget.includes('profile-published'), false);
    assert.equal(afterForget.includes('persona-old-beijing'), false);
    assert.equal(afterForget.includes('persona-new-shanghai'), false);
    await assert.rejects(fs.access(path.join(root, 'owners/1/retired-profiles/profile-old/persona.md')));
    await assert.rejects(fs.access(path.join(root, 'owners/1/retired-profiles/profile-new/persona.md')));
});

test('forget keeps the replacement profile operation and erases retired copies', async t => {
    const { engine, native, root } = await fixture(t);
    native.prepare = async ({ scope: mapped }) => ({ records: ['record1', 'record2'].map(id => ({ id, content: id, ...mapped })), targets: [] });
    native.rebuildProfile = async ({ stagingDir }) => {
        const marker = stagingDir.endsWith('forget-3-profile') ? 'persona-keeps-record2' : 'persona-old-badge';
        await fs.writeFile(path.join(stagingDir, 'persona.md'), marker);
    };
    await engine.invoke('propose', proposalInput());
    await engine.invoke('commit', { scope, revision: 0, operationId: 'op1' });
    const retired = { scope, revision: 0, operationId: 'profile-old', allowedRecordIds: ['record1', 'record2'] };
    await engine.invoke('rebuild-profile', retired);
    await engine.invoke('rebuild-profile', { ...retired, publish: true, verifiedDependencies: ['message1'] });
    const replacement = { scope, revision: 0, operationId: 'forget-3-profile', allowedRecordIds: ['record1', 'record2'] };
    await engine.invoke('rebuild-profile', replacement);
    assert.equal((await engine.invoke('forget', { scope, revision: 0, recordIds: ['record1'] })).status, 'cleared');
    await assert.rejects(fs.readFile(path.join(root, 'owners/1/operations/forget-3-profile.json'), 'utf8').then(text => {
        if (JSON.parse(text).status === 'revoked') throw new Error('revoked');
    }));
    await assert.rejects(fs.access(path.join(root, 'owners/1/retired-profiles/profile-old/persona.md')));
    const again = { scope, revision: 1, operationId: 'forget-3-profile', allowedRecordIds: ['record2'] };
    await engine.invoke('rebuild-profile', again);
    await engine.invoke('rebuild-profile', { ...again, publish: true, verifiedDependencies: ['message1'] });
    const published = JSON.parse(await fs.readFile(path.join(root, 'owners/1/operations/forget-3-profile.json'), 'utf8'));
    assert.equal(published.status, 'profile-published');
    assert.equal(await fs.readFile(path.join(root, 'owners/1/profiles/forget-3-profile/persona.md'), 'utf8'), 'persona-keeps-record2');
});
