import { renderConversationRow } from './conversations-dom.mjs';
import { bootstrapDocument } from './react-dom-bootstrap.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { mountChatSearch, spanOf, textMatches } from '../extension/vc-model-settings/chat-search.js';
import { conversationRows, desktopConversationTime, instanceTail } from '../extension/vc-model-settings/conversations.js';

const ext = (file) => fs.readFileSync(new URL(`../extension/vc-model-settings/${file}`, import.meta.url), 'utf8');

test('搜索销毁释放视图与宿主监听，旧公开入口不再改变外壳状态', () => {
    const doc = bootstrapDocument, pane = doc.createElement('section');
    pane.innerHTML = '<header class="vc-navbar"><span class="vc-capsule-tools"></span><span class="vc-chat-search-tools"></span><div class="vc-chat-toolbar-views"></div></header>';
    doc.body.append(pane);
    const listeners = new Set(), changes = [];
    const api = mountChatSearch({ pane, doc, onOpenChange: value => changes.push(value), getContext: () => ({
        eventTypes: { CHAT_CHANGED: 'change' }, eventSource: { on(_type, fn) { listeners.add(fn); }, removeListener(_type, fn) { listeners.delete(fn); } },
    }) });
    try {
        api.open(); assert.equal(api.bar.hidden, false); assert.equal(listeners.size, 1);
        const field = api.bar.querySelector('input');
        api.open(); assert.equal(api.bar.querySelector('input'), field);
        api.destroy(); const before = [...changes];
        api.open(); api.close(); api.destroy();
        assert.deepEqual(changes, before, '已销毁的入口不得再次打开或改变外壳搜索状态');
        assert.equal(listeners.size, 0);
        assert.equal(pane.querySelector('.vc-chat-search,.vc-desk-search-toggle'), null);
    } finally { api.destroy(); pane.remove(); }
});

test('UX-23 搜索：大小写不敏感、不重叠、空查询无匹配', () => {
    assert.deepEqual(textMatches('晚霞真美，晚霞', '晚霞'), [[0, 2], [5, 7]]);
    assert.deepEqual(textMatches('Hello hello', ' HELLO '), [[0, 5], [6, 11]]);
    assert.deepEqual(textMatches('aaaa', 'aa'), [[0, 2], [2, 4]]);
    assert.deepEqual(textMatches('晚霞', '   '), []);
    assert.deepEqual(textMatches('晚霞', '月亮'), []);
});

test('UX-23 搜索：跨文本节点的匹配还原为节点与偏移', () => {
    const parts = ['我看到了晚', '霞', '，真美'];
    assert.deepEqual(spanOf(parts, 4, 6), { from: { part: 0, offset: 4 }, to: { part: 1, offset: 1 } });
    assert.deepEqual(spanOf(parts, 0, 2), { from: { part: 0, offset: 0 }, to: { part: 0, offset: 2 } });
    assert.deepEqual(spanOf(parts, 5, 6), { from: { part: 1, offset: 0 }, to: { part: 1, offset: 1 } });
    assert.equal(spanOf(parts, 4, 99), null);
});

test('UX-23 搜索：高亮只走 Custom Highlight API，不写入消息文字子树', () => {
    const js = ext('chat-search.js');
    assert.match(js, /CSS\.highlights\.set\('vc-search'/);
    assert.doesNotMatch(js, /surroundContents|innerHTML\s*=\s*[^;]*mes|<mark/);
    const css = ext('desktop/chat-search.css');
    assert.match(css, /::highlight\(vc-search\)/);
    for (const line of css.split('\n')) if (/^\S.*\{/.test(line) && !line.startsWith('/*')) assert.match(line, /^html\[data-vc-layout="desktop"\]/, line.slice(0, 80));
});

test('UX-23 会话行：桌面时间 今天 HH:mm / 昨天 / 周X / M/D', () => {
    const now = new Date(2026, 10, 2, 15, 0); // 2026-11-02 周一
    const at = (d, h, m) => new Date(2026, 10, d, h, m).toISOString();
    assert.equal(desktopConversationTime(at(2, 8, 2), now), '08:02');
    assert.equal(desktopConversationTime(at(1, 23, 59), now), '昨天');
    assert.equal(desktopConversationTime(at(30, 9, 0).replace(/^2026-11/, '2026-10'), now), '周五');
    assert.equal(desktopConversationTime(new Date(2026, 9, 20, 9, 0).toISOString(), now), '10/20');
    assert.equal(desktopConversationTime(String(new Date(2026, 10, 2, 7, 5).getTime()), now), '07:05');
    assert.equal(desktopConversationTime('', now), '');
    assert.equal(desktopConversationTime('不是时间', now), '');
});

test('UX-23 会话行：名字与实例名相同时打标，时间带可解析的毫秒值而不暴露日期字符串', () => {
    const same = renderConversationRow({ relationshipId: '1', name: '小满', instanceName: '小满', time: '08:02', timeMs: 1790000000000 });
    const parsed = bootstrapDocument.createElement('div'); parsed.innerHTML = same;
    const sameRow = parsed.querySelector('.vc-convo[data-relationship-id="1"]');
    assert.equal(sameRow?.hasAttribute('data-same-name'), true);
    assert.match(same, /vc-convo-time vc-num" data-time="1790000000000">08:02/);
    const differ = renderConversationRow({ relationshipId: '1', name: '小满', instanceName: '日常' });
    assert.equal(differ.includes('data-same-name'), false);
    assert.equal(differ.includes('data-time'), false);
    const [row] = conversationRows([{ relationshipId: '7', personaRef: 'st-character', companionName: '小满' }], {
        chats: [{ relationshipId: '7', characterName: '小满', preview: '你好', time: '2026-11-02T00:02:00.000Z' }],
    });
    assert.equal(row.timeMs, Date.parse('2026-11-02T00:02:00.000Z'));
});

test('UX-23 会话行：实例名以「角色名 · 」开头时只留后半', () => {
    assert.equal(instanceTail('小满', '小满 · 日常'), '日常');
    assert.equal(instanceTail('小满', '日常'), '日常');
    assert.equal(instanceTail('小满', '小满 · '), '小满 · ');
    assert.equal(instanceTail('', '小满 · 日常'), '小满 · 日常');
    assert.equal(instanceTail('小满', '小满 · 2'), '2');
});
