import { describe, expect, it, vi } from "vitest";

import {
  classifyDataExportCreateError,
  createDataExport,
  DataExportHttpError,
  DataExportProtocolError,
  downloadDataExport,
  getDataExportStatus,
  recoverDataExport,
  type DataExportHttpErrorKind,
  type DataExportTransport,
} from "./data-export";
import { TransportTimeoutError } from "./transport";

const READ_OPTS = { timeoutMs: 15_000 };

function transport(
  response: { ok: boolean; status: number; json: unknown; parseFailed?: boolean },
): DataExportTransport {
  return { request: vi.fn(async () => response) };
}

function exportRow(overrides: Record<string, unknown> = {}) {
  return {
    exportId: "e1",
    status: "PENDING",
    requestedAt: "2026-10-21T10:00:00Z",
    ...overrides,
  };
}

function downloadResponse(status: number, blob: Blob): Response {
  const ok = status >= 200 && status < 300;
  // 失败响应同样携带 JSON 错误信封（VC-R52 起下载路径读取它做精确分类）。
  return {
    ok,
    status,
    blob: async () => blob,
    json: async () => ({ code: ok ? "OK" : "NOT_FOUND_OR_FORBIDDEN" }),
  } as unknown as Response;
}

async function expectHttpError(
  promise: Promise<unknown>,
  status: number,
  kind: DataExportHttpErrorKind,
): Promise<void> {
  const caught = await promise.then(
    () => {
      throw new Error("expected the request to fail");
    },
    (error: unknown) => error,
  );
  expect(caught).toBeInstanceOf(DataExportHttpError);
  expect(caught).toMatchObject({ status, kind });
}

// 原始字节保真回归（Owner 指定）：直接书写的 JSON 文本字面量，内含超过
// Number.MAX_SAFE_INTEGER 的 int64 ID。严禁改用 JS 对象/数字构造再
// stringify——那一步本身就会丢精度，回归就失效了。
const RAW_EXPORT_JSON =
  `{"conversationId":9007199254740995,"messages":[{"messageId":9007199254740993,"text":"晚上好"}],` +
  `"memories":[{"memoryId":9007199254740997,"summary":"喜欢晚上散步"}]}`;

describe("createDataExport", () => {
  it("posts the current password and returns the one-time download URL", async () => {
    const client = transport({
      ok: true,
      status: 200,
      json: exportRow({
        downloadUrl: "/api/v1/exports/e1/download",
        expiresAt: "2026-10-28T10:00:00Z",
        errorMessage: "INTERNAL_ERROR_CODE",
      }),
    });

    await expect(createDataExport(client, "hunter2")).resolves.toEqual({
      exportId: "e1",
      status: "PENDING",
      requestedAt: "2026-10-21T10:00:00Z",
      completedAt: undefined,
      expiresAt: "2026-10-28T10:00:00Z",
      downloadUrl: "/api/v1/exports/e1/download",
    });
    expect(client.request).toHaveBeenCalledWith(
      "POST",
      "/api/v1/exports",
      { currentPassword: "hunter2" },
      READ_OPTS,
    );
  });

  it("maps failure statuses onto error kinds without echoing the body", async () => {
    const cases: Array<[number, DataExportHttpErrorKind]> = [
      [404, "client"],
      [400, "client"],
      [401, "unauthorized"],
      [503, "server"],
    ];
    for (const [status, kind] of cases) {
      await expectHttpError(
        createDataExport(
          transport({ ok: false, status, json: { errorMessage: "SECRET_CODE" } }),
          "p",
        ),
        status,
        kind,
      );
    }
    await expect(
      createDataExport(transport({ ok: false, status: 404, json: { errorMessage: "SECRET_CODE" } }), "p"),
    ).rejects.toThrow("data export request failed with status 404 (client)");
  });

  it("treats unreadable or bad 2xx bodies as protocol errors (unknown outcome)", async () => {
    await expect(createDataExport(
      transport({ ok: true, status: 200, json: null, parseFailed: true }),
      "p",
    )).rejects.toBeInstanceOf(DataExportProtocolError);
    // 缺 downloadUrl。
    await expect(createDataExport(transport({ ok: true, status: 200, json: exportRow() }), "p"))
      .rejects.toBeInstanceOf(DataExportProtocolError);
    // 空 downloadUrl。
    await expect(createDataExport(
      transport({ ok: true, status: 200, json: exportRow({ downloadUrl: "" }) }),
      "p",
    )).rejects.toBeInstanceOf(DataExportProtocolError);
    // 未知状态枚举。
    await expect(createDataExport(
      transport({ ok: true, status: 200, json: exportRow({ status: "COOKING", downloadUrl: "/d" }) }),
      "p",
    )).rejects.toBeInstanceOf(DataExportProtocolError);
    // ID 不是 string。
    await expect(createDataExport(
      transport({ ok: true, status: 200, json: exportRow({ exportId: 7, downloadUrl: "/d" }) }),
      "p",
    )).rejects.toBeInstanceOf(DataExportProtocolError);
  });

  it("lets transport timeouts and network errors propagate unchanged", async () => {
    const timeout = new TransportTimeoutError(15_000);
    await expect(createDataExport({ request: () => Promise.reject(timeout) }, "p"))
      .rejects.toBe(timeout);
    const networkError = new TypeError("Failed to fetch");
    await expect(createDataExport({ request: () => Promise.reject(networkError) }, "p"))
      .rejects.toBe(networkError);
  });
});

describe("recoverDataExport", () => {
  it("posts the password to the recover endpoint with the bounded timeout and accepts READY views", async () => {
    const client = transport({
      ok: true,
      status: 200,
      json: exportRow({
        status: "READY",
        completedAt: "2026-10-21T10:05:00Z",
        downloadUrl: "/api/v1/exports/e1/download",
        errorMessage: "SECRET_CODE",
      }),
    });

    await expect(recoverDataExport(client, "hunter2")).resolves.toEqual({
      exportId: "e1",
      status: "READY",
      requestedAt: "2026-10-21T10:00:00Z",
      completedAt: "2026-10-21T10:05:00Z",
      expiresAt: undefined,
      downloadUrl: "/api/v1/exports/e1/download",
    });
    expect(client.request).toHaveBeenCalledWith(
      "POST",
      "/api/v1/exports/recover",
      { currentPassword: "hunter2" },
      READ_OPTS,
    );
  });

  it("keeps create's error semantics: 404 is a definite client rejection and 5xx is server", async () => {
    // 404 合并覆盖错密码/没有可取回/删除中，调用方只拿到确定的 client 拒绝。
    await expectHttpError(
      recoverDataExport(transport({ ok: false, status: 404, json: null }), "p"),
      404,
      "client",
    );
    await expectHttpError(
      recoverDataExport(transport({ ok: false, status: 401, json: null }), "p"),
      401,
      "unauthorized",
    );
    await expectHttpError(
      recoverDataExport(transport({ ok: false, status: 503, json: null }), "p"),
      503,
      "server",
    );
  });

  it("treats bad 2xx bodies as protocol errors and lets transport errors through", async () => {
    await expect(recoverDataExport(
      transport({ ok: true, status: 200, json: exportRow() }),
      "p",
    )).rejects.toBeInstanceOf(DataExportProtocolError);
    const timeout = new TransportTimeoutError(15_000);
    await expect(recoverDataExport({ request: () => Promise.reject(timeout) }, "p"))
      .rejects.toBe(timeout);
  });
});

describe("getDataExportStatus", () => {
  it("reads the status view without ever surfacing a download URL", async () => {
    const client = transport({
      ok: true,
      status: 200,
      json: exportRow({
        exportId: "e/1",
        status: "READY",
        completedAt: "2026-10-21T10:05:00Z",
        downloadUrl: "/must-not-appear",
        errorMessage: "SECRET_CODE",
      }),
    });

    const view = await getDataExportStatus(client, "e/1");
    expect(view).toEqual({
      exportId: "e/1",
      status: "READY",
      requestedAt: "2026-10-21T10:00:00Z",
      completedAt: "2026-10-21T10:05:00Z",
      expiresAt: undefined,
    });
    expect(view).not.toHaveProperty("downloadUrl");
    expect(client.request).toHaveBeenCalledWith(
      "GET",
      "/api/v1/exports/e%2F1",
      undefined,
      READ_OPTS,
    );
  });

  it("maps 404 to client and 5xx to server, and rejects bad shapes", async () => {
    await expectHttpError(
      getDataExportStatus(transport({ ok: false, status: 404, json: null }), "e1"),
      404,
      "client",
    );
    await expectHttpError(
      getDataExportStatus(transport({ ok: false, status: 500, json: null }), "e1"),
      500,
      "server",
    );
    await expect(getDataExportStatus(transport({ ok: true, status: 200, json: { status: "PENDING" } }), "e1"))
      .rejects.toBeInstanceOf(DataExportProtocolError);
    await expect(getDataExportStatus(
      transport({ ok: true, status: 200, json: exportRow(), parseFailed: true }),
      "e1",
    )).rejects.toBeInstanceOf(DataExportProtocolError);
  });
});

describe("classifyDataExportCreateError", () => {
  it("separates definite rejections from unknown outcomes", () => {
    expect(classifyDataExportCreateError(new DataExportHttpError(400, "client"))).toBe("rejected");
    expect(classifyDataExportCreateError(new DataExportHttpError(404, "client"))).toBe("rejected");
    expect(classifyDataExportCreateError(new DataExportHttpError(401, "unauthorized"))).toBe("rejected");
    expect(classifyDataExportCreateError(new DataExportHttpError(500, "server"))).toBe("unknown");
    expect(classifyDataExportCreateError(new DataExportProtocolError(200))).toBe("unknown");
    expect(classifyDataExportCreateError(new TransportTimeoutError(15_000))).toBe("unknown");
    // 普通网络异常（fetch TypeError）：无法证明申请未受理。
    expect(classifyDataExportCreateError(new TypeError("Failed to fetch"))).toBe("unknown");
    // 非 Error 抛出物同样只能归为未知。
    expect(classifyDataExportCreateError("boom")).toBe("unknown");
    expect(classifyDataExportCreateError(undefined)).toBe("unknown");
  });
});

describe("downloadDataExport", () => {
  it("returns the server's raw bytes without re-encoding int64 ids", async () => {
    const fetchStub = vi.fn(async () =>
      downloadResponse(200, new Blob([RAW_EXPORT_JSON], { type: "application/json" })),
    );

    const blob = await downloadDataExport(fetchStub, "/api/v1/exports/e1/download");

    await expect(blob.text()).resolves.toBe(RAW_EXPORT_JSON);
    // 根相对 URL 原样透传，绝不拼接 origin。
    expect(fetchStub).toHaveBeenCalledWith(
      "/api/v1/exports/e1/download",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("maps 404 to a definite client failure and 5xx to server", async () => {
    await expectHttpError(
      downloadDataExport(
        vi.fn(async () => downloadResponse(404, new Blob([], { type: "application/json" }))),
        "/d",
      ),
      404,
      "client",
    );
    await expectHttpError(
      downloadDataExport(
        vi.fn(async () => downloadResponse(503, new Blob([], { type: "application/json" }))),
        "/d",
      ),
      503,
      "server",
    );
  });

  it("rejects an empty 200 body as a protocol error", async () => {
    await expect(downloadDataExport(
      vi.fn(async () => downloadResponse(200, new Blob([]))),
      "/d",
    )).rejects.toBeInstanceOf(DataExportProtocolError);
  });

  it("rethrows network failures unchanged", async () => {
    const networkError = new TypeError("Failed to fetch");
    await expect(downloadDataExport(vi.fn(() => Promise.reject(networkError)), "/d"))
      .rejects.toBe(networkError);
  });

  it("aborts and reports a timeout when the fetch never settles", async () => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | null | undefined;
      const fetchStub = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          signal = init?.signal;
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
      );

      const pending = downloadDataExport(fetchStub, "/d");
      const assertion = expect(pending).rejects.toBeInstanceOf(TransportTimeoutError);

      await vi.advanceTimersByTimeAsync(60_001);
      await assertion;
      expect(signal?.aborted).toBe(true);
      // 失败路径同样清定时器，无泄漏。
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("times out when response headers arrive but the body never completes", async () => {
    vi.useFakeTimers();
    try {
      // 服务器发完头（200）后正文流永不结束：response.blob() 永久挂起。
      const hangingResponse = {
        ok: true,
        status: 200,
        blob: () => new Promise<Blob>(() => undefined),
      } as unknown as Response;
      const fetchStub = vi.fn(async () => hangingResponse);

      const pending = downloadDataExport(fetchStub, "/d");
      const assertion = expect(pending).rejects.toBeInstanceOf(TransportTimeoutError);

      await vi.advanceTimersByTimeAsync(60_001);
      await assertion;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the timeout timer once the body has been read (no leak)", async () => {
    vi.useFakeTimers();
    try {
      const fetchStub = vi.fn(async () =>
        downloadResponse(200, new Blob([RAW_EXPORT_JSON], { type: "application/json" })),
      );

      await downloadDataExport(fetchStub, "/d");
      await vi.advanceTimersByTimeAsync(120_000);

      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
