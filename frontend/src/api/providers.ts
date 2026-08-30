import type { AuthTransport } from "@/api/auth";

export type ProviderProtocol =
  | "OPENAI_CHAT_COMPLETIONS"
  | "OPENAI_RESPONSES"
  | "ANTHROPIC_MESSAGES";

export type ProviderState = "ENABLED" | "DISABLED";

export interface ModelRoute {
  modelId: string;
  displayName: string;
  contextWindowTokens?: number;
  maxOutputTokens: number;
  priority: number;
  state: ProviderState;
  updatedAt?: string;
}

export interface ModelProvider {
  providerId: string;
  displayName: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  credentialConfigured: boolean;
  state: ProviderState;
  updatedAt?: string;
  models: ModelRoute[];
}

export interface SaveModelProvider {
  displayName: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  credential?: string;
  state: ProviderState;
  models: Array<{
    modelId: string;
    displayName: string;
    contextWindowTokens?: number;
    maxOutputTokens: number;
    state: ProviderState;
  }>;
}

export interface RouteRef {
  providerId: string;
  modelId: string;
}

export interface DiscoveredModel {
  modelId: string;
  displayName: string;
}

export interface DiscoverModelsRequest {
  protocol: ProviderProtocol;
  baseUrl: string;
  credential?: string;
}

export class ProviderHttpError extends Error {
  constructor(readonly status: number) {
    super(`provider request failed: ${status}`);
  }
}

const BASE = "/api/v1/admin";
const PROTOCOLS = new Set<ProviderProtocol>([
  "OPENAI_CHAT_COMPLETIONS",
  "OPENAI_RESPONSES",
  "ANTHROPIC_MESSAGES",
]);

export async function listModelProviders(t: AuthTransport): Promise<ModelProvider[]> {
  const response = await t.request("GET", `${BASE}/providers`);
  if (!response.ok || !Array.isArray(response.json)) {
    throw new ProviderHttpError(response.status);
  }
  const out: ModelProvider[] = [];
  for (const value of response.json) {
    const parsed = parseProvider(value);
    if (!parsed) throw new ProviderHttpError(response.status);
    out.push(parsed);
  }
  return out;
}

export async function saveModelProvider(
  t: AuthTransport,
  providerId: string,
  body: SaveModelProvider,
): Promise<void> {
  const response = await t.request(
    "PUT",
    `${BASE}/providers/${encodeURIComponent(providerId)}`,
    body,
  );
  if (!response.ok) throw new ProviderHttpError(response.status);
}

export async function saveModelRoutingOrder(
  t: AuthTransport,
  routes: RouteRef[],
): Promise<void> {
  const response = await t.request("PUT", `${BASE}/model-routing-order`, { routes });
  if (!response.ok) throw new ProviderHttpError(response.status);
}

export async function discoverProviderModels(
  t: AuthTransport,
  providerId: string,
  body: DiscoverModelsRequest,
): Promise<DiscoveredModel[]> {
  const response = await t.request(
    "POST",
    `${BASE}/providers/${encodeURIComponent(providerId)}/models/discover`,
    body,
  );
  if (!response.ok || !Array.isArray(response.json)) {
    throw new ProviderHttpError(response.status);
  }
  const out: DiscoveredModel[] = [];
  for (const value of response.json) {
    if (!value || typeof value !== "object") throw new ProviderHttpError(response.status);
    const row = value as Record<string, unknown>;
    const modelId = text(row.modelId);
    const displayName = text(row.displayName);
    if (!modelId || !displayName) throw new ProviderHttpError(response.status);
    out.push({ modelId, displayName });
  }
  return out;
}

function parseProvider(value: unknown): ModelProvider | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const providerId = text(row.providerId);
  const displayName = text(row.displayName);
  const protocol = text(row.protocol) as ProviderProtocol | null;
  const baseUrl = text(row.baseUrl);
  const state = text(row.state) as ProviderState | null;
  if (!providerId || !displayName || !protocol || !PROTOCOLS.has(protocol) ||
      !baseUrl || (state !== "ENABLED" && state !== "DISABLED") ||
      typeof row.credentialConfigured !== "boolean" || !Array.isArray(row.models)) {
    return null;
  }
  const models: ModelRoute[] = [];
  for (const model of row.models) {
    const parsed = parseModel(model);
    if (!parsed) return null;
    models.push(parsed);
  }
  return {
    providerId,
    displayName,
    protocol,
    baseUrl,
    credentialConfigured: row.credentialConfigured,
    state,
    updatedAt: text(row.updatedAt) ?? undefined,
    models,
  };
}

function parseModel(value: unknown): ModelRoute | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const modelId = text(row.modelId);
  const displayName = text(row.displayName);
  const state = text(row.state) as ProviderState | null;
  const maxOutputTokens = integer(row.maxOutputTokens);
  const priority = integer(row.priority);
  const contextWindowTokens = row.contextWindowTokens === undefined
    ? undefined
    : integer(row.contextWindowTokens);
  if (!modelId || !displayName || (state !== "ENABLED" && state !== "DISABLED") ||
      maxOutputTokens === null || maxOutputTokens < 1 || priority === null || priority < 1 ||
      (row.contextWindowTokens !== undefined && contextWindowTokens === null)) {
    return null;
  }
  return {
    modelId,
    displayName,
    state,
    maxOutputTokens,
    priority,
    contextWindowTokens: contextWindowTokens ?? undefined,
    updatedAt: text(row.updatedAt) ?? undefined,
  };
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}
