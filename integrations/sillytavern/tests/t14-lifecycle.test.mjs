import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { Window } from 'happy-dom';

const sourceIdentityUrl = new URL('../server-plugin/virtual-companion/lib/source-identity.js', import.meta.url).href;
const ejsHostUrl = new URL('../extension/vc-model-settings/desktop/standalone/cards/ejs-host.js', import.meta.url).href;
const lockedLibUrl = new URL('../extension/vc-model-settings/desktop/locked-source/st/lib.js', import.meta.url).href;
const lockedEjsUrl = new URL('../extension/vc-model-settings/desktop/locked-source/ejs/desktop.js', import.meta.url).href;

registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === '/lib.js') return { url: lockedLibUrl, shortCircuit: true };
        if (specifier === '/scripts/extensions/third-party/ST-Prompt-Template/dist/desktop.js') {
            return { url: lockedEjsUrl, shortCircuit: true };
        }
        if (specifier === '/scripts/extensions/third-party/vc-model-settings/desktop/standalone/cards/ejs-host.js') {
            return { url: ejsHostUrl, shortCircuit: true };
        }
        if (specifier === '/scripts/vc-runtime/source-identity.js') {
            return { url: sourceIdentityUrl, shortCircuit: true };
        }
        return nextResolve(specifier, context);
    },
});

const window = new Window({ url: 'http://localhost:8000/desktop/' });
const jqHandlers = new WeakMap();
const getJqBucket = (target, event) => {
    if (!target || (typeof target !== 'object' && typeof target !== 'function')) return [];
    let map = jqHandlers.get(target);
    if (!map) {
        map = new Map();
        jqHandlers.set(target, map);
    }
    let list = map.get(event);
    if (!list) {
        list = [];
        map.set(event, list);
    }
    return list;
};
const wrapJqNodes = nodes => Object.assign(nodes, {
    jquery: '3.5.1',
    on() { return this; },
    off() { return this; },
    triggerHandler: async () => {},
    find: sel => wrapJqNodes(nodes.flatMap(n => [...(n.querySelectorAll?.(sel) || [])])),
    attr: name => nodes[0]?.getAttribute?.(name) ?? undefined,
    text: () => nodes.map(n => n.textContent ?? '').join(''),
    html(val) {
        if (val === undefined) return nodes[0]?.innerHTML ?? '';
        for (const n of nodes) n.innerHTML = String(val);
        return this;
    },
    empty() {
        for (const n of nodes) n.innerHTML = '';
        return this;
    },
    append(val) {
        for (const n of nodes) {
            if (typeof val === 'string') n.insertAdjacentHTML('beforeend', val);
            else if (val) n.appendChild(val);
        }
        return this;
    },
});
const jQueryFn = selector => {
    if (typeof selector === 'string') {
        return wrapJqNodes([...window.document.querySelectorAll(selector)]);
    }
    if (selector instanceof window.Element || selector instanceof window.HTMLElement) {
        return wrapJqNodes([selector]);
    }
    if (typeof selector === 'function') {
        selector();
        return {};
    }
    return {
        on(event, handler) {
            if (typeof handler === 'function') {
                getJqBucket(selector, event).push(handler);
            }
            return this;
        },
        off(event, handler) {
            const list = getJqBucket(selector, event);
            if (!handler) {
                list.length = 0;
            } else {
                const idx = list.indexOf(handler);
                if (idx >= 0) list.splice(idx, 1);
            }
            return this;
        },
        async triggerHandler(event) {
            const list = [...getJqBucket(selector, event)];
            let last;
            for (const fn of list) {
                last = await fn.call(selector, { type: event, target: selector });
            }
            return last;
        },
    };
};
jQueryFn.ui = {};

Object.assign(globalThis, {
    self: globalThis,
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    HTMLIFrameElement: window.HTMLIFrameElement,
    HTMLUnknownElement: window.HTMLUnknownElement,
    HTMLMediaElement: window.HTMLMediaElement,
    Element: window.Element,
    Node: window.Node,
    NodeFilter: window.NodeFilter,
    DOMParser: window.DOMParser,
    Event: window.Event,
    CustomEvent: window.CustomEvent,
    EventTarget: window.EventTarget,
    MutationObserver: window.MutationObserver,
    localStorage: window.localStorage,
    sessionStorage: window.sessionStorage,
    location: window.location,
    getComputedStyle: window.getComputedStyle.bind(window),
    requestAnimationFrame: cb => setTimeout(cb, 0),
    jQuery: jQueryFn,
    $: jQueryFn,
    toastr: { info() {}, warning() {}, error() {}, success() {}, clear() {} },
});
const { DOMPurify, lodash } = await import(lockedLibUrl);
Object.assign(globalThis, { DOMPurify, _: lodash });
Object.assign(window, { DOMPurify, jQuery: jQueryFn, $: jQueryFn, _: lodash });
test.after(() => window.happyDOM.close());

const { EventEmitter } = await import('../extension/vc-model-settings/desktop/standalone/engine/events.js');
const { event_types } = await import('../extension/vc-model-settings/desktop/standalone/engine/st/events.js');
const { bindEngineContext } = await import('../extension/vc-model-settings/desktop/standalone/engine/ports.js');
const { openaiDefaults, powerUserDefaults } = await import('../extension/vc-model-settings/desktop/standalone/engine/defaults.js');
const {
    _eventOn,
    _eventMakeFirst,
    _eventMakeLast,
    _eventOnce,
    _eventOnButton,
} = await import('../extension/vc-model-settings/desktop/standalone/cards/helper-event.js');
const {
    _registerMacroLike,
    _unregisterMacroLike,
    replaceMacroLike,
    unregisterMacroLike,
} = await import('../extension/vc-model-settings/desktop/standalone/cards/helper-util.js');
const {
    _injectPrompts,
} = await import('../extension/vc-model-settings/desktop/standalone/cards/helper-inject.js');
const {
    _updateScriptButtonsWith,
    _appendInexistentScriptButtons,
} = await import('../extension/vc-model-settings/desktop/standalone/cards/helper-script.js');
const {
    scripts,
    createScriptState,
    getButtonId,
    disposeFrameInstance,
} = await import('../extension/vc-model-settings/desktop/standalone/cards/helper-host.js');
const {
    accountStorage,
    configureAccountStorage,
} = await import('../extension/vc-model-settings/desktop/standalone/cards/account-storage.js');
const {
    configureFormatting,
} = await import('../extension/vc-model-settings/desktop/standalone/cards/format.js');
const {
    bindCardHost,
} = await import('../extension/vc-model-settings/desktop/standalone/cards/ejs-host.js');
const {
    initializeCards,
} = await import('../extension/vc-model-settings/desktop/standalone/cards/index.js');
const {
    createSettingsDocuments,
} = await import('../extension/vc-model-settings/settings-documents.js');
const {
    settingsForSave,
} = await import('../extension/vc-model-settings/desktop/standalone/engine/runtime.js');

function createTestHost() {
    const card = {
        avatar: 'lifecycle.png',
        name: '测试角色',
        data: {
            name: '测试角色',
            extensions: {
                vc_character_ref: 'lifecycle-ref',
                tavern_helper: { scripts: [], variables: {} },
            },
        },
    };
    const context = {
        characters: [card],
        characterId: 0,
        chatId: 'lifecycle-chat',
        name1: '用户',
        name2: '测试角色',
        chat: [
            { name: '测试角色', is_user: false, is_system: false, swipe_id: 0, mes: '第0层' },
            { name: '测试角色', is_user: false, is_system: false, swipe_id: 0, mes: '```html\n<html><body><div>第1层卡片</div></body></html>\n```' },
        ],
        chatMetadata: { variables: {} },
        extensionPrompts: {},
        eventSource: new EventEmitter(),
        eventTypes: event_types,
        saveMetadataDebounced() {},
        saveSettingsDebounced() {},
    };
    const settings = {
        oai_settings: { ...structuredClone(openaiDefaults), preset_settings_openai: 'Default' },
        power_user: {
            ...structuredClone(powerUserDefaults),
            experimental_macro_engine: false,
            reasoning: { prefix: '', suffix: '' },
            context: {},
            forbid_external_media: true,
            external_media_allowed_overrides: [],
            external_media_forbidden_overrides: [],
        },
        world_info: { globalSelect: [] },
        extension_settings: {
            disabledExtensions: [],
            regex: [],
            variables: { global: {} },
            tavern_helper: {
                render: { enabled: true, depth: 0, allow_streaming: true },
                script: {
                    enabled: { global: true, presets: [], characters: ['lifecycle.png'] },
                    scripts: [],
                },
            },
        },
    };
    bindEngineContext(context, settings, {});
    bindCardHost({
        context,
        settings,
        packet: { world_names: [] },
        presets: { Default: structuredClone(settings.oai_settings) },
        client: { headers: () => ({}), post: async () => new Response('{}'), request: async () => ({ entries: {} }) },
        surface: { format() {}, async refresh() {}, codeBlocks() {}, media() {}, reasoning() {} },
    });
    return { context, settings, card };
}

test('Lifecycle 1: _eventOn / _eventMakeFirst / _eventMakeLast / _eventOnce / _eventOnButton .stop() removes wrapped listener and leaves emitter bucket empty', async () => {
    const { context } = createTestHost();
    const frame = document.createElement('iframe');
    frame.id = frame.name = 'TH-script--character--stop_script';
    const win = { frameElement: frame, name: frame.id };

    let countOn = 0;
    let countFirst = 0;
    let countLast = 0;
    let countOnce = 0;
    let countOnceFire = 0;
    let countBtn = 0;

    const hOn = _eventOn.call(win, 'custom_evt', () => { countOn += 1; });
    const hFirst = _eventMakeFirst.call(win, 'custom_evt', () => { countFirst += 1; });
    const hLast = _eventMakeLast.call(win, 'custom_evt', () => { countLast += 1; });
    const hOnce = _eventOnce.call(win, 'custom_evt_once', () => { countOnce += 1; });
    _eventOnce.call(win, 'custom_evt_once_fire', () => { countOnceFire += 1; });
    const hBtn = _eventOnButton.call(win, 'btn_evt', () => { countBtn += 1; });

    await context.eventSource.emit('custom_evt');
    await context.eventSource.emit('custom_evt_once_fire');
    await context.eventSource.emit('custom_evt_once_fire');
    await context.eventSource.emit(getButtonId('stop_script', 'btn_evt'));
    assert.equal(countOn, 1);
    assert.equal(countFirst, 1);
    assert.equal(countLast, 1);
    assert.equal(countOnceFire, 1, '_eventOnce listener should fire only once');
    assert.equal((context.eventSource.events.custom_evt_once_fire ?? []).length, 0, 'fired _eventOnce must leave emitter bucket empty');
    assert.equal(countBtn, 1);

    // Calling stop() on returned handles must remove the wrapped listeners (and hOnce before it fires)
    hOn.stop();
    hFirst.stop();
    hLast.stop();
    hOnce.stop();
    assert.equal((context.eventSource.events.custom_evt_once ?? []).length, 0, 'stopped _eventOnce must remove listener from real EventEmitter bucket');
    assert.equal(typeof hBtn?.stop, 'function', '_eventOnButton must return a handle with stop()');
    hBtn.stop();

    await context.eventSource.emit('custom_evt');
    await context.eventSource.emit('custom_evt_once');
    await context.eventSource.emit(getButtonId('stop_script', 'btn_evt'));
    assert.equal(countOn, 1, '_eventOn listener should not fire after stop()');
    assert.equal(countFirst, 1, '_eventMakeFirst listener should not fire after stop()');
    assert.equal(countLast, 1, '_eventMakeLast listener should not fire after stop()');
    assert.equal(countOnce, 0, '_eventOnce listener should not fire if stop() was called before emit');
    assert.equal(countBtn, 1, '_eventOnButton listener should not fire after stop()');
});

test('Lifecycle 2: floor reordering updates display id without breaking instance ownership, stop(), or frame release cleanup (events, macros, prompts)', async () => {
    const prevFetch = globalThis.fetch;
    globalThis.fetch = async url => {
        if (String(url).endsWith('/version')) {
            return new Response(JSON.stringify({ pkgVersion: '1.12.0' }));
        }
        return new Response('{}');
    };
    try {
        const { context, settings } = createTestHost();
        const cards = await initializeCards({
            context,
            settings,
            packet: { world_names: [] },
            presets: { Default: structuredClone(settings.oai_settings) },
            client: { headers: () => ({}), post: async () => new Response('{}'), request: async () => ({ entries: {} }) },
            callGenericPopup: async () => 1,
        });
        await cards.open();

        const host0 = document.createElement('div');
        const host1 = document.createElement('div');
        document.body.append(host0, host1);

        const cleanup0 = cards.renderMessage(host0, 0, context.chat[0], false);
        const cleanup1 = cards.renderMessage(host1, 1, context.chat[1], false);
        await cards.settle();

        const iframe = host1.querySelector('iframe');
        assert.ok(iframe, 'authorized message 1 should mount iframe');
        assert.equal(iframe.id, 'TH-message--1--0');
        const win = Object.assign(new EventTarget(), { frameElement: iframe, name: iframe.name, __TH_IFRAME_ID: iframe.id });

        let fired1 = 0;
        let fired2 = 0;
        const h1 = _eventOn.call(win, 'floor_evt_1', () => { fired1 += 1; });
        _eventOn.call(win, 'floor_evt_2', () => { fired2 += 1; });
        _registerMacroLike.call(win, /\{\{t14_frame_macro\}\}/g, () => 'FRAME_MACRO_VAL');
        _injectPrompts.call(win, [
            { id: 'frame_prompt_1', position: 'in_chat', depth: 0, role: 'system', content: 'FRAME_PROMPT_VAL' },
        ], { once: false });

        assert.equal(replaceMacroLike('{{t14_frame_macro}}'), 'FRAME_MACRO_VAL');
        assert.equal(context.extensionPrompts.frame_prompt_1?.value, 'FRAME_PROMPT_VAL');

        await context.eventSource.emit('floor_evt_1');
        await context.eventSource.emit('floor_evt_2');
        assert.equal(fired1, 1);
        assert.equal(fired2, 1);

        // Delete floor 0 and shift host1 to floor 0 (rebindMessageFrames renames iframe.id to TH-message--0--0)
        context.chat.shift();
        cleanup0();
        const cleanup1After = cards.renderMessage(host1, 0, context.chat[0], false);
        await cards.surface.refresh([0]);
        await cards.settle();

        assert.equal(host1.querySelector('iframe'), iframe, 'iframe instance must be preserved across floor shift');
        assert.equal(iframe.id, 'TH-message--0--0');

        // Active listeners must STILL fire after floor shift changed iframe.id!
        await context.eventSource.emit('floor_evt_2');
        assert.equal(fired2, 2, 'listener registered before floor shift must continue to fire after floor shift changed frame.id');

        // h1.stop() must still remove the listener registered when iframe.id was TH-message--1--0!
        h1.stop();
        await context.eventSource.emit('floor_evt_1');
        assert.equal(fired1, 1, 'stop() must remove listener even after floor shift changed frame.id');

        // Releasing the message frame (cleanup1After -> disposeFrameInstance(iframe)) must directly clean up
        // remaining listeners, macros, and injected prompts registered with `this = win` without manual unregister/uninject!
        cleanup1After();
        await context.eventSource.emit('floor_evt_2');
        assert.equal(fired2, 2, 'releasing frame must clean up listeners registered before floor shift');
        assert.equal(replaceMacroLike('{{t14_frame_macro}}'), '{{t14_frame_macro}}', 'disposeFrameInstance(frame) must directly unregister macros registered via window `this`');
        assert.equal(context.extensionPrompts.frame_prompt_1, undefined, 'disposeFrameInstance(frame) must directly uninject prompts registered via window `this`');

        host0.remove();
        host1.remove();
        cards.destroy();
    } finally {
        globalThis.fetch = prevFetch;
    }
});

test('Lifecycle 3: macro preserves first-registration-wins by regex.source, rejected duplicate handle is no-op, and old handle cannot delete later re-registration', () => {
    createTestHost();
    unregisterMacroLike(/\{\{t14_greeting\}\}/g);

    const frameA = document.createElement('iframe');
    frameA.id = frameA.name = 'TH-script--character--macroA';
    const frameB = document.createElement('iframe');
    frameB.id = frameB.name = 'TH-script--character--macroB';
    const winA = { frameElement: frameA, name: frameA.id, addEventListener() {} };
    const winB = { frameElement: frameB, name: frameB.id, addEventListener() {} };

    let callsA = 0;
    let callsB = 0;
    const regA = _registerMacroLike.call(winA, /\{\{t14_greeting\}\}/g, () => { callsA += 1; return 'Hello from A'; });
    // Duplicate regex.source (even with different flags 'gi') must be ignored while regA is active
    const regB = _registerMacroLike.call(winB, /\{\{t14_greeting\}\}/gi, () => { callsB += 1; return 'Hello from B'; });

    assert.equal(replaceMacroLike('Say {{t14_greeting}}'), 'Say Hello from A', 'first registration by regex.source must win');
    assert.equal(callsA, 1);
    assert.equal(callsB, 0, 'duplicate registration with different flags must not run or double-replace');

    // Rejected duplicate handle must NOT delete the existing active entry
    regB.unregister();
    assert.equal(replaceMacroLike('Say {{t14_greeting}}'), 'Say Hello from A', 'rejected duplicate handle must not delete existing macro');

    // Unregistering the winning entry removes it
    regA.unregister();
    assert.equal(replaceMacroLike('Say {{t14_greeting}}'), 'Say {{t14_greeting}}');

    // Re-registering after A was unregistered works, and old regA handle cannot delete the new registration!
    const regC = _registerMacroLike.call(winB, /\{\{t14_greeting\}\}/g, () => 'Hello from C');
    assert.equal(replaceMacroLike('Say {{t14_greeting}}'), 'Say Hello from C');
    regA.unregister();
    assert.equal(replaceMacroLike('Say {{t14_greeting}}'), 'Say Hello from C', 'stale handle must not delete subsequent registration with same regex.source');

    _unregisterMacroLike.call(winB, /\{\{t14_greeting\}\}/g);
    assert.equal(replaceMacroLike('Say {{t14_greeting}}'), 'Say {{t14_greeting}}');
});

test('Lifecycle 4: prompt injection old cleanup (uninject / pagehide / once) does not delete newer registration with same id and removes once listener from emitter', async () => {
    const { context } = createTestHost();
    const winOld = new EventTarget();
    const winNew = new EventTarget();

    const oldHandle = _injectPrompts.call(winOld, [
        { id: 'shared_prompt', position: 'in_chat', depth: 0, role: 'system', content: 'OLD CONTENT' },
    ], { once: true });

    assert.equal(context.extensionPrompts.shared_prompt?.value, 'OLD CONTENT');
    assert.equal((context.eventSource.events.generation_ended ?? []).length, 1);

    const newHandle = _injectPrompts.call(winNew, [
        { id: 'shared_prompt', position: 'in_chat', depth: 0, role: 'system', content: 'NEW CONTENT' },
    ], { once: false });

    assert.equal(context.extensionPrompts.shared_prompt?.value, 'NEW CONTENT');

    // 1. Old handle calling uninject() must NOT remove the newer registration AND must remove its once listener from EventEmitter
    oldHandle.uninject();
    assert.equal((context.eventSource.events.generation_ended ?? []).length, 0, 'uninject() on once prompt must remove listener from real EventEmitter');
    assert.equal(
        context.extensionPrompts.shared_prompt?.value,
        'NEW CONTENT',
        'old uninject() handle must not delete newer prompt registration with same id',
    );

    // 2. Old instance pagehide event must NOT remove the newer registration
    winOld.dispatchEvent(new Event('pagehide'));
    assert.equal(
        context.extensionPrompts.shared_prompt?.value,
        'NEW CONTENT',
        'old instance pagehide must not delete newer prompt registration with same id',
    );

    // 3. Old once cleanup on generation_ended must NOT remove the newer registration
    await context.eventSource.emit('generation_ended');
    assert.equal(
        context.extensionPrompts.shared_prompt?.value,
        'NEW CONTENT',
        'old once generation_ended handler must not delete newer non-once prompt registration',
    );

    newHandle.uninject();
    assert.equal(context.extensionPrompts.shared_prompt, undefined);
});

test('Lifecycle 5: late async button updater does not overwrite recreated script instance with the same script ID', async () => {
    createTestHost();
    const scriptId = 'script_buttons_race';

    const rawScript1 = {
        id: scriptId,
        name: 'Race Script',
        enabled: true,
        content: '',
        button: { enabled: true, buttons: [{ name: 'Initial v1', visible: true }] },
        data: {},
    };
    const state1 = createScriptState(rawScript1, 'character');
    scripts.set(scriptId, state1);

    const frame1 = document.createElement('iframe');
    frame1.id = frame1.name = `TH-script--character--${scriptId}`;
    document.body.appendChild(frame1);
    const win1 = { frameElement: frame1, name: frame1.id };

    let resolveLateUpdater;
    const latePromise = _updateScriptButtonsWith.call(win1, async () => {
        await new Promise((resolve) => { resolveLateUpdater = resolve; });
        return [{ name: 'Stale Late Button', visible: true }];
    });

    const lateAppendPromise = _appendInexistentScriptButtons.call(win1, [
        { name: 'Stale Appended', visible: true },
    ]);
    void lateAppendPromise;

    // Simulate closing scripts and recreating a new script instance with the SAME scriptId
    disposeFrameInstance(frame1);
    frame1.remove();
    scripts.clear();
    const rawScript2 = {
        id: scriptId,
        name: 'Race Script',
        enabled: true,
        content: '',
        button: { enabled: true, buttons: [{ name: 'Fresh v2 Button', visible: true }] },
        data: {},
    };
    const state2 = createScriptState(rawScript2, 'character');
    scripts.set(scriptId, state2);

    resolveLateUpdater();
    await latePromise.catch(() => {});

    assert.deepEqual(
        scripts.get(scriptId).button.buttons,
        [{ name: 'Fresh v2 Button', visible: true }],
        'late async updater from disposed script instance must not overwrite buttons on recreated instance',
    );
});

test('Lifecycle 6: accountStorage migration via real bindCardHost + createSettingsDocuments awaits durable saveSettings confirmation and preserves keys updated while awaiting', async () => {
    localStorage.clear();

    // 1. Account isolation across init() calls
    configureAccountStorage({ saveSettingsDebounced: () => {} });
    accountStorage.init({ accountA_only: 'secret_A', __migrated: '1' });
    assert.equal(accountStorage.getItem('accountA_only'), 'secret_A');

    accountStorage.init({ accountB_only: 'secret_B', __migrated: '1' });
    assert.equal(
        accountStorage.getItem('accountA_only'),
        null,
        'accountStorage.init must not merge previous account keys into new account state',
    );
    assert.equal(accountStorage.getItem('accountB_only'), 'secret_B');

    // 2. When bindCardHost only has context.saveSettingsDebounced() returning undefined (no durable persistSettings),
    // legacy localStorage keys must NOT be deleted!
    localStorage.setItem('AlertRegex_legacy', 'legacy_value');
    localStorage.setItem('AlertWI_updated', 'initial_wi_val');
    const { context, settings } = createTestHost();
    delete settings.accountStorage;
    bindCardHost({
        context,
        settings,
        packet: { world_names: [] },
        presets: {},
        client: { headers: () => ({}), post: async () => new Response('{}'), request: async () => ({ entries: {} }) },
        surface: { format() {}, async refresh() {}, codeBlocks() {}, media() {}, reasoning() {} },
    });
    await new Promise(r => setTimeout(r, 10));
    assert.equal(
        localStorage.getItem('AlertRegex_legacy'),
        'legacy_value',
        'undefined return from saveSettingsDebounced without durable persistSettings must not delete localStorage keys',
    );
    assert.equal(settings.accountStorage?.__migrated, undefined);

    // 3. Real createSettingsDocuments + controlled post Promise via bindCardHost({ persistSettings }):
    // First test server failure (500), then server confirmation with concurrent localStorage update while awaiting.
    let pendingPostResolve = null;
    const savedCalls = [];
    const documents = createSettingsDocuments({
        post: (url, body) => new Promise(resolve => {
            savedCalls.push({ url, body });
            pendingPostResolve = resolve;
        }),
    });
    delete settings.accountStorage;
    documents.captureSettings(settingsForSave(settings), settings);

    bindCardHost({
        context,
        settings,
        packet: { world_names: [] },
        presets: {},
        client: { headers: () => ({}), post: async () => new Response('{}'), request: async () => ({ entries: {} }) },
        persistSettings: () => documents.saveSettings(() => settingsForSave(settings)),
        surface: { format() {}, async refresh() {}, codeBlocks() {}, media() {}, reasoning() {} },
    });

    await new Promise(r => setTimeout(r, 5));
    assert.equal(savedCalls.length, 1, 'bindCardHost migration must invoke persistSettings -> client/documents.saveSettings');
    assert.equal(localStorage.getItem('AlertRegex_legacy'), 'legacy_value', 'localStorage key must still exist while saveSettings is in flight');

    // Simulate failure first
    pendingPostResolve(new Response(JSON.stringify({ code: 'ERR' }), { status: 500 }));
    await new Promise(r => setTimeout(r, 10));
    assert.equal(
        localStorage.getItem('AlertRegex_legacy'),
        'legacy_value',
        'localStorage key must be preserved when saveSettings rejects',
    );
    assert.equal(settings.accountStorage?.__migrated, undefined);

    // Now re-run migration with durable confirmation; while awaiting confirmation, user updates AlertWI_updated in localStorage
    delete settings.accountStorage;
    documents.captureSettings(settingsForSave(settings), settings);
    bindCardHost({
        context,
        settings,
        packet: { world_names: [] },
        presets: {},
        client: { headers: () => ({}), post: async () => new Response('{}'), request: async () => ({ entries: {} }) },
        persistSettings: () => documents.saveSettings(() => settingsForSave(settings)),
        surface: { format() {}, async refresh() {}, codeBlocks() {}, media() {}, reasoning() {} },
    });

    await new Promise(r => setTimeout(r, 5));
    // User updates AlertWI_updated while the persistence request is in flight!
    localStorage.setItem('AlertWI_updated', 'newer_user_value_during_save');

    pendingPostResolve(new Response('{}', { status: 200 }));
    await new Promise(r => setTimeout(r, 10));

    assert.equal(settings.accountStorage?.__migrated, '1');
    assert.equal(accountStorage.getItem('AlertRegex_legacy'), 'legacy_value');
    assert.equal(
        localStorage.getItem('AlertRegex_legacy'),
        null,
        'unchanged localStorage key must be deleted after saveSettings resolves',
    );
    assert.equal(
        localStorage.getItem('AlertWI_updated'),
        'newer_user_value_during_save',
        'localStorage key modified while awaiting persistence must NOT be deleted',
    );
});

test('Lifecycle 7: repeated configureFormatting / bindCardHost does not stack duplicate DOMPurify hooks', async () => {
    createTestHost();
    for (let i = 0; i < 5; i++) {
        configureFormatting({
            getRegexedString: s => s,
            regex_placement: {},
            accountStorage,
            toastr: { warning() {}, info() {}, error() {}, success() {}, clear() {} },
            t: (strings, ...values) => String.raw({ raw: strings }, ...values),
        });
    }

    const out = DOMPurify.sanitize('<div class="foo">hello</div>', { MESSAGE_SANITIZE: true, FORCE_BODY: true });
    assert.equal(
        out,
        '<div class="custom-foo">hello</div>',
        `expected DOMPurify uponSanitizeAttribute hook to prefix class once ('custom-foo'), got: ${out}`,
    );
});

test('Lifecycle 8: cross-owner isolation between initializeCards A and initializeCards B, full destroy cleanup, and getEnabledExtensions()', async () => {
    const prevFetch = globalThis.fetch;
    globalThis.fetch = async url => {
        if (String(url).endsWith('/version')) {
            return new Response(JSON.stringify({ pkgVersion: '1.12.0' }));
        }
        return new Response('{}');
    };
    try {
        const makeOwnerEnv = (suffix, scriptId) => {
            const card = {
                avatar: `owner-${suffix}.png`,
                name: `角色${suffix}`,
                data: {
                    name: `角色${suffix}`,
                    extensions: {
                        vc_character_ref: `ref-${suffix}`,
                        tavern_helper: {
                            scripts: [
                                {
                                    type: 'script',
                                    id: scriptId,
                                    name: `Script ${suffix}`,
                                    enabled: true,
                                    content: '',
                                    button: { enabled: false, buttons: [] },
                                    data: {},
                                },
                            ],
                        },
                    },
                },
            };
            const context = {
                characters: [card],
                characterId: 0,
                chatId: `chat-${suffix}`,
                name1: '用户',
                name2: `角色${suffix}`,
                chat: [
                    { name: `角色${suffix}`, is_user: false, is_system: false, swipe_id: 0, mes: '```html\n<html><body><div>卡片面板</div></body></html>\n```' },
                ],
                chatMetadata: { variables: {} },
                extensionPrompts: {},
                eventSource: new EventEmitter(),
                eventTypes: event_types,
                saveMetadataDebounced() {},
                saveSettingsDebounced() {},
            };
            const settings = {
                oai_settings: { ...structuredClone(openaiDefaults), preset_settings_openai: 'Default' },
                power_user: {
                    ...structuredClone(powerUserDefaults),
                    experimental_macro_engine: false,
                    forbid_external_media: true,
                    external_media_allowed_overrides: [],
                    external_media_forbidden_overrides: [],
                },
                world_info: { globalSelect: [] },
                extension_settings: {
                    disabledExtensions: [],
                    variables: { global: {} },
                    tavern_helper: {
                        render: { enabled: true, depth: 0, allow_streaming: true },
                        script: {
                            enabled: { global: true, presets: [], characters: [`owner-${suffix}.png`] },
                            scripts: [],
                        },
                    },
                    EjsTemplate: {
                        enabled: true,
                        generate_enabled: true,
                        render_enabled: true,
                        raw_message_evaluation_enabled: true,
                        filter_message_enabled: true,
                        compile_workers: false,
                        sandbox: false,
                    },
                },
            };
            return { context, settings };
        };

        const envA = makeOwnerEnv('A', 'script_owner_A');
        bindEngineContext(envA.context, envA.settings, {});
        const cardsA = await initializeCards({
            context: envA.context,
            settings: envA.settings,
            packet: { world_names: [] },
            presets: { Default: structuredClone(envA.settings.oai_settings) },
            client: { headers: () => ({}), post: async () => new Response('{}'), request: async () => ({ entries: {} }) },
            callGenericPopup: async () => 1,
        });
        await cardsA.open();

        const mesHostA = document.createElement('div');
        document.body.appendChild(mesHostA);
        cardsA.renderMessage(mesHostA, 0, envA.context.chat[0], false);
        await cardsA.settle();

        const frameA = document.querySelector('iframe#TH-script--character--script_owner_A');
        const mesFrameA = mesHostA.querySelector('iframe');
        assert.ok(frameA, 'owner A script frame should be mounted');
        assert.ok(mesFrameA, 'owner A message frame should be mounted');
        const winA = Object.assign(new EventTarget(), { frameElement: frameA, name: frameA.name });
        const boundInjectPromptsA = globalThis.TavernHelper._bind._injectPrompts.bind(winA);
        _eventOn.call(winA, 'evt_cross_owner', () => {});

        // Initialize Owner B while Owner A's frames are still connected in DOM
        const envB = makeOwnerEnv('B', 'script_owner_B');
        bindEngineContext(envB.context, envB.settings, {});
        const cardsB = await initializeCards({
            context: envB.context,
            settings: envB.settings,
            packet: { world_names: [] },
            presets: { Default: structuredClone(envB.settings.oai_settings) },
            client: { headers: () => ({}), post: async () => new Response('{}'), request: async () => ({ entries: {} }) },
            callGenericPopup: async () => 1,
        });
        await cardsB.open();

        // 1. A's still-connected frame calling boundInjectPromptsA MUST fail assertFrame and MUST NOT write to B.extensionPrompts!
        assert.throws(
            () => boundInjectPromptsA([{ id: 'leak_from_A', position: 'in_chat', depth: 0, role: 'system', content: 'LEAK' }], { once: false }),
            /VC_STALE_CARD_RUNTIME/,
            'old owner connected frame must be rejected by assertFrame after new owner takes over',
        );
        assert.equal(envB.context.extensionPrompts.leak_from_A, undefined, 'old owner frame must not write into new owner extensionPrompts');

        // 2. B must not see A's script IDs, and non-current owner A returns [] from getEnabledExtensions()
        assert.deepEqual(globalThis.TavernHelper.getActiveScriptIds(), ['script_owner_B'], 'new owner must only expose its own active script IDs');
        assert.deepEqual(cardsA.getEnabledExtensions(), [], 'non-current owner must return empty array from getEnabledExtensions()');

        // 3. Destroying A must clean up A's emitter listeners, script frames, and message frames without clobbering B's globals or B's listeners
        cardsA.destroy();
        assert.equal((envA.context.eventSource.events.evt_cross_owner ?? []).length, 0, 'destroying A must remove A script listeners from A emitter');
        assert.equal((envA.context.eventSource.events[event_types.CHAT_COMPLETION_SETTINGS_READY] ?? []).length, 0, 'destroying A must detach EJS listeners from A emitter');
        assert.equal(mesFrameA.isConnected, false, 'destroying A must also release A message iframes');
        assert.ok(globalThis.TavernHelper, 'destroying stale owner A must not delete global TavernHelper while owner B is active');
        assert.deepEqual(globalThis.TavernHelper.getActiveScriptIds(), ['script_owner_B']);

        // 4. getEnabledExtensions() returns a plain Array (no overloaded .includes) of ['third-party/JS-Slash-Runner', 'third-party/ST-Prompt-Template']
        const enabledExtB = cardsB.getEnabledExtensions();
        assert.equal(Array.isArray(enabledExtB), true);
        assert.equal(Object.hasOwn(enabledExtB, 'includes'), false, 'getEnabledExtensions() must return a plain array without overloaded .includes');
        assert.deepEqual(enabledExtB, ['third-party/JS-Slash-Runner', 'third-party/ST-Prompt-Template']);
        envB.settings.extension_settings.disabledExtensions.push('third-party/JS-Slash-Runner');
        assert.deepEqual(cardsB.getEnabledExtensions(), ['third-party/ST-Prompt-Template']);
        envB.settings.extension_settings.disabledExtensions.push('third-party/ST-Prompt-Template');
        assert.deepEqual(cardsB.getEnabledExtensions(), []);

        mesHostA.remove();
        cardsB.destroy();
        assert.deepEqual(cardsB.getEnabledExtensions(), [], 'destroyed owner must return [] from getEnabledExtensions()');
    } finally {
        globalThis.fetch = prevFetch;
    }
});

test('Lifecycle 9: creation-phase late owner A aborted while awaiting /version does not bind or clobber active owner B', async () => {
    const prevFetch = globalThis.fetch;
    let resolveVersionA;
    let fetchCount = 0;
    globalThis.fetch = async url => {
        if (String(url).endsWith('/version')) {
            fetchCount += 1;
            if (fetchCount === 1) {
                await new Promise(resolve => { resolveVersionA = resolve; });
            }
            return new Response(JSON.stringify({ pkgVersion: '1.12.0' }));
        }
        return new Response('{}');
    };
    try {
        const makeEnv = suffix => {
            const card = {
                avatar: `init-${suffix}.png`,
                name: `角色${suffix}`,
                data: {
                    name: `角色${suffix}`,
                    extensions: {
                        vc_character_ref: `ref-${suffix}`,
                        tavern_helper: {
                            scripts: [
                                {
                                    type: 'script',
                                    id: `script_${suffix}`,
                                    name: `Script ${suffix}`,
                                    enabled: true,
                                    content: '',
                                    button: { enabled: false, buttons: [] },
                                    data: {},
                                },
                            ],
                        },
                    },
                },
            };
            const context = {
                characters: [card],
                characterId: 0,
                chatId: `chat-${suffix}`,
                name1: '用户',
                name2: `角色${suffix}`,
                chat: [],
                chatMetadata: { variables: {} },
                extensionPrompts: {},
                eventSource: new EventEmitter(),
                eventTypes: event_types,
                saveMetadataDebounced() {},
                saveSettingsDebounced() {},
            };
            const settings = {
                oai_settings: { ...structuredClone(openaiDefaults), preset_settings_openai: 'Default' },
                power_user: {
                    ...structuredClone(powerUserDefaults),
                    experimental_macro_engine: false,
                    forbid_external_media: true,
                    external_media_allowed_overrides: [],
                    external_media_forbidden_overrides: [],
                },
                world_info: { globalSelect: [] },
                extension_settings: {
                    disabledExtensions: [],
                    variables: { global: {} },
                    tavern_helper: {
                        render: { enabled: true, depth: 0, allow_streaming: true },
                        script: {
                            enabled: { global: true, presets: [], characters: [`init-${suffix}.png`] },
                            scripts: [],
                        },
                    },
                    EjsTemplate: {
                        enabled: true,
                        generate_enabled: true,
                        render_enabled: true,
                        raw_message_evaluation_enabled: true,
                        filter_message_enabled: true,
                        compile_workers: false,
                        sandbox: false,
                    },
                },
            };
            return { context, settings };
        };

        const controllerA = new AbortController();
        const envA = makeEnv('A');
        bindEngineContext(envA.context, envA.settings, {});
        const initPromiseA = initializeCards({
            context: envA.context,
            settings: envA.settings,
            packet: { world_names: [] },
            presets: { Default: structuredClone(envA.settings.oai_settings) },
            client: { headers: () => ({}), post: async () => new Response('{}'), request: async () => ({ entries: {} }) },
            callGenericPopup: async () => 1,
            signal: controllerA.signal,
        });

        // A bridge is destroyed (controllerA.abort()) while A is still awaiting /version; B initializes and completes
        controllerA.abort();

        const controllerB = new AbortController();
        const envB = makeEnv('B');
        bindEngineContext(envB.context, envB.settings, {});
        const cardsB = await initializeCards({
            context: envB.context,
            settings: envB.settings,
            packet: { world_names: [] },
            presets: { Default: structuredClone(envB.settings.oai_settings) },
            client: { headers: () => ({}), post: async () => new Response('{}'), request: async () => ({ entries: {} }) },
            callGenericPopup: async () => 1,
            signal: controllerB.signal,
        });
        await cardsB.open();

        // Now A's delayed /version response arrives
        resolveVersionA();
        await assert.rejects(initPromiseA, err => err?.name === 'AbortError');

        // B must still be the current owner, with its globals, active script IDs, and single [data-vc-card-scripts] intact; A must leave 0 frames/listeners
        assert.deepEqual(cardsB.getEnabledExtensions(), ['third-party/JS-Slash-Runner', 'third-party/ST-Prompt-Template']);
        assert.equal(globalThis.SillyTavern.getContext(), envB.context, 'aborted late init A must not overwrite global SillyTavern context');
        assert.deepEqual(globalThis.TavernHelper.getActiveScriptIds(), ['script_B'], 'B must remain the active TavernHelper owner');
        assert.equal(document.querySelectorAll('[data-vc-card-scripts]').length, 1, 'aborted init A must not leave extra [data-vc-card-scripts] containers');
        assert.equal((envA.context.eventSource.events[event_types.CHAT_COMPLETION_SETTINGS_READY] ?? []).length, 0, 'aborted init A must leave 0 listeners on A emitter');

        cardsB.destroy();
    } finally {
        globalThis.fetch = prevFetch;
    }
});

test('Lifecycle 10: EJS template with <pre> sets native is_ejs_processed, surface render/refresh does not self-emit RENDERED, and structural owner emits RENDERED once', async () => {
    const prevFetch = globalThis.fetch;
    globalThis.fetch = async url => {
        if (String(url).endsWith('/version')) {
            return new Response(JSON.stringify({ pkgVersion: '1.12.0' }));
        }
        return new Response('{}');
    };
    delete globalThis.__t14RenderEjsCount;

    const chatRoot = document.createElement('div');
    chatRoot.id = 'chat';
    document.body.innerHTML = '';
    document.body.appendChild(chatRoot);

    try {
        const { context, settings } = createTestHost();
        settings.extension_settings.EjsTemplate = {
            enabled: true,
            generate_enabled: true,
            render_enabled: true,
            code_blocks_enabled: true,
            raw_message_evaluation_enabled: false,
            filter_message_enabled: true,
            compile_workers: false,
            sandbox: false,
        };
        context.chat.splice(0, context.chat.length, {
            name: '测试角色',
            is_user: false,
            is_system: false,
            swipe_id: 0,
            mes: [
                '```html',
                '<html><body><% globalThis.__t14RenderEjsCount = (globalThis.__t14RenderEjsCount || 0) + 1; %><div id="ejs-pre-panel">EJS面板 <%= 1 + 1 %></div></body></html>',
                '```',
            ].join('\n'),
        });

        const cards = await initializeCards({
            context,
            settings,
            packet: { world_names: [] },
            presets: { Default: structuredClone(settings.oai_settings) },
            client: { headers: () => ({}), post: async () => new Response('{}'), request: async () => ({ entries: {} }) },
            callGenericPopup: async () => 1,
        });
        await cards.open();

        let charRenderedCount = 0;
        let userRenderedCount = 0;
        context.eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, async () => {
            await new Promise(r => setTimeout(r, 2));
            charRenderedCount += 1;
        });
        context.eventSource.on(event_types.USER_MESSAGE_RENDERED, async () => {
            userRenderedCount += 1;
        });

        const mesCell = document.createElement('div');
        mesCell.className = 'mes';
        mesCell.setAttribute('mesid', '0');
        chatRoot.appendChild(mesCell);

        // 1. Initial render via cards.renderMessage: EJS runs prior to mountHtml, sets is_ejs_processed[0] = true, mounts iframe from EJS <pre>, and emits 0 RENDERED events
        const cleanup0 = cards.renderMessage(mesCell, 0, context.chat[0], false);
        await cards.settle();

        assert.equal(globalThis.__t14RenderEjsCount, 1, 'initial render should evaluate EJS template once');
        assert.equal(context.chat[0].is_ejs_processed?.[0], true, 'native EJS Kg must mark message.is_ejs_processed[swipe_id] = true');
        assert.ok(mesCell.querySelector('iframe'), 'EJS render must run prior to mountHtml so <pre> emitted by EJS mounts as card iframe');
        assert.equal(charRenderedCount, 0, 'cards.renderMessage must not self-emit CHARACTER_MESSAGE_RENDERED');
        assert.equal(userRenderedCount, 0, 'cards.renderMessage must not self-emit USER_MESSAGE_RENDERED');

        // 2. Subsequent surface.refresh([0]) when is_ejs_processed[0] === true (dryRun=true with <pre> in output) must NOT self-emit CHARACTER_MESSAGE_RENDERED
        await cards.surface.refresh([0]);
        await cards.settle();

        assert.equal(globalThis.__t14RenderEjsCount, 2, 'surface.refresh([0]) re-evaluates display EJS once');
        assert.equal(charRenderedCount, 0, 'dryRun EJS render containing <pre> must not re-emit CHARACTER_MESSAGE_RENDERED');

        // 3. Structural owner emitting CHARACTER_MESSAGE_RENDERED once fires async listener once and does NOT trigger an extra EJS Kg render
        await context.eventSource.emit(event_types.CHARACTER_MESSAGE_RENDERED, 0);
        assert.equal(charRenderedCount, 1, 'structural owner emit must fire async CHARACTER_MESSAGE_RENDERED exactly once');
        assert.equal(globalThis.__t14RenderEjsCount, 2, 'CHARACTER_MESSAGE_RENDERED must not re-trigger EJS Kg handler');

        cleanup0();
        cards.destroy();
    } finally {
        globalThis.fetch = prevFetch;
    }
});
