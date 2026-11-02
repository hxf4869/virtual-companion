import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

test('UX-35 角色主题优先，全局主题次之，未知主题使用可用的极光', async () => {
    const { resolveTheme } = await import('../extension/vc-model-settings/desktop/theme.js');
    const registry = [{ id: 'aurora' }, { id: 'paper' }, { id: 'night' }];
    assert.equal(resolveTheme({ global: 'paper', character: 'night' }, registry).id, 'night');
    assert.equal(resolveTheme({ global: 'paper', character: 'missing' }, registry).id, 'paper');
    assert.equal(resolveTheme({ global: 'missing' }, registry).id, 'aurora');
});

test('UX-35 偏好集中存取，取消角色覆盖会回到全局主题', async () => {
    const { readThemePreferences, setGlobalThemePreference, setCharacterThemePreference, characterThemeKey } = await import('../extension/vc-model-settings/desktop/theme.js');
    const data = new Map();
    const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
    setGlobalThemePreference('paper', storage);
    setCharacterThemePreference('character-11', 'night', storage);
    assert.deepEqual(readThemePreferences(storage), { global: 'paper', characters: { 'character-11': 'night' } });
    setCharacterThemePreference('character-11', null, storage);
    assert.deepEqual(readThemePreferences(storage), { global: 'paper', characters: {} });
    assert.equal(characterThemeKey({ chatMetadata: { vc_binding: { characterRef: 'character-11', relationshipId: '22' } } }), 'character-11');
});

test('UX-35 桌面组件的颜色、阴影、圆角与动效时长来自主题变量', async () => {
    const dir = new URL('../extension/vc-model-settings/desktop/', import.meta.url);
    for (const file of (await readdir(dir)).filter(name => name.endsWith('.css'))) {
        const css = (await readFile(new URL(file, dir), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
        assert.doesNotMatch(css, /#[\da-f]{3,8}\b|(?:rgba?|hsla?)\(\s*[.\d]/i, `${file}: 颜色应放在 themes/ 中`);
        for (const match of css.matchAll(/(?:box-shadow|text-shadow|border-radius)\s*:\s*([^;}]+)/g)) {
            assert.doesNotMatch(match[1], /(?<![-\w])\d*\.?\d+(?:px|rem|em)\b/, `${file}: ${match[0]}`);
        }
        assert.doesNotMatch(css, /(?<![-\w])\d*\.?\d+(?:ms|s)\b/, `${file}: 动效时长应放在 themes/ 中`);
    }
});

test('UX-35 桌面内容过渡使用主题时长与曲线，支持秒单位', async () => {
    globalThis.document = { documentElement: { dataset: { vcLayout: 'desktop' } } };
    globalThis.matchMedia = () => ({ matches: false });
    const values = { '--vc-dur-emphasized': '.4s', '--vc-spring': 'ease-in-out' };
    globalThis.getComputedStyle = () => ({ getPropertyValue: key => values[key] || '' });
    const { transitionContent } = await import('../extension/vc-model-settings/desktop/transition.js');
    let options, updated = false;
    transitionContent({ animate(_frames, config) { options = config; } }, () => { updated = true; });
    assert.equal(updated, true);
    assert.equal(options.duration, 400);
    assert.equal(options.easing, 'ease-in-out');
});
