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

export interface BaselinePayload {
  application: string;
  phase: string;
  transport: string;
  technology: BaselineTechnology;
  catalogs: BaselineCatalogs;
}

export const BASELINE_ENDPOINT = "/api/internal/baseline";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isBaselinePayload(value: unknown): value is BaselinePayload {
  if (!isRecord(value) || !isRecord(value.technology) || !isRecord(value.catalogs)) {
    return false;
  }

  return (
    typeof value.application === "string" &&
    typeof value.phase === "string" &&
    typeof value.transport === "string" &&
    typeof value.technology.javaVersion === "string" &&
    typeof value.technology.springBootVersion === "string" &&
    typeof value.technology.springAiVersion === "string" &&
    typeof value.technology.springModulithVersion === "string" &&
    typeof value.catalogs.source === "string" &&
    isStringArray(value.catalogs.riskLevels) &&
    isStringArray(value.catalogs.generationStates) &&
    isStringArray(value.catalogs.memoryScopes) &&
    isStringArray(value.catalogs.modelProtocols) &&
    isStringArray(value.catalogs.serviceModes)
  );
}

export function fetchBaseline(): Promise<BaselinePayload> {
  return new Promise((resolve, reject) => {
    uni.request({
      url: BASELINE_ENDPOINT,
      method: "GET",
      timeout: 5000,
      success(response) {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(
            new Error(`本地后端返回 HTTP ${response.statusCode}，开发基线读取失败。`),
          );
          return;
        }

        if (!isBaselinePayload(response.data)) {
          reject(new Error("本地后端返回了无法识别的开发基线数据。"));
          return;
        }

        resolve(response.data);
      },
      fail() {
        reject(
          new Error(
            "无法访问本地后端，请确认 Runtime 已在 127.0.0.1:8080 启动。",
          ),
        );
      },
    });
  });
}
