// @vitest-environment happy-dom
// REMINDER (FR-NOTIFY-001): reminder page glue test — renders the create form
// once a relationship is active, lists confirmed rows, and routes the create
// action through the store.
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ReminderPage from "./reminder.vue";
import { useRelationshipStore } from "@/stores/relationship";
import { useReminderStore } from "@/stores/reminder";

const ACTIVE_RELATIONSHIP = {
  relationshipId: "10",
  personaRef: "gentle-listener",
  active: true,
  createdAt: "2026-08-13T01:00:00Z",
};

function stubFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/v1/relationships") {
        return { ok: true, status: 200, json: async () => [ACTIVE_RELATIONSHIP] };
      }
      if (url.includes("/reminders")) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              reminderId: 55,
              relationshipId: 10,
              text: "晚上十点提醒我准备休息",
              remindAt: "2026-08-16T12:00:00Z",
              recurrence: "NONE",
              status: "ACTIVE",
              createdAt: "2026-08-16T08:00:00Z",
            },
          ],
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }),
  );
}

describe("reminder page (FR-NOTIFY-001)", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("uni", undefined);
    stubFetch();
  });

  it("shows the create form and lists reminders once a relationship is active", async () => {
    const wrapper = mount(ReminderPage, { attachTo: document.body });
    await flushPromises();

    expect(wrapper.find('[data-testid="reminder-text"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="reminder-row"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="reminder-row"]').text()).toContain("晚上十点提醒我准备休息");
    wrapper.unmount();
  });

  it("shows the pick-a-relationship hint before any relationship is selected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => [] })),
    );
    const wrapper = mount(ReminderPage, { attachTo: document.body });
    await flushPromises();

    expect(wrapper.find('[data-testid="reminder-no-rel"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="reminder-text"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("routes the create action through the store on submit", async () => {
    const wrapper = mount(ReminderPage, { attachTo: document.body });
    await flushPromises();

    const store = useReminderStore();
    const createSpy = vi.spyOn(store, "create").mockResolvedValue(true);

    await wrapper.find('[data-testid="reminder-text"]').setValue("明天晚上问我面试怎么样");
    await wrapper.find('[data-testid="reminder-at"]').setValue("2026-08-17T21:00");
    await wrapper.find('[data-testid="reminder-create"]').trigger("click");
    await flushPromises();

    expect(createSpy).toHaveBeenCalled();
    const [transport, text, remindAt, recurrence] = createSpy.mock.calls[0];
    expect(text).toBe("明天晚上问我面试怎么样");
    expect(remindAt).toMatch(/^2026-08-17T\d{2}:\d{2}:00/);
    expect(recurrence).toBe("NONE");
    expect(wrapper.find('[data-testid="reminder-write-status"]').text()).toContain("已添加");
    wrapper.unmount();
  });

  it("S0-21: a rejected write shows an error and keeps the entered form", async () => {
    const wrapper = mount(ReminderPage, { attachTo: document.body });
    await flushPromises();
    const store = useReminderStore();
    vi.spyOn(store, "create").mockResolvedValue(false);

    await wrapper.find('[data-testid="reminder-text"]').setValue("不要丢失这段输入");
    await wrapper.find('[data-testid="reminder-at"]').setValue("2026-08-17T21:00");
    await wrapper.find('[data-testid="reminder-create"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="async-error"]').text()).toContain("未添加");
    expect((wrapper.find('[data-testid="reminder-text"]').element as HTMLInputElement).value)
      .toBe("不要丢失这段输入");
    wrapper.unmount();
  });

  it("loads the relationship registry on mount", async () => {
    const wrapper = mount(ReminderPage, { attachTo: document.body });
    await flushPromises();

    const relStore = useRelationshipStore();
    expect(relStore.relationships.length).toBeGreaterThan(0);
    wrapper.unmount();
  });
});
