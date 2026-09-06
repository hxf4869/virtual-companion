import { computed, ref } from "vue";

import {
  listRelationships,
  prefsOfRelationship,
  updateRelationshipPrefs,
  RelationshipProtocolError,
  type CompanionPrefs,
  type Relationship,
  type RelationshipTransport,
} from "@/api/relationship";
import { TransportTimeoutError } from "@/api/transport";

export type PrefsLoadState = "loading" | "ready" | "error";
export type PrefsSaveState = "idle" | "saving" | "saved" | "error" | "unknown";

/**
 * 陪伴偏好表单的最小状态机：加载 active 关系偏好为基线，编辑产生草稿，
 * 保存以服务端回读结果更新基线（不用本地草稿冒充已生效）。
 * 保存期间允许继续编辑草稿：在途请求以提交快照标识，响应只更新基线，
 * 草稿仅在用户保存期间未再编辑时才被归一化基线替换。
 * 无 active 关系时 load 正常结束但 relationship 为 null（服务端会在
 * 首次聊天时自动创建唯一默认陪伴，本页不提供创建表单）。
 */
export function useCompanionPrefs() {
  const loadState = ref<PrefsLoadState>("loading");
  const saveState = ref<PrefsSaveState>("idle");
  const relationship = ref<Relationship | null>(null);
  const baseline = ref<CompanionPrefs | null>(null);
  const draft = ref<CompanionPrefs | null>(null);
  /** 在途保存请求（请求 id + 提交快照）；非 null 即保存中，禁止重复提交。 */
  let saveInFlight: { id: number; snapshot: CompanionPrefs } | null = null;
  let saveSeq = 0;

  const dirty = computed(() => {
    if (!baseline.value || !draft.value) return false;
    return !prefsEqual(baseline.value, draft.value);
  });

  async function load(transport: RelationshipTransport): Promise<void> {
    loadState.value = "loading";
    try {
      const list = await listRelationships(transport);
      const active = list.find((row) => row.active) ?? null;
      if (!active) {
        relationship.value = null;
        baseline.value = null;
        draft.value = null;
        saveState.value = "idle";
        loadState.value = "ready";
        return;
      }
      const prefs = prefsOfRelationship(active);
      if (!prefs) {
        loadState.value = "error";
        return;
      }
      relationship.value = active;
      baseline.value = prefs;
      draft.value = prefs;
      saveState.value = "idle";
      loadState.value = "ready";
    } catch {
      loadState.value = "error";
    }
  }

  /**
   * 应用一次字段修改：基于当前草稿的浅拷贝；保存中也可继续编辑。
   * 只把"已保存"提示回到默认，不打断在途保存的 saving 状态。
   */
  function edit(mutate: (draft: CompanionPrefs) => void): void {
    if (!draft.value) return;
    const next = { ...draft.value, avoidTopics: [...draft.value.avoidTopics] };
    mutate(next);
    draft.value = next;
    if (saveState.value === "saved") saveState.value = "idle";
  }

  async function save(transport: RelationshipTransport): Promise<void> {
    if (!relationship.value || !draft.value || saveInFlight) return;
    const id = ++saveSeq;
    saveInFlight = { id, snapshot: draft.value };
    saveState.value = "saving";
    // PATCH 是全量替换：remindersAllowed 无 UI 入口，始终回传服务端基线值。
    const payload: CompanionPrefs = baseline.value
      ? { ...draft.value, remindersAllowed: baseline.value.remindersAllowed }
      : draft.value;
    try {
      const updated = await updateRelationshipPrefs(
        transport,
        relationship.value.relationshipId,
        payload,
      );
      const saved = prefsOfRelationship(updated);
      if (!saved) {
        // 服务端已提交但回读体不完整：与不可解析同属"结果未知"。
        saveState.value = "unknown";
        return;
      }
      // 响应只更新已确认基线；草稿保持用户最新编辑，
      // 仅当保存期间未再编辑时才用归一化基线替换草稿（现有行为保留）。
      baseline.value = saved;
      if (prefsEqual(saveInFlight.snapshot, draft.value)) {
        draft.value = saved;
      }
      saveState.value = "saved";
    } catch (caught) {
      // 失败/结果未知：草稿保留，可重试。
      saveState.value =
        caught instanceof RelationshipProtocolError || caught instanceof TransportTimeoutError
          ? "unknown"
          : "error";
    } finally {
      if (saveInFlight?.id === id) saveInFlight = null;
    }
  }

  return {
    loadState,
    saveState,
    relationship,
    draft,
    dirty,
    load,
    edit,
    save,
  };
}

/** 用户可编辑字段的相等比较；remindersAllowed 无 UI 入口，不构成 dirty。 */
function prefsEqual(a: CompanionPrefs, b: CompanionPrefs): boolean {
  return a.companionName === b.companionName
    && a.userAddressAs === b.userAddressAs
    && a.replyLength === b.replyLength
    && a.initiative === b.initiative
    && a.humor === b.humor
    && a.advicePref === b.advicePref
    && a.memoryShareScope === b.memoryShareScope
    && a.gender === b.gender
    && a.avatarRef === b.avatarRef
    && a.avoidTopics.length === b.avoidTopics.length
    && a.avoidTopics.every((topic, index) => topic === b.avoidTopics[index]);
}
