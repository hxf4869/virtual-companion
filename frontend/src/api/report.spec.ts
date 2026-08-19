// REPORT-BE (FR-DATA-001 / §20.15): typed client unit tests — wire shapes,
// parsing, existence-hidden mapping and typed errors.
import { describe, expect, it, vi } from "vitest";

import {
  createReport,
  getReport,
  listReports,
  ReportHttpError,
  type ReportTransport,
} from "./report";

const REPORT_JSON = {
  id: 5,
  messageId: "10",
  reason: "UNSAFE_CONTENT",
  note: "让我不安",
  status: "SUBMITTED",
  createdAt: "2026-08-19T08:00:00Z",
};

function recorder(
  response: { ok: boolean; status: number; json: unknown },
): { transport: ReportTransport; calls: { method: string; path: string; body?: unknown }[] } {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const transport: ReportTransport = {
    request: vi.fn(async (method: string, path: string, body?: unknown) => {
      calls.push({ method, path, body });
      return { ...response };
    }),
  };
  return { transport, calls };
}

describe("report api client (REPORT-BE)", () => {
  it("POSTs the create body with the optional anchor and parses the record", async () => {
    const { transport, calls } = recorder({ ok: true, status: 200, json: REPORT_JSON });

    const created = await createReport(transport, "UNSAFE_CONTENT", "让我不安", "10");

    expect(calls).toEqual([
      {
        method: "POST",
        path: "/api/v1/reports",
        body: { reason: "UNSAFE_CONTENT", note: "让我不安", messageId: "10" },
      },
    ]);
    expect(created?.id).toBe("5");
    expect(created?.messageId).toBe("10");
    expect(created?.status).toBe("SUBMITTED");
    expect(created?.resolvedAt).toBeNull();
  });

  it("omits messageId when no anchor is given", async () => {
    const { transport, calls } = recorder({
      ok: true,
      status: 200,
      json: { ...REPORT_JSON, messageId: null },
    });

    const created = await createReport(transport, "OTHER", "一般问题");

    expect(calls[0].body).toEqual({ reason: "OTHER", note: "一般问题" });
    expect(created?.messageId).toBeNull();
  });

  it("hides existence on a foreign anchor (404 → null, no throw)", async () => {
    const { transport } = recorder({ ok: false, status: 404, json: null });

    await expect(createReport(transport, "OTHER", "x", "999")).resolves.toBeNull();
  });

  it("maps an invalid reason (400) to null instead of a throw", async () => {
    const { transport } = recorder({ ok: false, status: 400, json: null });

    await expect(createReport(transport, "OTHER", "x")).resolves.toBeNull();
  });

  it("throws a typed error for other failures", async () => {
    const { transport } = recorder({ ok: false, status: 500, json: null });

    await expect(createReport(transport, "OTHER", "x")).rejects.toBeInstanceOf(ReportHttpError);
  });

  it("lists keyset pages and skips malformed rows", async () => {
    const { transport, calls } = recorder({
      ok: true,
      status: 200,
      json: [REPORT_JSON, { id: "not-a-report" }],
    });

    const rows = await listReports(transport, "5", 20);

    expect(calls[0].path).toBe("/api/v1/reports?after=5&limit=20");
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("5");
  });

  it("returns [] on an existence-hidden list failure", async () => {
    const { transport } = recorder({ ok: false, status: 404, json: null });

    await expect(listReports(transport)).resolves.toEqual([]);
  });

  it("gets one owned report and hides existence on 404", async () => {
    const ok = recorder({ ok: true, status: 200, json: REPORT_JSON });
    const created = await getReport(ok.transport, "5");
    expect(created?.id).toBe("5");

    const missing = recorder({ ok: false, status: 404, json: null });
    await expect(getReport(missing.transport, "9")).resolves.toBeNull();
  });
});
