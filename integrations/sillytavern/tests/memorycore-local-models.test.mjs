import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryCoreServer } from '../memorycore-service/http.mjs';
import { readLocalModels } from '../memorycore-service/local-models.mjs';

const token = 'synthetic-memorycore-token-0123456789';
const secretModel = 'secret-other-model';
const memoryText = '用户记得一把折叠车停在楼下';

function probeFetch(calls) {
    return async (url, init) => {
        calls.push({ url: String(url), signal: init?.signal });
        if (String(url).endsWith('/api/tags')) {
            return { ok: true, async json() { return { models: [{ name: 'qwen3-embedding:0.6b', digest: 'hidden-digest' }, { name: secretModel }] }; } };
        }
        if (String(url).endsWith('/health')) {
            return { ok: true, async json() { return { status: 'ok', detail: memoryText }; } };
        }
        throw new Error('unexpected probe ' + url);
    };
}

test('local model status reports embedding and rerank identity without addresses or other models', async () => {
    const calls = [];
    const status = await readLocalModels({
        env: { VC_RERANK_PORT: '11439' },
        fetchImpl: probeFetch(calls),
        timeoutMs: 50,
    });
    assert.deepEqual(status, {
        embedding: { model: 'qwen3-embedding:0.6b', dimensions: 1024, healthy: true },
        rerank: { model: 'bge-reranker-v2-m3', deploymentEnabled: true, healthy: true },
    });
    assert.deepEqual(calls.map((call) => call.url), [
        'http://127.0.0.1:11438/api/tags',
        'http://127.0.0.1:11439/health',
    ]);
    const body = JSON.stringify(status);
    for (const hidden of ['127.0.0.1', '11438', '11439', 'http', secretModel, memoryText, 'hidden-digest', token]) {
        assert.equal(body.includes(hidden), false, hidden);
    }
});

test('local model status is unhealthy when probes fail and deployment disable is explicit', async () => {
    const status = await readLocalModels({
        env: { VC_RERANK_ENABLED: '0', VC_RERANK_PORT: '11439' },
        fetchImpl: async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:11438'); },
        timeoutMs: 50,
    });
    assert.equal(status.embedding.model, 'qwen3-embedding:0.6b');
    assert.equal(status.embedding.dimensions, 1024);
    assert.equal(status.embedding.healthy, false);
    assert.equal(status.rerank.model, 'bge-reranker-v2-m3');
    assert.equal(status.rerank.deploymentEnabled, false);
    assert.equal(status.rerank.healthy, false);
    assert.equal(JSON.stringify(status).includes('ECONNREFUSED'), false);
    assert.equal(JSON.stringify(status).includes('127.0.0.1'), false);
});

test('rerank health is false when /health is not ok, even if deployment is enabled', async () => {
    const status = await readLocalModels({
        env: { VC_RERANK_ENABLED: 'false' },
        fetchImpl: async (url) => {
            if (String(url).endsWith('/api/tags')) return { ok: false, async json() { return {}; } };
            return { ok: false, async json() { return { error: memoryText }; } };
        },
        timeoutMs: 50,
    });
    assert.equal(status.embedding.healthy, false);
    assert.equal(status.rerank.deploymentEnabled, false);
    assert.equal(status.rerank.healthy, false);
    assert.equal(JSON.stringify(status).includes(memoryText), false);
});

async function listen(t, readLocalModelsImpl) {
    const server = createMemoryCoreServer({
        token, engine: { ready: async () => true }, commit: 'status-test', readLocalModels: readLocalModelsImpl,
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
    return `http://127.0.0.1:${server.address().port}`;
}

test('embedding stays unhealthy when the fixed model is not loaded', async () => {
    const status = await readLocalModels({
        env: {},
        fetchImpl: async (url) => {
            if (String(url).endsWith('/api/tags')) return { ok: true, async json() { return { models: [{ name: 'other-model' }] }; } };
            return { ok: true, async json() { return { status: 'ok' }; } };
        },
        timeoutMs: 50,
    });
    assert.equal(status.embedding.healthy, false);
    assert.equal(status.embedding.model, 'qwen3-embedding:0.6b');
    assert.equal(status.embedding.dimensions, 1024);
    assert.equal(status.rerank.healthy, true);
    assert.equal(status.rerank.deploymentEnabled, true);
    assert.equal(JSON.stringify(status).includes('other-model'), false);
});

test('HTTP search forwards rerankEnabled false into the engine input', async (t) => {
    let seen;
    const server = createMemoryCoreServer({
        token, commit: 'search-forward',
        engine: { invoke: async (action, input) => { seen = { action, rerankEnabled: input.rerankEnabled, query: input.query }; return []; } },
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
    const res = await fetch(`http://127.0.0.1:${server.address().port}/internal/search`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ query: '问句', rerankEnabled: false, note: memoryText }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(seen, { action: 'search', rerankEnabled: false, query: '问句' });
    assert.equal(JSON.stringify(await res.json()).includes(memoryText), false);
});

test('local model status route requires the service token and stays read-only', async (t) => {
    let reads = 0;
    const base = await listen(t, async () => {
        reads += 1;
        return {
            embedding: { model: 'qwen3-embedding:0.6b', dimensions: 1024, healthy: false },
            rerank: { model: 'bge-reranker-v2-m3', deploymentEnabled: true, healthy: false },
        };
    });
    assert.equal((await fetch(base + '/internal/local-models')).status, 401);
    assert.equal(reads, 0);
    const origin = await fetch(base + '/internal/local-models', {
        headers: { authorization: `Bearer ${token}`, origin: 'https://browser.test' },
    });
    assert.equal(origin.status, 403);
    assert.equal(reads, 0);
    const wrong = await fetch(base + '/internal/local-models', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: '{}' });
    assert.equal(wrong.status, 405);
    assert.equal(reads, 0);
    const ok = await fetch(base + '/internal/local-models', { headers: { authorization: `Bearer ${token}` } });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await ok.json(), {
        embedding: { model: 'qwen3-embedding:0.6b', dimensions: 1024, healthy: false },
        rerank: { model: 'bge-reranker-v2-m3', deploymentEnabled: true, healthy: false },
    });
    assert.equal(reads, 1);
});
