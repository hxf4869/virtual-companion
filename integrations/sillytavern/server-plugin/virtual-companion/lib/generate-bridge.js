// Virtual Companion ST 桥接插件 — 生成拦截桥（/generate 最小核心钩子的对端实现）。
// 许可：AGPL-3.0-only（见目录 README；ADR-0009 §3）。
// 与集中补丁 st-chat-completions-vc-bridge.json 配对：
//  - 钩子①（switch 之前）：interceptGenerate —— 受管宿主策略：插件已装载即受管，
//    缺失/失效标记一律显式拒绝（不依赖首次成功请求缓存，也不回退 ST 本地密钥）；
//    插件未装载时补丁钩子为空操作，S1 的独立原生验收不受影响；
//  - 钩子②（最终发送前，Chat/Claude）：finalOutboundGuard —— 对实际转换后的
//    requestBody 做窗口/输出/URL 复核（覆盖 Claude thinking 追加、转换后的 system/tools）。
// 返回 true = 已完全处理（Responses 协议整体适配 / 显式拒绝）；false = 约束后交回原生链。
// 绑定标记（S3 投影写进 ST 连接设置，服务端每请求校验）：
//   vc-go://model-purposes/FOREGROUND_CHAT?provider=<id>&profile=<profileKey>&pr=<providerRevision:int>&br=<bindingRevision:int>&scope=<当前会话标识>
//   Custom 源放 custom_url，Claude 源放 reverse_proxy；scope 为 projection 携带的
//   最小当前会话字段（稳定 chat 标识，切换会话即变化；见 README「续接范围」）。

import crypto from 'node:crypto';
import { BridgeError, writeErrorResponse, upstreamErrorText } from './errors.js';
import { log } from './log.js';
import { authSession, resolveModelPurpose } from './go-client.js';
import { finalRequestUrl, nativeBaseUrl } from './url-normalize.js';
import { checkContextBudget, resolveOutputTokens, writeBackOutputTokens } from './context-guard.js';
import { refreshMemorySlot } from './memory-guard.js';
import { enforceStoryOutbound, isStorySession, requireStoryIdentity } from './story-guard.js';
import {
    buildResponsesRequest, convertResponsesToChatCompletion, bridgeResponsesStream, extractRoundFromOutput,
} from './responses-adapter.js';
import { prepareToolPolicy, runBoundedToolLoop, stripUnmeteredRequestFields } from './tool-loop.js';
import { reserveSend, armUsageHold, settleArmedResponse, abandonOutbound, usageFetchInstalled, readUsageTokens, settleUsage, cancelUsage } from './model-usage.js';
import { absorbStreamAbort } from './stream-abort.js';

export const BRIDGE_SYMBOL = Symbol.for('virtual-companion.bridge');
const PURPOSES_ALLOWED = new Set(['FOREGROUND_CHAT']);

function parseRevisionDigits(value) {
    if (value === null || value === undefined) return undefined;
    if (!/^\d+$/.test(value)) return null; // 非十进制整数：按无效标记处理
    const num = Number(value);
    return Number.isSafeInteger(num) ? num : null;
}

/**
 * @returns {{purpose:string, providerId?:string, profileKey?:string, providerRevision?:number, bindingRevision?:number, scope?:string, invalid?:boolean}|null}
 */
export function parseBindingMarker(raw) {
    if (typeof raw !== 'string' || !raw.startsWith('vc-go://')) return null;
    let url;
    try {
        url = new URL(raw);
    } catch {
        return { invalid: true };
    }
    if (url.host !== 'model-purposes' || !url.pathname) return { invalid: true };
    const purpose = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    if (!purpose) return { invalid: true };
    const q = url.searchParams;
    const providerRevision = parseRevisionDigits(q.get('pr'));
    const bindingRevision = parseRevisionDigits(q.get('br'));
    if (providerRevision === null || bindingRevision === null) return { invalid: true };
    return {
        purpose,
        providerId: q.get('provider') ?? undefined,
        profileKey: q.get('profile') ?? undefined,
        ...(providerRevision !== undefined ? { providerRevision } : {}),
        ...(bindingRevision !== undefined ? { bindingRevision } : {}),
        scope: q.get('scope') ?? undefined,
    };
}

function pickSessionCookies(cookieHeader) {
    if (!cookieHeader) return '';
    const kept = [];
    for (const pair of cookieHeader.split(';')) {
        const name = pair.split('=')[0].trim();
        if (name === 'vc_session' || name === 'vc_csrf') kept.push(pair.trim());
    }
    return kept.join('; ');
}

function requestedOutputTokens(body) {
    return body.max_completion_tokens !== undefined && body.max_completion_tokens !== null
        ? body.max_completion_tokens
        : body.max_tokens;
}

const PINNED_FLOAT_EPSILON = 1e-6;

/**
 * 原生偏离防线（外层核查第 1 条）：Go 钉住的有限参数不得被静默覆写——UI 显示的采样值
 * 必须就是实际发出的值。请求缺省时补齐钉住值（投影已把同值写进原生设置，UI 一致）；
 * 请求值存在且不同即明确拒绝，提示重新投影。Anthropic 的 reasoning 由原生 thinking
 * 预算承载，不在此按 reasoning_effort 字段核对。
 */
export function enforcePinnedParams(body, model, protocol) {
    const params = model?.generationParams ?? {};
    const pinned = [];
    if (params.temperature !== undefined && params.temperature !== null) pinned.push(['temperature', Number(params.temperature)]);
    if (params.topP !== undefined && params.topP !== null) pinned.push(['top_p', Number(params.topP)]);
    if (protocol !== 'ANTHROPIC_MESSAGES' && params.reasoningEffort) pinned.push(['reasoning_effort', String(params.reasoningEffort)]);
    const drifted = [];
    for (const [field, value] of pinned) {
        const actual = body[field];
        if (actual === undefined || actual === null || actual === '') {
            body[field] = value;
            continue;
        }
        const same = typeof value === 'number'
            ? Number.isFinite(Number(actual)) && Math.abs(Number(actual) - value) <= PINNED_FLOAT_EPSILON
            : String(actual) === value;
        if (!same) drifted.push(field);
    }
    if (drifted.length) {
        throw new BridgeError(
            409, 'VC_NATIVE_DRIFT',
            `原生请求的采样参数（${drifted.join('、')}）与 Go 绑定钉住的值不一致；请在模型设置页重新投影，不要手改受管参数`,
            { driftedFields: drifted },
        );
    }
}

/** 原生模型字段必须与绑定解析到的上游 modelId 一致；缺省时补齐，不一致即拒绝（不静默换模型）。 */
export function enforceBoundModel(body, model) {
    const requested = typeof body.model === 'string' ? body.model.trim() : '';
    if (requested && requested !== model.modelId) {
        throw new BridgeError(
            409, 'VC_NATIVE_DRIFT',
            `原生连接选择的模型（${requested}）与 Go 绑定的模型（${model.modelId}）不一致；请在模型设置页重新投影`,
            { requestedModel: requested, boundModelId: model.modelId },
        );
    }
    body.model = model.modelId;
}

function trailingToolRound(body) {
    /** @type {{callIds: string[], calls: Array<{id: string, name: string, arguments: string}>}} */
    const round = { callIds: [], calls: [] };
    if (!Array.isArray(body?.messages)) return round;
    let i = body.messages.length;
    while (i > 0 && body.messages[i - 1]?.role === 'tool' && body.messages[i - 1].tool_call_id) i -= 1;
    if (i > 0 && Array.isArray(body.messages[i - 1]?.tool_calls) && body.messages[i - 1].tool_calls.length > 0) {
        for (const call of body.messages[i - 1].tool_calls) {
            round.callIds.push(String(call?.id ?? ''));
            round.calls.push({ id: String(call?.id ?? ''), name: String(call?.function?.name ?? ''), arguments: String(call?.function?.arguments ?? '') });
        }
    }
    return round;
}

/**
 * 受控取用公共路径（/generate 与 /status 共用）：
 *   会话核验（ownerAccountId 只来自 Go 会话，绝不取浏览器自报值）→ 服务令牌 resolve
 *   → 标记快照与当前登记的防御性复核 → 凭据/modelId 在场检查。
 * @returns {Promise<{session: object, resolved: {provider: object, model: object}}>}
 */
export async function resolveManagedBinding(config, { marker, cookieHeader }) {
    const session = await authSession(config, { cookieHeader: pickSessionCookies(cookieHeader) });

    const resolved = await resolveModelPurpose(config, {
        purpose: marker.purpose,
        ownerAccountId: session.accountId, // 十进制字符串原样直传（Go 侧严格 ParseInt64，保住 >2^53 精度）
        ...(marker.providerId !== undefined ? { providerId: marker.providerId } : {}),
        ...(marker.profileKey !== undefined ? { profileKey: marker.profileKey } : {}),
        ...(marker.providerRevision !== undefined ? { providerRevision: marker.providerRevision } : {}),
        ...(marker.bindingRevision !== undefined ? { bindingRevision: marker.bindingRevision } : {}),
    });

    // 防御性复核：即使 Go 未比对 revision，标记快照与当前登记不一致也按冲突拒绝。
    if (marker.providerRevision !== undefined && Number(resolved.provider.revision) !== marker.providerRevision) {
        throw new BridgeError(409, 'VC_REVISION_CONFLICT', '供应商配置 revision 与页面快照不一致；请重新加载模型设置');
    }
    if (marker.bindingRevision !== undefined && Number(resolved.bindingRevision) !== marker.bindingRevision) {
        throw new BridgeError(409, 'VC_REVISION_CONFLICT', '用途绑定 revision 与页面快照不一致；请重新加载模型设置');
    }
    if (marker.profileKey !== undefined && resolved.model.profileKey !== undefined && resolved.model.profileKey !== marker.profileKey) {
        throw new BridgeError(409, 'VC_REVISION_CONFLICT', '绑定解析到的模型配置与页面快照不一致；请重新加载模型设置');
    }
    if (!resolved.provider.credential) {
        throw new BridgeError(502, 'VC_CREDENTIAL_MISSING', 'Go 目录未返回该供应商凭据（可能已撤销）；请检查模型设置');
    }
    if (!resolved.model.modelId) {
        throw new BridgeError(502, 'VC_MODEL_ID_MISSING', 'Go 目录未返回上游 modelId，无法生成请求');
    }
    return { session, resolved };
}

/**
 * @param {object} args
 * @param {{goBaseUrl: string, serviceToken: string, timeoutMs: number}} args.config
 * @param {import('./responses-adapter.js').ToolContinuationStore} args.continuationStore
 * @param {{estimator: string, count: (text: string, modelId: string) => number}} [args.counter] token 计数器（默认 ST guesstimate）
 * @param {() => number} [args.now]
 * @param {typeof fetch} [args.fetchImpl]
 */
export function createGenerateBridge({ config, continuationStore, counter, now = () => Date.now(), fetchImpl = fetch }) {
    const tokenCounter = counter ?? { estimator: 'st-guesstimate', count: (t) => Math.ceil(Buffer.byteLength(t, 'utf8') / 3.35) };

    async function runResponsesProtocol({ body, request, response, resolved, url, user, fingerprint, scope, ownerAccountId }) {
        const { model, provider } = resolved;
        const round = trailingToolRound(body);
        const controller = new AbortController();
        const onClose = () => controller.abort();
        request.socket.removeAllListeners('close');
        request.socket.on('close', onClose);
        // Authentication/config resolution may already have awaited before
        // reaching this handler; a previously closed socket cannot emit again.
        if (request.socket.destroyed || request.aborted) controller.abort();
        let hold = null;
        let settled = false;
        let sent = false;
        const cancelHold = async (disposition) => {
            if (!hold?.reservationId || settled) return;
            settled = true;
            try {
                await cancelUsage(config, hold.reservationId, { ownerAccountId, disposition });
            } catch { /* 记账失败不回显上游正文 */ }
        };
        const closeHold = async (usage) => {
            if (!hold?.reservationId || settled) return;
            const tokens = readUsageTokens(usage);
            if (!tokens) {
                await cancelHold('UNKNOWN');
                return;
            }
            await settleUsage(config, hold.reservationId, {
                ownerAccountId,
                inputTokens: tokens.inputTokens,
                outputTokens: tokens.outputTokens,
            });
            settled = true;
        };
        try {
            // 身份无效时还不能取用续接条目，否则一次坏请求会吃掉另一回合的 reasoning。
            const story = isStorySession(body) ? requireStoryIdentity(body) : null;
            try {
                controller.signal.throwIfAborted();
                const { requestBody, outputTokens } = buildResponsesRequest({ body, model });
                let memorySnapshot = null;
                if (story) {
                    const continuationItems = round.callIds.length
                        ? continuationStore.take({ user, fingerprint, scope, round, memorySnapshot: null, story })
                        : [];
                    await enforceStoryOutbound({
                        config, request, finalBody: requestBody, protocol: 'OPENAI_RESPONSES',
                        ownerAccountId, continuationItems, signal: controller.signal,
                    });
                } else {
                    const continuationAnchor = requestBody.input.findLast((item) => item.type === 'function_call'
                        && String(item.call_id) === round.calls[0]?.id);
                    memorySnapshot = await refreshMemorySlot({ config, request, response,
                        finalBody: requestBody, signal: controller.signal });
                    controller.signal.throwIfAborted();
                    // Opaque reasoning may contain previously recalled facts. Compare
                    // the actual final memory snapshot before admitting any such item.
                    const continuationItems = round.callIds.length
                        ? continuationStore.take({ user, fingerprint, scope, round, memorySnapshot })
                        : [];
                    if (continuationItems.length) {
                        requestBody.input.splice(requestBody.input.indexOf(continuationAnchor), 0, ...continuationItems);
                    }
                }
                const budget = checkContextBudget({ model, finalBody: requestBody, outputTokens, counter: tokenCounter });
                controller.signal.throwIfAborted();
                const reserved = await reserveSend(config, {
                    ownerAccountId,
                    purpose: 'FOREGROUND_CHAT',
                    attemptId: crypto.randomUUID(),
                    providerId: provider.providerId,
                    modelId: model.modelId,
                    estimatedInputTokens: Math.max(0, Math.round(Number(budget.estimatedInputTokens) || 0)),
                    estimatedOutputTokens: outputTokens,
                });
                if (reserved?.reservationId) hold = { reservationId: reserved.reservationId };
                controller.signal.throwIfAborted();

                const startedAt = now();
                sent = true;
                const upstream = await fetchImpl(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Accept: body.stream ? 'text/event-stream' : 'application/json',
                        Authorization: `Bearer ${provider.credential}`,
                    },
                    body: JSON.stringify(requestBody),
                    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(config.timeoutMs)]),
                });
                absorbStreamAbort(upstream.body, response);

                if (!upstream.ok) {
                    await cancelHold('UNKNOWN');
                    log.warn(`Responses 上游失败：HTTP ${upstream.status}（model=${model.modelId}，正文不读取不回显）`);
                    writeErrorResponse(response, 502, 'VC_UPSTREAM_ERROR', upstreamErrorText(upstream.status, upstream.statusText));
                    return true;
                }

                const commitRound = (finished) => {
                    if (!finished?.ok || controller.signal.aborted) return;
                    continuationStore.commit({
                        user, fingerprint, scope, memorySnapshot, story,
                        calls: finished.calls,
                        reasoningItems: finished.reasoningItems,
                    });
                };

                if (body.stream === true) {
                    await bridgeResponsesStream({
                        upstream, res: response,
                        onRoundFinished: async (finished) => {
                            commitRound(finished);
                            try {
                                await closeHold(finished?.usage);
                            } catch {
                                await cancelHold('UNKNOWN');
                            }
                        },
                    });
                } else {
                    const json = await upstream.json();
                    controller.signal.throwIfAborted();
                    await closeHold(json?.usage);
                    const round2 = extractRoundFromOutput(json.output);
                    continuationStore.commit({
                        user, fingerprint, scope, memorySnapshot, story,
                        calls: round2.toolCalls.map((c) => ({ id: c.id, name: c.function.name, arguments: c.function.arguments })),
                        reasoningItems: round2.reasoningItems,
                    });
                    response.statusCode = 200;
                    response.setHeader('Content-Type', 'application/json');
                    response.setHeader('Cache-Control', 'no-store');
                    response.end(JSON.stringify(convertResponsesToChatCompletion(json)));
                }
                log.info(`Responses 出站完成：model=${model.modelId} stream=${body.stream === true} 耗时${now() - startedAt}ms estimator=${tokenCounter.estimator}`);
                return true;
            } catch (error) {
                await cancelHold(sent ? 'UNKNOWN' : 'NOT_SENT');
                // A failed/aborted source check cannot leave an old opaque round
                // available for a later retry that happens to reuse its call IDs.
                if (round.callIds.length) continuationStore.discard({ round });
                throw error;
            }
        } finally {
            request.socket.removeListener('close', onClose);
        }
    }

    async function handle(request, response) {
        const body = request.body;
        if (!body || typeof body !== 'object') return false;

        const markerRaw = typeof body.custom_url === 'string' && body.custom_url.startsWith('vc-go://')
            ? body.custom_url
            : (typeof body.reverse_proxy === 'string' && body.reverse_proxy.startsWith('vc-go://') ? body.reverse_proxy : null);

        if (!markerRaw) {
            // 受管宿主策略（外层核查第 1 条）：插件已装载即受管；无标记 = 设置漂移/绕过尝试，
            // 显式拒绝，不做首次缓存，也不回退 ST SecretManager 的旧全局 Key。
            writeErrorResponse(
                response, 409, 'VC_UNMANAGED_GENERATION',
                '宿主已启用受管生成桥：生成必须携带 Go 绑定标记（vc-go://model-purposes/...）；请在模型设置页加载绑定配置',
            );
            return true;
        }

        const marker = parseBindingMarker(markerRaw);
        if (!marker || marker.invalid) {
            writeErrorResponse(response, 400, 'VC_MARKER_INVALID', 'Go 绑定标记格式无效（含 pr/br 必须为十进制整数），请在模型设置页重新生成');
            return true;
        }
        if (!PURPOSES_ALLOWED.has(marker.purpose)) {
            writeErrorResponse(
                response, 400, 'VC_PURPOSE_UNSUPPORTED',
                `用途 ${marker.purpose} 不在 ST 前台受控生成范围（W03 仅 FOREGROUND_CHAT；EMBEDDING 等不能作为聊天接口）`,
            );
            return true;
        }
        if (typeof body.messages === 'string') {
            throw new BridgeError(400, 'VC_TEXT_COMPLETION_UNSUPPORTED', '受管三协议仅支持消息模式；文本补全模式（messages 为字符串）不在受控范围');
        }

        // 会话核验 + 受控取用（与 /status 共用）：ownerAccountId 只来自 Go 会话，绝不取浏览器自报值。
        const { session, resolved } = await resolveManagedBinding(config, {
            marker,
            cookieHeader: request.headers?.cookie ?? '',
        });
        const user = `st:${request?.user?.profile?.handle ?? 'default-user'}|go:${session.accountId}`;

        continuationStore.sweep();
        const fingerprint = JSON.stringify({
            providerId: resolved.provider.providerId,
            providerRevision: resolved.provider.revision,
            bindingRevision: resolved.bindingRevision,
            profileKey: resolved.model.profileKey,
            modelId: resolved.model.modelId,
        });
        const source = body.chat_completion_source;
        const protocol = resolved.provider.protocol;

        if (protocol === 'OPENAI_RESPONSES') {
            if (source !== 'custom') {
                throw new BridgeError(400, 'VC_SOURCE_MISMATCH', `Responses 协议要求 ST 连接源为 custom（当前 ${source}）；请重新加载模型设置`);
            }
            enforcePinnedParams(body, resolved.model, protocol);
            enforceBoundModel(body, resolved.model);
            const responsesPolicy = prepareToolPolicy(body, resolved.model);
            if (responsesPolicy.companion) {
                return await runBoundedToolLoop({
                    config, request, response, body, resolved, session,
                    counter: tokenCounter, fetchImpl, now,
                });
            }
            return await runResponsesProtocol({
                body, request, response, resolved,
                url: finalRequestUrl(protocol, resolved.provider),
                user, fingerprint, scope: marker.scope, ownerAccountId: session.accountId,
            });
        }

        if (protocol === 'OPENAI_CHAT_COMPLETIONS') {
            if (source !== 'custom') {
                throw new BridgeError(400, 'VC_SOURCE_MISMATCH', `Chat Completions 协议要求 ST 连接源为 custom（当前 ${source}）；请重新加载模型设置`);
            }
            const outputTokens = resolveOutputTokens(requestedOutputTokens(body), resolved.model.maxOutputTokens);
            writeBackOutputTokens(body, outputTokens);
            enforcePinnedParams(body, resolved.model, protocol);
            enforceBoundModel(body, resolved.model);
            const chatPolicy = prepareToolPolicy(body, resolved.model);
            if (chatPolicy.companion) {
                return await runBoundedToolLoop({
                    config, request, response, body, resolved, session,
                    counter: tokenCounter, fetchImpl, now,
                });
            }
            body.custom_url = nativeBaseUrl(protocol, resolved.provider);
            request.vcGoCredential = resolved.provider.credential; // 补丁点：CUSTOM apiKey 改为请求内受控凭据
            request.vcManaged = {
                model: resolved.model,
                expectedUrl: finalRequestUrl(protocol, resolved.provider),
                counter: tokenCounter,
                outputTokens,
                protocol,
                ownerAccountId: session.accountId,
                providerId: resolved.provider.providerId,
                modelId: resolved.model.modelId,
            };
            log.info(`Chat Completions 约束后交回原生链：model=${resolved.model.modelId}`);
            return false;
        }

        if (protocol === 'ANTHROPIC_MESSAGES') {
            if (source !== 'claude') {
                throw new BridgeError(400, 'VC_SOURCE_MISMATCH', `Anthropic 协议要求 ST 连接源为 claude（当前 ${source}）；请重新加载模型设置`);
            }
            const outputTokens = resolveOutputTokens(requestedOutputTokens(body), resolved.model.maxOutputTokens);
            writeBackOutputTokens(body, outputTokens);
            enforcePinnedParams(body, resolved.model, protocol);
            enforceBoundModel(body, resolved.model);
            const anthropicPolicy = prepareToolPolicy(body, resolved.model);
            if (anthropicPolicy.companion) {
                return await runBoundedToolLoop({
                    config, request, response, body, resolved, session,
                    counter: tokenCounter, fetchImpl, now,
                });
            }
            // 原生 sendClaudeRequest 在设置 reverse_proxy 时使用 proxy_password 作为 Key；
            // 两者都只在服务端请求对象上覆写，不回传浏览器。原生 thinking 可能再调大
            // max_tokens —— 由补丁钩子②（最终发送前）复核拦截。
            body.reverse_proxy = nativeBaseUrl(protocol, resolved.provider);
            body.proxy_password = resolved.provider.credential;
            request.vcManaged = {
                model: resolved.model,
                expectedUrl: finalRequestUrl(protocol, resolved.provider),
                counter: tokenCounter,
                outputTokens,
                protocol,
                ownerAccountId: session.accountId,
                providerId: resolved.provider.providerId,
                modelId: resolved.model.modelId,
            };
            log.info(`Anthropic 约束后交回原生链：model=${resolved.model.modelId}`);
            return false;
        }

        throw new BridgeError(400, 'VC_PROTOCOL_UNSUPPORTED', `Go 登记的协议不受支持：${protocol}`);
    }

    /** @returns {Promise<boolean>} 是否已处理完毕 */
    async function interceptGenerate(request, response) {
        try {
            return await handle(request, response);
        } catch (error) {
            if (error instanceof BridgeError) {
                writeErrorResponse(response, error.status, error.code, error.message, error.extra);
                return true;
            }
            if (error?.name === 'TimeoutError' || error?.name === 'AbortError' || error?.code === 'ABORT_ERR') {
                writeErrorResponse(response, 504, 'VC_UPSTREAM_TIMEOUT', '上游模型服务响应超时');
                return true;
            }
            // 内部异常只记录错误类型：message 可能来自 provider 响应解析或敏感请求头，不落日志。
            log.error(`生成桥内部错误：${error?.name ?? 'unknown'}`);
            writeErrorResponse(response, 502, 'VC_BRIDGE_INTERNAL', '桥接内部错误，已中止本次生成');
            return true;
        }
    }

    /**
     * 补丁钩子②：Chat/Claude 原生链最终发送前，对「实际转换后」的 requestBody 复核
     * （窗口预算、输出上限——含 Claude thinking 追加——与期望 URL）。同步执行。
     * @returns {boolean} true = 已拒绝并写出响应（原生链应立即 return）
     */
    async function finalOutboundGuard(request, response, finalBody, url) {
        const managed = request?.vcManaged;
        if (!managed) return false; // 非受管请求（受管宿主下不应出现）不干预
        try {
            if (isStorySession(request.body)) {
                await enforceStoryOutbound({
                    config, request, finalBody,
                    protocol: managed.protocol,
                    ownerAccountId: managed.ownerAccountId,
                });
            } else {
                await refreshMemorySlot({ config, request, response, finalBody });
            }
            if (typeof url === 'string' && url.replace(/\/+$/, '') !== managed.expectedUrl.replace(/\/+$/, '')) {
                throw new BridgeError(409, 'VC_OUTBOUND_URL_DRIFT', '最终出站地址与 Go 登记的规范化地址不一致，已拒绝发送');
            }
            const modelMax = managed.model.maxOutputTokens;
            for (const field of ['max_tokens', 'max_completion_tokens', 'max_output_tokens']) {
                const value = finalBody?.[field];
                if (value != null && modelMax != null && Number(value) > Number(modelMax)) {
                    throw new BridgeError(
                        400, 'VC_OUTPUT_LIMIT_EXCEEDED',
                        `最终请求的 ${field}=${value} 超过模型登记上限 ${modelMax}（可能来自原生推理输出追加）；请降低输出/推理预留或上调登记值`,
                    );
                }
            }
            const budget = checkContextBudget({ model: managed.model, finalBody, outputTokens: managed.outputTokens, counter: managed.counter });
            if (request.body?.vc_mvu_extra === true) {
                throw new BridgeError(409, 'VC_UNMETERED_EXTRA', '未计量的额外生成已关闭，本次未发送');
            }
            // ST 1.19 的 custom 转换只给 OpenAI 名单和 koboldcpp 写 reasoning_effort。
            // 界面值已在 SETTINGS_READY 写回 request.body，并经 enforcePinnedParams 核对。
            // 不补到转换后的 body，上游就收不到钉住等级。
            if (managed.protocol === 'OPENAI_CHAT_COMPLETIONS' && finalBody && typeof finalBody === 'object') {
                const effort = request.body?.reasoning_effort;
                if (typeof effort === 'string' && effort !== '' && finalBody.reasoning_effort !== effort) {
                    finalBody.reasoning_effort = effort;
                }
            }
            stripUnmeteredRequestFields(finalBody);
            if (managed.ownerAccountId && managed.providerId && managed.modelId) {
                const reserved = await reserveSend(config, {
                    ownerAccountId: managed.ownerAccountId,
                    purpose: 'FOREGROUND_CHAT',
                    attemptId: crypto.randomUUID(),
                    providerId: managed.providerId,
                    modelId: managed.modelId,
                    estimatedInputTokens: Math.max(0, Math.round(Number(budget.estimatedInputTokens) || 0)),
                    estimatedOutputTokens: managed.outputTokens,
                });
                if (reserved?.reservationId && usageFetchInstalled()) {
                    await armUsageHold({
                        reservationId: reserved.reservationId,
                        ownerAccountId: managed.ownerAccountId,
                        expectedUrl: url,
                        config,
                        request,
                    });
                }
            }
            return false;
        } catch (error) {
            if (error instanceof BridgeError) {
                writeErrorResponse(response, error.status, error.code, error.message, error.extra);
                log.warn(`最终出站防线拒绝：${error.code}`);
                return true;
            }
            log.error(`最终出站防线内部错误：${error?.name ?? 'unknown'}`);
            writeErrorResponse(response, 502, 'VC_BRIDGE_INTERNAL', '桥接内部错误，已中止本次生成');
            return true;
        }
    }

    return {
        interceptGenerate,
        finalOutboundGuard,
        settleOutboundResponse: settleArmedResponse,
        absorbStreamAbort,
        abandonOutbound,
    };
}
