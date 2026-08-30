// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAuthStore } from "@/stores/auth";
import ProviderRoutingPanel from "./ProviderRoutingPanel.vue";

const providerPayload = [{
  providerId: "acme",
  displayName: "Acme Gateway",
  protocol: "OPENAI_RESPONSES",
  baseUrl: "https://gateway.example/v1",
  credentialConfigured: true,
  state: "ENABLED",
  models: [
    { modelId: "m1", displayName: "Primary", maxOutputTokens: 4096, priority: 1, state: "ENABLED" },
    { modelId: "m2", displayName: "Backup", maxOutputTokens: 4096, priority: 2, state: "ENABLED" },
  ],
}];

describe("ProviderRoutingPanel", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    const auth = useAuthStore();
    auth.role = "ADMIN";
    auth.accountId = "1";
    auth.accessToken = "session";
    Object.defineProperty(document, "cookie", { value: "vc_csrf=test-csrf", configurable: true });
  });

  it("shows the frozen priority chain and never renders a credential", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => providerPayload,
      headers: new Headers(),
    })));
    const wrapper = mount(ProviderRoutingPanel, { attachTo: document.body });
    await flushPromises();
    const routes = wrapper.findAll('[data-testid="provider-route-row"]');
    expect(routes).toHaveLength(2);
    expect(routes[0].text()).toContain("Primary");
    expect(routes[1].text()).toContain("Backup");
    expect(wrapper.text()).not.toContain("must-not-be-consumed");

    await wrapper.get('[data-testid="provider-edit"]').trigger("click");
    expect((wrapper.get('[data-testid="provider-credential"]').element as HTMLInputElement).value).toBe("");
    expect(wrapper.get('[data-testid="provider-credential"]').attributes("placeholder")).toContain("保留");
    wrapper.unmount();
  });

  it("requires reauth, then saves the reordered complete chain", async () => {
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      calls.push({
        url,
        method,
        body: init?.body ? JSON.parse(String(init.body)) as unknown : undefined,
      });
      if (url === "/api/v1/admin/providers") {
        return { ok: true, status: 200, json: async () => providerPayload, headers: new Headers() };
      }
      if (url === "/api/v1/auth/reauth") {
        return { ok: true, status: 200, json: async () => ({ ok: true }), headers: new Headers() };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }), headers: new Headers() };
    }));
    const wrapper = mount(ProviderRoutingPanel, { attachTo: document.body });
    await flushPromises();

    const firstDown = wrapper.findAll('[aria-label^="下移"]')[0];
    await firstDown.trigger("click");
    expect(wrapper.get('[data-testid="provider-save-order"]').attributes("disabled")).toBeDefined();

    await wrapper.get('[data-testid="provider-reauth-password"]').setValue("AdminPassword1!");
    await wrapper.get('[data-testid="provider-reauth"]').trigger("click");
    await flushPromises();
    await wrapper.get('[data-testid="provider-save-order"]').trigger("click");
    await flushPromises();

    expect(calls).toContainEqual({
      url: "/api/v1/admin/model-routing-order",
      method: "PUT",
      body: { routes: [
        { providerId: "acme", modelId: "m2" },
        { providerId: "acme", modelId: "m1" },
      ] },
    });
    wrapper.unmount();
  });

  it("imports explicit catalog results into the draft without auto-saving", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push(url);
      if (url === "/api/v1/admin/providers") {
        return { ok: true, status: 200, json: async () => providerPayload, headers: new Headers() };
      }
      if (url === "/api/v1/auth/reauth") {
        return { ok: true, status: 200, json: async () => ({ ok: true }), headers: new Headers() };
      }
      if (url.endsWith("/models/discover")) {
        return {
          ok: true,
          status: 200,
          json: async () => [{ modelId: "m3", displayName: "Discovered" }],
          headers: new Headers(),
        };
      }
      throw new Error(`unexpected request ${url}`);
    }));

    const wrapper = mount(ProviderRoutingPanel, { attachTo: document.body });
    await flushPromises();
    await wrapper.get('[data-testid="provider-reauth-password"]').setValue("AdminPassword1!");
    await wrapper.get('[data-testid="provider-reauth"]').trigger("click");
    await flushPromises();
    await wrapper.get('[data-testid="provider-edit"]').trigger("click");
    await wrapper.get('[data-testid="provider-discover-models"]').trigger("click");
    await flushPromises();

    expect(calls).toContain("/api/v1/admin/providers/acme/models/discover");
    const ids = wrapper.findAll('input[placeholder="模型 ID"]')
      .map((input) => (input.element as HTMLInputElement).value);
    expect(ids).toEqual(["m1", "m2", "m3"]);
    expect(wrapper.text()).toContain("请确认参数后再保存");
    expect(calls.filter((url) => url === "/api/v1/admin/providers/acme")).toHaveLength(0);
    wrapper.unmount();
  });

  it("keeps the provider draft while reauthenticating inside the sheet", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/v1/admin/providers") {
        return { ok: true, status: 200, json: async () => providerPayload, headers: new Headers() };
      }
      if (url === "/api/v1/auth/reauth") {
        return { ok: true, status: 200, json: async () => ({ ok: true }), headers: new Headers() };
      }
      throw new Error(`unexpected request ${url}`);
    }));
    const wrapper = mount(ProviderRoutingPanel, { attachTo: document.body });
    await flushPromises();
    await wrapper.get('[data-testid="provider-add"]').trigger("click");
    await wrapper.get('input[placeholder="例如 acme-gateway"]').setValue("new-provider");
    await wrapper.get('[data-testid="provider-sheet-reauth-password"]').setValue("AdminPassword1!");
    await wrapper.get('[data-testid="provider-sheet-reauth-submit"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="provider-sheet-reauth"]').exists()).toBe(false);
    expect((wrapper.get('input[placeholder="例如 acme-gateway"]').element as HTMLInputElement).value)
      .toBe("new-provider");
    wrapper.unmount();
  });

  it("shows a failed sheet reauthentication inside the modal", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/v1/admin/providers") {
        return { ok: true, status: 200, json: async () => providerPayload, headers: new Headers() };
      }
      if (url === "/api/v1/auth/reauth") {
        return { ok: false, status: 403, json: async () => null, headers: new Headers() };
      }
      throw new Error(`unexpected request ${url}`);
    }));
    const wrapper = mount(ProviderRoutingPanel, { attachTo: document.body });
    await flushPromises();
    await wrapper.get('[data-testid="provider-add"]').trigger("click");
    await wrapper.get('[data-testid="provider-sheet-reauth-password"]').setValue("wrong-password");
    await wrapper.get('[data-testid="provider-sheet-reauth-submit"]').trigger("click");
    await flushPromises();

    expect(wrapper.get('[data-testid="provider-sheet-reauth-error"]').text())
      .toContain("身份确认失败");
    expect(wrapper.get('[data-testid="app-sheet-panel"]').isVisible()).toBe(true);
    wrapper.unmount();
  });

  it("makes pending route-order edits explicit before other actions", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => providerPayload,
      headers: new Headers(),
    })));
    const wrapper = mount(ProviderRoutingPanel, { attachTo: document.body });
    await flushPromises();
    await wrapper.findAll('[aria-label^="下移"]')[0].trigger("click");

    expect(wrapper.get('[aria-label="刷新模型服务"]').attributes("disabled")).toBeDefined();
    expect(wrapper.get('[data-testid="provider-edit"]').attributes("disabled")).toBeDefined();
    await wrapper.get('[data-testid="provider-discard-order"]').trigger("click");

    expect(wrapper.findAll('[data-testid="provider-route-row"]')[0].text()).toContain("Primary");
    expect(wrapper.get('[aria-label="刷新模型服务"]').attributes("disabled")).toBeUndefined();
    expect(wrapper.get('[data-testid="provider-edit"]').attributes("disabled")).toBeUndefined();
    wrapper.unmount();
  });
});
