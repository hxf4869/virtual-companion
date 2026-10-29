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

function hanBigrams(text) {
    const grams = new Set();
    let han = '';
    for (const ch of String(text)) {
        if (/[\u4e00-\u9fff]/u.test(ch)) {
            han += ch;
            if (han.length > 2) han = han.slice(-2);
            if (han.length === 2) grams.add(han);
        } else han = '';
    }
    return grams;
}

function sharesHanBigram(wanted, line) {
    if (wanted.size === 0) return false;
    let han = '';
    for (const ch of String(line)) {
        if (/[\u4e00-\u9fff]/u.test(ch)) {
            han += ch;
            if (han.length > 2) han = han.slice(-2);
            if (han.length === 2 && wanted.has(han)) return true;
        } else han = '';
    }
    return false;
}

// Short summaries keep every non-empty line. A longer summary is filtered to
// lines that share a Han bigram with the question, then capped at the rerank
// window so a late matching line is not dropped unread.
export function summaryUnits(text, unit, limit = RERANK.candidateLimit, query = '') {
    const whole = String(text ?? '');
    if (unit === 'whole') return [whole];
    const lines = whole.split(/\n/u).map((line) => line.trim()).filter(Boolean);
    const body = lines.length ? lines : [whole];
    if (body.length <= limit) return body;
    const wanted = hanBigrams(query);
    if (wanted.size === 0) return body.slice(0, limit);
    return body.filter((line) => sharesHanBigram(wanted, line)).slice(0, limit);
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

// Process-local logits. The key is the raw model id, owner, scope, query and
// document joined by NUL — not a hash — so a changed memory text misses on
// its own, and another owner does not reuse this score. Sixty seconds covers
// the second recall of the same send. Least-recently used pairs past the cap
// are dropped; expiry does not move on a hit. Expired rows are removed before
// an insert so they do not occupy a slot. One in-flight promise is shared per
// key, and the stored time is the moment the score is ready.
export const RERANK_CACHE_TTL_MS = 60_000;
export const RERANK_CACHE_LIMIT = 256;
const rerankScoreCache = new Map();
const inflightRerank = new Map();
let rerankCacheHits = 0;
let rerankCacheMisses = 0;

export function rerankScoreKey(model, query, document, ownerId = '', scope = '') {
    return [model, ownerId, scope, query, document].join('\0');
}

export function rerankCacheStats() {
    return { hits: rerankCacheHits, misses: rerankCacheMisses };
}

export function resetRerankCache() {
    rerankScoreCache.clear();
    inflightRerank.clear();
    rerankCacheHits = 0;
    rerankCacheMisses = 0;
}

function readRerankScore(key, now) {
    const hit = rerankScoreCache.get(key);
    if (!hit) return undefined;
    if (now - hit.at >= RERANK_CACHE_TTL_MS) {
        rerankScoreCache.delete(key);
        return undefined;
    }
    rerankScoreCache.delete(key);
    rerankScoreCache.set(key, hit);
    return hit.score;
}

function evictExpiredRerankScores(now) {
    for (const [key, hit] of rerankScoreCache) {
        if (now - hit.at >= RERANK_CACHE_TTL_MS) rerankScoreCache.delete(key);
    }
}

function storeRerankScore(key, score, now) {
    evictExpiredRerankScores(now);
    rerankScoreCache.delete(key);
    rerankScoreCache.set(key, { score, at: now });
    while (rerankScoreCache.size > RERANK_CACHE_LIMIT) {
        const oldest = rerankScoreCache.keys().next().value;
        rerankScoreCache.delete(oldest);
    }
}

async function requestRerankScores({ endpoint, timeoutMs, fetchImpl, query, documents }) {
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
}

export function createRerankClient({ endpoint, timeoutMs = RERANK.timeoutMs, fetchImpl = fetch, threshold = RERANK.threshold, summaryUnit = RERANK.summaryUnit, enabled = true, candidateLimit = RERANK.candidateLimit, now = () => Date.now(), ownerId = '', scope = '' } = {}) {
    return {
        enabled, threshold, timeoutMs, summaryUnit, candidateLimit, ownerId, scope,
        async rank(query, documents) {
            if (!Array.isArray(documents) || documents.some((text) => typeof text !== 'string')) throw rerankError('invalid');
            if (documents.length === 0) return [];
            const cacheOwner = this?.ownerId || '';
            const cacheScope = this?.scope || '';
            const clock = now();
            const scores = new Array(documents.length);
            const missing = [];
            const waiters = [];
            for (let index = 0; index < documents.length; index += 1) {
                const key = rerankScoreKey(RERANK.model, query, documents[index], cacheOwner, cacheScope);
                const cached = readRerankScore(key, clock);
                if (cached !== undefined) {
                    rerankCacheHits += 1;
                    scores[index] = cached;
                    continue;
                }
                const inflight = inflightRerank.get(key);
                if (inflight) {
                    rerankCacheHits += 1;
                    waiters.push(inflight.then((score) => { scores[index] = score; }));
                    continue;
                }
                rerankCacheMisses += 1;
                missing.push({ index, key });
            }
            if (missing.length) {
                const resolvers = missing.map(() => {
                    let resolve;
                    let reject;
                    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
                    void promise.then(() => {}, () => {});
                    return { promise, resolve, reject };
                });
                missing.forEach((item, offset) => inflightRerank.set(item.key, resolvers[offset].promise));
                const batch = (async () => {
                    const fresh = await requestRerankScores({
                        endpoint, timeoutMs, fetchImpl, query, documents: missing.map((item) => documents[item.index]),
                    });
                    const completed = now();
                    for (let offset = 0; offset < missing.length; offset += 1) {
                        storeRerankScore(missing[offset].key, fresh[offset], completed);
                        resolvers[offset].resolve(fresh[offset]);
                    }
                    return fresh;
                })();
                try {
                    const fresh = await batch;
                    for (let offset = 0; offset < missing.length; offset += 1) scores[missing[offset].index] = fresh[offset];
                } catch (error) {
                    for (const resolver of resolvers) resolver.reject(error);
                    throw error;
                } finally {
                    for (let offset = 0; offset < missing.length; offset += 1) {
                        if (inflightRerank.get(missing[offset].key) === resolvers[offset].promise) inflightRerank.delete(missing[offset].key);
                    }
                }
            }
            if (waiters.length) await Promise.all(waiters);
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
