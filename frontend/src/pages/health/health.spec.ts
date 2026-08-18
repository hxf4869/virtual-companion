// @vitest-environment happy-dom
// USAGE-HEALTH: health settings page glue. Fetch is stubbed; assertions drive
// the shipped page and store. Copy must stay a system-layer fact.
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import HealthPage from "./health.vue";
import { useUsageHealthStore } from "@/stores/usage-health";

function stubFetch(opts?: {
  status?: {
    reminderAfterMinutes: number;
    sessionGapMinutes: number;
    continuousMinutes: number;
    reminderDue: boolean;
    sessionStartedAt: string | null;
  };
  getStatus?: number;
  putStatus?: number;
}): { calls: { method: string; url: string; body?: unknown }[] } {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  const status = opts?.status ?? {
    reminderAfterMinutes: 120,
    sessionGapMinutes: 30,
    continuousMinutes: 12,
    reminderDue: false,
    sessionStartedAt: "2026-08-18T00:00:00Z",
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      let body: unknown;
      if (typeof init?.body === "string") {
        try {
          body = JSON.parse(init.body);
        } catch {
          body = init.body;
        }
      }
      calls.push({ method, url, body });
      if (url === "/api/v1/usage-health" && method === "GET") {
        const http = opts?.getStatus ?? 200;
        return {
          ok: http === 200,
          status: http,
          json: async () => (http === 200 ? status : null),
        };
      }
      if (url === "/api/v1/usage-health" && method === "PUT") {
        const http = opts?.putStatus ?? 200;
        const next = body && typeof body === "object" ? { ...status, ...(body as object) } : status;
        return {
          ok: http === 200,
          status: http,
          json: async () => (http === 200 ? next : { code: "INVALID_REQUEST" }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }),
  );
  return { calls };
}

describe("health page (USAGE-HEALTH)", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("uni", { navigateTo: vi.fn() });
  });

  it("loads defaults and states the reminder is a system-layer fact", async () => {
    stubFetch();
    const wrapper = mount(HealthPage, { attachTo: document.body });
    await flushPromises();

    expect(wrapper.find('[data-testid="health-intro"]').text()).toContain("服务端计算");
    expect(wrapper.find('[data-testid="health-intro"]').text()).toContain("不会用角色口吻挽留");
    expect(wrapper.find('[data-testid="health-continuous"]').text()).toContain("12 分钟");
    expect(wrapper.find('[data-testid="health-due"]').text()).toContain("尚未到提醒时间");
    expect(wrapper.find('[data-testid="health-after-120"]').attributes("aria-pressed")).toBe("true");
    expect(wrapper.find('[data-testid="health-gap-30"]').attributes("aria-pressed")).toBe("true");
    expect(wrapper.text()).not.toMatch(/舍不得|再陪我一会儿|我很难过/);
    wrapper.unmount();
  });

  it("PUTs a new reminder interval only after the user clicks", async () => {
    const { calls } = stubFetch();
    const wrapper = mount(HealthPage, { attachTo: document.body });
    await flushPromises();

    await wrapper.find('[data-testid="health-after-60"]').trigger("click");
    await flushPromises();

    expect(calls.some((c) => c.method === "PUT" && c.url === "/api/v1/usage-health")).toBe(true);
    const put = calls.find((c) => c.method === "PUT");
    expect(put?.body).toEqual({ reminderAfterMinutes: 60, sessionGapMinutes: 30 });
    expect(useUsageHealthStore().status?.reminderAfterMinutes).toBe(60);
    expect(wrapper.find('[data-testid="health-after-60"]').attributes("aria-pressed")).toBe("true");
    wrapper.unmount();
  });

  it("shows a load failure without inventing prefs", async () => {
    stubFetch({ getStatus: 500 });
    const wrapper = mount(HealthPage, { attachTo: document.body });
    await flushPromises();

    expect(wrapper.find('[data-testid="health-load-failed"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="health-after-120"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
