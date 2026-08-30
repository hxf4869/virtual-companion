// @vitest-environment happy-dom
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

  it("injects CSRF and credentials on state changes without Bearer", async () => {
    const fetchMock = fetchSequence([200]);
    vi.stubGlobal("fetch", fetchMock);

    const authed = createAuthedFetch(() => "must-not-be-sent");
    await authed("/api/v1/realtime/streams/1", { method: "POST" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/v1/realtime/streams/1");
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("include");
    const headers = init?.headers as Headers;
    expect(headers.get("Authorization")).toBeNull();
    expect(headers.get("X-CSRF-Token")).toBe("csrf-token-123");
  });

  it("routes a 401 to onUnauthorized without a refresh replay", async () => {
    const fetchMock = fetchSequence([401, 200]);
    vi.stubGlobal("fetch", fetchMock);
    const renewAccessToken = vi.fn(async () => "renewed" as const);
    const onUnauthorized = vi.fn();

    const authed = createAuthedFetch(() => "a-token", { renewAccessToken, onUnauthorized });
    const result = await authed("/api/v1/generations/10/snapshot");

    expect(result.status).toBe(401);
    expect(renewAccessToken).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });
});
