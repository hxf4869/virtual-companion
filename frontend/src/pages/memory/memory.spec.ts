// @vitest-environment happy-dom
// TASK-0106 (P2-19): memory page component glue test -- real .vue mounting
// with the pinia store, covering the transport/page behaviors that pure
// api/store specs cannot: aria-label on the relationship input, the
// role=alert error region, empty-evidence container gating and
// exit-edit-only-on-confirmed-save.
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import MemoryPage from "./memory.vue";
import { useMemoryStore } from "@/stores/memory";
import { useRelationshipStore } from "@/stores/relationship";
import type { Memory } from "@/api/memory";

function canonicalMemory(id: string, summary = "s"): Memory {
  return { memoryId: id, scope: "RELATIONSHIP", summary, status: "ACCEPTED" };
}

const PICKABLE_RELATIONSHIP = {
  relationshipId: "rel-pick-1",
  personaRef: "gentle-listener",
  active: false,
  createdAt: "2026-08-15T00:00:00Z",
};

function stubRelationshipFetch(
  relationships: unknown[] = [PICKABLE_RELATIONSHIP],
): void {
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

function mountPage() {
  return mount(MemoryPage, { attachTo: document.body });
}

describe("memory page glue (P2-19 component test)", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("uni", undefined);
    stubRelationshipFetch();
  });

  it("renders a stable aria-label on the relationship input (P3-04)", () => {
    const wrapper = mountPage();
    expect(wrapper.find('input[aria-label="relationship id"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("renders the error region with role=alert when the store has an error", async () => {
    const store = useMemoryStore();
    store.error = "load-failed";
    const wrapper = mountPage();
    await wrapper.vm.$nextTick();
    const alert = wrapper.find('[role="alert"]');
    expect(alert.exists()).toBe(true);
    expect(alert.text()).toContain("加载失败");
    wrapper.unmount();
  });

  it("renders the evidence container only when sources are non-empty (P3-03)", async () => {
    const store = useMemoryStore();
    store.canonical = [canonicalMemory("m1")];
    store.evidence = { m1: [] };
    const empty = mountPage();
    await empty.vm.$nextTick();
    expect(empty.find(".evidence").exists()).toBe(false);

    store.evidence = { m1: [{ evidenceId: "e1", sourceRef: "src-1" }] };
    await empty.vm.$nextTick();
    expect(empty.find(".evidence").exists()).toBe(true);
    expect(empty.find(".source").text()).toContain("src-1");
    empty.unmount();
  });

  it("keeps the edit row open on a failed save and exits on a confirmed save (P3-03)", async () => {
    const store = useMemoryStore();
    store.canonical = [canonicalMemory("m1", "original")];
    const wrapper = mountPage();
    await wrapper.vm.$nextTick();

    // Enter edit mode.
    await wrapper.findAll("button").find((b) => b.text() === "编辑")!.trigger("click");
    expect(wrapper.find(".edit-row").exists()).toBe(true);

    // Failed save: store.update resolves false -> the edit row stays open.
    const updateSpy = vi.spyOn(store, "update").mockResolvedValue(false);
    await wrapper.find(".edit-row button").trigger("click");
    await wrapper.vm.$nextTick();
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(wrapper.find(".edit-row").exists()).toBe(true);

    // Confirmed save: update resolves true -> edit row closes.
    updateSpy.mockResolvedValue(true);
    await wrapper.find(".edit-row button").trigger("click");
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".edit-row").exists()).toBe(false);
    wrapper.unmount();
  });

  it("does not claim empty lists before a successful load", () => {
    const wrapper = mountPage();
    expect(wrapper.find('[data-testid="empty-pending"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="empty-canonical"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("shows empty pending and canonical statuses after a successful empty load", async () => {
    const store = useMemoryStore();
    vi.spyOn(store, "load").mockResolvedValue();
    const wrapper = mountPage();
    await wrapper.find('input[aria-label="relationship id"]').setValue("rel-1");
    await wrapper.findAll("button")[0].trigger("click");
    await flushPromises();

    const pending = wrapper.find('[data-testid="empty-pending"]');
    const canonical = wrapper.find('[data-testid="empty-canonical"]');
    expect(pending.exists()).toBe(true);
    expect(pending.attributes("role")).toBe("status");
    expect(pending.text()).not.toContain("已保存");
    expect(canonical.exists()).toBe(true);
    expect(canonical.attributes("role")).toBe("status");
    expect(canonical.text()).toContain("已保存记忆");
    wrapper.unmount();
  });

  it("hides a side's empty status when that list has items", async () => {
    const store = useMemoryStore();
    vi.spyOn(store, "load").mockImplementation(async () => {
      store.pending = [
        {
          memoryId: "p1",
          scope: "RELATIONSHIP",
          summary: "candidate",
          status: "PENDING_CONFIRMATION",
        },
      ];
      store.canonical = [canonicalMemory("c1")];
    });
    const wrapper = mountPage();
    await wrapper.find('input[aria-label="relationship id"]').setValue("rel-1");
    await wrapper.findAll("button")[0].trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="empty-pending"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="empty-canonical"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("does not treat a failed load as an empty-list confirmation", async () => {
    const store = useMemoryStore();
    vi.spyOn(store, "load").mockImplementation(async () => {
      store.error = "load-failed";
    });
    const wrapper = mountPage();
    await wrapper.find('input[aria-label="relationship id"]').setValue("rel-1");
    await wrapper.findAll("button")[0].trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="empty-pending"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="empty-canonical"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("renders a back-to-index entry before a relationship id is entered", () => {
    const wrapper = mountPage();
    const nav = wrapper.find('[data-testid="nav-index"]');
    expect(nav.exists()).toBe(true);
    expect(nav.text()).toContain("返回边界台");
    wrapper.unmount();
  });

  it("navigates to the preflight index without calling load or confirm", async () => {
    const navigateTo = vi.fn();
    vi.stubGlobal("uni", { navigateTo });
    const wrapper = mountPage();
    const store = useMemoryStore();
    const loadSpy = vi.spyOn(store, "load");
    const confirmSpy = vi.spyOn(store, "confirm");

    await wrapper.find('[data-testid="nav-index"]').trigger("click");

    expect(navigateTo).toHaveBeenCalledWith({ url: "/pages/index/index" });
    expect(loadSpy).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("renders a login entry before a relationship id is entered", () => {
    const wrapper = mountPage();
    const nav = wrapper.find('[data-testid="nav-login"]');
    expect(nav.exists()).toBe(true);
    expect(nav.text()).toContain("登录");
    wrapper.unmount();
  });

  it("navigates to the login page without calling load or confirm", async () => {
    const navigateTo = vi.fn();
    vi.stubGlobal("uni", { navigateTo });
    const wrapper = mountPage();
    const store = useMemoryStore();
    const loadSpy = vi.spyOn(store, "load");
    const confirmSpy = vi.spyOn(store, "confirm");

    await wrapper.find('[data-testid="nav-login"]').trigger("click");

    expect(navigateTo).toHaveBeenCalledWith({ url: "/pages/login/login" });
    expect(loadSpy).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("renders a back-to-chat entry before a relationship id is entered", () => {
    const wrapper = mountPage();
    const nav = wrapper.find('[data-testid="nav-chat"]');
    expect(nav.exists()).toBe(true);
    expect(nav.text()).toContain("离线聊天");
    wrapper.unmount();
  });

  it("navigates to the chat page without calling load or confirm", async () => {
    const navigateTo = vi.fn();
    vi.stubGlobal("uni", { navigateTo });
    const wrapper = mountPage();
    const store = useMemoryStore();
    const loadSpy = vi.spyOn(store, "load");
    const confirmSpy = vi.spyOn(store, "confirm");

    await wrapper.find('[data-testid="nav-chat"]').trigger("click");

    expect(navigateTo).toHaveBeenCalledWith({ url: "/pages/chat/chat" });
    expect(loadSpy).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("carries a filled relationship id to chat without loading memory", async () => {
    const navigateTo = vi.fn();
    vi.stubGlobal("uni", { navigateTo });
    const wrapper = mountPage();
    const store = useMemoryStore();
    const loadSpy = vi.spyOn(store, "load");

    await wrapper.find('input[aria-label="relationship id"]').setValue("rel-1");
    await wrapper.find('[data-testid="nav-chat"]').trigger("click");

    expect(navigateTo).toHaveBeenCalledWith({
      url: "/pages/chat/chat?relationshipId=rel-1",
    });
    expect(loadSpy).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("prefills relationship id from the query and does not auto-load", async () => {
    vi.stubGlobal("location", { search: "?relationshipId=rel-1" });
    const store = useMemoryStore();
    const loadSpy = vi.spyOn(store, "load");
    const wrapper = mountPage();
    await flushPromises();

    const input = wrapper.find('input[aria-label="relationship id"]');
    expect((input.element as HTMLInputElement).value).toBe("rel-1");
    expect(loadSpy).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="empty-pending"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="empty-relationship-id"]').exists()).toBe(
      false,
    );
    const hint = wrapper.find('[data-testid="prefill-hint"]');
    expect(hint.exists()).toBe(true);
    expect(hint.text()).toContain("已填入关系");
    expect(hint.text()).toContain("刷新记忆");
    expect(hint.text()).not.toContain("聊天");
    await wrapper.vm.$nextTick();
    expect(document.activeElement?.getAttribute("data-testid")).toBe("reload");
    wrapper.unmount();
  });

  it("shows an empty-relationship-id status when the field is blank", () => {
    const wrapper = mountPage();
    const empty = wrapper.find('[data-testid="empty-relationship-id"]');
    expect(empty.exists()).toBe(true);
    expect(empty.attributes("role")).toBe("status");
    expect(empty.text()).toContain("选择或填写");
    expect(empty.text()).toContain("relationship id");
    expect(wrapper.find('[data-testid="prefill-hint"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("hides the prefill hint after a successful load", async () => {
    vi.stubGlobal("location", { search: "?relationshipId=rel-1" });
    const store = useMemoryStore();
    vi.spyOn(store, "load").mockResolvedValue();
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.find('[data-testid="prefill-hint"]').exists()).toBe(true);

    await wrapper.findAll("button")[0].trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="prefill-hint"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("renders the relationship selector", async () => {
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.find('[data-testid="relationship-selector"]').exists()).toBe(
      true,
    );
    wrapper.unmount();
  });

  it("fills the relationship id from the selector without activate, create, or memory load", async () => {
    const wrapper = mountPage();
    await flushPromises();
    const relStore = useRelationshipStore();
    const memStore = useMemoryStore();
    const activateSpy = vi.spyOn(relStore, "activate");
    const createSpy = vi.spyOn(relStore, "create");
    const memLoadSpy = vi.spyOn(memStore, "load");

    await wrapper.find('[data-testid="relationship-select"]').setValue("rel-pick-1");
    await wrapper.vm.$nextTick();

    const input = wrapper.find('input[aria-label="relationship id"]');
    expect((input.element as HTMLInputElement).value).toBe("rel-pick-1");
    expect(activateSpy).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
    expect(memLoadSpy).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="empty-pending"]').exists()).toBe(false);
    const hint = wrapper.find('[data-testid="prefill-hint"]');
    expect(hint.exists()).toBe(true);
    expect(hint.text()).toContain("已填入关系");
    expect(hint.text()).not.toContain("聊天");
    expect(document.activeElement?.getAttribute("data-testid")).toBe("reload");
    wrapper.unmount();
  });

  it("points an empty relationship list to offline chat", async () => {
    stubRelationshipFetch([]);
    const wrapper = mountPage();
    await flushPromises();
    const empty = wrapper.find('[data-testid="empty-relationships"]');
    expect(empty.exists()).toBe(true);
    expect(empty.text()).toContain("离线聊天");
    expect(wrapper.find('[data-testid="nav-chat"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("shows an empty current-relationship copy when none is filled", async () => {
    stubRelationshipFetch([]);
    vi.stubGlobal("location", { search: "" });
    const wrapper = mountPage();
    await flushPromises();
    const status = wrapper.find('[data-testid="current-relationship"]');
    expect(status.exists()).toBe(true);
    expect(status.text()).toContain("还没有当前关系。");
    wrapper.unmount();
  });

  it("shows a relationship load error without calling load or activate", async () => {
    vi.stubGlobal("location", { search: "" });
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
    const memStore = useMemoryStore();
    const activateSpy = vi.spyOn(relStore, "activate");
    const memLoadSpy = vi.spyOn(memStore, "load");
    const confirmSpy = vi.spyOn(memStore, "confirm");

    const err = wrapper.find('[data-testid="relationship-load-error"]');
    expect(err.exists()).toBe(true);
    expect(err.text()).toContain("关系列表加载失败。");
    expect(wrapper.find('[data-testid="current-relationship"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="empty-relationship-id"]').exists()).toBe(false);
    expect(activateSpy).not.toHaveBeenCalled();
    expect(memLoadSpy).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("hides the prefill hint when the relationship list fails", async () => {
    vi.stubGlobal("location", { search: "?relationshipId=rel-1" });
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
    const memStore = useMemoryStore();
    const activateSpy = vi.spyOn(relStore, "activate");
    const memLoadSpy = vi.spyOn(memStore, "load");

    expect(wrapper.find('[data-testid="relationship-load-error"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="prefill-hint"]').exists()).toBe(false);
    expect(activateSpy).not.toHaveBeenCalled();
    expect(memLoadSpy).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("shows the filled relationship id after a selector pick", async () => {
    const wrapper = mountPage();
    await flushPromises();
    const relStore = useRelationshipStore();
    const memStore = useMemoryStore();
    const activateSpy = vi.spyOn(relStore, "activate");
    const memLoadSpy = vi.spyOn(memStore, "load");

    await wrapper.find('[data-testid="relationship-select"]').setValue("rel-pick-1");
    await wrapper.vm.$nextTick();

    const status = wrapper.find('[data-testid="current-relationship"]');
    expect(status.exists()).toBe(true);
    expect(status.text()).toContain("当前关系：rel-pick-1");
    expect(activateSpy).not.toHaveBeenCalled();
    expect(memLoadSpy).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("adds a manual candidate through the entry area (MEM-MANUAL)", async () => {
    const wrapper = mountPage();
    await flushPromises();
    const memStore = useMemoryStore();
    const createSpy = vi
      .spyOn(memStore, "create")
      .mockImplementation(async () => {
        memStore.pending = [
          { memoryId: "man-1", scope: "RELATIONSHIP", summary: "手动记忆", status: "PENDING_CONFIRMATION" },
        ];
      });
    const relInput = wrapper.find('input[aria-label="relationship id"]');
    await relInput.setValue("rel-pick-1");
    const candidateInput = wrapper.find('[data-testid="candidate-input"]');
    await candidateInput.setValue("手动记忆");

    // Empty relationship/blank summary keeps the button disabled (computed).
    const addButton = wrapper.find('[data-testid="candidate-add"]');
    await wrapper.find('[data-testid="candidate-add"]').trigger("click");

    expect(createSpy).toHaveBeenCalledWith(expect.anything(), "rel-pick-1", "手动记忆");
    expect(wrapper.find('[data-testid="candidate-input"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("does not render the unwired create controls", async () => {
    const wrapper = mountPage();
    await flushPromises();
    const relStore = useRelationshipStore();
    const createSpy = vi.spyOn(relStore, "create");

    expect(wrapper.find('[data-testid="persona-ref"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="create-relationship"]').exists()).toBe(
      false,
    );
    expect(createSpy).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
