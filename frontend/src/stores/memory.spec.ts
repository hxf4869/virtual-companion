import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearLocalSessionCaches } from "@/domain/session-cleanup";
import { TransportTimeoutError } from "@/api/transport";

import { useAuthStore } from "./auth";
import { useMemoryStore } from "./memory";
import type { MemoryItem, MemoryTransport, MemoryApiResponse } from "@/api/memory";

function transport(
  impl: (method: string, path: string) => { ok: boolean; status: number; json: unknown; parseFailed?: boolean },
): MemoryTransport {
  return { request: vi.fn(async (method: string, path: string) => impl(method, path)) };
}

/** request 返回手动控制 resolve 的 promise，用于模拟晚到响应。 */
function gatedTransport(impl: (method: string, path: string) => Promise<MemoryApiResponse>): {
  client: MemoryTransport;
  requests: Array<{ method: string; path: string }>;
} {
  const requests: Array<{ method: string; path: string }> = [];
  const client: MemoryTransport = {
    request: (method: string, path: string) => {
      requests.push({ method, path });
      return impl(method, path);
    },
  };
  return { client, requests };
}

function row(overrides: Partial<MemoryItem> = {}): MemoryItem {
  return {
    memoryId: "m1",
    scope: "FACT",
    summary: "内容",
    status: "ACCEPTED",
    createdAt: "2026-09-01T10:00:00Z",
    autoSaved: true,
    ...overrides,
  };
}

function okList(items: unknown) {
  return { ok: true, status: 200, json: items };
}

describe("memory store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("loads the list and partitions saved vs pending items", async () => {
    const store = useMemoryStore();
    const client = transport((_method, path) => {
      if (path.endsWith("/memories")) {
        return okList([
          row(),
          row({ memoryId: "m2", status: "PENDING_CONFIRMATION" }),
          row({ memoryId: "m3", status: "REJECTED" }),
          row({ memoryId: "m4", supersededAt: "2026-09-02T00:00:00Z" }),
        ]);
      }
      return { ok: true, status: 200, json: { enabled: true } };
    });

    await Promise.all([store.load(client, "42"), store.loadAutoSave(client)]);

    expect(store.listStatus).toBe("ready");
    expect(store.acceptedItems.map((item) => item.memoryId)).toEqual(["m1"]);
    expect(store.pendingItems.map((item) => item.memoryId)).toEqual(["m2"]);
    expect(store.autoSaveEnabled).toBe(true);
    expect(store.autoSaveState).toBe("ready");
  });

  it("keeps previously loaded items when a refresh fails", async () => {
    const store = useMemoryStore();
    let failing = false;
    const client = transport(() => failing
      ? { ok: false, status: 500, json: null }
      : okList([row()]));

    await store.load(client, "42");
    expect(store.acceptedItems).toHaveLength(1);

    failing = true;
    await store.load(client, "42");
    expect(store.listStatus).toBe("error");
    expect(store.acceptedItems).toHaveLength(1);
  });

  it("marks the auto-save switch unknown on 5xx because the write may have persisted", async () => {
    const store = useMemoryStore();
    // 读请求的 5xx 是确定失败；写请求的 5xx 是"结果未知"（可能已生效）。
    const client = transport(() => ({ ok: false, status: 500, json: null }));

    await store.loadAutoSave(client);
    expect(store.autoSaveState).toBe("error");

    await store.setAutoSave(client, true);
    expect(store.autoSaveState).toBe("unknown");
    expect(store.autoSaveEnabled).toBe(false);
  });

  it("marks the auto-save switch failed on 4xx http errors and keeps the old value", async () => {
    const store = useMemoryStore();
    await store.setAutoSave(transport(() => ({ ok: false, status: 400, json: null })), true);
    expect(store.autoSaveEnabled).toBe(false);
    expect(store.autoSaveState).toBe("error");
  });

  it("marks the auto-save switch unknown on protocol errors and timeouts", async () => {
    const store = useMemoryStore();
    await store.setAutoSave(transport(() => ({
      ok: true,
      status: 200,
      json: null,
      parseFailed: true,
    })), true);
    expect(store.autoSaveState).toBe("unknown");

    const timeoutClient: MemoryTransport = {
      request: vi.fn(async () => {
        throw new TransportTimeoutError(15_000);
      }),
    };
    await store.setAutoSave(timeoutClient, false);
    expect(store.autoSaveState).toBe("unknown");
    expect(store.autoSaveEnabled).toBe(false);
  });

  it("marks the auto-save switch unknown on network failures because the request may have been sent", async () => {
    const store = useMemoryStore();
    const client: MemoryTransport = {
      request: vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    };
    await store.setAutoSave(client, true);
    expect(store.autoSaveState).toBe("unknown");
    expect(store.autoSaveEnabled).toBe(false);
  });

  it("keeps the switch value unconfirmed until a read or write is confirmed", async () => {
    const store = useMemoryStore();
    let failing = true;
    const client = transport(() => failing
      ? { ok: false, status: 500, json: null }
      : { ok: true, status: 200, json: { enabled: true } });

    // 首次读取失败：默认 false 不得被当作服务端确认值。
    await store.loadAutoSave(client);
    expect(store.autoSaveState).toBe("error");
    expect(store.autoSaveValueKnown).toBe(false);
    expect(store.autoSaveEnabled).toBe(false);

    failing = false;
    await store.loadAutoSave(client);
    expect(store.autoSaveValueKnown).toBe(true);
    expect(store.autoSaveEnabled).toBe(true);

    // reset（退出/换号）后同样回到未确认。
    store.reset();
    expect(store.autoSaveValueKnown).toBe(false);
  });

  it("keeps the switch value confirmed after a successful write echo", async () => {
    const store = useMemoryStore();
    await store.setAutoSave(transport(() => ({ ok: true, status: 200, json: { enabled: false } })), false);
    expect(store.autoSaveState).toBe("ready");
    expect(store.autoSaveValueKnown).toBe(true);
    expect(store.autoSaveEnabled).toBe(false);
  });

  it("reports existence-hidden list reads as inconclusive instead of authoritative empty", async () => {
    const store = useMemoryStore();
    const client = transport((_method, path) => path.endsWith("/memories")
      ? { ok: false, status: 404, json: null }
      : { ok: true, status: 200, json: { enabled: true } });

    // 首载即存在性隐藏：空列表不可信，按三态返回 inconclusive。
    const outcome = await store.load(client, "42");
    expect(outcome).toBe("inconclusive");
    expect(store.listStatus).toBe("ready");
    expect(store.items).toEqual([]);

    // 已有数据时同样不覆盖，保留旧数据并上报不确定。
    store.items = [row()];
    const outcomeAgain = await store.load(client, "42");
    expect(outcomeAgain).toBe("inconclusive");
    expect(store.items).toHaveLength(1);
  });

  it("replaces and removes single items", () => {
    const store = useMemoryStore();
    store.items = [row(), row({ memoryId: "m2" })];

    store.replaceItem(row({ memoryId: "m2", summary: "更新" }));
    expect(store.items[1]?.summary).toBe("更新");

    store.removeItem("m1");
    expect(store.items.map((item) => item.memoryId)).toEqual(["m2"]);
  });

  it("resets everything", async () => {
    const store = useMemoryStore();
    const client = transport(() => okList([row()]));
    await store.load(client, "42");
    store.reset();
    expect(store.items).toEqual([]);
    expect(store.listStatus).toBe("idle");
    expect(store.autoSaveState).toBe("idle");
  });

  it("drops a late list response after reset (account switch)", async () => {
    const store = useMemoryStore();
    let resolveList!: (value: MemoryApiResponse) => void;
    const { client } = gatedTransport((_method, path) => {
      if (path.endsWith("/memories")) {
        return new Promise<MemoryApiResponse>((resolve) => {
          resolveList = resolve;
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: { enabled: true } });
    });

    const pending = store.load(client, "42");
    expect(store.listStatus).toBe("loading");

    // 退出/换号清理：reset 递增 ownerEpoch，旧账号响应作废。
    store.reset();
    resolveList({ ok: true, status: 200, json: [row()] });
    await pending;

    expect(store.items).toEqual([]);
    expect(store.listStatus).toBe("idle");
  });

  it("drops a late failing list response after reset", async () => {
    const store = useMemoryStore();
    let rejectList!: (error: unknown) => void;
    const { client } = gatedTransport(() => new Promise<MemoryApiResponse>((_resolve, reject) => {
      rejectList = reject;
    }));

    const pending = store.load(client, "42");
    store.reset();
    rejectList(new Error("late failure"));
    await pending;

    expect(store.listStatus).toBe("idle");
    expect(store.items).toEqual([]);
  });

  it("drops late auto-save responses after reset", async () => {
    const store = useMemoryStore();
    let resolveGet!: (value: MemoryApiResponse) => void;
    let resolvePut!: (value: MemoryApiResponse) => void;
    const { client } = gatedTransport((method) => {
      if (method === "GET") {
        return new Promise<MemoryApiResponse>((resolve) => {
          resolveGet = resolve;
        });
      }
      return new Promise<MemoryApiResponse>((resolve) => {
        resolvePut = resolve;
      });
    });

    const pendingLoad = store.loadAutoSave(client);
    store.reset();
    resolveGet({ ok: true, status: 200, json: { enabled: true } });
    await pendingLoad;
    expect(store.autoSaveEnabled).toBe(false);
    expect(store.autoSaveState).toBe("idle");

    const pendingSet = store.setAutoSave(client, true);
    store.reset();
    resolvePut({ ok: true, status: 200, json: { enabled: true } });
    await pendingSet;
    expect(store.autoSaveEnabled).toBe(false);
    expect(store.autoSaveState).toBe("idle");
  });

  it("does not let a stale list response overwrite a local edit (same account, out-of-order)", async () => {
    const store = useMemoryStore();
    // 先加载一次拿到基线数据。
    await store.load(transport(() => okList([row()])), "42");
    expect(store.items.map((item) => item.summary)).toEqual(["内容"]);

    let resolveList!: (value: MemoryApiResponse) => void;
    const { client } = gatedTransport(() => new Promise<MemoryApiResponse>((resolve) => {
      resolveList = resolve;
    }));

    // 第二次列表请求先发出；本地编辑（replaceItem）在其响应到达前完成。
    const pending = store.load(client, "42");
    store.replaceItem(row({ memoryId: "m1", summary: "本地新值" }));
    resolveList({ ok: true, status: 200, json: [row()] });
    await pending;

    // 旧快照不得覆盖新编辑；展示状态恢复可用。
    expect(store.items.map((item) => item.summary)).toEqual(["本地新值"]);
    expect(store.listStatus).toBe("ready");
  });

  it("does not let a stale list response resurrect a locally removed item", async () => {
    const store = useMemoryStore();
    let resolveList!: (value: MemoryApiResponse) => void;
    const { client } = gatedTransport(() => new Promise<MemoryApiResponse>((resolve) => {
      resolveList = resolve;
    }));

    const pending = store.load(client, "42");
    store.items = [row(), row({ memoryId: "m2" })];
    store.removeItem("m1");
    resolveList({ ok: true, status: 200, json: [row(), row({ memoryId: "m2" })] });
    await pending;

    expect(store.items.map((item) => item.memoryId)).toEqual(["m2"]);
    expect(store.listStatus).toBe("ready");
  });

  it("still accepts a fresh list response after a local write", async () => {
    const store = useMemoryStore();
    const client = transport(() => okList([row({ summary: "服务器新值" })]));
    store.replaceItem(row({ memoryId: "m1", summary: "本地旧写" }));

    await store.load(client, "42");

    // 新发起的读取捕获新版本号，正常写回权威数据。
    expect(store.items.map((item) => item.summary)).toEqual(["服务器新值"]);
    expect(store.listStatus).toBe("ready");
  });

  it("is reset by the shared logout/401 cleanup chain", async () => {
    const auth = useAuthStore();
    auth.accessToken = "session";
    auth.accountId = "7";
    const store = useMemoryStore();
    const client = transport((_method, path) => path.endsWith("/memories")
      ? okList([row()])
      : { ok: true, status: 200, json: { enabled: true } });
    await Promise.all([store.load(client, "42"), store.loadAutoSave(client)]);
    expect(store.acceptedItems).toHaveLength(1);

    // auth.clear() 在有会话时触发 clearLocalSessionCaches（logout/401/换号共用）。
    auth.clear();

    expect(store.items).toEqual([]);
    expect(store.listStatus).toBe("idle");
    expect(store.autoSaveEnabled).toBe(false);
    expect(store.autoSaveState).toBe("idle");
  });
});
