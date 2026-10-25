import { computed, ref } from "vue";

import {
  listRelationships,
  prefsOfRelationship,
  updateRelationshipPrefs,
  RelationshipHttpError,
  type CompanionPrefs,
  type Relationship,
  type RelationshipTransport,
} from "@/api/relationship";

export type PrefsLoadState = "loading" | "ready" | "error";
export type PrefsSaveState = "idle" | "saving" | "saved" | "error" | "unknown";

/**
 * 陪伴偏好表单的最小状态机：加载 active 关系偏好为基线，编辑产生草稿，
 * 保存以服务端回读结果更新基线（不用本地草稿冒充已生效）。
 * 保存期间允许继续编辑草稿：在途请求以提交快照标识，响应只更新基线，
 * 草稿仅在用户保存期间未再编辑时才被归一化基线替换。
 * 保存结果未知后的重新读取同理：草稿已偏离该次提交快照时只更新基线、保留草稿。
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
  // VC-R189：最近一次结果未知保存的提交快照。重新读取以它识别"保存请求发出后
  // 又新增的编辑"：有新增编辑时权威值只更新基线、整份保留草稿；读取成功收束
  // 后清除，读取失败保留以便重试。
  let unknownSaveSnapshot: CompanionPrefs | null = null;
  // VC-R13：页面私有读取代次。只在「发起新读取」与「换号清理（reset）」时
  // 递增，作废旧账号的在途读取；同账号的重认证不经过 reset，在途读取
  // 照常落地收尾（不用 auth 会话代次：它每次认证都变，会误杀同账号恢复）。
  let loadSeq = 0;

  const dirty = computed(() => {
    if (!baseline.value || !draft.value) return false;
    return !prefsEqual(baseline.value, draft.value);
  });

  async function load(transport: RelationshipTransport): Promise<void> {
    // VC-R13：进入即捕获读取代次；await 之后的全部状态写入以其门控——
    // 换号清理或更新的读取已接管时静默丢弃，不回填旧账号内容。
    const seq = ++loadSeq;
    loadState.value = "loading";
    // VC-R189：入口判定——结果未知的保存之后，草稿若已不等于该次提交快照，
    // 说明用户在保存请求发出后继续编辑；权威读取只更新基线、保留草稿，
    // 无后续编辑则照旧替换为服务端值。
    const keepDraft = saveState.value === "unknown"
      && unknownSaveSnapshot !== null
      && draft.value !== null
      && !prefsEqual(unknownSaveSnapshot, draft.value);
    try {
      const list = await listRelationships(transport);
      if (seq !== loadSeq) return;
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
      if (!keepDraft) draft.value = prefs;
      unknownSaveSnapshot = null;
      saveState.value = "idle";
      loadState.value = "ready";
    } catch {
      if (seq !== loadSeq) return;
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
    const snapshot = draft.value;
    saveInFlight = { id, snapshot };
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
      // VC-R13：换号清理已作废本次保存（saveSeq 被推进）时静默丢弃，
      // 不写新账号的基线/草稿/保存状态。
      if (id !== saveSeq) return;
      const saved = prefsOfRelationship(updated);
      if (!saved) {
        // 服务端已提交但回读体不完整：与不可解析同属"结果未知"。
        unknownSaveSnapshot = snapshot;
        saveState.value = "unknown";
        return;
      }
      // 响应只更新已确认基线；草稿保持用户最新编辑，
      // 仅当保存期间未再编辑时才用归一化基线替换草稿（现有行为保留）。
      baseline.value = saved;
      if (prefsEqual(snapshot, draft.value)) {
        draft.value = saved;
      }
      saveState.value = "saved";
    } catch (caught) {
      if (id !== saveSeq) return;
      // 失败/结果未知：草稿保留，可重试。
      // VC-R223：仅 4xx（client/unauthorized）是服务端提交前的明确拒绝，
      // 可断言"没有保存成功"。其余失败一律结果未知：超时、原生网络失败、
      // 协议错误，以及 5xx——经代理部署时 5xx 可能是提交后回包丢失被代理
      // 合成，浏览器无法从同一 status 区分其来源，服务端都可能已提交，
      // 不得断言未保存，统一走 unknownSaveSnapshot + 重新读取收束。
      const definiteRejection = caught instanceof RelationshipHttpError
        && (caught.kind === "client" || caught.kind === "unauthorized");
      if (definiteRejection) {
        saveState.value = "error";
      } else {
        unknownSaveSnapshot = snapshot;
        saveState.value = "unknown";
      }
    } finally {
      // 只有仍持有本次保存才释放保存位；换号清理已把保存位让给新账号
      // （置空或新保存），迟到收尾不得动它。
      if (saveInFlight?.id === id) saveInFlight = null;
    }
  }

  /**
   * VC-R13：换号身份交接的本地重置（「已知账号 → 不同账号/退出」时由页面
   * 调用）。清空旧账号私有内容（关系/基线/草稿/状态机）并回到加载态；
   * 同时作废在途读取与保存（各自代次递增、保存位释放）：迟到的成功/失败/
   * 收尾按代次静默丢弃，不写新账号状态，也不占住新账号的保存。
   * 只清本地，不发起新请求。
   */
  function reset(): void {
    loadSeq++;
    saveSeq++;
    saveInFlight = null;
    unknownSaveSnapshot = null;
    relationship.value = null;
    baseline.value = null;
    draft.value = null;
    loadState.value = "loading";
    saveState.value = "idle";
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
    reset,
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
