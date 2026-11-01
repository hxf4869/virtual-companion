// 角色氛围色：从头像取饱和像素的加权平均（24×24 采样），返回 "r,g,b"（DESIGN.md §4）。
const cache = new Map();

export function weightedTint(data) {
    let r = 0; let g = 0; let b = 0; let w = 0;
    for (let i = 0; i < data.length; i += 4) {
        const [R, G, B, A] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
        if (A < 128) continue;
        const max = Math.max(R, G, B); const min = Math.min(R, G, B);
        const sat = max === 0 ? 0 : (max - min) / max;
        if (sat < .15) continue;
        const weight = sat * sat * (max / 255) + 0.001;
        r += R * weight; g += G * weight; b += B * weight; w += weight;
    }
    if (!w) return '';
    return [r, g, b].map((v) => Math.round(v / w)).join(',');
}

export function tintOf(src) {
    if (!src || typeof document === 'undefined') return Promise.resolve('');
    if (cache.has(src)) return cache.get(src);
    const p = new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            try {
                const c = document.createElement('canvas'); c.width = 24; c.height = 24;
                const g = c.getContext('2d'); g.drawImage(img, 0, 0, 24, 24);
                resolve(weightedTint(g.getImageData(0, 0, 24, 24).data));
            } catch { resolve(''); }
        };
        img.onerror = () => resolve('');
        img.src = src;
    });
    cache.set(src, p);
    return p;
}

export function avatarUrl(avatar) {
    return avatar ? `/thumbnail?type=avatar&file=${encodeURIComponent(avatar)}` : '';
}
