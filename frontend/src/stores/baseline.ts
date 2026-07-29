import { computed, ref } from "vue";
import { defineStore } from "pinia";

import {
  BaselineRequestError,
  fetchBaseline,
  type BaselineFailureKind,
  type BaselinePayload,
} from "@/api/baseline";
import { mapCapabilityGates } from "@/domain/capability-gates";

export type BaselineLoadState = "idle" | "loading" | "ready" | "error";

const UNKNOWN_RESPONSE_MESSAGE =
  "Runtime 响应未通过边界校验。请检查 Catalog 快照、阶段、传输方式与七项门禁后重试。";

export const useBaselineStore = defineStore("development-baseline", () => {
  const state = ref<BaselineLoadState>("idle");
  const baseline = ref<BaselinePayload | null>(null);
  const errorKind = ref<BaselineFailureKind | null>(null);
  const errorMessage = ref("");
  let requestSequence = 0;

  const baselineText = computed(() =>
    baseline.value === null ? "" : JSON.stringify(baseline.value, null, 2),
  );

  const capabilityGates = computed(() =>
    mapCapabilityGates(
      state.value === "ready" ? baseline.value?.capabilities ?? null : null,
    ),
  );

  const verifiedGateCount = computed(
    () =>
      capabilityGates.value.filter((gate) => gate.state === "closed").length,
  );

  async function load(): Promise<void> {
    const requestId = ++requestSequence;

    state.value = "loading";
    baseline.value = null;
    errorKind.value = null;
    errorMessage.value = "";

    try {
      const payload = await fetchBaseline();

      if (requestId !== requestSequence) {
        return;
      }

      baseline.value = payload;
      state.value = "ready";
    } catch (error) {
      if (requestId !== requestSequence) {
        return;
      }

      state.value = "error";

      if (error instanceof BaselineRequestError) {
        errorKind.value = error.kind;
        errorMessage.value = error.message;
        return;
      }

      errorKind.value = "invalid-response";
      errorMessage.value = UNKNOWN_RESPONSE_MESSAGE;
    }
  }

  return {
    state,
    baseline,
    baselineText,
    capabilityGates,
    verifiedGateCount,
    errorKind,
    errorMessage,
    load,
  };
});
