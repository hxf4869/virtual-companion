// REPORT-BE (FR-DATA-001 / §20.15): Pinia store for the report & complaint
// page. State only changes on a confirmed API result; a null create (invalid
// reason or a hidden 404 for the message anchor) never appends a fake row.

import { defineStore } from "pinia";
import { computed, ref } from "vue";

import {
  createReport,
  listReports,
  type Report,
  type ReportReason,
  type ReportTransport,
} from "@/api/report";

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  UNSAFE_CONTENT: "内容让我不安",
  AI_IDENTITY: "AI 冒充真人",
  MINOR_SAFEGUARD: "涉及未成年人",
  PRIVACY_OR_DATA: "隐私与数据权利",
  OTHER: "其他问题",
};

export const REPORT_STATUS_LABELS: Record<Report["status"], string> = {
  SUBMITTED: "已提交，等待人工处理",
  RESOLVED: "已处理",
};

export const useReportStore = defineStore("h5-report", () => {
  const reports = ref<Report[]>([]);
  const loadFailed = ref(false);
  const loaded = ref(false);
  const busy = ref(false);

  const submittedCount = computed(
    () => reports.value.filter((r) => r.status === "SUBMITTED").length,
  );

  async function load(transport: ReportTransport): Promise<void> {
    loadFailed.value = false;
    try {
      reports.value = await listReports(transport);
      loaded.value = true;
    } catch {
      loadFailed.value = true;
    }
  }

  /**
   * Submit a report, optionally anchored to one of the caller's messages.
   * Returns false on a rejected write (the server hides the reason); the row
   * list only changes on a confirmed append.
   */
  async function submit(
    transport: ReportTransport,
    reason: ReportReason,
    note: string,
    messageId?: string,
  ): Promise<boolean> {
    if (busy.value) return false;
    busy.value = true;
    try {
      const created = await createReport(transport, reason, note, messageId);
      if (!created) return false;
      reports.value = [created, ...reports.value];
      loaded.value = true;
      return true;
    } finally {
      busy.value = false;
    }
  }

  function reset(): void {
    reports.value = [];
    loadFailed.value = false;
    loaded.value = false;
    busy.value = false;
  }

  return {
    reports,
    loadFailed,
    loaded,
    busy,
    submittedCount,
    load,
    submit,
    reset,
  };
});
