// A trusted Go snapshot is the only authority for vector-space identity.
// One native send recalls twice (browser, then the final outbound guard).
// The model input is pinned by artifact digest, so a short process-local
// cache returns the same vector without a second Ollama round trip.
const recentEmbeddings = new Map();
const inflightEmbeddings = new Map();
const RECENT_EMBEDDING_LIMIT = 128;
let embeddingCacheHits = 0;
let embeddingCacheMisses = 0;

export function embeddingCacheStats() {
    return { hits: embeddingCacheHits, misses: embeddingCacheMisses };
}

export function resetEmbeddingCaches() {
    recentEmbeddings.clear();
    inflightEmbeddings.clear();
    embeddingCacheHits = 0;
    embeddingCacheMisses = 0;
}

function embeddingCacheKey(snapshot, modelInput) {
    return [snapshot.model, snapshot.artifactVersion, String(snapshot.dimensions), snapshot.normalization, modelInput].join('\0');
}

function cachedEmbedding(key) {
    const hit = recentEmbeddings.get(key);
    if (!hit) return undefined;
    embeddingCacheHits++;
    recentEmbeddings.delete(key);
    recentEmbeddings.set(key, hit);
    return Float32Array.from(hit);
}

function storeEmbedding(key, vector) {
    recentEmbeddings.set(key, Float32Array.from(vector));
    while (recentEmbeddings.size > RECENT_EMBEDDING_LIMIT) {
        const oldest = recentEmbeddings.keys().next().value;
        recentEmbeddings.delete(oldest);
    }
}

export async function createOllamaEmbedding(snapshot, { fetchImpl = fetch, verifyArtifact = true } = {}) {
    const c = structuredClone(snapshot);
    if (c.provider !== 'OLLAMA' || c.endpoint !== 'http://127.0.0.1:11438' || c.state !== 'ENABLED' ||
        !c.spaceId || !c.artifactVersion || !c.model || !Number.isInteger(c.dimensions) || c.dimensions < 1 || c.dimensions > 8192 ||
        !['qwen3-retrieval-v1', 'identity-v1'].includes(c.queryPreprocessingVersion) ||
        c.documentPreprocessingVersion !== 'identity-v1' || !['l2', 'none'].includes(c.normalization)) throw new Error('MEMORYCORE_EMBEDDING_CONFIG');
    if (verifyArtifact) {
        const response = await fetchImpl(c.endpoint + '/api/tags', { signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw new Error('MEMORYCORE_EMBEDDING_ARTIFACT');
        const { models } = await response.json();
        if (!models?.some(m => m.name === c.model && m.digest === c.artifactVersion)) throw new Error('MEMORYCORE_EMBEDDING_ARTIFACT');
    }
    async function embed(text, { timeoutMs = 30000 } = {}) {
        if (typeof text !== 'string' || !text || text.length > 100000) throw new Error('MEMORYCORE_EMBEDDING_INPUT');
        const key = embeddingCacheKey(c, text);
        const hit = cachedEmbedding(key);
        if (hit) return hit;
        const pending = inflightEmbeddings.get(key);
        if (pending) {
            embeddingCacheHits++;
            return Float32Array.from(await pending);
        }
        embeddingCacheMisses++;
        // keep_alive -1 pins the model for the life of the Ollama process.
        // The server default unloads after about five idle minutes.
        const work = (async () => {
            let response;
            try { response = await fetchImpl(c.endpoint + '/api/embed', { method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ model: c.model, input: text, truncate: false, keep_alive: -1 }), signal: AbortSignal.timeout(Math.min(timeoutMs, 60000)) }); }
            catch { throw new Error('MEMORYCORE_EMBEDDING_FAILED'); }
            if (!response.ok) throw new Error('MEMORYCORE_EMBEDDING_FAILED');
            const v = (await response.json()).embeddings?.[0];
            if (!Array.isArray(v) || v.length !== c.dimensions || !v.every(Number.isFinite)) throw new Error('MEMORYCORE_EMBEDDING_DIMENSIONS');
            const norm = Math.hypot(...v);
            if (!Number.isFinite(norm) || norm === 0) throw new Error('MEMORYCORE_EMBEDDING_ZERO');
            const out = Float32Array.from(c.normalization === 'l2' ? v.map(x => x / norm) : v);
            storeEmbedding(key, out);
            return out;
        })();
        inflightEmbeddings.set(key, work);
        // Attach both handlers so a rejected embed does not surface as an
        // unhandled rejection from the cleanup promise.
        void work.then(() => {}, () => {}).then(() => {
            if (inflightEmbeddings.get(key) === work) inflightEmbeddings.delete(key);
        });
        return Float32Array.from(await work);
    }
    return {
        spaceId: c.spaceId, snapshot: Object.freeze(c), embed,
        embedQuery: (text, options) => embed(c.queryPreprocessingVersion === 'identity-v1' ? text :
            `Instruct: Given a question, retrieve relevant personal memories that answer the question.\nQuery: ${text}`, options),
        embedBatch: async (texts, options) => { const out = []; for (const text of texts) out.push(await embed(text, options)); return out; },
        getDimensions: () => c.dimensions, getProviderInfo: () => ({ provider: 'OLLAMA', model: c.model, spaceId: c.spaceId }),
        isReady: () => true, startWarmup() {},
    };
}
