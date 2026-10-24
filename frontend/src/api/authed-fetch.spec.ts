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

  it("VC-R169: 会话对象提供编号时认证请求携带会话前置头", async () => {
    const fetchMock = fetchSequence([200, 200]);
    vi.stubGlobal("fetch", fetchMock);

    const authed = createAuthedFetch(() => "must-not-be-sent", {
      getSessionRevision: () => 1,
      getAccountId: () => "7",
      getSessionId: () => "42",
      onUnauthorized: vi.fn(),
    });
    await authed("/api/v1/exports", { method: "POST" });
    const writeHeaders = (fetchMock.mock.calls[0][1] as RequestInit).headers as Headers;
    expect(writeHeaders.get("X-VC-Expected-Account-ID")).toBe("7");
    expect(writeHeaders.get("X-VC-Expected-Session-ID")).toBe("42");

    await authed("/api/v1/exports/exp-1/download");
    const readHeaders = (fetchMock.mock.calls[1][1] as RequestInit).headers as Headers;
    expect(readHeaders.get("X-VC-Expected-Session-ID")).toBe("42");
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

    const authed = createAuthedFetch(() => "a-token", { renewAccessToken, getSessionId: () => null, onUnauthorized });
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
      getSessionId: () => null,
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
      getSessionId: () => null,
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
      getSessionId: () => null,
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
    const authed = createAuthedFetch(() => "a-token", { getSessionId: () => null, onUnauthorized });

    const pending = authed("/api/v1/realtime/streams/1");
    gate.resolve(response(401));
    const result = await pending;

    expect(result.status).toBe(401);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  // ---- VC-R52：期望账号前置条件头与失配 409 归属 ----

  function cloneableResponse(status: number, json: unknown) {
    const body = { json: async () => json };
    return {
      ok: status < 400,
      status,
      json: async () => json,
      clone: () => ({ ...body, json: async () => json }),
    } as unknown as Response;
  }

  function contextChanged409() {
    return cloneableResponse(409, { code: "ACCOUNT_CONTEXT_CHANGED", message: "mismatch" });
  }

  it("sends the expected-account header when the session knows the account", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      cloneableResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const authed = createAuthedFetch(() => null, {
      getAccountId: () => "42",
      getSessionId: () => "900",
      onUnauthorized: vi.fn(),
    });
    await authed("/api/v1/exports/1/download?token=one-time", { method: "GET" });

    const headers = fetchMock.mock.calls[0][1]?.headers as Headers;
    expect(headers.get("X-VC-Expected-Account-ID")).toBe("42");
    expect(headers.get("X-VC-Expected-Session-ID")).toBe("900");
  });

  it("omits the expected-account header when the session has no known account", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      cloneableResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const authed = createAuthedFetch(() => null, {
      getAccountId: () => null,
      getSessionId: () => null,
      onUnauthorized: vi.fn(),
    });
    await authed("/api/v1/exports/1/download?token=one-time", { method: "GET" });

    const headers = fetchMock.mock.calls[0][1]?.headers as Headers;
    expect(headers.get("X-VC-Expected-Account-ID")).toBeNull();
  });

  it("routes a precise 409 + ACCOUNT_CONTEXT_CHANGED to onAccountContextChanged and returns the response unchanged", async () => {
    const gate = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn(() => gate.promise));
    const onAccountContextChanged = vi.fn();

    const authed = createAuthedFetch(() => null, {
      getAccountId: () => "42",
      getSessionRevision: () => 7,
      getSessionId: () => null,
      onUnauthorized: vi.fn(),
      onAccountContextChanged,
    });

    const pending = authed("/api/v1/exports/1/download?token=one-time", { method: "GET" });
    gate.resolve(contextChanged409());
    const result = await pending;

    expect(onAccountContextChanged).toHaveBeenCalledTimes(1);
    // 调用方拿到的原始响应未被消费：正文仍可读，状态原样。
    expect(result.status).toBe(409);
    await expect(result.json()).resolves.toEqual({ code: "ACCOUNT_CONTEXT_CHANGED", message: "mismatch" });
  });

  it("ignores a context-changed 409 from an older session revision", async () => {
    const gate = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn(() => gate.promise));
    const onAccountContextChanged = vi.fn();
    let revision = 1;

    const authed = createAuthedFetch(() => null, {
      getAccountId: () => "42",
      getSessionRevision: () => revision,
      getSessionId: () => null,
      onUnauthorized: vi.fn(),
      onAccountContextChanged,
    });

    const pending = authed("/api/v1/exports/1/download?token=one-time", { method: "GET" });
    revision = 2; // reconcile/新登录已推进代次：旧意图迟到不得触碰较新会话。
    gate.resolve(contextChanged409());
    const result = await pending;

    expect(onAccountContextChanged).not.toHaveBeenCalled();
    expect(result.status).toBe(409);
  });

  it("only reacts to the exact code: other 409 bodies stay silent", async () => {
    const gate = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn(() => gate.promise));
    const onAccountContextChanged = vi.fn();

    const authed = createAuthedFetch(() => null, {
      getAccountId: () => "42",
      getSessionId: () => null,
      onUnauthorized: vi.fn(),
      onAccountContextChanged,
    });

    const pending = authed("/api/v1/exports/1/download?token=one-time", { method: "GET" });
    gate.resolve(cloneableResponse(409, { code: "EXPORT_CONFLICT" }));
    await pending;

    expect(onAccountContextChanged).not.toHaveBeenCalled();
  });

  it("never clones a successful response (stream bodies stay untouched)", async () => {
    const clone = vi.fn();
    const success = {
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
      clone,
    } as unknown as Response;
    vi.stubGlobal("fetch", vi.fn(async () => success));

    const authed = createAuthedFetch(() => null, {
      getAccountId: () => "42",
      getSessionId: () => null,
      onUnauthorized: vi.fn(),
      onAccountContextChanged: vi.fn(),
    });
    const result = await authed("/api/v1/realtime/streams/12", {
      method: "GET",
      headers: { Accept: "text/event-stream" },
    });

    expect(result.status).toBe(200);
    expect(clone).not.toHaveBeenCalled();
  });
});
