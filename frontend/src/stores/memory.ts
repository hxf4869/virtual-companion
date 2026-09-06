import { defineStore } from "pinia";
import { computed, ref } from "vue";

import {
  getMemoryAutoSavePref,
  listMemories,
  updateMemoryAutoSavePref,
  MemoryHttpError,
  MemoryProtocolError,
  type MemoryItem,
  type MemoryTransport,
} from "@/api/memory";
import { TransportTimeoutError } from "@/api/transport";

export type MemoryListStatus = "idle" | "loading" | "ready" | "error";
export type AutoSaveState = "idle" | "loading" | "ready" | "saving" | "error" | "unknown";

/**
 * 与 chat 层同一原则：PUT 是写请求，服务端 5xx、协议错误或超时都意味着
 * "请求可能已生效但未确认"，呈现"结果未知"而不是确定失败；
 * 4xx（含 401/403/409）是服务端明确拒绝，为确定失败。
 */
function isUnknownAutoSaveOutcome(caught: unknown): boolean {
  if (caught instanceof MemoryHttpError) return caught.kind === "server";
  return caught instanceof MemoryProtocolError || caught instanceof TransportTimeoutError;
}

/**
 * 记忆管理页的列表与自动记忆开关状态机（跟随 relationship store 范式）。
 * 列表加载失败时保留已加载条目，页面据此展示"保留旧内容 + 重试"。
 */
export const useMemoryStore = defineStore("h5-memory", () => {
  const items = ref<MemoryItem[]>([]);
  const listStatus = ref<MemoryListStatus>("idle");
  const autoSaveEnabled = ref(false);
  const autoSaveState = ref<AutoSaveState>("idle");
  /**
   * 账号所有权纪元：reset（退出/401/换号清理）时递增。异步读写发起时捕获
   * 当时的 epoch，响应写入前校验仍匹配，旧账号的晚到响应静默丢弃，
   * 不会写进下一个账号的状态。页面级编辑/删除写入（replaceItem/removeItem）
   * 由调用方在 await 前后用同一 ref 校验。
   */
  const ownerEpoch = ref(0);

  /** 主视图：已保存（ACCEPTED）且未被更新版本替代的记忆。 */
  const acceptedItems = computed(() =>
    items.value.filter(
      (item) => item.status === "ACCEPTED" && !item.supersededAt,
    ),
  );

  /** 次级分区：待确认候选；已拒绝条目不进入任何视图。 */
  const pendingItems = computed(() =>
    items.value.filter((item) => item.status === "PENDING_CONFIRMATION"),
  );

  async function load(transport: MemoryTransport, relationshipId: string): Promise<void> {
    const requestEpoch = ownerEpoch.value;
    listStatus.value = "loading";
    try {
      const fetched = await listMemories(transport, relationshipId);
      if (requestEpoch !== ownerEpoch.value) return;
      items.value = fetched;
      listStatus.value = "ready";
    } catch {
      // 失败不清空：保留已加载内容，页面给出重试。
      if (requestEpoch !== ownerEpoch.value) return;
      listStatus.value = "error";
    }
  }

  async function loadAutoSave(transport: MemoryTransport): Promise<void> {
    const requestEpoch = ownerEpoch.value;
    autoSaveState.value = "loading";
    try {
      const enabled = await getMemoryAutoSavePref(transport);
      if (requestEpoch !== ownerEpoch.value) return;
      autoSaveEnabled.value = enabled;
      autoSaveState.value = "ready";
    } catch {
      if (requestEpoch !== ownerEpoch.value) return;
      autoSaveState.value = "error";
    }
  }

  async function setAutoSave(transport: MemoryTransport, enabled: boolean): Promise<void> {
    const requestEpoch = ownerEpoch.value;
    autoSaveState.value = "saving";
    try {
      const confirmed = await updateMemoryAutoSavePref(transport, enabled);
      if (requestEpoch !== ownerEpoch.value) return;
      autoSaveEnabled.value = confirmed;
      autoSaveState.value = "ready";
    } catch (caught) {
      if (requestEpoch !== ownerEpoch.value) return;
      autoSaveState.value = isUnknownAutoSaveOutcome(caught) ? "unknown" : "error";
    }
  }

  function replaceItem(updated: MemoryItem): void {
    items.value = items.value.map((item) =>
      item.memoryId === updated.memoryId ? updated : item,
    );
  }

  function removeItem(memoryId: string): void {
    items.value = items.value.filter((item) => item.memoryId !== memoryId);
  }

  function reset(): void {
    ownerEpoch.value += 1;
    items.value = [];
    listStatus.value = "idle";
    autoSaveEnabled.value = false;
    autoSaveState.value = "idle";
  }

  return {
    items,
    listStatus,
    autoSaveEnabled,
    autoSaveState,
    ownerEpoch,
    acceptedItems,
    pendingItems,
    load,
    loadAutoSave,
    setAutoSave,
    replaceItem,
    removeItem,
    reset,
  };
});
