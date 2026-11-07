import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import express from '../upstream/SillyTavern/node_modules/express/index.js';
import { parse } from '../upstream/SillyTavern/node_modules/acorn/dist/acorn.mjs';
import throttle from '../upstream/SillyTavern/node_modules/lodash/throttle.js';
import readline from 'node:readline';
import { finished } from 'node:stream/promises';
import { PassThrough } from 'node:stream';
import { wrapChatStorageRouter } from '../server-plugin/virtual-companion/lib/chat-storage-router.js';
import { createChatStorageGate } from '../server-plugin/virtual-companion/lib/chat-storage-gate.js';
import { applySpecToText } from '../scripts/lib/patcher.mjs';

const BRIDGE = Symbol.for('virtual-companion.bridge');
const freeze = { runId: '00000000-0000-4000-8000-000000000001', epoch: '2' };
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

async function nativeSource(name) {
    let source = await fs.readFile(new URL(`../upstream/SillyTavern/src/endpoints/${name}.js`, import.meta.url), 'utf8');
    if (['chats', 'characters', 'groups', 'data-maid'].includes(name)) {
        const spec = JSON.parse(await fs.readFile(new URL(`../patches/st-f2-${name}.json`, import.meta.url)));
        source = applySpecToText(source, spec).output;
    }
    return source;
}

function registrations(source) {
    return parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body.filter((node) =>
        node.type === 'ExpressionStatement' && node.expression.type === 'CallExpression'
        && node.expression.callee.type === 'MemberExpression' && node.expression.callee.object.name === 'router');
}

async function registerNative(name, router, globals) {
    const source = await nativeSource(name);
    const declarations = registrations(source).map((node) => source.slice(node.start, node.end)).join('\n');
    const context = { validateAvatarUrlMiddleware: (_req, _res, next) => next(), getFileNameValidationFunction: () => (_req, _res, next) => next(), ...globals };
    new Function('router', ...Object.keys(context), declarations)(router, ...Object.values(context));
}

async function fixture(t, { mount = '/api/chats', identity = true, hint = { mode: 'ST', authorityEpoch: '1' }, middleware, onClose } = {}) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-native-drain-'));
    await fs.mkdir(path.join(root, 'chats/card'), { recursive: true });
    const gate = createChatStorageGate({ accountHandles: { '42': 'owner' }, getUserDirectories: () => ({ root }), onClose });
    const bridge = { chatStorageGate: gate };
    const previous = globalThis[BRIDGE];
    globalThis[BRIDGE] = bridge;
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        if (identity) req.vcIdentity = { accountId: '42', sessionId: '7', handle: 'owner' };
        req.vcChatStorage = hint;
        req.user = { profile: { handle: 'owner' }, directories: { root, chats: path.join(root, 'chats'), backups: root } };
        if (middleware) middleware(req, res);
        next();
    });
    const router = express.Router();
    let server;
    t.after(async () => {
        if (server) { server.closeAllConnections(); await new Promise((r) => server.close(r)); }
        globalThis[BRIDGE] = previous;
        await fs.rm(root, { recursive: true, force: true });
    });
    return {
        gate, bridge, root, router,
        async listen() {
            app.use(mount, wrapChatStorageRouter(router, mount));
            app.use((err, _req, res, _next) => { if (!res.headersSent) res.status(500).json({ code: 'TEST_HANDLER_FAILED' }); });
            server = app.listen(0, '127.0.0.1');
            await once(server, 'listening');
            return `http://127.0.0.1:${server.address().port}${mount}`;
        },
    };
}

test('real HTTP: canceled read and save stay active until their handler finally blocks end', async (t) => {
    for (const route of ['/get', '/save']) await t.test(route, async (t) => {
        const f = await fixture(t);
        const entered = deferred(), proceed = deferred(), finished = deferred();
        let touched = 0;
        const file = path.join(f.root, 'synthetic.jsonl');
        await fs.writeFile(file, 'synthetic');
        const operation = async () => {
            entered.resolve();
            try {
                await proceed.promise;
                if (route === '/get') await fs.readFile(file);
                else await fs.writeFile(file, 'synthetic save');
                touched += 1;
                return [];
            }
            finally { finished.resolve(); }
        };
        await registerNative('chats', f.router, {
            path, sanitize: (v) => v, fs: fsSync, isPathUnderParent: () => true,
            vcF2: () => ({ read: operation }), vcF2Error: () => false,
            trySaveChat: operation, IntegrityMismatchError: class extends Error {},
        });
        const base = await f.listen();
        // These are actual patched ST business handlers, with only their F2
        // disk boundary paused against synthetic temporary files.
        const body = JSON.stringify({ avatar_url: 'card.png', file_name: 'synthetic', chat: [] });
        const client = http.request(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
        client.on('error', () => {});
        client.end(body);
        await entered.promise;
        assert.equal(f.gate.status('42').active, 1);
        await f.gate.closeAdmission('42', freeze);
        const closed = new Promise((r) => client.once('close', r)); client.destroy(); await closed;
        assert.equal(f.gate.status('42').active, 1);
        let drained = false;
        const drain = f.gate.waitForIdle('42').then(() => { drained = true; });
        await new Promise(setImmediate);
        assert.equal(drained, false);
        const late = await fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
        assert.equal(late.status, 409); assert.equal(touched, 0);
        proceed.resolve(); await finished.promise; await drain;
        assert.equal(touched, 1); assert.equal(f.gate.status('42').active, 0);
    });
});

test('real HTTP: response finish never releases a still-running business handler; errors release in finally', async (t) => {
    const f = await fixture(t);
    const proceed = deferred();
    f.router.post('/save', async (_req, res) => { res.json({ ok: true }); await proceed.promise; throw new Error('synthetic'); });
    const base = await f.listen();
    assert.equal((await fetch(base + '/save', { method: 'POST' })).status, 200);
    assert.equal(f.gate.status('42').active, 1);
    await f.gate.closeAdmission('42', freeze);
    const drained = f.gate.waitForIdle('42');
    proceed.resolve(); await drained;
    assert.equal(f.gate.status('42').active, 0);
});

test('real HTTP: validators and late JSON body complete before admission; closed gate performs no business I/O', async (t) => {
    const f = await fixture(t);
    let touched = 0;
    f.router.post('/save', (req, res, next) => req.body.invalid ? res.sendStatus(400) : next(), () => { touched += 1; });
    const base = await f.listen();
    assert.equal((await fetch(base + '/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"invalid":true}' })).status, 400);
    assert.equal(f.gate.status('42').active, 0);
    const request = http.request(base + '/save', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    const response = new Promise((r) => request.once('response', r));
    request.write('{"payload":');
    await f.gate.closeAdmission('42', freeze);
    request.end('true}');
    const res = await response; res.resume(); await once(res, 'end');
    assert.equal(res.statusCode, 409); assert.equal(touched, 0);
    assert.equal(f.gate.status('42').active, 0);
});

test('mixed resource routes retain native behavior and chat-only normalization matches Express', async (t) => {
    const f = await fixture(t, { mount: '/api/characters' });
    let touched = 0;
    f.router.post('/all', (_req, res) => { touched += 1; res.json({ ok: true }); });
    f.router.post('/edit', (_req, res) => { touched += 1; res.json({ ok: true }); });
    const base = await f.listen();
    await f.gate.closeAdmission('42', freeze);
    for (const route of ['/all', '/ALL/', '//all']) assert.equal((await fetch(base + route, { method: 'POST' })).status, 409);
    for (const route of ['/all', '/edit']) assert.equal((await fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"vc_resource_only":true}' })).status, 200);
    assert.equal(touched, 2);
});

test('missing verified identity/hint/gate and FROZEN reject, GO bypasses the old gate and never falls through', async (t) => {
    for (const variant of [{ identity: false }, { hint: undefined }, { hint: { mode: 'FROZEN', authorityEpoch: '2' } }, { hint: { mode: 'GO', authorityEpoch: '3' } }, { missingGate: true }]) {
        await t.test(JSON.stringify(variant), async (t) => {
            const f = await fixture(t, { ...variant, ...(Object.hasOwn(variant, 'hint') && variant.hint === undefined ? { hint: null } : {}) });
            let touched = 0;
            f.router.post('/get', (_req, res) => { touched += 1; res.json({ old: true }); });
            const base = await f.listen();
            if (variant.missingGate) delete f.bridge.chatStorageGate;
            const res = await fetch(base + '/get', { method: 'POST' });
            assert.equal(res.status, ['FROZEN', 'GO'].includes(variant.hint?.mode) ? 409 : 503);
            assert.equal(touched, 0);
            if (variant.hint?.mode === 'GO') {
                f.bridge.chatStorageGate = { enter() { throw new Error('GO must bypass old gate'); } };
                f.bridge.nativeChat = (req, res, next) => { assert.equal(typeof next, 'function'); return res.json({ go: true }); };
                assert.deepEqual(await (await fetch(base + '/get', { method: 'POST' })).json(), { go: true });
                f.bridge.nativeChat = (req, res, next) => next();
                assert.equal((await fetch(base + '/get', { method: 'POST' })).status, 409);
                assert.equal(touched, 0);
            }
        });
    }
});

test('rejected multipart cleans only this authenticated request upload under root/.uploads', async (t) => {
    let upload;
    const f = await fixture(t, { middleware: (req) => { req.file = { path: upload }; } });
    f.router.post('/import', () => assert.fail('closed import must not run'));
    const base = await f.listen();
    await fs.mkdir(path.join(f.root, '.uploads'));
    upload = path.join(f.root, '.uploads', 'request');
    const other = path.join(f.root, '.uploads', 'other');
    await fs.writeFile(upload, 'synthetic upload'); await fs.writeFile(other, 'other request');
    await f.gate.closeAdmission('42', freeze);
    assert.equal((await fetch(base + '/import', { method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=synthetic' } })).status, 409);
    await assert.rejects(fs.stat(upload), { code: 'ENOENT' });
    assert.ok(await fs.stat(other));
    upload = path.join(f.root, 'outside-uploads'); await fs.writeFile(upload, 'keep');
    assert.equal((await fetch(base + '/import', { method: 'POST' })).status, 409);
    assert.ok(await fs.stat(upload));
});

test('real backup download callback, rather than socket finish, owns the file-transfer lifetime', async (t) => {
    const callbackAllowed = deferred(), callbackReached = deferred();
    const f = await fixture(t, { mount: '/api/backups', middleware: (_req, res) => {
        const sendFile = res.sendFile;
        res.sendFile = function (file, options, callback) {
            return sendFile.call(this, file, options, (error) => {
                callbackReached.resolve();
                callbackAllowed.promise.then(() => callback(error));
            });
        };
    } });
    const file = path.join(f.root, 'chat_synthetic.jsonl'); await fs.writeFile(file, 'synthetic');
    await registerNative('backups', f.router, { fs: fsSync, path, sanitize: (name) => name, CHAT_BACKUPS_PREFIX: 'chat_' });
    const base = await f.listen();
    const response = await fetch(base + '/chat/download', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: path.basename(file) }) });
    assert.equal(await response.text(), 'synthetic'); await callbackReached.promise;
    assert.equal(f.gate.status('42').active, 1);
    await f.gate.closeAdmission('42', freeze);
    const drain = f.gate.waitForIdle('42');
    callbackAllowed.resolve(); await drain;
    assert.equal(f.gate.status('42').active, 0);
});

test('a backup file-transfer error releases admission and follows the Express error path', async (t) => {
    const f = await fixture(t, { mount: '/api/backups' });
    await registerNative('backups', f.router, { fs: { existsSync: () => true }, path, sanitize: (name) => name, CHAT_BACKUPS_PREFIX: 'chat_' });
    const base = await f.listen();
    const response = await fetch(base + '/chat/download', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"name":"chat_vanished.jsonl"}' });
    assert.equal(response.status, 500);
    assert.equal((await response.json()).code, 'TEST_HANDLER_FAILED');
    assert.equal(f.gate.status('42').active, 0);
});

test('actual Data Maid view retains admission through its awaited disk read after client cancellation', async (t) => {
    const f = await fixture(t, { mount: '/api/data-maid' });
    const file = path.join(f.root, 'synthetic.jsonl'); await fs.writeFile(file, 'synthetic');
    const entered = deferred(), proceed = deferred();
    await registerNative('data-maid', f.router, {
        DataMaidService: { TOKENS: new Map([['synthetic', { handle: 'owner', paths: [{ hash: 'entry', path: file }] }]]) },
        isPathUnderParent: () => true, mime: { lookup: () => 'text/plain' },
        fs: { existsSync: fsSync.existsSync, promises: { async readFile(target) { entered.resolve(); await proceed.promise; return fs.readFile(target); } } },
    });
    const base = await f.listen();
    const client = http.request(base + '/view?token=synthetic&hash=entry'); client.on('error', () => {}); client.end();
    await entered.promise; await f.gate.closeAdmission('42', freeze);
    const closed = new Promise((r) => client.once('close', r)); client.destroy(); await closed;
    assert.equal(f.gate.status('42').active, 1);
    const drained = f.gate.waitForIdle('42'); proceed.resolve(); await drained;
    assert.equal(f.gate.status('42').active, 0);
});

test('locked six routers all end in one business handler; deterministic server patch wraps exactly their real mounts', async () => {
    for (const name of ['chats', 'characters', 'groups', 'stats', 'data-maid', 'backups']) {
        const source = await nativeSource(name);
        const entries = registrations(source);
        assert.ok(entries.length > 0, name);
        for (const node of entries) {
            const handler = node.expression.arguments.at(-1);
            assert.ok(['FunctionExpression', 'ArrowFunctionExpression'].includes(handler.type), name);
            assert.equal(handler.params.length, 2, `${name} ${node.expression.arguments[0].value}`);
        }
    }
    const input = await fs.readFile(new URL('../upstream/SillyTavern/src/server-main.js', import.meta.url), 'utf8');
    const spec = JSON.parse(await fs.readFile(new URL('../patches/st-host-auth.json', import.meta.url)));
    const applied = applySpecToText(input, spec);
    assert.equal(applied.outputSha256, spec.expected_output_sha256);
    assert.match(applied.output, /import \{ wrapChatStorageRouter \} from '\.\.\/plugins\/virtual-companion\/lib\/chat-storage-router.js'/);
    const startup = await fs.readFile(new URL('../upstream/SillyTavern/src/server-startup.js', import.meta.url), 'utf8');
    const setup = parse(startup, { ecmaVersion: 'latest', sourceType: 'module' }).body.find((n) => n.declaration?.id?.name === 'setupPrivateEndpoints').declaration;
    const names = setup.body.body.map((node) => node.expression.arguments[1].name);
    const routers = names.map(() => ({}));
    const register = new Function(...names, `${startup.slice(setup.start, setup.end)}; return setupPrivateEndpoints;`)(...routers);
    const wrapped = [], mounted = [];
    const wrapper = (router, mount) => { wrapped.push(mount); return router; };
    const app = { use(...args) { mounted.push(args); return this; } };
    const hook = spec.replacements.find((r) => r.from === 'setupPrivateEndpoints(app);').to;
    new Function('app', 'wrapChatStorageRouter', 'setupPrivateEndpoints', hook)(app, wrapper, register);
    assert.deepEqual(wrapped.sort(), ['/api/backups', '/api/characters', '/api/chats', '/api/data-maid', '/api/groups', '/api/stats']);
    assert.equal(mounted.length, names.length);
    for (let i = 0; i < mounted.length; i += 1) assert.equal(mounted[i][1], routers[i]);
    // The use adapter forwards every argument, even though the locked setup
    // currently supplies exactly one router per mount.
    const a = {}, b = {};
    mounted.length = 0;
    new Function('app', 'wrapChatStorageRouter', 'setupPrivateEndpoints', hook)(app, wrapper, (facade) => facade.use('/api/settings', a, b));
    assert.deepEqual(mounted, [['/api/settings', a, b]]);
});

test('actual text export waits for its readline/file lifetime, including errors, after a disconnected caller', async (t) => {
    for (const failure of [false, true]) await t.test(failure ? 'read error' : 'complete', async (t) => {
        const f = await fixture(t);
        const stream = new PassThrough();
        const opened = deferred();
        // The real patched handler retains readline and its file-completion
        // promise; only the synthetic file source is paused here.
        await registerNative('chats', f.router, {
            path, sanitize: (name) => name, isPathUnderParent: () => true, finished, readline,
            fs: { existsSync: () => true, createReadStream() { opened.resolve(); return stream; } },
        });
        const base = await f.listen();
        const client = http.request(base + '/export', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
        client.on('error', () => {});
        client.end(JSON.stringify({ file: 'synthetic.jsonl', avatar_url: 'card.png', exportfilename: 'synthetic.txt', format: 'txt' }));
        await opened.promise;
        await f.gate.closeAdmission('42', freeze);
        const closed = new Promise((r) => client.once('close', r)); client.destroy(); await closed;
        assert.equal(f.gate.status('42').active, 1);
        const drained = f.gate.waitForIdle('42');
        const log = console.error, info = console.info;
        const logs = [];
        console.error = (...args) => logs.push(args); console.info = (...args) => logs.push(args);
        try {
            if (failure) stream.destroy(new Error('synthetic read error'));
            else stream.end('{"name":"Synthetic","mes":"line"}\n');
            await drained;
        } finally { console.error = log; console.info = info; }
        assert.deepEqual(logs, [[failure ? 'chat export failed.' : 'Chat exported.']]);
        assert.equal(stream.closed, true);
        assert.equal(f.gate.status('42').active, 0);
    });
});

test('freeze flushes only this Owner pending backups, including a save that queues its backup after freeze', async (t) => {
    const source = await nativeSource('chats');
    const declaration = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body.find((n) => n.declaration?.id?.name === 'flushChatBackups').declaration;
    const backups = new Map(), written = [];
    const flushChatBackups = new Function('backupFunctions', `${source.slice(declaration.start, declaration.end)}; return flushChatBackups;`)(backups);
    for (const handle of ['owner', 'owner2']) backups.set(`${handle} card`, throttle((value) => written.push([handle, value]), 1000));
    t.after(() => { for (const backup of backups.values()) backup.cancel(); });
    const f = await fixture(t, { onClose: () => flushChatBackups('owner') });
    f.bridge.flushChatBackups = flushChatBackups;
    const pending = backups.get('owner card');
    pending('leading'); pending('pending');
    backups.get('owner2 card')('other leading'); backups.get('owner2 card')('other pending');
    const entered = deferred(), proceed = deferred();
    f.router.post('/save', async (_req, res) => { entered.resolve(); await proceed.promise; pending('admitted save'); res.json({ ok: true }); });
    const base = await f.listen();
    const response = fetch(base + '/save', { method: 'POST' }); await entered.promise;
    // Exercise the plugin's synchronous onClose callback, then the wrapper's
    // final flush for a handler which resumes after admission has closed.
    const closing = f.gate.closeAdmission('42', freeze);
    assert.deepEqual(written, [['owner', 'leading'], ['owner2', 'other leading'], ['owner', 'pending']]);
    await closing;
    const drained = f.gate.waitForIdle('42'); proceed.resolve();
    assert.equal((await response).status, 200); await drained;
    assert.deepEqual(written.at(-1), ['owner', 'admitted save']);
    assert.equal(written.some(([owner, value]) => owner === 'owner2' && value === 'other pending'), false);
    assert.equal(f.gate.status('42').active, 0);
});
