// Chat Completions 的已知上游差异；前台原生链与工具循环共用。
// 许可：AGPL-3.0-only（见目录 README；ADR-0009 §3）。
import { BridgeError } from './errors.js';

/** 只拆一层明确成功的转发信封；失败响应不能采用其内部工具或用量。 */
export function unwrapChatCompletion(json) {
    if (!json || typeof json !== 'object' || Array.isArray(json)) return json;
    if (!('success' in json) && !('data' in json)) return json;
    if (json.success !== true || !json.data || typeof json.data !== 'object' || Array.isArray(json.data)
        || !Array.isArray(json.data.choices) || json.choices) {
        throw new BridgeError(502, 'VC_UPSTREAM_ERROR', '上游模型返回了无效的生成响应');
    }
    return json.data;
}

/** DeepSeek 的关闭思考使用 thinking，而非 reasoning_effort=none。 */
export function applyChatReasoning(body, model) {
    const id = String(model?.modelId || '').split('/').at(-1).toLowerCase();
    if (!['deepseek-v4-pro', 'deepseek-flash', 'deepseek-v4.1-flash-1017'].includes(id)) return;
    const effort = body.reasoning_effort;
    if (!effort || effort === 'auto') return;
    body.thinking = { type: effort === 'none' ? 'disabled' : 'enabled' };
    if (effort === 'none') delete body.reasoning_effort;
}
