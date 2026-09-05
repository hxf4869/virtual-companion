// Go Runtime identity client. Authentication is cookie based: no password,
// challenge, recovery code or session secret is persisted by this module.

export interface AuthApiResponse {
  ok: boolean;
  status: number;
  json: unknown;
  /** True when the HTTP body could not be decoded as JSON. */
  parseFailed?: boolean;
}

export interface AuthTransport {
  request(method: string, path: string, body?: unknown): Promise<AuthApiResponse>;
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

  constructor(status: number) {
    super(`auth request failed with status ${status}`);
    this.name = "AuthHttpError";
    this.status = status;
  }
}

const AUTH_BASE = "/api/v1/auth";

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
  const response = await t.request("POST", `${AUTH_BASE}/login`, { account, password });
  if (response.status === 404) return null;
  const result = asAuthLoginResult(response.json);
  if ((response.ok || response.status === 403) && result) return result;
  throw new AuthHttpError(response.status);
}

/** Restore identity from the single server-owned auth-session endpoint. */
export async function getAuthSession(t: AuthTransport): Promise<AuthSessionIdentity | null> {
  const response = await t.request("GET", `${AUTH_BASE}/session`);
  return response.ok ? asSessionIdentity(response.json) : null;
}

/** Compatibility name used by the current navigation bootstrap. */
export async function refresh(t: AuthTransport): Promise<AuthSessionIdentity | null> {
  return getAuthSession(t);
}

export async function restoreSession(t: AuthTransport): Promise<AuthSessionIdentity | null> {
  return getAuthSession(t);
}

export async function getAuthenticatorSetup(
  t: AuthTransport,
  challengeId: string,
): Promise<AuthenticatorSetup | null> {
  const response = await t.request(
    "POST",
    `${AUTH_BASE}/challenges/${encodeURIComponent(challengeId)}/authenticator-setup`,
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
  );
  if (response.status === 404) return null;
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
