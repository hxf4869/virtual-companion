// Offline core140 comparisons. Never sample stages independently or infer
// extraction absence from a failed fact mapping. No response text is copied.
import { isDeepStrictEqual } from 'node:util';
import { CASE_CATEGORIES, FORGET_STAGES, forgetStageCase } from './chat-memory-dataset.mjs';
import { pairedBootstrap, percentile, summarizeSamples } from './chat-memory-metrics.mjs';
import { CASE_STATE_PROTOCOL } from './chat-memory-scoring.mjs';

const STATUSES = new Set(['COMPLETED', 'TIMEOUT', 'NOT_READY', 'BUDGET_STOP', 'FAILED', 'NOT_RUN']);
const NOISE_METHOD = 'max-absolute-endpoint-of-category-stratified-paired-bootstrap-95';
const CAUSES = ['NOT_EXTRACTED', 'NOT_RECALLED', 'NOT_INJECTED', 'WRONG_AFTER_INJECTION', 'JUDGE_ERROR', 'UNKNOWN'];
const identity = dataset => ({ version: dataset?.version, seed: dataset?.seed, dataset: dataset?.hashes?.dataset });
const equal = (a, b) => isDeepStrictEqual(a, b);
const booleanOrNull = value => typeof value === 'boolean' ? value : null;

function checkDataset(dataset) {
    const id = identity(dataset);
    if (typeof id.version !== 'string' || !id.version || !Number.isSafeInteger(id.seed)
        || typeof id.dataset !== 'string' || !id.dataset || dataset.cases?.length !== 140) throw new Error('CM_ROUND_DATASET_INVALID');
    const seen = new Set();
    for (const row of dataset.cases) {
        if (!row || typeof row.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(row.id)
            || seen.has(row.id) || !CASE_CATEGORIES.includes(row.category)
            || !Array.isArray(row.goldFactIds) || !Array.isArray(row.evidenceSets)) throw new Error('CM_ROUND_DATASET_INVALID');
        seen.add(row.id);
    }
    if (CASE_CATEGORIES.some(category => dataset.cases.filter(row => row.category === category).length !== 20)) {
        throw new Error('CM_ROUND_DATASET_INVALID');
    }
}

function checkObservation(row, caseId, stage = null) {
    if (!row || !STATUSES.has(row.status)
        || (row.actionStatus !== undefined && !STATUSES.has(row.actionStatus) && row.actionStatus !== 'BLOCKED') || (row.caseId !== undefined && row.caseId !== caseId)
        || (row.stage !== undefined && row.stage !== stage)) throw new Error('CM_ROUND_RESULT_INVALID');
    for (const key of ['extractedFactIds', 'legalCandidateFactIds', 'injectedFactIds']) {
        if (row[key] !== undefined && (!Array.isArray(row[key]) || row[key].some(id => typeof id !== 'string'))) {
            throw new Error('CM_ROUND_RESULT_INVALID');
        }
    }
    if (row.finalRankedFactIds !== undefined && (!Array.isArray(row.finalRankedFactIds)
        || row.finalRankedFactIds.some(ids => !Array.isArray(ids) || ids.some(id => typeof id !== 'string')))) {
        throw new Error('CM_ROUND_RESULT_INVALID');
    }
}

const actionComplete = row => row?.actionStatus === undefined || row.actionStatus === 'COMPLETED';
const observationComplete = row => row?.status === 'COMPLETED' && typeof row.rule?.passed === 'boolean'
    && ['correct', 'grounded', 'abstains'].every(key => typeof row.judge?.[key] === 'boolean');
const judgedPass = (row, abstains) => row?.status === 'COMPLETED' && row.rule?.passed === true
    && row.judge?.correct === true && row.judge?.grounded === true && row.judge?.abstains === abstains
    && (row.judgeAgreementRequired !== true || row.judgeAgreement === true);
const stagePass = (row, stage) => actionComplete(row) && judgedPass(row, stage !== 'before') && (stage !== 'done' || row.cleanupStatus === 'DONE');
function readRound(dataset, summary) {
    if (!equal(identity(dataset), identity(summary?.dataset))) throw new Error('CM_ROUND_DATASET_MISMATCH');
    if (!Array.isArray(summary.results)) throw new Error('CM_ROUND_RESULTS_REQUIRED');
    const planned = new Map(dataset.cases.map(row => [row.id, row])), seen = new Map();
    for (const row of summary.results) {
        const testCase = planned.get(row?.caseId);
        if (!testCase || seen.has(row.caseId)) throw new Error('CM_ROUND_RESULT_UNMATCHED');
        checkObservation(row, testCase.id);
        if (row.forgetStages !== undefined) {
            if (testCase.category !== 'forget' || !row.forgetStages || Array.isArray(row.forgetStages)
                || Object.keys(row.forgetStages).some(stage => !FORGET_STAGES.includes(stage))) throw new Error('CM_ROUND_STAGE_INVALID');
            for (const [stage, observation] of Object.entries(row.forgetStages)) checkObservation(observation, testCase.id, stage);
        }
        seen.set(row.caseId, row);
    }
    return dataset.cases.map(testCase => {
        const result = seen.get(testCase.id);
        const completed = testCase.category === 'forget'
            ? result?.status === 'COMPLETED' && FORGET_STAGES.every(stage => observationComplete(result.forgetStages?.[stage]))
            : observationComplete(result);
        const pass = testCase.category === 'forget'
            ? completed && FORGET_STAGES.every(stage => stagePass(result.forgetStages[stage], stage))
            : judgedPass(result, !testCase.goldFactIds.length);
        return { testCase, result, completed, score: Number(pass && actionComplete(result)) };
    });
}

function checkConfiguration(before, after) {
    if (!before.configuration || !after.configuration || !equal(before.configuration, after.configuration)
        || before.judgeRubricVersion !== after.judgeRubricVersion
        || before.caseStateProtocol !== CASE_STATE_PROTOCOL || after.caseStateProtocol !== CASE_STATE_PROTOCOL) {
        throw new Error('CM_ROUND_CONFIGURATION_MISMATCH');
    }
}

// Bootstrap paired case deltas within each represented category. Each stratum
// retains its planned size, including zero scores for NOT_RUN/failed cases.
function stratifiedInterval(rows) {
    if (!rows.length) return null;
    const strata = CASE_CATEGORIES.map(category => rows.filter(row => row.category === category).map(row => row.delta)).filter(rows => rows.length);
    if (strata.length === 1) return pairedBootstrap(strata[0]);
    let state = 20261106;
    const roll = () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 4294967296; };
    const means = [];
    for (let iteration = 0; iteration < 2000; iteration++) {
        let sum = 0;
        for (const stratum of strata) for (let i = 0; i < stratum.length; i++) sum += stratum[Math.floor(roll() * stratum.length)];
        means.push(sum / rows.length);
    }
    return [percentile(means, .025), percentile(means, .975)];
}
function groupDifference(rows) {
    const n = rows.length, before = rows.reduce((sum, row) => sum + row.before, 0), after = rows.reduce((sum, row) => sum + row.after, 0);
    const delta = n ? (after - before) / n : null;
    return { denominator: n, pairs: n,
        baseline: { numerator: before, denominator: n, value: n ? before / n : null },
        candidate: { numerator: after, denominator: n, value: n ? after / n : null },
        delta, delta95: stratifiedInterval(rows), regressed: delta !== null && delta < 0,
        color: delta !== null && delta < 0 ? 'red' : null };
}
function differences(before, after) {
    const rows = before.map((row, i) => ({ category: row.testCase.category, answerable: row.testCase.goldFactIds.length > 0,
        before: row.score, after: after[i].score, delta: after[i].score - row.score }));
    return { overall: groupDifference(rows), answerable: groupDifference(rows.filter(row => row.answerable)),
        byCategory: Object.fromEntries(CASE_CATEGORIES.map(category => [category, groupDifference(rows.filter(row => row.category === category))])) };
}
function deepFreeze(value) {
    for (const child of Object.values(value)) if (child && typeof child === 'object') deepFreeze(child);
    return Object.freeze(value);
}
const noiseGroup = group => ({ ...group, bound: group.delta95 ? Math.max(...group.delta95.map(Math.abs)) : null });

/** Freeze two COMPLETE, same-configuration baselines before improvement runs.
 * The absolute 95% CI endpoint is more conservative than the observed point
 * difference; it includes uncertainty even when the two scores are equal.
 */
export function freezeBaselineNoise(dataset, baselineA, baselineB) {
    checkDataset(dataset); checkConfiguration(baselineA, baselineB);
    const a = readRound(dataset, baselineA), b = readRound(dataset, baselineB);
    if (![...a, ...b].every(row => row.completed)) throw new Error('CM_ROUND_BASELINE_INCOMPLETE');
    const diff = differences(a, b);
    const actionsComplete = [...a, ...b].every(row => !row.testCase.action || (row.completed && actionComplete(row.result)));
    return deepFreeze({ schemaVersion: 1, actionsComplete, qualityBaselineReady: actionsComplete, dataset: identity(dataset),
        judgeRubricVersion: baselineA.judgeRubricVersion ?? null, caseStateProtocol: CASE_STATE_PROTOCOL,
        configuration: structuredClone(baselineA.configuration),
        method: NOISE_METHOD, iterations: 2000,
        overall: noiseGroup(diff.overall), answerable: noiseGroup(diff.answerable),
        byCategory: Object.fromEntries(CASE_CATEGORIES.map(category => [category, noiseGroup(diff.byCategory[category])])) });
}

function checkNoise(dataset, baseline, noise) {
    if (!noise) throw new Error('CM_ROUND_NOISE_REQUIRED');
    if (noise.caseStateProtocol !== CASE_STATE_PROTOCOL || noise.method !== NOISE_METHOD || !equal(noise.dataset, identity(dataset))
        || !equal(noise.configuration, baseline.configuration)
        || noise.judgeRubricVersion !== (baseline.judgeRubricVersion ?? null)) throw new Error('CM_ROUND_NOISE_MISMATCH');
    for (const group of [noise.overall, noise.answerable, ...CASE_CATEGORIES.map(category => noise.byCategory?.[category])]) {
        if (!group || !Number.isFinite(group.bound) || group.bound < 0 || group.bound > 1) throw new Error('CM_ROUND_NOISE_INVALID');
    }
}
function missing(rows) {
    return { cases: rows.filter(row => !row.result).length,
        forgetStages: rows.filter(row => row.testCase.category === 'forget')
            .reduce((sum, row) => sum + FORGET_STAGES.filter(stage => !row.result?.forgetStages?.[stage]).length, 0),
        notCompleted: rows.filter(row => !row.completed).length };
}
function withEvidence(group, noise) {
    const supported = group.delta95 !== null && group.delta95[0] > 0;
    const exceedsNoise = group.delta !== null && group.delta > noise.bound;
    return { ...group, noiseBound: noise.bound, positivePaired95: supported, exceedsNoise,
        credibleImprovement: supported && exceedsNoise };
}
function latencyComparison(baseline, candidate) {
    const groups = summary => summarizeSamples((summary.metricRows ?? [])
        .filter(row => ['recall_ms', 'pipeline_first_body_ms'].includes(row.metric))).groups;
    const before = groups(baseline), after = groups(candidate);
    const key = row => [row.metric, row.historyMessages, row.cache, row.modelCache, row.network, row.surface, row.content].join('|');
    const all = new Map([...before, ...after].map(row => [key(row), row]));
    const compare = metric => [...all].filter(([, row]) => row.metric === metric).map(([id]) => {
        const b = before.find(row => key(row) === id), a = after.find(row => key(row) === id);
        const measure = row => row ? { planned: row.planned, measured: row.measured, p50: row.p50, p95: row.p95,
            censored: row.censored, failures: row.failures } : { planned: 0, measured: 0, p50: null, p95: null, censored: 0, failures: 0 };
        const ratio = p => b?.[p] > 0 && a?.[p] !== null && a?.[p] !== undefined ? a[p] / b[p] - 1 : null;
        return { key: id, baseline: measure(b), candidate: measure(a), p50RelativeChange: ratio('p50'), p95RelativeChange: ratio('p95'),
            regressionOver20Percent: ['p50', 'p95'].some(p => b?.[p] !== null && b?.[p] !== undefined
                && a?.[p] !== null && a?.[p] !== undefined && a[p] > b[p] * 1.2),
            status: b?.measured && a?.measured ? 'MEASURED' : 'NOT_RUN' };
    });
    return { recall: compare('recall_ms'), firstBody: compare('pipeline_first_body_ms'),
        recallStatus: all.size && [...all.values()].some(row => row.metric === 'recall_ms') ? 'REPORTED' : 'NOT_RUN',
        firstBodyStatus: all.size && [...all.values()].some(row => row.metric === 'pipeline_first_body_ms') ? 'REPORTED' : 'NOT_RUN' };
}

/** Compare summary.results with a frozen noise reference. Prior entries are
 * previous return values, in improvement-round order (exclude the baselines).
 * This is statistical evidence only, never the product quality-gate verdict.
 */
export function compareMemoryRounds(dataset, baseline, candidate, { noiseReference, priorImprovementRounds = [] } = {}) {
    checkDataset(dataset); checkConfiguration(baseline, candidate); checkNoise(dataset, baseline, noiseReference);
    const before = readRound(dataset, baseline), after = readRound(dataset, candidate), diff = differences(before, after);
    const overall = withEvidence(diff.overall, noiseReference.overall), answerable = withEvidence(diff.answerable, noiseReference.answerable);
    const byCategory = Object.fromEntries(CASE_CATEGORIES.map(category => [category, withEvidence(diff.byCategory[category], noiseReference.byCategory[category])]));
    const complete = [...before, ...after].every(row => row.completed);
    const actionsComplete = [...before, ...after].every(row => !row.testCase.action || (row.completed && actionComplete(row.result)));
    // Improvement in either preregistered aggregate must stand on its own CI
    // and noise bound. Category declines remain explicit regardless of gains.
    const acceptedImprovement = complete && (overall.credibleImprovement || answerable.credibleImprovement);
    const noiseBounds = { overall: noiseReference.overall.bound, answerable: noiseReference.answerable.bound,
        byCategory: Object.fromEntries(CASE_CATEGORIES.map(category => [category, noiseReference.byCategory[category].bound])) };
    if (!Array.isArray(priorImprovementRounds) || priorImprovementRounds.some(row => row.caseStateProtocol !== CASE_STATE_PROTOCOL
        || !equal(row.dataset, identity(dataset))
        || !equal(row.noiseBounds, noiseBounds) || !equal(row.configuration, baseline.configuration) || typeof row.complete !== 'boolean' || typeof row.acceptedImprovement !== 'boolean')) {
        throw new Error('CM_ROUND_HISTORY_MISMATCH');
    }
    const completed = [...priorImprovementRounds, { complete, acceptedImprovement }].filter(row => row.complete);
    let consecutiveWithoutImprovement = 0;
    for (const row of completed.toReversed()) { if (row.acceptedImprovement) break; consecutiveWithoutImprovement++; }
    return { schemaVersion: 1, caseStateProtocol: CASE_STATE_PROTOCOL,
        dataset: identity(dataset), configuration: structuredClone(baseline.configuration),
        noiseBounds, complete, actionsComplete, qualityBaselineReady: complete && actionsComplete, overall, answerable, byCategory, acceptedImprovement,
        missing: { baseline: missing(before), candidate: missing(after) }, latency: latencyComparison(baseline, candidate),
        stagnation: { consecutiveWithoutImprovement, stop: consecutiveWithoutImprovement >= 5,
            reason: consecutiveWithoutImprovement >= 5 ? 'FIVE_ROUNDS_WITHOUT_CREDIBLE_IMPROVEMENT' : null } };
}

function covered(testCase, ids) {
    if (!testCase.evidenceSets.length || !Array.isArray(ids)) return null;
    const present = new Set(ids);
    return testCase.evidenceSets.some(set => set.length > 0 && set.every(id => present.has(id)));
}
function controlledReviewsById(dataset, reviews) {
    if (!Array.isArray(reviews)) throw new Error('CM_ROUND_REVIEW_INVALID');
    const planned = new Map(dataset.cases.map(row => [row.id, row])), byId = new Map();
    for (const review of reviews) {
        const testCase = planned.get(review?.caseId), stage = review?.stage ?? null;
        const id = `${review?.caseId}:${stage}`;
        if (!testCase || byId.has(id) || review.controlled !== true || !['HUMAN', 'BLIND_ADJUDICATION'].includes(review.method)
            || (testCase.category === 'forget' ? !FORGET_STAGES.includes(stage) : stage !== null)
            || (review.verifiedAbsentExtractedFactIds !== undefined && (!Array.isArray(review.verifiedAbsentExtractedFactIds)
                || review.verifiedAbsentExtractedFactIds.some(id => ![...testCase.goldFactIds, testCase.action?.targetFactId].includes(id))))) {
            throw new Error('CM_ROUND_REVIEW_INVALID');
        }
        byId.set(id, review);
    }
    return byId;
}
function attributeObservation(testCase, row, { stage = null, review, parent, passed, globalMappingUncertain = false } = {}) {
    const status = row?.status ?? 'NOT_RUN', gaps = [];
    const evidence = { extracted: covered(testCase, row?.extractedFactIds), legal: covered(testCase, row?.legalCandidateFactIds),
        finalRanked: covered(testCase, row?.finalRankedFactIds?.flat()), injected: covered(testCase, row?.injectedFactIds),
        rulePassed: booleanOrNull(row?.rule?.passed), judgeCorrect: booleanOrNull(row?.judge?.correct),
        judgeGrounded: booleanOrNull(row?.judge?.grounded), judgeAbstains: booleanOrNull(row?.judge?.abstains) };
    const uncertain = globalMappingUncertain || [row, parent].some(result => result?.mappingUncertain === true || result?.mapping_uncertain === true);
    const targetMissing = [row, parent].some(result => result?.targetMissing === true
        || ['CM_FORGET_TARGET_MISSING', 'CM_CORRECTION_TARGET_MISSING'].includes(result?.failureCode));
    if (uncertain) gaps.push('MAPPING_UNCERTAIN');
    if (targetMissing) gaps.push('TARGET_MISSING');
    const actionFailed = !actionComplete(row) || (stage !== 'before' && !actionComplete(parent));
    if (actionFailed) gaps.push('ACTION_NOT_COMPLETED');
    let cause = passed ? null : 'UNKNOWN';
    if (!passed) {
        if (!row) gaps.push('OBSERVATION_MISSING');
        else if (status !== 'COMPLETED') gaps.push('OPERATION_NOT_COMPLETED');
        if (stage === 'done' && row?.cleanupStatus !== 'DONE') gaps.push('CLEANUP_NOT_DONE');
        if (status === 'COMPLETED' && !targetMissing && !actionFailed) {
            const corrected = review?.correctedJudge;
            const judgeError = review?.judgeErrorConfirmed === true && observationComplete(row) && row.rule?.passed === true
                && (stage !== 'done' || row.cleanupStatus === 'DONE')
                && corrected?.correct === true && corrected?.grounded === true && corrected?.abstains === !testCase.goldFactIds.length
                && !judgedPass(row, !testCase.goldFactIds.length);
            if (judgeError) cause = 'JUDGE_ERROR';
            else if (evidence.injected === true && observationComplete(row) && !judgedPass(row, !testCase.goldFactIds.length)) cause = 'WRONG_AFTER_INJECTION';
            else if (evidence.finalRanked === true && evidence.injected === false && !uncertain) cause = 'NOT_INJECTED';
            else if (evidence.extracted === true && evidence.legal === true && evidence.finalRanked === false && !uncertain) cause = 'NOT_RECALLED';
            else if (evidence.extracted === false && review?.verifiedAbsentExtractedFactIds?.length && !uncertain) {
                const absent = new Set(review.verifiedAbsentExtractedFactIds);
                if (testCase.evidenceSets.length && testCase.evidenceSets.every(set => set.some(id => absent.has(id)))) cause = 'NOT_EXTRACTED';
            }
            if (cause === 'UNKNOWN' && evidence.extracted === false) gaps.push('EXTRACTION_NOT_PROVEN_ABSENT');
            if (cause === 'UNKNOWN' && evidence.extracted === true && evidence.legal === false) gaps.push('GOLD_NOT_LEGAL');
            if (cause === 'UNKNOWN' && !testCase.goldFactIds.length) gaps.push('NO_POSITIVE_GOLD');
            if (cause === 'UNKNOWN' && Object.values(evidence).some(value => value === null)) gaps.push('EVIDENCE_INCOMPLETE');
        }
    }
    return { ...(stage ? { stage } : {}), status, actionStatus: row?.actionStatus ?? null, passed, cause, evidence, gaps };
}

/** IDs/booleans/codes only. Optional controlledReviews supplies explicit local
 * review evidence, never a rule/judge disagreement heuristic. Review entries:
 * {caseId, stage:null|FORGET_STAGE, controlled:true, method:'HUMAN'|
 * 'BLIND_ADJUDICATION', verifiedAbsentExtractedFactIds?:[],
 * judgeErrorConfirmed?:true, correctedJudge?:{correct,grounded,abstains}}.
 */
export function attributeMemoryFailures(dataset, summary, { controlledReviews = [] } = {}) {
    checkDataset(dataset);
    const rows = readRound(dataset, summary), reviews = controlledReviewsById(dataset, controlledReviews);
    const globalMappingUncertain = summary.quality?.extraction?.mappingUncertain > 0;
    const cases = rows.map(({ testCase, result, score }) => {
        const base = { caseId: testCase.id, category: testCase.category };
        if (testCase.category !== 'forget') return { ...base, ...attributeObservation(testCase, result,
            { review: reviews.get(`${testCase.id}:null`), passed: Boolean(score), globalMappingUncertain }) };
        const stages = FORGET_STAGES.map(stage => attributeObservation(forgetStageCase(dataset, testCase, stage), result?.forgetStages?.[stage],
            { stage, review: reviews.get(`${testCase.id}:${stage}`), parent: result, globalMappingUncertain,
                passed: stagePass(result?.forgetStages?.[stage], stage) && (stage === 'before' || actionComplete(result)) }));
        const first = stages.find(row => !row.passed);
        return { ...base, status: result?.status ?? 'NOT_RUN', actionStatus: result?.actionStatus ?? null, passed: Boolean(score), cause: score ? null : first?.cause ?? 'UNKNOWN',
            gaps: [...new Set(stages.flatMap(row => row.gaps))], stages };
    });
    return { planned: dataset.cases.length, failures: cases.filter(row => !row.passed).length,
        byCause: Object.fromEntries(CAUSES.map(cause => [cause, cases.filter(row => row.cause === cause).length])), cases };
}
