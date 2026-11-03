// 现有受控端点的响应边界；分帧、文本/reasoning/logprobs和工具delta复用锁定ST算法。
import { createEventSourceStream } from './sse.js';
import { createResponseParser } from './response-core.js';
import { ToolManager } from './tools.js';

export class GenerationError extends Error {
    constructor(code = 'VC_GENERATION_FAILED') {
        super('没有发送成功'); this.name = 'GenerationError'; this.code = code;
    }
}

export async function readGenerationResponse(response, { settings, powerSettings, signal, stream, onUpdate = () => {} } = {}) {
    const snapshot = structuredClone(settings);
    const parser = createResponseParser(snapshot);
    const state = { reasoning: '', images: [], signature: null, toolSignatures: {} };
    const result = { text: '', swipes: [], toolCalls: [], logprobs: null, state, finishReason: null, complete: false };
    const fail = data => { if (data?.error) throw new GenerationError(data.error.code || 'VC_UPSTREAM_ERROR'); };
    // 陪伴工具循环把Claude也包装成choices；普通Claude流仍是Anthropic events。
    const sourceFor = data => Array.isArray(data?.content) && snapshot.chat_completion_source === 'claude'
        ? 'claude' : Array.isArray(data?.choices) ? 'custom' : snapshot.chat_completion_source;
    if (!(stream ?? response.headers.get('content-type')?.includes('text/event-stream'))) {
        const data = await response.json(); signal?.throwIfAborted(); fail(data);
        result.text = parser.extractMessageFromData(data, 'openai');
        state.reasoning = parser.extractReasoningFromData(data, { chatCompletionSource: sourceFor(data) });
        result.toolCalls = ToolManager.toolCallsFrom(data);
        result.logprobs = parser.parseChatCompletionLogprobs(data);
        result.finishReason = data?.choices?.[0]?.finish_reason ?? data?.stop_reason ?? null;
        result.complete = true;
        result.swipes = data?.choices?.filter(choice => choice.index > 0).map(choice => choice.message?.content ?? choice.text ?? '') || [];
        await onUpdate(result); return result;
    }
    if (!response.body) throw new GenerationError('VC_EMPTY_STREAM');
    const reader = response.body.pipeThrough(createEventSourceStream(powerSettings)).getReader();
    let terminal = false;
    try {
        while (true) {
            signal?.throwIfAborted();
            const { done, value } = await reader.read();
            if (done) break;
            if (value.data === '[DONE]') { terminal = true; break; }
            let data;
            try { data = JSON.parse(value.data); } catch { throw new GenerationError('VC_INVALID_STREAM'); }
            fail(data);
            if (data.type === 'message_stop') { terminal = true; break; }
            result.finishReason = data?.choices?.[0]?.finish_reason ?? data?.delta?.stop_reason ?? result.finishReason;
            if (data?.choices?.[0]?.index > 0) {
                const index = data.choices[0].index - 1;
                result.swipes[index] = (result.swipes[index] || '') + parser.getStreamingReply(data, state, { chatCompletionSource: sourceFor(data) });
            } else {
                result.text += parser.getStreamingReply(data, state, { chatCompletionSource: sourceFor(data) });
            }
            ToolManager.parseToolCalls(result.toolCalls, data, state.toolSignatures, snapshot);
            result.logprobs = parser.parseChatCompletionLogprobs(data) || result.logprobs;
            await onUpdate(result);
        }
        signal?.throwIfAborted();
        if (!terminal && !result.finishReason) throw new GenerationError('VC_UPSTREAM_STREAM_ERROR');
        result.toolCalls = ToolManager.toolCallsFrom(result.toolCalls);
        result.complete = true;
        return result;
    } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
    }
}
