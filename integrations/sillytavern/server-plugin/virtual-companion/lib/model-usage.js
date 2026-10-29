// 前台用量预留。只有契约 200（status=HELD 且 reservationId 为十进制正整数）才允许发送。
// 404、其它状态、非契约响应、网络错误和超时都拒绝发送。结算/取消失败按固定次数重试，
// 耗尽后记录错误码；结算失败仍要取消为 UNKNOWN，避免把这笔预留留在 HELD。
// 许可：AGPL-3.0-only（见目录 README；ADR-0009 §3）。

import { BridgeError } from './errors.js';
import { reserveModelUsage, settleModelUsage, cancelModelUsage } from './go-client.js';
import { log } from './log.js';

const REFUSAL = {
    NO_PRICE: '当前模型没有单价，本次生成未发送',
    NO_BUDGET: '未配置预算，本次生成未发送',
    OVER_LIMIT: '本月额度已用完，本次生成未发送',
    ATTEMPT_REUSED: '本次调用标识已使用，已拒绝发送',
};

let installed = false;
let originalFetch = null;
let epoch = 0;
/** @type {WeakMap<object, object>} 预留绑定到发起它的 request，避免进程级单槽串单。 */
const holdsByRequest = new WeakMap();

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

/** 顶层 usage，或 {success,data} 信封内的 usage。没有用量对象时返回 undefined。 */
export function readProviderUsage(json) {
    if (!json || typeof json !== 'object') return undefined;
    const direct = readUsageTokens(json.usage);
    if (direct) return direct;
    if (json.data && typeof json.data === 'object') return readUsageTokens(json.data.usage);
    return undefined;
}

const HELD_ID = /^[1-9][0-9]*$/;
const LEDGER_ATTEMPTS = 3;

function closed(message) {
    return new BridgeError(502, 'VC_USAGE_CLOSED', message);
}

function timedOut(error) {
    return error?.name === 'TimeoutError' || error?.name === 'AbortError' || error?.code === 'ABORT_ERR';
}

function ledgerCode(error, fallback) {
    if (error instanceof BridgeError && typeof error.code === 'string' && error.code.startsWith('VC_')) return error.code;
    if (timedOut(error)) return 'VC_USAGE_TIMEOUT';
    return fallback;
}

async function withLedgerAttempts(fallback, run) {
    let last;
    for (let attempt = 0; attempt < LEDGER_ATTEMPTS; attempt += 1) {
        try {
            return await run();
        } catch (error) {
            last = error;
        }
    }
    log.error(`用量记账失败：${ledgerCode(last, fallback)}`);
    if (last instanceof BridgeError) throw last;
    throw new BridgeError(502, ledgerCode(last, fallback), '用量记账失败，已停止重试');
}

/**
 * @returns {Promise<object>} 契约预留。任何未成立的结果都拒绝发送。
 */
export async function reserveSend(config, payload) {
    let parsed;
    try {
        parsed = await reserveModelUsage(config, payload);
    } catch (error) {
        if (error instanceof BridgeError) throw error;
        throw closed(timedOut(error) ? '用量预留超时，本次生成未发送' : '用量预留不可用，本次生成未发送');
    }
    if (parsed.status === 409 || parsed.status === 429) {
        const reason = parsed.json?.details?.reason;
        throw new BridgeError(parsed.status, 'VC_USAGE_REFUSED', REFUSAL[reason] || '用量预留被拒绝，本次生成未发送');
    }
    const reservationId = parsed.json?.reservationId;
    if (parsed.status === 200 && parsed.json?.status === 'HELD' && typeof reservationId === 'string' && HELD_ID.test(reservationId)) {
        return parsed.json;
    }
    const status = Number.isInteger(parsed.status) ? `（HTTP ${parsed.status}）` : '';
    throw closed(`用量预留未成立${status}，本次生成未发送`);
}

/** 单次 HTTP 的有界重试。成功返回 Go JSON；耗尽后记下错误码并抛出，不附带响应体。 */
export function settleUsage(config, reservationId, payload) {
    return withLedgerAttempts('VC_USAGE_SETTLE_FAILED', () => settleModelUsage(config, reservationId, payload));
}

/** 与 settleUsage 相同的次数上限。调用方在结算失败后仍要用 UNKNOWN 走这一次，避免预留停在 HELD。 */
export function cancelUsage(config, reservationId, payload) {
    return withLedgerAttempts('VC_USAGE_CANCEL_FAILED', () => cancelModelUsage(config, reservationId, payload));
}

export function usageFetchInstalled() {
    return installed;
}

export function installUsageFetch() {
    if (installed) return;
    originalFetch = globalThis.fetch;
    installed = true;
    epoch += 1;
    // 原生 Chat/Claude 走 node-fetch，不经过这里。预留按 request 结算，包装只保持安装标记。
    globalThis.fetch = function usageFetch(input, init) {
        return originalFetch(input, init);
    };
}

export function uninstallUsageFetch() {
    if (!installed) return;
    globalThis.fetch = originalFetch;
    originalFetch = null;
    installed = false;
    epoch += 1;
}

/** 包装未安装、缺少 reservationId 或 request 时为空操作。
 * 同一 request 上还有未结算的旧预留时，先按 UNKNOWN 取消，再武装新的。其他 request 不动。 */
export async function armUsageHold(spec) {
    if (!installed || !spec?.reservationId || !spec.request) return;
    const previous = holdsByRequest.get(spec.request);
    const armed = { ...spec, generation: epoch };
    holdsByRequest.set(spec.request, armed);
    if (previous && previous.generation === epoch && previous.reservationId !== spec.reservationId) {
        await cancelQuiet(previous, 'UNKNOWN');
    }
}

/**
 * ST 1.19 的 Chat/Claude 最终发送用的是模块内的 node-fetch，不会经过 global fetch。
 * 补丁在那次响应返回后调用这里，并传入当前 request：只结算这一请求的预留。
 */
export function settleArmedResponse(response, url, request) {
    if (!response) return;
    const armed = takeRequestHold(request, url);
    if (!armed) return;
    scheduleSettle(armed, response);
}

/** 原生 fetch 抛错，或预留成功后在发出前就抛错时，按 UNKNOWN 取消这一请求的武装。地址不一致则不动。 */
export async function abandonOutbound(url, request) {
    const armed = takeRequestHold(request, url);
    if (!armed) return;
    await cancelQuiet(armed, 'UNKNOWN');
}

function takeRequestHold(request, url) {
    if (!installed || !request || !url) return null;
    const armed = holdsByRequest.get(request);
    if (!armed || armed.generation !== epoch) return null;
    if (!sameUrl(url, armed.expectedUrl)) return null;
    holdsByRequest.delete(request);
    return armed;
}

function sameUrl(left, right) {
    return String(left || '').replace(/\/+$/, '') === String(right || '').replace(/\/+$/, '');
}

async function cancelQuiet(armed, disposition) {
    try {
        await cancelUsage(armed.config, armed.reservationId, {
            ownerAccountId: armed.ownerAccountId,
            disposition,
        });
    } catch { /* 重试耗尽后的错误码已记日志，不回写成上游正文 */ }
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
            await settleUsage(armed.config, armed.reservationId, {
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
        return readProviderUsage(JSON.parse(text));
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
