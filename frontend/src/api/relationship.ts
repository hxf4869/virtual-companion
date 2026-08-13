// TASK-0187: Relationship API client. The transport is injected so the store
// and specs can mock request() exactly like api/chat.ts and api/memory.ts.
//
// Only product-confirmed 403/404 hide existence (INV-TENANT-001) — a
// not-found/forbidden response maps to null / empty and never throws an
// existence-disclosing error. Every OTHER non-OK status is a typed
// RelationshipHttpError: 401 → unauthorized (session handling), 5xx → server,
// remaining 4xx → client; an OK response whose body failed to parse returns
// null (the transport sets json to null on parse failure). A transport
// (network) failure still propagates as a throw so the store can surface a
// failure without faking success. The api layer never swallows 401/5xx
// failures into empty success.
//
// IDs are decimal strings on the wire (OpenAPI type: string). The Java backend
// serialises long as a JSON number, so asId() accepts both string and number
// and normalises to string. owner_user_id is never a request field — the
// server derives ownership from the authenticated principal.

export type RelationshipHttpErrorKind = "unauthorized" | "server" | "client";

/** Typed non-OK failure. Never thrown for existence-hidden 403/404. */
export class RelationshipHttpError extends Error {
  readonly status: number;
  readonly kind: RelationshipHttpErrorKind;

  constructor(status: number, kind: RelationshipHttpErrorKind) {
    super(`relationship request failed with status ${status} (${kind})`);
    this.name = "RelationshipHttpError";
    this.status = status;
    this.kind = kind;
  }
}

export interface Relationship {
  relationshipId: string;
  personaRef: string;
  active: boolean;
  createdAt?: string;
}

export interface RelationshipApiResponse {
  ok: boolean;
  status: number;
  json: unknown;
}

export interface RelationshipTransport {
  request(method: string, path: string, body?: unknown): Promise<RelationshipApiResponse>;
}

const RELATIONSHIPS_BASE = "/api/v1/relationships";

/** Only product-confirmed 403/404 hide existence (INV-TENANT-001). */
function isExistenceHidden(status: number): boolean {
  return status === 403 || status === 404;
}

function classifyStatus(status: number): RelationshipHttpErrorKind {
  if (status === 401) {
    return "unauthorized";
  }
  if (status >= 500) {
    return "server";
  }
  return "client";
}

/**
 * Throw the typed error for a non-OK, non-existence-hidden response.
 * Existence-hidden statuses (403/404) pass through silently.
 */
function guardResult(r: RelationshipApiResponse): void {
  if (r.ok) {
    return;
  }
  if (!isExistenceHidden(r.status)) {
    throw new RelationshipHttpError(r.status, classifyStatus(r.status));
  }
}

/** Accept string or number and normalise to string (Java long wire format). */
function asId(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function asString(o: Record<string, unknown>, k: string): string | undefined {
  const v = o[k];
  return typeof v === "string" ? v : undefined;
}

function asRelationship(json: unknown): Relationship | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const relationshipId = asId(o.relationshipId);
  const personaRef = asString(o, "personaRef");
  if (!relationshipId || !personaRef) return null;
  return {
    relationshipId,
    personaRef,
    active: o.active === true,
    createdAt: asString(o, "createdAt"),
  };
}

function asRelationshipArray(json: unknown): Relationship[] {
  if (!Array.isArray(json)) return [];
  const out: Relationship[] = [];
  for (const item of json) {
    const rel = asRelationship(item);
    if (rel) out.push(rel);
  }
  return out;
}

/**
 * Create a new Companion relationship (vc.create_relationship). Returns the new
 * relationship on success, null on 403/404 (existence hidden).
 */
export async function createRelationship(
  t: RelationshipTransport,
  personaRef: string,
): Promise<Relationship | null> {
  const r = await t.request("POST", RELATIONSHIPS_BASE, { personaRef });
  guardResult(r);
  return asRelationship(r.json);
}

/**
 * List the owner's relationships (vc.list_relationships). A foreign or absent
 * owner yields an empty array and never discloses existence. 401/5xx throw
 * typed errors so the store never fakes success.
 */
export async function listRelationships(
  t: RelationshipTransport,
): Promise<Relationship[]> {
  const r = await t.request("GET", RELATIONSHIPS_BASE);
  if (!r.ok) {
    if (!isExistenceHidden(r.status)) {
      throw new RelationshipHttpError(r.status, classifyStatus(r.status));
    }
    return [];
  }
  return asRelationshipArray(r.json);
}

/**
 * Fetch one relationship (vc.get_relationship). Returns the relationship on
 * success, null on 403/404 (existence hidden).
 */
export async function getRelationship(
  t: RelationshipTransport,
  relationshipId: string,
): Promise<Relationship | null> {
  const r = await t.request(
    "GET",
    `${RELATIONSHIPS_BASE}/${encodeURIComponent(relationshipId)}`,
  );
  guardResult(r);
  return asRelationship(r.json);
}

/**
 * Activate a relationship (vc.activate_relationship). Returns the activated
 * relationship on success, null on 403/404 (existence hidden).
 */
export async function activateRelationship(
  t: RelationshipTransport,
  relationshipId: string,
): Promise<Relationship | null> {
  const r = await t.request(
    "POST",
    `${RELATIONSHIPS_BASE}/${encodeURIComponent(relationshipId)}`,
  );
  guardResult(r);
  return asRelationship(r.json);
}

/**
 * Deactivate a relationship (vc.deactivate_relationship). Returns the
 * deactivated relationship on success, null on 403/404 (existence hidden).
 */
export async function deactivateRelationship(
  t: RelationshipTransport,
  relationshipId: string,
): Promise<Relationship | null> {
  const r = await t.request(
    "POST",
    `${RELATIONSHIPS_BASE}/${encodeURIComponent(relationshipId)}/deactivate`,
  );
  guardResult(r);
  return asRelationship(r.json);
}
