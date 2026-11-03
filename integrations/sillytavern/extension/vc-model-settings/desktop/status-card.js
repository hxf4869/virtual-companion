// UX-29 角色状态卡与里程碑（桌面）：标题栏副标题、点头像弹出状态卡、认识天数里程碑系统消息。
// 规格 docs/planning/2026-11-02-ux24-desktop-experience.md §1 UX-29；文案只用代码里的常量，新增文案待 Claude 回填文档。
import { storyRequest } from '../api.js';
import { requestShellDestination } from '../chat-shell.js';
import { celebrate, patCharacter } from '../chat-react.js';
import { reducedMotion } from './transition.js';
import { mountStatusCardView } from './build/index.js';

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

// ---- 纯逻辑（单测直接覆盖） ----

const pad = (n) => String(n).padStart(2, '0');
export const clock = (date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

function localDay(value) {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? NaN : Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

// 认识第 N 天：createdAt 到 now 的本地自然日，含当天；无效返回 0。
export function dayCount(createdAt, now = new Date()) {
    const from = localDay(createdAt);
    const to = localDay(now);
    if (Number.isNaN(from) || Number.isNaN(to) || to < from) return 0;
    return Math.round((to - from) / 86400000) + 1;
}

export function isMilestone(day) {
    return Number.isInteger(day) && day > 0 && (MILESTONES.includes(day) || (day > 365 && day % 365 === 0));
}

// 下一个里程碑：7 / 30 / 100 / 365，之后每满一年。day 为 0 时返回 7。
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

// 副标题：忙到（未来）优先，否则「心情 · 在做什么」。
export function subtitleOf(state, now = new Date()) {
    if (!state) return '';
    const until = state.busyUntil ? new Date(state.busyUntil) : null;
    if (until && !Number.isNaN(until.getTime()) && until.getTime() > now.getTime()) return COPY.busy(clock(until));
    return [state.mood?.vibe, state.activity].map((part) => String(part ?? '').trim()).filter(Boolean).join(' · ');
}

export const barPercent = (value) => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));

// 今天正好达成且本会话还没记录过的里程碑，返回天数，否则 0。
export function pendingMilestone({ createdAt, now = new Date(), metadata } = {}) {
    const day = dayCount(createdAt, now);
    if (!isMilestone(day)) return 0;
    const done = Array.isArray(metadata?.[MILESTONE_KEY]) ? metadata[MILESTONE_KEY] : [];
    return done.includes(day) ? 0 : day;
}

// 插入里程碑系统消息（参照拍一拍）。依赖注入便于单测；返回插入的天数或 0。
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

// ---- 挂载 ----

export function mountStatusCard({
    getContext, document: doc = globalThis.document, who, avatar, onSubtitle, onTriggerState,
    fetchState = (id) => storyRequest('GET', `/api/v1/relationships/${id}/companion-state`),
    openMemory = (opener) => requestShellDestination('memory', opener),
    pat = patCharacter, now = () => new Date(),
} = {}) {
    if (!doc?.body || !avatar || !onSubtitle) return null;
    const root = doc.defaultView || globalThis;
    const desktop = () => doc.documentElement?.dataset?.vcLayout === 'desktop';
    const context = () => { try { return getContext?.() || null; } catch { return null; } };
    const rm = () => { try { return reducedMotion(); } catch { return false; } };
    let row = null;
    let state = null;
    let card = null, entry = null;
    let fetchedAt = 0;
    let token = 0;

    function paintSub() {
        const text = desktop() ? subtitleOf(state, now()) : '';
        onSubtitle(text);
    }

    function cardProps(record) {
        const day = dayCount(row?.createdAt, now()), hint = milestoneHint(day);
        return {
            label: who.getAttribute('aria-label') || '', name: row?.name || row?.instanceName || '', instance: row?.name && row?.instanceName ? row.instanceName : '',
            avatar: avatar.querySelector('img')?.getAttribute('src') || '', letter: [...(row?.name || row?.instanceName || '')][0] || '', reducedMotion: rm(), style: record.style,
            mood: state?.mood?.vibe ? COPY.today(state.mood.vibe) : '', line: state?.mood?.line || state?.emotion?.line || '', activity: state?.activity || '',
            bars: state?.emotion ? [['closeness', COPY.closeness], ['mood', COPY.mood], ['energy', COPY.energy]].map(([key, label]) => ({ label, value: barPercent(state.emotion[key]) })) : [],
            day: day ? COPY.day(day) : '', next: day ? COPY.next(hint.left, hint.day) : '', anchor: avatar,
            ...record.events,
        };
    }
    function place() {
        if (!entry || !card) return;
        const rect = avatar.getBoundingClientRect(), width = card.offsetWidth;
        entry.style = { left: Math.max(8, Math.min(rect.left, root.innerWidth - width - 8)), top: rect.bottom + 8 };
        entry.view.update(cardProps(entry));
    }
    function open() {
        if (card || !desktop() || !row) return;
        const host = doc.createElement('div'); host.style.display = 'contents'; doc.body.append(host);
        const record = { host, view: null, style: {}, restoreFocus: false, events: null };
        entry = record;
        record.events = {
            close: restore => { if (entry === record) close(restore); },
            returnFocus: () => record.restoreFocus && avatar,
            pat: () => { if (entry !== record) return; close(false); void pat(); },
            memory: () => { if (entry !== record) return; close(false); openMemory(avatar); },
            dispose: () => { host.remove(); if (entry !== record) return; entry = card = null; onTriggerState?.({ interactive: desktop(), expanded: false }); },
        };
        record.view = mountStatusCardView(host, cardProps(record)); card = record.view.el;
        place(); onTriggerState?.({ interactive: true, expanded: true });
    }
    function close(restoreFocus = true) {
        if (!entry) return;
        const previous = entry; previous.restoreFocus = restoreFocus;
        entry = card = null; previous.view.unmount(); previous.host.remove();
        onTriggerState?.({ interactive: desktop(), expanded: false });
    }
    function refreshCard() { if (!entry) return; entry.view.update(cardProps(entry)); place(); }

    async function load() {
        const mine = ++token;
        const id = row?.relationshipId;
        if (id == null || id === '' || !desktop()) { state = null; paintSub(); return; }
        try {
            const next = await fetchState(id);
            if (mine !== token) return;
            state = next && typeof next === 'object' ? next : null;
            fetchedAt = Date.now();
        } catch {
            if (mine !== token) return;
        }
        paintSub();
        refreshCard();
    }

    function dress() { onTriggerState?.({ interactive: desktop(), expanded: Boolean(card) }); }

    // 外壳每次画标题栏都会调用；只有换了会话才重新取状态并检查里程碑。
    function setRelationship(next) {
        const changed = String(next?.relationshipId ?? '') !== String(row?.relationshipId ?? '');
        row = next || null;
        dress();
        if (!changed) { refreshCard(); return; }
        close(false);
        state = null;
        paintSub();
        void load();
        if (desktop() && row?.createdAt) {
            void insertMilestone({ ctx: context(), createdAt: row.createdAt, relationshipId: row.relationshipId, now: now() })
                .then((day) => { if (day) setTimeout(() => celebrate(), 160); })
                .catch(() => {});
        }
    }

    avatar.addEventListener('click', (event) => {
        if (!desktop() || event.detail > 1) return;
        if (card) close(); else open();
    });
    avatar.addEventListener('dblclick', () => close(false));
    avatar.addEventListener('keydown', (event) => {
        if (!desktop() || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault();
        if (card) close(); else open();
    });
    root.addEventListener?.('resize', () => { if (!desktop()) close(false); paintSub(); dress(); });
    const tick = () => {
        if (doc.hidden || !row) return;
        void load();
    };
    setInterval(tick, REFRESH_MS).unref?.(); // 单测环境里不拖住进程退出
    doc.addEventListener('visibilitychange', () => {
        if (!doc.hidden && row && Date.now() - fetchedAt >= REFRESH_MS) void load();
    });
    return { setRelationship, refresh: load, open, close, paintSub };
}
