import { describe, expect, it, vi } from "vitest";

import {
  classifyMemoryWriteError,
  confirmMemory,
  deleteMemory,
  getMemoryAutoSavePref,
  listMemoriesChecked,
  listMemoryEvidence,
  MemoryHttpError,
  MemoryProtocolError,
  rejectMemory,
  updateMemory,
  updateMemoryAutoSavePref,
  type MemoryTransport,
} from "./memory";
import { TransportTimeoutError } from "./transport";

function transport(
  response: { ok: boolean; status: number; json: unknown; parseFailed?: boolean },
): MemoryTransport {
  return { request: vi.fn(async () => response) };
}

function memoryRow(overrides: Record<string, unknown> = {}) {
  return {
    memoryId: "m1",
    scope: "FACT",
    summary: "用户喜欢在晚上散步。",
    status: "ACCEPTED",
    conversationId: 7,
    createdAt: "2026-09-01T10:00:00Z",
    autoSaved: true,
    ...overrides,
  };
}

const READ_OPTS = { timeoutMs: 15_000 };

describe("listMemoriesChecked", () => {
  it("fetches the relationship memory list with bounded timeout", async () => {
    const client = transport({ ok: true, status: 200, json: [memoryRow()] });

    await expect(listMemoriesChecked(client, "42")).resolves.toEqual({
      items: [{
        memoryId: "m1",
        scope: "FACT",
        summary: "用户喜欢在晚上散步。",
        status: "ACCEPTED",
        conversationId: "7",
        createdAt: "2026-09-01T10:00:00Z",
        deletedAt: undefined,
        autoSaved: true,
        supersededAt: undefined,
        supersededByMemoryId: undefined,
        eventAt: undefined,
        eventStatus: undefined,
        eventExpiresAt: undefined,
      }],
      existenceHidden: false,
    });
    expect(client.request).toHaveBeenCalledWith(
      "GET",
      "/api/v1/relationships/42/memories",
      undefined,
      READ_OPTS,
    );
  });

  it("hides 403/404 as an empty list and rejects other failures", async () => {
    await expect(listMemoriesChecked(transport({ ok: false, status: 404, json: null }), "42"))
      .resolves.toEqual({ items: [], existenceHidden: true });
    await expect(listMemoriesChecked(transport({ ok: false, status: 500, json: null }), "42"))
      .rejects.toBeInstanceOf(MemoryHttpError);
  });

  it("treats an unreadable read body as a protocol error", async () => {
    await expect(listMemoriesChecked(
      transport({ ok: true, status: 200, json: null, parseFailed: true }),
      "42",
    )).rejects.toBeInstanceOf(MemoryProtocolError);
  });

  it("skips rows without a known status", async () => {
    const result = await listMemoriesChecked(transport({
      ok: true,
      status: 200,
      json: [memoryRow(), memoryRow({ memoryId: "m2", status: "WEIRD" })],
    }), "42");
    expect(result.existenceHidden).toBe(false);
    expect(result.items).toHaveLength(1);
  });

  it("keeps existence-hiding information so empty results are not trusted blindly", async () => {
    await expect(listMemoriesChecked(transport({ ok: false, status: 404, json: null }), "42"))
      .resolves.toEqual({ items: [], existenceHidden: true });
    await expect(listMemoriesChecked(transport({ ok: false, status: 403, json: null }), "42"))
      .resolves.toEqual({ items: [], existenceHidden: true });
    await expect(listMemoriesChecked(transport({ ok: true, status: 200, json: [] }), "42"))
      .resolves.toEqual({ items: [], existenceHidden: false });
  });
});

describe("classifyMemoryWriteError", () => {
  it("classifies 4xx rejections as definite and everything else as unknown", () => {
    expect(classifyMemoryWriteError(new MemoryHttpError(400, "client"))).toBe("rejected");
    expect(classifyMemoryWriteError(new MemoryHttpError(401, "unauthorized"))).toBe("rejected");
    expect(classifyMemoryWriteError(new MemoryHttpError(409, "client"))).toBe("rejected");
    expect(classifyMemoryWriteError(new MemoryHttpError(500, "server"))).toBe("unknown");
    expect(classifyMemoryWriteError(new MemoryHttpError(503, "server"))).toBe("unknown");
    expect(classifyMemoryWriteError(new MemoryProtocolError(200))).toBe("unknown");
    expect(classifyMemoryWriteError(new TransportTimeoutError(15_000))).toBe("unknown");
    // 普通网络异常（fetch TypeError）：无法证明请求未发送或未落库。
    expect(classifyMemoryWriteError(new TypeError("Failed to fetch"))).toBe("unknown");
  });
});

describe("single-memory writes", () => {
  it("updates the summary through PATCH", async () => {
    const client = transport({ ok: true, status: 200, json: memoryRow({ summary: "改过的内容" }) });

    await expect(updateMemory(client, "m1", "改过的内容")).resolves.toMatchObject({
      memoryId: "m1",
      summary: "改过的内容",
    });
    expect(client.request).toHaveBeenCalledWith(
      "PATCH",
      "/api/v1/memories/m1",
      { summary: "改过的内容" },
      READ_OPTS,
    );
  });

  it("treats a 2xx unreadable write response as an unknown outcome", async () => {
    const client = transport({ ok: true, status: 200, json: null, parseFailed: true });
    await expect(updateMemory(client, "m1", "x")).rejects.toBeInstanceOf(MemoryProtocolError);
    await expect(deleteMemory(client, "m1")).rejects.toBeInstanceOf(MemoryProtocolError);
    await expect(confirmMemory(client, "m1")).rejects.toBeInstanceOf(MemoryProtocolError);
    await expect(rejectMemory(client, "m1")).rejects.toBeInstanceOf(MemoryProtocolError);
  });

  it("confirms and reject post to their dedicated endpoints with no body", async () => {
    const client = transport({ ok: true, status: 200, json: memoryRow({ status: "ACCEPTED" }) });
    await confirmMemory(client, "m1");
    expect(client.request).toHaveBeenCalledWith(
      "POST",
      "/api/v1/memories/m1/confirm",
      undefined,
      READ_OPTS,
    );

    const rejectClient = transport({ ok: true, status: 200, json: memoryRow({ status: "REJECTED" }) });
    await rejectMemory(rejectClient, "m1");
    expect(rejectClient.request).toHaveBeenCalledWith(
      "POST",
      "/api/v1/memories/m1/reject",
      undefined,
      READ_OPTS,
    );
  });

  it("keeps http failures on writes as definite errors", async () => {
    const client = transport({ ok: false, status: 409, json: { code: "CONFLICT" } });
    await expect(updateMemory(client, "m1", "x")).rejects.toMatchObject({ kind: "client" });
  });
});

describe("deleteMemory", () => {
  it("reports existence-hidden 403/404 as unavailable instead of deleted", async () => {
    await expect(deleteMemory(transport({ ok: false, status: 403, json: null }), "m1"))
      .resolves.toEqual({ kind: "unavailable" });
    await expect(deleteMemory(transport({ ok: false, status: 404, json: null }), "m1"))
      .resolves.toEqual({ kind: "unavailable" });
  });

  it("treats a 2xx body without a memory item as an unknown outcome", async () => {
    await expect(deleteMemory(transport({ ok: true, status: 200, json: { weird: true } }), "m1"))
      .rejects.toBeInstanceOf(MemoryProtocolError);
  });

  it("returns the deleted item on confirmed success", async () => {
    const client = transport({
      ok: true,
      status: 200,
      json: memoryRow({ deletedAt: "2026-09-04T00:00:00Z" }),
    });
    await expect(deleteMemory(client, "m1")).resolves.toEqual({
      kind: "deleted",
      item: expect.objectContaining({ memoryId: "m1" }),
    });
  });
});

describe("listMemoryEvidence", () => {
  it("lists evidence source refs", async () => {
    const client = transport({
      ok: true,
      status: 200,
      json: [{ evidenceId: "e1", sourceRef: "message:12", createdAt: "2026-09-01T10:00:00Z" }],
    });
    await expect(listMemoryEvidence(client, "m1")).resolves.toEqual([{
      evidenceId: "e1",
      sourceRef: "message:12",
      createdAt: "2026-09-01T10:00:00Z",
    }]);
    expect(client.request).toHaveBeenCalledWith(
      "GET",
      "/api/v1/memories/m1/evidence",
      undefined,
      READ_OPTS,
    );
  });
});

describe("auto-save preference", () => {
  it("reads the enabled flag from the pref envelope", async () => {
    const client = transport({ ok: true, status: 200, json: { enabled: true } });
    await expect(getMemoryAutoSavePref(client)).resolves.toBe(true);
    expect(client.request).toHaveBeenCalledWith(
      "GET",
      "/api/v1/memory-auto-save-pref",
      undefined,
      READ_OPTS,
    );
  });

  it("puts the new value and echoes the server response", async () => {
    const client = transport({ ok: true, status: 200, json: { enabled: false } });
    await expect(updateMemoryAutoSavePref(client, false)).resolves.toBe(false);
    expect(client.request).toHaveBeenCalledWith(
      "PUT",
      "/api/v1/memory-auto-save-pref",
      { enabled: false },
      READ_OPTS,
    );
  });

  it("treats unreadable pref writes as unknown outcome", async () => {
    const client = transport({ ok: true, status: 200, json: null, parseFailed: true });
    await expect(updateMemoryAutoSavePref(client, true)).rejects.toBeInstanceOf(MemoryProtocolError);
    await expect(getMemoryAutoSavePref(client)).rejects.toBeInstanceOf(MemoryProtocolError);
  });
});
