import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import { Window } from 'happy-dom';
import { applySpecToText } from '../scripts/lib/patcher.mjs';

const sourceIdentityUrl = new URL('../server-plugin/virtual-companion/lib/source-identity.js', import.meta.url).href;
const ejsHostUrl = new URL('../extension/vc-model-settings/desktop/standalone/cards/ejs-host.js', import.meta.url).href;
const ejsDistUrl = new URL('../upstream/ST-Prompt-Template/dist/index.js', import.meta.url);
const ejsDesktopVirtualUrl = `${ejsDistUrl.href}?vc-ejs-desktop`;
const ejsPatchSpec = JSON.parse(
    fs.readFileSync(new URL('../patches/ejs-desktop-runtime.json', import.meta.url), 'utf8'),
);

registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === '/lib.js' || specifier === '../../../../../lib.js') {
            return { url: 'virtual:///lib.js', shortCircuit: true };
        }
        if (specifier === '/scripts/extensions/third-party/ST-Prompt-Template/dist/desktop.js') {
            return { url: ejsDesktopVirtualUrl, shortCircuit: true };
        }
        if (specifier === '/scripts/extensions/third-party/vc-model-settings/desktop/standalone/cards/ejs-host.js') {
            return { url: ejsHostUrl, shortCircuit: true };
        }
        if (specifier === '/scripts/vc-runtime/source-identity.js') {
            return { url: sourceIdentityUrl, shortCircuit: true };
        }
        return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
        if (url === 'virtual:///lib.js') {
            return {
                format: 'module',
                shortCircuit: true,
                source: `
                    function chain(obj) {
                        let current = obj;
                        return {
                            values() {
                                current = Object.values(current || {});
                                return this;
                            },
                            map(fn) {
                                current = (current || []).map(fn);
                                return this;
                            },
                            filter(fn) {
                                current = (current || []).filter(fn);
                                return this;
                            },
                            sortBy(iteratee) {
                                const arr = [...(current || [])];
                                arr.sort((a, b) => {
                                    const va = typeof iteratee === 'function' ? iteratee(a) : iteratee ? a?.[iteratee] : a;
                                    const vb = typeof iteratee === 'function' ? iteratee(b) : iteratee ? b?.[iteratee] : b;
                                    return va < vb ? -1 : va > vb ? 1 : 0;
                                });
                                current = arr;
                                return this;
                            },
                            sortedUniq() {
                                current = [...new Set(current || [])];
                                return this;
                            },
                            set(path, val) {
                                lodash.set(current, path, val);
                                return this;
                            },
                            merge(...sources) {
                                lodash.merge(current, ...sources);
                                return this;
                            },
                            value() {
                                return current;
                            },
                        };
                    }
                    export const lodash = Object.assign(chain, {
                        get(obj, path, def) {
                            if (!obj) return def;
                            const parts = Array.isArray(path) ? path : String(path).split('.');
                            let cur = obj;
                            for (const p of parts) {
                                if (cur == null) return def;
                                cur = cur[p];
                            }
                            return cur === undefined ? def : cur;
                        },
                        set(obj, path, value) {
                            const parts = Array.isArray(path) ? path : String(path).split('.');
                            let cur = obj;
                            for (let i = 0; i < parts.length - 1; i++) {
                                const p = parts[i];
                                if (cur[p] == null || typeof cur[p] !== 'object') cur[p] = {};
                                cur = cur[p];
                            }
                            cur[parts[parts.length - 1]] = value;
                            return obj;
                        },
                        unset(obj, path) {
                            if (!obj) return true;
                            const parts = Array.isArray(path) ? path : String(path).split('.');
                            let cur = obj;
                            for (let i = 0; i < parts.length - 1; i++) {
                                if (cur == null) return true;
                                cur = cur[parts[i]];
                            }
                            if (cur != null) delete cur[parts[parts.length - 1]];
                            return true;
                        },
                        has(obj, key) {
                            return Boolean(obj && key in obj);
                        },
                        pick(obj, keys) {
                            const out = {};
                            for (const k of keys) if (obj && k in obj) out[k] = obj[k];
                            return out;
                        },
                        omit(obj, keys) {
                            const set = new Set(Array.isArray(keys) ? keys : [keys]);
                            const out = {};
                            for (const [k, v] of Object.entries(obj || {})) if (!set.has(k)) out[k] = v;
                            return out;
                        },
                        omitBy(obj, predicate) {
                            const out = {};
                            for (const [k, v] of Object.entries(obj || {})) {
                                if (!predicate(v, k)) out[k] = v;
                            }
                            return out;
                        },
                        isEqual(a, b) {
                            return JSON.stringify(a) === JSON.stringify(b);
                        },
                        cloneDeep(v) {
                            return structuredClone(v);
                        },
                        defaults(target, ...sources) {
                            for (const src of sources) {
                                for (const [k, v] of Object.entries(src || {})) {
                                    if (target[k] === undefined) target[k] = v;
                                }
                            }
                            return target;
                        },
                        merge(target, ...sources) {
                            for (const src of sources) {
                                if (!src || typeof src !== 'object') continue;
                                for (const [k, v] of Object.entries(src)) {
                                    if (v && typeof v === 'object' && !Array.isArray(v) && typeof v !== 'function' && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) {
                                        lodash.merge(target[k], v);
                                    } else {
                                        target[k] = v;
                                    }
                                }
                            }
                            return target;
                        },
                        mergeWith(target, src, customizer) {
                            return lodash.merge(target, src);
                        },
                        isPlainObject(v) {
                            return Boolean(v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype);
                        },
                        isArray: Array.isArray,
                        castArray: v => (Array.isArray(v) ? v : v === undefined ? [] : [v]),
                        isFunction: v => typeof v === 'function',
                        entries: obj => Object.entries(obj || {}),
                        clamp: (n, min, max) => Math.min(Math.max(n, min), max),
                        inRange: (n, start, end) => n >= start && n < end,
                        debounce: fn => fn,
                        max: arr => (Array.isArray(arr) && arr.length ? Math.max(...arr) : undefined),
                        min: arr => (Array.isArray(arr) && arr.length ? Math.min(...arr) : undefined),
                        range: (start, end) => {
                            if (end === undefined) { end = start; start = 0; }
                            const out = [];
                            for (let i = start; i < end; i++) out.push(i);
                            return out;
                        },
                        remove(arr, predicate) {
                            const removed = [];
                            for (let i = arr.length - 1; i >= 0; i--) {
                                const match = typeof predicate === 'function'
                                    ? predicate(arr[i], i, arr)
                                    : Object.entries(predicate || {}).every(([k, v]) => arr[i]?.[k] === v);
                                if (match) {
                                    removed.unshift(...arr.splice(i, 1));
                                }
                            }
                            return removed;
                        },
                        pullAt(arr, indexes) {
                            const sorted = [...indexes].sort((a, b) => b - a);
                            const pulled = [];
                            for (const idx of sorted) {
                                if (idx >= 0 && idx < arr.length) {
                                    pulled.unshift(...arr.splice(idx, 1));
                                }
                            }
                            return pulled;
                        },
                        random: (min = 0, max = 1) => Math.floor((min + max) / 2),
                        toString: v => (v == null ? '' : String(v)),
                    });
                    export const yaml = { parse: JSON.parse, stringify: JSON.stringify };
                    export const showdown = {
                        Converter: class {
                            constructor(options = {}) {
                                this.options = options;
                                this.extensions = [...(options.extensions || [])].flatMap(ext => typeof ext === 'function' ? ext() : ext);
                            }
                            addExtension(ext) {
                                const list = typeof ext === 'function' ? ext() : Array.isArray(ext) ? ext : [ext];
                                this.extensions.push(...list);
                            }
                            makeHtml(t) {
                                let s = String(t ?? '');
                                if (s.includes('html>')) {
                                    const escaped = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                                    return '<pre><code>' + escaped + '</code></pre>';
                                }
                                for (const ext of this.extensions) {
                                    if (ext?.type === 'lang' && typeof ext.filter === 'function') {
                                        s = ext.filter(s, this, this.options);
                                    }
                                }
                                s = s.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
                                if (this.options.strikethrough) {
                                    s = s.replace(/~~(.+?)~~/g, '<del>$1</del>');
                                }
                                if (this.options.tables && /^\\|.+\\|\\r?\\n\\|[-:| ]+\\|/m.test(s)) {
                                    s = '<table>' + s + '</table>';
                                }
                                if (this.options.simpleLineBreaks) {
                                    s = s.replace(/([^>])\\n(?!\\n)/g, '$1<br>\\n');
                                }
                                for (const ext of this.extensions) {
                                    if (ext?.type === 'output' && typeof ext.filter === 'function') {
                                        s = ext.filter(s, this, this.options);
                                    }
                                }
                                return s;
                            }
                        },
                    };
                    export const hljs = { highlightElement() {} };
                    export const DOMPurify = { sanitize: s => String(s ?? ''), addHook() {} };
                    export const css = { parse() { return {}; }, stringify() { return ''; } };
                    export const chevrotain = { createToken: cfg => ({ ...cfg, name: cfg?.name }), Lexer: class { static SKIPPED = 'SKIPPED'; }, CstParser: class { RULE(n, fn) { return fn; } performSelfAnalysis() {} } };
                    export const moment = () => ({ format: () => '', valueOf: () => 0 });
                    export const seedrandom = () => () => 0.5;
                    export const droll = { roll: () => ({ total: 1 }) };
                    export const Handlebars = { compile: () => () => '' };
                    export const Bowser = { getParser: () => ({ getBrowserName: () => 'Chrome' }) };
                `,
            };
        }
        if (url === ejsDesktopVirtualUrl) {
            const raw = fs.readFileSync(ejsDistUrl, 'utf8');
            return {
                format: 'module',
                shortCircuit: true,
                source: applySpecToText(raw, ejsPatchSpec).output,
            };
        }
        return nextLoad(url, context);
    },
});

const happyWindow = new Window({ url: 'http://localhost:8000/desktop/' });
const wrapJqNodes = nodes => Object.assign(nodes, {
    on() { return this; },
    off() { return this; },
    triggerHandler: async () => {},
    find: sel => wrapJqNodes(nodes.flatMap(n => [...(n.querySelectorAll?.(sel) || [])])),
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
const jQueryFn = selector => {
    if (typeof selector === 'string') {
        return wrapJqNodes([...happyWindow.document.querySelectorAll(selector)]);
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

const { lodash } = await import('/lib.js');
Object.assign(globalThis, {
    self: globalThis,
    window: happyWindow,
    document: happyWindow.document,
    location: happyWindow.location,
    localStorage: happyWindow.localStorage,
    HTMLElement: happyWindow.HTMLElement,
    DOMParser: happyWindow.DOMParser,
    CustomEvent: happyWindow.CustomEvent,
    Event: happyWindow.Event,
    EventTarget: happyWindow.EventTarget,
    MutationObserver: happyWindow.MutationObserver,
    getComputedStyle: happyWindow.getComputedStyle.bind(happyWindow),
    requestAnimationFrame: cb => setTimeout(cb, 0),
    jQuery: jQueryFn,
    $: jQueryFn,
    _: lodash,
    toastr: { info() {}, warning() {}, error() {}, success() {} },
    fetch: async url => {
        if (String(url).includes('/version')) {
            return new Response(JSON.stringify({ pkgVersion: '1.13.0' }), { status: 200 });
        }
        return new Response('', { status: 200 });
    },
});
test.after(() => happyWindow.happyDOM.close());

const { EventEmitter } = await import('../extension/vc-model-settings/desktop/standalone/engine/events.js');
const { event_types } = await import('../extension/vc-model-settings/desktop/standalone/engine/st/events.js');
const { bindEngineContext } = await import('../extension/vc-model-settings/desktop/standalone/engine/ports.js');
const { openaiDefaults, powerUserDefaults } = await import('../extension/vc-model-settings/desktop/standalone/engine/defaults.js');
const { initializeCards } = await import('../extension/vc-model-settings/desktop/standalone/cards/index.js');
const { createDesktopSession } = await import('../extension/vc-model-settings/desktop/standalone/session.js');
const { prepareSourceIdentities } = await import('../server-plugin/virtual-companion/lib/source-identity.js');
const { documentEqual, documentValue, applyDocumentValues } = await import('../extension/vc-model-settings/settings-documents.js');

function createFixture() {
    const worldStore = {
        测试世界书: {
            entries: {
                0: {
                    uid: 0,
                    key: ['关键词A'],
                    keysecondary: [],
                    comment: '初始条目',
                    content: '初始内容',
                    constant: false,
                    selective: true,
                    selectiveLogic: 0,
                    order: 100,
                    position: 0,
                    disable: false,
                    useProbability: true,
                    probability: 100,
                    depth: 4,
                    role: 0,
                    custom_raw_field: 'preserved_0',
                },
            },
        },
    };
    const worldNames = ['测试世界书', '备用世界书'];
    const card = {
        avatar: 'helper-test.png',
        name: '测试角色',
        description: '角色描述',
        personality: '温柔',
        scenario: '书店',
        first_mes: '你好，欢迎来到书店。',
        mes_example: '',
        data: {
            name: '测试角色',
            description: '角色描述',
            personality: '温柔',
            scenario: '书店',
            first_mes: '你好，欢迎来到书店。',
            mes_example: '',
            creator_notes: '作者备注',
            system_prompt: '系统提示',
            post_history_instructions: '越狱提示',
            alternate_greetings: ['备选开场1'],
            character_version: '1.0',
            tags: ['tagA'],
            creator: 'creatorA',
            character_book: { name: '测试世界书', entries: [] },
            extensions: {
                world: '测试世界书',
                regex_scripts: [
                    {
                        id: 'char-regex-1',
                        scriptName: '角色正则',
                        findRegex: '/CHAR_TOKEN/g',
                        replaceString: 'CHAR_REPLACED',
                        trimStrings: [],
                        placement: [2],
                        disabled: false,
                        markdownOnly: true,
                        promptOnly: false,
                        runOnEdit: false,
                        substituteRegex: 0,
                        minDepth: null,
                        maxDepth: null,
                    },
                ],
                tavern_helper: {
                    scripts: [
                        {
                            type: 'script',
                            id: 'script-1',
                            name: '测试脚本1',
                            enabled: true,
                            content: '',
                            info: '脚本信息',
                            button: {
                                enabled: true,
                                buttons: [
                                    { name: '按钮A', visible: true },
                                    { name: '隐藏按钮', visible: false },
                                ],
                            },
                            data: {},
                        },
                    ],
                    variables: {},
                },
            },
        },
    };
    const initialMessages = [
        {
            name: '测试角色',
            is_user: false,
            is_system: false,
            send_date: '2026-11-04T00:00:00Z',
            mes: '第一条消息 CHAR_TOKEN',
            swipe_id: 0,
            swipes: ['第一条消息 CHAR_TOKEN', '第一条备选'],
            swipe_info: [{ send_date: '2026-11-04T00:00:00Z', extra: { tag: 's0' } }, { send_date: '2026-11-04T00:00:01Z', extra: { tag: 's1' } }],
            variables: [{ msg_var: 'v0' }, { msg_var: 'v0_alt' }],
            extra: { tag: 's0' },
        },
        {
            name: '测试用户',
            is_user: true,
            is_system: false,
            send_date: '2026-11-04T00:01:00Z',
            mes: '第二条消息',
            swipe_id: 0,
            swipes: ['第二条消息'],
            swipe_info: [{ send_date: '2026-11-04T00:01:00Z', extra: { tag: 'u0' } }],
            variables: [{ user_var: 'u0' }],
            extra: { tag: 'u0' },
        },
    ];
    const initialRecords = [
        {
            user_name: '测试用户',
            character_name: '测试角色',
            chat_metadata: {
                integrity: 'helper-test-integrity',
                vc_f2: { id: 'chat-f2-1', revision: 1 },
                vc_binding: {
                    characterRef: 'helper-test-ref',
                    chatIdentity: 'chat-f2-1',
                    relationshipId: '1',
                    conversationId: 'chat-f2-1',
                    mode: 'COMPANION',
                },
                variables: { init_var: 'hello' },
            },
        },
        ...structuredClone(initialMessages),
    ];
    prepareSourceIdentities(initialRecords, { settled: true, sourceTimezone: 'UTC' });
    let savedSettingsCount = 0;
    const f2Saves = [];
    const sessionStates = [];
    const refreshed = [];
    let generateGate = null;
    let notifyGenerateEntered = null;
    const context = {
        characters: [card],
        characterId: 0,
        chat: [],
        chatMetadata: {},
        chatId: 'chat-file-1.jsonl',
        name1: '测试用户',
        name2: '测试角色',
        userAvatar: 'user-default.png',
        extensionPrompts: {},
        eventSource: new EventEmitter(),
        eventTypes: event_types,
    };
    const settings = {
        username: '测试用户',
        user_avatar: 'user-default.png',
        world_info: { globalSelect: ['测试世界书'] },
        world_info_depth: 2,
        world_info_budget: 25,
        world_info_budget_cap: 0,
        world_info_min_activations: 0,
        world_info_min_activations_depth_max: 0,
        world_info_max_recursion_steps: 0,
        world_info_character_strategy: 0,
        world_info_include_names: true,
        world_info_recursive: true,
        world_info_case_sensitive: false,
        world_info_match_whole_words: false,
        world_info_use_group_scoring: false,
        world_info_overflow_alert: false,
        oai_settings: {
            ...structuredClone(openaiDefaults),
            preset_settings_openai: 'Default',
            temp_openai: 1,
            top_p_openai: 1,
            openai_max_context: 4096,
            openai_max_tokens: 512,
            prompts: [],
            prompt_order: [{ character_id: 100001, order: [] }],
        },
        power_user: {
            ...structuredClone(powerUserDefaults),
            experimental_macro_engine: false,
            personas: {
                'user-default.png': '测试用户',
                'user-alt.png': '备用人设',
            },
            persona_descriptions: {
                'user-default.png': { description: '默认人设描述', position: 0, depth: 2, role: 0, lorebook: '测试世界书', title: '默认头衔' },
                'user-alt.png': { description: '备用人设描述', position: 1, depth: 4, role: 1, lorebook: '', title: '' },
            },
            persona_description: '默认人设描述',
            persona_description_lorebook: '测试世界书',
        },
        extension_settings: {
            disabledExtensions: [],
            variables: { global: { g_init: 10 } },
            character_allowed_regex: ['helper-test.png'],
            regex: [
                {
                    id: 'global-regex-1',
                    scriptName: '全局正则',
                    findRegex: '/GLOBAL_TOKEN/g',
                    replaceString: 'GLOBAL_REPLACED',
                    trimStrings: [],
                    placement: [1, 2],
                    disabled: false,
                    markdownOnly: true,
                    promptOnly: false,
                    runOnEdit: true,
                    substituteRegex: 0,
                    minDepth: 0,
                    maxDepth: 10,
                },
            ],
            tavern_helper: {
                script: {
                    enabled: { global: true, presets: [], characters: ['helper-test.png'] },
                    scripts: [],
                },
            },
        },
    };
    const presets = { Default: structuredClone(settings.oai_settings) };
    card.data.extensions.vc_character_ref = 'helper-test-ref';
    const capturedDocs = {};
    const client = {
        headers: () => ({}),
        documents: {
            captureWorldbook(name, next) {
                capturedDocs[name] = structuredClone(next);
            },
        },
        saveSettings: async () => {
            savedSettingsCount++;
            return new Response('{}', { status: 200 });
        },
        settingsChanged: () => false,
        async raw(url, serialized) {
            if (url === '/api/chats/save') {
                const body = JSON.parse(serialized);
                f2Saves.push(body);
                return new Response(
                    JSON.stringify({
                        vc_f2: {
                            ...body.chat[0].chat_metadata.vc_f2,
                            revision: body.chat[0].chat_metadata.vc_f2.revision + 1,
                        },
                    }),
                    { status: 200 },
                );
            }
            return new Response('{}', { status: 200 });
        },
        async generate() {
            if (notifyGenerateEntered) notifyGenerateEntered();
            if (generateGate) await generateGate;
            return new Response('{}', { status: 200 });
        },
        async request(url, body) {
            if (url === '/api/avatars/get') {
                return ['user-default.png', 'user-alt.png'];
            }
            if (url === '/api/characters/get') {
                return structuredClone(card);
            }
            if (url === '/api/worldinfo/get') {
                return structuredClone(worldStore[body.name] || { entries: {} });
            }
            if (url === '/api/characters/chats') {
                return [
                    {
                        file_name: 'chat-file-1.jsonl',
                        file_size: '1.2 KB',
                        chat_items: 2,
                        mes: '第二条消息',
                        last_mes: '2026-11-04T00:01:00Z',
                    },
                ];
            }
            if (url === '/api/chats/get') {
                return [
                    { user_name: '测试用户', character_name: '测试角色', chat_metadata: context.chatMetadata },
                    ...structuredClone(context.chat),
                ];
            }
            return {};
        },
        async post(url, body) {
            if (url === '/api/worldinfo/edit') {
                if (Array.isArray(body.vc_changes)) {
                    const current = worldStore[body.name];
                    for (const change of body.vc_changes) {
                        const actual = documentValue(current, change.path);
                        const expected = change.before;
                        if (Boolean(actual.exists) !== Boolean(expected?.exists) || (actual.exists && !documentEqual(actual.value, expected.value))) {
                            return new Response(JSON.stringify({ code: 'VC_CONFLICT' }), { status: 409 });
                        }
                    }
                    worldStore[body.name] = applyDocumentValues(current === undefined ? undefined : structuredClone(current), body.vc_changes);
                } else if (body.data) {
                    worldStore[body.name] = structuredClone(body.data);
                }
                if (!worldNames.includes(body.name)) worldNames.push(body.name);
                return new Response('{}', { status: 200 });
            }
            if (url === '/api/worldinfo/delete') {
                delete worldStore[body.name];
                const idx = worldNames.indexOf(body.name);
                if (idx >= 0) worldNames.splice(idx, 1);
                return new Response('{}', { status: 200 });
            }
            return new Response('{}', { status: 200 });
        },
    };
    const container = document.createElement('div');
    container.id = 'chat';
    container.innerHTML = `
        <div class="mes" mesid="0"><div class="mes_text"><p>第一条消息</p></div></div>
        <div class="mes" mesid="1" is_user="true"><div class="mes_text"><p>第二条消息</p></div></div>
    `;
    document.body.innerHTML = '';
    document.body.appendChild(container);
    const engine = {
        settings,
        bindContext() {
            bindEngineContext(context, settings, { models: [], extensions: [] });
        },
        settingsForSave() {
            return settings;
        },
        firstMessage() {
            return null;
        },
        userMessage: async text => ({
            message: { name: context.name1, mes: text, is_user: true, is_system: false, send_date: '2026-11-04T00:05:00Z', swipe_id: 0, swipes: [text], variables: [{}], extra: {} },
            bias: {},
        }),
        async prepare() {
            return { body: { model: 'synthetic', chat_completion_source: 'custom' } };
        },
        cleanResponse: text => text,
        memory: { finalStatus() {} },
        generateHelper: async () => '合成脚本回复',
        cards: undefined,
    };
    engine.bindContext();
    let session;
    return {
        context,
        settings,
        presets,
        client,
        engine,
        worldStore,
        worldNames,
        container,
        refreshed,
        f2Saves,
        sessionStates,
        get session() { return session; },
        get savedChatCount() { return f2Saves.length; },
        get savedSettingsCount() { return savedSettingsCount; },
        pauseNextGenerate() {
            let release;
            generateGate = new Promise(resolve => { release = resolve; });
            const entered = new Promise(resolve => { notifyGenerateEntered = resolve; });
            return {
                entered,
                release() {
                    generateGate = null;
                    notifyGenerateEntered = null;
                    release();
                },
            };
        },
        async init() {
            session = createDesktopSession({
                client,
                context,
                engine,
                prepareSourceIdentities,
                choosePersona: async () => 'user-default.png',
                resolveBinding: async value => ({
                    characterRef: 'helper-test-ref',
                    chatIdentity: value.chatIdentity,
                    relationshipId: '1',
                    conversationId: value.chatIdentity,
                    mode: value.mode || 'COMPANION',
                }),
                reconcileSources: async () => [],
                onChange: state => sessionStates.push(state),
                readResponse: async (_response, { onUpdate }) => {
                    const result = { text: '合成回复', state: { reasoning: '' }, swipes: [], toolCalls: [], finishReason: 'stop' };
                    await onUpdate(result);
                    return result;
                },
            });
            const cards = await initializeCards({
                context,
                settings,
                packet: { world_names: worldNames },
                presets,
                models: [],
                client,
            });
            engine.cards = cards;
            await session.activate({ avatar: 'helper-test.png', file: 'chat-file-1.jsonl' }, structuredClone(initialRecords));
            f2Saves.length = 0;
            const origRefresh = cards.surface.refresh.bind(cards.surface);
            cards.surface.refresh = async (indices, opts) => {
                refreshed.push(...(Array.isArray(indices) ? indices : [indices]));
                return origRefresh(indices, opts);
            };
            return cards;
        },
    };
}

test('Batch 1: 补挂漏挂接口并移除 10 个内部 _ 函数顶层泄漏', async () => {
    const f = createFixture();
    await f.init();
    const th = globalThis.TavernHelper;

    // 1. 漏挂的 6 组接口
    assert.equal(typeof th.getAllEnabledScriptButtons, 'function');
    const enabledBtns = th.getAllEnabledScriptButtons();
    assert.equal(enabledBtns['script-1']?.length, 1);
    assert.equal(enabledBtns['script-1'][0].button_name, '按钮A');
    assert.equal(typeof enabledBtns['script-1'][0].button_id, 'string');

    assert.equal(typeof th.errorCatched, 'function');
    const safeFn = th.errorCatched(() => {
        throw new Error('boom');
    });
    assert.throws(() => safeFn(), /boom/);

    assert.equal(typeof th.isPresetSystemPrompt, 'function');
    assert.equal(typeof th.isPresetNormalPrompt, 'function');
    assert.equal(typeof th.isPresetPlaceholderPrompt, 'function');
    assert.equal(typeof th.default_preset, 'object');
    assert.equal(th.isPresetSystemPrompt({ id: 'main' }), true);
    assert.equal(th.isPresetPlaceholderPrompt({ id: 'chatHistory' }), true);
    assert.equal(th.isPresetPlaceholderPrompt({ id: 'chat_history' }), false);
    assert.equal(th.isPresetNormalPrompt({ id: 'custom_prompt_1' }), true);
    assert.equal(th.isPresetNormalPrompt({ id: 'main' }), false);
    assert.equal(th.isPresetNormalPrompt({ id: 'chatHistory' }), false);
    assert.equal(th.isPresetNormalPrompt({ id: 'chat_history' }), true);

    assert.equal(typeof th.RawCharacter, 'function');
    const rawChar = th.RawCharacter.find({ name: 'current' });
    assert.ok(rawChar);
    assert.equal(rawChar.getAvatarId(), 'helper-test.png');
    assert.equal(rawChar.getWorldName(), '测试世界书');
    assert.equal(th.RawCharacter.findIndex({ name: '测试角色' }), 0);

    assert.ok(Array.isArray(th.builtin_prompt_default_order));
    assert.deepEqual(th.builtin_prompt_default_order, th.placeholder_prompt_default_order);

    assert.equal(typeof th.getFrontendVersion, 'function');
    assert.equal(th.getFrontendVersion(), th.getTavernHelperVersion());

    // 2. 移除 10 个内部函数顶层泄漏，但保留 _bind
    const leaked = [
        '_getVariables',
        '_getAllVariables',
        '_replaceVariables',
        '_updateVariablesWith',
        '_insertOrAssignVariables',
        '_insertVariables',
        '_deleteVariable',
        'get_variables_without_clone',
        '_initializeGlobal',
        '_waitGlobalInitialized',
    ];
    for (const name of leaked) {
        assert.equal(Object.hasOwn(th, name), false, `顶层 TavernHelper 不应泄漏内部函数 ${name}`);
    }
    const underscoreKeys = Object.keys(th).filter(k => k.startsWith('_')).sort();
    assert.deepEqual(underscoreKeys, ['_bind', '_th_impl']);
    for (const name of leaked.filter(n => n.startsWith('_'))) {
        assert.equal(typeof th._bind[name], 'function', `_bind 仍须保留 ${name}`);
    }
});

test('Batch 2: setLorebookSettings、triggerSlash/triggerSlashWithResult 与 _registerMacroLike/EJS 生效', async () => {
    const f = createFixture();
    await f.init();
    const th = globalThis.TavernHelper;

    // 1. setLorebookSettings
    assert.equal(typeof th.setLorebookSettings, 'function');
    assert.equal(typeof th._bind._setLorebookSettings, 'function');
    th.setLorebookSettings({ scan_depth: 6, selected_global_lorebooks: ['备用世界书'] });
    assert.equal(th.getLorebookSettings().scan_depth, 6);
    assert.deepEqual(th.getLorebookSettings().selected_global_lorebooks, ['备用世界书']);

    // 2. triggerSlash / triggerSlashWithResult 与 EJS execute()
    assert.equal(typeof th.triggerSlash, 'function');
    assert.equal(typeof th.triggerSlashWithResult, 'function');
    assert.equal(typeof th._bind._triggerSlash, 'function');
    assert.equal(typeof th._bind._triggerSlashWithResult, 'function');

    const slashRes = await th.triggerSlash('/setvar key=score 40 | /addvar key=score 2 | /getvar score');
    assert.equal(slashRes, '42');
    assert.equal(f.context.chatMetadata.variables.score, 42);

    const withRes = await th.triggerSlashWithResult('/incvar score | /getvar score');
    assert.equal(withRes, '43');

    const ejsSlash = await globalThis.EjsTemplate.evalTemplate('<%= await execute("/setvar key=from_ejs 77 | /getvar from_ejs") %>');
    assert.equal(ejsSlash, '77');
    assert.equal(f.context.chatMetadata.variables.from_ejs, '77');

    // 3. registerMacroLike / _bind._registerMacroLike / unregisterMacroLike
    assert.equal(typeof th.registerMacroLike, 'function');
    assert.equal(typeof th.unregisterMacroLike, 'function');
    assert.equal(typeof th._bind._registerMacroLike, 'function');

    const mockIframeWin = Object.assign(new EventTarget(), {
        frameElement: { isConnected: true },
    });
    const handle = th._bind._registerMacroLike.call(
        mockIframeWin,
        /\{\{custom_tag::(.*?)\}\}/g,
        (_ctx, _full, val) => `[TAG:${val}]`,
    );
    assert.equal(typeof handle?.unregister, 'function');

    // 在真实 EJS 调用中生效
    const ejsOut = await globalThis.EjsTemplate.evalTemplate('结果=<%= 1 + 1 %> {{custom_tag::EJS_OK}} {{get_chat_variable::from_ejs}}');
    assert.equal(ejsOut, '结果=2 [TAG:EJS_OK] 77');

    // 在生成提示词事件钩子中生效
    const promptData = { prompt: [{ role: 'user', content: '请处理 {{custom_tag::PROMPT_OK}}' }] };
    await f.context.eventSource.emit(f.context.eventTypes.GENERATE_AFTER_DATA, promptData);
    assert.equal(promptData.prompt[0].content, '请处理 [TAG:PROMPT_OK]');

    // iframe pagehide 自动卸载
    mockIframeWin.dispatchEvent(new Event('pagehide'));
    const afterUnload = await globalThis.EjsTemplate.evalTemplate('{{custom_tag::EJS_OK}}');
    assert.equal(afterUnload, '{{custom_tag::EJS_OK}}');
});

test('Batch 3: 世界书旧名包装、消息增删旋转、提示词注入、只读角色/人设、展示/正则、builtin 与不支持接口报错', async () => {
    const f = createFixture();
    await f.init();
    const th = globalThis.TavernHelper;

    // 1. 世界书旧名包装（保留未知字段）
    assert.equal(await th.createLorebook('新世界书X'), true);
    const uid1 = await th.createLorebookEntry('新世界书X', {
        comment: '条目A',
        content: '内容A',
        keys: ['keyA'],
        custom_meta: 'keep_meta_A',
    });
    assert.equal(typeof uid1, 'number');
    const createdMulti = await th.createLorebookEntries('新世界书X', [
        { comment: '条目B', content: '内容B', keys: ['keyB'], custom_meta: 'keep_meta_B' },
    ]);
    assert.equal(createdMulti.new_uids.length, 1);
    assert.equal(createdMulti.entries.length, 2);

    let entries = await th.getLorebookEntries('新世界书X');
    assert.equal(entries.length, 2);
    assert.equal(entries[0].custom_meta, 'keep_meta_A');
    assert.equal(entries[1].custom_meta, 'keep_meta_B');

    await th.setLorebookEntries('新世界书X', [{ uid: uid1, content: '内容A-更新' }]);
    entries = await th.getLorebookEntries('新世界书X');
    assert.equal(entries.find(e => e.uid === uid1).content, '内容A-更新');
    assert.equal(entries.find(e => e.uid === uid1).custom_meta, 'keep_meta_A');

    await th.updateLorebookEntriesWith('新世界书X', list =>
        list.map(item => ({ ...item, order: 250 })),
    );
    entries = await th.getLorebookEntries('新世界书X');
    assert.equal(entries[0].order, 250);
    assert.equal(entries[0].custom_meta, 'keep_meta_A');

    await th.replaceLorebookEntries('新世界书X', [
        { uid: 0, comment: '替换后', content: '替换内容', keys: ['k'], replaced_custom: 999 },
    ]);
    entries = await th.getLorebookEntries('新世界书X');
    assert.equal(entries.length, 1);
    assert.equal(entries[0].replaced_custom, 999);

    assert.equal(await th.deleteLorebookEntry('新世界书X', 0), true);
    assert.equal((await th.getLorebookEntries('新世界书X')).length, 0);
    assert.equal(await th.deleteLorebook('新世界书X'), true);

    // 2. 消息增删与旋转（经唯一 Session / F2 保存，单次 save、保留对象/候选/UI key/source 身份、拒绝忙或过期）
    const m0 = f.context.chat[0];
    const m1 = f.context.chat[1];
    const key0 = f.session.messageKey(m0, 0);
    const key1 = f.session.messageKey(m1, 1);
    const src0 = structuredClone(m0.extra?.vc_source);
    const src1 = structuredClone(m1.extra?.vc_source);
    const swipeInfo0 = structuredClone(m0.swipe_info);
    assert.ok(src0?.id);
    assert.ok(src1?.id);

    const emittedEvents = [];
    f.context.eventSource.on(event_types.MESSAGE_RECEIVED, (idx, tag) => emittedEvents.push(['MESSAGE_RECEIVED', idx, tag]));
    f.context.eventSource.on(event_types.MESSAGE_SENT, (idx, tag) => emittedEvents.push(['MESSAGE_SENT', idx, tag]));
    f.context.eventSource.on(event_types.MESSAGE_DELETED, idx => emittedEvents.push(['MESSAGE_DELETED', idx]));

    const beforeSave = f.savedChatCount;
    const revBeforeCreate = f.context.chatMetadata.vc_f2.revision;
    await th.createChatMessages([
        { role: 'assistant', message: '第三条消息', data: { step: 3 } },
    ]);
    assert.equal(f.savedChatCount, beforeSave + 1, 'createChatMessages 必须恰好触发 1 次 F2 保存');
    assert.equal(f.context.chatMetadata.vc_f2.revision, revBeforeCreate + 1);
    assert.equal(f.context.chat.length, 3);
    assert.equal(f.context.chat[0], m0);
    assert.equal(f.context.chat[1], m1);
    const m2 = f.context.chat[2];
    assert.equal(m2.mes, '第三条消息');
    assert.deepEqual(m2.variables[0], { user_var: 'u0', step: 3 });
    assert.ok(m2.extra?.vc_source?.id, '新消息必须由 prepareSourceIdentities/F2 分配 vc_source');
    const key2 = f.session.messageKey(m2, 2);
    assert.equal(f.session.messageKey(f.context.chat[0], 0), key0);
    assert.equal(f.session.messageKey(f.context.chat[1], 1), key1);
    assert.deepEqual(emittedEvents, [['MESSAGE_RECEIVED', 2, 'extension']]);
    for (const savedRecord of f.f2Saves.at(-1).chat.slice(1)) {
        assert.equal(Object.hasOwn(savedRecord, 'key'), false, 'JSONL 不得写入 UI key');
    }

    const src2 = structuredClone(m2.extra.vc_source);
    const beforeRotateSave = f.savedChatCount;
    await th.rotateChatMessages(0, 2, 3);
    assert.equal(f.savedChatCount, beforeRotateSave + 1, 'rotateChatMessages 必须恰好触发 1 次 F2 保存');
    assert.equal(f.context.chat[0], m2);
    assert.equal(f.context.chat[1], m0);
    assert.equal(f.context.chat[2], m1);
    assert.deepEqual(f.context.chat[1].swipes, ['第一条消息 CHAR_TOKEN', '第一条备选']);
    assert.deepEqual(f.context.chat[1].swipe_info, swipeInfo0);
    assert.deepEqual(f.context.chat[1].variables, [{ msg_var: 'v0' }, { msg_var: 'v0_alt' }]);
    assert.equal(f.session.messageKey(f.context.chat[0], 0), key2);
    assert.equal(f.session.messageKey(f.context.chat[1], 1), key0);
    assert.equal(f.session.messageKey(f.context.chat[2], 2), key1);
    assert.deepEqual(f.context.chat[0].extra.vc_source, src2);
    assert.deepEqual(f.context.chat[1].extra.vc_source, src0);
    assert.deepEqual(f.context.chat[2].extra.vc_source, src1);

    // 批量删除两条消息：再追加一条后一次性删除 [0, 3]，验证恰好保存 1 次且保留中间 m0/m1 对象与身份
    await th.createChatMessages([{ role: 'user', message: '第四条消息' }]);
    assert.equal(f.context.chat.length, 4);
    emittedEvents.length = 0;
    const beforeBatchDeleteSave = f.savedChatCount;
    await th.deleteChatMessages([0, 3]);
    assert.equal(f.savedChatCount, beforeBatchDeleteSave + 1, '批量 deleteChatMessages 必须恰好触发 1 次 F2 保存');
    assert.equal(f.context.chat.length, 2);
    assert.equal(f.context.chat[0], m0);
    assert.equal(f.context.chat[1], m1);
    assert.equal(f.session.messageKey(f.context.chat[0], 0), key0);
    assert.equal(f.session.messageKey(f.context.chat[1], 1), key1);
    assert.deepEqual(f.context.chat[0].extra.vc_source, src0);
    assert.deepEqual(f.context.chat[1].extra.vc_source, src1);
    assert.deepEqual(emittedEvents, [['MESSAGE_DELETED', 0], ['MESSAGE_DELETED', 3]]);

    // 过期 metadata：零写入、零保存、明确抛错
    const realMetadata = f.context.chatMetadata;
    const savesBeforeStale = f.savedChatCount;
    f.context.chatMetadata = { vc_f2: { id: 'stale-chat', revision: 1 } };
    try {
        await assert.rejects(
            () => th.createChatMessages([{ role: 'assistant', message: '过期写入' }]),
            /VC_CHAT_MUTATION_REJECTED/,
        );
        await assert.rejects(
            () => th.deleteChatMessages([0]),
            /VC_CHAT_MUTATION_REJECTED/,
        );
        await assert.rejects(
            () => th.rotateChatMessages(0, 1, 2),
            /VC_CHAT_MUTATION_REJECTED/,
        );
    } finally {
        f.context.chatMetadata = realMetadata;
    }
    assert.equal(f.savedChatCount, savesBeforeStale);
    assert.equal(f.context.chat.length, 2);
    assert.equal(f.context.chat[0], m0);
    assert.equal(f.context.chat[1], m1);

    // 生成 busy 期间：零写入、零保存、明确抛错
    const gate = f.pauseNextGenerate();
    const sendPromise = f.session.send('正在生成的用户输入');
    await gate.entered;
    assert.equal(f.session.busy, true);
    const savesDuringBusy = f.savedChatCount;
    const lenDuringBusy = f.context.chat.length;
    await assert.rejects(
        () => th.createChatMessages([{ role: 'assistant', message: 'busy写入' }]),
        /VC_CHAT_MUTATION_REJECTED/,
    );
    await assert.rejects(
        () => th.deleteChatMessages([0]),
        /VC_CHAT_MUTATION_REJECTED/,
    );
    await assert.rejects(
        () => th.rotateChatMessages(0, 1, 2),
        /VC_CHAT_MUTATION_REJECTED/,
    );
    assert.equal(f.savedChatCount, savesDuringBusy, 'busy 拒绝不得产生额外 F2 保存');
    assert.equal(f.context.chat.length, lenDuringBusy, 'busy 拒绝不得修改消息数组');
    gate.release();
    assert.equal(await sendPromise, true);
    await th.deleteChatMessages([-2, -1]);
    assert.equal(f.context.chat.length, 2);

    // 可重入 EJS / render 期间调用：通过真实 cards.renderMessage -> ejs.render 触发，立即明确拒绝且不挂起 cards.settle()
    const savesBeforeReentrant = f.savedChatCount;
    const origMes = m0.mes;
    const reentrantErrors = [];
    globalThis.__testReentrantCapture = err => { reentrantErrors.push(String(err?.message || err)); };
    m0.mes = '<%_ for (const fn of [() => createChatMessages([{ role: "assistant", message: "重入写入" }]), () => deleteChatMessages([0]), () => rotateChatMessages(0, 1, 2)]) { try { await fn(); } catch (e) { globalThis.__testReentrantCapture(e); } } _%>第一条消息 CHAR_TOKEN';
    m0.swipes[0] = m0.mes;
    try {
        const renderCell = f.container.querySelector('.mes[mesid="0"]');
        f.engine.cards.renderMessage(renderCell, 0, m0, false);
        assert.equal(f.engine.cards.isRendering(), true, 'renderMessage 调度期间 cards.isRendering() 必须为 true');
        await f.engine.cards.settle();
        assert.equal(f.engine.cards.isRendering(), false);
        assert.deepEqual(reentrantErrors, [
            'VC_CHAT_MUTATION_REJECTED',
            'VC_CHAT_MUTATION_REJECTED',
            'VC_CHAT_MUTATION_REJECTED',
        ]);
        assert.equal(f.savedChatCount, savesBeforeReentrant);
        assert.equal(f.context.chat.length, 2);
    } finally {
        delete globalThis.__testReentrantCapture;
        m0.mes = origMes;
        m0.swipes[0] = origMes;
    }

    // 3. 提示词注入
    th.injectPrompts([
        { id: 'inj-1', position: 'in_chat', depth: 2, role: 'system', content: '注入系统提示', should_scan: true },
    ]);
    assert.equal(f.context.extensionPrompts['inj-1']?.value, '注入系统提示');
    th.uninjectPrompts(['inj-1']);
    assert.equal(f.context.extensionPrompts['inj-1'], undefined);

    th.injectPrompts(
        [{ id: 'inj-once', position: 'in_chat', depth: 1, role: 'user', content: '单次注入提示' }],
        { once: true },
    );
    assert.equal(f.context.extensionPrompts['inj-once']?.value, '单次注入提示');
    await f.context.eventSource.emit(event_types.GENERATION_ENDED);
    assert.equal(f.context.extensionPrompts['inj-once'], undefined);

    // 4. 只读角色与人设
    assert.equal(th.getCurrentCharacterName(), '测试角色');
    assert.equal(th.getCurrentCharacterId(), 'helper-test.png');
    assert.deepEqual(th.getCharacterNames(), ['测试角色']);
    assert.deepEqual(th.getCharacterIds(), ['helper-test.png']);
    assert.equal(th.getCharData('current').name, '测试角色');
    assert.equal(th.getCharAvatarPath('current'), '/characters/helper-test.png');
    assert.equal(th.getCharacter('current').name, '测试角色');
    const brief = await th.getChatHistoryBrief('current');
    assert.equal(brief.length, 1);
    const detail = await th.getChatHistoryDetail(brief);
    assert.equal(Object.keys(detail).length, 1);
    assert.equal(detail['chat-file-1.jsonl'].length, 2);

    assert.equal(th.getCurrentPersonaName(), '测试用户');
    assert.equal(th.getCurrentPersonaId(), 'user-default.png');
    assert.equal(th.getPersonaAvatarPath('current'), './User Avatars/user-default.png');
    assert.deepEqual(th.getPersonaIds(), ['user-default.png', 'user-alt.png']);
    assert.deepEqual(th.getPersonaNames(), ['测试用户', '备用人设']);
    assert.equal(th.getPersona('current').description, '默认人设描述');

    // 5. 展示格式化、节点获取、单条刷新与酒馆正则
    assert.equal(th.isCharacterTavernRegexesEnabled(), true);
    const regexes = th.getTavernRegexes({ scope: 'all' });
    assert.equal(regexes.length, 2);
    const regexed = th.formatAsTavernRegexedString('测试 GLOBAL_TOKEN 与 CHAR_TOKEN', 'ai_output', 'display');
    assert.equal(regexed, '测试 GLOBAL_REPLACED 与 CHAR_REPLACED');
    const regexedObj = th.formatAsTavernRegexedString('测试 GLOBAL_TOKEN 与 CHAR_TOKEN', {
        source: 'ai_output',
        destination: 'display',
    });
    assert.equal(regexedObj, '测试 GLOBAL_REPLACED 与 CHAR_REPLACED');

    const displayed = th.formatAsDisplayedMessage('**加粗** CHAR_TOKEN', { message_id: 0 });
    assert.ok(displayed.includes('<strong>加粗</strong>'));
    assert.ok(displayed.includes('CHAR_REPLACED'));

    const domNode = th.retrieveDisplayedMessage(0);
    assert.equal(domNode.length, 1);

    await th.refreshOneMessage(0);
    assert.ok(f.refreshed.includes(0));

    // 6. builtin
    assert.match(th.builtin.uuidv4(), /^[0-9a-f-]{36}$/i);
    assert.deepEqual(th.builtin.parseRegexFromString('/hello/gi'), /hello/gi);
    assert.ok(th.builtin.renderMarkdown('**hi**').includes('<strong>hi</strong>'));
    assert.equal(typeof th.builtin.duringGenerating(), 'boolean');
    const prevSettingsSaved = f.savedSettingsCount;
    th.builtin.saveSettings();
    assert.equal(f.savedSettingsCount, prevSettingsSaved + 1);
    await th.builtin.copyText('test-copy');
    assert.equal(th.getTavernVersion(), '1.13.0');

    // 7. 计划“不做”接口明确报 VC_HELPER_UNSUPPORTED:<name>
    const unsupported = [
        'playSound', 'getAudioList', 'appendAudioList', 'replaceAudioList',
        'getAudioSettings', 'setAudioSettings', 'pauseAudio', 'playAudio',
        'isInstalledExtension', 'getExtensionInstallationInfo', 'updateTavernHelper', 'updateFrontendVersion', 'isFrontend',
        'importRawCharacter', 'importRawChat', 'importRawPreset', 'importRawWorldbook', 'importRawTavernRegex',
        'createCharacter', 'deleteCharacter', 'replaceCharacter', 'updateCharacterWith', 'createOrReplaceCharacter', 'setCurrentCharacter',
        'createPersona', 'deletePersona', 'replacePersona', 'updatePersonaWith', 'createOrReplacePersona', 'setCurrentPersona',
        'loadPreset', 'createPreset', 'deletePreset', 'createOrReplacePreset',
        'replaceTavernRegexes', 'updateTavernRegexesWith',
    ];
    for (const name of unsupported) {
        assert.equal(typeof th[name], 'function', `不支持接口 ${name} 必须存在于 TavernHelper`);
        assert.throws(
            () => th[name]('sensitive-secret-arg'),
            err => err instanceof Error && err.message === `VC_HELPER_UNSUPPORTED:${name}`,
            `${name} 应抛 VC_HELPER_UNSUPPORTED:${name}`,
        );
    }

    // 8. iframe window 经 predefine.js 绑定后同样挂载全部 Batch 1-3 接口且 RawCharacter 保持静态方法
    const predefineSource = fs.readFileSync(
        new URL('../extension/vc-model-settings/desktop/standalone/cards/predefine.js', import.meta.url),
        'utf8',
    );
    const frameEl = document.createElement('iframe');
    frameEl.id = 'TH-message--0--0';
    document.body.appendChild(frameEl);
    const iframeWin = {
        parent: globalThis,
        frameElement: frameEl,
        name: 'TH-message--0--0',
        addEventListener() {},
    };
    iframeWin.window = iframeWin;
    new Function('window', '$', '_', predefineSource)(iframeWin, globalThis.$, globalThis._);
    const batchNames = [
        'getAllEnabledScriptButtons', 'errorCatched', 'isPresetSystemPrompt', 'isPresetNormalPrompt',
        'isPresetPlaceholderPrompt', 'default_preset', 'RawCharacter', 'builtin_prompt_default_order',
        'getFrontendVersion', 'setLorebookSettings', 'triggerSlash', 'triggerSlashWithResult',
        'registerMacroLike', 'unregisterMacroLike', 'setLorebookEntries', 'createLorebookEntries',
        'createLorebookEntry', 'deleteLorebookEntries', 'deleteLorebookEntry', 'replaceLorebookEntries',
        'updateLorebookEntriesWith', 'createLorebook', 'deleteLorebook', 'createChatMessages',
        'deleteChatMessages', 'rotateChatMessages', 'injectPrompts', 'uninjectPrompts', 'getCharData',
        'getCharAvatarPath', 'getCurrentCharacterName', 'getCurrentCharacterId', 'getCharacterNames',
        'getCharacterIds', 'getCharacter', 'getChatHistoryBrief', 'getChatHistoryDetail',
        'getCurrentPersonaName', 'getCurrentPersonaId', 'getPersonaAvatarPath', 'getPersonaNames',
        'getPersonaIds', 'getPersona', 'formatAsTavernRegexedString', 'formatAsDisplayedMessage',
        'retrieveDisplayedMessage', 'refreshOneMessage', 'getTavernRegexes',
        'isCharacterTavernRegexesEnabled', 'builtin',
    ];
    for (const name of batchNames) {
        assert.notEqual(iframeWin.TavernHelper[name], undefined, `iframe.TavernHelper 缺少 ${name}`);
        assert.notEqual(iframeWin[name], undefined, `iframe window 缺少 ${name}`);
    }
    assert.equal(typeof iframeWin.TavernHelper.RawCharacter.find, 'function');
    assert.equal(iframeWin.TavernHelper.RawCharacter.find({ name: 'current' })?.getAvatarId(), 'helper-test.png');
});

test('Audit 1 & 2: iframe _injectPrompts 与 _registerMacroLike 经 closeScripts()/jQuery pagehide 同步清理且幂等', async () => {
    const f = createFixture();
    const cards = await f.init();
    const predefineSource = fs.readFileSync(
        new URL('../extension/vc-model-settings/desktop/standalone/cards/predefine.js', import.meta.url),
        'utf8',
    );
    const scriptHost = document.getElementById('TH-script-frames') || (() => {
        const div = document.createElement('div');
        div.id = 'TH-script-frames';
        document.body.appendChild(div);
        return div;
    })();
    const frameEl = document.createElement('iframe');
    frameEl.id = 'TH-script--script-1';
    scriptHost.appendChild(frameEl);
    const iframeWin = Object.assign(new EventTarget(), {
        parent: globalThis,
        frameElement: frameEl,
        name: 'TH-script--script-1',
        jQuery: globalThis.jQuery,
        $: globalThis.$,
    });
    iframeWin.window = iframeWin;
    Object.defineProperty(frameEl, 'contentWindow', { value: iframeWin, configurable: true });
    new Function('window', '$', '_', predefineSource)(iframeWin, globalThis.$, globalThis._);

    iframeWin.injectPrompts(
        [{ id: 'iframe-leak-check', position: 'in_chat', depth: 1, role: 'system', content: '来自子frame的持久注入' }],
        { once: false },
    );
    assert.equal(f.context.extensionPrompts['iframe-leak-check']?.value, '来自子frame的持久注入');

    iframeWin.registerMacroLike(/\{\{iframe_macro\}\}/g, () => 'IFRAME_MACRO_ACTIVE');
    assert.equal(await globalThis.EjsTemplate.evalTemplate('{{iframe_macro}}'), 'IFRAME_MACRO_ACTIVE');

    // closeScripts 使用 jquery(view).triggerHandler('pagehide') 并 off('pagehide')，不派发原生 Event('pagehide')
    await cards.closeScripts();
    // 即使随后再触发原生 pagehide 也应幂等不报错
    iframeWin.dispatchEvent(new Event('pagehide'));

    assert.equal(f.context.extensionPrompts['iframe-leak-check'], undefined, 'closeScripts 后子 frame 的 once:false 注入必须清空');
    assert.equal(await globalThis.EjsTemplate.evalTemplate('{{iframe_macro}}'), '{{iframe_macro}}', 'closeScripts 后子 frame 的宏必须同步注销');
});

test('Audit 3: createChatMessages 事件顺序 (SENT/RECEIVED -> refresh -> RENDERED -> 单次 F2 保存含 MVU 回调写入)', async () => {
    const f = createFixture();
    await f.init();
    const th = globalThis.TavernHelper;

    const trace = [];
    const origRefresh = f.engine.cards.surface.refresh.bind(f.engine.cards.surface);
    f.engine.cards.surface.refresh = async (indices, opts) => {
        trace.push(`refresh:${Array.isArray(indices) ? indices.join(',') : indices}`);
        return origRefresh(indices, opts);
    };

    f.context.eventSource.on(event_types.MESSAGE_SENT, idx => trace.push(`MESSAGE_SENT:${idx}`));
    f.context.eventSource.on(event_types.MESSAGE_RECEIVED, (idx, tag) => trace.push(`MESSAGE_RECEIVED:${idx}:${tag}`));
    f.context.eventSource.on(event_types.USER_MESSAGE_RENDERED, idx => {
        trace.push(`USER_MESSAGE_RENDERED:${idx}`);
    });
    f.context.eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, idx => {
        trace.push(`CHARACTER_MESSAGE_RENDERED:${idx}`);
        // 模拟 MVU 在 CHARACTER_MESSAGE_RENDERED 回调中非阻塞 applyResult 写入 chatMetadata 与楼层变量
        f.context.chatMetadata.variables.mvu_rendered_applied = `applied_at_${idx}`;
        f.context.chat[idx].variables[0].mvu_floor_applied = true;
    });

    const savesBefore = f.savedChatCount;
    await th.createChatMessages([
        { role: 'user', message: '新增用户消息' },
        { role: 'assistant', message: '新增助手消息' },
    ]);

    assert.equal(f.savedChatCount, savesBefore + 1, '包含 RENDERED 回调修改的 createChatMessages 仍只能触发 1 次 F2 保存');
    assert.deepEqual(trace, [
        'MESSAGE_SENT:2',
        'MESSAGE_RECEIVED:3:extension',
        'refresh:2,3',
        'USER_MESSAGE_RENDERED:2',
        'CHARACTER_MESSAGE_RENDERED:3',
    ]);
    const savedPayload = f.f2Saves.at(-1);
    assert.equal(savedPayload.chat[0].chat_metadata.variables.mvu_rendered_applied, 'applied_at_3', 'RENDERED 回调写入的 chatMetadata 必须进入同一次 F2 保存');
    assert.equal(savedPayload.chat[4].variables[0].mvu_floor_applied, true, 'RENDERED 回调写入的楼层变量必须进入同一次 F2 保存');
});

test('Audit 4, 5, 6: 楼层变量宏 message_id 上下文、GENERATE_AFTER_DATA 单次替换与 formatAsTavernRegexedString role 传递', async () => {
    const f = createFixture();
    await f.init();
    const th = globalThis.TavernHelper;

    // Audit 4: 两楼层不同变量 + demacroOnPrompt 行 role 上下文
    f.context.chat[0].variables[0].floor_only = 'FLOOR_ZERO';
    f.context.chat[1].variables[0].floor_only = 'FLOOR_ONE';
    const outFloor0 = await globalThis.EjsTemplate.evalTemplate(
        '{{get_message_variable::floor_only}}|{{format_message_variable::floor_only}}|{{format_message_variable_quoted::floor_only}}',
        { _th_context: { source: 'message', message_id: 0, role: 'assistant' } },
    );
    const outFloor1 = await globalThis.EjsTemplate.evalTemplate(
        '{{get_message_variable::floor_only}}|{{format_message_variable::floor_only}}|{{format_message_variable_quoted::floor_only}}',
        { _th_context: { source: 'message', message_id: 1, role: 'user' } },
    );
    assert.equal(outFloor0, 'FLOOR_ZERO|FLOOR_ZERO|"FLOOR_ZERO"');
    assert.equal(outFloor1, 'FLOOR_ONE|FLOOR_ONE|"FLOOR_ONE"');

    // Audit 5: 同一生成连续触发 GENERATE_AFTER_DATA 与 CHAT_COMPLETION_SETTINGS_READY 时，非幂等宏只能替换 1 次且带每行 role
    let count = 0;
    const handle = th.registerMacroLike(/NON_IDEMPOTENT_TOKEN/g, ctx => `NON_IDEMPOTENT_TOKEN_${++count}_${ctx.role}`);
    try {
        const messages = [
            { role: 'system', content: 'sys: NON_IDEMPOTENT_TOKEN' },
            { role: 'user', content: 'usr: NON_IDEMPOTENT_TOKEN' },
            { role: 'assistant', content: 'ast: NON_IDEMPOTENT_TOKEN' },
        ];
        await f.context.eventSource.emit(event_types.GENERATE_AFTER_DATA, { prompt: messages }, false);
        await f.context.eventSource.emit(event_types.CHAT_COMPLETION_SETTINGS_READY, { messages });
        assert.deepEqual(messages.map(m => m.content), [
            'sys: NON_IDEMPOTENT_TOKEN_1_system',
            'usr: NON_IDEMPOTENT_TOKEN_2_user',
            'ast: NON_IDEMPOTENT_TOKEN_3_assistant',
        ]);
    } finally {
        handle.unregister();
    }

    // Audit 6: formatAsTavernRegexedString 调用中宏回调必须拿到真实 role/source/message_id 而非被 ejs-host.substituteParams 提前用 source:'other' 吞掉
    const roleHandle = th.registerMacroLike(/CTX_ROLE_CHECK/g, ctx => `${ctx.source}:${ctx.role}`);
    try {
        const formatted = th.formatAsTavernRegexedString('CTX_ROLE_CHECK', 'ai_output', 'display', { depth: 0 });
        assert.equal(formatted, 'display:assistant');
    } finally {
        roleHandle.unregister();
    }
});

test('Audit 7, 9, 10: RawCharacter.getCardData 完整角色对象与缺省值、getChatHistoryBrief 倒序、预设分类精确列表', async () => {
    const f = createFixture();
    await f.init();
    const th = globalThis.TavernHelper;

    // Audit 7: getCardData() 返回完整 v1CharData（含顶层 avatar 与 data），缺省字段返回安全默认值
    const rawCurrent = th.RawCharacter.find({ name: 'current' });
    assert.equal(rawCurrent.getCardData().avatar, 'helper-test.png');
    assert.equal(rawCurrent.getCardData().data.name, '测试角色');
    assert.equal(th.getCharData('current').avatar, 'helper-test.png');

    f.context.characters.push({ name: '空字段角色', avatar: '', data: {} });
    const rawMinimal = th.RawCharacter.find({ name: '空字段角色' });
    assert.equal(rawMinimal.getAvatarId(), '');
    assert.deepEqual(rawMinimal.getRegexScripts(), []);
    assert.equal(rawMinimal.getCharacterBook(), null);
    assert.equal(rawMinimal.getWorldName(), '');
    f.context.characters.pop();

    // Audit 9: getChatHistoryBrief 按 file_name 倒序排序并保留原始字段
    const origRequest = f.client.request.bind(f.client);
    f.client.request = async (url, body) => {
        if (url === '/api/characters/chats') {
            return {
                a: { file_name: '2026-11-03@01h00m.jsonl', file_size: '1 KB', chat_items: 2, mes: '旧消息', last_mes: '2026-11-03T01:00:00Z', extra_tag: 'old' },
                b: { file_name: '2026-11-04@09h30m.jsonl', file_size: '2 KB', chat_items: 5, mes: '新消息', last_mes: '2026-11-04T09:30:00Z', extra_tag: 'new' },
            };
        }
        return origRequest(url, body);
    };
    try {
        const briefs = await th.getChatHistoryBrief('current');
        assert.deepEqual(briefs.map(b => b.file_name), [
            '2026-11-04@09h30m.jsonl',
            '2026-11-03@01h00m.jsonl',
        ]);
        assert.equal(briefs[0].extra_tag, 'new');
        assert.equal(briefs[0].avatar_url, 'helper-test.png');
        assert.equal(briefs[0].ch_name, '测试角色');
    } finally {
        f.client.request = origRequest;
    }

    // Audit 10: isPresetSystemPrompt / isPresetPlaceholderPrompt 仅识别锁定上游精确列表
    for (const id of ['main', 'nsfw', 'jailbreak', 'enhanceDefinitions']) {
        assert.equal(th.isPresetSystemPrompt({ id }), true, `${id} 应为 system prompt`);
        assert.equal(th.isPresetNormalPrompt({ id }), false);
    }
    for (const id of ['worldInfoBefore', 'personaDescription', 'charDescription', 'charPersonality', 'scenario', 'worldInfoAfter', 'dialogueExamples', 'chatHistory']) {
        assert.equal(th.isPresetPlaceholderPrompt({ id }), true, `${id} 应为 placeholder prompt`);
        assert.equal(th.isPresetNormalPrompt({ id }), false);
    }
    for (const snakeId of ['enhance_definitions', 'world_info_before', 'persona_description', 'char_description', 'char_personality', 'world_info_after', 'dialogue_examples', 'chat_history', 'authors_note']) {
        assert.equal(th.isPresetSystemPrompt({ id: snakeId }), false, `${snakeId} 不应被误判为 system prompt`);
        assert.equal(th.isPresetPlaceholderPrompt({ id: snakeId }), false, `${snakeId} 不应被误判为 placeholder prompt`);
        assert.equal(th.isPresetNormalPrompt({ id: snakeId }), true, `${snakeId} 应归为 normal prompt`);
    }
});

test('Audit 8: updateLorebookEntriesWith 单次读取基线与字段级 CAS（异字段并发保留远端修改，同字段并发冲突报 409）', async () => {
    const f = createFixture();
    await f.init();
    const th = globalThis.TavernHelper;

    // 1. 异字段并发：updater 修改 comment 期间远端修改了 content，提交应成功且保留远端 content
    await th.updateLorebookEntriesWith('测试世界书', async entries => {
        // 模拟在初次读取之后、写回之前，另一处并发更新了同一条目的 content
        f.worldStore['测试世界书'].entries[0].content = '远端并发新内容';
        entries[0].comment = '本地更新备注';
        return entries;
    });
    assert.equal(f.worldStore['测试世界书'].entries[0].comment, '本地更新备注');
    assert.equal(f.worldStore['测试世界书'].entries[0].content, '远端并发新内容', '不得用 updater 内部的旧快照覆盖未修改的远端字段');

    // 2. 同字段并发：updater 修改 comment 期间远端也修改了 comment，提交必须因 CAS 基线不匹配抛 409 且不覆盖远端值
    await assert.rejects(
        () =>
            th.updateLorebookEntriesWith('测试世界书', async entries => {
                f.worldStore['测试世界书'].entries[0].comment = '远端抢先修改备注';
                entries[0].comment = '本地冲突备注';
                return entries;
            }),
        err => err?.status === 409,
    );
    assert.equal(f.worldStore['测试世界书'].entries[0].comment, '远端抢先修改备注');
});

test('Audit 11, 12, 13: builtin.duringGenerating 真实生成态、builtin.renderMarkdown 复用配置化 converter、Slash /let 与 /var 局部作用域', async () => {
    const f = createFixture();
    await f.init();
    const th = globalThis.TavernHelper;

    // Audit 11: builtin.duringGenerating() 在空闲与非生成动作时为 false，真实生成与 Helper 生成中为 true，结束后恢复 false
    assert.equal(th.builtin.duringGenerating(), false);
    let duringMutation = null;
    const onMutSent = () => { duringMutation = th.builtin.duringGenerating(); };
    f.context.eventSource.on(event_types.MESSAGE_SENT, onMutSent);
    try {
        await th.createChatMessages([{ role: 'user', message: '非生成动作消息' }]);
        assert.equal(duringMutation, false, '消息修改期间 builtin.duringGenerating() 必须为 false');
    } finally {
        f.context.eventSource.removeListener(event_types.MESSAGE_SENT, onMutSent);
    }

    const gate = f.pauseNextGenerate();
    const sendPromise = f.session.send('测试生成态');
    await gate.entered;
    let duringGenWhileRunning;
    try {
        duringGenWhileRunning = th.builtin.duringGenerating();
    } finally {
        gate.release();
        await sendPromise;
    }
    assert.equal(duringGenWhileRunning, true, '真实生成进行中 builtin.duringGenerating() 必须为 true');
    assert.equal(th.builtin.duringGenerating(), false, '生成结束后 builtin.duringGenerating() 必须恢复 false');

    let duringHelperGen = false;
    const origGenerateHelper = f.engine.generateHelper;
    f.engine.generateHelper = async (...args) => {
        duringHelperGen = th.builtin.duringGenerating();
        return origGenerateHelper(...args);
    };
    try {
        await f.context.generateHelper('generate', { user_input: 'helper生成测试' });
        assert.equal(duringHelperGen, true, 'Helper 生成进行中 builtin.duringGenerating() 必须为 true');
        assert.equal(th.builtin.duringGenerating(), false, 'Helper 生成结束后 builtin.duringGenerating() 必须恢复 false');
    } finally {
        f.engine.generateHelper = origGenerateHelper;
    }

    // Audit 12: builtin.renderMarkdown 复用 cards/format.js 的配置化 converter（支持表格、删除线、单换行等）
    const mdHtml = th.builtin.renderMarkdown('| A | B |\n| - | - |\n| 1 | 2 |\n\n~~删除线~~\n第一行\n第二行');
    assert.ok(mdHtml.includes('<table>'), 'renderMarkdown 应支持表格');
    assert.ok(mdHtml.includes('<del>删除线</del>'), 'renderMarkdown 应支持删除线');
    assert.ok(mdHtml.includes('第一行<br>\n第二行'), 'renderMarkdown 应支持单换行转 <br>');

    // Audit 13: /let 与 /var 使用每次执行局部的 SlashCommandScope，不污染持久化 chat_metadata.variables
    const scopedOut = await th.triggerSlash('/let x 10 | /var x 25 | /var x');
    assert.equal(scopedOut, '25');
    assert.equal(f.context.chatMetadata.variables.x, undefined, '/let 与 /var 不得写入持久化 chat_metadata.variables');

    const namedScopedOut = await th.triggerSlash('/let key=arr [10,20] | /var index=1 arr 99 | /var index=1 arr');
    assert.equal(namedScopedOut, '99');
    assert.equal(f.context.chatMetadata.variables.arr, undefined);

    // 跨次执行不泄漏上次局部作用域，读取未声明局部变量抛错，重复 /let 同名变量抛错
    await assert.rejects(() => th.triggerSlash('/var x'), /Variable "x" not found/);
    await assert.rejects(() => th.triggerSlash('/let dup 1 | /let dup 2'), /Variable "dup" already exists/);
});
