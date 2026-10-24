import { describe, expect, it, vi } from "vitest";

import { createAuthenticatedTransport, TransportTimeoutError } from "@/api/transport";

import {
  changeAuthPassword,
  confirmAuthenticator,
  deleteAccount,
  getAuthenticatorSetup,
  getAuthSession,
  getRegistrationStatus,
  listAuthSessions,
  listTrustedDevices,
  login,
  logout,
  reauthAuth,
  recordSurvey,
  refresh,
  restoreSession,
  revokeAllAuthSessions,
  revokeAuthSession,
  revokeTrustedDevice,
  verifyAuthenticatorCode,
  verifyRecoveryCode,
  type AuthApiResponse,
  type AuthTransport,
} from "@/api/auth";

function transportFor(response: AuthApiResponse): AuthTransport {
  return { request: vi.fn(async () => response) };
}

function activeIdentity(recoveryCodes?: string[]) {
  return {
    nextStep: "ACTIVE",
    accountId: "7",
    email: "alice@example.com",
    role: "USER",
    sessionId: "9",
    passwordMustChange: false,
    authenticatorEnabled: true,
    expiresInSeconds: 604800,
    ...(recoveryCodes ? { recoveryCodes } : {}),
  };
}

describe("Go Runtime auth client", () => {
  it("reads the server-owned registration switch and fails closed", async () => {
    await expect(getRegistrationStatus(transportFor({
      ok: true,
      status: 200,
      json: { enabled: false },
    }))).resolves.toBe(false);
    await expect(getRegistrationStatus(transportFor({
      ok: false,
      status: 503,
      json: null,
    }))).resolves.toBe(false);
  });

  it("submits account/password and parses a trusted-device ACTIVE session", async () => {
    const transport = transportFor({ ok: true, status: 200, json: activeIdentity() });

    await expect(login(transport, "alice@example.com", "pw")).resolves.toMatchObject({
      nextStep: "ACTIVE",
      accountId: "7",
      email: "alice@example.com",
      authenticatorEnabled: true,
    });
    expect(transport.request).toHaveBeenCalledWith("POST", "/api/v1/auth/login", {
      account: "alice@example.com",
      password: "pw",
    }, { timeoutMs: 15_000 });
  });

  it("accepts a username as the account identifier", async () => {
    const transport = transportFor({
      ok: true,
      status: 202,
      json: {
        nextStep: "TOTP_REQUIRED",
        challengeId: "a".repeat(43),
        expiresAt: "2030-01-01T00:00:00Z",
      },
    });

    await expect(login(transport, "admin", "pw")).resolves.toMatchObject({
      nextStep: "TOTP_REQUIRED",
    });
    expect(transport.request).toHaveBeenCalledWith("POST", "/api/v1/auth/login", {
      account: "admin",
      password: "pw",
    }, { timeoutMs: 15_000 });
  });

  it("parses TOTP/setup challenges and admission states without creating identity", async () => {
    const challenge = "a".repeat(43);
    await expect(login(transportFor({
      ok: true,
      status: 202,
      json: { nextStep: "TOTP_REQUIRED", challengeId: challenge, expiresAt: "2030-01-01T00:00:00Z" },
    }), "alice@example.com", "pw")).resolves.toEqual({
      nextStep: "TOTP_REQUIRED",
      challengeId: challenge,
      expiresAt: "2030-01-01T00:00:00Z",
    });

    await expect(login(transportFor({
      ok: false,
      status: 403,
      json: { nextStep: "DISABLED" },
    }), "alice@example.com", "pw")).resolves.toEqual({ nextStep: "DISABLED" });
  });

  it("keeps unknown email and wrong password existence-hidden", async () => {
    await expect(login(transportFor({
      ok: false,
      status: 404,
      json: { code: "NOT_FOUND_OR_FORBIDDEN" },
    }), "missing@example.com", "bad")).resolves.toBeNull();
  });

  it("restores identity only through GET /auth/session", async () => {
    const transport = transportFor({ ok: true, status: 200, json: activeIdentity() });
    await expect(getAuthSession(transport)).resolves.toEqual({
      status: "authenticated",
      identity: activeIdentity(),
    });
    // VC-R52：身份发现显式不带期望账号头（omitExpectedAccount），否则页面
    // 身份与 Cookie 身份不同时发现流会永远撞 409 死循环。
    expect(transport.request).toHaveBeenCalledWith(
      "GET",
      "/api/v1/auth/session",
      undefined,
      { callerHandlesUnauthorized: true, timeoutMs: 15_000, omitExpectedAccount: true },
    );

    const compatibility = transportFor({ ok: true, status: 200, json: activeIdentity() });
    await expect(refresh(compatibility)).resolves.toEqual({
      status: "authenticated",
      identity: activeIdentity(),
    });
    expect(compatibility.request).toHaveBeenCalledWith(
      "GET",
      "/api/v1/auth/session",
      undefined,
      { callerHandlesUnauthorized: true, timeoutMs: 15_000, omitExpectedAccount: true },
    );

    // restoreSession 走同一条发现路径，同样显式 omit。
    const restore = transportFor({ ok: true, status: 200, json: activeIdentity() });
    await expect(restoreSession(restore)).resolves.toEqual({
      status: "authenticated",
      identity: activeIdentity(),
    });
    expect(restore.request).toHaveBeenCalledWith(
      "GET",
      "/api/v1/auth/session",
      undefined,
      { callerHandlesUnauthorized: true, timeoutMs: 15_000, omitExpectedAccount: true },
    );
  });

  it("VC-R169: 身份响应必须携带合法十进制 sessionId，缺失或非法不可用", async () => {
    // 缺 sessionId 的响应不构成可提交的身份（REQUIRED 字段）。
    await expect(getAuthSession(transportFor({
      ok: true,
      status: 200,
      json: {
        nextStep: "ACTIVE",
        accountId: "7",
        role: "USER",
        passwordMustChange: false,
        authenticatorEnabled: true,
        expiresInSeconds: 600,
      },
    }))).resolves.toEqual({ status: "unavailable" });

    // 非十进制编号同样不可用。
    await expect(getAuthSession(transportFor({
      ok: true,
      status: 200,
      json: {
        nextStep: "ACTIVE",
        accountId: "7",
        sessionId: "abc",
        role: "USER",
        passwordMustChange: false,
        authenticatorEnabled: true,
        expiresInSeconds: 600,
      },
    }))).resolves.toEqual({ status: "unavailable" });

    // 合法十进制编号进入身份并原样暴露给 store。
    const identity = await getAuthSession(transportFor({
      ok: true,
      status: 200,
      json: {
        nextStep: "ACTIVE",
        accountId: "7",
        sessionId: "42",
        role: "USER",
        passwordMustChange: false,
        authenticatorEnabled: true,
        expiresInSeconds: 600,
      },
    }));
    expect(identity.status).toBe("authenticated");
    if (identity.status === "authenticated") {
      expect(identity.identity.sessionId).toBe("42");
    }
  });

  it("maps GET /auth/session to a three-state probe that never fakes a logout", async () => {
    // 401 is the only canonical "no valid session" result.
    await expect(getAuthSession(transportFor({
      ok: false,
      status: 401,
      json: { code: "AUTHENTICATION_REQUIRED" },
    }))).resolves.toEqual({ status: "anonymous" });

    // Temporary unavailability (5xx) must not masquerade as a logout.
    await expect(getAuthSession(transportFor({
      ok: false,
      status: 503,
      json: null,
    }))).resolves.toEqual({ status: "unavailable" });

    // A 200 with a bad protocol shape is also unavailable, not anonymous.
    await expect(getAuthSession(transportFor({
      ok: true,
      status: 200,
      json: {
        nextStep: "ACTIVE",
        role: "USER",
        sessionId: "9",
        passwordMustChange: false,
        authenticatorEnabled: false,
        expiresInSeconds: 600,
      },
    }))).resolves.toEqual({ status: "unavailable" });

    // refresh / restoreSession aliases surface the same probe shape.
    await expect(refresh(transportFor({ ok: false, status: 401, json: null })))
      .resolves.toEqual({ status: "anonymous" });
    await expect(restoreSession(transportFor({ ok: true, status: 200, json: activeIdentity() })))
      .resolves.toEqual({ status: "authenticated", identity: activeIdentity() });
  });

  it("loads first-use setup and completes every supported challenge method", async () => {
    const challenge = "b".repeat(43);
    const setup = transportFor({
      ok: true,
      status: 200,
      json: {
        manualKey: "ABCDEFGHIJKLMNOP",
        provisioningUri: "otpauth://totp/Virtual%20Companion:alice",
        qrCodeDataUrl: "data:image/png;base64,abc",
      },
    });
    await expect(getAuthenticatorSetup(setup, challenge)).resolves.toMatchObject({
      manualKey: "ABCDEFGHIJKLMNOP",
    });
    expect(setup.request).toHaveBeenCalledWith(
      "POST",
      `/api/v1/auth/challenges/${challenge}/authenticator-setup`,
      undefined,
      { timeoutMs: 15_000 },
    );

    for (const [request, endpoint] of [
      [confirmAuthenticator, "authenticator-confirm"],
      [verifyAuthenticatorCode, "totp"],
      [verifyRecoveryCode, "recovery-code"],
    ] as const) {
      const transport = transportFor({
        ok: true,
        status: 200,
        json: activeIdentity(endpoint === "authenticator-confirm" ? ["ABCD-EFGH-IJKL-MNOP"] : undefined),
      });
      await expect(request(transport, challenge, "123456", true)).resolves.toMatchObject({
        nextStep: "ACTIVE",
      });
      expect(transport.request).toHaveBeenCalledWith(
        "POST",
        `/api/v1/auth/challenges/${challenge}/${endpoint}`,
        { code: "123456", trustDevice: true },
        { timeoutMs: 15_000 },
      );
    }
  });

  it("splits challenge-complete 404s between unavailable and wrong code", async () => {
    const challenge = "b".repeat(43);
    for (const request of [confirmAuthenticator, verifyAuthenticatorCode, verifyRecoveryCode]) {
      await expect(request(transportFor({
        ok: false,
        status: 404,
        json: { code: "AUTH_CHALLENGE_UNAVAILABLE", message: "challenge no longer usable" },
      }), challenge, "123456", false)).rejects.toMatchObject({
        name: "AuthHttpError",
        status: 404,
        serverCode: "AUTH_CHALLENGE_UNAVAILABLE",
      });

      await expect(request(transportFor({
        ok: false,
        status: 404,
        json: { code: "NOT_FOUND_OR_FORBIDDEN", message: "no" },
      }), challenge, "123456", false)).resolves.toBeNull();

      await expect(request(transportFor({
        ok: false,
        status: 404,
        json: null,
        parseFailed: true,
      }), challenge, "123456", false)).resolves.toBeNull();
    }
  });

  it("lists and revokes opaque sessions and trusted devices", async () => {
    const sessions = transportFor({
      ok: true,
      status: 200,
      json: [{ id: "11", createdAt: "c", expiresAt: "e", current: true }],
    });
    await expect(listAuthSessions(sessions)).resolves.toHaveLength(1);

    const devices = transportFor({
      ok: true,
      status: 200,
      json: [{ id: "3", displayName: "当前设备", createdAt: "c", lastUsedAt: "l", expiresAt: "e" }],
    });
    await expect(listTrustedDevices(devices)).resolves.toEqual([{
      id: "3",
      displayName: "当前设备",
      createdAt: "c",
      lastUsedAt: "l",
      expiresAt: "e",
    }]);

    const ok = transportFor({ ok: true, status: 200, json: { ok: true } });
    await expect(revokeAuthSession(ok, "11")).resolves.toBe(true);
    await expect(revokeTrustedDevice(ok, "3")).resolves.toBe(true);
    await expect(revokeAllAuthSessions(transportFor({
      ok: true,
      status: 200,
      json: { revoked: 2 },
    }))).resolves.toBe(2);
  });

  it("supports logout, password, reauthentication, deletion and survey", async () => {
    const ok = transportFor({ ok: true, status: 200, json: { ok: true, accepted: true } });
    await expect(logout(ok)).resolves.toBe(true);
    await expect(changeAuthPassword(ok, "old", "new-password")).resolves.toBe(true);
    await expect(reauthAuth(ok, "current-password")).resolves.toBe(true);
    await expect(deleteAccount(ok, "Current-Pass-1!")).resolves.toBe(true);
    await expect(recordSurvey(ok, 5)).resolves.toBe(true);
  });
});

// VC-R165: 弱网下 logout 不得无限等待——apiLogout 必须经真实
// createAuthenticatedTransport 的 timeoutMs 总时限（覆盖 fetch 与 JSON 正文
// 全生命周期）在 15 秒内以既有 TransportTimeoutError 失败（结果未知）。
describe("logout request deadline", () => {
  it("times out with the existing TransportTimeoutError when response headers never arrive", async () => {
    vi.useFakeTimers();
    // mock 遵守 AbortSignal：abort 时才 reject，其余时间永不返回响应头。
    let rejectedByAbort = false;
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal) {
          if (signal.aborted) {
            rejectedByAbort = true;
            reject(new DOMException("aborted", "AbortError"));
            return;
          }
          signal.addEventListener(
            "abort",
            () => {
              rejectedByAbort = true;
              reject(new DOMException("aborted", "AbortError"));
            },
            { once: true },
          );
        }
      }));
    vi.stubGlobal("fetch", fetchMock);
    const onUnauthorized = vi.fn();
    const transport = createAuthenticatedTransport({
      getSessionId: () => null,
      getAccessToken: () => "session",
      getSessionRevision: () => 1,
      onUnauthorized,
    });
    try {
      let settled: "resolved" | "rejected" | undefined;
      const outcome = logout(transport);
      // 及时附上 rejection handler，避免未处理拒绝噪声。
      outcome.then(() => { settled = "resolved"; }, () => { settled = "rejected"; });

      // 15 秒到点前不得结束（旧代码此时已挂死，但测试自身不得跟着挂）。
      await vi.advanceTimersByTimeAsync(14_999);
      expect(settled).toBeUndefined();

      await vi.advanceTimersByTimeAsync(1);
      expect(settled).toBe("rejected");
      await expect(outcome).rejects.toBeInstanceOf(TransportTimeoutError);
      await expect(outcome).rejects.toMatchObject({
        name: "TransportTimeoutError",
        timeoutMs: 15_000,
      });
      // 中止的是本次请求：signal 已 abort 且 mock 确经 abort 拒绝；
      // 头从未到达，不构成 401，不得触发 onUnauthorized。
      const signal = fetchMock.mock.calls[0]?.[1]?.signal;
      expect(signal?.aborted).toBe(true);
      expect(rejectedByAbort).toBe(true);
      expect(onUnauthorized).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("times out with the existing TransportTimeoutError when the JSON body never settles", async () => {
    vi.useFakeTimers();
    // 头 200 已返回，但正文永不 settle：总时限必须覆盖 JSON 读取阶段。
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: () => new Promise<unknown>(() => {}),
    }) as unknown as Response));
    const onUnauthorized = vi.fn();
    const transport = createAuthenticatedTransport({
      getSessionId: () => null,
      getAccessToken: () => "session",
      getSessionRevision: () => 1,
      onUnauthorized,
    });
    try {
      let settled: "resolved" | "rejected" | undefined;
      const outcome = logout(transport);
      outcome.then(() => { settled = "resolved"; }, () => { settled = "rejected"; });

      await vi.advanceTimersByTimeAsync(14_999);
      expect(settled).toBeUndefined();

      await vi.advanceTimersByTimeAsync(1);
      expect(settled).toBe("rejected");
      await expect(outcome).rejects.toBeInstanceOf(TransportTimeoutError);
      await expect(outcome).rejects.toMatchObject({ timeoutMs: 15_000 });
      expect(onUnauthorized).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});

// VC-R166: 登录主链等待点（login/getAuthSession/getAuthenticatorSetup/
// completeChallenge，后者服务 confirm/totp/recovery 三个真实入口）必须有
// 请求总时限：弱网挂起时以既有 TransportTimeoutError 在 15 秒结束（结果
// 未知），界面等待不得永不结束。经真实 createAuthenticatedTransport 调用。
describe("login chain request deadlines", () => {
  /** 头永不返回、遵守 AbortSignal 的挂起 fetch（abort 时才 reject）。 */
  function hangingHeadersFetch() {
    return vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const abort = () => reject(new DOMException("aborted", "AbortError"));
        const signal = init?.signal;
        if (signal?.aborted) {
          abort();
          return;
        }
        signal?.addEventListener("abort", abort, { once: true });
      }));
  }

  function deadlineTransport(onUnauthorized: ReturnType<typeof vi.fn>) {
    const transport = createAuthenticatedTransport({
      getSessionId: () => null,
      getAccessToken: () => "session",
      getSessionRevision: () => 1,
      onUnauthorized,
    });
    return transport;
  }

  it("ends a hanging password login with the existing TransportTimeoutError", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", hangingHeadersFetch());
    const onUnauthorized = vi.fn();
    const transport = deadlineTransport(onUnauthorized);
    try {
      let settled: "resolved" | "rejected" | undefined;
      const outcome = login(transport, "alice@example.com", "pw");
      outcome.then(() => { settled = "resolved"; }, () => { settled = "rejected"; });

      await vi.advanceTimersByTimeAsync(14_999);
      expect(settled).toBeUndefined();

      await vi.advanceTimersByTimeAsync(1);
      expect(settled).toBe("rejected");
      await expect(outcome).rejects.toBeInstanceOf(TransportTimeoutError);
      await expect(outcome).rejects.toMatchObject({ timeoutMs: 15_000 });
      expect(onUnauthorized).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("ends a never-settling authenticator-setup body with the existing TransportTimeoutError", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: () => new Promise<unknown>(() => {}),
    }) as unknown as Response));
    const onUnauthorized = vi.fn();
    const transport = deadlineTransport(onUnauthorized);
    try {
      let settled: "resolved" | "rejected" | undefined;
      const outcome = getAuthenticatorSetup(transport, "c".repeat(43));
      outcome.then(() => { settled = "resolved"; }, () => { settled = "rejected"; });

      await vi.advanceTimersByTimeAsync(14_999);
      expect(settled).toBeUndefined();

      await vi.advanceTimersByTimeAsync(1);
      expect(settled).toBe("rejected");
      await expect(outcome).rejects.toBeInstanceOf(TransportTimeoutError);
      await expect(outcome).rejects.toMatchObject({ timeoutMs: 15_000 });
      expect(onUnauthorized).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("ends a hanging TOTP challenge completion (shared completeChallenge) with the existing TransportTimeoutError", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", hangingHeadersFetch());
    const onUnauthorized = vi.fn();
    const transport = deadlineTransport(onUnauthorized);
    try {
      let settled: "resolved" | "rejected" | undefined;
      const outcome = verifyAuthenticatorCode(transport, "c".repeat(43), "123456", false);
      outcome.then(() => { settled = "resolved"; }, () => { settled = "rejected"; });

      await vi.advanceTimersByTimeAsync(14_999);
      expect(settled).toBeUndefined();

      await vi.advanceTimersByTimeAsync(1);
      expect(settled).toBe("rejected");
      await expect(outcome).rejects.toBeInstanceOf(TransportTimeoutError);
      await expect(outcome).rejects.toMatchObject({ timeoutMs: 15_000 });
      expect(onUnauthorized).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});
