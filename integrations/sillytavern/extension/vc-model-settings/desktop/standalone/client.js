// 独立桌面的 ST 数据边界。页面身份只从已认证 HTML 捕获，绝不在写前刷新为另一身份。
export function createDesktopClient({ fetchImpl = globalThis.fetch, document: doc = globalThis.document, onGenerateResponse } = {}) {
    const identity = Object.freeze({ accountId: doc.querySelector('meta[name="vc-account-id"]')?.content || '',
        sessionId: doc.querySelector('meta[name="vc-session-id"]')?.content || '' });
    let token = '';
    let initialSettings;
    const headers = () => ({ 'Content-Type': 'application/json', 'X-CSRF-Token': token,
        'X-VC-Expected-Account-ID': identity.accountId, 'X-VC-Expected-Session-ID': identity.sessionId });
    const raw = (url, body, { signal } = {}) => fetchImpl(url, { method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: headers(), body: typeof body === 'string' ? body : JSON.stringify(body), signal });
    async function checked(response) {
        if (!response.ok) {
            const error = new Error('请求没有完成，请重试。');
            error.status = response.status;
            error.details = await response.json().catch(() => null);
            throw error;
        }
        return response;
    }
    const post = async (url, body, options) => checked(await raw(url, body, options));
    const request = async (url, body, options) => (await post(url, body, options)).json();
    return { identity, headers, request, raw, post,
        settings() { return initialSettings ||= request('/api/settings/get', {}).catch(error => { initialSettings = null; throw error; }); },
        async generate(packet, options) { const response = await raw(packet.url, packet.body, options); onGenerateResponse?.(response); return checked(response); },
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
