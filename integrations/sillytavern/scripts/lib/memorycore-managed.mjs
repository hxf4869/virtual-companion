import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { stripTypeScriptTypes } from 'node:module';
import { spawn } from 'node:child_process';
import {
    MANAGED_DEV, MEMORYCORE_DIR, MEMORYCORE_SERVICE_SRC, MEMORYCORE_PATCH_INDEX,
    UPSTREAM_LOCK, MEMORYCORE_PORT,
} from './paths.mjs';
import { readJson, writeJson, sha256, sha256File, run, mkdirp, isPidAlive, pidCommand, waitFor } from './util.mjs';
import { applySpecToText } from './patcher.mjs';
import { requireServiceToken } from '../../memorycore-service/http.mjs';
import { prepareDataRoot, privateDirectory } from '../../memorycore-service/storage.mjs';

export function memorycorePaths(managedDev = MANAGED_DEV) {
    return { run: path.join(managedDev, 'memorycore-run'), data: path.join(managedDev, 'memorycore-data'),
        logs: path.join(managedDev, 'run'), manifest: path.join(managedDev, 'derived-manifest.json'),
        pid: path.join(managedDev, 'run/memorycore.pid'), log: path.join(managedDev, 'run/memorycore.log') };
}
export function memorycoreComponent(lock = readJson(UPSTREAM_LOCK)) {
    const c = lock.components.find((c) => c.id === 'memorycore');
    if (!c) throw new Error('MemoryCore component is not locked');
    return c;
}
export function verifyMemorycoreUpstream({ sourceDir = MEMORYCORE_DIR, lock = readJson(UPSTREAM_LOCK) } = {}) {
    const c = memorycoreComponent(lock);
    if (run('git', ['-C', sourceDir, 'rev-parse', 'HEAD']).trim() !== c.commit) throw new Error('MemoryCore HEAD differs from lock');
    if (run('git', ['-C', sourceDir, 'status', '--porcelain']).trim()) throw new Error('MemoryCore upstream is dirty');
    for (const [file, digest] of Object.entries(c.artifact_sha256)) {
        if (sha256File(path.join(sourceDir, file)) !== digest) throw new Error(`MemoryCore locked artifact mismatch: ${file}`);
    }
    return c;
}

// Build is dependency-free and deterministic. Empty patch sets are valid;
// individual nonempty specs use exactly the shared patcher and pinned commit.
export function memorycoreBuild({ sourceDir = MEMORYCORE_DIR, serviceDir = MEMORYCORE_SERVICE_SRC,
    lock = readJson(UPSTREAM_LOCK), patchIndex = MEMORYCORE_PATCH_INDEX } = {}) {
    const c = memorycoreComponent(lock);
    for (const [file, digest] of Object.entries(c.artifact_sha256)) {
        if (sha256File(path.join(sourceDir, file)) !== digest) throw new Error(`MemoryCore locked artifact mismatch: ${file}`);
    }
    const index = readJson(patchIndex);
    if (index.upstream_commit !== c.commit || !Array.isArray(index.specs)) throw new Error('MemoryCore patch set does not match lock');
    const sourceFiles = {};
    for (const name of ['local-backend', 'list-page']) {
        const rel = `MemoryCore/src/core/storage/${name}.ts`;
        sourceFiles[rel] = fs.readFileSync(path.join(sourceDir, rel), 'utf8');
    }
    const patches = [];
    for (const name of index.specs) {
        if (path.basename(name) !== name || !name.endsWith('.json')) throw new Error('Invalid MemoryCore patch filename');
        const spec = readJson(path.join(path.dirname(patchIndex), name));
        if (spec.upstream?.commit !== c.commit || !Object.hasOwn(sourceFiles, spec.target)) throw new Error('Invalid MemoryCore patch target/version');
        const result = applySpecToText(sourceFiles[spec.target], spec);
        sourceFiles[spec.target] = result.output;
        patches.push({ id: spec.id, target: spec.target, input_sha256: result.inputSha256, output_sha256: result.outputSha256 });
    }
    const files = { 'package.json': '{"private":true,"type":"module"}\n',
        'upstream/LICENSE': fs.readFileSync(path.join(sourceDir, 'LICENSE'), 'utf8'),
        'build.json': JSON.stringify({ commit: c.commit, version: c.version, foundation: true }) + '\n' };
    for (const [rel, text] of Object.entries(sourceFiles)) {
        files[`upstream/${path.basename(rel, '.ts')}.js`] = stripTypeScriptTypes(text, { mode: 'strip' });
    }
    for (const name of fs.readdirSync(serviceDir).filter((name) => name.endsWith('.mjs')).sort()) {
        files[name] = fs.readFileSync(path.join(serviceDir, name), 'utf8');
    }
    return { commit: c.commit, patches, files };
}
export function assembleMemorycore({ managedDev = MANAGED_DEV, ...options } = {}) {
    const p = memorycorePaths(managedDev);
    const build = memorycoreBuild(options); // Validate everything before replacing a runnable copy.
    mkdirp(managedDev);
    privateDirectory(p.logs);
    prepareDataRoot(p.data);
    if (fs.existsSync(p.pid) && isPidAlive(Number(fs.readFileSync(p.pid, 'utf8').trim()))) throw new Error('Stop MemoryCore before reassembly');
    fs.rmSync(p.run, { recursive: true, force: true });
    for (const [rel, content] of Object.entries(build.files)) {
        mkdirp(path.dirname(path.join(p.run, rel)));
        fs.writeFileSync(path.join(p.run, rel), content, { mode: 0o600 });
    }
    const manifest = fs.existsSync(p.manifest) ? readJson(p.manifest) : {};
    manifest.memorycore = { commit: build.commit, run: p.run, data: p.data, patches: build.patches,
        foundation: true, business_ready: false,
        files: Object.fromEntries(Object.entries(build.files).map(([rel, text]) => [rel, sha256(Buffer.from(text))])) };
    writeJson(p.manifest, manifest);
    return manifest.memorycore;
}
export function verifyMemorycoreDeployment({ managedDev = MANAGED_DEV, ...options } = {}) {
    const p = memorycorePaths(managedDev);
    const build = memorycoreBuild(options);
    const manifest = readJson(p.manifest).memorycore;
    if (!manifest || manifest.commit !== build.commit || manifest.run !== p.run || manifest.data !== p.data) throw new Error('MemoryCore assembly is missing/stale');
    for (const [rel, content] of Object.entries(build.files)) {
        if (sha256File(path.join(p.run, rel)) !== sha256(Buffer.from(content))) throw new Error(`MemoryCore deployment differs: ${rel}`);
    }
    return build.commit;
}
function validPort(port) { return Number.isInteger(port) && port > 0 && port <= 65535; }
export function matchesMemorycoreProcess(command, p, expectedPort) {
    const prefix = `${process.execPath} ${path.join(p.run, 'server.mjs')} --dataRoot ${p.data} --port `;
    if (typeof command !== 'string' || !command.startsWith(prefix)) return false;
    const raw = command.slice(prefix.length);
    return /^[0-9]+$/.test(raw) && validPort(Number(raw)) && (expectedPort === undefined || Number(raw) === expectedPort);
}
async function assertPortFree(port) {
    await new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.once('error', () => reject(new Error('MemoryCore port is occupied/unavailable')));
        probe.listen(port, '127.0.0.1', () => probe.close(resolve));
    });
}
export async function preflightMemorycore({ managedDev = MANAGED_DEV, port = MEMORYCORE_PORT, token = process.env.VC_MEMORYCORE_SERVICE_TOKEN } = {}) {
    requireServiceToken(token);
    if (!validPort(port)) throw new Error('Invalid MemoryCore port');
    verifyMemorycoreUpstream();
    verifyMemorycoreDeployment({ managedDev });
    const p = memorycorePaths(managedDev);
    prepareDataRoot(p.data);
    if (fs.existsSync(p.pid)) {
        const pid = Number(fs.readFileSync(p.pid, 'utf8').trim());
        if (!Number.isInteger(pid) || pid <= 1 || isPidAlive(pid)) throw new Error('MemoryCore PID is active/invalid; refusing takeover');
        fs.rmSync(p.pid);
    }
    await assertPortFree(port);
}
export async function startMemorycore({ managedDev = MANAGED_DEV, port = MEMORYCORE_PORT, token = process.env.VC_MEMORYCORE_SERVICE_TOKEN } = {}) {
    await preflightMemorycore({ managedDev, port, token });
    const p = memorycorePaths(managedDev);
    privateDirectory(p.logs);
    // Exclusive reservation closes the gap between preflight and spawn.
    const pidFD = fs.openSync(p.pid, 'wx', 0o600);
    let child, logFD;
    try {
        logFD = fs.openSync(p.log, 'a', 0o600); fs.chmodSync(p.log, 0o600);
        child = spawn(process.execPath, [path.join(p.run, 'server.mjs'), '--dataRoot', p.data, '--port', String(port)], {
            cwd: p.run, detached: true, stdio: ['ignore', logFD, logFD],
            env: { PATH: process.env.PATH, NODE_ENV: 'production', VC_MEMORYCORE_SERVICE_TOKEN: token },
        });
        fs.closeSync(logFD); logFD = undefined;
        await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', () => reject(new Error('MemoryCore spawn failed'))); });
        child.unref();
        fs.writeFileSync(pidFD, String(child.pid));
        await waitFor(async () => {
            if (!isPidAlive(child.pid)) throw new Error('MemoryCore exited before readiness');
            try {
                const response = await fetch(`http://127.0.0.1:${port}/readyz`, {
                    headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(1000),
                });
                const body = await response.json();
                return response.ok && body.storageReady === true && body.businessReady === false && body.upstreamCommit === memorycoreComponent().commit;
            } catch { return false; }
        }, { timeoutMs: 10000, label: 'MemoryCore foundation readiness' });
        return { pid: child.pid, port, foundation: true, businessReady: false };
    } catch (error) {
        // Use the actual newly spawned child, not an unregistered/stale PID file.
        if (child?.pid && child.exitCode === null) {
            child.kill('SIGTERM');
            await waitFor(() => child.exitCode !== null || !isPidAlive(child.pid), { timeoutMs: 5000, label: 'MemoryCore failed-start cleanup' });
        }
        fs.rmSync(p.pid, { force: true });
        throw error;
    } finally {
        fs.closeSync(pidFD);
        if (logFD !== undefined) fs.closeSync(logFD);
    }
}

export async function stopMemorycore({ managedDev = MANAGED_DEV } = {}) {
    const p = memorycorePaths(managedDev);
    if (!fs.existsSync(p.pid)) return { stopped: true, running: false };
    const pid = Number(fs.readFileSync(p.pid, 'utf8').trim());
    if (!Number.isInteger(pid) || pid <= 1) throw new Error('MemoryCore PID file invalid; refusing to signal');
    if (isPidAlive(pid)) {
        if (!matchesMemorycoreProcess(pidCommand(pid), p)) throw new Error('MemoryCore PID belongs to another process; refusing to signal');
        process.kill(pid, 'SIGTERM');
        await waitFor(() => !isPidAlive(pid), { timeoutMs: 10000, label: 'MemoryCore shutdown' });
    }
    fs.rmSync(p.pid);
    return { stopped: true, running: false };
}
export async function statusMemorycore({ managedDev = MANAGED_DEV, port = MEMORYCORE_PORT, token = process.env.VC_MEMORYCORE_SERVICE_TOKEN } = {}) {
    const p = memorycorePaths(managedDev);
    const pid = fs.existsSync(p.pid) ? Number(fs.readFileSync(p.pid, 'utf8').trim()) : null;
    const alive = Number.isInteger(pid) && pid > 1 && isPidAlive(pid);
    const out = { pid, alive, owned: alive && matchesMemorycoreProcess(pidCommand(pid), p, port), port, tokenConfigured: Boolean(token) };
    try {
        const res = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(1000) });
        const health = await res.json();
        out.health = { http: res.status, status: health.status, upstreamCommit: health.upstreamCommit };
        if (token && out.owned && out.health.upstreamCommit === memorycoreComponent().commit) {
            const ready = await fetch(`http://127.0.0.1:${port}/readyz`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(1000) });
            const body = await ready.json();
            out.readiness = { http: ready.status, status: body.status, foundation: body.foundation, storageReady: body.storageReady, businessReady: body.businessReady };
        }
    } catch { out.health = { status: 'unavailable' }; }
    return out;
}
