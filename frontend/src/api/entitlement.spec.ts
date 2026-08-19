// ENT-TRIAL (FR-ENT-005): typed client unit tests — wire shape and parsing.
import { describe, expect, it, vi } from "vitest";

import { getTrialStatus, EntitlementHttpError, type EntitlementTransport } from "./entitlement";

function recorder(response: { ok: boolean; status: number; json: unknown }) {
  const calls: { method: string; path: string }[] = [];
  const transport: EntitlementTransport = {
    request: vi.fn(async (method: string, path: string) => {
      calls.push({ method, path });
      return { ...response };
    }),
  };
  return { transport, calls };
}

describe("entitlement api client (ENT-TRIAL)", () => {
  it("GETs /api/v1/trial-status and parses a live trial", async () => {
    const { transport, calls } = recorder({
      ok: true,
      status: 200,
      json: { active: true, remainingTurns: 3, expiresAt: "2026-09-02T00:00:00Z" },
    });

    const status = await getTrialStatus(transport);

    expect(calls).toEqual([{ method: "GET", path: "/api/v1/trial-status" }]);
    expect(status.active).toBe(true);
    expect(status.remainingTurns).toBe(3);
    expect(status.expiresAt).toBe("2026-09-02T00:00:00Z");
  });

  it("parses the no-trial shape without inventing a budget", async () => {
    const { transport } = recorder({ ok: true, status: 200, json: { active: false } });

    const status = await getTrialStatus(transport);

    expect(status.active).toBe(false);
    expect(status.remainingTurns).toBeNull();
    expect(status.expiresAt).toBeNull();
  });

  it("throws a typed error on failure", async () => {
    const { transport } = recorder({ ok: false, status: 401, json: null });

    await expect(getTrialStatus(transport)).rejects.toBeInstanceOf(EntitlementHttpError);
  });
});
