// ENT-TRIAL (FR-ENT-005): the caller's live simulated-trial state. A spent
// or expired trial never removes chats, memories or relationships — this read
// only reports the remaining PREMIUM turn budget and the expiry.

export interface EntitlementApiResponse {
  ok: boolean;
  status: number;
  json: unknown;
}

export interface EntitlementTransport {
  request(method: string, path: string, body?: unknown): Promise<EntitlementApiResponse>;
}

export interface TrialStatus {
  active: boolean;
  remainingTurns: number | null;
  expiresAt: string | null;
}

export class EntitlementHttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`entitlement request failed with status ${status}`);
    this.name = "EntitlementHttpError";
    this.status = status;
  }
}

/** The caller's live trial (active=false when none is running). */
export async function getTrialStatus(t: EntitlementTransport): Promise<TrialStatus> {
  const r = await t.request("GET", "/api/v1/trial-status");
  if (!r.ok || !r.json || typeof r.json !== "object") {
    throw new EntitlementHttpError(r.status);
  }
  const o = r.json as Record<string, unknown>;
  const remainingTurns =
    typeof o.remainingTurns === "number" && Number.isFinite(o.remainingTurns)
      ? o.remainingTurns
      : null;
  const expiresAt = typeof o.expiresAt === "string" && o.expiresAt ? o.expiresAt : null;
  return { active: o.active === true, remainingTurns, expiresAt };
}
