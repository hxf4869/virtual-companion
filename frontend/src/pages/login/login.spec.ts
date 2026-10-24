// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

import LoginPage from "./login.vue";
import type { AuthApiResponse, AuthTransport } from "@/api/auth";
import { useAuthStore } from "@/stores/auth";

type AuthFlowStepResult = ReturnType<typeof useAuthStore>["nextStep"];

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

  it("VC-R03: moves TOTP failure to the expired view when the challenge is unusable", async () => {
    const store = useAuthStore();
    vi.spyOn(store, "login").mockImplementation(async () => {
      store.nextStep = "TOTP_REQUIRED";
      store.challengeId = "a".repeat(43);
      return "TOTP_REQUIRED";
    });
    vi.spyOn(store, "verifyAuthenticatorCode").mockImplementation(async () => {
      store.error = "challenge-unavailable";
      return false;
    });
    const wrapper = mountPage();
    await fillCredentials(wrapper);
    await wrapper.find('[data-testid="submit"]').trigger("click");
    await flushPromises();
    await wrapper.find('input[aria-label="6 位身份验证器验证码"]').setValue("123456");
    await wrapper.find('[data-testid="totp-submit"]').trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("本次登录已结束");
    expect(wrapper.text()).toContain("本次登录验证已失效，请重新输入账号和密码。");
    expect(wrapper.text()).toContain("重新登录");
    expect(wrapper.text()).not.toContain("请返回后重新登录");
    wrapper.unmount();
  });

  it("VC-R03: keeps an inline wrong-code message on the TOTP view", async () => {
    const store = useAuthStore();
    vi.spyOn(store, "login").mockImplementation(async () => {
      store.nextStep = "TOTP_REQUIRED";
      store.challengeId = "a".repeat(43);
      return "TOTP_REQUIRED";
    });
    vi.spyOn(store, "verifyAuthenticatorCode").mockImplementation(async () => {
      store.error = "invalid-code";
      return false;
    });
    const wrapper = mountPage();
    await fillCredentials(wrapper);
    await wrapper.find('[data-testid="submit"]').trigger("click");
    await flushPromises();
    await wrapper.find('input[aria-label="6 位身份验证器验证码"]').setValue("123456");
    await wrapper.find('[data-testid="totp-submit"]').trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("验证登录");
    expect(wrapper.text()).toContain("验证码不正确，请重新输入。");
    expect(wrapper.text()).not.toContain("本次登录已结束");
    wrapper.unmount();
  });

  it("VC-R03: keeps the network copy inline instead of ending the login session", async () => {
    const store = useAuthStore();
    vi.spyOn(store, "login").mockImplementation(async () => {
      store.nextStep = "TOTP_REQUIRED";
      store.challengeId = "a".repeat(43);
      return "TOTP_REQUIRED";
    });
    vi.spyOn(store, "verifyAuthenticatorCode").mockImplementation(async () => {
      store.error = "network-failed";
      return false;
    });
    const wrapper = mountPage();
    await fillCredentials(wrapper);
    await wrapper.find('[data-testid="submit"]').trigger("click");
    await flushPromises();
    await wrapper.find('input[aria-label="6 位身份验证器验证码"]').setValue("123456");
    await wrapper.find('[data-testid="totp-submit"]').trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("网络连接不稳定，请检查网络后重试。");
    expect(wrapper.text()).not.toContain("本次登录已结束");
    wrapper.unmount();
  });

  it("VC-R03: moves a recovery-code failure to the expired view when the challenge is unusable", async () => {
    const store = useAuthStore();
    vi.spyOn(store, "login").mockResolvedValue("TOTP_REQUIRED");
    vi.spyOn(store, "verifyRecoveryCode").mockImplementation(async () => {
      store.error = "challenge-unavailable";
      return false;
    });
    const wrapper = mountPage();
    await fillCredentials(wrapper);
    await wrapper.find('[data-testid="submit"]').trigger("click");
    await flushPromises();
    await wrapper.find('[data-testid="use-recovery-code"]').trigger("click");
    await wrapper.find('input[aria-label="恢复码"]').setValue("ABCD-EFGH-IJKL-MNOP");
    await wrapper.find('[data-testid="recovery-submit"]').trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("本次登录已结束");
    expect(wrapper.text()).toContain("本次登录验证已失效，请重新输入账号和密码。");
    expect(wrapper.text()).toContain("重新登录");
    expect(wrapper.text()).not.toContain("请返回后重新登录");
    wrapper.unmount();
  });

  it("VC-R03: moves first-setup confirmation to the expired view when the challenge is unusable", async () => {
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
      store.error = "challenge-unavailable";
      return false;
    });
    const wrapper = mountPage();
    await fillCredentials(wrapper);
    await wrapper.find('[data-testid="submit"]').trigger("click");
    await flushPromises();
    await wrapper.find('input[aria-label="6 位身份验证器验证码"]').setValue("654321");
    await wrapper.find('[data-testid="setup-submit"]').trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("本次登录已结束");
    expect(wrapper.text()).toContain("本次登录验证已失效，请重新输入账号和密码。");
    expect(wrapper.text()).toContain("重新登录");
    expect(wrapper.text()).not.toContain("请返回后重新登录");
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

  it("VC-R166: 二维码加载失败如实可重试，同挑战重试成功后进入设置", async () => {
    const store = useAuthStore();
    vi.spyOn(store, "login").mockImplementation(async () => {
      store.nextStep = "AUTHENTICATOR_SETUP_REQUIRED";
      store.challengeId = "c".repeat(43);
      return "AUTHENTICATOR_SETUP_REQUIRED";
    });
    let attempt = 0;
    vi.spyOn(store, "loadAuthenticatorSetup").mockImplementation(async () => {
      attempt += 1;
      if (attempt === 1) {
        store.error = "service-unavailable";
        return false;
      }
      store.error = null;
      store.authenticatorSetup = {
        manualKey: "ABCDEFGHIJKLMNOP",
        provisioningUri: "otpauth://totp/Virtual%20Companion:alice",
        qrCodeDataUrl: "data:image/png;base64,abc",
      };
      return true;
    });
    const wrapper = mountPage();
    try {
      await fillCredentials(wrapper);
      await wrapper.find('[data-testid="submit"]').trigger("click");
      await flushPromises();

      // 503/网络失败：如实说明二维码暂未加载，可重试；不得谎称「验证已失效」。
      expect(wrapper.text()).not.toContain("本次登录验证已失效");
      const errorView = wrapper.get('[data-testid="setup-load-error"]');
      expect(errorView.attributes("role")).toBe("alert");
      expect(errorView.text()).toContain("二维码暂时没有加载出来");
      expect(wrapper.text()).toContain("重新加载二维码");
      expect(wrapper.text()).toContain("返回登录");

      // 同一挑战重试成功：进入真实设置视图，失败态消失。
      await wrapper.find('[data-testid="setup-retry"]').trigger("click");
      await flushPromises();
      expect(wrapper.text()).toContain("ABCDEFGHIJKLMNOP");
      expect(wrapper.text()).not.toContain("重新加载二维码");
    } finally {
      wrapper.unmount();
    }
  });

  it("VC-R166: 挑战真正不可用时仍进入失效视图", async () => {
    const store = useAuthStore();
    vi.spyOn(store, "login").mockImplementation(async () => {
      store.nextStep = "AUTHENTICATOR_SETUP_REQUIRED";
      store.challengeId = "c".repeat(43);
      return "AUTHENTICATOR_SETUP_REQUIRED";
    });
    vi.spyOn(store, "loadAuthenticatorSetup").mockImplementation(async () => {
      store.error = "challenge-unavailable";
      return false;
    });
    const wrapper = mountPage();
    try {
      await fillCredentials(wrapper);
      await wrapper.find('[data-testid="submit"]').trigger("click");
      await flushPromises();

      expect(wrapper.text()).toContain("本次登录已结束");
      expect(wrapper.text()).toContain("本次登录验证已失效");
      expect(wrapper.text()).toContain("重新登录");
    } finally {
      wrapper.unmount();
    }
  });

  it("VC-R166: 二维码加载中返回登录后，迟到结果不得覆盖登录表单", async () => {
    const store = useAuthStore();
    vi.spyOn(store, "login").mockImplementation(async () => {
      store.nextStep = "AUTHENTICATOR_SETUP_REQUIRED";
      store.challengeId = "c".repeat(43);
      return "AUTHENTICATOR_SETUP_REQUIRED";
    });
    let release!: (loaded: boolean) => void;
    vi.spyOn(store, "loadAuthenticatorSetup").mockImplementation(
      () => new Promise<boolean>((resolve) => {
        release = resolve;
      }),
    );
    const wrapper = mountPage();
    try {
      await fillCredentials(wrapper);
      await wrapper.find('[data-testid="submit"]').trigger("click");
      await flushPromises();
      expect(wrapper.text()).toContain("正在准备二维码");

      // 加载中点真实返回按钮（aria-label 返回登录）回到登录表单。
      await wrapper.find('[aria-label="返回登录"]').trigger("click");
      await flushPromises();
      expect(wrapper.find('input[aria-label="账号"]').exists()).toBe(true);

      // 迟到的加载结果：本页不得被改回 setup/expired。
      release(false);
      await flushPromises();
      expect(wrapper.find('input[aria-label="账号"]').exists()).toBe(true);
      expect(wrapper.text()).not.toContain("本次登录已结束");
      expect(wrapper.text()).not.toContain("正在准备二维码");
      expect(store.authenticatorSetup).toBeNull();
    } finally {
      wrapper.unmount();
    }
  });

  it("VC-R167: TOTP 快速纠正验证码时 confirm 先同步新码且仅提交一次", async () => {
    const store = useAuthStore();
    vi.spyOn(store, "login").mockImplementation(async () => {
      store.nextStep = "TOTP_REQUIRED";
      store.challengeId = "a".repeat(43);
      return "TOTP_REQUIRED";
    });
    const verifySpy = vi.spyOn(store, "verifyAuthenticatorCode").mockResolvedValue(false);
    const wrapper = mountPage();
    try {
      await fillCredentials(wrapper);
      await wrapper.find('[data-testid="submit"]').trigger("click");
      await flushPromises();

      const totpInput = wrapper.find('input[aria-label="6 位身份验证器验证码"]');
      await totpInput.setValue("111111");
      // 模拟真实节流窗口：DOM 已是新 6 位码，input 事件尚未送达父组件。
      (totpInput.element as HTMLInputElement).value = "654321";
      await totpInput.trigger("keydown", { key: "Enter" });
      // keydown 不得抢跑提交旧码。
      expect(verifySpy).not.toHaveBeenCalled();

      totpInput.element.dispatchEvent(
        new CustomEvent("confirm", { detail: { value: "654321" } }),
      );
      await flushPromises();
      expect(verifySpy).toHaveBeenCalledTimes(1);
      expect(verifySpy).toHaveBeenLastCalledWith(expect.anything(), "654321", false);
    } finally {
      wrapper.unmount();
    }
  });

  it("VC-R167: 首次设置确认同样先同步新码且仅提交一次", async () => {
    const store = useAuthStore();
    vi.spyOn(store, "login").mockImplementation(async () => {
      store.nextStep = "AUTHENTICATOR_SETUP_REQUIRED";
      store.challengeId = "c".repeat(43);
      return "AUTHENTICATOR_SETUP_REQUIRED";
    });
    vi.spyOn(store, "loadAuthenticatorSetup").mockImplementation(async () => {
      store.authenticatorSetup = {
        manualKey: "ABCDEFGHIJKLMNOP",
        provisioningUri: "otpauth://totp/Virtual%20Companion:alice",
        qrCodeDataUrl: "data:image/png;base64,abc",
      };
      return true;
    });
    const confirmSpy = vi.spyOn(store, "confirmAuthenticator").mockResolvedValue(false);
    const wrapper = mountPage();
    try {
      await fillCredentials(wrapper);
      await wrapper.find('[data-testid="submit"]').trigger("click");
      await flushPromises();
      expect(wrapper.text()).toContain("设置身份验证器");

      const setupInput = wrapper.find('input[data-testid="setup-code"]');
      await setupInput.setValue("111111");
      (setupInput.element as HTMLInputElement).value = "654321";
      await setupInput.trigger("keydown", { key: "Enter" });
      expect(confirmSpy).not.toHaveBeenCalled();

      setupInput.element.dispatchEvent(
        new CustomEvent("confirm", { detail: { value: "654321" } }),
      );
      await flushPromises();
      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(confirmSpy).toHaveBeenLastCalledWith(expect.anything(), "654321", false);
    } finally {
      wrapper.unmount();
    }
  });

  it("VC-R168: TOTP 提交在途时点真实返回登录后，迟到成功不得导航或覆盖登录表单", async () => {
    const store = useAuthStore();
    vi.spyOn(store, "login").mockImplementation(async () => {
      store.nextStep = "TOTP_REQUIRED";
      store.challengeId = "a".repeat(43);
      return "TOTP_REQUIRED";
    });
    let releaseTotp!: (ok: boolean) => void;
    vi.spyOn(store, "verifyAuthenticatorCode").mockImplementation(
      () => new Promise<boolean>((resolve) => {
        releaseTotp = resolve;
      }),
    );
    const redirectTo = vi.fn();
    vi.stubGlobal("uni", { redirectTo });
    const wrapper = mountPage();
    try {
      await fillCredentials(wrapper);
      await wrapper.find('[data-testid="submit"]').trigger("click");
      await flushPromises();
      await wrapper.find('input[aria-label="6 位身份验证器验证码"]').setValue("123456");
      await wrapper.find('[data-testid="totp-submit"]').trigger("click");
      await flushPromises();

      // 提交在途时点真实返回按钮（aria-label 返回登录）。
      await wrapper.find('[aria-label="返回登录"]').trigger("click");
      await flushPromises();
      expect(wrapper.find('input[aria-label="账号"]').exists()).toBe(true);

      // 迟到的服务端确认成功：不得把已返回的用户拽去导航，也不得改视图。
      releaseTotp(true);
      await flushPromises();
      expect(redirectTo).not.toHaveBeenCalled();
      expect(wrapper.find('input[aria-label="账号"]').exists()).toBe(true);
      expect(wrapper.text()).not.toContain("验证登录");
    } finally {
      wrapper.unmount();
    }
  });

  it("VC-R168: 恢复码提交在途时返回 TOTP 后，迟到成功不得导航；同挑战仍可继续验证", async () => {
    const store = useAuthStore();
    vi.spyOn(store, "login").mockImplementation(async () => {
      store.nextStep = "TOTP_REQUIRED";
      store.challengeId = "a".repeat(43);
      return "TOTP_REQUIRED";
    });
    let releaseRecovery!: (ok: boolean) => void;
    vi.spyOn(store, "verifyRecoveryCode").mockImplementation(
      () => new Promise<boolean>((resolve) => {
        releaseRecovery = resolve;
      }),
    );
    const redirectTo = vi.fn();
    vi.stubGlobal("uni", { redirectTo });
    const wrapper = mountPage();
    try {
      await fillCredentials(wrapper);
      await wrapper.find('[data-testid="submit"]').trigger("click");
      await flushPromises();
      await wrapper.find('[data-testid="use-recovery-code"]').trigger("click");
      await wrapper.find('input[aria-label="恢复码"]').setValue("ABCD-EFGH-IJKL-MNOP");
      await wrapper.find('[data-testid="recovery-submit"]').trigger("click");
      await flushPromises();

      // 恢复码提交在途时返回：回 TOTP 视图（同挑战保留，供换一种验证方式）。
      await wrapper.find('[aria-label="返回登录"]').trigger("click");
      await flushPromises();
      expect(wrapper.text()).toContain("验证登录");

      // 迟到的恢复码成功：不得导航，TOTP 视图保持。
      releaseRecovery(true);
      await flushPromises();
      expect(redirectTo).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain("验证登录");
      expect(wrapper.find('input[aria-label="6 位身份验证器验证码"]').exists()).toBe(true);
    } finally {
      wrapper.unmount();
    }
  });

  it("VC-R168: setup 确认旧失败在 Back 后新登录挂起时，不得写新表单错误或释放新 busy", async () => {
    const store = useAuthStore();
    let releaseSetup!: (ok: boolean) => void;
    let releasePassword!: (step: AuthFlowStepResult) => void;
    let passwordPending = false;
    vi.spyOn(store, "login").mockImplementation(async () => {
      if (passwordPending) {
        return new Promise<AuthFlowStepResult>((resolve) => {
          releasePassword = resolve;
        });
      }
      store.nextStep = "AUTHENTICATOR_SETUP_REQUIRED";
      store.challengeId = "c".repeat(43);
      return "AUTHENTICATOR_SETUP_REQUIRED";
    });
    // 首次设置入口：真实 loadSetup 会经 loadAuthenticatorSetup 读取二维码，
    // mock 成功准备才能渲染 setup 视图（setup-code 输入存在）。
    vi.spyOn(store, "loadAuthenticatorSetup").mockImplementation(async () => {
      store.authenticatorSetup = {
        manualKey: "ABCDEFGHIJKLMNOP",
        provisioningUri: "otpauth://totp/Virtual%20Companion:alice",
        qrCodeDataUrl: "data:image/png;base64,abc",
      };
      return true;
    });
    vi.spyOn(store, "confirmAuthenticator").mockImplementation(
      () => new Promise<boolean>((resolve) => {
        releaseSetup = resolve;
      }),
    );
    const wrapper = mountPage();
    try {
      await fillCredentials(wrapper);
      await wrapper.find('[data-testid="submit"]').trigger("click");
      await flushPromises();
      const setupInput = wrapper.find('input[data-testid="setup-code"]');
      expect(setupInput.exists()).toBe(true);
      await setupInput.setValue("654321");
      await wrapper.find('[data-testid="setup-submit"]').trigger("click");
      await flushPromises();

      // setup 确认在途时点返回登录，随即提交新的密码登录（挂起）。
      await wrapper.find('[aria-label="返回登录"]').trigger("click");
      await flushPromises();
      passwordPending = true;
      await fillCredentials(wrapper);
      await wrapper.find('[data-testid="submit"]').trigger("click");
      await flushPromises();

      // setup 的迟到失败：不得写新表单错误、不改回旧视图、不释放新 busy。
      releaseSetup(false);
      await flushPromises();
      expect(wrapper.find('[data-testid="error"]').exists()).toBe(false);
      expect(wrapper.text()).not.toContain("设置身份验证器");
      expect(wrapper.get('[data-testid="submit"]').attributes("disabled")).toBeDefined();
    } finally {
      wrapper.unmount();
    }
  });

  it("VC-R168: 旧页卸载不得失效新页已启动的流程，旧页迟到结果不得覆盖新页", async () => {
    const store = useAuthStore();
    // 保存真实 login：页面 A 的 login 被 spy，B 用真实实现 + 内联 deferred
    // transport（本 spec 不引用 store spec 的私有 helper）。
    const realLogin = store.login.bind(store);
    let releaseTotp!: (ok: boolean) => void;
    const spy = vi.spyOn(store, "login").mockImplementation(async () => {
      store.nextStep = "TOTP_REQUIRED";
      store.challengeId = "a".repeat(43);
      return "TOTP_REQUIRED";
    });
    vi.spyOn(store, "verifyAuthenticatorCode").mockImplementation(
      () => new Promise<boolean>((resolve) => {
        releaseTotp = resolve;
      }),
    );
    const redirectToA = vi.fn();
    vi.stubGlobal("uni", { redirectTo: redirectToA });
    const pageA = mountPage();
    // B 的挂起请求与释放（内联 deferred，finally 里兜底 settle 防悬挂）。
    let settleB!: (response: AuthApiResponse) => void;
    let bSettled = false;
    const bRequest = new Promise<AuthApiResponse>((resolve) => {
      settleB = (response) => {
        bSettled = true;
        resolve(response);
      };
    });
    const bTransport: AuthTransport = { request: vi.fn(() => bRequest) };
    const bIdentity = {
      nextStep: "ACTIVE",
      accountId: "43",
      email: "b@example.com",
      role: "USER",
      sessionId: "9",
      passwordMustChange: false,
      authenticatorEnabled: true,
      expiresInSeconds: 7200,
    };
    try {
      await fillCredentials(pageA);
      await pageA.find('[data-testid="submit"]').trigger("click");
      await flushPromises();
      await pageA.find('input[aria-label="6 位身份验证器验证码"]').setValue("123456");
      await pageA.find('[data-testid="totp-submit"]').trigger("click");
      await flushPromises();

      // 通过同一 store 用真实 login 启动新流程 B（挂起），随后卸载旧页 A。
      spy.mockRestore();
      const bOutcome = realLogin(bTransport, "bob@example.com", "pw");
      pageA.unmount();

      // B 正常完成：必须成功（A 的卸载不得作废 B 的流程）。
      settleB({ ok: true, status: 200, json: bIdentity });
      await expect(bOutcome).resolves.toBe("ACTIVE");
      expect(store.accountId).toBe("43");

      // A 的 TOTP 迟到成功：不得导航（A 页面已卸载，也无权覆盖 B）。
      releaseTotp(true);
      await flushPromises();
      expect(redirectToA).not.toHaveBeenCalled();
    } finally {
      if (!bSettled) settleB({ ok: true, status: 200, json: bIdentity });
      pageA.unmount();
    }
  });

  it("VC-R168: 二维码准备中卸载页面后，迟到的真实 setup 读取不得回写全局 secret/error", async () => {
    const store = useAuthStore();
    // login stub 只负责给出合法 enroll 挑战；setup 读取走真实
    // loadAuthenticatorSetup（经页面 transport → fetch stub），否则测不到
    // 全局 secret 写入。
    // 真实 page→store→API 边界：spy 只接管 transport，读取仍走真实
    // loadAuthenticatorSetup 与真实 api 解析，直接可测全局 secret 归属；
    // 真实 HTTP transport 由既有浏览器用例覆盖，此处不搭 fetch 层。
    const realLoadSetup = store.loadAuthenticatorSetup.bind(store);
    vi.spyOn(store, "login").mockImplementation(async () => {
      store.nextStep = "AUTHENTICATOR_SETUP_REQUIRED";
      store.challengeId = "c".repeat(43);
      return "AUTHENTICATOR_SETUP_REQUIRED";
    });
    let settleSetup!: (response: AuthApiResponse) => void;
    let setupSettled = false;
    const setupRequest = new Promise<AuthApiResponse>((resolve) => {
      settleSetup = (response) => {
        setupSettled = true;
        resolve(response);
      };
    });
    const deferredTransport: AuthTransport = { request: vi.fn(() => setupRequest) };
    vi.spyOn(store, "loadAuthenticatorSetup").mockImplementation(
      () => realLoadSetup(deferredTransport),
    );
    const wrapper = mountPage();
    try {
      await fillCredentials(wrapper);
      await wrapper.find('[data-testid="submit"]').trigger("click");
      await flushPromises();
      // 进入「正在准备二维码」，真实读取仍在途。
      expect(wrapper.text()).toContain("正在准备二维码");

      // 页面卸载：本页仍拥有的 setup 读取流程应被作废。
      wrapper.unmount();

      // 迟到的真实读取成功：不得回写全局 setup/error。
      settleSetup({
        ok: true,
        status: 200,
        json: {
          manualKey: "OLD-SECRET-KEY",
          provisioningUri: "otpauth://totp/Virtual%20Companion:old",
          qrCodeDataUrl: "data:image/png;base64,old",
        },
      });
      await flushPromises();
      expect(store.authenticatorSetup).toBeNull();
      expect(store.error).toBeNull();
    } finally {
      if (!setupSettled) {
        settleSetup({
          ok: true,
          status: 200,
          json: {
            manualKey: "ABCDEFGHIJKLMNOP",
            provisioningUri: "otpauth://totp/Virtual%20Companion:alice",
            qrCodeDataUrl: "data:image/png;base64,abc",
          },
        });
      }
      wrapper.unmount();
      vi.unstubAllGlobals();
    }
  });
});
