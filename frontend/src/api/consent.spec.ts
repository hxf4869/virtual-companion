// CONSENT (FR-AUTH-003): typed client unit tests — PUT wire shape, parsing,
// malformed-row filtering and typed errors.
import { describe, expect, it, vi } from "vitest";

import {
  ConsentHttpError,
  listConsents,
  recordConsent,
  type ConsentTransport,
} from "./consent";

const RECORD_JSON = {
  consentId: 12,
  consentType: "SERVICE_TERMS",
  version: "2026-08",
  granted: true,
  grantedAt: "2026-08-15T08:00:00Z",
  revokedAt: null,
};

function recorder(
  response: { ok: boolean; status: number; json: unknown },
): { transport: ConsentTransport; calls: { method: string; path: string; body?: unknown }[] } {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const transport: ConsentTransport = {
    request: vi.fn(async (method: string, path: string, body?: unknown) => {
      calls.push({ method, path, body });
      return { ...response };
    }),
  };
  return { transport, calls };
}

describe("consent api client (FR-AUTH-003)", () => {
  it("PUTs the versioned grant/revoke body and parses the record", async () => {
    const { transport, calls } = recorder({ ok: true, status: 200, json: RECORD_JSON });

    const recorded = await recordConsent(transport, "MODEL_TRAINING", "2026-08", false);

    expect(calls).toEqual([
      {
        method: "PUT",
        path: "/api/v1/consents",
        body: { consentType: "MODEL_TRAINING", version: "2026-08", granted: false },
      },
    ]);
    expect(recorded?.consentId).toBe("12");
    expect(recorded?.consentType).toBe("SERVICE_TERMS");
    expect(recorded?.granted).toBe(true);
    expect(recorded?.revokedAt).toBeUndefined();
  });

  it("lists the effective records and drops malformed rows", async () => {
    const { transport, calls } = recorder({
      ok: true,
      status: 200,
      json: [
        RECORD_JSON,
        // Unapproved type must never leak into the parsed list.
        { consentId: 13, consentType: "NOT_APPROVED", version: "2026-08", granted: false, grantedAt: "x" },
        // Missing grantedAt must also be dropped.
        { consentId: "14", consentType: "MODEL_TRAINING", version: "2026-08", granted: false },
        {
          consentId: "15",
          consentType: "MODEL_TRAINING",
          version: "2026-08",
          granted: false,
          grantedAt: "2026-08-15T09:00:00Z",
        },
      ],
    });

    const list = await listConsents(transport);

    expect(calls[0]).toEqual({ method: "GET", path: "/api/v1/consents" });
    expect(list).toHaveLength(2);
    expect(list[0].consentId).toBe("12");
    expect(list[1].consentId).toBe("15");
  });

  it("throws a typed error on non-OK statuses", async () => {
    const { transport } = recorder({ ok: false, status: 403, json: null });

    await expect(
      recordConsent(transport, "SERVICE_TERMS", "2026-08", true),
    ).rejects.toBeInstanceOf(ConsentHttpError);
  });

  it("throws a typed error when the list is not an array", async () => {
    const { transport } = recorder({ ok: true, status: 200, json: { not: "an array" } });

    await expect(listConsents(transport)).rejects.toBeInstanceOf(ConsentHttpError);
  });

  it("returns null when the PUT body cannot be parsed", async () => {
    const { transport } = recorder({ ok: true, status: 200, json: { consentId: 1 } });

    expect(await recordConsent(transport, "SERVICE_TERMS", "2026-08", true)).toBeNull();
  });
});
