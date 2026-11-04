import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
  resolveTheme,
  rotateHue,
  setCharacterThemePreference,
  setGlobalThemePreference,
  themeColorFor,
  timeOfDayShift,
  writeThemeMode,
  writeVcUiFlag,
} from '../../../extension/vc-model-settings/theme-logic.js';

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
    styleEl?.remove();
    styleEl = null;
    document.documentElement.removeAttribute('data-vc-theme');
    document.documentElement.removeAttribute('data-vc-reduced-transparency');
  });

  it('dark + reduced transparency makes glass opaque', () => {
    const tokensCss = readFileSync(TOKENS_CSS_PATH, 'utf8');
    expect(tokensCss).toContain('@media (prefers-reduced-transparency: reduce)');

    document.documentElement.setAttribute('data-vc-theme', 'dark');
    document.documentElement.setAttribute('data-vc-reduced-transparency', 'reduce');

    const computed = getComputedStyle(document.documentElement);
    expect(computed.getPropertyValue('--vc-glass-2').trim().toUpperCase()).toBe('#1C1C20');
    expect(computed.getPropertyValue('--vc-glass-1').trim().toUpperCase()).toBe('#1C1C20');
    expect(computed.getPropertyValue('--vc-glass-3').trim().toUpperCase()).toBe('#1C1C20');
  });

  it('defines approved light/dark tokens and removes legacy duplicate/alias variables', () => {
    const tokensCss = readFileSync(TOKENS_CSS_PATH, 'utf8');
    expect(tokensCss).not.toContain('--vcms-');
    expect(tokensCss).not.toContain('--vc-poster-pad');
    expect(tokensCss).toContain('--vc-fs-body: calc(15px * var(--fontScale, 1));');

    const lightStyle = getComputedStyle(document.documentElement);
    expect(lightStyle.getPropertyValue('--vc-accent').trim().toLowerCase()).toBe('#0071e3');
    expect(lightStyle.getPropertyValue('--vc-ink-2').trim().toLowerCase()).toBe('#55555a');
    expect(lightStyle.getPropertyValue('--vc-placeholder').trim().toLowerCase()).toBe('#68686c');
    expect(lightStyle.getPropertyValue('--vc-fs-body').trim()).toBe('calc(15px * 1)');
    expect(lightStyle.getPropertyValue('--vc-lh-title-1').trim()).toBe('1.2');

    document.documentElement.setAttribute('data-vc-theme', 'dark');
    const darkStyle = getComputedStyle(document.documentElement);
    expect(darkStyle.getPropertyValue('--vc-accent').trim().toLowerCase()).toBe('#0071e3');
    expect(darkStyle.getPropertyValue('--vc-ink-2').trim().toLowerCase()).toBe('#b2b2b7');
    expect(darkStyle.getPropertyValue('--vc-placeholder').trim().toLowerCase()).toBe('#98989d');
  });

  it('declares @layer order on the first line of base.css', () => {
    const baseCss = readFileSync(BASE_CSS_PATH, 'utf8');
    const firstLine = baseCss.split('\n')[0]?.trim();
    expect(firstLine).toBe('@layer reset, tokens, base, components, features, utilities;');
  });

  it('no !important outside allowed rules', () => {
    const cssFiles = collectCssFiles(SRC_DIR);
    expect(cssFiles.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const file of cssFiles) {
      const content = readFileSync(file, 'utf8');
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
  });

  it('exports pure theme and aurora helpers from theme-logic.js', () => {
    expect(THEME_KEY).toBe('vc-theme');
    expect(UI_FLAG_KEY).toBe('vc-ui');
    expect(THEME_PREF_KEY).toBe('vc-desktop-theme');
    expect(THEME_PREF_EVENT).toBe('vc-desktop-theme-preference');
    expect(THEME_COLOR.light).toBe('#f5f5f7');
    expect(parseThemeMode('dark')).toBe('dark');
    expect(parseThemeMode('invalid')).toBe('auto');
    expect(resolveTheme('auto', true)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme({ global: 'aurora' }).id).toBe('aurora');
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
