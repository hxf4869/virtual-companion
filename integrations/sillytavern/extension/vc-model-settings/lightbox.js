// UX-27 图片查看（桌面）。规格 docs/planning/2026-11-02-ux24-desktop-experience.md §1 UX-27。
// 灯箱节点挂在 body，不进 #chat；消息图片只读取，不改宿主结构。
import { icon } from './ui/icons.js';
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
    let box = null;
    let state = null;

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

    function button(cls, name, label) {
        const el = doc.createElement('button');
        el.type = 'button';
        el.className = `vc-lb-btn ${cls}`;
        el.setAttribute('aria-label', label);
        el.innerHTML = icon(name, { size: 22 });
        return el;
    }

    function wake() {
        if (!box) return;
        box.classList.remove('is-idle');
        clearTimeout(state.idle);
        state.idle = setTimeout(() => box?.classList.add('is-idle'), LIGHTBOX_IDLE_MS);
    }

    function show(index) {
        const { images, img, page, prev, next } = state;
        state.index = index;
        const source = images[index];
        img.src = source.currentSrc || source.src;
        img.alt = source.alt || '';
        img.style.transform = '';
        state.zoomed = false;
        page.textContent = pageLabel(index, images.length);
        prev.disabled = index === 0;
        next.disabled = index === images.length - 1;
        wake();
    }

    function trapTab(event) {
        const items = [...box.querySelectorAll('button:not([disabled])')];
        if (!items.length) return;
        const first = items[0]; const last = items.at(-1);
        if (!box.contains(doc.activeElement)) { event.preventDefault(); first.focus(); return; }
        if (event.shiftKey && doc.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && doc.activeElement === last) { event.preventDefault(); first.focus(); }
    }

    function onKey(event) {
        if (!box) return;
        wake();
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault(); event.stopPropagation();
            const next = stepIndex(state.index, state.images.length, event.key === 'ArrowRight' ? 1 : -1);
            if (next !== state.index) show(next);
        } else if (event.key === 'Tab') trapTab(event);
    }

    function build(images, index) {
        box = doc.createElement('div');
        box.className = 'vc-lightbox';
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-modal', 'true');
        const stage = doc.createElement('div');
        stage.className = 'vc-lb-stage';
        const img = doc.createElement('img');
        img.className = 'vc-lb-img';
        stage.append(img);
        const bar = doc.createElement('div');
        bar.className = 'vc-lb-bar';
        const page = doc.createElement('span');
        page.className = 'vc-lb-page';
        const download = button('vc-lb-download', 'download', LIGHTBOX_COPY.download);
        const copy = button('vc-lb-copy', 'copy', LIGHTBOX_COPY.copy);
        const closeBtn = button('vc-lb-close', 'x', LIGHTBOX_COPY.close);
        bar.append(page, download, copy, closeBtn);
        const prev = button('vc-lb-nav vc-lb-prev', 'chevron-left', LIGHTBOX_COPY.prev);
        const next = button('vc-lb-nav vc-lb-next', 'chevron-right', LIGHTBOX_COPY.next);
        box.append(stage, bar, prev, next);
        Object.assign(state, { images, img, page, prev, next });

        stage.addEventListener('click', (event) => { if (event.target === stage) close(); });
        closeBtn.addEventListener('click', close);
        prev.addEventListener('click', () => show(stepIndex(state.index, images.length, -1)));
        next.addEventListener('click', () => show(stepIndex(state.index, images.length, 1)));
        download.addEventListener('click', () => {
            const a = doc.createElement('a');
            a.href = img.src;
            a.download = imageFileName(img.src);
            a.rel = 'noopener';
            doc.body.append(a);
            a.click();
            a.remove();
        });
        copy.addEventListener('click', async () => {
            if (await copyImage(img.src)) showToast(LIGHTBOX_COPY.copied, { root: doc.body });
        });
        img.addEventListener('dblclick', (event) => {
            if (state.zoomed) { img.style.transform = ''; state.zoomed = false; return; }
            img.style.transformOrigin = zoomOrigin({ x: event.clientX, y: event.clientY }, img.getBoundingClientRect());
            img.style.transform = `scale(${LIGHTBOX_ZOOM})`;
            state.zoomed = true;
        });
        box.addEventListener('pointermove', wake);
        box.addEventListener('pointerdown', wake);
        show(index);
    }

    function open(origin) {
        if (box || !isDesktop(doc)) return;
        const images = collectChatImages(chatEl());
        const index = images.indexOf(origin);
        if (index < 0) return;
        state = { opener: doc.activeElement, origin, idle: 0, zoomed: false };
        const mount = () => {
            build(images, index);
            doc.body.append(box);
            box.querySelector('.vc-lb-close')?.focus();
            doc.addEventListener('keydown', onKey, true);
        };
        void sharedTransition(mount, { from: origin, to: () => state?.img, name: 'vc-lightbox-img' });
    }

    function close() {
        if (!box) return;
        const closing = state;
        const back = closing.images[closing.index];
        const done = () => {
            doc.removeEventListener('keydown', onKey, true);
            clearTimeout(closing.idle);
            box?.remove();
            box = null; state = null;
            closing.opener?.focus?.();
        };
        // 回到当前这张在消息里的位置；原图已不在页面上时只淡出。
        void sharedTransition(done, { from: closing.img, to: back?.isConnected ? back : null, name: 'vc-lightbox-img' });
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
    const onChat = () => { watchChat(); if (box) close(); };
    const chatEvent = ctx?.eventTypes?.CHAT_CHANGED;
    if (chatEvent) ctx.eventSource?.on(chatEvent, onChat);

    return {
        destroy() {
            doc.removeEventListener('click', onClick, true);
            doc.removeEventListener('load', onLoad, true);
            doc.removeEventListener('keydown', onKey, true);
            observer?.disconnect();
            if (chatEvent) ctx.eventSource?.removeListener?.(chatEvent, onChat);
            box?.remove(); box = null; state = null;
        },
    };
}
