import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';

export function requireServiceToken(value) {
    if (typeof value !== 'string' || Buffer.byteLength(value) < 32 || /\s/.test(value)) {
        throw new Error('MEMORYCORE_SERVICE_TOKEN_REQUIRED');
    }
    return value;
}

// No business routes in W08-1. Health is public; readiness/internal routes
// require a service token. Neither responses nor logs echo request material.
export function createMemoryCoreServer({ token, engine, commit }) {
    const expected = Buffer.from(`Bearer ${requireServiceToken(token)}`);
    return http.createServer({ maxHeaderSize: 8192 }, async (req, res) => {
        const send = (status, body) => {
            res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify(body));
        };
        req.resume();
        if (req.headers.origin) return send(403, { code: 'ORIGIN_NOT_ALLOWED' });
        const route = req.url?.split('?')[0];
        if (route !== '/healthz') {
            const actual = Buffer.from(req.headers.authorization || '');
            if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return send(401, { code: 'UNAUTHORIZED' });
        }
        if (!['/healthz', '/readyz'].includes(route)) return send(404, { code: 'NOT_FOUND' });
        if (req.method !== 'GET') return send(405, { code: 'METHOD_NOT_ALLOWED' });
        if (route === '/healthz') return send(200, { status: 'ok', service: 'vc-memorycore', upstreamCommit: commit });
        try {
            const ready = await engine.ready();
            send(ready ? 200 : 503, { status: ready ? 'ready' : 'unavailable', foundation: true,
                storageReady: Boolean(ready), businessReady: false, upstreamCommit: commit });
        } catch { send(503, { status: 'unavailable', foundation: true, storageReady: false, businessReady: false }); }
    });
}
