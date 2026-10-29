// Read-only identity of the two fixed local model processes.
// Addresses stay inside the probe and never appear in the returned status.
import { RERANK } from './rerank.mjs';

export const LOCAL_EMBEDDING_MODEL = 'qwen3-embedding:0.6b';
export const LOCAL_EMBEDDING_DIMENSIONS = 1024;
export const LOCAL_RERANK_MODEL = 'bge-reranker-v2-m3';
const EMBEDDING_ORIGIN = 'http://127.0.0.1:11438';
const PROBE_TIMEOUT_MS = 400;

export function rerankDeploymentEnabled(env = process.env) {
    return env.VC_RERANK_ENABLED !== '0' && env.VC_RERANK_ENABLED !== 'false';
}

async function probe(fetchImpl, url, timeoutMs, accept) {
    try {
        const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
        if (!response?.ok) return false;
        if (!accept) return true;
        return accept(await response.json());
    } catch {
        return false;
    }
}

export async function readLocalModels({ env = process.env, fetchImpl = fetch, timeoutMs = PROBE_TIMEOUT_MS } = {}) {
    const port = env.VC_RERANK_PORT || String(RERANK.port);
    const [embeddingHealthy, rerankHealthy] = await Promise.all([
        probe(fetchImpl, `${EMBEDDING_ORIGIN}/api/tags`, timeoutMs, (body) => Array.isArray(body?.models) && body.models.some((model) => model?.name === LOCAL_EMBEDDING_MODEL)),
        probe(fetchImpl, `http://127.0.0.1:${port}/health`, timeoutMs),
    ]);
    return {
        embedding: { model: LOCAL_EMBEDDING_MODEL, dimensions: LOCAL_EMBEDDING_DIMENSIONS, healthy: embeddingHealthy },
        rerank: { model: LOCAL_RERANK_MODEL, deploymentEnabled: rerankDeploymentEnabled(env), healthy: rerankHealthy },
    };
}
