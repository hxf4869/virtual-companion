// CM-3 real extraction -> Go recall -> final Node outbound -> answer -> judge.
// All conversations are generated. Only the authorized private answer cache
// retains synthetic outputs; ordinary reports and logs remain body-free.
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { prepareSourceIdentities } from '../server-plugin/virtual-companion/lib/source-identity.js';
import { unwrapChatCompletion } from '../server-plugin/virtual-companion/lib/chat-completions.js';
import { createMemoryInjection, MEMORY_PROMPT, CORE_PROMPT } from '../extension/vc-model-settings/memory-injection-logic.js';
import { placeGuidance, createReplyQualityMetrics } from '../extension/vc-model-settings/reply-pipeline.js';
import { parseSSEText } from './managed-lib.mjs';
import { importSyntheticCard } from './w05-accept.mjs';
import { cleanupSettled } from './w08-real-eval.mjs';
import { RERANK } from '../memorycore-service/rerank.mjs';
import { factMatchTerms, forgetStageCase, FORGET_STAGES } from '../../../scripts/lib/chat-memory-dataset.mjs';
import { mapRecordToFacts, scoreRules, parseJudgeResult, summarizeChatMemoryEvaluation, summarizeDiagnosticControls, normalizeFactText, CASE_STATE_PROTOCOL } from '../../../scripts/lib/chat-memory-scoring.mjs';
import { buildReviewTasks, reviewEvaluationAnswers } from '../../../scripts/lib/chat-memory-judging.mjs';
import { createJudgeCalibrationDataset, summarizeJudgeCalibration } from '../../../scripts/lib/chat-memory-judge-calibration.mjs';
import { summarizeSamples, summarizeReplyQuality } from '../../../scripts/lib/chat-memory-metrics.mjs';

const TERMINAL = new Set(['DONE', 'FAILED', 'DEAD_LETTERED', 'CANCELLED']);
const normalize = normalizeFactText;
const expect = (response, status = 200) => {
    if (response?.status !== status) throw new Error(`CM_HTTP_${response?.status || 0}`);
    return response.json;
};
const quote = text => "'" + String(text).replaceAll("'", "''") + "'";
const numberID = value => String(BigInt(value));

export function createEvaluationReauthentication({ now = () => performance.now() } = {}) {
    const fresh = new WeakMap();
    return async (admin, password) => {
        // The isolated runtime keeps the production 15-minute reauth window.
        // Reuse its proof for five minutes; protected writes still check it
        // server-side. Reauth on every case exhausts the 5/15-minute limit.
        const last = fresh.get(admin);
        if (last !== undefined && now() - last < 5 * 60 * 1000) return;
        expect(await admin.reauth(password));
        fresh.set(admin, now());
    };
}

export function factsInText(text, facts) {
    // Go emits each memory/summary as a line. Preserve a single-subject
    // entry's later clauses and trailing event-date label, never joining lines
    // or different memory slots. Multi-subject entries still require a clear clause.
    const lines = String(text ?? '').replace(/<\/?vc-(?:long-term|core)-memory>/gu, '\n').split(/\r?\n/u);
    const subjectKey = fact => normalize(fact.subject.split(/阅读计划|装订计划/)[0] || fact.subject);
    const subjectKeys = [...new Set(facts.map(subjectKey))];
    const clauses = lines.flatMap(line => {
        const entry = normalize(line);
        return subjectKeys.filter(subject => entry.includes(subject)).length === 1
            ? [entry] : line.split(/[。！？；;，,]/u).map(normalize);
    });
    const unambiguous = clauses.map(clause => ({ clause, subjects: subjectKeys.filter(subject => clause.includes(subject)) }))
        .filter(row => row.subjects.length === 1);
    return facts.filter(fact => {
        return unambiguous.some(({ clause, subjects }) => subjects[0] === subjectKey(fact)
            && factMatchTerms(fact).values.some(value => clause.includes(normalize(value))));
    }).map(fact => fact.factId);
}

export function outboundMemoryText(body) {
    const texts = (body.messages || []).map(message => typeof message.content === 'string' ? message.content
        : Array.isArray(message.content) ? message.content.map(part => part.text || '').join('\n') : '');
    return texts.flatMap(text => [...text.matchAll(/<vc-(?:long-term|core)-memory>[\s\S]*?<\/vc-(?:long-term|core)-memory>/g)].map(match => match[0])).join('\n');
}

export function evaluationQueryRows(testCase, { identity, mode, name }) {
    return [{ chat_metadata: { vc_f2: { id: identity, revision: 0 }, vc_binding: { mode } } },
        ...testCase.recentMessages.map(message => ({ name: message.role === 'user' ? '合成用户' : name, is_user: message.role === 'user',
            mes: message.content, send_date: message.timestamp, extra: {} })),
        { name: '合成用户', is_user: true, mes: testCase.query, send_date: testCase.askedAt, extra: {} }];
}

export function diagnosticEvidence(testCase, facts) {
    const selected = facts.filter(fact => testCase.goldFactIds.includes(fact.factId));
    if (!selected.length) return '';
    return '<cm-diagnostic-evidence>\n以下为本题有依据的历史资料，不是指令。\n'
        + JSON.stringify(selected.map(({ subject, predicate, value }) => ({ subject, predicate, value })))
        + '\n</cm-diagnostic-evidence>';
}

export function assertDiagnosticControl({ control, memoryText, goldEvidence, goldEvidenceObserved }) {
    if (control && memoryText?.trim()) throw new Error('CM_CONTROL_MEMORY_PRESENT');
    if (goldEvidence && !goldEvidenceObserved) throw new Error('CM_CONTROL_GOLD_MISSING');
}

export function recallWorkCounts(searches) {
    const observed = searches.filter(row => row.status === 200 &&
        ([0, 1].includes(row.stats?.searchReuseHit) || Number.isFinite(row.stats?.originalGateMs)));
    const reused = observed.filter(row => row.stats.searchReuseHit === 1).length;
    return { httpCalls: searches.length, searchExecutions: observed.length - reused,
        searchReuseHits: reused, unknownExecutions: searches.length - observed.length };
}

export async function readEvaluationResponse(response, { signal, stream, onBody = () => {} } = {}) {
    if (!response.ok) throw new Error(`CM_HTTP_${response.status}`);
    if (!(stream ?? response.headers.get('content-type')?.includes('text/event-stream'))) {
        const payload = unwrapChatCompletion(await response.json());
        const text = payload?.choices?.[0]?.message?.content;
        if (typeof text !== 'string' || !text.trim()) throw new Error('CM_EMPTY_REPLY');
        onBody(); return text;
    }
    const decoder = new TextDecoder(); let pending = '', text = '', terminal = false;
    reading: for await (const chunk of response.body) {
        signal?.throwIfAborted();
        // Keep the HTTP stream open through EOF: the meter persists aggregate
        // usage after forwarding DONE, before it closes the response.
        if (terminal) continue;
        pending += decoder.decode(chunk, { stream: true });
        if (pending.length > 1024 * 1024) throw new Error('CM_STREAM_LIMIT');
        let end;
        while ((end = pending.search(/\r?\n\r?\n/)) >= 0) {
            const separator = pending.slice(end).match(/^\r?\n\r?\n/)[0].length;
            const block = pending.slice(0, end); pending = pending.slice(end + separator);
            for (const { data } of parseSSEText(block + '\n\n')) {
                if (data === '[DONE]') { terminal = true; continue reading; }
                if (data?.error) throw new Error('CM_PROVIDER_ERROR');
                const content = data?.choices?.[0]?.delta?.content;
                if (typeof content === 'string' && content) { text += content; onBody(); }
                if (text.length > 4 * 1024 * 1024) throw new Error('CM_REPLY_LIMIT');
            }
        }
    }
    if (!terminal) throw new Error('CM_STREAM_INTERRUPTED');
    if (!text.trim()) throw new Error('CM_EMPTY_REPLY');
    return text;
}

function sqlJSON(ctx, sql) { return JSON.parse(ctx.w08.psql(sql).trim() || 'null'); }
function ownerSQL(ctx, owner, sql) {
    const id = numberID(owner), nonce = randomUUID().replaceAll('-', '');
    return sqlJSON(ctx, `BEGIN; SELECT vc.set_owner_context(${id},${quote(nonce)},vc._owner_binding_expected(${id},${quote(nonce)})); ${sql} COMMIT;`);
}

async function registerModels(ctx, roles, modelRoutes, namespaceBase, reauthenticate) {
    await reauthenticate(ctx.admin, ctx.secrets.password);
    for (let index = 0; index < roles.length; index++) {
        const { profile, purpose, name } = roles[index], local = modelRoutes[index];
        const baseUrl = namespaceBase + new URL(local.baseUrl).pathname;
        expect(await ctx.admin.saveProvider(`cm-${name}`, { displayName: `CM ${name}`, protocol: profile.protocol,
            baseUrl, credential: local.credential, state: 'ENABLED', expectedRevision: 0,
            models: [{ profileKey: 'eval', modelId: profile.modelId, displayName: 'CM configured profile',
                state: 'ENABLED', contextWindowTokens: profile.contextWindowTokens, maxOutputTokens: profile.maxOutputTokens,
                generationParams: profile.generationParams, capabilities: profile.capabilities,
                reasoningLevels: profile.generationParams?.reasoningEffort ? [profile.generationParams.reasoningEffort] : [],
                pricing: {} }] }));
        if (purpose) await bindPurpose(ctx, purpose, name, reauthenticate);
    }
    const prior = await ctx.admin.call('GET', '/api/v1/admin/embedding-config');
    const embedding = expect(await ctx.admin.call('PUT', '/api/v1/admin/embedding-config', {
        model: ctx.embeddingModel.name, artifactVersion: ctx.embeddingModel.digest, dimensions: 1024,
        queryPreprocessingVersion: 'qwen3-retrieval-v1', documentPreprocessingVersion: 'identity-v1',
        normalization: 'l2', state: 'ENABLED', expectedRevision: prior.status === 200 ? prior.json.revision : 0,
    }));
    return embedding;
}

async function bindPurpose(ctx, purpose, name, reauthenticate) {
    await reauthenticate(ctx.admin, ctx.secrets.password);
    const current = expect(await ctx.admin.listPurposes()).find(row => row.purpose === purpose);
    return expect(await ctx.admin.savePurpose(purpose, { providerId: `cm-${name}`, profileKey: 'eval', state: 'ENABLED', expectedRevision: current.revision }));
}

async function foregroundMarker(ctx, name) {
    const binding = expect(await ctx.admin.listPurposes()).find(row => row.purpose === 'FOREGROUND_CHAT');
    const provider = expect(await ctx.admin.listProviders()).find(row => row.providerId === `cm-${name}`);
    return `vc-go://model-purposes/FOREGROUND_CHAT?provider=${encodeURIComponent(provider.providerId)}&profile=eval&pr=${provider.revision}&br=${binding.revision}&scope=${encodeURIComponent(ctx.scope)}`;
}

export async function listEvaluationMemories(account, relationshipId, sourceMap, dataset, instance, { onPage = () => {} } = {}) {
    const rows = []; let cursor = '';
    for (;;) {
        const page = expect(await account.admin.call('GET', `/api/v1/relationships/${relationshipId}/memories?limit=100${cursor ? '&cursor=' + cursor : ''}`));
        onPage();
        if (!Array.isArray(page)) throw new Error('CM_MEMORY_LIST_SCHEMA');
        for (const row of page) {
            const evidence = expect(await account.admin.call('GET', `/api/v1/memories/${row.memoryId}/evidence`));
            const sourceTurnIds = evidence.map(item => sourceMap.get(item.messageId)).filter(Boolean);
            rows.push({ ...row, sourceTurnIds, mapping: mapRecordToFacts({ sourceTurnIds, content: row.summary,
                eventDate: row.time?.eventDate, ownerId: instance.ownerId, instanceId: instance.id }, dataset.facts) });
        }
        if (page.length < 100) break;
        cursor = page.at(-1).memoryId;
    }
    return rows;
}

const listMemory = listEvaluationMemories;

export function evaluationCorrectionSummary(record, action, dataset) {
    // The API replaces a whole record, which may contain several facts. The
    // existing placement remains historical evidence; the user edit states now.
    const previous = dataset.facts.find(row => row.factId === action.targetFactId);
    const summary = `${record.summary}\n${previous.subject}此前的位置记载仅作为历史；${action.replacementContent}`;
    if ([...summary].length > 2000) throw new Error('CM_EVALUATION_CORRECTION_TOO_LONG');
    return summary;
}

export function createEvaluationCaseResetter({ dataset, accounts, instances, sourceMap, sessionsByTurn,
    recordAliases, seenFactRecords, priorActions }) {
    const savedInstances = structuredClone([...instances].map(([id, { account: _account, ...local }]) => [id, local]));
    const savedSources = structuredClone([...sourceMap]);
    const savedSessions = structuredClone([...sessionsByTurn].map(([turn, { local, file, identity }]) =>
        [turn, { instanceId: local.id, file, identity }]));
    const savedAliases = structuredClone([...recordAliases]), savedFacts = structuredClone([...seenFactRecords]);
    const restoreMap = (target, values) => {
        target.clear();
        for (const [key, value] of structuredClone(values)) target.set(key, value);
    };
    return clients => {
        accounts.clear();
        accounts.set(dataset.owners[0].id, clients.owner);
        accounts.set(dataset.owners[1].id, clients.second);
        instances.clear();
        for (const [id, local] of structuredClone(savedInstances)) instances.set(id, { ...local, account: accounts.get(local.ownerId) });
        restoreMap(sourceMap, savedSources);
        sessionsByTurn.clear();
        for (const [turn, { instanceId, file, identity }] of savedSessions) {
            sessionsByTurn.set(turn, { local: instances.get(instanceId), file, identity });
        }
        restoreMap(recordAliases, savedAliases);
        restoreMap(seenFactRecords, savedFacts);
        priorActions.length = 0;
    };
}

export function selectEvaluationActionTarget(testCase, { dataset, memories, jobs, sourceMap, pagesRead,
    recordAliases, seenFactRecords, priorActions }) {
    const fact = dataset.facts.find(row => row.factId === testCase.action.targetFactId);
    if (!fact) throw new Error('CM_ACTION_FACT_MISSING');
    const alias = row => {
        if (!recordAliases.has(row.memoryId)) recordAliases.set(row.memoryId, `memory-${recordAliases.size + 1}`);
        return recordAliases.get(row.memoryId);
    };
    for (const row of memories) for (const factId of row.mapping.factIds) {
        if (!seenFactRecords.has(factId)) seenFactRecords.set(factId, new Set());
        seenFactRecords.get(factId).add(alias(row));
    }
    const historical = seenFactRecords.get(fact.factId) ?? new Set();
    const related = memories.filter(row => row.mapping.factIds.includes(fact.factId) || historical.has(alias(row))
        || row.sourceTurnIds.some(id => fact.sourceTurnIds.includes(id)));
    const target = memories.find(row => row.lifecycle === 'ACTIVE' && row.mapping.factIds.includes(fact.factId));
    const relatedAliases = new Set([...historical, ...related.map(alias)]);
    return { target, diagnostic: { targetFactId: fact.factId, targetFound: Boolean(target),
        targetMissing: !target, pagesRead, memoryCount: memories.length, previouslyMappedRecords: [...historical],
        records: related.map(row => ({ record: alias(row), lifecycle: row.lifecycle, sourceStatus: row.sourceStatus,
            recallEligible: row.recallEligible, factIds: row.mapping.factIds, mappingUncertain: row.mapping.mappingUncertain,
            sourceTurnIds: row.sourceTurnIds })),
        sourceJobs: jobs.filter(job => fact.sourceTurnIds.includes(sourceMap.get(job.message_id))).map(job => ({
            sourceTurnId: sourceMap.get(job.message_id), status: job.status, operationState: job.operation_state,
            published: Number(job.published) })),
        priorRelatedActions: priorActions.filter(action => relatedAliases.has(action.record)),
        evidenceGap: target ? null : historical.size ? 'PREVIOUS_MAPPING_NO_ACTIVE_TARGET'
            : related.some(row => row.mapping.mappingUncertain) ? 'SOURCE_MATCH_MAPPING_UNCERTAIN' : 'EXTRACTION_ABSENCE_NOT_PROVEN' } };
}

export async function verifyEvaluationModels(ctx, accounts) {
    const view = expect(await ctx.admin.call('GET', '/api/v1/admin/local-models'));
    if (view.embedding?.model !== 'qwen3-embedding:0.6b' || view.embedding.dimensions !== 1024 || !view.embedding.healthy
        || view.rerank?.model !== 'bge-reranker-v2-m3' || !view.rerank.deploymentEnabled || !view.rerank.healthy || !view.rerank.enabled) {
        throw new Error('CM_LOCAL_MODEL_PARITY_FAILED');
    }
    for (const account of accounts.values()) {
        const owner = numberID(account.session.accountId);
        if (ownerSQL(ctx, owner, `SELECT to_json(vc.go_service_resolve_owner_memory_rerank(${owner}));`) !== true) {
            throw new Error('CM_RERANK_DISABLED');
        }
    }
    return { status: 'PASS', verification: 'isolated-live-settings-and-production-source-path',
        productionRuntimeInspection: 'NOT_RUN', ownerSwitchesVerified: accounts.size,
        embedding: { model: view.embedding.model, dimensions: view.embedding.dimensions, healthy: true },
        rerank: { model: view.rerank.model, enabled: true, healthy: true, deploymentEnabled: true,
            threshold: RERANK.threshold, candidateLimit: RERANK.candidateLimit, summaryUnit: RERANK.summaryUnit },
        injection: 'native-browser-interceptor-and-node-final-recheck', testQueriesSavedAsMemory: false };
}

async function invokeJudgeRequest(ctx, { task, prompt, marker, profile, signal, caseTimeoutMs, capture }) {
    try {
        const response = await ctx.judge.st.generate({ chat_completion_source: 'custom', custom_url: marker,
            model: profile.modelId, max_tokens: profile.maxOutputTokens, stream: true,
            messages: [{ role: 'user', content: prompt }] },
        { signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(caseTimeoutMs)]) });
        return { judgment: parseJudgeResult(await readEvaluationResponse(response.res, { signal, stream: true })),
            callId: capture.judgeCallId };
    } catch (error) {
        if (Number.isSafeInteger(capture.judgeCallId)) error.cmJudgeCallId = capture.judgeCallId;
        throw error;
    }
}

export async function calibrateEvaluationJudge({ invoke, signal, onProgress }) {
    const dataset = createJudgeCalibrationDataset();
    const results = dataset.cases.map(testCase => ({ caseId: testCase.id, status: 'COMPLETED' }));
    const tasks = dataset.fixtures.map(fixture => ({
        testCase: dataset.cases.find(row => row.id === fixture.caseId), result: results.find(row => row.caseId === fixture.caseId),
        answer: fixture.answer, caseIndex: null, stage: null, control: null,
    }));
    const calibration = await reviewEvaluationAnswers({ dataset, tasks, invoke, signal,
        plannedSecondReviews: dataset.cases.map(row => ({ caseId: row.id })),
        onProgress: row => onProgress?.({ ...row, phase: 'judge-preflight' }) });
    return { ...summarizeJudgeCalibration(dataset, results, { agreement: calibration.agreement }),
        rubricVersion: calibration.rubricVersion, judgments: results };
}

// No source replay, foreground probe, answer generation, correction or forget.
// The same register/invoke/rubric path is used by the original round below.
export async function reviewSavedAnswersOnStack(ctx, { dataset, roles, modelRoutes, meter, budget, priorReport,
    savedAnswers, signal, onProgress = () => {}, caseTimeoutMs = 330000, checkpoint = async () => {} }) {
    if (!ctx.judge?.st || !ctx.setOutboundObserver) throw new Error('CM_ISOLATION_CONTEXT');
    const results = structuredClone(priorReport.results), controls = structuredClone(priorReport.diagnosticControls);
    const outputKeys = new Set(savedAnswers.responses.map(row => JSON.stringify([row.caseId, row.stage, row.control])));
    const expected = results.flatMap(row => row.forgetStages
        ? Object.entries(row.forgetStages).map(([stage, observation]) => ({ caseId: row.caseId, stage, control: null, observation }))
        : [{ caseId: row.caseId, stage: null, control: null, observation: row }]);
    for (const [control, group] of Object.entries(controls)) expected.push(...group.results.map(observation =>
        ({ caseId: observation.caseId, stage: null, control, observation })));
    for (const row of expected) if ((row.observation.status === 'COMPLETED' || row.observation.failureCode === 'CM_JUDGE_FAILED')
        && !outputKeys.has(JSON.stringify([row.caseId, row.stage, row.control]))) throw new Error('CM_REVIEW_OUTPUT_INCOMPLETE');
    const tasks = buildReviewTasks(dataset, results, controls, savedAnswers.responses);
    const reauthenticate = createEvaluationReauthentication(), callCases = new Map();
    let activeCase;
    ctx.setOutboundObserver(({ id, route }) => {
        if (roles[route]?.name !== 'judge' || !activeCase) throw new Error('CM_REVIEW_NON_JUDGE_CALL');
        activeCase.judgeCallId = id;
        callCases.set(id, { role: 'judge', caseIndex: activeCase.caseIndex, stage: activeCase.stage,
            control: activeCase.control, reviewPass: activeCase.reviewPass, reviewKind: activeCase.reviewKind });
    });
    await registerModels(ctx, roles, modelRoutes, ctx.meterBase, reauthenticate);
    await bindPurpose(ctx, 'FOREGROUND_CHAT', 'judge', reauthenticate);
    const marker = await foregroundMarker(ctx, 'judge');
    let reviewKind = 'preflight';
    const invoke = async (task, prompt) => {
        const capture = { caseIndex: task.caseIndex, stage: task.stage, control: task.control, reviewPass: task.reviewPass, reviewKind };
        activeCase = capture;
        try { return await invokeJudgeRequest(ctx, { task, prompt, marker, profile: roles[2].profile, signal, caseTimeoutMs, capture }); }
        finally { activeCase = null; }
    };
    const judgePreflight = await calibrateEvaluationJudge({ invoke, signal, onProgress });
    await checkpoint({ phase: 'judge-preflight', judgePreflight, budget: budget.snapshot() });
    if (!judgePreflight.passed) throw new Error('CM_JUDGE_CALIBRATION_FAILED');
    reviewKind = 'core';
    const controlCases = dataset.cases.filter((_row, index) => index % 20 === 0);
    const summarizeControls = () => Object.fromEntries(Object.entries(controls).map(([control, group]) =>
        [control, summarizeDiagnosticControls(controlCases, group.results)]));
    const judgeCalibration = await reviewEvaluationAnswers({ dataset, tasks, signal, onProgress, invoke,
        checkpoint: () => checkpoint({ phase: 'judge', results, diagnosticControls: summarizeControls(), budget: budget.snapshot() }) });
    const quality = summarizeChatMemoryEvaluation(dataset.cases, results, { facts: dataset.facts });
    quality.extraction = priorReport.quality.extraction;
    return { ...priorReport, results, quality, judgeCalibration, judgePreflight, diagnosticControls: summarizeControls(),
        modelCalls: meter.snapshot().calls.map(call => ({ ...call, ...callCases.get(call.id) })), budget: budget.snapshot() };
}

function jobRows(ctx) {
    return sqlJSON(ctx, `SELECT COALESCE(json_agg(x),'[]'::json) FROM (
        SELECT w.id::text,w.status,split_part(s.source_ref,':',3) AS message_id,op.state AS operation_state,
            (SELECT count(*) FROM vc.memory_item m JOIN vc.memory_evidence e ON e.owner_user_id=m.owner_user_id AND e.memory_item_id=m.id
                WHERE e.owner_user_id=s.owner_user_id AND e.source_ref=s.source_ref AND m.engine_record_id IS NOT NULL AND m.deleted_at IS NULL) AS published
        FROM vc.work_item w JOIN vc.st_message_source s ON s.owner_user_id=w.owner_user_id AND s.id=w.ref_id
        LEFT JOIN vc.memorycore_operation op ON op.owner_user_id=w.owner_user_id AND op.job_id=w.id
        WHERE w.kind='ST_MEMORY_EXTRACT') x;`) || [];
}

export async function waitExtraction(ctx, expected, { signal, onProgress, timeoutMs, savedAt, sourceMap, measure, instances }) {
    const deadline = performance.now() + timeoutMs, seen = new Set(), profilesSeen = new Set(); let lastProgress = 0, jobs = [];
    while (performance.now() < deadline) {
        signal?.throwIfAborted(); jobs = jobRows(ctx);
        for (const job of jobs) {
            const source = sourceMap.get(job.message_id);
            if (job.published > 0 && source && savedAt.has(source) && !seen.has(source)) {
                seen.add(source); measure(source, 'l1_ready_ms', performance.now() - savedAt.get(source));
            }
        }
        const terminal = jobs.filter(job => TERMINAL.has(job.status)).length;
        for (const local of instances.values()) {
            if (!local.finishedWriteAt || local.mode !== 'COMPANION' || profilesSeen.has(local.id)) continue;
            const scopedJobs = jobs.filter(job => sourceMap.get(job.message_id)?.startsWith(local.id + '-'));
            // A failed later profile job can still have published L1. Once all
            // jobs end, ask PG whether a valid current profile actually exists.
            if (scopedJobs.length < local.userCount || scopedJobs.some(job => !TERMINAL.has(job.status))) continue;
            const owner = numberID(local.account.session.accountId), rel = numberID(local.relationshipId);
            const current = ownerSQL(ctx, owner, `SELECT COALESCE((SELECT row_to_json(p) FROM vc.memory_profile_current(${owner},${rel},
                (SELECT id FROM vc.conversation WHERE owner_user_id=${owner} AND st_chat_identity=${quote(local.chats.at(-1).identity)})) p),'null'::json);`);
            if (current) {
                local.profile = current; profilesSeen.add(local.id);
                measure(local.id, 'profile_ready_ms', performance.now() - local.finishedWriteAt);
            }
        }
        if (performance.now() - lastProgress > 30000) {
            onProgress?.({ phase: 'extract', plannedSources: expected, jobs: jobs.length, terminal,
                done: jobs.filter(job => job.status === 'DONE').length }); lastProgress = performance.now();
        }
        if (jobs.length >= expected && jobs.every(job => TERMINAL.has(job.status))) return { jobs, timedOut: false };
        await delay(1000, undefined, { signal });
    }
    return { jobs, timedOut: true };
}

export async function evaluateCoreOnStack(ctx, { dataset, roles, modelRoutes, meter, budget, variant = 'baseline',
    signal, onProgress, diagnosticsOnly = false, extractionTimeoutMs = 7_200_000, caseTimeoutMs = 330000,
    saveAnswer = async () => {}, checkpoint: writeCheckpoint = async () => {} } = {}) {
    if (!ctx.second || !ctx.judge || !ctx.readEngineObservations
        || (!diagnosticsOnly && (!ctx.captureIngestCheckpoint || !ctx.restoreIngestCheckpoint))) throw new Error('CM_ISOLATION_CONTEXT');
    const reauthenticate = createEvaluationReauthentication();
    const accounts = new Map([[dataset.owners[0].id, { admin: ctx.admin, st: ctx.st, session: ctx.secrets.session, password: ctx.secrets.password }],
        [dataset.owners[1].id, ctx.second]]);
    const sourceMap = new Map(), savedAt = new Map(), sessionsByTurn = new Map(), instances = new Map(), cards = new Map();
    const metricRows = [], results = [], answerTasks = [], callCases = new Map(), priorActions = [];
    const checkpoint = partial => writeCheckpoint({ ...partial, metricRows: metricRows.slice(), metrics: summarizeSamples(metricRows) });
    const recordAliases = new Map(), seenFactRecords = new Map();
    const controlCases = dataset.cases.filter((_testCase, index) => index % 20 === 0);
    const replyQuality = createReplyQualityMetrics({ capacity: 1000 });
    const sampleIds = new Map();
    dataset.instances.flatMap(instance => instance.sessions.flatMap(session => session.messages)).forEach((row, index) => sampleIds.set(row.id, 10000 + index));
    dataset.instances.forEach((row, index) => sampleIds.set(row.id, 20000 + index));
    dataset.cases.forEach((row, index) => {
        sampleIds.set(row.id, index * 10);
        FORGET_STAGES.forEach((stage, at) => sampleIds.set(row.id + ':' + stage, index * 10 + at + 1));
    });
    let activeCase = null;
    const measure = (label, metric, value, outcome = 'ok', historyMessages = 0) => metricRows.push({
        sample: sampleIds.get(label), metric, value, outcome, lowerBound: outcome === 'timeout', variant,
        historyMessages, historyBytes: 0, historyTokens: 0, cache: 'not_applicable', modelCache: 'unknown',
        network: 'local', surface: 'pipeline', content: 'text', attempts: 1, warmup: false,
    });
    const inspectOutbound = async ({ route, id, body }) => {
        const role = roles[route]?.name;
        callCases.set(id, { role, caseIndex: role !== 'extraction' ? activeCase?.caseIndex ?? null : null,
            stage: role !== 'extraction' ? activeCase?.stage ?? null : null,
            control: role !== 'extraction' ? activeCase?.control ?? null : null,
            ...(role === 'judge' ? { reviewPass: activeCase?.reviewPass ?? null, reviewKind: activeCase?.reviewKind ?? 'core' } : {}) });
        if (role === 'judge' && activeCase) activeCase.judgeCallId = id;
        if (role === 'foreground' && activeCase) {
            const observedCase = activeCase;
            const memoryText = outboundMemoryText(body);
            observedCase.outbound = true;
            if (memoryText) observedCase.memoryText += '\n' + memoryText;
            observedCase.injectedFactIds = [...new Set([...observedCase.injectedFactIds, ...factsInText(memoryText, dataset.facts)])];
            if (observedCase.goldEvidence) observedCase.goldEvidenceObserved = (body.messages || [])
                .some(message => typeof message.content === 'string' && message.content.includes(observedCase.goldEvidence));
            if (observedCase.beforeSend) {
                const inspect = observedCase.beforeSend; observedCase.beforeSend = null;
                observedCase.cleanupStateAtFinalBody = await inspect();
            }
        }
    };
    // The outer runner owns the single meter; replacing this observer does not
    // add an outbound route or alter a serialized provider request.
    ctx.setOutboundObserver(inspectOutbound);
    const embedding = await registerModels(ctx, roles, modelRoutes, ctx.meterBase, reauthenticate);
    const productionParity = diagnosticsOnly ? null : await verifyEvaluationModels(ctx, accounts);
    let judgePreflight = null;
    if (!diagnosticsOnly) {
        await bindPurpose(ctx, 'FOREGROUND_CHAT', 'judge', reauthenticate);
        const judgeMarker = await foregroundMarker(ctx, 'judge');
        judgePreflight = await calibrateEvaluationJudge({ signal, onProgress,
            invoke: async (task, prompt) => {
                const capture = { caseIndex: null, stage: null, control: null, reviewPass: task.reviewPass, reviewKind: 'preflight' };
                activeCase = capture;
                try { return await invokeJudgeRequest(ctx, { task, prompt, marker: judgeMarker,
                    profile: roles[2].profile, signal, caseTimeoutMs, capture }); }
                finally { activeCase = null; }
            } });
        await checkpoint({ phase: 'judge-preflight', judgePreflight, productionParity, budget: budget.snapshot() });
        onProgress?.({ phase: 'judge-preflight', status: judgePreflight.passed ? 'PASS' : 'FAIL',
            agreement: judgePreflight.agreement, knownCaseAccuracy: judgePreflight.knownCaseAccuracy, budget: budget.snapshot() });
        if (!judgePreflight.passed) throw new Error('CM_JUDGE_CALIBRATION_FAILED');
        await bindPurpose(ctx, 'FOREGROUND_CHAT', 'foreground', reauthenticate);
    }
    const marker = await foregroundMarker(ctx, 'foreground');
    const probe = await ctx.st.generate({ chat_completion_source: 'custom', model: roles[1].profile.modelId,
        custom_url: marker, max_tokens: roles[1].profile.maxOutputTokens, stream: true,
        messages: [{ role: 'user', content: '这是隔离评测的连通检查。只回复“收到”。' }] },
    { signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(caseTimeoutMs)]) });
    await readEvaluationResponse(probe.res, { signal, stream: true });
    onProgress?.({ phase: 'provider-probe', status: 'PASS', budget: budget.snapshot() });
    let extraction = { jobs: [], timedOut: false }, resetCaseData;
    const extractionRecords = [];
    if (diagnosticsOnly) {
        // Controls disable recall. Empty bindings reproduce their runtime path
        // without replaying sources, extraction, corrections or forgetting.
        for (const instance of dataset.instances.filter(row => controlCases.some(testCase => testCase.instanceId === row.id))) {
            const account = accounts.get(instance.ownerId), cardKey = instance.ownerId + '/' + instance.roleKey;
            if (!cards.has(cardKey)) cards.set(cardKey, await importSyntheticCard(account.st, 'CM合成角色'));
            instances.set(instance.id, { ...instance, account, card: cards.get(cardKey), relationshipId: null });
        }
    } else {
    const extractionController = new AbortController();
    const extractionTask = waitExtraction(ctx, dataset.sourceCounts.eligibleUserTurns, {
        signal: AbortSignal.any([extractionController.signal, ...(signal ? [signal] : [])]), onProgress,
        timeoutMs: extractionTimeoutMs, savedAt, sourceMap, measure, instances,
    }).then(value => { extraction = value; }, error => { extraction = { error }; });
    try {
    for (const instance of dataset.instances) {
        const account = accounts.get(instance.ownerId), cardKey = instance.ownerId + '/' + instance.roleKey;
        if (!cards.has(cardKey)) cards.set(cardKey, await importSyntheticCard(account.st, 'CM合成角色'));
        const card = cards.get(cardKey);
        const local = { ...instance, account, card, relationshipId: null, chats: [], userCount: instance.sessions.reduce((n, session) => n + session.messages.filter(row => row.role === 'user').length, 0) };
        instances.set(instance.id, local);
        for (const session of instance.sessions) {
            const identity = randomUUID(), file = `cm-${session.id}`;
            const rows = [{ user_name: '合成用户', character_name: card.name, chat_metadata: { vc_f2: { id: identity, revision: 0 } } }];
            for (let index = 0; index < session.messages.length; index += 2) {
                signal?.throwIfAborted();
                if (extraction?.error) throw extraction.error;
                const pair = session.messages.slice(index, index + 2);
                rows.push(...pair.map(message => ({ name: message.role === 'user' ? '合成用户' : card.name,
                    is_user: message.role === 'user', mes: message.content, send_date: message.timestamp, extra: {} })));
                prepareSourceIdentities(rows, { settled: true, sourceTimezone: instance.sourceTimezone });
                const saved = expect(await account.st.call('POST', '/api/chats/save', { avatar_url: card.avatar, file_name: file, chat: rows }));
                rows[0].chat_metadata.vc_f2 = saved.vc_f2;
                if (index === 0) {
                    const binding = expect(await account.admin.call('POST', '/api/v1/st/bindings', { chatIdentity: identity,
                        characterRef: card.avatar, mode: instance.mode, displayName: 'CM合成实例',
                        ...(local.relationshipId ? { relationshipId: local.relationshipId } : {}) }));
                    local.relationshipId = binding.relationshipId; rows[0].chat_metadata.vc_binding = binding;
                }
                const now = performance.now();
                pair.forEach((message, offset) => {
                    sourceMap.set(rows[index + offset + 1].vc_message_id, message.id); savedAt.set(message.id, now);
                    sessionsByTurn.set(message.id, { local, file, identity });
                });
                expect(await account.admin.call('POST', '/api/v1/st/sources/reconcile', { chatIdentities: [identity] }));
            }
            local.chats.push({ identity, file, rows });
        }
        local.finishedWriteAt = performance.now();
        onProgress?.({ phase: 'sources', instances: instances.size, messages: [...instances.values()].reduce((n, value) => n + value.chats.reduce((m, chat) => m + chat.rows.length - 1, 0), 0) });
    }
    await extractionTask;
    if (extraction.error) throw extraction.error;
    } catch (error) { extractionController.abort(); await extractionTask; throw error; }
    for (const local of instances.values()) {
        local.memories = await listMemory(local.account, local.relationshipId, sourceMap, dataset, local);
        for (const row of local.memories) for (const factId of row.mapping.factIds) {
            if (!recordAliases.has(row.memoryId)) recordAliases.set(row.memoryId, `memory-${recordAliases.size + 1}`);
            if (!seenFactRecords.has(factId)) seenFactRecords.set(factId, new Set());
            seenFactRecords.get(factId).add(recordAliases.get(row.memoryId));
        }
        extractionRecords.push(...local.memories.map(row => row.mapping));
    }
    await checkpoint({ phase: 'extracted', sourceCounts: dataset.sourceCounts, jobs: extraction.jobs.map(row => ({ status: row.status, published: Number(row.published) })), budget: budget.snapshot() });
    if (extraction.timedOut) throw new Error('CM_INGEST_CHECKPOINT_NOT_READY');
    const idleStarted = performance.now();
    while (budget.snapshot().held !== 0) {
        signal?.throwIfAborted();
        if (performance.now() - idleStarted >= caseTimeoutMs) throw new Error('CM_INGEST_CHECKPOINT_NOT_READY');
        await delay(100, undefined, { signal });
    }
    resetCaseData = createEvaluationCaseResetter({ dataset, accounts, instances, sourceMap, sessionsByTurn,
        recordAliases, seenFactRecords, priorActions });
    onProgress?.({ phase: 'case-state', status: 'CAPTURING' });
    await ctx.captureIngestCheckpoint();
    onProgress?.({ phase: 'case-state', status: 'READY' });
    }

    async function ask(testCase, caseIndex, stage = null, beforeSend, control = null) {
        signal?.throwIfAborted();
        const local = instances.get(testCase.instanceId), { account, card } = local;
        const started = performance.now(), identity = randomUUID(), file = `cm-q-${caseIndex}-${control || stage || 'normal'}`;
        const measureAnswer = (...args) => { if (!control) measure(...args); };
        const rows = evaluationQueryRows(testCase, { identity, mode: local.mode, name: card.name });
        // Normal in-flight source state keeps the query readable to Go while
        // preventing query/answer contamination of the extraction queue.
        prepareSourceIdentities(rows, { settled: false, sourceTimezone: local.sourceTimezone });
        const saved = expect(await account.st.call('POST', '/api/chats/save', { avatar_url: card.avatar, file_name: file, chat: rows }));
        const binding = expect(await account.admin.call('POST', '/api/v1/st/bindings', { chatIdentity: identity, characterRef: card.avatar,
            mode: local.mode, displayName: 'CM合成查询', ...(local.relationshipId ? { relationshipId: local.relationshipId } : {}) }));
        if (!local.relationshipId) local.relationshipId = binding.relationshipId;
        rows[0].chat_metadata = { vc_f2: saved.vc_f2, vc_binding: binding };
        const beforeTrace = await ctx.readEngineObservations(0);
        let recalled = { memoryIds: [] };
        const prompts = {}, context = { chat: rows.slice(1), chatMetadata: rows[0].chat_metadata,
            extensionSettings: control ? { vc_memory: { enabled: false } } : {}, extensionPrompts: prompts,
            setExtensionPrompt: (key, value) => { prompts[key] = { value }; } };
        const injection = createMemoryInjection({ getContext: () => context, recall: async input => {
            const started = performance.now();
            recalled = expect(await account.admin.call('POST', '/api/v1/st/memory/recall', input));
            measureAnswer(testCase.id + (stage ? ':' + stage : ''), 'recall_ms',
                recalled.cmObservedRecallStats?.recallMs ?? performance.now() - started);
            return recalled;
        } });
        await injection.intercept(context.chat, roles[1].profile.contextWindowTokens, () => { throw new Error('CM_CONTEXT_CHANGED'); }, 'normal');
        const body = { chat_completion_source: 'custom', model: roles[1].profile.modelId, custom_url: marker,
            max_tokens: roles[1].profile.maxOutputTokens, stream: true,
            messages: [{ role: 'system', content: '你是正在和用户聊天的虚构陪伴。依据已有聊天和历史资料自然回答；没有依据时直说不确定，不猜用户的经历。' },
                ...testCase.recentMessages.map(({ role, content }) => ({ role, content })),
                ...[MEMORY_PROMPT, CORE_PROMPT].filter(key => prompts[key]?.value).map(key => ({ role: 'system', content: prompts[key].value })),
                { role: 'user', content: testCase.query }] };
        injection.attach(body); placeGuidance(body, context, { random: () => .5 });
        const goldEvidence = control === 'gold-evidence' ? diagnosticEvidence(testCase, dataset.facts) : '';
        if (goldEvidence) body.messages.splice(1, 0, { role: 'system', content: goldEvidence });
        if (local.mode === 'STORY') {
            const story = expect(await account.admin.call('POST', '/api/v1/story/runs', { conversationId: binding.conversationId, caseId: 'rainy-inn-v1' }));
            const actor = story.participants.find(row => row.role === 'NPC') || story.participants[0];
            body.vc_session_mode = 'STORY';
            body.vc_story = { runId: story.runId, branchId: story.branchId, worldVersion: story.worldVersion,
                actorId: actor.actorId, chatIdentity: identity };
        }
        const run = { caseIndex, stage, control, goldEvidence, outbound: false, memoryText: '', injectedFactIds: [], beforeSend };
        activeCase = run;
        const deadline = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(caseTimeoutMs)]);
        let answer, first = null;
        try {
            const response = await account.st.generate(body, { signal: deadline });
            const observedFinal = response.res.headers.get('x-cm-recall-ids');
            if (observedFinal !== null) run.finalMemoryIds = JSON.parse(observedFinal);
            const observedStats = response.res.headers.get('x-cm-recall-stats');
            if (observedStats !== null) {
                run.finalRecallStats = JSON.parse(observedStats);
                if (Number.isFinite(run.finalRecallStats.recheckMs)) measureAnswer(testCase.id + (stage ? ':' + stage : ''),
                    'memory_recheck_ms', run.finalRecallStats.recheckMs);
            }
            answer = await readEvaluationResponse(response.res, { signal: deadline, stream: true, onBody: () => { first ??= performance.now() - started; } });
        } catch (error) {
            const elapsed = performance.now() - started;
            const outcome = deadline.aborted ? signal?.aborted ? 'cancelled' : 'timeout'
                : error.message === 'CM_HTTP_429' ? 'budget_stop' : 'provider_error';
            const label = testCase.id + (stage ? ':' + stage : '');
            measureAnswer(label, 'pipeline_first_body_ms', first ?? (outcome === 'timeout' ? elapsed : null), first !== null ? 'ok' : outcome);
            measureAnswer(label, 'pipeline_complete_ms', outcome === 'timeout' ? elapsed : null, outcome);
            error.cmObservation = { caseId: testCase.id, status: outcome === 'timeout' ? 'TIMEOUT' : outcome === 'budget_stop' ? 'BUDGET_STOP' : 'FAILED',
                outboundObserved: run.outbound, injectedFactIds: run.injectedFactIds,
                ...(run.cleanupStateAtFinalBody ? { cleanupStateAtFinalBody: run.cleanupStateAtFinalBody } : {}),
                rule: scoreRules(testCase, { answer: '', injectedFactIds: run.injectedFactIds, forbiddenText: run.memoryText, requireInjection: !control }) };
            throw error;
        } finally { activeCase = null; }
        if (!run.outbound) throw new Error('CM_OUTBOUND_NOT_OBSERVED');
        assertDiagnosticControl(run);
        measureAnswer(testCase.id + (stage ? ':' + stage : ''), 'pipeline_first_body_ms', first);
        measureAnswer(testCase.id + (stage ? ':' + stage : ''), 'pipeline_complete_ms', performance.now() - started);
        const trace = await ctx.readEngineObservations(beforeTrace.sequence);
        if (trace.incomplete) throw new Error('CM_OBSERVER_OVERFLOW');
        const searches = trace.searches.filter(row => row.scope.ownerId === String(account.session.accountId) && row.scope.instanceId === String(local.relationshipId));
        const memories = await listMemory(account, local.relationshipId, sourceMap, dataset, local);
        const projections = sqlJSON(ctx, `SELECT COALESCE(json_agg(json_build_object('memoryId',id::text,'recordId',engine_record_id)),'[]'::json)
            FROM vc.memory_item WHERE owner_user_id=${numberID(account.session.accountId)} AND relationship_id=${numberID(local.relationshipId)};`);
        const recordMap = new Map(projections.map(row => [row.recordId, memories.find(memory => memory.memoryId === row.memoryId)?.mapping.factIds || []]));
        const observed = searches.at(-1);
        const result = { caseId: testCase.id, status: 'COMPLETED',
            extractedFactIds: [...new Set(memories.flatMap(row => row.mapping.factIds))],
            legalCandidateFactIds: [...new Set((observed?.allowedRecordIds || []).flatMap(id => recordMap.get(id) || []))],
            retrievedFactIds: (observed?.recordIds || []).map(id => recordMap.get(id) || []),
            finalRankedFactIds: (run.finalMemoryIds || []).map(id => memories.find(row => row.memoryId === id)?.mapping.factIds || []),
            preflightPostBudgetFactIds: (recalled.memoryIds || []).map(id => memories.find(row => row.memoryId === id)?.mapping.factIds || []),
            injectedFactIds: run.injectedFactIds, recallCalls: searches.length, recallWork: recallWorkCounts(searches),
            mappingUncertain: memories.some(row => row.mapping.mappingUncertain),
            ...(run.finalRecallStats ? { recallStats: run.finalRecallStats } : {}),
            ...(run.cleanupStateAtFinalBody ? { cleanupStateAtFinalBody: run.cleanupStateAtFinalBody } : {}),
            ...(control ? { control, goldEvidenceObserved: !goldEvidence || run.goldEvidenceObserved } : {}),
            rule: scoreRules(testCase, { answer, injectedFactIds: run.injectedFactIds, forbiddenText: run.memoryText, requireInjection: !control }) };
        if (!control) {
            const qualitySample = replyQuality.start();
            replyQuality.finish(qualitySample, { outcome: 'ok', text: answer, previousReplies: testCase.recentMessages.filter(row => row.role === 'assistant').map(row => row.content) });
        }
        await saveAnswer({ caseId: testCase.id, stage, control, answer });
        answerTasks.push({ testCase, result, answer, caseIndex, stage, control });
        return result;
    }

    for (let caseIndex = 0; !diagnosticsOnly && caseIndex < dataset.cases.length; caseIndex++) {
        signal?.throwIfAborted();
        onProgress?.({ phase: 'case-state', status: 'RESTORING', caseIndex });
        const clients = await ctx.restoreIngestCheckpoint();
        resetCaseData(clients);
        activeCase = null;
        const testCase = dataset.cases[caseIndex], local = instances.get(testCase.instanceId), account = local.account;
        let result, actionDiagnostic, actionFailureCode, actionStatus = testCase.action ? 'NOT_RUN' : undefined;
        const actionTarget = async () => {
            let pagesRead = 0;
            const current = await listMemory(account, local.relationshipId, sourceMap, dataset, local, { onPage: () => pagesRead++ });
            const selection = selectEvaluationActionTarget(testCase, { dataset, memories: current, jobs: jobRows(ctx), sourceMap,
                pagesRead, recordAliases, seenFactRecords, priorActions });
            actionDiagnostic = selection.diagnostic;
            if (!selection.target) actionStatus = 'BLOCKED';
            return selection.target;
        };
        const recordAction = target => {
            actionStatus = 'COMPLETED';
            priorActions.push({ caseId: testCase.id, kind: testCase.action.kind,
                targetFactId: testCase.action.targetFactId, record: recordAliases.get(target.memoryId) });
        };
        try {
            if (testCase.action?.kind === 'correct') {
                const target = await actionTarget();
                if (!target) actionFailureCode = 'CM_CORRECTION_TARGET_MISSING';
                else {
                    await reauthenticate(account.admin, account.password);
                    expect(await account.admin.call('PATCH', `/api/v1/memories/${target.memoryId}`, {
                        expectedVersion: target.version, summary: evaluationCorrectionSummary(target, testCase.action, dataset) }));
                    recordAction(target);
                }
            }
            if (testCase.action?.kind !== 'forget') result = await ask(testCase, caseIndex);
            else {
                result = { caseId: testCase.id, status: 'COMPLETED', forgetStages: {} };
                const askStage = async (stage, beforeSend) => {
                    try { result.forgetStages[stage] = await ask(forgetStageCase(dataset, testCase, stage), caseIndex, stage, beforeSend); }
                    catch (error) { if (error.cmObservation) result.forgetStages[stage] = error.cmObservation; throw error; }
                    return result.forgetStages[stage];
                };
                await askStage('before');
                const target = await actionTarget();
                if (!target) {
                    // Execute the questions without inventing an action target.
                    // BLOCKED remains a zero-score product failure; these are
                    // observations of the unmodified state, not a successful
                    // forget/cleanup/late-source boundary test.
                    actionFailureCode = 'CM_FORGET_TARGET_MISSING';
                    for (const stage of FORGET_STAGES.slice(1)) {
                        if (stage === 'restart') await ctx.restartMemorycore();
                        const observation = await askStage(stage);
                        observation.actionStatus = 'BLOCKED';
                        if (stage === 'done') observation.cleanupStatus = 'NOT_RUN';
                    }
                    result.cleanupMeasurement = 'NOT_RUN_ACTION_BLOCKED';
                    result.lateProbe = 'NOT_RUN_ACTION_BLOCKED';
                } else {
                    await reauthenticate(account.admin, account.password);
                    const deletionStarted = performance.now();
                    const recordId = sqlJSON(ctx, `SELECT to_json(engine_record_id) FROM vc.memory_item WHERE owner_user_id=${numberID(account.session.accountId)} AND id=${numberID(target.memoryId)};`);
                    if (!recordId) throw new Error('CM_FORGET_TARGET_MISSING');
                    let releasedAt;
                    await ctx.setForgetHold(recordId);
                    try {
                        expect(await account.admin.call('DELETE', `/api/v1/memories/${target.memoryId}`), 202);
                        recordAction(target);
                        while (!(await ctx.readEngineObservations(0)).forgetHold?.reached) {
                            if (performance.now() - deletionStarted > 15000) throw new Error('CM_FORGET_HOLD_NOT_REACHED');
                            await delay(250, undefined, { signal });
                        }
                        await askStage('begin', async () => {
                            const detail = expect(await account.admin.call('GET', `/api/v1/memories/${target.memoryId}`));
                            const state = detail.cleanup?.state;
                            if (state !== 'PENDING') throw new Error('CM_FORGET_BEGIN_NOT_PENDING');
                            releasedAt = performance.now(); await ctx.setForgetHold(null);
                            return state;
                        });
                    } finally { await ctx.setForgetHold(null); }
                    let cleanup = 'PENDING';
                    while (performance.now() - deletionStarted < caseTimeoutMs) {
                        const detail = expect(await account.admin.call('GET', `/api/v1/memories/${target.memoryId}`));
                        cleanup = detail.cleanup?.state || 'PENDING';
                        if (cleanupSettled(cleanup) || cleanup === 'PARTIAL') break;
                        await delay(1000, undefined, { signal });
                    }
                    measure(testCase.id, 'cleanup_ms', performance.now() - (releasedAt ?? deletionStarted), cleanup === 'DONE' ? 'ok' : 'timeout');
                    result.cleanupMeasurement = 'native-forget-release-to-post-answer-DONE-observation';
                    result.forgetStages.done = await askStage('done');
                    result.forgetStages.done.cleanupStatus = cleanup;
                    await ctx.restartMemorycore();
                    await askStage('restart');
                    const fact = dataset.facts.find(row => row.factId === testCase.action.targetFactId);
                    for (const turn of fact.sourceTurnIds) {
                        const source = sessionsByTurn.get(turn);
                        if (source) expect(await account.admin.call('POST', '/api/v1/st/sources/reconcile', { chatIdentities: [source.identity] }));
                    }
                    await askStage('late');
                    result.lateProbe = 'original-source-reconcile';
                }
            }
        } catch (error) {
            if (/^(?:(?:ARTIFACT|SYNTHETIC)_|CM_EVALUATION_)/.test(error.message)) throw error;
            result ||= error.cmObservation || { caseId: testCase.id };
            result.status = error.cmObservation?.status || (signal?.aborted || error.name === 'TimeoutError' || error.name === 'AbortError' ? 'TIMEOUT'
                : budget.snapshot().denied ? 'BUDGET_STOP' : 'FAILED');
            result.failureCode = /^CM_[A-Z0-9_]+$/.test(error.message) ? error.message : 'CM_CASE_FAILED';
            if (signal?.aborted) {
                results.push(result); await checkpoint({ phase: 'interrupted', results, budget: budget.snapshot() }); throw error;
            }
        }
        if (actionStatus !== undefined) result.actionStatus = actionStatus;
        if (actionFailureCode) result.actionFailureCode = actionFailureCode;
        if (actionDiagnostic) {
            result.actionDiagnostic = actionDiagnostic;
            result.targetMissing = actionDiagnostic.targetMissing;
        }
        results.push(result);
        onProgress?.({ phase: 'answer', completed: results.length, planned: dataset.cases.length, budget: budget.snapshot() });
        await checkpoint({ phase: 'answer', results, budget: budget.snapshot() });
    }

    const controls = { 'memory-off': [], 'gold-evidence': [] };
    const summarizeControls = () => Object.fromEntries(Object.entries(controls).map(([control, rows]) =>
        [control, summarizeDiagnosticControls(controlCases, rows)]));
    for (const control of Object.keys(controls)) for (const testCase of controlCases) {
        try { controls[control].push(await ask(testCase, dataset.cases.indexOf(testCase), null, undefined, control)); }
        catch (error) {
            if (signal?.aborted) throw error;
            controls[control].push({ ...(error.cmObservation || { caseId: testCase.id, status: 'FAILED' }), control,
                failureCode: /^CM_[A-Z0-9_]+$/.test(error.message) ? error.message : 'CM_CONTROL_FAILED' });
        }
        onProgress?.({ phase: 'diagnostic-control', control, completed: controls[control].length, planned: controlCases.length });
        if (diagnosticsOnly) await checkpoint({ phase: 'diagnostic-control', diagnosticControls: summarizeControls() });
    }

    await bindPurpose(ctx, 'FOREGROUND_CHAT', 'judge', reauthenticate);
    const judgeMarker = await foregroundMarker(ctx, 'judge');
    const judgeCalibration = await reviewEvaluationAnswers({ dataset, tasks: answerTasks, signal, onProgress,
        calibrate: !diagnosticsOnly,
        invoke: async (task, prompt) => {
            const capture = { caseIndex: task.caseIndex, stage: task.stage, control: task.control, reviewPass: task.reviewPass };
            activeCase = capture;
            try { return await invokeJudgeRequest(ctx, { task, prompt, marker: judgeMarker,
                profile: roles[2].profile, signal, caseTimeoutMs, capture }); }
            finally { activeCase = null; }
        }, checkpoint: () => checkpoint(diagnosticsOnly ? { phase: 'judge', diagnosticControls: summarizeControls() }
            : { phase: 'judge', results, budget: budget.snapshot() }) });
    for (const result of results) if (result.forgetStages && result.status === 'COMPLETED') {
        const failed = FORGET_STAGES.map(stage => result.forgetStages[stage]).find(stage => stage?.status !== 'COMPLETED');
        if (failed) result.status = failed.status;
    }
    // Responses have left RAM after judging; only the bounded private synthetic
    // cache can support a later review. Ordinary summaries never carry prose.
    const diagnosticControls = summarizeControls();
    const modelCalls = meter.snapshot().calls.map(call => ({ ...call, ...callCases.get(call.id) }));
    if (diagnosticsOnly) return { diagnosticControls, modelCalls };
    const quality = summarizeChatMemoryEvaluation(dataset.cases, results, { facts: dataset.facts, extractionRecords });
    const recallRows = results.flatMap(row => row.forgetStages ? Object.values(row.forgetStages) : [row]).filter(row => row.recallWork);
    return { schemaVersion: 1, variant, caseStateProtocol: CASE_STATE_PROTOCOL,
        dataset: { version: dataset.version, seed: dataset.seed, hashes: dataset.hashes, sourceCounts: dataset.sourceCounts },
        results, quality, reply: summarizeReplyQuality(replyQuality.drain()), metrics: summarizeSamples(metricRows), metricRows,
        productionParity, judgePreflight,
        extraction: { planned: dataset.sourceCounts.eligibleUserTurns, jobs: extraction.jobs.length,
            done: extraction.jobs.filter(row => row.status === 'DONE').length, timedOut: extraction.timedOut,
            jobOutcomes: Object.fromEntries([...TERMINAL, 'PENDING', 'CLAIMED'].map(status =>
                [status, extraction.jobs.filter(row => row.status === status).length])),
            publishedSources: extraction.jobs.filter(row => Number(row.published) > 0).length,
            publishedFailedSources: extraction.jobs.filter(row => row.status !== 'DONE' && Number(row.published) > 0).length,
            profilesReady: [...instances.values()].filter(local => local.profile).length,
            layers: [...instances.values()].filter(local => local.mode === 'COMPANION').map(local => ({ instance: local.id,
                l2FactIds: factsInText((local.profile?.out_scenes || []).map(scene => scene.summary || '').join('\n'), dataset.facts),
                l3FactIds: factsInText(local.profile?.out_persona || '', dataset.facts) })) },
        judgeCalibration,
        diagnosticControls,
        recallWork: { observedAnswers: recallRows.length,
            ...Object.fromEntries(['httpCalls', 'searchExecutions', 'searchReuseHits', 'unknownExecutions']
                .map(key => [key, recallRows.reduce((sum, row) => sum + row.recallWork[key], 0)])) },
        measurementLimits: ['pipeline-not-visible-paint', 'per-case-business-restart-model-services-retained',
            'cleanup-ms-includes-begin-answer-wait', 'late-stage-original-source-reconcile-not-inflight', 'same-model-judge-see-config'],
        modelCalls,
        budget: budget.snapshot(), embedding: { model: embedding.model, artifactVersion: embedding.artifactVersion, dimensions: embedding.dimensions },
    };
}
