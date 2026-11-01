import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
    COPY,
    QUOTE_MAX,
    composerHeight,
    draftKey,
    isCopiedToast,
    messageMenuPlan,
    quoteLine,
    quoteSummary,
    readDraft,
    sendsOnEnter,
    takesError,
    withQuote,
    writeDraft,
} from '../extension/vc-model-settings/chat-compose.js';

function memoryStore() {
    const data = new Map();
    return {
        getItem: (key) => (data.has(key) ? data.get(key) : null),
        setItem: (key, value) => data.set(key, String(value)),
        removeItem: (key) => data.delete(key),
        keys: () => [...data.keys()],
    };
}

test('引用摘要最多 30 字，去掉标记、换行和被引用消息自带的引用行', () => {
    assert.equal(quoteSummary('有一张晚霞超好看，等下发你'), '有一张晚霞超好看，等下发你');
    const long = '一二三四五六七八九十'.repeat(4);
    assert.equal([...quoteSummary(long)].length, QUOTE_MAX + 1);
    assert.ok(quoteSummary(long).endsWith('…'));
    assert.equal(quoteSummary('**加粗** 与\n第二行 <voice/>'), '加粗 与 第二行');
    assert.equal(quoteSummary('> 小满：旧引用\n\n新的正文'), '新的正文');
    assert.equal(quoteSummary('😀'.repeat(31)), `${'😀'.repeat(30)}…`);
});

test('发送时在正文前拼「> 名字：摘要」，空正文不拼', () => {
    const quote = { name: '小满', text: '有一张晚霞超好看，等下发你' };
    assert.equal(quoteLine('小满', quote.text), '> 小满：有一张晚霞超好看，等下发你');
    assert.equal(withQuote(quote, '好呀'), '> 小满：有一张晚霞超好看，等下发你\n\n好呀');
    assert.equal(withQuote(quote, '   '), '   ');
    assert.equal(withQuote(null, '好呀'), '好呀');
    assert.equal(quoteLine('', '只有摘要'), '> 只有摘要');
});

test('草稿按聊天 id 存取，空内容删除，没有 id 不写', () => {
    const store = memoryStore();
    writeDraft('chat-a', '写到一半', store);
    writeDraft('chat-b', '另一个', store);
    assert.equal(readDraft('chat-a', store), '写到一半');
    assert.equal(readDraft('chat-b', store), '另一个');
    assert.equal(readDraft('chat-c', store), '');
    assert.deepEqual(store.keys().sort(), [draftKey('chat-a'), draftKey('chat-b')]);
    writeDraft('chat-a', '  ', store);
    assert.equal(readDraft('chat-a', store), '');
    writeDraft('', '没有会话', store);
    assert.equal(store.keys().length, 1);
    assert.equal(draftKey(' '), '');
    const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
    assert.equal(readDraft('chat-a', broken), '');
    assert.doesNotThrow(() => writeDraft('chat-a', 'x', broken));
});

test('回车发送沿用宿主的 send_on_enter：只有 DISABLED 不发送', () => {
    assert.equal(sendsOnEnter({ send_on_enter: -1 }), false);
    assert.equal(sendsOnEnter({ send_on_enter: 0 }), true);
    assert.equal(sendsOnEnter({ send_on_enter: 1 }), true);
    assert.equal(sendsOnEnter(undefined), true);
});

test('只接管生成中的宿主错误；保存失败与非生成期错误交还宿主', () => {
    assert.equal(takesError({ generating: true, title: 'Chat Completion API', message: 'synthetic upstream failure' }), true);
    assert.equal(takesError({ generating: true, title: 'Chat could not be saved', message: 'Check the server connection' }), false);
    assert.equal(takesError({ generating: false, title: 'Chat Completion API', message: 'x' }), false);
    assert.equal(isCopiedToast('Copied!'), true);
    assert.equal(isCopiedToast('已复制'), true);
    assert.equal(isCopiedToast('Copied to clipboard failed'), false);
});

test('右键菜单项：引用、复制、朗读、编辑、重新生成、删除，按消息类型取舍', () => {
    assert.deepEqual(messageMenuPlan({ character: true, last: true, voice: true }),
        ['quote', 'copy', 'read', '-', 'edit', 'regenerate', '-', 'remove']);
    assert.deepEqual(messageMenuPlan({ character: true, last: false }), ['quote', 'copy', '-', 'edit', '-', 'remove']);
    assert.deepEqual(messageMenuPlan({}), ['quote', 'copy', '-', 'edit', '-', 'remove']);
    assert.deepEqual(messageMenuPlan({ character: true, last: true, busy: true }), ['quote', 'copy', '-', 'edit', '-', 'remove']);
    assert.deepEqual(messageMenuPlan({ system: true }), ['copy', '-', 'edit', '-', 'remove']);
});

test('输入框高度在 1 到 6 行之间，清空后回到最小高度', () => {
    const base = { lineHeight: 25, padding: 20, min: 44 };
    assert.equal(composerHeight({ ...base, contentHeight: 45 }), 45);
    assert.equal(composerHeight({ ...base, contentHeight: 0 }), 44);
    assert.equal(composerHeight({ ...base, contentHeight: 120 }), 120);
    assert.equal(composerHeight({ ...base, contentHeight: 900 }), 170);
});

test('预定文案不漂移', () => {
    for (const text of ['引用', '复制', '朗读', '编辑', '重新生成', '删除', '已复制', '没有发送成功', '重试', '回复较慢，可以继续等或停止']) {
        assert.ok(Object.values(COPY).includes(text), text);
    }
});

test('桌面样式只挂在桌面布局下，不写字面颜色', () => {
    const css = fs.readFileSync(new URL('../extension/vc-model-settings/desktop/chat-compose.css', import.meta.url), 'utf8');
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map((rule) => rule.split('{')[0].trim()).filter(Boolean);
    for (const selector of rules) {
        for (const part of selector.split(/,(?![^(]*\))/).map((item) => item.trim())) {
            assert.ok(part.startsWith('html[data-vc-layout="desktop"]') || part === '#vc-ctx-anchor', part);
        }
    }
    assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgba?\(/i);
});
