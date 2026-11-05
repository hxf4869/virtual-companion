import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { Window } from 'happy-dom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ST_ROOT = path.resolve(__dirname, '..');
const UPSTREAM_PUBLIC = path.join(ST_ROOT, 'upstream', 'SillyTavern', 'public');
const EXTENSION_ROOT = path.join(ST_ROOT, 'extension', 'vc-model-settings');

const happyWindow = new Window({ url: 'http://localhost:8000/desktop/' });
Object.assign(globalThis, {
    self: globalThis,
    window: happyWindow,
    document: happyWindow.document,
    location: happyWindow.location,
    localStorage: happyWindow.localStorage,
    HTMLElement: happyWindow.HTMLElement,
    HTMLIFrameElement: happyWindow.HTMLIFrameElement,
    HTMLUnknownElement: happyWindow.HTMLUnknownElement,
    HTMLMediaElement: happyWindow.HTMLMediaElement,
    Element: happyWindow.Element,
    Node: happyWindow.Node,
    NodeFilter: happyWindow.NodeFilter,
    DOMParser: happyWindow.DOMParser,
    CustomEvent: happyWindow.CustomEvent,
    Event: happyWindow.Event,
    MutationObserver: happyWindow.MutationObserver,
    getComputedStyle: happyWindow.getComputedStyle.bind(happyWindow),
    requestAnimationFrame: cb => setTimeout(cb, 0),
});
test.after(() => happyWindow.happyDOM.close());

const lockedLib = await import('../extension/vc-model-settings/desktop/locked-source/st/lib.js');
const lockedUtils = await import('../extension/vc-model-settings/desktop/locked-source/st/scripts/utils.js');
const lockedPowerUser = await import('../extension/vc-model-settings/desktop/locked-source/st/scripts/power-user.js');
const lockedCommentName = await import('../extension/vc-model-settings/desktop/locked-source/st/scripts/comment-name.js');
const lockedShowdownUnderscore = await import('../extension/vc-model-settings/desktop/locked-source/st/scripts/showdown-underscore.js');
const lockedShowdownExclusion = await import('../extension/vc-model-settings/desktop/locked-source/st/scripts/showdown-exclusion.js');
const lockedMessageFormatter = await import('../extension/vc-model-settings/desktop/locked-source/st/scripts/message-formatter.js');
const lockedChats = await import('../extension/vc-model-settings/desktop/locked-source/st/scripts/chats.js');
const lockedFormatting = await import('../extension/vc-model-settings/desktop/locked-source/st/scripts/desktop-formatting.js');
const lockedAccountStorage = await import('../extension/vc-model-settings/desktop/locked-source/st/scripts/util/AccountStorage.js');
const { regex_placement: lockedRegexPlacement } = await import('../extension/vc-model-settings/desktop/locked-source/st/scripts/extensions/regex/engine.js');
Object.assign(globalThis, {
    $: Object.assign(() => ({ on() { return this; }, off() { return this; } }), { ui: {} }),
    jQuery: Object.assign(() => ({ on() { return this; }, off() { return this; } }), { ui: {} }),
    toastr: { info() {}, warning() {}, error() {}, success() {}, clear() {} },
    _: lockedLib.lodash,
    YAML: lockedLib.yaml,
    showdown: lockedLib.showdown,
    klona: lockedLib.klona,
});
const lockedEjs = await import('../extension/vc-model-settings/desktop/locked-source/ejs/desktop.js');

const cardsFormat = await import('../extension/vc-model-settings/desktop/standalone/cards/format.js');
const cardsMessageFormatter = await import('../extension/vc-model-settings/desktop/standalone/cards/message-formatter.js');
const cardsAccountStorage = await import('../extension/vc-model-settings/desktop/standalone/cards/account-storage.js');
const cardsKlona = await import('../extension/vc-model-settings/desktop/standalone/cards/klona.js');
const ejsHost = await import('../extension/vc-model-settings/desktop/standalone/cards/ejs-host.js');
const engineUtils = await import('../extension/vc-model-settings/desktop/standalone/engine/st/scripts/utils.js');
const { bindEngineContext } = await import('../extension/vc-model-settings/desktop/standalone/engine/ports.js');
const { openaiDefaults, powerUserDefaults } = await import('../extension/vc-model-settings/desktop/standalone/engine/defaults.js');
const { EventEmitter } = await import('../extension/vc-model-settings/desktop/standalone/engine/events.js');
const { event_types } = await import('../extension/vc-model-settings/desktop/standalone/engine/st/events.js');
const boundaryModule = await import('../scripts/lib/desktop-source-boundary.mjs');
const { isWhitelistedExtensionModule } = boundaryModule;

function extractUpstreamDeclarations(relFile, names) {
    const fullPath = path.join(UPSTREAM_PUBLIC, relFile);
    const source = fs.readFileSync(fullPath, 'utf8');
    const sf = ts.createSourceFile(relFile, source, ts.ScriptTarget.Latest, true);
    const out = [];
    for (const stmt of sf.statements) {
        const name = ts.isVariableStatement(stmt) && stmt.declarationList.declarations.length === 1
            ? stmt.declarationList.declarations[0].name.getText(sf)
            : stmt.name?.getText(sf);
        if (names.includes(name)) {
            out.push(stmt.getFullText(sf).replace(/^\s*export\s+/gm, ''));
        }
    }
    assert.equal(out.length, names.length, `Expected ${names.join(', ')} from upstream ${relFile}`);
    return out.join('\n');
}

function createUpstreamFormattingHarness(env) {
    const utilsCode = extractUpstreamDeclarations('scripts/utils.js', [
        'escapeRegex',
        'countOccurrences',
        'isOdd',
        'canUseNegativeLookbehind',
        'escapeHtml',
    ]);
    const powerUserCode = extractUpstreamDeclarations('scripts/power-user.js', ['fixMarkdown']);
    const slashCode = extractUpstreamDeclarations('scripts/slash-commands.js', ['COMMENT_NAME_DEFAULT']);
    const underscoreCode = fs.readFileSync(path.join(UPSTREAM_PUBLIC, 'scripts/showdown-underscore.js'), 'utf8')
        .replace(/^\s*export\s+/gm, '');
    const exclusionCode = fs.readFileSync(path.join(UPSTREAM_PUBLIC, 'scripts/showdown-exclusion.js'), 'utf8')
        .replace(/^\s*import\s+.*$/gm, '')
        .replace(/^\s*export\s+/gm, '');
    const chatsCode = extractUpstreamDeclarations('scripts/chats.js', [
        'encodeStyleTags',
        'decodeStyleTags',
        'getCurrentEntityId',
        'isExternalMediaAllowed',
    ]);
    const scriptCode = extractUpstreamDeclarations('script.js', [
        'mesForShowdownParse',
        'converter',
        'systemUserName',
        'reloadMarkdownProcessor',
        'messageFormatting',
    ]);

    const sandbox = {
        DOMPurify: lockedLib.DOMPurify,
        showdown: lockedLib.showdown,
        css: lockedLib.css,
        console,
        window: happyWindow,
        globalThis,
        URL,
        RegExp,
        Number,
        String,
        Object,
        Array,
         encodeURIComponent,
        decodeURIComponent,
        ...env,
    };
    vm.createContext(sandbox);
    vm.runInContext(
        [
            utilsCode,
            powerUserCode,
            slashCode,
            underscoreCode,
            exclusionCode,
            chatsCode,
            scriptCode,
            'reloadMarkdownProcessor();',
        ].join('\n'),
        sandbox,
    );
    return sandbox;
}

test('R4-Formatter 1: generated locked-source modules and cards/* facades share exact export identity and delete obsolete local files/aliases', () => {
    assert.equal(cardsKlona.klona, lockedLib.klona, 'cards/klona.js must re-export locked-source/st/lib.js klona');
    assert.equal(
        cardsMessageFormatter.MessageFormatter,
        lockedMessageFormatter.MessageFormatter,
        'cards/message-formatter.js must re-export locked-source MessageFormatter singleton',
    );
    assert.equal(
        cardsFormat.MessageFormatter,
        lockedMessageFormatter.MessageFormatter,
        'cards/format.js must re-export locked-source MessageFormatter singleton',
    );
    assert.equal(
        ejsHost.MessageFormatter,
        lockedMessageFormatter.MessageFormatter,
        'cards/ejs-host.js must re-export locked-source MessageFormatter singleton',
    );
    assert.equal(
        cardsFormat.messageFormatting,
        lockedFormatting.messageFormatting,
        'cards/format.js must re-export locked-source messageFormatting',
    );
    assert.equal(
        cardsFormat.reloadMarkdownProcessor,
        lockedFormatting.reloadMarkdownProcessor,
        'cards/format.js must re-export locked-source reloadMarkdownProcessor',
    );
    assert.equal(
        cardsFormat.encodeStyleTags,
        lockedChats.encodeStyleTags,
        'cards/format.js must re-export locked-source encodeStyleTags',
    );
    assert.equal(
        cardsFormat.decodeStyleTags,
        lockedChats.decodeStyleTags,
        'cards/format.js must re-export locked-source decodeStyleTags',
    );
    assert.equal(
        cardsAccountStorage.accountStorage,
        lockedAccountStorage.accountStorage,
        'cards/account-storage.js must re-export locked-source accountStorage singleton',
    );
    assert.equal(
        cardsAccountStorage.AccountStorage,
        lockedAccountStorage.AccountStorage,
        'cards/account-storage.js must re-export locked-source AccountStorage class',
    );
    assert.equal(
        engineUtils.canUseNegativeLookbehind,
        lockedUtils.canUseNegativeLookbehind,
        'engine/st/scripts/utils.js must re-export locked-source canUseNegativeLookbehind',
    );
    assert.equal(
        engineUtils.escapeHtml,
        lockedUtils.escapeHtml,
        'engine/st/scripts/utils.js must re-export locked-source escapeHtml',
    );

    assert.equal(
        fs.existsSync(path.join(EXTENSION_ROOT, 'desktop/standalone/cards/showdown-exclusion.js')),
        false,
        'local cards/showdown-exclusion.js must be deleted',
    );
    assert.equal(
        fs.existsSync(path.join(EXTENSION_ROOT, 'desktop/standalone/cards/showdown-underscore.js')),
        false,
        'local cards/showdown-underscore.js must be deleted',
    );
    assert.equal(isWhitelistedExtensionModule('desktop/standalone/cards/showdown-exclusion.js'), false);
    assert.equal(isWhitelistedExtensionModule('desktop/standalone/cards/showdown-underscore.js'), false);
    assert.equal(isWhitelistedExtensionModule('desktop/locked-source/st/scripts/showdown-exclusion.js'), true);
    assert.equal(isWhitelistedExtensionModule('desktop/locked-source/st/scripts/showdown-underscore.js'), true);
    assert.equal(isWhitelistedExtensionModule('desktop/locked-source/st/scripts/desktop-formatting.js'), true);
    assert.equal(isWhitelistedExtensionModule('desktop/locked-source/st/scripts/chats.js'), true);
    assert.equal(isWhitelistedExtensionModule('desktop/locked-source/st/scripts/util/AccountStorage.js'), true);
    assert.equal(isWhitelistedExtensionModule('desktop/standalone/engine/slash-ports.js'), true);

    assert.equal(
        'resolveLegacyDesktopSource' in boundaryModule,
        false,
        'obsolete resolveLegacyDesktopSource alias helper must be removed from desktop-source-boundary.mjs',
    );

    assert.deepEqual(
        Object.keys(lockedEjs).sort(),
        ['default', 'exit', 'info', 'init', 'initializeDesktop'],
        'locked-source/ejs/desktop.js must expose its headless desktop entry and exports',
    );
    assert.equal(typeof lockedEjs.initializeDesktop, 'function');

    const expectedEjsHostExports = [
        'ARGUMENT_TYPE',
        'DEFAULT_DEPTH',
        'DEFAULT_WEIGHT',
        'METADATA_KEY',
        'MessageFormatter',
        'RawCharacter',
        'SlashCommand',
        'SlashCommandArgument',
        'SlashCommandNamedArgument',
        'SlashCommandParser',
        'addCopyToCodeBlocks',
        'appendMediaToMessage',
        'bindCardHost',
        'characters',
        'chat',
        'chat_metadata',
        'clearCardHost',
        'copyText',
        'enterTemplateScope',
        'eventSource',
        'event_types',
        'executeSlashCommands',
        'executeSlashCommandsWithOptions',
        'extension_prompts',
        'extension_settings',
        'getCardHost',
        'getCharaFilename',
        'getChatCompletionModel',
        'getContext',
        'getCurrentChatId',
        'getEnabledCardExtensions',
        'getGroupMembers',
        'getRegexedString',
        'getSTContext',
        'getThumbnailUrl',
        'getTokenCountAsync',
        'getUserAvatar',
        'getWorldInfoSettings',
        'groups',
        'hasExplicitCardAuthorization',
        'isCardDisplayExecutionAllowed',
        'isCardExecutionAllowed',
        'isEjsExecutionAllowed',
        'isEjsExtensionEnabled',
        'isHelperExtensionEnabled',
        'loadWorldInfo',
        'main_api',
        'messageFormatting',
        'name1',
        'name2',
        'oai_settings',
        'parseRegexFromString',
        'power_user',
        'refreshCardHost',
        'regex_placement',
        'sanitizeRenderedHtml',
        'saveChatConditional',
        'saveMetadataDebounced',
        'saveSettingsDebounced',
        'selected_group',
        'selected_world_info',
        'setExtensionPrompt',
        'substituteParams',
        'substituteParamsExtended',
        'this_chid',
        'updateMessageBlock',
        'updateReasoningUI',
        'user_avatar',
        'world_info',
        'world_info_case_sensitive',
        'world_info_logic',
        'world_info_match_whole_words',
        'world_info_max_recursion_steps',
        'world_info_position',
        'world_info_use_group_scoring',
        'world_names',
        'yaml',
    ];
    for (const exportName of expectedEjsHostExports) {
        assert.equal(exportName in ejsHost, true, `ejs-host.js must keep export ${exportName}`);
    }
});

test('R4-Formatter 2: same-input parity with locked upstream for messageFormatting, reloadMarkdownProcessor/renderMarkdown, fixMarkdown, utils, style tags, showdown extensions, and klona', () => {
    const chat = [
        { name: 'Alice', is_user: false, is_system: false, mes: 'Hello {{user}} & {{char}}', extra: {} },
        { name: 'User', is_user: true, is_system: false, mes: 'User reply', extra: {} },
        { name: 'Alice', is_user: false, is_system: false, mes: 'Narrator line', extra: { type: 'narrator' } },
    ];
    const power_user = {
        ...structuredClone(powerUserDefaults),
        experimental_macro_engine: false,
        user_prompt_bias: '[Bias {{user}}] ',
        show_user_prompt_bias: false,
        auto_fix_generated_markdown: true,
        encode_tags: false,
        allow_name2_display: false,
        markdown_escape_strings: '***,---',
        forbid_external_media: true,
        external_media_allowed_overrides: [],
        external_media_forbidden_overrides: [],
        reasoning: { prefix: '<think>', suffix: '</think>' },
    };
    const context = {
        characters: [{ avatar: 'alice.png', name: 'Alice', data: { extensions: {} } }],
        characterId: 0,
        chat,
        chatMetadata: {},
        name1: 'Bob',
        name2: 'Alice',
        eventSource: new EventEmitter(),
        eventTypes: event_types,
    };
    const settings = {
        oai_settings: { ...structuredClone(openaiDefaults) },
        power_user,
        world_info: {},
        extension_settings: { regex: [], variables: { global: {} } },
    };
    bindEngineContext(context, settings, {});

    const regexCalls = [];
    const upstreamRegexCalls = [];
    const regex_placement = lockedRegexPlacement;
    cardsAccountStorage.accountStorage.init({ __migrated: '1' });
    cardsFormat.configureFormatting({
        getRegexedString: (str, placement, options) => {
            regexCalls.push({ placement, options });
            return str.replace('REGEX_TARGET', `REGEX_OK(${placement}:${options.depth})`);
        },
        regex_placement,
        accountStorage: cardsAccountStorage.accountStorage,
        toastr: { warning() {}, info() {}, error() {}, success() {}, clear() {} },
        t: (strings, ...values) => String.raw({ raw: strings }, ...values),
    });

    const upstream = createUpstreamFormattingHarness({
        chat: structuredClone(chat),
        characters: context.characters,
        this_chid: 0,
        selected_group: null,
        power_user,
        substituteParams: (content, _name1, charOverride) =>
            String(content ?? '').replaceAll('{{user}}', 'Bob').replaceAll('{{char}}', charOverride || 'Alice'),
        MessageFormatter: {
            stage: lockedMessageFormatter.formatting_stage,
            runStage: (_stage, mes) => mes,
        },
        getRegexedString: (str, placement, options) => {
            upstreamRegexCalls.push({ placement, options: { ...options } });
            return str.replace('REGEX_TARGET', `REGEX_OK(${placement}:${options.depth})`);
        },
        regex_placement,
    });

    const samples = [
        {
            mes: '[Bias Bob] Alice: Hello _single_underscore_ and "quoted" & 「corner」\n***\n*unclosed italic\n<style>.card { color: red; background: url(https://evil.example/bg.png); }</style>',
            ch_name: 'Alice',
            isSystem: false,
            isUser: false,
            messageId: 0,
            isReasoning: false,
        },
        {
            mes: '<think>Reasoning with <angle> tags</think>\n\\begin{align*}x=1\\end{align*}\n```js\nconst a = 1 && 2;\n```\nREGEX_TARGET',
            ch_name: 'Alice',
            isSystem: false,
            isUser: false,
            messageId: 2,
            isReasoning: false,
        },
        {
            mes: 'Note markdown **bold**',
            ch_name: lockedCommentName.COMMENT_NAME_DEFAULT,
            isSystem: true,
            isUser: false,
            messageId: 1,
            isReasoning: false,
        },
        {
            mes: 'System raw **not bold**',
            ch_name: lockedFormatting.systemUserName,
            isSystem: true,
            isUser: false,
            messageId: 1,
            isReasoning: false,
        },
    ];

    for (const sample of samples) {
        const actual = cardsFormat.messageFormatting(
            sample.mes,
            sample.ch_name,
            sample.isSystem,
            sample.isUser,
            sample.messageId,
            {},
            sample.isReasoning,
        );
        const expected = upstream.messageFormatting(
            sample.mes,
            sample.ch_name,
            sample.isSystem,
            sample.isUser,
            sample.messageId,
            {},
            sample.isReasoning,
        );
        assert.equal(actual, expected, `messageFormatting parity mismatch for: ${sample.mes}`);
    }
    assert.deepEqual(regexCalls, upstreamRegexCalls);

    const mdInput = '| A | B |\n| - | - |\n| 1 | ~2~ |\n_italic_ and `code_with_underscores`';
    const upstreamConverter = upstream.reloadMarkdownProcessor();
    assert.equal(cardsFormat.renderMarkdown(mdInput), upstreamConverter.makeHtml(mdInput));
    assert.equal(lockedPowerUser.fixMarkdown('* spaced *\n"unclosed quote', true), upstream.fixMarkdown('* spaced *\n"unclosed quote', true));
    assert.equal(lockedUtils.canUseNegativeLookbehind(), upstream.canUseNegativeLookbehind());
    assert.equal(lockedUtils.escapeHtml('<tag attr="1">&\'</tag>'), upstream.escapeHtml('<tag attr="1">&\'</tag>'));
    assert.equal(
        lockedChats.decodeStyleTags(lockedChats.encodeStyleTags('<style>.btn:not(.active) { color: blue; }</style>')),
        upstream.decodeStyleTags(upstream.encodeStyleTags('<style>.btn:not(.active) { color: blue; }</style>')),
    );

    const complexObj = {
        nested: [{ a: 1, d: new Date(1700000000000), r: /abc/gi }],
        set: new Set(['x']),
        map: new Map([['k', { v: 2 }]]),
    };
    const cloned = cardsKlona.klona(complexObj);
    assert.deepEqual(cloned, complexObj);
    assert.notEqual(cloned.nested[0], complexObj.nested[0]);
});

test('R4-Formatter 3: MessageFormatter singleton identity, stage ordering, throwing hook isolation, and redacted hook error diagnostics', () => {
    const { MessageFormatter, formatting_stage, hook_order } = cardsFormat;
    assert.equal(MessageFormatter.stage, formatting_stage);
    assert.equal(MessageFormatter.order, hook_order);

    const trace = [];
    const errorLogs = [];
    const origError = console.error;
    console.error = (...args) => errorLogs.push(args.map(a => (a instanceof Error ? `${a.message}\n${a.stack || ''}` : String(a))).join(' '));

    try {
        // Use a fresh instance of the same constructor to test hook registration cleanly without polluting global hooks
        const FormatterClass = MessageFormatter.constructor;
        const localFormatter = new FormatterClass();

        localFormatter.addHook((mes) => {
            trace.push('LATE');
            return `${mes}|late`;
        }, { stage: formatting_stage.AFTER_REGEX, order: hook_order.LATE });

        localFormatter.addHook((mes) => {
            trace.push('EARLY');
            return `${mes}|early`;
        }, { stage: formatting_stage.AFTER_REGEX, order: hook_order.EARLY });

        localFormatter.addHook(() => {
            trace.push('THROWING');
            const err = new Error('Sensitive hook failure for https://secret.example/path?token=sk-12345');
            err.name = 'CustomSecretErrorName';
            throw err;
        }, { stage: formatting_stage.AFTER_REGEX, order: hook_order.NORMAL });

        const out = localFormatter.runStage(formatting_stage.AFTER_REGEX, 'start', {
            ch_name: 'Alice',
            isSystem: false,
            isUser: false,
            messageId: 0,
            isReasoning: false,
        });

        assert.deepEqual(trace, ['EARLY', 'THROWING', 'LATE'], 'throwing hook must not abort subsequent hooks in the same stage');
        assert.equal(out, 'start|early|late');
        assert.deepEqual(errorLogs, ["[MessageFormatter] Hook error at stage 'afterRegex'"]);
    } finally {
        console.error = origError;
    }
});

test('R4-Formatter 4: repeated configureFormatting / addDOMPurifyHooks does not stack duplicate DOMPurify hooks and uses active owner accountStorage/toastr/t', () => {
    const context = {
        characters: [{ avatar: 'media-owner.png', name: '角色', data: { extensions: {} } }],
        characterId: 0,
        chat: [],
        chatMetadata: {},
        name1: '用户',
        name2: '角色',
        eventSource: new EventEmitter(),
        eventTypes: event_types,
    };
    const settings = {
        oai_settings: { ...structuredClone(openaiDefaults) },
        power_user: {
            ...structuredClone(powerUserDefaults),
            experimental_macro_engine: false,
            forbid_external_media: true,
            external_media_allowed_overrides: [],
            external_media_forbidden_overrides: [],
        },
        world_info: {},
        extension_settings: { regex: [], variables: { global: {} } },
    };
    bindEngineContext(context, settings, {});

    const ownerAStorage = new cardsAccountStorage.AccountStorage();
    ownerAStorage.init({ __migrated: '1' });
    const ownerAToasts = [];
    const ownerBStorage = new cardsAccountStorage.AccountStorage();
    ownerBStorage.init({ __migrated: '1' });
    const ownerBToasts = [];

    for (let i = 0; i < 4; i++) {
        cardsFormat.configureFormatting({
            getRegexedString: s => s,
            regex_placement: {},
            accountStorage: ownerAStorage,
            toastr: {
                warning: (msg, title) => ownerAToasts.push({ msg, title }),
                clear() {},
            },
            t: (strings, ...values) => `A:${String.raw({ raw: strings }, ...values)}`,
        });
    }

    const sanitized = lockedLib.DOMPurify.sanitize('<div class="alpha">text</div>', {
        MESSAGE_SANITIZE: true,
        FORCE_BODY: true,
    });
    assert.equal(sanitized, '<div class="custom-alpha">text</div>', 'DOMPurify attribute hook must only run once');

    const warnLogs = [];
    const origWarn = console.warn;
    console.warn = (...args) => warnLogs.push(args.map(String).join(' '));
    try {
        cardsFormat.messageFormatting('<img src="https://evil.example/1.png?token=secretA">', '角色', false, false, 0);
        assert.equal(ownerAToasts.length, 1);
        assert.equal(ownerAStorage.getItem('mediaWarningShown:media-owner.png'), 'true');
        assert.equal(ownerBToasts.length, 0);

        // Switch active owner to owner B
        cardsFormat.configureFormatting({
            getRegexedString: s => s,
            regex_placement: {},
            accountStorage: ownerBStorage,
            toastr: {
                warning: (msg, title) => ownerBToasts.push({ msg, title }),
                clear() {},
            },
            t: (strings, ...values) => `B:${String.raw({ raw: strings }, ...values)}`,
        });
        cardsFormat.messageFormatting('<img src="https://evil.example/2.png?token=secretB">', '角色', false, false, 0);
        assert.equal(ownerBToasts.length, 1);
        assert.match(ownerBToasts[0].title, /^B:/);
        assert.equal(ownerBStorage.getItem('mediaWarningShown:media-owner.png'), 'true');
        assert.equal(warnLogs.every(line => line === 'External media blocked'), true);
    } finally {
        console.warn = origWarn;
    }
});

test('R4-Formatter 5: decodeStyleTags and AccountStorage redact sensitive diagnostics and preserve R1 state replacement & CAS migration semantics', async () => {
    const warnLogs = [];
    const origWarn = console.warn;
    console.warn = (...args) => warnLogs.push(args.map(String).join(' '));
    try {
        // 1. decodeStyleTags fixed 'CSS ERROR' without leaking malformed CSS content
        const encodedBadCss = cardsFormat.encodeStyleTags('<style>.secret_token_xyz { color: red </style>');
        const decodedBadCss = cardsFormat.decodeStyleTags(encodedBadCss);
        assert.equal(decodedBadCss, 'CSS ERROR');
        assert.equal(decodedBadCss.includes('secret_token_xyz'), false);

        // 2. Uninitialized AccountStorage logs fixed message without key name
        const unreadyStorage = new cardsAccountStorage.AccountStorage();
        unreadyStorage.getItem('secret_variable_key_read');
        unreadyStorage.setItem('secret_variable_key_write', '1');
        unreadyStorage.removeItem('secret_variable_key_remove');
        const joinedWarnings = warnLogs.join('\n');
        assert.equal(joinedWarnings.includes('secret_variable_key'), false, 'AccountStorage warning must not leak key name');
        assert.deepEqual(warnLogs, [
            'AccountStorage not ready (trying to read)',
            'AccountStorage not ready (trying to write)',
            'AccountStorage not ready (trying to remove)',
        ]);

        // 3. State replacement (no cross-owner merge) and CAS-confirmed localStorage migration
        localStorage.clear();
        localStorage.setItem('AlertRegex_item1', 'snap1');
        localStorage.setItem('AlertWI_item2', 'snap2');

        let syncedState = null;
        let resolvePersist;
        cardsAccountStorage.configureAccountStorage({
            saveSettingsDebounced: () => {},
            persistSettings: () => new Promise(resolve => { resolvePersist = resolve; }),
            syncState: state => { syncedState = state; },
        });

        cardsAccountStorage.accountStorage.init({ ownerKey: 'owner1' });
        assert.equal(cardsAccountStorage.accountStorage.getItem('AlertRegex_item1'), 'snap1');
        assert.equal(localStorage.getItem('AlertRegex_item1'), 'snap1', 'localStorage key must remain before persist resolves');

        // Mutate AlertWI_item2 while persist is in flight
        localStorage.setItem('AlertWI_item2', 'modified_during_save');
        resolvePersist({ ok: true });
        await new Promise(r => setTimeout(r, 10));

        assert.equal(localStorage.getItem('AlertRegex_item1'), null, 'unchanged snapshot key must be deleted after CAS success');
        assert.equal(localStorage.getItem('AlertWI_item2'), 'modified_during_save', 'mutated key must be preserved');

        // Re-init for second owner: state must replace, not merge owner1 keys
        cardsAccountStorage.configureAccountStorage({
            saveSettingsDebounced: () => {},
            persistSettings: () => Promise.resolve({ ok: false }),
            syncState: state => { syncedState = state; },
        });
        cardsAccountStorage.accountStorage.init({ owner2Key: 'owner2' });
        assert.equal(cardsAccountStorage.accountStorage.getItem('ownerKey'), null, 'must not merge previous owner state');
        assert.equal(cardsAccountStorage.accountStorage.getItem('owner2Key'), 'owner2');
        await new Promise(r => setTimeout(r, 10));
        assert.equal(localStorage.getItem('AlertWI_item2'), 'modified_during_save', 'failed persist must not delete localStorage key');
        assert.equal(syncedState?.__migrated, undefined, 'failed persist must roll back __migrated marker');
    } finally {
        console.warn = origWarn;
    }
});

test('R4-Formatter 6: generated ejs/desktop.js binds quietConsole for internal diagnostics while preserving eval/commands return values, errors, and user explicit console logs', async () => {
    const chat = [
        {
            name: 'Alice',
            is_user: false,
            is_system: false,
            mes: 'First message',
            swipe_id: 0,
            variables: [{ secret_clone_var: 'SECRET_EJS_CLONE_VAR_9911' }],
            variables_initialized: [true],
            extra: {},
        },
        {
            name: 'Alice',
            is_user: false,
            is_system: false,
            mes: 'Second message',
            swipe_id: 0,
            extra: {},
        },
    ];
    const eventSource = new EventEmitter();
    const context = {
        characters: [{ avatar: 'alice.png', name: 'Alice', data: { extensions: {} } }],
        characterId: 0,
        chat,
        chatMetadata: { variables: {} },
        chatId: 'ejs-quiet-test-chat',
        name1: 'Bob',
        name2: 'Alice',
        groups: [],
        groupId: null,
        extensionPrompts: {},
        eventSource,
        eventTypes: event_types,
        saveSettingsDebounced: () => {},
        saveMetadataDebounced: () => {},
        saveChatConditional: () => {},
    };
    const settings = {
        oai_settings: { ...structuredClone(openaiDefaults), preset_settings_openai: 'Default' },
        power_user: { ...structuredClone(powerUserDefaults), experimental_macro_engine: false },
        world_info: {},
        extension_settings: {
            regex: [],
            variables: { global: {} },
            EjsTemplate: { enabled: true, debug_enabled: true },
            tavern_helper: {
                enabled: true,
                script: { enabled: { global: true, characters: ['alice.png'], presets: [] } },
            },
        },
    };
    bindEngineContext(context, settings, {});
    const hostOwner = {
        context,
        settings,
        presets: { Default: {} },
        packet: { world_names: [] },
        client: { request: async () => ({}) },
        surface: { format() {}, codeBlocks() {}, media() {}, reasoning() {} },
        destroyed: false,
    };
    ejsHost.bindCardHost(hostOwner);

    const capturedConsole = [];
    const origConsole = {
        log: console.log,
        info: console.info,
        warn: console.warn,
        error: console.error,
        debug: console.debug,
    };
    for (const method of Object.keys(origConsole)) {
        console[method] = (...args) => {
            capturedConsole.push({
                method,
                text: args.map(a => (a instanceof Error ? `${a.message}\n${a.stack || ''}` : typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '),
            });
        };
    }

    let ejsInstance;
    try {
        ejsInstance = await lockedEjs.initializeDesktop();
        hostOwner.ejs = ejsInstance;

        // 1. Trigger variable cloning from message 0 -> message 1 (logs "[Prompt Template] clone previous message variables" in upstream)
        await eventSource.emit(event_types.MESSAGE_RECEIVED, 1, 'normal');
        assert.equal(
            chat[1].variables?.[0]?.secret_clone_var,
            'SECRET_EJS_CLONE_VAR_9911',
            'EJS must still clone previous message variables into message 1',
        );

        // 2. Normal command evaluation returns expected result and preserves explicit user script console.info
        const evalResult = await ejsInstance.commands.ejs(
            { block: 'true' },
            '(globalThis.console.info("USER_EXPLICIT_LOG_OK"), 2 + 3)',
        );
        assert.equal(evalResult, '5');

        // 3. Runtime and syntax errors in commands.ejs are still thrown (not swallowed), without leaking to console.error
        await assert.rejects(
            () => ejsInstance.commands.ejs({}, '<% throw new Error("SECRET_EJS_CMD_THROW_8822") %>'),
            /SECRET_EJS_CMD_THROW_8822/,
        );
        await assert.rejects(
            () => ejsInstance.commands.ejs({}, '<%= SECRET_EJS_SYNTAX_7733( %>'),
            SyntaxError,
        );
    } finally {
        ejsInstance?.destroy?.();
        ejsHost.clearCardHost(hostOwner);
        Object.assign(console, origConsole);
    }

    const allText = capturedConsole.map(item => item.text).join('\n');
    for (const forbidden of [
        '[Prompt Template]',
        'SECRET_EJS_CLONE_VAR_9911',
        'SECRET_EJS_CMD_THROW_8822',
        'SECRET_EJS_SYNTAX_7733',
    ]) {
        assert.equal(allText.includes(forbidden), false, `ejs/desktop.js internal diagnostic must not leak to global console: ${forbidden}`);
    }
    assert.deepEqual(capturedConsole, [{ method: 'info', text: 'USER_EXPLICIT_LOG_OK' }]);
});
