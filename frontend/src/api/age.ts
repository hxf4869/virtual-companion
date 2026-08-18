// AGE-UI (FR-AUTH-002): adult-verification API client. Transport is injected
// so the store and specs can mock request() like api/consent.ts. The page
// never treats a local checkbox as verification — only GET/POST results.

export type AgeState =
  | "AGE_UNKNOWN"
  | "ADULT_SELF_DECLARED"
  | "ADULT_VERIFICATION_REQUIRED"
  | "ADULT_VERIFIED"
  | "MINOR_SUSPECTED"
  | "MINOR_VERIFIED"
  | "AGE_APPEAL_PENDING"
  | "AGE_REVERIFY_REQUIRED"
  | "AGE_ACCESS_SUSPENDED";

export const AGE_STATES = [
  "AGE_UNKNOWN",
  "ADULT_SELF_DECLARED",
  "ADULT_VERIFICATION_REQUIRED",
  "ADULT_VERIFIED",
  "MINOR_SUSPECTED",
  "MINOR_VERIFIED",
  "AGE_APPEAL_PENDING",
  "AGE_REVERIFY_REQUIRED",
  "AGE_ACCESS_SUSPENDED",
] as const;

export const VERIFIABLE_AGE_STATES: readonly AgeState[] = [
  "AGE_UNKNOWN",
  "ADULT_SELF_DECLARED",
  "ADULT_VERIFICATION_REQUIRED",
  "AGE_REVERIFY_REQUIRED",
];

export const BLOCKED_AGE_STATES: readonly AgeState[] = [
  "MINOR_SUSPECTED",
  "MINOR_VERIFIED",
  "AGE_APPEAL_PENDING",
  "AGE_ACCESS_SUSPENDED",
];

export interface AgeStateRecord {
  ageState: AgeState;
  providerRef: string | null;
  verifiedAt: string | null;
}

export interface AgeApiResponse {
  ok: boolean;
  status: number;
  json: unknown;
}

export interface AgeTransport {
  request(method: string, path: string, body?: unknown): Promise<AgeApiResponse>;
}

export class AgeHttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`age request failed with status ${status}`);
    this.name = "AgeHttpError";
    this.status = status;
  }
}

const AGE_STATE_PATH = "/api/v1/age/state";
const AGE_VERIFY_PATH = "/api/v1/age/verification";

function asAgeState(value: unknown): AgeState | undefined {
  return typeof value === "string" && (AGE_STATES as readonly string[]).includes(value)
    ? (value as AgeState)
    : undefined;
}

function asAgeStateRecord(json: unknown): AgeStateRecord | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const ageState = asAgeState(o.ageState);
  if (!ageState) return null;
  const providerRef = typeof o.providerRef === "string" && o.providerRef.trim() ? o.providerRef : null;
  const verifiedAt = typeof o.verifiedAt === "string" && o.verifiedAt.trim() ? o.verifiedAt : null;
  return { ageState, providerRef, verifiedAt };
}

export function canRunSimulatedVerification(state: AgeState): boolean {
  return VERIFIABLE_AGE_STATES.includes(state);
}

export function isVerificationBlocked(state: AgeState): boolean {
  return BLOCKED_AGE_STATES.includes(state);
}

/** Effective adult-verification state (AGE_UNKNOWN when never verified). */
export async function getAgeState(t: AgeTransport): Promise<AgeStateRecord> {
  const r = await t.request("GET", AGE_STATE_PATH);
  if (!r.ok) {
    throw new AgeHttpError(r.status);
  }
  return asAgeStateRecord(r.json) ?? { ageState: "AGE_UNKNOWN", providerRef: null, verifiedAt: null };
}

/**
 * Run the Alpha simulated adult verification. 400 means the current catalog
 * state cannot reach ADULT_VERIFIED (fail closed). Other non-OK statuses throw.
 */
export async function verifyAge(t: AgeTransport): Promise<AgeStateRecord> {
  const r = await t.request("POST", AGE_VERIFY_PATH);
  if (!r.ok) {
    throw new AgeHttpError(r.status);
  }
  const parsed = asAgeStateRecord(r.json);
  if (!parsed) {
    throw new AgeHttpError(r.status);
  }
  return parsed;
}
