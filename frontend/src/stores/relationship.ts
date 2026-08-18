// TASK-0187: Pinia relationship store binding the relationship API client to
// the H5 selector UI.
//
// The store owns the owner's relationship list, the currently selected
// relationship (the one a conversation is created under), and a load/error
// status the selector renders. Transport is injected at call time so the store
// spec can mock request() exactly like stores/chat.spec.ts. The store never
// fakes success: list/activate/deactivate failures surface as status="error"
// without fabricating a relationship, and existence-hidden (403/404) results
// from the api layer arrive as null / empty rather than throws.
//
// "current" is the frontend selection used to create a conversation; it is
// distinct from (but defaulted to) the server "active" companion. load()
// defaults current to the single active relationship (activeCompanionLimit=1).

import { defineStore } from "pinia";
import { computed, ref } from "vue";

import {
  activateRelationship,
  createRelationship,
  deactivateRelationship,
  deleteRelationship,
  discardMemoryImport,
  importMemories,
  listMemoryImports,
  listRelationships,
  previewRelationshipClearance,
  resetRelationship,
  updateRelationshipPrefs,
  type Relationship,
  type RelationshipClearancePreview,
  type RelationshipPrefsUpdate,
  type RelationshipTransport,
} from "@/api/relationship";

export type RelationshipStatus = "idle" | "loading" | "ready" | "error";

export const useRelationshipStore = defineStore("h5-relationship", () => {
  const relationships = ref<Relationship[]>([]);
  const currentRelationshipId = ref<string | null>(null);
  const status = ref<RelationshipStatus>("idle");
  const error = ref<string | null>(null);

  /** The currently selected relationship, or null when none is selected. */
  const current = computed<Relationship | null>(
    () =>
      relationships.value.find(
        (r) => r.relationshipId === currentRelationshipId.value,
      ) ?? null,
  );

  /**
   * Load the owner's relationships and default the current selection to the
   * single active companion (activeCompanionLimit=1). A failure sets the error
   * status without faking an empty success.
   */
  async function load(t: RelationshipTransport): Promise<void> {
    status.value = "loading";
    error.value = null;
    try {
      relationships.value = await listRelationships(t);
      const active = relationships.value.find((r) => r.active);
      if (active) {
        currentRelationshipId.value = active.relationshipId;
      }
      status.value = "ready";
    } catch (e) {
      status.value = "error";
      error.value = e instanceof Error ? e.message : "relationship load failed";
    }
  }

  /**
   * Create a relationship and select it as current. Returns the new
   * relationship on success, null on existence-hidden failure.
   */
  async function create(
    t: RelationshipTransport,
    personaRef: string,
  ): Promise<Relationship | null> {
    const created = await createRelationship(t, personaRef);
    if (created) {
      await load(t);
      currentRelationshipId.value = created.relationshipId;
    }
    return created;
  }

  /**
   * Activate a relationship server-side and select it as current, then reload
   * the authoritative list. Returns the activated relationship on success, null
   * on existence-hidden failure.
   */
  async function activate(
    t: RelationshipTransport,
    relationshipId: string,
  ): Promise<Relationship | null> {
    const activated = await activateRelationship(t, relationshipId);
    if (activated) {
      await load(t);
      currentRelationshipId.value = activated.relationshipId;
    }
    return activated;
  }

  /**
   * Deactivate a relationship server-side, then reload. If it was the current
   * selection, clear current. Returns the deactivated relationship on success,
   * null on existence-hidden failure.
   */
  async function deactivate(
    t: RelationshipTransport,
    relationshipId: string,
  ): Promise<Relationship | null> {
    const deactivated = await deactivateRelationship(t, relationshipId);
    if (deactivated) {
      await load(t);
      if (currentRelationshipId.value === relationshipId) {
        currentRelationshipId.value = null;
      }
    }
    return deactivated;
  }

  /**
   * COMP-CFG: replace structured preferences, then reload so the list
   * carries the authoritative row.
   */
  async function updatePrefs(
    t: RelationshipTransport,
    relationshipId: string,
    prefs: RelationshipPrefsUpdate,
  ): Promise<Relationship | null> {
    const updated = await updateRelationshipPrefs(t, relationshipId, prefs);
    if (updated) {
      await load(t);
      currentRelationshipId.value = updated.relationshipId;
    }
    return updated;
  }

  /**
   * FR-COMP-004: load the factual clearance scope for one Companion.
   */
  async function previewClearance(
    t: RelationshipTransport,
    relationshipId: string,
  ): Promise<RelationshipClearancePreview | null> {
    return previewRelationshipClearance(t, relationshipId);
  }

  /**
   * FR-COMP-004: reset the relationship domain and keep the Companion row,
   * then reload the authoritative list.
   */
  async function resetCompanion(
    t: RelationshipTransport,
    relationshipId: string,
    options?: { retainImportable?: boolean },
  ): Promise<Relationship | null> {
    const resetRow = await resetRelationship(t, relationshipId, options);
    if (resetRow) {
      await load(t);
      currentRelationshipId.value = resetRow.relationshipId;
    }
    return resetRow;
  }

  /**
   * FR-COMP-004: delete the Companion, then reload. Clears current when the
   * deleted row was selected.
   */
  async function removeCompanion(
    t: RelationshipTransport,
    relationshipId: string,
    options?: { retainImportable?: boolean },
  ): Promise<boolean> {
    const deleted = await deleteRelationship(t, relationshipId, options);
    if (deleted) {
      await load(t);
      if (currentRelationshipId.value === relationshipId) {
        currentRelationshipId.value = null;
      }
    }
    return deleted;
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
    create,
    activate,
    deactivate,
    updatePrefs,
    previewClearance,
    resetCompanion,
    removeCompanion,
    listMemoryImports,
    importMemories,
    discardMemoryImport,
    reset,
  };
});
