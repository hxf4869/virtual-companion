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

import { redactOpsCase, type PublicOpsCase } from "@/domain/ops-case-redact";

export interface AuthApiResponse {
  ok: boolean;
  status: number;
  json: unknown;
}

export interface AuthTransport {
  request(method: string, path: string, body?: unknown): Promise<AuthApiResponse>;
}

export interface AuthTokens {
  accountId: string;
  role: string;
  passwordMustChange: boolean;
  expiresInSeconds: number;
}

const AUTH_BASE = "/api/v1/auth";

function asString(o: Record<string, unknown>, k: string): string | undefined {
  const v = o[k];
  return typeof v === "string" ? v : undefined;
}

function asTokens(json: unknown): AuthTokens | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const accountId = asString(o, "accountId");
  const role = asString(o, "role");
  const passwordMustChange = o.passwordMustChange;
  const expiresInSeconds = Number(o.expiresInSeconds);
  if (!accountId || !role || typeof passwordMustChange !== "boolean") {
    return null;
  }
  return {
    accountId,
    role,
    passwordMustChange,
    expiresInSeconds: Number.isFinite(expiresInSeconds) ? expiresInSeconds : 0,
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
 * Restore identity from the opaque session cookie via GET /auth/sessions.
 * /auth/refresh is RETIRE. Existence-hidden: non-OK -> null.
 */
export async function refresh(t: AuthTransport): Promise<AuthTokens | null> {
  return restoreSession(t);
}

export async function restoreSession(t: AuthTransport): Promise<AuthTokens | null> {
  const sessions = await listAuthSessionsOrNull(t);
  if (sessions === null) return null;
  const current = sessions.find((s) => s.current) ?? sessions[0];
  if (!current?.accountId || !current.role) return null;
  return {
    accountId: current.accountId,
    role: current.role,
    passwordMustChange: current.passwordMustChange === true,
    expiresInSeconds: 0,
  };
}

/**
 * Revoke a refresh session. The vc_refresh cookie travels automatically; no
 * body, no token argument. true only on an HTTP OK (idempotent).
 */
export async function logout(t: AuthTransport): Promise<boolean> {
  const r = await t.request("POST", `${AUTH_BASE}/logout`);
  return r.ok;
}

export interface AuthSession {
  id: string;
  familyId?: string;
  clientLabel?: string;
  createdAt: string;
  lastSeenAt?: string;
  expiresAt: string;
  current: boolean;
  accountId?: string;
  role?: string;
  passwordMustChange?: boolean;
}

function asAuthSession(json: unknown): AuthSession | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const id = asString(o, "id");
  const createdAt = asString(o, "createdAt");
  const expiresAt = asString(o, "expiresAt");
  if (!id || !createdAt || !expiresAt || typeof o.current !== "boolean") return null;
  return {
    id,
    familyId: asString(o, "familyId"),
    createdAt,
    lastSeenAt: asString(o, "lastSeenAt") ?? createdAt,
    expiresAt,
    current: o.current,
    clientLabel: asString(o, "clientLabel"),
    accountId: asString(o, "accountId"),
    role: asString(o, "role"),
    passwordMustChange: typeof o.passwordMustChange === "boolean" ? o.passwordMustChange : undefined,
  };
}

export async function listAuthSessions(t: AuthTransport): Promise<AuthSession[]> {
  const r = await t.request("GET", `${AUTH_BASE}/sessions`);
  if (!r.ok || !Array.isArray(r.json)) throw new AuthHttpError(r.status);
  const sessions = r.json.map(asAuthSession);
  if (sessions.some((session) => session === null)) throw new AuthHttpError(r.status);
  return sessions as AuthSession[];
}

async function listAuthSessionsOrNull(t: AuthTransport): Promise<AuthSession[] | null> {
  const r = await t.request("GET", `${AUTH_BASE}/sessions`);
  if (!r.ok || !Array.isArray(r.json)) return null;
  const sessions = r.json.map(asAuthSession);
  if (sessions.some((session) => session === null)) return null;
  return sessions as AuthSession[];
}

export async function revokeAuthSession(
  t: AuthTransport,
  sessionId: string,
): Promise<boolean> {
  const r = await t.request(
    "DELETE", `${AUTH_BASE}/sessions/${encodeURIComponent(sessionId)}`,
  );
  return r.ok;
}

export async function revokeAllAuthSessions(t: AuthTransport): Promise<number> {
  const r = await t.request("POST", `${AUTH_BASE}/sessions/revoke-all`);
  if (!r.ok || !r.json || typeof r.json !== "object") throw new AuthHttpError(r.status);
  const revoked = Number((r.json as Record<string, unknown>).revoked);
  if (!Number.isInteger(revoked) || revoked < 0) throw new AuthHttpError(r.status);
  return revoked;
}

export async function changeAuthPassword(
  t: AuthTransport,
  currentPassword: string,
  newPassword: string,
): Promise<boolean> {
  const r = await t.request(
    "POST", `${AUTH_BASE}/password`, { currentPassword, newPassword },
  );
  return r.ok && (r.json as Record<string, unknown> | null)?.ok === true;
}

export async function reauthAuth(t: AuthTransport, password: string): Promise<boolean> {
  const r = await t.request("POST", `${AUTH_BASE}/reauth`, { password });
  return r.ok && (r.json as Record<string, unknown> | null)?.ok === true;
}

export async function adminResetPassword(
  t: AuthTransport,
  accountId: string,
  newPassword: string,
): Promise<boolean> {
  const r = await t.request(
    "POST",
    `${AUTH_BASE}/admin/accounts/${encodeURIComponent(accountId)}/reset-password`,
    { newPassword },
  );
  if (!r.ok || !r.json || typeof r.json !== "object") return false;
  const o = r.json as Record<string, unknown>;
  return o.ok === true && o.passwordMustChange === true;
}

/**
 * ACCT-DELETE (FR-AUTH-004) + ADR-0006 §7.7 (DOGFOOD-08): delete the caller's
 * own account. The server verifies the freshly re-entered CURRENT password
 * fail-closed before the destructive cascade, then clears session cookies and
 * the deletion tombstone blocks login/refresh from then on; business data is
 * removed and the compliance audit trail is kept. true ONLY on a confirmed
 * deletion: a wrong password maps to the server's non-disclosing 404 (same
 * surface as absent/already-deleted), so a non-OK is reported as false and
 * the caller keeps the session (fail-closed re-entry).
 */
export async function deleteAccount(
  t: AuthTransport,
  currentPassword?: string,
): Promise<boolean> {
  const r = await t.request(
    "DELETE",
    `${AUTH_BASE}/account`,
    { currentPassword: currentPassword ?? "" },
  );
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

/** INVITE (V60): a freshly minted single-use invite code. */
export interface InviteCreated {
  id: string;
  code: string;
  expiresAt: string;
}

/** INVITE (V60): one invite registry row. */
export interface InviteListItem {
  id: string;
  code: string;
  status: "ACTIVE" | "USED" | "DISABLED";
  createdAt: string;
  usedAt: string | null;
  expiresAt: string;
  usedByAccount: string | null;
}

/** INVITE (V60): ADMIN mints one code (14-day expiry). Non-OK throws. */
export async function createInvite(t: AuthTransport): Promise<InviteCreated> {
  const r = await t.request("POST", `${AUTH_BASE}/admin/invites`);
  if (!r.ok) {
    throw new AuthHttpError(r.status);
  }
  const o = (r.json ?? {}) as Record<string, unknown>;
  const id = asString(o, "id");
  const code = asString(o, "code");
  const expiresAt = asString(o, "expiresAt");
  if (!id || !code || !expiresAt) {
    throw new AuthHttpError(r.status);
  }
  return { id, code, expiresAt };
}

function asInvite(json: unknown): InviteListItem | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const id = asString(o, "id");
  const code = asString(o, "code");
  const status = asString(o, "status");
  const createdAt = asString(o, "createdAt");
  const expiresAt = asString(o, "expiresAt");
  if (!id || !code || !status || !createdAt || !expiresAt) return null;
  if (status !== "ACTIVE" && status !== "USED" && status !== "DISABLED") return null;
  return {
    id, code, status, createdAt, expiresAt,
    usedAt: asString(o, "usedAt") ?? null,
    usedByAccount: asString(o, "usedByAccount") ?? null,
  };
}

/** INVITE (V60): ADMIN registry read, newest first. Non-OK throws. */
export async function listInvites(t: AuthTransport): Promise<InviteListItem[]> {
  const r = await t.request("GET", `${AUTH_BASE}/admin/invites`);
  if (!r.ok || !Array.isArray(r.json)) {
    throw new AuthHttpError(r.status);
  }
  const out: InviteListItem[] = [];
  for (const item of r.json) {
    const parsed = asInvite(item);
    if (parsed) out.push(parsed);
  }
  return out;
}

/** INVITE (V60): ADMIN retires an ACTIVE code (idempotent). */
export async function disableInvite(t: AuthTransport, code: string): Promise<boolean> {
  const r = await t.request("POST", `${AUTH_BASE}/admin/invites/disable`, { code });
  if (!r.ok) {
    throw new AuthHttpError(r.status);
  }
  const o = (r.json ?? {}) as Record<string, unknown>;
  return o.ok === true;
}

/**
 * INVITE (V60): anonymous provisioning through a single-use code. Config-gated
 * on the server (disabled → 403 BETA_OPERATIONS_NOT_READY); the thrown typed
 * error carries that status so the page can show the plain server wording.
 */
export async function inviteRegister(
  t: AuthTransport,
  body: { code: string; username: string; password: string; displayName: string },
): Promise<{ accountId: string; username: string }> {
  const r = await t.request("POST", `${AUTH_BASE}/invite-register`, body);
  if (!r.ok) {
    throw new AuthHttpError(r.status);
  }
  const o = (r.json ?? {}) as Record<string, unknown>;
  const accountId = asString(o, "accountId");
  const username = asString(o, "username");
  if (!accountId || !username) {
    throw new AuthHttpError(r.status);
  }
  return { accountId, username };
}

/** QUOTA-PERSIST (V61): one reconciliation result row. */
export interface QuotaReconciliation {
  settledCount: number;
  settledAmount: number;
  releasedCount: number;
  releasedAmount: number;
  settledNotCompleted: number;
  completedNotSettled: number;
  failedWithoutRelease: number;
}

/** QUOTA-PERSIST (V61): one persisted deployment registry row. */
export interface ProviderRegistryItem {
  providerId: string;
  protocol: string;
  admissionState: "ADMITTED" | "DISABLED" | "REJECTED";
  updatedAt: string;
}

/** ENT-TRIAL (V61): ADMIN grants a trial (defaults 20 turns / 14 days). */
export async function grantTrial(
  t: AuthTransport,
  accountId: string,
  turns?: number,
  days?: number,
): Promise<string> {
  const body: Record<string, unknown> = { accountId };
  if (turns !== undefined) body.turns = turns;
  if (days !== undefined) body.days = days;
  const r = await t.request("POST", `${AUTH_BASE}/admin/trial-grants`, body);
  if (!r.ok) {
    throw new AuthHttpError(r.status);
  }
  const grantId = asString(r.json as Record<string, unknown>, "grantId");
  if (!grantId) {
    throw new AuthHttpError(r.status);
  }
  return grantId;
}

/** QUOTA-PERSIST (V61): ledger reconciliation over the window. */
export async function quotaReconciliation(
  t: AuthTransport,
  days?: number,
): Promise<QuotaReconciliation | null> {
  const query = days !== undefined ? `?days=${days}` : "";
  const r = await t.request("GET", `${AUTH_BASE}/admin/quota-reconciliation${query}`);
  if (!r.ok || !r.json || typeof r.json !== "object") {
    throw new AuthHttpError(r.status);
  }
  const o = r.json as Record<string, unknown>;
  const num = (key: string): number | undefined => {
    const v = o[key];
    return typeof v === "number" && Number.isFinite(v) ? v : undefined;
  };
  const fields = ["settledCount", "settledAmount", "releasedCount", "releasedAmount",
    "settledNotCompleted", "completedNotSettled", "failedWithoutRelease"];
  const values = fields.map(num);
  if (values.some((v) => v === undefined)) {
    return null;
  }
  return {
    settledCount: values[0]!,
    settledAmount: values[1]!,
    releasedCount: values[2]!,
    releasedAmount: values[3]!,
    settledNotCompleted: values[4]!,
    completedNotSettled: values[5]!,
    failedWithoutRelease: values[6]!,
  };
}

/** QUOTA-PERSIST (V61): the persisted deployment registry. */
export async function providerRegistry(t: AuthTransport): Promise<ProviderRegistryItem[]> {
  const r = await t.request("GET", `${AUTH_BASE}/admin/provider-registry`);
  if (!r.ok || !Array.isArray(r.json)) {
    throw new AuthHttpError(r.status);
  }
  const out: ProviderRegistryItem[] = [];
  for (const item of r.json) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const providerId = asString(o, "providerId");
    const protocol = asString(o, "protocol");
    const admissionState = asString(o, "admissionState");
    const updatedAt = asString(o, "updatedAt");
    if (!providerId || !protocol || !admissionState || !updatedAt) continue;
    if (admissionState !== "ADMITTED" && admissionState !== "DISABLED"
        && admissionState !== "REJECTED") {
      continue;
    }
    out.push({ providerId, protocol, admissionState, updatedAt });
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
  ageHours: number;
  slaBreached: boolean;
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
  const ageHours = typeof o.ageHours === "number" ? o.ageHours : undefined;
  if (!id || !ownerId || !stage || !riskLevel || !ruleId || !createdAt
      || ageHours === undefined) {
    return null;
  }
  return {
    id, ownerId, stage, riskLevel, ruleId, createdAt, ageHours,
    slaBreached: o.slaBreached === true,
    generationId: asString(o, "generationId"),
  };
}

/**
 * SAFETY-QUEUE (V59): keyset page of the deterministic safety queue across
 * all owners (ADMIN only, read-only — triage stays human). A non-OK response
 * throws; transport failures propagate.
 */
export async function listOpsCases(
  t: AuthTransport,
  after?: string,
  limit?: number,
): Promise<PublicOpsCase[]> {
  const r = await t.request("GET", `${AUTH_BASE}/admin/ops-cases${keysetQuery(after, limit)}`);
  if (!r.ok || !Array.isArray(r.json)) {
    throw new AuthHttpError(r.status);
  }
  const out: PublicOpsCase[] = [];
  for (const item of r.json) {
    const parsed = redactOpsCase(item);
    if (parsed) out.push(parsed);
  }
  return out;
}

export async function transitionOpsCase(
  t: AuthTransport,
  caseId: string,
  action: "ACK" | "ASSIGN" | "ESCALATE" | "RESOLVE",
  dispositionReason?: string,
): Promise<{ id: string; status: string }> {
  const r = await t.request("POST", `${AUTH_BASE}/admin/ops-cases/${encodeURIComponent(caseId)}/actions`, {
    action,
    dispositionReason,
  });
  if (!r.ok || !r.json || typeof r.json !== "object") {
    throw new AuthHttpError(r.status);
  }
  const o = r.json as Record<string, unknown>;
  const id = asString(o, "id");
  const status = asString(o, "status");
  if (!id || !status) {
    throw new AuthHttpError(r.status);
  }
  return { id, status };
}

export async function updateOpsCaseNote(
  t: AuthTransport,
  caseId: string,
  visibility: "INTERNAL" | "PUBLIC",
  note: string,
): Promise<PublicOpsCase> {
  const r = await t.request(
    "PUT",
    `${AUTH_BASE}/admin/ops-cases/${encodeURIComponent(caseId)}/notes`,
    { visibility, note },
  );
  const parsed = r.ok ? redactOpsCase(r.json) : null;
  if (!parsed) throw new AuthHttpError(r.status);
  return parsed;
}

export async function readOpsCaseInternalNote(
  t: AuthTransport,
  caseId: string,
): Promise<string> {
  const r = await t.request(
    "GET",
    `${AUTH_BASE}/admin/ops-cases/${encodeURIComponent(caseId)}/internal-note`,
  );
  if (!r.ok || !r.json || typeof r.json !== "object") {
    throw new AuthHttpError(r.status);
  }
  const note = (r.json as Record<string, unknown>).note;
  if (typeof note !== "string") throw new AuthHttpError(r.status);
  return note;
}

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

/** ADMIN-BETA (V64): one report/complaint queue row (read-only). */
export interface BetaReportItem {
  id: string;
  ownerId: string;
  messageId?: string;
  reason: string;
  note: string;
  status: string;
  createdAt: string;
}

/** ADMIN-BETA (V64): one age-appeal queue row (read-only). */
export interface BetaAgeAppealItem {
  id: string;
  ownerId: string;
  reason: string;
  status: string;
  createdAt: string;
}

/** ADMIN-BETA (V64): one async export-task row (ids/statuses only). */
export interface BetaExportTaskItem {
  id: string;
  ownerId: string;
  status: string;
  createdAt: string;
  completedAt?: string;
}

/** ADMIN-BETA (V64): one memory-anomaly sampling row (summary only). */
export interface BetaMemorySamplingItem {
  id: string;
  ownerId: string;
  relationshipId: string;
  scope: string;
  summary: string;
  status: string;
  deletedAt?: string;
  createdAt: string;
}

function keysetQuery(after?: string, limit?: number): string {
  const params: string[] = [];
  if (after !== undefined) {
    params.push(`after=${encodeURIComponent(after)}`);
  }
  if (limit !== undefined) {
    params.push(`limit=${limit}`);
  }
  return params.length > 0 ? `?${params.join("&")}` : "";
}

function asBetaReport(json: unknown): BetaReportItem | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const id = asString(o, "id");
  const ownerId = asString(o, "ownerId");
  const reason = asString(o, "reason");
  const note = asString(o, "note");
  const status = asString(o, "status");
  const createdAt = asString(o, "createdAt");
  if (!id || !ownerId || !reason || note === undefined || !status || !createdAt) {
    return null;
  }
  return { id, ownerId, reason, note, status, createdAt, messageId: asString(o, "messageId") };
}

function asBetaAgeAppeal(json: unknown): BetaAgeAppealItem | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const id = asString(o, "id");
  const ownerId = asString(o, "ownerId");
  const reason = asString(o, "reason");
  const status = asString(o, "status");
  const createdAt = asString(o, "createdAt");
  if (!id || !ownerId || !reason || !status || !createdAt) {
    return null;
  }
  return { id, ownerId, reason, status, createdAt };
}

function asBetaExportTask(json: unknown): BetaExportTaskItem | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const id = asString(o, "id");
  const ownerId = asString(o, "ownerId");
  const status = asString(o, "status");
  const createdAt = asString(o, "createdAt");
  if (!id || !ownerId || !status || !createdAt) {
    return null;
  }
  return { id, ownerId, status, createdAt, completedAt: asString(o, "completedAt") };
}

function asBetaMemorySampling(json: unknown): BetaMemorySamplingItem | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const id = asString(o, "id");
  const ownerId = asString(o, "ownerId");
  const relationshipId = asString(o, "relationshipId");
  const scope = asString(o, "scope");
  const summary = asString(o, "summary");
  const status = asString(o, "status");
  const createdAt = asString(o, "createdAt");
  if (!id || !ownerId || !relationshipId || !scope || !summary || !status || !createdAt) {
    return null;
  }
  return {
    id, ownerId, relationshipId, scope, summary, status, createdAt,
    deletedAt: asString(o, "deletedAt"),
  };
}

/**
 * ADMIN-BETA (V64): keyset page of the report queue across all owners
 * (ADMIN only, read-only — triage and disposition stay human).
 */
export async function listBetaReports(
  t: AuthTransport,
  after?: string,
  limit?: number,
): Promise<BetaReportItem[]> {
  const r = await t.request("GET", `${AUTH_BASE}/admin/reports${keysetQuery(after, limit)}`);
  if (!r.ok || !Array.isArray(r.json)) {
    throw new AuthHttpError(r.status);
  }
  const out: BetaReportItem[] = [];
  for (const item of r.json) {
    const parsed = asBetaReport(item);
    if (parsed) out.push(parsed);
  }
  return out;
}

/**
 * ADMIN-BETA (V64): keyset page of the age-appeal queue across all owners
 * (ADMIN only, read-only — resolution stays human).
 */
export async function listBetaAgeAppeals(
  t: AuthTransport,
  after?: string,
  limit?: number,
): Promise<BetaAgeAppealItem[]> {
  const r = await t.request("GET", `${AUTH_BASE}/admin/age-appeals${keysetQuery(after, limit)}`);
  if (!r.ok || !Array.isArray(r.json)) {
    throw new AuthHttpError(r.status);
  }
  const out: BetaAgeAppealItem[] = [];
  for (const item of r.json) {
    const parsed = asBetaAgeAppeal(item);
    if (parsed) out.push(parsed);
  }
  return out;
}

/**
 * ADMIN-BETA (V64): keyset page of the async export-task queue across all
 * owners (ADMIN only, read-only; rows carry ids/statuses only).
 */
export async function listBetaExportTasks(
  t: AuthTransport,
  after?: string,
  limit?: number,
): Promise<BetaExportTaskItem[]> {
  const r = await t.request("GET", `${AUTH_BASE}/admin/export-tasks${keysetQuery(after, limit)}`);
  if (!r.ok || !Array.isArray(r.json)) {
    throw new AuthHttpError(r.status);
  }
  const out: BetaExportTaskItem[] = [];
  for (const item of r.json) {
    const parsed = asBetaExportTask(item);
    if (parsed) out.push(parsed);
  }
  return out;
}

/**
 * ADMIN-BETA (V64): memory-anomaly sampling (non-ACCEPTED or soft-deleted
 * rows) across all owners (ADMIN only, read-only).
 */
export async function listBetaMemorySampling(
  t: AuthTransport,
  after?: string,
  limit?: number,
): Promise<BetaMemorySamplingItem[]> {
  const r = await t.request("GET", `${AUTH_BASE}/admin/memory-sampling${keysetQuery(after, limit)}`);
  if (!r.ok || !Array.isArray(r.json)) {
    throw new AuthHttpError(r.status);
  }
  const out: BetaMemorySamplingItem[] = [];
  for (const item of r.json) {
    const parsed = asBetaMemorySampling(item);
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

/**
 * DOGFOOD-05 (ADR-0006 §3.3): derived provider-plan status. Under UNKNOWN
 * the page must not render any quota, remaining allowance or cost figure —
 * null caps mean "not stated", never zero.
 */
export interface ProviderPlanStatus {
  status: "VALID" | "UNKNOWN" | "DISABLED";
  reason: string;
  planName?: string | null;
  validFrom?: string | null;
  validUntil?: string | null;
  tokenCap?: number | null;
  requestCap?: number | null;
  monthCostUsd?: number | null;
}

const PROVIDER_PLAN_STATES: ReadonlySet<string> = new Set(["VALID", "UNKNOWN", "DISABLED"]);

function asProviderPlanStatus(json: unknown): ProviderPlanStatus | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const status = asString(o, "status");
  const reason = asString(o, "reason");
  if (!status || !PROVIDER_PLAN_STATES.has(status) || !reason) {
    return null;
  }
  const tokenCap = o.tokenCap == null ? null : Number(o.tokenCap);
  const requestCap = o.requestCap == null ? null : Number(o.requestCap);
  const monthCostUsd = o.monthCostUsd == null ? null : Number(o.monthCostUsd);
  if ((tokenCap != null && !Number.isFinite(tokenCap))
      || (requestCap != null && !Number.isFinite(requestCap))
      || (monthCostUsd != null && !Number.isFinite(monthCostUsd))) {
    return null;
  }
  return {
    status: status as ProviderPlanStatus["status"],
    reason,
    planName: asString(o, "planName"),
    validFrom: asString(o, "validFrom"),
    validUntil: asString(o, "validUntil"),
    tokenCap,
    requestCap,
    monthCostUsd,
  };
}

/**
 * DOGFOOD-05: provider-plan status (ADMIN only). Returns null on a non-OK or
 * unparseable response so the page can show one generic failure state without
 * inventing a plan.
 */
export async function providerPlanStatus(
  t: AuthTransport,
): Promise<ProviderPlanStatus | null> {
  const r = await t.request("GET", `${AUTH_BASE}/admin/provider-plan`);
  if (!r.ok) {
    return null;
  }
  return asProviderPlanStatus(r.json);
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

/** B1-SURVEY (§26.5): record today's 被理解感 score (1..5). Returns whether
 * the score was recorded (false = already scored today). */
export async function recordSurvey(
  t: AuthTransport,
  score: number,
): Promise<boolean> {
  const r = await t.request("POST", "/api/v1/survey", { score });
  if (!r.ok) return false;
  const body = r.json as { accepted?: boolean };
  return body?.accepted === true;
}
