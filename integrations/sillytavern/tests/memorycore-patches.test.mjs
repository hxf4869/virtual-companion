import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import { applySpecToText, validateSpec } from '../scripts/lib/patcher.mjs';

// Exact MIT upstream source at 084bed45cad6bb7f877455082cee82835d65671a.
// This one consumer fixture makes real patched ranking runnable offline;
// production code is always assembled from the separately verified checkout.
const fixture = new URL('./fixtures/memorycore/l1-candidate-recall.ts', import.meta.url);
const patchDir = new URL('../patches/memorycore/', import.meta.url);
async function loadRecall(t) {
    const spec = JSON.parse(await fs.readFile(new URL('10-relevance.json', patchDir), 'utf8'));
    const source = await fs.readFile(fixture, 'utf8');
    const patched = applySpecToText(source, spec);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-memorycore-recall-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await fs.mkdir(path.join(root, 'tools'));
    await fs.mkdir(path.join(root, 'store'));
    await fs.writeFile(path.join(root, 'package.json'), '{"type":"module"}');
    await fs.writeFile(path.join(root, 'store/tokenize.js'), 'export const buildFtsQuery = query => query;');
    await fs.writeFile(path.join(root, 'store/embedding.js'), 'export const hasClientEmbedding = service => Boolean(service);');
    const entry = path.join(root, 'tools/l1-candidate-recall.js');
    await fs.writeFile(entry, stripTypeScriptTypes(patched.output, { mode: 'transform' }));
    return (await import(pathToFileURL(entry).href)).recallL1Candidates;
}
function hit(id, score, extra = {}) {
    return { record_id: id, content: '合成内容', type: 'persona', priority: 50, scene_name: '合成场景',
        score, timestamp_str: '2026-10-28T12:00:00Z', timestamp_start: '', timestamp_end: '', version: 1,
        session_key: 'domain', session_id: 'domain', team_id: 'owner:1', task_id: '', user_id: '1', agent_id: 'instance:1',
        metadata_json: '{}', ...extra };
}
function params({ fts = [], vector = [] } = {}) {
    return { query: '合成查询', topK: 5,
        vectorStore: { isFtsAvailable: () => true, searchL1Fts: async () => fts, searchL1Vector: async () => vector },
        embeddingService: { embed: async () => new Float32Array([1, 0]) },
        filter: { allowedRecordIds: ['accepted', 'rejected'], minCosine: 0.8, minFtsScore: 0.4 } };
}

test('MemoryCore patch specifications pin the source and record four bounded patch groups', async () => {
    const index = JSON.parse(await fs.readFile(new URL('index.json', patchDir), 'utf8'));
    const groups = new Set(); let changed = 0;
    for (const file of index.specs) {
        const spec = JSON.parse(await fs.readFile(new URL(file, patchDir), 'utf8'));
        assert.deepEqual(validateSpec(spec), []);
        assert.equal(spec.upstream.commit, index.upstream_commit);
        assert.equal(spec.upstream.version, '1.0.2-beta.1');
        assert.ok(spec.validation.length > 0);
        changed += spec.changed_lines.added + spec.changed_lines.removed;
        groups.add(spec.group);
    }
    assert.equal(changed, index.changed_lines);
    assert.ok(changed <= 650, 'upstream patch expansion requires a new design decision');
    assert.deepEqual([...groups].sort(), ['cleanup', 'prefilter', 'proposal-commit', 'vector-space']);
});
test('patched recall rejects low relevance in both lanes before RRF and returns a real empty set', async t => {
    const recall = await loadRecall(t);
    const result = await recall(params({ fts: [hit('rejected', 0.39)], vector: [hit('rejected', 0.79)] }));
    assert.deepEqual(result.hits, []);
});
test('patched recall retains raw cosine/BM25 scores when both lanes fuse', async t => {
    const recall = await loadRecall(t);
    const result = await recall(params({ fts: [hit('accepted', 0.6, { ftsRank: -1.5 })], vector: [hit('accepted', 0.9)] }));
    assert.equal(result.strategy, 'hybrid');
    assert.equal(result.hits.length, 1);
    assert.equal(result.hits[0].cosine, 0.9);
    assert.equal(result.hits[0].ftsScore, 0.6);
    assert.equal(result.hits[0].ftsRank, -1.5);
    assert.equal(result.hits[0].score, 2 / 61);
});
test('dated generic schedule keeps a low cosine floor and near misses stay rejected', async t => {
    const recall = await loadRecall(t);
    const filter = { genericSchedule: true, dateCosineFloor: 0.30, minCosine: 0.58, minFtsScore: 0.80,
        cosineFloor: 0.50, ftsFloor: 0.58, cosineGap: 0.08, ftsGap: 0.20 };
    const dated = await recall({ ...params({ vector: [hit('day', 0.33)] }), filter });
    assert.equal(dated.hits.length, 1);
    assert.equal(dated.hits[0].cosine, 0.33);
    const topical = await recall({ ...params({ vector: [hit('day', 0.33)] }), filter: { ...filter, genericSchedule: false } });
    assert.deepEqual(topical.hits, []);
    const closed = { ...filter, genericSchedule: false };
    const band = await recall({ ...params({ fts: [hit('fact', 0.63)], vector: [hit('fact', 0.52)] }), filter: closed });
    assert.equal(band.hits.length, 1);
    assert.equal(band.hits[0].record_id, 'fact');
    const cat = await recall({ ...params({ vector: [hit('cat', 0.53)] }), filter: closed });
    assert.deepEqual(cat.hits, []);
    const pet = await recall({ ...params({ fts: [hit('name', 0.72)], vector: [hit('name', 0.44)] }), filter: closed });
    assert.deepEqual(pet.hits, []);
});
test('date-restricted lexical search does not reuse the calendar expression', async t => {
    const recall = await loadRecall(t);
    let seen;
    const input = params();
    input.vectorStore.searchL1Fts = async query => { seen = query; return []; };
    input.filter = { lexicalQuery: '参加什么' };
    await recall(input);
    assert.equal(seen, '参加什么');
});
test('rejected candidates do not consume RRF ranks or gain weight from the other lane', async t => {
    const recall = await loadRecall(t);
    const result = await recall(params({ fts: [hit('rejected', 0.39), hit('accepted', 0.6, { ftsRank: -1.5 })],
        vector: [hit('rejected', 0.79), hit('accepted', 0.9)] }));
    assert.deepEqual(result.hits.map(x => x.record_id), ['accepted']);
    assert.equal(result.hits[0].score, 2 / 61);
});
