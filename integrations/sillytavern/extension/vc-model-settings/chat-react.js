// UX-26 表情与回应（桌面）：纯 emoji 放大、表情 / 贴纸面板、消息回应、拍一拍、关键词轻特效。
// 规格 docs/planning/2026-11-02-ux24-desktop-experience.md §1 UX-26；文案 companion-copy §20。
// 只在 html[data-vc-layout="desktop"] 生效；不往 #chat 插节点，不往 .mes_text 子树插节点。
import { quoteSummary } from './chat-compose.js';
import { reducedMotion } from './desktop/transition.js';
import { listStickerPicks } from './stickers.js';
import { mountSuggest } from './desktop/suggest.js';

export const COPY = Object.freeze({
    searchPlaceholder: '搜索表情',
    emojiTab: '表情',
    stickerTab: '贴纸',
    recent: '最近',
    empty: '没有找到',
    more: '更多',
    patLine: (name) => `你拍了拍${name}`,
});
export const REACTIONS = Object.freeze([
    { emoji: '❤️', label: '喜欢' },
    { emoji: '👍', label: '赞' },
    { emoji: '😂', label: '哈哈' },
    { emoji: '😮', label: '惊讶' },
    { emoji: '😢', label: '难过' },
    { emoji: '🤗', label: '抱抱' },
]);
export const MAX_REACTIONS = 3;
export const RECENT_KEY = 'vc-emoji-recent';
export const RECENT_MAX = 16;
export const EFFECTS_KEY = 'vc-keyword-effects';
export const NUDGE_KEY = 'vc_pending_nudges';
export const NUDGE_PROMPT = 'vc_react_nudge';
export const PAT_WINDOW_MS = 10000;
export const EFFECT_MS = 1100;

// ---- 纯逻辑（单测直接覆盖） ----

const SINGLE = /^(?:\p{Extended_Pictographic}[\p{Emoji_Modifier}️‍\p{Extended_Pictographic}\u{E0020}-\u{E007F}]*|\p{Regional_Indicator}{2}|[0-9#*]️?⃣)$/u;
const SEGMENTER = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('zh', { granularity: 'grapheme' }) : null;

function graphemes(body) {
    if (SEGMENTER) return [...SEGMENTER.segment(body)].map((item) => item.segment);
    return body.match(/\p{Extended_Pictographic}[\p{Emoji_Modifier}️‍\p{Extended_Pictographic}]*|\p{Regional_Indicator}{2}|[0-9#*]️?⃣|[\s\S]/gu) || [];
}

// 只有 1–3 个 emoji（空白除外）返回个数，夹杂文字或超过 3 个返回 0。
export function emojiCount(text) {
    const body = String(text ?? '').replace(/\s+/g, '');
    if (!body) return 0;
    const parts = graphemes(body);
    if (parts.length < 1 || parts.length > 3) return 0;
    for (const part of parts) {
        if (!SINGLE.test(part)) return 0;
        // ©、®、™ 这类单码点符号默认是文字样式，不当作表情。
        if (/^\p{Extended_Pictographic}$/u.test(part) && part.codePointAt(0) < 0x2190) return 0;
    }
    return parts.length;
}

export function toggleReaction(list, emoji, max = MAX_REACTIONS) {
    const current = Array.isArray(list) ? list.filter((item) => typeof item === 'string' && item) : [];
    if (current.includes(emoji)) return current.filter((item) => item !== emoji);
    return [...current, emoji].slice(-max);
}

export function reactionNudge({ user = '', text = '', emoji = '' } = {}) {
    return `（${user}对「${quoteSummary(text)}」回应了${emoji}）`;
}

export function patNudge({ user = '', name = '' } = {}) {
    return `（${user}拍了拍${name}）`;
}

export function addNudge(metadata, { id, text }) {
    if (!metadata || !id || !text) return;
    const rest = (Array.isArray(metadata[NUDGE_KEY]) ? metadata[NUDGE_KEY] : []).filter((item) => item?.id !== id);
    metadata[NUDGE_KEY] = [...rest, { id, text }];
}

export function dropNudge(metadata, id) {
    if (!Array.isArray(metadata?.[NUDGE_KEY])) return;
    const rest = metadata[NUDGE_KEY].filter((item) => item?.id !== id);
    if (rest.length) metadata[NUDGE_KEY] = rest;
    else delete metadata[NUDGE_KEY];
}

// 取走全部待注入记录：返回合并后的提示词（没有则空串），并清空记录，保证只注入一次。
export function takeNudges(metadata) {
    const list = Array.isArray(metadata?.[NUDGE_KEY]) ? metadata[NUDGE_KEY] : [];
    if (metadata && NUDGE_KEY in metadata) delete metadata[NUDGE_KEY];
    return list.map((item) => item?.text).filter(Boolean).join('\n');
}

export async function injectNudges(ctx) {
    if (!ctx?.setExtensionPrompt) return;
    const text = takeNudges(ctx.chatMetadata);
    if (!text) return;
    ctx.setExtensionPrompt(NUDGE_PROMPT, text, 1, 0, false, 0);
    await ctx.saveMetadata?.();
}

export function planPat({ now, last } = {}) {
    return { generate: !(Number.isFinite(last) && now - last < PAT_WINDOW_MS) };
}

const KEYWORDS = [
    ['生日快乐', 'confetti'],
    ['新年快乐', 'confetti'],
    ['圣诞快乐', 'confetti'],
    ['晚安', 'stars'],
];

export function keywordEffect(text) {
    const body = String(text ?? '');
    return KEYWORDS.find(([word]) => body.includes(word))?.[1] || null;
}

export function effectsEnabled(storage = globalThis.localStorage) {
    try { return !['off', '0', 'false'].includes(String(storage?.getItem(EFFECTS_KEY) ?? '').toLowerCase()); } catch { return true; }
}

export function pushRecent(list, entry, max = RECENT_MAX) {
    const rest = (Array.isArray(list) ? list : []).filter((item) => !(item?.k === entry.k && item?.v === entry.v));
    return [entry, ...rest].slice(0, max);
}

export function readRecent(storage = globalThis.localStorage) {
    try {
        const list = JSON.parse(storage?.getItem(RECENT_KEY) || '[]');
        return Array.isArray(list) ? list.filter((item) => (item?.k === 'e' || item?.k === 's') && typeof item.v === 'string').slice(0, RECENT_MAX) : [];
    } catch { return []; }
}

export function writeRecent(list, storage = globalThis.localStorage) {
    try { storage?.setItem(RECENT_KEY, JSON.stringify(list)); } catch { /* 隐私模式下最近使用只是不保存 */ }
}

// 名称里的空格分隔同义词；搜索按子串匹配名称或 emoji 本身。
export const EMOJI = Object.freeze([
    ['😀', '开心 笑'], ['😃', '大笑 开心'], ['😄', '笑 高兴'], ['😁', '露齿笑'], ['😆', '哈哈 大笑'], ['😅', '尴尬 汗'], ['😂', '笑哭 哈哈'], ['🤣', '笑翻'],
    ['🙂', '微笑'], ['😉', '眨眼'], ['😊', '害羞 微笑'], ['😇', '天使'], ['🥰', '喜欢 爱'], ['😍', '花痴 喜欢'], ['🤩', '星星眼 惊喜'], ['😘', '飞吻 亲亲'],
    ['😗', '亲'], ['😋', '好吃 馋'], ['😛', '吐舌'], ['😜', '调皮 眨眼'], ['🤪', '疯狂'], ['🤗', '抱抱 拥抱'], ['🤭', '捂嘴 偷笑'], ['🤫', '嘘 安静'],
    ['🤔', '思考 想想'], ['😐', '无语 面无表情'], ['😑', '无奈'], ['😶', '沉默'], ['😏', '得意 坏笑'], ['😒', '不屑'], ['🙄', '白眼'], ['😬', '龇牙 紧张'],
    ['😌', '安心 放松'], ['😔', '失落'], ['😪', '困'], ['🤤', '流口水'], ['😴', '睡觉 晚安'], ['😷', '口罩 生病'], ['🤒', '发烧'], ['🤧', '喷嚏'],
    ['🥵', '热'], ['🥶', '冷'], ['😵', '晕'], ['🤯', '爆炸 震惊'], ['🥳', '庆祝 派对'], ['😎', '酷 墨镜'], ['🤓', '书呆子'], ['😕', '困惑'],
    ['😟', '担心'], ['🙁', '不开心'], ['😮', '惊讶 哇'], ['😯', '吃惊'], ['😲', '震惊'], ['😳', '脸红 害羞'], ['🥺', '拜托 可怜'], ['😦', '惊愕'],
    ['😨', '害怕'], ['😰', '冷汗'], ['😥', '失望'], ['😢', '难过 哭'], ['😭', '大哭 痛哭'], ['😱', '尖叫 吓'], ['😖', '纠结'], ['😞', '失望'],
    ['😓', '汗'], ['😩', '累 崩溃'], ['😫', '疲惫'], ['🥱', '哈欠 困'], ['😤', '生气 哼'], ['😡', '愤怒'], ['😠', '生气'], ['🤬', '骂'],
    ['😈', '坏 恶魔'], ['💀', '骷髅 笑死'], ['💩', '便便'], ['🤡', '小丑'], ['👻', '幽灵'], ['👽', '外星人'], ['🤖', '机器人'], ['😺', '猫 开心'],
    ['❤️', '喜欢 爱心 红心'], ['🧡', '橙心'], ['💛', '黄心'], ['💚', '绿心'], ['💙', '蓝心'], ['💜', '紫心'], ['🖤', '黑心'], ['🤍', '白心'],
    ['💔', '心碎'], ['💕', '两颗心'], ['💖', '闪亮的心'], ['💗', '心跳'], ['💘', '爱心箭'], ['💝', '礼物 爱心'], ['💯', '一百分'], ['💢', '怒'],
    ['💥', '碰撞'], ['💫', '晕 星星'], ['💦', '汗水 水滴'], ['💤', '睡'], ['👍', '赞 点赞'], ['👎', '踩'], ['👌', '好的 OK'], ['✌️', '耶 胜利'],
    ['🤞', '祈祷 好运'], ['🤟', '爱你'], ['🤘', '摇滚'], ['👏', '鼓掌'], ['🙌', '举手 欢呼'], ['🤝', '握手'], ['🙏', '拜托 谢谢 祈祷'], ['💪', '加油 肌肉'],
    ['👋', '你好 挥手 再见'], ['🤙', '打电话'], ['👈', '左'], ['👉', '右'], ['👆', '上'], ['👇', '下'], ['🫶', '比心'], ['🫡', '敬礼'],
    ['👀', '看 眼睛'], ['🧠', '大脑'], ['🔥', '火 热门'], ['✨', '闪亮 星光'], ['⭐', '星星'], ['🌟', '亮星'], ['🌙', '月亮 晚安'], ['☀️', '太阳'],
    ['🌈', '彩虹'], ['☁️', '云'], ['🌧️', '下雨'], ['❄️', '雪'], ['🌸', '樱花 花'], ['🌹', '玫瑰'], ['🌻', '向日葵'], ['🍀', '四叶草 幸运'],
    ['🎉', '庆祝 恭喜'], ['🎊', '彩带'], ['🎂', '生日 蛋糕'], ['🎁', '礼物'], ['🎈', '气球'], ['🎵', '音乐'], ['🎮', '游戏'], ['📷', '拍照 相机'],
    ['🍎', '苹果'], ['🍓', '草莓'], ['🍉', '西瓜'], ['🍰', '蛋糕'], ['🍫', '巧克力'], ['🍦', '冰淇淋'], ['🍕', '披萨'], ['🍔', '汉堡'],
    ['🍜', '面 拉面'], ['🍚', '米饭'], ['🍺', '啤酒'], ['🍷', '红酒'], ['☕', '咖啡'], ['🍵', '茶'], ['🧋', '奶茶'], ['🥤', '饮料'],
    ['🐶', '狗'], ['🐱', '猫'], ['🐰', '兔子'], ['🐻', '熊'], ['🐼', '熊猫'], ['🐷', '猪'], ['🐸', '青蛙'], ['🐧', '企鹅'],
    ['🏠', '家'], ['🚗', '车'], ['✈️', '飞机'], ['📱', '手机'], ['💻', '电脑'], ['📚', '书'], ['💡', '灵感 灯泡'], ['🔔', '提醒 铃'],
    ['✅', '完成 对'], ['❌', '错 取消'], ['❓', '问号'], ['❗', '感叹号'], ['💬', '聊天 对话'], ['🎯', '目标'], ['🏆', '奖杯 冠军'], ['🌃', '夜晚 晚安'],
]);

export function searchEmoji(query, list = EMOJI) {
    const needle = String(query ?? '').trim().toLowerCase();
    if (!needle) return list;
    return list.filter(([emoji, name]) => emoji.includes(needle) || name.toLowerCase().includes(needle));
}

export function searchStickers(query, picks) {
    const needle = String(query ?? '').trim().toLowerCase();
    return needle ? picks.filter((pick) => pick.tag.toLowerCase().includes(needle)) : picks;
}

export function stickerMarkup(tag) {
    return `<sticker tag="${tag}"/>`;
}

// 拍一拍：注入宿主系统消息、待注入记录并触发一次生成；依赖可注入，便于单测。
export async function runPat({ ctx, now = Date.now(), state, busy = false, shake = () => {} } = {}) {
    const decision = planPat({ now, last: state?.last });
    shake();
    if (!decision.generate || !ctx || !Array.isArray(ctx.chat)) return { generated: false, posted: false };
    state.last = now;
    const name = ctx.name2 || '';
    const row = {
        name: '',
        is_user: false,
        is_system: true,
        send_date: new Date(now).toISOString(),
        mes: COPY.patLine(name),
        extra: { type: 'narrator', vc_kind: 'pat' },
    };
    ctx.chat.push(row);
    ctx.addOneMessage?.(row);
    await ctx.saveChat?.();
    if (busy || typeof ctx.generate !== 'function') return { generated: false, posted: true };
    ctx.chatMetadata = ctx.chatMetadata || {};
    addNudge(ctx.chatMetadata, { id: `pat:${now}`, text: patNudge({ user: ctx.name1 || '', name }) });
    await ctx.generate('normal');
    return { generated: true, posted: true };
}

// ---- 挂载 ----

let runtime = null;

export function patCharacter() {
    return runtime?.pat?.() ?? Promise.resolve({ generated: false, posted: false });
}

// UX-29 里程碑系统消息出现后放一次轻彩纸（落在最后一条里程碑行上）。
export function celebrate() {
    runtime?.celebrate?.();
}

const SMILE = '<svg class="vc-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01M15 9h.01"/></svg>';

export function mountChatReact({ getContext, document: doc = globalThis.document } = {}) {
    if (!doc?.body || doc.body.getAttribute('data-vc-chat-react') === 'on') return { enabled: Boolean(doc?.body) };
    doc.body.setAttribute('data-vc-chat-react', 'on');
    ensureCss(doc);

    const root = doc.defaultView || globalThis;
    const context = () => { try { return getContext?.() || null; } catch { return null; } };
    const desktop = () => doc.documentElement.getAttribute('data-vc-layout') === 'desktop';
    const chatEl = () => doc.querySelector('#chat');
    const box = () => doc.querySelector('#send_textarea');
    const generating = () => doc.body.getAttribute('data-generating') === 'true';
    const rows = () => [...(chatEl()?.children || [])].filter((node) => node.classList?.contains('mes'));
    const mesIdOf = (mes) => Number(mes.getAttribute('mesid'));
    const isUser = (mes) => mes.getAttribute('is_user') === 'true';
    const isSystem = (mes) => mes.getAttribute('is_system') === 'true';
    const messageOf = (mes) => context()?.chat?.[mesIdOf(mes)];
    const rm = () => { try { return reducedMotion(); } catch { return false; } };

    // ---- 1. 纯 emoji 放大、系统行标记、回应徽标 ----
    function setAttr(el, name, value) {
        if (value == null) { if (el.hasAttribute(name)) el.removeAttribute(name); return; }
        if (el.getAttribute(name) !== String(value)) el.setAttribute(name, String(value));
    }

    function syncBadge(mes) {
        const reactions = messageOf(mes)?.extra?.vc_reactions;
        const list = Array.isArray(reactions) ? reactions.slice(0, MAX_REACTIONS) : [];
        const block = mes.querySelector(':scope > .mes_block');
        let badge = block?.querySelector(':scope > .vc-react-badge');
        if (!list.length || !block) {
            badge?.remove();
            setAttr(mes, 'data-vc-react', null);
            return;
        }
        if (!badge) {
            badge = doc.createElement('span');
            badge.className = 'vc-react-badge';
            block.append(badge);
        }
        const text = list.join('');
        if (badge.textContent !== text) badge.textContent = text;
        setAttr(mes, 'data-vc-react', list.length);
    }

    function syncRow(mes) {
        const message = messageOf(mes);
        const kind = message?.extra?.vc_kind;
        setAttr(mes, 'data-vc-kind', kind === 'pat' || kind === 'milestone' ? kind : null);
        // 里程碑卡的副文放在 .mes_block 的属性上，由伪元素显示，不往消息树插节点。
        const block = mes.querySelector(':scope > .mes_block');
        if (block) setAttr(block, 'data-vc-sub', kind === 'milestone' ? message.extra.vc_sub || null : null);
        if (isSystem(mes)) { setAttr(mes, 'data-vc-emoji', null); return; }
        const editing = Boolean(mes.querySelector('.edit_textarea'));
        const segs = [...mes.querySelectorAll('.vc-seg:not(.vc-seg-sticker)')];
        if (segs.length) {
            setAttr(mes, 'data-vc-emoji', null);
            for (const seg of segs) setAttr(seg, 'data-vc-emoji', editing ? null : emojiCount(seg.textContent) || null);
        } else {
            const text = mes.querySelector('.mes_text');
            const plain = text && !text.querySelector('img, audio, video, .vc-voice, pre, table');
            setAttr(mes, 'data-vc-emoji', plain && !editing && !mes.classList.contains('vc-rich') ? emojiCount(text.textContent) || null : null);
        }
        syncBadge(mes);
    }

    let syncQueued = false;
    function sync() {
        syncQueued = false;
        dressComposer();
        if (!desktop()) return;
        for (const mes of rows()) syncRow(mes);
    }
    function queueSync() {
        if (syncQueued) return;
        syncQueued = true;
        (root.requestAnimationFrame || setTimeout)(sync);
    }

    let observed = null;
    let chatObserver = null;
    function observeChat() {
        const chat = chatEl();
        if (!chat || observed === chat || typeof MutationObserver !== 'function') return;
        chatObserver?.disconnect();
        observed = chat;
        chatObserver = new MutationObserver(queueSync);
        chatObserver.observe(chat, { childList: true, subtree: true, characterData: true });
        chat.addEventListener('scroll', hideBar, { passive: true });
    }

    // ---- 2. 表情 / 贴纸面板 ----
    let emojiButton = null;
    function dressComposer() {
        const form = doc.querySelector('#send_form');
        if (!form) return;
        if (!emojiButton || !emojiButton.isConnected) {
            emojiButton = doc.createElement('button');
            emojiButton.type = 'button';
            emojiButton.id = 'vc-emoji-btn';
            emojiButton.setAttribute('aria-label', COPY.emojiTab);
            emojiButton.setAttribute('aria-haspopup', 'dialog');
            emojiButton.innerHTML = SMILE;
            emojiButton.addEventListener('click', () => (panel ? closePanel(true) : openPanel({ mode: 'compose', anchor: emojiButton })));
            const mic = form.querySelector('#vc-voice-input');
            if (mic) form.insertBefore(emojiButton, mic);
            else form.append(emojiButton);
        }
        emojiButton.hidden = !desktop();
    }

    let panel = null;
    let panelState = null;
    let recent = readRecent();

    function cell(label, className = '') {
        const button = doc.createElement('button');
        button.type = 'button';
        button.className = `vc-emoji-cell ${className}`.trim();
        button.setAttribute('aria-label', label);
        return button;
    }

    function renderBody() {
        const { body, query, tab, mode } = panelState;
        const picks = listStickerPicks();
        const frag = [];
        const emojiCells = (items) => items.map(([emoji, name]) => {
            const button = cell(name.split(' ')[0]);
            button.textContent = emoji;
            button.dataset.k = 'e';
            button.dataset.v = emoji;
            return button;
        });
        const stickerCells = (items) => items.map((pick) => {
            const button = cell(pick.tag, 'is-sticker');
            if (pick.kind === 'image') {
                const image = doc.createElement('img');
                image.src = pick.src;
                image.alt = '';
                image.draggable = false;
                button.append(image);
            } else button.textContent = pick.text;
            button.dataset.k = 's';
            button.dataset.v = pick.tag;
            return button;
        });
        const group = (title, nodes) => {
            const section = doc.createElement('section');
            if (title) {
                const heading = doc.createElement('h3');
                heading.textContent = title;
                section.append(heading);
            }
            const grid = doc.createElement('div');
            grid.className = 'vc-emoji-grid';
            grid.append(...nodes);
            section.append(grid);
            frag.push(section);
        };
        if (tab === 'emoji' || mode === 'react') {
            const found = searchEmoji(query);
            if (!query.trim() && recent.some((item) => item.k === 'e')) {
                const recents = recent.filter((item) => item.k === 'e').map((item) => [item.v, EMOJI.find(([emoji]) => emoji === item.v)?.[1] || item.v]);
                group(COPY.recent, emojiCells(recents));
            }
            if (found.length) group('', emojiCells(found));
        } else {
            const found = searchStickers(query, picks);
            if (!query.trim()) {
                const recents = recent.filter((item) => item.k === 's').map((item) => picks.find((pick) => pick.tag === item.v)).filter(Boolean);
                if (recents.length) group(COPY.recent, stickerCells(recents));
            }
            if (found.length) group('', stickerCells(found));
        }
        if (!frag.length) {
            const none = doc.createElement('p');
            none.className = 'vc-emoji-none';
            none.textContent = COPY.empty;
            frag.push(none);
        }
        body.replaceChildren(...frag);
    }

    function zoomFor(button) {
        const { zoom, panelEl } = panelState;
        if (!button) { zoom.hidden = true; return; }
        zoom.replaceChildren(button.cloneNode(true));
        zoom.firstChild.removeAttribute('aria-label');
        zoom.hidden = false;
        const host = panelEl.getBoundingClientRect();
        const rect = button.getBoundingClientRect();
        const size = zoom.offsetWidth || 72;
        zoom.style.left = `${Math.max(8, Math.min(rect.left - host.left + rect.width / 2 - size / 2, host.width - size - 8))}px`;
        zoom.style.top = `${rect.top - host.top - size - 6}px`;
    }

    function pick(button) {
        const kind = button.dataset.k;
        const value = button.dataset.v;
        if (!kind || !value) return;
        const { mode, mesid } = panelState;
        recent = pushRecent(recent, { k: kind, v: value });
        writeRecent(recent);
        if (mode === 'react') {
            closePanel(false);
            void react(mesid, value);
            return;
        }
        if (kind === 'e') {
            insertAtCursor(value);
            renderBody();
        } else {
            closePanel(true);
            sendSticker(value);
        }
    }

    function insertAtCursor(text) {
        const el = box();
        if (!el) return;
        const start = el.selectionStart ?? el.value.length;
        const end = el.selectionEnd ?? start;
        el.setRangeText(text, start, end, 'end');
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.focus();
    }

    function sendSticker(tag) {
        const el = box();
        const send = doc.querySelector('#send_but');
        if (!el || !send || generating()) return;
        const draft = el.value;
        const proto = Object.getOwnPropertyDescriptor(globalThis.HTMLTextAreaElement.prototype, 'value');
        const set = (value) => { proto.set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); };
        set(stickerMarkup(tag));
        send.click();
        if (draft) setTimeout(() => { if (!el.value.trim()) set(draft); }, 600); // 贴纸单独发出，原草稿放回
    }

    function openPanel({ mode, anchor, mesid } = {}) {
        closePanel(false);
        if (!desktop()) return;
        const opener = doc.activeElement;
        const el = doc.createElement('div');
        el.id = 'vc-emoji-panel';
        el.className = 'vc-glass';
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-label', COPY.emojiTab);
        const search = doc.createElement('input');
        search.type = 'search';
        search.className = 'vc-emoji-search';
        search.placeholder = COPY.searchPlaceholder;
        search.setAttribute('aria-label', COPY.searchPlaceholder);
        const body = doc.createElement('div');
        body.className = 'vc-emoji-body';
        const zoom = doc.createElement('div');
        zoom.className = 'vc-emoji-zoom';
        zoom.hidden = true;
        zoom.setAttribute('aria-hidden', 'true');
        panelState = { panelEl: el, body, zoom, query: '', tab: 'emoji', mode, mesid, opener, anchor };
        el.append(search);
        if (mode !== 'react') {
            const segment = doc.createElement('div');
            segment.className = 'vc-segment vc-emoji-segment';
            segment.innerHTML = `<i class="vc-segment-thumb"></i><button type="button" aria-pressed="true">${COPY.emojiTab}</button><button type="button" aria-pressed="false">${COPY.stickerTab}</button>`;
            el.append(segment);
            bindSegmentLazy(segment, (index) => { panelState.tab = index === 0 ? 'emoji' : 'sticker'; zoomFor(null); renderBody(); });
        }
        el.append(body, zoom);
        doc.body.append(el);
        panel = el;
        search.addEventListener('input', () => { panelState.query = search.value; zoomFor(null); renderBody(); });
        body.addEventListener('click', (event) => { const button = event.target.closest('.vc-emoji-cell'); if (button) pick(button); });
        body.addEventListener('pointerover', (event) => zoomFor(event.target.closest('.vc-emoji-cell')));
        body.addEventListener('pointerleave', () => zoomFor(null));
        body.addEventListener('focusin', (event) => zoomFor(event.target.closest('.vc-emoji-cell')));
        body.addEventListener('scroll', () => zoomFor(null), { passive: true });
        renderBody();
        placePanel(el, anchor);
        emojiButton?.setAttribute('aria-expanded', 'true');
        search.focus();
    }

    function placePanel(el, anchor) {
        const rect = anchor?.getBoundingClientRect?.() || { left: 16, right: 16, top: root.innerHeight, bottom: root.innerHeight };
        const width = el.offsetWidth;
        const height = el.offsetHeight;
        const left = Math.max(8, Math.min(rect.right - width, root.innerWidth - width - 8));
        // 用 bottom 贴住按钮上沿：切换「表情 / 贴纸」或搜索后面板高度会变，按 top 定位会在下方留出空隙。
        const bottom = Math.max(8, root.innerHeight - rect.top + 8);
        el.style.left = `${left}px`;
        el.style.top = 'auto';
        el.style.bottom = `${Math.min(bottom, root.innerHeight - Math.min(height, root.innerHeight - 16) - 8)}px`;
    }

    function closePanel(restoreFocus) {
        if (!panel) return;
        const { opener } = panelState;
        panel.remove();
        panel = null;
        panelState = null;
        emojiButton?.setAttribute('aria-expanded', 'false');
        if (restoreFocus) (emojiButton?.isConnected && opener === emojiButton ? emojiButton : opener || box())?.focus?.();
    }

    doc.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' || !panel) return;
        event.preventDefault();
        event.stopPropagation();
        closePanel(true);
    }, true);
    doc.addEventListener('pointerdown', (event) => {
        if (!panel || panel.contains(event.target) || emojiButton?.contains(event.target) || event.target.closest?.('#vc-react-bar')) return;
        closePanel(false);
    }, true);

    // ---- 3. 消息回应 ----
    let bar = null;
    let barMes = null;
    let barLocked = null; // 右键菜单打开时锁定 { close }
    let hideTimer = 0;

    function ensureBar() {
        if (bar?.isConnected) return bar;
        bar = doc.createElement('div');
        bar.id = 'vc-react-bar';
        bar.className = 'vc-glass';
        bar.setAttribute('role', 'toolbar');
        bar.hidden = true;
        for (const { emoji, label } of REACTIONS) {
            const button = doc.createElement('button');
            button.type = 'button';
            button.dataset.emoji = emoji;
            button.setAttribute('aria-label', label);
            button.textContent = emoji;
            bar.append(button);
        }
        const more = doc.createElement('button');
        more.type = 'button';
        more.className = 'vc-react-more';
        more.dataset.more = '';
        more.setAttribute('aria-label', COPY.more);
        more.innerHTML = '<svg class="vc-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
        bar.append(more);
        bar.addEventListener('click', (event) => {
            const button = event.target.closest('button');
            if (!button || !barMes) return;
            const mes = barMes;
            const lock = barLocked;
            if (button.dataset.more !== undefined) {
                const anchor = button;
                lock?.close?.();
                hideBar(true);
                openPanel({ mode: 'react', anchor, mesid: mesIdOf(mes) });
                return;
            }
            void react(mesIdOf(mes), button.dataset.emoji);
            lock?.close?.();
            hideBar(true);
        });
        bar.addEventListener('pointerenter', () => clearTimeout(hideTimer));
        bar.addEventListener('pointerleave', () => scheduleHide());
        doc.body.append(bar);
        return bar;
    }

    function bubbleRect(mes) {
        const block = mes.querySelector(':scope > .mes_block') || mes;
        const first = isUser(mes) ? block : mes.querySelector('.vc-seg, .mes_text') || block;
        const a = first.getBoundingClientRect();
        const b = block.getBoundingClientRect();
        return { left: isUser(mes) ? b.left : a.left, right: isUser(mes) ? b.right : a.right, top: b.top, bottom: b.bottom };
    }

    function showBar(mes) {
        if (!desktop() || isSystem(mes) || panel) return;
        clearTimeout(hideTimer);
        const el = ensureBar();
        const list = messageOf(mes)?.extra?.vc_reactions || [];
        const same = barMes === mes && !el.hidden;
        barMes = mes;
        for (const button of el.querySelectorAll('button[data-emoji]')) button.setAttribute('aria-pressed', list.includes(button.dataset.emoji) ? 'true' : 'false');
        el.hidden = false;
        const rect = bubbleRect(mes);
        const width = el.offsetWidth;
        const height = el.offsetHeight;
        const chatRect = chatEl()?.getBoundingClientRect();
        const left = isUser(mes) ? rect.right - width : rect.left;
        const top = Math.max((chatRect?.top ?? 8) + 4, rect.top - height - 4);
        el.style.left = `${Math.max(8, Math.min(left, root.innerWidth - width - 8))}px`;
        el.style.top = `${Math.max(8, top)}px`;
        if (!same) { el.classList.remove('is-enter'); void el.offsetWidth; el.classList.add('is-enter'); }
    }

    function hideBar(force = false) {
        if (barLocked && !force) return;
        clearTimeout(hideTimer);
        if (bar) bar.hidden = true;
        barMes = null;
        barLocked = null;
    }
    function scheduleHide() {
        if (barLocked) return;
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => hideBar(), 220);
    }

    doc.addEventListener('mouseover', (event) => {
        if (!desktop() || barLocked) return;
        const target = event.target;
        if (target.closest?.('#vc-react-bar')) { clearTimeout(hideTimer); return; }
        const mes = target.closest?.('#chat > .mes');
        if (mes && !isSystem(mes) && !target.closest('.edit_textarea')) showBar(mes);
        else scheduleHide();
    });
    doc.addEventListener('vc-menu-opened', (event) => {
        const { mes, close } = event.detail || {};
        if (!mes || !desktop() || isSystem(mes)) return;
        barLocked = { close };
        showBar(mes);
    });
    doc.addEventListener('vc-menu-closed', () => hideBar(true));

    async function react(mesid, emoji) {
        const ctx = context();
        const message = ctx?.chat?.[mesid];
        if (!message || !emoji) return;
        message.extra = message.extra || {};
        const before = Array.isArray(message.extra.vc_reactions) ? message.extra.vc_reactions : [];
        const next = toggleReaction(before, emoji);
        if (next.length) message.extra.vc_reactions = next;
        else delete message.extra.vc_reactions;
        ctx.chatMetadata = ctx.chatMetadata || {};
        const id = `react:${mesid}`;
        if (next.includes(emoji)) addNudge(ctx.chatMetadata, { id, text: reactionNudge({ user: ctx.name1 || '', text: message.mes, emoji }) });
        else dropNudge(ctx.chatMetadata, id);
        const mes = rows().find((node) => mesIdOf(node) === mesid);
        if (mes) syncBadge(mes);
        await ctx.saveChat?.();
        await ctx.saveMetadata?.();
    }

    // 下一次生成前注入一次，元数据落盘完成后才继续宿主生成。
    function clearNudgePrompt() {
        context()?.setExtensionPrompt?.(NUDGE_PROMPT, '', 1, 0, false, 0);
    }

    // ---- 4. 拍一拍 ----
    const patState = { last: undefined };
    function shake() {
        if (rm()) return;
        const targets = [...doc.querySelectorAll('.vc-who [data-who-avatar]')];
        const tail = rows().filter((mes) => !isUser(mes) && !isSystem(mes) && mes.hasAttribute('data-vc-tail')).at(-1);
        const avatar = tail?.querySelector('.avatar');
        if (avatar) targets.push(avatar);
        for (const target of targets) {
            target.classList.remove('vc-pat-shake');
            void target.offsetWidth;
            target.classList.add('vc-pat-shake');
            target.addEventListener('animationend', () => target.classList.remove('vc-pat-shake'), { once: true });
        }
    }
    function pat() {
        return runPat({ ctx: context(), state: patState, busy: generating(), shake });
    }
    doc.addEventListener('dblclick', (event) => {
        if (!desktop()) return;
        const target = event.target;
        const title = target.closest?.('.vc-who [data-who-avatar]');
        const mes = target.closest?.('#chat > .mes');
        const inBubble = mes && target.closest('.avatar') && !isUser(mes) && !isSystem(mes);
        if (!title && !inBubble) return;
        event.preventDefault();
        void pat();
    });

    // ---- 5. 关键词轻特效 ----
    let fx = null;
    function playEffect(kind, rect) {
        if (rm() || !effectsEnabled() || !kind) return;
        if (!fx?.isConnected) {
            fx = doc.createElement('div');
            fx.id = 'vc-react-fx';
            fx.setAttribute('aria-hidden', 'true');
            doc.body.append(fx);
        }
        for (let i = 0; i < 14; i += 1) {
            const piece = doc.createElement('i');
            piece.className = `vc-fx-piece is-${kind}`;
            const dx = (Math.random() - 0.5) * 120;
            const dy = kind === 'stars' ? -(30 + Math.random() * 60) : -(20 + Math.random() * 50);
            const fall = kind === 'stars' ? -20 : 70 + Math.random() * 40;
            piece.style.cssText = `left:${rect.left + rect.width * (0.2 + Math.random() * 0.6)}px;top:${rect.top + rect.height * 0.3}px;--dx:${dx}px;--dy:${dy}px;--fall:${fall}px;--rot:${Math.round(Math.random() * 360)}deg;--i:${i}`;
            if (kind === 'stars') piece.textContent = '✦';
            fx.append(piece);
            piece.addEventListener('animationend', () => piece.remove(), { once: true });
        }
        setTimeout(() => fx?.replaceChildren(), EFFECT_MS + 400); // 动画事件缺失时的兜底清理
    }
    function effectFor(id) {
        const ctx = context();
        const kind = keywordEffect(ctx?.chat?.[id]?.mes);
        if (!kind) return;
        const mes = rows().find((node) => mesIdOf(node) === Number(id));
        if (!mes) return;
        const rect = bubbleRect(mes);
        playEffect(kind, { left: rect.left, top: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top });
    }

    // ---- 宿主事件 ----
    const ctx0 = context();
    const events = ctx0?.eventSource;
    const types = ctx0?.eventTypes || {};
    const on = (name, fn) => { if (name && events?.on) events.on(name, fn); };
    let live = false;
    let sentLive = false;
    let liveSince = 0;
    on(types.CHAT_CHANGED, () => { live = false; sentLive = false; hideBar(true); closePanel(false); observeChat(); queueSync(); });
    on(types.MESSAGE_SENT, () => { sentLive = true; });
    on(types.GENERATION_STARTED, (type, _detail, dryRun) => {
        if (type === 'quiet' || type === 'impersonate' || dryRun) return;
        live = true;
        liveSince = Date.now();
        return injectNudges(context());
    });
    on(types.GENERATION_ENDED, clearNudgePrompt);
    on(types.GENERATION_STOPPED, clearNudgePrompt);
    on(types.CHARACTER_MESSAGE_RENDERED, (id, type) => {
        queueSync();
        if (!live || type === 'first_message') return;
        live = false;
        setTimeout(() => effectFor(id), 60); // 等气泡渲染完成再取位置
    });
    on(types.USER_MESSAGE_RENDERED, (id) => {
        queueSync();
        if (!sentLive) return;
        sentLive = false;
        setTimeout(() => effectFor(id), 60);
    });
    on(types.MESSAGE_EDITED, queueSync);
    on(types.MESSAGE_UPDATED, queueSync);
    on(types.MESSAGE_SWIPED, queueSync);

    function celebrateMilestone() {
        const mes = rows().filter((node) => node.getAttribute('data-vc-kind') === 'milestone').at(-1);
        if (!mes) return;
        const rect = (mes.querySelector(':scope > .mes_block') || mes).getBoundingClientRect();
        playEffect('confetti', { left: rect.left, top: rect.top, width: rect.width, height: rect.height });
    }

    root.addEventListener('resize', () => { hideBar(true); closePanel(false); queueSync(); });
    runtime = { pat, celebrate: celebrateMilestone };
    mountSuggest({ getContext });
    observeChat();
    // #chat 与输入区可能晚于挂载出现（切换会话页时才建）。
    if (typeof MutationObserver === 'function') {
        new MutationObserver(() => { if (!observed?.isConnected || chatEl() !== observed) { observeChat(); queueSync(); } else if (!emojiButton?.isConnected) queueSync(); })
            .observe(doc.body, { childList: true, subtree: true });
    }
    queueSync();
    return { enabled: true, pat, react };
}

function bindSegmentLazy(segment, onChange) {
    import('./ui/controls.js').then(({ bindSegment }) => bindSegment(segment, { onChange }));
}

function ensureCss(doc) {
    // 样式由 index.js / 样板的 desktop/chat-react.css 加载；这里不重复加载。
    void doc;
}
