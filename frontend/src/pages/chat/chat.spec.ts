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
import { useChatStore } from "@/stores/chat";
import { useRelationshipStore } from "@/stores/relationship";

const ACTIVE_RELATIONSHIP = {
  relationshipId: 1,
  personaRef: "gentle-listener",
  active: true,
  createdAt: "2026-08-13T01:00:00Z",
};

/** Stub fetch to satisfy the mount-time relationship load + conversation create. */
function stubFetch(opts: { relationships?: unknown[] } = {}): void {
  const relationships = opts.relationships ?? [ACTIVE_RELATIONSHIP];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/v1/relationships") {
        return { ok: true, status: 200, json: async () => relationships };
      }
      if (url === "/api/v1/conversations") {
        return { ok: true, status: 200, json: async () => ({ conversationId: 1 }) };
      }
      if (url.includes("/messages")) {
        return { ok: true, status: 200, json: async () => [] };
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

  it("shows the current relationship id after a successful load", async () => {
    const wrapper = mountPage();
    await flushPromises();
    const relStore = useRelationshipStore();
    const activateSpy = vi.spyOn(relStore, "activate");
    const store = useChatStore();
    const sendSpy = vi.spyOn(store, "send");

    const status = wrapper.find('[data-testid="current-relationship"]');
    expect(status.exists()).toBe(true);
    expect(status.text()).toContain("当前关系：1");
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
});
