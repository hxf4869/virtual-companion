import { describe, expect, it, vi } from "vitest";

import {
  createStreamHandle,
  streamGeneration,
  MAX_RESUME_ATTEMPTS,
  type RealtimeDeps,
  type ResumeRequest,
  type ResumeResult,
} from "@/api/realtime";
import { TERMINAL_EVENT_TYPE, type StreamEvent } from "@/domain/stream-reducer";

function delta(seq: number, epoch = 1, payload = "d"): StreamEvent {
  return { eventSeq: seq, streamEpoch: epoch, eventType: "chat.delta", payload };
}
function terminal(seq: number, epoch = 1): StreamEvent {
  return { eventSeq: seq, streamEpoch: epoch, eventType: TERMINAL_EVENT_TYPE, payload: "done" };
}

function depsWith(
  resumeResults: ResumeResult[],
  snapshot: StreamEvent[] = [delta(1, 1), delta(2, 1), terminal(3, 1)],
): { deps: RealtimeDeps; resumeCalls: ResumeRequest[] } {
  const queue = [...resumeResults];
  const resumeCalls: ResumeRequest[] = [];
  const deps: RealtimeDeps = {
    resume: vi.fn(async (req: ResumeRequest): Promise<ResumeResult> => {
      resumeCalls.push(req);
      const next = queue.shift();
      if (!next) {
        throw new Error("resume queue exhausted");
      }
      return next;
    }),
    fetchSnapshot: vi.fn(async (_id: string) => ({
      ok: true,
      status: 200,
      events: snapshot,
    })),
  };
  return { deps, resumeCalls };
}

describe("streamGeneration offline success", () => {
  it("applies a contiguous RESUMED stream ending in chat.completed", async () => {
    const { deps } = depsWith([
      { disposition: "RESUMED", events: [delta(1), delta(2), terminal(3)] },
    ]);

    const result = await streamGeneration(deps, "gen-1", 1);

    expect(result.outcome).toBe("completed");
    expect(result.state.status).toBe("terminal");
    expect(result.state.cursor).toBe(3);
    expect(result.state.events.map((e) => e.eventSeq)).toEqual([1, 2, 3]);
  });

  // TERM-SEM: server terminal events other than chat.completed surface as
  // their own typed outcomes instead of a generic failure.
  const SERVER_TERMINAL_CASES: Array<[string, "cancelled" | "blocked" | "failed"]> = [
    ["chat.cancelled", "cancelled"],
    ["chat.blocked", "blocked"],
    ["chat.failed", "failed"],
  ];

  it.each(SERVER_TERMINAL_CASES)(
    "maps a RESUMED stream ending in %s to outcome %s",
    async (eventType, outcome) => {
      const { deps } = depsWith([
        {
          disposition: "RESUMED",
          events: [
            delta(1),
            { eventSeq: 2, streamEpoch: 1, eventType, payload: {} },
          ],
        },
      ]);

      const result = await streamGeneration(deps, "gen-1", 1);

      expect(result.outcome).toBe(outcome);
      expect(result.state.terminal).toBe(true);
      expect(result.state.terminalEventType).toBe(eventType);
    },
  );

  it.each(SERVER_TERMINAL_CASES)(
    "maps a TERMINAL_SNAPSHOT ending in %s to outcome %s",
    async (eventType, outcome) => {
      // The transport extracts the committed snapshot events into the
      // TERMINAL_SNAPSHOT disposition result (see realtime-transport.ts).
      const { deps } = depsWith([
        {
          disposition: "TERMINAL_SNAPSHOT",
          events: [
            delta(1, 1),
            { eventSeq: 2, streamEpoch: 1, eventType, payload: {} },
          ],
        },
      ]);

      const result = await streamGeneration(deps, "gen-1", 1);

      expect(result.outcome).toBe(outcome);
      expect(result.state.terminalEventType).toBe(eventType);
    },
  );
});

describe("streamGeneration progress subscriber isolation (round7 P2)", () => {
  it("keeps a terminal outcome when onProgress throws during streaming", async () => {
    const { deps } = depsWith([
      { disposition: "RESUMED", events: [delta(1), delta(2), terminal(3)] },
    ]);

    const result = await streamGeneration(deps, "gen-1", 1, undefined, {
      onProgress: () => {
        throw new Error("subscriber exploded");
      },
    });

    expect(result.outcome).toBe("completed");
    expect(result.state.status).toBe("terminal");
    expect(result.state.cursor).toBe(3);
  });
});

describe("streamGeneration disconnect then resume", () => {
  it("resumes from the last cursor after a non-terminal disconnect", async () => {    const { deps, resumeCalls } = depsWith([
      { disposition: "RESUMED", events: [delta(1)] }, // disconnect before terminal
      { disposition: "RESUMED", events: [delta(2), terminal(3)] }, // resume from cursor 1
    ]);

    const result = await streamGeneration(deps, "gen-1", 1);

    expect(result.outcome).toBe("completed");
    expect(result.state.terminal).toBe(true);
    expect(result.state.cursor).toBe(3);
    // Second resume continued from cursor 1 -> afterSeq 1.
    expect(resumeCalls.map((c) => c.afterSeq)).toEqual([0, 1]);
    expect(resumeCalls).toHaveLength(2);
  });
});

describe("streamGeneration gap recovery", () => {
  it("recovers an in-band gap via the snapshot endpoint without fabricating", async () => {
    const snapshot = [delta(1, 1), delta(2, 1), terminal(3, 1)];
    const fetchSnapshot = vi.fn(async (_id: string) => ({
      ok: true,
      status: 200,
      events: snapshot,
    }));
    const deps: RealtimeDeps = {
      resume: vi.fn(async (): Promise<ResumeResult> => ({
        disposition: "RESUMED",
        events: [delta(1), delta(3)], // gap: 3 arrives before 2
      })),
      fetchSnapshot,
    };

    const result = await streamGeneration(deps, "gen-1", 1);

    expect(result.outcome).toBe("completed");
    expect(result.state.terminal).toBe(true);
    expect(result.state.cursor).toBe(3);
    // The reducer never stored the gapped event 3; the snapshot supplied 2.
    expect(result.state.events.map((e) => e.eventSeq)).toEqual([1, 2, 3]);
    expect(fetchSnapshot).toHaveBeenCalledWith("gen-1", undefined);
  });

  it("recovers a GAP_EXPIRED disposition via the snapshot endpoint", async () => {
    const snapshot = [delta(1, 1), terminal(2, 1)];
    const { deps } = depsWith([{ disposition: "GAP_EXPIRED", events: [] }], snapshot);

    const result = await streamGeneration(deps, "gen-1", 1);

    expect(result.outcome).toBe("completed");
    expect(result.state.terminal).toBe(true);
    expect(result.state.cursor).toBe(2);
  });
});

describe("streamGeneration reset", () => {
  it("discards the draft and re-syncs to the new epoch on RESET_REQUIRED", async () => {
    const { deps, resumeCalls } = depsWith([
      { disposition: "RESET_REQUIRED", events: [], nextEpoch: 2 },
      { disposition: "RESUMED", events: [delta(1, 2), terminal(2, 2)] },
    ]);

    const result = await streamGeneration(deps, "gen-1", 1);

    expect(result.outcome).toBe("completed");
    expect(result.state.terminal).toBe(true);
    expect(result.state.epoch).toBe(2);
    expect(result.state.cursor).toBe(2);
    // The second resume used the new epoch.
    expect(resumeCalls[1].streamEpoch).toBe(2);
  });
});

describe("streamGeneration cancel", () => {
  it("reports cancelled when the handle is flipped before streaming", async () => {
    const { deps } = depsWith([
      { disposition: "RESUMED", events: [delta(1), terminal(2)] },
    ]);
    const handle = createStreamHandle();
    handle.cancelled = true;

    const result = await streamGeneration(deps, "gen-1", 1, handle);

    expect(result.outcome).toBe("cancelled");
    expect(result.state.status).toBe("cancelled");
  });

  it("passes the handle's abort signal to the transport (P2-14)", async () => {
    let signalSeen: AbortSignal | undefined;
    const resume = vi.fn(async (_req: ResumeRequest, signal?: AbortSignal): Promise<ResumeResult> => {
      signalSeen = signal;
      return { disposition: "RESUMED", events: [delta(1)] };
    });
    const deps: RealtimeDeps = {
      resume,
      fetchSnapshot: vi.fn(async () => ({ ok: true, status: 200, events: [] })),
    };
    const handle = createStreamHandle();

    await streamGeneration(deps, "gen-1", 1, handle);

    expect(signalSeen).toBe(handle.signal);
    expect(handle.signal.aborted).toBe(false);
  });
});

describe("streamGeneration failure", () => {
  it("reports not_found_or_forbidden without disclosing existence", async () => {
    const { deps } = depsWith([
      { disposition: "NOT_FOUND_OR_FORBIDDEN", events: [] },
    ]);

    const result = await streamGeneration(deps, "gen-1", 1);

    expect(result.outcome).toBe("not_found_or_forbidden");
  });

  it("surfaces a transport failure as exhausted (no fabricated success)", async () => {
    const deps: RealtimeDeps = {
      resume: vi.fn(async (): Promise<ResumeResult> => {
        throw new Error("network");
      }),
      fetchSnapshot: vi.fn(async () => ({ ok: false, status: 500, events: [] })),
    };

    const result = await streamGeneration(deps, "gen-1", 1);

    expect(result.outcome).toBe("exhausted");
    expect(result.state.terminal).toBe(false);
  });

  it("S0-20: transport failures retry with backoff until exhausted and do not invent a terminal", async () => {
    const delays: number[] = [];
    const deps: RealtimeDeps = {
      resume: vi.fn(async (): Promise<ResumeResult> => {
        throw new Error("network");
      }),
      fetchSnapshot: vi.fn(async () => ({ ok: false, status: 500, events: [] })),
    };

    const result = await streamGeneration(deps, "gen-1", 1, undefined, {
      sleep: async (ms) => {
        delays.push(ms);
      },
      random: () => 0.5,
    });

    expect(result.outcome).toBe("exhausted");
    expect(result.state.terminal).toBe(false);
    expect(deps.resume).toHaveBeenCalledTimes(MAX_RESUME_ATTEMPTS);
    expect(delays).toHaveLength(MAX_RESUME_ATTEMPTS - 1);
    expect(delays[0]).toBe(250);
  });
});

describe("streamGeneration bounded retry", () => {
  it("stops after MAX_RESUME_ATTEMPTS non-terminal empty resumes", async () => {
    const empty: ResumeResult = { disposition: "RESUMED", events: [] };
    const deps: RealtimeDeps = {
      resume: vi.fn(async (): Promise<ResumeResult> => empty),
      fetchSnapshot: vi.fn(async () => ({ ok: false, status: 500, events: [] })),
    };

    const result = await streamGeneration(deps, "gen-1", 1);

    expect(result.outcome).toBe("exhausted");
    expect(deps.resume).toHaveBeenCalledTimes(MAX_RESUME_ATTEMPTS);
  });
});

describe("streamGeneration snapshot terminality (P1-07)", () => {
  it("surfaces a failed snapshot fetch as exhausted, not completed", async () => {
    const deps: RealtimeDeps = {
      resume: vi.fn(async (): Promise<ResumeResult> => ({
        disposition: "RESUMED",
        events: [delta(1), delta(3)], // gap -> snapshot recovery
      })),
      fetchSnapshot: vi.fn(async () => ({ ok: false, status: 500, events: [] })),
    };

    const result = await streamGeneration(deps, "gen-1", 1);

    expect(result.outcome).toBe("exhausted");
    expect(result.state.terminal).toBe(false);
  });

  it("surfaces an empty snapshot as exhausted (no fake safe terminal)", async () => {
    const deps: RealtimeDeps = {
      resume: vi.fn(async (): Promise<ResumeResult> => ({
        disposition: "GAP_EXPIRED",
        events: [],
      })),
      fetchSnapshot: vi.fn(async () => ({ ok: true, status: 200, events: [] })),
    };

    const result = await streamGeneration(deps, "gen-1", 1);

    expect(result.outcome).toBe("exhausted");
    expect(result.state.terminal).toBe(false);
  });

  it("surfaces a non-terminal snapshot (no chat.completed) as exhausted", async () => {
    const deps: RealtimeDeps = {
      resume: vi.fn(async (): Promise<ResumeResult> => ({
        disposition: "TERMINAL_SNAPSHOT",
        events: [delta(1), delta(2)], // no terminal event
      })),
      fetchSnapshot: vi.fn(async () => ({ ok: true, status: 200, events: [] })),
    };

    const result = await streamGeneration(deps, "gen-1", 1);

    expect(result.outcome).toBe("exhausted");
    expect(result.state.terminal).toBe(false);
  });

  it("completes only on a snapshot containing chat.completed", async () => {
    const deps: RealtimeDeps = {
      resume: vi.fn(async (): Promise<ResumeResult> => ({
        disposition: "TERMINAL_SNAPSHOT",
        events: [delta(1), delta(2), terminal(3)],
      })),
      fetchSnapshot: vi.fn(async () => ({ ok: true, status: 200, events: [] })),
    };

    const result = await streamGeneration(deps, "gen-1", 1);

    expect(result.outcome).toBe("completed");
    expect(result.state.terminal).toBe(true);
  });
});
