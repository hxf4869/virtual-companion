import { describe, expect, it, vi } from "vitest";

import { login, logout, refresh, type AuthApiResponse, type AuthTransport } from "@/api/auth";

function transportFor(response: AuthApiResponse): AuthTransport {
  return { request: vi.fn(async () => response) };
}

describe("auth api client", () => {
  it("parses a confirmed login into tokens", async () => {
    const t = transportFor({
      ok: true,
      status: 200,
      json: {
        accessToken: "a-token",
        refreshToken: "r-token",
        tokenType: "Bearer",
        expiresInSeconds: 7200,
        accountId: "7",
        role: "ADMIN",
      },
    });

    const tokens = await login(t, "root", "pw");

    expect(tokens).toEqual({
      accessToken: "a-token",
      refreshToken: "r-token",
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

  it("parses a refresh and sends only the raw refresh token", async () => {
    const t = transportFor({
      ok: true,
      status: 200,
      json: {
        accessToken: "a-2",
        refreshToken: "r-2",
        tokenType: "Bearer",
        expiresInSeconds: 7200,
        accountId: "7",
        role: "USER",
      },
    });

    const tokens = await refresh(t, "r-1");

    expect(tokens?.accessToken).toBe("a-2");
    expect(tokens?.refreshToken).toBe("r-2");
    expect(t.request).toHaveBeenCalledWith("POST", "/api/v1/auth/refresh", {
      refreshToken: "r-1",
    });
  });

  it("maps an invalid refresh to null", async () => {
    const t = transportFor({
      ok: false,
      status: 401,
      json: { code: "AUTHENTICATION_REQUIRED", message: "The refresh session is no longer valid" },
    });

    expect(await refresh(t, "stale")).toBeNull();
  });

  it("logout is true only on HTTP OK and revokes the raw token", async () => {
    const t = transportFor({ ok: true, status: 200, json: { ok: true } });

    expect(await logout(t, "r-1")).toBe(true);
    expect(t.request).toHaveBeenCalledWith("POST", "/api/v1/auth/logout", {
      refreshToken: "r-1",
    });
  });

  it("rejects a malformed token payload without crashing", async () => {
    const t = transportFor({ ok: true, status: 200, json: { accessToken: "x" } });

    expect(await login(t, "root", "pw")).toBeNull();
  });
});
