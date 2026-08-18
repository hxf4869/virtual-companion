import { describe, expect, it } from "vitest";

import {
  asUsageHealthStatus,
  getUsageHealth,
  recordUsageReminder,
  updateUsageHealthPrefs,
  usageHeartbeat,
  UsageHealthHttpError,
  type UsageHealthTransport,
} from "./usage-health";

function recorder(response: { ok: boolean; status: number; json: unknown }): {
  transport: UsageHealthTransport;
  calls: { method: string; path: string; body?: unknown }[];
} {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  return {
    transport: {
      request: async (method, path, body) => {
        calls.push({ method, path, body });
        return { ...response };
      },
    },
    calls,
  };
}

const STATUS = {
  reminderAfterMinutes: 120,
  sessionGapMinutes: 30,
  continuousMinutes: 12,
  reminderDue: false,
  sessionStartedAt: "2026-08-18T00:00:00Z",
};

describe("getUsageHealth", () => {
  it("GETs /api/v1/usage-health and keeps the computed session", async () => {
    const { transport, calls } = recorder({ ok: true, status: 200, json: STATUS });

    const result = await getUsageHealth(transport);

    expect(calls).toEqual([{ method: "GET", path: "/api/v1/usage-health" }]);
    expect(result).toEqual(STATUS);
  });

  it("throws UsageHealthHttpError on 401", async () => {
    const { transport } = recorder({ ok: false, status: 401, json: null });

    await expect(getUsageHealth(transport)).rejects.toThrow(UsageHealthHttpError);
  });
});

describe("updateUsageHealthPrefs", () => {
  it("PUTs approved intervals", async () => {
    const { transport, calls } = recorder({
      ok: true,
      status: 200,
      json: { ...STATUS, reminderAfterMinutes: 60, sessionGapMinutes: 15 },
    });

    const result = await updateUsageHealthPrefs(transport, 60, 15);

    expect(calls).toEqual([
      {
        method: "PUT",
        path: "/api/v1/usage-health",
        body: { reminderAfterMinutes: 60, sessionGapMinutes: 15 },
      },
    ]);
    expect(result.reminderAfterMinutes).toBe(60);
    expect(result.sessionGapMinutes).toBe(15);
  });
});

describe("usageHeartbeat", () => {
  it("POSTs /api/v1/usage-health/heartbeat", async () => {
    const { transport, calls } = recorder({
      ok: true,
      status: 200,
      json: { ...STATUS, continuousMinutes: 125, reminderDue: true },
    });

    const result = await usageHeartbeat(transport);

    expect(calls).toEqual([{ method: "POST", path: "/api/v1/usage-health/heartbeat" }]);
    expect(result?.reminderDue).toBe(true);
    expect(result?.continuousMinutes).toBe(125);
  });

  it("returns null on a non-OK heartbeat so the chat page stays usable", async () => {
    const { transport } = recorder({ ok: false, status: 503, json: null });

    await expect(usageHeartbeat(transport)).resolves.toBeNull();
  });
});

describe("recordUsageReminder", () => {
  it("POSTs the approved result", async () => {
    const { transport, calls } = recorder({
      ok: true,
      status: 200,
      json: { ...STATUS, reminderDue: false },
    });

    await recordUsageReminder(transport, "CONTINUED");

    expect(calls).toEqual([
      { method: "POST", path: "/api/v1/usage-health/reminder", body: { result: "CONTINUED" } },
    ]);
  });
});

describe("asUsageHealthStatus", () => {
  it("rejects unapproved intervals and a negative continuous count", () => {
    expect(asUsageHealthStatus({ ...STATUS, reminderAfterMinutes: 99 })).toBeNull();
    expect(asUsageHealthStatus({ ...STATUS, sessionGapMinutes: 10 })).toBeNull();
    expect(asUsageHealthStatus({ ...STATUS, continuousMinutes: -1 })).toBeNull();
    expect(asUsageHealthStatus({})).toBeNull();
  });
});
