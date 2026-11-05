import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';

const happyWindow = new Window({ url: 'http://localhost:8000/' });
globalThis.window = happyWindow;
globalThis.document = happyWindow.document;
globalThis.localStorage = happyWindow.localStorage;
globalThis.HTMLElement = happyWindow.HTMLElement;
globalThis.Element = happyWindow.Element;
globalThis.Node = happyWindow.Node;
globalThis.CustomEvent = happyWindow.CustomEvent;
globalThis.Event = happyWindow.Event;
globalThis.DOMParser = happyWindow.DOMParser;
globalThis.MutationObserver = happyWindow.MutationObserver;
Object.defineProperty(globalThis, 'navigator', {
    value: happyWindow.navigator,
    configurable: true,
    writable: true,
});

const libMod = await import('../extension/vc-model-settings/desktop/locked-source/st/lib.js');
globalThis._ = libMod.lodash;

const lockedParserMod = await import('../extension/vc-model-settings/desktop/locked-source/st/scripts/slash-commands/SlashCommandParser.js');
const lockedScopeMod = await import('../extension/vc-model-settings/desktop/locked-source/st/scripts/slash-commands/SlashCommandScope.js');
const lockedClosureMod = await import('../extension/vc-model-settings/desktop/locked-source/st/scripts/slash-commands/SlashCommandClosure.js');
const lockedAbortMod = await import('../extension/vc-model-settings/desktop/locked-source/st/scripts/slash-commands/SlashCommandAbortController.js');

const slashMod = await import('../extension/vc-model-settings/desktop/standalone/cards/helper-slash.js');
const utilMod = await import('../extension/vc-model-settings/desktop/standalone/cards/helper-util.js');
const portsMod = await import('../extension/vc-model-settings/desktop/standalone/engine/ports.js');
const { bindEngineContext, event_types } = portsMod;
const { bindCardHost } = await import('../extension/vc-model-settings/desktop/standalone/cards/ejs-host.js');

function createSlashFixture({ initialChat = [], ejsCommands = null, chatId = 'chat-t14-1' } = {}) {
    const lifecycle = [];
    const emittedEvents = [];
    const listeners = new Map();
    let f2SaveCount = 0;
    let settingsSaveCount = 0;
    let normalGenerateSendCount = 0;
    let switchSessionDuringMutate = null;
    let beforeMutateSettleHook = null;
    let hasActiveParentJob = false;

    const chat = initialChat.map((m, i) => ({
        mes: m.mes ?? '',
        name: m.name ?? (m.is_user ? 'Alice' : 'Seraphina'),
        is_user: Boolean(m.is_user),
        is_system: Boolean(m.is_system),
        extra: { ...(m.extra ?? {}) },
        send_date: m.send_date ?? `2026-11-04T00:00:0${i}.000Z`,
        swipes: Array.isArray(m.swipes) ? [...m.swipes] : [m.mes ?? ''],
        swipe_id: m.swipe_id ?? 0,
    }));

    const chatMetadata = { variables: {} };
    const extensionPrompts = {};
    const extensionSettings = { variables: { global: {} } };
    const settings = {
        power_user: {
            experimental_macro_engine: true,
            stscript: {
                matching: 'fuzzy',
                parser: { flags: {} },
            },
        },
        extension_settings: extensionSettings,
        oai_settings: {
            openai_max_context: 4096,
            openai_max_tokens: 512,
        },
    };
    const environment = {
        models: [],
        openrouterWebsiteModel: {},
        readInput: () => '',
        firstDisplayedMessageId: 0,
        model: 'gpt-4o',
        mobile: false,
        locale: 'zh-CN',
        extensions: [],
    };

    const eventSource = {
        on(eventName, fn) {
            const list = listeners.get(eventName) ?? [];
            list.push(fn);
            listeners.set(eventName, list);
        },
        once(eventName, fn) {
            const wrapper = async (...args) => {
                eventSource.removeListener(eventName, wrapper);
                return fn(...args);
            };
            eventSource.on(eventName, wrapper);
        },
        off(eventName, fn) {
            eventSource.removeListener(eventName, fn);
        },
        removeListener(eventName, fn) {
            const list = listeners.get(eventName);
            if (!list) return;
            const idx = list.indexOf(fn);
            if (idx >= 0) list.splice(idx, 1);
        },
        async emit(eventName, ...args) {
            emittedEvents.push({ eventName, args });
            if (
                eventName === event_types.MESSAGE_SENT ||
                eventName === event_types.MESSAGE_RECEIVED ||
                eventName === event_types.USER_MESSAGE_RENDERED ||
                eventName === event_types.CHARACTER_MESSAGE_RENDERED
            ) {
                lifecycle.push(`event:${eventName}`);
            }
            const list = listeners.get(eventName) ? [...listeners.get(eventName)] : [];
            for (const fn of list) {
                await fn(...args);
            }
        },
    };

    const context = {
        chat,
        chatMetadata,
        characters: [{ name: 'Seraphina', avatar: 'seraphina.png', data: { extensions: {} } }],
        characterId: 0,
        chatId,
        name1: 'Alice',
        name2: 'Seraphina',
        extensionPrompts,
        extensionSettings,
        eventSource,
        eventTypes: event_types,
        metadataDirty: false,
        settingsDirty: false,
        saveMetadataDebounced: () => {
            context.metadataDirty = true;
            lifecycle.push('dirty:metadata');
        },
        saveSettingsDebounced: () => {
            context.settingsDirty = true;
            lifecycle.push('dirty:settings');
        },
        async commitHelperChanges(expectedMetadata) {
            if (!expectedMetadata || expectedMetadata !== context.chatMetadata) {
                throw new Error('VC_HELPER_COMMIT_STALE');
            }
            if (hasActiveParentJob) {
                lifecycle.push('commit:deferred-to-parent-job');
                return true;
            }
            if (context.metadataDirty) {
                f2SaveCount += 1;
                context.metadataDirty = false;
                lifecycle.push('f2:commitSave');
            }
            if (context.settingsDirty) {
                settingsSaveCount += 1;
                context.settingsDirty = false;
                lifecycle.push('save:commitSettings');
            }
            return true;
        },
        async mutateChatMessages(expectedMetadata, mutateFn, options = {}) {
            if (expectedMetadata && expectedMetadata !== context.chatMetadata) {
                return false;
            }
            if (await options.beforeMutation?.() === false) {
                return false;
            }
            if (typeof beforeMutateSettleHook === 'function') {
                await beforeMutateSettleHook();
            }
            if (expectedMetadata && expectedMetadata !== context.chatMetadata) {
                return false;
            }
            if (typeof switchSessionDuringMutate === 'function') {
                switchSessionDuringMutate();
            }
            if (await options.beforeMutation?.() === false) {
                return false;
            }
            lifecycle.push('mutate:start');
            await mutateFn(context.chat);
            lifecycle.push('structure:mutated');

            lifecycle.push('surface:refresh');

            if (typeof options.afterRefresh === 'function') {
                await options.afterRefresh();
            }

            f2SaveCount += 1;
            context.metadataDirty = false;
            lifecycle.push('f2:mutateSave');
            return true;
        },
    };

    const session = {
        getCurrent: () => ({ context, ready: true }),
        getContext: () => context,
        send: async () => {
            normalGenerateSendCount += 1;
            throw new Error('Normal session.send generation must never be triggered by slash /send');
        },
    };

    const activate = () => {
        bindEngineContext(context, settings, environment);
        bindCardHost({
            context,
            settings,
            packet: { world_names: [] },
            presets: {},
            ejs: ejsCommands ? { commands: ejsCommands } : undefined,
            emit(eventName, payload) {
                emittedEvents.push({ eventName, args: [payload] });
            },
        });
    };

    activate();

    if (portsMod.power_user?.stscript?.parser?.flags) {
        for (const k of Object.keys(portsMod.power_user.stscript.parser.flags)) {
            delete portsMod.power_user.stscript.parser.flags[k];
        }
    }

    return {
        chat,
        chatMetadata,
        extensionPrompts,
        extensionSettings,
        context,
        session,
        eventSource,
        lifecycle,
        emittedEvents,
        activate,
        getF2SaveCount: () => f2SaveCount,
        getSettingsSaveCount: () => settingsSaveCount,
        getNormalGenerateSendCount: () => normalGenerateSendCount,
        setSwitchSessionHook: (fn) => {
            switchSessionDuringMutate = fn;
        },
        setBeforeMutateSettleHook: (fn) => {
            beforeMutateSettleHook = fn;
        },
        setActiveParentJob: (active) => {
            hasActiveParentJob = Boolean(active);
        },
    };
}

test('T14-1: re-exports locked ST SlashCommandParser, Scope, Closure, and AbortController with unified static registry', () => {
    assert.equal(slashMod.SlashCommandParser, lockedParserMod.SlashCommandParser);
    assert.equal(slashMod.SlashCommandScope, lockedScopeMod.SlashCommandScope);
    assert.equal(slashMod.SlashCommandClosure, lockedClosureMod.SlashCommandClosure);
    assert.equal(slashMod.SlashCommandAbortController, lockedAbortMod.SlashCommandAbortController);
    assert.equal(slashMod.PARSER_FLAG, lockedParserMod.PARSER_FLAG);
    assert.equal(globalThis.onboardingExperimentalMacroEngine, undefined);

    // Must use the locked static object registry on SlashCommandParser.commands
    assert.equal(typeof slashMod.SlashCommandParser.commands, 'object');
    assert.equal(slashMod.SlashCommandParser.commands instanceof Map, false);
    assert.ok(slashMod.SlashCommandParser.commands['pass']);
    assert.ok(slashMod.SlashCommandParser.commands['return']);
    assert.ok(slashMod.SlashCommandParser.commands['parser-flag']);
    assert.ok(slashMod.SlashCommandParser.commands['break']);
});

test('T14-2: /pass and /return alias both pass value down pipeline without premature break', async () => {
    createSlashFixture();

    const resPass = await slashMod.executeSlashCommandsWithOptions('/pass alpha | /pass {{pipe}}-beta');
    assert.equal(resPass.isError, false);
    assert.equal(resPass.pipe, 'alpha-beta');

    // /return is an alias of /pass in ST and MUST continue the pipeline
    const resReturn = await slashMod.executeSlashCommandsWithOptions('/return first | /pass {{pipe}}-second | /return {{pipe}}-third');
    assert.equal(resReturn.isError, false);
    assert.equal(resReturn.pipe, 'first-second-third');
});

test('T14-3: real closures, immediate closure {: ... :}(), /let closure, /run and /:name shorthand', async () => {
    createSlashFixture();

    // Immediate closure execution
    const imm = await slashMod.executeSlashCommandsWithOptions('/pass {: /pass inner :}()');
    assert.equal(imm.isError, false);
    assert.equal(imm.pipe, 'inner');

    // Immediate closure inside pipeline
    const immPipe = await slashMod.executeSlashCommandsWithOptions('/pass {: /return 21 | /mul {{pipe}} 2 :}()');
    assert.equal(immPipe.isError, false);
    assert.equal(immPipe.pipe, '42');

    // Named closure with default argument and /run + /: shorthand
    const runRes = await slashMod.executeSlashCommandsWithOptions(
        '/let greet {: who=world /pass hello-{{var::who}} :} || /run who=alice greet | /pass {{pipe}}! || /:greet who=bob | /pass {{pipe}}?',
    );
    assert.equal(runRes.isError, false);
    assert.equal(runRes.pipe, 'hello-bob?');
});

test('T14-4: /let and /var support key=, index=, as=number, and scoped {{var::...}} macro expansion', async () => {
    createSlashFixture();

    const res = await slashMod.executeSlashCommandsWithOptions(
        '/let items ["10","20"] || /var index=1 as=number items 35 || /var index=1 items | /add {{pipe}} 5',
    );
    assert.equal(res.isError, false);
    assert.equal(res.pipe, '40');

    const resNamedKey = await slashMod.executeSlashCommandsWithOptions(
        '/let key=bag {} || /var key=bag index=coins as=number 99 || /pass {{var::bag::coins}}',
    );
    assert.equal(resNamedKey.isError, false);
    assert.equal(resNamedKey.pipe, '99');
});

test('T14-5: local and global variable commands mutate state and settle persistence via Session boundary', async () => {
    const fx = createSlashFixture();

    const localOut = await slashMod.triggerSlash(
        '/setvar key=score 10 || /addvar key=score 5 || /incvar score || /decvar score || /decvar score || /getvar score',
    );
    assert.equal(localOut, '14');
    assert.equal(fx.chatMetadata.variables.score, 14);
    // Settled once at end of command execution via commitHelperChanges
    assert.equal(fx.getF2SaveCount(), 1);
    assert.equal(fx.context.metadataDirty, false);

    const flushLocal = await slashMod.triggerSlash('/flushvar score || /getvar score');
    assert.equal(flushLocal, '');
    assert.equal(fx.chatMetadata.variables.score, undefined);
    assert.equal(fx.getF2SaveCount(), 2);

    const globalOut = await slashMod.triggerSlash(
        '/setglobalvar key=theme 2 || /addglobalvar key=theme 3 || /incglobalvar theme || /decglobalvar theme || /getglobalvar theme',
    );
    assert.equal(globalOut, '5');
    assert.equal(fx.extensionSettings.variables.global.theme, 5);
    assert.equal(fx.getSettingsSaveCount(), 1);
    assert.equal(fx.context.settingsDirty, false);

    await slashMod.triggerSlash('/flushglobalvar theme');
    assert.equal(fx.extensionSettings.variables.global.theme, undefined);
    assert.equal(fx.getSettingsSaveCount(), 2);

    // When a parent job owns the round, commitHelperChanges defers final save to parent owner
    fx.setActiveParentJob(true);
    await slashMod.triggerSlash('/setvar key=deferred 42');
    assert.equal(fx.chatMetadata.variables.deferred, '42');
    assert.equal(fx.getF2SaveCount(), 2);
    assert.equal(fx.context.metadataDirty, true);
    fx.setActiveParentJob(false);

    // Missing commitHelperChanges port must explicitly fail (no silent fallback)
    const savedCommitPort = fx.context.commitHelperChanges;
    delete fx.context.commitHelperChanges;
    await assert.rejects(() => slashMod.triggerSlash('/setvar key=fail_no_port 1'));
    fx.context.commitHelperChanges = savedCommitPort;

    // Stale context / metadata mismatch must explicitly fail (never silently return success)
    fx.context.chatMetadata = { variables: {} };
    await assert.rejects(() => slashMod.triggerSlash('/pass stale-check'));
});

test('T14-6: /echo rawQuotes=true by default and STRICT_ESCAPING (flag 1) + raw=false unquotes and preserves quoted ||', async () => {
    createSlashFixture();

    // Default /echo has rawQuotes=true: quotes are preserved and || splits the pipeline
    const rawDefault = await slashMod.executeSlashCommandsWithOptions('/echo "hello"');
    assert.equal(rawDefault.isError, false);
    assert.equal(rawDefault.pipe, '"hello"');

    const rawSplit = await slashMod.executeSlashCommandsWithOptions('/echo "left || /pass right"');
    assert.equal(rawSplit.isError, false);
    assert.equal(rawSplit.pipe, 'right"');

    // With numeric flag 1 (STRICT_ESCAPING) enabled in power_user.stscript.parser.flags and raw=false:
    // quotes are unquoted and quoted || does NOT split commands
    portsMod.power_user.stscript.parser.flags[1] = true;
    const strictQuoted = await slashMod.executeSlashCommandsWithOptions('/echo raw=false "a || b" | /pass [{{pipe}}]');
    assert.equal(strictQuoted.isError, false);
    assert.equal(strictQuoted.pipe, '[a || b]');

    // Also works when passed via options.parserFlags
    delete portsMod.power_user.stscript.parser.flags[1];
    const strictViaOption = await slashMod.executeSlashCommandsWithOptions(
        '/echo raw=false "x || y" | /pass ({{pipe}})',
        { parserFlags: { [slashMod.PARSER_FLAG.STRICT_ESCAPING]: true } },
    );
    assert.equal(strictViaOption.isError, false);
    assert.equal(strictViaOption.pipe, '(x || y)');
});

test('T14-7: /break, /abort quiet=, SlashCommandAbortController, and nested break controllers work properly', async () => {
    createSlashFixture();

    // /break inside nested /run closure breaks only the inner closure with value override, then continues outer pipeline
    const breakRes = await slashMod.executeSlashCommandsWithOptions(
        '/let step {: /pass before-break || /break reached-break || /pass unreachable :} || /run step | /pass result:{{pipe}}',
    );
    assert.equal(breakRes.isError, false);
    assert.equal(breakRes.isAborted, false);
    assert.equal(breakRes.pipe, 'result:reached-break');

    // /abort stops the entire pipeline and records abortReason + isQuiet
    const abortRes = await slashMod.executeSlashCommandsWithOptions(
        '/pass start || /abort quiet=true stop-now || /pass unreachable',
    );
    assert.equal(abortRes.isAborted, true);
    assert.equal(abortRes.isQuiet, true);
    assert.equal(abortRes.abortReason, 'stop-now');

    // External SlashCommandAbortController pause/continue/abort
    const ac = new slashMod.SlashCommandAbortController();
    ac.pause();
    assert.equal(ac.signal.paused, true);
    ac.continue();
    assert.equal(ac.signal.paused, false);
    ac.abort('user-cancelled', true);
    const extAbortRes = await slashMod.executeSlashCommandsWithOptions('/pass should-not-run', {
        abortController: ac,
    });
    assert.equal(extAbortRes.isAborted, true);

    // Native AbortController / AbortSignal must be explicitly rejected, not silently ignored
    const nativeAc = new AbortController();
    await assert.rejects(
        () => slashMod.executeSlashCommandsWithOptions('/pass ok', { abortController: nativeAc.signal }),
        /SlashCommandAbortController|AbortSignal/i,
    );
    await assert.rejects(
        () => slashMod.executeSlashCommandsWithOptions('/pass ok', { signal: nativeAc.signal }),
        /SlashCommandAbortController|AbortSignal/i,
    );
});

test('T14-8: EJS desktopCommands registration and EJS execute (.pipe) integration', async () => {
    const fx = createSlashFixture({
        ejsCommands: {
            ejs: (args, code) => `EJS_OUT(${args.ctx ?? 'no-ctx'},${args.block ?? 'no-block'}:${code})`,
            'ejs-refresh': () => 'REFRESHED',
        },
    });
    void fx;

    const ejsRes = await slashMod.executeSlashCommandsWithOptions('/ejs ctx=myctx block=true 1+1 | /pass {{pipe}}!');
    assert.equal(ejsRes.isError, false);
    assert.equal(ejsRes.pipe, 'EJS_OUT(myctx,true:1+1)!');

    const refreshRes = await slashMod.executeSlashCommandsWithOptions('/ejs-refresh');
    assert.equal(refreshRes.isError, false);
    assert.equal(refreshRes.pipe, 'REFRESHED');
});

test('T14-9: unknown commands, unsupported options, and unsupported UI capabilities explicitly fail', async () => {
    const fx = createSlashFixture({
        initialChat: [{ mes: 'existing', is_user: true }],
    });

    // Unknown / unmounted commands (including /help, /while, /times, /if, /delay, /pow, /max, /min) explicitly fail
    for (const unmountedCmd of ['totally_unknown_cmd 123', 'help', 'while left=1 right=1 {: /pass 1 :}', 'times 2 {: /pass 1 :}', 'if left=1 right=1 {: /pass 1 :}', 'delay 1', 'pow 2 3', 'max 1 2', 'min 1 2']) {
        const res = await slashMod.executeSlashCommandsWithOptions(`/${unmountedCmd}`);
        assert.equal(res.isError, true, `Expected /${unmountedCmd} to fail as unknown command`);
    }
    await assert.rejects(() => slashMod.triggerSlash('/totally_unknown_cmd 123'));

    // Debugger option or /breakpoint command explicitly fails
    await assert.rejects(
        () => slashMod.executeSlashCommandsWithOptions('/pass ok', { debugController: {} }),
        /debugger|not supported/i,
    );
    const bpRes = await slashMod.executeSlashCommandsWithOptions('/breakpoint || /pass ok');
    assert.equal(bpRes.isError, true);

    // QuickReply fallback in /run explicitly fails
    const qrRes = await slashMod.executeSlashCommandsWithOptions('/run non_existent_quick_reply');
    assert.equal(qrRes.isError, true);

    // /help html-help explicitly fails
    const helpRes = await slashMod.executeSlashCommandsWithOptions('/help');
    assert.equal(helpRes.isError, true);

    // Invalid scope or abortController rejects BEFORE any /send mutation
    await assert.rejects(
        () => slashMod.executeSlashCommandsWithOptions('/send should-not-send', { scope: {} }),
        /SlashCommandScope/i,
    );
    await assert.rejects(
        () => slashMod.executeSlashCommandsWithOptions('/send should-not-send', { abortController: {} }),
        /SlashCommandAbortController/i,
    );

    // Unsupported /send return modes (toast-html, console, popup-html, etc.) fail BEFORE any mutation
    for (const badReturn of ['toast-html', 'toast-text', 'console', 'popup-html', 'chat-html', 'invalid-mode']) {
        const sendBad = await slashMod.executeSlashCommandsWithOptions(`/send return=${badReturn} hello`);
        assert.equal(sendBad.isError, true, `Expected return=${badReturn} to fail`);
    }
    assert.equal(fx.chat.length, 1);
    assert.equal(fx.getF2SaveCount(), 0);
});

test('T14-10: /send upstream semantics (trim, at negative/-0/valid/invalid, return=none|pipe|object, Session/F2/CAS lifecycle)', async () => {
    const fx = createSlashFixture({
        initialChat: [
            { mes: 'm0', is_user: true },
            { mes: 'm1', is_user: false },
        ],
    });

    // 1) Default return=none returns '', trims text, appends when at omitted, follows exact F2 lifecycle
    const rNone = await slashMod.executeSlashCommandsWithOptions('/send   hello world   ');
    assert.equal(rNone.isError, false);
    assert.equal(rNone.pipe, '');
    assert.equal(fx.chat.length, 3);
    assert.equal(fx.chat[2].mes, 'hello world');
    assert.deepEqual(fx.lifecycle, [
        'mutate:start',
        `event:${event_types.MESSAGE_SENT}`,
        'structure:mutated',
        'surface:refresh',
        `event:${event_types.USER_MESSAGE_RENDERED}`,
        'f2:mutateSave',
    ]);
    assert.equal(fx.getF2SaveCount(), 1);
    assert.equal(fx.getNormalGenerateSendCount(), 0);

    // 2) at=-0 appends at current chat.length (3), return=pipe returns inserted mes
    const rNegZero = await slashMod.executeSlashCommandsWithOptions('/send at=-0 return=pipe   tail-msg  ');
    assert.equal(rNegZero.isError, false);
    assert.equal(rNegZero.pipe, 'tail-msg');
    assert.equal(fx.chat.length, 4);
    assert.equal(fx.chat[3].mes, 'tail-msg');

    // 3) at=-1 inserts at chat.length - 1 (index 3, before 'tail-msg')
    const rNegOne = await slashMod.executeSlashCommandsWithOptions('/send at=-1 return=pipe before-tail');
    assert.equal(rNegOne.isError, false);
    assert.equal(rNegOne.pipe, 'before-tail');
    assert.equal(fx.chat.length, 5);
    assert.equal(fx.chat[3].mes, 'before-tail');
    assert.equal(fx.chat[4].mes, 'tail-msg');

    // 4) at=0 inserts at beginning, return=object returns JSON.stringify(createdMessage)
    const rObj = await slashMod.executeSlashCommandsWithOptions('/send at=0 name=Bob return=object first-msg');
    assert.equal(rObj.isError, false);
    const parsedObj = JSON.parse(rObj.pipe);
    assert.equal(parsedObj.mes, 'first-msg');
    assert.equal(parsedObj.name, 'Bob');
    assert.equal(parsedObj.is_user, true);
    assert.equal(fx.chat[0].mes, 'first-msg');

    // 5) Out-of-bounds or invalid at appends at end
    const rOut = await slashMod.executeSlashCommandsWithOptions('/send at=999 return=pipe appended-999');
    assert.equal(rOut.isError, false);
    assert.equal(rOut.pipe, 'appended-999');
    assert.equal(fx.chat[fx.chat.length - 1].mes, 'appended-999');

    const rNegOut = await slashMod.executeSlashCommandsWithOptions('/send at=-999 return=pipe appended-neg999');
    assert.equal(rNegOut.isError, false);
    assert.equal(rNegOut.pipe, 'appended-neg999');
    assert.equal(fx.chat[fx.chat.length - 1].mes, 'appended-neg999');

    // 6) Guard against session switch during /send mutation
    fx.setSwitchSessionHook(() => {
        fx.context.chatId = 'switched-chat-id';
    });
    const rSwitched = await slashMod.executeSlashCommandsWithOptions('/send return=object should-fail-on-switch');
    assert.equal(rSwitched.isError, true);
});

test('T14-11: diagnostics and error handling never leak raw script, arguments, or error.message to console', async () => {
    createSlashFixture();
    const consoleLogs = [];
    const origError = console.error;
    const origWarn = console.warn;
    console.error = (...args) => consoleLogs.push(args.join(' '));
    console.warn = (...args) => consoleLogs.push(args.join(' '));

    try {
        const secretToken = 'SECRET_USER_PROMPT_987654321';
        const res = await slashMod.executeSlashCommandsWithOptions(`/unknown_cmd_xyz ${secretToken}`);
        assert.equal(res.isError, true);
        for (const entry of consoleLogs) {
            assert.equal(entry.includes(secretToken), false, 'Console must never include raw script or secret arguments');
        }
    } finally {
        console.error = origError;
        console.warn = origWarn;
    }
});

test('T14-12: [P1 Ownership] async session switch during /ejs prevents subsequent /send or /setvar from mutating the new session', async () => {
    let resumeEjs = null;
    const ejsEntered = new Promise((resolve) => {
        resumeEjs = resolve;
    });
    let releaseEjs = null;
    const ejsGate = new Promise((resolve) => {
        releaseEjs = resolve;
    });

    const fxA = createSlashFixture({
        chatId: 'chat-session-A',
        ejsCommands: {
            async ejs() {
                resumeEjs();
                await ejsGate;
                return 'from-a';
            },
        },
    });

    const execPromise = slashMod.executeSlashCommandsWithOptions(
        '/ejs 1 || /send wrong-session-synthetic || /setvar key=leaked bad',
    );
    await ejsEntered;

    // Switch active engine/card host to Session B while Session A's /ejs is awaiting
    const fxB = createSlashFixture({
        chatId: 'chat-session-B',
    });

    releaseEjs();
    const resA = await execPromise;

    assert.equal(resA.isError, true, 'Session A execution must fail after session switch');
    assert.equal(fxB.chat.length, 0, 'Session B must NOT receive /send message from Session A');
    assert.equal(fxB.getF2SaveCount(), 0, 'Session B must NOT have F2 save triggered by Session A');
    assert.equal(fxB.chatMetadata.variables.leaked, undefined, 'Session B variables must NOT be mutated by Session A');
    assert.equal(fxA.chat.length, 0, 'Session A must also not mutate after losing active ownership');
});

test('T14-13: [P1 Concurrency] independent execution B commits its own F2 save while execution A is suspended in /ejs', async () => {
    let notifyEjsStarted = null;
    const ejsStarted = new Promise((resolve) => {
        notifyEjsStarted = resolve;
    });
    let releaseEjs = null;
    const ejsWait = new Promise((resolve) => {
        releaseEjs = resolve;
    });

    const fx = createSlashFixture({
        ejsCommands: {
            async ejs() {
                notifyEjsStarted();
                await ejsWait;
                return 'done-a';
            },
        },
    });

    const promiseA = slashMod.executeSlashCommandsWithOptions('/ejs wait');
    await ejsStarted;

    // While A is blocked in /ejs, independent top-level call B runs /setvar
    const resB = await slashMod.executeSlashCommandsWithOptions('/setvar key=concurrent yes');
    assert.equal(resB.isError, false);
    assert.equal(fx.chatMetadata.variables.concurrent, 'yes');
    assert.equal(fx.getF2SaveCount(), 1, 'Independent call B must commit F2 immediately without being treated as nested inside A');
    assert.equal(fx.context.metadataDirty, false, 'metadataDirty must be cleared after B commits');

    releaseEjs();
    const resA = await promiseA;
    assert.equal(resA.isError, false);
    assert.equal(resA.pipe, 'done-a');
});

test('T14-14: [P1 Static & Dynamic Validation] rejects prototype commands, unknown/unimplemented options, reserved _ args, and invalid parserFlags before any mutation', async () => {
    const fx = createSlashFixture();

    // 1) Prototype property command (/constructor, /toString, /valueOf) in pipeline must fail BEFORE earlier /setvar executes
    const rProto = await slashMod.executeSlashCommandsWithOptions('/setvar key=beforeProto 1 || /constructor');
    assert.equal(rProto.isError, true);
    assert.equal(fx.chatMetadata.variables.beforeProto, undefined, '/setvar before /constructor must not execute');
    assert.equal(fx.getF2SaveCount(), 0);

    // 2) Unknown named arguments & unimplemented options (/send wat=bad, /send compact=true, /echo title=x, /echo severity=warning)
    for (const badScript of [
        '/send wat=bad hello',
        '/send compact=true hello',
        '/sys compact=true hello',
        '/echo title=hi hello',
        '/echo severity=warning hello',
        '/setvar unknownopt=1 key=a val',
        '/pass _scope=evil ok',
        '/pass _abortController=evil ok',
    ]) {
        const res = await slashMod.executeSlashCommandsWithOptions(badScript);
        assert.equal(res.isError, true, `Expected ${badScript} to fail static validation`);
    }
    assert.equal(fx.chat.length, 0);
    assert.equal(fx.getF2SaveCount(), 0);

    // 3) Static invalid option values (e.g. /send return=invalid, /send at=abc, /echo raw=maybe)
    for (const badValScript of [
        '/send return=invalid hello',
        '/send at=notanumber hello',
        '/echo raw=notabool hello',
        '/abort quiet=notabool bye',
        '/inject id=x position=invalid text',
        '/inject id=x role=invalid text',
    ]) {
        const res = await slashMod.executeSlashCommandsWithOptions(badValScript);
        assert.equal(res.isError, true, `Expected ${badValScript} to fail option value validation`);
    }
    assert.equal(fx.chat.length, 0);

    // 4) Dynamic invalid option value resolved from variable/macro at runtime
    await slashMod.executeSlashCommandsWithOptions('/setvar key=badret invalid_mode');
    const f2BeforeDynamic = fx.getF2SaveCount();
    const rDyn = await slashMod.executeSlashCommandsWithOptions('/send return={{getvar::badret}} should-not-insert');
    assert.equal(rDyn.isError, true);
    assert.equal(fx.chat.length, 0, 'Dynamic invalid return= must fail before inserting message');
    assert.equal(fx.getF2SaveCount(), f2BeforeDynamic);

    // 5) Unknown parserFlags option key and unknown /parser-flag command argument
    const rBadFlagsOpt = await slashMod.executeSlashCommandsWithOptions('/setvar key=flagWrite 1', {
        parserFlags: { UNKNOWN_FLAG_XYZ: true },
    });
    assert.equal(rBadFlagsOpt.isError, true);
    assert.equal(fx.chatMetadata.variables.flagWrite, undefined);
    await assert.rejects(
        () => slashMod.triggerSlash('/pass ok', {
            parserFlags: { UNKNOWN_FLAG_XYZ: true },
        }),
        /Slash command parse error/,
    );
    const rBadFlagCmd = await slashMod.executeSlashCommandsWithOptions('/parser-flag NOT_A_FLAG on');
    assert.equal(rBadFlagCmd.isError, true);
    const rBadFlagState = await slashMod.executeSlashCommandsWithOptions('/parser-flag STRICT_ESCAPING maybe');
    assert.equal(rBadFlagState.isError, true);
});

test('T14-15: [P1 Cancellation] abort at the mutation boundary prevents insertion and save, and external scope closure propagates current abortController while keeping lexical scope', async () => {
    const fx = createSlashFixture();

    // Part A: Abort while the fixture's mutation port is waiting to apply the change.
    const ac = new slashMod.SlashCommandAbortController();
    fx.setBeforeMutateSettleHook(async () => {
        ac.abort('cancelled during settle', true);
    });

    const resAbortSettle = await slashMod.executeSlashCommandsWithOptions('/send aborted-during-settle', {
        abortController: ac,
    });
    assert.equal(resAbortSettle.isAborted, true, 'Execution aborted during settle must report isAborted: true');
    assert.equal(fx.chat.length, 0, 'Message must NOT be inserted when aborted during cards.settle');
    assert.equal(fx.getF2SaveCount(), 0, 'F2 save must NOT run when aborted during cards.settle');
    fx.setBeforeMutateSettleHook(null);

    // Part B: External scope with pre-bound closure preserves its lexical scope AND propagates the new execution's abortController
    const externalScope = new slashMod.SlashCommandScope();
    externalScope.letVariable('lexicalMsg', 'from-external-lexical-scope');

    // Parse a closure in externalScope with an old abortController
    const oldAc = new slashMod.SlashCommandAbortController();
    const parsedSub = slashMod.SlashCommandParser.prototype.parse.call(
        new slashMod.SlashCommandParser(),
        '/pass {{var::lexicalMsg}} || /send {{pipe}}',
        true,
        {},
        oldAc,
    );
    parsedSub.scope.parent = externalScope;
    externalScope.letVariable('myFunc', parsedSub);

    // Run 1: Normal execution via /run and /:myFunc reads lexical variable from externalScope
    const resRunLexical = await slashMod.executeSlashCommandsWithOptions('/run myFunc', {
        scope: externalScope,
    });
    assert.equal(resRunLexical.isError, false);
    assert.equal(fx.chat.length, 1);
    assert.equal(fx.chat[0].mes, 'from-external-lexical-scope');

    // Run 2: New abortController aborts during /send inside externalScope's closure
    const newAc = new slashMod.SlashCommandAbortController();
    fx.setBeforeMutateSettleHook(async () => {
        newAc.abort('abort-in-external-closure', true);
    });

    const resAbortedExternal = await slashMod.executeSlashCommandsWithOptions('/:myFunc', {
        scope: externalScope,
        abortController: newAc,
    });
    assert.equal(resAbortedExternal.isAborted, true, 'External closure must propagate current execution abortController');
    assert.equal(fx.chat.length, 1, 'Aborted external closure must not insert second message');
    fx.setBeforeMutateSettleHook(null);
});

test('T14-16: [P1 /send return] return=pipe and return=object succeed and reflect listener mutations when USER_MESSAGE_RENDERED rewrites mes', async () => {
    const fx = createSlashFixture();

    fx.eventSource.on(event_types.USER_MESSAGE_RENDERED, (messageId) => {
        if (fx.chat[messageId]) {
            fx.chat[messageId].mes = `${fx.chat[messageId].mes} [rewritten-by-listener]`;
        }
    });

    const resPipe = await slashMod.executeSlashCommandsWithOptions('/send return=pipe original-text');
    assert.equal(resPipe.isError, false, '/send return=pipe must not fail when USER_MESSAGE_RENDERED rewrites mes');
    assert.equal(resPipe.pipe, 'original-text [rewritten-by-listener]');

    const resObj = await slashMod.executeSlashCommandsWithOptions('/send return=object second-text');
    assert.equal(resObj.isError, false, '/send return=object must not fail when USER_MESSAGE_RENDERED rewrites mes');
    const parsed = JSON.parse(resObj.pipe);
    assert.equal(parsed.mes, 'second-text [rewritten-by-listener]');
});

test('T14-17: [P2 Helper Macro Regression] registerMacroLike expands in slash arguments without re-parsing injected pipes or commands', async () => {
    const fx = createSlashFixture();
    const macroRegex = /SYN_REGISTERED_REPLACE/g;
    const { unregister } = utilMod.registerMacroLike(macroRegex, () => 'expanded_value || /setvar key=injected 1');

    try {
        const res = await slashMod.executeSlashCommandsWithOptions('/pass SYN_REGISTERED_REPLACE');
        assert.equal(res.isError, false);
        assert.equal(res.pipe, 'expanded_value || /setvar key=injected 1');
        assert.equal(fx.chatMetadata.variables.injected, undefined, 'Macro replacement in argument must not re-parse || into a command pipeline');
    } finally {
        unregister();
    }
});

test('T14-18: [R5-1] shared external closure concurrent calls isolate nested closure/executor/controller state without mutating shared definition', async () => {
    let ejsCallCount = 0;
    let notifyAPaused = null;
    const aPaused = new Promise((resolve) => {
        notifyAPaused = resolve;
    });
    let releaseA = null;
    const holdA = new Promise((resolve) => {
        releaseA = resolve;
    });

    const fx = createSlashFixture({
        ejsCommands: {
            async ejs(_args, code) {
                if (code === 'hold') {
                    ejsCallCount += 1;
                    if (ejsCallCount === 1) {
                        notifyAPaused();
                        await holdA;
                    }
                }
                return 'held';
            },
        },
    });

    const externalScope = new slashMod.SlashCommandScope();
    externalScope.letVariable('prefix', 'nested');
    const definitionAc = new slashMod.SlashCommandAbortController();
    const sharedClosure = slashMod.SlashCommandParser.prototype.parse.call(
        new slashMod.SlashCommandParser(),
        '/ejs hold || /pass {: /setvar key=inside yes | /pass {{var::prefix}}-completed :}()',
        true,
        {},
        definitionAc,
    );
    sharedClosure.scope.parent = externalScope;
    const origNestedRef = sharedClosure.executorList[1].unnamedArgumentList[0].value;
    externalScope.letVariable('shared', sharedClosure);

    // Call A starts and pauses inside /ejs hold
    const acA = new slashMod.SlashCommandAbortController();
    const promiseA = slashMod.executeSlashCommandsWithOptions('/run shared', {
        scope: externalScope,
        abortController: acA,
    });
    await aPaused;

    // Call B executes the same shared closure on the same externalScope and completes
    const acB = new slashMod.SlashCommandAbortController();
    const resB = await slashMod.executeSlashCommandsWithOptions('/:shared', {
        scope: externalScope,
        abortController: acB,
    });
    assert.equal(resB.isError, false);
    assert.equal(resB.pipe, 'nested-completed');
    assert.equal(fx.chatMetadata.variables.inside, 'yes');

    // Reset inside variable and abort B's controller before releasing A
    delete fx.chatMetadata.variables.inside;
    acB.abort('abort-B-controller', true);

    // Release A: A must NOT be affected by B's abortController or B's execution state
    releaseA();
    const resA = await promiseA;
    assert.equal(resA.isError, false);
    assert.equal(resA.isAborted, false);
    assert.equal(resA.pipe, 'nested-completed');
    assert.equal(fx.chatMetadata.variables.inside, 'yes');

    // Shared closure definition and its nested closure AST node must remain unmutated
    assert.equal(sharedClosure.scope.parent, externalScope);
    assert.equal(sharedClosure.abortController, definitionAc);
    assert.equal(sharedClosure.breakController, undefined);
    assert.equal(sharedClosure.executorList[1].unnamedArgumentList[0].value, origNestedRef);
    assert.equal(origNestedRef.abortController, definitionAc);
    assert.equal(origNestedRef.breakController, undefined);

    // Also verify aborting an active execution of sharedClosure aborts that execution without tainting sharedClosure
    let notifyCPaused = null;
    const cPaused = new Promise((resolve) => {
        notifyCPaused = resolve;
    });
    let releaseC = null;
    const holdC = new Promise((resolve) => {
        releaseC = resolve;
    });
    const fxC = createSlashFixture({
        ejsCommands: {
            async ejs() {
                notifyCPaused();
                await holdC;
                return 'after-c';
            },
        },
    });
    const acC = new slashMod.SlashCommandAbortController();
    const promiseC = slashMod.executeSlashCommandsWithOptions('/:shared', {
        scope: externalScope,
        abortController: acC,
    });
    await cPaused;
    acC.abort('cancel-C', true);
    releaseC();
    const resC = await promiseC;
    assert.equal(resC.isAborted, true);
    assert.equal(fxC.chatMetadata.variables.inside, undefined);
});

test('T14-19: [R5-2] triggerSlashWithResult and _bind aliases match triggerSlash and return string pipe value', async () => {
    createSlashFixture();

    assert.equal(slashMod.triggerSlashWithResult, slashMod.triggerSlash);
    assert.equal(slashMod._triggerSlash, slashMod.triggerSlash);
    assert.equal(slashMod._triggerSlashWithResult, slashMod.triggerSlash);

    const out1 = await slashMod.triggerSlash('/pass alpha');
    assert.equal(out1, 'alpha');

    const out2 = await slashMod.triggerSlashWithResult('/pass alpha');
    assert.equal(out2, 'alpha');

    const out3 = await slashMod._triggerSlashWithResult('/pass beta');
    assert.equal(out3, 'beta');
});

test('T14-20: [R5-3] validateAllowedExecutionOptions rejects unknown option keys before any mutation or F2 save', async () => {
    const fx = createSlashFixture();

    await assert.rejects(
        () => slashMod.executeSlashCommandsWithOptions('/setvar key=leakedOpt 1', {
            UNKNOWN_RUN_OPTION: true,
        }),
        /Unsupported slash execution option: UNKNOWN_RUN_OPTION/,
    );
    await assert.rejects(
        () => slashMod.triggerSlash('/setvar key=leakedOpt 1', {
            UNKNOWN_RUN_OPTION: true,
        }),
        /Unsupported slash execution option: UNKNOWN_RUN_OPTION/,
    );
    assert.equal(fx.chatMetadata.variables.leakedOpt, undefined);
    assert.equal(fx.getF2SaveCount(), 0);
});

test('T14-21: [R5-4] pre-abort side effects (/setvar key=x1 1 || /abort) settle via Session commitHelperChanges while halting subsequent pipeline steps', async () => {
    const fx = createSlashFixture();

    const res = await slashMod.executeSlashCommandsWithOptions('/setvar key=x1 1 || /abort halted || /setvar key=x2 2');
    assert.equal(res.isAborted, true);
    assert.equal(res.isError, false);
    assert.equal(fx.chatMetadata.variables.x1, '1', 'Pre-abort /setvar must be preserved');
    assert.equal(fx.chatMetadata.variables.x2, undefined, 'Post-abort /setvar must not execute');
    assert.equal(fx.getF2SaveCount(), 1, 'Pre-abort dirty state must be settled via commitHelperChanges');
    assert.equal(fx.context.metadataDirty, false, 'metadataDirty must be cleared after settling pre-abort changes');
});
