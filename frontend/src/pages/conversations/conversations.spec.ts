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
  /** VC-R199：只挂起第二次 conversations 请求（返回缓存页的激活刷新）。 */
  holdSecondConversationFetch?: Promise<void>;
  /** VC-R206：只挂起第三次 conversations 请求（失败反馈条上的手动重试）。 */
  holdThirdConversationFetch?: Promise<void>;
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
  let conversationFetchCount = 0;
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
      // VC-R206：请求序号含会 throw 的失败请求，hold 才能锚定“失败后的
      // 手动重试”（既有 hold 场景全部无失败，计数序列不受影响）。
      conversationFetchCount += 1;
      const fails = typeof options.conversationFails === "function"
        ? options.conversationFails(url)
        : options.conversationFails ?? false;
      if (fails) throw new TypeError("offline");
      const rows = accountB
        ? accountB.conversations ?? []
        : typeof options.conversations === "function"
          ? options.conversations(url)
          : options.conversations ?? [conversation(1), conversation(2)];
      if (options.holdFirstConversationFetch && conversationFetchCount === 1) {
        await options.holdFirstConversationFetch;
      }
      if (options.holdSecondConversationFetch && conversationFetchCount === 2) {
        await options.holdSecondConversationFetch;
      }
      if (options.holdThirdConversationFetch && conversationFetchCount === 3) {
        await options.holdThirdConversationFetch;
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

  // VC-R199：离开时返回的旧列表必须带着已加载范围可用；刷新失败不得用
  // 整页错误卡盖掉既有列表，反馈要出现在当前可见位置并提供重试。
  it("返回刷新等待期间既有列表保持可用", async () => {
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const { calls } = stubFetch({
      holdSecondConversationFetch: refreshGate,
      conversations: [conversation(1), conversation(2)],
    });
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.findAll('[data-testid="session-preview"]')).toHaveLength(2);

    // 返回后刷新请求挂起：既有列表不得被骨架或错误卡替换。
    deactivatePage(wrapper);
    activatePage(wrapper);
    await flushPromises();
    expect(calls.filter((url) => url.includes("/api/v1/conversations?"))).toHaveLength(2);
    expect(wrapper.findAll('[data-testid="session-preview"]')).toHaveLength(2);
    expect(wrapper.find('[data-testid="conversations-loading"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="conversations-load-failed"]').exists()).toBe(false);

    releaseRefresh();
    await flushPromises();
    expect(wrapper.findAll('[data-testid="session-preview"]')).toHaveLength(2);
    expect(wrapper.find('[data-testid="conversations-load-failed"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("返回刷新失败保留既有列表并在当前位置给出重试", async () => {
    let refreshFails = false;
    let rows = [conversation(1), conversation(2)];
    const { calls } = stubFetch({
      conversationFails: () => refreshFails,
      conversations: () => rows,
    });
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.findAll('[data-testid="session-preview"]')).toHaveLength(2);

    deactivatePage(wrapper);
    refreshFails = true;
    activatePage(wrapper);
    await flushPromises();

    // 既有列表保持可点，不被整页错误卡隐藏。
    expect(wrapper.findAll('[data-testid="session-preview"]')).toHaveLength(2);
    expect(wrapper.find('[data-testid="conversations-load-failed"]').exists()).toBe(false);
    const refreshError = wrapper.find('[data-testid="conversations-refresh-notice"]');
    expect(refreshError.exists()).toBe(true);
    expect(refreshError.attributes("data-state")).toBe("failed");
    expect(refreshError.text()).toContain("会话没有刷新出来");

    refreshFails = false;
    rows = [conversation(3), ...rows];
    // 键盘从反馈条按钮启动重试：真实 Enter 前按钮先持有焦点。
    const retryButton = wrapper.find('[data-testid="conversations-retry-refresh"]');
    (retryButton.element as HTMLElement).focus();
    await retryButton.trigger("click");
    await flushPromises();

    // VC-R206：手动重试成功后反馈条与同一按钮保留（成功反馈 + 再次刷新），
    // 键盘焦点不掉到 body。
    const notice = wrapper.find('[data-testid="conversations-refresh-notice"]');
    expect(notice.attributes("data-state")).toBe("success");
    expect(notice.text()).toContain("已更新");
    const retryAfter = wrapper.find('[data-testid="conversations-retry-refresh"]');
    expect(retryAfter.text()).toBe("再次刷新");
    expect(retryAfter.element).toBe(retryButton.element);
    expect(document.activeElement).toBe(retryButton.element);
    expect(wrapper.findAll('[data-testid="session-preview"]')).toHaveLength(3);
    expect(wrapper.findAll('[data-testid="session-preview"]')[0].text()).toContain("第 3 段对话");
    expect(calls.filter((url) => url.includes("/api/v1/conversations?"))).toHaveLength(3);

    // 下一次返回的自动刷新收回手动成功提示：自动路径等待与成功都不挂反馈。
    deactivatePage(wrapper);
    activatePage(wrapper);
    await flushPromises();
    expect(wrapper.find('[data-testid="conversations-refresh-notice"]').exists()).toBe(false);
    expect(calls.filter((url) => url.includes("/api/v1/conversations?"))).toHaveLength(4);
    wrapper.unmount();
  });

  // VC-R206：手动重试的等待期间反馈条与同一按钮持续存在（不再无状态），
  // 键盘焦点留在按钮上，重复 Enter 由 busy 门挡住不发第二次请求。
  it("手动重试等待期间反馈与按钮保留，重复触发不发新请求", async () => {
    let releaseRetry!: () => void;
    const retryGate = new Promise<void>((resolve) => {
      releaseRetry = resolve;
    });
    let refreshFails = false;
    const { calls } = stubFetch({
      holdThirdConversationFetch: retryGate,
      conversationFails: () => refreshFails,
      conversations: [conversation(1), conversation(2)],
    });
    const wrapper = mountPage();
    await flushPromises();

    deactivatePage(wrapper);
    refreshFails = true;
    activatePage(wrapper);
    await flushPromises();
    expect(wrapper.find('[data-testid="conversations-refresh-notice"]').attributes("data-state")).toBe("failed");

    // 键盘 Enter 启动手动重试：真实 Enter 前按钮先持有焦点；本次请求挂起。
    refreshFails = false;
    const retryButton = wrapper.find('[data-testid="conversations-retry-refresh"]');
    (retryButton.element as HTMLElement).focus();
    await retryButton.trigger("click");
    await flushPromises();

    // 等待期间：同一反馈条切到等待文案，同一按钮未卸载，焦点不掉到 body。
    const pending = wrapper.find('[data-testid="conversations-refresh-notice"]');
    expect(pending.attributes("data-state")).toBe("pending");
    expect(pending.text()).toContain("正在刷新");
    const retryInPending = wrapper.find('[data-testid="conversations-retry-refresh"]');
    expect(retryInPending.element).toBe(retryButton.element);
    expect(retryInPending.attributes("aria-disabled")).toBe("true");
    expect(retryInPending.attributes("aria-busy")).toBe("true");
    expect(document.activeElement).toBe(retryButton.element);
    expect(calls.filter((url) => url.includes("/api/v1/conversations?"))).toHaveLength(3);

    // 等待期间重复 Enter：busy 门挡住，不发起第二次请求。
    await retryInPending.trigger("click");
    await flushPromises();
    expect(calls.filter((url) => url.includes("/api/v1/conversations?"))).toHaveLength(3);

    releaseRetry();
    await flushPromises();

    // 成功：同一按钮变为再次刷新，焦点仍在原位。
    expect(wrapper.find('[data-testid="conversations-refresh-notice"]').attributes("data-state")).toBe("success");
    const retryAfter = wrapper.find('[data-testid="conversations-retry-refresh"]');
    expect(retryAfter.element).toBe(retryButton.element);
    expect(retryAfter.text()).toBe("再次刷新");
    expect(document.activeElement).toBe(retryButton.element);
    wrapper.unmount();
  });

  // VC-R206：手动重试再次失败时，失败反馈回到同一反馈条与同一按钮，
  // 键盘焦点不丢，不需要重新定位。
  it("手动重试再次失败回到同一反馈条与按钮，焦点保持", async () => {
    let refreshFails = false;
    stubFetch({
      conversationFails: () => refreshFails,
      conversations: [conversation(1), conversation(2)],
    });
    const wrapper = mountPage();
    await flushPromises();

    deactivatePage(wrapper);
    refreshFails = true;
    activatePage(wrapper);
    await flushPromises();

    const retryButton = wrapper.find('[data-testid="conversations-retry-refresh"]');
    (retryButton.element as HTMLElement).focus();
    await retryButton.trigger("click");
    await flushPromises();

    const failed = wrapper.find('[data-testid="conversations-refresh-notice"]');
    expect(failed.attributes("data-state")).toBe("failed");
    expect(failed.text()).toContain("会话没有刷新出来");
    const retryAfter = wrapper.find('[data-testid="conversations-retry-refresh"]');
    expect(retryAfter.element).toBe(retryButton.element);
    expect(retryAfter.text()).toBe("重试");
    // 非 pending 时 aria-disabled/aria-busy 显式为 false（与 Home R203 一致）。
    expect(retryAfter.attributes("aria-disabled")).toBe("false");
    expect(retryAfter.attributes("aria-busy")).toBe("false");
    expect(document.activeElement).toBe(retryButton.element);
    wrapper.unmount();
  });

  // VC-R199：keyset 服务端 + 旧条目互异活动时间。c(i) 活动随 i 递减，
  // n(i) 全部高于旧条目，用于验证合并、尾部保留与停止下扫的键值规则。
  const OLD_BASE_MS = Date.parse("2026-09-15T08:00:00Z");
  const NEW_BASE_MS = Date.parse("2026-09-20T08:00:00Z");

  // 合成 id 用纯数字串，与生产 keyset 的数字 id 契约一致（新记录取更大
  // 段位，仅活动时间不同时就已定序，id 只作平键兜底）。
  function oldConversation(index: number, overrides: Record<string, unknown> = {}) {
    return conversation(index, {
      conversationId: String(index),
      lastActivityAt: new Date(OLD_BASE_MS - index * 60_000).toISOString(),
      ...overrides,
    });
  }

  function newConversation(index: number) {
    return {
      conversationId: String(5000 + index),
      relationshipId: "rel-1",
      title: `新对话 ${index}`,
      lastMessagePreview: `新对话 ${index} 的最后一句。`,
      createdAt: "2026-08-18T01:00:00Z",
      lastActivityAt: new Date(NEW_BASE_MS - index * 60_000).toISOString(),
    };
  }

  /** 按服务端真实 keyset 规则切页：after 命中数组中的位置后取下一页。 */
  function cursorPages(server: () => unknown[]) {
    return (url: string) => {
      const rows = server();
      const after = url.match(/[?&]after=([^&]+)/)?.[1];
      const limit = Number(url.match(/[?&]limit=(\d+)/)?.[1] ?? "20");
      const start = after
        ? rows.findIndex((row) => (row as { conversationId: string }).conversationId === after) + 1
        : 0;
      return rows.slice(start, start + limit);
    };
  }

  // VC-R199：后端 RFC3339Nano 契约保留亚毫秒小数秒（更新较老会话即可
  // 出现 id 与活动时间相反的顺序）；Date.parse 会截断该精度。
  function nanoConversation(id: number, nanos: number, title: string) {
    return {
      conversationId: String(id),
      relationshipId: "rel-1",
      title,
      lastMessagePreview: `${title} 的最后一句。`,
      createdAt: "2026-08-18T01:00:00Z",
      lastActivityAt: `2026-10-25T12:00:00.${String(nanos).padStart(9, "0")}Z`,
    };
  }

  it("亚毫秒活动时间差不会让追赶提前停止或丢失旧条目", async () => {
    // 旧 20 条：id 10001+，活动小数秒 199..180ns；全部同一毫秒内。
    const oldRows = Array.from({ length: 20 }, (_, i) =>
      nanoConversation(10001 + i, 199 - i, `第 ${i + 1} 段对话`));
    let server = oldRows;
    const { calls } = stubFetch({ conversations: cursorPages(() => server) });
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.findAll('[data-testid="session-preview"]')).toHaveLength(20);

    // 离开期间新增 21 条：id 101+，活动小数秒 299..279ns，高于旧头但同
    // 一毫秒——截断到毫秒会让边界比较落到 id 兜底（旧头 id 更大）而误停。
    deactivatePage(wrapper);
    server = [
      ...Array.from({ length: 21 }, (_, j) =>
        nanoConversation(101 + j, 299 - j, `新对话 ${j + 1}`)),
      ...oldRows,
    ];
    activatePage(wrapper);
    await flushPromises();

    // 必须继续追赶第二页：21 条新记录齐全，旧头仍在列表中未被当作已删。
    expect(calls.filter((url) => url.includes("/api/v1/conversations?"))).toHaveLength(3);
    expect(wrapper.findAll('[data-testid="session-preview"]')).toHaveLength(41);
    expect(wrapper.findAll('[data-testid="session-preview"]')[0].text()).toContain("新对话 1");
    expect(wrapper.text()).toContain("新对话 21");
    expect(wrapper.text()).toContain("第 1 段对话");
    wrapper.unmount();
  });

  it("正常返回合并新增会话并保留已浏览范围与浏览位置", async () => {
    let server = [
      ...Array.from({ length: 20 }, (_, index) => oldConversation(index + 1)),
      oldConversation(21),
    ];
    const { calls } = stubFetch({ conversations: cursorPages(() => server) });
    const wrapper = mountPage();
    await flushPromises();
    await wrapper.find('[data-testid="conversations-load-more"]').trigger("click");
    await flushPromises();
    expect(wrapper.findAll('[data-testid="session-preview"]')).toHaveLength(21);

    // 打开第 15 条旧会话后离开：几何在点击行时捕获，mock 需先就位。
    const rectTop = { value: 400 };
    const rectSpy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      () =>
        ({
          top: rectTop.value,
          right: 0,
          bottom: 0,
          left: 0,
          width: 320,
          height: 64,
          x: 0,
          y: rectTop.value,
          toJSON: () => ({}),
        }) as DOMRect,
    );
    const scrollTo = vi.fn();
    Object.defineProperty(window, "scrollTo", {
      value: scrollTo,
      writable: true,
      configurable: true,
    });
    await wrapper.findAll('[data-testid="session-preview"]')[14].trigger("click");
    deactivatePage(wrapper);

    // 离开期间新增 3 条：返回刷新后已取前缀整体下移 52px。
    server = [
      newConversation(1),
      newConversation(2),
      newConversation(3),
      ...Array.from({ length: 21 }, (_, index) => oldConversation(index + 1)),
    ];
    rectTop.value = 452;
    activatePage(wrapper);
    await flushPromises();

    // 新鲜度 + 已浏览范围：新会话在前，旧尾部（含加载更多得到的第 21 条）保留。
    expect(wrapper.findAll('[data-testid="session-preview"]')).toHaveLength(24);
    expect(wrapper.findAll('[data-testid="session-preview"]')[0].text()).toContain("新对话 1");
    expect(wrapper.text()).toContain("第 15 段对话");
    expect(wrapper.text()).toContain("第 21 段对话");
    expect(calls.filter((url) => url.includes("/api/v1/conversations?"))).toHaveLength(3);
    // 浏览位置：最后打开的旧会话按离开时的偏移差补偿回原视口位置。
    expect(scrollTo).toHaveBeenCalledWith(0, 52);

    rectSpy.mockRestore();
    wrapper.unmount();
  });

  // VC-R200：按真实布局模拟几何——每条 64px、列表自文档 100px 起，rect 是
  // 文档位置减当前 scrollY 的视口相对值。scrollY 分阶段设置：返回时
  // vue-router 按 savedPosition 把 scrollY 恢复成离开值（与点击锚点一致），
  // 之后的差异只可能来自用户滚动。
  const ITEM_HEIGHT = 64;
  const LIST_TOP = 100;

  function mockLayout() {
    let scrollY = 0;
    const originalScrollY = Object.getOwnPropertyDescriptor(window, "scrollY");
    Object.defineProperty(window, "scrollY", { get: () => scrollY, configurable: true });
    const rectSpy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        const index = Array.from(document.querySelectorAll("[data-conversation-id]")).indexOf(this);
        const top = index < 0 ? 0 : LIST_TOP + index * ITEM_HEIGHT - scrollY;
        return {
          top,
          bottom: top + ITEM_HEIGHT,
          left: 0,
          right: 320,
          width: 320,
          height: ITEM_HEIGHT,
          x: 0,
          y: top,
          toJSON: () => ({}),
        } as DOMRect;
      },
    );
    const scrollTo = vi.fn();
    Object.defineProperty(window, "scrollTo", { value: scrollTo, writable: true, configurable: true });
    return {
      scrollTo,
      setScrollY(value: number) {
        scrollY = value;
      },
      restore() {
        rectSpy.mockRestore();
        if (originalScrollY) Object.defineProperty(window, "scrollY", originalScrollY);
        else Reflect.deleteProperty(window, "scrollY");
      },
    };
  }

  // VC-R200：返回刷新等待或失败期间用户已浏览到别处时，合并落位必须以
  // 当前视口为准，不得把离开时的点击锚点抢回来。
  it("刷新等待期间主动回到顶部，合并后保持顶部不跳回旧锚点", async () => {
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    let server = Array.from({ length: 20 }, (_, index) => oldConversation(index + 1));
    stubFetch({
      holdSecondConversationFetch: refreshGate,
      conversations: cursorPages(() => server),
    });
    const layout = mockLayout();
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.findAll('[data-testid="session-preview"]')).toHaveLength(20);

    // 在 scrollY=800 处打开第 15 条后离开；返回时恢复到同一位置，刷新挂起。
    layout.setScrollY(800);
    await wrapper.findAll('[data-testid="session-preview"]')[14].trigger("click");
    deactivatePage(wrapper);
    server = [newConversation(1), newConversation(2), newConversation(3), ...server];
    activatePage(wrapper);
    await flushPromises();
    expect(wrapper.findAll('[data-testid="session-preview"]')).toHaveLength(20);

    // 用户按 Home 回到顶部看最新会话，之后刷新才完成。
    layout.setScrollY(0);
    releaseRefresh();
    await flushPromises();

    expect(wrapper.findAll('[data-testid="session-preview"]')).toHaveLength(23);
    expect(wrapper.findAll('[data-testid="session-preview"]')[0].text()).toContain("新对话 1");
    expect(layout.scrollTo).not.toHaveBeenCalled();

    layout.restore();
    wrapper.unmount();
  });

  it("刷新等待期间浏览到中段，合并新增会话后仍保持正在看的同一条及相对位置", async () => {
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    let server = Array.from({ length: 20 }, (_, index) => oldConversation(index + 1));
    stubFetch({
      holdSecondConversationFetch: refreshGate,
      conversations: cursorPages(() => server),
    });
    const layout = mockLayout();
    const wrapper = mountPage();
    await flushPromises();

    layout.setScrollY(800);
    await wrapper.findAll('[data-testid="session-preview"]')[14].trigger("click");
    deactivatePage(wrapper);
    server = [newConversation(1), newConversation(2), newConversation(3), ...server];
    activatePage(wrapper);
    await flushPromises();
    expect(wrapper.findAll('[data-testid="session-preview"]')).toHaveLength(20);

    // 用户滚到 scrollY=1000：可见首条是第 15 段（文档 996，露在视口上方 4px）。
    layout.setScrollY(1000);
    releaseRefresh();
    await flushPromises();

    expect(wrapper.findAll('[data-testid="session-preview"]')).toHaveLength(23);
    // 上方合入 3 条（192px）后第 15 段位于文档 1188：补偿到 1192 让它仍停在
    // 视口上方 4px，而不是只跳过旧 scrollTo 让内容整体下移。
    expect(layout.scrollTo).toHaveBeenCalledTimes(1);
    expect(layout.scrollTo).toHaveBeenCalledWith(0, 1192);

    layout.restore();
    wrapper.unmount();
  });

  it("刷新失败后浏览到别处再重试，按当前位置落位而不抢回旧锚点", async () => {
    let refreshFails = false;
    let server = Array.from({ length: 20 }, (_, index) => oldConversation(index + 1));
    stubFetch({
      conversationFails: () => refreshFails,
      conversations: cursorPages(() => server),
    });
    const layout = mockLayout();
    const wrapper = mountPage();
    await flushPromises();

    layout.setScrollY(800);
    await wrapper.findAll('[data-testid="session-preview"]')[14].trigger("click");
    deactivatePage(wrapper);
    refreshFails = true;
    activatePage(wrapper);
    await flushPromises();
    expect(wrapper.find('[data-testid="conversations-refresh-notice"]').attributes("data-state")).toBe("failed");
    expect(wrapper.findAll('[data-testid="session-preview"]')).toHaveLength(20);
    expect(layout.scrollTo).not.toHaveBeenCalled();

    // 失败期间用户浏览到 scrollY=1000，再点重试；此时服务端已有 3 条新会话。
    layout.setScrollY(1000);
    refreshFails = false;
    server = [newConversation(1), newConversation(2), newConversation(3), ...server];
    await wrapper.find('[data-testid="conversations-retry-refresh"]').trigger("click");
    await flushPromises();

    // 手动重试成功反馈保留（VC-R206），落位仍按当前位置补偿。
    expect(wrapper.find('[data-testid="conversations-refresh-notice"]').attributes("data-state")).toBe("success");
    expect(wrapper.findAll('[data-testid="session-preview"]')).toHaveLength(23);
    expect(layout.scrollTo).toHaveBeenCalledTimes(1);
    expect(layout.scrollTo).toHaveBeenCalledWith(0, 1192);

    layout.restore();
    wrapper.unmount();
  });

  it("离开期间新增超过一页时刷新补齐全部新记录不产生缺口", async () => {
    let server = Array.from({ length: 40 }, (_, index) => oldConversation(index + 1));
    const { calls } = stubFetch({ conversations: cursorPages(() => server) });
    const wrapper = mountPage();
    await flushPromises();
    await wrapper.find('[data-testid="conversations-load-more"]').trigger("click");
    await flushPromises();
    expect(wrapper.findAll('[data-testid="session-preview"]')).toHaveLength(40);

    // 离开期间新增 21 条（超过一页），并在旧尾部之下继续追加服务端记录。
    deactivatePage(wrapper);
    server = [
      ...Array.from({ length: 21 }, (_, index) => newConversation(index + 1)),
      ...Array.from({ length: 45 }, (_, index) => oldConversation(index + 1)),
    ];
    activatePage(wrapper);
    await flushPromises();

    // 第 21 条新记录必须出现在后续分页之前：21 条新增 + 40 条旧范围，无重复。
    expect(wrapper.findAll('[data-testid="session-preview"]')).toHaveLength(61);
    expect(wrapper.text()).toContain("新对话 21");
    expect(wrapper.text()).toContain("第 1 段对话");
    expect(wrapper.text()).toContain("第 40 段对话");

    // 继续分页从旧尾部游标接入更早记录，不跳过、不重复。
    await wrapper.find('[data-testid="conversations-load-more"]').trigger("click");
    await flushPromises();
    expect(wrapper.findAll('[data-testid="session-preview"]')).toHaveLength(66);
    expect(wrapper.text()).toContain("第 45 段对话");
    wrapper.unmount();
  });

  it("刚打开的旧会话升至首位时刷新仍补齐其后的全部新记录", async () => {
    let server = Array.from({ length: 40 }, (_, index) => oldConversation(index + 1));
    const { calls } = stubFetch({ conversations: cursorPages(() => server) });
    const wrapper = mountPage();
    await flushPromises();
    await wrapper.find('[data-testid="conversations-load-more"]').trigger("click");
    await flushPromises();
    expect(wrapper.findAll('[data-testid="session-preview"]')).toHaveLength(40);

    // 离开期间新增 21 条，且刚打开的第 35 条旧会话发了新消息升到首位。
    deactivatePage(wrapper);
    server = [
      oldConversation(35, {
        lastActivityAt: new Date(NEW_BASE_MS + 60_000).toISOString(),
      }),
      ...Array.from({ length: 21 }, (_, index) => newConversation(index + 1)),
      ...Array.from({ length: 40 }, (_, index) => oldConversation(index + 1))
        .filter((row) => row.conversationId !== "35"),
    ];
    activatePage(wrapper);
    await flushPromises();

    // 首页会同时包含升至首位的已知旧会话与 19 条新会话：不得据此接尾。
    expect(wrapper.findAll('[data-testid="session-preview"]')[0].text()).toContain("第 35 段对话");
    expect(wrapper.findAll('[data-testid="session-preview"]')).toHaveLength(61);
    expect(wrapper.text()).toContain("新对话 20");
    expect(wrapper.text()).toContain("新对话 21");
    expect(wrapper.text()).toContain("第 1 段对话");
    expect(wrapper.text()).toContain("第 40 段对话");
    expect(calls.filter((url) => url.includes("/api/v1/conversations?"))).toHaveLength(4);
    wrapper.unmount();
  });

  it("旧头部已被删除时刷新停止下扫且不保留陈旧条目", async () => {
    let server = Array.from({ length: 20 }, (_, index) => oldConversation(index + 1));
    const { calls } = stubFetch({ conversations: cursorPages(() => server) });
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.findAll('[data-testid="session-preview"]')).toHaveLength(20);

    // 离开期间旧头部 20 条全部被删，服务端只剩 50 条新记录与更早的未读记录。
    deactivatePage(wrapper);
    server = [
      ...Array.from({ length: 50 }, (_, index) => newConversation(index + 1)),
      ...Array.from({ length: 40 }, (_, index) => oldConversation(index + 21)),
    ];
    activatePage(wrapper);
    await flushPromises();

    // 首屏 1 次 + 追赶 3 页：页尾键值低于旧头部后不得继续下扫全账户。
    expect(calls.filter((url) => url.includes("/api/v1/conversations?"))).toHaveLength(4);
    expect(wrapper.findAll('[data-testid="session-preview"]')).toHaveLength(60);
    expect(wrapper.text()).toContain("新对话 50");
    expect(wrapper.text()).toContain("第 30 段对话");
    // 已删除的旧条目不得以陈旧副本垫底。
    expect(wrapper.text()).not.toContain("第 1 段对话");
    wrapper.unmount();
  });

  // VC-R201：返回缓存页后的继续操作焦点。返回刷新挂起证明焦点恢复不等
  // GET；scrollTo spy 证明聚焦本身不产生程序滚动（滚动归 R199/R200）。
  it("返回缓存页后焦点立即回到最后打开项，不等返回刷新", async () => {
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const rows = Array.from({ length: 20 }, (_, index) => conversation(index + 1));
    stubFetch({
      holdSecondConversationFetch: refreshGate,
      conversations: () => rows,
    });
    const scrollTo = vi.fn();
    Object.defineProperty(window, "scrollTo", {
      value: scrollTo,
      writable: true,
      configurable: true,
    });
    const wrapper = mountPage();
    await flushPromises();

    // 键盘打开第 15 条：激活前行按钮先持有焦点（真实 Enter 激活路径）。
    const opened = wrapper.findAll('[data-testid="session-preview"]')[14].element as HTMLElement;
    opened.focus();
    expect(document.activeElement).toBe(opened);
    await wrapper.findAll('[data-testid="session-preview"]')[14].trigger("click");
    deactivatePage(wrapper);

    // 实际导航把列表页移出文档使原项失焦：返回瞬间焦点在 body（Root 实测）。
    // deactivatePage 只触发生命周期不移走 DOM，须显式模拟导航造成的失焦。
    document.body.focus();
    expect(document.activeElement).toBe(document.body);

    activatePage(wrapper);
    // 返回刷新仍在途：焦点已回到最后打开项，键盘可从原地继续（下一 Tab
    // 即下一项），且聚焦不得引起程序滚动。
    expect(document.activeElement).toBe(opened);
    expect(wrapper.findAll('[data-testid="session-preview"]')).toHaveLength(20);
    expect(scrollTo).not.toHaveBeenCalled();

    releaseRefresh();
    await flushPromises();
    expect(wrapper.findAll('[data-testid="session-preview"]')).toHaveLength(20);
    wrapper.unmount();
  });

  it("返回刷新在途时用户已移走焦点，响应合并后不抢回", async () => {
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const rows = Array.from({ length: 20 }, (_, index) => conversation(index + 1));
    stubFetch({
      holdSecondConversationFetch: refreshGate,
      conversations: () => rows,
    });
    const wrapper = mountPage();
    await flushPromises();

    const opened = wrapper.findAll('[data-testid="session-preview"]')[14].element as HTMLElement;
    opened.focus();
    await wrapper.findAll('[data-testid="session-preview"]')[14].trigger("click");
    deactivatePage(wrapper);
    document.body.focus();
    activatePage(wrapper);
    expect(document.activeElement).toBe(opened);

    // 刷新仍在途时用户已 Tab 到下一项继续操作。
    const next = wrapper.findAll('[data-testid="session-preview"]')[15].element as HTMLElement;
    next.focus();
    expect(document.activeElement).toBe(next);

    releaseRefresh();
    await flushPromises();

    // 合并落位只管滚动，焦点意图按一次返回消费，不得把焦点抢回最后打开项。
    expect(document.activeElement).toBe(next);
    wrapper.unmount();
  });
});
