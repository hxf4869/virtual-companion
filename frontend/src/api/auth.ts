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
