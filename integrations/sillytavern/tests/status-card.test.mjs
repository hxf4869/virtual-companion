import assert from 'node:assert/strict';
import test from 'node:test';
import {
    MILESTONE_KEY, barPercent, dayCount, firstChatDate, insertMilestone, isMilestone, milestoneHint, nextMilestone, pendingMilestone, subtitleOf,
} from '../extension/vc-model-settings/desktop/status-card.js';

const at = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min);

test('认识第 N 天按本地自然日计算，含当天', () => {
    assert.equal(dayCount(at(2026, 11, 2, 23, 50), at(2026, 11, 2, 0, 5)), 1);
    assert.equal(dayCount(at(2026, 10, 27, 23, 59), at(2026, 11, 2, 0, 1)), 7);
    assert.equal(dayCount(at(2026, 11, 3), at(2026, 11, 2)), 0);
    assert.equal(dayCount('不是时间', at(2026, 11, 2)), 0);
    assert.equal(dayCount(undefined, at(2026, 11, 2)), 0);
});

test('里程碑：7 / 30 / 100 / 365 与每满一年', () => {
    for (const day of [7, 30, 100, 365, 730, 1095]) assert.equal(isMilestone(day), true, String(day));
    for (const day of [0, 1, 8, 99, 364, 366, 731]) assert.equal(isMilestone(day), false, String(day));
    assert.equal(nextMilestone(0), 7);
    assert.equal(nextMilestone(7), 30);
    assert.equal(nextMilestone(42), 100);
    assert.equal(nextMilestone(100), 365);
    assert.equal(nextMilestone(365), 730);
    assert.equal(nextMilestone(400), 730);
    assert.deepEqual(milestoneHint(42), { left: 58, day: 100 });
});

test('副标题：忙到（未来）优先，否则心情 · 在做什么', () => {
    const now = at(2026, 11, 2, 10, 0);
    const state = { mood: { vibe: '黏人' }, activity: '在整理照片' };
    assert.equal(subtitleOf(state, now), '黏人 · 在整理照片');
    assert.equal(subtitleOf({ ...state, busyUntil: at(2026, 11, 2, 14, 5).toISOString() }, now), '忙到 14:05');
    assert.equal(subtitleOf({ ...state, busyUntil: at(2026, 11, 2, 9, 0).toISOString() }, now), '黏人 · 在整理照片');
    assert.equal(subtitleOf({ mood: { vibe: '黏人' } }, now), '黏人');
    assert.equal(subtitleOf({ activity: '在发呆' }, now), '在发呆');
    assert.equal(subtitleOf(null, now), '');
    assert.equal(subtitleOf({}, now), '');
});

test('进度条夹在 0–100', () => {
    assert.equal(barPercent(-5), 0);
    assert.equal(barPercent(61.6), 62);
    assert.equal(barPercent(240), 100);
    assert.equal(barPercent(undefined), 0);
});

test('首次聊天日期按本地月日', () => {
    assert.equal(firstChatDate(at(2026, 8, 2)), '8月2日');
    assert.equal(firstChatDate('x'), '');
});

test('今天达成且本会话没记录过才触发', () => {
    const createdAt = at(2026, 10, 27);
    const now = at(2026, 11, 2);
    assert.equal(pendingMilestone({ createdAt, now, metadata: {} }), 7);
    assert.equal(pendingMilestone({ createdAt, now, metadata: { [MILESTONE_KEY]: [7] } }), 0);
    assert.equal(pendingMilestone({ createdAt, now: at(2026, 11, 3), metadata: {} }), 0);
});

test('插入里程碑系统消息：只在绑定一致时、写入标记并保存，第二次不再插', async () => {
    const saved = [];
    const ctx = {
        chat: [], chatMetadata: { vc_binding: { relationshipId: '11' } },
        addOneMessage: (row) => saved.push(['add', row.mes]),
        saveChat: async () => saved.push(['chat']),
        saveMetadata: async () => saved.push(['meta']),
    };
    const args = { ctx, createdAt: at(2026, 8, 2), relationshipId: '11', now: at(2026, 11, 9) }; // 第 100 天
    assert.equal(await insertMilestone({ ...args, relationshipId: '12' }), 0);
    assert.equal(ctx.chat.length, 0);
    assert.equal(await insertMilestone(args), 100);
    assert.equal(ctx.chat.length, 1);
    const row = ctx.chat[0];
    assert.equal(row.is_system, true);
    assert.equal(row.mes, '我们认识 100 天啦');
    assert.equal(row.extra.vc_kind, 'milestone');
    assert.equal(row.extra.vc_sub, '8月2日 第一次聊天');
    assert.deepEqual(ctx.chatMetadata[MILESTONE_KEY], [100]);
    assert.deepEqual(saved.map((item) => item[0]), ['add', 'chat', 'meta']);
    assert.equal(await insertMilestone(args), 0);
    assert.equal(ctx.chat.length, 1);
});
