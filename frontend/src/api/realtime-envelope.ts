// TASK-0163 (§5.1.1): wire realtime envelope → StreamEvent parser extracted from the
// chat page so the realtime transport glue is unit-testable in the node vitest
// environment (same reason TASK-0104 extracted sse-parser).
//
// Contract (specs/catalog/realtime-events.yaml `envelopeRequired` + the SQL envelope
// builders in V8 `vc.resume_stream` / `vc.read_generation_snapshot`, both
// `jsonb_build_object('event', e.event_type, ...)`): the authoritative wire field for
// the event type is `event` — NOT `eventType`. The previous inline parser in chat.vue
// read `value.eventType`, so every real catalog envelope had eventType=undefined→""
// and was silently dropped (the stream could never reach terminal). This module reads
// the catalog's `event` field and maps it onto the internal `StreamEvent.eventType`
// property consumed by the reducer. The reducer/transport contract is unchanged.
//
// `StreamEvent.eventType` is only the internal TS property name; the wire field is
// `event`. Keeping a `value.eventType` fallback would mask contract drift with dead
// code, so it is intentionally NOT accepted.

import type { StreamEvent } from "@/domain/stream-reducer";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse one wire realtime envelope into a {@link StreamEvent}, or return `null` when
 * it is not a usable event.
 *
 * Reads the authoritative catalog field `event` (not `eventType`). A real envelope
 * missing `event` (or carrying an empty one) is dropped — never silently mis-parsed.
 *
 * `fallbackEpoch` is used only when the envelope omits `streamEpoch`; this matches the
 * previous inline parser's behaviour so the reducer's epoch/reset semantics are
 * unchanged. Non-finite `eventSeq`/`streamEpoch` and non-record inputs also return
 * null, preserving the caller's existing null-filter loop.
 */
export function parseStreamEvent(value: unknown, fallbackEpoch: number): StreamEvent | null {
  if (!isRecord(value)) {
    return null;
  }
  const eventSeq = Number(value.eventSeq);
  const streamEpoch = Number(value.streamEpoch ?? fallbackEpoch);
  const eventType = String(value.event ?? "");
  if (!Number.isFinite(eventSeq) || !Number.isFinite(streamEpoch) || eventType === "") {
    return null;
  }
  return { eventSeq, streamEpoch, eventType, payload: value.payload };
}
