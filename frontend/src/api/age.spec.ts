import { describe, expect, it } from "vitest";

import {
  AgeHttpError,
  canRunSimulatedVerification,
  canSubmitAgeAppeal,
  getAgeState,
  isVerificationBlocked,
  listAgeAppeals,
  submitAgeAppeal,
  verifyAge,
  type AgeTransport,
} from "./age";

function recorder(response: { ok: boolean; status: number; json: unknown }): {
  transport: AgeTransport;
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

describe("getAgeState", () => {
  it("GETs /api/v1/age/state and keeps provider metadata", async () => {
    const { transport, calls } = recorder({
      ok: true,
      status: 200,
      json: { ageState: "ADULT_VERIFIED", providerRef: "alpha-simulated", verifiedAt: "2026-08-18T00:00:00Z" },
    });

    const result = await getAgeState(transport);

    expect(calls).toEqual([{ method: "GET", path: "/api/v1/age/state" }]);
    expect(result).toEqual({
      ageState: "ADULT_VERIFIED",
      providerRef: "alpha-simulated",
      verifiedAt: "2026-08-18T00:00:00Z",
    });
  });

  it("defaults to AGE_UNKNOWN when the body is empty", async () => {
    const { transport } = recorder({ ok: true, status: 200, json: {} });

    await expect(getAgeState(transport)).resolves.toEqual({
      ageState: "AGE_UNKNOWN",
      providerRef: null,
      verifiedAt: null,
    });
  });

  it("throws AgeHttpError on 401", async () => {
    const { transport } = recorder({ ok: false, status: 401, json: null });

    await expect(getAgeState(transport)).rejects.toThrow(AgeHttpError);
  });
});

describe("verifyAge", () => {
  it("POSTs /api/v1/age/verification", async () => {
    const { transport, calls } = recorder({
      ok: true,
      status: 200,
      json: { ageState: "ADULT_VERIFIED", providerRef: "alpha-simulated", verifiedAt: "2026-08-18T00:00:00Z" },
    });

    const result = await verifyAge(transport);

    expect(calls).toEqual([{ method: "POST", path: "/api/v1/age/verification" }]);
    expect(result.ageState).toBe("ADULT_VERIFIED");
  });

  it("throws AgeHttpError on 400 fail-closed states", async () => {
    const { transport } = recorder({
      ok: false,
      status: 400,
      json: { code: "INVALID_REQUEST" },
    });

    await expect(verifyAge(transport)).rejects.toMatchObject({ name: "AgeHttpError", status: 400 });
  });
});

describe("age state helpers", () => {
  it("marks unknown and re-verify as runnable, minors as blocked", () => {
    expect(canRunSimulatedVerification("AGE_UNKNOWN")).toBe(true);
    expect(canRunSimulatedVerification("AGE_REVERIFY_REQUIRED")).toBe(true);
    expect(canRunSimulatedVerification("ADULT_VERIFIED")).toBe(false);
    expect(isVerificationBlocked("MINOR_SUSPECTED")).toBe(true);
    expect(isVerificationBlocked("AGE_APPEAL_PENDING")).toBe(true);
    expect(isVerificationBlocked("AGE_UNKNOWN")).toBe(false);
  });
});

describe("submitAgeAppeal", () => {
  it("POSTs the appeal body and parses the record", async () => {
    const { transport, calls } = recorder({
      ok: true,
      status: 200,
      json: {
        id: 7,
        reason: "核验结果有误",
        status: "SUBMITTED",
        createdAt: "2026-08-19T08:00:00Z",
      },
    });

    const appeal = await submitAgeAppeal(transport, "核验结果有误");

    expect(calls).toEqual([
      { method: "POST", path: "/api/v1/age/appeal", body: { reason: "核验结果有误" } },
    ]);
    expect(appeal.id).toBe("7");
    expect(appeal.status).toBe("SUBMITTED");
    expect(appeal.resolvedAt).toBeNull();
  });

  it("throws AgeHttpError on a 400 fail-closed state", async () => {
    const { transport } = recorder({ ok: false, status: 400, json: { code: "INVALID_REQUEST" } });

    await expect(submitAgeAppeal(transport, "x")).rejects.toMatchObject({
      name: "AgeHttpError",
      status: 400,
    });
  });
});

describe("listAgeAppeals", () => {
  it("GETs the keyset page and skips malformed rows", async () => {
    const { transport, calls } = recorder({
      ok: true,
      status: 200,
      json: [
        { id: 7, reason: "判错了", status: "SUBMITTED", createdAt: "2026-08-19T08:00:00Z" },
        { id: 8 },
      ],
    });

    const rows = await listAgeAppeals(transport, "7", 20);

    expect(calls[0].path).toBe("/api/v1/age/appeals?after=7&limit=20");
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("7");
  });

  it("throws a typed error on failure", async () => {
    const { transport } = recorder({ ok: false, status: 500, json: null });

    await expect(listAgeAppeals(transport)).rejects.toBeInstanceOf(AgeHttpError);
  });
});

describe("canSubmitAgeAppeal", () => {
  it("allows only the catalog-appealable states", () => {
    expect(canSubmitAgeAppeal("ADULT_VERIFICATION_REQUIRED")).toBe(true);
    expect(canSubmitAgeAppeal("MINOR_SUSPECTED")).toBe(true);
    expect(canSubmitAgeAppeal("AGE_UNKNOWN")).toBe(false);
    expect(canSubmitAgeAppeal("AGE_APPEAL_PENDING")).toBe(false);
    expect(canSubmitAgeAppeal("MINOR_VERIFIED")).toBe(false);
    expect(canSubmitAgeAppeal("ADULT_VERIFIED")).toBe(false);
  });
});
