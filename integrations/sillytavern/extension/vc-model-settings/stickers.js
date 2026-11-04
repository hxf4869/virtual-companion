// 表情包库、代码频控，以及把 <sticker tag="…"/> 变成表情气泡。
// HL-REPLY 的 registerBubbleTransformer(fn) 存在时注册；fn(segments, ctx) → segments。
// 表情段：{ type:'sticker', tag, kind:'image'|'kaomoji', src, text, id }，放在本轮文字之后。
// 频控写在 chat_metadata.vc_sticker_gate，按会话持久化。

import { mountStickerContentsView, mountStickerEntryView } from './desktop/build/index.js';
import { setSheetHeader } from './ui/sheet.js';
import { showToast } from './ui/toast.js';
import { iconSpriteUrl } from './ui/icons.js';
import {
    GATE_KEY,
    SETTINGS_KEY,
    STICKER_FOLDER,
    WINDOW,
    FREQUENCIES,
    IMAGE_FORMATS,
    getStickerRuntime,
    setStickerRuntime,
    isSendableTag,
    tagFromFilename,
    stickerSrc,
    loadManifest,
    assetsFromManifest,
    setStickerCatalog,
    readSettings,
    writeStickerSettings,
    currentStickerAssets,
    listTags,
    stripStickerTags,
    isSerious,
    planSticker,
    revertSentSticker,
    transformSegments,
    registerBubbleTransformerIfPresent,
    loadBundledManifest,
    listStickerPicks,
    displayStickerRows,
} from './stickers-logic.js';

export {
    GATE_KEY,
    SETTINGS_KEY,
    STICKER_FOLDER,
    WINDOW,
    FREQUENCIES,
    isSendableTag,
    tagFromFilename,
    stickerSrc,
    loadManifest,
    assetsFromManifest,
    setStickerCatalog,
    readSettings,
    listTags,
    stripStickerTags,
    isSerious,
    planSticker,
    revertSentSticker,
    transformSegments,
    registerBubbleTransformerIfPresent,
    loadBundledManifest,
    listStickerPicks,
};

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

export function stickerViewProps(options = {}) {
    const settings = options.settings || { enabled: true, frequency: 'normal' };
    return {
        enabled: settings.enabled !== false, frequency: settings.frequency || 'normal', frequencies: FREQUENCIES.map(row => ({ value: row.id, label: row.label })),
        rows: options.rows || [], sprite: iconSpriteUrl(),
        enabledChange: value => options.onEnabled?.(value), frequencyChange: value => options.onFrequency?.(value),
        tag: (id, value) => options.onTag?.(id, value), upload: file => options.onUpload?.(file), back: () => options.onBack?.(),
        dispose: options.onDispose || (() => {}),
        async remove(id, opener) {
            const ok = await (options.confirm || confirmDelete)({ title: '删除这张表情包？', message: '删除后不能恢复。', action: '删除', owner: options.owner, opener });
            if (ok && options.active?.() !== false) options.onDelete?.(id);
        },
    };
}

async function confirmDelete(options) {
    const { confirmAlert } = await import('./ui/alert.js');
    return confirmAlert(options);
}

export function mountStickerSettingsEntry(doc, { open } = {}) {
    const forms = typeof doc.querySelectorAll === 'function'
        ? ['.vc-settings-form', '.vc-settings-body'].flatMap(selector => [...doc.querySelectorAll(selector)]) : [];
    for (const form of forms) {
        if (form.querySelector?.('[data-vc-sticker-entry]')) continue;
        const models = form.querySelector?.('[data-action="models"]');
        const group = models?.parent || models?.parentElement
            || form.querySelector?.('[data-preference="theme"]')?.closest('.vc-desk-group');
        if (!group) continue;
        mountStickerEntryView(group, { sprite: iconSpriteUrl(), open: button => open?.(button) });
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
    const headers = getStickerRuntime().getRequestHeaders?.() || {};
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
    writeStickerSettings(settings);
}

async function deleteUserFile(id) {
    const settings = readSettings();
    const row = settings.uploads.find((item) => item.id === id);
    settings.uploads = settings.uploads.filter((item) => item.id !== id);
    writeStickerSettings(settings);
    if (!row?.path) return;
    try {
        const headers = getStickerRuntime().getRequestHeaders?.() || {};
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
    const form = button?.closest?.('.vc-settings-form,.vc-settings-body');
    const parent = form?.parentElement || form?.parent;
    if (!doc || !form || !parent) return;
    const host = form.closest?.('.vc-sheet') || doc.querySelector?.('.vc-shell-settings');
    const titleNode = host?.querySelector?.('h3') || host?.querySelector?.('.vc-nav-title') || null;
    const heading = host?.querySelector?.('.vc-large-title') || null;
    const previousTitle = titleNode?.textContent || '';
    const previousHeading = heading?.textContent || '';
    const desktopHeader = parent.querySelector?.('.vc-settings-header');
    if (form.closest('.vc-settings-shell')?.setDetailVisibility) form.closest('.vc-settings-shell').setDetailVisibility(true);
    else if (desktopHeader) desktopHeader.hidden = true;
    if (host?.classList.contains('vc-sheet')) setSheetHeader(host, { title: '表情包' });
    else if (!form.closest('.vc-settings-shell') && titleNode) titleNode.textContent = '表情包';
    if (heading && heading !== titleNode) {
        heading.hidden = true;
        heading.setAttribute?.('hidden', '');
    }
    let page = null, view = null, closed = false, observer = null;
    const desktopShell = form.closest('.vc-settings-shell');
    const close = () => {
        if (closed) return;
        closed = true; observer?.disconnect(); view?.unmount(); page?.remove();
        if (!parent.isConnected) return;
        parent.append(form);
        if (desktopShell?.setDetailVisibility) desktopShell.setDetailVisibility(false);
        else if (desktopHeader) desktopHeader.hidden = false;
        if (host?.classList.contains('vc-sheet')) setSheetHeader(host, { title: previousTitle || '设置' });
        else if (!desktopShell && titleNode) titleNode.textContent = previousTitle || '设置';
        if (heading) { heading.textContent = previousHeading || '设置'; heading.hidden = false; heading.removeAttribute('hidden'); }
    };
    const active = () => !closed && Boolean(page?.isConnected);
    const failed = () => { if (active()) showToast('没有完成，请重试。', { type: 'failure' }); };
    const events = {
        active, onDispose() { closed = true; observer?.disconnect(); page?.remove(); },
        onEnabled(value) { if (!active()) return; writeStickerSettings({ ...readSettings(), enabled: value }); show(); },
        onFrequency(value) { if (!active() || !FREQUENCIES.some(item => item.id === value)) return; writeStickerSettings({ ...readSettings(), frequency: value }); show(); },
        onTag(id, value) { if (!active()) return; const tag = String(value || '').trim(); if (tag && !isSendableTag(tag)) return; const current = readSettings(); current.uploads = current.uploads.map(item => item.id === id ? { ...item, tag } : item); writeStickerSettings(current); show(); },
        onDelete(id) { if (active()) void deleteUserFile(id).then(show, failed); },
        onUpload(file) { if (active()) void uploadUserFile(file).then(show, failed); },
        onBack: close,
    };
    function show() {
        if (closed) return;
        if (!page) {
            page = doc.createElement('div'); page.className = 'vc-sticker-page'; page.setAttribute('data-vc-sticker-page', '');
            form.remove(); parent.append(page);
        }
        const props = stickerViewProps({ ...events, owner: page, settings: readSettings(), rows: displayStickerRows() });
        if (view) view.update(props); else view = mountStickerContentsView(page, props, button);
    }
    show();
    observer = new MutationObserver(() => { if (!closed && !page.isConnected) { observer.disconnect(); view.unmount(); } });
    observer.observe(doc.body, { childList: true, subtree: true });
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
    const ctx = getStickerRuntime().getContext?.() || {};
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
            const context = getStickerRuntime().getContext?.() || {};
            const message = context.chat?.[lastLiveId];
            if (!message?.extra?.vc_sticker) return;
            if (!revertSentSticker(context.chatMetadata, message)) return;
            paintBubble(messageElement(lastLiveId), null);
            getStickerRuntime().saveChat?.();
        } catch {
            /* 打断时丢掉表情，不影响停止本身。 */
        }
    });
    on(types.CHARACTER_MESSAGE_RENDERED, (id, type) => {
        if (type === 'first_message') return;
        try {
            const context = getStickerRuntime().getContext?.() || {};
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
                assets: currentStickerAssets(),
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
            const context = getStickerRuntime().getContext?.() || {};
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

export async function installStickers(deps = {}) {
    setStickerRuntime(deps);
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
