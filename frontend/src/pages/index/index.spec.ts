// @vitest-environment happy-dom
// 首页只负责一件事：让用户回到最近一次真实对话。这里固定公开态、恢复态、
// 有/无历史、加载失败和三入口底栏，防止旧准入步骤或专业术语重新进入首页。
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAuthStore } from "@/stores/auth";

import IndexPage from "./index.vue";

const ACTIVE_RELATIONSHIP = {
  relationshipId: "rel-index-1",
  personaRef: "gentle-listener",
  companionName: "林夏",
  active: true,
  createdAt: "2026-08-15T00:00:00Z",
};

const RECENT_CONVERSATIONS = [
  {
    conversationId: "conv-3",
    relationshipId: "rel-index-1",
    title: "昨晚的那件小事",
    lastMessagePreview: "那我们就从你真正想说的地方开始。",
    createdAt: "2026-08-31T14:00:00Z",
    lastActivityAt: "2026-08-31T14:18:00Z",
  },
  {
    conversationId: "conv-2",
    relationshipId: "rel-index-1",
    title: "周末想去走走",
    lastMessagePreview: "不用马上决定，可以先想想喜欢怎样的节奏。",
    createdAt: "2026-08-29T08:00:00Z",
    lastActivityAt: "2026-08-29T08:42:00Z",
  },
  {
    conversationId: "conv-1",
    relationshipId: "rel-index-1",
    title: "第一次见面",
    lastMessagePreview: "很高兴认识你。",
    createdAt: "2026-08-26T10:00:00Z",
    lastActivityAt: "2026-08-26T10:20:00Z",
  },
];

interface FetchOptions {
  session?: "anonymous" | "active" | "network-error" | (() => "anonymous" | "active" | "network-error");
  relationships?: unknown[] | (() => unknown[]);
  relationshipFails?: boolean | (() => boolean);
  conversations?: unknown[] | (() => unknown[]);
  conversationFails?: boolean | (() => boolean);
}

function resolveOption<T>(value: T | (() => T) | undefined, fallback: T): T {
  if (typeof value === "function") return (value as () => T)();
  return value ?? fallback;
}

function response(ok: boolean, status: number, json: unknown) {
  return {
    ok,
    status,
    json: async () => json,
    headers: { get: () => null },
  };
}

function stubFetch(options: FetchOptions = {}): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = input.toString();
    if (url === "/api/v1/auth/session") {
      const state = resolveOption(options.session, "anonymous");
      if (state === "network-error") throw new TypeError("offline");
      if (state === "anonymous") {
        return response(false, 401, { code: "AUTHENTICATION_REQUIRED" });
      }
      return response(true, 200, {
        nextStep: "ACTIVE",
        accountId: "7",
        role: "USER",
        passwordMustChange: false,
        authenticatorEnabled: true,
        expiresInSeconds: 7200,
      });
    }
    if (url === "/api/v1/relationships") {
      if (resolveOption(options.relationshipFails, false)) {
        return response(false, 500, { code: "INTERNAL_ERROR" });
      }
      return response(
        true,
        200,
        resolveOption(options.relationships, [ACTIVE_RELATIONSHIP]),
      );
    }
    if (url.startsWith("/api/v1/conversations")) {
      if (resolveOption(options.conversationFails, false)) {
        throw new TypeError("offline");
      }
      return response(
        true,
        200,
        resolveOption(options.conversations, RECENT_CONVERSATIONS),
      );
    }
    return response(true, 200, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function mountPage() {
  return mount(IndexPage, { attachTo: document.body });
}

function login(): void {
  const auth = useAuthStore();
  auth.accessToken = "session";
  auth.accountId = "7";
  auth.role = "USER";
}

function navigateTo(): ReturnType<typeof vi.fn> {
  return (globalThis as unknown as { uni: { navigateTo: ReturnType<typeof vi.fn> } }).uni.navigateTo;
}

describe("首页产品骨架", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    setActivePinia(createPinia());
    vi.stubGlobal("uni", { navigateTo: vi.fn(), redirectTo: vi.fn() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("会话状态未确定时只显示加载反馈，不抢先显示登录或产品内容", () => {
    stubFetch();
    const wrapper = mountPage();

    expect(wrapper.find('[data-testid="home-pending"]').attributes("data-state")).toBe("loading");
    expect(wrapper.find('[data-testid="home-login"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="home-continue-chat"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("匿名访客看到清楚的登录入口，不显示受保护的底栏", async () => {
    stubFetch({ session: "anonymous" });
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[data-testid="home-login"]').text()).toBe("登录后继续");
    expect(wrapper.text()).toContain("AI 陪伴者 · 非真人");
    expect(wrapper.find('[data-testid="consumer-tabbar"]').exists()).toBe(false);

    await wrapper.find('[data-testid="home-login"]').trigger("click");
    expect(navigateTo()).toHaveBeenCalledWith({ url: "/pages/login/login" });
    wrapper.unmount();
  });

  it("会话恢复失败时提供单一重试，恢复后直接进入真实首页", async () => {
    let session: "network-error" | "active" = "network-error";
    stubFetch({ session: () => session });
    const wrapper = mountPage();
    await flushPromises();

    const pending = wrapper.find('[data-testid="home-pending"]');
    expect(pending.attributes("data-state")).toBe("error");
    expect(pending.attributes("role")).toBe("alert");
    expect(wrapper.find('[data-testid="session-retry"]').text()).toBe("重新加载");

    session = "active";
    await wrapper.find('[data-testid="session-retry"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="home-pending"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="home-continue-chat"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("把最近一次对话作为唯一主任务，并渲染三项紧凑底栏", async () => {
    stubFetch();
    login();
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[data-testid="current-relationship"]').text()).toBe("林夏");
    expect(wrapper.text()).toContain("上次我们聊到：那我们就从你真正想说的地方开始。");
    expect(wrapper.text()).toContain("AI 陪伴者 · 非真人");
    expect(wrapper.findAll('[data-testid="session-preview"]')).toHaveLength(3);

    const tabs = wrapper.findAll('[data-testid^="tab-"]');
    expect(tabs.map((tab) => tab.text())).toEqual(["首页", "聊天", "我的"]);
    expect(wrapper.find('[data-testid="tab-home"]').attributes("aria-current")).toBe("page");

    await wrapper.find('[data-testid="home-continue-chat"]').trigger("click");
    expect(navigateTo()).toHaveBeenCalledWith({
      url: "/pages/chat/chat?relationshipId=rel-index-1&conversationId=conv-3",
    });
    wrapper.unmount();
  });

  it("最近对话行和查看全部都保留明确的关系上下文", async () => {
    stubFetch();
    login();
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.findAll('[data-testid="session-preview"]')[1].trigger("click");
    expect(navigateTo()).toHaveBeenLastCalledWith({
      url: "/pages/chat/chat?relationshipId=rel-index-1&conversationId=conv-2",
    });

    await wrapper.find('[data-testid="home-view-all"]').trigger("click");
    expect(navigateTo()).toHaveBeenLastCalledWith({
      url: "/pages/conversations/conversations?relationshipId=rel-index-1",
    });
    wrapper.unmount();
  });

  it("没有历史时不造假数据，只提供开始第一次对话", async () => {
    stubFetch({ conversations: [] });
    login();
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[data-testid="home-start-chat"]').text()).toBe("开始第一次对话");
    expect(wrapper.text()).toContain("想说什么都可以，我们从这里开始。");
    expect(wrapper.find('[data-testid="home-recent-conversations"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="home-view-all"]').exists()).toBe(false);

    await wrapper.find('[data-testid="home-start-chat"]').trigger("click");
    expect(navigateTo()).toHaveBeenCalledWith({
      url: "/pages/chat/chat?relationshipId=rel-index-1",
    });
    wrapper.unmount();
  });

  it("关系列表失败后可在原位重试", async () => {
    let relationshipFails = true;
    stubFetch({ relationshipFails: () => relationshipFails });
    login();
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[data-testid="home-load-error"]').text()).toContain("最近对话没有加载出来");
    expect(wrapper.find('[data-testid="home-continue-chat"]').exists()).toBe(false);

    relationshipFails = false;
    await wrapper.find('[data-testid="home-retry"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="home-continue-chat"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("最近对话失败后可在原位重试", async () => {
    let conversationFails = true;
    stubFetch({ conversationFails: () => conversationFails });
    login();
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[data-testid="home-load-error"]').exists()).toBe(true);
    conversationFails = false;
    await wrapper.find('[data-testid="home-retry"]').trigger("click");
    await flushPromises();
    expect(wrapper.findAll('[data-testid="session-preview"]')).toHaveLength(3);
    wrapper.unmount();
  });

  it("异常缺少默认陪伴时只说明未准备好，不把创建或旧准入流程暴露给用户", async () => {
    stubFetch({ relationships: [] });
    login();
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[data-testid="home-load-error"]').text()).toContain("你的陪伴还没准备好");
    expect(wrapper.find('[data-testid="home-create-companion"]').exists()).toBe(false);
    expect(wrapper.text()).not.toMatch(/成年核验|同意管理|待确认记忆|内部管理|运行与合规/);
    wrapper.unmount();
  });

  it("首页只请求最多三条最近对话", async () => {
    const fetchMock = stubFetch();
    login();
    const wrapper = mountPage();
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/conversations?relationshipId=rel-index-1&limit=3",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
    wrapper.unmount();
  });
});
