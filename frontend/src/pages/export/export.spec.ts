// @vitest-environment happy-dom
// DATA-EXPORT (FR-DATA-002): export page glue test — renders the enqueue
// action, the status card with the one-time download link while READY, and
// routes create/refresh/download through the store.
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ExportPage from "./export.vue";

const PENDING_JSON = {
  exportId: 9,
  status: "PENDING",
  requestedAt: "2026-08-17T12:00:00Z",
};

const READY_JSON = {
  exportId: 9,
  status: "READY",
  requestedAt: "2026-08-17T12:00:00Z",
  completedAt: "2026-08-17T12:00:05Z",
  expiresAt: "2026-08-18T12:00:00Z",
  downloadUrl: "/api/v1/exports/9/download?token=secret-tok",
};

const EXPIRED_JSON = {
  exportId: 9,
  status: "EXPIRED",
  requestedAt: "2026-08-17T12:00:00Z",
};

const DOCUMENT_JSON = {
  exportId: "9",
  generatedAt: "2026-08-17T12:00:05Z",
  expiresAt: "2026-08-18T12:00:00Z",
  aiContentNotice: "本导出包含 AI 生成内容",
  conversations: [{ conversationId: "5" }],
  memories: [{ memoryId: "1" }],
  reminders: [],
  consents: [],
};

/**
 * Fetch stub: POST /api/v1/exports enqueues (the status read after it is
 * {@code postJson}); GET /api/v1/exports/9 reads the current status;
 * GET .../download returns the one-time document.
 */
function stubFetch(initial: unknown, postJson: unknown = initial): void {
  let statusJson: unknown = initial;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET") as string;
      if (url === "/api/v1/exports" && method === "POST") {
        statusJson = postJson;
        return { ok: true, status: 200, json: async () => PENDING_JSON };
      }
      if (url === "/api/v1/exports/9") {
        return { ok: true, status: 200, json: async () => statusJson };
      }
      if (url.includes("/download")) {
        return { ok: true, status: 200, json: async () => DOCUMENT_JSON };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }),
  );
}

describe("export page (FR-DATA-002)", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("uni", undefined);
  });

  it("enqueues an export and shows the pending status card", async () => {
    stubFetch(null);
    const wrapper = mount(ExportPage, { attachTo: document.body });
    await flushPromises();

    expect(wrapper.find('[data-testid="export-status-card"]').exists()).toBe(false);

    await wrapper.find('[data-testid="export-create"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="export-status"]').text()).toContain("生成中");
    expect(wrapper.find('[data-testid="export-download"]').exists()).toBe(false);

    wrapper.unmount();
  });

  it("refreshes to READY and downloads the one-time document", async () => {
    stubFetch(PENDING_JSON, READY_JSON);
    const wrapper = mount(ExportPage, { attachTo: document.body });
    await flushPromises();

    await wrapper.find('[data-testid="export-create"]').trigger("click");
    await flushPromises();

    await wrapper.find('[data-testid="export-refresh"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="export-status"]').text()).toContain("已就绪");
    expect(wrapper.find('[data-testid="export-download"]').exists()).toBe(true);

    await wrapper.find('[data-testid="export-download"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="export-download-preview"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="export-download-preview"]').text()).toContain("AI 生成内容");
    expect(wrapper.find('[data-testid="export-download-preview"]').text()).toContain("会话 1 个");

    wrapper.unmount();
  });

  it("shows the action-failed banner when enqueue is rejected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 400, json: async () => null })),
    );
    const wrapper = mount(ExportPage, { attachTo: document.body });
    await flushPromises();

    await wrapper.find('[data-testid="export-create"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="export-action-failed"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="export-action-failed"]').text()).toContain("发起导出失败");

    wrapper.unmount();
  });

  it("shows the expired hint for an expired export", async () => {
    stubFetch(EXPIRED_JSON);
    const wrapper = mount(ExportPage, { attachTo: document.body });
    await flushPromises();

    await wrapper.find('[data-testid="export-create"]').trigger("click");
    await flushPromises();
    await wrapper.find('[data-testid="export-refresh"]').trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("已过期，文件已自动删除");
    expect(wrapper.find('[data-testid="export-download"]').exists()).toBe(false);

    wrapper.unmount();
  });
});
