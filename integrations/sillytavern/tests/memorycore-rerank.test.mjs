import test from 'node:test';
import assert from 'node:assert/strict';

function hits(n) {
    return Array.from({ length: n }, (_, index) => ({
        record_id: `c${index}`,
        content: `候选${index}`,
        score: 1 - index / 1000,
        cosine: 0.9 - index / 1000,
        ftsScore: 0.7,
    }));
}

async function engine(recall, { queryL1Records } = {}) {
    const { createNativeFactory } = await import('../memorycore-service/native-engine.mjs');
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

test('rerank scores the loose top 20 and injects only logits at or above the threshold', async () => {
    const { RERANK } = await import('../memorycore-service/rerank.mjs');
    assert.equal(RERANK.enabled, true);
    assert.equal(RERANK.candidateLimit, 20);
    assert.equal(RERANK.timeoutMs, 2000);
    const seen = [];
    const native = await engine((input) => {
        seen.push(input.filter.minCosine);
        if (input.filter.minCosine < 0) return { hits: hits(3) };
        return { hits: [] };
    });
    const ranked = [];
    const result = await native.search({
        query: '折叠车停在哪？', topK: 5, scope: {}, allowedRecordIds: ['c0', 'c1', 'c2'], observe: true,
        rerank: {
            enabled: true, threshold: -1, candidateLimit: 20, summaryUnit: 'line',
            async rank(_query, documents) {
                ranked.push(documents);
                return documents.map((text) => (text.endsWith('0') ? 2 : text.endsWith('1') ? -0.2 : -3));
            },
        },
    });
    assert.deepEqual(seen, [-1, 0.58]);
    assert.equal(ranked.length, 1);
    assert.deepEqual(ranked[0], ['候选0', '候选1', '候选2']);
    assert.deepEqual(result.hits.map((hit) => hit.record_id), ['c0', 'c1']);
    assert.equal(result.hits[0].rerankScore, 2);
    assert.equal(result.hits[0].cosine, 0.9);
    assert.equal(result.stats.rerankDecision, 'applied');
    assert.equal(result.stats.rerankCandidates, 3);
    assert.equal(result.stats.rerankKept, 2);
    assert.equal(result.stats.rerankOnly, 2);
    assert.equal(result.stats.rerankFallback, 0);
    assert.equal(JSON.stringify(result.stats).includes('候选'), false);
});

test('union injects a cosine or FTS hit the logit misses, and a logit hit the gates miss', async () => {
    const gateOnly = { record_id: 'gate', content: '原门槛', score: 0.4, cosine: 0.8, ftsScore: 0.2 };
    const rankOnly = { record_id: 'rank', content: '仅重排', score: 0.1, cosine: 0.1, ftsScore: 0.1 };
    const neither = { record_id: 'drop', content: '都不过', score: 0.1, cosine: 0.1, ftsScore: 0.1 };
    const native = await engine((input) => {
        if (input.filter.minCosine < 0) return { hits: [gateOnly, rankOnly, neither] };
        return { hits: [gateOnly] };
    });
    const result = await native.search({
        query: '并集', topK: 5, scope: {}, allowedRecordIds: ['gate', 'rank', 'drop'], observe: true,
        rerank: {
            enabled: true, threshold: 0, candidateLimit: 20, summaryUnit: 'line',
            async rank() { return [-4, 2, -4]; },
        },
    });
    assert.deepEqual(result.hits.map((hit) => hit.record_id), ['rank', 'gate']);
    assert.equal(result.stats.rerankOnly, 1);
    assert.equal(result.stats.rerankDecision, 'applied');
    assert.equal(result.stats.rerankKept, 2);
});

test('rerank unavailable falls back to the cosine and FTS gates', async () => {
    const native = await engine((input) => {
        if (input.filter.minCosine < 0) return { hits: hits(1) };
        return { hits: [{ record_id: 'kept', content: '回退', score: 0.4, cosine: 0.7, ftsScore: 0.9 }] };
    });
    const result = await native.search({
        query: '服务不可用', topK: 5, scope: {}, allowedRecordIds: ['c0', 'kept'], observe: true,
        rerank: {
            enabled: true, threshold: 0, candidateLimit: 20, summaryUnit: 'line',
            async rank() { const error = new Error('down'); error.code = 'unavailable'; throw error; },
        },
    });
    assert.deepEqual(result.hits.map((hit) => hit.record_id), ['kept']);
    assert.equal(result.stats.rerankDecision, 'unavailable');
    assert.equal(result.stats.rerankFallback, 1);
    assert.equal(result.stats.rerankOnly, 0);
});

test('rerank sends at most 20 documents', async () => {
    const native = await engine(() => ({ hits: hits(25) }));
    let sent = 0;
    await native.search({
        query: '只要前二十条', topK: 20, scope: {}, allowedRecordIds: hits(25).map((hit) => hit.record_id),
        rerank: {
            enabled: true, threshold: -100, candidateLimit: 20, summaryUnit: 'whole',
            async rank(_query, documents) { sent = documents.length; return documents.map(() => 1); },
        },
    });
    assert.equal(sent, 20);
});

test('rerank timeout falls back to the cosine and FTS gates without failing the search', async () => {
    const filters = [];
    const native = await engine((input) => {
        filters.push(input.filter.minCosine);
        if (input.filter.minCosine < 0) return { hits: hits(2) };
        return { hits: [{ record_id: 'kept', content: '余弦保留', score: 0.4, cosine: 0.7, ftsScore: 0.9 }] };
    });
    const result = await native.search({
        query: '超时以后仍要回答', topK: 5, scope: {}, allowedRecordIds: ['c0', 'kept'], observe: true,
        rerank: {
            enabled: true, threshold: 0, candidateLimit: 20, summaryUnit: 'line',
            async rank() { const error = new Error('slow'); error.code = 'timeout'; throw error; },
        },
    });
    assert.deepEqual(filters, [-1, 0.58]);
    assert.deepEqual(result.hits.map((hit) => hit.record_id), ['kept']);
    assert.equal(result.stats.rerankDecision, 'timeout');
    assert.equal(result.stats.rerankFallback, 1);
    assert.equal(result.stats.rerankOnly, 0);
    assert.equal(JSON.stringify(result.stats).includes('余弦保留'), false);
});

test('an invalid rerank body falls back and an unreachable ranker is unavailable', async () => {
    const { createRerankClient } = await import('../memorycore-service/rerank.mjs');
    const invalid = createRerankClient({
        endpoint: 'http://127.0.0.1:9', threshold: 0, summaryUnit: 'line', timeoutMs: 50,
        fetchImpl: async () => Response.json({ results: [{ index: 0, relevance_score: 'nope' }] }),
    });
    await assert.rejects(invalid.rank('问', ['答']), (error) => error.code === 'invalid');
    const down = createRerankClient({
        endpoint: 'http://127.0.0.1:9', threshold: 0, summaryUnit: 'line', timeoutMs: 50,
        fetchImpl: async () => { throw new TypeError('fetch failed'); },
    });
    await assert.rejects(down.rank('问', ['答']), (error) => error.code === 'unavailable');
    const slow = createRerankClient({
        endpoint: 'http://127.0.0.1:9', threshold: 0, summaryUnit: 'line', timeoutMs: 50,
        fetchImpl: async () => { throw new DOMException('The operation was aborted', 'TimeoutError'); },
    });
    await assert.rejects(slow.rank('问', ['答']), (error) => error.code === 'timeout');
});

test('a disabled reranker keeps the absolute cosine and FTS gates', async () => {
    const native = await engine((input) => {
        assert.equal(input.filter.minCosine, 0.58);
        assert.equal(input.filter.minFtsScore, 0.80);
        return { hits: [{ record_id: 'kept', content: '保留', score: 0.2, cosine: 0.6 }] };
    });
    const result = await native.search({
        query: '不走重排', topK: 5, scope: {}, allowedRecordIds: ['kept'], observe: true, rerank: false,
    });
    assert.deepEqual(result.hits.map((hit) => hit.record_id), ['kept']);
    assert.equal(result.stats.rerankDecision, 'disabled');
    assert.equal(result.stats.rerankFallback, 0);
});

test('summary and profile gates use the calibrated rerank unit', async () => {
    const { summaryPassesGate } = await import('../memorycore-service/native-engine.mjs');
    const embedding = { embedBatch: async () => [new Float32Array([1, 0]), new Float32Array([0, 1])] };
    const persona = '无关抬头\n用户将去厦门参加朋友婚礼。\n模板说明';
    const line = {
        enabled: true, threshold: 0, summaryUnit: 'line',
        async rank(_query, documents) {
            return documents.map((text) => (text.includes('厦门') ? 1.5 : -4));
        },
    };
    assert.equal(await summaryPassesGate('我要去哪里参加婚礼？', persona, embedding, false, line), true);
    const whole = {
        enabled: true, threshold: 0, summaryUnit: 'whole',
        async rank(_query, documents) {
            assert.equal(documents.length, 1);
            return [-2];
        },
    };
    assert.equal(await summaryPassesGate('我要去哪里参加婚礼？', persona, embedding, false, whole), false);
    const missed = {
        enabled: true, threshold: 0, summaryUnit: 'line',
        async rank() { return [-3, -4, -5]; },
    };
    assert.equal(await summaryPassesGate('我的幸运颜色是什么？', persona, embedding, false, missed), false);
    // Union: a rerank miss still passes when the original cosine gate does.
    const same = { embedBatch: async () => [new Float32Array([1, 0]), new Float32Array([1, 0])] };
    assert.equal(await summaryPassesGate('我的幸运颜色是什么？', '用户将去厦门参加婚礼。', same, false, missed), true);
});

test('threshold selection keeps every negative empty and records recall and top-1', async () => {
    const { selectRerankThreshold, calibrationReport } = await import('../memorycore-service/rerank.mjs');
    const threshold = selectRerankThreshold(-1.5);
    assert.equal(threshold > -1.5, true);
    assert.equal(-1.5 >= threshold, false);
    const report = calibrationReport([
        { expected: 'tea', scores: { tea: 2, food: -2 }, pooled: ['tea', 'food'] },
        { expected: 'book', scores: { book: -4, food: 1 }, pooled: ['book', 'food'] },
        { expected: null, scores: { tea: -1.5, food: -4 }, pooled: ['tea', 'food'] },
        { expected: null, scores: { book: -2 }, pooled: ['book'] },
    ], threshold);
    assert.equal(report.negativeNonEmpty, 0);
    assert.equal(report.positiveRecall, 0.5);
    assert.equal(report.top1, 0.5);
    assert.equal(report.positives, 2);
    assert.equal(report.negatives, 2);
});

test('deployment disable wins over an explicit ranker', async () => {
    const previous = process.env.VC_RERANK_ENABLED;
    process.env.VC_RERANK_ENABLED = '0';
    try {
        let ranked = 0;
        const native = await engine(() => ({ hits: hits(1) }));
        const result = await native.search({
            query: '问句', topK: 5, scope: {}, allowedRecordIds: ['c0'], observe: true,
            rerank: {
                enabled: true, threshold: -1, candidateLimit: 20, summaryUnit: 'line',
                async rank() { ranked += 1; return [2]; },
            },
        });
        assert.equal(ranked, 0);
        assert.equal(result.stats.rerankDecision, 'disabled');
    } finally {
        if (previous === undefined) delete process.env.VC_RERANK_ENABLED;
        else process.env.VC_RERANK_ENABLED = previous;
    }
});

test('production rerank config is the calibration point that keeps negatives empty', async () => {
    const { RERANK, selectRerankThreshold } = await import('../memorycore-service/rerank.mjs');
    assert.equal(RERANK.summaryUnit, 'line');
    assert.equal(RERANK.enabled, true);
    assert.equal(RERANK.threshold, selectRerankThreshold(RERANK.calibration.negativeMax));
    assert.equal(RERANK.calibration.negativeMax >= RERANK.threshold, false);
    assert.equal(RERANK.calibration.positiveHits, 53);
    assert.equal(RERANK.calibration.top1Hits, 69);
    assert.equal(RERANK.calibration.unionPositiveHits, 78);
    assert.equal(RERANK.calibration.unionTop1Hits, 69);
    assert.equal(RERANK.calibration.positives, 78);
    assert.equal(RERANK.calibration.negatives, 22);
});

test('original and keyword hits outside a full logit window stay inside topK', async () => {
    const windowHits = hits(20);
    const outside = { record_id: 'outside', content: '窗外原门槛', score: 0.42, cosine: 0.8, ftsScore: 0.9 };
    const keyword = { record_id: 'keyword', content: '关键词命中', score: 1e-6, cosine: 0.55, ftsScore: null };
    const native = await engine((input) => {
        if (input.filter.minCosine < 0) return { hits: windowHits };
        return { hits: [outside, keyword] };
    });
    const result = await native.search({
        query: '窗口外也要留下', topK: 20, scope: {}, allowedRecordIds: [...windowHits.map((hit) => hit.record_id), 'outside', 'keyword'], observe: true,
        rerank: {
            enabled: true, threshold: -1, candidateLimit: 20, summaryUnit: 'line',
            async rank(_query, documents) {
                assert.equal(documents.length, 20);
                return documents.map(() => 1);
            },
        },
    });
    const ids = result.hits.map((hit) => hit.record_id);
    assert.equal(ids.length, 20);
    assert.equal(ids.includes('outside'), true);
    assert.equal(ids.includes('keyword'), true);
    assert.equal(ids.filter((id) => id.startsWith('c')).length, 18);
    assert.equal(result.hits.find((hit) => hit.record_id === 'keyword').score, 1e-6);
    assert.equal(result.stats.rerankDecision, 'applied');
    assert.equal(result.stats.rerankFallback, 0);
    assert.equal(result.stats.rerankOnly, 18);
});

test('original-gate hits fill topK before logit-only hits', async () => {
    const loose = hits(20).map((hit) => ({ ...hit, record_id: `loose-${hit.record_id}` }));
    const originals = Array.from({ length: 21 }, (_, index) => ({
        record_id: `o${index}`, content: `原门槛${index}`, score: 1 - index / 100, cosine: 0.8, ftsScore: 0.9,
    }));
    const native = await engine((input) => {
        if (input.filter.minCosine < 0) return { hits: loose };
        return { hits: originals };
    });
    const result = await native.search({
        query: '原门槛先留', topK: 20, scope: {}, allowedRecordIds: [...loose.map((hit) => hit.record_id), ...originals.map((hit) => hit.record_id)], observe: true,
        rerank: {
            enabled: true, threshold: 0, candidateLimit: 20, summaryUnit: 'line',
            async rank() { return loose.map(() => 5); },
        },
    });
    assert.deepEqual(result.hits.map((hit) => hit.record_id), originals.slice(0, 20).map((hit) => hit.record_id));
    assert.equal(result.stats.rerankOnly, 0);
    assert.equal(result.stats.rerankDecision, 'applied');
});

test('each query clause is ranked and the same memory keeps the highest logit', async () => {
    const seen = [];
    const native = await engine((input) => {
        if (input.filter.minCosine < 0) return { hits: [{ record_id: 'mem', content: '读书计划还在选下一本', score: 0.2, cosine: 0.2, ftsScore: 0.1 }] };
        return { hits: [] };
    });
    const result = await native.search({
        query: '我在2026年10月30日准备去哪里，为什么？我们上次读书计划谈到哪一步了？',
        topK: 5, scope: {}, allowedRecordIds: ['mem'], observe: true,
        rerank: {
            enabled: true, threshold: 0, candidateLimit: 20, summaryUnit: 'line',
            async rank(query) {
                seen.push(query);
                return [query.includes('读书计划') ? 1.2 : -3];
            },
        },
    });
    assert.deepEqual(seen.slice().sort(), ['我在2026年10月30日准备去哪里，为什么', '我们上次读书计划谈到哪一步了'].sort());
    assert.equal(seen.includes('我在2026年10月30日准备去哪里，为什么？我们上次读书计划谈到哪一步了？'), false);
    assert.equal(result.hits[0].record_id, 'mem');
    assert.equal(result.hits[0].rerankScore, 1.2);
    assert.equal(result.stats.rerankDecision, 'applied');
    assert.equal(result.stats.rerankFallback, 0);
});

test('loose retrieval and original-gate errors are not rerank failures', async () => {
    let ranked = 0;
    const loose = await engine(async (input) => {
        if (input.filter.minCosine < 0) throw new Error('LOOSE_BROKEN');
        return { hits: [{ record_id: 'kept', content: '原门槛', score: 0.4, cosine: 0.7, ftsScore: 0.9 }] };
    });
    await assert.rejects(loose.search({
        query: '松检索失败', topK: 5, scope: {}, allowedRecordIds: ['kept'], observe: true,
        rerank: {
            enabled: true, threshold: 0, candidateLimit: 20, summaryUnit: 'line',
            async rank() { ranked += 1; return [2]; },
        },
    }), (error) => error.message === 'LOOSE_BROKEN');
    assert.equal(ranked, 0);

    let originalCalls = 0;
    const original = await engine(async (input) => {
        if (input.filter.minCosine < 0) return { hits: hits(1) };
        originalCalls += 1;
        if (originalCalls === 1) throw new Error('ORIGINAL_BROKEN');
        return { hits: [{ record_id: 'kept', content: '重试才有', score: 0.4, cosine: 0.7, ftsScore: 0.9 }] };
    });
    await assert.rejects(original.search({
        query: '原门槛失败', topK: 5, scope: {}, allowedRecordIds: ['c0', 'kept'], observe: true,
        rerank: {
            enabled: true, threshold: -1, candidateLimit: 20, summaryUnit: 'line',
            async rank() { ranked += 1; return [2]; },
        },
    }), (error) => error.message === 'ORIGINAL_BROKEN');
    assert.equal(originalCalls, 1);
});

test('summary embedding errors stay embedding errors and summary rerank failure only counts the gate', async () => {
    let embeds = 0;
    const failing = await engine((input) => {
        if (input.filter.minCosine < 0) return { hits: [{ record_id: 'c0', content: '候选', score: 0.2, cosine: 0.2, ftsScore: 0 }] };
        return { hits: [] };
    });
    await assert.rejects(failing.search({
        query: '摘要向量失败', topK: 5, scope: {}, allowedRecordIds: ['c0'], observe: true,
        embedding: {
            async embed() { embeds += 1; if (embeds === 1) throw new Error('EMBED_BROKEN'); return new Float32Array([1, 0]); },
            async embedQuery() { embeds += 1; if (embeds === 1) throw new Error('EMBED_BROKEN'); return new Float32Array([1, 0]); },
            async embedBatch() { embeds += 1; if (embeds === 1) throw new Error('EMBED_BROKEN'); return [new Float32Array([1, 0]), new Float32Array([1, 0])]; },
        },
        gateTexts: [{ id: 'summary-1', text: '用户将去厦门参加朋友婚礼。' }],
        rerank: {
            enabled: true, threshold: 0, candidateLimit: 20, summaryUnit: 'line',
            async rank() { return [-4]; },
        },
    }), (error) => error.message === 'EMBED_BROKEN');

    let calls = 0;
    const native = await engine((input) => {
        if (input.filter.minCosine < 0) return { hits: [{ record_id: 'c0', content: '候选', score: 0.2, cosine: 0.2, ftsScore: 0 }] };
        return { hits: [] };
    });
    const result = await native.search({
        query: '摘要回退', topK: 5, scope: {}, allowedRecordIds: ['c0'], observe: true,
        embedding: { embedBatch: async () => [new Float32Array([0, 1]), new Float32Array([1, 0])] },
        gateTexts: [{ id: 'persona', text: '用户将去厦门参加朋友婚礼。' }],
        rerank: {
            enabled: true, threshold: 0, candidateLimit: 20, summaryUnit: 'line',
            async rank() {
                calls += 1;
                if (calls > 1) throw Object.assign(new Error('slow'), { code: 'timeout' });
                return [2];
            },
        },
    });
    assert.equal(result.stats.rerankDecision, 'applied');
    assert.equal(result.stats.rerankFallback, 0);
    assert.equal(result.stats.rerankGateFallback, 1);
});

test('summary lines past the first twenty are reranked when they share han with the question', async () => {
    const { summaryPassesGate } = await import('../memorycore-service/native-engine.mjs');
    const { summaryUnits } = await import('../memorycore-service/rerank.mjs');
    const fillers = Array.from({ length: 24 }, (_, index) => `空白条目补充说明文字${index}`);
    const late = '用户将去厦门参加朋友婚礼。';
    const persona = [...fillers, late].join('\n');
    const query = '我要去哪里参加婚礼？';
    const units = summaryUnits(persona, 'line', 20, query);
    assert.equal(units.length <= 20, true);
    assert.equal(units.includes(late), true);
    assert.equal(units.some((line) => line.startsWith('空白条目')), false);
    let seen = [];
    const passed = await summaryPassesGate(query, persona, {
        embedBatch: async () => [new Float32Array([1, 0]), new Float32Array([0, 1])],
    }, false, {
        enabled: true, threshold: 0, summaryUnit: 'line', candidateLimit: 20,
        async rank(_query, documents) {
            seen = documents;
            return documents.map((text) => (text.includes('厦门') ? 2 : -4));
        },
    });
    assert.equal(passed, true);
    assert.equal(seen.length <= 20, true);
    assert.equal(seen.includes(late), true);
    const many = Array.from({ length: 25 }, (_, index) => `参加婚礼的记录${index}`).join('\n');
    assert.equal(summaryUnits(many, 'line', 20, query).length, 20);
});
