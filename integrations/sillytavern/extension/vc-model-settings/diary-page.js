// UX-33 记忆页「日记」：按天的日期条 + 纸张卡片。只在桌面记忆页里由 memory-page.js 挂载。
// 数据来自 Go：每个关系每天至多一篇，按月读取；字体偏好只存本机。
import * as api from './api.js';
import { icon } from './ui/icons.js';

export const DIARY_FONT_KEY = 'vc-diary-font';
export const DIARY_FONTS = Object.freeze([['body', '正文'], ['hand', '手写']]);
export const DIARY_EMPTY = '还没有日记';
export const DIARY_MOMENTS = '今天的瞬间';
export const DIARY_FONT_BUTTON = 'Aa';
const HAND_CSS = new URL('./fonts/lxgw-wenkai/lxgwwenkai-regular.css', import.meta.url).href;
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
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

// ---- 渲染 ----

export function renderDiary(state, { font = 'body' } = {}) {
    const entries = state.entries || {};
    const days = monthDays(state.month).map((day) => {
        const on = day === state.selectedDay;
        const dot = entries[day] ? ' data-has="true"' : '';
        return `<button type="button" class="vc-diary-day" data-action="diary-day" data-day="${day}" aria-pressed="${on}"${dot}><span>${Number(day.slice(8))}</span></button>`;
    }).join('');
    const strip = `<div class="vc-diary-strip"><button type="button" class="vc-circle" data-action="diary-month" data-delta="-1" aria-label="上个月">${icon('chevron-left', { size: 18 })}</button>
        <div class="vc-diary-days" role="group" aria-label="${esc(monthLabel(state.month))}"><span class="vc-diary-month">${esc(monthLabel(state.month))}</span>${days}</div>
        <button type="button" class="vc-circle" data-action="diary-month" data-delta="1" aria-label="下个月">${icon('chevron-right', { size: 18 })}</button></div>`;
    const entry = entries[state.selectedDay];
    let body;
    if (state.error) body = `<div class="vc-empty"><p role="alert">${esc(state.error)}</p><button type="button" class="vc-btn vc-btn-fill" data-action="diary-retry">重试</button></div>`;
    else if (state.loading && !entry) body = '<div class="vc-diary-paper is-loading" aria-busy="true"></div>';
    else if (!entry) body = `<div class="vc-empty">${icon('file-text', { size: 32 })}<p class="vc-memory-empty" role="status">${DIARY_EMPTY}</p></div>`;
    else {
        const moments = (entry.moments || []).length
            ? `<div class="vc-diary-moments"><h3>${DIARY_MOMENTS}</h3><ul>${entry.moments.map((m) => `<li>${esc(m)}</li>`).join('')}</ul></div>` : '';
        body = `<article class="vc-diary-paper${font === 'hand' ? ' is-hand' : ''}" data-day="${esc(entry.day)}">
            <header><h2>${esc(diaryDayTitle(entry.day))}</h2>${entry.vibe ? `<span class="vc-diary-vibe">${esc(entry.vibe)}</span>` : ''}
            <button type="button" class="vc-circle vc-diary-aa" data-action="diary-font" aria-haspopup="menu" aria-label="${DIARY_FONT_BUTTON}">${DIARY_FONT_BUTTON}</button></header>
            <p class="vc-diary-body">${esc(entry.body)}</p>${moments}</article>`;
    }
    return `<div class="vc-diary">${strip}${body}</div>`;
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
