import type { TransportRequestOptions } from "@/api/transport";

export type RelationshipHttpErrorKind = "unauthorized" | "server" | "client";

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

/**
 * A 2xx response whose body could not be parsed (or did not carry the required
 * shape). For writes the server may have committed, so callers must treat this
 * as an UNKNOWN outcome, not a definite failure.
 */
export class RelationshipProtocolError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`relationship response was not valid protocol JSON (status ${status})`);
    this.name = "RelationshipProtocolError";
    this.status = status;
  }
}

// 服务端 catalog（backend/internal/httpapi/catalog.go）；DB CHECK 约束保证
// 合法关系行永远只携带这些枚举值。
export type ReplyLength = "SHORT" | "MEDIUM" | "LONG";
export type Initiative = "LOW" | "MEDIUM" | "HIGH";
export type HumorLevel = "NONE" | "LIGHT" | "WARM";
export type AdvicePref = "ASK_FIRST" | "DIRECT" | "RARE";
export type MemoryShareScope = "SESSION" | "RELATIONSHIP";
export type GenderPresentation = "FEMALE" | "MALE" | "NEUTRAL";
export type AvatarRef = "AVATAR_FEMALE_01" | "AVATAR_MALE_01" | "AVATAR_NEUTRAL_01";
export type AvoidTopic =
  | "WORK"
  | "FAMILY"
  | "HEALTH"
  | "ROMANCE"
  | "MONEY"
  | "POLITICS"
  | "SUBSTANCE"
  | "RELIGION";

const REPLY_LENGTHS: readonly ReplyLength[] = ["SHORT", "MEDIUM", "LONG"];
const INITIATIVES: readonly Initiative[] = ["LOW", "MEDIUM", "HIGH"];
const HUMORS: readonly HumorLevel[] = ["NONE", "LIGHT", "WARM"];
const ADVICE_PREFS: readonly AdvicePref[] = ["ASK_FIRST", "DIRECT", "RARE"];
const MEMORY_SHARES: readonly MemoryShareScope[] = ["SESSION", "RELATIONSHIP"];
const GENDERS: readonly GenderPresentation[] = ["FEMALE", "MALE", "NEUTRAL"];
const AVATARS: readonly AvatarRef[] = ["AVATAR_FEMALE_01", "AVATAR_MALE_01", "AVATAR_NEUTRAL_01"];
const AVOID_TOPICS: readonly AvoidTopic[] = [
  "WORK",
  "FAMILY",
  "HEALTH",
  "ROMANCE",
  "MONEY",
  "POLITICS",
  "SUBSTANCE",
  "RELIGION",
];

/** PATCH /relationships/{id} 是全量替换：所有结构化字段都必须回传。 */
export interface CompanionPrefs {
  /** 空 null 表示清除称呼。 */
  companionName: string | null;
  userAddressAs: string | null;
  replyLength: ReplyLength;
  initiative: Initiative;
  humor: HumorLevel;
  advicePref: AdvicePref;
  remindersAllowed: boolean;
  memoryShareScope: MemoryShareScope;
  avoidTopics: AvoidTopic[];
  gender: GenderPresentation;
  avatarRef: AvatarRef;
}

export interface Relationship {
  relationshipId: string;
  personaRef: string;
  active: boolean;
  createdAt?: string;
  companionName?: string | null;
  userAddressAs?: string | null;
  replyLength?: ReplyLength;
  initiative?: Initiative;
  humor?: HumorLevel;
  advicePref?: AdvicePref;
  remindersAllowed?: boolean;
  memoryShareScope?: MemoryShareScope;
  avoidTopics?: AvoidTopic[];
  gender?: GenderPresentation;
  avatarRef?: AvatarRef;
}

export interface RelationshipApiResponse {
  ok: boolean;
  status: number;
  json: unknown;
  /** True when the HTTP body could not be decoded as JSON. */
  parseFailed?: boolean;
}

export interface RelationshipTransport {
  request(
    method: string,
    path: string,
    body?: unknown,
    opts?: TransportRequestOptions,
  ): Promise<RelationshipApiResponse>;
}

/** 普通读写请求的有界超时；超时即"结果未知"。 */
const READ_TIMEOUT_MS = 15_000;
const readOpts: TransportRequestOptions = { timeoutMs: READ_TIMEOUT_MS };

function classifyStatus(status: number): RelationshipHttpErrorKind {
  if (status === 401) return "unauthorized";
  if (status >= 500) return "server";
  return "client";
}

function asId(value: unknown): string | null {
  if (typeof value === "string" && value) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function asEnum<T extends string>(set: readonly T[], value: unknown): T | undefined {
  return typeof value === "string" && (set as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

function asOptName(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  return typeof value === "string" ? value : null;
}

function asAvoidTopics(value: unknown): AvoidTopic[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter(
    (topic): topic is AvoidTopic =>
      typeof topic === "string" && (AVOID_TOPICS as readonly string[]).includes(topic),
  );
}

function asRelationship(value: unknown): Relationship | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const relationshipId = asId(row.relationshipId);
  const personaRef = typeof row.personaRef === "string" ? row.personaRef : "";
  if (!relationshipId || !personaRef) return null;
  return {
    relationshipId,
    personaRef,
    active: row.active === true,
    createdAt: typeof row.createdAt === "string" ? row.createdAt : undefined,
    companionName: asOptName(row.companionName),
    userAddressAs: asOptName(row.userAddressAs),
    replyLength: asEnum(REPLY_LENGTHS, row.replyLength),
    initiative: asEnum(INITIATIVES, row.initiative),
    humor: asEnum(HUMORS, row.humor),
    advicePref: asEnum(ADVICE_PREFS, row.advicePref),
    remindersAllowed: typeof row.remindersAllowed === "boolean" ? row.remindersAllowed : undefined,
    memoryShareScope: asEnum(MEMORY_SHARES, row.memoryShareScope),
    avoidTopics: asAvoidTopics(row.avoidTopics),
    gender: asEnum(GENDERS, row.gender),
    avatarRef: asEnum(AVATARS, row.avatarRef),
  };
}

/**
 * 偏好完整性检查：PATCH 需要回传全部结构化字段，缺一不可。
 * 服务端 relationshipJSON 永远携带全部字段（DB NOT NULL + CHECK），
 * 缺失只可能来自响应体损坏。
 */
export function prefsOfRelationship(rel: Relationship): CompanionPrefs | null {
  if (!rel.replyLength || !rel.initiative || !rel.humor || !rel.advicePref
    || !rel.memoryShareScope || !rel.gender || !rel.avatarRef
    || rel.remindersAllowed === undefined
    || rel.avoidTopics === undefined) {
    return null;
  }
  return {
    companionName: rel.companionName ?? null,
    userAddressAs: rel.userAddressAs ?? null,
    replyLength: rel.replyLength,
    initiative: rel.initiative,
    humor: rel.humor,
    advicePref: rel.advicePref,
    remindersAllowed: rel.remindersAllowed,
    memoryShareScope: rel.memoryShareScope,
    avoidTopics: [...rel.avoidTopics],
    gender: rel.gender,
    avatarRef: rel.avatarRef,
  };
}

/** Read the account's server-created relationship; no creation or persona UI exists. */
export async function listRelationships(
  transport: RelationshipTransport,
): Promise<Relationship[]> {
  const response = await transport.request(
    "GET",
    "/api/v1/relationships",
    undefined,
    readOpts,
  );
  if (!response.ok) {
    if (response.status === 403 || response.status === 404) return [];
    throw new RelationshipHttpError(response.status, classifyStatus(response.status));
  }
  if (!Array.isArray(response.json)) return [];
  return response.json.flatMap((value) => {
    const relationship = asRelationship(value);
    return relationship ? [relationship] : [];
  });
}

/**
 * 全量替换一段关系的陪伴偏好；成功返回服务端回读的新基线。
 * 2xx 但响应不可解析时抛 RelationshipProtocolError（提交结果未知）。
 */
export async function updateRelationshipPrefs(
  transport: RelationshipTransport,
  relationshipId: string,
  prefs: CompanionPrefs,
): Promise<Relationship> {
  const response = await transport.request(
    "PATCH",
    `/api/v1/relationships/${encodeURIComponent(relationshipId)}`,
    {
      companionName: prefs.companionName,
      userAddressAs: prefs.userAddressAs,
      replyLength: prefs.replyLength,
      initiative: prefs.initiative,
      humor: prefs.humor,
      advicePref: prefs.advicePref,
      remindersAllowed: prefs.remindersAllowed,
      memoryShareScope: prefs.memoryShareScope,
      avoidTopics: prefs.avoidTopics,
      gender: prefs.gender,
      avatarRef: prefs.avatarRef,
    },
    readOpts,
  );
  if (!response.ok) {
    throw new RelationshipHttpError(response.status, classifyStatus(response.status));
  }
  const updated = asRelationship(response.json);
  if (!updated) throw new RelationshipProtocolError(response.status);
  return updated;
}
