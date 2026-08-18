import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";

import type { UsageHealthApiResponse, UsageHealthTransport } from "@/api/usage-health";
import { useUsageHealthStore } from "./usage-health";

const STATUS = {
  reminderAfterMinutes: 120 as const,
  sessionGapMinutes: 30 as const,
  continuousMinutes: 12,
  reminderDue: false,
  sessionStartedAt: "2026-08-18T00:00:00Z",
};

function mockTransport(opts: {
  getJson?: unknown;
  getStatus?: number;
  putJson?: unknown;
  putStatus?: number;
  postJson?: unknown;
  postStatus?: number;
}): UsageHealthTransport & { posts: { path: string; body?: unknown }[] } {
  const posts: { path: string; body?: unknown }[] = [];
  return {
    async request(method: string, path: string, body?: unknown): Promise<UsageHealthApiResponse> {
      if (method === "GET") {
        const status = opts.getStatus ?? 200;
        return { ok: status === 200, status, json: status === 200 ? opts.getJson : null };
      }
      if (method === "PUT") {
        const status = opts.putStatus ?? 200;
        return { ok: status === 200, status, json: status === 200 ? opts.putJson : null };
      }
      posts.push({ path, body });
      const status = opts.postStatus ?? 200;
      return { ok: status === 200, status, json: status === 200 ? opts.postJson : null };
    },
    posts,
  };
}

describe("useUsageHealthStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("loads the read-only status without inventing a due reminder", async () => {
    const store = useUsageHealthStore();
    await store.load(mockTransport({ getJson: STATUS }));

    expect(store.status).toEqual(STATUS);
    expect(store.reminderDue).toBe(false);
    expect(store.loadFailed).toBe(false);
  });

  it("updates prefs only after a confirmed PUT", async () => {
    const store = useUsageHealthStore();
    await store.load(mockTransport({ getJson: STATUS }));
    const transport = mockTransport({
      putJson: { ...STATUS, reminderAfterMinutes: 60, sessionGapMinutes: 15 },
    });

    const ok = await store.savePrefs(transport, 60, 15);

    expect(ok).toBe(true);
    expect(store.status?.reminderAfterMinutes).toBe(60);
    expect(store.status?.sessionGapMinutes).toBe(15);
  });

  it("heartbeat is non-fatal and only writes a parsed status", async () => {
    const store = useUsageHealthStore();
    await store.heartbeat(mockTransport({ postStatus: 503 }));
    expect(store.status).toBeNull();

    await store.heartbeat(
      mockTransport({
        postJson: { ...STATUS, continuousMinutes: 125, reminderDue: true },
      }),
    );
    expect(store.reminderDue).toBe(true);
    expect(store.continuousMinutes).toBe(125);
  });

  it("CONTINUED clears the due flag from the confirmed response", async () => {
    const store = useUsageHealthStore();
    store.status = { ...STATUS, reminderDue: true, continuousMinutes: 125 };
    const transport = mockTransport({
      postJson: { ...STATUS, reminderDue: false, continuousMinutes: 125 },
    });

    const ok = await store.record(transport, "CONTINUED");

    expect(ok).toBe(true);
    expect(store.reminderDue).toBe(false);
    expect(transport.posts[0]).toEqual({
      path: "/api/v1/usage-health/reminder",
      body: { result: "CONTINUED" },
    });
  });

  it("markShown records SHOWN once per session start", async () => {
    const store = useUsageHealthStore();
    store.status = {
      ...STATUS,
      reminderDue: true,
      continuousMinutes: 125,
      sessionStartedAt: "2026-08-18T01:00:00Z",
    };
    const transport = mockTransport({
      postJson: {
        ...STATUS,
        reminderDue: true,
        continuousMinutes: 125,
        sessionStartedAt: "2026-08-18T01:00:00Z",
      },
    });

    await store.markShown(transport);
    await store.markShown(transport);

    expect(transport.posts).toHaveLength(1);
    expect(transport.posts[0]?.body).toEqual({ result: "SHOWN" });
  });
});
