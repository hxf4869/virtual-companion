// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAuthStore } from "@/stores/auth";
import AdminSystemPage from "./admin-system.vue";

describe("Go Runtime system status", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    const auth = useAuthStore();
    auth.accountId = "1";
    auth.accessToken = "session";
    auth.role = "ADMIN";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders runtime facts with Chinese status copy", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      const json = url === "/api/v1/admin/providers"
        ? []
        : url === "/api/v1/service-mode"
          ? { mode: "FULL_AI", summary: "生成式聊天已启用。" }
          : url === "/api/v1/version"
            ? { version: "go-1.0.0", commit: "abcdef1234567890" }
            : { status: "UP" };
      return { ok: true, status: 200, json: async () => json, headers: new Headers() };
    }));

    const wrapper = mount(AdminSystemPage, { attachTo: document.body });
    await flushPromises();

    const badges = wrapper.findAll(".system-badge").map((badge) => badge.text());
    expect(badges).toEqual(["正常", "正常", "FULL_AI", "go-1.0.0 · abcdef12"]);
    expect(wrapper.text()).toContain("配置：FULL_AI");
    expect(wrapper.text()).toContain("提交：abcdef123456");
    expect(wrapper.text()).not.toContain("UNKNOWN");
    expect(wrapper.text()).not.toContain("Config:");
    expect(wrapper.text()).not.toContain("Commit:");
    expect(wrapper.get('[data-testid="system-refresh"]').attributes("aria-label"))
      .toBe("重新检查系统状态");
    wrapper.unmount();
  });
});
