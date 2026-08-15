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

  it("enables submit after both fields are filled", async () => {
    const wrapper = mountPage();
    await wrapper.find('input[aria-label="用户名"]').setValue("alice");
    await wrapper.find('input[aria-label="密码"]').setValue("secret");
    expect(wrapper.find('button[data-testid="submit"]').attributes("disabled")).toBeUndefined();
    wrapper.unmount();
  });

  it("renders a back-to-index entry before submit", () => {
    const wrapper = mountPage();
    const nav = wrapper.find('[data-testid="nav-index"]');
    expect(nav.exists()).toBe(true);
    expect(nav.text()).toContain("返回边界台");
    wrapper.unmount();
  });

  it("navigates to the index page without calling login", async () => {
    const navigateTo = vi.fn();
    vi.stubGlobal("uni", { navigateTo });
    const wrapper = mountPage();
    const store = useAuthStore();
    const loginSpy = vi.spyOn(store, "login");

    await wrapper.find('[data-testid="nav-index"]').trigger("click");

    expect(navigateTo).toHaveBeenCalledWith({ url: "/pages/index/index" });
    expect(loginSpy).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("renders a chat entry before submit", () => {
    const wrapper = mountPage();
    const nav = wrapper.find('[data-testid="nav-chat"]');
    expect(nav.exists()).toBe(true);
    expect(nav.text()).toContain("离线聊天");
    wrapper.unmount();
  });

  it("navigates to the chat page without calling login", async () => {
    const navigateTo = vi.fn();
    vi.stubGlobal("uni", { navigateTo });
    const wrapper = mountPage();
    const store = useAuthStore();
    const loginSpy = vi.spyOn(store, "login");

    await wrapper.find('[data-testid="nav-chat"]').trigger("click");

    expect(navigateTo).toHaveBeenCalledWith({ url: "/pages/chat/chat" });
    expect(loginSpy).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
