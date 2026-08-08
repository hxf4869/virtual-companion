import { describe, expect, it } from "vitest";

import {
  TERMINAL_EVENT_TYPE,
  applyEvent,
  applyTerminalSnapshot,
  beginStreaming,
  cancelStream,
  initialState,
  markGap,
  resetStream,
  type StreamEvent,
} from "@/domain/stream-reducer";

function delta(seq: number, epoch = 1, payload = "delta"): StreamEvent {
  return { eventSeq: seq, streamEpoch: epoch, eventType: "chat.delta", payload };
}

function terminal(seq: number, epoch = 1): StreamEvent {
  return { eventSeq: seq, streamEpoch: epoch, eventType: TERMINAL_EVENT_TYPE, payload: "done" };
}

describe("applyEvent contiguous advance", () => {
  it("applies a contiguous run and advances the cursor", () => {
    let state = initialState(1);
    state = applyEvent(state, delta(1));
    state = applyEvent(state, delta(2));
    state = applyEvent(state, delta(3));

    expect(state.status).toBe("streaming");
    expect(state.cursor).toBe(3);
    expect(state.events.map((e) => e.eventSeq)).toEqual([1, 2, 3]);
  });

  it("moves to terminal on chat.completed", () => {
    let state = initialState(1);
    state = applyEvent(state, delta(1));
    state = applyEvent(state, terminal(2));

    expect(state.status).toBe("terminal");
    expect(state.terminal).toBe(true);
    expect(state.cursor).toBe(2);
  });
});

describe("applyEvent never fabricates missing deltas", () => {
  it("stops on a gap and does NOT insert or interpolate the missing event", () => {
    let state = initialState(1);
    state = applyEvent(state, delta(1));
    // seq 3 arrives before 2 -> gap
    state = applyEvent(state, delta(3));

    expect(state.status).toBe("gap");
    expect(state.cursor).toBe(1); // not advanced past the gap
    expect(state.events.map((e) => e.eventSeq)).toEqual([1]); // no fabrication
    // The gapped event is dropped, never stored.
    expect(state.events.some((e) => e.eventSeq === 3)).toBe(false);
  });

  it("ignores duplicate and stale events idempotently", () => {
    let state = initialState(1);
    state = applyEvent(state, delta(1));
    state = applyEvent(state, delta(2));
    state = applyEvent(state, delta(2)); // duplicate
    state = applyEvent(state, delta(1)); // stale

    expect(state.cursor).toBe(2);
    expect(state.events.map((e) => e.eventSeq)).toEqual([1, 2]);
  });

  it("resumes the contiguous run once the missing event arrives after a gap", () => {
    // After a gap the client recovers via snapshot; but if the missing successor
    // arrives next, it is still a gap until the cursor is contiguous again.
    let state = initialState(1);
    state = applyEvent(state, delta(1));
    state = applyEvent(state, delta(3)); // gap
    expect(state.status).toBe("gap");
    state = applyEvent(state, delta(2)); // now cursor+1 (1 -> 2)
    expect(state.status).toBe("streaming");
    expect(state.cursor).toBe(2);
  });
});

describe("applyEvent epoch mismatch", () => {
  it("discards the draft and requires reset on an epoch change", () => {
    let state = initialState(1);
    state = applyEvent(state, delta(1));
    state = applyEvent(state, delta(2, /* epoch */ 99));

    expect(state.status).toBe("reset_required");
    expect(state.events).toEqual([]);
    expect(state.cursor).toBe(0);
  });
});

describe("disposition helpers", () => {
  it("markGap sets the gap status", () => {
    let state = initialState(1);
    state = applyEvent(state, delta(1));
    state = markGap(state);
    expect(state.status).toBe("gap");
  });

  it("resetStream discards the draft but can be followed by beginStreaming", () => {
    let state = initialState(1);
    state = applyEvent(state, delta(1));
    state = resetStream(state);
    expect(state.status).toBe("reset_required");
    expect(state.events).toEqual([]);
    // Client re-syncs with the new authoritative epoch (server bumped it).
    state = beginStreaming(state, 2);
    expect(state.status).toBe("streaming");
    expect(state.epoch).toBe(2);
    state = applyEvent(state, delta(1, 2));
    expect(state.cursor).toBe(1);
  });

  it("cancelStream freezes the stream; later events do not apply", () => {
    let state = initialState(1);
    state = applyEvent(state, delta(1));
    state = cancelStream(state);
    expect(state.status).toBe("cancelled");
    state = applyEvent(state, delta(2));
    expect(state.cursor).toBe(1); // frozen
    expect(state.events.map((e) => e.eventSeq)).toEqual([1]);
  });

  it("applyTerminalSnapshot replaces the draft with an authoritative snapshot", () => {
    let state = initialState(1);
    state = applyEvent(state, delta(1));
    state = applyEvent(state, delta(3)); // gap
    expect(state.status).toBe("gap");
    // Server snapshot supplies the consistent terminal view.
    state = applyTerminalSnapshot(state, [delta(1, 1), delta(2, 1), terminal(3, 1)]);
    expect(state.status).toBe("terminal");
    expect(state.terminal).toBe(true);
    expect(state.cursor).toBe(3);
    expect(state.events.map((e) => e.eventSeq)).toEqual([1, 2, 3]);
  });

  it("refuses to complete on a snapshot without the terminal event (P1-07)", () => {
    let state = initialState(1);
    state = applyEvent(state, delta(1));
    state = applyEvent(state, delta(3)); // gap

    state = applyTerminalSnapshot(state, [delta(1, 1), delta(2, 1)]); // no chat.completed

    expect(state.terminal).toBe(false);
    expect(state.status).not.toBe("terminal");
  });

  it("does not apply events after terminal", () => {
    let state = initialState(1);
    state = applyEvent(state, delta(1));
    state = applyEvent(state, terminal(2));
    state = applyEvent(state, delta(3));
    expect(state.status).toBe("terminal");
    expect(state.cursor).toBe(2);
  });
});
