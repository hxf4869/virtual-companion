// Synthetic send-stage timer for the managed worktree.
// Prints and writes milliseconds and counts only. Never writes query text,
// document text, identifiers, credentials, or response bodies.
//
// Browser calibration: --mode browser --round round-cm1-calibration
// Numeric pipeline samples: --mode pipeline --dataset samples.jsonl [--baseline previous.jsonl]
// Dedicated local models only: --mode local-model --dedicated-local-models --label baseline
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { validateSample, summarizeSamples, compareSamples, comparisonMarkdown } from './lib/chat-memory-metrics.mjs';
import { createRoundArtifacts } from './lib/chat-memory-artifacts.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QUERY = '合成问题甲。合成问题乙';
const DOCS = ['合成资料甲', '合成资料乙', '合成资料丙', '合成资料丁', '合成资料戊', '合成资料己', '合成资料庚', '合成资料辛'];

function arg(name, fallback) {
    const index = process.argv.indexOf(name);
    if (index < 0) return fallback;
    return process.argv[index + 1];
}

function msSince(start) {
    return Math.max(0, Math.round(performance.now() - start));
}

async function probe(url, timeoutMs = 2000) {
    const started = performance.now();
    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
        return { ok: response.ok, status: response.status, ms: msSince(started), response };
    } catch {
        return { ok: false, status: 0, ms: msSince(started), response: null };
    }
}

async function embeddingLoaded() {
    const hit = await probe('http://127.0.0.1:11438/api/ps');
    if (!hit.response?.ok) return { loaded: 0, expiresInMs: null };
    let body;
    try { body = await hit.response.json(); }
    catch { return { loaded: 0, expiresInMs: null }; }
    const models = Array.isArray(body?.models) ? body.models : [];
    const now = Date.now();
    const left = models.map((model) => {
        const at = Date.parse(model?.expires_at);
        return Number.isFinite(at) ? at - now : null;
    }).filter((value) => Number.isFinite(value));
    return { loaded: models.length, expiresInMs: left.length ? Math.min(...left) : null };
}

async function unloadEmbedding() {
    await fetch('http://127.0.0.1:11438/api/embed', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'qwen3-embedding:0.6b', input: 'x', keep_alive: 0 }),
        signal: AbortSignal.timeout(120000),
    }).catch(() => {});
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        const state = await embeddingLoaded();
        if (state.loaded === 0) return;
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
}

async function rawEmbed() {
    const started = performance.now();
    const response = await fetch('http://127.0.0.1:11438/api/embed', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'qwen3-embedding:0.6b', input: QUERY, truncate: false }),
        signal: AbortSignal.timeout(180000),
    });
    if (!response.ok) throw new Error(`EMBED_HTTP_${response.status}`);
    const body = await response.json();
    const dims = Array.isArray(body?.embeddings?.[0]) ? body.embeddings[0].length : 0;
    return { ms: msSince(started), dims };
}

async function rawRerank() {
    const started = performance.now();
    const response = await fetch('http://127.0.0.1:11439/v1/rerank', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'bge-m3', query: QUERY, documents: DOCS, top_n: DOCS.length }),
        signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`RERANK_HTTP_${response.status}`);
    const body = await response.json();
    return { ms: msSince(started), scores: Array.isArray(body?.results) ? body.results.length : 0 };
}

function stageOf(stats) {
    if (!stats || typeof stats !== 'object') return null;
    const keys = ['queryEmbeddingMs', 'looseRetrievalMs', 'originalGateMs', 'keywordRecoveryMs', 'rerankMs', 'summaryProfileGateMs', 'rerankCacheHit', 'rerankCacheMiss', 'embeddingCacheHit', 'embeddingCacheMiss'];
    const out = {};
    for (const key of keys) out[key] = Number.isInteger(stats[key]) ? stats[key] : null;
    return out;
}

async function engineSearch({ rerank, embedding }) {
    const { createNativeFactory } = await import('../integrations/sillytavern/memorycore-service/native-engine.mjs');
    const native = await (await createNativeFactory({
        VectorStore: class {
            async init() {}
            queryL1Records() { return []; }
        },
        async recallL1Candidates(input) {
            if (input.embeddingService?.embed) await input.embeddingService.embed(input.query);
            const loose = input.filter?.minCosine < 0;
            return {
                hits: DOCS.map((content, index) => ({
                    record_id: `s${index}`, content, score: loose ? 0.2 - index / 1000 : (index === 0 ? 0.7 : 0.1),
                    cosine: index === 0 ? 0.7 : 0.2, ftsScore: index === 0 ? 0.9 : 0.1,
                })),
            };
        },
    }))('/synthetic-unused');
    const started = performance.now();
    const result = await native.search({
        query: QUERY, topK: 5, scope: {}, allowedRecordIds: DOCS.map((_text, index) => `s${index}`),
        observe: true, embedding, rerank,
        gateTexts: [{ id: 'summary-1', text: '合成摘要一行' }, { id: 'persona', text: '合成画像一行' }],
    });
    return {
        ms: msSince(started),
        hits: Array.isArray(result?.hits) ? result.hits.length : 0,
        stages: stageOf(result?.stats),
        rerankDecision: typeof result?.stats?.rerankDecision === 'string' ? result.stats.rerankDecision : null,
    };
}

async function libraryEmbedding() {
    const tags = await fetch('http://127.0.0.1:11438/api/tags', { signal: AbortSignal.timeout(5000) });
    if (!tags.ok) throw new Error(`TAGS_HTTP_${tags.status}`);
    const body = await tags.json();
    const model = (body.models || []).find((item) => item?.name === 'qwen3-embedding:0.6b');
    if (!model?.digest) throw new Error('EMBED_MODEL_ABSENT');
    const { createOllamaEmbedding } = await import('../integrations/sillytavern/memorycore-service/embedding.mjs');
    const snapshot = {
        provider: 'OLLAMA', endpoint: 'http://127.0.0.1:11438', model: model.name, artifactVersion: model.digest,
        dimensions: 1024, queryPreprocessingVersion: 'qwen3-retrieval-v1', documentPreprocessingVersion: 'identity-v1',
        normalization: 'l2', state: 'ENABLED', revision: 1, spaceId: 'perf-send-stages',
    };
    return createOllamaEmbedding(snapshot, { verifyArtifact: false });
}

async function portOpen(url) {
    const hit = await probe(url, 800);
    return hit.ok ? 1 : 0;
}

async function localModelMain() {
    if (!process.argv.includes('--dedicated-local-models')) throw new Error('DEDICATED_LOCAL_MODELS_REQUIRED');
    const label = String(arg('--label', 'run')).replace(/[^a-z0-9_-]/gi, '') || 'run';
    const idleMs = Number(arg('--idle-ms', '0'));
    const report = {
        label,
        goUp: await portOpen(`http://127.0.0.1:${process.env.VC_W03_GO_PORT || 9395}/actuator/health`),
        memorycoreUp: await portOpen(`http://127.0.0.1:${process.env.VC_MEMORYCORE_PORT || 10054}/healthz`),
        stUp: await portOpen(`http://127.0.0.1:${process.env.VC_ST_PORT || 10052}/`),
        rerankUp: (await probe('http://127.0.0.1:11439/health')).ok ? 1 : 0,
        embeddingUp: (await probe('http://127.0.0.1:11438/api/tags')).ok ? 1 : 0,
        before: await embeddingLoaded(),
        rows: [],
        idle: null,
        error: null,
    };
    if (!report.embeddingUp || !report.rerankUp) {
        report.error = 'LOCAL_MODEL_DOWN';
        await write(label, report);
        console.log(JSON.stringify(report));
        process.exitCode = 1;
        return;
    }
    const embedding = await libraryEmbedding();
    const { resetEmbeddingCaches, embeddingCacheStats } = await import('../integrations/sillytavern/memorycore-service/embedding.mjs');
    const { createRerankClient, resetRerankCache, rerankCacheStats } = await import('../integrations/sillytavern/memorycore-service/rerank.mjs');
    const measure = async (name, rerank) => {
        const before = embeddingCacheStats();
        const rankBefore = rerankCacheStats();
        const row = { name, ...(await engineSearch({ rerank, embedding })) };
        const after = embeddingCacheStats();
        const rankAfter = rerankCacheStats();
        row.embedDelta = { hits: after.hits - before.hits, misses: after.misses - before.misses };
        row.rerankDelta = { hits: rankAfter.hits - rankBefore.hits, misses: rankAfter.misses - rankBefore.misses };
        report.rows.push(row);
        return row;
    };
    const cold = async (name, rerank) => {
        await unloadEmbedding();
        resetEmbeddingCaches();
        resetRerankCache();
        return measure(name, rerank);
    };
    report.coldRerankOn = await cold('cold-rerank-on', true);
    report.hotRerankOn = await measure('hot-rerank-on', true);
    report.hotOutboundRerankOn = await measure('hot-outbound-rerank-on', true);
    report.hotRerankOff = await measure('hot-rerank-off', false);
    report.coldRerankOff = await cold('cold-rerank-off', false);
    const rerankA = await rawRerank();
    const rerankB = await rawRerank();
    resetRerankCache();
    const client = createRerankClient({ endpoint: 'http://127.0.0.1:11439', timeoutMs: 30000 });
    const cachedFirstStarted = performance.now();
    await client.rank(QUERY, DOCS);
    const cachedFirstMs = msSince(cachedFirstStarted);
    const cachedSecondStarted = performance.now();
    await client.rank(QUERY, DOCS);
    report.directRerank = { firstMs: rerankA.ms, secondMs: rerankB.ms, scores: rerankA.scores, clientFirstMs: cachedFirstMs, clientSecondMs: msSince(cachedSecondStarted), cache: rerankCacheStats() };
    const embedHot = await rawEmbed();
    report.directEmbedHotMs = embedHot.ms;
    report.after = await embeddingLoaded();
    if (Number.isInteger(idleMs) && idleMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, idleMs));
        report.idle = { waitedMs: idleMs, ...(await embeddingLoaded()) };
    }
    await write(label, report);
    console.log(JSON.stringify(report));
}

async function write(label, report) {
    const artifacts = await createRoundArtifacts(arg('--output', path.join(repoRoot, 'integrations/sillytavern/.local/chat-memory-quality')), {
        round: `round-local-${label.toLowerCase().replaceAll('_', '-').slice(0, 32)}-${Date.now()}`,
    });
    try { await artifacts.write('summary.json', report); }
    finally { await artifacts.close(); }
}

async function main() {
    const mode = arg('--mode', '');
    if (mode === 'local-model') return localModelMain();
    if (!['browser', 'pipeline'].includes(mode)) throw new Error('PERF_MODE_REQUIRED');
    const round = arg('--round', `round-${new Date().toISOString().replace(/[^0-9]/g, '')}`);
    const artifacts = await createRoundArtifacts(arg('--output', path.join(repoRoot, 'integrations/sillytavern/.local/chat-memory-quality')), { round });
    const controller = new AbortController();
    const interrupt = () => controller.abort();
    process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
    let rows = [], calibration = null;
    try {
        if (mode === 'browser') {
            const { runBrowserCalibration } = await import('./lib/chat-memory-browser.mjs');
            const result = await runBrowserCalibration({
                warmSamples: Number(arg('--warm-runs', '50')), coldSamples: Number(arg('--cold-runs', '30')),
                histories: String(arg('--histories', '0,20,200,2000,20000')).split(',').map(Number),
                signal: controller.signal,
            });
            rows = result.samples; calibration = result.checks;
        } else {
            const source = arg('--dataset', '');
            if (!source) throw new Error('PERF_DATASET_REQUIRED');
            rows = (await fs.readFile(source, 'utf8')).trim().split('\n').filter(Boolean).map(line => validateSample(JSON.parse(line)));
        }
        const baselineFile = arg('--baseline', '');
        const baseline = baselineFile ? (await fs.readFile(baselineFile, 'utf8')).trim().split('\n').filter(Boolean)
            .map(line => validateSample({ ...JSON.parse(line), variant: 'baseline' })) : [];
        rows = rows.map(validateSample);
        const summary = summarizeSamples(rows);
        const comparison = baseline.length ? compareSamples(baseline, rows.map(row => ({ ...row, variant: 'candidate' }))) : [];
        const manifest = { schemaVersion: 1, mode, commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(),
            worktreeDirty: Boolean(execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: repoRoot, encoding: 'utf8' }).trim()),
            nodeVersion: process.version, platform: process.platform, arch: process.arch,
            seed: 20261106, planned: rows.length, completed: rows.filter(row => row.outcome === 'ok').length,
            actualCostCny: mode === 'browser' ? 0 : null, modelCalls: mode === 'browser' ? 0 : null,
            status: comparison.some(row => row.status === 'FAIL') || calibration?.status === 'FAIL' ? 'FAIL'
                : !rows.length || rows.some(row => row.outcome !== 'ok') || comparison.some(row => row.status === 'INCOMPLETE') ? 'INCOMPLETE' : 'PASS',
            browserCalibrationOnly: mode === 'browser', calibration };
        await artifacts.write('manifest.json', manifest);
        await artifacts.write('samples.jsonl', rows.map(row => JSON.stringify(row)).join('\n') + '\n');
        await artifacts.write('summary.json', { ...summary, comparison });
        await artifacts.write('comparison.md', comparisonMarkdown(summary, comparison));
        if (mode === 'browser') await artifacts.write('budget.json', { actualMicroCny: 0, calls: 0, paidRequestsAllowed: false });
        console.log(JSON.stringify({ ...manifest, groups: summary.groups.length }));
        if (manifest.status !== 'PASS') process.exitCode = 1;
    } catch (error) {
        await artifacts.write('summary.json', { schemaVersion: 1, status: 'INCOMPLETE', completed: rows.length });
        throw error;
    } finally {
        process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
        await artifacts.close();
    }
}

main().catch((error) => {
    const code = typeof error?.message === 'string' && /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'PERF_MEASURE_FAILED';
    console.error(code);
    process.exitCode = 1;
});
