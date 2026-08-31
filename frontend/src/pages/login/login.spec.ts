// @vitest-environment happy-dom
// TASK-0106 (P2-19): login page component glue test -- stable aria-labels,
// alert semantics on the error region, aria-busy while submitting and focus
// returning to the username field after a failed attempt (P3-04).
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import LoginPage from "./login.vue";
import { useAuthStore } from "@/stores/auth";

function mountPage() {
  return mount(LoginPage, { attachTo: document.body });
}

describe("login page glue (P2-19 component test)", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("uni", undefined);
    vi.stubGlobal("location", { pathname: "/", search: "", hash: "", href: "http://localhost/" });
  });

  it("renders stable aria-labels for both inputs (P3-04)", () => {
    const wrapper = mountPage();
    expect(wrapper.find('input[aria-label="用户名"]').exists()).toBe(true);
    expect(wrapper.find('input[aria-label="密码"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("announces a failed login via role=alert and refocuses the username field", async () => {
    const store = useAuthStore();
    const loginSpy = vi.spyOn(store, "login").mockResolvedValue(false);
    const wrapper = mountPage();

    await wrapper.find('input[aria-label="用户名"]').setValue("alice");
    await wrapper.find('input[aria-label="密码"]').setValue("wrong");
    await wrapper.find('button[data-testid="submit"]').trigger("click");
    await wrapper.vm.$nextTick();

    expect(loginSpy).toHaveBeenCalledTimes(1);
    const alert = wrapper.find('[role="alert"]');
    expect(alert.exists()).toBe(true);
    expect(alert.text()).toContain("用户名或密码错误");
    expect(document.activeElement?.getAttribute("data-testid")).toBe("username");
    wrapper.unmount();
  });

  it("submits from the password field with the Enter key", async () => {
    const store = useAuthStore();
    const loginSpy = vi.spyOn(store, "login").mockResolvedValue(false);
    const wrapper = mountPage();

    await wrapper.find('input[aria-label="用户名"]').setValue("alice");
    const password = wrapper.find('input[aria-label="密码"]');
    await password.setValue("wrong");
    await password.trigger("keydown", { key: "Enter" });

    expect(loginSpy).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("REQ-ID: a failed login shows the last request id when one was recorded", async () => {
    const { rememberRequestId } = await import("@/domain/request-id");
    rememberRequestId("req-login-1");
    const store = useAuthStore();
    vi.spyOn(store, "login").mockResolvedValue(false);
    const wrapper = mountPage();

    await wrapper.find('input[aria-label="用户名"]').setValue("alice");
    await wrapper.find('input[aria-label="密码"]').setValue("wrong");
    await wrapper.find('button[data-testid="submit"]').trigger("click");
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="login-request-id"]').text()).toContain("req-login-1");
    rememberRequestId(null);
    wrapper.unmount();
  });

  it("marks the submit button aria-busy while submitting", async () => {
    const store = useAuthStore();
    let resolveLogin!: (v: boolean) => void;
    vi.spyOn(store, "login").mockImplementation(
      () => new Promise<boolean>((resolve) => {
        resolveLogin = resolve;
      }),
    );
    const wrapper = mountPage();
    await wrapper.find('input[aria-label="用户名"]').setValue("alice");
    await wrapper.find('input[aria-label="密码"]').setValue("secret");
    await wrapper.find('button[data-testid="submit"]').trigger("click");
    await wrapper.vm.$nextTick();
    expect(wrapper.find('button[data-testid="submit"]').attributes("aria-busy")).toBe("true");
    resolveLogin(false);
    await vi.waitFor(() => {
      expect(wrapper.find('button[data-testid="submit"]').attributes("aria-busy")).toBe("false");
    });
    wrapper.unmount();
  });

  it("disables submit and does not call login when a field is empty", async () => {
    const store = useAuthStore();
    const loginSpy = vi.spyOn(store, "login").mockResolvedValue(false);
    const wrapper = mountPage();

    expect(wrapper.find('button[data-testid="submit"]').attributes("disabled")).toBeDefined();
    await wrapper.find('button[data-testid="submit"]').trigger("click");
    expect(loginSpy).not.toHaveBeenCalled();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);

    await wrapper.find('input[aria-label="用户名"]').setValue("alice");
    expect(wrapper.find('button[data-testid="submit"]').attributes("disabled")).toBeDefined();
    await wrapper.find('button[data-testid="submit"]').trigger("click");
    expect(loginSpy).not.toHaveBeenCalled();

    wrapper.unmount();
  });

  it("S0-15 sends a temporary-password session directly to the forced change flow", async () => {
    const store = useAuthStore();
    vi.spyOn(store, "login").mockImplementation(async () => {
      store.passwordMustChange = true;
      return true;
    });
    const redirectTo = vi.fn();
    vi.stubGlobal("uni", { redirectTo });
    const wrapper = mountPage();
    await wrapper.find('input[aria-label="用户名"]').setValue("alice");
    await wrapper.find('input[aria-label="密码"]').setValue("temporary");
    await wrapper.find('button[data-testid="submit"]').trigger("click");
    await wrapper.vm.$nextTick();

    expect(redirectTo).toHaveBeenCalledWith({
      url: "/pages/account/account?passwordChange=required",
    });
    wrapper.unmount();
  });

  it("NEXT-STEP: after login with no companion, goes to the unified creation flow", async () => {
    const store = useAuthStore();
    vi.spyOn(store, "login").mockResolvedValue(true);
    const redirectTo = vi.fn();
    vi.stubGlobal("uni", { redirectTo });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "/api/v1/age/state") {
          return { ok: true, status: 200, json: async () => ({ ageState: "ADULT_VERIFIED" }) };
        }
        if (url === "/api/v1/consents") {
          return {
            ok: true,
            status: 200,
            json: async () => [
              { consentId: "1", consentType: "SERVICE_TERMS", version: "2026-08", granted: true, grantedAt: "t" },
              { consentId: "2", consentType: "PRIVACY_POLICY", version: "2026-08", granted: true, grantedAt: "t" },
              { consentId: "3", consentType: "AI_CONTENT_NOTICE", version: "2026-08", granted: true, grantedAt: "t" },
              { consentId: "4", consentType: "THIRD_PARTY_MODEL_PROCESSING", version: "2026-08", granted: true, grantedAt: "t" },
              { consentId: "5", consentType: "SENSITIVE_DATA_PROCESSING", version: "2026-08", granted: true, grantedAt: "t" },
            ],
          };
        }
        if (url === "/api/v1/relationships") {
          return { ok: true, status: 200, json: async () => [] };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      }),
    );
    const wrapper = mountPage();
    await wrapper.find('input[aria-label="用户名"]').setValue("alice");
    await wrapper.find('input[aria-label="密码"]').setValue("secret");
    await wrapper.find('button[data-testid="submit"]').trigger("click");
    const { flushPromises } = await import("@vue/test-utils");
    await flushPromises();
    expect(redirectTo).toHaveBeenCalledWith({ url: "/pages/companion/companion" });
    wrapper.unmount();
  });

  it("S0-18: after login restores the captured path and query", async () => {
    const store = useAuthStore();
    vi.spyOn(store, "login").mockResolvedValue(true);
    const redirectTo = vi.fn();
    vi.stubGlobal("uni", { redirectTo });
    vi.stubGlobal("location", {
      pathname: "/",
      search: "",
      hash: "#/pages/login/login?return=%2Fpages%2Fmemory%2Fmemory%3FrelationshipId%3D7",
      href: "http://localhost/#/pages/login/login?return=%2Fpages%2Fmemory%2Fmemory%3FrelationshipId%3D7",
    });
    const wrapper = mountPage();
    await wrapper.find('input[aria-label="用户名"]').setValue("alice");
    await wrapper.find('input[aria-label="密码"]').setValue("secret");
    await wrapper.find('button[data-testid="submit"]').trigger("click");
    const { flushPromises } = await import("@vue/test-utils");
    await flushPromises();
    expect(redirectTo).toHaveBeenCalledWith({
      url: "/pages/memory/memory?relationshipId=7",
    });
    wrapper.unmount();
  });

  it("enables submit after both fields are filled", async () => {
    const wrapper = mountPage();
    await wrapper.find('input[aria-label="用户名"]').setValue("alice");
    await wrapper.find('input[aria-label="密码"]').setValue("secret");
    expect(wrapper.find('button[data-testid="submit"]').attributes("disabled")).toBeUndefined();
    wrapper.unmount();
  });

  // 前端产品化重构：登录页只保留登录主层级（375px 溢出根因的边界台导航
  // 入口已移除）。准入前的可达路径由 nav-guard 守卫保证，不再在登录页
  // 平铺内部导航。
  it("does not expose internal page entries before submit", () => {
    const wrapper = mountPage();
    expect(wrapper.find('[data-testid="nav-index"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="nav-chat"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="nav-memory"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("does not expose the retired invitation registration surface", () => {
    const wrapper = mountPage();
    expect(wrapper.find('[data-testid="invite-toggle"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="invite-panel"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
