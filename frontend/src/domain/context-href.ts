// S0-19: one builder/validator for relationship-scoped deep links. Owner is
// still decided by the server; the frontend only refuses to reuse a stale id.

export type ContextPage =
  | "chat"
  | "memory"
  | "memory-detail"
  | "conversations"
  | "companion"
  | "reminder"
  | "report";

export interface ContextIds {
  relationshipId: string | null;
  conversationId: string | null;
  memoryId: string | null;
  messageId: string | null;
}

export interface ContextHrefInput {
  relationshipId?: string | null;
  conversationId?: string | null;
  memoryId?: string | null;
  messageId?: string | null;
  knownRelationshipIds?: ReadonlyArray<string>;
}

const PAGE_PATH: Record<ContextPage, string> = {
  chat: "/pages/chat/chat",
  memory: "/pages/memory/memory",
  "memory-detail": "/pages/memory-detail/memory-detail",
  conversations: "/pages/conversations/conversations",
  companion: "/pages/companion/companion",
  reminder: "/pages/reminder/reminder",
  report: "/pages/report/report",
};

export function sanitizeRelationshipId(
  id: string | null | undefined,
  knownRelationshipIds?: ReadonlyArray<string>,
): string | null {
  const value = typeof id === "string" ? id.trim() : "";
  if (!value) return null;
  if (
    knownRelationshipIds &&
    knownRelationshipIds.length > 0 &&
    !knownRelationshipIds.includes(value)
  ) {
    return null;
  }
  return value;
}

export function buildContextHref(page: ContextPage, ctx: ContextHrefInput = {}): string {
  const params = new URLSearchParams();
  const relationshipId = sanitizeRelationshipId(ctx.relationshipId, ctx.knownRelationshipIds);
  if (relationshipId) params.set("relationshipId", relationshipId);
  const conversationId = trimId(ctx.conversationId);
  if (conversationId && (page === "chat" || page === "conversations")) {
    params.set("conversationId", conversationId);
  }
  const memoryId = trimId(ctx.memoryId);
  if (memoryId && (page === "memory-detail" || page === "memory")) {
    params.set("memoryId", memoryId);
  }
  const messageId = trimId(ctx.messageId);
  if (messageId && page === "report") {
    params.set("messageId", messageId);
  }
  const query = params.toString();
  return query ? `${PAGE_PATH[page]}?${query}` : PAGE_PATH[page];
}

export function parseContextQuery(hrefOrSearch: string): ContextIds {
  const cut = hrefOrSearch.indexOf("?");
  const raw = cut >= 0 ? hrefOrSearch.slice(cut + 1) : hrefOrSearch.replace(/^\?/, "");
  const query = new URLSearchParams(raw);
  return {
    relationshipId: sanitizeRelationshipId(query.get("relationshipId")),
    conversationId: trimId(query.get("conversationId")),
    memoryId: trimId(query.get("memoryId")),
    messageId: trimId(query.get("messageId")),
  };
}

export function readContextFromLocation(loc?: {
  pathname?: string;
  search?: string;
  hash?: string;
}): ContextIds {
  if (!loc) {
    return { relationshipId: null, conversationId: null, memoryId: null, messageId: null };
  }
  if (loc.hash && loc.hash.includes("?")) {
    return parseContextQuery(loc.hash);
  }
  if (loc.search) {
    return parseContextQuery(loc.search);
  }
  return parseContextQuery(`${loc.pathname ?? ""}${loc.search ?? ""}`);
}

function trimId(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}
