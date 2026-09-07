import { defineStore } from "pinia";
import { computed, ref } from "vue";

import {
  classifyMemoryWriteError,
  getMemoryAutoSavePref,
  listMemoriesChecked,
  updateMemoryAutoSavePref,
  type MemoryItem,
  type MemoryTransport,
} from "@/api/memory";

export type MemoryListStatus = "idle" | "loading" | "ready" | "error";
export type AutoSaveState = "idle" | "loading" | "ready" | "saving" | "error" | "unknown";

/**
 * 列表读取结果：
 * - ok：读到权威数据（含真实的空列表）；
 * - failed：读取失败（保留旧数据）；
 * - inconclusive：响应不能作为判断依据（账号切换后晚到、与本地写入交错的
 *   旧快照、或存在性隐藏被适配为空列表）。
 */
export type MemoryListLoadOutcome = "ok" | "failed" | "inconclusive";

/** 自动开关写入结果，页面据此决定是否进入核对流程、是否记录目标值。 */
export type AutoSaveWriteOutcome = "confirmed" | "rejected" | "unknown";

/**
 * 记忆管理页的列表与自动记忆开关状态机（跟随 relationship store 范式）。
 * 列表加载失败时保留已加载条目，页面据此展示"保留旧内容 + 重试"。
 */
export const useMemoryStore = defineStore("h5-memory", () => {
  const items = ref<MemoryItem[]>([]);
  const listStatus = ref<MemoryListStatus>("idle");
  const autoSaveEnabled = ref(false);
  const autoSaveState = ref<AutoSaveState>("idle");
  /** 服务端开关值是否已被读取/回显确认；false 时不得按默认 false 展示确定状态。 */
  const autoSaveValueKnown = ref(false);
  /**
   * 账号所有权纪元：reset（退出/401/换号清理）时递增。异步读写发起时捕获
   * 当时的 epoch，响应写入前校验仍匹配，旧账号的晚到响应静默丢弃，
   * 不会写进下一个账号的状态。页面级编辑/删除写入（replaceItem/removeItem）
   * 由调用方在 await 前后用同一 ref 校验。
   */
  const ownerEpoch = ref(0);
  /**
   * 本地写版本号：replaceItem/removeItem 每次递增。列表响应写回前校验版本
   * 未变，避免同账号下先发起的列表请求（旧快照）晚到覆盖已完成的本地写入。
   */
  const dataVersion = ref(0);

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

  async function load(
    transport: MemoryTransport,
    relationshipId: string,
  ): Promise<MemoryListLoadOutcome> {
    const requestEpoch = ownerEpoch.value;
    const versionAtStart = dataVersion.value;
    listStatus.value = "loading";
    try {
      const result = await listMemoriesChecked(transport, relationshipId);
      if (requestEpoch !== ownerEpoch.value) return "inconclusive";
      if (dataVersion.value !== versionAtStart) {
        // 响应在途期间发生了本地写入：该响应可能反映旧快照，不覆盖新写入。
        listStatus.value = "ready";
        return "inconclusive";
      }
      if (result.existenceHidden) {
        // 存在性隐藏（403/404）被适配为空列表：空值不证明列表真的为空，
        // 也不证明未确认的写操作已生效。保留旧数据与核对入口。
        listStatus.value = "ready";
        return "inconclusive";
      }
      items.value = result.items;
      listStatus.value = "ready";
      return "ok";
    } catch {
      // 失败不清空：保留已加载内容，页面给出重试。
      if (requestEpoch !== ownerEpoch.value) return "inconclusive";
      listStatus.value = "error";
      return "failed";
    }
  }

  async function loadAutoSave(transport: MemoryTransport): Promise<void> {
    const requestEpoch = ownerEpoch.value;
    autoSaveState.value = "loading";
    try {
      const enabled = await getMemoryAutoSavePref(transport);
      if (requestEpoch !== ownerEpoch.value) return;
      autoSaveEnabled.value = enabled;
      autoSaveValueKnown.value = true;
      autoSaveState.value = "ready";
    } catch {
      if (requestEpoch !== ownerEpoch.value) return;
      autoSaveState.value = "error";
    }
  }

  /**
   * 按显式目标值更新开关（页面发 enabled=true/false，不做本地翻转）。
   * 与 chat 层同一原则：写请求的 5xx、协议错误、超时、网络中断都意味着
   * "请求可能已生效但未确认"，呈现"结果未知"而不是确定失败；
   * 4xx（含 401/403/409）是服务端明确拒绝，为确定失败。
   */
  async function setAutoSave(
    transport: MemoryTransport,
    enabled: boolean,
  ): Promise<AutoSaveWriteOutcome> {
    const requestEpoch = ownerEpoch.value;
    autoSaveState.value = "saving";
    try {
      const confirmed = await updateMemoryAutoSavePref(transport, enabled);
      if (requestEpoch !== ownerEpoch.value) return "unknown";
      autoSaveEnabled.value = confirmed;
      autoSaveValueKnown.value = true;
      autoSaveState.value = "ready";
      return "confirmed";
    } catch (caught) {
      if (requestEpoch !== ownerEpoch.value) return "unknown";
      const outcome = classifyMemoryWriteError(caught);
      autoSaveState.value = outcome === "unknown" ? "unknown" : "error";
      return outcome;
    }
  }

  function replaceItem(updated: MemoryItem): void {
    dataVersion.value += 1;
    items.value = items.value.map((item) =>
      item.memoryId === updated.memoryId ? updated : item,
    );
  }

  function removeItem(memoryId: string): void {
    dataVersion.value += 1;
    items.value = items.value.filter((item) => item.memoryId !== memoryId);
  }

  function reset(): void {
    ownerEpoch.value += 1;
    items.value = [];
    listStatus.value = "idle";
    autoSaveEnabled.value = false;
    autoSaveValueKnown.value = false;
    autoSaveState.value = "idle";
  }

  return {
    items,
    listStatus,
    autoSaveEnabled,
    autoSaveValueKnown,
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
