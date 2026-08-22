// S0-20: classify realtime disconnects and recover from visibility/online
// using the generation snapshot as authority. Never starts a second generation.

export type DisconnectKind = "network" | "permission" | "service" | "terminal" | "unknown";

export type RecoverReason = "visibility" | "online";

const BASE_DELAY_MS = 250;
const MAX_DELAY_MS = 8000;

export function classifyDisconnect(input: {
  navigatorOnline?: boolean;
  resumeStatus?: number | null;
  outcome?: string | null;
}): DisconnectKind {
  if (input.outcome === "cancelled" || input.outcome === "blocked" || input.outcome === "completed") {
    return "terminal";
  }
  if (input.navigatorOnline === false) return "network";
  const status = input.resumeStatus ?? null;
  if (status === 401 || status === 403 || status === 404) return "permission";
  if (status !== null && status >= 500) return "service";
  if (input.outcome === "failed") return "terminal";
  return "unknown";
}

export function nextResumeDelayMs(attempt: number, random: () => number = Math.random): number {
  const exp = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, attempt));
  const jitter = 0.5 + random();
  return Math.max(1, Math.round(exp * jitter));
}

export function installStreamLifecycle(opts: {
  addEventListener: (name: string, handler: EventListener) => void;
  removeEventListener: (name: string, handler: EventListener) => void;
  getVisibility: () => string;
  onRecover: (reason: RecoverReason) => void;
}): () => void {
  const onVisibility = (): void => {
    if (opts.getVisibility() === "visible") {
      opts.onRecover("visibility");
    }
  };
  const onOnline = (): void => {
    opts.onRecover("online");
  };
  opts.addEventListener("visibilitychange", onVisibility);
  opts.addEventListener("online", onOnline);
  return () => {
    opts.removeEventListener("visibilitychange", onVisibility);
    opts.removeEventListener("online", onOnline);
  };
}
