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
  deferConversationCreate?: boolean;
  /** POST /generations 的按序行为："reject"＝网络失败（结果未知），数字＝该状态码（403/404 为存在性隐藏）。 */
  generations?: Array<"reject" | number>;
  /** VC-R02：GET /realtime/streams/:id 永不返回——复现"本实例发起的流仍在进行"。 */
  hangStream?: boolean;
  /** VC-R04：首个 POST /generations 挂起，由测试放行/拒绝（时机 a 与 VC-R115）。 */
  deferGeneration?: boolean;
  /** VC-R115：POST /api/v1/conversations 可控失败（仿 relationshipFails 的函数开关）。 */
  conversationCreateFails?: boolean | (() => boolean);
  /** VC-R04：GET /generations/:id/snapshot 挂起，由测试放行（恢复核对 deferred 夹具）。 */
  deferSnapshot?: boolean;
  /** VC-R04：GET /realtime/streams/:id 返回可控 SSE 流，帧由测试推送/关闭。 */
  liveStream?: boolean;
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

type StubResponse = ReturnType<typeof response>;

function stubFetch(options: FetchOptions = {}) {
  const calls: Array<{ method: string; url: string; body?: string }> = [];
  let resolveCreate!: (value: StubResponse) => void;
  const deferredCreate = new Promise<StubResponse>((resolve) => {
    resolveCreate = resolve;
  });
  let resolveGenerationPost!: (value: StubResponse) => void;
  let rejectGenerationPost!: (reason?: unknown) => void;
  const deferredGenerationPost = new Promise<StubResponse>((resolve, reject) => {
    resolveGenerationPost = resolve;
    rejectGenerationPost = reject;
  });
  let resolveSnapshot!: (value: StubResponse) => void;
  const deferredSnapshot = new Promise<StubResponse>((resolve) => {
    resolveSnapshot = resolve;
  });
  // VC-R115：deferGeneration 只作用于首个 POST /generations 的闭包级标记。
  let generationDeferralUsed = false;
  // VC-R04：可控 SSE body——测试按需推送帧并关闭（EOF）。
  const encoder = new TextEncoder();
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
  const liveBody = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
    },
  });
  const pushFrame = (frame: string): void => {
    streamController?.enqueue(encoder.encode(frame));
  };
  const endStream = (): void => {
    streamController?.close();
  };
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
      // 与后端契约一致：after 向前、before 向上、缺省 = 最近窗口（升序）。
      const params = new URLSearchParams(url.split("?")[1] ?? "");
      const after = params.get("after");
      const before = params.get("before");
      const limit = Number(params.get("limit") ?? 50);
      const numeric = (row: unknown) => Number((row as { messageId: unknown }).messageId);
      let out: unknown[];
      if (after !== null) {
        out = rows.filter((row) => numeric(row) > Number(after)).slice(0, limit);
      } else if (before !== null) {
        out = rows.filter((row) => numeric(row) < Number(before)).slice(-limit);
      } else {
        out = rows.slice(-limit);
      }
      return response(true, 200, out);
    }
    if (method === "POST" && url === "/api/v1/conversations") {
      if (resolveBool(options.conversationCreateFails)) {
        return response(false, 500, { code: "INTERNAL_ERROR" });
      }
      if (options.deferConversationCreate) {
        return deferredCreate;
      }
      return response(true, 200, {
        conversationId: options.createdConversationId ?? "conv-created",
      });
    }
    if (method === "POST" && /^\/api\/v1\/conversations\/[^/]+\/generations$/.test(url)) {
      // VC-R115：deferGeneration 只挂起首个 POST，后续 POST 走 generations 脚本。
      if (options.deferGeneration && !generationDeferralUsed) {
        generationDeferralUsed = true;
        return deferredGenerationPost;
      }
      const step = options.generations?.shift() ?? 200;
      if (step === "reject") throw new TypeError("fetch failed");
      if (step === 200) {
        return response(true, 200, {
          generationId: "gen-new",
          conversationId: "conv-new",
          logicalGenerationId: "lg-new",
          status: "CREATED",
        });
      }
      return response(false, step, null);
    }
    if (method === "GET" && /^\/api\/v1\/generations\/[^/]+\/snapshot$/.test(url)) {
      if (options.deferSnapshot) return deferredSnapshot;
      return response(true, 200, { events: [] });
    }
    if (method === "GET" && url.startsWith("/api/v1/realtime/streams/")) {
      // VC-R02：挂起的 Fetch-SSE 连接——resume 永不落地，流保持在 streaming。
      if (options.hangStream) return new Promise<StubResponse>(() => undefined);
      if (options.liveStream) {
        return { ...response(true, 200, {}), body: liveBody };
      }
      return response(true, 200, {});
    }
    return response(true, 200, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    calls,
    fetchMock,
    resolveCreate,
    resolveGenerationPost,
    rejectGenerationPost,
    resolveSnapshot,
    pushFrame,
    endStream,
  };
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

/**
 * VC-R02：模拟"另一个页面实例"在 conv-new 中进行中的流式回复（共享同一
 * store）。与既有测试一致，直接注入 phase/stream/pendingUserContent。
 */
function seedLiveStreamState(): void {
  const store = useChatStore();
  store.conversationId = "conv-new";
  store.generationId = "gen-live";
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
}

function navigateTo(): ReturnType<typeof vi.fn> {
  return (globalThis as unknown as { uni: { navigateTo: ReturnType<typeof vi.fn> } }).uni.navigateTo;
}

/** VC-R115：解析 POST /generations 请求体（userContent + idempotencyKey）。 */
function generationPostBodies(calls: Array<{ method: string; url: string; body?: string }>) {
  return calls
    .filter((call) => call.method === "POST" && /\/generations$/.test(call.url))
    .map((call) => JSON.parse(call.body ?? "{}") as { userContent?: string; idempotencyKey?: string });
}

describe("聊天产品页", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    // VC-R04：happy-dom 的 sessionStorage 跨测试存活；真实 run 会写入
    // vc.gen.restore（conv-new 配对），不清理会让后续 conv-new 深链挂载走进
    // 上一轮的快照恢复（页面停在 loading，属测试间污染而非产品行为）。
    sessionStorage.clear();
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

    // N-05：结果未知的 POST 不得宣称"没发出去"。
    expect(wrapper.find('[data-testid="chat-send-error"]').text()).toContain("没有确认发送结果，点此重试");
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
    store.generationId = "42";
    // 明确终态失败轮已确认持有 generation（sendUnconfirmed 分流的前提）。
    store.turnHasGeneration = true;
    store.pendingUserContent = "请再试一次";
    await wrapper.vm.$nextTick();

    const sendSpy = vi.spyOn(store, "send").mockResolvedValue();
    // N-06：重试前会先有界取一次快照拿权威 source；这里直接给定。
    vi.spyOn(store, "resolveTurnSource").mockResolvedValue("77");
    // N-05：明确终态失败如实呈现"回复没有完成"，不再说"没发出去"。
    expect(wrapper.find('[data-testid="chat-send-error"]').text()).toContain("这次回复没有完成，点此重新尝试");
    await wrapper.find('[data-testid="retry"]').trigger("click");
    await flushPromises();
    expect(sendSpy).toHaveBeenCalledOnce();
    expect(sendSpy.mock.calls[0]?.[2]).toBe("请再试一次");
    expect(sendSpy.mock.calls[0]?.[3]).toMatchObject({ sourceUserMessageId: "77" });
    wrapper.unmount();
  });

  // ---- N-05：重试分流以当前提交意图为准 ----

  it("旧轮 exhausted 残留 + 新 POST 失败时，重试重发当前输入而不被旧轮劫持", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    // 旧轮重连残留：已确认 generation、输出未确认。
    store.phase = "failed";
    store.outcome = "exhausted";
    store.generationId = "42";
    store.turnHasGeneration = true;
    store.pendingUserContent = "旧问题";
    await wrapper.vm.$nextTick();

    const sendSpy = vi.spyOn(store, "send")
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce();
    const recoverSpy = vi.spyOn(store, "recoverInFlight").mockResolvedValue();
    const input = wrapper.find('[data-testid="message-input"]');
    await input.setValue("新消息");
    await wrapper.find('[data-testid="send"]').trigger("click");
    await flushPromises();

    // 新 POST 失败＝本次提交未确认，不是旧轮的"连接中断"。
    expect(wrapper.find('[data-testid="chat-send-error"]').text()).toContain("没有确认发送结果，点此重试");
    await wrapper.find('[data-testid="retry"]').trigger("click");
    await flushPromises();

    expect(recoverSpy).not.toHaveBeenCalled();
    expect(sendSpy).toHaveBeenCalledTimes(2);
    expect(sendSpy.mock.calls[1]?.[2]).toBe("新消息");
    wrapper.unmount();
  });

  it("未知 POST 后存在性隐藏 403：文案与动作一致、草稿保留、同键重发且不取旧快照", async () => {
    const { calls } = stubFetch({ generations: ["reject", 403, 403] });
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    // 上一轮正常完成的残留：generationId 为旧值，重试分流不得劫持本轮。
    store.generationId = "gen-old";
    await wrapper.vm.$nextTick();

    const generationPosts = () =>
      calls.filter((call) => call.method === "POST" && /\/generations$/.test(call.url));

    // ① 发送新文本，POST 结果未知（网络失败）：未确认文案 + 草稿回填。
    const input = wrapper.find('[data-testid="message-input"]');
    await input.setValue("新文本");
    await wrapper.find('[data-testid="send"]').trigger("click");
    await flushPromises();
    expect(generationPosts()).toHaveLength(1);
    expect(wrapper.find('[data-testid="chat-send-error"]').text()).toContain("没有确认发送结果，点此重试");

    // ② 同键重试得存在性隐藏 403（真实 sendGeneration 返回 null）：文案仍
    // 是"没有确认发送结果"——原请求结局未知，不得改称"回复没有完成"。
    await wrapper.find('[data-testid="retry"]').trigger("click");
    await flushPromises();
    expect(generationPosts()).toHaveLength(2);
    expect(wrapper.find('[data-testid="chat-send-error"]').text()).toContain("没有确认发送结果，点此重试");
    expect(wrapper.find('[data-testid="chat-send-error"]').text()).not.toContain("这次回复没有完成");
    expect(wrapper.find('[data-testid="retry"]').exists()).toBe(true);
    expect(store.pendingUserContent).toBe("新文本");

    // ③ 再次重试：第三次 POST 与第一次同键、不携带 sourceUserMessageId，
    // 且从未以旧 generationId 取快照（重试不读上一轮残留 generation）。
    await wrapper.find('[data-testid="retry"]').trigger("click");
    await flushPromises();
    const posts = generationPosts();
    expect(posts).toHaveLength(3);
    const keys = posts.map(
      (post) => (JSON.parse(post.body ?? "{}") as { idempotencyKey?: string }).idempotencyKey,
    );
    expect(keys[2]).toBe(keys[0]);
    expect(keys.every((key) => typeof key === "string" && key.length > 0)).toBe(true);
    expect(posts.every((post) => !(post.body ?? "").includes("sourceUserMessageId"))).toBe(true);
    expect(calls.some((call) => call.url.includes("/api/v1/generations/gen-old/snapshot"))).toBe(false);
    wrapper.unmount();
  });

  it("回复暂时无法访问时提供核对入口：草稿保留、核对一次、不发新键", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    store.phase = "failed";
    store.outcome = "not_found_or_forbidden";
    store.generationId = "42";
    // not_found_or_forbidden 只能来自已确认持有 generation 的轮次。
    store.turnHasGeneration = true;
    store.pendingUserContent = "被隐藏的原文";
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="chat-send-error"]').text()).toContain("这条回复暂时无法访问，点此核对");
    const sendSpy = vi.spyOn(store, "send").mockResolvedValue();
    const recoverSpy = vi.spyOn(store, "recoverInFlight").mockResolvedValue();
    await wrapper.find('[data-testid="retry"]').trigger("click");
    await flushPromises();

    expect(recoverSpy).toHaveBeenCalledOnce();
    expect(sendSpy).not.toHaveBeenCalled();
    expect(store.pendingUserContent).toBe("被隐藏的原文");
    wrapper.unmount();
  });

  // ---- N-06：终态失败重试先取快照权威 source ----

  it("终态失败重试先有界取快照 source：拿到才重发，拿不到保留核对入口", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    store.phase = "failed";
    // 终态失败轮已确认持有 generation（否则走 sendUnconfirmed 分流）。
    store.turnHasGeneration = true;
    store.pendingUserContent = "原文";
    store.lastTurnSource = "";
    await wrapper.vm.$nextTick();

    const sendSpy = vi.spyOn(store, "send").mockResolvedValue();
    const resolveSpy = vi.spyOn(store, "resolveTurnSource");

    // 快照拿不到 source：不重发（不能退回普通发送复制用户消息）。
    resolveSpy.mockResolvedValue("");
    await wrapper.find('[data-testid="retry"]').trigger("click");
    await flushPromises();
    expect(resolveSpy).toHaveBeenCalledOnce();
    expect(sendSpy).not.toHaveBeenCalled();

    // 快照提供权威 source：复用原用户消息重发。
    resolveSpy.mockClear();
    sendSpy.mockClear();
    resolveSpy.mockResolvedValue("90");
    await wrapper.find('[data-testid="retry"]').trigger("click");
    await flushPromises();
    expect(resolveSpy).toHaveBeenCalledOnce();
    expect(sendSpy).toHaveBeenCalledOnce();
    expect(sendSpy.mock.calls[0]?.[3]).toMatchObject({ sourceUserMessageId: "90" });
    wrapper.unmount();
  });

  // ---- N-06：回复已完成的同步失败文案与入口 ----

  it("回复已完成的同步失败文案与同步入口仅在完成结果出现", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    store.phase = "completed";
    store.finalSyncFailed = true;
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="status"]').text()).toContain("回复已完成，记录同步暂未成功");
    const retrySync = vi.spyOn(store, "retryFinalSync").mockResolvedValue();
    await wrapper.find('[data-testid="status-action"]').trigger("click");
    expect(retrySync).toHaveBeenCalledOnce();

    // 非完成结果不得使用"回复已完成"文案。
    store.phase = "failed";
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-testid="status"]').text()).not.toContain("回复已完成");
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

  // ---- WP-D（缺口1）：提交互斥覆盖建会话 + 发送 ----

  it("连点 10 次发送只在首次建会话时发一次 POST", async () => {
    const { calls, resolveCreate } = stubFetch({ conversations: [], deferConversationCreate: true });
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    const sendSpy = vi.spyOn(store, "send").mockResolvedValue();
    const input = wrapper.find('[data-testid="message-input"]');
    await input.setValue("只发一次");
    const sendButton = wrapper.find('[data-testid="send"]');
    await Promise.all(Array.from({ length: 10 }, () => sendButton.trigger("click")));

    const createPosts = calls.filter(
      (call) => call.method === "POST" && call.url === "/api/v1/conversations",
    );
    expect(createPosts).toHaveLength(1);
    expect(sendSpy).not.toHaveBeenCalled(); // 仍在等待会话创建落地

    resolveCreate(response(true, 200, { conversationId: "conv-created" }));
    await flushPromises();

    expect(createPosts).toHaveLength(1);
    expect(sendSpy).toHaveBeenCalledOnce();
    expect(sendSpy.mock.calls[0]?.[2]).toBe("只发一次");
    wrapper.unmount();
  });

  it("建会话等待期间的新输入不会被并发提交吞掉或丢失", async () => {
    const { calls, resolveCreate } = stubFetch({ conversations: [], deferConversationCreate: true });
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    const sendSpy = vi.spyOn(store, "send").mockResolvedValue();
    const input = wrapper.find('[data-testid="message-input"]');
    await input.setValue("第一句");
    await wrapper.find('[data-testid="send"]').trigger("click");

    // 会话创建在途时，用户写下一条草稿并再次点击：提交互斥拒绝第二次，
    // 新草稿既不丢失也不被重复提交。
    await input.setValue("等待期间又写的");
    await wrapper.find('[data-testid="send"]').trigger("click");

    resolveCreate(response(true, 200, { conversationId: "conv-created" }));
    await flushPromises();

    expect(calls.filter((call) => call.method === "POST" && call.url === "/api/v1/conversations")).toHaveLength(1);
    expect(sendSpy).toHaveBeenCalledOnce();
    expect(sendSpy.mock.calls[0]?.[2]).toBe("第一句");
    expect((input.element as HTMLTextAreaElement).value).toBe("等待期间又写的");
    wrapper.unmount();
  });

  it("Enter 与点击并发触发发送时只提交一次", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    const sendSpy = vi.spyOn(store, "send").mockResolvedValue();
    const input = wrapper.find('[data-testid="message-input"]');
    await input.setValue("一句");
    const press = input.trigger("keydown", { key: "Enter" });
    const click = wrapper.find('[data-testid="send"]').trigger("click");
    await Promise.all([press, click]);
    await flushPromises();

    expect(sendSpy).toHaveBeenCalledOnce();
    wrapper.unmount();
  });

  // ---- WP-D（缺口2）：提交快照与新草稿分离 ----

  it("发送失败恢复只回填旧快照，绝不覆盖在途输入的新草稿", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    let rejectSend!: (error: unknown) => void;
    vi.spyOn(store, "send").mockImplementation(
      () => new Promise((_resolve, reject) => {
        rejectSend = reject;
      }),
    );
    const input = wrapper.find('[data-testid="message-input"]');
    await input.setValue("原始消息");
    await wrapper.find('[data-testid="send"]').trigger("click");
    // 输入框已清空（内容 === 提交快照），此时用户开始写下一条草稿。
    expect((input.element as HTMLTextAreaElement).value).toBe("");
    await input.setValue("新草稿");

    rejectSend(new Error("offline"));
    await flushPromises();

    expect((input.element as HTMLTextAreaElement).value).toBe("新草稿");
    expect(wrapper.find('[data-testid="chat-send-error"]').exists()).toBe(true);
    wrapper.unmount();
  });

  // ---- 缺陷6：提交失败响应晚到且已切换会话时不串扰新会话 UI ----

  it("提交失败响应晚到且已切换会话时不回填输入、不出现重试文案", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    let rejectSend!: (error: unknown) => void;
    vi.spyOn(store, "send").mockImplementation(
      () => new Promise((_resolve, reject) => {
        rejectSend = reject;
      }),
    );
    const input = wrapper.find('[data-testid="message-input"]');
    await input.setValue("A 会话的消息");
    await wrapper.find('[data-testid="send"]').trigger("click");
    expect((input.element as HTMLTextAreaElement).value).toBe("");

    // 提交在途时用户切换到另一会话（真实 openConversation：窗口令牌递增）。
    const switchTransport = {
      request: async () => ({ ok: true, status: 200, json: [] }),
    };
    expect(await store.openConversation(switchTransport, "conv-old")).toBe("opened");
    expect(store.conversationId).toBe("conv-old");

    // A 的失败响应晚到：新会话的输入与错误文案不受影响。
    rejectSend(new Error("offline"));
    await flushPromises();

    expect((input.element as HTMLTextAreaElement).value).toBe("");
    expect(wrapper.find('[data-testid="chat-send-error"]').exists()).toBe(false);
    expect(store.phase).not.toBe("failed");
    wrapper.unmount();
  });

  it("生成中输入框保持可编辑，用户可继续写下一条草稿", async () => {
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

    const input = wrapper.find('[data-testid="message-input"]');
    expect(input.attributes("disabled")).toBeUndefined();
    await input.setValue("下一条草稿");
    expect((input.element as HTMLTextAreaElement).value).toBe("下一条草稿");
    expect(wrapper.find('[data-testid="cancel"]').exists()).toBe(true);
    wrapper.unmount();
  });

  // ---- VC-R02：流式期间的会话导航 ----

  it("流式中进入其他会话显示等待状态而非错误，且不打断进行中的回复", async () => {
    vi.stubGlobal("location", {
      search: "?relationshipId=rel-1&conversationId=conv-old",
      hash: "",
      href: "",
    });
    seedLiveStreamState();
    const wrapper = mountPage();
    await flushPromises();

    const waiting = wrapper.find('[data-testid="chat-waiting"]');
    expect(waiting.exists()).toBe(true);
    expect(waiting.attributes("role")).toBe("status");
    expect(waiting.text()).toContain("上一段回复还在生成");
    expect(wrapper.find('[data-testid="chat-init-error"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="chat-retry-init"]').exists()).toBe(false);
    // 等待期间 store 未被等待页清空或中断。
    const store = useChatStore();
    expect(store.conversationId).toBe("conv-new");
    expect(store.phase).toBe("streaming");
    expect(store.generationId).toBe("gen-live");
    expect(store.pendingUserContent).toBe("在吗");
    // 流终态前"打开所选会话"保持禁用；"返回"入口可用。
    expect(wrapper.find('[data-testid="chat-waiting-open"]').attributes("disabled")).toBeDefined();
    expect(wrapper.find('[data-testid="chat-waiting-back"]').attributes("disabled")).toBeUndefined();
    wrapper.unmount();
  });

  it("等待页离开不误 detach 其他实例的活跃流", async () => {
    vi.stubGlobal("location", {
      search: "?relationshipId=rel-1&conversationId=conv-old",
      hash: "",
      href: "",
    });
    seedLiveStreamState();
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.find('[data-testid="chat-waiting"]').exists()).toBe(true);

    // 等待页从未发起/附着流：离开不得把活跃流打成 failed/network。
    wrapper.unmount();

    const store = useChatStore();
    expect(store.phase).toBe("streaming");
    expect(store.generationId).toBe("gen-live");
    expect(store.lastDisconnect).not.toBe("network");
  });

  it("真正发起流的页面离开时仍正常 detach 活跃流", async () => {
    stubFetch({ hangStream: true });
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    const input = wrapper.find('[data-testid="message-input"]');
    await input.setValue("别丢下我");
    await wrapper.find('[data-testid="send"]').trigger("click");
    await flushPromises();

    // 本实例真实发起的流正在进行（POST 落地、SSE 挂起）。
    expect(store.phase).toBe("streaming");
    expect(store.generationId).toBe("gen-new");

    wrapper.unmount();

    // 归属实例离开：保持既有 detach 语义。
    expect(store.phase).toBe("failed");
    expect(store.lastDisconnect).toBe("network");
  });

  it("回复结束后等待页可打开所选会话", async () => {
    vi.stubGlobal("location", {
      search: "?relationshipId=rel-1&conversationId=conv-old",
      hash: "",
      href: "",
    });
    seedLiveStreamState();
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.find('[data-testid="chat-waiting"]').exists()).toBe(true);

    // 本地流结束（store.isStreaming 变 false）：可打开状态使用中性文案，
    // 不声称服务端回复已经结束，也不再出现"还在生成"的流中声称。
    const store = useChatStore();
    store.phase = "completed";
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-testid="chat-waiting"]').text()).toContain("可以打开所选对话了");
    expect(wrapper.find('[data-testid="chat-waiting"]').text()).not.toContain("回复已经结束");
    expect(wrapper.text()).not.toContain("还在生成");
    expect(wrapper.find('[data-testid="chat-waiting-open"]').attributes("disabled")).toBeUndefined();

    // 入口解禁后可成功打开目标会话。
    await wrapper.find('[data-testid="chat-waiting-open"]').trigger("click");
    await flushPromises();

    expect(store.conversationId).toBe("conv-old");
    expect(wrapper.find('[data-testid="chat-waiting"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="history"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("流式中重进当前会话直接进入聊天并保持流式展示", async () => {
    vi.stubGlobal("location", {
      search: "?relationshipId=rel-1&conversationId=conv-new",
      hash: "",
      href: "",
    });
    seedLiveStreamState();
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[data-testid="chat-waiting"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="chat-init-error"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="draft"]').text()).toContain("我在听。");
    expect(wrapper.find('[data-testid="status"]').text()).toContain("正在回复…");
    // 未被打断、未清空。
    const store = useChatStore();
    expect(store.phase).toBe("streaming");
    expect(store.generationId).toBe("gen-live");
    expect(store.pendingUserContent).toBe("在吗");
    wrapper.unmount();
  });

  // ---- VC-R04：会话切换归属（真实按钮路径）与多实例恢复竞争 ----

  const CONV_OLD_MESSAGES = [
    {
      messageId: "o1",
      conversationId: "conv-old",
      role: "assistant",
      content: "这是 B 会话自己的消息。",
      createdAt: "2026-08-29T08:42:00Z",
    },
  ];

  /**
   * 模拟"另一个会话的流断连耗尽"：真实 exhaust 要走 8 次退避重连（约 30s
   * 真实定时器），组件测试按下述终态直种（与 seedLiveStreamState 同一先例，
   * 竞争本身由真实 online 事件 + 真实 recoverInFlight/fetch 驱动）。
   */
  function seedExhaustedStreamState(): void {
    const store = useChatStore();
    store.conversationId = "conv-new";
    store.generationId = "gen-live";
    store.phase = "failed";
    store.outcome = "exhausted";
    store.turnHasGeneration = true;
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
  }

  it("断连后 online：等待页离开不得中断归属页正在恢复的流（deferred 快照）", async () => {
    const { resolveSnapshot } = stubFetch({ hangStream: true, deferSnapshot: true });
    seedLiveStreamState();
    // 页面实例 A：conv-new（流归属页，先挂载——真实路径中流由它发起）。
    vi.stubGlobal("location", {
      search: "?relationshipId=rel-1&conversationId=conv-new",
      hash: "",
      href: "",
    });
    const wrapperA = mountPage();
    await flushPromises();
    expect(wrapperA.find('[data-testid="draft"]').text()).toContain("我在听。");

    // 页面实例 B：conv-old 等待页（A 的流仍在进行）。
    vi.stubGlobal("location", {
      search: "?relationshipId=rel-1&conversationId=conv-old",
      hash: "",
      href: "",
    });
    const wrapperB = mountPage();
    await flushPromises();
    expect(wrapperB.find('[data-testid="chat-waiting"]').exists()).toBe(true);

    // 断连耗尽落地（真实路径终态直种，见 seedExhaustedStreamState 注释）。
    seedExhaustedStreamState();
    await wrapperA.vm.$nextTick();

    // 网络恢复：两个实例的 online 监听先后触发核对（快照响应延迟中）。
    window.dispatchEvent(new Event("online"));

    // 快照（非终态）落地：A 的回复重新进入流式、局部草稿可见。
    resolveSnapshot(response(true, 200, { events: [] }));
    await flushPromises();
    const store = useChatStore();
    expect(store.phase).toBe("streaming");
    expect(wrapperA.find('[data-testid="draft"]').text()).toContain("我在听。");
    expect(wrapperA.find('[data-testid="status"]').text()).toContain("正在回复…");

    // 等待页 B 离开（浏览器返回弹出该实例）：不得中断 A 的恢复。
    wrapperB.unmount();
    await wrapperA.vm.$nextTick();
    expect(store.phase).toBe("streaming");
    expect(store.lastDisconnect).not.toBe("network");
    expect(wrapperA.find('[data-testid="draft"]').text()).toContain("我在听。");
    expect(wrapperA.find('[data-testid="status"]').text()).toContain("正在回复…");
    wrapperA.unmount();
  });

  it("等待页先收到 online 也不核对/不接管，归属页进入后仍可正常恢复", async () => {
    const { calls, resolveSnapshot } = stubFetch({ hangStream: true, deferSnapshot: true });
    seedLiveStreamState();
    // 仅挂载等待页 B（conv-old）——H5 返回栈/缓存页下监听注册顺序不可假设，
    // B 可能是唯一/最先收到 online 的实例。
    vi.stubGlobal("location", {
      search: "?relationshipId=rel-1&conversationId=conv-old",
      hash: "",
      href: "",
    });
    const wrapperB = mountPage();
    await flushPromises();
    expect(wrapperB.find('[data-testid="chat-waiting"]').exists()).toBe(true);

    // 断连耗尽落地后 online 到达等待页：不核对（无快照请求）、不接管。
    seedExhaustedStreamState();
    window.dispatchEvent(new Event("online"));
    await flushPromises();
    const store = useChatStore();
    expect(store.phase).toBe("failed");
    expect(calls.some((call) => call.url.includes("/api/v1/generations/gen-live/snapshot"))).toBe(false);

    // 归属页 A（conv-new）此刻进入：显示重连入口而非等待/错误。
    vi.stubGlobal("location", {
      search: "?relationshipId=rel-1&conversationId=conv-new",
      hash: "",
      href: "",
    });
    const wrapperA = mountPage();
    await flushPromises();
    expect(wrapperA.find('[data-testid="chat-waiting"]').exists()).toBe(false);
    expect(wrapperA.find('[data-testid="chat-send-error"]').text()).toContain("回复连接中断，点此重新连接");

    // 真实按钮重连：归属页正常恢复，流回到 streaming、草稿可见。
    await wrapperA.find('[data-testid="retry"]').trigger("click");
    await flushPromises();
    expect(calls.some((call) => call.url.includes("/api/v1/generations/gen-live/snapshot"))).toBe(true);
    resolveSnapshot(response(true, 200, { events: [] }));
    await flushPromises();
    expect(store.phase).toBe("streaming");
    expect(wrapperA.find('[data-testid="draft"]').text()).toContain("我在听。");
    expect(wrapperA.find('[data-testid="status"]').text()).toContain("正在回复…");

    // 等待页此刻离开：归属未转移，A 的恢复不受影响。
    wrapperB.unmount();
    await wrapperA.vm.$nextTick();
    expect(store.phase).toBe("streaming");
    expect(wrapperA.find('[data-testid="draft"]').text()).toContain("我在听。");
    wrapperA.unmount();
  });

  it("时机a：POST 在途时经真实入口进入 B——B 干净落地，晚到的 A 响应不串扰", async () => {
    const { calls, resolveGenerationPost } = stubFetch({
      deferGeneration: true,
      messages: { "conv-old": CONV_OLD_MESSAGES },
    });
    // A 会话（conv-new）真实发送：POST /generations 挂起。
    vi.stubGlobal("location", {
      search: "?relationshipId=rel-1&conversationId=conv-new",
      hash: "",
      href: "",
    });
    const wrapperA = mountPage();
    await flushPromises();
    const store = useChatStore();
    const inputA = wrapperA.find('[data-testid="message-input"]');
    await inputA.setValue("A 会话的消息");
    await wrapperA.find('[data-testid="send"]').trigger("click");
    await flushPromises();
    expect(store.generationStarting).toBe(true);
    expect(store.pendingUserContent).toBe("A 会话的消息");

    // 真实入口：打开全部会话列表（进入 conversations 页）。
    await wrapperA.find('[data-testid="chat-context-open"]').trigger("click");
    await wrapperA.find('[data-testid="chat-open-all-conversations"]').trigger("click");
    expect(navigateTo()).toHaveBeenCalledWith({
      url: "/pages/conversations/conversations?relationshipId=rel-1",
    });

    // 从会话列表进入 B（conv-old 深链；A 页实例仍存活于页面栈）。
    vi.stubGlobal("location", {
      search: "?relationshipId=rel-1&conversationId=conv-old",
      hash: "",
      href: "",
    });
    const wrapperB = mountPage();
    await flushPromises();

    // B 已 ready 且只显示 B 自己的窗口：无 A 的草稿/待发文本、无错误文案。
    expect(store.conversationId).toBe("conv-old");
    expect(wrapperB.find('[data-testid="chat-waiting"]').exists()).toBe(false);
    expect(wrapperB.find('[data-testid="chat-init-error"]').exists()).toBe(false);
    expect(wrapperB.findAll('[data-testid="chat-message"]')).toHaveLength(1);
    expect(wrapperB.text()).toContain("这是 B 会话自己的消息。");
    expect(wrapperB.text()).not.toContain("A 会话的消息");
    expect(wrapperB.find('[data-testid="chat-send-error"]').exists()).toBe(false);
    expect(store.pendingUserContent).toBe("");

    // A 的 POST 此刻才成功返回：静默丢弃——不启动 A 的流、不写 turn 状态。
    resolveGenerationPost(response(true, 200, {
      generationId: "gen-new",
      conversationId: "conv-new",
      logicalGenerationId: "lg-new",
      status: "CREATED",
    }));
    await flushPromises();

    expect(calls.some((call) => call.url.startsWith("/api/v1/realtime/streams/"))).toBe(false);
    expect(store.phase).toBe("idle");
    expect(store.generationId).toBe("");
    expect(store.conversationId).toBe("conv-old");
    expect(wrapperB.text()).toContain("这是 B 会话自己的消息。");
    expect(wrapperB.find('[data-testid="chat-send-error"]').exists()).toBe(false);
    wrapperB.unmount();
    wrapperA.unmount();
  });

  it("时机b：A 流式等待中经真实入口进入 B——等待不打断流，结束后 B 不显示 A 的草稿", async () => {
    const { pushFrame, endStream } = stubFetch({
      liveStream: true,
      messages: { "conv-old": CONV_OLD_MESSAGES },
    });
    // A 会话（conv-new）真实发送：SSE 先推一条 delta，流保持打开。
    vi.stubGlobal("location", {
      search: "?relationshipId=rel-1&conversationId=conv-new",
      hash: "",
      href: "",
    });
    const wrapperA = mountPage();
    await flushPromises();
    const store = useChatStore();
    const inputA = wrapperA.find('[data-testid="message-input"]');
    await inputA.setValue("在吗");
    await wrapperA.find('[data-testid="send"]').trigger("click");
    await flushPromises();
    pushFrame('event: chat.delta\ndata: {"text":"A 的草稿"}\n\n');
    await flushPromises();
    expect(store.phase).toBe("streaming");
    expect(wrapperA.find('[data-testid="draft"]').text()).toContain("A 的草稿");

    // 真实入口进入 B（conv-old）：A 的流仍在等待——B 显示等待而非接管。
    vi.stubGlobal("location", {
      search: "?relationshipId=rel-1&conversationId=conv-old",
      hash: "",
      href: "",
    });
    const wrapperB = mountPage();
    await flushPromises();
    expect(wrapperB.find('[data-testid="chat-waiting"]').exists()).toBe(true);
    expect(wrapperB.text()).toContain("上一段回复还在生成");
    // 等待期间 store 未被 B 清空或中断；B 未拉取自己的窗口。
    expect(store.conversationId).toBe("conv-new");
    expect(store.phase).toBe("streaming");
    expect(store.generationId).toBe("gen-new");
    expect(store.pendingUserContent).toBe("在吗");
    expect(wrapperB.text()).not.toContain("B 会话自己的消息");

    // A 的流走完（终帧 + EOF）：正常完成，草稿成为已确认正文。
    pushFrame('event: chat.completed\ndata: {}\n\n');
    endStream();
    await flushPromises();
    expect(store.phase).toBe("completed");
    expect(store.outcome).toBe("completed");
    expect(store.finalAssistant?.content).toBe("A 的草稿");

    // 等待页解禁后经真实按钮打开 B：B 只显示 B 的窗口，不显示 A 的草稿。
    expect(wrapperB.find('[data-testid="chat-waiting-open"]').attributes("disabled")).toBeUndefined();
    await wrapperB.find('[data-testid="chat-waiting-open"]').trigger("click");
    await flushPromises();

    expect(store.conversationId).toBe("conv-old");
    expect(wrapperB.find('[data-testid="chat-waiting"]').exists()).toBe(false);
    expect(wrapperB.findAll('[data-testid="chat-message"]')).toHaveLength(1);
    expect(wrapperB.text()).toContain("这是 B 会话自己的消息。");
    expect(wrapperB.text()).not.toContain("A 的草稿");
    expect(wrapperB.find('[data-testid="draft"]').exists()).toBe(false);
    expect(store.pendingUserContent).toBe("");
    expect(store.finalAssistant).toBeNull();
    wrapperB.unmount();
    wrapperA.unmount();
  });

  // ---- VC-R04（疑点1 复核）：同页 hash 深链切换（H5 直接编辑 URL） ----

  it("直接编辑 hash 指向另一会话时页面重开目标窗口，不再停留旧会话内容", async () => {
    stubFetch({ messages: { "conv-old": CONV_OLD_MESSAGES } });
    vi.stubGlobal("location", {
      search: "?relationshipId=rel-1&conversationId=conv-new",
      hash: "",
      href: "",
    });
    const wrapper = mountPage();
    await flushPromises();
    const store = useChatStore();
    expect(store.conversationId).toBe("conv-new");

    // 模拟 H5 直接把 URL hash 改成 conv-b 的深链（uni 路由不重建本页实例）。
    vi.stubGlobal("location", {
      search: "",
      hash: "#/pages/chat/chat?relationshipId=rel-1&conversationId=conv-old",
      href: "",
    });
    window.dispatchEvent(new Event("hashchange"));
    await flushPromises();

    expect(store.conversationId).toBe("conv-old");
    expect(wrapper.find('[data-testid="chat-waiting"]').exists()).toBe(false);
    expect(wrapper.findAll('[data-testid="chat-message"]')).toHaveLength(1);
    expect(wrapper.text()).toContain("这是 B 会话自己的消息。");
    wrapper.unmount();
  });

  it("流式期间直接编辑 hash 进入 B：显示等待而非把 A 的草稿留在 B 的 URL 下", async () => {
    stubFetch({ messages: { "conv-old": CONV_OLD_MESSAGES } });
    // A 的流活跃（VC-R02 复现形态的起点）。
    seedLiveStreamState();
    vi.stubGlobal("location", {
      search: "?relationshipId=rel-1&conversationId=conv-new",
      hash: "",
      href: "",
    });
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.find('[data-testid="draft"]').text()).toContain("我在听。");

    // URL hash 直接改成 conv-b：页面必须转入等待，不得继续显示 A 的草稿。
    vi.stubGlobal("location", {
      search: "",
      hash: "#/pages/chat/chat?relationshipId=rel-1&conversationId=conv-old",
      href: "",
    });
    window.dispatchEvent(new Event("hashchange"));
    await flushPromises();

    expect(wrapper.find('[data-testid="chat-waiting"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="draft"]').exists()).toBe(false);
    const store = useChatStore();
    expect(store.conversationId).toBe("conv-new");
    expect(store.phase).toBe("streaming");
    expect(store.generationId).toBe("gen-live");
    wrapper.unmount();
  });

  it("hash 编辑转等待后浏览器返回原会话：重开自己的流，不卡在等待态", async () => {
    stubFetch({ messages: { "conv-old": CONV_OLD_MESSAGES } });
    seedLiveStreamState();
    // A 实例（conv-new）显示自己的活跃流。
    vi.stubGlobal("location", {
      search: "?relationshipId=rel-1&conversationId=conv-new",
      hash: "",
      href: "",
    });
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.find('[data-testid="draft"]').text()).toContain("我在听。");

    // 直接编辑 hash 到 conv-old：流式占用，本页转入等待（VC-R02 修复语义）。
    vi.stubGlobal("location", {
      search: "",
      hash: "#/pages/chat/chat?relationshipId=rel-1&conversationId=conv-old",
      href: "",
    });
    window.dispatchEvent(new Event("hashchange"));
    await flushPromises();
    expect(wrapper.find('[data-testid="chat-waiting"]').exists()).toBe(true);

    // 浏览器返回 conv-new：目标会话与本页最近等待的目标不同——必须重开
    // 自己的会话并继续显示流，而不是停留在等待态。
    vi.stubGlobal("location", {
      search: "",
      hash: "#/pages/chat/chat?relationshipId=rel-1&conversationId=conv-new",
      href: "",
    });
    window.dispatchEvent(new Event("hashchange"));
    await flushPromises();

    expect(wrapper.find('[data-testid="chat-waiting"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="draft"]').text()).toContain("我在听。");
    expect(wrapper.find('[data-testid="status"]').text()).toContain("正在回复…");
    const store = useChatStore();
    expect(store.conversationId).toBe("conv-new");
    expect(store.phase).toBe("streaming");
    expect(store.generationId).toBe("gen-live");
    wrapper.unmount();
  });

  it("KeepAlive 停用的隐藏页不响应别的页面的 hash 变化；重新激活后返回原会话仍显示自己的流", async () => {
    const { calls } = stubFetch({ messages: { "conv-old": CONV_OLD_MESSAGES } });
    seedLiveStreamState();
    vi.stubGlobal("location", {
      search: "?relationshipId=rel-1&conversationId=conv-new",
      hash: "",
      href: "",
    });
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.find('[data-testid="draft"]').text()).toContain("我在听。");

    // 模拟 uni H5 KeepAlive 停用：本实例转入后台缓存（getCurrentPages 栈内
    // 隐藏存活，window 监听仍在，onUnmounted 不会运行）。
    const internal = wrapper.vm.$ as unknown as {
      a?: Array<() => void>;
      da?: Array<() => void>;
    };
    internal.da?.forEach((hook) => hook());
    const fetchCountBefore = calls.length;

    // 隐藏期间前台页面把 hash 切到 conv-old：本实例不得重初始化——无新
    // 请求、不进等待态，保持自己的流式窗口。
    vi.stubGlobal("location", {
      search: "",
      hash: "#/pages/chat/chat?relationshipId=rel-1&conversationId=conv-old",
      href: "",
    });
    window.dispatchEvent(new Event("hashchange"));
    await flushPromises();
    expect(calls.length).toBe(fetchCountBefore);
    expect(wrapper.find('[data-testid="chat-waiting"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="draft"]').text()).toContain("我在听。");

    // 重新激活并返回原会话（浏览器后退落回本页）：目标与本页最近 init 目标
    // 一致，无需重开——缓存窗口继续显示自己的流。
    internal.a?.forEach((hook) => hook());
    vi.stubGlobal("location", {
      search: "",
      hash: "#/pages/chat/chat?relationshipId=rel-1&conversationId=conv-new",
      href: "",
    });
    window.dispatchEvent(new Event("hashchange"));
    await flushPromises();
    expect(calls.length).toBe(fetchCountBefore);
    expect(wrapper.find('[data-testid="chat-waiting"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="draft"]').text()).toContain("我在听。");
    expect(wrapper.find('[data-testid="status"]').text()).toContain("正在回复…");
    wrapper.unmount();
  });

  it("hash 指向同一目标会话或离开 chat 路径时不重开窗口", async () => {
    const { calls } = stubFetch({ messages: { "conv-old": CONV_OLD_MESSAGES } });
    vi.stubGlobal("location", {
      search: "?relationshipId=rel-1&conversationId=conv-new",
      hash: "",
      href: "",
    });
    const wrapper = mountPage();
    await flushPromises();
    const store = useChatStore();
    const windowCallsBefore = calls.filter(
      (call) => call.method === "GET" && call.url.includes("/messages"),
    ).length;

    // 同一目标会话：不动作。
    vi.stubGlobal("location", {
      search: "",
      hash: "#/pages/chat/chat?relationshipId=rel-1&conversationId=conv-new",
      href: "",
    });
    window.dispatchEvent(new Event("hashchange"));
    await flushPromises();
    expect(store.conversationId).toBe("conv-new");
    expect(wrapper.find('[data-testid="chat-loading"]').exists()).toBe(false);

    // 指向其他页面（如全部会话列表）：本页不动作，交给路由。
    vi.stubGlobal("location", {
      search: "",
      hash: "#/pages/conversations/conversations?relationshipId=rel-1",
      href: "",
    });
    window.dispatchEvent(new Event("hashchange"));
    await flushPromises();
    expect(store.conversationId).toBe("conv-new");
    const windowCallsAfter = calls.filter(
      (call) => call.method === "GET" && call.url.includes("/messages"),
    ).length;
    expect(windowCallsAfter).toBe(windowCallsBefore);
    wrapper.unmount();
  });

  // ---- WP-D（缺口3）：停止后生成状态待确认 + 手动核对 ----

  it("停止显示但服务端终态未知时给出待确认文案和手动核对入口", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    store.phase = "cancelled";
    store.cancelUnconfirmed = true;
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="status"]').text()).toContain("生成状态待确认");
    const recheck = vi.spyOn(store, "recoverInFlight").mockResolvedValue();
    await wrapper.find('[data-testid="status-action"]').trigger("click");
    expect(recheck).toHaveBeenCalledOnce();
    wrapper.unmount();
  });

  // ---- WP-D（缺口6）：最近窗口 + 向上加载 + 阅读锚点 ----

  it("首次打开只拉最近窗口，历史不足一页时显示没有更早的消息", async () => {
    const { calls } = stubFetch();
    const wrapper = mountPage();
    await flushPromises();

    expect(calls.filter((call) => call.url.includes("/messages")).every((call) => call.url.endsWith("messages?limit=50"))).toBe(true);
    expect(wrapper.find('[data-testid="load-more"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="history-end"]').text()).toContain("没有更早的消息");
    wrapper.unmount();
  });

  it("向上加载更早消息后保持阅读锚点，视口不跳动", async () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({
      messageId: String(i + 1),
      conversationId: "conv-new",
      role: "user",
      content: `m${i + 1}`,
    }));
    stubFetch({ messages: { "conv-new": rows } });
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    expect(store.messages).toHaveLength(50);

    const history = wrapper.find('[data-testid="history"]').element as HTMLElement;
    Object.defineProperty(history, "scrollHeight", {
      configurable: true,
      get: () => 5000 + store.messages.length * 10,
    });
    Object.defineProperty(history, "clientHeight", { configurable: true, value: 400 });
    history.scrollTop = 0;
    // 停掉回底部的待定帧并标记用户已离底，避免锚点被自动滚动覆盖。
    history.dispatchEvent(new Event("wheel"));
    history.dispatchEvent(new Event("scroll"));
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="load-more"]').exists()).toBe(true);
    await wrapper.find('[data-testid="load-more"]').trigger("click");
    await flushPromises();

    expect(store.messages).toHaveLength(100);
    expect(Number(store.messages[0].messageId)).toBe(21);
    // 插入前 scrollTop=0、高度 5500；插入后高度 6000 → 补偿 500。
    expect(history.scrollTop).toBe(500);
    wrapper.unmount();
  });

  // ---- VC-R115：聊天未确认发送重试与下一条草稿分离 ----
  // 缺陷：POST 在途时用户写下的草稿 B 会被旧重试逻辑误当作重发文本——
  // 发 B 换新幂等键等于新发一条消息，而原提交 A 的结局仍未知。契约：
  // 页面持有「未确认原提交快照」，重试永远针对快照 A（同键）；草稿 B
  // 不替换、不清空；显式点发送提交 B 才是新意图、新键。

  it("VC-R115：未确认失败后重试只针对原提交 A（同键），草稿 B 保留且显式发送 B 是新键", async () => {
    const { calls, rejectGenerationPost } = stubFetch({
      deferGeneration: true,
      generations: ["reject", "reject"],
    });
    const wrapper = mountPage();
    await flushPromises();

    const input = wrapper.find('[data-testid="message-input"]');
    await input.setValue("原提交 A");
    await wrapper.find('[data-testid="send"]').trigger("click");
    await flushPromises();
    // 首个 POST /generations 在途：提交文本同步清空输入框。
    expect(generationPostBodies(calls)).toHaveLength(1);
    expect((input.element as HTMLTextAreaElement).value).toBe("");
    // 在途期间用户写下一条草稿 B（textarea 不禁用）。
    await input.setValue("草稿 B");

    // 首个 POST 网络失败（结果未知）：未确认错误出现，草稿 B 保留。
    rejectGenerationPost(new TypeError("fetch failed"));
    await flushPromises();
    expect(wrapper.find('[data-testid="chat-send-error"]').text()).toContain("没有确认发送结果，点此重试");
    expect((input.element as HTMLTextAreaElement).value).toBe("草稿 B");

    // 重试：针对原提交 A、复用同一幂等键；草稿 B 不被吞、不被清空。
    await wrapper.find('[data-testid="retry"]').trigger("click");
    await flushPromises();
    let posts = generationPostBodies(calls);
    expect(posts).toHaveLength(2);
    expect(posts[1]?.userContent).toBe("原提交 A");
    expect(posts[1]?.idempotencyKey).toBe(posts[0]?.idempotencyKey);
    expect((input.element as HTMLTextAreaElement).value).toBe("草稿 B");
    expect(wrapper.find('[data-testid="retry"]').text()).toBe("重试原消息");

    // 用户显式点发送提交草稿 B：新意图、新键，不复用 A 的键。
    await wrapper.find('[data-testid="send"]').trigger("click");
    await flushPromises();
    posts = generationPostBodies(calls);
    expect(posts).toHaveLength(3);
    expect(posts[2]?.userContent).toBe("草稿 B");
    expect(posts[2]?.idempotencyKey).not.toBe(posts[0]?.idempotencyKey);
    wrapper.unmount();
  });

  it("VC-R115：建会话失败的未确认提交重试原快照 A，不取残留 pending 也不吞草稿 B", async () => {
    let createFails = true;
    const { calls } = stubFetch({
      conversations: [],
      conversationCreateFails: () => createFails,
      generations: ["reject"],
    });
    const wrapper = mountPage();
    await flushPromises();

    // store 里更早一轮的残留待发内容——重试不得误取（直种先例见
    // seedLiveStreamState；store.send 从未执行，残留不会被本轮覆盖）。
    const store = useChatStore();
    store.pendingUserContent = "更早一轮的残留";

    const input = wrapper.find('[data-testid="message-input"]');
    await input.setValue("原提交 A");
    await wrapper.find('[data-testid="send"]').trigger("click");
    await flushPromises();

    // 建会话失败：从未发起 POST /generations；未确认错误出现，输入框回填 A。
    expect(generationPostBodies(calls)).toHaveLength(0);
    expect(wrapper.find('[data-testid="chat-send-error"]').text()).toContain("没有确认发送结果，点此重试");
    expect((input.element as HTMLTextAreaElement).value).toBe("原提交 A");

    // 用户把输入框改成新草稿 B；随后建会话恢复可用，再点重试。
    await input.setValue("草稿 B");
    createFails = false;
    await wrapper.find('[data-testid="retry"]').trigger("click");
    await flushPromises();

    // 重试：先建会话，再以原提交 A 发送（不是残留 pending，也不是草稿 B）。
    const createIndex = calls.findIndex(
      (call) => call.method === "POST" && call.url === "/api/v1/conversations",
    );
    const sendIndex = calls.findIndex(
      (call) => call.method === "POST" && /\/generations$/.test(call.url),
    );
    expect(createIndex).toBeGreaterThan(-1);
    expect(sendIndex).toBeGreaterThan(createIndex);
    const posts = generationPostBodies(calls);
    expect(posts).toHaveLength(1);
    expect(posts[0]?.userContent).toBe("原提交 A");
    expect((input.element as HTMLTextAreaElement).value).toBe("草稿 B");
    wrapper.unmount();
  });

  it("VC-R115：清空输入框不丢原提交的重试入口与内容", async () => {
    const { calls } = stubFetch({ generations: ["reject", "reject"] });
    const wrapper = mountPage();
    await flushPromises();

    const input = wrapper.find('[data-testid="message-input"]');
    await input.setValue("原提交 A");
    await wrapper.find('[data-testid="send"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="chat-send-error"]').text()).toContain("没有确认发送结果，点此重试");
    expect((input.element as HTMLTextAreaElement).value).toBe("原提交 A");

    // 用户清空输入框：原提交 A 的重试入口不得随之消失。
    await input.setValue("");
    expect(wrapper.find('[data-testid="retry"]').exists()).toBe(true);

    await wrapper.find('[data-testid="retry"]').trigger("click");
    await flushPromises();
    const posts = generationPostBodies(calls);
    expect(posts).toHaveLength(2);
    expect(posts[1]?.userContent).toBe("原提交 A");
    wrapper.unmount();
  });

  it("VC-R115：开始新对话清理旧提交——无错误无重试，旧 A 不可复活", async () => {
    const { calls } = stubFetch({ generations: ["reject", "reject"] });
    const wrapper = mountPage();
    await flushPromises();

    const input = wrapper.find('[data-testid="message-input"]');
    await input.setValue("原提交 A");
    await wrapper.find('[data-testid="send"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="chat-send-error"]').exists()).toBe(true);

    // 开始新对话：清空点必须同时清掉未确认提交快照。
    await wrapper.find('[data-testid="chat-context-open"]').trigger("click");
    await wrapper.find('[data-testid="new-conversation"]').trigger("click");
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-testid="chat-send-error"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="retry"]').exists()).toBe(false);

    // 新窗口的新草稿走全新提交：旧 A 不再被任何入口复活。
    await input.setValue("新窗口的新草稿");
    await wrapper.find('[data-testid="send"]').trigger("click");
    await flushPromises();
    const posts = generationPostBodies(calls);
    expect(posts).toHaveLength(2);
    expect(posts.map((post) => post.userContent)).toEqual(["原提交 A", "新窗口的新草稿"]);
    expect(posts[1]?.idempotencyKey).not.toBe(posts[0]?.idempotencyKey);
    wrapper.unmount();
  });
});
