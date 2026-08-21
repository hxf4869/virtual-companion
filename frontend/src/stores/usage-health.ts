// USAGE-HEALTH (§20.7): Pinia store for the health settings page and the
// chat-page heartbeat banner. State only changes on a confirmed API result.

import { defineStore } from "pinia";
import { computed, ref } from "vue";

import {
  getUsageHealth,
  recordUsageReminder,
  updateUsageHealthPrefs,
  usageHeartbeat,
  type ReminderAfterMinutes,
  type SessionGapMinutes,
  type UsageHealthStatus,
  type UsageHealthTransport,
  type UsageReminderResult,
} from "@/api/usage-health";

export const useUsageHealthStore = defineStore("h5-usage-health", () => {
  const status = ref<UsageHealthStatus | null>(null);
  const loadFailed = ref(false);
  const busy = ref(false);
  const shownForStartedAt = ref<string | null>(null);

  const reminderDue = computed(() => status.value?.reminderDue === true);
  const continuousMinutes = computed(() => status.value?.continuousMinutes ?? 0);

  async function load(transport: UsageHealthTransport): Promise<void> {
    loadFailed.value = false;
    try {
      status.value = await getUsageHealth(transport);
    } catch {
      loadFailed.value = true;
    }
  }

  async function savePrefs(
    transport: UsageHealthTransport,
    reminderAfterMinutes: ReminderAfterMinutes,
    sessionGapMinutes: SessionGapMinutes,
  ): Promise<boolean> {
    if (busy.value) return false;
    busy.value = true;
    try {
      status.value = await updateUsageHealthPrefs(
        transport,
        reminderAfterMinutes,
        sessionGapMinutes,
      );
      return true;
    } finally {
      busy.value = false;
    }
  }

  async function heartbeat(transport: UsageHealthTransport): Promise<void> {
    // Non-fatal by contract (§20.7): a network/5xx throw must never break
    // chat-page init or send; keep the previous status on failure.
    try {
      const next = await usageHeartbeat(transport);
      if (next) {
        status.value = next;
      }
    } catch {
      // ignored: heartbeat is best-effort telemetry
    }
  }

  async function record(
    transport: UsageHealthTransport,
    result: UsageReminderResult,
  ): Promise<boolean> {
    if (busy.value) return false;
    busy.value = true;
    try {
      status.value = await recordUsageReminder(transport, result);
      if (result === "CONTINUED" || result === "ENDED") {
        shownForStartedAt.value = null;
      }
      return true;
    } catch {
      // Transport/5xx throw: report a rejected write (the banner stays so
      // the user can retry) instead of an unhandled rejection.
      return false;
    } finally {
      busy.value = false;
    }
  }

  /**
   * Audit-only: record SHOWN the first time this session's reminder is due.
   * Does not hide the banner (only CONTINUED defers reminderDue).
   */
  async function markShown(transport: UsageHealthTransport): Promise<void> {
    const current = status.value;
    if (!current?.reminderDue) return;
    const key = current.sessionStartedAt ?? "due";
    if (shownForStartedAt.value === key) return;
    shownForStartedAt.value = key;
    try {
      status.value = await recordUsageReminder(transport, "SHOWN");
    } catch {
      shownForStartedAt.value = null;
    }
  }

  function reset(): void {
    status.value = null;
    loadFailed.value = false;
    busy.value = false;
    shownForStartedAt.value = null;
  }

  return {
    status,
    loadFailed,
    busy,
    reminderDue,
    continuousMinutes,
    load,
    savePrefs,
    heartbeat,
    record,
    markShown,
    reset,
  };
});
