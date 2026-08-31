// @vitest-environment happy-dom
// CONV-LIST: independent conversation list (§8.2). Fetch is stubbed;
// assertions drive the shipped page, not a parallel client.
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ConversationsPage from "./conversations.vue";
import { useRelationshipStore } from "@/stores/relationship";

const REL = {
  relationshipId: "rel-1",
  personaRef: "gentle-listener",
  active: true,
  createdAt: "2026-08-18T00:00:00Z",
};

/** 行级管理操作（改名/结束/删除）收进"管理"展开区（Phase 3 IA）。 */
async function openManage(wrapper: { find: (sel: string) => { attributes: (n: string) => string | undefined; trigger: (e: string) => Promise<void> } }): Promise<void> {
  const btn = wrapper.find('[data-testid^="conversation-manage-"]');
  if (btn.attributes("aria-expanded") !== "true") {
    await btn.trigger("click");
  }
}

function item(overrides: Record<string, unknown> = {}) {
  return {
    conversationId: "c1",
    relationshipId: "rel-1",
    title: "周二夜聊",
    lastMessagePreview: "今晚早点休息",
    createdAt: "2026-08-18T01:00:00Z",
    incognito: false,
    ...overrides,
  };
}

function stubFetch(opts?: {
  conversations?: unknown[];
  listStatus?: number;
  deleteStatus?: number;
  renameStatus?: number;
  endStatus?: number;
  relationships?: unknown[];
  wipePreview?: unknown;
  wipePreviewStatus?: number;
  wipeResult?: unknown;
  wipeStatus?: number;
}): { calls: { method: string; url: string; body?: string }[] } {
  const calls: { method: string; url: string; body?: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ method, url, body: typeof init?.body === "string" ? init.body : undefined });
      if (url === "/api/v1/relationships" && method === "GET") {
        return { ok: true, status: 200, json: async () => opts?.relationships ?? [REL] };
      }
      if (url === "/api/v1/conversations/wipe-preview" && method === "GET") {
        const status = opts?.wipePreviewStatus ?? 200;
        return {
          ok: status === 200,
          status,
          json: async () =>
            status === 200
              ? (opts?.wipePreview ?? { conversationCount: 2, messageCount: 9, inFlightCount: 1 })
              : { code: "INTERNAL_ERROR" },
        };
      }
      if (url === "/api/v1/conversations/wipe" && method === "POST") {
        const status = opts?.wipeStatus ?? 200;
        return {
          ok: status === 200,
          status,
          json: async () =>
            status === 200
              ? (opts?.wipeResult ?? { conversationsDeleted: 2, messagesDeleted: 9, workItemsCancelled: 1 })
              : { code: "INTERNAL_ERROR" },
        };
      }
      if (url.startsWith("/api/v1/conversations") && method === "GET") {
        const status = opts?.listStatus ?? 200;
        return {
          ok: status === 200,
          status,
          json: async () => (status === 200 ? (opts?.conversations ?? [item()]) : { code: "ERROR" }),
        };
      }
      if (url.endsWith("/end") && method === "POST") {
        const status = opts?.endStatus ?? 200;
        return {
          ok: status === 200,
          status,
          json: async () =>
            status === 200 ? { ok: true, incognitoCleared: false } : { code: "NOT_FOUND_OR_FORBIDDEN" },
        };
      }
      if (url.startsWith("/api/v1/conversations/") && method === "DELETE") {
        const status = opts?.deleteStatus ?? 200;
        return { ok: status === 200, status, json: async () => ({}) };
      }
      if (url.startsWith("/api/v1/conversations/") && method === "PATCH") {
        const status = opts?.renameStatus ?? 200;
        return {
          ok: status === 200,
          status,
          json: async () => (status === 200 ? { title: "新标题" } : { code: "NOT_FOUND_OR_FORBIDDEN" }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }),
  );
  return { calls };
}

describe("independent conversation list page", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("uni", { navigateTo: vi.fn() });
    vi.stubGlobal("location", { search: "", href: "" });
  });

  it("lists conversations through GET /conversations and shows title, preview, incognito", async () => {
    const { calls } = stubFetch({
      conversations: [
        item(),
        item({
          conversationId: "c2",
          title: undefined,
          lastMessagePreview: "无痕预览",
          incognito: true,
        }),
      ],
    });
    const wrapper = mount(ConversationsPage, { attachTo: document.body });
    await flushPromises();

    expect(calls.some((c) => c.method === "GET" && c.url === "/api/v1/conversations?limit=20")).toBe(
      true,
    );
    const cards = wrapper.findAll('[data-testid="conversation-card"]');
    expect(cards).toHaveLength(2);
    expect(cards[0].text()).toContain("周二夜聊");
    expect(cards[0].text()).toContain("今晚早点休息");
    expect(cards[1].text()).toContain("无痕预览");
    expect(cards[1].find('[data-testid="conversation-incognito"]').text()).toContain("无痕");
    wrapper.unmount();
  });

  it("CONV-FILTER: hides conversations whose title or preview does not match", async () => {
    stubFetch({
      conversations: [
        item(),
        item({ conversationId: "c2", title: "周末计划", lastMessagePreview: "去散步" }),
      ],
    });
    const wrapper = mount(ConversationsPage, { attachTo: document.body });
    await flushPromises();
    expect(wrapper.findAll('[data-testid="conversation-card"]')).toHaveLength(2);

    await wrapper.find('[data-testid="conversation-filter"]').setValue("周末");
    await wrapper.vm.$nextTick();
    const cards = wrapper.findAll('[data-testid="conversation-card"]');
    expect(cards).toHaveLength(1);
    expect(cards[0].text()).toContain("周末计划");
    wrapper.unmount();
  });

  it("filters the list when relationshipId is in the query", async () => {
    vi.stubGlobal("location", { search: "?relationshipId=rel-1", href: "" });
    const { calls } = stubFetch();
    const wrapper = mount(ConversationsPage, { attachTo: document.body });
    await flushPromises();

    expect(
      calls.some(
        (c) =>
          c.method === "GET" &&
          c.url === "/api/v1/conversations?relationshipId=rel-1&limit=20",
      ),
    ).toBe(true);
    wrapper.unmount();
  });

  it("shows an empty status after a successful empty load", async () => {
    stubFetch({ conversations: [] });
    const wrapper = mount(ConversationsPage, { attachTo: document.body });
    await flushPromises();

    const empty = wrapper.find('[data-testid="conversations-empty"]');
    expect(empty.exists()).toBe(true);
    expect(empty.text()).toContain("还没有会话");
    expect(wrapper.find('[data-testid="conversation-card"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("offers a working create-companion action instead of a disabled empty relationship select", async () => {
    const navigateTo = vi.fn();
    vi.stubGlobal("uni", { navigateTo });
    stubFetch({ relationships: [], conversations: [] });
    const wrapper = mount(ConversationsPage, { attachTo: document.body });
    await flushPromises();

    expect(wrapper.find('[data-testid="relationship-select"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="empty-relationship-action"]').text()).toContain("创建陪伴");
    expect(wrapper.get('[data-testid="nav-chat"]').text()).toContain("创建陪伴");

    await wrapper.get('[data-testid="empty-relationship-action"]').trigger("click");
    expect(navigateTo).toHaveBeenCalledWith({ url: "/pages/companion/companion" });
    wrapper.unmount();
  });

  it("surfaces a load failure and retries through the same GET", async () => {
    const { calls } = stubFetch({ listStatus: 500 });
    const wrapper = mount(ConversationsPage, { attachTo: document.body });
    await flushPromises();

    expect(wrapper.find('[data-testid="conversations-load-failed"]').text()).toContain("加载失败");
    expect(wrapper.find('[data-testid="conversation-card"]').exists()).toBe(false);

    await wrapper.find('[data-testid="conversations-retry"]').trigger("click");
    await flushPromises();
    expect(
      calls.filter((c) => c.method === "GET" && c.url === "/api/v1/conversations?limit=20").length,
    ).toBe(2);
    wrapper.unmount();
  });

  it("opens a conversation in chat with both ids", async () => {
    const navigateTo = vi.fn();
    vi.stubGlobal("uni", { navigateTo });
    stubFetch();
    const wrapper = mount(ConversationsPage, { attachTo: document.body });
    await flushPromises();

    await wrapper.find('[data-testid="conversation-open"]').trigger("click");
    expect(navigateTo).toHaveBeenCalledWith({
      url: "/pages/chat/chat?relationshipId=rel-1&conversationId=c1",
    });
    wrapper.unmount();
  });

  it("renames only after a confirmed PATCH", async () => {
    const { calls } = stubFetch();
    const wrapper = mount(ConversationsPage, { attachTo: document.body });
    await flushPromises();

    await openManage(wrapper);
    await wrapper.find('[data-testid="conversation-rename"]').trigger("click");
    await wrapper.find('[data-testid="conversation-rename-input"]').setValue("新标题");
    await wrapper.find('[data-testid="conversation-rename-save"]').trigger("click");
    await flushPromises();

    expect(
      calls.some(
        (c) =>
          c.method === "PATCH" &&
          c.url === "/api/v1/conversations/c1" &&
          c.body?.includes("新标题"),
      ),
    ).toBe(true);
    expect(wrapper.find('[data-testid="conversation-card"]').text()).toContain("新标题");
    wrapper.unmount();
  });

  it("keeps the rename draft and offers a retry when PATCH fails", async () => {
    const { calls } = stubFetch({ renameStatus: 500 });
    const wrapper = mount(ConversationsPage, { attachTo: document.body });
    await flushPromises();

    await openManage(wrapper);
    await wrapper.find('[data-testid="conversation-rename"]').trigger("click");
    await wrapper.find('[data-testid="conversation-rename-input"]').setValue("暂存标题");
    await wrapper.find('[data-testid="conversation-rename-save"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="conversation-action-error"]').text()).toContain(
      "改名未完成",
    );
    expect(
      (wrapper.find('[data-testid="conversation-rename-input"]').element as HTMLInputElement).value,
    ).toBe("暂存标题");
    expect(wrapper.get('[data-testid="conversation-action-retry"]').text()).toContain("重试改名");

    await wrapper.get('[data-testid="conversation-action-retry"]').trigger("click");
    await flushPromises();
    expect(calls.filter((c) => c.method === "PATCH" && c.url === "/api/v1/conversations/c1")).toHaveLength(2);
    expect(
      (wrapper.find('[data-testid="conversation-rename-input"]').element as HTMLInputElement).value,
    ).toBe("暂存标题");
    wrapper.unmount();
  });

  // P1-B（round3）：改名输入绝不预填密文。打开管理 → 改名后直接读取
  // input.element.value（不用 wrapper.text() 代替）：enc1:/enc2:、密文长
  // token、空值一律空串，且不含内部 conversationId。
  it("never prefills an enc1/enc2 ciphertext title into the rename input", async () => {
    for (const title of [`enc1:${"B".repeat(120)}`, `enc2:${"A".repeat(120)}`, ""]) {
      stubFetch({ conversations: [item({ title })] });
      const wrapper = mount(ConversationsPage, { attachTo: document.body });
      await flushPromises();

      await openManage(wrapper);
      await wrapper.find('[data-testid="conversation-rename"]').trigger("click");
      await wrapper.vm.$nextTick();

      const input = wrapper.find('[data-testid="conversation-rename-input"]');
      expect(input.exists(), "rename row rendered").toBe(true);
      const value = (input.element as HTMLInputElement).value;
      expect(value).toBe("");
      expect(value).not.toContain("enc1:");
      expect(value).not.toContain("enc2:");
      expect(value).not.toContain("c1");
      wrapper.unmount();
    }
  });

  // P2（round4）：不带 enc 前缀的长无空格 opaque token 同样不可读，改名
  // 输入必须预填空串。
  it("never prefills a long opaque token without an enc prefix", async () => {
    stubFetch({ conversations: [item({ title: "K7f".repeat(40) })] });
    const wrapper = mount(ConversationsPage, { attachTo: document.body });
    await flushPromises();

    await openManage(wrapper);
    await wrapper.find('[data-testid="conversation-rename"]').trigger("click");
    await wrapper.vm.$nextTick();

    const value = (
      wrapper.find('[data-testid="conversation-rename-input"]').element as HTMLInputElement
    ).value;
    expect(value).toBe("");
    wrapper.unmount();
  });

  it("prefills a readable trimmed title into the rename input", async () => {
    stubFetch({ conversations: [item({ title: "  周二夜聊  " })] });
    const wrapper = mount(ConversationsPage, { attachTo: document.body });
    await flushPromises();

    await openManage(wrapper);
    await wrapper.find('[data-testid="conversation-rename"]').trigger("click");
    await wrapper.vm.$nextTick();

    const value = (
      wrapper.find('[data-testid="conversation-rename-input"]').element as HTMLInputElement
    ).value;
    expect(value).toBe("周二夜聊");
    wrapper.unmount();
  });

  it("deletes only after the two-step confirm and a confirmed DELETE", async () => {
    const { calls } = stubFetch();
    const wrapper = mount(ConversationsPage, { attachTo: document.body });
    await flushPromises();

    await openManage(wrapper);
    const del = wrapper.find('[data-testid="conversation-delete"]');
    await del.trigger("click");
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    expect(wrapper.find('[data-testid="conversation-delete"]').text()).toContain("确认删除");

    await openManage(wrapper);
    await wrapper.find('[data-testid="conversation-delete"]').trigger("click");
    await flushPromises();
    expect(calls.some((c) => c.method === "DELETE" && c.url === "/api/v1/conversations/c1")).toBe(
      true,
    );
    expect(wrapper.find('[data-testid="conversation-card"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("keeps the row and hides existence when DELETE returns 404", async () => {
    stubFetch({ deleteStatus: 404 });
    const wrapper = mount(ConversationsPage, { attachTo: document.body });
    await flushPromises();

    await openManage(wrapper);
    await wrapper.find('[data-testid="conversation-delete"]').trigger("click");
    await openManage(wrapper);
    await wrapper.find('[data-testid="conversation-delete"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="conversation-card"]').exists()).toBe(true);
    expect(wrapper.text()).not.toMatch(/不存在|无权|404/);
    wrapper.unmount();
  });

  it("keeps delete confirmation and offers a retry for a 404", async () => {
    const { calls } = stubFetch({ deleteStatus: 404 });
    const wrapper = mount(ConversationsPage, { attachTo: document.body });
    await flushPromises();

    await openManage(wrapper);
    await wrapper.find('[data-testid="conversation-delete"]').trigger("click");
    await wrapper.find('[data-testid="conversation-delete"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="conversation-action-error"]').text()).toContain(
      "删除未完成",
    );
    expect(wrapper.find('[data-testid="conversation-delete"]').text()).toContain("确认删除");
    expect(wrapper.get('[data-testid="conversation-action-retry"]').text()).toContain("重试删除");

    await wrapper.get('[data-testid="conversation-action-retry"]').trigger("click");
    await flushPromises();
    expect(calls.filter((c) => c.method === "DELETE" && c.url === "/api/v1/conversations/c1")).toHaveLength(2);
    expect(wrapper.find('[data-testid="conversation-delete"]').text()).toContain("确认删除");
    wrapper.unmount();
  });

  it("ends today's conversation after two-step confirm and does not drop the row", async () => {
    const { calls } = stubFetch();
    const wrapper = mount(ConversationsPage, { attachTo: document.body });
    await flushPromises();

    await openManage(wrapper);
    await wrapper.find('[data-testid="conversation-end"]').trigger("click");
    expect(calls.some((c) => c.url.endsWith("/end"))).toBe(false);

    await openManage(wrapper);
    await wrapper.find('[data-testid="conversation-end"]').trigger("click");
    await flushPromises();
    expect(
      calls.some((c) => c.method === "POST" && c.url === "/api/v1/conversations/c1/end"),
    ).toBe(true);
    expect(wrapper.find('[data-testid="conversation-card"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("keeps end confirmation and offers a retry for a 403", async () => {
    const { calls } = stubFetch({ endStatus: 403 });
    const wrapper = mount(ConversationsPage, { attachTo: document.body });
    await flushPromises();

    await openManage(wrapper);
    await wrapper.find('[data-testid="conversation-end"]').trigger("click");
    await wrapper.find('[data-testid="conversation-end"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="conversation-action-error"]').text()).toContain(
      "结束未完成",
    );
    expect(wrapper.find('[data-testid="conversation-end"]').text()).toContain("确认结束");
    expect(wrapper.get('[data-testid="conversation-action-retry"]').text()).toContain("重试结束");

    await wrapper.get('[data-testid="conversation-action-retry"]').trigger("click");
    await flushPromises();
    expect(calls.filter((c) => c.method === "POST" && c.url === "/api/v1/conversations/c1/end")).toHaveLength(2);
    expect(wrapper.find('[data-testid="conversation-end"]').text()).toContain("确认结束");
    wrapper.unmount();
  });

  it("reloads with a relationship filter when the selector changes", async () => {
    const { calls } = stubFetch();
    const wrapper = mount(ConversationsPage, { attachTo: document.body });
    await flushPromises();
    const relStore = useRelationshipStore();
    expect(relStore.relationships.length).toBe(1);

    await wrapper.find('[data-testid="relationship-select"]').setValue("rel-1");
    await flushPromises();

    expect(
      calls.some(
        (c) =>
          c.method === "GET" &&
          c.url === "/api/v1/conversations?relationshipId=rel-1&limit=20",
      ),
    ).toBe(true);
    wrapper.unmount();
  });

  it("CONV-MORE: a full first page offers load-more and appends the next keyset", async () => {
    const page1 = Array.from({ length: 20 }, (_, i) =>
      item({ conversationId: `c${i + 1}`, title: `会话 ${i + 1}` }),
    );
    const page2 = [item({ conversationId: "c21", title: "会话 21" })];
    let listCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        const method = (init?.method ?? "GET").toUpperCase();
        if (url === "/api/v1/relationships" && method === "GET") {
          return { ok: true, status: 200, json: async () => [REL] };
        }
        if (url.startsWith("/api/v1/conversations") && method === "GET") {
          listCalls += 1;
          if (url.includes("after=c20")) {
            return { ok: true, status: 200, json: async () => page2 };
          }
          return { ok: true, status: 200, json: async () => page1 };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      }),
    );
    const wrapper = mount(ConversationsPage, { attachTo: document.body });
    await flushPromises();

    expect(wrapper.findAll('[data-testid="conversation-card"]')).toHaveLength(20);
    const more = wrapper.find('[data-testid="conversations-load-more"]');
    expect(more.exists()).toBe(true);
    await more.trigger("click");
    await flushPromises();

    expect(listCalls).toBe(2);
    expect(wrapper.findAll('[data-testid="conversation-card"]')).toHaveLength(21);
    expect(wrapper.text()).toContain("会话 21");
    expect(wrapper.find('[data-testid="conversations-load-more"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("S0-21: load-more failure keeps rows and retries only the next keyset", async () => {
    const page1 = Array.from({ length: 20 }, (_, i) =>
      item({ conversationId: `c${i + 1}`, title: `会话 ${i + 1}` }),
    );
    let pageCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        const method = (init?.method ?? "GET").toUpperCase();
        if (url === "/api/v1/relationships" && method === "GET") {
          return { ok: true, status: 200, json: async () => [REL] };
        }
        if (url.startsWith("/api/v1/conversations") && method === "GET") {
          pageCalls += 1;
          if (url.includes("after=c20") && pageCalls === 2) {
            return { ok: false, status: 500, json: async () => ({ code: "INTERNAL_ERROR" }) };
          }
          if (url.includes("after=c20")) {
            return { ok: true, status: 200, json: async () => [item({ conversationId: "c21" })] };
          }
          return { ok: true, status: 200, json: async () => page1 };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      }),
    );
    const wrapper = mount(ConversationsPage, { attachTo: document.body });
    await flushPromises();

    await wrapper.find('[data-testid="conversations-load-more"]').trigger("click");
    await flushPromises();
    expect(wrapper.findAll('[data-testid="conversation-card"]')).toHaveLength(20);
    expect(wrapper.text()).toContain("更多会话加载失败");
    expect(wrapper.find('[data-testid="conversations-load-more"]').text()).toContain("重试");

    await wrapper.find('[data-testid="conversations-load-more"]').trigger("click");
    await flushPromises();
    expect(pageCalls).toBe(3);
    expect(wrapper.findAll('[data-testid="conversation-card"]')).toHaveLength(21);
    expect(wrapper.text()).not.toContain("更多会话加载失败");
    wrapper.unmount();
  });

  it("CHAT-WIPE: previews counts, wipes after the two-step confirm and clears the list", async () => {
    const { calls } = stubFetch({ conversations: [item()] });
    const wrapper = mount(ConversationsPage, { attachTo: document.body });
    await flushPromises();

    // Nothing destructive is reachable before the preview.
    expect(wrapper.find('[data-testid="chat-wipe-confirm"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="chat-wipe-preview"]').exists()).toBe(false);

    await wrapper.find('[data-testid="chat-wipe-toggle"]').trigger("click");
    await wrapper.find('[data-testid="chat-wipe-preview"]').trigger("click");
    await flushPromises();

    const preview = wrapper.find('[data-testid="chat-wipe-preview-result"]');
    expect(preview.exists()).toBe(true);
    expect(preview.text()).toContain("2 个会话");
    expect(preview.text()).toContain("9 条消息");

    // First confirm click only arms; the wipe POST has not fired yet.
    const confirm = wrapper.find('[data-testid="chat-wipe-confirm"]');
    expect(confirm.text()).toContain("删除全部会话");
    await confirm.trigger("click");
    await flushPromises();
    expect(calls.some((c) => c.method === "POST" && c.url === "/api/v1/conversations/wipe")).toBe(
      false,
    );

    await wrapper.find('[data-testid="chat-wipe-confirm"]').trigger("click");
    await flushPromises();

    expect(calls.some((c) => c.method === "POST" && c.url === "/api/v1/conversations/wipe")).toBe(
      true,
    );
    expect(wrapper.find('[data-testid="chat-wipe-done"]').exists()).toBe(true);
    expect(wrapper.findAll('[data-testid="conversation-card"]')).toHaveLength(0);
    wrapper.unmount();
  });

  it("CHAT-WIPE: a failed wipe keeps the list and never fakes success", async () => {
    stubFetch({ conversations: [item()], wipeStatus: 500 });
    const wrapper = mount(ConversationsPage, { attachTo: document.body });
    await flushPromises();

    await wrapper.find('[data-testid="chat-wipe-toggle"]').trigger("click");
    await wrapper.find('[data-testid="chat-wipe-preview"]').trigger("click");
    await flushPromises();
    await wrapper.find('[data-testid="chat-wipe-confirm"]').trigger("click");
    await wrapper.find('[data-testid="chat-wipe-confirm"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="chat-wipe-failed"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="chat-wipe-done"]').exists()).toBe(false);
    expect(wrapper.findAll('[data-testid="conversation-card"]')).toHaveLength(1);
    wrapper.unmount();
  });
});
