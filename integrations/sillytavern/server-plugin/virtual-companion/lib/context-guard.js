// Virtual Companion ST 桥接插件 — 上下文窗口与输出上限预算。
// 许可：AGPL-3.0-only（见目录 README；ADR-0009 §3）。
// 语义（MODEL08 / 执行计划 W03 边界 / 外层核查第 3 条）：
//  - token 计数优先复用 ST 服务端已有入口 src/endpoints/tokenizers.js
//    （getTokenizerModel → getTiktokenTokenizer 的 tiktoken 编码）；不可用时退回
//    ST 自带的 guesstimate（UTF-8 字节数 / 3.35），并在结果中标注 estimator 来源，
//    不把启发式计数说成精确值；
//  - 预算对象是「实际转换后的最终出站 body」（messages/input/system/tools/schema），
//    加固定协议开销 PROTOCOL_OVERHEAD_TOKENS，再加输出预留；
//  - 窗口未知禁用受控生成；请求输出超登记上限显式拒绝，不静默夹紧放行。

import { BridgeError } from './errors.js';

/** 覆盖角色/模板字段名、分片结构、chat 模板与计数误差的固定开销（token）。 */
export const PROTOCOL_OVERHEAD_TOKENS = 96;

function heuristicTokenCount(text) {
    // 与 ST tokenizers.js 的 guesstimate 同式：UTF-8 字节 / 3.35。
    return Math.ceil(Buffer.byteLength(text, 'utf8') / 3.35);
}

/**
 * @param {{getTokenizerModel?: Function, getTiktokenTokenizer?: Function}|null} tokenizer 入口（来自 ST src/endpoints/tokenizers.js）
 */
export function createTokenCounter(tokenizer) {
    if (tokenizer && typeof tokenizer.getTokenizerModel === 'function' && typeof tokenizer.getTiktokenTokenizer === 'function') {
        return {
            estimator: 'st-tiktoken',
            count(text, modelId) {
                try {
                    const enc = tokenizer.getTiktokenTokenizer(tokenizer.getTokenizerModel(String(modelId || '')));
                    return enc.encode(text).length;
                } catch {
                    return heuristicTokenCount(text);
                }
            },
        };
    }
    return {
        estimator: 'st-guesstimate',
        count: heuristicTokenCount,
    };
}

/** 序列化最终出站 body 中实际计入上下文的部分（含转换后的 system / tools / schema）。 */
export function serializeContextPayload(finalBody) {
    const parts = {
        messages: finalBody?.messages ?? finalBody?.input ?? finalBody?.prompt,
        system: finalBody?.system ?? finalBody?.instructions,
        tools: finalBody?.tools,
        schema: finalBody?.text?.format?.schema ?? finalBody?.response_format ?? finalBody?.json_schema,
    };
    return JSON.stringify(parts);
}

/**
 * 输出上限：请求值不得超出 Go 目录登记的 maxOutputTokens；两者都缺省则显式拒绝。
 * 返回应写回最终请求的输出 token 值。
 */
export function resolveOutputTokens(requested, modelMaxOutputTokens) {
    if (modelMaxOutputTokens != null && requested != null && Number(requested) > Number(modelMaxOutputTokens)) {
        throw new BridgeError(
            400,
            'VC_OUTPUT_LIMIT_EXCEEDED',
            `请求的最大输出 ${requested} 超过模型登记上限 ${modelMaxOutputTokens}；请在模型设置页重新加载配置`,
        );
    }
    if (requested != null) return Number(requested);
    if (modelMaxOutputTokens != null) return Number(modelMaxOutputTokens);
    throw new BridgeError(400, 'VC_OUTPUT_LIMIT_UNSET', '请求未携带输出上限且模型目录未登记 maxOutputTokens，拒绝无界生成');
}

/** 把已解析的输出值写回 ST 原生请求字段，保证最终 body 满足登记值（Claude 的 thinking 追加由最终出站防线拦截）。 */
export function writeBackOutputTokens(body, outputTokens) {
    if (body.max_tokens !== undefined && body.max_tokens !== null) body.max_tokens = outputTokens;
    if (body.max_completion_tokens !== undefined && body.max_completion_tokens !== null) body.max_completion_tokens = outputTokens;
}

/**
 * 窗口未知 → 拒绝；对「最终出站 body」计数 + 开销 + 输出预留 → 超窗口拒绝。
 * @param {object} args
 * @param {object} args.model Go resolve 的 model
 * @param {object} args.finalBody 实际转换后的最终请求体（Responses 或原生链 pre-fetch body）
 * @param {number} args.outputTokens 输出预留（已含推理 token 的语义由协议承担）
 * @param {{estimator: string, count: (text: string, modelId: string) => number}} args.counter
 */
export function checkContextBudget({ model, finalBody, outputTokens, counter }) {
    const window = model?.contextWindowTokens;
    if (window == null || !Number.isFinite(Number(window)) || Number(window) <= 0) {
        throw new BridgeError(
            400,
            'VC_CONTEXT_WINDOW_UNKNOWN',
            '模型目录未登记有效 contextWindowTokens；窗口未知时受控生成禁用，请先在模型设置页补全',
        );
    }
    const estimatedInput = counter.count(serializeContextPayload(finalBody), model?.modelId);
    const total = estimatedInput + PROTOCOL_OVERHEAD_TOKENS + Number(outputTokens);
    if (total > Number(window)) {
        throw new BridgeError(
            400,
            'VC_CONTEXT_OVERFLOW',
            `上下文预算超限：按 ${counter.estimator} 估算输入 ${estimatedInput} + 协议开销 ${PROTOCOL_OVERHEAD_TOKENS} + 输出预留 ${outputTokens} > 登记窗口 ${window}；请缩减上下文或输出预留`,
            { estimator: counter.estimator, estimatedInputTokens: estimatedInput, outputTokens: Number(outputTokens), contextWindowTokens: Number(window) },
        );
    }
    return { estimator: counter.estimator, estimatedInputTokens: estimatedInput, contextWindowTokens: Number(window) };
}
