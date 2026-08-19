// EMERGENCY-CONTACT (§20.14): the emergency contact lifecycle API client.
// The transport is injected so stores and specs can mock request() exactly
// like api/consent.ts. The lifecycle: save (requires the standing
// EMERGENCY_CONTACT consent — enforced server-side), a one-time invite token
// (Alpha: relayed manually, nothing is ever sent), the contact-side
// acceptance, and withdraw. A DRAFT contact is never usable for an actual
// liaison; that decision always stays a human action.

export interface EmergencyContactApiResponse {
  ok: boolean;
  status: number;
  json: unknown;
}

export interface EmergencyContactTransport {
  request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<EmergencyContactApiResponse>;
}

export interface EmergencyContact {
  id: string;
  label: string;
  contact?: string;
  status: "DRAFT" | "VERIFIED";
  consentVersion?: string;
  invitedAt?: string;
  verifiedAt?: string;
  verifiedMethod?: string;
  verifiedExpiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EmergencyContactInvite {
  id: string;
  token: string;
  invitedAt: string;
}

export class EmergencyContactHttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`emergency contact request failed with status ${status}`);
    this.name = "EmergencyContactHttpError";
    this.status = status;
  }
}

const EMERGENCY_CONTACT_BASE = "/api/v1/emergency-contact";

function asString(o: Record<string, unknown>, key: string): string | undefined {
  const value = o[key];
  return typeof value === "string" ? value : undefined;
}

function asEmergencyContact(json: unknown): EmergencyContact | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const id = asString(o, "id");
  const label = asString(o, "label");
  const status = asString(o, "status");
  const createdAt = asString(o, "createdAt");
  const updatedAt = asString(o, "updatedAt");
  if (!id || !label || !createdAt || !updatedAt) return null;
  if (status !== "DRAFT" && status !== "VERIFIED") return null;
  return {
    id,
    label,
    status,
    createdAt,
    updatedAt,
    contact: asString(o, "contact"),
    consentVersion: asString(o, "consentVersion"),
    invitedAt: asString(o, "invitedAt"),
    verifiedAt: asString(o, "verifiedAt"),
    verifiedMethod: asString(o, "verifiedMethod"),
    verifiedExpiresAt: asString(o, "verifiedExpiresAt"),
  };
}

/** The live contact card (decrypted), or null when nothing is saved. */
export async function getEmergencyContact(
  t: EmergencyContactTransport,
): Promise<EmergencyContact | null> {
  const r = await t.request("GET", EMERGENCY_CONTACT_BASE);
  if (!r.ok) {
    throw new EmergencyContactHttpError(r.status);
  }
  return asEmergencyContact(r.json);
}

/** Save or change the contact; a change demotes back to DRAFT. */
export async function saveEmergencyContact(
  t: EmergencyContactTransport,
  label: string,
  contact: string,
): Promise<EmergencyContact> {
  const r = await t.request("PUT", EMERGENCY_CONTACT_BASE, { label, contact });
  if (!r.ok || !r.json) {
    throw new EmergencyContactHttpError(r.status);
  }
  const parsed = asEmergencyContact(r.json);
  if (!parsed) {
    throw new EmergencyContactHttpError(r.status);
  }
  return parsed;
}

/** Mint the one-time verification invite token (nothing is ever sent). */
export async function startEmergencyContactVerification(
  t: EmergencyContactTransport,
): Promise<EmergencyContactInvite> {
  const r = await t.request("POST", `${EMERGENCY_CONTACT_BASE}/verify-start`);
  if (!r.ok) {
    throw new EmergencyContactHttpError(r.status);
  }
  const o = (r.json ?? {}) as Record<string, unknown>;
  const id = asString(o, "id");
  const token = asString(o, "token");
  const invitedAt = asString(o, "invitedAt");
  if (!id || !token || !invitedAt) {
    throw new EmergencyContactHttpError(r.status);
  }
  return { id, token, invitedAt };
}

/** The (simulated) contact-side acceptance of the invite token. */
export async function confirmEmergencyContactVerification(
  t: EmergencyContactTransport,
  token: string,
): Promise<EmergencyContact> {
  const r = await t.request(
    "POST",
    `${EMERGENCY_CONTACT_BASE}/verify-confirm`,
    { token },
  );
  if (!r.ok) {
    throw new EmergencyContactHttpError(r.status);
  }
  const parsed = asEmergencyContact(r.json);
  if (!parsed) {
    throw new EmergencyContactHttpError(r.status);
  }
  return parsed;
}

/** Withdraw the live contact (terminal); returns whether one existed. */
export async function revokeEmergencyContact(
  t: EmergencyContactTransport,
): Promise<boolean> {
  const r = await t.request("POST", `${EMERGENCY_CONTACT_BASE}/revoke`);
  if (!r.ok) {
    throw new EmergencyContactHttpError(r.status);
  }
  const o = (r.json ?? {}) as Record<string, unknown>;
  return o.revoked === true;
}
