import assert from 'node:assert/strict';
import test from 'node:test';
import {
    ATTACH_PX, LAND_OFFSET, anchorDelta, badgeText, centerTop, landingTop, latestLabel, latestVisible,
    nextFollow, nextRead, scrollDuration, shouldLand, unreadInfo,
} from '../extension/vc-model-settings/chat-scroll.js';

test('跟随 / 脱离：只有用户输入改状态', () => {
    assert.equal(nextFollow('follow', { type: 'user-scroll', up: true, gap: 10 }), 'detached');
    assert.equal(nextFollow('detached', { type: 'user-scroll', up: false, gap: 200 }), 'detached');
    assert.equal(nextFollow('detached', { type: 'user-scroll', up: false, gap: ATTACH_PX }), 'follow');
    assert.equal(nextFollow('detached', { type: 'send' }), 'follow');
    assert.equal(nextFollow('detached', { type: 'grow' }), 'detached');
    assert.equal(nextFollow('follow', { type: 'grow' }), 'follow');
});

test('回到最新：离底 > 300 出现，计数 99+', () => {
    assert.equal(latestVisible(300), false);
    assert.equal(latestVisible(301), true);
    assert.equal(badgeText(0), '');
    assert.equal(badgeText(7), '7');
    assert.equal(badgeText(99), '99');
    assert.equal(badgeText(100), '99+');
    assert.equal(latestLabel(0), '回到最新');
    assert.equal(latestLabel(3), '回到最新，3 条新消息');
});

test('长回复落地：首行停在视口顶部下 24px，短回复不落地', () => {
    assert.equal(landingTop({ chatTop: 100, mesTop: 700, scrollTop: 1000, offset: LAND_OFFSET }), 1576);
    assert.equal(landingTop({ chatTop: 100, mesTop: 110, scrollTop: 0 }), 0);
    assert.equal(shouldLand({ following: true, mesHeight: 900, viewHeight: 600 }), true);
    assert.equal(shouldLand({ following: true, mesHeight: 300, viewHeight: 600 }), false);
    assert.equal(shouldLand({ following: false, mesHeight: 900, viewHeight: 600 }), false);
});

test('跳转：居中并夹在可滚范围，时长 250–600ms 随距离', () => {
    assert.equal(centerTop({ chatTop: 0, mesTop: 1000, mesHeight: 100, viewHeight: 500, scrollTop: 0, max: 5000 }), 800);
    assert.equal(centerTop({ chatTop: 0, mesTop: 10, mesHeight: 100, viewHeight: 500, scrollTop: 0, max: 5000 }), 0);
    assert.equal(centerTop({ chatTop: 0, mesTop: 9000, mesHeight: 100, viewHeight: 500, scrollTop: 0, max: 5000 }), 5000);
    assert.equal(scrollDuration(0), 250);
    assert.equal(scrollDuration(400), 350);
    assert.equal(scrollDuration(99999), 600);
});

test('已读只前进；未读从第一条未读角色消息起算', () => {
    assert.equal(nextRead(null, 5), 5);
    assert.equal(nextRead(5, 3), 5);
    assert.equal(nextRead(5, 8), 8);
    assert.equal(nextRead(5, null), 5);
    const rows = [
        { id: 3, user: false, system: false },
        { id: 4, user: true, system: false },
        { id: 5, user: false, system: true },
        { id: 6, user: false, system: false },
        { id: 7, user: false, system: false },
    ];
    assert.deepEqual(unreadInfo(3, rows), { first: 6, count: 2 });
    assert.deepEqual(unreadInfo(7, rows), { first: null, count: 0 });
    assert.deepEqual(unreadInfo(null, rows), { first: null, count: 0 });
});

test('向上加载历史：锚点位移就是 scrollTop 补偿量', () => {
    assert.equal(anchorDelta(40, 1240), 1200);
    assert.equal(anchorDelta(40, 40), 0);
});
