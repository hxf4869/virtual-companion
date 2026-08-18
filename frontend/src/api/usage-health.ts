// USAGE-HEALTH (§20.7 / 21.3.3): continuous-use reminder prefs + heartbeat.
// Transport is injected so the store and specs can mock request(). The backend
// computes continuous minutes; the client only assists. Reminders are
// system-layer facts and must never be role-played.

export const APPROVED_REMINDER_MINUTES = [60, 90, 120, 180] as const;
export const APPROVED_GAP_MINUTES = [15, 30, 45] as const;
export const APPROVED_REMINDER_RESULTS = ["SHOWN", "CONTINUED", "ENDED"] as const;

export type ReminderAfterMinutes = (typeof APPROVED_REMINDER_MINUTES)[number];
export type SessionGapMinutes = (typeof APPROVED_GAP_MINUTES)[number];
export type UsageReminderResult = (typeof APPROVED_REMINDER_RESULTS)[number];

export interface UsageHealthStatus {
  reminderAfterMinutes: ReminderAfterMinutes;
  sessionGapMinutes: SessionGapMinutes;
  continuousMinutes: number;
  reminderDue: boolean;
  sessionStartedAt: string | null;
}

export interface UsageHealthApiResponse {
  ok: boolean;
  status: number;
  json: unknown;
}

export interface UsageHealthTransport {
  request(method: string, path: string, body?: unknown): Promise<UsageHealthApiResponse>;
}

export class UsageHealthHttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`usage-health request failed with status ${status}`);
    this.name = "UsageHealthHttpError";
    this.status = status;
  }
}

const USAGE_HEALTH_PATH = "/api/v1/usage-health";
const HEARTBEAT_PATH = "/api/v1/usage-health/heartbeat";
const REMINDER_PATH = "/api/v1/usage-health/reminder";

function asApproved<T extends number | string>(
  value: unknown,
  allowed: readonly T[],
): T | undefined {
  return (allowed as readonly unknown[]).includes(value) ? (value as T) : undefined;
}

export function asUsageHealthStatus(json: unknown): UsageHealthStatus | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const reminderAfterMinutes = asApproved(o.reminderAfterMinutes, APPROVED_REMINDER_MINUTES);
  const sessionGapMinutes = asApproved(o.sessionGapMinutes, APPROVED_GAP_MINUTES);
  if (reminderAfterMinutes === undefined || sessionGapMinutes === undefined) return null;
  if (typeof o.continuousMinutes !== "number" || o.continuousMinutes < 0) return null;
  if (typeof o.reminderDue !== "boolean") return null;
  const sessionStartedAt =
    typeof o.sessionStartedAt === "string" && o.sessionStartedAt.trim()
      ? o.sessionStartedAt
      : null;
  return {
    reminderAfterMinutes,
    sessionGapMinutes,
    continuousMinutes: o.continuousMinutes,
    reminderDue: o.reminderDue,
    sessionStartedAt,
  };
}

/** Read-only prefs + current session. Does not extend the session. */
export async function getUsageHealth(t: UsageHealthTransport): Promise<UsageHealthStatus> {
  const r = await t.request("GET", USAGE_HEALTH_PATH);
  if (!r.ok) {
    throw new UsageHealthHttpError(r.status);
  }
  const parsed = asUsageHealthStatus(r.json);
  if (!parsed) {
    throw new UsageHealthHttpError(r.status);
  }
  return parsed;
}

/** Replace approved reminder / gap prefs. */
export async function updateUsageHealthPrefs(
  t: UsageHealthTransport,
  reminderAfterMinutes: ReminderAfterMinutes,
  sessionGapMinutes: SessionGapMinutes,
): Promise<UsageHealthStatus> {
  const r = await t.request("PUT", USAGE_HEALTH_PATH, {
    reminderAfterMinutes,
    sessionGapMinutes,
  });
  if (!r.ok) {
    throw new UsageHealthHttpError(r.status);
  }
  const parsed = asUsageHealthStatus(r.json);
  if (!parsed) {
    throw new UsageHealthHttpError(r.status);
  }
  return parsed;
}

/**
 * Record activity and recompute continuous-use. Non-fatal on the chat page:
 * a failed or malformed heartbeat must not break send / stream.
 */
export async function usageHeartbeat(
  t: UsageHealthTransport,
): Promise<UsageHealthStatus | null> {
  const r = await t.request("POST", HEARTBEAT_PATH);
  if (!r.ok) return null;
  return asUsageHealthStatus(r.json);
}

/** Record SHOWN / CONTINUED / ENDED. */
export async function recordUsageReminder(
  t: UsageHealthTransport,
  result: UsageReminderResult,
): Promise<UsageHealthStatus> {
  const r = await t.request("POST", REMINDER_PATH, { result });
  if (!r.ok) {
    throw new UsageHealthHttpError(r.status);
  }
  const parsed = asUsageHealthStatus(r.json);
  if (!parsed) {
    throw new UsageHealthHttpError(r.status);
  }
  return parsed;
}
