import assert from 'node:assert/strict';
import test from 'node:test';
import { newArrivals, previewOf, titleWithCount } from '../extension/vc-model-settings/desktop/notify.js';

const row = (id, extra = {}) => ({ eventId: id, relationshipId: '11', conversationId: '21', intent: 'BODY', stDelivered: false, linkStatus: 'present', body: '到家了吗', ...extra });

test('预览：语音为 [语音] 秒数″，文字去标记取一行', () => {
    assert.equal(previewOf(row('a', { voice: { clipId: '1', status: 'ready', durationMs: 5600 } })), '[语音] 6″');
    assert.equal(previewOf(row('a', { voice: { clipId: '1', status: 'ready', durationMs: 200 } })), '[语音] 1″');
    assert.equal(previewOf(row('a', { body: '到家了吗？\n今天风好大<sticker tag="x"/>' })), '到家了吗？ 今天风好大');
    assert.equal([...previewOf(row('a', { body: '长'.repeat(100) }))].length, 60);
    assert.equal(previewOf(null), '');
});

test('新到达：只认待写入的主动消息，每个 eventId 只报一次', () => {
    const seen = new Set();
    const rows = [row('a'), row('b', { stDelivered: true }), row('c', { linkStatus: 'removed' }), row('d', { intent: 'WAITING_HOST' })];
    assert.deepEqual(newArrivals(rows, seen).map((item) => item.eventId), ['a']);
    assert.deepEqual(newArrivals(rows, seen), []);
    assert.deepEqual(newArrivals([...rows, row('e')], seen).map((item) => item.eventId), ['e']);
});

test('标题前缀：(N) 原标题，0 时去掉，不叠加，超过 99 写 99+', () => {
    assert.equal(titleWithCount('Virtual Companion', 3), '(3) Virtual Companion');
    assert.equal(titleWithCount('(3) Virtual Companion', 5), '(5) Virtual Companion');
    assert.equal(titleWithCount('(5) Virtual Companion', 0), 'Virtual Companion');
    assert.equal(titleWithCount('x', 120), '(99+) x');
});

test('桌面通知开关：默认开，off/0/false 关闭，读存储异常时按开', async () => {
    const { systemNotifyEnabled, NOTIFY_KEY } = await import('../extension/vc-model-settings/desktop/notify.js');
    const store = (value) => ({ getItem: (key) => (key === NOTIFY_KEY ? value : null) });
    assert.equal(systemNotifyEnabled(store(null)), true);
    assert.equal(systemNotifyEnabled(store('on')), true);
    for (const value of ['off', '0', 'false', 'OFF']) assert.equal(systemNotifyEnabled(store(value)), false);
    assert.equal(systemNotifyEnabled({ getItem() { throw new Error('blocked'); } }), true);
});
