// D06：删除前快照恢复到隔离副本。当前删除状态（PG + 现行 F2/账号文件）与归档外的删除清单取并集，
// 先清理再撤掉 blocked；清单不在归档内，恢复不写回现行库。离线，用合成 psql，缺工具即失败，不 skip。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const INTEG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACKUP = path.join(INTEG, 'scripts', 'backup.sh');
const RESTORE = path.join(INTEG, 'scripts', 'restore.sh');
const DELETED_BODY = 'synthetic-deleted-chat-body';
const KEPT_BODY = 'synthetic-kept-chat-body';
const ACCOUNT_BODY = 'synthetic-account-body';
const DERIVED = 'synthetic derived memory';
const DELETED_ID = '11111111-1111-4111-8111-111111111111';
const KEPT_ID = '22222222-2222-4222-8222-222222222222';

function sh(script, args, env) {
    const base = { ...process.env };
    for (const key of ['VC_ST_BACKUP_PASSPHRASE', 'VC_ST_BACKUP_PASSPHRASE_FILE', 'VC_ST_DATABASE_URL', 'VC_ST_PG_CONTAINER', 'VC_ST_CURRENT_DATA_ROOT', 'VC_ST_DELETION_MANIFEST', 'VC_RESTORE_GATE_FILE', 'VC_TEST_PSQL_FAIL', 'VC_BACKUP_PG_DSN', 'VC_BACKUP_PG_CONTAINER', 'VC_BACKUP_PG_USER', 'VC_BACKUP_PG_DATABASE', 'PGPASSFILE', 'PGPASSWORD']) delete base[key];
    return spawnSync('bash', [script, ...args], { encoding: 'utf8', env: { ...base, ...env } });
}

function writeJSON(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value));
}

function emptyDeletion() {
    return { version: 1, accounts: [], conversations: [], relationships: [] };
}

function deletedState() {
    return {
        version: 1,
        accounts: [{ accountId: '99', handle: 'gone-user', status: 'REQUESTED', stStatus: 'PENDING' }],
        conversations: [{
            ownerId: '42', conversationId: '7', relationshipId: '9', chatIdentity: DELETED_ID,
            location: 'chats/card-deleted/gone.jsonl', characterRef: 'card-deleted', handle: 'default-user',
        }],
        relationships: [{ ownerId: '42', relationshipId: '9', characterRef: 'card-deleted', handle: 'default-user' }],
    };
}

function rights(recordIds, sourceIds) {
    return {
        version: 1,
        owners: { '1': { deleted: false, recordIds, sourceIds, suppressedSources: recordIds.length ? [] : [{ sourceId: '1', sourceRef: 'deleted-chat', suppressed: true }] } },
        deletions: [],
    };
}

test('D06 备份后删除再恢复到隔离副本：并集清理后才开放，回滚的库不能使删除复活', async () => {
    for (const tool of ['openssl', 'python3', 'tar']) {
        assert.equal(spawnSync('sh', ['-c', `command -v ${tool}`]).status, 0, `需要 ${tool}`);
    }
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-d06-'));
    fs.chmodSync(root, 0o700);
    const data = path.join(root, 'data');
    const engine = path.join(root, 'engine');
    const bin = path.join(root, 'bin');
    const manifest = path.join(root, 'manifests', 'deletion-manifest.json');
    const deletionFile = path.join(root, 'deletion.json');
    const rightsFile = path.join(root, 'rights.json');
    const archiveA = path.join(root, 'archives', 'before.vcbae1');
    const archiveB = path.join(root, 'archives', 'after.vcbae1');
    const pass = `synthetic-${crypto.randomBytes(8).toString('hex')}`;
    fs.mkdirSync(bin, { mode: 0o700 });
    fs.writeFileSync(path.join(bin, 'psql'), `#!/usr/bin/env python3
import os, sys
sql = sys.stdin.read()
if os.environ.get('VC_TEST_PSQL_FAIL') == '1':
    sys.exit(1)
name = 'VC_TEST_DELETIONS' if 'vc_deletion_manifest' in sql else 'VC_TEST_RIGHTS'
sys.stdout.write(open(os.environ[name]).read())
if not open(os.environ[name]).read().endswith('\\n'):
    sys.stdout.write('\\n')
`, { mode: 0o700 });
    for (const rel of ['default-user/chats/card-deleted', 'default-user/chats/card-kept', 'default-user/characters', 'default-user/backups/chats', 'default-user/.vc-f2', 'gone-user/chats', '_vc_accounts']) {
        fs.mkdirSync(path.join(data, rel), { recursive: true });
    }
    fs.writeFileSync(path.join(data, 'default-user/chats/card-deleted/gone.jsonl'), DELETED_BODY + '\n');
    fs.writeFileSync(path.join(data, 'default-user/chats/card-kept/stay.jsonl'), KEPT_BODY + '\n');
    fs.writeFileSync(path.join(data, 'default-user/backups/chats/gone.jsonl'), DELETED_BODY + '\n');
    fs.writeFileSync(path.join(data, 'default-user/backups/chats/stay.jsonl'), KEPT_BODY + '\n');
    fs.writeFileSync(path.join(data, 'default-user/characters/card-deleted.png'), 'deleted-card');
    fs.writeFileSync(path.join(data, 'default-user/characters/card-kept.png'), 'kept-card');
    fs.writeFileSync(path.join(data, 'gone-user/chats/secret.jsonl'), ACCOUNT_BODY + '\n');
    writeJSON(path.join(data, '_vc_accounts/42.json'), { ownerAccountId: '42', handle: 'default-user', state: 'ACTIVE' });
    writeJSON(path.join(data, '_vc_accounts/99.json'), { ownerAccountId: '99', handle: 'gone-user', state: 'ACTIVE' });
    writeJSON(path.join(data, 'default-user/.vc-f2', `${DELETED_ID}.json`), { id: DELETED_ID, state: 'live', path: 'chats/card-deleted/gone.jsonl' });
    writeJSON(path.join(data, 'default-user/.vc-f2', `${KEPT_ID}.json`), { id: KEPT_ID, state: 'live', path: 'chats/card-kept/stay.jsonl' });
    fs.writeFileSync(path.join(data, 'cookie-secret.txt'), 'synthetic-cookie\n');
    const owner = path.join(engine, 'owners/1');
    fs.mkdirSync(owner, { recursive: true, mode: 0o700 });
    const seeded = spawnSync('python3', ['-c', "import sqlite3,sys; db=sqlite3.connect(sys.argv[1]); db.execute('CREATE TABLE memories(value TEXT)'); db.execute(\"INSERT INTO memories VALUES ('synthetic')\"); db.commit()", path.join(owner, 'vectors.db')]);
    assert.equal(seeded.status, 0, seeded.stderr);
    writeJSON(deletionFile, emptyDeletion());
    writeJSON(rightsFile, rights(['derived-1'], ['source-deleted']));
    const env = {
        VC_ST_BACKUP_PASSPHRASE: pass,
        VC_MEMORYCORE_DATA_ROOT: engine,
        VC_MEMORYCORE_DATABASE_URL: 'postgresql://synthetic',
        VC_ST_DATABASE_URL: 'postgresql://synthetic',
        VC_ST_DELETION_MANIFEST: manifest,
        VC_TEST_DELETIONS: deletionFile,
        VC_TEST_RIGHTS: rightsFile,
        PATH: bin + path.delimiter + process.env.PATH,
    };
    const backed = sh(BACKUP, [data, '-', archiveA], env);
    assert.equal(backed.status, 0, backed.stderr + backed.stdout);
    assert.equal(fs.statSync(manifest).mode & 0o777, 0o600);
    assert.equal(fs.readFileSync(manifest, 'utf8').includes(DELETED_BODY), false);
    const listed = spawnSync('tar', ['-tf', archiveA], { encoding: 'utf8' });
    assert.notEqual(listed.status, 0, '归档是加密容器，删除清单不能打进快照');

    writeJSON(deletionFile, deletedState());
    writeJSON(rightsFile, rights([], []));
    writeJSON(path.join(data, 'default-user/.vc-f2', `${DELETED_ID}.json`), { id: DELETED_ID, state: 'deleted', path: 'chats/card-deleted/gone.jsonl', revision: 2 });
    fs.rmSync(path.join(data, 'default-user/chats/card-deleted/gone.jsonl'));
    const liveAccount = fs.readFileSync(path.join(data, '_vc_accounts/99.json'));

    const copy1 = path.join(root, 'copy1');
    const restored = sh(RESTORE, [archiveA, copy1], { ...env, VC_ST_CURRENT_DATA_ROOT: data });
    assert.equal(restored.status, 0, restored.stderr + restored.stdout);
    assert.equal(restored.stdout.includes(DELETED_BODY), false);
    assert.match(restored.stdout, /expires=unset/);
    assert.match(restored.stdout, /V2-OWNER-PROTECTION/);
    assert.equal(fs.existsSync(path.join(copy1, 'restore-gate.json')), false);
    assert.equal(fs.existsSync(path.join(copy1, 'default-user/chats/card-deleted/gone.jsonl')), false);
    assert.equal(fs.existsSync(path.join(copy1, 'default-user/backups/chats/gone.jsonl')), false);
    assert.equal(fs.existsSync(path.join(copy1, 'default-user/characters/card-deleted.png')), false);
    assert.equal(fs.existsSync(path.join(copy1, 'gone-user')), false);
    assert.equal(fs.readFileSync(path.join(copy1, 'default-user/chats/card-kept/stay.jsonl'), 'utf8'), KEPT_BODY + '\n');
    assert.equal(fs.readFileSync(path.join(copy1, 'default-user/characters/card-kept.png'), 'utf8'), 'kept-card');
    assert.equal(fs.readFileSync(path.join(copy1, 'default-user/backups/chats/stay.jsonl'), 'utf8'), KEPT_BODY + '\n');
    assert.equal(JSON.parse(fs.readFileSync(path.join(copy1, '_vc_accounts/42.json'), 'utf8')).state, 'ACTIVE');
    assert.equal(JSON.parse(fs.readFileSync(path.join(copy1, '_vc_accounts/99.json'), 'utf8')).state, 'DELETED');
    assert.equal(JSON.parse(fs.readFileSync(path.join(copy1, 'default-user/.vc-f2', `${DELETED_ID}.json`), 'utf8')).state, 'deleted');
    assert.equal(JSON.parse(fs.readFileSync(path.join(copy1, 'default-user/.vc-f2', `${KEPT_ID}.json`), 'utf8')).state, 'live');
    assert.equal(fs.existsSync(path.join(data, 'default-user/chats/card-deleted/gone.jsonl')), false);
    assert.ok(fs.readFileSync(path.join(data, '_vc_accounts/99.json')).equals(liveAccount));
    assert.equal(fs.readFileSync(path.join(data, 'gone-user/chats/secret.jsonl'), 'utf8'), ACCOUNT_BODY + '\n');
    const manifestAfterFirst = fs.readFileSync(manifest);
    assert.equal(JSON.parse(manifestAfterFirst).retention.expiresAt, null);

    const again = sh(BACKUP, [data, '-', archiveB], env);
    assert.equal(again.status, 0, again.stderr + again.stdout);
    const freshManifest = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    assert.equal(freshManifest.engineRights.owners['1'].recordIds.includes('derived-1'), false);
    assert.ok(freshManifest.conversations.some((row) => row.chatIdentity === DELETED_ID));
    assert.equal(fs.readFileSync(manifest, 'utf8').includes(DELETED_BODY), false);
    const rolledDeletion = emptyDeletion();
    const rolledRights = rights(['derived-1'], ['source-deleted']);
    writeJSON(deletionFile, rolledDeletion);
    writeJSON(rightsFile, rolledRights);
    const rolledDeletionBytes = fs.readFileSync(deletionFile);
    const rolledRightsBytes = fs.readFileSync(rightsFile);
    const manifestBytes = fs.readFileSync(manifest);
    const emptyCurrent = path.join(root, 'empty-current');
    fs.mkdirSync(emptyCurrent, { mode: 0o700 });
    const copy2 = path.join(root, 'copy2');
    const rolled = sh(RESTORE, [archiveA, copy2], { ...env, VC_ST_CURRENT_DATA_ROOT: emptyCurrent });
    assert.equal(rolled.status, 0, rolled.stderr + rolled.stdout);
    assert.equal(fs.existsSync(path.join(copy2, 'default-user/chats/card-deleted/gone.jsonl')), false);
    assert.equal(fs.existsSync(path.join(copy2, 'default-user/characters/card-deleted.png')), false);
    assert.equal(fs.existsSync(path.join(copy2, 'gone-user')), false);
    assert.equal(fs.readFileSync(path.join(copy2, 'default-user/chats/card-kept/stay.jsonl'), 'utf8'), KEPT_BODY + '\n');
    assert.ok(fs.readFileSync(deletionFile).equals(rolledDeletionBytes));
    assert.ok(fs.readFileSync(rightsFile).equals(rolledRightsBytes));
    assert.ok(fs.readFileSync(manifest).equals(manifestBytes));
    assert.equal(fs.existsSync(archiveA), true);

    const { createControlledEngine } = await import('../memorycore-service/business.mjs');
    const native = {
        records: new Map([['derived-1', { id: 'derived-1', content: DERIVED, metadata: { vcDependencies: ['source-deleted'] } }]]),
        sources: new Map(),
        getScope: () => ({ revision: 0 }),
        space: undefined,
        getSpace() { return this.space; },
        configureSpace(id, dimensions) { if (this.space?.spaceId !== id) this.space = { spaceId: id, dimensions, rebuilding: false }; },
        list: (ids) => [...native.records.values()].filter((row) => !ids || ids.includes(row.id)),
        listSources: () => [...native.sources.values()],
        forgetRecords: (ids) => ids.forEach((id) => native.records.delete(id)),
        forgetSources: (ids) => ids.forEach((id) => native.sources.delete(id)),
        close() {},
    };
    const scope = { ownerId: '1', instanceId: '1', mode: 'COMPANION', domainId: 'account-rights', profileScopeId: 'account-rights' };
    const embedding = { provider: 'OLLAMA', endpoint: 'http://127.0.0.1:11438', model: 'synthetic-model', artifactVersion: 'artifact-1', dimensions: 2, queryPreprocessingVersion: 'identity-v1', documentPreprocessingVersion: 'identity-v1', normalization: 'l2', state: 'ENABLED', revision: 1, spaceId: 'space1' };
    const engineApi = createControlledEngine({
        dataRoot: path.join(copy2, '_memorycore'),
        nativeFactory: async () => native,
        embeddingFactory: async () => ({ embedBatch: async (rows) => rows.map(() => new Float32Array([1, 0])) }),
        runnerFactory: () => ({}),
    });
    const exported = await engineApi.invoke('export-owner', { scope });
    assert.equal(exported.records.length, 0);
    assert.equal(native.records.has('derived-1'), false);
    assert.equal(JSON.stringify(exported).includes(DERIVED), false);
    const hits = await engineApi.invoke('search', { scope, embedding, allowedRecordIds: ['derived-1'], query: 'synthetic' });
    assert.deepEqual(hits, []);
    await engineApi.close();
    fs.rmSync(root, { recursive: true, force: true });
});

test('D06 当前库不可达时恢复失败且副本保持 blocked', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-d06-down-'));
    fs.chmodSync(root, 0o700);
    const data = path.join(root, 'data');
    const bin = path.join(root, 'bin');
    const manifest = path.join(root, 'manifests', 'deletion-manifest.json');
    const deletionFile = path.join(root, 'deletion.json');
    const archive = path.join(root, 'archives', 'snap.vcbae1');
    const pass = `synthetic-${crypto.randomBytes(8).toString('hex')}`;
    fs.mkdirSync(path.join(data, 'default-user/chats'), { recursive: true });
    fs.mkdirSync(path.join(data, '_vc_accounts'), { recursive: true });
    fs.mkdirSync(bin, { mode: 0o700 });
    fs.writeFileSync(path.join(data, 'default-user/chats/gone.jsonl'), DELETED_BODY + '\n');
    fs.writeFileSync(path.join(data, 'cookie-secret.txt'), 'synthetic-cookie\n');
    writeJSON(path.join(data, '_vc_accounts/42.json'), { ownerAccountId: '42', handle: 'default-user', state: 'ACTIVE' });
    writeJSON(deletionFile, emptyDeletion());
    fs.writeFileSync(path.join(bin, 'psql'), `#!/usr/bin/env python3
import os, sys
if os.environ.get('VC_TEST_PSQL_FAIL') == '1':
    sys.exit(1)
sys.stdout.write(open(os.environ['VC_TEST_DELETIONS']).read())
`, { mode: 0o700 });
    const env = {
        VC_ST_BACKUP_PASSPHRASE: pass,
        VC_MEMORYCORE_DATA_ROOT: path.join(root, 'no-engine'),
        VC_ST_DATABASE_URL: 'postgresql://synthetic',
        VC_ST_DELETION_MANIFEST: manifest,
        VC_TEST_DELETIONS: deletionFile,
        PATH: bin + path.delimiter + process.env.PATH,
    };
    assert.equal(sh(BACKUP, [data, '-', archive], env).status, 0);
    const copy = path.join(root, 'copy');
    const failed = sh(RESTORE, [archive, copy], { ...env, VC_TEST_PSQL_FAIL: '1' });
    assert.equal(failed.status, 5, failed.stderr + failed.stdout);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(copy, 'restore-gate.json'), 'utf8')), { blocked: true });
    assert.equal(fs.readFileSync(path.join(copy, 'default-user/chats/gone.jsonl'), 'utf8'), DELETED_BODY + '\n');
    assert.equal(fs.readFileSync(path.join(data, 'default-user/chats/gone.jsonl'), 'utf8'), DELETED_BODY + '\n');
    fs.rmSync(root, { recursive: true, force: true });
});
