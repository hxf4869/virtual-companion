export const BASELINE_ENDPOINT = "/api/internal/baseline";
export const BASELINE_TIMEOUT_MS = 5000;
export const TECHNICAL_ALPHA_PHASE = "TECHNICAL_ALPHA";
export const TECHNICAL_ALPHA_TRANSPORT = "HTTP_SSE";
export const CAPABILITY_SOURCE =
  "specs/generated/catalog.snapshot.json#sources/product-scope.yaml/document";

export type BaselineFailureKind =
  | "timeout"
  | "unreachable"
  | "http"
  | "invalid-response";

export class BaselineRequestError extends Error {
  readonly kind: BaselineFailureKind;
  readonly statusCode: number | null;

  constructor(
    kind: BaselineFailureKind,
    message: string,
    statusCode: number | null = null,
  ) {
    super(message);
    this.name = "BaselineRequestError";
    this.kind = kind;
    this.statusCode = statusCode;
  }
}

export interface BaselineTechnology {
  javaVersion: string;
  springBootVersion: string;
  springAiVersion: string;
  springModulithVersion: string;
}

export interface BaselineCatalogs {
  source: string;
  riskLevels: string[];
  generationStates: string[];
  memoryScopes: string[];
  modelProtocols: string[];
  serviceModes: string[];
}

export interface BaselineCapabilities {
  source: typeof CAPABILITY_SOURCE;
  publicRegistrationEnabled: false;
  paymentEnabled: false;
  romanceModeEnabled: false;
  voiceEnabled: false;
  imageEnabled: false;
  websocketEnabled: false;
  betaGenerationEnabledByDefault: false;
}

export interface BaselinePayload {
  application: string;
  phase: typeof TECHNICAL_ALPHA_PHASE;
  transport: typeof TECHNICAL_ALPHA_TRANSPORT;
  technology: BaselineTechnology;
  catalogs: BaselineCatalogs;
  capabilities: BaselineCapabilities;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function invalidResponse(): BaselineRequestError {
  return new BaselineRequestError(
    "invalid-response",
    "Runtime 响应未通过边界校验。请检查 Catalog 快照、阶段、传输方式与七项门禁后重试。",
  );
}

/**
 * Accept only the Technical Alpha baseline projection. Returning a fresh
 * object also prevents unexpected response fields from reaching raw details.
 */
export function parseBaselinePayload(value: unknown): BaselinePayload {
  if (
    !isRecord(value) ||
    !isRecord(value.technology) ||
    !isRecord(value.catalogs) ||
    !isRecord(value.capabilities)
  ) {
    throw invalidResponse();
  }

  const technology = value.technology;
  const catalogs = value.catalogs;
  const capabilities = value.capabilities;

  if (
    typeof value.application !== "string" ||
    value.phase !== TECHNICAL_ALPHA_PHASE ||
    value.transport !== TECHNICAL_ALPHA_TRANSPORT ||
    typeof technology.javaVersion !== "string" ||
    typeof technology.springBootVersion !== "string" ||
    typeof technology.springAiVersion !== "string" ||
    typeof technology.springModulithVersion !== "string" ||
    typeof catalogs.source !== "string" ||
    !isStringArray(catalogs.riskLevels) ||
    !isStringArray(catalogs.generationStates) ||
    !isStringArray(catalogs.memoryScopes) ||
    !isStringArray(catalogs.modelProtocols) ||
    !isStringArray(catalogs.serviceModes) ||
    capabilities.source !== CAPABILITY_SOURCE ||
    capabilities.publicRegistrationEnabled !== false ||
    capabilities.paymentEnabled !== false ||
    capabilities.romanceModeEnabled !== false ||
    capabilities.voiceEnabled !== false ||
    capabilities.imageEnabled !== false ||
    capabilities.websocketEnabled !== false ||
    capabilities.betaGenerationEnabledByDefault !== false
  ) {
    throw invalidResponse();
  }

  return {
    application: value.application,
    phase: TECHNICAL_ALPHA_PHASE,
    transport: TECHNICAL_ALPHA_TRANSPORT,
    technology: {
      javaVersion: technology.javaVersion,
      springBootVersion: technology.springBootVersion,
      springAiVersion: technology.springAiVersion,
      springModulithVersion: technology.springModulithVersion,
    },
    catalogs: {
      source: catalogs.source,
      riskLevels: [...catalogs.riskLevels],
      generationStates: [...catalogs.generationStates],
      memoryScopes: [...catalogs.memoryScopes],
      modelProtocols: [...catalogs.modelProtocols],
      serviceModes: [...catalogs.serviceModes],
    },
    capabilities: {
      source: CAPABILITY_SOURCE,
      publicRegistrationEnabled: false,
      paymentEnabled: false,
      romanceModeEnabled: false,
      voiceEnabled: false,
      imageEnabled: false,
      websocketEnabled: false,
      betaGenerationEnabledByDefault: false,
    },
  };
}

function timeoutFailure(): BaselineRequestError {
  return new BaselineRequestError(
    "timeout",
    "读取 Runtime 超时。请确认服务已完成启动并监听 127.0.0.1:8080，然后重试。",
  );
}

function unreachableFailure(): BaselineRequestError {
  return new BaselineRequestError(
    "unreachable",
    "无法连接 Runtime。请启动本地服务，并确认 H5 的 /api 代理指向 127.0.0.1:8080。",
  );
}

function isTimeoutFailure(error: unknown): boolean {
  return (
    isRecord(error) &&
    typeof error.errMsg === "string" &&
    error.errMsg.toLowerCase().includes("timeout")
  );
}

export function fetchBaseline(): Promise<BaselinePayload> {
  return new Promise((resolve, reject) => {
    uni.request({
      url: BASELINE_ENDPOINT,
      method: "GET",
      timeout: BASELINE_TIMEOUT_MS,
      success(response) {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(
            new BaselineRequestError(
              "http",
              `Runtime 返回 HTTP ${response.statusCode}。请检查服务日志与内部基线端点后重试。`,
              response.statusCode,
            ),
          );
          return;
        }

        try {
          resolve(parseBaselinePayload(response.data));
        } catch (error) {
          reject(error);
        }
      },
      fail(error) {
        reject(isTimeoutFailure(error) ? timeoutFailure() : unreachableFailure());
      },
    });
  });
}
