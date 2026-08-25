// CONSENT (FR-AUTH-003): Pinia store for the consent page. Loads the effective
// state per type and grants/revokes through the typed client; state only
// changes on a confirmed API result (no faked grants).

import { defineStore } from "pinia";
import { ref } from "vue";

import {
  listConsents,
  recordConsent,
  type ConsentRecord,
  type ConsentTransport,
  type ConsentType,
} from "@/api/consent";

/** FR-AUTH-003 consent catalogue with plain labels for the page. */
export const CONSENT_OPTIONS: ReadonlyArray<{ type: ConsentType; label: string; note: string }> = [
  { type: "SERVICE_TERMS", label: "用户服务协议", note: "服务条款" },
  { type: "PRIVACY_POLICY", label: "隐私政策", note: "数据处理范围" },
  { type: "AI_CONTENT_NOTICE", label: "AI 生成内容说明", note: "AI 身份透明" },
  { type: "THIRD_PARTY_MODEL_PROCESSING", label: "第三方模型数据处理", note: "外发供应商范围" },
  { type: "SENSITIVE_DATA_PROCESSING", label: "敏感个人信息处理", note: "单独同意" },
  { type: "EMERGENCY_CONTACT", label: "紧急联系人处理", note: "单独同意" },
  { type: "MODEL_TRAINING", label: "模型训练/产品改进", note: "撤回不影响基本聊天" },
  { type: "PUSH_NOTIFICATION", label: "消息推送", note: "Alpha 阶段不推送" },
];

export const useConsentStore = defineStore("h5-consent", () => {
  const records = ref<ConsentRecord[]>([]);
  const loadFailed = ref(false);
  const busy = ref(false);
  const lastAction = ref<{ type: ConsentType; granted: boolean } | null>(null);

  /** Load the effective state (non-fatal failure keeps rows). */
  async function load(transport: ConsentTransport): Promise<void> {
    loadFailed.value = false;
    try {
      records.value = await listConsents(transport);
    } catch {
      loadFailed.value = true;
    }
  }

  /**
   * Grant or revoke one consent type at the version the user saw. The
   * confirmed record replaces the effective row for its type. ADR-0006 §7.7:
   * a revocation (granted=false) must pass the caller's re-entered current
   * password (verified fail-closed server-side); grants stay passwordless.
   */
  async function setConsent(
    transport: ConsentTransport,
    consentType: ConsentType,
    version: string,
    granted: boolean,
    currentPassword?: string,
  ): Promise<boolean> {
    if (busy.value) return false;
    busy.value = true;
    try {
      const recorded = await recordConsent(
        transport, consentType, version, granted, currentPassword,
      );
      if (!recorded) return false;
      records.value = [
        ...records.value.filter((r) => r.consentType !== consentType),
        recorded,
      ];
      lastAction.value = { type: consentType, granted };
      return true;
    } finally {
      busy.value = false;
    }
  }

  /** Effective granted state for one type (undefined = never recorded). */
  function grantedFor(type: ConsentType): boolean | undefined {
    return records.value.find((r) => r.consentType === type)?.granted;
  }

  function reset(): void {
    records.value = [];
    loadFailed.value = false;
    busy.value = false;
    lastAction.value = null;
  }

  return {
    records,
    loadFailed,
    busy,
    lastAction,
    load,
    setConsent,
    grantedFor,
    reset,
  };
});
