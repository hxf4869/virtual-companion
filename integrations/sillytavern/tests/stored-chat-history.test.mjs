import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createChatHistory, readChatHistories } from '../extension/vc-model-settings/desktop/standalone/chat-history.js';

const EPOCH = '9007199254740993';
const BASE = 9007199254740995n;
const IDS = ['chat-a', 'chat-b', 'chat-c'];

const httpError = (status, code) => Object.assign(new Error(code), { status, code });
const deferred = () => Promise.withResolvers();

function message(id, data = {}, candidateData = {}) {
    return {
        messageId: id,
        messageRevision: '1',
        position: 'opaque:' + id,
        view: 'full',
        selectedCandidateId: id + '-selected',
        candidateCount: 2,
        candidates: [
            { candidateId: id + '-selected', sourceRevision: '1', sourceGeneration: '1', data: { mes: 'synthetic' } },
            { candidateId: id + '-old', sourceRevision: '2', sourceGeneration: '3', data: candidateData },
        ],
        data,
    };
}

function fixture(records, { pageSize = 200, changePageSize = 50, chatId = IDS[0], hook } = {}) {
    const items = new Map(records.map(row => [row.messageId, row]));
    const order = [...items.keys()];
    const positions = new Map(order.map((id, index) => [id, index]));
    const cursors = new Map();
    const events = [];
    const calls = [];
    let epoch = EPOCH;
    let version = BASE;
    let metadata = BASE - 1n;
    let orderVersion = BASE - 2n;
    let isDeleted = false;

    const chat = () => ({
        chatId, authorityEpoch: epoch, chatRevision: String(version),
        metadataRevision: String(metadata), orderRevision: String(orderVersion),
        messageCount: items.size, metadata: { synthetic: String(metadata) }, header: { synthetic: true },
    });

    function change({ changed = [], deletedIds = [], orderChanged = false, metadataChanged = false, deleted = false } = {}) {
        version++;
        if (metadataChanged) metadata++;
        if (orderChanged) orderVersion++;
        for (const row of changed) {
            if (!positions.has(row.messageId)) {
                positions.set(row.messageId, order.length);
                order.push(row.messageId);
            }
            items.set(row.messageId, row);
        }
        deletedIds.forEach(id => items.delete(id));
        events.push({
            ...chat(), changedIds: changed.map(row => row.messageId).sort(), deletedIds,
            metadataChanged, orderChanged, deleted,
        });
    }

    async function request(method, path, body, { signal }) {
        assert.equal(method, 'GET');
        assert.equal(body, undefined);
        const { pathname, searchParams } = new URL(path, 'https://fake.invalid');
        const [, , , , requestedId, route, messageId] = pathname.split('/');
        assert.equal(requestedId, chatId);
        const call = { route, query: searchParams, messageId, signal };
        calls.push(call);
        const replaced = await hook?.(call);
        if (replaced !== undefined) return replaced;
        signal.throwIfAborted();
        if (isDeleted) throw httpError(404, 'NOT_FOUND_OR_FORBIDDEN');
        const current = chat();
        if (!route) return current;
        if (route === 'changes') {
            const after = BigInt(searchParams.get('afterRevision'));
            const later = events.filter(change => BigInt(change.chatRevision) > after);
            const slice = later.slice(0, changePageSize);
            return {
                chatId, authorityEpoch: epoch, items: slice,
                throughRevision: slice.at(-1)?.chatRevision ?? String(after),
                currentRevision: String(version), hasMore: later.length > slice.length,
            };
        }

        assert.equal(route, 'messages');
        if (messageId) {
            if (!items.has(messageId)) throw httpError(404, 'NOT_FOUND_OR_FORBIDDEN');
            return items.get(messageId);
        }
        const view = searchParams.get('view');
        const limit = Math.min(pageSize, Number(searchParams.get('limit')));
        const before = searchParams.get('before');
        const after = searchParams.get('after');
        const saved = cursors.get(before || after);
        if ((before || after) && (!saved || saved.orderVersion !== orderVersion || saved.epoch !== epoch)) {
            throw httpError(410, 'CHAT_CURSOR_EXPIRED');
        }
        const active = order.filter(id => items.has(id));
        const filtered = saved
            ? active.filter(id => before ? positions.get(id) < saved.position : positions.get(id) > saved.position)
            : active;
        const selected = after ? filtered.slice(0, limit) : filtered.slice(-limit);
        const cursor = id => {
            if (id === undefined) return null;
            const key = 'cursor/' + view + '/' + id + '/' + orderVersion;
            cursors.set(key, { epoch, orderVersion, position: positions.get(id) });
            return key;
        };
        const { chatRevision, metadataRevision, orderRevision, authorityEpoch } = current;
        return {
            chatId, chatRevision, metadataRevision, orderRevision, authorityEpoch,
            items: selected.map(id => {
                const full = items.get(id);
                return view === 'full' ? full : { ...full, view, candidates: full.candidates.slice(0, 1), data: {} };
            }),
            beforeCursor: cursor(selected[0]),
            afterCursor: cursor(selected.at(-1)),
            hasOlder: !!selected.length && active[0] !== selected[0],
            hasNewer: !!selected.length && active.at(-1) !== selected.at(-1),
            ...(searchParams.has('include') ? { chat: current } : {}),
        };
    }

    return {
        request, calls, change, chat,
        ids: () => order.filter(id => items.has(id)),
        deleteChat: () => { isDeleted = true; },
        changeEpoch: () => { epoch = String(BigInt(epoch) + 1n); },
        reorder(nextOrder) {
            order.splice(0, order.length, ...nextOrder);
            order.forEach((id, index) => positions.set(id, index));
            change({ orderChanged: true });
        },
    };
}

function history(server) {
    return createChatHistory({ chatId: IDS[0], authorityEpoch: EPOCH, request: server.request });
}
const ids = result => result.messages.map(row => row.messageId);
const isFullStart = ({ route, query }) => route === 'messages' && query.get('view') === 'full' && query.has('include');

test('display returns first while a 20,000-row full scan preserves every ID and oldest unknown candidate', async () => {
    const records = Array.from({ length: 20_000 }, (_, i) => message(String(i), {}, { plugin: { unknown: i } }));
    const pending = deferred();
    const entered = deferred();
    const server = fixture(records, { hook: call => {
        if (isFullStart(call)) {
            entered.resolve();
            return pending.promise;
        }
    } });
    const h = history(server);
    const full = h.loadFull();
    await entered.promise;
    const display = await h.loadDisplay();
    assert.equal(display.messages.length, 50);
    assert.equal(display.messages[0].messageId, '19950');
    assert.equal(display.messages[0].view, 'display');
    assert.equal(display.messages[0].candidates.length, 1);
    assert.throws(() => h.snapshot(), { code: 'REVISION_CONFLICT' });
    pending.resolve();
    const snapshot = await full;
    assert.equal(h.snapshot(), snapshot);
    assert.deepEqual(ids(snapshot), records.map(row => row.messageId));
    assert.deepEqual(snapshot.messages[0], records[0]);
    assert.deepEqual(snapshot.messages[0].candidates[1].data, { plugin: { unknown: 0 } });
    assert.equal(server.calls[0].query.get('limit'), '200');
    assert.equal(server.calls[1].query.get('limit'), '50');
    const desktop = await h.loadDisplay({ limit: 80 });
    assert.equal(desktop.messages.length, 80);
    assert.equal(desktop.messages[0].messageId, '19920');
    assert.equal(server.calls.at(-1).query.get('limit'), '80');
});

test('mixed current pages catch up complete changes and preserve append order from the server', async () => {
    let moved = false;
    let finalized = false;
    let reading = 0;
    let maxReading = 0;
    const server = fixture(['a', 'b', 'c', 'd', 'e'].map(id => message(id)), {
        pageSize: 2,
        changePageSize: 1,
        async hook(call) {
            if (call.query.has('before') && !moved) {
                moved = true;
                server.change({
                    changed: [message('d', { updated: 1 }), message('z'), message('f'), message('y')],
                    deletedIds: ['b', 'e'],
                    metadataChanged: true,
                });
                server.change({ deletedIds: ['f'] });
            }
            if (call.messageId) {
                maxReading = Math.max(maxReading, ++reading);
                await new Promise(resolve => setImmediate(resolve));
                reading--;
            }
            if (!call.route && !finalized) {
                finalized = true;
                server.change({ changed: [message('t'), message('g')], metadataChanged: true });
            }
        },
    });
    const h = history(server);
    const progress = [];
    const result = await h.loadFull({ onProgress: value => progress.push(value) });
    assert.deepEqual(ids(result), ['a', 'c', 'd', 'z', 'y', 't', 'g']);
    assert.deepEqual(result.messages[2].data, { updated: 1 });
    assert.equal(result.chat.chatRevision, String(BASE + 3n));
    assert.equal(result.chat.metadataRevision, String(BASE + 1n));
    assert.equal(maxReading, 2);
    assert.deepEqual(server.calls.filter(call => call.route === 'changes').map(call => call.query.get('afterRevision')),
        [String(BASE), String(BASE + 1n), String(BASE + 2n)]);
    assert(server.calls.some(call => call.query.has('after')));
    assert.equal(progress.at(-1).phase, 'ready');
    assert(progress.every(event => Object.keys(event).sort().join() === 'loaded,phase'));

    server.change({ changed: [message('a', { afterSync: true }), message('p')], deletedIds: ['t'] });
    const synced = await h.sync();
    assert.deepEqual(ids(synced), server.ids());
    assert.deepEqual(synced.messages[0].data, { afterSync: true });
    assert.equal(server.calls.filter(isFullStart).length, 1);
});

test('an initially empty chat catches up append transactions beyond a single tail page', async () => {
    let appended = false;
    const server = fixture([], { pageSize: 2, hook: ({ route }) => {
        if (route === 'changes' && !appended) {
            appended = true;
            server.change({ changed: ['z', 'b', 'y', 'a', 'x'].map(id => message(id)) });
        }
    } });
    assert.deepEqual(ids(await history(server).loadFull()), server.ids());
});

test('rebuild on cursor expiration, order change and expired changes', async () => {
    for (const mode of ['cursor', 'reorder', 'expired']) {
        let fired = false;
        const server = fixture(['a', 'b', 'c'].map(id => message(id)), { pageSize: 2, hook: ({ query, route }) => {
            if (fired) return;
            if (mode === 'cursor' && query.has('before')) {
                fired = true;
                throw httpError(410, 'CHAT_CURSOR_EXPIRED');
            }
            if (mode === 'reorder' && route === 'changes') {
                fired = true;
                server.reorder(['c', 'b', 'a']);
            }
            if (mode === 'expired' && route === 'changes') {
                fired = true;
                server.change({ changed: [message('d')] });
                throw httpError(410, 'CHAT_CHANGES_EXPIRED');
            }
        } });
        assert.deepEqual(ids(await history(server).loadFull()), server.ids(), mode);
        assert.equal(server.calls.filter(isFullStart).length, 2, mode);
    }
});

test('stalled pages, missing messages and repeated rebuilds fail without publishing a snapshot', async () => {
    for (const mode of ['cursor', 'missing', 'repeat', 'churn', 'changes']) {
        let start;
        const server = fixture(['a', 'b', 'c'].map(id => message(id)), { pageSize: 2, hook: call => {
            const { query, route } = call;
            if (query.has('before') && mode === 'cursor') {
                return { ...server.chat(), items: [message('a')], beforeCursor: query.get('before'), hasOlder: true };
            }
            if (query.has('before') && mode === 'missing') {
                return { ...server.chat(), items: [], beforeCursor: null, hasOlder: false };
            }
            if (query.has('before') && (mode === 'repeat' || mode === 'churn')) {
                if (mode === 'churn') server.change();
                throw httpError(410, 'CHAT_CURSOR_EXPIRED');
            }
            if (route === 'changes' && mode === 'changes') {
                start = query.get('afterRevision');
                return { ...server.chat(), items: [], throughRevision: start, currentRevision: String(BigInt(start) + 1n), hasMore: true };
            }
        } });
        const h = history(server);
        await assert.rejects(h.loadFull(), { code: 'REVISION_CONFLICT', status: 409 }, mode);
        assert.throws(() => h.snapshot(), { code: 'REVISION_CONFLICT' });
        if (mode === 'repeat') assert.equal(server.calls.filter(isFullStart).length, 2);
        if (mode === 'churn') assert.equal(server.calls.filter(isFullStart).length, 4);
    }
});

test('whole-chat deletion and authority changes immediately evict the full cache and fence further reads', async () => {
    for (const mode of ['not-found', 'tombstone', 'authority']) {
        const server = fixture([message('a')]);
        const h = history(server);
        await h.loadFull();
        if (mode === 'authority') server.changeEpoch();
        if (mode === 'not-found') server.deleteChat();
        if (mode === 'tombstone') server.change({ deleted: true });
        const error = mode === 'authority' ? { status: 409, code: 'CHAT_AUTHORITY_CHANGED' }
            : { status: 404, code: 'NOT_FOUND_OR_FORBIDDEN' };
        await assert.rejects(h.sync(), error);
        assert.throws(() => h.snapshot(), { code: 'REVISION_CONFLICT' });
        const calls = server.calls.length;
        await assert.rejects(h.loadDisplay(), error);
        assert.equal(server.calls.length, calls);
    }
});

test('invalidation cancels pending work even when its transport finishes late', async () => {
    const pending = deferred();
    const started = deferred();
    let blocked = false;
    const server = fixture([message('a')], { hook: call => {
        if (isFullStart(call) && !blocked) {
            blocked = true;
            started.resolve(call.signal);
            return pending.promise;
        }
    } });
    const h = history(server);
    const old = h.loadFull();
    const oldSignal = await started.promise;
    h.invalidate();
    assert(oldSignal.aborted);
    await assert.rejects(old, { name: 'AbortError' });
    server.change({ changed: [message('b')] });
    const current = await h.loadFull();
    pending.resolve({ ...server.chat(), authorityEpoch: '1' });
    await Promise.resolve();
    assert.equal(h.snapshot(), current);
    assert.deepEqual(ids(current), ['a', 'b']);
    h.close();
    assert.throws(() => h.snapshot(), { code: 'REVISION_CONFLICT' });
    await assert.rejects(h.loadFull(), { name: 'AbortError' });
});

test('cross-chat preserves input order and reads at most two chats concurrently', async () => {
    const gates = IDS.map(() => deferred());
    const entered = IDS.map(() => deferred());
    const servers = IDS.map((chatId, index) => fixture([message(chatId)], {
        chatId, async hook(call) {
            if (isFullStart(call)) {
                entered[index].resolve(call.signal);
                await gates[index].promise;
            }
        },
    }));
    const request = (method, path, ...args) => servers[IDS.indexOf(path.split('/')[4])].request(method, path, ...args);
    const run = readChatHistories(IDS, { authorityEpoch: EPOCH, request });
    await Promise.all(entered.slice(0, 2).map(gate => gate.promise));
    assert.equal(servers[2].calls.length, 0);
    gates[1].resolve();
    await entered[2].promise;
    gates[2].resolve();
    gates[0].resolve();
    assert.deepEqual((await run).map(result => result.chat.chatId), IDS);
});

test('cross-chat cancellation aborts sibling work and prevents queued starts or partial results', async () => {
    for (const mode of ['caller', 'request']) {
        const controller = new AbortController();
        const first = deferred();
        const sibling = deferred();
        const signals = [];
        const calls = [];
        const run = readChatHistories(IDS, {
            authorityEpoch: EPOCH,
            signal: controller.signal,
            request(_method, path, _body, { signal }) {
                const id = path.split('/')[4];
                calls.push(id);
                signals.push(signal);
                if (id === IDS[0]) return first.promise;
                sibling.resolve();
                return new Promise(() => {});
            },
        });
        await sibling.promise;
        if (mode === 'caller') {
            controller.abort();
            await assert.rejects(run, { name: 'AbortError' });
        } else {
            first.reject(httpError(503, 'SCHEMA_UNAVAILABLE'));
            await assert.rejects(run, { code: 'SCHEMA_UNAVAILABLE' });
        }
        assert.deepEqual(calls, IDS.slice(0, 2));
        assert(signals.every(signal => signal.aborted));
    }
});

test('cross-chat shares the 256 MiB UTF-8 budget and fails without a partial result', async () => {
    // Each synthetic chat fits independently. Two fit by JS character count only.
    const data = { plugin: '界'.repeat(300_000) };
    const servers = IDS.slice(0, 2).map(chatId => fixture(
        Array.from({ length: 151 }, (_, index) => message(String(index), data)), { chatId, pageSize: 20 },
    ));
    const request = (method, path, ...args) => servers[IDS.indexOf(path.split('/')[4])].request(method, path, ...args);
    await assert.rejects(readChatHistories(IDS.slice(0, 2), { authorityEpoch: EPOCH, request }),
        { status: 413, code: 'CHAT_PAYLOAD_TOO_LARGE' });
});
