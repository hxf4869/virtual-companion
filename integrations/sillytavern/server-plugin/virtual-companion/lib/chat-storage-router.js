import fs from 'node:fs/promises';
import path from 'node:path';
import { isLegacyChatRoute, normalizeNativeApiPath } from './legacy-chat-routes.js';
import { resolveRestoredChatAlias } from './restored-chat-aliases.js';

const BRIDGE = Symbol.for('virtual-companion.bridge');

async function reject(req, res, status, code) {
    // Global multer has already run. Only remove this request's private upload,
    // never a body-supplied path or anything outside the authenticated root.
    const root = req.user?.directories?.root;
    const upload = req.file?.path;
    if (root && upload && path.dirname(path.resolve(upload)) === path.resolve(root, '.uploads')) {
        const directory = await fs.lstat(path.resolve(root, '.uploads'));
        if (directory.isDirectory() && !directory.isSymbolicLink()) {
            await fs.unlink(upload).catch((error) => { if (error.code !== 'ENOENT') throw error; });
        }
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.status(status).json({ code });
}

async function runHandler(handler, receiver, req, res, next, pathname) {
    const bridge = globalThis[BRIDGE];
    const hint = req.vcChatStorage;
    if (!req.vcIdentity?.accountId || !hint || !['ST', 'FROZEN', 'GO'].includes(hint.mode)
        || typeof hint.authorityEpoch !== 'string' || !/^[1-9][0-9]*$/.test(hint.authorityEpoch)) {
        return reject(req, res, 503, 'SCHEMA_UNAVAILABLE');
    }
    if (hint.mode === 'GO') {
        if (bridge?.nativeChat) return await bridge.nativeChat(req, res, () => reject(req, res, 409, 'CHAT_AUTHORITY_CHANGED'));
        return reject(req, res, 409, 'CHAT_AUTHORITY_CHANGED');
    }
    if (hint.mode === 'FROZEN') return reject(req, res, 409, 'CHAT_AUTHORITY_CHANGED');
    if (!bridge?.chatStorageGate) return reject(req, res, 503, 'SCHEMA_UNAVAILABLE');
    const release = bridge.chatStorageGate.enter(req.vcIdentity.accountId);
    if (!release) return reject(req, res, 409, 'CHAT_AUTHORITY_CHANGED');

    // The locked backup endpoint calls download(path) without awaiting it.
    // Its actual file-transfer callback joins the handler lifetime. Other
    // supported endpoints read into memory before sending their response.
    const download = res.download;
    let transfer;
    if (pathname === '/api/backups/chat/download') {
        res.download = function (file) {
            transfer = new Promise((resolve, rejectTransfer) => {
                download.call(this, file, (error) => {
                    if (error && error.code !== 'ECONNABORTED' && error.syscall !== 'write') rejectTransfer(error);
                    else resolve();
                });
            });
            // The handler may still be awaiting other work when transfer fails.
            transfer.catch(() => {});
            return this;
        };
    }
    try {
        try { if (await resolveRestoredChatAlias(req, res, pathname)) return; }
        catch (error) {
            if (String(error?.code || '').startsWith('VC_')) return reject(req, res, error.status || 503, error.code);
            throw error;
        }
        return await handler.call(receiver, req, res, next);
    } finally {
        try { if (transfer) await transfer; }
        finally {
            if (pathname === '/api/backups/chat/download') res.download = download;
            // A save admitted before freeze can enqueue its throttled backup
            // after onClose has already flushed the earlier pending work.
            if (bridge.chatStorageGate.status(req.vcIdentity.accountId).closed) bridge.flushChatBackups?.(req.vcIdentity.handle);
            release();
        }
    }
}

// Locked Express 4 routers contain route layers with validators followed by
// one terminal business handler. Admission belongs after those validators.
export function wrapChatStorageRouter(router, mount) {
    for (const layer of router.stack) {
        if (!layer.route) continue;
        const terminal = layer.route.stack.at(-1);
        const handler = terminal.handle;
        terminal.handle = function (req, res, next) {
            const pathname = normalizeNativeApiPath(mount + req.path);
            if (!isLegacyChatRoute(req, pathname)) return handler.call(this, req, res, next);
            return runHandler(handler, this, req, res, next, pathname).catch(next);
        };
    }
    return router;
}
