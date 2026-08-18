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

    expect(calls.some((c) => c.method === "GET" && c.url === "/api/v1/conversations")).toBe(true);
    const cards = wrapper.findAll('[data-testid="conversation-card"]');
    expect(cards).toHaveLength(2);
    expect(cards[0].text()).toContain("周二夜聊");
    expect(cards[0].text()).toContain("今晚早点休息");
    expect(cards[1].text()).toContain("无痕预览");
    expect(cards[1].find('[data-testid="conversation-incognito"]').text()).toContain("无痕");
    wrapper.unmount();
  });

  it("filters the list when relationshipId is in the query", async () => {
    vi.stubGlobal("location", { search: "?relationshipId=rel-1", href: "" });
    const { calls } = stubFetch();
    const wrapper = mount(ConversationsPage, { attachTo: document.body });
    await flushPromises();

    expect(
      calls.some(
        (c) => c.method === "GET" && c.url === "/api/v1/conversations?relationshipId=rel-1",
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

  it("surfaces a load failure and retries through the same GET", async () => {
    const { calls } = stubFetch({ listStatus: 500 });
    const wrapper = mount(ConversationsPage, { attachTo: document.body });
    await flushPromises();

    expect(wrapper.find('[data-testid="conversations-load-failed"]').text()).toContain("加载失败");
    expect(wrapper.find('[data-testid="conversation-card"]').exists()).toBe(false);

    await wrapper.find('[data-testid="conversations-retry"]').trigger("click");
    await flushPromises();
    expect(calls.filter((c) => c.method === "GET" && c.url === "/api/v1/conversations").length).toBe(
      2,
    );
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

  it("deletes only after the two-step confirm and a confirmed DELETE", async () => {
    const { calls } = stubFetch();
    const wrapper = mount(ConversationsPage, { attachTo: document.body });
    await flushPromises();

    const del = wrapper.find('[data-testid="conversation-delete"]');
    await del.trigger("click");
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    expect(wrapper.find('[data-testid="conversation-delete"]').text()).toContain("确认删除");

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

    await wrapper.find('[data-testid="conversation-delete"]').trigger("click");
    await wrapper.find('[data-testid="conversation-delete"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="conversation-card"]').exists()).toBe(true);
    expect(wrapper.text()).not.toMatch(/不存在|无权|404/);
    wrapper.unmount();
  });

  it("ends today's conversation after two-step confirm and does not drop the row", async () => {
    const { calls } = stubFetch();
    const wrapper = mount(ConversationsPage, { attachTo: document.body });
    await flushPromises();

    await wrapper.find('[data-testid="conversation-end"]').trigger("click");
    expect(calls.some((c) => c.url.endsWith("/end"))).toBe(false);

    await wrapper.find('[data-testid="conversation-end"]').trigger("click");
    await flushPromises();
    expect(
      calls.some((c) => c.method === "POST" && c.url === "/api/v1/conversations/c1/end"),
    ).toBe(true);
    expect(wrapper.find('[data-testid="conversation-card"]').exists()).toBe(true);
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
        (c) => c.method === "GET" && c.url === "/api/v1/conversations?relationshipId=rel-1",
      ),
    ).toBe(true);
    wrapper.unmount();
  });
});
