// TASK-0030: Memory management API client. The transport is injected so the
// store and specs can mock request() exactly like api/realtime.spec.ts.
//
// Existence is never disclosed (INV-TENANT-001): a not-found/forbidden (non-OK)
// response maps to null / empty / false and never throws an
// existence-disclosing error. A transport failure (network) DOES propagate as a
// throw so the store can surface a failure without faking success -- the api
// layer only swallows HTTP non-OK, not transport errors. Sources, status and
// delete results come solely from the API response; nothing is fabricated here.

export type MemoryStatus =
  | "PROPOSED"
  | "PENDING_CONFIRMATION"
  | "ACCEPTED"
  | "REJECTED"
  | "EXPIRED";

export type MemoryScope = "SESSION" | "RELATIONSHIP";

export interface Memory {
  memoryId: string;
  scope: MemoryScope;
  summary: string;
  status: MemoryStatus;
  conversationId?: string;
  createdAt?: string;
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
}

export interface MemoryTransport {
  request(method: string, path: string, body?: unknown): Promise<MemoryApiResponse>;
}

const REL_BASE = "/api/v1/relationships";
const MEM_BASE = "/api/v1/memories";

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

/** List memory for a relationship. Existence-hidden: non-OK -> []. */
export async function listMemories(
  t: MemoryTransport,
  relationshipId: string,
): Promise<Memory[]> {
  const r = await t.request("GET", `${REL_BASE}/${relationshipId}/memories`);
  return r.ok ? asMemoryArray(r.json) : [];
}

/** Fetch one memory. Existence-hidden: non-OK -> null. */
export async function getMemory(
  t: MemoryTransport,
  memoryId: string,
): Promise<Memory | null> {
  const r = await t.request("GET", `${MEM_BASE}/${memoryId}`);
  return r.ok ? asMemory(r.json) : null;
}

/** Confirm a candidate. Returns the ACCEPTED memory on success, else null. */
export async function confirmMemory(
  t: MemoryTransport,
  memoryId: string,
): Promise<Memory | null> {
  const r = await t.request("POST", `${MEM_BASE}/${memoryId}/confirm`);
  return r.ok ? asMemory(r.json) : null;
}

/** Reject a candidate. Returns the REJECTED memory on success, else null. */
export async function rejectMemory(
  t: MemoryTransport,
  memoryId: string,
): Promise<Memory | null> {
  const r = await t.request("POST", `${MEM_BASE}/${memoryId}/reject`);
  return r.ok ? asMemory(r.json) : null;
}

/** Edit a memory's summary. Returns the updated memory on success, else null. */
export async function updateMemory(
  t: MemoryTransport,
  memoryId: string,
  summary: string,
): Promise<Memory | null> {
  const r = await t.request("PATCH", `${MEM_BASE}/${memoryId}`, { summary });
  return r.ok ? asMemory(r.json) : null;
}

/**
 * Soft-delete a memory. true only on a confirmed (HTTP OK) delete, including
 * the idempotent already-deleted case; false on non-OK (not-found/forbidden).
 * The store treats false as "delete not confirmed" and must not fake success.
 */
export async function deleteMemory(
  t: MemoryTransport,
  memoryId: string,
): Promise<boolean> {
  const r = await t.request("DELETE", `${MEM_BASE}/${memoryId}`);
  return r.ok;
}

/** List a memory's source Evidence. Existence-hidden: non-OK -> []. */
export async function listMemoryEvidence(
  t: MemoryTransport,
  memoryId: string,
): Promise<MemoryEvidence[]> {
  const r = await t.request("GET", `${MEM_BASE}/${memoryId}/evidence`);
  return r.ok ? asEvidenceArray(r.json) : [];
}
