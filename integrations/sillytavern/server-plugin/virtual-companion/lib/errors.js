// Virtual Companion ST 桥接插件 — 集中错误类型。
// 许可：AGPL-3.0-only（见目录 README；ADR-0009 §3）。
// message 面向 Owner 展示，code 供前端/测试断言；任何字段都不得包含凭据或对话正文。

export class BridgeError extends Error {
    /**
     * @param {number} status 返回给 ST 客户端的 HTTP 状态码
     * @param {string} code 稳定错误码（VC_* 前缀）
     * @param {string} message 用户可读信息（简体中文）
     * @param {object} [extra] 附加字段（如 rejected 参数清单），必须可安全展示
     */
    constructor(status, code, message, extra = undefined) {
        super(message);
        this.name = 'BridgeError';
        this.status = status;
        this.code = code;
        this.extra = extra;
    }
}

/** 上游错误的固定对外文案：不解析、不回显上游响应体（其 error.message 可能携带 Key 或对话正文）。 */
export function upstreamErrorText(status, statusText) {
    return `上游模型服务返回错误（HTTP ${status}${statusText ? ` ${statusText}` : ''}）`;
}

/** 以 ST 前端可解析的形状写出错误（非流式响应体 / SSE 首块均可）。 */
export function writeErrorResponse(res, status, code, message, extra = undefined) {
    const error = { message, code, ...(extra ?? {}) };
    if (!res.headersSent) {
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify({ error }));
    } else if (!res.writableEnded) {
        res.end('');
    }
}
