// Virtual Companion · 记忆、日记、收藏与消息来源纯逻辑
// 许可：AGPL-3.0-only（见 integrations/sillytavern/README.md）

import * as api from './api.js';
import { messageInstant } from './chat-logic.js';
import { chatSnapshotsFromRecent, loadRecentChatSnapshots } from './conversations.js';
import { iconSpriteUrl } from './ui/icons.js';

export { chatSnapshotsFromRecent, loadRecentChatSnapshots };

if (typeof globalThis.addEventListener !== 'function' || typeof globalThis.dispatchEvent !== 'function') {
    const bus = new EventTarget();
    globalThis.addEventListener = (type, listener, options) => bus.addEventListener(type, listener, options);
    globalThis.removeEventListener = (type, listener, options) => bus.removeEventListener(type, listener, options);
    globalThis.dispatchEvent = (event) => bus.dispatchEvent(event);
}

// ---------- From memory-controller.js ----------

export const FORGET_NOTICE = '聊天原文仍保留，可能继续用于当前对话。';
export const MEMORY_EMPTY_DIALOG = '没有找到记忆。试试其他关键词或筛选条件。';
export const MEMORY_EMPTY_TAB = '没有找到记忆';
export const OPEN_MEMORY_EVENT = 'vc-open-memory';
/** 记忆来源 / 收藏「回到对话」：detail = { relationshipId, chatIdentity?, chatFile?, mesId }。 */
export const OPEN_MESSAGE_EVENT = 'vc-open-message';
let memoryOpener = null;

export function bindOpenMemory(open) {
    const registered = typeof open === 'function' ? open : null;
    memoryOpener = registered;
    return () => { if (memoryOpener === registered) memoryOpener = null; };
}

export function requestOpenMemory(opener) {
    const detail = { opener };
    globalThis.dispatchEvent(new CustomEvent(OPEN_MEMORY_EVENT, { detail }));
    if (globalThis.document?.body?.classList?.contains('vc-ui') === true) return detail;
    if (typeof memoryOpener === 'function') memoryOpener(opener);
    return detail;
}

export const idOf = item => String(item.memoryId ?? item.id);
export const canEdit = item => item?.lifecycle === 'ACTIVE' || item?.lifecycle === 'active';

export function errorText(error) {
    if (error?.kind === 'unauthenticated') return '登录已过期，请重新登录后打开记忆页。';
    if (error?.kind === 'context-changed') return '登录状态已变化，请重新打开记忆页。';
    if (error?.kind === 'not-found') return '这条记忆已不可用，请刷新列表。';
    return '加载失败或操作未完成，请重试。';
}

export function createMemoryPage({ onChange = () => {}, schedule = setTimeout, cancel = clearTimeout } = {}) {
    const state = { open: false, relationships: [], relationshipId: '', filters: {}, filterDraft: {}, items: [], nextCursor: null,
        loading: false, detailLoading: false, selectedId: '', detail: null, evidence: [], evidenceError: '', listError: '', detailError: '',
        editing: false, draft: '', conflict: false, busy: false, reauthAction: null, view: 'list', notice: '' };
    let epoch = 0, listRun = 0, detailRun = 0, timer, dead = false;
    const emit = () => { if (!dead) onChange(state); };
    const stopPoll = () => { cancel(timer); timer = undefined; };
    const alive = (e) => state.open && epoch === e;
    const currentDetail = (e, run) => alive(e) && detailRun === run;
    function patchItem(record) { state.items = state.items.map(item => idOf(item) === idOf(record) ? { ...item, ...record } : item); }
    function poll() {
        stopPoll();
        if (!state.open || state.detail?.cleanup?.state !== 'PENDING') return;
        const e = epoch, run = detailRun, id = idOf(state.detail);
        timer = schedule(async () => {
            if (!currentDetail(e, run)) return;
            try {
                const record = await api.fetchMemory(id);
                if (!currentDetail(e, run)) return;
                state.detail = record; patchItem(record); state.detailError = ''; emit(); poll();
            } catch {
                if (currentDetail(e, run)) { state.detailError = '清理状态更新失败，请刷新详情。'; emit(); }
            }
        }, 2000);
    }
    async function loadList(append = false) {
        if (!state.open || !state.relationshipId || (append && (!state.nextCursor || state.loading))) return;
        const e = epoch, run = ++listRun;
        state.loading = true; state.listError = '';
        if (!append) { state.items = []; state.nextCursor = null; }
        emit();
        try {
            const result = await api.fetchMemories(state.relationshipId, { ...state.filters, limit: 20, ...(append ? { cursor: state.nextCursor } : {}) });
            if (!alive(e) || listRun !== run) return;
            state.items = append ? [...state.items, ...result.items] : result.items;
            state.nextCursor = result.nextCursor;
        } catch (error) { if (alive(e) && listRun === run) state.listError = errorText(error); }
        finally { if (alive(e) && listRun === run) { state.loading = false; emit(); } }
    }
    function clearDetail() {
        detailRun++; stopPoll(); state.detail = null; state.selectedId = ''; state.evidence = []; state.evidenceError = ''; state.detailError = '';
        state.detailLoading = false; state.editing = false; state.draft = ''; state.conflict = false; state.notice = ''; state.view = 'list'; state.reauthAction = null;
    }
    async function select(id, preserveDraft = false) {
        if (dead || !state.open || state.busy) return;
        const e = epoch, run = ++detailRun;
        stopPoll(); state.selectedId = String(id); state.detailLoading = true; state.detailError = ''; state.evidenceError = ''; state.evidence = []; state.view = 'detail';
        if (!preserveDraft) { state.detail = null; state.editing = false; state.draft = ''; state.conflict = false; state.notice = ''; }
        emit();
        try {
            let record = await api.fetchMemory(id);
            // A concurrent correction creates a new identity. Only explicit refresh follows it.
            if (preserveDraft && record.supersededByMemoryId) record = await api.fetchMemory(record.supersededByMemoryId);
            if (!currentDetail(e, run)) return;
            state.detail = record; state.selectedId = idOf(record); state.conflict = false;
            if (!preserveDraft) state.draft = record.summary;
            if (preserveDraft && !canEdit(record)) { state.editing = true; state.notice = '记忆状态已变化，草稿已保留；当前记录无法继续纠正。'; }
            patchItem(record); poll();
            try {
                const evidence = await api.fetchMemoryEvidence(idOf(record));
                if (currentDetail(e, run)) state.evidence = evidence;
            } catch { if (currentDetail(e, run)) state.evidenceError = '来源加载失败，请刷新详情。'; }
        } catch (error) { if (currentDetail(e, run)) state.detailError = errorText(error); }
        finally { if (currentDetail(e, run)) { state.detailLoading = false; emit(); } }
    }
    async function write(action) {
        if (state.busy || !state.detail || state.detailLoading) return;
        if (action === 'save' && (!state.editing || state.conflict || !canEdit(state.detail) || !state.draft.trim())) return;
        if (action === 'forget' && ['FORGETTING', 'FORGOTTEN'].includes(state.detail.lifecycle)) return;
        const e = epoch, run = detailRun, previous = state.detail;
        state.busy = true; state.detailError = ''; state.notice = ''; emit();
        try {
            if (action === 'save') {
                const result = await api.correctMemory(idOf(previous), { summary: state.draft, expectedVersion: previous.version });
                if (!currentDetail(e, run)) return;
                patchItem({ ...previous, lifecycle: 'SUPERSEDED', recallEligible: false, supersededByMemoryId: result.memoryId });
                state.detail = result; state.selectedId = idOf(result); state.draft = result.summary; state.editing = false; state.conflict = false;
                state.notice = '纠正已保存，原记录已被替代。';
                // Do not pretend the old evidence belongs to the replacement.
                state.evidence = [];
                try { const evidence = await api.fetchMemoryEvidence(idOf(result)); if (currentDetail(e, run)) state.evidence = evidence; }
                catch { if (currentDetail(e, run)) state.evidenceError = '来源加载失败，请刷新详情。'; }
            } else {
                const result = await api.forgetMemory(idOf(previous));
                if (!currentDetail(e, run)) return;
                state.detail = { ...previous, lifecycle: 'FORGETTING', recallEligible: false, cleanup: result.cleanup };
                state.editing = false; state.conflict = false; patchItem(state.detail); poll();
            }
            state.reauthAction = null;
            await loadList();
        } catch (error) {
            if (!currentDetail(e, run)) return;
            if (error.status === 409 && error.code === 'MEMORY_VERSION_CONFLICT') state.conflict = true;
            else if (error.kind === 'forbidden') state.reauthAction = action;
            else state.detailError = errorText(error);
        } finally { if (currentDetail(e, run)) { state.busy = false; emit(); } }
    }
    const controller = {
        state,
        async open(preferredRelationshipId) {
            if (dead || state.busy) return;
            epoch++; listRun++; clearDetail(); state.open = true; state.loading = true; state.busy = false;
            state.items = []; state.relationships = []; state.relationshipId = ''; state.filters = {}; state.filterDraft = {}; state.listError = ''; emit();
            const e = epoch;
            try {
                await api.captureSessionContext();
                if (!alive(e)) return;
                const relationships = (await api.fetchRelationships()).filter((row) => row.personaRef === 'st-character');
                if (!alive(e)) return;
                state.relationships = relationships;
                state.relationshipId = String(relationships.find(r => String(r.relationshipId) === String(preferredRelationshipId))?.relationshipId ?? relationships[0]?.relationshipId ?? '');
                state.loading = false;
                await loadList(); emit();
            } catch (error) { if (alive(e)) { state.loading = false; state.listError = errorText(error); emit(); } }
        },
        close() { epoch++; listRun++; clearDetail(); state.open = false; state.busy = false; state.items = []; emit(); },
        destroy() { dead = true; controller.close(); },
        loadList, more: () => loadList(true), select,
        async changeRelationship(id) { if (dead || state.busy) return; clearDetail(); state.relationshipId = String(id); await loadList(); },
        async filter(filters) { if (dead || state.busy) return; clearDetail(); state.filters = filters; state.filterDraft = { ...filters }; await loadList(); },
        back() { if (state.busy || state.editing) return; state.view = 'list'; emit(); },
        edit() { if (!canEdit(state.detail) || state.busy) return; state.editing = true; state.draft = state.detail.summary; state.notice = ''; emit(); },
        setDraft(value) { if (dead || state.busy) return; state.draft = value; emit(); },
        setFilterDraft(name, value) { if (dead || state.busy) return; state.filterDraft[name] = value; emit(); },
        cancelEdit() { state.editing = false; state.draft = state.detail?.summary || ''; state.conflict = false; emit(); },
        refreshDetail: () => state.selectedId ? select(state.selectedId, state.editing) : undefined,
        save: () => write('save'), forget: () => write('forget'),
        cancelReauth() { state.reauthAction = null; emit(); },
        async authenticate(password) {
            if (state.busy || !password || !state.reauthAction) return;
            const e = epoch, action = state.reauthAction; state.busy = true; emit();
            try { await api.reauth(password); if (!alive(e)) return; state.reauthAction = null; state.busy = false; await write(action); }
            catch { if (alive(e)) { state.busy = false; state.detailError = '身份验证未完成，请检查密码后重试。'; emit(); } }
        },
    };
    return controller;
}

// ---------- From diary-page.js ----------

export const DIARY_FONT_KEY = 'vc-diary-font';
export const DIARY_FONTS = Object.freeze([['body', '正文'], ['hand', '手写']]);
export const DIARY_EMPTY = '还没有日记';
export const DIARY_MOMENTS = '今天的瞬间';
export const DIARY_FONT_BUTTON = 'Aa';
const HAND_CSS = new URL('./fonts/lxgw-wenkai/lxgwwenkai-regular.css', import.meta.url).href;
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const pad = (n) => String(n).padStart(2, '0');

export function localDay(date = new Date()) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export const monthOfDay = (day) => String(day).slice(0, 7);

export function shiftMonth(month, delta) {
    const [year, mon] = String(month).split('-').map(Number);
    const date = new Date(year, mon - 1 + delta, 1);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

export function monthDays(month) {
    const [year, mon] = String(month).split('-').map(Number);
    const count = new Date(year, mon, 0).getDate();
    return Array.from({ length: count }, (_, i) => `${month}-${pad(i + 1)}`);
}

export function monthLabel(month) {
    return `${Number(String(month).slice(5, 7))}月`;
}

export function diaryDayTitle(day) {
    const [year, mon, date] = String(day).split('-').map(Number);
    const weekday = WEEKDAYS[new Date(year, mon - 1, date).getDay()];
    return `${mon}月${date}日 ${weekday}`;
}

export function readDiaryFont(storage) {
    try {
        const value = (storage ?? globalThis.localStorage)?.getItem?.(DIARY_FONT_KEY);
        return value === 'hand' ? 'hand' : 'body';
    } catch { return 'body'; }
}

export function writeDiaryFont(value, storage) {
    const next = value === 'hand' ? 'hand' : 'body';
    try { (storage ?? globalThis.localStorage)?.setItem?.(DIARY_FONT_KEY, next); } catch { /* 记不住就算了 */ }
    return next;
}

export function ensureHandwriting(doc = globalThis.document) {
    if (!doc?.head || doc.querySelector?.('link[data-vc-diary-font]')) return;
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = HAND_CSS;
    link.setAttribute('data-vc-diary-font', '');
    doc.head.append(link);
}

export function createDiaryPage({ onChange = () => {}, now = () => new Date() } = {}) {
    const today = localDay(now());
    const state = { month: monthOfDay(today), selectedDay: today, entries: {}, loading: false, error: '', relationshipId: '' };
    let run = 0;
    async function load(relationshipId = state.relationshipId, { pick = false } = {}) {
        state.relationshipId = String(relationshipId || '');
        if (!state.relationshipId) { state.entries = {}; onChange(state); return; }
        const ticket = ++run;
        state.loading = true; state.error = ''; onChange(state);
        try {
            const result = await api.fetchDiaryMonth(state.relationshipId, state.month);
            if (ticket !== run) return;
            state.entries = Object.fromEntries((result?.items || []).map((entry) => [entry.day, entry]));
            if (pick || !state.selectedDay.startsWith(state.month)) {
                const days = Object.keys(state.entries).sort();
                const today = localDay(now());
                const current = state.month === monthOfDay(today);
                state.selectedDay = current && state.entries[today] ? today : (days.at(-1) || (current ? today : `${state.month}-01`));
            }
        } catch { if (ticket === run) state.error = '没有完成，请重试。'; }
        finally { if (ticket === run) { state.loading = false; onChange(state); } }
    }
    return {
        state,
        load,
        select(day) { state.selectedDay = day; onChange(state); },
        shift(delta) { state.month = shiftMonth(state.month, delta); state.entries = {}; return load(state.relationshipId, { pick: true }); },
        reset() { run++; Object.assign(state, { month: monthOfDay(localDay(now())), selectedDay: localDay(now()), entries: {}, loading: false, error: '' }); },
    };
}

// ---------- From favorites-page.js ----------

export const FAVORITES_EMPTY = '还没有收藏';
export const REMINDERS_EMPTY = '还没有提醒';
export const FAVORITES_SEGMENTS = Object.freeze([['favorites', '收藏'], ['reminders', '提醒']]);
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export const GLYPHS = {
    pin: '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
    star: '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    'circle-check': '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
    ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
};

export function glyph(name, size = 20) {
    return `<svg class="vc-icon" style="--vc-icon-size:${size}px" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">${GLYPHS[name] || ''}</svg>`;
}

export function monthDay(iso) {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '' : `${date.getMonth() + 1}月${date.getDate()}日`;
}

export function reminderWhen(iso, now = new Date()) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    if (sameDay(date, now)) return `${date.getHours() >= 18 ? '今晚' : '今天'} ${clock}`;
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    if (sameDay(date, next)) return `明天 ${clock}`;
    return `${date.getMonth() + 1}月${date.getDate()}日 ${clock}`;
}

// ---------- From memory-page.js ----------

export const lifecycleLabels = { ACTIVE: '生效中', SUPERSEDED: '已被替代', FORGETTING: '清理中', FORGOTTEN: '已遗忘' };
export const sourceLabels = { VALID: '来源已核验', PENDING_VERIFICATION: '来源待核验', INVALID: '来源已失效' };
export const typeLabels = { FACT: '事实', PREFERENCE: '偏好', EVENT: '经历', GOAL: '目标', COMMITMENT: '承诺', SUMMARY: '摘要' };

export function stamp(value, zone) {
    if (!value) return '未记录';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '时间未知';
    try { return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short', timeZone: zone || undefined }).format(date); }
    catch { return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
}

export const MEMORY_SEGMENTS = [
    ['', '全部'],
    ['PENDING_VERIFICATION', '待核验'],
    ['INVALID', '已失效'],
];
export const STATUS_OPTIONS = [['', '全部状态'], ...Object.entries(lifecycleLabels), ['PENDING_VERIFICATION', '来源待核验'], ['INVALID', '来源已失效']];

export function relationshipLabel(rel, relationships) {
    const name = rel?.companionName || rel?.characterName || '未命名角色';
    const same = (relationships || []).filter((item) => (item.companionName || item.characterName || '未命名角色') === name);
    if (same.length < 2) return name;
    const index = same.findIndex((item) => String(item.relationshipId) === String(rel.relationshipId));
    if (index < 0) return name;
    return `${name} ${index + 1}`;
}

export function modeLabel(mode) {
    if (mode === 'STORY' || mode === 'story') return '剧情';
    if (mode === 'DAILY' || mode === 'companion' || mode === 'COMPANION') return '日常';
    return '模式未知';
}

export function dayLabel(value) {
    if (!value) return '日期未知';
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return '日期未知';
    try { return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(date); }
    catch { return String(value); }
}

export function toneForLifecycle(lifecycle) {
    if (lifecycle === 'ACTIVE' || lifecycle === 'active') return 'ok';
    if (lifecycle === 'SUPERSEDED' || lifecycle === 'superseded' || lifecycle === 'corrected') return 'warn';
    if (lifecycle === 'FORGETTING' || lifecycle === 'FORGOTTEN' || lifecycle === 'forgetting' || lifecycle === 'forgotten') return 'danger';
    return 'neutral';
}

export function toneForSource(status) {
    if (status === 'VALID') return 'ok';
    if (status === 'PENDING_VERIFICATION') return 'warn';
    if (status === 'INVALID') return 'danger';
    return 'neutral';
}

export function dateFilterLabel(draft) {
    const from = draft?.eventDateFrom || '';
    const to = draft?.eventDateTo || '';
    if (from && to) return `${from} – ${to}`;
    if (from || to) return [from, to].filter(Boolean).join(' – ');
    return '全部';
}

export const MEMORY_SECTIONS = Object.freeze([
    ['timeline', '时间线', 'clock', ''],
    ['pinned', '已钉住', 'pin', 'ACTIVE'],
    ['pending', '待核验', 'circle-check', 'PENDING_VERIFICATION'],
    ['invalid', '已失效', 'ban', 'INVALID'],
]);
export const SECTION_STATUS = Object.freeze(Object.fromEntries(MEMORY_SECTIONS.map(([key, , , status]) => [key, status])));
export const INCOGNITO_LABEL = '新对话不记';
const pad2 = (n) => String(n).padStart(2, '0');
const localKey = (date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

export function dayKeyOf(value) {
    if (!value) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : localKey(date);
}

/** 今天 / 昨天 / M月D日（跨年带年份）。 */
export function dayGroupLabel(key, now = new Date()) {
    if (!key) return '日期未知';
    if (key === localKey(now)) return '今天';
    if (key === localKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))) return '昨天';
    const [year, month, day] = key.split('-').map(Number);
    return year === now.getFullYear() ? `${month}月${day}日` : `${year}年${month}月${day}日`;
}

export function clockOf(value) {
    if (!value || /^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export const memoryMoment = (item) => item?.time?.recordedAt || item?.updatedAt || item?.createdAt || item?.time?.eventDate || '';

/** 按本地日期分组，保持接口返回的顺序（新的在前）。 */
export function groupTimeline(items, now = new Date()) {
    const groups = [];
    for (const item of items) {
        const key = dayKeyOf(memoryMoment(item));
        let group = groups.find((entry) => entry.key === key);
        if (!group) { group = { key, label: dayGroupLabel(key, now), items: [] }; groups.push(group); }
        group.items.push(item);
    }
    return groups;
}

export function excerptOf(text, max = 36) {
    const chars = [...String(text ?? '').replace(/\s+/g, ' ').trim()];
    return chars.length > max ? `${chars.slice(0, max).join('')}…` : chars.join('');
}

/** st:<chatIdentity>:<messageId>:… */
export function parseSourceRef(ref) {
    const match = /^st:([^:]+):([^:]+):/.exec(String(ref ?? ''));
    if (!match) return null;
    return { chatIdentity: match[1], messageId: match[2], mesId: /^\d+$/.test(match[2]) ? Number(match[2]) : null };
}

/** 卡片上的「来自 今天 15:42：「……」」；没有可展示的摘录时返回 null。 */
export function pickSource(evidence, now = new Date()) {
    const row = (evidence || []).find((item) => item?.status === 'VALID' && String(item.excerpt ?? '').trim())
        || (evidence || []).find((item) => String(item?.excerpt ?? '').trim());
    if (!row) return null;
    const key = dayKeyOf(row.sourceTimestamp);
    const when = key ? `${dayGroupLabel(key, now)} ${clockOf(row.sourceTimestamp)}`.trim() : '';
    const ref = parseSourceRef(row.sourceRef);
    return { line: `来自${when ? ` ${when}` : ''}：「${excerptOf(row.excerpt)}」`, chatIdentity: ref?.chatIdentity || '', messageId: String(row.messageId || ref?.messageId || ''), mesId: ref?.mesId ?? (/^\d+$/.test(String(row.messageId)) ? Number(row.messageId) : null) };
}

export function memoryViewProps(state, ui = {}, events = {}) {
    const sprite = iconSpriteUrl(), action = events.action;
    return {
        state, ui, sprite, glyphs: GLYPHS, desktop: false, forgetNotice: FORGET_NOTICE, emptyDialog: MEMORY_EMPTY_DIALOG,
        labels: { lifecycle: lifecycleLabels, source: sourceLabels, type: typeLabels }, sections: MEMORY_SECTIONS, segments: MEMORY_SEGMENTS, statusOptions: STATUS_OPTIONS,
        format: { stamp, relationship: relationshipLabel, mode: modeLabel, day: dayLabel, dates: dateFilterLabel, lifeTone: toneForLifecycle, sourceTone: toneForSource, group: groupTimeline, clock: clockOf, moment: memoryMoment },
        diary: ui.diary ? { state: ui.diary, font: ui.font, sprite, action, days: monthDays, monthLabel, title: diaryDayTitle } : undefined,
        favorites: ui.favorites ? { state: ui.favorites, names: Object.fromEntries((state.relationships || []).map(item => [String(item.relationshipId), item.companionName || ''])), now: ui.now || new Date(), sprite, action, segment: events.favoriteSegment, monthDay, when: reminderWhen } : undefined,
        ...events,
    };
}

export function forgettingNow(previous, lifecycle) {
    return previous && !['FORGETTING', 'FORGOTTEN'].includes(previous) && ['FORGETTING', 'FORGOTTEN'].includes(lifecycle);
}

// ---------- From message-source.js ----------

const fileName = value => String(value || '').replace(/\.jsonl$/i, '');
const currentFile = context => fileName(context.getCurrentChatId?.() || context.chatId);

// 记忆/收藏共用原生打开路径；先确定正确的聊天文件，再按持久消息 ID 找楼层。
export async function openMessageSource(detail, deps = {}) {
    const {
        getContext,
        openConversation,
        loadNative,
        loadChats = () => loadRecentChatSnapshots(loadNative),
        afterOpen,
        ensureVisible,
        document: doc = globalThis.document,
    } = deps;
    const relationshipId = String(detail?.relationshipId || '');
    const identity = String(detail?.chatIdentity || '');
    const file = fileName(detail?.chatFile);
    if (!relationshipId || (!identity && !file)) throw new Error('source-unavailable');
    const before = getContext();
    const sameRelationship = String(before.chatMetadata?.vc_binding?.relationshipId || '') === relationshipId;
    const alreadyHere = sameRelationship && (identity ? before.chatMetadata?.vc_f2?.id === identity : currentFile(before) === file);
    const target = alreadyHere ? { relationshipId, file: currentFile(before), avatar: before.characters?.[before.characterId]?.avatar }
        : (await loadChats()).find(row => String(row.relationshipId) === relationshipId
            && (identity ? row.chatIdentity === identity : (fileName(row.file) === file || row.fileAliases?.some(alias => fileName(alias) === file))));
    if (!target?.file) throw new Error('source-unavailable');
    if (!await openConversation(target)) throw new Error('source-open-failed');
    if (afterOpen) await afterOpen();
    const native = loadNative ? await loadNative() : {};
    if (currentFile(getContext()) !== fileName(target.file)) {
        if (typeof native.openCharacterChat !== 'function') throw new Error('source-open-unavailable');
        await native.openCharacterChat(fileName(target.file));
    }
    const context = getContext();
    if (String(context.chatMetadata?.vc_binding?.relationshipId || '') !== relationshipId
        || (identity && context.chatMetadata?.vc_f2?.id !== identity)) throw new Error('source-changed');
    const stableId = detail.messageId == null ? '' : String(detail.messageId);
    let mesId = -1;
    if (stableId) {
        mesId = context.chat.findIndex(message => message.vc_message_id === stableId);
        // 旧样板来源用数字楼层；真实 UUID 消息找不到时不退回其他消息。
        if (mesId === -1 && /^\d+$/.test(stableId)) mesId = detail.mesId;
    } else {
        // 收藏契约保存快照而非持久消息 ID；楼层在删除消息后会移动，不能直接信任。
        const at = messageInstant(detail.messageAt);
        const matches = at ? context.chat.flatMap((message, index) =>
            !message.is_system && messageInstant(message.send_date) === at
                && (message.is_user ? 'user' : 'character') === detail.role
                && Array.from(String(message.mes || '').trim()).slice(0, 2000).join('') === detail.body
                ? [index] : []) : [];
        if (matches.length === 1) mesId = matches[0];
    }
    if (!Number.isInteger(mesId) || mesId < 0 || mesId >= context.chat.length) throw new Error('source-message-unavailable');
    const first = doc?.querySelector('#chat > .mes')?.getAttribute('mesid');
    if (ensureVisible) await ensureVisible(mesId);
    else if (first != null && Number(first) > mesId && typeof native.showMoreMessages === 'function') {
        await native.showMoreMessages(Number(first) - mesId);
    }
    return mesId;
}
