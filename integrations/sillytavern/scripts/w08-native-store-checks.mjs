import assert from 'node:assert/strict';

// Called only by accept-managed's native scene: real locked upstream + SQLite,
// synthetic inputs and injected LLM/embedding. No second acceptance entrypoint.
export async function verifyNativeStore(api) {
    let checks = 0;
    const check = async fn => { await fn(); checks++; };
    const store = new api.VectorStore(':memory:', 0);
    const filter = { teamId: 'owner:1', userId: '1', agentId: 'instance:1:mode:daily',
        sessionId: 'domain:1', sessionKey: 'domain:1' };
    const time = '2026-10-28T12:00:00Z';
    const vector = value => { const v = new Float32Array(1024); v[0] = value; v[1] = Math.sqrt(1 - value * value); return v; };
    const record = (id, content = '我喜欢蓝色') => ({ id, content, type: 'persona', priority: 50,
        scene_name: '喜好', source_message_ids: ['source-1'], metadata: {}, timestamps: [time],
        createdAt: time, updatedAt: time, version: 1, ...filter });
    const input = { operationId: 'operation-1', scopeKey: 'scope-1', revision: 0, spaceId: 'space-1024',
        filter, targets: [], records: [{ record: record('inside'), embedding: vector(0.8) }] };
    const source = { id: 'source-1', ...filter, role: 'user', messageText: '合成原文', recordedAt: time, timestamp: Date.parse(time) };
    try {
        store.init();
        assert.equal(store.isDegraded(), false);
        store.configureSpace('space-1024', 1024);
        await check(() => {
            assert.equal(store.commitPrepared(input).status, 'committed');
            assert.deepEqual(store.commitPrepared(input), store.getOperation(input.operationId));
            assert.equal(store.countL1(), 1);
            assert.deepEqual(store.queryL1Records({ recordIds: [] }), []);
        });
        await check(() => assert.throws(() => store.commitPrepared({ ...input, operationId: 'cross-owner',
            records: [{ record: { ...record('cross'), teamId: 'owner:2' }, embedding: vector(1) }] }), /SCOPE/));
        await check(() => assert.throws(() => store.commitPrepared({ ...input, operationId: 'stale-target',
            targets: [{ id: 'inside', version: 0 }], records: [] }), /VERSION/));
        await check(() => {
            const original = store.stmtL1FtsInsert;
            store.stmtL1FtsInsert = { run() { throw new Error('SYNTHETIC_FTS_FAILURE'); } };
            try {
                assert.throws(() => store.commitPrepared({ ...input, operationId: 'partial',
                    records: [{ record: record('partial'), embedding: vector(1) }] }), /SYNTHETIC_FTS_FAILURE/);
                assert.equal(store.countL1(), 1);
                assert.equal(store.getOperation('partial'), null);
            } finally { store.stmtL1FtsInsert = original; }
        });
        // The direct binary gate supplies 10,000 distractors; this separately
        // verifies that the actual patched upstream methods use the predicate.
        for (let i = 0; i < 100; i++) {
            store.upsertL1({ ...record(`outside-${i}`, '蓝色 蓝色 蓝色'), teamId: 'owner:2' }, vector(1), true);
        }
        const selected = { ...filter, allowedRecordIds: ['missing-id', 'inside'] };
        await check(() => {
            assert.deepEqual(store.searchL1Vector(vector(1), 1, undefined, selected).map(x => x.record_id), ['inside']);
            assert.deepEqual(store.searchL1Vector(vector(1), 1, undefined, { ...selected, allowedRecordIds: [] }), []);
            assert.deepEqual(store.searchL1Fts(api.buildFtsQuery('蓝色'), 1, selected).map(x => x.record_id), ['inside']);
            assert.deepEqual(store.searchL1Fts(api.buildFtsQuery('蓝色'), 1, { ...selected, allowedRecordIds: [] }), []);
        });
        const embeddingService = { getProviderInfo: () => ({ provider: 'synthetic' }), embed: async () => vector(1) };
        await check(async () => {
            const result = await api.recallL1Candidates({ query: '蓝色', topK: 3, vectorStore: store, embeddingService,
                filter: { ...selected, minCosine: 0.81, minFtsScore: 1.1 } });
            assert.deepEqual(result.hits, []);
        });
        await check(async () => {
            const result = await api.recallL1Candidates({ query: '蓝色', topK: 3, vectorStore: store, embeddingService,
                filter: { ...selected, minCosine: 0.7, minFtsScore: 0 } });
            assert.equal(result.strategy, 'hybrid');
            assert.equal(result.hits.length, 1);
            assert.ok(Math.abs(result.hits[0].cosine - 0.8) < 0.00001);
            assert.ok(Number.isFinite(result.hits[0].ftsRank));
            assert.ok(Number.isFinite(result.hits[0].ftsScore));
            assert.notEqual(result.hits[0].score, result.hits[0].cosine);
        });
        await check(() => {
            assert.throws(() => store.configureSpace('space-1024', 2), /SPACE_CONFIG_CONFLICT/);
            store.configureSpace('space-2', 2);
            assert.equal(store.getSpace().rebuilding, true);
            assert.deepEqual(store.searchL1Vector(new Float32Array([1, 0]), 1, undefined, selected), []);
            assert.equal(store.searchL1Fts(api.buildFtsQuery('蓝色'), 1, selected).length, 1);
            assert.throws(() => store.commitPrepared({ ...input, operationId: 'old-space', records: [] }), /SPACE/);
            assert.throws(() => store.finishSpaceRebuild('space-2', 0), /INCOMPLETE/);
            for (const row of store.queryL1Records()) store.writeRebuiltVector(row.record_id, new Float32Array([1, 0]), 'space-2');
            assert.throws(() => store.finishSpaceRebuild('space-2', 1), /INCOMPLETE/);
            assert.equal(store.finishSpaceRebuild('space-2', 0).rebuilding, false);
            assert.equal(store.searchL1Vector(new Float32Array([1, 0]), 1, undefined, selected).length, 1);
        });
        await check(() => {
            assert.equal(store.invalidateScope('scope-1').revision, 1);
            assert.equal(store.getOperation(input.operationId).status, 'revoked');
            assert.throws(() => store.commitPrepared({ ...input, operationId: 'late', records: [] }), /STALE/);
        });
        await check(() => {
            store.upsertMemoryGenerationRefs([{ generation_ref_id: 'ref-1', layer: 'l1', memory_id: 'inside',
                generation_id: 'generation-1', generation_log_id: 'log-1', generation_log_key: 'synthetic/log-1',
                memory_prompt_id: 'prompt-1', memory_prompt_version: 1, memory_prompt_source: 'builtin', created_at_ms: Date.parse(time) }]);
            const db = store.getRawDb();
            db.prepare("INSERT INTO memory_audit(audit_id,record_id,layer,action,version,updated_at_ms) VALUES('audit-1','inside','L1','update',1,0)").run();
            store.forgetRecords(['inside'], filter);
            for (const table of ['l1_records', 'l1_vec', 'l1_fts']) {
                assert.equal(db.prepare(`SELECT count(*) n FROM ${table} WHERE record_id='inside'`).get().n, 0);
            }
            assert.equal(db.prepare("SELECT count(*) n FROM memory_generation_refs WHERE memory_id='inside'").get().n, 0);
            assert.equal(db.prepare("SELECT count(*) n FROM memory_audit WHERE record_id='inside'").get().n, 0);
        });
        const preparedInputs = { messages: [{ id: source.id, role: 'user',
            content: '请记住，我最喜欢的颜色是蓝色，蓝色让我觉得很舒服。', timestamp: source.timestamp }],
            ...filter, baseDir: '/unused-synthetic', config: {}, options: { prepareOnly: true, allowedRecordIds: [],
                recordedAt: time, vectorStore: store, llmRunner: { run: async () => JSON.stringify([{ scene_name: '喜好',
                    message_ids: [source.id], memories: [{ content: '我最喜欢蓝色', type: 'persona', priority: 50,
                        source_message_ids: [source.id], metadata: {} }] }]) } } };
        await check(async () => {
            const count = store.countL1();
            const result = await api.extractL1Memories(preparedInputs);
            assert.equal(result.proposal.records.length, 1);
            assert.equal(store.countL1(), count);
            assert.equal(result.proposal.records[0].createdAt, time);
            await assert.rejects(api.extractL1Memories({ ...preparedInputs, options: { ...preparedInputs.options,
                llmRunner: { run: async () => '{bad json' } } }), /INVALID/);
            await assert.rejects(api.extractL1Memories({ ...preparedInputs, options: { ...preparedInputs.options,
                llmRunner: { run: async () => { throw new Error('SYNTHETIC_TIMEOUT'); } } } }), /SYNTHETIC_TIMEOUT/);
            assert.equal(store.countL1(), count);
        });
        const sourceInput = { ...input, revision: 1, spaceId: 'space-2', records: [], l0Records: [source] };
        await check(() => {
            store.commitPrepared({ ...sourceInput, operationId: 'l0-commit' });
            assert.throws(() => store.commitPrepared({ ...sourceInput, operationId: 'l0-changed',
                l0Records: [{ ...source, messageText: '变更原文' }] }), /SOURCE/);
            const original = store.stmtL0FtsInsert;
            store.stmtL0FtsInsert = { run() { throw new Error('SYNTHETIC_L0_FAILURE'); } };
            try {
                assert.throws(() => store.commitPrepared({ ...sourceInput, operationId: 'l0-partial',
                    l0Records: [{ ...source, id: 'source-2' }] }), /SYNTHETIC_L0_FAILURE/);
                assert.equal(store.getRawDb().prepare('SELECT count(*) n FROM l0_conversations').get().n, 1);
                assert.equal(store.getOperation('l0-partial'), null);
            } finally { store.stmtL0FtsInsert = original; }
            store.forgetSources([source.id], filter);
            for (const table of ['l0_conversations', 'l0_fts', 'l0_vec']) {
                assert.equal(store.getRawDb().prepare(`SELECT count(*) n FROM ${table}`).get().n, 0);
            }
        });
        return checks;
    } finally { store.close(); }
}
