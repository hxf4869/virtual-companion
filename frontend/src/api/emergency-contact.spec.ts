// EMERGENCY-CONTACT (§20.14): api client spec — parsing, request shapes and
// failure mapping with a mocked transport.
import { describe, expect, it, vi } from "vitest";

import {
  confirmEmergencyContactVerification,
  getEmergencyContact,
  revokeEmergencyContact,
  saveEmergencyContact,
  startEmergencyContactVerification,
  EmergencyContactHttpError,
  type EmergencyContactApiResponse,
  type EmergencyContactTransport,
} from "@/api/emergency-contact";

function transportFor(
  response: EmergencyContactApiResponse,
): EmergencyContactTransport {
  return { request: vi.fn(async () => response) };
}

describe("emergency contact api client (EMERGENCY-CONTACT)", () => {
  it("parses a stored contact card", async () => {
    const t = transportFor({
      ok: true,
      status: 200,
      json: {
        id: "41",
        label: "妈妈",
        contact: "+86 138 0000 0000",
        status: "VERIFIED",
        consentVersion: "2026-08",
        verifiedAt: "2026-08-19T08:00:00Z",
        verifiedMethod: "SIMULATED_EMAIL_LINK",
        verifiedExpiresAt: "2027-02-15T08:00:00Z",
        createdAt: "2026-08-18T08:00:00Z",
        updatedAt: "2026-08-19T08:00:00Z",
      },
    });
    const card = await getEmergencyContact(t);
    expect(card?.status).toBe("VERIFIED");
    expect(card?.contact).toBe("+86 138 0000 0000");
    expect(card?.verifiedMethod).toBe("SIMULATED_EMAIL_LINK");
  });

  it("maps an empty body to null (nothing saved)", async () => {
    const t = transportFor({ ok: true, status: 200, json: null });
    expect(await getEmergencyContact(t)).toBeNull();
  });

  it("sends the save body and parses the draft card", async () => {
    const request = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: {
        id: "42",
        label: "妈妈",
        contact: "+86 138 0000 0000",
        status: "DRAFT",
        createdAt: "2026-08-19T08:00:00Z",
        updatedAt: "2026-08-19T08:00:00Z",
      },
    }));
    const card = await saveEmergencyContact(
      { request } as EmergencyContactTransport,
      "妈妈",
      "+86 138 0000 0000",
    );
    expect(request).toHaveBeenCalledWith("PUT", "/api/v1/emergency-contact", {
      label: "妈妈",
      contact: "+86 138 0000 0000",
    });
    expect(card.status).toBe("DRAFT");
  });

  it("parses the one-time invite token", async () => {
    const t = transportFor({
      ok: true,
      status: 200,
      json: { id: "42", token: "a1b2c3d4e5f6", invitedAt: "2026-08-19T08:00:00Z" },
    });
    const invite = await startEmergencyContactVerification(t);
    expect(invite.token).toBe("a1b2c3d4e5f6");
  });

  it("sends the confirm token and parses the verified card", async () => {
    const request = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: {
        id: "42",
        label: "妈妈",
        contact: "+86 138 0000 0000",
        status: "VERIFIED",
        createdAt: "2026-08-19T08:00:00Z",
        updatedAt: "2026-08-19T08:00:00Z",
      },
    }));
    const card = await confirmEmergencyContactVerification(
      { request } as EmergencyContactTransport,
      "a1b2c3d4e5f6",
    );
    expect(request).toHaveBeenCalledWith(
      "POST",
      "/api/v1/emergency-contact/verify-confirm",
      { token: "a1b2c3d4e5f6" },
    );
    expect(card.status).toBe("VERIFIED");
  });

  it("surfaces the revoke result and maps failures to typed errors", async () => {
    const ok = transportFor({ ok: true, status: 200, json: { revoked: true } });
    expect(await revokeEmergencyContact(ok)).toBe(true);

    const failed = transportFor({ ok: false, status: 400, json: null });
    await expect(saveEmergencyContact(failed, "x", "y")).rejects.toThrow(
      EmergencyContactHttpError,
    );
    await expect(getEmergencyContact(failed)).rejects.toThrow(
      EmergencyContactHttpError,
    );
  });
});
