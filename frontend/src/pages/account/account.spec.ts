// @vitest-environment happy-dom
// ACCT-PAGE: dedicated account + logout + self-service deletion page.
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AccountPage from "./account.vue";
import { useAuthStore } from "@/stores/auth";

function stubFetch(opts?: { deleteStatus?: number }): { calls: { method: string; url: string }[] } {
  const calls: { method: string; url: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ method, url });
      if (url === "/api/v1/auth/account" && method === "DELETE") {
        const status = opts?.deleteStatus ?? 200;
        return { ok: status === 200, status, json: async () => (status === 200 ? { ok: true } : null) };
      }
      if (url === "/api/v1/auth/logout" && method === "POST") {
        return { ok: true, status: 200, json: async () => ({}) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }),
  );
  return { calls };
}

describe("account page", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("uni", { navigateTo: vi.fn() });
  });

  it("shows the signed-in account id and role", async () => {
    stubFetch();
    const auth = useAuthStore();
    auth.accessToken = "t";
    auth.accountId = "42";
    auth.role = "USER";
    const wrapper = mount(AccountPage, { attachTo: document.body });
    await flushPromises();

    expect(wrapper.find('[data-testid="account-id"]').text()).toContain("42");
    expect(wrapper.find('[data-testid="account-role"]').text()).toContain("USER");
    expect(wrapper.find('[data-testid="public-computer-hint"]').text()).toContain("公共电脑");
    expect(wrapper.find('[data-testid="survey-card"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="account-signed-out"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("shows a signed-out notice and hides logout/delete when there is no session", async () => {
    stubFetch();
    const wrapper = mount(AccountPage, { attachTo: document.body });
    await flushPromises();

    expect(wrapper.find('[data-testid="account-signed-out"]').text()).toContain("未登录");
    expect(wrapper.find('[data-testid="public-computer-hint"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="account-logout"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="delete-account-open"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("logs out through the shipped logout path and goes to login", async () => {
    const { calls } = stubFetch();
    const navigateTo = vi.fn();
    vi.stubGlobal("uni", { navigateTo });
    const auth = useAuthStore();
    auth.accessToken = "t";
    auth.accountId = "42";
    auth.role = "USER";
    const wrapper = mount(AccountPage, { attachTo: document.body });
    await flushPromises();

    await wrapper.find('[data-testid="account-logout"]').trigger("click");
    await flushPromises();

    expect(calls.some((c) => c.method === "POST" && c.url === "/api/v1/auth/logout")).toBe(true);
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    expect(auth.accessToken).toBeNull();
    expect(navigateTo).toHaveBeenCalledWith({ url: "/pages/login/login" });
    wrapper.unmount();
  });

  it("deletes the account only after the two-step confirm", async () => {
    const { calls } = stubFetch();
    const navigateTo = vi.fn();
    vi.stubGlobal("uni", { navigateTo });
    const auth = useAuthStore();
    auth.accessToken = "t";
    auth.accountId = "42";
    auth.role = "USER";
    const wrapper = mount(AccountPage, { attachTo: document.body });
    await flushPromises();

    expect(wrapper.find('[data-testid="delete-account-confirm"]').exists()).toBe(false);
    await wrapper.find('[data-testid="delete-account-open"]').trigger("click");
    expect(wrapper.find('[data-testid="delete-account-confirm"]').text()).toContain(
      "合规审计日志无法立即清除",
    );
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);

    await wrapper.find('[data-testid="delete-account-confirm-btn"]').trigger("click");
    await flushPromises();

    expect(calls.some((c) => c.method === "DELETE" && c.url === "/api/v1/auth/account")).toBe(true);
    expect(auth.accessToken).toBeNull();
    expect(navigateTo).toHaveBeenCalledWith({ url: "/pages/login/login" });
    wrapper.unmount();
  });
});
