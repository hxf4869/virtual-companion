import React, { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from './useReducedMotion';
import './Aurora.css';

const DEFAULT_SPOT_COLORS: readonly [string, string, string] = [
  '255, 150, 120',
  '170, 135, 255',
  '100, 165, 255',
];

export type TimePeriod = 'morning' | 'day' | 'dusk' | 'night';

export function timeOfDayShift(date: Date = new Date()): TimePeriod {
  const h = date.getHours();
  if (h >= 6 && h < 11) return 'morning';
  if (h >= 11 && h < 17) return 'day';
  if (h >= 17 && h < 21) return 'dusk';
  return 'night';
}

function parseRgbTriplet(rgbString?: string): [number, number, number] | null {
  const parts = String(rgbString ?? '')
    .split(',')
    .map((s) => Number(s.trim()));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  return [
    Math.max(0, Math.min(255, parts[0])),
    Math.max(0, Math.min(255, parts[1])),
    Math.max(0, Math.min(255, parts[2])),
  ];
}

export function rotateHue(rgbString?: string, deg = 40): string {
  const rgb = parseRgbTriplet(rgbString);
  if (!rgb) return DEFAULT_SPOT_COLORS[1];
  const [r, g, b] = rgb.map((n) => n / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = ((h * 60 + deg) % 360 + 360) % 360;
  }
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rp = 0;
  let gp = 0;
  let bp = 0;
  if (h < 60) [rp, gp, bp] = [c, x, 0];
  else if (h < 120) [rp, gp, bp] = [x, c, 0];
  else if (h < 180) [rp, gp, bp] = [0, c, x];
  else if (h < 240) [rp, gp, bp] = [0, x, c];
  else if (h < 300) [rp, gp, bp] = [x, 0, c];
  else [rp, gp, bp] = [c, 0, x];
  return [rp + m, gp + m, bp + m].map((v) => Math.round(v * 255)).join(', ');
}

function spotColorsForTint(tint?: string): [string, string, string] {
  const rgb = parseRgbTriplet(tint);
  if (!rgb) return [...DEFAULT_SPOT_COLORS];
  const base = rgb.join(', ');
  return [base, rotateHue(base, 40), '120, 170, 255'];
}

interface AuroraSetItem {
  id: number;
  colors: [string, string, string];
  leaving: boolean;
}

export interface AuroraProps {
  characterTint?: string;
}

export function Aurora({ characterTint }: AuroraProps) {
  const reducedMotion = useReducedMotion();
  const [paused, setPaused] = useState<boolean>(() =>
    typeof document !== 'undefined' ? Boolean(document.hidden) : false,
  );
  const [period, setPeriod] = useState<TimePeriod>(() => timeOfDayShift());
  const nextIdRef = useRef(1);
  const lastTintRef = useRef<string>(String(characterTint ?? '').trim());
  const [sets, setSets] = useState<AuroraSetItem[]>(() => [
    {
      id: 1,
      colors: spotColorsForTint(characterTint),
      leaving: false,
    },
  ]);

  useEffect(() => {
    const normalized = String(characterTint ?? '').trim();
    if (normalized === lastTintRef.current) return undefined;
    lastTintRef.current = normalized;

    const newId = ++nextIdRef.current;
    const nextColors = spotColorsForTint(normalized);

    setSets((prev) => {
      const currentActive = prev[prev.length - 1];
      const markedLeaving = currentActive
        ? [{ ...currentActive, leaving: true }]
        : [];
      return [...markedLeaving, { id: newId, colors: nextColors, leaving: false }];
    });

    const timer = window.setTimeout(() => {
      setSets((prev) => prev.filter((item) => !item.leaving));
    }, 900);

    return () => {
      window.clearTimeout(timer);
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
      setPeriod(timeOfDayShift());
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
          className={['vc-aurora-set', setItem.leaving ? 'is-leaving' : '']
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
