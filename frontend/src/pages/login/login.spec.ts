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
    await wrapper.find('button[data-testid="submit"]').trigger("click");
    await wrapper.vm.$nextTick();
    expect(wrapper.find('button[data-testid="submit"]').attributes("aria-busy")).toBe("true");
    resolveLogin(false);
    await vi.waitFor(() => {
      expect(wrapper.find('button[data-testid="submit"]').attributes("aria-busy")).toBe("false");
    });
    wrapper.unmount();
  });
});
