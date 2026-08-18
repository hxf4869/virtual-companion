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

describe("chat page glue (TASK-0186 send flow + TASK-0187 relationship gate)", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("uni", undefined);
    stubFetch();
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

  it("disables the send button when the input is empty", async () => {
    const wrapper = mountPage();
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

    const button = wrapper.find('[data-testid="msg-delete-m1"]');
    expect(button.exists()).toBe(true);
    expect(button.text()).toContain("删除");

    // First click only arms the confirm; nothing is deleted yet.
    await button.trigger("click");
    expect(removeSpy).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="msg-delete-m1"]').text()).toContain("确认删除");

    // Second click confirms and deletes through the store.
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

    const copyButton = wrapper.find('[data-testid="msg-copy-m1"]');
    expect(copyButton.exists()).toBe(true);
    expect(copyButton.text()).toContain("复制");

    await copyButton.trigger("click");
    await flushPromises();

    expect(writeText).toHaveBeenCalledWith("这是一段需要复制的内容");
    expect(wrapper.find('[data-testid="msg-copy-m1"]').text()).toContain("已复制");
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

  it("VIRT-LIST: renders at most 200 rows and shows the truncation notice for longer histories", async () => {
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
    expect(rows.length).toBe(200);
    // The newest rows win; the oldest are dropped from the DOM.
    expect(rows[0].text()).toContain("消息 50");
    expect(rows[rows.length - 1].text()).toContain("消息 249");
    const notice = wrapper.find('[data-testid="history-truncated"]');
    expect(notice.exists()).toBe(true);
    expect(notice.text()).toContain("已隐藏更早的 50 条消息");
    wrapper.unmount();
  });

  it("VIRT-LIST: no notice while the history fits the render bound", async () => {
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

  it("renders a back-to-index entry even before a relationship is selected", async () => {
    stubFetch({ relationships: [] });
    const wrapper = mountPage();
    await flushPromises();

    const nav = wrapper.find('[data-testid="nav-index"]');
    expect(nav.exists()).toBe(true);
    expect(nav.text()).toContain("返回边界台");
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

    await wrapper.find('[data-testid="nav-index"]').trigger("click");

    expect(navigateTo).toHaveBeenCalledWith({ url: "/pages/index/index" });
    expect(sendSpy).not.toHaveBeenCalled();
    expect(cancelSpy).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("renders a memory-page entry even before a relationship is selected", async () => {
    stubFetch({ relationships: [] });
    const wrapper = mountPage();
    await flushPromises();

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

    await wrapper.find('[data-testid="nav-memory"]').trigger("click");

    expect(navigateTo).toHaveBeenCalledWith({ url: "/pages/memory/memory" });
    wrapper.unmount();
  });

  it("renders a login entry even before a relationship is selected", async () => {
    stubFetch({ relationships: [] });
    const wrapper = mountPage();
    await flushPromises();

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

  it("CONV-MGMT: renames the open conversation through the inline row", async () => {
    stubFetch({
      conversationsJson: [{ conversationId: "9", relationshipId: "1", title: "旧标题" }],
    });
    const wrapper = mountPage();
    await flushPromises();
    const store = useChatStore();
    const renameSpy = vi.spyOn(store, "renameConversation").mockResolvedValue(true);
    store.conversationId = "9";

    await wrapper.find('[data-testid="conversation-rename"]').trigger("click");
    await wrapper.find('[data-testid="rename-input"]').setValue("新标题");
    await wrapper.find('[data-testid="rename-apply"]').trigger("click");
    await flushPromises();

    expect(renameSpy).toHaveBeenCalledWith(expect.anything(), "9", "新标题");
    expect(wrapper.find('[data-testid="rename-row"]').exists()).toBe(false);
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
    await wrapper.find('[data-testid="conversation-delete"]').trigger("click");
    expect(removeSpy).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="conversation-delete"]').text()).toContain("确认删除");

    // Second click deletes.
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

    const button = wrapper.find('[data-testid="end-today"]');
    expect(button.exists()).toBe(true);
    expect(button.text()).toContain("结束今天的对话");
    expect(wrapper.text()).not.toMatch(/挽留|难过|再考虑|舍不得/);

    await button.trigger("click");
    await flushPromises();
    expect(calls.some((c) => c.url.endsWith("/end"))).toBe(false);
    expect(wrapper.find('[data-testid="end-today"]').text()).toContain("确认结束？");
    expect(useRelationshipStore().currentRelationshipId).toBe("1");

    await wrapper.find('[data-testid="end-today"]').trigger("click");
    await flushPromises();

    expect(calls.some((c) => c.method === "POST" && c.url === "/api/v1/conversations/1/end")).toBe(
      true,
    );
    expect(useRelationshipStore().current).not.toBeNull();
    wrapper.unmount();
  });

  it("hides the deactivate button when no relationship is selected", async () => {
    stubFetch({ relationships: [] });
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[data-testid="deactivate-relationship"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
