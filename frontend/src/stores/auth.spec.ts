import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthHttpError, listTrustedDevices } from "@/api/auth";
import type { AuthApiResponse, AuthSessionIdentity, AuthTransport } from "@/api/auth";
import { createAuthenticatedTransport } from "@/api/transport";
import { useAuthStore } from "@/stores/auth";
import { useChatStore } from "@/stores/chat";
import { useMemoryStore } from "@/stores/memory";
import { useRelationshipStore } from "@/stores/relationship";

function okTransport(tokens: AuthSessionIdentity): AuthTransport {
  return {
    request: vi.fn(async () => ({ ok: true, status: 200, json: tokens })),
  };
}

function failTransport(status = 401): AuthTransport {
  return {
    request: vi.fn(async () => ({
      ok: false,
      status,
      json: { code: "AUTHENTICATION_REQUIRED", message: "no" },
    })),
  };
}

function throwTransport(): AuthTransport {
  return { request: vi.fn(async () => Promise.reject(new Error("offline"))) };
}

function sampleTokens(_accessToken = "a", passwordMustChange = false): AuthSessionIdentity {
  return {
    nextStep: "ACTIVE",
    expiresInSeconds: 7200,
    accountId: "7",
    email: "alice@example.com",
    role: "USER",
    passwordMustChange,
    authenticatorEnabled: true,
  };
}

function restoreTransport(): AuthTransport {
  return {
    request: vi.fn(async () => ({ ok: true, status: 200, json: sampleTokens() })),
  };
}

function totpChallengeTransport(challengeId: string): AuthTransport {
  return {
    request: vi.fn(async () => ({
      ok: true,
      status: 202,
      json: { nextStep: "TOTP_REQUIRED", challengeId, expiresAt: "2030-01-01T00:00:00Z" },
    })),
  };
}

function challengeRejectTransport(status: number, code: string): AuthTransport {
  return {
    request: vi.fn(async () => ({ ok: false, status, json: { code, message: "no" } })),
  };
}

/** VC-R08: a second, distinguishable identity for stale/new-generation contrasts. */
function identityB(): AuthSessionIdentity {
  return {
    nextStep: "ACTIVE",
    expiresInSeconds: 3600,
    accountId: "8",
    email: "bob@example.com",
    role: "ADMIN",
    passwordMustChange: true,
    authenticatorEnabled: false,
  };
}

/** VC-R08: transport whose responses settle only when the test releases them. */
function deferredAuthTransport() {
  const resolvers: Array<(response: AuthApiResponse) => void> = [];
  const request = vi.fn(
    async (): Promise<AuthApiResponse> =>
      new Promise<AuthApiResponse>((resolve) => {
        resolvers.push(resolve);
      }),
  );
  return {
    transport: { request } as AuthTransport,
    requestMock: request,
    settle(index: number, response: AuthApiResponse): void {
      resolvers[index]?.(response);
    },
  };
}

/** VC-R12: 合成账号身份，accountId 由场景指定，凭据全部为测试合成值。 */
function accountIdentity(accountId: string, email: string): AuthSessionIdentity {
  return {
    nextStep: "ACTIVE",
    expiresInSeconds: 7200,
    accountId,
    email,
    role: "USER",
    passwordMustChange: false,
    authenticatorEnabled: false,
  };
}

/**
 * VC-R12: POST /auth/logout 挂起（由测试手动 resolve）、POST /auth/login 立即
 * 返回指定响应（成功身份或 404 失败）的可控 transport，用于构造「旧 logout
 * 迟到返回」竞态。可选提供 GET /auth/session 响应以覆盖同会话读回交错。
 */
function pendingLogoutTransport(
  loginResponse: AuthApiResponse,
  sessionResponse?: AuthApiResponse,
): {
  transport: AuthTransport;
  settleLogout: (response: AuthApiResponse) => void;
} {
  const logoutPending: Array<(response: AuthApiResponse) => void> = [];
  const transport: AuthTransport = {
    request: vi.fn(async (_method: string, path: string): Promise<AuthApiResponse> => {
      if (path === "/api/v1/auth/logout") {
        return new Promise<AuthApiResponse>((resolve) => {
          logoutPending.push(resolve);
        });
      }
      if (path === "/api/v1/auth/login") {
        return loginResponse;
      }
      if (path === "/api/v1/auth/session" && sessionResponse) {
        return sessionResponse;
      }
      throw new Error(`unexpected auth request ${path}`);
    }),
  };
  return {
    transport,
    settleLogout(response) {
      logoutPending[0]?.(response);
    },
  };
}

/** Minimal Response shape consumed by createAuthenticatedTransport in the node env. */
interface StubFetchResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

function makeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: vi.fn(() => map.clear()),
    getItem: vi.fn((k) => map.get(k) ?? null),
    key: vi.fn((i) => [...map.keys()][i] ?? null),
    removeItem: vi.fn((k) => map.delete(k)),
    setItem: vi.fn((k, v) => map.set(k, v)),
  };
}

describe("useAuthStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("localStorage", makeStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts unauthenticated and empty", () => {
    const store = useAuthStore();
    expect(store.isAuthenticated).toBe(false);
    expect(store.accessToken).toBeNull();
    expect(store.accountId).toBeNull();
    expect(store.sessionStatus).toBe("unknown");
  });

  it("confirms login and holds tokens in memory only (no localStorage writes)", async () => {
    const store = useAuthStore();
    const storage = localStorage as unknown as ReturnType<typeof makeStorage>;

    const ok = await store.login(okTransport(sampleTokens("a")), "root", "pw");

    expect(ok).toBe("ACTIVE");
    expect(store.isAuthenticated).toBe(true);
    expect(store.sessionStatus).toBe("authenticated");
    expect(store.accessToken).toBe("session");
    expect(store.accountId).toBe("7");
    expect(store.email).toBe("alice@example.com");
    expect(store.role).toBe("USER");
    // P1-09: XSS-readable storage must never hold credentials.
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.getItem("vc.accessToken")).toBeNull();
    expect(storage.getItem("vc.refreshToken")).toBeNull();
  });

  it("carries the server-enforced temporary-password flag in memory", async () => {
    const store = useAuthStore();
    await store.login(okTransport(sampleTokens("temporary", true)), "alice", "pw");
    expect(store.passwordMustChange).toBe(true);
    store.clear();
    expect(store.passwordMustChange).toBe(false);
    expect(store.email).toBeNull();
  });

  it("does not authenticate on a server rejection (existence hidden)", async () => {
    const store = useAuthStore();

    const ok = await store.login(failTransport(404), "root", "wrong");

    expect(ok).toBeNull();
    expect(store.isAuthenticated).toBe(false);
    expect(store.error).toBe("invalid-credentials");
  });

  it("surfaces a transport failure without faking success", async () => {
    const store = useAuthStore();

    const ok = await store.login(throwTransport(), "root", "pw");

    expect(ok).toBeNull();
    expect(store.isAuthenticated).toBe(false);
    expect(store.error).toBe("network-failed");
  });

  it("keeps a TOTP challenge in memory without fabricating a session", async () => {
    const store = useAuthStore();
    const storage = localStorage as unknown as ReturnType<typeof makeStorage>;
    const challengeId = "a".repeat(43);
    const transport: AuthTransport = {
      request: vi.fn(async () => ({
        ok: true,
        status: 202,
        json: {
          nextStep: "TOTP_REQUIRED",
          challengeId,
          expiresAt: "2030-01-01T00:00:00Z",
        },
      })),
    };

    await expect(store.login(transport, "alice@example.com", "pw"))
      .resolves.toBe("TOTP_REQUIRED");
    expect(store.isAuthenticated).toBe(false);
    expect(store.challengeId).toBe(challengeId);
    expect(store.nextStep).toBe("TOTP_REQUIRED");
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("VC-R03: maps an unusable challenge to challenge-unavailable instead of a wrong code", async () => {
    const store = useAuthStore();
    const challengeId = "a".repeat(43);
    await store.login(totpChallengeTransport(challengeId), "alice@example.com", "pw");

    await expect(store.verifyAuthenticatorCode(
      challengeRejectTransport(404, "AUTH_CHALLENGE_UNAVAILABLE"),
      "123456",
      false,
    )).resolves.toBe(false);
    expect(store.error).toBe("challenge-unavailable");
    expect(store.isAuthenticated).toBe(false);

    await expect(store.verifyAuthenticatorCode(
      challengeRejectTransport(404, "NOT_FOUND_OR_FORBIDDEN"),
      "123456",
      false,
    )).resolves.toBe(false);
    expect(store.error).toBe("invalid-code");

    await expect(store.verifyAuthenticatorCode(
      challengeRejectTransport(429, "RATE_LIMITED"),
      "123456",
      false,
    )).resolves.toBe(false);
    expect(store.error).toBe("rate-limited");
  });

  it("loads first-use setup, confirms TOTP and retains one-time recovery codes", async () => {
    const store = useAuthStore();
    const challengeId = "b".repeat(43);
    const recoveryCodes = Array.from({ length: 10 }, (_, index) => `CODE-${index}`);
    const request = vi.fn(async (_method: string, path: string) => {
      if (path === "/api/v1/auth/login") {
        return {
          ok: true,
          status: 202,
          json: {
            nextStep: "AUTHENTICATOR_SETUP_REQUIRED",
            challengeId,
            expiresAt: "2030-01-01T00:00:00Z",
          },
        };
      }
      if (path.endsWith("/authenticator-setup")) {
        return {
          ok: true,
          status: 200,
          json: {
            manualKey: "ABCDEFGHIJKLMNOP",
            provisioningUri: "otpauth://totp/Virtual%20Companion:alice",
            qrCodeDataUrl: "data:image/png;base64,abc",
          },
        };
      }
      return {
        ok: true,
        status: 200,
        json: { ...sampleTokens(), recoveryCodes },
      };
    });
    const transport: AuthTransport = { request };

    await expect(store.login(transport, "alice@example.com", "pw"))
      .resolves.toBe("AUTHENTICATOR_SETUP_REQUIRED");
    await expect(store.loadAuthenticatorSetup(transport)).resolves.toBe(true);
    await expect(store.confirmAuthenticator(transport, "123456", true)).resolves.toBe(true);

    expect(store.isAuthenticated).toBe(true);
    expect(store.recoveryCodes).toEqual(recoveryCodes);
    expect(request).toHaveBeenLastCalledWith(
      "POST",
      `/api/v1/auth/challenges/${challengeId}/authenticator-confirm`,
      { code: "123456", trustDevice: true },
    );
  });

  it("preserves a server-selected pending or disabled admission state", async () => {
    const pending = useAuthStore();
    const transport: AuthTransport = {
      request: vi.fn(async () => ({
        ok: true,
        status: 202,
        json: { nextStep: "REVIEW_PENDING" },
      })),
    };
    await expect(pending.login(transport, "alice@example.com", "pw"))
      .resolves.toBe("REVIEW_PENDING");
    expect(pending.isAuthenticated).toBe(false);
    expect(pending.nextStep).toBe("REVIEW_PENDING");
  });

  it("restores identity from GET /auth/session", async () => {
    const store = useAuthStore();
    await store.login(okTransport(sampleTokens("a1")), "alice", "pw");
    const chat = useChatStore();
    chat.conversationId = "42";
    chat.messages = [
      { messageId: "m1", conversationId: "42", role: "user", content: "same-account" },
    ];

    const t = restoreTransport();
    const renewed = await store.tryRefresh(t);

    expect(renewed).toBe(true);
    expect(store.accountId).toBe("7");
    // VC-R09: a same-account recovery is not a handover; the live chat stays.
    expect(chat.conversationId).toBe("42");
    expect(chat.messages).toHaveLength(1);
    expect(t.request).toHaveBeenCalledWith(
      "GET",
      "/api/v1/auth/session",
      undefined,
      { callerHandlesUnauthorized: true, omitExpectedAccount: true },
    );
  });

  it("coalesces concurrent bootstrap, page and restore calls", async () => {
    const store = useAuthStore();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const request = vi.fn(async () => {
      await gate;
      return { ok: true, status: 200, json: sampleTokens() };
    });
    const t: AuthTransport = { request };

    const bootstrap = store.tryRefresh(t);
    const pageMount = store.tryRefresh(t);
    const replay401 = store.renewAccessToken(t);

    expect(request).toHaveBeenCalledTimes(1);
    release();
    await expect(Promise.all([bootstrap, pageMount, replay401])).resolves.toEqual([
      true,
      true,
      "renewed",
    ]);
    expect(store.accountId).toBe("7");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("clears the session when a refresh is rejected (no fabricated continuation)", async () => {
    const store = useAuthStore();
    await store.login(okTransport(sampleTokens("a1")), "alice", "pw");

    const renewed = await store.tryRefresh(failTransport(401));

    expect(renewed).toBe(false);
    expect(store.isAuthenticated).toBe(false);
    expect(store.sessionStatus).toBe("anonymous");
    expect(store.accessToken).toBeNull();
  });

  it("S0-18: a network refresh before any session stays unknown, not anonymous", async () => {
    const store = useAuthStore();
    const renewed = await store.tryRefresh(throwTransport());
    expect(renewed).toBe(false);
    expect(store.sessionStatus).toBe("unknown");
    expect(store.isAuthenticated).toBe(false);
  });

  it("renewAccessToken reports renewed after GET /auth/session", async () => {
    const store = useAuthStore();
    await store.login(okTransport(sampleTokens("a1")), "alice", "pw");

    const t = restoreTransport();
    const outcome = await store.renewAccessToken(t);

    expect(outcome).toBe("renewed");
    expect(store.accountId).toBe("7");
    expect(t.request).toHaveBeenCalledWith(
      "GET",
      "/api/v1/auth/session",
      undefined,
      { callerHandlesUnauthorized: true, omitExpectedAccount: true },
    );
  });

  it("SESS-REVIVE: renewAccessToken reports rejected and clears on a refused cookie", async () => {
    const store = useAuthStore();
    await store.login(okTransport(sampleTokens("a1")), "alice", "pw");

    const outcome = await store.renewAccessToken(failTransport(401));

    expect(outcome).toBe("rejected");
    expect(store.isAuthenticated).toBe(false);
  });

  it("SESS-REVIVE: renewAccessToken reports unavailable on a network failure and keeps the session", async () => {
    const store = useAuthStore();
    await store.login(okTransport(sampleTokens("a1")), "alice", "pw");

    const outcome = await store.renewAccessToken(throwTransport());

    expect(outcome).toBe("unavailable");
    // A network failure never fabricates a session loss.
    expect(store.isAuthenticated).toBe(true);
    expect(store.accountId).toBe("7");
  });

  it("VC-R08: a late refresh 200 cannot revive a logged-out identity or its caches", async () => {
    const store = useAuthStore();
    await store.login(okTransport(sampleTokens("a1")), "alice", "pw");
    const chat = useChatStore();
    const rel = useRelationshipStore();
    chat.conversationId = "99";
    chat.messages = [
      { messageId: "m1", conversationId: "99", role: "user", content: "secret" },
    ];
    rel.relationships = [
      { relationshipId: "rel-1", personaRef: "gentle-listener", active: true },
    ];
    rel.currentRelationshipId = "rel-1";

    const deferred = deferredAuthTransport();
    const revive = store.renewAccessToken(deferred.transport);

    await store.logout(okTransport(sampleTokens()));

    deferred.settle(0, { ok: true, status: 200, json: sampleTokens("a1", true) });
    await expect(revive).resolves.toBe("unavailable");

    expect(store.isAuthenticated).toBe(false);
    expect(store.accountId).toBeNull();
    expect(store.role).toBeNull();
    expect(store.passwordMustChange).toBe(false);
    expect(store.nextStep).toBe("LOGIN");
    expect(store.recoveryCodes).toEqual([]);
    // Caches dropped by logout must not come back with the stale identity.
    expect(chat.conversationId).toBe("");
    expect(chat.messages).toEqual([]);
    expect(rel.relationships).toEqual([]);
    expect(rel.currentRelationshipId).toBeNull();
  });

  it("VC-R08: a late refresh 200 crossing a new login does not overwrite the newer identity", async () => {
    const store = useAuthStore();
    const deferred = deferredAuthTransport();
    const stale = store.renewAccessToken(deferred.transport);

    await store.login(okTransport(identityB()), "bob", "pw");

    deferred.settle(0, { ok: true, status: 200, json: sampleTokens("a1") });
    await expect(stale).resolves.toBe("unavailable");

    expect(store.isAuthenticated).toBe(true);
    expect(store.accountId).toBe("8");
    expect(store.role).toBe("ADMIN");
    expect(store.passwordMustChange).toBe(true);
    expect(store.nextStep).toBe("ACTIVE");
  });

  it("VC-R08: a late refresh 401 crossing a new login does not clear the newer identity", async () => {
    const store = useAuthStore();
    const deferred = deferredAuthTransport();
    const stale = store.renewAccessToken(deferred.transport);

    await store.login(okTransport(identityB()), "bob", "pw");

    deferred.settle(0, { ok: false, status: 401, json: { code: "AUTHENTICATION_REQUIRED" } });
    await expect(stale).resolves.toBe("unavailable");

    expect(store.isAuthenticated).toBe(true);
    expect(store.accountId).toBe("8");
    expect(store.role).toBe("ADMIN");
    expect(store.nextStep).toBe("ACTIVE");
  });

  it("VC-R08: a late refresh 200 cannot turn a fresh TOTP challenge into the old session", async () => {
    const store = useAuthStore();
    const deferred = deferredAuthTransport();
    const stale = store.renewAccessToken(deferred.transport);

    const challengeId = "c".repeat(43);
    await expect(store.login(totpChallengeTransport(challengeId), "carol", "pw"))
      .resolves.toBe("TOTP_REQUIRED");

    deferred.settle(0, { ok: true, status: 200, json: sampleTokens("a1") });
    await expect(stale).resolves.toBe("unavailable");

    expect(store.nextStep).toBe("TOTP_REQUIRED");
    expect(store.challengeId).toBe(challengeId);
    expect(store.isAuthenticated).toBe(false);
    expect(store.accountId).toBeNull();
  });

  it("VC-R08: a 503 refresh maps to unavailable and never logs out a valid session", async () => {
    const store = useAuthStore();
    await store.login(okTransport(sampleTokens("a1")), "alice", "pw");

    const outcome = await store.renewAccessToken(failTransport(503));

    expect(outcome).toBe("unavailable");
    expect(store.isAuthenticated).toBe(true);
    expect(store.accountId).toBe("7");
    expect(store.sessionStatus).toBe("authenticated");
  });

  it("VC-R08: an invalidated refresh never blocks a new one and a stale finally keeps the new in-flight", async () => {
    const store = useAuthStore();
    const deferred = deferredAuthTransport();

    const stale = store.renewAccessToken(deferred.transport);
    expect(deferred.requestMock).toHaveBeenCalledTimes(1);
    expect(deferred.requestMock).toHaveBeenNthCalledWith(
      1,
      "GET",
      "/api/v1/auth/session",
      undefined,
      { callerHandlesUnauthorized: true, omitExpectedAccount: true },
    );

    store.clear();
    const fresh = store.tryRefresh(deferred.transport);
    // The invalidated generation must not absorb the new request.
    expect(deferred.requestMock).toHaveBeenCalledTimes(2);
    expect(deferred.requestMock).toHaveBeenNthCalledWith(
      2,
      "GET",
      "/api/v1/auth/session",
      undefined,
      { callerHandlesUnauthorized: true, omitExpectedAccount: true },
    );

    deferred.settle(0, { ok: true, status: 200, json: sampleTokens("a1") });
    await expect(stale).resolves.toBe("unavailable");
    expect(store.isAuthenticated).toBe(false);

    // The stale finally must not drop the new in-flight: a third caller joins
    // the second request instead of dispatching a third one.
    const joined = store.renewAccessToken(deferred.transport);
    expect(deferred.requestMock).toHaveBeenCalledTimes(2);

    deferred.settle(1, { ok: true, status: 200, json: identityB() });
    await expect(fresh).resolves.toBe(true);
    await expect(joined).resolves.toBe("renewed");
    expect(store.accountId).toBe("8");
  });

  it("VC-R08 wiring: a stale session 401 crossing a fresh login keeps B and never redirects", async () => {
    const redirectTo = vi.fn();
    vi.stubGlobal("uni", { redirectTo });
    let releaseSession!: (response: StubFetchResponse) => void;
    const sessionGate = new Promise<StubFetchResponse>((resolve) => {
      releaseSession = resolve;
    });
    const fetchMock = vi.fn(async (input: unknown): Promise<StubFetchResponse> => {
      const url = String(input);
      if (url === "/api/v1/auth/session") return sessionGate;
      if (url === "/api/v1/auth/login") {
        return { ok: true, status: 200, json: async () => identityB() };
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const auth = useAuthStore();
    const transport = createAuthenticatedTransport({
      getAccessToken: () => auth.accessToken,
      renewAccessToken: () => auth.renewAccessToken(transport),
      onUnauthorized: () => auth.onUnauthorized(),
    });

    const staleProbe = auth.tryRefresh(transport);
    await expect(auth.login(transport, "bob@example.com", "pw")).resolves.toBe("ACTIVE");

    releaseSession({ ok: false, status: 401, json: async () => ({ code: "AUTHENTICATION_REQUIRED" }) });
    await expect(staleProbe).resolves.toBe(false);

    expect(auth.isAuthenticated).toBe(true);
    expect(auth.accountId).toBe("8");
    expect(auth.role).toBe("ADMIN");
    // The stale recovery owns neither the identity nor the error surface.
    expect(auth.error).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The page-style onUnauthorized must not be preempted by the transport.
    expect(redirectTo).not.toHaveBeenCalled();
  });

  it("VC-R08F: a late probe keeps the newer login failure as the only visible error", async () => {
    const store = useAuthStore();
    const deferred = deferredAuthTransport();
    const stale = store.tryRefresh(deferred.transport);

    await expect(store.login(failTransport(404), "bob@example.com", "wrong")).resolves.toBeNull();
    expect(store.error).toBe("invalid-credentials");

    deferred.settle(0, { ok: false, status: 401, json: { code: "AUTHENTICATION_REQUIRED" } });
    await expect(stale).resolves.toBe(false);

    // The stale recovery must neither overwrite nor clear the newer flow's error.
    expect(store.error).toBe("invalid-credentials");
    expect(store.isAuthenticated).toBe(false);
  });

  it("VC-R08F: completing a TOTP challenge invalidates an in-flight probe instead of rolling back B", async () => {
    const store = useAuthStore();
    const challengeId = "d".repeat(43);
    const recoveryCodes = ["RC-1", "RC-2", "RC-3"];
    const sessionProbes: Array<(response: AuthApiResponse) => void> = [];
    const request = vi.fn(async (_method: string, path: string): Promise<AuthApiResponse> => {
      if (path === "/api/v1/auth/session") {
        return new Promise<AuthApiResponse>((resolve) => {
          sessionProbes.push(resolve);
        });
      }
      if (path === "/api/v1/auth/login") {
        return {
          ok: true,
          status: 202,
          json: {
            nextStep: "TOTP_REQUIRED",
            challengeId,
            expiresAt: "2030-01-01T00:00:00Z",
          },
        };
      }
      if (path === `/api/v1/auth/challenges/${challengeId}/totp`) {
        return { ok: true, status: 200, json: { ...identityB(), recoveryCodes } };
      }
      throw new Error(`unexpected auth request ${path}`);
    });
    const transport: AuthTransport = { request };

    await expect(store.login(transport, "bob@example.com", "pw"))
      .resolves.toBe("TOTP_REQUIRED");

    // Another page or recovery path probes GET /session while the challenge is
    // pending and login.vue is not waiting for any bootstrap.
    const probe = store.tryRefresh(transport);

    await expect(store.verifyAuthenticatorCode(transport, "123456", false))
      .resolves.toBe(true);

    // The earlier probe settles afterwards with the pre-challenge anonymous view.
    sessionProbes[0]?.({ ok: false, status: 401, json: { code: "AUTHENTICATION_REQUIRED" } });
    await expect(probe).resolves.toBe(false);

    expect(store.isAuthenticated).toBe(true);
    expect(store.accountId).toBe("8");
    expect(store.nextStep).toBe("ACTIVE");
    expect(store.recoveryCodes).toEqual(recoveryCodes);
    expect(store.error).toBeNull();
    // Invalidating the in-flight probe must not dispatch a replacement GET.
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("VC-R08 wiring: a same-generation session 401 still clears identity and local caches", async () => {
    const fetchMock = vi.fn(async (input: unknown): Promise<StubFetchResponse> => {
      const url = String(input);
      if (url === "/api/v1/auth/login") {
        return { ok: true, status: 200, json: async () => identityB() };
      }
      if (url === "/api/v1/auth/session") {
        return { ok: false, status: 401, json: async () => ({ code: "AUTHENTICATION_REQUIRED" }) };
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const auth = useAuthStore();
    const transport = createAuthenticatedTransport({
      getAccessToken: () => auth.accessToken,
      renewAccessToken: () => auth.renewAccessToken(transport),
      onUnauthorized: () => auth.onUnauthorized(),
    });

    await expect(auth.login(transport, "bob@example.com", "pw")).resolves.toBe("ACTIVE");
    const chat = useChatStore();
    const rel = useRelationshipStore();
    chat.conversationId = "99";
    chat.messages = [
      { messageId: "m1", conversationId: "99", role: "user", content: "secret" },
    ];
    rel.relationships = [
      { relationshipId: "rel-1", personaRef: "gentle-listener", active: true },
    ];
    rel.currentRelationshipId = "rel-1";

    await expect(auth.tryRefresh(transport)).resolves.toBe(false);

    expect(auth.isAuthenticated).toBe(false);
    expect(auth.sessionStatus).toBe("anonymous");
    expect(auth.accountId).toBeNull();
    expect(chat.conversationId).toBe("");
    expect(chat.messages).toEqual([]);
    expect(rel.relationships).toEqual([]);
    expect(rel.currentRelationshipId).toBeNull();
  });

  it("VC-R10 wiring: a stale normal-endpoint 401 crossing a new login keeps B and never redirects", async () => {
    const redirectTo = vi.fn();
    vi.stubGlobal("uni", { redirectTo });
    let releaseDevices!: (response: StubFetchResponse) => void;
    const devicesGate = new Promise<StubFetchResponse>((resolve) => {
      releaseDevices = resolve;
    });
    const fetchMock = vi.fn(async (input: unknown): Promise<StubFetchResponse> => {
      const url = String(input);
      if (url === "/api/v1/auth/trusted-devices") return devicesGate;
      if (url === "/api/v1/auth/login") {
        return { ok: true, status: 200, json: async () => identityB() };
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const auth = useAuthStore();
    const provider = {
      getAccessToken: () => auth.accessToken,
      renewAccessToken: () => auth.renewAccessToken(transport),
      onUnauthorized: () => auth.onUnauthorized(),
      getSessionRevision: () => auth.getSessionRevision(),
    };
    const transport = createAuthenticatedTransport(provider);

    // A's ordinary trusted-device listing is in flight (no caller-owned 401).
    const devices = listTrustedDevices(transport);

    await expect(auth.login(transport, "bob@example.com", "pw")).resolves.toBe("ACTIVE");

    releaseDevices({ ok: false, status: 401, json: async () => ({ code: "AUTHENTICATION_REQUIRED" }) });
    await expect(devices).rejects.toThrow();

    // The stale request's 401 describes A's dead session; B stays logged in.
    expect(auth.isAuthenticated).toBe(true);
    expect(auth.accountId).toBe("8");
    expect(auth.role).toBe("ADMIN");
    expect(auth.nextStep).toBe("ACTIVE");
    expect(redirectTo).not.toHaveBeenCalled();
  });

  it("VC-R10 wiring: a same-generation normal-endpoint 401 still signs out and redirects", async () => {
    const redirectTo = vi.fn();
    vi.stubGlobal("uni", { redirectTo });
    const fetchMock = vi.fn(async (input: unknown): Promise<StubFetchResponse> => {
      const url = String(input);
      if (url === "/api/v1/auth/trusted-devices") {
        return { ok: false, status: 401, json: async () => ({ code: "AUTHENTICATION_REQUIRED" }) };
      }
      if (url === "/api/v1/auth/login") {
        return { ok: true, status: 200, json: async () => identityB() };
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const auth = useAuthStore();
    const provider = {
      getAccessToken: () => auth.accessToken,
      renewAccessToken: () => auth.renewAccessToken(transport),
      onUnauthorized: () => auth.onUnauthorized(),
      getSessionRevision: () => auth.getSessionRevision(),
    };
    const transport = createAuthenticatedTransport(provider);

    await expect(auth.login(transport, "bob@example.com", "pw")).resolves.toBe("ACTIVE");

    await expect(listTrustedDevices(transport)).rejects.toThrow();

    expect(auth.isAuthenticated).toBe(false);
    expect(auth.sessionStatus).toBe("anonymous");
    expect(auth.accountId).toBeNull();
    expect(redirectTo).toHaveBeenCalledWith({ url: "/pages/login/login" });
  });

  it("VC-R09: a session probe handing over to a different known account drops A's shared caches", async () => {
    const store = useAuthStore();
    await store.login(okTransport(sampleTokens("a1")), "alice", "pw");
    const chat = useChatStore();
    const rel = useRelationshipStore();
    const memory = useMemoryStore();
    chat.conversationId = "99";
    chat.messages = [
      { messageId: "m1", conversationId: "99", role: "user", content: "A-secret" },
    ];
    chat.conversations = [
      { conversationId: "9", relationshipId: "1", title: "A-预置" },
    ];
    rel.relationships = [
      { relationshipId: "rel-1", personaRef: "gentle-listener", active: true },
    ];
    rel.currentRelationshipId = "rel-1";
    memory.items = [
      { memoryId: "m-a1", scope: "user_profile", summary: "A 的私事", status: "ACCEPTED", autoSaved: false },
    ];

    // Another tab logged in as B: this page's GET /auth/session legally answers B.
    const deferred = deferredAuthTransport();
    const probe = store.renewAccessToken(deferred.transport);
    deferred.settle(0, { ok: true, status: 200, json: identityB() });
    await expect(probe).resolves.toBe("renewed");

    expect(store.isAuthenticated).toBe(true);
    expect(store.accountId).toBe("8");
    expect(store.email).toBe("bob@example.com");
    // The previous account's shared caches must not survive the handover.
    expect(chat.conversationId).toBe("");
    expect(chat.messages).toEqual([]);
    expect(chat.conversations).toEqual([]);
    expect(rel.relationships).toEqual([]);
    expect(rel.currentRelationshipId).toBeNull();
    expect(memory.items).toEqual([]);
    expect(memory.listStatus).toBe("idle");
  });

  it("logout revokes server-side (cookie) then clears locally when the server confirms", async () => {
    const store = useAuthStore();
    const t = okTransport(sampleTokens("a"));
    await store.login(t, "alice", "pw");

    const logoutT = okTransport(sampleTokens());
    // 正常路径：代次未变，本次调用拥有本地清理并已执行，返回 true。
    await expect(store.logout(logoutT)).resolves.toBe(true);

    // VC-R165: logout 请求带 15 秒总时限（弱网挂起时按结果未知失败）。
    expect(logoutT.request).toHaveBeenCalledWith(
      "POST",
      "/api/v1/auth/logout",
      undefined,
      { timeoutMs: 15_000 },
    );
    expect(store.isAuthenticated).toBe(false);
    expect(store.accessToken).toBeNull();
  });

  it("VC-R164: HTTP 503 退出无法确认：保留身份抛内部异常，重试成功才清理", async () => {
    const store = useAuthStore();
    await store.login(okTransport(sampleTokens("a")), "alice", "pw");

    // 归属成立但服务端未确认撤销（后端 TestLogoutRevokeFailureKeepsCookiesAndSession：
    // 503 时 cookie/会话仍有效）：清本地会谎称已退出（刷新即恢复会话），必须
    // 保留身份并以普通内部异常表示「结果无法确认」，不暴露原始错误。
    const caught = await store.logout(failTransport(503)).then(
      () => null,
      (error: unknown) => error,
    );
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(AuthHttpError);
    expect((caught as Error).message).not.toMatch(/503|AUTHENTICATION_REQUIRED/i);
    expect(store.isAuthenticated).toBe(true);
    expect(store.accountId).toBe("7");

    // 重试成功：正常清理并返回 true。
    await expect(store.logout(okTransport(sampleTokens()))).resolves.toBe(true);
    expect(store.isAuthenticated).toBe(false);
  });

  it("VC-R164: 网络失败退出同样无法确认：保留身份抛内部异常，不再 best-effort 清本地", async () => {
    const store = useAuthStore();
    await store.login(okTransport(sampleTokens("a")), "alice", "pw");

    const caught = await store.logout(throwTransport()).then(
      () => null,
      (error: unknown) => error,
    );
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).not.toContain("offline");
    expect(store.isAuthenticated).toBe(true);
    expect(store.accessToken).toBe("session");
  });

  it("VC-R164: 迟到的失败 logout 让位给较新凭据：返回 false，不 throw、不触碰", async () => {
    const store = useAuthStore();
    await expect(
      store.login(
        okTransport(accountIdentity("1", "vc-r164-a@example.com")),
        "vc-r164-a@example.com",
        "pw-a",
      ),
    ).resolves.toBe("ACTIVE");

    const identityB = accountIdentity("2", "vc-r164-b@example.com");
    const { transport, settleLogout } = pendingLogoutTransport({
      ok: true,
      status: 200,
      json: identityB,
    });
    const loggingOut = store.logout(transport);

    await expect(store.login(transport, "vc-r164-b@example.com", "pw-b"))
      .resolves.toBe("ACTIVE");
    expect(store.accountId).toBe("2");

    // 账号 A 的 logout 此刻才迟到失败（503）：已让位给 B 的新凭据——
    // 归属不再成立，不得 throw（那会把让位误报成本次失败），也不清状态。
    settleLogout({ ok: false, status: 503, json: { code: "UNAVAILABLE", message: "no" } });
    await expect(loggingOut).resolves.toBe(false);

    expect(store.accountId).toBe("2");
    expect(store.isAuthenticated).toBe(true);
    expect(store.sessionStatus).toBe("authenticated");
  });

  it("VC-R12: 迟到的旧 logout 成功响应不得清掉另一账号的新登录", async () => {
    const store = useAuthStore();
    await expect(
      store.login(
        okTransport(accountIdentity("1", "vc-r12-a@example.com")),
        "vc-r12-a@example.com",
        "pw-a",
      ),
    ).resolves.toBe("ACTIVE");
    expect(store.accountId).toBe("1");

    const identityB = accountIdentity("2", "vc-r12-b@example.com");
    const { transport, settleLogout } = pendingLogoutTransport({
      ok: true,
      status: 200,
      json: identityB,
    });
    const loggingOut = store.logout(transport);

    // 旧账号 A 的 POST /auth/logout 仍在途：同一 store + transport 完成账号 B 登录。
    await expect(store.login(transport, "vc-r12-b@example.com", "pw-b"))
      .resolves.toBe("ACTIVE");
    expect(store.accountId).toBe("2");

    // 账号 A 的 logout 响应此刻才迟到成功。
    settleLogout({ ok: true, status: 204, json: null });
    // 本次旧登出已让位给较新登录代次：不清状态，并如实返回 false。
    await expect(loggingOut).resolves.toBe(false);

    expect(store.accountId).toBe("2");
    expect(store.isAuthenticated).toBe(true);
    expect(store.sessionStatus).toBe("authenticated");
    expect(store.nextStep).toBe("ACTIVE");
  });

  it("VC-R12: 迟到的旧 logout 成功响应不得清掉同一账号的重新登录（credential 代次）", async () => {
    const store = useAuthStore();
    const identityA = accountIdentity("1", "vc-r12-a@example.com");
    const { transport, settleLogout } = pendingLogoutTransport({
      ok: true,
      status: 200,
      json: identityA,
    });
    await expect(store.login(transport, "vc-r12-a@example.com", "pw-old"))
      .resolves.toBe("ACTIVE");
    expect(store.accountId).toBe("1");

    const loggingOut = store.logout(transport);

    // 同一 accountId 用新 credential 重新登录：任何以「账号是否变化」为判据的
    // 修复方案都区分不了这次代次，必须依赖会话代次而非账号比较。
    await expect(store.login(transport, "vc-r12-a@example.com", "pw-new"))
      .resolves.toBe("ACTIVE");
    expect(store.accountId).toBe("1");

    settleLogout({ ok: true, status: 204, json: null });
    // 判据是代次而非账号比较：同 ID 重新登录同样让旧登出返回 false。
    await expect(loggingOut).resolves.toBe(false);

    expect(store.accountId).toBe("1");
    expect(store.isAuthenticated).toBe(true);
    expect(store.sessionStatus).toBe("authenticated");
    expect(store.nextStep).toBe("ACTIVE");
  });

  it("VC-R12: 登出挂起期间一次失败登录不得让旧登出让位（仍正常退出）", async () => {
    const store = useAuthStore();
    await expect(
      store.login(
        okTransport(accountIdentity("1", "vc-r12-a@example.com")),
        "vc-r12-a@example.com",
        "pw-a",
      ),
    ).resolves.toBe("ACTIVE");
    expect(store.accountId).toBe("1");

    // 旧登出挂起；该次登录明确失败（404 → invalid-credentials），没有新身份提交。
    const { transport, settleLogout } = pendingLogoutTransport({
      ok: false,
      status: 404,
      json: { code: "NOT_FOUND_OR_FORBIDDEN", message: "no" },
    });
    const loggingOut = store.logout(transport);

    await expect(store.login(transport, "vc-r12-a@example.com", "wrong"))
      .resolves.toBeNull();
    expect(store.error).toBe("invalid-credentials");
    expect(store.accountId).toBe("1");

    settleLogout({ ok: true, status: 204, json: null });
    // 失败登录只是登录「意图」，没有确立新会话：本次登出仍拥有本地清理，返回 true。
    await expect(loggingOut).resolves.toBe(true);

    expect(store.accountId).toBeNull();
    expect(store.isAuthenticated).toBe(false);
    expect(store.sessionStatus).toBe("anonymous");
  });

  it("VC-R12: 登出挂起期间同会话 session 读回不得让旧登出让位（仍正常退出）", async () => {
    const store = useAuthStore();
    await expect(
      store.login(
        okTransport(accountIdentity("1", "vc-r12-a@example.com")),
        "vc-r12-a@example.com",
        "pw-a",
      ),
    ).resolves.toBe("ACTIVE");
    expect(store.accountId).toBe("1");

    // 旧登出挂起；同会话 GET /auth/session 读回同一身份（accountId 不变），
    // 没有新登录、没有 Cookie 换发，只是一次读回。
    const identityA = accountIdentity("1", "vc-r12-a@example.com");
    const { transport, settleLogout } = pendingLogoutTransport(
      { ok: false, status: 404, json: { code: "NOT_FOUND_OR_FORBIDDEN", message: "no" } },
      { ok: true, status: 200, json: identityA },
    );
    const loggingOut = store.logout(transport);

    await expect(store.tryRefresh(transport)).resolves.toBe(true);
    expect(store.accountId).toBe("1");

    settleLogout({ ok: true, status: 204, json: null });
    // 同会话读回不构成新凭据：本次登出仍拥有本地清理，返回 true。
    await expect(loggingOut).resolves.toBe(true);

    expect(store.accountId).toBeNull();
    expect(store.isAuthenticated).toBe(false);
    expect(store.sessionStatus).toBe("anonymous");
  });

  it("LOGOUT-CLEAR: logout drops in-memory chat and relationship caches", async () => {
    const auth = useAuthStore();
    await auth.login(okTransport(sampleTokens("a")), "alice", "pw");
    const chat = useChatStore();
    const rel = useRelationshipStore();
    chat.conversationId = "99";
    chat.messages = [
      { messageId: "m1", conversationId: "99", role: "user", content: "secret" },
    ];
    rel.relationships = [
      {
        relationshipId: "rel-1",
        personaRef: "gentle-listener",
        active: true,
      },
    ];
    rel.currentRelationshipId = "rel-1";

    await auth.logout(okTransport(sampleTokens()));

    expect(chat.conversationId).toBe("");
    expect(chat.messages).toEqual([]);
    expect(rel.relationships).toEqual([]);
    expect(rel.currentRelationshipId).toBeNull();
  });

  it("LOGOUT-CLEAR: a failed refresh without an existing session does not wipe caches", async () => {
    const chat = useChatStore();
    chat.conversations = [
      { conversationId: "9", relationshipId: "1", title: "预置" },
    ];
    const auth = useAuthStore();
    expect(auth.isAuthenticated).toBe(false);

    await auth.tryRefresh(failTransport(401));

    expect(chat.conversations).toHaveLength(1);
    expect(chat.conversations[0]?.conversationId).toBe("9");
  });

  it("onUnauthorized clears the session and redirects to login (server 401)", async () => {
    const store = useAuthStore();
    const redirectTo = vi.fn();
    vi.stubGlobal("uni", { redirectTo });
    await store.login(okTransport(sampleTokens("a")), "alice", "pw");
    expect(store.isAuthenticated).toBe(true);

    store.onUnauthorized();

    expect(store.isAuthenticated).toBe(false);
    expect(store.accountId).toBeNull();
    expect(store.sessionStatus).toBe("anonymous");
    expect(redirectTo).toHaveBeenCalledWith({ url: "/pages/login/login" });
  });

  it("S0-18: 401 from a protected page keeps path+query on the login return", async () => {
    const store = useAuthStore();
    const redirectTo = vi.fn();
    vi.stubGlobal("uni", { redirectTo });
    vi.stubGlobal("location", {
      pathname: "/",
      search: "",
      hash: "#/pages/chat/chat?relationshipId=7&conversationId=11",
      href: "http://localhost/#/pages/chat/chat?relationshipId=7&conversationId=11",
    });
    await store.login(okTransport(sampleTokens("a")), "alice", "pw");

    store.onUnauthorized();

    expect(redirectTo).toHaveBeenCalledWith({
      url: "/pages/login/login?return=%2Fpages%2Fchat%2Fchat%3FrelationshipId%3D7%26conversationId%3D11",
    });
  });

  it("S0-18: a 401 raised on login keeps the existing return target", async () => {
    const store = useAuthStore();
    const redirectTo = vi.fn();
    vi.stubGlobal("uni", { redirectTo });
    vi.stubGlobal("location", {
      pathname: "/",
      search: "",
      hash: "#/pages/login/login?return=%2Fpages%2Fchat%2Fchat%3FrelationshipId%3D7",
      href: "http://localhost/#/pages/login/login?return=%2Fpages%2Fchat%2Fchat%3FrelationshipId%3D7",
    });
    await store.login(okTransport(sampleTokens("a")), "alice", "pw");

    store.onUnauthorized();

    expect(store.sessionStatus).toBe("anonymous");
    expect(redirectTo).not.toHaveBeenCalled();
  });
});
