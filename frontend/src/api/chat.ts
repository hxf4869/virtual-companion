/** Chat, generation and history API client used by the consumer experience. */

import type { TransportRequestOptions } from "@/api/transport";

export type ChatHttpErrorKind = "unauthorized" | "server" | "client";

export class ChatHttpError extends Error {
  readonly status: number;
  readonly kind: ChatHttpErrorKind;
  readonly code?: string;

  constructor(status: number, kind: ChatHttpErrorKind, code?: string) {
    super(`chat request failed with status ${status} (${kind})`);
    this.name = "ChatHttpError";
    this.status = status;
    this.kind = kind;
    this.code = code;
  }
}

/**
 * A 2xx response whose body could not be parsed (or did not carry the required
 * shape). This is a PROTOCOL error, never an empty result: for writes the
 * server may have committed, so callers must treat it as an unknown outcome.
 */
export class ChatProtocolError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`chat response was not valid protocol JSON (status ${status})`);
    this.name = "ChatProtocolError";
    this.status = status;
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

export type ServiceMode = "FULL_AI" | "DEGRADED_AI" | "ZERO_LLM";

export interface ServiceModeStatus {
  mode: ServiceMode;
  summary: string;
}

export interface CreateConversationResponse {
  conversationId: string;
}

export interface ConversationListItem {
  conversationId: string;
  relationshipId: string;
  lastMessageRole?: string;
  lastMessagePreview?: string;
  createdAt?: string;
  lastActivityAt?: string;
  title?: string;
}

export interface ChatApiResponse {
  ok: boolean;
  status: number;
  json: unknown;
  /** True when the HTTP body could not be decoded as JSON. */
  parseFailed?: boolean;
}

export interface ChatTransport {
  request(
    method: string,
    path: string,
    body?: unknown,
    opts?: TransportRequestOptions,
  ): Promise<ChatApiResponse>;
}

const CONVERSATIONS_BASE = "/api/v1/conversations";
const GENERATIONS_BASE = "/api/v1/generations";
/**
 * WP-D：普通请求 15s、取消请求 5s 量级的有界超时。SSE 流走 realtime
 * transport，绝不适用总时长限制；普通读超时是"结果未知"，与确定失败分开。
 */
const READ_TIMEOUT_MS = 15_000;
const CANCEL_TIMEOUT_MS = 5_000;

const readOpts: TransportRequestOptions = { timeoutMs: READ_TIMEOUT_MS };

function isExistenceHidden(status: number): boolean {
  return status === 403 || status === 404;
}

function classifyStatus(status: number): ChatHttpErrorKind {
  if (status === 401) return "unauthorized";
  if (status >= 500) return "server";
  return "client";
}

function apiErrorCode(json: unknown): string | undefined {
  if (!json || typeof json !== "object") return undefined;
  const code = (json as Record<string, unknown>).code;
  return typeof code === "string" ? code : undefined;
}

function guardResult(response: ChatApiResponse): void {
  if (response.ok) return;
  const code = apiErrorCode(response.json);
  if (response.status === 403 && code === "AGE_VERIFICATION_REQUIRED") {
    throw new ChatHttpError(response.status, classifyStatus(response.status), code);
  }
  if (!isExistenceHidden(response.status)) {
    throw new ChatHttpError(response.status, classifyStatus(response.status), code);
  }
}

function asId(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function asString(object: Record<string, unknown>, key: string): string | undefined {
  const value = object[key];
  return typeof value === "string" ? value : undefined;
}

function asGeneration(json: unknown): Generation | null {
  if (!json || typeof json !== "object") return null;
  const object = json as Record<string, unknown>;
  const generationId = asId(object.generationId);
  const conversationId = asId(object.conversationId);
  const logicalGenerationId = asString(object, "logicalGenerationId");
  const status = asString(object, "status");
  if (!generationId || !conversationId || !logicalGenerationId || !status) return null;
  return {
    generationId,
    conversationId,
    logicalGenerationId,
    status,
    createdAt: asString(object, "createdAt"),
  };
}

function asMessage(json: unknown): Message | null {
  if (!json || typeof json !== "object") return null;
  const object = json as Record<string, unknown>;
  const messageId = asId(object.messageId);
  const conversationId = asId(object.conversationId);
  const role = asString(object, "role");
  const content = asString(object, "content");
  if (!messageId || !conversationId || !role || content === undefined) return null;
  return {
    messageId,
    conversationId,
    role,
    content,
    createdAt: asString(object, "createdAt"),
  };
}

function asMessageArray(json: unknown): Message[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((item) => {
    const message = asMessage(item);
    return message ? [message] : [];
  });
}

function asConversationListItem(json: unknown): ConversationListItem | null {
  if (!json || typeof json !== "object") return null;
  const object = json as Record<string, unknown>;
  const conversationId = asId(object.conversationId);
  const relationshipId = asId(object.relationshipId);
  if (!conversationId || !relationshipId) return null;
  return {
    conversationId,
    relationshipId,
    lastMessageRole: asString(object, "lastMessageRole"),
    lastMessagePreview: asString(object, "lastMessagePreview"),
    createdAt: asString(object, "createdAt"),
    lastActivityAt: asString(object, "lastActivityAt"),
    title: asString(object, "title"),
  };
}

function asConversationList(json: unknown): ConversationListItem[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((item) => {
    const conversation = asConversationListItem(item);
    return conversation ? [conversation] : [];
  });
}

export async function createConversation(
  transport: ChatTransport,
  relationshipId: string,
): Promise<CreateConversationResponse | null> {
  const response = await transport.request(
    "POST",
    CONVERSATIONS_BASE,
    { relationshipId },
    readOpts,
  );
  guardResult(response);
  // Existence-hidden failures stay null; everything else must be ok + valid.
  if (!response.ok) return null;
  if (response.parseFailed) throw new ChatProtocolError(response.status);
  if (!response.json || typeof response.json !== "object") {
    throw new ChatProtocolError(response.status);
  }
  const conversationId = asId((response.json as Record<string, unknown>).conversationId);
  if (!conversationId) throw new ChatProtocolError(response.status);
  return { conversationId };
}

export async function listConversations(
  transport: ChatTransport,
  relationshipId?: string,
  after?: string,
  limit?: number,
): Promise<ConversationListItem[]> {
  const params: string[] = [];
  if (relationshipId !== undefined) {
    params.push(`relationshipId=${encodeURIComponent(relationshipId)}`);
  }
  if (after !== undefined) params.push(`after=${encodeURIComponent(after)}`);
  if (limit !== undefined) params.push(`limit=${limit}`);
  const query = params.length > 0 ? `?${params.join("&")}` : "";
  const response = await transport.request("GET", `${CONVERSATIONS_BASE}${query}`, undefined, readOpts);
  if (!response.ok) {
    if (isExistenceHidden(response.status)) return [];
    throw new ChatHttpError(response.status, classifyStatus(response.status));
  }
  if (response.parseFailed || !Array.isArray(response.json)) {
    throw new ChatProtocolError(response.status);
  }
  return asConversationList(response.json);
}

export async function sendGeneration(
  transport: ChatTransport,
  conversationId: string,
  idempotencyKey: string,
  userContent?: string,
  sourceUserMessageId?: string,
): Promise<Generation | null> {
  const body: Record<string, unknown> = { idempotencyKey };
  if (userContent !== undefined) body.userContent = userContent;
  // N-05（5.3）：明确终态失败后的显式再尝试复用已持久化的原用户消息，
  // 不创建第二条相同用户消息；无可靠 source ID 时调用方不传该参数。
  if (sourceUserMessageId !== undefined) body.sourceUserMessageId = sourceUserMessageId;
  const response = await transport.request(
    "POST",
    `${CONVERSATIONS_BASE}/${encodeURIComponent(conversationId)}/generations`,
    body,
    readOpts,
  );
  guardResult(response);
  if (!response.ok) return null; // existence-hidden
  if (response.parseFailed) throw new ChatProtocolError(response.status);
  const generation = asGeneration(response.json);
  if (!generation) throw new ChatProtocolError(response.status);
  return generation;
}

/**
 * listMessages/listRecentMessages 的公共实现：同一端点、同一错误语义，
 * 仅游标参数名不同（after 向后翻页 / before 向上翻页）。
 */
async function listMessagesPage(
  transport: ChatTransport,
  conversationId: string,
  cursorKey: "after" | "before",
  cursor?: string,
  limit?: number,
): Promise<Message[]> {
  const params: string[] = [];
  if (cursor !== undefined) params.push(`${cursorKey}=${encodeURIComponent(cursor)}`);
  if (limit !== undefined) params.push(`limit=${limit}`);
  const query = params.length > 0 ? `?${params.join("&")}` : "";
  const response = await transport.request(
    "GET",
    `${CONVERSATIONS_BASE}/${encodeURIComponent(conversationId)}/messages${query}`,
    undefined,
    readOpts,
  );
  if (!response.ok) {
    if (isExistenceHidden(response.status)) return [];
    throw new ChatHttpError(response.status, classifyStatus(response.status));
  }
  if (response.parseFailed || !Array.isArray(response.json)) {
    throw new ChatProtocolError(response.status);
  }
  return asMessageArray(response.json);
}

export async function listMessages(
  transport: ChatTransport,
  conversationId: string,
  after?: string,
  limit?: number,
): Promise<Message[]> {
  return listMessagesPage(transport, conversationId, "after", after, limit);
}

/**
 * WP-D：最近窗口/向上分页读取（后端契约：before 为空返回会话最后 limit 条，
 * 传 before 返回比它更早的一页；响应内一律按 id 升序；与 after 互斥）。
 */
export async function listRecentMessages(
  transport: ChatTransport,
  conversationId: string,
  before?: string,
  limit?: number,
): Promise<Message[]> {
  return listMessagesPage(transport, conversationId, "before", before, limit);
}

export async function cancelGeneration(
  transport: ChatTransport,
  generationId: string,
): Promise<Generation | null> {
  const response = await transport.request(
    "POST",
    `${GENERATIONS_BASE}/${encodeURIComponent(generationId)}/cancel`,
    undefined,
    { timeoutMs: CANCEL_TIMEOUT_MS },
  );
  guardResult(response);
  if (!response.ok) return null; // existence-hidden
  if (response.parseFailed) throw new ChatProtocolError(response.status);
  const generation = asGeneration(response.json);
  if (!generation) throw new ChatProtocolError(response.status);
  return generation;
}

/** Runtime service status used only by the H5 administration console. */
export async function getServiceMode(
  transport: ChatTransport,
): Promise<ServiceModeStatus | null> {
  const response = await transport.request("GET", "/api/v1/service-mode", undefined, readOpts);
  if (!response.ok) {
    throw new ChatHttpError(response.status, classifyStatus(response.status));
  }
  if (response.parseFailed) throw new ChatProtocolError(response.status);
  if (!response.json || typeof response.json !== "object") return null;
  const object = response.json as Record<string, unknown>;
  const mode = object.mode;
  const summary = asString(object, "summary");
  if (mode !== "FULL_AI" && mode !== "DEGRADED_AI" && mode !== "ZERO_LLM") return null;
  return summary ? { mode, summary } : null;
}
