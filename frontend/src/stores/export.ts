// DATA-EXPORT (FR-DATA-002): Pinia store for the export page. Enqueues the
// asynchronous export, refreshes the status and performs the one-time
// download through the typed client; state only changes on a confirmed API
// result (no faked requests or downloads).

import { defineStore } from "pinia";
import { ref } from "vue";

import {
  createExport,
  downloadExport,
  getExport,
  type ExportDownload,
  type ExportRequest,
  type ExportTransport,
} from "@/api/export";

export const useExportStore = defineStore("h5-export", () => {
  const request = ref<ExportRequest | null>(null);
  // V76: the one-time download URL is issued ONLY in the create response and
  // must survive status refreshes (which never repeat it).
  const issuedDownloadUrl = ref<string | null>(null);
  const loadFailed = ref(false);
  const busy = ref(false);
  const actionError = ref("");
  const download = ref<ExportDownload | null>(null);
  const downloadFailed = ref(false);

  /**
   * Enqueue a new export (the server rejects a second in-flight one).
   * ADR-0006 §7.7: the caller's re-entered current password travels in the
   * body and the server verifies it fail-closed before enqueueing.
   */
  async function create(transport: ExportTransport, currentPassword: string): Promise<boolean> {
    if (busy.value) return false;
    busy.value = true;
    actionError.value = "";
    downloadFailed.value = false;
    try {
      const created = await createExport(transport, currentPassword);
      if (!created) return false;
      request.value = created;
      issuedDownloadUrl.value = created.downloadUrl ?? null;
      download.value = null;
      return true;
    } catch {
      actionError.value = "发起导出失败：请检查当前密码后重试。";
      return false;
    } finally {
      busy.value = false;
    }
  }

  /** Refresh the status of the current export request. */
  async function refresh(transport: ExportTransport, exportId: string): Promise<boolean> {
    if (busy.value) return false;
    busy.value = true;
    loadFailed.value = false;
    try {
      const current = await getExport(transport, exportId);
      if (!current) return false;
      request.value = current;
      return true;
    } catch {
      loadFailed.value = true;
      return false;
    } finally {
      busy.value = false;
    }
  }

  /** Consume the once-issued downloadUrl and keep the document for display. */
  async function downloadDocument(transport: ExportTransport): Promise<boolean> {
    const downloadUrl = issuedDownloadUrl.value;
    if (!downloadUrl || busy.value) return false;
    busy.value = true;
    downloadFailed.value = false;
    try {
      const document = await downloadExport(transport, downloadUrl);
      if (!document) {
        // The token may already have been consumed by a 200 response whose
        // body did not match the Go export envelope. Surface the failure
        // instead of leaving the page in a silent, unrecoverable state.
        downloadFailed.value = true;
        return false;
      }
      download.value = document;
      issuedDownloadUrl.value = null;
      return true;
    } catch {
      downloadFailed.value = true;
      return false;
    } finally {
      busy.value = false;
    }
  }

  /** Whether a download is still available (READY and the once-issued
   * token not yet consumed). */
  function canDownload(): boolean {
    return request.value?.status === "READY" && !!issuedDownloadUrl.value;
  }

  function reset(): void {
    request.value = null;
    issuedDownloadUrl.value = null;
    loadFailed.value = false;
    busy.value = false;
    actionError.value = "";
    download.value = null;
    downloadFailed.value = false;
  }

  return {
    request,
    loadFailed,
    busy,
    actionError,
    download,
    downloadFailed,
    create,
    refresh,
    downloadDocument,
    canDownload,
    reset,
  };
});
