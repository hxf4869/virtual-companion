// 桌面会话内搜索（UX-23 §1.5）：标题栏右侧圆钮展开为搜索条，范围是当前会话已渲染的消息。
// 高亮用 CSS Custom Highlight API，不往 .mes_text 子树插任何节点；不支持时只给当前匹配的 .mes 描边。
import { icon } from './ui/icons.js';
import { reducedMotion } from './desktop/transition.js';
import { jumpToMessage } from './chat-scroll.js';

const STYLE_ID = 'vc-desktop-chat-search-css';
const DEBOUNCE_MS = 250;
const MESSAGE_EVENTS = ['MESSAGE_SENT', 'MESSAGE_RECEIVED', 'MESSAGE_EDITED', 'MESSAGE_DELETED', 'MESSAGE_SWIPED'];

// 在一段文本里找全部不重叠的匹配，大小写不敏感。返回 [start, end) 偏移。
export function textMatches(text, query) {
    const needle = String(query ?? '').trim();
    if (!needle) return [];
    const lower = text.toLowerCase(), lowerNeedle = needle.toLowerCase();
    const [hay, key] = lower.length === text.length && lowerNeedle.length === needle.length ? [lower, lowerNeedle] : [text, needle];
    const found = [];
    for (let at = hay.indexOf(key); at >= 0; at = hay.indexOf(key, at + key.length)) found.push([at, at + key.length]);
    return found;
}

// 把拼接文本里的 [start, end) 还原为文本节点序号与节点内偏移。parts 是各文本节点的内容。
export function spanOf(parts, start, end) {
    let base = 0, from = null, to = null;
    for (let i = 0; i < parts.length; i += 1) {
        const next = base + parts[i].length;
        if (from == null && start < next) from = { part: i, offset: start - base };
        if (end <= next) { to = { part: i, offset: end - base }; break; }
        base = next;
    }
    return from && to ? { from, to } : null;
}

function ensureStyle(doc) {
    if (doc.getElementById(STYLE_ID) || !doc.head) return;
    const link = doc.createElement('link');
    link.media = '(min-width: 744px)';
    link.id = STYLE_ID; link.rel = 'stylesheet'; link.href = new URL('./desktop/chat-search.css', import.meta.url).href;
    doc.head.append(link);
}

function textNodes(root) {
    const walker = root.ownerDocument.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */, {
        acceptNode: (node) => (/^(SCRIPT|STYLE)$/.test(node.parentElement?.tagName || '') ? 2 : 1),
    });
    const nodes = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node);
    return nodes;
}

// 消息里用户看得到的文字：分段气泡的 .vc-segs，或原生 .mes_text；被 aria-hidden 的原文不算。
function visibleRoots(mes) {
    return [...mes.querySelectorAll('.mes_text, .vc-segs')].filter((el) => !el.closest('[aria-hidden="true"]'));
}

export function collectMatches(chat, query) {
    const matches = [];
    for (const mes of chat.querySelectorAll(':scope > .mes')) {
        for (const root of visibleRoots(mes)) {
            const nodes = textNodes(root), parts = nodes.map((node) => node.data);
            for (const [start, end] of textMatches(parts.join(''), query)) {
                const span = spanOf(parts, start, end);
                if (!span) continue;
                const range = root.ownerDocument.createRange();
                range.setStart(nodes[span.from.part], span.from.offset);
                range.setEnd(nodes[span.to.part], span.to.offset);
                matches.push({ mes, range });
            }
        }
    }
    return matches;
}

const highlightSupported = () => typeof globalThis.CSS?.highlights?.set === 'function' && typeof globalThis.Highlight === 'function';

export function mountChatSearch({ pane, getContext, doc = pane.ownerDocument } = {}) {
    const navbar = pane?.querySelector('.vc-navbar'), capsule = pane?.querySelector('.vc-capsule');
    if (!navbar || !capsule) return null;
    ensureStyle(doc);
    const el = (tag, className) => { const node = doc.createElement(tag); if (className) node.className = className; return node; };
    const circle = (label, glyph, size, run) => {
        const button = el('button', 'vc-circle'); button.type = 'button';
        button.setAttribute('aria-label', label); button.innerHTML = icon(glyph, { size });
        button.addEventListener('click', run); return button;
    };

    const toggle = circle('搜索', 'search', 20, () => open());
    toggle.classList.add('vc-desk-search-toggle');
    capsule.prepend(toggle);

    const bar = el('div', 'vc-chat-search'); bar.hidden = true; bar.setAttribute('role', 'search');
    const field = el('label', 'vc-chat-search-field');
    const input = el('input'); input.type = 'text'; input.autocomplete = 'off'; input.enterKeyHint = 'search';
    input.placeholder = '搜索'; input.setAttribute('aria-label', '搜索');
    const count = el('span', 'vc-chat-search-count vc-num'); count.setAttribute('aria-live', 'polite');
    const prev = circle('上一条', 'arrow-up', 18, () => step(-1));
    const next = circle('下一条', 'arrow-down', 18, () => step(1));
    const done = el('button', 'vc-btn vc-btn-gray vc-chat-search-done'); done.type = 'button'; done.textContent = '完成';
    done.addEventListener('click', () => close());
    const glyph = el('span', 'vc-chat-search-icon'); glyph.innerHTML = icon('search', { size: 18 });
    field.append(glyph, input, count);
    bar.append(field, prev, next, done); navbar.append(bar);

    let matches = [], index = -1, timer = 0;
    const chatNode = () => doc.getElementById('chat');

    function clearMarks() {
        if (highlightSupported()) { CSS.highlights.delete('vc-search'); CSS.highlights.delete('vc-search-current'); }
        for (const mes of doc.querySelectorAll('#chat > .mes[data-vc-search-current]')) mes.removeAttribute('data-vc-search-current');
    }
    function paintCount() {
        const query = input.value.trim();
        count.textContent = !query ? '' : matches.length ? `${index + 1} / ${matches.length}` : '没有找到';
        prev.disabled = next.disabled = matches.length < 2;
    }
    function mark(scroll) {
        clearMarks(); paintCount();
        if (!matches.length) return;
        if (highlightSupported()) {
            CSS.highlights.set('vc-search', new Highlight(...matches.map((m) => m.range)));
            const current = new Highlight(matches[index].range); current.priority = 1;
            CSS.highlights.set('vc-search-current', current);
        }
        const { mes, range } = matches[index];
        mes.setAttribute('data-vc-search-current', '');
        // 跳转走会话滚动模块（平滑滚动 + 高亮）；它没挂载时退回原生滚动。
        if (scroll && !jumpToMessage(mes.getAttribute('mesid'))) (range.startContainer.parentElement || mes).scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
    }
    // 起点取第一条还没滚出视口上沿的匹配，其后都在下方；没有就取最后一条。
    function startIndex() {
        const top = chatNode()?.getBoundingClientRect().top ?? 0;
        const at = matches.findIndex((m) => m.range.getBoundingClientRect().bottom >= top);
        return at < 0 ? matches.length - 1 : at;
    }
    function run({ keep = false } = {}) {
        timer = 0;
        const chat = chatNode(), query = input.value.trim();
        matches = chat && query ? collectMatches(chat, query) : [];
        index = !matches.length ? -1 : keep && index >= 0 ? Math.min(index, matches.length - 1) : startIndex();
        mark(!keep);
    }
    function step(delta) {
        if (!matches.length) return;
        index = (index + delta + matches.length) % matches.length;
        mark(true);
    }
    function open() {
        pane.dataset.search = 'open'; bar.hidden = false;
        input.focus(); input.select(); run();
    }
    function close() {
        clearTimeout(timer); timer = 0; matches = []; index = -1; clearMarks();
        delete pane.dataset.search; bar.hidden = true;
        if (doc.activeElement === doc.body || bar.contains(doc.activeElement)) toggle.focus();
    }

    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, DEBOUNCE_MS); });
    bar.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
        if (event.key !== 'Enter' || event.isComposing || event.target !== input) return;
        event.preventDefault();
        if (timer) { clearTimeout(timer); run(); return; }
        step(event.shiftKey ? -1 : 1);
    });

    // ⌘F / Ctrl+F 打开会话内搜索（会话页可见时）；Esc 在没有更上层浮层处理时关闭它。
    const onKey = (event) => {
        if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && String(event.key).toLowerCase() === 'f') {
            if (pane.getClientRects?.().length === 0) return;
            event.preventDefault();
            open();
            return;
        }
        if (event.key === 'Escape' && !event.defaultPrevented && !bar.hidden) { event.preventDefault(); close(); }
    };
    doc.addEventListener('keydown', onKey);

    const ctx = getContext?.(), source = ctx?.eventSource, types = ctx?.eventTypes || {};
    const onChat = () => close();
    const onMessage = () => { if (!bar.hidden && input.value.trim()) { clearTimeout(timer); timer = setTimeout(() => run({ keep: true }), DEBOUNCE_MS); } };
    const bound = [];
    if (source?.on) {
        if (types.CHAT_CHANGED) bound.push([types.CHAT_CHANGED, onChat]);
        for (const name of MESSAGE_EVENTS) if (types[name]) bound.push([types[name], onMessage]);
        for (const [type, handler] of bound) source.on(type, handler);
    }
    return {
        toggle, bar, open, close,
        destroy() {
            close();
            doc.removeEventListener('keydown', onKey);
            for (const [type, handler] of bound) source.removeListener?.(type, handler);
            bar.remove(); toggle.remove();
        },
    };
}
