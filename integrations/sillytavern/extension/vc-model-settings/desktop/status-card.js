// UX-29 角色状态卡与里程碑（桌面）：标题栏副标题、点头像弹出状态卡、认识天数里程碑系统消息。
// 规格 docs/planning/2026-11-02-ux24-desktop-experience.md §1 UX-29；文案只用代码里的常量，新增文案待 Claude 回填文档。
import { storyRequest } from '../api.js';
import { requestShellDestination } from '../chat-shell.js';
import { celebrate, patCharacter } from '../chat-react.js';
import { reducedMotion } from './transition.js';

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
    getContext, document: doc = globalThis.document, who, avatar, sub,
    fetchState = (id) => storyRequest('GET', `/api/v1/relationships/${id}/companion-state`),
    openMemory = (opener) => requestShellDestination('memory', opener),
    pat = patCharacter, now = () => new Date(),
} = {}) {
    if (!doc?.body || !avatar || !sub) return null;
    const root = doc.defaultView || globalThis;
    const desktop = () => doc.documentElement?.dataset?.vcLayout === 'desktop';
    const context = () => { try { return getContext?.() || null; } catch { return null; } };
    const rm = () => { try { return reducedMotion(); } catch { return false; } };
    let row = null;
    let state = null;
    let card = null;
    let fetchedAt = 0;
    let token = 0;

    function paintSub() {
        const text = desktop() ? subtitleOf(state, now()) : '';
        sub.textContent = text;
        sub.hidden = !text;
    }

    function makeAvatar(src, letter) {
        const node = doc.createElement(src ? 'img' : 'span');
        node.className = 'vc-sc-face';
        if (src) { node.alt = ''; node.src = src; node.draggable = false; } else node.textContent = letter;
        return node;
    }

    // 头像换图（心情变化）时 0.5s 交叉淡化：新图叠在旧图上淡入，完成后移除旧图。
    function swapFace(holder, next) {
        const old = holder.querySelector('.vc-sc-face');
        if (!old || rm()) { holder.replaceChildren(next); return; }
        next.classList.add('is-incoming');
        holder.append(next);
        const done = () => { old.remove(); next.classList.remove('is-incoming'); };
        next.addEventListener('animationend', done, { once: true });
        setTimeout(done, 700);
    }

    function faceOf() {
        const img = avatar.querySelector('img');
        const letter = [...(row?.name || row?.instanceName || '')][0] || '';
        return makeAvatar(img?.getAttribute('src') || '', letter);
    }

    function line(className, text) {
        const node = doc.createElement('p');
        node.className = className;
        node.textContent = text;
        return node;
    }

    function bar(label, value) {
        const wrap = doc.createElement('div');
        wrap.className = 'vc-sc-bar';
        const name = doc.createElement('span');
        name.textContent = label;
        const track = doc.createElement('i');
        track.setAttribute('role', 'progressbar');
        track.setAttribute('aria-label', label);
        track.setAttribute('aria-valuemin', '0');
        track.setAttribute('aria-valuemax', '100');
        track.setAttribute('aria-valuenow', String(barPercent(value)));
        const fill = doc.createElement('b');
        fill.style.setProperty('--v', String(barPercent(value)));
        track.append(fill);
        wrap.append(name, track);
        return wrap;
    }

    function button(className, label, onClick) {
        const node = doc.createElement('button');
        node.type = 'button';
        node.className = className;
        node.textContent = label;
        node.addEventListener('click', onClick);
        return node;
    }

    function build() {
        const el = doc.createElement('div');
        el.id = 'vc-status-card';
        el.className = 'vc-glass';
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-label', who.getAttribute('aria-label') || '');
        el.tabIndex = -1;
        const head = doc.createElement('div');
        head.className = 'vc-sc-head';
        const holder = doc.createElement('span');
        holder.className = 'vc-sc-avatar';
        holder.append(faceOf());
        const names = doc.createElement('div');
        const name = doc.createElement('b');
        name.textContent = row?.name || row?.instanceName || '';
        names.append(name);
        const inst = row?.name && row?.instanceName ? row.instanceName : '';
        if (inst) names.append(Object.assign(doc.createElement('small'), { textContent: inst }));
        head.append(holder, names);
        el.append(head);
        if (state?.mood?.vibe) {
            const mood = doc.createElement('div');
            mood.className = 'vc-sc-mood';
            mood.append(line('vc-sc-title', COPY.today(state.mood.vibe)));
            const text = state.mood.line || state.emotion?.line;
            if (text) mood.append(line('vc-sc-sub', text));
            el.append(mood);
        }
        if (state?.activity) {
            const doing = doc.createElement('div');
            doing.className = 'vc-sc-doing';
            doing.append(line('vc-sc-label', COPY.doing), line('vc-sc-text', state.activity));
            el.append(doing);
        }
        if (state?.emotion) {
            const bars = doc.createElement('div');
            bars.className = 'vc-sc-bars';
            bars.append(bar(COPY.closeness, state.emotion.closeness), bar(COPY.mood, state.emotion.mood), bar(COPY.energy, state.emotion.energy));
            el.append(bars);
        }
        const day = dayCount(row?.createdAt, now());
        if (day) {
            const days = doc.createElement('div');
            days.className = 'vc-sc-days';
            const { left, day: target } = milestoneHint(day);
            days.append(line('vc-sc-title', COPY.day(day)), line('vc-sc-next', COPY.next(left, target)));
            el.append(days);
        }
        const actions = doc.createElement('div');
        actions.className = 'vc-sc-actions';
        actions.append(
            button('vc-btn vc-sc-action', COPY.pat, () => { close(false); void pat(); }),
            button('vc-btn vc-sc-action', COPY.memory, () => { close(false); openMemory(avatar); }),
        );
        el.append(actions);
        return el;
    }

    function place() {
        const rect = avatar.getBoundingClientRect();
        const width = card.offsetWidth;
        card.style.left = `${Math.max(8, Math.min(rect.left, root.innerWidth - width - 8))}px`;
        card.style.top = `${rect.bottom + 8}px`;
    }

    function open() {
        if (card || !desktop() || !row) return;
        card = build();
        doc.body.append(card);
        place();
        avatar.setAttribute('aria-expanded', 'true');
        card.focus();
    }

    function close(restoreFocus = true) {
        if (!card) return;
        card.remove();
        card = null;
        avatar.setAttribute('aria-expanded', 'false');
        if (restoreFocus) avatar.focus?.();
    }

    function refreshCard() {
        if (!card) return;
        const holder = card.querySelector('.vc-sc-avatar');
        const fresh = build();
        const next = fresh.querySelector('.vc-sc-face');
        const old = holder?.querySelector('.vc-sc-face');
        card.replaceChildren(...fresh.childNodes);
        if (old && next && old.getAttribute('src') !== next.getAttribute('src')) {
            const newHolder = card.querySelector('.vc-sc-avatar');
            newHolder.replaceChildren(old);
            swapFace(newHolder, next);
        }
        place();
    }

    async function load() {
        const id = row?.relationshipId;
        if (id == null || id === '' || !desktop()) { state = null; paintSub(); return; }
        const mine = ++token;
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

    function dress() {
        if (!desktop()) { avatar.removeAttribute('role'); avatar.removeAttribute('tabindex'); return; }
        avatar.setAttribute('role', 'button');
        avatar.tabIndex = 0;
        avatar.setAttribute('aria-haspopup', 'dialog');
        avatar.setAttribute('aria-expanded', card ? 'true' : 'false');
    }

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
    doc.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' || !card) return;
        event.preventDefault();
        event.stopPropagation();
        close();
    }, true);
    doc.addEventListener('pointerdown', (event) => {
        if (card && !card.contains(event.target) && !avatar.contains(event.target)) close(false);
    }, true);
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
