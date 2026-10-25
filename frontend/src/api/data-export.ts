/**
 * 数据导出 API 客户端（"聊天与记忆副本"：创建申请 / 只读状态 / 一次性下载）。
 *
 * 契约（backend/internal/httpapi/export.go 与 specs/openapi 的 exports 段）：
 * - POST /api/v1/exports 以 { currentPassword } 同步复核当前密码；200 返回
 *   PENDING 申请与只发一次的根相对 downloadUrl。400 可能是请求不合法或已有
 *   PENDING 申请（ErrConflict 的映射），调用方不得断言精确原因；404 是错密码/
 *   存在性隐藏的 fail-closed 映射；401 由既有 auth 流程处理（transport 已
 *   触发 onUnauthorized）。
 * - POST /api/v1/exports/recover 复核当前密码后取回当前 owner 最近一份未领取
 *   且未过期的副本：只旋转一次性 downloadUrl（旧链接失效，已消费的不可重
 *   武装），不新建副本。200 形状与 create 相同（status 为 PENDING 或 READY）；
 *   404 是错密码/没有可取回/删除中的 fail-closed 合并映射，调用方不得断言
 *   唯一原因；401 与精确 409 ACCOUNT_CONTEXT_CHANGED 的语义同 create。
 * - VC-R52：期望账号前置条件被拒时是精确 409 + 信封 code
 *   ACCOUNT_CONTEXT_CHANGED（见 isAccountContextChangedError）。它属于页面级
 *   身份 reconcile 信号，不是密码错误，也不是结果未知。
 * - GET /api/v1/exports/{id} 只读状态（PENDING/READY/FAILED/EXPIRED），状态
 *   响应不再携带 downloadUrl。
 * - downloadUrl 一次性返回 JSON 文档。文档内含 Go int64 ID
 *   （conversationId/messageId/memoryId），可超过 JS
 *   Number.MAX_SAFE_INTEGER，因此下载路径绝不 JSON.parse→JSON.stringify
 *   重构文件，只保留服务器原始字节；创建/状态响应全是字符串字段，复用
 *   AuthTransport 的 JSON 解析是安全的。
 * - errorMessage 是内部错误码，不进任何视图。
 * - 本模块不触碰 localStorage/sessionStorage，不记录密码、token、URL 或
 *   文档正文；任何失败都不自动重试，结果未知由调用方如实呈现。
 */

import { TransportTimeoutError, type TransportRequestOptions } from "@/api/transport";

export type DataExportStatus = "PENDING" | "READY" | "FAILED" | "EXPIRED";

export type DataExportHttpErrorKind = "unauthorized" | "server" | "client";

export class DataExportHttpError extends Error {
  readonly status: number;
  readonly kind: DataExportHttpErrorKind;
  /** Flat error-envelope code carried by the failing response, when readable. */
  readonly serverCode?: string;

  constructor(status: number, kind: DataExportHttpErrorKind, serverCode?: string) {
    super(`data export request failed with status ${status} (${kind})`);
    this.name = "DataExportHttpError";
    this.status = status;
    this.kind = kind;
    this.serverCode = serverCode;
  }
}

/**
 * VC-R52 期望账号前置条件的精确拒绝形态：HTTP 409 + 信封 code
 * ACCOUNT_CONTEXT_CHANGED。这是页面级身份 reconcile 信号，不是密码错误或
 * 结果未知，调用方不得映射成 wrong-password / 网络 UNKNOWN 文案。
 */
export function isAccountContextChangedError(caught: unknown): boolean {
  return caught instanceof DataExportHttpError
    && caught.status === 409
    && caught.serverCode === "ACCOUNT_CONTEXT_CHANGED";
}

/**
 * 2xx 但响应缺少必需形状（或正文不可解析）。创建申请遇到它时结果未知：
 * 服务端可能已受理，调用方不得宣布确定失败。
 */
export class DataExportProtocolError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`data export response was not valid protocol JSON (status ${status})`);
    this.name = "DataExportProtocolError";
    this.status = status;
  }
}

/**
 * 创建申请抛错后的结果分类。正常返回即确认受理。取回（recover）POST 的失败
 * 复用同一分类：4xx 为确定没有取回，其余同样只能归为结果未知（旋转可能已
 * 生效，旧链接可能已失效）。
 * - rejected：服务端明确拒绝（4xx，含 401；400 下可能是请求不合法或已有
 *   PENDING 申请，两种都是确定失败）；
 * - unknown：5xx、协议错误、超时、网络异常及其他程序错误——无法证明申请
 *   未受理，调用方只能进入"结果未知/稍后核对状态"流程。
 */
export type DataExportCreateOutcome = "rejected" | "unknown";

export function classifyDataExportCreateError(caught: unknown): DataExportCreateOutcome {
  if (caught instanceof DataExportHttpError) {
    return caught.kind === "server" ? "unknown" : "rejected";
  }
  return "unknown";
}

export interface DataExportRequestView {
  /** 不透明句柄；UI 永不展示。 */
  exportId: string;
  status: DataExportStatus;
  requestedAt: string;
  completedAt?: string;
  expiresAt?: string;
}

export interface DataExportCreatedView extends DataExportRequestView {
  /** 根相对一次性 URL；仅内存持有，不落任何存储。 */
  downloadUrl: string;
}

export interface DataExportTransport {
  request(
    method: string,
    path: string,
    body?: unknown,
    opts?: TransportRequestOptions,
  ): Promise<{ ok: boolean; status: number; json: unknown; parseFailed?: boolean }>;
}

/** 下载用同源 fetch（页面用既有 createAuthedFetch 创建，cookie 会话随行）。 */
export type DataExportDownloadFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

/** 创建/状态请求 15s 量级的有界超时（超时即结果未知）。 */
const REQUEST_TIMEOUT_MS = 15_000;
const requestOpts: TransportRequestOptions = { timeoutMs: REQUEST_TIMEOUT_MS };

/** 下载覆盖 fetch 发起到 blob() 正文读取完成的 60s 有界等待。 */
const DOWNLOAD_TIMEOUT_MS = 60_000;

const STATUSES: readonly DataExportStatus[] = ["PENDING", "READY", "FAILED", "EXPIRED"];

function classifyStatus(status: number): DataExportHttpErrorKind {
  if (status === 401) return "unauthorized";
  if (status >= 500) return "server";
  return "client";
}

/** Flat error-envelope code from a failing JSON body, when present. */
function envelopeCode(json: unknown): string | undefined {
  if (!json || typeof json !== "object") return undefined;
  const code = (json as Record<string, unknown>).code;
  return typeof code === "string" ? code : undefined;
}

function asString(object: Record<string, unknown>, key: string): string | undefined {
  const value = object[key];
  return typeof value === "string" ? value : undefined;
}

/** 只挑白名单字段；errorMessage 与状态响应里的多余字段一律忽略。 */
function asRequestView(json: unknown): DataExportRequestView | null {
  if (!json || typeof json !== "object") return null;
  const object = json as Record<string, unknown>;
  const exportId = asString(object, "exportId");
  const status = asString(object, "status");
  const requestedAt = asString(object, "requestedAt");
  if (!exportId || !requestedAt) return null;
  if (!status || !(STATUSES as readonly string[]).includes(status)) return null;
  return {
    exportId,
    status: status as DataExportStatus,
    requestedAt,
    completedAt: asString(object, "completedAt"),
    expiresAt: asString(object, "expiresAt"),
  };
}

/**
 * create 与 recover 共用的 POST 语义：失败按状态映射 DataExportHttpError；
 * 2xx 但响应缺 exportId/status/requestedAt 或非空 downloadUrl 时抛
 * DataExportProtocolError（结果未知）。
 */
async function postForCreatedView(
  transport: DataExportTransport,
  path: string,
  currentPassword: string,
): Promise<DataExportCreatedView> {
  const response = await transport.request(
    "POST",
    path,
    { currentPassword },
    requestOpts,
  );
  if (!response.ok) {
    throw new DataExportHttpError(
      response.status,
      classifyStatus(response.status),
      envelopeCode(response.json),
    );
  }
  if (response.parseFailed) throw new DataExportProtocolError(response.status);
  const view = asRequestView(response.json);
  const downloadUrl =
    response.json && typeof response.json === "object"
      ? asString(response.json as Record<string, unknown>, "downloadUrl")
      : undefined;
  if (!view || !downloadUrl) throw new DataExportProtocolError(response.status);
  return { ...view, downloadUrl };
}

/** 申请导出（同步复核当前密码）。 */
export function createDataExport(
  transport: DataExportTransport,
  currentPassword: string,
): Promise<DataExportCreatedView> {
  return postForCreatedView(transport, "/api/v1/exports", currentPassword);
}

/**
 * 取回最近一份未领取且未过期的副本（同步复核当前密码）：只旋转一次性
 * downloadUrl，不新建副本。响应形状与 create 相同。
 */
export function recoverDataExport(
  transport: DataExportTransport,
  currentPassword: string,
): Promise<DataExportCreatedView> {
  return postForCreatedView(transport, "/api/v1/exports/recover", currentPassword);
}

/** 只读状态；状态响应永不携带 downloadUrl，多余字段忽略。 */
export async function getDataExportStatus(
  transport: DataExportTransport,
  exportId: string,
): Promise<DataExportRequestView> {
  const response = await transport.request(
    "GET",
    `/api/v1/exports/${encodeURIComponent(exportId)}`,
    undefined,
    requestOpts,
  );
  if (!response.ok) {
    throw new DataExportHttpError(
      response.status,
      classifyStatus(response.status),
      envelopeCode(response.json),
    );
  }
  if (response.parseFailed) throw new DataExportProtocolError(response.status);
  const view = asRequestView(response.json);
  if (!view) throw new DataExportProtocolError(response.status);
  return view;
}

/**
 * 一次性下载导出文档，返回服务器原始字节的 Blob；绝不解析或重构 JSON
 * （文档内 int64 ID 超过 Number.MAX_SAFE_INTEGER，重构即失真）。
 * downloadUrl 根相对原样使用，不拼 origin；credentials 由 createAuthedFetch
 * 负责。失败为终态，模块内绝不自动重试。
 */
export async function downloadDataExport(
  downloadFetch: DataExportDownloadFetch,
  downloadUrl: string,
): Promise<Blob> {
  const controller = new AbortController();
  let timedOut = false;
  // 与 transport.ts 缺陷10修法同构：定时器覆盖从 fetch 发起到 blob() 正文
  // 读取完成的全过程；超时中止请求并唤醒可能在正文阶段挂起的等待。
  let wakeBody: (() => void) | undefined;
  const bodyGate = new Promise<void>((resolve) => {
    wakeBody = resolve;
  });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
    wakeBody?.();
  }, DOWNLOAD_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await downloadFetch(downloadUrl, {
        method: "GET",
        signal: controller.signal,
      });
    } catch (error) {
      if (timedOut) {
        throw new TransportTimeoutError(DOWNLOAD_TIMEOUT_MS);
      }
      throw error;
    }
    if (!response.ok) {
      // 404 为确定不可用（已用过/过期/未 READY）；≥500 为 server。失败响应的
      // 小 JSON 信封可以安全读取，只取 code 供精确分类。
      const code = await response.json().then(envelopeCode, () => undefined);
      throw new DataExportHttpError(response.status, classifyStatus(response.status), code);
    }
    // 正文读取与超时竞争：超时触发（gate 唤醒）或超时中止导致 blob()
    // reject 时按结果未知处理；非超时的读取异常保持原样抛出。
    let bodyError: unknown;
    const settled = await Promise.race([
      response.blob().then(
        (blob) => ({ timedOut: false, blob }),
        (error: unknown) => {
          bodyError = error;
          return { timedOut, blob: null };
        },
      ),
      bodyGate.then(() => ({ timedOut: true, blob: null })),
    ]);
    if (settled.timedOut) {
      // timedOut 只能由上方 timer 回调置位。
      throw new TransportTimeoutError(DOWNLOAD_TIMEOUT_MS);
    }
    if (settled.blob === null) {
      throw bodyError;
    }
    if (settled.blob.size === 0) {
      throw new DataExportProtocolError(response.status);
    }
    return settled.blob;
  } finally {
    // 成功/失败/超时各路径都清定时器，无泄漏。
    clearTimeout(timer);
  }
}
