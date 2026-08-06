import { describe, expect, it, vi } from "vitest";

import {
  confirmMemory,
  deleteMemory,
  getMemory,
  listMemories,
  listMemoryEvidence,
  rejectMemory,
  updateMemory,
  type MemoryApiResponse,
  type MemoryTransport,
} from "@/api/memory";

function transportReturning(responsesByPath: Record<string, MemoryApiResponse>): MemoryTransport {
  return {
    request: vi.fn(async (method: string, path: string, _body?: unknown): Promise<MemoryApiResponse> => {
      const r = responsesByPath[path];
      if (!r) {
        throw new Error(`unexpected request ${method} ${path}`);
      }
      return r;
    }),
  };
}

function throwingTransport(): MemoryTransport {
  return {
    request: vi.fn(async (): Promise<MemoryApiResponse> => {
      throw new Error("network down");
    }),
  };
}

function mem(id: string, status: string, scope = "RELATIONSHIP", summary = "s"): unknown {
  return { memoryId: id, scope, summary, status };
}

describe("api/memory existence-hidden mapping", () => {
  it("listMemories returns typed memories on OK", async () => {
    const t = transportReturning({
      "/api/v1/relationships/rel-1/memories": {
        ok: true,
        status: 200,
        json: [mem("m1", "PENDING_CONFIRMATION"), mem("m2", "ACCEPTED")],
      },
    });
    const list = await listMemories(t, "rel-1");
    expect(list).toHaveLength(2);
    expect(list[0].memoryId).toBe("m1");
    expect(list[0].status).toBe("PENDING_CONFIRMATION");
    expect(list[1].status).toBe("ACCEPTED");
  });

  it("listMemories is existence-hidden: non-OK -> [] (never throws)", async () => {
    const t = transportReturning({
      "/api/v1/relationships/rel-1/memories": { ok: false, status: 404, json: null },
    });
    const list = await listMemories(t, "rel-1");
    expect(list).toEqual([]);
  });

  it("listMemories filters malformed items (defensive parse)", async () => {
    const t = transportReturning({
      "/api/v1/relationships/rel-1/memories": {
        ok: true,
        status: 200,
        json: [mem("ok", "ACCEPTED"), { memoryId: "no-status" }, null, "junk"],
      },
    });
    const list = await listMemories(t, "rel-1");
    expect(list.map((m) => m.memoryId)).toEqual(["ok"]);
  });

  it("getMemory returns the memory on OK, null on non-OK", async () => {
    const ok = transportReturning({ "/api/v1/memories/m1": { ok: true, status: 200, json: mem("m1", "ACCEPTED") } });
    const notFound = transportReturning({ "/api/v1/memories/m1": { ok: false, status: 404, json: null } });
    expect((await getMemory(ok, "m1"))?.memoryId).toBe("m1");
    expect(await getMemory(notFound, "m1")).toBeNull();
  });

  it("confirm/reject/update return the memory on OK, null on non-OK", async () => {
    const confirmT = transportReturning({ "/api/v1/memories/m1/confirm": { ok: true, status: 200, json: mem("m1", "ACCEPTED") } });
    const rejectT = transportReturning({ "/api/v1/memories/m1/reject": { ok: true, status: 200, json: mem("m1", "REJECTED") } });
    const updateT = transportReturning({ "/api/v1/memories/m1": { ok: true, status: 200, json: mem("m1", "ACCEPTED", "RELATIONSHIP", "edited") } });
    const failT = transportReturning({ "/api/v1/memories/m1/confirm": { ok: false, status: 404, json: null } });

    expect((await confirmMemory(confirmT, "m1"))?.status).toBe("ACCEPTED");
    expect((await rejectMemory(rejectT, "m1"))?.status).toBe("REJECTED");
    expect((await updateMemory(updateT, "m1", "edited"))?.summary).toBe("edited");
    expect(await confirmMemory(failT, "m1")).toBeNull();
  });

  it("updateMemory sends the summary in the request body", async () => {
    let sentBody: unknown = undefined;
    const t: MemoryTransport = {
      request: vi.fn(async (_m: string, _p: string, body?: unknown) => {
        sentBody = body;
        return { ok: true, status: 200, json: mem("m1", "ACCEPTED") };
      }),
    };
    await updateMemory(t, "m1", "new summary");
    expect(sentBody).toEqual({ summary: "new summary" });
  });

  it("deleteMemory returns true on OK (incl. idempotent already-deleted), false on non-OK", async () => {
    const okT = transportReturning({ "/api/v1/memories/m1": { ok: true, status: 200, json: mem("m1", "ACCEPTED") } });
    const notOkT = transportReturning({ "/api/v1/memories/m1": { ok: false, status: 404, json: null } });
    expect(await deleteMemory(okT, "m1")).toBe(true);
    expect(await deleteMemory(notOkT, "m1")).toBe(false);
  });

  it("listMemoryEvidence returns sources on OK, [] on non-OK", async () => {
    const okT = transportReturning({
      "/api/v1/memories/m1/evidence": {
        ok: true,
        status: 200,
        json: [{ evidenceId: "e1", sourceRef: "src-1" }, { evidenceId: "e2", sourceRef: "src-2" }],
      },
    });
    const notOkT = transportReturning({ "/api/v1/memories/m1/evidence": { ok: false, status: 404, json: null } });
    expect((await listMemoryEvidence(okT, "m1")).map((e) => e.sourceRef)).toEqual(["src-1", "src-2"]);
    expect(await listMemoryEvidence(notOkT, "m1")).toEqual([]);
  });
});

describe("api/memory transport failure propagation", () => {
  it("propagates a transport error so the store can surface failure (no swallow)", async () => {
    const t = throwingTransport();
    await expect(listMemories(t, "rel-1")).rejects.toThrow("network down");
    await expect(getMemory(t, "m1")).rejects.toThrow("network down");
    await expect(confirmMemory(t, "m1")).rejects.toThrow("network down");
    await expect(deleteMemory(t, "m1")).rejects.toThrow("network down");
    await expect(listMemoryEvidence(t, "m1")).rejects.toThrow("network down");
  });
});
