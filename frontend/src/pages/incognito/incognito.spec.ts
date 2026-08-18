// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import IncognitoPage from "./incognito.vue";
import { useIncognitoStore } from "@/stores/incognito";

function stubFetch(defaultIncognito = false): { calls: { method: string; url: string }[] } {
  const calls: { method: string; url: string }[] = [];
  let current = defaultIncognito;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ method, url });
      if (url === "/api/v1/incognito-pref" && method === "GET") {
        return { ok: true, status: 200, json: async () => ({ defaultIncognito: current }) };
      }
      if (url === "/api/v1/incognito-pref" && method === "PUT") {
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
        current = body.defaultIncognito === true;
        return { ok: true, status: 200, json: async () => ({ defaultIncognito: current }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }),
  );
  return { calls };
}

describe("incognito settings page (FR-CHAT-005)", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("uni", { navigateTo: vi.fn() });
  });

  it("states the boundary and does not treat incognito as no records", async () => {
    stubFetch(false);
    const wrapper = mount(IncognitoPage, { attachTo: document.body });
    await flushPromises();

    expect(wrapper.find('[data-testid="incognito-intro"]').text()).toContain("不等于");
    expect(wrapper.find('[data-testid="incognito-intro"]').text()).toContain("安全记录");
    expect(wrapper.find('[data-testid="incognito-label"]').text()).toContain("默认不无痕");
    expect(wrapper.text()).not.toMatch(/完全不留痕迹|谁也看不到/);
    wrapper.unmount();
  });

  it("PUTs the default only after the user clicks", async () => {
    const { calls } = stubFetch(false);
    const wrapper = mount(IncognitoPage, { attachTo: document.body });
    await flushPromises();

    await wrapper.find('[data-testid="incognito-default-toggle"]').trigger("click");
    await flushPromises();

    expect(calls.some((c) => c.method === "PUT" && c.url === "/api/v1/incognito-pref")).toBe(true);
    expect(useIncognitoStore().defaultIncognito).toBe(true);
    expect(wrapper.find('[data-testid="incognito-label"]').text()).toContain("默认无痕");
    wrapper.unmount();
  });
});
