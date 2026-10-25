// @vitest-environment happy-dom
// 首页只负责一件事：让用户回到最近一次真实对话。这里固定公开态、恢复态、
// 有/无历史、加载失败和三入口底栏，防止旧准入步骤或专业术语重新进入首页。
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAuthenticatedTransport } from "@/api/transport";
import { useAuthStore } from "@/stores/auth";
import { useRelationshipStore } from "@/stores/relationship";

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

// VC-R11：换号后的 B 账号数据形状——陪伴与会话都和 A 完全不同，便于断言不串号。
const SWITCHED_RELATIONSHIP = {
  relationshipId: "rel-index-2",
  personaRef: "steady-planner",
  companionName: "沈屿",
  active: true,
  createdAt: "2026-09-01T00:00:00Z",
};

const SWITCHED_CONVERSATIONS = [
  {
    conversationId: "conv-b-1",
    relationshipId: "rel-index-2",
    title: "换号后的第一次对话",
    lastMessagePreview: "这是 B 账号自己的最近一条。",
    createdAt: "2026-09-02T08:00:00Z",
    lastActivityAt: "2026-09-02T09:00:00Z",
  },
];

// VC-R216：GET /auth/session 读回的 Cookie 身份。A=7 为既有默认；B=9 与 login
// mock 的换号 accountId 一致，配合 SWITCHED_* 数据断言不串号。
const SESSION_IDENTITY_A: Record<string, unknown> = {
  nextStep: "ACTIVE",
  accountId: "7",
  role: "USER",
  sessionId: "9",
  passwordMustChange: false,
  authenticatorEnabled: true,
  expiresInSeconds: 7200,
};

const SESSION_IDENTITY_B: Record<string, unknown> = {
  ...SESSION_IDENTITY_A,
  accountId: "9",
  sessionId: "19",
};

interface FetchOptions {
  session?: "anonymous" | "active" | "network-error" | (() => "anonymous" | "active" | "network-error");
  /** VC-R216：session 为 active 时读回的身份，默认 A；reconcile 身份发现用。 */
  sessionIdentity?: Record<string, unknown> | (() => Record<string, unknown>);
  relationships?: unknown[] | (() => unknown[]);
  relationshipFails?: boolean | (() => boolean);
  /** VC-R216：relationships 返回精确 409 + ACCOUNT_CONTEXT_CHANGED（本页旧期望身份已与共享 Cookie 失配）。 */
  relationshipAccountContextChanged?: boolean | (() => boolean);
  conversations?: unknown[] | (() => unknown[]);
  conversationFails?: boolean | (() => boolean);
  /** VC-R11：conversations 响应返回前的闸门（数据先快照再等待），用于制造旧账号在途请求。 */
  beforeConversations?: () => Promise<void>;
  /** VC-R202：relationships 响应返回前的闸门，用于制造返回刷新的在途等待。 */
  beforeRelationships?: () => Promise<void>;
  /** VC-R11：POST /api/v1/auth/login 返回的 accountId（默认换号到 "9"，可设同 ID 重登录）。 */
  loginAccountId?: string;
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
      return response(true, 200, resolveOption(options.sessionIdentity, SESSION_IDENTITY_A));
    }
    if (url === "/api/v1/relationships") {
      if (options.beforeRelationships) await options.beforeRelationships();
      if (resolveOption(options.relationshipAccountContextChanged, false)) {
        return response(false, 409, { code: "ACCOUNT_CONTEXT_CHANGED" });
      }
      if (resolveOption(options.relationshipFails, false)) {
        return response(false, 500, { code: "INTERNAL_ERROR" });
      }
      return response(
        true,
        200,
        resolveOption(options.relationships, [ACTIVE_RELATIONSHIP]),
      );
    }
    if (url === "/api/v1/auth/login") {
      // VC-R11：真实换号/重登录动作——mock 直接完成登录并推进会话代次。
      return response(true, 200, {
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
    if (url.startsWith("/api/v1/conversations")) {
      if (resolveOption(options.conversationFails, false)) {
        throw new TypeError("offline");
      }
      const rows = resolveOption(options.conversations, RECENT_CONVERSATIONS);
      if (options.beforeConversations) await options.beforeConversations();
      return response(true, 200, rows);
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

  it("同账号从聊天返回缓存首页时更新最近会话和继续目标", async () => {
    let rows = RECENT_CONVERSATIONS;
    const fetchMock = stubFetch({ conversations: () => rows });
    login();
    const wrapper = mountPage();
    await flushPromises();
    const internal = wrapper.vm.$ as unknown as { a?: Array<() => void>; da?: Array<() => void> };
    internal.da?.forEach((hook) => hook());
    rows = [{ ...RECENT_CONVERSATIONS[0], conversationId: "new-conversation",
      title: "刚刚的新对话", lastMessagePreview: "最新的合成回复" }];
    internal.a?.forEach((hook) => hook());
    await flushPromises();
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/conversations?"))).toHaveLength(2);
    expect(wrapper.text()).toContain("最新的合成回复");
    await wrapper.get('[data-testid="home-continue-chat"]').trigger("click");
    expect(navigateTo()).toHaveBeenCalledWith(expect.objectContaining({
      url: expect.stringContaining("conversationId=new-conversation"),
    }));
    wrapper.unmount();
  });

  it("返回刷新等待与关系读取失败时保留内容与继续入口，缓存关系仍可导航", async () => {
    let releaseHeldRefresh: () => void = () => {};
    const heldRefresh = new Promise<void>((resolve) => {
      releaseHeldRefresh = resolve;
    });
    let holdRelationships = false;
    let relationshipFails = false;
    stubFetch({
      relationshipFails: () => relationshipFails,
      beforeRelationships: () => (holdRelationships ? heldRefresh : Promise.resolve()),
    });
    login();
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.findAll('[data-testid="session-preview"]')).toHaveLength(3);

    // 模拟返回首页：刷新在途（relationships 挂起）。
    const internal = wrapper.vm.$ as unknown as {
      a?: Array<() => void>;
      da?: Array<() => void>;
    };
    internal.da?.forEach((hook) => hook());
    holdRelationships = true;
    relationshipFails = true;
    internal.a?.forEach((hook) => hook());
    await flushPromises();

    // 等待期间：上次内容仍在且可操作，不出现整页骨架或错误。
    expect(wrapper.find('[data-testid="home-loading"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="home-load-error"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="home-continue-chat"]').exists()).toBe(true);
    expect(wrapper.findAll('[data-testid="session-preview"]')).toHaveLength(3);
    expect(wrapper.find('[data-testid="tab-home"]').exists()).toBe(true);

    releaseHeldRefresh();
    await flushPromises();

    // 关系读取失败清空了全局 store：缓存内容保留，只挂内嵌失败反馈与重试。
    expect(wrapper.find('[data-testid="home-load-error"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="home-loading"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="home-refresh-notice"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="current-relationship"]').text()).toBe("林夏");
    expect(wrapper.findAll('[data-testid="session-preview"]')).toHaveLength(3);

    // 缓存页按上次已验证且本账号拥有的关系构建聊天与全部会话链接。
    await wrapper.findAll('[data-testid="session-preview"]')[2].trigger("click");
    expect(navigateTo()).toHaveBeenLastCalledWith({
      url: "/pages/chat/chat?relationshipId=rel-index-1&conversationId=conv-1",
    });
    await wrapper.get('[data-testid="home-view-all"]').trigger("click");
    expect(navigateTo()).toHaveBeenLastCalledWith({
      url: "/pages/conversations/conversations?relationshipId=rel-index-1",
    });

    holdRelationships = false;
    relationshipFails = false;
    await wrapper.get('[data-testid="home-refresh-retry"]').trigger("click");
    await flushPromises();
    // VC-R203：手动重试成功不再卸载反馈区——同一节点切到“已更新”，
    // 同一按钮变为“再次刷新”，键盘焦点不必重找。
    expect(wrapper.find('[data-testid="home-refresh-notice"]').attributes("data-state")).toBe("success");
    expect(wrapper.get('[data-testid="home-refresh-retry"]').text()).toBe("再次刷新");
    expect(wrapper.findAll('[data-testid="session-preview"]')).toHaveLength(3);
    wrapper.unmount();
  });

  it("返回刷新最近对话失败时保留内容并内嵌提示，重试后更新最新内容", async () => {
    let rows = RECENT_CONVERSATIONS;
    let conversationFails = false;
    stubFetch({ conversations: () => rows, conversationFails: () => conversationFails });
    login();
    const wrapper = mountPage();
    await flushPromises();

    const internal = wrapper.vm.$ as unknown as {
      a?: Array<() => void>;
      da?: Array<() => void>;
    };
    internal.da?.forEach((hook) => hook());
    conversationFails = true;
    rows = [{
      ...RECENT_CONVERSATIONS[0],
      conversationId: "conv-new",
      title: "刷新后的新对话",
      lastMessagePreview: "刷新成功后的合成回复",
    }];
    internal.a?.forEach((hook) => hook());
    await flushPromises();

    expect(wrapper.find('[data-testid="home-load-error"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="home-refresh-notice"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="current-relationship"]').text()).toBe("林夏");
    expect(wrapper.find('[data-testid="home-continue-chat"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("昨晚的那件小事");

    conversationFails = false;
    await wrapper.get('[data-testid="home-refresh-retry"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="home-refresh-notice"]').attributes("data-state")).toBe("success");
    expect(wrapper.text()).toContain("刷新成功后的合成回复");
    await wrapper.get('[data-testid="home-continue-chat"]').trigger("click");
    expect(navigateTo()).toHaveBeenLastCalledWith(expect.objectContaining({
      url: expect.stringContaining("conversationId=conv-new"),
    }));
    wrapper.unmount();
  });

  it("手动重试等待期间保留同一按钮与内容，不重复请求，响应不抢焦点", async () => {
    let releaseHeldRefresh: () => void = () => {};
    let heldRefresh = Promise.resolve();
    const holdNextRefresh = () => {
      heldRefresh = new Promise<void>((resolve) => {
        releaseHeldRefresh = resolve;
      });
    };
    let relationshipFails = false;
    const fetchMock = stubFetch({
      relationshipFails: () => relationshipFails,
      beforeRelationships: () => heldRefresh,
    });
    login();
    const wrapper = mountPage();
    await flushPromises();

    // 返回自动刷新失败：先进入 R202 的内嵌失败反馈。
    const internal = wrapper.vm.$ as unknown as {
      a?: Array<() => void>;
      da?: Array<() => void>;
    };
    internal.da?.forEach((hook) => hook());
    relationshipFails = true;
    internal.a?.forEach((hook) => hook());
    await flushPromises();
    expect(wrapper.find('[data-testid="home-refresh-notice"]').attributes("data-state")).toBe("failed");

    // 手动重试：关系读取挂起在途，等待期间反馈与按钮都还在原地。
    holdNextRefresh();
    relationshipFails = false;
    const retryElement = wrapper.get('[data-testid="home-refresh-retry"]').element;
    const relationshipsCalls = () => fetchMock.mock.calls.filter(
      ([url]) => String(url) === "/api/v1/relationships",
    ).length;
    const callsBeforeRetry = relationshipsCalls();

    await wrapper.get('[data-testid="home-refresh-retry"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="home-refresh-notice"]').attributes("data-state")).toBe("pending");
    expect(wrapper.text()).toContain("正在刷新");
    expect(wrapper.get('[data-testid="home-refresh-retry"]').attributes("aria-disabled")).toBe("true");
    expect(wrapper.get('[data-testid="home-refresh-retry"]').element).toBe(retryElement);
    expect(wrapper.findAll('[data-testid="session-preview"]')).toHaveLength(3);
    expect(wrapper.find('[data-testid="home-continue-chat"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="tab-home"]').exists()).toBe(true);

    // 等待期间重复点击不得重复发起请求。
    await wrapper.get('[data-testid="home-refresh-retry"]').trigger("click");
    await flushPromises();
    expect(relationshipsCalls()).toBe(callsBeforeRetry + 1);

    // 键盘已从重试按钮移到主操作：响应落地不得把焦点抢走。
    const mainAction = wrapper.get<HTMLButtonElement>('[data-testid="home-continue-chat"]').element;
    mainAction.focus();
    expect(document.activeElement).toBe(mainAction);
    releaseHeldRefresh();
    await flushPromises();

    expect(wrapper.find('[data-testid="home-refresh-notice"]').attributes("data-state")).toBe("success");
    expect(wrapper.text()).toContain("已更新");
    expect(wrapper.get('[data-testid="home-refresh-retry"]').text()).toBe("再次刷新");
    expect(wrapper.get('[data-testid="home-refresh-retry"]').element).toBe(retryElement);
    expect(document.activeElement).toBe(mainAction);

    // 同一按钮的“再次刷新”仍是同一个读取操作。
    holdNextRefresh();
    const callsAfterSuccess = relationshipsCalls();
    await wrapper.get('[data-testid="home-refresh-retry"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="home-refresh-notice"]').attributes("data-state")).toBe("pending");
    expect(relationshipsCalls()).toBe(callsAfterSuccess + 1);
    releaseHeldRefresh();
    await flushPromises();
    expect(wrapper.find('[data-testid="home-refresh-notice"]').attributes("data-state")).toBe("success");
    wrapper.unmount();
  });

  it("手动重试再次失败仍保留同一按钮与内容，可继续重试", async () => {
    let relationshipFails = false;
    stubFetch({ relationshipFails: () => relationshipFails });
    login();
    const wrapper = mountPage();
    await flushPromises();

    const internal = wrapper.vm.$ as unknown as {
      a?: Array<() => void>;
      da?: Array<() => void>;
    };
    internal.da?.forEach((hook) => hook());
    relationshipFails = true;
    internal.a?.forEach((hook) => hook());
    await flushPromises();

    const notice = wrapper.find('[data-testid="home-refresh-notice"]');
    expect(notice.attributes("data-state")).toBe("failed");
    expect(notice.text()).toContain("刚才没有刷新成功");
    expect(notice.text()).toContain("显示的是上次加载的内容。");
    const retryElement = wrapper.get('[data-testid="home-refresh-retry"]').element;

    await wrapper.get('[data-testid="home-refresh-retry"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="home-refresh-notice"]').attributes("data-state")).toBe("failed");
    expect(wrapper.get('[data-testid="home-refresh-retry"]').element).toBe(retryElement);
    expect(wrapper.get('[data-testid="home-refresh-retry"]').text()).toBe("重试");
    expect(wrapper.findAll('[data-testid="session-preview"]')).toHaveLength(3);

    relationshipFails = false;
    await wrapper.get('[data-testid="home-refresh-retry"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="home-refresh-notice"]').attributes("data-state")).toBe("success");
    wrapper.unmount();
  });

  it("空历史刷新失败时提示按上次加载的内容表述，开始入口保留", async () => {
    let conversationFails = false;
    stubFetch({ conversations: [], conversationFails: () => conversationFails });
    login();
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.get('[data-testid="home-start-chat"]').text()).toBe("开始第一次对话");

    const internal = wrapper.vm.$ as unknown as {
      a?: Array<() => void>;
      da?: Array<() => void>;
    };
    internal.da?.forEach((hook) => hook());
    conversationFails = true;
    internal.a?.forEach((hook) => hook());
    await flushPromises();

    const notice = wrapper.find('[data-testid="home-refresh-notice"]');
    expect(notice.attributes("data-state")).toBe("failed");
    expect(notice.text()).not.toContain("看到的还是上次的对话");
    expect(notice.text()).toContain("显示的是上次加载的内容。");
    expect(wrapper.get('[data-testid="home-start-chat"]').text()).toBe("开始第一次对话");
    expect(wrapper.text()).toContain("想说什么都可以，我们从这里开始。");

    conversationFails = false;
    await wrapper.get('[data-testid="home-refresh-retry"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="home-refresh-notice"]').attributes("data-state")).toBe("success");
    expect(wrapper.get('[data-testid="home-start-chat"]').text()).toBe("开始第一次对话");
    wrapper.unmount();
  });

  it("刷新确认默认陪伴变化后按新关系整页加载，不保留旧陪伴内容", async () => {
    let switched = false;
    stubFetch({
      relationships: () => (switched ? [SWITCHED_RELATIONSHIP] : [ACTIVE_RELATIONSHIP]),
      conversations: () => (switched ? SWITCHED_CONVERSATIONS : RECENT_CONVERSATIONS),
    });
    login();
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.find('[data-testid="current-relationship"]').text()).toBe("林夏");

    const internal = wrapper.vm.$ as unknown as {
      a?: Array<() => void>;
      da?: Array<() => void>;
    };
    internal.da?.forEach((hook) => hook());
    switched = true;
    internal.a?.forEach((hook) => hook());
    await flushPromises();

    expect(wrapper.find('[data-testid="current-relationship"]').text()).toBe("沈屿");
    expect(wrapper.findAll('[data-testid="session-preview"]')).toHaveLength(1);
    expect(wrapper.text()).toContain("这是 B 账号自己的最近一条。");
    expect(wrapper.text()).not.toContain("昨晚的那件小事");
    expect(wrapper.find('[data-testid="home-refresh-notice"]').exists()).toBe(false);
    await wrapper.get('[data-testid="home-continue-chat"]').trigger("click");
    expect(navigateTo()).toHaveBeenLastCalledWith({
      url: "/pages/chat/chat?relationshipId=rel-index-2&conversationId=conv-b-1",
    });
    wrapper.unmount();
  });

  it("刷新成功返回空列表时采纳真实空态，不用旧缓存盖掉", async () => {
    let rows: unknown[] = RECENT_CONVERSATIONS;
    stubFetch({ conversations: () => rows });
    login();
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.findAll('[data-testid="session-preview"]')).toHaveLength(3);

    const internal = wrapper.vm.$ as unknown as {
      a?: Array<() => void>;
      da?: Array<() => void>;
    };
    internal.da?.forEach((hook) => hook());
    rows = [];
    internal.a?.forEach((hook) => hook());
    await flushPromises();

    expect(wrapper.find('[data-testid="home-refresh-notice"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="home-load-error"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="home-start-chat"]').text()).toBe("开始第一次对话");
    expect(wrapper.text()).toContain("想说什么都可以，我们从这里开始。");
    expect(wrapper.find('[data-testid="home-recent-conversations"]').exists()).toBe(false);
    await wrapper.get('[data-testid="home-start-chat"]').trigger("click");
    expect(navigateTo()).toHaveBeenLastCalledWith({
      url: "/pages/chat/chat?relationshipId=rel-index-1",
    });
    wrapper.unmount();
  });

  it("换号清理本页缓存后，新账号首次关系读取失败仍走整页错误", async () => {
    let relationshipFails = false;
    stubFetch({ relationshipFails: () => relationshipFails });
    login();
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.findAll('[data-testid="session-preview"]')).toHaveLength(3);

    const internal = wrapper.vm.$ as unknown as {
      a?: Array<() => void>;
      da?: Array<() => void>;
    };
    internal.da?.forEach((hook) => hook());
    relationshipFails = true;
    const auth = useAuthStore();
    const transport = createAuthenticatedTransport({
      getAccessToken: () => auth.accessToken,
      getSessionRevision: () => auth.getSessionRevision(),
      getSessionId: () => null,
      onUnauthorized: () => auth.clear(),
    });
    await auth.login(transport, "b@example.com", "pw-b");
    await flushPromises();

    internal.a?.forEach((hook) => hook());
    await flushPromises();

    expect(wrapper.find('[data-testid="home-load-error"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="home-loading"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="home-refresh-notice"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("昨晚的那件小事");
    expect(wrapper.text()).not.toContain("林夏");
    wrapper.unmount();
  });

  it("其他页面确认默认关系变化后返回，等待自身读取期间不混合新陪伴与旧会话", async () => {
    let releaseHeldRelationships: () => void = () => {};
    const heldRelationships = new Promise<void>((resolve) => {
      releaseHeldRelationships = resolve;
    });
    let holdNextRelationships = false;
    let switched = false;
    stubFetch({
      relationships: () => (switched ? [SWITCHED_RELATIONSHIP] : [ACTIVE_RELATIONSHIP]),
      conversations: () => (switched ? SWITCHED_CONVERSATIONS : RECENT_CONVERSATIONS),
      beforeRelationships: () => {
        if (!holdNextRelationships) return Promise.resolve();
        holdNextRelationships = false;
        return heldRelationships;
      },
    });
    login();
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.find('[data-testid="current-relationship"]').text()).toBe("林夏");
    expect(wrapper.findAll('[data-testid="session-preview"]')).toHaveLength(3);

    // 模拟离开首页：会话列表页用同一全局 store 确认了新的默认陪伴。
    const internal = wrapper.vm.$ as unknown as {
      a?: Array<() => void>;
      da?: Array<() => void>;
    };
    internal.da?.forEach((hook) => hook());
    switched = true;
    const auth = useAuthStore();
    const transport = createAuthenticatedTransport({
      getAccessToken: () => auth.accessToken,
      getSessionRevision: () => auth.getSessionRevision(),
      getSessionId: () => null,
      onUnauthorized: () => auth.clear(),
    });
    await useRelationshipStore().load(transport);
    await flushPromises();

    // 返回首页：首页自己的关系读取被挂起，等待期间不得新名字配旧会话。
    holdNextRelationships = true;
    internal.a?.forEach((hook) => hook());
    await flushPromises();

    expect(wrapper.find('[data-testid="home-loading"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="current-relationship"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="home-continue-chat"]').exists()).toBe(false);
    expect(wrapper.findAll('[data-testid="session-preview"]')).toHaveLength(0);
    expect(wrapper.text()).not.toContain("昨晚的那件小事");
    expect(wrapper.text()).not.toContain("林夏");
    expect(wrapper.find('[data-testid="tab-home"]').exists()).toBe(true);

    releaseHeldRelationships();
    await flushPromises();
    expect(wrapper.find('[data-testid="current-relationship"]').text()).toBe("沈屿");
    expect(wrapper.findAll('[data-testid="session-preview"]')).toHaveLength(1);
    expect(wrapper.find('[data-testid="home-loading"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("旧刷新在途被外部确认新关系取代后，迟到的旧会话不回填新上下文", async () => {
    let releaseHeldConversations: () => void = () => {};
    const heldConversations = new Promise<void>((resolve) => {
      releaseHeldConversations = resolve;
    });
    let holdNextConversations = false;
    let switched = false;
    stubFetch({
      relationships: () => (switched ? [SWITCHED_RELATIONSHIP] : [ACTIVE_RELATIONSHIP]),
      conversations: () => (switched ? SWITCHED_CONVERSATIONS : RECENT_CONVERSATIONS),
      beforeConversations: () => {
        if (!holdNextConversations) return Promise.resolve();
        holdNextConversations = false;
        return heldConversations;
      },
    });
    login();
    const wrapper = mountPage();
    await flushPromises();

    // 返回首页触发刷新：关系读取（仍为 A）成功，A 的最近会话请求挂起在途。
    const internal = wrapper.vm.$ as unknown as {
      a?: Array<() => void>;
      da?: Array<() => void>;
    };
    internal.da?.forEach((hook) => hook());
    holdNextConversations = true;
    internal.a?.forEach((hook) => hook());
    await flushPromises();
    expect(wrapper.findAll('[data-testid="session-preview"]')).toHaveLength(3);

    // 再次离开：会话列表页确认新默认关系 B；返回时旧在途请求被取代。
    internal.da?.forEach((hook) => hook());
    switched = true;
    const auth = useAuthStore();
    const transport = createAuthenticatedTransport({
      getAccessToken: () => auth.accessToken,
      getSessionRevision: () => auth.getSessionRevision(),
      getSessionId: () => null,
      onUnauthorized: () => auth.clear(),
    });
    await useRelationshipStore().load(transport);
    await flushPromises();
    internal.a?.forEach((hook) => hook());
    await flushPromises();

    expect(wrapper.find('[data-testid="current-relationship"]').text()).toBe("沈屿");
    expect(wrapper.findAll('[data-testid="session-preview"]')).toHaveLength(1);
    expect(wrapper.find('[data-testid="home-loading"]').exists()).toBe(false);

    // 被取代的 A 请求迟到 200：不得回填旧会话或破坏 B 上下文。
    releaseHeldConversations();
    await flushPromises();
    expect(wrapper.text()).not.toContain("昨晚的那件小事");
    expect(wrapper.find('[data-testid="current-relationship"]').text()).toBe("沈屿");
    expect(wrapper.findAll('[data-testid="session-preview"]')).toHaveLength(1);
    expect(wrapper.find('[data-testid="home-load-error"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="home-loading"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("换号后返回缓存的首页不显示旧账号会话预览，激活后只加载新账号内容", async () => {
    let switched = false;
    const fetchMock = stubFetch({
      relationships: () => (switched ? [SWITCHED_RELATIONSHIP] : [ACTIVE_RELATIONSHIP]),
      conversations: () => (switched ? SWITCHED_CONVERSATIONS : RECENT_CONVERSATIONS),
    });
    login();
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.find('[data-testid="current-relationship"]').text()).toBe("林夏");
    expect(wrapper.findAll('[data-testid="session-preview"]')).toHaveLength(3);

    // 模拟 uni H5 KeepAlive 停用：浏览器离开首页，隐藏实例仍存活。
    const internal = wrapper.vm.$ as unknown as {
      a?: Array<() => void>;
      da?: Array<() => void>;
    };
    internal.da?.forEach((hook) => hook());

    // 隐藏期间在登录页真实登录 B；别的页面随后加载了 B 的陪伴关系。
    switched = true;
    const auth = useAuthStore();
    const transport = createAuthenticatedTransport({
      getAccessToken: () => auth.accessToken,
      getSessionRevision: () => auth.getSessionRevision(),
      getSessionId: () => null,
      onUnauthorized: () => auth.clear(),
    });
    const conversationsCalls = () => fetchMock.mock.calls.filter((call) =>
      call[0].toString().startsWith("/api/v1/conversations"),
    ).length;
    const callsBeforeSwitch = conversationsCalls();
    await expect(auth.login(transport, "b@example.com", "pw-b")).resolves.toBe("ACTIVE");
    await useRelationshipStore().load(transport);
    await flushPromises();
    expect(auth.accountId).toBe("9");

    // 隐藏的缓存页立即清空旧账号内容，且清理本身不发起新读取。
    expect(conversationsCalls()).toBe(callsBeforeSwitch);
    expect(wrapper.find('[data-testid="home-loading"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain("昨晚的那件小事");
    expect(wrapper.text()).not.toContain("林夏");

    // 重新激活（浏览器返回首页）：按新账号重新加载。
    internal.a?.forEach((hook) => hook());
    await flushPromises();

    expect(wrapper.find('[data-testid="current-relationship"]').text()).toBe("沈屿");
    expect(wrapper.findAll('[data-testid="session-preview"]')).toHaveLength(1);
    expect(wrapper.text()).toContain("上次我们聊到：这是 B 账号自己的最近一条。");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/conversations?relationshipId=rel-index-2&limit=3",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
    wrapper.unmount();
  });

  it("旧账号在途的最近对话迟到成功不得回填新账号首页", async () => {
    let releaseHeldConversations: () => void = () => {};
    const heldConversations = new Promise<void>((resolve) => {
      releaseHeldConversations = resolve;
    });
    let heldOnce = false;
    let switched = false;
    stubFetch({
      relationships: () => (switched ? [SWITCHED_RELATIONSHIP] : [ACTIVE_RELATIONSHIP]),
      conversations: () => (switched ? SWITCHED_CONVERSATIONS : RECENT_CONVERSATIONS),
      beforeConversations: () => {
        if (heldOnce) return Promise.resolve();
        heldOnce = true;
        return heldConversations;
      },
    });
    login();
    const wrapper = mountPage();
    await flushPromises();
    // A 的最近对话请求跨过切号仍挂起，页面停在加载反馈。
    expect(wrapper.find('[data-testid="home-loading"]').exists()).toBe(true);

    const internal = wrapper.vm.$ as unknown as {
      a?: Array<() => void>;
      da?: Array<() => void>;
    };
    internal.da?.forEach((hook) => hook());

    switched = true;
    const auth = useAuthStore();
    const transport = createAuthenticatedTransport({
      getAccessToken: () => auth.accessToken,
      getSessionRevision: () => auth.getSessionRevision(),
      getSessionId: () => null,
      onUnauthorized: () => auth.clear(),
    });
    await auth.login(transport, "b@example.com", "pw-b");
    await flushPromises();

    // 重新激活并完成 B 自己的加载；再补一次关系读取模拟前台聊天页就位。
    internal.a?.forEach((hook) => hook());
    await flushPromises();
    await useRelationshipStore().load(transport);
    await flushPromises();
    expect(wrapper.find('[data-testid="current-relationship"]').text()).toBe("沈屿");
    expect(wrapper.text()).toContain("这是 B 账号自己的最近一条。");
    expect(wrapper.find('[data-testid="home-loading"]').exists()).toBe(false);

    // A 的迟到 200 到达：旧账号内容不回填，B 的就绪状态不受损。
    releaseHeldConversations();
    await flushPromises();
    expect(wrapper.text()).not.toContain("昨晚的那件小事");
    expect(wrapper.find('[data-testid="current-relationship"]').text()).toBe("沈屿");
    expect(wrapper.find('[data-testid="home-load-error"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="home-loading"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("同账号重新登录不把在途加载永久挂住，迟到结果正常落地", async () => {
    let releaseHeldConversations: () => void = () => {};
    const heldConversations = new Promise<void>((resolve) => {
      releaseHeldConversations = resolve;
    });
    let heldOnce = false;
    stubFetch({
      loginAccountId: "7",
      beforeConversations: () => {
        if (heldOnce) return Promise.resolve();
        heldOnce = true;
        return heldConversations;
      },
    });
    login();
    const wrapper = mountPage();
    await flushPromises();
    // A 的最近对话请求在途，页面停在加载反馈。
    expect(wrapper.find('[data-testid="home-loading"]').exists()).toBe(true);

    const internal = wrapper.vm.$ as unknown as {
      a?: Array<() => void>;
      da?: Array<() => void>;
    };
    internal.da?.forEach((hook) => hook());

    // 隐藏期间同账号重新登录：accountId 保持 "7"，但 auth 会话代次已推进。
    const auth = useAuthStore();
    const transport = createAuthenticatedTransport({
      getAccessToken: () => auth.accessToken,
      getSessionRevision: () => auth.getSessionRevision(),
      getSessionId: () => null,
      onUnauthorized: () => auth.clear(),
    });
    await auth.login(transport, "a@example.com", "pw-a");
    await flushPromises();
    expect(auth.accountId).toBe("7");

    // 重新激活：原请求仍归属当前账号，不重复发起。
    internal.a?.forEach((hook) => hook());
    await flushPromises();

    // 释放被挂请求：同账号的合法结果必须正常落地并收尾，不得永久卡在加载。
    releaseHeldConversations();
    await flushPromises();
    expect(wrapper.find('[data-testid="home-loading"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="current-relationship"]').text()).toBe("林夏");
    expect(wrapper.findAll('[data-testid="session-preview"]')).toHaveLength(3);
    expect(wrapper.find('[data-testid="home-load-error"]').exists()).toBe(false);
    wrapper.unmount();
  });

  // VC-R216：R216-A 缺陷（Root 原生 H5 重现）：首页保持激活可见，A 的关系读取
  // 先失败进入“重新加载”；另一 Tab 共享 Cookie 换号后点重新加载 → GET
  // relationships 带旧期望身份撞 409 ACCOUNT_CONTEXT_CHANGED → transport 上报
  // → auth.reconcile 同步 clear（A→null：watch 清理）→ 真实异步 GET /auth/session
  // 发现当前 Cookie 身份（null→确定账号）。页面全程不再触发 onActivated，恢复
  // 前无人重载即永久停在“正在加载最近对话”骨架、没有任何重试入口。可见页须
  // 在 null→确定账号时恰好自动加载一次：身份发现恰一次、新身份的关系与最近
  // 对话各恰一次读取，用 B 自己的陪伴/关系 id/列表落地，且不继承手动重试的
  // 反馈区。同一可见流 reconcile 读回仍是 A（null→A）同样成立。
  it.each([
    {
      label: "换到 B",
      identity: SESSION_IDENTITY_B,
      accountId: "9",
      relationship: SWITCHED_RELATIONSHIP,
      conversations: SWITCHED_CONVERSATIONS,
      companion: "沈屿",
      preview: "这是 B 账号自己的最近一条。",
    },
    {
      label: "仍是 A",
      identity: SESSION_IDENTITY_A,
      accountId: "7",
      relationship: ACTIVE_RELATIONSHIP,
      conversations: RECENT_CONVERSATIONS,
      companion: "林夏",
      preview: "那我们就从你真正想说的地方开始。",
    },
  ])("可见页重新加载撞 409 换号：reconcile 发现$label 后自动按当前身份加载一次", async (row) => {
    let phase: "fail" | "conflict" | "discovered" = "fail";
    const fetchMock = stubFetch({
      session: "active",
      relationshipFails: () => phase === "fail",
      relationshipAccountContextChanged: () => phase === "conflict",
      // 身份发现那一刻起，本页读取按当前 Cookie 身份返回。
      sessionIdentity: () => {
        phase = "discovered";
        return row.identity;
      },
      relationships: () => (phase === "discovered" ? [row.relationship] : [ACTIVE_RELATIONSHIP]),
      conversations: () => (phase === "discovered" ? row.conversations : RECENT_CONVERSATIONS),
    });
    login();
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.find('[data-testid="home-load-error"]').text()).toContain("最近对话没有加载出来");

    // 另一 Tab 换号后点重新加载：本页旧期望身份撞 409，reconcile 发现当前身份。
    phase = "conflict";
    await wrapper.find('[data-testid="home-retry"]').trigger("click");
    await flushPromises();

    expect(useAuthStore().accountId).toBe(row.accountId);
    expect(wrapper.find('[data-testid="home-loading"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="home-load-error"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="home-refresh-notice"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="current-relationship"]').text()).toBe(row.companion);
    expect(wrapper.findAll('[data-testid="session-preview"]')).toHaveLength(row.conversations.length);
    expect(wrapper.text()).toContain(`上次我们聊到：${row.preview}`);
    const urls = fetchMock.mock.calls.map((call) => call[0].toString());
    expect(urls.filter((url) => url === "/api/v1/auth/session")).toHaveLength(1);
    // 关系读取：初载 500 + 重新加载 409 + 身份发现后恰一次；最近对话只按当前身份读一次。
    expect(urls.filter((url) => url === "/api/v1/relationships")).toHaveLength(3);
    expect(urls.filter((url) => url.startsWith("/api/v1/conversations"))).toEqual([
      `/api/v1/conversations?relationshipId=${row.relationship.relationshipId}&limit=3`,
    ]);
    wrapper.unmount();
  });
});
