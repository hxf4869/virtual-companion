import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');
const DEPLOY = path.join(ROOT, 'ops/deploy/v2/deploy.sh');
const SUPPORT = path.join(HERE, 'support');
const SECRETS = [
  'canary-host.invalid',
  'super-secret-token-value',
  '203.0.113.10',
  '10.203.44.0/24',
  '/secret/embed-models',
  '/secret/rerank-models',
  'canary-embed-image:secret',
  'unused-passphrase-canary',
  'oldtag11',
];

function git(args) {
  const result = spawnSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

const HEAD = git(['rev-parse', 'HEAD']);
const SHORT = git(['rev-parse', '--short=8', 'HEAD']);

function assertNoSecrets(text) {
  for (const secret of SECRETS) {
    assert.equal(text.includes(secret), false, `输出含有不应出现的值: ${secret}`);
  }
}

function writeCompose(file, { omit = [] } = {}) {
  const lines = [
    'VC_IMAGE_TAG=oldtag11',
    'VC_PUBLIC_HOST=canary-host.invalid',
    'VC_EDGE_SUBNET=10.203.44.0/24',
    'VC_EDGE_INGRESS_IP=203.0.113.10',
    'VC_EMBEDDING_IMAGE=canary-embed-image:secret',
    'VC_EMBEDDING_MODELS_DIR=/secret/embed-models',
    'VC_RERANK_MODELS_DIR=/secret/rerank-models',
    'VC_DB_PASSWORD=super-secret-token-value',
  ].filter((line) => !omit.some((key) => line.startsWith(`${key}=`)));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${lines.join('\n')}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

function prepareServer(tmp, { omit = [], dirty = false } = {}) {
  const source = path.join(tmp, 'opt', 'virtual-companion', 'source');
  const etc = path.join(tmp, 'etc', 'virtual-companion');
  const composeEnv = path.join(etc, 'compose.env');
  const passFile = path.join(etc, 'st-backup.pass');
  const stConfig = path.join(tmp, 'srv', 'virtual-companion', 'config.yaml');
  const backupDir = path.join(tmp, 'backups');
  const previous = path.join(etc, 'vc-image-tag.previous');
  const stMount = path.join(tmp, 'volumes', 'st');
  const mcMount = path.join(tmp, 'volumes', 'memorycore');
  const logs = path.join(tmp, 'logs');
  fs.mkdirSync(logs, { recursive: true });
  fs.mkdirSync(path.join(source, 'backend', 'internal', 'migrate', 'sql'), { recursive: true });
  fs.mkdirSync(path.join(source, 'integrations', 'sillytavern', 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(source, 'ops', 'deploy', 'v2'), { recursive: true });
  fs.writeFileSync(path.join(source, 'backend', 'internal', 'migrate', 'sql', 'V1__a.sql'), '-- a\n');
  fs.writeFileSync(path.join(source, 'backend', 'internal', 'migrate', 'sql', 'V2__b.sql'), '-- b\n');
  fs.writeFileSync(path.join(source, 'ops', 'deploy', 'v2', 'compose.yaml'), 'name: vc-v2\n');
  const orderLog = path.join(logs, 'order.log');
  const backup = `#!/usr/bin/env bash
set -euo pipefail
[ "$#" -eq 3 ]
[ -n "\${VC_ST_BACKUP_PASSPHRASE_FILE:-}" ]
[ -f "\$VC_ST_BACKUP_PASSPHRASE_FILE" ]
[ -n "\${VC_BACKUP_PG_CONTAINER:-}" ]
[ -n "\${VC_MEMORYCORE_DATA_ROOT:-}" ]
printf 'backup\\n' >> ${JSON.stringify(orderLog)}
printf 'ok\\n' > "\$3"
`;
  const backupPath = path.join(source, 'integrations', 'sillytavern', 'scripts', 'backup.sh');
  fs.writeFileSync(backupPath, backup, { mode: 0o755 });
  fs.chmodSync(backupPath, 0o755);
  writeCompose(composeEnv, { omit });
  fs.mkdirSync(etc, { recursive: true });
  fs.writeFileSync(passFile, 'unused-passphrase-canary\n', { mode: 0o600 });
  fs.chmodSync(passFile, 0o600);
  fs.mkdirSync(path.dirname(stConfig), { recursive: true });
  fs.writeFileSync(stConfig, 'config: true\n');
  fs.mkdirSync(stMount, { recursive: true });
  fs.mkdirSync(mcMount, { recursive: true });
  fs.mkdirSync(backupDir, { recursive: true });
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  for (const name of ['docker', 'git']) {
    const src = name === 'docker' ? 'fake-docker.sh' : 'fake-git.sh';
    fs.symlinkSync(path.join(SUPPORT, src), path.join(bin, name));
  }
  const localConfig = path.join(tmp, 'deploy.env');
  fs.writeFileSync(localConfig, [
    'VC_PUBLIC_HOST=canary-host.invalid',
    'VC_DB_PASSWORD=super-secret-token-value',
    'VC_DEPLOY_SSH_ALIAS=from-config-alias',
  ].join('\n') + '\n', { mode: 0o600 });
  return {
    source,
    composeEnv,
    passFile,
    stConfig,
    backupDir,
    previous,
    stMount,
    mcMount,
    bin,
    localConfig,
    orderLog,
    dockerLog: path.join(logs, 'docker.log'),
    gitLog: path.join(logs, 'git.log'),
    uploadLog: path.join(logs, 'upload.log'),
    remoteLog: path.join(logs, 'remote.log'),
    checkoutFile: path.join(logs, 'checkout'),
    dirty,
  };
}

function envFor(server, extra = {}) {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR || os.tmpdir(),
    LANG: 'C',
    VC_DEPLOY_CONFIG: server.localConfig,
    VC_DEPLOY_SSH_ALIAS: 'alias-test',
    VC_DEPLOY_SOURCE_DIR: server.source,
    VC_DEPLOY_COMPOSE_ENV: server.composeEnv,
    VC_DEPLOY_BACKUP_DIR: server.backupDir,
    VC_DEPLOY_BACKUP_PASSPHRASE_FILE: server.passFile,
    VC_DEPLOY_ST_CONFIG: server.stConfig,
    VC_DEPLOY_PREVIOUS_TAG_FILE: server.previous,
    VC_DEPLOY_DOCKER: path.join(server.bin, 'docker'),
    VC_DEPLOY_UPLOAD_RUNNER: path.join(SUPPORT, 'upload-runner.sh'),
    VC_DEPLOY_REMOTE_RUNNER: path.join(SUPPORT, 'remote-runner.sh'),
    VC_DEPLOY_SSH_PYTHON: '/bin/false',
    VC_DEPLOY_SSH_UPLOAD_PY: path.join(path.dirname(server.localConfig), 'ssh_upload.py'),
    VC_DEPLOY_SSH_EXECUTE_PY: path.join(path.dirname(server.localConfig), 'ssh_execute.py'),
    VC_TEST_BIN: server.bin,
    VC_TEST_DOCKER_LOG: server.dockerLog,
    VC_TEST_GIT_LOG: server.gitLog,
    VC_TEST_UPLOAD_LOG: server.uploadLog,
    VC_TEST_REMOTE_LOG: server.remoteLog,
    VC_TEST_ORDER_LOG: server.orderLog,
    VC_TEST_CHECKOUT_FILE: server.checkoutFile,
    VC_TEST_ST_MOUNT: server.stMount,
    VC_TEST_MC_MOUNT: server.mcMount,
    VC_TEST_SCHEMA_LINE: '2 2',
    VC_TEST_GIT_DIRTY: server.dirty ? '1' : '',
    ...extra,
  };
}

function run(args, env) {
  return spawnSync('bash', [DEPLOY, ...args], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
  });
}

test('无提交时打印用法并失败', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-deploy-usage-'));
  const server = prepareServer(tmp);
  const result = run([], envFor(server));
  const text = `${result.stdout}${result.stderr}`;
  assert.notEqual(result.status, 0);
  assert.match(text, /用法/);
  assert.match(text, /deploy\.sh/);
  assert.equal(fs.existsSync(server.remoteLog), false);
  assert.equal(fs.existsSync(server.uploadLog), false);
});

test('未知参数失败且不触网', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-deploy-flag-'));
  const server = prepareServer(tmp);
  const result = run(['--bogus', HEAD], envFor(server));
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /未知参数/);
  assert.equal(fs.existsSync(server.remoteLog), false);
  assert.equal(fs.existsSync(server.uploadLog), false);
});

test('dry-run 只打印步骤且不输出秘密', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-deploy-dry-'));
  const server = prepareServer(tmp);
  const result = run(['--dry-run', HEAD], envFor(server, { VC_TEST_IMAGES_MISSING: '1' }));
  const text = `${result.stdout}${result.stderr}`;
  assert.equal(result.status, 0, text);
  assertNoSecrets(text);
  assert.match(text, /linux\/amd64/);
  assert.match(text, /VC_PUBLIC_HOST=<redacted>/);
  assert.match(text, /ssh_upload\.py/);
  assert.match(text, /--resume/);
  assert.match(text, /alias-test/);
  assert.match(text, /docker load/);
  assert.match(text, /backup\.sh/);
  assert.match(text, /git fetch -q "\$VC_SRC_BUNDLE"/);
  // 服务器访问 GitHub 不稳定，源码只从随部署上传的 bundle 取。
  assert.doesNotMatch(text, /git fetch origin/);
  assert.match(text, /psql -U vc_migrator/);
  assert.match(text, /checkout/);
  assert.match(text, /VC_IMAGE_TAG/);
  assert.match(text, /config -q/);
  assert.match(text, /--force-recreate/);
  assert.match(text, /--wait/);
  assert.equal(fs.existsSync(server.remoteLog), false);
  assert.equal(fs.existsSync(server.uploadLog), false);
  const dockerLog = fs.readFileSync(server.dockerLog, 'utf8');
  for (const line of dockerLog.split('\n').filter(Boolean)) {
    assert.match(line, /^image inspect /);
  }
  assert.doesNotMatch(dockerLog, /buildx/);
  assert.doesNotMatch(dockerLog, /save/);
});

test('已有同标签镜像时跳过构建', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-deploy-skip-'));
  const server = prepareServer(tmp);
  const result = run(['--dry-run', '--skip-build', HEAD], envFor(server));
  const text = `${result.stdout}${result.stderr}`;
  assert.equal(result.status, 0, text);
  assertNoSecrets(text);
  assert.match(text, new RegExp(`跳过构建 virtual-companion-st:${SHORT}`));
  assert.match(text, new RegExp(`跳过构建 virtual-companion-runtime:${SHORT}`));
  assert.doesNotMatch(text, /buildx build/);
  assert.equal(fs.existsSync(server.remoteLog), false);
});

test('--skip-build 在镜像缺失时停止且不上传', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-deploy-missing-image-'));
  const server = prepareServer(tmp);
  const result = run(['--skip-build', HEAD], envFor(server, { VC_TEST_IMAGES_MISSING: '1' }));
  const text = `${result.stdout}${result.stderr}`;
  assert.notEqual(result.status, 0);
  assert.match(text, /缺少镜像/);
  assert.match(text, /virtual-companion-st:/);
  assert.match(text, /virtual-companion-runtime:/);
  assert.equal(fs.existsSync(server.uploadLog), false);
  assert.equal(fs.existsSync(server.remoteLog), false);
  assertNoSecrets(text);
});

test('compose.env 缺变量时停在升级前且不输出值', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-deploy-missing-var-'));
  const server = prepareServer(tmp, { omit: ['VC_EDGE_SUBNET', 'VC_RERANK_MODELS_DIR'] });
  const before = fs.readFileSync(server.composeEnv, 'utf8');
  const result = run(['--skip-build', HEAD], envFor(server));
  const text = `${result.stdout}${result.stderr}`;
  assert.notEqual(result.status, 0, text);
  assert.match(text, /缺少变量/);
  assert.match(text, /VC_EDGE_SUBNET/);
  assert.match(text, /VC_RERANK_MODELS_DIR/);
  assertNoSecrets(text);
  assert.equal(fs.readFileSync(server.composeEnv, 'utf8'), before);
  assert.equal(fs.existsSync(server.previous), false);
  assert.equal(fs.readFileSync(server.checkoutFile, 'utf8').trim(), HEAD);
  const dockerLog = fs.existsSync(server.dockerLog) ? fs.readFileSync(server.dockerLog, 'utf8') : '';
  assert.doesNotMatch(dockerLog, / up /);
  const order = fs.readFileSync(server.orderLog, 'utf8').trim().split('\n');
  assert.deepEqual(order, ['load', HEAD, 'backup']);
});

test('本机替身跑通完整流程', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-deploy-full-'));
  const server = prepareServer(tmp);
  const beforeLines = fs.readFileSync(server.composeEnv, 'utf8').split('\n');
  const result = run(['--skip-build', HEAD], envFor(server));
  const text = `${result.stdout}${result.stderr}`;
  assert.equal(result.status, 0, text);
  assertNoSecrets(text);
  assert.match(text, /容器健康: ok/);
  assert.match(text, /迁移: 2 个，最新 V2/);
  assert.match(text, /Go health: UP/);
  assert.match(text, /MemoryCore readyz: ready/);
  assert.match(text, /ST 登录页: ok/);
  assert.match(text, /重排: ok/);
  assert.match(text, /向量: ok/);
  assert.match(text, new RegExp(SHORT));
  const afterLines = fs.readFileSync(server.composeEnv, 'utf8').split('\n');
  assert.deepEqual(
    afterLines.filter((line) => !line.startsWith('VC_IMAGE_TAG=')),
    beforeLines.filter((line) => !line.startsWith('VC_IMAGE_TAG=')),
  );
  assert.match(fs.readFileSync(server.composeEnv, 'utf8'), new RegExp(`^VC_IMAGE_TAG=${SHORT}$`, 'm'));
  assert.equal(fs.readFileSync(server.previous, 'utf8'), 'oldtag11\n');
  assert.equal(fs.statSync(server.previous).mode & 0o777, 0o600);
  assert.equal(fs.statSync(server.composeEnv).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(server.checkoutFile, 'utf8').trim(), HEAD);
  const order = fs.readFileSync(server.orderLog, 'utf8').trim().split('\n');
  assert.deepEqual(order, ['load', HEAD, 'backup', 'up']);
  const dockerLog = fs.readFileSync(server.dockerLog, 'utf8');
  assert.equal(dockerLog.split('\n').filter((line) => line.includes(' up ')).length, 1);
  assert.match(dockerLog, /--force-recreate/);
  assert.match(dockerLog, /--wait/);
  assert.match(dockerLog, /config -q|config$/m);
  assert.doesNotMatch(dockerLog, /buildx/);
  const upload = fs.readFileSync(server.uploadLog, 'utf8');
  assert.match(upload, /alias-test/);
  assert.doesNotMatch(text, /ssh /);
  assert.doesNotMatch(text, /\bscp\b/);
});

test('验收失败时打印回退命令且不自动回退', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-deploy-fail-'));
  const server = prepareServer(tmp);
  const result = run(['--skip-build', HEAD], envFor(server, { VC_TEST_FAIL_CHECK: 'runtime' }));
  const text = `${result.stdout}${result.stderr}`;
  assert.notEqual(result.status, 0);
  assertNoSecrets(text);
  assert.match(text, /回退/);
  assert.match(text, /VC_IMAGE_TAG/);
  assert.match(text, /--force-recreate/);
  assert.match(text, /--wait/);
  assert.match(text, /未自动回退/);
  assert.match(fs.readFileSync(server.composeEnv, 'utf8'), new RegExp(`^VC_IMAGE_TAG=${SHORT}$`, 'm'));
  assert.equal(fs.readFileSync(server.previous, 'utf8'), 'oldtag11\n');
  const dockerLog = fs.readFileSync(server.dockerLog, 'utf8');
  assert.equal(dockerLog.split('\n').filter((line) => line.includes(' up ')).length, 1);
});

test('工作区不干净时停止且不改 VC_IMAGE_TAG', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-deploy-dirty-'));
  const server = prepareServer(tmp, { dirty: true });
  const before = fs.readFileSync(server.composeEnv, 'utf8');
  const result = run(['--skip-build', HEAD], envFor(server));
  const text = `${result.stdout}${result.stderr}`;
  assert.notEqual(result.status, 0);
  assert.match(text, /工作区不干净/);
  assertNoSecrets(text);
  assert.equal(fs.readFileSync(server.composeEnv, 'utf8'), before);
  assert.equal(fs.existsSync(server.previous), false);
  const dockerLog = fs.readFileSync(server.dockerLog, 'utf8');
  assert.doesNotMatch(dockerLog, / up /);
});

test('README 说明一条命令部署', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'ops/deploy/v2/README.md'), 'utf8');
  assert.match(readme, /## 一条命令部署/);
  assert.match(readme, /bash ops\/deploy\/v2\/deploy\.sh <提交>/);
  assert.match(readme, /--dry-run/);
  assert.match(readme, /--skip-build/);
});

test('脚本不调用裸 ssh 或 scp', () => {
  const files = [
    DEPLOY,
    path.join(ROOT, 'ops/deploy/v2/lib/deploy-lib.sh'),
    path.join(ROOT, 'ops/deploy/v2/lib/remote-deploy.sh'),
  ];
  const text = files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  assert.doesNotMatch(text, /(^|[\n;&|`(])\s*ssh\s/m);
  assert.doesNotMatch(text, /(^|[\n;&|`(])\s*scp\s/m);
  assert.match(text, /ssh_upload\.py/);
  assert.match(text, /ssh_execute\.py/);
  assert.match(text, /--resume/);
});
