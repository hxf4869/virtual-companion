// REPORT-BE (FR-DATA-001 / §20.15): report & complaint intake API client. The
// transport is injected so stores and specs can mock request() exactly like
// api/reminder.ts. Existence is never disclosed: 403/404 map to null/false/[]
// (a foreign message anchor on create is a hidden 404), other non-OK statuses
// throw a typed error. Status is SUBMITTED until a human review resolves it —
// the client never invents ticket numbers or SLA wording.

export interface ChatApiResponseLike {
  ok: boolean;
  status: number;
  json: unknown;
}

export interface ReportTransport {
  request(method: string, path: string, body?: unknown): Promise<ChatApiResponseLike>;
}

export type ReportReason =
  | "UNSAFE_CONTENT"
  | "AI_IDENTITY"
  | "MINOR_SAFEGUARD"
  | "PRIVACY_OR_DATA"
  | "OTHER";

export const REPORT_REASONS: readonly ReportReason[] = [
  "UNSAFE_CONTENT",
  "AI_IDENTITY",
  "MINOR_SAFEGUARD",
  "PRIVACY_OR_DATA",
  "OTHER",
];

export type ReportStatus = "SUBMITTED" | "RESOLVED";

export interface Report {
  id: string;
  messageId: string | null;
  reason: ReportReason;
  note: string;
  status: ReportStatus;
  resolutionNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export class ReportHttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`report request failed with status ${status}`);
    this.name = "ReportHttpError";
    this.status = status;
  }
}

const REPORTS_BASE = "/api/v1/reports";

function asId(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function asOptionalString(o: Record<string, unknown>, k: string): string | null {
  const v = o[k];
  return typeof v === "string" && v.trim() ? v : null;
}

function asReason(value: unknown): ReportReason | undefined {
  return typeof value === "string" && (REPORT_REASONS as readonly string[]).includes(value)
    ? (value as ReportReason)
    : undefined;
}

function asReport(json: unknown): Report | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const id = asId(o.id);
  const reason = asReason(o.reason);
  const note = typeof o.note === "string" ? o.note : undefined;
  const status = o.status === "SUBMITTED" || o.status === "RESOLVED" ? o.status : undefined;
  const createdAt = typeof o.createdAt === "string" ? o.createdAt : undefined;
  if (!id || !reason || note === undefined || !status || !createdAt) {
    return null;
  }
  return {
    id,
    messageId: asOptionalString(o, "messageId"),
    reason,
    note,
    status,
    resolutionNote: asOptionalString(o, "resolutionNote"),
    createdAt,
    resolvedAt: asOptionalString(o, "resolvedAt"),
  };
}

function isExistenceHidden(status: number): boolean {
  return status === 403 || status === 404;
}

/**
 * Submit a report, optionally anchored to one of the caller's own messages.
 * null on 400/403/404 (invalid reason, or the message anchor is absent or
 * foreign — existence hidden); other non-OK statuses throw.
 */
export async function createReport(
  t: ReportTransport,
  reason: ReportReason,
  note: string,
  messageId?: string,
): Promise<Report | null> {
  const r = await t.request("POST", REPORTS_BASE, {
    reason,
    note,
    ...(messageId !== undefined ? { messageId } : {}),
  });
  if (!r.ok) {
    if (r.status === 400 || isExistenceHidden(r.status)) return null;
    throw new ReportHttpError(r.status);
  }
  return asReport(r.json);
}

/** Keyset page of the caller's reports, newest first. */
export async function listReports(
  t: ReportTransport,
  after?: string,
  limit?: number,
): Promise<Report[]> {
  const params: string[] = [];
  if (after !== undefined) params.push(`after=${encodeURIComponent(after)}`);
  if (limit !== undefined) params.push(`limit=${limit}`);
  const query = params.length > 0 ? `?${params.join("&")}` : "";
  const r = await t.request("GET", `${REPORTS_BASE}${query}`);
  if (!r.ok || !Array.isArray(r.json)) {
    if (isExistenceHidden(r.status)) return [];
    throw new ReportHttpError(r.status);
  }
  const out: Report[] = [];
  for (const item of r.json) {
    const parsed = asReport(item);
    if (parsed) out.push(parsed);
  }
  return out;
}

/** One owned report. null on 403/404 (existence hidden). */
export async function getReport(t: ReportTransport, reportId: string): Promise<Report | null> {
  const r = await t.request("GET", `${REPORTS_BASE}/${encodeURIComponent(reportId)}`);
  if (!r.ok) {
    if (isExistenceHidden(r.status)) return null;
    throw new ReportHttpError(r.status);
  }
  return asReport(r.json);
}
