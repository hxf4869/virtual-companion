import type { AuthTransport } from "@/api/auth";

export type AdminAccountStatus =
  | "EMAIL_UNVERIFIED"
  | "PENDING_REVIEW"
  | "ACTIVE"
  | "DISABLED"
  | "REJECTED";

export type AdminReviewDecision = "APPROVE" | "REJECT";

export interface AdminAccount {
  accountId: string;
  email?: string;
  username: string;
  displayName: string;
  role: "USER" | "ADMIN";
  status: AdminAccountStatus;
  emailVerified: boolean;
  authenticatorEnabled: boolean;
  createdAt: string;
  reviewedAt?: string;
}

export class AdminAccountHttpError extends Error {
  constructor(readonly status: number) {
    super(`admin account request failed: ${status}`);
  }
}

const BASE = "/api/v1/admin/accounts";
const STATUSES = new Set<AdminAccountStatus>([
  "EMAIL_UNVERIFIED",
  "PENDING_REVIEW",
  "ACTIVE",
  "DISABLED",
  "REJECTED",
]);

export async function listAdminAccounts(t: AuthTransport): Promise<AdminAccount[]> {
  const response = await t.request("GET", BASE);
  if (!response.ok || !Array.isArray(response.json)) {
    throw new AdminAccountHttpError(response.status);
  }
  const accounts = response.json.map(parseAdminAccount);
  if (accounts.some((account) => account === null)) {
    throw new AdminAccountHttpError(response.status);
  }
  return accounts as AdminAccount[];
}

export async function reviewAdminAccount(
  t: AuthTransport,
  accountId: string,
  decision: AdminReviewDecision,
): Promise<"ACTIVE" | "REJECTED"> {
  const response = await t.request(
    "POST",
    `${BASE}/${encodeURIComponent(accountId)}/review`,
    { decision },
  );
  if (!response.ok || !response.json || typeof response.json !== "object") {
    throw new AdminAccountHttpError(response.status);
  }
  const status = (response.json as Record<string, unknown>).status;
  if ((response.json as Record<string, unknown>).ok !== true ||
      (status !== "ACTIVE" && status !== "REJECTED")) {
    throw new AdminAccountHttpError(response.status);
  }
  return status;
}

export async function resetAdminAuthenticator(
  t: AuthTransport,
  accountId: string,
): Promise<boolean> {
  const response = await t.request(
    "POST",
    `${BASE}/${encodeURIComponent(accountId)}/authenticator-reset`,
  );
  return response.ok && Boolean(
    response.json &&
    typeof response.json === "object" &&
    (response.json as Record<string, unknown>).ok === true,
  );
}

function parseAdminAccount(value: unknown): AdminAccount | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const accountId = text(row.accountId);
  const username = text(row.username);
  const displayName = text(row.displayName);
  const role = text(row.role);
  const status = text(row.status) as AdminAccountStatus | null;
  const createdAt = text(row.createdAt);
  if (!accountId || !username || !displayName ||
      (role !== "USER" && role !== "ADMIN") || !status || !STATUSES.has(status) ||
      typeof row.emailVerified !== "boolean" ||
      typeof row.authenticatorEnabled !== "boolean" || !createdAt) {
    return null;
  }
  return {
    accountId,
    email: text(row.email) ?? undefined,
    username,
    displayName,
    role,
    status,
    emailVerified: row.emailVerified,
    authenticatorEnabled: row.authenticatorEnabled,
    createdAt,
    reviewedAt: text(row.reviewedAt) ?? undefined,
  };
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
