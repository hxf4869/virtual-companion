// STREAM-THROTTLE (§18.6): paint streamed draft at a bounded cadence so each
// token does not force a full layout. The reducer still sees every event.

export function createDisplayThrottle(
  intervalMs: number,
  now: () => number = () => Date.now(),
): {
  push(text: string): string | null;
  flush(): string | null;
} {
  const interval = Math.max(0, intervalMs);
  let lastPublishedAt = Number.NEGATIVE_INFINITY;
  let pending: string | null = null;

  return {
    push(text: string): string | null {
      const t = now();
      if (t - lastPublishedAt >= interval) {
        lastPublishedAt = t;
        pending = null;
        return text;
      }
      pending = text;
      return null;
    },
    flush(): string | null {
      if (pending === null) return null;
      const t = now();
      if (t - lastPublishedAt < interval) return null;
      const next = pending;
      pending = null;
      lastPublishedAt = t;
      return next;
    },
  };
}
