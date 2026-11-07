// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { exportSTSnapshot, restoreGoSnapshot, finalizeRestore, verifySTDrained } from '../scripts/chat-migration-snapshot.mjs';
import { getF2Store } from '../server-plugin/virtual-companion/lib/f2-store.js';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function setup(t) {
    const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'vc-sx8-synthetic-')));
    t.after(() => fs.rm(base, { recursive: true, force: true }));
    const root = path.join(base, 'st');
    await fs.mkdir(path.join(root, '.vc-f2'), { recursive: true });
    await fs.mkdir(path.join(root, 'chats/card'), { recursive: true });
    const options = { root, artifactRoot: path.join(base, 'snapshot'), supplementFile: path.join(base, 'supplement.json'), ownerAccountId: '1', migrationRunId: id(1), frozenAuthorityEpoch: '7', stBaseUrl: 'http://127.0.0.1:8000', accountHandles: { '1': 'synthetic' } };
    const source = (n) => ({ id: id(n), revision: 3, generation: 4, settled: true, sourceTimestamp: null, sourceTimezone: '' });
    const document = [{ chat_metadata: { vc_f2: { id: id(2), revision: 9 }, vc_branch_root: id(2), vc_binding: { chatIdentity: id(2), conversationId: '11', relationshipId: '12', characterRef: 'card' } } },
        { vc_message_id: id(3), mes: 'selected synthetic', swipes: ['old synthetic', 'selected synthetic'], swipe_id: 1, extra: { vc_source: source(5) }, swipe_info: [{ extra: { vc_source: source(4) } }, { extra: { vc_source: source(5) } }], variables: [{ x: 1 }, { x: 2 }] }];
    const candidate = (n, ordinal, deleted = false) => ({ candidateId: id(n), ordinal, sourceRevision: '3', sourceGeneration: '4', settled: true, everSelected: true, deleted });
    const chat = { oldIdentity: id(2), kind: 'SINGLE', characterRef: 'card', groupRef: null, conversationId: '11', relationshipId: '12', primaryFileName: 'current.jsonl', aliases: ['old.jsonl', 'current.jsonl'], branchRoot: id(2), chatRevision: '9', metadataRevision: '1', orderRevision: '1', sourceFile: 'chats/card/current.jsonl', sourceFileSha256: '', sourceFileByteCount: '0', messageCount: '1', candidateCount: '2', state: 'live',
        messageAndCandidateIdentityRecords: [{ messageId: id(3), messageRevision: '2', position: '1024', selectedCandidateId: id(5), deleted: false, candidates: [candidate(4, 0), candidate(6, 1, true), candidate(5, 2)] },
            { messageId: id(7), messageRevision: '3', position: '2048', selectedCandidateId: null, deleted: true, candidates: [candidate(8, 0, true)] }],
        sourceRecords: [4, 5, 6, 8].map((n) => ({ messageId: id(n === 8 ? 7 : 3), candidateId: id(n), sourceRevision: '3', sourceGeneration: '4', settled: true, sourceTimestamp: null, sourceTimezone: '', present: n === 5, eligible: n === 5, suppressed: n !== 5, conversationId: '11', appliedRevision: '9', branchRoot: id(2) })) };
    const manifest = { formatVersion: 1, migrationRunId: id(1), direction: 'ST_TO_GO', ownerAccountId: '1', frozenAuthorityEpoch: '7', chats: [chat], deletionAndSuppressionRecords: [] };
    const marker = { version: 1, ownerAccountId: '1', closed: true, runId: id(1), epoch: '7' };
    await fs.writeFile(path.join(root, '.vc-f2/chat-cutover.json'), JSON.stringify(marker));
    await fs.writeFile(path.join(root, `.vc-f2/${id(2)}.json`), JSON.stringify({ id: id(2), state: 'live', path: chat.sourceFile }));
    const raw = document.map(JSON.stringify).join('\r\n').replace('"x":1', '"x":900719925474099312345');
    await fs.writeFile(path.join(root, chat.sourceFile), raw);
    await fs.writeFile(options.supplementFile, JSON.stringify(manifest));
    const status = { ownerAccountId: '1', runId: id(1), authorityEpoch: '7', state: 'DRAINED', closed: true, durable: true, activeHandlers: 0 };
    const dependencies = { serviceToken: 's'.repeat(32), fetchImpl: async (_url, request) => {
        assert.equal(Object.hasOwn(request.headers, 'Origin'), false);
        assert.equal(Object.hasOwn(request.headers, 'origin'), false);
        assert.equal(request.redirect, 'error');
        assert.equal(request.headers.Authorization, 'Bearer ' + 's'.repeat(32));
        assert.deepEqual(JSON.parse(request.body), { ownerAccountId: '1', runId: id(1), authorityEpoch: '7' });
        return { ok: true, json: async () => status };
    } };
    return { base, root, options, dependencies, status, manifest, raw };
}
async function reverse(f) {
    await exportSTSnapshot(f.options, f.dependencies);
    const manifestFile = path.join(f.options.artifactRoot, 'manifest.json');
    const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
    manifest.direction = 'GO_TO_ST';
    const bytes = Buffer.from(JSON.stringify(manifest));
    await fs.writeFile(manifestFile, bytes);
    return { ...f.options, root: path.join(f.base, 'restored'), characterDirectories: { card: 'restored-avatar' }, currentGoExport: { ownerAccountId: '1', migrationRunId: id(1), frozenAuthorityEpoch: '7', manifestSha256: createHash('sha256').update(bytes).digest('hex') } };
}
test('ST snapshot captures exact bytes, all candidate ordinals, aliases and tombstones', async (t) => {
    const f = await setup(t);
    assert.deepEqual(await exportSTSnapshot(f.options, f.dependencies), { chats: 1 });
    const output = JSON.parse(await fs.readFile(path.join(f.options.artifactRoot, 'manifest.json')));
    const chat = output.chats[0];
    assert.equal(chat.sourceFileSha256, createHash('sha256').update(f.raw).digest('hex'));
    assert.equal(chat.sourceFileByteCount, String(Buffer.byteLength(f.raw)));
    assert.deepEqual(chat.messageAndCandidateIdentityRecords, f.manifest.chats[0].messageAndCandidateIdentityRecords);
    assert.deepEqual(chat.sourceRecords, f.manifest.chats[0].sourceRecords);
    assert.equal(await fs.readFile(path.join(f.options.artifactRoot, chat.sourceFile), 'utf8'), f.raw);
});
test('initial ST single observed candidate reconstructs new identity domains from raw and actual PG evidence', async (t) => {
    const f = await setup(t), chat = f.manifest.chats[0];
    const raw = f.raw.split('\r\n').map((line) => JSON.parse(line));
    delete raw[1].swipes; delete raw[1].swipe_info; delete raw[1].swipe_id; delete raw[1].extra.vc_source.generation;
    await fs.writeFile(path.join(f.root, chat.sourceFile), raw.map(JSON.stringify).join('\n'));
    chat.sourceFile = ''; chat.primaryFileName = id(2) + '.jsonl'; chat.aliases = [chat.primaryFileName];
    chat.messageAndCandidateIdentityRecords = [];
    chat.sourceRecords = chat.sourceRecords.filter((source) => source.candidateId === id(5)).map((source) => ({ ...source, observed: true }));
    await fs.writeFile(f.options.supplementFile, JSON.stringify(f.manifest));
    await exportSTSnapshot(f.options, f.dependencies);
    const output = JSON.parse(await fs.readFile(path.join(f.options.artifactRoot, 'manifest.json'))).chats[0];
    assert.equal(output.primaryFileName, 'current.jsonl'); assert.deepEqual(output.aliases, ['current.jsonl']);
    assert.deepEqual(output.messageAndCandidateIdentityRecords, [{ messageId: id(3), messageRevision: '1', position: '1024', selectedCandidateId: id(5), deleted: false,
        candidates: [{ candidateId: id(5), ordinal: 0, sourceRevision: '3', sourceGeneration: '4', settled: true, everSelected: true, deleted: false }] }]);
});
test('initial ST unknown historical candidate remains UNAVAILABLE instead of inventing ordinal or deletion', async (t) => {
    const f = await setup(t);
    f.manifest.chats[0].messageAndCandidateIdentityRecords = [];
    f.manifest.chats[0].sourceFile = '';
    for (const source of f.manifest.chats[0].sourceRecords) source.observed = true;
    await fs.writeFile(f.options.supplementFile, JSON.stringify(f.manifest));
    await assert.rejects(exportSTSnapshot(f.options, f.dependencies), { code: 'CHAT_MIGRATION_SOURCE_UNAVAILABLE' });
});
test('current ST root suppression floor is unioned, while a deleted live identity blocks resurrection', async (t) => {
    const f = await setup(t);
    const rights = { formatVersion: 1, ownerAccountId: '1', chats: [], deletionAndSuppressionRecords: [{ type: 'source', chatId: id(2), messageId: id(3), candidateId: id(5), sourceRevision: '2', sourceGeneration: '3', suppressed: true, present: false }] };
    await fs.writeFile(path.join(f.root, '.vc-f2/migration-manifest.archive'), JSON.stringify(rights));
    await exportSTSnapshot(f.options, f.dependencies);
    const output = JSON.parse(await fs.readFile(path.join(f.options.artifactRoot, 'manifest.json')));
    assert.equal(output.chats[0].sourceRecords.find((source) => source.candidateId === id(5)).suppressed, true);
    assert.equal(output.deletionAndSuppressionRecords[0].sourceGeneration, '4');
    f.options.artifactRoot = path.join(f.base, 'blocked');
    rights.deletionAndSuppressionRecords = [{ type: 'candidate', chatId: id(2), messageId: id(3), candidateId: id(5), deleted: true }];
    await fs.writeFile(path.join(f.root, '.vc-f2/migration-manifest.archive'), JSON.stringify(rights));
    await assert.rejects(exportSTSnapshot(f.options, f.dependencies), { code: 'CHAT_MIGRATION_SOURCE_UNAVAILABLE' });
});
test('marker alone, active handlers, wrong epoch, untrusted mapping and missing source never seal', async (t) => {
    const f = await setup(t);
    f.status.activeHandlers = 1;
    await assert.rejects(exportSTSnapshot(f.options, f.dependencies), { code: 'CHAT_MIGRATION_NOT_DRAINED' });
    f.status.activeHandlers = 0; f.status.authorityEpoch = '6';
    await assert.rejects(exportSTSnapshot(f.options, f.dependencies), { code: 'CHAT_MIGRATION_NOT_DRAINED' });
    f.status.authorityEpoch = '7';
    await assert.rejects(verifySTDrained({ ...f.options, accountHandles: {} }, f.dependencies), { code: 'CHAT_MIGRATION_ACCESS_DENIED' });
    await assert.rejects(verifySTDrained({ ...f.options, stBaseUrl: 'https://example.com' }, f.dependencies), { code: 'CHAT_MIGRATION_ACCESS_DENIED' });
    f.manifest.chats[0].sourceRecords.pop();
    await fs.writeFile(f.options.supplementFile, JSON.stringify(f.manifest));
    await assert.rejects(exportSTSnapshot(f.options, f.dependencies), { code: 'CHAT_MIGRATION_SOURCE_UNAVAILABLE' });
    await assert.rejects(fs.stat(f.options.artifactRoot), { code: 'ENOENT' });
    assert.equal((await fs.readdir(f.base)).some((name) => name.endsWith('.tmp')), false);
});
test('unknown disk file and unfinished F2 operation block complete snapshot', async (t) => {
    const f = await setup(t);
    await fs.writeFile(path.join(f.root, 'chats/card/untracked.jsonl'), '{}\n');
    await assert.rejects(exportSTSnapshot(f.options, f.dependencies));
    await fs.unlink(path.join(f.root, 'chats/card/untracked.jsonl'));
    await fs.writeFile(path.join(f.root, `.vc-f2/${id(2)}.json`), JSON.stringify({ id: id(2), state: 'pending-create', path: 'chats/card/current.jsonl' }));
    await assert.rejects(exportSTSnapshot(f.options, f.dependencies));
});
test('reverse restores fresh GO archive to an isolated closed root and finalizes only its run', async (t) => {
    const f = await setup(t), options = await reverse(f);
    await restoreGoSnapshot(options, { verifyCurrentGoExport: async () => true });
    assert.equal(await fs.readFile(path.join(options.root, 'chats/restored-avatar/current.jsonl'), 'utf8'), f.raw);
    const native = await getF2Store(options.root).read('chats/restored-avatar/current.jsonl');
    assert.equal(native[0].chat_metadata.vc_f2.revision, 9);
    assert.equal(native[1].extra.vc_source.generation, 4);
    assert.equal(await fs.readFile(path.join(options.root, 'chats/restored-avatar/current.jsonl'), 'utf8'), f.raw);
    const preserved = JSON.parse(await fs.readFile(path.join(options.root, '.vc-f2/migration-manifest.archive')));
    assert.deepEqual(preserved.chats[0].sourceRecords, f.manifest.chats[0].sourceRecords);
    await assert.rejects(finalizeRestore({ ...options, migrationRunId: id(99), activatedAuthorityEpoch: '8' }));
    await assert.rejects(finalizeRestore({ ...options, activatedAuthorityEpoch: '9' }), { code: 'CHAT_MIGRATION_ACTIVATION_REQUIRED' });
    assert.equal(JSON.parse(await fs.readFile(path.join(options.root, '.vc-f2/chat-cutover.json'))).closed, true);
    await finalizeRestore({ ...options, activatedAuthorityEpoch: '8' });
    await assert.rejects(fs.stat(path.join(options.root, '.vc-f2/chat-cutover.json')), { code: 'ENOENT' });
});
test('reverse requires current stdin attestation, matching bytes and verifier before publication', async (t) => {
    const f = await setup(t), options = await reverse(f);
    await assert.rejects(restoreGoSnapshot({ ...options, currentGoExport: undefined }), { code: 'CHAT_MIGRATION_CURRENT_GO_REQUIRED' });
    await assert.rejects(restoreGoSnapshot(options, { verifyCurrentGoExport: async () => false }), { code: 'CHAT_MIGRATION_CURRENT_GO_REQUIRED' });
    const manifest = JSON.parse(await fs.readFile(path.join(options.artifactRoot, 'manifest.json')));
    await fs.appendFile(path.join(options.artifactRoot, manifest.chats[0].sourceFile), '\n');
    await assert.rejects(restoreGoSnapshot(options));
    await assert.rejects(fs.stat(options.root), { code: 'ENOENT' });
});
test('restored archive tombstones and newly deleted ST identities cannot be revived by later drafts', async (t) => {
    const f = await setup(t), options = await reverse(f);
    await restoreGoSnapshot(options);
    const store = getF2Store(options.root), file = 'chats/restored-avatar/current.jsonl';
    const current = await store.read(file), baseline = current[0].chat_metadata.vc_f2;
    const oldDeletedMessage = structuredClone(current);
    oldDeletedMessage.push({ vc_message_id: id(7), mes: 'synthetic stale message', extra: { vc_source: { id: id(90) } } });
    await assert.rejects(store.save(file, oldDeletedMessage, { expected: baseline }), { code: 'VC_CHAT_DELETED' });
    const oldDeletedCandidate = structuredClone(current);
    oldDeletedCandidate[1].swipes.push('synthetic old candidate');
    oldDeletedCandidate[1].swipe_info.push({ extra: { vc_source: { id: id(6) } } });
    await assert.rejects(store.save(file, oldDeletedCandidate, { expected: baseline }), { code: 'VC_CHAT_DELETED' });
    const removed = structuredClone(current);
    removed[1].swipes = [removed[1].mes]; removed[1].swipe_id = 0;
    removed[1].swipe_info = [{ extra: structuredClone(removed[1].extra) }]; removed[1].variables = [removed[1].variables[1]];
    const saved = await store.save(file, removed, { expected: baseline });
    await assert.rejects(store.save(file, current, { expected: saved }), { code: 'VC_CHAT_DELETED' });
    const onlyHeader = [structuredClone(removed[0])];
    const deletedMessage = await store.save(file, onlyHeader, { expected: saved });
    const reincarnated = [onlyHeader[0], { vc_message_id: id(3), mes: 'synthetic reuse', extra: { vc_source: { id: id(91) } } }];
    await assert.rejects(store.save(file, reincarnated, { expected: deletedMessage }), { code: 'VC_CHAT_DELETED' });
    const record = JSON.parse(await fs.readFile(path.join(options.root, `.vc-f2/${id(2)}.json`)));
    assert.deepEqual(record.deletedMessageIds, [id(3)]);
    assert.deepEqual(new Set(record.deletedCandidateIds), new Set([id(4), id(5)]));
});
