// 表情包库、代码频控与 <sticker tag="…"/> 解析纯逻辑（无 DOM 依赖）。

export const GATE_KEY = 'vc_sticker_gate';
export const SETTINGS_KEY = 'vc_stickers';
export const STICKER_FOLDER = 'vc-stickers';
export const WINDOW = 4;

export const FREQUENCIES = [
    { id: 'low', label: '少', probability: 0.35 },
    { id: 'normal', label: '标准', probability: 0.7 },
    { id: 'high', label: '多', probability: 1 },
];

const SERIOUS_KEYWORDS = ['怎么办', '帮帮我', '救命', '求助', '紧急', '去世', '逝世', '自杀', '轻生', '葬礼', '癌症', '抑郁', '病危', '确诊', '离世'];
const TAG_RE = /<sticker\b[^>]*?\btag\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*?\/?>/gi;
export const IMAGE_FORMATS = ['png', 'jpg', 'jpeg', 'webp', 'gif'];

let runtime = {};
let builtinAssets = [];
let catalogOverride;

export function getStickerRuntime() {
    return runtime;
}

export function setStickerRuntime(deps = {}) {
    runtime = { ...runtime, ...deps };
    return runtime;
}

export function getBuiltinStickerAssets() {
    return builtinAssets;
}

export function isSendableTag(value) {
    return /^[\u4e00-\u9fff]{2,4}$/u.test(String(value || '').trim());
}

export function tagFromFilename(filename) {
    const base = String(filename || '').split(/[/\\]/).pop().replace(/\.[^.]+$/, '').trim();
    const stripped = base.replace(/[_\-\s]*\d+$/u, '').trim();
    return isSendableTag(stripped) ? stripped : '';
}

export function stickerSrc(path) {
    const value = String(path || '');
    if (!value || /^(https?:|data:|\/)/.test(value)) return value;
    return `/${value}`;
}

export function loadManifest(raw) {
    if (!raw || typeof raw.license !== 'string') throw new Error('manifest license 必须是字符串');
    if (typeof raw.attribution !== 'string') throw new Error('manifest attribution 必须是字符串');
    if (!raw.stickers || typeof raw.stickers !== 'object' || Array.isArray(raw.stickers)) throw new Error('manifest stickers 无效');
    if (!raw.kaomoji || typeof raw.kaomoji !== 'object' || Array.isArray(raw.kaomoji)) throw new Error('manifest kaomoji 无效');
    return {
        name: typeof raw.name === 'string' ? raw.name : '',
        license: raw.license,
        attribution: raw.attribution,
        stickers: raw.stickers,
        kaomoji: raw.kaomoji,
    };
}

export function assetsFromManifest(manifest, baseUrl) {
    const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    const assets = [];
    const pushImage = (tag, file) => {
        if (!isSendableTag(tag) || typeof file !== 'string' || !file) return;
        assets.push({
            id: `builtin:${tag}:${file}`,
            tag,
            kind: 'image',
            src: new URL(file, base).href,
            source: 'builtin',
            license: manifest.license,
            attribution: manifest.attribution,
        });
    };
    const pushKaomoji = (tag, text) => {
        if (!isSendableTag(tag) || typeof text !== 'string' || !text) return;
        assets.push({
            id: `kaomoji:${tag}:${text}`,
            tag,
            kind: 'kaomoji',
            text,
            source: 'builtin',
            license: manifest.license,
            attribution: manifest.attribution,
        });
    };
    for (const [tag, files] of Object.entries(manifest.stickers || {})) {
        for (const file of files || []) pushImage(tag, file);
    }
    for (const [tag, list] of Object.entries(manifest.kaomoji || {})) {
        for (const text of list || []) pushKaomoji(tag, text);
    }
    return assets;
}

export function setStickerCatalog(catalog) {
    catalogOverride = catalog;
}

function defaultSettings() {
    return { enabled: true, frequency: 'normal', uploads: [] };
}

export function normalizeSettings(raw) {
    const frequency = FREQUENCIES.some((item) => item.id === raw?.frequency) ? raw.frequency : 'normal';
    const uploads = Array.isArray(raw?.uploads) ? raw.uploads.filter((item) => item && item.path).map((item) => ({
        id: String(item.id || item.path),
        tag: isSendableTag(item.tag) ? String(item.tag).trim() : '',
        path: String(item.path),
        name: String(item.name || ''),
    })) : [];
    return { enabled: raw?.enabled !== false, frequency, uploads };
}

export function readSettings() {
    if (catalogOverride && typeof catalogOverride === 'object') {
        return {
            enabled: catalogOverride.enabled !== false,
            frequency: catalogOverride.frequency || 'normal',
            uploads: catalogOverride.uploads || [],
        };
    }
    try {
        const ctx = runtime.getContext?.();
        return normalizeSettings(ctx?.extensionSettings?.[SETTINGS_KEY]);
    } catch {
        return defaultSettings();
    }
}

export function writeStickerSettings(next) {
    const ctx = runtime.getContext?.();
    if (!ctx) return;
    ctx.extensionSettings = ctx.extensionSettings || {};
    ctx.extensionSettings[SETTINGS_KEY] = next;
    ctx.saveSettingsDebounced?.();
}

export function userAssets(settings) {
    return (settings.uploads || []).filter((item) => isSendableTag(item.tag) && item.path).map((item) => ({
        id: item.id,
        tag: item.tag,
        kind: 'image',
        src: stickerSrc(item.path),
        source: 'user',
    }));
}

export function currentStickerAssets() {
    if (catalogOverride?.assets) return catalogOverride.assets;
    return [...builtinAssets, ...userAssets(readSettings())];
}

function uniqueTags(assets) {
    const tags = [];
    for (const asset of assets || []) {
        if (!isSendableTag(asset?.tag)) continue;
        if (asset.kind === 'kaomoji' ? !asset.text : !asset.src) continue;
        if (!tags.includes(asset.tag)) tags.push(asset.tag);
    }
    return tags;
}

export function listTags() {
    if (catalogOverride) {
        if (catalogOverride.enabled === false) return [];
        return uniqueTags(catalogOverride.assets || []);
    }
    if (!readSettings().enabled) return [];
    return uniqueTags(currentStickerAssets());
}

function blankGate() {
    return { assistantCount: 0, lastStickerAt: 0, lastStickerAtBefore: 0, turnId: '', turn: null };
}

function readGate(metadata) {
    const raw = metadata?.[GATE_KEY];
    if (!raw || typeof raw !== 'object') return blankGate();
    return {
        assistantCount: Number(raw.assistantCount) || 0,
        lastStickerAt: Number(raw.lastStickerAt) || 0,
        lastStickerAtBefore: Number(raw.lastStickerAtBefore) || 0,
        turnId: typeof raw.turnId === 'string' ? raw.turnId : '',
        turn: raw.turn && typeof raw.turn === 'object' ? raw.turn : null,
    };
}

function parseTags(text) {
    const tags = [];
    const re = new RegExp(TAG_RE.source, 'gi');
    let match;
    while ((match = re.exec(String(text || '')))) tags.push(match[1] ?? match[2] ?? '');
    return tags;
}

export function stripStickerTags(text) {
    return String(text || '').replace(new RegExp(TAG_RE.source, 'gi'), '');
}

export function isSerious(userText) {
    const text = String(userText || '');
    return SERIOUS_KEYWORDS.some((word) => text.includes(word));
}

function probabilityOf(id) {
    return FREQUENCIES.find((item) => item.id === id)?.probability ?? FREQUENCIES[1].probability;
}

function cooldownOpen(gate) {
    if (!gate.lastStickerAt) return true;
    return (gate.assistantCount + 1) - gate.lastStickerAt >= WINDOW;
}

function publicSticker(asset) {
    if (!asset) return null;
    if (asset.type === 'sticker') return asset;
    return {
        type: 'sticker',
        tag: asset.tag,
        kind: asset.kind,
        src: asset.kind === 'image' ? (asset.src || '') : '',
        text: asset.kind === 'kaomoji' ? (asset.text || '') : '',
        id: asset.id,
    };
}

function textOf(segments) {
    const texts = [];
    const tags = [];
    for (const segment of segments) {
        if (segment && typeof segment === 'object' && segment.type === 'sticker') continue;
        const text = String(segment ?? '');
        tags.push(...parseTags(text));
        const stripped = stripStickerTags(text).trim();
        if (stripped) texts.push(stripped);
    }
    return { texts, tags };
}

function withSticker(texts, sticker) {
    return sticker ? [...texts, sticker] : [...texts];
}

export function planSticker(input = {}) {
    const segments = Array.isArray(input.segments) ? input.segments : [input.segments ?? ''];
    const { texts, tags } = textOf(segments);
    const metadata = input.metadata && typeof input.metadata === 'object' ? input.metadata : {};
    const gate = readGate(metadata);
    const turnId = String(input.turnId || '');
    const pack = (reason, sticker, counted, replayed = false) => ({
        reason,
        sticker: sticker || null,
        segments: withSticker(texts, sticker || null),
        counted,
        replayed,
    });

    if (input.live === false) return pack('history', null, false);
    if (turnId && gate.turnId === turnId && gate.turn) {
        return pack(gate.turn.reason, gate.turn.sticker || null, false, true);
    }

    const assets = Array.isArray(input.assets) ? input.assets : [];
    const random = typeof input.random === 'function' ? input.random : Math.random;
    let reason = tags.length ? 'unknown-tag' : 'no-tag';
    let chosen = null;

    if (input.enabled === false) reason = 'off';
    else if (input.interrupted) reason = 'interrupted';
    else if (isSerious(input.userText)) reason = 'serious';
    else if (!tags.length) reason = 'no-tag';
    else {
        let asset = null;
        for (const tag of tags) {
            if (!isSendableTag(tag)) continue;
            const matches = assets.filter((item) => item?.tag === tag && (item.kind === 'kaomoji' ? item.text : item.src));
            if (!matches.length) continue;
            const index = matches.length === 1 ? 0 : Math.min(matches.length - 1, Math.floor(random() * matches.length));
            asset = matches[index];
            break;
        }
        if (!asset) reason = 'unknown-tag';
        else if (!cooldownOpen(gate)) reason = 'cooldown';
        else if (random() >= probabilityOf(input.frequency)) reason = 'probability';
        else {
            reason = 'sent';
            chosen = publicSticker(asset);
        }
    }

    const nextIndex = gate.assistantCount + 1;
    metadata[GATE_KEY] = {
        assistantCount: nextIndex,
        lastStickerAt: reason === 'sent' ? nextIndex : gate.lastStickerAt,
        lastStickerAtBefore: reason === 'sent' ? gate.lastStickerAt : gate.lastStickerAtBefore,
        turnId,
        turn: turnId ? { reason, sticker: chosen } : null,
    };
    return pack(reason, chosen, true);
}

export function revertSentSticker(metadata, message) {
    if (!metadata || !message?.extra?.vc_sticker) return false;
    const gate = readGate(metadata);
    if (gate.lastStickerAt === gate.assistantCount) gate.lastStickerAt = gate.lastStickerAtBefore || 0;
    if (gate.turn) gate.turn = { ...gate.turn, reason: 'interrupted', sticker: null };
    metadata[GATE_KEY] = gate;
    message.extra.vc_sticker = null;
    message.extra.vc_sticker_reverted = true;
    return true;
}

export function transformSegments(segments, ctx = {}) {
    const settings = readSettings();
    const plan = planSticker({
        segments,
        userText: ctx.userText || '',
        metadata: ctx.metadata,
        turnId: ctx.turnId || '',
        live: ctx.live !== false,
        interrupted: ctx.interrupted === true,
        random: ctx.random,
        enabled: ctx.enabled ?? settings.enabled,
        frequency: ctx.frequency || settings.frequency,
        assets: ctx.assets || currentStickerAssets(),
    });
    return plan.segments;
}

export async function registerBubbleTransformerIfPresent({ importPipeline } = {}) {
    let mod;
    try {
        mod = importPipeline ? await importPipeline() : await import('./reply-pipeline.js');
    } catch (error) {
        if (!importPipeline) return false;
        if (error?.code === 'ERR_MODULE_NOT_FOUND' || /reply-pipeline/.test(String(error?.message || ''))) return false;
        throw error;
    }
    if (typeof mod?.registerBubbleTransformer !== 'function') return false;
    mod.registerBubbleTransformer((segments, ctx) => transformSegments(segments, ctx));
    return true;
}

const BUNDLED_MANIFESTS = ['./stickers/builtin-manifest.json', './stickers/custom/manifest.json'];

export async function loadBundledManifest({ getContext } = {}) {
    if (getContext) runtime.getContext = getContext;
    const packs = await Promise.all(BUNDLED_MANIFESTS.map(async rel => {
        try {
            const url = new URL(rel, import.meta.url);
            const response = await fetch(url);
            if (!response?.ok) return [];
            const manifest = loadManifest(await response.json());
            return assetsFromManifest(manifest, new URL('./', url).href);
        } catch {
            /* 单个包坏了不影响其他包。 */
            return [];
        }
    }));
    const assets = packs.flat();
    builtinAssets = assets;
}

export function listStickerPicks() {
    if (catalogOverride ? catalogOverride.enabled === false : !readSettings().enabled) return [];
    const seen = new Set();
    const picks = [];
    for (const asset of currentStickerAssets() || []) {
        if (!isSendableTag(asset?.tag) || seen.has(asset.tag)) continue;
        if (asset.kind === 'kaomoji' ? !asset.text : !asset.src) continue;
        seen.add(asset.tag);
        picks.push({ tag: asset.tag, kind: asset.kind === 'kaomoji' ? 'kaomoji' : 'image', src: asset.src || '', text: asset.text || '' });
    }
    return picks;
}

export function displayStickerRows() {
    const settings = readSettings();
    const rows = builtinAssets.map((asset) => ({
        id: asset.id,
        tag: asset.tag,
        name: asset.kind === 'kaomoji' ? asset.text : asset.tag,
        src: asset.src || '',
        builtin: true,
        attribution: asset.attribution || '',
    }));
    for (const item of settings.uploads) {
        rows.push({
            id: item.id,
            tag: item.tag || '',
            name: item.name || '',
            src: stickerSrc(item.path),
            builtin: false,
            attribution: '',
        });
    }
    return rows;
}
