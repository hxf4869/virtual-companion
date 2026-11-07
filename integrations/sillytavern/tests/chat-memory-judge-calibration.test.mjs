import assert from 'node:assert/strict';
import test from 'node:test';
import { createJudgeCalibrationDataset, summarizeJudgeCalibration } from '../../../scripts/lib/chat-memory-judge-calibration.mjs';

const expected = [
    [true, true, false, 'OK'], [true, false, false, 'UNSUPPORTED'],
    [true, true, true, 'OK'], [true, true, true, 'OK'],
    [false, true, true, 'UNJUSTIFIED_ABSTENTION'], [false, false, false, 'SHOULD_ABSTAIN'],
    [false, true, false, 'AMBIGUOUS'], [false, true, false, 'STALE_VALUE'],
    [false, true, false, 'WRONG_TIME'], [false, false, false, 'WRONG_VALUE'],
    [false, true, false, 'MISSING_PART'], [false, false, false, 'LEAK'],
];
const fields = ['correct', 'grounded', 'abstains', 'reasonCode'];
const observations = dataset => dataset.fixtures.map(fixture => ({
    caseId: fixture.caseId, status: 'COMPLETED', judgeReviews: Object.fromEntries(['first', 'second'].map(slot => [slot,
        { status: 'COMPLETED', result: { ...fixture.expected } }])),
}));

test('calibration supplies twelve deterministic independent synthetic prompt inputs', () => {
    const dataset = createJudgeCalibrationDataset();
    assert.equal(dataset.version, 'cm3-judge-calibration-v1');
    assert.equal(Number.isInteger(dataset.seed), true);
    assert.deepEqual(dataset, createJudgeCalibrationDataset());
    assert.equal(dataset.cases.length, 12);
    assert.equal(dataset.fixtures.length, 12);
    const factIds = new Set(dataset.facts.map(fact => fact.factId));
    assert.equal(factIds.size, dataset.facts.length);
    for (const [index, row] of dataset.cases.entries()) {
        assert.equal(row.id, `calibration-${String(index + 1).padStart(2, '0')}`);
        assert.equal(dataset.fixtures[index].caseId, row.id);
        assert.deepEqual(fields.map(field => dataset.fixtures[index].expected[field]), expected[index]);
        for (const field of ['query', 'category', 'expectedAnswer', 'askedAt']) assert.equal(typeof row[field], 'string');
        assert.ok(['single', 'cross_session', 'time', 'update', 'forget', 'isolation', 'abstain'].includes(row.category));
        for (const field of ['recentMessages', 'goldFactIds', 'evidenceSets', 'requiredTerms', 'forbiddenFactIds', 'forbiddenTerms', 'tags']) {
            assert.equal(Array.isArray(row[field]), true);
        }
        for (const message of row.recentMessages) {
            assert.ok(['user', 'assistant'].includes(message.role));
            assert.equal(typeof message.content, 'string');
        }
        for (const id of [...row.goldFactIds, ...row.forbiddenFactIds, ...row.evidenceSets.flat()]) assert.ok(factIds.has(id));
        if (dataset.fixtures[index].expected.reasonCode === 'OK') {
            assert.equal(dataset.fixtures[index].expected.abstains, row.goldFactIds.length === 0);
        }
    }
    for (const fact of dataset.facts) {
        for (const field of ['factId', 'subject', 'predicate', 'value']) assert.equal(typeof fact[field], 'string');
        assert.ok(Array.isArray(fact.valueAliases));
    }
    dataset.cases[0].recentMessages.push({ role: 'user', content: 'changed' });
    dataset.fixtures[0].expected.correct = false;
    assert.notDeepEqual(dataset, createJudgeCalibrationDataset());
});

test('fully correct independent reviews pass both accuracy and agreement gates', () => {
    const dataset = createJudgeCalibrationDataset();
    const summary = summarizeJudgeCalibration(dataset, observations(dataset), { agreement: 1 });
    assert.equal(summary.passed, true);
    assert.deepEqual(summary.firstAccuracy, { numerator: 12, denominator: 12, value: 1 });
    assert.deepEqual(summary.secondAccuracy, summary.firstAccuracy);
    assert.deepEqual(summary.knownCaseAccuracy, summary.firstAccuracy);
    assert.equal(summary.results.length, 12);
    assert.ok(summary.results.every(row => row.firstMatches && row.secondMatches));
    assert.equal(summarizeJudgeCalibration(dataset, observations(dataset), { agreement: 0.89 }).passed, false);
});

test('agreement never turns two matching wrong reviews into correct known cases', () => {
    const dataset = createJudgeCalibrationDataset();
    const rows = observations(dataset);
    for (const row of rows) for (const slot of ['first', 'second']) row.judgeReviews[slot].result = {
        correct: false, grounded: false, abstains: false, reasonCode: 'WRONG_VALUE',
    };
    const summary = summarizeJudgeCalibration(dataset, rows, { agreement: 1 });
    assert.equal(summary.agreement, 1);
    assert.equal(summary.knownCaseAccuracy.numerator, 1);
    assert.equal(summary.passed, false);
});

test('missing, failed, invalid and nonboolean reviews remain in the fixed denominator', () => {
    const dataset = createJudgeCalibrationDataset();
    const rows = observations(dataset);
    rows.shift();
    rows[0].judgeReviews.second.status = 'FAILED';
    rows[1].judgeReviews.first.result.correct = 'true';
    rows[2].status = 'FAILED';
    rows[3].judgeReviews.second.result = null;
    rows[4].judgeReviews.first.result.reasonCode = 'INVALID';
    const summary = summarizeJudgeCalibration(dataset, rows, { agreement: 1 });
    assert.equal(summary.firstAccuracy.denominator, 12);
    assert.equal(summary.secondAccuracy.denominator, 12);
    assert.equal(summary.firstAccuracy.numerator, 8);
    assert.equal(summary.secondAccuracy.numerator, 8);
    assert.equal(summary.knownCaseAccuracy.numerator, 6);
    assert.equal(summary.passed, false);
    assert.equal(summarizeJudgeCalibration(dataset, [], { agreement: 1 }).knownCaseAccuracy.value, 0);
});

test('ninety percent accuracy uses whole planned cases and both reviews', () => {
    const dataset = createJudgeCalibrationDataset();
    const rows = observations(dataset);
    rows[0].judgeReviews.first.result.correct = false;
    assert.equal(summarizeJudgeCalibration(dataset, rows, { agreement: 1 }).knownCaseAccuracy.value, 11 / 12);
    rows[1].judgeReviews.second.result.correct = !rows[1].judgeReviews.second.result.correct;
    const summary = summarizeJudgeCalibration(dataset, rows, { agreement: 1 });
    assert.equal(summary.knownCaseAccuracy.value, 10 / 12);
    assert.equal(summary.passed, false);
});

test('summary rejects duplicate or unmatched case identities and invalid agreement', () => {
    const dataset = createJudgeCalibrationDataset();
    const rows = observations(dataset);
    for (const invalid of [[...rows, rows[0]], [{ caseId: 'unknown' }]]) {
        assert.throws(() => summarizeJudgeCalibration(dataset, invalid, { agreement: 1 }), /CM3_INVALID_JUDGE_CALIBRATION_RESULT/);
    }
    for (const agreement of [undefined, null, '1', NaN, Infinity, -1, 1.01]) {
        assert.throws(() => summarizeJudgeCalibration(dataset, rows, { agreement }), /CM3_INVALID_JUDGE_CALIBRATION_AGREEMENT/);
    }
    for (const broken of [{ ...dataset, cases: dataset.cases.slice(1) },
        { ...dataset, fixtures: [...dataset.fixtures.slice(1), dataset.fixtures[1]] }]) {
        assert.throws(() => summarizeJudgeCalibration(broken, rows, { agreement: 1 }), /CM3_INVALID_JUDGE_CALIBRATION_DATASET/);
    }
});

test('summary copies safe metadata and never retains arbitrary prose or source objects', () => {
    const dataset = createJudgeCalibrationDataset();
    const rows = observations(dataset);
    const marker = 'PRIVATE_CALIBRATION_PROSE';
    rows[0].answer = marker;
    rows[0].judgeReviews.first.error = marker;
    rows[0].judgeReviews.first.result.notes = marker;
    const summary = summarizeJudgeCalibration(dataset, rows, { agreement: 1 });
    const encoded = JSON.stringify(summary);
    assert.ok(!encoded.includes(marker));
    for (const fixture of dataset.fixtures) assert.ok(!encoded.includes(fixture.answer));
    for (const row of dataset.cases) assert.ok(!encoded.includes(row.query));
    for (const fact of dataset.facts) assert.ok(!encoded.includes(fact.value));
    rows[0].judgeReviews.first.result.correct = false;
    assert.equal(summary.results[0].firstMatches, true);
});
