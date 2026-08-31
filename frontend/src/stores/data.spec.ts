import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_COMPANION_PREFS, type RelationshipApiResponse } from "@/api/relationship";
import { useDataStore } from "./data";

function mockTransport(): {
  transport: { request: (method: string, path: string) => Promise<RelationshipApiResponse> };
  paths: string[];
} {
  const paths: string[] = [];
  return {
    paths,
    transport: {
      async request(method: string, path: string): Promise<RelationshipApiResponse> {
        paths.push(`${method} ${path}`);
        if (path === "/api/v1/relationships") {
          return {
            ok: true,
            status: 200,
            json: [{ relationshipId: 7, personaRef: "gentle-listener", active: true, ...DEFAULT_COMPANION_PREFS }],
          };
        }
        if (path === "/api/v1/conversations") {
          return {
            ok: true,
            status: 200,
            json: [{ conversationId: 11, relationshipId: 7, createdAt: "2026-08-18T00:00:00Z", title: "夜聊" }],
          };
        }
        if (path === "/api/v1/consents") {
          return {
            ok: true,
            status: 200,
            json: [
              {
                consentId: 1,
                consentType: "SERVICE_TERMS",
                version: "2026-08",
                granted: true,
                grantedAt: "2026-08-18T00:00:00Z",
              },
            ],
          };
        }
        if (path === "/api/v1/service-mode") {
          return { ok: true, status: 200, json: { mode: "ZERO_LLM", summary: "当前为无生成模型的受限服务" } };
        }
        if (path === "/api/v1/relationships/7/memories") {
          return {
            ok: true,
            status: 200,
            json: [{ memoryId: "3", scope: "RELATIONSHIP", summary: "喜欢安静的晚上", status: "ACCEPTED" }],
          };
        }
        return { ok: false, status: 500, json: null };
      },
    },
  };
}

describe("useDataStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("loads every FR-DATA-001 domain through the shipped list APIs", async () => {
    const store = useDataStore();
    const { transport, paths } = mockTransport();

    await store.load(transport);

    expect(store.loadFailed).toBe(false);
    expect(store.relationships).toHaveLength(1);
    expect(store.conversations[0]?.title).toBe("夜聊");
    expect(store.memories[0]?.summary).toBe("喜欢安静的晚上");
    expect(store.consents[0]?.consentType).toBe("SERVICE_TERMS");
    expect(store.serviceMode?.mode).toBe("ZERO_LLM");
    expect(paths).toContain("GET /api/v1/relationships");
    expect(paths).toContain("GET /api/v1/conversations");
    expect(paths).toContain("GET /api/v1/relationships/7/memories");
    expect(paths).not.toContain("GET /api/v1/relationships/7/reminders");
    expect(paths).toContain("GET /api/v1/consents");
    expect(paths).toContain("GET /api/v1/service-mode");
  });

  it("does not keep a partial success when a list call fails", async () => {
    const store = useDataStore();
    await store.load({
      async request() {
        return { ok: false, status: 500, json: null };
      },
    });

    expect(store.loadFailed).toBe(true);
    expect(store.relationships).toEqual([]);
    expect(store.memories).toEqual([]);
  });

  it("S0-21: a memory list failure is partial, not an empty memory success", async () => {
    const store = useDataStore();
    const { transport } = mockTransport();
    const failing = {
      async request(method: string, path: string) {
        if (path === "/api/v1/relationships/7/memories") {
          return { ok: false, status: 500, json: null };
        }
        return transport.request(method, path);
      },
    };

    await store.load(failing);

    expect(store.loadFailed).toBe(false);
    expect(store.asyncState.status).toBe("partial");
    expect(store.asyncState.failedDomains).toContain("memory");
    expect(store.memories).toEqual([]);
    expect(store.asyncState.stale).toBe(false);
  });
});
