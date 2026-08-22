// S0-14-D: operator-facing case rows never carry chat body, providerRef, or
// internal notes even if a buggy payload includes those keys.

const FORBIDDEN = new Set([
  "internalNote",
  "internal_note",
  "providerRef",
  "provider_ref",
  "body",
  "messageBody",
  "message",
  "content",
  "note",
]);

export interface PublicOpsCase {
  id: string;
  kind: string;
  sourceOwnerId: string;
  sourceId: string;
  status: string;
  severity: string;
  slaHours?: number;
  assigneeAccountId?: string;
  dispositionReason: string;
  publicNote: string;
  openedAt: string;
}

export function redactOpsCase(json: unknown): PublicOpsCase | null {
  if (!json || typeof json !== "object") return null;
  const raw = json as Record<string, unknown>;
  const id = str(raw.id);
  const kind = str(raw.kind);
  const sourceOwnerId = str(raw.sourceOwnerId);
  const sourceId = str(raw.sourceId);
  const status = str(raw.status);
  const severity = str(raw.severity);
  const openedAt = str(raw.openedAt);
  if (!id || !kind || !sourceOwnerId || !sourceId || !status || !severity || !openedAt) {
    return null;
  }
  const sla = raw.slaHours;
  return {
    id,
    kind,
    sourceOwnerId,
    sourceId,
    status,
    severity,
    slaHours: typeof sla === "number" ? sla : undefined,
    assigneeAccountId: str(raw.assigneeAccountId),
    dispositionReason: str(raw.dispositionReason) ?? "",
    publicNote: str(raw.publicNote) ?? "",
    openedAt,
  };
}

export function opsCaseLeaksForbidden(text: string): boolean {
  const lower = text.toLowerCase();
  for (const key of FORBIDDEN) {
    if (lower.includes(key.toLowerCase()) && key !== "note") {
      return true;
    }
  }
  return false;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
