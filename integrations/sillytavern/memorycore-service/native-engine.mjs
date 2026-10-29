import path from 'node:path';
import fs from 'node:fs/promises';
import { createControlledEngine } from './business.mjs';
import { createOllamaEmbedding } from './embedding.mjs';
import { createCallbackRunner } from './llm-runner.mjs';

// Calibrated on fixtures/memorycore-calibration.json (88 synthetic Chinese
// questions, 18 memories) with local qwen3-embedding:0.6b and
// qwen3-retrieval-v1. Gates run on each lane BEFORE upstream RRF.
// minCosine 0.58 stays: "我养的猫叫什么名字？" reaches 0.529 and an anniversary
// distractor reaches 0.563. minFtsScore 0.80 stays: "我的宠物名字是什么？"
// reaches FTS 0.757. The both-lane band (cosineFloor 0.50, ftsFloor 0.58,
// within 0.08 / 0.20 of that lane's best) keeps jointly supported paraphrases
// such as "我现在住哪儿？" (0.516/0.675) and "十月三十号我打算去哪、参加什么？"
// (0.513/0.631) while the credit-card distractor at cosine 0.493 stays out.
// dateCosineFloor 0.30 applies only when the caller already restricted the day
// and the question has no topical residual. The date-free summary
// "用户将去厦门参加朋友婚礼。" scores 0.387 on "10月30日我要去哪里？".
// Omitting the band fields reproduces the absolute accepts.
export const RELEVANCE = Object.freeze({
    minCosine: 0.58, minFtsScore: 0.80, cosineFloor: 0.50, ftsFloor: 0.58,
    cosineGap: 0.08, ftsGap: 0.20, dateCosineFloor: 0.30,
});
const SCHEDULE_PHRASES = ['有没有', '怎么样', '下周五', '下周一', '下周二', '下周三', '下周四', '下周六', '下周天', '下周日', '哪里', '哪儿', '什么', '安排', '打算', '准备', '事情', '行程', '活动', '计划', '如何', '哪天', '时候', '有何', '要去', '去哪', '何时', '几点', '干嘛', '干吗', '一下', '我们', '用户', '我的', '现在', '上次', '之前', '记得', '那个', '这个', '今天', '明天', '后天'].sort((a, b) => b.length - a.length);
const DATE_EXPRESSION = '(?:\\d{4}年)?\\d{1,2}月\\d{1,2}[日号]|\\d{4}-\\d{2}-\\d{2}|下周[一二三四五六日天]|今天|明天|后天|(?:\\d{4}年)?[一二三四五六七八九十]{1,3}月[一二三四五六七八九十]{1,3}[日号]';
const SCHEDULE_FUNCTION = /[我要去有的了在是和就不人都一上也很到说你会着看自己这他她它们那哪啥谁何吗吧呢啊呀哦嗯，。？！、：；“”""''（）()\s]/gu;
export function stripDate(text) { return text.replace(new RegExp(DATE_EXPRESSION, 'gu'), ' '); }
// A dated "what is on that day" question leaves no topic once the calendar
// expression and schedule wording are removed. "十一月六日我在哪里举行婚礼？"
// keeps 举行婚礼, so it does not use the date floor.
export function isGenericSchedule(question) {
    let text = stripDate(question);
    for (const phrase of SCHEDULE_PHRASES) text = text.split(phrase).join('');
    return text.replace(SCHEDULE_FUNCTION, '').length === 0;
}
export const OWNER_DATABASE_FILES = Object.freeze(['vectors.db', 'vectors.db-wal', 'vectors.db-shm']);
function toRecord(row) {
    return { id: row.record_id, content: row.content, type: row.type, priority: row.priority,
        scene_name: row.scene_name, metadata: JSON.parse(row.metadata_json || '{}'), version: row.version,
        teamId: row.team_id, userId: row.user_id, agentId: row.agent_id, sessionId: row.session_id, sessionKey: row.session_key,
        createdAt: row.created_time || row.timestamp_str, updatedAt: row.updated_time || row.timestamp_str, timestamps: [row.timestamp_str] };
}
export async function createNativeFactory(api) {
    return async dir => {
        const store = new api.VectorStore(path.join(dir, OWNER_DATABASE_FILES[0]), 0);
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
                    options: { prepareOnly: true, allowedRecordIds, recordedAt,
                        relevance: { minCosine: RELEVANCE.minCosine, minFtsScore: RELEVANCE.minFtsScore }, vectorStore: store,
                        embeddingService: store.getSpace()?.rebuilding ? undefined : queryEmbedding, llmRunner: runner } });
                if (!result.success) throw new Error('MEMORYCORE_EXTRACTION_FAILED');
                return JSON.parse(JSON.stringify(result.proposal || { records: [], targets: [] }));
            },
            async search({ query, topK, scope, allowedRecordIds, embedding, eventDate, dateRestricted = false }) {
                if (typeof query !== 'string' || !query || query.length > 20000) throw new Error('MEMORYCORE_QUERY');
                // Go already dropped other days when dateRestricted is set. Passing
                // eventDate again would drop records whose summary omits metadata.
                let ids = allowedRecordIds;
                let dated = dateRestricted === true;
                if (eventDate) {
                    ids = list(ids, scope).filter(r => (r.metadata.eventDate || r.metadata.activity_start_time?.slice(0, 10)) === eventDate).map(r => r.id);
                    dated = true;
                }
                if (!ids.length) return [];
                // Independent questions are embedded separately so one topic cannot
                // dilute another. Each part uses the same gates. Only a dated
                // generic schedule question may use the lower cosine floor.
                const parts = query.split(/[。？！!?；;]/u).map(part => part.trim())
                    .filter(part => part && !/^[（(][^？?]*[)）]$/u.test(part));
                const queries = parts.length >= 2 && parts.length <= 4 ? parts : [query];
                const hits = new Map();
                for (const question of queries) {
                    const genericSchedule = dated && isGenericSchedule(question);
                    const filter = { ...scope, allowedRecordIds: ids, ...RELEVANCE, genericSchedule };
                    // The date gate already consumed the calendar expression, so it
                    // must not also satisfy the lexical gate ("11月6日我去厦门吗？"
                    // otherwise matches the dentist row on the date tokens alone).
                    if (dated) filter.lexicalQuery = stripDate(question);
                    const result = await api.recallL1Candidates({ query: question, topK, vectorStore: store,
                        embeddingService: embedding ? { ...embedding, embed: embedding.embedQuery || embedding.embed } : undefined,
                        filter });
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
                if (!result.success) throw new Error(typeof result.error === 'string' && /^MEMORYCORE_[A-Z0-9_]+$/.test(result.error) ? result.error : 'MEMORYCORE_PROFILE_FAILED');
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
