import React, { useEffect, useRef, useState } from 'react';
import {
  rotateHue,
  timeOfDayShift,
} from '../../../extension/vc-model-settings/theme-logic.js';
import { usePreferences } from './usePreferences';
import './Aurora.css';

export { rotateHue, timeOfDayShift };

const DEFAULT_SPOT_COLORS: readonly [string, string, string] = [
  '255,150,120',
  '170,135,255',
  '100,165,255',
];

function isValidRgbTriplet(raw?: string): boolean {
  const parts = String(raw ?? '')
    .split(',')
    .map((s) => Number(s.trim()));
  return parts.length === 3 && parts.every((n) => Number.isFinite(n));
}

function spotColorsForTint(tint?: string): [string, string, string] {
  const trimmed = String(tint ?? '').trim();
  if (!trimmed || !isValidRgbTriplet(trimmed)) {
    return [...DEFAULT_SPOT_COLORS];
  }
  return [trimmed, rotateHue(trimmed), '120,170,255'];
}

interface AuroraSetItem {
  id: number;
  colors: [string, string, string];
  entering: boolean;
  leaving: boolean;
}

export interface AuroraProps {
  characterTint?: string;
  reducedMotion?: boolean;
}

export function Aurora({ characterTint, reducedMotion: reducedMotionProp }: AuroraProps) {
  const storeReduced = usePreferences((s) => s.reducedMotion);
  const reducedMotion = reducedMotionProp ?? storeReduced;

  const [paused, setPaused] = useState<boolean>(() =>
    typeof document !== 'undefined' ? Boolean(document.hidden) : false,
  );
  const [period, setPeriod] = useState<string>(() => timeOfDayShift(new Date()));
  const nextIdRef = useRef(1);
  const lastTintRef = useRef<string>(String(characterTint ?? '').trim());
  const leaveTimerRef = useRef<number | null>(null);
  const enterRafRef = useRef<number | null>(null);

  const [sets, setSets] = useState<AuroraSetItem[]>(() => [
    {
      id: 1,
      colors: spotColorsForTint(characterTint),
      entering: false,
      leaving: false,
    },
  ]);

  useEffect(() => {
    const normalized = String(characterTint ?? '').trim();
    if (normalized === lastTintRef.current) return undefined;
    lastTintRef.current = normalized;

    if (leaveTimerRef.current !== null) {
      window.clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
    if (enterRafRef.current !== null && typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(enterRafRef.current);
      enterRafRef.current = null;
    }

    const newId = ++nextIdRef.current;
    const nextColors = spotColorsForTint(normalized);

    setSets((prev) => {
      // Keep at most 1 previous set as leaving + 1 new set as entering (max 2 sets)
      const currentActive = prev[prev.length - 1];
      const markedLeaving = currentActive
        ? [{ ...currentActive, entering: false, leaving: true }]
        : [];
      return [
        ...markedLeaving,
        { id: newId, colors: nextColors, entering: true, leaving: false },
      ];
    });

    if (typeof window.requestAnimationFrame === 'function') {
      enterRafRef.current = window.requestAnimationFrame(() => {
        enterRafRef.current = null;
        setSets((prev) =>
          prev.map((item) =>
            item.id === newId ? { ...item, entering: false } : item,
          ),
        );
      });
    }

    leaveTimerRef.current = window.setTimeout(() => {
      leaveTimerRef.current = null;
      setSets((prev) => prev.filter((item) => !item.leaving));
    }, 900);

    return () => {
      if (leaveTimerRef.current !== null) {
        window.clearTimeout(leaveTimerRef.current);
        leaveTimerRef.current = null;
      }
      if (enterRafRef.current !== null && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(enterRafRef.current);
        enterRafRef.current = null;
      }
    };
  }, [characterTint]);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const onVisibilityChange = () => {
      setPaused(Boolean(document.hidden));
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setPeriod(timeOfDayShift(new Date()));
    }, 60_000);
    return () => {
      window.clearInterval(interval);
    };
  }, []);

  const className = [
    'vc-desktop-aurora',
    'vc-aurora',
    paused ? 'is-paused' : '',
    reducedMotion ? 'is-reduced' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={className} aria-hidden="true" data-vc-period={period}>
      {sets.map((setItem) => (
        <div
          key={setItem.id}
          className={[
            'vc-aurora-set',
            setItem.entering ? 'is-entering' : '',
            setItem.leaving ? 'is-leaving' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {setItem.colors.map((c, idx) => (
            <div
              key={idx}
              className={`vc-aurora-spot vc-aurora-spot--${idx + 1}`}
              style={{ '--c': c } as React.CSSProperties}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
