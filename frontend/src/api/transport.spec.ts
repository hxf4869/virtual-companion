import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAuthenticatedTransport } from "@/api/transport";

function fetchOk() {
  return vi.fn(async (_url: string, _init?: RequestInit) => ({
    ok: true,
    status: 200,
    json: async () => ({ ok: true }),
  }));
}

describe("createAuthenticatedTransport", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", undefined);
    vi.stubGlobal("document", { cookie: "vc_csrf=csrf-token-123" });
  });

  it("injects the Bearer token, sends credentials and the CSRF header on state changes", async () => {
    const fetchMock = fetchOk();
    vi.stubGlobal("fetch", fetchMock);

    const transport = createAuthenticatedTransport({
      getAccessToken: () => "a-token",
      onUnauthorized: vi.fn(),
    });

    await transport.request("POST", "/api/v1/auth/logout");

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/auth/logout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer a-token",
        "X-CSRF-Token": "csrf-token-123",
      },
      credentials: "include",
      body: undefined,
    });
  });

  it("omits the Authorization header when there is no token", async () => {
    const fetchMock = fetchOk();
    vi.stubGlobal("fetch", fetchMock);

    const transport = createAuthenticatedTransport({
      getAccessToken: () => null,
      onUnauthorized: vi.fn(),
    });

    await transport.request("GET", "/api/v1/version");

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/version", {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: undefined,
    });
  });

  it("does not inject the CSRF header on safe methods (GET/HEAD/OPTIONS)", async () => {
    const fetchMock = fetchOk();
    vi.stubGlobal("fetch", fetchMock);

    const transport = createAuthenticatedTransport({
      getAccessToken: () => "a-token",
      onUnauthorized: vi.fn(),
    });

    await transport.request("GET", "/api/v1/generations/1/snapshot");

    expect(fetchMock.mock.calls[0]![1]!.headers).not.toHaveProperty("X-CSRF-Token");
  });

  it("REQ-ID: records X-Request-Id from the response header", async () => {
    const { lastRequestId, rememberRequestId } = await import("@/domain/request-id");
    rememberRequestId(null);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: { get: (name: string) => (name === "X-Request-Id" ? "req-wire-1" : null) },
        json: async () => ({ ok: true }),
      })),
    );
    const transport = createAuthenticatedTransport({
      getAccessToken: () => "a-token",
      onUnauthorized: vi.fn(),
    });
    await transport.request("GET", "/api/v1/version");
    expect(lastRequestId()).toBe("req-wire-1");
    rememberRequestId(null);
  });

  it("does not inject the CSRF header when the vc_csrf cookie is absent", async () => {
    vi.stubGlobal("document", { cookie: "other=value" });
    const fetchMock = fetchOk();
    vi.stubGlobal("fetch", fetchMock);

    const transport = createAuthenticatedTransport({
      getAccessToken: () => null,
      onUnauthorized: vi.fn(),
    });

    await transport.request("POST", "/api/v1/auth/logout");

    expect(fetchMock.mock.calls[0]![1]!.headers).not.toHaveProperty("X-CSRF-Token");
    expect(fetchMock.mock.calls[0]![1]!.credentials).toBe("include");
  });

  it("does not inject the CSRF header when document is unavailable (SSR/non-browser)", async () => {
    vi.stubGlobal("document", undefined);
    const fetchMock = fetchOk();
    vi.stubGlobal("fetch", fetchMock);

    const transport = createAuthenticatedTransport({
      getAccessToken: () => null,
      onUnauthorized: vi.fn(),
    });

    await transport.request("POST", "/api/v1/auth/logout");

    expect(fetchMock.mock.calls[0]![1]!.headers).not.toHaveProperty("X-CSRF-Token");
  });

  it("tolerates a malformed CSRF cookie value without crashing", async () => {
    vi.stubGlobal("document", { cookie: "vc_csrf=%" });
    const fetchMock = fetchOk();
    vi.stubGlobal("fetch", fetchMock);

    const transport = createAuthenticatedTransport({
      getAccessToken: () => null,
      onUnauthorized: vi.fn(),
    });

    await transport.request("POST", "/api/v1/auth/logout");

    expect(fetchMock.mock.calls[0]![1]!.headers).not.toHaveProperty("X-CSRF-Token");
  });

  it("routes a 401 to the auth store and still returns the non-OK result", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
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
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
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

  it("SESS-REVIVE: replays the request once after a successful silent refresh", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => ({
        ok: false,
        status: 401,
        json: async () => ({ code: "AUTHENTICATION_REQUIRED" }),
      }))
      .mockImplementationOnce(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      }));
    vi.stubGlobal("fetch", fetchMock);
    const renewAccessToken = vi.fn(async (): Promise<"renewed"> => "renewed");
    const onUnauthorized = vi.fn();

    const transport = createAuthenticatedTransport({
      getAccessToken: () => "fresh-token",
      renewAccessToken,
      onUnauthorized,
    });

    const result = await transport.request("GET", "/api/v1/conversations");

    expect(renewAccessToken).toHaveBeenCalledTimes(1);
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2); // original 401 + replay
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
  });

  it("SESS-REVIVE: a rejected refresh clears and redirects without a replay", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ code: "AUTHENTICATION_REQUIRED" }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const renewAccessToken = vi.fn(async (): Promise<"rejected"> => "rejected");
    const onUnauthorized = vi.fn();

    const transport = createAuthenticatedTransport({
      getAccessToken: () => "expired-token",
      renewAccessToken,
      onUnauthorized,
    });

    const result = await transport.request("GET", "/api/v1/conversations");

    expect(renewAccessToken).toHaveBeenCalledTimes(1);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1); // no replay
    expect(result.ok).toBe(false);
  });

  it("SESS-REVIVE: an unavailable refresh (network) returns the 401 without kicking the user", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ code: "AUTHENTICATION_REQUIRED" }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const renewAccessToken = vi.fn(async (): Promise<"unavailable"> => "unavailable");
    const onUnauthorized = vi.fn();

    const transport = createAuthenticatedTransport({
      getAccessToken: () => "expired-token",
      renewAccessToken,
      onUnauthorized,
    });

    const result = await transport.request("GET", "/api/v1/conversations");

    expect(renewAccessToken).toHaveBeenCalledTimes(1);
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
  });

  it("SESS-REVIVE: never replays the refresh endpoint itself (no recursion)", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ code: "AUTHENTICATION_REQUIRED" }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const renewAccessToken = vi.fn(async (): Promise<"renewed"> => "renewed");
    const onUnauthorized = vi.fn();

    const transport = createAuthenticatedTransport({
      getAccessToken: () => "expired-token",
      renewAccessToken,
      onUnauthorized,
    });

    await transport.request("POST", "/api/v1/auth/refresh");

    expect(renewAccessToken).not.toHaveBeenCalled();
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("SESS-REVIVE: a replay that 401s again falls through to onUnauthorized exactly once", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ code: "AUTHENTICATION_REQUIRED" }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const renewAccessToken = vi.fn(async (): Promise<"renewed"> => "renewed");
    const onUnauthorized = vi.fn();

    const transport = createAuthenticatedTransport({
      getAccessToken: () => "still-expired",
      renewAccessToken,
      onUnauthorized,
    });

    await transport.request("GET", "/api/v1/conversations");

    expect(renewAccessToken).toHaveBeenCalledTimes(1);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2); // original + one replay, no storm
  });

  it("tolerates a non-JSON response body", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
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
