// 独立桌面的 ST 数据边界。页面身份只从已认证 HTML 捕获，绝不在写前刷新为另一身份。
import { createStoredChatStore, storedChatRecords } from './chat-store.js';
import { createSettingsDocuments } from '../../settings-documents.js';
export function createDesktopClient({ fetchImpl = globalThis.fetch, document: doc = globalThis.document, onGenerateResponse } = {}) {
    const identity = Object.freeze({ accountId: doc.querySelector('meta[name="vc-account-id"]')?.content || '',
        sessionId: doc.querySelector('meta[name="vc-session-id"]')?.content || '' });
    let token = '';
    let initialSettings, chatStorage;
    const headers = () => ({ 'Content-Type': 'application/json', 'X-CSRF-Token': token,
        'X-VC-Expected-Account-ID': identity.accountId, 'X-VC-Expected-Session-ID': identity.sessionId });
    const raw = (url, body, { signal, generation } = {}) => fetchImpl(url, { method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { ...headers(), ...(generation ? { 'X-VC-Stored-Chat-Generation': JSON.stringify(generation) } : {}) }, body: typeof body === 'string' ? body : JSON.stringify(body), signal });
    async function checked(response) {
        if (!response.ok) {
            const error = new Error('请求没有完成，请重试。');
            error.status = response.status;
            error.details = await response.json().catch(() => null);
            error.code = error.details?.code;
            throw error;
        }
        return response;
    }
    const post = async (url, body, options) => checked(await raw(url, body, options));
    const request = async (url, body, options) => {
        if (url === '/api/characters/all' || url === '/api/characters/get') {
            if (getChatStorage().mode !== 'ST') body = { ...body, vc_resource_only: true };
        }
        return (await post(url, body, options)).json();
    };
    const documents = createSettingsDocuments({ post: raw });
    const getChatStorage = () => {
        if (!chatStorage) throw new Error('暂时不可用，请稍后重试。');
        return chatStorage;
    };
    async function refreshChatStorage() {
        const response = await checked(await fetchImpl('/auth/api/session?include=chatStorage', {
            credentials: 'same-origin', cache: 'no-store', headers: headers(),
        }));
        const value = await response.json();
        if (value.accountId !== identity.accountId || value.sessionId !== identity.sessionId) {
            throw Object.assign(new Error('登录状态已变化，请重新打开页面。'), { code: 'ACCOUNT_CONTEXT_CHANGED', status: 409 });
        }
        if (!['ST', 'GO', 'FROZEN'].includes(value.chatStorage?.mode) ||
            typeof value.chatStorage?.authorityEpoch !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value.chatStorage?.authorityEpoch || '')) throw new Error('暂时不可用，请稍后重试。');
        chatStorage = Object.freeze({ ...value.chatStorage });
        return chatStorage;
    }
    async function chatRequest(method, path, body, { signal } = {}) {
        const storage = getChatStorage();
        if (method !== 'GET' && method !== 'HEAD' && storage.mode !== 'GO') {
            throw Object.assign(new Error(storage.mode === 'FROZEN' ? '正在迁移' : '登录状态或聊天已变化，请重新打开页面。'), { status: 409, code: 'CHAT_AUTHORITY_CHANGED' });
        }
        const csrf = doc.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith('vc_csrf='))?.slice(8) || '';
        try {
            return await (await checked(await fetchImpl('/api/plugins/virtual-companion/go' + path, {
                method, credentials: 'same-origin', cache: 'no-store', signal,
                headers: { ...headers(), 'X-VC-CSRF-Token': decodeURIComponent(csrf) },
                body: body === undefined ? undefined : JSON.stringify(body),
            }))).json();
        } catch (error) {
            if (error.code === 'CHAT_AUTHORITY_CHANGED') await refreshChatStorage().catch(() => {});
            throw error;
        }
    }
    async function listStoredChats({ characterRef, groupRef, kind, signal } = {}) {
        const storage = getChatStorage();
        if (storage.mode !== 'GO') throw Object.assign(new Error(storage.mode === 'FROZEN' ? '正在迁移' : '登录状态或聊天已变化，请重新打开页面。'), { status: 409, code: 'CHAT_AUTHORITY_CHANGED' });
        const rows = new Map(), cursors = new Set();
        let cursor;
        do {
            signal?.throwIfAborted();
            const query = new URLSearchParams({ limit: '200', ...(characterRef ? { characterRef } : {}), ...(cursor ? { cursor } : {}) });
            const page = await chatRequest('GET', '/api/v1/chats?' + query, undefined, { signal });
            signal?.throwIfAborted();
            if (page.authorityEpoch !== storage.authorityEpoch) throw Object.assign(new Error('登录状态或聊天已变化，请重新打开页面。'), { status: 409, code: 'CHAT_AUTHORITY_CHANGED' });
            for (const row of page.items) if (!rows.has(row.chatId)) rows.set(row.chatId, row);
            cursor = page.nextCursor;
            if (cursor && cursors.has(cursor)) throw new Error('聊天列表没有加载出来，请重试。');
            cursors.add(cursor);
        } while (cursor);
        return [...rows.values()].filter(row => (!groupRef || row.groupRef === groupRef) && (!kind || row.kind === kind));
    }
    async function recent(options) {
        if (getChatStorage().mode === 'ST') return request('/api/chats/recent', { metadata: true }, options);
        if (getChatStorage().mode === 'FROZEN') throw new Error('正在迁移');
        const [chats, cards] = await Promise.all([listStoredChats(options), request('/api/characters/all', {}, options)]);
        const avatars = new Map(cards.map(card => [card.data?.extensions?.vc_character_ref, card.avatar]));
        return chats.map(chat => ({ ...chat, file_id: (chat.fileName || chat.chatId + '.jsonl').replace(/\.jsonl$/, ''), file_name: chat.fileName || chat.chatId + '.jsonl',
            avatar: avatars.get(chat.characterRef) || '', chat_items: chat.messageCount, last_mes: chat.updatedAt,
            chat_metadata: { vc_f2: { id: chat.chatId, revision: chat.chatRevision }, vc_branch_root: chat.branchRoot,
                vc_binding: { chatIdentity: chat.chatId, characterRef: chat.characterRef,
                    relationshipId: chat.relationshipId, conversationId: chat.conversationId } },
        }));
    }
    const createChatStore = row => createStoredChatStore({ chatId: row.chatId || row.chatIdentity || row.file,
        authorityEpoch: getChatStorage().authorityEpoch, request: chatRequest, getStorage: getChatStorage });
    return { identity, headers, request, raw, post, documents, getChatStorage, refreshChatStorage, chatRequest, createChatStore, listStoredChats,
        saveSettings: documents.saveSettings, settingsChanged: documents.settingsChanged,
        savePreset: documents.savePreset, saveWorldbook: documents.saveWorldbook,
        settings() { return initialSettings ||= request('/api/settings/get', {}).catch(error => { initialSettings = null; throw error; }); },
        async generate(packet, options) { const response = await raw(packet.url, packet.body, options); onGenerateResponse?.(response); return checked(response); },
        async initialize() {
            if (!/^[1-9][0-9]*$/.test(identity.accountId) || !/^[1-9][0-9]*$/.test(identity.sessionId)) throw new Error('请重新打开页面。');
            const response = await fetchImpl('/csrf-token', { credentials: 'same-origin', cache: 'no-store' });
            if (!response.ok) throw new Error('登录状态已变化，请重新打开页面。');
            token = (await response.json()).token;
            if (!token) throw new Error('页面验证未完成，请重新加载。');
            await refreshChatStorage();
        },
        characters: () => request('/api/characters/all', getChatStorage().mode === 'ST' ? {} : { vc_resource_only: true }),
        recent,
        readChat: async (row, options) => {
            if (getChatStorage().mode === 'ST') return request('/api/chats/get', { avatar_url: row.avatar, file_name: row.file }, options);
            const store = createChatStore(row);
            try { return storedChatRecords(await store.loadFull(options)); } finally { store.close(); }
        },
    };
}
