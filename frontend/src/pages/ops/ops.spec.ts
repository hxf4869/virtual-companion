// @vitest-environment happy-dom
// ADMIN-OPS-RO: read-only service status, compliance, and announcement.
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import OpsPage from "./ops.vue";
import { useAuthStore } from "@/stores/auth";

function stubApis(): { calls: string[] } {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push(`${method} ${url}`);
      if (url === "/api/v1/service-mode") {
        return {
          ok: true,
          status: 200,
          json: async () => ({ mode: "ZERO_LLM", summary: "当前为无生成模型的受限服务" }),
        };
      }
      if (url === "/api/v1/version") {
        return { ok: true, status: 200, json: async () => ({ version: "0.1.0-test", commit: "abc1234" }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }),
  );
  return { calls };
}

describe("admin read-only ops page", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("uni", { navigateTo: vi.fn() });
  });

  it("hides the reads from a non-admin session", async () => {
    const { calls } = stubApis();
    const auth = useAuthStore();
    auth.role = "USER";
    auth.accessToken = "t";
    const wrapper = mount(OpsPage, { attachTo: document.body });
    await flushPromises();

    expect(wrapper.find('[data-testid="ops-not-allowed"]').exists()).toBe(true);
    expect(calls.some((c) => c.includes("/api/v1/service-mode"))).toBe(false);
    wrapper.unmount();
  });

  it("loads service-mode and version and states Alpha compliance facts", async () => {
    const { calls } = stubApis();
    const auth = useAuthStore();
    auth.role = "ADMIN";
    auth.accessToken = "t";
    const wrapper = mount(OpsPage, { attachTo: document.body });
    await flushPromises();

    expect(calls).toContain("GET /api/v1/service-mode");
    expect(calls).toContain("GET /api/v1/version");
    expect(wrapper.find('[data-testid="ops-mode"]').text()).toContain("ZERO_LLM");
    expect(wrapper.find('[data-testid="ops-mode"]').text()).toContain("无生成模型");
    expect(wrapper.find('[data-testid="ops-version"]').text()).toContain("0.1.0-test");
    expect(wrapper.find('[data-testid="ops-compliance"]').text()).toContain("不对真实用户开放");
    expect(wrapper.find('[data-testid="ops-compliance"]').text()).toContain("真实支付");
    expect(wrapper.find('[data-testid="ops-announce"]').text()).toContain("当前为无生成模型的受限服务");
    expect(wrapper.text()).not.toMatch(/一切正常请放心|角色正在休息/);
    wrapper.unmount();
  });
});
