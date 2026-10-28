// C1 备份/恢复不变量：合成 dataRoot + 临时口令（离线；需要 openssl / python3 / tar，缺失即失败，不 skip）。
import { test, before, after } from 'node:test';
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

let T; let DATA; let KEY; let OUT; let CONFIG;
const PASS = `synthetic-${crypto.randomBytes(12).toString('hex')}`;

function sh(script, args, env = {}) {
    return spawnSync('bash', [script, ...args], { encoding: 'utf8', env: { ...process.env, VC_ST_BACKUP_PASSPHRASE: undefined, VC_ST_BACKUP_PASSPHRASE_FILE: undefined, VC_MEMORYCORE_DATA_ROOT: path.join(T || os.tmpdir(), 'no-engine'), ...env } });
}
function walkFiles(root) {
    const out = [];
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out.push(path.relative(root, p)); } };
    walk(root); return out.sort();
}

before(() => {
    for (const tool of ['openssl', 'python3', 'tar']) {
        assert.equal(spawnSync('sh', ['-c', `command -v ${tool}`]).status, 0, `需要 ${tool}`);
    }
    T = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-c1-')); fs.chmodSync(T, 0o700);
    DATA = path.join(T, 'data'); KEY = path.join(T, 'keys', 'k'); OUT = path.join(T, 'out', 'b.vcbae1'); CONFIG = path.join(T, 'config.yaml');
    for (const d of ['default-user/chats/合成角色', 'default-user/characters/合成角色/backgrounds', 'default-user/worlds', 'default-user/backups/chats', 'default-user/group chats', 'default-user/OpenAI Settings', 'default-user/user/images/合成角色', 'default-user/user/files']) fs.mkdirSync(path.join(DATA, d), { recursive: true });
    fs.writeFileSync(path.join(DATA, 'cookie-secret.txt'), 'synthetic-cookie-secret\n');
    fs.writeFileSync(path.join(DATA, 'default-user/settings.json'), JSON.stringify({ synthetic: true }));
    fs.writeFileSync(path.join(DATA, 'default-user/secrets.json'), JSON.stringify({ api_key_custom: 'SYNTHETIC-NOT-A-REAL-KEY' }));
    fs.writeFileSync(path.join(DATA, 'default-user/chats/合成角色/2026.jsonl'), crypto.randomBytes(5000));
    fs.writeFileSync(path.join(DATA, 'default-user/characters/合成角色.png'), crypto.randomBytes(2048));
    fs.writeFileSync(path.join(DATA, 'default-user/characters/合成角色/backgrounds/bg.png'), crypto.randomBytes(512));
    fs.writeFileSync(path.join(DATA, 'default-user/worlds/合成世界.json'), JSON.stringify({ entries: {} }));
    fs.writeFileSync(path.join(DATA, 'default-user/backups/chats/auto.jsonl'), 'auto-backup\n');
    fs.writeFileSync(path.join(DATA, 'default-user/group chats/g.jsonl'), 'group\n');
    fs.writeFileSync(path.join(DATA, 'default-user/OpenAI Settings/合成预设.json'), JSON.stringify({ preset: true }));
    fs.writeFileSync(path.join(DATA, 'default-user/user/images/合成角色/note.png'), crypto.randomBytes(256));
    fs.writeFileSync(path.join(DATA, 'default-user/user/files/mvu-bundle-d03b7dc8.js'), '// self-hosted bundle, reproducible\n');
    fs.writeFileSync(path.join(DATA, 'default-user/user/files/其他用户文件.txt'), 'user file kept\n');
    // 合成源故意保留 0644，用于验证恢复目标会被收紧
    for (const rel of ['default-user/settings.json', 'default-user/chats/合成角色/2026.jsonl']) fs.chmodSync(path.join(DATA, rel), 0o644);
    fs.writeFileSync(CONFIG, 'listen: false\n');
    fs.mkdirSync(path.dirname(KEY), { recursive: true, mode: 0o700 });
    fs.writeFileSync(KEY, PASS + '\n', { mode: 0o600 });
});
after(() => { if (T) fs.rmSync(T, { recursive: true, force: true }); });

test('备份→恢复到隔离目录：保护清单逐文件字节一致，归档 0600、VCBAE1 magic，不含 keyfile，自托管 bundle 被排除，恢复树 0700/0600，已有父目录权限不动', () => {
    const preOutDir = path.join(T, 'out'); fs.mkdirSync(preOutDir, { recursive: true }); fs.chmodSync(preOutDir, 0o755);
    const b = sh(BACKUP, [DATA, CONFIG, OUT], { VC_ST_BACKUP_PASSPHRASE_FILE: KEY });
    assert.equal(b.status, 0, b.stderr + b.stdout);
    assert.equal(fs.statSync(preOutDir).mode & 0o777, 0o755, '已存在的输出父目录权限必须保持不变');
    assert.equal(fs.statSync(OUT).mode & 0o777, 0o600);
    const fd = fs.openSync(OUT, 'r'); const head = Buffer.alloc(7); fs.readSync(fd, head, 0, 7, 0); fs.closeSync(fd);
    assert.equal(head.toString('latin1'), 'VCBAE1\n');
    const R = path.join(T, 'restored');
    const r = sh(RESTORE, [OUT, R], { VC_ST_BACKUP_PASSPHRASE_FILE: KEY });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const expected = ['cookie-secret.txt', 'default-user/settings.json', 'default-user/secrets.json', 'default-user/chats/合成角色/2026.jsonl', 'default-user/characters/合成角色.png', 'default-user/characters/合成角色/backgrounds/bg.png', 'default-user/worlds/合成世界.json', 'default-user/backups/chats/auto.jsonl', 'default-user/group chats/g.jsonl', 'default-user/OpenAI Settings/合成预设.json', 'default-user/user/images/合成角色/note.png', 'default-user/user/files/其他用户文件.txt'];
    for (const rel of expected) {
        assert.ok(fs.existsSync(path.join(R, rel)), `缺 ${rel}`);
        assert.ok(fs.readFileSync(path.join(DATA, rel)).equals(fs.readFileSync(path.join(R, rel))), `字节不一致 ${rel}`);
    }
    assert.ok(fs.readFileSync(CONFIG).equals(fs.readFileSync(path.join(R, '_config/config.yaml'))));
    const restoredFiles = walkFiles(R);
    assert.deepEqual(restoredFiles, [...expected, '_config/config.yaml'].sort(), '归档内容应恰为保护清单 + config：自托管 mvu-bundle 排除，其他 user 文件保留，无 keyfile');
    assert.ok(!restoredFiles.some((f) => /keys\/|\.env|mvu-bundle/.test(f)));
    // 恢复目标树收紧：源 0644 的文件恢复后必须是 0600，所有目录 0700
    const walkModes = (d, acc = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); acc.push([path.relative(R, p), fs.statSync(p).mode & 0o777, e.isDirectory()]); if (e.isDirectory()) walkModes(p, acc); } return acc; };
    for (const [rel, m, isDir] of walkModes(R)) assert.equal(m, isDir ? 0o700 : 0o600, `${rel} mode ${m.toString(8)}`);
    assert.equal(fs.statSync(R).mode & 0o777, 0o700);
    assert.equal(fs.statSync(path.join(DATA, 'default-user/settings.json')).mode & 0o777, 0o644, '恢复不触碰源目录');
});

test('错误口令 → unseal 认证失败（退出 3），目标目录保持为空', () => {
    const R = path.join(T, 'r-wrong');
    const r = sh(RESTORE, [OUT, R], { VC_ST_BACKUP_PASSPHRASE: 'definitely-wrong' });
    assert.equal(r.status, 3, r.stderr);
    assert.deepEqual(fs.readdirSync(R), []);
});

test('密文被篡改 1 字节 → 认证拒绝（退出 3），不输出任何明文', () => {
    const tampered = path.join(T, 'out', 't.vcbae1');
    const buf = fs.readFileSync(OUT);
    buf[Math.floor(buf.length / 2)] ^= 0x01;
    fs.writeFileSync(tampered, buf, { mode: 0o600 });
    const R = path.join(T, 'r-tamper');
    const r = sh(RESTORE, [tampered, R], { VC_ST_BACKUP_PASSPHRASE_FILE: KEY });
    assert.equal(r.status, 3, r.stderr);
    assert.deepEqual(fs.readdirSync(R), []);
});

test('MAC 尾部被篡改 / 文件被截断 → 拒绝', () => {
    const buf = fs.readFileSync(OUT);
    const macT = path.join(T, 'out', 'mac.vcbae1'); const b2 = Buffer.from(buf); b2[b2.length - 1] ^= 0xff; fs.writeFileSync(macT, b2, { mode: 0o600 });
    assert.equal(sh(RESTORE, [macT, path.join(T, 'r-mac')], { VC_ST_BACKUP_PASSPHRASE_FILE: KEY }).status, 3);
    const trunc = path.join(T, 'out', 'trunc.vcbae1'); fs.writeFileSync(trunc, buf.subarray(0, buf.length - 100), { mode: 0o600 });
    assert.equal(sh(RESTORE, [trunc, path.join(T, 'r-trunc')], { VC_ST_BACKUP_PASSPHRASE_FILE: KEY }).status, 3);
});

test('守卫：输出落在 dataRoot 内 / keyfile 在 dataRoot 内 / keyfile 非 0600 / 两种口令同时给 → 退出 1', () => {
    assert.equal(sh(BACKUP, [DATA, '-', path.join(DATA, 'x.vcbae1')], { VC_ST_BACKUP_PASSPHRASE: PASS }).status, 1);
    const inside = path.join(DATA, 'k'); fs.writeFileSync(inside, PASS, { mode: 0o600 });
    assert.equal(sh(BACKUP, [DATA, '-', path.join(T, 'out', 'y.vcbae1')], { VC_ST_BACKUP_PASSPHRASE_FILE: inside }).status, 1);
    fs.rmSync(inside);
    const loose = path.join(T, 'keys', 'loose'); fs.writeFileSync(loose, PASS, { mode: 0o644 });
    assert.equal(sh(BACKUP, [DATA, '-', path.join(T, 'out', 'z.vcbae1')], { VC_ST_BACKUP_PASSPHRASE_FILE: loose }).status, 1);
    assert.equal(sh(BACKUP, [DATA, '-', path.join(T, 'out', 'w.vcbae1')], { VC_ST_BACKUP_PASSPHRASE_FILE: KEY, VC_ST_BACKUP_PASSPHRASE: PASS }).status, 1);
    assert.equal(sh(BACKUP, [DATA, '-', path.join(T, 'out', 'v.vcbae1')], {}).status, 1, '无口令来源');
});

test('守卫：恢复到非空目录被拒绝（不覆盖已有数据）', () => {
    const R = path.join(T, 'nonempty'); fs.mkdirSync(R); fs.writeFileSync(path.join(R, 'existing'), 'x');
    const r = sh(RESTORE, [OUT, R], { VC_ST_BACKUP_PASSPHRASE_FILE: KEY });
    assert.equal(r.status, 1);
    assert.deepEqual(fs.readdirSync(R), ['existing']);
});

test('环境变量口令路径同样可用，且产物与 keyfile 路径互不相同', () => {
    const out2 = path.join(T, 'out2', 'env.vcbae1');
    const b = sh(BACKUP, [DATA, '-', out2], { VC_ST_BACKUP_PASSPHRASE: PASS });
    assert.equal(b.status, 0, b.stderr);
    const R = path.join(T, 'r-env');
    assert.equal(sh(RESTORE, [out2, R], { VC_ST_BACKUP_PASSPHRASE: PASS }).status, 0);
    assert.ok(fs.readFileSync(path.join(DATA, 'default-user/chats/合成角色/2026.jsonl')).equals(fs.readFileSync(path.join(R, 'default-user/chats/合成角色/2026.jsonl'))));
    assert.ok(!fs.existsSync(path.join(R, '_config')), '未传 config 时归档不含 _config');
});

test('W08 snapshot includes SQLite, metadata and Go suppression; restore requires fresh Go rights and blocks reads until reconciliation', () => {
    const engine = path.join(T, 'engine'), owner = path.join(engine, 'owners/1');
    fs.mkdirSync(path.join(owner, 'profiles/p1'), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(owner, 'profiles/p1/persona.md'), 'synthetic profile');
    fs.writeFileSync(path.join(owner, 'space-config.json'), JSON.stringify({ spaceId: 'synthetic-space' }));
    const db = path.join(owner, 'vectors.db');
    const seeded = spawnSync('python3', ['-c', "import sqlite3,sys; db=sqlite3.connect(sys.argv[1]); db.execute('CREATE TABLE memories(value TEXT)'); db.execute(\"INSERT INTO memories VALUES ('synthetic')\"); db.commit(); db.close()", db]);
    assert.equal(seeded.status, 0);
    const bin = path.join(T, 'synthetic-pg-bin'); fs.mkdirSync(bin);
    const rights = { version: 1, owners: { '1': { deleted: false, recordIds: ['old'], sourceIds: ['source-1-1-1'], suppressedSources: [] } }, deletions: [] };
    const fixture = path.join(T, 'current-rights.json'); fs.writeFileSync(fixture, JSON.stringify(rights));
    fs.writeFileSync(path.join(bin, 'psql'), '#!/usr/bin/env python3\nimport os\nprint(open(os.environ["VC_TEST_RIGHTS"]).read())\n', { mode: 0o700 });
    const env = { VC_ST_BACKUP_PASSPHRASE: PASS, VC_MEMORYCORE_DATA_ROOT: engine,
        VC_MEMORYCORE_DATABASE_URL: 'postgresql://synthetic', VC_TEST_RIGHTS: fixture, PATH: bin + path.delimiter + process.env.PATH };
    const archive = path.join(T, 'engine-backup/snapshot.vcbae1');
    const b = sh(BACKUP, [DATA, '-', archive], env); assert.equal(b.status, 0, b.stderr + b.stdout);
    // Rights changed after the backup. Restoring must use this new source state.
    rights.owners['1'].recordIds = []; rights.owners['1'].sourceIds = [];
    rights.owners['1'].suppressedSources = [{ sourceId: '1', sourceRef: 'synthetic', suppressed: true }];
    fs.writeFileSync(fixture, JSON.stringify(rights));
    const target = path.join(T, 'engine-restore');
    const r = sh(RESTORE, [archive, target], env); assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.equal(fs.readFileSync(path.join(target, '_memorycore/owners/1/profiles/p1/persona.md'), 'utf8'), 'synthetic profile');
    const read = spawnSync('python3', ['-c', "import sqlite3,sys; print(sqlite3.connect(sys.argv[1]).execute('SELECT value FROM memories').fetchone()[0])", path.join(target, '_memorycore/owners/1/vectors.db')], { encoding: 'utf8' });
    assert.equal(read.status, 0); assert.equal(read.stdout.trim(), 'synthetic');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(target, '_memorycore/go-rights.json'), 'utf8')).owners['1'].recordIds, ['old']);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(target, '_memorycore/restore-pending.json'), 'utf8')), rights);
    const unavailable = sh(RESTORE, [archive, path.join(T, 'engine-unavailable')], { ...env, VC_MEMORYCORE_DATABASE_URL: undefined });
    assert.equal(unavailable.status, 5);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(T, 'engine-unavailable/_memorycore/restore-pending.json'), 'utf8')), { blocked: true });
    fs.writeFileSync(path.join(engine, 'runtime.lock'), String(process.pid));
    const running = sh(BACKUP, [DATA, '-', path.join(T, 'engine-backup/running.vcbae1')], env);
    assert.equal(running.status, 2); assert.equal(fs.existsSync(path.join(T, 'engine-backup/running.vcbae1')), false);
});
