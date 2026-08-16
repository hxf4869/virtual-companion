import { describe, expect, it, vi } from "vitest";

import {
  createAccount,
  disableAccount,
  listAccounts,
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

describe("listAccounts/disableAccount (ADMIN-ACCTS)", () => {
  it("lists the account registry on OK", async () => {
    const t = transportFor({
      ok: true,
      status: 200,
      json: [
        { accountId: "1", username: "root", role: "ADMIN", status: "ACTIVE", displayName: "Root" },
        { accountId: "7", username: "alice", role: "USER", status: "DISABLED", displayName: "Alice" },
      ],
    });

    const list = await listAccounts(t);

    expect(list).toHaveLength(2);
    expect(list[0].username).toBe("root");
    expect(list[1].status).toBe("DISABLED");
    expect(t.request).toHaveBeenCalledWith("GET", "/api/v1/auth/admin/accounts");
  });

  it("throws a typed error on a non-OK registry read", async () => {
    const t = transportFor({ ok: false, status: 403, json: null });

    await expect(listAccounts(t)).rejects.toMatchObject({ status: 403 });
  });

  it("POSTs the disable action and reports true on OK", async () => {
    const t = transportFor({
      ok: true,
      status: 200,
      json: { accountId: "7", status: "DISABLED" },
    });

    expect(await disableAccount(t, "7")).toBe(true);
    expect(t.request).toHaveBeenCalledWith(
      "POST",
      "/api/v1/auth/admin/accounts/7/disable",
    );
  });

  it("maps 403/404 to false (existence never disclosed)", async () => {
    const t403 = transportFor({ ok: false, status: 403, json: null });
    expect(await disableAccount(t403, "999")).toBe(false);

    const t404 = transportFor({ ok: false, status: 404, json: null });
    expect(await disableAccount(t404, "999")).toBe(false);
  });

  it("throws a typed error on a 5xx disable", async () => {
    const t = transportFor({ ok: false, status: 500, json: null });

    await expect(disableAccount(t, "7")).rejects.toMatchObject({ status: 500 });
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
