// Trusted service control only. Authority is committed by Go before invoking this bridge.
import { timingSafeEqual } from 'node:crypto';

export const CHAT_CUTOVER_PATHS = ['freeze', 'drain', 'status'].map((op) => `/internal/v1/st/chat-cutover/${op}`);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const decimal = /^[1-9][0-9]*$/;
function timeout() { return Object.assign(new Error('CHAT_TRANSFER_TIMEOUT'), { code: 'CHAT_TRANSFER_TIMEOUT' }); }
function reject(res, status, code) {
    if (res.destroyed || res.writableEnded) return;
    if (code === 'CHAT_TRANSFER_TIMEOUT') res.setHeader('Retry-After', '1');
    return res.status(status).json({ code });
}
function exactState(gate, owner, runId, epoch) {
    const state = gate.status(owner);
    if (state.closed && !state.durable) throw Object.assign(new Error(), { code: 'ST_CHAT_GATE_STATE_UNAVAILABLE' });
    if (!state.closed || !state.durable || state.runId !== runId || state.epoch !== epoch) throw Object.assign(new Error(), { code: 'CHAT_CUTOVER_CONFLICT' });
    return state;
}
function payload(ownerAccountId, state) {
    return { ownerAccountId, runId: state.runId, authorityEpoch: state.epoch,
        state: state.active === 0 ? 'DRAINED' : 'CLOSED', closed: true, durable: true, activeHandlers: state.active };
}
export function createChatCutoverBridge({ config, getUser, chatStorageGate, controlTimeoutMs = 120_000, routeTimeoutMs = 150_000 }) {
    return async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        // Presence, not truthiness: even an empty Origin is a browser-shaped request.
        if (Object.hasOwn(req.headers, 'origin')) return reject(res, 403, 'ACCESS_DENIED');
        const actual = Buffer.from(String(req.headers.authorization || ''));
        const expected = Buffer.from(`Bearer ${config.serviceToken || ''}`);
        if (!config.serviceToken || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return reject(res, 401, 'AUTHENTICATION_REQUIRED');
        const body = req.body;
        const owner = body?.ownerAccountId;
        const handle = typeof owner === 'string' && /^[1-9][0-9]{0,18}$/.test(owner) ? config.accountHandles[owner] : null;
        if (!handle) return reject(res, 403, 'ACCESS_DENIED');
        if (!body || Array.isArray(body) || Object.keys(body).some((key) => !['ownerAccountId', 'runId', 'authorityEpoch'].includes(key))
            || typeof body.runId !== 'string' || !uuid.test(body.runId) || typeof body.authorityEpoch !== 'string' || !decimal.test(body.authorityEpoch)) return reject(res, 400, 'INVALID_REQUEST');
        const controller = new AbortController();
        const cancel = () => controller.abort(timeout());
        // IncomingMessage.close fires after a normally consumed Express body. Only aborted requests
        // and unfinished response closure mean the caller disconnected.
        const responseClosed = () => { if (!res.writableEnded) cancel(); };
        req.once('aborted', cancel);
        res.once('close', responseClosed);
        const routeTimer = setTimeout(cancel, routeTimeoutMs);
        const workTimer = setTimeout(cancel, controlTimeoutMs);
        let abort;
        const cancelled = new Promise((_, rejectWait) => {
            abort = () => rejectWait(controller.signal.reason);
            controller.signal.addEventListener('abort', abort, { once: true });
        });
        try {
            const work = async () => {
                const profile = await getUser(handle);
                if (controller.signal.aborted) throw controller.signal.reason;
                if (!profile?.enabled || profile.handle !== handle) return reject(res, 403, 'ACCESS_DENIED');
                if (!chatStorageGate) throw Object.assign(new Error(), { code: 'ST_CHAT_GATE_STATE_UNAVAILABLE' });
                if (req.path === CHAT_CUTOVER_PATHS[0]) {
                    // closeAdmission closes synchronously before starting its durable write.
                    await chatStorageGate.closeAdmission(owner, { runId: body.runId, epoch: body.authorityEpoch });
                } else {
                    exactState(chatStorageGate, owner, body.runId, body.authorityEpoch);
                    if (req.path === CHAT_CUTOVER_PATHS[1]) await chatStorageGate.waitForIdle(owner, { signal: controller.signal });
                }
                if (controller.signal.aborted) throw controller.signal.reason;
                return payload(owner, exactState(chatStorageGate, owner, body.runId, body.authorityEpoch));
            };
            const result = await Promise.race([work(), cancelled]);
            if (result && !res.destroyed && !res.writableEnded) return res.json(result);
        } catch (error) {
            if (controller.signal.aborted || error.code === 'CHAT_TRANSFER_TIMEOUT') return reject(res, 503, 'CHAT_TRANSFER_TIMEOUT');
            if (['CHAT_CUTOVER_CONFLICT', 'ST_CHAT_GATE_OPEN', 'ST_CHAT_GATE_NOT_DURABLE'].includes(error.code)) return reject(res, 409, 'REVISION_CONFLICT');
            return reject(res, 503, 'SCHEMA_UNAVAILABLE');
        } finally {
            clearTimeout(routeTimer); clearTimeout(workTimer);
            req.removeListener('aborted', cancel); res.removeListener('close', responseClosed);
            controller.signal.removeEventListener('abort', abort);
        }
    };
}
