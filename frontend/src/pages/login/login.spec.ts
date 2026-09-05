// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

import LoginPage from "./login.vue";
import { useAuthStore } from "@/stores/auth";

const WdConfigProviderStub = defineComponent({
  template: "<div><slot /></div>",
});

const CheckboxGroupStub = defineComponent({
  template: "<div><slot /></div>",
});

const CheckboxStub = defineComponent({
  props: {
    checked: Boolean,
    disabled: Boolean,
  },
  template: '<input type="checkbox" :checked="checked" :disabled="disabled" />',
});

const WdButtonStub = defineComponent({
  inheritAttrs: false,
  props: {
    disabled: Boolean,
    loading: Boolean,
  },
  emits: ["click"],
  methods: {
    activate(event: Event) {
      if (!this.disabled && !this.loading) this.$emit("click", event);
    },
  },
  template: `
    <button
      v-bind="$attrs"
      :disabled="disabled || loading"
      @click="activate"
    ><slot /></button>
  `,
});

function mountPage() {
  return mount(LoginPage, {
    attachTo: document.body,
    global: {
      stubs: {
        "wd-config-provider": WdConfigProviderStub,
        WdConfigProvider: WdConfigProviderStub,
        "wd-button": WdButtonStub,
        WdButton: WdButtonStub,
        "checkbox-group": CheckboxGroupStub,
        checkbox: CheckboxStub,
      },
    },
  });
}

async function fillCredentials(wrapper: ReturnType<typeof mountPage>) {
  await wrapper.find('input[aria-label="账号"]').setValue("alice@example.com");
  await wrapper.find('input[aria-label="密码"]').setValue("secret-password");
}

describe("redesigned authentication entry", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    setActivePinia(createPinia());
    vi.stubGlobal("uni", undefined);
    vi.stubGlobal("location", {
      pathname: "/",
      search: "",
      hash: "#/pages/login/login",
      href: "http://localhost/#/pages/login/login",
    });
    vi.spyOn(useAuthStore(), "loadRegistrationStatus").mockResolvedValue(false);
  });

  it("renders the product login contract without legacy technical surfaces", () => {
    const wrapper = mountPage();
    expect(wrapper.find('input[aria-label="账号"]').exists()).toBe(true);
    expect(wrapper.find('input[aria-label="密码"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("注册暂未开放");
    expect(wrapper.text()).toContain("AI 陪伴者 · 非真人");
    expect(wrapper.text()).not.toContain("Technical Alpha");
    expect(wrapper.text()).not.toContain("请求编号");
    expect(wrapper.find('[data-testid="nav-chat"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("shows a recoverable credential error and returns focus to account", async () => {
    const store = useAuthStore();
    vi.spyOn(store, "login").mockImplementation(async () => {
      store.error = "invalid-credentials";
      return null;
    });
    const wrapper = mountPage();
    await fillCredentials(wrapper);
    await wrapper.find('[data-testid="submit"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[role="alert"]').text()).toContain("账号或密码不正确");
    expect(document.activeElement?.getAttribute("data-testid")).toBe("account");
    wrapper.unmount();
  });

  it("keeps the submit action disabled until both fields have values", async () => {
    const store = useAuthStore();
    const loginSpy = vi.spyOn(store, "login").mockResolvedValue(null);
    const wrapper = mountPage();
    expect(wrapper.find('[data-testid="submit"]').attributes("disabled")).toBeDefined();
    await wrapper.find('input[aria-label="账号"]').setValue("alice@example.com");
    expect(wrapper.find('[data-testid="submit"]').attributes("disabled")).toBeDefined();
    await wrapper.find('[data-testid="submit"]').trigger("click");
    expect(loginSpy).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("submits an administrator username without email-only validation", async () => {
    const store = useAuthStore();
    const loginSpy = vi.spyOn(store, "login").mockImplementation(async () => {
      store.nextStep = "TOTP_REQUIRED";
      store.challengeId = "a".repeat(43);
      return "TOTP_REQUIRED";
    });
    const wrapper = mountPage();
    await wrapper.find('input[aria-label="账号"]').setValue("admin");
    await wrapper.find('input[aria-label="密码"]').setValue("secret-password");
    await wrapper.find('[data-testid="submit"]').trigger("click");
    await flushPromises();

    expect(loginSpy).toHaveBeenCalledWith(expect.anything(), "admin", "secret-password");
    expect(wrapper.text()).toContain("验证登录");
    expect(wrapper.text()).not.toContain("请输入正确的邮箱地址");
    wrapper.unmount();
  });

  it("follows TOTP_REQUIRED and exposes a real six-digit input plus recovery entry", async () => {
    const store = useAuthStore();
    vi.spyOn(store, "login").mockImplementation(async () => {
      store.nextStep = "TOTP_REQUIRED";
      store.challengeId = "a".repeat(43);
      return "TOTP_REQUIRED";
    });
    const wrapper = mountPage();
    await fillCredentials(wrapper);
    await wrapper.find('[data-testid="submit"]').trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("验证登录");
    expect(wrapper.find('input[autocomplete="one-time-code"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("信任此设备 90 天");
    expect(wrapper.find('[data-testid="use-recovery-code"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("verifies TOTP with trust-device defaulting to false and enters home", async () => {
    const store = useAuthStore();
    vi.spyOn(store, "login").mockImplementation(async () => {
      store.nextStep = "TOTP_REQUIRED";
      store.challengeId = "a".repeat(43);
      return "TOTP_REQUIRED";
    });
    const verifySpy = vi.spyOn(store, "verifyAuthenticatorCode").mockResolvedValue(true);
    const redirectTo = vi.fn();
    vi.stubGlobal("uni", { redirectTo });
    const wrapper = mountPage();
    await fillCredentials(wrapper);
    await wrapper.find('[data-testid="submit"]').trigger("click");
    await flushPromises();
    await wrapper.find('input[aria-label="6 位身份验证器验证码"]').setValue("123456");
    await wrapper.find('[data-testid="totp-submit"]').trigger("click");
    await flushPromises();

    expect(verifySpy).toHaveBeenCalledWith(expect.anything(), "123456", false);
    expect(redirectTo).toHaveBeenCalledWith({ url: "/pages/index/index" });
    wrapper.unmount();
  });

  it("uses a recovery code as the secondary daily-login path", async () => {
    const store = useAuthStore();
    vi.spyOn(store, "login").mockResolvedValue("TOTP_REQUIRED");
    const verifySpy = vi.spyOn(store, "verifyRecoveryCode").mockResolvedValue(true);
    const redirectTo = vi.fn();
    vi.stubGlobal("uni", { redirectTo });
    const wrapper = mountPage();
    await fillCredentials(wrapper);
    await wrapper.find('[data-testid="submit"]').trigger("click");
    await flushPromises();
    await wrapper.find('[data-testid="use-recovery-code"]').trigger("click");
    await wrapper.find('input[aria-label="恢复码"]').setValue("ABCD-EFGH-IJKL-MNOP");
    await wrapper.find('[data-testid="recovery-submit"]').trigger("click");
    await flushPromises();

    expect(verifySpy).toHaveBeenCalledWith(
      expect.anything(),
      "ABCD-EFGH-IJKL-MNOP",
      false,
    );
    expect(redirectTo).toHaveBeenCalledWith({ url: "/pages/index/index" });
    wrapper.unmount();
  });

  it("completes first authenticator setup before showing one-time recovery codes", async () => {
    const store = useAuthStore();
    vi.spyOn(store, "login").mockResolvedValue("AUTHENTICATOR_SETUP_REQUIRED");
    vi.spyOn(store, "loadAuthenticatorSetup").mockImplementation(async () => {
      store.authenticatorSetup = {
        manualKey: "ABCDEFGHIJKLMNOP",
        provisioningUri: "otpauth://totp/Virtual%20Companion:alice",
        qrCodeDataUrl: "data:image/png;base64,abc",
      };
      return true;
    });
    vi.spyOn(store, "confirmAuthenticator").mockImplementation(async () => {
      store.recoveryCodes = Array.from({ length: 10 }, (_, index) => `CODE-${index}`);
      return true;
    });
    const redirectTo = vi.fn();
    vi.stubGlobal("uni", { redirectTo });
    const wrapper = mountPage();
    await fillCredentials(wrapper);
    await wrapper.find('[data-testid="submit"]').trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("设置身份验证器");
    expect(wrapper.text()).toContain("ABCDEFGHIJKLMNOP");
    await wrapper.find('input[aria-label="6 位身份验证器验证码"]').setValue("654321");
    await wrapper.find('[data-testid="setup-submit"]').trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("保存恢复码");
    expect(wrapper.text()).toContain("CODE-0");
    await wrapper.find('[data-testid="recovery-continue"]').trigger("click");
    expect(redirectTo).toHaveBeenCalledWith({ url: "/pages/index/index" });
    wrapper.unmount();
  });

  it("renders pending review as a non-chat admission result", async () => {
    const store = useAuthStore();
    vi.spyOn(store, "login").mockImplementation(async () => {
      store.nextStep = "REVIEW_PENDING";
      return "REVIEW_PENDING";
    });
    const wrapper = mountPage();
    await fillCredentials(wrapper);
    await wrapper.find('[data-testid="submit"]').trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("账号正在审核");
    expect(wrapper.text()).toContain("审核通过后才能聊天");
    expect(wrapper.find("textarea").exists()).toBe(false);
    wrapper.unmount();
  });

  it("restores the captured route after a trusted-device ACTIVE login", async () => {
    const store = useAuthStore();
    vi.spyOn(store, "login").mockResolvedValue("ACTIVE");
    const redirectTo = vi.fn();
    vi.stubGlobal("uni", { redirectTo });
    vi.stubGlobal("location", {
      pathname: "/",
      search: "",
      hash: "#/pages/login/login?return=%2Fpages%2Fchat%2Fchat%3FrelationshipId%3D7",
      href: "http://localhost/#/pages/login/login?return=%2Fpages%2Fchat%2Fchat%3FrelationshipId%3D7",
    });
    const wrapper = mountPage();
    await fillCredentials(wrapper);
    await wrapper.find('[data-testid="submit"]').trigger("click");
    await flushPromises();
    expect(redirectTo).toHaveBeenCalledWith({
      url: "/pages/chat/chat?relationshipId=7",
    });
    wrapper.unmount();
  });
});
