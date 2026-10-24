// Go Runtime identity client. Authentication is cookie based: no password,
// challenge, recovery code or session secret is persisted by this module.

import type { TransportRequestOptions } from "@/api/transport";

export interface AuthApiResponse {
  ok: boolean;
  status: number;
  json: unknown;
  /** True when the HTTP body could not be decoded as JSON. */
  parseFailed?: boolean;
}

export interface AuthTransport {
  request(
    method: string,
    path: string,
    body?: unknown,
    opts?: TransportRequestOptions,
  ): Promise<AuthApiResponse>;
}

export type AuthNextStep =
  | "ACTIVE"
  | "TOTP_REQUIRED"
  | "AUTHENTICATOR_SETUP_REQUIRED"
  | "EMAIL_VERIFICATION_REQUIRED"
  | "REVIEW_PENDING"
  | "DISABLED"
  | "REJECTED";

export interface AuthSessionIdentity {
  nextStep: "ACTIVE";
  accountId: string;
  email?: string;
  role: string;
  passwordMustChange: boolean;
  authenticatorEnabled: boolean;
  expiresInSeconds: number;
}

export type AuthSessionProbe =
  | { status: "authenticated"; identity: AuthSessionIdentity }
  | { status: "anonymous" }
  | { status: "unavailable" };

export interface AuthChallenge {
  nextStep: "TOTP_REQUIRED" | "AUTHENTICATOR_SETUP_REQUIRED";
  challengeId: string;
  expiresAt: string;
}

export interface AuthAdmissionState {
  nextStep:
    | "EMAIL_VERIFICATION_REQUIRED"
    | "REVIEW_PENDING"
    | "DISABLED"
    | "REJECTED";
}

export type AuthLoginResult = AuthSessionIdentity | AuthChallenge | AuthAdmissionState;

export interface AuthChallengeComplete extends AuthSessionIdentity {
  recoveryCodes: string[];
}

export interface AuthenticatorSetup {
  manualKey: string;
  provisioningUri: string;
  qrCodeDataUrl: string;
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

export interface TrustedDevice {
  id: string;
  displayName: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
}

export class AuthHttpError extends Error {
  readonly status: number;
  /** Flat ErrorEnvelope code carried by the failing response, when readable. */
  readonly serverCode?: string;

  constructor(status: number, serverCode?: string) {
    super(`auth request failed with status ${status}`);
    this.name = "AuthHttpError";
    this.status = status;
    this.serverCode = serverCode;
  }
}

const AUTH_BASE = "/api/v1/auth";

// VC-R166: 登录主链等待点（login/getAuthSession/getAuthenticatorSetup/
// completeChallenge，后者服务 confirm/totp/recovery 三个真实入口）与 logout
// 共用的请求总时限：弱网挂起（响应头或正文不 settle）时按「结果未知」以既有
// TransportTimeoutError 结束，界面等待不得永不结束。局部常量，非 transport
// 默认；非阻塞的 registration-status 与其他 auth/admin 管理请求不适用。
const LOGIN_CHAIN_TIMEOUT_MS = 15_000;

/** Safe default is closed when the availability response cannot be read. */
export async function getRegistrationStatus(t: AuthTransport): Promise<boolean> {
  const response = await t.request("GET", `${AUTH_BASE}/registration-status`);
  if (!response.ok || !response.json || typeof response.json !== "object") return false;
  return (response.json as Record<string, unknown>).enabled === true;
}

/**
 * Verify the account/password first step. The account may be a username or
 * email address. A correct password returns only the
 * server-selected next step unless a live trusted-device cookie also exists.
 */
export async function login(
  t: AuthTransport,
  account: string,
  password: string,
): Promise<AuthLoginResult | null> {
  const response = await t.request("POST", `${AUTH_BASE}/login`, { account, password }, {
    timeoutMs: LOGIN_CHAIN_TIMEOUT_MS,
  });
  if (response.status === 404) return null;
  const result = asAuthLoginResult(response.json);
  if ((response.ok || response.status === 403) && result) return result;
  throw new AuthHttpError(response.status);
}

/**
 * Restore identity from the single server-owned auth-session endpoint. 401 is
 * the only canonical "no valid session" result; other non-committing outcomes
 * (5xx / bad protocol shape) become unavailable and must not fake a logout.
 */
export async function getAuthSession(t: AuthTransport): Promise<AuthSessionProbe> {
  const response = await t.request("GET", `${AUTH_BASE}/session`, undefined, {
    callerHandlesUnauthorized: true,
    timeoutMs: LOGIN_CHAIN_TIMEOUT_MS,
    // VC-R52 身份发现显式不带期望账号前置：页面身份与 Cookie 身份不同时，
    // 发现流必须能读到当前 Cookie 账号，否则永远撞 409 死循环。
    omitExpectedAccount: true,
  });
  if (response.status === 401) return { status: "anonymous" };
  if (!response.ok) return { status: "unavailable" };
  const identity = asSessionIdentity(response.json);
  return identity ? { status: "authenticated", identity } : { status: "unavailable" };
}

/** Compatibility name used by the current navigation bootstrap. */
export async function refresh(t: AuthTransport): Promise<AuthSessionProbe> {
  return getAuthSession(t);
}

export async function restoreSession(t: AuthTransport): Promise<AuthSessionProbe> {
  return getAuthSession(t);
}

export async function getAuthenticatorSetup(
  t: AuthTransport,
  challengeId: string,
): Promise<AuthenticatorSetup | null> {
  const response = await t.request(
    "POST",
    `${AUTH_BASE}/challenges/${encodeURIComponent(challengeId)}/authenticator-setup`,
    undefined,
    { timeoutMs: LOGIN_CHAIN_TIMEOUT_MS },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new AuthHttpError(response.status);
  const setup = asAuthenticatorSetup(response.json);
  if (!setup) throw new AuthHttpError(response.status);
  return setup;
}

export async function confirmAuthenticator(
  t: AuthTransport,
  challengeId: string,
  code: string,
  trustDevice = false,
): Promise<AuthChallengeComplete | null> {
  return completeChallenge(t, challengeId, "authenticator-confirm", code, trustDevice);
}

export async function verifyAuthenticatorCode(
  t: AuthTransport,
  challengeId: string,
  code: string,
  trustDevice = false,
): Promise<AuthChallengeComplete | null> {
  return completeChallenge(t, challengeId, "totp", code, trustDevice);
}

export async function verifyRecoveryCode(
  t: AuthTransport,
  challengeId: string,
  code: string,
  trustDevice = false,
): Promise<AuthChallengeComplete | null> {
  return completeChallenge(t, challengeId, "recovery-code", code, trustDevice);
}

export async function logout(t: AuthTransport): Promise<boolean> {
  // VC-R165: 弱网总时限——响应头或 JSON 正文挂起时 15 秒后按「结果未知」
  // 失败，UI 才能进入 R164 的无法确认/可重试反馈，而不是无限 busy。复用
  // transport 既有 timeoutMs 机制（覆盖 fetch 与正文读取全生命周期），不
  // 新建 timer/AbortController/错误类型；与其他登录主链等待点共用同一常量。
  const response = await t.request("POST", `${AUTH_BASE}/logout`, undefined, {
    timeoutMs: LOGIN_CHAIN_TIMEOUT_MS,
  });
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

export async function listTrustedDevices(t: AuthTransport): Promise<TrustedDevice[]> {
  const response = await t.request("GET", `${AUTH_BASE}/trusted-devices`);
  if (!response.ok || !Array.isArray(response.json)) {
    throw new AuthHttpError(response.status);
  }
  const devices = response.json.map(asTrustedDevice);
  if (devices.some((device) => device === null)) {
    throw new AuthHttpError(response.status);
  }
  return devices as TrustedDevice[];
}

export async function revokeTrustedDevice(
  t: AuthTransport,
  deviceId: string,
): Promise<boolean> {
  const response = await t.request(
    "DELETE",
    `${AUTH_BASE}/trusted-devices/${encodeURIComponent(deviceId)}`,
  );
  return response.ok;
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

async function completeChallenge(
  t: AuthTransport,
  challengeId: string,
  endpoint: "authenticator-confirm" | "totp" | "recovery-code",
  code: string,
  trustDevice: boolean,
): Promise<AuthChallengeComplete | null> {
  const response = await t.request(
    "POST",
    `${AUTH_BASE}/challenges/${encodeURIComponent(challengeId)}/${endpoint}`,
    { code, trustDevice },
    { timeoutMs: LOGIN_CHAIN_TIMEOUT_MS },
  );
  if (response.status === 404) {
    // Split the 404 family: AUTH_CHALLENGE_UNAVAILABLE means the challenge can
    // no longer be completed (unknown/expired/consumed/exhausted); anything
    // else — including an unreadable body — keeps the wrong-code null contract.
    const body = response.json;
    if (
      body &&
      typeof body === "object" &&
      (body as Record<string, unknown>).code === "AUTH_CHALLENGE_UNAVAILABLE"
    ) {
      throw new AuthHttpError(404, "AUTH_CHALLENGE_UNAVAILABLE");
    }
    return null;
  }
  if (!response.ok) throw new AuthHttpError(response.status);
  const completed = asChallengeComplete(response.json);
  if (!completed) throw new AuthHttpError(response.status);
  return completed;
}

function asAuthLoginResult(json: unknown): AuthLoginResult | null {
  if (!json || typeof json !== "object") return null;
  const value = json as Record<string, unknown>;
  switch (value.nextStep) {
    case "ACTIVE":
      return asSessionIdentity(value);
    case "TOTP_REQUIRED":
    case "AUTHENTICATOR_SETUP_REQUIRED": {
      const challengeId = stringValue(value.challengeId);
      const expiresAt = stringValue(value.expiresAt);
      if (!challengeId || !expiresAt) return null;
      return { nextStep: value.nextStep, challengeId, expiresAt };
    }
    case "EMAIL_VERIFICATION_REQUIRED":
    case "REVIEW_PENDING":
    case "DISABLED":
    case "REJECTED":
      return { nextStep: value.nextStep };
    default:
      return null;
  }
}

function asSessionIdentity(json: unknown): AuthSessionIdentity | null {
  if (!json || typeof json !== "object") return null;
  const value = json as Record<string, unknown>;
  const accountId = stringValue(value.accountId);
  const role = stringValue(value.role);
  const expiresInSeconds = Number(value.expiresInSeconds);
  if (
    value.nextStep !== "ACTIVE" ||
    !accountId ||
    !role ||
    typeof value.passwordMustChange !== "boolean" ||
    typeof value.authenticatorEnabled !== "boolean" ||
    !Number.isFinite(expiresInSeconds)
  ) {
    return null;
  }
  return {
    nextStep: "ACTIVE",
    accountId,
    email: stringValue(value.email) ?? undefined,
    role,
    passwordMustChange: value.passwordMustChange,
    authenticatorEnabled: value.authenticatorEnabled,
    expiresInSeconds,
  };
}

function asChallengeComplete(json: unknown): AuthChallengeComplete | null {
  const identity = asSessionIdentity(json);
  if (!identity || !json || typeof json !== "object") return null;
  const rawCodes = (json as Record<string, unknown>).recoveryCodes;
  if (rawCodes !== undefined && !Array.isArray(rawCodes)) return null;
  const recoveryCodes = Array.isArray(rawCodes)
    ? rawCodes.filter((code): code is string => typeof code === "string" && code.length > 0)
    : [];
  if (Array.isArray(rawCodes) && recoveryCodes.length !== rawCodes.length) return null;
  return { ...identity, recoveryCodes };
}

function asAuthenticatorSetup(json: unknown): AuthenticatorSetup | null {
  if (!json || typeof json !== "object") return null;
  const value = json as Record<string, unknown>;
  const manualKey = stringValue(value.manualKey);
  const provisioningUri = stringValue(value.provisioningUri);
  const qrCodeDataUrl = stringValue(value.qrCodeDataUrl);
  if (!manualKey || !provisioningUri || !qrCodeDataUrl) return null;
  return { manualKey, provisioningUri, qrCodeDataUrl };
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

function asTrustedDevice(json: unknown): TrustedDevice | null {
  if (!json || typeof json !== "object") return null;
  const value = json as Record<string, unknown>;
  const id = stringValue(value.id);
  const displayName = stringValue(value.displayName);
  const createdAt = stringValue(value.createdAt);
  const lastUsedAt = stringValue(value.lastUsedAt);
  const expiresAt = stringValue(value.expiresAt);
  if (!id || !displayName || !createdAt || !lastUsedAt || !expiresAt) return null;
  return { id, displayName, createdAt, lastUsedAt, expiresAt };
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asOk(json: unknown): boolean {
  return Boolean(json && typeof json === "object" && (json as Record<string, unknown>).ok === true);
}
