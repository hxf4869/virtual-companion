// UX-32 记忆页「收藏」：卡片墙 + 提醒列表 + 右侧「即将提醒」。只在桌面记忆页里由 memory-page.js 挂载。
import * as api from './api.js';

export const FAVORITES_EMPTY = '还没有收藏';
export const REMINDERS_EMPTY = '还没有提醒';
export const FAVORITES_SEGMENTS = Object.freeze([['favorites', '收藏'], ['reminders', '提醒']]);
const pad = (n) => String(n).padStart(2, '0');
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export const GLYPHS = {
    pin: '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
    star: '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    'circle-check': '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
    ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
};
/** 精灵图里没有的几枚线性图标（Lucide，ISC）：同一描边样式。 */
export function glyph(name, size = 20) {
    return `<svg class="vc-icon" style="--vc-icon-size:${size}px" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">${GLYPHS[name] || ''}</svg>`;
}

// ---- 纯函数（单测直接覆盖） ----

export function monthDay(iso) {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '' : `${date.getMonth() + 1}月${date.getDate()}日`;
}

/** 提醒时间：今天 / 今晚（18 点起）、明天、其余按 M月D日。 */
export function reminderWhen(iso, now = new Date()) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    if (sameDay(date, now)) return `${date.getHours() >= 18 ? '今晚' : '今天'} ${clock}`;
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    if (sameDay(date, next)) return `明天 ${clock}`;
    return `${date.getMonth() + 1}月${date.getDate()}日 ${clock}`;
}

// ---- 控制器 ----

export function createFavoritesPage({ onChange = () => {} } = {}) {
    const state = { segment: 'favorites', favorites: [], nextCursor: '', reminders: [], loading: false, error: '', relationshipId: '' };
    let run = 0;
    const settle = (ticket) => { if (ticket === run) { state.loading = false; onChange(state); } };
    return {
        state,
        async load(relationshipId = state.relationshipId) {
            state.relationshipId = String(relationshipId || '');
            const ticket = ++run;
            if (!state.relationshipId) { Object.assign(state, { favorites: [], reminders: [], nextCursor: '' }); onChange(state); return; }
            state.loading = true; state.error = ''; onChange(state);
            try {
                const [page, reminders] = await Promise.all([api.listFavorites(state.relationshipId, { limit: 30 }), api.listReminders(state.relationshipId)]);
                if (ticket !== run) return;
                state.favorites = page?.items || []; state.nextCursor = page?.nextCursor || '';
                state.reminders = Array.isArray(reminders) ? reminders : (reminders?.items || []);
            } catch { if (ticket === run) state.error = '没有完成，请重试。'; }
            finally { settle(ticket); }
        },
        async more() {
            if (!state.nextCursor || state.loading) return;
            const ticket = ++run;
            state.loading = true; onChange(state);
            try {
                const page = await api.listFavorites(state.relationshipId, { after: state.nextCursor, limit: 30 });
                if (ticket !== run) return;
                state.favorites = [...state.favorites, ...(page?.items || [])]; state.nextCursor = page?.nextCursor || '';
            } catch { if (ticket === run) state.error = '没有完成，请重试。'; }
            finally { settle(ticket); }
        },
        setSegment(segment) { state.segment = segment === 'reminders' ? 'reminders' : 'favorites'; onChange(state); },
        async removeFavorite(id) {
            await api.deleteFavorite(id);
            state.favorites = state.favorites.filter((item) => item.favoriteId !== String(id));
            onChange(state);
        },
        async cancelReminder(id) {
            await api.deleteReminder(id);
            state.reminders = state.reminders.filter((item) => item.reminderId !== String(id));
            onChange(state);
        },
        reset() { run++; Object.assign(state, { segment: 'favorites', favorites: [], nextCursor: '', reminders: [], loading: false, error: '' }); },
    };
}
