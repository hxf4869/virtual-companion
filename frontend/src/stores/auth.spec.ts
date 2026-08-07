import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthTokens, AuthTransport } from "@/api/auth";
import { useAuthStore } from "@/stores/auth";

function okTransport(tokens: AuthTokens): AuthTransport {
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

  it("starts unauthenticated and empty", () => {
    const store = useAuthStore();
    expect(store.isAuthenticated).toBe(false);
    expect(store.accessToken).toBeNull();
    expect(store.accountId).toBeNull();
  });

  it("confirms login, persists tokens and restores identity from the server", async () => {
    const store = useAuthStore();
    const tokens: AuthTokens = {
      accessToken: "a",
      refreshToken: "r",
      tokenType: "Bearer",
      expiresInSeconds: 7200,
      accountId: "7",
      role: "ADMIN",
    };

    const ok = await store.login(okTransport(tokens), "root", "pw");

    expect(ok).toBe(true);
    expect(store.isAuthenticated).toBe(true);
    expect(store.accessToken).toBe("a");
    expect(store.refreshToken).toBe("r");
    expect(store.accountId).toBe("7");
    expect(store.role).toBe("ADMIN");
    expect(localStorage.getItem("vc.accessToken")).toBe("a");
    expect(localStorage.getItem("vc.refreshToken")).toBe("r");
  });

  it("does not authenticate on a server rejection (existence hidden)", async () => {
    const store = useAuthStore();

    const ok = await store.login(failTransport(), "root", "wrong");

    expect(ok).toBe(false);
    expect(store.isAuthenticated).toBe(false);
    expect(store.error).toBe("invalid-credentials");
  });

  it("surfaces a transport failure without faking success", async () => {
    const store = useAuthStore();

    const ok = await store.login(throwTransport(), "root", "pw");

    expect(ok).toBe(false);
    expect(store.isAuthenticated).toBe(false);
    expect(store.error).toBe("network-failed");
  });

  it("rotates the session in place on a successful refresh", async () => {
    const store = useAuthStore();
    await store.login(
      okTransport({
        accessToken: "a1",
        refreshToken: "r1",
        tokenType: "Bearer",
        expiresInSeconds: 7200,
        accountId: "7",
        role: "USER",
      }),
      "alice",
      "pw",
    );

    const renewed = await store.tryRefresh(
      okTransport({
        accessToken: "a2",
        refreshToken: "r2",
        tokenType: "Bearer",
        expiresInSeconds: 7200,
        accountId: "7",
        role: "USER",
      }),
    );

    expect(renewed).toBe(true);
    expect(store.accessToken).toBe("a2");
    expect(store.refreshToken).toBe("r2");
  });

  it("clears the session when a refresh is rejected (no fabricated continuation)", async () => {
    const store = useAuthStore();
    await store.login(
      okTransport({
        accessToken: "a1",
        refreshToken: "r1",
        tokenType: "Bearer",
        expiresInSeconds: 7200,
        accountId: "7",
        role: "USER",
      }),
      "alice",
      "pw",
    );

    const renewed = await store.tryRefresh(failTransport(401));

    expect(renewed).toBe(false);
    expect(store.isAuthenticated).toBe(false);
    expect(store.refreshToken).toBeNull();
  });

  it("logout revokes server-side then clears locally, even on transport failure", async () => {
    const store = useAuthStore();
    const t = okTransport({
      accessToken: "a",
      refreshToken: "r",
      tokenType: "Bearer",
      expiresInSeconds: 7200,
      accountId: "7",
      role: "USER",
    });
    await store.login(t, "alice", "pw");

    await store.logout(throwTransport());

    expect(store.isAuthenticated).toBe(false);
    expect(store.accessToken).toBeNull();
    expect(localStorage.getItem("vc.accessToken")).toBeNull();
  });

  it("onUnauthorized clears the session (server 401)", async () => {
    const store = useAuthStore();
    const t = okTransport({
      accessToken: "a",
      refreshToken: "r",
      tokenType: "Bearer",
      expiresInSeconds: 7200,
      accountId: "7",
      role: "USER",
    });
    await store.login(t, "alice", "pw");
    expect(store.isAuthenticated).toBe(true);

    store.onUnauthorized();

    expect(store.isAuthenticated).toBe(false);
    expect(store.accountId).toBeNull();
  });
});
