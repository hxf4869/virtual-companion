import assert from 'node:assert/strict';
import test from 'node:test';
import * as scoring from '../../../scripts/lib/chat-memory-scoring.mjs';
import { generateChatMemoryDataset } from '../../../scripts/lib/chat-memory-dataset.mjs';

const cleanStyle = () => Object.fromEntries(scoring.AI_FLAVOR_FIELDS.map(field => [field, false]));
const judgment = (extra = {}) => ({ correct: true, grounded: true, abstains: false, reasonCode: 'OK', aiFlavor: cleanStyle(), ...extra });

// Reviewed synthetic calibration examples, not model results. The expected reason
// describes the first applicable rubric entry; offline checks cannot establish LLM agreement.
const calibration = [
    { id: 'supported', question: '纸灯目前放哪？', answer: '青架。', evidence: '目前在青架。', reason: 'OK', correct: true, grounded: true, abstains: false },
    { id: 'unsupported-lucky', question: '纸灯目前放哪？', answer: '青架。', evidence: '没有合法位置证据；gold为青架。', reason: 'UNSUPPORTED', correct: true, grounded: false, abstains: false },
    { id: 'unsupported-extra', question: '纸灯目前放哪？', answer: '青架，你昨天买的。', evidence: '仅支持目前在青架。', reason: 'UNSUPPORTED', correct: false, grounded: false, abstains: false },
    { id: 'necessary-refusal', question: '我的暗记是什么？', answer: '没有足够信息。', evidence: '无合法证据。', reason: 'OK', correct: true, grounded: true, abstains: true },
    { id: 'unnecessary-refusal', question: '纸灯目前放哪？', answer: '我不知道。', evidence: '目前在青架。', reason: 'UNJUSTIFIED_ABSTENTION', correct: false, grounded: true, abstains: true },
    { id: 'guess-despite-refusal', question: '我的暗记是什么？', answer: '不确定，也许是白帆。', evidence: '无合法证据。', reason: 'SHOULD_ABSTAIN', correct: false, grounded: false, abstains: false },
    { id: 'ambiguous-choice', question: '上次做到哪？', answer: '装订完成了。', evidence: '两个主题并存，无法确定指向；未支持装订完成。', reason: 'AMBIGUOUS', correct: false, grounded: false, abstains: false },
    { id: 'old-current', question: '纸灯目前放哪？', answer: '红柜。', evidence: '以前在红柜，目前在青架。', reason: 'STALE_VALUE', correct: false, grounded: true, abstains: false },
    { id: 'historical-current', question: '纸灯以前放哪？', answer: '青架。', evidence: '以前在红柜，目前在青架。', reason: 'WRONG_TIME', correct: false, grounded: true, abstains: false },
    { id: 'wrong-value', question: '纸灯目前放哪？', answer: '黑柜。', evidence: '唯一当前位置为青架。', reason: 'WRONG_VALUE', correct: false, grounded: false, abstains: false },
    { id: 'missing-part', question: '纸灯和纸船分别放哪？', answer: '纸灯在青架。', evidence: '纸灯在青架；纸船在白柜。', reason: 'MISSING_PART', correct: false, grounded: true, abstains: false },
    { id: 'leak-over-stale', question: '纸灯目前放哪？', answer: '红柜；另一个账号的暗记是紫帆。', evidence: '以前在红柜，目前在青架；紫帆为禁止事实。', reason: 'LEAK', correct: false, grounded: false, abstains: false },
];

test('judge has a versioned, defined total reason priority and reviewed boundary fixtures', () => {
    assert.equal(typeof scoring.JUDGE_RUBRIC_VERSION, 'string');
    const priority = scoring.JUDGE_REASON_RUBRIC.map(row => row.reasonCode);
    assert.deepEqual(priority, ['LEAK', 'STALE_VALUE', 'WRONG_TIME', 'WRONG_VALUE', 'AMBIGUOUS',
        'SHOULD_ABSTAIN', 'UNSUPPORTED', 'UNJUSTIFIED_ABSTENTION', 'MISSING_PART', 'OK']);
    assert.deepEqual([...priority].sort(), [...scoring.JUDGE_REASON_CODES].sort());
    for (const row of scoring.JUDGE_REASON_RUBRIC) assert.ok(row.definition.length >= 20);
    for (const fixture of calibration) {
        const result = judgment({ correct: fixture.correct, grounded: fixture.grounded, abstains: fixture.abstains, reasonCode: fixture.reason });
        assert.deepEqual(scoring.parseJudgeResult(result), result, fixture.id);
    }
});

test('judge rejects incompatible reason flags while retaining semantically correct unsupported guesses', () => {
    for (const result of [judgment({ grounded: false }), judgment({ correct: false }),
        judgment({ reasonCode: 'WRONG_VALUE' }), judgment({ reasonCode: 'LEAK', correct: false, grounded: false, abstains: true }),
        judgment({ reasonCode: 'UNSUPPORTED', abstains: true, grounded: false }),
        judgment({ reasonCode: 'UNJUSTIFIED_ABSTENTION', correct: false, abstains: false }),
        judgment({ reasonCode: 'MISSING_PART', correct: false, grounded: false })]) {
        assert.throws(() => scoring.parseJudgeResult(result), /CM3_INVALID_JUDGE_RESULT/);
    }
    assert.equal(scoring.parseJudgeResult(judgment({ reasonCode: 'UNSUPPORTED', grounded: false })).correct, true);
});

test('prompt freezes reason definitions, precedence and forbidden/time context without runtime labels', () => {
    const dataset = generateChatMemoryDataset();
    const testCase = dataset.cases.find(row => row.category === 'update' && row.tags.includes('current'));
    const prompt = scoring.buildJudgePrompt({ ...testCase, variant: 'secret-candidate', telemetry: 'private-route' },
        { answer: testCase.expectedAnswer, facts: dataset.facts });
    assert.ok(prompt.includes(scoring.JUDGE_RUBRIC_VERSION));
    assert.ok(prompt.includes('首个命中'));
    let last = -1;
    for (const row of scoring.JUDGE_REASON_RUBRIC) {
        const index = prompt.indexOf(`${row.reasonCode}:`);
        assert.ok(index > last, row.reasonCode);
        assert.ok(prompt.includes(row.definition));
        last = index;
    }
    const input = JSON.parse(prompt.split('\n').at(-1));
    assert.deepEqual(input.wrongAnswerValues, testCase.forbiddenTerms);
    assert.equal(input.askedAt, testCase.askedAt);
    assert.equal(input.timeTarget, 'current');
    assert.ok(!prompt.includes('secret-candidate') && !prompt.includes('private-route'));
});

test('two reviews preserve sanitized results and separate fact/style disagreements', () => {
    const first = judgment();
    const second = judgment({ aiFlavor: { ...cleanStyle(), templateEnding: true } });
    const compared = scoring.compareJudgeResults(first, second);
    assert.equal(compared.agreed, true);
    assert.equal(compared.factualAgreed, true);
    assert.equal(compared.styleAgreed, false);
    assert.deepEqual(compared.disagreementFields, ['aiFlavor.templateEnding']);
    assert.deepEqual(compared.factualConsensus, { correct: true, grounded: true, abstains: false, reasonCode: 'OK' });
    assert.equal(compared.consensus, null);
    assert.deepEqual(compared.first, first);
    assert.deepEqual(compared.second, second);
    first.aiFlavor.customerService = true;
    assert.equal(compared.first.aiFlavor.customerService, false, 'saved comparison must not alias input');

    const disputed = scoring.compareJudgeResults(judgment(), judgment({ correct: false, reasonCode: 'MISSING_PART' }));
    assert.equal(disputed.agreed, false);
    assert.deepEqual(disputed.factualDisagreementFields, ['correct', 'reasonCode']);
    assert.equal(disputed.factualConsensus, null);
});

test('missing or invalid review fails explicitly without retaining arbitrary text', () => {
    const missing = scoring.compareJudgeResults(judgment(), undefined);
    assert.equal(missing.status, 'INCOMPLETE');
    assert.deepEqual(missing.failures, { second: 'MISSING' });
    assert.equal(missing.agreed, false);
    assert.equal(missing.factualConsensus, null);
    const invalid = scoring.compareJudgeResults(judgment(), { notes: 'synthetic secret prose' });
    assert.equal(invalid.status, 'INVALID');
    assert.deepEqual(invalid.failures, { second: 'INVALID' });
    assert.equal(invalid.second, null);
    assert.ok(!JSON.stringify(invalid).includes('synthetic secret prose'));
});

test('calibration counts fixed planned case/stages once and includes missing failures in agreement denominator', () => {
    const plan = [{ caseId: 'single-01' }, { caseId: 'forget-01', stage: 'before' }, { caseId: 'forget-01', stage: 'done' }];
    const observations = [{ caseId: 'single-01', first: judgment(), second: judgment() },
        { caseId: 'forget-01', stage: 'before', first: judgment(), second: judgment({ correct: false, reasonCode: 'MISSING_PART' }) }];
    const summary = scoring.summarizeJudgeComparisons(plan, observations);
    assert.equal(summary.plannedSecondReviews, 3);
    assert.equal(summary.secondReviews, 2);
    assert.equal(summary.failedSecondReviews, 1);
    assert.equal(summary.agreedSecondReviews, 1);
    assert.equal(summary.agreement, 1 / 3);
    assert.equal(summary.results.length, 3);
    assert.throws(() => scoring.summarizeJudgeComparisons(plan, [...observations, observations[0]]), /CM3_INVALID_JUDGE_COMPARISON/);
    assert.throws(() => scoring.summarizeJudgeComparisons([...plan, plan[0]], observations), /CM3_INVALID_JUDGE_COMPARISON/);
    assert.throws(() => scoring.summarizeJudgeComparisons(plan, [{ caseId: 'unplanned', first: judgment(), second: judgment() }]), /CM3_INVALID_JUDGE_COMPARISON/);
});

test('a positive judge never overrides a rule failure', () => {
    const dataset = generateChatMemoryDataset();
    const testCase = dataset.cases.find(row => row.category === 'single');
    const result = { caseId: testCase.id, status: 'COMPLETED', rule: { passed: false, reasonCode: 'MISSING_INJECTION' }, judge: judgment() };
    const summary = scoring.summarizeChatMemoryEvaluation([testCase], [result]);
    assert.equal(summary.accuracy.numerator, 0);
});
