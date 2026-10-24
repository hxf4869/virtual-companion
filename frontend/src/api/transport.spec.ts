import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAuthenticatedTransport, TransportTimeoutError } from "@/api/transport";

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
      getSessionId: () => null,
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

  it("VC-R169: 认证页面身份同时携带账号与会话编号，发现流省略两者", async () => {
    const fetchMock = fetchOk();
    vi.stubGlobal("fetch", fetchMock);

    const transport = createAuthenticatedTransport({
      getAccountId: () => "7",
      getSessionId: () => "42",
      onUnauthorized: vi.fn(),
    });
    await transport.request("POST", "/api/v1/conversations", { incognito: false });
    const writeInit = fetchMock.mock.calls[0][1] as RequestInit;
    const writeHeaders = writeInit.headers as Record<string, string>;
    expect(writeHeaders["X-VC-Expected-Account-ID"]).toBe("7");
    expect(writeHeaders["X-VC-Expected-Session-ID"]).toBe("42");

    // GET 读也携带（读前置：缺省放行、有则匹配）。
    await transport.request("GET", "/api/v1/relationships");
    const readInit = fetchMock.mock.calls[1][1] as RequestInit;
    const readHeaders = readInit.headers as Record<string, string>;
    expect(readHeaders["X-VC-Expected-Session-ID"]).toBe("42");

    // 身份发现（omitExpectedAccount）：两个期望头都省略。
    await transport.request("GET", "/api/v1/auth/session", undefined, {
      callerHandlesUnauthorized: true,
      omitExpectedAccount: true,
    });
    const discoveryInit = fetchMock.mock.calls[2][1] as RequestInit;
    const discoveryHeaders = discoveryInit.headers as Record<string, string>;
    expect(discoveryHeaders["X-VC-Expected-Account-ID"]).toBeUndefined();
    expect(discoveryHeaders["X-VC-Expected-Session-ID"]).toBeUndefined();

    // 未确立身份（匿名页面）：两个头都不发。
    const anonymous = createAuthenticatedTransport({
      getAccountId: () => null,
      getSessionId: () => null,
      onUnauthorized: vi.fn(),
    });
    await anonymous.request("POST", "/api/v1/auth/login", { account: "a", password: "b" });
    const anonInit = fetchMock.mock.calls[3][1] as RequestInit;
    const anonHeaders = anonInit.headers as Record<string, string>;
    expect(anonHeaders["X-VC-Expected-Account-ID"]).toBeUndefined();
    expect(anonHeaders["X-VC-Expected-Session-ID"]).toBeUndefined();
  });

  it("does not inject the Authorization header", async () => {
    const fetchMock = fetchOk();
    vi.stubGlobal("fetch", fetchMock);

    const transport = createAuthenticatedTransport({
      getAccessToken: () => "must-not-be-sent",
      getSessionId: () => null,
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
      getSessionId: () => null,
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
      getSessionId: () => null,
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
      getSessionId: () => null,
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
      getSessionId: () => null,
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
      getSessionId: () => null,
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
      getSessionId: () => null,
      onUnauthorized,
    });

    const result = await transport.request("GET", "/api/v1/generations/1/snapshot");

    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
  });

  it("skips onUnauthorized for a 401 when the caller owns the unauthorized result", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: false,
      status: 401,
      json: async () => ({ code: "AUTHENTICATION_REQUIRED", message: "expired" }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const onUnauthorized = vi.fn();

    const transport = createAuthenticatedTransport({ getSessionId: () => null, onUnauthorized });

    const result = await transport.request("GET", "/api/v1/auth/session", undefined, {
      callerHandlesUnauthorized: true,
    });

    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);

    // The option does not change non-401 behavior: a 200 still parses normally.
    vi.stubGlobal("fetch", fetchOk());
    const okResult = await transport.request("GET", "/api/v1/version", undefined, {
      callerHandlesUnauthorized: true,
    });
    expect(okResult).toEqual({ ok: true, status: 200, json: { ok: true }, parseFailed: false });
  });

  it("skips onUnauthorized for a 401 on the timeoutMs path when the caller owns it", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: false,
      status: 401,
      json: async () => ({ code: "AUTHENTICATION_REQUIRED", message: "expired" }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const onUnauthorized = vi.fn();

    const transport = createAuthenticatedTransport({ getSessionId: () => null, onUnauthorized });

    const result = await transport.request("GET", "/api/v1/auth/session", undefined, {
      timeoutMs: 15_000,
      callerHandlesUnauthorized: true,
    });

    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);

    // The option does not change non-401 behavior on this path either.
    vi.stubGlobal("fetch", fetchOk());
    const okResult = await transport.request("GET", "/api/v1/version", undefined, {
      timeoutMs: 15_000,
      callerHandlesUnauthorized: true,
    });
    expect(okResult).toEqual({ ok: true, status: 200, json: { ok: true }, parseFailed: false });
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
      getSessionId: () => null,
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
      getSessionId: () => null,
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
      getSessionId: () => null,
      onUnauthorized: vi.fn(),
    });

    const result = await transport.request("GET", "/api/v1/version");

    expect(result.json).toBeNull();
    expect(result.parseFailed).toBe(true);
  });

  it("marks a valid JSON response as parsed", async () => {
    const fetchMock = fetchOk();
    vi.stubGlobal("fetch", fetchMock);
    const transport = createAuthenticatedTransport({ getSessionId: () => null, onUnauthorized: vi.fn() });

    const result = await transport.request("GET", "/api/v1/version");

    expect(result.json).toEqual({ ok: true });
    expect(result.parseFailed).toBe(false);
  });

  // ---- WP-D（缺口5）：per-request timeout ----

  it("aborts a request that exceeds the per-request timeout as a typed unknown", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
        new Promise<never>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
      );
      vi.stubGlobal("fetch", fetchMock);
      const transport = createAuthenticatedTransport({ getSessionId: () => null, onUnauthorized: vi.fn() });

      const pending = transport.request("GET", "/api/v1/conversations", undefined, {
        timeoutMs: 15_000,
      });
      const assertion = expect(pending).rejects.toBeInstanceOf(TransportTimeoutError);
      await vi.advanceTimersByTimeAsync(15_001);
      await assertion;
      expect(fetchMock.mock.calls[0]![1]!.signal).toBeDefined();
      // 缺陷10：fetch 失败路径同样清定时器，无泄漏。
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  // ---- 缺陷10：超时覆盖正文读取阶段 ----

  it("fails with a timeout when the response body never arrives after the headers", async () => {
    vi.useFakeTimers();
    try {
      // 服务器发完头（200）后正文流永不结束：response.json() 永久挂起。
      const fetchMock = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: () => new Promise<never>(() => undefined),
      }));
      vi.stubGlobal("fetch", fetchMock);
      const transport = createAuthenticatedTransport({ getSessionId: () => null, onUnauthorized: vi.fn() });

      const pending = transport.request("GET", "/api/v1/conversations", undefined, {
        timeoutMs: 15_000,
      });
      const assertion = expect(pending).rejects.toBeInstanceOf(TransportTimeoutError);
      await vi.advanceTimersByTimeAsync(15_001);
      await assertion;
      // 超时触发后定时器已清：挂起的正文读取不再持有任何计时资源。
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the timeout timer once the body has been read (no leak)", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal("fetch", fetchOk());
      const transport = createAuthenticatedTransport({ getSessionId: () => null, onUnauthorized: vi.fn() });

      await transport.request("GET", "/api/v1/version", undefined, { timeoutMs: 15_000 });
      // 正文已读完、定时器已清：推进远超超时点也不再触发任何中止。
      await vi.advanceTimersByTimeAsync(60_000);

      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts the hung body read on timeout without unhandled rejections", async () => {
    vi.useFakeTimers();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      let capturedSignal: AbortSignal | null | undefined;
      const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
        capturedSignal = init?.signal;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => new Promise<never>(() => undefined),
        });
      });
      vi.stubGlobal("fetch", fetchMock);
      const transport = createAuthenticatedTransport({ getSessionId: () => null, onUnauthorized: vi.fn() });

      const pending = transport.request("GET", "/api/v1/conversations", undefined, {
        timeoutMs: 15_000,
      });
      const assertion = expect(pending).rejects.toBeInstanceOf(TransportTimeoutError);
      await vi.advanceTimersByTimeAsync(15_001);
      await assertion;
      await vi.runAllTimersAsync();

      // 超时中止了整个请求链路（含挂起的 json()），且没有留下未处理的 rejection。
      expect(capturedSignal?.aborted).toBe(true);
      expect(unhandled).toHaveLength(0);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      vi.useRealTimers();
    }
  });

  it("does not abort within the per-request timeout and resolves normally", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal("fetch", fetchOk());
      const transport = createAuthenticatedTransport({ getSessionId: () => null, onUnauthorized: vi.fn() });

      const pending = transport.request("GET", "/api/v1/version", undefined, {
        timeoutMs: 15_000,
      });
      await vi.advanceTimersByTimeAsync(14_999);
      await expect(pending).resolves.toMatchObject({ ok: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("adds no AbortSignal when no per-request options are given (SSE-safe default path)", async () => {
    const fetchMock = fetchOk();
    vi.stubGlobal("fetch", fetchMock);
    const transport = createAuthenticatedTransport({ getSessionId: () => null, onUnauthorized: vi.fn() });

    await transport.request("GET", "/api/v1/version");

    expect(fetchMock.mock.calls[0]![1]!.signal).toBeUndefined();
  });

  // ---- 旧请求 401 跨代误登出（会话代次归属判定） ----

  function authRequired401() {
    return {
      ok: false,
      status: 401,
      json: async () => ({ code: "AUTHENTICATION_REQUIRED", message: "expired" }),
    };
  }

  function deferredFetch() {
    const resolvers: Array<(response: unknown) => void> = [];
    const fetchMock = vi.fn(
      (_url: string, _init?: RequestInit) =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );
    return { fetchMock, resolvers };
  }

  it("suppresses onUnauthorized for a stale-generation 401 on the plain path (session replaced mid-flight)", async () => {
    let revision = 1;
    const { fetchMock, resolvers } = deferredFetch();
    vi.stubGlobal("fetch", fetchMock);
    const onUnauthorized = vi.fn();

    const transport = createAuthenticatedTransport({
      getSessionId: () => null,
      getSessionRevision: () => revision,
      onUnauthorized,
    });

    const pending = transport.request("GET", "/api/v1/conversations");
    // 在途期间会话换代（B 新登录 / 清会话），旧请求的 401 属于上一代。
    revision = 2;
    resolvers[0]!(authRequired401());

    const result = await pending;
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
  });

  it("still calls onUnauthorized for a same-generation 401 on the plain path when getSessionRevision is provided", async () => {
    let revision = 1;
    const { fetchMock, resolvers } = deferredFetch();
    vi.stubGlobal("fetch", fetchMock);
    const onUnauthorized = vi.fn();

    const transport = createAuthenticatedTransport({
      getSessionId: () => null,
      getSessionRevision: () => revision,
      onUnauthorized,
    });

    const pending = transport.request("GET", "/api/v1/conversations");
    resolvers[0]!(authRequired401());

    const result = await pending;
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
  });

  it("suppresses onUnauthorized for a stale-generation 401 on the timeoutMs path", async () => {
    let revision = 1;
    const { fetchMock, resolvers } = deferredFetch();
    vi.stubGlobal("fetch", fetchMock);
    const onUnauthorized = vi.fn();

    const transport = createAuthenticatedTransport({
      getSessionId: () => null,
      getSessionRevision: () => revision,
      onUnauthorized,
    });

    const pending = transport.request("GET", "/api/v1/conversations", undefined, {
      timeoutMs: 15_000,
    });
    revision = 2;
    resolvers[0]!(authRequired401());

    const result = await pending;
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
  });

  it("still calls onUnauthorized for a same-generation 401 on the timeoutMs path when getSessionRevision is provided", async () => {
    let revision = 1;
    const { fetchMock, resolvers } = deferredFetch();
    vi.stubGlobal("fetch", fetchMock);
    const onUnauthorized = vi.fn();

    const transport = createAuthenticatedTransport({
      getSessionId: () => null,
      getSessionRevision: () => revision,
      onUnauthorized,
    });

    const pending = transport.request("GET", "/api/v1/conversations", undefined, {
      timeoutMs: 15_000,
    });
    resolvers[0]!(authRequired401());

    const result = await pending;
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
  });

  it("re-reads the revision per request on the same factory: a fresh-generation 401 still fires after a stale one was suppressed", async () => {
    let revision = 1;
    const { fetchMock, resolvers } = deferredFetch();
    vi.stubGlobal("fetch", fetchMock);
    const onUnauthorized = vi.fn();

    const transport = createAuthenticatedTransport({
      getSessionId: () => null,
      getSessionRevision: () => revision,
      onUnauthorized,
    });

    const stalePending = transport.request("GET", "/api/v1/conversations");
    revision = 2;
    resolvers[0]!(authRequired401());
    await stalePending;
    expect(onUnauthorized).not.toHaveBeenCalled();

    // 同一 factory 再次发起（新代下）：401 仍必须触发登出，证明代次捕获
    // 发生在每次 request() 调用而非工厂创建时。
    const freshPending = transport.request("GET", "/api/v1/conversations");
    resolvers[1]!(authRequired401());
    await freshPending;
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("keeps calling onUnauthorized unconditionally for a 401 when the provider has no getSessionRevision", async () => {
    const { fetchMock, resolvers } = deferredFetch();
    vi.stubGlobal("fetch", fetchMock);
    const onUnauthorized = vi.fn();

    const transport = createAuthenticatedTransport({
      getSessionId: () => null,
      onUnauthorized,
    });

    const pending = transport.request("GET", "/api/v1/conversations");
    resolvers[0]!(authRequired401());

    const result = await pending;
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
  });

  // ---- VC-R52：期望账号前置条件（X-VC-Expected-Account-ID） ----

  it("sends the expected-account header on every method when the account is known (reads included)", async () => {
    const fetchMock = fetchOk();
    vi.stubGlobal("fetch", fetchMock);

    const transport = createAuthenticatedTransport({
      getAccountId: () => "42",
      getSessionId: () => null,
      onUnauthorized: vi.fn(),
    });

    await transport.request("GET", "/api/v1/conversations");
    await transport.request("POST", "/api/v1/exports", { currentPassword: "x" });

    expect(fetchMock.mock.calls[0]![1]!.headers).toMatchObject({
      "X-VC-Expected-Account-ID": "42",
    });
    expect(fetchMock.mock.calls[1]![1]!.headers).toMatchObject({
      "X-VC-Expected-Account-ID": "42",
    });
  });

  it("omits the expected-account header when no account is known", async () => {
    const fetchMock = fetchOk();
    vi.stubGlobal("fetch", fetchMock);

    const transport = createAuthenticatedTransport({
      getAccountId: () => null,
      getSessionId: () => null,
      onUnauthorized: vi.fn(),
    });

    await transport.request("POST", "/api/v1/exports", { currentPassword: "x" });

    expect(fetchMock.mock.calls[0]![1]!.headers).not.toHaveProperty("X-VC-Expected-Account-ID");
  });

  it("omits the expected-account header when the caller opts out (identity discovery)", async () => {
    const fetchMock = fetchOk();
    vi.stubGlobal("fetch", fetchMock);

    const transport = createAuthenticatedTransport({
      getAccountId: () => "42",
      getSessionId: () => null,
      onUnauthorized: vi.fn(),
    });

    await transport.request("GET", "/api/v1/auth/session", undefined, {
      omitExpectedAccount: true,
    });

    expect(fetchMock.mock.calls[0]![1]!.headers).not.toHaveProperty("X-VC-Expected-Account-ID");
  });

  it("captures the expected account once at request entry and never re-reads it mid-flight", async () => {
    const { fetchMock, resolvers } = deferredFetch();
    vi.stubGlobal("fetch", fetchMock);
    let account = "42";
    const getAccountId = vi.fn(() => account);
    let session = "900";
    const getSessionId = vi.fn(() => session);

    const transport = createAuthenticatedTransport({
      getAccountId,
      getSessionId,
      onUnauthorized: vi.fn(),
    });

    const pending = transport.request("POST", "/api/v1/exports", { currentPassword: "x" });
    // 在途期间换号/换会话：已捕获的旧意图不得被改写成新身份。
    account = "43";
    session = "901";
    resolvers[0]!({ ok: true, status: 200, json: async () => ({ ok: true }) });

    await pending;
    expect(getAccountId).toHaveBeenCalledTimes(1);
    expect(getSessionId).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![1]!.headers).toMatchObject({
      "X-VC-Expected-Account-ID": "42",
      "X-VC-Expected-Session-ID": "900",
    });
  });

  // ---- VC-R52：期望账号失配拒绝（精确 409 + ACCOUNT_CONTEXT_CHANGED） ----

  function accountContextChanged409() {
    return {
      ok: false,
      status: 409,
      json: async () => ({ code: "ACCOUNT_CONTEXT_CHANGED", message: "expected account mismatch" }),
    };
  }

  it("routes a precise 409 + ACCOUNT_CONTEXT_CHANGED to onAccountContextChanged and still returns the result", async () => {
    const { fetchMock, resolvers } = deferredFetch();
    vi.stubGlobal("fetch", fetchMock);
    const onAccountContextChanged = vi.fn();

    const transport = createAuthenticatedTransport({
      getAccountId: () => "42",
      getSessionId: () => null,
      onUnauthorized: vi.fn(),
      onAccountContextChanged,
    });

    const pending = transport.request("POST", "/api/v1/exports", { currentPassword: "x" });
    resolvers[0]!(accountContextChanged409());

    const result = await pending;
    expect(onAccountContextChanged).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(409);
    expect(result.json).toEqual({ code: "ACCOUNT_CONTEXT_CHANGED", message: "expected account mismatch" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("detects the precise 409 on the timeoutMs path too", async () => {
    const { fetchMock, resolvers } = deferredFetch();
    vi.stubGlobal("fetch", fetchMock);
    const onAccountContextChanged = vi.fn();

    const transport = createAuthenticatedTransport({
      getAccountId: () => "42",
      getSessionId: () => null,
      onUnauthorized: vi.fn(),
      onAccountContextChanged,
    });

    const pending = transport.request(
      "POST",
      "/api/v1/exports",
      { currentPassword: "x" },
      { timeoutMs: 15_000 },
    );
    resolvers[0]!(accountContextChanged409());

    const result = await pending;
    expect(onAccountContextChanged).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(409);
  });

  it("only reacts to the exact code: other 409 bodies and same-code non-409 stay silent", async () => {
    const { fetchMock, resolvers } = deferredFetch();
    vi.stubGlobal("fetch", fetchMock);
    const onAccountContextChanged = vi.fn();

    const transport = createAuthenticatedTransport({
      getAccountId: () => "42",
      getSessionId: () => null,
      onUnauthorized: vi.fn(),
      onAccountContextChanged,
    });

    const cases: Array<() => { ok: boolean; status: number; json: () => Promise<unknown> }> = [
      // 409 但 code 不同。
      () => ({ ok: false, status: 409, json: async () => ({ code: "EXPORT_CONFLICT" }) }),
      // 409 但正文无 code。
      () => ({ ok: false, status: 409, json: async () => ({ message: "conflict" }) }),
      // 409 且正文不可解析。
      () => ({ ok: false, status: 409, json: async () => Promise.reject(new Error("not json")) }),
      // code 相同但状态不是 409。
      () => ({ ok: false, status: 400, json: async () => ({ code: "ACCOUNT_CONTEXT_CHANGED" }) }),
    ];
    for (const makeResponse of cases) {
      const pending = transport.request("POST", "/api/v1/exports", { currentPassword: "x" });
      // request() 同步发起 fetch：最后一个 resolver 就是本次调用的应答闸门。
      resolvers[resolvers.length - 1]!(makeResponse());
      await pending;
    }
    expect(onAccountContextChanged).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(cases.length);
  });

  it("suppresses onAccountContextChanged for a stale-generation 409 (session replaced mid-flight)", async () => {
    let revision = 1;
    const { fetchMock, resolvers } = deferredFetch();
    vi.stubGlobal("fetch", fetchMock);
    const onAccountContextChanged = vi.fn();

    const transport = createAuthenticatedTransport({
      getAccountId: () => "42",
      getSessionRevision: () => revision,
      getSessionId: () => null,
      onUnauthorized: vi.fn(),
      onAccountContextChanged,
    });

    const pending = transport.request("POST", "/api/v1/exports", { currentPassword: "x" });
    // 在途期间页面已 reconcile（代次推进）：迟到的旧意图 409 不得触碰较新会话。
    revision = 2;
    resolvers[0]!(accountContextChanged409());

    const result = await pending;
    expect(onAccountContextChanged).not.toHaveBeenCalled();
    expect(result.status).toBe(409);
  });
});
