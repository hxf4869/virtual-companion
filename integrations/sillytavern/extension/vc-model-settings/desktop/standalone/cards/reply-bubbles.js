// 共享回复分段/气泡叶子 DOM 渲染模块（由 cards/index.js 与原生 chat-view.js 共同消费）。
import {
    TYPING_COPY,
    splitReply,
    typingDelay,
    actionLine,
    segmentMark,
} from '../../../chat-logic.js';

let foldSequence = 0;

function desktopLayout(doc) {
    const d = doc || globalThis.document;
    const layout = d?.documentElement?.getAttribute?.('data-vc-layout');
    const app = d?.documentElement?.getAttribute?.('data-vc-app');
    return layout === 'desktop' || Boolean(app);
}

function prefersReducedMotion() {
    try {
        return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
    } catch {
        return false;
    }
}

function clearChildren(node) {
    if (!node) return;
    if (typeof node.replaceChildren === 'function') {
        node.replaceChildren();
        return;
    }
    if (Array.isArray(node.children)) node.children.length = 0;
}

function writeClasses(node, names) {
    const unique = [...new Set(names.filter(Boolean))];
    node.className = unique.join(' ');
    if (Array.isArray(node._classes)) node._classes = unique;
}

function hasClass(node, name) {
    return (
        node?.classList?.contains?.(name) === true ||
        node?.className?.split?.(/\s+/)?.includes?.(name) === true
    );
}

function addClass(node, name) {
    if (!node || hasClass(node, name)) return;
    if (typeof node.classList?.remove === 'function') {
        node.classList.add(name);
        return;
    }
    writeClasses(node, [...String(node.className || '').split(/\s+/), name]);
}

function removeClass(node, name) {
    if (!node || !hasClass(node, name)) return;
    if (typeof node.classList?.remove === 'function') {
        node.classList.remove(name);
        return;
    }
    writeClasses(
        node,
        String(node.className || '')
            .split(/\s+/)
            .filter((item) => item !== name),
    );
}

function insertBefore(parent, node, ref) {
    if (!parent || !node) return;
    if (typeof parent.insertBefore === 'function') {
        parent.insertBefore(node, ref || null);
        return;
    }
    const list = parent.children;
    if (!Array.isArray(list)) {
        parent.append(node);
        return;
    }
    node.parent = parent;
    const index = ref ? list.indexOf(ref) : -1;
    if (index < 0) list.push(node);
    else list.splice(index, 0, node);
}

function removeNode(node) {
    if (!node) return;
    if (typeof node.remove === 'function') {
        node.remove();
        return;
    }
    const parent = node.parent;
    if (!parent?.children) return;
    const index = parent.children.indexOf(node);
    if (index >= 0) parent.children.splice(index, 1);
    node.parent = null;
}

export function clearReplyBubbles(mes) {
    if (!mes) return;
    removeNode(mes.querySelector?.('.vc-segs'));
    removeClass(mes, 'vc-segmented');
    mes.removeAttribute?.('data-vc-segs');
    mes.querySelector?.('.mes_text')?.removeAttribute?.('aria-hidden');
}

export function appendReplySegment(box, segment) {
    const doc = box?.ownerDocument || globalThis.document;
    if (segment && typeof segment === 'object' && segment.type === 'sticker') {
        const node = doc.createElement('div');
        node.className = 'vc-sticker-bubble';
        node.setAttribute('data-vc-sticker', segment.tag || '');
        if (segment.kind === 'kaomoji') {
            const span = doc.createElement('span');
            span.className = 'vc-sticker-kaomoji';
            span.textContent = segment.text || '';
            node.append(span);
        } else {
            const img = doc.createElement('img');
            img.alt = segment.tag || '';
            img.src = segment.src || '';
            node.append(img);
        }
        box.append(node);
        return;
    }
    const text = String(segment ?? '');
    const seg = doc.createElement('p');
    seg.className = text.startsWith('<sticker') ? 'vc-seg vc-seg-sticker' : 'vc-seg';
    seg.textContent = text;
    if (desktopLayout(doc) && !text.startsWith('<sticker')) {
        const line = actionLine(text);
        if (line.action) {
            addClass(seg, 'vc-seg-action');
            seg.textContent = line.text;
        }
    }
    box.append(seg);
}

export function renderReplyBubbles(mes, text, { reducedMotion = false, schedule = setTimeout } = {}) {
    if (!mes) return;
    const doc = mes.ownerDocument || globalThis.document;
    const segments = splitReply(String(text ?? ''));
    const prose = segments.filter((item) => typeof item === 'string' && !item.startsWith('<sticker')).join('\n');
    const foldable = [...prose].length > 360;
    if (segments.length <= 1 && !foldable) {
        clearReplyBubbles(mes);
        return;
    }
    const key = segments.map(segmentMark).join('\u0001');
    const existing = mes.querySelector?.('.vc-segs');
    if (mes.getAttribute?.('data-vc-segs') === key && existing) return;
    clearReplyBubbles(mes);
    mes.setAttribute?.('data-vc-segs', key);
    addClass(mes, 'vc-segmented');
    const textEl = mes.querySelector?.('.mes_text');
    textEl?.setAttribute?.('aria-hidden', 'true');
    const box = doc.createElement('div');
    box.className = 'vc-segs';
    const parent = textEl?.parentElement || textEl?.parent || mes;
    if (textEl) insertBefore(parent, box, textEl.nextSibling || null);
    else parent.append?.(box);
    if (foldable) {
        const content = doc.createElement('div');
        content.className = 'vc-segs';
        content.id = `vc-reply-full-${++foldSequence}`;
        const toggle = doc.createElement('button');
        toggle.type = 'button';
        toggle.className = 'vc-btn vc-btn-text vc-reply-expand';
        toggle.setAttribute('aria-controls', content.id);
        let expanded = false;
        const paintFold = () => {
            clearChildren(content);
            const visible = expanded ? segments : splitReply(`${[...prose].slice(0, 180).join('')}…`);
            for (const segment of visible) appendReplySegment(content, segment);
            if (!expanded) {
                for (const segment of segments.filter((item) => typeof item === 'object' || item.startsWith('<sticker'))) {
                    appendReplySegment(content, segment);
                }
            }
            toggle.setAttribute('aria-expanded', String(expanded));
            toggle.textContent = expanded ? '收起' : '展开全文';
        };
        toggle.addEventListener('click', () => {
            expanded = !expanded;
            paintFold();
        });
        box.append(content, toggle);
        paintFold();
        return;
    }
    const paint = (count, typing) => {
        clearChildren(box);
        for (let index = 0; index < count; index += 1) appendReplySegment(box, segments[index]);
        if (typing) {
            const note = doc.createElement('p');
            note.className = 'vc-typing';
            note.setAttribute('role', 'status');
            note.textContent = TYPING_COPY;
            box.append(note);
        }
    };
    if (reducedMotion || prefersReducedMotion()) {
        paint(segments.length, false);
        return;
    }
    let spent = 0;
    const step = (index) => {
        if (mes.getAttribute?.('data-vc-segs') !== key) return;
        paint(index + 1, index + 1 < segments.length);
        if (index + 1 >= segments.length) return;
        const delay = typingDelay(segmentMark(segments[index + 1]), index + 1, { spentMs: spent });
        spent += delay;
        schedule(() => step(index + 1), delay);
    };
    const first = typingDelay(segments[0], 0, { spentMs: 0 });
    paint(0, true);
    spent = first;
    schedule(() => step(0), first);
}
