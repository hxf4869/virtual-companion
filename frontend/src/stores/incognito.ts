import { defineStore } from "pinia";
import { computed, ref } from "vue";

import {
  getIncognitoPref,
  updateIncognitoPref,
  type IncognitoTransport,
} from "@/api/incognito";

export const useIncognitoStore = defineStore("h5-incognito-pref", () => {
  const defaultIncognito = ref(false);
  const loadFailed = ref(false);
  const busy = ref(false);

  const label = computed(() => (defaultIncognito.value ? "下次新会话默认无痕" : "下次新会话默认不无痕"));

  async function load(transport: IncognitoTransport): Promise<void> {
    loadFailed.value = false;
    try {
      const pref = await getIncognitoPref(transport);
      defaultIncognito.value = pref.defaultIncognito;
    } catch {
      loadFailed.value = true;
    }
  }

  async function save(transport: IncognitoTransport, next: boolean): Promise<boolean> {
    if (busy.value) return false;
    busy.value = true;
    try {
      const pref = await updateIncognitoPref(transport, next);
      defaultIncognito.value = pref.defaultIncognito;
      return true;
    } finally {
      busy.value = false;
    }
  }

  function reset(): void {
    defaultIncognito.value = false;
    loadFailed.value = false;
    busy.value = false;
  }

  return { defaultIncognito, loadFailed, busy, label, load, save, reset };
});
