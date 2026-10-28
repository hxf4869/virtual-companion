// Virtual Companion ST 桥接插件 — 原生 /status 受管接管（连接检查真实化）。
// 许可：AGPL-3.0-only（见目录 README；ADR-0009 §3）。
// 与集中补丁 st-chat-completions-vc-bridge.json 的 /status 钩子配对：
//   - 仅当请求携带 vc-go:// 绑定标记（custom 源 custom_url）时接管；无标记交回原生流程；
//   - 接管后必须完成「真实上游模型列表请求」才可能回成功——绝不篡改 online_status
//     假装联网成功：ST 前端只有收到上游真实 {data:[...]} 才会显示 Valid 并填充下拉；
//   - 成功语义只是「上游连接已测试（模型列表）」，不代表生成可用；文案由页面/扩展说明；
//   - 每请求实时取用（Go 会话核验 + 受控 resolve），不缓存凭据，不落任何正文日志。
// claude 源前端不调用 /status（openai.js noValidateSources），无需处理。

import { BridgeError, writeErrorResponse, upstreamErrorText } from './errors.js';
import { log } from './log.js';
import { parseBindingMarker, resolveManagedBinding } from './generate-bridge.js';
import { nativeBaseUrl } from './url-normalize.js';

/**
 * @param {object} args
 * @param {{goBaseUrl: string, serviceToken: string, timeoutMs: number}} args.config
 * @param {() => number} [args.now]
 * @param {typeof fetch} [args.fetchImpl]
 * @returns {{interceptStatus: (request: object, statusResponse: object) => Promise<boolean>}}
 */
export function createStatusBridge({ config, now = () => Date.now(), fetchImpl = fetch }) {
    /**
     * @returns {Promise<boolean>} true = 已接管并写出响应（原生 /status 应立即 return）
     */
    async function interceptStatus(request, statusResponse) {
        const body = request?.body;
        const markerRaw = typeof body?.custom_url === 'string' && body.custom_url.startsWith('vc-go://')
            ? body.custom_url
            : null;
        if (!markerRaw) return false; // 非受管连接检查：交回原生 /status

        const startedAt = now();
        try {
            if (body.chat_completion_source !== 'custom') {
                throw new BridgeError(400, 'VC_SOURCE_MISMATCH', `受管连接检查要求 ST 连接源为 custom（当前 ${body.chat_completion_source}）；请重新加载模型设置`);
            }
            const marker = parseBindingMarker(markerRaw);
            if (!marker || marker.invalid) {
                throw new BridgeError(400, 'VC_MARKER_INVALID', 'Go 绑定标记格式无效，请在模型设置页重新生成');
            }

            const { resolved } = await resolveManagedBinding(config, { marker, cookieHeader: request.headers?.cookie ?? '' });
            // 真实上游模型列表请求：只用 resolve 返回的规范化基地址与受控凭据。
            const modelsUrl = `${nativeBaseUrl(resolved.provider.protocol, resolved.provider)}/models`;
            const upstream = await fetchImpl(modelsUrl, {
                method: 'GET',
                headers: { Authorization: `Bearer ${resolved.provider.credential}`, Accept: 'application/json' },
                signal: AbortSignal.timeout(config.timeoutMs),
            });
            if (!upstream.ok) {
                log.warn(`受管连接检查失败：provider=${resolved.provider.providerId} HTTP ${upstream.status}（正文不读取不回显）`);
                writeErrorResponse(
                    statusResponse, 502, 'VC_UPSTREAM_ERROR',
                    upstreamErrorText(upstream.status, upstream.statusText),
                );
                return true;
            }
            let data;
            try {
                data = await upstream.json();
            } catch {
                log.warn(`受管连接检查：上游 200 但响应不是 JSON（provider=${resolved.provider.providerId}）`);
                writeErrorResponse(statusResponse, 502, 'VC_UPSTREAM_ERROR', '上游模型服务返回了无法解析的响应');
                return true;
            }
            statusResponse.statusCode = 200;
            statusResponse.setHeader('Content-Type', 'application/json');
            statusResponse.setHeader('Cache-Control', 'no-store');
            statusResponse.end(JSON.stringify(data));
            log.info(`受管连接检查完成：provider=${resolved.provider.providerId} model=${resolved.model.modelId} 耗时${now() - startedAt}ms（仅验证模型列表，不代表生成可用）`);
            return true;
        } catch (error) {
            if (error instanceof BridgeError) {
                writeErrorResponse(statusResponse, error.status, error.code, error.message, error.extra);
                return true;
            }
            if (error?.name === 'TimeoutError' || error?.name === 'AbortError' || error?.code === 'ABORT_ERR') {
                writeErrorResponse(statusResponse, 504, 'VC_UPSTREAM_TIMEOUT', '上游模型服务响应超时');
                return true;
            }
            // 内部异常只记录错误类型，不记录 message（可能携带 provider 解析内容或敏感头）。
            log.error(`受管连接检查内部错误：${error?.name ?? 'unknown'}`);
            writeErrorResponse(statusResponse, 502, 'VC_BRIDGE_INTERNAL', '桥接内部错误，已中止本次连接检查');
            return true;
        }
    }

    return { interceptStatus };
}
