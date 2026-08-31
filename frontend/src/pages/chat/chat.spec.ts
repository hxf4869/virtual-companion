// @vitest-environment happy-dom
// 聊天页组件胶水测试（纠偏式重写）。只测用户可见行为与稳定契约：
// 顶栏标识、发送/取消/重试、消息级操作、会话管理菜单、最小滚动行为
// （跟随/滚离/回底）、上下文提示与错误恢复。不测 preserve/follow/echo
// 等内部机制——那些机制已删除，也不再作为验收判据。
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ChatPage from "./chat.vue";
import { ChatHttpError } from "@/api/chat";
import { useAuthStore } from "@/stores/auth";
import { useChatStore } from "@/stores/chat";
import { useRelationshipStore } from "@/stores/relationship";

const ACTIVE_RELATIONSHIP = {
  relationshipId: 1,
  personaRef: "gentle-listener",
  active: true,
  createdAt: "2026-08-13T01:00:00Z",
};

/** Stub fetch to satisfy the mount-time relationship load + conversation list/create. */
function stubFetch(opts: { relationships?: unknown[]; conversationsJson?: unknown[] } = {}): void {
  const relationships = opts.relationships ?? [ACTIVE_RELATIONSHIP];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      if (url === "/api/v1/relationships") {
        return { ok: true, status: 200, json: async () => relationships };
      }
      if (url.includes("/messages")) {
        return { ok: true, status: 200, json: async () => [] };
      }
      if (url.startsWith("/api/v1/conversations") && method === "GET") {
        return { ok: true, status: 200, json: async () => opts.conversationsJson ?? [] };
      }
      if (url.startsWith("/api/v1/conversations")) {
        return { ok: true, status: 200, json: async () => ({ conversationId: 1 }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }),
  );
}

function mountPage() {
  return mount(ChatPage, { attachTo: document.body });
}

/** 消息级操作收进"更多"展开区：先展开再触发原 testid。 */
async function openMsgMenu(
  wrapper: ReturnType<typeof mountPage>,
  messageId: string,
): Promise<void> {
  const more = wrapper.find(`[data-testid="msg-more-${messageId}"]`);
  if (more.attributes("aria-expanded") !== "true") {
    await more.trigger("click");
  }
}

/** 低频管理动作全部收进"更多"菜单。 */
async function openMenu(wrapper: ReturnType<typeof mountPage>): Promise<void> {
  await wrapper.find('[data-testid="chat-context-open"]').trigger("click");
}

/** 等待一个合并写入 rAF（happy-dom 的 rAF 由定时器驱动）。 */
async function nextFrame(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

function controlAnimationFrames(): Map<number, FrameRequestCallback> {
  const frames = new Map<number, FrameRequestCallback>();
  let nextId = 1;
  vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => {
    const id = nextId++;
    frames.set(id, callback);
    return id;
  });
  vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation((id) => {
    frames.delete(id);
  });
  return frames;
}

function runNextControlledFrame(frames: Map<number, FrameRequestCallback>): void {
  const entry = frames.entries().next().value;
  expect(entry).toBeDefined();
  const [id, callback] = entry as [number, FrameRequestCallback];
  frames.delete(id);
  callback(0);
}

/** 用固定的几何属性驱动最小滚动状态机（happy-dom 无真实布局）。 */
function installScrollGeometry(el: Element, scrollHeight: number, clientHeight: number): void {
  Object.defineProperty(el, "scrollHeight", { configurable: true, value: scrollHeight });
  Object.defineProperty(el, "clientHeight", { configurable: true, value: clientHeight });
}

function historyElOf(wrapper: ReturnType<typeof mountPage>): HTMLElement {
  const el = wrapper.find('[data-testid="history"]').element as HTMLElement;
  expect(el).toBeTruthy();
  return el;
}

describe("chat page glue（纠偏式重写）", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("uni", undefined);
    stubFetch();
  });

  // ---- 顶栏与安全标识 ----

  it("states the AI-companion non-human disclosure in the header", async () => {
    stubFetch({ relationships: [] });
    const wrapper = mountPage();
    await flushPromises();

    const label = wrapper.find('[data-testid="chat-ai-label"]');
    expect(label.exists()).toBe(true);
    expect(label.text()).toContain("AI");
    expect(label.text()).toContain("非真人");
    wrapper.unmount();
  });

  it("shows the current companion name in the header after a relationship is active", async () => {
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[data-testid="chat-companion-name"]').text()).toContain("温和倾听者");
    wrapper.unmount();
  });

  it("CHAT-PRES: prefers the saved companion name in the header", async () => {
    stubFetch({
      relationships: [
        {
          ...ACTIVE_RELATIONSHIP,
          companionName: "小安",
          avatarRef: "AVATAR_FEMALE_01",
        },
      ],
    });
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[data-testid="chat-companion-name"]').text()).toContain("小安");
    expect(wrapper.find('[data-testid="chat-companion-name"]').text()).not.toContain("温和倾听者");
    wrapper.unmount();
  });

  // ---- 基础结构与状态区域 ----

  it("renders the message input and send button once a relationship is active", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const input = wrapper.find('[data-testid="message-input"]');
    expect(input.exists()).toBe(true);
    expect(input.attributes()).toHaveProperty("auto-height");
    expect(input.attributes()).not.toHaveProperty("rows");
    expect(wrapper.find('[data-testid="send"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("renders the status region with role=status and aria-live=polite", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const status = wrapper.find('[data-testid="status"]');
    expect(status.attributes("role")).toBe("status");
    expect(status.attributes("aria-live")).toBe("polite");
    wrapper.unmount();
  });

  it("shows friendly copy for the backend timeout fault code", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    store.phase = "failed";
    store.stream = {
      status: "terminal",
      epoch: 1,
      cursor: 1,
      events: [
        {
          eventSeq: 1,
          streamEpoch: 1,
          eventType: "chat.failed",
          payload: { fault: "external-timed_out" },
        },
      ],
      terminal: true,
      terminalEventType: "chat.failed",
    };
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="status"]').text()).toBe("模型响应超时");
    wrapper.unmount();
  });

  it("does not misreport a durable failed terminal as a network disconnect", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    store.phase = "failed";
    store.lastDisconnect = "terminal";
    store.stream = {
      status: "terminal",
      epoch: 1,
      cursor: 1,
      events: [{
        eventSeq: 1,
        streamEpoch: 1,
        eventType: "chat.failed",
        payload: null,
      }],
      terminal: true,
      terminalEventType: "chat.failed",
    };
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="status"]').text()).toBe(
      "模型服务失败，请稍后重试",
    );
    wrapper.unmount();
  });

  it("BLOCKED: states the safety refusal and a real-world help line, never a role voice", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    store.phase = "blocked";
    await wrapper.vm.$nextTick();

    const text = wrapper.find('[data-testid="status"]').text();
    expect(text).toContain("没有通过安全审查");
    expect(text).toContain("紧急危险");
    wrapper.unmount();
  });

  it("reloads committed history after a restored generation settles", async () => {
    stubFetch({
      conversationsJson: [
        {
          conversationId: 1,
          relationshipId: 1,
          lastMessagePreview: "恢复中的消息",
        },
      ],
    });
    const store = useChatStore();
    const restoreSpy = vi.spyOn(store, "tryRestoreAfterReload").mockResolvedValue(true);
    const historySpy = vi.spyOn(store, "loadHistory").mockResolvedValue();

    const wrapper = mountPage();
    await flushPromises();

    expect(restoreSpy).toHaveBeenCalledOnce();
    expect(historySpy).toHaveBeenCalledOnce();
    wrapper.unmount();
  });

  it("renders the empty-history hint on a fresh conversation", async () => {
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[data-testid="empty-history"]').exists()).toBe(true);
    wrapper.unmount();
  });

  // ---- 无关系分支 ----

  it("offers the unified companion-create entry when no relationship exists", async () => {
    stubFetch({ relationships: [] });
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[data-testid="chat-create-companion"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="chat-create-companion-go"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="message-input"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("shows the relationship selector with existing relationships when none is active", async () => {
    stubFetch({
      relationships: [
        { ...ACTIVE_RELATIONSHIP, relationshipId: 1, active: false },
        { ...ACTIVE_RELATIONSHIP, relationshipId: 2, active: false },
      ],
    });
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[data-testid="relationship-selector"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("REL-ACTIVATE: exposes a retryable error and keeps the current relationship when activation is hidden", async () => {
    stubFetch({
      relationships: [
        { ...ACTIVE_RELATIONSHIP, relationshipId: 1, active: false },
        { ...ACTIVE_RELATIONSHIP, relationshipId: 2, active: false },
      ],
    });
    const wrapper = mountPage();
    await flushPromises();

    const relStore = useRelationshipStore();
    const activateSpy = vi.spyOn(relStore, "activate").mockResolvedValue(null);
    const select = wrapper.find('[data-testid="relationship-select"]');

    await select.setValue("2");
    await flushPromises();

    expect(activateSpy).toHaveBeenCalledOnce();
    expect(relStore.currentRelationshipId).toBeNull();
    expect(wrapper.find('[data-testid="relationship-activate-error"]').text()).toContain(
      "切换伙伴失败，请重试",
    );
    expect((select.element as HTMLSelectElement).disabled).toBe(false);

    await wrapper.find('[data-testid="relationship-select"]').setValue("2");
    await flushPromises();
    expect(activateSpy).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  // ---- 发送 / 取消 / 重试 ----

  it("SEND: sends the typed text through the store and clears the input", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    store.conversationId = "1";
    const sendSpy = vi.spyOn(store, "send").mockResolvedValue();

    const input = wrapper.find('[data-testid="message-input"]');
    await input.setValue("今天有点累。");
    await wrapper.find('[data-testid="send"]').trigger("click");

    expect(sendSpy).toHaveBeenCalledOnce();
    const [transportArg, depsArg, textArg] = sendSpy.mock.calls[0] as unknown[];
    expect(textArg).toBe("今天有点累。");
    expect(transportArg).toBeTruthy();
    expect(depsArg).toBeTruthy();
    expect((wrapper.find('[data-testid="message-input"]').element as HTMLInputElement).value).toBe("");
    wrapper.unmount();
  });

  it("SEND: Enter submits and Shift+Enter does not", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    store.conversationId = "1";
    const sendSpy = vi.spyOn(store, "send").mockResolvedValue();

    const input = wrapper.find('[data-testid="message-input"]');
    await input.setValue("第一句");
    await input.trigger("keydown", { key: "Enter", shiftKey: false });
    expect(sendSpy).toHaveBeenCalledOnce();

    await input.setValue("第二句");
    await input.trigger("keydown", { key: "Enter", shiftKey: true });
    expect(sendSpy).toHaveBeenCalledOnce();
    wrapper.unmount();
  });

  it("SEND: the send button is disabled while streaming and cancel is offered", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    store.phase = "streaming";
    await wrapper.vm.$nextTick();

    expect((wrapper.find('[data-testid="send"]').element as HTMLButtonElement).disabled).toBe(true);
    expect(wrapper.find('[data-testid="cancel"]').exists()).toBe(true);

    store.phase = "idle";
    store.generationStarting = false;
    const input = wrapper.find('[data-testid="message-input"]');
    await input.setValue("准备发送");
    store.generationStarting = true;
    await wrapper.vm.$nextTick();
    expect((input.element as HTMLTextAreaElement).disabled).toBe(true);
    expect((wrapper.find('[data-testid="send"]').element as HTMLButtonElement).disabled).toBe(true);
    wrapper.unmount();
  });

  it("SEND: keeps the draft and shows a retryable error when the request never lands", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    store.conversationId = "1";
    vi.spyOn(store, "send").mockRejectedValue(new Error("transport down"));

    const input = wrapper.find('[data-testid="message-input"]');
    await input.setValue("这条不该丢");
    await wrapper.find('[data-testid="send"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="chat-send-error"]').exists()).toBe(true);
    expect((input.element as HTMLInputElement).value).toBe("这条不该丢");
    wrapper.unmount();
  });

  it("SEND: explains the adult-verification gate and offers the verification entry", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    store.conversationId = "1";
    vi.spyOn(store, "send").mockRejectedValue(
      new ChatHttpError(403, "client", "AGE_VERIFICATION_REQUIRED"),
    );

    const input = wrapper.find('[data-testid="message-input"]');
    await input.setValue("这条不该丢");
    await wrapper.find('[data-testid="send"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="chat-send-error"]').text()).toContain(
      "发送前需要先完成成年核验",
    );
    expect(wrapper.find('[data-testid="chat-age-required"]').text()).toContain(
      "去完成成年核验",
    );
    expect((input.element as HTMLInputElement).value).toBe("这条不该丢");
    wrapper.unmount();
  });

  it("RETRY: offers one-click retry of the last failed turn", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    store.phase = "failed";
    store.pendingUserContent = "重试这句话";
    await wrapper.vm.$nextTick();

    const retry = wrapper.find('[data-testid="retry"]');
    expect(retry.exists()).toBe(true);
    const sendSpy = vi.spyOn(store, "send").mockResolvedValue();
    store.generationStarting = true;
    await wrapper.vm.$nextTick();
    expect((retry.element as HTMLButtonElement).disabled).toBe(true);
    await retry.trigger("click");
    expect(sendSpy).not.toHaveBeenCalled();

    store.generationStarting = false;
    await wrapper.vm.$nextTick();
    await retry.trigger("click");
    expect(sendSpy).toHaveBeenCalledOnce();
    expect(sendSpy.mock.calls[0]?.[2]).toBe("重试这句话");
    wrapper.unmount();
  });

  // ---- 流式草稿与滚动 ----

  it("STREAM: renders exactly one streaming draft bubble while streaming", async () => {
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
    const texts = wrapper
      .findAll('[data-testid="chat-message"] [data-testid="assistant-md"], [data-testid="draft"]')
      .map((n) => n.text());
    expect(texts.join("|").split("我在听。").length - 1).toBe(1);
    wrapper.unmount();
  });

  it("SCROLL: starts following the latest and pins to the bottom on new content", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const el = historyElOf(wrapper);
    installScrollGeometry(el, 800, 400);
    el.scrollTop = 400;
    expect(wrapper.find('[data-testid="back-to-latest"]').exists()).toBe(false);

    const store = useChatStore();
    store.messages = [
      { messageId: "m1", conversationId: "1", role: "user", content: "第一条" },
    ];
    await wrapper.vm.$nextTick();
    await nextFrame();

    expect(el.scrollTop).toBe(800);
    wrapper.unmount();
  });

  it("SCROLL: real user input cancels a queued bottom frame, then following resumes at the tail", async () => {
    const wrapper = mountPage();
    await flushPromises();
    await nextFrame();

    const el = historyElOf(wrapper);
    installScrollGeometry(el, 2000, 400);
    el.scrollTop = 1600;
    const queuedFrames = controlAnimationFrames();

    const store = useChatStore();
    store.messages = [
      { messageId: "m1", conversationId: "1", role: "user", content: "第一条" },
    ];
    await wrapper.vm.$nextTick();
    expect(queuedFrames.size).toBe(1);

    // 帧排队后真实滚动输入先到，待执行帧被取消；随后的 scroll 只更新跟随意图。
    el.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -120 }));
    el.scrollTop = 300;
    el.dispatchEvent(new Event("scroll"));
    await wrapper.vm.$nextTick();
    expect(queuedFrames.size).toBe(0);
    expect(el.scrollTop).toBe(300);

    // 用户回到底部后，下一条消息仍应正常跟随。
    el.scrollTop = 1580;
    el.dispatchEvent(new Event("scroll"));
    await wrapper.vm.$nextTick();
    store.messages = [
      ...store.messages,
      { messageId: "m2", conversationId: "1", role: "assistant", content: "第二条" },
    ];
    await wrapper.vm.$nextTick();
    expect(queuedFrames.size).toBe(1);
    runNextControlledFrame(queuedFrames);
    expect(el.scrollTop).toBe(2000);
    wrapper.unmount();
  });

  it("SCROLL: a real scroll away stops following, keeps the reading spot and offers back-to-latest", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const el = historyElOf(wrapper);
    installScrollGeometry(el, 2000, 400);
    el.scrollTop = 1900;
    await nextFrame();

    // 用户向上滚动（真实 scroll 事件），远离底部。
    el.scrollTop = 300;
    el.dispatchEvent(new Event("scroll"));
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="back-to-latest"]').exists()).toBe(true);

    // 滚离后新内容到达不抢走阅读位置。
    const store = useChatStore();
    store.messages = [{ messageId: "m2", conversationId: "1", role: "user", content: "新消息" }];
    await wrapper.vm.$nextTick();
    await nextFrame();
    expect(el.scrollTop).toBe(300);

    // 点击"回到最新"恢复跟随并落底。
    await wrapper.find('[data-testid="back-to-latest"]').trigger("click");
    await nextFrame();
    expect(el.scrollTop).toBe(2000);
    expect(wrapper.find('[data-testid="back-to-latest"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("SCROLL: scrolling back near the bottom restores following without the button", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const el = historyElOf(wrapper);
    installScrollGeometry(el, 2000, 400);
    el.scrollTop = 1900;
    await nextFrame();

    el.scrollTop = 300;
    el.dispatchEvent(new Event("scroll"));
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-testid="back-to-latest"]').exists()).toBe(true);

    // 用户滚回底部附近（如 End 键产生的原生滚动）。
    el.scrollTop = 1580; // gap = 2000-400-1580 = 20 ≤ 48
    el.dispatchEvent(new Event("scroll"));
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-testid="back-to-latest"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("SCROLL: a late clamp after switching conversations cannot swallow the new tail frame", async () => {
    const wrapper = mountPage();
    await flushPromises();
    await nextFrame();

    const el = historyElOf(wrapper);
    installScrollGeometry(el, 2000, 400);
    el.scrollTop = 1600;
    const queuedFrames = controlAnimationFrames();

    const store = useChatStore();
    store.messages = [
      { messageId: "a1", conversationId: "1", role: "user", content: "旧会话" },
    ];
    await wrapper.vm.$nextTick();
    expect(queuedFrames.size).toBe(1);
    const [staleId, staleFrame] = queuedFrames.entries().next().value as [
      number,
      FrameRequestCallback,
    ];

    store.conversationId = "2";
    queuedFrames.delete(staleId);
    el.scrollTop = 321;
    staleFrame(0);
    expect(el.scrollTop).toBe(321);
    await wrapper.vm.$nextTick();

    store.messages = [{ messageId: "n1", conversationId: "2", role: "user", content: "新会话" }];
    await wrapper.vm.$nextTick();
    expect(queuedFrames.size).toBe(1);

    // A 清空后的迟到 clamp 没有用户输入前因；它可暂时翻转 following，
    // 但不能取消或吞掉已经登记给 B 的落底帧。
    el.scrollTop = 0;
    el.dispatchEvent(new Event("scroll"));
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-testid="back-to-latest"]').exists()).toBe(true);
    runNextControlledFrame(queuedFrames);
    await wrapper.vm.$nextTick();
    expect(el.scrollTop).toBe(2000);
    expect(wrapper.find('[data-testid="back-to-latest"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("SCROLL: a viewport resize re-pins once when following and leaves reading alone otherwise", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const el = historyElOf(wrapper);
    installScrollGeometry(el, 800, 400);
    el.scrollTop = 700;
    await nextFrame();

    window.dispatchEvent(new Event("resize"));
    await nextFrame();
    expect(el.scrollTop).toBe(800);

    // 滚离后 resize 不打扰阅读位置。
    el.scrollTop = 100;
    el.dispatchEvent(new Event("scroll"));
    await wrapper.vm.$nextTick();
    window.dispatchEvent(new Event("resize"));
    await nextFrame();
    expect(el.scrollTop).toBe(100);
    wrapper.unmount();
  });

  it("SCROLL: the history region is the only scroll area and carries no legacy diagnostics", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const el = historyElOf(wrapper);
    expect(el.getAttribute("tabindex")).toBe("0");
    expect(el.hasAttribute("data-following")).toBe(false);
    expect(el.hasAttribute("data-follow-run")).toBe(false);
    expect(el.hasAttribute("data-preserve-run")).toBe(false);
    expect(el.hasAttribute("data-preserve-phase")).toBe(false);
    expect(el.hasAttribute("data-preserve-mid")).toBe(false);
    expect(wrapper.find('[data-testid="virt-spacer-top"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="virt-spacer-bottom"]').exists()).toBe(false);
    wrapper.unmount();
  });

  // ---- 加载更多 ----

  it("CONV-HIST: offers manual load-more when the auto-advance cap left pages behind", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    store.historyHasMore = true;
    store.messages = [{ messageId: "m1", conversationId: "1", role: "user", content: "旧消息" }];
    await wrapper.vm.$nextTick();

    const more = wrapper.find('[data-testid="load-more"]');
    expect(more.exists()).toBe(true);
    const spy = vi.spyOn(store, "loadMoreHistory").mockResolvedValue();
    await more.trigger("click");
    expect(spy).toHaveBeenCalledOnce();
    wrapper.unmount();
  });

  // ---- 消息级操作 ----

  function seedMessages(store: ReturnType<typeof useChatStore>): void {
    store.messages = [
      { messageId: "u1", conversationId: "1", role: "user", content: "用户消息" },
      {
        messageId: "a1",
        conversationId: "1",
        role: "assistant",
        content: "我在听。**重点**在这里。",
      },
    ];
  }

  it("renders user and assistant messages with a safe markdown subset", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    seedMessages(store);
    await wrapper.vm.$nextTick();

    const rows = wrapper.findAll('[data-testid="chat-message"]');
    expect(rows).toHaveLength(2);
    expect(wrapper.find('[data-testid="assistant-md"]').text()).toContain("重点");
    wrapper.unmount();
  });

  it("MSG-COPY: copies assistant text and carries the AI-content notice", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...globalThis.navigator, clipboard: { writeText } });
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    seedMessages(store);
    await wrapper.vm.$nextTick();
    await openMsgMenu(wrapper, "a1");
    await wrapper.find('[data-testid="msg-copy-a1"]').trigger("click");
    await flushPromises();

    expect(writeText).toHaveBeenCalledWith("我在听。**重点**在这里。");
    expect(wrapper.find('[data-testid="msg-copy-a1"]').text()).toContain("已复制 · AI 生成");
    wrapper.unmount();
  });

  it("MEM-NEG: flips the 不记住 marker of a user message through the store", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    seedMessages(store);
    await wrapper.vm.$nextTick();
    await openMsgMenu(wrapper, "u1");

    const spy = vi
      .spyOn(store, "setMessageNoMemory")
      .mockResolvedValue(true);
    await wrapper.find('[data-testid="msg-no-memory-u1"]').trigger("click");
    expect(spy).toHaveBeenCalledWith(expect.anything(), "u1", true);
    wrapper.unmount();
  });

  it("MSG-DELETE: requires a two-step confirm before the DELETE", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    seedMessages(store);
    await wrapper.vm.$nextTick();
    await openMsgMenu(wrapper, "u1");

    const spy = vi.spyOn(store, "removeMessage").mockResolvedValue(true);
    await wrapper.find('[data-testid="msg-delete-u1"]').trigger("click");
    expect(spy).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="msg-delete-u1"]').text()).toContain("确认删除");

    await wrapper.find('[data-testid="msg-delete-u1"]').trigger("click");
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0]?.[1]).toBe("u1");
    wrapper.unmount();
  });

  it("MSG-DELETE single-flight: repeated confirmation during an in-flight DELETE issues no second request", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    seedMessages(store);
    await wrapper.vm.$nextTick();
    await openMsgMenu(wrapper, "u1");

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const spy = vi.fn(() => gate.then(() => true));
    vi.spyOn(store, "removeMessage").mockImplementation(spy);

    await wrapper.find('[data-testid="msg-delete-u1"]').trigger("click"); // arm
    await wrapper.find('[data-testid="msg-delete-u1"]').trigger("click"); // confirm → in-flight
    await flushPromises();
    await wrapper.find('[data-testid="msg-delete-u1"]').trigger("click"); // repeat during flight
    expect(spy).toHaveBeenCalledTimes(1);

    release();
    await flushPromises();
    wrapper.unmount();
  });

  it("MSG-REPORT: explains the human queue and deep-links the report page", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    seedMessages(store);
    await wrapper.vm.$nextTick();
    await openMsgMenu(wrapper, "a1");
    await wrapper.find('[data-testid="msg-report-a1"]').trigger("click");

    const notice = wrapper.find('[data-testid="msg-report-notice-a1"]');
    expect(notice.exists()).toBe(true);
    expect(notice.text()).toContain("人工处理队列");
    expect(wrapper.find('[data-testid="msg-report-open-page"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("GEN-VER: offers regenerate on the last user message after a completed turn", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    seedMessages(store);
    store.phase = "completed";
    await wrapper.vm.$nextTick();
    await openMsgMenu(wrapper, "u1");

    const regen = wrapper.find('[data-testid="regenerate"]');
    expect(regen.exists()).toBe(true);
    const spy = vi.spyOn(store, "regenerate").mockResolvedValue();
    store.generationStarting = true;
    await wrapper.vm.$nextTick();
    expect((regen.element as HTMLButtonElement).disabled).toBe(true);
    await regen.trigger("click");
    expect(spy).not.toHaveBeenCalled();

    store.generationStarting = false;
    await wrapper.vm.$nextTick();
    await regen.trigger("click");
    expect(spy).toHaveBeenCalledOnce();
    wrapper.unmount();
  });

  // ---- 更多菜单：会话管理与模式 ----

  it("MENU: keeps conversation switching, create and the incognito toggle in one sheet", async () => {
    stubFetch({
      conversationsJson: [
        { conversationId: 1, relationshipId: 1, lastMessagePreview: "旧" },
        { conversationId: 2, relationshipId: 1, lastMessagePreview: "新", incognito: true },
      ],
    });
    const wrapper = mountPage();
    await flushPromises();

    await openMenu(wrapper);
    expect(wrapper.find('[data-testid="conversation-panel"]').exists()).toBe(true);
    const items = wrapper.findAll('[data-testid="conversation-item"]');
    expect(items.length).toBe(2);
    expect(items[1]?.text()).toContain("无痕");

    const store = useChatStore();
    const openSpy = vi.spyOn(store, "openConversation").mockResolvedValue(true);
    await items[1]!.trigger("click");
    expect(openSpy).toHaveBeenCalledOnce();
    expect(wrapper.find('[data-testid="conversation-panel"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("MENU: keeps the sheet open and explains when a conversation cannot load", async () => {
    stubFetch({
      conversationsJson: [
        { conversationId: 1, relationshipId: 1, lastMessagePreview: "旧" },
        { conversationId: 2, relationshipId: 1, lastMessagePreview: "新" },
      ],
    });
    const wrapper = mountPage();
    await flushPromises();
    await openMenu(wrapper);

    const store = useChatStore();
    vi.spyOn(store, "openConversation").mockResolvedValue(false);
    await wrapper.findAll('[data-testid="conversation-item"]')[1]!.trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="conversation-panel"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="conversation-open-error"]').text()).toContain(
      "会话加载失败",
    );
    wrapper.unmount();
  });

  it("CHAT-MODE: the four approved modes are selectable in the menu", async () => {
    const wrapper = mountPage();
    await flushPromises();

    await openMenu(wrapper);
    const row = wrapper.find('[data-testid="mode-row"]');
    expect(row.exists()).toBe(true);
    for (const mode of ["auto", "listen", "discuss", "casual"]) {
      expect(wrapper.find(`button[data-testid="mode-${mode}"]`).exists()).toBe(true);
    }

    expect(wrapper.find('button[data-testid="mode-auto"]').attributes("aria-pressed")).toBe("true");
    await wrapper.find('button[data-testid="mode-discuss"]').trigger("click");
    expect(wrapper.find('button[data-testid="mode-discuss"]').attributes("aria-pressed")).toBe("true");
    const store = useChatStore();
    expect(store.selectedMode).toBe("DISCUSS");
    wrapper.unmount();
  });

  it("CONV-MGMT: rename round-trip through the menu", async () => {
    stubFetch({
      conversationsJson: [
        { conversationId: 1, relationshipId: 1, title: "睡前聊天" },
      ],
    });
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    await openMenu(wrapper);
    await wrapper.find('[data-testid="conversation-rename"]').trigger("click");
    await wrapper.vm.$nextTick();

    const row = wrapper.find('[data-testid="rename-row"]');
    expect(row.exists()).toBe(true);
    expect((wrapper.find('[data-testid="rename-input"]').element as HTMLInputElement).value).toBe(
      "睡前聊天",
    );

    const renameSpy = vi
      .spyOn(store, "renameConversation")
      .mockResolvedValue(true);
    await wrapper.find('[data-testid="rename-input"]').setValue("晚安时间");
    await wrapper.find('[data-testid="rename-apply"]').trigger("click");
    await flushPromises();
    expect(renameSpy).toHaveBeenCalledOnce();
    expect(renameSpy.mock.calls[0]?.[2]).toBe("晚安时间");
    wrapper.unmount();
  });

  it("CONV-MGMT: rename never prefills an unreadable ciphertext title", async () => {
    stubFetch({
      conversationsJson: [
        { conversationId: 1, relationshipId: 1, title: "enc2:AAAAAAAAAAAAAAAAAAAAAAAAAAAA" },
      ],
    });
    const wrapper = mountPage();
    await flushPromises();

    await openMenu(wrapper);
    await wrapper.find('[data-testid="conversation-rename"]').trigger("click");
    await wrapper.vm.$nextTick();

    expect((wrapper.find('[data-testid="rename-input"]').element as HTMLInputElement).value).toBe("");
    wrapper.unmount();
  });

  it("END-TODAY: ends only after the two-step confirm", async () => {
    stubFetch({
      conversationsJson: [{ conversationId: 1, relationshipId: 1 }],
    });
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    const endSpy = vi.spyOn(store, "endToday").mockResolvedValue(true);
    await openMenu(wrapper);

    await wrapper.find('[data-testid="end-today"]').trigger("click");
    expect(endSpy).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="end-today"]').text()).toContain("确认结束");

    await wrapper.find('[data-testid="end-today"]').trigger("click");
    expect(endSpy).toHaveBeenCalledOnce();
    wrapper.unmount();
  });

  it("CONV-DELETE: deletes the open conversation only after the two-step confirm", async () => {
    stubFetch({
      conversationsJson: [{ conversationId: 1, relationshipId: 1 }],
    });
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    const deleteSpy = vi.spyOn(store, "removeConversation").mockResolvedValue(true);
    await openMenu(wrapper);

    await wrapper.find('[data-testid="conversation-delete"]').trigger("click");
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="conversation-delete"]').text()).toContain("确认删除");

    await wrapper.find('[data-testid="conversation-delete"]').trigger("click");
    expect(deleteSpy).toHaveBeenCalledOnce();
    wrapper.unmount();
  });

  it("NEW-CONV: creates a fresh conversation with the current incognito choice", async () => {
    stubFetch({
      conversationsJson: [{ conversationId: 1, relationshipId: 1 }],
    });
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    const initSpy = vi
      .spyOn(store, "initConversation")
      .mockResolvedValue({ conversationId: 9 } as never);
    await openMenu(wrapper);
    await wrapper.find('[data-testid="incognito-toggle"]').trigger("click");
    await wrapper.find('[data-testid="new-conversation"]').trigger("click");
    await flushPromises();

    expect(initSpy).toHaveBeenCalledOnce();
    expect(initSpy.mock.calls[0]?.[2]).toBe(true);
    wrapper.unmount();
  });

  // ---- 上下文提示与恢复 ----

  it("does not expose deferred usage-health controls", async () => {
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.find('[data-testid="usage-health-banner"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="usage-health-continue"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("SVC-MODE: surfaces a non-normal service mode as a dismissible hint", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    store.serviceMode = { mode: "ZERO_LLM", summary: "当前以确定性回复运行" };
    await wrapper.vm.$nextTick();

    const hint = wrapper.find('[data-testid="service-mode-hint"]');
    expect(hint.exists()).toBe(true);
    expect(hint.text()).toContain("确定性回复");

    await wrapper.find('[data-testid="service-mode-hint"] button').trigger("click");
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-testid="service-mode-hint"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("SVC-MODE: stays quiet when the service is normal", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    store.serviceMode = { mode: "FULL_AI", summary: "一切正常" };
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-testid="service-mode-hint"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("does not load or show deferred memory imports", async () => {
    const relStore = useRelationshipStore();
    const listSpy = vi.spyOn(relStore, "listMemoryImports");
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[data-testid="memory-import-prompt"]').exists()).toBe(false);
    expect(listSpy).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("MEM-PROMPT: surfaces pending memory candidates with a link", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    store.pendingMemoryCount = 3;
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="memory-prompt"]').text()).toContain("3 条");
    expect(wrapper.find('[data-testid="memory-prompt-link"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("USAGE-VIZ: shows the settled token usage of the last completed turn", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    store.usage = { inputTokens: 12, outputTokens: 34 };
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="usage"]').text()).toContain("12");
    expect(wrapper.find('[data-testid="usage"]').text()).toContain("34");
    wrapper.unmount();
  });

  it("FEEDBACK: shows the five feedback chips after a completed turn and submits one", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    store.phase = "idle";
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-testid="feedback-row"]').exists()).toBe(false);

    store.phase = "completed";
    await wrapper.vm.$nextTick();
    const row = wrapper.find('[data-testid="feedback-row"]');
    expect(row.exists()).toBe(true);
    for (const kind of ["TOO_MECHANICAL", "FORGOT_CONTEXT", "CROSSED_BOUNDARY", "FACTUAL_ERROR", "UNSAFE"]) {
      expect(wrapper.find(`[data-testid="feedback-${kind}"]`).exists()).toBe(true);
    }

    const spy = vi.spyOn(store, "sendFeedback").mockResolvedValue(true);
    await wrapper.find('[data-testid="feedback-TOO_MECHANICAL"]').trigger("click");
    expect(spy).toHaveBeenCalledOnce();
    wrapper.unmount();
  });

  it("shows the init error with the request id when initialization fails", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const vm = wrapper.vm as unknown as { initError: boolean; initRequestId: string };
    vm.initError = true;
    vm.initRequestId = "req-123";
    await wrapper.vm.$nextTick();

    const error = wrapper.find('[data-testid="chat-init-error"]');
    expect(error.exists()).toBe(true);
    expect(error.text()).toContain("初始化失败");
    expect(error.text()).toContain("req-123");
    wrapper.unmount();
  });

  it("REL-DEACT: deactivates the relationship only after the two-step confirm", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const relStore = useRelationshipStore();
    relStore.currentRelationshipId = "1";
    const spy = vi.spyOn(relStore, "deactivate").mockResolvedValue(null);
    await openMenu(wrapper);

    await wrapper.find('[data-testid="chat-deactivate"]').trigger("click");
    expect(spy).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="chat-deactivate"]').text()).toContain("确认停用");

    await wrapper.find('[data-testid="chat-deactivate"]').trigger("click");
    expect(spy).toHaveBeenCalledOnce();
    wrapper.unmount();
  });

  it("MENU: offers logout for an authenticated session and login otherwise", async () => {
    stubFetch({ relationships: [] });
    const auth = useAuthStore();
    auth.accessToken = "a-token";
    const wrapper = mountPage();
    await flushPromises();

    await openMenu(wrapper);
    expect(wrapper.find('[data-testid="logout"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="nav-login"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
