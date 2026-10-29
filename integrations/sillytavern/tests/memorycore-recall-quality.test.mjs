import test from 'node:test';
import assert from 'node:assert/strict';

function unit(x, y) {
    const norm = Math.hypot(x, y) || 1;
    return new Float32Array([x / norm, y / norm]);
}

test('keyword overlap keeps a paraphrase at the existing cosine floor when both lanes were rejected', async () => {
    const { createNativeFactory, RELEVANCE } = await import('../memorycore-service/native-engine.mjs');
    assert.equal(RELEVANCE.minCosine, 0.58);
    assert.equal(RELEVANCE.minFtsScore, 0.80);
    assert.equal(RELEVANCE.cosineFloor, 0.50);
    const records = [
        { record_id: 'bike', content: '我把折叠自行车锁在地铁站B口的共享车位。', metadata_json: '{}' },
        { record_id: 'clinic', content: '2026年12月18日我预约了中医推拿。', metadata_json: '{}' },
    ];
    const native = await (await createNativeFactory({
        VectorStore: class {
            async init() {}
            queryL1Records(filter) {
                const ids = filter?.recordIds;
                return ids ? records.filter((row) => ids.includes(row.record_id)) : records;
            }
        },
        async recallL1Candidates() { return { hits: [] }; },
    }))('/synthetic-unused');
    const embedding = {
        embedQuery: async (text) => (text.includes('折叠') && text.includes('地铁') && !text.includes('喝') ? unit(1, 0) : unit(0, 1)),
        embed: async (text) => (text.includes('折叠自行车') ? unit(0.52, Math.sqrt(1 - 0.52 * 0.52)) : unit(0, 1)),
    };
    const hits = await native.search({ query: '折叠车通常停在地铁哪个口？', topK: 5, scope: {}, allowedRecordIds: ['bike', 'clinic'], embedding });
    assert.ok(hits.some((hit) => hit.record_id === 'bike'), 'distinctive overlap is a second path, not a lower cosine accept');
    assert.equal(hits.some((hit) => hit.record_id === 'clinic'), false);
});

test('a diluted question keeps the clause whose overlap clears the same cosine floor', async () => {
    const { createNativeFactory } = await import('../memorycore-service/native-engine.mjs');
    const records = [
        { record_id: 'bike', content: '我把折叠自行车锁在地铁站B口的共享车位。', metadata_json: '{}' },
        { record_id: 'flute', content: '我从去年开始学陶笛，每周三晚上练习。', metadata_json: '{}' },
    ];
    const native = await (await createNativeFactory({
        VectorStore: class {
            async init() {}
            queryL1Records() { return records; }
        },
        async recallL1Candidates() { return { hits: [] }; },
    }))('/synthetic-unused');
    const embedding = {
        embedQuery: async (text) => (text.includes('折叠') && text.includes('地铁') && !text.includes('喝') ? unit(1, 0) : unit(0, 1)),
        embed: async (text) => (text.includes('折叠自行车') ? unit(0.55, Math.sqrt(1 - 0.55 * 0.55)) : unit(0, 1)),
    };
    const hits = await native.search({ query: '折叠车停在地铁口，今晚喝什么', topK: 5, scope: {}, allowedRecordIds: ['bike', 'flute'], embedding });
    assert.deepEqual(hits.map((hit) => hit.record_id), ['bike']);
});

test('one shared bigram and an omitted record stay out of the keyword path', async () => {
    const { createNativeFactory } = await import('../memorycore-service/native-engine.mjs');
    const records = [
        { record_id: 'coworker-cat', content: '同事阿宁的猫叫雪球。', metadata_json: '{}' },
        { record_id: 'hamster', content: '我曾经养过一只叫团子的仓鼠。', metadata_json: '{}' },
    ];
    const native = await (await createNativeFactory({
        VectorStore: class {
            async init() {}
            queryL1Records(filter) {
                const ids = filter?.recordIds;
                return ids ? records.filter((row) => ids.includes(row.record_id)) : records;
            }
        },
        async recallL1Candidates() { return { hits: [] }; },
    }))('/synthetic-unused');
    const embedding = {
        embedQuery: async () => unit(1, 0),
        embed: async () => unit(0.9, Math.sqrt(1 - 0.81)),
    };
    const ownCat = await native.search({ query: '我自己养的猫叫什么？', topK: 5, scope: {}, allowedRecordIds: ['coworker-cat'], embedding });
    assert.deepEqual(ownCat, []);
    const forgotten = await native.search({ query: '团子是什么动物？', topK: 5, scope: {}, allowedRecordIds: [], embedding });
    assert.deepEqual(forgotten, []);
});

test('prepare keeps an empty-publication disposition without record text', async () => {
    const { createNativeFactory } = await import('../memorycore-service/native-engine.mjs');
    const native = await (await createNativeFactory({
        VectorStore: class {
            async init() {}
            getSpace() { return { rebuilding: false }; }
        },
        async extractL1Memories() {
            return { success: true, emptyDisposition: 'NO_NEW_FACT', proposal: { records: [], targets: [] } };
        },
    }))('/synthetic-unused');
    const proposal = await native.prepare({
        messages: [{ id: 'm', content: 'secret dialogue', timestamp: '2026-10-20T12:00:00Z' }],
        scope: { teamId: 'owner:1' }, allowedRecordIds: [], runner: {}, embedding: { embed: async () => new Float32Array([1, 0]) },
        recordedAt: '2026-10-20T12:00:00Z',
    });
    assert.equal(proposal.emptyDisposition, 'NO_NEW_FACT');
    assert.deepEqual(proposal.records, []);
    assert.equal(JSON.stringify(proposal).includes('secret'), false);
});

test('observed search counts gate outcomes, cache traffic and empty recall without text', async () => {
    const { createNativeFactory } = await import('../memorycore-service/native-engine.mjs');
    const { embeddingCacheStats } = await import('../memorycore-service/embedding.mjs');
    const before = embeddingCacheStats();
    const native = await (await createNativeFactory({
        VectorStore: class {
            async init() {}
            queryL1Records() { return [{ record_id: 'bike', content: '折叠自行车', metadata_json: '{}' }]; }
        },
        async recallL1Candidates() { return { hits: [] }; },
    }))('/synthetic-unused');
    const embedding = {
        embedQuery: async () => unit(1, 0),
        embed: async () => unit(0, 1),
        embedBatch: async (texts) => texts.map(() => unit(0, 1)),
    };
    const result = await native.search({
        query: '我每天喝多少毫升水？', topK: 5, scope: {}, allowedRecordIds: ['bike'], embedding, observe: true,
        gateTexts: [{ id: 'persona', text: '合成画像不含饮水事实。' }, { id: 'summary-1', text: '合成摘要不含饮水事实。' }],
    });
    assert.equal(result.stats.recallEmpty, 1);
    assert.equal(result.stats.profileGateReject, 1);
    assert.equal(result.stats.summaryGateReject, 1);
    assert.equal(result.stats.profileGateAllow + result.stats.summaryGateAllow, 0);
    assert.equal(typeof result.stats.embeddingCacheHit, 'number');
    assert.equal(typeof result.stats.embeddingCacheMiss, 'number');
    const after = embeddingCacheStats();
    assert.ok(after.hits + after.misses >= before.hits + before.misses);
    assert.equal(JSON.stringify(result).includes('饮水'), false);
    assert.equal(JSON.stringify(result).includes('折叠'), false);
});
