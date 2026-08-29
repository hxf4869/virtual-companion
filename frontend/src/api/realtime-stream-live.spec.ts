// @vitest-environment node
// P1（round6）：连接内 SSE 增量发布的生产形态测试。
//
// 与旧的"第一个 resume resolve、第二个 resume 挂起"fake batch 测试不同，
// 这里走完整生产链路：createBrowserRealtimeDeps（真实 fetch 注入）→ 测试显式
// 持有的 ReadableStream（未 close 即连接打开，reader.done=false）→ sse-parser
// 帧级回调 → streamGeneration 逐事件应用 → store.draft 立即可读。终态帧永远
// 最后 enqueue；每个中间断言点都证明连接仍处于打开状态——发布发生在同一条
// 连接内，而不是 EOF 之后。

import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RealtimeDeps } from "@/api/realtime";
import { createBrowserRealtimeDeps } from "@/api/realtime-transport";
import { useChatStore } from "@/stores/chat";
import type { StreamEvent } from "@/domain/stream-reducer";

const CONTEXT = { sessionId: "sess-live", origin: "http://localhost:5173" };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const encoder = new TextEncoder();

function envelope(
  event: string,
  eventSeq: number,
  streamEpoch: number,
  payload: unknown,
): string {
  return `event: ${event}\ndata: ${JSON.stringify({
    event,
    eventSeq,
    streamEpoch,
    payload,
  })}\n\n`;
}

const delta = (seq: number, text: string): string =>
  envelope("chat.delta", seq, 1, text);

/** 由测试持有的单条 SSE 连接：enqueue 即下发字节，close/error 才结束连接。 */
class LiveSseConnection {
  private readonly controllerRef: ReadableStreamDefaultController<Uint8Array>;
  private readonly streamRef: ReadableStream<Uint8Array>;
  /** close/error 之后即为 false；orchestrator 是否消费完不影响该语义。 */
  streamOpen = true;
  terminalSent = false;

  constructor(signal?: AbortSignal) {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    this.streamRef = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    });
    this.controllerRef = controller;
    // 真实 fetch body 的标准 abort 行为：signal 中止时底层流立刻 error。
    if (signal) {
      signal.addEventListener(
        "abort",
        () => this.error(new DOMException("aborted", "AbortError")),
        { once: true },
      );
    }
  }

  get stream(): ReadableStream<Uint8Array> {
    return this.streamRef;
  }

  get open(): boolean {
    return this.streamOpen;
  }

  enqueueSse(frames: string): void {
    if (!this.streamOpen) throw new Error("connection already ended");
    this.controllerRef.enqueue(encoder.encode(frames));
    if (frames.includes("chat.completed")) this.terminalSent = true;
  }

  close(): void {
    if (!this.streamOpen) return;
    this.streamOpen = false;
    this.controllerRef.close();
  }

  error(cause: unknown): void {
    if (!this.streamOpen) return;
    this.streamOpen = false;
    this.controllerRef.error(cause);
  }
}

interface LiveStack {
  fetchImpl: typeof fetch;
  conn(index?: number): LiveSseConnection | null;
  mints(): number;
}

/**
 * 生产形态的本地栈 stub：POST /tickets → JSON；GET /streams/{id} → 返回测试
 * 持有的一条新连接；GET snapshot 按 opts 提供。每轮 resume 打开一条独立
 * 连接（与 orchestrator 断线续传语义一致），按序从 conn(0)/conn(1)… 取用。
 */
function wireLiveStack(opts: { snapshotEvents?: unknown[] } = {}): LiveStack {
  const connections: LiveSseConnection[] = [];
  let mints = 0;
  const fetchImpl = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = String(input);
    if (url.includes("/tickets")) {
      mints += 1;
      return jsonResponse(200, { ticketId: `t-${mints}`, secret: "s" });
    }
    if (url.includes("/streams/")) {
      const connection = new LiveSseConnection(init?.signal as AbortSignal | undefined);
      connections.push(connection);
      return new Response(connection.stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }
    if (url.includes("/snapshot")) {
      return jsonResponse(200, {
        streamEpoch: 1,
        events: opts.snapshotEvents ?? [],
      });
    }
    return jsonResponse(404, {});
  }) as typeof fetch;
  return {
    fetchImpl,
    conn(index = -1): LiveSseConnection | null {
      return connections.at(index) ?? null;
    },
    mints: () => mints,
  };
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** 轮询等待第 index 条（默认最后一条）连接出现。 */
async function waitForConn(stack: LiveStack, index = -1): Promise<LiveSseConnection> {
  return vi.waitFor(() => {
    const c = stack.conn(index);
    expect(c).not.toBeNull();
    return c!;
  });
}

describe("P1-round6 in-connection streaming (production-shaped)", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  function makeStore(stack: LiveStack, generationId: string): {
    store: ReturnType<typeof useChatStore>;
    pending: Promise<void>;
  } {
    const deps: RealtimeDeps = createBrowserRealtimeDeps(CONTEXT, stack.fetchImpl);
    const store = useChatStore();
    return { store, pending: store.run(deps, generationId, 1) };
  }

  it("publishes each durable delta to the draft while the connection is still open, then completes once", async () => {
    const stack = wireLiveStack();
    const { store, pending } = makeStore(stack, "gen-live");
    const conn = await waitForConn(stack);

    // 第一批 chat.delta：终态未发送、连接未关闭时草稿必须已经更新。
    conn.enqueueSse(delta(1, "第一批"));
    await vi.waitFor(() => expect(store.draft).toBe("第一批"));
    expect(conn.open, "connection held open before the terminal").toBe(true);
    expect(conn.terminalSent).toBe(false);
    expect(store.phase).toBe("streaming");
    expect(store.stream.status).toBe("streaming");

    // 40–50ms 后第二批 delta：草稿继续增长，仍在同一条打开的连接内。
    await sleep(45);
    conn.enqueueSse(delta(2, "第二批"));
    await vi.waitFor(() => expect(store.draft).toBe("第一批第二批"));
    expect(conn.open, "connection still open for the second batch").toBe(true);
    expect(stack.mints()).toBe(1);

    // 终态帧最后 enqueue，然后才关闭连接（EOF）。
    conn.enqueueSse(delta(3, "收尾"));
    conn.enqueueSse(envelope("chat.completed", 4, 1, ""));
    conn.close();
    await pending;

    expect(store.phase).toBe("completed");
    expect(store.outcome).toBe("completed");
    // 正式内容只有一份：被流式派发过的事件不在最终 ResumeResult 里二次应用。
    expect(store.draft).toBe("第一批第二批收尾");
    expect(store.draft.split("第一批第二批收尾").length - 1).toBe(1);
    expect(store.stream.events.map((e) => e.eventSeq)).toEqual([1, 2, 3, 4]);
  });

  it("does not repeat frame-delivered deltas in the final ResumeResult", async () => {
    const stack = wireLiveStack();
    const delivered: StreamEvent[] = [];
    const pendingResume = createBrowserRealtimeDeps(CONTEXT, stack.fetchImpl).resume(
      { generationId: "101", afterSeq: 0, streamEpoch: 1 },
      undefined,
      (event) => delivered.push(event),
    );
    const conn = await waitForConn(stack);

    // 连接保持打开的窗口期内逐帧投递；sink 已看到的 seq 不允许再回流。
    conn.enqueueSse(delta(1, "A"));
    await vi.waitFor(() => expect(delivered.map((e) => e.eventSeq)).toEqual([1]));
    conn.enqueueSse(delta(2, "B"));
    await vi.waitFor(() => expect(delivered.map((e) => e.eventSeq)).toEqual([1, 2]));
    expect(conn.open).toBe(true);

    conn.enqueueSse(envelope("chat.completed", 3, 1, ""));
    conn.close();
    const result = await pendingResume;

    // 终局 ResumeResult 不得重复带回已发布的 delta。
    expect(result.disposition).toBe("RESUMED");
    expect(result.events).toEqual([]);
  });

  it("merges an in-band snapshot-metadata tail onto the streamed prefix ([1,2,3]+[4] -> [1,2,3,4])", async () => {
    // 真实服务端形态：同一连接先逐帧下发 seq1..3（草稿已增长），随后
    // `event: snapshot` 元数据帧不含 events 数组，服务端只继续发送 cursor 后的
    // terminal 尾巴 seq4，然后 EOF。终局必须是连续同 epoch 去重后的
    // [1,2,3,4]，草稿全文保持单份——绝不允许 [4] 整体替换掉 [1,2,3]。
    const stack = wireLiveStack();
    const { store, pending } = makeStore(stack, "gen-snapshot-tail");
    const conn = await waitForConn(stack);

    // 连接未关闭时逐帧可见。
    conn.enqueueSse(delta(1, "第一段"));
    await vi.waitFor(() => expect(store.draft).toBe("第一段"));
    conn.enqueueSse(delta(2, "第二段"));
    await vi.waitFor(() => expect(store.draft).toBe("第一段第二段"));
    conn.enqueueSse(delta(3, "第三段"));
    await vi.waitFor(() => expect(store.draft).toBe("第一段第二段第三段"));
    expect(conn.open, "connection held open before the snapshot tail").toBe(true);
    expect(conn.terminalSent).toBe(false);
    expect(store.stream.status).toBe("streaming");

    // snapshot 元数据（无 events）后跟 cursor 后的 terminal 尾巴；开头附带一个
    // 已应用过的重放 seq3，必须被幂等忽略而不是拼进草稿。
    conn.enqueueSse('event: snapshot\ndata: {"status":"COMPLETED","generationId":7}\n\n');
    conn.enqueueSse(delta(3, "重放的尾巴"));
    conn.enqueueSse(envelope("chat.completed", 4, 1, ""));
    // 终态之后的迟到控制帧不得改写结果。
    conn.enqueueSse("event: stream.gap\n\n");
    conn.close();
    await pending;

    expect(store.phase).toBe("completed");
    expect(store.outcome).toBe("completed");
    expect(store.stream.epoch).toBe(1);
    expect(store.stream.cursor).toBe(4);
    const seqs = store.stream.events.map((e) => e.eventSeq);
    expect(seqs).toEqual([1, 2, 3, 4]);
    expect(new Set(seqs).size).toBe(4);
    expect(store.draft).toBe("第一段第二段第三段");
    expect(store.draft.split("第一段第二段第三段").length - 1).toBe(1);
    expect(store.draft).not.toContain("重放的尾巴");
  });

  it("stays recoverable when aborted mid-stream and never fabricates a terminal", async () => {
    const stack = wireLiveStack();
    const { store, pending } = makeStore(stack, "gen-abort");
    const conn = await waitForConn(stack);

    conn.enqueueSse(delta(1, "已到达"));
    await vi.waitFor(() => expect(store.draft).toBe("已到达"));
    expect(conn.open).toBe(true);

    await store.cancel(); // CANCEL-A：本地 abort（后端确认失败不阻塞拆除）
    await pending;

    expect(store.phase).toBe("cancelled");
    expect(store.outcome).toBe("cancelled");
    expect(store.stream.terminal).toBe(false);
    expect(conn.open, "aborted connection torn down").toBe(false);
    expect(conn.terminalSent).toBe(false);
  });

  it("applies a duplicate eventSeq exactly once (no double application)", async () => {
    const stack = wireLiveStack();
    const { store, pending } = makeStore(stack, "gen-dup");
    const conn = await waitForConn(stack);

    conn.enqueueSse(delta(1, "唯一"));
    await vi.waitFor(() => expect(store.draft).toBe("唯一"));

    // 同一 seq 的重复投递必须被 reducer 幂等忽略：草稿既不加长也不拼接。
    conn.enqueueSse(delta(1, "重放的负载"));
    conn.enqueueSse(delta(1, "重放的负载"));
    await sleep(30);
    expect(store.draft).toBe("唯一");
    expect(conn.open).toBe(true);

    conn.enqueueSse(envelope("chat.completed", 2, 1, ""));
    conn.close();
    await pending;

    expect(store.phase).toBe("completed");
    expect(store.stream.cursor).toBe(2);
    expect(store.stream.events.map((e) => e.eventSeq)).toEqual([1, 2]);
    expect(store.draft.split("唯一").length - 1).toBe(1);
    expect(store.draft).not.toContain("重放的负载");
  });

  it("freezes on an in-band gap and recovers through the authoritative snapshot without fabricating deltas", async () => {
    const stack = wireLiveStack({
      snapshotEvents: [
        { event: "chat.delta", eventSeq: 1, streamEpoch: 1, payload: "快照补齐" },
        { event: "chat.delta", eventSeq: 2, streamEpoch: 1, payload: "丢失段" },
        { event: "chat.completed", eventSeq: 3, streamEpoch: 1, payload: "" },
      ],
    });
    const { store, pending } = makeStore(stack, "gen-gap");
    const conn = await waitForConn(stack);

    conn.enqueueSse(delta(1, "到达"));
    await vi.waitFor(() => expect(store.draft).toBe("到达"));

    // 连接中途到达 seq3：gap 中间状态立即发布，草稿冻结在 cursor=1，
    // 绝不编造缺失的 seq2。
    conn.enqueueSse(delta(3, "跳空的尾巴"));
    await vi.waitFor(() => expect(store.stream.status).toBe("gap"));
    expect(store.draft).toBe("到达");
    expect(conn.open).toBe(true);

    // EOF 视为断线，触发 snapshot 权威恢复（整体替换部分草稿并终态化）。
    conn.close();
    await pending;

    expect(store.phase).toBe("completed");
    expect(store.outcome).toBe("completed");
    expect(store.draft).toBe("快照补齐丢失段");
    expect(store.draft.split("快照补齐丢失段").length - 1).toBe(1);
    expect(store.draft.split("到达").length - 1).toBe(0);
    expect(store.draft.split("跳空的尾巴").length - 1).toBe(0);
    expect(store.stream.terminal).toBe(true);
  });

  it("resets the epoch mid-connection and re-resumes from cursor 0 on a fresh epoch", async () => {
    const stack = wireLiveStack();
    const { store, pending } = makeStore(stack, "gen-reset");
    const first = await waitForConn(stack);

    first.enqueueSse(delta(1, "旧纪元残稿"));
    await vi.waitFor(() => expect(store.draft).toBe("旧纪元残稿"));
    // streamEpoch=2 的 durable 事件到来：立即进入 reset_required（中间状态
    // 被发布），草稿被清空。
    first.enqueueSse(envelope("chat.delta", 9, 2, "新纪元"));
    await vi.waitFor(() => expect(store.stream.status).toBe("reset_required"));
    expect(store.draft).toBe("");
    first.close();

    // RESET_REQUIRED：epoch 升级 + 第二次 mint/resume，从 cursor 0 重开。
    // 注意把"新连接"判定放进轮询：EOF 处理与第二次建连都是异步的。
    const second = await vi.waitFor(() => {
      const latest = stack.conn();
      expect(latest && latest !== first, "a fresh connection was opened").toBeTruthy();
      return latest!;
    });
    second.enqueueSse(envelope("chat.completed", 1, 2, ""));
    second.close();
    await pending;

    expect(store.phase).toBe("completed");
    expect(store.outcome).toBe("completed");
    expect(store.stream.epoch).toBe(2);
    expect(store.stream.cursor).toBe(1);
    expect(store.draft).toBe("");
    expect(stack.mints()).toBeGreaterThanOrEqual(2);
  });
});
