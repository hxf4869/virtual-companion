import { describe, expect, it, vi } from "vitest";

import {
  assignServiceClass,
  createAccount,
  deleteAccount,
  disableAccount,
  listAccounts,
  listAuditEvents,
  createInvite,
  disableInvite,
  inviteRegister,
  listInvites,
  listServiceClassAssignments,
  login,
  logout,
  refresh,
  usageSummary,
  type AuthApiResponse,
  type AuthTransport,
} from "@/api/auth";

function transportFor(response: AuthApiResponse): AuthTransport {
  return { request: vi.fn(async () => response) };
}

describe("auth api client", () => {
  it("parses a confirmed login into tokens (no refreshToken in the response body)", async () => {
    const t = transportFor({
      ok: true,
      status: 200,
      json: {
        accessToken: "a-token",
        tokenType: "Bearer",
        expiresInSeconds: 7200,
        accountId: "7",
        role: "ADMIN",
      },
    });

    const tokens = await login(t, "root", "pw");

    expect(tokens).toEqual({
      accessToken: "a-token",
      tokenType: "Bearer",
      expiresInSeconds: 7200,
      accountId: "7",
      role: "ADMIN",
    });
    expect(t.request).toHaveBeenCalledWith("POST", "/api/v1/auth/login", {
      username: "root",
      password: "pw",
    });
  });

  it("tolerates a legacy response body that still carries refreshToken (ignored)", async () => {
    const t = transportFor({
      ok: true,
      status: 200,
      json: {
        accessToken: "a-token",
        refreshToken: "r-token",
        tokenType: "Bearer",
        expiresInSeconds: 7200,
        accountId: "7",
        role: "USER",
      },
    });

    const tokens = await login(t, "root", "pw");

    expect(tokens?.accessToken).toBe("a-token");
    expect(tokens).not.toHaveProperty("refreshToken");
  });

  it("maps a non-OK login to null (existence never disclosed)", async () => {
    const t = transportFor({
      ok: false,
      status: 404,
      json: { code: "NOT_FOUND_OR_FORBIDDEN", message: "Invalid username or password" },
    });

    expect(await login(t, "root", "wrong")).toBeNull();
  });

  it("maps a disabled-account login to null (fail closed)", async () => {
    const t = transportFor({
      ok: false,
      status: 401,
      json: { code: "AUTHENTICATION_REQUIRED", message: "Account is disabled" },
    });

    expect(await login(t, "root", "pw")).toBeNull();
  });

  it("propagates a transport failure instead of faking success", async () => {
    const t: AuthTransport = { request: vi.fn(async () => Promise.reject(new Error("offline"))) };

    await expect(login(t, "root", "pw")).rejects.toThrow("offline");
  });

  it("refresh sends no body and no token argument (cookie-based)", async () => {
    const t = transportFor({
      ok: true,
      status: 200,
      json: {
        accessToken: "a-2",
        tokenType: "Bearer",
        expiresInSeconds: 7200,
        accountId: "7",
        role: "USER",
      },
    });

    const tokens = await refresh(t);

    expect(tokens?.accessToken).toBe("a-2");
    expect(tokens).not.toHaveProperty("refreshToken");
    expect(t.request).toHaveBeenCalledWith("POST", "/api/v1/auth/refresh");
  });

  it("maps an invalid refresh to null", async () => {
    const t = transportFor({
      ok: false,
      status: 401,
      json: { code: "AUTHENTICATION_REQUIRED", message: "The refresh session is no longer valid" },
    });

    expect(await refresh(t)).toBeNull();
  });

  it("logout is true only on HTTP OK and sends no body (cookie-based)", async () => {
    const t = transportFor({ ok: true, status: 200, json: { ok: true } });

    expect(await logout(t)).toBe(true);
    expect(t.request).toHaveBeenCalledWith("POST", "/api/v1/auth/logout");
  });

  it("deleteAccount sends a DELETE to the account path and is true on OK", async () => {
    const t = transportFor({ ok: true, status: 200, json: { ok: true } });

    expect(await deleteAccount(t)).toBe(true);
    expect(t.request).toHaveBeenCalledWith("DELETE", "/api/v1/auth/account");
  });

  it("deleteAccount maps a non-OK (already deleted) to false", async () => {
    const t = transportFor({ ok: false, status: 404, json: null });

    expect(await deleteAccount(t)).toBe(false);
  });

  it("rejects a malformed token payload without crashing", async () => {
    const t = transportFor({ ok: true, status: 200, json: { accessToken: "x" } });

    expect(await login(t, "root", "pw")).toBeNull();
  });
});

describe("listAccounts/disableAccount (ADMIN-ACCTS)", () => {
  it("lists the account registry on OK", async () => {
    const t = transportFor({
      ok: true,
      status: 200,
      json: [
        { accountId: "1", username: "root", role: "ADMIN", status: "ACTIVE", displayName: "Root" },
        { accountId: "7", username: "alice", role: "USER", status: "DISABLED", displayName: "Alice" },
      ],
    });

    const list = await listAccounts(t);

    expect(list).toHaveLength(2);
    expect(list[0].username).toBe("root");
    expect(list[1].status).toBe("DISABLED");
    expect(t.request).toHaveBeenCalledWith("GET", "/api/v1/auth/admin/accounts");
  });

  it("throws a typed error on a non-OK registry read", async () => {
    const t = transportFor({ ok: false, status: 403, json: null });

    await expect(listAccounts(t)).rejects.toMatchObject({ status: 403 });
  });

  it("POSTs the disable action and reports true on OK", async () => {
    const t = transportFor({
      ok: true,
      status: 200,
      json: { accountId: "7", status: "DISABLED" },
    });

    expect(await disableAccount(t, "7")).toBe(true);
    expect(t.request).toHaveBeenCalledWith(
      "POST",
      "/api/v1/auth/admin/accounts/7/disable",
    );
  });

  it("maps 403/404 to false (existence never disclosed)", async () => {
    const t403 = transportFor({ ok: false, status: 403, json: null });
    expect(await disableAccount(t403, "999")).toBe(false);

    const t404 = transportFor({ ok: false, status: 404, json: null });
    expect(await disableAccount(t404, "999")).toBe(false);
  });

  it("throws a typed error on a 5xx disable", async () => {
    const t = transportFor({ ok: false, status: 500, json: null });

    await expect(disableAccount(t, "7")).rejects.toMatchObject({ status: 500 });
  });
});

describe("listAuditEvents/usageSummary (ADMIN-OPS)", () => {
  it("lists the audit trail with the after cursor on OK", async () => {
    const t = transportFor({
      ok: true,
      status: 200,
      json: [
        {
          id: "500",
          eventType: "ACCOUNT_CREATE",
          accountId: "7",
          username: "alice",
          occurredAt: "2026-08-16T08:00:00Z",
        },
      ],
    });

    const list = await listAuditEvents(t, "501", 50);

    expect(list).toHaveLength(1);
    expect(list[0].eventType).toBe("ACCOUNT_CREATE");
    expect(list[0].accountId).toBe("7");
    expect(t.request).toHaveBeenCalledWith(
      "GET",
      "/api/v1/auth/admin/audit?after=501&limit=50",
    );
  });

  it("omits the query string when no cursor is given", async () => {
    const t = transportFor({ ok: true, status: 200, json: [] });

    await listAuditEvents(t);

    expect(t.request).toHaveBeenCalledWith("GET", "/api/v1/auth/admin/audit");
  });

  it("throws a typed error on a non-OK audit read", async () => {
    const t = transportFor({ ok: false, status: 403, json: null });

    await expect(listAuditEvents(t)).rejects.toMatchObject({ status: 403 });
  });

  it("parses the usage summary rows on OK", async () => {
    const t = transportFor({
      ok: true,
      status: 200,
      json: [
        { day: "2026-08-16", generations: 3, inputTokens: 1200, outputTokens: 800, cost: 0.012 },
      ],
    });

    const rows = await usageSummary(t, 14);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      day: "2026-08-16",
      generations: 3,
      inputTokens: 1200,
      outputTokens: 800,
      cost: 0.012,
    });
    expect(t.request).toHaveBeenCalledWith("GET", "/api/v1/auth/admin/usage?days=14");
  });

  it("throws a typed error on a non-OK usage read", async () => {
    const t = transportFor({ ok: false, status: 403, json: null });

    await expect(usageSummary(t)).rejects.toMatchObject({ status: 403 });
  });
});

describe("createAccount (ADMIN-UI)", () => {
  it("POSTs the account body and parses the created account", async () => {
    const t = transportFor({
      ok: true,
      status: 200,
      json: { accountId: "9", username: "alice", role: "USER", status: "ACTIVE" },
    });

    const created = await createAccount(t, "alice", "pw-1", "Alice", "USER");

    expect(created).toEqual({
      accountId: "9",
      username: "alice",
      role: "USER",
      status: "ACTIVE",
    });
    expect(t.request).toHaveBeenCalledWith("POST", "/api/v1/auth/admin/accounts", {
      username: "alice",
      password: "pw-1",
      displayName: "Alice",
      role: "USER",
    });
  });

  it("maps a non-OK response to null (existence never disclosed)", async () => {
    const t = transportFor({
      ok: false,
      status: 404,
      json: { code: "NOT_FOUND_OR_FORBIDDEN", message: "hidden" },
    });

    expect(await createAccount(t, "alice", "pw-1", "Alice", "USER")).toBeNull();
  });

  it("maps a non-admin denial to null", async () => {
    const t = transportFor({
      ok: false,
      status: 403,
      json: { code: "ACCESS_DENIED", message: "admin only" },
    });

    expect(await createAccount(t, "alice", "pw-1", "Alice", "USER")).toBeNull();
  });

  it("rejects a malformed account payload without crashing", async () => {
    const t = transportFor({ ok: true, status: 200, json: { accountId: "9" } });

    expect(await createAccount(t, "alice", "pw-1", "Alice", "USER")).toBeNull();
  });
});

describe("service-class assignments (ENT-SNAP)", () => {
  it("lists the assignment registry on OK", async () => {
    const t = transportFor({
      ok: true,
      status: 200,
      json: [
        { accountId: "7", username: "alice", serviceClass: "ECONOMY" },
        { accountId: "9", username: "bob", serviceClass: "PREMIUM", assignedAt: "2026-08-16T08:00:00Z" },
      ],
    });

    const list = await listServiceClassAssignments(t);

    expect(list).toHaveLength(2);
    expect(list[1].serviceClass).toBe("PREMIUM");
    expect(t.request).toHaveBeenCalledWith("GET", "/api/v1/auth/admin/service-classes");
  });

  it("throws a typed error on a non-OK registry read", async () => {
    const t = transportFor({ ok: false, status: 403, json: null });

    await expect(listServiceClassAssignments(t)).rejects.toMatchObject({ status: 403 });
  });

  it("POSTs the assignment and returns the applied class", async () => {
    const t = transportFor({
      ok: true,
      status: 200,
      json: { accountId: "7", serviceClass: "PREMIUM" },
    });

    expect(await assignServiceClass(t, "7", "PREMIUM")).toBe("PREMIUM");
    expect(t.request).toHaveBeenCalledWith("POST", "/api/v1/auth/admin/service-class", {
      accountId: "7",
      serviceClass: "PREMIUM",
    });
  });

  it("maps a 404 to null (existence hidden)", async () => {
    const t = transportFor({ ok: false, status: 404, json: null });

    expect(await assignServiceClass(t, "999", "ECONOMY")).toBeNull();
  });
});

describe("invite codes (INVITE V60)", () => {
  it("POSTs the mint and parses the new code", async () => {
    const t = transportFor({
      ok: true,
      status: 200,
      json: { id: "9", code: "INVITE-ABC123XYZ", expiresAt: "2026-09-02T00:00:00Z" },
    });

    const created = await createInvite(t);

    expect(created.code).toBe("INVITE-ABC123XYZ");
    expect(created.expiresAt).toBe("2026-09-02T00:00:00Z");
  });

  it("parses the registry rows and skips malformed ones", async () => {
    const t = transportFor({
      ok: true,
      status: 200,
      json: [
        {
          id: "9",
          code: "INVITE-ABC123XYZ",
          status: "USED",
          createdAt: "2026-08-19T08:00:00Z",
          usedAt: "2026-08-19T09:00:00Z",
          expiresAt: "2026-09-02T00:00:00Z",
          usedByAccount: "12",
        },
        { id: "10" },
      ],
    });

    const rows = await listInvites(t);

    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("USED");
    expect(rows[0].usedByAccount).toBe("12");
  });

  it("disable maps the ok flag and throws on failure", async () => {
    const ok = transportFor({ ok: true, status: 200, json: { ok: true } });
    await expect(disableInvite(ok, "INVITE-ABC123XYZ")).resolves.toBe(true);

    const fail = transportFor({ ok: false, status: 500, json: null });
    await expect(disableInvite(fail, "INVITE-ABC123XYZ")).rejects.toMatchObject({
      name: "AuthHttpError",
    });
  });

  it("invite-register posts the body and throws the typed 403 when gated off", async () => {
    const t = transportFor({
      ok: true,
      status: 200,
      json: { accountId: "12", username: "bob", role: "USER", status: "ACTIVE" },
    });

    const created = await inviteRegister(t, {
      code: "INVITE-ABC123XYZ",
      username: "bob",
      password: "pw",
      displayName: "Bob",
    });

    expect(created.username).toBe("bob");

    const gated = transportFor({
      ok: false,
      status: 403,
      json: { code: "BETA_OPERATIONS_NOT_READY" },
    });
    await expect(
      inviteRegister(gated, {
        code: "X",
        username: "x",
        password: "p",
        displayName: "d",
      }),
    ).rejects.toMatchObject({ name: "AuthHttpError", status: 403 });
  });
});
