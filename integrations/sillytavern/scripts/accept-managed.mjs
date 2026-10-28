#!/usr/bin/env node
// V2-W03 受管端到端验收编排入口（子代理 C 夹具 owner）。
// 许可：AGPL-3.0-only（见 integrations/sillytavern/README；ADR-0009 §3）。
//
// 用法：
//   node scripts/accept-managed.mjs --dry-run            只做自检：fixture provider 单起 +
//                                                         断言库自测，不碰 docker/Go/ST 完整栈
//   node scripts/accept-managed.mjs                       完整受管栈 + 默认场景（见 SCENES）
//   node scripts/accept-managed.mjs --filter a,b          按场景 id 选择（依赖自动补齐）
//   node scripts/accept-managed.mjs --filter ui03-browser 真实浏览器场景（主会话串联时执行）
//
// 生命周期（任一步失败即硬失败退出并清理，真实退出码；所有子命令 pipefail 语义）：
//   1) 端口归属检查（ST 8752 / fixture 8753 / Go 8095：被任何 PID 监听即退出，不接管）；
//   2) docker PG：容器 vc-w03-managed-pg（label com.vc.w03=managed，镜像 pgvector/pgvector:0.8.5-pg18，
//      随机 127.0.0.1 端口，合成口令；DSN 只进子进程环境，不打印）；
//   3) 迁移：GOTOOLCHAIN=go1.26.10 GOPROXY=off go run -C backend -mod=vendor ./cmd/companiond migrate
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
    SCENES, resolveSceneFilter, waitFor,
} from './managed-lib.mjs';
import { createProtocolFixtureServer, DEFAULT_EXPECT_KEY } from './managed-protocol-provider.mjs';
import { sceneAuthBrowser, sceneF2Native, sceneF2Browser } from './w05-accept.mjs';
import { sceneSourceNative, sceneRightsBrowser, sceneRightsNative } from './w06-accept.mjs';
import { sceneMemoryRealModel } from './w08-real-accept.mjs';
import { sceneMemoryRealEval } from './w08-real-eval.mjs';
import { sceneMemoryBrowser } from './w07-accept.mjs';
import { sceneMemorycoreNative } from './w08-native-accept.mjs';
import { sceneMemorycoreFoundation } from './w08-foundation-accept.mjs';
import { sceneInboxNotify, startW10Capture, stopW10Capture } from './w10-accept.mjs';

// W12 玩家剧情页不进默认集。注册表在 managed-lib，本链只在入口追加，避免改共享场景表。
SCENES.push({
    id: 'story-view-browser',
    title: 'W12 玩家剧情页：开局、玩家视图、桌面与 390px',
    needs: ['go', 'stack', 'browser'],
    default: false,
});
SCENES.push({
    id: 'w10-inbox-notify',
    title: 'W10 Inbox 与本地邮箱飞书通知',
    needs: ['go', 'stack'],
    default: false,
});
// W13 三协议出站不进默认集。显式 --filter story-outbound 才运行，并因 needs 自动先跑 catalog-admin。
SCENES.push({
    id: 'story-outbound',
    title: 'W13 三协议剧情出站：规范视图、工具后续与续接不跨角色',
    needs: ['catalog', 'stack', 'browser'],
    default: false,
});

// ---------------------------------------------------------------------------
// 常量与 CLI
// ---------------------------------------------------------------------------

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
const OWNER_ACCOUNT_ID = process.env.VC_W03_OWNER_ACCOUNT_ID || String(Date.now());
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
${SCENES.map((s) => `  ${s.id.padEnd(22)} ${s.default ? '' : '(需显式选择)'}${s.title}`).join('\n')}`);
}

const log = {
    ok: (m) => console.log(`[accept] ✓ ${m}`),
    info: (m) => console.log(`[accept] · ${m}`),
    warn: (m) => console.log(`[accept] ! ${m}`),
    fail: (m) => console.error(`[accept] ✗ ${m}`),
};

class LifecycleError extends Error {}
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
            VC_MEMORYCORE_BASE_URL: 'http://127.0.0.1:8754',
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
    runChecked('go', ['build', '-C', BACKEND, '-mod=vendor', '-o', spec.binary, './cmd/companiond'], {
        cwd: REPO_ROOT,
        env: { GOTOOLCHAIN: GO_TOOLCHAIN, GOPROXY: 'off' },
        label: 'go build companiond',
    });
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
// 验收场景实现
// ---------------------------------------------------------------------------

/** 受管目录登记（三协议各一个 provider + 独立小窗 provider + 三态草稿 provider）。 */
function providerCatalogSpec(fixtureKey) {
    const model = (profileKey, modelId, displayName, extra = {}) => ({
        profileKey, modelId, displayName,
        contextWindowTokens: 8192, maxOutputTokens: 2048,
        state: 'ENABLED',
        capabilities: { toolCalls: 'DECLARED', systemMessage: 'DECLARED' },
        reasoningLevels: [],
        generationParams: { temperature: 0.3 },
        ...extra,
    });
    return [
        {
            providerId: 'vc03m-chat', displayName: '受管 Chat', protocol: 'OPENAI_CHAT_COMPLETIONS',
            baseUrl: `${FIXTURE_BASE}/v1`, credential: fixtureKey, state: 'ENABLED',
            models: [
                model('chat', 'vc03m-chat', 'Chat 主档'),
                model('chat-tools', 'vc03m-tools', 'Chat 工具档', { generationParams: { temperature: 0.3, topP: 0.9 } }),
                model('chat-slow', 'vc03m-chat-slow', 'Chat 慢速档'),
            ],
        },
        {
            providerId: 'vc03m-resp', displayName: '受管 Responses', protocol: 'OPENAI_RESPONSES',
            baseUrl: `${FIXTURE_BASE}/v1`, credential: fixtureKey, state: 'ENABLED',
            models: [
                model('reasoning', 'vc03m-reasoning', 'Responses 推理+工具档', { reasoningLevels: ['low'], generationParams: { temperature: 0.3, reasoningEffort: 'low' } }),
                model('usage', 'vc03m-usage', 'Responses 用量档'),
            ],
        },
        {
            providerId: 'vc03m-claude', displayName: '受管 Claude', protocol: 'ANTHROPIC_MESSAGES',
            baseUrl: `${FIXTURE_BASE}/v1`, credential: fixtureKey, state: 'ENABLED',
            models: [
                model('chat', 'vc03m-chat', 'Claude 主档'),
                model('tools', 'vc03m-tools', 'Claude 工具档'),
            ],
        },
        {
            providerId: 'vc03m-tiny', displayName: '受管小窗', protocol: 'OPENAI_CHAT_COMPLETIONS',
            baseUrl: `${FIXTURE_BASE}/v1`, credential: fixtureKey, state: 'ENABLED',
            models: [model('tiny', 'vc03m-chat', '小窗档', { contextWindowTokens: 256, maxOutputTokens: 64 })],
        },
    ];
}

/** 把 FOREGROUND_CHAT 绑定到指定 profile，返回含最新 revision 的标记快照。
 *  requireReady=false 允许清 Key 后的 UNAVAILABLE 绑定（快照带 status 供场景断言）。 */
async function bindForeground(ctx, providerId, profileKey, modelId, { requireReady = true } = {}) {
    const purposes = await ctx.admin.listPurposes();
    if (purposes.status !== 200) throw new Error(`model-purposes 列表 HTTP ${purposes.status}`);
    const row = purposes.json.find((r) => r.purpose === 'FOREGROUND_CHAT');
    if (!row) throw new Error('FOREGROUND_CHAT 缺失于用途列表');
    const saved = await ctx.admin.savePurpose('FOREGROUND_CHAT', {
        providerId, profileKey, state: 'ENABLED', expectedRevision: row.revision,
    });
    if (saved.status !== 200 || (requireReady && saved.json.status !== 'READY')) {
        throw new Error(`绑定失败：HTTP ${saved.status} ${JSON.stringify(saved.json).slice(0, 200)}`);
    }
    const providers = await ctx.admin.listProviders();
    const provider = providers.json.find((p) => p.providerId === providerId);
    if (!provider) throw new Error(`provider ${providerId} 未在列表中`);
    const bindingRevision = saved.json.revision;
    const marker = `vc-go://model-purposes/FOREGROUND_CHAT?provider=${encodeURIComponent(providerId)}&profile=${encodeURIComponent(profileKey)}&pr=${provider.revision}&br=${bindingRevision}&scope=${encodeURIComponent(ctx.scope)}`;
    return { providerId, profileKey, providerRevision: provider.revision, bindingRevision, modelId, marker, status: saved.json.status };
}

/** 断言某 provider 的用途绑定当前不可用（清 Key 后）。 */
async function readFixtureCapture(ctx, { protocol, since, index = -1 }) {
    const rows = await ctx.fixtureHttp.captures({ protocol, since });
    if (!rows.length) throw new Error(`fixture 未捕获 ${protocol} 请求`);
    return rows.at(index);
}

async function sceneLoginShape(ctx) {
    // 真实登录端点请求形状：合成账号 + 合成口令（占位 hash 无法通过），断言错误信封；
    // 非法形状断言 400。会话由 seedSyntheticOwner 的真实密码/TOTP 流程签发。
    const r1 = await fetch(`${GO_BASE}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: ST_BASE },
        body: JSON.stringify({ account: 'w03-accept-owner', password: 'w03-synthetic-not-the-login-hash' }),
    });
    const body1 = await r1.json();
    if (r1.status !== 404 || body1.code !== 'NOT_FOUND_OR_FORBIDDEN') {
        throw new Error(`合成账号登录应返回 404 NOT_FOUND_OR_FORBIDDEN，实际 ${r1.status} ${JSON.stringify(body1).slice(0, 160)}`);
    }
    const r2 = await fetch(`${GO_BASE}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: ST_BASE },
        body: JSON.stringify({ account: '', password: '' }),
    });
    const body2 = await r2.json();
    if (r2.status !== 400 || body2.code !== 'INVALID_REQUEST') {
        throw new Error(`非法登录形状应返回 400 INVALID_REQUEST，实际 ${r2.status} ${JSON.stringify(body2).slice(0, 160)}`);
    }
    const session = await ctx.admin.sessionIdentity();
    if (session.status !== 200 || !decimalStringsEqualOk(session.json.accountId, OWNER_ACCOUNT_ID)) {
        throw new Error(`会话核验失败：HTTP ${session.status} ${JSON.stringify(session.json).slice(0, 160)}`);
    }
    assertExactAccountId(session.json.accountId, OWNER_ACCOUNT_ID, 'Go 会话 accountId');
    log.ok(`登录端点形状与会话核验通过（accountId=${session.json.accountId} 精确十进制字符串）`);
}

function decimalStringsEqualOk(actual, expected) {
    return typeof actual === 'string' && actual.trim() === expected.trim() && /^\d+$/.test(actual.trim());
}

async function sceneCatalogAdmin(ctx) {
    const admin = ctx.admin;
    const specs = providerCatalogSpec(ctx.secrets.fixtureKey);

    // —— 保存（含凭据）→ revision 1 ——
    for (const spec of specs) {
        const saved = await admin.saveProvider(spec.providerId, {
            displayName: spec.displayName, protocol: spec.protocol, baseUrl: spec.baseUrl,
            credential: spec.credential, state: spec.state,
            models: spec.models,
        });
        if (saved.status !== 200 || saved.json.revision !== 1) {
            throw new Error(`保存 ${spec.providerId} 失败：HTTP ${saved.status} ${JSON.stringify(saved.json).slice(0, 200)}`);
        }
    }
    log.ok(`四个受管 provider 保存成功（revision=1，凭据=合成 fixture key）`);

    // —— 读回：无明文凭据、credentialConfigured、endpointUrl 规范 ——
    const listed = await admin.listProviders();
    if (listed.status !== 200) throw new Error(`providers 列表 HTTP ${listed.status}`);
    const text = JSON.stringify(listed.json);
    if (text.includes(ctx.secrets.fixtureKey) || text.includes('"credential"')) {
        throw new Error('providers 列表泄露凭据（含明文 key 或 credential 字段）');
    }
    const endpointBy = {
        'vc03m-chat': `${FIXTURE_BASE}/v1/chat/completions`,
        'vc03m-resp': `${FIXTURE_BASE}/v1/responses`,
        'vc03m-claude': `${FIXTURE_BASE}/v1/messages`,
        'vc03m-tiny': `${FIXTURE_BASE}/v1/chat/completions`,
    };
    for (const [pid, endpointUrl] of Object.entries(endpointBy)) {
        const row = listed.json.find((p) => p.providerId === pid);
        if (!row || row.credentialConfigured !== true || row.endpointUrl !== endpointUrl) {
            throw new Error(`${pid} 读回异常：credentialConfigured=${row?.credentialConfigured} endpointUrl=${row?.endpointUrl}（期望 ${endpointUrl}）`);
        }
    }
    log.ok('读回断言通过：credentialConfigured=true、endpointUrl 按协议规范化、无明文凭据');

    // —— 绑定 FOREGROUND_CHAT → READY ——
    const snapChat = await bindForeground(ctx, 'vc03m-chat', 'chat', 'vc03m-chat');
    if (snapChat.bindingRevision !== 2) throw new Error(`首次绑定后 bindingRevision 应为 2，实际 ${snapChat.bindingRevision}`);
    ctx.snapshots.chat = snapChat;

    // —— 409 保留草稿：用过期 expectedRevision 再保存，文档必须原样保留 ——
    const stale = await admin.saveProvider('vc03m-chat', {
        displayName: '受管 Chat（过期写入）', protocol: 'OPENAI_CHAT_COMPLETIONS', baseUrl: `${FIXTURE_BASE}/v1`,
        credential: ctx.secrets.fixtureKey, state: 'ENABLED', expectedRevision: 999,
        models: [specs[0].models[0]],
    });
    if (stale.status !== 409 || stale.json.code !== 'REVISION_CONFLICT') {
        throw new Error(`过期 revision 写入应 409 REVISION_CONFLICT，实际 ${stale.status} ${JSON.stringify(stale.json).slice(0, 160)}`);
    }
    const afterStale = await admin.listProviders();
    const chatRow = afterStale.json.find((p) => p.providerId === 'vc03m-chat');
    if (chatRow.models.length !== specs[0].models.length || !chatRow.models.some((m) => m.profileKey === 'chat-slow')) {
        throw new Error(`409 后模型文档被破坏：profiles=${chatRow.models.map((m) => m.profileKey).join(',')}`);
    }
    if (chatRow.displayName !== '受管 Chat' || chatRow.revision !== 1) {
        throw new Error(`409 后 provider 字段被改动：displayName=${chatRow.displayName} revision=${chatRow.revision}`);
    }
    log.ok('409 REVISION_CONFLICT 保留草稿通过（revision 与全部模型文档原样）');

    // —— Key 三态：无 Key 草稿 → 已配置 → 清除（各自读回断言） ——
    const draftSave = await admin.saveProvider('vc03m-draft', {
        displayName: '受管草稿', protocol: 'OPENAI_CHAT_COMPLETIONS', baseUrl: `${FIXTURE_BASE}/v1`,
        state: 'DISABLED', models: [specs[0].models[0]],
    });
    if (draftSave.status !== 200) throw new Error(`无 Key 草稿保存失败：HTTP ${draftSave.status}`);
    const draftList = await admin.listProviders();
    const draftRow = draftList.json.find((p) => p.providerId === 'vc03m-draft');
    if (draftRow?.credentialConfigured !== false) throw new Error('草稿态 credentialConfigured 应为 false');
    const setKey = await admin.saveProvider('vc03m-draft', {
        displayName: '受管草稿', protocol: 'OPENAI_CHAT_COMPLETIONS', baseUrl: `${FIXTURE_BASE}/v1`,
        credential: ctx.secrets.fixtureKey, state: 'ENABLED', expectedRevision: draftSave.json.revision,
        models: [specs[0].models[0]],
    });
    if (setKey.status !== 200) throw new Error(`补 Key 失败：HTTP ${setKey.status}`);
    const clearKey = await admin.saveProvider('vc03m-draft', {
        displayName: '受管草稿', protocol: 'OPENAI_CHAT_COMPLETIONS', baseUrl: `${FIXTURE_BASE}/v1`,
        clearCredential: true, state: 'DISABLED', expectedRevision: setKey.json.revision,
        models: [specs[0].models[0]],
    });
    if (clearKey.status !== 200) throw new Error(`清 Key 失败：HTTP ${clearKey.status}`);
    const clearedList = await admin.listProviders();
    const clearedRow = clearedList.json.find((p) => p.providerId === 'vc03m-draft');
    if (clearedRow?.credentialConfigured !== false) throw new Error('清 Key 后 credentialConfigured 应为 false');
    log.ok('Key 三态通过：草稿(无 Key) → 已配置 → 清除');

    // —— 共享影响：绑定切到 Responses，再切回；切换只改绑定行，不碰其他 provider ——
    const snapResp = await bindForeground(ctx, 'vc03m-resp', 'reasoning', 'vc03m-reasoning');
    const midList = await admin.listProviders();
    const chatUnchanged = midList.json.find((p) => p.providerId === 'vc03m-chat');
    if (chatUnchanged.revision !== 1) throw new Error(`绑定切换不该改 provider revision（vc03m-chat=${chatUnchanged.revision}）`);
    ctx.snapshots.responses = snapResp;
    ctx.snapshots.chat = await bindForeground(ctx, 'vc03m-chat', 'chat', 'vc03m-chat');
    ctx.snapshots.claude = await bindForeground(ctx, 'vc03m-claude', 'chat', 'vc03m-chat');
    ctx.snapshots.tiny = await bindForeground(ctx, 'vc03m-tiny', 'tiny', 'vc03m-chat');
    log.ok(`绑定切换（独立用途面）通过：br=${snapChat.bindingRevision}→${snapResp.bindingRevision}→…→${ctx.snapshots.chat.bindingRevision}，provider revision 不受影响`);

    // —— discover：真实 POST 到 fixture /models（显式操作，计入 fixture 计数） ——
    const discovered = await admin.discover('vc03m-chat', {
        protocol: 'OPENAI_CHAT_COMPLETIONS', baseUrl: `${FIXTURE_BASE}/v1`, credential: ctx.secrets.fixtureKey,
    });
    if (discovered.status !== 200 || !discovered.json.some((m) => m.modelId === 'vc03m-chat')) {
        throw new Error(`discover 失败：HTTP ${discovered.status} ${JSON.stringify(discovered.json).slice(0, 160)}`);
    }
    const modelsCapture = await readFixtureCapture(ctx, { protocol: 'models' });
    if (modelsCapture.auth.matched !== true) throw new Error('discover 的 /models 请求 auth 未匹配合成 key');
    log.ok('discover 通过（真实 fixture /models，auth 匹配）');
}

async function sceneZeroUpstreamOnSave(ctx) {
    // 只做保存/绑定/再保存（不 discover、不生成）：fixture 请求计数差必须为 0
    await ctx.fixtureHttp.clear();
    const before = await ctx.fixtureHttp.count();
    const saved = await ctx.admin.saveProvider('vc03m-chat', {
        displayName: '受管 Chat', protocol: 'OPENAI_CHAT_COMPLETIONS', baseUrl: `${FIXTURE_BASE}/v1`,
        state: 'ENABLED', expectedRevision: (await providerRevision(ctx, 'vc03m-chat')),
        models: providerCatalogSpec(ctx.secrets.fixtureKey)[0].models,
    });
    if (saved.status !== 200) throw new Error(`仅配置保存失败：HTTP ${saved.status}`);
    ctx.snapshots.chat = await bindForeground(ctx, 'vc03m-chat', 'chat', 'vc03m-chat');
    const mid = await ctx.fixtureHttp.count();
    if (mid !== before) throw new Error(`保存/绑定期间出现上游请求：${before} → ${mid}`);
    // 二次保存（KEEP 凭据）也不该触上游
    const saved2 = await ctx.admin.saveProvider('vc03m-chat', {
        displayName: '受管 Chat2', protocol: 'OPENAI_CHAT_COMPLETIONS', baseUrl: `${FIXTURE_BASE}/v1`,
        state: 'ENABLED', expectedRevision: saved.json.revision,
        models: providerCatalogSpec(ctx.secrets.fixtureKey)[0].models,
    });
    if (saved2.status !== 200) throw new Error(`二次保存失败：HTTP ${saved2.status}`);
    const after = await ctx.fixtureHttp.count();
    if (after !== before) throw new Error(`仅配置投影零上游请求断言失败：${before} → ${after}`);
    log.ok(`零上游请求断言通过：保存/绑定/再保存期间 fixture 计数恒为 ${before}`);
}

async function providerRevision(ctx, providerId) {
    const listed = await ctx.admin.listProviders();
    const row = listed.json.find((p) => p.providerId === providerId);
    if (!row) throw new Error(`provider ${providerId} 不存在`);
    return row.revision;
}

async function sceneServiceResolve(ctx) {
    // seed 大 ID 账号（safe-integer 之上）：精确十进制字符串可解析，float 邻值被拒
    psql(`
INSERT INTO vc.vc_user(id, display_name) VALUES (9007199254740993, 'w03-big-owner')
ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name;
INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name)
VALUES (9007199254740993, 'w03-big-owner', '${synthSecret(12)}', 'ADMIN', 'ACTIVE', 'w03-big-owner')
ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE';
`);
    const snap = await bindForeground(ctx, 'vc03m-chat', 'chat', 'vc03m-chat');
    const base = { purpose: 'FOREGROUND_CHAT', providerId: snap.providerId, profileKey: snap.profileKey, providerRevision: snap.providerRevision, bindingRevision: snap.bindingRevision };

    const okBig = await serviceResolve({ baseUrl: GO_BASE, serviceToken: ctx.secrets.serviceToken, body: { ...base, ownerAccountId: '9007199254740993' } });
    if (okBig.status !== 200 || okBig.json?.provider?.credential !== ctx.secrets.fixtureKey) {
        throw new Error(`大 owner resolve 失败：HTTP ${okBig.status} ${JSON.stringify(okBig.json).slice(0, 160)}`);
    }
    assertExactAccountId('9007199254740993', '9007199254740993');
    const neighbor = await serviceResolve({ baseUrl: GO_BASE, serviceToken: ctx.secrets.serviceToken, body: { ...base, ownerAccountId: '9007199254740992' } });
    if (neighbor.status !== 403 || neighbor.json?.code !== 'ACCESS_DENIED') {
        throw new Error(`float 邻值 owner 必须被拒，实际 HTTP ${neighbor.status} ${JSON.stringify(neighbor.json).slice(0, 160)}`);
    }
    const bad = await serviceResolve({ baseUrl: GO_BASE, serviceToken: ctx.secrets.serviceToken, body: { ...base, ownerAccountId: 'not-a-number' } });
    if (bad.status !== 400 || bad.json?.code !== 'INVALID_REQUEST') {
        throw new Error(`非十进制 ownerAccountId 应 400，实际 HTTP ${bad.status}`);
    }
    const noToken = await serviceResolve({ baseUrl: GO_BASE, serviceToken: 'wrong-token-wrong-token-wrong-token-0000', body: { ...base, ownerAccountId: OWNER_ACCOUNT_ID } });
    if (noToken.status !== 401) throw new Error(`错误服务令牌应 401，实际 ${noToken.status}`);

    const stalePr = await serviceResolve({ baseUrl: GO_BASE, serviceToken: ctx.secrets.serviceToken, body: { ...base, ownerAccountId: OWNER_ACCOUNT_ID, providerRevision: snap.providerRevision + 500 } });
    if (stalePr.status !== 409 || stalePr.json?.code !== 'REVISION_CONFLICT') {
        throw new Error(`过期 providerRevision 应 409 REVISION_CONFLICT，实际 HTTP ${stalePr.status}`);
    }
    const staleBr = await serviceResolve({ baseUrl: GO_BASE, serviceToken: ctx.secrets.serviceToken, body: { ...base, ownerAccountId: OWNER_ACCOUNT_ID, bindingRevision: snap.bindingRevision + 500 } });
    if (staleBr.status !== 409 || staleBr.json?.code !== 'REVISION_CONFLICT') {
        throw new Error(`过期 bindingRevision 应 409 REVISION_CONFLICT，实际 HTTP ${staleBr.status}`);
    }
    const fine = await serviceResolve({ baseUrl: GO_BASE, serviceToken: ctx.secrets.serviceToken, body: { ...base, ownerAccountId: OWNER_ACCOUNT_ID } });
    if (fine.status !== 200 || fine.json.purpose !== 'FOREGROUND_CHAT'
        || fine.json.provider.protocol !== 'OPENAI_CHAT_COMPLETIONS'
        || fine.json.provider.baseUrl !== `${FIXTURE_BASE}/v1`
        || fine.json.model.modelId !== 'vc03m-chat'
        || fine.json.model.maxOutputTokens !== 2048
        || fine.json.model.generationParams?.temperature !== 0.3) {
        throw new Error(`resolve 响应形状异常：HTTP ${fine.status} ${JSON.stringify(fine.json).slice(0, 240)}`);
    }
    log.ok('受控取用断言通过：大 owner 精确 ID / float 邻值拒绝 / revision 冲突 / 响应形状');
}

async function readSSEEvents(res) {
    return parseSSEText(await res.text());
}

async function sceneE2eChat(ctx) {
    const snap = await bindForeground(ctx, 'vc03m-chat', 'chat', 'vc03m-chat');
    const since = (await ctx.fixtureHttp.captures({})).at(-1)?.seq ?? 0;

    // 非流式
    const nonStream = await ctx.st.generate({
        chat_completion_source: 'custom', model: 'vc03m-chat', custom_url: snap.marker,
        messages: [{ role: 'user', content: '你好，受管验收' }],
        max_tokens: 512, stream: false,
    });
    if (nonStream.status !== 200 || nonStream.json?.choices?.[0]?.message?.role !== 'assistant') {
        throw new Error(`Chat 非流式生成失败：HTTP ${nonStream.status} ${String(nonStream.text).slice(0, 200)}`);
    }
    const capNon = await readFixtureCapture(ctx, { protocol: 'chat', since });
    if (capNon.finalUrl !== '/v1/chat/completions' || capNon.auth.scheme !== 'bearer' || capNon.auth.matched !== true) {
        throw new Error(`Chat 出站异常：finalUrl=${capNon.finalUrl} auth=${JSON.stringify(capNon.auth)}`);
    }
    if (capNon.body.model !== 'vc03m-chat' || Number(capNon.body.max_tokens) > 2048) {
        throw new Error(`Chat 出站约束异常：model=${capNon.body.model} max_tokens=${capNon.body.max_tokens}`);
    }
    if (Math.abs(Number(capNon.body.temperature) - 0.3) > 1e-6) {
        throw new Error(`Chat 钉住采样未生效：temperature=${capNon.body.temperature}`);
    }
    if (!Array.isArray(capNon.body.messages) || capNon.body.messages.at(-1)?.role !== 'user') {
        throw new Error('Chat 出站 messages 形状异常');
    }

    // 流式（SSE 透传）
    const stream = await ctx.st.generate({
        chat_completion_source: 'custom', model: 'vc03m-chat', custom_url: snap.marker,
        messages: [{ role: 'user', content: '流式请回复' }],
        max_tokens: 512, stream: true,
    });
    if (stream.status !== 200) throw new Error(`Chat 流式 HTTP ${stream.status}`);
    const events = await readSSEEvents(stream.res);
    const collected = collectChatStream(events);
    if (!collected.sawDone || collected.finish !== 'stop' || collected.content !== '收到。这是受管验收的合成回复，内容固定可断言。') {
        throw new Error(`Chat 流式内容异常：finish=${collected.finish} done=${collected.sawDone} content=${collected.content.slice(0, 40)}`);
    }

    // 上游可控错误（__ctl 覆盖）：Responses 码面由 e2e-responses 断言；custom 源走 ST 原生
    // custom 链，非流式错误契约是 HTTP 200 + {error} 信封（upstream makeRequest 失败包装）
    await ctx.fixtureHttp.setOverride('vc03m-chat', { error: { status: 500, message: 'synthetic' } });
    const errGen = await ctx.st.generate({
        chat_completion_source: 'custom', model: 'vc03m-chat', custom_url: snap.marker,
        messages: [{ role: 'user', content: '触发错误' }],
        max_tokens: 512, stream: false,
    });
    await ctx.fixtureHttp.setOverride('vc03m-chat', null);
    if (errGen.status !== 200 || !errGen.json?.error || typeof errGen.json.error.message !== 'string') {
        throw new Error(`Chat 上游错误应透传为 200 + error 信封，实际 HTTP ${errGen.status} ${String(errGen.text).slice(0, 160)}`);
    }
    log.ok('Chat Completions 端到端通过：非流式/流式/出站形状/auth/URL/钉住采样/上游错误');
}

async function sceneE2eResponses(ctx) {
    const snap = await bindForeground(ctx, 'vc03m-resp', 'reasoning', 'vc03m-reasoning');
    const since = (await ctx.fixtureHttp.captures({})).at(-1)?.seq ?? 0;

    // 非流式：桥接转换为 chat completion，tool_calls 完整
    const nonStream = await ctx.st.generate({
        chat_completion_source: 'custom', model: 'vc03m-reasoning', custom_url: snap.marker,
        messages: [{ role: 'user', content: '查一下广州天气' }],
        max_tokens: 512, stream: false,
    });
    const msg = nonStream.json?.choices?.[0]?.message;
    if (nonStream.status !== 200 || !Array.isArray(msg?.tool_calls) || msg.tool_calls[0]?.function?.name !== 'lookup_weather') {
        throw new Error(`Responses 非流式桥接异常：HTTP ${nonStream.status} ${String(nonStream.text).slice(0, 200)}`);
    }
    if (msg.tool_calls[0].function.arguments !== '{"city":"广州"}') {
        throw new Error(`Responses 工具参数分片重组异常：${msg.tool_calls[0].function.arguments}`);
    }
    const capNon = await readFixtureCapture(ctx, { protocol: 'responses', since });
    if (capNon.finalUrl !== '/v1/responses' || capNon.auth.matched !== true) {
        throw new Error(`Responses 出站异常：finalUrl=${capNon.finalUrl} auth=${JSON.stringify(capNon.auth)}`);
    }
    if (!Array.isArray(capNon.body.input) || !capNon.body.input.some((i) => i.type === 'message' && i.role === 'user')) {
        throw new Error('Responses input 映射异常（缺 user message item）');
    }
    if (!Array.isArray(capNon.body.include) || !capNon.body.include.includes('reasoning.encrypted_content')) {
        throw new Error('Responses include 未携带 reasoning.encrypted_content');
    }
    if (capNon.body.store !== false || capNon.body.truncation !== 'disabled') {
        throw new Error(`Responses 约束字段异常：store=${capNon.body.store} truncation=${capNon.body.truncation}`);
    }
    if (capNon.body.model !== 'vc03m-reasoning' || Number(capNon.body.max_output_tokens) > 2048) {
        throw new Error(`Responses 出站约束异常：model=${capNon.body.model} max_output_tokens=${capNon.body.max_output_tokens}`);
    }

    // 流式：事件序 → chat chunk 桥接
    const stream = await ctx.st.generate({
        chat_completion_source: 'custom', model: 'vc03m-reasoning', custom_url: snap.marker,
        messages: [{ role: 'user', content: '流式工具调用' }],
        max_tokens: 512, stream: true,
    });
    if (stream.status !== 200) throw new Error(`Responses 流式 HTTP ${stream.status}`);
    const collected = collectChatStream(await readSSEEvents(stream.res));
    if (collected.finish !== 'tool_calls' || collected.toolCalls[0]?.name !== 'lookup_weather' || collected.toolCalls[0]?.arguments !== '{"city":"广州"}') {
        throw new Error(`Responses 流式工具桥接异常：${JSON.stringify(collected).slice(0, 200)}`);
    }

    // 上游错误：插件整体适配层写出固定 502 VC_UPSTREAM_ERROR（不回显上游正文）
    await ctx.fixtureHttp.setOverride('vc03m-reasoning', { error: { status: 503, message: 'synthetic upstream down' } });
    const errGen = await ctx.st.generate({
        chat_completion_source: 'custom', model: 'vc03m-reasoning', custom_url: snap.marker,
        messages: [{ role: 'user', content: '触发错误' }],
        max_tokens: 512, stream: false,
    });
    await ctx.fixtureHttp.setOverride('vc03m-reasoning', null);
    if (errGen.status !== 502 || errGen.json?.error?.code !== 'VC_UPSTREAM_ERROR') {
        throw new Error(`Responses 上游错误应 502 VC_UPSTREAM_ERROR，实际 HTTP ${errGen.status} ${String(errGen.text).slice(0, 200)}`);
    }
    if (String(errGen.text).includes('synthetic upstream down')) {
        throw new Error('Responses 错误响应回显了上游正文（违规）');
    }
    log.ok('Responses 端到端通过：非流式/流式事件桥接/工具分片重组/include 约束/上游错误固定文案');
}

async function sceneE2eAnthropic(ctx) {
    const snap = await bindForeground(ctx, 'vc03m-claude', 'chat', 'vc03m-chat');
    const since = (await ctx.fixtureHttp.captures({})).at(-1)?.seq ?? 0;

    // 非流式：ST 原生 claude 链（system 提出、messages 转换）→ 转 chat completion 返回。
    // use_sysprompt 是浏览器侧 claude 源的真实开关：不开则 ST 整个删除 system 字段（上游
    // chat-completions.js useSystemPrompt 分支）；开启时 system 为内容块数组（非字符串）
    const nonStream = await ctx.st.generate({
        chat_completion_source: 'claude', model: 'vc03m-chat', reverse_proxy: snap.marker,
        use_sysprompt: true,
        messages: [
            { role: 'system', content: '你是受管验收助手' },
            { role: 'user', content: '你好' },
        ],
        max_tokens: 512, stream: false,
    });
    if (nonStream.status !== 200 || nonStream.json?.choices?.[0]?.message?.content !== '收到。这是受管验收的合成回复，内容固定可断言。') {
        throw new Error(`Anthropic 非流式失败：HTTP ${nonStream.status} ${String(nonStream.text).slice(0, 200)}`);
    }
    const capNon = await readFixtureCapture(ctx, { protocol: 'anthropic', since });
    if (capNon.finalUrl !== '/v1/messages' || capNon.auth.matched !== true) {
        throw new Error(`Anthropic 出站异常：finalUrl=${capNon.finalUrl} auth=${JSON.stringify(capNon.auth)}`);
    }
    const systemBlocks = Array.isArray(capNon.body.system) ? capNon.body.system : [capNon.body.system];
    const systemText = systemBlocks.map((b) => (typeof b === 'string' ? b : b?.text ?? '')).join('');
    if (!systemText.includes('受管验收助手')) {
        throw new Error(`Anthropic messages-system 转换异常：system=${String(JSON.stringify(capNon.body.system)).slice(0, 80)}`);
    }
    if (!Array.isArray(capNon.body.messages) || capNon.body.messages.some((m) => m.role === 'system') || capNon.body.messages.at(-1)?.role !== 'user') {
        throw new Error('Anthropic messages 形状异常（system 未提出或尾消息非 user）');
    }
    if (capNon.body.model !== 'vc03m-chat' || Number(capNon.body.max_tokens) > 2048) {
        throw new Error(`Anthropic 出站约束异常：model=${capNon.body.model} max_tokens=${capNon.body.max_tokens}`);
    }

    // 流式：Anthropic SSE 透传
    const stream = await ctx.st.generate({
        chat_completion_source: 'claude', model: 'vc03m-chat', reverse_proxy: snap.marker,
        messages: [{ role: 'user', content: '流式回复' }],
        max_tokens: 512, stream: true,
    });
    if (stream.status !== 200) throw new Error(`Anthropic 流式 HTTP ${stream.status}`);
    const collected = collectAnthropicStream(await readSSEEvents(stream.res));
    if (collected.content !== '收到。这是受管验收的合成回复，内容固定可断言。' || collected.stopReason !== 'end_turn') {
        throw new Error(`Anthropic 流式内容异常：stop=${collected.stopReason} content=${collected.content.slice(0, 40)}`);
    }

    // 上游可控错误：原生 claude 链非流式错误契约是 HTTP 500 + {error:true}（与 custom 链
    // 的 200 + error 信封不同；透传不回显断言留给日志红线）
    await ctx.fixtureHttp.setOverride('vc03m-chat', { error: { status: 529, message: 'synthetic overloaded' } });
    const errGen = await ctx.st.generate({
        chat_completion_source: 'claude', model: 'vc03m-chat', reverse_proxy: snap.marker,
        messages: [{ role: 'user', content: '触发错误' }],
        max_tokens: 512, stream: false,
    });
    await ctx.fixtureHttp.setOverride('vc03m-chat', null);
    if (errGen.status < 500 || !errGen.json?.error) {
        throw new Error(`Anthropic 上游错误应 5xx + error，实际 HTTP ${errGen.status} ${String(errGen.text).slice(0, 160)}`);
    }
    log.ok('Anthropic Messages 端到端通过：system 转换/messages 形状/auth/流式/usage 路径/上游错误');
}

async function sceneToolRound(ctx) {
    // —— Chat 协议工具回合：分片 arguments 重组 + 第二轮回传 ——
    const chatSnap = await bindForeground(ctx, 'vc03m-chat', 'chat-tools', 'vc03m-tools');
    const tools = [{ type: 'function', function: { name: 'lookup_weather', description: '查天气', parameters: { type: 'object', properties: { city: { type: 'string' } } } } }];
    const round1 = await ctx.st.generate({
        chat_completion_source: 'custom', model: 'vc03m-tools', custom_url: chatSnap.marker,
        messages: [{ role: 'user', content: '北京天气如何' }],
        max_tokens: 512, stream: false, tools,
    });
    const round1Msg = round1.json?.choices?.[0]?.message;
    if (round1.status !== 200 || round1Msg?.tool_calls?.[0]?.function?.name !== 'lookup_weather') {
        throw new Error(`Chat 工具轮1 失败：HTTP ${round1.status} ${String(round1.text).slice(0, 200)}`);
    }
    const callId = round1Msg.tool_calls[0].id;
    const callArgs = round1Msg.tool_calls[0].function.arguments;
    if (callArgs !== '{"city":"北京","unit":"celsius"}') {
        throw new Error(`Chat 工具参数分片重组异常：${callArgs}`);
    }
    const sinceChat = (await ctx.fixtureHttp.captures({})).at(-1)?.seq ?? 0;
    const round2 = await ctx.st.generate({
        chat_completion_source: 'custom', model: 'vc03m-tools', custom_url: chatSnap.marker,
        messages: [
            { role: 'user', content: '北京天气如何' },
            { role: 'assistant', content: '', tool_calls: round1Msg.tool_calls },
            { role: 'tool', tool_call_id: callId, content: '{"temp_c":21}' },
        ],
        max_tokens: 512, stream: false, tools,
    });
    if (round2.status !== 200) throw new Error(`Chat 工具轮2 失败：HTTP ${round2.status}`);
    const capRound2 = await readFixtureCapture(ctx, { protocol: 'chat', since: sinceChat });
    const tail = capRound2.body.messages.at(-1);
    if (tail?.role !== 'tool' || tail?.tool_call_id !== callId || !String(tail.content).includes('"temp_c":21')) {
        throw new Error(`Chat 工具轮2 出站形状异常：tail=${JSON.stringify(tail).slice(0, 120)}`);
    }

    // —— Responses：reasoning(encrypted) + function_call，轮2 同轮续接回传 ——
    const respSnap = await bindForeground(ctx, 'vc03m-resp', 'reasoning', 'vc03m-reasoning');
    const r1 = await ctx.st.generate({
        chat_completion_source: 'custom', model: 'vc03m-reasoning', custom_url: respSnap.marker,
        messages: [{ role: 'user', content: '广州天气如何' }],
        max_tokens: 512, stream: false,
    });
    const r1Calls = r1.json?.choices?.[0]?.message?.tool_calls;
    if (r1.status !== 200 || r1Calls?.[0]?.function?.name !== 'lookup_weather') {
        throw new Error(`Responses 工具轮1 失败：HTTP ${r1.status} ${String(r1.text).slice(0, 200)}`);
    }
    const rCallId = r1Calls[0].id;
    const sinceResp = (await ctx.fixtureHttp.captures({})).at(-1)?.seq ?? 0;
    const r2 = await ctx.st.generate({
        chat_completion_source: 'custom', model: 'vc03m-reasoning', custom_url: respSnap.marker,
        messages: [
            { role: 'user', content: '广州天气如何' },
            { role: 'assistant', content: '', tool_calls: r1Calls },
            { role: 'tool', tool_call_id: rCallId, content: '{"temp_c":26}' },
        ],
        max_tokens: 512, stream: false,
    });
    if (r2.status !== 200) throw new Error(`Responses 工具轮2 失败：HTTP ${r2.status}`);
    const capR2 = await readFixtureCapture(ctx, { protocol: 'responses', since: sinceResp });
    const reasoningItems = capR2.body.input.filter((i) => i.type === 'reasoning');
    const callItems = capR2.body.input.filter((i) => i.type === 'function_call');
    if (reasoningItems.length === 0 || !reasoningItems[0].encrypted_content) {
        throw new Error('Responses 轮2 未注入 reasoning(encrypted_content) 续接项');
    }
    if (!callItems.some((i) => i.call_id === rCallId)) {
        throw new Error('Responses 轮2 input 缺少本轮 function_call 回传');
    }
    if (capR2.body.input.indexOf(reasoningItems[0]) > capR2.body.input.indexOf(callItems[0])) {
        throw new Error('Responses 轮2 reasoning 续接项应位于 function_call 之前');
    }
    log.ok('工具回合通过：Chat 分片重组+轮2 回传；Responses 同轮 reasoning(encrypted_content) 续接');
}

async function sceneCancelStream(ctx) {
    const snap = await bindForeground(ctx, 'vc03m-chat', 'chat-slow', 'vc03m-chat-slow');
    const since = (await ctx.fixtureHttp.captures({})).at(-1)?.seq ?? 0;
    const controller = new AbortController();
    const started = Date.now();
    const streaming = ctx.st.generate({
        chat_completion_source: 'custom', model: 'vc03m-chat-slow', custom_url: snap.marker,
        messages: [{ role: 'user', content: '慢速流' }],
        max_tokens: 512, stream: true,
    }, { signal: controller.signal });
    void streaming.then(async ({ res }) => {
        try { await res.arrayBuffer(); } catch { /* 预期中断 */ }
    }).catch(() => { /* 预期中断 */ });
    await new Promise((r) => setTimeout(r, 450));
    controller.abort();
    await waitFor(async () => {
        const rows = await ctx.fixtureHttp.captures({ protocol: 'chat', since });
        return rows.some((c) => c.aborted === true || (c.durationMs ?? 0) > 900);
    }, { timeoutMs: 15000, intervalMs: 250, label: 'fixture 感知取消' });
    const after = await ctx.fixtureHttp.captures({ protocol: 'chat', since });
    const abortedRec = after.find((c) => c.aborted === true || (c.durationMs ?? 0) > 900);
    if (!abortedRec) throw new Error('取消后 fixture 未标记 aborted/长耗时');
    // 取消后的下一次请求必须完全正常（无状态污染）
    const healthy = await ctx.st.generate({
        chat_completion_source: 'custom', model: 'vc03m-chat', custom_url: (await bindForeground(ctx, 'vc03m-chat', 'chat', 'vc03m-chat')).marker,
        messages: [{ role: 'user', content: '取消后正常请求' }],
        max_tokens: 512, stream: false,
    });
    if (healthy.status !== 200) throw new Error(`取消后正常请求失败：HTTP ${healthy.status}`);
    log.ok(`取消场景通过：客户端中断 ${Date.now() - started}ms 后 fixture 标记 aborted，后续请求无污染`);
}

async function sceneContextBudget(ctx) {
    const snap = await bindForeground(ctx, 'vc03m-tiny', 'tiny', 'vc03m-chat');
    // 长对话：小窗 256 tokens，长 ASCII 输入（guesstimate ≈ bytes/3.35）必然超窗
    const longText = 'context-budget-fixture-line '.repeat(120);
    const overflow = await ctx.st.generate({
        chat_completion_source: 'custom', model: 'vc03m-chat', custom_url: snap.marker,
        messages: [{ role: 'user', content: longText }],
        max_tokens: 64, stream: false,
    });
    if (overflow.status !== 400 || overflow.json?.error?.code !== 'VC_CONTEXT_OVERFLOW') {
        throw new Error(`长对话应 400 VC_CONTEXT_OVERFLOW，实际 HTTP ${overflow.status} ${String(overflow.text).slice(0, 200)}`);
    }
    const overflowCount = await ctx.fixtureHttp.count({ protocol: 'chat' });
    // 输出预留超登记上限：拒绝且不出站
    const outLimit = await ctx.st.generate({
        chat_completion_source: 'custom', model: 'vc03m-chat', custom_url: snap.marker,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 9999, stream: false,
    });
    if (outLimit.status !== 400 || outLimit.json?.error?.code !== 'VC_OUTPUT_LIMIT_EXCEEDED') {
        throw new Error(`超登记输出应 400 VC_OUTPUT_LIMIT_EXCEEDED，实际 HTTP ${outLimit.status} ${String(outLimit.text).slice(0, 200)}`);
    }
    const afterCount = await ctx.fixtureHttp.count({ protocol: 'chat' });
    if (afterCount !== overflowCount) {
        throw new Error(`预算拒绝不得出站：chat 捕获 ${overflowCount} → ${afterCount}`);
    }
    log.ok('上下文预算与输出预留通过：VC_CONTEXT_OVERFLOW / VC_OUTPUT_LIMIT_EXCEEDED 且零上游请求');
}

async function sceneNativeDrift(ctx) {
    const snap = await bindForeground(ctx, 'vc03m-chat', 'chat', 'vc03m-chat');
    // 换模型
    const driftModel = await ctx.st.generate({
        chat_completion_source: 'custom', model: 'gpt-4o', custom_url: snap.marker,
        messages: [{ role: 'user', content: '偏离模型' }],
        max_tokens: 512, stream: false,
    });
    if (driftModel.status !== 409 || driftModel.json?.error?.code !== 'VC_NATIVE_DRIFT') {
        throw new Error(`改 model 应 409 VC_NATIVE_DRIFT，实际 HTTP ${driftModel.status} ${String(driftModel.text).slice(0, 200)}`);
    }
    // 钉住采样被覆写
    const driftTemp = await ctx.st.generate({
        chat_completion_source: 'custom', model: 'vc03m-chat', custom_url: snap.marker,
        messages: [{ role: 'user', content: '偏离采样' }],
        max_tokens: 512, temperature: 0.9, stream: false,
    });
    if (driftTemp.status !== 409 || driftTemp.json?.error?.code !== 'VC_NATIVE_DRIFT') {
        throw new Error(`覆写钉住采样应 409 VC_NATIVE_DRIFT，实际 HTTP ${driftTemp.status}`);
    }
    log.ok('原生偏离拒绝通过：model 与钉住采样均 VC_NATIVE_DRIFT');
}

async function sceneKeyRevoke(ctx) {
    const revisionBefore = await providerRevision(ctx, 'vc03m-chat');
    const cleared = await ctx.admin.saveProvider('vc03m-chat', {
        displayName: '受管 Chat', protocol: 'OPENAI_CHAT_COMPLETIONS', baseUrl: `${FIXTURE_BASE}/v1`,
        clearCredential: true, state: 'DISABLED', expectedRevision: revisionBefore,
        models: providerCatalogSpec(ctx.secrets.fixtureKey)[0].models,
    });
    if (cleared.status !== 200) throw new Error(`clearCredential 保存失败：HTTP ${cleared.status}`);
    // 清 Key 后绑定合法状态是 UNAVAILABLE（无凭据即不可用；绑定行仍可写、revision 照常推进），
    // 这里正向断言该状态，再用其标记走服务通道与生成链的拒绝断言
    const snapStale = await bindForeground(ctx, 'vc03m-chat', 'chat', 'vc03m-chat', { requireReady: false });
    if (snapStale.status !== 'UNAVAILABLE') {
        throw new Error(`清 Key 后绑定应为 UNAVAILABLE，实际 ${snapStale.status}`);
    }
    // 服务通道：清 Key 后下一次 resolve 即拒绝
    const resolve = await serviceResolve({ baseUrl: GO_BASE, serviceToken: ctx.secrets.serviceToken, body: { purpose: 'FOREGROUND_CHAT', ownerAccountId: OWNER_ACCOUNT_ID, providerId: 'vc03m-chat', profileKey: 'chat' } });
    if (resolve.status !== 409 || resolve.json?.code !== 'MODEL_NO_ELIGIBLE_DEPLOYMENT') {
        throw new Error(`清 Key 后 resolve 应 409 MODEL_NO_ELIGIBLE_DEPLOYMENT，实际 HTTP ${resolve.status} ${JSON.stringify(resolve.json).slice(0, 160)}`);
    }
    // 生成链同样拒绝（插件映射 VC_MODEL_NO_ELIGIBLE_DEPLOYMENT）
    const gen = await ctx.st.generate({
        chat_completion_source: 'custom', model: 'vc03m-chat', custom_url: snapStale.marker,
        messages: [{ role: 'user', content: '已撤销的 Key' }],
        max_tokens: 512, stream: false,
    });
    if (gen.status !== 409 || gen.json?.error?.code !== 'VC_MODEL_NO_ELIGIBLE_DEPLOYMENT') {
        throw new Error(`清 Key 后生成应 409 VC_MODEL_NO_ELIGIBLE_DEPLOYMENT，实际 HTTP ${gen.status} ${String(gen.text).slice(0, 200)}`);
    }
    // 恢复凭据，供后续场景
    const restored = await ctx.admin.saveProvider('vc03m-chat', {
        displayName: '受管 Chat', protocol: 'OPENAI_CHAT_COMPLETIONS', baseUrl: `${FIXTURE_BASE}/v1`,
        credential: ctx.secrets.fixtureKey, state: 'ENABLED', expectedRevision: cleared.json.revision,
        models: providerCatalogSpec(ctx.secrets.fixtureKey)[0].models,
    });
    if (restored.status !== 200) throw new Error(`恢复凭据失败：HTTP ${restored.status}`);
    log.ok('Key 撤销通过：clearCredential 后 resolve 与生成双双即时拒绝，恢复后可用');
}

async function sceneRevisionConflict(ctx) {
    const snap = await bindForeground(ctx, 'vc03m-chat', 'chat', 'vc03m-chat');
    const mutated = await ctx.admin.saveProvider('vc03m-chat', {
        displayName: '受管 Chat（另侧更新）', protocol: 'OPENAI_CHAT_COMPLETIONS', baseUrl: `${FIXTURE_BASE}/v1`,
        state: 'ENABLED', expectedRevision: snap.providerRevision,
        models: providerCatalogSpec(ctx.secrets.fixtureKey)[0].models,
    });
    if (mutated.status !== 200) throw new Error(`另侧 provider 更新失败：HTTP ${mutated.status}`);
    const staleGen = await ctx.st.generate({
        chat_completion_source: 'custom', model: 'vc03m-chat', custom_url: snap.marker,
        messages: [{ role: 'user', content: '用旧 revision 生成' }],
        max_tokens: 512, stream: false,
    });
    if (staleGen.status !== 409 || staleGen.json?.error?.code !== 'VC_REVISION_CONFLICT') {
        throw new Error(`旧 br/pr 生成应 409 VC_REVISION_CONFLICT，实际 HTTP ${staleGen.status} ${String(staleGen.text).slice(0, 200)}`);
    }
    // 重新绑定后恢复
    await bindForeground(ctx, 'vc03m-chat', 'chat', 'vc03m-chat');
    log.ok('revision 冲突通过：provider 另侧更新后旧标记生成 VC_REVISION_CONFLICT');
}

async function sceneContinuationHygiene(ctx) {
    const snap = await bindForeground(ctx, 'vc03m-resp', 'reasoning', 'vc03m-reasoning');
    const r1 = await ctx.st.generate({
        chat_completion_source: 'custom', model: 'vc03m-reasoning', custom_url: snap.marker,
        messages: [{ role: 'user', content: '先制造一轮工具调用' }],
        max_tokens: 512, stream: false,
    });
    const calls = r1.json?.choices?.[0]?.message?.tool_calls;
    if (r1.status !== 200 || !calls?.length) throw new Error(`续接卫生前置工具轮失败：HTTP ${r1.status}`);

    // a) 新用户回合（尾部非工具回合）不得注入旧 reasoning
    const sinceA = (await ctx.fixtureHttp.captures({})).at(-1)?.seq ?? 0;
    const fresh = await ctx.st.generate({
        chat_completion_source: 'custom', model: 'vc03m-reasoning', custom_url: snap.marker,
        messages: [{ role: 'user', content: '新的用户回合' }],
        max_tokens: 512, stream: false,
    });
    if (fresh.status !== 200) throw new Error(`新回合生成失败：HTTP ${fresh.status}`);
    const capFresh = await readFixtureCapture(ctx, { protocol: 'responses', since: sinceA });
    if (capFresh.body.input.some((i) => i.type === 'reasoning')) {
        throw new Error('新用户回合不应注入旧 reasoning 续接项');
    }

    // b) 换 scope（换 chat 语义）+ 同尾部工具回合：指纹不匹配 → 不注入
    const scopeB = `${ctx.scope}#chat-b`;
    const markerB = snap.marker.replace(/scope=[^&]+$/, `scope=${encodeURIComponent(scopeB)}`);
    const sinceB = (await ctx.fixtureHttp.captures({})).at(-1)?.seq ?? 0;
    const crossScope = await ctx.st.generate({
        chat_completion_source: 'custom', model: 'vc03m-reasoning', custom_url: markerB,
        messages: [
            { role: 'user', content: '先制造一轮工具调用' },
            { role: 'assistant', content: '', tool_calls: calls },
            { role: 'tool', tool_call_id: calls[0].id, content: '{"temp_c":26}' },
        ],
        max_tokens: 512, stream: false,
    });
    if (crossScope.status !== 200) throw new Error(`换 scope 工具续接生成失败：HTTP ${crossScope.status}`);
    const capCross = await readFixtureCapture(ctx, { protocol: 'responses', since: sinceB });
    if (capCross.body.input.some((i) => i.type === 'reasoning')) {
        throw new Error('换 scope 的工具回合不应注入旧 reasoning（续接一次性 + scope 绑定）');
    }
    log.ok('续接卫生通过：新用户回合与换 scope 工具回合均不注入旧 reasoning');
}

async function sceneUi04Browser(ctx) {
    await bindForeground(ctx, 'vc03m-chat', 'chat', 'vc03m-chat');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-w04-browser-'));
    const state = path.join(dir, 'state.json');
    const cookies = [['vc_session', ctx.secrets.session.vcSession], ['vc_csrf', ctx.secrets.session.vcCsrf]].map(([name, value]) => ({
        name, value, domain: '127.0.0.1', path: '/', expires: -1, httpOnly: name === 'vc_session', secure: false, sameSite: 'Lax',
    }));
    fs.writeFileSync(state, JSON.stringify({ cookies, origins: [] }), { mode: 0o600 });
    try {
        // 异步 child：本进程的合成 provider 必须继续响应，不能使用 spawnSync。
        await new Promise((resolve, reject) => {
            const child = spawn(process.execPath, [path.join(SCRIPTS, 'accept.mjs'), '--managed', '--only', process.env.VC_W04_CASES || 'C04,C05,UI02'], {
                env: { ...process.env, VC_ST_DEV_DIR: DEV_MANAGED, VC_ST_PORT: String(ST_PORT), VC_ST_MOCK_PORT: String(FIXTURE_PORT),
                    VC_ST_ACCEPT_STORAGE_STATE: state, ...(process.env.VC_W03_CHROMIUM_PATH ? { VC_ST_BROWSER: process.env.VC_W03_CHROMIUM_PATH } : {}) },
                stdio: 'inherit',
            });
            child.on('error', reject);
            child.on('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`W04 浏览器子进程失败：${code ?? signal}`)));
        });
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

async function sceneUi03Browser(ctx) {
    // 真实浏览器 UI03 验收（默认不在 --filter，主会话串联时执行）：
    //   注入合成 Go 会话 cookie → 打开 ST → 真实 DOM 全流程：
    //   1) 模型页编辑保存 → 服务端 revision+1 → 界面读回一致；
    //   2) 另侧更新后 UI 保存 → 409 冲突，草稿原样保留（conflict-keep）；
    //   3) Key 只显示状态（状态盒/替换框为空且 password/页面无明文）；
    //   4) 用途绑定经 UI 保存 → 投影写原生设置（marker/模型/上下文/输出参数/main_api）；
    //   5) 三协议（Chat/Responses/Claude）经原生界面发送，fixture 断言真实出站。
    //   截图不含 API Key（页面本身不回显凭据）。
    let chromium;
    try {
        ({ chromium } = await import('playwright-core'));
    } catch {
        throw new Error('playwright-core 不可用（node_modules 缺失）；真实浏览器串联由主会话环境执行');
    }
    // chromium 可执行文件可用 VC_W03_CHROMIUM_PATH 覆盖（playwright-core 1.64 锁定依赖；
    // 无对应版本缓存时复用本机已有的 Chromium for Testing 二进制）
    const launchOpts = { headless: true };
    if (process.env.VC_W03_CHROMIUM_PATH) launchOpts.executablePath = process.env.VC_W03_CHROMIUM_PATH;
    const browser = await chromium.launch(launchOpts);
    try {
        const browserContext = await browser.newContext();
        await browserContext.addCookies([
            { name: 'vc_session', value: ctx.secrets.session.vcSession, url: ST_BASE },
            { name: 'vc_csrf', value: ctx.secrets.session.vcCsrf, url: ST_BASE },
        ]);
        const page = await browserContext.newPage();
        const consoleLines = [];
        page.on('console', (m) => consoleLines.push(`[page:${m.type()}] ${m.text().slice(0, 160)}`));
        // 网络探针（诊断连接检查与生成）：request 级（未应答也可见）+ 4xx/5xx 应答体
        page.on('request', (req) => {
            const u = req.url();
            if (u.includes('/api/backends/chat-completions/status') || u.includes('/api/backends/chat-completions/generate')) {
                let hint = '';
                try {
                    const pd = req.postDataJSON?.();
                    if (pd) hint = ` src=${pd.chat_completion_source} marker=${String(pd.custom_url ?? pd.reverse_proxy ?? '').slice(0, 40)}`;
                } catch { /* 无体 */ }
                console.log(`[ui03-req] POST ${u.replace(ST_BASE, '')}${hint}`);
            }
        });
        page.on('response', async (res) => {
            const u = res.url();
            const isWatched = u.includes('/api/backends/chat-completions/status') || u.includes('/api/backends/chat-completions/generate');
            if (isWatched || res.status() >= 400) {
                let bodyHint = '';
                try {
                    const req = res.request();
                    const pd = req.postDataJSON?.() ?? null;
                    bodyHint = pd ? ` src=${pd.chat_completion_source} custom=${String(pd.custom_url ?? pd.reverse_proxy ?? '').slice(0, 46)}` : '';
                } catch { /* 无体 */ }
                let respHint = '';
                if (res.status() >= 400) {
                    try { respHint = ` resp=${(await res.text()).slice(0, 120)}`; } catch { /* 已释放 */ }
                }
                console.log(`[ui03-net] ${res.status()} ${u.replace(ST_BASE, '')}${bodyHint}${respHint}`);
            }
        });
        await page.goto(ST_BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(4000);
        // ST 首启欢迎弹窗（合成 dataRoot 首次初始化）会拦截所有点击：按真实用户流程完成
        // （用户名默认合成填入 + 确定），不绕过、不调 z-index
        // ST 首启欢迎弹窗（合成 dataRoot 首次初始化）会拦截所有点击：按真实用户流程完成。
        // 控件为锁定源码形状（public/scripts/popup.js）：textarea=用户名（默认 User）、
        // .popup-button-ok=确定（DIV 按钮，getByRole(button) 不可见）
        const welcomeDialog = page.locator('dialog[open].popup').first();
        if (await welcomeDialog.count()) {
            await welcomeDialog.locator('textarea').fill('w03-owner');
            await welcomeDialog.locator('.popup-button-ok').click();
            await welcomeDialog.waitFor({ state: 'hidden', timeout: 10000 });
            log.info('ST 首启欢迎弹窗已按真实用户流程完成（合成用户名 + .popup-button-ok）');
        }
        // 扩展经 manifest hooks.activate 自动激活（已验证）；按钮在收起的魔法棒菜单里，
        // attached 等待确认激活，随后按真实用户路径打开（魔法棒 → 模型设置）
        await page.waitForSelector('#vc_models_menu_button', { state: 'attached', timeout: 45000 });
        const openPanel = async () => {
            // overlay 元素常驻 DOM（init 即挂载、保持隐藏），开合判断必须用可见性
            if (await page.locator('.vcms-overlay').isVisible()) return;
            await page.click('#extensionsMenuButton');
            await page.click('#vc_models_menu_button');
            await page.waitForSelector('.vcms-overlay', { state: 'visible', timeout: 10000 });
        };
        const closePanel = async () => {
            if (!(await page.locator('.vcms-overlay').isVisible())) return;
            // 有未保存修改时关闭会先确认；按真实用户路径先放弃修改（阶段 2 保留的冲突草稿等）
            if (await page.locator('#vcms-dirty').isVisible()) {
                await page.click('#vcms-discard');
                await page.waitForSelector('#vcms-dirty', { state: 'hidden', timeout: 5000 });
            }
            await page.click('.vcms-overlay [data-action="close"]');
            await page.waitForSelector('.vcms-overlay', { state: 'hidden', timeout: 10000 });
        };
        await openPanel();
        try {
            await page.waitForSelector('#vcms-provider-list > *', { timeout: 10000 });
        } catch {
            const panelState = await page.evaluate(() => ({
                hidden: document.querySelector('.vcms-overlay')?.hidden ?? null,
                outerStart: document.querySelector('.vcms-overlay')?.outerHTML?.replace(/\s+/g, ' ').slice(0, 260) ?? null,
                rootHtml: document.querySelector('#vc-model-settings-root')?.outerHTML?.replace(/\s+/g, ' ').slice(0, 200) ?? null,
                bodyClass: document.body.className,
            }));
            const pageErrs = consoleLines.filter((l) => l.includes('error') || l.includes('Error')).slice(-6);
            console.log(`[ui03-panel-state] ${JSON.stringify(panelState)} errs=${JSON.stringify(pageErrs)}`);
            await page.screenshot({ path: path.join(ctx.artifactsDir, 'ui03-panel-missing.png'), fullPage: false });
            throw new Error(`模型页 provider 列表未出现：${JSON.stringify(panelState).slice(0, 200)}`);
        }
        const cardCount = await page.locator('#vcms-provider-list > *').count();
        if (cardCount < 5) throw new Error(`模型页 provider 卡不足：${cardCount}（期望 ≥5，catalog-admin 已建）`);

        // —— 阶段 1：真实 DOM 保存 → 读回（首卡默认已选中，表单已在）——
        // 契约：保存不触发任何上游请求（page.js:657、MASTER_PLAN:103）——真实页面计数断言
        const saveCount0 = await ctx.fixtureHttp.count();
        const chatCard = page.locator('#vcms-provider-list > *').first();
        await page.waitForSelector('#vcms-f-display', { timeout: 5000 });
        const beforeList = await ctx.admin.listProviders();
        const beforeRow = beforeList.json.find((p) => p.providerId === 'vc03m-chat');
        await page.fill('#vcms-f-display', '受管 Chat（UI03）');
        await page.click('#vcms-save');
        await waitFor(async () => {
            const l = await ctx.admin.listProviders();
            const row = l.json.find((p) => p.providerId === 'vc03m-chat');
            return row && row.displayName === '受管 Chat（UI03）' && row.revision === beforeRow.revision + 1;
        }, { timeoutMs: 15000, label: 'UI 保存落库（displayName + revision+1）' });
        await chatCard.click(); // 重新选中读回
        await page.waitForSelector('#vcms-f-display', { timeout: 5000 });
        const readBack = await page.inputValue('#vcms-f-display');
        if (readBack !== '受管 Chat（UI03）') throw new Error(`UI 读回异常：display=${readBack}`);
        if ((await ctx.fixtureHttp.count()) !== saveCount0) {
            throw new Error(`保存期间出现上游请求（违反零请求契约）：${saveCount0} → ${await ctx.fixtureHttp.count()}`);
        }
        await page.screenshot({ path: path.join(ctx.artifactsDir, 'ui03-save-readback.png'), fullPage: false });
        log.ok('UI03 保存读回通过：真实 DOM 编辑 → 保存 → 服务端 revision+1 → 界面读回一致');

        // —— 阶段 2：版本冲突保留草稿 ——
        await page.fill('#vcms-f-display', 'UI03 冲突草稿值');
        const curList = await ctx.admin.listProviders();
        const curRow = curList.json.find((p) => p.providerId === 'vc03m-chat');
        const externalName = `受管 Chat（他侧更新 ${Date.now() % 1000}）`;
        const external = await ctx.admin.saveProvider('vc03m-chat', {
            displayName: externalName, protocol: 'OPENAI_CHAT_COMPLETIONS',
            baseUrl: `${FIXTURE_BASE}/v1`, state: 'ENABLED', expectedRevision: curRow.revision,
            models: providerCatalogSpec(ctx.secrets.fixtureKey)[0].models,
        });
        if (external.status !== 200) throw new Error(`外部更新失败：HTTP ${external.status}`);
        await page.click('#vcms-save');
        await page.waitForSelector('[data-action="conflict-keep"]', { timeout: 10000 });
        const draftKept = await page.inputValue('#vcms-f-display');
        if (draftKept !== 'UI03 冲突草稿值') throw new Error(`冲突后草稿被破坏：display=${draftKept}`);
        await page.screenshot({ path: path.join(ctx.artifactsDir, 'ui03-conflict-draft.png'), fullPage: false });
        await page.click('[data-action="conflict-keep"]');
        const afterConflict = (await ctx.admin.listProviders()).json.find((p) => p.providerId === 'vc03m-chat');
        if (afterConflict.displayName === 'UI03 冲突草稿值' || afterConflict.displayName !== externalName) {
            throw new Error(`冲突后服务端值异常：${afterConflict.displayName}`);
        }
        log.ok('UI03 版本冲突保留草稿通过：409 后界面草稿原样、服务端保持他侧更新');

        // —— 阶段 3：Key 只显示状态 ——
        // 受管 Chat 已配置合成 Key：选中即显示状态盒（不回显、无输入框），替换才出现 password 输入
        await chatCard.click();
        await page.waitForSelector('.vcms-keybox', { timeout: 5000 });
        if (await page.locator('#vcms-f-key').count()) throw new Error('已配置 Key 的供应商不应直接出现密钥输入框');
        const keyboxText = await page.locator('.vcms-keybox').first().innerText();
        if (!/已配置/.test(keyboxText)) throw new Error(`Key 状态盒文案异常：${keyboxText.slice(0, 60)}`);
        await page.click('[data-action="key-replace"]');
        await page.waitForSelector('#vcms-f-key', { timeout: 5000 });
        const keyType = await page.getAttribute('#vcms-f-key', 'type');
        const keyValue = await page.inputValue('#vcms-f-key');
        if (keyType !== 'password') throw new Error(`密钥输入框 type=${keyType}（应为 password）`);
        if (keyValue !== '') throw new Error(`替换密钥框必须为空且不回显原值，实际=${String(keyValue).slice(0, 8)}…`);
        const pageHtml = await page.content();
        if (pageHtml.includes(ctx.secrets.fixtureKey)) throw new Error('页面 DOM 泄露明文密钥');
        await page.click('[data-action="key-undo"]');
        await page.screenshot({ path: path.join(ctx.artifactsDir, 'ui03-key-status.png'), fullPage: false });
        log.ok('UI03 Key 只显示状态通过：状态盒 + password 替换框 + 页面无明文密钥');

        // —— 阶段 4/5：用途绑定 + 原生投影/上下文/输出参数 + 三协议原生发送 ——
        const bindAndProject = async (optionValue, markerPred, label) => {
            // 契约断言：用途绑定 → 投影刷新全程零上游请求（含改 source 的绑定；
            // 连接只发生在用户显式点击"连接"）
            const count0 = await ctx.fixtureHttp.count();
            await openPanel();
            await page.click('[data-action="tab"][data-tab="bindings"]');
            await page.waitForSelector('select[data-bind="binding.FOREGROUND_CHAT"]', { timeout: 5000 });
            await page.selectOption('select[data-bind="binding.FOREGROUND_CHAT"]', optionValue);
            await page.click('[data-action="save-bindings"]');
            await waitFor(async () => {
                const purposes = await ctx.admin.listPurposes();
                const row = purposes.json.find((r) => r.purpose === 'FOREGROUND_CHAT');
                const [p, f] = optionValue.split('::');
                return row && row.providerId === p && row.profileKey === f && row.status === 'READY';
            }, { timeoutMs: 15000, label: `UI 绑定落库（${label}）` });
            await page.waitForFunction((pred) => {
                const oai = window.SillyTavern?.getContext?.()?.chatCompletionSettings ?? {};
                return pred.includes('reverse')
                    ? String(oai.reverse_proxy ?? '').includes(pred.replace('reverse:', ''))
                    : String(oai.custom_url ?? '').includes(pred);
            }, markerPred, { timeout: 20000, polling: 400 });
            if ((await ctx.fixtureHttp.count()) !== count0) {
                throw new Error(`${label} 绑定/投影期间出现上游请求（违反零请求契约）：${count0} → ${await ctx.fixtureHttp.count()}`);
            }
        };
        const nativeSend = async (text, expectReply, { expectProxyMarker } = {}) => {
            await closePanel(); // 面板是全屏遮罩，发送前按真实路径收起
            // 真实用户连接步骤：ST 的连接检查只在点"连接"时发起（投影不自动触发）。
            // 打开右上 API 抽屉 → 点连接 → 等发送键出现（no_connection 时它被隐藏）
            if (await page.locator('#send_but.displayNone').count()) {
                if (!(await page.locator('#api_button_openai').isVisible())) {
                    await page.click('#API-status-top');
                }
                await page.waitForSelector('#api_button_openai', { state: 'visible', timeout: 10000 });
                await page.click('#api_button_openai');
                await page.waitForFunction(() => !document.querySelector('#send_but')?.classList.contains('displayNone')
                    && document.querySelector('#send_but')?.offsetParent !== null, undefined, { timeout: 30000, polling: 400 });
            }
            const since = (await ctx.fixtureHttp.captures({})).at(-1)?.seq ?? 0;
            await page.fill('#send_textarea', text);
            await page.waitForFunction(() => {
                const b = document.querySelector('#send_but');
                const s = document.querySelector('#mes_stop');
                return b && !b.disabled && !b.classList.contains('disabled')
                    && (!s || getComputedStyle(s).display === 'none'); // 点击前无在途生成
            }, undefined, { timeout: 30000, polling: 400 });
            await page.click('#send_but');
            // Claude 源 reverse_proxy 变更后，ST 客户端会弹"正在连接代理"确认（openai.js:537
            // validateReverseProxy）阻塞生成：核对弹窗确指本轮绑定标记后才按真实用户流程确认
            if (expectProxyMarker) {
                const confirmDialog = page.locator('dialog[open].popup').first();
                await confirmDialog.waitFor({ timeout: 15000 });
                const dlgText = (await confirmDialog.innerText()).replace(/\s+/g, ' ');
                if (!dlgText.includes(expectProxyMarker)) {
                    throw new Error(`代理确认弹窗目标异常（期望含 ${expectProxyMarker}）：${dlgText.slice(0, 120)}`);
                }
                await confirmDialog.locator('.popup-button-ok').click();
                await confirmDialog.waitFor({ state: 'hidden', timeout: 10000 });
            }
            // 判据用 getContext().chat 真源（accept.mjs 同模式）：末两条恰为本轮消息对
            // （用户文本本轮唯一）+ AI 回复到位 + #mes_stop 空闲。首次无角色发送会
            // newAssistantChat 替换欢迎会话（script.js:1760），不能跨会话套计数增长
            try {
                await page.waitForFunction(({ text: t, reply }) => {
                    const ch = window.SillyTavern.getContext()?.chat ?? [];
                    const last = ch[ch.length - 1];
                    const prev = ch[ch.length - 2];
                    const stop = document.querySelector('#mes_stop');
                    const idle = !stop || getComputedStyle(stop).display === 'none';
                    return idle && !!prev && prev.is_user === true && String(prev.mes ?? '').includes(t)
                        && !!last && !last.is_user && String(last.mes ?? '').includes(reply);
                }, { text, reply: expectReply }, { timeout: 45000, polling: 500 });
            } catch {
                const diag = await page.evaluate(() => ({
                    chatLen: window.SillyTavern.getContext()?.chat?.length ?? -1,
                    lastTwo: (window.SillyTavern.getContext()?.chat ?? []).slice(-2).map((m) => ({ is_user: m.is_user, mes: String(m.mes ?? '').slice(0, 60) })),
                    stopVisible: (() => { const s = document.querySelector('#mes_stop'); return !!s && getComputedStyle(s).display !== 'none'; })(),
                    lastResources: performance.getEntriesByType('resource').slice(-8).map((e) => `${e.name.split('/').slice(-2).join('/')} ${Math.round(e.duration)}ms`),
                    genState: window.SillyTavern.getContext()?.generation_started ?? null,
                }));
                await page.screenshot({ path: path.join(ctx.artifactsDir, 'ui03-send-stuck.png'), fullPage: false });
                console.log(`[ui03-send-diag] ${JSON.stringify(diag)} console=${JSON.stringify(consoleLines.slice(-8))}`);
                throw new Error(`原生发送后未等到本轮消息对：${JSON.stringify(diag)}`);
            }
            return since;
        };

        // 协议 1/3：Chat Completions（投影负责把 main_api 切到 openai——真实接线）
        await bindAndProject('vc03m-chat::chat', 'provider=vc03m-chat&profile=chat', 'chat');
        await page.waitForFunction(() => {
            const c = window.SillyTavern?.getContext?.() ?? {};
            const oai = c.chatCompletionSettings ?? {};
            return String(c.mainApi ?? '') === 'openai'
                && oai.chat_completion_source === 'custom'
                && String(oai.custom_url ?? '').startsWith('vc-go://')
                && Number(oai.openai_max_tokens) === 2048
                && Number(oai.openai_max_context) === 8192
                && String(oai.custom_model ?? '') === 'vc03m-chat';
        }, undefined, { timeout: 20000, polling: 400 });
        // 受管 dataRoot 跨运行持久（chat/设置累积），用户文本带本轮唯一 scope 后缀，
        // 防止上一轮的同文案消息对让断言误匹配
        const sinceChat = await nativeSend(`UI03 原生发送：Chat ${ctx.scope}`, '受管验收的合成回复');
        let cap = await readFixtureCapture(ctx, { protocol: 'chat', since: sinceChat });
        if (cap.finalUrl !== '/v1/chat/completions' || cap.body.model !== 'vc03m-chat' || cap.auth.matched !== true) {
            throw new Error(`Chat 原生发送出站异常：${cap.finalUrl} ${cap.body?.model}`);
        }
        if (Math.abs(Number(cap.body.temperature) - 0.3) > 1e-6) throw new Error(`Chat 原生发送钉住采样丢失：${cap.body.temperature}`);
        await page.screenshot({ path: path.join(ctx.artifactsDir, 'ui03-native-chat.png'), fullPage: false });
        log.ok('UI03 原生投影+Chat 原生发送通过：marker/模型/上下文 8192/输出 2048/钉住采样经原生界面真实发出');

        // 协议 2/3：Responses（仍走 custom 源，插件桥适配 /v1/responses）
        await bindAndProject('vc03m-resp::usage', 'provider=vc03m-resp&profile=usage', 'responses');
        const sinceResp = await nativeSend(`UI03 原生发送：Responses ${ctx.scope}`, '带固定用量的回复');
        cap = await readFixtureCapture(ctx, { protocol: 'responses', since: sinceResp });
        if (cap.finalUrl !== '/v1/responses' || cap.body.model !== 'vc03m-usage' || cap.auth.matched !== true || cap.body.store !== false) {
            throw new Error(`Responses 原生发送出站异常：${cap.finalUrl} ${cap.body?.model} store=${cap.body?.store}`);
        }
        log.ok('UI03 Responses 原生发送通过：原生界面 → 插件桥 → /v1/responses（store=false、auth 匹配）');

        // 协议 3/3：Anthropic（同为 main_api=openai，族内 chat_completion_source=claude）
        await bindAndProject('vc03m-claude::chat', 'reverse:provider=vc03m-claude&profile=chat', 'claude');
        await page.waitForFunction(() => {
            const c = window.SillyTavern?.getContext?.() ?? {};
            const oai = c.chatCompletionSettings ?? {};
            return String(c.mainApi ?? '') === 'openai'
                && oai.chat_completion_source === 'claude'
                && String(oai.reverse_proxy ?? '').startsWith('vc-go://') && String(oai.claude_model ?? '') === 'vc03m-chat';
        }, undefined, { timeout: 20000, polling: 400 });
        const sinceClaude = await nativeSend(`UI03 原生发送：Claude ${ctx.scope}`, '受管验收的合成回复', {
            // 只确认确指本轮 claude 绑定标记的代理弹窗（不全局接受任意弹窗）
            expectProxyMarker: 'vc-go://model-purposes/FOREGROUND_CHAT?provider=vc03m-claude',
        });
        cap = await readFixtureCapture(ctx, { protocol: 'anthropic', since: sinceClaude });
        if (cap.finalUrl !== '/v1/messages' || cap.body.model !== 'vc03m-chat' || cap.auth.matched !== true) {
            throw new Error(`Claude 原生发送出站异常：${cap.finalUrl} ${cap.body?.model}`);
        }
        await page.screenshot({ path: path.join(ctx.artifactsDir, 'ui03-native-claude.png'), fullPage: false });
        log.ok('UI03 Anthropic 原生发送通过：main_api=openai + source=claude + reverse_proxy marker → /v1/messages');

        ctx.screenshots.push('ui03-save-readback.png', 'ui03-conflict-draft.png', 'ui03-key-status.png', 'ui03-native-chat.png', 'ui03-native-claude.png');
        log.ok('UI03 真实浏览器界面验收通过：保存读回 / 冲突保留草稿 / Key 只显状态 / 原生投影与三协议原生发送');
    } finally {
        await browser.close();
    }
}

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

// ---------------------------------------------------------------------------
// main 编排
// ---------------------------------------------------------------------------

const STORY_MARKERS = ['PRIVATE_LIN_LOAN_31', 'PRIVATE_ZHOU_WATCH_44', 'PRIVATE_SU_WITNESS_57', 'GM_ONLY_WATCH_TRUTH_92'];

async function sceneStoryViewBrowser(ctx) {
    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({
        headless: true,
        ...(process.env.VC_W03_CHROMIUM_PATH ? { executablePath: process.env.VC_W03_CHROMIUM_PATH } : {}),
    });
    const actorHits = [];
    const modelHits = [];
    const playerViews = [];
    let watchModel = false;
    try {
        const bc = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        await bc.addCookies([
            { name: 'vc_session', value: ctx.secrets.session.vcSession, domain: '127.0.0.1', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' },
            { name: 'vc_csrf', value: ctx.secrets.session.vcCsrf, domain: '127.0.0.1', path: '/', httpOnly: false, secure: false, sameSite: 'Lax' },
        ]);
        const page = await bc.newPage();
        page.setDefaultTimeout(120000);
        const errors = [];
        const consoleLines = [];
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('console', (msg) => {
            if (msg.type() === 'error' || msg.type() === 'warning') consoleLines.push(msg.text().slice(0, 240));
        });
        page.on('request', (req) => {
            const url = req.url();
            if (/\/actors\/(?:lin|zhou|su|gm)\//.test(url)) actorHits.push(url);
            if (url.includes('/actors/player/view')) playerViews.push(url);
            if (watchModel && /\/(?:generate|v1\/chat\/completions|v1\/messages|v1\/responses)(?:\?|$)/.test(url)) modelHits.push(url);
        });
        const failShot = async (error) => {
            const url = page.url();
            let text = '';
            try { text = (await page.locator('body').innerText({ timeout: 2000 })).replace(/\s+/g, ' ').slice(0, 240); } catch { /* 页面已关闭 */ }
            try { await page.screenshot({ path: path.join(ctx.artifactsDir, 'story-failure.png') }); } catch { /* 截图失败不影响原因 */ }
            throw new Error(`${error.message} url=${url} body=${text} console=${consoleLines.slice(-4).join(' | ')}`);
        };
        try {
        await page.goto(ctx.w05.stBase, { waitUntil: 'domcontentloaded' });
        if (new URL(page.url()).pathname.startsWith('/auth')) throw new Error('未进入聊天，停在登录页');
        await page.waitForFunction(() => Boolean(window.SillyTavern?.getContext?.()?.eventSource));
        await page.waitForSelector('#send_textarea', { state: 'attached' });
        await page.waitForFunction(async () => (await import('/script.js')).settingsReady || document.querySelector('dialog[open] .onboarding'));
        const onboarding = page.locator('dialog[open].popup').filter({ has: page.locator('.onboarding') });
        if (await onboarding.count()) {
            await onboarding.locator('textarea').fill('合成验收用户');
            await onboarding.locator('.popup-button-ok').click();
            await onboarding.waitFor({ state: 'hidden' });
        }
        await page.waitForFunction(async () => (await import('/script.js')).settingsReady);
        await page.waitForSelector('#preloader', { state: 'hidden' });
        await page.waitForSelector('#vc_story_menu_button', { state: 'attached' });
        await page.locator('#extensionsMenuButton').click();
        await page.locator('#vc_story_menu_button').click();
        await page.locator('.vc-story-dialog[open]').waitFor();
        watchModel = true;
        await page.locator('[data-action="start"]').click();
        await page.waitForFunction(() => {
            const root = document.querySelector('.vc-story');
            return root?.getAttribute('data-state') === 'playing' || Boolean(root?.querySelector('[role="alert"]'));
        }, null, { timeout: 60000 });
        const storyState = await page.locator('.vc-story').getAttribute('data-state');
        if (storyState !== 'playing') {
            throw new Error(`开局未进入玩家视图：${await page.locator('.vc-story [role="alert"]').innerText()}`);
        }
        const visible = await page.locator('.vc-story').innerText();
        for (const text of ['雨夜旅馆：失踪的怀表', '雨夜，小旅馆的一枚展柜怀表失踪。玩家受邀调查。', '20:20老板发现怀表不见了。', '林岚', '周澈', '苏禾', '大堂', '厨房', '维修间', '调查中']) {
            if (!visible.includes(text)) throw new Error(`玩家视图缺少：${text}`);
        }
        const dom = await page.evaluate(() => document.documentElement.outerHTML);
        const stored = await page.evaluate(() => {
            const entries = [];
            for (let i = 0; i < localStorage.length; i += 1) {
                const key = localStorage.key(i);
                entries.push([key, localStorage.getItem(key)]);
            }
            return JSON.stringify(entries);
        });
        for (const marker of STORY_MARKERS) {
            if (dom.includes(marker)) throw new Error(`页面 DOM 含 ${marker}`);
            if (stored.includes(marker)) throw new Error(`localStorage 含 ${marker}`);
        }
        if (actorHits.length) throw new Error(`请求了非玩家视图：${actorHits.join(' ')}`);
        if (!playerViews.length) throw new Error('没有请求玩家 ActorView');
        if (modelHits.length) throw new Error(`剧情页调用了模型：${modelHits.join(' ')}`);
        const desktopColumns = await page.locator('.vc-story-cast').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length);
        if (desktopColumns !== 3) throw new Error(`桌面 cast 应为 3 列，实际 ${desktopColumns}`);
        await page.screenshot({ path: path.join(ctx.artifactsDir, 'story-desktop.png') });
        ctx.screenshots.push(path.join(ctx.artifactsDir, 'story-desktop.png'));
        await page.setViewportSize({ width: 390, height: 844 });
        const mobile = await page.locator('.vc-story-cast').evaluate((el) => ({
            columns: getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length,
            overflow: document.querySelector('.vc-story-dialog').scrollWidth <= window.innerWidth,
        }));
        if (mobile.columns !== 1) throw new Error(`390px cast 应为 1 列，实际 ${mobile.columns}`);
        if (!mobile.overflow) throw new Error('390px 剧情页横向溢出');
        await page.screenshot({ path: path.join(ctx.artifactsDir, 'story-mobile.png') });
        ctx.screenshots.push(path.join(ctx.artifactsDir, 'story-mobile.png'));
        if (errors.length) throw new Error(`剧情页出现未捕获错误：${errors.join(' | ')}`);
        return { desktop: true, mobile: true, playerView: true };
        } catch (error) {
            await failShot(error);
        }
    } finally {
        await browser.close();
    }
}

const STORY_PROBE = 'VCW13_PROBE_HARMLESS_81';
const STORY_PUBLIC = 'VCW13_PUBLIC_LORE_HARMLESS 旅馆走廊的灯在雨夜里忽明忽暗。';
const STORY_CARD = 'VCW13_CARD_DESC_NOT_FOR_STORY';
const STORY_GREETING = '这是一次合成测试对话。';
const STORY_FOLLOW = '合成工具后续已核对。';
const STORY_TOOL_RESULT = '已记下公开线索。';
const STORY_LIN_FACT = '19:55把维修柜钥匙借给周澈，并有借用记录。';
const STORY_ZHOU_FACT = '自己把怀表藏在维修柜，钥匙还在自己手里。';
const STORY_FORBIDDEN = [
    ['SU_FACT', '20:13只看见蓝色衣袖进入维修间，没有看清脸。'],
    ['SU_MARKER', 'PRIVATE_SU_WITNESS_57'],
    ['GM_MOTIVE', '周澈因维修报酬争议擅自暂藏怀表。'],
    ['GM_MARKER', 'GM_ONLY_WATCH_TRUTH_92'],
    ['ZHOU_GOAL', '避免承认擅自拿走怀表；证据充分时可归还钥匙。'],
    ['SU_GOAL', '如实提供有限目击信息，不把推测说成亲眼所见。'],
    ['LIN_GOAL', '找回怀表并澄清自己未离开厨房的时间。'],
    ['GM_TIME_LOAN', '林岚把维修柜钥匙借给周澈修灯。'],
    ['GM_TIME_TAKE', '周澈取走怀表并藏在维修柜。'],
    ['GM_TIME_SLEEVE', '苏禾看到蓝色衣袖的人进入维修间，没看清脸。'],
    ['PROBE', STORY_PROBE],
    ['PUBLIC', 'VCW13_PUBLIC_LORE_HARMLESS'],
    ['CARD', STORY_CARD],
    ['GREETING', STORY_GREETING],
];
const STORY_DOM_FORBIDDEN = [
    ['LIN_FACT', STORY_LIN_FACT],
    ['LIN_MARKER', 'PRIVATE_LIN_LOAN_31'],
    ['ZHOU_FACT', STORY_ZHOU_FACT],
    ['ZHOU_MARKER', 'PRIVATE_ZHOU_WATCH_44'],
    ...STORY_FORBIDDEN.filter(([label]) => !['PROBE', 'PUBLIC', 'CARD', 'GREETING'].includes(label)),
];

function storyCanonicalView(view, story) {
    const list = (value) => (Array.isArray(value) ? value : []);
    return JSON.stringify({
        conversationId: typeof view.conversationId === 'string' ? view.conversationId : '',
        runId: view.runId,
        branchId: view.branchId,
        actorId: view.actorId,
        worldVersion: view.worldVersion,
        publicLore: {
            setting: view.publicLore?.setting ?? '',
            locations: list(view.publicLore?.locations),
            knownEvent: view.publicLore?.knownEvent ?? '',
        },
        knowledge: list(view.knowledge).map((item) => ({ id: item?.id ?? '', fact: item?.fact ?? '', marker: item?.marker ?? '' })),
        events: list(view.events).map((item) => ({
            eventId: item?.eventId ?? '', actorId: item?.actorId ?? '', worldVersion: item?.worldVersion ?? 0, body: item?.body ?? {},
        })),
        participants: list(view.participants).map((item) => ({
            actorId: item?.actorId ?? '', name: item?.name ?? '', publicPersona: item?.publicPersona ?? '',
        })),
    });
}

function storySystemText(protocol, body) {
    if (protocol === 'responses') {
        const item = body?.input?.find((entry) => entry?.type === 'message' && entry.role === 'system');
        return typeof item?.content === 'string' ? item.content : '';
    }
    if (protocol === 'anthropic') {
        if (typeof body?.system === 'string') return body.system;
        if (Array.isArray(body?.system)) return body.system.map((block) => (typeof block?.text === 'string' ? block.text : '')).join('');
        return '';
    }
    const message = body?.messages?.find((entry) => entry?.role === 'system');
    return typeof message?.content === 'string' ? message.content : '';
}

async function sceneStoryOutbound(ctx) {
    const report = {
        protocols: {
            OPENAI_CHAT_COMPLETIONS: { requests: 0, assertions: 0 },
            ANTHROPIC_MESSAGES: { requests: 0, assertions: 0 },
            OPENAI_RESPONSES: { requests: 0, assertions: 0 },
        },
        companion: { requests: 0, assertions: 0 },
        negativeSecret: { requests: 0, assertions: 0, rejected: false },
        missingIdentity: { requests: 0, assertions: 0, rejected: false },
        dom: { assertions: 0 },
        reasoningIsolated: false,
    };
    const pass = (bucket, n = 1) => { bucket.assertions += n; };
    const directive = {
        toolOnce: true,
        tool: { name: 'note_clue', argumentsPieces: ['{}'] },
        reasoning: { text: '核对当前问句的字面。', encrypted: true },
        followUpText: STORY_FOLLOW,
    };
    await ctx.fixtureHttp.setOverride('vc03m-tools', directive);
    await ctx.fixtureHttp.setOverride('vc03m-reasoning', directive);
    await bindForeground(ctx, 'vc03m-chat', 'chat-tools', 'vc03m-tools');
    const cardName = `W13 剧情 ${crypto.randomUUID().slice(0, 8)}`;
    const card = {
        name: cardName,
        description: `${STORY_CARD} 合成角色卡说明。`,
        first_mes: STORY_GREETING,
        personality: '',
        scenario: '',
        mes_example: '',
    };
    const form = new FormData();
    form.append('file_type', 'json');
    form.append('avatar', new Blob([JSON.stringify(card)], { type: 'application/json' }), 'synthetic.json');
    const imported = await ctx.st.call('POST', '/api/characters/import', form);
    if (imported.status !== 200 || !imported.json?.file_name) throw new Error(`导入合成卡失败：HTTP ${imported.status}`);
    const avatar = `${imported.json.file_name.replace(/\.png$/, '')}.png`;
    const storyFile = `W13-story-${crypto.randomUUID()}`;
    const companionFile = `W13-companion-${crypto.randomUUID()}`;
    const storyToken = { id: crypto.randomUUID(), revision: 0 };
    const companionToken = { id: crypto.randomUUID(), revision: 0 };
    const saveChat = async (file, chat) => {
        const saved = await ctx.st.call('POST', '/api/chats/save', { avatar_url: avatar, file_name: file, chat });
        if (saved.status !== 200) throw new Error(`保存聊天失败：HTTP ${saved.status}`);
    };
    await saveChat(storyFile, [
        { user_name: 'unused', character_name: cardName, chat_metadata: { vc_f2: storyToken, vc_binding: { mode: 'STORY' } } },
        { name: cardName, is_user: false, mes: STORY_GREETING, swipe_id: 0, swipes: [STORY_GREETING] },
    ]);
    await saveChat(companionFile, [
        { user_name: 'unused', character_name: cardName, chat_metadata: { vc_f2: companionToken } },
        { name: cardName, is_user: false, mes: '这是一个合成陪伴会话。', swipe_id: 0, swipes: ['这是一个合成陪伴会话。'] },
    ]);
    const bookName = `w13-${crypto.randomUUID().slice(0, 8)}`;
    let browser;
    const generates = [];
    const genResponses = [];
    try {
        const { chromium } = await import('playwright-core');
        browser = await chromium.launch({
            headless: true,
            ...(process.env.VC_W03_CHROMIUM_PATH ? { executablePath: process.env.VC_W03_CHROMIUM_PATH } : {}),
        });
        const bc = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        await bc.addCookies([
            { name: 'vc_session', value: ctx.secrets.session.vcSession, url: ST_BASE },
            { name: 'vc_csrf', value: ctx.secrets.session.vcCsrf, url: ST_BASE },
        ]);
        const page = await bc.newPage();
        page.setDefaultTimeout(120000);
        page.on('request', (req) => {
            if (!req.url().includes('/api/backends/chat-completions/generate')) return;
            let body = null;
            try { body = req.postDataJSON(); } catch { body = null; }
            const raw = JSON.stringify(body ?? {});
            generates.push({
                vc_story: body?.vc_story && typeof body.vc_story === 'object' ? {
                    actorId: body.vc_story.actorId ?? null,
                    keys: Object.keys(body.vc_story).sort(),
                    actorIds: Object.prototype.hasOwnProperty.call(body.vc_story, 'actorIds'),
                    chatIdentity: typeof body.vc_story.chatIdentity === 'string' ? body.vc_story.chatIdentity : '',
                    runId: body.vc_story.runId ?? '',
                    branchId: body.vc_story.branchId ?? '',
                    worldVersion: body.vc_story.worldVersion ?? null,
                } : null,
                mode: body?.vc_session_mode ?? '',
                hasProbe: raw.includes(STORY_PROBE),
                hasPublic: raw.includes('VCW13_PUBLIC_LORE_HARMLESS'),
                hasCard: raw.includes(STORY_CARD),
                hasSecret: raw.includes(STORY_ZHOU_FACT),
            });
        });
        page.on('response', (res) => {
            if (!res.url().includes('/api/backends/chat-completions/generate')) return;
            const entry = {
                status: res.status(),
                memory: res.headers()['x-vc-memory-status'] || '',
                errorCode: '',
                fixedReject: false,
                echoedSecret: false,
            };
            genResponses.push(entry);
            res.json().then((json) => {
                const message = typeof json?.error?.message === 'string' ? json.error.message : '';
                entry.errorCode = json?.error?.code || json?.code || '';
                entry.fixedReject = message === '剧情出站核对未通过，已拒绝联系上游';
                entry.echoedSecret = message.includes(STORY_ZHOU_FACT);
            }).catch(() => { /* 成功的流式响应不是 JSON */ });
        });
        const shot = async (name) => {
            const file = path.join(ctx.artifactsDir, name);
            await page.screenshot({ path: file });
            ctx.screenshots.push(file);
        };
        await page.goto(ST_BASE, { waitUntil: 'domcontentloaded' });
        await waitFor(async () => page.evaluate(async () => (await import('/script.js')).settingsReady || Boolean(document.querySelector('dialog[open] .onboarding'))), { timeoutMs: 60000, label: 'ST 设置或欢迎页' });
        const onboarding = page.locator('dialog[open].popup').filter({ has: page.locator('.onboarding') });
        if (await onboarding.count()) {
            await onboarding.locator('textarea').fill('w13-owner');
            await onboarding.locator('.popup-button-ok').click();
            await onboarding.waitFor({ state: 'hidden' });
        }
        await waitFor(async () => page.evaluate(() => document.querySelector('#send_textarea') && document.querySelector('#vc_story_menu_button')), { timeoutMs: 60000, label: '剧情菜单' });
        const openChat = async (file) => {
            await waitFor(async () => page.evaluate((name) => window.SillyTavern.getContext().characters.some((c) => c.avatar === name), avatar), { timeoutMs: 30000, label: '合成角色出现' });
            await page.evaluate(async ({ name, chatFile }) => {
                const native = await import('/script.js');
                const index = native.characters.findIndex((c) => c.avatar === name);
                if (index < 0) throw new Error('合成角色未加载');
                await native.selectCharacterById(index);
                await native.openCharacterChat(chatFile);
            }, { name: avatar, chatFile: file });
        };
        await openChat(storyFile);
        await waitFor(async () => page.evaluate(() => {
            const binding = window.SillyTavern.getContext().chatMetadata?.vc_binding;
            return binding?.mode === 'STORY' && /^[1-9][0-9]{0,18}$/.test(binding.conversationId || '');
        }), { timeoutMs: 30000, label: 'STORY 会话绑定' });
        await waitFor(async () => page.evaluate(() => {
            const oai = window.SillyTavern.getContext().chatCompletionSettings ?? {};
            return String(oai.custom_url ?? '').includes('profile=chat-tools') && Number(oai.openai_max_context) === 8192;
        }), { timeoutMs: 30000, label: 'chat-tools 8192 投影' });
        await page.evaluate(async ({ name, entries }) => {
            const wi = await import('/scripts/world-info.js');
            const data = { entries: {} };
            for (const content of entries) {
                const entry = wi.createWorldInfoEntry(name, data);
                if (!entry) throw new Error('无法创建世界书条目');
                entry.content = content;
                entry.constant = true;
                entry.disable = false;
                entry.selective = false;
                entry.position = 0;
                entry.comment = 'w13';
            }
            await wi.saveWorldInfo(name, data, true);
            await wi.updateWorldInfoList();
            if (!wi.world_names.includes(name)) throw new Error('世界书未进入客户端名单');
            if (typeof globalThis.TavernHelper?.setCurrentCharLorebooks !== 'function') throw new Error('TavernHelper 未就绪');
            await globalThis.TavernHelper.setCurrentCharLorebooks({ primary: name, additional: [] });
            const primary = globalThis.TavernHelper.getCharLorebooks?.().primary;
            const world = window.SillyTavern.getContext().characters[window.SillyTavern.getContext().characterId]?.data?.extensions?.world;
            if (primary !== name || world !== name) throw new Error(`主世界书未绑定：${primary || ''} ${world || ''}`);
        }, { name: bookName, entries: [STORY_PUBLIC, STORY_PROBE] });
        await page.evaluate(async () => {
            const { ToolManager } = await import('/scripts/tool-calling.js');
            ToolManager.registerFunctionTool({
                name: 'note_clue',
                displayName: '记下线索',
                description: '记下一条公开线索',
                parameters: { type: 'object', properties: {}, additionalProperties: false },
                action: async () => '已记下公开线索。',
            });
        });
        const scanSurface = async (label) => {
            const dom = await page.evaluate(() => document.documentElement.outerHTML);
            const stored = await page.evaluate(() => {
                const entries = [];
                for (let i = 0; i < localStorage.length; i += 1) entries.push(localStorage.getItem(localStorage.key(i)) || '');
                return entries.join('\n');
            });
            for (const [name, text] of STORY_DOM_FORBIDDEN) {
                if (dom.includes(text) || stored.includes(text)) throw new Error(`${label} 的页面或 localStorage 含 ${name}`);
                pass(report.dom);
            }
        };
        const openStory = async () => {
            if (await page.locator('.vc-story-dialog[open]').count()) return;
            if (!(await page.locator('#vc_story_menu_button').isVisible())) await page.click('#extensionsMenuButton');
            await page.click('#vc_story_menu_button');
            await page.locator('.vc-story-dialog[open]').waitFor();
        };
        const closeStory = async () => {
            if (!(await page.locator('.vc-story-dialog[open]').count())) return;
            await page.locator('.vc-story-dialog [data-action="close"]').click();
            await waitFor(async () => page.evaluate(() => !document.querySelector('.vc-story-dialog[open]')), { timeoutMs: 10000, label: '关闭剧情页' });
        };
        const selectActor = async (actorId) => {
            await openStory();
            await page.locator(`.vc-story-dialog [data-action="select-actor"][data-actor="${actorId}"]`).click();
            await waitFor(async () => page.evaluate((id) => document.querySelector(`.vc-story-dialog [data-action="select-actor"][data-actor="${id}"]`)?.getAttribute('aria-pressed') === 'true', actorId), { timeoutMs: 10000, label: `选中 ${actorId}` });
            await closeStory();
        };
        const closePanel = async () => {
            const overlay = page.locator('.vcms-overlay');
            if (!(await overlay.isVisible())) return;
            // 保存用途绑定后的 render 会拆掉按钮。脏标记还亮着就去点放弃，按钮会在点击期间被藏起来，默认 120s 一直重试。
            try {
                await waitFor(async () => page.evaluate(() => {
                    const dirty = document.querySelector('#vcms-dirty');
                    return !dirty || dirty.hidden;
                }), { timeoutMs: 8000, label: '模型页无未保存修改' });
            } catch {
                const discard = page.locator('#vcms-discard');
                if (await discard.isVisible()) {
                    await discard.click({ timeout: 5000 });
                    await page.waitForSelector('#vcms-dirty', { state: 'hidden', timeout: 5000 });
                }
            }
            if (!(await overlay.isVisible())) return;
            await page.locator('.vcms-overlay [aria-label="关闭模型设置"]').click();
            await page.waitForSelector('.vcms-overlay', { state: 'hidden', timeout: 10000 });
        };
        const bindProfile = async (optionValue, markerPred) => {
            const count0 = await ctx.fixtureHttp.count();
            if (!(await page.locator('.vcms-overlay').isVisible())) {
                if (!(await page.locator('#vc_models_menu_button').isVisible())) await page.click('#extensionsMenuButton');
                await page.click('#vc_models_menu_button');
                await page.waitForSelector('.vcms-overlay', { state: 'visible', timeout: 10000 });
            }
            await page.click('[data-action="tab"][data-tab="bindings"]');
            await page.selectOption('select[data-bind="binding.FOREGROUND_CHAT"]', optionValue);
            await page.click('[data-action="save-bindings"]');
            await waitFor(async () => {
                const purposes = await ctx.admin.listPurposes();
                const row = purposes.json.find((item) => item.purpose === 'FOREGROUND_CHAT');
                const [providerId, profileKey] = optionValue.split('::');
                return row && row.providerId === providerId && row.profileKey === profileKey && row.status === 'READY';
            }, { timeoutMs: 20000, label: `绑定 ${optionValue}` });
            await waitFor(async () => page.evaluate((pred) => {
                const oai = window.SillyTavern?.getContext?.()?.chatCompletionSettings ?? {};
                return pred.startsWith('reverse:')
                    ? String(oai.reverse_proxy ?? '').includes(pred.slice('reverse:'.length))
                    : String(oai.custom_url ?? '').includes(pred);
            }, markerPred), { timeoutMs: 20000, label: `投影 ${optionValue}` });
            if ((await ctx.fixtureHttp.count()) !== count0) throw new Error(`绑定 ${optionValue} 期间出现上游请求`);
            await closePanel();
        };
        const confirmProxy = async (marker) => {
            const dialog = page.locator('dialog[open].popup').first();
            if (!(await dialog.count())) return false;
            const text = (await dialog.innerText()).replace(/\s+/g, ' ');
            if (marker && !text.includes(marker)) throw new Error('代理确认弹窗目标异常');
            await dialog.locator('.popup-button-ok').click();
            await dialog.waitFor({ state: 'hidden', timeout: 10000 });
            return true;
        };
        const ensureSend = async (proxyMarker) => {
            if (!(await page.locator('#send_but.displayNone').count())) return;
            if (!(await page.locator('#api_button_openai').isVisible())) await page.click('#API-status-top');
            await page.locator('#api_button_openai').click();
            await confirmProxy(proxyMarker);
            await waitFor(async () => page.evaluate(() => {
                const button = document.querySelector('#send_but');
                return Boolean(button && !button.classList.contains('displayNone') && button.offsetParent !== null);
            }), { timeoutMs: 30000, label: '发送按钮可见' });
        };
        // ST 默认关闭 function_calling。不打开时，流式工具增量会被忽略，空文本被当成完成回复。
        const enableFunctionTools = async () => {
            await page.evaluate(async () => {
                const { oai_settings } = await import('/scripts/openai.js');
                oai_settings.function_calling = true;
                const box = document.querySelector('#openai_function_calling');
                if (box instanceof HTMLInputElement) box.checked = true;
            });
        };
        await openStory();
        await page.locator('[data-action="start"]').click();
        await waitFor(async () => page.evaluate(() => {
            const root = document.querySelector('.vc-story');
            return root?.getAttribute('data-state') === 'playing' || Boolean(root?.querySelector('[role="alert"]'));
        }), { timeoutMs: 60000, label: '剧情开局' });
        const storyState = await page.locator('.vc-story').getAttribute('data-state');
        if (storyState !== 'playing') throw new Error('开局未进入玩家视图');
        await scanSurface('开局后');
        await shot('story-outbound-start.png');
        const actors = [
            { id: 'lin', fact: STORY_LIN_FACT, marker: 'PRIVATE_LIN_LOAN_31', otherFact: STORY_ZHOU_FACT, otherMarker: 'PRIVATE_ZHOU_WATCH_44', line: (id) => `林岚，走廊的灯还亮着吗 ${id} ${ctx.scope}` },
            { id: 'zhou', fact: STORY_ZHOU_FACT, marker: 'PRIVATE_ZHOU_WATCH_44', otherFact: STORY_LIN_FACT, otherMarker: 'PRIVATE_LIN_LOAN_31', line: (id) => `周澈，今晚大堂安静吗 ${id} ${ctx.scope}` },
        ];
        const protocols = [
            { id: 'OPENAI_CHAT_COMPLETIONS', option: 'vc03m-chat::chat-tools', marker: 'profile=chat-tools', protocol: 'chat', model: 'vc03m-tools', finalUrl: '/v1/chat/completions' },
            { id: 'OPENAI_RESPONSES', option: 'vc03m-resp::reasoning', marker: 'profile=reasoning', protocol: 'responses', model: 'vc03m-reasoning', finalUrl: '/v1/responses' },
            { id: 'ANTHROPIC_MESSAGES', option: 'vc03m-claude::tools', marker: 'reverse:provider=vc03m-claude', protocol: 'anthropic', model: 'vc03m-tools', finalUrl: '/v1/messages', proxy: 'vc-go://model-purposes/FOREGROUND_CHAT?provider=vc03m-claude' },
        ];
        let linEncrypted = '';
        let proxyArmed = true;
        for (const spec of protocols) {
            await closeStory();
            await bindProfile(spec.option, spec.marker);
            for (const actor of actors) {
                await selectActor(actor.id);
                await ensureSend(proxyArmed ? spec.proxy : undefined);
                await enableFunctionTools();
                const player = actor.line(spec.id);
                const since = (await ctx.fixtureHttp.captures({})).at(-1)?.seq ?? 0;
                const genAt = generates.length;
                const respAt = genResponses.length;
                await page.locator('#send_textarea').fill(player);
                await page.locator('#send_but').click();
                // Claude 的「正在连接代理」在点击发送后才出现。立刻 count() 会漏掉，弹窗挡住后续生成。
                if (proxyArmed && spec.proxy) {
                    const dialog = page.locator('dialog[open].popup').first();
                    await dialog.waitFor({ timeout: 15000 });
                    const text = (await dialog.innerText()).replace(/\s+/g, ' ');
                    if (!text.includes(spec.proxy)) throw new Error('代理确认弹窗目标异常');
                    await dialog.locator('.popup-button-ok').click();
                    await dialog.waitFor({ state: 'hidden', timeout: 10000 });
                    proxyArmed = false;
                }
                try {
                    await waitFor(async () => page.evaluate(({ text, reply }) => {
                        const chat = window.SillyTavern.getContext()?.chat ?? [];
                        const stop = document.querySelector('#mes_stop');
                        const idle = !stop || getComputedStyle(stop).display === 'none';
                        const last = chat[chat.length - 1];
                        return idle && chat.some((message) => message.is_user && message.mes === text) && !last?.is_user && String(last?.mes ?? '').includes(reply);
                    }, { text: player, reply: STORY_FOLLOW }), { timeoutMs: 90000, label: `${spec.id} ${actor.id} 工具后续` });
                } catch (error) {
                    await shot('story-outbound-send-stuck.png');
                    const statuses = genResponses.slice(respAt).map((item) => item.status).join(',');
                    throw new Error(`${spec.id} ${actor.id} 未完成工具后续（generate HTTP ${statuses || '无'}）`);
                }
                const seen = generates.slice(genAt);
                const responses = genResponses.slice(respAt);
                const bucket = report.protocols[spec.id];
                if (seen.length < 2) throw new Error(`${spec.id} ${actor.id} 的 ST 生成请求少于 2`);
                for (const item of seen) {
                    if (!item.hasProbe || !item.hasPublic || !item.hasCard) throw new Error(`${spec.id} ${actor.id} 的生成请求未注入世界书或角色卡`);
                    if (!item.vc_story || item.vc_story.actorIds || item.vc_story.actorId !== actor.id) throw new Error(`${spec.id} ${actor.id} 的 vc_story 不是单个当前 actor`);
                    if (item.vc_story.keys.join(',') !== 'actorId,branchId,chatIdentity,runId,worldVersion') throw new Error(`${spec.id} ${actor.id} 的 vc_story 字段异常`);
                    pass(bucket, 4);
                }
                if (responses.some((item) => item.memory)) throw new Error(`${spec.id} 剧情响应带了记忆槽头`);
                pass(bucket);
                const rows = (await ctx.fixtureHttp.captures({ protocol: spec.protocol, since })).filter((row) => {
                    const raw = JSON.stringify(row.body ?? {});
                    return raw.includes(player) || raw.includes(STORY_TOOL_RESULT);
                });
                if (rows.length !== 2) throw new Error(`${spec.id} ${actor.id} 上游请求数为 ${rows.length}`);
                bucket.requests += rows.length;
                const story = seen[0].vc_story;
                const view = await ctx.admin.call('GET', `/api/v1/story/runs/${encodeURIComponent(story.runId)}/actors/${encodeURIComponent(actor.id)}/view?branchId=${encodeURIComponent(story.branchId)}&worldVersion=${encodeURIComponent(String(story.worldVersion))}`);
                if (view.status !== 200) throw new Error(`${spec.id} ActorView HTTP ${view.status}`);
                const viewText = storyCanonicalView(view.json, { ...story, actorId: actor.id });
                rows.forEach((row, index) => {
                    const raw = JSON.stringify(row.body ?? {});
                    const follow = raw.includes(STORY_TOOL_RESULT);
                    if (Boolean(follow) !== (index === 1)) throw new Error(`${spec.id} ${actor.id} 第 ${index + 1} 个请求的工具记录位置异常`);
                    if (row.finalUrl !== spec.finalUrl || row.body?.model !== spec.model || row.auth?.matched !== true) throw new Error(`${spec.id} 最终 URL、模型或 auth 异常`);
                    if (storySystemText(spec.protocol, row.body) !== viewText) throw new Error(`${spec.id} ${actor.id} 规范视图不一致`);
                    if (!raw.includes(player) || !raw.includes(actor.fact) || !raw.includes(actor.marker)) throw new Error(`${spec.id} ${actor.id} 缺少玩家话语或当前视图`);
                    if (raw.includes(actor.otherFact) || raw.includes(actor.otherMarker) || raw.includes(story.chatIdentity) || raw.includes('vc_story')) throw new Error(`${spec.id} ${actor.id} 混入了其他身份或聊天身份`);
                    for (const [name] of STORY_FORBIDDEN) {
                        if (raw.includes(STORY_FORBIDDEN.find((item) => item[0] === name)[1])) throw new Error(`${spec.id} ${actor.id} 上游含 ${name}`);
                    }
                    if (follow) {
                        if (!raw.includes('note_clue') || !raw.includes(STORY_TOOL_RESULT)) throw new Error(`${spec.id} ${actor.id} 后续轮缺少工具记录`);
                    } else if (raw.includes(STORY_TOOL_RESULT)) throw new Error(`${spec.id} ${actor.id} 首轮含工具结果`);
                    if (spec.protocol === 'responses') {
                        const reasoning = (row.body.input ?? []).filter((item) => item?.type === 'reasoning');
                        if (!follow && reasoning.length !== 0) throw new Error(`${spec.id} ${actor.id} 首轮含 reasoning`);
                        if (follow) {
                            if (reasoning.length !== 1 || typeof reasoning[0].encrypted_content !== 'string' || !reasoning[0].encrypted_content.startsWith('enc-vc03m-')) throw new Error(`${spec.id} ${actor.id} 后续轮 reasoning 异常`);
                            if (actor.id === 'lin') linEncrypted = reasoning[0].encrypted_content;
                            if (actor.id === 'zhou' && (!linEncrypted || reasoning[0].encrypted_content === linEncrypted)) throw new Error('周澈后续轮复用了林岚的 reasoning');
                        }
                    } else if (raw.includes('enc-vc03m-')) throw new Error(`${spec.id} 注入了 Responses reasoning`);
                    if (spec.protocol === 'responses' && row.body.store !== false) throw new Error('Responses store 未关闭');
                    pass(bucket, 8);
                });
                if (spec.id === 'OPENAI_RESPONSES' && actor.id === 'zhou') report.reasoningIsolated = true;
            }
        }
        await scanSurface('三协议发送后');
        await shot('story-outbound-protocols.png');
        await openChat(companionFile);
        await waitFor(async () => page.evaluate(() => {
            const binding = window.SillyTavern.getContext().chatMetadata?.vc_binding;
            return binding?.mode === 'COMPANION' && /^[1-9][0-9]{0,18}$/.test(binding.conversationId || '');
        }), { timeoutMs: 30000, label: 'COMPANION 绑定' });
        await bindProfile('vc03m-chat::chat', 'profile=chat');
        await ensureSend();
        const companionText = `今天只是问一句公开的话 ${ctx.scope}`;
        const companionSince = (await ctx.fixtureHttp.captures({})).at(-1)?.seq ?? 0;
        const companionGen = generates.length;
        const companionResp = genResponses.length;
        await page.locator('#send_textarea').fill(companionText);
        await page.locator('#send_but').click();
        await waitFor(async () => page.evaluate(({ text, reply }) => {
            const chat = window.SillyTavern.getContext()?.chat ?? [];
            const stop = document.querySelector('#mes_stop');
            const idle = !stop || getComputedStyle(stop).display === 'none';
            const last = chat[chat.length - 1];
            return idle && chat.some((message) => message.is_user && message.mes === text) && String(last?.mes ?? '').includes(reply);
        }, { text: companionText, reply: '受管验收的合成回复' }), { timeoutMs: 60000, label: 'COMPANION 回复' });
        const companionRows = (await ctx.fixtureHttp.captures({ protocol: 'chat', since: companionSince })).filter((row) => JSON.stringify(row.body ?? {}).includes(companionText));
        if (companionRows.length !== 1) throw new Error(`COMPANION 上游请求数为 ${companionRows.length}`);
        report.companion.requests = 1;
        const companionRaw = JSON.stringify(companionRows[0].body ?? {});
        if (!companionRaw.includes(STORY_PROBE) || !companionRaw.includes('VCW13_PUBLIC_LORE_HARMLESS') || !companionRaw.includes(STORY_CARD)) throw new Error('COMPANION 未保留世界书或角色卡');
        if (companionRaw.includes('"publicLore"') || companionRaw.includes('PRIVATE_') || companionRaw.includes('GM_ONLY_') || companionRaw.includes(STORY_ZHOU_FACT)) throw new Error('COMPANION 被剧情重写或含私密');
        const companionSeen = generates.slice(companionGen);
        if (companionSeen.length !== 1 || companionSeen[0].vc_story || companionSeen[0].mode === 'STORY') throw new Error('COMPANION 生成请求带了剧情身份');
        const memory = genResponses.slice(companionResp).map((item) => item.memory).find(Boolean);
        if (!['ok', 'skipped', 'disabled'].includes(memory)) throw new Error('COMPANION 未重核记忆槽');
        pass(report.companion, 5);
        await openChat(storyFile);
        await waitFor(async () => page.evaluate(() => window.SillyTavern.getContext().chatMetadata?.vc_binding?.mode === 'STORY'), { timeoutMs: 30000, label: '回到 STORY 聊天' });
        await bindProfile('vc03m-chat::chat-tools', 'profile=chat-tools');
        await page.evaluate(async ({ name, content }) => {
            const wi = await import('/scripts/world-info.js');
            const data = await wi.loadWorldInfo(name);
            const entry = wi.createWorldInfoEntry(name, data);
            if (!entry) throw new Error('无法追加世界书条目');
            entry.content = content;
            entry.constant = true;
            entry.disable = false;
            entry.selective = false;
            entry.position = 0;
            entry.comment = 'w13-negative';
            await wi.saveWorldInfo(name, data, true);
            const editor = document.querySelector('#world_editor_select');
            if (editor) editor.value = '';
        }, { name: bookName, content: STORY_ZHOU_FACT });
        await selectActor('lin');
        await ensureSend();
        const rejectedText = `林岚，这条不该出站 ${ctx.scope}`;
        const rejectedSince = (await ctx.fixtureHttp.captures({})).at(-1)?.seq ?? 0;
        const rejectedGen = generates.length;
        const rejectedResp = genResponses.length;
        await page.locator('#send_textarea').fill(rejectedText);
        await page.locator('#send_but').click();
        await waitFor(async () => genResponses.slice(rejectedResp).some((item) => item.errorCode || item.status < 400) && await page.evaluate(() => {
            const stop = document.querySelector('#mes_stop');
            return !stop || getComputedStyle(stop).display === 'none';
        }), { timeoutMs: 30000, label: '负向回合结束' });
        const rejectedRows = await ctx.fixtureHttp.captures({ since: rejectedSince });
        const rejectedStatus = genResponses.slice(rejectedResp);
        const rejectedError = rejectedStatus.find((item) => item.fixedReject) || rejectedStatus.at(-1);
        if (rejectedRows.length !== 0 || rejectedStatus.some((item) => item.status < 400) || !rejectedError?.fixedReject || rejectedError.errorCode !== 'VC_STORY_OUTBOUND_REJECTED' || rejectedError.echoedSecret) {
            throw new Error(`负向回合上游请求数为 ${rejectedRows.length}，HTTP ${rejectedError?.status || '无'}，错误码 ${rejectedError?.errorCode || '无'}`);
        }
        const rejectedRequest = generates[rejectedGen];
        if (!rejectedRequest?.hasSecret || rejectedRequest.vc_story?.actorId !== 'lin') throw new Error('负向回合没有把世界书私密送进被拒绝的生成请求');
        report.negativeSecret.requests = 0;
        report.negativeSecret.rejected = true;
        pass(report.negativeSecret, 3);
        await scanSurface('负向拒绝后');
        await shot('story-outbound-rejected.png');
        const identitySnap = await bindForeground(ctx, 'vc03m-chat', 'chat-tools', 'vc03m-tools');
        const identitySince = (await ctx.fixtureHttp.captures({})).at(-1)?.seq ?? 0;
        const identity = await ctx.st.generate({
            chat_completion_source: 'custom',
            model: 'vc03m-tools',
            custom_url: identitySnap.marker,
            vc_session_mode: 'STORY',
            messages: [{ role: 'user', content: `缺身份的合成请求 ${ctx.scope}` }],
            max_tokens: 256,
            stream: false,
        });
        const identityRows = await ctx.fixtureHttp.captures({ since: identitySince });
        if (identity.status === 200 || identityRows.length !== 0) throw new Error(`缺 vc_story 的请求未被拒绝或已出站：HTTP ${identity.status} 请求 ${identityRows.length}`);
        const identityCode = identity.json?.error?.code || identity.json?.code;
        if (identityCode !== 'VC_STORY_IDENTITY_REQUIRED') throw new Error(`缺 vc_story 的错误码为 ${identityCode || '无'}`);
        if (String(identity.json?.error?.message || '').includes(STORY_ZHOU_FACT)) throw new Error('缺身份拒绝回显了私密');
        report.missingIdentity.requests = 0;
        report.missingIdentity.rejected = true;
        pass(report.missingIdentity, 3);
        await scanSurface('结束后');
        fs.writeFileSync(path.join(ctx.artifactsDir, 'story-outbound-summary.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
        log.ok(`story-outbound 计数 ${JSON.stringify(report)}`);
        return report;
    } finally {
        await ctx.fixtureHttp.setOverride('vc03m-tools', null);
        await ctx.fixtureHttp.setOverride('vc03m-reasoning', null);
        if (browser) await browser.close();
    }
}

const SCENE_IMPLS = {
    'memorycore-foundation': sceneMemorycoreFoundation,
    'memorycore-native': sceneMemorycoreNative,
    'memory-real-model': sceneMemoryRealModel,
    'memory-real-eval': sceneMemoryRealEval,
    'login-shape': sceneLoginShape,
    'catalog-admin': sceneCatalogAdmin,
    'zero-upstream-on-save': sceneZeroUpstreamOnSave,
    'service-resolve': sceneServiceResolve,
    'e2e-chat': sceneE2eChat,
    'e2e-responses': sceneE2eResponses,
    'e2e-anthropic': sceneE2eAnthropic,
    'tool-round': sceneToolRound,
    'cancel-stream': sceneCancelStream,
    'context-budget': sceneContextBudget,
    'native-drift': sceneNativeDrift,
    'key-revoke': sceneKeyRevoke,
    'revision-conflict': sceneRevisionConflict,
    'continuation-hygiene': sceneContinuationHygiene,
    'ui03-browser': sceneUi03Browser,
    'ui04-browser': sceneUi04Browser,
    'auth-browser': sceneAuthBrowser,
    'f2-native': sceneF2Native,
    'source-native': sceneSourceNative,
    'f2-browser': sceneF2Browser,
    'rights-browser': sceneRightsBrowser,
    'rights-native': sceneRightsNative,
    'memory-browser': sceneMemoryBrowser,
    'story-view-browser': sceneStoryViewBrowser,
    'w10-inbox-notify': sceneInboxNotify,
    'story-outbound': sceneStoryOutbound,
};

async function runFull() {
    const selected = resolveSceneFilter(FILTER);
    if (FILTER && selected.length === 0) {
        log.fail(`--filter 解析为空场景集：${FILTER}`);
        process.exit(2);
    }
    const sceneById = (id) => SCENES.find((s) => s.id === id);
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
            runChecked('go', ['run', '-C', BACKEND, '-mod=vendor', './cmd/companiond', 'migrate'], {
                cwd: REPO_ROOT,
                env: { GOTOOLCHAIN: GO_TOOLCHAIN, GOPROXY: 'off', VC_MIGRATE_DB_DSN: secrets.dsn },
                label: 'companiond migrate（VC_MIGRATE_DB_DSN，DSN 不打印）',
            });
            log.ok('迁移完成（backend/internal/migrate 全量 SQL）');
            // owner binding secret 种子（V27 契约：不属于 migration，由 companiond bootstrap
            // 以应用原生路径 ON CONFLICT 语义写入并校验；缺它则 set_owner_context 全部拒绝，
            // handleSession→AuthenticatorEnabled 会以 ErrOwnerContextRejected→401）
            runChecked('go', ['run', '-C', BACKEND, '-mod=vendor', './cmd/companiond', 'bootstrap'], {
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

        for (const id of selected) {
            const scene = SCENES.find((s) => s.id === id);
            log.info(`场景 ${id}：${scene.title}`);
            const startedAt = Date.now();
            try {
                await SCENE_IMPLS[id](ctx);
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
            resolveSceneFilter(FILTER);
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
