// UX-29 角色状态卡与里程碑（桌面）：标题栏副标题、点头像弹出状态卡、认识天数里程碑系统消息。
// 规格 docs/planning/2026-11-02-ux24-desktop-experience.md §1 UX-29；文案只用代码里的常量，新增文案待 Claude 回填文档。
import { storyRequest } from '../api.js';
import { requestShellDestination } from '../chat-shell.js';
import { celebrate, patCharacter } from '../chat-react.js';
import { reducedMotion } from './transition.js';
import { mountStatusCardView } from './build/index.js';
import {
    COPY,
    REFRESH_MS,
    MILESTONES,
    MILESTONE_KEY,
    clock,
    dayCount,
    isMilestone,
    nextMilestone,
    milestoneHint,
    firstChatDate,
    subtitleOf,
    barPercent,
    pendingMilestone,
    insertMilestone,
} from '../status-logic.js';

export {
    COPY,
    REFRESH_MS,
    MILESTONES,
    MILESTONE_KEY,
    clock,
    dayCount,
    isMilestone,
    nextMilestone,
    milestoneHint,
    firstChatDate,
    subtitleOf,
    barPercent,
    pendingMilestone,
    insertMilestone,
};

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
