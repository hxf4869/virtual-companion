// 用本扩展的 Lucide sprite 生成 <svg><use>，描边与端点由 CSS 控制。
const SPRITE = new URL('./icons/lucide.svg', import.meta.url);

function esc(value) {
    return String(value).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

export function iconSpriteUrl() {
    return SPRITE.href;
}

export function icon(name, { size = 22, label } = {}) {
    if (typeof name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
        throw new Error('unknown icon');
    }
    const px = Number(size);
    const safe = Number.isFinite(px) && px > 0 ? px : 22;
    const href = `${SPRITE.href}#${name}`;
    const a11y = label ? ` role="img" aria-label="${esc(label)}"` : ' aria-hidden="true"';
    return `<svg class="vc-icon" style="--vc-icon-size:${safe}px" width="${safe}" height="${safe}"${a11y}><use href="${esc(href)}"></use></svg>`;
}
