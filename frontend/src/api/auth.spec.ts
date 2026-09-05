import { describe, expect, it, vi } from "vitest";

import {
  changeAuthPassword,
  confirmAuthenticator,
  deleteAccount,
  getAuthenticatorSetup,
  getAuthSession,
  getRegistrationStatus,
  listAuthSessions,
  listTrustedDevices,
  login,
  logout,
  reauthAuth,
  recordSurvey,
  refresh,
  revokeAllAuthSessions,
  revokeAuthSession,
  revokeTrustedDevice,
  verifyAuthenticatorCode,
  verifyRecoveryCode,
  type AuthApiResponse,
  type AuthTransport,
} from "@/api/auth";

function transportFor(response: AuthApiResponse): AuthTransport {
  return { request: vi.fn(async () => response) };
}

function activeIdentity(recoveryCodes?: string[]) {
  return {
    nextStep: "ACTIVE",
    accountId: "7",
    email: "alice@example.com",
    role: "USER",
    passwordMustChange: false,
    authenticatorEnabled: true,
    expiresInSeconds: 604800,
    ...(recoveryCodes ? { recoveryCodes } : {}),
  };
}

describe("Go Runtime auth client", () => {
  it("reads the server-owned registration switch and fails closed", async () => {
    await expect(getRegistrationStatus(transportFor({
      ok: true,
      status: 200,
      json: { enabled: false },
    }))).resolves.toBe(false);
    await expect(getRegistrationStatus(transportFor({
      ok: false,
      status: 503,
      json: null,
    }))).resolves.toBe(false);
  });

  it("submits account/password and parses a trusted-device ACTIVE session", async () => {
    const transport = transportFor({ ok: true, status: 200, json: activeIdentity() });

    await expect(login(transport, "alice@example.com", "pw")).resolves.toMatchObject({
      nextStep: "ACTIVE",
      accountId: "7",
      email: "alice@example.com",
      authenticatorEnabled: true,
    });
    expect(transport.request).toHaveBeenCalledWith("POST", "/api/v1/auth/login", {
      account: "alice@example.com",
      password: "pw",
    });
  });

  it("accepts a username as the account identifier", async () => {
    const transport = transportFor({
      ok: true,
      status: 202,
      json: {
        nextStep: "TOTP_REQUIRED",
        challengeId: "a".repeat(43),
        expiresAt: "2030-01-01T00:00:00Z",
      },
    });

    await expect(login(transport, "admin", "pw")).resolves.toMatchObject({
      nextStep: "TOTP_REQUIRED",
    });
    expect(transport.request).toHaveBeenCalledWith("POST", "/api/v1/auth/login", {
      account: "admin",
      password: "pw",
    });
  });

  it("parses TOTP/setup challenges and admission states without creating identity", async () => {
    const challenge = "a".repeat(43);
    await expect(login(transportFor({
      ok: true,
      status: 202,
      json: { nextStep: "TOTP_REQUIRED", challengeId: challenge, expiresAt: "2030-01-01T00:00:00Z" },
    }), "alice@example.com", "pw")).resolves.toEqual({
      nextStep: "TOTP_REQUIRED",
      challengeId: challenge,
      expiresAt: "2030-01-01T00:00:00Z",
    });

    await expect(login(transportFor({
      ok: false,
      status: 403,
      json: { nextStep: "DISABLED" },
    }), "alice@example.com", "pw")).resolves.toEqual({ nextStep: "DISABLED" });
  });

  it("keeps unknown email and wrong password existence-hidden", async () => {
    await expect(login(transportFor({
      ok: false,
      status: 404,
      json: { code: "NOT_FOUND_OR_FORBIDDEN" },
    }), "missing@example.com", "bad")).resolves.toBeNull();
  });

  it("restores identity only through GET /auth/session", async () => {
    const transport = transportFor({ ok: true, status: 200, json: activeIdentity() });
    await expect(getAuthSession(transport)).resolves.toMatchObject({ accountId: "7" });
    expect(transport.request).toHaveBeenCalledWith("GET", "/api/v1/auth/session");

    const compatibility = transportFor({ ok: true, status: 200, json: activeIdentity() });
    await expect(refresh(compatibility)).resolves.toMatchObject({ nextStep: "ACTIVE" });
    expect(compatibility.request).toHaveBeenCalledWith("GET", "/api/v1/auth/session");
  });

  it("loads first-use setup and completes every supported challenge method", async () => {
    const challenge = "b".repeat(43);
    const setup = transportFor({
      ok: true,
      status: 200,
      json: {
        manualKey: "ABCDEFGHIJKLMNOP",
        provisioningUri: "otpauth://totp/Virtual%20Companion:alice",
        qrCodeDataUrl: "data:image/png;base64,abc",
      },
    });
    await expect(getAuthenticatorSetup(setup, challenge)).resolves.toMatchObject({
      manualKey: "ABCDEFGHIJKLMNOP",
    });
    expect(setup.request).toHaveBeenCalledWith(
      "POST",
      `/api/v1/auth/challenges/${challenge}/authenticator-setup`,
    );

    for (const [request, endpoint] of [
      [confirmAuthenticator, "authenticator-confirm"],
      [verifyAuthenticatorCode, "totp"],
      [verifyRecoveryCode, "recovery-code"],
    ] as const) {
      const transport = transportFor({
        ok: true,
        status: 200,
        json: activeIdentity(endpoint === "authenticator-confirm" ? ["ABCD-EFGH-IJKL-MNOP"] : undefined),
      });
      await expect(request(transport, challenge, "123456", true)).resolves.toMatchObject({
        nextStep: "ACTIVE",
      });
      expect(transport.request).toHaveBeenCalledWith(
        "POST",
        `/api/v1/auth/challenges/${challenge}/${endpoint}`,
        { code: "123456", trustDevice: true },
      );
    }
  });

  it("lists and revokes opaque sessions and trusted devices", async () => {
    const sessions = transportFor({
      ok: true,
      status: 200,
      json: [{ id: "11", createdAt: "c", expiresAt: "e", current: true }],
    });
    await expect(listAuthSessions(sessions)).resolves.toHaveLength(1);

    const devices = transportFor({
      ok: true,
      status: 200,
      json: [{ id: "3", displayName: "当前设备", createdAt: "c", lastUsedAt: "l", expiresAt: "e" }],
    });
    await expect(listTrustedDevices(devices)).resolves.toEqual([{
      id: "3",
      displayName: "当前设备",
      createdAt: "c",
      lastUsedAt: "l",
      expiresAt: "e",
    }]);

    const ok = transportFor({ ok: true, status: 200, json: { ok: true } });
    await expect(revokeAuthSession(ok, "11")).resolves.toBe(true);
    await expect(revokeTrustedDevice(ok, "3")).resolves.toBe(true);
    await expect(revokeAllAuthSessions(transportFor({
      ok: true,
      status: 200,
      json: { revoked: 2 },
    }))).resolves.toBe(2);
  });

  it("supports logout, password, reauthentication, deletion and survey", async () => {
    const ok = transportFor({ ok: true, status: 200, json: { ok: true, accepted: true } });
    await expect(logout(ok)).resolves.toBe(true);
    await expect(changeAuthPassword(ok, "old", "new-password")).resolves.toBe(true);
    await expect(reauthAuth(ok, "current-password")).resolves.toBe(true);
    await expect(deleteAccount(ok, "Current-Pass-1!")).resolves.toBe(true);
    await expect(recordSurvey(ok, 5)).resolves.toBe(true);
  });
});
