import assert from 'node:assert/strict';
import test from 'node:test';
import { generateChatMemoryDataset, FORGET_STAGES } from '../../../scripts/lib/chat-memory-dataset.mjs';
import { AI_FLAVOR_FIELDS, summarizeChatMemoryEvaluation } from '../../../scripts/lib/chat-memory-scoring.mjs';
import { buildReviewTasks, stratifiedJudgePlan, reviewEvaluationAnswers } from '../../../scripts/lib/chat-memory-judging.mjs';

const aiFlavor = Object.fromEntries(AI_FLAVOR_FIELDS.map(key => [key, false]));
const judgment = testCase => ({ correct: true, grounded: true, abstains: !testCase.goldFactIds.length, reasonCode: 'OK', aiFlavor });

function fixture() {
    const dataset = generateChatMemoryDataset();
    const outputs = [], results = dataset.cases.map(testCase => {
        const result = { caseId: testCase.id, status: 'COMPLETED', rule: { passed: true } };
        if (testCase.category === 'forget') {
            result.forgetStages = Object.fromEntries(FORGET_STAGES.map(stage => {
                outputs.push({ caseId: testCase.id, stage, control: null, answer: 'synthetic fixture answer' });
                return [stage, { ...result, cleanupStatus: 'DONE' }];
            }));
        } else outputs.push({ caseId: testCase.id, stage: null, control: null, answer: 'synthetic fixture answer' });
        return result;
    });
    return { dataset, outputs, results, controls: {} };
}

test('stratified second reviews are frozen by seed, cover all categories and expand forget stages', () => {
    const dataset = generateChatMemoryDataset();
    const plan = stratifiedJudgePlan(dataset);
    assert.deepEqual(plan, stratifiedJudgePlan(dataset));
    assert.equal(plan.length, 22);
    assert.equal(new Set(plan.map(row => row.caseId)).size, 14);
    assert.equal(plan.filter(row => row.stage).length, 10);
    assert.notDeepEqual(plan, stratifiedJudgePlan({ ...dataset, seed: dataset.seed + 1 }));
});

test('judge-only tasks reuse exact output and observation references without creating foreground requests', async () => {
    const f = fixture();
    const tasks = buildReviewTasks(f.dataset, f.results, f.controls, f.outputs);
    const initial = tasks.length;
    let calls = 0, checkpointed = 0;
    const calibration = await reviewEvaluationAnswers({ dataset: f.dataset, tasks,
        invoke: async (task, prompt) => {
            assert.equal(task.answer, 'synthetic fixture answer');
            assert.match(prompt, /固定评审版本/);
            if (task.reviewPass === 2) assert.ok(calls >= initial);
            return { judgment: judgment(task.testCase), callId: ++calls };
        }, checkpoint: async () => { checkpointed++; } });
    assert.equal(calls, initial + 22);
    assert.equal(checkpointed, calls);
    assert.equal(calibration.agreement, 1);
    assert.equal(calibration.results.length, 22);
    assert.equal(calibration.failedSecondReviews, 0);
    assert.ok(tasks.every(task => task.answer === ''));
    const observation = f.results.find(row => !row.forgetStages);
    assert.equal(observation.judge.correct, true);
    assert.ok(Number.isSafeInteger(observation.judgeReviews.first.callId));
});

test('factual disagreements keep both judgments and cannot score the first judgment as consensus', async () => {
    const f = fixture(), plan = stratifiedJudgePlan(f.dataset);
    const target = plan.find(row => !row.stage);
    const tasks = buildReviewTasks(f.dataset, f.results, f.controls, f.outputs);
    let calls = 0;
    const calibration = await reviewEvaluationAnswers({ dataset: f.dataset, tasks,
        invoke: async task => ({ callId: ++calls, judgment: task.testCase.id === target.caseId && task.reviewPass === 2
            ? { ...judgment(task.testCase), correct: false, reasonCode: 'WRONG_VALUE' } : judgment(task.testCase) }) });
    const result = f.results.find(row => row.caseId === target.caseId);
    assert.equal(result.judge.correct, true);
    assert.equal(result.judgeAgreement, false);
    assert.equal(result.judgeReviews.second.result.correct, false);
    assert.deepEqual(result.judgeReviews.comparison.factualDisagreementFields, ['correct', 'reasonCode']);
    assert.equal(calibration.agree, 21);
    assert.equal(calibration.plannedSecondReviews, 22);
    const summary = summarizeChatMemoryEvaluation(f.dataset.cases, f.results);
    assert.equal(summary.accuracy.numerator, 139);
});

test('missing and failed reviews retain the frozen denominator, raw provider errors are not recorded', async () => {
    const f = fixture(), target = stratifiedJudgePlan(f.dataset).find(row => !row.stage);
    const tasks = buildReviewTasks(f.dataset, f.results, f.controls, f.outputs);
    let calls = 0;
    const calibration = await reviewEvaluationAnswers({ dataset: f.dataset, tasks,
        invoke: async task => {
            calls++;
            if (task.testCase.id === target.caseId) throw new Error('private upstream detail');
            return { callId: calls, judgment: judgment(task.testCase) };
        } });
    assert.equal(calibration.plannedSecondReviews, 22);
    assert.equal(calibration.failedSecondReviews, 1);
    assert.equal(calibration.agree, 21);
    assert.equal(JSON.stringify({ calibration, results: f.results }).includes('private upstream detail'), false);
});

test('cached outputs cannot invent a missing result, an unmatched case or duplicate review', () => {
    const f = fixture();
    assert.throws(() => buildReviewTasks(f.dataset, [], f.controls, f.outputs), /CM_REVIEW_RESULT_MISSING/);
    assert.throws(() => buildReviewTasks(f.dataset, f.results, f.controls, [...f.outputs, f.outputs[0]]), /CM_REVIEW_OUTPUT_INVALID/);
    assert.throws(() => buildReviewTasks(f.dataset, f.results, f.controls,
        [{ ...f.outputs[0], caseId: 'unknown-case' }]), /CM_REVIEW_OUTPUT_INVALID/);
    const result = f.results.find(row => !row.forgetStages);
    result.status = 'FAILED'; result.failureCode = 'CM_JUDGE_FAILED';
    const task = buildReviewTasks(f.dataset, f.results, f.controls, f.outputs).find(row => row.testCase.id === result.caseId);
    assert.equal(task.result.status, 'COMPLETED');
    assert.equal(task.result.failureCode, undefined);
});

test('forget questions keep their empty-gold retrieval denominator and require the full action to pass', () => {
    const dataset = generateChatMemoryDataset(), testCase = dataset.cases.find(row => row.category === 'forget');
    const before = { caseId: testCase.id, status: 'COMPLETED', extractedFactIds: testCase.goldFactIds,
        legalCandidateFactIds: testCase.goldFactIds, finalRankedFactIds: testCase.goldFactIds.map(id => [id]),
        injectedFactIds: testCase.goldFactIds };
    const report = summarizeChatMemoryEvaluation(dataset.cases,
        [{ caseId: testCase.id, status: 'FAILED', forgetStages: { before } }]);
    assert.equal(report.retrieval.finalConditional[5].macro, null);
    assert.equal(report.retrieval.finalConditional[5].denominator, 0);
    assert.equal(report.injection.allEvidence.numerator, 0);
    assert.equal(report.accuracy.numerator, 0, 'pre-forget evidence must not turn an unexecuted deletion into a passed case');
});
