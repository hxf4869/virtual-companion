// 聊天纯逻辑：与扩展 chat-compose.js 的引用 / 草稿格式逐项一致；时间胶囊、分组、分段、预览。
import test from 'node:test';
import assert from 'node:assert/strict';
import * as m from '../src/chat/format.mjs';
import * as ext from '../../integrations/sillytavern/extension/vc-model-settings/chat-compose.js';

test('引用与草稿格式与桌面扩展完全一致', () => {
    const samples = ['', '你好', '> 小满：旧的\n新内容', '<b>粗</b> *斜* `码` ~删~', '一'.repeat(40), '  多  空格  \n换行 '];
    for (const t of samples) {
        assert.equal(m.quoteSummary(t), ext.quoteSummary(t), t);
        assert.equal(m.quoteLine('小满', t), ext.quoteLine('小满', t), t);
        assert.equal(m.withQuote({ name: '小满', text: t }, '回复'), ext.withQuote({ name: '小满', text: t }, '回复'), t);
    }
    assert.equal(m.draftKey('abc'), ext.draftKey('abc'));
    const store = new Map();
    const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
    m.writeDraft('c1', '草稿', storage);
    assert.equal(ext.readDraft('c1', storage), '草稿');
    m.writeDraft('c1', '  ', storage);
    assert.equal(store.size, 0);
});

test('引用行拆出', () => {
    assert.deepEqual(m.splitQuote('> 小满：早呀\n\n收到'), { quote: '小满：早呀', body: '收到' });
    assert.deepEqual(m.splitQuote('普通'), { quote: '', body: '普通' });
});

test('时间胶囊与列表时间', () => {
    const now = new Date(2026, 10, 2, 9, 30);
    assert.equal(m.timePill(new Date(2026, 10, 2, 8, 2), now), '今天 08:02');
    assert.equal(m.timePill(new Date(2026, 10, 1, 22, 14), now), '昨天 22:14');
    assert.equal(m.timePill(new Date(2026, 9, 29, 7, 5), now), '周四 07:05');
    assert.equal(m.timePill(new Date(2026, 9, 1, 7, 5), now), '10月1日 07:05');
    assert.equal(m.timePill(new Date(2025, 0, 3, 7, 5), now), '2025年1月3日 07:05');
    assert.equal(m.listTime(new Date(2026, 10, 2, 8, 2), now), '08:02');
    assert.equal(m.listTime(new Date(2026, 10, 1, 8, 2), now), '昨天');
    assert.equal(m.listTime(new Date(2026, 9, 1, 8, 2), now), '10/1');
    assert.equal(m.timePill('坏数据', now), '');
});

test('分组：同一发送者连续成组，间隔超 20 分钟插胶囊并断组，系统消息不显示', () => {
    const t = (min) => new Date(2026, 10, 2, 8, min).toISOString();
    const rows = m.groupMessages([
        { id: 0, user: false, time: t(0), text: 'a' }, { id: 1, user: false, time: t(1), text: 'b' },
        { id: 2, user: true, time: t(2), text: 'c' }, { id: 3, system: true, time: t(3) },
        { id: 4, user: true, time: t(30), text: 'd' },
    ], new Date(2026, 10, 2, 9));
    assert.deepEqual(rows.map((r) => r.type === 'pill' ? `P:${r.text}` : `${r.user ? 'U' : 'C'}${r.messages.map((x) => x.id).join('')}`),
        ['P:今天 08:00', 'C01', 'U2', 'P:今天 08:30', 'U4']);
});

test('分段：陪伴回复用扩展同一规则拆分，表情包段与引用单独处理', () => {
    const s = m.segments({ user: false, text: '早呀～\n\n今天降温了，出门记得带围巾 <sticker tag="开心"/>' });
    assert.equal(s.parts.at(-1).type, 'sticker');
    assert.equal(s.parts.at(-1).tag, '开心');
    assert.ok(s.parts.filter((p) => p.type === 'text').length >= 1);
    const u = m.segments({ user: true, text: '> 小满：早呀\n\n收到！' });
    assert.deepEqual(u, { quote: '小满：早呀', parts: [{ type: 'text', text: '收到！' }] });
    assert.equal(m.segments({ user: false, text: '一整段' }, { companion: false }).parts.length, 1);
});

test('列表预览', () => {
    assert.equal(m.previewText('<sticker tag="开心"/>'), '[表情]');
    assert.equal(m.previewText('好呀<voice/>'), '好呀');
    assert.equal(m.previewText('x', { card: true }), '[互动卡片]');
    assert.equal(m.previewText('> 小满：早\n\n收到'), '收到');
});
