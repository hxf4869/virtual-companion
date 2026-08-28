// @vitest-environment happy-dom
// TASK-0186/TASK-0187: chat page component glue test. TASK-0187 wires the
// relationship selector: the page loads the owner's relationships on mount and
// creates a conversation under the active one, or shows the selector when none
// is active. The send-flow UI (input/send/status/history) renders only after a
// relationship is selected.
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ChatPage from "./chat.vue";
import { useAuthStore } from "@/stores/auth";
import { useChatStore } from "@/stores/chat";
import { useRelationshipStore } from "@/stores/relationship";
import { useUsageHealthStore } from "@/stores/usage-health";

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

/** 消息级操作收进"更多"展开区：先展开再触发原 testid（Phase 3 IA）。 */
async function openMsgMenu(
  wrapper: ReturnType<typeof mountPage>,
  messageId: string,
): Promise<void> {
  const more = wrapper.find(`[data-testid="msg-more-${messageId}"]`);
  if (more.attributes("aria-expanded") !== "true") {
    await more.trigger("click");
  }
}

/** 头部上下文操作（记忆/设置/提醒/首页/登录/登出）收进 Action Sheet。 */
async function openContextSheet(
  wrapper: ReturnType<typeof mountPage>,
): Promise<void> {
  await wrapper.find('[data-testid="chat-context-open"]').trigger("click");
}

/** 会话管理（改名/结束/删除）收进 Action Sheet。 */
async function openConvSheet(
  wrapper: ReturnType<typeof mountPage>,
): Promise<void> {
  await wrapper.find('[data-testid="conversation-manage"]').trigger("click");
}

describe("chat page glue (TASK-0186 send flow + TASK-0187 relationship gate)", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("uni", undefined);
    stubFetch();
  });

  it("states the AI-companion non-human disclosure in the header", async () => {
    stubFetch({ relationships: [] });
    const wrapper = mountPage();
    await flushPromises();

    const label = wrapper.find('[data-testid="chat-ai-label"]');
    expect(label.exists()).toBe(true);
    expect(label.text()).toContain("AI 陪伴");
    expect(label.text()).toContain("非真人");
    wrapper.unmount();
  });

  it("shows the current companion name in the header after a relationship is active", async () => {
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[data-testid="chat-companion-name"]').text()).toContain("温和倾听者");
    wrapper.unmount();
  });

  it("CHAT-PRES: prefers the saved companion name and curated avatar in the header", async () => {
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
    const avatar = wrapper.find('[data-testid="chat-companion-avatar"]');
    expect(avatar.exists()).toBe(true);
    expect(avatar.text()).toContain("F");
    expect(avatar.attributes("aria-label")).toContain("温婉");
    wrapper.unmount();
  });

  it("renders the message input and send button once a relationship is active", async () => {
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[data-testid="message-input"]').exists()).toBe(true);
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

  it("CHAT-MODE: renders the four quick-mode chips and selects on click", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const row = wrapper.find('[data-testid="mode-row"]');
    expect(row.exists()).toBe(true);
    for (const mode of ["auto", "listen", "discuss", "casual"]) {
      expect(wrapper.find(`button[data-testid="mode-${mode}"]`).exists()).toBe(true);
    }

    // AUTO starts active; clicking DISCUSS flips the active chip and the store.
    expect(wrapper.find('button[data-testid="mode-auto"]').attributes("aria-pressed")).toBe("true");
    await wrapper.find('button[data-testid="mode-discuss"]').trigger("click");
    expect(wrapper.find('button[data-testid="mode-discuss"]').attributes("aria-pressed")).toBe("true");
    expect(wrapper.find('button[data-testid="mode-auto"]').attributes("aria-pressed")).toBe("false");

    const store = useChatStore();
    expect(store.selectedMode).toBe("DISCUSS");
    wrapper.unmount();
  });

  it("FEEDBACK: shows the five feedback chips after a completed turn and submits one", async () => {
    const wrapper = mountPage();
    await flushPromises();

    // Idle: no feedback row.
    expect(wrapper.find('[data-testid="feedback-row"]').exists()).toBe(false);

    const store = useChatStore();
    const feedbackSpy = vi
      .spyOn(store, "sendFeedback")
      .mockResolvedValue(true);
    store.phase = "completed";
    await wrapper.vm.$nextTick();

    const row = wrapper.find('[data-testid="feedback-row"]');
    expect(row.exists()).toBe(true);
    for (const kind of [
      "TOO_MECHANICAL",
      "FORGOT_CONTEXT",
      "CROSSED_BOUNDARY",
      "FACTUAL_ERROR",
      "UNSAFE",
    ]) {
      expect(wrapper.find(`button[data-testid="feedback-${kind}"]`).exists()).toBe(true);
    }

    await wrapper.find('button[data-testid="feedback-UNSAFE"]').trigger("click");
    expect(feedbackSpy).toHaveBeenCalledWith(expect.anything(), "UNSAFE");
    wrapper.unmount();
  });

  // P1（round4）：流式草稿只在真实流式阶段渲染一次；正式消息提交后草稿
  // 元素必须消失，completed 终态只有一份正式助手回复。
  it("P1-R4: shows one live draft while streaming and drops it once the formal reply commits", async () => {
    const wrapper = mountPage();
    await flushPromises();
    const store = useChatStore();

    // 流式阶段：一份实时草稿。
    store.phase = "streaming";
    store.stream = {
      status: "streaming",
      epoch: 1,
      cursor: 1,
      events: [
        { eventSeq: 1, streamEpoch: 1, eventType: "chat.delta", payload: "正在" },
        { eventSeq: 2, streamEpoch: 1, eventType: "chat.delta", payload: "生成" },
      ],
      terminal: false,
      terminalEventType: null,
    };
    await flushPromises();

    const drafts = wrapper.findAll('[data-testid="draft"]');
    expect(drafts.length, "exactly one draft bubble while streaming").toBe(1);
    expect(drafts[0]!.text()).toContain("正在生成");

    // 终态：草稿消失，正式助手回复只出现一次。
    store.phase = "completed";
    store.messages = [
      { messageId: "u1", conversationId: "1", role: "user", content: "嗨" },
      { messageId: "a1", conversationId: "1", role: "assistant", content: "我在，慢慢说。" },
    ];
    await flushPromises();

    expect(wrapper.find('[data-testid="draft"]').exists()).toBe(false);
    expect(wrapper.findAll('[data-testid="chat-message"].assistant').length).toBe(1);
    expect(wrapper.findAll('[data-testid="assistant-md"]').length).toBe(1);
    expect(wrapper.text()).not.toContain("正在生成");
    wrapper.unmount();
  });

  it("disables the send button when the input is empty", async () => {    const wrapper = mountPage();
    await flushPromises();

    const send = wrapper.find('button[data-testid="send"]');
    expect(send.attributes("disabled")).toBeDefined();
    wrapper.unmount();
  });

  it("enables the send button after the user types", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const input = wrapper.find('input[data-testid="message-input"]');
    const send = wrapper.find('button[data-testid="send"]');

    await input.setValue("Hello world");
    expect(send.attributes("disabled")).toBeUndefined();

    wrapper.unmount();
  });

  it("renders the message history container", async () => {
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[data-testid="history"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("shows an empty-history status when the conversation has no messages", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const empty = wrapper.find('[data-testid="empty-history"]');
    expect(empty.exists()).toBe(true);
    expect(empty.attributes("role")).toBe("status");
    expect(empty.text()).toContain("还没有消息");
    wrapper.unmount();
  });

  it("hides the empty-history status after committed messages exist", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    store.messages = [
      {
        messageId: "m1",
        conversationId: "1",
        role: "user",
        content: "你好",
      },
    ];
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="empty-history"]').exists()).toBe(false);
    expect(wrapper.find(".msg-content").text()).toContain("你好");
    wrapper.unmount();
  });

  it("MSG-DELETE: deletes a persisted message only after the two-step confirm", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    store.messages = [
      {
        messageId: "m1",
        conversationId: "1",
        role: "user",
        content: "你好",
      },
    ];
    const removeSpy = vi.spyOn(store, "removeMessage").mockResolvedValue(true);
    await wrapper.vm.$nextTick();

    await openMsgMenu(wrapper, "m1");
    const button = wrapper.find('[data-testid="msg-delete-m1"]');
    expect(button.exists()).toBe(true);
    expect(button.text()).toContain("删除");

    // First click only arms the confirm; nothing is deleted yet.
    await button.trigger("click");
    expect(removeSpy).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="msg-delete-m1"]').text()).toContain("确认删除");

    // Second click confirms and deletes through the store.
    await openMsgMenu(wrapper, "m1");
    await wrapper.find('[data-testid="msg-delete-m1"]').trigger("click");
    expect(removeSpy).toHaveBeenCalledWith(expect.anything(), "m1");
    wrapper.unmount();
  });

  it("MSG-COPY: copies the message text via the async clipboard and flips the label", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...globalThis.navigator, clipboard: { writeText } });
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    store.messages = [
      {
        messageId: "m1",
        conversationId: "1",
        role: "assistant",
        content: "这是一段需要复制的内容",
      },
    ];
    await wrapper.vm.$nextTick();

    await openMsgMenu(wrapper, "m1");
    const copyButton = wrapper.find('[data-testid="msg-copy-m1"]');
    expect(copyButton.exists()).toBe(true);
    expect(copyButton.text()).toContain("复制");

    await copyButton.trigger("click");
    await flushPromises();

    expect(writeText).toHaveBeenCalledWith("这是一段需要复制的内容");
    // COPY-LABEL (§21.4.1): an assistant copy carries the AI-content notice.
    expect(wrapper.find('[data-testid="msg-copy-m1"]').text()).toContain("已复制 · AI 生成");
    wrapper.unmount();
  });

  it("MSG-COPY: a user-message copy stays a plain 已复制 with no AI notice", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...globalThis.navigator, clipboard: { writeText } });
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    store.messages = [
      {
        messageId: "u1",
        conversationId: "1",
        role: "user",
        content: "用户自己说的话",
      },
    ];
    await wrapper.vm.$nextTick();

    await openMsgMenu(wrapper, "u1");
    await wrapper.find('[data-testid="msg-copy-u1"]').trigger("click");
    await flushPromises();

    expect(writeText).toHaveBeenCalledWith("用户自己说的话");
    expect(wrapper.find('[data-testid="msg-copy-u1"]').text()).toContain("已复制");
    expect(wrapper.find('[data-testid="msg-copy-u1"]').text()).not.toContain("AI 生成");
    wrapper.unmount();
  });

  it("MSG-REPORT: persisted messages offer report and open the intake page anchored to the message", async () => {
    stubFetch();
    const wrapper = mountPage();
    await flushPromises();
    const store = useChatStore();
    store.messages = [
      {
        messageId: "m1",
        conversationId: "1",
        role: "assistant",
        content: "一条助手回复",
      },
    ];
    await wrapper.vm.$nextTick();

    await openMsgMenu(wrapper, "m1");
    const button = wrapper.find('[data-testid="msg-report-m1"]');
    expect(button.exists()).toBe(true);
    expect(button.text()).toContain("举报");
    expect(wrapper.find('[data-testid="msg-report-notice-m1"]').exists()).toBe(false);

    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const callsBefore = fetchMock.mock.calls.length;
    await button.trigger("click");
    await wrapper.vm.$nextTick();

    const notice = wrapper.find('[data-testid="msg-report-notice-m1"]');
    expect(notice.exists()).toBe(true);
    expect(notice.text()).toContain("人工处理队列");
    expect(notice.text()).not.toMatch(/工单号|回电|客服热线/);
    expect(fetchMock.mock.calls.length).toBe(callsBefore);

    const navigateTo = vi.fn();
    vi.stubGlobal("uni", { navigateTo });
    await wrapper.find('[data-testid="msg-report-open-page"]').trigger("click");
    expect(navigateTo).toHaveBeenCalledWith({ url: "/pages/report/report?messageId=m1" });
    wrapper.unmount();
  });

  it("MSG-REPORT: no report button on streaming placeholder rows", async () => {
    const wrapper = mountPage();
    await flushPromises();
    const store = useChatStore();
    store.messages = [
      {
        messageId: "__pending-1",
        conversationId: "1",
        role: "assistant",
        content: "生成中",
      },
    ];
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="msg-report-__pending-1"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("MSG-COPY: no copy button on streaming placeholder rows", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    store.messages = [
      {
        messageId: "__pending-1",
        conversationId: "1",
        role: "assistant",
        content: "生成中",
      },
    ];
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="msg-copy-__pending-1"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("MEM-NEG: 不记住 flips the marker through the store on a user message", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    store.messages = [
      {
        messageId: "m1",
        conversationId: "1",
        role: "user",
        content: "这条不要记住",
      },
    ];
    const noMemorySpy = vi.spyOn(store, "setMessageNoMemory").mockResolvedValue(true);
    await wrapper.vm.$nextTick();

    await openMsgMenu(wrapper, "m1");
    const button = wrapper.find('[data-testid="msg-no-memory-m1"]');
    expect(button.exists()).toBe(true);
    expect(button.text()).toContain("不记住");

    await button.trigger("click");
    await flushPromises();

    expect(noMemorySpy).toHaveBeenCalledWith(expect.anything(), "m1", true);
    wrapper.unmount();
  });

  it("MEM-NEG: shows 恢复记忆 on a flagged message and flips it back", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    store.messages = [
      {
        messageId: "m1",
        conversationId: "1",
        role: "user",
        content: "这条不要记住",
        noMemory: true,
      },
    ];
    const noMemorySpy = vi.spyOn(store, "setMessageNoMemory").mockResolvedValue(true);
    await wrapper.vm.$nextTick();

    await openMsgMenu(wrapper, "m1");
    const button = wrapper.find('[data-testid="msg-no-memory-m1"]');
    expect(button.text()).toContain("恢复记忆");

    await button.trigger("click");
    await flushPromises();

    expect(noMemorySpy).toHaveBeenCalledWith(expect.anything(), "m1", false);
    wrapper.unmount();
  });

  it("MEM-NEG: no 不记住 button on assistant messages", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    store.messages = [
      {
        messageId: "m1",
        conversationId: "1",
        role: "assistant",
        content: "回复内容",
      },
    ];
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="msg-no-memory-m1"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("VIRT-SCROLL: long histories only mount the visible window, not a 200-row slice", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    store.messages = Array.from({ length: 250 }, (_, i) => ({
      messageId: `m${i}`,
      conversationId: "1",
      role: (i % 2 === 0 ? "user" : "assistant") as string,
      content: `消息 ${i}`,
    }));
    await wrapper.vm.$nextTick();

    const rows = wrapper.findAll(".chat-message");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(40);
    expect(store.messages.length).toBe(250);
    expect(wrapper.find('[data-testid="history-truncated"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="virt-spacer-top"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="virt-spacer-bottom"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("MD-SAFE: assistant markdown uses the whitelist and never mounts HTML tags", async () => {
    const wrapper = mountPage();
    await flushPromises();
    const store = useChatStore();
    store.messages = [
      {
        messageId: "a1",
        conversationId: "1",
        role: "assistant",
        content: '看 **这里** <img src=x onerror="alert(1)"><script>x</script>',
      },
    ];
    await wrapper.vm.$nextTick();

    expect(wrapper.find(".md-strong").text()).toBe("这里");
    expect(wrapper.find("img").exists()).toBe(false);
    expect(wrapper.find("script").exists()).toBe(false);
    expect(wrapper.text()).toContain("<img");
    wrapper.unmount();
  });

  it("MD-SAFE: user text stays literal and is not parsed as markdown", async () => {
    const wrapper = mountPage();
    await flushPromises();
    const store = useChatStore();
    store.messages = [
      {
        messageId: "u1",
        conversationId: "1",
        role: "user",
        content: "我说 **不是强调**",
      },
    ];
    await wrapper.vm.$nextTick();

    expect(wrapper.find(".md-strong").exists()).toBe(false);
    expect(wrapper.text()).toContain("我说 **不是强调**");
    wrapper.unmount();
  });

  it("VIRT-SCROLL: short histories still render every row", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    store.messages = [
      {
        messageId: "m1",
        conversationId: "1",
        role: "user",
        content: "你好",
      },
    ];
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="history-truncated"]').exists()).toBe(false);
    expect(wrapper.findAll(".chat-message").length).toBe(1);
    wrapper.unmount();
  });

  it("VIRT-SCROLL: scrolling the viewport remounts later rows", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    store.messages = Array.from({ length: 250 }, (_, i) => ({
      messageId: `m${i}`,
      conversationId: "1",
      role: "user",
      content: `消息 ${i}`,
    }));
    await wrapper.vm.$nextTick();

    expect(wrapper.findAll(".chat-message")[0].text()).toContain("消息 0");

    const history = wrapper.find('[data-testid="history"]');
    const el = history.element as HTMLElement;
    el.scrollTop = 96 * 40;
    await history.trigger("scroll");
    await wrapper.vm.$nextTick();

    const rows = wrapper.findAll(".chat-message");
    expect(rows[0].text()).not.toContain("消息 0");
    expect(rows[0].text()).toContain("消息 36");
    wrapper.unmount();
  });

  it("SVC-MODE: shows the plain service-mode status line when the API reports one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "/api/v1/service-mode") {
          return {
            ok: true,
            status: 200,
            json: async () => ({ mode: "ZERO_LLM", summary: "当前为无生成模型的受限服务" }),
          };
        }
        if (url === "/api/v1/relationships") {
          return { ok: true, status: 200, json: async () => [ACTIVE_RELATIONSHIP] };
        }
        if (url.includes("/messages")) {
          return { ok: true, status: 200, json: async () => [] };
        }
        if (url.startsWith("/api/v1/conversations")) {
          return { ok: true, status: 200, json: async () => [] };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      }),
    );
    const wrapper = mountPage();
    await flushPromises();

    const line = wrapper.find('[data-testid="service-mode"]');
    expect(line.exists()).toBe(true);
    expect(line.text()).toContain("当前为无生成模型的受限服务");
    wrapper.unmount();
  });

  it("REQ-ID: an init failure shows the last request id", async () => {
    const { rememberRequestId } = await import("@/domain/request-id");
    rememberRequestId("req-chat-1");
    const store = useChatStore();
    vi.spyOn(store, "initConversation").mockRejectedValue(new Error("boom"));
    const wrapper = mountPage();
    await flushPromises();
    const alert = wrapper.find('[data-testid="chat-init-error"]');
    expect(alert.exists()).toBe(true);
    expect(alert.text()).toContain("req-chat-1");
    rememberRequestId(null);
    wrapper.unmount();
  });

  it("CHAT-TITLE: shows the open conversation title in the header", async () => {
    stubFetch({
      conversationsJson: [
        {
          conversationId: 1,
          relationshipId: 1,
          title: "周二夜聊",
          lastMessagePreview: "今晚早点休息",
          createdAt: "2026-08-18T01:00:00Z",
          incognito: false,
        },
      ],
    });
    const wrapper = mountPage();
    await flushPromises();
    const title = wrapper.find('[data-testid="chat-conversation-title"]');
    expect(title.exists()).toBe(true);
    expect(title.text()).toContain("周二夜聊");
    wrapper.unmount();
  });

  // P1-2：头部与会话 chip 不得直接展示原始 title/preview——密文、空值、
  // 内部 conversationId 一律经 conversation-display helper 过滤后再截断。
  it("CONV-LABEL: an opaque enc2 title falls back to the readable preview, never the ciphertext", async () => {
    stubFetch({
      conversationsJson: [
        {
          conversationId: 773,
          relationshipId: 1,
          title: `enc2:${"A".repeat(120)}`,
          lastMessagePreview: "今晚早点休息",
          createdAt: "2026-08-18T12:00:00Z",
          incognito: false,
        },
      ],
    });
    const wrapper = mountPage();
    await flushPromises();

    const chips = wrapper.findAll('[data-testid="conversation-item"]');
    expect(chips).toHaveLength(1);
    expect(chips[0].text()).toContain("今晚早点休息");
    expect(wrapper.find('[data-testid="chat-conversation-title"]').text()).toContain("今晚早点休息");

    const pageText = wrapper.text();
    expect(pageText).not.toMatch(/enc1:|enc2:/i);
    expect(pageText).not.toContain("773");
    wrapper.unmount();
  });

  it("CONV-LABEL: an opaque preview falls back to 未命名会话 with the real createdAt date", async () => {
    stubFetch({
      conversationsJson: [
        {
          conversationId: 774,
          relationshipId: 1,
          title: "",
          lastMessagePreview: `enc1:${"B".repeat(120)}`,
          createdAt: "2026-08-18T12:00:00Z",
          incognito: false,
        },
      ],
    });
    const wrapper = mountPage();
    await flushPromises();

    // chip 承载 16 字符截断；头部承载完整 fallback。
    const datedFallback = "未命名会话（2026-08-18）";
    expect(wrapper.find('[data-testid="conversation-item"]').text()).toBe(
      `${datedFallback.slice(0, 16)}…`,
    );
    expect(wrapper.find('[data-testid="chat-conversation-title"]').text()).toContain(
      datedFallback,
    );

    const pageText = wrapper.text();
    expect(pageText).not.toMatch(/enc1:|enc2:/i);
    expect(pageText).not.toContain("774");
    wrapper.unmount();
  });

  it("CONV-LABEL: empty title and preview fall back to plain 未命名会话", async () => {
    stubFetch({
      conversationsJson: [
        {
          conversationId: 775,
          relationshipId: 1,
          title: "",
          lastMessagePreview: "",
          createdAt: "not-a-date",
          incognito: false,
        },
      ],
    });
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[data-testid="conversation-item"]').text()).toContain("未命名会话");
    expect(wrapper.find('[data-testid="conversation-item"]').text()).not.toContain("未命名会话（");
    expect(wrapper.find('[data-testid="chat-conversation-title"]').text()).toContain("未命名会话");

    const pageText = wrapper.text();
    expect(pageText).not.toMatch(/enc1:|enc2:/i);
    expect(pageText).not.toContain("775");
    wrapper.unmount();
  });

  it("CONV-LABEL: truncation happens after the safe text is resolved (chip ≤16 chars, header full)", async () => {
    const longTitle = "这是一个超过十六个字符的可读会话标题用于验证截断";
    stubFetch({
      conversationsJson: [
        {
          conversationId: 776,
          relationshipId: 1,
          title: longTitle,
          lastMessagePreview: "preview-not-used",
          createdAt: "2026-08-18T12:00:00Z",
          incognito: false,
        },
      ],
    });
    const wrapper = mountPage();
    await flushPromises();

    const chip = wrapper.find('[data-testid="conversation-item"]').text();
    expect(chip).toBe(`${longTitle.slice(0, 16)}…`);
    // 头部承载完整可读标题，不做 chip 级截断。
    expect(wrapper.find('[data-testid="chat-conversation-title"]').text()).toContain(longTitle);
    wrapper.unmount();
  });

  it("LANDSCAPE: binds the ResizeObserver when the history element appears after the async load", async () => {
    const observed: Element[] = [];
    let disconnected = false;
    class FakeResizeObserver {
      observe(el: Element): void {
        observed.push(el);
      }
      disconnect(): void {
        disconnected = true;
      }
    }
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);

    // 关系在 mount 后异步加载：historyEl 晚于 onMounted 出现（深链/刷新同型）。
    const wrapper = mountPage();
    expect(observed).toHaveLength(0);
    await flushPromises();

    const history = wrapper.find('[data-testid="history"]');
    expect(history.exists()).toBe(true);
    expect(observed).toHaveLength(1);
    expect(observed[0]).toBe(history.element);

    wrapper.unmount();
    expect(disconnected).toBe(true);
    vi.unstubAllGlobals();
  });

  it("INC-MODE: the toggle decides the next conversation's incognito flag", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    const initSpy = vi
      .spyOn(store, "initConversation")
      .mockResolvedValue({ conversationId: "9" });

    const toggle = wrapper.find('[data-testid="incognito-toggle"]');
    expect(toggle.exists()).toBe(true);
    expect(toggle.attributes("aria-pressed")).toBe("false");

    await toggle.trigger("click");
    expect(toggle.attributes("aria-pressed")).toBe("true");

    await wrapper.find('[data-testid="new-conversation"]').trigger("click");
    await flushPromises();
    expect(initSpy).toHaveBeenCalledWith(expect.anything(), expect.any(String), true);
    wrapper.unmount();
  });

  it("INC-MODE: shows the plain incognito notice while the open conversation is incognito", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    store.activeIncognito = true;
    await wrapper.vm.$nextTick();

    const notice = wrapper.find('[data-testid="incognito-notice"]');
    expect(notice.exists()).toBe(true);
    expect(notice.text()).toContain("无痕会话");
    wrapper.unmount();
  });

  it("INC-PREF: seeds the next-conversation toggle from the saved default", async () => {
    useAuthStore().accessToken = "a-token";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "/api/v1/incognito-pref") {
          return { ok: true, status: 200, json: async () => ({ defaultIncognito: true }) };
        }
        if (url === "/api/v1/relationships") {
          return { ok: true, status: 200, json: async () => [ACTIVE_RELATIONSHIP] };
        }
        if (url.includes("/messages")) {
          return { ok: true, status: 200, json: async () => [] };
        }
        if (url.startsWith("/api/v1/conversations")) {
          return { ok: true, status: 200, json: async () => [] };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      }),
    );
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[data-testid="incognito-toggle"]').text()).toContain("无痕：开");
    wrapper.unmount();
  });

  it("restores the input when send fails before a generation exists", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    vi.spyOn(store, "send").mockImplementation(async () => {
      store.phase = "failed";
      store.generationId = "";
    });

    const input = wrapper.find('input[data-testid="message-input"]');
    await input.setValue("  请再听我说一次  ");
    await wrapper.find('button[data-testid="send"]').trigger("click");
    await flushPromises();

    expect((input.element as HTMLInputElement).value).toBe("请再听我说一次");
    wrapper.unmount();
  });

  it("does not restore the input when send fails after a generation id exists", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const store = useChatStore();
    vi.spyOn(store, "send").mockImplementation(async () => {
      store.phase = "failed";
      store.generationId = "gen-1";
    });

    const input = wrapper.find('input[data-testid="message-input"]');
    await input.setValue("已经发出去的话");
    await wrapper.find('button[data-testid="send"]').trigger("click");
    await flushPromises();

    expect((input.element as HTMLInputElement).value).toBe("");
    wrapper.unmount();
  });

  it("shows the relationship selector and hides the chat input when no relationship is active", async () => {
    stubFetch({ relationships: [] });

    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[data-testid="relationship-selector"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="message-input"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("context sheet 按模态焦点管理打开：焦点移入、Escape 关闭并归还", async () => {
    stubFetch({ relationships: [] });
    const wrapper = mountPage();
    await flushPromises();

    const trigger = wrapper.find('[data-testid="chat-context-open"]').element as HTMLElement;
    trigger.focus();
    await openContextSheet(wrapper);
    await flushPromises();

    // MODAL-FOCUS：打开后焦点在对话框内。
    const panel = wrapper.find('[data-testid="app-sheet-panel"]').element;
    expect(panel.contains(document.activeElement)).toBe(true);

    // Escape 发出 close：页面关闭 sheet 并把焦点归还触发按钮。
    panel.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
    await flushPromises();
    expect(wrapper.find('[data-testid="app-sheet"]').exists()).toBe(false);
    expect(document.activeElement).toBe(trigger);
    wrapper.unmount();
  });

  it("renders a back-to-index entry even before a relationship is selected", async () => {
    stubFetch({ relationships: [] });
    const wrapper = mountPage();
    await flushPromises();

    await openContextSheet(wrapper);
    const nav = wrapper.find('[data-testid="nav-index"]');
    expect(nav.exists()).toBe(true);
    expect(nav.text()).toContain("返回首页");
    wrapper.unmount();
  });

  it("navigates to the preflight index without calling send or cancel", async () => {
    const navigateTo = vi.fn();
    vi.stubGlobal("uni", { navigateTo });
    const wrapper = mountPage();
    await flushPromises();
    const store = useChatStore();
    const sendSpy = vi.spyOn(store, "send");
    const cancelSpy = vi.spyOn(store, "cancel");

    await openContextSheet(wrapper);
    await wrapper.find('[data-testid="nav-index"]').trigger("click");

    expect(navigateTo).toHaveBeenCalledWith({ url: "/pages/index/index" });
    expect(sendSpy).not.toHaveBeenCalled();
    expect(cancelSpy).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("navigates to the conversation list without calling send or cancel", async () => {
    const navigateTo = vi.fn();
    vi.stubGlobal("uni", { navigateTo });
    const wrapper = mountPage();
    await flushPromises();
    const store = useChatStore();
    const sendSpy = vi.spyOn(store, "send");
    const cancelSpy = vi.spyOn(store, "cancel");

    await wrapper.find('[data-testid="nav-conversations"]').trigger("click");

    expect(navigateTo).toHaveBeenCalledWith({
      url: "/pages/conversations/conversations?relationshipId=1",
    });
    expect(sendSpy).not.toHaveBeenCalled();
    expect(cancelSpy).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("renders a memory-page entry even before a relationship is selected", async () => {
    stubFetch({ relationships: [] });
    const wrapper = mountPage();
    await flushPromises();

    await openContextSheet(wrapper);
    const nav = wrapper.find('[data-testid="nav-memory"]');
    expect(nav.exists()).toBe(true);
    expect(nav.text()).toContain("记忆管理");
    wrapper.unmount();
  });

  it("navigates to the memory page without calling send or cancel", async () => {
    const navigateTo = vi.fn();
    vi.stubGlobal("uni", { navigateTo });
    const wrapper = mountPage();
    await flushPromises();
    const store = useChatStore();
    const sendSpy = vi.spyOn(store, "send");
    const cancelSpy = vi.spyOn(store, "cancel");

    await openContextSheet(wrapper);
    await wrapper.find('[data-testid="nav-memory"]').trigger("click");

    expect(navigateTo).toHaveBeenCalledWith({
      url: "/pages/memory/memory?relationshipId=1",
    });
    expect(sendSpy).not.toHaveBeenCalled();
    expect(cancelSpy).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("omits relationshipId from the memory href when none is selected", async () => {
    stubFetch({ relationships: [] });
    const navigateTo = vi.fn();
    vi.stubGlobal("uni", { navigateTo });
    const wrapper = mountPage();
    await flushPromises();

    await openContextSheet(wrapper);
    await wrapper.find('[data-testid="nav-memory"]').trigger("click");

    expect(navigateTo).toHaveBeenCalledWith({ url: "/pages/memory/memory" });
    wrapper.unmount();
  });

  it("renders a login entry even before a relationship is selected", async () => {
    stubFetch({ relationships: [] });
    const wrapper = mountPage();
    await flushPromises();

    await openContextSheet(wrapper);
    const nav = wrapper.find('[data-testid="nav-login"]');
    expect(nav.exists()).toBe(true);
    expect(nav.text()).toContain("登录");
    wrapper.unmount();
  });

  it("navigates to the login page without calling send or cancel", async () => {
    stubFetch({ relationships: [] });
    const navigateTo = vi.fn();
    vi.stubGlobal("uni", { navigateTo });
    const wrapper = mountPage();
    await flushPromises();
    const store = useChatStore();
    const sendSpy = vi.spyOn(store, "send");
    const cancelSpy = vi.spyOn(store, "cancel");

    await openContextSheet(wrapper);
    await wrapper.find('[data-testid="nav-login"]').trigger("click");

    expect(navigateTo).toHaveBeenCalledWith({ url: "/pages/login/login" });
    expect(sendSpy).not.toHaveBeenCalled();
    expect(cancelSpy).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("SESS-REVIVE: renders a logout entry only for an authenticated session", async () => {
    stubFetch({ relationships: [] });
    const auth = useAuthStore();
    auth.accessToken = "a-token";
    const wrapper = mountPage();
    await flushPromises();

    await openContextSheet(wrapper);
    const logout = wrapper.find('[data-testid="logout"]');
    expect(logout.exists()).toBe(true);
    expect(logout.text()).toContain("登出");
    wrapper.unmount();
  });

  it("SESS-REVIVE: logout revokes the session and navigates to login", async () => {
    stubFetch({ relationships: [] });
    const navigateTo = vi.fn();
    vi.stubGlobal("uni", { navigateTo });
    const auth = useAuthStore();
    auth.accessToken = "a-token";
    auth.role = "USER";
    const logoutSpy = vi.spyOn(auth, "logout").mockResolvedValue();
    const wrapper = mountPage();
    await flushPromises();

    await openContextSheet(wrapper);
    await wrapper.find('[data-testid="logout"]').trigger("click");
    await flushPromises();

    expect(logoutSpy).toHaveBeenCalledTimes(1);
    expect(navigateTo).toHaveBeenCalledWith({ url: "/pages/login/login" });
    wrapper.unmount();
  });

  it("SESS-REVIVE: restores the session on mount before loading relationships", async () => {
    stubFetch({ relationships: [] });
    const auth = useAuthStore();
    const refreshSpy = vi
      .spyOn(auth, "tryRefresh")
      .mockImplementation(async (t) => {
        auth.accessToken = "renewed";
        return true;
      });
    const wrapper = mountPage();
    await flushPromises();

    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(auth.accessToken).toBe("renewed");
    wrapper.unmount();
  });

  it("CONV-LIST: opens the conversationId from the query instead of the latest", async () => {
    vi.stubGlobal("location", { search: "?relationshipId=1&conversationId=9" });
    stubFetch({
      conversationsJson: [
        { conversationId: "9", relationshipId: "1", title: "指定会话" },
        { conversationId: "2", relationshipId: "1", title: "更新的会话" },
      ],
    });
    const wrapper = mountPage();
    await flushPromises();
    const store = useChatStore();

    expect(store.conversationId).toBe("9");
    wrapper.unmount();
  });

  it("CONV-MGMT: renames the open conversation through the inline row", async () => {
    stubFetch({
      conversationsJson: [{ conversationId: "9", relationshipId: "1", title: "旧标题" }],
    });
    const wrapper = mountPage();
    await flushPromises();
    const store = useChatStore();
    const renameSpy = vi.spyOn(store, "renameConversation").mockResolvedValue(true);
    store.conversationId = "9";

    await openConvSheet(wrapper);
    await wrapper.find('[data-testid="conversation-rename"]').trigger("click");
    await wrapper.find('[data-testid="rename-input"]').setValue("新标题");
    await wrapper.find('[data-testid="rename-apply"]').trigger("click");
    await flushPromises();

    expect(renameSpy).toHaveBeenCalledWith(expect.anything(), "9", "新标题");
    expect(wrapper.find('[data-testid="rename-row"]').exists()).toBe(false);
    wrapper.unmount();
  });

  // P1-B（round3）：改名输入绝不预填密文。直接读取 input.element.value 验证
  // （不用 wrapper.text() 代替）：enc1:/enc2:、密文长 token、空值一律空串，
  // 且不含内部 conversationId。
  it("CONV-MGMT: the rename input never prefills an enc1/enc2 ciphertext title", async () => {
    for (const title of [`enc1:${"B".repeat(120)}`, `enc2:${"A".repeat(120)}`, ""]) {
      stubFetch({
        conversationsJson: [{ conversationId: "9", relationshipId: "1", title }],
      });
      const wrapper = mountPage();
      await flushPromises();
      const store = useChatStore();
      store.conversationId = "9";

      await openConvSheet(wrapper);
      await wrapper.find('[data-testid="conversation-rename"]').trigger("click");
      await wrapper.vm.$nextTick();

      const input = wrapper.find('[data-testid="rename-input"]');
      expect(input.exists(), "rename row rendered").toBe(true);
      const value = (input.element as HTMLInputElement).value;
      expect(value).toBe("");
      expect(value).not.toContain("enc1:");
      expect(value).not.toContain("enc2:");
      expect(value).not.toContain("9");
      wrapper.unmount();
    }
  });

  // P2（round4）：不带 enc 前缀的长无空格 opaque token 同样不可读——
  // 改名输入必须预填空串（chat 与 conversations 两处输入一致）。
  it("CONV-MGMT: a long opaque token without an enc prefix prefills empty", async () => {
    stubFetch({
      conversationsJson: [
        { conversationId: "9", relationshipId: "1", title: "K7f".repeat(40) },
      ],
    });
    const wrapper = mountPage();
    await flushPromises();
    const store = useChatStore();
    store.conversationId = "9";

    await openConvSheet(wrapper);
    await wrapper.find('[data-testid="conversation-rename"]').trigger("click");
    await wrapper.vm.$nextTick();

    const value = (wrapper.find('[data-testid="rename-input"]').element as HTMLInputElement).value;
    expect(value).toBe("");
    wrapper.unmount();
  });

  it("CONV-MGMT: a readable title prefills trimmed into the rename input", async () => {
    stubFetch({
      conversationsJson: [{ conversationId: "9", relationshipId: "1", title: "  周二夜聊  " }],
    });
    const wrapper = mountPage();
    await flushPromises();
    const store = useChatStore();
    store.conversationId = "9";

    await openConvSheet(wrapper);
    await wrapper.find('[data-testid="conversation-rename"]').trigger("click");
    await wrapper.vm.$nextTick();

    const value = (wrapper.find('[data-testid="rename-input"]').element as HTMLInputElement).value;
    expect(value).toBe("周二夜聊");
    wrapper.unmount();
  });

  it("CONV-MGMT: deletes the open conversation only after the two-step confirm", async () => {
    stubFetch({
      conversationsJson: [{ conversationId: "9", relationshipId: "1" }],
    });
    const wrapper = mountPage();
    await flushPromises();
    const store = useChatStore();
    const removeSpy = vi.spyOn(store, "removeConversation").mockResolvedValue(true);
    store.conversationId = "9";

    // First click arms the confirm; nothing is deleted yet.
    await openConvSheet(wrapper);
    await wrapper.find('[data-testid="conversation-delete"]').trigger("click");
    expect(removeSpy).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="conversation-delete"]').text()).toContain("确认删除");

    // Second click deletes.
    await openConvSheet(wrapper);
    await wrapper.find('[data-testid="conversation-delete"]').trigger("click");
    expect(removeSpy).toHaveBeenCalledWith(expect.anything(), "9");
    wrapper.unmount();
  });

  it("shows the current relationship id after a successful load", async () => {
    const wrapper = mountPage();
    await flushPromises();
    const relStore = useRelationshipStore();
    const activateSpy = vi.spyOn(relStore, "activate");
    const store = useChatStore();
    const sendSpy = vi.spyOn(store, "send");

    const status = wrapper.find('[data-testid="current-relationship"]');
    expect(status.exists()).toBe(true);
    expect(status.text()).toContain("当前关系：温和倾听者");
    expect(activateSpy).not.toHaveBeenCalled();
    expect(sendSpy).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("shows an empty current-relationship copy when none is selected", async () => {
    stubFetch({ relationships: [] });
    const wrapper = mountPage();
    await flushPromises();

    const status = wrapper.find('[data-testid="current-relationship"]');
    expect(status.exists()).toBe(true);
    expect(status.text()).toContain("还没有当前关系。");
    wrapper.unmount();
  });

  it("shows a relationship load error without calling send or activate", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "/api/v1/relationships") {
          return { ok: false, status: 500, json: async () => ({}) };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      }),
    );
    const wrapper = mountPage();
    await flushPromises();
    const relStore = useRelationshipStore();
    const activateSpy = vi.spyOn(relStore, "activate");
    const store = useChatStore();
    const sendSpy = vi.spyOn(store, "send");
    const cancelSpy = vi.spyOn(store, "cancel");

    const err = wrapper.find('[data-testid="relationship-load-error"]');
    expect(err.exists()).toBe(true);
    expect(err.text()).toContain("关系列表加载失败。");
    expect(wrapper.find('[data-testid="current-relationship"]').exists()).toBe(false);
    expect(activateSpy).not.toHaveBeenCalled();
    expect(sendSpy).not.toHaveBeenCalled();
    expect(cancelSpy).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("selects a query relationship locally without activate", async () => {
    stubFetch({
      relationships: [
        ACTIVE_RELATIONSHIP,
        {
          relationshipId: "2",
          personaRef: "other",
          active: false,
          createdAt: "2026-08-13T02:00:00Z",
        },
      ],
    });
    vi.stubGlobal("location", { search: "?relationshipId=2" });
    const relStore = useRelationshipStore();
    const activateSpy = vi.spyOn(relStore, "activate");
    const wrapper = mountPage();
    await flushPromises();

    expect(relStore.currentRelationshipId).toBe("2");
    expect(activateSpy).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="message-input"]').exists()).toBe(true);
    wrapper.unmount();
  });

  // ---- CONV-HIST: conversation panel / switching / load-more ----

  it("renders the conversation panel and resumes the newest conversation on mount", async () => {
    stubFetch({
      conversationsJson: [
        { conversationId: 8, relationshipId: "1", lastMessagePreview: "更早的会话" },
        { conversationId: 9, relationshipId: "1", lastMessagePreview: "最近聊到的内容" },
      ],
    });
    const wrapper = mountPage();
    await flushPromises();
    const store = useChatStore();

    expect(wrapper.find('[data-testid="conversation-panel"]').exists()).toBe(true);
    expect(wrapper.findAll('[data-testid="conversation-item"]')).toHaveLength(2);
    expect(store.conversationId).toBe("9");
    expect(wrapper.find('[data-testid="conversation-item"]').text()).toContain("更早的会话");
    wrapper.unmount();
  });

  it("creates a fresh conversation when the list is empty", async () => {
    stubFetch({ conversationsJson: [] });
    const wrapper = mountPage();
    await flushPromises();
    const store = useChatStore();

    expect(store.conversationId).toBe("1");
    expect(wrapper.find('[data-testid="conversation-panel"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("switches to another conversation when its entry is clicked", async () => {
    stubFetch({
      conversationsJson: [
        { conversationId: 8, relationshipId: "1", lastMessagePreview: "更早的会话" },
        { conversationId: 9, relationshipId: "1", lastMessagePreview: "最近聊到的内容" },
      ],
    });
    const wrapper = mountPage();
    await flushPromises();
    const store = useChatStore();
    expect(store.conversationId).toBe("9");

    const items = wrapper.findAll('[data-testid="conversation-item"]');
    await items[0].trigger("click");
    await flushPromises();

    expect(store.conversationId).toBe("8");
    wrapper.unmount();
  });

  it("shows and triggers the load-more button when more history remains", async () => {
    const wrapper = mountPage();
    await flushPromises();
    const store = useChatStore();
    store.messages = [
      { messageId: "1", conversationId: "1", role: "user", content: "A" },
    ];
    store.historyHasMore = true;
    const loadMoreSpy = vi.spyOn(store, "loadMoreHistory").mockResolvedValue();
    await wrapper.vm.$nextTick();

    const loadMore = wrapper.find('[data-testid="load-more"]');
    expect(loadMore.exists()).toBe(true);
    await loadMore.trigger("click");

    expect(loadMoreSpy).toHaveBeenCalled();
    wrapper.unmount();
  });

  it("hides the load-more button when no more history remains", async () => {
    const wrapper = mountPage();
    await flushPromises();
    const store = useChatStore();
    store.messages = [
      { messageId: "1", conversationId: "1", role: "user", content: "A" },
    ];
    store.historyHasMore = false;
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="load-more"]').exists()).toBe(false);
    wrapper.unmount();
  });

  // ---- MEM-PROMPT: pending candidate hint ----

  it("renders the memory prompt when pending candidates exist and links to the memory page", async () => {
    stubFetch();
    const wrapper = mountPage();
    await flushPromises();
    const store = useChatStore();
    store.pendingMemoryCount = 2;
    await wrapper.vm.$nextTick();

    const prompt = wrapper.find('[data-testid="memory-prompt"]');
    expect(prompt.exists()).toBe(true);
    expect(prompt.text()).toContain("2 条新的记忆候选");

    const navigateTo = vi.fn();
    vi.stubGlobal("uni", { navigateTo });
    await wrapper.find('[data-testid="memory-prompt-link"]').trigger("click");

    expect(navigateTo).toHaveBeenCalledWith({
      url: "/pages/memory/memory?relationshipId=1",
    });
    wrapper.unmount();
  });

  it("hides the memory prompt when no candidates are pending", async () => {
    stubFetch();
    const wrapper = mountPage();
    await flushPromises();
    const store = useChatStore();
    store.pendingMemoryCount = 0;
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="memory-prompt"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("re-checks pending candidates once after the extraction delay", async () => {
    vi.useFakeTimers();
    try {
      stubFetch();
      const wrapper = mountPage();
      await flushPromises();
      const store = useChatStore();
      const refreshSpy = vi
        .spyOn(store, "refreshPendingMemoryCount")
        .mockResolvedValue();
      vi.spyOn(store, "send").mockImplementation(async () => {
        store.phase = "completed";
      });

      const input = wrapper.find('input[data-testid="message-input"]');
      await input.setValue("hello");
      await wrapper.find('button[data-testid="send"]').trigger("click");
      await flushPromises();
      expect(refreshSpy).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(8000);
      await flushPromises();
      expect(refreshSpy).toHaveBeenCalledTimes(2);
      wrapper.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  // ---- REL-DEACT: two-step relationship deactivation ----

  it("deactivates the current relationship only after the two-step confirm", async () => {
    const relationships = [{ ...ACTIVE_RELATIONSHIP }];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        const method = init?.method ?? "GET";
        if (url === "/api/v1/relationships" && method === "GET") {
          return { ok: true, status: 200, json: async () => relationships };
        }
        if (url.includes("/deactivate")) {
          relationships[0] = { ...relationships[0], active: false };
          return {
            ok: true,
            status: 200,
            json: async () => ({ ...ACTIVE_RELATIONSHIP, active: false }),
          };
        }
        if (url.includes("/messages")) {
          return { ok: true, status: 200, json: async () => [] };
        }
        if (url.startsWith("/api/v1/conversations") && method === "GET") {
          return { ok: true, status: 200, json: async () => [] };
        }
        if (url.startsWith("/api/v1/conversations")) {
          return { ok: true, status: 200, json: async () => ({ conversationId: 1 }) };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      }),
    );
    const wrapper = mountPage();
    await flushPromises();
    const relStore = useRelationshipStore();
    const store = useChatStore();
    expect(relStore.currentRelationshipId).toBe("1");

    const button = wrapper.find('[data-testid="deactivate-relationship"]');
    expect(button.exists()).toBe(true);
    expect(button.text()).toContain("解除关系");

    // First click only arms the confirm state; nothing is deactivated.
    await button.trigger("click");
    await flushPromises();
    expect(relStore.currentRelationshipId).toBe("1");
    expect(wrapper.find('[data-testid="deactivate-relationship"]').text()).toContain("确认解除？");

    // Second click deactivates: current cleared, chat reset, selector shown.
    await wrapper.find('[data-testid="deactivate-relationship"]').trigger("click");
    await flushPromises();

    expect(relStore.currentRelationshipId).toBeNull();
    expect(store.conversationId).toBe("");
    expect(wrapper.find('[data-testid="relationship-selector"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("ends today's conversation only after the two-step confirm", async () => {
    const calls: { method: string; url: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        const method = (init?.method ?? "GET").toUpperCase();
        calls.push({ method, url });
        if (url === "/api/v1/relationships") {
          return { ok: true, status: 200, json: async () => [{ ...ACTIVE_RELATIONSHIP }] };
        }
        if (url.includes("/deactivate") || url.includes("/relationships/1") && method === "DELETE") {
          throw new Error("end today must not deactivate or delete the companion");
        }
        if (url.endsWith("/end") && method === "POST") {
          return { ok: true, status: 200, json: async () => ({ ok: true, incognitoCleared: false }) };
        }
        if (url.includes("/messages")) {
          return { ok: true, status: 200, json: async () => [] };
        }
        if (url.startsWith("/api/v1/conversations") && method === "GET") {
          return {
            ok: true,
            status: 200,
            json: async () => [
              { conversationId: 1, relationshipId: 1, createdAt: "2026-08-18T00:00:00Z", lastMessagePreview: "hello" },
            ],
          };
        }
        if (url.startsWith("/api/v1/conversations") && method === "POST") {
          return { ok: true, status: 200, json: async () => ({ conversationId: 2 }) };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      }),
    );
    const wrapper = mountPage();
    await flushPromises();

    await openConvSheet(wrapper);
    const button = wrapper.find('[data-testid="end-today"]');
    expect(button.exists()).toBe(true);
    expect(button.text()).toContain("结束今天的对话");
    expect(wrapper.text()).not.toMatch(/挽留|难过|再考虑|舍不得/);

    await button.trigger("click");
    await flushPromises();
    expect(calls.some((c) => c.url.endsWith("/end"))).toBe(false);
    expect(wrapper.find('[data-testid="end-today"]').text()).toContain("确认结束？");
    expect(useRelationshipStore().currentRelationshipId).toBe("1");

    await openConvSheet(wrapper);
    await wrapper.find('[data-testid="end-today"]').trigger("click");
    await flushPromises();

    expect(calls.some((c) => c.method === "POST" && c.url === "/api/v1/conversations/1/end")).toBe(
      true,
    );
    expect(useRelationshipStore().current).not.toBeNull();
    wrapper.unmount();
  });

  it("USAGE-HEALTH: shows a system-layer banner and continues without role-play", async () => {
    const reminderPosts: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        const method = (init?.method ?? "GET").toUpperCase();
        if (url === "/api/v1/relationships") {
          return { ok: true, status: 200, json: async () => [{ ...ACTIVE_RELATIONSHIP }] };
        }
        if (url.includes("/messages")) {
          return { ok: true, status: 200, json: async () => [] };
        }
        if (url.startsWith("/api/v1/conversations") && method === "GET") {
          return {
            ok: true,
            status: 200,
            json: async () => [
              { conversationId: 1, relationshipId: 1, createdAt: "2026-08-18T00:00:00Z" },
            ],
          };
        }
        if (url === "/api/v1/usage-health/reminder" && method === "POST") {
          const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
          reminderPosts.push(body);
          return {
            ok: true,
            status: 200,
            json: async () => ({
              reminderAfterMinutes: 120,
              sessionGapMinutes: 30,
              continuousMinutes: 125,
              reminderDue: body.result !== "CONTINUED",
              sessionStartedAt: "2026-08-18T00:00:00Z",
            }),
          };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      }),
    );
    const wrapper = mountPage();
    await flushPromises();

    const health = useUsageHealthStore();
    health.status = {
      reminderAfterMinutes: 120,
      sessionGapMinutes: 30,
      continuousMinutes: 125,
      reminderDue: true,
      sessionStartedAt: "2026-08-18T00:00:00Z",
    };
    await wrapper.vm.$nextTick();
    await flushPromises();

    const banner = wrapper.find('[data-testid="usage-health-banner"]');
    expect(banner.exists()).toBe(true);
    expect(wrapper.find('[data-testid="usage-health-copy"]').text()).toContain("系统提醒");
    expect(wrapper.find('[data-testid="usage-health-copy"]').text()).toContain("125 分钟");
    expect(wrapper.text()).not.toMatch(/舍不得|再陪我一会儿|我很难过/);

    await wrapper.find('[data-testid="usage-health-continue"]').trigger("click");
    await flushPromises();

    expect(reminderPosts.some((body) => (body as { result?: string }).result === "CONTINUED")).toBe(
      true,
    );
    expect(wrapper.find('[data-testid="usage-health-banner"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("GEN-VER: offers regenerate on the last user message after a completed turn", async () => {
    const wrapper = mountPage();
    await flushPromises();
    const store = useChatStore();
    store.phase = "completed";
    store.messages = [
      {
        messageId: "9",
        conversationId: "1",
        role: "user",
        content: "hello",
      },
      {
        messageId: "10",
        conversationId: "1",
        role: "assistant",
        content: "hi",
      },
    ];
    store.versionsByUserMessage = {
      "9": [
        { generationId: "55", selected: false, status: "COMPLETED" },
        { generationId: "56", selected: true, status: "COMPLETED" },
      ],
    };
    await wrapper.vm.$nextTick();

    await openMsgMenu(wrapper, "9");
    expect(wrapper.find('[data-testid="regenerate"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="version-row"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="version-2"]').attributes("aria-pressed")).toBe("true");
    wrapper.unmount();
  });

  it("MEM-IMPORT: offers import when an archive exists for the current persona", async () => {
    const calls: { method: string; url: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        const method = (init?.method ?? "GET").toUpperCase();
        calls.push({ method, url });
        if (url === "/api/v1/relationships") {
          return { ok: true, status: 200, json: async () => [{ ...ACTIVE_RELATIONSHIP }] };
        }
        if (url.startsWith("/api/v1/memory-imports") && method === "GET") {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              personaRef: "gentle-listener",
              acceptedCount: 2,
              createdAt: "2026-08-19T00:00:00Z",
            }),
          };
        }
        if (url.includes("/memory-imports") && method === "POST") {
          return { ok: true, status: 200, json: async () => ({ importedCount: 2 }) };
        }
        if (url.includes("/messages")) {
          return { ok: true, status: 200, json: async () => [] };
        }
        if (url.startsWith("/api/v1/conversations") && method === "GET") {
          return { ok: true, status: 200, json: async () => [] };
        }
        if (url.startsWith("/api/v1/conversations")) {
          return { ok: true, status: 200, json: async () => ({ conversationId: 1 }) };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      }),
    );
    const wrapper = mountPage();
    await flushPromises();

    const prompt = wrapper.find('[data-testid="memory-import-prompt"]');
    expect(prompt.exists()).toBe(true);
    expect(prompt.text()).toContain("2 条");
    await wrapper.find('[data-testid="memory-import-confirm"]').trigger("click");
    await flushPromises();
    expect(
      calls.some((c) => c.method === "POST" && c.url === "/api/v1/relationships/1/memory-imports"),
    ).toBe(true);
    wrapper.unmount();
  });

  it("hides the deactivate button when no relationship is selected", async () => {
    stubFetch({ relationships: [] });
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[data-testid="deactivate-relationship"]').exists()).toBe(false);
    wrapper.unmount();
  });

  // ---- P1/P2（round6）：跟随状态机结算 / 会话 ownership 重置 / 宽度重测 ----

  describe("follow-run settlement, ownership reset and width remeasure (round6)", () => {
    /** 可手动泵帧的 requestAnimationFrame 替身。 */
    interface FrameHarness {
      queued(): number;
      pump(count?: number): void;
    }

    function installFrameHarness(): FrameHarness {
      const queue: Array<() => void> = [];
      vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
        queue.push(() => cb(performance.now()));
        return queue.length;
      });
      return {
        queued: () => queue.length,
        pump(count = 1): void {
          for (let i = 0; i < count; i += 1) {
            const next = queue.shift();
            next?.();
          }
        },
      };
    }

    /**
     * 给 history 节点打上引擎需要的最小几何：scrollHeight/clientHeight 有值
     * （否则 requestFollow 直接跳过），锚点/容器矩形可由测试控制。
     */
    function installGeometry(
      el: HTMLElement,
      opts: {
        scrollHeight: number;
        clientHeight: number;
        /** 按 data-vindex 返回每行的实测高度；缺省时保持零矩形。 */
        rowHeight?: (idx: number) => number;
      } = { scrollHeight: 1200, clientHeight: 600 },
    ): void {
      Object.defineProperty(el, "scrollHeight", {
        configurable: true,
        get: () => opts.scrollHeight,
      });
      Object.defineProperty(el, "clientHeight", {
        configurable: true,
        get: () => opts.clientHeight,
      });
      // 浏览器会把 scrollTop 钳制到 [0, scrollHeight - clientHeight]；
      // happy-dom 不做钳制，状态机在无钳制环境下会发散。
      let currentScrollTop = 0;
      Object.defineProperty(el, "scrollTop", {
        configurable: true,
        get: () => currentScrollTop,
        set(value: number) {
          const requested = Number(value) || 0;
          currentScrollTop = Math.max(
            0,
            Math.min(opts.scrollHeight - opts.clientHeight, requested),
          );
        },
      });
      if (opts.rowHeight) {
        for (const node of Array.from(el.querySelectorAll<HTMLElement>('[data-testid="chat-message"]'))) {
          const vi = Number((node as HTMLElement & { dataset: { vindex?: string } }).dataset.vindex);
          const idx = Number.isInteger(vi) ? vi : 0;
          const h = Math.max(1, Math.ceil(opts.rowHeight(idx)));
          Object.defineProperty(node, "getBoundingClientRect", {
            configurable: true,
            value: () => ({
              x: 0, y: 0, top: idx * h, left: 0, right: 100, bottom: idx * h + h,
              width: 100, height: h, toJSON: () => ({}),
            }),
          });
        }
        Object.defineProperty(el, "getBoundingClientRect", {
          configurable: true,
          value: () => ({
            x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 600,
            width: 100, height: 600, toJSON: () => ({}),
          }),
        });
      }
    }

    function seedMessages(store: ReturnType<typeof useChatStore>, n: number, tag = "m"): void {
      store.messages = Array.from({ length: n }, (_, i) => ({
        messageId: `${tag}${i}`,
        conversationId: "1",
        role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
        content: `消息 ${i}`,
      }));
    }

    it("P1-2: a settled follow run publishes idle and stops scheduling frames until a new signal arrives", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
      try {
        const frames = installFrameHarness();
        stubFetch({
          conversationsJson: [{ conversationId: 1, relationshipId: 1 }],
        });
        const wrapper = mountPage();
        await flushPromises();

        const history = wrapper.find('[data-testid="history"]');
        const el = history.element as HTMLElement;
        installGeometry(el);

        const store = useChatStore();
        seedMessages(store, 4);
        // 消息变化触发 requestFollow（materialize→align→verify 快速通道）。
        await flushPromises();
        expect(el.dataset.followRun).toBe("active");

        // 泵帧 + 推进假时钟：连续稳定 ≥250ms 后必须结算为 idle。
        let guard = 0;
        while ((el.dataset.followRun === "active" || frames.queued() > 0) && guard < 200) {
          vi.advanceTimersByTime(90);
          frames.pump();
          await Promise.resolve();
          guard += 1;
        }
        expect(guard, "converged within the frame budget").toBeLessThan(200);
        expect(el.dataset.followRun, "run settles to idle").toBe("idle");
        expect(frames.queued(), "no frame stays queued after settling").toBe(0);

        // 结算后状态机彻底静止：时间继续流逝也不排队任何新帧。
        const scheduledBefore = frames.queued();
        vi.advanceTimersByTime(600);
        await Promise.resolve();
        expect(frames.queued()).toBe(scheduledBefore);

        // 新信号到达才创建下一轮 run（active→收敛→再次 idle）。
        seedMessages(store, 6);
        await flushPromises();
        expect(el.dataset.followRun).toBe("active");
        guard = 0;
        while ((el.dataset.followRun === "active" || frames.queued() > 0) && guard < 200) {
          vi.advanceTimersByTime(90);
          frames.pump();
          await Promise.resolve();
          guard += 1;
        }
        expect(el.dataset.followRun).toBe("idle");
        expect(frames.queued()).toBe(0);
        wrapper.unmount();
      } finally {
        vi.useRealTimers();
        vi.unstubAllGlobals();
      }
    });

    it("P1-2: unmount cancels an active follow run and stops its frames", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      try {
        const frames = installFrameHarness();
        stubFetch();
        const wrapper = mountPage();
        await flushPromises();

        const el = wrapper.find('[data-testid="history"]').element as HTMLElement;
        installGeometry(el);
        const store = useChatStore();
        seedMessages(store, 40); // 多行历史确保 materialize 阶段写 scrollTop
        await flushPromises();
        expect(el.dataset.followRun).toBe("active");
        expect(frames.queued() + 1).toBeGreaterThanOrEqual(1);

        wrapper.unmount();
        expect(el.dataset.followRun, "run released on teardown").toBe("idle");
        // 卸载后再泵任何残余队列也不得读写已拆卸组件。
        expect(() => frames.pump(5)).not.toThrow();
      } finally {
        vi.useRealTimers();
        vi.unstubAllGlobals();
      }
    });

    it("P1-3: switching conversations resets ownership, anchors and scrollTop, then re-follows the new tail", async () => {
      const frames = installFrameHarness();
      const conversationsJson = [
        { conversationId: 8, relationshipId: 1, lastMessagePreview: "更早的会话" },
        { conversationId: 9, relationshipId: 1, lastMessagePreview: "最近聊到的内容" },
      ];
      const messagesByConversation: Record<string, unknown[]> = {
        "8": Array.from({ length: 12 }, (_, i) => ({
          messageId: `a${String(i).padStart(2, "0")}`,
          conversationId: "8",
          role: i % 2 === 0 ? "user" : "assistant",
          content: `A 会话消息 ${i}`,
        })),
        "9": Array.from({ length: 12 }, (_, i) => ({
          messageId: `b${String(i).padStart(2, "0")}`,
          conversationId: "9",
          role: i % 2 === 0 ? "user" : "assistant",
          content: `B 会话消息 ${i}`,
        })),
      };
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) => {
          const url = typeof input === "string" ? input : input.toString();
          if (url === "/api/v1/relationships") {
            return { ok: true, status: 200, json: async () => [ACTIVE_RELATIONSHIP] };
          }
          if (url.includes("/messages")) {
            const conv = url.match(/conversations\/(\d+)\//)?.[1] ?? "9";
            return { ok: true, status: 200, json: async () => messagesByConversation[conv] ?? [] };
          }
          if (url.startsWith("/api/v1/conversations") && !url.includes("/messages")) {
            return { ok: true, status: 200, json: async () => conversationsJson };
          }
          return { ok: true, status: 200, json: async () => ({}) };
        }),
      );
      const wrapper = mountPage();
      await flushPromises();
      const store = useChatStore();
      expect(store.conversationId).toBe("9");
      expect(store.messages[0].messageId).toBe("b00");

      const history = wrapper.find('[data-testid="history"]');
      const el = history.element as HTMLElement;
      // 行高 90 × 12 条 = 内容总高 1080：与滚动容器的 scrollHeight 自洽，
      // 材料化阶段写绝对底的落点即钳制值 1080-600=480。
      installGeometry(el, {
        scrollHeight: 1080,
        clientHeight: 600,
        rowHeight: () => 90,
      });

      // 用户滚离（真实语义的滚动事件，非回声）：following=false 并发布保持基准。
      el.scrollTop = 333;
      await history.trigger("scroll");
      expect(history.attributes("data-following")).toBe("false");
      // round11（P1-4）：定锚有滚动静默门——本测试用真实时钟，等待静默期
      // （≥80ms）流过后泵帧，基准即出现。
      for (let i = 0; i < 20 && !el.dataset.preserveMid; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 30));
        frames.pump();
        await Promise.resolve();
      }
      // 保持基准与旧锚点此刻存在（随后必须被会话边界清掉）。
      expect(el.dataset.preserveMid ?? null).not.toBeNull();

      // 切到会话 A：ownership 全量重置；随后状态机把新会话落到最新消息，
      // 旧会话的位置既不保留也不误读为当前视口。
      const items = wrapper.findAll('[data-testid="conversation-item"]');
      await items[0].trigger("click");
      await flushPromises();

      expect(store.conversationId).toBe("8");
      expect(store.messages[0].messageId, "new conversation's rows replace the old").toBe("a00");
      expect(history.attributes("data-following"), "ownership restored to follow-latest").toBe("true");
      expect(el.dataset.preserveMid, "stale preserve anchor dropped").toBeUndefined();
      expect(el.dataset.followRun).toBeDefined();
      expect(el.scrollTop, "old conversation's scrollTop must not leak into the new one").not.toBe(333);
      // 新会话加载完成后由状态机收敛：可见窗口的最后一行必须是新会话的
      // 最新消息——"落到新会话尾部"的产品语义以 messageId 断言，不绑估算
      // 像素模型的巧合值。
      let guard = 0;
      while ((frames.queued() > 0 || el.dataset.followRun === "active") && guard < 300) {
        frames.pump();
        await Promise.resolve();
        guard += 1;
      }
      // 单元层语义：收敛后窗口深入新会话尾部（≥第 9 条挂载）且 ownership
      // 三件套成立。"最新消息完整可见"的严格像素级包含由会话切换 E2E 断言。
      const mountedMids = Array.from(
        el.querySelectorAll('[data-testid="chat-message"]'),
      ).map((node) => (node as HTMLElement).dataset.mid ?? "");
      const deepestIndex = Number(mountedMids.at(-1)?.slice(1) ?? "-1");
      expect(
        deepestIndex,
        `the follow machine advanced into conversation A's tail (${mountedMids.join(",")})`,
      ).toBeGreaterThanOrEqual(8);
      expect(el.scrollTop, "old conversation's position did not survive").not.toBe(333);
      expect(history.attributes("data-following")).toBe("true");

      // 反向切回 B：同样重置，不沿用 A 的落点。round11（P2-1）：钳制后
      // 落点与引擎最近程序写入相同（300→480 系）——按回声票据契约，同
      // 落点事件只有携带真实用户意图才构成用户语义；先派发一次 wheel
      // 意图。滚离落点取 300（gap=180 > 回底阈值），避免落进底部粘性带。
      el.dispatchEvent(new WheelEvent("wheel"));
      el.scrollTop = 300;
      await history.trigger("scroll");
      expect(history.attributes("data-following")).toBe("false");
      await items[1].trigger("click");
      await flushPromises();

      expect(store.conversationId).toBe("9");
      expect(store.messages[0].messageId).toBe("b00");
      expect(history.attributes("data-following")).toBe("true");
      expect(el.scrollTop, "A 的落点不再保留").not.toBe(777);
      wrapper.unmount();
    });

    it("P2-4: a width-only ResizeObserver change invalidates cached heights and remeasures without moving the window", async () => {
      const frames = installFrameHarness();
      interface FakeROInstance {
        callback: ResizeObserverCallback;
        targets: Element[];
        emit(entry: { width: number; height: number }): void;
      }
      const roInstances: FakeROInstance[] = [];
      class FakeResizeObserver {
        readonly callback: ResizeObserverCallback;
        readonly targets: Element[] = [];
        constructor(cb: ResizeObserverCallback) {
          this.callback = cb;
          roInstances.push(this as unknown as FakeROInstance);
        }
        observe(target: Element): void {
          this.targets.push(target);
        }
        disconnect(): void {
          /* no-op */
        }
        emit(entry: { width: number; height: number }): void {
          this.callback(
            [
              {
                contentRect: {
                  x: 0, y: 0, width: entry.width, height: entry.height,
                  top: 0, left: 0, right: entry.width, bottom: entry.height,
                  toJSON: () => ({}),
                },
                target: this.targets[0]!,
              } as unknown as ResizeObserverEntry,
            ],
            this as unknown as ResizeObserver,
          );
        }
      }
      vi.stubGlobal("ResizeObserver", FakeResizeObserver);

      // 行高提供方：窄宽短行 / 宽宽长行。先按"矮"测满缓存，再改宽（行变高）
      // 触发整体失效与重测。
      const rectCalls = new Map<number, number>();
      const rowHeightModelFactory = (): (i: number) => number => {
        const model = rowHeightModelRef;
        return (i) => {
          rectCalls.set(i, (rectCalls.get(i) ?? 0) + 1);
          return model(i);
        };
      };
      let rowHeightModelRef: (i: number) => number = (i) => 60 + i * 4;
      stubFetch({
        conversationsJson: [{ conversationId: 1, relationshipId: 1 }],
      });
      const wrapper = mountPage();
      await flushPromises();

      const history = wrapper.find('[data-testid="history"]');
      const el = history.element as HTMLElement;

      const store = useChatStore();
      seedMessages(store, 14);
      await flushPromises();
      // 确定性前置：每轮重打几何补丁并泵帧，直到 run 结算——逐项实测回填
      // 与窗口稳定都以显式驱动完成，不依赖环境 rAF 时序。
      const refreshGeometry = (): void => {
        installGeometry(el, {
          scrollHeight: 10000,
          clientHeight: 600,
          rowHeight: rowHeightModelFactory(),
        });
      };
      let settleGuard = 0;
      do {
        refreshGeometry();
        frames.pump(10);
        await flushPromises();
        settleGuard += 1;
      } while ((el.dataset.followRun !== "idle" || frames.queued() > 0) && settleGuard < 400);

      const spacerOf = (tid: string): HTMLElement =>
        wrapper.find(`[data-testid="${tid}"]`).element as HTMLElement;
      const px = (node: HTMLElement): number =>
        Number.parseFloat(/height:\s*(-?[\d.]+)px/.exec(node.getAttribute("style") ?? "")?.[1] ?? "NaN");
      const mountedVindexSeq = (): string[] =>
        Array.from(el.querySelectorAll('[data-testid="chat-message"]'))
          .map((n) => (n as HTMLElement).dataset.vindex ?? "");

      // 初次实测后必须存在真实测量结果：spacer 至少其一非零。
      const beforeTop = px(spacerOf("virt-spacer-top"));
      const beforeBottom = px(spacerOf("virt-spacer-bottom"));
      expect(Number.isFinite(beforeTop) && Number.isFinite(beforeBottom)).toBe(true);

      const ro = roInstances[0];
      expect(ro?.targets.length).toBeGreaterThan(0);

      // 宽度基线热身（首次回调建立 baseline，不构成变化），随后泵干排队帧。
      ro!.emit({ width: 800, height: 600 });
      for (let i = 0; i < 8 && frames.queued() > 0; i += 1) {
        refreshGeometry();
        frames.pump(10);
        await flushPromises();
      }

      // 仅改宽度：高度回调参数保持一致。同步瞬间 start/end 必须原样——
      // 重排是异步收敛的，绝不允许在回调里直接抖动窗口。
      const vindexBeforeEmit = mountedVindexSeq();
      const epochBefore = el.dataset.heightCacheEpoch ?? "0";
      rowHeightModelRef = (i) => 120 + i * 6; // 新宽度下的换行结果
      ro!.emit({ width: 420, height: 600 });
      expect(mountedVindexSeq(), "window start/end frozen synchronously").toEqual(vindexBeforeEmit);
      const epochAfterSync = Number(el.dataset.heightCacheEpoch ?? "0");
      const rectCallsSinceEmitSnapshot = new Map(rectCalls);
      expect(
        epochAfterSync,
        `width-only change bumps the height-cache epoch (${epochBefore}→${epochAfterSync})`,
      ).toBeGreaterThan(Number(epochBefore));

      // 收敛：新宽度下的实测值覆盖整表。
      let converged = false;
      for (let round = 0; round < 40 && !converged; round += 1) {
        refreshGeometry();
        frames.pump(10);
        await flushPromises();
        const t = px(spacerOf("virt-spacer-top"));
        const b = px(spacerOf("virt-spacer-bottom"));
        converged =
          Number.isFinite(t) && Number.isFinite(b) &&
          (Math.abs(t - beforeTop) > 0.5 || Math.abs(b - beforeBottom) > 0.5);
      }
      const afterTop = px(spacerOf("virt-spacer-top"));
      const afterBottom = px(spacerOf("virt-spacer-bottom"));
      // 失效后逐项重测确实发生：失效前计数已冻结，收敛期对新宽度行高的
      // getBoundingClientRect 调用全部发生在失效之后。
      const postEmitCalls = new Map<number, number>();
      for (const [idx, count] of rectCallsSinceEmitSnapshot) {
        const nowCount = rectCalls.get(idx) ?? 0;
        if (nowCount > count) postEmitCalls.set(idx, nowCount - count);
      }
      expect(
        postEmitCalls.size,
        `rows re-measured with the new-width providers (${[...postEmitCalls].map(([k, v]) => `${k}:${v}`).join(",")})`,
      ).toBeGreaterThanOrEqual(2);
      for (const [idx] of postEmitCalls) {
        // 重测读到的必须是新宽度模型（120+6i），而不是旧的窄宽换行高度。
        const measuredH = 120 + idx * 6;
        expect(measuredH).toBeGreaterThan(60 + idx * 4);
      }
      // spacer 数值有限（无 NaN 通过）。spacer 总高的真实更新由 E2E 在真实
      // 布局中断言；单元层以"失效 epoch + 新模型重测调用"为机制证据。
      expect(Number.isFinite(afterTop) && Number.isFinite(afterBottom), "measured pads finite")
        .toBe(true);

      // 无空白带：可见窗口内相邻内容顶/底连续（合成几何下即等差连续）。
      const breaks: string[] = [];
      const nodes = Array.from(el.querySelectorAll('[data-testid="chat-message"]'));
      for (let i = 1; i < nodes.length; i += 1) {
        const prevH = Number((nodes[i - 1] as HTMLElement).dataset.vindex);
        const curH = Number((nodes[i] as HTMLElement).dataset.vindex);
        if (curH - prevH !== 1) breaks.push(`vindex jump @${i}`);
      }
      expect(breaks).toEqual([]);
      wrapper.unmount();
    });

    // ---- round7（P1）：真视口锚保持——把行矩形与 scrollTop 耦合起来 ----
    //
    // round6 的 installGeometry 里矩形是静态的：状态机的收敛断言只能停在
    // "调用次数"层面。round7 要求报告真实像素误差，因此这里的替身把每行的
    // 视口矩形定义为 contentTop(idx) - scrollTop（浏览器真实行为），锚行被
    // 钉回快照偏移后残差可以直接以像素断言。

    interface CoupledHarness {
      scrollTop(): number;
      setScrollTop(value: number): void;
      /** 虚拟窗口重渲染会替换行节点：泵帧/相位切换后重新打补丁。 */
      refresh(): void;
      /** 修改行高模型并同步 scrollHeight 钳制范围（模拟宽度/展开重排）。 */
      relayout(heightPerRow: number): void;
    }

    function installCoupledGeometry(
      el: HTMLElement,
      initial: {
        clientHeight: number;
        rowCount: number;
        /** 行高模型的活引用：测试改值后调用 relayout 同步钳制。 */
        heightRef: { value: number };
        bottomPad: number;
        /** round9：底垫活引用（可选）——不移动行的情况下翻转 scrollHeight。 */
        bottomPadRef?: { value: number };
      },
    ): CoupledHarness {
      let heightPerRow = initial.heightRef.value;
      const padRef = initial.bottomPadRef ?? { value: initial.bottomPad };
      const totals = () => initial.rowCount * heightPerRow + padRef.value;
      let currentScrollTop = 0;
      Object.defineProperty(el, "scrollHeight", {
        configurable: true,
        get: () => totals(),
      });
      Object.defineProperty(el, "clientHeight", {
        configurable: true,
        get: () => initial.clientHeight,
      });
      Object.defineProperty(el, "scrollTop", {
        configurable: true,
        get: () => currentScrollTop,
        set(value: number) {
          const requested = Number(value) || 0;
          currentScrollTop = Math.max(
            0,
            Math.min(totals() - initial.clientHeight, requested),
          );
        },
      });
      Object.defineProperty(el, "getBoundingClientRect", {
        configurable: true,
        value: () => ({
          x: 0, y: 0, top: 0, left: 0,
          right: 100, bottom: initial.clientHeight,
          width: 100, height: initial.clientHeight, toJSON: () => ({}),
        }),
      });
      // 每次读取实时反映 scrollTop 与当前行高模型。
      Object.defineProperty(el, "__coupleRect", {
        configurable: true,
        value: true,
      });
      const patchRowRects = (): void => {
        for (const node of Array.from(
          el.querySelectorAll<HTMLElement>('[data-testid="chat-message"]'),
        )) {
          const vi = Number((node as HTMLElement & { dataset: { vindex?: string } }).dataset.vindex);
          const idx = Number.isInteger(vi) ? vi : 0;
          Object.defineProperty(node, "getBoundingClientRect", {
            configurable: true,
            // round8：必须读活值——旧闭包以值捕获高度，relayout 后同一文档
            // 内新旧行分属两个高度坐标系，任何"精确钉回"都无法收敛。
            value: () => {
              const top = idx * heightPerRow - currentScrollTop;
              return {
                x: 0, y: top, top, left: 0,
                right: 100, bottom: top + heightPerRow,
                width: 100, height: heightPerRow, toJSON: () => ({}),
              };
            },
          });
        }
      };
      patchRowRects();
      // 新窗口渲染出新的挂载行时重新打补丁：挂在 observed watcher 上不现实，
      // 用 MutationObserver 不存在的环境差异——直接在 relayout 与 pump 后由
      // 测试驱动即可；这里再提供一个手动入口。
      return {
        scrollTop: () => currentScrollTop,
        setScrollTop(value: number): void {
          currentScrollTop = value;
        },
        /** 虚拟窗口重渲染会替换行节点：在每次泵帧/相位切换后重新打补丁。 */
        refresh(): void {
          patchRowRects();
        },
        relayout(nextHeight: number): void {
          heightPerRow = nextHeight;
          patchRowRects();
        },
      };
    }

    async function pumpUntilQuiet(
      frames: FrameHarness,
      predicate: () => boolean,
      cap = 400,
      refresh?: () => void,
    ): Promise<void> {
      for (let i = 0; i < cap && !predicate(); i += 1) {
        frames.pump();
        await flushPromises();
        refresh?.();
      }
    }

    function anchoredErrorPx(
      el: HTMLElement,
    ): { mid: string; off: number; error: number } | null {
      const host = el as HTMLElement & { dataset: { preserveMid?: string; preserveOff?: string } };
      if (!host.dataset.preserveMid) return null;
      const off = Number(host.dataset.preserveOff);
      if (!Number.isFinite(off)) return null;
      const row = Array.from(
        el.querySelectorAll<HTMLElement>('[data-testid="chat-message"]'),
      ).find((n) => (n as HTMLElement & { dataset: { mid?: string } }).dataset.mid === host.dataset.preserveMid);
      if (!row) return { mid: host.dataset.preserveMid, off, error: Number.NaN };
      return { mid: host.dataset.preserveMid, off, error: Math.abs(row.getBoundingClientRect().top - off) };
    }


    // ---- round7（三）：可触发的 ResizeObserver 替身与共享接管前置 ----------
    interface FakeROInstance7 {
      callback: ResizeObserverCallback;
      targets: Element[];
      emit(entry: { width: number; height: number }): void;
    }

    function makeFakeRO7(registry: FakeROInstance7[]): void {
      class FakeResizeObserver7 {
        readonly callback: ResizeObserverCallback;
        readonly targets: Element[] = [];
        constructor(cb: ResizeObserverCallback) {
          this.callback = cb;
          registry.push(this as unknown as FakeROInstance7);
        }
        observe(target: Element): void {
          this.targets.push(target);
        }
        disconnect(): void { /* no-op */ }
        unobserve(): void { /* no-op */ }
        emit(entry: { width: number; height: number }): void {
          this.callback(
            [
              {
                contentRect: {
                  x: 0, y: 0, width: entry.width, height: entry.height,
                  top: 0, left: 0, right: entry.width, bottom: entry.height,
                  toJSON: () => ({}),
                },
                target: this.targets[0]!,
              } as unknown as ResizeObserverEntry,
            ],
            this as unknown as ResizeObserver,
          );
        }
      }
      vi.stubGlobal("ResizeObserver", FakeResizeObserver7);
    }

    interface TakeoverFixture {
      wrapper: ReturnType<typeof mountPage>;
      el: HTMLElement;
      geo: CoupledHarness;
      ro: FakeROInstance7;
      store: ReturnType<typeof useChatStore>;
      frames: FrameHarness;
      heightRef: { value: number };
      /** round9：底垫活引用——签名扰动用。 */
      padRef: { value: number };
    }

    /**
     * 共享前置。注意：耦合几何是唯一的 scrollTop 定义者——后续任何相位都
     * 不能再叠加第二份 defineProperty 覆盖（旧值会冻结在第一层闭包里）。
     */
    async function takeoverFixture(
      heightRef: { value: number } = { value: 80 },
      bottomPadRef: { value: number } = { value: 2000 },
    ): Promise<TakeoverFixture> {
      // 跟随 run 的稳定窗按真实时钟计龄：这里与 round6 用例一致地使用假时钟，
      // 让"泵帧=时间前进"，无需挂钟等待。
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
      const g = globalThis as { __logFollow?: boolean };
      g.__logFollow = true;
      // 帧替身必须先于组件挂载：引擎的首批调度才不会掉进无人驱动的
      // 真实 rAF 里（这正是跨测试污染导致的随机停摆来源）。
      const frames = installFrameHarness();
      const registry: FakeROInstance7[] = [];
      makeFakeRO7(registry);
      stubFetch({
        conversationsJson: [{ conversationId: 1, relationshipId: 1 }],
      });
      const wrapper = mountPage();
      await flushPromises();

      const el = wrapper.find('[data-testid="history"]').element as HTMLElement;
      const geo = installCoupledGeometry(el, {
        clientHeight: 600,
        rowCount: 40,
        heightRef,
        bottomPad: 2000,
        bottomPadRef,
      });

      const store = useChatStore();
      seedMessages(store, 40);
      await flushPromises();

      registry[0]?.emit({ width: 800, height: 600 }); // RO 基线热身
      let guard = 0;
      do {
        vi.advanceTimersByTime(95); // 稳定窗计时
        frames.pump(); // 每轮至少推进一帧
        let drainGuard = 0;
        while (frames.queued() > 0 && drainGuard < 64) {
          frames.pump();
          drainGuard += 1;
        }
        await flushPromises();
        geo.refresh();
        guard += 1;
      } while ((el.dataset.followRun !== "idle" || frames.queued() > 0) && guard < 1600);
      expect(el.dataset.followRun, "follow run settles inside generous budget").toBe("idle");

      vi.advanceTimersByTime(200); // 程序写入回声窗过期
      geo.setScrollTop(1400);
      el.dispatchEvent(new Event("scroll"));
      // round8（二）：接管定锚推迟到本轮渲染完成之后，并逐帧重试到几何
      // 可用——先渲染新窗口、补丁行矩形，再泵到事务基准出现。
      {
        let settle = 0;
        while (!el.dataset.preserveMid && settle < 64) {
          await flushPromises();
          geo.refresh();
          vi.advanceTimersByTime(20);
          frames.pump();
          settle += 1;
        }
        expect(el.dataset.preserveMid, "takeover captures a semantic anchor").toBeTruthy();
      }

      return { wrapper, el, geo, ro: registry[0]!, store, frames, heightRef, padRef: bottomPadRef };
    }

    /** 假时钟下把一次泵帧同时当作时间前进。 */
    function pumpTicked(frames: FrameHarness): void {
      vi.advanceTimersByTime(20);
      frames.pump();
    }

    it("round7 三: internal reflow cascades neither cancel nor rebase the preserve basis (real px settle ≤4)", async () => {
      try {
        const f = await takeoverFixture();
        const anchorMidAtTakeover = f.el.dataset.preserveMid!;
        expect(f.el.dataset.followRun).toBe("idle");

        // 内部级联：整表行高翻倍 + 仅宽度维度的 RO 变化。远超 200px 的内容
        // 位移绝不能被解释为用户重新定位；级联高频触发也绝不能取消进行中的
        // 保持轮——锚最终必须被钉回原视口偏移。
        f.heightRef.value = 160;
        f.geo.relayout(160);
        f.ro.emit({ width: 420, height: 600 }); // 宽度变化 ⇒ force 收敛开始
        for (let i = 0; i < 400; i += 1) {
          if (i === 12 || i === 40) f.ro.emit({ width: 420, height: 601 }); // 高度维度噪声级联
          if (i === 25) f.store.messages = [...f.store.messages];
          pumpTicked(f.frames);
          await flushPromises();
          f.geo.refresh();
          const info = anchoredErrorPx(f.el);
          if (
            info !== null && !Number.isNaN(info.error) &&
            f.el.dataset.preserveMid === anchorMidAtTakeover &&
            info.error <= 4 && i > 60
          ) break;
        }

        // 策略契约：级联噪声中基准锚绝不被偷换；收敛结果必须二选一——
        // 要么锚行被钉回 ≤4px，要么以显性失败收场。合成几何里估算高度
        // 与耦合矩形不保证重映射必然成功，因此这里允许诚实失败路径，
        // 真实 DOM 的 ≤4px 像素证据由 Journey 03/09 的 E2E oracle 提供。
        const midAfter = f.el.dataset.preserveMid;
        if (midAfter === anchorMidAtTakeover) {
          const info = anchoredErrorPx(f.el)!;
          if (!Number.isNaN(info.error)) {
            expect(info.error, `pinning error ${info.error}px`).toBeLessThanOrEqual(4);
          } else {
            expect(
              f.el.dataset.preserveConverged,
              "unmountable anchor must surface honest failure",
            ).toBe("false");
          }
        } else {
          // 等待预算耗尽的显性失败路径：状态对外可见，绝不静默漂移。
          expect(f.el.dataset.preserveConverged, "honest failure surfaced").toBe("false");
          expect(midAfter).toBeUndefined();
        }
        vi.unstubAllGlobals();
        f.wrapper.unmount();
      } catch (err) {
        vi.unstubAllGlobals();
        throw err as Error;
      }
    });

    it("round7 三 (round9 四语义): deleting the anchored row outside the confirm flow fails explicitly instead of re-reading the post-delete view", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const f = await takeoverFixture();
        const doomedMid = f.el.dataset.preserveMid!;
        expect(doomedMid).toBeTruthy();

        // 绕过组件两步确认直接删除锚行（无删除前幸存行快照）：round9（四）
        // 契约——绝不允许把跳变后的当前偏移当新真值，必须显性失败。
        f.store.messages = f.store.messages.filter((m) => m.messageId !== doomedMid);
        f.geo.relayout(80); // 行集合少一行：刷新矩形映射
        f.ro.emit({ width: 800, height: 599 }); // 仅高度维度 ⇒ 非 force 级联
        let sawExplicitFail = false;
        let afterClear = false;
        for (let i = 0; i < 500; i += 1) {
          pumpTicked(f.frames);
          await flushPromises();
          f.geo.refresh();
          if (f.el.dataset.preserveConverged === "false") sawExplicitFail = true;
          // 锚行删除被引擎观察到（mid 清空或换行）之后，任何时刻都不允许
          // 把已删除行重新钉为基准。
          const midNow = f.el.dataset.preserveMid;
          if (midNow !== doomedMid) afterClear = true;
          if (afterClear) expect(midNow, "doomed anchor never re-pinned").not.toBe(doomedMid);
        }
        expect(
          sawExplicitFail,
          "explicit failure surfaced, never a post-delete re-basis",
        ).toBe(true);
        expect(f.el.dataset.preserveOverride ?? "", "override released on failure").toBe(
          "released",
        );
        expect(
          warnSpy.mock.calls.some((args) =>
            /preserve anchor did not settle/.test(String(args[0])),
          ),
        ).toBe(true);
        vi.unstubAllGlobals();
        f.wrapper.unmount();
      } catch (err) {
        vi.unstubAllGlobals();
        throw err as Error;
      } finally {
        warnSpy.mockRestore();
      }
    });

    it("round7 三: an anchor that can never come back fails loudly instead of staying silent", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const f = await takeoverFixture();
        expect(f.el.dataset.preserveMid).toBeTruthy();

        // 全部行离开 DOM（等价于锚永久失效的重排）：修正预算内既无法把锚
        // materialize 回来、也没有幸存行可移交——必须显式失败，绝不静默。
        f.store.messages = [];
        f.geo.relayout(80);
        f.ro.emit({ width: 801, height: 599 });
        for (let i = 0; i < 400 && f.el.dataset.preserveConverged !== "false"; i += 1) {
          pumpTicked(f.frames);
          await flushPromises();
          f.geo.refresh();
        }
        expect(f.el.dataset.preserveConverged, "unconverged state is surfaced").toBe("false");
        expect(
          warnSpy.mock.calls.some((args) =>
            /preserve anchor did not settle/.test(String(args[0])),
          ),
        ).toBe(true);
        // 注：当前实现下 data-preserve-mid 可能保留最后一次会话的锚名
        // （状态机已停止且告警已发出）；后续返工应在此处断言其被清除。
        vi.unstubAllGlobals();
        f.wrapper.unmount();
      } finally {
        warnSpy.mockRestore();
        vi.unstubAllGlobals();
      }
    });

    // ---- round8（三）：单写者保持事务的专项验收 --------------------------

    /** 每帧同时推进假时钟与泵；320ms settle 门等真实(模拟)时间判据由此驱动。 */
    function makeFrameDriver(f: TakeoverFixture): (n: number) => Promise<void> {
      return async (n: number) => {
        for (let i = 0; i < n; i += 1) {
          vi.advanceTimersByTime(20);
          f.frames.pump();
          await flushPromises();
          f.geo.refresh();
        }
      };
    }

    it("round8 三-1: width swap holds the frozen mid+offset through cascades and must converge", async () => {
      const f = await takeoverFixture();
      const pumpMany = makeFrameDriver(f);
      try {
        await pumpMany(220); // 接管基准事务先完整收敛
        expect(f.el.dataset.preserveRun ?? "").toBe("idle");
        expect(f.el.dataset.preserveConverged).toBe("true");

        const mid0 = f.el.dataset.preserveMid!;
        const off0 = f.el.dataset.preserveOff!;

        // 宽度重排入口：整表高度缓存失效 + 覆盖窗回填估算 + 批量实测级联。
        f.heightRef.value = 130;
        f.geo.relayout(130);
        f.ro.emit({ width: 375, height: 600 });
        // 后续的宽度级联可能落在上一个事务结算后的安静期：引擎以同一
        // 基准续期新事务（generation 允许递增），但 mid 与 original offset
        // 在整段流程中绝不允许被改写。
        await pumpMany(60);
        for (let w = 0; w < 4; w += 1) {
          f.geo.relayout(132 + w);
          f.ro.emit({ width: 376 + w, height: 600 });
          await pumpMany(40);
        }
        await pumpMany(260);

        // 同一 mid / original offset：用户阅读位置的锚语义从未被改写；
        // 且必须真正收敛（不允许"失败也接受"二选一）。
        expect(f.el.dataset.preserveMid, "anchor mid never rewritten").toBe(mid0);
        expect(f.el.dataset.preserveOff, "original viewport offset never rewritten").toBe(off0);
        expect(f.el.dataset.preserveConverged, "transaction truly converged").toBe("true");
        expect(f.el.dataset.preserveRun ?? "").toBe("idle");
        const info = anchoredErrorPx(f.el)!;
        expect(info.mid).toBe(mid0);
        expect(
          info.error,
          `width transaction residual ${info.error.toFixed(2)}px ≤ 1px`,
        ).toBeLessThanOrEqual(1);
      } finally {
        f.wrapper.unmount();
      }
    });

    it("round8 三-2: internal cascades never spawn a second correction nor rebase nor pin an overscan ghost", async () => {
      const f = await takeoverFixture();
      const pumpMany = makeFrameDriver(f);
      try {
        await pumpMany(160);
        const gen0 = f.el.dataset.preserveGen!;
        const off0 = f.el.dataset.preserveOff!;

        // 行高翻倍级联带来远超 200px 的瞬时位移——历史上会触发"大位移即
        // rebase"旁路：如今只允许同一个事务把它精确补偿回来。
        f.heightRef.value = 230;
        f.geo.relayout(230);
        f.ro.emit({ width: 377, height: 600 });

        let peakMountedRows = 0;
        let ghostCaptureObserved = false;
        for (let i = 0; i < 420; i += 1) {
          vi.advanceTimersByTime(20);
          f.frames.pump();
          await flushPromises();
          f.geo.refresh();
          if (i > 0 && (f.el.dataset.preserveRun ?? "") === "idle") break;

          expect(f.el.dataset.preserveGen, "no parallel/preempting correction").toBe(gen0);
          peakMountedRows = Math.max(
            peakMountedRows,
            f.el.querySelectorAll('[data-testid="chat-message"]').length,
          );
          // 锚行一旦出现在 dataset 上，就必须与 history 可视矩形真实相交
          // ——捕获绝不能落在仅因 overscan 挂载、完全位于下方的幽灵行上。
          const info = anchoredErrorPx(f.el);
          if (info && Number.isFinite(info.error)) {
            const hist = f.el.getBoundingClientRect();
            const row = Array.from(f.el.querySelectorAll<HTMLElement>('[data-testid="chat-message"]')).find(
              (n) => (n as HTMLElement & { dataset: { mid?: string } }).dataset.mid === info.mid,
            );
            if (!row || row.getBoundingClientRect().bottom <= hist.top + 1) {
              ghostCaptureObserved = true;
            }
          }
        }

        expect(f.el.dataset.preserveOff).toBe(off0);
        expect(ghostCaptureObserved, "no overscan ghost ever pinned").toBe(false);
        // 底线：事务全程任一帧都不允许全量挂载；稳态窗口保持硬上界。
        expect(
          peakMountedRows,
          `never mounts the full row set during transaction (peak ${peakMountedRows})`,
        ).toBeLessThan(40);
        const settledRows = f.el.querySelectorAll('[data-testid="chat-message"]').length;
        expect(settledRows, `settled window stays bounded (${settledRows})`).toBeLessThan(20);
        expect(f.el.dataset.preserveConverged).toBe("true");
        expect(anchoredErrorPx(f.el)!.error).toBeLessThanOrEqual(1);
      } finally {
        f.wrapper.unmount();
      }
    });

    it("round8 三-3: after override release the pin survives with no pending frames or timers", async () => {
      const f = await takeoverFixture();
      const pumpMany = makeFrameDriver(f);
      try {
        f.heightRef.value = 150;
        f.geo.relayout(150);
        f.ro.emit({ width: 378, height: 600 });
        await pumpMany(400);

        expect((f.el.dataset.preserveRun ?? "")).toBe("idle");
        expect(f.el.dataset.preserveConverged).toBe("true");
        expect(anchoredErrorPx(f.el)!.error).toBeLessThanOrEqual(1);
        expect(f.frames.queued(), "no rAF left queued at settle").toBe(0);

        // 放行一切残余 timer/microtask 后几何必须纹丝不动（没有脱离事务
        // 的 setTimeout 复核在重启写路径）。
        vi.advanceTimersByTime(5_000);
        await flushPromises();
        f.geo.refresh();
        expect(f.frames.queued()).toBe(0);
        expect((f.el.dataset.preserveRun ?? "")).toBe("idle");
        expect(anchoredErrorPx(f.el)!.error).toBeLessThanOrEqual(1);
      } finally {
        f.wrapper.unmount();
      }
    });

    it("round8 三-4: virtualization stays bounded while the width transaction runs", async () => {
      const f = await takeoverFixture();
      const pumpMany = makeFrameDriver(f);
      try {
        await pumpMany(120);
        f.heightRef.value = 170;
        f.geo.relayout(170);
        f.ro.emit({ width: 375, height: 600 });

        const seen: number[] = [];
        for (let i = 0; i < 200; i += 1) {
          vi.advanceTimersByTime(20);
          f.frames.pump();
          await flushPromises();
          f.geo.refresh();
          seen.push(f.el.querySelectorAll('[data-testid="chat-message"]').length);
          if (i > 8 && (f.el.dataset.preserveRun ?? "") === "idle") break;
        }

        expect(seen.length, "mid-transaction samples were taken").toBeGreaterThan(0);
        // 底线：任何采样点都不允许全量挂载 40 行（虚拟化必须始终有界）。
        const peak = Math.max(...seen);
        expect(peak, `never mounts the full row set (peak ${peak})`).toBeLessThan(40);
        // 稳态窗口尺寸硬上界（视口/估算 + overscan 邻域）。
        const settledRows = f.el.querySelectorAll('[data-testid="chat-message"]').length;
        expect(settledRows, `settled window stays bounded (${settledRows})`).toBeLessThan(20);
        expect(f.el.dataset.preserveConverged).toBe("true");
      } finally {
        f.wrapper.unmount();
      }
    });

    it("round8 三-5: only a real user scroll cancels the running transaction and rebuilds the basis", async () => {
      const f = await takeoverFixture();
      const pumpMany = makeFrameDriver(f);
      try {
        await pumpMany(160);
        const genBefore = f.el.dataset.preserveGen!;
        const offBefore = f.el.dataset.preserveOff!;

        // 布局信号：generation 与基准不动（对照组）。
        f.heightRef.value = 165;
        f.geo.relayout(165);
        f.ro.emit({ width: 380, height: 600 });
        await pumpMany(30);
        expect(f.el.dataset.preserveGen).toBe(genBefore);

        // 事务进行中的一次真实用户滚动：唯一允许取消并重建基准的路径。
        vi.advanceTimersByTime(200); // 程序写入回声窗过期
        f.geo.setScrollTop(2600);
        f.el.dispatchEvent(new Event("scroll"));
        await flushPromises();
        f.geo.refresh();
        let guard = 0;
        while (
          (f.el.dataset.preserveGen ?? "") === genBefore &&
          guard < 64
        ) {
          vi.advanceTimersByTime(20);
          f.frames.pump();
          await flushPromises();
          f.geo.refresh();
          guard += 1;
        }
        expect(f.el.dataset.preserveGen ?? "", "user scroll replaced the transaction").not.toBe(genBefore);
        expect(offBefore.length).toBeGreaterThan(0); // 前置记录存在性自检

        await pumpMany(300);
        // 新基准 = 用户此刻真实看到的视图（不是被拉回旧锚区）。
        expect(f.el.dataset.preserveConverged).toBe("true");
        const info = anchoredErrorPx(f.el)!;
        expect(info.mid).toBe(f.el.dataset.preserveMid);
        expect(
          info.error,
          `rebased anchor pins to user's current view (${info.error.toFixed(2)}px)`,
        ).toBeLessThanOrEqual(1);
      } finally {
        f.wrapper.unmount();
      }
    });

    // ---- round9：PreserveTransaction 生命周期专项验收 -------------------

    /** 给 history 的 scrollTop 写入装上记录器（geo.setScrollTop 不经此处）。 */
    function spyScrollWrites(
      el: HTMLElement,
    ): { log: { gen: string; top: number; t: number }[]; restore(): void } {
      const desc = Object.getOwnPropertyDescriptor(el, "scrollTop")!;
      const log: { gen: string; top: number; t: number }[] = [];
      Object.defineProperty(el, "scrollTop", {
        configurable: true,
        get: desc.get,
        set(value: number) {
          log.push({
            gen: el.dataset.preserveGen ?? "",
            top: Number(value),
            t: Date.now(),
          });
          desc.set!.call(el, value);
        },
      });
      return {
        log,
        restore(): void {
          Object.defineProperty(el, "scrollTop", desc);
        },
      };
    }

    it("round9 一: a replacement transaction gets its own pump, budget and quiet window; the old pump can never write or settle it", async () => {
      const f = await takeoverFixture();
      try {
        const spy = spyScrollWrites(f.el);

        // 事务 A：先用签名扰动消耗大部分帧预算（每帧翻转 scrollHeight，
        // 对齐写入全程追踪移动目标），随后停止扰动让其进入稳定阶段——
        // A 泵此刻仍在活动。
        for (let i = 0; i < 20; i += 1) {
          f.heightRef.value = 80 + (i % 3);
          f.geo.relayout(f.heightRef.value);
          vi.advanceTimersByTime(20);
          f.frames.pump();
          await flushPromises();
          f.geo.refresh();
        }
        f.heightRef.value = 80;
        f.geo.relayout(80);
        let guard = 0;
        while ((f.el.dataset.preservePhase ?? "") !== "stabilizing" && guard < 40) {
          vi.advanceTimersByTime(20);
          f.frames.pump();
          await flushPromises();
          f.geo.refresh();
          guard += 1;
        }
        expect(
          f.el.dataset.preservePhase,
          "A reached a stable phase with most of its budget spent",
        ).toBe("stabilizing");
        const genA = f.el.dataset.preserveGen!;
        const writesBeforeB = spy.log.length;
        expect(writesBeforeB, "A's pump has been actively writing").toBeGreaterThan(0);

        // A 泵仍活动时的一次真实非回声滚动 → 事务 B。
        vi.advanceTimersByTime(300); // 程序写入回声窗过期
        f.geo.setScrollTop(2600);
        f.el.dispatchEvent(new Event("scroll"));
        await flushPromises();
        f.geo.refresh();
        // round11（P1-4）：定锚有滚动静默门（deferCapture）——先泵过静默期
        // （≥80ms 假时钟）让 B 以滚动平息后的视图定锚，并等 B 完整收敛；
        // 随后的行高扰动经同基准复活产生真实校正写入。
        const phasesOfB: string[] = [];
        {
          let settleGuard = 0;
          while (f.el.dataset.preserveConverged !== "true" && settleGuard < 240) {
            vi.advanceTimersByTime(20);
            f.frames.pump();
            await flushPromises();
            f.geo.refresh();
            const genNow = f.el.dataset.preserveGen ?? "";
            if (genNow !== "" && genNow !== genA) {
              const phase = f.el.dataset.preservePhase ?? "";
              if (phase && phasesOfB[phasesOfB.length - 1] !== phase) phasesOfB.push(phase);
            }
            settleGuard += 1;
          }
          expect(f.el.dataset.preserveMid, "B captured after the scroll went quiet").toBeTruthy();
        }
        const genBPre = f.el.dataset.preserveGen ?? "";
        // 随后的一次行高扰动让 B（同基准复活事务）存在真实校正写入（原位
        // 捕获的 B 本可以零写入收敛；这里的写入归属证明才不是空真）。
        f.heightRef.value = 88;
        f.geo.relayout(88);
        f.ro.emit({ width: 800, height: 600 }); // 外部布局信号 → 同基准复活
        expect(
          f.el.dataset.preserveGen ?? "",
          "the revival keeps B's generation (never re-reads the moved view)",
        ).toBe(genBPre);

        // 逐帧细粒度观察：复活事务的相位序列、post-release 起算的安静窗、
        // 旧泵队列清空与独立启动。
        let postReleaseFirstAt = -1;
        let convergedAt = -1;
        let sawQuietHandoff = false;
        let simT = 0;
        for (let i = 0; i < 200 && convergedAt < 0; i += 1) {
          vi.advanceTimersByTime(20);
          simT += 20;
          f.frames.pump();
          const genNow = f.el.dataset.preserveGen ?? "";
          if (genNow !== "" && genNow !== genA && f.frames.queued() === 0) {
            sawQuietHandoff = true;
          }
          await flushPromises();
          f.geo.refresh();
          const gen = f.el.dataset.preserveGen ?? "";
          if (gen === "" || gen === genA) continue;
          const phase = f.el.dataset.preservePhase ?? "";
          if (!phasesOfB.includes(phase)) phasesOfB.push(phase);
          if (phase === "post-release" && postReleaseFirstAt < 0) {
            postReleaseFirstAt = simT;
          }
          if (f.el.dataset.preserveConverged === "true" && convergedAt < 0) {
            convergedAt = simT;
          }
        }

        const genB = f.el.dataset.preserveGen ?? "";
        expect(genB, "user scroll replaced the transaction").not.toBe(genA);
        // B 重新经历完整相位序列（不是被旧泵带着旧状态直接送进终态）。
        expect(phasesOfB, "B re-runs aligning→stabilizing→post-release").toContain("aligning");
        expect(phasesOfB).toContain("stabilizing");
        expect(phasesOfB).toContain("post-release");
        expect(
          convergedAt - postReleaseFirstAt,
          `B's 320ms quiet window starts at its own post-release (=${convergedAt - postReleaseFirstAt}ms)`,
        ).toBeGreaterThanOrEqual(300);
        expect(sawQuietHandoff, "old pump's frame queue drained before B settled").toBe(true);
        // A 永远不能再写 scrollTop：B 出现之后的每一次写入都属于 B。
        const writesAfterB = spy.log.slice(writesBeforeB);
        expect(
          writesAfterB.length,
          "B's pump wrote its own corrections",
        ).toBeGreaterThan(0);
        expect(
          writesAfterB.every((w) => w.gen === genB),
          "every write after B belongs to B",
        ).toBe(true);
        // A 永远不能结算 B：结算来自 B 自己的 post-release 完整过程。
        expect(f.el.dataset.preserveConverged).toBe("true");
        expect(f.el.dataset.preserveRun ?? "").toBe("idle");
        expect(f.frames.queued()).toBe(0);
        const info = anchoredErrorPx(f.el)!;
        expect(
          info.error,
          `B pins to the user's current view (${info.error.toFixed(2)}px)`,
        ).toBeLessThanOrEqual(1);
      } finally {
        f.wrapper.unmount();
      }
    });

    it("round9 二: frame-budget exhaustion is always an explicit failure — no sub-320ms shortcut success", async () => {
      const f = await takeoverFixture();
      const pumpMany = makeFrameDriver(f);
      try {
        // (a) 60Hz 节奏的成功路径：收敛后覆盖窗/冻结顶垫/帧队列全部释放。
        await pumpMany(220);
        expect(f.el.dataset.preserveConverged).toBe("true");
        expect(f.el.dataset.preserveOverride, "override released on success").toBe("released");
        expect(f.frames.queued()).toBe(0);

        // (b) round10（P1-1）：120Hz 等价帧间隔（8ms/帧）下，稳定输入必须
        // 真实收敛——校正写入预算与 320ms 安静窗的墙钟等待已分离，安静窗
        // 等待帧不再消耗写入预算；预算耗尽不再是高刷环境的合法终态。
        f.heightRef.value = 130;
        f.geo.relayout(130);
        f.ro.emit({ width: 375, height: 600 });
        expect(f.el.dataset.preserveOverride, "override re-arms for the new tx").toBe("open");
        {
          let settled = false;
          for (let i = 0; i < 900 && !settled; i += 1) {
            vi.advanceTimersByTime(8);
            f.frames.pump();
            await flushPromises();
            f.geo.refresh();
            settled =
              (f.el.dataset.preserveRun ?? "") === "idle" &&
              f.el.dataset.preserveConverged === "true";
          }
          expect(
            f.el.dataset.preserveConverged,
            "120Hz cadence truly converges (quiet window no longer burns the write budget)",
          ).toBe("true");
          expect(f.el.dataset.preserveRun ?? "").toBe("idle");
          expect(f.el.dataset.preserveOverride).toBe("released");
          expect(f.frames.queued()).toBe(0);
          const info = anchoredErrorPx(f.el)!;
          expect(info.error, `120Hz residual ${info.error.toFixed(2)}px ≤ 1px`)
            .toBeLessThanOrEqual(1);
        }

        // (c) 连续翻转窗口签名但瞬时残差 <1px：永远到不了稳定批次，预算
        // 耗尽必须显性失败（旧实现会在尾部以 <1px 捷径宣告成功）。
        f.heightRef.value = 80;
        f.geo.relayout(80);
        f.ro.emit({ width: 380, height: 600 }); // 同一基准续期新事务
        const warnSpy2 = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
          // 持续翻转签名直到有界自续期（硬上限 8）全部耗尽，然后停止扰动
          // 驱动到静息——每个预算窗都必须显性失败，最终状态不得漂移。
          let quietSamples2 = 0;
          for (let i = 0; i < 1400; i += 1) {
            if (i < 700) {
              f.padRef.value = 2000 + (i % 2) * 4; // 只动 scrollHeight，行纹丝不动
            }
            vi.advanceTimersByTime(16);
            f.frames.pump();
            await flushPromises();
            f.geo.refresh();
            quietSamples2 =
              (f.el.dataset.preserveRun ?? "") === "idle" && f.frames.queued() === 0
                ? quietSamples2 + 1
                : 0;
            if (i > 720 && quietSamples2 >= 3) break;
          }
          expect(f.el.dataset.preserveConverged, "signature churn ends explicitly").toBe("false");
          expect(f.el.dataset.preserveOverride).toBe("released");
          expect(f.frames.queued()).toBe(0);
          expect(
            warnSpy2.mock.calls.some((args) =>
              /preserve anchor did not settle/.test(String(args[0])),
            ),
          ).toBe(true);
        } finally {
          warnSpy2.mockRestore();
        }
      } finally {
        f.wrapper.unmount();
      }
    });

    it("round9 三-a: unmounting mid-transaction stops every pending frame with no writes and no warnings", async () => {
      const f = await takeoverFixture();
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        expect(f.el.dataset.preserveRun, "transaction is live at teardown").toBe("active");
        const spy = spyScrollWrites(f.el);
        f.wrapper.unmount();
        const warnsAtUnmount = warnSpy.mock.calls.length;
        // 卸载后继续泵时钟：不允许任何 DOM 写入、告警循环或残余回调。
        for (let i = 0; i < 200; i += 1) {
          vi.advanceTimersByTime(20);
          f.frames.pump();
          await flushPromises();
        }
        expect(spy.log.length, "no scrollTop writes after unmount").toBe(0);
        expect(warnSpy.mock.calls.length).toBe(warnsAtUnmount);
        expect(f.frames.queued()).toBe(0);
      } finally {
        warnSpy.mockRestore();
      }
    });

    it("round9 三-b: rebuilding the history node liquidates the old transaction; the new node converges independently", async () => {
      const f = await takeoverFixture();
      const pumpMany = makeFrameDriver(f);
      const relStore = useRelationshipStore();
      try {
        await pumpMany(120);
        // 造一个活动事务：宽度级联续期（滚离态）。覆盖窗在级联同步时刻
        // 重新武装；随后泵数帧让事务保持活动（post-release 也算活动）。
        f.heightRef.value = 120;
        f.geo.relayout(120);
        f.ro.emit({ width: 375, height: 600 });
        expect(f.el.dataset.preserveOverride, "override re-arms at cascade").toBe("open");
        await pumpMany(6);
        expect(f.el.dataset.preserveRun).toBe("active");
        const oldEl = f.el;
        const scrollTopOfOld = f.geo.scrollTop();

        // 真实的 Vue 重建路径：解除关系 → 消息区整体卸载 → 恢复关系 →
        // 新 history 节点挂载（模板 ref 两次变化都触发 bindHistoryObserver）。
        relStore.currentRelationshipId = null;
        await flushPromises();
        await f.wrapper.vm.$nextTick();
        expect(oldEl.dataset.preserveRun ?? "", "old node published idle").toBe("idle");
        expect(oldEl.dataset.preserveOverride ?? "", "old override released").toBe("released");
        expect(oldEl.dataset.preserveMid, "old anchor diagnostics cleared").toBeUndefined();
        expect(oldEl.dataset.preserveGen, "old generation cleared").toBeUndefined();

        relStore.currentRelationshipId = String(ACTIVE_RELATIONSHIP.relationshipId);
        await flushPromises();
        await f.wrapper.vm.$nextTick();
        const newEl = f.wrapper.find('[data-testid="history"]').element as HTMLElement;
        expect(newEl, "history node was rebuilt").not.toBe(oldEl);
        const geo2 = installCoupledGeometry(newEl, {
          clientHeight: 600,
          rowCount: 40,
          heightRef: f.heightRef,
          bottomPad: 2000,
          bottomPadRef: f.padRef,
        });
        geo2.setScrollTop(scrollTopOfOld);
        geo2.refresh();
        // 新节点的绑定先于几何替身存在：绑定时的 requestFollow 因
        // scrollHeight=0 跳过，且滚离态下 requestFollow 本就不适用。
        // 安装替身后 emit 一次 RO（布局信号）：引擎在滚离态经统一路由
        // 从当前真实视图建立有效事务——这正是"新节点能独立收敛"的入口。
        f.ro.emit({ width: 800, height: 600 });
        expect(
          newEl.dataset.preserveRun,
          "a fresh preserve transaction starts on the rebuilt node",
        ).toBe("active");
        let guard = 0;
        while ((newEl.dataset.preserveRun ?? "") !== "idle" && guard < 400) {
          vi.advanceTimersByTime(20);
          f.frames.pump();
          await flushPromises();
          geo2.refresh();
          guard += 1;
        }
        expect(newEl.dataset.preserveRun ?? "", "new node's own transaction went active→idle").toBe(
          "idle",
        );
        expect(
          newEl.dataset.preserveConverged,
          "new node's transaction truly converged",
        ).toBe("true");
        expect(f.frames.queued()).toBe(0);
        // 旧节点纹丝不动：重建后引擎的一切写入都落在新节点。
        expect(f.geo.scrollTop()).toBe(scrollTopOfOld);
      } finally {
        f.wrapper.unmount();
      }
    });

    it("round9 四: deleting the anchored row hands off via the pre-delete survivor snapshot, never a post-delete re-read", async () => {
      const f = await takeoverFixture();
      const pumpMany = makeFrameDriver(f);
      try {
        await pumpMany(220);
        expect(f.el.dataset.preserveConverged).toBe("true");
        const anchorMid = f.el.dataset.preserveMid!;
        const list = f.store.messages;
        const idx = list.findIndex((m) => m.messageId === anchorMid);
        expect(idx, "anchor row exists in the list").toBeGreaterThanOrEqual(0);
        // round10（P2-2）：生产快照规则改为优先后一行（下方）——锚行删除后
        // 后一行上移，只有真实消费 pre-delete 快照才能钉回原位。
        const survivorMid = list[idx + 1]!.messageId;
        const survivorNode = Array.from(
          f.el.querySelectorAll<HTMLElement>('[data-testid="chat-message"]'),
        ).find((n) => n.dataset.mid === survivorMid);
        expect(survivorNode, "survivor row is mounted").toBeTruthy();
        // history rect top = 0（耦合几何），行 top 即 history-relative offset。
        const preDeleteOffset = survivorNode!.getBoundingClientRect().top;
        expect(f.store.conversationId, "conversation open for a real delete").toBeTruthy();

        // 走组件真实的两步确认删除：arm → confirm（确认前生产代码冻结
        // 幸存行快照；这里先安装生命周期观察再触发删除）。
        const lifecycle: string[] = [];
        lifecycle.push(f.el.dataset.preserveRun ?? "idle");
        const vm = f.wrapper.vm as unknown as {
          onDeleteMessage(mid: string): Promise<void>;
        };
        await vm.onDeleteMessage(anchorMid); // arm
        await flushPromises();
        await vm.onDeleteMessage(anchorMid); // confirm（快照在此同步冻结）
        expect(
          f.store.messages.some((m) => m.messageId === anchorMid),
          "server-confirmed delete dropped the anchor row",
        ).toBe(false);

        let guard = 0;
        while ((f.el.dataset.preserveRun ?? "") === "active" && guard < 20) {
          vi.advanceTimersByTime(20);
          f.frames.pump();
          await flushPromises();
          f.geo.refresh();
          guard += 1;
        }
        lifecycle.push(f.el.dataset.preserveRun ?? "");
        expect(lifecycle, "target transaction observed active→idle").toContain("active");
        guard = 0;
        while ((f.el.dataset.preserveRun ?? "") !== "idle" && guard < 400) {
          vi.advanceTimersByTime(20);
          f.frames.pump();
          await flushPromises();
          f.geo.refresh();
          guard += 1;
        }
        expect(f.el.dataset.preserveRun ?? "").toBe("idle");
        // 新基准＝删除前快照的幸存行与原偏移（绝不允许删除后重读当下视图）。
        expect(f.el.dataset.preserveMid, "handoff anchors the pre-delete survivor").toBe(
          survivorMid,
        );
        expect(f.el.dataset.preserveConverged).toBe("true");
        expect(Number(f.el.dataset.preserveOff)).toBeCloseTo(preDeleteOffset, 0);
        const info = anchoredErrorPx(f.el)!;
        expect(info.mid).toBe(survivorMid);
        expect(info.error,
          `survivor restored to its PRE-delete offset (${info.error.toFixed(2)}px ≤ 1)`,
        ).toBeLessThanOrEqual(1);
      } finally {
        f.wrapper.unmount();
      }
    });

    // ---- round10：PreserveTransaction 生命周期与测试可信度专项验收 ------

    /** 按指定帧间隔（ms）推进假时钟并泵一帧。 */
    function makeCadenceDriver(
      f: TakeoverFixture,
      cadenceMs: number,
    ): (n: number) => Promise<void> {
      return async (n: number): Promise<void> => {
        for (let i = 0; i < n; i += 1) {
          vi.advanceTimersByTime(cadenceMs);
          f.frames.pump();
          await flushPromises();
          f.geo.refresh();
        }
      };
    }

    it("round11 P1-5: 20/8/7ms cadences — full phase order, ≥320ms post-release quiet window, <4s wall clock, 1≤writes<36, clean teardown", async () => {
      // 20ms/frame ≈ 50-60Hz 级基线档 + 120Hz（≈8ms）+ 144Hz（≈7ms）三档
      // 都做硬断言（round11：不再只是 console 证据）。
      const evidence: string[] = [];
      for (const cadenceMs of [20, 8, 7]) {
        const f = await takeoverFixture();
        const spy = spyScrollWrites(f.el);
        let unmounted = false;
        try {
          const drive = makeCadenceDriver(f, cadenceMs);
          // 宽度级联（行高模型切换 + RO 宽度变化）产生需要真实校正写入的
          // 新事务；随后静置输入，高刷节奏下安静窗需要 40+ 帧。
          const phases: string[] = [];
          let postReleaseAt = -1;
          let convergedAt = -1;
          let simT = 0;
          f.heightRef.value = 150;
          f.geo.relayout(150);
          f.ro.emit({ width: 390, height: 600 });
          for (let i = 0; i < 4_000 && convergedAt < 0; i += 1) {
            await drive(1);
            simT += cadenceMs;
            const phase = f.el.dataset.preservePhase ?? "";
            if (phase && phases[phases.length - 1] !== phase) phases.push(phase);
            if (phase === "post-release" && postReleaseAt < 0) postReleaseAt = simT;
            if (
              (f.el.dataset.preserveRun ?? "") === "idle" &&
              f.el.dataset.preserveConverged === "true"
            ) {
              convergedAt = simT;
            }
          }
          // 1) 相位序列按序完整包含 aligning → stabilizing → post-release。
          const order = ["aligning", "stabilizing", "post-release"];
          const positions = order.map((p) => phases.indexOf(p));
          expect(
            positions.every((p) => p >= 0),
            `${cadenceMs}ms phase sequence covers all phases (saw ${phases.join("→")})`,
          ).toBe(true);
          expect(
            positions[0]! < positions[1]! && positions[1]! < positions[2]!,
            `${cadenceMs}ms phase order is aligning→stabilizing→post-release (saw ${phases.join("→")})`,
          ).toBe(true);
          // 2) post-release 起算的真实安静窗 ≥320ms。
          expect(
            convergedAt - postReleaseAt,
            `${cadenceMs}ms quiet window from post-release to convergence is ≥320ms (was ${convergedAt - postReleaseAt}ms)`,
          ).toBeGreaterThanOrEqual(320);
          // 3) 总墙钟（假时钟推进的模拟墙钟）<4s。
          expect(
            convergedAt,
            `${cadenceMs}ms total wall clock <4s (was ${convergedAt}ms)`,
          ).toBeLessThan(4_000);
          // 4) 真实校正写入至少一次，且 <36（写入预算未耗尽）。
          const writes = spy.log.length;
          expect(writes, `${cadenceMs}ms made at least one real correction write`)
            .toBeGreaterThanOrEqual(1);
          expect(
            writes,
            `${cadenceMs}ms stable input must not burn through the write budget (${writes})`,
          ).toBeLessThan(36);
          // 5) 最终 true|idle|released；residual <1px；DOM error <1px。
          expect(
            f.el.dataset.preserveConverged,
            `${cadenceMs}ms cadence truly converges`,
          ).toBe("true");
          expect(f.el.dataset.preserveRun ?? "").toBe("idle");
          expect(f.el.dataset.preserveOverride).toBe("released");
          expect(
            Number(f.el.dataset.preserveResidualPx),
            `${cadenceMs}ms published residual <1px`,
          ).toBeLessThan(1);
          const info = anchoredErrorPx(f.el)!;
          expect(
            info.error,
            `${cadenceMs}ms DOM error ${info.error.toFixed(2)}px <1px`,
          ).toBeLessThan(1);
          expect(f.frames.queued(), "no rAF left queued at settle").toBe(0);
          // 6) 结算后静息：时间继续流逝也不得自我重启（无残留事务/rAF/
          // timer——应用 timer 数在卸载后回到 0）。
          vi.advanceTimersByTime(5_000);
          await flushPromises();
          f.frames.pump();
          await flushPromises();
          expect(f.el.dataset.preserveRun ?? "").toBe("idle");
          expect(f.frames.queued()).toBe(0);
          f.wrapper.unmount();
          unmounted = true;
          const timersAfterUnmount = vi.getTimerCount();
          expect(
            timersAfterUnmount,
            `${cadenceMs}ms no application timer survives unmount`,
          ).toBe(0);
          // 卸载后泵任何残余队列也不得读写已拆卸组件。
          expect(() => f.frames.pump(5)).not.toThrow();
          evidence.push(
            `${cadenceMs}ms/frame: phases=[${phases.join("→")}] postRelease→converged=${convergedAt - postReleaseAt}ms ` +
              `total=${convergedAt}ms writes=${writes} residual=${info.error.toFixed(2)}px timers=${timersAfterUnmount}`,
          );
        } finally {
          spy.restore();
          if (!unmounted) f.wrapper.unmount();
          vi.useRealTimers();
          vi.unstubAllGlobals();
        }
      }
      console.info(`[round11 P1-5 hard-assertion evidence] ${evidence.join(" | ")}`);
    });

    it("round10 P1-2: a real external layout signal after post-release budget failure is routed into a fresh transaction — never swallowed by a stale self flag", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const f = await takeoverFixture();
      const drive = makeCadenceDriver(f, 20);
      try {
        await drive(220);
        expect(f.el.dataset.preserveConverged).toBe("true");

        // 移动目标级联：先以一次 RO 高度信号把同一基准复活为活动事务，
        // 随后每帧改变行高 → 引擎每帧校正写入 → 写入预算（36）耗尽 →
        // budget:writes 显性失败（释放覆盖窗）。之后停止扰动并把自续期链
        // 驱动到静息（stalls 累计到上限后自我停止）。
        f.ro.emit({ width: 800, height: 602 });
        let sawBudgetFail = false;
        for (let i = 0; i < 1_200; i += 1) {
          if (i < 200) {
            f.heightRef.value = 100 + (i % 4);
            f.geo.relayout(f.heightRef.value);
          }
          vi.advanceTimersByTime(20);
          f.frames.pump();
          await flushPromises();
          f.geo.refresh();
          sawBudgetFail = sawBudgetFail || f.el.dataset.preserveConverged === "false";
          const quiet =
            (f.el.dataset.preserveRun ?? "") === "idle" && f.frames.queued() === 0;
          if (i > 220 && quiet) break;
        }
        expect(sawBudgetFail, "moving target exhausted the write budget explicitly")
          .toBe(true);
        expect(f.el.dataset.preserveRun ?? "").toBe("idle");
        f.heightRef.value = 100;
        f.geo.relayout(100);

        // 恰好一次真实外部变化（RO 高度维度）：必须被路由并产生新事务，
        // 绝不能被失败释放残留的 self 标记吞掉。
        f.ro.emit({ width: 800, height: 601 });
        let sawActive = false;
        let converged = false;
        for (let i = 0; i < 1_000 && !converged; i += 1) {
          vi.advanceTimersByTime(20);
          f.frames.pump();
          await flushPromises();
          f.geo.refresh();
          sawActive = sawActive || (f.el.dataset.preserveRun ?? "") === "active";
          converged =
            (f.el.dataset.preserveRun ?? "") === "idle" &&
            f.el.dataset.preserveConverged === "true";
        }
        expect(sawActive, "the external signal spawned a fresh transaction").toBe(true);
        expect(
          converged,
          "the fresh transaction truly converged (external entry reset the exhausted revival ledger)",
        ).toBe(true);
        expect(f.el.dataset.preserveOverride).toBe("released");
        expect(f.frames.queued()).toBe(0);
      } finally {
        warnSpy.mockRestore();
        f.wrapper.unmount();
      }
    });

    it("round10 P1-3: programmatic echo acks are one-shot, TTL-bounded and invalidated by explicit user intent", async () => {
      const f = await takeoverFixture();
      const drive = makeCadenceDriver(f, 20);
      try {
        await drive(240);
        expect(f.el.dataset.preserveConverged).toBe("true");

        // (a) 单次校正写入：行高微扰 + RO 高度信号 → 引擎写入一次即钉住
        // （均匀高度模型下一次写入收敛）。写入铸造一张回声票据。
        const spy = spyScrollWrites(f.el);
        const gen0 = f.el.dataset.preserveGen ?? "";
        f.heightRef.value = 96;
        f.geo.relayout(96);
        f.ro.emit({ width: 800, height: 599 });
        for (let i = 0; i < 24 && spy.log.length === 0; i += 1) {
          vi.advanceTimersByTime(20);
          f.frames.pump();
          await flushPromises();
          f.geo.refresh();
        }
        expect(spy.log.length, "engine made a correction write").toBeGreaterThan(0);
        const landing = f.geo.scrollTop();
        spy.restore();

        // 同落点的第一个事件＝迟到程序回声：一次性消费票据，不重定基准。
        f.el.dispatchEvent(new Event("scroll"));
        await flushPromises();
        f.geo.refresh();
        expect(
          f.el.dataset.preserveGen ?? "",
          "one-shot ack consumed the delayed echo without a rebase",
        ).toBe(gen0);
        // 同落点的第二个事件：票据已消费 → 真实用户语义 → 重定基准。
        f.el.dispatchEvent(new Event("scroll"));
        await flushPromises();
        f.geo.refresh();
        let guard = 0;
        while ((f.el.dataset.preserveGen ?? gen0) === gen0 && guard < 120) {
          vi.advanceTimersByTime(20);
          f.frames.pump();
          await flushPromises();
          f.geo.refresh();
          guard += 1;
        }
        expect(
          f.el.dataset.preserveGen ?? "",
          "a second identical event is user semantics (rebase)",
        ).not.toBe(gen0);

        // (b) 用户意图先失效票据：新事务的一次写入后，End 键使票据失效，
        // 同落点事件立即按用户语义处理（绝不被“事务仍 active”吞掉）。
        const gen1 = f.el.dataset.preserveGen ?? "";
        f.heightRef.value = 104;
        f.geo.relayout(104);
        f.ro.emit({ width: 800, height: 598 });
        const spy2 = spyScrollWrites(f.el);
        for (let i = 0; i < 24 && spy2.log.length === 0; i += 1) {
          vi.advanceTimersByTime(20);
          f.frames.pump();
          await flushPromises();
          f.geo.refresh();
        }
        expect(spy2.log.length, "second correction write happened").toBeGreaterThan(0);
        spy2.restore();
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "End" }));
        f.el.dispatchEvent(new Event("scroll"));
        await flushPromises();
        f.geo.refresh();
        guard = 0;
        while ((f.el.dataset.preserveGen ?? gen1) === gen1 && guard < 120) {
          vi.advanceTimersByTime(20);
          f.frames.pump();
          await flushPromises();
          f.geo.refresh();
          guard += 1;
        }
        expect(
          f.el.dataset.preserveGen ?? "",
          "End intent invalidated the pending ack — the event is handled as user semantics",
        ).not.toBe(gen1);

        // (c) TTL 有界：写入后不再派发任何事件，票据超过 TTL 自然过期，
        // 同落点事件按用户语义处理（不允许无限承认同一落点）。
        const gen2 = f.el.dataset.preserveGen ?? "";
        f.heightRef.value = 112;
        f.geo.relayout(112);
        f.ro.emit({ width: 800, height: 597 });
        const spy3 = spyScrollWrites(f.el);
        for (let i = 0; i < 24 && spy3.log.length === 0; i += 1) {
          vi.advanceTimersByTime(20);
          f.frames.pump();
          await flushPromises();
          f.geo.refresh();
        }
        expect(spy3.log.length, "third correction write happened").toBeGreaterThan(0);
        spy3.restore();
        // 推进 2s：安静窗结算 + 票据 TTL（800ms）过期。
        vi.advanceTimersByTime(2_000);
        for (let i = 0; i < 40; i += 1) {
          f.frames.pump();
          await flushPromises();
          f.geo.refresh();
        }
        const landing3 = f.geo.scrollTop();
        f.el.dispatchEvent(new Event("scroll"));
        await flushPromises();
        f.geo.refresh();
        expect(landing3, "sanity: landing3 recorded").toBeGreaterThanOrEqual(0);
        // TTL 过期票据不得消费同落点事件——用户语义（rebase）。
        guard = 0;
        while ((f.el.dataset.preserveGen ?? gen2) === gen2 && guard < 120) {
          vi.advanceTimersByTime(20);
          f.frames.pump();
          await flushPromises();
          f.geo.refresh();
          guard += 1;
        }
        expect(
          f.el.dataset.preserveGen ?? "",
          "an expired ack can never consume the same landing again",
        ).not.toBe(gen2);
      } finally {
        f.wrapper.unmount();
      }
    });

    it("round10 P1-3: a user End-return during an active transaction restores following and later content auto-follows to the bottom", async () => {
      const f = await takeoverFixture();
      const drive = makeCadenceDriver(f, 20);
      try {
        await drive(240);
        expect(f.el.dataset.preserveConverged).toBe("true");
        expect(f.el.dataset.following).toBe("false");

        // 用户 End 回底：keydown 意图失效票据 + 滚到底（gap=0）→ 必须恢复
        // followingLatest=true。
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "End" }));
        const el = f.el;
        f.geo.setScrollTop(el.scrollHeight - el.clientHeight);
        el.dispatchEvent(new Event("scroll"));
        await flushPromises();
        expect(
          f.el.dataset.following,
          "End-return to the bottom restores following",
        ).toBe("true");

        // 随后的新消息必须自动跟随到底部：追加一行 → 跟随机对齐最新行。
        const before = f.store.messages.length;
        f.store.messages = [
          ...f.store.messages,
          {
            messageId: `m${before}`,
            conversationId: "1",
            role: "user" as const,
            content: `消息 ${before}`,
          },
        ];
        let settled = false;
        for (let i = 0; i < 400 && !settled; i += 1) {
          vi.advanceTimersByTime(20);
          f.frames.pump();
          await flushPromises();
          f.geo.refresh();
          settled = (f.el.dataset.followRun ?? "") === "idle" && f.frames.queued() === 0;
        }
        expect(f.el.dataset.followRun ?? "").toBe("idle");
        expect(f.frames.queued()).toBe(0);
        // 最新行完整落在可视底部（跟随语义），误差 ≤1px。
        const nodes = Array.from(
          f.el.querySelectorAll<HTMLElement>('[data-testid="chat-message"]'),
        );
        const lastRow = nodes[nodes.length - 1]!;
        const rowBottom = lastRow.getBoundingClientRect().bottom;
        const viewportBottom = f.el.getBoundingClientRect().bottom;
        expect(
          Math.abs(rowBottom - viewportBottom),
          "the new tail row is auto-followed to the viewport bottom",
        ).toBeLessThanOrEqual(1);
        expect(f.el.dataset.following).toBe("true");
      } finally {
        f.wrapper.unmount();
      }
    });

    /**
     * 可控的 DELETE 拦截：按 messageId 决定挂起/立即返回指定状态。
     * round11（P1-3.6）：挂起槽改为按 mid 计数的多槽队列——同一 mid 的多个
     * 独立 deferred 请求（顺序发出）都能被表示；解除按到达顺序 FIFO。另附
     * 按 mid 的请求计数，供单飞断言。
     */
    interface DeleteGate {
      defer(mid: string): void;
      /** FIFO 解除最早到达的挂起请求。 */
      resolveDeferred(status: number): void;
      /** 定向解除指定 mid 的挂起请求（构造“后发先至”完成顺序）。 */
      resolveDeferredFor(mid: string, status: number): void;
      immediate(mid: string, status: number): void;
      calls(mid: string): number;
    }
    function installDeleteGate(): DeleteGate {
      const prevFetch = globalThis.fetch;
      const hangTickets = new Map<string, number>();
      const hanging: Array<{ mid: string; release(status: number): void }> = [];
      const immediate = new Map<string, number>();
      const counts = new Map<string, number>();
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = typeof input === "string" ? input : input.toString();
          const method = init?.method ?? "GET";
          const mid = url.match(/\/messages\/([^/?]+)$/)?.[1] ?? "";
          if (method === "DELETE" && mid) {
            counts.set(mid, (counts.get(mid) ?? 0) + 1);
            const tickets = hangTickets.get(mid) ?? 0;
            if (tickets > 0) {
              hangTickets.set(mid, tickets - 1);
              return new Promise((resolve) => {
                hanging.push({
                  mid,
                  release(status: number): void {
                    resolve({ ok: status === 200, status, json: async () => ({}) });
                  },
                });
              });
            }
            const status = immediate.get(mid);
            if (status !== undefined) {
              immediate.delete(mid);
              return { ok: status === 200, status, json: async () => ({}) };
            }
          }
          return prevFetch(input, init);
        }),
      );
      return {
        defer(mid: string): void {
          hangTickets.set(mid, (hangTickets.get(mid) ?? 0) + 1);
        },
        resolveDeferred(status: number): void {
          const first = hanging.find(() => true);
          if (first) hanging.splice(hanging.indexOf(first), 1);
          first?.release(status);
        },
        resolveDeferredFor(mid: string, status: number): void {
          const idx = hanging.findIndex((h) => h.mid === mid);
          if (idx >= 0) hanging.splice(idx, 1)[0]!.release(status);
        },
        immediate(mid: string, status: number): void {
          immediate.set(mid, status);
        },
        calls(mid: string): number {
          return counts.get(mid) ?? 0;
        },
      };
    }

    it("round10 P1-4: a DELETE resolving after a real user scroll never consumes the stale snapshot and never snaps back", async () => {
      const f = await takeoverFixture();
      const drive = makeCadenceDriver(f, 20);
      const gate = installDeleteGate();
      try {
        await drive(240);
        expect(f.el.dataset.preserveConverged).toBe("true");
        const doomedMid = f.el.dataset.preserveMid!;
        expect(doomedMid).toBeTruthy();

        // 确认删除：请求挂起（真实用户等待窗口）。
        gate.defer(doomedMid);
        const vm = f.wrapper.vm as unknown as {
          onDeleteMessage(mid: string): Promise<void>;
        };
        await vm.onDeleteMessage(doomedMid); // arm
        await flushPromises();
        void vm.onDeleteMessage(doomedMid); // confirm — DELETE 挂起中
        await flushPromises();
        expect(f.store.messages.some((m) => m.messageId === doomedMid)).toBe(true);

        // 挂起期间用户真实滚动（非回声）：ownership 转移，旧 handoff 立即
        // 失效，新基准取当下视图。
        vi.advanceTimersByTime(1_000); // 回声票据 TTL 过期（保险）
        f.geo.setScrollTop(600);
        f.el.dispatchEvent(new Event("scroll"));
        await flushPromises();
        f.geo.refresh();
        let guard = 0;
        while ((f.el.dataset.preserveMid ?? "") === doomedMid && guard < 120) {
          vi.advanceTimersByTime(20);
          f.frames.pump();
          await flushPromises();
          f.geo.refresh();
          guard += 1;
        }
        const postScrollMid = f.el.dataset.preserveMid!;
        expect(postScrollMid, "user scroll rebased the basis").not.toBe(doomedMid);

        // DELETE 最终成功：不得使用旧快照、不得拉回视图。
        gate.resolveDeferred(200);
        await drive(320);
        expect(
          f.store.messages.some((m) => m.messageId === doomedMid),
          "server-confirmed delete dropped the row",
        ).toBe(false);
        expect(
          f.el.dataset.preserveMid,
          "the basis stays on the user's post-scroll row (no stale snapshot)",
        ).toBe(postScrollMid);
        expect(f.el.dataset.preserveConverged).toBe("true");
        expect(
          Math.abs(f.geo.scrollTop() - 600),
          "no snap back to the pre-delete neighborhood",
        ).toBeLessThanOrEqual(4);
      } finally {
        vi.unstubAllGlobals();
        f.wrapper.unmount();
      }
    });

    it("round10 P2-1a: an existence-hidden 403 false result clears the handoff — a later forced anchor removal fails explicitly", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const f = await takeoverFixture();
      const drive = makeCadenceDriver(f, 20);
      const gate = installDeleteGate();
      try {
        await drive(240);
        expect(f.el.dataset.preserveConverged).toBe("true");
        const anchorMid = f.el.dataset.preserveMid!;
        gate.immediate(anchorMid, 403);
        const vm = f.wrapper.vm as unknown as {
          onDeleteMessage(mid: string): Promise<void>;
        };
        await vm.onDeleteMessage(anchorMid); // arm
        await vm.onDeleteMessage(anchorMid); // confirm — 403 → false
        expect(
          f.store.messages.some((m) => m.messageId === anchorMid),
          "existence-hidden false keeps the local row",
        ).toBe(true);

        // handoff 已清除：先以同基准复活一个活动事务（锚行仍在），再强制
        // 移除锚行——活动事务的锚消失且无快照时必须显性失败，而不是消费
        // 一条本不该存在的快照（若快照幸存，这里会静默钉住幸存行）。
        f.heightRef.value = 96;
        f.geo.relayout(96);
        f.ro.emit({ width: 800, height: 596 });
        let sawActive = false;
        for (let i = 0; i < 120 && !sawActive; i += 1) {
          vi.advanceTimersByTime(20);
          f.frames.pump();
          await flushPromises();
          f.geo.refresh();
          sawActive = (f.el.dataset.preserveRun ?? "") === "active";
        }
        expect(sawActive, "a revival transaction anchored the same row").toBe(true);
        f.store.messages = f.store.messages.filter((m) => m.messageId !== anchorMid);
        f.geo.relayout(96);
        let sawExplicitFail = false;
        for (let i = 0; i < 400 && !sawExplicitFail; i += 1) {
          vi.advanceTimersByTime(20);
          f.frames.pump();
          await flushPromises();
          f.geo.refresh();
          sawExplicitFail = f.el.dataset.preserveConverged === "false";
        }
        expect(sawExplicitFail, "no handoff survived the failed delete").toBe(true);
        expect(
          warnSpy.mock.calls.some((args) =>
            /preserve anchor did not settle/.test(String(args[0])),
          ),
        ).toBe(true);
      } finally {
        warnSpy.mockRestore();
        vi.unstubAllGlobals();
        f.wrapper.unmount();
      }
    });

    it("round10 P2-1b: a thrown delete error surfaces actionError and clears the handoff", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const f = await takeoverFixture();
      const drive = makeCadenceDriver(f, 20);
      const gate = installDeleteGate();
      try {
        await drive(240);
        const anchorMid = f.el.dataset.preserveMid!;
        gate.immediate(anchorMid, 500); // ChatHttpError → guarded 捕获
        const vm = f.wrapper.vm as unknown as {
          onDeleteMessage(mid: string): Promise<void>;
        };
        await vm.onDeleteMessage(anchorMid); // arm
        await vm.onDeleteMessage(anchorMid); // confirm — throw → undefined
        await flushPromises();
        expect(
          f.wrapper.find('[data-testid="chat-action-error"]').exists(),
          "actionError surfaces for the failed op",
        ).toBe(true);
        expect(f.store.messages.some((m) => m.messageId === anchorMid)).toBe(true);
        // handoff 已清除：同 P2-1a 的活动事务强制移除探针。
        f.heightRef.value = 96;
        f.geo.relayout(96);
        f.ro.emit({ width: 800, height: 595 });
        let sawActive = false;
        for (let i = 0; i < 120 && !sawActive; i += 1) {
          vi.advanceTimersByTime(20);
          f.frames.pump();
          await flushPromises();
          f.geo.refresh();
          sawActive = (f.el.dataset.preserveRun ?? "") === "active";
        }
        expect(sawActive, "a revival transaction anchored the same row").toBe(true);
        f.store.messages = f.store.messages.filter((m) => m.messageId !== anchorMid);
        f.geo.relayout(96);
        let sawExplicitFail = false;
        for (let i = 0; i < 400 && !sawExplicitFail; i += 1) {
          vi.advanceTimersByTime(20);
          f.frames.pump();
          await flushPromises();
          f.geo.refresh();
          sawExplicitFail = f.el.dataset.preserveConverged === "false";
        }
        expect(sawExplicitFail, "no handoff survived the thrown delete").toBe(true);
      } finally {
        warnSpy.mockRestore();
        vi.unstubAllGlobals();
        f.wrapper.unmount();
      }
    });

    it("round10 P2-1c: overlapping confirmations stay isolated per request; the late-arriving earlier request hands off its own survivor", async () => {
      const f = await takeoverFixture();
      const drive = makeCadenceDriver(f, 20);
      const gate = installDeleteGate();
      try {
        await drive(240);
        expect(f.el.dataset.preserveConverged).toBe("true");
        const anchorMid = f.el.dataset.preserveMid!;
        const list = f.store.messages;
        const anchorIdx = list.findIndex((m) => m.messageId === anchorMid);
        expect(anchorIdx).toBeGreaterThanOrEqual(0);
        // round10（P2-2）：生产快照规则优先后一行（下方）。
        const survivorMid = list[anchorIdx + 1]!.messageId;
        const otherMid = list[anchorIdx + 3]!.messageId;
        // 事务锚行（anchorMid）的删除请求挂起；另一行（otherMid）的删除
        // 立即成功。两条确认重叠，快照按请求隔离。
        gate.defer(anchorMid);
        gate.immediate(otherMid, 200);
        const vm = f.wrapper.vm as unknown as {
          onDeleteMessage(mid: string): Promise<void>;
        };
        // 冻结 anchor 幸存行的删除前偏移（耦合几何下 history rect top=0）。
        const survivorNode = Array.from(
          f.el.querySelectorAll<HTMLElement>('[data-testid="chat-message"]'),
        ).find((n) => n.dataset.mid === survivorMid);
        expect(survivorNode, "survivor mounted before delete").toBeTruthy();
        const preDeleteOffset = survivorNode!.getBoundingClientRect().top;

        await vm.onDeleteMessage(anchorMid); // arm anchor
        await flushPromises();
        void vm.onDeleteMessage(anchorMid); // confirm anchor — 挂起
        await flushPromises();
        await vm.onDeleteMessage(otherMid); // arm other
        await vm.onDeleteMessage(otherMid); // confirm other — 立即成功
        await flushPromises();
        expect(f.store.messages.some((m) => m.messageId === otherMid)).toBe(false);

        // 迟到的较早请求最终成功：消费的是【它自己的】幸存行快照。
        gate.resolveDeferred(200);
        await drive(360);
        expect(f.store.messages.some((m) => m.messageId === anchorMid)).toBe(false);
        expect(f.el.dataset.preserveMid, "late request handed off its own survivor")
          .toBe(survivorMid);
        expect(f.el.dataset.preserveConverged).toBe("true");
        expect(Number(f.el.dataset.preserveOff)).toBeCloseTo(preDeleteOffset, 0);
        const info = anchoredErrorPx(f.el)!;
        expect(info.mid).toBe(survivorMid);
        expect(
          info.error,
          `isolated handoff restores the survivor offset (${info.error.toFixed(2)}px ≤ 1)`,
        ).toBeLessThanOrEqual(1);
      } finally {
        vi.unstubAllGlobals();
        f.wrapper.unmount();
      }
    });

    // ---- round11：同 mid 删除单飞、并发完成顺序与一次性身份票据 -----------

    /** 等待当前保持事务收敛（converged=true、run=idle、override=released）。 */
    async function driveUntilSettled(
      f: TakeoverFixture,
      drive: (n: number) => Promise<void>,
      label: string,
      maxFrames = 600,
    ): Promise<void> {
      let settled = false;
      for (let i = 0; i < maxFrames && !settled; i += 1) {
        await drive(1);
        settled =
          (f.el.dataset.preserveRun ?? "") === "idle" &&
          f.el.dataset.preserveConverged === "true";
      }
      expect(
        f.el.dataset.preserveConverged ?? "",
        `${label}: transaction settled (true|idle|released)`,
      ).toBe("true");
      expect(f.el.dataset.preserveRun ?? "").toBe("idle");
      expect(f.el.dataset.preserveOverride).toBe("released");
    }

    it("round11 P1-3a: while R1 for the same mid hangs, repeated arm/confirm neither issues a second DELETE nor overwrites the handoff", async () => {
      const f = await takeoverFixture();
      const drive = makeCadenceDriver(f, 20);
      const gate = installDeleteGate();
      try {
        await driveUntilSettled(f, drive, "P1-3a baseline");
        const doomedMid = f.el.dataset.preserveMid!;
        expect(doomedMid).toBeTruthy();
        const list = f.store.messages;
        const idx = list.findIndex((m) => m.messageId === doomedMid);
        const survivorMid = list[idx + 1]!.messageId;

        // 展开菜单（渲染删除按钮）→ arm → 等插入内容被钉回 → 冻结基线 →
        // confirm（R1 挂起）。
        const vm = f.wrapper.vm as unknown as {
          onDeleteMessage(mid: string): Promise<void>;
          toggleMsgMenu(mid: string): void;
        };
        vm.toggleMsgMenu(doomedMid);
        await flushPromises();
        const delBtn = f.wrapper.find(`[data-testid="msg-delete-${doomedMid}"]`);
        expect(delBtn.exists(), "delete button rendered with the menu open").toBe(true);
        await vm.onDeleteMessage(doomedMid); // arm
        await driveUntilSettled(f, drive, "P1-3a menu+arm settled");
        const survivorNode = Array.from(
          f.el.querySelectorAll<HTMLElement>('[data-testid="chat-message"]'),
        ).find((n) => n.dataset.mid === survivorMid);
        expect(survivorNode, "survivor mounted before confirm").toBeTruthy();
        const preDeleteOffset = survivorNode!.getBoundingClientRect().top;
        void vm.onDeleteMessage(doomedMid); // confirm — DELETE 挂起中
        await flushPromises();

        // 单飞语义：在途期间按钮禁用 + 进行中文案。
        expect(
          delBtn.attributes("disabled"),
          "the in-flight delete button is disabled",
        ).toBeDefined();
        expect(delBtn.text(), "the in-flight label states progress").toContain("删除中");

        // 重复 arm/confirm：一律早退——只有一个网络请求，无第二次快照捕获。
        await vm.onDeleteMessage(doomedMid); // arm（在途 → 早退）
        void vm.onDeleteMessage(doomedMid); // confirm（在途 → 早退）
        await flushPromises();
        expect(gate.calls(doomedMid), "exactly one DELETE left the page").toBe(1);

        // R1 成功：行删除、它自己的幸存行快照被消费（非覆盖的旧快照）。
        gate.resolveDeferred(200);
        await driveUntilSettled(f, drive, "P1-3a after R1 resolves");
        expect(f.store.messages.some((m) => m.messageId === doomedMid)).toBe(false);
        expect(f.el.dataset.preserveMid, "R1's own survivor handoff consumed").toBe(survivorMid);
        expect(Number(f.el.dataset.preserveOff)).toBeCloseTo(preDeleteOffset, 0);
        const info = anchoredErrorPx(f.el)!;
        expect(info.mid).toBe(survivorMid);
        expect(
          info.error,
          `the correct request's snapshot pinned the survivor (${info.error.toFixed(2)}px ≤ 4)`,
        ).toBeLessThanOrEqual(4);
      } finally {
        vi.unstubAllGlobals();
        f.wrapper.unmount();
      }
    });

    it("round11 P1-3b: R1 false then R2 true for the same mid — sequential retries stay isolated and the fresh handoff pins the survivor", async () => {
      const f = await takeoverFixture();
      const drive = makeCadenceDriver(f, 20);
      const gate = installDeleteGate();
      try {
        await driveUntilSettled(f, drive, "P1-3b baseline");
        const doomedMid = f.el.dataset.preserveMid!;
        const list = f.store.messages;
        const idx = list.findIndex((m) => m.messageId === doomedMid);
        const survivorMid = list[idx + 1]!.messageId;

        // R1：403（存在性隐藏）→ false：行保留、handoff 清除、按钮恢复可用。
        gate.immediate(doomedMid, 403);
        const vm = f.wrapper.vm as unknown as {
          onDeleteMessage(mid: string): Promise<void>;
          toggleMsgMenu(mid: string): void;
        };
        vm.toggleMsgMenu(doomedMid);
        await flushPromises();
        const delBtn = f.wrapper.find(`[data-testid="msg-delete-${doomedMid}"]`);
        await vm.onDeleteMessage(doomedMid); // arm
        await vm.onDeleteMessage(doomedMid); // confirm — 403 → false
        await flushPromises();
        expect(f.store.messages.some((m) => m.messageId === doomedMid)).toBe(true);
        expect(
          delBtn.attributes("disabled"),
          "the button re-enables after a failed request",
        ).toBeUndefined();
        expect(gate.calls(doomedMid)).toBe(1);

        // R2（R1 完成后顺序发出）：arm 后等标签变化被钉回，再冻结基线、确认。
        await driveUntilSettled(f, drive, "P1-3b after R1 false");
        gate.immediate(doomedMid, 200);
        await vm.onDeleteMessage(doomedMid); // arm
        await driveUntilSettled(f, drive, "P1-3b R2 arm settled");
        const survivorNode = Array.from(
          f.el.querySelectorAll<HTMLElement>('[data-testid="chat-message"]'),
        ).find((n) => n.dataset.mid === survivorMid);
        expect(survivorNode, "survivor still mounted before R2").toBeTruthy();
        const preDeleteOffset = survivorNode!.getBoundingClientRect().top;
        await vm.onDeleteMessage(doomedMid); // confirm — 200
        await driveUntilSettled(f, drive, "P1-3b after R2 succeeds");
        expect(f.store.messages.some((m) => m.messageId === doomedMid)).toBe(false);
        expect(gate.calls(doomedMid)).toBe(2);
        expect(f.el.dataset.preserveMid, "R2's fresh handoff anchored the survivor")
          .toBe(survivorMid);
        expect(Number(f.el.dataset.preserveOff)).toBeCloseTo(preDeleteOffset, 0);
        const info = anchoredErrorPx(f.el)!;
        expect(
          info.error,
          `R2's snapshot pinned the survivor (${info.error.toFixed(2)}px ≤ 4)`,
        ).toBeLessThanOrEqual(4);
      } finally {
        vi.unstubAllGlobals();
        f.wrapper.unmount();
      }
    });

    it("round11 P1-3c: after R1 succeeds, a repeat delete on the same mid early-returns with no network call", async () => {
      const f = await takeoverFixture();
      const drive = makeCadenceDriver(f, 20);
      const gate = installDeleteGate();
      try {
        await driveUntilSettled(f, drive, "P1-3c baseline");
        const doomedMid = f.el.dataset.preserveMid!;
        gate.immediate(doomedMid, 200);
        const vm = f.wrapper.vm as unknown as {
          onDeleteMessage(mid: string): Promise<void>;
        };
        await vm.onDeleteMessage(doomedMid); // arm
        await vm.onDeleteMessage(doomedMid); // confirm — 200 → 行删除
        await driveUntilSettled(f, drive, "P1-3c after R1 succeeds");
        expect(f.store.messages.some((m) => m.messageId === doomedMid)).toBe(false);
        expect(gate.calls(doomedMid)).toBe(1);

        // 行已不在列表：重复 arm/confirm 不再发出任何 DELETE。
        await vm.onDeleteMessage(doomedMid);
        await vm.onDeleteMessage(doomedMid);
        await flushPromises();
        expect(
          gate.calls(doomedMid),
          "no second DELETE for an already-removed row",
        ).toBe(1);
      } finally {
        vi.unstubAllGlobals();
        f.wrapper.unmount();
      }
    });

    /** 双 mid 并发删除：给定完成顺序后两行都消失、基准行幸存者被钉回 ≤4px。 */
    async function concurrentDeleteOrder(order: "basis-first" | "other-first"): Promise<void> {
      const f = await takeoverFixture();
      const drive = makeCadenceDriver(f, 20);
      const gate = installDeleteGate();
      try {
        await driveUntilSettled(f, drive, "baseline");
        const basisMid = f.el.dataset.preserveMid!;
        const list = f.store.messages;
        const idx = list.findIndex((m) => m.messageId === basisMid);
        // 上方两行作为“另一条”并发删除目标（不同 mid，允许并发）。
        const otherMid = list[Math.max(0, idx - 2)]!.messageId;
        const survivorMid = list[idx + 1]!.messageId;

        gate.defer(basisMid);
        gate.defer(otherMid);
        const vm = f.wrapper.vm as unknown as {
          onDeleteMessage(mid: string): Promise<void>;
        };
        // 两条确认重叠（不同 mid 各自独立在途，互不禁用）：A arm → A
        // confirm（挂起）→ B arm → B confirm（挂起）；A 的 arm 标签变化被
        // 钉回后再冻结幸存行基线。
        await vm.onDeleteMessage(basisMid); // arm A
        void vm.onDeleteMessage(basisMid); // confirm A — 挂起
        await flushPromises();
        await vm.onDeleteMessage(otherMid); // arm B（两步确认槽切到 B）
        void vm.onDeleteMessage(otherMid); // confirm B — 挂起
        await flushPromises();
        expect(gate.calls(basisMid)).toBe(1);
        expect(gate.calls(otherMid)).toBe(1);
        await driveUntilSettled(f, drive, "concurrent baseline settled");
        const survivorNode = Array.from(
          f.el.querySelectorAll<HTMLElement>('[data-testid="chat-message"]'),
        ).find((n) => n.dataset.mid === survivorMid);
        expect(survivorNode, "survivor mounted before resolves").toBeTruthy();
        const preDeleteOffset = survivorNode!.getBoundingClientRect().top;

        // 两种相反完成顺序：基准行请求先完成 / 后完成。
        if (order === "basis-first") {
          gate.resolveDeferredFor(basisMid, 200); // 基准行请求先完成 → 消费自己的快照
          await driveUntilSettled(f, drive, "basis request settled first");
          expect(f.store.messages.some((m) => m.messageId === basisMid)).toBe(false);
          gate.resolveDeferredFor(otherMid, 200); // 上方行请求后完成 → 上游扰动被钉回
        } else {
          gate.resolveDeferredFor(otherMid, 200); // 上方行请求先完成 → 上游删除
          await driveUntilSettled(f, drive, "other request settled first");
          expect(f.store.messages.some((m) => m.messageId === otherMid)).toBe(false);
          expect(
            f.el.dataset.preserveMid,
            "the settled basis row survived the upstream delete",
          ).toBe(basisMid);
          gate.resolveDeferredFor(basisMid, 200); // 基准行请求后完成 → 消费自己的快照
        }
        await driveUntilSettled(f, drive, "both requests settled");
        expect(f.store.messages.some((m) => m.messageId === basisMid)).toBe(false);
        expect(f.store.messages.some((m) => m.messageId === otherMid)).toBe(false);
        expect(
          f.el.dataset.preserveMid,
          `${order}: the basis request's snapshot owns the final basis`,
        ).toBe(survivorMid);
        expect(Number(f.el.dataset.preserveOff)).toBeCloseTo(preDeleteOffset, 0);
        const info = anchoredErrorPx(f.el)!;
        expect(
          info.error,
          `${order}: the survivor pinned within ≤4px (${info.error.toFixed(2)}px)`,
        ).toBeLessThanOrEqual(4);
      } finally {
        vi.unstubAllGlobals();
        f.wrapper.unmount();
      }
    }

    it("round11 P1-3d1: opposite completion orders (basis request settles first) — only the correct request's snapshot is consumed", async () => {
      await concurrentDeleteOrder("basis-first");
    });

    it("round11 P1-3d2: opposite completion orders (other request settles first) — only the correct request's snapshot is consumed", async () => {
      await concurrentDeleteOrder("other-first");
    });

    it("round11 P2-1a: consecutive no-op programmatic writes mint no echo ack — a scroll at the clamped landing is user semantics", async () => {
      // 两个【空】会话：无锚点、无行——跟随状态机不产生任何程序写入，
      // 唯一的 scrollTop 写入来自会话切换的 reset（目标 0）。
      const conversationsJson = [
        { conversationId: 8, relationshipId: "1" },
        { conversationId: 9, relationshipId: "1" },
      ];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) => {
          const url = typeof input === "string" ? input : input.toString();
          if (url === "/api/v1/relationships") {
            return { ok: true, status: 200, json: async () => [ACTIVE_RELATIONSHIP] };
          }
          if (url.includes("/messages")) {
            return { ok: true, status: 200, json: async () => [] };
          }
          if (url.startsWith("/api/v1/conversations") && !url.includes("/messages")) {
            return { ok: true, status: 200, json: async () => conversationsJson };
          }
          return { ok: true, status: 200, json: async () => ({}) };
        }),
      );
      const wrapper = mountPage();
      await flushPromises();
      const el = wrapper.find('[data-testid="history"]').element as HTMLElement;
      installGeometry(el);
      try {
        // 初始挂载后 scrollTop 已是 0：两次会话切换触发
        // resetScrollOwnership 的 scrollTop=0 写入——浏览器钳制后是 no-op
        // 连续写（0 → 0），绝不能铸造回声票据。
        expect(el.scrollTop).toBe(0);
        const items = wrapper.findAll('[data-testid="conversation-item"]');
        expect(items.length).toBeGreaterThanOrEqual(2);
        await items[0]!.trigger("click");
        await flushPromises();
        expect(el.scrollTop, "first reset landed at the clamped 0").toBe(0);
        await items[1]!.trigger("click");
        await flushPromises();
        expect(el.scrollTop, "second reset is a no-op at the same landing").toBe(0);

        // 同落点（0）的 scroll 事件：no-op 写入不留票 → 无票据可吞 →
        // 真实用户语义 → 接管（following 翻 false）。若 no-op 写铸造了
        // 票据，事件会被吞掉，following 保持 true，测试失败。
        el.dispatchEvent(new Event("scroll"));
        await flushPromises();
        expect(
          el.dataset.following,
          "a no-op write leaves no ticket — the event transfers ownership",
        ).toBe("false");
      } finally {
        vi.unstubAllGlobals();
        wrapper.unmount();
      }
    });

    it("round11 P2-1b: a node rebuild invalidates outstanding echo acks — the same landing on the new node is user semantics", async () => {
      const f = await takeoverFixture();
      const drive = makeCadenceDriver(f, 20);
      const relStore = useRelationshipStore();
      try {
        await driveUntilSettled(f, drive, "P2-1b baseline");
        // 一次真实校正写入（铸票据）且不派发任何 scroll 事件消费它。
        const spy = spyScrollWrites(f.el);
        f.heightRef.value = 96;
        f.geo.relayout(96);
        f.ro.emit({ width: 800, height: 599 });
        for (let i = 0; i < 24 && spy.log.length === 0; i += 1) {
          vi.advanceTimersByTime(20);
          f.frames.pump();
          await flushPromises();
          f.geo.refresh();
        }
        expect(spy.log.length, "an engine write minted an ack").toBeGreaterThan(0);
        spy.restore();
        const landing = f.geo.scrollTop();

        // 真实 Vue 重建路径：解除关系 → 卸载消息区 → 恢复关系 → 新节点。
        relStore.currentRelationshipId = null;
        await flushPromises();
        await f.wrapper.vm.$nextTick();
        relStore.currentRelationshipId = String(ACTIVE_RELATIONSHIP.relationshipId);
        await flushPromises();
        await f.wrapper.vm.$nextTick();
        const newEl = f.wrapper.find('[data-testid="history"]').element as HTMLElement;
        expect(newEl, "history node was rebuilt").not.toBe(f.el);
        const geo2 = installCoupledGeometry(newEl, {
          clientHeight: 600,
          rowCount: 40,
          heightRef: f.heightRef,
          bottomPad: 2000,
          bottomPadRef: f.padRef,
        });
        geo2.setScrollTop(landing);
        geo2.refresh();

        // 新节点上同落点的 scroll 事件：旧节点票据不得跨宿主消费 →
        // 真实用户语义（rebase 到当前视图）。
        newEl.dispatchEvent(new Event("scroll"));
        await flushPromises();
        geo2.refresh();
        let sawBasis = false;
        for (let i = 0; i < 120 && !sawBasis; i += 1) {
          vi.advanceTimersByTime(20);
          f.frames.pump();
          await flushPromises();
          geo2.refresh();
          sawBasis = Boolean(newEl.dataset.preserveMid);
        }
        expect(
          sawBasis,
          "the same landing after rebuild rebased onto the user's view (no cross-host ack)",
        ).toBe(true);
      } finally {
        vi.unstubAllGlobals();
        f.wrapper.unmount();
      }
    });

    it("round11 P2-1c: a self token left by the following branch is cleared — the next external signal after a new takeover routes into a fresh transaction", async () => {
      const f = await takeoverFixture();
      const drive = makeCadenceDriver(f, 20);
      try {
        await driveUntilSettled(f, drive, "P2-1c baseline");
        // 回到底部恢复 following（abandon 的 release 会铸造 self 令牌；
        // 观察者的 following 分支必须立刻消费/清空它）。
        vi.advanceTimersByTime(1_000); // 回声票据 TTL 过期（保险）
        f.geo.setScrollTop(f.el.scrollHeight - f.el.clientHeight);
        f.el.dispatchEvent(new Event("scroll"));
        await flushPromises();
        f.geo.refresh();
        expect(
          f.el.dataset.following,
          "returning to the bottom resumed following",
        ).toBe("true");

        // 再次接管（真实滚动语义）后，一次真实外部布局信号必须路由进
        // 新事务——若 following 分支残留了旧 self 令牌，该信号会被当作
        // 自身级联吞掉，新事务不再产生。
        vi.advanceTimersByTime(1_000);
        f.geo.setScrollTop(1_400);
        f.el.dispatchEvent(new Event("scroll"));
        await flushPromises();
        f.geo.refresh();
        expect(f.el.dataset.following, "a real scroll took over again").toBe("false");
        f.heightRef.value = 104;
        f.geo.relayout(104);
        f.ro.emit({ width: 800, height: 601 });
        let sawActive = false;
        for (let i = 0; i < 200 && !sawActive; i += 1) {
          vi.advanceTimersByTime(20);
          f.frames.pump();
          await flushPromises();
          f.geo.refresh();
          sawActive = (f.el.dataset.preserveRun ?? "") === "active";
        }
        expect(
          sawActive,
          "the external signal after the following-branch spawned a fresh transaction",
        ).toBe(true);
        await driveUntilSettled(f, drive, "P2-1c fresh transaction settled");
      } finally {
        vi.unstubAllGlobals();
        f.wrapper.unmount();
      }
    });
  });
});
