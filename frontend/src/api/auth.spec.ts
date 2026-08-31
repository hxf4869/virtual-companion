import { describe, expect, it, vi } from "vitest";

import {
  changeAuthPassword,
  deleteAccount,
  listAuthSessions,
  login,
  logout,
  reauthAuth,
  recordSurvey,
  refresh,
  revokeAllAuthSessions,
  revokeAuthSession,
  type AuthApiResponse,
  type AuthTransport,
} from "@/api/auth";

function transportFor(response: AuthApiResponse): AuthTransport {
  return { request: vi.fn(async () => response) };
}

describe("Go Runtime auth client", () => {
  it("parses a confirmed login without accepting token fields from the body", async () => {
    const transport = transportFor({
      ok: true,
      status: 200,
      json: {
        accessToken: "must-ignore",
        refreshToken: "must-ignore",
        expiresInSeconds: 604800,
        accountId: "7",
        role: "ADMIN",
        passwordMustChange: true,
      },
    });

    const identity = await login(transport, "root", "pw");

    expect(identity).toEqual({
      expiresInSeconds: 604800,
      accountId: "7",
      role: "ADMIN",
      passwordMustChange: true,
    });
    expect(identity).not.toHaveProperty("accessToken");
    expect(identity).not.toHaveProperty("refreshToken");
    expect(transport.request).toHaveBeenCalledWith("POST", "/api/v1/auth/login", {
      username: "root",
      password: "pw",
    });
  });

  it("maps login rejection and malformed identity to null", async () => {
    await expect(login(transportFor({ ok: false, status: 401, json: null }), "root", "bad"))
      .resolves.toBeNull();
    await expect(login(transportFor({ ok: true, status: 200, json: { accountId: "7" } }), "root", "pw"))
      .resolves.toBeNull();
  });

  it("restores identity through GET /auth/sessions instead of a refresh endpoint", async () => {
    const transport = transportFor({
      ok: true,
      status: 200,
      json: [{
        id: "1",
        createdAt: "2026-01-01T00:00:00Z",
        expiresAt: "2026-01-08T00:00:00Z",
        current: true,
        accountId: "7",
        role: "USER",
        passwordMustChange: false,
      }],
    });

    await expect(refresh(transport)).resolves.toMatchObject({ accountId: "7", role: "USER" });
    expect(transport.request).toHaveBeenCalledWith("GET", "/api/v1/auth/sessions");
  });

  it("lists and revokes opaque sessions", async () => {
    const sessions = transportFor({
      ok: true,
      status: 200,
      json: [{ id: "11", createdAt: "c", expiresAt: "e", current: true }],
    });
    await expect(listAuthSessions(sessions)).resolves.toEqual([{
      id: "11",
      familyId: undefined,
      clientLabel: undefined,
      createdAt: "c",
      lastSeenAt: "c",
      expiresAt: "e",
      current: true,
      accountId: undefined,
      role: undefined,
      passwordMustChange: undefined,
    }]);

    const revoke = transportFor({ ok: true, status: 200, json: { ok: true } });
    await expect(revokeAuthSession(revoke, "11")).resolves.toBe(true);
    expect(revoke.request).toHaveBeenCalledWith("DELETE", "/api/v1/auth/sessions/11");
    await expect(revokeAllAuthSessions(transportFor({
      ok: true,
      status: 200,
      json: { revoked: 2 },
    }))).resolves.toBe(2);
  });

  it("supports logout, password change and fresh reauthentication", async () => {
    const ok = transportFor({ ok: true, status: 200, json: { ok: true } });
    await expect(logout(ok)).resolves.toBe(true);
    await expect(changeAuthPassword(ok, "old", "new-password")).resolves.toBe(true);
    await expect(reauthAuth(ok, "current-password")).resolves.toBe(true);
  });

  it("deletes only the caller account with the freshly entered password", async () => {
    const transport = transportFor({ ok: true, status: 200, json: { ok: true } });
    await expect(deleteAccount(transport, "Current-Pass-1!")).resolves.toBe(true);
    expect(transport.request).toHaveBeenCalledWith(
      "DELETE",
      "/api/v1/auth/account",
      { currentPassword: "Current-Pass-1!" },
    );
  });

  it("records the daily survey only when the Go endpoint confirms acceptance", async () => {
    const accepted = transportFor({ ok: true, status: 200, json: { accepted: true } });
    await expect(recordSurvey(accepted, 5)).resolves.toBe(true);
    expect(accepted.request).toHaveBeenCalledWith("POST", "/api/v1/survey", { score: 5 });
  });
});
