import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { load as loadVec } from 'sqlite-vec';
import { assembleMemorycore, verifyMemorycoreUpstream, memorycorePaths } from './lib/memorycore-managed.mjs';
import { verifyNativeStore } from './w08-native-store-checks.mjs';
import { createCallbackRunner } from '../memorycore-service/llm-runner.mjs';
import { createOllamaEmbedding } from '../memorycore-service/embedding.mjs';

function prefilterGate() {
    const db = new DatabaseSync(':memory:', { allowExtension: true }); loadVec(db);
    try {
        const versions = db.prepare('SELECT sqlite_version() sqlite,vec_version() vec').get();
        assert.equal(versions.vec, 'v0.1.7-alpha.2');
        db.exec('CREATE VIRTUAL TABLE v USING vec0(record_id TEXT PRIMARY KEY, embedding float[2] distance_metric=cosine); CREATE VIRTUAL TABLE f USING fts5(content,record_id UNINDEXED)');
        const vec = a => Buffer.from(new Float32Array(a).buffer), insert = db.prepare('INSERT INTO v VALUES(?,?)'), fts = db.prepare('INSERT INTO f VALUES(?,?)');
        db.exec('BEGIN');
        for (let i = 0; i < 10000; i++) { insert.run('out-' + i, vec([1, 0])); fts.run('wedding wedding wedding', 'out-' + i); }
        for (let i = 0; i < 5; i++) { insert.run('in-' + i, vec([.8 - i * .1, .6 + i * .1])); fts.run('wedding ' + 'filler '.repeat(50 + i), 'in-' + i); }
        db.exec('COMMIT');
        const ids = ['in-0','in-1','in-2'];
        const knn = 'SELECT record_id,distance FROM v WHERE embedding MATCH ? AND k=3';
        assert.equal(db.prepare(knn).all(vec([1, 0])).filter(x => ids.includes(x.record_id)).length, 0);
        const pre = db.prepare(knn + ' AND record_id IN (SELECT value FROM json_each(?)) ORDER BY distance');
        assert.deepEqual(pre.all(vec([1, 0]), JSON.stringify(ids)).map(r => r.record_id), ids);
        assert.deepEqual(pre.all(vec([1, 0]), '[]'), []);
        const preFts = db.prepare('SELECT record_id,bm25(f) rank FROM f WHERE f MATCH ? AND record_id IN (SELECT value FROM json_each(?)) ORDER BY rank LIMIT 3');
        assert.deepEqual(preFts.all('wedding', JSON.stringify(ids)).map(r => r.record_id), ids);
        assert.deepEqual(preFts.all('wedding', '[]'), []);
        return { ...versions, node: process.version, outside: 10000, inside: 5, topK: 3, checks: 5 };
    } finally { db.close(); }
}
export async function sceneMemorycoreNative(ctx) {
    process.umask(0o077);
    const started = Date.now(), checks = [];
    const gate = prefilterGate(); checks.push('KNN/FTS-before-topK-and-empty');
    verifyMemorycoreUpstream();
    const managedDev = path.join(ctx.artifactsDir, 'memorycore-native');
    assembleMemorycore({ managedDev });
    const paths = memorycorePaths(managedDev);
    const api = await import(pathToFileURL(path.join(paths.run, 'upstream-api.mjs')));
    const nativeChecks = await verifyNativeStore(api); checks.push(`native-store-${nativeChecks}-checks`);
    const { openControlledEngine, RELEVANCE } = await import(pathToFileURL(path.join(paths.run, 'native-engine.mjs')));
    const model = (await (await fetch('http://127.0.0.1:11438/api/tags')).json()).models.find(m => m.name === 'qwen3-embedding:0.6b');
    assert.ok(model);
    const snapshot = { provider: 'OLLAMA', endpoint: 'http://127.0.0.1:11438', model: model.name, artifactVersion: model.digest, dimensions: 1024,
        queryPreprocessingVersion: 'qwen3-retrieval-v1', documentPreprocessingVersion: 'identity-v1', normalization: 'l2', state: 'ENABLED', revision: 1, spaceId: 'synthetic-space-1' };
    const real = await createOllamaEmbedding(snapshot), cache = new Map();
    const memo = async (kind, text) => { const key = kind + text; if (!cache.has(key)) cache.set(key, real[kind](text)); return cache.get(key); };
    const embedding = { ...real, embed: text => memo('embed', text), embedQuery: text => memo('embedQuery', text),
        embedBatch: async texts => { const out=[]; for (const text of texts) out.push(await memo('embed', text)); return out; } };
    const scope = { ownerId: '101', instanceId: '7', mode: 'COMPANION', domainId: 'daily-7', profileScopeId: 'main' };
    let extracted = [], replacement, failModel = false, failPublication = false;
    const engine = await openControlledEngine({ dataRoot: paths.data, api, embeddingFactory: async () => embedding,
        publishHook: async () => { if (failPublication) { failPublication = false; throw new Error('INJECTED_PUBLICATION_FAILURE'); } },
        runnerFactory: (operationToken, stagingDir) => {
            if (stagingDir) {
                const counter = { value: 0 };
                return stage => {
                    let step = 0;
                    return createCallbackRunner({ baseURL: 'http://127.0.0.1:8095', token: 't'.repeat(32), operationToken, stage, stagingDir, counter,
                        fetchImpl: async () => Response.json({ text: JSON.stringify(++step === 1 ? { tool: { name: 'write_to_file',
                            path: stage === 'l2-scene' ? 'scene_blocks/synthetic.md' : 'persona.md',
                            content: stage === 'l2-scene' ? '-----META-START-----\ncreated: 2026-10-28\nupdated: 2026-10-28\nsummary: 合成画像\nheat: 1\n-----META-END-----\n合成记忆摘要。' : '# 合成画像\n这是核验输入派生的隔离画像。' } } : { text: 'done' }) }),
                    });
                };
            }
            return { async run(p) {
            if (failModel) throw new Error('MEMORYCORE_CALLBACK_TIMEOUT');
            if (p.taskId === 'l1-conflict-detection') {
                const ids = [...p.prompt.matchAll(/m_\d+_[a-f0-9]+/g)].map(m => m[0]);
                const fresh = ids.find(id => id !== replacement);
                assert.ok(fresh, 'fixture can identify proposed record');
                return JSON.stringify([{ record_id: fresh, action: replacement ? 'update' : 'store', target_ids: replacement ? [replacement] : [] }]);
            }
            return JSON.stringify([{ scene_name: 'synthetic', message_ids: ['source1'], memories: extracted.map(d => ({ content: d.content,
                type: 'episodic', priority: 50, source_message_ids: ['source1'], metadata: d.eventDate ? { eventDate: d.eventDate } : {} })) }]);
        } }; },
    });
    const fixture = JSON.parse(await fs.readFile(new URL('./fixtures/memorycore-calibration.json', import.meta.url), 'utf8'));
    const base = { scope, revision: 0, embedding: snapshot, allowedRecordIds: [], operationToken: 'synthetic-capability',
        messages: [{ id: 'source1', role: 'user', content: '这是隔离合成验收输入，记录测试记忆，不是真实用户的个人信息。', timestamp: '2026-10-28T00:00:00Z' }] };
    try {
        extracted = fixture.documents;
        // Upstream default max memories is 10; use two bounded batches.
        extracted = fixture.documents.slice(0, 10);
        const p = await engine.invoke('propose', { ...base, operationId: 'calibration1' });
        const pAgain = await engine.invoke('propose', { ...base, operationId: 'calibration1' }); assert.deepEqual(pAgain, p);
        assert.equal((await engine.invoke('export-owner', { scope })).records.length, 0); checks.push('proposal-no-live-write-and-replay');
        failPublication = true;
        await assert.rejects(engine.invoke('commit', { scope, revision: 0, operationId: 'calibration1' }), /PUBLICATION/);
        assert.equal((await engine.invoke('operation-status', { scope, operationId: 'calibration1' })).status, 'publishing');
        const receipt = await engine.invoke('commit', { scope, revision: 0, operationId: 'calibration1' });
        assert.equal(receipt.status, 'published'); checks.push('partial-publication-resume');
        extracted = fixture.documents.slice(10);
        const p2 = await engine.invoke('propose', { ...base, operationId: 'calibration2' });
        await engine.invoke('commit', { scope, revision: 0, operationId: 'calibration2' });
        const all = [...p.records, ...p2.records];
        const ids = all.map(r => r.id), idsByLabel = Object.fromEntries(fixture.documents.map(d => [d.id, all.find(r => r.content === d.content).id]));
        assert.deepEqual(await engine.invoke('search', { scope, embedding: snapshot, allowedRecordIds: [], query: '婚礼' }), []);
        for (const changed of [{ ownerId: '102' }, { instanceId: '8' }, { mode: 'STORY' }]) {
            assert.deepEqual(await engine.invoke('search', { scope: { ...scope, ...changed }, embedding: snapshot, allowedRecordIds: ids, query: '我的婚礼什么时候举行？' }), []);
        }
        assert.deepEqual(await engine.invoke('search', { scope: { ...scope, profileScopeId: 'branch-b' }, embedding: snapshot, allowedRecordIds: [], query: '我的婚礼什么时候举行？' }), []);
        checks.push('M03-M07-owner-instance-mode-branch-empty-scope');
        const calibration = [];
        for (const item of fixture.queries) {
            const hits = await engine.invoke('search', { scope, embedding: snapshot, allowedRecordIds: ids, query: item.query, eventDate: item.eventDate });
            calibration.push({ kind: item.kind, expected: item.expected, hit: item.expected ? hits.some(h => h.record_id === idsByLabel[item.expected]) : hits.length === 0,
                candidates: hits.map(h => ({ label: fixture.documents.find(d => idsByLabel[d.id] === h.record_id)?.id, cosine: h.cosine, ftsScore: h.ftsScore })) });
            if (!item.expected) assert.equal(hits.length, 0, `negative ${item.kind}`);
            if (item.eventDate) assert.ok(hits.every(h => h.record_id !== idsByLabel.wedding));
        }
        const inherited = await engine.invoke('search', { scope: { ...scope, profileScopeId: 'branch-b' }, embedding: snapshot, allowedRecordIds: [idsByLabel.wedding], query: '我的婚礼什么时候举行？' });
        assert.deepEqual(inherited.map(h => h.record_id), [idsByLabel.wedding]); checks.push('M07-branch-inherits-only-Go-allowed-IDs');
        const positives = calibration.filter(r => r.expected), negatives = calibration.filter(r => !r.expected);
        assert.ok(positives.filter(r => r.hit).length >= 13); checks.push('calibration-positive-paraphrase-no-answer-distractor-M11');
        const staged = await engine.invoke('rebuild-profile', { ...base, operationId: 'profile1', allowedRecordIds: ids });
        assert.equal(staged.status, 'staged');
        assert.equal((await fs.readdir(path.join(paths.data, 'owners/101/profiles'))).length, 0);
        const publishedProfile = await engine.invoke('rebuild-profile', { ...base, operationId: 'profile1', allowedRecordIds: ids,
            publish: true, verifiedDependencies: staged.dependencies });
        assert.equal(publishedProfile.status, 'published'); checks.push('L2-L3-restricted-tools-staging-verified-publication');
        // Same logical domain, different real source: replacement is version-checked.
        replacement = idsByLabel.tea; extracted = [{ content: '我最爱喝茉莉花茶，现在喝咖啡已经不会心悸了。' }];
        const corrected = await engine.invoke('propose', { ...base, operationId: 'correction', allowedRecordIds: [replacement],
            messages: [{ ...base.messages[0], id: 'source2', content: extracted[0].content }] });
        assert.ok(corrected.targets.some(t => t.id === replacement));
        await engine.invoke('commit', { scope, revision: 0, operationId: 'correction' });
        assert.ok(!(await engine.invoke('export-owner', { scope })).records.some(r => r.id === replacement)); checks.push('M02-correction-same-logical-domain');
        failModel = true;
        await assert.rejects(engine.invoke('propose', { ...base, operationId: 'timeout' }), /TIMEOUT/); failModel = false;
        assert.equal((await engine.invoke('operation-status', { scope, operationId: 'timeout' })).status, 'failed'); checks.push('timeout-is-failure');
        replacement = undefined; extracted = [{ content: '隔离测试的迟到提案不能在遗忘之后恢复。' }];
        await engine.invoke('propose', { ...base, operationId: 'late' });
        const forgotten = await engine.invoke('forget', { scope, revision: 0, recordIds: [corrected.records[0].id] });
        await assert.rejects(engine.invoke('commit', { scope, revision: 0, operationId: 'late' }), /REVISION/);
        assert.equal(forgotten.status, 'cleared'); checks.push('M04-forget-revokes-late-commit');
        const changedSpace = { ...snapshot, spaceId: 'synthetic-space-2', revision: 2 };
        const during = await engine.invoke('search', { scope, embedding: changedSpace, allowedRecordIds: [idsByLabel.book], query: '我最近在读哪本小说？' });
        assert.ok(during.every(h => h.cosine === undefined)); checks.push('MODEL05-rebuilding-lexical-only');
        await assert.rejects(engine.invoke('search', { scope, embedding: snapshot, allowedRecordIds: [idsByLabel.book], query: '我最近在读哪本小说？' }), /SPACE_CONFIG_REVISION/);
        assert.equal((await engine.invoke('rebuild-space', { scope, embedding: changedSpace })).ready, true);
        const rebuilt = await engine.invoke('search', { scope, embedding: changedSpace, allowedRecordIds: [idsByLabel.book], query: '我最近在读哪本小说？' });
        assert.ok(rebuilt.some(h => h.cosine >= RELEVANCE.minCosine)); checks.push('MODEL05-complete-rebuild-restores-vectors');
        assert.equal((await engine.invoke('clear-owner', { scope, revision: forgotten.revision })).status, 'cleared');
        const cleared = await engine.invoke('export-owner', { scope });
        assert.equal(cleared.records.length + cleared.sources.length + cleared.profiles.length + cleared.jsonl.length, 0);
        await assert.rejects(engine.invoke('propose', { ...base, operationId: 'resurrect' }), /REVISION/); checks.push('clear-owner-all-domains-and-no-resurrection');
        ctx.results.memorycoreNative = { gate, checks, passed: checks.length, ms: Date.now() - started, thresholds: RELEVANCE,
            calibration: { positives: positives.length, positiveHits: positives.filter(r => r.hit).length, negatives: negatives.length,
                negativeEmpty: negatives.filter(r => r.hit).length, rows: calibration }, productionAuthority: false };
    } finally { await engine.close(); await fs.rm(paths.data, { recursive: true, force: true }); }
}
