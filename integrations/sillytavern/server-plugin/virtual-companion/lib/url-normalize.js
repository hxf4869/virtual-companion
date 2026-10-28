// Virtual Companion ST 桥接插件 — 三协议最终请求地址规范化。
// 许可：AGPL-3.0-only（见目录 README；ADR-0009 §3）。
// 规则（ARCH §17.2）：
//  - endpointUrl（缺省回退 baseUrl）是协议基地址，可含自定义前缀与 /v1；
//  - 绝不自动补 /v1、绝不换供应商域名、绝不重复方法路径；
//  - Go 登记的 endpointUrl 若已带方法路径（/chat/completions、/responses、/messages），
//    finalRequestUrl 原样使用；nativeBaseUrl 反向剥掉，交给 ST 原生代码自行拼接。

import { BridgeError } from './errors.js';

export const PROTOCOLS = {
    OPENAI_CHAT_COMPLETIONS: '/chat/completions',
    OPENAI_RESPONSES: '/responses',
    ANTHROPIC_MESSAGES: '/messages',
};

function parseBase(protocol, provider) {
    const suffix = PROTOCOLS[protocol];
    if (!suffix) {
        throw new BridgeError(400, 'VC_PROTOCOL_UNSUPPORTED', `不支持的协议：${protocol}`);
    }
    const raw = String(provider?.endpointUrl || provider?.baseUrl || '').trim();
    if (!raw) {
        throw new BridgeError(502, 'VC_PROVIDER_URL_MISSING', 'Go 登记的供应商缺少 endpointUrl/baseUrl，无法生成最终请求地址');
    }
    let url;
    try {
        url = new URL(raw);
    } catch {
        throw new BridgeError(502, 'VC_PROVIDER_URL_INVALID', 'Go 登记的供应商地址不是合法 URL');
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new BridgeError(502, 'VC_PROVIDER_URL_INVALID', 'Go 登记的供应商地址必须是 http(s) URL');
    }
    url.hash = '';
    url.search = '';
    url.pathname = url.pathname.replace(/\/+$/, '');
    return { url, suffix };
}

/** Responses 出站使用的最终完整地址（含方法路径）。 */
export function finalRequestUrl(protocol, provider) {
    const { url, suffix } = parseBase(protocol, provider);
    if (!url.pathname.endsWith(suffix)) {
        url.pathname = url.pathname + suffix;
    }
    return url.toString();
}

/**
 * 交给 ST 原生代码的基地址（不含方法路径；ST 自行拼 `${apiUrl}/chat/completions`、
 * `${apiUrl}/messages`）。结尾不带斜杠，避免原生字符串拼接产生 `//messages`。
 */
export function nativeBaseUrl(protocol, provider) {
    const { url, suffix } = parseBase(protocol, provider);
    if (url.pathname.endsWith(suffix)) {
        url.pathname = url.pathname.slice(0, -suffix.length);
    }
    url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString().replace(/\/+$/, '');
}
