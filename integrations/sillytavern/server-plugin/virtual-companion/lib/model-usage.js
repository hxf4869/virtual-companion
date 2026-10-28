// 前台用量预留。404（单测里的旧 Go 桩）放行；已登记的 409/429 拒绝则不发送。
// 许可：AGPL-3.0-only（见目录 README；ADR-0009 §3）。

import { BridgeError } from './errors.js';
import { reserveModelUsage, settleModelUsage, cancelModelUsage } from './go-client.js';

const REFUSAL = {
    NO_PRICE: '当前模型没有单价，本次生成未发送',
    NO_BUDGET: '未配置预算，本次生成未发送',
    OVER_LIMIT: '本月额度已用完，本次生成未发送',
    ATTEMPT_REUSED: '本次调用标识已使用，已拒绝发送',
};

let installed = false;
let originalFetch = null;
let hold = null;

/** 没有 usage 对象时返回 undefined。显式 0 仍是用量。 */
export function readUsageTokens(usage) {
    if (!usage || typeof usage !== 'object') return undefined;
    if ('prompt_tokens' in usage || 'completion_tokens' in usage) {
        return {
            inputTokens: Number(usage.prompt_tokens ?? 0),
            outputTokens: Number(usage.completion_tokens ?? 0),
        };
    }
    if ('input_tokens' in usage || 'output_tokens' in usage) {
        return {
            inputTokens: Number(usage.input_tokens ?? 0),
            outputTokens: Number(usage.output_tokens ?? 0),
        };
    }
    return undefined;
}

/**
 * @returns {Promise<object|null>} 200 的预留 JSON；404 返回 null（不阻断）。
 */
export async function reserveSend(config, payload) {
    const parsed = await reserveModelUsage(config, payload);
    if (parsed.status === 404) return null;
    if (parsed.status === 409 || parsed.status === 429) {
        const reason = parsed.json?.details?.reason;
        throw new BridgeError(parsed.status, 'VC_USAGE_REFUSED', REFUSAL[reason] || '用量预留被拒绝，本次生成未发送');
    }
    if (!parsed.ok || !parsed.json?.reservationId) {
        throw new BridgeError(502, 'VC_USAGE_UNAVAILABLE', '用量预留失败，本次生成未发送');
    }
    return parsed.json;
}

export function usageFetchInstalled() {
    return installed;
}

export function installUsageFetch() {
    if (installed) return;
    originalFetch = globalThis.fetch;
    installed = true;
    hold = null;
    globalThis.fetch = async function usageFetch(input, init) {
        const url = requestUrl(input);
        const armed = hold && sameUrl(url, hold.expectedUrl) ? hold : null;
        if (armed) hold = null;
        let response;
        try {
            response = await originalFetch(input, init);
        } catch (error) {
            if (armed) await cancelQuiet(armed, 'UNKNOWN');
            throw error;
        }
        if (armed) scheduleSettle(armed, response);
        return response;
    };
}

export function uninstallUsageFetch() {
    if (!installed) return;
    globalThis.fetch = originalFetch;
    originalFetch = null;
    hold = null;
    installed = false;
}

/** 包装未安装时为空操作，避免单测把预留留在进程里。 */
export function armUsageHold(spec) {
    if (!installed || !spec?.reservationId) return;
    hold = spec;
}

function requestUrl(input) {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.toString();
    if (input && typeof input.url === 'string') return input.url;
    return '';
}

function sameUrl(left, right) {
    return String(left || '').replace(/\/+$/, '') === String(right || '').replace(/\/+$/, '');
}

async function cancelQuiet(armed, disposition) {
    try {
        await cancelModelUsage(armed.config, armed.reservationId, {
            ownerAccountId: armed.ownerAccountId,
            disposition,
        });
    } catch { /* 不把记账失败写成上游正文 */ }
}

function scheduleSettle(armed, response) {
    let clone = null;
    try {
        clone = response.clone();
    } catch { /* 无法复制时按未知用量取消 */ }
    const contentType = response.headers?.get?.('content-type') || '';
    void (async () => {
        try {
            if (!response.ok || !clone) {
                await cancelQuiet(armed, 'UNKNOWN');
                return;
            }
            const usage = contentType.includes('text/event-stream')
                ? await readSseUsage(clone)
                : await readJsonUsage(clone);
            if (!usage) {
                await cancelQuiet(armed, 'UNKNOWN');
                return;
            }
            await settleModelUsage(armed.config, armed.reservationId, {
                ownerAccountId: armed.ownerAccountId,
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
            });
        } catch {
            await cancelQuiet(armed, 'UNKNOWN');
        }
    })();
}

async function readJsonUsage(response) {
    const text = await response.text();
    try {
        return readUsageTokens(JSON.parse(text)?.usage);
    } catch {
        return undefined;
    }
}

async function readSseUsage(response) {
    const text = await response.text();
    let input;
    let output;
    let saw = false;
    const take = (usage, kind) => {
        if (!usage || typeof usage !== 'object') return;
        if (kind === 'chat' && ('prompt_tokens' in usage || 'completion_tokens' in usage)) {
            input = Number(usage.prompt_tokens ?? input ?? 0);
            output = Number(usage.completion_tokens ?? output ?? 0);
            saw = true;
            return;
        }
        if ('input_tokens' in usage) {
            input = Number(usage.input_tokens ?? 0);
            saw = true;
        }
        if ('output_tokens' in usage) {
            output = Number(usage.output_tokens ?? 0);
            saw = true;
        }
    };
    for (const block of text.split('\n\n')) {
        for (const line of block.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const data = trimmed.slice(5).trim();
            if (!data || data === '[DONE]') continue;
            let json;
            try {
                json = JSON.parse(data);
            } catch {
                continue;
            }
            take(json.usage, 'chat');
            take(json.message?.usage, 'anthropic');
            if (json.type === 'message_delta') take(json.usage, 'anthropic');
        }
    }
    if (!saw) return undefined;
    return { inputTokens: input ?? 0, outputTokens: output ?? 0 };
}
