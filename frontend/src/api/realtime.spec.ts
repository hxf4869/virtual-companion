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
    fetchSnapshot: vi.fn(async (_id: string) => snapshot),
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
});

describe("streamGeneration disconnect then resume", () => {
  it("resumes from the last cursor after a non-terminal disconnect", async () => {
    const { deps, resumeCalls } = depsWith([
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
    const fetchSnapshot = vi.fn(async (_id: string) => snapshot);
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
    expect(fetchSnapshot).toHaveBeenCalledWith("gen-1");
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
      fetchSnapshot: vi.fn(async () => []),
    };

    const result = await streamGeneration(deps, "gen-1", 1);

    expect(result.outcome).toBe("exhausted");
    expect(result.state.terminal).toBe(false);
  });
});

describe("streamGeneration bounded retry", () => {
  it("stops after MAX_RESUME_ATTEMPTS non-terminal empty resumes", async () => {
    const empty: ResumeResult = { disposition: "RESUMED", events: [] };
    const deps: RealtimeDeps = {
      resume: vi.fn(async (): Promise<ResumeResult> => empty),
      fetchSnapshot: vi.fn(async () => []),
    };

    const result = await streamGeneration(deps, "gen-1", 1);

    expect(result.outcome).toBe("exhausted");
    expect(deps.resume).toHaveBeenCalledTimes(MAX_RESUME_ATTEMPTS);
  });
});
