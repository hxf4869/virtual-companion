import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAuthenticatedTransport } from "@/api/transport";

describe("createAuthenticatedTransport", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", undefined);
  });

  it("injects the Bearer token and JSON-encodes the body", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const transport = createAuthenticatedTransport({
      getAccessToken: () => "a-token",
      onUnauthorized: vi.fn(),
    });

    await transport.request("POST", "/api/v1/auth/logout", { refreshToken: "r" });

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/auth/logout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer a-token",
      },
      body: JSON.stringify({ refreshToken: "r" }),
    });
  });

  it("omits the Authorization header when there is no token", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const transport = createAuthenticatedTransport({
      getAccessToken: () => null,
      onUnauthorized: vi.fn(),
    });

    await transport.request("GET", "/api/v1/version");

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/version", {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      body: undefined,
    });
  });

  it("routes a 401 to the auth store and still returns the non-OK result", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ code: "AUTHENTICATION_REQUIRED", message: "expired" }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const onUnauthorized = vi.fn();

    const transport = createAuthenticatedTransport({
      getAccessToken: () => "expired-token",
      onUnauthorized,
    });

    const result = await transport.request("GET", "/api/v1/generations/1/snapshot");

    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
  });

  it("does not call onUnauthorized for a 404 (existence hidden, not a session failure)", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => ({ code: "NOT_FOUND_OR_FORBIDDEN", message: "hidden" }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const onUnauthorized = vi.fn();

    const transport = createAuthenticatedTransport({
      getAccessToken: () => "a-token",
      onUnauthorized,
    });

    await transport.request("GET", "/api/v1/memories/1");

    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("tolerates a non-JSON response body", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => Promise.reject(new Error("not json")),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const transport = createAuthenticatedTransport({
      getAccessToken: () => null,
      onUnauthorized: vi.fn(),
    });

    const result = await transport.request("GET", "/api/v1/version");

    expect(result.json).toBeNull();
  });
});
