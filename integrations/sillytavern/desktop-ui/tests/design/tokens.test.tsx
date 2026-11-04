import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  THEME_COLOR,
  THEME_KEY,
  THEME_PREF_EVENT,
  THEME_PREF_KEY,
  UI_FLAG_KEY,
  characterThemeKey,
  parseThemeMode,
  readThemeMode,
  readThemePreferences,
  readVcUiFlag,
  resolveDesktopTheme,
  resolveTheme,
  resolveThemeMode,
  rotateHue,
  setCharacterThemePreference,
  setGlobalThemePreference,
  themeColorFor,
  timeOfDayShift,
  writeThemeMode,
  writeVcUiFlag,
} from '../../../extension/vc-model-settings/theme-logic.js';
import { resolveTheme as resolveUiTheme } from '../../../extension/vc-model-settings/ui/theme.js';
import { resolveTheme as resolveDeskTheme } from '../../../extension/vc-model-settings/desktop/theme.js';

const SRC_DIR = resolve(__dirname, '../../src');
const TOKENS_CSS_PATH = resolve(SRC_DIR, 'design/tokens.css');
const BASE_CSS_PATH = resolve(SRC_DIR, 'design/base.css');

function collectCssFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const results: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      results.push(...collectCssFiles(full));
    } else if (entry.endsWith('.css')) {
      results.push(full);
    }
  }
  return results;
}

function normCss(val: string): string {
  return val.trim().replace(/\s+/g, '').toLowerCase();
}

describe('design tokens & CSS layers (DR2-3)', () => {
  let styleEl: HTMLStyleElement | null = null;

  beforeEach(() => {
    const tokensCss = readFileSync(TOKENS_CSS_PATH, 'utf8');
    styleEl = document.createElement('style');
    styleEl.textContent = tokensCss;
    document.head.appendChild(styleEl);
    document.documentElement.removeAttribute('data-vc-theme');
    document.documentElement.removeAttribute('data-vc-reduced-transparency');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    styleEl?.remove();
    styleEl = null;
    document.documentElement.removeAttribute('data-vc-theme');
    document.documentElement.removeAttribute('data-vc-reduced-transparency');
  });

  it('dark + OS prefers-reduced-transparency makes glass opaque (#1C1C20) and aurora .20', () => {
    const tokensCss = readFileSync(TOKENS_CSS_PATH, 'utf8');
    expect(tokensCss).toContain('@media (prefers-reduced-transparency: reduce)');
    expect(tokensCss).not.toContain('data-vc-reduced-transparency');

    const mqlProto = Object.getPrototypeOf(window.matchMedia('(prefers-reduced-transparency: reduce)'));
    const origDescriptor = Object.getOwnPropertyDescriptor(mqlProto, 'matches');
    vi.spyOn(mqlProto, 'matches', 'get').mockImplementation(function (this: MediaQueryList) {
      if (this.media.includes('prefers-reduced-transparency') && this.media.includes('reduce')) {
        return true;
      }
      return origDescriptor?.get ? origDescriptor.get.call(this) : false;
    });

    // Light + OS reduced-transparency
    const lightComputed = getComputedStyle(document.documentElement);
    expect(lightComputed.getPropertyValue('--vc-glass-1').trim().toUpperCase()).toBe('#FBFAFC');
    expect(lightComputed.getPropertyValue('--vc-glass-2').trim().toUpperCase()).toBe('#FBFAFC');
    expect(lightComputed.getPropertyValue('--vc-glass-3').trim().toUpperCase()).toBe('#FBFAFC');
    expect(Number(lightComputed.getPropertyValue('--vc-aurora-alpha').trim())).toBeCloseTo(0.2, 5);

    // Dark + OS reduced-transparency
    document.documentElement.setAttribute('data-vc-theme', 'dark');
    const darkComputed = getComputedStyle(document.documentElement);
    expect(darkComputed.getPropertyValue('--vc-glass-1').trim().toUpperCase()).toBe('#1C1C20');
    expect(darkComputed.getPropertyValue('--vc-glass-2').trim().toUpperCase()).toBe('#1C1C20');
    expect(darkComputed.getPropertyValue('--vc-glass-3').trim().toUpperCase()).toBe('#1C1C20');
    expect(Number(darkComputed.getPropertyValue('--vc-aurora-alpha').trim())).toBeCloseTo(0.2, 5);
  });

  it('defines approved light/dark tokens, layout dimensions, and z-index scale from vc-ui.css, aurora.css & DESIGN.md', () => {
    const tokensCss = readFileSync(TOKENS_CSS_PATH, 'utf8');
    expect(tokensCss).not.toContain('--vcms-');
    expect(tokensCss).not.toContain('--vc-poster-pad');
    expect(tokensCss).not.toContain('68ch');
    expect(tokensCss).not.toContain('--vc-s-');
    expect(tokensCss).not.toContain('--vc-r-');
    expect(tokensCss).not.toContain('--vc-z-dialog');
    expect(tokensCss).not.toContain('--vc-z-popover');
    // No invented font-size / radius / glass-stroke / bubble-bg tokens
    expect(tokensCss).not.toContain('--vc-fs-md');
    expect(tokensCss).not.toContain('--vc-fs-lg');
    expect(tokensCss).not.toContain('--vc-fs-xl');
    expect(tokensCss).not.toContain('--vc-radius-panel');
    expect(tokensCss).not.toContain('--vc-radius-window');
    expect(tokensCss).not.toContain('--vc-glass-stroke-rest');
    expect(tokensCss).not.toContain('--vc-glass-inner-glow');
    expect(tokensCss).not.toContain('--vc-bubble-user-bg');
    expect(tokensCss).not.toContain('#3A95FF');
    expect(tokensCss).toContain('--vc-fs-body: calc(15px * var(--fontScale, 1));');
    expect(tokensCss).toContain('linear(0, .006, .025 2.8%');

    const lightStyle = getComputedStyle(document.documentElement);
    expect(normCss(lightStyle.getPropertyValue('--vc-desk-base'))).toBe('#f4f1f6');
    expect(Number(lightStyle.getPropertyValue('--vc-aurora-alpha').trim())).toBeCloseTo(0.9, 5);
    expect(Number(lightStyle.getPropertyValue('--vc-grain-alpha').trim())).toBeCloseTo(0.03, 5);
    expect(normCss(lightStyle.getPropertyValue('--vc-glass-1'))).toBe('rgba(255,255,255,.30)');
    expect(normCss(lightStyle.getPropertyValue('--vc-glass-2'))).toBe('rgba(255,255,255,.46)');
    expect(normCss(lightStyle.getPropertyValue('--vc-glass-3'))).toBe('rgba(252,252,254,.82)');
    expect(normCss(lightStyle.getPropertyValue('--vc-raised'))).toBe('rgba(255,255,255,.72)');
    expect(normCss(lightStyle.getPropertyValue('--vc-rim'))).toBe('rgba(255,255,255,.55)');
    expect(normCss(lightStyle.getPropertyValue('--vc-rim-outer'))).toBe('rgba(255,255,255,.25)');
    expect(normCss(lightStyle.getPropertyValue('--vc-hi'))).toBe('rgba(255,255,255,.75)');
    expect(normCss(lightStyle.getPropertyValue('--vc-raised-edge'))).toBe('rgba(0,0,0,.05)');
    expect(normCss(lightStyle.getPropertyValue('--vc-select-fill'))).toBe('rgba(0,113,227,.12)');
    expect(normCss(lightStyle.getPropertyValue('--vc-hover-fill'))).toBe('rgba(255,255,255,.45)');
    expect(normCss(lightStyle.getPropertyValue('--vc-scrim-desk'))).toBe('rgba(30,20,40,.18)');
    expect(normCss(lightStyle.getPropertyValue('--vc-shadow-panel'))).toBe(
      '0001pxrgba(255,255,255,.25),020px50pxrgba(80,60,100,.10)',
    );
    expect(normCss(lightStyle.getPropertyValue('--vc-shadow-overlay'))).toBe(
      '0001pxrgba(255,255,255,.25),030px80pxrgba(60,40,90,.18)',
    );
    expect(normCss(lightStyle.getPropertyValue('--vc-shadow-button'))).toBe('06px16pxrgba(0,113,227,.28)');
    expect(normCss(lightStyle.getPropertyValue('--vc-shadow-button-hover'))).toBe(
      '0004pxrgba(0,113,227,.15),08px24pxrgba(0,113,227,.30)',
    );
    expect(lightStyle.getPropertyValue('--vc-blur-1').trim()).toBe('30px');
    expect(lightStyle.getPropertyValue('--vc-blur-2').trim()).toBe('40px');
    expect(lightStyle.getPropertyValue('--vc-blur-3').trim()).toBe('40px');
    expect(normCss(lightStyle.getPropertyValue('--vc-accent'))).toBe('#0071e3');
    expect(normCss(lightStyle.getPropertyValue('--vc-ink-2'))).toBe('#55555a');
    expect(normCss(lightStyle.getPropertyValue('--vc-ink-3'))).toBe('#aeaeb2');
    expect(normCss(lightStyle.getPropertyValue('--vc-placeholder'))).toBe('#68686c');
    expect(normCss(lightStyle.getPropertyValue('--vc-danger'))).toBe('#d70015');
    expect(normCss(lightStyle.getPropertyValue('--vc-warning'))).toBe('#b25000');
    expect(normCss(lightStyle.getPropertyValue('--vc-success'))).toBe('#248a3d');

    // Canonical typography scale with fontScale & line heights from vc-ui.css
    expect(lightStyle.getPropertyValue('--vc-fs-large-title').trim()).toBe('calc(32px * 1)');
    expect(lightStyle.getPropertyValue('--vc-fs-title-1').trim()).toBe('calc(28px * 1)');
    expect(lightStyle.getPropertyValue('--vc-fs-title-2').trim()).toBe('calc(22px * 1)');
    expect(lightStyle.getPropertyValue('--vc-fs-headline').trim()).toBe('calc(17px * 1)');
    expect(lightStyle.getPropertyValue('--vc-fs-body').trim()).toBe('calc(15px * 1)');
    expect(lightStyle.getPropertyValue('--vc-fs-reading').trim()).toBe('calc(17px * 1)');
    expect(lightStyle.getPropertyValue('--vc-fs-bubble').trim()).toBe('calc(17px * 1)');
    expect(lightStyle.getPropertyValue('--vc-fs-subhead').trim()).toBe('calc(15px * 1)');
    expect(lightStyle.getPropertyValue('--vc-fs-footnote').trim()).toBe('calc(13px * 1)');
    expect(lightStyle.getPropertyValue('--vc-fs-caption').trim()).toBe('calc(12px * 1)');
    expect(lightStyle.getPropertyValue('--vc-lh-title-1').trim()).toBe('1.2');
    expect(lightStyle.getPropertyValue('--vc-lh-body').trim()).toBe('1.47');
    expect(lightStyle.getPropertyValue('--vc-lh-reading').trim()).toBe('1.7');
    expect(lightStyle.getPropertyValue('--vc-lh-bubble').trim()).toBe('1.55');

    // Canonical radius & motion tokens from vc-ui.css + aurora.css
    expect(lightStyle.getPropertyValue('--vc-radius-xs').trim()).toBe('8px');
    expect(lightStyle.getPropertyValue('--vc-radius-sm').trim()).toBe('12px');
    expect(lightStyle.getPropertyValue('--vc-radius-md').trim()).toBe('16px');
    expect(lightStyle.getPropertyValue('--vc-radius-lg').trim()).toBe('20px');
    expect(lightStyle.getPropertyValue('--vc-radius-xl').trim()).toBe('24px');
    expect(lightStyle.getPropertyValue('--vc-radius-control').trim()).toBe('10px');
    expect(lightStyle.getPropertyValue('--vc-radius-dialog').trim()).toBe('20px');
    expect(lightStyle.getPropertyValue('--vc-radius-card-inset').trim()).toBe('14px');
    expect(tokensCss).toContain('--vc-spring: cubic-bezier(.32,.72,0,1);');
    expect(lightStyle.getPropertyValue('--vc-spring').trim()).toContain('linear(0, .006, .025 2.8%');
    expect(lightStyle.getPropertyValue('--vc-dur-press').trim()).toBe('180ms');
    expect(lightStyle.getPropertyValue('--vc-dur-quick').trim()).toBe('260ms');
    expect(lightStyle.getPropertyValue('--vc-dur-standard').trim()).toBe('420ms');
    expect(lightStyle.getPropertyValue('--vc-dur-emphasized').trim()).toBe('320ms');

    // Layout & Z-index tokens
    expect(lightStyle.getPropertyValue('--vc-sidebar').trim()).toBe('200px');
    expect(lightStyle.getPropertyValue('--vc-rail-w').trim()).toBe('200px');
    expect(lightStyle.getPropertyValue('--vc-rail-icon-w').trim()).toBe('72px');
    expect(lightStyle.getPropertyValue('--vc-conv-w').trim()).toBe('320px');
    expect(lightStyle.getPropertyValue('--vc-char-panel-w').trim()).toBe('340px');
    expect(lightStyle.getPropertyValue('--vc-read').trim()).toBe('720px');
    expect(lightStyle.getPropertyValue('--vc-panel-gap').trim()).toBe('12px');
    expect(lightStyle.getPropertyValue('--vc-window-pad').trim()).toBe('24px');
    expect(lightStyle.getPropertyValue('--vc-window-pad-compact').trim()).toBe('16px');
    expect(lightStyle.getPropertyValue('--vc-window-pad-narrow').trim()).toBe('12px');
    expect(lightStyle.getPropertyValue('--vc-z-backdrop').trim()).toBe('0');
    expect(lightStyle.getPropertyValue('--vc-z-content').trim()).toBe('1');
    expect(lightStyle.getPropertyValue('--vc-z-shell').trim()).toBe('20');
    expect(lightStyle.getPropertyValue('--vc-z-scrim').trim()).toBe('30');
    expect(lightStyle.getPropertyValue('--vc-z-menu').trim()).toBe('32');
    expect(lightStyle.getPropertyValue('--vc-z-rail').trim()).toBe('35');
    expect(lightStyle.getPropertyValue('--vc-z-page').trim()).toBe('40');
    expect(lightStyle.getPropertyValue('--vc-z-sheet').trim()).toBe('40');
    expect(lightStyle.getPropertyValue('--vc-z-drawer').trim()).toBe('50');
    expect(lightStyle.getPropertyValue('--vc-z-popup').trim()).toBe('55');
    expect(lightStyle.getPropertyValue('--vc-z-alert').trim()).toBe('60');
    expect(lightStyle.getPropertyValue('--vc-z-toast').trim()).toBe('70');
    expect(lightStyle.getPropertyValue('--vc-z-lift').trim()).toBe('80');

    // Dark mode tokens
    document.documentElement.setAttribute('data-vc-theme', 'dark');
    const darkStyle = getComputedStyle(document.documentElement);
    expect(normCss(darkStyle.getPropertyValue('--vc-desk-base'))).toBe('#07070a');
    expect(Number(darkStyle.getPropertyValue('--vc-aurora-alpha').trim())).toBeCloseTo(0.85, 5);
    expect(Number(darkStyle.getPropertyValue('--vc-grain-alpha').trim())).toBeCloseTo(0.04, 5);
    expect(normCss(darkStyle.getPropertyValue('--vc-glass-1'))).toBe('rgba(64,64,76,.36)');
    expect(normCss(darkStyle.getPropertyValue('--vc-glass-2'))).toBe('rgba(36,36,44,.44)');
    expect(normCss(darkStyle.getPropertyValue('--vc-glass-3'))).toBe('rgba(38,38,44,.82)');
    expect(normCss(darkStyle.getPropertyValue('--vc-raised'))).toBe('rgba(255,255,255,.08)');
    expect(normCss(darkStyle.getPropertyValue('--vc-rim'))).toBe('rgba(255,255,255,.10)');
    expect(normCss(darkStyle.getPropertyValue('--vc-rim-outer'))).toBe('rgba(255,255,255,.06)');
    expect(normCss(darkStyle.getPropertyValue('--vc-hi'))).toBe('rgba(255,255,255,.10)');
    expect(normCss(darkStyle.getPropertyValue('--vc-raised-edge'))).toBe('rgba(255,255,255,.08)');
    expect(normCss(darkStyle.getPropertyValue('--vc-shadow-panel'))).toBe(
      '0001pxrgba(255,255,255,.06),020px50pxrgba(0,0,0,.45)',
    );
    expect(normCss(darkStyle.getPropertyValue('--vc-shadow-overlay'))).toBe(
      '0001pxrgba(255,255,255,.06),030px80pxrgba(0,0,0,.60)',
    );
    expect(normCss(darkStyle.getPropertyValue('--vc-accent'))).toBe('#0071e3');
    expect(normCss(darkStyle.getPropertyValue('--vc-ink-2'))).toBe('#b2b2b7');
    expect(normCss(darkStyle.getPropertyValue('--vc-ink-3'))).toBe('#636366');
    expect(normCss(darkStyle.getPropertyValue('--vc-placeholder'))).toBe('#98989d');
    expect(normCss(darkStyle.getPropertyValue('--vc-danger'))).toBe('#ff6961');
    expect(normCss(darkStyle.getPropertyValue('--vc-warning'))).toBe('#ffb340');
    expect(normCss(darkStyle.getPropertyValue('--vc-success'))).toBe('#30d158');
  });

  it('declares @layer order on the first line of base.css, does not hide body overflow-x, and stops animations on reduced-motion with 150ms fade', () => {
    const baseCss = readFileSync(BASE_CSS_PATH, 'utf8');
    const firstLine = baseCss.split('\n')[0]?.trim();
    expect(firstLine).toBe('@layer reset, tokens, base, components, features, utilities;');
    expect(baseCss).not.toContain('overflow-x: hidden');
    expect(baseCss).toContain('outline: 2px solid var(--vc-accent)');
    expect(baseCss).toContain('animation: none !important');
    expect(baseCss).toContain('var(--vc-dur-reduced)');
  });

  it('no !important outside allowed rules, no outline:none overriding focus rings, and no undefined --vc-* references in component CSS', () => {
    const cssFiles = collectCssFiles(SRC_DIR);
    expect(cssFiles.length).toBeGreaterThan(0);

    const tokensCss = readFileSync(TOKENS_CSS_PATH, 'utf8');
    const definedVars = new Set<string>(['--vc-dialog-max-w', '--vc-toast-position', '--vc-toast-top', '--vc-toast-left', '--vc-tint']);
    for (const m of tokensCss.matchAll(/(--vc-[a-zA-Z0-9_-]+)\s*:/g)) {
      if (m[1]) definedVars.add(m[1]);
    }

    const violations: string[] = [];
    const outlineViolations: string[] = [];
    const undefinedVarRefs: string[] = [];
    for (const file of cssFiles) {
      const content = readFileSync(file, 'utf8');
      if (/outline\s*:\s*(none|0)/.test(content)) {
        outlineViolations.push(file);
      }
      for (const m of content.matchAll(/var\(\s*(--vc-[a-zA-Z0-9_-]+)/g)) {
        const varName = m[1];
        if (varName && !definedVars.has(varName)) {
          undefinedVarRefs.push(`${file}: ${varName}`);
        }
      }
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        if (!line.includes('!important')) return;
        const contextWindow = lines.slice(Math.max(0, idx - 3), idx + 1).join('\n');
        const isHiddenRule =
          contextWindow.includes('[hidden]') &&
          line.replace(/\s+/g, '').includes('display:none!important');
        const isReducedMotionRule =
          contextWindow.includes('reduced-motion') &&
          contextWindow.includes('animation');
        if (!isHiddenRule && !isReducedMotionRule) {
          violations.push(`${file}:${idx + 1}: ${line.trim()}`);
        }
      });
    }
    expect(violations).toEqual([]);
    expect(outlineViolations).toEqual([]);
    expect(undefinedVarRefs).toEqual([]);
  });

  it('exports distinct pure theme functions without polymorphic branching and preserves ui/desktop default resolveTheme()', () => {
    expect(THEME_KEY).toBe('vc-theme');
    expect(UI_FLAG_KEY).toBe('vc-ui');
    expect(THEME_PREF_KEY).toBe('vc-desktop-theme');
    expect(THEME_PREF_EVENT).toBe('vc-desktop-theme-preference');
    expect(THEME_COLOR.light).toBe('#f5f5f7');
    expect(parseThemeMode('dark')).toBe('dark');
    expect(parseThemeMode('invalid')).toBe('auto');

    // Explicit separate functions without polymorphic branching
    expect(resolveThemeMode).not.toBe(resolveDesktopTheme);
    expect(resolveUiTheme).toBe(resolveThemeMode);
    expect(resolveDeskTheme).toBe(resolveDesktopTheme);
    expect(resolveTheme).toBe(resolveDesktopTheme);

    // Zero-arg calls preserve legacy module contracts
    expect(resolveUiTheme()).toBe('light');
    expect(resolveThemeMode('auto', true)).toBe('dark');
    expect(resolveThemeMode('light', true)).toBe('light');
    expect(resolveDeskTheme()?.id).toBe('aurora');
    expect(resolveDesktopTheme({ global: 'aurora' })?.id).toBe('aurora');

    expect(themeColorFor('dark')).toBe(THEME_COLOR.dark);
    expect(
      characterThemeKey({
        chatMetadata: { vc_binding: { characterRef: 'char-1' } },
      }),
    ).toBe('char-1');

    const rotated = rotateHue('255, 150, 120', 40);
    expect(rotated).toMatch(/^\d+,\d+,\d+$/);
    expect(timeOfDayShift(new Date('2026-11-04T08:00:00'))).toBe('morning');
    expect(timeOfDayShift(new Date('2026-11-04T22:00:00'))).toBe('night');

    const memStore = new Map<string, string>();
    const storage = {
      getItem: (k: string) => memStore.get(k) ?? null,
      setItem: (k: string, v: string) => {
        memStore.set(k, v);
      },
    };
    writeThemeMode('dark', storage);
    expect(readThemeMode(storage)).toBe('dark');
    writeVcUiFlag(false, storage);
    expect(readVcUiFlag(storage)).toBe(false);
    setGlobalThemePreference('aurora', storage);
    setCharacterThemePreference('c1', 'aurora', storage);
    expect(readThemePreferences(storage)).toEqual({
      global: 'aurora',
      characters: { c1: 'aurora' },
    });
  });
});
