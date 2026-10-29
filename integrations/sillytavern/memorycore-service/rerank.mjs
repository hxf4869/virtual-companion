// One engine configuration for the local bge-reranker-v2-m3 service.
// The logit threshold and summary unit are calibrated only on
// scripts/fixtures/memorycore-calibration.json (25 memories, 100 questions).
// Line units keep every negative empty. Injection is the union of the cosine/FTS
// gates and this logit: 78/78 positives, top-1 69/78. Logit alone recalls 53/78.
// Whole-text units need a higher logit and recall 37/78.
// VC_RERANK_ENABLED=0 turns the ranker off; the port defaults to 11439.
export const RERANK = Object.freeze({
    enabled: true,
    port: 11439,
    timeoutMs: 2000,
    candidateLimit: 20,
    threshold: -1.02938437461853,
    summaryUnit: 'line',
    calibration: Object.freeze({
        negativeMax: -1.0293843746185303,
        positiveHits: 53,
        top1Hits: 69,
        unionPositiveHits: 78,
        unionTop1Hits: 69,
        positives: 78,
        negatives: 22,
    }),
    model: 'bge-m3',
});

export const RERANK_IMAGE = 'ghcr.io/ggml-org/llama.cpp@sha256:01c2bc28d51291536df2ccebe5c6af1cdec9ea9b2bd98ac59556408caf96d3f8';
export const RERANK_GGUF = Object.freeze({
    file: 'bge-reranker-v2-m3-Q8_0.gguf',
    sha256: 'a43c7c9b11a4c1517e5bf95151960e1621d1b72f7a493364b01e386cf1aaa1d3',
    bytes: 635676416,
});

export function looseRetrievalFilter() {
    return { minCosine: -1, minFtsScore: 0, cosineFloor: -1, ftsFloor: 0, cosineGap: 0, ftsGap: 0, genericSchedule: false };
}

export function nextUp(value) {
    if (!Number.isFinite(value)) throw new Error('RERANK_THRESHOLD');
    if (value === Number.MAX_VALUE) return Infinity;
    const buffer = new ArrayBuffer(8);
    const floats = new Float64Array(buffer);
    const bits = new BigUint64Array(buffer);
    floats[0] = value;
    if (value === 0) return Number.MIN_VALUE;
    if (value > 0) bits[0] += 1n;
    else bits[0] -= 1n;
    return floats[0];
}

// T0 sits one float above the highest logit on a negative query, so every
// negative candidate fails score >= threshold.
export function selectRerankThreshold(negativeMax) {
    return nextUp(negativeMax);
}

export function summaryUnits(text, unit, limit = RERANK.candidateLimit) {
    const whole = String(text ?? '');
    if (unit === 'whole') return [whole];
    const lines = whole.split(/\n/u).map((line) => line.trim()).filter(Boolean);
    return (lines.length ? lines : [whole]).slice(0, limit);
}

export function calibrationReport(rows, threshold) {
    const positives = rows.filter((row) => row.expected);
    const negatives = rows.filter((row) => !row.expected);
    let positiveHits = 0;
    let top1Hits = 0;
    let negativeNonEmpty = 0;
    for (const row of positives) {
        const pooled = (row.pooled || []).filter((id) => Number.isFinite(row.scores?.[id]));
        const expectedScore = row.scores?.[row.expected];
        const inPool = pooled.includes(row.expected);
        if (inPool && expectedScore >= threshold) positiveHits += 1;
        if (inPool && expectedScore === Math.max(...pooled.map((id) => row.scores[id]))) top1Hits += 1;
    }
    for (const row of negatives) {
        const pooled = (row.pooled || []).map((id) => row.scores?.[id]);
        if (pooled.some((score) => Number.isFinite(score) && score >= threshold)) negativeNonEmpty += 1;
    }
    return {
        threshold,
        positives: positives.length,
        negatives: negatives.length,
        positiveHits,
        positiveRecall: positives.length ? positiveHits / positives.length : 0,
        top1Hits,
        top1: positives.length ? top1Hits / positives.length : 0,
        negativeNonEmpty,
    };
}

function rerankError(code) {
    const error = new Error(`RERANK_${code.toUpperCase()}`);
    error.code = code;
    return error;
}

export function createRerankClient({ endpoint, timeoutMs = RERANK.timeoutMs, fetchImpl = fetch, threshold = RERANK.threshold, summaryUnit = RERANK.summaryUnit, enabled = true, candidateLimit = RERANK.candidateLimit } = {}) {
    return {
        enabled, threshold, timeoutMs, summaryUnit, candidateLimit,
        async rank(query, documents) {
            if (!Array.isArray(documents) || documents.some((text) => typeof text !== 'string')) throw rerankError('invalid');
            if (documents.length === 0) return [];
            let response;
            try {
                response = await fetchImpl(`${String(endpoint).replace(/\/$/u, '')}/v1/rerank`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ model: RERANK.model, query, documents, top_n: documents.length }),
                    signal: AbortSignal.timeout(timeoutMs),
                });
            } catch (error) {
                const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
                throw rerankError(timedOut ? 'timeout' : 'unavailable');
            }
            if (!response?.ok) throw rerankError('invalid');
            let body;
            try { body = await response.json(); }
            catch { throw rerankError('invalid'); }
            const results = body?.results;
            if (!Array.isArray(results)) throw rerankError('invalid');
            const scores = new Array(documents.length).fill(null);
            for (const item of results) {
                const index = item?.index;
                const score = item?.relevance_score;
                if (!Number.isInteger(index) || index < 0 || index >= documents.length || !Number.isFinite(score) || scores[index] !== null) {
                    throw rerankError('invalid');
                }
                scores[index] = score;
            }
            if (scores.some((score) => score === null)) throw rerankError('invalid');
            return scores;
        },
    };
}

export function engineRerank(env = process.env) {
    if (env.VC_RERANK_ENABLED === '0' || env.VC_RERANK_ENABLED === 'false') return { enabled: false };
    const port = env.VC_RERANK_PORT || String(RERANK.port);
    return createRerankClient({
        endpoint: `http://127.0.0.1:${port}`,
        timeoutMs: RERANK.timeoutMs,
        threshold: RERANK.threshold,
        summaryUnit: RERANK.summaryUnit,
        candidateLimit: RERANK.candidateLimit,
    });
}
