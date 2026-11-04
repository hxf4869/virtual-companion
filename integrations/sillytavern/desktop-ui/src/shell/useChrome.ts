import { useLayoutEffect, useState } from 'react';

export type ChromeTier = 'narrow' | 'compact' | 'regular' | 'wide';

const QUERY_744 = '(min-width: 744px)';
const QUERY_1180 = '(min-width: 1180px)';
const QUERY_1600 = '(min-width: 1600px)';

export interface ChromeMatchFlags {
  min744: boolean;
  min1180: boolean;
  min1600: boolean;
}

export function resolveChromeFromMatches({
  min744,
  min1180,
  min1600,
}: ChromeMatchFlags): ChromeTier {
  if (min1600) return 'wide';
  if (min1180) return 'regular';
  if (min744) return 'compact';
  return 'narrow';
}

function writeHtmlChromeIdempotent(tier: ChromeTier): void {
  if (typeof document === 'undefined' || !document.documentElement) return;
  if (document.documentElement.dataset.chrome !== tier) {
    document.documentElement.dataset.chrome = tier;
  }
}

function readCurrentChromeTier(): ChromeTier {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'regular';
  }
  const m744 = window.matchMedia(QUERY_744);
  const m1180 = window.matchMedia(QUERY_1180);
  const m1600 = window.matchMedia(QUERY_1600);
  return resolveChromeFromMatches({
    min744: Boolean(m744?.matches),
    min1180: Boolean(m1180?.matches),
    min1600: Boolean(m1600?.matches),
  });
}

/**
 * Single viewport width reader in the desktop React app.
 * Uses only the 3 canonical matchMedia queries (744 / 1180 / 1600)
 * and idempotently syncs `html[data-chrome]`.
 */
export function useChrome(): ChromeTier {
  const [chrome, setChrome] = useState<ChromeTier>(() => {
    const initial = readCurrentChromeTier();
    writeHtmlChromeIdempotent(initial);
    return initial;
  });

  useLayoutEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }
    const m744 = window.matchMedia(QUERY_744);
    const m1180 = window.matchMedia(QUERY_1180);
    const m1600 = window.matchMedia(QUERY_1600);

    const sync = () => {
      const next = resolveChromeFromMatches({
        min744: Boolean(m744?.matches),
        min1180: Boolean(m1180?.matches),
        min1600: Boolean(m1600?.matches),
      });
      writeHtmlChromeIdempotent(next);
      setChrome((prev) => (prev === next ? prev : next));
    };

    sync();

    const bind = (mql: MediaQueryList | undefined) => {
      if (!mql) return () => {};
      if (typeof mql.addEventListener === 'function') {
        mql.addEventListener('change', sync);
        return () => mql.removeEventListener('change', sync);
      }
      if (typeof mql.addListener === 'function') {
        mql.addListener(sync);
        return () => mql.removeListener(sync);
      }
      return () => {};
    };

    const off744 = bind(m744);
    const off1180 = bind(m1180);
    const off1600 = bind(m1600);

    return () => {
      off744();
      off1180();
      off1600();
    };
  }, []);

  return chrome;
}
