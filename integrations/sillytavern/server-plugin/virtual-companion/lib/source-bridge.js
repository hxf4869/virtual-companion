// Go-only read channel: the shared service secret never reaches a browser.
import { timingSafeEqual } from 'node:crypto';
import { getF2Store } from './f2-store.js';
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const SOURCE_BRIDGE_PATH = '/internal/v1/st/sources';
export const DATA_EXPORT_PATH = '/internal/v1/st/data/export';
export const DATA_DELETE_PATH = '/internal/v1/st/data/delete';
export const PRIVATE_ST_PATHS = [SOURCE_BRIDGE_PATH, DATA_EXPORT_PATH, DATA_DELETE_PATH];
function reject(res, status, code) { return res.status(status).json({ code }); }
export function createSourceBridge({ config, getUser, getUserDirectories, accountData }) {
    return async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        if (req.headers.origin) return reject(res, 403, 'ACCESS_DENIED');
        const actual = Buffer.from(String(req.headers.authorization || ''));
        const expected = Buffer.from(`Bearer ${config.serviceToken || ''}`);
        if (!config.serviceToken || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return reject(res, 401, 'AUTHENTICATION_REQUIRED');
        const { ownerAccountId, chats } = req.body || {};
        const handle = typeof ownerAccountId === 'string' && /^[1-9][0-9]{0,18}$/.test(ownerAccountId) ? config.accountHandles[ownerAccountId] : null;
        if (!handle) return reject(res, 403, 'ACCESS_DENIED');
        if ([DATA_EXPORT_PATH, DATA_DELETE_PATH].includes(req.path)) {
            if (!accountData) return reject(res, 503, 'ST_DATA_UNAVAILABLE');
            if (req.path === DATA_DELETE_PATH) {
                if (req.body.expectedHandle !== undefined && typeof req.body.expectedHandle !== 'string') return reject(res, 400, 'INVALID_REQUEST');
                return res.json(await accountData.deleteData(ownerAccountId, handle, req.body.expectedHandle));
            }
            const user = await getUser(handle);
            if (!user?.enabled || user.handle !== handle) return reject(res, 403, 'ACCESS_DENIED');
            try { return res.json(await accountData.exportData(ownerAccountId, handle)); }
            catch (error) { if (error.code === 'ST_EXPORT_TOO_LARGE') return reject(res, 413, error.code); throw error; }
        }
        if (!Array.isArray(chats) || chats.length < 1 || chats.length > 64) return reject(res, 400, 'INVALID_REQUEST');
        const unique = new Set();
        for (const entry of chats) {
            if (!entry || !idPattern.test(entry.chatIdentity || '') || unique.has(entry.chatIdentity)
                || (entry.revision !== undefined && (!Number.isSafeInteger(entry.revision) || entry.revision < 0))) return reject(res, 400, 'INVALID_REQUEST');
            unique.add(entry.chatIdentity);
        }
        const profile = await getUser(handle);
        if (!profile?.enabled || profile.handle !== handle) return reject(res, 403, 'ACCESS_DENIED');
        if (accountData && !await accountData.readable(ownerAccountId, handle)) return reject(res, 503, 'ST_ACCOUNT_DELETING');
        const store = getF2Store(getUserDirectories(handle).root);
        const snapshots = [];
        for (const entry of chats) snapshots.push(await store.sourceSnapshot(entry.chatIdentity, entry.revision));
        return res.json({ ownerAccountId, snapshots });
    };
}
