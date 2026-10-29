import path from 'node:path';
import fs from 'node:fs/promises';
import { createControlledEngine } from './business.mjs';
import { createOllamaEmbedding, embeddingCacheStats } from './embedding.mjs';
import { createCallbackRunner } from './llm-runner.mjs';
import { engineRerank, looseRetrievalFilter, summaryUnits } from './rerank.mjs';

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
function cosine(left, right) {
    if (!left || !right || left.length !== right.length || left.length === 0) return 0;
    let dot = 0, leftNorm = 0, rightNorm = 0;
    for (let i = 0; i < left.length; i++) {
        dot += left[i] * right[i];
        leftNorm += left[i] * left[i];
        rightNorm += right[i] * right[i];
    }
    if (leftNorm === 0 || rightNorm === 0) return 0;
    return dot / Math.sqrt(leftNorm * rightNorm);
}
function lexicalOverlap(query, text) {
    const tokens = [];
    let ascii = '';
    const han = [];
    const flush = () => { if (ascii.length >= 2) tokens.push(ascii.toLowerCase()); ascii = ''; };
    for (const ch of query) {
        if (/[A-Za-z0-9]/u.test(ch)) ascii += ch;
        else flush();
        if (/[\u4e00-\u9fff]/u.test(ch)) {
            han.push(ch);
            if (han.length >= 2) tokens.push(han.slice(-2).join(''));
        } else han.length = 0;
    }
    flush();
    if (tokens.length === 0) return 0;
    const folded = text.toLowerCase();
    return tokens.filter((token) => folded.includes(token)).length / tokens.length;
}
function sharedHanSpan(query, text, length) {
    const han = [];
    for (const ch of query) {
        if (/[\u4e00-\u9fff]/u.test(ch)) {
            han.push(ch);
            if (han.length > length) han.shift();
            if (han.length === length && text.includes(han.join(''))) return true;
        } else han.length = 0;
    }
    return false;
}
// Same absolute cosine, dated generic floor, and both-lane band as L1 recall.
// The summary is not an L1 row, so its lexical lane is token overlap.
export function queryParts(query) {
    const parts = String(query).split(/[。？！!?；;]/u).map(part => part.trim())
        .filter(part => part && !/^[（(][^？?]*[)）]$/u.test(part));
    return parts.length >= 2 && parts.length <= 4 ? parts : [query];
}
async function summaryPartPasses(query, text, embedding, dated) {
    if (typeof text !== 'string' || !text.trim()) return false;
    // A question and a stored summary are not the same embedding input. When
    // both sides exist, do not let a single embedBatch treat them alike.
    let vectors;
    if (typeof embedding?.embedQuery === 'function' && typeof embedding?.embed === 'function') vectors = [await embedding.embedQuery(query), await embedding.embed(text)];
    else if (typeof embedding?.embedBatch === 'function') vectors = await embedding.embedBatch([query, text]);
    else if (typeof embedding?.embed === 'function') vectors = [await embedding.embed(query), await embedding.embed(text)];
    else return false;
    const score = cosine(vectors[0], vectors[1]);
    if (score >= RELEVANCE.minCosine) return true;
    if (dated && isGenericSchedule(query) && score >= RELEVANCE.dateCosineFloor) return true;
    return score >= RELEVANCE.cosineFloor && lexicalOverlap(query, text) >= RELEVANCE.ftsFloor;
}
// A persona template dilutes one fact below the cosine floor. Score a content
// line that shares a word with the question before scoring the whole file.
function summarySegments(question, text) {
    const lines = String(text).split(/\n/u).map(line => line.trim())
        .filter(line => [...line].length >= 8 && sharedHanSpan(question, line, 4));
    return lines.length ? lines : [text];
}
// Independent questions are scored separately. One dated clause must not
// dilute an undated topic that the summary actually answers.
export async function summaryPassesGate(query, text, embedding, dated, rerank) {
    if (rerank?.enabled && typeof rerank.rank === 'function') {
        try {
            for (const question of queryParts(query)) {
                const units = summaryUnits(text, rerank.summaryUnit, rerank.candidateLimit || 20);
                if (!units.length) continue;
                const scores = await rerank.rank(question, units);
                if (scores.some((score) => Number.isFinite(score) && score >= rerank.threshold)) return true;
            }
            // Union with the original gate below, same as L1 candidates.
        } catch (error) {
            if (typeof rerank.onGateFallback === 'function') rerank.onGateFallback(error);
        }
    }
    for (const question of queryParts(query)) {
        for (const segment of summarySegments(question, text)) {
            if (await summaryPartPasses(question, segment, embedding, dated)) return true;
        }
    }
    return false;
}
const CONTENT_FUNCTION = new Set('的了我你他她它是在有不了吗呢吧啊呀这那和与或而就都也很到说会着看还要去把被给让从对向跟及');
function contentNgrams(text, length) {
    const out = [];
    const han = [];
    for (const ch of String(text)) {
        if (!/[\u4e00-\u9fff]/u.test(ch)) { han.length = 0; continue; }
        han.push(ch);
        if (han.length > length) han.shift();
        if (han.length === length && han.every(item => !CONTENT_FUNCTION.has(item))) out.push(han.join(''));
    }
    return out;
}
function keywordClauses(query) {
    const parts = String(query).split(/[，,。？！!?；;]/u).map(part => part.trim()).filter(Boolean);
    return parts.length ? parts : [String(query)];
}
// Second path for a record both lanes already rejected. It does not lower
// minCosine or minFtsScore. Two distinctive content bigrams, or one content
// trigram, plus cosine at the existing floor, are required. Comma clauses are
// scored separately so an unrelated tail cannot dilute the matching clause.
async function keywordRecover(questions, records, embedding, taken) {
    if (typeof embedding?.embedQuery !== 'function' || typeof embedding?.embed !== 'function') return [];
    const found = [];
    for (const record of records) {
        if (!record || taken.has(record.id) || typeof record.content !== 'string') continue;
        const bigrams = new Set(contentNgrams(record.content, 2));
        const trigrams = new Set(contentNgrams(record.content, 3));
        let best = 0;
        let matched = false;
        for (const question of questions) {
            for (const clause of keywordClauses(question)) {
                const shared = new Set(contentNgrams(clause, 2).filter(gram => bigrams.has(gram)));
                const trigram = contentNgrams(clause, 3).some(gram => trigrams.has(gram));
                if (shared.size < 2 && !trigram) continue;
                const score = cosine(await embedding.embedQuery(clause), await embedding.embed(record.content));
                if (score >= RELEVANCE.cosineFloor && score > best) { best = score; matched = true; }
            }
        }
        if (matched) found.push({ record_id: record.id, score: 1e-6, cosine: best, ftsScore: null });
    }
    return found;
}
function emptyRecallStats() {
    return { summaryGateAllow: 0, summaryGateReject: 0, profileGateAllow: 0, profileGateReject: 0, embeddingCacheHit: 0, embeddingCacheMiss: 0, recallEmpty: 0,
        rerankDecision: 'disabled', rerankCandidates: 0, rerankKept: 0, rerankOnly: 0, rerankFallback: 0, rerankGateFallback: 0 };
}
function rerankFailureCode(error) {
    if (error?.code === 'timeout' || error?.code === 'invalid' || error?.code === 'unavailable') return error.code;
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return 'timeout';
    return 'unavailable';
}
function resolveRerank(explicit) {
    if (explicit === false || explicit?.enabled === false) return { enabled: false };
    if (explicit && typeof explicit.rank === 'function') return { candidateLimit: 20, summaryUnit: 'line', ...explicit, enabled: true };
    return engineRerank();
}
export async function looseCandidateHits(api, store, questions, ids, scope, embedding, dated, limit) {
    const merged = new Map();
    for (const question of questions) {
        const filter = { ...scope, allowedRecordIds: ids, ...looseRetrievalFilter() };
        if (dated) filter.lexicalQuery = stripDate(question);
        const result = await api.recallL1Candidates({ query: question, topK: limit, vectorStore: store,
            embeddingService: embedding ? { ...embedding, embed: embedding.embedQuery || embedding.embed } : undefined, filter });
        for (const hit of result.hits || []) {
            if (!hit?.record_id || typeof hit.content !== 'string' || !hit.content) continue;
            const prior = merged.get(hit.record_id);
            if (!prior || hit.score > prior.score) merged.set(hit.record_id, hit);
        }
    }
    return [...merged.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}
// The current cosine/FTS gates, including keyword recovery. This is the injection
// set used when the reranker is off, and one side of the union when it is on.
async function originalGateHits(api, store, queries, ids, scope, embedding, dated, topK) {
    const hits = new Map();
    for (const question of queries) {
        const genericSchedule = dated && isGenericSchedule(question);
        const filter = { ...scope, allowedRecordIds: ids, ...RELEVANCE, genericSchedule };
        if (dated) filter.lexicalQuery = stripDate(question);
        const result = await api.recallL1Candidates({ query: question, topK, vectorStore: store,
            embeddingService: embedding ? { ...embedding, embed: embedding.embedQuery || embedding.embed } : undefined,
            filter });
        for (const hit of result.hits) {
            const prior = hits.get(hit.record_id);
            if (!prior || hit.score > prior.score) hits.set(hit.record_id, hit);
        }
    }
    for (const hit of await keywordRecover(queries, listRecords(store, ids, scope), embedding, new Set(hits.keys()))) hits.set(hit.record_id, hit);
    return [...hits.values()].sort((a, b) => b.score - a.score);
}
function listRecords(store, ids, scope) {
    return store.queryL1Records({ ...scope, ...(ids ? { recordIds: ids } : {}) }).map(toRecord);
}
async function collectGates(query, gateTexts, embedding, dated, stats, rerank) {
    const gated = [];
    if (!Array.isArray(gateTexts)) return gated;
    for (const item of gateTexts) {
        if (!item || typeof item.id !== 'string' || typeof item.text !== 'string') continue;
        const allowed = await summaryPassesGate(query, item.text, embedding, dated, rerank);
        if (stats) {
            const profile = item.id === 'persona';
            stats[allowed ? (profile ? 'profileGateAllow' : 'summaryGateAllow') : (profile ? 'profileGateReject' : 'summaryGateReject')]++;
        }
        if (allowed) gated.push(item.id);
    }
    return gated;
}
function toRecord(row) {
    return { id: row.record_id, content: row.content, type: row.type, priority: row.priority,
        scene_name: row.scene_name, metadata: JSON.parse(row.metadata_json || '{}'), version: row.version,
        teamId: row.team_id, userId: row.user_id, agentId: row.agent_id, sessionId: row.session_id, sessionKey: row.session_key,
        createdAt: row.created_time || row.timestamp_str, updatedAt: row.updated_time || row.timestamp_str, timestamps: [row.timestamp_str] };
}
export async function createNativeFactory(api) {
    return async dir => {
        const store = new api.VectorStore(path.join(dir, OWNER_DATABASE_FILES[0]), 0);
        // The connection is opened inside VectorStore. Same-database FTS5 and
        // sqlite-vec shadow tables share it, so this covers their freed pages.
        if (typeof store.getRawDb === 'function') store.getRawDb().exec('PRAGMA secure_delete = ON');
        await store.init();
        const list = (ids, scope) => store.queryL1Records({ ...scope, ...(ids ? { recordIds: ids } : {}) }).map(toRecord);
        return {
            getScope: key => store.getScope(key), getSpace: () => store.getSpace(),
            configureSpace: (id, dimensions) => store.configureSpace(id, dimensions),
            finishSpaceRebuild: (id, failures) => store.finishSpaceRebuild(id, failures),
            rebuildVector: (r, vector, id) => store.writeRebuiltVector(r.id, vector, id),
            getOperation: id => store.getOperation(id), invalidateScope: key => store.invalidateScope(key),
            commitPrepared: p => store.commitPrepared(p), forgetRecords: (ids, scope) => store.forgetRecords(ids, scope),
            checkpoint() {
                const row = store.getRawDb().prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
                if (!row || Number(row.busy) !== 0) throw new Error('MEMORYCORE_WAL_CHECKPOINT');
            },
            list,
            listSources: () => store.getRawDb().prepare('SELECT * FROM l0_conversations ORDER BY record_id').all(),
            forgetSources: (ids, scope) => store.forgetSources(ids, scope),
            async prepare({ messages, scope, allowedRecordIds, runner, embedding, recordedAt }) {
                const queryEmbedding = { ...embedding, embed: embedding.embedQuery || embedding.embed,
                    embedBatch: async texts => { const out = []; for (const text of texts) out.push(await (embedding.embedQuery || embedding.embed)(text)); return out; } };
                const result = await api.extractL1Memories({ messages, ...scope, baseDir: dir, config: {},
                    options: { prepareOnly: true, allowedRecordIds, recordedAt,
                        relevance: { ...RELEVANCE }, vectorStore: store,
                        embeddingService: store.getSpace()?.rebuilding ? undefined : queryEmbedding, llmRunner: runner } });
                if (!result.success) throw new Error('MEMORYCORE_EXTRACTION_FAILED');
                const proposal = JSON.parse(JSON.stringify(result.proposal || { records: [], targets: [] }));
                if (typeof result.emptyDisposition === 'string' && /^[A-Z0-9_]+$/u.test(result.emptyDisposition)) proposal.emptyDisposition = result.emptyDisposition;
                return proposal;
            },
            async search({ query, topK, scope, allowedRecordIds, embedding, eventDate, dateRestricted = false, gateTexts, observe = false, rerank }) {
                if (typeof query !== 'string' || !query || query.length > 20000) throw new Error('MEMORYCORE_QUERY');
                const cacheBefore = observe ? embeddingCacheStats() : null;
                const stats = observe ? emptyRecallStats() : null;
                const client = resolveRerank(rerank);
                let gateFallback = 0;
                // Go already dropped other days when dateRestricted is set. Passing
                // eventDate again would drop records whose summary omits metadata.
                let ids = allowedRecordIds;
                let dated = dateRestricted === true;
                if (eventDate) {
                    ids = list(ids, scope).filter(r => (r.metadata.eventDate || r.metadata.activity_start_time?.slice(0, 10)) === eventDate).map(r => r.id);
                    dated = true;
                }
                const finish = async (ranked, searched, gateRerank) => {
                    const gated = await collectGates(query, gateTexts, embedding, dated, stats, gateRerank);
                    if (!stats) return Array.isArray(gateTexts) && gateTexts.length > 0 ? { hits: ranked, gated } : ranked;
                    const cacheAfter = embeddingCacheStats();
                    stats.embeddingCacheHit = cacheAfter.hits - cacheBefore.hits;
                    stats.embeddingCacheMiss = cacheAfter.misses - cacheBefore.misses;
                    stats.recallEmpty = searched && ranked.length === 0 ? 1 : 0;
                    stats.rerankGateFallback = gateFallback;
                    return { hits: ranked, gated, stats };
                };
                if (!ids?.length) return finish([], false, null);
                // Independent questions are embedded separately so one topic cannot
                // dilute another. Each part uses the same gates. Only a dated
                // generic schedule question may use the lower cosine floor.
                const queries = queryParts(query);
                if (client.enabled) {
                    try {
                        const limit = client.candidateLimit || 20;
                        const capped = await looseCandidateHits(api, store, queries, ids, scope, embedding, dated, limit);
                        if (stats) stats.rerankCandidates = capped.length;
                        const scores = capped.length ? await client.rank(query, capped.map((hit) => hit.content)) : [];
                        if (scores.length !== capped.length || scores.some((score) => !Number.isFinite(score))) {
                            throw Object.assign(new Error('RERANK_INVALID'), { code: 'invalid' });
                        }
                        const original = await originalGateHits(api, store, queries, ids, scope, embedding, dated, topK);
                        const originalIds = new Set(original.map((hit) => hit.record_id));
                        const rankedScore = new Map(capped.map((hit, index) => [hit.record_id, scores[index]]));
                        const injected = [];
                        const seen = new Set();
                        for (let index = 0; index < capped.length; index += 1) {
                            const byRank = scores[index] >= client.threshold;
                            const byGate = originalIds.has(capped[index].record_id);
                            if (!byRank && !byGate) continue;
                            seen.add(capped[index].record_id);
                            injected.push({ hit: { ...capped[index], score: scores[index], rerankScore: scores[index] }, score: scores[index], only: byRank && !byGate });
                        }
                        for (const hit of original) {
                            if (seen.has(hit.record_id)) continue;
                            const score = rankedScore.get(hit.record_id);
                            injected.push({ hit: { ...hit, ...(Number.isFinite(score) ? { score, rerankScore: score } : {}) }, score: Number.isFinite(score) ? score : Number.NEGATIVE_INFINITY, only: false });
                        }
                        injected.sort((a, b) => b.score - a.score);
                        const limited = (Number.isFinite(topK) && topK > 0 ? injected.slice(0, topK) : injected).map((item) => item.hit);
                        if (stats) {
                            stats.rerankDecision = 'applied';
                            stats.rerankKept = limited.length;
                            stats.rerankOnly = (Number.isFinite(topK) && topK > 0 ? injected.slice(0, topK) : injected).filter((item) => item.only).length;
                            stats.rerankFallback = 0;
                        }
                        const gateRerank = { ...client, onGateFallback() { gateFallback = 1; } };
                        const body = await finish(limited, true, gateRerank);
                        if (body && !Array.isArray(body)) {
                            body.rerankRank = capped.map((hit, index) => ({ id: hit.record_id, score: scores[index] }));
                            body.rerankOriginal = original.map((hit) => hit.record_id);
                        }
                        return body;
                    } catch (error) {
                        if (stats) {
                            stats.rerankDecision = rerankFailureCode(error);
                            stats.rerankFallback = 1;
                            stats.rerankKept = 0;
                        }
                    }
                } else if (stats) {
                    stats.rerankDecision = 'disabled';
                    stats.rerankFallback = 0;
                }
                const ranked = (await originalGateHits(api, store, queries, ids, scope, embedding, dated, topK)).slice(0, topK);
                return finish(ranked, true);
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
