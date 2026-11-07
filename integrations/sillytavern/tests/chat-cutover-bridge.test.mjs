// Synthetic loopback HTTP only. No test routes, credentials, or real account roots.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createChatStorageGate } from '../server-plugin/virtual-companion/lib/chat-storage-gate.js';
import { createChatCutoverBridge, CHAT_CUTOVER_PATHS } from '../server-plugin/virtual-companion/lib/chat-cutover-bridge.js';
import { createSourceBridge, SOURCE_BRIDGE_PATH } from '../server-plugin/virtual-companion/lib/source-bridge.js';
import { createInboxBridge, INBOX_BRIDGE_PATH } from '../server-plugin/virtual-companion/lib/inbox-bridge.js';
import { ADMIN_BRIDGE_ROUTES } from '../server-plugin/virtual-companion/lib/admin-bridge.js';
import { createHostAuth } from '../server-plugin/virtual-companion/lib/host-auth.js';
import { getF2Store } from '../server-plugin/virtual-companion/lib/f2-store.js';

const token = 'synthetic-cutover-token-012345678901234567890';
const identity = () => ({ ownerAccountId: '101', runId: randomUUID(), authorityEpoch: '90071992547409930001' });
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
async function fixture(t, { getUser = async (handle) => ({ handle, enabled: true }), controlTimeoutMs, routeTimeoutMs } = {}) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-chat-control-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const config = { serviceToken: token, accountHandles: { 101: 'synthetic-owner' }, goBaseUrl: 'http://go.invalid' };
    let diskResolvers = 0;
    const getUserDirectories = () => { diskResolvers++; return { root }; };
    const gate = createChatStorageGate({ accountHandles: config.accountHandles, getUserDirectories });
    const chatCutover = createChatCutoverBridge({ config, getUser, chatStorageGate: gate, controlTimeoutMs, routeTimeoutMs });
    const inbox = createInboxBridge({ config, getUser, getUserDirectories, chatStorageGate: gate });
    const sourceBridge = createSourceBridge({ config, getUser, getUserDirectories, chatStorageGate: gate, inbox, chatCutover });
    const host = createHostAuth({ config, getUser, sourceBridge, fetchImpl: async () => { throw new Error('no Go calls allowed'); } });
    const server = http.createServer(async (req, res) => {
        res.status = (status) => { res.statusCode = status; return res; };
        res.json = (body) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); return res; };
        try {
            const chunks = [];
            for await (const chunk of req) chunks.push(chunk);
            req.body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
            req.path = new URL(req.url, 'http://localhost').pathname;
            await host(req, res, () => { res.status(404).json({ code: 'NO_ROUTE' }); });
        } catch { if (!res.destroyed) res.status(500).json({ code: 'HARNESS_ERROR' }); }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
    const start = (target, body, headers = {}) => {
        const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: target, method: 'POST',
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers } });
        const result = new Promise((resolve, reject) => {
            req.on('error', reject);
            req.on('response', (res) => {
                const chunks = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(Buffer.concat(chunks).toString()) }));
                res.on('error', reject);
            });
        });
        // Attach immediately; deliberate client cancellation must not cause unhandled rejection.
        result.catch(() => {});
        req.end(JSON.stringify(body));
        return { req, result };
    };
    return { root, gate, config, start, call: (target, body, headers) => start(target, body, headers).result, diskResolvers: () => diskResolvers };
}

test('private HTTP validates token, every Origin, owner profile, and exact run/epoch; durable restart and memory-only status', async (t) => {
    const f = await fixture(t);
    const body = identity();
    for (const target of CHAT_CUTOVER_PATHS) {
        assert.equal(ADMIN_BRIDGE_ROUTES.some((route) => route.method === 'POST' && route.path.test(target)), false);
    }
    for (const headers of [{ origin: '' }, { origin: 'https://browser.invalid' }]) {
        const denied = await f.call(CHAT_CUTOVER_PATHS[0], body, headers);
        assert.equal(denied.status, 403); assert.equal(denied.body.code, 'ACCESS_DENIED');
    }
    assert.equal((await f.call(CHAT_CUTOVER_PATHS[0], body, { authorization: 'Bearer wrong' })).status, 401);
    assert.equal((await f.call(CHAT_CUTOVER_PATHS[0], { ...body, ownerAccountId: '102' })).status, 403);
    for (const value of [{ ...body, runId: 'bad' }, { ...body, authorityEpoch: '0' }, { ...body, extra: true }]) {
        assert.equal((await f.call(CHAT_CUTOVER_PATHS[0], value)).status, 400);
    }
    assert.equal((await f.call(CHAT_CUTOVER_PATHS[2], body)).body.code, 'REVISION_CONFLICT');
    const closed = await f.call(CHAT_CUTOVER_PATHS[0], body);
    assert.equal(closed.status, 200);
    assert.deepEqual(closed.body, { ...body, state: 'DRAINED', closed: true, durable: true, activeHandlers: 0 });
    const file = path.join(f.root, '.vc-f2/chat-cutover.json');
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
    const restarted = createChatStorageGate({ accountHandles: f.config.accountHandles, getUserDirectories: () => ({ root: f.root }) });
    assert.equal(restarted.enter('101'), null);
    // After startup, status must work even when the old root disappears.
    await fs.rename(f.root, `${f.root}-moved`);
    t.after(() => fs.rm(`${f.root}-moved`, { recursive: true, force: true }));
    const diskBefore = f.diskResolvers();
    assert.deepEqual((await f.call(CHAT_CUTOVER_PATHS[2], body)).body, closed.body);
    assert.equal(f.diskResolvers(), diskBefore);
    for (const other of [{ ...body, runId: randomUUID() }, { ...body, authorityEpoch: '2' }]) {
        for (const target of CHAT_CUTOVER_PATHS) {
            const response = await f.call(target, other);
            assert.equal(response.status, 409); assert.equal(response.body.code, 'REVISION_CONFLICT');
        }
    }
    assert.equal(f.gate.enter('101'), null);
    const inactive = await fixture(t, { getUser: async () => ({ handle: 'synthetic-owner', enabled: false }) });
    assert.equal((await inactive.call(CHAT_CUTOVER_PATHS[0], body)).status, 403);
    assert.equal(inactive.gate.status('101').closed, false);
});

test('cancelled sources/inbox remain active until real finally; drain cancellation keeps closed and late requests touch no disk', async (t) => {
    const f = await fixture(t);
    const store = getF2Store(f.root);
    const file = path.join(f.root, 'chats/synthetic/main.jsonl');
    const base = await store.save(file, [{ chat_metadata: {} }, { is_user: true, mes: 'synthetic' }], { expected: { id: randomUUID(), revision: 0 } });
    const sourcePaused = deferred(), sourceRelease = deferred(), inboxPaused = deferred(), inboxRelease = deferred();
    const originalSnapshot = store.sourceSnapshot.bind(store), originalRead = store.read.bind(store);
    store.sourceSnapshot = async (...args) => { sourcePaused.resolve(); await sourceRelease.promise; return originalSnapshot(...args); };
    let reads = 0;
    store.read = async (...args) => { if (++reads === 2) { inboxPaused.resolve(); await inboxRelease.promise; } return originalRead(...args); };
    t.after(() => { store.sourceSnapshot = originalSnapshot; store.read = originalRead; sourceRelease.resolve(); inboxRelease.resolve(); });
    const source = f.start(SOURCE_BRIDGE_PATH, { ownerAccountId: '101', chats: [{ chatIdentity: base.id }] });
    await sourcePaused.promise;
    const inbox = f.start(INBOX_BRIDGE_PATH, { ownerAccountId: '101', file, event: { eventId: 'synthetic-event', body: 'synthetic delivery' }, lease: { token: 'synthetic-lease', expiresAt: new Date(Date.now() + 60_000).toISOString() } });
    await inboxPaused.promise;
    assert.equal(f.gate.status('101').active, 2);
    source.req.destroy(); inbox.req.destroy();
    await Promise.allSettled([source.result, inbox.result]);
    assert.equal(f.gate.status('101').active, 2);
    const body = identity();
    assert.equal((await f.call(CHAT_CUTOVER_PATHS[0], body)).body.activeHandlers, 2);
    const before = f.diskResolvers();
    assert.equal((await f.call(SOURCE_BRIDGE_PATH, { ownerAccountId: '101', chats: [{ chatIdentity: base.id }] })).status, 409);
    assert.equal((await f.call(INBOX_BRIDGE_PATH, { ownerAccountId: '101', file })).status, 409);
    assert.equal(f.diskResolvers(), before);
    const waiting = deferred(), aborted = deferred();
    const originalIdle = f.gate.waitForIdle.bind(f.gate);
    f.gate.waitForIdle = (...args) => {
        args[1].signal.addEventListener('abort', () => aborted.resolve(), { once: true });
        waiting.resolve(); return originalIdle(...args);
    };
    const cancelled = f.start(CHAT_CUTOVER_PATHS[1], body);
    await waiting.promise;
    cancelled.req.destroy();
    await aborted.promise;
    assert.equal(f.gate.status('101').active, 2);
    assert.equal(f.gate.enter('101'), null);
    const retryWaiting = deferred();
    f.gate.waitForIdle = (...args) => { retryWaiting.resolve(); return originalIdle(...args); };
    let completed = false;
    const retry = f.call(CHAT_CUTOVER_PATHS[1], body).then((result) => { completed = true; return result; });
    await retryWaiting.promise;
    assert.equal(completed, false);
    sourceRelease.resolve();
    // Wait for the source handler's real finally through the authoritative count.
    while (f.gate.status('101').active === 2) await new Promise((resolve) => setImmediate(resolve));
    assert.equal(f.gate.status('101').active, 1); assert.equal(completed, false);
    inboxRelease.resolve();
    const drained = await retry;
    assert.equal(drained.status, 200); assert.equal(drained.body.state, 'DRAINED');
    assert.equal(drained.body.activeHandlers, 0);
});

test('bounded drain/route timeouts are typed, retryable, and never reopen or fake drain; local state failures are schema errors', async (t) => {
    const body = identity();
    const f = await fixture(t, { controlTimeoutMs: 25 });
    const release = f.gate.enter('101');
    // Establish durability outside the deliberately tiny HTTP wait budget; fsync speed is irrelevant here.
    await f.gate.closeAdmission('101', { runId: body.runId, epoch: body.authorityEpoch });
    const response = await f.call(CHAT_CUTOVER_PATHS[1], body);
    assert.equal(response.status, 503); assert.equal(response.body.code, 'CHAT_TRANSFER_TIMEOUT'); assert.equal(response.headers['retry-after'], '1');
    assert.equal(f.gate.status('101').active, 1); assert.equal(f.gate.enter('101'), null);
    release();
    assert.equal((await f.call(CHAT_CUTOVER_PATHS[1], body)).body.state, 'DRAINED');
    const route = await fixture(t, { getUser: () => new Promise(() => {}), controlTimeoutMs: 1000, routeTimeoutMs: 20 });
    const routeResult = await route.call(CHAT_CUTOVER_PATHS[0], body);
    assert.equal(routeResult.status, 503); assert.equal(routeResult.body.code, 'CHAT_TRANSFER_TIMEOUT');
    const broken = await fixture(t);
    await fs.writeFile(path.join(broken.root, '.vc-f2'), 'blocked');
    const failed = await broken.call(CHAT_CUTOVER_PATHS[0], body);
    assert.equal(failed.status, 503); assert.equal(failed.body.code, 'SCHEMA_UNAVAILABLE');
    assert.equal(broken.gate.enter('101'), null);
    assert.equal((await broken.call(CHAT_CUTOVER_PATHS[2], body)).body.code, 'SCHEMA_UNAVAILABLE');
});
