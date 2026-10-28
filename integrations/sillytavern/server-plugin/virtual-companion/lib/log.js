// Virtual Companion ST 桥接插件 — 元数据日志。
// 许可：AGPL-3.0-only（见目录 README；ADR-0009 §3）。
// 约束（W03 边界）：只记录协议事件与标识符，绝不记录对话正文、messages、凭据、
// 令牌或 provider 响应体。调用方也不得把上述内容作为参数传入。

const PREFIX = '[vc-bridge]';

function emit(level, message) {
    console[level](`${PREFIX} ${message}`);
}

export const log = {
    info: (message) => emit('log', message),
    warn: (message) => emit('warn', message),
    error: (message) => emit('error', message),
};
