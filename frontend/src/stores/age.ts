// AGE-UI (FR-AUTH-002): Pinia store for the adult-verification page. State
// only changes on a confirmed API result; a local click never fakes ADULT_VERIFIED.

import { defineStore } from "pinia";
import { computed, ref } from "vue";

import {
  canRunSimulatedVerification,
  canSubmitAgeAppeal,
  getAgeState,
  isVerificationBlocked,
  listAgeAppeals,
  submitAgeAppeal,
  verifyAge,
  type AgeAppeal,
  type AgeState,
  type AgeStateRecord,
  type AgeTransport,
} from "@/api/age";

export const AGE_STATE_LABELS: Record<AgeState, string> = {
  AGE_UNKNOWN: "尚未核验",
  ADULT_SELF_DECLARED: "已自述成年，待核验",
  ADULT_VERIFICATION_REQUIRED: "需要完成成年核验",
  ADULT_VERIFIED: "已完成成年核验",
  MINOR_SUSPECTED: "疑似未成年",
  MINOR_VERIFIED: "已确认为未成年",
  AGE_APPEAL_PENDING: "申诉处理中",
  AGE_REVERIFY_REQUIRED: "需要重新核验",
  AGE_ACCESS_SUSPENDED: "访问已暂停",
};

export const useAgeStore = defineStore("h5-age", () => {
  const record = ref<AgeStateRecord>({
    ageState: "AGE_UNKNOWN",
    providerRef: null,
    verifiedAt: null,
  });
  const loadFailed = ref(false);
  const busy = ref(false);

  const ageState = computed(() => record.value.ageState);
  const canVerify = computed(() => canRunSimulatedVerification(record.value.ageState));
  const blocked = computed(() => isVerificationBlocked(record.value.ageState));
  const label = computed(() => AGE_STATE_LABELS[record.value.ageState]);
  const canAppeal = computed(() => canSubmitAgeAppeal(record.value.ageState));

  const appeals = ref<AgeAppeal[]>([]);
  const appealsLoaded = ref(false);

  async function load(transport: AgeTransport): Promise<void> {
    loadFailed.value = false;
    try {
      record.value = await getAgeState(transport);
    } catch {
      loadFailed.value = true;
    }
  }

  async function loadAppeals(transport: AgeTransport): Promise<void> {
    try {
      appeals.value = await listAgeAppeals(transport);
      appealsLoaded.value = true;
    } catch {
      // The appeal list is supplementary; a failed read keeps the previous
      // rows instead of faking an empty history.
    }
  }

  /**
   * AGE-APPEAL: submit an appeal from a catalog-appealable state. Returns
   * false on a local guard rejection; the caller maps thrown 400s to the
   * fail-closed wording (the state never changes on a rejected write).
   */
  async function submitAppeal(transport: AgeTransport, reason: string): Promise<boolean> {
    if (busy.value || !canAppeal.value) return false;
    busy.value = true;
    try {
      const appeal = await submitAgeAppeal(transport, reason);
      appeals.value = [appeal, ...appeals.value];
      record.value = {
        ...record.value,
        ageState: "AGE_APPEAL_PENDING",
      };
      return true;
    } finally {
      busy.value = false;
    }
  }

  function reset(): void {
    record.value = { ageState: "AGE_UNKNOWN", providerRef: null, verifiedAt: null };
    loadFailed.value = false;
    busy.value = false;
    appeals.value = [];
    appealsLoaded.value = false;
  }

  async function runVerification(transport: AgeTransport): Promise<boolean> {
    if (busy.value || !canVerify.value) return false;
    busy.value = true;
    try {
      record.value = await verifyAge(transport);
      return true;
    } finally {
      busy.value = false;
    }
  }

  return {
    record,
    loadFailed,
    busy,
    ageState,
    canVerify,
    blocked,
    label,
    canAppeal,
    appeals,
    appealsLoaded,
    load,
    loadAppeals,
    submitAppeal,
    runVerification,
    reset,
  };
});
