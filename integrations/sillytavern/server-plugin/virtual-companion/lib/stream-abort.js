// 客户端停止生成时，node-fetch 在 abort 监听器里对 response.body 同步 emit('error', AbortError)。
// Node 的 stream.pipe 会先摘掉自己的 error 监听，再在没有其他监听器时把同一个错误重新 emit；
// 第二次 emit 没有监听器，异常被 AbortSignal 记成 uncaughtException，ST server-main 随即 exit。
// 抛出点不在 AbortController.abort 的调用栈返回值里，包住 abort() 接不住。
// 调用链：chat-completions.js 在请求 socket close 时 controller.abort()（交回原生链之后的 /generate），
// 与新外观开关无关。默认关闭新外观走同一条 Chat Completions 流，停止同样会退出宿主。
// 只有 AbortError / type===aborted 是客户端停止。ERR_STREAM_PREMATURE_CLOSE 及其他错误要记
// name 与 code（不记 message，避免上游正文进日志），再 destroy 响应，让调用方走失败路径。

const MARK = Symbol('vcAbsorbStreamAbort');
const RESPONSE = Symbol('vcAbsorbStreamResponse');

export function isClientAbort(error) {
    return error?.name === 'AbortError' || error?.type === 'aborted';
}

function destroyResponse(target, error) {
    if (!target || target.destroyed || typeof target.destroy !== 'function') return;
    try {
        target.destroy(error);
    } catch { /* 响应已经结束 */ }
}

/** 给这一条响应体挂上持久的 error 监听，让客户端中断不再变成未捕获异常。重复调用无效果；后补的 response 仍会记下。 */
export function absorbStreamAbort(stream, response) {
    if (!stream || typeof stream.on !== 'function') return;
    if (response && typeof response.destroy === 'function') stream[RESPONSE] = response;
    if (stream[MARK]) return;
    stream[MARK] = true;
    let handling = false;
    stream.on('error', (error) => {
        if (isClientAbort(error) || handling) return;
        handling = true;
        try {
            const name = error?.name || 'Error';
            const code = error?.code || '';
            console.warn(`Streaming request stream error: name=${name} code=${code}`);
            destroyResponse(stream[RESPONSE], error);
            const pipes = stream._readableState?.pipes;
            const list = Array.isArray(pipes) ? pipes : (pipes ? [pipes] : []);
            for (const dest of list) {
                if (dest !== stream[RESPONSE]) destroyResponse(dest, error);
            }
        } finally {
            handling = false;
        }
    });
}
