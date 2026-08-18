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

export type CompanionReplyLength = "SHORT" | "MEDIUM" | "LONG";
export type CompanionInitiative = "LOW" | "MEDIUM" | "HIGH";
export type CompanionHumor = "NONE" | "LIGHT" | "WARM";
export type CompanionAdvicePref = "ASK_FIRST" | "DIRECT" | "RARE";
export type CompanionAvoidTopic =
  | "WORK"
  | "FAMILY"
  | "HEALTH"
  | "ROMANCE"
  | "MONEY"
  | "POLITICS"
  | "SUBSTANCE"
  | "RELIGION";
export type CompanionMemoryShare = "SESSION" | "RELATIONSHIP";
export type CompanionGender = "FEMALE" | "MALE" | "NEUTRAL";
export type CompanionAvatar = "AVATAR_FEMALE_01" | "AVATAR_MALE_01" | "AVATAR_NEUTRAL_01";

export interface CompanionPrefs {
  companionName: string | null;
  userAddressAs: string | null;
  replyLength: CompanionReplyLength;
  initiative: CompanionInitiative;
  humor: CompanionHumor;
  advicePref: CompanionAdvicePref;
  remindersAllowed: boolean;
  memoryShareScope: CompanionMemoryShare;
  avoidTopics: CompanionAvoidTopic[];
  gender: CompanionGender;
  avatarRef: CompanionAvatar;
}

export const DEFAULT_COMPANION_PREFS: CompanionPrefs = {
  companionName: null,
  userAddressAs: null,
  replyLength: "MEDIUM",
  initiative: "LOW",
  humor: "LIGHT",
  advicePref: "ASK_FIRST",
  remindersAllowed: false,
  memoryShareScope: "RELATIONSHIP",
  avoidTopics: [],
  gender: "NEUTRAL",
  avatarRef: "AVATAR_NEUTRAL_01",
};

export interface Relationship {
  relationshipId: string;
  personaRef: string;
  active: boolean;
  createdAt?: string;
  companionName?: string | null;
  userAddressAs?: string | null;
  replyLength?: CompanionReplyLength;
  initiative?: CompanionInitiative;
  humor?: CompanionHumor;
  advicePref?: CompanionAdvicePref;
  remindersAllowed?: boolean;
  memoryShareScope?: CompanionMemoryShare;
  avoidTopics?: CompanionAvoidTopic[];
  gender?: CompanionGender;
  avatarRef?: CompanionAvatar;
}

export interface RelationshipPrefsUpdate extends CompanionPrefs {}

export interface RelationshipClearancePreview {
  relationshipId: string;
  conversationCount: number;
  memoryCount: number;
  reminderCount: number;
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

function asEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

const REPLY_LENGTHS = ["SHORT", "MEDIUM", "LONG"] as const;
const INITIATIVES = ["LOW", "MEDIUM", "HIGH"] as const;
const HUMORS = ["NONE", "LIGHT", "WARM"] as const;
const ADVICE_PREFS = ["ASK_FIRST", "DIRECT", "RARE"] as const;
const AVOID_TOPICS = [
  "WORK",
  "FAMILY",
  "HEALTH",
  "ROMANCE",
  "MONEY",
  "POLITICS",
  "SUBSTANCE",
  "RELIGION",
] as const;
const MEMORY_SHARES = ["SESSION", "RELATIONSHIP"] as const;
const GENDERS = ["FEMALE", "MALE", "NEUTRAL"] as const;
const AVATARS = ["AVATAR_FEMALE_01", "AVATAR_MALE_01", "AVATAR_NEUTRAL_01"] as const;

function asAvoidTopics(value: unknown): CompanionAvoidTopic[] {
  if (!Array.isArray(value)) return [];
  const out: CompanionAvoidTopic[] = [];
  for (const item of value) {
    if (typeof item === "string" && (AVOID_TOPICS as readonly string[]).includes(item)) {
      const code = item as CompanionAvoidTopic;
      if (!out.includes(code)) out.push(code);
    }
  }
  return out;
}

function asPrefs(o: Record<string, unknown>): CompanionPrefs {
  const name = asString(o, "companionName");
  const address = asString(o, "userAddressAs");
  return {
    companionName: name && name.trim() ? name : null,
    userAddressAs: address && address.trim() ? address : null,
    replyLength: asEnum(o.replyLength, REPLY_LENGTHS, DEFAULT_COMPANION_PREFS.replyLength),
    initiative: asEnum(o.initiative, INITIATIVES, DEFAULT_COMPANION_PREFS.initiative),
    humor: asEnum(o.humor, HUMORS, DEFAULT_COMPANION_PREFS.humor),
    advicePref: asEnum(o.advicePref, ADVICE_PREFS, DEFAULT_COMPANION_PREFS.advicePref),
    remindersAllowed: o.remindersAllowed === true,
    memoryShareScope: asEnum(
      o.memoryShareScope,
      MEMORY_SHARES,
      DEFAULT_COMPANION_PREFS.memoryShareScope,
    ),
    avoidTopics: asAvoidTopics(o.avoidTopics),
    gender: asEnum(o.gender, GENDERS, DEFAULT_COMPANION_PREFS.gender),
    avatarRef: asEnum(o.avatarRef, AVATARS, DEFAULT_COMPANION_PREFS.avatarRef),
  };
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
    ...asPrefs(o),
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

/**
 * COMP-CFG: replace structured Companion preferences
 * (vc.update_relationship_prefs). Returns the updated relationship on
 * success, null on 403/404 (existence hidden).
 */
export async function updateRelationshipPrefs(
  t: RelationshipTransport,
  relationshipId: string,
  prefs: RelationshipPrefsUpdate,
): Promise<Relationship | null> {
  const r = await t.request(
    "PATCH",
    `${RELATIONSHIPS_BASE}/${encodeURIComponent(relationshipId)}`,
    prefs,
  );
  guardResult(r);
  return asRelationship(r.json);
}

function asNonNegInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return undefined;
}

function asClearancePreview(json: unknown): RelationshipClearancePreview | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const relationshipId = asId(o.relationshipId);
  const conversationCount = asNonNegInt(o.conversationCount);
  const memoryCount = asNonNegInt(o.memoryCount);
  const reminderCount = asNonNegInt(o.reminderCount);
  if (!relationshipId || conversationCount === undefined || memoryCount === undefined || reminderCount === undefined) {
    return null;
  }
  return { relationshipId, conversationCount, memoryCount, reminderCount };
}

/**
 * FR-COMP-004: read-only counts of conversations, memories and reminders
 * a reset or delete would clear (vc.preview_relationship_clearance).
 */
export async function previewRelationshipClearance(
  t: RelationshipTransport,
  relationshipId: string,
): Promise<RelationshipClearancePreview | null> {
  const r = await t.request(
    "GET",
    `${RELATIONSHIPS_BASE}/${encodeURIComponent(relationshipId)}/clearance-preview`,
  );
  guardResult(r);
  return asClearancePreview(r.json);
}

/**
 * FR-COMP-004: clear the relationship domain and keep the Companion row
 * (vc.reset_relationship). Returns the retained relationship, or null on
 * 403/404 (existence hidden).
 */
export async function resetRelationship(
  t: RelationshipTransport,
  relationshipId: string,
): Promise<Relationship | null> {
  const r = await t.request(
    "POST",
    `${RELATIONSHIPS_BASE}/${encodeURIComponent(relationshipId)}/reset`,
  );
  guardResult(r);
  return asRelationship(r.json);
}

/**
 * FR-COMP-004: delete the Companion and cascade its relationship-domain
 * data (vc.delete_relationship). Returns true on a confirmed delete, false
 * on 403/404 (existence hidden).
 */
export async function deleteRelationship(
  t: RelationshipTransport,
  relationshipId: string,
): Promise<boolean> {
  const r = await t.request(
    "DELETE",
    `${RELATIONSHIPS_BASE}/${encodeURIComponent(relationshipId)}`,
  );
  if (!r.ok) {
    if (!isExistenceHidden(r.status)) {
      throw new RelationshipHttpError(r.status, classifyStatus(r.status));
    }
    return false;
  }
  if (!r.json || typeof r.json !== "object") return false;
  return (r.json as Record<string, unknown>).ok === true;
}
