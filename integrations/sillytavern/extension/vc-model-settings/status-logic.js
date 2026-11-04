// UX-28 建议回复 & UX-29 角色状态卡与里程碑纯逻辑（无 DOM 依赖）。

export const COPY = Object.freeze({
    today: (vibe) => `今天：${vibe}`,
    doing: '在做什么',
    closeness: '亲近',
    mood: '心情',
    energy: '精力',
    day: (n) => `认识第 ${n} 天`,
    next: (left, day) => `再过 ${left} 天是我们认识 ${day} 天`,
    busy: (time) => `忙到 ${time}`,
    pat: '拍一拍',
    memory: '查看记忆',
    milestone: (n) => `我们认识 ${n} 天啦`,
    milestoneSub: (date) => `${date} 第一次聊天`,
});
export const REFRESH_MS = 10 * 60 * 1000;
export const MILESTONES = Object.freeze([7, 30, 100, 365]);
export const MILESTONE_KEY = 'vc_milestones';

const pad = (n) => String(n).padStart(2, '0');
export const clock = (date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

function localDay(value) {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? NaN : Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

export function dayCount(createdAt, now = new Date()) {
    const from = localDay(createdAt);
    const to = localDay(now);
    if (Number.isNaN(from) || Number.isNaN(to) || to < from) return 0;
    return Math.round((to - from) / 86400000) + 1;
}

export function isMilestone(day) {
    return Number.isInteger(day) && day > 0 && (MILESTONES.includes(day) || (day > 365 && day % 365 === 0));
}

export function nextMilestone(day) {
    const n = Math.max(0, Math.floor(Number(day) || 0));
    return MILESTONES.find((item) => item > n) ?? (Math.floor(n / 365) + 1) * 365;
}

export function milestoneHint(day) {
    const target = nextMilestone(day);
    return { left: target - day, day: target };
}

export function firstChatDate(createdAt) {
    const date = new Date(createdAt);
    return Number.isNaN(date.getTime()) ? '' : `${date.getMonth() + 1}月${date.getDate()}日`;
}

export function subtitleOf(state, now = new Date()) {
    if (!state) return '';
    const until = state.busyUntil ? new Date(state.busyUntil) : null;
    if (until && !Number.isNaN(until.getTime()) && until.getTime() > now.getTime()) return COPY.busy(clock(until));
    return [state.mood?.vibe, state.activity].map((part) => String(part ?? '').trim()).filter(Boolean).join(' · ');
}

export const barPercent = (value) => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));

export function statusViewModel({ name = '', avatar = '', relationship = null, state = null, now = new Date() } = {}) {
    const instance = relationship?.displayName && relationship.displayName !== name ? String(relationship.displayName) : '';
    const vibe = String(state?.mood?.vibe ?? '').trim();
    const mood = vibe ? COPY.today(vibe) : '';
    const line = String(state?.mood?.line ?? '').trim();
    const activity = String(state?.activity ?? '').trim();
    const bars = [];
    if (state?.closeness !== undefined && state?.closeness !== null) {
        bars.push({ label: COPY.closeness, value: barPercent(state.closeness) });
    }
    if (state?.mood?.score !== undefined && state?.mood?.score !== null) {
        bars.push({ label: COPY.mood, value: barPercent(state.mood.score) });
    }
    if (state?.energy !== undefined && state?.energy !== null) {
        bars.push({ label: COPY.energy, value: barPercent(state.energy) });
    }
    const count = relationship?.createdAt ? dayCount(relationship.createdAt, now) : 0;
    const day = count > 0 ? COPY.day(count) : '';
    const hint = count > 0 ? milestoneHint(count) : null;
    const next = hint ? COPY.next(hint.left, hint.day) : '';
    return {
        name: String(name || '角色'),
        avatar: String(avatar || ''),
        instance,
        mood,
        line,
        activity,
        bars,
        day,
        next,
        subtitle: subtitleOf(state, now),
    };
}

export function pendingMilestone({ createdAt, now = new Date(), metadata } = {}) {
    const day = dayCount(createdAt, now);
    if (!isMilestone(day)) return 0;
    const done = Array.isArray(metadata?.[MILESTONE_KEY]) ? metadata[MILESTONE_KEY] : [];
    return done.includes(day) ? 0 : day;
}

export async function insertMilestone({ ctx, createdAt, relationshipId, now = new Date() } = {}) {
    if (!ctx || !Array.isArray(ctx.chat)) return 0;
    if (String(ctx.chatMetadata?.vc_binding?.relationshipId ?? '') !== String(relationshipId ?? '')) return 0;
    const day = pendingMilestone({ createdAt, now, metadata: ctx.chatMetadata });
    if (!day) return 0;
    const done = Array.isArray(ctx.chatMetadata[MILESTONE_KEY]) ? ctx.chatMetadata[MILESTONE_KEY] : [];
    ctx.chatMetadata[MILESTONE_KEY] = [...done, day];
    const row = {
        name: '',
        is_user: false,
        is_system: true,
        send_date: now.toISOString(),
        mes: COPY.milestone(day),
        extra: { type: 'narrator', vc_kind: 'milestone', vc_sub: COPY.milestoneSub(firstChatDate(createdAt)) },
    };
    ctx.chat.push(row);
    ctx.addOneMessage?.(row);
    await ctx.saveChat?.();
    await ctx.saveMetadata?.();
    return day;
}

// ---- UX-28 建议回复纯逻辑 ----
export const SUGGEST_KEY = 'vc-reply-suggestions';
export const META_KEY = 'vc_suggestions';
export const MAX_MESSAGES = 8;
export const MAX_CHARS = 500;
export const MAX_ITEMS = 3;

export function suggestEnabled(storage = globalThis.localStorage) {
    try {
        return !['off', '0', 'false'].includes(String(storage?.getItem(SUGGEST_KEY) ?? '').toLowerCase());
    } catch {
        return true;
    }
}

export function cleanText(text) {
    return String(text ?? '').replace(/<[^<>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS);
}

export function buildMessages(chat, max = MAX_MESSAGES) {
    const out = [];
    for (const message of Array.isArray(chat) ? chat : []) {
        if (!message || message.is_system) continue;
        const text = cleanText(message.mes);
        if (text) out.push({ role: message.is_user ? 'user' : 'character', text });
    }
    return out.slice(-max);
}

export function normalizeItems(result) {
    const list = Array.isArray(result) ? result : result?.suggestions;
    if (!Array.isArray(list)) return [];
    return list.filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean).slice(0, MAX_ITEMS);
}

export function lastCharacterIndex(chat) {
    if (!Array.isArray(chat) || !chat.length) return -1;
    const last = chat[chat.length - 1];
    return last && !last.is_user && !last.is_system && cleanText(last.mes) ? chat.length - 1 : -1;
}

export function storedFor(chat, metadata) {
    const saved = metadata?.[META_KEY];
    const index = lastCharacterIndex(chat);
    if (index < 0 || !saved || saved.mesid !== index) return [];
    return normalizeItems(saved.items);
}
