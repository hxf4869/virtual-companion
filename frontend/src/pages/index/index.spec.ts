// @vitest-environment happy-dom
// TASK-0204: index page glue test -- internal page entries navigate to the
// existing chat/memory/login routes without changing baseline preflight.
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useRelationshipStore } from "@/stores/relationship";

vi.mock("@/api/baseline", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/baseline")>();
  return {
    ...actual,
    fetchBaseline: vi
      .fn()
      .mockRejectedValue(new actual.BaselineRequestError("unreachable", "offline")),
  };
});

import IndexPage from "./index.vue";

function mountPage() {
  return mount(IndexPage, { attachTo: document.body });
}

const ACTIVE_RELATIONSHIP = {
  relationshipId: "rel-index-1",
  personaRef: "gentle-listener",
  active: true,
  createdAt: "2026-08-15T00:00:00Z",
};

function stubRelationshipFetch(relationships: unknown[] = []): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/v1/relationships") {
        return { ok: true, status: 200, json: async () => relationships };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }),
  );
}

describe("index page glue (TASK-0204 internal page nav)", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("uni", {
      navigateTo: vi.fn(),
    });
    stubRelationshipFetch();
  });

  it("renders internal entries for chat, memory, and login", () => {
    const wrapper = mountPage();
    const nav = wrapper.find('[data-testid="alpha-nav"]');
    expect(nav.exists()).toBe(true);
    expect(nav.attributes("role")).toBe("navigation");
    expect(wrapper.find('[data-testid="nav-chat"]').text()).toContain("离线聊天");
    expect(wrapper.find('[data-testid="nav-memory"]').text()).toContain("记忆管理");
    expect(wrapper.find('[data-testid="nav-login"]').text()).toContain("登录");
    wrapper.unmount();
  });

  it("navigates to existing internal pages without calling extra APIs", async () => {
    const navigateTo = vi.fn();
    vi.stubGlobal("uni", { navigateTo });
    const wrapper = mountPage();

    await wrapper.find('[data-testid="nav-chat"]').trigger("click");
    await wrapper.find('[data-testid="nav-memory"]').trigger("click");
    await wrapper.find('[data-testid="nav-login"]').trigger("click");

    expect(navigateTo.mock.calls.map((call) => call[0])).toEqual([
      { url: "/pages/chat/chat" },
      { url: "/pages/memory/memory" },
      { url: "/pages/login/login" },
    ]);
    wrapper.unmount();
  });

  it("carries current relationship id to memory after load", async () => {
    stubRelationshipFetch([ACTIVE_RELATIONSHIP]);
    const navigateTo = vi.fn();
    vi.stubGlobal("uni", { navigateTo });
    const wrapper = mountPage();
    await flushPromises();
    const relStore = useRelationshipStore();
    const activateSpy = vi.spyOn(relStore, "activate");
    const createSpy = vi.spyOn(relStore, "create");

    await wrapper.find('[data-testid="nav-memory"]').trigger("click");

    expect(navigateTo).toHaveBeenCalledWith({
      url: "/pages/memory/memory?relationshipId=rel-index-1",
    });
    expect(activateSpy).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("keeps a bare memory path when there is no current relationship", async () => {
    stubRelationshipFetch([]);
    const navigateTo = vi.fn();
    vi.stubGlobal("uni", { navigateTo });
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.find('[data-testid="nav-memory"]').trigger("click");

    expect(navigateTo).toHaveBeenCalledWith({ url: "/pages/memory/memory" });
    wrapper.unmount();
  });

  it("carries current relationship id to chat after load", async () => {
    stubRelationshipFetch([ACTIVE_RELATIONSHIP]);
    const navigateTo = vi.fn();
    vi.stubGlobal("uni", { navigateTo });
    const wrapper = mountPage();
    await flushPromises();
    const relStore = useRelationshipStore();
    const activateSpy = vi.spyOn(relStore, "activate");
    const createSpy = vi.spyOn(relStore, "create");

    await wrapper.find('[data-testid="nav-chat"]').trigger("click");

    expect(navigateTo).toHaveBeenCalledWith({
      url: "/pages/chat/chat?relationshipId=rel-index-1",
    });
    expect(activateSpy).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("keeps a bare chat path when there is no current relationship", async () => {
    stubRelationshipFetch([]);
    const navigateTo = vi.fn();
    vi.stubGlobal("uni", { navigateTo });
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.find('[data-testid="nav-chat"]').trigger("click");

    expect(navigateTo).toHaveBeenCalledWith({ url: "/pages/chat/chat" });
    wrapper.unmount();
  });

  it("shows the current relationship id after a successful load", async () => {
    stubRelationshipFetch([ACTIVE_RELATIONSHIP]);
    const wrapper = mountPage();
    await flushPromises();
    const relStore = useRelationshipStore();
    const activateSpy = vi.spyOn(relStore, "activate");

    const status = wrapper.find('[data-testid="current-relationship"]');
    expect(status.exists()).toBe(true);
    expect(status.text()).toContain("当前关系：rel-index-1");
    expect(activateSpy).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("shows an empty current-relationship copy when none is selected", async () => {
    stubRelationshipFetch([]);
    const wrapper = mountPage();
    await flushPromises();

    const status = wrapper.find('[data-testid="current-relationship"]');
    expect(status.exists()).toBe(true);
    expect(status.text()).toContain("还没有当前关系。");
    wrapper.unmount();
  });
});
