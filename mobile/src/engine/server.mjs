// 引擎就绪前直接读 ST 服务端接口（会话列表、历史先行）。ADR-0011 §1、MB-0 报告第 3 节。
// 写请求要带 Go 会话身份头（x-vc-expected-*）与 CSRF；身份从 /auth/api/session 取，不缓存跨会话。

export class ServerError extends Error {
    constructor(status, path) { super(`HTTP ${status} ${path}`); this.status = status; this.path = path; }
}

export function stripJsonl(name) {
    return String(name || '').replace(/\.jsonl$/i, '');
}

// ST 聊天行 → 界面消息。id 是楼层号（与 ST mesid 一致）。
export function toMessage(row, id) {
    const swipes = Array.isArray(row?.swipes) ? row.swipes.length : 1;
    return {
        id,
        user: Boolean(row?.is_user),
        system: Boolean(row?.is_system),
        name: String(row?.name || ''),
        text: String(row?.mes ?? ''),
        time: row?.send_date || '',
        swipes: Math.max(1, swipes),
        swipe: Number.isInteger(row?.swipe_id) ? row.swipe_id : 0,
    };
}

export function createServer({ fetchImpl = (...a) => fetch(...a) } = {}) {
    let identity = null;
    let csrf = '';

    async function headers() {
        if (!identity) {
            const r = await fetchImpl('/auth/api/session', { headers: { Accept: 'application/json' } });
            if (!r.ok) throw new ServerError(r.status, '/auth/api/session');
            const j = await r.json();
            identity = { accountId: String(j.accountId), sessionId: String(j.sessionId) };
        }
        if (!csrf) {
            const r = await fetchImpl('/csrf-token');
            if (!r.ok) throw new ServerError(r.status, '/csrf-token');
            csrf = (await r.json()).token;
        }
        return {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrf,
            'x-vc-expected-account-id': identity.accountId,
            'x-vc-expected-session-id': identity.sessionId,
        };
    }

    async function post(path, body) {
        const r = await fetchImpl(path, { method: 'POST', headers: await headers(), body: JSON.stringify(body ?? {}) });
        if (r.status === 409 || r.status === 401) { identity = null; csrf = ''; }
        if (!r.ok) throw new ServerError(r.status, path);
        return r.json();
    }

    return {
        characters: () => post('/api/characters/all', {}),
        async recentChats(max = 50) {
            const rows = await post('/api/chats/recent', { max, metadata: true });
            return (Array.isArray(rows) ? rows : []).filter((r) => r.avatar).map((r) => ({
                avatar: r.avatar,
                file: stripJsonl(r.file_name),
                preview: String(r.mes ?? ''),
                updated: Number(r.last_mes) || 0,
                items: Number(r.chat_items) || 0,
                binding: r.chat_metadata?.vc_binding || null,
            }));
        },
        async chat(avatar, file, name = '') {
            const rows = await post('/api/chats/get', { ch_name: name, file_name: stripJsonl(file), avatar_url: avatar });
            const list = Array.isArray(rows) ? rows : [];
            return { meta: list[0]?.chat_metadata || {}, messages: list.slice(1).map(toMessage) };
        },
        reset() { identity = null; csrf = ''; },
    };
}
