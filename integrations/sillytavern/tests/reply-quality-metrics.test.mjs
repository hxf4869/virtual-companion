import test from 'node:test';
import assert from 'node:assert/strict';
import {
    REPLY_QUALITY_RULE_CODES,
    createReplyQualityMetrics,
    planReplyAction,
} from '../extension/vc-model-settings/reply-pipeline.js';

test('记录首轮和最终回复的实际规则判定，重写耗时到再次判定为止', () => {
    let clock = 0;
    const metrics = createReplyQualityMetrics({ now: () => clock });
    const sample = metrics.start();
    const first = planReplyAction({ text: '作为AI，希望对你有帮助。我很难过，但是还好', metrics, sample });
    assert.equal(first.action, 'rewrite');
    clock = 43;
    const rewritten = planReplyAction({ text: '我的生活就像一场旅行。今夜风有点冷', rewritten: true, metrics, sample });
    assert.equal(rewritten.action, 'keep');
    clock = 91;
    metrics.finish(sample, { outcome: 'ok', text: rewritten.processed.text });

    assert.deepEqual(REPLY_QUALITY_RULE_CODES, ['courtesy', 'as-ai', 'stock', 'aphorism', 'turns', 'questions', 'think-markup', 'list-markup', 'action-aside']);
    assert.deepEqual(metrics.drain(), {
        dropped: 0,
        pending: 0,
        samples: [{
            sample,
            outcome: 'ok',
            rawFirstRules: { hard: ['courtesy', 'as-ai'], soft: ['turns'] },
            finalRules: { hard: [], soft: ['aphorism'] },
            rewriteRequested: true,
            rewriteCompleted: true,
            rewriteExtraMs: 43,
            overlap: null,
        }],
    });
});

test('已经剥除的括号动作、列表和思考标记仍进入首次候选命中统计', () => {
    const metrics = createReplyQualityMetrics();
    const sample = metrics.start();
    const result = planReplyAction({ text: '合成思考</think>\n- 好呀（挥手）', metrics, sample });
    assert.equal(result.action, 'keep');
    assert.equal(result.processed.text, '好呀');
    metrics.finish(sample, { outcome: 'ok', text: result.processed.text });
    assert.deepEqual(metrics.drain().samples[0].rawFirstRules.soft, ['think-markup', 'list-markup', 'action-aside']);
});

test('重叠率按 Unicode 字符计算，比较当前会话最近三条回复的不同 3-gram', () => {
    const metrics = createReplyQualityMetrics();
    for (const [text, previousReplies] of [
        ['甲😀乙丙', ['它😀乙丙']],
        ['甲乙甲乙甲', ['甲乙甲']],
        ['甲乙丙丁', ['甲乙丙', '乙丙丁']],
        ['甲😀乙丙', ['甲😀乙丙', '早上好', '天亮了', '吃过了']],
        ['甲😀乙丙', []],
        ['甲😀乙丙', ['甲😀']],
        ['甲😀', ['甲😀乙丙']],
    ]) {
        metrics.finish(metrics.start(), { outcome: 'ok', text, previousReplies });
    }
    const { samples } = metrics.drain();
    assert.deepEqual(samples.map(({ overlap }) => overlap), [0.5, 0.5, 1, 0, null, null, null]);
    // 已完成的其他样本不成为本轮历史，且未走规则路径时无规则或重写样本。
    assert.deepEqual(samples[4], {
        sample: 5, outcome: 'ok', rawFirstRules: null, finalRules: null,
        rewriteRequested: null, rewriteCompleted: null, rewriteExtraMs: null, overlap: null,
    });
});

test('普通通过、取消、失败、空回复和未结束的样本按各自边界计量', () => {
    const metrics = createReplyQualityMetrics({ now: () => 50 });
    const clean = metrics.start();
    const plan = planReplyAction({ text: '早上好呀', metrics, sample: clean });
    metrics.finish(clean, { outcome: 'ok', text: plan.processed.text, previousReplies: ['早上好呀'] });
    metrics.finish(clean, { outcome: 'ok', text: plan.processed.text });
    const cancelled = metrics.start();
    planReplyAction({ text: '希望对你有帮助', metrics, sample: cancelled });
    planReplyAction({ text: '早上好呀', rewritten: true, metrics, sample: cancelled });
    metrics.finish(cancelled, { outcome: 'cancelled', text: '早上好呀', previousReplies: ['早上好呀'] });
    const failed = metrics.start();
    planReplyAction({ text: '希望对你有帮助', metrics, sample: failed });
    metrics.finish(failed, { outcome: 'failed', text: '早上好呀' });
    const empty = metrics.start();
    planReplyAction({ text: '   ', metrics, sample: empty });
    metrics.finish(empty, { outcome: 'ok', text: '' });
    metrics.start();

    const result = metrics.drain();
    assert.equal(result.pending, 1);
    assert.deepEqual(result.samples.map(({ outcome }) => outcome), ['ok', 'cancelled', 'failed', 'failed']);
    assert.deepEqual(result.samples[0], {
        sample: clean, outcome: 'ok', rawFirstRules: { hard: [], soft: [] }, finalRules: { hard: [], soft: [] },
        rewriteRequested: false, rewriteCompleted: false, rewriteExtraMs: null, overlap: 1,
    });
    for (const item of result.samples.slice(1)) {
        assert.equal(item.finalRules, null);
        assert.equal(item.overlap, null);
        assert.equal(item.rewriteExtraMs, null);
        assert.notEqual(item.rewriteCompleted, true);
    }
    assert.deepEqual(result.samples[1].rawFirstRules, { hard: ['courtesy'], soft: [] });
    assert.equal(result.samples[1].rewriteRequested, true);
    assert.equal(result.samples[2].rewriteRequested, true);
    assert.equal(result.samples[3].rawFirstRules, null);
});

test('采集只输出封闭规则码，进行中和已完成样本均有容量上限', () => {
    const metrics = createReplyQualityMetrics({ capacity: 1 });
    const first = metrics.start();
    assert.equal(metrics.start(), null);
    metrics.finish(first, { outcome: 'failed' });
    const sample = metrics.start();
    metrics.observe(sample, { action: 'keep', violations: [
        { code: 'private-rule', hard: true },
        { code: 'aphorism', label: 'private-label', hard: false },
        { code: 'aphorism', hard: false },
    ] });
    metrics.finish(sample, { outcome: 'ok', text: 'private-reply', previousReplies: ['private-reply'] });
    assert.deepEqual(metrics.drain(), {
        dropped: 2,
        pending: 0,
        samples: [{
            sample, outcome: 'ok', rawFirstRules: { hard: [], soft: ['aphorism'] }, finalRules: { hard: [], soft: ['aphorism'] },
            rewriteRequested: false, rewriteCompleted: false, rewriteExtraMs: null, overlap: 1,
        }],
    });
    assert.deepEqual(metrics.drain(), { samples: [], dropped: 0, pending: 0 });
});
