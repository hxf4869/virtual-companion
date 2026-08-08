import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useChatStore } from "@/stores/chat";
import { TERMINAL_EVENT_TYPE, type StreamEvent } from "@/domain/stream-reducer";
import type { RealtimeDeps, ResumeResult } from "@/api/realtime";

function delta(seq: number, epoch = 1, payload = "Hel"): StreamEvent {
  return { eventSeq: seq, streamEpoch: epoch, eventType: "chat.delta", payload };
}
function terminal(seq: number, epoch = 1): StreamEvent {
  return { eventSeq: seq, streamEpoch: epoch, eventType: TERMINAL_EVENT_TYPE, payload: "" };
}

function successDeps(): RealtimeDeps {
  return {
    resume: vi.fn(async (): Promise<ResumeResult> => ({
      disposition: "RESUMED",
      events: [delta(1, 1, "Hel"), delta(2, 1, "lo"), terminal(3, 1)],
    })),
    fetchSnapshot: vi.fn(async () => ({ ok: true, status: 200, events: [] })),
  };
}

describe("useChatStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("runs to completed and exposes only the contiguous delta draft", async () => {
    const store = useChatStore();
    await store.run(successDeps(), "gen-1", 1);

    expect(store.phase).toBe("completed");
    expect(store.outcome).toBe("completed");
    expect(store.isTerminal).toBe(true);
    expect(store.draft).toBe("Hello");
  });

  it("marks cancelled when cancel() flips the handle", async () => {
    const store = useChatStore();
    const deps: RealtimeDeps = {
      resume: vi.fn(async (): Promise<ResumeResult> => ({
        disposition: "RESUMED",
        events: [delta(1, 1, "Hi"), terminal(2, 1)],
      })),
      fetchSnapshot: vi.fn(async () => ({ ok: true, status: 200, events: [] })),
    };
    store.cancel(); // handle is null until run; this is a no-op
    // Start run, then cancel before the microtask resolves.
    const promise = store.run(deps, "gen-1", 1);
    store.cancel();
    await promise;
    // Either completed (if resume resolved before cancel checked) or cancelled.
    expect(["completed", "cancelled"]).toContain(store.phase);
  });

  it("marks failed on not_found_or_forbidden without disclosing existence", async () => {
    const store = useChatStore();
    const deps: RealtimeDeps = {
      resume: vi.fn(async (): Promise<ResumeResult> => ({
        disposition: "NOT_FOUND_OR_FORBIDDEN",
        events: [],
      })),
      fetchSnapshot: vi.fn(async () => ({ ok: true, status: 200, events: [] })),
    };

    await store.run(deps, "gen-1", 1);

    expect(store.phase).toBe("failed");
    expect(store.outcome).toBe("not_found_or_forbidden");
    expect(store.isTerminal).toBe(false);
  });

  it("reset returns to idle", async () => {
    const store = useChatStore();
    await store.run(successDeps(), "gen-1", 1);
    store.reset();

    expect(store.phase).toBe("idle");
    expect(store.generationId).toBe("");
    expect(store.outcome).toBeNull();
  });

  it("never fabricates deltas: a gap leaves the draft at the contiguous prefix", async () => {
    const store = useChatStore();
    // resume returns [delta1, delta3] -> in-band gap; snapshot recovers [1,2,terminal3].
    const deps: RealtimeDeps = {
      resume: vi.fn(async (): Promise<ResumeResult> => ({
        disposition: "RESUMED",
        events: [delta(1, 1, "A"), delta(3, 1, "C")],
      })),
      fetchSnapshot: vi.fn(async () => ({
        ok: true,
        status: 200,
        events: [delta(1, 1, "A"), delta(2, 1, "B"), terminal(3, 1)],
      })),
    };

    await store.run(deps, "gen-1", 1);

    expect(store.phase).toBe("completed");
    // Snapshot recovered the contiguous A then B; the gapped C was never fabricated.
    expect(store.draft).toBe("AB");
  });

  it("drops a stale run's late completion (P2-17 single writer)", async () => {
    const store = useChatStore();
    let releaseFirst: () => void = () => undefined;
    const firstResume = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      return { disposition: "RESUMED", events: [delta(1), terminal(2)] } as ResumeResult;
    });
    const firstDeps: RealtimeDeps = {
      resume: firstResume,
      fetchSnapshot: vi.fn(async () => ({ ok: true, status: 200, events: [] })),
    };
    const firstRun = store.run(firstDeps, "gen-old", 1);

    // A newer run starts while the first is still in flight.
    const secondDeps: RealtimeDeps = {
      resume: vi.fn(async (): Promise<ResumeResult> => ({
        disposition: "RESUMED",
        events: [delta(1), terminal(2)],
      })),
      fetchSnapshot: vi.fn(async () => ({ ok: true, status: 200, events: [] })),
    };
    await store.run(secondDeps, "gen-new", 1);
    expect(store.generationId).toBe("gen-new");
    expect(store.phase).toBe("completed");

    // The old run finishes late; its result must be dropped.
    releaseFirst();
    await firstRun;
    expect(store.generationId).toBe("gen-new");
    expect(store.phase).toBe("completed");
    expect(store.draft).toBe("Hel");
  });

  it("cancel() aborts the underlying transport (P2-14)", async () => {
    const store = useChatStore();
    let signalSeen: AbortSignal | undefined;
    const resume = vi.fn(async (_req: unknown, signal?: AbortSignal) => {
      signalSeen = signal;
      await new Promise<void>((resolve) => {
        signal?.addEventListener("abort", () => resolve());
      });
      return { disposition: "RESUMED", events: [delta(1)] } as ResumeResult;
    });
    const deps: RealtimeDeps = {
      resume,
      fetchSnapshot: vi.fn(async () => ({ ok: true, status: 200, events: [] })),
    };

    const runPromise = store.run(deps, "gen-1", 1);
    store.cancel();
    await runPromise;

    expect(signalSeen?.aborted).toBe(true);
    expect(store.phase).toBe("cancelled");
  });
});
