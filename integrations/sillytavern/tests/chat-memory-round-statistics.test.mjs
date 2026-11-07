import assert from 'node:assert/strict';
import test from 'node:test';
import { FORGET_STAGES, forgetStageCase, generateChatMemoryDataset } from '../../../scripts/lib/chat-memory-dataset.mjs';
import { freezeBaselineNoise, compareMemoryRounds, attributeMemoryFailures } from '../../../scripts/lib/chat-memory-round-statistics.mjs';
import { CASE_STATE_PROTOCOL } from '../../../scripts/lib/chat-memory-scoring.mjs';

const dataset = generateChatMemoryDataset();
const configuration = { profiles: [{ modelId: 'fixture-model' }], rerank: true };
const judge = abstains => ({ correct: true, grounded: true, abstains });
function observation(testCase) {
    return { caseId: testCase.id, status: 'COMPLETED', rule: { passed: true, injectionCovered: testCase.goldFactIds.length ? true : null },
        judge: judge(!testCase.goldFactIds.length), extractedFactIds: [...testCase.goldFactIds],
        legalCandidateFactIds: [...testCase.goldFactIds], finalRankedFactIds: [[...testCase.goldFactIds]], injectedFactIds: [...testCase.goldFactIds] };
}
function round(correct = () => true) {
    return { caseStateProtocol: CASE_STATE_PROTOCOL,
        dataset: { version: dataset.version, seed: dataset.seed, hashes: dataset.hashes }, configuration: structuredClone(configuration),
        results: dataset.cases.map(testCase => {
            const result = testCase.category === 'forget' ? { caseId: testCase.id, status: 'COMPLETED',
                forgetStages: Object.fromEntries(FORGET_STAGES.map(stage => [stage, {
                    ...observation(forgetStageCase(dataset, testCase, stage)), ...(stage === 'done' ? { cleanupStatus: 'DONE' } : {}),
                }])) } : observation(testCase);
            if (!correct(testCase)) (result.forgetStages?.before ?? result).judge.correct = false;
            return result;
        }), metricRows: [] };
}
const comparison = (before, after, options = {}) => compareMemoryRounds(dataset, before, after,
    { noiseReference: freezeBaselineNoise(dataset, before, structuredClone(before)), ...options });

test('shared-state or unknown case protocols cannot establish noise or enter independent-case comparisons', () => {
    const baseline = round();
    for (const protocol of [undefined, 'shared-mutable-cases']) {
        const legacy = { ...round(), caseStateProtocol: protocol };
        assert.throws(() => freezeBaselineNoise(dataset, legacy, structuredClone(legacy)), /CM_ROUND_CONFIGURATION_MISMATCH/);
        assert.throws(() => comparison(baseline, legacy), /CM_ROUND_CONFIGURATION_MISMATCH/);
    }
    const noiseReference = structuredClone(freezeBaselineNoise(dataset, baseline, round()));
    delete noiseReference.caseStateProtocol;
    assert.throws(() => compareMemoryRounds(dataset, baseline, round(), { noiseReference }), /CM_ROUND_NOISE_MISMATCH/);
});
const first = category => dataset.cases.find(row => row.category === category);
const resultFor = (summary, id) => summary.results.find(row => row.caseId === id);
function metric(metricName, value, sample, variant = 'baseline', outcome = 'ok') {
    return { metric: metricName, value, sample, variant, outcome, lowerBound: outcome === 'timeout', warmup: false,
        historyMessages: 0, historyBytes: 0, historyTokens: 0, attempts: 1,
        cache: 'not_applicable', modelCache: 'unknown', network: 'local', surface: 'pipeline', content: 'text' };
}

test('pairs by fixed case IDs, retains 140 denominator, and flags every observed category regression', () => {
    const before = round(testCase => testCase.category !== 'single');
    const after = round(testCase => testCase.category !== 'time');
    after.results.reverse();
    const report = comparison(before, after);
    assert.equal(report.overall.denominator, 140);
    assert.equal(report.overall.pairs, 140);
    assert.equal(report.overall.delta, 0);
    assert.deepEqual(report.overall.delta95, [0, 0], 'category-stratified resampling preserves opposing constant strata');
    assert.equal(report.byCategory.single.delta, 1);
    assert.deepEqual(report.byCategory.single.delta95, [1, 1]);
    assert.equal(report.byCategory.time.regressed, true);
    assert.equal(report.byCategory.time.color, 'red');
    assert.equal(report.acceptedImprovement, false);
    assert.equal(report.answerable.denominator, dataset.cases.filter(row => row.goldFactIds.length).length);
});

test('each forget case contributes one score and requires every stage plus DONE cleanup', () => {
    const before = round();
    for (const stage of FORGET_STAGES) {
        const after = round();
        resultFor(after, first('forget').id).forgetStages[stage].judge.correct = false;
        const report = comparison(before, after);
        assert.equal(report.overall.candidate.numerator, 139);
        assert.equal(report.byCategory.forget.candidate.numerator, 19);
    }
    const after = round();
    resultFor(after, first('forget').id).forgetStages.done.cleanupStatus = 'PARTIAL';
    assert.equal(comparison(before, after).overall.candidate.numerator, 139);
});

test('missing cases/stages and real NOT_RUN failures remain paired zeros, never survivor-only scores', () => {
    const before = round(), after = round();
    after.results = after.results.filter(row => row.caseId !== first('single').id);
    resultFor(after, first('cross_session').id).status = 'NOT_RUN';
    delete resultFor(after, first('forget').id).forgetStages.late;
    const report = comparison(before, after);
    assert.equal(report.overall.candidate.numerator, 137);
    assert.equal(report.overall.denominator, 140);
    assert.equal(report.overall.pairs, 140);
    assert.equal(report.complete, false);
    assert.equal(report.missing.candidate.cases, 1);
    assert.equal(report.missing.candidate.forgetStages, 1);
    assert.equal(report.acceptedImprovement, false);
});

test('rejects foreign identities, duplicate/foreign results and mismatched stages before statistics', () => {
    const before = round(), after = round();
    for (const mutate of [
        r => { r.dataset.seed++; }, r => { r.dataset.hashes.dataset = 'other'; }, r => { delete r.dataset.version; },
        r => r.results.push(r.results[0]), r => { r.results[0].caseId = 'unknown'; },
        r => { resultFor(r, first('forget').id).forgetStages.extra = {}; },
        r => { resultFor(r, first('forget').id).forgetStages.before.caseId = first('single').id; },
        r => { resultFor(r, first('forget').id).forgetStages.before.stage = 'done'; },
    ]) {
        const changed = structuredClone(after); mutate(changed);
        assert.throws(() => comparison(before, changed), /CM_ROUND_/);
    }
    const changed = structuredClone(after); changed.configuration.rerank = false;
    assert.throws(() => freezeBaselineNoise(dataset, before, changed), /CM_ROUND_CONFIGURATION_MISMATCH/);
});

test('freezes conservative baseline noise and requires positive paired CI AND delta above that bound', () => {
    const before = round();
    // Use dataset order rather than any generator-specific ID numbering.
    before.results.forEach((row, index) => { (row.forgetStages?.before ?? row).judge.correct = index % 2 === 0; });
    const other = structuredClone(before);
    other.results.forEach((row, index) => { (row.forgetStages?.before ?? row).judge.correct = index % 2 !== 0; });
    const noise = freezeBaselineNoise(dataset, before, other);
    assert.equal(noise.overall.delta, 0);
    assert.ok(noise.overall.bound > 0, 'a zero point difference is not zero stochastic noise');
    assert.equal(noise.overall.bound, Math.max(...noise.overall.delta95.map(Math.abs)));
    assert.equal(Object.isFrozen(noise.overall), true);
    const after = round();
    const report = compareMemoryRounds(dataset, before, after, { noiseReference: noise });
    assert.equal(report.acceptedImprovement, true);
    assert.ok(report.overall.delta95[0] > 0);
    assert.ok(report.overall.delta > noise.overall.bound);
    const small = structuredClone(before);
    const at = small.results.findIndex((_, index) => index % 2 !== 0);
    (small.results[at].forgetStages?.before ?? small.results[at]).judge.correct = true;
    assert.equal(compareMemoryRounds(dataset, before, small, { noiseReference: noise }).acceptedImprovement, false);
    const incomplete = structuredClone(other); incomplete.results.pop();
    assert.throws(() => freezeBaselineNoise(dataset, before, incomplete), /CM_ROUND_BASELINE_INCOMPLETE/);
    assert.throws(() => compareMemoryRounds(dataset, before, after), /CM_ROUND_NOISE_REQUIRED/);
});

test('attribution preserves mapping/target gaps and needs explicit absence or controlled judge evidence', () => {
    const summary = round(), testCase = first('single'), row = resultFor(summary, testCase.id);
    row.judge.correct = false;
    row.answer = 'PRIVATE_BODY_SHOULD_NOT_SURVIVE';
    row.extractedFactIds = []; row.legalCandidateFactIds = []; row.finalRankedFactIds = []; row.injectedFactIds = [];
    let failure = attributeMemoryFailures(dataset, summary).cases.find(row => row.caseId === testCase.id);
    assert.equal(failure.cause, 'UNKNOWN');
    assert.ok(failure.gaps.includes('EXTRACTION_NOT_PROVEN_ABSENT'));
    row.mapping_uncertain = true; row.targetMissing = true;
    failure = attributeMemoryFailures(dataset, summary).cases.find(row => row.caseId === testCase.id);
    assert.ok(failure.gaps.includes('MAPPING_UNCERTAIN'));
    assert.ok(failure.gaps.includes('TARGET_MISSING'));
    delete row.mapping_uncertain; delete row.targetMissing;
    const review = { caseId: testCase.id, stage: null, controlled: true, method: 'HUMAN',
        verifiedAbsentExtractedFactIds: testCase.goldFactIds };
    assert.equal(attributeMemoryFailures(dataset, summary, { controlledReviews: [review] }).cases
        .find(row => row.caseId === testCase.id).cause, 'NOT_EXTRACTED');
    Object.assign(row, observation(testCase)); row.judge.correct = false;
    assert.equal(attributeMemoryFailures(dataset, summary).cases.find(row => row.caseId === testCase.id).cause, 'WRONG_AFTER_INJECTION');
    assert.equal(attributeMemoryFailures(dataset, summary, { controlledReviews: [{ ...review,
        verifiedAbsentExtractedFactIds: [], judgeErrorConfirmed: true, correctedJudge: judge(false) }] }).cases
        .find(row => row.caseId === testCase.id).cause, 'JUDGE_ERROR');
    row.rule.passed = false; row.judge.correct = true;
    assert.notEqual(attributeMemoryFailures(dataset, summary).cases.find(row => row.caseId === testCase.id).cause, 'JUDGE_ERROR');
    assert.equal(JSON.stringify(attributeMemoryFailures(dataset, summary)).includes('PRIVATE_BODY'), false);
});

test('positive evidence separates missed retrieval, missed injection, and unanswerable failures', () => {
    const summary = round(), testCase = first('single'), row = resultFor(summary, testCase.id);
    row.judge.correct = false; row.finalRankedFactIds = []; row.injectedFactIds = [];
    const get = () => attributeMemoryFailures(dataset, summary).cases.find(row => row.caseId === testCase.id);
    assert.equal(get().cause, 'NOT_RECALLED');
    row.legalCandidateFactIds = []; assert.equal(get().cause, 'UNKNOWN');
    row.legalCandidateFactIds = [...testCase.goldFactIds]; row.finalRankedFactIds = [[...testCase.goldFactIds]];
    assert.equal(get().cause, 'NOT_INJECTED');
    delete row.injectedFactIds; assert.equal(get().cause, 'UNKNOWN');
    const abstain = first('abstain'); resultFor(summary, abstain.id).judge.correct = false;
    assert.equal(attributeMemoryFailures(dataset, summary).cases.find(row => row.caseId === abstain.id).cause, 'UNKNOWN');
    const forget = resultFor(summary, first('forget').id);
    delete forget.forgetStages.late;
    const failure = attributeMemoryFailures(dataset, summary).cases.find(row => row.caseId === forget.caseId);
    assert.equal(failure.stages.find(row => row.stage === 'late').status, 'NOT_RUN');
    assert.equal(failure.cause, 'UNKNOWN');
});

test('reports recall quantiles and first-body regression over 20%, keeps unknown metrics NOT_RUN', () => {
    const before = round(), after = round();
    for (let index = 0; index < 20; index++) {
        before.metricRows.push(metric('recall_ms', index + 1, index), metric('pipeline_first_body_ms', 100, index));
        after.metricRows.push(metric('recall_ms', (index + 1) * 2, index, 'candidate'), metric('pipeline_first_body_ms', 121, index, 'candidate'));
    }
    let report = comparison(before, after);
    assert.equal(report.latency.recall[0].baseline.p50, 10);
    assert.equal(report.latency.recall[0].candidate.p95, 38);
    assert.equal(report.latency.firstBody[0].regressionOver20Percent, true);
    after.metricRows.filter(row => row.metric === 'pipeline_first_body_ms').forEach(row => { row.value = 120; });
    report = comparison(before, after);
    assert.equal(report.latency.firstBody[0].regressionOver20Percent, false);
    after.metricRows = [];
    assert.equal(comparison(before, after).latency.firstBody[0].status, 'NOT_RUN');
});

test('stops at five completed improvement rounds without credible gains, resets on a gain', () => {
    const before = round(), noiseReference = freezeBaselineNoise(dataset, before, structuredClone(before));
    const reports = [];
    for (let index = 0; index < 5; index++) {
        const report = compareMemoryRounds(dataset, before, before, { noiseReference, priorImprovementRounds: reports });
        assert.equal(report.stagnation.consecutiveWithoutImprovement, index + 1);
        assert.equal(report.stagnation.stop, index === 4);
        reports.push(report);
    }
    const failed = structuredClone(before); failed.results.pop();
    const incomplete = compareMemoryRounds(dataset, before, failed, { noiseReference, priorImprovementRounds: reports.slice(0, 4) });
    assert.equal(incomplete.stagnation.consecutiveWithoutImprovement, 4);
    assert.equal(incomplete.stagnation.stop, false);
    const history = [...reports.slice(0, 4), { ...reports[0], acceptedImprovement: true }];
    assert.equal(compareMemoryRounds(dataset, before, before, { noiseReference, priorImprovementRounds: history })
        .stagnation.consecutiveWithoutImprovement, 1);
});


test('completed answers with failed actions score zero but still quantify baseline noise honestly', () => {
    const before = round(), after = round();
    const correction = dataset.cases.find(row => row.action?.kind === 'correct');
    resultFor(after, correction.id).actionStatus = 'FAILED';
    resultFor(after, first('forget').id).actionStatus = 'BLOCKED';
    const report = comparison(before, after);
    assert.equal(report.complete, true);
    assert.equal(report.overall.candidate.numerator, 138);
    assert.equal(report.actionsComplete, false);
    assert.equal(report.qualityBaselineReady, false);
    const noise = freezeBaselineNoise(dataset, after, structuredClone(after));
    assert.equal(noise.actionsComplete, false);
    assert.equal(noise.qualityBaselineReady, false);
    const failures = attributeMemoryFailures(dataset, after);
    const actionFailure = failures.cases.find(row => row.caseId === correction.id);
    assert.equal(actionFailure.cause, 'UNKNOWN');
    assert.ok(actionFailure.gaps.includes('ACTION_NOT_COMPLETED'));
    const forgetFailure = failures.cases.find(row => row.caseId === first('forget').id);
    assert.equal(forgetFailure.stages.find(row => row.stage === 'before').passed, true);
    assert.ok(forgetFailure.stages.slice(1).every(row => !row.passed && row.cause === 'UNKNOWN'));
});

test('CI positivity and strictly exceeding the noise bound are independent requirements', () => {
    const before = round(() => false), identical = structuredClone(before);
    const noiseReference = freezeBaselineNoise(dataset, before, identical), small = structuredClone(before);
    resultFor(small, first('single').id).judge.correct = true;
    const uncertain = compareMemoryRounds(dataset, before, small, { noiseReference });
    assert.ok(uncertain.overall.delta > noiseReference.overall.bound);
    assert.equal(uncertain.overall.delta95[0], 0);
    assert.equal(uncertain.acceptedImprovement, false);
    const after = round(), largeNoise = freezeBaselineNoise(dataset, before, after);
    const equalBound = compareMemoryRounds(dataset, before, after, { noiseReference: largeNoise });
    assert.equal(equalBound.overall.delta95[0], 1);
    assert.equal(equalBound.overall.delta, largeNoise.overall.bound);
    assert.equal(equalBound.acceptedImprovement, false);
});

test('missing judge evidence cannot freeze an apparently complete baseline', () => {
    const before = round(), after = round();
    delete after.results[0].judge;
    assert.throws(() => freezeBaselineNoise(dataset, before, after), /CM_ROUND_BASELINE_INCOMPLETE/);
});


test('attribution emits no malformed boolean text and cannot call a missing judgment a judge error', () => {
    const summary = round(), testCase = first('single'), row = resultFor(summary, testCase.id);
    delete row.judge;
    const controlledReviews = [{ caseId: testCase.id, controlled: true, method: 'HUMAN',
        judgeErrorConfirmed: true, correctedJudge: judge(false) }];
    let failure = attributeMemoryFailures(dataset, summary, { controlledReviews }).cases.find(row => row.caseId === testCase.id);
    assert.equal(failure.cause, 'UNKNOWN');
    row.rule.passed = 'PRIVATE_BOOLEAN_TEXT';
    const report = attributeMemoryFailures(dataset, summary);
    assert.equal(report.cases.find(row => row.caseId === testCase.id).evidence.rulePassed, null);
    assert.equal(JSON.stringify(report).includes('PRIVATE_BOOLEAN_TEXT'), false);
});
