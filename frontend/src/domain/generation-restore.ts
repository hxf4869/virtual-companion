// S0-20 review-fix: full-page-refresh recovery for an in-flight generation.
//
// Only NON-SENSITIVE identifiers ever touch sessionStorage: the generation,
// conversation and relationship ids plus the account binding and a timestamp.
// No access token, no message body, no memory content — the server snapshot
// stays the sole authority for what happened while the page was away.

export interface RestorableGeneration {
  /** Owner binding: a different signed-in account must never see this entry. */
  accountId: string;
  relationshipId: string;
  conversationId: string;
  generationId: string;
  savedAtEpochMs: number;
}

/** Minimal shape of sessionStorage used here (injectable for tests). */
export interface RestorableStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const RESTORE_KEY = "vc.gen.restore";

/** A pending turn older than this is treated as expired on reload. */
export const RESTORE_MAX_AGE_MS = 10 * 60_000;

/** sessionStorage is optional (privacy mode / SSR): all helpers tolerate absence. */
export function safeSessionStorage(): RestorableStorage | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    return sessionStorage;
  } catch {
    return null;
  }
}

export function saveRestorableGeneration(
  storage: RestorableStorage | null,
  entry: RestorableGeneration,
): void {
  if (!storage) return;
  if (
    !entry.accountId ||
    !entry.generationId ||
    !entry.conversationId ||
    !entry.relationshipId
  ) {
    return; // never persist a partially bound entry — it could not be validated
  }
  try {
    storage.setItem(RESTORE_KEY, JSON.stringify(entry));
  } catch {
    // Quota/private-mode failures only cost the recovery convenience.
  }
}

/**
 * Load a still-valid entry, or null when absent, malformed, expired or
 * tampered into an impossible shape. Never throws.
 */
export function loadRestorableGeneration(
  storage: RestorableStorage | null,
  nowEpochMs: number = Date.now(),
): RestorableGeneration | null {
  if (!storage) return null;
  let raw: string | null = null;
  try {
    raw = storage.getItem(RESTORE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    clearRestorableGeneration(storage);
    return null;
  }
  const entry = parsed as Partial<RestorableGeneration> | null;
  if (
    !entry ||
    typeof entry !== "object" ||
    typeof entry.accountId !== "string" ||
    typeof entry.relationshipId !== "string" ||
    typeof entry.conversationId !== "string" ||
    typeof entry.generationId !== "string" ||
    typeof entry.savedAtEpochMs !== "number" ||
    !Number.isFinite(entry.savedAtEpochMs)
  ) {
    clearRestorableGeneration(storage);
    return null;
  }
  if (nowEpochMs - entry.savedAtEpochMs > RESTORE_MAX_AGE_MS || nowEpochMs < entry.savedAtEpochMs) {
    clearRestorableGeneration(storage);
    return null;
  }
  return entry as RestorableGeneration;
}

export function clearRestorableGeneration(storage: RestorableStorage | null): void {
  if (!storage) return;
  try {
    storage.removeItem(RESTORE_KEY);
  } catch {
    // Ignore: absence of cleanup only costs privacy-safe convenience data.
  }
}

/**
 * Owner/context gate: every bound id must equal the live page context before
 * a snapshot restore is even attempted (account switch, relationship switch
 * or a different open conversation all reject).
 */
export function canRestore(
  stored: RestorableGeneration,
  ctx: { accountId: string; relationshipId: string; conversationId: string },
): boolean {
  return (
    !!stored.accountId &&
    stored.accountId === ctx.accountId &&
    stored.relationshipId === ctx.relationshipId &&
    stored.conversationId === ctx.conversationId
  );
}
