import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Memory, MemoryApiResponse, MemoryTransport } from "@/api/memory";
import { useMemoryStore } from "@/stores/memory";

function memory(id: string, status: Memory["status"], summary = "s"): Memory {
  return { memoryId: id, scope: "RELATIONSHIP", summary, status };
}

/** A transport whose request() is a vi.fn returning path-keyed responses. */
function keyedTransport(responses: Record<string, MemoryApiResponse>): MemoryTransport {
  return {
    request: vi.fn(async (_method: string, path: string, _body?: unknown): Promise<MemoryApiResponse> => {
      const r = responses[path];
      if (!r) throw new Error(`unexpected ${path}`);
      return r;
    }),
  };
}

function ok(path: string, json: unknown): [string, MemoryApiResponse] {
  return [path, { ok: true, status: 200, json }];
}
function notOk(path: string, status = 404): [string, MemoryApiResponse] {
  return [path, { ok: false, status, json: null }];
}
function throwingTransport(): MemoryTransport {
  return { request: vi.fn(async () => { throw new Error("network down"); }) };
}

describe("useMemoryStore partition + no-fake-success", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  async function seed(store: ReturnType<typeof useMemoryStore>): Promise<void> {
    const t = keyedTransport({
      ...Object.fromEntries([ok(
        "/api/v1/relationships/rel-1/memories",
        [
          memory("pend-1", "PENDING_CONFIRMATION", "candidate"),
          memory("acc-1", "ACCEPTED", "canonical"),
          memory("rej-1", "REJECTED", "rejected"),
        ],
      )]),
    });
    await store.load(t, "rel-1");
  }

  it("load partitions pending and canonical by status; pending never appears in canonical", async () => {
    const store = useMemoryStore();
    await seed(store);

    expect(store.pending.map((m) => m.memoryId)).toEqual(["pend-1"]);
    expect(store.canonical.map((m) => m.memoryId)).toEqual(["acc-1"]);
    // A rejected/expired memory is neither pending-candidate nor canonical-fact.
    expect(store.pending.some((m) => m.status === "ACCEPTED")).toBe(false);
    expect(store.canonical.some((m) => m.status === "PENDING_CONFIRMATION")).toBe(false);
  });

  it("confirm moves a pending candidate to canonical ONLY on confirmed ACCEPTED", async () => {
    const store = useMemoryStore();
    await seed(store);

    const t = keyedTransport({
      ...Object.fromEntries([ok("/api/v1/memories/pend-1/confirm", memory("pend-1", "ACCEPTED", "candidate"))]),
    });
    await store.confirm(t, "pend-1");

    expect(store.pending.map((m) => m.memoryId)).toEqual([]);
    expect(store.canonical.map((m) => m.memoryId).sort()).toEqual(["acc-1", "pend-1"]);
    expect(store.error).toBeNull();
  });

  it("confirm not-confirmed (non-OK) preserves the candidate and records an error (no fake)", async () => {
    const store = useMemoryStore();
    await seed(store);

    const t = keyedTransport({
      ...Object.fromEntries([notOk("/api/v1/memories/pend-1/confirm")]),
    });
    await store.confirm(t, "pend-1");

    // Pending is unchanged; canonical did not gain the candidate; error surfaced.
    expect(store.pending.map((m) => m.memoryId)).toEqual(["pend-1"]);
    expect(store.canonical.map((m) => m.memoryId)).toEqual(["acc-1"]);
    expect(store.error).toBe("confirm-not-confirmed");
  });

  it("confirm transport failure preserves the candidate and records an error", async () => {
    const store = useMemoryStore();
    await seed(store);
    await store.confirm(throwingTransport(), "pend-1");

    expect(store.pending.map((m) => m.memoryId)).toEqual(["pend-1"]);
    expect(store.canonical.map((m) => m.memoryId)).toEqual(["acc-1"]);
    expect(store.error).toBe("confirm-failed");
  });

  it("remove deletes ONLY on confirmed ok=true", async () => {
    const store = useMemoryStore();
    await seed(store);

    const t = keyedTransport({
      ...Object.fromEntries([ok("/api/v1/memories/acc-1", memory("acc-1", "ACCEPTED"))]),
    });
    await store.remove(t, "acc-1");

    expect(store.canonical.map((m) => m.memoryId)).toEqual([]);
    expect(store.error).toBeNull();
  });

  it("remove not-confirmed (false) PRESERVES the memory and does not fake success", async () => {
    const store = useMemoryStore();
    await seed(store);

    const t = keyedTransport({
      ...Object.fromEntries([notOk("/api/v1/memories/acc-1")]),
    });
    await store.remove(t, "acc-1");

    // Memory is still present; an error is surfaced, not a fake deletion.
    expect(store.canonical.map((m) => m.memoryId)).toEqual(["acc-1"]);
    expect(store.error).toBe("delete-not-confirmed");
  });

  it("remove transport failure PRESERVES the memory and surfaces delete-failed", async () => {
    const store = useMemoryStore();
    await seed(store);
    await store.remove(throwingTransport(), "acc-1");

    expect(store.canonical.map((m) => m.memoryId)).toEqual(["acc-1"]);
    expect(store.error).toBe("delete-failed");
  });

  it("update changes the visible summary ONLY on confirmed success", async () => {
    const store = useMemoryStore();
    await seed(store);

    const okT = keyedTransport({
      ...Object.fromEntries([ok("/api/v1/memories/acc-1", memory("acc-1", "ACCEPTED", "edited"))]),
    });
    await store.update(okT, "acc-1", "edited");
    expect(store.canonical.find((m) => m.memoryId === "acc-1")?.summary).toBe("edited");
    expect(store.error).toBeNull();

    const failT = keyedTransport({
      ...Object.fromEntries([notOk("/api/v1/memories/acc-1")]),
    });
    await store.update(failT, "acc-1", "should-not-apply");
    // Summary unchanged on failure; error surfaced.
    expect(store.canonical.find((m) => m.memoryId === "acc-1")?.summary).toBe("edited");
    expect(store.error).toBe("update-not-confirmed");
  });

  it("reject drops a pending candidate ONLY on confirmed success", async () => {
    const store = useMemoryStore();
    await seed(store);

    const okT = keyedTransport({
      ...Object.fromEntries([ok("/api/v1/memories/pend-1/reject", memory("pend-1", "REJECTED"))]),
    });
    await store.reject(okT, "pend-1");
    expect(store.pending.map((m) => m.memoryId)).toEqual([]);
    expect(store.error).toBeNull();

    // Remaining candidate not-confirmed: preserved.
    const store2 = useMemoryStore();
    await seed(store2);
    const failT = keyedTransport({
      ...Object.fromEntries([notOk("/api/v1/memories/pend-1/reject")]),
    });
    await store2.reject(failT, "pend-1");
    expect(store2.pending.map((m) => m.memoryId)).toEqual(["pend-1"]);
    expect(store2.error).toBe("reject-not-confirmed");
  });

  it("reset clears all state", async () => {
    const store = useMemoryStore();
    await seed(store);
    store.reset();
    expect(store.pending).toEqual([]);
    expect(store.canonical).toEqual([]);
    expect(store.error).toBeNull();
  });
});
