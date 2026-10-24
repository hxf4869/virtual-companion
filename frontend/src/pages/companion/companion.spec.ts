// @vitest-environment happy-dom
// 陪伴设置页：偏好加载、字段往返与保存状态机（基线始终来自服务端回读）。
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAuthenticatedTransport } from "@/api/transport";
import { useAuthStore } from "@/stores/auth";

import CompanionPage from "./companion.vue";

const ACTIVE_RELATIONSHIP = {
  relationshipId: 42,
  personaRef: "gentle-listener",
  active: true,
  companionName: "林夏",
  userAddressAs: "小安",
  replyLength: "MEDIUM",
  initiative: "LOW",
  humor: "LIGHT",
  advicePref: "ASK_FIRST",
  remindersAllowed: true,
  memoryShareScope: "RELATIONSHIP",
  avoidTopics: ["WORK"],
  gender: "NEUTRAL",
  avatarRef: "AVATAR_NEUTRAL_01",
};

// VC-R13：换号后的 B 账号陪伴形状——与 A 完全不同，便于断言不串号。
const SWITCHED_RELATIONSHIP = {
  relationshipId: 77,
  personaRef: "steady-planner",
  active: true,
  companionName: "沈屿",
  userAddressAs: "阿岚",
  replyLength: "SHORT",
  initiative: "HIGH",
  humor: "WARM",
  advicePref: "DIRECT",
  remindersAllowed: false,
  memoryShareScope: "SESSION",
  avoidTopics: [],
  gender: "FEMALE",
  avatarRef: "AVATAR_FEMALE_01",
};

interface Gate {
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
}

interface FetchOptions {
  relationships?: unknown[] | (() => unknown[]);
  relationshipStatus?: number;
  /** VC-R13：GET /relationships 响应返回前的闸门（数据先快照再等待）。 */
  beforeRelationships?: () => Promise<void>;
  patchStatus?: number;
  patchJson?: unknown | (() => unknown);
  patchParseFailed?: boolean;
  patchBodyRef?: { body?: Record<string, unknown> };
  /** 提供时，PATCH 请求挂起直到手动 resolve（用于在途保存场景）。 */
  patchGate?: Gate;
  /** VC-R13：仅挂起第一条 PATCH（旧账号在途保存），后续 PATCH 正常响应。 */
  firstPatchGate?: Gate;
  /** VC-R13：POST /api/v1/auth/login 返回的 accountId（默认换号到 "9"）。 */
  loginAccountId?: string;
}

function resolveOption<T>(value: T | (() => T) | undefined, fallback: T): T {
  if (typeof value === "function") return (value as () => T)();
  return value ?? fallback;
}

function response(status: number, json: unknown, parseFailed = false) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: parseFailed
      ? async () => {
          throw new TypeError("unreadable body");
        }
      : async () => json,
  };
}

function stubFetch(options: FetchOptions = {}) {
  const calls: Array<{ method: string; url: string; body?: string }> = [];
  let firstPatchHoldUsed = false;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, url, body: typeof init?.body === "string" ? init.body : undefined });

    if (url === "/api/v1/auth/login" && method === "POST") {
      // VC-R13：真实换号/重登录动作——mock 直接完成登录并推进会话代次。
      return response(200, {
        nextStep: "ACTIVE",
        accountId: options.loginAccountId ?? "9",
        email: "b@example.com",
        role: "USER",
        sessionId: "9",
        passwordMustChange: false,
        authenticatorEnabled: true,
        expiresInSeconds: 7200,
      });
    }
    if (url === "/api/v1/relationships" && method === "GET") {
      const status = options.relationshipStatus ?? 200;
      // VC-R13：数据在过闸门前先快照——释放闸门时送达发起时刻账号的数据。
      const rows = resolveOption(options.relationships, [ACTIVE_RELATIONSHIP]);
      if (options.beforeRelationships) await options.beforeRelationships();
      return response(status, status === 200 ? rows : null);
    }
    if (url.startsWith("/api/v1/relationships/") && method === "PATCH") {
    if (options.patchBodyRef) {
      options.patchBodyRef.body = JSON.parse(
        typeof init?.body === "string" ? init.body : "{}",
      ) as Record<string, unknown>;
    }
      if (options.patchGate) return options.patchGate.promise as never;
      if (options.firstPatchGate && !firstPatchHoldUsed) {
        firstPatchHoldUsed = true;
        return options.firstPatchGate.promise as never;
      }
      const status = options.patchStatus ?? 200;
      if (status !== 200) return response(status, { code: "INVALID_REQUEST" });
      return response(
        200,
        resolveOption(options.patchJson, ACTIVE_RELATIONSHIP),
        options.patchParseFailed,
      );
    }
    return response(200, {});
  }));
  return { calls };
}

function login(): void {
  const auth = useAuthStore();
  auth.accessToken = "session";
  auth.accountId = "7";
  auth.role = "USER";
}

function mountPage() {
  return mount(CompanionPage, { attachTo: document.body });
}

// VC-R13：模拟 uni H5 KeepAlive 停用/激活（隐藏实例仍存活，惯例同 index.spec.ts）。
function keepAliveHooksOf(wrapper: ReturnType<typeof mountPage>) {
  const internal = wrapper.vm.$ as unknown as {
    a?: Array<() => void>;
    da?: Array<() => void>;
  };
  return {
    deactivate: () => internal.da?.forEach((hook) => hook()),
    activate: () => internal.a?.forEach((hook) => hook()),
  };
}

// VC-R13：走真实认证写路径换号/重登录（不直接 patch accountId）。
async function loginViaAuth(email = "b@example.com"): Promise<void> {
  const auth = useAuthStore();
  const transport = createAuthenticatedTransport({
    getAccessToken: () => auth.accessToken,
    getSessionRevision: () => auth.getSessionRevision(),
    getSessionId: () => null,
    onUnauthorized: () => auth.clear(),
  });
  await auth.login(transport, email, "pw-b");
}

function relationshipGets(calls: Array<{ method: string; url: string }>): number {
  return calls.filter((call) => call.method === "GET" && call.url === "/api/v1/relationships").length;
}

describe("陪伴设置页", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    setActivePinia(createPinia());
    vi.stubGlobal("uni", {
      navigateTo: vi.fn(),
      navigateBack: vi.fn(),
      redirectTo: vi.fn(),
    });
    login();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("先显示加载骨架，再按服务端基线渲染表单", async () => {
    stubFetch();
    const wrapper = mountPage();

    expect(wrapper.find('[data-testid="companion-loading"]').exists()).toBe(true);
    await flushPromises();

    expect(wrapper.find('[data-testid="companion-form"]').exists()).toBe(true);
    expect((wrapper.get('[data-testid="pref-companion-name"]').element as HTMLInputElement).value).toBe("林夏");
    expect((wrapper.get('[data-testid="pref-user-address-as"]').element as HTMLInputElement).value).toBe("小安");
    expect(wrapper.get('[data-testid="pref-reply-length-MEDIUM"]').attributes("aria-checked"))
      .toBe("true");
    expect(wrapper.get('[data-testid="pref-topic-WORK"]').attributes("aria-checked")).toBe("true");
    expect(wrapper.get('[data-testid="pref-topic-FAMILY"]').attributes("aria-checked")).toBe("false");
    // 未实现的提醒能力不暴露 UI（缺陷 13）。
    expect(wrapper.find('[data-testid="pref-reminders"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("允许提醒");
    expect(wrapper.text()).not.toContain("提醒你关心的事");
    expect(wrapper.text()).toContain("简短一些");
    expect(wrapper.text()).toContain("先问我再建议");
    expect(wrapper.find('[data-testid="companion-dirty"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="companion-save"]').attributes("disabled")).toBeDefined();
    expect(wrapper.find('[data-testid="consumer-tabbar"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("字段修改后标记未保存，并把完整替换体发给 PATCH", async () => {
    const patchBodyRef: { body?: Record<string, unknown> } = {};
    stubFetch({ patchBodyRef });
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-testid="pref-companion-name"]').setValue("阿澈");
    await wrapper.get('[data-testid="pref-reply-length-LONG"]').trigger("click");
    await wrapper.get('[data-testid="pref-topic-FAMILY"]').trigger("click");

    expect(wrapper.get('[data-testid="companion-dirty"]').text()).toContain("未保存");
    const save = wrapper.get('[data-testid="companion-save"]');
    expect(save.attributes("disabled")).toBeUndefined();

    await save.trigger("click");
    await flushPromises();

    // remindersAllowed 无 UI 入口，payload 始终取服务端基线值（true）。
    expect(patchBodyRef.body).toEqual({
      companionName: "阿澈",
      userAddressAs: "小安",
      replyLength: "LONG",
      initiative: "LOW",
      humor: "LIGHT",
      advicePref: "ASK_FIRST",
      remindersAllowed: true,
      memoryShareScope: "RELATIONSHIP",
      avoidTopics: ["WORK", "FAMILY"],
      gender: "NEUTRAL",
      avatarRef: "AVATAR_NEUTRAL_01",
    });
    wrapper.unmount();
  });

  it("保存成功以服务端回读更新基线，而不是保留本地草稿", async () => {
    const saved = {
      ...ACTIVE_RELATIONSHIP,
      companionName: "阿澈",
      replyLength: "LONG",
    };
    stubFetch({ patchJson: saved });
    const wrapper = mountPage();
    await flushPromises();

    // 草稿带一个会被服务端归一化的尾随空格。
    await wrapper.get('[data-testid="pref-companion-name"]').setValue("阿澈 ");
    await wrapper.get('[data-testid="pref-reply-length-LONG"]').trigger("click");
    await wrapper.get('[data-testid="companion-save"]').trigger("click");
    await flushPromises();

    expect((wrapper.get('[data-testid="pref-companion-name"]').element as HTMLInputElement).value).toBe("阿澈");
    expect(wrapper.find('[data-testid="companion-dirty"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="companion-saved"]').text()).toBe("已保存");
    expect(wrapper.get('[data-testid="companion-save"]').attributes("disabled")).toBeDefined();
    wrapper.unmount();
  });

  it("保存期间继续编辑：响应只更新基线，草稿保留且 dirty 按新基线重算", async () => {
    let resolvePatch!: (value: unknown) => void;
    const patchGate: Gate = {
      promise: new Promise((resolve) => {
        resolvePatch = resolve;
      }),
      resolve: (value: unknown) => resolvePatch(value),
    };
    stubFetch({ patchGate });
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-testid="pref-reply-length-LONG"]').trigger("click");
    await wrapper.get('[data-testid="companion-save"]').trigger("click");
    // 保存请求在途：继续编辑草稿不被阻止，保存按钮保持禁用。
    await wrapper.get('[data-testid="pref-companion-name"]').setValue("阿澈");
    expect(wrapper.get('[data-testid="companion-save"]').attributes("disabled")).toBeDefined();

    resolvePatch(response(200, { ...ACTIVE_RELATIONSHIP, replyLength: "LONG" }));
    await flushPromises();

    // 草稿保留用户在途编辑的名字，没有被服务端回读覆盖。
    expect((wrapper.get('[data-testid="pref-companion-name"]').element as HTMLInputElement).value)
      .toBe("阿澈");
    expect(wrapper.get('[data-testid="pref-reply-length-LONG"]').attributes("aria-checked")).toBe("true");
    // 基线已更新为服务端回读值，dirty 按新基线重算（名字仍未保存）。
    expect(wrapper.get('[data-testid="companion-dirty"]').text()).toContain("未保存");
    expect(wrapper.find('[data-testid="companion-saved"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="companion-save"]').attributes("disabled")).toBeUndefined();
    wrapper.unmount();
  });

  it("保存在途期间重复点击只发一次请求", async () => {
    let resolvePatch!: (value: unknown) => void;
    const patchGate: Gate = {
      promise: new Promise((resolve) => {
        resolvePatch = resolve;
      }),
      resolve: (value: unknown) => resolvePatch(value),
    };
    const { calls } = stubFetch({ patchGate });
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-testid="pref-companion-name"]').setValue("阿澈");
    const save = wrapper.get('[data-testid="companion-save"]');
    await save.trigger("click");
    await save.trigger("click");
    expect(calls.filter((call) => call.method === "PATCH")).toHaveLength(1);
    expect(save.attributes("disabled")).toBeDefined();

    resolvePatch(response(200, ACTIVE_RELATIONSHIP));
    await flushPromises();
    expect(wrapper.find('[data-testid="companion-dirty"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("响应带回不同 remindersAllowed 时不误报 dirty（该字段不参与 dirty）", async () => {
    let resolvePatch!: (value: unknown) => void;
    const patchGate: Gate = {
      promise: new Promise((resolve) => {
        resolvePatch = resolve;
      }),
      resolve: (value: unknown) => resolvePatch(value),
    };
    stubFetch({ patchGate, patchJson: { ...ACTIVE_RELATIONSHIP, remindersAllowed: false } });
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-testid="pref-companion-name"]').setValue("阿澈");
    await wrapper.get('[data-testid="companion-save"]').trigger("click");
    // 保存期间继续编辑并改回基线值：草稿快照被打破，响应到达后草稿保留。
    await wrapper.get('[data-testid="pref-companion-name"]').setValue("林夏");

    resolvePatch(response(200, { ...ACTIVE_RELATIONSHIP, remindersAllowed: false }));
    await flushPromises();

    // 草稿的 remindersAllowed 仍为基线旧值 true，回读为 false：
    // 该字段无 UI 入口，差异不构成 dirty。
    expect(wrapper.find('[data-testid="companion-dirty"]').exists()).toBe(false);
    expect((wrapper.get('[data-testid="pref-companion-name"]').element as HTMLInputElement).value)
      .toBe("林夏");
    wrapper.unmount();
  });

  it("保存失败保留草稿并允许原样重试", async () => {
    stubFetch({ patchStatus: 500 });
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-testid="pref-companion-name"]').setValue("阿澈");
    await wrapper.get('[data-testid="companion-save"]').trigger("click");
    await flushPromises();

    expect(wrapper.get('[data-testid="companion-save-error"]').text()).toContain("留在页面上");
    expect((wrapper.get('[data-testid="pref-companion-name"]').element as HTMLInputElement).value).toBe("阿澈");
    expect(wrapper.find('[data-testid="companion-dirty"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="companion-save"]').attributes("disabled")).toBeUndefined();
    wrapper.unmount();
  });

  it("提交结果未知时提示未确认并提供重新读取", async () => {
    const { calls } = stubFetch({ patchParseFailed: true });
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-testid="pref-companion-name"]').setValue("阿澈");
    await wrapper.get('[data-testid="companion-save"]').trigger("click");
    await flushPromises();

    expect(wrapper.get('[data-testid="companion-unknown"]').text()).toContain("未能确认是否生效");
    expect(wrapper.find('[data-testid="companion-save-error"]').exists()).toBe(false);

    await wrapper.get('[data-testid="companion-reload"]').trigger("click");
    await flushPromises();
    expect(calls.filter((call) => call.method === "GET" && call.url === "/api/v1/relationships"))
      .toHaveLength(2);
    expect(wrapper.find('[data-testid="companion-unknown"]').exists()).toBe(false);
    expect((wrapper.get('[data-testid="pref-companion-name"]').element as HTMLInputElement).value)
      .toBe("林夏");
    wrapper.unmount();
  });

  it("没有 active 关系时显示空态并引导去聊天", async () => {
    stubFetch({ relationships: [] });
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.get('[data-testid="companion-empty"]').text()).toContain("还没准备好");
    expect(wrapper.text()).not.toContain("创建陪伴");
    await wrapper.get('[data-testid="companion-go-chat"]').trigger("click");
    expect((globalThis as unknown as {
      uni: { navigateTo: ReturnType<typeof vi.fn> };
    }).uni.navigateTo).toHaveBeenCalledWith({ url: "/pages/chat/chat" });
    wrapper.unmount();
  });

  it("加载失败给出重试并恢复表单", async () => {
    const relationshipStatuses = [503, 200];
    const { calls } = stubFetch({
      get relationshipStatus(): number {
        return relationshipStatuses.shift() ?? 200;
      },
    });
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.get('[data-testid="companion-load-failed"]').text()).toContain("没有加载出来");

    await wrapper.get('[data-testid="companion-retry"]').trigger("click");
    await flushPromises();

    expect(calls.filter((call) => call.url === "/api/v1/relationships")).toHaveLength(2);
    expect(wrapper.find('[data-testid="companion-form"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("换号后隐藏缓存页立即清空旧账号草稿，重新激活后只加载新账号内容", async () => {
    let switched = false;
    const { calls } = stubFetch({
      relationships: () => (switched ? [SWITCHED_RELATIONSHIP] : [ACTIVE_RELATIONSHIP]),
    });
    const wrapper = mountPage();
    await flushPromises();
    // A 留下未保存草稿后离开页面（实例进入 KeepAlive 缓存）。
    await wrapper.get('[data-testid="pref-companion-name"]').setValue("阿澈");
    const page = keepAliveHooksOf(wrapper);
    page.deactivate();

    const getsBeforeSwitch = relationshipGets(calls);
    switched = true;
    await loginViaAuth();
    await flushPromises();
    expect(useAuthStore().accountId).toBe("9");

    // 隐藏的缓存页立即清空旧账号内容（含未保存草稿），清理本身不发起新读取。
    expect(relationshipGets(calls)).toBe(getsBeforeSwitch);
    expect(wrapper.find('[data-testid="companion-loading"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="pref-companion-name"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("林夏");

    // 重新激活（浏览器返回本页）：按新账号重新加载。
    page.activate();
    await flushPromises();
    expect((wrapper.get('[data-testid="pref-companion-name"]').element as HTMLInputElement).value)
      .toBe("沈屿");
    expect(relationshipGets(calls)).toBe(getsBeforeSwitch + 1);
    wrapper.unmount();
  });

  it("空态起点换号：A 无关系的空态页隐藏后换 B，激活加载 B 表单而非停留旧空态", async () => {
    // 对应真实浏览器存活链的起点：A 空 relationships 的 companion-empty
    // （去聊天压栈隐藏→401 换号→返回本页），而非已就绪表单实例。
    let switched = false;
    const { calls } = stubFetch({
      relationships: () => (switched ? [SWITCHED_RELATIONSHIP] : []),
    });
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.find('[data-testid="companion-empty"]').exists()).toBe(true);

    const page = keepAliveHooksOf(wrapper);
    page.deactivate();
    const getsBeforeSwitch = relationshipGets(calls);
    switched = true;
    await loginViaAuth();
    await flushPromises();
    expect(useAuthStore().accountId).toBe("9");

    // 隐藏清理不发起新读取；激活后按 B 重载表单，不停留在 A 的旧空态。
    expect(relationshipGets(calls)).toBe(getsBeforeSwitch);
    page.activate();
    await flushPromises();
    expect((wrapper.get('[data-testid="pref-companion-name"]').element as HTMLInputElement).value)
      .toBe("沈屿");
    expect(wrapper.find('[data-testid="companion-empty"]').exists()).toBe(false);
    expect(relationshipGets(calls)).toBe(getsBeforeSwitch + 1);
    wrapper.unmount();
  });

  it("旧账号在途的偏好读取迟到成功不得回填新账号表单", async () => {
    let releaseHeldRelationships: () => void = () => {};
    const heldRelationships = new Promise<void>((resolve) => {
      releaseHeldRelationships = resolve;
    });
    let heldOnce = false;
    let switched = false;
    stubFetch({
      relationships: () => (switched ? [SWITCHED_RELATIONSHIP] : [ACTIVE_RELATIONSHIP]),
      beforeRelationships: () => {
        if (heldOnce) return Promise.resolve();
        heldOnce = true;
        return heldRelationships;
      },
    });
    const wrapper = mountPage();
    await flushPromises();
    // A 的偏好读取跨过切号仍挂起，页面停在加载反馈。
    expect(wrapper.find('[data-testid="companion-loading"]').exists()).toBe(true);

    const page = keepAliveHooksOf(wrapper);
    page.deactivate();
    switched = true;
    await loginViaAuth();
    await flushPromises();

    // 重新激活并完成 B 自己的读取。
    page.activate();
    await flushPromises();
    expect((wrapper.get('[data-testid="pref-companion-name"]').element as HTMLInputElement).value)
      .toBe("沈屿");
    expect(wrapper.find('[data-testid="companion-loading"]').exists()).toBe(false);

    // A 的迟到 200 到达：不回填旧账号内容，不破坏 B 的就绪状态。
    releaseHeldRelationships();
    await flushPromises();
    expect((wrapper.get('[data-testid="pref-companion-name"]').element as HTMLInputElement).value)
      .toBe("沈屿");
    expect(wrapper.find('[data-testid="companion-loading"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="companion-load-failed"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("旧账号在途保存迟到不得改写新账号基线，也不得占住新账号的保存", async () => {
    let switched = false;
    let resolveFirstPatch!: (value: unknown) => void;
    const firstPatchGate: Gate = {
      promise: new Promise((resolve) => {
        resolveFirstPatch = resolve;
      }),
      resolve: (value: unknown) => resolveFirstPatch(value),
    };
    const { calls } = stubFetch({
      relationships: () => (switched ? [SWITCHED_RELATIONSHIP] : [ACTIVE_RELATIONSHIP]),
      firstPatchGate,
      patchJson: () => (switched
        ? { ...SWITCHED_RELATIONSHIP, companionName: "岚姐" }
        : ACTIVE_RELATIONSHIP),
    });
    const wrapper = mountPage();
    await flushPromises();
    await wrapper.get('[data-testid="pref-companion-name"]').setValue("阿澈");
    await wrapper.get('[data-testid="companion-save"]').trigger("click");
    // A 的保存在途（挂起），保存位被占用。
    expect(calls.filter((call) => call.method === "PATCH")).toHaveLength(1);

    const page = keepAliveHooksOf(wrapper);
    page.deactivate();
    switched = true;
    await loginViaAuth();
    await flushPromises();

    // 重新激活：B 的表单就位后可以立刻发起新保存（A 的在途保存不占住保存位）。
    page.activate();
    await flushPromises();
    await wrapper.get('[data-testid="pref-companion-name"]').setValue("岚姐");
    await wrapper.get('[data-testid="companion-save"]').trigger("click");
    await flushPromises();
    expect(calls.filter((call) => call.method === "PATCH")).toHaveLength(2);
    expect(wrapper.get('[data-testid="companion-saved"]').text()).toBe("已保存");
    expect(wrapper.get('[data-testid="pref-reply-length-SHORT"]').attributes("aria-checked"))
      .toBe("true");

    // A 的迟到保存响应到达：不改写 B 的基线/草稿，不制造脏标记。
    resolveFirstPatch(response(200, { ...ACTIVE_RELATIONSHIP, companionName: "阿澈" }));
    await flushPromises();
    expect((wrapper.get('[data-testid="pref-companion-name"]').element as HTMLInputElement).value)
      .toBe("岚姐");
    expect(wrapper.get('[data-testid="pref-reply-length-SHORT"]').attributes("aria-checked"))
      .toBe("true");
    expect(wrapper.find('[data-testid="companion-dirty"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="companion-saved"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("退出后重新登录同账号：隐藏页已清空，激活后重载且不当作过期内容挂死", async () => {
    const { calls } = stubFetch({ loginAccountId: "7" });
    const wrapper = mountPage();
    await flushPromises();
    expect((wrapper.get('[data-testid="pref-companion-name"]').element as HTMLInputElement).value)
      .toBe("林夏");

    const page = keepAliveHooksOf(wrapper);
    page.deactivate();

    // 退出（已知账号 → null）：隐藏缓存页立即清空旧账号私有内容。
    useAuthStore().clear();
    await flushPromises();
    expect(wrapper.find('[data-testid="companion-loading"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="pref-companion-name"]').exists()).toBe(false);

    // 匿名后重新登录同一账号（null → "7"）：不清理、不当作过期，激活后重载。
    await loginViaAuth("a@example.com");
    page.activate();
    await flushPromises();
    expect((wrapper.get('[data-testid="pref-companion-name"]').element as HTMLInputElement).value)
      .toBe("林夏");
    expect(relationshipGets(calls)).toBe(2);
    wrapper.unmount();
  });

  it("同账号返回缓存页不重复请求，未保存草稿保留", async () => {
    const { calls } = stubFetch();
    const wrapper = mountPage();
    await flushPromises();
    await wrapper.get('[data-testid="pref-companion-name"]').setValue("阿澈");

    const page = keepAliveHooksOf(wrapper);
    page.deactivate();
    page.activate();
    await flushPromises();

    expect(relationshipGets(calls)).toBe(1);
    expect((wrapper.get('[data-testid="pref-companion-name"]').element as HTMLInputElement).value)
      .toBe("阿澈");
    wrapper.unmount();
  });

  it("首次挂载 onMounted 与 onActivated 同触不重复请求", async () => {
    const { calls } = stubFetch();
    const wrapper = mountPage();
    keepAliveHooksOf(wrapper).activate();
    await flushPromises();

    expect(relationshipGets(calls)).toBe(1);
    expect(wrapper.find('[data-testid="companion-form"]').exists()).toBe(true);
    wrapper.unmount();
  });
});
