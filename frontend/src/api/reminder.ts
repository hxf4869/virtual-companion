// REMINDER (FR-NOTIFY-001): structured user-created reminders API client. The
// transport is injected so stores and specs can mock request() exactly like
// api/chat.spec.ts. Existence is never disclosed (INV-TENANT-001): 403/404 map
// to null/false, other non-OK statuses throw a typed error so the store never
// fakes success. remindAt travels as an RFC 3339 UTC instant (the server
// stores timestamptz); recurrence is NONE / DAILY / WEEKLY; status is ACTIVE
// or DISMISSED. Technical Alpha stores and lists reminders without any push
// transport (product-scope: 不提供主动消息).

export interface ChatApiResponseLike {
  ok: boolean;
  status: number;
  json: unknown;
}

export interface ReminderTransport {
  request(method: string, path: string, body?: unknown): Promise<ChatApiResponseLike>;
}

export type ReminderRecurrence = "NONE" | "DAILY" | "WEEKLY";
export type ReminderStatus = "ACTIVE" | "DISMISSED";

export interface Reminder {
  reminderId: string;
  relationshipId: string;
  text: string;
  remindAt: string;
  recurrence: ReminderRecurrence;
  status: ReminderStatus;
  createdAt: string;
  updatedAt?: string;
}

export class ReminderHttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`reminder request failed with status ${status}`);
    this.name = "ReminderHttpError";
    this.status = status;
  }
}

const REMINDERS_BASE = "/api/v1/reminders";

function asId(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function asString(o: Record<string, unknown>, k: string): string | undefined {
  const v = o[k];
  return typeof v === "string" ? v : undefined;
}

function asRecurrence(value: unknown): ReminderRecurrence | undefined {
  if (value === "NONE" || value === "DAILY" || value === "WEEKLY") return value;
  return undefined;
}

function asStatus(value: unknown): ReminderStatus | undefined {
  if (value === "ACTIVE" || value === "DISMISSED") return value;
  return undefined;
}

function asReminder(json: unknown): Reminder | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const reminderId = asId(o.reminderId);
  const relationshipId = asId(o.relationshipId);
  const text = asString(o, "text");
  const remindAt = asString(o, "remindAt");
  const recurrence = asRecurrence(o.recurrence);
  const status = asStatus(o.status);
  const createdAt = asString(o, "createdAt");
  if (!reminderId || !relationshipId || !text || !remindAt || !recurrence || !status || !createdAt) {
    return null;
  }
  return {
    reminderId,
    relationshipId,
    text,
    remindAt,
    recurrence,
    status,
    createdAt,
    updatedAt: asString(o, "updatedAt"),
  };
}

function isExistenceHidden(status: number): boolean {
  return status === 403 || status === 404;
}

/**
 * Create a reminder under a relationship. null on 403/404 (existence hidden);
 * other non-OK statuses throw.
 */
export async function createReminder(
  t: ReminderTransport,
  relationshipId: string,
  text: string,
  remindAt: string,
  recurrence: ReminderRecurrence = "NONE",
): Promise<Reminder | null> {
  const r = await t.request(
    "POST",
    `/api/v1/relationships/${encodeURIComponent(relationshipId)}/reminders`,
    { text, remindAt, recurrence },
  );
  if (!r.ok) {
    if (isExistenceHidden(r.status)) return null;
    throw new ReminderHttpError(r.status);
  }
  return asReminder(r.json);
}

/** Keyset page of a relationship's reminders, soonest first. */
export async function listReminders(
  t: ReminderTransport,
  relationshipId: string,
  after?: string,
  limit?: number,
): Promise<Reminder[]> {
  const params: string[] = [];
  if (after !== undefined) params.push(`after=${encodeURIComponent(after)}`);
  if (limit !== undefined) params.push(`limit=${limit}`);
  const query = params.length > 0 ? `?${params.join("&")}` : "";
  const r = await t.request(
    "GET",
    `/api/v1/relationships/${encodeURIComponent(relationshipId)}/reminders${query}`,
  );
  if (!r.ok || !Array.isArray(r.json)) {
    if (isExistenceHidden(r.status)) return [];
    throw new ReminderHttpError(r.status);
  }
  const out: Reminder[] = [];
  for (const item of r.json) {
    const parsed = asReminder(item);
    if (parsed) out.push(parsed);
  }
  return out;
}

/** Update every field of an owned reminder. null on 403/404. */
export async function updateReminder(
  t: ReminderTransport,
  reminderId: string,
  body: {
    text: string;
    remindAt: string;
    recurrence: ReminderRecurrence;
    status: ReminderStatus;
  },
): Promise<Reminder | null> {
  const r = await t.request(
    "PATCH",
    `${REMINDERS_BASE}/${encodeURIComponent(reminderId)}`,
    body,
  );
  if (!r.ok) {
    if (isExistenceHidden(r.status)) return null;
    throw new ReminderHttpError(r.status);
  }
  return asReminder(r.json);
}

/** Delete an owned reminder. true only on a confirmed OK; 403/404 → false. */
export async function deleteReminder(
  t: ReminderTransport,
  reminderId: string,
): Promise<boolean> {
  const r = await t.request(
    "DELETE",
    `${REMINDERS_BASE}/${encodeURIComponent(reminderId)}`,
  );
  if (r.ok) return true;
  if (isExistenceHidden(r.status)) return false;
  throw new ReminderHttpError(r.status);
}
