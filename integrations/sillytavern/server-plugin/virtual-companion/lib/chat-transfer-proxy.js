// Only the public authenticated import/export routes use this long streaming
// branch of the existing admin bridge. It never adds a service credential.
import { Readable } from 'node:stream';
import { once } from 'node:events';

const maxBodyBytes = 264 * 1024 * 1024;
const timeoutMs = 150_000;

function fail(res, status, code) {
    if (res.destroyed || res.writableEnded) return;
    if (res.headersSent) { res.destroy(); return; }
    for (const name of ['content-length', 'content-disposition', 'x-chat-id', 'x-chat-revision', 'x-chat-authority-epoch']) res.removeHeader(name);
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    if (code === 'CHAT_TRANSFER_TIMEOUT') res.setHeader('Retry-After', '1');
    res.end(JSON.stringify({ code, message: 'chat transfer unavailable' }));
}

export async function proxyChatTransfer(req, res, { url, headers, upload, fetchImpl }) {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    const closed = () => { if (!res.writableEnded) cancel(); };
    req.once('aborted', cancel); res.once('close', closed);
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]);
    let tooLarge = false;
    try {
        const contentType = req.headers['content-type'];
        if (upload && !/^multipart\/form-data;\s*boundary=/i.test(contentType || '')) return fail(res, 400, 'INVALID_REQUEST');
        if (upload && Number(req.headers['content-length']) > maxBodyBytes) return fail(res, 413, 'CHAT_PAYLOAD_TOO_LARGE');
        const body = upload ? Readable.from((async function* () {
            let bytes = 0;
            for await (const chunk of req) {
                signal.throwIfAborted();
                bytes += chunk.length;
                if (bytes > maxBodyBytes) { tooLarge = true; throw new Error('CHAT_PAYLOAD_TOO_LARGE'); }
                yield chunk;
            }
        })()) : undefined;
        const upstream = await fetchImpl(url, {
            method: upload ? 'POST' : 'GET', headers: { ...headers, Accept: upload ? 'application/json' : 'application/x-ndjson',
                ...(upload ? { 'Content-Type': contentType } : {}) },
            ...(upload ? { body, duplex: 'half' } : {}), signal, redirect: 'manual',
        });
        res.statusCode = upstream.status;
        res.setHeader('Cache-Control', 'no-store');
        for (const name of ['content-type', 'content-length', 'content-disposition', 'x-chat-id', 'x-chat-revision', 'x-chat-authority-epoch', 'retry-after']) {
            const value = upstream.headers.get(name);
            if (value !== null) res.setHeader(name, value);
        }
        if (upstream.body) for await (const chunk of upstream.body) {
            signal.throwIfAborted();
            if (!res.write(chunk)) await once(res, 'drain', { signal });
        }
        res.end();
    } catch {
        if (tooLarge) return fail(res, 413, 'CHAT_PAYLOAD_TOO_LARGE');
        if (signal.aborted) return fail(res, 503, 'CHAT_TRANSFER_TIMEOUT');
        return fail(res, 503, 'SCHEMA_UNAVAILABLE');
    } finally {
        req.removeListener('aborted', cancel); res.removeListener('close', closed);
    }
}
