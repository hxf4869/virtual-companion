// REMINDER (FR-NOTIFY-001): typed client unit tests — wire shapes, parsing,
// existence-hidden mapping and typed errors.
import { describe, expect, it, vi } from "vitest";

import {
  createReminder,
  deleteReminder,
  listReminders,
  ReminderHttpError,
  updateReminder,
  type ReminderTransport,
} from "./reminder";

const REMINDER_JSON = {
  reminderId: 55,
  relationshipId: 10,
  text: "晚上十点提醒我准备休息",
  remindAt: "2026-08-16T12:00:00Z",
  recurrence: "NONE",
  status: "ACTIVE",
  createdAt: "2026-08-16T08:00:00Z",
};

function recorder(
  response: { ok: boolean; status: number; json: unknown },
): { transport: ReminderTransport; calls: { method: string; path: string; body?: unknown }[] } {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const transport: ReminderTransport = {
    request: vi.fn(async (method: string, path: string, body?: unknown) => {
      calls.push({ method, path, body });
      return { ...response };
    }),
  };
  return { transport, calls };
}

describe("reminder api client (FR-NOTIFY-001)", () => {
  it("POSTs the create body and parses the reminder", async () => {
    const { transport, calls } = recorder({ ok: true, status: 200, json: REMINDER_JSON });

    const created = await createReminder(
      transport,
      "10",
      "晚上十点提醒我准备休息",
      "2026-08-16T12:00:00Z",
      "WEEKLY",
    );

    expect(calls).toEqual([
      {
        method: "POST",
        path: "/api/v1/relationships/10/reminders",
        body: {
          text: "晚上十点提醒我准备休息",
          remindAt: "2026-08-16T12:00:00Z",
          recurrence: "WEEKLY",
        },
      },
    ]);
    expect(created?.reminderId).toBe("55");
    expect(created?.recurrence).toBe("NONE");
  });

  it("lists with the after cursor", async () => {
    const { transport, calls } = recorder({ ok: true, status: 200, json: [REMINDER_JSON] });

    const list = await listReminders(transport, "10", "42", 20);

    expect(calls[0].path).toBe("/api/v1/relationships/10/reminders?after=42&limit=20");
    expect(list).toHaveLength(1);
  });

  it("maps create 403/404 to null (existence hidden)", async () => {
    const t404 = recorder({ ok: false, status: 404, json: null }).transport;
    expect(await createReminder(t404, "999", "x", "2026-08-16T12:00:00Z")).toBeNull();
  });

  it("throws a typed error on 5xx", async () => {
    const { transport } = recorder({ ok: false, status: 500, json: null });

    await expect(
      createReminder(transport, "10", "x", "2026-08-16T12:00:00Z"),
    ).rejects.toBeInstanceOf(ReminderHttpError);
  });

  it("PATCHes the whole record", async () => {
    const { transport, calls } = recorder({ ok: true, status: 200, json: REMINDER_JSON });

    const updated = await updateReminder(transport, "55", {
      text: "text",
      remindAt: "2026-08-16T12:00:00Z",
      recurrence: "DAILY",
      status: "DISMISSED",
    });

    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].path).toBe("/api/v1/reminders/55");
    expect(calls[0].body).toEqual({
      text: "text",
      remindAt: "2026-08-16T12:00:00Z",
      recurrence: "DAILY",
      status: "DISMISSED",
    });
    expect(updated).not.toBeNull();
  });

  it("deletes and maps 403/404 to false", async () => {
    const ok = recorder({ ok: true, status: 200, json: { ok: true } }).transport;
    expect(await deleteReminder(ok, "55")).toBe(true);

    const gone = recorder({ ok: false, status: 404, json: null }).transport;
    expect(await deleteReminder(gone, "999")).toBe(false);
  });
});
