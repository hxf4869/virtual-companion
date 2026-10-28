import path from 'node:path';
import fs from 'node:fs/promises';
import { createControlledEngine } from './business.mjs';
import { createOllamaEmbedding } from './embedding.mjs';
import { createCallbackRunner } from './llm-runner.mjs';

// Calibrated against fixtures/memorycore-calibration.json with qwen3 0.6b Q8_0,
// qwen3-retrieval-v1. Scores are applied to each lane BEFORE upstream RRF.
export const RELEVANCE = Object.freeze({ minCosine: 0.58, minFtsScore: 0.80 });
function toRecord(row) {
    return { id: row.record_id, content: row.content, type: row.type, priority: row.priority,
        scene_name: row.scene_name, metadata: JSON.parse(row.metadata_json || '{}'), version: row.version,
        teamId: row.team_id, userId: row.user_id, agentId: row.agent_id, sessionId: row.session_id, sessionKey: row.session_key,
        createdAt: row.created_time || row.timestamp_str, updatedAt: row.updated_time || row.timestamp_str, timestamps: [row.timestamp_str] };
}
export async function createNativeFactory(api) {
    return async dir => {
        const store = new api.VectorStore(path.join(dir, 'vectors.db'), 0);
        await store.init();
        const list = (ids, scope) => store.queryL1Records({ ...scope, ...(ids ? { recordIds: ids } : {}) }).map(toRecord);
        return {
            getScope: key => store.getScope(key), getSpace: () => store.getSpace(),
            configureSpace: (id, dimensions) => store.configureSpace(id, dimensions),
            finishSpaceRebuild: (id, failures) => store.finishSpaceRebuild(id, failures),
            rebuildVector: (r, vector, id) => store.writeRebuiltVector(r.id, vector, id),
            getOperation: id => store.getOperation(id), invalidateScope: key => store.invalidateScope(key),
            commitPrepared: p => store.commitPrepared(p), forgetRecords: (ids, scope) => store.forgetRecords(ids, scope), list,
            listSources: () => store.getRawDb().prepare('SELECT * FROM l0_conversations ORDER BY record_id').all(),
            forgetSources: (ids, scope) => store.forgetSources(ids, scope),
            async prepare({ messages, scope, allowedRecordIds, runner, embedding, recordedAt }) {
                const queryEmbedding = { ...embedding, embed: embedding.embedQuery || embedding.embed,
                    embedBatch: async texts => { const out = []; for (const text of texts) out.push(await (embedding.embedQuery || embedding.embed)(text)); return out; } };
                const result = await api.extractL1Memories({ messages, ...scope, baseDir: dir, config: {},
                    options: { prepareOnly: true, allowedRecordIds, recordedAt, relevance: RELEVANCE, vectorStore: store,
                        embeddingService: store.getSpace()?.rebuilding ? undefined : queryEmbedding, llmRunner: runner } });
                if (!result.success) throw new Error('MEMORYCORE_EXTRACTION_FAILED');
                return JSON.parse(JSON.stringify(result.proposal || { records: [], targets: [] }));
            },
            async search({ query, topK, scope, allowedRecordIds, embedding, eventDate }) {
                if (typeof query !== 'string' || !query || query.length > 20000) throw new Error('MEMORYCORE_QUERY');
                // Date was normalized by Go; hard exclusion precedes retrieval and
                // remains enforced by Go before final prompt injection in W08-4.
                let ids = allowedRecordIds;
                if (eventDate) ids = list(ids, scope).filter(r => (r.metadata.eventDate || r.metadata.activity_start_time?.slice(0, 10)) === eventDate).map(r => r.id);
                if (!ids.length) return [];
                // Independent questions must each pass the same relevance gates.
                // Embedding a multi-topic paragraph once can dilute a valid fact
                // below threshold; no threshold is relaxed and IDs stay scoped.
                const parts = query.split(/[。？！!?；;]/u).map(part => part.trim())
                    .filter(part => part && !/^[（(][^？?]*[)）]$/u.test(part));
                const queries = parts.length >= 2 && parts.length <= 4 ? parts : [query];
                const hits = new Map();
                for (const question of queries) {
                    const result = await api.recallL1Candidates({ query: question, topK, vectorStore: store,
                        embeddingService: embedding ? { ...embedding, embed: embedding.embedQuery || embedding.embed } : undefined,
                        filter: { ...scope, allowedRecordIds: ids, ...RELEVANCE } });
                    for (const hit of result.hits) {
                        const prior = hits.get(hit.record_id);
                        if (!prior || hit.score > prior.score) hits.set(hit.record_id, hit);
                    }
                }
                return [...hits.values()].sort((a, b) => b.score - a.score).slice(0, topK);
            },
            async rebuildProfile({ records, stagingDir, scope, runner }) {
                const storage = new api.StorageAdapter(new api.LocalStorageBackend({ rootDir: stagingDir }));
                const scene = new api.SceneExtractor({ dataDir: stagingDir, config: {}, storage, llmRunner: runner('l2-scene'), traceContext: scope });
                const result = await scene.extract(records.map(r => ({ id: r.id, content: r.content, created_at: r.createdAt })));
                if (!result.success) throw new Error('MEMORYCORE_PROFILE_FAILED');
                const persona = new api.PersonaGenerator({ dataDir: stagingDir, config: {}, storage, llmRunner: runner('l3-persona'), traceContext: scope });
                if (await persona.generateLocalPersona() === 'failed') throw new Error('MEMORYCORE_PROFILE_FAILED');
                await fs.access(path.join(stagingDir, 'persona.md'));
            },
            close: () => store.close(),
        };
    };
}
export async function openControlledEngine({ dataRoot, callbackBaseURL, callbackToken, api, embeddingFactory = createOllamaEmbedding, runnerFactory, publishHook }) {
    api ||= await import('./upstream-api.mjs');
    return createControlledEngine({ dataRoot, nativeFactory: await createNativeFactory(api), embeddingFactory, publishHook,
        runnerFactory: runnerFactory || ((operationToken, stagingDir) => {
            const counter = { value: 0 };
            const make = stage => createCallbackRunner({ baseURL: callbackBaseURL, token: callbackToken, operationToken, stage, stagingDir, counter });
            if (stagingDir) return make;
            return { run: p => make(p.taskId === 'l1-conflict-detection' ? 'l1-conflict-detection' : 'l1-extraction').run(p) };
        }),
    });
}
