// REMINDER (FR-NOTIFY-001): Pinia store for the reminder page. The store owns
// the loaded page of reminders plus the create/update/delete flows; the
// transport is injected at call time so specs can mock request() exactly like
// stores/chat.spec.ts. Existence-hidden failures never fake success: a
// null/false result keeps the current list untouched.

import { defineStore } from "pinia";
import { ref } from "vue";

import {
  createReminder,
  deleteReminder as apiDeleteReminder,
  listReminders,
  updateReminder,
  type Reminder,
  type ReminderRecurrence,
  type ReminderTransport,
} from "@/api/reminder";

export const useReminderStore = defineStore("h5-reminder", () => {
  const relationshipId = ref("");
  const reminders = ref<Reminder[]>([]);
  const loadFailed = ref(false);
  const busy = ref(false);

  /** Load the first page for a relationship (non-fatal failure keeps rows). */
  async function load(transport: ReminderTransport, relId: string): Promise<void> {
    relationshipId.value = relId;
    loadFailed.value = false;
    try {
      reminders.value = await listReminders(transport, relId);
    } catch {
      loadFailed.value = true;
    }
  }

  /** Create a reminder and prepend the confirmed row. */
  async function create(
    transport: ReminderTransport,
    text: string,
    remindAt: string,
    recurrence: ReminderRecurrence,
  ): Promise<boolean> {
    if (!relationshipId.value || busy.value) return false;
    busy.value = true;
    try {
      const created = await createReminder(
        transport,
        relationshipId.value,
        text,
        remindAt,
        recurrence,
      );
      if (!created) return false;
      reminders.value = [...reminders.value, created];
      return true;
    } finally {
      busy.value = false;
    }
  }

  /** DISMISS one reminder (status flip through the full-record update). */
  async function dismiss(transport: ReminderTransport, reminder: Reminder): Promise<boolean> {
    if (busy.value || reminder.status !== "ACTIVE") return false;
    busy.value = true;
    try {
      const updated = await updateReminder(transport, reminder.reminderId, {
        text: reminder.text,
        remindAt: reminder.remindAt,
        recurrence: reminder.recurrence,
        status: "DISMISSED",
      });
      if (!updated) return false;
      reminders.value = reminders.value.map((r) =>
        r.reminderId === updated.reminderId ? updated : r,
      );
      return true;
    } finally {
      busy.value = false;
    }
  }

  /** Delete a reminder and drop the confirmed row. */
  async function remove(transport: ReminderTransport, reminderId: string): Promise<boolean> {
    if (busy.value) return false;
    busy.value = true;
    try {
      const deleted = await apiDeleteReminder(transport, reminderId);
      if (deleted) {
        reminders.value = reminders.value.filter((r) => r.reminderId !== reminderId);
      }
      return deleted;
    } finally {
      busy.value = false;
    }
  }

  return {
    relationshipId,
    reminders,
    loadFailed,
    busy,
    load,
    create,
    dismiss,
    remove,
  };
});
