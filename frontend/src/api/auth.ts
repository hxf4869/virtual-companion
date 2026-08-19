// TASK-0034/TASK-0103: identity API client (login / refresh / logout). The
// transport is injected so the store and specs can mock request() exactly like
// api/memory.spec.ts. Existence is never disclosed (INV-TENANT-001): a non-OK
// auth response maps to null / false and never throws an existence-disclosing
// error, while a transport (network) failure DOES throw so the store can
// surface it without faking success. Credentials and tokens are never placed
// in a URL or a log.
//
// TASK-0103 (P1-09 frontend, Owner decision 2026-08-08): the refresh token
// lives ONLY in the HttpOnly vc_refresh cookie (JS-unreadable) and is never
// parsed, stored or passed by the client -- refresh() and logout() carry no
// refreshToken argument and send no body; the cookie travels automatically
// with credentials:"include" (see transport.ts). The response body no longer
// contains a refreshToken, so AuthTokens has no such field.

export interface AuthApiResponse {
  ok: boolean;
  status: number;
  json: unknown;
}

export interface AuthTransport {
  request(method: string, path: string, body?: unknown): Promise<AuthApiResponse>;
}

export interface AuthTokens {
  accessToken: string;
  tokenType: string;
  expiresInSeconds: number;
  accountId: string;
  role: string;
}

const AUTH_BASE = "/api/v1/auth";

function asString(o: Record<string, unknown>, k: string): string | undefined {
  const v = o[k];
  return typeof v === "string" ? v : undefined;
}

function asTokens(json: unknown): AuthTokens | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const accessToken = asString(o, "accessToken");
  const accountId = asString(o, "accountId");
  const role = asString(o, "role");
  const expiresInSeconds = Number(o.expiresInSeconds);
  if (!accessToken || !accountId || !role || !Number.isFinite(expiresInSeconds)) {
    return null;
  }
  return {
    accessToken,
    tokenType: asString(o, "tokenType") ?? "Bearer",
    expiresInSeconds,
    accountId,
    role,
  };
}

/** Log in. Existence-hidden: non-OK -> null; transport failures propagate. */
export async function login(
  t: AuthTransport,
  username: string,
  password: string,
): Promise<AuthTokens | null> {
  const r = await t.request("POST", `${AUTH_BASE}/login`, { username, password });
  return r.ok ? asTokens(r.json) : null;
}

/**
 * Renew a session from the HttpOnly vc_refresh cookie (sent automatically by
 * the transport with credentials:"include"; no body, no token argument).
 * Existence-hidden: non-OK -> null; transport failures propagate.
 */
export async function refresh(t: AuthTransport): Promise<AuthTokens | null> {
  const r = await t.request("POST", `${AUTH_BASE}/refresh`);
  return r.ok ? asTokens(r.json) : null;
}

/**
 * Revoke a refresh session. The vc_refresh cookie travels automatically; no
 * body, no token argument. true only on an HTTP OK (idempotent).
 */
export async function logout(t: AuthTransport): Promise<boolean> {
  const r = await t.request("POST", `${AUTH_BASE}/logout`);
  return r.ok;
}

/**
 * ACCT-DELETE (FR-AUTH-004): delete the caller's own account. The server
 * clears session cookies and the deletion tombstone blocks login/refresh
 * from then on; business data is removed and the compliance audit trail is
 * kept. true only on a confirmed deletion; a 404 (absent/already deleted)
 * also maps to true so the client ends up logged out either way.
 */
export async function deleteAccount(t: AuthTransport): Promise<boolean> {
  const r = await t.request("DELETE", `${AUTH_BASE}/account`);
  return r.ok;
}

/** ADMIN-UI: one created internal account (OpenAPI AccountResponse). */
export interface CreatedAccount {
  accountId: string;
  username: string;
  role: string;
  status: string;
}

function asCreatedAccount(json: unknown): CreatedAccount | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const accountId = asString(o, "accountId");
  const username = asString(o, "username");
  const role = asString(o, "role");
  const status = asString(o, "status");
  if (!accountId || !username || !role || !status) return null;
  return { accountId, username, role, status };
}

/**
 * ADMIN-UI: create an internal account (ADMIN only,
 * vc.create_internal_account). Existence-hidden: a non-OK response maps to
 * null and never discloses whether the username already exists; transport
 * failures propagate.
 */
export async function createAccount(
  t: AuthTransport,
  username: string,
  password: string,
  displayName: string,
  role: string,
): Promise<CreatedAccount | null> {
  const r = await t.request("POST", `${AUTH_BASE}/admin/accounts`, {
    username,
    password,
    displayName,
    role,
  });
  return r.ok ? asCreatedAccount(r.json) : null;
}

/** ADMIN-ACCTS: one registry entry (OpenAPI AccountListItem). */
export interface AccountListItem {
  accountId: string;
  username: string;
  role: string;
  status: string;
  displayName: string;
  createdAt?: string;
}

function asAccountListItem(json: unknown): AccountListItem | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const accountId = asString(o, "accountId");
  const username = asString(o, "username");
  const role = asString(o, "role");
  const status = asString(o, "status");
  const displayName = asString(o, "displayName");
  if (!accountId || !username || !role || !status || !displayName) return null;
  return { accountId, username, role, status, displayName, createdAt: asString(o, "createdAt") };
}

/**
 * ADMIN-ACCTS: list the account registry (ADMIN only). A non-OK response
 * (403/401) throws so the page surfaces the denial; transport failures
 * propagate.
 */
export async function listAccounts(t: AuthTransport): Promise<AccountListItem[]> {
  const r = await t.request("GET", `${AUTH_BASE}/admin/accounts`);
  if (!r.ok) {
    throw new AuthHttpError(r.status);
  }
  const list = r.json;
  if (!Array.isArray(list)) {
    throw new AuthHttpError(r.status);
  }
  const out: AccountListItem[] = [];
  for (const item of list) {
    const parsed = asAccountListItem(item);
    if (parsed) out.push(parsed);
  }
  return out;
}

/**
 * ADMIN-ACCTS: disable one account (idempotent). true only on a confirmed
 * HTTP OK; 403/404 map to false (existence never disclosed); other non-OK
 * statuses throw.
 */
export async function disableAccount(
  t: AuthTransport,
  accountId: string,
): Promise<boolean> {
  const r = await t.request(
    "POST",
    `${AUTH_BASE}/admin/accounts/${encodeURIComponent(accountId)}/disable`,
  );
  if (r.ok) return true;
  if (r.status === 403 || r.status === 404) return false;
  throw new AuthHttpError(r.status);
}

/** ADMIN-OPS: one audit event row (OpenAPI AuditEventListItem). */
export interface AuditEventListItem {
  id: string;
  eventType: string;
  accountId?: string;
  username: string;
  occurredAt: string;
}

function asAuditEvent(json: unknown): AuditEventListItem | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const id = asString(o, "id");
  const eventType = asString(o, "eventType");
  const username = asString(o, "username");
  const occurredAt = asString(o, "occurredAt");
  if (!id || !eventType || !username || !occurredAt) return null;
  return { id, eventType, username, occurredAt, accountId: asString(o, "accountId") };
}

/**
 * ADMIN-OPS: keyset page of the audit trail (ADMIN only). A non-OK response
 * throws (the page surfaces the denial); transport failures propagate.
 */
export async function listAuditEvents(
  t: AuthTransport,
  after?: string,
  limit?: number,
): Promise<AuditEventListItem[]> {
  const params: string[] = [];
  if (after !== undefined) {
    params.push(`after=${encodeURIComponent(after)}`);
  }
  if (limit !== undefined) {
    params.push(`limit=${limit}`);
  }
  const query = params.length > 0 ? `?${params.join("&")}` : "";
  const r = await t.request("GET", `${AUTH_BASE}/admin/audit${query}`);
  if (!r.ok || !Array.isArray(r.json)) {
    throw new AuthHttpError(r.status);
  }
  const out: AuditEventListItem[] = [];
  for (const item of r.json) {
    const parsed = asAuditEvent(item);
    if (parsed) out.push(parsed);
  }
  return out;
}

/** SAFETY-QUEUE (V59): one admin safety-queue row. */
export interface SafetyEventItem {
  id: string;
  ownerId: string;
  generationId?: string;
  stage: string;
  riskLevel: string;
  ruleId: string;
  createdAt: string;
}

function asSafetyEvent(json: unknown): SafetyEventItem | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const id = asString(o, "id");
  const ownerId = asString(o, "ownerId");
  const stage = asString(o, "stage");
  const riskLevel = asString(o, "riskLevel");
  const ruleId = asString(o, "ruleId");
  const createdAt = asString(o, "createdAt");
  if (!id || !ownerId || !stage || !riskLevel || !ruleId || !createdAt) {
    return null;
  }
  return {
    id, ownerId, stage, riskLevel, ruleId, createdAt,
    generationId: asString(o, "generationId"),
  };
}

/**
 * SAFETY-QUEUE (V59): keyset page of the deterministic safety queue across
 * all owners (ADMIN only, read-only — triage stays human). A non-OK response
 * throws; transport failures propagate.
 */
export async function listSafetyEvents(
  t: AuthTransport,
  after?: string,
  limit?: number,
): Promise<SafetyEventItem[]> {
  const params: string[] = [];
  if (after !== undefined) {
    params.push(`after=${encodeURIComponent(after)}`);
  }
  if (limit !== undefined) {
    params.push(`limit=${limit}`);
  }
  const query = params.length > 0 ? `?${params.join("&")}` : "";
  const r = await t.request("GET", `${AUTH_BASE}/admin/safety-events${query}`);
  if (!r.ok || !Array.isArray(r.json)) {
    throw new AuthHttpError(r.status);
  }
  const out: SafetyEventItem[] = [];
  for (const item of r.json) {
    const parsed = asSafetyEvent(item);
    if (parsed) out.push(parsed);
  }
  return out;
}

/** ADMIN-OPS: one day of settled usage/cost aggregates (UsageSummaryItem). */
export interface UsageSummaryItem {
  day: string;
  generations: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

function asUsageSummaryItem(json: unknown): UsageSummaryItem | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const day = asString(o, "day");
  const generations = Number(o.generations);
  const inputTokens = Number(o.inputTokens);
  const outputTokens = Number(o.outputTokens);
  const cost = Number(o.cost);
  if (!day || !Number.isFinite(generations) || !Number.isFinite(inputTokens)
      || !Number.isFinite(outputTokens) || !Number.isFinite(cost)) {
    return null;
  }
  return { day, generations, inputTokens, outputTokens, cost };
}

/**
 * ADMIN-OPS: per-day usage/cost summary (ADMIN only). A non-OK response
 * throws; transport failures propagate.
 */
export async function usageSummary(
  t: AuthTransport,
  days?: number,
): Promise<UsageSummaryItem[]> {
  const query = days !== undefined ? `?days=${days}` : "";
  const r = await t.request("GET", `${AUTH_BASE}/admin/usage${query}`);
  if (!r.ok || !Array.isArray(r.json)) {
    throw new AuthHttpError(r.status);
  }
  const out: UsageSummaryItem[] = [];
  for (const item of r.json) {
    const parsed = asUsageSummaryItem(item);
    if (parsed) out.push(parsed);
  }
  return out;
}

/** ENT-SNAP (V40): one service-class assignment registry row. */
export interface ServiceClassAssignmentItem {
  accountId: string;
  username: string;
  serviceClass: string;
  assignedAt?: string;
  updatedAt?: string;
}

function asServiceClassAssignment(json: unknown): ServiceClassAssignmentItem | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const accountId = asString(o, "accountId");
  const username = asString(o, "username");
  const serviceClass = asString(o, "serviceClass");
  if (!accountId || !username || !serviceClass) return null;
  return {
    accountId,
    username,
    serviceClass,
    assignedAt: asString(o, "assignedAt"),
    updatedAt: asString(o, "updatedAt"),
  };
}

/**
 * ENT-SNAP: list the service-class assignment registry (ADMIN only). A
 * non-OK response throws; transport failures propagate.
 */
export async function listServiceClassAssignments(
  t: AuthTransport,
): Promise<ServiceClassAssignmentItem[]> {
  const r = await t.request("GET", `${AUTH_BASE}/admin/service-classes`);
  if (!r.ok || !Array.isArray(r.json)) {
    throw new AuthHttpError(r.status);
  }
  const out: ServiceClassAssignmentItem[] = [];
  for (const item of r.json) {
    const parsed = asServiceClassAssignment(item);
    if (parsed) out.push(parsed);
  }
  return out;
}

/**
 * ENT-SNAP: assign a simulated service class to an account (ADMIN only).
 * Returns the applied class on success, null on an existence-hidden 404;
 * other non-OK statuses throw.
 */
export async function assignServiceClass(
  t: AuthTransport,
  accountId: string,
  serviceClass: "ECONOMY" | "PREMIUM",
): Promise<string | null> {
  const r = await t.request("POST", `${AUTH_BASE}/admin/service-class`, {
    accountId,
    serviceClass,
  });
  if (!r.ok) {
    if (r.status === 404) return null;
    throw new AuthHttpError(r.status);
  }
  if (!r.json || typeof r.json !== "object") return null;
  const applied = (r.json as Record<string, unknown>).serviceClass;
  return typeof applied === "string" ? applied : null;
}

/** ADMIN-ACCTS: typed non-OK failure for the registry operations. */
export class AuthHttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`auth admin request failed with status ${status}`);
    this.name = "AuthHttpError";
    this.status = status;
  }
}
