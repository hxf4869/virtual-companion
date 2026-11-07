// Both fresh rounds and judge-only reevaluations use this exact blind rubric.
// Response prose is kept only in the authorized private synthetic answer cache.
import { CASE_CATEGORIES, FORGET_STAGES, forgetStageCase } from './chat-memory-dataset.mjs';
import { JUDGE_RUBRIC_VERSION, buildJudgePrompt, parseJudgeResult,
    compareJudgeResults, summarizeJudgeComparisons } from './chat-memory-scoring.mjs';

const keyOf = row => JSON.stringify([row.caseId, row.stage ?? null, row.control ?? null]);
function seededShuffle(rows, seed) {
    const shuffled = [...rows];
    let state = seed >>> 0;
    for (let i = shuffled.length - 1; i > 0; i--) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        const at = Math.floor((state / 4294967296) * (i + 1));
        [shuffled[i], shuffled[at]] = [shuffled[at], shuffled[i]];
    }
    return shuffled;
}

export function stratifiedJudgePlan(dataset) {
    return CASE_CATEGORIES.flatMap((category, index) => seededShuffle(
        dataset.cases.filter(row => row.category === category), dataset.seed + index * 104729,
    ).slice(0, 2).flatMap(testCase => testCase.category === 'forget'
        ? FORGET_STAGES.map(stage => ({ caseId: testCase.id, stage })) : [{ caseId: testCase.id }]));
}

export function buildReviewTasks(dataset, results, diagnosticControls, outputs) {
    const seen = new Set(), cases = new Map(dataset.cases.map((testCase, caseIndex) => [testCase.id, { testCase, caseIndex }]));
    const core = new Map(results.map(row => [row.caseId, row]));
    return outputs.map(output => {
        const entry = cases.get(output.caseId), key = keyOf(output);
        if (!entry || seen.has(key) || typeof output.answer !== 'string' || !output.answer.trim()
            || (output.stage != null && (!FORGET_STAGES.includes(output.stage) || entry.testCase.category !== 'forget'))
            || (output.control != null && (!['memory-off', 'gold-evidence'].includes(output.control) || output.stage != null))) {
            throw new Error('CM_REVIEW_OUTPUT_INVALID');
        }
        seen.add(key);
        const parent = output.control ? diagnosticControls[output.control]?.results?.find(row => row.caseId === output.caseId)
            : core.get(output.caseId);
        const result = output.stage ? parent?.forgetStages?.[output.stage] : parent;
        if (!result) throw new Error('CM_REVIEW_RESULT_MISSING');
        // An actual successful foreground output can recover a failed judge,
        // never a missing correction/forget action or failed provider answer.
        if (result.failureCode === 'CM_JUDGE_FAILED') {
            result.status = 'COMPLETED'; delete result.failureCode;
        }
        delete result.judge; delete result.judgeReviews;
        delete result.judgeAgreement; delete result.judgeAgreementRequired;
        return { testCase: output.stage ? forgetStageCase(dataset, entry.testCase, output.stage) : entry.testCase,
            result, answer: output.answer, caseIndex: entry.caseIndex, stage: output.stage, control: output.control };
    });
}

export async function reviewEvaluationAnswers({ dataset, tasks, invoke, signal, calibrate = true, plannedSecondReviews,
    onProgress = () => {}, checkpoint = async () => {} }) {
    const planned = plannedSecondReviews ?? (calibrate ? stratifiedJudgePlan(dataset) : []), plannedKeys = new Set(planned.map(keyOf));
    const doubleTasks = new Map(), observations = new Map();
    let completed = 0;
    const review = async (task, pass) => {
        signal?.throwIfAborted();
        task.reviewPass = pass;
        task.result.judgeReviews ??= { rubricVersion: JUDGE_RUBRIC_VERSION };
        const slot = pass === 1 ? 'first' : 'second';
        try {
            const output = await invoke(task, buildJudgePrompt(task.testCase, { answer: task.answer, facts: dataset.facts }));
            const result = parseJudgeResult(output.judgment);
            if (!Number.isSafeInteger(output.callId) || output.callId < 1) throw new Error('CM_JUDGE_CALL_MISSING');
            task.result.judgeReviews[slot] = { status: 'COMPLETED', callId: output.callId, result };
            if (pass === 1) task.result.judge = result;
        } catch (error) {
            if (signal?.aborted) throw error;
            task.result.judgeReviews[slot] = { status: 'FAILED',
                callId: Number.isSafeInteger(error.cmJudgeCallId) ? error.cmJudgeCallId : null, failureCode: 'CM_JUDGE_FAILED' };
            if (pass === 1) { task.result.status = 'FAILED'; task.result.failureCode = 'CM_JUDGE_FAILED'; }
        }
        if (!task.control && plannedKeys.has(keyOf({ caseId: task.testCase.id, stage: task.stage }))) {
            task.result.judgeAgreementRequired = true;
            task.result.judgeAgreement = false;
            if (pass === 1) doubleTasks.set(keyOf({ caseId: task.testCase.id, stage: task.stage }), task);
            else {
                const comparison = compareJudgeResults(task.result.judgeReviews.first?.result, task.result.judgeReviews.second?.result);
                task.result.judgeReviews.comparison = comparison;
                task.result.judgeAgreement = comparison.factualAgreed;
                const identity = { caseId: task.testCase.id, ...(task.stage ? { stage: task.stage } : {}) };
                observations.set(keyOf(identity), { ...identity, first: comparison.first, second: comparison.second });
            }
        }
        completed++;
        onProgress({ phase: 'judge', completed, planned: tasks.length + planned.length, pass });
        await checkpoint();
    };
    try {
        // Second judgments occur after every first judgment, in a different
        // frozen order. Variant labels and previous judgments never enter prompts.
        for (const task of seededShuffle(tasks, dataset.seed ^ 0x12edcba)) await review(task, 1);
        for (const task of seededShuffle([...doubleTasks.values()], dataset.seed ^ 0x7654321)) await review(task, 2);
        const calibration = summarizeJudgeComparisons(planned, [...observations.values()]);
        return { ...calibration, agree: calibration.agreedSecondReviews,
            notRunSecondReviews: planned.length - doubleTasks.size,
            humanReview: 'NOT_RUN', order: 'seeded-separated-passes-v1' };
    } finally {
        for (const task of tasks) task.answer = '';
    }
}
