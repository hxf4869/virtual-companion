// UX-30 通知与未读（桌面）：复用收件箱数据，其他会话 / 页面收到新的主动消息时弹站内横幅，
// 标签页隐藏时发系统通知（仅权限已授予），标签页标题加 `(N) ` 前缀。手机不变。
import {
    COPY,
    BANNER_MS,
    POLL_MS,
    NOTIFY_KEY,
    unreadInboxEvents,
    previewOf,
    newArrivals,
    titleWithCount,
    systemNotifyEnabled,
    writeSystemNotifyEnabled,
    notifySupported,
    requestNotifyPermission,
} from '../inbox-logic.js';

export {
    COPY,
    BANNER_MS,
    POLL_MS,
    NOTIFY_KEY,
    previewOf,
    newArrivals,
    titleWithCount,
    systemNotifyEnabled,
    writeSystemNotifyEnabled,
    notifySupported,
    requestNotifyPermission,
} from '../inbox-logic.js';

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
        const count = unreadInboxEvents(rows).length;
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
