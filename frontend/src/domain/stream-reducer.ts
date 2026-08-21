// TASK-0026: pure client-side stream reducer for Fetch-SSE resume.
//
// The reducer is the client-side bearer of INV-RT-001: the rendered draft only
// ever contains the last contiguous run of events. A gap (eventSeq > cursor+1)
// stops draft append and requires snapshot recovery; the missing deltas are
// NEVER fabricated or interpolated. An epoch mismatch discards the uncommitted
// draft and requires a reset. A terminal event freezes the stream. The reducer
// is a pure function of (state, event/action) so it is fully testable without
// DOM or network. See specs/contracts/realtime-contract.yaml#rules.

export type StreamStatus =
  | "idle"
  | "streaming"
  | "gap"
  | "reset_required"
  | "terminal"
  | "cancelled";

export interface StreamEvent {
  eventSeq: number;
  streamEpoch: number;
  eventType: string;
  payload: unknown;
}

export interface StreamState {
  status: StreamStatus;
  /** The authoritative generation stream epoch. */
  epoch: number;
  /** Last contiguous eventSeq applied (0 means none yet). */
  cursor: number;
  /** The contiguous, applied events that may be safely rendered as draft. */
  events: readonly StreamEvent[];
  /** True once a terminal event has been applied. */
  terminal: boolean;
  /**
   * TERM-SEM: which terminal event froze the stream, so the UI can distinguish
   * completed / cancelled / blocked / failed instead of collapsing every
   * non-completed terminal into a generic failure. Null while not terminal.
   */
  terminalEventType: string | null;
}

/**
 * Durable terminal events that freeze the stream (realtime-events catalog).
 * chat.completed exists only after final message + final review commit; the
 * other three close the stream without a final assistant message.
 */
export const TERMINAL_EVENT_TYPE = "chat.completed";
export const TERMINAL_EVENT_TYPES = new Set([
  "chat.completed",
  "chat.cancelled",
  "chat.blocked",
  "chat.failed",
]);

export function initialState(epoch: number): StreamState {
  return {
    status: "idle",
    epoch,
    cursor: 0,
    events: [],
    terminal: false,
    terminalEventType: null,
  };
}

function frozen(prev: StreamState): boolean {
  return prev.terminal || prev.status === "cancelled";
}

/**
 * Apply one stream event. Contiguous events (eventSeq === cursor+1) advance the
 * cursor and append to the safe draft. A duplicate or old event is ignored
 * (idempotent). A gap (eventSeq > cursor+1) stops the draft and requires
 * snapshot recovery WITHOUT fabricating the missing events. An epoch mismatch
 * discards the draft and requires reset. The reducer never invents events.
 */
export function applyEvent(prev: StreamState, event: StreamEvent): StreamState {
  if (frozen(prev)) {
    return prev;
  }

  // Epoch mismatch: discard uncommitted draft and require reset. The new epoch
  // arrives with the fresh stream the caller opens after reset.
  if (event.streamEpoch !== prev.epoch) {
    return { ...prev, status: "reset_required", events: [], cursor: 0 };
  }

  // Duplicate or stale event: idempotent ignore (resume may replay committed
  // events the client already applied).
  if (event.eventSeq <= prev.cursor) {
    return prev;
  }

  // Gap: a future event arrived before its predecessor. Never fabricate the
  // missing deltas; stop the draft and require snapshot recovery.
  if (event.eventSeq > prev.cursor + 1) {
    return { ...prev, status: "gap" };
  }

  // Contiguous: eventSeq === cursor + 1. Apply and advance.
  const events = [...prev.events, event];
  const terminal = TERMINAL_EVENT_TYPES.has(event.eventType);
  return {
    status: terminal ? "terminal" : "streaming",
    epoch: prev.epoch,
    cursor: event.eventSeq,
    events,
    terminal,
    terminalEventType: terminal ? event.eventType : null,
  };
}

/** GAP_EXPIRED disposition: the resume window aged out; require snapshot. */
export function markGap(prev: StreamState): StreamState {
  if (frozen(prev)) {
    return prev;
  }
  return { ...prev, status: "gap" };
}

/** RESET_REQUIRED disposition (epoch change): discard the draft, await a fresh epoch. */
export function resetStream(prev: StreamState): StreamState {
  if (prev.status === "cancelled") {
    return prev;
  }
  return {
    ...prev,
    status: "reset_required",
    events: [],
    cursor: 0,
    terminal: false,
    terminalEventType: null,
  };
}

/** CANCELLED: freeze the stream; no further events apply. */
export function cancelStream(prev: StreamState): StreamState {
  return { ...prev, status: "cancelled" };
}

/**
 * TERMINAL_SNAPSHOT disposition: replace the draft with the server's consistent
 * snapshot and freeze. The snapshot is authoritative, so the partial draft is
 * discarded rather than merged.
 *
 * P1-07 (TASK-0104): only a snapshot containing a durable terminal event may
 * complete the stream. A failed/empty/non-terminal snapshot returns the
 * previous state unchanged -- the caller must surface it as a typed
 * non-terminal failure, never as a safe completion. TERM-SEM: any of the four
 * durable terminal events (completed/cancelled/blocked/failed) is a genuine
 * server terminal, and the stream completes under that event's semantics.
 */
export function applyTerminalSnapshot(prev: StreamState, events: StreamEvent[]): StreamState {
  if (prev.status === "cancelled") {
    return prev;
  }
  const ordered = [...events].sort((a, b) => a.eventSeq - b.eventSeq);
  const terminalEvent = [...ordered]
    .reverse()
    .find((event) => TERMINAL_EVENT_TYPES.has(event.eventType));
  if (!terminalEvent) {
    return prev;
  }
  // Same invariant as applyEvent: a stale-epoch snapshot (e.g. after a reset
  // race) must not be accepted as a terminal under the previous epoch.
  if (terminalEvent.streamEpoch !== prev.epoch) {
    return { ...prev, status: "reset_required", events: [], cursor: 0 };
  }
  const cursor = ordered.length === 0 ? prev.cursor : ordered[ordered.length - 1].eventSeq;
  return {
    status: "terminal",
    epoch: prev.epoch,
    cursor,
    events: ordered,
    terminal: true,
    terminalEventType: terminalEvent.eventType,
  };
}

/** Begin streaming after idle/reset with the (possibly new) authoritative epoch. */
export function beginStreaming(prev: StreamState, epoch: number): StreamState {
  if (prev.status === "cancelled" || prev.terminal) {
    return prev;
  }
  return { status: "streaming", epoch, cursor: 0, events: [], terminal: false, terminalEventType: null };
}
