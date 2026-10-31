import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkHistory } from '../extension/vc-model-settings/prompt-history.js';

function round(count, nativeStart, context, tools = false) {
    const messages = Array.from({ length: count }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `synthetic-${i}` }));
    if (tools) messages[7].invocations = [{ id: 'synthetic-call' }];
    messages.push({ injected: true, role: 'system', content: 'dynamic' });
    const history = messages.slice(nativeStart).map((_, i) => ({ identifier: `chatHistory-${i+nativeStart+1}`, getTokens: () => 10 }));
    if (tools) {
        history.find((item) => item.identifier === 'chatHistory-8').identifier = 'toolCall-chatHistory-8';
        history.push({ identifier: 'synthetic-call', getTokens: () => 5 });
    }
    const chatCompletion = { tokenBudget: 0, getMessages: () => ({ collection: [{ identifier: 'chatHistory', collection: history }] }), increaseTokenBudgetBy(n) { this.tokenBudget += n; } };
    chunkHistory({ messages, chatCompletion, type: 'normal' }, context);
    return history.map((item) => item.identifier);
}

test('到原生硬上限才整段裁切，此后保留同一历史开头；重载仍沿用边界', () => {
    let context = { chatMetadata: { vc_binding: { mode: 'COMPANION' } } };
    round(6, 0, context);assert.equal(context.chatMetadata.vc_history_window.start, 0);
    round(12, 3, context);assert.equal(context.chatMetadata.vc_history_window.start, 6);
    context = structuredClone(context);
    round(13, 4, context);assert.equal(context.chatMetadata.vc_history_window.start, 6);
    round(15, 6, context);assert.equal(context.chatMetadata.vc_history_window.start, 6);
    const selected = round(16, 7, context);assert.equal(context.chatMetadata.vc_history_window.start, 10);
    assert.ok(selected.includes('chatHistory-17'), 'dynamic injection retained');
    assert.equal(selected.includes('chatHistory-8'), false);
    round(3, 0, context);assert.equal(context.chatMetadata.vc_history_window.start, 0, 'deletion resets an obsolete count');
});

test('工具调用和结果同一回合整体移除，动态提示不受裁切', () => {
    const context = { chatMetadata: { vc_binding: { mode: 'COMPANION' } } };
    const selected = round(16, 7, context, true);
    assert.equal(selected.includes('toolCall-chatHistory-8'), false);
    assert.equal(selected.includes('synthetic-call'), false);
    assert.ok(selected.includes('chatHistory-17'));
});

test('剧情与额外 quiet 调用保留宿主原样', () => {
    const context = { chatMetadata: { vc_binding: { mode: 'STORY' } } };
    assert.equal(round(16, 7, context).length, 10);
    assert.equal(context.chatMetadata.vc_history_window, undefined);
});
