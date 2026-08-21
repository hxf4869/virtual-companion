// DATA-EXPORT (FR-DATA-002): store unit tests — state only changes on
// confirmed API results; failed enqueues/refreshes/downloads never fake
// state.
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";

import type { ExportDownload, ExportRequest, ExportTransport } from "@/api/export";
import { useExportStore } from "@/stores/export";

const PENDING: ExportRequest = {
  exportId: "9",
  status: "PENDING",
  requestedAt: "2026-08-17T12:00:00Z",
};

// V76: the create response issues the one-time download URL exactly once.
const PENDING_CREATED: ExportRequest = {
  ...PENDING,
  downloadToken: "secret-tok",
  downloadUrl: "/api/v1/exports/9/download?token=secret-tok",
};

// Status polls never repeat the token or URL (only the digest is stored).
const READY: ExportRequest = {
  exportId: "9",
  status: "READY",
  requestedAt: "2026-08-17T12:00:00Z",
  completedAt: "2026-08-17T12:00:05Z",
  expiresAt: "2026-08-18T12:00:00Z",
};

const DOCUMENT: ExportDownload = {
  exportId: "9",
  generatedAt: "2026-08-17T12:00:05Z",
  expiresAt: "2026-08-18T12:00:00Z",
  aiContentNotice: "本导出包含 AI 生成内容",
  conversations: [],
  memories: [],
  reminders: [],
  consents: [],
};

function mockTransport(opts: {
  createJson?: unknown;
  createOk?: boolean;
  getJson?: unknown;
  getOk?: boolean;
  downloadJson?: unknown;
  downloadOk?: boolean;
} = {}): ExportTransport {
  return {
    async request(method: string, path: string): Promise<{ ok: boolean; status: number; json: unknown }> {
      if (method === "POST") {
        const ok = opts.createOk ?? true;
        return { ok, status: ok ? 200 : 400, json: ok ? (opts.createJson ?? PENDING_CREATED) : null };
      }
      if (path.includes("/download")) {
        const ok = opts.downloadOk ?? true;
        return { ok, status: ok ? 200 : 404, json: ok ? (opts.downloadJson ?? DOCUMENT) : null };
      }
      const ok = opts.getOk ?? true;
      return { ok, status: ok ? 200 : 404, json: ok ? (opts.getJson ?? PENDING) : null };
    },
  };
}

describe("useExportStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("create stores only a confirmed request", async () => {
    const store = useExportStore();
    expect(await store.create(mockTransport())).toBe(true);
    expect(store.request?.exportId).toBe("9");
    expect(store.request?.status).toBe("PENDING");

    expect(await store.create(mockTransport({ createOk: false }))).toBe(false);
    expect(store.request?.status).toBe("PENDING");
    expect(store.actionError).toContain("失败");
  });

  it("refresh replaces the status but keeps the once-issued URL (V76)", async () => {
    const store = useExportStore();
    await store.create(mockTransport());
    expect(store.canDownload()).toBe(false);

    expect(await store.refresh(mockTransport({ getJson: READY }), "9")).toBe(true);
    expect(store.request?.status).toBe("READY");
    expect(store.request?.downloadUrl).toBeUndefined();
    expect(store.canDownload()).toBe(true);
  });

  it("refresh failure flags loadFailed without dropping the request", async () => {
    const store = useExportStore();
    await store.create(mockTransport());

    expect(await store.refresh(mockTransport({ getOk: false }), "9")).toBe(false);
    expect(store.loadFailed).toBe(true);
    expect(store.request?.exportId).toBe("9");
  });

  it("download consumes the link and keeps the document only on success", async () => {
    const store = useExportStore();
    await store.create(mockTransport());
    await store.refresh(mockTransport({ getJson: READY }), "9");

    expect(await store.downloadDocument(mockTransport())).toBe(true);
    expect(store.download?.aiContentNotice).toContain("AI 生成内容");

    // A failed download (e.g. already consumed) does not fake a document.
    expect(await store.downloadDocument(mockTransport({ downloadOk: false }))).toBe(false);
    expect(store.downloadFailed).toBe(true);
    expect(store.download).not.toBeNull();
  });

  it("download without an issued URL is a silent no-op", async () => {
    const store = useExportStore();
    await store.create(mockTransport({ createJson: PENDING }));

    expect(await store.downloadDocument(mockTransport())).toBe(false);
    expect(store.download).toBeNull();
  });
});
