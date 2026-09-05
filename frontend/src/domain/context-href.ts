// S0-19: one builder/validator for relationship-scoped deep links. Owner is
// still decided by the server; the frontend only refuses to reuse a stale id.

export type ContextPage =
  | "chat"
  | "conversations";

export interface ContextIds {
  relationshipId: string | null;
  conversationId: string | null;
}

export interface ContextHrefInput {
  relationshipId?: string | null;
  conversationId?: string | null;
  knownRelationshipIds?: ReadonlyArray<string>;
}

const PAGE_PATH: Record<ContextPage, string> = {
  chat: "/pages/chat/chat",
  conversations: "/pages/conversations/conversations",
};

export function sanitizeRelationshipId(
  id: string | null | undefined,
  knownRelationshipIds?: ReadonlyArray<string>,
): string | null {
  const value = typeof id === "string" ? id.trim() : "";
  if (!value) return null;
  if (
    knownRelationshipIds !== undefined &&
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
  if (conversationId && page === "chat") {
    params.set("conversationId", conversationId);
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
  };
}

export function readContextFromLocation(loc?: {
  pathname?: string;
  search?: string;
  hash?: string;
}): ContextIds {
  if (!loc) {
    return { relationshipId: null, conversationId: null };
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
