// REPORT-BE (FR-DATA-001 / §20.15): store unit tests — state only changes on
// confirmed API results; a rejected create never appends a fake row.
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";

import type { Report, ReportTransport } from "@/api/report";
import { useReportStore } from "@/stores/report";

const REPORT: Report = {
  id: "5",
  messageId: "10",
  reason: "UNSAFE_CONTENT",
  note: "让我不安",
  status: "SUBMITTED",
  resolutionNote: null,
  createdAt: "2026-08-19T08:00:00Z",
  resolvedAt: null,
};

function mockTransport(opts: {
  listJson?: unknown;
  listOk?: boolean;
  createOk?: boolean;
} = {}): ReportTransport {
  return {
    async request(
      method: string,
      path: string,
    ): Promise<{ ok: boolean; status: number; json: unknown }> {
      if (method === "GET") {
        const ok = opts.listOk ?? true;
        return { ok, status: ok ? 200 : 500, json: ok ? (opts.listJson ?? [REPORT]) : null };
      }
      // POST /api/v1/reports
      const ok = opts.createOk ?? true;
      return { ok, status: ok ? 200 : 400, json: ok ? REPORT : null };
    },
  };
}

describe("useReportStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("loads the caller's reports", async () => {
    const store = useReportStore();
    await store.load(mockTransport({ listJson: [REPORT] }));

    expect(store.loaded).toBe(true);
    expect(store.reports).toHaveLength(1);
    expect(store.submittedCount).toBe(1);
  });

  it("a failed load sets loadFailed and keeps the previous rows", async () => {
    const store = useReportStore();
    await store.load(mockTransport({ listJson: [REPORT] }));

    await store.load(mockTransport({ listOk: false }));

    expect(store.loadFailed).toBe(true);
    expect(store.reports).toHaveLength(1);
  });

  it("a confirmed create prepends the appended row", async () => {
    const store = useReportStore();

    const ok = await store.submit(mockTransport(), "UNSAFE_CONTENT", "让我不安", "10");

    expect(ok).toBe(true);
    expect(store.reports[0].id).toBe("5");
    expect(store.loaded).toBe(true);
  });

  it("a rejected create (400/hidden 404) never appends a fake row", async () => {
    const store = useReportStore();

    const ok = await store.submit(mockTransport({ createOk: false }), "OTHER", "x");

    expect(ok).toBe(false);
    expect(store.reports).toHaveLength(0);
  });

  it("reset clears the in-memory report list (§18.7 logout clear)", async () => {
    const store = useReportStore();
    await store.load(mockTransport({ listJson: [REPORT] }));

    store.reset();

    expect(store.reports).toHaveLength(0);
    expect(store.loaded).toBe(false);
    expect(store.loadFailed).toBe(false);
  });
});
