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
import type { Memory } from "@/api/memory";

function canonicalMemory(id: string, summary = "s"): Memory {
  return { memoryId: id, scope: "RELATIONSHIP", summary, status: "ACCEPTED" };
}

function mountPage() {
  return mount(MemoryPage, { attachTo: document.body });
}

describe("memory page glue (P2-19 component test)", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("uni", undefined);
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
});
