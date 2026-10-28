// A trusted Go snapshot is the only authority for vector-space identity.
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
        let response;
        try { response = await fetchImpl(c.endpoint + '/api/embed', { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model: c.model, input: text, truncate: false }), signal: AbortSignal.timeout(Math.min(timeoutMs, 60000)) }); }
        catch { throw new Error('MEMORYCORE_EMBEDDING_FAILED'); }
        if (!response.ok) throw new Error('MEMORYCORE_EMBEDDING_FAILED');
        const v = (await response.json()).embeddings?.[0];
        if (!Array.isArray(v) || v.length !== c.dimensions || !v.every(Number.isFinite)) throw new Error('MEMORYCORE_EMBEDDING_DIMENSIONS');
        const norm = Math.hypot(...v);
        if (!Number.isFinite(norm) || norm === 0) throw new Error('MEMORYCORE_EMBEDDING_ZERO');
        return Float32Array.from(c.normalization === 'l2' ? v.map(x => x / norm) : v);
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
