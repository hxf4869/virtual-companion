import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { DESKTOP_SOURCE_DIR, rewriteDesktopImports } from '../scripts/lib/desktop-source.mjs';

test('locked desktop source rejects unknown imports and computed module paths', () => {
    assert.throws(() => rewriteDesktopImports('import "unknown-package";', 'fixture', {}), /fixture.*unknown-package/);
    assert.throws(() => rewriteDesktopImports('import(name);', 'fixture', {}), /fixture.*dynamic import/);
});

test('desktop ESM ships actual library, event and Helper schema implementations', async () => {
    const generated = new URL('../extension/vc-model-settings/desktop/locked-source/', import.meta.url);
    assert.equal(DESKTOP_SOURCE_DIR, fileURLToPath(generated).slice(0, -1));
    const { lodash, yaml } = await import(new URL('st/lib.js', generated));
    const { EventEmitter } = await import(new URL('st/lib/eventemitter.js', generated));
    const { event_types } = await import(new URL('st/scripts/events.js', generated));
    const { ScriptButton } = await import(new URL('helper/type/scripts.js', generated));
    assert.deepEqual(lodash.set({}, 'a.b', 1), { a: { b: 1 } });
    assert.deepEqual(yaml.parse('a: [1, 2]'), { a: [1, 2] });
    const emitter = new EventEmitter();
    let received;
    emitter.on('fixture', async payload => { received = payload; });
    await emitter.emit('fixture', 'synthetic');
    assert.equal(received, 'synthetic');
    assert.equal(event_types.MESSAGE_RECEIVED, 'message_received');
    assert.equal(ScriptButton.parse({ name: 'fixture', visible: false }).visible, false);
    const notices = await readFile(new URL('THIRD_PARTY_NOTICES.txt', generated), 'utf8');
    const prebundled = await readFile(new URL('../desktop-ui/LOCKED_RUNTIME_NOTICES.txt', import.meta.url), 'utf8');
    assert.match(notices, /PolyForm Noncommercial/);
    assert.ok(notices.includes(prebundled.trimEnd()));
    const productionNotices = await readFile(
        new URL('../server-plugin/virtual-companion/desktop/app/THIRD_PARTY_NOTICES.txt', import.meta.url), 'utf8',
    );
    assert.ok(productionNotices.includes(prebundled.trimEnd()));
});

test('locked Helper preset and scoped variable macro logic execute in Node', async () => {
    const root = new URL('../extension/vc-model-settings/desktop/locked-source/helper/function/', import.meta.url);
    const { default_preset, fromPreset, toPreset } = await import(new URL('preset.js', root));
    const preset = structuredClone(default_preset);
    preset.settings.temperature = 0.7;
    const raw = fromPreset(preset);
    assert.equal(raw.temperature, 0.7);
    assert.equal(raw.temp_openai, 0.7);
    raw.temp_openai = 0.2;
    assert.equal(toPreset(raw, { in_use: true }).settings.temperature, 0.2);
    assert.equal(toPreset(raw, { in_use: false }).settings.temperature, 0.7);

    const { createHelperMacroLike } = await import(new URL('macro_like.js', root));
    const create = () => createHelperMacroLike({
        getChat: () => [],
        get_variables_without_clone: () => ({ fixture: { value: 4, $hidden: true } }),
    });
    const first = create();
    const second = create();
    const regex = /fixture-extension/;
    const { unregister } = first.registerMacroLike(regex, () => '');
    assert.equal(second.macros.some(item => item.regex === regex), false);
    const [entry] = first.macros;
    assert.equal('{{get_chat_variable::fixture}}'.replace(entry.regex, (...args) => entry.replace({}, ...args)), '{"value":4}');
    unregister();
    assert.equal(first.macros.some(item => item.regex === regex), false);
});
