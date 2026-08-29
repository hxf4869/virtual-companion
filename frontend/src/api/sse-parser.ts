// TASK-0104 (P2-15): Fetch-SSE frame parser extracted from the chat page so the
// transport glue is unit-testable in the node vitest environment.
//
// Contract (specs/contracts/realtime-contract.yaml + the resume endpoint):
//   - Frames are separated by a blank line; both LF ("\n\n") and CRLF
//     ("\r\n\r\n") boundaries are supported (P2-15: CRLF frames were silently
//     lost before, surfacing as an empty stream).
//   - Each frame carries one or more "data:" lines joined by "\n" and parsed as
//     JSON; an optional "event:" line is surfaced as SseFrame.event and an
//     optional top-level "disposition" field as SseFrame.disposition.
//   - A final unclosed frame at stream end is flushed (SSE EOF dispatch).
//   - TASK-0185: a control event frame with an "event:" line but no data: line
//     (stream.gap / stream.reset / stream.denied, as the 0184 controller emits)
//     is surfaced as { event, data: null }; only a frame with neither an event
//     nor a data line (comment/keepalive, e.g. ": ping") is skipped. A frame
//     whose data is non-JSON or a non-object payload throws SseParseError -- a
//     typed failure, never a silent empty stream.
//   - An aborted signal throws SseAbortedError so the caller can distinguish
//     cancellation from a transport failure.
//
// P1（round6）: 连接内流式消费。consumeSseFrames 在每个完整帧就绪时立即回调
// onFrame——生产 transport 借此把 durable event 在同一连接内即时上交 reducer，
// 不再缓存到 EOF；readSseFrames 退化为它的收集包装，语义与旧实现逐帧一致。

export interface SseFrame {
  /**
   * Optional SSE event name (the `event:` field). TASK-0185: the 0184
   * RealtimeStreamController encodes the resume disposition as the SSE event
   * name — durable events carry their type (chat.delta, ...), the terminal
   * snapshot carries "snapshot", and the control events stream.gap /
   * stream.reset / stream.denied carry no data: line at all.
   */
  event?: string;
  /** Optional top-level disposition field of the parsed payload (legacy shape). */
  disposition?: string;
  /** The parsed JSON payload, or null for a control event with no data: line. */
  data: unknown;
}

/** A malformed SSE frame: non-JSON data or a non-object payload. Frames without a data: line are valid comment/keepalive frames and are skipped. */
export class SseParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SseParseError";
  }
}

/** The stream was aborted (signal fired) before it finished. */
export class SseAbortedError extends Error {
  constructor() {
    super("SSE stream aborted");
    this.name = "SseAbortedError";
  }
}

/**
 * P1（round6）：连接内流式消费回调。每解析出一个完整 SSE 帧（含终局尾部
 * flush）立即派发一次。回调抛出的异常不包装、原样向上传播，由调用方归入
 * 可恢复失败。
 */
export type SseFrameCallback = (frame: SseFrame) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse one raw frame text into an {@link SseFrame}; throws SseParseError on bad data. */
function parseFrame(raw: string): SseFrame {
  const lines = raw.split(/\r?\n/);
  const dataLines = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^\s+/, ""));
  const eventLine = lines.find((line) => line.startsWith("event:"));
  const eventName = eventLine ? eventLine.slice(6).replace(/^\s+/, "") : undefined;

  if (dataLines.length === 0) {
    // TASK-0185: a control event frame (event: stream.gap / stream.reset /
    // stream.denied, as emitted by the 0184 RealtimeStreamController) carries an
    // SSE event name but no data: line. It is a real event and must be surfaced
    // so the transport can map it to a resume disposition. Only a frame with
    // neither an event nor a data line (a comment/keepalive, e.g. ": ping")
    // carries no event and is skipped (R1 P3); it materializes as data === SKIP.
    if (eventName) {
      return { event: eventName, data: null };
    }
    return SKIP_FRAME;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(dataLines.join("\n"));
  } catch {
    throw new SseParseError("SSE frame data is not valid JSON");
  }
  if (!isRecord(payload)) {
    throw new SseParseError("SSE frame data is not a JSON object");
  }
  const frame: SseFrame = { data: payload };
  if (eventName) {
    frame.event = eventName;
  }
  if (typeof payload.disposition === "string") {
    frame.disposition = payload.disposition;
  }
  return frame;
}

/**
 * Sentinel for a comment/keepalive frame that carries neither an event nor a
 * data line (: ping). Consumers MUST ignore it; the callback contract stays
 * "one call per parsed frame", so keep-alives surface instead of vanishing.
 */
const SKIP_FRAME: SseFrame = Object.freeze({ data: Symbol("sse-skip") }) as unknown as SseFrame;

function isSkip(frame: SseFrame): boolean {
  return frame === (SKIP_FRAME as unknown);
}

/**
 * Read an SSE byte stream into frames. Supports LF and CRLF boundaries,
 * multi-line data payloads, tail-frame flush at EOF, typed malformed errors
 * and abort signalling. Returns [] for a null body only when the caller
 * treats it as an empty-but-valid stream; a body that is not a readable
 * stream is a typed parse error.
 */
export async function readSseFrames(
  body: ReadableStream<Uint8Array> | null,
  signal?: AbortSignal,
): Promise<SseFrame[]> {
  const frames: SseFrame[] = [];
  await consumeSseFrames(body, signal, (frame) => {
    if (!isSkip(frame)) frames.push(frame);
  });
  return frames;
}

/**
 * P1（round6）：帧级流式消费。逐块解码、切分完整帧并在每个帧就绪时立即调用
 * {@link onFrame}，绝不缓存整条连接等待 EOF。abort 语义：读取前检查 + 一次性
 * abort 监听（cancel 底层流并裁决挂起的 read），两路均抛 SseAbortedError，
 * 与真实 fetch body 在 signal 中止时 reject 读操作的行为一致。解析失败抛出
 * SseParseError；onFrame 自身抛出的异常原样传播。
 *
 * round7（P2）：资源释放走 try/finally——正常 EOF、回调异常、解析异常与
 * abort 四条出口都会移除 abort 监听并 releaseLock；异常出口同时已 cancel
 * reader。锁绝不跨调用泄漏。
 */
export async function consumeSseFrames(
  body: ReadableStream<Uint8Array> | null,
  signal?: AbortSignal,
  onFrame?: SseFrameCallback,
): Promise<void> {
  if (body === null) {
    return;
  }
  if (typeof body.getReader !== "function") {
    throw new SseParseError("SSE response body is not a readable stream");
  }
  if (signal?.aborted) {
    throw new SseAbortedError();
  }
  const reader = body.getReader();
  // round7：abort 与底层 read 的完成是竞态——cancel 会把挂起 read 以
  // done:true 落定；无论谁先赢，本标志保证出口一致抛 SseAbortedError。
  let abortRequested = false;
  // 挂起 read 的 abort 裁决通道：signal 触发即 cancel 底层流并 reject race。
  let settleAbortRace: ((reason: unknown) => void) | null = null;
  const abortRace = new Promise<never>((_resolve, reject) => {
    settleAbortRace = reject;
  });
  abortRace.catch(() => undefined); // 竞态败者不得悬挂成 unhandled rejection。
  const onAbort = (): void => {
    // 先裁决竞态再 cancel：cancel 会同步把挂起 read 落定为 done，若让
    // read 先赢，abort 语义就会退化成"正常 EOF"。
    settleAbortRace?.(new SseAbortedError());
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  const releaseResources = (): void => {
    signal?.removeEventListener("abort", onAbort);
    // 正常 EOF 与各类错误路径下挂起 read 都已落定，releaseLock 合法；
    // 引擎实现差异下可能拒绝，防御性收尾但不吞任何业务异常。
    try {
      reader.releaseLock();
    } catch {
      // 锁已被底层状态机释放。
    }
  };

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      if (abortRequested) {
        throw new SseAbortedError();
      }
      const read = await Promise.race([reader.read(), abortRace]);
      if (abortRequested) {
        throw new SseAbortedError();
      }
      if (read.done) {
        break;
      }
      buffer += decoder.decode(read.value, { stream: true });
      // Both "\n\n" and "\r\n\r\n" boundaries; consume the exact separator.
      let boundary = buffer.search(/\r?\n\r?\n/);
      while (boundary !== -1) {
        const raw = buffer.slice(0, boundary);
        const separator = buffer.slice(boundary).match(/^\r?\n\r?\n/);
        buffer = buffer.slice(boundary + (separator ? separator[0].length : 2));
        // 始终解析（而不是挂在可选回调后面）：无消费者的调用同样受
        // "malformed 帧 = 类型化失败"契约约束。
        const frame = parseFrame(raw);
        onFrame?.(frame);
        boundary = buffer.search(/\r?\n\r?\n/);
      }
    }
    // Tail flush: an unclosed final frame is a real event (SSE EOF dispatch).
    if (buffer.trim() !== "") {
      const frame = parseFrame(buffer);
      onFrame?.(frame);
    }
  } finally {
    releaseResources();
  }
}
