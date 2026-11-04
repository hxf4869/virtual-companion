// 聊天核心纯逻辑（组合、气泡分段、动效判定、滚动与未读计算、表情回应、会话内搜索匹配；无 DOM/window 依赖）。
import { TYPING_COPY, splitReply, typingDelay } from './reply-pipeline.js';
import { safeImageUrl } from './instance-queries.js';

export { TYPING_COPY, splitReply, typingDelay };

const pad2 = (n) => String(n).padStart(2, '0');
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const EMPTY_PREVIEW = new Set(['[The chat is empty]', '[The message is empty]']);

export function avatarUrl(file) {
    const value = String(file || '').trim();
    if (!value) return '';
    const safe = safeImageUrl(value);
    if (safe) return safe;
    return `/thumbnail?type=avatar&file=${encodeURIComponent(value)}`;
}

export function chatSnapshotsFromRecent(list) {
    const snaps = [];
    for (const item of Array.isArray(list) ? list : []) {
        const binding = item?.chat_metadata?.vc_binding;
        if (binding?.relationshipId == null || binding.relationshipId === '') continue;
        const snap = { relationshipId: String(binding.relationshipId) };
        const chatIdentity = typeof item.chat_metadata?.vc_f2?.id === 'string' ? item.chat_metadata.vc_f2.id.trim() : '';
        if (chatIdentity) snap.chatIdentity = chatIdentity;
        const fileId = typeof item.file_id === 'string' ? item.file_id.trim() : '';
        const fileName = typeof item.file_name === 'string' ? item.file_name.trim().replace(/\.jsonl$/i, '') : '';
        const file = fileId || fileName;
        if (file) snap.file = file;
        const characterRef = typeof binding.characterRef === 'string' ? binding.characterRef.trim() : '';
        if (characterRef) snap.characterRef = characterRef;
        const avatar = typeof item.avatar === 'string' ? item.avatar.trim() : '';
        if (avatar) snap.avatar = avatar;
        const preview = typeof item.mes === 'string' ? item.mes.trim() : '';
        if (preview && !EMPTY_PREVIEW.has(preview)) snap.preview = preview.split('\n')[0].trim();
        if (typeof item.last_mes === 'number' && Number.isFinite(item.last_mes)) snap.time = new Date(item.last_mes).toISOString();
        else if (item.last_mes) snap.time = item.last_mes;
        snaps.push(snap);
    }
    return snaps;
}

// ---- chat-compose 纯函数 ----
export const QUOTE_MAX = 30;
export const SLOW_MS = 60000;
export const COMPOSE_COPY = Object.freeze({
    quote: '引用',
    copy: '复制',
    read: '朗读',
    edit: '编辑',
    regenerate: '重新生成',
    continue: '继续',
    remove: '删除',
    copied: '已复制',
    failed: '没有发送成功',
    retry: '重试',
    slow: '回复较慢，可以继续等或停止',
    deleteTitle: '删除这条消息？',
    deleteBody: '删除后无法恢复。',
    deleteFailed: '这条消息没有删掉',
    favorite: '收藏',
    favorited: '已收藏',
    remind: '稍后提醒',
    reminded: '好，到时候提醒你',
    remindIn20: '20 分钟后',
    remindTonight: '今晚 21:00',
    remindTomorrow: '明天早上',
    remindPick: '选择时间…',
    actionFailed: '没有完成，请重试。',
});
export const COPY = COMPOSE_COPY;
export const REMIND_MAX = 30;
export const DRAFT_PREFIX = 'vc-draft:';

export const REMIND_PRESETS = Object.freeze([
    { id: 'in20', label: COMPOSE_COPY.remindIn20 },
    { id: 'tonight', label: COMPOSE_COPY.remindTonight },
    { id: 'tomorrow', label: COMPOSE_COPY.remindTomorrow },
]);

export function remindSeed(text, max = REMIND_MAX) {
    return quoteSummary(text, max);
}

export function computeRemindDueAt(preset, now = new Date()) {
    const id = typeof preset === 'string' ? preset : preset?.id;
    const found = reminderChoices(now).find((c) => c.id === id);
    return found ? rfc3339(found.at) : null;
}

export function firstGlyph(name) {
    const ch = Array.from(String(name || '').trim())[0];
    return ch || '伴';
}

export function messageTimestampMs(msg) {
    return parseSendDate(msg?.send_date);
}

export function formatMessageTimeLabel(msg) {
    const ms = parseSendDate(msg?.send_date);
    return ms !== null ? clockText(ms) : '';
}

export function formatMessageDuration(msg) {
    const s = Number(msg?.gen_started);
    const f = Number(msg?.gen_finished);
    if (!Number.isFinite(s) || !Number.isFinite(f) || f <= s) return '';
    return `${((f - s) / 1000).toFixed(1)}s`;
}

export function dateLabel(sendDate, now = Date.now()) {
    const ms = parseSendDate(sendDate);
    if (ms === null) return '';
    return gapLabel(ms, now).split(' ')[0] || '';
}

export function quoteSummary(text, max = QUOTE_MAX) {
    const body = String(text ?? '')
        .split(/\r?\n/)
        .filter((line) => !/^\s*>/.test(line))
        .join(' ')
        .replace(/<[^>]*>/g, '')
        .replace(/[*_`~]+/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    const chars = [...body];
    return chars.length > max ? `${chars.slice(0, max).join('')}…` : body;
}

export function quoteLine(name, text) {
    const who = String(name ?? '').replace(/\s+/g, ' ').trim();
    const summary = quoteSummary(text);
    return `> ${who ? `${who}：` : ''}${summary}`;
}

export function withQuote(quote, text) {
    const body = String(text ?? '');
    if (!quote || !body.trim()) return body;
    return `${quoteLine(quote.name, quote.text)}\n\n${body}`;
}

export function draftKey(chatId) {
    const id = String(chatId ?? '').trim();
    return id ? `${DRAFT_PREFIX}${id}` : '';
}

export function readDraft(chatId, storage = globalThis.localStorage) {
    const key = draftKey(chatId);
    if (!key) return '';
    try {
        return storage?.getItem(key) || '';
    } catch {
        return '';
    }
}

export function writeDraft(chatId, text, storage = globalThis.localStorage) {
    const key = draftKey(chatId);
    if (!key) return;
    try {
        if (String(text ?? '').trim()) storage?.setItem(key, String(text));
        else storage?.removeItem(key);
    } catch {
        /* 隐私模式下草稿只是不保存 */
    }
}

export function sendsOnEnter(powerUser) {
    const mode = Number(powerUser?.send_on_enter ?? 0);
    return mode !== -1;
}

export function takesError({ generating, title = '', message = '' } = {}) {
    if (!generating) return false;
    return !/saved|保存/i.test(`${title} ${message}`);
}

export function isCopiedToast(message) {
    return /^(copied!?|已复制)$/i.test(String(message ?? '').trim());
}

export function messageMenuPlan({
    system = false,
    character = false,
    last = false,
    voice = false,
    busy = false,
    bound = false,
} = {}) {
    const plan = [];
    if (!system) plan.push('quote');
    plan.push('copy');
    if (voice) plan.push('read');
    if (bound && !system) plan.push('favorite', 'remind');
    plan.push('-', 'edit');
    if (character && last && !busy) plan.push('regenerate');
    plan.push('-', 'remove');
    return plan;
}

export const COMPOSER_MAX_LINES = 6;

export function rfc3339(date) {
    const offset = -date.getTimezoneOffset();
    const sign = offset >= 0 ? '+' : '-';
    const abs = Math.abs(offset);
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

export function reminderChoices(now = new Date()) {
    const at = (dayOffset, hour) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, hour, 0, 0, 0);
    const tonight = at(0, 21);
    return [
        { id: 'in20', label: COMPOSE_COPY.remindIn20, at: new Date(now.getTime() + 20 * 60000) },
        { id: 'tonight', label: COMPOSE_COPY.remindTonight, at: tonight.getTime() > now.getTime() ? tonight : at(1, 21) },
        { id: 'tomorrow', label: COMPOSE_COPY.remindTomorrow, at: at(1, 8) },
    ];
}

export function messageInstant(value) {
    if (value === undefined || value === null || value === '') return undefined;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function composerHeight({ contentHeight = 0, lineHeight = 0, padding = 0, min = 0, lines = COMPOSER_MAX_LINES } = {}) {
    const max = Math.round(lineHeight * lines + padding);
    return Math.max(min, Math.min(max, Math.ceil(contentHeight)));
}

// ---- chat-view 纯函数 ----
export const REPLY_STYLE_KEY = 'vc-reply-style';
export const PRESS_MS = 420;
export const PRESS_SLOP = 8;
export const NEAR_BOTTOM_PX = 80;

export function readReplyStyle(storage, defaultDesktop = true) {
    let stored = null;
    try {
        const store = storage ?? globalThis.localStorage;
        stored = store?.getItem?.(REPLY_STYLE_KEY);
    } catch {
        /* 偏好读不到时按布局给默认 */
    }
    if (stored === 'bubble' || stored === 'spread') return stored;
    return defaultDesktop ? 'bubble' : 'spread';
}

export function isNearBottom(metrics, threshold = NEAR_BOTTOM_PX) {
    const height = Number(metrics?.scrollHeight);
    const top = Number(metrics?.scrollTop);
    const client = Number(metrics?.clientHeight);
    if (![height, top, client].every(Number.isFinite)) return true;
    return height - top - client <= threshold;
}

export function keepsTail(metrics, { pin = false, threshold = NEAR_BOTTOM_PX } = {}) {
    const height = Number(metrics?.scrollHeight);
    const top = Number(metrics?.scrollTop);
    const client = Number(metrics?.clientHeight);
    if (![height, top, client].every(Number.isFinite)) return true;
    const gap = height - top - client;
    if (gap <= 1) return true;
    if (!pin && top <= 1) return false;
    return gap <= threshold;
}

export function shouldShowNewReply({ nearBottom, grew = false, pending = false } = {}) {
    if (nearBottom) return false;
    return Boolean(grew || pending);
}

export function pressExceeded(dx, dy, slop = PRESS_SLOP) {
    return Math.hypot(Number(dx) || 0, Number(dy) || 0) > slop;
}

export function isDirectChat(ctx) {
    return !String(ctx?.groupId ?? '').trim();
}

export function segmentMark(segment) {
    if (segment && typeof segment === 'object' && segment.type === 'sticker') {
        return `sticker:${segment.tag || ''}:${segment.kind || ''}:${segment.text || segment.src || ''}`;
    }
    return String(segment ?? '');
}

// ---- chat-motion 纯函数 ----
export const TYPING_DELAY_MS = 450;
export const ARRIVE_SETTLE_MS = 800;

export function shouldArrive({ primed, sinceChatMs, streaming, system, isLast }) {
    return Boolean(primed && sinceChatMs >= ARRIVE_SETTLE_MS && !streaming && !system && isLast);
}

export const typingVisible = (elapsedMs) => Number(elapsedMs) >= TYPING_DELAY_MS;

export function pagerPlan({ last, at, n }) {
    if (!last || !(Number(n) > 1)) return null;
    const atEnd = Number(at) >= Number(n);
    return { prev: '上一个回复', next: atEnd ? '重新生成' : '下一个回复', atEnd };
}

export function heightMotion(from, to, reduced) {
    if (reduced) return { height: false };
    return { height: Math.abs(Number(to) - Number(from)) >= 2 };
}

export function keyAction(event, { inputEmpty = false, overlayOpen = false } = {}) {
    if (!event || event.isComposing) return null;
    const mod = event.metaKey || event.ctrlKey;
    if (mod && !event.altKey && !event.shiftKey && String(event.key).toLowerCase() === 'k') return 'quick-switch';
    if (event.key === 'ArrowUp' && !mod && !event.altKey && !event.shiftKey && inputEmpty && !overlayOpen) return 'edit-last';
    return null;
}

export function actionLine(text) {
    const t = String(text ?? '').trim();
    const star = /^\*([^*]+)\*$/.exec(t);
    if (star) return { action: true, text: star[1].trim() };
    const paren = /^[（(]([^（）()]+)[）)]$/.exec(t);
    if (paren) return { action: true, text: t };
    return { action: false, text: String(text ?? '') };
}

// ---- chat-scroll 纯函数 ----
export const ATTACH_PX = 24;
export const LATEST_PX = 300;
export const LAND_OFFSET = 24;
export const LAND_MS = 1600;
export const READ_DWELL_MS = 1000;
export const RESTORE_FRAMES = 30;
export const CHIP_HIDE_MS = 3000;
export const FLASH_MS = 2000;
export const UNREAD_OFFSET = 48;

export function nextFollow(state, event) {
    if (event?.type === 'send') return 'follow';
    if (event?.type === 'user-scroll') {
        if (event.up) return 'detached';
        return Number(event.gap) <= ATTACH_PX ? 'follow' : state;
    }
    return state;
}

export const latestVisible = (gap) => Number(gap) > LATEST_PX;

export function badgeText(count) {
    const n = Math.floor(Number(count) || 0);
    if (n <= 0) return '';
    return n > 99 ? '99+' : String(n);
}

export function latestLabel(count) {
    const n = Math.floor(Number(count) || 0);
    return n > 0 ? `回到最新，${n} 条新消息` : '回到最新';
}

export function landingTop({ chatTop, mesTop, scrollTop, offset = LAND_OFFSET }) {
    return Math.max(0, scrollTop + (mesTop - chatTop) - offset);
}

export function shouldLand({ following, mesHeight, viewHeight }) {
    return Boolean(following) && Number(mesHeight) > Number(viewHeight) - LAND_OFFSET;
}

export function centerTop({ chatTop, mesTop, mesHeight, viewHeight, scrollTop, max }) {
    const raw = scrollTop + (mesTop - chatTop) - (viewHeight - mesHeight) / 2;
    return Math.min(Math.max(0, raw), Math.max(0, max));
}

export function scrollDuration(distance) {
    return Math.round(Math.min(600, Math.max(250, 250 + Math.abs(Number(distance) || 0) * 0.25)));
}

export function nextRead(lastRead, id) {
    if (!Number.isInteger(id)) return lastRead;
    return !Number.isInteger(lastRead) || id > lastRead ? id : lastRead;
}

export function unreadInfo(lastRead, rows) {
    if (!Number.isInteger(lastRead)) return { first: null, count: 0 };
    let first = null;
    let count = 0;
    for (const row of rows) {
        if (row.user || row.system || !(row.id > lastRead)) continue;
        if (first === null) first = row.id;
        count += 1;
    }
    return { first, count };
}

export const anchorDelta = (beforeOffset, afterOffset) => afterOffset - beforeOffset;
export const readKey = (chatId) => `vc-read:${chatId}`;
export const posKey = (chatId) => `vc-pos:${chatId}`;

function defaultStorage() {
    try { return globalThis.localStorage || null; } catch { return null; }
}

export function readStoredNumber(key, storage = defaultStorage()) {
    try {
        const raw = storage?.getItem?.(key);
        if (raw == null || raw === '') return null;
        const n = Number(raw);
        return Number.isInteger(n) && n >= 0 ? n : null;
    } catch { return null; }
}

export function writeStoredNumber(key, value, storage = defaultStorage()) {
    try {
        if (value == null) storage?.removeItem?.(key);
        else storage?.setItem?.(key, String(value));
    } catch { /* ignore */ }
}

export const GROUP_GAP_MS = 5 * 60 * 1000;
export const PILL_GAP_MS = 20 * 60 * 1000;
export const SENT_COPY = '已发送';

export function parseSendDate(value, toMoment) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'string' || !value.trim()) return null;
    const direct = Date.parse(value);
    if (Number.isFinite(direct)) return direct;
    try {
        const ms = toMoment?.(value)?.valueOf?.();
        return Number.isFinite(ms) ? ms : null;
    } catch {
        return null;
    }
}

export function clockText(ms) {
    const date = new Date(ms);
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function dayStart(ms) {
    const date = new Date(ms);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function gapLabel(ms, now = Date.now()) {
    const date = new Date(ms);
    const days = Math.round((dayStart(now) - dayStart(ms)) / 86400000);
    const clock = clockText(ms);
    if (days === 0) return `今天 ${clock}`;
    if (days === 1) return `昨天 ${clock}`;
    if (days > 1 && days < 7) return `${WEEKDAYS[date.getDay()]} ${clock}`;
    const year = date.getFullYear() === new Date(now).getFullYear() ? '' : `${date.getFullYear()}年`;
    return `${year}${date.getMonth() + 1}月${date.getDate()}日 ${clock}`;
}

export function planMessageMarks(rows, { now = Date.now() } = {}) {
    const marks = rows.map(() => ({ gap: '', time: '', pos: '', tail: false, foot: '' }));
    const eligible = rows.map((row) => !row?.system && !row?.rich && !row?.empty);
    const key = (row) => (row.user ? 'user' : `c:${row.name || ''}`);
    let lastTs = null;
    const joins = rows.map(() => false);
    rows.forEach((row, i) => {
        const ts = Number.isFinite(row?.ts) ? row.ts : null;
        if (eligible[i]) {
            const showGap = ts !== null && (lastTs === null || dayStart(ts) !== dayStart(lastTs) || Math.abs(ts - lastTs) >= PILL_GAP_MS);
            if (showGap) marks[i].gap = gapLabel(ts, now);
            if (ts !== null) marks[i].time = clockText(ts);
            const prev = rows[i - 1];
            joins[i] = Boolean(i > 0 && eligible[i - 1] && !showGap && ts !== null && Number.isFinite(prev?.ts)
                && key(prev) === key(row) && Math.abs(ts - prev.ts) < GROUP_GAP_MS);
        }
        if (ts !== null && !row?.system && !row?.empty) lastTs = ts;
    });
    let lastUser = -1;
    rows.forEach((row, i) => { if (row?.user && !row?.system && !row?.empty) lastUser = i; });
    rows.forEach((_, i) => {
        if (!eligible[i]) return;
        const joinedNext = Boolean(joins[i + 1]);
        const joinedPrev = joins[i];
        marks[i].pos = joinedPrev && joinedNext ? 'mid' : joinedPrev ? 'end' : joinedNext ? 'start' : 'solo';
        marks[i].tail = !joinedNext;
        if (marks[i].tail) {
            const sent = i === lastUser && eligible[i];
            marks[i].foot = [marks[i].time, sent ? SENT_COPY : ''].filter(Boolean).join(' · ');
        }
    });
    return marks;
}

const DATA_IMAGE = /^data:image\/(png|jpeg|webp|gif)(;|,)/i;

export function safeAvatarUrl(value) {
    const raw = String(value ?? '').trim();
    if (!raw || raw.startsWith('//')) return '';
    if (raw.startsWith('/')) return raw;
    if (/^https?:\/\//i.test(raw)) return raw;
    if (DATA_IMAGE.test(raw)) return raw;
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return '';
    return `/thumbnail?type=avatar&file=${encodeURIComponent(raw)}`;
}

export function recalledItems(items, block) {
    const text = String(block || '');
    if (!text.trim()) return [];
    return (Array.isArray(items) ? items : []).filter((item) => typeof item?.summary === 'string' && item.summary.length > 0 && text.includes(item.summary));
}

// ---- chat-react 纯函数 ----
export const REACT_COPY = Object.freeze({
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

const SINGLE = /^(?:\p{Extended_Pictographic}[\p{Emoji_Modifier}️‍\p{Extended_Pictographic}\u{E0020}-\u{E007F}]*|\p{Regional_Indicator}{2}|[0-9#*]️?⃣)$/u;
const SEGMENTER =
    typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
        ? new Intl.Segmenter('zh', { granularity: 'grapheme' })
        : null;

function graphemes(body) {
    if (SEGMENTER) return [...SEGMENTER.segment(body)].map((item) => item.segment);
    return (
        body.match(
            /\p{Extended_Pictographic}[\p{Emoji_Modifier}️‍\p{Extended_Pictographic}]*|\p{Regional_Indicator}{2}|[0-9#*]️?⃣|[\s\S]/gu,
        ) || []
    );
}

export function emojiCount(text) {
    const body = String(text ?? '').replace(/\s+/g, '');
    if (!body) return 0;
    const parts = graphemes(body);
    if (parts.length < 1 || parts.length > 3) return 0;
    for (const part of parts) {
        if (!SINGLE.test(part)) return 0;
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
        mes: REACT_COPY.patLine(name),
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
    try {
        return !['off', '0', 'false'].includes(String(storage?.getItem(EFFECTS_KEY) ?? '').toLowerCase());
    } catch {
        return true;
    }
}

export function pushRecent(list, entry, max = RECENT_MAX) {
    const rest = (Array.isArray(list) ? list : []).filter((item) => !(item?.k === entry.k && item?.v === entry.v));
    return [entry, ...rest].slice(0, max);
}

export function readRecent(storage = globalThis.localStorage) {
    try {
        const list = JSON.parse(storage?.getItem(RECENT_KEY) || '[]');
        return Array.isArray(list)
            ? list.filter((item) => (item?.k === 'e' || item?.k === 's') && typeof item.v === 'string').slice(0, RECENT_MAX)
            : [];
    } catch {
        return [];
    }
}

export function writeRecent(list, storage = globalThis.localStorage) {
    try {
        storage?.setItem(RECENT_KEY, JSON.stringify(list));
    } catch {
        /* 隐私模式下最近使用只是不保存 */
    }
}

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

// ---- chat-search 纯函数 ----
export function textMatches(text, query) {
    const needle = String(query ?? '').trim();
    if (!needle) return [];
    const lower = text.toLowerCase(),
        lowerNeedle = needle.toLowerCase();
    const [hay, key] =
        lower.length === text.length && lowerNeedle.length === needle.length ? [lower, lowerNeedle] : [text, needle];
    const found = [];
    for (let at = hay.indexOf(key); at >= 0; at = hay.indexOf(key, at + key.length)) found.push([at, at + key.length]);
    return found;
}

export function spanOf(parts, start, end) {
    let base = 0,
        from = null,
        to = null;
    for (let i = 0; i < parts.length; i += 1) {
        const next = base + parts[i].length;
        if (from == null && start < next) from = { part: i, offset: start - base };
        if (end <= next) {
            to = { part: i, offset: end - base };
            break;
        }
        base = next;
    }
    return from && to ? { from, to } : null;
}
