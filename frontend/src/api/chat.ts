/** Chat, generation and history API client used by the consumer experience. */

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
}

export interface ChatTransport {
  request(method: string, path: string, body?: unknown): Promise<ChatApiResponse>;
}

const CONVERSATIONS_BASE = "/api/v1/conversations";
const GENERATIONS_BASE = "/api/v1/generations";

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
  const response = await transport.request("POST", CONVERSATIONS_BASE, { relationshipId });
  guardResult(response);
  if (!response.ok || !response.json || typeof response.json !== "object") return null;
  const conversationId = asId((response.json as Record<string, unknown>).conversationId);
  return conversationId ? { conversationId } : null;
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
  const response = await transport.request("GET", `${CONVERSATIONS_BASE}${query}`);
  if (!response.ok) {
    if (isExistenceHidden(response.status)) return [];
    throw new ChatHttpError(response.status, classifyStatus(response.status));
  }
  return asConversationList(response.json);
}

export async function sendGeneration(
  transport: ChatTransport,
  conversationId: string,
  idempotencyKey: string,
  userContent?: string,
): Promise<Generation | null> {
  const body: Record<string, unknown> = { idempotencyKey };
  if (userContent !== undefined) body.userContent = userContent;
  const response = await transport.request(
    "POST",
    `${CONVERSATIONS_BASE}/${encodeURIComponent(conversationId)}/generations`,
    body,
  );
  guardResult(response);
  return asGeneration(response.json);
}

export async function listMessages(
  transport: ChatTransport,
  conversationId: string,
  after?: string,
  limit?: number,
): Promise<Message[]> {
  const params: string[] = [];
  if (after !== undefined) params.push(`after=${encodeURIComponent(after)}`);
  if (limit !== undefined) params.push(`limit=${limit}`);
  const query = params.length > 0 ? `?${params.join("&")}` : "";
  const response = await transport.request(
    "GET",
    `${CONVERSATIONS_BASE}/${encodeURIComponent(conversationId)}/messages${query}`,
  );
  if (!response.ok) {
    if (isExistenceHidden(response.status)) return [];
    throw new ChatHttpError(response.status, classifyStatus(response.status));
  }
  return asMessageArray(response.json);
}

export async function cancelGeneration(
  transport: ChatTransport,
  generationId: string,
): Promise<Generation | null> {
  const response = await transport.request(
    "POST",
    `${GENERATIONS_BASE}/${encodeURIComponent(generationId)}/cancel`,
  );
  guardResult(response);
  return asGeneration(response.json);
}

/** Runtime service status used only by the H5 administration console. */
export async function getServiceMode(
  transport: ChatTransport,
): Promise<ServiceModeStatus | null> {
  const response = await transport.request("GET", "/api/v1/service-mode");
  if (!response.ok) {
    throw new ChatHttpError(response.status, classifyStatus(response.status));
  }
  if (!response.json || typeof response.json !== "object") return null;
  const object = response.json as Record<string, unknown>;
  const mode = object.mode;
  const summary = asString(object, "summary");
  if (mode !== "FULL_AI" && mode !== "DEGRADED_AI" && mode !== "ZERO_LLM") return null;
  return summary ? { mode, summary } : null;
}
