import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthTokens, AuthTransport } from "@/api/auth";
import { useAuthStore } from "@/stores/auth";
import { useAgeStore } from "@/stores/age";
import { useChatStore } from "@/stores/chat";
import { useConsentStore } from "@/stores/consent";
import { useDataStore } from "@/stores/data";
import { useExportStore } from "@/stores/export";
import { useIncognitoStore } from "@/stores/incognito";
import { useMemoryStore } from "@/stores/memory";
import { useRelationshipStore } from "@/stores/relationship";
import { useReminderStore } from "@/stores/reminder";

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

function sampleTokens(accessToken = "a"): AuthTokens {
  return {
    accessToken,
    tokenType: "Bearer",
    expiresInSeconds: 7200,
    accountId: "7",
    role: "USER",
  };
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

  it("confirms login and holds tokens in memory only (no localStorage writes)", async () => {
    const store = useAuthStore();
    const storage = localStorage as unknown as ReturnType<typeof makeStorage>;

    const ok = await store.login(okTransport(sampleTokens("a")), "root", "pw");

    expect(ok).toBe(true);
    expect(store.isAuthenticated).toBe(true);
    expect(store.accessToken).toBe("a");
    expect(store.accountId).toBe("7");
    expect(store.role).toBe("USER");
    // P1-09: XSS-readable storage must never hold credentials.
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.getItem("vc.accessToken")).toBeNull();
    expect(storage.getItem("vc.refreshToken")).toBeNull();
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

  it("renews from the HttpOnly cookie with no stored refresh token", async () => {
    const store = useAuthStore();
    await store.login(okTransport(sampleTokens("a1")), "alice", "pw");

    const t = okTransport(sampleTokens("a2"));
    const renewed = await store.tryRefresh(t);

    expect(renewed).toBe(true);
    expect(store.accessToken).toBe("a2");
    // The cookie-based refresh sends no body and no token argument.
    expect(t.request).toHaveBeenCalledWith("POST", "/api/v1/auth/refresh");
  });

  it("clears the session when a refresh is rejected (no fabricated continuation)", async () => {
    const store = useAuthStore();
    await store.login(okTransport(sampleTokens("a1")), "alice", "pw");

    const renewed = await store.tryRefresh(failTransport(401));

    expect(renewed).toBe(false);
    expect(store.isAuthenticated).toBe(false);
    expect(store.accessToken).toBeNull();
  });

  it("SESS-REVIVE: renewAccessToken reports renewed and rotates the token in place", async () => {
    const store = useAuthStore();
    await store.login(okTransport(sampleTokens("a1")), "alice", "pw");

    const t = okTransport(sampleTokens("a2"));
    const outcome = await store.renewAccessToken(t);

    expect(outcome).toBe("renewed");
    expect(store.accessToken).toBe("a2");
    expect(t.request).toHaveBeenCalledWith("POST", "/api/v1/auth/refresh");
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
    expect(store.accessToken).toBe("a1");
  });

  it("logout revokes server-side (cookie) then clears locally, even on transport failure", async () => {
    const store = useAuthStore();
    const t = okTransport(sampleTokens("a"));
    await store.login(t, "alice", "pw");

    const logoutT = okTransport(sampleTokens());
    await store.logout(logoutT);

    expect(logoutT.request).toHaveBeenCalledWith("POST", "/api/v1/auth/logout");
    expect(store.isAuthenticated).toBe(false);
    expect(store.accessToken).toBeNull();

    // Transport failure still clears the local session (best effort revoke).
    await store.login(okTransport(sampleTokens("a2")), "alice", "pw");
    await store.logout(throwTransport());
    expect(store.isAuthenticated).toBe(false);
  });

  it("LOGOUT-CLEAR: logout drops in-memory chat, memory, and relationship caches", async () => {
    const auth = useAuthStore();
    await auth.login(okTransport(sampleTokens("a")), "alice", "pw");
    const chat = useChatStore();
    const memory = useMemoryStore();
    const rel = useRelationshipStore();
    chat.conversationId = "99";
    chat.messages = [
      { messageId: "m1", conversationId: "99", role: "user", content: "secret" },
    ];
    memory.canonical = [
      { memoryId: "mem-1", scope: "RELATIONSHIP", summary: "不该留给下一账号", status: "ACCEPTED" },
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
    expect(memory.canonical).toEqual([]);
    expect(rel.relationships).toEqual([]);
    expect(rel.currentRelationshipId).toBeNull();
  });

  it("LOGOUT-CLEAR: logout also drops consent, data, export, reminder, age and incognito caches", async () => {
    const auth = useAuthStore();
    await auth.login(okTransport(sampleTokens("a")), "alice", "pw");
    const consent = useConsentStore();
    const data = useDataStore();
    const exported = useExportStore();
    const reminder = useReminderStore();
    const age = useAgeStore();
    const incognito = useIncognitoStore();
    consent.records = [
      {
        consentId: "c1",
        consentType: "SERVICE_TERMS",
        version: "2026-08",
        granted: true,
        grantedAt: "t",
      },
    ];
    data.conversations = [
      { conversationId: "9", relationshipId: "1", lastMessagePreview: "secret" },
    ];
    exported.request = { exportId: "e1", status: "READY" } as never;
    reminder.reminders = [{ reminderId: "r1", relationshipId: "1", text: "secret", remindAt: "t", recurrence: "NONE", status: "ACTIVE", createdAt: "t" }];
    age.record = { ageState: "ADULT_VERIFIED", providerRef: "x", verifiedAt: "t" };
    incognito.defaultIncognito = true;

    await auth.logout(okTransport(sampleTokens()));

    expect(consent.records).toEqual([]);
    expect(data.conversations).toEqual([]);
    expect(exported.request).toBeNull();
    expect(reminder.reminders).toEqual([]);
    expect(age.ageState).toBe("AGE_UNKNOWN");
    expect(incognito.defaultIncognito).toBe(false);
  });

  it("LOGOUT-CLEAR: a failed refresh without an existing session does not wipe caches", async () => {
    const memory = useMemoryStore();
    memory.canonical = [
      { memoryId: "mem-1", scope: "RELATIONSHIP", summary: "预置", status: "ACCEPTED" },
    ];
    const auth = useAuthStore();
    expect(auth.isAuthenticated).toBe(false);

    await auth.tryRefresh(failTransport(401));

    expect(memory.canonical).toHaveLength(1);
    expect(memory.canonical[0]?.memoryId).toBe("mem-1");
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
    expect(redirectTo).toHaveBeenCalledWith({ url: "/pages/login/login" });
  });
});
