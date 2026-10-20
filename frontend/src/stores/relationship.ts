import { defineStore } from "pinia";
import { computed, ref } from "vue";

import {
  listRelationships,
  type Relationship,
  type RelationshipTransport,
} from "@/api/relationship";

export type RelationshipStatus = "idle" | "loading" | "ready" | "error";

export const useRelationshipStore = defineStore("h5-relationship", () => {
  const relationships = ref<Relationship[]>([]);
  const currentRelationshipId = ref<string | null>(null);
  const status = ref<RelationshipStatus>("idle");
  const error = ref<string | null>(null);
  // VC-R09：账号所有权纪元（store 私有，不对外导出）。reset（退出/401/换号
  // 清理）时递增；load 发起时捕获当时的纪元，响应写入前校验仍匹配，
  // 旧账号的晚到响应（成功或失败）静默丢弃，不会写进下一个账号的状态。
  let loadEpoch = 0;

  const current = computed<Relationship | null>(() => (
    relationships.value.find((row) => row.relationshipId === currentRelationshipId.value) ?? null
  ));

  async function load(transport: RelationshipTransport): Promise<void> {
    const requestEpoch = loadEpoch;
    status.value = "loading";
    error.value = null;
    try {
      const rows = await listRelationships(transport);
      if (requestEpoch !== loadEpoch) return;
      relationships.value = rows;
      const active = rows.find((row) => row.active);
      currentRelationshipId.value = active?.relationshipId ?? null;
      status.value = "ready";
    } catch (caught) {
      if (requestEpoch !== loadEpoch) return;
      relationships.value = [];
      currentRelationshipId.value = null;
      status.value = "error";
      error.value = caught instanceof Error ? caught.message : "relationship load failed";
    }
  }

  function reset(): void {
    loadEpoch += 1;
    relationships.value = [];
    currentRelationshipId.value = null;
    status.value = "idle";
    error.value = null;
  }

  return {
    relationships,
    currentRelationshipId,
    status,
    error,
    current,
    load,
    reset,
  };
});
