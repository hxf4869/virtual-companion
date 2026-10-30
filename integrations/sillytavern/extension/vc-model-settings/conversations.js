// 会话列表：陪伴实例来自 instance-page 同一接口（GET /api/v1/relationships → instancesFrom）。
// 最后一条消息和时间只在调用方已经拿到时附上，不编造预览。
// 头像优先用当前会话快照，否则用同名或同角色引用的角色卡头像；都没有才用首字。
// 同一关系只保留一行。两个实例看起来一样时，只在确实重名时加序号（外壳 · 2），不显示创建时间或内部 ID。
import { instancesFrom, safeImageUrl } from './instance-page.js';
import { pendingInboxWrites } from './chat-shell.js';

export const EMPTY_CONVERSATIONS_COPY = '还没有会话';
export const CONVERSATIONS_ERROR_COPY = '会话没有加载出来';
export const CONVERSATIONS_RETRY_LABEL = '重试';
export const CONVERSATIONS_EMPTY_ACTION = '去角色页';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[ch]));

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

export function conversationRows(relationships, { chats = [], inboxRows = [], characters = [] } = {}) {
    const byId = new Map();
    for (const chat of Array.isArray(chats) ? chats : []) {
        if (chat?.relationshipId == null || chat.relationshipId === '') continue;
        byId.set(String(chat.relationshipId), chat);
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
    applyDisambiguators(rows);
    return rows;
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
    const preview = textField(row?.preview);
    return `<button type="button" class="vc-cell vc-convo" data-relationship-id="${esc(row?.relationshipId || '')}" aria-label="${esc(label)}"><span class="vc-convo-avatar-slot">${avatarHtml(row, title)}</span><span class="vc-grow"><span class="vc-convo-top"><span class="vc-convo-name">${esc(title.name)}</span>${title.inst ? `<span class="vc-convo-inst">${esc(title.inst)}</span>` : ''}${time ? `<span class="vc-convo-time vc-num">${esc(time)}</span>` : ''}</span>${preview ? `<span class="vc-convo-preview">${esc(preview)}</span>` : ''}</span>${row?.unread ? '<i class="vc-convo-unread" aria-hidden="true"></i>' : ''}</button>`;
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
