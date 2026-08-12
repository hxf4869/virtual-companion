// TASK-0186: Chat / Generation / History API client. The transport is injected
// so the store and specs can mock request() exactly like api/memory.spec.ts.
//
// Only product-confirmed 403/404 hide existence (INV-TENANT-001) — a
// not-found/forbidden response maps to null / empty and never throws an
// existence-disclosing error. Every OTHER non-OK status is a typed
// ChatHttpError: 401 → unauthorized (session handling), 5xx → server, remaining
// 4xx → client; an OK response whose body failed to parse returns null (the
// transport sets json to null on parse failure). A transport (network) failure
// still propagates as a throw so the store can surface a failure without faking
// success. The api layer never swallows 401/5xx failures into empty success.
//
// IDs are decimal strings on the wire (OpenAPI type: string). The Java backend
// serialises long as a JSON number, so asId() accepts both string and number and
// normalises to string. owner_user_id is never a request field — the server
// derives ownership from the authenticated principal.

export type ChatHttpErrorKind = "unauthorized" | "server" | "client" | "parse";

/** Typed non-OK failure. Never thrown for existence-hidden 403/404. */
export class ChatHttpError extends Error {
  readonly status: number;
  readonly kind: ChatHttpErrorKind;

  constructor(status: number, kind: ChatHttpErrorKind) {
    super(`chat request failed with status ${status} (${kind})`);
    this.name = "ChatHttpError";
    this.status = status;
    this.kind = kind;
  }
}

export interface Generation {
  generationId: string;
  conversationId: string;
  logicalGenerationId: string;
  status: string;
  createdAt?: string;
}

export interface Message {
  messageId: string;
  conversationId: string;
  role: string;
  content: string;
  createdAt?: string;
}

export interface CreateConversationResponse {
  conversationId: string;
}

export interface ChatApiResponse {
  ok: boolean;
  status: number;
  json: unknown;
}

export interface ChatTransport {
  request(method: string, path: string, body?: unknown): Promise<ChatApiResponse>;
}

const CONVERSATIONS_BASE = "/api/v1/conversations";
const GENERATIONS_BASE = "/api/v1/generations";

/** Only product-confirmed 403/404 hide existence (INV-TENANT-001). */
function isExistenceHidden(status: number): boolean {
  return status === 403 || status === 404;
}

function classifyStatus(status: number): ChatHttpErrorKind {
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
function guardResult(r: ChatApiResponse): void {
  if (r.ok) {
    return;
  }
  if (!isExistenceHidden(r.status)) {
    throw new ChatHttpError(r.status, classifyStatus(r.status));
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

function asGeneration(json: unknown): Generation | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const generationId = asId(o.generationId);
  const conversationId = asId(o.conversationId);
  const logicalGenerationId = asString(o, "logicalGenerationId");
  const status = asString(o, "status");
  if (!generationId || !conversationId || !logicalGenerationId || !status) return null;
  return {
    generationId,
    conversationId,
    logicalGenerationId,
    status,
    createdAt: asString(o, "createdAt"),
  };
}

function asMessage(json: unknown): Message | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const messageId = asId(o.messageId);
  const conversationId = asId(o.conversationId);
  const role = asString(o, "role");
  const content = asString(o, "content");
  if (!messageId || !conversationId || !role || content === undefined) return null;
  return {
    messageId,
    conversationId,
    role,
    content,
    createdAt: asString(o, "createdAt"),
  };
}

function asMessageArray(json: unknown): Message[] {
  if (!Array.isArray(json)) return [];
  const out: Message[] = [];
  for (const item of json) {
    const m = asMessage(item);
    if (m) out.push(m);
  }
  return out;
}

/**
 * Create a conversation under a relationship (vc.create_conversation). Returns
 * the new conversationId on success, null on 403/404 (existence hidden).
 */
export async function createConversation(
  t: ChatTransport,
  relationshipId: string,
): Promise<CreateConversationResponse | null> {
  const r = await t.request("POST", CONVERSATIONS_BASE, { relationshipId });
  guardResult(r);
  if (!r.ok) return null;
  if (!r.json || typeof r.json !== "object") return null;
  const conversationId = asId((r.json as Record<string, unknown>).conversationId);
  return conversationId ? { conversationId } : null;
}

/**
 * Idempotently send a chat turn (vc.receive_generation). Returns the generation
 * (newly created or rejoined) on success, null on 403/404 (existence hidden).
 */
export async function sendGeneration(
  t: ChatTransport,
  conversationId: string,
  idempotencyKey: string,
  userContent?: string,
): Promise<Generation | null> {
  const body: Record<string, unknown> = { idempotencyKey };
  if (userContent !== undefined) {
    body.userContent = userContent;
  }
  const r = await t.request(
    "POST",
    `${CONVERSATIONS_BASE}/${encodeURIComponent(conversationId)}/generations`,
    body,
  );
  guardResult(r);
  return asGeneration(r.json);
}

/**
 * Paginated message history (vc.list_messages). A foreign or absent conversation
 * yields an empty array and never discloses existence. 401/5xx throw typed
 * errors so the store never fakes success.
 */
export async function listMessages(
  t: ChatTransport,
  conversationId: string,
  after?: string,
  limit?: number,
): Promise<Message[]> {
  const params: string[] = [];
  if (after !== undefined) {
    params.push(`after=${encodeURIComponent(after)}`);
  }
  if (limit !== undefined) {
    params.push(`limit=${limit}`);
  }
  const query = params.length > 0 ? `?${params.join("&")}` : "";
  const r = await t.request(
    "GET",
    `${CONVERSATIONS_BASE}/${encodeURIComponent(conversationId)}/messages${query}`,
  );
  if (!r.ok) {
    if (!isExistenceHidden(r.status)) {
      throw new ChatHttpError(r.status, classifyStatus(r.status));
    }
    return [];
  }
  return asMessageArray(r.json);
}

/**
 * Cancel a non-terminal generation (vc.cancel_generation). Returns the cancelled
 * generation on success, null on 403/404 (existence hidden).
 */
export async function cancelGeneration(
  t: ChatTransport,
  generationId: string,
): Promise<Generation | null> {
  const r = await t.request(
    "POST",
    `${GENERATIONS_BASE}/${encodeURIComponent(generationId)}/cancel`,
  );
  guardResult(r);
  return asGeneration(r.json);
}
