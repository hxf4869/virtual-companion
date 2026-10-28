import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createControlledEngine, mapScope } from '../memorycore-service/business.mjs';

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
test('trusted identity maps logical memory domain, never real chat', () => {
    const s = mapScope(scope); assert.equal(s.teamId, 'owner:1'); assert.equal(s.agentId, 'instance:7:mode:COMPANION');
    assert.equal(s.sessionId, s.sessionKey); assert.equal(s.sessionId, 'daily-7');
    assert.throws(() => mapScope({ ...scope, ownerId: '../bad' }));
    assert.throws(() => mapScope({ ...scope, mode: 'DAILY' }));
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
test('replacement scrubs superseded JSONL and proposal and exports published profiles without capability', async t => {
    const { engine, native, root } = await fixture(t);
    await engine.invoke('propose', proposalInput()); await engine.invoke('commit', { scope, revision: 0, operationId: 'op1' });
    const profile = { scope, revision: 0, operationId: 'profile1', allowedRecordIds: ['record1'] };
    await engine.invoke('rebuild-profile', profile); await engine.invoke('rebuild-profile', { ...profile, publish: true, verifiedDependencies: ['message1'] });
    const exported = await engine.invoke('export-owner', { scope });
    assert.equal(exported.profiles[0].files['persona.md'], 'synthetic profile'); assert.equal(exported.sources.length, 1);
    assert.equal(JSON.stringify(exported).includes('ephemeral'), false);
    native.prepare = async ({ scope: mapped }) => ({ records: [{ id:'record2', content:'corrected content', ...mapped }], targets:[{id:'record1',version:1}] });
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
    const newer = { ...embedding, revision: 3, spaceId: 'space3' };
    const [accepted, stale] = await Promise.allSettled([
        engine.invoke('search', { ...searchInput(['record1']), embedding: newer }),
        engine.invoke('search', { ...searchInput(['record1']), embedding: { ...embedding, revision: 2, spaceId: 'space2' } }),
    ]);
    assert.equal(accepted.status, 'fulfilled'); assert.equal(stale.status, 'rejected');
    assert.match(stale.reason.message, /SPACE_CONFIG_REVISION/);
    assert.equal(native.getSpace().spaceId, 'space3');
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
