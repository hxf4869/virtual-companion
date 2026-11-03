// UX-27 图片查看（桌面）。规格 docs/planning/2026-11-02-ux24-desktop-experience.md §1 UX-27。
// 灯箱节点挂在 body，不进 #chat；消息图片只读取，不改宿主结构。
import { iconSpriteUrl } from './ui/icons.js';
import { mountLightboxView } from './desktop/build/index.js';
import { showToast } from './ui/toast.js';
import { sharedTransition } from './desktop/transition.js';

export const LIGHTBOX_COPY = Object.freeze({
    download: '下载', copy: '复制', close: '关闭', prev: '上一张', next: '下一张', copied: '已复制',
});
export const LIGHTBOX_IDLE_MS = 2500;
export const LIGHTBOX_ZOOM = 2;
const NOT_VIEWABLE = '.avatar, .mesAvatarWrapper, .vc-sticker-bubble, [data-vc-sticker], .mes_reasoning_details, .vc-voice';

export const pageLabel = (index, total) => `${index + 1} / ${total}`;
export const stepIndex = (index, total, delta) => Math.min(total - 1, Math.max(0, index + delta));
/** 双击点相对图片矩形的 transform-origin（百分比）。 */
export function zoomOrigin(point, rect) {
    const pct = (v, start, size) => (size > 0 ? Math.min(100, Math.max(0, ((v - start) / size) * 100)) : 50);
    return `${pct(point.x, rect.left, rect.width).toFixed(1)}% ${pct(point.y, rect.top, rect.height).toFixed(1)}%`;
}
export function imageFileName(src) {
    try {
        const name = decodeURIComponent(new URL(src, 'http://x/').pathname.split('/').filter(Boolean).pop() || '');
        return name || 'image';
    } catch { return 'image'; }
}
export const isViewableImage = (img) => Boolean(img?.src) && !img.closest?.(NOT_VIEWABLE) && Boolean(img.closest?.('.mes'));
export const collectChatImages = (chat) => [...(chat?.querySelectorAll?.('.mes img') ?? [])].filter(isViewableImage);

const isDesktop = (doc) => doc.documentElement?.dataset?.vcLayout === 'desktop';

async function toPngBlob(blob) {
    if (blob.type === 'image/png') return blob;
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    return canvas.convertToBlob({ type: 'image/png' });
}

/** Clipboard API 写图片；失败时退回复制图片地址。返回是否成功复制了任意内容。 */
export async function copyImage(src, { clipboard = globalThis.navigator?.clipboard, fetchImpl = globalThis.fetch } = {}) {
    try {
        const blob = await toPngBlob(await (await fetchImpl(src)).blob());
        await clipboard.write([new globalThis.ClipboardItem({ [blob.type]: blob })]);
        return 'image';
    } catch {
        try {
            await clipboard.writeText(new URL(src, globalThis.location?.href).href);
            return 'url';
        } catch { return ''; }
    }
}

export function mountLightbox({ getContext } = {}) {
    const doc = globalThis.document;
    if (!doc?.body) return { destroy() {} };
    const ratios = new Map();
    let state = null, dead = false;

    const chatEl = () => doc.getElementById('chat');
    const applyRatio = (img) => {
        const ratio = ratios.get(img.currentSrc || img.src);
        if (ratio && !img.style.aspectRatio) img.style.aspectRatio = ratio;
    };
    const imgIn = (target) => target?.closest?.('#chat .mes img');

    // 图片占位：成图尺寸记下来；重渲染出现同一张图时先套上比例，加载前后高度不跳。
    const onLoad = (event) => {
        const img = imgIn(event.target);
        if (!img || !isDesktop(doc) || !img.naturalWidth) return;
        ratios.set(img.currentSrc || img.src, `${img.naturalWidth} / ${img.naturalHeight}`);
    };
    const observer = typeof MutationObserver === 'function' ? new MutationObserver((records) => {
        if (!isDesktop(doc)) return;
        for (const record of records) for (const node of record.addedNodes) {
            if (node.nodeType !== 1) continue;
            if (node.tagName === 'IMG') applyRatio(node); else node.querySelectorAll?.('.mes img').forEach(applyRatio);
        }
    }) : null;
    const watchChat = () => { const chat = chatEl(); if (chat && observer) observer.observe(chat, { childList: true, subtree: true }); };
    watchChat();
    doc.addEventListener('load', onLoad, true);

    function paint(entry = state) {
        if (!entry || entry !== state || !entry.view || dead) return;
        const image = entry.images[entry.index];
        entry.view.update({ ...entry.events, src: image.currentSrc || image.src, alt: image.alt || '', index: entry.index, total: entry.images.length,
            sprite: iconSpriteUrl(), scale: LIGHTBOX_ZOOM, idle: entry.isIdle, zoomed: entry.zoomed, origin: entry.originPoint });
    }
    function wake() {
        const entry = state;
        if (!entry || entry.closing) return;
        if (entry.isIdle) { entry.isIdle = false; paint(entry); }
        clearTimeout(entry.idle);
        entry.idle = setTimeout(() => { if (state === entry && !dead) { entry.isIdle = true; paint(entry); } }, LIGHTBOX_IDLE_MS);
    }
    function show(index) {
        if (!state || state.closing) return;
        state.index = index; state.zoomed = false; state.originPoint = '';
        paint(); wake();
    }
    function dismiss(restore = false) {
        const previous = state;
        if (!previous) return;
        previous.restore = restore; state = null;
        clearTimeout(previous.idle); previous.view?.unmount(); previous.host?.remove();
    }
    function open(origin) {
        if (state || dead || !isDesktop(doc)) return;
        const images = collectChatImages(chatEl()), index = images.indexOf(origin);
        if (index < 0) return;
        const entry = { images, index, opener: doc.activeElement, origin, idle: 0, isIdle: false, zoomed: false, originPoint: '', view: null, host: null, closing: false, restore: false, events: null };
        state = entry;
        const active = () => !dead && state === entry && !entry.closing;
        entry.events = {
            close: () => { if (active()) close(); },
            previous: () => { const next = stepIndex(entry.index, images.length, -1); if (active() && next !== entry.index) show(next); },
            next: () => { const next = stepIndex(entry.index, images.length, 1); if (active() && next !== entry.index) show(next); }, wake,
            returnFocus: () => entry.restore && entry.opener?.isConnected ? entry.opener : false,
            dispose: () => { clearTimeout(entry.idle); entry.host?.remove(); if (state === entry) state = null; },
            zoom(x, y) { if (!active()) return; if (!entry.zoomed) entry.originPoint = zoomOrigin({ x, y }, entry.view.img.getBoundingClientRect()); entry.zoomed = !entry.zoomed; paint(entry); },
            download() {
                if (!active()) return;
                const link = doc.createElement('a'); link.href = entry.view.img.src; link.download = imageFileName(link.href); link.rel = 'noopener';
                doc.body.append(link); link.click(); link.remove();
            },
            async copy() { if (!active()) return; const copied = await copyImage(entry.view.img.src); if (copied && active()) showToast(LIGHTBOX_COPY.copied, { root: doc.body }); },
        };
        const mount = () => {
            if (!active()) return;
            const host = doc.createElement('div'); host.style.display = 'contents'; doc.body.append(host); entry.host = host;
            const source = images[index];
            entry.view = mountLightboxView(host, { ...entry.events, src: source.currentSrc || source.src, alt: source.alt || '', index, total: images.length, sprite: iconSpriteUrl(), scale: LIGHTBOX_ZOOM, idle: false, zoomed: false, origin: '' }, entry.opener);
            wake();
        };
        void sharedTransition(mount, { from: origin, to: () => state === entry ? entry.view?.img : null, name: 'vc-lightbox-img' });
    }
    function close() {
        const entry = state;
        if (!entry || entry.closing) return;
        entry.closing = true;
        const back = entry.images[entry.index];
        void sharedTransition(() => { if (state === entry) dismiss(true); }, { from: entry.view?.img, to: back?.isConnected ? back : null, name: 'vc-lightbox-img' });
    }

    const onClick = (event) => {
        const img = imgIn(event.target);
        if (!img || !isViewableImage(img) || !isDesktop(doc)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        open(img);
    };
    doc.addEventListener('click', onClick, true);

    const ctx = getContext?.();
    const onChat = () => { watchChat(); dismiss(); };
    const chatEvent = ctx?.eventTypes?.CHAT_CHANGED;
    if (chatEvent) ctx.eventSource?.on(chatEvent, onChat);

    return {
        destroy() {
            doc.removeEventListener('click', onClick, true);
            doc.removeEventListener('load', onLoad, true);
            observer?.disconnect();
            if (chatEvent) ctx.eventSource?.removeListener?.(chatEvent, onChat);
            dead = true; dismiss();
        },
    };
}
