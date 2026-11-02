// UX-30 通知与未读（桌面）：复用收件箱数据，其他会话 / 页面收到新的主动消息时弹站内横幅，
// 标签页隐藏时发系统通知（仅权限已授予），标签页标题加 `(N) ` 前缀。手机不变。
import { pendingInboxWrites } from '../chat-shell.js';

export const COPY = Object.freeze({
    now: '现在',
    voice: (seconds) => `[语音] ${seconds}″`,
});
export const BANNER_MS = 5000;
export const POLL_MS = 30000;
const TITLE_PREFIX = /^\(\d+\) /;
const PREVIEW_MAX = 60;

// ---- 纯逻辑（单测直接覆盖） ----

export function previewOf(row) {
    const ms = row?.voice?.durationMs;
    if (Number.isFinite(ms) && ms > 0) return COPY.voice(Math.max(1, Math.round(ms / 1000)));
    const text = String(row?.body ?? '').replace(/<[^<>]*>/g, '').replace(/\s+/g, ' ').trim();
    return [...text].slice(0, PREVIEW_MAX).join('');
}

// 待写入的主动消息里 eventId 没见过的；seen 会被更新。
export function newArrivals(rows, seen) {
    const fresh = [];
    for (const row of pendingInboxWrites(rows)) {
        if (!row.eventId || row.call || seen.has(row.eventId)) continue;
        seen.add(row.eventId);
        fresh.push(row);
    }
    return fresh;
}

export function titleWithCount(title, count) {
    const base = String(title ?? '').replace(TITLE_PREFIX, '');
    return count > 0 ? `(${count > 99 ? '99+' : count}) ${base}` : base;
}

export const NOTIFY_KEY = 'vc-desktop-notify';

// 设置里的「桌面通知」开关：本机偏好，默认开（仍需浏览器授权）。
export function systemNotifyEnabled(storage = globalThis.localStorage) {
    try { return !['off', '0', 'false'].includes(String(storage?.getItem(NOTIFY_KEY) ?? '').toLowerCase()); } catch { return true; }
}

export function notifySupported() {
    return typeof Notification === 'function';
}

// 权限入口（设置里调用）：只有「未决定」才弹询问，已授予 / 已拒绝直接返回当前状态。
export async function requestNotifyPermission() {
    if (!notifySupported()) return 'denied';
    if (Notification.permission !== 'default') return Notification.permission;
    try { return await Notification.requestPermission(); } catch { return Notification.permission; }
}

// ---- 挂载 ----

// describe(relationshipId) → { name, avatar }（avatar 为可用图片地址或空）；onOpen(relationshipId) 进入该会话。
export function createNotifier({ document: doc = globalThis.document, describe, onOpen, bannerMs = BANNER_MS } = {}) {
    const root = doc?.defaultView || globalThis;
    const desktop = () => doc?.documentElement?.dataset?.vcLayout === 'desktop';
    const seen = new Set();
    let seeded = false;
    let banner = null;
    let hideTimer = 0;
    let leaveTimer = 0;

    function dismiss() {
        clearTimeout(hideTimer);
        if (!banner) return;
        const node = banner;
        banner = null;
        node.classList.add('is-out');
        let gone = false;
        const remove = () => { if (!gone) { gone = true; node.remove(); } };
        node.addEventListener('animationend', remove, { once: true });
        leaveTimer = setTimeout(remove, 400);
    }

    function arm() {
        clearTimeout(hideTimer);
        hideTimer = setTimeout(dismiss, bannerMs);
    }

    function showBanner(row) {
        clearTimeout(leaveTimer);
        banner?.remove();
        const who = describe?.(row.relationshipId) || {};
        const card = doc.createElement('button');
        card.type = 'button';
        card.className = 'vc-notify-card vc-glass';
        const face = doc.createElement(who.avatar ? 'img' : 'span');
        face.className = 'vc-notify-avatar';
        if (who.avatar) { face.alt = ''; face.src = who.avatar; } else face.textContent = [...(who.name || '')][0] || '';
        const copy = doc.createElement('span');
        copy.className = 'vc-notify-copy';
        const top = doc.createElement('span');
        top.className = 'vc-notify-top';
        const name = doc.createElement('b');
        name.textContent = who.name || '';
        const time = doc.createElement('small');
        time.textContent = COPY.now;
        top.append(name, time);
        const text = doc.createElement('span');
        text.className = 'vc-notify-text';
        text.textContent = previewOf(row);
        copy.append(top, text);
        card.append(face, copy);
        card.addEventListener('click', () => { dismiss(); onOpen?.(row.relationshipId); });
        card.addEventListener('pointerenter', () => clearTimeout(hideTimer));
        card.addEventListener('pointerleave', arm);
        let host = doc.getElementById('vc-notify');
        if (!host) {
            host = doc.createElement('div');
            host.id = 'vc-notify';
            host.setAttribute('role', 'status');
            doc.body.append(host);
        }
        host.replaceChildren(card);
        banner = card;
        arm();
    }

    function showSystem(row) {
        if (!notifySupported() || Notification.permission !== 'granted' || !systemNotifyEnabled()) return;
        const who = describe?.(row.relationshipId) || {};
        try {
            const note = new Notification(who.name || '', { body: previewOf(row), icon: who.avatar || undefined, tag: `vc-${row.relationshipId}` });
            note.onclick = () => { root.focus?.(); note.close?.(); onOpen?.(row.relationshipId); };
        } catch { /* 部分环境不允许构造通知，横幅与标题前缀仍可用 */ }
    }

    // rows 为 /api/v1/inbox 全量；viewing 是此刻正在看的会话 relationshipId（不在聊天里为 null）。
    function ingest(rows, { viewing = null } = {}) {
        if (!desktop() || !Array.isArray(rows)) return;
        const fresh = newArrivals(rows, seen);
        const count = pendingInboxWrites(rows).length;
        doc.title = titleWithCount(doc.title, count);
        if (!seeded) { seeded = true; return; } // 首次只记下已有的，不把存量当新消息
        const row = fresh.at(-1);
        if (!row) return;
        if (doc.hidden) { showSystem(row); return; }
        if (viewing != null && String(viewing) === String(row.relationshipId)) return;
        showBanner(row);
    }

    return { ingest, dismiss };
}
