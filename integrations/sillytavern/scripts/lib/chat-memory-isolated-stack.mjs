import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { instrumentEvaluationBuild } from './chat-memory-observation-build.mjs';
import { createGoAdminClient, createStClient, waitFor } from '../managed-lib.mjs';
import { RERANK_GGUF, RERANK_IMAGE } from '../../memorycore-service/rerank.mjs';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const INTEG = 'integrations/sillytavern';
const COMPOSE = 'ops/deploy/v2/compose.yaml';
const MINIO = 'virtual-companion-minio:local';
const EMBEDDING = 'ollama/ollama:0.33.2';
const EMBEDDING_MODEL = 'qwen3-embedding:0.6b';
const METER_PROXY_PORT = 18882;
const OWNER = '424242';
const SECOND = '424243';
const JUDGE = '424244';
const JUDGE_HANDLE = 'vc-cm3-judge';
const UPSTREAM = ['SillyTavern', 'JS-Slash-Runner', 'ST-Prompt-Template', 'MagVarUpdate', 'TencentDB-Agent-Memory'];
const SHARED_MODELS = { embedding: 'vc-local-dev-embedding-1', rerank: 'vc-local-dev-rerank-1' };
const DOCKER_ENV = Object.fromEntries(['PATH', 'HOME', 'USER', 'TMPDIR', 'DOCKER_CONFIG']
    .filter(key => process.env[key]).map(key => [key, process.env[key]]));
const CODES = new Set([
    'ISOLATION_INPUT_INVALID', 'ISOLATION_MODEL_CACHE_MISSING', 'ISOLATION_SOURCE_NOT_READY',
    'ISOLATION_CONFIG_FAILED', 'ISOLATION_IMAGE_BUILD_FAILED', 'ISOLATION_START_FAILED',
    'ISOLATION_MINIO_INIT_FAILED', 'ISOLATION_ST_PROFILE_FAILED',
    'ISOLATION_METER_UNREACHABLE', 'ISOLATION_SYNTHETIC_AUTH_FAILED', 'ISOLATION_EVALUATION_FAILED',
    'ISOLATION_INTERRUPTED', 'ISOLATION_CLEANUP_FAILED', 'CONFIG_NOT_READY',
    'BUDGET_STOP', 'BUDGET_LOCKED', 'BUDGET_SNAPSHOT_MISMATCH',
]);
const fail = code => new Error(code);

function run(command, args, { code, env = DOCKER_ENV, input } = {}) {
    const result = spawnSync(command, args, { cwd: ROOT, env, input, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'ignore'] });
    if (result.status !== 0) throw fail(code);
    return result.stdout.trim();
}

function docker(args, options) {
    return run('docker', ['--context', 'orbstack', ...args], options);
}

function runCompose(args, signal, code) {
    return new Promise((resolve, reject) => {
        if (signal.aborted) return reject(fail('ISOLATION_INTERRUPTED'));
        const child = spawn('docker', ['--context', 'orbstack', ...args], {
            cwd: ROOT, env: DOCKER_ENV, stdio: 'ignore', detached: true,
        });
        // Stop the Compose plugin as well as the docker CLI before teardown.
        const interrupt = () => {
            if (child.pid) {
                try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already exited */ }
            }
        };
        signal.addEventListener('abort', interrupt, { once: true });
        child.on('error', () => {});
        child.once('close', status => {
            signal.removeEventListener('abort', interrupt);
            if (signal.aborted) return reject(fail('ISOLATION_INTERRUPTED'));
            if (status !== 0) return reject(fail(code));
            resolve();
        });
    });
}

function privateWrite(file, content) {
    fs.writeFileSync(file, content, { mode: 0o600 });
}

function freePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            server.close(() => resolve(port));
        });
    });
}

function cachedModels() {
    const code = 'ISOLATION_MODEL_CACHE_MISSING';
    const mounts = Object.fromEntries(Object.entries(SHARED_MODELS).map(([role, name]) => {
        // Inspect only model mounts; the shared services' environment is private.
        const all = JSON.parse(docker(['inspect', '--format', '{{json .Mounts}}', name], { code }));
        return [role, all.find(mount => mount.Destination === '/models' && mount.RW === false)];
    }));
    if (mounts.embedding?.Type !== 'volume' || mounts.rerank?.Type !== 'bind') throw fail(code);
    const gguf = fs.statSync(path.join(mounts.rerank.Source, RERANK_GGUF.file), { throwIfNoEntry: false });
    if (!gguf?.isFile() || gguf.size !== RERANK_GGUF.bytes) throw fail(code);
    for (const image of [EMBEDDING, RERANK_IMAGE, MINIO]) docker(['image', 'inspect', '--format', '{{.Id}}', image], { code });
    return { volume: mounts.embedding.Name, rerankDir: mounts.rerank.Source };
}

function buildContext(directory) {
    const code = 'ISOLATION_SOURCE_NOT_READY';
    const wanted = [`${INTEG}/package.json`, `${INTEG}/package-lock.json`, `${INTEG}/upstream.lock.json`, `${INTEG}/vendor.lock.json`,
        ...['desktop-ui', 'scripts', 'patches', 'server-plugin', 'extension', 'memorycore-service'].map(part => `${INTEG}/${part}`),
        'infra/db/backup/vc_aead.py', 'ops/deploy/v2/Dockerfile.st', 'backend/Dockerfile',
        'backend/go.mod', 'backend/go.sum', 'backend/cmd', 'backend/internal', 'backend/vendor'];
    const source = run('git', ['ls-files', '-z', '--', ...wanted], { code }).split('\0').filter(Boolean);
    for (const file of source) {
        const from = path.join(ROOT, file);
        const to = path.join(directory, file);
        if (!fs.lstatSync(from, { throwIfNoEntry: false })?.isFile()) continue;
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(from, to, fs.constants.COPYFILE_FICLONE);
    }
    const currentUpstream = path.join(ROOT, INTEG, 'upstream');
    const common = run('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { code });
    const upstream = fs.existsSync(currentUpstream) ? currentUpstream : path.join(path.dirname(common), INTEG, 'upstream');
    for (const name of UPSTREAM) {
        const from = path.join(upstream, name);
        const to = path.join(directory, INTEG, 'upstream', name);
        run('git', ['clone', '--quiet', '--depth=1', '--no-tags', '--no-local', from, to], { code });
    }
}

function proxyConfiguration(goPort, enginePort, meterPort) {
    const base = fs.readFileSync(path.join(ROOT, 'ops/deploy/v2/ingress.conf'), 'utf8')
        .replace('X-Forwarded-Proto https;', 'X-Forwarded-Proto $scheme;');
    // Dedicated listeners for the host evaluator and the isolated provider
    // route. The meter listener is only reachable inside this namespace.
    const extras = [
        [goPort, '127.0.0.1:8095'],
        [enginePort, '127.0.0.1:8754'],
        [`127.0.0.1:${METER_PROXY_PORT}`, `host.docker.internal:${meterPort}`],
    ].map(([port, upstream]) => `
    server {
        listen ${port};
        client_max_body_size 32m;${port === goPort ? `
        location = /cm-engine-observations {
            proxy_pass http://127.0.0.1:8756/observations;
        }
        location = /cm-engine-control {
            proxy_pass http://127.0.0.1:8756/control/forget;
        }` : ''}
        location / {
            proxy_pass http://${upstream};
            proxy_http_version 1.1;
            proxy_set_header Connection "";
            proxy_buffering off;
            proxy_request_buffering off;
            proxy_read_timeout 300s;
        }
    }`).join('\n');
    return base.replace(/}\s*$/, `${extras}\n}\n`);
}

function overrideConfiguration({ project, round, state, context, stPort, goPort, enginePort }) {
    const logging = '    logging: {driver: none, options: !reset {}}';
    return `services:
  ingress:
    container_name: ${project}-ingress
    networks: !override {edge: {}, backend: {}}
    ports: !override
      - "127.0.0.1:${stPort}:8080"
      - "127.0.0.1:${goPort}:18095"
      - "127.0.0.1:${enginePort}:18754"
${logging}
  db:
    healthcheck:
      test: [CMD, pg_isready, -h, 127.0.0.1, -p, "5432", -U, vc_migrator, -d, vc]
${logging}
  migrate:
    build: {context: ${JSON.stringify(path.join(context, 'backend'))}, dockerfile: Dockerfile}
${logging}
  bootstrap:
    build: {context: ${JSON.stringify(path.join(context, 'backend'))}, dockerfile: Dockerfile}
    environment:
      VC_ADMIN_SEED_USERNAME: ""
      VC_ADMIN_SEED_PASSWORD: ""
      VC_ADMIN_SEED_DISPLAY_NAME: ""
${logging}
  minio:
    build: !reset null
${logging}
  minio-init:
${logging}
  runtime:
    build: {context: ${JSON.stringify(path.join(context, 'backend'))}, dockerfile: Dockerfile}
    depends_on: !override
      ingress: {condition: service_started}
      bootstrap: {condition: service_completed_successfully}
      minio-init: {condition: service_completed_successfully}
      engine-observer: {condition: service_started}
    environment: !override
      VC_MEMORYCORE_BASE_URL: "http://127.0.0.1:8756"
      VC_PROVIDER_ENABLED: "false"
      VC_PROVIDER_ALLOW_LOOPBACK_HTTP: "true"
      VC_MONTHLY_COST_LIMIT: "10000000"
      VC_BUDGET_MAX_RESERVED_COST: "1000000"
${logging}
  embedding:
${logging}
  rerank:
${logging}
  memorycore:
${logging}
  st:
    volumes: !override
      - st-data:/srv/vc-managed/data
      - ${JSON.stringify(state + '/config.yaml:/srv/vc-managed/config.yaml')}
${logging}
  engine-observer:
    image: virtual-companion-st:${project}
    user: "1000:1000"
    init: true
    network_mode: service:ingress
    read_only: true
    cap_drop: [ALL]
    command: [node, /opt/cm3/engine-proxy.mjs]
    env_file:
      - path: ${JSON.stringify(state + '/engine-observer.env')}
        format: raw
    volumes:
      - ${JSON.stringify(state + '/engine-proxy.mjs:/opt/cm3/engine-proxy.mjs:ro')}
    depends_on:
      ingress: {condition: service_started}
${logging}
  voice-fixture:
    profiles: ["unused"]
${logging}
networks:
  edge:
    name: ${project}-edge
    ipam: !reset null
    labels: {com.vc.cm3.round: ${round}}
  backend:
    labels: {com.vc.cm3.round: ${round}}
volumes:
${['db-data', 'minio-data', 'st-data', 'memorycore-data'].map(name => `  ${name}:
    labels: {com.vc.cm3.round: ${round}}`).join('\n')}
`.replace(/^(  (?:ingress|db|migrate|bootstrap|minio|minio-init|runtime|embedding|rerank|memorycore|st|engine-observer|voice-fixture):)$/gm,
        `$1\n    labels: {com.vc.cm3.round: ${round}}`);
}

function lifecycleSignal(external) {
    const controller = new AbortController();
    const interrupt = () => controller.abort(fail('ISOLATION_INTERRUPTED'));
    if (external?.aborted) interrupt();
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', interrupt);
    external?.addEventListener('abort', interrupt, { once: true });
    return {
        signal: controller.signal,
        remove() {
            process.off('SIGINT', interrupt);
            process.off('SIGTERM', interrupt);
            external?.removeEventListener('abort', interrupt);
        },
    };
}

async function withSignal(signal, evaluate, context) {
    signal.throwIfAborted();
    // The callback owns cancellable requests/checkpoints. Let it unwind before
    // deleting its containers or racing the final artifact writer.
    const result = await evaluate(context);
    signal.throwIfAborted();
    return result;
}

function verifyCleanupOwnership(project, round) {
    const code = 'ISOLATION_CLEANUP_FAILED';
    const filter = `label=com.docker.compose.project=${project}`;
    const format = 'round={{.Label "com.vc.cm3.round"}}';
    for (const args of [['ps', '-a'], ['network', 'ls'], ['volume', 'ls']]) {
        const labels = docker([...args, '--filter', filter, '--format', format], { code });
        if (labels && labels.split('\n').some(label => label !== `round=${round}`)) throw fail(code);
    }
}

function removeImages(project) {
    for (const name of ['st', 'runtime'].map(type => `virtual-companion-${type}:${project}`)) {
        const inspected = spawnSync('docker', ['--context', 'orbstack', 'image', 'inspect', '--format', '{{.Id}}', name],
            { env: DOCKER_ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        if (inspected.status !== 0) continue;
        const code = 'ISOLATION_CLEANUP_FAILED';
        const references = docker(['ps', '-aq', '--filter', `ancestor=${inspected.stdout.trim()}`], { code });
        if (references) {
            const tags = JSON.parse(docker(['image', 'inspect', '--format', '{{json .RepoTags}}', name], { code }));
            if (!tags.some(tag => tag !== name)) throw fail(code);
        }
        docker(['image', 'rm', '--no-prune', name], { code });
    }
}

/** Disposable Compose project. The host meter retains upstream secrets. */
export async function withIsolatedChatMemoryStack({ round, meterPort, signal: externalSignal } = {}, evaluate) {
    if (!/^round-[a-z0-9-]{1,80}$/.test(round || '') || !Number.isInteger(meterPort) ||
        meterPort < 1 || meterPort > 65535 || typeof evaluate !== 'function') throw fail('ISOLATION_INPUT_INVALID');
    const project = `vc-cm3-${crypto.randomBytes(8).toString('hex')}`;
    const { signal, remove } = lifecycleSignal(externalSignal);
    let stage = 'ISOLATION_CONFIG_FAILED';
    let state;
    let compose;
    let readyToClean = false;
    try {
        signal.throwIfAborted();
        state = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-cm3-'));
        stage = 'ISOLATION_MODEL_CACHE_MISSING';
        const models = cachedModels();
        stage = 'ISOLATION_SOURCE_NOT_READY';
        const context = path.join(state, 'context');
        fs.copyFileSync(fileURLToPath(new URL('./chat-memory-engine-proxy.mjs', import.meta.url)), path.join(state, 'engine-proxy.mjs'));
        fs.chmodSync(path.join(state, 'engine-proxy.mjs'), 0o644);
        buildContext(context);
        instrumentEvaluationBuild(context);
        signal.throwIfAborted();
        stage = 'ISOLATION_CONFIG_FAILED';
        const stPort = await freePort(), goPort = await freePort(), enginePort = await freePort();
        if (new Set([stPort, goPort, enginePort, meterPort]).size !== 4) throw fail(stage);
        const goBase = `http://127.0.0.1:${goPort}`, stBase = `http://127.0.0.1:${stPort}`;
        const engineBase = `http://127.0.0.1:${enginePort}`;
        const meterBase = `http://127.0.0.1:${METER_PROXY_PORT}`;
        const opts = { code: stage, env: { ...DOCKER_ENV, STATE: state, VC_LOCAL_HTTP_PORT: String(stPort) } };
        run('bash', ['-e', '-c', 'source "$1"; init_secrets; write_config', 'cm3', path.join(ROOT, 'scripts/local/lib.sh')], opts);
        fs.appendFileSync(path.join(state, 'st.env'), `\nVC_ST_ACCOUNT_HANDLES={"${OWNER}":"default-user","${SECOND}":"vc-w05-second","${JUDGE}":"${JUDGE_HANDLE}"}\n`);
        fs.appendFileSync(path.join(state, 'st.env'), 'VC_ST_GO_TIMEOUT_MS=30000\n');
        const memoryEnv = fs.readFileSync(path.join(state, 'memorycore.env'), 'utf8');
        const memoryToken = /^VC_MEMORYCORE_SERVICE_TOKEN=([a-f0-9]+)$/m.exec(memoryEnv)?.[1];
        if (!memoryToken) throw fail(stage);
        privateWrite(path.join(state, 'engine-observer.env'), `VC_MEMORYCORE_SERVICE_TOKEN=${memoryToken}\n`);
        privateWrite(path.join(state, 'ingress.conf'), proxyConfiguration(18095, 18754, meterPort));
        fs.chmodSync(path.join(state, 'ingress.conf'), 0o644); // nginx runs as 101; the enclosing host directory is private.
        const cm3Override = path.join(state, 'compose.cm3.yaml');
        privateWrite(cm3Override, overrideConfiguration({ project, round, state, context, stPort, goPort, enginePort }));
        const vars = {
            VC_IMAGE_TAG: project, VC_PUBLIC_HOST: '127.0.0.1',
            VC_EDGE_SUBNET: '172.31.219.0/24', VC_EDGE_INGRESS_IP: '172.31.219.10',
            VC_LOCAL_STATE: state, VC_REPO_ROOT: ROOT, VC_ST_BUILD_CONTEXT: context,
            VC_LOCAL_HTTP_PORT: stPort, VC_EMBEDDING_IMAGE: EMBEDDING, VC_EMBEDDING_MODELS_DIR: '/var/empty',
            VC_EMBEDDING_VOLUME: models.volume, VC_EMBEDDING_SUBPATH: 'models', VC_RERANK_MODELS_DIR: models.rerankDir,
        };
        const envFile = path.join(state, 'compose.env');
        privateWrite(envFile, Object.entries(vars).map(([key, value]) => `${key}=${JSON.stringify(String(value))}\n`).join(''));
        compose = ['compose', '--project-name', project, '--env-file', envFile,
            '-f', path.join(ROOT, COMPOSE), '-f', path.join(ROOT, 'ops/local/compose.override.yaml'), '-f', cm3Override];
        const resolved = JSON.parse(docker([...compose, 'config', '--format', 'json'], { code: stage }));
        if (resolved.name !== project || resolved.networks.edge.name !== `${project}-edge` ||
            resolved.services.ingress.container_name !== `${project}-ingress` ||
            resolved.volumes['local-embedding-models'].external !== true ||
            Object.values(resolved.services).some(service => service.logging?.driver !== 'none' ||
                service.labels?.['com.vc.cm3.round'] !== round) ||
            resolved.services.embedding.volumes[0].read_only !== true || resolved.services.rerank.volumes[0].read_only !== true ||
            ['db-data', 'minio-data', 'st-data', 'memorycore-data'].some(name =>
                resolved.volumes[name]?.name !== `${project}_${name}` ||
                resolved.volumes[name]?.labels?.['com.vc.cm3.round'] !== round)) throw fail(stage);
        readyToClean = true;
        stage = 'ISOLATION_IMAGE_BUILD_FAILED';
        for (const dockerfile of ['backend/Dockerfile', 'ops/deploy/v2/Dockerfile.st']) {
            const source = fs.readFileSync(path.join(context, dockerfile), 'utf8');
            for (const [, image] of source.matchAll(/^FROM (\S+)/gm)) {
                docker(['image', 'inspect', '--format', '{{.Id}}', image], { code: stage });
            }
        }
        await runCompose([...compose, 'build', 'runtime', 'st'], signal, stage);
        stage = 'ISOLATION_START_FAILED';
        const command = (args, input) => docker([...compose, ...args], { code: stage, input });
        const up = services => runCompose([...compose, 'up', '-d', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '120', ...services], signal, stage);
        stage = 'ISOLATION_MINIO_INIT_FAILED';
        command(['run', '--no-deps', '--pull', 'never', '--rm', '--user', '0', '--cap-add', 'CHOWN', '--entrypoint', 'chown', 'minio', '1000:1000', '/data']);
        stage = 'ISOLATION_START_FAILED';
        await up(['ingress']);
        stage = 'ISOLATION_ST_PROFILE_FAILED';
        const { seedManagedProfiles, seedSyntheticOwner } = await import('../accept-managed.mjs');
        const profileSetup = `import fs from 'node:fs'; import path from 'node:path'; import {createRequire} from 'node:module';
await (${seedManagedProfiles.toString()})('/srv/vc-managed/data','/opt/vc/${INTEG}/upstream/SillyTavern',null,'${JUDGE_HANDLE}');`;
        command(['run', '--no-deps', '--pull', 'never', '--rm', 'st', 'node', '--input-type=module', '-e', profileSetup]);
        stage = 'ISOLATION_START_FAILED';
        await up(['st']);
        stage = 'ISOLATION_METER_UNREACHABLE';
        // The host meter shares this Node event loop. A synchronous docker
        // exec here would block its response and turn a valid route into a timeout.
        await runCompose([...compose, 'exec', '-T', 'st', 'node', '-e',
            `fetch('${meterBase}/__cm3_relay_probe', {signal:AbortSignal.timeout(5000)}).then(r=>process.exit(r.status < 500 ? 0 : 1)).catch(()=>process.exit(1))`], signal, stage);
        stage = 'ISOLATION_MODEL_CACHE_MISSING';
        command(['exec', '-T', 'st', 'node', '-e',
            "fetch('http://127.0.0.1:11439/health',{signal:AbortSignal.timeout(5000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]);
        const embeddingModel = JSON.parse(command(['exec', '-T', 'st', 'node', '-e',
            `fetch('http://127.0.0.1:11438/api/tags',{signal:AbortSignal.timeout(5000)}).then(r=>r.json()).then(b=>console.log(JSON.stringify(b.models.find(m=>m.name===${JSON.stringify(EMBEDDING_MODEL)})??null))).catch(()=>process.exit(1))`]));
        if (embeddingModel?.name !== EMBEDDING_MODEL || !/^(sha256:)?[0-9a-f]{64}$/.test(embeddingModel.digest)) throw fail(stage);

        stage = 'ISOLATION_SYNTHETIC_AUTH_FAILED';
        const psql = sql => command(['exec', '-T', 'db', 'psql', '-U', 'vc_migrator', '-d', 'vc', '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A'], sql);
        const secrets = {};
        await seedSyntheticOwner(secrets, { sql: psql, ownerId: OWNER, secondId: SECOND, judgeId: JUDGE, goBase, stBase, secondSession: true });
        async function client(session) {
            const admin = createGoAdminClient({ baseUrl: goBase, origin: stBase, session });
            for (const consentType of ['SERVICE_TERMS', 'PRIVACY_POLICY', 'AI_CONTENT_NOTICE', 'THIRD_PARTY_MODEL_PROCESSING', 'SENSITIVE_DATA_PROCESSING']) {
                const { ok } = await admin.call('PUT', '/api/v1/consents', { consentType, version: 'accept-managed', granted: true });
                if (!ok) throw fail(stage);
            }
            const st = createStClient({ baseUrl: stBase, expectedIdentity: session,
                extraCookies: `vc_session=${session.vcSession}; vc_csrf=${session.vcCsrf}` });
            return { admin, st, session, password: secrets.password };
        }
        const owner = await client(secrets.session);
        const second = await client(secrets.secondSession);
        const judge = await client(secrets.judgeSession);
        const readEngineObservations = async (after = 0) => {
            const response = await fetch(`${goBase}/cm-engine-observations?after=${encodeURIComponent(after)}`, {
                headers: { authorization: `Bearer ${memoryToken}` }, signal, redirect: 'error',
            });
            if (!response.ok) throw fail('ISOLATION_EVALUATION_FAILED');
            return response.json();
        };
        const setForgetHold = async recordId => {
            const response = await fetch(`${goBase}/cm-engine-control`, { method: 'POST',
                headers: { authorization: `Bearer ${memoryToken}`, 'content-type': 'application/json' },
                body: JSON.stringify({ recordId }), signal, redirect: 'error' });
            if (!response.ok) throw fail('ISOLATION_EVALUATION_FAILED');
        };
        const engineCall = (operation, body) => fetch(engineBase + operation, {
            method: body === undefined ? 'GET' : 'POST',
            headers: { authorization: `Bearer ${memoryToken}`, 'content-type': 'application/json' },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal, redirect: 'error',
        });
        const restartMemorycore = async () => {
            await runCompose([...compose, 'restart', 'memorycore'], signal, 'ISOLATION_EVALUATION_FAILED');
            await waitFor(async () => {
                signal.throwIfAborted();
                return (await engineCall('/readyz').catch(() => null))?.ok;
            }, { timeoutMs: 30000 });
        };
        stage = 'ISOLATION_EVALUATION_FAILED';
        return await withSignal(signal, evaluate, {
            ...owner, second, judge, secrets, signal, meterBase, engineCall, restartMemorycore, readEngineObservations, setForgetHold,
            embeddingModel: { name: embeddingModel.name, digest: embeddingModel.digest },
            w08: { psql }, w05: { stBase, goBase, ownerId: OWNER, secondId: SECOND },
        });
    } catch (error) {
        throw fail(signal.aborted ? 'ISOLATION_INTERRUPTED' : CODES.has(error?.message) ? error.message : stage);
    } finally {
        try {
            if (readyToClean) {
                verifyCleanupOwnership(project, round);
                docker([...compose, 'down', '-v', '--remove-orphans'], { code: 'ISOLATION_CLEANUP_FAILED' });
                removeImages(project);
            }
        } finally {
            remove();
            if (state) {
                try { fs.rmSync(state, { recursive: true, force: true }); }
                catch { throw fail('ISOLATION_CLEANUP_FAILED'); }
            }
        }
    }
}
