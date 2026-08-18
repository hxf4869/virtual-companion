// @vitest-environment happy-dom
// MEM-DETAIL: independent memory detail + evidence page. Fetch is stubbed;
// assertions drive the shipped page, not a parallel client.
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import MemoryDetailPage from "./memory-detail.vue";

function stubFetch(opts?: {
  memoryId?: string;
  getStatus?: number;
  memory?: Record<string, unknown> | null;
  evidence?: unknown[];
}): { calls: { method: string; url: string }[] } {
  const calls: { method: string; url: string }[] = [];
  const memoryId = opts?.memoryId ?? "m1";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ method, url });
      if (url === `/api/v1/memories/${memoryId}` && method === "GET") {
        const status = opts?.getStatus ?? 200;
        return {
          ok: status === 200,
          status,
          json: async () =>
            status === 200
              ? (opts?.memory ?? {
                  memoryId,
                  scope: "RELATIONSHIP",
                  summary: "喜欢安静的晚上",
                  status: "ACCEPTED",
                  createdAt: "2026-08-18T00:00:00Z",
                })
              : { code: "NOT_FOUND_OR_FORBIDDEN" },
        };
      }
      if (url === `/api/v1/memories/${memoryId}/evidence` && method === "GET") {
        return {
          ok: true,
          status: 200,
          json: async () => opts?.evidence ?? [{ evidenceId: "e1", sourceRef: "message:9" }],
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }),
  );
  return { calls };
}

describe("memory detail page", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("uni", { navigateTo: vi.fn() });
    vi.stubGlobal("location", { search: "?memoryId=m1", href: "" });
  });

  it("loads the memory and its evidence through the shipped GET APIs", async () => {
    const { calls } = stubFetch();
    const wrapper = mount(MemoryDetailPage, { attachTo: document.body });
    await flushPromises();

    expect(calls.some((c) => c.method === "GET" && c.url === "/api/v1/memories/m1")).toBe(true);
    expect(calls.some((c) => c.method === "GET" && c.url === "/api/v1/memories/m1/evidence")).toBe(
      true,
    );
    expect(wrapper.find('[data-testid="memory-summary"]').text()).toContain("喜欢安静的晚上");
    expect(wrapper.find('[data-testid="memory-status"]').text()).toContain("ACCEPTED");
    expect(wrapper.find('[data-testid="memory-evidence"]').text()).toContain("message:9");
    wrapper.unmount();
  });

  it("hides existence on 404 and does not invent sources", async () => {
    stubFetch({ getStatus: 404 });
    const wrapper = mount(MemoryDetailPage, { attachTo: document.body });
    await flushPromises();

    expect(wrapper.find('[data-testid="memory-missing"]').text()).toContain("未找到或无权访问");
    expect(wrapper.find('[data-testid="memory-evidence"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="memory-summary"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("does not render an empty evidence container", async () => {
    stubFetch({ evidence: [] });
    const wrapper = mount(MemoryDetailPage, { attachTo: document.body });
    await flushPromises();

    expect(wrapper.find('[data-testid="memory-evidence"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="memory-evidence-empty"]').text()).toContain("没有可展示的来源");
    wrapper.unmount();
  });
});
