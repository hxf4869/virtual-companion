// @vitest-environment happy-dom
// 全部会话页只验证找回并继续对话的真实路径；搜索和管理能力在完整产品
// 契约就绪前不得以局部实现混入此页。
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

interface FetchOptions {
  relationships?: unknown[];
  relationshipFails?: boolean | (() => boolean);
  conversationFails?: boolean | ((url: string) => boolean);
  conversations?: unknown[] | ((url: string) => unknown[]);
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
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = input.toString();
    calls.push(url);
    if (url === "/api/v1/relationships") {
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
      const rows = typeof options.conversations === "function"
        ? options.conversations(url)
        : options.conversations ?? [conversation(1), conversation(2)];
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
});
