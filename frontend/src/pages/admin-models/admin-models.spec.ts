// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAuthStore } from "@/stores/auth";
import AdminModelsPage from "./admin-models.vue";

const providerPayload = [{
  providerId: "wechat",
  displayName: "微信 Coding Plan",
  protocol: "OPENAI_CHAT_COMPLETIONS",
  baseUrl: "https://chatapi.weixin.qq.com/openai/v1",
  credentialConfigured: true,
  state: "ENABLED",
  models: [{
    modelId: "Deepseek-v4-flash",
    displayName: "DeepSeek V4 Flash",
    contextWindowTokens: 200000,
    maxOutputTokens: 48000,
    priority: 1,
    state: "ENABLED",
  }],
}];

describe("model service change ledger", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    const auth = useAuthStore();
    auth.accountId = "1";
    auth.accessToken = "session";
    auth.role = "ADMIN";
    Object.defineProperty(document, "cookie", { value: "vc_csrf=test-csrf", configurable: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stages a change, reauthenticates, then saves without ever rendering the credential", async () => {
    const calls: Array<{ url: string; method: string; body?: unknown; csrf?: string | null }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      calls.push({
        url,
        method,
        body: init?.body ? JSON.parse(String(init.body)) as unknown : undefined,
        csrf: new Headers(init?.headers).get("X-CSRF-Token"),
      });
      if (url === "/api/v1/admin/providers") {
        return { ok: true, status: 200, json: async () => providerPayload, headers: new Headers() };
      }
      if (url === "/api/v1/auth/reauth") {
        return { ok: true, status: 200, json: async () => ({ ok: true }), headers: new Headers() };
      }
      if (url === "/api/v1/admin/providers/wechat") {
        return { ok: true, status: 200, json: async () => ({ ok: true }), headers: new Headers() };
      }
      throw new Error(`unexpected request ${method} ${url}`);
    }));

    const wrapper = mount(AdminModelsPage, { attachTo: document.body });
    await flushPromises();
    expect(wrapper.text()).toContain("API 密钥");
    expect(wrapper.text()).not.toContain("test-provider-secret");
    expect(wrapper.get('button[aria-label="刷新模型服务配置"]').attributes("aria-label"))
      .toBe("刷新模型服务配置");
    expect(wrapper.get('button[aria-label="添加模型提供方"]').attributes("aria-label"))
      .toBe("添加模型提供方");

    await wrapper.get('[data-testid="provider-display-name"]').setValue("微信模型网关");
    expect(wrapper.text()).toContain("修改显示名称");
    await wrapper.get('[data-testid="provider-save"]').trigger("click");
    expect(wrapper.find('[data-testid="provider-reauth-panel"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="provider-reauth-password"]').attributes("aria-label"))
      .toBe("当前管理员密码");

    await wrapper.get('[data-testid="provider-reauth-password"]').setValue("AdminPassword1!");
    await wrapper.get('[data-testid="provider-reauth"]').trigger("click");
    await flushPromises();

    const save = calls.find((call) => call.url === "/api/v1/admin/providers/wechat" && call.method === "PUT");
    expect(save?.csrf).toBe("test-csrf");
    expect(save?.body).toMatchObject({ displayName: "微信模型网关" });
    expect(save?.body).not.toHaveProperty("credential");
    expect(wrapper.text()).toContain("配置已保存");
    wrapper.unmount();
  });

  it("reports a confirmed save whose provider readback fails without replacing the old baseline", async () => {
    let providerReads = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/v1/admin/providers") {
        providerReads += 1;
        return providerReads === 1
          ? { ok: true, status: 200, json: async () => providerPayload, headers: new Headers() }
          : { ok: false, status: 500, json: async () => ({}), headers: new Headers() };
      }
      if (url === "/api/v1/auth/reauth") {
        return { ok: true, status: 200, json: async () => ({ ok: true }), headers: new Headers() };
      }
      if (url === "/api/v1/admin/providers/wechat" && init?.method === "PUT") {
        return { ok: true, status: 200, json: async () => ({ ok: true }), headers: new Headers() };
      }
      throw new Error(`unexpected request ${init?.method ?? "GET"} ${url}`);
    }));

    const wrapper = mount(AdminModelsPage, { attachTo: document.body });
    await flushPromises();
    await wrapper.get('[data-testid="provider-display-name"]').setValue("尚未回读的新名称");
    await wrapper.get('[data-testid="provider-save"]').trigger("click");
    await wrapper.get('[data-testid="provider-reauth-password"]').setValue("AdminPassword1!");
    await wrapper.get('[data-testid="provider-reauth"]').trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("保存请求成功，但无法读取最新配置，请刷新确认");
    expect(wrapper.text()).not.toContain("提供方配置已保存；新配置从下一轮对话开始生效");
    expect(wrapper.text()).toContain("修改显示名称");
    expect(providerReads).toBe(2);
    wrapper.unmount();
  });

  it("keeps a staged provider draft when cross-page navigation is cancelled", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => providerPayload,
      headers: new Headers(),
    })));
    const redirectTo = vi.fn();
    const showModal = vi.fn();
    vi.stubGlobal("uni", { redirectTo, navigateTo: vi.fn(), showModal });

    const wrapper = mount(AdminModelsPage, { attachTo: document.body });
    await flushPromises();
    await wrapper.get('[data-testid="provider-display-name"]').setValue("尚未保存的名称");
    await wrapper.get('[data-testid="admin-nav-system"]').trigger("click");

    expect(showModal).toHaveBeenCalledTimes(1);
    expect(showModal.mock.calls[0][0]).toMatchObject({
      title: "放弃未保存变更？",
      confirmText: "放弃并离开",
      cancelText: "继续编辑",
    });
    showModal.mock.calls[0][0].success({ confirm: false });
    await flushPromises();

    expect(redirectTo).not.toHaveBeenCalled();
    expect(wrapper.get('[data-testid="provider-display-name"]').element)
      .toHaveProperty("value", "尚未保存的名称");
    wrapper.unmount();
  });
});
