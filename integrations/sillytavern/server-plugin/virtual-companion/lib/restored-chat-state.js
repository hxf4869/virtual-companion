// AGPL-3.0-only. Trusted local restore evidence shared by F2 and native routing.
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
const unavailable = () => Object.assign(new Error('恢复聊天身份不可用'), { status: 503, code: 'VC_CHAT_CORRUPT' });
export async function readRestoredArchive(root, file) {
    const directory = path.join(root, '.vc-f2');
    try {
        const stat = await fs.lstat(directory);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw unavailable();
        const handle = await fs.open(path.join(directory, file), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
            const info = await handle.stat();
            if (!info.isFile() || info.size > 32 << 20) throw unavailable();
            return JSON.parse(await handle.readFile('utf8'));
        } finally { await handle.close(); }
    } catch (error) { if (error.code === 'ENOENT') return null; throw unavailable(); }
}
export function liveIdentitySets(snapshot) {
    const messages = new Set(), candidates = new Set();
    for (const row of snapshot.slice(1)) {
        if (row.vc_message_id) messages.add(row.vc_message_id);
        const count = Array.isArray(row.swipes) ? row.swipes.length : 0;
        for (const source of [row.extra?.vc_source, ...(Array.isArray(row.swipe_info) ? row.swipe_info.slice(0, count) : []).map((info) => info?.extra?.vc_source)]) if (source?.id) candidates.add(source.id);
    }
    return { messages, candidates };
}
export async function assertRestoredIdentities(root, chatId, snapshot, record) {
    const manifest = await readRestoredArchive(root, 'migration-manifest.archive');
    const chat = manifest?.chats?.find((chat) => chat.oldIdentity === chatId);
    if (manifest?.formatVersion !== 1 || manifest.direction !== 'GO_TO_ST' || !Array.isArray(chat?.messageAndCandidateIdentityRecords)) throw unavailable();
    const messages = new Set(record.deletedMessageIds || []), candidates = new Set(record.deletedCandidateIds || []);
    for (const message of chat.messageAndCandidateIdentityRecords) {
        if (message.deleted) messages.add(message.messageId);
        for (const candidate of message.candidates) if (message.deleted || candidate.deleted) candidates.add(candidate.candidateId);
    }
    const live = liveIdentitySets(snapshot);
    if ([...live.messages].some((id) => messages.has(id)) || [...live.candidates].some((id) => candidates.has(id))) {
            throw Object.assign(new Error('聊天身份已删除'), { status: 409, code: 'VC_CHAT_DELETED' });
    }
}
