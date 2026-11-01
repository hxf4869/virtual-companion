import { toDate } from '../engine/server.mjs';
export { toDate } from '../engine/server.mjs';
// 聊天的纯逻辑：引用与草稿（与扩展 chat-compose.js 同格式，单测逐项比对）、时间胶囊、分组、气泡分段。
// 与桌面共用扩展里的纯逻辑模块（无 DOM 依赖），两端对同一条消息的拆分一致。
import { splitReply } from '../../../integrations/sillytavern/extension/vc-model-settings/reply-pipeline.js';

export const QUOTE_MAX = 30;
export const GAP_MS = 20 * 60 * 1000;
const DRAFT_PREFIX = 'vc-draft:';
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const STICKER_RE = /<sticker\b[^>]*?\btag\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*?\/?>/i;

export function quoteSummary(text, max = QUOTE_MAX) {
    const body = String(text ?? '').split(/\r?\n/).filter((line) => !/^\s*>/.test(line)).join(' ')
        .replace(/<[^>]*>/g, '').replace(/[*_`~]+/g, '').replace(/\s+/g, ' ').trim();
    const chars = [...body];
    return chars.length > max ? `${chars.slice(0, max).join('')}…` : body;
}

export function quoteLine(name, text) {
    const who = String(name ?? '').replace(/\s+/g, ' ').trim();
    return `> ${who ? `${who}：` : ''}${quoteSummary(text)}`;
}

export function withQuote(quote, text) {
    const body = String(text ?? '');
    if (!quote || !body.trim()) return body;
    return `${quoteLine(quote.name, quote.text)}\n\n${body}`;
}

// 消息正文开头的引用行拆出来单独显示（与桌面一致：第一段 "> 名字：摘要" + 空行）。
export function splitQuote(text) {
    const m = /^> ([^\n]*)\n\n([\s\S]*)$/.exec(String(text ?? ''));
    return m ? { quote: m[1], body: m[2] } : { quote: '', body: String(text ?? '') };
}

export function draftKey(chatId) {
    const id = String(chatId ?? '').trim();
    return id ? `${DRAFT_PREFIX}${id}` : '';
}
export function readDraft(chatId, storage = globalThis.localStorage) {
    const key = draftKey(chatId);
    if (!key) return '';
    try { return storage?.getItem(key) || ''; } catch { return ''; }
}
export function writeDraft(chatId, text, storage = globalThis.localStorage) {
    const key = draftKey(chatId);
    if (!key) return;
    try {
        if (String(text ?? '').trim()) storage?.setItem(key, String(text));
        else storage?.removeItem(key);
    } catch { /* 隐私模式下草稿只是不保存 */ }
}

const pad = (n) => String(n).padStart(2, '0');
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const day0 = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

// 日期 / 间隔胶囊（文案第 19 节）：今天 / 昨天 / 7 天内周几 / 更早 M月D日 / 跨年带年份。
export function timePill(value, now = new Date()) {
    const d = toDate(value);
    if (!d) return '';
    const days = Math.round((day0(now) - day0(d)) / 86400000);
    if (days === 0) return `今天 ${hm(d)}`;
    if (days === 1) return `昨天 ${hm(d)}`;
    if (days > 1 && days < 7) return `${WEEK[d.getDay()]} ${hm(d)}`;
    if (d.getFullYear() !== now.getFullYear()) return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${hm(d)}`;
    return `${d.getMonth() + 1}月${d.getDate()}日 ${hm(d)}`;
}

// 会话列表右侧时间：今天 HH:mm / 昨天 / 周几 / M/D。
export function listTime(value, now = new Date()) {
    if (!value) return '';
    const d = toDate(value);
    if (!d) return '';
    const days = Math.round((day0(now) - day0(d)) / 86400000);
    if (days === 0) return hm(d);
    if (days === 1) return '昨天';
    if (days > 1 && days < 7) return WEEK[d.getDay()];
    return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function previewText(text, { card = false } = {}) {
    if (card) return '[互动卡片]';
    const raw = String(text ?? '');
    if (STICKER_RE.test(raw) && !raw.replace(new RegExp(STICKER_RE.source, 'gi'), '').trim()) return '[表情]';
    return raw.replace(/<voice\s*\/>/gi, '').replace(new RegExp(STICKER_RE.source, 'gi'), '[表情]')
        .replace(/<[^>]*>/g, '').replace(/^> .*\n\n/, '').replace(/\s+/g, ' ').trim();
}

// 陪伴会话：一条回复按扩展同一规则拆成多个气泡；表情包段先显示为 [表情]（MB-7 换成图片）。
export function segments(message, { companion = true } = {}) {
    const { quote, body } = splitQuote(message.text);
    if (message.user || !companion) return { quote, parts: [{ type: 'text', text: body }] };
    const parts = splitReply(body).map((seg) => (typeof seg === 'string' && STICKER_RE.test(seg))
        ? { type: 'sticker', tag: (STICKER_RE.exec(seg)[1] ?? STICKER_RE.exec(seg)[2] ?? '') }
        : typeof seg === 'string' ? { type: 'text', text: seg } : { type: 'sticker', tag: seg.tag || '' });
    return { quote, parts: parts.length ? parts : [{ type: 'text', text: '' }] };
}

// 分组：同一发送者连续消息为一组；间隔超过 20 分钟插日期胶囊并断组。系统消息不显示。
export function groupMessages(messages, now = new Date()) {
    const rows = [];
    let prev = null;
    for (const m of messages) {
        if (m.system) continue;
        const t = toDate(m.time);
        const gap = !prev || !t || !prev.t || t - prev.t > GAP_MS;
        if (gap && t) rows.push({ type: 'pill', key: `pill-${m.id}`, text: timePill(t, now) });
        const same = prev && !gap && prev.user === m.user;
        if (same) rows[rows.length - 1].messages.push(m);
        else rows.push({ type: 'group', key: `g-${m.id}`, user: m.user, name: m.name, messages: [m] });
        prev = { user: m.user, t };
    }
    return rows;
}
