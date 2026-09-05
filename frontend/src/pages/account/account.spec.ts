// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAuthStore } from "@/stores/auth";

import AccountPage from "./account.vue";

interface FetchOptions {
  devices?: unknown[];
  deviceGetStatuses?: number[];
  revokeDeviceStatus?: number;
  passwordStatus?: number;
  deleteStatus?: number;
}

function stubFetch(options: FetchOptions = {}) {
  const calls: Array<{ method: string; url: string; body?: string }> = [];
  const deviceGetStatuses = [...(options.deviceGetStatuses ?? [200])];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, url, body: typeof init?.body === "string" ? init.body : undefined });

    if (url === "/api/v1/auth/session" && method === "GET") {
      return response(401, null);
    }
    if (url === "/api/v1/auth/trusted-devices" && method === "GET") {
      const status = deviceGetStatuses.shift() ?? 200;
      return response(status, status === 200 ? (options.devices ?? []) : null);
    }
    if (url.startsWith("/api/v1/auth/trusted-devices/") && method === "DELETE") {
      const status = options.revokeDeviceStatus ?? 200;
      return response(status, status === 200 ? { ok: true } : null);
    }
    if (url === "/api/v1/auth/password" && method === "POST") {
      const status = options.passwordStatus ?? 200;
      return response(status, status === 200 ? { ok: true } : null);
    }
    if (url === "/api/v1/auth/logout" && method === "POST") {
      return response(200, { ok: true });
    }
    if (url === "/api/v1/auth/account" && method === "DELETE") {
      const status = options.deleteStatus ?? 200;
      return response(status, status === 200 ? { ok: true } : null);
    }
    return response(200, {});
  }));
  return { calls };
}

function response(status: number, json: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => json,
  };
}

function loginAs(role = "USER", email: string | null = "alice@example.com") {
  const auth = useAuthStore();
  auth.accessToken = "session";
  auth.accountId = "42";
  auth.email = email;
  auth.role = role;
  auth.authenticatorEnabled = true;
  return auth;
}

describe("account page", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("uni", {
      navigateTo: vi.fn(),
      redirectTo: vi.fn(),
    });
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("shows a recognizable email and only the three product groups", async () => {
    stubFetch();
    loginAs();
    const wrapper = mount(AccountPage, { attachTo: document.body });
    await flushPromises();

    expect(wrapper.get('[data-testid="account-email"]').text()).toBe("alice@example.com");
    expect(wrapper.findAll(".settings-section__title").map((node) => node.text())).toEqual([
      "账号",
      "安全",
      "关于",
    ]);
    expect(wrapper.text()).not.toContain("账号编号");
    expect(wrapper.text()).not.toContain("USER");
    for (const removed of ["成年状态", "同意管理", "无痕默认", "数据导出", "运行探针"]) {
      expect(wrapper.text()).not.toContain(removed);
    }
    expect(wrapper.find('[data-testid="me-admin"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("falls back to a plain signed-in label for legacy accounts without email", async () => {
    stubFetch();
    loginAs("USER", null);
    const wrapper = mount(AccountPage);
    await flushPromises();
    expect(wrapper.get('[data-testid="account-email"]').text()).toBe("已登录账号");
    wrapper.unmount();
  });

  it("keeps the AI identity boundary inline without restoring old feature routes", async () => {
    stubFetch();
    loginAs();
    const wrapper = mount(AccountPage);
    await flushPromises();
    expect(wrapper.get('[data-testid="ai-identity-note"]').text()).toContain(
      "回复由 AI 生成，并非真人",
    );
    expect(wrapper.find('[data-testid="me-data"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="me-ai-notice"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="me-help"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("shows the authenticator fact and trusted-device dates", async () => {
    stubFetch({
      devices: [{
        id: "3",
        displayName: "MacBook",
        createdAt: "2026-08-01T00:00:00Z",
        lastUsedAt: "2026-08-31T09:30:00Z",
        expiresAt: "2026-11-29T09:30:00Z",
      }],
    });
    loginAs();
    const wrapper = mount(AccountPage);
    await flushPromises();

    expect(wrapper.get('[data-testid="authenticator-status"]').text()).toContain("已开启");
    const device = wrapper.get('[data-testid="trusted-device-row"]');
    expect(device.text()).toContain("MacBook");
    expect(device.text()).toContain("最近使用");
    expect(device.text()).toContain("到期");
    expect(device.text()).not.toContain("token");
    wrapper.unmount();
  });

  it("states when the authenticator still needs setup", async () => {
    stubFetch();
    const auth = loginAs();
    auth.authenticatorEnabled = false;
    const wrapper = mount(AccountPage);
    await flushPromises();
    expect(wrapper.get('[data-testid="authenticator-status"]').text()).toContain("需要设置");
    wrapper.unmount();
  });

  it("revokes one trusted device and removes only that row", async () => {
    const { calls } = stubFetch({
      devices: [
        { id: "3", displayName: "MacBook", createdAt: "c", lastUsedAt: "l", expiresAt: "e" },
        { id: "4", displayName: "iPad", createdAt: "c", lastUsedAt: "l", expiresAt: "e" },
      ],
    });
    const auth = loginAs();
    const wrapper = mount(AccountPage);
    await flushPromises();

    await wrapper.findAll('[data-testid="trusted-device-revoke"]')[0].trigger("click");
    await flushPromises();
    expect(calls).toContainEqual(expect.objectContaining({
      method: "DELETE",
      url: "/api/v1/auth/trusted-devices/3",
    }));
    expect(wrapper.findAll('[data-testid="trusted-device-row"]')).toHaveLength(1);
    expect(wrapper.text()).toContain("iPad");
    expect(auth.isAuthenticated).toBe(true);
    wrapper.unmount();
  });

  it("keeps the device and offers a useful retry after revoke failure", async () => {
    stubFetch({
      revokeDeviceStatus: 503,
      devices: [{ id: "3", displayName: "MacBook", createdAt: "c", lastUsedAt: "l", expiresAt: "e" }],
    });
    loginAs();
    const wrapper = mount(AccountPage);
    await flushPromises();

    await wrapper.get('[data-testid="trusted-device-revoke"]').trigger("click");
    await flushPromises();
    expect(wrapper.findAll('[data-testid="trusted-device-row"]')).toHaveLength(1);
    expect(wrapper.get('[data-testid="trusted-device-action-error"]').text()).toContain("再试一次");
    wrapper.unmount();
  });

  it("retries the trusted-device list in place", async () => {
    stubFetch({ deviceGetStatuses: [503, 200] });
    loginAs();
    const wrapper = mount(AccountPage);
    await flushPromises();
    expect(wrapper.get('[data-testid="trusted-devices-error"]').text()).toContain("没有加载出来");

    await wrapper.get('[data-testid="trusted-devices-retry"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="trusted-devices-error"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="trusted-devices"]').text()).toContain("暂无信任的设备");
    wrapper.unmount();
  });

  it("keeps password fields collapsed until requested and logs out after success", async () => {
    const { calls } = stubFetch();
    const auth = loginAs();
    const wrapper = mount(AccountPage);
    await flushPromises();
    expect(wrapper.find('[data-testid="password-form"]').exists()).toBe(false);

    await wrapper.get('[data-testid="password-toggle"]').trigger("click");
    await wrapper.get('[data-testid="current-password"]').setValue("OldPass1!");
    await wrapper.get('[data-testid="new-password"]').setValue("NewPass1!");
    await wrapper.get('[data-testid="confirm-password"]').setValue("NewPass1!");
    await wrapper.get('[data-testid="change-password"]').trigger("click");
    await flushPromises();

    expect(calls).toContainEqual(expect.objectContaining({ method: "POST", url: "/api/v1/auth/password" }));
    expect(auth.isAuthenticated).toBe(false);
    expect((globalThis as unknown as {
      uni: { navigateTo: ReturnType<typeof vi.fn> };
    }).uni.navigateTo)
      .toHaveBeenCalledWith({ url: "/pages/login/login" });
    wrapper.unmount();
  });

  it("opens password change immediately for a required-password session", async () => {
    stubFetch();
    const auth = loginAs();
    auth.passwordMustChange = true;
    const wrapper = mount(AccountPage);
    await flushPromises();
    expect(wrapper.get('[data-testid="password-required"]').text()).toContain("先设置一个新密码");
    expect(wrapper.find('[data-testid="password-form"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("logs out through the shipped endpoint", async () => {
    const { calls } = stubFetch();
    const auth = loginAs();
    const wrapper = mount(AccountPage);
    await flushPromises();

    await wrapper.get('[data-testid="account-logout"]').trigger("click");
    await flushPromises();
    expect(calls).toContainEqual(expect.objectContaining({ method: "POST", url: "/api/v1/auth/logout" }));
    expect(auth.isAuthenticated).toBe(false);
    wrapper.unmount();
  });

  it("requires the current password before account deletion", async () => {
    const { calls } = stubFetch();
    const auth = loginAs();
    const wrapper = mount(AccountPage);
    await flushPromises();

    await wrapper.get('[data-testid="delete-account-open"]').trigger("click");
    await wrapper.get('[data-testid="delete-account-confirm-btn"]').trigger("click");
    expect(wrapper.get('[data-testid="delete-account-error"]').text()).toContain("当前密码");
    expect(calls.some((call) => call.method === "DELETE")).toBe(false);

    await wrapper.get('[data-testid="delete-account-password"]').setValue("Current-Pass-1!");
    await wrapper.get('[data-testid="delete-account-confirm-btn"]').trigger("click");
    await flushPromises();
    expect(calls).toContainEqual(expect.objectContaining({ method: "DELETE", url: "/api/v1/auth/account" }));
    expect(auth.isAuthenticated).toBe(false);
    wrapper.unmount();
  });

  it("shows the admin entry only to an administrator", async () => {
    stubFetch();
    loginAs("ADMIN");
    const wrapper = mount(AccountPage);
    await flushPromises();
    expect(wrapper.find('[data-testid="me-admin"]').exists()).toBe(true);
    await wrapper.get('[data-testid="me-admin"]').trigger("click");
    expect((globalThis as unknown as {
      uni: { navigateTo: ReturnType<typeof vi.fn> };
    }).uni.navigateTo)
      .toHaveBeenCalledWith({ url: "/pages/admin/admin" });
    wrapper.unmount();
  });

  it("renders a signed-out state without account actions", async () => {
    stubFetch();
    const auth = useAuthStore();
    auth.clear();
    const wrapper = mount(AccountPage);
    await flushPromises();
    expect(wrapper.get('[data-testid="account-signed-out"]').text()).toContain("登录后");
    expect(wrapper.find('[data-testid="account-logout"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="delete-account-open"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
