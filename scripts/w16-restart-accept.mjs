#!/usr/bin/env node
// V2-W16 O01 重启演练。独立脚本，不注册进 accept-managed。
// 在本 worktree 受管栈上写入合成状态，停止并重启 companiond、SillyTavern 与 MemoryCore，
// 再核对聊天、绑定、记忆、inbox、通知、跟进租约、HELD 预留、剧情投影与删除屏障。
// 不调用真实模型，不连接真实邮箱或飞书。凭据只留在进程内存。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
    createGoAdminClient, createStClient, synthApiKey, synthRestKey, synthSecret, synthServiceToken, waitFor,
} from '../integrations/sillytavern/scripts/managed-lib.mjs';
import { importSyntheticCard } from '../integrations/sillytavern/scripts/w05-accept.mjs';
import { startW10Capture, stopW10Capture } from '../integrations/sillytavern/scripts/w10-accept.mjs';
import { createStoryProjection } from '../integrations/sillytavern/extension/vc-model-settings/story-projection.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INTEG = path.join(REPO, 'integrations/sillytavern');
const BACKEND = path.join(REPO, 'backend');
const SCRIPTS = path.join(INTEG, 'scripts');
const GO_TOOLCHAIN = 'go1.26.10';
const PG_IMAGE = process.env.VC_W03_PG_IMAGE || 'pgvector/pgvector:0.8.5-pg18';
const MINIO_IMAGE = process.env.VC_W03_MINIO_IMAGE || 'vc-g12-minio-tools:local';
const PG_LABEL = 'managed';

loadWorktreeEnv();
const ST_PORT = mustPort('VC_ST_PORT');
const FIXTURE_PORT = mustPort('VC_W03_FIXTURE_PORT');
const GO_PORT = mustPort('VC_W03_GO_PORT');
const MEMORYCORE_PORT = mustPort('VC_MEMORYCORE_PORT');
const DEV_MANAGED = mustPath('VC_W03_DEV_DIR');
const PG_CONTAINER = mustContainer('VC_W03_PG_CONTAINER');
const MINIO_CONTAINER = mustContainer('VC_W03_MINIO_CONTAINER');
const S3_BUCKET = process.env.VC_W03_S3_BUCKET || '';
if (!/^vcw16c-[a-z0-9-]+$/.test(S3_BUCKET)) throw new Error('VC_W03_S3_BUCKET 必须是本 worktree 的 vcw16c-* 桶');
const ST_BASE = `http://127.0.0.1:${ST_PORT}`;
const GO_BASE = `http://127.0.0.1:${GO_PORT}`;
const OWNER_ID = String(Date.now());
const SECOND_ID = String(BigInt(OWNER_ID) + 1n);
const RUN_DIR = path.join(DEV_MANAGED, 'run');

const results = [];
function record(name, ok, detail) {
    results.push({ name, ok, detail });
    console.log(`[w16-restart] ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

function loadWorktreeEnv() {
    const file = path.join(REPO, '.vc-wt.env');
    if (!fs.existsSync(file)) return;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq < 1) continue;
        const key = trimmed.slice(0, eq);
        if (process.env[key] == null || process.env[key] === '') process.env[key] = trimmed.slice(eq + 1);
    }
}
function mustPort(name) {
    const value = process.env[name] || '';
    if (!/^\d+$/.test(value)) throw new Error(`${name} 缺失`);
    const port = Number(value);
    if (port === 8752 || port === 8095 || port === 8754 || port < 1024 || port > 65535) throw new Error(`${name} 不是本 worktree 端口`);
    return port;
}
function mustContainer(name) {
    const value = process.env[name] || '';
    if (!/^vc-w16c-[a-z0-9-]+$/.test(value)) throw new Error(`${name} 必须是 vc-w16c-* 容器`);
    return value;
}
function mustPath(name) {
    const value = process.env[name] || '';
    if (!value.startsWith(REPO)) throw new Error(`${name} 必须位于本 worktree`);
    return value;
}
function die(message) { throw new Error(message); }
function runChecked(cmd, args, { cwd, env, label, input } = {}) {
    const stdin = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
    const result = spawnSync(cmd, args, {
        cwd, encoding: 'buffer', input: stdin,
        env: env ? { ...process.env, ...env } : process.env,
    });
    if (result.stderr?.length) process.stderr.write(result.stderr);
    if (result.error) die(`${label} 无法执行：${result.error.message}`);
    if (result.status !== 0) die(`${label} 失败（exit=${result.status}）`);
    return result.stdout?.toString('utf8') ?? '';
}
function listeningPids(port) {
    const result = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp'], { encoding: 'utf8' });
    return [...(result.stdout || '').matchAll(/^p(\d+)$/gm)].map((match) => Number(match[1]));
}
function assertPortsFree() {
    for (const [name, port] of [['ST', ST_PORT], ['fixture', FIXTURE_PORT], ['Go', GO_PORT], ['MemoryCore', MEMORYCORE_PORT]]) {
        const pids = listeningPids(port);
        if (pids.length) die(`端口 ${port}（${name}）已被 PID ${pids.join(',')} 监听`);
    }
}
function psql(sql) {
    return runChecked('docker', ['exec', '-i', PG_CONTAINER, 'psql', '-U', 'postgres', '-d', 'vc', '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A'], {
        label: 'psql', input: sql,
    }).trim();
}
function decimal(value, label) {
    const text = String(value ?? '').trim();
    if (!/^[1-9][0-9]{0,18}$/.test(text)) die(`${label} 不是十进制编号`);
    return text;
}
function token(value, label) {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(value)) die(`${label} 含非法字符`);
    return value;
}
function totpCode(secret, at = Date.now()) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = '';
    for (const char of secret.toUpperCase().replace(/=+$/, '')) bits += alphabet.indexOf(char).toString(2).padStart(5, '0');
    const bytes = Buffer.from((bits.match(/.{8}/g) || []).map((item) => Number.parseInt(item, 2)));
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
    const digest = crypto.createHmac('sha1', bytes).update(counter).digest();
    const offset = digest.at(-1) & 15;
    return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}
async function authRequest(suffix, body) {
    const response = await fetch(`${GO_BASE}/api/v1/auth/${suffix}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ST_BASE }, body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) die(`合成认证未完成（HTTP ${response.status}）`);
    return { response, data };
}
function sessionFrom(response, data) {
    const cookies = new Map((response.headers.getSetCookie?.() || []).map((line) => {
        const pair = line.split(';')[0];
        const split = pair.indexOf('=');
        return [pair.slice(0, split), pair.slice(split + 1)];
    }));
    if (!cookies.get('vc_session') || !cookies.get('vc_csrf') || data.nextStep !== 'ACTIVE') die('合成登录未返回完整会话');
    return { vcSession: cookies.get('vc_session'), vcCsrf: cookies.get('vc_csrf'), accountId: data.accountId, sessionId: data.sessionId };
}
async function login(account, password) {
    const { data: challenge } = await authRequest('login', { account, password });
    if (challenge.nextStep !== 'AUTHENTICATOR_SETUP_REQUIRED') die('合成账号应进入首次 TOTP 设置');
    const { data: setup } = await authRequest(`challenges/${challenge.challengeId}/authenticator-setup`, {});
    const confirmed = await authRequest(`challenges/${challenge.challengeId}/authenticator-confirm`, { code: totpCode(setup.manualKey), trustDevice: false });
    return sessionFrom(confirmed.response, confirmed.data);
}

async function startPg(secrets) {
    const exists = spawnSync('docker', ['inspect', '-f', '{{.Id}}', PG_CONTAINER], { encoding: 'utf8' });
    if (exists.status === 0) {
        const label = spawnSync('docker', ['inspect', '-f', '{{index .Config.Labels "com.vc.w03"}}', PG_CONTAINER], { encoding: 'utf8' });
        if ((label.stdout || '').trim() !== PG_LABEL) die(`容器 ${PG_CONTAINER} 不是本夹具`);
        runChecked('docker', ['rm', '-f', PG_CONTAINER], { label: 'docker rm 旧 PG' });
    }
    runChecked('docker', [
        'run', '-d', '--name', PG_CONTAINER, '--label', `com.vc.w03=${PG_LABEL}`,
        '-e', `POSTGRES_PASSWORD=${secrets.pgPassword}`, '-e', 'POSTGRES_DB=vc',
        '-p', '127.0.0.1::5432', PG_IMAGE,
    ], { label: 'docker run PG' });
    const portOut = runChecked('docker', ['port', PG_CONTAINER, '5432/tcp'], { label: 'docker port pg' });
    const match = /127\.0\.0\.1:(\d+)/.exec(portOut.trim());
    if (!match) die('无法解析 PG 端口');
    secrets.dsn = `postgres://postgres:${secrets.pgPassword}@127.0.0.1:${match[1]}/vc`;
    await waitFor(() => spawnSync('docker', ['exec', PG_CONTAINER, 'pg_isready', '-h', '127.0.0.1', '-p', '5432', '-U', 'postgres', '-d', 'vc']).status === 0, {
        timeoutMs: 60000, label: '受管 PG',
    });
}
async function startMinio(secrets) {
    const exists = spawnSync('docker', ['inspect', '-f', '{{.Id}}', MINIO_CONTAINER], { encoding: 'utf8' });
    if (exists.status === 0) {
        const label = spawnSync('docker', ['inspect', '-f', '{{index .Config.Labels "com.vc.w03"}}', MINIO_CONTAINER], { encoding: 'utf8' });
        if ((label.stdout || '').trim() !== PG_LABEL) die(`容器 ${MINIO_CONTAINER} 不是本夹具`);
        runChecked('docker', ['rm', '-f', MINIO_CONTAINER], { label: 'docker rm 旧 MinIO' });
    }
    if (spawnSync('docker', ['image', 'inspect', MINIO_IMAGE], { encoding: 'utf8' }).status !== 0) die(`镜像 ${MINIO_IMAGE} 不在本机`);
    const accessKey = `vc16c-${synthSecret(9)}`;
    const secretKey = synthSecret(18);
    runChecked('docker', [
        'run', '-d', '--name', MINIO_CONTAINER, '--label', `com.vc.w03=${PG_LABEL}`,
        '-e', `MINIO_ROOT_USER=${accessKey}`, '-e', `MINIO_ROOT_PASSWORD=${secretKey}`,
        '-p', '127.0.0.1::9000', MINIO_IMAGE, 'server', '/data',
    ], { label: 'docker run MinIO' });
    const portOut = runChecked('docker', ['port', MINIO_CONTAINER, '9000/tcp'], { label: 'docker port minio' });
    const match = /127\.0\.0\.1:(\d+)/.exec(portOut.trim());
    if (!match) die('无法解析 MinIO 端口');
    await waitFor(async () => {
        try { return (await fetch(`http://127.0.0.1:${match[1]}/minio/health/live`)).ok; } catch { return false; }
    }, { timeoutMs: 60000, label: '受管 MinIO' });
    fs.mkdirSync(RUN_DIR, { recursive: true, mode: 0o700 });
    const mcConfig = path.join(RUN_DIR, 'mc-config.json');
    fs.writeFileSync(mcConfig, JSON.stringify({
        version: '10',
        aliases: { w03: { url: 'http://127.0.0.1:9000', accessKey, secretKey, api: 'S3v4', path: 'auto' } },
    }), { mode: 0o600 });
    try {
        runChecked('docker', [
            'run', '--rm', '--entrypoint', '/bin/mc', '--network', `container:${MINIO_CONTAINER}`,
            '-e', 'MC_UPDATE=off', '-e', 'MINIO_UPDATE=off',
            '-v', `${mcConfig}:/mc-config/config.json:ro`,
            MINIO_IMAGE, '--config-dir', '/mc-config', 'mb', '--ignore-existing', `w03/${S3_BUCKET}`,
        ], { label: 'mc 建桶' });
    } finally {
        fs.rmSync(mcConfig, { force: true });
    }
    secrets.s3 = { endpoint: `http://127.0.0.1:${match[1]}`, accessKey, secretKey, bucket: S3_BUCKET };
}
function goEnv(secrets, capture) {
    return {
        VC_MODE: 'full', VC_VERSION: 'w16c-restart', VC_LOG_LEVEL: 'info',
        VC_HTTP_ADDR: `127.0.0.1:${GO_PORT}`, VC_HTTP_ORIGINS: ST_BASE, VC_SESSION_COOKIE_SECURE: 'false',
        VC_BUDGET_MAX_RESERVED_COST: '1000000', VC_MONTHLY_COST_LIMIT: '10000000',
        VC_DB_DSN: secrets.dsn, VC_MIGRATE_DB_DSN: secrets.dsn,
        VC_OWNER_BINDING_SECRET: secrets.ownerBinding, VC_CRYPTO_REST_KEY: secrets.restKey,
        VC_EXPORT_S3_ENDPOINT: secrets.s3.endpoint, VC_EXPORT_S3_ACCESS_KEY: secrets.s3.accessKey,
        VC_EXPORT_S3_SECRET_KEY: secrets.s3.secretKey, VC_EXPORT_S3_BUCKET: secrets.s3.bucket,
        VC_PROVIDER_ALLOW_LOOPBACK_HTTP: 'true',
        VC_ST_PLUGIN_SERVICE_TOKEN: secrets.serviceToken, VC_ST_HOST_BASE_URL: ST_BASE,
        VC_MEMORYCORE_BASE_URL: `http://127.0.0.1:${MEMORYCORE_PORT}`,
        VC_MEMORYCORE_SERVICE_TOKEN: secrets.memorycoreToken, VC_MEMORYCORE_CALLBACK_TOKEN: secrets.memorycoreCallbackToken,
        VC_SMTP_HOST: '127.0.0.1', VC_SMTP_PORT: String(capture.smtpPort),
        VC_SMTP_FROM: 'notify@example.test', VC_SMTP_CA_FILE: capture.caFile,
    };
}
async function startGo(secrets, capture) {
    fs.mkdirSync(RUN_DIR, { recursive: true, mode: 0o700 });
    const binary = path.join(RUN_DIR, 'companiond-w16c');
    if (!fs.existsSync(binary)) {
        runChecked('go', ['build', '-C', BACKEND, '-mod=vendor', '-o', binary, './cmd/companiond'], {
            cwd: REPO, env: { GOTOOLCHAIN: GO_TOOLCHAIN, GOPROXY: 'off' }, label: 'go build companiond',
        });
    }
    const logFd = fs.openSync(path.join(RUN_DIR, 'go-w16c.log'), 'a');
    const child = spawn(binary, [], { env: { ...process.env, ...goEnv(secrets, capture) }, stdio: ['ignore', logFd, logFd], detached: true });
    fs.closeSync(logFd);
    child.unref();
    secrets.goPid = child.pid;
    await waitFor(async () => {
        try { return (await fetch(`${GO_BASE}/actuator/health`)).ok; } catch { return false; }
    }, { timeoutMs: 60000, label: 'Go 健康检查' });
}
async function stopGo(secrets) {
    if (!secrets.goPid) return;
    try { process.kill(secrets.goPid, 'SIGTERM'); } catch { /* 已退出 */ }
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
        try { process.kill(secrets.goPid, 0); } catch { secrets.goPid = 0; return; }
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
    try { process.kill(secrets.goPid, 'SIGKILL'); } catch { /* 已退出 */ }
    secrets.goPid = 0;
}
function managedNode(script, env, label) {
    runChecked(process.execPath, [path.join(SCRIPTS, script)], {
        cwd: INTEG,
        env: { VC_ST_DEV_DIR: DEV_MANAGED, VC_ST_PORT: String(ST_PORT), VC_MEMORYCORE_PORT: String(MEMORYCORE_PORT), ...env },
        label,
    });
}
async function prepareStUser() {
    const requireSt = createRequire(path.join(INTEG, 'upstream/SillyTavern/package.json'));
    const storage = requireSt('node-persist').create();
    await storage.init({ dir: path.join(DEV_MANAGED, 'data/_storage'), ttl: false, expiredInterval: 0 });
    if (!await storage.getItem('user:default-user')) {
        await storage.setItem('user:default-user', { handle: 'default-user', name: 'User', created: Date.now(), password: '', admin: true, enabled: true, salt: '' });
    }
    const settingsPath = path.join(DEV_MANAGED, 'data/default-user/settings.json');
    if (!fs.existsSync(settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(path.join(INTEG, 'upstream/SillyTavern/default/content/settings.json'), 'utf8'));
        settings.firstRun = false;
        settings.username = '合成验收用户';
        fs.mkdirSync(path.dirname(settingsPath), { recursive: true, mode: 0o700 });
        fs.writeFileSync(settingsPath, JSON.stringify(settings), { mode: 0o600 });
    }
}
async function startStack(secrets, capture) {
    if (!fs.existsSync(path.join(INTEG, 'upstream/SillyTavern/node_modules'))) die('upstream node_modules 缺失');
    managedNode('assemble-managed.mjs', {}, 'assemble-managed');
    await prepareStUser();
    managedNode('start-managed.mjs', {
        VC_ST_GO_BASE_URL: GO_BASE,
        VC_ST_PLUGIN_SERVICE_TOKEN: secrets.serviceToken,
        VC_MEMORYCORE_SERVICE_TOKEN: secrets.memorycoreToken,
        VC_MEMORYCORE_CALLBACK_BASE_URL: GO_BASE,
        VC_MEMORYCORE_CALLBACK_TOKEN: secrets.memorycoreCallbackToken,
        VC_ST_ACCOUNT_HANDLES: JSON.stringify({ [OWNER_ID]: 'default-user' }),
        VC_ST_GO_TIMEOUT_MS: '30000',
    }, 'start-managed');
    await waitFor(async () => {
        try {
            const response = await fetch(`${ST_BASE}/auth/`);
            return response.ok && String(response.headers.get('content-type')).includes('text/html');
        } catch { return false; }
    }, { timeoutMs: 120000, label: 'ST 登录入口' });
    await waitFor(async () => {
        try { return (await fetch(`http://127.0.0.1:${MEMORYCORE_PORT}/healthz`)).ok; } catch { return false; }
    }, { timeoutMs: 30000, label: 'MemoryCore healthz' });
    void capture;
}
function stopStack() {
    managedNode('stop-managed.mjs', {}, 'stop-managed');
}
async function restartProcesses(secrets, capture) {
    stopStack();
    await stopGo(secrets);
    await waitFor(() => listeningPids(GO_PORT).length === 0 && listeningPids(ST_PORT).length === 0 && listeningPids(MEMORYCORE_PORT).length === 0, {
        timeoutMs: 20000, label: '重启前端口释放',
    });
    await startGo(secrets, capture);
    await startStack(secrets, capture);
}
function removeOwnedContainers() {
    for (const name of [PG_CONTAINER, MINIO_CONTAINER]) {
        const label = spawnSync('docker', ['inspect', '-f', '{{index .Config.Labels "com.vc.w03"}}', name], { encoding: 'utf8' });
        if (label.status !== 0) continue;
        if ((label.stdout || '').trim() !== PG_LABEL) continue;
        spawnSync('docker', ['rm', '-f', name], { encoding: 'utf8' });
    }
}

function seedUsers(passwordHash, password) {
    psql(`
INSERT INTO vc.vc_user(id, display_name)
VALUES (${OWNER_ID}, 'w16c-owner'), (${SECOND_ID}, 'w16c-second')
ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name;
INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name)
VALUES (${OWNER_ID}, 'w16c-owner', '${passwordHash}', 'ADMIN', 'ACTIVE', 'w16c-owner'),
       (${SECOND_ID}, 'w16c-second', '${passwordHash}', 'ADMIN', 'ACTIVE', 'w16c-second')
ON CONFLICT (id) DO UPDATE SET role = 'ADMIN', status = 'ACTIVE';
`);
    return password;
}
function insertFollowUp(owner, relationshipId, eventId, status, extraSql) {
    const id = psql(`INSERT INTO vc.follow_up(
        owner_user_id, id, relationship_id, body, status, normalization_status, event_id, deliverable ${extraSql.columns}
    ) VALUES (
        ${owner}, nextval('vc.follow_up_id_seq'), ${relationshipId}, 'w16c-${eventId}', '${status}', 'none', '${eventId}',
        '${status === 'WAITING_HOST' ? 'NOT_DELIVERABLE' : 'DELIVERABLE'}' ${extraSql.values}
    ) RETURNING id;`);
    return decimal(id, 'follow_up');
}
function deliveryStatuses(owner, eventId) {
    const raw = psql(`SELECT coalesce(json_agg(json_build_object('channel', channel, 'status', status) ORDER BY id), '[]'::json)
        FROM vc.notification_delivery WHERE owner_user_id=${owner} AND event_id='${token(eventId, 'event')}';`);
    return JSON.parse(raw || '[]');
}
async function poll(probe, label, timeoutMs = 20000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        if (await probe()) return;
        await new Promise((resolve) => setTimeout(resolve, 400));
    }
    die(label);
}

async function main() {
    assertPortsFree();
    const vector = JSON.parse(fs.readFileSync(path.join(BACKEND, 'contracttest/testdata/crypto-vectors.json'), 'utf8')).bcrypt;
    const secrets = {
        pgPassword: synthSecret(18), ownerBinding: synthServiceToken(), restKey: synthRestKey(),
        serviceToken: synthServiceToken(), memorycoreToken: synthServiceToken(), memorycoreCallbackToken: synthServiceToken(),
        fixtureKey: synthApiKey(), password: vector.password, goPid: 0,
    };
    const capture = await startW10Capture();
    const artifacts = { capture, secrets };
    try {
        await startPg(secrets);
        runChecked('go', ['run', '-C', BACKEND, '-mod=vendor', './cmd/companiond', 'migrate'], {
            cwd: REPO, env: { GOTOOLCHAIN: GO_TOOLCHAIN, GOPROXY: 'off', VC_MIGRATE_DB_DSN: secrets.dsn }, label: 'migrate',
        });
        runChecked('go', ['run', '-C', BACKEND, '-mod=vendor', './cmd/companiond', 'bootstrap'], {
            cwd: REPO,
            env: { GOTOOLCHAIN: GO_TOOLCHAIN, GOPROXY: 'off', VC_BOOTSTRAP_DB_DSN: secrets.dsn, VC_OWNER_BINDING_SECRET: secrets.ownerBinding },
            label: 'bootstrap',
        });
        await startMinio(secrets);
        await startGo(secrets, capture);
        seedUsers(vector.goHash, vector.password);
        secrets.session = await login('w16c-owner', secrets.password);
        secrets.secondSession = await login('w16c-second', secrets.password);
        const admin = createGoAdminClient({ baseUrl: GO_BASE, origin: ST_BASE, session: secrets.session });
        const second = createGoAdminClient({ baseUrl: GO_BASE, origin: ST_BASE, session: secrets.secondSession });
        await startStack(secrets, capture);
        if (!(await admin.reauth(secrets.password)).ok) die('Owner 重新认证失败');

        const st = createStClient({
            baseUrl: ST_BASE,
            extraCookies: `vc_session=${secrets.session.vcSession}; vc_csrf=${secrets.session.vcCsrf}`,
            expectedIdentity: secrets.session,
        });
        const card = await importSyntheticCard(st, 'W16 重启');
        const companionFile = `W16C-${crypto.randomUUID()}`;
        const storyFile = `W16C-story-${crypto.randomUUID()}`;
        const companionToken = { id: crypto.randomUUID(), revision: 0 };
        const storyToken = { id: crypto.randomUUID(), revision: 0 };
        const headerChat = (f2, line) => [{ chat_metadata: { vc_f2: f2 } }, { name: '合成用户', is_user: true, mes: line, extra: {} }];
        const saveNamed = async (file, chat) => {
            const saved = await st.call('POST', '/api/chats/save', { avatar_url: card.avatar, file_name: file, chat, force: false });
            if (saved.status !== 200) die(`保存聊天失败 ${saved.status}`);
        };
        const readNamed = async (file) => {
            const loaded = await st.call('POST', '/api/chats/get', { avatar_url: card.avatar, file_name: file });
            if (loaded.status !== 200 || !Array.isArray(loaded.json)) die(`读取聊天失败 ${loaded.status}`);
            return loaded.json;
        };
        await saveNamed(companionFile, headerChat(companionToken, 'w16c-companion-line'));
        await saveNamed(storyFile, headerChat(storyToken, 'w16c-story-line'));
        const bind = async (identity, mode) => {
            const created = await admin.call('POST', '/api/v1/st/bindings', {
                chatIdentity: identity, characterRef: crypto.randomUUID(), mode, displayName: `W16 ${mode}`,
            });
            if (created.status !== 200) die(`绑定失败 ${created.status}`);
            return { relationshipId: decimal(created.json.relationshipId, 'relationship'), conversationId: decimal(created.json.conversationId, 'conversation') };
        };
        const companion = await bind(companionToken.id, 'COMPANION');
        const storyBinding = await bind(storyToken.id, 'STORY');
        const memoryToken = `w16c-mem-${crypto.randomUUID().slice(0, 8)}`;
        const memory = await admin.call('POST', `/api/v1/relationships/${companion.relationshipId}/memories/candidates`, {
            scope: 'RELATIONSHIP', summary: memoryToken,
        });
        if (memory.status !== 200) die(`记忆候选失败 ${memory.status}`);

        const putChannel = async (channel, target, credential) => {
            const saved = await admin.call('PUT', '/api/v1/notification-channels', {
                channel, enabled: true, configuredTarget: target, previewBody: false,
                relationshipIds: [companion.relationshipId], credential,
            });
            if (saved.status !== 200) die(`渠道保存失败 ${saved.status}`);
        };
        await putChannel('EMAIL', 'owner@example.test', `mailer\n${capture.smtpPassword}`);
        await putChannel('FEISHU', 'group-w16c', `${capture.webhookURL}\n${capture.signSecret}`);
        if ((await admin.call('PUT', '/api/v1/consents', { consentType: 'PUSH_NOTIFICATION', version: 'w16c', granted: true })).status !== 200) die('通知同意失败');
        const policyBody = { enabled: true, dailyLimit: 5, recentInteractionMinutes: 30, offlineCapable: true, allowedModes: ['COMPANION'] };
        if ((await admin.call('PUT', `/api/v1/relationships/${companion.relationshipId}/proactive-policy`, policyBody)).status !== 200) die('主动策略失败');
        insertFollowUp(OWNER_ID, companion.relationshipId, 'w16c-body', 'BODY_READY', {
            columns: ', greeting_body, generation_outcome', values: `, 'w16c-greeting', 'BODY_READY'`,
        });
        await poll(() => deliveryStatuses(OWNER_ID, 'w16c-body').length === 2 && deliveryStatuses(OWNER_ID, 'w16c-body').every((row) => row.status === 'accepted'), 'BODY_READY 未形成 accepted');
        const hour = new Date().getUTCHours();
        const pad = (value) => String(value).padStart(2, '0');
        const quiet = await admin.call('PUT', `/api/v1/relationships/${companion.relationshipId}/proactive-policy`, {
            ...policyBody,
            quietHoursStart: `${pad((hour - 2 + 24) % 24)}:00`,
            quietHoursEnd: `${pad((hour + 2) % 24)}:00`,
            quietHoursTimezone: 'UTC',
        });
        if (quiet.status !== 200) die('quiet hours 失败');
        insertFollowUp(OWNER_ID, companion.relationshipId, 'w16c-quiet', 'BODY_READY', {
            columns: ', greeting_body, generation_outcome', values: `, 'w16c-quiet-greeting', 'BODY_READY'`,
        });
        await poll(() => {
            const rows = deliveryStatuses(OWNER_ID, 'w16c-quiet');
            return rows.length === 2 && rows.every((row) => row.status === 'pending');
        }, 'quiet hours 投递没有保持 pending');

        const memoryId = decimal(memory.json?.memoryId, 'memory');
        const leaseFollow = psql(`INSERT INTO vc.follow_up(
            owner_user_id, id, relationship_id, memory_item_id, body, status, normalization_status,
            time_precision, event_date, event_time, event_timezone, trigger_at, event_id, source_ref, deliverable)
            VALUES (${OWNER_ID}, nextval('vc.follow_up_id_seq'), ${companion.relationshipId}, ${memoryId}, 'w16c-lease', 'SCHEDULED', 'explicit_date',
            'minute', DATE '2026-11-02', '15:04', 'Asia/Shanghai', clock_timestamp() - interval '1 hour', 'w16c-lease', 'st:11111111-1111-4111-8111-111111111111', 'NOT_DELIVERABLE')
            RETURNING id;`);
        const leaseJob = psql(`INSERT INTO vc.work_item(
            owner_user_id, id, kind, ref_id, status, claim_token, claim_fence, claimed_at, lease_expires_at, attempt_count)
            VALUES (${OWNER_ID}, nextval('vc.work_item_id_seq'), 'FOLLOW_UP', ${decimal(leaseFollow, 'lease follow')}, 'CLAIMED',
            'w16c-old-token', 'w16c-old-fence', clock_timestamp() - interval '10 minutes', clock_timestamp() - interval '1 minute', 0)
            RETURNING id;`);
        psql(`INSERT INTO vc.model_unit_price(provider_id, model_id, price_version, input_usd_per_1k, output_usd_per_1k, active)
            VALUES ('w16c-meter', 'priced', 1, 0.001, 0.002, true)
            ON CONFLICT (provider_id, model_id, price_version) DO UPDATE SET active = true;`);
        const reserve = (marker) => psql(`
BEGIN;
SELECT vc.set_owner_context(${OWNER_ID}, '${marker}', encode(vc.hmac(convert_to(
    'vc-owner-binding-v1|${OWNER_ID}|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|${marker}',
    'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
SELECT out_status FROM vc.reserve_model_usage(${OWNER_ID}, 'FOREGROUND_CHAT', '${marker}', 'w16c-meter', 'priced', 10, 10, 1000000, 8000000);
COMMIT;`);
        if (!reserve('w16c-aged').includes('HELD') || !reserve('w16c-young').includes('HELD')) die('预留没有保持 HELD');
        psql(`UPDATE vc.model_cost_reservation SET created_at = clock_timestamp() - interval '2 hours' WHERE provider_attempt_id = 'w16c-aged';`);

        const started = await admin.call('POST', '/api/v1/story/runs', { conversationId: storyBinding.conversationId, caseId: 'rainy-inn-v1' });
        if (started.status !== 200) die(`开局失败 ${started.status}`);
        const runId = decimal(started.json.runId, 'run');
        const branchId = decimal(started.json.branchId, 'branch');
        const action = await admin.call('POST', `/api/v1/story/runs/${runId}/actions`, {
            branchId, expectedWorldVersion: started.json.worldVersion, actionId: 'a1', actorId: 'player',
            action: 'request_evidence', target: 'lin', clueId: '', text: '',
        });
        if (action.status !== 200 || action.json.accepted !== true) die(`剧情行动失败 ${action.status}`);
        const worldEventId = decimal(action.json.worldEventId, 'event');
        const worldVersion = action.json.worldVersion;
        const beforeStory = psql(`SELECT r.world_version::text || ' ' || r.current_branch_id::text || ' ' || e.projection_state
            FROM vc.story_run r JOIN vc.story_event e ON e.owner_user_id = r.owner_user_id AND e.id = ${worldEventId}
            WHERE r.owner_user_id = ${OWNER_ID} AND r.id = ${runId};`);
        if (beforeStory !== `${worldVersion} ${branchId} PENDING`) die(`行动后世界状态异常`);

        const barrierRel = decimal(psql(`INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active)
            VALUES (${SECOND_ID}, nextval('vc.relationship_id_seq'), 'w16c-barrier', true) RETURNING id;`), 'barrier relationship');
        const barrierFollow = decimal(psql(`INSERT INTO vc.follow_up(
            owner_user_id, id, relationship_id, body, status, normalization_status, event_id, deliverable)
            VALUES (${SECOND_ID}, nextval('vc.follow_up_id_seq'), ${barrierRel}, 'w16c-barrier', 'CANCELLED', 'none', 'w16c-barrier', 'NOT_DELIVERABLE')
            RETURNING id;`), 'barrier follow');
        const barrierJob = decimal(psql(`INSERT INTO vc.work_item(owner_user_id, id, kind, ref_id, status)
            VALUES (${SECOND_ID}, nextval('vc.work_item_id_seq'), 'FOLLOW_UP', ${barrierFollow}, 'PENDING') RETURNING id;`), 'barrier job');
        if (!(await second.reauth(secrets.password)).ok) die('第二账号重新认证失败');
        const deletion = await second.call('DELETE', '/api/v1/auth/account', { currentPassword: secrets.password });
        if (deletion.status !== 202 && deletion.status !== 200) die(`删除请求失败 ${deletion.status}`);
        const beforeInbox = Number(psql(`SELECT count(*) FROM vc.inbox_event WHERE owner_user_id=${OWNER_ID} AND event_id='w16c-body';`));
        const beforeSmtp = capture.smtpTexts.length;
        const beforeFeishu = capture.feishuTexts.length;
        const companionLines = (await readNamed(companionFile)).length;

        await restartProcesses(secrets, capture);
        const adminAfter = createGoAdminClient({ baseUrl: GO_BASE, origin: ST_BASE, session: secrets.session });
        const secondAfter = createGoAdminClient({ baseUrl: GO_BASE, origin: ST_BASE, session: secrets.secondSession });
        const stAfter = createStClient({
            baseUrl: ST_BASE,
            extraCookies: `vc_session=${secrets.session.vcSession}; vc_csrf=${secrets.session.vcCsrf}`,
            expectedIdentity: secrets.session,
        });
        const readAfter = async (file) => {
            const loaded = await stAfter.call('POST', '/api/chats/get', { avatar_url: card.avatar, file_name: file });
            return loaded;
        };
        const companionAfter = await readAfter(companionFile);
        record('聊天可读', companionAfter.status === 200 && companionAfter.json?.length === companionLines, `HTTP ${companionAfter.status}`);
        const reconcile = await adminAfter.call('POST', '/api/v1/st/sources/reconcile', { chatIdentities: [companionToken.id, storyToken.id] });
        const states = Array.isArray(reconcile.json) ? reconcile.json.map((row) => row.state) : [];
        record('绑定对账', reconcile.status === 200 && states.length === 2 && states.every((state) => state === 'PRESENT'), states.join(','));
        const memories = await adminAfter.call('GET', `/api/v1/relationships/${companion.relationshipId}/memories`);
        record('记忆可检索', memories.status === 200 && memories.text.includes(memoryToken), `HTTP ${memories.status}`);
        let memorycoreOk = false;
        try { memorycoreOk = (await fetch(`http://127.0.0.1:${MEMORYCORE_PORT}/healthz`)).ok; } catch { memorycoreOk = false; }
        record('MemoryCore 重启后就绪', memorycoreOk, `127.0.0.1:${MEMORYCORE_PORT}/healthz`);
        const inbox = await adminAfter.call('GET', '/api/v1/inbox');
        const inboxCount = Number(psql(`SELECT count(*) FROM vc.inbox_event WHERE owner_user_id=${OWNER_ID} AND event_id='w16c-body';`));
        record('inbox 仍在且不重复', inbox.status === 200 && inbox.text.includes('w16c-body') && inboxCount === beforeInbox && beforeInbox === 1, `count=${inboxCount}`);

        await poll(async () => {
            const job = psql(`SELECT status || ' ' || coalesce(claim_token, '') || ' ' || CASE WHEN lease_expires_at > clock_timestamp() THEN 'future' ELSE 'expired' END
                FROM vc.work_item WHERE owner_user_id=${OWNER_ID} AND id=${decimal(leaseJob, 'lease job')};`);
            return job.length > 0 && job !== 'CLAIMED w16c-old-token expired';
        }, '跟进租约没有在重启后被回收', 30000).catch((error) => { artifacts.leaseError = error; });
        const leaseNow = psql(`SELECT status || ' ' || coalesce(claim_token, '') || ' ' || CASE WHEN lease_expires_at IS NULL THEN 'none' WHEN lease_expires_at > clock_timestamp() THEN 'future' ELSE 'expired' END
            FROM vc.work_item WHERE owner_user_id=${OWNER_ID} AND id=${decimal(leaseJob, 'lease job')};`);
        const leaseRecovered = !artifacts.leaseError && leaseNow.length > 0 && leaseNow !== 'CLAIMED w16c-old-token expired' && !leaseNow.startsWith('DEAD_LETTERED');
        record('过期跟进租约已回收并可再领取', leaseRecovered, leaseNow);

        await poll(async () => psql(`SELECT status FROM vc.model_cost_reservation WHERE provider_attempt_id='w16c-aged';`) === 'UNKNOWN', '超时 HELD 未清扫', 30000)
            .catch((error) => { artifacts.holdError = error; });
        const aged = psql(`SELECT status FROM vc.model_cost_reservation WHERE provider_attempt_id='w16c-aged';`);
        const young = psql(`SELECT status FROM vc.model_cost_reservation WHERE provider_attempt_id='w16c-young';`);
        record('超时 HELD 清扫为 UNKNOWN', !artifacts.holdError && aged === 'UNKNOWN', aged);
        record('未超时 HELD 仍为 HELD', young === 'HELD', young);

        await new Promise((resolve) => setTimeout(resolve, 8000));
        const acceptedNow = deliveryStatuses(OWNER_ID, 'w16c-body');
        const quietNow = deliveryStatuses(OWNER_ID, 'w16c-quiet');
        const quietMail = quietNow.filter((row) => row.channel === 'EMAIL' && row.status === 'accepted').length;
        const quietFeishu = quietNow.filter((row) => row.channel === 'FEISHU' && row.status === 'accepted').length;
        const acceptedStable = acceptedNow.length === 2 && acceptedNow.every((row) => row.status === 'accepted')
            && capture.smtpTexts.length - beforeSmtp === quietMail
            && capture.feishuTexts.length - beforeFeishu === quietFeishu;
        record('accepted 通知不倒退且不重发', acceptedStable, `smtp=${capture.smtpTexts.length - beforeSmtp} feishu=${capture.feishuTexts.length - beforeFeishu}`);
        const quietForward = quietNow.length === 2 && quietNow.every((row) => row.status === 'pending' || row.status === 'accepted');
        record('pending 通知不倒退', quietForward, quietNow.map((row) => `${row.channel}:${row.status}`).join(','));

        const storyAfter = psql(`SELECT r.world_version::text || ' ' || r.current_branch_id::text || ' ' || e.projection_state
            FROM vc.story_run r JOIN vc.story_event e ON e.owner_user_id = r.owner_user_id AND e.id = ${worldEventId}
            WHERE r.owner_user_id = ${OWNER_ID} AND r.id = ${runId};`);
        record('剧情世界版本与分支一致', storyAfter === beforeStory, storyAfter);
        const pending = await adminAfter.call('GET', `/api/v1/story/runs/${runId}/projections?state=PENDING`);
        const projection = createStoryProjection({
            readChat: async () => {
                const rows = await readAfter(storyFile);
                if (rows.status !== 200) die('补写前读取失败');
                return { metadata: rows.json[0]?.chat_metadata || {}, messages: rows.json.slice(1) };
            },
            saveChat: async (snapshot) => {
                const rows = await readAfter(storyFile);
                if (rows.status !== 200) die('补写保存前读取失败');
                const header = rows.json[0];
                const metadata = { ...(header.chat_metadata || {}) };
                for (const [key, value] of Object.entries(snapshot.metadata || {})) {
                    if (key === 'vc_f2' || key === 'vc_f2_parent') continue;
                    metadata[key] = value;
                }
                header.chat_metadata = metadata;
                const saved = await stAfter.call('POST', '/api/chats/save', {
                    avatar_url: card.avatar, file_name: storyFile, chat: [header, ...(snapshot.messages || [])], force: false,
                });
                if (saved.status !== 200) {
                    const error = new Error('save failed');
                    error.code = 'VC_SAVE_FAILED';
                    error.name = 'F2ConflictError';
                    throw error;
                }
            },
            confirm: async ({ runId: currentRun, worldEventId: currentEvent }) => {
                const confirmed = await adminAfter.call('POST', `/api/v1/story/runs/${currentRun}/projections/${currentEvent}/confirm`, {});
                return { confirmed: confirmed.status === 200 && confirmed.json?.confirmed === true };
            },
        });
        const listed = Array.isArray(pending.json?.projections) ? pending.json.projections : [];
        const first = listed.length === 1 ? await projection.project({
            runId, worldEventId: String(listed[0].worldEventId), text: listed[0].text, cancelled: false,
        }) : { confirmed: false, appended: false };
        const afterFirst = await readAfter(storyFile);
        const projected = Array.isArray(afterFirst.json) ? afterFirst.json.filter((row) => row?.extra?.world_event_id === worldEventId).length : 0;
        const secondProject = await projection.project({ runId, worldEventId, text: listed[0]?.text || '', cancelled: false });
        const afterSecond = await readAfter(storyFile);
        const projectedAgain = Array.isArray(afterSecond.json) ? afterSecond.json.filter((row) => row?.extra?.world_event_id === worldEventId).length : 0;
        const pendingAfter = await adminAfter.call('GET', `/api/v1/story/runs/${runId}/projections?state=PENDING`);
        const confirmedState = psql(`SELECT projection_state FROM vc.story_event WHERE owner_user_id=${OWNER_ID} AND id=${worldEventId};`);
        record('未确认投影补写一次', pending.status === 200 && listed.length === 1 && listed[0].worldEventId === worldEventId && first.appended === true && first.confirmed === true && projected === 1, `listed=${listed.length} projected=${projected}`);
        record('已确认投影不重复补写', secondProject.appended === false && secondProject.confirmed === true && projectedAgain === 1 && pendingAfter.json?.projections?.length === 0 && confirmedState === 'CONFIRMED', confirmedState);
        const storyStill = psql(`SELECT r.world_version::text || ' ' || r.current_branch_id::text FROM vc.story_run r WHERE r.owner_user_id=${OWNER_ID} AND r.id=${runId};`);
        record('补写不改变世界版本与分支', storyStill === `${worldVersion} ${branchId}`, storyStill);

        const intent = psql(`SELECT coalesce((SELECT status FROM vc.account_deletion_intent WHERE account_id=${SECOND_ID}), 'MISSING');`);
        const job = psql(`SELECT coalesce((SELECT status FROM vc.work_item WHERE owner_user_id=${SECOND_ID} AND id=${barrierJob}), 'MISSING');`);
        const account = psql(`SELECT coalesce((SELECT status FROM vc.identity_account WHERE id=${SECOND_ID}), 'MISSING');`);
        const write = await secondAfter.call('POST', `/api/v1/relationships/${barrierRel}/memories/candidates`, { scope: 'RELATIONSHIP', summary: 'w16c-should-fail' });
        const barrier = job !== 'PENDING' && job !== 'CLAIMED' && intent !== 'MISSING' && write.status !== 200;
        record('删除屏障仍生效', barrier, `intent=${intent} job=${job} account=${account} write=${write.status}`);
    } finally {
        try { stopStack(); } catch (error) { console.error(`[w16-restart] stop-managed：${error.message}`); }
        try { await stopGo(artifacts.secrets); } catch { /* 进程已退出 */ }
        try { await stopW10Capture(artifacts.capture); } catch { /* 捕获器已关闭 */ }
        removeOwnedContainers();
    }
    const failed = results.filter((item) => !item.ok);
    console.log(`[w16-restart] ${results.length - failed.length}/${results.length} 断言通过`);
    if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
    console.error(`[w16-restart] 演练中断：${error.message}`);
    process.exitCode = 1;
});
