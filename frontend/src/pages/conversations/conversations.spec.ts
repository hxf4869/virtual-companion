// @vitest-environment happy-dom
// 全部会话页只验证找回并继续对话的真实路径；搜索和管理能力在完整产品
// 契约就绪前不得以局部实现混入此页。
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAuthenticatedTransport } from "@/api/transport";
import { useAuthStore } from "@/stores/auth";

import ConversationsPage from "./conversations.vue";

const RELATIONSHIPS = [
  {
    relationshipId: "rel-1",
    personaRef: "gentle-listener",
    companionName: "林夏",
    active: true,
    createdAt: "2026-08-18T00:00:00Z",
  },
];

function conversation(index: number, overrides: Record<string, unknown> = {}) {
  return {
    conversationId: `c${index}`,
    relationshipId: "rel-1",
    title: `第 ${index} 段对话`,
    lastMessagePreview: `这是第 ${index} 段对话的最后一句。`,
    createdAt: "2026-08-18T01:00:00Z",
    lastActivityAt: "2026-08-31T10:00:00Z",
    ...overrides,
  };
}

// VC-R11：B 账号（accountId=9）的私有陪伴与会话数据。标题刻意避开与 A 的
// 子串重叠，便于断言旧账号内容残留。
const RELATIONSHIPS_B = [
  {
    relationshipId: "rel-b",
    personaRef: "warm-storyteller",
    companionName: "沈之衡",
    active: true,
    createdAt: "2026-08-18T00:00:00Z",
  },
];

function conversationB(index: number) {
  return {
    conversationId: `bc${index}`,
    relationshipId: "rel-b",
    title: `B 的秘密对话 ${index}`,
    lastMessagePreview: `B 的秘密对话 ${index} 的最后一句。`,
    createdAt: "2026-08-18T01:00:00Z",
    lastActivityAt: "2026-08-31T10:00:00Z",
  };
}

interface FetchOptions {
  relationships?: unknown[];
  relationshipFails?: boolean | (() => boolean);
  conversationFails?: boolean | ((url: string) => boolean);
  conversations?: unknown[] | ((url: string) => unknown[]);
  /** VC-R11：换号成 B 后按登录账号返回的 B 私有数据。 */
  accountB?: { relationships?: unknown[]; conversations?: unknown[] };
  /** VC-R11 场景 b：只挂起第一次 conversations 请求，模拟旧账号读取跨切号在途。 */
  holdFirstConversationFetch?: Promise<void>;
  /** VC-R11：登录接口返回的 accountId。默认换号 B=9；同账号重认证传 7。 */
  loginAccountId?: string;
}

function resolveBool(value: boolean | (() => boolean) | undefined): boolean {
  return typeof value === "function" ? value() : value ?? false;
}

function response(ok: boolean, status: number, json: unknown) {
  return {
    ok,
    status,
    json: async () => json,
    headers: { get: () => null },
  };
}

function stubFetch(options: FetchOptions = {}) {
  const calls: string[] = [];
  let heldConversationFetch = false;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString();
    calls.push(url);
    // VC-R11：真实登录走 POST /api/v1/auth/login，直接返回 ACTIVE 身份；
    // accountId 可配制成同 ID 重认证或换号 B。
    if (init?.method === "POST" && url === "/api/v1/auth/login") {
      return response(true, 200, {
        nextStep: "ACTIVE",
        accountId: options.loginAccountId ?? "9",
        role: "USER",
        sessionId: "9",
        passwordMustChange: false,
        authenticatorEnabled: true,
        expiresInSeconds: 7200,
      });
    }
    // VC-R11：按请求发起时的登录账号区分 A/B 私有数据。
    const accountB = options.accountB !== undefined && useAuthStore().accountId === "9"
      ? options.accountB
      : null;
    if (url === "/api/v1/relationships") {
      if (accountB) {
        return response(true, 200, accountB.relationships ?? []);
      }
      if (resolveBool(options.relationshipFails)) {
        return response(false, 500, { code: "INTERNAL_ERROR" });
      }
      return response(true, 200, options.relationships ?? RELATIONSHIPS);
    }
    if (url.startsWith("/api/v1/conversations")) {
      const fails = typeof options.conversationFails === "function"
        ? options.conversationFails(url)
        : options.conversationFails ?? false;
      if (fails) throw new TypeError("offline");
      const rows = accountB
        ? accountB.conversations ?? []
        : typeof options.conversations === "function"
          ? options.conversations(url)
          : options.conversations ?? [conversation(1), conversation(2)];
      if (options.holdFirstConversationFetch && !heldConversationFetch) {
        heldConversationFetch = true;
        await options.holdFirstConversationFetch;
      }
      return response(true, 200, rows);
    }
    return response(true, 200, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

function login(): void {
  const auth = useAuthStore();
  auth.accessToken = "session";
  auth.accountId = "7";
  auth.role = "USER";
}

/** VC-R11：模拟 uni H5 KeepAlive 停用（本实例转入隐藏缓存页）。 */
function deactivatePage(wrapper: ReturnType<typeof mountPage>): void {
  const internal = wrapper.vm.$ as unknown as { da?: Array<() => void> };
  internal.da?.forEach((hook) => hook());
}

/** VC-R11：模拟 KeepAlive 缓存页重新激活（浏览器返回本页）。 */
function activatePage(wrapper: ReturnType<typeof mountPage>): void {
  const internal = wrapper.vm.$ as unknown as { a?: Array<() => void> };
  internal.a?.forEach((hook) => hook());
}

/** VC-R11：在别的页面真实登录 B（POST /api/v1/auth/login），完成 A→B 换号。 */
async function switchToAccountB(): Promise<void> {
  const auth = useAuthStore();
  const transport = createAuthenticatedTransport({
    getAccessToken: () => auth.accessToken,
    getSessionRevision: () => auth.getSessionRevision(),
    getSessionId: () => null,
    onUnauthorized: () => auth.onUnauthorized(),
  });
  await auth.login(transport, "b@example.com", "pw-b");
}

/** VC-R11：同账号重认证——真实 login 但 accountId 不变，persist 仍推进代次。 */
async function reloginSameAccount(): Promise<void> {
  const auth = useAuthStore();
  const transport = createAuthenticatedTransport({
    getAccessToken: () => auth.accessToken,
    getSessionRevision: () => auth.getSessionRevision(),
    getSessionId: () => null,
    onUnauthorized: () => auth.onUnauthorized(),
  });
  await auth.login(transport, "a@example.com", "pw-a");
}

function mountPage() {
  return mount(ConversationsPage, { attachTo: document.body });
}

function navigateTo(): ReturnType<typeof vi.fn> {
  return (globalThis as unknown as { uni: { navigateTo: ReturnType<typeof vi.fn> } }).uni.navigateTo;
}

describe("全部会话", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    setActivePinia(createPinia());
    vi.stubGlobal("uni", {
      navigateTo: vi.fn(),
      navigateBack: vi.fn(),
      redirectTo: vi.fn(),
    });
    vi.stubGlobal("location", { search: "", hash: "", href: "" });
    login();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("数据未返回前显示真实加载态", async () => {
    stubFetch();
    const wrapper = mountPage();

    expect(wrapper.find('[data-testid="conversations-loading"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="conversations-empty"]').exists()).toBe(false);
    await flushPromises();
    wrapper.unmount();
  });

  it("按当前陪伴加载最近活动列表，并保持二级页骨架", async () => {
    const { calls } = stubFetch();
    const wrapper = mountPage();
    await flushPromises();

    expect(calls).toContain("/api/v1/conversations?relationshipId=rel-1&limit=20");
    expect(wrapper.findAll('[data-testid="session-preview"]')).toHaveLength(2);
    expect(wrapper.text()).toContain("第 1 段对话");
    expect(wrapper.text()).toContain("这是第 2 段对话的最后一句。");
    expect(wrapper.find('[data-testid="page-back"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="consumer-tabbar"]').exists()).toBe(false);

    expect(wrapper.find('[data-testid="conversation-filter"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid^="conversation-manage-"]').exists()).toBe(false);
    expect(wrapper.text()).not.toMatch(/会话数据管理|删除全部会话|模型|Token|路由状态/);
    wrapper.unmount();
  });

  it("合法深链关系优先于默认关系", async () => {
    vi.stubGlobal("location", {
      search: "?relationshipId=rel-2",
      hash: "",
      href: "",
    });
    const { calls } = stubFetch({
      relationships: [
        ...RELATIONSHIPS,
        { ...RELATIONSHIPS[0], relationshipId: "rel-2", active: false },
      ],
    });
    const wrapper = mountPage();
    await flushPromises();

    expect(calls).toContain("/api/v1/conversations?relationshipId=rel-2&limit=20");
    wrapper.unmount();
  });

  it("点击列表行进入对应的真实会话", async () => {
    stubFetch();
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.findAll('[data-testid="session-preview"]')[1].trigger("click");
    expect(navigateTo()).toHaveBeenCalledWith({
      url: "/pages/chat/chat?relationshipId=rel-1&conversationId=c2",
    });
    wrapper.unmount();
  });

  it("成功空列表只提供开始第一次对话", async () => {
    stubFetch({ conversations: [] });
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[data-testid="conversations-empty"]').text()).toContain("还没有对话");
    expect(wrapper.find('[data-testid="conversations-start-chat"]').text()).toBe("开始第一次对话");
    await wrapper.find('[data-testid="conversations-start-chat"]').trigger("click");
    expect(navigateTo()).toHaveBeenCalledWith({
      url: "/pages/chat/chat?relationshipId=rel-1",
    });
    wrapper.unmount();
  });

  it("缺少默认陪伴时说明未准备好，不恢复旧创建选择器", async () => {
    stubFetch({ relationships: [] });
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[data-testid="conversations-load-failed"]').text()).toContain("你的陪伴还没准备好");
    expect(wrapper.find('[data-testid="relationship-select"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("创建陪伴");
    wrapper.unmount();
  });

  it("首屏失败后通过同一个动作恢复", async () => {
    let fails = true;
    const { calls } = stubFetch({ conversationFails: () => fails });
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[data-testid="conversations-load-failed"]').text()).toContain("会话没有加载出来");
    fails = false;
    await wrapper.find('[data-testid="conversations-retry"]').trigger("click");
    await flushPromises();

    expect(wrapper.findAll('[data-testid="session-preview"]')).toHaveLength(2);
    expect(calls.filter((url) => url.includes("/api/v1/conversations?"))).toHaveLength(2);
    wrapper.unmount();
  });

  it("使用最后一项作为游标加载下一页", async () => {
    const firstPage = Array.from({ length: 20 }, (_, index) => conversation(index + 1));
    const { calls } = stubFetch({
      conversations: (url) => url.includes("after=c20") ? [conversation(21)] : firstPage,
    });
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[data-testid="conversations-load-more"]').text()).toBe("加载更多");
    await wrapper.find('[data-testid="conversations-load-more"]').trigger("click");
    await flushPromises();

    expect(calls).toContain(
      "/api/v1/conversations?relationshipId=rel-1&after=c20&limit=20",
    );
    expect(wrapper.findAll('[data-testid="session-preview"]')).toHaveLength(21);
    expect(wrapper.find('[data-testid="conversations-load-more"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("加载更多失败保留现有列表并允许重试", async () => {
    let moreFails = true;
    const firstPage = Array.from({ length: 20 }, (_, index) => conversation(index + 1));
    stubFetch({
      conversationFails: (url) => url.includes("after=c20") && moreFails,
      conversations: (url) => url.includes("after=c20") ? [conversation(21)] : firstPage,
    });
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.find('[data-testid="conversations-load-more"]').trigger("click");
    await flushPromises();
    expect(wrapper.findAll('[data-testid="session-preview"]')).toHaveLength(20);
    expect(wrapper.find('[data-testid="conversations-load-more"]').text()).toBe("重新加载更多");

    moreFails = false;
    await wrapper.find('[data-testid="conversations-load-more"]').trigger("click");
    await flushPromises();
    expect(wrapper.findAll('[data-testid="session-preview"]')).toHaveLength(21);
    wrapper.unmount();
  });

  it("不可读密文不会出现在用户界面", async () => {
    const opaque = `enc2:${"A".repeat(120)}`;
    stubFetch({
      conversations: [conversation(1, { title: opaque, lastMessagePreview: opaque })],
    });
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.text()).toContain("一段对话");
    expect(wrapper.text()).not.toContain("enc2:");
    expect(wrapper.text()).not.toContain(opaque);
    wrapper.unmount();
  });

  it("VC-R11：换号后隐藏的缓存页清空旧账号会话，重新激活才加载新账号列表", async () => {
    const { calls } = stubFetch({
      accountB: {
        relationships: RELATIONSHIPS_B,
        conversations: [conversationB(1), conversationB(2)],
      },
    });
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.findAll('[data-testid="session-preview"]')).toHaveLength(2);
    expect(wrapper.text()).toContain("第 1 段对话");

    // 隐藏缓存页期间，另一页面真实登录 B（A→B 直接 persist，不经过 null）。
    deactivatePage(wrapper);
    const conversationsBefore = calls.filter((url) => url.includes("/api/v1/conversations?")).length;
    await switchToAccountB();
    await flushPromises();

    // 隐藏期间不得抢跑新请求，旧账号私有列表必须已清空（回到加载态）。
    expect(calls.filter((url) => url.includes("/api/v1/conversations?"))).toHaveLength(conversationsBefore);
    expect(wrapper.find('[data-testid="conversations-loading"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain("第 1 段对话");

    activatePage(wrapper);
    await flushPromises();

    expect(wrapper.findAll('[data-testid="session-preview"]')).toHaveLength(2);
    expect(wrapper.text()).toContain("B 的秘密对话 1");
    expect(wrapper.text()).not.toContain("第 1 段对话");
    wrapper.unmount();
  });

  it("VC-R11：切号前在途的旧账号读取迟到成功，不回填新账号的页面状态", async () => {
    let releaseStaleRead!: () => void;
    const staleGate = new Promise<void>((resolve) => {
      releaseStaleRead = resolve;
    });
    stubFetch({
      holdFirstConversationFetch: staleGate,
      accountB: {
        relationships: RELATIONSHIPS_B,
        conversations: Array.from({ length: 20 }, (_, index) => conversationB(index + 1)),
      },
    });
    const wrapper = mountPage();
    await flushPromises();
    // A 的首屏读取被挂起，跨过切号仍在途。
    expect(wrapper.find('[data-testid="conversations-loading"]').exists()).toBe(true);

    deactivatePage(wrapper);
    await switchToAccountB();
    await flushPromises();

    activatePage(wrapper);
    await flushPromises();
    // B 加载完成：列表就绪且 busy 已复位（加载更多未被禁用）。
    expect(wrapper.findAll('[data-testid="session-preview"]')).toHaveLength(20);
    expect(wrapper.find('[data-testid="conversations-load-more"]').attributes("disabled")).toBeUndefined();

    // 释放 A 的迟到 200：旧账号条目与状态都不得写回。
    releaseStaleRead();
    await flushPromises();

    expect(wrapper.text()).not.toContain("第 1 段对话");
    expect(wrapper.findAll('[data-testid="session-preview"]')).toHaveLength(20);
    expect(wrapper.find('[data-testid="conversations-load-more"]').attributes("disabled")).toBeUndefined();
    wrapper.unmount();
  });

  it("VC-R11：同账号重认证不挂死在途加载，激活后正常收尾", async () => {
    let releaseRead!: () => void;
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    const { calls } = stubFetch({
      holdFirstConversationFetch: readGate,
      conversations: Array.from({ length: 20 }, (_, index) => conversation(index + 1)),
      loginAccountId: "7",
    });
    const wrapper = mountPage();
    await flushPromises();
    // 首屏读取在途，将跨过同账号重认证。
    expect(wrapper.find('[data-testid="conversations-loading"]').exists()).toBe(true);

    // 隐藏期间另一页面同 ID 重新登录：accountId 不变（无身份清理），但
    // AuthStore 代次仍被 persist 推进——不得据此判在途请求过期。
    deactivatePage(wrapper);
    await reloginSameAccount();
    await flushPromises();

    activatePage(wrapper);
    await flushPromises();
    // 在途加载仍持有 busy：激活不得重复发请求。
    expect(calls.filter((url) => url.includes("/api/v1/conversations?"))).toHaveLength(1);

    releaseRead();
    await flushPromises();

    // 同账号的读取照常落地收尾：列表显示且 busy 复位（加载更多未禁用），
    // 不得被错误门控成永久 busy 而挂死页面。
    expect(wrapper.findAll('[data-testid="session-preview"]')).toHaveLength(20);
    expect(wrapper.find('[data-testid="conversations-load-more"]').attributes("disabled")).toBeUndefined();
    wrapper.unmount();
  });

  it("同账号返回缓存页时刷新聊天期间新增的会话", async () => {
    let rows = [conversation(1), conversation(2)];
    const { calls } = stubFetch({ conversations: () => rows });
    const wrapper = mountPage();
    await flushPromises();
    expect(calls.filter((url) => url.includes("/api/v1/conversations?"))).toHaveLength(1);

    deactivatePage(wrapper);
    rows = [conversation(3), ...rows];
    activatePage(wrapper);
    await flushPromises();

    expect(calls.filter((url) => url.includes("/api/v1/conversations?"))).toHaveLength(2);
    expect(wrapper.findAll('[data-testid="session-preview"]')).toHaveLength(3);
    expect(wrapper.findAll('[data-testid="session-preview"]')[0].text()).toContain("第 3 段对话");
    wrapper.unmount();
  });
});
