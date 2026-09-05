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

export interface Relationship {
  relationshipId: string;
  personaRef: string;
  active: boolean;
  createdAt?: string;
  companionName?: string | null;
}

export interface RelationshipApiResponse {
  ok: boolean;
  status: number;
  json: unknown;
}

export interface RelationshipTransport {
  request(method: string, path: string, body?: unknown): Promise<RelationshipApiResponse>;
}

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
    companionName: typeof row.companionName === "string" ? row.companionName : null,
  };
}

/** Read the account's server-created relationship; no creation or persona UI exists. */
export async function listRelationships(
  transport: RelationshipTransport,
): Promise<Relationship[]> {
  const response = await transport.request("GET", "/api/v1/relationships");
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
