// DATA-EXPORT (FR-DATA-002): typed client unit tests — wire shapes, parsing,
// download-path guarding and typed errors.
import { describe, expect, it, vi } from "vitest";

import {
  createExport,
  downloadExport,
  ExportHttpError,
  getExport,
  type ExportTransport,
} from "./export";

const REQUEST_JSON = {
  exportId: 9,
  status: "READY",
  requestedAt: "2026-08-17T12:00:00Z",
  completedAt: "2026-08-17T12:00:05Z",
  expiresAt: "2026-08-18T12:00:00Z",
  errorMessage: null,
  downloadToken: "secret-tok",
  downloadUrl: "/api/v1/exports/9/download?token=secret-tok",
};

const DOWNLOAD_JSON = {
  exportId: "9",
  generatedAt: "2026-08-17T12:00:05Z",
  expiresAt: "2026-08-18T12:00:00Z",
  aiContentNotice: "本导出包含 AI 生成内容",
  conversations: [{ conversationId: "5", messages: [] }],
  memories: [],
  reminders: [],
  consents: [],
};

function recorder(
  response: { ok: boolean; status: number; json: unknown },
): {
  transport: ExportTransport;
  calls: { method: string; path: string; body?: unknown }[];
} {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const transport: ExportTransport = {
    request: vi.fn(async (method: string, path: string, body?: unknown) => {
      calls.push({ method, path, body });
      return { ...response };
    }),
  };
  return { transport, calls };
}

describe("export api client (FR-DATA-002)", () => {
  it("POSTs the enqueue with the current password (ADR-0006 §7.7) and parses the request", async () => {
    const { transport, calls } = recorder({ ok: true, status: 200, json: REQUEST_JSON });

    const created = await createExport(transport, "Current-Pass-1!");

    expect(calls).toEqual([
      {
        method: "POST",
        path: "/api/v1/exports",
        body: { currentPassword: "Current-Pass-1!" },
      },
    ]);
    expect(created?.exportId).toBe("9");
    expect(created?.status).toBe("READY");
    expect(created?.downloadToken).toBe("secret-tok");
    expect(created?.downloadUrl).toContain("secret-tok");
  });

  it("GETs the status by id", async () => {
    const { transport, calls } = recorder({ ok: true, status: 200, json: REQUEST_JSON });

    const current = await getExport(transport, "9");

    expect(calls[0]).toEqual({ method: "GET", path: "/api/v1/exports/9" });
    expect(current?.status).toBe("READY");
  });

  it("downloads exactly the given path and parses the document", async () => {
    const { transport, calls } = recorder({ ok: true, status: 200, json: DOWNLOAD_JSON });

    const doc = await downloadExport(transport, "/api/v1/exports/9/download?token=t");

    expect(calls[0]).toEqual({
      method: "GET",
      path: "/api/v1/exports/9/download?token=t",
    });
    expect(doc?.aiContentNotice).toContain("AI 生成内容");
    expect(doc?.conversations).toHaveLength(1);
  });

  it("refuses to download a path outside /api/v1/exports", async () => {
    const { transport } = recorder({ ok: true, status: 200, json: DOWNLOAD_JSON });

    await expect(
      downloadExport(transport, "https://evil.example/steal"),
    ).rejects.toBeInstanceOf(ExportHttpError);
    await expect(
      downloadExport(transport, "/api/v1/consents"),
    ).rejects.toBeInstanceOf(ExportHttpError);
  });

  it("throws a typed error on non-OK statuses", async () => {
    const { transport } = recorder({ ok: false, status: 404, json: null });

    await expect(getExport(transport, "999")).rejects.toBeInstanceOf(ExportHttpError);
    await expect(createExport(transport)).rejects.toBeInstanceOf(ExportHttpError);
  });

  it("returns null when a body cannot be parsed", async () => {
    const { transport } = recorder({ ok: true, status: 200, json: { exportId: 1 } });

    expect(await createExport(transport)).toBeNull();
    expect(await getExport(transport, "1")).toBeNull();
  });
});
