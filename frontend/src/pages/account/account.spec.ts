// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAuthenticatedTransport } from "@/api/transport";
import { useAuthStore } from "@/stores/auth";

import AccountPage from "./account.vue";

// 副本下载文档的原始 JSON 文本常量：含超过 Number.MAX_SAFE_INTEGER 的
// int64 ID，必须以字符串字面量比对，不得 JSON.parse/stringify 重构。
const EXPORT_JSON_TEXT = '{"format":"vc-export-v1","requestedAt":"2026-10-20T09:05:00Z",'
  + '"messages":[{"messageId":9007199254740993,"role":"user","content":"晚上好"}],'
  + '"memories":[{"memoryId":9007199254740995,"summary":"用户喜欢在晚上散步。"}]}';
const EXPORT_CREATED_BODY = {
  exportId: "exp-1",
  status: "PENDING",
  requestedAt: "2026-10-20T09:05:00Z",
  downloadUrl: "/api/v1/exports/exp-1/download?token=one-time",
};
const EXPORT_READY_BODY = {
  exportId: "exp-1",
  status: "READY",
  requestedAt: "2026-10-20T09:05:00Z",
  completedAt: "2026-10-20T09:06:00Z",
  expiresAt: "2026-10-27T09:05:00Z",
};

interface Gate {
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
}

interface FetchOptions {
  devices?: unknown[];
  deviceGetStatuses?: number[];
  revokeDeviceStatus?: number;
  passwordStatus?: number;
  deleteStatus?: number;
  exportCreateStatus?: number;
  exportCreateBody?: unknown;
  exportStatusStatus?: number;
  exportStatusBody?: unknown;
  exportDownloadStatus?: number;
  exportDownloadText?: string;
  /** 提供时，创建副本的 POST 挂起直到手动 resolve（用于账号切换场景）。 */
  exportCreateGate?: Gate;
  /** 提供时，第一个 trusted-devices GET 挂起直到手动 resolve，用 gatedDevices 应答。 */
  deviceGetGate?: Gate;
  gatedDevices?: unknown[];
  /** 提供时，改密 POST 挂起直到手动 resolve，随后按 passwordGateOk 应答。 */
  passwordGate?: Gate;
  /** 改密挂起释放后的应答体：默认 {ok:false}（迟到失败）；true 为 {ok:true}（迟到成功）。 */
  passwordGateOk?: boolean;
  /** 提供时，GET /auth/session 以 200 返回该身份（同会话读回场景）。 */
  sessionIdentity?: unknown;
  /** 提供时，POST /auth/login 以 404 拒绝（失败登录意图场景）。 */
  loginRejected?: boolean;
  /** 提供时，登出 POST 挂起直到手动 resolve（迟到登出场景）。 */
  logoutGate?: Gate;
  /** 提供时，撤销设备的 DELETE 挂起直到手动 resolve。 */
  revokeGate?: Gate;
  /** 登录 POST 返回的身份：默认切到 B（"43"）；同账号重认证场景传 "42"。 */
  loginAccountId?: string;
  loginEmail?: string;
}

function makeGate(): Gate {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function stubFetch(options: FetchOptions = {}) {
  const calls: Array<{ method: string; url: string; body?: string }> = [];
  const deviceGetStatuses = [...(options.deviceGetStatuses ?? [200])];
  let deviceGetGateUsed = false;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, url, body: typeof init?.body === "string" ? init.body : undefined });

    if (url === "/api/v1/auth/session" && method === "GET") {
      if (options.sessionIdentity) return response(200, options.sessionIdentity);
      return response(401, null);
    }
    if (url === "/api/v1/auth/login" && method === "POST") {
      if (options.loginRejected) {
        return response(404, { code: "NOT_FOUND_OR_FORBIDDEN", message: "no" });
      }
      // 真实换号或同账号重认证：登录页同款 ACTIVE 响应，经 store.login 推进代次。
      return response(200, {
        nextStep: "ACTIVE",
        accountId: options.loginAccountId ?? "43",
        email: options.loginEmail ?? "b@example.com",
        role: "USER",
        passwordMustChange: false,
        authenticatorEnabled: true,
        expiresInSeconds: 7200,
      });
    }
    if (url === "/api/v1/auth/trusted-devices" && method === "GET") {
      const status = deviceGetStatuses.shift() ?? 200;
      if (options.deviceGetGate && !deviceGetGateUsed) {
        deviceGetGateUsed = true;
        return options.deviceGetGate.promise.then(
          () => response(status, status === 200 ? (options.gatedDevices ?? []) : null),
        );
      }
      return response(status, status === 200 ? (options.devices ?? []) : null);
    }
    if (url.startsWith("/api/v1/auth/trusted-devices/") && method === "DELETE") {
      if (options.revokeGate) {
        return options.revokeGate.promise.then(() => response(200, { ok: true }));
      }
      const status = options.revokeDeviceStatus ?? 200;
      return response(status, status === 200 ? { ok: true } : null);
    }
    if (url === "/api/v1/auth/password" && method === "POST") {
      if (options.passwordGate) {
        return options.passwordGate.promise.then(
          () => response(200, options.passwordGateOk ? { ok: true } : { ok: false }),
        );
      }
      const status = options.passwordStatus ?? 200;
      return response(status, status === 200 ? { ok: true } : null);
    }
    if (url === "/api/v1/auth/logout" && method === "POST") {
      if (options.logoutGate) {
        return options.logoutGate.promise.then(() => response(200, { ok: true }));
      }
      return response(200, { ok: true });
    }
    if (url === "/api/v1/auth/account" && method === "DELETE") {
      const status = options.deleteStatus ?? 200;
      return response(status, status === 200 ? { ok: true } : null);
    }
    if (url === "/api/v1/exports" && method === "POST") {
      const status = options.exportCreateStatus ?? 200;
      const json = status === 200 ? (options.exportCreateBody ?? EXPORT_CREATED_BODY) : null;
      if (options.exportCreateGate) {
        return options.exportCreateGate.promise.then(() => response(status, json));
      }
      return response(status, json);
    }
    if (url.startsWith("/api/v1/exports/") && url.includes("/download")) {
      const status = options.exportDownloadStatus ?? 200;
      if (status !== 200) return response(status, null);
      return rawResponse(options.exportDownloadText ?? EXPORT_JSON_TEXT);
    }
    if (url.startsWith("/api/v1/exports/") && method === "GET") {
      const status = options.exportStatusStatus ?? 200;
      return response(status, status === 200 ? (options.exportStatusBody ?? EXPORT_READY_BODY) : null);
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

/** 一次性下载响应：以服务器原始 JSON 文本返回（Blob/text 同源字节）。 */
function rawResponse(text: string) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => "application/json" },
    blob: async () => new Blob([text], { type: "application/json" }),
    text: async () => text,
    json: async () => JSON.parse(text),
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

  it("shows a recognizable email and only the four product groups", async () => {
    stubFetch();
    loginAs();
    const wrapper = mount(AccountPage, { attachTo: document.body });
    await flushPromises();

    expect(wrapper.get('[data-testid="account-email"]').text()).toBe("alice@example.com");
    expect(wrapper.findAll(".settings-section__title").map((node) => node.text())).toEqual([
      "陪伴",
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

  it("navigates to the companion settings and memory pages from the companion group", async () => {
    stubFetch();
    loginAs();
    const wrapper = mount(AccountPage);
    await flushPromises();

    await wrapper.get('[data-testid="me-companion"]').trigger("click");
    expect((globalThis as unknown as {
      uni: { navigateTo: ReturnType<typeof vi.fn> };
    }).uni.navigateTo)
      .toHaveBeenCalledWith({ url: "/pages/companion/companion" });

    await wrapper.get('[data-testid="me-memory"]').trigger("click");
    expect((globalThis as unknown as {
      uni: { navigateTo: ReturnType<typeof vi.fn> };
    }).uni.navigateTo)
      .toHaveBeenCalledWith({ url: "/pages/memory/memory" });
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
    expect(wrapper.find('[data-testid="data-copy-toggle"]').exists()).toBe(false);
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
    expect((globalThis as unknown as {
      uni: { navigateTo: ReturnType<typeof vi.fn> };
    }).uni.navigateTo)
      .toHaveBeenCalledWith({ url: "/pages/login/login" });
    wrapper.unmount();
  });

  it("VC-R12: 迟到的旧登出不得清掉换号后的身份，也不得导航回登录页", async () => {
    const gate = makeGate();
    const { calls } = stubFetch({ logoutGate: gate });
    const auth = loginAs();
    const wrapper = mount(AccountPage);
    await flushPromises();

    await wrapper.get('[data-testid="account-logout"]').trigger("click");
    await flushPromises();
    expect(calls.filter((call) => call.url === "/api/v1/auth/logout")).toHaveLength(1);

    const transport = createAuthenticatedTransport({
      getAccessToken: () => auth.accessToken,
      getSessionRevision: () => auth.getSessionRevision(),
      onUnauthorized: () => auth.onUnauthorized(),
    });
    await auth.login(transport, "b@example.com", "pw-b");
    await flushPromises();

    // 旧登出迟到返回 ok:true：B 的本地身份保留，页面不被拽回登录页。
    gate.resolve(undefined);
    await flushPromises();
    expect(auth.accountId).toBe("43");
    expect(auth.isAuthenticated).toBe(true);
    const uni = (globalThis as unknown as {
      uni: { navigateTo: ReturnType<typeof vi.fn>; redirectTo: ReturnType<typeof vi.fn> };
    }).uni;
    expect(uni.navigateTo).not.toHaveBeenCalledWith({ url: "/pages/login/login" });
    expect(uni.redirectTo).not.toHaveBeenCalledWith({ url: "/pages/login/login" });
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

  it("shows the copy entry inside the account group and keeps it collapsed until toggled", async () => {
    stubFetch();
    loginAs();
    const wrapper = mount(AccountPage, { attachTo: document.body });
    await flushPromises();

    const toggle = wrapper.get('[data-testid="data-copy-toggle"]');
    expect(toggle.text()).toContain("聊天与记忆副本");
    const accountSection = wrapper.findAll("section")[1];
    expect(accountSection.element.contains(toggle.element)).toBe(true);
    expect(toggle.attributes("aria-expanded")).toBe("false");
    expect(wrapper.find('[data-testid="data-copy-panel"]').isVisible()).toBe(false);

    await toggle.trigger("click");
    expect(toggle.attributes("aria-expanded")).toBe("true");
    expect(wrapper.find('[data-testid="data-copy-panel"]').isVisible()).toBe(true);
    wrapper.unmount();
  });

  it("runs the copy flow end to end with byte-exact server bytes", async () => {
    const { calls } = stubFetch();
    loginAs();
    const wrapper = mount(AccountPage, { attachTo: document.body });
    await flushPromises();

    const createObjectURL = vi.fn((_blob: Blob) => "blob:export-1");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const clickedAnchors: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      function handleClick(this: HTMLAnchorElement) {
        clickedAnchors.push(this);
      },
    );

    await wrapper.get('[data-testid="data-copy-toggle"]').trigger("click");
    await wrapper.get('[data-testid="data-copy-password"]').setValue("Current-Pass-1!");
    await wrapper.get('[data-testid="data-copy-create"]').trigger("click");
    await flushPromises();
    expect(calls).toContainEqual(expect.objectContaining({
      method: "POST",
      url: "/api/v1/exports",
      body: '{"currentPassword":"Current-Pass-1!"}',
    }));
    expect(wrapper.get('[data-testid="data-copy-panel"]').text()).toContain("正在整理你的副本。");

    await wrapper.get('[data-testid="data-copy-progress"]').trigger("click");
    await flushPromises();
    expect(calls).toContainEqual(expect.objectContaining({ method: "GET", url: "/api/v1/exports/exp-1" }));

    await wrapper.get('[data-testid="data-copy-download"]').trigger("click");
    await flushPromises();
    expect(calls).toContainEqual(expect.objectContaining({
      method: "GET",
      url: "/api/v1/exports/exp-1/download?token=one-time",
    }));
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(await blob.text()).toBe(EXPORT_JSON_TEXT);
    expect(clickedAnchors).toHaveLength(1);
    expect(clickedAnchors[0].getAttribute("download")).toContain("聊天与记忆副本-");
    expect(clickedAnchors[0].getAttribute("href")).toBe("blob:export-1");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:export-1");
    expect(wrapper.get('[data-testid="data-copy-panel"]').text()).toContain("已交给浏览器下载");
    wrapper.unmount();
  });

  it("rebuilds a clean panel for the next account and drops the in-flight copy request", async () => {
    const gate = makeGate();
    const { calls } = stubFetch({ exportCreateGate: gate });
    const auth = loginAs();
    const wrapper = mount(AccountPage, { attachTo: document.body });
    await flushPromises();

    await wrapper.get('[data-testid="data-copy-toggle"]').trigger("click");
    await wrapper.get('[data-testid="data-copy-password"]').setValue("Current-Pass-1!");
    await wrapper.get('[data-testid="data-copy-create"]').trigger("click");
    await flushPromises();
    expect(calls.filter((call) => call.url === "/api/v1/exports")).toHaveLength(1);

    // 同次更新内切换账号：v-else 分支不销毁，靠 :key 强制重建面板。
    auth.accountId = "43";
    await flushPromises();
    expect(auth.isAuthenticated).toBe(true);
    expect(wrapper.get('[data-testid="data-copy-toggle"]').attributes("aria-expanded")).toBe("false");

    await wrapper.get('[data-testid="data-copy-toggle"]').trigger("click");
    const panel = wrapper.get('[data-testid="data-copy-panel"]');
    expect(panel.text()).toContain("申请副本");
    expect(panel.text()).not.toContain("正在整理你的副本。");
    expect(wrapper.find('[data-testid="data-copy-progress"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="data-copy-download"]').exists()).toBe(false);
    const input = wrapper.get('[data-testid="data-copy-password"]').element as HTMLInputElement;
    expect(input.value).toBe("");

    // 旧账号的迟到创建响应到达：不回填新实例，也不再发起新请求。
    gate.resolve(undefined);
    await flushPromises();
    expect(wrapper.get('[data-testid="data-copy-panel"]').text()).toContain("申请副本");
    expect(wrapper.get('[data-testid="data-copy-panel"]').text()).not.toContain("正在整理你的副本。");
    expect(wrapper.find('[data-testid="data-copy-download"]').exists()).toBe(false);
    expect(calls.filter((call) => call.url === "/api/v1/exports")).toHaveLength(1);
    wrapper.unmount();
  });

  it("clears the cached private forms and device rows on a hidden account switch, then reloads for the new account", async () => {
    const deviceA = { id: "3", displayName: "A-MacBook", createdAt: "c", lastUsedAt: "l", expiresAt: "e" };
    const deviceB = { id: "9", displayName: "B-Phone", createdAt: "c", lastUsedAt: "l", expiresAt: "e" };
    const mockOptions: FetchOptions = { devices: [deviceA] };
    const { calls } = stubFetch(mockOptions);
    const auth = loginAs();
    const wrapper = mount(AccountPage);
    await flushPromises();
    expect(wrapper.get('[data-testid="trusted-device-row"]').text()).toContain("A-MacBook");

    // 留下 A 期间的私有输入：密码表单与注销确认。
    await wrapper.get('[data-testid="password-toggle"]').trigger("click");
    await wrapper.get('[data-testid="current-password"]').setValue("OldPass1!");
    await wrapper.get('[data-testid="new-password"]').setValue("NewPass1!");
    await wrapper.get('[data-testid="confirm-password"]').setValue("NewPass1!");
    await wrapper.get('[data-testid="delete-account-open"]').trigger("click");
    await wrapper.get('[data-testid="delete-account-password"]').setValue("A-Delete-Pw-1!");

    // 模拟 uni H5 KeepAlive 停用：本页转入后台缓存，onUnmounted 不运行。
    const internal = wrapper.vm.$ as unknown as {
      a?: Array<() => void>;
      da?: Array<() => void>;
    };
    internal.da?.forEach((hook) => hook());

    // 隐藏期间前台真实切到 B（登录页同款流程，直接推进会话代次）。
    mockOptions.devices = [deviceB];
    const transport = createAuthenticatedTransport({
      getAccessToken: () => auth.accessToken,
      getSessionRevision: () => auth.getSessionRevision(),
      onUnauthorized: () => auth.onUnauthorized(),
    });
    await auth.login(transport, "b@example.com", "pw-b");
    await flushPromises();

    // 隐藏页不抢跑：无新设备请求；旧账号的输入、表单与设备行全部清空。
    expect(calls.filter((call) => call.url === "/api/v1/auth/trusted-devices")).toHaveLength(1);
    expect(wrapper.get('[data-testid="account-email"]').text()).toBe("b@example.com");
    expect(wrapper.findAll('[data-testid="trusted-device-row"]')).toHaveLength(0);
    expect(wrapper.text()).not.toContain("A-MacBook");
    expect(wrapper.find('[data-testid="password-form"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="delete-account-confirm"]').exists()).toBe(false);
    await wrapper.get('[data-testid="password-toggle"]').trigger("click");
    expect((wrapper.get('[data-testid="current-password"]').element as HTMLInputElement).value).toBe("");
    expect((wrapper.get('[data-testid="new-password"]').element as HTMLInputElement).value).toBe("");
    expect((wrapper.get('[data-testid="confirm-password"]').element as HTMLInputElement).value).toBe("");

    // 重新激活（浏览器后退落回缓存页）：按 B 账号重载设备。
    internal.a?.forEach((hook) => hook());
    await flushPromises();
    expect(wrapper.get('[data-testid="trusted-device-row"]').text()).toContain("B-Phone");
    expect(wrapper.text()).not.toContain("A-MacBook");
    expect(calls.filter((call) => call.url === "/api/v1/auth/trusted-devices")).toHaveLength(2);
    wrapper.unmount();
  });

  it("drops a late trusted-device response that started before the account switch", async () => {
    const gate = makeGate();
    const deviceA = { id: "3", displayName: "A-MacBook", createdAt: "c", lastUsedAt: "l", expiresAt: "e" };
    const deviceB = { id: "9", displayName: "B-Phone", createdAt: "c", lastUsedAt: "l", expiresAt: "e" };
    const { calls } = stubFetch({
      deviceGetGate: gate,
      gatedDevices: [deviceA],
      devices: [deviceB],
    });
    const auth = loginAs();
    const wrapper = mount(AccountPage);
    await flushPromises();
    expect(calls.filter((call) => call.url === "/api/v1/auth/trusted-devices")).toHaveLength(1);

    const internal = wrapper.vm.$ as unknown as {
      a?: Array<() => void>;
      da?: Array<() => void>;
    };
    internal.da?.forEach((hook) => hook());

    const transport = createAuthenticatedTransport({
      getAccessToken: () => auth.accessToken,
      getSessionRevision: () => auth.getSessionRevision(),
      onUnauthorized: () => auth.onUnauthorized(),
    });
    await auth.login(transport, "b@example.com", "pw-b");
    await flushPromises();

    // 重新激活后按 B 账号完成加载。
    internal.a?.forEach((hook) => hook());
    await flushPromises();
    expect(wrapper.get('[data-testid="trusted-device-row"]').text()).toContain("B-Phone");

    // A 的迟到 200 到达：不回填、不覆盖 B，也不把设备区打回加载或错误态。
    gate.resolve(undefined);
    await flushPromises();
    const rows = wrapper.findAll('[data-testid="trusted-device-row"]');
    expect(rows).toHaveLength(1);
    expect(rows[0].text()).toContain("B-Phone");
    expect(wrapper.text()).not.toContain("A-MacBook");
    expect(wrapper.get('[data-testid="trusted-devices"]').text()).not.toContain("正在加载设备");
    expect(wrapper.find('[data-testid="trusted-devices-error"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("recovers the device list when the same account re-authenticates while the GET is pending", async () => {
    const gate = makeGate();
    const deviceA = { id: "3", displayName: "A-MacBook", createdAt: "c", lastUsedAt: "l", expiresAt: "e" };
    const { calls } = stubFetch({
      deviceGetGate: gate,
      gatedDevices: [deviceA],
      loginAccountId: "42",
      loginEmail: "alice@example.com",
    });
    const auth = loginAs();
    const wrapper = mount(AccountPage);
    await flushPromises();
    expect(calls.filter((call) => call.url === "/api/v1/auth/trusted-devices")).toHaveLength(1);

    const internal = wrapper.vm.$ as unknown as {
      a?: Array<() => void>;
      da?: Array<() => void>;
    };
    internal.da?.forEach((hook) => hook());

    // 隐藏期间同账号重新认证：accountId 不变（"42"→"42"），store 的 persist
    // 仍推进会话代次，但这不是身份交接，不得作废在途设备读取。
    const transport = createAuthenticatedTransport({
      getAccessToken: () => auth.accessToken,
      getSessionRevision: () => auth.getSessionRevision(),
      onUnauthorized: () => auth.onUnauthorized(),
    });
    await auth.login(transport, "alice@example.com", "pw-a");
    await flushPromises();
    expect(auth.accountId).toBe("42");

    // 重新激活：设备归属仍是本账号，不重发请求，靠在途结果落地。
    internal.a?.forEach((hook) => hook());
    await flushPromises();
    expect(calls.filter((call) => call.url === "/api/v1/auth/trusted-devices")).toHaveLength(1);

    // 在途 GET 此刻才返回：必须正常显示，不能永久停在「正在加载设备…」。
    gate.resolve(undefined);
    await flushPromises();
    expect(wrapper.get('[data-testid="trusted-device-row"]').text()).toContain("A-MacBook");
    expect(wrapper.get('[data-testid="trusted-devices"]').text()).not.toContain("正在加载设备");
    wrapper.unmount();
  });

  it("drops a late password-change failure after the switch and keeps the new account's busy action locked", async () => {
    const passwordGate = makeGate();
    const revokeGate = makeGate();
    const deviceA = { id: "3", displayName: "A-MacBook", createdAt: "c", lastUsedAt: "l", expiresAt: "e" };
    const deviceB = { id: "9", displayName: "B-Phone", createdAt: "c", lastUsedAt: "l", expiresAt: "e" };
    const mockOptions: FetchOptions = { devices: [deviceA], passwordGate, revokeGate };
    const { calls } = stubFetch(mockOptions);
    const auth = loginAs();
    const wrapper = mount(AccountPage);
    await flushPromises();
    expect(wrapper.get('[data-testid="trusted-device-row"]').text()).toContain("A-MacBook");

    // A 提交改密：POST 挂起（稍后以失败释放）。
    await wrapper.get('[data-testid="password-toggle"]').trigger("click");
    await wrapper.get('[data-testid="current-password"]').setValue("OldPass1!");
    await wrapper.get('[data-testid="new-password"]').setValue("NewPass1!");
    await wrapper.get('[data-testid="confirm-password"]').setValue("NewPass1!");
    await wrapper.get('[data-testid="change-password"]').trigger("click");
    await flushPromises();
    expect(calls.filter((call) => call.url === "/api/v1/auth/password")).toHaveLength(1);

    const internal = wrapper.vm.$ as unknown as {
      a?: Array<() => void>;
      da?: Array<() => void>;
    };
    internal.da?.forEach((hook) => hook());

    // 隐藏期间真实切 B，激活后 B 的设备就位。
    mockOptions.devices = [deviceB];
    const transport = createAuthenticatedTransport({
      getAccessToken: () => auth.accessToken,
      getSessionRevision: () => auth.getSessionRevision(),
      onUnauthorized: () => auth.onUnauthorized(),
    });
    await auth.login(transport, "b@example.com", "pw-b");
    await flushPromises();
    internal.a?.forEach((hook) => hook());
    await flushPromises();
    expect(wrapper.get('[data-testid="trusted-device-row"]').text()).toContain("B-Phone");

    // B 撤销自己的设备：DELETE 挂起，busy 锁定在 device:9。
    await wrapper.get('[data-testid="trusted-device-revoke"]').trigger("click");
    await flushPromises();
    expect(calls.filter((call) => call.url === "/api/v1/auth/trusted-devices/9")).toHaveLength(1);
    expect(wrapper.get('[data-testid="trusted-device-revoke"]').text()).toContain("撤销中…");

    // B 展开自己的空密码表单：A 的迟到失败文案不得回填到这里。
    await wrapper.get('[data-testid="password-toggle"]').trigger("click");
    expect(wrapper.find('[data-testid="password-message"]').exists()).toBe(false);

    // A 的迟到改密失败到达：不回填旧账号错误文案，也不解锁 B 的撤销。
    passwordGate.resolve(undefined);
    await flushPromises();
    expect(wrapper.text()).not.toContain("没有修改成功");
    expect(wrapper.find('[data-testid="password-message"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="trusted-device-revoke"]').text()).toContain("撤销中…");

    // B 的撤销完成：行移除、busy 正常复位。
    revokeGate.resolve(undefined);
    await flushPromises();
    expect(wrapper.find('[data-testid="trusted-device-row"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="trusted-device-action-error"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="account-logout"]').attributes("disabled")).toBeUndefined();
    wrapper.unmount();
  });

  it("VC-R15: 迟到的旧改密成功不得清掉换号后的新身份，也不得导航回登录页", async () => {
    const gate = makeGate();
    const { calls } = stubFetch({ passwordGate: gate, passwordGateOk: true });
    const auth = loginAs();
    const wrapper = mount(AccountPage);
    await flushPromises();

    // A 提交改密：POST 挂起（稍后以真实 200 {ok:true} 迟到释放）。
    await wrapper.get('[data-testid="password-toggle"]').trigger("click");
    await wrapper.get('[data-testid="current-password"]').setValue("OldPass1!");
    await wrapper.get('[data-testid="new-password"]').setValue("NewPass1!");
    await wrapper.get('[data-testid="confirm-password"]').setValue("NewPass1!");
    await wrapper.get('[data-testid="change-password"]').trigger("click");
    await flushPromises();
    expect(calls.filter((call) => call.url === "/api/v1/auth/password")).toHaveLength(1);

    // 挂起期间前台真实换号 B（登录页同款流程，经 store.login 以新凭据 persist）。
    const transport = createAuthenticatedTransport({
      getAccessToken: () => auth.accessToken,
      getSessionRevision: () => auth.getSessionRevision(),
      onUnauthorized: () => auth.onUnauthorized(),
    });
    await auth.login(transport, "b@example.com", "pw-b");
    await flushPromises();

    // A 的迟到改密成功到达：B 的本地身份保留，页面不被拽回登录页。
    gate.resolve(undefined);
    await flushPromises();
    expect(auth.accountId).toBe("43");
    expect(auth.isAuthenticated).toBe(true);
    expect(auth.sessionStatus).toBe("authenticated");
    const uni = (globalThis as unknown as {
      uni: { navigateTo: ReturnType<typeof vi.fn>; redirectTo: ReturnType<typeof vi.fn> };
    }).uni;
    expect(uni.navigateTo).not.toHaveBeenCalledWith({ url: "/pages/login/login" });
    expect(uni.redirectTo).not.toHaveBeenCalledWith({ url: "/pages/login/login" });
    wrapper.unmount();
  });

  it("VC-R15: 迟到的旧改密成功同样让位给同一账号的重新登录", async () => {
    const gate = makeGate();
    stubFetch({
      passwordGate: gate,
      passwordGateOk: true,
      loginAccountId: "42",
      loginEmail: "alice@example.com",
    });
    const auth = loginAs();
    const wrapper = mount(AccountPage);
    await flushPromises();

    // A 提交改密：POST 挂起（稍后以成功释放）。
    await wrapper.get('[data-testid="password-toggle"]').trigger("click");
    await wrapper.get('[data-testid="current-password"]').setValue("OldPass1!");
    await wrapper.get('[data-testid="new-password"]').setValue("NewPass1!");
    await wrapper.get('[data-testid="confirm-password"]').setValue("NewPass1!");
    await wrapper.get('[data-testid="change-password"]').trigger("click");
    await flushPromises();

    // 挂起期间同一账号用新凭据重新登录：accountId 不变，任何以「账号是否
    // 变化」为判据的方案都识别不了这次代次切换。
    const transport = createAuthenticatedTransport({
      getAccessToken: () => auth.accessToken,
      getSessionRevision: () => auth.getSessionRevision(),
      onUnauthorized: () => auth.onUnauthorized(),
    });
    await auth.login(transport, "alice@example.com", "pw-new");
    await flushPromises();
    expect(auth.accountId).toBe("42");

    // A 的迟到改密成功到达：同账号的新登录代次同样受保护。
    gate.resolve(undefined);
    await flushPromises();
    expect(auth.accountId).toBe("42");
    expect(auth.isAuthenticated).toBe(true);
    const uni = (globalThis as unknown as {
      uni: { navigateTo: ReturnType<typeof vi.fn>; redirectTo: ReturnType<typeof vi.fn> };
    }).uni;
    expect(uni.navigateTo).not.toHaveBeenCalledWith({ url: "/pages/login/login" });
    expect(uni.redirectTo).not.toHaveBeenCalledWith({ url: "/pages/login/login" });
    // 让位后动作锁正常复位：同账号的表单不会永久停在「修改中…」。
    expect(wrapper.get('[data-testid="change-password"]').attributes("disabled")).toBeUndefined();
    wrapper.unmount();
  });

  it("VC-R15: 挂起期间的同会话 session 读回不让位：改密成功仍正常退出", async () => {
    const gate = makeGate();
    stubFetch({
      passwordGate: gate,
      passwordGateOk: true,
      sessionIdentity: {
        nextStep: "ACTIVE",
        accountId: "42",
        email: "alice@example.com",
        role: "USER",
        passwordMustChange: false,
        authenticatorEnabled: true,
        expiresInSeconds: 7200,
      },
    });
    const auth = loginAs();
    const wrapper = mount(AccountPage);
    await flushPromises();

    // A 提交改密：POST 挂起（稍后以成功释放）。
    await wrapper.get('[data-testid="password-toggle"]').trigger("click");
    await wrapper.get('[data-testid="current-password"]').setValue("OldPass1!");
    await wrapper.get('[data-testid="new-password"]').setValue("NewPass1!");
    await wrapper.get('[data-testid="confirm-password"]').setValue("NewPass1!");
    await wrapper.get('[data-testid="change-password"]').trigger("click");
    await flushPromises();

    // 挂起期间另一入口同会话 GET /auth/session 读回同一身份：只是读取，
    // 不构成新凭据，不得让旧改密成功让位。
    const transport = createAuthenticatedTransport({
      getAccessToken: () => auth.accessToken,
      getSessionRevision: () => auth.getSessionRevision(),
      onUnauthorized: () => auth.onUnauthorized(),
    });
    await expect(auth.tryRefresh(transport)).resolves.toBe(true);
    expect(auth.accountId).toBe("42");

    // 迟到成功到达：服务端已撤销全部会话，必须本地退出并去登录页。
    gate.resolve(undefined);
    await flushPromises();
    expect(auth.isAuthenticated).toBe(false);
    expect(auth.sessionStatus).toBe("anonymous");
    expect((globalThis as unknown as {
      uni: { navigateTo: ReturnType<typeof vi.fn> };
    }).uni.navigateTo)
      .toHaveBeenCalledWith({ url: "/pages/login/login" });
    wrapper.unmount();
  });

  it("VC-R15: 挂起期间的失败登录意图不让位：改密成功仍正常退出", async () => {
    const gate = makeGate();
    stubFetch({ passwordGate: gate, passwordGateOk: true, loginRejected: true });
    const auth = loginAs();
    const wrapper = mount(AccountPage);
    await flushPromises();

    // A 提交改密：POST 挂起（稍后以成功释放）。
    await wrapper.get('[data-testid="password-toggle"]').trigger("click");
    await wrapper.get('[data-testid="current-password"]').setValue("OldPass1!");
    await wrapper.get('[data-testid="new-password"]').setValue("NewPass1!");
    await wrapper.get('[data-testid="confirm-password"]').setValue("NewPass1!");
    await wrapper.get('[data-testid="change-password"]').trigger("click");
    await flushPromises();

    // 挂起期间一次真实失败登录（404）：只是登录「意图」，没有提交新凭据。
    const transport = createAuthenticatedTransport({
      getAccessToken: () => auth.accessToken,
      getSessionRevision: () => auth.getSessionRevision(),
      onUnauthorized: () => auth.onUnauthorized(),
    });
    await expect(auth.login(transport, "alice@example.com", "wrong")).resolves.toBeNull();
    expect(auth.error).toBe("invalid-credentials");
    expect(auth.accountId).toBe("42");

    // 迟到成功到达：正常退出仍要发生，否则用户改完密退不出去。
    gate.resolve(undefined);
    await flushPromises();
    expect(auth.isAuthenticated).toBe(false);
    expect(auth.sessionStatus).toBe("anonymous");
    expect((globalThis as unknown as {
      uni: { navigateTo: ReturnType<typeof vi.fn> };
    }).uni.navigateTo)
      .toHaveBeenCalledWith({ url: "/pages/login/login" });
    wrapper.unmount();
  });
});
