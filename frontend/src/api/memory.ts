/** Memory management API client (saved memories, candidates, auto-save switch). */

import type { TransportRequestOptions } from "@/api/transport";

export type MemoryHttpErrorKind = "unauthorized" | "server" | "client";

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

/**
 * A 2xx response whose body could not be parsed (or did not carry the required
 * shape). This is a PROTOCOL error, never an empty result: for writes the
 * server may have committed, so callers must treat it as an unknown outcome.
 */
export class MemoryProtocolError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`memory response was not valid protocol JSON (status ${status})`);
    this.name = "MemoryProtocolError";
    this.status = status;
  }
}

export type MemoryStatus = "PENDING_CONFIRMATION" | "ACCEPTED" | "REJECTED";

export interface MemoryItem {
  memoryId: string;
  scope: string;
  summary: string;
  status: MemoryStatus;
  /** 来源对话；列表自带的来源字段。 */
  conversationId?: string;
  createdAt?: string;
  deletedAt?: string;
  autoSaved: boolean;
  /** 被 newer 提取替代的旧记忆；页面主视图不再展示。 */
  supersededAt?: string;
  supersededByMemoryId?: string;
  eventAt?: string;
  eventStatus?: string;
  eventExpiresAt?: string;
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
  /** True when the HTTP body could not be decoded as JSON. */
  parseFailed?: boolean;
}

export interface MemoryTransport {
  request(
    method: string,
    path: string,
    body?: unknown,
    opts?: TransportRequestOptions,
  ): Promise<MemoryApiResponse>;
}

/**
 * 普通请求 15s 量级的有界超时。列表接口（vc.list_memory）没有 limit/游标
 * 参数，一次返回该关系下全部未删除记忆，页面不做"加载更多"。
 */
const READ_TIMEOUT_MS = 15_000;
const readOpts: TransportRequestOptions = { timeoutMs: READ_TIMEOUT_MS };

const STATUSES: readonly MemoryStatus[] = ["PENDING_CONFIRMATION", "ACCEPTED", "REJECTED"];

function classifyStatus(status: number): MemoryHttpErrorKind {
  if (status === 401) return "unauthorized";
  if (status >= 500) return "server";
  return "client";
}

function isExistenceHidden(status: number): boolean {
  return status === 403 || status === 404;
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

function asMemoryItem(json: unknown): MemoryItem | null {
  if (!json || typeof json !== "object") return null;
  const object = json as Record<string, unknown>;
  const memoryId = asId(object.memoryId);
  const summary = asString(object, "summary");
  const status = asString(object, "status");
  if (!memoryId || summary === undefined || summary === null) return null;
  if (!status || !(STATUSES as readonly string[]).includes(status)) return null;
  return {
    memoryId,
    scope: asString(object, "scope") ?? "",
    summary,
    status: status as MemoryStatus,
    conversationId: asId(object.conversationId),
    createdAt: asString(object, "createdAt"),
    deletedAt: asString(object, "deletedAt"),
    autoSaved: object.autoSaved === true,
    supersededAt: asString(object, "supersededAt"),
    supersededByMemoryId: asId(object.supersededByMemoryId),
    eventAt: asString(object, "eventAt"),
    eventStatus: asString(object, "eventStatus"),
    eventExpiresAt: asString(object, "eventExpiresAt"),
  };
}

function asMemoryArray(json: unknown): MemoryItem[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((item) => {
    const memory = asMemoryItem(item);
    return memory ? [memory] : [];
  });
}

function asEvidence(json: unknown): MemoryEvidence {
  if (!json || typeof json !== "object") {
    return { evidenceId: "", sourceRef: "" };
  }
  const object = json as Record<string, unknown>;
  return {
    evidenceId: asString(object, "evidenceId") ?? "",
    sourceRef: asString(object, "sourceRef") ?? "",
    createdAt: asString(object, "createdAt"),
  };
}

/** 列出该关系下未删除的记忆（含待确认与已拒绝；无分页，一次加载）。 */
export async function listMemories(
  transport: MemoryTransport,
  relationshipId: string,
  includeDeleted = false,
): Promise<MemoryItem[]> {
  const query = includeDeleted ? "?includeDeleted=true" : "";
  const response = await transport.request(
    "GET",
    `/api/v1/relationships/${encodeURIComponent(relationshipId)}/memories${query}`,
    undefined,
    readOpts,
  );
  if (!response.ok) {
    if (isExistenceHidden(response.status)) return [];
    throw new MemoryHttpError(response.status, classifyStatus(response.status));
  }
  if (response.parseFailed || !Array.isArray(response.json)) {
    throw new MemoryProtocolError(response.status);
  }
  return asMemoryArray(response.json);
}

/** 编辑记忆摘要；2xx 但响应不可解析时抛 MemoryProtocolError（结果未知）。 */
export async function updateMemory(
  transport: MemoryTransport,
  memoryId: string,
  summary: string,
): Promise<MemoryItem> {
  const response = await transport.request(
    "PATCH",
    `/api/v1/memories/${encodeURIComponent(memoryId)}`,
    { summary },
    readOpts,
  );
  if (!response.ok) {
    throw new MemoryHttpError(response.status, classifyStatus(response.status));
  }
  if (response.parseFailed) throw new MemoryProtocolError(response.status);
  const updated = asMemoryItem(response.json);
  if (!updated) throw new MemoryProtocolError(response.status);
  return updated;
}

/** 删除（软删除）一条记忆。 */
export async function deleteMemory(
  transport: MemoryTransport,
  memoryId: string,
): Promise<MemoryItem | null> {
  const response = await transport.request(
    "DELETE",
    `/api/v1/memories/${encodeURIComponent(memoryId)}`,
    undefined,
    readOpts,
  );
  if (!response.ok) {
    if (isExistenceHidden(response.status)) return null;
    throw new MemoryHttpError(response.status, classifyStatus(response.status));
  }
  if (response.parseFailed) throw new MemoryProtocolError(response.status);
  return asMemoryItem(response.json);
}

/** 确认一条待确认候选（空请求体）。 */
export async function confirmMemory(
  transport: MemoryTransport,
  memoryId: string,
): Promise<MemoryItem> {
  const response = await transport.request(
    "POST",
    `/api/v1/memories/${encodeURIComponent(memoryId)}/confirm`,
    undefined,
    readOpts,
  );
  if (!response.ok) {
    throw new MemoryHttpError(response.status, classifyStatus(response.status));
  }
  if (response.parseFailed) throw new MemoryProtocolError(response.status);
  const confirmed = asMemoryItem(response.json);
  if (!confirmed) throw new MemoryProtocolError(response.status);
  return confirmed;
}

export async function rejectMemory(
  transport: MemoryTransport,
  memoryId: string,
): Promise<MemoryItem> {
  const response = await transport.request(
    "POST",
    `/api/v1/memories/${encodeURIComponent(memoryId)}/reject`,
    undefined,
    readOpts,
  );
  if (!response.ok) {
    throw new MemoryHttpError(response.status, classifyStatus(response.status));
  }
  if (response.parseFailed) throw new MemoryProtocolError(response.status);
  const rejected = asMemoryItem(response.json);
  if (!rejected) throw new MemoryProtocolError(response.status);
  return rejected;
}

/** 记忆来源引用列表；sourceRef 是内部引用（如 message:12），不是正文。 */
export async function listMemoryEvidence(
  transport: MemoryTransport,
  memoryId: string,
): Promise<MemoryEvidence[]> {
  const response = await transport.request(
    "GET",
    `/api/v1/memories/${encodeURIComponent(memoryId)}/evidence`,
    undefined,
    readOpts,
  );
  if (!response.ok) {
    if (isExistenceHidden(response.status)) return [];
    throw new MemoryHttpError(response.status, classifyStatus(response.status));
  }
  if (response.parseFailed || !Array.isArray(response.json)) {
    throw new MemoryProtocolError(response.status);
  }
  return response.json.map(asEvidence);
}

export async function getMemoryAutoSavePref(transport: MemoryTransport): Promise<boolean> {
  const response = await transport.request("GET", "/api/v1/memory-auto-save-pref", undefined, readOpts);
  if (!response.ok) {
    throw new MemoryHttpError(response.status, classifyStatus(response.status));
  }
  if (response.parseFailed || !response.json || typeof response.json !== "object") {
    throw new MemoryProtocolError(response.status);
  }
  return (response.json as Record<string, unknown>).enabled === true;
}

/** 更新自动记忆开关；2xx 但响应不可解析时抛 MemoryProtocolError（结果未知）。 */
export async function updateMemoryAutoSavePref(
  transport: MemoryTransport,
  enabled: boolean,
): Promise<boolean> {
  const response = await transport.request(
    "PUT",
    "/api/v1/memory-auto-save-pref",
    { enabled },
    readOpts,
  );
  if (!response.ok) {
    throw new MemoryHttpError(response.status, classifyStatus(response.status));
  }
  if (response.parseFailed || !response.json || typeof response.json !== "object") {
    throw new MemoryProtocolError(response.status);
  }
  return (response.json as Record<string, unknown>).enabled === true;
}
