// TASK-0187: relationship store unit tests. The transport is mocked and
// injected so every action (load/create/activate/deactivate/reset) is
// exercised in isolation against the api-layer wire shapes.
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useRelationshipStore } from "@/stores/relationship";
import {
  DEFAULT_COMPANION_PREFS,
  type Relationship,
  type RelationshipApiResponse,
  type RelationshipTransport,
} from "@/api/relationship";

const ACTIVE: Relationship = {
  relationshipId: "1",
  personaRef: "gentle-listener",
  active: true,
  createdAt: "2026-08-13T01:00:00Z",
  ...DEFAULT_COMPANION_PREFS,
};
const INACTIVE: Relationship = {
  relationshipId: "2",
  personaRef: "other",
  active: false,
  createdAt: "2026-08-13T02:00:00Z",
  ...DEFAULT_COMPANION_PREFS,
};

/** Mock RelationshipTransport routing by path, like stores/chat.spec.ts. */
function mockTransport(opts: {
  list?: Relationship[];
  listStatus?: number;
  createJson?: unknown;
  createStatus?: number;
  activateJson?: unknown;
  activateStatus?: number;
  deactivateJson?: unknown;
  deactivateStatus?: number;
  updateJson?: unknown;
  updateStatus?: number;
  previewJson?: unknown;
  previewStatus?: number;
  resetJson?: unknown;
  resetStatus?: number;
  deleteJson?: unknown;
  deleteStatus?: number;
}): RelationshipTransport & { listCalls: number } {
  let listCalls = 0;
  return {
    async request(method: string, path: string): Promise<RelationshipApiResponse> {
      // createRelationship / listRelationships
      if (path === "/api/v1/relationships" && method === "GET") {
        listCalls += 1;
        const status = opts.listStatus ?? 200;
        return { ok: status === 200, status, json: status === 200 ? (opts.list ?? []) : null };
      }
      if (path === "/api/v1/relationships" && method === "POST") {
        const status = opts.createStatus ?? 200;
        return { ok: status === 200, status, json: status === 200 ? opts.createJson : null };
      }
      if (method === "PATCH" && /^\/api\/v1\/relationships\/[^/]+$/.test(path)) {
        const status = opts.updateStatus ?? 200;
        return { ok: status === 200, status, json: status === 200 ? opts.updateJson : null };
      }
      if (/^\/api\/v1\/relationships\/[^/]+\/deactivate$/.test(path)) {
        const status = opts.deactivateStatus ?? 200;
        return { ok: status === 200, status, json: status === 200 ? opts.deactivateJson : null };
      }
      if (/\/clearance-preview$/.test(path) && method === "GET") {
        const status = opts.previewStatus ?? 200;
        return { ok: status === 200, status, json: status === 200 ? opts.previewJson : null };
      }
      if (/\/reset$/.test(path) && method === "POST") {
        const status = opts.resetStatus ?? 200;
        return { ok: status === 200, status, json: status === 200 ? opts.resetJson : null };
      }
      if (method === "DELETE" && /^\/api\/v1\/relationships\/[^/]+$/.test(path)) {
        const status = opts.deleteStatus ?? 200;
        return { ok: status === 200, status, json: status === 200 ? (opts.deleteJson ?? { ok: true }) : null };
      }
      if (/^\/api\/v1\/relationships\/[^/]+$/.test(path)) {
        const status = opts.activateStatus ?? 200;
        return { ok: status === 200, status, json: status === 200 ? opts.activateJson : null };
      }
      return { ok: true, status: 200, json: {} };
    },
    get listCalls() {
      return listCalls;
    },
  } as RelationshipTransport & { listCalls: number };
}

describe("useRelationshipStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("load populates the list and defaults current to the active relationship", async () => {
    const store = useRelationshipStore();
    const transport = mockTransport({ list: [INACTIVE, ACTIVE] });

    await store.load(transport);

    expect(store.status).toBe("ready");
    expect(store.relationships).toHaveLength(2);
    expect(store.currentRelationshipId).toBe("1");
    expect(store.current?.personaRef).toBe("gentle-listener");
  });

  it("load with no active relationship leaves current null", async () => {
    const store = useRelationshipStore();
    const transport = mockTransport({ list: [INACTIVE] });

    await store.load(transport);

    expect(store.status).toBe("ready");
    expect(store.currentRelationshipId).toBeNull();
    expect(store.current).toBeNull();
  });

  it("load with an empty list keeps current null", async () => {
    const store = useRelationshipStore();
    const transport = mockTransport({ list: [] });

    await store.load(transport);

    expect(store.relationships).toEqual([]);
    expect(store.currentRelationshipId).toBeNull();
    expect(store.status).toBe("ready");
  });

  it("load sets status=error on 401 without faking success", async () => {
    const store = useRelationshipStore();
    const transport = mockTransport({ listStatus: 401 });

    await store.load(transport);

    expect(store.status).toBe("error");
    expect(store.relationships).toEqual([]);
    expect(store.error).toBeTruthy();
  });

  it("create creates the relationship, reloads, and selects it as current", async () => {
    const store = useRelationshipStore();
    const created: Relationship = { ...ACTIVE, relationshipId: "3" };
    const transport = mockTransport({
      createJson: { relationshipId: 3, personaRef: "gentle-listener", active: true },
      list: [{ ...ACTIVE, relationshipId: "3" }],
    });

    const result = await store.create(transport, "gentle-listener");

    expect(result?.relationshipId).toBe("3");
    expect(store.currentRelationshipId).toBe("3");
    // createRelationship then load → list called once
    expect(transport.listCalls).toBe(1);
  });

  it("create returns null on existence-hidden failure and does not change current", async () => {
    const store = useRelationshipStore();
    const transport = mockTransport({ createStatus: 404 });

    const result = await store.create(transport, "gentle-listener");

    expect(result).toBeNull();
    expect(store.currentRelationshipId).toBeNull();
  });

  it("activate sets current to the activated relationship and reloads", async () => {
    const store = useRelationshipStore();
    store.relationships = [INACTIVE];
    const transport = mockTransport({
      activateJson: { relationshipId: 2, personaRef: "other", active: true },
      list: [{ ...INACTIVE, active: true }],
    });

    const result = await store.activate(transport, "2");

    expect(result?.active).toBe(true);
    expect(store.currentRelationshipId).toBe("2");
    expect(transport.listCalls).toBe(1);
  });

  it("activate returns null on existence-hidden failure", async () => {
    const store = useRelationshipStore();
    const transport = mockTransport({ activateStatus: 404 });

    const result = await store.activate(transport, "999");

    expect(result).toBeNull();
    expect(store.currentRelationshipId).toBeNull();
  });

  it("deactivate clears current when it was the selected relationship", async () => {
    const store = useRelationshipStore();
    store.relationships = [ACTIVE];
    store.currentRelationshipId = "1";
    const transport = mockTransport({
      deactivateJson: { relationshipId: 1, personaRef: "gentle-listener", active: false },
      list: [{ ...ACTIVE, active: false }],
    });

    const result = await store.deactivate(transport, "1");

    expect(result?.active).toBe(false);
    expect(store.currentRelationshipId).toBeNull();
  });

  it("deactivate returns null on existence-hidden failure", async () => {
    const store = useRelationshipStore();
    const transport = mockTransport({ deactivateStatus: 404 });

    const result = await store.deactivate(transport, "999");

    expect(result).toBeNull();
  });

  it("updatePrefs reloads the authoritative row after a successful PATCH", async () => {
    const store = useRelationshipStore();
    const updated = { ...ACTIVE, companionName: "小安", replyLength: "SHORT" as const };
    const transport = mockTransport({
      updateJson: updated,
      list: [updated],
    });

    const result = await store.updatePrefs(transport, "1", {
      ...DEFAULT_COMPANION_PREFS,
      companionName: "小安",
      replyLength: "SHORT",
    });

    expect(result?.companionName).toBe("小安");
    expect(store.current?.replyLength).toBe("SHORT");
    expect(store.currentRelationshipId).toBe("1");
    expect(transport.listCalls).toBe(1);
  });

  it("resetCompanion reloads and keeps the current companion", async () => {
    const store = useRelationshipStore();
    store.relationships = [ACTIVE];
    store.currentRelationshipId = "1";
    const transport = mockTransport({
      resetJson: ACTIVE,
      list: [ACTIVE],
    });

    const result = await store.resetCompanion(transport, "1");

    expect(result?.relationshipId).toBe("1");
    expect(store.currentRelationshipId).toBe("1");
    expect(transport.listCalls).toBe(1);
  });

  it("removeCompanion clears current after a confirmed delete", async () => {
    const store = useRelationshipStore();
    store.relationships = [ACTIVE];
    store.currentRelationshipId = "1";
    const transport = mockTransport({
      deleteJson: { ok: true },
      list: [],
    });

    const result = await store.removeCompanion(transport, "1");

    expect(result).toBe(true);
    expect(store.currentRelationshipId).toBeNull();
    expect(store.relationships).toEqual([]);
  });

  it("reset clears all state", async () => {
    const store = useRelationshipStore();
    const transport = mockTransport({ list: [ACTIVE] });
    await store.load(transport);
    expect(store.relationships).toHaveLength(1);

    store.reset();

    expect(store.relationships).toEqual([]);
    expect(store.currentRelationshipId).toBeNull();
    expect(store.status).toBe("idle");
    expect(store.error).toBeNull();
  });
});
