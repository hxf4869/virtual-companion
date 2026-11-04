import { useLayoutEffect, useState } from 'react';
import { usePreferences } from './usePreferences';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function readOsReducedMotion(): boolean {
  try {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      return Boolean(window.matchMedia(REDUCED_MOTION_QUERY)?.matches);
    }
  } catch {
    // ignore
  }
  return false;
}

function writeReducedMotionAttribute(effective: boolean): void {
  if (typeof document === 'undefined' || !document.documentElement) return;
  if (effective) {
    if (document.documentElement.dataset.vcReducedMotion !== 'true') {
      document.documentElement.dataset.vcReducedMotion = 'true';
    }
  } else if ('vcReducedMotion' in document.documentElement.dataset) {
    delete document.documentElement.dataset.vcReducedMotion;
  }
}

/**
 * Single owner that reads the OS `(prefers-reduced-motion: reduce)` media query,
 * combines it with the app-level `vc-reduced-motion` preference, and syncs
 * `html[data-vc-reduced-motion]`.
 */
export function useReducedMotion(): boolean {
  const appReduced = usePreferences((s) => s.reducedMotion);
  const [osReduced, setOsReduced] = useState<boolean>(() => readOsReducedMotion());

  const effective = Boolean(appReduced || osReduced);

  useLayoutEffect(() => {
    writeReducedMotionAttribute(effective);
  }, [effective]);

  useLayoutEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }
    const mql = window.matchMedia(REDUCED_MOTION_QUERY);
    const sync = () => {
      const matches = Boolean(mql?.matches);
      setOsReduced(matches);
      writeReducedMotionAttribute(Boolean(usePreferences.getState().reducedMotion || matches));
    };

    sync();

    if (typeof mql?.addEventListener === 'function') {
      mql.addEventListener('change', sync);
      return () => mql.removeEventListener('change', sync);
    }
    if (typeof mql?.addListener === 'function') {
      mql.addListener(sync);
      return () => mql.removeListener(sync);
    }
    return undefined;
  }, []);

  return effective;
}
