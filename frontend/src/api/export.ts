// DATA-EXPORT (FR-DATA-002): asynchronous data-export API client. The
// transport is injected so stores and specs can mock request() exactly like
// the other api clients. POST enqueues the export and issues the one-time
// downloadToken/downloadUrl EXACTLY ONCE (V76: only a sha256 digest is
// stored server-side); ADR-0006 §7.7: the POST body carries the caller's
// re-entered current password (server-side fail-closed verification). The
// status GET never repeats them; the download GET consumes the token exactly
// once and returns the document. Non-OK statuses throw a typed error so the
// store never fakes a request or a download.

export interface ExportApiResponse {
  ok: boolean;
  status: number;
  json: unknown;
}

export interface ExportTransport {
  request(method: string, path: string, body?: unknown): Promise<ExportApiResponse>;
}

export type ExportStatus = "PENDING" | "READY" | "FAILED" | "EXPIRED";

export interface ExportRequest {
  exportId: string;
  status: ExportStatus;
  requestedAt: string;
  completedAt?: string;
  expiresAt?: string;
  errorMessage?: string;
  downloadToken?: string;
  downloadUrl?: string;
}

/** Go v1 one-time export envelope (full conversation/message payload in JSON). */
export interface ExportDownload {
  exportedAt: string;
  conversationCount: number;
  messageCount: number;
  memoryCount: number;
  conversations: unknown[];
  memories: unknown[];
}

export class ExportHttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`export request failed with status ${status}`);
    this.name = "ExportHttpError";
    this.status = status;
  }
}

const EXPORTS_BASE = "/api/v1/exports";

const APPROVED_STATUSES: readonly string[] = ["PENDING", "READY", "FAILED", "EXPIRED"];

function asId(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function asExportStatus(value: unknown): ExportStatus | undefined {
  if (typeof value === "string" && APPROVED_STATUSES.includes(value)) {
    return value as ExportStatus;
  }
  return undefined;
}

function asExportRequest(json: unknown): ExportRequest | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const exportId = asId(o.exportId);
  const status = asExportStatus(o.status);
  const requestedAt = typeof o.requestedAt === "string" ? o.requestedAt : undefined;
  if (!exportId || !status || !requestedAt) return null;
  return {
    exportId,
    status,
    requestedAt,
    completedAt: typeof o.completedAt === "string" ? o.completedAt : undefined,
    expiresAt: typeof o.expiresAt === "string" ? o.expiresAt : undefined,
    errorMessage: typeof o.errorMessage === "string" ? o.errorMessage : undefined,
    downloadToken: typeof o.downloadToken === "string" ? o.downloadToken : undefined,
    downloadUrl: typeof o.downloadUrl === "string" ? o.downloadUrl : undefined,
  };
}

function asExportDownload(json: unknown): ExportDownload | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const exportedAt = typeof o.exportedAt === "string" ? o.exportedAt : undefined;
  const conversationCount = asNonNegativeInteger(o.conversationCount);
  const messageCount = asNonNegativeInteger(o.messageCount);
  const memoryCount = asNonNegativeInteger(o.memoryCount);
  if (
    !exportedAt ||
    conversationCount === undefined ||
    messageCount === undefined ||
    memoryCount === undefined ||
    !Array.isArray(o.conversations) ||
    !Array.isArray(o.memories)
  ) {
    return null;
  }
  return {
    exportedAt,
    conversationCount,
    messageCount,
    memoryCount,
    conversations: o.conversations,
    memories: o.memories,
  };
}

function asNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

/** The only download paths this client will issue (never an open redirect). */
function assertExportDownloadPath(path: string): void {
  if (!path.startsWith(`${EXPORTS_BASE}/`) || !path.includes("/download")) {
    throw new ExportHttpError(0);
  }
}

/**
 * Enqueue an asynchronous export for the caller. ADR-0006 §7.7 (DOGFOOD-08):
 * the body carries the caller's freshly re-entered CURRENT password; the
 * server verifies it fail-closed before enqueuing anything.
 */
export async function createExport(
  t: ExportTransport,
  currentPassword?: string,
): Promise<ExportRequest | null> {
  const r = await t.request("POST", EXPORTS_BASE, {
    currentPassword: currentPassword ?? "",
  });
  if (!r.ok) {
    throw new ExportHttpError(r.status);
  }
  return asExportRequest(r.json);
}

/** Status of one owned export (never carries the token or URL; V76). */
export async function getExport(
  t: ExportTransport,
  exportId: string,
): Promise<ExportRequest | null> {
  const r = await t.request("GET", `${EXPORTS_BASE}/${encodeURIComponent(exportId)}`);
  if (!r.ok) {
    throw new ExportHttpError(r.status);
  }
  return asExportRequest(r.json);
}

/**
 * One-time download: the token inside downloadUrl is consumed on success.
 * Only paths under /api/v1/exports are accepted.
 */
export async function downloadExport(
  t: ExportTransport,
  downloadUrl: string,
): Promise<ExportDownload | null> {
  assertExportDownloadPath(downloadUrl);
  const r = await t.request("GET", downloadUrl);
  if (!r.ok) {
    throw new ExportHttpError(r.status);
  }
  return asExportDownload(r.json);
}
