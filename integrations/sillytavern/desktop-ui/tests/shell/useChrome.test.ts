import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { useChrome, resolveChromeFromMatches } from '../../src/shell/useChrome';

type ChangeListener = () => void;

function installMatchMediaMock(initialWidth: number) {
  let width = initialWidth;
  const queries = new Map<string, { listeners: Set<ChangeListener>; mql: MediaQueryList }>();
  const queriedStrings: string[] = [];

  const evalQuery = (query: string): boolean => {
    const match = query.match(/\(min-width:\s*(\d+)px\)/);
    if (!match) return false;
    return width >= Number(match[1]);
  };

  const matchMediaMock = vi.fn((query: string): MediaQueryList => {
    queriedStrings.push(query);
    const existing = queries.get(query);
    if (existing) return existing.mql;

    const listeners = new Set<ChangeListener>();
    const mql = {
      media: query,
      get matches() {
        return evalQuery(query);
      },
      onchange: null,
      addEventListener: vi.fn((type: string, cb: EventListenerOrEventListenerObject) => {
        if (type === 'change' && typeof cb === 'function') {
          listeners.add(cb as ChangeListener);
        }
      }),
      removeEventListener: vi.fn((type: string, cb: EventListenerOrEventListenerObject) => {
        if (type === 'change' && typeof cb === 'function') {
          listeners.delete(cb as ChangeListener);
        }
      }),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList;

    queries.set(query, { listeners, mql });
    return mql;
  });

  vi.stubGlobal('matchMedia', matchMediaMock);

  return {
    queriedStrings,
    setWidth(nextWidth: number) {
      width = nextWidth;
      for (const { listeners } of queries.values()) {
        for (const listener of listeners) {
          listener();
        }
      }
    },
  };
}

describe('useChrome', () => {
  beforeEach(() => {
    delete document.documentElement.dataset.chrome;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    delete document.documentElement.dataset.chrome;
  });

  it('maps 743/744/1179/1180/1599/1600 to correct chrome', () => {
    expect(resolveChromeFromMatches({ min744: false, min1180: false, min1600: false })).toBe('narrow');
    expect(resolveChromeFromMatches({ min744: true, min1180: false, min1600: false })).toBe('compact');
    expect(resolveChromeFromMatches({ min744: true, min1180: true, min1600: false })).toBe('regular');
    expect(resolveChromeFromMatches({ min744: true, min1180: true, min1600: true })).toBe('wide');

    const ctl = installMatchMediaMock(743);
    const { result } = renderHook(() => useChrome());
    expect(result.current).toBe('narrow');
    expect(document.documentElement.dataset.chrome).toBe('narrow');

    // Only uses the 3 canonical matchMedia queries
    expect(new Set(ctl.queriedStrings)).toEqual(
      new Set(['(min-width: 744px)', '(min-width: 1180px)', '(min-width: 1600px)']),
    );

    act(() => ctl.setWidth(744));
    expect(result.current).toBe('compact');
    expect(document.documentElement.dataset.chrome).toBe('compact');

    act(() => ctl.setWidth(1179));
    expect(result.current).toBe('compact');
    expect(document.documentElement.dataset.chrome).toBe('compact');

    act(() => ctl.setWidth(1180));
    expect(result.current).toBe('regular');
    expect(document.documentElement.dataset.chrome).toBe('regular');

    act(() => ctl.setWidth(1599));
    expect(result.current).toBe('regular');
    expect(document.documentElement.dataset.chrome).toBe('regular');

    act(() => ctl.setWidth(1600));
    expect(result.current).toBe('wide');
    expect(document.documentElement.dataset.chrome).toBe('wide');
  });

  it('writes data-chrome once per crossing', () => {
    const ctl = installMatchMediaMock(800);
    const writes: string[] = [];
    const realDataset = document.documentElement.dataset;
    const proxyDataset = new Proxy(realDataset, {
      get(target, prop, receiver) {
        return Reflect.get(target, prop, receiver);
      },
      set(target, prop, value, receiver) {
        if (prop === 'chrome') {
          writes.push(String(value));
        }
        return Reflect.set(target, prop, value, receiver);
      },
    });

    vi.spyOn(document.documentElement, 'dataset', 'get').mockReturnValue(proxyDataset);

    const { result } = renderHook(() => useChrome());
    expect(result.current).toBe('compact');
    expect(writes).toEqual(['compact']);

    // Moving within compact (800 -> 1000 -> 1179) must NOT re-write data-chrome
    act(() => ctl.setWidth(1000));
    act(() => ctl.setWidth(1179));
    expect(writes).toEqual(['compact']);

    // Crossing into regular (1180) writes once
    act(() => ctl.setWidth(1180));
    expect(writes).toEqual(['compact', 'regular']);

    // Moving within regular (1180 -> 1440) does not write again
    act(() => ctl.setWidth(1440));
    expect(writes).toEqual(['compact', 'regular']);

    // Crossing into wide (1600) writes once
    act(() => ctl.setWidth(1600));
    expect(writes).toEqual(['compact', 'regular', 'wide']);
  });

  it('enforces single viewport width reader across app, shell, and design modules', () => {
    const srcRoot = resolve(__dirname, '../../src');
    const dirs = ['app', 'shell', 'design', 'data'];
    const files: string[] = [];

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry)) files.push(full);
      }
    };

    for (const d of dirs) {
      walk(join(srcRoot, d));
    }

    const widthReaders: string[] = [];
    const matchMediaCallers: string[] = [];
    for (const file of files) {
      const code = readFileSync(file, 'utf8');
      const rel = file.replace(srcRoot + '/', '');
      if (
        code.includes('innerWidth') ||
        /\((min-width|max-width):/.test(code)
      ) {
        widthReaders.push(rel);
      }
      if (code.includes('matchMedia')) {
        matchMediaCallers.push(rel);
      }
    }

    expect(widthReaders).toEqual(['shell/useChrome.ts']);
    expect(matchMediaCallers.sort()).toEqual([
      'shell/useChrome.ts',
      'shell/useReducedMotion.ts',
    ]);
  });
});
