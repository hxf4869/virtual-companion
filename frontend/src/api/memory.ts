// TASK-0030: Memory management API client. The transport is injected so the
// store and specs can mock request() exactly like api/realtime.spec.ts.
//
// TASK-0105 (P2-16): only product-confirmed 403/404 hide existence
// (INV-TENANT-001) -- a not-found/forbidden response maps to null / empty /
// false and never throws an existence-disclosing error. Every OTHER non-OK
// status is a typed MemoryHttpError: 401 -> unauthorized (session handling),
// 5xx -> server, remaining 4xx -> client; an OK response whose body failed to
// parse is a typed parse error. A transport (network) failure still propagates
// as a throw so the store can surface a failure without faking success. The
// api layer never swallows 401/5xx/parse failures into empty success.

export type MemoryStatus =
  | "PROPOSED"
  | "PENDING_CONFIRMATION"
  | "ACCEPTED"
  | "REJECTED"
  | "EXPIRED";

export type MemoryScope = "SESSION" | "RELATIONSHIP";

export type MemoryHttpErrorKind = "unauthorized" | "server" | "client" | "parse";

/** Typed non-OK/parse failure. Never thrown for existence-hidden 403/404. */
export class MemoryHttpError extends Error {
  readonly status: number;
  readonly kind: MemoryHttpErrorKind;

  constructor(status: number, kind: MemoryHttpErrorKind) {
    super(`memory request failed with status ${status} (${kind})`);
    this.name = "MemoryHttpError";
    this.status = status;
    this.kind = kind;
  }
}

export interface Memory {
  memoryId: string;
  scope: MemoryScope;
  summary: string;
  status: MemoryStatus;
  conversationId?: string;
  createdAt?: string;
  deletedAt?: string;
}

export interface MemoryEvidence {
  evidenceId: string;
  sourceRef: string;
  createdAt?: string;
}

export interface MemoryApiResponse {
  ok: boolean;
  status: number;
  json: unknown;
  /** Set by the transport when res.json() failed (body not JSON). */
  parseFailed?: boolean;
}

export interface MemoryTransport {
  request(method: string, path: string, body?: unknown): Promise<MemoryApiResponse>;
}

const REL_BASE = "/api/v1/relationships";
const MEM_BASE = "/api/v1/memories";

/** Only product-confirmed 403/404 hide existence (INV-TENANT-001). */
function isExistenceHidden(status: number): boolean {
  return status === 403 || status === 404;
}

function classifyStatus(status: number): MemoryHttpErrorKind {
  if (status === 401) {
    return "unauthorized";
  }
  if (status >= 500) {
    return "server";
  }
  return "client";
}

/**
 * Gate one JSON-reading response: returns normally when the result is
 * readable (or existence-hidden), otherwise throws the typed error.
 */
function guardJsonResult(r: MemoryApiResponse): void {
  if (r.ok) {
    if (r.parseFailed) {
      throw new MemoryHttpError(r.status, "parse");
    }
    return;
  }
  if (!isExistenceHidden(r.status)) {
    throw new MemoryHttpError(r.status, classifyStatus(r.status));
  }
}

function asString(o: Record<string, unknown>, k: string): string | undefined {
  const v = o[k];
  return typeof v === "string" ? v : undefined;
}

function asMemory(json: unknown): Memory | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const memoryId = asString(o, "memoryId");
  const scope = asString(o, "scope");
  const summary = asString(o, "summary");
  const status = asString(o, "status");
  if (!memoryId || !scope || !summary || !status) return null;
  return {
    memoryId,
    scope: scope as MemoryScope,
    summary,
    status: status as MemoryStatus,
    conversationId: asString(o, "conversationId"),
    createdAt: asString(o, "createdAt"),
    deletedAt: asString(o, "deletedAt"),
  };
}

function asMemoryArray(json: unknown): Memory[] {
  if (!Array.isArray(json)) return [];
  const out: Memory[] = [];
  for (const item of json) {
    const m = asMemory(item);
    if (m) out.push(m);
  }
  return out;
}

function asEvidenceArray(json: unknown): MemoryEvidence[] {
  if (!Array.isArray(json)) return [];
  const out: MemoryEvidence[] = [];
  for (const item of json) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const evidenceId = asString(o, "evidenceId");
    const sourceRef = asString(o, "sourceRef");
    if (!evidenceId || !sourceRef) continue;
    out.push({ evidenceId, sourceRef, createdAt: asString(o, "createdAt") });
  }
  return out;
}

/** List memory for a relationship. Existence-hidden only for 403/404. */
export async function listMemories(
  t: MemoryTransport,
  relationshipId: string,
  options?: { includeDeleted?: boolean },
): Promise<Memory[]> {
  const query = options?.includeDeleted === true ? "?includeDeleted=true" : "";
  const r = await t.request(
    "GET",
    `${REL_BASE}/${encodeURIComponent(relationshipId)}/memories${query}`,
  );
  guardJsonResult(r);
  return asMemoryArray(r.json);
}

/**
 * MEM-MANUAL: create a memory candidate under a relationship (always
 * PENDING_CONFIRMATION; canonical is reached only by user confirmation —
 * INV-MEM-001/002). Manual entry uses the RELATIONSHIP scope (no conversation
 * binding). Returns the created candidate, or null on 403/404 (existence
 * hidden); other non-OK statuses throw the typed MemoryHttpError.
 */
export async function createMemoryCandidate(
  t: MemoryTransport,
  relationshipId: string,
  summary: string,
): Promise<Memory | null> {
  const r = await t.request(
    "POST",
    `${REL_BASE}/${encodeURIComponent(relationshipId)}/memories/candidates`,
    { scope: "RELATIONSHIP", summary },
  );
  guardJsonResult(r);
  return asMemory(r.json);
}

/** Fetch one memory. Existence-hidden only for 403/404. */
export async function getMemory(
  t: MemoryTransport,
  memoryId: string,
): Promise<Memory | null> {
  const r = await t.request("GET", `${MEM_BASE}/${memoryId}`);
  guardJsonResult(r);
  return asMemory(r.json);
}

/** Confirm a candidate. Returns the ACCEPTED memory on success, else null. */
export async function confirmMemory(
  t: MemoryTransport,
  memoryId: string,
): Promise<Memory | null> {
  const r = await t.request("POST", `${MEM_BASE}/${memoryId}/confirm`);
  guardJsonResult(r);
  return asMemory(r.json);
}

/** Reject a candidate. Returns the REJECTED memory on success, else null. */
export async function rejectMemory(
  t: MemoryTransport,
  memoryId: string,
): Promise<Memory | null> {
  const r = await t.request("POST", `${MEM_BASE}/${memoryId}/reject`);
  guardJsonResult(r);
  return asMemory(r.json);
}

/** Edit a memory's summary. Returns the updated memory on success, else null. */
export async function updateMemory(
  t: MemoryTransport,
  memoryId: string,
  summary: string,
): Promise<Memory | null> {
  const r = await t.request("PATCH", `${MEM_BASE}/${memoryId}`, { summary });
  guardJsonResult(r);
  return asMemory(r.json);
}

/**
 * Soft-delete a memory. true only on a confirmed (HTTP OK) delete, including
 * the idempotent already-deleted case; false on 403/404 (existence hidden).
 * 401/5xx/other failures throw a typed MemoryHttpError so the store never
 * treats a session or server failure as a confirmed delete.
 */
export async function deleteMemory(
  t: MemoryTransport,
  memoryId: string,
): Promise<boolean> {
  const r = await t.request("DELETE", `${MEM_BASE}/${memoryId}`);
  if (r.ok) {
    return true;
  }
  if (isExistenceHidden(r.status)) {
    return false;
  }
  throw new MemoryHttpError(r.status, classifyStatus(r.status));
}

/** List a memory's source Evidence. Existence-hidden only for 403/404. */
export async function listMemoryEvidence(
  t: MemoryTransport,
  memoryId: string,
): Promise<MemoryEvidence[]> {
  const r = await t.request("GET", `${MEM_BASE}/${memoryId}/evidence`);
  guardJsonResult(r);
  return asEvidenceArray(r.json);
}
