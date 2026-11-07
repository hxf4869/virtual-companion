// Authenticated native-chat adapter. No filesystem access and no ST fallback.
// host-auth must supply a freshly verified identity/storage hint before calling us.
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { normalizeNativeApiPath } from './legacy-chat-routes.js';
import { nativeChatTextExport } from './restored-chat-aliases.js';

export const NATIVE_CHAT_TIMEOUT_MS = 150_000;
const API = '/api/v1/service/chats/native/';
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const DECIMAL = /^(0|[1-9][0-9]*)$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const routes = new Map([
    ['/api/chats/get', 'read'], ['/api/chats/group/get', 'read'],
    ['/api/chats/save', 'save'], ['/api/chats/group/save', 'save'],
    ['/api/chats/rename', 'rename'], ['/api/chats/delete', 'delete'], ['/api/chats/group/delete', 'delete'],
    ['/api/characters/chats', 'list'], ['/api/chats/recent', 'list'], ['/api/chats/search', 'search'],
    ['/api/chats/group/info', 'list'],
    ['/api/chats/export', 'export'],
]);
export function isNativeChatRoute(req, pathname = req.path || '') {
    return req.method === 'POST' && routes.has(normalizeNativeApiPath(pathname));
}
function failure(status, code) { return Object.assign(new Error(code), { status, code }); }
function filename(value) {
    if (typeof value !== 'string' || !value || /[\\/\x00]/.test(value) || value === '.' || value === '..'
        || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(value)) throw failure(400, 'INVALID_REQUEST');
    const result = value.endsWith('.jsonl') ? value : value + '.jsonl';
    if (result === '.jsonl' || result === '..jsonl') throw failure(400, 'INVALID_REQUEST');
    return result;
}
function revision(value) {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
    if (typeof value === 'string' && DECIMAL.test(value) && BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER)) return value;
    throw failure(422, 'CHAT_INVALID_OPERATION');
}
function token(value) {
    if (!object(value) || !UUID.test(value.id || '') || value.revision === undefined) throw failure(428, 'CHAT_PRECONDITION_REQUIRED');
    return { id: value.id, revision: revision(value.revision) };
}
function parseField(value) {
    if (typeof value !== 'string') return value;
    try { return JSON.parse(value); } catch { throw failure(400, 'INVALID_REQUEST'); }
}
function checkedScope(value) {
    if (!object(value)) throw failure(403, 'ACCESS_DENIED');
    if (value.kind === 'SINGLE' && typeof value.characterRef === 'string' && value.characterRef && !value.groupRef) {
        return { kind: 'SINGLE', characterRef: value.characterRef };
    }
    if (value.kind === 'GROUP' && typeof value.groupRef === 'string' && value.groupRef && !value.characterRef) {
        return { kind: 'GROUP', groupRef: value.groupRef };
    }
    throw failure(403, 'ACCESS_DENIED');
}
function sameScope(chat, scope) {
    return chat?.kind === scope.kind && (scope.kind === 'SINGLE' ? chat.characterRef === scope.characterRef : chat.groupRef === scope.groupRef);
}
function snapshotLines(chat) {
    if (!Array.isArray(chat) || !chat.length || !chat.every(object)) throw failure(400, 'INVALID_REQUEST');
    if (chat[0].chat_metadata !== undefined && !object(chat[0].chat_metadata)) throw failure(400, 'INVALID_REQUEST');
    let total = 0;
    for (const [index, record] of chat.entries()) {
        const line = JSON.stringify(record) + '\n';
        const size = Buffer.byteLength(line);
        if (size > (index ? 1_048_576 : 8_388_608) || (total += size) > 268_435_456) throw failure(413, 'CHAT_PAYLOAD_TOO_LARGE');
    }
    return chat;
}
function multipart(fields, lines) {
    const boundary = 'vc-native-' + randomUUID();
    function* chunks() {
        for (const [name, value] of Object.entries(fields)) {
            yield `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${typeof value === 'object' ? JSON.stringify(value) : value}\r\n`;
        }
        yield `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="chat.jsonl"\r\nContent-Type: application/x-ndjson\r\n\r\n`;
        for (const record of lines) yield JSON.stringify(record) + '\n';
        yield `\r\n--${boundary}--\r\n`;
    }
    return { body: Readable.from(chunks()), contentType: `multipart/form-data; boundary=${boundary}` };
}
function summary(chat) {
    return { ...chat, file_name: chat.fileName || chat.chatId + '.jsonl', file_id: (chat.fileName || chat.chatId + '.jsonl').replace(/\.jsonl$/, ''),
        chat_items: chat.messageCount, last_mes: chat.updatedAt,
        chat_metadata: { vc_f2: { id: chat.chatId, revision: Number(revision(chat.chatRevision)) },
            vc_branch_root: chat.branchRoot, vc_binding: { chatIdentity: chat.chatId, characterRef: chat.characterRef,
                relationshipId: chat.relationshipId, conversationId: chat.conversationId } } };
}

function validateMapping(mapping, uploaded, canonical) {
    if (mapping.length !== uploaded.length - 1 || canonical.length !== uploaded.length) throw failure(502, 'CHAT_NATIVE_RESPONSE_INVALID');
    for (const [index, row] of mapping.entries()) {
        const message = canonical[index + 1], input = uploaded[index + 1];
        const count = message.swipes?.length || 1;
        if (row.messageIndex !== index || !UUID.test(row.messageId || '') || message.vc_message_id !== row.messageId
            || row.inputMessageId !== (input.vc_message_id ?? null) || !Array.isArray(row.candidates) || row.candidates.length !== count) throw failure(502, 'CHAT_NATIVE_RESPONSE_INVALID');
        for (const [candidateIndex, candidate] of row.candidates.entries()) {
            const source = candidateIndex === (message.swipe_id ?? 0) ? message.extra?.vc_source : message.swipe_info?.[candidateIndex]?.extra?.vc_source;
            if (candidate.candidateIndex !== candidateIndex || !UUID.test(candidate.candidateId || '') || source?.id !== candidate.candidateId
                || String(source.revision) !== candidate.sourceRevision || String(source.generation) !== candidate.sourceGeneration) throw failure(502, 'CHAT_NATIVE_RESPONSE_INVALID');
        }
    }
}

/** resolveScope receives only authenticated req + legacy addressing. It must resolve
 * owned real resources, never uploaded vc_binding. Returns {scope,mode?}, or
 * {scopes:[scope,...]} for owner-wide recent/search. All response data is private. */
export function createNativeChatBridge({ config, fetchImpl = globalThis.fetch, resolveScope }) {
    async function go(operation, fields, signal, lines) {
        if (!config?.goBaseUrl || !config?.serviceToken) throw failure(503, 'CHAT_STORAGE_UNAVAILABLE');
        signal.throwIfAborted();
        const upload = lines ? multipart(fields, lines) : null;
        return fetchImpl(config.goBaseUrl + API + operation, {
            method: 'POST', redirect: 'manual', signal,
            headers: { Authorization: `Bearer ${config.serviceToken}`,
                Accept: operation === 'read' ? 'application/x-ndjson' : 'application/json',
                'Content-Type': upload?.contentType || 'application/json' },
            body: upload?.body || JSON.stringify(fields), ...(upload ? { duplex: 'half' } : {}),
        });
    }
    async function json(response, signal) {
        if (!response.ok) throw { nativeResponse: response };
        try { return await response.json(); } catch { signal.throwIfAborted(); throw failure(502, 'CHAT_NATIVE_RESPONSE_INVALID'); }
    }
    async function read(fields, signal, expected, keepRaw = false) {
        const response = await go('read', fields, signal);
        if (!response.ok) throw { nativeResponse: response };
        const length = response.headers.get('content-length');
        const id = response.headers.get('x-chat-id');
        const rev = response.headers.get('x-chat-revision');
        const epoch = response.headers.get('x-chat-authority-epoch');
        if (!length || !/^[1-9][0-9]*$/.test(length) || !Number.isSafeInteger(Number(length)) || !UUID.test(id || '')
            || epoch !== fields.authorityEpoch || (expected && (id !== expected.id || rev !== expected.revision))) throw failure(502, 'CHAT_NATIVE_RESPONSE_INVALID');
        const safeRevision = Number(revision(rev));
        const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
        let bytes = 0, pending = '', records = [], lines = 0;
        const rawChunks = keepRaw ? [] : null;
        const line = raw => {
            if (raw.endsWith('\r')) raw = raw.slice(0, -1);
            if (!raw || Buffer.byteLength(raw) > (lines ? 1_048_576 : 8_388_608)) throw failure(502, 'CHAT_NATIVE_RESPONSE_INVALID');
            let record;
            try { record = JSON.parse(raw); } catch { throw failure(502, 'CHAT_NATIVE_RESPONSE_INVALID'); }
            if (!object(record)) throw failure(502, 'CHAT_NATIVE_RESPONSE_INVALID');
            if (!keepRaw || lines === 0) records.push(record);
            lines++;
        };
        try {
            for await (const chunk of response.body) {
                signal.throwIfAborted();
                bytes += chunk.byteLength;
                if (bytes > Number(length)) throw failure(502, 'CHAT_NATIVE_RESPONSE_INVALID');
                const text = decoder.decode(chunk, { stream: true });
                rawChunks?.push(text);
                pending += text;
                let end;
                while ((end = pending.indexOf('\n')) >= 0) { line(pending.slice(0, end)); pending = pending.slice(end + 1); }
                if (Buffer.byteLength(pending) > (lines ? 1_048_576 : 8_388_608)) throw failure(502, 'CHAT_NATIVE_RESPONSE_INVALID');
            }
            const tail = decoder.decode();
            rawChunks?.push(tail);
            pending += tail;
        } catch (error) { signal.throwIfAborted(); if (error.status) throw error; throw failure(502, 'CHAT_NATIVE_RESPONSE_INVALID'); }
        if (bytes !== Number(length)) throw failure(502, 'CHAT_NATIVE_RESPONSE_INVALID');
        if (pending) line(pending);
        const metadata = records[0]?.chat_metadata;
        if (!object(metadata) || metadata.vc_f2?.id !== id || revision(metadata.vc_f2?.revision) !== rev) throw failure(502, 'CHAT_NATIVE_RESPONSE_INVALID');
        metadata.vc_f2.revision = safeRevision;
        return keepRaw ? rawChunks.join('') : records;
    }
    return async function nativeChatBridge(req, res, next = () => {}) {
        const path = normalizeNativeApiPath((req.originalUrl || req.path || '').split('?')[0]);
        const operation = req.method === 'POST' && routes.get(path);
        if (!operation) return next();
        res.setHeader('Cache-Control', 'no-store');
        const controller = new AbortController();
        const signal = AbortSignal.any([AbortSignal.timeout(NATIVE_CHAT_TIMEOUT_MS), controller.signal, ...(req.signal ? [req.signal] : [])]);
        const cancel = () => controller.abort();
        const disconnected = () => { if (!res.writableEnded) cancel(); };
        req.once?.('aborted', cancel);
        res.once?.('close', disconnected);
        try {
            const identity = req.vcIdentity, storage = req.vcChatStorage;
            if (!/^[1-9][0-9]*$/.test(identity?.accountId || '') || !identity?.handle || !identity?.sessionId) throw failure(401, 'AUTHENTICATION_REQUIRED');
            if (!storage || !DECIMAL.test(storage.authorityEpoch || '')) throw failure(503, 'CHAT_STORAGE_UNAVAILABLE');
            if (storage.mode === 'ST') return next();
            if (storage.mode !== 'GO') throw failure(409, 'CHAT_AUTHORITY_CHANGED');
            const body = req.body || {};
            const mutation = ['save', 'rename', 'delete'].includes(operation);
            const clientEpoch = body.vc_authority_epoch ?? req.headers?.['x-vc-chat-authority-epoch'];
            if (mutation && clientEpoch === undefined) throw failure(428, 'CHAT_PRECONDITION_REQUIRED');
            if (mutation && clientEpoch !== storage.authorityEpoch) throw failure(409, 'CHAT_AUTHORITY_CHANGED');
            const resolved = await resolveScope({ req, ownerAccountId: identity.accountId, body, path, signal });
            signal.throwIfAborted();
            const scopes = (resolved?.scopes || [resolved?.scope]).map(checkedScope);
            if ((!['list', 'search'].includes(operation) && scopes.length !== 1)) throw failure(403, 'ACCESS_DENIED');
            const ownerAccountId = identity.accountId, authorityEpoch = storage.authorityEpoch, scope = scopes[0];
            const common = { ownerAccountId, scope, authorityEpoch };
            const fileName = () => filename(body.file_name ?? body.original_file ?? body.chatfile ?? body.id ?? body.file);
            if (operation === 'read') return res.json(await read({ ...common, fileName: fileName() }, signal));
            if (operation === 'export') {
                const fields = { ...common, fileName: fileName() };
                const result = body.format === 'jsonl' ? await read(fields, signal, undefined, true)
                    : nativeChatTextExport(await read(fields, signal));
                return res.json({ message: `Chat saved to ${body.exportfilename}`, result });
            }
            if (operation === 'list' || operation === 'search') {
                const rows = new Map();
                for (const scope of scopes) {
                    let cursor; const cursors = new Set();
                    do {
                        const page = await json(await go('list', { ownerAccountId, scope, limit: 100, ...(cursor ? { cursor } : {}) }, signal), signal);
                        if (page.authorityEpoch !== authorityEpoch || !Array.isArray(page.items)) throw failure(409, 'CHAT_AUTHORITY_CHANGED');
                        for (const chat of page.items) {
                            if (!sameScope(chat, scope)) throw failure(502, 'CHAT_NATIVE_RESPONSE_INVALID');
                            rows.set(chat.chatId, { ...summary(chat), avatar: resolved?.avatars?.[chat.characterRef] || resolved?.avatar || body.avatar_url || '',
                                ...(chat.kind === 'GROUP' ? { group: resolved?.groupIds?.[chat.groupRef] || chat.groupRef } : {}) });
                        }
                        cursor = page.nextCursor;
                        if (cursor && cursors.has(cursor)) throw failure(502, 'CHAT_NATIVE_RESPONSE_INVALID');
                        cursors.add(cursor);
                    } while (cursor);
                }
                if (path === '/api/chats/group/info') {
                    const name = filename(body.id);
                    const matches = [...rows.values()].filter(row => row.file_name === name || row.fileAliases?.includes(name));
                    if (matches.length !== 1) throw failure(404, 'NOT_FOUND_OR_FORBIDDEN');
                    return res.json(matches[0]);
                }
                let result = [...rows.values()].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
                if (operation === 'search') {
                    const fragments = String(body.query ?? '').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
                    const matched = [];
                    for (const row of result) {
                        const chat = await read({ ownerAccountId, authorityEpoch, scope: row.kind === 'SINGLE'
                            ? { kind: 'SINGLE', characterRef: row.characterRef } : { kind: 'GROUP', groupRef: row.groupRef }, fileName: row.file_name }, signal);
                        const text = chat.slice(1).map(message => String(message.mes ?? '').toLocaleLowerCase());
                        if (!fragments.length || fragments.every(fragment => text.some(value => value.includes(fragment)))
                            || fragments.every(fragment => row.file_id.toLocaleLowerCase().includes(fragment))) {
                            matched.push({ file_name: row.file_id, message_count: row.chat_items, last_mes: row.last_mes,
                                preview_message: String(chat.at(-1)?.mes || '').slice(0, 400) });
                        }
                    }
                    result = matched;
                }
                if (path === '/api/chats/recent') {
                    const pinned = Array.isArray(body.pinned) ? body.pinned : [];
                    const isPinned = row => pinned.some(item => (row.file_name === item.file_name || row.fileAliases?.includes(item.file_name))
                        && (row.kind === 'GROUP' ? row.group === item.group : row.avatar === item.avatar));
                    result.sort((a, b) => Number(isPinned(b)) - Number(isPinned(a)) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
                    const max = Number.parseInt(body.max ?? Number.MAX_SAFE_INTEGER, 10);
                    if (Number.isFinite(max) && max >= 0) result = result.slice(0, max + pinned.length);
                }
                return res.json(path === '/api/characters/chats' ? Object.fromEntries(result.map((row, index) => [index, row])) : result);
            }
            const expected = token(operation === 'save' ? body.chat?.[0]?.chat_metadata?.vc_f2 : parseField(body.vc_f2));
            const requestId = body.vc_request_id ?? body.requestId;
            if (typeof requestId !== 'string' || !UUID.test(requestId)) throw failure(400, 'INVALID_REQUEST');
            const fields = { ...common, requestId };
            let result;
            if (operation === 'save') {
                const lines = snapshotLines(body.chat);
                const parent = body.chat[0].chat_metadata?.vc_f2_parent;
                const action = expected.revision === '0' ? (parent ? 'fork' : 'create') : 'save';
                Object.assign(fields, { fileName: fileName(), chatId: expected.id, chatRevision: expected.revision });
                if (action === 'fork') {
                    const baseline = token(parent);
                    Object.assign(fields, { parentChatId: baseline.id, parentRevision: baseline.revision });
                } else if (action === 'create' && scope.kind === 'SINGLE') {
                    if (!['COMPANION', 'STORY'].includes(resolved.mode)) throw failure(400, 'INVALID_REQUEST');
                    fields.mode = resolved.mode;
                }
                if (action === 'save' && req.headers?.['x-vc-stored-chat-generation']) fields.generation = parseField(req.headers['x-vc-stored-chat-generation']);
                result = await json(await go(action, fields, signal, lines), signal);
                if (result.requestId !== requestId || !sameScope(result.chat, scope) || result.chat.chatId !== expected.id
                    || result.chat.authorityEpoch !== authorityEpoch || revision(result.chat.chatRevision) !== String(BigInt(expected.revision) + 1n)
                    || !Array.isArray(result.identityMapping) || result.identityMapping.length !== body.chat.length - 1) throw failure(502, 'CHAT_NATIVE_RESPONSE_INVALID');
                // The canonical read is mandatory: create/fork must never ACK while
                // leaving the native page using the parent's protected identities.
                const chat = await read({ ...common, fileName: result.chat.fileName || fields.fileName }, signal,
                    { id: expected.id, revision: result.chat.chatRevision });
                validateMapping(result.identityMapping, body.chat, chat);
                return res.json({ ok: true, vc_f2: { id: expected.id, revision: Number(result.chat.chatRevision) },
                    chat, identityMapping: result.identityMapping, requestId });
            }
            fields.target = { fileName: fileName(), chatId: expected.id, chatRevision: expected.revision };
            if (operation === 'rename') fields.toFileName = filename(body.renamed_file);
            result = await json(await go(operation, fields, signal), signal);
            const ack = result.result;
            if (result.requestId !== requestId || JSON.stringify(ack?.scope) !== JSON.stringify(scope) || ack.chatId !== expected.id
                || ack.authorityEpoch !== authorityEpoch || revision(ack.chatRevision) !== String(BigInt(expected.revision) + 1n)
                || ack.deleted !== (operation === 'delete')) throw failure(502, 'CHAT_NATIVE_RESPONSE_INVALID');
            return res.json({ ok: true, vc_f2: { id: expected.id, revision: Number(ack.chatRevision) },
                ...(operation === 'rename' ? { sanitizedFileName: ack.fileName.replace(/\.jsonl$/, '') } : {}) });
        } catch (error) {
            if (error.nativeResponse) {
                const response = error.nativeResponse;
                const retry = response.headers.get('retry-after');
                if (retry) res.setHeader('Retry-After', retry);
                res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json');
                try { return res.status(response.status).send(await response.text()); }
                catch {
                    if (signal.aborted) { res.setHeader('Retry-After', '1'); return res.status(503).json({ code: 'CHAT_TRANSFER_TIMEOUT' }); }
                    return res.status(502).json({ code: 'CHAT_NATIVE_RESPONSE_INVALID' });
                }
            }
            if (error.name === 'TimeoutError' || error.name === 'AbortError') {
                res.setHeader('Retry-After', '1');
                return res.status(503).json({ code: 'CHAT_TRANSFER_TIMEOUT' });
            }
            return res.status(error.status || 502).json({ code: error.code || 'CHAT_NATIVE_UNAVAILABLE' });
        } finally {
            req.removeListener?.('aborted', cancel);
            res.removeListener?.('close', disconnected);
        }
    };
}
