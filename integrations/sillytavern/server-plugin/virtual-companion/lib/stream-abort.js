// 客户端停止生成时，node-fetch 在 abort 监听器里对 response.body 同步 emit('error', AbortError)。
// Node 的 stream.pipe 会先摘掉自己的 error 监听，再在没有其他监听器时把同一个错误重新 emit；
// 第二次 emit 没有监听器，异常被 AbortSignal 记成 uncaughtException，ST server-main 随即 exit。
// 抛出点不在 AbortController.abort 的调用栈返回值里，包住 abort() 接不住。
// 调用链：chat-completions.js 在请求 socket close 时 controller.abort()（交回原生链之后的 /generate），
// 与新外观开关无关。默认关闭新外观走同一条 Chat Completions 流，停止同样会退出宿主。

const MARK = Symbol('vcAbsorbStreamAbort');

export function isClientAbort(error) {
    return error?.name === 'AbortError'
        || error?.code === 'ABORT_ERR'
        || error?.code === 'ERR_STREAM_PREMATURE_CLOSE'
        || error?.type === 'aborted';
}

/** 给这一条响应体挂上持久的 error 监听，让客户端中断不再变成未捕获异常。重复调用无效果。 */
export function absorbStreamAbort(stream) {
    if (!stream || typeof stream.on !== 'function' || stream[MARK]) return;
    stream[MARK] = true;
    stream.on('error', (error) => {
        if (isClientAbort(error)) return;
        console.warn(`Streaming request stream error: ${error?.name || 'Error'}`);
    });
}
