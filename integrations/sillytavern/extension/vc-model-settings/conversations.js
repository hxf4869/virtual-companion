// 会话列表：陪伴实例来自 instance-page 同一接口（GET /api/v1/relationships → instancesFrom），
// 再与 ST 聊天文件合并。最后一条消息和时间只在调用方已经拿到时附上。没有预览时列表显示「暂无消息」。
// 头像优先用当前会话快照，否则用同名或同角色引用的角色卡头像；都没有才用首字。
// 同一关系只保留一行；同一个聊天文件也只保留一行。
// 聊天目录已经列全时，几秒内连着创建的同名分身不再占第二行：没有自己的聊天文件，
// 或者两份文件的最后一句相同（选中角色时自动开的聊天，和紧接着打开的那份）。
// 隔开一段时间另建的实例，或最后一句已经不同的两份聊天，各自一行；看起来一样时才加序号（外壳 · 2）。
import { instancesFrom, safeImageUrl } from './instance-page.js';
import { pendingInboxWrites } from './chat-shell.js';

export const EMPTY_CONVERSATIONS_COPY = '还没有会话';
export const CONVERSATIONS_ERROR_COPY = '会话没有加载出来';
export const CONVERSATIONS_RETRY_LABEL = '重试';
export const CONVERSATIONS_EMPTY_ACTION = '去角色页';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[ch]));

// 打开角色时可能在这一小段里连打两次绑定，后一次才写进聊天文件。
const SHADOW_TWIN_MS = 5000;
const EMPTY_PREVIEW = new Set(['[The chat is empty]', '[The message is empty]']);

export function avatarUrl(file) {
    const value = String(file || '').trim();
    if (!value) return '';
    const safe = safeImageUrl(value);
    if (safe) return safe;
    return `/thumbnail?type=avatar&file=${encodeURIComponent(value)}`;
}

export function formatConversationTime(value) {
    if (value == null || value === '') return '';
    const raw = String(value).trim();
    if (!raw) return '';
    const parsed = Date.parse(raw.replace('@', ' '));
    if (Number.isNaN(parsed)) return raw;
    try {
        const date = new Date(parsed);
        const now = new Date();
        const sameDay = date.getFullYear() === now.getFullYear()
            && date.getMonth() === now.getMonth()
            && date.getDate() === now.getDate();
        return new Intl.DateTimeFormat('zh-CN', sameDay
            ? { hour: '2-digit', minute: '2-digit' }
            : { month: 'numeric', day: 'numeric' }).format(date);
    } catch {
        return raw;
    }
}

function textField(value) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    return trimmed;
}

export function chatSnapshotsFromRecent(list) {
    const snaps = [];
    for (const item of Array.isArray(list) ? list : []) {
        const binding = item?.chat_metadata?.vc_binding;
        if (binding?.relationshipId == null || binding.relationshipId === '') continue;
        const snap = { relationshipId: String(binding.relationshipId) };
        const file = textField(item.file_id) || textField(item.file_name).replace(/\.jsonl$/i, '');
        if (file) snap.file = file;
        const characterRef = textField(binding.characterRef);
        if (characterRef) snap.characterRef = characterRef;
        const avatar = textField(item.avatar);
        if (avatar) snap.avatar = avatar;
        const preview = textField(item.mes);
        if (preview && !EMPTY_PREVIEW.has(preview)) snap.preview = preview.split('\n')[0].trim();
        if (typeof item.last_mes === 'number' && Number.isFinite(item.last_mes)) snap.time = new Date(item.last_mes).toISOString();
        else if (item.last_mes) snap.time = item.last_mes;
        snaps.push(snap);
    }
    return snaps;
}

export async function loadRecentChatSnapshots(loadNative, fetchImpl = globalThis.fetch) {
    const native = typeof loadNative === 'function' ? await loadNative() : {};
    const headers = { 'Content-Type': 'application/json' };
    if (typeof native?.getRequestHeaders === 'function') Object.assign(headers, native.getRequestHeaders());
    const response = await fetchImpl('/api/chats/recent', {
        method: 'POST',
        headers,
        credentials: 'same-origin',
        body: JSON.stringify({ metadata: true }),
    });
    if (!response?.ok) throw new Error('recent chats unavailable');
    return chatSnapshotsFromRecent(await response.json());
}

export function chatSnapshotFromContext(context) {
    const binding = context?.chatMetadata?.vc_binding;
    if (binding?.relationshipId == null || binding.relationshipId === '') return null;
    const characters = Array.isArray(context.characters) ? context.characters : [];
    const index = Number(context.characterId);
    const card = Number.isInteger(index) ? characters[index] : null;
    const messages = Array.isArray(context.chat) ? context.chat : [];
    let last = null;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
        const message = messages[i];
        if (!message || message.is_system) continue;
        if (typeof message.mes !== 'string' || !message.mes.trim()) continue;
        last = message;
        break;
    }
    const snap = { relationshipId: String(binding.relationshipId) };
    const characterRef = card?.data?.extensions?.vc_character_ref;
    if (typeof characterRef === 'string' && characterRef) snap.characterRef = characterRef;
    if (Number.isInteger(index) && index >= 0 && card) snap.characterIndex = index;
    const file = typeof context.chatId === 'string' && context.chatId
        ? context.chatId
        : (typeof card?.chat === 'string' ? card.chat : '');
    if (file) snap.file = file;
    const characterName = textField(card?.name);
    if (characterName) snap.characterName = characterName;
    if (typeof card?.avatar === 'string' && card.avatar.trim()) snap.avatar = card.avatar.trim();
    if (last) {
        const preview = last.mes.trim().split('\n')[0].trim();
        if (preview) snap.preview = preview;
        const time = last.send_date || last.extra?.send_date || '';
        if (time) snap.time = time;
    }
    return snap;
}

function rawRelationships(relationships) {
    const raw = new Map();
    for (const row of Array.isArray(relationships) ? relationships : []) {
        if (row?.relationshipId == null || row.relationshipId === '') continue;
        raw.set(String(row.relationshipId), row);
    }
    return raw;
}

function matchingCard(characters, row) {
    const cards = Array.isArray(characters) ? characters : [];
    const ref = textField(row?.characterRef);
    if (ref) {
        const byRef = cards.find((card) => textField(card?.data?.extensions?.vc_character_ref) === ref);
        if (byRef) return byRef;
    }
    const names = new Set([textField(row?.name), textField(row?.instanceName)]
        .filter((value) => value && value !== '未命名实例'));
    if (!names.size) return null;
    return cards.find((card) => names.has(textField(card?.name))) || null;
}

function createdMs(value) {
    const parsed = Date.parse(String(value ?? '').trim());
    return Number.isNaN(parsed) ? NaN : parsed;
}

function sameShadow(left, right) {
    const instLeft = textField(left?.instanceName);
    const instRight = textField(right?.instanceName);
    if (!instLeft || instLeft !== instRight) return false;
    const refLeft = textField(left?.characterRef);
    const refRight = textField(right?.characterRef);
    if (refLeft && refRight) return refLeft === refRight;
    const nameLeft = textField(left?.name);
    const nameRight = textField(right?.name);
    if (nameLeft && nameRight && nameLeft !== nameRight) return false;
    return true;
}

function fileKey(row) {
    const file = textField(row?.file);
    if (!file) return '';
    return `${textField(row.characterRef) || textField(row.avatar) || textField(row.name)}\n${file}`;
}

function dropSharedFiles(rows) {
    const kept = [];
    const indexByFile = new Map();
    for (const row of rows) {
        const key = fileKey(row);
        if (!key) {
            kept.push(row);
            continue;
        }
        const index = indexByFile.get(key);
        if (index == null) {
            indexByFile.set(key, kept.length);
            kept.push(row);
            continue;
        }
        const prior = kept[index];
        if (!textField(prior.preview) && textField(row.preview)) prior.preview = row.preview;
        if (!textField(prior.time) && textField(row.time)) prior.time = row.time;
    }
    return kept;
}

function dropShadowTwins(rows) {
    const backed = rows.filter((row) => textField(row.file));
    return rows.filter((row) => {
        if (textField(row.file)) return true;
        const mine = createdMs(row.createdAt);
        if (Number.isNaN(mine)) return true;
        return !backed.some((other) => {
            if (!sameShadow(row, other)) return false;
            const theirs = createdMs(other.createdAt);
            if (Number.isNaN(theirs)) return false;
            return Math.abs(mine - theirs) <= SHADOW_TWIN_MS;
        });
    });
}

function echoTwin(left, right) {
    const preview = textField(left?.preview);
    if (!preview || preview !== textField(right?.preview)) return false;
    if (!textField(left?.file) || !textField(right?.file)) return false;
    if (!sameShadow(left, right)) return false;
    const mine = createdMs(left?.createdAt);
    const theirs = createdMs(right?.createdAt);
    if (Number.isNaN(mine) || Number.isNaN(theirs)) return false;
    return Math.abs(mine - theirs) <= SHADOW_TWIN_MS;
}

function dropEchoTwins(rows) {
    const kept = [];
    for (const row of rows) {
        const index = kept.findIndex((other) => echoTwin(row, other));
        if (index < 0) {
            kept.push(row);
            continue;
        }
        if (createdMs(row.createdAt) > createdMs(kept[index].createdAt)) kept[index] = row;
    }
    return kept;
}

function applyDisambiguators(rows) {
    const groups = new Map();
    for (const row of rows) {
        const key = `${textField(row?.name)}\n${textField(row?.instanceName)}`;
        const list = groups.get(key) || [];
        list.push(row);
        groups.set(key, list);
    }
    for (const list of groups.values()) {
        if (list.length < 2) continue;
        list.forEach((row, index) => {
            if (index > 0) row.disambiguator = String(index + 1);
        });
    }
}

export function conversationRows(relationships, { chats = [], chatsComplete = false, inboxRows = [], characters = [] } = {}) {
    const byId = new Map();
    for (const chat of Array.isArray(chats) ? chats : []) {
        if (chat?.relationshipId == null || chat.relationshipId === '') continue;
        const id = String(chat.relationshipId);
        const prev = byId.get(id);
        if (prev && textField(prev.file) && !textField(chat.file)) continue;
        byId.set(id, chat);
    }
    const raw = rawRelationships(relationships);
    const seen = new Set();
    const rows = [];
    for (const instance of instancesFrom(relationships)) {
        if (seen.has(instance.relationshipId)) continue;
        seen.add(instance.relationshipId);
        const chat = byId.get(instance.relationshipId);
        const row = {
            relationshipId: instance.relationshipId,
            instanceName: instance.name,
        };
        const createdAt = raw.get(instance.relationshipId)?.createdAt;
        if (createdAt) row.createdAt = createdAt;
        const characterName = textField(chat?.characterName);
        if (characterName) row.name = characterName;
        const avatar = textField(chat?.avatar);
        if (avatar) row.avatar = avatar;
        const preview = textField(chat?.preview);
        if (preview) row.preview = preview.split('\n')[0].trim();
        const time = formatConversationTime(chat?.time);
        if (time) row.time = time;
        const file = textField(chat?.file);
        if (file) row.file = file;
        if (Number.isInteger(chat?.characterIndex) && chat.characterIndex >= 0) row.characterIndex = chat.characterIndex;
        const characterRef = textField(chat?.characterRef);
        if (characterRef) row.characterRef = characterRef;
        const card = matchingCard(characters, row);
        if (card) {
            if (!textField(row.name) && textField(card.name)) row.name = textField(card.name);
            if (!textField(row.avatar) && textField(card.avatar)) row.avatar = textField(card.avatar);
            if (!textField(row.characterRef)) {
                const ref = textField(card.data?.extensions?.vc_character_ref);
                if (ref) row.characterRef = ref;
            }
        }
        if (pendingInboxWrites(inboxRows, { relationshipId: instance.relationshipId }).length > 0) row.unread = true;
        rows.push(row);
    }
    const unique = dropSharedFiles(rows);
    const visible = chatsComplete ? dropEchoTwins(dropShadowTwins(unique)) : unique;
    applyDisambiguators(visible);
    return visible;
}

export function conversationTitle(row) {
    const name = textField(row?.name);
    const inst = textField(row?.instanceName);
    const mark = textField(row?.disambiguator);
    const title = name || inst;
    if (!inst) return { name: mark ? `${title} · ${mark}` : title, inst: '' };
    return { name: title, inst: mark ? `${inst} · ${mark}` : inst };
}

function avatarHtml(row, title) {
    const src = avatarUrl(row?.avatar);
    if (src) return `<img class="vc-convo-avatar" alt="" src="${esc(src)}" data-fly-from>`;
    const letter = [...title.name][0] || '';
    return `<span class="vc-convo-avatar" aria-hidden="true" data-fly-from>${esc(letter)}</span>`;
}

export function renderConversationRow(row) {
    const title = conversationTitle(row);
    const label = [title.name, title.inst, row?.unread ? '未读' : ''].filter(Boolean).join('，');
    const time = textField(row?.time);
    const preview = textField(row?.preview) || '暂无消息';
    return `<button type="button" class="vc-cell vc-convo" data-relationship-id="${esc(row?.relationshipId || '')}" aria-label="${esc(label)}"><span class="vc-convo-avatar-slot">${avatarHtml(row, title)}</span><span class="vc-grow"><span class="vc-convo-top"><span class="vc-convo-name">${esc(title.name)}</span>${title.inst ? `<span class="vc-convo-inst">${esc(title.inst)}</span>` : ''}${time ? `<span class="vc-convo-time vc-num">${esc(time)}</span>` : ''}</span><span class="vc-convo-preview">${esc(preview)}</span></span>${row?.unread ? '<i class="vc-convo-unread" aria-hidden="true"></i>' : ''}</button>`;
}

export function renderConversationRows(rows) {
    return (Array.isArray(rows) ? rows : []).map((row) => renderConversationRow(row)).join('');
}

export function renderConversationEmpty() {
    return `<div class="vc-empty"><span data-empty-icon></span><p>${EMPTY_CONVERSATIONS_COPY}</p><button type="button" class="vc-btn vc-btn-fill" data-goto="characters">${CONVERSATIONS_EMPTY_ACTION}</button></div>`;
}

export function renderConversationError() {
    return `<div class="vc-empty"><span data-empty-icon></span><p>${CONVERSATIONS_ERROR_COPY}</p><button type="button" class="vc-btn vc-btn-fill" data-retry>${CONVERSATIONS_RETRY_LABEL}</button></div>`;
}
