// UX-33 记忆页「日记」：按天的日期条 + 纸张卡片。只在桌面记忆页里由 memory-page.js 挂载。
// 数据来自 Go：每个关系每天至多一篇，按月读取；字体偏好只存本机。
import * as api from './api.js';

export const DIARY_FONT_KEY = 'vc-diary-font';
export const DIARY_FONTS = Object.freeze([['body', '正文'], ['hand', '手写']]);
export const DIARY_EMPTY = '还没有日记';
export const DIARY_MOMENTS = '今天的瞬间';
export const DIARY_FONT_BUTTON = 'Aa';
const HAND_CSS = new URL('./fonts/lxgw-wenkai/lxgwwenkai-regular.css', import.meta.url).href;
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const pad = (n) => String(n).padStart(2, '0');

// ---- 纯函数（单测直接覆盖） ----

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

/** 只有选中「手写」才插入字体样式表，浏览器随后按 unicode-range 只下载用到的分片。 */
export function ensureHandwriting(doc = globalThis.document) {
    if (!doc?.head || doc.querySelector?.('link[data-vc-diary-font]')) return;
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = HAND_CSS;
    link.setAttribute('data-vc-diary-font', '');
    doc.head.append(link);
}

// ---- 控制器 ----

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
