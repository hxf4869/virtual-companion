import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { summarizeSamples, compareSamples, validateSample, percentile, summarizeReplyQuality } from '../../../scripts/lib/chat-memory-metrics.mjs';
import { createReplyQualityMetrics, planReplyAction } from '../extension/vc-model-settings/reply-pipeline.js';
import { createRoundArtifacts } from '../../../scripts/lib/chat-memory-artifacts.mjs';

function row(overrides = {}) {
    return { sample: 1, metric: 'ttft_visible_ms', value: 100, outcome: 'ok', variant: 'baseline',
        historyMessages: 20, historyBytes: 200, historyTokens: 100, cache: 'warm', modelCache: 'warm',
        network: 'controlled', surface: 'browser', content: 'text', attempts: 1, ...overrides };
}
test('numeric schema rejects text, unknown labels, nonfinite values and invalid timeout bounds', () => {
    for (const sample of [row({ text: 'private' }), row({ outcome: 'arbitrary' }), row({ value: Infinity }),
        row({ cache: 'account-123' }), row({ value: -1 }), row({ outcome: 'timeout' })]) assert.throws(() => validateSample(sample));
    assert.equal(validateSample(row({ outcome: 'timeout', value: 3000, lowerBound: true })).lowerBound, true);
});
test('cold/warm and model states stay separate; timeout stays in denominator and inclusive p95', () => {
    const out = summarizeSamples([row(), row({ sample: 2, outcome: 'timeout', value: 3000, lowerBound: true, attempts: 2 }),
        row({ sample: 3, outcome: 'cancelled', value: null }), row({ sample: 4, outcome: 'budget_stop', value: null }),
        row({ sample: 5, outcome: 'invalid_input', value: null }), row({ sample: 6, outcome: 'silence', value: null }),
        row({ sample: 7, cache: 'cold-browser', modelCache: 'cold' }), row({ sample: 8, warmup: true })]);
    assert.equal(out.warmup, 1); assert.equal(out.groups.length, 2);
    assert.equal(out.groups[0].denominator, 5); assert.equal(out.groups[0].failures, 1);
    assert.equal(out.groups[0].p95, 3000); assert.equal(out.groups[0].censored, 1);
    assert.equal(out.groups[0].successP95, 100); assert.equal(out.groups[0].attempts, 7);
    assert.throws(() => summarizeSamples([row(), row()]), /DUPLICATE/);
    assert.equal(percentile([], .95), null);
});
test('paired samples flag latency/errors/leaks and never turn a missing pair into success', () => {
    const before = [row(), row({ sample: 2, value: 100 })];
    const after = before.map(item => ({ ...item, variant: 'candidate', value: 200 }));
    const result = compareSamples(before, after)[0];
    assert.equal(result.pairs, 2); assert.deepEqual(result.pairedMeanDelta95, [100, 100]);
    assert.equal(result.status, 'FAIL'); assert.equal(result.latencyRegression, true);
    assert.equal(compareSamples(before, [{ ...after[0], value: 110 }])[0].status, 'INCOMPLETE');
    assert.equal(compareSamples(before, after.map(item => ({ ...item, value: 100, outcome: 'save_error' })))[0].errorsWorse, true);
    assert.equal(compareSamples([row({ metric: 'forgotten_leaks', value: 0 })], [row({ variant: 'candidate', metric: 'forgotten_leaks', value: 1 })])[0].status, 'FAIL');
});
test('rule rates distinguish inactive collection, clean evaluated replies and rewrites', () => {
    let clock = 100;
    const collector = createReplyQualityMetrics({ now: () => clock });
    collector.finish(collector.start(), { outcome: 'ok', text: '今晚微风', previousReplies: ['今晚微风'] });
    const inactive = summarizeReplyQuality(collector.drain());
    assert.equal(inactive.status, 'inactive'); assert.equal(inactive.rewrite.rate, null);
    assert.equal(inactive.repetition.p95, 1); assert.equal(inactive.rawFirst.courtesy.denominator, 0);
    const sample = collector.start();
    planReplyAction({ text: '希望对你有帮助', metrics: collector, sample }); clock += 78;
    planReplyAction({ text: '一起去散步', rewritten: true, metrics: collector, sample });
    collector.finish(sample, { outcome: 'ok', text: '一起去散步' });
    const report = summarizeReplyQuality(collector.drain());
    assert.equal(report.rawFirst.courtesy.hardRate, 1); assert.equal(report.final.courtesy.hardRate, 0);
    assert.equal(report.rewrite.rate, 1); assert.equal(report.rewrite.extraP95Ms, 78);
});
test('artifacts retain at most ten marked closed rounds, preserve foreign data and refuse reset', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-cm-metrics-'));
    try {
        await fs.mkdir(path.join(root, 'foreign')); await fs.writeFile(path.join(root, 'foreign', 'keep'), 'x');
        for (let i = 0; i < 12; i++) {
            const artifacts = await createRoundArtifacts(root, { round: `round-${i}`, now: 2000000000000 + i });
            await artifacts.write('summary.json', { n: i }); await artifacts.close();
        }
        const dirs = await fs.readdir(root);
        assert.equal(dirs.filter(dir => dir.startsWith('round-')).length, 10);
        assert.equal(await fs.readFile(path.join(root, 'foreign', 'keep'), 'utf8'), 'x');
        assert.equal((await fs.stat(path.join(root, 'round-11', 'summary.json'))).mode & 0o777, 0o600);
        await assert.rejects(() => createRoundArtifacts(root, { round: 'round-11', now: 2000000000012 }));
        const active = await createRoundArtifacts(root, { round: 'round-next', now: 2000000000013 });
        await assert.rejects(() => active.write('body.txt', 'x'), /NAME_INVALID/);
        await active.close();
    } finally { await fs.rm(root, { recursive: true, force: true }); }
});
