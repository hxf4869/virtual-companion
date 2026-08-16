// TASK-0030: Pinia memory store binding the memory API client to the H5 UI.
//
// The store keeps pending candidates (status=PENDING_CONFIRMATION) strictly
// separate from canonical memory (status=ACCEPTED): an unconfirmed candidate is
// never presented as a saved fact (forbidden). Transport deps are injected at
// call time so the spec can mock request() exactly like stores/chat.spec.ts.
//
// Failure semantics: a confirmed success (truthy API result) is the ONLY thing
// that mutates the canonical set or removes a memory. A non-confirmed result
// (null/false) or a thrown transport preserves the current state and records an
// error -- the store never fakes success (forbidden). Sources, status and delete
// results come only from the API response.
//
// TASK-0105 (P2-16): a typed MemoryHttpError from the api layer maps 401 to the
// new "session-expired" code (the page's authenticated transport routes the
// 401 to the auth store for session handling); 5xx/other typed failures map to
// the per-operation failed codes instead of an empty-success look. P3-03:
// update() returns a boolean so the page exits edit mode only on confirmed
// success; loadEvidence clears any stale error on a successful load.

import { defineStore } from "pinia";
import { computed, ref } from "vue";

import {
  confirmMemory,
  createMemoryCandidate,
  deleteMemory,
  listMemories,
  listMemoryEvidence,
  MemoryHttpError,
  rejectMemory,
  updateMemory,
  type Memory,
  type MemoryEvidence,
  type MemoryTransport,
} from "@/api/memory";

export type MemoryErrorCode =
  | "load-failed"
  | "session-expired"
  | "create-not-confirmed"
  | "create-failed"
  | "confirm-not-confirmed"
  | "confirm-failed"
  | "reject-not-confirmed"
  | "reject-failed"
  | "update-not-confirmed"
  | "update-failed"
  | "delete-not-confirmed"
  | "delete-failed"
  | "evidence-failed";

/** Map a caught api-layer failure to a store error code. */
function failureCode(error: unknown, fallback: MemoryErrorCode): MemoryErrorCode {
  if (error instanceof MemoryHttpError && error.kind === "unauthorized") {
    return "session-expired";
  }
  return fallback;
}

export const useMemoryStore = defineStore("h5-memory", () => {
  const pending = ref<Memory[]>([]);
  const canonical = ref<Memory[]>([]);
  const evidence = ref<Record<string, MemoryEvidence[]>>({});
  const error = ref<MemoryErrorCode | null>(null);

  /** Unconfirmed candidates are never part of the canonical set. */
  const pendingCount = computed(() => pending.value.length);
  const canonicalCount = computed(() => canonical.value.length);

  function without(list: Memory[], memoryId: string): Memory[] {
    return list.filter((m) => m.memoryId !== memoryId);
  }

  function replaceIn(list: Memory[], memory: Memory): Memory[] {
    let found = false;
    const next = list.map((m) => {
      if (m.memoryId === memory.memoryId) {
        found = true;
        return memory;
      }
      return m;
    });
    return found ? next : list;
  }

  /** Load and partition by status. Pending and canonical never mix. */
  async function load(t: MemoryTransport, relationshipId: string): Promise<void> {
    error.value = null;
    let list: Memory[];
    try {
      list = await listMemories(t, relationshipId);
    } catch (e) {
      error.value = failureCode(e, "load-failed");
      return;
    }
    pending.value = list.filter((m) => m.status === "PENDING_CONFIRMATION");
    canonical.value = list.filter((m) => m.status === "ACCEPTED");
  }

  /**
   * MEM-MANUAL: create a RELATIONSHIP-scoped candidate from the user's manual
   * entry. The new candidate joins the pending list ONLY on a confirmed
   * PENDING_CONFIRMATION result; anything else surfaces a typed error and
   * never fakes a save.
   */
  async function create(t: MemoryTransport, relationshipId: string, summary: string): Promise<void> {
    error.value = null;
    let created: Memory | null;
    try {
      created = await createMemoryCandidate(t, relationshipId, summary);
    } catch (e) {
      error.value = failureCode(e, "create-failed");
      return;
    }
    if (!created || created.status !== "PENDING_CONFIRMATION") {
      error.value = "create-not-confirmed";
      return;
    }
    pending.value = [created, ...pending.value];
  }

  /** Confirm: a pending candidate moves to canonical ONLY on confirmed success. */
  async function confirm(t: MemoryTransport, memoryId: string): Promise<void> {
    error.value = null;
    let confirmed: Memory | null;
    try {
      confirmed = await confirmMemory(t, memoryId);
    } catch (e) {
      error.value = failureCode(e, "confirm-failed");
      return;
    }
    if (!confirmed || confirmed.status !== "ACCEPTED") {
      // Not confirmed -> preserve state, do not fake a confirmation.
      error.value = "confirm-not-confirmed";
      return;
    }
    pending.value = without(pending.value, memoryId);
    canonical.value = [...canonical.value, confirmed];
  }

  /** Reject: a pending candidate is dropped ONLY on confirmed success. */
  async function reject(t: MemoryTransport, memoryId: string): Promise<void> {
    error.value = null;
    let rejected: Memory | null;
    try {
      rejected = await rejectMemory(t, memoryId);
    } catch (e) {
      error.value = failureCode(e, "reject-failed");
      return;
    }
    if (!rejected) {
      error.value = "reject-not-confirmed";
      return;
    }
    pending.value = without(pending.value, memoryId);
  }

  /**
   * Edit: the visible summary changes ONLY on confirmed success. Returns true
   * only then, so the page keeps the edit row open on any failure.
   */
  async function update(
    t: MemoryTransport,
    memoryId: string,
    summary: string,
  ): Promise<boolean> {
    error.value = null;
    let updated: Memory | null;
    try {
      updated = await updateMemory(t, memoryId, summary);
    } catch (e) {
      error.value = failureCode(e, "update-failed");
      return false;
    }
    if (!updated) {
      error.value = "update-not-confirmed";
      return false;
    }
    canonical.value = replaceIn(canonical.value, updated);
    pending.value = replaceIn(pending.value, updated);
    return true;
  }

  /** Delete: a memory is removed ONLY on a confirmed delete; never faked. */
  async function remove(t: MemoryTransport, memoryId: string): Promise<void> {
    error.value = null;
    let ok: boolean;
    try {
      ok = await deleteMemory(t, memoryId);
    } catch (e) {
      error.value = failureCode(e, "delete-failed");
      return;
    }
    if (!ok) {
      // Delete not confirmed -> preserve the memory, surface an error. The UI
      // must not pretend the memory was deleted.
      error.value = "delete-not-confirmed";
      return;
    }
    pending.value = without(pending.value, memoryId);
    canonical.value = without(canonical.value, memoryId);
    const nextEvidence = { ...evidence.value };
    delete nextEvidence[memoryId];
    evidence.value = nextEvidence;
  }

  /** Load sources; a successful load clears any stale error (P3-03). */
  async function loadEvidence(t: MemoryTransport, memoryId: string): Promise<void> {
    error.value = null;
    try {
      const sources = await listMemoryEvidence(t, memoryId);
      evidence.value = { ...evidence.value, [memoryId]: sources };
    } catch (e) {
      error.value = failureCode(e, "evidence-failed");
    }
  }

  function reset(): void {
    pending.value = [];
    canonical.value = [];
    evidence.value = {};
    error.value = null;
  }

  return {
    pending,
    canonical,
    evidence,
    error,
    pendingCount,
    canonicalCount,
    load,
    create,
    confirm,
    reject,
    update,
    remove,
    loadEvidence,
    reset,
  };
});
