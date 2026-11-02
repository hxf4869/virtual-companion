import { loadRecentChatSnapshots } from './conversations.js';
import { messageInstant } from './chat-compose.js';

const fileName = value => String(value || '').replace(/\.jsonl$/i, '');
const currentFile = context => fileName(context.getCurrentChatId?.() || context.chatId);

// 记忆/收藏共用原生打开路径；先确定正确的聊天文件，再按持久消息 ID 找楼层。
export async function openMessageSource(detail, { getContext, openConversation, loadNative,
    loadChats = () => loadRecentChatSnapshots(loadNative), document: doc = globalThis.document } = {}) {
    const relationshipId = String(detail?.relationshipId || '');
    const identity = String(detail?.chatIdentity || '');
    const file = fileName(detail?.chatFile);
    if (!relationshipId || (!identity && !file)) throw new Error('source-unavailable');
    const before = getContext();
    const sameRelationship = String(before.chatMetadata?.vc_binding?.relationshipId || '') === relationshipId;
    const alreadyHere = sameRelationship && (identity ? before.chatMetadata?.vc_f2?.id === identity : currentFile(before) === file);
    const target = alreadyHere ? { relationshipId, file: currentFile(before) }
        : (await loadChats()).find(row => String(row.relationshipId) === relationshipId
            && (identity ? row.chatIdentity === identity : fileName(row.file) === file));
    if (!target?.file) throw new Error('source-unavailable');
    if (!await openConversation(target)) throw new Error('source-open-failed');
    const native = await loadNative();
    if (currentFile(getContext()) !== fileName(target.file)) {
        if (typeof native.openCharacterChat !== 'function') throw new Error('source-open-unavailable');
        await native.openCharacterChat(fileName(target.file));
    }
    const context = getContext();
    if (String(context.chatMetadata?.vc_binding?.relationshipId || '') !== relationshipId
        || (identity && context.chatMetadata?.vc_f2?.id !== identity)) throw new Error('source-changed');
    const stableId = detail.messageId == null ? '' : String(detail.messageId);
    let mesId = -1;
    if (stableId) {
        mesId = context.chat.findIndex(message => message.vc_message_id === stableId);
        // 旧样板来源用数字楼层；真实 UUID 消息找不到时不退回其他消息。
        if (mesId === -1 && /^\d+$/.test(stableId)) mesId = detail.mesId;
    } else {
        // 收藏契约保存快照而非持久消息 ID；楼层在删除消息后会移动，不能直接信任。
        const at = messageInstant(detail.messageAt);
        const matches = at ? context.chat.flatMap((message, index) =>
            !message.is_system && messageInstant(message.send_date) === at
                && (message.is_user ? 'user' : 'character') === detail.role
                && Array.from(String(message.mes || '').trim()).slice(0, 2000).join('') === detail.body
                ? [index] : []) : [];
        if (matches.length === 1) mesId = matches[0];
    }
    if (!Number.isInteger(mesId) || mesId < 0 || mesId >= context.chat.length) throw new Error('source-message-unavailable');
    const first = doc?.querySelector('#chat > .mes')?.getAttribute('mesid');
    if (first != null && Number(first) > mesId && typeof native.showMoreMessages === 'function') {
        await native.showMoreMessages(Number(first) - mesId);
    }
    return mesId;
}
