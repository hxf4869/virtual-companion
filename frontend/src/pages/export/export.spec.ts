// @vitest-environment happy-dom
// DATA-EXPORT (FR-DATA-002): export page glue test — renders the enqueue
// action, the status card, and routes create/refresh/download through the
// store. V76: the one-time download link arrives ONLY in the create response;
// status polls carry the bare status.
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ExportPage from "./export.vue";

const PENDING_JSON = {
  exportId: 9,
  status: "PENDING",
  requestedAt: "2026-08-17T12:00:00Z",
};

// Create response: issues the one-time token/URL exactly once (V76).
const CREATED_JSON = {
  ...PENDING_JSON,
  downloadToken: "secret-tok",
  downloadUrl: "/api/v1/exports/9/download?token=secret-tok",
};

// Status poll: bare READY — never repeats the token or URL.
const READY_JSON = {
  exportId: 9,
  status: "READY",
  requestedAt: "2026-08-17T12:00:00Z",
  completedAt: "2026-08-17T12:00:05Z",
  expiresAt: "2026-08-18T12:00:00Z",
};

const EXPIRED_JSON = {
  exportId: 9,
  status: "EXPIRED",
  requestedAt: "2026-08-17T12:00:00Z",
};

const DOCUMENT_JSON = {
  exportedAt: "2026-08-17T12:00:05Z",
  conversationCount: 1,
  messageCount: 2,
  memoryCount: 1,
  conversations: [{ conversationId: "5" }],
  memories: [{ memoryId: "1" }],
};

/**
 * Fetch stub: POST /api/v1/exports returns the create response
 * ({@code createJson}, which carries the once-issued download URL); GET
 * /api/v1/exports/9 reads the bare status; GET .../download returns the
 * one-time document.
 */
function stubFetch(initial: unknown, createJson: unknown = CREATED_JSON): void {
  const statusJson: unknown = initial;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET") as string;
      if (url === "/api/v1/exports" && method === "POST") {
        return { ok: true, status: 200, json: async () => createJson };
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

  it("enqueues an export with the password re-entry and shows the pending status card", async () => {
    stubFetch(null);
    const wrapper = mount(ExportPage, { attachTo: document.body });
    await flushPromises();

    expect(wrapper.find('[data-testid="export-status-card"]').exists()).toBe(false);

    await wrapper.find('[data-testid="export-password"]').setValue("Current-Pass-1!");
    await wrapper.find('[data-testid="export-create"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="export-status"]').text()).toContain("生成中");
    expect(wrapper.find('[data-testid="export-download"]').exists()).toBe(false);

    wrapper.unmount();
  });

  it("refreshes to READY and downloads the one-time document", async () => {
    stubFetch(READY_JSON, CREATED_JSON);
    const wrapper = mount(ExportPage, { attachTo: document.body });
    await flushPromises();

    await wrapper.find('[data-testid="export-password"]').setValue("Current-Pass-1!");
    await wrapper.find('[data-testid="export-create"]').trigger("click");
    await flushPromises();

    await wrapper.find('[data-testid="export-refresh"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="export-status"]').text()).toContain("已就绪");
    expect(wrapper.find('[data-testid="export-download"]').exists()).toBe(true);

    // V76: the once-issued link is live while READY (and only then).
    expect(wrapper.find('[data-testid="export-once-hint"]').exists()).toBe(true);

    await wrapper.find('[data-testid="export-download"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="export-download-preview"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="export-download-preview"]').text()).toContain("assistant 为 AI 回复");
    expect(wrapper.find('[data-testid="export-download-preview"]').text()).toContain("会话 1 个");
    expect(wrapper.find('[data-testid="export-download-preview"]').text()).toContain("消息 2 条");

    wrapper.unmount();
  });

  it("never sends the create request without a password re-entry", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL) => ({ ok: true, status: 200, json: async () => CREATED_JSON }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const wrapper = mount(ExportPage, { attachTo: document.body });
    await flushPromises();

    await wrapper.find('[data-testid="export-create"]').trigger("click");
    await flushPromises();

    // Only the session refresh may happen on mount — never the export POST.
    const exportCalls = fetchMock.mock.calls.filter(
      (call) => String(call[0]).includes("/api/v1/exports"),
    );
    expect(exportCalls).toHaveLength(0);
    expect(wrapper.find('[data-testid="export-password-error"]').text()).toContain("当前密码");

    wrapper.unmount();
  });

  it("shows the action-failed banner and keeps the input when the password is rejected", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 404, json: async () => null }));
    vi.stubGlobal("fetch", fetchMock);
    const wrapper = mount(ExportPage, { attachTo: document.body });
    await flushPromises();

    await wrapper.find('[data-testid="export-password"]').setValue("wrong");
    await wrapper.find('[data-testid="export-create"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="export-action-failed"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="export-action-failed"]').text()).toContain("发起导出失败");
    // Fail-closed re-entry: the typed password survives for a retry.
    expect((wrapper.find('[data-testid="export-password"]').element as HTMLInputElement).value)
      .toBe("wrong");
    expect(wrapper.find('[data-testid="export-status-card"]').exists()).toBe(false);

    wrapper.unmount();
  });

  it("shows the expired hint for an expired export", async () => {
    stubFetch(EXPIRED_JSON);
    const wrapper = mount(ExportPage, { attachTo: document.body });
    await flushPromises();

    await wrapper.find('[data-testid="export-password"]').setValue("Current-Pass-1!");
    await wrapper.find('[data-testid="export-create"]').trigger("click");
    await flushPromises();
    await wrapper.find('[data-testid="export-refresh"]').trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("已过期，文件已自动删除");
    expect(wrapper.find('[data-testid="export-download"]').exists()).toBe(false);

    wrapper.unmount();
  });
});
