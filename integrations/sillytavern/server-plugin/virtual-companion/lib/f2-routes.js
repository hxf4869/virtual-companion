// AGPL-3.0-only. 原生路由只传已认证 user / handle 与已解析的文件路径。
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { F2Error, getF2Store } from './f2-store.js';

function parseField(value, field) {
    if (typeof value !== 'string') return value;
    try { return JSON.parse(value); }
    catch { throw new F2Error(428, 'VC_REVISION_REQUIRED', `${field} 读取基线格式无效`); }
}
function importDocument(raw) {
    let chat;
    try { chat = raw.trim().split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line)); }
    catch { throw new F2Error(400, 'VC_CHAT_INVALID', '导入聊天无法完整解析'); }
    if (!chat.length || !chat[0] || typeof chat[0] !== 'object' || Array.isArray(chat[0])) {
        throw new F2Error(400, 'VC_CHAT_INVALID', '导入聊天缺少头部');
    }
    // 上传文件只携带内容，不能赋予旧身份/父基线权限。
    chat[0].chat_metadata = { ...chat[0].chat_metadata };
    delete chat[0].chat_metadata.vc_f2;
    delete chat[0].chat_metadata.vc_f2_parent;
    delete chat[0].chat_metadata.vc_branch_root;
    delete chat[0].chat_metadata.vc_binding;
    return chat;
}

export function migrateLegacyChat(userDirectories, file, chatArray) {
    return getF2Store(userDirectories.root).migrateLegacy(file, chatArray);
}

export function createF2Hooks({ getUserDirectories }) {
    const forUser = (user) => {
        if (!user?.profile?.handle || !user?.directories?.root) throw new F2Error(401, 'VC_AUTH_REQUIRED', '需要已认证宿主用户');
        return getF2Store(user.directories.root);
    };
    const relative = (user, file) => path.relative(user.directories.root, file).split(path.sep).join('/');
    const isChatFile = (user, file) => [user.directories.chats, user.directories.groupChats].filter(Boolean).some((dir) => {
        const rel = path.relative(dir, file);
        return rel && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel) && file.endsWith('.jsonl');
    });
    async function directoryChats(user, directory) {
        await forUser(user).file(directory);
        let entries;
        try { entries = await fs.readdir(directory, { withFileTypes: true }); }
        catch (error) { if (error.code === 'ENOENT') return []; throw error; }
        return entries.filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl')).map((entry) => path.join(directory, entry.name));
    }
    function baseline(request, file, hash) {
        const rows = parseField(request.body?.vc_f2_chats, 'vc_f2_chats');
        if (!Array.isArray(rows)) throw new F2Error(428, 'VC_REVISION_REQUIRED', '需要所有目标聊天的读取基线');
        const key = relative(request.user, file);
        const matches = rows.filter((row) => row?.path === key || (hash !== undefined && row?.hash === hash));
        if (matches.length !== 1 || !matches[0].expected) throw new F2Error(428, 'VC_REVISION_REQUIRED', '缺少或重复目标聊天读取基线');
        return matches[0].expected;
    }
    async function removeChats(request, files, directory) {
        const store = forUser(request.user);
        const targets = files.map((file) => typeof file === 'string' ? { path: file } : file);
        const operations = targets.map((file) => ({ kind: 'remove', file: file.path, expected: baseline(request, file.path, file.hash) }));
        const tokens = await store.mutateMany(operations, undefined, { directory });
        return targets.map((file, index) => ({ path: relative(request.user, file.path), ...(file.hash ? { hash: file.hash } : {}), vc_f2: tokens[index] }));
    }
    return {
        read(user, file) { return forUser(user).read(file); },
        async save(handle, file, chat, beforeCommit) {
            if (!handle) throw new F2Error(401, 'VC_AUTH_REQUIRED', '缺少可信宿主用户');
            const directories = getUserDirectories(handle);
            const snapshot = structuredClone(chat);
            const metadata = snapshot?.[0]?.chat_metadata;
            const expected = metadata?.vc_f2;
            const parent = metadata?.vc_f2_parent;
            if (metadata) delete metadata.vc_f2_parent;
            return getF2Store(directories.root).save(file, snapshot, { expected, parent, beforeCommit });
        },
        rename(request, from, to) {
            return forUser(request.user).rename(from, to, { expected: parseField(request.body?.vc_f2, 'vc_f2') });
        },
        remove(request, file) {
            return forUser(request.user).remove(file, { expected: parseField(request.body?.vc_f2, 'vc_f2') });
        },
        async importChat(request, file, raw, { existed, index = 0 } = {}) {
            const store = forUser(request.user);
            const field = parseField(request.body?.vc_f2, 'vc_f2');
            const expected = Array.isArray(field) ? field[index] : field;
            // existed 在原生路由解析出目标文件名的同步区间捕获，不能 await 后重判为新建。
            if (existed !== false && existed !== true) throw new F2Error(400, 'VC_CHAT_INVALID', '导入缺少目标创建状态');
            if (existed && !expected) throw new F2Error(409, 'VC_REVISION_CONFLICT', '导入目标已存在，需要明确读取基线');
            if (!existed && expected) throw new F2Error(409, 'VC_REVISION_CONFLICT', '指定覆盖目标已不存在，不能转为新建');
            return store.save(file, importDocument(raw), {
                expected: existed ? expected : { id: randomUUID(), revision: 0 },
            });
        },
        isChatFile,
        removeChats,
        async removeDirectory(request, directory) {
            const tokens = await removeChats(request, await directoryChats(request.user, directory), directory);
            // 不递归删除未知文件；目录可留空，不创建新的旁路清理机制。
            return tokens;
        },
        async renameDirectory(request, from, to, before) {
            const store = forUser(request.user);
            const files = await directoryChats(request.user, from);
            const operations = files.map((file) => ({ kind: 'rename', file, to: path.join(to, path.basename(file)), expected: baseline(request, file) }));
            const tokens = await store.mutateMany(operations, before, { directory: from });
            return operations.map((op, index) => ({ path: relative(request.user, op.file), to: relative(request.user, op.to), vc_f2: tokens[index] }));
        },
    };
}
