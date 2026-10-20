import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RelationshipApiResponse, RelationshipTransport } from "@/api/relationship";

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

/** VC-R09: transport whose responses settle only when the test releases them. */
function deferredRelationshipTransport() {
  const resolvers: Array<(response: RelationshipApiResponse) => void> = [];
  const request = vi.fn(
    async (): Promise<RelationshipApiResponse> =>
      new Promise<RelationshipApiResponse>((resolve) => {
        resolvers.push(resolve);
      }),
  );
  return {
    transport: { request } as RelationshipTransport,
    settle(index: number, response: RelationshipApiResponse): void {
      resolvers[index]?.(response);
    },
  };
}

const accountARows = [
  { relationshipId: "a-1", personaRef: "persona-a", active: false },
  { relationshipId: "a-2", personaRef: "persona-a", active: true },
];

const accountBRows = [
  { relationshipId: "b-1", personaRef: "persona-b", active: true },
];

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

  it("VC-R09: a stale account-A success arriving after reset never revives A over B", async () => {
    const store = useRelationshipStore();
    const deferred = deferredRelationshipTransport();

    // 账号 A 的列表读取在途时发生换号清理，随后账号 B 的读取落地。
    const staleA = store.load(deferred.transport);
    store.reset();
    const freshB = store.load(deferred.transport);

    deferred.settle(1, { ok: true, status: 200, json: accountBRows });
    await freshB;
    expect(store.status).toBe("ready");
    expect(store.currentRelationshipId).toBe("b-1");

    // 旧账号 A 的成功响应晚到：不得覆盖 B 的数据/选中/状态。
    deferred.settle(0, { ok: true, status: 200, json: accountARows });
    await staleA;

    expect(store.status).toBe("ready");
    expect(store.currentRelationshipId).toBe("b-1");
    expect(store.relationships).toEqual(accountBRows);
  });

  it("VC-R09: a stale account-A failure arriving after reset keeps B's ready state", async () => {
    const store = useRelationshipStore();
    const deferred = deferredRelationshipTransport();

    const staleA = store.load(deferred.transport);
    store.reset();
    const freshB = store.load(deferred.transport);

    deferred.settle(1, { ok: true, status: 200, json: accountBRows });
    await freshB;

    // 旧账号 A 的失败响应晚到：不得清空 B 的数据或污染 error/status。
    deferred.settle(0, { ok: false, status: 503, json: null });
    await staleA;

    expect(store.status).toBe("ready");
    expect(store.error).toBeNull();
    expect(store.currentRelationshipId).toBe("b-1");
    expect(store.relationships).toEqual(accountBRows);
  });
});
