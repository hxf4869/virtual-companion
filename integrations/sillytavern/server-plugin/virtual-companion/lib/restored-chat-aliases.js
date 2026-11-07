// AGPL-3.0-only. Compatibility for operator-restored archives, inside ST admission.
import fs from 'node:fs/promises';
import path from 'node:path';
import { F2Error, getF2Store } from './f2-store.js';
import { readRestoredArchive as archive } from './restored-chat-state.js';

export const RESTORED_ALIAS_EXPECTATION = Symbol('restored-chat-alias-expectation');
const bad = () => new F2Error(503, 'VC_CHAT_CORRUPT', '恢复聊天身份不可用');
function name(value) {
    if (typeof value !== 'string' || !value || /[\\/\0]/.test(value) || value === '.' || value === '..') throw bad();
    return value;
}
const routes = new Map([
    ['/api/chats/get', ['file_name', false]], ['/api/chats/save', ['file_name', false]],
    ['/api/chats/delete', ['chatfile', true]], ['/api/chats/rename', ['original_file', true]],
    ['/api/chats/export', ['file', true]],
    ['/api/chats/group/get', ['id', false]], ['/api/chats/group/save', ['id', false]],
    ['/api/chats/group/delete', ['id', false]], ['/api/chats/group/info', ['id', false]],
]);
export function nativeChatTextExport(chat) {
    return chat.filter((row) => !row.is_system && row.mes).map((row) => `${row.name}: ${(row.extra?.display_text || row.mes || '').replace(/\r?\n/g, '\n')}\n\n`).join('');
}

export async function resolveRestoredChatAlias(req, res, pathname) {
    const route = routes.get(pathname);
    if (!route || !req.body?.[route[0]]) return false;
    const root = await fs.realpath(req.user.directories.root);
    const manifest = await archive(root, 'migration-manifest.archive');
    if (!manifest) return false;
    const resources = await archive(root, 'migration-resources.archive');
    if (manifest.formatVersion !== 1 || manifest.direction !== 'GO_TO_ST' || manifest.ownerAccountId !== req.vcIdentity.accountId || !Array.isArray(manifest.chats)
        || resources?.version !== 1 || resources.ownerAccountId !== manifest.ownerAccountId || resources.runId !== manifest.migrationRunId) throw bad();
    const group = pathname.includes('/group/') || Boolean(req.body.is_group);
    const physical = group ? 'group chats' : `chats/${name(String(req.body.avatar_url).replace('.png', ''))}`;
    const requested = name(String(req.body[route[0]]));
    const alias = route[1] ? (requested.endsWith('.jsonl') ? requested : requested + '.jsonl') : requested + '.jsonl';
    const store = getF2Store(root);
    const { match, reserved } = await store.run(async (records) => {
        const matches = [];
        const reserved = new Map();
        for (const chat of manifest.chats) {
            const directory = chat.kind === 'GROUP' ? 'group chats' : `chats/${name(resources.characterDirectories?.[chat.characterRef])}`;
            if (directory !== physical) continue;
            const record = records.get(chat.oldIdentity);
            if (!record) throw bad();
            const aliases = new Set([chat.primaryFileName, ...(chat.aliases || [])].map(name));
            for (const relative of [...(record.aliases || []), record.path]) {
                await store.file(relative);
                if (path.posix.dirname(relative) !== directory) throw bad();
                aliases.add(path.posix.basename(relative));
            }
            for (const alias of aliases) {
                const owners = reserved.get(alias) || new Set();
                owners.add(chat.oldIdentity); reserved.set(alias, owners);
            }
            if (aliases.has(alias)) matches.push({ chat, record });
        }
        if (matches.length > 1) throw new F2Error(409, 'VC_REVISION_CONFLICT', '恢复聊天别名不唯一');
        return { match: matches[0], reserved };
    });
    if (pathname === '/api/chats/rename') {
        const destination = name(String(req.body.renamed_file || ''));
        if ([...(reserved.get(destination) || [])].some((owner) => owner !== match?.chat.oldIdentity)) throw new F2Error(409, 'VC_REVISION_CONFLICT', '恢复聊天别名已保留');
    }
    if (!match) return false;
    if (match.chat.state === 'deleted' || match.record.state === 'deleted') throw new F2Error(409, 'VC_CHAT_DELETED', '聊天身份已删除');
    const expectedIdentity = match.chat.oldIdentity;
    const target = await store.file(match.record.path);
    if (pathname.endsWith('/save') && req.body.chat?.[0]?.chat_metadata?.vc_f2?.id !== expectedIdentity) throw new F2Error(409, 'VC_REVISION_CONFLICT', '恢复聊天身份与保存基线不符');
    if (pathname === '/api/chats/export') {
        const snapshot = await store.read(target, { expectedIdentity, withRaw: true });
        res.status(200).json({ message: `Chat saved to ${req.body.exportfilename}`, result: req.body.format === 'jsonl' ? snapshot.raw : nativeChatTextExport(snapshot.chat) });
        return true;
    }
    if (pathname === '/api/chats/group/info') {
        const chat = await store.read(target, { expectedIdentity });
        const last = chat.at(-1) || {};
        const canonical = path.basename(target);
        res.json({ file_id: canonical.slice(0, -6), file_name: canonical, chat_items: Math.max(0, chat.length - 1), chat_metadata: chat[0]?.chat_metadata || {}, mes: last.mes || '[The message is empty]', last_mes: last.send_date || '', match: true });
        return true;
    }
    const canonical = path.basename(target);
    req.body[route[0]] = route[1] ? canonical : canonical.slice(0, -6);
    // Request-local clone: ST user/profile objects may be shared across requests.
    req.user = { ...req.user, [RESTORED_ALIAS_EXPECTATION]: { path: target, expectedIdentity } };
    return false;
}
