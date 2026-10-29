import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { assembleMemorycore, memorycorePaths } from './lib/memorycore-managed.mjs';
import { ensureRerankContainer } from './lib/rerank-container.mjs';
import { createCallbackRunner } from '../memorycore-service/llm-runner.mjs';
import { createOllamaEmbedding } from '../memorycore-service/embedding.mjs';
import { queryParts } from '../memorycore-service/native-engine.mjs';
import { RERANK, calibrationReport, createRerankClient, selectRerankThreshold } from '../memorycore-service/rerank.mjs';

function percentile(values, ratio) {
    const nums = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
    if (!nums.length) return null;
    return nums[Math.min(nums.length - 1, Math.max(0, Math.ceil(nums.length * ratio) - 1))];
}

function maxFinite(values) {
    const nums = values.filter((value) => Number.isFinite(value));
    return nums.length ? Math.max(...nums) : null;
}

async function scoreUnits(client, query, documents, times) {
    const best = new Array(documents.length).fill(Number.NEGATIVE_INFINITY);
    for (const part of queryParts(query)) {
        if (!documents.length) continue;
        const started = Date.now();
        const scores = await client.rank(part, documents);
        times.push(Date.now() - started);
        scores.forEach((score, index) => {
            if (score > best[index]) best[index] = score;
        });
    }
    return best;
}

const runtime = await ensureRerankContainer();
const managedDev = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../.local/rerank-calibrate');
await fs.rm(managedDev, { recursive: true, force: true });
assembleMemorycore({ managedDev });
const paths = memorycorePaths(managedDev);
const api = await import(pathToFileURL(path.join(paths.run, 'upstream-api.mjs')));
const { openControlledEngine } = await import(pathToFileURL(path.join(paths.run, 'native-engine.mjs')));
const model = (await (await fetch('http://127.0.0.1:11438/api/tags')).json()).models.find((item) => item.name === 'qwen3-embedding:0.6b');
if (!model) throw new Error('embedding model is not loaded');
const snapshot = { provider: 'OLLAMA', endpoint: 'http://127.0.0.1:11438', model: model.name, artifactVersion: model.digest, dimensions: 1024,
    queryPreprocessingVersion: 'qwen3-retrieval-v1', documentPreprocessingVersion: 'identity-v1', normalization: 'l2', state: 'ENABLED', revision: 1, spaceId: 'rerank-calibration' };
const embedding = await createOllamaEmbedding(snapshot);
const scope = { ownerId: '101', instanceId: '7', mode: 'COMPANION', domainId: 'daily-7', profileScopeId: 'main' };
const fixture = JSON.parse(await fs.readFile(new URL('./fixtures/memorycore-calibration.json', import.meta.url), 'utf8'));
let extracted = [];
const engine = await openControlledEngine({ dataRoot: paths.data, api, embeddingFactory: async () => embedding,
    runnerFactory: (operationToken, stagingDir) => {
        if (stagingDir) {
            const counter = { value: 0 };
            return stage => {
                let step = 0;
                return createCallbackRunner({ baseURL: 'http://127.0.0.1:9', token: 't'.repeat(32), operationToken, stage, stagingDir, counter,
                    fetchImpl: async () => Response.json({ text: JSON.stringify(++step === 1 ? { tool: { name: 'write_to_file',
                        path: stage === 'l2-scene' ? 'scene_blocks/synthetic.md' : 'persona.md',
                        content: 'synthetic' } } : { text: 'done' }) }) });
            };
        }
        return { async run(prompt) {
            if (prompt.taskId === 'l1-conflict-detection') {
                const ids = [...prompt.prompt.matchAll(/m_\d+_[a-f0-9]+/g)].map((match) => match[0]);
                const fresh = ids.find(Boolean);
                if (!fresh) throw new Error('calibration fixture lost the proposed record');
                return JSON.stringify([{ record_id: fresh, action: 'store', target_ids: [] }]);
            }
            return JSON.stringify([{ scene_name: 'synthetic', message_ids: ['source1'], memories: extracted.map((doc) => ({ content: doc.content,
                type: 'episodic', priority: 50, source_message_ids: ['source1'], metadata: doc.eventDate ? { eventDate: doc.eventDate } : {} })) }]);
        } };
    },
});
const client = createRerankClient({ endpoint: runtime.endpoint, timeoutMs: 15000, threshold: RERANK.threshold });
const base = { scope, revision: 0, embedding: snapshot, allowedRecordIds: [], operationToken: 'synthetic-capability',
    messages: [{ id: 'source1', role: 'user', content: '隔离合成校准输入。', timestamp: '2026-10-28T00:00:00Z' }] };
    const lineTimes = [];
    const wholeTimes = [];
try {
    const stored = [];
    for (let offset = 0, n = 1; offset < fixture.documents.length; offset += 10, n += 1) {
        extracted = fixture.documents.slice(offset, offset + 10);
        const proposal = await engine.invoke('propose', { ...base, operationId: 'calibration' + n });
        await engine.invoke('commit', { scope, revision: 0, operationId: 'calibration' + n });
        stored.push(...proposal.records);
    }
    const idsByLabel = Object.fromEntries(fixture.documents.map((doc) => [doc.id, stored.find((row) => row.content === doc.content).id]));
    const rows = [];
    let l1NegativeMax = null;
    for (const item of fixture.queries) {
        const omitted = new Set(item.omit || []);
        const allowed = stored.map((row) => row.id).filter((id) => !omitted.has(fixture.documents.find((doc) => idsByLabel[doc.id] === id)?.id));
        const result = await engine.invoke('search', { scope, embedding: snapshot, allowedRecordIds: allowed, query: item.query, eventDate: item.eventDate,
            topK: 20, observe: true, rerank: client });
        const rank = Array.isArray(result?.rerankRank) ? result.rerankRank : [];
        if ((result?.stats?.rerankCandidates || 0) > 20) throw new Error('candidate cap exceeded');
        if (rank.length > 0 && result.stats?.rerankDecision !== 'applied') throw new Error(`measurement rerank ${result.stats?.rerankDecision || 'missing'}`);
        const labelOf = (id) => fixture.documents.find((doc) => idsByLabel[doc.id] === id)?.id;
        const scores = {};
        const pooled = [];
        for (const entry of rank) {
            const label = labelOf(entry.id);
            if (!label || !Number.isFinite(entry.score)) continue;
            scores[label] = entry.score;
            pooled.push(label);
        }
        const original = (result.rerankOriginal || []).map(labelOf).filter(Boolean);
        const injected = (Array.isArray(result.hits) ? result.hits : []).map((hit) => labelOf(hit.record_id)).filter(Boolean);
        rows.push({ expected: item.expected || null, pooled, scores, original, injected, kind: item.kind || '' });
        if (!item.expected) {
            const highest = maxFinite(pooled.map((label) => scores[label]));
            if (highest != null) l1NegativeMax = l1NegativeMax == null ? highest : Math.max(l1NegativeMax, highest);
        }
    }
    const lineScores = [];
    for (const item of fixture.queries) {
        const omitted = new Set(item.omit || []);
        const docs = fixture.documents.filter((doc) => !omitted.has(doc.id));
        const lines = docs.map((doc) => doc.content);
        const line = await scoreUnits(client, item.query, lines, lineTimes);
        const whole = await scoreUnits(client, item.query, [lines.join('\n')], wholeTimes);
        lineScores.push({ expected: item.expected || null, negative: !item.expected, line, whole: whole[0], labels: docs.map((doc) => doc.id) });
    }
    let lineNegativeMax = l1NegativeMax;
    let wholeNegativeMax = l1NegativeMax;
    for (const row of lineScores) {
        if (!row.negative) continue;
        const lineMax = maxFinite(row.line);
        const wholeMax = Number.isFinite(row.whole) ? row.whole : null;
        if (lineMax != null) lineNegativeMax = lineNegativeMax == null ? lineMax : Math.max(lineNegativeMax, lineMax);
        if (wholeMax != null) wholeNegativeMax = wholeNegativeMax == null ? wholeMax : Math.max(wholeNegativeMax, wholeMax);
    }
    const reports = ['line', 'whole'].map((unit) => {
        const negativeMax = unit === 'line' ? lineNegativeMax : wholeNegativeMax;
        const threshold = selectRerankThreshold(negativeMax);
        const recall = calibrationReport(rows, threshold);
        let gatePositiveHits = 0;
        let gateNegativeNonEmpty = 0;
        for (const row of lineScores) {
            const gateScore = unit === 'line' ? maxFinite(row.line) : row.whole;
            const pass = Number.isFinite(gateScore) && gateScore >= threshold;
            if (row.negative) gateNegativeNonEmpty += pass ? 1 : 0;
            else if (pass) gatePositiveHits += 1;
        }
        return { unit, threshold, negativeMax, positiveHits: recall.positiveHits, positives: recall.positives, top1Hits: recall.top1Hits,
            negativeNonEmpty: recall.negativeNonEmpty, gatePositiveHits, gateNegativeNonEmpty };
    });
    const eligible = reports.filter((item) => item.negativeNonEmpty === 0 && item.gateNegativeNonEmpty === 0);
    eligible.sort((a, b) => b.positiveHits - a.positiveHits || b.top1Hits - a.top1Hits || b.gatePositiveHits - a.gatePositiveHits || (a.unit === 'line' ? -1 : 1));
    const selected = eligible[0];
    if (!selected) throw new Error('no summary unit keeps negatives empty');
    const countSet = (rows, labelsOf) => {
        let positiveHits = 0;
        let top1Hits = 0;
        let negativeNonEmpty = 0;
        let positives = 0;
        let negatives = 0;
        rows.forEach((row, index) => {
            const labels = labelsOf(row, index);
            if (row.expected) {
                positives += 1;
                if (labels.includes(row.expected)) positiveHits += 1;
                if (labels[0] === row.expected) top1Hits += 1;
            } else {
                negatives += 1;
                if (labels.length) negativeNonEmpty += 1;
            }
        });
        return { positiveHits, positives, top1Hits, negatives, negativeNonEmpty };
    };
    const simulated = rows.map((row) => {
        const picked = new Set(row.original || []);
        for (const label of row.pooled || []) {
            if ((row.scores?.[label] ?? Number.NEGATIVE_INFINITY) >= selected.threshold) picked.add(label);
        }
        const labels = [...picked].sort((a, b) => (row.scores?.[b] ?? Number.NEGATIVE_INFINITY) - (row.scores?.[a] ?? Number.NEGATIVE_INFINITY));
        return labels;
    });
    const union = countSet(rows, (_row, index) => simulated[index]);
    const original = countSet(rows, (row) => row.original || []);
    const engineUnion = countSet(rows, (row) => row.injected || []);
    const pure = { positiveHits: selected.positiveHits, positives: selected.positives, top1Hits: selected.top1Hits, negativeNonEmpty: selected.negativeNonEmpty };
    if (union.positiveHits < union.positives || union.negativeNonEmpty !== 0) {
        process.stdout.write(`${JSON.stringify({ union, original, pure, engineUnion, threshold: selected.threshold })}\n`);
        process.exitCode = 2;
    } else process.stdout.write(`${JSON.stringify({
        documents: fixture.documents.length,
        queries: fixture.queries.length,
        positives: rows.filter((row) => row.expected).length,
        negatives: rows.filter((row) => !row.expected).length,
        l1NegativeMax,
        lineNegativeMax,
        wholeNegativeMax,
        selected,
        original,
        union,
        pure,
        engineUnion,
        reports,
        lineCalls: lineTimes.length,
        lineP50Ms: percentile(lineTimes, 0.5),
        lineP95Ms: percentile(lineTimes, 0.95),
        lineOver2s: lineTimes.filter((value) => value > 2000).length,
        wholeP50Ms: percentile(wholeTimes, 0.5),
        wholeP95Ms: percentile(wholeTimes, 0.95),
        endpointPort: runtime.port,
    })}\n`);
} finally {
    await engine.close();
    await fs.rm(paths.data, { recursive: true, force: true });
}
