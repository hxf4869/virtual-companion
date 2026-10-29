// 从头像取氛围色：24×24 采样，饱和像素加权平均，失败时返回中性灰。
export const NEUTRAL_TINT = '140,140,150';

const cache = new Map();

export function tintFromPixels(data) {
    if (!data || data.length < 4) return NEUTRAL_TINT;
    let r = 0;
    let g = 0;
    let b = 0;
    let w = 0;
    for (let i = 0; i + 3 < data.length; i += 4) {
        const red = data[i];
        const green = data[i + 1];
        const blue = data[i + 2];
        const mx = Math.max(red, green, blue);
        const mn = Math.min(red, green, blue);
        const sat = mx ? (mx - mn) / mx : 0;
        const wt = sat * sat * (mx > 40 && mx < 245 ? 1 : 0.1);
        r += red * wt;
        g += green * wt;
        b += blue * wt;
        w += wt;
    }
    if (!w) return NEUTRAL_TINT;
    return [r / w, g / w, b / w].map((v) => Math.round(v)).join(',');
}

export function clearTintCache() {
    cache.clear();
}

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('image'));
        img.src = src;
    });
}

async function sampleUrl(src) {
    if (typeof document === 'undefined') return NEUTRAL_TINT;
    try {
        const img = await loadImage(src);
        const canvas = document.createElement('canvas');
        canvas.width = 24;
        canvas.height = 24;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return NEUTRAL_TINT;
        ctx.drawImage(img, 0, 0, 24, 24);
        let pixels;
        try {
            pixels = ctx.getImageData(0, 0, 24, 24).data;
        } catch {
            return NEUTRAL_TINT;
        }
        return tintFromPixels(pixels);
    } catch {
        return NEUTRAL_TINT;
    }
}

export async function tintOf(src) {
    const key = String(src);
    if (cache.has(key)) return cache.get(key);
    const value = await sampleUrl(key);
    cache.set(key, value);
    return value;
}
