// Short-lived CM evaluation observer, never deployed. Raw synthetic query text
// exists only in a bounded RAM ring; the runner persists fact counts, not this ring.
import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export async function startEngineObservationProxy({ token, target = 'http://127.0.0.1:8754', port = 8756, capacity = 64 } = {}) {
    const upstream = new URL(target);
    if (upstream.protocol !== 'http:' || upstream.hostname !== '127.0.0.1' || upstream.pathname !== '/'
        || typeof token !== 'string' || token.length < 32 || !Number.isSafeInteger(capacity) || capacity < 1 || capacity > 256) throw new Error('CM_OBSERVER_CONFIG');
    const authorization = Buffer.from(`Bearer ${token}`), rows = [];
    let sequence = 0, droppedThrough = 0, forgetHold;
    const server = http.createServer(async (req, res) => {
        const controller = new AbortController();
        res.once('close', () => { if (!res.writableFinished) controller.abort(); });
        const send = (status, json) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(json)); };
        const credential = Buffer.from(req.headers.authorization || '');
        if (req.headers.origin || credential.length !== authorization.length || !timingSafeEqual(credential, authorization)) {
            req.resume(); return send(401, { code: 'UNAUTHORIZED' });
        }
        try {
            const url = new URL(req.url, 'http://127.0.0.1');
            if (url.pathname === '/control/forget' && req.method === 'POST') {
                let text = '';
                for await (const chunk of req) { text += chunk; if (text.length > 512) return send(413, { code: 'REQUEST_TOO_LARGE' }); }
                const { recordId } = JSON.parse(text);
                if (recordId === null) { forgetHold?.release(); forgetHold = undefined; }
                else {
                    if (typeof recordId !== 'string' || !recordId || recordId.length > 200 || forgetHold) return send(409, { code: 'HOLD_CONFLICT' });
                    let release;
                    const ready = new Promise(resolve => { release = resolve; });
                    forgetHold = { recordId, ready, release, reached: false };
                }
                return send(200, { held: Boolean(forgetHold) });
            }
            if (url.pathname === '/observations' && req.method === 'GET') {
                const after = Number(url.searchParams.get('after') || 0);
                if (!Number.isSafeInteger(after) || after < 0) return send(400, { code: 'INVALID_CURSOR' });
                return send(200, { sequence, incomplete: after < droppedThrough, searches: rows.filter(row => row.sequence > after),
                    forgetHold: { held: Boolean(forgetHold), reached: forgetHold?.reached === true } });
            }
            const get = req.method === 'GET' && ['/healthz', '/readyz', '/internal/local-models'].includes(url.pathname);
            if (url.search || (!get && (!/^\/internal\/[a-z-]+$/.test(url.pathname) || req.method !== 'POST'))) {
                req.resume(); return send(404, { code: 'NOT_FOUND' });
            }
            const chunks = []; let size = 0;
            for await (const chunk of req) {
                size += chunk.length;
                if (size > 2 * 1024 * 1024) return send(413, { code: 'REQUEST_TOO_LARGE' });
                chunks.push(chunk);
            }
            const body = Buffer.concat(chunks), started = performance.now();
            if (url.pathname === '/internal/forget' && forgetHold) {
                const input = JSON.parse(body);
                if (input.recordIds?.includes(forgetHold.recordId)) {
                    forgetHold.reached = true;
                    await Promise.race([forgetHold.ready, new Promise((_, reject) => controller.signal.addEventListener('abort',
                        () => reject(new Error('CM_OBSERVER_ABORTED')), { once: true }))]);
                }
            }
            const response = await fetch(upstream.origin + url.pathname, { method: req.method,
                headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(get ? {} : { body }),
                signal: AbortSignal.any([controller.signal, AbortSignal.timeout(600000)]), redirect: 'manual' });
            const payload = Buffer.from(await response.arrayBuffer());
            if (url.pathname === '/internal/search') {
                const input = JSON.parse(body), output = response.ok ? JSON.parse(payload) : {};
                const hits = Array.isArray(output) ? output : Array.isArray(output.hits) ? output.hits : [];
                const stats = Object.fromEntries(Object.entries(output.stats || {}).filter(([, value]) => typeof value === 'number' && Number.isFinite(value)));
                rows.push({ sequence: ++sequence, durationMs: performance.now() - started, status: response.status,
                    scope: { ownerId: input.scope?.ownerId, instanceId: input.scope?.instanceId },
                    query: String(input.query || '').slice(0, 8192), allowedRecordIds: (input.allowedRecordIds || []).slice(0, 10000),
                    recordIds: hits.slice(0, 50).map(hit => hit.record_id || hit.id), stats });
                if (rows.length > capacity) droppedThrough = rows.shift().sequence;
            }
            res.writeHead(response.status, { 'content-type': 'application/json' }); res.end(payload);
        } catch { if (!res.headersSent) send(502, { code: 'CM_OBSERVER_UPSTREAM' }); else res.destroy(); }
    });
    server.listen(port, '127.0.0.1'); await once(server, 'listening');
    return { port: server.address().port, close: () => new Promise(resolve => { forgetHold?.release(); server.close(resolve); server.closeAllConnections(); }) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    startEngineObservationProxy({ token: process.env.VC_MEMORYCORE_SERVICE_TOKEN }).then(proxy => {
        const stop = () => { void proxy.close(); };
        process.once('SIGINT', stop); process.once('SIGTERM', stop);
    }).catch(() => { console.error('CM_OBSERVER_START_FAILED'); process.exitCode = 1; });
}
