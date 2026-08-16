import { describe, expect, it, vi } from "vitest";

import {
  createAccount,
  login,
  logout,
  refresh,
  type AuthApiResponse,
  type AuthTransport,
} from "@/api/auth";

function transportFor(response: AuthApiResponse): AuthTransport {
  return { request: vi.fn(async () => response) };
}

describe("auth api client", () => {
  it("parses a confirmed login into tokens (no refreshToken in the response body)", async () => {
    const t = transportFor({
      ok: true,
      status: 200,
      json: {
        accessToken: "a-token",
        tokenType: "Bearer",
        expiresInSeconds: 7200,
        accountId: "7",
        role: "ADMIN",
      },
    });

    const tokens = await login(t, "root", "pw");

    expect(tokens).toEqual({
      accessToken: "a-token",
      tokenType: "Bearer",
      expiresInSeconds: 7200,
      accountId: "7",
      role: "ADMIN",
    });
    expect(t.request).toHaveBeenCalledWith("POST", "/api/v1/auth/login", {
      username: "root",
      password: "pw",
    });
  });

  it("tolerates a legacy response body that still carries refreshToken (ignored)", async () => {
    const t = transportFor({
      ok: true,
      status: 200,
      json: {
        accessToken: "a-token",
        refreshToken: "r-token",
        tokenType: "Bearer",
        expiresInSeconds: 7200,
        accountId: "7",
        role: "USER",
      },
    });

    const tokens = await login(t, "root", "pw");

    expect(tokens?.accessToken).toBe("a-token");
    expect(tokens).not.toHaveProperty("refreshToken");
  });

  it("maps a non-OK login to null (existence never disclosed)", async () => {
    const t = transportFor({
      ok: false,
      status: 404,
      json: { code: "NOT_FOUND_OR_FORBIDDEN", message: "Invalid username or password" },
    });

    expect(await login(t, "root", "wrong")).toBeNull();
  });

  it("maps a disabled-account login to null (fail closed)", async () => {
    const t = transportFor({
      ok: false,
      status: 401,
      json: { code: "AUTHENTICATION_REQUIRED", message: "Account is disabled" },
    });

    expect(await login(t, "root", "pw")).toBeNull();
  });

  it("propagates a transport failure instead of faking success", async () => {
    const t: AuthTransport = { request: vi.fn(async () => Promise.reject(new Error("offline"))) };

    await expect(login(t, "root", "pw")).rejects.toThrow("offline");
  });

  it("refresh sends no body and no token argument (cookie-based)", async () => {
    const t = transportFor({
      ok: true,
      status: 200,
      json: {
        accessToken: "a-2",
        tokenType: "Bearer",
        expiresInSeconds: 7200,
        accountId: "7",
        role: "USER",
      },
    });

    const tokens = await refresh(t);

    expect(tokens?.accessToken).toBe("a-2");
    expect(tokens).not.toHaveProperty("refreshToken");
    expect(t.request).toHaveBeenCalledWith("POST", "/api/v1/auth/refresh");
  });

  it("maps an invalid refresh to null", async () => {
    const t = transportFor({
      ok: false,
      status: 401,
      json: { code: "AUTHENTICATION_REQUIRED", message: "The refresh session is no longer valid" },
    });

    expect(await refresh(t)).toBeNull();
  });

  it("logout is true only on HTTP OK and sends no body (cookie-based)", async () => {
    const t = transportFor({ ok: true, status: 200, json: { ok: true } });

    expect(await logout(t)).toBe(true);
    expect(t.request).toHaveBeenCalledWith("POST", "/api/v1/auth/logout");
  });

  it("rejects a malformed token payload without crashing", async () => {
    const t = transportFor({ ok: true, status: 200, json: { accessToken: "x" } });

    expect(await login(t, "root", "pw")).toBeNull();
  });
});

describe("createAccount (ADMIN-UI)", () => {
  it("POSTs the account body and parses the created account", async () => {
    const t = transportFor({
      ok: true,
      status: 200,
      json: { accountId: "9", username: "alice", role: "USER", status: "ACTIVE" },
    });

    const created = await createAccount(t, "alice", "pw-1", "Alice", "USER");

    expect(created).toEqual({
      accountId: "9",
      username: "alice",
      role: "USER",
      status: "ACTIVE",
    });
    expect(t.request).toHaveBeenCalledWith("POST", "/api/v1/auth/admin/accounts", {
      username: "alice",
      password: "pw-1",
      displayName: "Alice",
      role: "USER",
    });
  });

  it("maps a non-OK response to null (existence never disclosed)", async () => {
    const t = transportFor({
      ok: false,
      status: 404,
      json: { code: "NOT_FOUND_OR_FORBIDDEN", message: "hidden" },
    });

    expect(await createAccount(t, "alice", "pw-1", "Alice", "USER")).toBeNull();
  });

  it("maps a non-admin denial to null", async () => {
    const t = transportFor({
      ok: false,
      status: 403,
      json: { code: "ACCESS_DENIED", message: "admin only" },
    });

    expect(await createAccount(t, "alice", "pw-1", "Alice", "USER")).toBeNull();
  });

  it("rejects a malformed account payload without crashing", async () => {
    const t = transportFor({ ok: true, status: 200, json: { accountId: "9" } });

    expect(await createAccount(t, "alice", "pw-1", "Alice", "USER")).toBeNull();
  });
});
