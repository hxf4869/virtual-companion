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
  /** VC-R189：可按次求值——仅首次 PATCH 回读不可解析，重试保存正常回读。 */
  patchParseFailed?: boolean | (() => boolean);
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
        resolveOption(options.patchParseFailed, false),
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

// VC-R175：真实 keydown（可取消、冒泡），返回事件以断言页面是否接管了默认动作。
function pressKey(element: Element, key: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  element.dispatchEvent(event);
  return event;
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

  // VC-R175：四个单选组按 W3C APG radio 支持键盘。platform/h5-a11y 的全局 shim 已给
  // 未声明 tabindex 的 uni-button 补 0 并接管 Enter/Space 激活；本轮缺口是方向键与
  // roving tabindex（选中项 0、其余 -1），由页面局部处理。这里用真实 keydown + 焦点
  // 验证，不直接改草稿；组件环境不装全局 shim。
  it("单选组方向键按焦点项循环选中并移焦：只改草稿不发 PATCH，保存仍提交完整替换体", async () => {
    const patchBodyRef: { body?: Record<string, unknown> } = {};
    const { calls } = stubFetch({ patchBodyRef });
    const wrapper = mountPage();
    await flushPromises();
    const option = (testid: string) => wrapper.get(`[data-testid="${testid}"]`);

    // 选中项是组内唯一 Tab 停靠点，其余只能由方向键到达。
    expect(option("pref-reply-length-MEDIUM").attributes("tabindex")).toBe("0");
    expect(option("pref-reply-length-SHORT").attributes("tabindex")).toBe("-1");
    expect(option("pref-reply-length-LONG").attributes("tabindex")).toBe("-1");

    const medium = option("pref-reply-length-MEDIUM").element as HTMLElement;
    medium.focus();
    const right = pressKey(medium, "ArrowRight");
    await flushPromises();
    expect(right.defaultPrevented).toBe(true);
    expect(option("pref-reply-length-LONG").attributes("aria-checked")).toBe("true");
    expect(option("pref-reply-length-LONG").attributes("tabindex")).toBe("0");
    expect(option("pref-reply-length-MEDIUM").attributes("aria-checked")).toBe("false");
    expect(option("pref-reply-length-MEDIUM").attributes("tabindex")).toBe("-1");
    const long = option("pref-reply-length-LONG").element as HTMLElement;
    expect(document.activeElement).toBe(long);
    expect(wrapper.get('[data-testid="companion-dirty"]').text()).toContain("未保存");

    // 末项右移回到首项，首项左移回到末项。
    pressKey(long, "ArrowRight");
    await flushPromises();
    const short = option("pref-reply-length-SHORT").element as HTMLElement;
    expect(option("pref-reply-length-SHORT").attributes("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(short);
    pressKey(short, "ArrowLeft");
    await flushPromises();
    expect(option("pref-reply-length-LONG").attributes("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(long);

    // 上下键等价于左右键，只动当前焦点所在组。
    const low = option("pref-initiative-LOW").element as HTMLElement;
    low.focus();
    pressKey(low, "ArrowDown");
    await flushPromises();
    const initiativeMedium = option("pref-initiative-MEDIUM").element as HTMLElement;
    expect(option("pref-initiative-MEDIUM").attributes("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(initiativeMedium);
    pressKey(initiativeMedium, "ArrowUp");
    await flushPromises();
    expect(document.activeElement).toBe(low);
    pressKey(low, "ArrowUp");
    await flushPromises();
    expect(option("pref-initiative-HIGH").attributes("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(option("pref-initiative-HIGH").element);

    // 其它字段原样，键盘编辑只改草稿、不提前提交。
    expect(option("pref-reply-length-LONG").attributes("aria-checked")).toBe("true");
    expect(option("pref-advice-ASK_FIRST").attributes("aria-checked")).toBe("true");
    expect(option("pref-humor-LIGHT").attributes("aria-checked")).toBe("true");
    expect(option("pref-topic-WORK").attributes("aria-checked")).toBe("true");
    expect(calls.filter((call) => call.method === "PATCH")).toHaveLength(0);

    await wrapper.get('[data-testid="companion-save"]').trigger("click");
    await flushPromises();
    expect(calls.filter((call) => call.method === "PATCH")).toHaveLength(1);
    expect(patchBodyRef.body).toEqual({
      companionName: "林夏",
      userAddressAs: "小安",
      replyLength: "LONG",
      initiative: "HIGH",
      humor: "LIGHT",
      advicePref: "ASK_FIRST",
      remindersAllowed: true,
      memoryShareScope: "RELATIONSHIP",
      avoidTopics: ["WORK"],
      gender: "NEUTRAL",
      avatarRef: "AVATAR_NEUTRAL_01",
    });
    wrapper.unmount();
  });

  it("单选组非方向键放行给全局 shim：不接管默认动作、不改选中、不发 PATCH", async () => {
    const { calls } = stubFetch();
    const wrapper = mountPage();
    await flushPromises();
    const option = (testid: string) => wrapper.get(`[data-testid="${testid}"]`);

    // Enter/Space 的激活属于 platform/h5-a11y 的 document 级状态机（含 repeat
    // 防抖），页面若自行 preventDefault 或 click 会让 shim 退出并造成双触发；
    // Tab 与字符键同样只能原样放行。本环境未装 shim，合成 keydown 不应改变任何选中。
    const none = option("pref-humor-NONE").element as HTMLElement;
    none.focus();
    for (const key of [" ", "Enter", "Tab", "a"]) {
      const event = pressKey(none, key);
      await flushPromises();
      expect(event.defaultPrevented, `key ${JSON.stringify(key)}`).toBe(false);
    }
    expect(option("pref-humor-NONE").attributes("aria-checked")).toBe("false");
    expect(option("pref-humor-LIGHT").attributes("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(none);
    expect(wrapper.find('[data-testid="companion-dirty"]').exists()).toBe(false);
    expect(calls.filter((call) => call.method === "PATCH")).toHaveLength(0);
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

  // VC-R189：结果未知的保存其实已生效（服务端应用了提交 A）。重新读取拿到权威 A 时
  // 不得吞掉保存请求发出后新增的编辑 B：基线换成 A、草稿整份保留 B、dirty 按新
  // 基线计算，第二次保存实际携带 B，成功后正常收束。
  it("未知保存后重新读取保留提交后新增的编辑，再次保存携带最新草稿", async () => {
    const patchBodyRef: { body?: Record<string, unknown> } = {};
    let patchCount = 0;
    const { calls } = stubFetch({
      patchBodyRef,
      // 服务端按全量替换应用每次 PATCH：读取返回最近一次已提交内容（首次提交前为初始基线）。
      relationships: () => [{ ...ACTIVE_RELATIONSHIP, ...patchBodyRef.body }],
      patchJson: () => ({ ...ACTIVE_RELATIONSHIP, ...patchBodyRef.body }),
      // 仅首次 PATCH（已提交但回读不可解析）结果未知；重试保存正常回读。
      patchParseFailed: () => patchCount++ === 0,
    });
    const wrapper = mountPage();
    await flushPromises();
    expect((wrapper.get('[data-testid="pref-companion-name"]').element as HTMLInputElement).value)
      .toBe("林夏");

    await wrapper.get('[data-testid="pref-companion-name"]').setValue("阿澈");
    await wrapper.get('[data-testid="companion-save"]').trigger("click");
    await flushPromises();
    expect(wrapper.get('[data-testid="companion-unknown"]').text()).toContain("未能确认是否生效");

    // 保存请求发出后继续编辑（B）：对我的称呼。
    await wrapper.get('[data-testid="pref-user-address-as"]').setValue("R189新称呼");

    await wrapper.get('[data-testid="companion-reload"]').trigger("click");
    await flushPromises();
    // 权威 GET 确为已提交的 A：名字已生效；未知横幅收束。
    expect(calls.filter((call) => call.method === "GET" && call.url === "/api/v1/relationships"))
      .toHaveLength(2);
    expect(wrapper.find('[data-testid="companion-unknown"]').exists()).toBe(false);
    expect((wrapper.get('[data-testid="pref-companion-name"]').element as HTMLInputElement).value)
      .toBe("阿澈");
    // B 仍在，dirty 按新基线（A）计算，保存按钮可用。
    expect((wrapper.get('[data-testid="pref-user-address-as"]').element as HTMLInputElement).value)
      .toBe("R189新称呼");
    expect(wrapper.get('[data-testid="companion-dirty"]').text()).toContain("未保存");
    expect(wrapper.get('[data-testid="companion-save"]').attributes("disabled")).toBeUndefined();

    await wrapper.get('[data-testid="companion-save"]').trigger("click");
    await flushPromises();
    expect(calls.filter((call) => call.method === "PATCH")).toHaveLength(2);
    expect(patchBodyRef.body).toEqual({
      companionName: "阿澈",
      userAddressAs: "R189新称呼",
      replyLength: "MEDIUM",
      initiative: "LOW",
      humor: "LIGHT",
      advicePref: "ASK_FIRST",
      remindersAllowed: true,
      memoryShareScope: "RELATIONSHIP",
      avoidTopics: ["WORK"],
      gender: "NEUTRAL",
      avatarRef: "AVATAR_NEUTRAL_01",
    });
    expect(wrapper.get('[data-testid="companion-saved"]').text()).toBe("已保存");
    expect(wrapper.find('[data-testid="companion-dirty"]').exists()).toBe(false);
    expect((wrapper.get('[data-testid="pref-user-address-as"]').element as HTMLInputElement).value)
      .toBe("R189新称呼");
    wrapper.unmount();
  });

  // VC-R204：未知结果的核对入口同理：键盘发起「重新读取」后表单被骨架屏
  // 整棵替换，聚焦中的按钮被卸载。收尾须把焦点送回表单首字段（称呼），
  // 键盘/读屏用户从那里继续核对草稿，而不是从文档顶重新导航。
  it("未知结果后键盘发起重新读取，收尾后焦点落到表单首字段", async () => {
    stubFetch({ patchParseFailed: true });
    const wrapper = mountPage();
    await flushPromises();
    await wrapper.get('[data-testid="pref-companion-name"]').setValue("阿澈");
    await wrapper.get('[data-testid="companion-save"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="companion-unknown"]').exists()).toBe(true);

    (wrapper.get('[data-testid="companion-reload"]').element as HTMLElement).focus();
    await wrapper.get('[data-testid="companion-reload"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="companion-unknown"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="companion-form"]').exists()).toBe(true);
    expect(document.activeElement).toBe(
      wrapper.get('[data-testid="pref-companion-name"]').element,
    );
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

  // VC-R204：键盘用户从错误卡发起重试后，加载分支把聚焦中的「重新加载」
  // 整棵卸载成骨架屏，焦点掉到 body；弱网下每轮重试都重演。收尾后须把
  // 焦点送回本次流程的落点：仍失败聚焦新的「重新加载」（Enter 可直接再
  // 试，同首页 R203 手动重试语义），成功聚焦表单首字段。
  it("加载失败后键盘重试不丢焦点：再次失败回到重试按钮，成功落到表单首字段", async () => {
    const relationshipStatuses = [503, 503, 200];
    stubFetch({
      get relationshipStatus(): number {
        return relationshipStatuses.shift() ?? 200;
      },
    });
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.find('[data-testid="companion-load-failed"]').exists()).toBe(true);

    const retry = () => wrapper.get('[data-testid="companion-retry"]');
    (retry().element as HTMLElement).focus();
    await retry().trigger("click");
    await flushPromises();
    // 再次失败：焦点回到新的重试按钮上，键盘可原地继续重试。
    expect(wrapper.find('[data-testid="companion-load-failed"]').exists()).toBe(true);
    expect(document.activeElement).toBe(retry().element);

    await retry().trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="companion-form"]').exists()).toBe(true);
    expect(document.activeElement).toBe(
      wrapper.get('[data-testid="pref-companion-name"]').element,
    );
    wrapper.unmount();
  });

  // VC-R204：焦点恢复只属于按钮触发的重载。初载（自动）不主动聚焦任何
  // 字段；手动重载在途时用户已把焦点移到页外元素，收尾不抢回（同会话
  // 列表 R201 的"移走不抢回"原则）。
  it("自动加载不主动聚焦；手动重载在途被移走的焦点不被抢回", async () => {
    stubFetch();
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.find('[data-testid="companion-form"]').exists()).toBe(true);
    expect(document.activeElement).toBe(document.body);
    wrapper.unmount();

    let releaseReload!: () => void;
    const reloadGate = new Promise<void>((resolve) => {
      releaseReload = resolve;
    });
    let heldSecondGet = false;
    stubFetch({
      patchParseFailed: true,
      beforeRelationships: () => {
        if (heldSecondGet) return reloadGate;
        heldSecondGet = true;
        return Promise.resolve();
      },
    });
    const reloading = mountPage();
    await flushPromises();
    await reloading.get('[data-testid="pref-companion-name"]').setValue("阿澈");
    await reloading.get('[data-testid="companion-save"]').trigger("click");
    await flushPromises();
    expect(reloading.find('[data-testid="companion-unknown"]').exists()).toBe(true);

    const outside = document.createElement("button");
    document.body.appendChild(outside);
    await reloading.get('[data-testid="companion-reload"]').trigger("click");
    await flushPromises();
    // 读取在途：用户把焦点移到页外元素。
    outside.focus();
    releaseReload();
    await flushPromises();
    expect(reloading.find('[data-testid="companion-unknown"]').exists()).toBe(false);
    expect(reloading.find('[data-testid="companion-form"]').exists()).toBe(true);
    expect(document.activeElement).toBe(outside);
    outside.remove();
    reloading.unmount();
  });

  // VC-R204：换号边界。A 的手动重载在途（GET 挂起）时换号 B：B 的
  // onActivated 自动重载不得消费 A 残留的焦点意图去主动聚焦新账号字段
  //（意图必须随本次请求闭包走，不落页面级共享状态）；A 的迟到响应也不
  // 得影响 B 的表单与焦点。
  it("A 手动重载在途换号 B：B 自动加载不主动聚焦，A 迟到不影响 B", async () => {
    let switched = false;
    let releaseHeldGet!: () => void;
    const heldGet = new Promise<void>((resolve) => {
      releaseHeldGet = resolve;
    });
    let getSeq = 0;
    stubFetch({
      relationships: () => (switched ? [SWITCHED_RELATIONSHIP] : [ACTIVE_RELATIONSHIP]),
      patchParseFailed: true,
      // GET#1 初载、GET#3（B 激活后自动重载）放行；仅 GET#2（A 的手动
      // 重新读取）挂起，模拟换号跨过的在途请求。
      beforeRelationships: () => {
        getSeq += 1;
        return getSeq === 2 ? heldGet : Promise.resolve();
      },
    });
    const wrapper = mountPage();
    await flushPromises();
    expect((wrapper.get('[data-testid="pref-companion-name"]').element as HTMLInputElement).value)
      .toBe("林夏");

    // A：保存结果未知后键盘发起「重新读取」，GET 挂起在途。
    await wrapper.get('[data-testid="pref-companion-name"]').setValue("阿澈");
    await wrapper.get('[data-testid="companion-save"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="companion-unknown"]').exists()).toBe(true);
    await wrapper.get('[data-testid="companion-reload"]').trigger("click");
    await flushPromises();

    // 换号 B（隐藏缓存页由 watch 清理），返回本页触发自动重载。
    const page = keepAliveHooksOf(wrapper);
    page.deactivate();
    switched = true;
    await loginViaAuth();
    await flushPromises();
    page.activate();
    await flushPromises();

    // B 的自动重载成功：表单是 B 的内容，但焦点不得被 A 的手动意图带走。
    expect((wrapper.get('[data-testid="pref-companion-name"]').element as HTMLInputElement).value)
      .toBe("沈屿");
    expect(document.activeElement).toBe(document.body);

    // A 的迟到响应到达：不影响 B 的表单、加载状态与焦点。
    releaseHeldGet();
    await flushPromises();
    expect((wrapper.get('[data-testid="pref-companion-name"]').element as HTMLInputElement).value)
      .toBe("沈屿");
    expect(wrapper.find('[data-testid="companion-loading"]').exists()).toBe(false);
    expect(document.activeElement).toBe(document.body);
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

  // —— VC-R178：未保存更改的离开保护。守卫经 getApp().$router.beforeEach 注册
  //（uni-h5 的 navigateBack/navigateTo/redirectTo 与浏览器后退都汇到该路由），
  // 确认走浏览器原生 confirm（uni.showModal 的按钮在 uni-h5 是不可 Tab 到达的
  // 裸 div，不复制该缺口）。 ——
  const LEAVE_CONFIRM_MESSAGE = "本页还有更改，离开后页面上的草稿不会保留。确定离开吗？";

  type LeaveGuard = (to: { path: string }, from: { path: string }) => Promise<boolean>;

  function stubH5Router(): {
    guards: LeaveGuard[];
    removeGuard: ReturnType<typeof vi.fn>;
    beforeEach: ReturnType<typeof vi.fn>;
  } {
    const guards: LeaveGuard[] = [];
    const removeGuard = vi.fn();
    const beforeEach = vi.fn((guard: LeaveGuard) => {
      guards.push(guard);
      return removeGuard;
    });
    vi.stubGlobal("getApp", vi.fn(() => ({ $router: { beforeEach } })));
    return { guards, removeGuard, beforeEach };
  }

  it("未保存更改离开先确认：取消保留草稿；确认只放行，真正停用后才清草稿且零 PATCH", async () => {
    const { calls } = stubFetch();
    const router = stubH5Router();
    const confirmSpy = vi.fn(() => false);
    vi.stubGlobal("confirm", confirmSpy);
    const wrapper = mountPage();
    await flushPromises();
    expect(router.beforeEach).toHaveBeenCalledTimes(1);
    const getsBefore = relationshipGets(calls);

    await wrapper.get('[data-testid="pref-companion-name"]').setValue("阿澈");
    const guard = router.guards[0]!;
    const leaveToIndex = () =>
      guard({ path: "/pages/index/index" }, { path: "/pages/companion/companion" });

    // 继续编辑：守卫取消导航，字段与 dirty 原样保留。
    await expect(leaveToIndex()).resolves.toBe(false);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledWith(LEAVE_CONFIRM_MESSAGE);
    expect((wrapper.get('[data-testid="pref-companion-name"]').element as HTMLInputElement).value)
      .toBe("阿澈");
    expect(wrapper.get('[data-testid="companion-dirty"]').text()).toContain("未保存");

    // 放弃并离开：守卫只放行——放行不等于导航成功，字段此刻仍在页面上。
    confirmSpy.mockReturnValue(true);
    await expect(leaveToIndex()).resolves.toBe(true);
    expect((wrapper.get('[data-testid="pref-companion-name"]').element as HTMLInputElement).value)
      .toBe("阿澈");
    expect(wrapper.find('[data-testid="companion-dirty"]').exists()).toBe(true);

    // 真正离开（KeepAlive 停用）才清空草稿；再次激活按服务端重读回基线。
    const page = keepAliveHooksOf(wrapper);
    page.deactivate();
    await flushPromises();
    expect(wrapper.find('[data-testid="companion-form"]').exists()).toBe(false);
    page.activate();
    await flushPromises();
    expect((wrapper.get('[data-testid="pref-companion-name"]').element as HTMLInputElement).value)
      .toBe("林夏");
    expect(wrapper.find('[data-testid="companion-dirty"]').exists()).toBe(false);
    expect(relationshipGets(calls)).toBe(getsBefore + 1);
    // 丢弃后的草稿不再拦截后续离开。
    await expect(leaveToIndex()).resolves.toBe(true);
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    expect(calls.filter((call) => call.method === "PATCH")).toHaveLength(0);
    wrapper.unmount();
  });

  it("清洁状态、非本页来源、登录目标与换号清理后的离开不经确认直接放行", async () => {
    let switched = false;
    stubFetch({
      relationships: () => (switched ? [SWITCHED_RELATIONSHIP] : [ACTIVE_RELATIONSHIP]),
    });
    const router = stubH5Router();
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmSpy);
    const wrapper = mountPage();
    await flushPromises();
    const guard = router.guards[0]!;

    // 清洁状态不询问。
    await expect(
      guard({ path: "/pages/index/index" }, { path: "/pages/companion/companion" }),
    ).resolves.toBe(true);
    // 其它页面的导航不归本守卫管。
    await expect(
      guard({ path: "/pages/index/index" }, { path: "/pages/chat/chat" }),
    ).resolves.toBe(true);

    await wrapper.get('[data-testid="pref-companion-name"]').setValue("阿澈");
    // 同 path 目标不是离开本页，直接放行。
    await expect(
      guard({ path: "/pages/companion/companion" }, { path: "/pages/companion/companion" }),
    ).resolves.toBe(true);
    expect(confirmSpy).not.toHaveBeenCalled();
    // 认证链路目标（登录页）不被旧草稿阻住。
    await expect(
      guard({ path: "/pages/login/login" }, { path: "/pages/companion/companion" }),
    ).resolves.toBe(true);
    expect(confirmSpy).not.toHaveBeenCalled();

    // 换号清理清空旧账号草稿后，普通目标也直接放行。
    switched = true;
    await loginViaAuth();
    await flushPromises();
    await expect(
      guard({ path: "/pages/index/index" }, { path: "/pages/companion/companion" }),
    ).resolves.toBe(true);
    expect(confirmSpy).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("beforeunload 仅在本页活动且 dirty 时阻止；停用/卸载后守卫与监听一并移除", async () => {
    stubFetch();
    const router = stubH5Router();
    const wrapper = mountPage();
    await flushPromises();
    const dispatchBeforeUnload = () => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };

    expect(dispatchBeforeUnload(), "清洁状态不阻止刷新").toBe(false);

    await wrapper.get('[data-testid="pref-companion-name"]').setValue("阿澈");
    expect(dispatchBeforeUnload(), "dirty 时阻止刷新/关闭").toBe(true);

    // 隐藏（KeepAlive 停用）：路由守卫与 beforeunload 监听无残留。
    const page = keepAliveHooksOf(wrapper);
    page.deactivate();
    expect(router.removeGuard).toHaveBeenCalledTimes(1);
    expect(dispatchBeforeUnload()).toBe(false);

    // 重新激活按需重装；卸载后同样清理。
    router.beforeEach.mockClear();
    page.activate();
    expect(router.beforeEach).toHaveBeenCalledTimes(1);
    expect(dispatchBeforeUnload()).toBe(true);
    wrapper.unmount();
    expect(dispatchBeforeUnload()).toBe(false);
  });
});
