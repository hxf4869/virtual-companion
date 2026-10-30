import test from 'node:test';
import assert from 'node:assert/strict';
import {
    FIRST_DELAY_MS,
    LENGTH_TIER_LINES,
    REPLY_STATE_KEY,
    ROUND_CAP_MS,
    TYPING_COPY,
    applyBubbleTransformers,
    armRewrite,
    clearBubbleTransformers,
    createSendBurst,
    guidanceTail,
    noteTurn,
    pickLengthTier,
    placeGuidance,
    planReplyAction,
    postProcess,
    registerBubbleTransformer,
    rewriteHint,
    shouldQueueSend,
    splitReply,
    typingDelay,
} from '../extension/vc-model-settings/reply-pipeline.js';

const steady = () => 0.5;

test('按句末标点与换行分段，短句不拆，最多三段，段尾去掉句号和逗号', () => {
    assert.deepEqual(splitReply(''), []);
    assert.deepEqual(splitReply('在吗'), ['在吗']);
    assert.deepEqual(splitReply('好的，嗯'), ['好的，嗯']);
    assert.deepEqual(splitReply('今天好累。想早点睡。'), ['今天好累', '想早点睡']);
    assert.deepEqual(splitReply('第一句\n第二句还没说完'), ['第一句', '第二句还没说完']);
    assert.deepEqual(splitReply('一。二。三。四。'), ['一', '二', '三四']);
    assert.deepEqual(splitReply('今天好累。<sticker tag="开心"/>'), ['今天好累', '<sticker tag="开心"/>']);
});

test('长句可以在逗号处切开，短于 12 字的片段会并回去', () => {
    const text = '今天把积压的事情都处理完了，晚上只想安静地坐一会儿，不想再开口';
    const parts = splitReply(text);
    assert.ok(parts.length >= 2 && parts.length <= 3);
    assert.equal(parts.some((part) => part.endsWith('，') || part.endsWith('。')), false);
    assert.equal(parts.join(''), text.replace(/[。，]/g, ''));
});

test('气泡变换由注册函数处理，失败的变换不改上一步结果', () => {
    clearBubbleTransformers();
    const off = registerBubbleTransformer((segments) => segments.map((item) => item === '<sticker tag="开心"/>' ? '表情:开心' : item));
    assert.deepEqual(splitReply('在。<sticker tag="开心"/>'), ['在', '表情:开心']);
    off();
    registerBubbleTransformer(() => { throw new Error('坏变换'); });
    assert.deepEqual(applyBubbleTransformers(['在']), ['在']);
    clearBubbleTransformers();
});

test('打字延迟：首段短，后续按字数夹紧并抖动，整轮不超过 8 秒，减少动效时不等', () => {
    assert.equal(typingDelay('在吗', 0), FIRST_DELAY_MS);
    const ten = '一二三四五六七八九十';
    assert.equal(typingDelay(ten, 1, { random: () => 0 }), 1280);
    assert.equal(typingDelay(ten, 1, { random: () => 1 }), 1920);
    assert.equal(typingDelay('', 1, { random: () => 0 }), 640);
    assert.equal(typingDelay('字'.repeat(100), 1, { random: () => 0 }), 3200);
    assert.equal(typingDelay('字'.repeat(100), 1, { random: () => 0, spentMs: 7500 }), 500);
    assert.equal(typingDelay('字'.repeat(100), 1, { random: () => 0, spentMs: ROUND_CAP_MS }), 0);
    assert.equal(typingDelay(ten, 1, { reducedMotion: true }), 0);
    assert.equal(TYPING_COPY, '正在输入');
});

test('后处理剥掉思考块、列表标记和旁白，并保留表情标签', () => {
    const cleaned = postProcess('先想一下</think>\n- 第一件\n好呀（挥手）*笑*<sticker tag="抱抱"/>');
    assert.equal(cleaned.text.includes('先想一下'), false);
    assert.equal(cleaned.text.includes('</think>'), false);
    assert.match(cleaned.text, /^第一件/);
    assert.equal(cleaned.text.includes('挥手'), false);
    assert.equal(cleaned.text.includes('*'), false);
    assert.match(cleaned.text, /<sticker tag="抱抱"\/>/);
});

test('希望对你有帮助是硬违规；引号里的同一句降级，重写只计划一次', () => {
    const hard = postProcess('希望对你有帮助');
    assert.equal(hard.violations.some((item) => item.hard && item.label === '客套收尾'), true);
    const quoted = postProcess('他说「希望对你有帮助」');
    assert.equal(quoted.violations.some((item) => item.hard), false);
    const first = planReplyAction({ text: '希望对你有帮助', rewritten: false });
    assert.equal(first.action, 'rewrite');
    assert.equal(first.hint, rewriteHint(first.processed.violations));
    assert.match(first.hint, /客套收尾/);
    assert.equal(planReplyAction({ text: '希望对你有帮助', rewritten: true }).action, 'keep');
});

test('作为AI、书面套话、格言、过多转折和多个问题会记违规；自称句里的转折和格言降级', () => {
    assert.equal(postProcess('作为AI我不能答应').violations.some((item) => item.hard && item.code === 'as-ai'), true);
    assert.equal(postProcess('总的来说就是这样').violations.some((item) => item.hard && item.code === 'stock'), true);
    assert.equal(postProcess('生活就像一场旅行').violations.some((item) => item.hard && item.code === 'aphorism'), true);
    assert.equal(postProcess('我的生活就像一场旅行').violations.some((item) => item.hard && item.code === 'aphorism'), false);
    assert.equal(postProcess('但是甲。然而乙。不过丙。').violations.some((item) => item.hard && item.code === 'turns'), true);
    assert.equal(postProcess('我很难过，但是还好，然而没事，不过算了').violations.some((item) => item.hard && item.code === 'turns'), false);
    assert.equal(postProcess('你吃饭了吗？睡了吗？').violations.some((item) => item.hard && item.code === 'questions'), true);
    assert.equal(postProcess('他说「你吃饭了吗？睡了吗？」').violations.some((item) => item.hard), false);
});

test('篇幅档按长度、提问和情绪选择，低概率可以极短；语气在篇幅档之前', () => {
    assert.equal(pickLengthTier('在吗', { random: steady }), '简短');
    assert.equal(pickLengthTier('你今天吃饭了吗？', { random: steady }), '正常');
    assert.equal(pickLengthTier('我好难过', { random: steady }), '正常');
    assert.equal(pickLengthTier('我想把今天从早上开会到晚上回家的整段经历按顺序讲给你听，包括中间被人打断的那些细节', { random: steady }), '长');
    assert.equal(pickLengthTier('在吗', { random: () => 0 }), '极短');
    const state = '你今天的状态：开心——今天心情不错，话有点多。让它体现在语气和话量里，不要直接说出来。';
    const tail = guidanceTail({ stateText: state, userText: '在吗', random: steady });
    assert.ok(tail.indexOf(state) < tail.indexOf(LENGTH_TIER_LINES['简短']));
    assert.ok(tail.endsWith(LENGTH_TIER_LINES['简短']));
});

test('陪伴回合把语气和篇幅档放在提示词最后，剧情和安静调用不注入', () => {
    const state = '你今天的状态：开心——今天心情不错，话有点多。让它体现在语气和话量里，不要直接说出来。';
    const context = {
        chatMetadata: { vc_binding: { mode: 'COMPANION' } },
        chat: [{ is_user: true, mes: '在吗' }],
        extensionPrompts: { [REPLY_STATE_KEY]: { value: state } },
    };
    const data = { messages: [{ role: 'system', content: '角色卡' }, { role: 'user', content: '在吗' }] };
    noteTurn('normal');
    assert.equal(placeGuidance(data, context, { random: steady }), true);
    const last = data.messages.at(-1);
    assert.equal(last.role, 'system');
    assert.ok(last.content.indexOf(state) < last.content.indexOf(LENGTH_TIER_LINES['简短']));
    assert.ok(last.content.endsWith(LENGTH_TIER_LINES['简短']) || last.content.trimEnd().endsWith(LENGTH_TIER_LINES['简短']));
    armRewrite(rewriteHint([{ hard: true, label: '客套收尾' }]));
    const again = { messages: [{ role: 'user', content: '在吗' }] };
    placeGuidance(again, context, { random: steady });
    const body = again.messages.at(-1).content;
    assert.ok(body.indexOf(LENGTH_TIER_LINES['简短']) < body.indexOf('上一句没有发出'));
    const story = { messages: [{ role: 'user', content: '在吗' }] };
    noteTurn('normal');
    assert.equal(placeGuidance(story, { chatMetadata: { vc_binding: { mode: 'STORY' } }, chat: [] }, { random: steady }), false);
    assert.equal(story.messages.length, 1);
    const quiet = { messages: [{ role: 'user', content: '在吗' }] };
    noteTurn('quiet');
    assert.equal(placeGuidance(quiet, context, { random: steady }), false);
});

test('连发短消息在 2 到 5 秒内合并，最长等待 8 秒，只刷出一次', () => {
    assert.equal(shouldQueueSend('在吗', 0), true);
    assert.equal(shouldQueueSend('字'.repeat(41), 0), false);
    assert.equal(shouldQueueSend('字'.repeat(41), 1), true);
    assert.equal(shouldQueueSend('  ', 0), false);
    let now = 0;
    const timers = [];
    const sent = [];
    const burst = createSendBurst({
        now: () => now,
        schedule(fn, ms) {
            const timer = { fn, ms, cancelled: false };
            timers.push(timer);
            return timer;
        },
        cancel(timer) { timer.cancelled = true; },
        onFlush(text) { sent.push(text); },
    });
    const first = burst.push('在吗');
    assert.equal(first.waitMs, 5000);
    now = 200;
    burst.push('吃了吗');
    now = 400;
    burst.push('我到了');
    assert.equal(sent.length, 0);
    const active = timers.filter((timer) => !timer.cancelled);
    assert.equal(active.length, 1);
    now += active[0].ms;
    active[0].fn();
    assert.deepEqual(sent, ['在吗\n吃了吗\n我到了']);

    now = 10000;
    const capped = [];
    const capTimers = [];
    const cappedBurst = createSendBurst({
        now: () => now,
        schedule(fn, ms) {
            const timer = { fn, ms, cancelled: false };
            capTimers.push(timer);
            return timer;
        },
        cancel(timer) { timer.cancelled = true; },
        onFlush(text) { capped.push(text); },
    });
    cappedBurst.push('一');
    now = 10000 + 7000;
    cappedBurst.push('二');
    now = 10000 + 8000;
    const third = cappedBurst.push('三');
    assert.equal(third.waitMs, 0);
    assert.deepEqual(capped, ['一\n二\n三']);
});
