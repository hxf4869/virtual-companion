// 领取只决定谁尝试写入。保存必须使用刚刚读到的 F2 基线，ACK 只发生在读回之后。
import { timingSafeEqual } from 'node:crypto';
import { getF2Store, F2Error } from './f2-store.js';

const eventIdPattern = /^[A-Za-z0-9_.:-]{1,128}$/;
export const INBOX_BRIDGE_PATH = '/internal/v1/st/inbox';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
function reject(res, status, code) { return res.status(status).json({ code }); }
function eventIdOf(message) {
    const id = message?.extra?.vc_source?.inbox_event_id;
    return typeof id === 'string' && eventIdPattern.test(id) ? id : '';
}
function findEvent(chat, eventId) {
    return (Array.isArray(chat) ? chat.slice(1) : []).find((message) => eventIdOf(message) === eventId);
}
function expiresMs(lease) {
    const value = lease?.expiresAt;
    const time = value instanceof Date ? value.getTime() : Date.parse(value);
    return Number.isFinite(time) ? time : NaN;
}
function leaseAlive(lease, now) {
    const clock = typeof now === 'function' ? now() : new Date();
    return typeof lease?.token === 'string' && lease.token !== '' && expiresMs(lease) > clock.getTime();
}
function baseline(chat) {
    const token = chat?.[0]?.chat_metadata?.vc_f2;
    if (!isObject(token) || typeof token.id !== 'string' || !Number.isSafeInteger(token.revision) || token.revision < 0) return null;
    return { id: token.id, revision: token.revision };
}
function stopped(reason) {
    return { saved: false, stopped: true, waitingHost: false, associated: false, acked: false, reason };
}
function readbackOf(chat, eventId, message) {
    const token = baseline(chat);
    return {
        chatIdentity: token.id,
        chatRevision: token.revision,
        eventId,
        messageId: message.vc_message_id,
        messageRevision: message.extra.vc_source.revision,
    };
}

/** 只观察已保存聊天。append 恒为 false：删除和回档都不补投。 */
export function classifyInboxLink(chat, event) {
    const header = Array.isArray(chat) ? chat[0] : null;
    const root = header?.chat_metadata?.vc_branch_root || header?.chat_metadata?.vc_f2?.id || '';
    const message = (Array.isArray(chat) ? chat.slice(1) : []).find((row) => row?.vc_message_id === event?.messageId);
    if (event?.branch && root !== event.branch) return { linkStatus: 'invalidated', append: false };
    if (!message) return { linkStatus: 'removed', append: false };
    const source = message.extra?.vc_source;
    if (eventIdOf(message) !== event?.eventId) return { linkStatus: 'invalidated', append: false };
    if (Number.isSafeInteger(event.messageRevision) && !(Number.isSafeInteger(source?.revision) && source.revision >= event.messageRevision)) {
        return { linkStatus: 'invalidated', append: false };
    }
    return { linkStatus: 'present', append: false };
}

async function acknowledge(chat, eventId, message, beforeAck, lease, now, flags) {
    if (!leaseAlive(lease, now)) return { ...flags, saved: flags.saved === true, stopped: true, acked: false, readback: readbackOf(chat, eventId, message) };
    const readback = readbackOf(chat, eventId, message);
    if (typeof beforeAck === 'function') await beforeAck(readback);
    return { ...flags, acked: true, linkStatus: 'present', readback };
}

export async function attemptInboxDelivery({ store, file, event, lease, claim, now, beforeAck, beforeSave } = {}) {
    let active = lease;
    if (typeof claim === 'function') {
        const claimed = await claim();
        if (!claimed?.ok) return stopped('claim');
        active = claimed.lease;
    }
    if (!leaseAlive(active, now)) return stopped('lease');
    const chat = await store.read(file);
    if (!leaseAlive(active, now)) return stopped('lease');
    if (event?.intent === 'WAITING_HOST') {
        return { saved: false, stopped: false, waitingHost: true, associated: false, acked: false };
    }
    if (event?.stDelivered || event?.messageId) {
        const link = classifyInboxLink(chat, event);
        if (link.linkStatus !== 'present') {
            return { saved: false, stopped: false, waitingHost: false, associated: false, acked: false, linkStatus: link.linkStatus };
        }
    }
    const existing = findEvent(chat, event?.eventId);
    if (existing) return acknowledge(chat, event.eventId, existing, beforeAck, active, now, { saved: false, stopped: false, waitingHost: false, associated: true });
    const expected = baseline(chat);
    if (!expected) return stopped('baseline');
    if (typeof beforeSave === 'function') await beforeSave();
    if (!leaseAlive(active, now)) return stopped('lease');
    const next = structuredClone(chat);
    const voice = event.voice?.status === 'ready' && /^[1-9][0-9]{0,18}$/.test(event.voice.clipId) && Number.isSafeInteger(event.voice.durationMs) && event.voice.durationMs > 0
        ? { vc_voice: { clipId: event.voice.clipId, status: 'ready', durationMs: event.voice.durationMs } } : {};
    next.push({ is_user: false, mes: event.body, extra: { vc_source: { inbox_event_id: event.eventId }, ...voice } });
    await store.save(file, next, { expected });
    const saved = await store.read(file);
    const message = findEvent(saved, event.eventId);
    if (!message) return { saved: true, stopped: false, waitingHost: false, associated: false, acked: false };
    return acknowledge(saved, event.eventId, message, beforeAck, active, now, { saved: true, stopped: false, waitingHost: false, associated: false });
}

export function createInboxBridge({ config, getUser, getUserDirectories, accountData }) {
    return async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        if (req.headers.origin) return reject(res, 403, 'ACCESS_DENIED');
        const actual = Buffer.from(String(req.headers.authorization || ''));
        const expected = Buffer.from(`Bearer ${config.serviceToken || ''}`);
        if (!config.serviceToken || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return reject(res, 401, 'AUTHENTICATION_REQUIRED');
        const { ownerAccountId, file, event, lease } = req.body || {};
        const handle = typeof ownerAccountId === 'string' && /^[1-9][0-9]{0,18}$/.test(ownerAccountId) ? config.accountHandles[ownerAccountId] : null;
        if (!handle) return reject(res, 403, 'ACCESS_DENIED');
        const profile = await getUser(handle);
        if (!profile?.enabled || profile.handle !== handle) return reject(res, 403, 'ACCESS_DENIED');
        if (accountData && !await accountData.readable(ownerAccountId, handle)) return reject(res, 503, 'ST_ACCOUNT_DELETING');
        if (typeof file !== 'string' || !file || !isObject(event) || !eventIdPattern.test(event.eventId || '')) return reject(res, 400, 'INVALID_REQUEST');
        try {
            const result = await attemptInboxDelivery({ store: getF2Store(getUserDirectories(handle).root), file, event, lease });
            const payload = {
                saved: result.saved === true,
                stopped: result.stopped === true,
                waitingHost: result.waitingHost === true,
                associated: result.associated === true,
                acked: result.acked === true,
            };
            if (result.linkStatus) payload.linkStatus = result.linkStatus;
            if (result.readback) payload.readback = { ...result.readback };
            return res.json(payload);
        } catch (error) {
            if (error instanceof F2Error) return reject(res, error.status, error.code);
            throw error;
        }
    };
}
