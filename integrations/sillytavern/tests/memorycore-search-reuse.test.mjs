import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createNativeFactory } from '../memorycore-service/native-engine.mjs';
import { createControlledEngine, mapScope } from '../memorycore-service/business.mjs';

const scope = { ownerId: '1', instanceId: '7', mode: 'COMPANION', domainId: 'daily-7', profileScopeId: 'main' };
const snapshot = { spaceId: 'space1', dimensions: 2, revision: 1, state: 'ENABLED' };
const embedding = { spaceId: 'space1', snapshot, embed: async () => new Float32Array([1, 0]), embedQuery: async () => new Float32Array([1, 0]) };
const input = () => ({ query: '我喜欢什么颜色', topK: 5, scope: mapScope(scope), allowedRecordIds: ['r1'],
    embedding, observe: true, rerank: false, reuseInput: JSON.stringify({ scope, revision: 0, embedding: snapshot }),
    gateTexts: [{ id: 'persona', text: '用户喜欢蓝色。' }] });

async function fixture() {
    const state = { calls: 0, scopeChecks: 0, configures: 0, revision: 0, space: { spaceId: 'space1', dimensions: 2, rebuilding: false },
        rows: [{ record_id: 'r1', content: '用户喜欢蓝色。', metadata_json: JSON.stringify({ vcDependencies: ['source1'] }), ...mapScope(scope) }],
        sources: [{ id: 'source1' }], failWrite: false, recall: undefined };
    const factory = await createNativeFactory({
        VectorStore: class {
            async init() {}
            getRawDb() { return { exec() {}, prepare: () => ({ all: () => state.sources, get: () => ({ busy: 0 }) }) }; }
            getScope() { state.scopeChecks++; return { revision: state.revision }; }
            getSpace() { return { ...state.space }; }
            configureSpace(spaceId, dimensions) {
                state.configures++;
                if (state.space.spaceId !== spaceId) state.space = { spaceId, dimensions, rebuilding: true };
            }
            queryL1Records({ recordIds } = {}) { return state.rows.filter(row => !recordIds || recordIds.includes(row.record_id)); }
            commitPrepared(proposal) {
                if (state.failWrite) throw new Error('synthetic write failure');
                for (const target of proposal.targets || []) state.rows = state.rows.filter(row => row.record_id !== target.id);
                state.rows.push(...(proposal.rows || []));
            }
            invalidateScope() { state.revision++; }
            forgetRecords(ids) { state.rows = state.rows.filter(row => !ids.includes(row.record_id)); }
            forgetSources(ids) { state.sources = state.sources.filter(row => !ids.includes(row.id)); }
            writeRebuiltVector() {}
            finishSpaceRebuild() { state.space.rebuilding = false; }
            close() {}
        },
        async recallL1Candidates(params) {
            state.calls++;
            if (state.recall) return state.recall(params);
            return { hits: state.rows.filter(row => params.filter.allowedRecordIds.includes(row.record_id))
                .map(row => ({ record_id: row.record_id, content: row.content, score: 0.9, cosine: 0.9 })) };
        },
    });
    return { state, factory, native: await factory('/synthetic-unused') };
}

test('observed duplicate search reuses independent results and emits only current execution stats', async () => {
    const { native, state } = await fixture();
    const first = await native.search(input());
    assert.equal(first.stats.searchReuseHit, 0);
    assert.equal(first.stats.profileGateAllow, 1);
    first.hits[0].content = 'caller mutation';
    first.gated.push('caller mutation');
    first.stats.originalGateMs = 999;
    const second = await native.search(input());
    assert.equal(state.calls, 1);
    assert.equal(second.hits[0].content, '用户喜欢蓝色。');
    assert.deepEqual(second.gated, ['persona']);
    for (const [name, value] of Object.entries(second.stats)) {
        assert.equal(value, name === 'searchReuseHit' ? 1 : name === 'rerankDecision' ? 'disabled' : 0, name);
    }
    second.hits.length = 0;
    assert.equal((await native.search(input())).hits.length, 1);
});

test('only observed searches with an internal business snapshot are reused', async () => {
    for (const change of [{ observe: false }, { reuseInput: undefined }]) {
        const { native, state } = await fixture();
        await native.search({ ...input(), ...change });
        await native.search({ ...input(), ...change });
        assert.equal(state.calls, 2);
    }
});

test('trusted parameters, actual eligible IDs, embeddings and effective rerank configuration are key inputs', async () => {
    const changes = [
        { query: '我喜欢哪种颜色' }, { topK: 1 }, { scope: { ...mapScope(scope), sessionId: 'other' } },
        { allowedRecordIds: ['r1', 'r2'] }, { dateRestricted: true }, { eventDate: '2026-11-07' },
        { gateTexts: [{ id: 'persona', text: '用户喜欢红色。' }] }, { cacheOwnerId: '2' }, { cacheScope: 'other' },
        { reuseInput: JSON.stringify({ scope, revision: 1, embedding: snapshot }) }, { embedding: undefined },
        { embedding: { ...embedding, snapshot: { ...snapshot, revision: 2 } } },
    ];
    for (const change of changes) {
        const { native } = await fixture();
        await native.search(input());
        assert.equal((await native.search({ ...input(), ...change })).stats.searchReuseHit, 0, JSON.stringify(change));
    }
});

test('rerank result metadata survives reuse without reporting another rerank or gate execution', async t => {
    const previous = process.env.VC_RERANK_ENABLED;
    process.env.VC_RERANK_ENABLED = '1';
    t.after(() => { if (previous === undefined) delete process.env.VC_RERANK_ENABLED; else process.env.VC_RERANK_ENABLED = previous; });
    const { native } = await fixture();
    let ranked = 0;
    const rerank = { threshold: 0, rank: async (_query, docs) => { ranked++; return docs.map(() => 1); } };
    const first = await native.search({ ...input(), rerank });
    assert.equal(first.stats.rerankDecision, 'applied');
    const count = ranked;
    const second = await native.search({ ...input(), rerank });
    assert.equal(ranked, count);
    assert.deepEqual(second.rerankRank, first.rerankRank);
    assert.deepEqual(second.rerankOriginal, first.rerankOriginal);
    assert.equal(second.stats.searchReuseHit, 1);
    assert.equal(second.stats.rerankDecision, 'disabled');
    assert.equal(second.stats.rerankCandidates, 0);
    assert.equal(second.stats.profileGateAllow, 0);
    for (const change of [{ threshold: 2 }, { candidateLimit: 10 }, { summaryUnit: 'whole' }, { rank: async (_q, docs) => docs.map(() => 1) }]) {
        await native.search({ ...input(), rerank });
        assert.equal((await native.search({ ...input(), rerank: { ...rerank, ...change } })).stats.searchReuseHit, 0);
    }
});

test('fixed TTL does not slide and one result cannot retain an unbounded key or payload', async t => {
    let now = 0;
    t.mock.method(performance, 'now', () => now);
    const { native, state } = await fixture();
    await native.search(input());
    now = 9000;
    assert.equal((await native.search(input())).stats.searchReuseHit, 1);
    now = 10001;
    assert.equal((await native.search(input())).stats.searchReuseHit, 0);
    assert.equal(state.calls, 2);
    const huge = { ...input(), reuseInput: 'x'.repeat(256 * 1024 + 1) };
    await native.search(huge);
    assert.equal((await native.search(huge)).stats.searchReuseHit, 0);
    state.rows[0].content = 'x'.repeat(256 * 1024 + 1);
    native.invalidateScope('scope');
    await native.search(input());
    assert.equal((await native.search(input())).stats.searchReuseHit, 0);
    // A different query replaces the single slot.
    state.rows[0].content = '用户喜欢蓝色。';
    await native.search(input());
    await native.search({ ...input(), query: '我有什么偏好' });
    assert.equal((await native.search(input())).stats.searchReuseHit, 0);
});

test('all native mutations invalidate before execution, while unchanged configure preserves reuse', async () => {
    const changes = [
        native => native.commitPrepared({}), native => native.forgetRecords([]), native => native.forgetSources([]),
        native => native.invalidateScope('scope'), native => native.rebuildVector({ id: 'r1' }, new Float32Array([1, 0]), 'space1'),
        native => native.finishSpaceRebuild('space1', 0), native => native.configureSpace('space2', 2),
    ];
    for (const change of changes) {
        const { native } = await fixture();
        await native.search(input());
        native.configureSpace('space1', 2);
        assert.equal((await native.search(input())).stats.searchReuseHit, 1);
        change(native);
        assert.equal((await native.search(input())).stats.searchReuseHit, 0);
    }
    const { native, state } = await fixture();
    await native.search(input());
    state.failWrite = true;
    assert.throws(() => native.commitPrepared({}), /synthetic write failure/);
    assert.equal((await native.search(input())).stats.searchReuseHit, 0, 'failed writes never restore the old slot');
});

test('correction and forget cannot return cached record content', async () => {
    const { native } = await fixture();
    await native.search(input());
    native.commitPrepared({ targets: [{ id: 'r1' }], rows: [{ record_id: 'r1', content: '用户喜欢红色。' }] });
    assert.equal((await native.search(input())).hits[0].content, '用户喜欢红色。');
    native.forgetRecords(['r1']);
    const empty = await native.search(input());
    assert.deepEqual(empty.hits, []);
    assert.equal(empty.stats.recallEmpty, 1);
    const reused = await native.search(input());
    assert.equal(reused.stats.searchReuseHit, 1);
    assert.equal(reused.stats.recallEmpty, 1);
});

test('mutation during a slow search prevents late completion from repopulating reuse', async () => {
    const { native, state } = await fixture();
    let release, started;
    const waiting = new Promise(resolve => { started = resolve; });
    state.recall = async () => { started(); return new Promise(resolve => { release = resolve; }); };
    const pending = native.search(input());
    await waiting;
    native.forgetRecords(['r1']);
    release({ hits: [{ record_id: 'r1', content: 'old content', score: 0.9 }] });
    await pending;
    state.recall = undefined;
    const next = await native.search(input());
    assert.equal(next.stats.searchReuseHit, 0);
    assert.deepEqual(next.hits, []);
});

test('failed search and rebuilding results are not reused after recovery', async () => {
    const { native, state } = await fixture();
    await native.search(input());
    state.recall = async () => { throw new Error('synthetic recall failure'); };
    await assert.rejects(native.search({ ...input(), query: 'different' }), /synthetic recall failure/);
    state.recall = undefined;
    assert.equal((await native.search(input())).stats.searchReuseHit, 0);
    native.configureSpace('space2', 2);
    await native.search({ ...input(), embedding: undefined });
    assert.equal((await native.search({ ...input(), embedding: undefined })).stats.searchReuseHit, 0);
    native.finishSpaceRebuild('space2', 0);
    assert.equal((await native.search(input())).stats.searchReuseHit, 0);
    assert.equal((await native.search(input())).stats.searchReuseHit, 1);
});

test('rerank and summary/profile fallback results are recomputed after recovery', async t => {
    const previous = process.env.VC_RERANK_ENABLED;
    process.env.VC_RERANK_ENABLED = '1';
    t.after(() => { if (previous === undefined) delete process.env.VC_RERANK_ENABLED; else process.env.VC_RERANK_ENABLED = previous; });
    for (const failure of ['rank', 'gate']) {
        const { native } = await fixture();
        let fail = true, calls = 0;
        const rerank = { threshold: 0, rank: async (_query, docs) => {
            calls++;
            if (fail && (failure === 'rank' || calls === 2)) throw new Error('synthetic rank failure');
            return docs.map(() => 1);
        } };
        const first = await native.search({ ...input(), rerank });
        assert.equal(first.stats[failure === 'rank' ? 'rerankFallback' : 'rerankGateFallback'], 1);
        fail = false;
        const recovered = await native.search({ ...input(), rerank });
        assert.equal(recovered.stats.searchReuseHit, 0);
        assert.equal(recovered.stats.rerankDecision, 'applied');
        assert.equal((await native.search({ ...input(), rerank })).stats.searchReuseHit, 1);
    }
});

test('native instances and reopened engines never share a search result', async () => {
    const { native, factory, state } = await fixture();
    await native.search(input());
    const other = await factory('/synthetic-other-owner');
    assert.equal((await other.search(input())).stats.searchReuseHit, 0);
    native.close();
    const reopened = await factory('/synthetic-unused');
    assert.equal((await reopened.search(input())).stats.searchReuseHit, 0);
    assert.equal(state.calls, 3);
});

async function businessFixture(t, recordIds = ['r1']) {
    const context = await fixture();
    context.state.rows = recordIds.map(record_id => ({ ...context.state.rows[0], record_id }));
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-search-reuse-'));
    const dir = path.join(root, 'owners', '1');
    const operation = path.join(dir, 'operations', 'published.json');
    await fs.mkdir(path.dirname(operation), { recursive: true });
    const publish = async status => fs.writeFile(operation, JSON.stringify({ scope, status, receipt: { recordIds },
        proposal: { records: recordIds.map(id => ({ id, metadata: { vcDependencies: ['source1'] } })) } }));
    await publish('published');
    let embeddings = 0, searches = 0;
    const nativeSearch = context.native.search;
    context.native.search = async request => {
        searches++;
        const result = await nativeSearch(request);
        if (context.afterSearch) await context.afterSearch();
        return result;
    };
    const engine = createControlledEngine({ dataRoot: root, nativeFactory: async () => context.native,
        embeddingFactory: async () => { embeddings++; return embedding; }, runnerFactory: () => ({}) });
    t.after(async () => { await engine.close(); await fs.rm(root, { recursive: true, force: true }); });
    return { ...context, context, root, dir, publish, engine, counts: () => ({ embeddings, searches }),
        request: { scope, embedding: snapshot, query: input().query, topK: 5, allowedRecordIds: ['r1'], gateTexts: input().gateTexts, observe: true, rerankEnabled: false } };
}

test('two business requests retain two pre/post checks but execute native retrieval once', async t => {
    const { engine, state, request, counts } = await businessFixture(t);
    assert.equal((await engine.invoke('search', request)).stats.searchReuseHit, 0);
    assert.equal((await engine.invoke('search', request)).stats.searchReuseHit, 1);
    assert.equal(state.calls, 1);
    assert.equal(state.scopeChecks, 4, 'scope revision checked before and after both requests');
    assert.equal(state.configures, 2, 'space setup is still validated on both requests');
    assert.deepEqual(counts(), { embeddings: 2, searches: 2 });
});

test('business reuses a permuted allowed set without reordering retrieval or accepting changed membership', async t => {
    const { engine, state, request } = await businessFixture(t, ['r1', 'r2']);
    const seen = [];
    state.recall = ({ filter }) => {
        seen.push([...filter.allowedRecordIds]);
        return { hits: state.rows.filter(row => filter.allowedRecordIds.includes(row.record_id))
            .map(row => ({ record_id: row.record_id, content: row.content, score: 0.9, cosine: 0.9 })) };
    };
    const firstIds = ['r2', 'r1'];
    const first = await engine.invoke('search', { ...request, allowedRecordIds: firstIds });
    const second = await engine.invoke('search', { ...request, allowedRecordIds: ['r1', 'r2'] });
    assert.equal(second.stats.searchReuseHit, 1);
    assert.deepEqual(second.hits, first.hits);
    assert.deepEqual(firstIds, ['r2', 'r1']);
    assert.deepEqual(seen, [['r2', 'r1']], 'only the cache key may normalize the unordered set');
    assert.equal(state.scopeChecks, 4, 'both HTTP requests still check current scope before and after search');
    assert.equal(state.configures, 2);
    const narrowed = await engine.invoke('search', { ...request, allowedRecordIds: ['r2'] });
    assert.equal(narrowed.stats.searchReuseHit, 0);
    assert.deepEqual(narrowed.hits.map(row => row.record_id), ['r2']);
    assert.deepEqual(seen, [['r2', 'r1'], ['r2']]);
});

test('business checks current publication, cleanup and space configuration on every repeat', async t => {
    const { engine, request, publish, dir } = await businessFixture(t);
    await engine.invoke('search', request);
    await publish('revoked');
    const unpublished = await engine.invoke('search', request);
    assert.deepEqual(unpublished.hits, []);
    assert.equal(unpublished.stats.searchReuseHit, 0);
    await publish('published');
    await engine.invoke('search', request);
    await fs.writeFile(path.join(dir, 'cleanup.json'), '{}');
    assert.deepEqual(await engine.invoke('search', request), []);
    await fs.rm(path.join(dir, 'cleanup.json'));
    await assert.rejects(engine.invoke('search', { ...request, embedding: { ...snapshot, dimensions: 3 } }), /SPACE_CONFIG_CONFLICT/);
});

test('business still rejects revoked, cleanup-pending and obsolete-space results after a reuse hit', async t => {
    for (const change of ['revision', 'cleanup', 'space']) {
        await t.test(change, async t => {
            const { engine, native, request, context, dir, state } = await businessFixture(t);
            await engine.invoke('search', request);
            context.afterSearch = async () => {
                if (change === 'revision') native.invalidateScope('scope');
                if (change === 'cleanup') await fs.writeFile(path.join(dir, 'cleanup.json'), '{}');
                if (change === 'space') await fs.writeFile(path.join(dir, 'space-config.json'), JSON.stringify({ ...snapshot, revision: 2 }));
            };
            if (change === 'space') await assert.rejects(engine.invoke('search', request), /SPACE_CONFIG_REVISION/);
            else assert.deepEqual(await engine.invoke('search', request), []);
            assert.equal(state.calls, 1, 'the post-check rejects even a computation-reuse hit');
        });
    }
});

test('ready restore reconciliation invalidates a warmed native result before subsequent search', async t => {
    const { engine, native, request, root } = await businessFixture(t);
    await engine.invoke('search', request);
    await fs.writeFile(path.join(root, 'restore-pending.json'), JSON.stringify({ version: 1, owners: { '1': { recordIds: [], sourceIds: [] } }, deletions: [] }));
    await engine.ready();
    // This directly proves ready() invalidated the native slot, independently
    // of the business layer's separate published-operation filter.
    const next = await native.search({ ...input(), reuseInput: JSON.stringify({ scope, revision: 0, embedding: snapshot }),
        cacheOwnerId: scope.ownerId, cacheScope: '7:COMPANION:daily-7:main' });
    assert.equal(next.stats.searchReuseHit, 0);
    assert.deepEqual(next.hits, []);
    assert.deepEqual((await engine.invoke('search', request)).hits, []);
});
