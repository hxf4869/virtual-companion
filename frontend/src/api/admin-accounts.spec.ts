import { describe, expect, it, vi } from "vitest";

import type { AuthTransport } from "@/api/auth";

import {
  listAdminAccounts,
  resetAdminAuthenticator,
  reviewAdminAccount,
} from "./admin-accounts";

function transport(json: unknown, status = 200): AuthTransport {
  return {
    request: vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json,
    })),
  };
}

const account = {
  accountId: "7",
  email: "alice@example.com",
  username: "alice",
  displayName: "Alice",
  role: "USER",
  status: "PENDING_REVIEW",
  emailVerified: true,
  authenticatorEnabled: false,
  createdAt: "2026-09-01T00:00:00Z",
};

describe("admin accounts API", () => {
  it("parses the secret-free account registry", async () => {
    const t = transport([account]);
    await expect(listAdminAccounts(t)).resolves.toEqual([account]);
    expect(t.request).toHaveBeenCalledWith("GET", "/api/v1/admin/accounts");
  });

  it("rejects malformed rows instead of inventing account facts", async () => {
    await expect(listAdminAccounts(transport([{ ...account, emailVerified: "yes" }])))
      .rejects.toThrow();
  });

  it("submits one explicit review decision", async () => {
    const t = transport({ ok: true, status: "ACTIVE" });
    await expect(reviewAdminAccount(t, "7", "APPROVE")).resolves.toBe("ACTIVE");
    expect(t.request).toHaveBeenCalledWith(
      "POST",
      "/api/v1/admin/accounts/7/review",
      { decision: "APPROVE" },
    );
  });

  it("uses the existing authenticator-reset endpoint", async () => {
    const t = transport({ ok: true });
    await expect(resetAdminAuthenticator(t, "7")).resolves.toBe(true);
    expect(t.request).toHaveBeenCalledWith(
      "POST",
      "/api/v1/admin/accounts/7/authenticator-reset",
    );
  });
});
