// script.js 在 Go 无响应时必须返回 503。客户端等待要盖过插件已配置的 Go 超时，
// 否则请求会在服务端尚未失败关闭时被浏览器掐断。断言仍是状态码 503。

export function failClosedWaitMs(env = process.env) {
    const goTimeout = Number(env.VC_ST_GO_TIMEOUT_MS || 30000);
    if (!Number.isFinite(goTimeout) || goTimeout < 1) throw new Error('VC_ST_GO_TIMEOUT_MS');
    return goTimeout + 5000;
}
