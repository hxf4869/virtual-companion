// REMINDER (FR-NOTIFY-001): store unit tests — loads only mutate on confirmed
// API results; existence-hidden failures never fake success.
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Reminder, ReminderTransport } from "@/api/reminder";
import { useReminderStore } from "@/stores/reminder";

const REMINDER: Reminder = {
  reminderId: "55",
  relationshipId: "10",
  text: "晚上十点提醒我准备休息",
  remindAt: "2026-08-16T12:00:00Z",
  recurrence: "NONE",
  status: "ACTIVE",
  createdAt: "2026-08-16T08:00:00Z",
};

function mockTransport(opts: {
  listJson?: unknown;
  createJson?: unknown;
  createOk?: boolean;
  deleteOk?: boolean;
} = {}): ReminderTransport {
  return {
    async request(method: string, path: string): Promise<{ ok: boolean; status: number; json: unknown }> {
      if (method === "GET") {
        return { ok: true, status: 200, json: opts.listJson ?? [] };
      }
      if (method === "POST") {
        const ok = opts.createOk ?? true;
        return { ok, status: ok ? 200 : 404, json: ok ? (opts.createJson ?? REMINDER) : null };
      }
      if (method === "PATCH") {
        return { ok: true, status: 200, json: { ...REMINDER, status: "DISMISSED" } };
      }
      // DELETE
      return { ok: opts.deleteOk ?? true, status: opts.deleteOk ?? true ? 200 : 404, json: { ok: true } };
    },
  };
}

describe("useReminderStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("loads the relationship's reminders", async () => {
    const store = useReminderStore();
    await store.load(mockTransport({ listJson: [REMINDER] }), "10");

    expect(store.relationshipId).toBe("10");
    expect(store.reminders).toHaveLength(1);
    expect(store.reminders[0].text).toBe("晚上十点提醒我准备休息");
  });

  it("create prepends only a confirmed row", async () => {
    const store = useReminderStore();
    await store.load(mockTransport({ listJson: [] }), "10");

    expect(
      await store.create(mockTransport(), "明天晚上问我面试怎么样", "2026-08-17T12:00:00Z", "NONE"),
    ).toBe(true);
    expect(store.reminders).toHaveLength(1);

    // Existence-hidden failure keeps the list untouched and reports false.
    expect(
      await store.create(mockTransport({ createOk: false }), "x", "2026-08-17T12:00:00Z", "NONE"),
    ).toBe(false);
    expect(store.reminders).toHaveLength(1);
  });

  it("create without a relationship is a silent no-op", async () => {
    const store = useReminderStore();
    expect(await store.create(mockTransport(), "x", "2026-08-17T12:00:00Z", "NONE")).toBe(false);
  });

  it("dismiss flips only the confirmed row", async () => {
    const store = useReminderStore();
    await store.load(mockTransport({ listJson: [REMINDER] }), "10");

    expect(await store.dismiss(mockTransport(), REMINDER)).toBe(true);
    expect(store.reminders[0].status).toBe("DISMISSED");

    // An already dismissed reminder is not re-dismissed.
    expect(await store.dismiss(mockTransport(), store.reminders[0])).toBe(false);
  });

  it("remove drops only the confirmed row", async () => {
    const store = useReminderStore();
    await store.load(mockTransport({ listJson: [REMINDER] }), "10");

    expect(await store.remove(mockTransport({ deleteOk: true }), "55")).toBe(true);
    expect(store.reminders).toHaveLength(0);

    // Existence-hidden false keeps the row.
    await store.load(mockTransport({ listJson: [REMINDER] }), "10");
    expect(await store.remove(mockTransport({ deleteOk: false }), "55")).toBe(false);
    expect(store.reminders).toHaveLength(1);
  });
});
