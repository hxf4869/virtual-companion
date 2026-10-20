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

  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  }

  it("calls onUnauthorized for a 401 when the session revision is unchanged", async () => {
    const gate = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn(() => gate.promise));
    const onUnauthorized = vi.fn();
    const authed = createAuthedFetch(() => "a-token", {
      onUnauthorized,
      getSessionRevision: () => 7,
    });

    const pending = authed("/api/v1/generations/10/snapshot");
    gate.resolve(response(401));
    const result = await pending;

    expect(result.status).toBe(401);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("ignores a 401 from an older session revision and still returns the response", async () => {
    const gate = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn(() => gate.promise));
    const onUnauthorized = vi.fn();
    let revision = 1;
    const authed = createAuthedFetch(() => "a-token", {
      onUnauthorized,
      getSessionRevision: () => revision,
    });

    const pending = authed("/api/v1/account/export");
    revision = 2; // a new login landed while the old request was in flight
    gate.resolve(response(401));
    const result = await pending;

    expect(result.status).toBe(401);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("re-captures the revision on each call of the same factory", async () => {
    const firstGate = deferred<Response>();
    const secondGate = deferred<Response>();
    const gates = [firstGate, secondGate];
    vi.stubGlobal("fetch", vi.fn(() => gates.shift()!.promise));
    const onUnauthorized = vi.fn();
    let revision = 1;
    const authed = createAuthedFetch(() => "a-token", {
      onUnauthorized,
      getSessionRevision: () => revision,
    });

    const firstCall = authed("/api/v1/account/export");
    revision = 2; // new session generation while the old request is in flight
    firstGate.resolve(response(401));
    await firstCall;
    expect(onUnauthorized).not.toHaveBeenCalled();

    const secondCall = authed("/api/v1/account/export"); // same factory, new generation
    secondGate.resolve(response(401));
    const result = await secondCall;

    expect(result.status).toBe(401);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("still calls onUnauthorized on a 401 when the session provides no revision reader", async () => {
    const gate = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn(() => gate.promise));
    const onUnauthorized = vi.fn();
    const authed = createAuthedFetch(() => "a-token", { onUnauthorized });

    const pending = authed("/api/v1/realtime/streams/1");
    gate.resolve(response(401));
    const result = await pending;

    expect(result.status).toBe(401);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });
});
