// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
});
