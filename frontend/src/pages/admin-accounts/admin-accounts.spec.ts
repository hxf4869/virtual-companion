// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAuthStore } from "@/stores/auth";
import { createAuthenticatedTransport } from "@/api/transport";

import AdminAccountsPage from "./admin-accounts.vue";

const activeAccount = {
  accountId: "7",
  email: "alice@example.com",
  username: "alice",
  displayName: "Alice",
  role: "USER",
  status: "ACTIVE",
  emailVerified: true,
  authenticatorEnabled: true,
  createdAt: "2026-08-01T00:00:00Z",
  reviewedAt: "2026-08-02T00:00:00Z",
};

function loginAdmin() {
  const auth = useAuthStore();
  auth.accountId = "1";
  auth.accessToken = "session";
  auth.role = "ADMIN";
}

describe("admin accounts page", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    loginAdmin();
  });

  afterEach(() => vi.unstubAllGlobals());

  it("clears admin data when context reconciliation establishes an ordinary user", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => (
      String(input) === "/api/v1/auth/session"
        ? response(200, { nextStep: "ACTIVE", accountId: "2", sessionId: "9", role: "USER",
          passwordMustChange: false, authenticatorEnabled: true, expiresInSeconds: 7200 })
        : response(200, [activeAccount])
    )));
    const wrapper = mount(AdminAccountsPage);
    await flushPromises();
    await wrapper.get('[data-testid="authenticator-reset-open"]').trigger("click");
    await wrapper.get('[data-testid="authenticator-reset-password"]').setValue("private-admin-password");
    const auth = useAuthStore();
    const transport = createAuthenticatedTransport({
      getSessionId: () => auth.getSessionId(), onUnauthorized: () => auth.clear(),
    });
    await auth.reconcileAccountContext(transport);
    await flushPromises();
    expect(auth.role).toBe("USER");
    expect(wrapper.text()).toContain("当前账号不能进入后台");
    expect(wrapper.text()).not.toContain(activeAccount.email);
    expect(wrapper.find('[data-testid="authenticator-reset-password"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="accounts-refresh"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("does not let a previous administrator's delayed list overwrite the new context", async () => {
    let resolveOld!: (value: ReturnType<typeof response>) => void;
    const old = new Promise<ReturnType<typeof response>>((resolve) => { resolveOld = resolve; });
    let reads = 0;
    vi.stubGlobal("fetch", vi.fn(async () => ++reads === 1
      ? old
      : response(200, [{ ...activeAccount, email: "new-context@example.test" }])));
    const wrapper = mount(AdminAccountsPage);
    await flushPromises();
    useAuthStore().accountId = "2";
    await flushPromises();
    await wrapper.get('[data-testid="admin-access-retry"]').trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("new-context@example.test");
    resolveOld(response(200, [activeAccount]));
    await flushPromises();
    expect(wrapper.text()).toContain("new-context@example.test");
    expect(wrapper.text()).not.toContain(activeAccount.email);
    wrapper.unmount();
  });

  it("does not continue an old authenticator reset after reauthentication returns in a new context", async () => {
    let finishReauth!: (value: ReturnType<typeof response>) => void;
    const reauth = new Promise<ReturnType<typeof response>>((resolve) => { finishReauth = resolve; });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("/reauth")
      ? reauth : response(200, [activeAccount]));
    vi.stubGlobal("fetch", fetchMock);
    const wrapper = mount(AdminAccountsPage);
    await flushPromises();
    await wrapper.get('[data-testid="authenticator-reset-open"]').trigger("click");
    await wrapper.get('[data-testid="authenticator-reset-password"]').setValue("Admin-Pass-1!");
    await wrapper.get('[data-testid="authenticator-reset-submit"]').trigger("click");
    useAuthStore().accountId = "2";
    finishReauth(response(200, { ok: true }));
    await flushPromises();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/authenticator-reset"))).toBe(false);
    expect(wrapper.text()).not.toContain(activeAccount.email);
    wrapper.unmount();
  });

  it("shows account admission and authenticator facts without secrets", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response(200, [activeAccount])));
    const wrapper = mount(AdminAccountsPage);
    await flushPromises();

    expect(wrapper.get('[data-testid="admin-accounts"]').text()).toContain("alice@example.com");
    expect(wrapper.text()).toContain("身份验证器");
    expect(wrapper.text()).toContain("已开启");
    expect(wrapper.text()).not.toContain("passwordHash");
    expect(wrapper.text()).not.toContain("recoveryCodes");
    wrapper.unmount();
  });

  it("requires reauthentication, explains impact, and resets the authenticator", async () => {
    const calls: Array<{ method: string; url: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ method, url });
      if (url === "/api/v1/admin/accounts") return response(200, [activeAccount]);
      if (url === "/api/v1/auth/reauth") return response(200, { ok: true });
      if (url.endsWith("/authenticator-reset")) return response(200, { ok: true });
      return response(404, null);
    }));
    const wrapper = mount(AdminAccountsPage);
    await flushPromises();

    await wrapper.get('[data-testid="authenticator-reset-open"]').trigger("click");
    expect(wrapper.get('[data-testid="authenticator-reset-confirm"]').text()).toContain("所有设备退出");
    expect(wrapper.get('[data-testid="authenticator-reset-confirm"]').text()).toContain("恢复码");
    await wrapper.get('[data-testid="authenticator-reset-password"]').setValue("Admin-Pass-1!");
    await wrapper.get('[data-testid="authenticator-reset-submit"]').trigger("click");
    await flushPromises();

    expect(calls).toContainEqual({ method: "POST", url: "/api/v1/auth/reauth" });
    expect(calls).toContainEqual({ method: "POST", url: "/api/v1/admin/accounts/7/authenticator-reset" });
    expect(wrapper.text()).toContain("身份验证器已重置");
    expect(wrapper.text()).toContain("需要设置");
    wrapper.unmount();
  });

  it("offers an in-place retry when the account list fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response(503, null)));
    const wrapper = mount(AdminAccountsPage);
    await flushPromises();
    expect(wrapper.get('[data-testid="accounts-load-retry"]').text()).toContain("重新加载");
    wrapper.unmount();
  });
});

function response(status: number, json: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => json,
    headers: new Headers(),
  };
}
