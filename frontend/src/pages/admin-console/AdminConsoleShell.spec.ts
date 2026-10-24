// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAuthenticatedTransport } from "@/api/transport";
import { useAuthStore } from "@/stores/auth";

import AdminConsoleShell from "./AdminConsoleShell.vue";

function loginAsAdmin() {
  const auth = useAuthStore();
  auth.accessToken = "session";
  auth.accountId = "7";
  auth.email = "admin@example.com";
  auth.role = "ADMIN";
  return auth;
}

describe("admin console shell", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("offers an explicit retry when access cannot be checked", async () => {
    const wrapper = mount(AdminConsoleShell, {
      props: {
        active: "review",
        title: "注册审核",
        accessState: "unavailable",
      },
    });

    await wrapper.get('[data-testid="admin-access-retry"]').trigger("click");

    expect(wrapper.emitted("retry-access")).toHaveLength(1);
    wrapper.unmount();
  });

  it("renders exactly the four product admin sections", () => {
    const wrapper = mount(AdminConsoleShell, {
      props: {
        active: "review",
        title: "注册审核",
        accessState: "ready",
      },
    });
    expect(wrapper.findAll(".ac-nav__item").map((item) => item.text())).toEqual([
      "注册审核",
      "账号",
      "模型与路由",
      "运行状态",
    ]);
    wrapper.unmount();
  });

  it("asks the browser to retain a page that has staged changes", () => {
    const wrapper = mount(AdminConsoleShell, {
      props: {
        active: "models",
        title: "模型服务",
        accessState: "ready",
        hasPendingChanges: true,
      },
    });
    const event = new Event("beforeunload", { cancelable: true });

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    wrapper.unmount();
  });

  it("logs out and returns to the login page when it owns the local clear", async () => {
    const calls: Array<{ method: string; url: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ method, url });
      if (url === "/api/v1/auth/logout" && method === "POST") {
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }));
    const redirectTo = vi.fn();
    vi.stubGlobal("uni", { redirectTo, navigateTo: vi.fn() });
    const auth = loginAsAdmin();
    const wrapper = mount(AdminConsoleShell, {
      props: { active: "review", title: "注册审核", accessState: "ready" },
    });

    const logoutButton = wrapper
      .findAll(".ac-footer-action")
      .find((button) => button.text().includes("退出登录"));
    expect(logoutButton).toBeDefined();
    await logoutButton!.trigger("click");
    await flushPromises();

    expect(calls).toContainEqual({ method: "POST", url: "/api/v1/auth/logout" });
    expect(auth.isAuthenticated).toBe(false);
    expect(redirectTo).toHaveBeenCalledWith({ url: "/pages/login/login" });
    wrapper.unmount();
  });

  it("VC-R164: 退出 503 无法确认：提示可重试、身份保留、不导航；重试成功后正常退出", async () => {
    let logoutStatus = 503;
    const calls: Array<{ method: string; url: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ method, url });
      if (url === "/api/v1/auth/logout" && method === "POST") {
        return {
          ok: logoutStatus === 200,
          status: logoutStatus,
          json: async () => ({ ok: logoutStatus === 200 }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }));
    const redirectTo = vi.fn();
    vi.stubGlobal("uni", { redirectTo, navigateTo: vi.fn() });
    const auth = loginAsAdmin();
    const wrapper = mount(AdminConsoleShell, {
      props: { active: "review", title: "注册审核", accessState: "ready" },
    });
    try {

      const logoutButton = wrapper
        .findAll(".ac-footer-action")
        .find((button) => button.text().includes("退出登录"));
      await logoutButton!.trigger("click");
      await flushPromises();
      // 服务端未确认撤销：本地身份保留、不导航，退出按钮附近给出可重试提示。
      expect(wrapper.get(".ac-message--warning").text()).toBe("暂时无法确认退出结果，请重试。");
      expect(auth.isAuthenticated).toBe(true);
      expect(redirectTo).not.toHaveBeenCalledWith({ url: "/pages/login/login" });
      expect(logoutButton!.attributes("disabled")).toBeUndefined();

      // 重试成功：正常清理并返回登录页，提示随新一轮退出入口清空。
      logoutStatus = 200;
      await logoutButton!.trigger("click");
      await flushPromises();
      expect(auth.isAuthenticated).toBe(false);
      expect(redirectTo).toHaveBeenCalledWith({ url: "/pages/login/login" });
    } finally {
      wrapper.unmount();
    }
  });

  it("VC-R12: 迟到的旧登出不得清掉换号后的身份，也不得导航回登录页", async () => {
    let releaseLogout!: (value: unknown) => void;
    const logoutGate = new Promise<unknown>((resolve) => {
      releaseLogout = resolve;
    });
    const calls: Array<{ method: string; url: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ method, url });
      if (url === "/api/v1/auth/logout" && method === "POST") {
        return logoutGate.then(() => ({ ok: true, status: 200, json: async () => ({ ok: true }) }));
      }
      if (url === "/api/v1/auth/login" && method === "POST") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            nextStep: "ACTIVE",
            accountId: "43",
            email: "b@example.com",
            role: "USER",
            sessionId: "9",
            passwordMustChange: false,
            authenticatorEnabled: true,
            expiresInSeconds: 7200,
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }));
    const redirectTo = vi.fn();
    const navigateTo = vi.fn();
    vi.stubGlobal("uni", { redirectTo, navigateTo });
    const auth = loginAsAdmin();
    const wrapper = mount(AdminConsoleShell, {
      props: { active: "review", title: "注册审核", accessState: "ready" },
    });

    const logoutButton = wrapper
      .findAll(".ac-footer-action")
      .find((button) => button.text().includes("退出登录"));
    await logoutButton!.trigger("click");
    await flushPromises();
    expect(calls.filter((call) => call.url === "/api/v1/auth/logout")).toHaveLength(1);

    const transport = createAuthenticatedTransport({
      getAccessToken: () => auth.accessToken,
      getSessionRevision: () => auth.getSessionRevision(),
      getSessionId: () => null,
      onUnauthorized: () => auth.onUnauthorized(),
    });
    await auth.login(transport, "b@example.com", "pw-b");
    await flushPromises();

    // 旧登出迟到返回 ok:true：B 的本地身份保留，后台不被拽回登录页。
    releaseLogout(undefined);
    await flushPromises();
    expect(auth.accountId).toBe("43");
    expect(auth.isAuthenticated).toBe(true);
    expect(redirectTo).not.toHaveBeenCalledWith({ url: "/pages/login/login" });
    expect(navigateTo).not.toHaveBeenCalledWith({ url: "/pages/login/login" });
    wrapper.unmount();
  });

  it("VC-R39: 确认窗等待期间凭据已被另一标签页换装时，确认旧退出草稿只提示重新确认", async () => {
    const calls: Array<{ method: string; url: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ method, url });
      // VC-R169: the cancellation branch discovers the current identity; the
      // other tab's newer session answers the discovery with a valid identity.
      if (url === "/api/v1/auth/session" && method === "GET") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            nextStep: "ACTIVE",
            accountId: "7",
            sessionId: "900",
            email: "admin@example.com",
            role: "ADMIN",
            passwordMustChange: false,
            authenticatorEnabled: true,
            expiresInSeconds: 7200,
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }));
    const redirectTo = vi.fn();
    const navigateTo = vi.fn();
    let discardModal!: { success: (result: { confirm?: boolean }) => void };
    vi.stubGlobal("uni", {
      redirectTo,
      navigateTo,
      showModal: (options: typeof discardModal) => {
        discardModal = options;
      },
    });
    document.cookie = "vc_csrf=synthetic-before-confirm";
    const auth = loginAsAdmin();
    const wrapper = mount(AdminConsoleShell, {
      props: { active: "models", title: "模型服务", accessState: "ready", hasPendingChanges: true },
    });

    const logoutButton = wrapper
      .findAll(".ac-footer-action")
      .find((button) => button.text().includes("退出登录"));
    await logoutButton!.trigger("click");
    await flushPromises();
    expect(wrapper.find('[role="status"]').exists()).toBe(false);

    // 确认窗仍开着时，另一标签页登录换装了共享 cookie jar 里的 CSRF。
    document.cookie = "vc_csrf=synthetic-after-other-tab-login";
    discardModal.success({ confirm: true });
    await flushPromises();

    expect(calls.filter((call) => call.url === "/api/v1/auth/logout")).toHaveLength(0);
    expect(auth.isAuthenticated).toBe(true);
    expect(redirectTo).not.toHaveBeenCalled();
    expect(navigateTo).not.toHaveBeenCalled();
    expect(wrapper.get('[role="status"]').text()).toBe("登录状态已更新，请重新确认退出");

    // VC-R169: 取消分支必须发现当前 Cookie 身份（GET /auth/session），
    // 否则二次确认仍持旧会话编号，新前置下必然 409。
    expect(
      calls.some((call) => call.method === "GET" && call.url === "/api/v1/auth/session"),
      "CSRF-change cancellation must discover the current identity",
    ).toBe(true);

    document.cookie = "vc_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    wrapper.unmount();
  });
});
