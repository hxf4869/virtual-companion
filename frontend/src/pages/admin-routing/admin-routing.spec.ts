// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAuthStore } from "@/stores/auth";
import AdminRoutingPage from "./admin-routing.vue";

const providerPayload = [{
  providerId: "acme",
  displayName: "Acme Gateway",
  protocol: "OPENAI_RESPONSES",
  baseUrl: "https://gateway.example/v1",
  credentialConfigured: true,
  state: "ENABLED",
  models: [
    { modelId: "primary", displayName: "Primary", maxOutputTokens: 4096, priority: 1, state: "ENABLED" },
    { modelId: "backup", displayName: "Backup", maxOutputTokens: 2048, priority: 2, state: "ENABLED" },
  ],
}];

describe("routing change ledger", () => {
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

  it("saves the complete reordered chain only after reauthentication", async () => {
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) as unknown : undefined });
      if (url === "/api/v1/admin/providers") {
        return { ok: true, status: 200, json: async () => providerPayload, headers: new Headers() };
      }
      if (url === "/api/v1/auth/reauth") {
        return { ok: true, status: 200, json: async () => ({ ok: true }), headers: new Headers() };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }), headers: new Headers() };
    }));

    const wrapper = mount(AdminRoutingPage, { attachTo: document.body });
    await flushPromises();
    expect(wrapper.get('button[aria-label="刷新路由顺序"]').attributes("aria-label"))
      .toBe("刷新路由顺序");
    expect(wrapper.get('button[aria-label="检查并应用路由顺序"]').attributes("aria-label"))
      .toBe("检查并应用路由顺序");
    await wrapper.findAll('[aria-label^="下移"]')[0].trigger("click");
    expect(wrapper.text()).toContain("1 → 2");
    await wrapper.get('[data-testid="routing-save"]').trigger("click");
    expect(wrapper.find('[data-testid="routing-reauth-panel"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="routing-reauth-password"]').attributes("aria-label"))
      .toBe("当前管理员密码");
    expect(calls.some((call) => call.url === "/api/v1/admin/model-routing-order")).toBe(false);

    await wrapper.get('[data-testid="routing-reauth-password"]').setValue("AdminPassword1!");
    await wrapper.get('[data-testid="routing-reauth"]').trigger("click");
    await flushPromises();

    expect(calls).toContainEqual({
      url: "/api/v1/admin/model-routing-order",
      method: "PUT",
      body: { routes: [
        { providerId: "acme", modelId: "backup" },
        { providerId: "acme", modelId: "primary" },
      ] },
    });
    wrapper.unmount();
  });

  it("reports a confirmed routing save whose readback fails without replacing the old baseline", async () => {
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
      if (url === "/api/v1/admin/model-routing-order" && init?.method === "PUT") {
        return { ok: true, status: 200, json: async () => ({ ok: true }), headers: new Headers() };
      }
      throw new Error(`unexpected request ${init?.method ?? "GET"} ${url}`);
    }));

    const wrapper = mount(AdminRoutingPage, { attachTo: document.body });
    await flushPromises();
    await wrapper.findAll('[aria-label^="下移"]')[0].trigger("click");
    await wrapper.get('[data-testid="routing-save"]').trigger("click");
    await wrapper.get('[data-testid="routing-reauth-password"]').setValue("AdminPassword1!");
    await wrapper.get('[data-testid="routing-reauth"]').trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("保存请求成功，但无法读取最新配置，请刷新确认");
    expect(wrapper.text()).not.toContain("全局路由顺序已更新，将从下一轮对话开始生效");
    expect(wrapper.text()).toContain("1 → 2");
    expect(providerReads).toBe(2);
    wrapper.unmount();
  });

  it("keeps a staged routing order when cross-page navigation is cancelled", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => providerPayload,
      headers: new Headers(),
    })));
    const redirectTo = vi.fn();
    const showModal = vi.fn();
    vi.stubGlobal("uni", { redirectTo, navigateTo: vi.fn(), showModal });

    const wrapper = mount(AdminRoutingPage, { attachTo: document.body });
    await flushPromises();
    await wrapper.findAll('[aria-label^="下移"]')[0].trigger("click");
    await wrapper.get('[data-testid="admin-nav-system"]').trigger("click");

    expect(showModal).toHaveBeenCalledTimes(1);
    showModal.mock.calls[0][0].success({ confirm: false });
    await flushPromises();

    expect(redirectTo).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("1 → 2");
    wrapper.unmount();
  });
});
