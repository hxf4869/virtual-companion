import { describe, expect, it, vi } from "vitest";

import {
  confirmMemory,
  createMemoryCandidate,
  deleteMemory,
  getMemory,
  getMemoryAutoSave,
  listMemories,
  listMemoryEvidence,
  MemoryHttpError,
  rejectMemory,
  setMemoryAutoSave,
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

  it("createMemoryCandidate POSTs a RELATIONSHIP-scoped candidate (MEM-MANUAL)", async () => {
    const request = vi.fn(async (method: string, path: string, body?: unknown) => {
      expect(method).toBe("POST");
      expect(path).toBe("/api/v1/relationships/rel-1/memories/candidates");
      expect(body).toEqual({ scope: "RELATIONSHIP", summary: "我喜欢雨天" });
      return { ok: true, status: 200, json: mem("m9", "PENDING_CONFIRMATION") };
    });
    const t: MemoryTransport = { request };

    const created = await createMemoryCandidate(t, "rel-1", "我喜欢雨天");

    expect(created).not.toBeNull();
    expect(created?.memoryId).toBe("m9");
    expect(created?.status).toBe("PENDING_CONFIRMATION");
  });

  it("createMemoryCandidate is existence-hidden: non-OK -> null", async () => {
    const t = transportReturning({
      "/api/v1/relationships/rel-1/memories/candidates": { ok: false, status: 404, json: null },
    });

    expect(await createMemoryCandidate(t, "rel-1", "s")).toBeNull();
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

describe("api/memory typed error mapping (P2-16)", () => {
  function statusResponse(status: number): MemoryApiResponse {
    return { ok: false, status, json: null };
  }

  it("401 maps to a typed unauthorized error, never empty success", async () => {
    const t = transportReturning({
      "/api/v1/relationships/rel-1/memories": statusResponse(401),
    });
    const err = await listMemories(t, "rel-1").then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(MemoryHttpError);
    const httpErr = err as MemoryHttpError;
    expect(httpErr.kind).toBe("unauthorized");
    expect(httpErr.status).toBe(401);
  });

  it("5xx maps to a typed server error for every endpoint", async () => {
    const cases: Array<[string, string, string, (t: MemoryTransport) => Promise<unknown>]> = [
      ["list", "GET", "/api/v1/relationships/rel-1/memories", (t) => listMemories(t, "rel-1")],
      ["get", "GET", "/api/v1/memories/m1", (t) => getMemory(t, "m1")],
      ["confirm", "POST", "/api/v1/memories/m1/confirm", (t) => confirmMemory(t, "m1")],
      ["reject", "POST", "/api/v1/memories/m1/reject", (t) => rejectMemory(t, "m1")],
      ["update", "PATCH", "/api/v1/memories/m1", (t) => updateMemory(t, "m1", "s")],
      ["evidence", "GET", "/api/v1/memories/m1/evidence", (t) => listMemoryEvidence(t, "m1")],
      ["delete", "DELETE", "/api/v1/memories/m1", (t) => deleteMemory(t, "m1")],
    ];
    for (const [name, , path, call] of cases) {
      const t = transportReturning({ [path]: statusResponse(503) });
      const err = await call(t).then(() => null, (e: unknown) => e);
      expect(err, name).toBeInstanceOf(MemoryHttpError);
      expect((err as MemoryHttpError).kind, name).toBe("server");
    }
  });

  it("other 4xx (400/409/422) map to a typed client error, not empty success", async () => {
    const t = transportReturning({
      "/api/v1/memories/m1/confirm": statusResponse(409),
    });
    const err = await confirmMemory(t, "m1").then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(MemoryHttpError);
    expect((err as MemoryHttpError).kind).toBe("client");
    expect((err as MemoryHttpError).status).toBe(409);
  });

  it("403 hides existence exactly like 404 (no throw, no disclosure)", async () => {
    const forbidden = transportReturning({
      "/api/v1/relationships/rel-1/memories": statusResponse(403),
      "/api/v1/memories/m1": statusResponse(403),
      "/api/v1/memories/m1/confirm": statusResponse(403),
      "/api/v1/memories/m1/evidence": statusResponse(403),
    });
    expect(await listMemories(forbidden, "rel-1")).toEqual([]);
    expect(await getMemory(forbidden, "m1")).toBeNull();
    expect(await confirmMemory(forbidden, "m1")).toBeNull();
    expect(await deleteMemory(forbidden, "m1")).toBe(false);
    expect(await listMemoryEvidence(forbidden, "m1")).toEqual([]);
  });

  it("an OK response whose body failed to parse maps to a typed parse error", async () => {
    const t = transportReturning({
      "/api/v1/relationships/rel-1/memories": {
        ok: true,
        status: 200,
        json: null,
        parseFailed: true,
      },
    });
    const err = await listMemories(t, "rel-1").then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(MemoryHttpError);
    expect((err as MemoryHttpError).kind).toBe("parse");
  });

  it("listMemories requests includeDeleted and parses deletedAt", async () => {
    let seenPath = "";
    const t: MemoryTransport = {
      request: vi.fn(async (_method: string, path: string): Promise<MemoryApiResponse> => {
        seenPath = path;
        return {
          ok: true,
          status: 200,
          json: [
            {
              memoryId: "m-del",
              scope: "RELATIONSHIP",
              summary: "已删",
              status: "ACCEPTED",
              deletedAt: "2026-08-18T12:00:00Z",
            },
          ],
        };
      }),
    };
    const list = await listMemories(t, "rel-1", { includeDeleted: true });
    expect(seenPath).toBe("/api/v1/relationships/rel-1/memories?includeDeleted=true");
    expect(list).toEqual([
      {
        memoryId: "m-del",
        scope: "RELATIONSHIP",
        summary: "已删",
        status: "ACCEPTED",
        deletedAt: "2026-08-18T12:00:00Z",
        autoSaved: false,
      },
    ]);
  });

  it("listMemories URL-encodes the relationshipId (P3-03)", async () => {
    let seenPath = "";
    const t: MemoryTransport = {
      request: vi.fn(async (_method: string, path: string): Promise<MemoryApiResponse> => {
        seenPath = path;
        return { ok: true, status: 200, json: [] };
      }),
    };
    await listMemories(t, "rel a/b?c#d&e");
    expect(seenPath).toBe("/api/v1/relationships/rel%20a%2Fb%3Fc%23d%26e/memories");
  });

  it("MEM-AUTO-SAVE: parses the autoSaved flag on listed memories", async () => {
    const t = transportReturning({
      "/api/v1/relationships/rel-1/memories": {
        ok: true,
        status: 200,
        json: [
          mem("auto-1", "ACCEPTED", "RELATIONSHIP", "称呼偏好：小雪"),
          mem("manual-1", "ACCEPTED"),
        ].map((item, i) => ({ ...(item as Record<string, unknown>), autoSaved: i === 0 })),
      },
    });
    const rows = await listMemories(t, "rel-1");
    expect(rows[0]?.autoSaved).toBe(true);
    expect(rows[1]?.autoSaved).toBe(false);
  });

  it("MEM-AUTO-SAVE: get/set round the auto-save switch (V66)", async () => {
    const get = transportReturning({
      "/api/v1/memories/auto-save": { ok: true, status: 200, json: { enabled: true } },
    });
    expect(await getMemoryAutoSave(get)).toBe(true);

    let seenBody: unknown;
    const put: MemoryTransport = {
      request: vi.fn(async (_method: string, _path: string, body?: unknown) => {
        seenBody = body;
        return { ok: true, status: 200, json: { enabled: false } };
      }),
    };
    expect(await setMemoryAutoSave(put, false)).toBe(true);
    expect(seenBody).toEqual({ enabled: false });
  });

  it("MEM-AUTO-SAVE: a failed switch read throws the typed error", async () => {
    await expect(getMemoryAutoSave(throwingTransport())).rejects.toThrow(Error);
    const failed = transportReturning({
      "/api/v1/memories/auto-save": { ok: false, status: 500, json: null },
    });
    await expect(getMemoryAutoSave(failed)).rejects.toThrow(MemoryHttpError);
  });
});
