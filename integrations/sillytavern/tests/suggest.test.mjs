import assert from 'node:assert/strict';
import test from 'node:test';
import {
    META_KEY, buildMessages, cleanText, lastCharacterIndex, normalizeItems, storedFor, suggestEnabled,
} from '../extension/vc-model-settings/desktop/suggest.js';

const store = (value) => ({ getItem: () => value });

test('建议回复默认开，只有 off / 0 / false 关闭', () => {
    assert.equal(suggestEnabled(store(null)), true);
    assert.equal(suggestEnabled(store('on')), true);
    for (const off of ['off', '0', 'false', 'OFF']) assert.equal(suggestEnabled(store(off)), false);
    assert.equal(suggestEnabled({ getItem() { throw new Error('blocked'); } }), true);
});

test('请求正文去掉标记并截到 500 字', () => {
    assert.equal(cleanText('好呀<sticker tag="开心"/>  晚安 <voice/>'), '好呀 晚安');
    assert.equal(cleanText('一'.repeat(600)).length, 500);
    assert.equal(cleanText(null), '');
});

test('最近 ≤ 8 条非系统消息，旧到新，空正文跳过', () => {
    const chat = [];
    for (let i = 0; i < 12; i += 1) chat.push({ is_user: i % 2 === 0, mes: `第${i}条` });
    chat.splice(3, 0, { is_system: true, mes: '你拍了拍她' }, { is_user: false, mes: '<voice/>' });
    const out = buildMessages(chat);
    assert.equal(out.length, 8);
    assert.deepEqual(out.at(-1), { role: 'character', text: '第11条' });
    assert.deepEqual(out[0], { role: 'user', text: '第4条' });
    assert.ok(out.every((item) => item.text && !item.text.includes('拍了拍')));
});

test('结果只接受字符串，最多 3 条，兼容数组与 {suggestions}', () => {
    assert.deepEqual(normalizeItems({ suggestions: [' 好呀 ', '', 3, '行', '可以', '再来一条'] }), ['好呀', '行', '可以']);
    assert.deepEqual(normalizeItems(['a']), ['a']);
    assert.deepEqual(normalizeItems(null), []);
    assert.deepEqual(normalizeItems({ suggestions: 'x' }), []);
});

test('末条必须是角色的非系统消息，保存的建议随 mesid 对上才可显示', () => {
    const chat = [{ is_user: true, mes: '在吗' }, { is_user: false, mes: '在呀' }];
    assert.equal(lastCharacterIndex(chat), 1);
    assert.equal(lastCharacterIndex([...chat, { is_user: true, mes: '嗯' }]), -1);
    assert.equal(lastCharacterIndex([...chat, { is_system: true, mes: '你拍了拍她' }]), -1);
    assert.equal(lastCharacterIndex([]), -1);
    assert.deepEqual(storedFor(chat, { [META_KEY]: { mesid: 1, items: ['好'] } }), ['好']);
    assert.deepEqual(storedFor(chat, { [META_KEY]: { mesid: 0, items: ['好'] } }), []);
    assert.deepEqual(storedFor([...chat, { is_user: true, mes: '嗯' }], { [META_KEY]: { mesid: 1, items: ['好'] } }), []);
    assert.deepEqual(storedFor(chat, {}), []);
});
