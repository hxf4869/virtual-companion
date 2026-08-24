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

function pendingMemory(id: string, summary = "s"): Memory {
  return { memoryId: id, scope: "RELATIONSHIP", summary, status: "PENDING_CONFIRMATION" };
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

  it("opens the independent detail page instead of expanding evidence inline", async () => {
    const navigateTo = vi.fn();
    vi.stubGlobal("uni", { navigateTo });
    const store = useMemoryStore();
    store.canonical = [canonicalMemory("m1")];
    const wrapper = mountPage();
    await wrapper.vm.$nextTick();

    expect(wrapper.find(".evidence").exists()).toBe(false);
    const detail = wrapper.find('[data-testid="memory-open-detail"]');
    expect(detail.text()).toContain("详情");
    await detail.trigger("click");
    expect(navigateTo).toHaveBeenCalledWith({
      url: "/pages/memory-detail/memory-detail?memoryId=m1",
    });
    wrapper.unmount();
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

  it("MEM-GROUPS: splits saved memory by scope and keeps rejected/expired out of saved facts", async () => {
    const store = useMemoryStore();
    store.canonical = [
      canonicalMemory("rel-1", "角色专属"),
      { memoryId: "sess-1", scope: "SESSION", summary: "会话记忆", status: "ACCEPTED" },
    ];
    store.rejected = [
      { memoryId: "rej-1", scope: "RELATIONSHIP", summary: "被拒绝的候选", status: "REJECTED" },
    ];
    store.expired = [
      { memoryId: "exp-1", scope: "RELATIONSHIP", summary: "过期记忆", status: "EXPIRED" },
    ];
    const wrapper = mountPage();
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="memory-group-relationship"]').text()).toContain("角色专属");
    expect(wrapper.find('[data-testid="memory-group-session"]').text()).toContain("会话记忆");
    expect(wrapper.find('[data-testid="memory-group-rejected"]').text()).toContain("被拒绝的候选");
    expect(wrapper.find('[data-testid="memory-group-rejected"]').text()).toContain("不作为已保存事实");
    expect(wrapper.find('[data-testid="memory-group-rejected"]').text()).not.toContain("已保存记忆");
    expect(wrapper.find('[data-testid="memory-group-expired"]').text()).toContain("过期记忆");
    expect(wrapper.find('[data-testid="memory-group-expired"]').text()).toContain("不作为已保存事实");
    expect(wrapper.find('[data-testid="memory-group-expired"]').text()).not.toContain("已保存记忆");
    wrapper.unmount();
  });

  it("MEM-FILTER: hides saved memories whose summary does not match", async () => {
    const store = useMemoryStore();
    store.canonical = [
      canonicalMemory("keep-1", "喜欢安静的晚上"),
      canonicalMemory("drop-1", "周末去散步"),
    ];
    const wrapper = mountPage();
    await wrapper.vm.$nextTick();
    await wrapper.find('[data-testid="memory-filter"]').setValue("安静");
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain("喜欢安静的晚上");
    expect(wrapper.text()).not.toContain("周末去散步");
    wrapper.unmount();
  });

  it("shows createdAt on a saved memory when the API provided one", async () => {
    const store = useMemoryStore();
    store.canonical = [
      { ...canonicalMemory("rel-1", "角色专属"), createdAt: "2026-08-19T12:00:00Z" },
    ];
    const wrapper = mountPage();
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-testid="memory-created-rel-1"]').text()).toContain("2026-08-19");
    wrapper.unmount();
  });

  it("MEM-DELETED: shows deleted memories as a non-canonical group", async () => {
    const store = useMemoryStore();
    store.canonical = [canonicalMemory("acc-1", "还在")];
    store.deleted = [
      {
        memoryId: "del-1",
        scope: "RELATIONSHIP",
        summary: "已经删掉的记忆",
        status: "ACCEPTED",
        deletedAt: "2026-08-18T12:00:00Z",
      },
    ];
    const wrapper = mountPage();
    await wrapper.vm.$nextTick();

    const group = wrapper.find('[data-testid="memory-group-deleted"]');
    expect(group.exists()).toBe(true);
    expect(group.text()).toContain("已经删掉的记忆");
    expect(group.text()).toContain("不作为已保存事实");
    expect(group.text()).not.toContain("已保存记忆");
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

  it("S0-22: the first delete click does not send a delete request", async () => {
    const store = useMemoryStore();
    const remove = vi.spyOn(store, "remove").mockResolvedValue();
    vi.spyOn(store, "load").mockImplementation(async () => {
      store.canonical = [canonicalMemory("c-del", "喜欢安静的晚上")];
    });
    const wrapper = mountPage();
    await wrapper.find('input[aria-label="relationship id"]').setValue("rel-1");
    await wrapper.findAll("button")[0].trigger("click");
    await flushPromises();

    const del = wrapper.find('[data-testid="memory-delete"]');
    expect(del.exists()).toBe(true);
    await del.trigger("click");
    await wrapper.vm.$nextTick();
    expect(remove).not.toHaveBeenCalled();
    expect(del.text()).toContain("确认删除");
    const confirmation = wrapper.find('[data-testid="memory-delete-confirm"]');
    expect(confirmation.text()).toContain("喜欢安静的晚上");
    expect(confirmation.text()).toContain("当前角色专属");
    expect(confirmation.text()).toContain("来源链接也不再展示");
    expect(confirmation.text()).toContain("删除失败时本条会保留");
    expect(wrapper.text()).toContain("喜欢安静的晚上");
    wrapper.unmount();
  });

  it("S0-22: confirmed delete runs once; a failed delete keeps the row", async () => {
    const store = useMemoryStore();
    const remove = vi.spyOn(store, "remove").mockImplementation(async () => {
      store.error = "delete-failed";
    });
    vi.spyOn(store, "load").mockImplementation(async () => {
      store.canonical = [canonicalMemory("c-del", "喜欢安静的晚上")];
    });
    const wrapper = mountPage();
    await wrapper.find('input[aria-label="relationship id"]').setValue("rel-1");
    await wrapper.findAll("button")[0].trigger("click");
    await flushPromises();

    const del = wrapper.find('[data-testid="memory-delete"]');
    await del.trigger("click");
    await del.trigger("click");
    await flushPromises();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain("喜欢安静的晚上");
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
    vi.stubGlobal("location", { search: "?relationshipId=rel-pick-1" });
    const store = useMemoryStore();
    const loadSpy = vi.spyOn(store, "load");
    const wrapper = mountPage();
    await flushPromises();

    const input = wrapper.find('input[aria-label="relationship id"]');
    expect((input.element as HTMLInputElement).value).toBe("rel-pick-1");
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

  it("drops a query relationship that is absent from the loaded relationship list", async () => {
    vi.stubGlobal("location", { search: "?relationshipId=rel-missing" });
    const wrapper = mountPage();
    await flushPromises();

    const input = wrapper.find('input[aria-label="relationship id"]');
    expect((input.element as HTMLInputElement).value).toBe("");
    expect(wrapper.find('[data-testid="prefill-hint"]').exists()).toBe(false);
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
    vi.stubGlobal("location", { search: "?relationshipId=rel-pick-1" });
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
    await flushPromises();

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

  it("MEM-AUTO-SAVE: renders the switch, flips it, and marks auto-saved rows (§7.4 界面明示)", async () => {
    let enabled = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "/api/v1/relationships") {
          return { ok: true, status: 200, json: async () => [PICKABLE_RELATIONSHIP] };
        }
        if (url === "/api/v1/memories/auto-save" && (init?.method ?? "GET") === "GET") {
          return { ok: true, status: 200, json: async () => ({ enabled }) };
        }
        if (url === "/api/v1/memories/auto-save" && init?.method === "PUT") {
          enabled = (init.body as string).includes("false");
          return { ok: true, status: 200, json: async () => ({ enabled }) };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      }),
    );
    const store = useMemoryStore();
    store.canonical = [
      { ...canonicalMemory("auto-1", "称呼偏好：小雪"), autoSaved: true },
      canonicalMemory("manual-1", "手动确认的记忆"),
    ];
    const wrapper = mountPage();
    await flushPromises();

    const toggle = wrapper.find('[data-testid="memory-auto-save-toggle"]');
    expect(toggle.text()).toContain("已开启");
    expect(wrapper.find('[data-testid="memory-auto-auto-1"]').text()).toContain("自动保存");
    expect(wrapper.find('[data-testid="memory-auto-manual-1"]').exists()).toBe(false);

    await toggle.trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="memory-auto-save-toggle"]').text()).toContain("已关闭");
    wrapper.unmount();
  });

  // --- R44 (V68): supersede + event memories ---

  it("renders explicitly superseded rows in their own group, never as saved facts", async () => {
    const store = useMemoryStore();
    store.canonical = [canonicalMemory("acc-2", "新事实")];
    store.superseded = [
      {
        ...canonicalMemory("acc-1", "旧事实"),
        supersededAt: "2026-08-19T10:00:00Z",
        supersededByMemoryId: "acc-2",
      },
    ];
    const wrapper = mountPage();
    await wrapper.vm.$nextTick();

    const group = wrapper.find('[data-testid="memory-group-superseded"]');
    expect(group.exists()).toBe(true);
    expect(group.text()).toContain("旧事实");
    expect(group.text()).toContain("不作为已保存事实");
    // The replaced row must not appear among the saved facts.
    const canonicalGroup = wrapper.find('[data-testid="memory-group-relationship"]');
    expect(canonicalGroup.exists()).toBe(true);
    expect(canonicalGroup.text()).toContain("新事实");
    expect(canonicalGroup.text()).not.toContain("旧事实");
    wrapper.unmount();
  });

  it("offers the optional supersede choice on pending cards and event fields on the create form", async () => {
    const store = useMemoryStore();
    store.canonical = [canonicalMemory("acc-1", "用户在 A 公司工作")];
    store.pending = [pendingMemory("pend-1", "用户换到 B 公司工作")];
    const wrapper = mountPage();
    await wrapper.vm.$nextTick();

    const select = wrapper.find('[data-testid="memory-supersede-pend-1"]');
    expect(select.exists()).toBe(true);
    expect(select.text()).toContain("不替代已有记忆");
    expect(select.text()).toContain("用户在 A 公司工作");

    // The §11.12 event anchor input is present (optional, hidden extras appear
    // only after it is filled).
    expect(wrapper.find('[data-testid="candidate-event-at"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="candidate-event-status"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
