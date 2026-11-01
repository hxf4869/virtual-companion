// 主题运行时：解析顺序、模式、变体枚举与 token 生成（ADR-0011 §7.1）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { cssVars, resolveMode, resolveTheme, resolveVariants, readCache, writeCache, VARIANTS } from '../src/theme/runtime.mjs';
import { THEMES, DEFAULT_THEME_ID } from '../src/themes/index.mjs';
import BASE from '../src/themes/base.mjs';

const second = { id: 'fixture-second', name: '夹具', variants: { bubble: 'not-a-variant' }, modes: { light: { canvas: '#000001' }, dark: { canvas: '#000002' } } };
const both = [...THEMES, second];

test('角色主题优先于全局主题，未知 id 回到默认', () => {
    assert.equal(resolveTheme({ global: 'fixture-second' }, both).id, 'fixture-second');
    assert.equal(resolveTheme({ global: DEFAULT_THEME_ID, character: 'fixture-second' }, both).id, 'fixture-second');
    assert.equal(resolveTheme({ global: 'fixture-second', character: 'missing' }, both).id, 'fixture-second');
    assert.equal(resolveTheme({ global: 'missing' }, both).id, DEFAULT_THEME_ID);
    assert.equal(resolveTheme({}, both).id, DEFAULT_THEME_ID);
});

test('自动模式跟随系统，固定模式不跟随', () => {
    assert.equal(resolveMode('auto', true), 'dark');
    assert.equal(resolveMode('auto', false), 'light');
    assert.equal(resolveMode('light', true), 'light');
    assert.equal(resolveMode('dark', false), 'dark');
});

test('主题只能在组件定义的变体里选，非法值回到第一个', () => {
    assert.deepEqual(resolveVariants(second), Object.fromEntries(Object.entries(VARIANTS).map(([k, v]) => [k, v[0]])));
});

test('每个主题两种模式给出同一组 token 名，基础 token 都在', () => {
    for (const theme of THEMES) {
        const light = Object.keys(cssVars(theme, 'light')).sort();
        const dark = Object.keys(cssVars(theme, 'dark')).sort();
        assert.deepEqual(light, dark, theme.id);
        for (const k of Object.keys(BASE)) assert.ok(light.includes(`--vc-${k}`), `${theme.id} 缺 ${k}`);
        assert.equal(cssVars(theme, 'dark')['--vc-canvas'] !== cssVars(theme, 'light')['--vc-canvas'], true);
    }
    assert.equal(cssVars(second, 'dark')['--vc-canvas'], '#000002');
});

test('缓存读写容错', () => {
    const store = new Map();
    const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
    assert.deepEqual(readCache(storage), { global: undefined, mode: 'auto' });
    writeCache(storage, { global: 'aurora', mode: 'dark' });
    assert.deepEqual(readCache(storage), { global: 'aurora', mode: 'dark' });
    store.set('vc-mobile-theme', '{bad');
    assert.deepEqual(readCache(storage), { global: undefined, mode: 'auto' });
    assert.deepEqual(readCache({ getItem() { throw new Error('denied'); } }), { global: undefined, mode: 'auto' });
});
