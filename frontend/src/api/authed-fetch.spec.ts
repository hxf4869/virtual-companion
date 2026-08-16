// @vitest-environment happy-dom
// TASK-0186 + RT-REVIVE: authenticated fetch wrapper tests. Verifies the
// Bearer/CSRF/credentials injection shared by every realtime HTTP call, plus
// the silent-refresh behavior: a 401 triggers exactly one renew + replay,
// the replay never renews again, a rejected refresh signs the caller out, an
// unavailable refresh leaves the original response untouched, and non-401
// statuses never touch the session.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAuthedFetch } from "@/api/authed-fetch";

function response(status: number) {
  return { ok: status < 400, status, json: async () => null } as Response;
}

function fetchSequence(statuses: number[]) {
  let index = 0;
  return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
    const status = statuses[Math.min(index, statuses.length - 1)];
    index += 1;
    return response(status);
  });
}

describe("createAuthedFetch", () => {
  beforeEach(() => {
    vi.stubGlobal("document", { cookie: "vc_csrf=csrf-token-123" });
  });

  it("injects Bearer, credentials and the CSRF header on state changes", async () => {
    const fetchMock = fetchSequence([200]);
    vi.stubGlobal("fetch", fetchMock);

    const authed = createAuthedFetch(() => "a-token");
    await authed("/api/v1/realtime/tickets", { method: "POST" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/v1/realtime/tickets");
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("include");
    const headers = init?.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer a-token");
    expect(headers.get("X-CSRF-Token")).toBe("csrf-token-123");
  });

  it("returns a 401 untouched when no session is attached", async () => {
    const fetchMock = fetchSequence([401]);
    vi.stubGlobal("fetch", fetchMock);

    const authed = createAuthedFetch(() => "a-token");
    const result = await authed("/api/v1/realtime/tickets", { method: "POST" });

    expect(result.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("renews once and replays on a 401 when the refresh succeeds", async () => {
    const fetchMock = fetchSequence([401, 200]);
    vi.stubGlobal("fetch", fetchMock);
    const renewAccessToken = vi.fn(async () => "renewed" as const);
    const onUnauthorized = vi.fn();

    const authed = createAuthedFetch(() => "a-token", { renewAccessToken, onUnauthorized });
    const result = await authed("/api/v1/generations/10/snapshot");

    expect(result.status).toBe(200);
    expect(renewAccessToken).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("does not renew again when the replayed request is still a 401", async () => {
    const fetchMock = fetchSequence([401, 401]);
    vi.stubGlobal("fetch", fetchMock);
    const renewAccessToken = vi.fn(async () => "renewed" as const);
    const onUnauthorized = vi.fn();

    const authed = createAuthedFetch(() => "a-token", { renewAccessToken, onUnauthorized });
    const result = await authed("/api/v1/realtime/tickets", { method: "POST" });

    expect(result.status).toBe(401);
    expect(renewAccessToken).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("signs the caller out when the refresh is rejected and returns the 401", async () => {
    const fetchMock = fetchSequence([401]);
    vi.stubGlobal("fetch", fetchMock);
    const renewAccessToken = vi.fn(async () => "rejected" as const);
    const onUnauthorized = vi.fn();

    const authed = createAuthedFetch(() => "a-token", { renewAccessToken, onUnauthorized });
    const result = await authed("/api/v1/generations/10/snapshot");

    expect(result.status).toBe(401);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("leaves the 401 untouched when the refresh is unavailable", async () => {
    const fetchMock = fetchSequence([401]);
    vi.stubGlobal("fetch", fetchMock);
    const renewAccessToken = vi.fn(async () => "unavailable" as const);
    const onUnauthorized = vi.fn();

    const authed = createAuthedFetch(() => "a-token", { renewAccessToken, onUnauthorized });
    const result = await authed("/api/v1/generations/10/snapshot");

    expect(result.status).toBe(401);
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never touches the session for non-401 statuses", async () => {
    const fetchMock = fetchSequence([403, 404, 500]);
    vi.stubGlobal("fetch", fetchMock);
    const renewAccessToken = vi.fn(async () => "renewed" as const);
    const onUnauthorized = vi.fn();

    const authed = createAuthedFetch(() => "a-token", { renewAccessToken, onUnauthorized });
    await authed("/api/v1/realtime/tickets", { method: "POST" });
    await authed("/api/v1/generations/1/snapshot");
    await authed("/api/v1/realtime/streams/1");

    expect(renewAccessToken).not.toHaveBeenCalled();
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});
