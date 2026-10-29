// PostgreSQL 进入 VCBAE1 归档，恢复只落到新的隔离库，并在撤掉 blocked 前套用删除并集。
// 离线用例不连库。真库用例使用本 worktree 的 PostgreSQL 容器，缺镜像即失败，不 skip。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const INTEG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(INTEG, '../..');
const BACKUP = path.join(INTEG, 'scripts', 'backup.sh');
const RESTORE = path.join(INTEG, 'scripts', 'restore.sh');
const AEAD = path.join(REPO, 'infra/db/backup/vc_aead.py');
const PG_CONTAINER = process.env.VC_W03_PG_CONTAINER || 'vc-q2-managed-pg';
const PG_IMAGE = process.env.VC_W03_PG_IMAGE || 'pgvector/pgvector:0.8.5-pg18';
const PG_LABEL = 'com.vc.w03';
const DELETED_MEMORY = 'synthetic-deleted-memory';
const KEPT_MEMORY = 'synthetic-kept-memory';
const ACCOUNT_MEMORY = 'synthetic-account-memory';
const DELETED_ACCOUNT = 'synthetic-deleted-account';
const KEPT_ACCOUNT = 'synthetic-kept-account';
const MARKER = 'post-backup-marker';
const GONE_CHAT = 'synthetic-deleted-chat-body';
const KEPT_CHAT = 'synthetic-kept-chat-body';

function sh(script, args, env) {
    const base = { ...process.env };
    for (const key of ['VC_ST_BACKUP_PASSPHRASE', 'VC_ST_BACKUP_PASSPHRASE_FILE', 'VC_ST_DATABASE_URL', 'VC_ST_PG_CONTAINER', 'VC_ST_PG_USER', 'VC_ST_PG_DATABASE', 'VC_ST_CURRENT_DATA_ROOT', 'VC_ST_DELETION_MANIFEST', 'VC_BACKUP_PG_DSN', 'VC_BACKUP_PG_CONTAINER', 'VC_BACKUP_PG_USER', 'VC_BACKUP_PG_DATABASE', 'VC_DOCKER_CONTEXT', 'PGPASSFILE', 'PGPASSWORD', 'PGHOST', 'PGPORT', 'PGUSER', 'PGDATABASE']) delete base[key];
    return spawnSync('bash', [script, ...args], { encoding: 'utf8', env: { ...base, ...env } });
}

function writeJSON(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value));
}

function gateHash() {
    return crypto.createHash('sha256').update('{"blocked":true}\n').digest('hex');
}

function decryptTar(archive, pass) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-pg-dec-'));
    const body = path.join(dir, 'body');
    const plain = path.join(dir, 'plain.tar');
    const env = { ...process.env, VC_ST_BACKUP_PASSPHRASE: pass };
    const unsealed = spawnSync('python3', [AEAD, 'unseal', archive, body, '--pass-env', 'VC_ST_BACKUP_PASSPHRASE'], { encoding: 'utf8', env });
    assert.equal(unsealed.status, 0, unsealed.stderr);
    const decoded = spawnSync('openssl', ['enc', '-d', '-aes-256-cbc', '-pbkdf2', '-pass', 'env:VC_ST_BACKUP_PASSPHRASE', '-in', body, '-out', plain], { encoding: 'utf8', env });
    assert.equal(decoded.status, 0, decoded.stderr);
    return { dir, plain };
}

function decryptMember(archive, pass, member) {
    const opened = decryptTar(archive, pass);
    const extracted = spawnSync('tar', ['-xOf', opened.plain, member], { encoding: 'utf8' });
    fs.rmSync(opened.dir, { recursive: true, force: true });
    assert.equal(extracted.status, 0, extracted.stderr);
    return extracted.stdout;
}

function docker(args, input) {
    return spawnSync('docker', args, { encoding: 'utf8', input });
}

function assertLabelOwned(name) {
    const inspect = docker(['inspect', '-f', '{{index .Config.Labels "com.vc.w03"}}', name]);
    if (inspect.status !== 0) return false;
    assert.equal((inspect.stdout || '').trim(), 'managed', `${name} 已存在但不是本夹具的受管容器`);
    return true;
}

function removeContainer(name) {
    if (!assertLabelOwned(name)) return;
    const removed = docker(['rm', '-f', name]);
    assert.equal(removed.status, 0, removed.stderr);
}

function startContainer(name) {
    const image = docker(['image', 'inspect', PG_IMAGE, '--format', '{{.Id}}']);
    assert.equal(image.status, 0, `需要本地镜像 ${PG_IMAGE}，不自动拉取`);
    if (assertLabelOwned(name)) removeContainer(name);
    const started = docker(['run', '-d', '--name', name, '--label', `${PG_LABEL}=managed`, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-e', 'POSTGRES_DB=vc', '-p', '127.0.0.1::5432', PG_IMAGE]);
    assert.equal(started.status, 0, started.stderr);
    const deadline = Date.now() + 60000;
    let ready = false;
    while (Date.now() < deadline) {
        const probe = docker(['exec', name, 'pg_isready', '-h', '127.0.0.1', '-p', '5432', '-U', 'postgres', '-d', 'vc']);
        if (probe.status === 0) {
            ready = true;
            break;
        }
        spawnSync('sleep', ['1']);
    }
    assert.equal(ready, true, '受管 PostgreSQL 未在 60 秒内就绪');
}

function psql(database, sql) {
    const result = docker(['exec', '-i', PG_CONTAINER, 'psql', '-U', 'postgres', '-d', database, '-X', '-q', '-A', '-t', '-w', '-v', 'ON_ERROR_STOP=1'], sql);
    assert.equal(result.status, 0, result.stderr + result.stdout + sql);
    return result.stdout.trim();
}

const SCHEMA = `
CREATE SCHEMA IF NOT EXISTS vc;
CREATE TABLE vc.vc_user (
    id bigint PRIMARY KEY,
    display_name text NOT NULL
);
CREATE TABLE vc.identity_account (
    id bigint PRIMARY KEY REFERENCES vc.vc_user(id) ON DELETE CASCADE,
    st_handle text
);
CREATE TABLE vc.relationship (
    owner_user_id bigint NOT NULL REFERENCES vc.vc_user(id) ON DELETE CASCADE,
    id bigint NOT NULL,
    persona_ref text NOT NULL,
    st_character_ref text NOT NULL DEFAULT '',
    PRIMARY KEY (owner_user_id, id)
);
CREATE TABLE vc.conversation (
    owner_user_id bigint NOT NULL,
    id bigint NOT NULL,
    relationship_id bigint NOT NULL,
    title text,
    st_chat_identity text NOT NULL DEFAULT '',
    st_location text NOT NULL DEFAULT '',
    st_source_state text NOT NULL DEFAULT 'PRESENT',
    PRIMARY KEY (owner_user_id, id),
    FOREIGN KEY (owner_user_id, relationship_id)
        REFERENCES vc.relationship(owner_user_id, id) ON DELETE CASCADE
);
CREATE TABLE vc.memory_item (
    owner_user_id bigint NOT NULL,
    id bigint NOT NULL,
    relationship_id bigint NOT NULL,
    summary text NOT NULL,
    deleted_at timestamptz,
    PRIMARY KEY (owner_user_id, id),
    FOREIGN KEY (owner_user_id, relationship_id)
        REFERENCES vc.relationship(owner_user_id, id) ON DELETE CASCADE
);
CREATE TABLE vc.account_deletion_intent (
    account_id bigint PRIMARY KEY,
    st_handle text,
    status text NOT NULL,
    st_status text
);
`;

const SEED = `
INSERT INTO vc.vc_user (id, display_name) VALUES
    (41, '${KEPT_ACCOUNT}'),
    (42, '${DELETED_ACCOUNT}');
INSERT INTO vc.identity_account (id, st_handle) VALUES
    (41, 'default-user'),
    (42, 'gone-user');
INSERT INTO vc.relationship (owner_user_id, id, persona_ref, st_character_ref) VALUES
    (41, 5, 'kept', 'card-kept'),
    (41, 4, 'gone-chat', 'card-gone-chat'),
    (42, 8, 'gone-account', 'card-gone-account');
INSERT INTO vc.conversation (owner_user_id, id, relationship_id, title, st_chat_identity, st_location, st_source_state) VALUES
    (41, 6, 5, 'kept', '22222222-2222-4222-8222-222222222222', 'chats/stay.jsonl', 'PRESENT'),
    (41, 7, 4, 'deleted-chat', '11111111-1111-4111-8111-111111111111', 'chats/secret.jsonl', 'PRESENT'),
    (42, 9, 8, 'gone-account', '33333333-3333-4333-8333-333333333333', 'chats/account-gone.jsonl', 'PRESENT');
INSERT INTO vc.memory_item (owner_user_id, id, relationship_id, summary) VALUES
    (41, 11, 5, '${KEPT_MEMORY}'),
    (41, 10, 5, '${DELETED_MEMORY}'),
    (42, 12, 8, '${ACCOUNT_MEMORY}');
`;

test('离线：未设置 PostgreSQL 时标明未含，且默认不备份 MinIO', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-pg-off-'));
    const data = path.join(root, 'data');
    const archive = path.join(root, 'out', 'plain.vcbae1');
    const pass = `synthetic-${crypto.randomBytes(8).toString('hex')}`;
    fs.mkdirSync(path.join(data, 'default-user/chats'), { recursive: true });
    fs.writeFileSync(path.join(data, 'cookie-secret.txt'), 'synthetic-cookie\n');
    fs.writeFileSync(path.join(data, 'default-user/chats/stay.jsonl'), 'kept\n');
    const backed = sh(BACKUP, [data, '-', archive], { VC_ST_BACKUP_PASSPHRASE: pass, VC_MEMORYCORE_DATA_ROOT: path.join(root, 'no-engine') });
    assert.equal(backed.status, 0, backed.stderr + backed.stdout);
    assert.match(backed.stdout, /未含 PostgreSQL/);
    assert.match(backed.stdout, /未备份/);
    assert.match(backed.stdout, /MinIO/);
    const opened = decryptTar(archive, pass);
    const members = spawnSync('tar', ['-tf', opened.plain], { encoding: 'utf8' });
    fs.rmSync(opened.dir, { recursive: true, force: true });
    assert.equal(members.status, 0, members.stderr);
    assert.equal(members.stdout.includes('_postgres/'), false);
    const restored = sh(RESTORE, [archive, path.join(root, 'copy')], { VC_ST_BACKUP_PASSPHRASE: pass, VC_MEMORYCORE_DATA_ROOT: path.join(root, 'no-engine') });
    assert.equal(restored.status, 0, restored.stderr + restored.stdout);
    assert.equal(fs.existsSync(path.join(root, 'copy/_postgres')), false);
    assert.equal(restored.stdout.includes('RESTORED_DATABASE'), false);
    fs.rmSync(root, { recursive: true, force: true });
});

test('离线：DSN 与容器只能二选一，口令不进 pg_dump 或 psql 的 argv', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-pg-argv-'));
    const data = path.join(root, 'data');
    const bin = path.join(root, 'bin');
    const archive = path.join(root, 'out', 'db.vcbae1');
    const log = path.join(root, 'argv.log');
    const manifest = path.join(root, 'manifests', 'deletion-manifest.json');
    const pass = `synthetic-${crypto.randomBytes(8).toString('hex')}`;
    const pgSecret = `synthetic-pg-secret-${crypto.randomBytes(6).toString('hex')}`;
    const stSecret = `synthetic-st-secret-${crypto.randomBytes(6).toString('hex')}`;
    fs.mkdirSync(bin, { mode: 0o700 });
    fs.mkdirSync(path.join(data, 'default-user/chats'), { recursive: true });
    fs.writeFileSync(path.join(data, 'cookie-secret.txt'), 'synthetic-cookie\n');
    fs.writeFileSync(path.join(bin, 'pg_dump'), `#!/usr/bin/env python3
import os, sys
open(os.environ['VC_TEST_ARGV_LOG'], 'a').write('pg_dump\\t' + '\\t'.join(sys.argv[1:]) + '\\n')
pw = os.environ.get('PGPASSFILE', '')
open(os.environ['VC_TEST_ARGV_LOG'], 'a').write('pgpass\\t' + (open(pw).read() if pw else '') + '\\n')
if pw:
    open(os.environ['VC_TEST_ARGV_LOG'], 'a').write('pgmode\\t' + oct(os.stat(pw).st_mode & 0o777) + '\\n')
sys.stdout.buffer.write(b'PGDMP-synthetic')
`, { mode: 0o700 });
    fs.writeFileSync(path.join(bin, 'psql'), `#!/usr/bin/env python3
import os, sys
open(os.environ['VC_TEST_ARGV_LOG'], 'a').write('psql\\t' + '\\t'.join(sys.argv[1:]) + '\\n')
pw = os.environ.get('PGPASSFILE', '')
open(os.environ['VC_TEST_ARGV_LOG'], 'a').write('stpass\\t' + (open(pw).read() if pw else '') + '\\n')
if pw:
    open(os.environ['VC_TEST_ARGV_LOG'], 'a').write('stmode\\t' + oct(os.stat(pw).st_mode & 0o777) + '\\n')
sys.stdout.write('{"version":1,"accounts":[],"conversations":[],"relationships":[]}\\n')
`, { mode: 0o700 });
    const both = sh(BACKUP, [data, '-', archive], {
        VC_ST_BACKUP_PASSPHRASE: pass,
        VC_MEMORYCORE_DATA_ROOT: path.join(root, 'no-engine'),
        VC_BACKUP_PG_DSN: 'postgresql://postgres:x@127.0.0.1:9/vc',
        VC_BACKUP_PG_CONTAINER: 'vc-q2-should-not-run',
        PATH: bin + path.delimiter + process.env.PATH,
    });
    assert.equal(both.status, 1, both.stderr + both.stdout);
    assert.equal(fs.existsSync(archive), false);
    const backed = sh(BACKUP, [data, '-', archive], {
        VC_ST_BACKUP_PASSPHRASE: pass,
        VC_MEMORYCORE_DATA_ROOT: path.join(root, 'no-engine'),
        VC_BACKUP_PG_DSN: `postgresql://postgres:${encodeURIComponent(pgSecret)}@127.0.0.1:9/vc`,
        VC_ST_DATABASE_URL: `postgresql://postgres:${encodeURIComponent(stSecret)}@127.0.0.1:9/vc`,
        VC_ST_DELETION_MANIFEST: manifest,
        VC_TEST_ARGV_LOG: log,
        PATH: bin + path.delimiter + process.env.PATH,
    });
    assert.equal(backed.status, 0, backed.stderr + backed.stdout);
    assert.equal(backed.stdout.includes(pgSecret) || backed.stderr.includes(pgSecret), false);
    assert.equal(backed.stdout.includes(stSecret) || backed.stderr.includes(stSecret), false);
    assert.doesNotMatch(backed.stdout, /未含 PostgreSQL/);
    assert.match(backed.stdout, /pg_dump-Fc/);
    const recorded = fs.readFileSync(log, 'utf8');
    const argvText = recorded.split('\n').filter((line) => line.startsWith('pg_dump\t') || line.startsWith('psql\t')).join('\n');
    assert.equal(argvText.includes(pgSecret), false);
    assert.equal(argvText.includes(stSecret), false);
    assert.match(argvText, /pg_dump/);
    assert.match(argvText, /psql/);
    const pgpass = recorded.split('\n').find((line) => line.startsWith('pgpass\t'));
    const stpass = recorded.split('\n').find((line) => line.startsWith('stpass\t'));
    assert.equal(pgpass.includes(pgSecret), true);
    assert.equal(stpass.includes(stSecret), true);
    assert.equal(recorded.split('\n').find((line) => line.startsWith('pgmode\t')), 'pgmode\t0o600');
    assert.equal(recorded.split('\n').find((line) => line.startsWith('stmode\t')), 'stmode\t0o600');
    const source = decryptMember(archive, pass, '_postgres/source.json');
    assert.equal(source.includes(pgSecret), false);
    assert.equal(JSON.parse(source).database, 'vc');
    assert.equal(JSON.parse(source).format, 'pg_dump-Fc');
    assert.equal(decryptMember(archive, pass, '_postgres/db.dump').startsWith('PGDMP'), true);
    const listed = spawnSync('tar', ['-tf', archive], { encoding: 'utf8' });
    assert.notEqual(listed.status, 0);
    fs.rmSync(root, { recursive: true, force: true });
});

test('真库：备份含 PostgreSQL，删除账号与一条记忆后恢复到隔离库；不可达则失败且保持 blocked', { timeout: 300000 }, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-pg-real-'));
    try {
        startContainer(PG_CONTAINER);
        psql('vc', SCHEMA);
        psql('vc', SEED);
        const data = path.join(root, 'data');
        const archive = path.join(root, 'out', 'snap.vcbae1');
        const manifest = path.join(root, 'manifests', 'deletion-manifest.json');
        const pass = `synthetic-${crypto.randomBytes(8).toString('hex')}`;
        fs.mkdirSync(path.join(data, 'default-user/chats'), { recursive: true });
        fs.mkdirSync(path.join(data, '_vc_accounts'), { recursive: true });
        fs.writeFileSync(path.join(data, 'cookie-secret.txt'), 'synthetic-cookie\n');
        fs.writeFileSync(path.join(data, 'default-user/chats/stay.jsonl'), KEPT_CHAT + '\n');
        fs.writeFileSync(path.join(data, 'default-user/chats/secret.jsonl'), GONE_CHAT + '\n');
        writeJSON(path.join(data, '_vc_accounts/41.json'), { ownerAccountId: '41', handle: 'default-user', state: 'ACTIVE' });
        writeJSON(path.join(data, '_vc_accounts/42.json'), { ownerAccountId: '42', handle: 'gone-user', state: 'ACTIVE' });
        const env = {
            VC_ST_BACKUP_PASSPHRASE: pass,
            VC_MEMORYCORE_DATA_ROOT: path.join(root, 'no-engine'),
            VC_BACKUP_PG_CONTAINER: PG_CONTAINER,
            VC_BACKUP_PG_USER: 'postgres',
            VC_BACKUP_PG_DATABASE: 'vc',
            VC_ST_PG_CONTAINER: PG_CONTAINER,
            VC_ST_PG_USER: 'postgres',
            VC_ST_PG_DATABASE: 'vc',
            VC_ST_DELETION_MANIFEST: manifest,
            VC_ST_CURRENT_DATA_ROOT: data,
        };
        const backed = sh(BACKUP, [data, '-', archive], env);
        assert.equal(backed.status, 0, backed.stderr + backed.stdout);
        assert.match(backed.stdout, /pg_dump-Fc/);
        assert.doesNotMatch(backed.stdout, /未含 PostgreSQL/);
        assert.equal(decryptMember(archive, pass, '_postgres/db.dump').startsWith('PGDMP'), true);
        assert.equal(JSON.parse(decryptMember(archive, pass, '_postgres/source.json')).database, 'vc');

        const blockedCopy = path.join(root, 'blocked');
        const unreachable = sh(RESTORE, [archive, blockedCopy], { ...env, VC_BACKUP_PG_CONTAINER: 'vc-q2-pg-unreachable' });
        assert.equal(unreachable.status, 5, unreachable.stderr + unreachable.stdout);
        assert.equal(unreachable.stdout.includes('RESTORED_DATABASE'), false);
        assert.equal(unreachable.stdout.includes(DELETED_MEMORY), false);
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(blockedCopy, 'restore-gate.json'), 'utf8')), { blocked: true });
        assert.match(unreachable.stdout, new RegExp(`RESTORE_GATE_OBSERVED blocked=true sha256=${gateHash()}`));
        assert.equal(psql('postgres', "SELECT count(*) FROM pg_database WHERE datname LIKE 'vc_restore_%'"), '0');
        assert.equal(psql('vc', 'SELECT count(*) FROM vc.vc_user WHERE id = 42'), '1');

        psql('vc', `
INSERT INTO vc.account_deletion_intent (account_id, st_handle, status, st_status)
VALUES (42, 'gone-user', 'COMPLETED', 'COMPLETED');
DELETE FROM vc.vc_user WHERE id = 42;
UPDATE vc.memory_item SET deleted_at = now() WHERE owner_user_id = 41 AND id = 10;
UPDATE vc.conversation SET st_source_state = 'DELETED' WHERE owner_user_id = 41 AND id = 7;
INSERT INTO vc.vc_user (id, display_name) VALUES (99, '${MARKER}');
`);
        writeJSON(path.join(data, '_vc_accounts/42.json'), { ownerAccountId: '42', handle: 'gone-user', state: 'DELETED' });
        fs.rmSync(path.join(data, 'default-user/chats/secret.jsonl'));
        const manifestBytes = fs.readFileSync(manifest);

        const copy = path.join(root, 'copy');
        const restored = sh(RESTORE, [archive, copy], env);
        assert.equal(restored.status, 0, restored.stderr + restored.stdout);
        assert.equal(restored.stdout.includes(DELETED_MEMORY) || restored.stderr.includes(DELETED_MEMORY), false);
        assert.equal(restored.stdout.includes(ACCOUNT_MEMORY) || restored.stderr.includes(ACCOUNT_MEMORY), false);
        assert.equal(restored.stdout.includes(GONE_CHAT) || restored.stderr.includes(GONE_CHAT), false);
        assert.equal(restored.stdout.includes(DELETED_ACCOUNT) || restored.stderr.includes(DELETED_ACCOUNT), false);
        const observed = restored.stdout.indexOf(`RESTORE_GATE_OBSERVED blocked=true sha256=${gateHash()}`);
        const deleted = restored.stdout.indexOf('PG_DELETION');
        const named = restored.stdout.indexOf('RESTORED_DATABASE');
        assert.equal(observed >= 0 && observed < deleted && deleted < named, true, restored.stdout);
        assert.match(restored.stdout, /switched=false/);
        assert.equal(fs.existsSync(path.join(copy, 'restore-gate.json')), false);
        assert.equal(fs.existsSync(path.join(copy, '_postgres')), false);
        assert.equal(fs.existsSync(path.join(copy, 'default-user/chats/secret.jsonl')), false);
        assert.equal(fs.readFileSync(path.join(copy, 'default-user/chats/stay.jsonl'), 'utf8'), KEPT_CHAT + '\n');
        assert.equal(JSON.parse(fs.readFileSync(path.join(copy, '_vc_accounts/41.json'), 'utf8')).state, 'ACTIVE');
        assert.equal(JSON.parse(fs.readFileSync(path.join(copy, '_vc_accounts/42.json'), 'utf8')).state, 'DELETED');
        assert.ok(fs.readFileSync(manifest).equals(manifestBytes));
        const match = /RESTORED_DATABASE name=([a-z0-9_]+) source=vc switched=false/.exec(restored.stdout);
        assert.ok(match, restored.stdout);
        const restoredDb = match[1];
        assert.match(restoredDb, /^vc_restore_[0-9]{14}_[0-9a-f]{8}$/);
        assert.notEqual(restoredDb, 'vc');
        assert.equal(psql(restoredDb, 'SELECT current_database()'), restoredDb);
        assert.equal(psql(restoredDb, "SELECT coalesce(string_agg(id::text || ':' || display_name, ',' ORDER BY id), '') FROM vc.vc_user"), `41:${KEPT_ACCOUNT}`);
        assert.equal(psql(restoredDb, "SELECT coalesce(string_agg(owner_user_id::text || ':' || id::text || ':' || summary, ',' ORDER BY owner_user_id, id), '') FROM vc.memory_item"), `41:11:${KEPT_MEMORY}`);
        assert.equal(psql(restoredDb, "SELECT coalesce(string_agg(owner_user_id::text || ':' || id::text, ',' ORDER BY owner_user_id, id), '') FROM vc.relationship"), '41:5');
        assert.equal(psql(restoredDb, "SELECT coalesce(string_agg(owner_user_id::text || ':' || id::text || ':' || st_source_state, ',' ORDER BY owner_user_id, id), '') FROM vc.conversation"), '41:6:PRESENT');
        assert.equal(psql(restoredDb, 'SELECT count(*) FROM vc.account_deletion_intent WHERE account_id = 42'), '1');
        assert.equal(psql(restoredDb, `SELECT count(*) FROM vc.memory_item WHERE summary = '${DELETED_MEMORY}'`), '0');
        assert.equal(psql(restoredDb, `SELECT count(*) FROM vc.vc_user WHERE display_name = '${MARKER}'`), '0');
        assert.equal(psql('vc', "SELECT coalesce(string_agg(id::text, ',' ORDER BY id), '') FROM vc.vc_user"), '41,99');
        assert.equal(psql('vc', 'SELECT count(*) FROM vc.memory_item WHERE owner_user_id = 41 AND id = 10 AND deleted_at IS NOT NULL'), '1');
        assert.equal(psql('vc', 'SELECT count(*) FROM vc.relationship WHERE owner_user_id = 41 AND id = 4'), '1');
        assert.equal(psql('vc', 'SELECT count(*) FROM vc.account_deletion_intent WHERE account_id = 42'), '1');
        assert.equal(psql('vc', 'SELECT count(*) FROM vc.vc_user WHERE id = 42'), '0');
        assert.equal(psql('postgres', "SELECT count(*) FROM pg_database WHERE datname = 'vc'"), '1');
    } finally {
        removeContainer(PG_CONTAINER);
        fs.rmSync(root, { recursive: true, force: true });
    }
});
