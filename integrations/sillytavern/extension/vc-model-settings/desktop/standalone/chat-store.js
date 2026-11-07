import { createChatHistory } from './chat-history.js';
import { buildChatOperations } from './chat-operations.js';
import { documentEqual } from '../../settings-documents.js';

const clone = value => value === undefined ? undefined : structuredClone(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const protectedKeys = new Set(['vc_f2', 'vc_binding', 'vc_branch_root', 'vc_source', 'vc_message_id']);
export function storedChatRecords({ chat, messages }) {
    return [{ ...clone(chat.header), chat_metadata: { ...clone(chat.metadata),
        vc_f2: { id: chat.chatId, revision: chat.chatRevision },
        vc_branch_root: chat.branchRoot,
        vc_binding: { ...clone(chat.header.vc_binding), ...clone(chat.metadata.vc_binding), chatIdentity: chat.chatId,
            characterRef: chat.characterRef, conversationId: chat.conversationId, relationshipId: chat.relationshipId },
    } }, ...messages.map(message => ({ ...clone(message.data), vc_message_id: message.messageId }))];
}

// Only fields unchanged since dispatch may adopt remote values. Pending edits
// retain both their value AND the original submitted before-value.
function accept(submitted, live, remote, baseline = false, key = '') {
    if (protectedKeys.has(key) || documentEqual(submitted, live)) return clone(remote);
    if (object(submitted) && object(live) && object(remote)) {
        const result = {};
        for (const name of new Set([...Object.keys(submitted), ...Object.keys(live), ...Object.keys(remote)])) {
            const value = accept(submitted[name], live[name], remote[name], baseline, name);
            if (value !== undefined) result[name] = value;
        }
        return result;
    }
    // Candidate arrays need identity writeback even while a script edits a wrapper.
    if (Array.isArray(submitted) && Array.isArray(live) && Array.isArray(remote) &&
        submitted.length === live.length && live.length === remote.length) {
        return remote.map((value, index) => accept(submitted[index], live[index], value, baseline));
    }
    return clone(baseline ? submitted : live);
}
function replace(target, value) {
    for (const key of Object.keys(target)) if (!Object.hasOwn(value, key)) delete target[key];
    Object.assign(target, value);
}
function legacy(snapshot) {
    const [header, ...messages] = storedChatRecords(snapshot);
    const { chat_metadata: metadata, ...fields } = header;
    return { header: fields, metadata, messages, title: snapshot.chat.title };
}
function candidateData(message, index) {
    const { mes, variables, ...wrapper } = message.swipe_info?.[index] || {};
    const result = { ...clone(wrapper), mes: message.swipes?.[index] ?? message.mes };
    if (message.variables?.[index] !== undefined) result.variables = clone(message.variables[index]);
    return result;
}
export function createStoredChatStore({ chatId, authorityEpoch, request, getStorage }) {
    const history = createChatHistory({ chatId, authorityEpoch, request });
    let base, failed, closed = false, queue = Promise.resolve();
    function writable() {
        if (closed) throw new Error('聊天已关闭。');
        if (failed) throw failed;
        const storage = getStorage();
        if (storage.mode !== 'GO' || storage.authorityEpoch !== authorityEpoch) {
            throw Object.assign(new Error(storage.mode === 'FROZEN' ? '正在迁移' : '登录状态或聊天已变化，请重新打开页面。'),
                { status: 409, code: 'CHAT_AUTHORITY_CHANGED' });
        }
    }
    async function loadFull(options) {
        const result = await history.loadFull(options);
        base = clone(result);
        return result;
    }
    async function commit(next, { generation, signal } = {}) {
        writable();
        if (!base) throw new Error('聊天尚未完整加载。');
        if (generation && !base.messages.length) throw Object.assign(new Error('生成输入尚未保存。'), { status: 409, code: 'CHAT_GENERATION_FENCED' });
        const { operations } = buildChatOperations(base, next, { generation });
        if (!operations.length) return;
        const submitted = clone(next);
        const ack = await request('POST', `/api/v1/chats/${encodeURIComponent(chatId)}/operations`, {
            requestId: crypto.randomUUID(), authorityEpoch, operations, ...(generation ? { generation } : {}),
        }, { signal });
        if (ack.authorityEpoch !== authorityEpoch || ack.chatId !== chatId) throw new Error('聊天保存回执不匹配。');
        const previous = new Map(base.messages.map(message => [message.messageId, message]));
        const changed = new Map(ack.changed.map(message => [message.messageId, message]));
        const liveById = new Map(next.messages.map(message => [message.vc_message_id, message]));
        const messages = submitted.messages.map(sent => {
            const id = sent.vc_message_id;
            const dto = changed.get(id) || previous.get(id);
            if (!dto) throw new Error('聊天保存回执缺少消息。');
            const live = liveById.get(id);
            const data = accept(sent, live || sent, { ...dto.data, vc_message_id: id }, true);
            if (live) replace(live, accept(sent, live, { ...dto.data, vc_message_id: id }));
            const candidates = dto.candidates.map((candidate, index) =>
                ({ ...clone(candidate), data: candidateData(data, index) }));
            const pendingSelection = live && (live.swipe_id !== sent.swipe_id || live.swipes?.length !== sent.swipes?.length);
            return { ...clone(dto), data, candidates,
                selectedCandidateId: candidates[data.swipe_id ?? 0]?.candidateId || dto.selectedCandidateId,
                messageRevision: (!live || pendingSelection) && previous.has(id) ? previous.get(id).messageRevision : dto.messageRevision,
            };
        });
        const ackChat = ack.chat || { ...base.chat, chatRevision: ack.chatRevision,
            metadataRevision: ack.metadataRevision, orderRevision: ack.orderRevision };
        const remote = legacy({ chat: ackChat, messages: [] });
        const header = accept(submitted.header, next.header, remote.header, true);
        const metadata = accept(submitted.metadata, next.metadata, remote.metadata, true);
        replace(next.header, accept(submitted.header, next.header, remote.header));
        replace(next.metadata, accept(submitted.metadata, next.metadata, remote.metadata));
        const pendingOrder = !documentEqual(submitted.messages.map(message => message.vc_message_id), next.messages.map(message => message.vc_message_id));
        base = { chat: { ...clone(ackChat), header, metadata, messageCount: messages.length,
            orderRevision: pendingOrder ? base.chat.orderRevision : ackChat.orderRevision }, messages };
        // Do not advance history's cursor to ack.chatRevision: unrelated appends
        // need to be read through changes before assembling the next prompt.
        return ack;
    }
    return { chatId, authorityEpoch, readDisplay: options => history.loadDisplay(options), loadFull,
        snapshot: () => clone(base),
        save(next, options) {
            const pending = queue.then(() => commit(next, options));
            queue = pending.catch(error => { failed = error; });
            return pending;
        },
        async sync(next, options) {
            await queue;
            // Unsaved local changes are never silently rebased by a read.
            if (buildChatOperations(base, next).operations.length) throw Object.assign(new Error('聊天仍有未保存的修改。'), { status: 409, code: 'REVISION_CONFLICT' });
            const prior = base;
            const result = await history.loadFull(options);
            if (buildChatOperations(prior, next).operations.length) throw Object.assign(new Error('聊天仍有未保存的修改。'), { status: 409, code: 'REVISION_CONFLICT' });
            base = clone(result);
            return result;
        },
        generation(input) {
            writable();
            const message = base.messages.find(message => message.messageId === input.vc_message_id);
            if (!message) throw new Error('生成输入尚未保存。');
            return { chatId, requestId: crypto.randomUUID(), generationRunId: crypto.randomUUID(), authorityEpoch,
                chatRevision: base.chat.chatRevision, inputMessageId: message.messageId, inputCandidateId: message.selectedCandidateId };
        },
        close() { closed = true; history.close(); },
    };
}
