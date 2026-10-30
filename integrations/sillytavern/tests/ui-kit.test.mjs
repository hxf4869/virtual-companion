import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
    EASE_IN_OUT, EASE_OUT, SPRING, SPRING_FALLBACK, integrateSpring, spring,
} from '../extension/vc-model-settings/ui/motion.js';
import { selectDetent, SHEET_HALF_RATIO, SHEET_TOP_GAP } from '../extension/vc-model-settings/ui/sheet.js';
import {
    parseThemeMode, readThemeMode, readVcUiFlag, resolveTheme, writeThemeMode,
} from '../extension/vc-model-settings/ui/theme.js';
import { NEUTRAL_TINT, tintFromPixels } from '../extension/vc-model-settings/ui/tint.js';
import { icon, iconSpriteUrl } from '../extension/vc-model-settings/ui/icons.js';
import { readViewport } from '../extension/vc-model-settings/ui/viewport.js';
import { bindSegment } from '../extension/vc-model-settings/ui/controls.js';
import { popMenu } from '../extension/vc-model-settings/ui/menu.js';
import { installMiniDom } from './mini-dom.mjs';

const cssUrl = new URL('../extension/vc-model-settings/vc-ui.css', import.meta.url);
const indexUrl = new URL('../extension/vc-model-settings/index.js', import.meta.url);
const spriteUrl = new URL('../extension/vc-model-settings/ui/icons/lucide.svg', import.meta.url);
const licenseUrl = new URL('../extension/vc-model-settings/ui/icons/LICENSE-lucide.txt', import.meta.url);
const sourceUrl = new URL('../extension/vc-model-settings/ui/icons/SOURCE.txt', import.meta.url);

test('弹簧在有限步内收敛到目标', () => {
    let x = 0;
    let v = 800;
    let settled = false;
    for (let i = 0; i < 400; i += 1) {
        const next = integrateSpring(x, v, 100, 1 / 60);
        x = next.x;
        v = next.v;
        if (Math.abs(v) < 4 && Math.abs(x - 100) < 0.5) {
            settled = true;
            break;
        }
    }
    assert.equal(settled, true);
    assert.ok(Math.abs(x - 100) < 0.5);

    const realRaf = globalThis.requestAnimationFrame;
    const realCancel = globalThis.cancelAnimationFrame;
    let now = 0;
    const queue = [];
    globalThis.requestAnimationFrame = (fn) => {
        queue.push(fn);
        return queue.length;
    };
    globalThis.cancelAnimationFrame = () => {};
    const originalNow = performance.now;
    performance.now = () => now;
    try {
        let done = false;
        let value = null;
        spring(0, 100, 0, (step) => { value = step; }, () => { done = true; });
        for (let i = 0; i < 500 && queue.length && !done; i += 1) {
            const batch = queue.splice(0, queue.length);
            now += 16;
            for (const fn of batch) fn(now);
        }
        assert.equal(done, true);
        assert.equal(value, 100);
    } finally {
        globalThis.requestAnimationFrame = realRaf;
        globalThis.cancelAnimationFrame = realCancel;
        performance.now = originalNow;
    }
});

test('sheet 按 0.18 秒速度投影选择最近档或关闭', () => {
    const half = selectDetent({ y: 298, velocity: 0, containerHeight: 800 });
    assert.equal(half.action, 'move');
    assert.equal(half.translateY, 298);
    assert.deepEqual(half.detents, [298, 0]);
    assert.equal(half.H, 800 - SHEET_TOP_GAP);
    assert.equal(half.M, Math.round(800 * SHEET_HALF_RATIO));

    const full = selectDetent({ y: 20, velocity: 0, containerHeight: 800 });
    assert.equal(full.action, 'move');
    assert.equal(full.translateY, 0);

    const between = selectDetent({ y: 400, velocity: 0, containerHeight: 800 });
    assert.equal(between.action, 'move');
    assert.equal(between.translateY, 298);

    const closing = selectDetent({ y: 500, velocity: 0, containerHeight: 800 });
    assert.equal(closing.action, 'close');
    assert.equal(closing.translateY, half.H + 20);

    const flick = selectDetent({ y: 200, velocity: 2000, containerHeight: 800 });
    assert.equal(flick.action, 'close');
    assert.ok(flick.proj > flick.closeLine);

    const tie = selectDetent({ y: 149, velocity: 0, containerHeight: 800 });
    assert.equal(tie.action, 'move');
    assert.equal(tie.translateY, 298);

    const large = selectDetent({ y: 300, velocity: 0, containerHeight: 800, large: true });
    assert.deepEqual(large.detents, [0]);
    assert.equal(large.action, 'close');
    const largeHold = selectDetent({ y: 100, velocity: 0, containerHeight: 800, large: true });
    assert.equal(largeHold.action, 'move');
    assert.equal(largeHold.translateY, 0);
});

test('明暗模式解析，存储失败时保持自动且不抛出', () => {
    assert.equal(parseThemeMode('light'), 'light');
    assert.equal(parseThemeMode('dark'), 'dark');
    assert.equal(parseThemeMode('auto'), 'auto');
    assert.equal(parseThemeMode('DARK'), 'auto');
    assert.equal(parseThemeMode(''), 'auto');
    assert.equal(parseThemeMode(null), 'auto');
    assert.equal(resolveTheme('auto', true), 'dark');
    assert.equal(resolveTheme('auto', false), 'light');
    assert.equal(resolveTheme('light', true), 'light');
    assert.equal(resolveTheme('dark', false), 'dark');

    const broken = {
        getItem() { throw new Error('denied'); },
        setItem() { throw new Error('denied'); },
    };
    assert.equal(readThemeMode(broken), 'auto');
    assert.equal(writeThemeMode('dark', broken), 'dark');
    assert.equal(readThemeMode(broken), 'auto');
    assert.equal(readVcUiFlag({ getItem: () => 'on' }), true);
    assert.equal(readVcUiFlag({ getItem: () => 'off' }), false);
    assert.equal(readVcUiFlag({ getItem() { throw new Error('denied'); } }), false);
});

test('氛围色按饱和像素加权，读不到像素时返回中性灰', () => {
    assert.equal(tintFromPixels(null), NEUTRAL_TINT);
    assert.equal(tintFromPixels([]), NEUTRAL_TINT);
    assert.equal(tintFromPixels([128, 128, 128, 255]), NEUTRAL_TINT);
    assert.equal(tintFromPixels([200, 20, 20, 255]), '200,20,20');
    assert.equal(tintFromPixels([200, 20, 20, 255, 10, 10, 10, 255]), '200,20,20');
    assert.equal(tintFromPixels([200, 40, 40, 255, 80, 200, 80, 255]), '157,98,54');
});

test('图标输出指向扩展 sprite，并带上无障碍属性', async () => {
    const hidden = icon('search');
    assert.match(hidden, /class="vc-icon"/);
    assert.match(hidden, /aria-hidden="true"/);
    assert.match(hidden, /--vc-icon-size:22px/);
    assert.match(hidden, new RegExp(`href="${iconSpriteUrl().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}#search"`));
    const labeled = icon('brain', { size: 24, label: '记忆' });
    assert.match(labeled, /aria-label="记忆"/);
    assert.match(labeled, /--vc-icon-size:24px/);
    assert.equal(labeled.includes('aria-hidden'), false);
    assert.throws(() => icon('not an icon'), /unknown icon/);

    const sprite = await readFile(spriteUrl, 'utf8');
    const license = await readFile(licenseUrl, 'utf8');
    const source = (await readFile(sourceUrl, 'utf8')).trim();
    const names = 'message-circle users-round brain heart book-open chevron-left chevron-right chevrons-up-down ellipsis plus arrow-up arrow-down square refresh-cw pencil copy search x history key-round watch image settings sliders-horizontal sparkles quote book-marked puzzle user-round monitor link bell shield layers check trash-2 text-cursor play wand-sparkles zap square-pen git-branch globe upload download circle-alert wifi-off lock'.split(' ');
    assert.equal(names.length, 48);
    for (const name of names) assert.match(sprite, new RegExp(`id="${name}"`));
    assert.match(license, /ISC License/);
    assert.match(license, /Lucide Contributors 2022/);
    assert.equal(source, 'lucide-static@0.460.0 integrity sha512-X6pIdg7jVxv7YQ/uR241hwhNiztcAfmj181TbcX7HCxxk/3mGaRtAc6b2ftUvQBufbJE6ehgyzO2uVsa604tWg==');
    assert.match(sprite, /lucide-static@0\.460\.0 integrity sha512-/);
});

test('vc-ui.css 的每条规则都挂在 body.vc-ui、:root 或 html[data-vc-theme] 下', async () => {
    const css = await readFile(cssUrl, 'utf8');
    assert.equal(css.includes('@layer'), false);
    assert.equal(css.includes('data-theme'), false);
    assert.match(css, /prefers-color-scheme/);
    assert.match(css, /prefers-reduced-motion/);
    assert.match(css, /var\(--fontScale, 1\)/);
    assert.match(css, /max\(17px,/);
    assert.ok(css.includes(SPRING));
    assert.ok(css.includes(SPRING_FALLBACK));
    assert.ok(css.includes(EASE_IN_OUT));
    assert.ok(css.includes(EASE_OUT));
    assert.match(css, /#bg1[\s\S]*display:\s*none !important/);
    assert.equal(css.includes('#top-bar'), false);
    assert.equal(css.includes('#top-settings-holder'), false);
    assert.match(css, /body\.vc-ui\.no-blur[\s\S]*backdrop-filter:[^;]+!important/);
    assert.match(css, /documentstyle/);
    assert.match(css, /bubblechat/);
    assert.match(css, /--vc-mes-avatar-radius/);
    assert.equal(css.split('--vc-danger-fill: #d70015;').length - 1, 4);
    assert.match(css, /\.vc-btn-danger \{ background: var\(--vc-danger-fill\)/);
    assert.match(css, /\.vc-badge[\s\S]*background: var\(--vc-danger-fill\)/);
    assert.match(css, /\.vc-alert-actions button\.is-danger[\s\S]*background: var\(--vc-danger-fill\)/);
    assert.match(css, /\.vc-btn-text\.is-danger \{ background: transparent; color: var\(--vc-danger\)/);
    assert.match(css, /\.vc-dot-danger \{ background: var\(--vc-danger\)/);
    assert.match(css, /#toast-container > \.toast/);
    assert.match(css, /toast-success/);
    assert.match(css, /toast-error/);
    assert.match(css, /\.vc-search::before \{ top: -3px; \}/);
    assert.match(css, /\.vc-segment button::after/);
    assert.match(css, /\.vc-sheet-back/);
    assert.equal(css.includes('animation-duration: 1ms'), false);
    assert.match(css, /--vc-z-scrim:\s*30/);
    assert.match(css, /--vc-z-menu:\s*32/);
    assert.match(css, /--vc-z-sheet:\s*40/);
    assert.match(css, /--vc-z-alert:\s*60/);
    assert.match(css, /--vc-z-toast:\s*70/);
    assert.match(css, /\.vc-scrim \{[^}]*z-index:\s*var\(--vc-z-scrim\)/);
    assert.match(css, /\.vc-menu \{[^}]*z-index:\s*var\(--vc-z-menu\)/);
    assert.match(css, /\.vc-sheet \{[^}]*z-index:\s*var\(--vc-z-sheet\)/);
    assert.match(css, /\.vc-alert \{[^}]*z-index:\s*var\(--vc-z-alert\)/);
    assert.match(css, /\.vc-toast \{[^}]*z-index:\s*var\(--vc-z-toast\)/);
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    assert.match(reduced, /transition-property:\s*opacity\s*!important/);
    assert.match(reduced, /transition-duration:\s*150ms\s*!important/);
    assert.match(reduced, /vc-shell-chat\.is-push[\s\S]*animation-name:\s*none\s*!important/);
    assert.equal(reduced.includes('1ms'), false);

    const errors = [];
    walkCss(stripComments(css), (selector) => {
        for (const part of splitSelectors(selector)) {
            const piece = part.trim();
            if (!piece) continue;
            const ok = piece.includes('body.vc-ui')
                || piece.startsWith(':root')
                || piece.startsWith('html[data-vc-theme');
            if (!ok) errors.push(piece);
        }
    });
    assert.deepEqual(errors, []);
});

test('index.js 默认不启用新外观', async () => {
    const src = await readFile(indexUrl, 'utf8');
    assert.match(src, /function mountVcUi\(\) \{\n    if \(!readVcUiFlag\(\)\) return;\n    enableVcUi\(\);/);
    assert.equal([...src.matchAll(/enableVcUi\(\)/g)].length, 1);
    const guard = src.indexOf('if (!readVcUiFlag()) return;');
    const call = src.indexOf('enableVcUi();');
    assert.ok(guard !== -1 && call > guard);
    assert.match(src, /vc-ui\.css/);
    assert.match(src, /mountVcUi\(\);/);
});

test('键盘高度用可视视口与布局视口的差', () => {
    assert.deepEqual(readViewport({ innerHeight: 800, visualViewport: { height: 500, offsetTop: 0 } }), { keyboard: 300, height: 500 });
    assert.deepEqual(readViewport({ innerHeight: 800, visualViewport: { height: 520, offsetTop: 40 } }), { keyboard: 240, height: 520 });
    assert.deepEqual(readViewport({ innerHeight: 844 }), { keyboard: 0, height: 844 });
});

test('分段控件按 aria-pressed 定位，外部同步与窗口变化不播动画', () => {
    const { root, buttons, thumb, view } = makeSegment({ pressed: 1 });
    const seen = [];
    const api = bindSegment(root, { onChange(index) { seen.push(index); } });
    assert.equal(thumb.style.transform, 'translateX(100%)');
    assert.equal(thumb.style.width, 'calc((100% - 4px) / 3)');
    assert.equal(thumb.style.transition, '');
    const initTransform = thumb.styleLog.filter(([key]) => key === 'transform')[0];
    assert.equal(initTransform[1], 'translateX(100%)');
    assert.equal(initTransform[2], 'none');
    assert.deepEqual(seen, []);
    assert.equal(buttons[1].getAttribute('aria-pressed'), 'true');
    assert.equal(buttons[1].getAttribute('aria-checked'), 'true');
    assert.equal(buttons[0].getAttribute('aria-pressed'), 'false');

    buttons.forEach((btn, index) => btn.setAttribute('aria-pressed', index === 2 ? 'true' : 'false'));
    buttons[0].setAttribute('aria-checked', 'true');
    api.sync();
    assert.equal(thumb.style.transform, 'translateX(200%)');
    assert.equal(buttons[2].getAttribute('aria-checked'), 'true');
    assert.equal(buttons[0].getAttribute('aria-checked'), 'false');
    assert.equal(buttons[0].getAttribute('aria-pressed'), 'false');
    const syncTransform = thumb.styleLog.filter(([key]) => key === 'transform').at(-1);
    assert.equal(syncTransform[2], 'none');
    assert.deepEqual(seen, []);

    thumb.style.transform = 'translateX(40%)';
    view.dispatch('resize');
    assert.equal(thumb.style.transform, 'translateX(200%)');

    api.select(0);
    assert.deepEqual(seen, [0]);
    assert.equal(thumb.style.transform, 'translateX(0%)');
    const userTransform = thumb.styleLog.filter(([key]) => key === 'transform').at(-1);
    assert.equal(userTransform[2], '');

    const checkedOnly = makeSegment({ checked: 1 });
    bindSegment(checkedOnly.root);
    assert.equal(checkedOnly.thumb.style.transform, 'translateX(100%)');
});

test('分段控件 dispose 后不再听窗口缩放', () => {
    const { root, thumb, view } = makeSegment({ pressed: 0 });
    const api = bindSegment(root);
    assert.equal(typeof api.dispose, 'function');
    api.dispose();
    thumb.style.transform = 'translateX(40%)';
    view.dispatch('resize');
    assert.equal(thumb.style.transform, 'translateX(40%)');
    api.dispose();
});

test('弹出菜单把 Tab 圈在菜单项里', () => {
    const document = installMiniDom();
    const keys = [];
    document.addEventListener = (type, fn) => { if (type === 'keydown') keys.push(fn); };
    document.removeEventListener = () => {};
    document.defaultView = { innerWidth: 800, innerHeight: 600 };
    const prevRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (fn) => { fn(); return 1; };
    try {
        const anchor = document.createElement('button');
        anchor.getBoundingClientRect = () => ({ left: 20, top: 20, right: 64, bottom: 64, width: 44, height: 44 });
        document.body.append(anchor);
        const opened = popMenu(anchor, [
            { label: '复制', run() {} },
            { label: '删除', danger: true, run() {} },
        ]);
        const items = opened.menu.querySelectorAll('[role="menuitem"]');
        assert.equal(items.length, 2);
        items[1].focus();
        let prevented = false;
        keys.at(-1)({
            key: 'Tab',
            shiftKey: false,
            preventDefault() { prevented = true; },
            stopPropagation() {},
        });
        assert.equal(prevented, true);
        assert.equal(document.activeElement, items[0]);
        prevented = false;
        keys.at(-1)({
            key: 'Tab',
            shiftKey: true,
            preventDefault() { prevented = true; },
            stopPropagation() {},
        });
        assert.equal(prevented, true);
        assert.equal(document.activeElement, items[1]);
    } finally {
        if (prevRaf) globalThis.requestAnimationFrame = prevRaf;
        else delete globalThis.requestAnimationFrame;
    }
});

function makeSegment({ pressed = -1, checked = -1 } = {}) {
    const listeners = [];
    const view = {
        addEventListener(type, fn) { listeners.push({ type, fn }); },
        removeEventListener(type, fn) {
            const index = listeners.findIndex((item) => item.type === type && item.fn === fn);
            if (index >= 0) listeners.splice(index, 1);
        },
        dispatch(type) {
            for (const item of listeners) if (item.type === type) item.fn();
        },
    };
    const buttons = [0, 1, 2].map((index) => makeEl('button', {
        ...(pressed === index ? { 'aria-pressed': 'true' } : pressed >= 0 ? { 'aria-pressed': 'false' } : {}),
        ...(checked === index ? { 'aria-checked': 'true' } : {}),
    }));
    const thumb = makeEl('i', { class: 'vc-segment-thumb' });
    const root = makeEl('div', {}, [thumb, ...buttons]);
    root.ownerDocument = { defaultView: view };
    return { root, buttons, thumb, view };
}

function makeEl(tag, attrs = {}, children = []) {
    const styleLog = [];
    const styleState = { transition: '', transform: '', width: '' };
    const style = new Proxy(styleState, {
        set(obj, key, value) {
            styleLog.push([key, value, obj.transition]);
            obj[key] = value;
            return true;
        },
        get(obj, key) {
            return obj[key];
        },
    });
    const node = {
        tagName: tag.toUpperCase(),
        attrs: { ...attrs },
        children,
        style,
        styleLog,
        tabIndex: 0,
        offsetWidth: 120,
        ownerDocument: null,
        setAttribute(name, value) { this.attrs[name] = String(value); },
        getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null; },
        hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name); },
        addEventListener() {},
        focus() {},
        querySelectorAll(sel) {
            if (sel === ':scope > button') return this.children.filter((child) => child.tagName === 'BUTTON');
            return [];
        },
        querySelector(sel) {
            if (sel === ':scope > .vc-segment-thumb') {
                return this.children.find((child) => child.attrs.class === 'vc-segment-thumb') || null;
            }
            return null;
        },
    };
    return node;
}

function stripComments(css) {
    return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function matchingBrace(css, open) {
    let depth = 0;
    for (let i = open; i < css.length; i += 1) {
        if (css[i] === '{') depth += 1;
        else if (css[i] === '}') {
            depth -= 1;
            if (depth === 0) return i;
        }
    }
    throw new Error('unbalanced brace');
}

function walkCss(css, fn) {
    let i = 0;
    while (i < css.length) {
        while (i < css.length && /\s/.test(css[i])) i += 1;
        if (i >= css.length) break;
        const brace = css.indexOf('{', i);
        if (brace < 0) break;
        const prelude = css.slice(i, brace).trim();
        const end = matchingBrace(css, brace);
        const body = css.slice(brace + 1, end);
        if (prelude.startsWith('@')) {
            const name = prelude.slice(1).split(/[\s(]/)[0].toLowerCase();
            if (name === 'keyframes' || name === '-webkit-keyframes') {
                const frame = prelude.split(/\s+/)[1] || '';
                if (!/^vc-[\w-]+$/.test(frame)) throw new Error(`keyframes ${prelude}`);
            } else if (name === 'media' || name === 'supports') {
                walkCss(body, fn);
            } else {
                throw new Error(`at-rule ${prelude}`);
            }
        } else if (prelude) {
            fn(prelude);
        }
        i = end + 1;
    }
}

function splitSelectors(selector) {
    const parts = [];
    let current = '';
    let depth = 0;
    for (const ch of selector) {
        if (ch === '(') depth += 1;
        else if (ch === ')') depth = Math.max(0, depth - 1);
        else if (ch === ',' && depth === 0) {
            parts.push(current);
            current = '';
            continue;
        }
        current += ch;
    }
    if (current.trim()) parts.push(current);
    return parts;
}
