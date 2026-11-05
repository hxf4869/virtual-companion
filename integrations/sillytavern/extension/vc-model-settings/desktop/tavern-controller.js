// 酒馆九类设置纯逻辑控制器 — 无 DOM 依赖，供桌面 React 路由与旧壳薄包装共用。
import { iconSpriteUrl } from '../ui/icons.js';
import { fetchModelPurposes, fetchProviders } from '../api.js';
import { resolveForegroundProjection, ineligibleReasonLabel } from '../projection-logic.js';
import { documentChanges, documentEqual, documentValue, applyDocumentValues } from '../settings-documents.js';
import {
    replyDefaults,
    appearanceDefaults,
    formatDefaults,
    worldDefaults,
    worldEntryDefaults,
    personaDefaults,
    ejsDefaults,
    helperDefaults,
    chatCompletionDefaultPrompts,
    promptManagerDefaultPromptOrder,
} from './tavern-defaults.js';
import {
    options,
    openaiPresetFields,
    replyFields,
    promptFields,
    worldFields,
    worldSettingFields,
    personaFields,
    appearanceFields,
    characterFields,
    noteFields,
    dataFields,
    ejsLabels,
    renderLabels,
} from './tavern-fields.js';

export const CODE_EDITOR_STORAGE_KEY = 'st_monaco_editor_settings';
export const defaults = {
    fontSize: 14,
    fontFamily: "'Cascadia Code','Fira Code',Consolas,'Courier New',monospace",
    lineHeight: 0,
    letterSpacing: 0,
    fontWeight: 'normal',
    fontLigatures: false,
    theme: 'ejsTheme',
    cursorStyle: 'line',
    cursorBlinking: 'blink',
    renderWhitespace: 'boundary',
    renderLineHighlight: 'line',
    guidesIndent: 'indentation',
    wordWrap: false,
    lineNumbers: true,
    minimap: true,
    bracketPairColorization: true,
    folding: true,
    glyphMargin: false,
    smoothScrolling: true,
    mouseWheelZoom: false,
    scrollBeyondLastLine: true,
    stickyScroll: true,
    contextmenu: true,
    quickSuggestions: true,
    semanticHighlighting: true,
    insertSpaces: true,
    tabSize: 4,
    detectIndentation: true,
    trimAutoWhitespace: true,
    wordBasedSuggestions: 'currentDocument',
};
export const labels = {
    fontSize: '字号',
    fontFamily: '字体',
    lineHeight: '行高',
    letterSpacing: '字间距',
    fontWeight: '字重',
    fontLigatures: '连字',
    theme: '主题',
    cursorStyle: '光标',
    cursorBlinking: '闪烁',
    renderWhitespace: '空白',
    renderLineHighlight: '行高亮',
    guidesIndent: '缩进线',
    wordWrap: '换行',
    lineNumbers: '行号',
    minimap: '缩略图',
    bracketPairColorization: '括号配色',
    folding: '折叠',
    glyphMargin: '符号边栏',
    smoothScrolling: '平滑滚动',
    mouseWheelZoom: '滚轮缩放',
    scrollBeyondLastLine: '末行后滚动',
    stickyScroll: '固定上下文',
    contextmenu: '上下文菜单',
    quickSuggestions: '快速建议',
    semanticHighlighting: '语义高亮',
    insertSpaces: '使用空格',
    tabSize: '缩进宽度',
    detectIndentation: '自动检测缩进',
    trimAutoWhitespace: '清理空白',
    wordBasedSuggestions: '词语建议',
};
export const enums = {
    theme: ['ejsTheme', 'vs', 'vs-dark', 'hc-black', 'hc-light'],
    fontWeight: ['normal', 'bold', '100', '200', '300', '400', '500', '600', '700', '800', '900'],
    cursorStyle: ['line', 'block', 'underline', 'line-thin', 'block-outline', 'underline-thin'],
    cursorBlinking: ['blink', 'smooth', 'phase', 'expand', 'solid'],
    renderWhitespace: ['none', 'boundary', 'selection', 'trailing', 'all'],
    renderLineHighlight: ['none', 'gutter', 'line', 'all'],
    guidesIndent: ['indentation', 'none'],
    wordBasedSuggestions: ['off', 'currentDocument', 'matchingDocuments', 'allDocuments'],
};
export const toOptions = cfg => ({
    ...Object.fromEntries(Object.keys(defaults).map(key => [key, cfg[key]])),
    wordWrap: cfg.wordWrap ? 'on' : 'off',
    lineNumbers: cfg.lineNumbers ? 'on' : 'off',
    minimap: { enabled: cfg.minimap },
    bracketPairColorization: { enabled: cfg.bracketPairColorization },
    stickyScroll: { enabled: cfg.stickyScroll },
    guides:
        cfg.guidesIndent === 'none'
            ? { indentation: false, bracketPairs: false }
            : { indentation: true, bracketPairs: true },
    'semanticHighlighting.enabled': cfg.semanticHighlighting,
});

export const codeEditorDefaults = defaults;
export const codeEditorLabels = labels;
export const codeEditorEnums = enums;
export const toCodeEditorOptions = toOptions;

export function readCodeEditorPreferences(storage = globalThis.localStorage) {
    try {
        const parsed = JSON.parse(storage?.getItem?.(CODE_EDITOR_STORAGE_KEY) || '{}');
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return { ...defaults, ...parsed };
        }
    } catch {
        // ignore invalid storage payload
    }
    return { ...defaults };
}

export function writeCodeEditorPreferences(preferences, storage = globalThis.localStorage) {
    try {
        let existing = {};
        try {
            const parsed = JSON.parse(storage?.getItem?.(CODE_EDITOR_STORAGE_KEY) || '{}');
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                existing = parsed;
            }
        } catch {
            existing = {};
        }
        storage?.setItem?.(CODE_EDITOR_STORAGE_KEY, JSON.stringify({ ...existing, ...preferences }));
    } catch {
        // 沿用原本机偏好不可用时的当前窗口行为
    }
}

export function buildCodeEditorFields(preferences, drafts = new Map(), errors = new Map()) {
    return dataFields(defaults, labels).map(field => ({
        ...field,
        key: field.name,
        value: drafts.has(field.name) ? drafts.get(field.name) : preferences[field.name],
        ...(enums[field.name]
            ? {
                  kind: 'select',
                  options: options([...new Set([...enums[field.name], preferences[field.name]])]),
              }
            : {}),
        error: errors.get(field.name),
    }));
}

export function validateCodeEditorField(name, rawValue) {
    if (typeof defaults[name] === 'number') {
        const text = String(rawValue);
        const number = Number(rawValue);
        if (!text.trim() || !Number.isFinite(number) || (name === 'fontSize' && (number < 8 || number > 48))) {
            return { ok: false, draft: text, error: '请输入有效数值。' };
        }
        return { ok: true, value: number };
    }
    return { ok: true, value: rawValue };
}

export const TAVERN_SECTIONS = [
    { id: 'ai-config-button', panel: 'left-nav-panel', slug: 'reply-config', label: 'AI 回复配置', icon: 'sliders-horizontal', tile: 'indigo' },
    { id: 'advanced-formatting-button', panel: 'AdvancedFormatting', slug: 'formatting', label: '提示词格式', icon: 'quote', tile: 'purple' },
    { id: 'WI-SP-button', panel: 'WorldInfo', slug: 'world-info', label: '世界书', icon: 'book-marked', tile: 'teal' },
    { id: 'extensions-settings-button', panel: 'rm_extensions_block', slug: 'extensions', label: '扩展', icon: 'puzzle', tile: 'orange' },
    { id: 'persona-management-button', panel: 'PersonaManagement', slug: 'personas', label: '人设', icon: 'user-round', tile: 'green' },
    { id: 'backgrounds-button', panel: 'Backgrounds', slug: 'backgrounds', label: '背景', icon: 'image', tile: 'cyan' },
    { id: 'user-settings-button', panel: 'user-settings-block', slug: 'interface', label: '界面', icon: 'monitor', tile: 'pink' },
    { id: 'sys-settings-button', panel: 'rm_api_block', slug: 'api', label: 'API 连接', icon: 'link', tile: 'gray' },
    { id: 'rightNavHolder', panel: 'right-nav-panel', slug: 'character-card', label: '角色卡', icon: 'square-pen', tile: 'blue' },
];

const SECTION_ALIASES = new Map([
    ['left-nav-panel', 'left-nav-panel'],
    ['reply', 'left-nav-panel'],
    ['reply-config', 'left-nav-panel'],
    ['ai-config', 'left-nav-panel'],
    ['ai-config-button', 'left-nav-panel'],
    ['presets', 'left-nav-panel'],
    ['AdvancedFormatting', 'AdvancedFormatting'],
    ['advancedformatting', 'AdvancedFormatting'],
    ['advanced-formatting', 'AdvancedFormatting'],
    ['formatting', 'AdvancedFormatting'],
    ['templates', 'AdvancedFormatting'],
    ['prompts', 'AdvancedFormatting'],
    ['WorldInfo', 'WorldInfo'],
    ['worldinfo', 'WorldInfo'],
    ['world-info', 'WorldInfo'],
    ['world', 'WorldInfo'],
    ['rm_extensions_block', 'rm_extensions_block'],
    ['extensions', 'rm_extensions_block'],
    ['regex', 'rm_extensions_block'],
    ['helper', 'rm_extensions_block'],
    ['scripts', 'rm_extensions_block'],
    ['PersonaManagement', 'PersonaManagement'],
    ['personamanagement', 'PersonaManagement'],
    ['persona-management', 'PersonaManagement'],
    ['personas', 'PersonaManagement'],
    ['persona', 'PersonaManagement'],
    ['Backgrounds', 'Backgrounds'],
    ['backgrounds', 'Backgrounds'],
    ['background', 'Backgrounds'],
    ['user-settings-block', 'user-settings-block'],
    ['interface', 'user-settings-block'],
    ['interface-prefs', 'user-settings-block'],
    ['user-settings', 'user-settings-block'],
    ['rm_api_block', 'rm_api_block'],
    ['api', 'rm_api_block'],
    ['api-connection', 'rm_api_block'],
    ['connection', 'rm_api_block'],
    ['right-nav-panel', 'right-nav-panel'],
    ['character', 'right-nav-panel'],
    ['character-card', 'right-nav-panel'],
    ['characters', 'right-nav-panel'],
]);

export function normalizeTavernSection(raw) {
    const trimmed = String(raw ?? '').trim();
    if (!trimmed) return 'left-nav-panel';
    return SECTION_ALIASES.get(trimmed) || SECTION_ALIASES.get(trimmed.toLowerCase()) || 'left-nav-panel';
}

export function tavernSectionTitle(raw) {
    const panel = normalizeTavernSection(raw);
    return TAVERN_SECTIONS.find(item => item.panel === panel)?.label || 'AI 回复配置';
}

export function validateTavernName(raw) {
    const name = String(raw ?? '').trim();
    if (!name) return '请输入名称。';
    if (/[\\/\u0000-\u001f]/.test(name)) return '名称不能包含路径或控制字符。';
    return '';
}

const copy = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const get = (value, path) => documentValue(value, path).value;

function put(value, path, next) {
    if (!path.length) return copy(next);
    let parent = value;
    for (const key of path.slice(0, -1)) {
        if (!Object.hasOwn(parent, key) || parent[key] === null || typeof parent[key] !== 'object') {
            Object.defineProperty(parent, key, { value: {}, writable: true, enumerable: true, configurable: true });
        }
        parent = parent[key];
    }
    if (next === undefined) delete parent[path.at(-1)];
    else Object.defineProperty(parent, path.at(-1), { value: copy(next), writable: true, enumerable: true, configurable: true });
    return value;
}

function withDefaults(value, fallback) {
    if (!object(value)) return value === undefined ? copy(fallback) : copy(value);
    const next = copy(value);
    for (const [key, item] of Object.entries(fallback)) {
        next[key] = Object.hasOwn(next, key)
            ? (object(item) && object(next[key]) ? withDefaults(next[key], item) : next[key])
            : copy(item);
    }
    return next;
}

const split = name => name.split('.');
const emptyOption = { value: '', label: '未选择' };
const builtinPrompts = new Set(chatCompletionDefaultPrompts.prompts.map(prompt => prompt.identifier));
const actions = (...values) => values.map(([id, label, extra]) => ({ id, label, ...extra }));
const connectionKeys = /^(?:api_key|api_key_.*|.*_api_key|proxy_password|password|credential|credentials|custom_url|reverse_proxy|custom_include_headers|custom_include_body|azure_base_url|secret_key|access_token|refresh_token)$/i;

export function portablePreset(value) {
    if (!object(value)) return {};
    return Object.fromEntries(
        Object.entries(value)
            .filter(([key]) => !connectionKeys.test(key))
            .map(([key, item]) => [key, copy(item)]),
    );
}

function parseObject(value, label) {
    const next = typeof value === 'string' ? JSON.parse(value) : copy(value);
    if (!object(next)) throw new Error(`${label}必须是 JSON 对象。`);
    return next;
}

function deriveExpectedKey(ctx, getConversationKey) {
    if (typeof getConversationKey === 'function') {
        const key = getConversationKey();
        if (key) return String(key);
    }
    if (ctx?.conversationKey) return String(ctx.conversationKey);
    const avatar = ctx?.character?.avatar ?? ctx?.characters?.[ctx?.characterId]?.avatar ?? '';
    const file = String(ctx?.chatId ?? '').replace(/\.jsonl$/i, '');
    if (avatar && file) return JSON.stringify([avatar, file]);
    return '';
}

export function createTavernController(opts = {}) {
    const {
        client,
        setHeader = () => {},
        onUpdate = () => {},
        getContext = () => ({}),
        getConversationKey,
    } = opts;
    let key = normalizeTavernSection(opts.key);
    const ac = new AbortController();
    const records = new Map();
    const bindings = new Map();
    const textDrafts = new Map();
    const errors = new Map();

    let destroyed = false;
    let ticket = 0;
    let busy = false;
    let loading = true;
    let error = '';
    let conflict = false;
    let codeEditor = null;
    let packet;
    let settings;
    let metadata;
    let metadataOwner = '';
    let metadataExpectedKey = '';
    let selectedWorld = '';
    let selectedPersona = '';
    let selectedCharacter = '';
    let selectedPrompt = '';
    let worlds = [];
    let avatars = [];
    let backgrounds = [];
    let characters = [];
    let selectedTemplate = 'context';
    let selectedScope = '';
    let projection;
    let projectionError = '';
    let lastState = null;

    const selectedPresets = { openai: '', context: '', instruct: '', sysprompt: '', reasoning: '' };

    const alive = id => !destroyed && !ac.signal.aborted && (id === undefined || id === ticket);
    const context = () => {
        try {
            return getContext() || {};
        } catch {
            return {};
        }
    };
    const contextIdentity = ctx =>
        JSON.stringify([
            ctx.chatId ?? '',
            ctx.character?.avatar ?? ctx.characters?.[ctx.characterId]?.avatar ?? '',
            ctx.groupId ?? '',
        ]);
    const currentAvatar = () =>
        context().character?.avatar ?? context().characters?.[context().characterId]?.avatar ?? '';
    const canMetadata = () =>
        context().canEditChatMetadata === true &&
        Boolean(opts.onMetadataCommit) &&
        contextIdentity(context()) === metadataOwner;

    const noteDefaults = () => {
        const note = settings?.next.extension_settings?.note || {};
        return {
            note_prompt: note.default ?? '',
            note_interval: note.defaultInterval ?? 1,
            note_position: note.defaultPosition ?? 1,
            note_depth: note.defaultDepth ?? 4,
            note_role: note.defaultRole ?? 0,
        };
    };

    const addRecord = (id, kind, raw, fallback = {}, extra = {}) => {
        const value = withDefaults(raw === undefined ? {} : raw, fallback);
        const record = { id, kind, raw: copy(raw), view: copy(value), next: copy(value), ...extra };
        records.set(id, record);
        return record;
    };

    const presetRecord = (api, name = selectedPresets[api]) => records.get(`preset:${api}:${name}`);
    const charRecord = () => records.get(`character:${selectedCharacter}`);
    const worldRecord = () => records.get(`world:${selectedWorld}`);
    const changed = record => !documentEqual(record.view, record.next) || record.raw === undefined;
    const dirty = () =>
        [...records.values()].some(changed) || errors.size > 0 || Boolean(codeEditor?.isDirty?.());

    const request = (url, body = {}) => client.request(url, body, { signal: ac.signal });
    const post = (url, body) => client.post(url, body, { signal: ac.signal });
    const reads = opts.reads || {};
    const readSettingsDoc = ({ fresh = false } = {}) =>
        typeof reads.settingsDoc === 'function'
            ? reads.settingsDoc({ fresh, signal: ac.signal })
            : request('/api/settings/get');
    const readCharacters = ({ fresh = false } = {}) =>
        typeof reads.characters === 'function'
            ? reads.characters({ fresh, signal: ac.signal })
            : request('/api/characters/all');
    const readCharacterDetail = (avatar, { fresh = false } = {}) =>
        typeof reads.characterDetail === 'function'
            ? reads.characterDetail(avatar, { fresh, signal: ac.signal })
            : request('/api/characters/get', { avatar_url: avatar });
    const readWorldbookList = ({ fresh = false } = {}) =>
        typeof reads.worldbookList === 'function'
            ? reads.worldbookList({ fresh, signal: ac.signal })
            : request('/api/worldinfo/list');
    const readWorldbook = (name, { fresh = false } = {}) =>
        typeof reads.worldbook === 'function'
            ? reads.worldbook(name, { fresh, signal: ac.signal })
            : request('/api/worldinfo/get', { name });
    const readAvatars = ({ fresh = false } = {}) =>
        typeof reads.avatars === 'function'
            ? reads.avatars({ fresh, signal: ac.signal })
            : request('/api/avatars/get');
    const readBackgrounds = ({ fresh = false } = {}) =>
        typeof reads.backgrounds === 'function'
            ? reads.backgrounds({ fresh, signal: ac.signal })
            : request('/api/backgrounds/all');
    const readPurposes = ({ fresh = false } = {}) => {
        if (typeof reads.purposes === 'function') {
            return reads.purposes({ fresh, signal: ac.signal });
        }
        return typeof client?.go?.fetchModelPurposes === 'function'
            ? client.go.fetchModelPurposes()
            : fetchModelPurposes();
    };
    const readProviders = ({ fresh = false } = {}) => {
        if (typeof reads.providers === 'function') {
            return reads.providers({ fresh, signal: ac.signal });
        }
        return typeof client?.go?.fetchProviders === 'function'
            ? client.go.fetchProviders()
            : fetchProviders();
    };
    const notify = message => {
        if (alive()) opts.onNotify?.(message);
    };

    function fail(cause) {
        if (!alive() || cause?.name === 'AbortError') return;
        conflict = cause?.status === 409;
        error = conflict
            ? '设置已在另一处更新。当前输入仍保留；加载最新会放弃本次更改。'
            : (cause?.message || '操作没有完成，请重试。');
        render();
    }

    function bind(record, path, spec, extra = {}) {
        const id = JSON.stringify([record.id, ...path]);
        const raw = get(record.next, path);
        const value =
            raw ??
            spec.fallback ??
            (spec.kind === 'json'
                ? {}
                : spec.kind === 'list' || spec.kind === 'multiselect'
                  ? []
                  : spec.kind === 'boolean'
                    ? false
                    : '');
        bindings.set(id, { record, path, spec, disabled: extra.disabled });
        let displayed = value;
        if (spec.kind === 'json') displayed = textDrafts.has(id) ? textDrafts.get(id) : JSON.stringify(value, null, 2);
        if (spec.kind === 'number' || spec.kind === 'list') displayed = textDrafts.has(id) ? textDrafts.get(id) : value;
        if (spec.nullableBoolean) displayed = String(raw ?? null);
        return { ...spec, ...extra, key: id, value: displayed, error: errors.get(id) };
    }

    function fields(record, base, specs, extra) {
        return specs.map(spec => bind(record, [...base, ...split(spec.name)], spec, extra));
    }
    const rawField = (name, label, kind = 'text', extra = {}) => ({ name, label, kind, ...extra });
    function group(id, title, record, base, specs, extra) {
        return { id, title, fields: fields(record, base, specs, extra) };
    }
    function resource(id, label, value, rows) {
        return { key: id, label, value, options: rows };
    }
    const presetOptions = api =>
        [...records.values()]
            .filter(r => r.kind === 'preset' && r.apiId === api)
            .map(r => ({ value: r.name, label: r.name }));

    function modelFields() {
        if (!projection?.eligible) {
            return [
                {
                    key: 'model-status',
                    label: '前台聊天',
                    value: projectionError || ineligibleReasonLabel(projection?.reason || 'no-binding'),
                    disabled: true,
                },
            ];
        }
        const p = projection;
        return [
            ['protocol', '协议', p.protocol],
            ['provider', '供应商', p.providerLabel],
            ['model', '模型', p.modelId],
            ['context', '上下文窗口', p.contextWindowTokens],
            ['output', '输出上限', p.maxOutputTokens],
            ...(p.pinned.temperature === undefined ? [] : [['temperature', '温度', p.pinned.temperature]]),
            ...(p.pinned.topP === undefined ? [] : [['top-p', 'Top P', p.pinned.topP]]),
            ...(p.pinned.reasoningEffort === undefined ? [] : [['reasoning', '推理等级', p.pinned.reasoningEffort]]),
        ].map(([id, label, value]) => ({ key: `model-${id}`, label, value, disabled: true }));
    }

    function promptOrder() {
        const oai = settings.next.oai_settings;
        const scopes = Array.isArray(oai.prompt_order) ? oai.prompt_order : [];
        if (!selectedScope && scopes.length) selectedScope = String(scopes[0].character_id);
        return scopes.find(scope => String(scope.character_id) === selectedScope);
    }

    function selectedPromptObject() {
        return settings.next.oai_settings.prompts?.find(prompt => prompt.identifier === selectedPrompt);
    }

    // B8 helpers: manage active preset in settings and clean up unsaved orphan preset records
    function getBaselineActivePreset(apiId) {
        if (!settings) return '';
        if (apiId === 'openai') return settings.view.oai_settings?.preset_settings_openai || '';
        return settings.view.power_user?.[apiId]?.preset || settings.view.power_user?.[apiId]?.name || '';
    }

    function getActivePresetInSettings(apiId) {
        if (!settings) return '';
        if (apiId === 'openai') return settings.next.oai_settings?.preset_settings_openai || '';
        return settings.next.power_user?.[apiId]?.preset || settings.next.power_user?.[apiId]?.name || '';
    }

    function setActivePresetInSettings(apiId, name) {
        if (!settings) return;
        if (apiId === 'openai') {
            settings.next.oai_settings.preset_settings_openai = name;
        } else {
            settings.next.power_user[apiId] ||= {};
            settings.next.power_user[apiId].preset = name;
            if (apiId === 'sysprompt' || apiId === 'reasoning' || Object.hasOwn(settings.next.power_user[apiId], 'name')) {
                settings.next.power_user[apiId].name = name;
            }
        }
    }

    function removeUnsavedPresetOrphans(apiId, keepName = '') {
        let removedActiveOrphan = false;
        const currentSettingActive = getActivePresetInSettings(apiId);
        for (const record of [...records.values()]) {
            if (
                record.kind === 'preset' &&
                record.apiId === apiId &&
                record.raw === undefined &&
                record.name !== keepName
            ) {
                if (currentSettingActive === record.name) {
                    removedActiveOrphan = true;
                }
                records.delete(record.id);
                clearRecordText(record);
            }
        }
        if (removedActiveOrphan) {
            setActivePresetInSettings(apiId, keepName || getBaselineActivePreset(apiId));
        }
    }

    function render() {
        if (!alive()) return;
        bindings.clear();
        const p = {
            key,
            sprite: iconSpriteUrl(),
            loading,
            busy,
            error,
            conflict,
            resources: [],
            actions: [],
            groups: [],
            onField: edit,
            onAction: (action, value) => void act(action, value),
        };
        if (!loading && settings) {
            const oai = settings.next.oai_settings;
            if (key === 'left-nav-panel') {
                p.resources.push(resource('preset', '回复预设', selectedPresets.openai, [emptyOption, ...presetOptions('openai')]));
                p.actions.push(
                    ...actions(
                        ['preset-apply', '应用预设'],
                        ['preset-save', '保存预设'],
                        ['preset-save-as', '另存预设'],
                        ['preset-import', '导入', { accept: '.json,application/json' }],
                        ['preset-export', '导出'],
                    ),
                );
                p.groups.push({ id: 'model', title: '前台模型', fields: modelFields(), actions: actions(['models', '模型设置']) });
                p.groups.push(
                    group(
                        'reply',
                        '回复参数',
                        settings,
                        ['oai_settings'],
                        replyFields.map(spec => {
                            const pinned =
                                projection?.eligible &&
                                { temp_openai: 'temperature', top_p_openai: 'topP', reasoning_effort: 'reasoningEffort' }[spec.name];
                            return pinned && projection.pinned[pinned] !== undefined ? { ...spec, disabled: true } : spec;
                        }),
                    ),
                );
                if (projection?.eligible) {
                    for (const f of p.groups.at(-1).fields) {
                        const name = bindings.get(f.key)?.spec.name;
                        const pinned = { temp_openai: 'temperature', top_p_openai: 'topP', reasoning_effort: 'reasoningEffort' }[name];
                        if (pinned && projection.pinned[pinned] !== undefined) {
                            f.value = projection.pinned[pinned];
                            bindings.get(f.key).disabled = true;
                        }
                    }
                }
                p.groups.push(
                    group('continuation', '续写', settings, ['power_user'], [
                        rawField('auto_continue.enabled', '自动续写', 'boolean'),
                        rawField('auto_continue.allow_chat_completions', '允许聊天补全续写', 'boolean'),
                        rawField('auto_continue.target_length', '续写目标长度', 'number', { min: 0, step: 1 }),
                        rawField('quick_continue', '快速续写', 'boolean'),
                        rawField('continue_on_send', '发送时续写', 'boolean'),
                        rawField('custom_stopping_strings', '停止字符串', 'code'),
                    ]),
                );
                p.groups.push(
                    group('logit-bias', 'Token 偏置', settings, ['oai_settings'], [
                        rawField('bias_preset_selected', '偏置预设', 'select', {
                            options: Object.keys(oai.bias_presets || {}).map(name => ({ value: name, label: name })),
                        }),
                        rawField('bias_presets', '偏置定义', 'json'),
                    ]),
                );
            } else if (key === 'AdvancedFormatting') {
                p.resources.push(resource('template', '格式模板', selectedTemplate, options(['context', 'instruct', 'sysprompt', 'reasoning'])));
                p.resources.push(
                    resource('template-preset', '模板预设', selectedPresets[selectedTemplate], [
                        emptyOption,
                        ...presetOptions(selectedTemplate),
                    ]),
                );
                p.actions.push(
                    ...actions(
                        ['template-apply', '应用模板'],
                        ['template-save', '保存模板'],
                        ['template-save-as', '另存模板'],
                        ['template-import', '导入模板', { accept: '.json,application/json' }],
                        ['template-export', '导出模板'],
                        ['prompt-add', '新增提示词'],
                        ['prompt-delete', '删除提示词', { disabled: !selectedPromptObject() || builtinPrompts.has(selectedPrompt) }],
                    ),
                );
                const prompts = Array.isArray(oai.prompts) ? oai.prompts : [];
                if (!selectedPrompt && prompts.length) selectedPrompt = prompts[0].identifier;
                p.items = prompts.map(prompt => ({
                    id: prompt.identifier,
                    name: prompt.name || prompt.identifier,
                    selected: prompt.identifier === selectedPrompt,
                }));
                const order = promptOrder();
                p.resources.push(
                    resource(
                        'scope',
                        '提示词作用域',
                        selectedScope,
                        (oai.prompt_order || []).map(scope => ({
                            value: String(scope.character_id),
                            label: String(scope.character_id),
                        })),
                    ),
                );
                p.order = (order?.order || []).map(item => ({
                    id: item.identifier,
                    name: prompts.find(prompt => prompt.identifier === item.identifier)?.name || item.identifier,
                    enabled: item.enabled === true,
                }));
                const index = prompts.findIndex(prompt => prompt.identifier === selectedPrompt);
                if (index >= 0) {
                    p.groups.push(
                        group(
                            'prompt',
                            '提示词',
                            settings,
                            ['oai_settings', 'prompts', String(index)],
                            promptFields.map(spec =>
                                spec.name === 'identifier' ||
                                (builtinPrompts.has(selectedPrompt) && ['system_prompt', 'marker'].includes(spec.name))
                                    ? { ...spec, disabled: true }
                                    : spec,
                            ),
                        ),
                    );
                }
                p.groups.push(
                    group(
                        'format',
                        selectedTemplate,
                        settings,
                        ['power_user', selectedTemplate],
                        dataFields(formatDefaults[selectedTemplate]).map(spec =>
                            spec.kind === 'text' && !['name', 'preset', 'names_behavior', 'activation_regex'].includes(spec.name)
                                ? { ...spec, kind: 'code' }
                                : spec,
                        ),
                    ),
                );
                p.groups.push(
                    group(
                        'reply-format',
                        '消息与角色格式',
                        settings,
                        ['oai_settings'],
                        [
                            'impersonation_prompt',
                            'new_chat_prompt',
                            'new_group_chat_prompt',
                            'new_example_chat_prompt',
                            'continue_nudge_prompt',
                            'wi_format',
                            'group_nudge_prompt',
                            'scenario_format',
                            'personality_format',
                        ].map(name => rawField(name, name, 'code')),
                    ),
                );
            } else if (key === 'WorldInfo') {
                p.resources.push(
                    resource('world', '世界书', selectedWorld, [emptyOption, ...worlds.map(name => ({ value: name, label: name }))]),
                );
                p.actions.push(
                    ...actions(
                        ['world-new', '新建世界书'],
                        ['world-import', '导入', { accept: '.json,application/json' }],
                        ['world-export', '导出'],
                        ['world-delete', '删除世界书', { disabled: !worldRecord() }],
                        ['entry-add', '新增条目', { disabled: !worldRecord() }],
                        ['entry-delete', '删除条目', { disabled: !worldRecord()?.next.entries?.[selectedPrompt] }],
                    ),
                );
                p.groups.push(
                    group('global-world', '全局世界书', settings, ['world_info_settings', 'world_info'], [
                        rawField('globalSelect', '启用世界书', 'multiselect', {
                            options: worlds.map(name => ({ value: name, label: name })),
                        }),
                    ]),
                );
                p.groups.push(group('world-scan', '扫描与预算', settings, ['world_info_settings'], worldSettingFields));
                const book = worldRecord();
                if (book) {
                    const entries = book.next.entries || {};
                    if (!Object.hasOwn(entries, selectedPrompt)) selectedPrompt = Object.keys(entries)[0] || '';
                    p.items = Object.entries(entries).map(([id, entry]) => ({
                        id,
                        name: entry.comment || `条目 ${id}`,
                        selected: id === selectedPrompt,
                    }));
                    if (entries[selectedPrompt]) {
                        p.groups.push(group('entry', '条目', book, ['entries', selectedPrompt], worldFields));
                        if (settings.next.extension_settings.EjsTemplate?.code_editor) {
                            p.groups.at(-1).actions = actions(['code-edit', '代码编辑']);
                        }
                    }
                }
                const char = charRecord();
                if (char) {
                    p.groups.push(
                        group('character-world', '角色世界书', char, ['data', 'extensions'], [
                            rawField('world', '主世界书', 'select', {
                                options: [emptyOption, ...worlds.map(name => ({ value: name, label: name }))],
                            }),
                        ]),
                    );
                    const filename = selectedCharacter.replace(/\.[^.]+$/, '');
                    const list = settings.next.world_info_settings.world_info.charLore || [];
                    const index = list.findIndex(row => row.name === filename);
                    const value = index < 0 ? [] : list[index].extraBooks || [];
                    const id = 'character-extra-worlds';
                    bindings.set(id, { special: 'extra-books', filename });
                    p.groups.push({
                        id: 'extra-books',
                        title: '角色附加世界书',
                        fields: [
                            {
                                key: id,
                                label: '世界书',
                                kind: 'multiselect',
                                value,
                                options: worlds.map(name => ({ value: name, label: name })),
                            },
                        ],
                    });
                }
                p.groups.push(
                    group(
                        'chat-world',
                        '当前聊天',
                        metadata,
                        [],
                        [
                            rawField('world_info', '绑定世界书', 'select', {
                                options: [emptyOption, ...worlds.map(name => ({ value: name, label: name }))],
                            }),
                        ],
                        { disabled: !canMetadata() },
                    ),
                );
            } else if (key === 'PersonaManagement') {
                p.resources.push(
                    resource('persona', '人设', selectedPersona, [
                        emptyOption,
                        ...avatars.map(id => ({ value: id, label: settings.next.power_user.personas?.[id] || id })),
                    ]),
                );
                p.actions.push(
                    ...actions(
                        ['persona-upload', '上传头像', { accept: 'image/*' }],
                        ['persona-delete', '删除人设', { disabled: !selectedPersona }],
                        ['persona-select', '设为当前人设', { disabled: !selectedPersona }],
                    ),
                );
                p.gallery = avatars.map(id => ({
                    id,
                    name: settings.next.power_user.personas?.[id] || id,
                    src: `/User Avatars/${encodeURIComponent(id)}`,
                    selected: id === selectedPersona,
                }));
                if (selectedPersona) {
                    p.groups.push({
                        id: 'persona-name',
                        title: '人设',
                        fields: [bind(settings, ['power_user', 'personas', selectedPersona], rawField('name', '名称'))],
                    });
                    p.groups.push(
                        group('persona', '描述与绑定', settings, ['power_user', 'persona_descriptions', selectedPersona], personaFields),
                    );
                }
                p.groups.push(
                    group('persona-behavior', '人设选择', settings, ['power_user'], [
                        rawField('default_persona', '默认人设', 'select', {
                            options: [
                                emptyOption,
                                ...avatars.map(id => ({ value: id, label: settings.next.power_user.personas?.[id] || id })),
                            ],
                        }),
                        rawField('persona_auto_lock', '自动锁定聊天人设', 'boolean'),
                        rawField('persona_allow_multi_connections', '允许多个绑定人设', 'boolean'),
                        rawField('persona_show_notifications', '显示人设切换提示', 'boolean'),
                    ]),
                );
                p.groups.push(
                    group(
                        'persona-chat',
                        '当前聊天',
                        metadata,
                        [],
                        [
                            rawField('persona', '锁定人设', 'select', {
                                options: [
                                    emptyOption,
                                    ...avatars.map(id => ({ value: id, label: settings.next.power_user.personas?.[id] || id })),
                                ],
                            }),
                        ],
                        { disabled: !canMetadata() },
                    ),
                );
            } else if (key === 'Backgrounds') {
                p.actions.push(
                    ...actions(
                        ['background-upload', '上传背景', { accept: 'image/*' }],
                        ['background-rename', '重命名'],
                        ['background-delete', '删除背景'],
                    ),
                );
                p.gallery = backgrounds.map(row => ({
                    id: row.filename,
                    name: row.filename,
                    src:
                        row.isAnimated && !settings.next.background?.animation
                            ? `/thumbnail?type=bg&file=${encodeURIComponent(row.filename)}`
                            : `/backgrounds/${encodeURIComponent(row.filename)}`,
                    selected: settings.next.background?.name === row.filename,
                }));
                p.groups.push(
                    group('background', '背景', settings, ['background'], [
                        rawField('name', '文件名', 'text', { disabled: true }),
                        rawField('fitting', '填充方式', 'select', {
                            options: options(['classic', 'cover', 'contain', 'stretch', 'center']),
                        }),
                        rawField('animation', '播放动画缩略图', 'boolean'),
                    ]),
                );
                p.groups.push(
                    group(
                        'background-chat',
                        '当前聊天',
                        metadata,
                        [],
                        [rawField('custom_background', '聊天背景 URL'), rawField('chat_backgrounds', '聊天背景列表', 'list')],
                        { disabled: !canMetadata() },
                    ),
                );
                p.groups.at(-1).actions = actions(
                    ['background-lock', '将当前背景绑定聊天', { disabled: !canMetadata() }],
                    ['background-unlock', '解除聊天背景', { disabled: !canMetadata() }],
                );
            } else if (key === 'user-settings-block') {
                p.actions.push(...actions(['appearance', '外观设置']));
                p.groups.push(group('appearance', '酒馆界面', settings, ['power_user'], appearanceFields));
            } else if (key === 'rm_api_block') {
                p.groups.push({
                    id: 'connection',
                    title: '前台聊天连接',
                    fields: modelFields(),
                    actions: actions(['models', '模型设置'], ['connection-reload', '刷新状态']),
                });
            } else if (key === 'right-nav-panel') {
                p.resources.push(
                    resource('character', '角色卡', selectedCharacter, [
                        emptyOption,
                        ...characters.map(char => ({ value: char.avatar, label: char.name || char.avatar })),
                    ]),
                );
                p.actions.push(
                    ...actions(
                        ['character-new', '新建角色卡'],
                        ['character-import', '导入角色卡', { accept: '.json,.png,.webp,.charx' }],
                        ['character-export', '导出角色卡', { disabled: !charRecord() }],
                        ['character-duplicate', '复制角色卡', { disabled: !charRecord() }],
                        ['character-delete', '删除角色卡', { disabled: !charRecord() }],
                    ),
                );
                if (charRecord()) p.groups.push(group('character', '角色卡内容', charRecord(), ['data'], characterFields));
            } else if (key === 'rm_extensions_block') {
                p.groups.push(
                    group(
                        'ejs',
                        '提示词模板 EJS',
                        settings,
                        ['extension_settings', 'EjsTemplate'],
                        dataFields(ejsDefaults, ejsLabels).map(spec =>
                            spec.name === 'cache_enabled'
                                ? {
                                      ...spec,
                                      kind: 'select',
                                      numeric: true,
                                      options: options([
                                          { value: 0, label: '禁用' },
                                          { value: 1, label: '启用' },
                                          { value: 2, label: '仅世界书' },
                                      ]),
                                  }
                                : spec.name === 'cache_hasher'
                                  ? { ...spec, kind: 'select', options: options(['h32ToString', 'h64ToString']) }
                                  : spec.kind === 'number'
                                    ? { ...spec, min: spec.name === 'depth_limit' ? -1 : 0, step: 1 }
                                    : spec,
                        ),
                    ),
                );
                p.groups.push(
                    group(
                        'helper-render',
                        '酒馆助手渲染',
                        settings,
                        ['extension_settings', 'tavern_helper', 'render'],
                        dataFields(helperDefaults.render, renderLabels).map(spec =>
                            spec.name === 'collapse_code_block'
                                ? {
                                      ...spec,
                                      kind: 'select',
                                      options: options([
                                          { value: 'none', label: '不折叠' },
                                          { value: 'frontend_only', label: '仅前端代码' },
                                          { value: 'all', label: '全部' },
                                      ]),
                                  }
                                : spec,
                        ),
                    ),
                );
                p.groups.push(
                    group('helper-script', '脚本启用范围', settings, ['extension_settings', 'tavern_helper', 'script', 'enabled'], [
                        rawField('global', '全局脚本', 'boolean'),
                        rawField('presets', '启用的预设', 'list'),
                        rawField('characters', '启用的角色', 'list'),
                    ]),
                );
                p.groups.push(
                    group('helper-global', '全局脚本与变量', settings, ['extension_settings'], [
                        rawField('tavern_helper.script.scripts', '脚本与文件夹', 'json', { fallback: [] }),
                        rawField('variables.global', '全局变量', 'json', { fallback: {} }),
                        rawField('regex', '正则脚本', 'json', { fallback: [] }),
                    ]),
                );
                const preset = presetRecord('openai');
                p.resources.push(
                    resource('extension-preset', '扩展预设', selectedPresets.openai, [emptyOption, ...presetOptions('openai')]),
                );
                if (preset) {
                    p.groups.push(
                        group('helper-preset', '预设脚本与变量', preset, ['extensions'], [
                            rawField('tavern_helper.scripts', '脚本与文件夹', 'json', { fallback: [] }),
                            rawField('tavern_helper.variables', '预设变量', 'json', { fallback: {} }),
                            rawField('regex_scripts', '正则脚本', 'json', { fallback: [] }),
                        ]),
                    );
                }
                p.resources.push(
                    resource('character', '扩展角色', selectedCharacter, [
                        emptyOption,
                        ...characters.map(char => ({ value: char.avatar, label: char.name || char.avatar })),
                    ]),
                );
                if (charRecord()) {
                    p.groups.push(
                        group('helper-character', '角色脚本与变量', charRecord(), ['data', 'extensions'], [
                            rawField('tavern_helper.scripts', '脚本与文件夹', 'json', { fallback: [] }),
                            rawField('tavern_helper.variables', '角色变量', 'json', { fallback: {} }),
                            rawField('regex_scripts', '正则脚本', 'json', { fallback: [] }),
                        ]),
                    );
                }
                p.groups.push(group('author-note', '当前聊天作者注释', metadata, [], noteFields, { disabled: !canMetadata() }));
            }
        }
        const isDirty = dirty();
        lastState = {
            ...p,
            dirty: isDirty,
            selectedTemplate,
            selectedPresets: { ...selectedPresets },
            selectedWorld,
            selectedPersona,
            selectedCharacter,
            selectedPrompt,
            selectedScope,
            worlds: [...worlds],
            avatars: [...avatars],
            backgrounds: [...backgrounds],
            characters: [...characters],
            projection,
            projectionError,
            canMetadata: canMetadata(),
        };
        onUpdate(lastState);
        setHeader({
            dirty: isDirty,
            working: busy,
            disabled: loading || busy || !isDirty,
            onSave: () => void save(),
            onDiscard: () => void discard(),
        });
    }

    function edit(id, value) {
        if (!alive() || busy || loading || codeEditor) return;
        if (id.startsWith('order:')) {
            const row = promptOrder()?.order?.find(item => item.identifier === id.slice(6));
            if (row) row.enabled = value === true;
            render();
            return;
        }
        const target = bindings.get(id);
        if (!target || target.disabled || target.spec?.disabled) return;
        if (target.special === 'extra-books') {
            const info = settings.next.world_info_settings.world_info;
            info.charLore ||= [];
            const index = info.charLore.findIndex(row => row.name === target.filename);
            if (index < 0) info.charLore.push({ name: target.filename, extraBooks: value });
            else info.charLore[index].extraBooks = value;
            render();
            return;
        }
        const { record, path, spec } = target;
        if (record.kind === 'metadata' && !canMetadata()) return;
        let parsed = value;
        errors.delete(id);
        if (spec.kind === 'list' && typeof value === 'string') {
            textDrafts.set(id, value);
            parsed = value.split('\n').map((s) => s.trim()).filter(Boolean);
        } else if (spec.kind === 'json' || spec.kind === 'number') {
            textDrafts.set(id, String(value));
            try {
                if (spec.kind === 'json') {
                    parsed = JSON.parse(String(value));
                    const baseline = get(record.view, path) ?? spec.fallback ?? {};
                    if (Array.isArray(baseline) !== Array.isArray(parsed) || (!Array.isArray(parsed) && !object(parsed))) {
                        throw new Error('格式不匹配');
                    }
                    if (
                        spec.name.endsWith('scripts') &&
                        spec.name.includes('tavern_helper') &&
                        !parsed.every(
                            item =>
                                object(item) &&
                                ['script', 'folder'].includes(item.type) &&
                                typeof item.id === 'string' &&
                                typeof item.name === 'string' &&
                                (item.type !== 'folder' || Array.isArray(item.scripts)),
                        )
                    ) {
                        throw new Error('脚本格式不匹配');
                    }
                } else {
                    if (String(value).trim() === '' && spec.nullable) parsed = null;
                    else {
                        if (String(value).trim() === '' || !Number.isFinite(Number(value))) throw new Error('请输入数字');
                        parsed = Number(value);
                        if ((spec.min !== undefined && parsed < spec.min) || (spec.max !== undefined && parsed > spec.max)) {
                            throw new Error('超出范围');
                        }
                        if (typeof spec.step === 'number') {
                            const units = (parsed - (spec.min ?? 0)) / spec.step;
                            if (Math.abs(units - Math.round(units)) > 1e-7) throw new Error('步长不匹配');
                        }
                    }
                }
            } catch {
                errors.set(id, spec.kind === 'json' ? '请输入有效且类型匹配的 JSON。' : '请输入范围内的有效数字。');
                render();
                return;
            }
        } else if (spec.nullableBoolean) parsed = value === 'null' ? null : value === 'true';
        else if (spec.numeric) parsed = Number(value);
        record.next = put(record.next, path, parsed);
        render();
    }

    function performDiscardCleanup() {
        for (const record of [...records.values()]) {
            if (record.raw === undefined) {
                records.delete(record.id);
                if (record.kind === 'world') worlds = worlds.filter(name => name !== record.name);
            } else {
                record.next = copy(record.view);
            }
        }
        if (settings) {
            selectedPresets.openai = settings.next.oai_settings?.preset_settings_openai || '';
            for (const apiId of ['context', 'instruct', 'sysprompt', 'reasoning']) {
                selectedPresets[apiId] =
                    settings.next.power_user?.[apiId]?.preset || settings.next.power_user?.[apiId]?.name || '';
            }
        }
        if (selectedWorld && !worlds.includes(selectedWorld)) {
            selectedWorld = worlds[0] || '';
            selectedPrompt = '';
        }
        textDrafts.clear();
        errors.clear();
        error = '';
        conflict = false;
        render();
    }

    async function discard(skipConfirm = false) {
        if (!alive() || busy || !dirty()) return false;
        if (!skipConfirm && opts.onConfirmDiscard) {
            const ok = await opts.onConfirmDiscard();
            if (!ok || !alive()) return false;
        }
        performDiscardCleanup();
        return true;
    }

    function clearRecordText(record) {
        for (const id of [...textDrafts.keys()]) {
            if (JSON.parse(id)[0] === record.id) {
                textDrafts.delete(id);
                errors.delete(id);
            }
        }
    }

    function clearPathText(record, path, { splice = false } = {}) {
        for (const id of [...textDrafts.keys()]) {
            const parts = JSON.parse(id);
            if (
                parts[0] !== record.id ||
                !path.slice(0, -1).every((part, index) => String(parts[index + 1]) === String(part))
            ) {
                continue;
            }
            const offset = path.length;
            const last = path.at(-1);
            const selected = parts[offset];
            if (String(selected) === String(last)) {
                textDrafts.delete(id);
                errors.delete(id);
            } else if (splice && Number(selected) > Number(last)) {
                const text = textDrafts.get(id);
                const validation = errors.get(id);
                textDrafts.delete(id);
                errors.delete(id);
                parts[offset] = String(Number(selected) - 1);
                const next = JSON.stringify(parts);
                textDrafts.set(next, text);
                if (validation) errors.set(next, validation);
            }
        }
    }

    function clearWorldbookSettings(value, name) {
        for (const info of [value?.world_info_settings?.world_info, value?.world_info]) {
            if (Array.isArray(info?.globalSelect) && info.globalSelect.includes(name)) {
                info.globalSelect = info.globalSelect.filter(book => book !== name);
            }
            if (Array.isArray(info?.charLore)) {
                info.charLore = info.charLore.map(row =>
                    Array.isArray(row?.extraBooks) && row.extraBooks.includes(name)
                        ? { ...row, extraBooks: row.extraBooks.filter(book => book !== name) }
                        : row,
                );
            }
        }
        return value;
    }

    async function detachWorldbook(name) {
        const chat = metadata;
        const chatKey = metadataExpectedKey;
        const view = clearWorldbookSettings(copy(settings.view), name);
        const changes = documentChanges(settings.raw, settings.view, view);
        if (changes.length) {
            await post('/api/settings/save', { vc_changes: changes });
            if (!alive()) return false;
            settings.raw = applyDocumentValues(copy(settings.raw), changes);
            settings.view = view;
            clearWorldbookSettings(settings.next, name);
            await opts.onSettingsCommit?.(changes, copy(settings.raw));
        }
        if (!alive()) return false;

        const cards = await readCharacters({ fresh: true });
        if (!alive()) return false;
        const loaded = [...records.values()].filter(record => record.kind === 'character');
        const candidates = new Set(
            [...(Array.isArray(cards) ? cards : []), ...loaded.map(record => record.raw)]
                .filter(card => card?.avatar && card.data?.extensions?.world === name)
                .map(card => card.avatar),
        );
        for (const avatar of candidates) {
            const fresh = await readCharacterDetail(avatar, { fresh: true });
            if (!alive()) return false;
            if (fresh?.data?.extensions?.world !== name) continue;
            await post('/api/characters/merge-attributes', { avatar, data: { extensions: { world: '' } } });
            if (!alive()) return false;
            const record = records.get(`character:${avatar}`);
            for (const document of [record?.raw, record?.view, record?.next]) {
                if (document?.data?.extensions?.world === name) document.data.extensions.world = '';
            }
            await opts.onCharacterSaved?.(avatar);
            if (!alive()) return false;
        }

        if (chat?.raw?.world_info === name) {
            if (metadata !== chat || metadataExpectedKey !== chatKey || !canMetadata()) {
                throw new Error('聊天已切换或尚未就绪，聊天绑定尚未保存；其他设置可继续保存。');
            }
            const next = { ...chat.view, world_info: '' };
            const metadataChanges = documentChanges(chat.raw, chat.view, next);
            await opts.onMetadataCommit(metadataChanges, chatKey);
            if (!alive()) return false;
            chat.raw = applyDocumentValues(copy(chat.raw), metadataChanges);
            chat.view = next;
        }
        return true;
    }

    async function commitDirtyRecords() {
        for (const record of [...records.values()]) {
            if (!changed(record)) continue;
            const changes =
                record.raw === undefined
                    ? [{ path: [], before: { exists: false }, after: { exists: true, value: copy(record.next) } }]
                    : documentChanges(record.raw, record.view, record.next);
            if (record.kind === 'metadata') {
                if (!canMetadata()) {
                    throw new Error('聊天已切换或尚未就绪，聊天绑定尚未保存；其他设置可继续保存。');
                }
                await opts.onMetadataCommit(changes, metadataExpectedKey);
            } else if (record.kind === 'character') {
                const fresh = await readCharacterDetail(record.avatar, { fresh: true });
                if (!alive()) return false;
                if (!documentEqual(fresh.data, record.raw.data)) {
                    const cause = new Error('角色卡已在另一处更新。');
                    cause.status = 409;
                    throw cause;
                }
                const update = {};
                for (const change of changes) {
                    if (change.path[0] !== 'data') continue;
                    if (change.after.exists) put(update, change.path, change.after.value);
                }
                await post('/api/characters/merge-attributes', { avatar: record.avatar, ...update });
            } else {
                const url =
                    record.kind === 'settings'
                        ? '/api/settings/save'
                        : record.kind === 'preset'
                          ? '/api/presets/save'
                          : '/api/worldinfo/edit';
                await post(url, {
                    ...(record.name ? { name: record.name } : {}),
                    ...(record.apiId ? { apiId: record.apiId } : {}),
                    vc_changes: changes,
                });
            }
            if (!alive()) return false;
            const canonical = applyDocumentValues(copy(record.raw), changes);
            record.raw = copy(canonical);
            record.view = copy(record.next);
            clearRecordText(record);
            if (record.kind === 'settings') await opts.onSettingsCommit?.(changes, copy(canonical));
            else if (record.kind === 'preset') await opts.onPresetCommit?.(record.apiId, record.name, changes, copy(canonical));
            else if (record.kind === 'world') await opts.onWorldbookCommit?.(record.name, copy(canonical));
            else if (record.kind === 'character') {
                await opts.onCharacterSaved?.(record.avatar);
                const card = characters.find(c => c.avatar === record.avatar);
                if (card && canonical?.data?.name) card.name = canonical.data.name;
            }
            if (!alive()) return false;
        }
        return true;
    }

    async function save({ checkValidity } = {}) {
        if (!alive() || busy || loading || codeEditor) return false;
        const validForm = typeof checkValidity === 'function' ? checkValidity() : (opts.checkValidity ? opts.checkValidity() : true);
        if (!validForm || errors.size) {
            error = '请先修正标出的输入。';
            render();
            return false;
        }
        let saved = false;
        await run(async () => {
            const ok = await commitDirtyRecords();
            if (ok && alive()) {
                saved = true;
                notify('已保存');
            }
        });
        return saved;
    }

    async function run(operation, { mutation = true } = {}) {
        if (!alive() || busy) return;
        busy = true;
        error = '';
        conflict = false;
        render();
        try {
            if (mutation && typeof opts.runMutation === 'function') {
                await opts.runMutation(operation);
            } else {
                await operation();
            }
        } catch (cause) {
            fail(cause);
        } finally {
            if (alive()) {
                busy = false;
                render();
            }
        }
    }

    function download(value, name) {
        if (!alive()) return;
        if (opts.onDownload) {
            opts.onDownload(value, name);
            return;
        }
        if (typeof document === 'undefined' || typeof URL?.createObjectURL !== 'function') return;
        const blob = value instanceof Blob ? value : new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = name;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function askName(title, initial, complete) {
        if (!alive() || busy) return;
        if (opts.onAskName) {
            opts.onAskName({
                title,
                initial: initial || '',
                validate: validateTavernName,
                onConfirm: name => {
                    if (!alive()) return;
                    void Promise.resolve()
                        .then(() => complete(name))
                        .catch(fail);
                },
            });
        }
    }

    async function confirm(req) {
        if (!alive()) return false;
        if (opts.onConfirm) {
            const ok = await opts.onConfirm(req);
            return Boolean(ok) && alive();
        }
        return true;
    }

    async function upload(url, file, extra = {}) {
        if (opts.onUpload) {
            return opts.onUpload(url, file, extra, ac.signal);
        }
        const body = new FormData();
        body.append('avatar', file);
        for (const [name, value] of Object.entries(extra)) body.append(name, value);
        const headers = new Headers(client.headers());
        headers.delete('Content-Type');
        const response = await fetch(url, { method: 'POST', headers, body, credentials: 'same-origin', signal: ac.signal });
        if (!response.ok) {
            const cause = new Error('上传没有完成，请重试。');
            cause.status = response.status;
            throw cause;
        }
        return response;
    }

    async function loadCharacter(avatar, id = ticket, { fresh = false } = {}) {
        if (!avatar || (!fresh && records.has(`character:${avatar}`))) return;
        const raw = await readCharacterDetail(avatar, { fresh });
        if (!alive(id)) return;
        if (!object(raw.data)) throw new Error('角色卡缺少 V2 data。');
        addRecord(`character:${avatar}`, 'character', raw, {}, { avatar });
    }

    async function importCharacter(file) {
        const format = file.name.split('.').at(-1).toLowerCase();
        const response = await upload('/api/characters/import', file, { file_type: format });
        const result = await response.json();
        if (!alive()) return;
        characters = await readCharacters({ fresh: true });
        if (!alive()) return;
        selectedCharacter = String(result.file_name).replace(/\.png$/, '') + '.png';
        await loadCharacter(selectedCharacter, ticket, { fresh: true });
        await opts.onCharacterSaved?.(selectedCharacter);
    }

    async function executeCharacterDeletion(avatar, deleteChats) {
        if (!alive() || !avatar) return;
        await run(async () => {
            await opts.onDeleteCharacter?.(avatar, deleteChats);
            if (!alive()) return;
            records.delete(`character:${avatar}`);
            characters = characters.filter(card => card.avatar !== avatar);
            selectedCharacter = characters[0]?.avatar || '';
            await loadCharacter(selectedCharacter);
        });
    }

    function chooseCharacterDeletion() {
        const avatar = selectedCharacter;
        if (!avatar || !alive()) return;
        if (opts.onChooseCharacterDeletion) {
            opts.onChooseCharacterDeletion({
                avatar,
                onSelect: async (deleteChats, label) => {
                    if (!alive()) return;
                    if (!(await confirm({ title: `${label}？`, confirmLabel: '删除', danger: true }))) return;
                    await executeCharacterDeletion(avatar, deleteChats);
                },
            });
        }
    }

    async function loadWorld(name, id = ticket, { fresh = false } = {}) {
        if (!name || (!fresh && records.has(`world:${name}`))) return;
        const raw = await readWorldbook(name, { fresh });
        if (!alive(id)) return;
        const record = addRecord(`world:${name}`, 'world', parseObject(raw, '世界书'), { entries: {} }, { name });
        for (const entryId of Object.keys(record.next.entries || {})) {
            record.next.entries[entryId] = withDefaults(record.next.entries[entryId], worldEntryDefaults);
        }
        record.view = copy(record.next);
    }

    function templateDraft(api) {
        if (api !== 'openai') return settings.next.power_user[api];
        const next = copy(settings.next.oai_settings);
        delete next.preset_settings_openai;
        for (const [presetKey, settingKey] of Object.entries(openaiPresetFields)) {
            if (Object.hasOwn(next, settingKey)) {
                next[presetKey] = next[settingKey];
                delete next[settingKey];
            }
        }
        return { ...copy(presetRecord('openai')?.next), ...next };
    }

    function applyPreset(api) {
        const preset = presetRecord(api);
        if (!preset) throw new Error('请先选择预设。');
        const data = portablePreset(preset.next);
        if (api === 'openai') {
            for (const [presetKey, settingKey] of Object.entries(openaiPresetFields)) {
                if (Object.hasOwn(data, presetKey)) {
                    data[settingKey] = data[presetKey];
                    delete data[presetKey];
                }
            }
            const locked = Object.fromEntries(
                ['custom_model', 'claude_model', 'openai_max_context', 'openai_max_tokens', 'chat_completion_source', 'custom_url', 'reverse_proxy']
                    .filter(name => Object.hasOwn(settings.next.oai_settings, name))
                    .map(name => [name, settings.next.oai_settings[name]]),
            );
            settings.next.oai_settings = {
                ...settings.next.oai_settings,
                ...copy(data),
                ...locked,
                preset_settings_openai: preset.name,
            };
            if (projection?.eligible) {
                for (const [name, pinned] of Object.entries({
                    temp_openai: 'temperature',
                    top_p_openai: 'topP',
                    reasoning_effort: 'reasoningEffort',
                })) {
                    if (projection.pinned[pinned] !== undefined) {
                        settings.next.oai_settings[name] = projection.pinned[pinned];
                    }
                }
            }
        } else {
            settings.next.power_user[api] = {
                ...settings.next.power_user[api],
                ...copy(data),
                [api === 'context' || api === 'instruct' ? 'preset' : 'name']: preset.name,
                preset: preset.name,
            };
        }
    }

    function reorderPrompts(orderedIds) {
        if (!alive() || busy || loading || !Array.isArray(orderedIds)) return;
        const scope = promptOrder();
        if (!scope || !Array.isArray(scope.order)) return;
        const byId = new Map(scope.order.map(item => [item.identifier, item]));
        const nextOrder = [];
        for (const id of orderedIds) {
            const item = byId.get(String(id));
            if (item) {
                nextOrder.push(item);
                byId.delete(String(id));
            }
        }
        for (const item of byId.values()) nextOrder.push(item);
        scope.order = nextOrder;
        render();
    }

    async function act(action, value) {
        if (!alive() || busy) return;
        if (action === 'save') {
            await save();
            return;
        }
        if (action === 'reload') {
            if (dirty() && opts.onConfirmDiscard) {
                if (!(await opts.onConfirmDiscard()) || !alive()) return;
            }
            await load({ fresh: true });
            return;
        }
        if (action === 'models' || action === 'appearance') {
            if ((await api.requestLeave()) && alive()) {
                (action === 'models' ? opts.onOpenModels : opts.onOpenAppearance)?.();
            }
            return;
        }
        if (action === 'select-template') {
            selectedTemplate = String(value);
            render();
            return;
        }
        if (action === 'select-template-preset') {
            const nextName = String(value);
            removeUnsavedPresetOrphans(selectedTemplate, nextName);
            selectedPresets[selectedTemplate] = nextName;
            render();
            return;
        }
        if (action === 'select-preset' || action === 'select-extension-preset') {
            const nextName = String(value);
            removeUnsavedPresetOrphans('openai', nextName);
            selectedPresets.openai = nextName;
            render();
            return;
        }
        if (action === 'select-scope') {
            selectedScope = String(value);
            render();
            return;
        }
        if (action === 'select-item') {
            selectedPrompt = String(value);
            render();
            return;
        }
        if (action === 'code-edit') {
            const record = worldRecord();
            const uid = selectedPrompt;
            if (!record?.next.entries?.[uid] || codeEditor) return;
            if (opts.onOpenCodeEditor) {
                codeEditor = opts.onOpenCodeEditor({
                    value: record.next.entries[uid].content || '',
                    onApply: nextVal => {
                        if (alive() && record.next.entries?.[uid]) {
                            record.next.entries[uid].content = nextVal;
                            render();
                        }
                    },
                    onDone: () => {
                        codeEditor = null;
                        if (alive()) render();
                    },
                });
                render();
            }
            return;
        }
        if (action === 'select-persona') {
            selectedPersona = String(value);
            render();
            return;
        }
        if (action === 'select-image' && key === 'PersonaManagement') {
            selectedPersona = String(value);
            render();
            return;
        }
        if (action === 'select-image' && key === 'Backgrounds') {
            settings.next.background = {
                ...settings.next.background,
                name: String(value),
                url: `url("backgrounds/${encodeURIComponent(String(value))}")`,
            };
            render();
            return;
        }
        if (action === 'select-world') {
            await run(
                async () => {
                    await loadWorld(String(value));
                    if (alive()) {
                        selectedWorld = String(value);
                        selectedPrompt = '';
                    }
                },
                { mutation: false },
            );
            return;
        }
        if (action === 'select-character') {
            await run(
                async () => {
                    await loadCharacter(String(value));
                    if (alive()) selectedCharacter = String(value);
                },
                { mutation: false },
            );
            return;
        }
        if (action === 'connection-reload') {
            await run(() => loadProjection({ fresh: true }), { mutation: false });
            return;
        }
        if (action === 'prompt-reorder' && Array.isArray(value)) {
            reorderPrompts(value);
            return;
        }
        if (action === 'prompt-up' || action === 'prompt-down') {
            const rows = promptOrder()?.order;
            const index = rows?.findIndex(item => item.identifier === value);
            const other = index + (action === 'prompt-up' ? -1 : 1);
            if (rows && index >= 0 && other >= 0 && other < rows.length) {
                [rows[index], rows[other]] = [rows[other], rows[index]];
            }
            render();
            return;
        }
        if (action === 'prompt-add') {
            settings.next.oai_settings.prompts ||= [];
            const id = crypto.randomUUID();
            settings.next.oai_settings.prompts.push({
                identifier: id,
                name: '新提示词',
                role: 'system',
                content: '',
                system_prompt: false,
                marker: false,
                injection_position: 0,
                injection_depth: 4,
                injection_order: 100,
                forbid_overrides: false,
                injection_trigger: [],
            });
            for (const scope of settings.next.oai_settings.prompt_order || []) {
                scope.order.push({ identifier: id, enabled: true });
            }
            selectedPrompt = id;
            render();
            return;
        }
        if (action === 'prompt-delete') {
            const prompt = selectedPromptObject();
            if (!prompt || builtinPrompts.has(prompt.identifier)) return;
            if (!(await confirm({ title: '删除提示词？', confirmLabel: '删除', danger: true }))) return;
            clearPathText(settings, ['oai_settings', 'prompts', String(settings.next.oai_settings.prompts.indexOf(prompt))], {
                splice: true,
            });
            settings.next.oai_settings.prompts = settings.next.oai_settings.prompts.filter(
                item => item.identifier !== selectedPrompt,
            );
            for (const scope of settings.next.oai_settings.prompt_order || []) {
                scope.order = scope.order.filter(item => item.identifier !== selectedPrompt);
            }
            selectedPrompt = '';
            render();
            return;
        }
        if (action.startsWith('preset-') || action.startsWith('template-')) {
            const apiId = action.startsWith('preset-') ? 'openai' : selectedTemplate;
            const operation = action.slice(action.indexOf('-') + 1);
            try {
                if (operation === 'apply') {
                    applyPreset(apiId);
                } else if (operation === 'save') {
                    const preset = presetRecord(apiId);
                    if (!preset) throw new Error('请先选择预设。');
                    preset.next = { ...preset.next, ...copy(portablePreset(templateDraft(apiId))) };
                    await save();
                    return;
                } else if (operation === 'save-as') {
                    askName('另存预设', '', name => {
                        const existing = records.get(`preset:${apiId}:${name}`);
                        if (existing && existing.raw !== undefined) {
                            throw new Error('同名预设已存在，请选择其他名称。');
                        }
                        removeUnsavedPresetOrphans(apiId, '');
                        const record = addRecord(`preset:${apiId}:${name}`, 'preset', undefined, {}, { apiId, name });
                        record.next = { ...copy(portablePreset(templateDraft(apiId))), ...(apiId === 'openai' ? {} : { name }) };
                        selectedPresets[apiId] = name;
                        setActivePresetInSettings(apiId, name);
                        render();
                    });
                    return;
                } else if (operation === 'export') {
                    download(portablePreset(templateDraft(apiId)), `${selectedPresets[apiId] || apiId}.json`);
                } else if (operation === 'import' && value instanceof File) {
                    const imported = portablePreset(parseObject(await value.text(), '预设'));
                    if (!alive()) return;
                    askName('导入预设', value.name.replace(/\.json$/i, ''), name => {
                        const existing = records.get(`preset:${apiId}:${name}`);
                        if (existing && existing.raw !== undefined) {
                            throw new Error('同名预设已存在，请选择其他名称。');
                        }
                        removeUnsavedPresetOrphans(apiId, '');
                        const record = addRecord(`preset:${apiId}:${name}`, 'preset', undefined, {}, { apiId, name });
                        record.next = { ...imported, ...(apiId === 'openai' ? {} : { name }) };
                        selectedPresets[apiId] = name;
                        setActivePresetInSettings(apiId, name);
                        render();
                    });
                    return;
                }
                render();
            } catch (cause) {
                fail(cause);
            }
            return;
        }
        if (action === 'world-new' || action === 'world-import') {
            let imported = { entries: {} };
            try {
                if (value instanceof File) imported = parseObject(await value.text(), '世界书');
                if (!object(imported.entries) || !Object.values(imported.entries).every(object)) {
                    throw new Error('请选择包含 entries 对象的酒馆世界书 JSON。');
                }
            } catch (cause) {
                fail(cause);
                return;
            }
            if (!alive()) return;
            askName('世界书名称', value instanceof File ? value.name.replace(/\.json$/i, '') : '', name => {
                if (worlds.includes(name)) throw new Error('同名世界书已存在。');
                const record = addRecord(`world:${name}`, 'world', undefined, {}, { name });
                record.next = copy(imported);
                record.next.entries ||= {};
                for (const entryId of Object.keys(record.next.entries)) {
                    record.next.entries[entryId] = withDefaults(record.next.entries[entryId], worldEntryDefaults);
                }
                worlds.push(name);
                selectedWorld = name;
                selectedPrompt = '';
                render();
            });
            return;
        }
        if (action === 'world-export') {
            if (worldRecord()) download(worldRecord().next, `${selectedWorld}.json`);
            return;
        }
        if (action === 'entry-add') {
            const record = worldRecord();
            if (!record) return;
            record.next.entries ||= {};
            const ids = Object.keys(record.next.entries)
                .map(Number)
                .filter(Number.isFinite);
            const id = String(ids.length ? Math.max(...ids) + 1 : 0);
            record.next.entries[id] = {
                ...copy(worldEntryDefaults),
                uid: Number(id),
                displayIndex: Object.keys(record.next.entries).length,
            };
            selectedPrompt = id;
            render();
            return;
        }
        if (action === 'entry-delete') {
            if (!worldRecord()?.next.entries?.[selectedPrompt]) return;
            if (!(await confirm({ title: '删除条目？', confirmLabel: '删除', danger: true }))) return;
            clearPathText(worldRecord(), ['entries', selectedPrompt]);
            delete worldRecord().next.entries[selectedPrompt];
            selectedPrompt = '';
            render();
            return;
        }
        if (action === 'world-delete') {
            const record = worldRecord();
            if (!record) return;
            if (!(await confirm({ title: '删除世界书？', message: '此操作会删除世界书文件。', confirmLabel: '删除', danger: true }))) {
                return;
            }
            await run(async () => {
                const deletedName = record.name;
                if (record.raw !== undefined) {
                    if (!await detachWorldbook(deletedName)) return;
                    await post('/api/worldinfo/delete', { name: deletedName });
                }
                if (!alive()) return;
                records.delete(record.id);
                worlds = worlds.filter(name => name !== deletedName);
                selectedWorld = worlds[0] || '';
                selectedPrompt = '';
                clearRecordText(record);
                clearWorldbookSettings(settings?.next, deletedName);
                for (const r of records.values()) {
                    if (r.kind === 'character' && r.next?.data?.extensions?.world === deletedName) {
                        r.next.data.extensions.world = '';
                    }
                }
                if (metadata && canMetadata() && metadata.next?.world_info === deletedName) {
                    metadata.next.world_info = '';
                }

                if (record.raw !== undefined) await opts.onWorldbookCommit?.(deletedName, null, 'delete');
                if (!alive()) return;
                if (selectedWorld) {
                    await loadWorld(selectedWorld);
                }
            });
            return;
        }
        if (action === 'persona-select') {
            if (!selectedPersona) return;
            const pu = settings.next.power_user;
            const persona = withDefaults(pu.persona_descriptions?.[selectedPersona], personaDefaults);
            settings.next.user_avatar = selectedPersona;
            settings.next.username = pu.personas?.[selectedPersona] || settings.next.username;
            for (const [from, to] of Object.entries({
                description: 'persona_description',
                position: 'persona_description_position',
                depth: 'persona_description_depth',
                role: 'persona_description_role',
                lorebook: 'persona_description_lorebook',
            })) {
                pu[to] = persona[from];
            }
            if (pu.persona_auto_lock && canMetadata()) metadata.next.persona = selectedPersona;
            render();
            return;
        }
        if (action === 'persona-upload' && value instanceof File) {
            await run(async () => {
                const response = await upload('/api/avatars/upload', value);
                const result = await response.json();
                if (!alive()) return;
                await opts.onAvatarsChanged?.();
                if (!alive()) return;
                avatars.push(result.path);
                selectedPersona = result.path;
                settings.next.power_user.personas ||= {};
                settings.next.power_user.persona_descriptions ||= {};
                settings.next.power_user.personas[result.path] = value.name.replace(/\.[^.]+$/, '');
                settings.next.power_user.persona_descriptions[result.path] = copy(personaDefaults);
            });
            return;
        }
        if (action === 'persona-delete') {
            if (!selectedPersona) return;
            if (!(await confirm({ title: '删除人设？', message: '此操作会删除头像文件。', confirmLabel: '删除', danger: true }))) {
                return;
            }
            await run(async () => {
                await post('/api/avatars/delete', { avatar: selectedPersona });
                if (!alive()) return;
                await opts.onAvatarsChanged?.();
                if (!alive()) return;
                avatars = avatars.filter(id => id !== selectedPersona);
                delete settings.next.power_user.personas?.[selectedPersona];
                delete settings.next.power_user.persona_descriptions?.[selectedPersona];
                if (settings.next.power_user.default_persona === selectedPersona) {
                    settings.next.power_user.default_persona = null;
                }
                selectedPersona = '';
            });
            return;
        }
        if (action === 'background-lock' || action === 'background-unlock') {
            if (canMetadata()) {
                metadata.next = put(
                    metadata.next,
                    ['custom_background'],
                    action === 'background-lock' ? settings.next.background.url : undefined,
                );
                render();
            }
            return;
        }
        if (action === 'background-upload' && value instanceof File) {
            await run(async () => {
                await upload('/api/backgrounds/upload', value);
                if (alive()) {
                    await opts.onBackgroundsChanged?.();
                    const result = await readBackgrounds({ fresh: true });
                    if (alive()) backgrounds = result?.images || [];
                }
            });
            return;
        }
        if (action === 'background-rename') {
            const old = settings.next.background.name;
            askName('背景名称', old, name =>
                void run(async () => {
                    await post('/api/backgrounds/rename', { old_bg: old, new_bg: name });
                    if (!alive()) return;
                    await opts.onBackgroundsChanged?.();
                    if (!alive()) return;
                    backgrounds = backgrounds.map(row => (row.filename === old ? { ...row, filename: name } : row));
                    settings.next.background.name = name;
                    settings.next.background.url = `url("backgrounds/${encodeURIComponent(name)}")`;
                }),
            );
            return;
        }
        if (action === 'background-delete') {
            const bg = settings.next.background.name;
            if (!backgrounds.some(row => row.filename === bg)) return;
            if (!(await confirm({ title: '删除背景？', confirmLabel: '删除', danger: true }))) return;
            await run(async () => {
                await post('/api/backgrounds/delete', { bg });
                if (!alive()) return;
                await opts.onBackgroundsChanged?.();
                if (!alive()) return;
                backgrounds = backgrounds.filter(row => row.filename !== bg);
                settings.next.background.name = '__transparent.png';
                settings.next.background.url = 'url("backgrounds/__transparent.png")';
            });
            return;
        }
        if (action === 'character-export' && charRecord()) {
            await run(async () => {
                const response = await post('/api/characters/export', { avatar_url: selectedCharacter, format: 'json' });
                if (alive()) download(await response.blob(), `${selectedCharacter.replace(/\.[^.]+$/, '')}.json`);
            });
            return;
        }
        if (action === 'character-new') {
            askName('新建角色卡', '', name =>
                void run(() =>
                    importCharacter(
                        new File(
                            [
                                JSON.stringify({
                                    spec: 'chara_card_v2',
                                    spec_version: '2.0',
                                    data: {
                                        name,
                                        description: '',
                                        personality: '',
                                        scenario: '',
                                        first_mes: '',
                                        mes_example: '',
                                        extensions: {},
                                    },
                                }),
                            ],
                            'character.json',
                            { type: 'application/json' },
                        ),
                    ),
                ),
            );
            return;
        }
        if (action === 'character-delete' && charRecord() && opts.onDeleteCharacter) {
            chooseCharacterDeletion();
            return;
        }
        if (action === 'character-import' && value instanceof File) {
            await run(() => importCharacter(value));
            return;
        }
        if (action === 'character-duplicate' && charRecord()) {
            await run(async () => {
                const result = await request('/api/characters/duplicate', { avatar_url: selectedCharacter });
                if (!alive()) return;
                characters = await readCharacters({ fresh: true });
                if (!alive()) return;
                await loadCharacter(result.path, ticket, { fresh: true });
                selectedCharacter = result.path;
                await opts.onCharacterSaved?.(selectedCharacter);
            });
        }
    }

    async function loadProjection({ fresh = false } = {}) {
        try {
            const [purposesRaw, providersRaw] = await Promise.all([
                readPurposes({ fresh }),
                readProviders({ fresh }),
            ]);
            const purposes = Array.isArray(purposesRaw) ? purposesRaw : (purposesRaw?.items ?? []);
            const providers = Array.isArray(providersRaw) ? providersRaw : (providersRaw?.items ?? []);
            if (alive()) {
                projection = resolveForegroundProjection(purposes, providers);
                projectionError = '';
            }
        } catch (cause) {
            if (alive()) {
                projection = null;
                projectionError = cause?.message || '无法读取模型绑定。';
            }
        }
    }

    async function load({ fresh = false } = {}) {
        if (!alive() || busy) return;
        const id = ++ticket;
        loading = true;
        error = '';
        conflict = false;
        settings = undefined;
        metadata = undefined;
        records.clear();
        textDrafts.clear();
        errors.clear();
        selectedPrompt = '';
        selectedScope = '';
        render();
        try {
            const next = await readSettingsDoc({ fresh });
            if (!alive(id)) return;
            packet = next;
            records.clear();
            textDrafts.clear();
            errors.clear();
            const raw = parseObject(packet.settings, '设置');
            settings = addRecord('settings', 'settings', raw, {
                oai_settings: { ...replyDefaults, ...chatCompletionDefaultPrompts, prompt_order: [] },
                power_user: {
                    ...appearanceDefaults,
                    ...formatDefaults,
                    personas: {},
                    persona_descriptions: {},
                    persona_auto_lock: false,
                    persona_allow_multi_connections: false,
                },
                world_info_settings: worldDefaults,
                extension_settings: { EjsTemplate: ejsDefaults, tavern_helper: helperDefaults },
                background: {
                    name: '__transparent.png',
                    url: 'url("backgrounds/__transparent.png")',
                    fitting: 'classic',
                    animation: false,
                },
            });
            if (Array.isArray(settings.next.oai_settings.prompt_order) && !settings.next.oai_settings.prompt_order.length) {
                settings.next.oai_settings.prompt_order = [
                    { character_id: 100001, order: copy(promptManagerDefaultPromptOrder) },
                ];
                settings.view = copy(settings.next);
            }
            for (const [index, name] of (packet.openai_setting_names || []).entries()) {
                addRecord(
                    `preset:openai:${name}`,
                    'preset',
                    parseObject(packet.openai_settings[index], '回复预设'),
                    {},
                    { apiId: 'openai', name },
                );
            }
            for (const apiId of ['context', 'instruct', 'sysprompt', 'reasoning']) {
                for (const presetRaw of packet[apiId] || []) {
                    if (presetRaw?.name) {
                        addRecord(`preset:${apiId}:${presetRaw.name}`, 'preset', presetRaw, {}, { apiId, name: presetRaw.name });
                    }
                }
            }
            selectedPresets.openai = settings.next.oai_settings.preset_settings_openai || '';
            for (const apiId of ['context', 'instruct', 'sysprompt', 'reasoning']) {
                selectedPresets[apiId] =
                    settings.next.power_user[apiId]?.preset || settings.next.power_user[apiId]?.name || '';
            }
            const ctx = context();
            metadataOwner = contextIdentity(ctx);
            metadataExpectedKey = deriveExpectedKey(ctx, getConversationKey);
            metadata = addRecord('metadata', 'metadata', copy(ctx.chatMetadata || ctx.chat_metadata || {}), noteDefaults());
            const tasks = [];
            if (['left-nav-panel', 'rm_api_block'].includes(key)) tasks.push(loadProjection({ fresh }));
            if (key === 'PersonaManagement') {
                tasks.push(
                    readAvatars({ fresh }).then(result => {
                        if (alive(id)) {
                            avatars = Array.isArray(result) ? result : [];
                            selectedPersona = settings.next.user_avatar || avatars[0] || '';
                            for (const avatar of avatars) {
                                settings.next.power_user.persona_descriptions[avatar] = withDefaults(
                                    settings.next.power_user.persona_descriptions[avatar],
                                    personaDefaults,
                                );
                            }
                            settings.view = copy(settings.next);
                        }
                    }),
                );
            }
            if (key === 'Backgrounds') {
                tasks.push(
                    readBackgrounds({ fresh }).then(result => {
                        if (alive(id)) backgrounds = result?.images || [];
                    }),
                );
            }
            if (['right-nav-panel', 'WorldInfo', 'rm_extensions_block'].includes(key)) {
                tasks.push(
                    readCharacters({ fresh }).then(async result => {
                        if (!alive(id)) return;
                        characters = Array.isArray(result) ? result : [];
                        selectedCharacter =
                            opts.initialCharacter || currentAvatar() || characters[0]?.avatar || '';
                        await loadCharacter(selectedCharacter, id, { fresh });
                    }),
                );
            }
            if (key === 'WorldInfo') {
                tasks.push(
                    readWorldbookList({ fresh }).then(async result => {
                        if (!alive(id)) return;
                        worlds = (Array.isArray(result) ? result : []).map(row => row.file_id);
                        selectedWorld = worlds[0] || '';
                        selectedPrompt = '';
                        await loadWorld(selectedWorld, id, { fresh });
                    }),
                );
            }
            await Promise.all(tasks);
        } catch (cause) {
            if (alive(id)) fail(cause);
        } finally {
            if (alive(id)) {
                loading = false;
                render();
            }
        }
    }

    function destroy() {
        if (destroyed) return;
        destroyed = true;
        ++ticket;
        ac.abort();
        codeEditor?.destroy?.();
        codeEditor = null;
        opts.signal?.removeEventListener('abort', destroy);
    }

    const api = {
        getState: () => lastState,
        edit,
        act,
        save,
        discard,
        reload: () => load({ fresh: true }),
        reorderPrompts,
        setCodeEditorState(editor) {
            codeEditor = editor;
            if (alive()) render();
        },
        isDirty: () => alive() && dirty(),
        working: () => alive() && busy,
        async requestLeave() {
            if (!alive()) return true;
            if (busy) return false;
            if (codeEditor?.requestLeave && !(await codeEditor.requestLeave())) return false;
            if (!dirty()) return true;
            if (opts.onConfirmDiscard) {
                return (await opts.onConfirmDiscard()) && alive() && !busy;
            }
            return true;
        },
        refreshContext() {
            if (!alive() || busy || loading || !metadata) return;
            const ctx = context();
            const identity = contextIdentity(ctx);
            if (identity !== metadataOwner) {
                if (changed(metadata)) {
                    error = '聊天已切换，尚未保存的聊天绑定仍保留。';
                } else {
                    metadataOwner = identity;
                    metadataExpectedKey = deriveExpectedKey(ctx, getConversationKey);
                    metadata = addRecord(
                        'metadata',
                        'metadata',
                        copy(ctx.chatMetadata || ctx.chat_metadata || {}),
                        noteDefaults(),
                    );
                }
            }
            render();
        },
        destroy,
    };

    opts.signal?.addEventListener('abort', destroy, { once: true });
    if (opts.signal?.aborted) destroy();
    else void load();

    return api;
}
