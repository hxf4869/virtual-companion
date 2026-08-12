import { describe, expect, it } from "vitest";

import { parseStreamEvent } from "@/api/realtime-envelope";
import { TERMINAL_EVENT_TYPE } from "@/domain/stream-reducer";

// A wire envelope shaped exactly like specs/catalog/realtime-events.yaml
// `envelopeRequired` and the V8 SQL builders (`jsonb_build_object('event', ...)`).
function envelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    event: "chat.delta",
    generationId: "gen-1",
    streamEpoch: 2,
    eventSeq: 7,
    committedAt: "2026-08-12T00:00:00Z",
    payload: { text: "hi" },
    ...overrides,
  };
}

describe("parseStreamEvent (§5.1.1 wire field `event`)", () => {
  it("parses a real catalog delta envelope reading the `event` field", () => {
    const parsed = parseStreamEvent(envelope({ event: "chat.delta" }), 2);

    expect(parsed).not.toBeNull();
    expect(parsed).toMatchObject({
      eventSeq: 7,
      streamEpoch: 2,
      eventType: "chat.delta",
      payload: { text: "hi" },
    });
  });

  it("maps a terminal `chat.completed` envelope so the reducer can reach terminal", () => {
    const parsed = parseStreamEvent(
      envelope({ event: TERMINAL_EVENT_TYPE, eventSeq: 9 }),
      2,
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.eventType).toBe(TERMINAL_EVENT_TYPE);
    expect(parsed?.eventSeq).toBe(9);
  });

  it("parses other catalog event codes (chat.replace / chat.cancelled / safety.notice)", () => {
    for (const code of ["chat.replace", "chat.cancelled", "safety.notice"]) {
      const parsed = parseStreamEvent(envelope({ event: code }), 2);
      expect(parsed?.eventType).toBe(code);
    }
  });

  it("drops a real envelope that carries only `eventType` (regression guard for the old bug)", () => {
    // The old inline parser read `eventType`; a real backend never sends that field.
    // Such an envelope must return null so contract drift is never silently accepted.
    const onlyEventType = {
      schemaVersion: 1,
      eventType: "chat.delta",
      generationId: "gen-1",
      streamEpoch: 2,
      eventSeq: 7,
      payload: { text: "hi" },
    };

    expect(parseStreamEvent(onlyEventType, 2)).toBeNull();
  });

  it("drops an envelope missing the `event` field entirely", () => {
    const { event: _omit, ...withoutEvent } = envelope();
    expect(parseStreamEvent(withoutEvent, 2)).toBeNull();
  });

  it("drops an envelope whose `event` is empty", () => {
    expect(parseStreamEvent(envelope({ event: "" }), 2)).toBeNull();
  });

  it("falls back to fallbackEpoch when streamEpoch is omitted", () => {
    const { streamEpoch: _omit, ...withoutEpoch } = envelope({ streamEpoch: undefined });
    const parsed = parseStreamEvent(withoutEpoch, 5);

    expect(parsed?.streamEpoch).toBe(5);
  });

  it("drops an envelope with a non-finite eventSeq", () => {
    expect(parseStreamEvent(envelope({ eventSeq: "not-a-number" }), 2)).toBeNull();
  });

  it("drops non-record inputs (null / array / primitive)", () => {
    expect(parseStreamEvent(null, 2)).toBeNull();
    expect(parseStreamEvent([], 2)).toBeNull();
    expect(parseStreamEvent("chat.delta", 2)).toBeNull();
    expect(parseStreamEvent(42, 2)).toBeNull();
  });

  it("passes the payload through untouched", () => {
    const payload = { nested: { value: 1 }, list: [1, 2, 3] };
    const parsed = parseStreamEvent(envelope({ payload }), 2);

    expect(parsed?.payload).toEqual(payload);
  });
});
