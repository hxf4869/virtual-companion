import test from 'node:test';
import assert from 'node:assert/strict';
import { assertSuggestions, verifySuggestions, ux24BackendScene, diarySchedule, assertDiaryOnce, assertBackgroundSampling } from './ux24-backend-accept.mjs';

function fixture({ fail = false, capture = true } = {}) {
    let directive, seq = 0;
    const captures = [], changes = [];
    return {
        changes,
        fixtureHttp: {
            setOverride: async (model, value) => { directive = value; changes.push(value); },
            captures: async ({ since = 0 } = {}) => captures.filter(c => c.seq > since),
        },
        admin: { call: async (method, path, body) => {
            assert.equal(method, 'POST');
            assert.equal(path, '/api/v1/relationships/42/reply-suggestions');
            assert.equal(body.messages[0].role, 'character');
            assert.equal(typeof body.messages[0].text, 'string');
            if (capture) captures.push({ seq: ++seq, model: 'ux24-background', body: { temperature: 0.3, top_p: 0.8 } });
            return { status: fail ? 503 : 200, json: { suggestions: directive.error ? [] : JSON.parse(directive.text) } };
        } },
    };
}

test('scene is opt-in and uses only existing managed dependencies', () => {
    assert.equal(ux24BackendScene.id, 'ux24-backend');
    assert.equal(ux24BackendScene.default, false);
    assert.deepEqual(ux24BackendScene.needs, ['go', 'stack', 'fixture']);
});
test('suggestions enforce successful content, explicit silence and provider failure', async () => {
    const ctx = fixture();
    const sampling = await verifySuggestions(ctx, '42', 'ux24-background');
    assert.deepEqual(sampling, Array.from({ length: 3 }, () => ({ temperature: 0.3, topP: 0.8 })));
    assert.equal(ctx.changes.length, 4);
    assert.equal(ctx.changes[2].error.status, 500);
    assert.equal(ctx.changes.at(-1), null);
});
test('empty fallback cannot masquerade as successful model output', () => {
    assert.throws(() => assertSuggestions({ suggestions: [] }, ['好呀']), /fixture mismatch/);
    assert.throws(() => assertSuggestions({ suggestions: ['长'.repeat(21)] }, []), /shape/);
    assert.throws(() => assertSuggestions({ suggestions: ['a', 'b', 'c', 'd'] }, []), /shape/);
    assertSuggestions({ suggestions: [] }, []);
});
test('failed HTTP and missing model call both fail and clear owned override', async () => {
    for (const options of [{ fail: true }, { capture: false }]) {
        const ctx = fixture(options);
        await assert.rejects(verifySuggestions(ctx, '42', 'ux24-background'), /HTTP 503|did not reach fixture/);
        assert.equal(ctx.changes.at(-1), null);
    }
});


test('diary quiet start is one hour ahead in relationship local time, including midnight wrap', () => {
    const afternoon = diarySchedule(new Date('2026-11-02T06:27:12Z'));
    assert.equal(afternoon.day, '2026-11-02');
    assert.equal(afternoon.quietHoursTimezone, 'Asia/Shanghai');
    assert.equal(afternoon.quietHoursStart, '15:27');
    assert.equal(afternoon.quietHoursEnd, '23:27');
    assert.equal(afternoon.sourceTimestamp, '2026-11-02T06:27:12.000Z');
    const late = diarySchedule(new Date('2026-11-02T15:30:00Z'));
    assert.equal(late.quietHoursStart, '00:30'); // Go diaryDue falls back to 22:00: already due at 23:30.
    assert.equal(late.day, '2026-11-02');
    const early = diarySchedule(new Date('2026-11-02T16:01:00Z'));
    assert.equal(early.quietHoursStart, '01:01');
    assert.equal(early.day, '2026-11-03');
});

test('diary observation near Shanghai midnight uses UTC to keep both scheduler intervals in one day', () => {
    const plan = diarySchedule(new Date('2026-12-31T15:59:50Z'));
    assert.equal(plan.quietHoursTimezone, 'UTC');
    assert.equal(plan.day, '2026-12-31');
    assert.equal(plan.quietHoursStart, '16:59');
    assert.equal(plan.quietHoursEnd, '00:59');
});

test('unique diary row cannot mask repeated generation or a fabricated page without a model call', () => {
    const before = { pages: 0, attempts: 4 };
    const once = { pages: 1, attempts: 5, cooldownUntil: 1793635200 };
    assertDiaryOnce(before, once, 1);
    assert.throws(() => assertDiaryOnce(before, { ...once, attempts: 6 }, 2), /exactly one model attempt/);
    assert.throws(() => assertDiaryOnce(before, once, 0), /reach fixture exactly once/);
    assert.throws(() => assertDiaryOnce(before, once, 2), /reach fixture exactly once/);
    assert.throws(() => assertDiaryOnce(before, { ...once, cooldownUntil: null }, 1), /cooldown missing/);
    assert.throws(() => assertDiaryOnce(before, { ...once, pages: 2 }, 1), /exactly one page/);
});


test('sampling regression detects omitted suggestions and forced diary temperature without dumping bodies', () => {
    const valid = [{ temperature: 0.3, topP: 0.8 }];
    assertBackgroundSampling({ suggestions: valid, diary: valid });
    assert.throws(() => assertBackgroundSampling({
        suggestions: [{ temperature: undefined, topP: undefined, body: 'synthetic-private-marker' }],
        diary: [{ temperature: 0.4, topP: undefined }],
    }), error => {
        assert.match(error.message, /sampling mismatch: suggestions, diary/);
        assert.doesNotMatch(error.message, /synthetic-private-marker/);
        return true;
    });
    assert.throws(() => assertBackgroundSampling({ suggestions: valid, diary: [] }), /sampling mismatch: diary/);
});
