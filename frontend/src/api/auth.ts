// Go Runtime identity client. The browser keeps only an opaque HttpOnly
// session cookie; no token, password or provider credential is persisted by
// this module. Retired admin, invite, quota and queue APIs are not
// represented here.

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

export class AuthHttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`auth request failed with status ${status}`);
    this.name = "AuthHttpError";
    this.status = status;
  }
}

const AUTH_BASE = "/api/v1/auth";

/** Existence-hidden login: any server rejection maps to null. */
export async function login(
  t: AuthTransport,
  username: string,
  password: string,
): Promise<AuthTokens | null> {
  const response = await t.request("POST", `${AUTH_BASE}/login`, { username, password });
  return response.ok ? asTokens(response.json) : null;
}

/** Restore identity from the opaque session registry; /auth/refresh is retired. */
export async function refresh(t: AuthTransport): Promise<AuthTokens | null> {
  return restoreSession(t);
}

export async function restoreSession(t: AuthTransport): Promise<AuthTokens | null> {
  const sessions = await listAuthSessionsOrNull(t);
  if (sessions === null) return null;
  const current = sessions.find((session) => session.current) ?? sessions[0];
  if (!current?.accountId || !current.role) return null;
  return {
    accountId: current.accountId,
    role: current.role,
    passwordMustChange: current.passwordMustChange === true,
    expiresInSeconds: 0,
  };
}

export async function logout(t: AuthTransport): Promise<boolean> {
  const response = await t.request("POST", `${AUTH_BASE}/logout`);
  return response.ok;
}

export async function listAuthSessions(t: AuthTransport): Promise<AuthSession[]> {
  const response = await t.request("GET", `${AUTH_BASE}/sessions`);
  if (!response.ok || !Array.isArray(response.json)) {
    throw new AuthHttpError(response.status);
  }
  const sessions = response.json.map(asAuthSession);
  if (sessions.some((session) => session === null)) {
    throw new AuthHttpError(response.status);
  }
  return sessions as AuthSession[];
}

export async function revokeAuthSession(
  t: AuthTransport,
  sessionId: string,
): Promise<boolean> {
  const response = await t.request(
    "DELETE",
    `${AUTH_BASE}/sessions/${encodeURIComponent(sessionId)}`,
  );
  return response.ok;
}

export async function revokeAllAuthSessions(t: AuthTransport): Promise<number> {
  const response = await t.request("POST", `${AUTH_BASE}/sessions/revoke-all`);
  if (!response.ok || !response.json || typeof response.json !== "object") {
    throw new AuthHttpError(response.status);
  }
  const revoked = Number((response.json as Record<string, unknown>).revoked);
  if (!Number.isInteger(revoked) || revoked < 0) {
    throw new AuthHttpError(response.status);
  }
  return revoked;
}

export async function changeAuthPassword(
  t: AuthTransport,
  currentPassword: string,
  newPassword: string,
): Promise<boolean> {
  const response = await t.request(
    "POST",
    `${AUTH_BASE}/password`,
    { currentPassword, newPassword },
  );
  return response.ok && asOk(response.json);
}

export async function reauthAuth(
  t: AuthTransport,
  password: string,
): Promise<boolean> {
  const response = await t.request("POST", `${AUTH_BASE}/reauth`, { password });
  return response.ok && asOk(response.json);
}

/** Delete only the caller's account after the server verifies the current password. */
export async function deleteAccount(
  t: AuthTransport,
  currentPassword = "",
): Promise<boolean> {
  const response = await t.request(
    "DELETE",
    `${AUTH_BASE}/account`,
    { currentPassword },
  );
  return response.ok;
}

/** Record today's 1–5 被理解感 score. false also covers an already-recorded day. */
export async function recordSurvey(
  t: AuthTransport,
  score: number,
): Promise<boolean> {
  const response = await t.request("POST", "/api/v1/survey", { score });
  if (!response.ok || !response.json || typeof response.json !== "object") return false;
  return (response.json as Record<string, unknown>).accepted === true;
}

function asTokens(json: unknown): AuthTokens | null {
  if (!json || typeof json !== "object") return null;
  const value = json as Record<string, unknown>;
  const accountId = stringValue(value.accountId);
  const role = stringValue(value.role);
  const expiresInSeconds = Number(value.expiresInSeconds);
  if (!accountId || !role || typeof value.passwordMustChange !== "boolean") return null;
  return {
    accountId,
    role,
    passwordMustChange: value.passwordMustChange,
    expiresInSeconds: Number.isFinite(expiresInSeconds) ? expiresInSeconds : 0,
  };
}

function asAuthSession(json: unknown): AuthSession | null {
  if (!json || typeof json !== "object") return null;
  const value = json as Record<string, unknown>;
  const id = stringValue(value.id);
  const createdAt = stringValue(value.createdAt);
  const expiresAt = stringValue(value.expiresAt);
  if (!id || !createdAt || !expiresAt || typeof value.current !== "boolean") return null;
  return {
    id,
    familyId: stringValue(value.familyId) ?? undefined,
    clientLabel: stringValue(value.clientLabel) ?? undefined,
    createdAt,
    lastSeenAt: stringValue(value.lastSeenAt) ?? createdAt,
    expiresAt,
    current: value.current,
    accountId: stringValue(value.accountId) ?? undefined,
    role: stringValue(value.role) ?? undefined,
    passwordMustChange: typeof value.passwordMustChange === "boolean"
      ? value.passwordMustChange
      : undefined,
  };
}

async function listAuthSessionsOrNull(t: AuthTransport): Promise<AuthSession[] | null> {
  const response = await t.request("GET", `${AUTH_BASE}/sessions`);
  if (!response.ok || !Array.isArray(response.json)) return null;
  const sessions = response.json.map(asAuthSession);
  if (sessions.some((session) => session === null)) return null;
  return sessions as AuthSession[];
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asOk(json: unknown): boolean {
  return Boolean(json && typeof json === "object" && (json as Record<string, unknown>).ok === true);
}
