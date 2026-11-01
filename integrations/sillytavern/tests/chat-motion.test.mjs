import assert from 'node:assert/strict';
import test from 'node:test';
import { actionLine, heightMotion, keyAction, pagerPlan, shouldArrive, typingVisible } from '../extension/vc-model-settings/chat-motion.js';
import { filterRows } from '../extension/vc-model-settings/desktop/quick-switch.js';

test('入场：只有稳定后末尾新到、非流式的消息', () => {
    const base = { primed: true, sinceChatMs: 2000, streaming: false, system: false, isLast: true };
    assert.equal(shouldArrive(base), true);
    assert.equal(shouldArrive({ ...base, primed: false }), false);
    assert.equal(shouldArrive({ ...base, sinceChatMs: 100 }), false);
    assert.equal(shouldArrive({ ...base, streaming: true }), false);
    assert.equal(shouldArrive({ ...base, system: true }), false);
    assert.equal(shouldArrive({ ...base, isLast: false }), false);
});

test('正在输入 450ms 防闪', () => {
    assert.equal(typingVisible(449), false);
    assert.equal(typingVisible(450), true);
});

test('候选切换：只在最后一条，末位 › 是重新生成', () => {
    assert.equal(pagerPlan({ last: false, at: 1, n: 3 }), null);
    assert.equal(pagerPlan({ last: true, at: 1, n: 1 }), null);
    assert.deepEqual(pagerPlan({ last: true, at: 2, n: 3 }), { prev: '上一个回复', next: '下一个回复', atEnd: false });
    assert.equal(pagerPlan({ last: true, at: 3, n: 3 }).next, '重新生成');
});

test('气泡高度过渡：减少动效只淡入淡出', () => {
    assert.deepEqual(heightMotion(40, 120, false), { height: true });
    assert.deepEqual(heightMotion(40, 41, false), { height: false });
    assert.deepEqual(heightMotion(40, 120, true), { height: false });
});

test('快捷键意图', () => {
    assert.equal(keyAction({ key: 'k', metaKey: true }), 'quick-switch');
    assert.equal(keyAction({ key: 'K', ctrlKey: true }), 'quick-switch');
    assert.equal(keyAction({ key: 'k' }), null);
    assert.equal(keyAction({ key: 'ArrowUp' }, { inputEmpty: true }), 'edit-last');
    assert.equal(keyAction({ key: 'ArrowUp' }, { inputEmpty: false }), null);
    assert.equal(keyAction({ key: 'ArrowUp', isComposing: true }, { inputEmpty: true }), null);
    assert.equal(keyAction({ key: 'ArrowUp' }, { inputEmpty: true, overlayOpen: true }), null);
});

test('动作描写：整段（…）或 *…*', () => {
    assert.deepEqual(actionLine('（轻轻笑了笑）'), { action: true, text: '（轻轻笑了笑）' });
    assert.deepEqual(actionLine('(looks away)'), { action: true, text: '(looks away)' });
    assert.deepEqual(actionLine('*低头*'), { action: true, text: '低头' });
    assert.equal(actionLine('（笑）然后说话').action, false);
    assert.equal(actionLine('（a）b（c）').action, false);
    assert.equal(actionLine('你好').action, false);
});

test('会话快速切换筛选', () => {
    const rows = [{ name: 'Alice', preview: '早安' }, { name: '小林', preview: 'hello' }];
    assert.equal(filterRows(rows, '').length, 2);
    assert.deepEqual(filterRows(rows, 'ALI').map((r) => r.name), ['Alice']);
    assert.deepEqual(filterRows(rows, '早').map((r) => r.name), ['Alice']);
    assert.equal(filterRows(rows, 'zzz').length, 0);
});
