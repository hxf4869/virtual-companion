#!/usr/bin/env node
// V2-W03 受管端到端验收编排入口（子代理 C 夹具 owner）。
// 许可：AGPL-3.0-only（见 integrations/sillytavern/README；ADR-0009 §3）。
//
// 用法：
//   node scripts/accept-managed.mjs --dry-run            只做自检：fixture provider 单起 +
//                                                         断言库自测，不碰 docker/Go/ST 完整栈
//   node scripts/accept-managed.mjs                       完整受管栈 + 默认场景（见 ACCEPT_SCENES）
//   node scripts/accept-managed.mjs --filter a,b          按场景 id 选择（依赖自动补齐）
//   node scripts/accept-managed.mjs --filter ui03-browser 真实浏览器场景（主会话串联时执行）
//
// 生命周期（任一步失败即硬失败退出并清理，真实退出码；所有子命令 pipefail 语义）：
//   1) 端口归属检查（ST 8752 / fixture 8753 / Go 8095：被任何 PID 监听即退出，不接管）；
//   2) docker PG：容器 vc-w03-managed-pg（label com.vc.w03=managed，镜像 pgvector/pgvector:0.8.5-pg18，
//      随机 127.0.0.1 端口，合成口令；DSN 只进子进程环境，不打印）；
//   3) 迁移：GOTOOLCHAIN=go1.26.10 GOPROXY=off 先 go build 一次 companiond，再由同一二进制 migrate
//      （VC_MIGRATE_DB_DSN=...，名字见 backend/internal/migrate.LoadEnv）+ companiond bootstrap
//      （owner binding secret 种子：V27 契约非 migration，走应用原生子命令）；
//   4) 受管 MinIO：容器 vc-w03-managed-minio（同 label com.vc.w03=managed，镜像
//      vc-g12-minio-tools:local = scripts/dev/Dockerfile.e2e-minio-tools 的 pinned 产物，
//      随机 127.0.0.1 端口 + 合成口令）；mc 经共享网络命名空间建合成桶后即弃；
//      Go 的 VC_EXPORT_S3_* 指向该 loopback 端点（wireDeps 会真实 BucketExists 校验）；
//   5) 合成 Go 服务：同工具链 go build 后运行 ./cmd/companiond（无参 = HTTP 运行时），
//      环境参照 backend/internal/httpapi/provider_integration_test.go newCatalogServer +
//      full 模式必填项（VC_DB_DSN/VC_OWNER_BINDING_SECRET/VC_CRYPTO_REST_KEY/VC_EXPORT_S3_* 受管 MinIO），
//      VC_HTTP_ADDR=127.0.0.1:8095、VC_HTTP_ORIGINS=http://127.0.0.1:8752、
//      VC_PROVIDER_ALLOW_LOOPBACK_HTTP=true、VC_ST_PLUGIN_SERVICE_TOKEN=合成随机(>=32B)；
//   6) 合成 Owner：使用既有 BCrypt 测试向量建账号，真实密码登录 → TOTP 设置/确认 →
//      重新认证；会话只由 Go HTTP 签发，秘密仅在本轮进程内存；
//   7) fixture provider：本目录 managed-protocol-provider.mjs 子进程（127.0.0.1:8753）；
//   8) B 的受管组装/启动入口链（不重造组装）：S1 bootstrap（仅当原生 dev/ 未装配）→
//      assemble-managed.mjs（幂等重建 dev-managed/st-run）→ start-managed.mjs
//      （VC_ST_GO_BASE_URL + VC_ST_PLUGIN_SERVICE_TOKEN 硬校验）；
//   9) 验收场景；产物写 dev-managed/artifacts/accept-<ts>/（结果 JSON + 截图；截图不含 Key）；
//  10) 清理：只按本轮容器名与 spawn 归属（st.pid 经 B 的 stop-managed.mjs 命令行核对停止；
//      go/fixture 只停本轮实际启动的 child 并清其 PID 文件，不认残留 PID 文件；
//      只 docker rm 本轮 PG_CONTAINER / MINIO_CONTAINER，且标签必须是 com.vc.w03=managed；
//      不按标签扫删其他链的容器；不 lsof 扫端口杀进程）。
//
// 环境变量面（全部可覆盖；密钥类缺省在进程内合成随机，绝不需要真实凭据）：
//   VC_W03_ST_PORT(8752) VC_W03_FIXTURE_PORT(8753) VC_W03_GO_PORT(8095)
//   VC_W03_PG_CONTAINER(vc-w03-managed-pg) VC_W03_PG_IMAGE(pgvector/pgvector:0.8.5-pg18)
//   VC_W03_MINIO_CONTAINER(vc-w03-managed-minio) VC_W03_MINIO_IMAGE(vc-g12-minio-tools:local)
//   VC_W03_S3_BUCKET(vc03m-accept)     受管 MinIO 合成桶名
//   VC_W03_OWNER_ACCOUNT_ID(424242)  合成 Owner 账号 id（十进制字符串语义）
//   VC_W03_DEV_DIR(dev-managed)      受管运行目录（与 B 的 assemble/start-managed 共用 VC_ST_DEV_DIR 语义）
//   VC_W03_FAIL_FAST(0)              场景失败即停
// 退出码：0 全部所选场景通过；2 用法错误；3 生命周期失败；4 场景失败（结果 JSON 仍写出）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import {
    synthApiKey, synthServiceToken, synthRestKey, synthSecret,
    assertExactAccountId, assertApiError, parseSSEText, collectChatStream, collectAnthropicStream,
    collectResponsesStream, responsesEventTypes, createGoAdminClient, serviceResolve, createStClient,
    resolveSceneFilter, waitFor,
} from './managed-lib.mjs';
import { createProtocolFixtureServer, DEFAULT_EXPECT_KEY } from './managed-protocol-provider.mjs';
import { ensureRerankContainer } from './lib/rerank-container.mjs';
import { startW10Capture, stopW10Capture } from './w10-accept.mjs';
import { LifecycleError } from './lib/accept-runtime.mjs';
import { companiondPlan } from './lib/companiond-plan.mjs';
import { ACCEPT_SCENES } from './managed-scenes.mjs';

const INTEG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(INTEG, '..', '..');
const BACKEND = path.join(REPO_ROOT, 'backend');
const SCRIPTS = path.join(INTEG, 'scripts');
const DEV_MANAGED = path.resolve(process.env.VC_W03_DEV_DIR || path.join(INTEG, 'dev-managed'));
const RUN_DIR = path.join(DEV_MANAGED, 'run');
const ARTIFACTS_ROOT = path.join(DEV_MANAGED, 'artifacts');

const ST_PORT = Number(process.env.VC_W03_ST_PORT || 8752);
const FIXTURE_PORT = Number(process.env.VC_W03_FIXTURE_PORT || 8753);
const GO_PORT = Number(process.env.VC_W03_GO_PORT || 8095);
// 场景在运行时读这些变量。写回解析后的端口，避免未导出时拼出 undefined，被 Go 当成非法 base URL 返回 400。
process.env.VC_W03_ST_PORT = String(ST_PORT);
process.env.VC_W03_FIXTURE_PORT = String(FIXTURE_PORT);
process.env.VC_W03_GO_PORT = String(GO_PORT);
const GO_BASE = `http://127.0.0.1:${GO_PORT}`;
const ST_BASE = `http://127.0.0.1:${ST_PORT}`;
const FIXTURE_BASE = `http://127.0.0.1:${FIXTURE_PORT}`;
const PG_CONTAINER = process.env.VC_W03_PG_CONTAINER || 'vc-w03-managed-pg';
const PG_IMAGE = process.env.VC_W03_PG_IMAGE || 'pgvector/pgvector:0.8.5-pg18';
const MINIO_CONTAINER = process.env.VC_W03_MINIO_CONTAINER || 'vc-w03-managed-minio';
// 本机已构建的 pinned MinIO/mc 合一镜像（scripts/dev/Dockerfile.e2e-minio-tools 产物；
// 上游 OCI 镜像不可得 VC-R19，禁止自动拉取）
const MINIO_IMAGE = process.env.VC_W03_MINIO_IMAGE || 'vc-g12-minio-tools:local';
const S3_BUCKET = process.env.VC_W03_S3_BUCKET || 'vc03m-accept';
const PG_LABEL = 'com.vc.w03=managed';
// Disposable PG resets job IDs; a fresh owner also isolates persistent engine operations.
if (!process.env.VC_W03_OWNER_ACCOUNT_ID) process.env.VC_W03_OWNER_ACCOUNT_ID = String(Date.now());
const OWNER_ACCOUNT_ID = process.env.VC_W03_OWNER_ACCOUNT_ID;
const SECOND_ACCOUNT_ID = String(BigInt(OWNER_ACCOUNT_ID) + 1n);
const RIGHTS_ACCOUNT_ID = String(9007199254740993n + BigInt(Date.now()));
const RIGHTS_HANDLE = `vc-w06-rights-${RIGHTS_ACCOUNT_ID}`;
const GO_TOOLCHAIN = 'go1.26.10';

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const HELP = argv.includes('--help') || argv.includes('-h');
const FILTER_IDX = argv.indexOf('--filter');
const FILTER = FILTER_IDX >= 0 ? argv[FILTER_IDX + 1] : undefined;

function usage() {
    console.log(`用法：node scripts/accept-managed.mjs [--dry-run] [--filter <scene,...>]

场景（--filter 逗号分隔，依赖自动补齐；默认全选 default:true）：
${ACCEPT_SCENES.map((s) => `  ${s.id.padEnd(22)} ${s.default ? '' : '(需显式选择)'}${s.title}`).join('\n')}`);
}

const log = {
    ok: (m) => console.log(`[accept] ✓ ${m}`),
    info: (m) => console.log(`[accept] · ${m}`),
    warn: (m) => console.log(`[accept] ! ${m}`),
    fail: (m) => console.error(`[accept] ✗ ${m}`),
};

function dieLifecycle(msg) { throw new LifecycleError(msg); }

/** 真实退出码的子命令执行（pipefail 语义：非零即抛）；stderr 原样透传。 */
function runChecked(cmd, args, { cwd, env, label, input } = {}) {
    // encoding:'buffer' 下 spawnSync 只接受 Buffer 型 input，字符串先转（psql SQL 走 stdin）
    const stdin = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
    const r = spawnSync(cmd, args, { cwd, env: env ? { ...process.env, ...env } : process.env, encoding: 'buffer', input: stdin });
    if (r.stderr?.length) process.stderr.write(r.stderr);
    if (r.error) dieLifecycle(`${label} 无法执行：${r.error.message}`);
    if (r.status !== 0) dieLifecycle(`${label} 失败（exit=${r.status}）`);
    return r.stdout?.toString('utf8') ?? '';
}

// ---------------------------------------------------------------------------
// 端口归属 / 容器 / 进程归属管理（清理只按标签与 PID 文件，不 lsof 扫杀）
// ---------------------------------------------------------------------------

function listeningPids(port) {
    const r = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp'], { encoding: 'utf8' });
    if (r.status !== 0 && !(r.stdout || '').trim()) return [];
    return [...(r.stdout || '').matchAll(/^p(\d+)$/gm)].map((m) => Number(m[1]));
}

function assertPortsFree() {
    for (const [name, port] of [['ST', ST_PORT], ['fixture', FIXTURE_PORT], ['Go', GO_PORT]]) {
        const pids = listeningPids(port);
        if (pids.length) dieLifecycle(`端口 ${port}（${name}）已被 PID ${pids.join(',')} 监听；受管验收不接管他人端口（8742/8743 旧实例请用 scripts/stop.mjs 处理）`);
    }
    log.ok(`端口归属检查通过：ST=${ST_PORT} fixture=${FIXTURE_PORT} Go=${GO_PORT} 均空闲`);
}

function docker(args, { label } = {}) {
    return runChecked('docker', args, { label: label || `docker ${args[0]}` });
}

/** 受管 PG：存在同名容器时按标签决定处置；启动随机 127.0.0.1 端口并等 pg_isready。 */
async function startManagedPg(secrets) {
    const exists = spawnSync('docker', ['inspect', '-f', '{{.Id}}', PG_CONTAINER], { encoding: 'utf8' });
    if (exists.status === 0) {
        const label = spawnSync('docker', ['inspect', '-f', '{{index .Config.Labels "com.vc.w03"}}', PG_CONTAINER], { encoding: 'utf8' });
        if ((label.stdout || '').trim() !== 'managed') {
            dieLifecycle(`容器 ${PG_CONTAINER} 已存在但缺少标签 ${PG_LABEL}（非本夹具所有），不接管`);
        }
        docker(['rm', '-f', PG_CONTAINER], { label: 'docker rm 旧受管 PG' });
        log.info('移除上一次残留的受管 PG 容器（label 归属确认）');
    }
    docker([
        'run', '-d', '--name', PG_CONTAINER, '--label', PG_LABEL,
        '-e', `POSTGRES_PASSWORD=${secrets.pgPassword}`,
        '-e', 'POSTGRES_DB=vc',
        '-p', '127.0.0.1::5432',
        PG_IMAGE,
    ], { label: 'docker run 受管 PG' });
    const portOut = docker(['port', PG_CONTAINER, '5432/tcp'], { label: 'docker port' });
    const m = /127\.0\.0\.1:(\d+)/.exec(portOut.trim());
    if (!m) dieLifecycle(`无法解析受管 PG 随机端口：${portOut.trim()}`);
    const pgPort = m[1];
    secrets.dsn = `postgres://postgres:${secrets.pgPassword}@127.0.0.1:${pgPort}/vc`;
    await waitFor(() => {
        // 显式 TCP：入口脚本 init 阶段的临时 server 只听 Unix socket（不带 -h 的 pg_isready
        // 会提前放行），-h 127.0.0.1 -p 5432 只可能命中最终 server，避免 migrate 撞无监听窗口
        const r = spawnSync('docker', ['exec', PG_CONTAINER, 'pg_isready', '-h', '127.0.0.1', '-p', '5432', '-U', 'postgres', '-d', 'vc'], { encoding: 'utf8' });
        return r.status === 0;
    }, { timeoutMs: 60000, label: `受管 PG 就绪（容器 ${PG_CONTAINER}，TCP pg_isready 命中最终 server，随机 127.0.0.1:${pgPort}）` });
    log.ok(`受管 PG 就绪：127.0.0.1:${pgPort}（DSN 仅进子进程环境，不打印）`);
    return pgPort;
}

/**
 * 受管 MinIO（同 label 归属；形态照抄 scripts/dev/e2e-stack.sh：随机 127.0.0.1 端口 +
 * 合成口令 + mc 经共享网络命名空间建桶，凭据只进容器 env 与 bind-mount 的 config.json，
 * 不进进程参数表；blobstore.New 的 BucketExists 校验由真实服务满足）。
 */
async function startManagedMinio(secrets) {
    const exists = spawnSync('docker', ['inspect', '-f', '{{.Id}}', MINIO_CONTAINER], { encoding: 'utf8' });
    if (exists.status === 0) {
        const label = spawnSync('docker', ['inspect', '-f', '{{index .Config.Labels "com.vc.w03"}}', MINIO_CONTAINER], { encoding: 'utf8' });
        if ((label.stdout || '').trim() !== 'managed') {
            dieLifecycle(`容器 ${MINIO_CONTAINER} 已存在但缺少标签 ${PG_LABEL}（非本夹具所有），不接管`);
        }
        docker(['rm', '-f', MINIO_CONTAINER], { label: 'docker rm 旧受管 MinIO' });
        log.info('移除上一次残留的受管 MinIO 容器（label 归属确认）');
    }
    const imageReady = spawnSync('docker', ['image', 'inspect', MINIO_IMAGE], { encoding: 'utf8' });
    if (imageReady.status !== 0) {
        dieLifecycle(`镜像 ${MINIO_IMAGE} 不在本机（不自动拉取；用 scripts/dev/Dockerfile.e2e-minio-tools 构建或设 VC_W03_MINIO_IMAGE）`);
    }
    const accessKey = `vc03m-${synthSecret(9)}`;
    const secretKey = synthSecret(18);
    docker([
        'run', '-d', '--name', MINIO_CONTAINER, '--label', PG_LABEL,
        '-e', `MINIO_ROOT_USER=${accessKey}`,
        '-e', `MINIO_ROOT_PASSWORD=${secretKey}`,
        '-p', '127.0.0.1::9000',
        MINIO_IMAGE, 'server', '/data',
    ], { label: 'docker run 受管 MinIO' });
    const portOut = docker(['port', MINIO_CONTAINER, '9000/tcp'], { label: 'docker port minio' });
    const m = /127\.0\.0\.1:(\d+)/.exec(portOut.trim());
    if (!m) dieLifecycle(`无法解析受管 MinIO 随机端口：${portOut.trim()}`);
    const minioPort = m[1];
    await waitFor(async () => {
        try {
            return (await fetch(`http://127.0.0.1:${minioPort}/minio/health/live`)).ok;
        } catch {
            return false;
        }
    }, { timeoutMs: 60000, label: `受管 MinIO 就绪（容器 ${MINIO_CONTAINER}，随机 127.0.0.1:${minioPort}）` });
    // mc 引导建桶：共享 MinIO 网络命名空间（容器内 127.0.0.1:9000），凭据走只读 bind 的
    // config.json（version 10 别名格式，同 e2e-stack），mc 辅助目录落在临时容器层。
    fs.mkdirSync(RUN_DIR, { recursive: true });
    const mcConfig = path.join(RUN_DIR, 'mc-config.json');
    fs.writeFileSync(mcConfig, JSON.stringify({
        version: '10',
        aliases: {
            w03: {
                url: 'http://127.0.0.1:9000',
                accessKey, secretKey,
                api: 'S3v4', path: 'auto',
            },
        },
    }), { mode: 0o600 });
    try {
        docker([
            'run', '--rm', '--entrypoint', '/bin/mc',
            '--network', `container:${MINIO_CONTAINER}`,
            '-e', 'MC_UPDATE=off', '-e', 'MINIO_UPDATE=off',
            '-v', `${mcConfig}:/mc-config/config.json:ro`,
            MINIO_IMAGE, '--config-dir', '/mc-config', 'mb', '--ignore-existing', `w03/${S3_BUCKET}`,
        ], { label: 'mc 建桶（合成凭据经只读 bind 传递）' });
    } finally {
        fs.rmSync(mcConfig, { force: true });
    }
    secrets.s3 = {
        endpoint: `http://127.0.0.1:${minioPort}`,
        accessKey, secretKey, bucket: S3_BUCKET,
    };
    log.ok(`受管 MinIO 就绪：127.0.0.1:${minioPort} 桶 ${S3_BUCKET} 已建（凭据只在容器 env 与已删的临时 config）`);
}

/** 在受管 PG 上执行 SQL（stdin 传参，避免出现在进程参数表）；-v ON_ERROR_STOP=1。 */
function psql(sql) {
    return runChecked('docker', ['exec', '-i', PG_CONTAINER, 'psql', '-U', 'postgres', '-d', 'vc', '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A'], {
        label: 'psql', input: sql,
    });
}

/** RFC6238 合成验收客户端；只使用本轮 Go API 发出的临时测试密钥。 */
function totpCode(secret, at = Date.now()) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = '';
    for (const c of secret.toUpperCase().replace(/=+$/, '')) bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
    const bytes = Buffer.from((bits.match(/.{8}/g) || []).map((b) => Number.parseInt(b, 2)));
    const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
    const digest = crypto.createHmac('sha1', bytes).update(counter).digest();
    const offset = digest.at(-1) & 15;
    return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}
async function authRequest(suffix, body, base = GO_BASE) {
    const response = await fetch(`${base}/api/v1/auth/${suffix}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ST_BASE }, body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new LifecycleError(`合成认证步骤 ${suffix.split('/').at(-1)} 未完成（HTTP ${response.status}）`);
    return { response, data };
}
function sessionFrom(response, data) {
    const cookies = new Map((response.headers.getSetCookie?.() || []).map((line) => {
        const pair = line.split(';')[0], split = pair.indexOf('=');
        return [pair.slice(0, split), pair.slice(split + 1)];
    }));
    if (!cookies.get('vc_session') || !cookies.get('vc_csrf') || data.nextStep !== 'ACTIVE') throw new LifecycleError('合成登录未返回完整会话');
    return { vcSession: cookies.get('vc_session'), vcCsrf: cookies.get('vc_csrf'), accountId: data.accountId, sessionId: data.sessionId };
}

/** 合成账号使用已有跨语言 BCrypt 测试向量；会话由真实密码+TOTP API 签发。 */
async function seedSyntheticOwner(secrets) {
    const vector = JSON.parse(fs.readFileSync(path.join(BACKEND, 'contracttest/testdata/crypto-vectors.json'), 'utf8')).bcrypt;
    psql(`
INSERT INTO vc.vc_user(id, display_name)
VALUES (${BigInt(OWNER_ACCOUNT_ID)}, 'w03-accept-owner'), (${BigInt(SECOND_ACCOUNT_ID)}, 'w05-accept-second')
ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name;
INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name)
VALUES (${BigInt(OWNER_ACCOUNT_ID)}, 'w03-accept-owner', '${vector.goHash}', 'ADMIN', 'ACTIVE', 'w03-accept-owner'),
       (${BigInt(SECOND_ACCOUNT_ID)}, 'w05-accept-second', '${vector.goHash}', 'ADMIN', 'ACTIVE', 'w05-accept-second')
ON CONFLICT (id) DO UPDATE SET role = 'ADMIN', status = 'ACTIVE';
`);
    secrets.password = vector.password;
    if (secrets.needsRights) {
        psql(`INSERT INTO vc.vc_user(id,display_name) VALUES (${BigInt(RIGHTS_ACCOUNT_ID)}, 'W06 synthetic rights');
          INSERT INTO vc.identity_account(id,username,password_hash,role,status,display_name) VALUES (${BigInt(RIGHTS_ACCOUNT_ID)},'w06-accept-rights','${vector.goHash}','ADMIN','ACTIVE','W06 synthetic rights');`);
        const { data: rightsChallenge } = await authRequest('login', { account:'w06-accept-rights', password:secrets.password });
        const { data: rightsSetup } = await authRequest(`challenges/${rightsChallenge.challengeId}/authenticator-setup`, {});
        const rightsAuth = await authRequest(`challenges/${rightsChallenge.challengeId}/authenticator-confirm`, { code:totpCode(rightsSetup.manualKey), trustDevice:false });
        secrets.rightsSession = sessionFrom(rightsAuth.response, rightsAuth.data);
    }
    const { data: challenge } = await authRequest('login', { account: 'w03-accept-owner', password: secrets.password });
    if (challenge.nextStep !== 'AUTHENTICATOR_SETUP_REQUIRED') dieLifecycle('合成 Owner 应进入首次 TOTP 设置');
    const { data: setup } = await authRequest(`challenges/${challenge.challengeId}/authenticator-setup`, {});
    const { response, data } = await authRequest(`challenges/${challenge.challengeId}/authenticator-confirm`, { code: totpCode(setup.manualKey), trustDevice: false });
    secrets.session = sessionFrom(response, data);
    secrets.recoveryCodes = data.recoveryCodes;
    const client = createGoAdminClient({ baseUrl: GO_BASE, origin: ST_BASE, session: secrets.session });
    if (!(await client.reauth(secrets.password)).ok) dieLifecycle('合成 Owner 重新认证未完成');
    log.ok('合成 Owner 真实密码、TOTP 设置与重新认证完成（不输出凭据、验证码或恢复码）');
}

// ---------------------------------------------------------------------------
// 合成 Go 服务（build 后运行；环境面见文件头注释）
// ---------------------------------------------------------------------------

let w10Capture = null;

function goServiceSpec(secrets) {
    return {
        binary: path.join(RUN_DIR, 'companiond-accept'),
        env: {
            VC_TTS_KOKORO_URL: secrets.needsVoice ? `${FIXTURE_BASE}/voice-fixture/kokoro/v1` : '',
            VC_TTS_COSYVOICE_URL: secrets.needsVoice ? `${FIXTURE_BASE}/voice-fixture/cosyvoice/v1` : '',
            VC_ASR_URL: '',
            VC_MODE: 'full',
            VC_VERSION: 'w03-accept',
            VC_LOG_LEVEL: 'info',
            VC_HTTP_ADDR: `127.0.0.1:${GO_PORT}`,
            VC_HTTP_ORIGINS: ST_BASE,
            VC_SESSION_COOKIE_SECURE: 'false',
            VC_BUDGET_MAX_RESERVED_COST: '1000000',
            VC_MONTHLY_COST_LIMIT: '10000000',
            VC_DB_DSN: secrets.dsn,
            VC_MIGRATE_DB_DSN: secrets.dsn,
            VC_OWNER_BINDING_SECRET: secrets.ownerBinding,
            VC_CRYPTO_REST_KEY: secrets.restKey,
            VC_EXPORT_S3_ENDPOINT: secrets.s3.endpoint,
            VC_EXPORT_S3_ACCESS_KEY: secrets.s3.accessKey,
            VC_EXPORT_S3_SECRET_KEY: secrets.s3.secretKey,
            VC_EXPORT_S3_BUCKET: secrets.s3.bucket,
            VC_PROVIDER_ALLOW_LOOPBACK_HTTP: 'true',
            VC_ST_PLUGIN_SERVICE_TOKEN: secrets.serviceToken,
            VC_ST_HOST_BASE_URL: ST_BASE,
            VC_MEMORYCORE_BASE_URL: `http://127.0.0.1:${process.env.VC_MEMORYCORE_PORT || 8754}`,
            VC_MEMORYCORE_SERVICE_TOKEN: secrets.memorycoreToken,
            VC_MEMORYCORE_CALLBACK_TOKEN: secrets.memorycoreCallbackToken,
            ...(w10Capture ? {
                VC_SMTP_HOST: '127.0.0.1',
                VC_SMTP_PORT: String(w10Capture.smtpPort),
                VC_SMTP_FROM: 'notify@example.test',
                VC_SMTP_CA_FILE: w10Capture.caFile,
            } : {}),
        },
    };
}

async function startGoService(secrets, artifactsDir) {
    fs.mkdirSync(RUN_DIR, { recursive: true });
    const spec = goServiceSpec(secrets);
    const logFd = fs.openSync(path.join(artifactsDir, 'go.log'), 'a');
    const child = spawn(spec.binary, [], { env: { ...process.env, ...spec.env }, stdio: ['ignore', logFd, logFd], detached: true });
    fs.closeSync(logFd);
    child.unref();
    secrets.goPid = child.pid;
    fs.writeFileSync(path.join(RUN_DIR, 'go.pid'), String(child.pid), { mode: 0o600 });
    await waitFor(async () => {
        try {
            const r = await fetch(`${GO_BASE}/actuator/health`);
            return r.ok;
        } catch {
            return false;
        }
    }, { timeoutMs: 60000, label: `Go 服务就绪（${GO_BASE}/actuator/health，日志 ${artifactsDir}/go.log）` });
    log.ok(`Go 服务就绪 ${GO_BASE}（pid=${child.pid}）`);
}

// ---------------------------------------------------------------------------
// fixture provider 子进程与 ST 受管栈（B 的组装/启动入口）
// ---------------------------------------------------------------------------

async function startFixtureProvider(secrets, artifactsDir) {
    fs.mkdirSync(RUN_DIR, { recursive: true });
    const logFd = fs.openSync(path.join(artifactsDir, 'fixture.log'), 'a');
    const child = spawn(process.execPath, [
        path.join(SCRIPTS, 'managed-protocol-provider.mjs'),
        '--port', String(FIXTURE_PORT),
        '--expect-key', secrets.fixtureKey,
    ], { env: { ...process.env, VC_W03_FIXTURE_PORT: String(FIXTURE_PORT), VC_W03_FIXTURE_KEY: secrets.fixtureKey }, stdio: ['ignore', logFd, logFd], detached: true });
    fs.closeSync(logFd);
    child.unref();
    secrets.fixturePid = child.pid;
    fs.writeFileSync(path.join(RUN_DIR, 'fixture.pid'), String(child.pid), { mode: 0o600 });
    await waitFor(async () => {
        try {
            return (await fetch(`${FIXTURE_BASE}/__health`)).ok;
        } catch {
            return false;
        }
    }, { timeoutMs: 20000, label: `fixture provider 就绪（${FIXTURE_BASE}，日志 ${artifactsDir}/fixture.log）` });
    log.ok(`fixture provider 就绪 ${FIXTURE_BASE}（pid=${child.pid}，expectKey 只在进程间传递）`);
}

const fixtureHttp = {
    async captures(opts = {}) {
        const q = new URLSearchParams();
        if (opts.since) q.set('since', String(opts.since));
        if (opts.protocol) q.set('protocol', opts.protocol);
        if (opts.endpointSuffix) q.set('endpoint', opts.endpointSuffix);
        const r = await fetch(`${FIXTURE_BASE}/__captures?${q}`);
        const j = await r.json();
        return j.captures;
    },
    async count(opts = {}) {
        return (await this.captures(opts)).length;
    },
    async clear() {
        await fetch(`${FIXTURE_BASE}/__captures/clear`, { method: 'POST' });
    },
    async setOverride(model, directive) {
        await fetch(`${FIXTURE_BASE}/__ctl`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ overrides: { [model]: directive } }),
        });
    },
};

/**
 * B 的受管组装/启动入口链（不重造组装）：
 *   bootstrap.mjs（S1 原生 dev/，仅当 dev/bootstrap-ok 缺失时；显式 VC_ST_DEV_DIR=dev 防串位）
 *   → assemble-managed.mjs（幂等重建 dev-managed/st-run 与部署）
 *   → start-managed.mjs（需 VC_ST_GO_BASE_URL + VC_ST_PLUGIN_SERVICE_TOKEN，硬校验）。
 * stop 由 stop-managed.mjs（st.pid 命令行核对）负责，见 cleanupManaged。
 */
/** 持久 dataRoot 里的 relationshipId / conversationId 属于上一轮数据库。新库会 404。只删带这些编号的 vc_binding。 */
function clearStaleVcBindings(dataRoot) {
    let files = 0;
    const walk = (dir) => {
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
            if (entry.name === 'backups' || entry.name === 'node_modules') continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) { walk(full); continue; }
            if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
            const rel = full.split(path.sep).join('/');
            if (!rel.includes('/chats/') && !rel.includes('/group chats/')) continue;
            let text;
            try { text = fs.readFileSync(full, 'utf8'); } catch { continue; }
            let changed = false;
            const next = text.split('\n').map((line) => {
                const raw = line.endsWith('\r') ? line.slice(0, -1) : line;
                if (!raw.trim()) return line;
                let row;
                try { row = JSON.parse(raw); } catch { return line; }
                const binding = row?.chat_metadata?.vc_binding;
                if (!binding || typeof binding !== 'object' || Array.isArray(binding)) return line;
                const present = (value) => value != null && String(value) !== '';
                if (!present(binding.relationshipId) && !present(binding.conversationId)) return line;
                const meta = { ...row.chat_metadata };
                delete meta.vc_binding;
                row.chat_metadata = meta;
                changed = true;
                return JSON.stringify(row);
            });
            if (!changed) continue;
            fs.writeFileSync(full, next.join('\n'), { mode: 0o600 });
            fs.chmodSync(full, 0o600);
            files += 1;
        }
    };
    if (fs.existsSync(dataRoot)) walk(dataRoot);
    return files;
}

async function startManagedStack(secrets, artifactsDir) {
    const nativeDevOk = path.join(INTEG, 'dev', 'bootstrap-ok');
    if (!fs.existsSync(nativeDevOk)) {
        log.info('原生 dev/ 尚未 bootstrap（assemble-managed 依赖其重建的 upstream node_modules），先跑 S1 bootstrap');
        runChecked(process.execPath, [path.join(SCRIPTS, 'bootstrap.mjs')], {
            cwd: INTEG,
            env: { VC_ST_DEV_DIR: path.join(INTEG, 'dev') },
            label: 'S1 bootstrap（原生 dev/）',
        });
    }
    runChecked(process.execPath, [path.join(SCRIPTS, 'assemble-managed.mjs')], {
        cwd: INTEG,
        env: { VC_ST_PORT: String(ST_PORT) },
        label: 'assemble-managed（受管 st-run 组装，幂等）',
    });
    // 仅给一次性合成验收创建第二个本地 profile。复用 ST 的存储实现，在进程启动前写入。
    const requireSt = createRequire(path.join(INTEG, 'upstream/SillyTavern/package.json'));
    const storage = requireSt('node-persist').create();
    await storage.init({ dir: path.join(DEV_MANAGED, 'data/_storage'), ttl: false, expiredInterval: 0 });
    // 第二账号先写入后，ST 只在用户表为空时创建 default-user。Owner 映射的就是 default-user，缺失时宿主拒绝进入聊天。
    if (!await storage.getItem('user:default-user')) {
        await storage.setItem('user:default-user', { handle: 'default-user', name: 'User', created: Date.now(), password: '', admin: true, enabled: true, salt: '' });
    }
    await storage.setItem('user:vc-w05-second', { handle: 'vc-w05-second', name: '合成第二账号', created: Date.now(), password: '', salt: '', enabled: true, admin: false });
    if (secrets.needsRights) {
        await storage.setItem(`user:${RIGHTS_HANDLE}`, { handle:RIGHTS_HANDLE, name:'W06 合成数据权利', created:Date.now(), password:'', salt:'', enabled:true, admin:false });
        const target = path.join(DEV_MANAGED,'data',RIGHTS_HANDLE,'settings.json');
        const settings = JSON.parse(fs.readFileSync(path.join(INTEG,'upstream/SillyTavern/default/content/settings.json'),'utf8'));
        settings.firstRun=false; settings.username='W06 合成账号';
        fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});fs.writeFileSync(target,JSON.stringify(settings),{mode:0o600});
    }
    // Persona onboarding is separate from B01 authentication. This disposable
    // profile starts with a named persona so parallel tabs do not each prompt.
    const secondSettingsPath = path.join(DEV_MANAGED, 'data/vc-w05-second/settings.json');
    const secondSettings = JSON.parse(fs.readFileSync(fs.existsSync(secondSettingsPath) ? secondSettingsPath : path.join(INTEG, 'upstream/SillyTavern/default/content/settings.json'), 'utf8'));
    secondSettings.firstRun = false; secondSettings.username = '合成第二账号';
    fs.mkdirSync(path.dirname(secondSettingsPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(secondSettingsPath, JSON.stringify(secondSettings), { mode: 0o600 });
    const defaultSettingsPath = path.join(DEV_MANAGED, 'data/default-user/settings.json');
    if (!fs.existsSync(defaultSettingsPath)) {
        const defaultSettings = JSON.parse(fs.readFileSync(path.join(INTEG, 'upstream/SillyTavern/default/content/settings.json'), 'utf8'));
        defaultSettings.firstRun = false; defaultSettings.username = '合成验收用户';
        fs.mkdirSync(path.dirname(defaultSettingsPath), { recursive: true, mode: 0o700 });
        fs.writeFileSync(defaultSettingsPath, JSON.stringify(defaultSettings), { mode: 0o600 });
    }
    const clearedBindings = clearStaleVcBindings(path.join(DEV_MANAGED, 'data'));
    log.info(`已清除持久 dataRoot 中旧库实例绑定 ${clearedBindings} 个聊天文件`);
    runChecked(process.execPath, [path.join(SCRIPTS, 'start-managed.mjs')], {
        cwd: INTEG,
        env: {
            VC_ST_PORT: String(ST_PORT),
            VC_ST_GO_BASE_URL: GO_BASE,
            VC_ST_PLUGIN_SERVICE_TOKEN: secrets.serviceToken,
            VC_MEMORYCORE_SERVICE_TOKEN: secrets.memorycoreToken,
            VC_MEMORYCORE_CALLBACK_BASE_URL: GO_BASE,
            VC_MEMORYCORE_CALLBACK_TOKEN: secrets.memorycoreCallbackToken,
            VC_ST_ACCOUNT_HANDLES: JSON.stringify({ [OWNER_ACCOUNT_ID]: 'default-user', [SECOND_ACCOUNT_ID]: 'vc-w05-second', ...(secrets.needsRights ? { [RIGHTS_ACCOUNT_ID]: RIGHTS_HANDLE } : {}) }),
            VC_ST_GO_TIMEOUT_MS: secrets.needsMemory ? '30000' : '2000',
        },
        label: 'start-managed（ST 8752 + 插件桥环境）',
    });
    await waitFor(async () => {
        try {
            const r = await fetch(`${ST_BASE}/auth/`);
            return r.ok && String(r.headers.get('content-type')).includes('text/html');
        } catch {
            return false;
        }
    }, { timeoutMs: 120000, label: `ST 登录入口就绪（${ST_BASE}/auth/；日志 ${RUN_DIR}/st.log）` });
    log.ok(`受管 ST 栈就绪 ${ST_BASE}（B 入口：assemble-managed → start-managed）`);
}

// ---------------------------------------------------------------------------
// 清理（只按容器标签与 PID 文件归属）
// ---------------------------------------------------------------------------

function killTree(pid) {
    if (!pid || !Number.isInteger(pid)) return;
    try { process.kill(pid, 'SIGTERM'); } catch { /* 已退出 */ }
}

async function cleanupManaged(secrets) {
    if (w10Capture) {
        const capture = w10Capture;
        w10Capture = null;
        try { await stopW10Capture(capture); } catch { /* 证书和监听已尽力关闭 */ }
    }
    const stopped = [];
    // ST 进程归属：B 的 stop-managed.mjs 按 st.pid + 命令行核对停止（防误杀原生实例）
    const stopManaged = path.join(SCRIPTS, 'stop-managed.mjs');
    if (fs.existsSync(stopManaged)) {
        try {
            runChecked(process.execPath, [stopManaged], { cwd: INTEG, env: { VC_ST_DEV_DIR: DEV_MANAGED, VC_ST_PORT: String(ST_PORT) }, label: 'stop-managed（st.pid 归属停止）' });
            stopped.push('st.pid（经 stop-managed）');
        } catch (e) {
            log.warn(`stop-managed 失败：${e.message}（继续清理其余归属）`);
        }
    }
    // 本脚本自有进程：只终止本轮实际启动的 child（secrets.goPid/fixturePid，spawn 返回值，
    // 不是 PID 文件），并清除本轮写入的 PID 文件；残留历史 PID 文件不代表所有权，
    // 不据此 kill（防误杀被系统复用的 PID；仍存活的历史进程由启动前端口归属检查拦截）
    if (secrets.fixturePid && Number.isInteger(secrets.fixturePid)) {
        killTree(secrets.fixturePid);
        stopped.push(`fixture.pid=${secrets.fixturePid}`);
        fs.rmSync(path.join(RUN_DIR, 'fixture.pid'), { force: true });
    }
    if (secrets.goPid && Number.isInteger(secrets.goPid)) {
        killTree(secrets.goPid);
        stopped.push(`go.pid=${secrets.goPid}`);
        fs.rmSync(path.join(RUN_DIR, 'go.pid'), { force: true });
    }
    if (stopped.length) log.info(`已停止：${stopped.join(', ')}（TERM）`);
    // 只移除本轮命名的 PG / MinIO。并行链共用 com.vc.w03=managed，不能按标签全删。
    for (const name of [PG_CONTAINER, MINIO_CONTAINER]) {
        const label = spawnSync('docker', ['inspect', '-f', '{{index .Config.Labels "com.vc.w03"}}', name], { encoding: 'utf8' });
        if (label.status !== 0) continue;
        if ((label.stdout || '').trim() !== 'managed') {
            log.warn(`容器 ${name} 存在但不是 ${PG_LABEL}，不移除`);
            continue;
        }
        try {
            runChecked('docker', ['rm', '-f', name], { label: `docker rm ${name}` });
            log.info(`已移除受管容器 ${name}（label ${PG_LABEL}）`);
        } catch (e) {
            log.warn(`容器 ${name} 移除失败：${e.message}`);
        }
    }
    // 等子进程真正退出，避免端口残留影响下一轮
    await new Promise((r) => setTimeout(r, 700));
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// dry-run：fixture provider 单起 + 断言库自测（不碰 docker/Go/ST）
// ---------------------------------------------------------------------------

async function runDryRun() {
    log.info('dry-run：只做夹具自检（fixture provider 单起 + 断言库自测），不启动完整受管栈');
    const fixture = await createProtocolFixtureServer({ port: 0, expectKey: DEFAULT_EXPECT_KEY });
    try {
        const health = await (await fetch(`${fixture.url}/__health`)).json();
        if (!health.ok) throw new Error('fixture /__health 异常');
        const r = await fetch(`${fixture.url}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${DEFAULT_EXPECT_KEY}` },
            body: JSON.stringify({ model: 'vc03m-chat', messages: [{ role: 'user', content: 'dry-run' }], stream: false }),
        });
        const j = await r.json();
        if (r.status !== 200 || j.choices[0].message.role !== 'assistant') throw new Error('fixture chat 响应异常');
        const count = await fixture.api.count();
        if (count < 1) throw new Error('fixture 捕获计数异常');
        // 断言库自测
        assertExactAccountId('9007199254740993', '9007199254740993');
        let neighborRejected = false;
        try {
            assertExactAccountId('9007199254740992', '9007199254740993');
        } catch {
            neighborRejected = true;
        }
        if (!neighborRejected) throw new Error('精确 ID 断言未拒绝 float 邻值');
        assertApiError(409, { code: 'REVISION_CONFLICT', message: 'x' }, 'REVISION_CONFLICT');
        const events = parseSSEText('event: response.completed\ndata: {"type":"response.completed"}\n\n');
        if (responsesEventTypes(events)[0] !== 'response.completed') throw new Error('SSE 解析自测失败');
        if (resolveSceneFilter('e2e-chat').length !== 2) throw new Error('场景过滤依赖闭包自测失败');
        log.ok(`dry-run 自检通过：fixture（随机端口 ${fixture.port}）+ 精确 ID + SSE + 场景闭包`);
    } finally {
        await fixture.api.close();
    }
}
async function runFull() {
    const selected = resolveSceneFilter(FILTER, ACCEPT_SCENES);
    if (FILTER && selected.length === 0) {
        log.fail(`--filter 解析为空场景集：${FILTER}`);
        process.exit(2);
    }
    const sceneById = (id) => ACCEPT_SCENES.find((s) => s.id === id);
    const needsStack = selected.some((id) => sceneById(id)?.needs.includes('stack'));
    const needsGo = selected.some((id) => {
        const needs = sceneById(id)?.needs ?? [];
        return needs.includes('go') || needs.includes('catalog');
    });
    const needsFixture = selected.some((id) => {
        const needs = sceneById(id)?.needs ?? [];
        return needs.includes('fixture') || needs.includes('catalog') || needs.includes('stack');
    });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const artifactsDir = path.join(ARTIFACTS_ROOT, `accept-${ts}`);
    fs.mkdirSync(artifactsDir, { recursive: true, mode: 0o700 });

    const secrets = {
        needsVoice: selected.some((id) => id.startsWith('voice-')),
        needsRights: selected.some((id) => id.startsWith('rights-')),
        needsMemory: selected.some(id => id.startsWith('memory-')),
        pgPassword: synthSecret(18),
        ownerBinding: synthServiceToken(),
        restKey: synthRestKey(),
        serviceToken: synthServiceToken(),
        memorycoreToken: synthServiceToken(),
        memorycoreCallbackToken: synthServiceToken(),
        fixtureKey: synthApiKey(),
    };
    const results = { startedAt: new Date().toISOString(), selected, scenes: {}, artifactsDir };
    const ctx = {
        secrets, artifactsDir, results,
        scope: `w03-accept-${ts}`,
        snapshots: {},
        screenshots: [],
        fixtureHttp,
        admin: null, st: null,
        w08: {
            seedRealEstimate: () => psql("INSERT INTO vc.model_unit_price(provider_id,model_id,price_version,input_usd_per_1k,output_usd_per_1k) VALUES ('vc08-real','cline-pass/deepseek-v4.1-flash-1017',1,0.01,0.02) ON CONFLICT DO NOTHING;"),
            realProgress: () => JSON.parse(psql(`SELECT json_build_object('done',count(*) FILTER(WHERE status='DONE'),'failed',count(*) FILTER(WHERE status IN('FAILED','DEAD_LETTERED','CANCELLED') OR attempt_count>0)) FROM vc.work_item WHERE owner_user_id=${BigInt(OWNER_ACCOUNT_ID)} AND kind='ST_MEMORY_EXTRACT';`).trim()),
            realUsage: () => JSON.parse(psql("SELECT coalesce(json_agg(x),'[]'::json) FROM (SELECT memorycore_stage AS stage,count(*) AS calls,coalesce(sum(input_tokens),0) AS input_tokens,coalesce(sum(output_tokens),0) AS output_tokens,count(*) FILTER(WHERE billing_disposition='UNKNOWN' OR billing_disposition IS NULL) AS unknown_usage FROM vc.memory_extract_attempt WHERE provider_id='vc08-real' GROUP BY memorycore_stage ORDER BY memorycore_stage)x;").trim()),
            realAttempts: () => JSON.parse(psql("SELECT coalesce(json_agg(x ORDER BY x.id),'[]'::json) FROM (SELECT id, coalesce(memorycore_stage,'') AS stage, status, coalesce(billing_disposition,'') AS billing, coalesce(failure_code,'') AS failure, input_tokens, output_tokens FROM vc.memory_extract_attempt WHERE provider_id='vc08-real') x;").trim() || '[]'),
            extractJobs: () => JSON.parse(psql(`SELECT coalesce(json_agg(x ORDER BY x.id),'[]'::json) FROM (SELECT id, status, attempt_count FROM vc.work_item WHERE owner_user_id=${BigInt(OWNER_ACCOUNT_ID)} AND kind='ST_MEMORY_EXTRACT') x;`).trim() || '[]'),
            probeSummary: (token) => {
                if (typeof token !== 'string' || [...token].length < 1 || [...token].length > 16 || /['\\]/.test(token)) return 'skip';
                return psql(`SELECT CASE WHEN EXISTS (SELECT 1 FROM vc.conversation_summary s WHERE s.owner_user_id=${BigInt(OWNER_ACCOUNT_ID)} AND s.valid AND strpos(s.summary, '${token}') > 0) THEN 'yes' ELSE 'no' END;`).trim();
            },
            seedSyntheticPrice: () => psql("INSERT INTO vc.model_unit_price(provider_id,model_id,price_version,input_usd_per_1k,output_usd_per_1k) VALUES ('vc08-memory','vc08-memory',1,0.001,0.002) ON CONFLICT DO NOTHING;"),
        },
        w06: { accountId:RIGHTS_ACCOUNT_ID, handle:RIGHTS_HANDLE,
            wakeExport: (id) => psql(`UPDATE vc.work_item SET next_attempt_at=now() WHERE kind='DATA_EXPORT' AND ref_id=${BigInt(id)} AND status='PENDING';`),
        },
        w10: { psql, capture: w10Capture },
        w05: { dataRoot: path.join(DEV_MANAGED, 'data'), stBase: ST_BASE, goBase: GO_BASE, ownerId: OWNER_ACCOUNT_ID, secondId: SECOND_ACCOUNT_ID, totpCode,
            expireSession: (id) => psql(`UPDATE vc.identity_opaque_session SET expires_at=now()-interval '1 second' WHERE id=${BigInt(id)};`),
        },
    };

    let failed = 0;
    try {
        if (needsGo) {
            assertPortsFree();
            await startManagedPg(secrets);
            fs.mkdirSync(RUN_DIR, { recursive: true });
            const plan = companiondPlan(path.join(RUN_DIR, 'companiond-accept'));
            const buildArgs = plan.build.slice(1).map((arg) => (arg === 'backend' ? BACKEND : arg));
            runChecked(plan.build[0], buildArgs, {
                cwd: REPO_ROOT,
                env: { GOTOOLCHAIN: GO_TOOLCHAIN, GOPROXY: 'off' },
                label: 'go build companiond',
            });
            runChecked(plan.migrate[0], plan.migrate.slice(1), {
                cwd: REPO_ROOT,
                env: { GOTOOLCHAIN: GO_TOOLCHAIN, GOPROXY: 'off', VC_MIGRATE_DB_DSN: secrets.dsn },
                label: 'companiond migrate（VC_MIGRATE_DB_DSN，DSN 不打印）',
            });
            log.ok('迁移完成（backend/internal/migrate 全量 SQL）');
            // owner binding secret 种子（V27 契约：不属于 migration，由 companiond bootstrap
            // 以应用原生路径 ON CONFLICT 语义写入并校验；缺它则 set_owner_context 全部拒绝，
            // handleSession→AuthenticatorEnabled 会以 ErrOwnerContextRejected→401）
            runChecked(plan.bootstrap[0], plan.bootstrap.slice(1), {
                cwd: REPO_ROOT,
                env: {
                    GOTOOLCHAIN: GO_TOOLCHAIN, GOPROXY: 'off',
                    VC_BOOTSTRAP_DB_DSN: secrets.dsn, VC_OWNER_BINDING_SECRET: secrets.ownerBinding,
                },
                label: 'companiond bootstrap（VC_BOOTSTRAP_DB_DSN + 本轮合成 ownerBinding，均不打印）',
            });
            log.ok('owner binding secret 已按应用原生路径种子（与 Go 服务 env 同值）');
            await startManagedMinio(secrets);
            if (selected.includes('w10-inbox-notify')) {
                w10Capture = await startW10Capture();
                ctx.w10.capture = w10Capture;
            }
            await startGoService(secrets, artifactsDir);
            await seedSyntheticOwner(secrets);
            ctx.admin = createGoAdminClient({ baseUrl: GO_BASE, origin: ST_BASE, session: secrets.session });
            // 合成 Owner 默认已同意五项，浏览器场景不被首次同意页挡住；consent-ui 自己先撤回再测。
            for (const consentType of ['SERVICE_TERMS', 'PRIVACY_POLICY', 'AI_CONTENT_NOTICE', 'THIRD_PARTY_MODEL_PROCESSING', 'SENSITIVE_DATA_PROCESSING']) {
                const granted = await ctx.admin.call('PUT', '/api/v1/consents', { consentType, version: 'accept-managed', granted: true });
                if (granted.status !== 200) throw new Error(`预置同意 ${consentType} HTTP ${granted.status}`);
            }
        }
        if (needsFixture) {
            await startFixtureProvider(secrets, artifactsDir);
        }
        if (needsStack) {
            await startManagedStack(secrets, artifactsDir);
            // 桥的 pickSessionCookies 从 generate 请求 Cookie 里取 Go 会话做核验（生产链路
            // 浏览器同源持有 vc_session/vc_csrf 一并带上），此处按同形状注入
            ctx.st = createStClient({
                baseUrl: ST_BASE,
                extraCookies: `vc_session=${secrets.session.vcSession}; vc_csrf=${secrets.session.vcCsrf}`,
                expectedIdentity: secrets.session,
            });
        }

        const needsRerank = selected.some((id) => ['memorycore-native', 'memory-browser', 'memory-extract-prod', 'memory-real-eval', 'memory-real-model', 'consent-ui'].includes(id));
        if (needsRerank) {
            const runtime = await ensureRerankContainer();
            log.ok(`重排服务 ${runtime.reused ? '复用' : '已启动'} 127.0.0.1:${runtime.port} 容器 ${runtime.container}`);
        }

        for (const id of selected) {
            const scene = ACCEPT_SCENES.find((s) => s.id === id);
            log.info(`场景 ${id}：${scene.title}`);
            const startedAt = Date.now();
            try {
                await scene.run(ctx);
                results.scenes[id] = { status: 'PASS', ms: Date.now() - startedAt };
                log.ok(`场景 ${id} PASS（${Date.now() - startedAt}ms）`);
            } catch (e) {
                failed += 1;
                results.scenes[id] = { status: 'FAIL', ms: Date.now() - startedAt, error: e.message };
                log.fail(`场景 ${id} FAIL：${e.message}`);
                if (process.env.VC_W03_FAIL_FAST === '1') break;
            }
        }
    } finally {
        results.finishedAt = new Date().toISOString();
        results.screenshots = ctx.screenshots;
        const resultsPath = path.join(artifactsDir, 'results.json');
        fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2) + '\n', { mode: 0o600 });
        log.info(`结果 JSON 已写入 ${path.relative(REPO_ROOT, resultsPath)}`);
        if (needsGo || needsStack || needsFixture) await cleanupManaged(secrets);
    }
    if (failed > 0) {
        log.fail(`${failed} 个场景失败（退出码 4）`);
        process.exit(4);
    }
    log.ok(`全部 ${selected.length} 个所选场景通过`);
}

async function main() {
    if (HELP) {
        usage();
        return;
    }
    if (!DRY_RUN && !FILTER && argv.some((a) => !['--dry-run', '--help', '-h'].includes(a))) {
        usage();
        process.exit(2);
    }
    if (FILTER !== undefined) {
        try {
            resolveSceneFilter(FILTER, ACCEPT_SCENES);
        } catch (e) {
            log.fail(String(e.message));
            usage();
            process.exit(2);
        }
    }
    try {
        if (DRY_RUN) {
            await runDryRun();
            return;
        }
        await runFull();
    } catch (e) {
        if (e instanceof LifecycleError) {
            log.fail(`生命周期失败：${e.message}`);
            process.exit(3);
        }
        log.fail(`未预期失败：${e.stack || e.message}`);
        process.exit(3);
    }
}

main().catch((e) => {
    log.fail(`未预期失败：${e.stack || e.message}`);
    process.exit(3);
});
