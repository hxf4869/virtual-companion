// 引擎就绪前直接读 ST 服务端接口（会话列表、历史先行）。ADR-0011 §1、MB-0 报告第 3 节。
// 写请求带 Go 身份头与 CSRF；页面首次取得的身份固定，登录变化后要求整页重载。
import {BACKGROUND_FIELD,backgroundFile} from '../theme/background.mjs';

export class ServerError extends Error {
    constructor(status, path) { super(`HTTP ${status} ${path}`); this.status = status; this.path = path; if(status===401||status===409)this.kind='context-changed'; }
}

export function stripJsonl(name) {
    return String(name || '').replace(/\.jsonl$/i, '');
}

// 与锁定 ST timestampToMoment 对当前 humanized 格式的解释保持一致（按 UTC 解析）。
export function toDate(value) {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    const text = String(value ?? '');
    const native = /^(\d{4})-(\d{1,2})-(\d{1,2})\s?@(\d{1,2})h\s?(\d{1,2})m\s?(\d{1,2})s(?:\s?(\d{1,3})ms)?$/.exec(text);
    let d;
    if (native) {
        const [,y,mon,day,h,min,sec,ms='0'] = native;
        d = new Date(Date.UTC(+y,+mon-1,+day,+h,+min,+sec,+ms.padStart(3,'0')));
    } else d = new Date(typeof value === 'number' || /^\d+$/.test(text) ? Number(value) : Date.parse(text));
    return Number.isNaN(d.getTime()) ? null : d;
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
        ...(row?.extra ? { extra: row.extra } : {}),
    };
}

export function createServer({ fetchImpl = (...a) => fetch(...a) } = {}) {
    let identity = null;
    let csrf = '';

    async function headers() {
        if (!identity) {
            identity = (async () => {
                const r = await fetchImpl('/auth/api/session', { headers: { Accept: 'application/json' } });
                if (!r.ok) throw new ServerError(r.status, '/auth/api/session');
                const j = await r.json();
                return { accountId: String(j.accountId), sessionId: String(j.sessionId) };
            })().catch(error=>{identity=null;throw error;});
        }
        const expected=await identity;
        if (!csrf) {
            const r = await fetchImpl('/csrf-token');
            if (!r.ok) throw new ServerError(r.status, '/csrf-token');
            csrf = (await r.json()).token;
        }
        return {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrf,
            'x-vc-expected-account-id': expected.accountId,
            'x-vc-expected-session-id': expected.sessionId,
        };
    }

    async function post(path, body, {form=false,text=false}={}) {
        const requestHeaders=await headers();if(form)delete requestHeaders['Content-Type'];
        const r = await fetchImpl(path, { method: 'POST', headers: requestHeaders, body: form?body:JSON.stringify(body ?? {}) });
        if (r.status === 409 || r.status === 401) csrf = '';
        if (!r.ok) throw new ServerError(r.status, path);
        return text?r.text():r.json();
    }

    return {
        characters: () => post('/api/characters/all', {}),
        async backgrounds(){return (await post('/api/backgrounds/all',{})).images.map(image=>image.filename).filter(backgroundFile);},
        async uploadBackground(file){const form=new FormData();form.append('avatar',file,file.name);return post('/api/backgrounds/upload',form,{form:true,text:true});},
        saveCharacterBackground:(avatar,file)=>post('/api/characters/merge-attributes',{avatar,data:{extensions:{[BACKGROUND_FIELD]:backgroundFile(file)}}},{text:true}),
        async recentChats(max = 50) {
            const rows = await post('/api/chats/recent', { max, metadata: true });
            return (Array.isArray(rows) ? rows : []).filter((r) => r.avatar).map((r) => ({
                avatar: r.avatar,
                file: stripJsonl(r.file_name),
                preview: String(r.mes ?? ''),
                updated: toDate(r.last_mes)?.getTime() || 0,
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
