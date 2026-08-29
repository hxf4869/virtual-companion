// TASK-0026/TASK-0104: Fetch-SSE resume client orchestrating the stream reducer
// through the realtime contract's five dispositions. The transport (ticket
// issue + resume + snapshot fetch) is injected so the orchestration is fully
// testable with mocks (node vitest environment). The client never fabricates
// missing deltas: that invariant lives in the reducer; this module only routes
// dispositions and retry/cancel/snapshot recovery. See
// specs/contracts/realtime-contract.yaml.
//
// TASK-0104 (P1-07/P2-14): snapshot recovery is typed -- a failed, empty or
// non-terminal snapshot NEVER completes the stream (it surfaces as exhausted,
// a typed non-terminal failure). resume/fetchSnapshot receive an AbortSignal so
// cancel/new-run/unmount can truly abort the underlying fetch; an aborted
// stream returns cancelled, never a fabricated continuation.

import {
  applyEvent,
  applyTerminalSnapshot,
  beginStreaming,
  cancelStream,
  initialState,
  markGap,
  resetStream,
  type StreamEvent,
  type StreamState,
} from "@/domain/stream-reducer";
import { nextResumeDelayMs } from "@/domain/stream-recovery";

export const MAX_RESUME_ATTEMPTS = 8;

export type ResumeDisposition =
  | "RESUMED"
  | "TERMINAL_SNAPSHOT"
  | "GAP_EXPIRED"
  | "RESET_REQUIRED"
  | "NOT_FOUND_OR_FORBIDDEN";

export interface ResumeResult {
  disposition: ResumeDisposition;
  /** Events for RESUMED (deltas) or TERMINAL_SNAPSHOT (the consistent snapshot). */
  events: StreamEvent[];
  /** Authoritative epoch a RESET_REQUIRED forces the client to re-sync to. */
  nextEpoch?: number;
}

export interface ResumeRequest {
  generationId: string;
  /** Resume from the last contiguous cursor applied. */
  afterSeq: number;
  /** The epoch the client currently holds. */
  streamEpoch: number;
}

/**
 * Typed snapshot result (P1-07): a failed fetch (HTTP/parse) has ok=false and
 * must never be treated as a safe terminal snapshot. USAGE-VIZ: usage carries
 * the settled provider tokens when the snapshot endpoint returns them.
 */
export interface SnapshotUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface SnapshotResult {
  ok: boolean;
  /** HTTP status when known, null for network/parse failures. */
  status: number | null;
  events: StreamEvent[];
  /** Settled provider usage; absent before finalize or on failed snapshots. */
  usage?: SnapshotUsage | null;
}

export interface RealtimeDeps {
  /**
   * Open (or reopen) the Fetch-SSE stream and return its disposition + events.
   * P1（round6）：第三个参数是连接内帧级回调——每个已完整解析的 durable
   * event 到达时立即调用（不等 EOF）。生产 transport 保证经回调派发的事件
   * 不再重复出现在返回的 ResumeResult.events 里；未实现该参数的注入依赖
   * （测试 mock / 旧批量 transport）仍以整批 events 返回，两种形态都能被
   * orchestrator 正确消费。
   */
  resume: (
    request: ResumeRequest,
    signal?: AbortSignal,
    onDurableEvent?: (event: StreamEvent) => void,
  ) => Promise<ResumeResult>;
  /** Fetch the consistent terminal snapshot for snapshot recovery. */
  fetchSnapshot: (generationId: string, signal?: AbortSignal) => Promise<SnapshotResult>;
}

export interface StreamHandle {
  cancelled: boolean;
  /** Abort the underlying transport fetch (P2-14). */
  abort: () => void;
  /** AbortSignal the transport must pass to fetch/reader (P2-14). */
  signal: AbortSignal;
}

export type StreamOutcome =
  | "completed"
  | "cancelled"
  | "blocked"
  | "failed"
  | "not_found_or_forbidden"
  | "exhausted";

export interface StreamResult {
  state: StreamState;
  outcome: StreamOutcome;
}

function isCancel(handle: StreamHandle | undefined): boolean {
  return Boolean(handle && handle.cancelled);
}

/**
 * TERM-SEM: map a terminal stream state to its typed outcome. chat.completed
 * completes; the other durable terminal events surface as their own outcomes
 * so the UI never collapses server cancelled/blocked/failed into a generic
 * failure. Non-terminal states surface as exhausted.
 */
function terminalOutcome(state: StreamState): StreamOutcome {
  switch (state.terminalEventType) {
    case "chat.completed":
      return "completed";
    case "chat.cancelled":
      return "cancelled";
    case "chat.blocked":
      return "blocked";
    case "chat.failed":
      return "failed";
    default:
      return "exhausted";
  }
}

/**
 * Drive a generation stream to a terminal state through the contract
 * dispositions. RESUMED events are fed to the reducer; if a RESUMED batch ends
 * without a terminal event the stream is treated as disconnected and resumed
 * again from the new cursor. GAP_EXPIRED and an in-band gap both recover via the
 * snapshot endpoint. RESET_REQUIRED discards the draft and re-syncs to the new
 * epoch. NOT_FOUND_OR_FORBIDDEN is terminal and never discloses existence.
 * Snapshot recovery only completes on a genuine terminal snapshot (P1-07);
 * every other snapshot outcome surfaces as exhausted.
 */
export interface StreamGenerationOptions {
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  initialState?: StreamState;
  /**
   * 每次事件应用（流式逐帧或 RESUMED 批内）后的中间状态回调。store 用它
   * 把不可变进度快照发布到响应式层，页面得以逐帧渲染流式草稿——单条连接
   * 内不再需要等到 EOF 才呈现。发布的是浅拷贝，终态写入仍是同一份。
   */
  onProgress?: (state: StreamState) => void;
}

export async function streamGeneration(
  deps: RealtimeDeps,
  generationId: string,
  initialEpoch: number,
  handle?: StreamHandle,
  options?: StreamGenerationOptions,
): Promise<StreamResult> {
  let state = options?.initialState ?? initialState(initialEpoch);
  let epoch = state.epoch;

  // P1（round6）：单一应用点。连接内到达的 durable event 经 onDurableEvent
  // 在此立即过 reducer 并发布中间状态；一旦进入 gap / reset / 终态就停止
  // 应用后续事件（与旧"批内 break"语义一致）。返回批里与 cursor 相同的
  // 事件是幂等 no-op，因此注入依赖无论走流式还是批量路径都恰好应用一次。
  let attemptApplied = false;
  const applyAndPublish = (event: StreamEvent): void => {
    if (
      state.terminal ||
      state.status === "gap" ||
      state.status === "reset_required"
    ) {
      return;
    }
    const prev = state;
    state = applyEvent(state, event);
    if (!Object.is(prev, state)) {
      attemptApplied = true;
      // round7（P2）：进度订阅者的异常只影响它自己——不得顺着回调链把
      // （尤其已经 terminal 的）流判成传输失败而 exhausted。
      if (options?.onProgress) {
        try {
          options.onProgress(state);
        } catch {
          // 订阅方异常不改变流状态机。
        }
      }
    }
  };

  for (let attempt = 0; attempt < MAX_RESUME_ATTEMPTS; attempt++) {
    if (isCancel(handle)) {
      return { state: cancelStream(state), outcome: "cancelled" };
    }

    // P1（round6）：每个 attempt 重新累计"本连接是否应用过事件"。
    attemptApplied = false;
    let result: ResumeResult;
    try {
      result = await deps.resume(
        {
          generationId,
          afterSeq: state.cursor,
          streamEpoch: epoch,
        },
        handle?.signal,
        applyAndPublish,
      );
    } catch {
      if (isCancel(handle)) {
        return { state: cancelStream(state), outcome: "cancelled" };
      }
      if (options?.sleep && attempt < MAX_RESUME_ATTEMPTS - 1) {
        await options.sleep(nextResumeDelayMs(attempt, options.random ?? Math.random));
        continue;
      }
      return { state, outcome: "exhausted" };
    }

    if (isCancel(handle)) {
      return { state: cancelStream(state), outcome: "cancelled" };
    }

    switch (result.disposition) {
      case "RESUMED": {
        // 流式回调已应用的事件在 reducer 中幂等；这里只兜底应用 mock/旧
        // 批量 transport 直接随批次返回的事件。
        for (const event of result.events) {
          applyAndPublish(event);
        }
        if (state.terminal) {
          return { state, outcome: terminalOutcome(state) };
        }
        if (state.status === "gap") {
          const snapshot = await safeSnapshot(deps, generationId, handle);
          if (snapshot === null) {
            return isCancel(handle)
              ? { state: cancelStream(state), outcome: "cancelled" }
              : { state, outcome: "exhausted" };
          }
          state = applyTerminalSnapshot(state, snapshot);
          return state.terminal
            ? { state, outcome: terminalOutcome(state) }
            : { state, outcome: "exhausted" };
        }
        if (state.status === "reset_required") {
          epoch = result.nextEpoch ?? epoch + 1;
          state = beginStreaming(state, epoch);
          continue;
        }
        if (!attemptApplied) {
          // Empty RESUMED without any applied event: disconnected before
          // anything arrived. Resume again from the same cursor.
          continue;
        }
        // status === "streaming"：连接在无终态事件的情况下结束（逐帧已发布，
        // 不再重复发布）→ 视为断线，从新 cursor 续传。
        continue;
      }

      case "TERMINAL_SNAPSHOT": {
        // round7（P2）：终态后迟到的快照裁定不得穿透已冻结的流——outcome
        // 只能由已应用的 terminal 事件决定，也不得再发恢复请求。
        if (state.terminal || state.status === "cancelled") {
          return { state, outcome: terminalOutcome(state) };
        }
        // Only a genuine terminal snapshot completes (P1-07).
        state = applyTerminalSnapshot(state, result.events);
        return state.terminal
          ? { state, outcome: terminalOutcome(state) }
          : { state, outcome: "exhausted" };
      }

      case "GAP_EXPIRED": {
        if (state.terminal || state.status === "cancelled") {
          return { state, outcome: terminalOutcome(state) };
        }
        state = markGap(state);
        const snapshot = await safeSnapshot(deps, generationId, handle);
        if (snapshot === null) {
          return isCancel(handle)
            ? { state: cancelStream(state), outcome: "cancelled" }
            : { state, outcome: "exhausted" };
        }
        state = applyTerminalSnapshot(state, snapshot);
        return state.terminal
          ? { state, outcome: terminalOutcome(state) }
          : { state, outcome: "exhausted" };
      }

      case "RESET_REQUIRED": {
        state = resetStream(state);
        epoch = result.nextEpoch ?? epoch + 1;
        state = beginStreaming(state, epoch);
        continue;
      }

      case "NOT_FOUND_OR_FORBIDDEN":
        // Existence is never disclosed; report a terminal not-found outcome.
        return { state, outcome: "not_found_or_forbidden" };

      default:
        return { state, outcome: "exhausted" };
    }
  }

  return { state, outcome: "exhausted" };
}

/**
 * Fetch the terminal snapshot with typed failure semantics (P1-07): null on any
 * transport/HTTP/parse failure; the caller decides between cancelled and
 * exhausted. A valid-but-non-terminal snapshot is NOT filtered here -- the
 * reducer's applyTerminalSnapshot refuses to complete on it.
 */
async function safeSnapshot(
  deps: RealtimeDeps,
  generationId: string,
  handle?: StreamHandle,
): Promise<StreamEvent[] | null> {
  try {
    const result = await deps.fetchSnapshot(generationId, handle?.signal);
    if (!result.ok) {
      return null;
    }
    return result.events;
  } catch {
    return null;
  }
}

/** Convenience: build a cancel handle the UI can flip during streaming. */
export function createStreamHandle(): StreamHandle {
  const controller = new AbortController();
  return {
    cancelled: false,
    abort: () => controller.abort(),
    signal: controller.signal,
  };
}
