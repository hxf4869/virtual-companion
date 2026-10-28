import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';

export function requireServiceToken(value) {
    if (typeof value !== 'string' || Buffer.byteLength(value) < 32 || /\s/.test(value)) {
        throw new Error('MEMORYCORE_SERVICE_TOKEN_REQUIRED');
    }
    return value;
}

// Health is public; all internal operations require the dedicated Go service token.
// Browser Origin requests are rejected, including callers with a stolen session cookie.
export function createMemoryCoreServer({ token, engine, commit }) {
    const expected = Buffer.from(`Bearer ${requireServiceToken(token)}`);
    return http.createServer({ maxHeaderSize: 8192 }, async (req, res) => {
        const send = (status, body) => {
            res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify(body));
        };
        if (req.headers.origin) return send(403, { code: 'ORIGIN_NOT_ALLOWED' });
        const route = req.url?.split('?')[0];
        if (route !== '/healthz') {
            const actual = Buffer.from(req.headers.authorization || '');
            if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return send(401, { code: 'UNAUTHORIZED' });
        }
        if (!['/healthz', '/readyz'].includes(route)) {
            const action = route?.startsWith('/internal/') ? route.slice('/internal/'.length) : '';
            if (!engine.invoke || !['propose','correct-propose','scope-status','invalidate-scope','commit','operation-status','search','rebuild-profile','read-profile','rebuild-space','forget','clear-owner','export-owner'].includes(action)) {
                req.resume(); return send(404, { code: 'NOT_FOUND' });
            }
            if (req.method !== 'POST') { req.resume(); return send(405, { code: 'METHOD_NOT_ALLOWED' }); }
            try {
                let size = 0; const parts = [];
                for await (const chunk of req) {
                    size += chunk.length;
                    if (size > 2 * 1024 * 1024) { send(413, { code: 'REQUEST_TOO_LARGE' }); return; }
                    parts.push(chunk);
                }
                const input = JSON.parse(Buffer.concat(parts).toString('utf8'));
                return send(200, await engine.invoke(action, input));
            } catch (e) {
                // No upstream exception text: it may contain model content/paths.
                const message = typeof e?.message === 'string' ? e.message : '';
                const conflict = /(?:REVISION|SPACE|OPERATION|PROPOSAL|PROFILE_VERIFICATION)/.test(message);
                if (conflict) return send(409, { code: 'MEMORYCORE_CONFLICT' });
                const closed = /^MEMORYCORE_[A-Z0-9_]+$/.test(message) ? message : 'MEMORYCORE_OPERATION_FAILED';
                return send(422, { code: closed });
            }
        }
        req.resume();
        if (req.method !== 'GET') return send(405, { code: 'METHOD_NOT_ALLOWED' });
        if (route === '/healthz') return send(200, { status: 'ok', service: 'vc-memorycore', upstreamCommit: commit });
        try {
            const ready = await engine.ready();
            send(ready ? 200 : 503, { status: ready ? 'ready' : 'unavailable', foundation: true,
                storageReady: Boolean(ready), businessReady: Boolean(ready && engine.invoke), upstreamCommit: commit });
        } catch { send(503, { status: 'unavailable', foundation: true, storageReady: false, businessReady: false }); }
    });
}
