import { describe, expect, it } from "vitest";
import {
  canRestore,
  clearRestorableGeneration,
  loadRestorableGeneration,
  RESTORE_MAX_AGE_MS,
  type RestorableGeneration,
  type RestorableStorage,
  saveRestorableGeneration,
} from "./generation-restore";

function memoryStorage(): RestorableStorage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  };
}

function entry(overrides?: Partial<RestorableGeneration>): RestorableGeneration {
  return {
    accountId: "acc-1",
    relationshipId: "rel-1",
    conversationId: "conv-1",
    generationId: "gen-1",
    savedAtEpochMs: 1_000_000,
    ...overrides,
  };
}

describe("generation-restore", () => {
  it("round-trips a valid entry", () => {
    const storage = memoryStorage();
    saveRestorableGeneration(storage, entry());
    const loaded = loadRestorableGeneration(storage, 1_000_000 + 1000);
    expect(loaded).toEqual(entry());
  });

  it("tolerates absent storage and returns null", () => {
    expect(loadRestorableGeneration(null)).toBeNull();
    expect(() => saveRestorableGeneration(null, entry())).not.toThrow();
    expect(() => clearRestorableGeneration(null)).not.toThrow();
  });

  it("rejects malformed JSON by clearing the entry", () => {
    const storage = memoryStorage();
    storage.setItem("vc.gen.restore", "{not-json");
    expect(loadRestorableGeneration(storage)).toBeNull();
    expect(storage.getItem("vc.gen.restore")).toBeNull();
  });

  it("rejects structurally tampered entries", () => {
    const storage = memoryStorage();
    storage.setItem(
      "vc.gen.restore",
      JSON.stringify({ accountId: 7, generationId: "gen-1" }),
    );
    expect(loadRestorableGeneration(storage)).toBeNull();
  });

  it("expires entries older than the max age", () => {
    const storage = memoryStorage();
    saveRestorableGeneration(storage, entry());
    expect(
      loadRestorableGeneration(storage, 1_000_000 + RESTORE_MAX_AGE_MS + 1),
    ).toBeNull();
    // Clock skew backwards is treated as expired too.
    expect(loadRestorableGeneration(storage, 999_999)).toBeNull();
  });

  it("never persists a partially bound entry", () => {
    const storage = memoryStorage();
    saveRestorableGeneration(storage, { ...entry(), accountId: "" });
    expect(storage.getItem("vc.gen.restore")).toBeNull();
  });

  it("clears on demand", () => {
    const storage = memoryStorage();
    saveRestorableGeneration(storage, entry());
    clearRestorableGeneration(storage);
    expect(loadRestorableGeneration(storage)).toBeNull();
  });

  it("restores only for the matching account/relationship/conversation", () => {
    const stored = entry();
    expect(
      canRestore(stored, {
        accountId: "acc-1",
        relationshipId: "rel-1",
        conversationId: "conv-1",
      }),
    ).toBe(true);
    expect(
      canRestore(stored, {
        accountId: "acc-OTHER",
        relationshipId: "rel-1",
        conversationId: "conv-1",
      }),
    ).toBe(false);
    expect(
      canRestore(stored, {
        accountId: "acc-1",
        relationshipId: "rel-OTHER",
        conversationId: "conv-1",
      }),
    ).toBe(false);
    expect(
      canRestore(stored, {
        accountId: "acc-1",
        relationshipId: "rel-1",
        conversationId: "conv-OTHER",
      }),
    ).toBe(false);
    expect(
      canRestore({ ...stored, accountId: "" }, {
        accountId: "",
        relationshipId: "rel-1",
        conversationId: "conv-1",
      }),
    ).toBe(false);
  });
});
