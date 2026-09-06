// @vitest-environment happy-dom
// 陪伴设置页：偏好加载、字段往返与保存状态机（基线始终来自服务端回读）。
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

interface Gate {
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
}

interface FetchOptions {
  relationships?: unknown[];
  relationshipStatus?: number;
  patchStatus?: number;
  patchJson?: unknown;
  patchParseFailed?: boolean;
  patchBodyRef?: { body?: Record<string, unknown> };
  /** 提供时，PATCH 请求挂起直到手动 resolve（用于在途保存场景）。 */
  patchGate?: Gate;
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
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, url, body: typeof init?.body === "string" ? init.body : undefined });

    if (url === "/api/v1/relationships" && method === "GET") {
      const status = options.relationshipStatus ?? 200;
      return response(status, status === 200 ? (options.relationships ?? [ACTIVE_RELATIONSHIP]) : null);
    }
    if (url === "/api/v1/relationships/42" && method === "PATCH") {
    if (options.patchBodyRef) {
      options.patchBodyRef.body = JSON.parse(
        typeof init?.body === "string" ? init.body : "{}",
      ) as Record<string, unknown>;
    }
      if (options.patchGate) return options.patchGate.promise as never;
      const status = options.patchStatus ?? 200;
      if (status !== 200) return response(status, { code: "INVALID_REQUEST" });
      return response(200, options.patchJson ?? ACTIVE_RELATIONSHIP, options.patchParseFailed);
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
});
