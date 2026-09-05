// @vitest-environment happy-dom
// 新聊天页只测试用户能理解的核心路径。流式协议、并发单写和恢复细节由
// chat store / realtime 测试负责，这里不为已移除的控制台 UI 保留契约。
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAuthStore } from "@/stores/auth";
import { useChatStore } from "@/stores/chat";

import ChatPage from "./chat.vue";

const RELATIONSHIP = {
  relationshipId: "rel-1",
  personaRef: "gentle-listener",
  companionName: "林夏",
  active: true,
  createdAt: "2026-08-13T01:00:00Z",
};

const RECENT = [
  {
    conversationId: "conv-new",
    relationshipId: "rel-1",
    title: "昨晚的那件小事",
    lastMessagePreview: "那我们就从你真正想说的地方开始。",
    lastActivityAt: "2026-08-31T14:18:00Z",
  },
  {
    conversationId: "conv-old",
    relationshipId: "rel-1",
    title: "更早的一次对话",
    lastMessagePreview: "我会记得你说过的这些。",
    lastActivityAt: "2026-08-29T08:42:00Z",
  },
];

const MESSAGES = [
  {
    messageId: "m1",
    conversationId: "conv-new",
    role: "assistant",
    content: "听起来你不是不想继续，只是已经撑得有些久了。",
    createdAt: "2026-08-31T14:15:00Z",
  },
  {
    messageId: "m2",
    conversationId: "conv-new",
    role: "user",
    content: "可能是。我连休息的时候都会觉得自己在浪费时间。",
    createdAt: "2026-08-31T14:16:00Z",
  },
];

interface FetchOptions {
  relationships?: unknown[];
  relationshipFails?: boolean | (() => boolean);
  conversations?: unknown[];
  conversationListFails?: boolean | (() => boolean);
  messages?: Record<string, unknown[]>;
  createdConversationId?: string;
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
  const calls: Array<{ method: string; url: string; body?: string }> = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({
      method,
      url,
      body: typeof init?.body === "string" ? init.body : undefined,
    });

    if (url === "/api/v1/relationships") {
      if (resolveBool(options.relationshipFails)) {
        return response(false, 500, { code: "INTERNAL_ERROR" });
      }
      return response(true, 200, options.relationships ?? [RELATIONSHIP]);
    }
    if (method === "GET" && /^\/api\/v1\/conversations\?/.test(url)) {
      if (resolveBool(options.conversationListFails)) {
        return response(false, 500, { code: "INTERNAL_ERROR" });
      }
      return response(true, 200, options.conversations ?? RECENT);
    }
    const messageMatch = url.match(/^\/api\/v1\/conversations\/([^/]+)\/messages/);
    if (method === "GET" && messageMatch) {
      const id = decodeURIComponent(messageMatch[1]);
      const rows = options.messages?.[id]
        ?? (id === "conv-new" ? MESSAGES : []);
      return response(true, 200, rows);
    }
    if (method === "POST" && url === "/api/v1/conversations") {
      return response(true, 200, {
        conversationId: options.createdConversationId ?? "conv-created",
      });
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
  return mount(ChatPage, { attachTo: document.body });
}

function navigateTo(): ReturnType<typeof vi.fn> {
  return (globalThis as unknown as { uni: { navigateTo: ReturnType<typeof vi.fn> } }).uni.navigateTo;
}

describe("聊天产品页", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    setActivePinia(createPinia());
    vi.stubGlobal("uni", {
      navigateTo: vi.fn(),
      navigateBack: vi.fn(),
      redirectTo: vi.fn(),
    });
    vi.stubGlobal("location", { search: "", hash: "", href: "" });
    stubFetch();
    login();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("用陪伴者身份、非真人说明和三项底栏建立聊天骨架", async () => {
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[data-testid="chat-companion-name"]').text()).toBe("林夏");
    expect(wrapper.find('[data-testid="chat-ai-label"]').text()).toBe("AI 陪伴者 · 非真人");
    expect(wrapper.find('[data-testid="nav-conversations"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="message-input"]').exists()).toBe(true);

    const tabs = wrapper.findAll('[data-testid^="tab-"]');
    expect(tabs.map((tab) => tab.text())).toEqual(["首页", "聊天", "我的"]);
    expect(wrapper.find('[data-testid="tab-chats"]').attributes("aria-current")).toBe("page");
    wrapper.unmount();
  });

  it("无深链时打开服务端最近活动排序的第一段对话", async () => {
    const { calls } = stubFetch();
    const wrapper = mountPage();
    await flushPromises();

    expect(calls.some((call) => call.url === "/api/v1/conversations?relationshipId=rel-1")).toBe(true);
    expect(calls.some((call) => call.url === "/api/v1/conversations/conv-new/messages?limit=50")).toBe(true);
    expect(calls.some((call) => call.url.includes("conv-old/messages"))).toBe(false);
    expect(wrapper.findAll('[data-testid="chat-message"]')).toHaveLength(2);
    wrapper.unmount();
  });

  it("会话深链优先打开指定对话", async () => {
    vi.stubGlobal("location", {
      search: "?relationshipId=rel-1&conversationId=conv-old",
      hash: "",
      href: "",
    });
    const { calls } = stubFetch();
    const wrapper = mountPage();
    await flushPromises();

    expect(calls.some((call) => call.url === "/api/v1/conversations/conv-old/messages?limit=50")).toBe(true);
    expect(useChatStore().conversationId).toBe("conv-old");
    wrapper.unmount();
  });

  it("没有历史时呈现同一聊天页空状态，不在访问时制造空会话", async () => {
    const { calls } = stubFetch({ conversations: [] });
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[data-testid="empty-history"]').text()).toContain("从这里开始");
    expect(useChatStore().conversationId).toBe("");
    expect(calls.some((call) => call.method === "POST" && call.url === "/api/v1/conversations")).toBe(false);
    wrapper.unmount();
  });

  it("第一次发送时才创建会话，再复用现有 store 发送", async () => {
    const { calls } = stubFetch({ conversations: [] });
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    const sendSpy = vi.spyOn(store, "send").mockResolvedValue();
    const input = wrapper.find('[data-testid="message-input"]');
    await input.setValue("今天有点累。");
    await wrapper.find('[data-testid="send"]').trigger("click");
    await flushPromises();

    const createCall = calls.find((call) => call.method === "POST" && call.url === "/api/v1/conversations");
    expect(createCall?.body).toContain('"relationshipId":"rel-1"');
    expect(store.conversationId).toBe("conv-created");
    expect(sendSpy).toHaveBeenCalledOnce();
    expect(sendSpy.mock.calls[0]?.[2]).toBe("今天有点累。");
    expect((input.element as HTMLTextAreaElement).value).toBe("");
    wrapper.unmount();
  });

  it("读取 uni-app textarea 的 detail.value 并启用发送", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    const sendSpy = vi.spyOn(store, "send").mockResolvedValue();
    const input = wrapper.find('[data-testid="message-input"]');
    await input.trigger("input", { detail: { value: "你是什么模型" } });

    const send = wrapper.find('[data-testid="send"]');
    expect(send.attributes("disabled")).toBeUndefined();
    await send.trigger("click");
    await flushPromises();

    expect(sendSpy).toHaveBeenCalledOnce();
    expect(sendSpy.mock.calls[0]?.[2]).toBe("你是什么模型");
    wrapper.unmount();
  });

  it("请求未落地时保留原文，并用产品文案原位重试", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    const sendSpy = vi.spyOn(store, "send")
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce();
    const input = wrapper.find('[data-testid="message-input"]');
    await input.setValue("这句话不能丢");
    await wrapper.find('[data-testid="send"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="chat-send-error"]').text()).toContain("没发出去，点此重试");
    expect((input.element as HTMLTextAreaElement).value).toBe("这句话不能丢");

    await wrapper.find('[data-testid="retry"]').trigger("click");
    await flushPromises();
    expect(sendSpy).toHaveBeenCalledTimes(2);
    expect(sendSpy.mock.calls[1]?.[2]).toBe("这句话不能丢");
    expect((input.element as HTMLTextAreaElement).value).toBe("");
    wrapper.unmount();
  });

  it("Enter 发送，Shift+Enter 保留换行语义", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    const sendSpy = vi.spyOn(store, "send").mockResolvedValue();
    const input = wrapper.find('[data-testid="message-input"]');
    await input.setValue("第一句");
    await input.trigger("keydown", { key: "Enter", shiftKey: false });
    await flushPromises();
    expect(sendSpy).toHaveBeenCalledOnce();

    await input.setValue("第二句");
    await input.trigger("keydown", { key: "Enter", shiftKey: true });
    await flushPromises();
    expect(sendSpy).toHaveBeenCalledOnce();
    wrapper.unmount();
  });

  it("流式回复只显示自然语言状态、一个实时草稿和停止动作", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    store.phase = "streaming";
    store.pendingUserContent = "在吗";
    store.stream = {
      status: "streaming",
      epoch: 1,
      cursor: 1,
      events: [
        { eventSeq: 1, streamEpoch: 1, eventType: "chat.delta", payload: "我在听。" },
      ],
      terminal: false,
      terminalEventType: null,
    };
    await wrapper.vm.$nextTick();

    expect(wrapper.findAll('[data-testid="draft"]')).toHaveLength(1);
    expect(wrapper.find('[data-testid="draft"]').text()).toContain("我在听。");
    expect(wrapper.find('[data-testid="status"]').text()).toContain("正在回复…");
    expect(wrapper.find('[data-testid="cancel"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="send"]').exists()).toBe(false);
    expect(wrapper.text()).not.toMatch(/SSE|generation|provider|Token|词元|路由/);
    wrapper.unmount();
  });

  it("终止失败保留待发送内容并提供一次明确重试", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    store.phase = "failed";
    store.pendingUserContent = "请再试一次";
    await wrapper.vm.$nextTick();

    const sendSpy = vi.spyOn(store, "send").mockResolvedValue();
    expect(wrapper.find('[data-testid="chat-send-error"]').text()).toContain("没发出去，点此重试");
    await wrapper.find('[data-testid="retry"]').trigger("click");
    await flushPromises();
    expect(sendSpy).toHaveBeenCalledOnce();
    expect(sendSpy.mock.calls[0]?.[2]).toBe("请再试一次");
    wrapper.unmount();
  });

  it("助手消息保留安全的轻量排版，不把原始 HTML 变成节点", async () => {
    stubFetch({
      messages: {
        "conv-new": [{
          messageId: "m-safe",
          conversationId: "conv-new",
          role: "assistant",
          content: "请记住 **重点**。<script>bad()</script>",
        }],
      },
    });
    const wrapper = mountPage();
    await flushPromises();

    const answer = wrapper.find('[data-testid="assistant-md"]');
    expect(answer.text()).toContain("重点");
    expect(answer.text()).toContain("<script>bad()</script>");
    expect(answer.find("script").exists()).toBe(false);
    wrapper.unmount();
  });

  it("更多菜单只保留全部会话和开始新对话", async () => {
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.find('[data-testid="chat-context-open"]').trigger("click");
    const sheet = wrapper.find('[data-testid="app-sheet"]');
    expect(sheet.exists()).toBe(true);
    expect(sheet.findAll(".chat-option")).toHaveLength(2);
    expect(sheet.text()).toContain("全部会话");
    expect(sheet.text()).toContain("开始新对话");
    expect(sheet.text()).not.toMatch(/对话模式|无痕|记忆管理|角色设置|停用|删除|改名|登出/);

    await wrapper.find('[data-testid="chat-open-all-conversations"]').trigger("click");
    expect(navigateTo()).toHaveBeenCalledWith({
      url: "/pages/conversations/conversations?relationshipId=rel-1",
    });
    wrapper.unmount();
  });

  it("开始新对话只清空当前窗口，不提前写入一条空会话", async () => {
    const { calls } = stubFetch();
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    expect(store.conversationId).toBe("conv-new");
    await wrapper.find('[data-testid="chat-context-open"]').trigger("click");
    await wrapper.find('[data-testid="new-conversation"]').trigger("click");
    await wrapper.vm.$nextTick();

    expect(store.conversationId).toBe("");
    expect(store.messages).toEqual([]);
    expect(wrapper.find('[data-testid="empty-history"]').exists()).toBe(true);
    expect(calls.filter((call) => call.method === "POST" && call.url === "/api/v1/conversations")).toHaveLength(0);
    wrapper.unmount();
  });

  it("初始化失败后可在原位恢复", async () => {
    let fails = true;
    stubFetch({ conversationListFails: () => fails });
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[data-testid="chat-init-error"]').text()).toContain("聊天没有打开");
    fails = false;
    await wrapper.find('[data-testid="chat-retry-init"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="history"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("缺少默认陪伴时不恢复旧关系选择或创建入口", async () => {
    stubFetch({ relationships: [] });
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[data-testid="chat-init-error"]').text()).toContain("聊天还没准备好");
    expect(wrapper.find('[data-testid="relationship-selector"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("创建陪伴");
    wrapper.unmount();
  });

  it("滚离底部后保留阅读位置，并提供回到最新", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const history = wrapper.find('[data-testid="history"]').element as HTMLElement;
    Object.defineProperty(history, "scrollHeight", { configurable: true, value: 1200 });
    Object.defineProperty(history, "clientHeight", { configurable: true, value: 400 });
    history.scrollTop = 180;
    history.dispatchEvent(new Event("scroll"));
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="back-to-latest"]').exists()).toBe(true);
    await wrapper.find('[data-testid="back-to-latest"]').trigger("click");
    expect(history.scrollTop).toBe(1200);
    expect(wrapper.find('[data-testid="back-to-latest"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
