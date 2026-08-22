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
  /** Open (or reopen) the Fetch-SSE stream and return its disposition + events. */
  resume: (request: ResumeRequest, signal?: AbortSignal) => Promise<ResumeResult>;
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

  for (let attempt = 0; attempt < MAX_RESUME_ATTEMPTS; attempt++) {
    if (isCancel(handle)) {
      return { state: cancelStream(state), outcome: "cancelled" };
    }

    let result: ResumeResult;
    try {
      result = await deps.resume(
        {
          generationId,
          afterSeq: state.cursor,
          streamEpoch: epoch,
        },
        handle?.signal,
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
        if (result.events.length === 0) {
          // Empty RESUMED without terminal: disconnected before any event.
          // Resume again from the same cursor.
          continue;
        }
        for (const event of result.events) {
          state = applyEvent(state, event);
          if (state.terminal) {
            return { state, outcome: terminalOutcome(state) };
          }
          if (state.status === "gap") {
            break; // recover via snapshot below
          }
          if (state.status === "reset_required") {
            break; // re-sync below
          }
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
        // status === "streaming": the batch ended without a terminal event ->
        // treat as a disconnect and resume again from the new cursor.
        continue;
      }

      case "TERMINAL_SNAPSHOT": {
        // Only a genuine terminal snapshot completes (P1-07).
        state = applyTerminalSnapshot(state, result.events);
        return state.terminal
          ? { state, outcome: terminalOutcome(state) }
          : { state, outcome: "exhausted" };
      }

      case "GAP_EXPIRED": {
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
