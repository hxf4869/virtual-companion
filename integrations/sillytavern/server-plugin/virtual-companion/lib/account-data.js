// W06 owner-scoped logical export and durable online deletion. Global assets,
// other users and server credentials are never traversed by these operations.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { getF2Store } from './f2-store.js';
const EXCLUDED = new Set(['backups', 'thumbnails', 'vectors', '.uploads', '.vc-f2', 'secrets.json']);
const SECRET_KEYS = new Set(['password', 'proxypassword', 'authorization', 'token', 'accesstoken', 'refreshtoken', 'secret', 'customheaders']);
function sanitizeSettings(value) {
    if (Array.isArray(value)) return value.map(sanitizeSettings);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => {
        const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
        return !SECRET_KEYS.has(normalized) && !normalized.startsWith('apikey');
    }).map(([key, child]) => [key, sanitizeSettings(child)]));
}
async function durableJSON(file, value) {
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    try {
        await fs.writeFile(temporary, JSON.stringify(value), { mode: 0o600, flush: true });
        await fs.rename(temporary, file);
        for (const name of [path.dirname(file), path.dirname(path.dirname(file))]) {
            const directory = await fs.open(name, 'r');
            try { await directory.sync(); } finally { await directory.close(); }
        }
    } finally { await fs.rm(temporary, { force: true }); }
}
export function createAccountData({ getUserDirectories, purgeProfile, maxExportBytes = 64 << 20, drainTimeoutMs = 5000 }) {
    const frozen = new Set(), active = new Map(), waiting = new Map(), operations = new Map(), registrations = new Map();
    function location(owner, handle) {
        if (!/^[1-9][0-9]{0,18}$/.test(owner) || !/^[A-Za-z0-9_-]{1,64}$/.test(handle)) throw new Error('Invalid account scope');
        const root = path.resolve(getUserDirectories(handle).root);
        if (path.basename(root) !== handle) throw new Error('Invalid account directory');
        return { root, recordFile: path.join(path.dirname(root), '_vc_accounts', `${owner}.json`) };
    }
    async function registered(owner, handle) {
        const loc = location(owner, handle);
        if (!registrations.has(owner)) {
            const pending = (async () => {
                try { return JSON.parse(await fs.readFile(loc.recordFile, 'utf8')); }
                catch (error) {
                    if (error.code !== 'ENOENT') throw error;
                    const value = { ownerAccountId: owner, handle, state: 'ACTIVE' };
                    await durableJSON(loc.recordFile, value);
                    return value;
                }
            })();
            registrations.set(owner, pending);
            void pending.catch(() => { if (registrations.get(owner) === pending) registrations.delete(owner); });
        }
        const record = await registrations.get(owner);
        if (record.ownerAccountId !== owner || record.handle !== handle || !['ACTIVE', 'DELETING', 'DELETED'].includes(record.state)) throw new Error('Account mapping changed');
        if (record.state !== 'ACTIVE') frozen.add(owner);
        return { ...loc, record };
    }
    const serial = (owner, run) => {
        const operation = (operations.get(owner) || Promise.resolve()).then(run, run);
        operations.set(owner, operation);
        void operation.finally(() => { if (operations.get(owner) === operation) operations.delete(owner); }).catch(() => {});
        return operation;
    };
    async function enter(owner, handle, response) {
        const { record } = await registered(owner, handle);
        if (frozen.has(owner) || record.state !== 'ACTIVE') return false;
        active.set(owner, (active.get(owner) || 0) + 1);
        let released = false;
        const release = () => {
            if (released) return; released = true;
            active.set(owner, Math.max(0, (active.get(owner) || 1) - 1));
            if (!active.get(owner)) waiting.get(owner)?.();
        };
        response.once('finish', release); response.once('close', release);
        return true;
    }
    async function waitForRequests(owner) {
        if (!active.get(owner)) return;
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => { waiting.delete(owner); reject(new Error('Account requests are still running')); }, drainTimeoutMs);
            waiting.set(owner, () => { clearTimeout(timer); waiting.delete(owner); resolve(); });
        });
    }
    async function exportData(owner, handle) {
        return serial(owner, async () => {
            const { root, record } = await registered(owner, handle);
            if (record.state !== 'ACTIVE' || frozen.has(owner)) throw new Error('Account deletion in progress');
            const rootStat = await fs.lstat(root);
            if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Account directory is unavailable');
            const startedAt = new Date().toISOString(), files = [];
            let bytes = 0;
            async function walk(relative = '') {
                const entries = await fs.readdir(path.join(root, relative), { withFileTypes: true });
                for (const entry of entries.sort((a,b) => a.name.localeCompare(b.name))) {
                    if (!relative && EXCLUDED.has(entry.name)) continue;
                    const name = path.posix.join(relative, entry.name), file = path.join(root, name);
                    // These are rebuildable debug artifacts of the pinned host
                    // distributions. Keep executable code and private extensions.
                    if (/^extensions\/(?:JS-Slash-Runner|ST-Prompt-Template|vc-model-settings)\/.*\.map$/.test(name)) continue;
                    if (entry.isSymbolicLink()) throw new Error('A private file is a symlink');
                    if (entry.isDirectory()) { await walk(name); continue; }
                    if (!entry.isFile()) throw new Error('A private file is unreadable');
                    const before = await fs.stat(file);
                    if (bytes + before.size > maxExportBytes || files.length >= 10000) throw Object.assign(new Error('Account export exceeds the supported size'), { code: 'ST_EXPORT_TOO_LARGE' });
                    let data = await fs.readFile(file);
                    const after = await fs.stat(file);
                    if (before.mtimeMs !== after.mtimeMs || before.size !== after.size) throw new Error('A private file changed during export');
                    if (name === 'settings.json') data = Buffer.from(JSON.stringify(sanitizeSettings(JSON.parse(data.toString('utf8')))));
                    bytes += data.length;
                    files.push({ path: name, encoding: 'base64', data: data.toString('base64'), bytes: data.length, capturedAt: new Date().toISOString(), modifiedAt: after.mtime.toISOString() });
                }
            }
            await walk();
            return { ownerAccountId: owner, handle, state: 'COMPLETE', startedAt, completedAt: new Date().toISOString(),
                snapshot: 'PER_FILE', files, fileCount: files.length, bytes,
                exclusions: ['credentials', 'historical-backups', 'regenerable-thumbnails-and-vectors', 'managed-extension-source-maps', 'temporary-uploads', 'internal-f2-index'],
            };
        });
    }
    async function deleteData(owner, handle, expectedHandle) {
        return serial(owner, async () => {
            const loc = await registered(owner, handle);
            if (expectedHandle && expectedHandle !== handle) throw new Error('Account mapping changed');
            if (loc.record.state === 'DELETED') return { ownerAccountId: owner, handle, state: 'DELETED' };
            frozen.add(owner); // closes admission synchronously before the first write await
            await durableJSON(loc.recordFile, { ownerAccountId: owner, handle, state: 'DELETING' });
            loc.record.state = 'DELETING';
            await waitForRequests(owner);
            const stat = await fs.lstat(loc.root).catch((error) => { if (error.code !== 'ENOENT') throw error; return null; });
            if (stat?.isSymbolicLink() || stat && !stat.isDirectory()) throw new Error('Account directory is unavailable');
            if (stat) await getF2Store(loc.root).removeAccountData();
            await purgeProfile(handle);
            await durableJSON(loc.recordFile, { ownerAccountId: owner, handle, state: 'DELETED' });
            loc.record.state = 'DELETED';
            return { ownerAccountId: owner, handle, state: 'DELETED' };
        });
    }
    return { enter, exportData, deleteData, readable: async (owner, handle) => (await registered(owner, handle)).record.state === 'ACTIVE' && !frozen.has(owner) };
}
