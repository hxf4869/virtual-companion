// CONSENT (FR-AUTH-003): versioned consent records API client. The transport
// is injected so stores and specs can mock request() exactly like
// api/chat.spec.ts. Consent records are append-only: every grant/revoke
// appends a new versioned row and the GET returns the effective latest row per
// type. Withdrawing MODEL_TRAINING never affects basic chat service.

export interface ConsentApiResponse {
  ok: boolean;
  status: number;
  json: unknown;
}

export interface ConsentTransport {
  request(method: string, path: string, body?: unknown): Promise<ConsentApiResponse>;
}

export type ConsentType =
  | "SERVICE_TERMS"
  | "PRIVACY_POLICY"
  | "AI_CONTENT_NOTICE"
  | "THIRD_PARTY_MODEL_PROCESSING"
  | "SENSITIVE_DATA_PROCESSING"
  | "EMERGENCY_CONTACT"
  | "MODEL_TRAINING"
  | "PUSH_NOTIFICATION";

export interface ConsentRecord {
  consentId: string;
  consentType: ConsentType;
  version: string;
  granted: boolean;
  grantedAt: string;
  revokedAt?: string;
}

export class ConsentHttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`consent request failed with status ${status}`);
    this.name = "ConsentHttpError";
    this.status = status;
  }
}

const CONSENTS_BASE = "/api/v1/consents";

function asId(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

const APPROVED_TYPES: readonly string[] = [
  "SERVICE_TERMS",
  "PRIVACY_POLICY",
  "AI_CONTENT_NOTICE",
  "THIRD_PARTY_MODEL_PROCESSING",
  "SENSITIVE_DATA_PROCESSING",
  "EMERGENCY_CONTACT",
  "MODEL_TRAINING",
  "PUSH_NOTIFICATION",
];

function asConsentType(value: unknown): ConsentType | undefined {
  if (typeof value === "string" && APPROVED_TYPES.includes(value)) {
    return value as ConsentType;
  }
  return undefined;
}

function asConsentRecord(json: unknown): ConsentRecord | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const consentId = asId(o.consentId);
  const consentType = asConsentType(o.consentType);
  const version = typeof o.version === "string" ? o.version : undefined;
  const granted = o.granted;
  const grantedAt = typeof o.grantedAt === "string" ? o.grantedAt : undefined;
  if (!consentId || !consentType || !version || typeof granted !== "boolean" || !grantedAt) {
    return null;
  }
  return {
    consentId,
    consentType,
    version,
    granted,
    grantedAt,
    revokedAt: typeof o.revokedAt === "string" ? o.revokedAt : undefined,
  };
}

/**
 * Append a versioned grant/revoke consent record. Non-OK statuses throw a
 * typed error so the store never fakes a grant.
 */
export async function recordConsent(
  t: ConsentTransport,
  consentType: ConsentType,
  version: string,
  granted: boolean,
): Promise<ConsentRecord | null> {
  const r = await t.request("PUT", CONSENTS_BASE, { consentType, version, granted });
  if (!r.ok) {
    throw new ConsentHttpError(r.status);
  }
  return asConsentRecord(r.json);
}

/** The effective consent state: the latest record per type. */
export async function listConsents(t: ConsentTransport): Promise<ConsentRecord[]> {
  const r = await t.request("GET", CONSENTS_BASE);
  if (!r.ok || !Array.isArray(r.json)) {
    throw new ConsentHttpError(r.status);
  }
  const out: ConsentRecord[] = [];
  for (const item of r.json) {
    const parsed = asConsentRecord(item);
    if (parsed) out.push(parsed);
  }
  return out;
}
