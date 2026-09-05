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

  const current = computed<Relationship | null>(() => (
    relationships.value.find((row) => row.relationshipId === currentRelationshipId.value) ?? null
  ));

  async function load(transport: RelationshipTransport): Promise<void> {
    status.value = "loading";
    error.value = null;
    try {
      relationships.value = await listRelationships(transport);
      const active = relationships.value.find((row) => row.active);
      currentRelationshipId.value = active?.relationshipId ?? null;
      status.value = "ready";
    } catch (caught) {
      relationships.value = [];
      currentRelationshipId.value = null;
      status.value = "error";
      error.value = caught instanceof Error ? caught.message : "relationship load failed";
    }
  }

  function reset(): void {
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
