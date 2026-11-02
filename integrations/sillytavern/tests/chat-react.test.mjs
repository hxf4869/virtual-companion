import assert from 'node:assert/strict';
import test from 'node:test';
import {
    EMOJI, NUDGE_KEY, PAT_WINDOW_MS, addNudge, dropNudge, effectsEnabled, emojiCount, keywordEffect, patNudge,
    injectNudges, mountChatReact, planPat, pushRecent, reactionNudge, readRecent, runPat, searchEmoji, searchStickers, stickerMarkup, takeNudges, toggleReaction, writeRecent,
} from '../extension/vc-model-settings/chat-react.js';
import { installMiniDom } from './mini-dom.mjs';

function memoryStore(seed = {}) {
    const data = new Map(Object.entries(seed));
    return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) };
}

test('桌面表情入口在缩为手机后隐藏，返回桌面恢复且不重复挂载', () => {
    const document = installMiniDom();
    const frames = [], resize = [];
    document.addEventListener = () => {};
    document.defaultView = {
        requestAnimationFrame: callback => { frames.push(callback); },
        addEventListener: (name, callback) => { if (name === 'resize') resize.push(callback); },
    };
    const flush = () => { while (frames.length) frames.shift()(); };
    const form = document.createElement('form'); form.id = 'send_form'; document.body.append(form);
    document.documentElement.dataset.vcLayout = 'desktop';
    mountChatReact({ document, getContext: () => ({ chat: [], chatMetadata: {} }) });
    flush();
    assert.equal(document.querySelector('#vc-emoji-btn').hidden, false);
    document.documentElement.dataset.vcLayout = 'mobile'; resize.forEach(callback => callback()); flush();
    assert.equal(document.querySelector('#vc-emoji-btn').hidden, true);
    document.documentElement.dataset.vcLayout = 'desktop'; resize.forEach(callback => callback()); flush();
    assert.equal(document.querySelector('#vc-emoji-btn').hidden, false);
    assert.equal(document.querySelectorAll('#vc-emoji-btn').length, 1);
});

test('纯 emoji：1–3 个返回个数，夹杂文字、超过 3 个、符号不算', () => {
    assert.equal(emojiCount('😂'), 1);
    assert.equal(emojiCount('😂 🥰'), 2);
    assert.equal(emojiCount('❤️👍🏽🤗'), 3);
    assert.equal(emojiCount('👨‍👩‍👧'), 1);
    assert.equal(emojiCount('🇨🇳'), 1);
    assert.equal(emojiCount('1️⃣'), 1);
    assert.equal(emojiCount('😂😂😂😂'), 0);
    assert.equal(emojiCount('好的😂'), 0);
    assert.equal(emojiCount('😂a'), 0);
    assert.equal(emojiCount('1'), 0);
    assert.equal(emojiCount('©'), 0);
    assert.equal(emojiCount(''), 0);
    assert.equal(emojiCount(null), 0);
});

test('回应：最多 3 个，再点取消，超出挤掉最早的', () => {
    assert.deepEqual(toggleReaction([], '❤️'), ['❤️']);
    assert.deepEqual(toggleReaction(['❤️'], '❤️'), []);
    assert.deepEqual(toggleReaction(['❤️', '👍', '😂'], '😮'), ['👍', '😂', '😮']);
    assert.deepEqual(toggleReaction(undefined, '👍'), ['👍']);
});

test('提示词注入文案：摘要最多 30 字，只注入一次', () => {
    assert.equal(reactionNudge({ user: '小明', text: '今天降温了', emoji: '❤️' }), '（小明对「今天降温了」回应了❤️）');
    const long = reactionNudge({ user: '她', text: '一'.repeat(40), emoji: '👍' });
    assert.ok(long.includes(`「${'一'.repeat(30)}…」`));
    assert.equal(patNudge({ user: '小明', name: '小满' }), '（小明拍了拍小满）');
    const meta = {};
    addNudge(meta, { id: 'react:1', text: 'A' });
    addNudge(meta, { id: 'react:1', text: 'A2' });
    addNudge(meta, { id: 'pat:1', text: 'B' });
    assert.equal(meta[NUDGE_KEY].length, 2);
    dropNudge(meta, 'pat:1');
    assert.equal(takeNudges(meta), 'A2');
    assert.equal(NUDGE_KEY in meta, false);
    assert.equal(takeNudges(meta), '');
    addNudge(meta, { id: 'x', text: 'Y' });
    dropNudge(meta, 'x');
    assert.equal(NUDGE_KEY in meta, false);
});

test('拍一拍：10 秒内只晃不再生成；系统行、待注入、生成各一次', async () => {
    assert.deepEqual(planPat({ now: 1000 }), { generate: true });
    assert.deepEqual(planPat({ now: 1000 + PAT_WINDOW_MS - 1, last: 1000 }), { generate: false });
    assert.deepEqual(planPat({ now: 1000 + PAT_WINDOW_MS, last: 1000 }), { generate: true });
    const calls = [];
    const ctx = {
        chat: [], name1: '小明', name2: '小满', chatMetadata: {},
        addOneMessage: (row) => calls.push(['add', row.mes]),
        saveChat: async () => calls.push(['save']),
        generate: async (type) => { calls.push(['generate', type, takeNudgesPeek(ctx)]); },
    };
    const takeNudgesPeek = (c) => c.chatMetadata[NUDGE_KEY]?.map((i) => i.text).join('');
    const state = {};
    let shakes = 0;
    const first = await runPat({ ctx, now: 5000, state, shake: () => { shakes += 1; } });
    assert.deepEqual(first, { generated: true, posted: true });
    assert.equal(ctx.chat.length, 1);
    assert.equal(ctx.chat[0].is_system, true);
    assert.equal(ctx.chat[0].extra.vc_kind, 'pat');
    assert.equal(ctx.chat[0].mes, '你拍了拍小满');
    assert.deepEqual(calls, [['add', '你拍了拍小满'], ['save'], ['generate', 'normal', '（小明拍了拍小满）']]);
    const second = await runPat({ ctx, now: 8000, state, shake: () => { shakes += 1; } });
    assert.deepEqual(second, { generated: false, posted: false });
    assert.equal(shakes, 2);
    assert.equal(ctx.chat.length, 1);
    const busy = await runPat({ ctx, now: 20000, state, busy: true });
    assert.deepEqual(busy, { generated: false, posted: true });
});

test('回应提示清空后的元数据须保存完成，生成事件才能继续', async () => {
    let acknowledge;
    const saved = new Promise(resolve => { acknowledge = resolve; });
    const prompts = [];
    const ctx = { chatMetadata: {}, setExtensionPrompt: (...args) => prompts.push(args), saveMetadata: () => saved };
    addNudge(ctx.chatMetadata, { id: 'pat:qa', text: '合成拍一拍提示' });
    let continued = false;
    const pending = injectNudges(ctx).then(() => { continued = true; });
    await Promise.resolve();
    assert.equal(continued, false, '未收到保存确认前不能使用旧来源版本继续生成');
    assert.equal(prompts.length, 1);
    assert.equal(prompts[0][1], '合成拍一拍提示');
    assert.equal(NUDGE_KEY in ctx.chatMetadata, false);
    acknowledge(); await pending;
    assert.equal(continued, true);
});

test('关键词特效：命中词与开关', () => {
    assert.equal(keywordEffect('生日快乐呀'), 'confetti');
    assert.equal(keywordEffect('新年快乐'), 'confetti');
    assert.equal(keywordEffect('圣诞快乐'), 'confetti');
    assert.equal(keywordEffect('晚安，好梦'), 'stars');
    assert.equal(keywordEffect('早安'), null);
    assert.equal(effectsEnabled(memoryStore()), true);
    assert.equal(effectsEnabled(memoryStore({ 'vc-keyword-effects': 'off' })), false);
    assert.equal(effectsEnabled(memoryStore({ 'vc-keyword-effects': 'on' })), true);
    assert.equal(effectsEnabled({ getItem() { throw new Error('x'); } }), true);
});

test('最近使用：去重置顶、最多 16 条、存取容错', () => {
    let list = [];
    for (let i = 0; i < 20; i += 1) list = pushRecent(list, { k: 'e', v: String(i) });
    assert.equal(list.length, 16);
    assert.equal(list[0].v, '19');
    list = pushRecent(list, { k: 'e', v: '10' });
    assert.equal(list[0].v, '10');
    assert.equal(list.filter((i) => i.v === '10').length, 1);
    const store = memoryStore();
    writeRecent(list, store);
    assert.deepEqual(readRecent(store), list);
    assert.deepEqual(readRecent(memoryStore({ 'vc-emoji-recent': '{坏的' })), []);
    assert.deepEqual(readRecent({ getItem() { throw new Error('x'); } }), []);
});

test('搜索：表情按名称或符号，贴纸按标签；贴纸发送格式', () => {
    assert.ok(EMOJI.length > 100);
    assert.ok(searchEmoji('哭').some(([e]) => e === '😭'));
    assert.ok(searchEmoji('❤').some(([e]) => e === '❤️'));
    assert.equal(searchEmoji('不存在的词').length, 0);
    assert.equal(searchEmoji('  ').length, EMOJI.length);
    const picks = [{ tag: '开心' }, { tag: '难过' }];
    assert.deepEqual(searchStickers('开', picks), [{ tag: '开心' }]);
    assert.equal(searchStickers('', picks).length, 2);
    assert.equal(stickerMarkup('开心'), '<sticker tag="开心"/>');
});
