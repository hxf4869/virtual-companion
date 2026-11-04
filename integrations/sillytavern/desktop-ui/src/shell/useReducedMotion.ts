import { useLayoutEffect, useState } from 'react';
import {
  isOsReducedMotion,
  syncReducedMotionDomAttribute,
  usePreferences,
} from './usePreferences';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Combines the OS `(prefers-reduced-motion: reduce)` media preference with the
 * app-level `vc-reduced-motion` preference, and keeps `html[data-vc-reduced-motion]`
 * synchronized so both foundation controls and shell animations honor it.
 */
export function useReducedMotion(): boolean {
  const appReduced = usePreferences((s) => s.reducedMotion);
  const [osReduced, setOsReduced] = useState<boolean>(() => isOsReducedMotion());

  const effective = Boolean(appReduced || osReduced);

  useLayoutEffect(() => {
    syncReducedMotionDomAttribute(appReduced, osReduced);
  }, [appReduced, osReduced]);

  useLayoutEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }
    const mql = window.matchMedia(REDUCED_MOTION_QUERY);
    const sync = () => {
      const matches = Boolean(mql?.matches);
      setOsReduced(matches);
      syncReducedMotionDomAttribute(usePreferences.getState().reducedMotion, matches);
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
