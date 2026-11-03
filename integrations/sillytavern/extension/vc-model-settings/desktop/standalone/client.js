// 独立桌面的 ST 数据边界。页面身份只从已认证 HTML 捕获，绝不在写前刷新为另一身份。
export function createDesktopClient({ fetchImpl = globalThis.fetch, document: doc = globalThis.document } = {}) {
    const identity = Object.freeze({ accountId: doc.querySelector('meta[name="vc-account-id"]')?.content || '',
        sessionId: doc.querySelector('meta[name="vc-session-id"]')?.content || '' });
    let token = '';
    const headers = () => ({ 'Content-Type': 'application/json', 'X-CSRF-Token': token,
        'X-VC-Expected-Account-ID': identity.accountId, 'X-VC-Expected-Session-ID': identity.sessionId });
    async function request(url, body, { signal } = {}) {
        const response = await fetchImpl(url, { method: 'POST', credentials: 'same-origin', cache: 'no-store',
            headers: headers(), body: JSON.stringify(body), signal });
        if (!response.ok) {
            const error = new Error('请求没有完成，请重试。');
            error.status = response.status;
            error.details = await response.json().catch(() => null);
            throw error;
        }
        return response.json();
    }
    return { identity, headers, request,
        async initialize() {
            if (!/^[1-9][0-9]*$/.test(identity.accountId) || !/^[1-9][0-9]*$/.test(identity.sessionId)) throw new Error('请重新打开页面。');
            const response = await fetchImpl('/csrf-token', { credentials: 'same-origin', cache: 'no-store' });
            if (!response.ok) throw new Error('登录状态已变化，请重新打开页面。');
            token = (await response.json()).token;
            if (!token) throw new Error('页面验证未完成，请重新加载。');
        },
        characters: () => request('/api/characters/all', {}),
        recent: () => request('/api/chats/recent', { metadata: true }),
        readChat: (row, options) => request('/api/chats/get', { avatar_url: row.avatar, file_name: row.file }, options),
    };
}
