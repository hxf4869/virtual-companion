import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";

import type { RelationshipTransport } from "@/api/relationship";

import { useRelationshipStore } from "./relationship";

function transport(status = 200): RelationshipTransport {
  return {
    request: async () => ({
      ok: status === 200,
      status,
      json: status === 200
        ? [
          { relationshipId: "2", personaRef: "old", active: false },
          { relationshipId: "1", personaRef: "gentle-listener", active: true },
        ]
        : null,
    }),
  };
}

describe("useRelationshipStore", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("selects the single active server-created relationship", async () => {
    const store = useRelationshipStore();
    await store.load(transport());
    expect(store.status).toBe("ready");
    expect(store.currentRelationshipId).toBe("1");
    expect(store.current?.personaRef).toBe("gentle-listener");
  });

  it("does not turn a failed read into an empty ready state", async () => {
    const store = useRelationshipStore();
    await store.load(transport(503));
    expect(store.status).toBe("error");
    expect(store.relationships).toEqual([]);
    expect(store.current).toBeNull();
  });

  it("clears account-scoped relationship state on logout", async () => {
    const store = useRelationshipStore();
    await store.load(transport());
    store.reset();
    expect(store.status).toBe("idle");
    expect(store.relationships).toEqual([]);
    expect(store.currentRelationshipId).toBeNull();
  });
});
