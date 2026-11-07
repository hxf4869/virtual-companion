// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import express from '../upstream/SillyTavern/node_modules/express/index.js';
import { parse } from '../upstream/SillyTavern/node_modules/acorn/dist/acorn.mjs';
import { applySpecToText } from '../scripts/lib/patcher.mjs';
import { createF2Hooks } from '../server-plugin/virtual-companion/lib/f2-routes.js';
import { getF2Store } from '../server-plugin/virtual-companion/lib/f2-store.js';
import { wrapChatStorageRouter } from '../server-plugin/virtual-companion/lib/chat-storage-router.js';
import { createChatStorageGate } from '../server-plugin/virtual-companion/lib/chat-storage-gate.js';
import { RESTORED_ALIAS_EXPECTATION } from '../server-plugin/virtual-companion/lib/restored-chat-aliases.js';

async function fixture(t, { group = false } = {}) {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'vc-sx8-alias-synthetic-')));
    const directories = { root, chats: path.join(root, 'chats'), groupChats: path.join(root, 'group chats'), backups: root };
    const physical = group ? 'group chats' : 'chats/avatar';
    const file = path.join(root, physical, 'current.jsonl');
    const store = getF2Store(root);
    let token = await store.save(file, [{ chat_metadata: {} }, { name: 'Synthetic', mes: 'restored synthetic', extra: {} }], { expected: { id: randomUUID(), revision: 0 } });
    const recordFile = path.join(root, '.vc-f2', `${token.id}.json`);
    const record = JSON.parse(await fs.readFile(recordFile));
    record.aliases = [`${physical}/old.jsonl`, `${physical}/current.jsonl`];
    await fs.writeFile(recordFile, JSON.stringify(record));
    await fs.writeFile(path.join(root, '.vc-f2/migration-manifest.archive'), JSON.stringify({ formatVersion: 1, direction: 'GO_TO_ST', ownerAccountId: '1', migrationRunId: 'synthetic-run', chats: [{ oldIdentity: token.id, kind: group ? 'GROUP' : 'SINGLE', characterRef: group ? null : 'logical-card', groupRef: group ? 'logical-group' : null, primaryFileName: 'current.jsonl', aliases: ['old.jsonl', 'current.jsonl'], state: 'live', messageAndCandidateIdentityRecords: [] }] }));
    await fs.writeFile(path.join(root, '.vc-f2/migration-resources.archive'), JSON.stringify({ version: 1, ownerAccountId: '1', runId: 'synthetic-run', characterDirectories: { 'logical-card': 'avatar' } }));
    const sharedUser = { profile: { handle: 'synthetic' }, directories };
    const f2 = createF2Hooks({ getUserDirectories: () => directories });
    const gate = createChatStorageGate({ accountHandles: { '1': 'synthetic' }, getUserDirectories: () => directories });
    const symbol = Symbol.for('virtual-companion.bridge'), previous = globalThis[symbol];
    globalThis[symbol] = { f2, chatStorageGate: gate };
    const app = express(); app.use(express.json());
    app.use((req, _res, next) => { req.user = sharedUser; req.vcIdentity = { accountId: '1', handle: 'synthetic' }; req.vcChatStorage = { mode: 'ST', authorityEpoch: '9' }; next(); });
    const router = express.Router();
    const input = await fs.readFile(new URL('../upstream/SillyTavern/src/endpoints/chats.js', import.meta.url), 'utf8');
    const spec = JSON.parse(await fs.readFile(new URL('../patches/st-f2-chats.json', import.meta.url)));
    const source = applySpecToText(input, spec).output;
    const declarations = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body.filter((node) => node.expression?.callee?.object?.name === 'router').map((node) => source.slice(node.start, node.end)).join('\n');
    const globals = { validateAvatarUrlMiddleware: (_q, _s, next) => next(), getFileNameValidationFunction: () => (_q, _s, next) => next(), path, fs: fsSync, sanitize: (v) => v, isPathUnderParent: (parent, target) => target.startsWith(parent + '/'),
        vcF2: () => f2, vcF2Error: (error, res) => { if (!error.code?.startsWith('VC_')) return false; res.status(error.status).json({ code: error.code }); return true; },
        trySaveChat: (chat, target, _force, handle) => f2.save(handle, target, chat), IntegrityMismatchError: class extends Error {},
        getChatInfo: () => assert.fail('restored group info must use fenced F2 snapshot'),
    };
    new Function('router', ...Object.keys(globals), declarations)(router, ...Object.values(globals));
    app.use('/api/chats', wrapChatStorageRouter(router, '/api/chats'));
    app.use((error, _req, res, _next) => res.status(500).json({ code: error.code || 'TEST_ERROR' }));
    const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    t.after(async () => { server.closeAllConnections(); await new Promise((done) => server.close(done)); globalThis[symbol] = previous; await fs.rm(root, { recursive: true, force: true }); });
    return { root, directories, file, store, token, sharedUser, f2, gate,
        async request(route, body) { return fetch(`http://127.0.0.1:${server.address().port}/api/chats${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ avatar_url: 'avatar.png', ...body }) }); },
    };
}
test('patched native get/save/rename resolves restored aliases against current ledger without shared request state', async (t) => {
    const f = await fixture(t);
    const first = await (await f.request('/get', { file_name: 'old' })).json();
    assert.equal(first[0].chat_metadata.vc_f2.id, f.token.id);
    assert.equal(first[1].mes, 'restored synthetic');
    assert.equal(f.sharedUser[RESTORED_ALIAS_EXPECTATION], undefined);
    first[1].mes = 'saved synthetic';
    const saved = await (await f.request('/save', { file_name: 'old', chat: first })).json();
    assert.equal(saved.vc_f2.revision, f.token.revision + 1);
    const log = console.debug, info = console.info;
    console.debug = () => {}; console.info = () => {};
    let renamed;
    try { renamed = await (await f.request('/rename', { original_file: 'old.jsonl', renamed_file: 'new.jsonl', vc_f2: saved.vc_f2 })).json(); }
    finally { console.debug = log; console.info = info; }
    assert.equal(renamed.vc_f2.id, f.token.id);
    assert.equal((await (await f.request('/get', { file_name: 'current' })).json())[1].mes, 'saved synthetic');
    assert.equal((await (await f.request('/get', { file_name: 'new' })).json())[0].chat_metadata.vc_f2.id, f.token.id);
    assert.equal((await f.request('/save', { file_name: 'old', chat: [{ chat_metadata: { vc_f2: { id: randomUUID(), revision: 0 } } }] })).status, 409);
    assert.equal(f.gate.status('1').active, 0);
});
test('deleted restored aliases never read or overwrite a later same-path identity; expected read is checked inside F2 lock', async (t) => {
    const f = await fixture(t);
    const staleUser = { ...f.sharedUser, [RESTORED_ALIAS_EXPECTATION]: { path: f.file, expectedIdentity: f.token.id } };
    await f.store.remove(f.file, { expected: f.token });
    await f.store.save(f.file, [{ chat_metadata: {} }, { mes: 'later identity synthetic' }], { expected: { id: randomUUID(), revision: 0 } });
    for (const file_name of ['old', 'current']) assert.equal((await f.request('/get', { file_name })).status, 409);
    await assert.rejects(f.f2.read(staleUser, f.file), { code: 'VC_CHAT_DELETED' });
    assert.equal((await f.store.read(f.file))[1].mes, 'later identity synthetic');
});
test('restored alias export takes one fenced immutable F2 snapshot and retains original JSONL bytes', async (t) => {
    const f = await fixture(t);
    const raw = (await fs.readFile(f.file, 'utf8')).replace('"chat_metadata":{', '"large":900719925474099312345,"chat_metadata":{');
    await fs.writeFile(f.file, raw);
    const response = await f.request('/export', { file: 'old.jsonl', exportfilename: 'synthetic.jsonl', format: 'jsonl' });
    assert.equal(response.status, 200); assert.equal((await response.json()).result, raw);
    const text = await (await f.request('/export', { file: 'old.jsonl', exportfilename: 'synthetic.txt', format: 'txt' })).json();
    assert.equal(text.result, 'Synthetic: restored synthetic\n\n');
    await fs.mkdir(path.join(f.root, 'chats/other'));
    assert.deepEqual(await (await f.request('/get', { avatar_url: 'other.png', file_name: 'old' })).json(), []);
});
test('restored GROUP get/info/save/delete use the original group alias and current F2 identity', async (t) => {
    const f = await fixture(t, { group: true });
    const chat = await (await f.request('/group/get', { id: 'old' })).json();
    assert.equal(chat[0].chat_metadata.vc_f2.id, f.token.id);
    const info = await (await f.request('/group/info', { id: 'old' })).json();
    assert.equal(info.file_name, 'current.jsonl'); assert.equal(info.chat_items, 1);
    const saved = await (await f.request('/group/save', { id: 'old', chat })).json();
    assert.equal(saved.vc_f2.id, f.token.id);
    assert.equal((await f.request('/group/delete', { id: 'old', vc_f2: saved.vc_f2 })).status, 200);
    assert.equal((await f.request('/group/get', { id: 'old' })).status, 409);
});
