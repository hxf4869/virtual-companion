// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAuthStore } from "@/stores/auth";
import AdminOverviewPage from "./admin.vue";

const providers = [{
  providerId: "wechat",
  displayName: "微信 Coding Plan",
  protocol: "OPENAI_CHAT_COMPLETIONS",
  baseUrl: "https://chatapi.weixin.qq.com/openai/v1",
  credentialConfigured: true,
  state: "ENABLED",
  models: [{
    modelId: "Deepseek-v4-flash",
    displayName: "DeepSeek V4 Flash",
    maxOutputTokens: 48000,
    priority: 1,
    state: "ENABLED",
  }],
}];

describe("Go Runtime admin overview", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    const auth = useAuthStore();
    auth.accountId = "1";
    auth.accessToken = "session";
    auth.role = "ADMIN";
  });

  it("aggregates only live Go endpoints into the effective-config ledger", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      const json = url === "/api/v1/admin/providers"
        ? providers
        : url === "/api/v1/service-mode"
          ? { mode: "FULL_AI", summary: "已配置可用的模型路由，生成式聊天已启用。" }
          : url === "/api/v1/version"
            ? { version: "go-1.0.0", commit: "abcdef123456" }
            : { status: "UP" };
      return { ok: true, status: 200, json: async () => json, headers: new Headers() };
    }));

    const wrapper = mount(AdminOverviewPage, { attachTo: document.body });
    await flushPromises();

    expect(wrapper.get('[data-testid="admin-overview"]').text()).toContain("FULL_AI");
    expect(wrapper.text()).toContain("wechat → Deepseek-v4-flash");
    expect(wrapper.text()).toContain("go-1.0.0");
    expect(wrapper.find('[data-testid="overview-clear"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="overview-refresh"]').attributes("aria-label"))
      .toBe("刷新运行状态");
    expect(wrapper.text()).not.toContain("账户管理");
    expect(wrapper.text()).not.toContain("审计队列");
    wrapper.unmount();
  });
});
