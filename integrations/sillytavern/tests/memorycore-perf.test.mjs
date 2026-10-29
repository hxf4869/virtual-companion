import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeFactory } from '../memorycore-service/native-engine.mjs';

async function engine(recall, { queryL1Records } = {}) {
    return (await createNativeFactory({
        VectorStore: class {
            async init() {}
            queryL1Records(filter) {
                if (queryL1Records) return queryL1Records(filter);
                return [];
            }
        },
        async recallL1Candidates(input) { return recall(input); },
    }))('/synthetic-unused');
}

const embeddingSnapshot = {
    provider: 'OLLAMA', endpoint: 'http://127.0.0.1:11438', model: 'qwen3-embedding:0.6b',
    artifactVersion: 'sha256:perf-fixture', dimensions: 2, queryPreprocessingVersion: 'identity-v1',
    documentPreprocessingVersion: 'identity-v1', normalization: 'none', state: 'ENABLED', revision: 1, spaceId: 'space-perf',
};

test('rerank logits are cached by the raw model, query and document text', async () => {
    const { createRerankClient, resetRerankCache, rerankCacheStats, rerankScoreKey, RERANK_CACHE_TTL_MS, RERANK_CACHE_LIMIT } = await import('../memorycore-service/rerank.mjs');
    resetRerankCache();
    const ownerKey = rerankScoreKey('bge-m3', '问句', '文档', '101', '7:COMPANION:daily-7:main');
    assert.equal(ownerKey, ['bge-m3', '101', '7:COMPANION:daily-7:main', '问句', '文档'].join('\0'));
    assert.equal(ownerKey.includes('文档'), true);
    assert.notEqual(rerankScoreKey('bge-m3', '问句', '文档', '101', '7:COMPANION:daily-7:main'), rerankScoreKey('bge-m3', '问句', '文档', '102', '7:COMPANION:daily-7:main'));
    assert.equal(RERANK_CACHE_TTL_MS, 60_000);
    assert.equal(RERANK_CACHE_LIMIT >= 64 && RERANK_CACHE_LIMIT <= 1024, true);
    let calls = 0;
    let clock = 1_000;
    const seenDocs = [];
    const client = createRerankClient({
        endpoint: 'http://127.0.0.1:9',
        now: () => clock,
        fetchImpl: async (_url, init) => {
            calls += 1;
            const body = JSON.parse(init.body);
            seenDocs.push(body.documents);
            return Response.json({
                results: body.documents.map((text, index) => ({ index, relevance_score: text.length + index / 10 })),
            });
        },
    });
    const first = await client.rank('问句', ['甲', '乙']);
    assert.equal(calls, 1);
    const second = await client.rank('问句', ['甲', '乙']);
    assert.equal(calls, 1, '相同模型、查询和文档在 TTL 内必须命中缓存');
    assert.deepEqual(second, first);
    const partial = await client.rank('问句', ['乙', '丙']);
    assert.equal(calls, 2);
    assert.deepEqual(seenDocs[1], ['丙']);
    assert.equal(partial[0], first[1]);
    const stats = rerankCacheStats();
    assert.equal(stats.hits, 3);
    assert.equal(stats.misses, 3);
    clock += RERANK_CACHE_TTL_MS;
    await client.rank('问句', ['甲']);
    assert.equal(calls, 3, '超过 TTL 后必须重新打分');
    await client.rank('另一问', ['丙']);
    assert.equal(calls, 4);
});

test('rerank cache shares one in-flight score and stores it at completion', async () => {
    const { createRerankClient, resetRerankCache, RERANK_CACHE_TTL_MS } = await import('../memorycore-service/rerank.mjs');
    resetRerankCache();
    let clock = 1_000;
    let calls = 0;
    let release = () => {};
    const gate = new Promise((resolve) => { release = resolve; });
    const client = createRerankClient({
        endpoint: 'http://127.0.0.1:9',
        now: () => clock,
        fetchImpl: async (_url, init) => {
            calls += 1;
            const body = JSON.parse(init.body);
            if (body.documents[0] === '慢') clock += 5_000;
            await gate;
            return Response.json({ results: body.documents.map((_text, index) => ({ index, relevance_score: 0.5 })) });
        },
    });
    const first = client.rank('问句', ['慢']);
    const second = client.rank('问句', ['慢']);
    assert.equal(calls, 1);
    release();
    assert.deepEqual(await first, [0.5]);
    assert.deepEqual(await second, [0.5]);
    clock = 1_000 + RERANK_CACHE_TTL_MS;
    await client.rank('问句', ['慢']);
    assert.equal(calls, 1, '完成时刻写入后，开始时刻加 TTL 仍应命中');
});

test('rerank cache drops expired entries before they consume a slot', async () => {
    const { createRerankClient, resetRerankCache, RERANK_CACHE_TTL_MS, RERANK_CACHE_LIMIT } = await import('../memorycore-service/rerank.mjs');
    resetRerankCache();
    let clock = 0;
    let calls = 0;
    const client = createRerankClient({
        endpoint: 'http://127.0.0.1:9',
        now: () => clock,
        fetchImpl: async (_url, init) => {
            calls += 1;
            const body = JSON.parse(init.body);
            return Response.json({ results: body.documents.map((_text, index) => ({ index, relevance_score: 0.25 })) });
        },
    });
    for (let index = 0; index < RERANK_CACHE_LIMIT - 1; index += 1) await client.rank('过期', [`z${index}`]);
    clock = 50_000;
    await client.rank('过期', ['valid']);
    clock = 59_000;
    for (let index = 0; index < RERANK_CACHE_LIMIT - 1; index += 1) await client.rank('过期', [`z${index}`]);
    clock = RERANK_CACHE_TTL_MS;
    const beforeFresh = calls;
    await client.rank('过期', ['fresh']);
    assert.equal(calls, beforeFresh + 1);
    const beforeValid = calls;
    await client.rank('过期', ['valid']);
    assert.equal(calls, beforeValid, '仍在 TTL 内的条目不能被已过期条目挤出');
});

test('rerank and embedding caches are separated by owner and scope', async () => {
    const { createRerankClient, resetRerankCache } = await import('../memorycore-service/rerank.mjs');
    const { createOllamaEmbedding, resetEmbeddingCaches, embeddingCacheKey } = await import('../memorycore-service/embedding.mjs');
    resetRerankCache();
    resetEmbeddingCaches();
    let calls = 0;
    const fetchImpl = async (_url, init) => {
        calls += 1;
        const body = JSON.parse(init.body);
        return Response.json({ results: body.documents.map((_text, index) => ({ index, relevance_score: 0.75 })) });
    };
    const ownerA = createRerankClient({ endpoint: 'http://127.0.0.1:9', ownerId: '1', scope: '7:COMPANION:daily-7:main', fetchImpl });
    const ownerB = createRerankClient({ endpoint: 'http://127.0.0.1:9', ownerId: '2', scope: '7:COMPANION:daily-7:main', fetchImpl });
    const otherScope = createRerankClient({ endpoint: 'http://127.0.0.1:9', ownerId: '1', scope: '8:STORY:other:branch', fetchImpl });
    await ownerA.rank('问句', ['文档']);
    await ownerB.rank('问句', ['文档']);
    assert.equal(calls, 2);
    await ownerA.rank('问句', ['文档']);
    assert.equal(calls, 2);
    await otherScope.rank('问句', ['文档']);
    assert.equal(calls, 3);

    let tags = 0;
    let embeds = 0;
    const embedFetch = async (url) => {
        if (String(url).endsWith('/api/tags')) {
            tags += 1;
            return Response.json({ models: [{ name: embeddingSnapshot.model, digest: embeddingSnapshot.artifactVersion }] });
        }
        embeds += 1;
        return Response.json({ embeddings: [[1, 0]] });
    };
    const key = embeddingCacheKey(embeddingSnapshot, '同一句', '1', '7:COMPANION:daily-7:main');
    assert.equal(key, [embeddingSnapshot.model, embeddingSnapshot.artifactVersion, '2', embeddingSnapshot.normalization, '1', '7:COMPANION:daily-7:main', '同一句'].join('\0'));
    assert.notEqual(key, embeddingCacheKey(embeddingSnapshot, '同一句', '2', '7:COMPANION:daily-7:main'));
    const first = await createOllamaEmbedding(embeddingSnapshot, { fetchImpl: embedFetch, ownerId: '1', scope: '7:COMPANION:daily-7:main' });
    const second = await createOllamaEmbedding(embeddingSnapshot, { fetchImpl: embedFetch, ownerId: '1', scope: '7:COMPANION:daily-7:main' });
    assert.equal(tags, 1, '同一 snapshot 身份不应再次请求 /api/tags');
    await first.embed('同一句');
    await second.embed('同一句');
    assert.equal(embeds, 1);
    const otherOwner = await createOllamaEmbedding(embeddingSnapshot, { fetchImpl: embedFetch, ownerId: '2', scope: '7:COMPANION:daily-7:main' });
    assert.equal(tags, 1);
    await otherOwner.embed('同一句');
    assert.equal(embeds, 2);
    const branch = await createOllamaEmbedding(embeddingSnapshot, { fetchImpl: embedFetch, ownerId: '1', scope: '8:STORY:other:branch' });
    await branch.embed('同一句');
    assert.equal(embeds, 3);
});

test('rerank cache evicts the least recently used pair at the capacity limit', async () => {
    const { createRerankClient, resetRerankCache, RERANK_CACHE_LIMIT } = await import('../memorycore-service/rerank.mjs');
    resetRerankCache();
    let calls = 0;
    const client = createRerankClient({
        endpoint: 'http://127.0.0.1:9',
        fetchImpl: async (_url, init) => {
            calls += 1;
            const body = JSON.parse(init.body);
            return Response.json({ results: body.documents.map((_text, index) => ({ index, relevance_score: calls })) });
        },
    });
    for (let i = 0; i < RERANK_CACHE_LIMIT; i += 1) await client.rank('容量', [`d${i}`]);
    const beforeTouch = calls;
    await client.rank('容量', ['d0']);
    assert.equal(calls, beforeTouch, '刚写入的第一对应仍在缓存中');
    await client.rank('容量', ['fresh']);
    const afterEvict = calls;
    await client.rank('容量', ['d1']);
    assert.equal(calls, afterEvict + 1, '最久未使用的一对被淘汰后必须重新打分');
    await client.rank('容量', ['d0']);
    assert.equal(calls, afterEvict + 1, '最近使用的一对仍应命中');
});

test('rerank overlaps the original gate and loose sub-questions overlap each other', async () => {
    let looseInFlight = 0;
    let looseMax = 0;
    let originalEntered = false;
    let originalFinished = false;
    let release = () => {};
    const gate = new Promise((resolve) => { release = resolve; });
    const native = await engine(async (input) => {
        if (input.filter.minCosine < 0) {
            looseInFlight += 1;
            looseMax = Math.max(looseMax, looseInFlight);
            await new Promise((resolve) => setTimeout(resolve, 40));
            looseInFlight -= 1;
            return { hits: [{ record_id: 'c0', content: '候选', score: 0.2, cosine: 0.2, ftsScore: 0.1 }] };
        }
        originalEntered = true;
        await gate;
        originalFinished = true;
        return { hits: [{ record_id: 'kept', content: '原门槛', score: 0.4, cosine: 0.7, ftsScore: 0.9 }] };
    });
    let rankSawOriginal = false;
    const result = await native.search({
        query: '第一问。第二问', topK: 5, scope: {}, allowedRecordIds: ['c0', 'kept'], observe: true,
        rerank: {
            enabled: true, threshold: -1, candidateLimit: 20, summaryUnit: 'line',
            async rank() {
                await new Promise((resolve) => setTimeout(resolve, 30));
                if (originalEntered && !originalFinished) rankSawOriginal = true;
                release();
                return [2];
            },
        },
    });
    assert.equal(looseMax, 2);
    assert.equal(rankSawOriginal, true);
    assert.equal(result.stats.rerankDecision, 'applied');
    assert.ok(result.hits.some((hit) => hit.record_id === 'c0' || hit.record_id === 'kept'));
});

test('parallel sub-questions keep the earlier hit when scores tie', async () => {
    const native = await engine(async (input) => {
        const fromFirst = String(input.query).startsWith('甲');
        return { hits: [{ record_id: 'same', content: fromFirst ? '先' : '后', score: 0.4, cosine: 0.4, ftsScore: 0.1 }] };
    });
    const result = await native.search({
        query: '甲问题。乙问题', topK: 5, scope: {}, allowedRecordIds: ['same'], rerank: false,
    });
    assert.equal(result[0].content, '先');
    assert.equal(result[0].record_id, 'same');
});

test('observed search records stage milliseconds and rerank cache counts without text', async () => {
    const native = await engine(async (input) => {
        if (input.embeddingService?.embed) await input.embeddingService.embed(input.query);
        if (input.filter.minCosine < 0) return { hits: [{ record_id: 'c0', content: '合成候选', score: 0.2, cosine: 0.2, ftsScore: 0 }] };
        return { hits: [] };
    });
    const embedding = {
        async embed() { await new Promise((resolve) => setTimeout(resolve, 5)); return new Float32Array([1, 0]); },
        async embedQuery() { await new Promise((resolve) => setTimeout(resolve, 5)); return new Float32Array([1, 0]); },
    };
    const result = await native.search({
        query: '合成查询', topK: 5, scope: {}, allowedRecordIds: ['c0'], observe: true, embedding,
        gateTexts: [{ id: 'summary-1', text: '无关摘要' }],
        rerank: {
            enabled: true, threshold: 10, candidateLimit: 20, summaryUnit: 'line',
            async rank() { return [-20]; },
        },
    });
    for (const key of ['queryEmbeddingMs', 'looseRetrievalMs', 'originalGateMs', 'keywordRecoveryMs', 'rerankMs', 'summaryProfileGateMs', 'rerankCacheHit', 'rerankCacheMiss']) {
        assert.equal(Number.isInteger(result.stats[key]), true, key);
        assert.equal(result.stats[key] >= 0, true, key);
    }
    assert.equal(result.stats.queryEmbeddingMs > 0, true);
    assert.equal(result.stats.looseRetrievalMs > 0, true);
    assert.equal(result.stats.rerankMs >= 0, true);
    assert.equal(JSON.stringify(result.stats).includes('合成'), false);
});

test('embedding requests stay resident and share one in-flight call', async () => {
    const { createOllamaEmbedding, resetEmbeddingCaches } = await import('../memorycore-service/embedding.mjs');
    resetEmbeddingCaches();
    let calls = 0;
    const fetchImpl = async (url, init) => {
        if (String(url).endsWith('/api/tags')) {
            return Response.json({ models: [{ name: embeddingSnapshot.model, digest: embeddingSnapshot.artifactVersion }] });
        }
        calls += 1;
        const body = JSON.parse(init.body);
        assert.equal(body.keep_alive, -1);
        await new Promise((resolve) => setTimeout(resolve, 20));
        return Response.json({ embeddings: [[1, 0]] });
    };
    const first = await createOllamaEmbedding(embeddingSnapshot, { fetchImpl });
    const second = await createOllamaEmbedding(embeddingSnapshot, { fetchImpl });
    const [left, right] = await Promise.all([first.embed('同一句合成'), second.embed('同一句合成')]);
    assert.equal(calls, 1);
    assert.deepEqual([...left], [1, 0]);
    assert.deepEqual([...right], [1, 0]);
    await first.embed('同一句合成');
    assert.equal(calls, 1);
});
