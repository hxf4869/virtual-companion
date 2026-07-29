import { computed, ref } from "vue";
import { defineStore } from "pinia";

import {
  fetchBaseline,
  type BaselinePayload,
} from "@/api/baseline";

export type BaselineLoadState = "idle" | "loading" | "ready" | "error";

export const useBaselineStore = defineStore("development-baseline", () => {
  const state = ref<BaselineLoadState>("idle");
  const baseline = ref<BaselinePayload | null>(null);
  const errorMessage = ref("");

  const baselineText = computed(() =>
    baseline.value === null ? "" : JSON.stringify(baseline.value, null, 2),
  );

  async function load(): Promise<void> {
    state.value = "loading";
    baseline.value = null;
    errorMessage.value = "";

    try {
      baseline.value = await fetchBaseline();
      state.value = "ready";
    } catch (error) {
      state.value = "error";
      errorMessage.value =
        error instanceof Error
          ? error.message
          : "无法访问本地后端，开发基线读取失败。";
    }
  }

  return {
    state,
    baseline,
    baselineText,
    errorMessage,
    load,
  };
});
