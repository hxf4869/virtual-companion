// 表情包库、代码频控，以及把 <sticker tag="…"/> 变成表情气泡。
// HL-REPLY 的 registerBubbleTransformer(fn) 存在时注册；fn(segments, ctx) → segments。
// 表情段：{ type:'sticker', tag, kind:'image'|'kaomoji', src, text, id }，放在本轮文字之后。
// 频控写在 chat_metadata.vc_sticker_gate，按会话持久化。

import { bindSwitch } from './ui/controls.js';
import { icon } from './ui/icons.js';

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
const IMAGE_FORMATS = ['png', 'jpg', 'jpeg', 'webp', 'gif'];

let runtime = {};
let builtinAssets = [];
let catalogOverride;

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

function normalizeSettings(raw) {
    const frequency = FREQUENCIES.some((item) => item.id === raw?.frequency) ? raw.frequency : 'normal';
    const uploads = Array.isArray(raw?.uploads) ? raw.uploads.filter((item) => item && item.path).map((item) => ({
        id: String(item.id || item.path),
        tag: isSendableTag(item.tag) ? String(item.tag).trim() : '',
        path: String(item.path),
        name: String(item.name || ''),
    })) : [];
    return { enabled: raw?.enabled !== false, frequency, uploads };
}

function readSettings() {
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

function writeSettings(next) {
    const ctx = runtime.getContext?.();
    if (!ctx) return;
    ctx.extensionSettings = ctx.extensionSettings || {};
    ctx.extensionSettings[SETTINGS_KEY] = next;
    ctx.saveSettingsDebounced?.();
}

function userAssets(settings) {
    return (settings.uploads || []).filter((item) => isSendableTag(item.tag) && item.path).map((item) => ({
        id: item.id,
        tag: item.tag,
        kind: 'image',
        src: stickerSrc(item.path),
        source: 'user',
    }));
}

function currentAssets() {
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
    return uniqueTags(currentAssets());
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
        assets: ctx.assets || currentAssets(),
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

function insideReplySegs(node) {
    let current = node;
    while (current) {
        const name = String(current.className || '');
        if (name.split(/\s+/).includes('vc-segs')) return true;
        current = current.parentElement || current.parent || null;
    }
    return false;
}

function paintBubble(mesEl, sticker) {
    if (!mesEl?.querySelector) return;
    const host = mesEl.querySelector('.mes_block') || mesEl;
    const doc = mesEl.ownerDocument || globalThis.document;
    let node = host.querySelector('[data-vc-sticker]');
    if (!sticker) {
        node?.remove();
        return;
    }
    // 流水线把表情画在分段容器里。按已剥离的纯文本重排时会删掉该容器，气泡必须挂在消息块上。
    if (node && insideReplySegs(node)) host.append(node);
    if (!node) {
        node = doc.createElement('div');
        node.className = 'vc-sticker-bubble';
        node.setAttribute('data-vc-sticker', sticker.tag || '');
        host.append(node);
    }
    node.replaceChildren();
    if (sticker.kind === 'kaomoji') {
        const span = doc.createElement('span');
        span.className = 'vc-sticker-kaomoji';
        span.textContent = sticker.text || '';
        node.append(span);
        return;
    }
    const img = doc.createElement('img');
    img.alt = sticker.tag || '';
    img.src = sticker.src || '';
    node.append(img);
}

export function applyStickerDom(mesEl, message, ctx = {}) {
    const plan = planSticker({ ...ctx, segments: [message?.mes ?? ''] });
    const sticker = plan.segments.find((item) => item && item.type === 'sticker') || null;
    const plain = plan.segments.filter((item) => typeof item === 'string').join('');
    const hadTag = /<sticker\b/i.test(String(message?.mes || ''));
    if (message && (hadTag || sticker)) {
        message.mes = plain;
        message.extra = message.extra || {};
        message.extra.vc_sticker_settled = true;
        message.extra.vc_sticker = sticker;
    }
    const textNode = mesEl?.querySelector?.('.mes_text');
    if (textNode && (/<sticker\b/i.test(textNode.textContent || '') || sticker || plan.reason === 'cooldown' || plan.reason === 'interrupted')) {
        textNode.textContent = plain;
    }
    paintBubble(mesEl, sticker);
    return plan;
}

function previousUser(chat, index) {
    const rows = Array.isArray(chat) ? chat : [];
    for (let i = Number(index) - 1; i >= 0; i -= 1) {
        if (rows[i]?.is_user) return String(rows[i].mes || '');
    }
    return '';
}

function messageElement(id) {
    const doc = globalThis.document;
    if (!doc?.querySelector && !doc?.getElementById) return null;
    const marked = doc.querySelector?.(`[mesid="${id}"]`);
    if (marked) return marked;
    const chat = doc.getElementById?.('chat');
    const kids = chat?.children ? [...chat.children] : [];
    const rows = kids.filter((el) => el.classList?.contains?.('mes') || String(el.className || '').split(/\s+/).includes('mes'));
    return rows[Number(id)] || null;
}

function displayRows() {
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

export function renderStickerPage(doc, options = {}) {
    const settings = options.settings || { enabled: true, frequency: 'normal' };
    const rows = options.rows || [];
    const page = doc.createElement('div');
    page.className = 'vc-sticker-page';
    page.setAttribute('data-vc-sticker-page', '');

    const nav = doc.createElement('div');
    nav.className = 'vc-navbar';
    const back = doc.createElement('button');
    back.type = 'button';
    back.className = 'vc-btn vc-btn-text';
    back.setAttribute('data-vc-sticker-back', '');
    back.setAttribute('aria-label', '返回设置');
    back.textContent = '设置';
    back.addEventListener('click', () => options.onBack?.());
    const title = doc.createElement('div');
    title.className = 'vc-nav-title';
    title.setAttribute('data-vc-sticker-title', '');
    title.textContent = '表情包';
    nav.append(back, title);

    const sendGroup = doc.createElement('div');
    sendGroup.className = 'vc-group';
    const send = doc.createElement('div');
    send.className = 'vc-cell vc-sticker-row';
    const sendLabel = doc.createElement('span');
    sendLabel.className = 'vc-grow';
    sendLabel.textContent = '发送';
    const toggle = doc.createElement('button');
    toggle.type = 'button';
    toggle.className = 'vc-switch';
    toggle.setAttribute('data-vc-sticker-enabled', '');
    toggle.setAttribute('aria-checked', settings.enabled === false ? 'false' : 'true');
    toggle.setAttribute('aria-label', '发送');
    send.append(sendLabel, toggle);
    sendGroup.append(send);
    bindSwitch(toggle, { onChange: (value) => options.onEnabled?.(value) });

    const freqTitle = doc.createElement('div');
    freqTitle.className = 'vc-group-title';
    freqTitle.textContent = '频率';
    const segment = doc.createElement('div');
    segment.className = 'vc-segment';
    segment.setAttribute('aria-label', '频率');
    const thumb = doc.createElement('i');
    thumb.className = 'vc-segment-thumb';
    segment.append(thumb);
    const selected = Math.max(0, FREQUENCIES.findIndex((item) => item.id === (settings.frequency || 'normal')));
    thumb.style.width = `calc((100% - 4px) / ${FREQUENCIES.length})`;
    thumb.style.transform = `translateX(${selected * 100}%)`;
    for (const item of FREQUENCIES) {
        const button = doc.createElement('button');
        button.type = 'button';
        button.textContent = item.label;
        button.setAttribute('data-value', item.id);
        if (item.id === (settings.frequency || 'normal')) button.setAttribute('aria-pressed', 'true');
        button.addEventListener('click', () => options.onFrequency?.(item.id));
        segment.append(button);
    }

    const list = doc.createElement('div');
    list.className = 'vc-group';
    list.setAttribute('data-vc-sticker-list', '');
    const file = doc.createElement('input');
    file.className = 'vc-sticker-file';
    file.setAttribute('type', 'file');
    file.setAttribute('data-vc-sticker-file', '');
    file.setAttribute('accept', 'image/png,image/jpeg,image/webp,image/gif');
    file.addEventListener('change', () => {
        const picked = file.files?.[0];
        if (picked) options.onUpload?.(picked);
    });
    const armUpload = (button) => {
        button.addEventListener('click', () => file.click?.());
    };

    const makeUpload = () => {
        const upload = doc.createElement('button');
        upload.type = 'button';
        upload.className = 'vc-btn vc-btn-fill vc-sticker-upload';
        upload.setAttribute('data-vc-sticker-upload', '');
        upload.textContent = '上传';
        armUpload(upload);
        return upload;
    };
    const notes = [];
    const seenNotes = new Set();
    if (!rows.length) {
        const empty = doc.createElement('div');
        empty.className = 'vc-empty';
        empty.setAttribute('data-vc-sticker-empty', '');
        const mark = doc.createElement('span');
        mark.innerHTML = icon('image', { size: 32 });
        const copy = doc.createElement('p');
        copy.textContent = '还没有表情包';
        empty.append(mark, copy, makeUpload());
        list.append(empty);
    } else {
        list.append(makeUpload());
        for (const row of rows) {
            const cell = doc.createElement('div');
            cell.className = 'vc-cell vc-sticker-row';
            cell.setAttribute('data-vc-sticker-id', row.id);
            if (row.src) {
                const img = doc.createElement('img');
                img.className = 'vc-sticker-thumb';
                img.alt = '';
                img.src = row.src;
                cell.append(img);
            }
            const input = doc.createElement('input');
            input.className = 'vc-sticker-tag';
            input.setAttribute('data-vc-sticker-tag', '');
            input.setAttribute('aria-label', '标签');
            input.value = row.tag || '';
            if (row.builtin) input.setAttribute('readonly', '');
            input.addEventListener('change', () => options.onTag?.(row.id, input.value));
            cell.append(input);
            if (!row.builtin) {
                const del = doc.createElement('button');
                del.type = 'button';
                del.className = 'vc-btn vc-btn-text';
                del.setAttribute('data-vc-sticker-delete', '');
                del.setAttribute('aria-label', '删除');
                del.innerHTML = icon('trash-2', { size: 18 });
                del.addEventListener('click', async () => {
                    const ask = options.confirm || confirmDelete;
                    const ok = await ask({ title: '删除这张表情包？', message: '删除后不能恢复。', action: '删除' });
                    if (ok) options.onDelete?.(row.id);
                });
                cell.append(del);
            }
            list.append(cell);
            const note = String(row.attribution || '').trim();
            if (note && !seenNotes.has(note)) {
                seenNotes.add(note);
                notes.push(note);
            }
        }
    }

    page.append(nav, sendGroup, freqTitle, segment, list);
    for (const note of notes) {
        const meta = doc.createElement('p');
        meta.className = 'vc-footnote';
        meta.setAttribute('data-vc-sticker-attribution', '');
        meta.textContent = note;
        page.append(meta);
    }
    page.append(file);
    return page;
}

async function confirmDelete(options) {
    const { confirmAlert } = await import('./ui/alert.js');
    return confirmAlert(options);
}

export function mountStickerSettingsEntry(doc, { open } = {}) {
    const forms = typeof doc.querySelectorAll === 'function' ? [...doc.querySelectorAll('.vc-settings-form')] : [];
    for (const form of forms) {
        if (form.querySelector?.('[data-vc-sticker-entry]')) continue;
        const models = form.querySelector?.('[data-action="models"]');
        const group = models?.parent || models?.parentElement;
        if (!group) continue;
        const button = doc.createElement('button');
        button.type = 'button';
        button.className = 'vc-cell';
        button.setAttribute('data-vc-sticker-entry', '');
        button.setAttribute('data-action', 'stickers');
        const mark = doc.createElement('span');
        mark.className = 'vc-tile vc-tile-orange';
        mark.innerHTML = icon('image', { size: 18 });
        const label = doc.createElement('span');
        label.className = 'vc-grow';
        label.textContent = '表情包';
        button.append(mark, label);
        button.addEventListener('click', (event) => {
            event.stopPropagation?.();
            open?.(button);
        });
        group.append(button);
    }
}

function readDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}

async function uploadUserFile(file) {
    const format = String(file?.name || '').split('.').pop().toLowerCase();
    if (!IMAGE_FORMATS.includes(format)) return;
    const dataUrl = await readDataUrl(file);
    const image = dataUrl.split(',')[1] || '';
    if (!image) return;
    const headers = runtime.getRequestHeaders?.() || {};
    const response = await fetch('/api/images/upload', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            image,
            format,
            ch_name: STICKER_FOLDER,
            filename: String(file.name || 'sticker').replace(/\.[^.]+$/, '').replace(/\./g, '_'),
        }),
    });
    if (!response.ok) return;
    const body = await response.json();
    if (!body?.path) return;
    const settings = readSettings();
    settings.uploads = [...settings.uploads, {
        id: `vc-${Date.now().toString(36)}`,
        tag: tagFromFilename(file.name),
        path: body.path,
        name: file.name || '',
    }];
    writeSettings(settings);
}

async function deleteUserFile(id) {
    const settings = readSettings();
    const row = settings.uploads.find((item) => item.id === id);
    settings.uploads = settings.uploads.filter((item) => item.id !== id);
    writeSettings(settings);
    if (!row?.path) return;
    try {
        const headers = runtime.getRequestHeaders?.() || {};
        await fetch('/api/images/delete', {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: row.path }),
        });
    } catch {
        /* 列表已去掉。 */
    }
}

function openStickerPage(button) {
    const doc = button?.ownerDocument || globalThis.document;
    const form = button?.closest?.('.vc-settings-form');
    const parent = form?.parentElement || form?.parent;
    if (!doc || !form || !parent) return;
    const host = form.closest?.('.vc-sheet') || doc.querySelector?.('.vc-shell-settings');
    const titleNode = host?.querySelector?.('h3') || host?.querySelector?.('.vc-nav-title') || null;
    const heading = host?.querySelector?.('.vc-large-title') || null;
    const previousTitle = titleNode?.textContent || '';
    const previousHeading = heading?.textContent || '';
    if (titleNode) titleNode.textContent = '表情包';
    if (heading && heading !== titleNode) {
        heading.hidden = true;
        heading.setAttribute?.('hidden', '');
    }
    let page = null;
    const close = () => {
        page?.remove();
        parent.append(form);
        if (titleNode) titleNode.textContent = previousTitle || '设置';
        if (heading) {
            heading.textContent = previousHeading || '设置';
            heading.hidden = false;
            heading.removeAttribute?.('hidden');
        }
    };
    const show = () => {
        const next = renderStickerPage(doc, {
            settings: readSettings(),
            rows: displayRows(),
            onEnabled(value) {
                writeSettings({ ...readSettings(), enabled: value });
                show();
            },
            onFrequency(value) {
                if (!FREQUENCIES.some((item) => item.id === value)) return;
                writeSettings({ ...readSettings(), frequency: value });
                show();
            },
            onTag(id, value) {
                const tag = String(value || '').trim();
                if (tag && !isSendableTag(tag)) return;
                const current = readSettings();
                current.uploads = current.uploads.map((item) => (item.id === id ? { ...item, tag } : item));
                writeSettings(current);
                show();
            },
            onDelete(id) {
                void deleteUserFile(id).then(show);
            },
            onUpload(file) {
                void uploadUserFile(file).then(show);
            },
            onBack: close,
        });
        if (page) page.remove();
        else form.remove();
        parent.append(next);
        page = next;
    };
    show();
}

function ensureCss(doc) {
    if (!doc?.createElement || doc.getElementById?.('vc-stickers-css')) return;
    const link = doc.createElement('link');
    link.id = 'vc-stickers-css';
    link.rel = 'stylesheet';
    link.href = new URL('./stickers.css', import.meta.url).href;
    (doc.head || doc.documentElement).append(link);
}

function bindChat(attempt = 0) {
    const ctx = runtime.getContext?.() || {};
    const events = ctx.eventSource;
    const types = ctx.eventTypes || {};
    if (!events?.on) {
        if (attempt < 20) setTimeout(() => bindChat(attempt + 1), 250);
        return;
    }
    let live = false;
    let stopped = false;
    let lastLiveId = null;
    const on = (name, fn) => { if (name) events.on(name, fn); };
    on(types.GENERATION_STARTED, (type, _detail, dryRun) => {
        if (type === 'quiet' || dryRun) return;
        live = true;
        stopped = false;
        lastLiveId = null;
    });
    on(types.GENERATION_STOPPED, () => {
        stopped = true;
        if (lastLiveId == null) return;
        try {
            const context = runtime.getContext?.() || {};
            const message = context.chat?.[lastLiveId];
            if (!message?.extra?.vc_sticker) return;
            if (!revertSentSticker(context.chatMetadata, message)) return;
            paintBubble(messageElement(lastLiveId), null);
            runtime.saveChat?.();
        } catch {
            /* 打断时丢掉表情，不影响停止本身。 */
        }
    });
    on(types.CHARACTER_MESSAGE_RENDERED, (id, type) => {
        if (type === 'first_message') return;
        try {
            const context = runtime.getContext?.() || {};
            const message = context.chat?.[id];
            if (!message || message.is_user) return;
            const row = messageElement(id);
            if (!live) {
                if (row && message.extra?.vc_sticker) paintBubble(row, message.extra.vc_sticker);
                return;
            }
            if (!row) return;
            context.chatMetadata = context.chatMetadata || {};
            const settings = readSettings();
            applyStickerDom(row, message, {
                userText: previousUser(context.chat, id),
                metadata: context.chatMetadata,
                turnId: `${context.chatId || ''}:${id}:${message.swipe_id || 0}`,
                live: true,
                interrupted: stopped,
                enabled: settings.enabled,
                frequency: settings.frequency,
                assets: currentAssets(),
            });
            lastLiveId = id;
            live = false;
        } catch {
            /* 表情处理失败时保留原回复。 */
        }
    });
    on(types.CHAT_CHANGED, () => {
        live = false;
        try {
            const context = runtime.getContext?.() || {};
            (context.chat || []).forEach((message, id) => {
                if (message?.extra?.vc_sticker) paintBubble(messageElement(id), message.extra.vc_sticker);
            });
        } catch {
            /* 换聊天时不补画。 */
        }
    });
}

function watchSettings(doc) {
    if (!doc?.body) return;
    const scan = () => mountStickerSettingsEntry(doc, { open: openStickerPage });
    scan();
    if (typeof MutationObserver !== 'function') return;
    const observer = new MutationObserver(scan);
    observer.observe(doc.body, { childList: true, subtree: true });
}

// 内置包 + 可选的专属包（docs/planning/2026-10-30-custom-stickers-brief.md），缺哪个跳过哪个。
const BUNDLED_MANIFESTS = ['./stickers/builtin-manifest.json', './stickers/custom/manifest.json'];

async function loadBundledManifest() {
    const assets = [];
    for (const rel of BUNDLED_MANIFESTS) {
        try {
            const url = new URL(rel, import.meta.url);
            const response = await fetch(url);
            if (!response?.ok) continue;
            const manifest = loadManifest(await response.json());
            assets.push(...assetsFromManifest(manifest, new URL('./', url).href));
        } catch {
            /* 单个包坏了不影响其他包。 */
        }
    }
    builtinAssets = assets;
}

export async function installStickers(deps = {}) {
    runtime = { ...runtime, ...deps };
    try {
        ensureCss(deps.document || globalThis.document);
        await registerBubbleTransformerIfPresent();
        await loadBundledManifest();
        bindChat();
        watchSettings(deps.document || globalThis.document);
    } catch (error) {
        console.warn(`[vc-stickers] ${error?.name || 'error'}`);
    }
}
