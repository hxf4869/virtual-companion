// Virtual Companion ST 桥接插件 — 运行配置。
// 许可：AGPL-3.0-only（见目录 README；ADR-0009 §3）。
// 服务令牌只经环境变量由宿主进程注入，不落盘、不打日志、不进浏览器。
import { parseAccountHandles } from './host-auth.js';

export function normalizeGoBaseUrl(raw) {
    const value = String(raw || '').trim().replace(/\/+$/, '');
    if (!value) return '';
    let url;
    try {
        url = new URL(value);
    } catch {
        throw new Error(`VC_ST_GO_BASE_URL 不是合法 URL：${value}`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error(`VC_ST_GO_BASE_URL 必须是 http(s) URL：${value}`);
    }
    // 只保留 origin + path（剥掉 query/hash，防止配置里夹带查询串被拼进接口路径）。
    return url.origin + (url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, ''));
}

/**
 * @param {Record<string,string|undefined>} env
 */
export function loadConfig(env = process.env) {
    const goBaseUrl = normalizeGoBaseUrl(env.VC_ST_GO_BASE_URL);
    const serviceToken = String(env.VC_ST_PLUGIN_SERVICE_TOKEN || '');
    const timeoutMs = Number.parseInt(env.VC_ST_GO_TIMEOUT_MS || '', 10) || 30_000;
    if (serviceToken && serviceToken.length < 32) {
        throw new Error('VC_ST_PLUGIN_SERVICE_TOKEN 长度不足 32 字节，拒绝以弱令牌启用受控取用');
    }
    const accountHandles = parseAccountHandles(env.VC_ST_ACCOUNT_HANDLES);
    return { goBaseUrl, serviceToken, timeoutMs, accountHandles };
}
