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

  it("sends credentials and the CSRF header on state changes, without Bearer", async () => {
    const fetchMock = fetchOk();
    vi.stubGlobal("fetch", fetchMock);

    const transport = createAuthenticatedTransport({
      onUnauthorized: vi.fn(),
    });

    await transport.request("POST", "/api/v1/auth/logout");

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/auth/logout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": "csrf-token-123",
      },
      credentials: "include",
      body: undefined,
    });
  });

  it("does not inject the Authorization header", async () => {
    const fetchMock = fetchOk();
    vi.stubGlobal("fetch", fetchMock);

    const transport = createAuthenticatedTransport({
      getAccessToken: () => "must-not-be-sent",
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
      onUnauthorized,
    });

    await transport.request("GET", "/api/v1/memories/1");

    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("does not replay or call refresh after a 401", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ code: "AUTHENTICATION_REQUIRED" }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const renewAccessToken = vi.fn(async (): Promise<"renewed"> => "renewed");
    const onUnauthorized = vi.fn();

    const transport = createAuthenticatedTransport({
      renewAccessToken,
      onUnauthorized,
    });

    await transport.request("GET", "/api/v1/conversations");

    expect(renewAccessToken).not.toHaveBeenCalled();
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("tolerates a non-JSON response body", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => Promise.reject(new Error("not json")),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const transport = createAuthenticatedTransport({
      onUnauthorized: vi.fn(),
    });

    const result = await transport.request("GET", "/api/v1/version");

    expect(result.json).toBeNull();
    expect(result.parseFailed).toBe(true);
  });

  it("marks a valid JSON response as parsed", async () => {
    const fetchMock = fetchOk();
    vi.stubGlobal("fetch", fetchMock);
    const transport = createAuthenticatedTransport({ onUnauthorized: vi.fn() });

    const result = await transport.request("GET", "/api/v1/version");

    expect(result.json).toEqual({ ok: true });
    expect(result.parseFailed).toBe(false);
  });
});
