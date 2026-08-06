// TASK-0026: Fetch-SSE resume client orchestrating the stream reducer through
// the realtime contract's five dispositions. The transport (ticket issue +
// resume + snapshot fetch) is injected so the orchestration is fully testable
// with mocks (node vitest environment). The client never fabricates missing
// deltas: that invariant lives in the reducer; this module only routes
// dispositions and retry/cancel/snapshot recovery. See
// specs/contracts/realtime-contract.yaml.

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

export interface RealtimeDeps {
  /** Open (or reopen) the Fetch-SSE stream and return its disposition + events. */
  resume: (request: ResumeRequest) => Promise<ResumeResult>;
  /** Fetch the consistent terminal snapshot for snapshot recovery. */
  fetchSnapshot: (generationId: string) => Promise<StreamEvent[]>;
}

export interface StreamHandle {
  cancelled: boolean;
}

export type StreamOutcome =
  | "completed"
  | "cancelled"
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
 * Drive a generation stream to a terminal state through the contract
 * dispositions. RESUMED events are fed to the reducer; if a RESUMED batch ends
 * without a terminal event the stream is treated as disconnected and resumed
 * again from the new cursor. GAP_EXPIRED and an in-band gap both recover via the
 * snapshot endpoint. RESET_REQUIRED discards the draft and re-syncs to the new
 * epoch. NOT_FOUND_OR_FORBIDDEN is terminal and never discloses existence.
 */
export async function streamGeneration(
  deps: RealtimeDeps,
  generationId: string,
  initialEpoch: number,
  handle?: StreamHandle,
): Promise<StreamResult> {
  let state = initialState(initialEpoch);
  let epoch = initialEpoch;

  for (let attempt = 0; attempt < MAX_RESUME_ATTEMPTS; attempt++) {
    if (isCancel(handle)) {
      return { state: cancelStream(state), outcome: "cancelled" };
    }

    let result: ResumeResult;
    try {
      result = await deps.resume({
        generationId,
        afterSeq: state.cursor,
        streamEpoch: epoch,
      });
    } catch {
      // A transport failure is not auto-retried into a fabricated stream: the
      // caller decides. Surface as exhausted (non-terminal) so the UI does not
      // pretend success.
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
            return { state, outcome: "completed" };
          }
          if (state.status === "gap") {
            break; // recover via snapshot below
          }
          if (state.status === "reset_required") {
            break; // re-sync below
          }
        }
        if (state.terminal) {
          return { state, outcome: "completed" };
        }
        if (state.status === "gap") {
          const snapshot = await safeSnapshot(deps, generationId);
          if (snapshot === null) {
            return { state, outcome: "exhausted" };
          }
          state = applyTerminalSnapshot(state, snapshot);
          return { state, outcome: "completed" };
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
        state = applyTerminalSnapshot(state, result.events);
        return { state, outcome: "completed" };
      }

      case "GAP_EXPIRED": {
        state = markGap(state);
        const snapshot = await safeSnapshot(deps, generationId);
        if (snapshot === null) {
          return { state, outcome: "exhausted" };
        }
        state = applyTerminalSnapshot(state, snapshot);
        return { state, outcome: "completed" };
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

async function safeSnapshot(
  deps: RealtimeDeps,
  generationId: string,
): Promise<StreamEvent[] | null> {
  try {
    return await deps.fetchSnapshot(generationId);
  } catch {
    return null;
  }
}

/** Convenience: build a cancel handle the UI can flip during streaming. */
export function createStreamHandle(): StreamHandle {
  return { cancelled: false };
}
