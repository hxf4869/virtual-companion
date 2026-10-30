// Explicit managed acceptance: real pinned LocalStorageBackend, isolated synthetic
// owner data, no Go/PG/MinIO/model calls. Called by the existing acceptance runner.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { ownerDirectory } from '../memorycore-service/storage.mjs';
import { memorycorePaths, startMemorycore } from './lib/memorycore-managed.mjs';

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
async function freePort() {
    const server = net.createServer();
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const port = server.address().port;
    await new Promise((resolve) => server.close(resolve));
    return port;
}
export async function sceneMemorycoreFoundation(ctx) {
    const started = Date.now();
    const managedDev = path.join(ctx.artifactsDir, 'memorycore-managed');
    const port = await freePort();
    const token = ctx.secrets.memorycoreToken;
    const env = { ...process.env, VC_ST_DEV_DIR: managedDev, VC_MEMORYCORE_PORT: String(port), VC_MEMORYCORE_SERVICE_TOKEN: token };
    const p = memorycorePaths(managedDev);
    const checks = [];
    function command(name, extra = []) {
        const r = spawnSync(process.execPath, [path.join(SCRIPTS, name), '--memorycore-only', ...extra], { env, encoding: 'utf8', timeout: 30000 });
        // Do not propagate arbitrary subprocess output into artifacts/logs.
        if (r.status !== 0) throw new Error(`MemoryCore managed command failed: ${name} (${r.status ?? 'timeout'})`);
        return r.stdout;
    }
    const base = `http://127.0.0.1:${port}`;
    const fetchReady = () => fetch(base + '/readyz', { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(2000) });
    let owned = false;
    try {
        command('bootstrap.mjs', ['--offline']); checks.push('locked-source-bootstrap');
        command('assemble-managed.mjs'); checks.push('assemble');
        // A real child is spawned, then a synthetic PID-write failure must
        // clean it up even though it never obtained a PID registration.
        const write = fs.writeFileSync;
        try {
            fs.writeFileSync = (target, ...args) => {
                if (typeof target === 'number') throw new Error('SYNTHETIC_PID_WRITE_FAILURE');
                return write.call(fs, target, ...args);
            };
            await assert.rejects(startMemorycore({ managedDev, port, token }), /SYNTHETIC_PID_WRITE_FAILURE/);
        } finally { fs.writeFileSync = write; }
        assert.ok(!fs.existsSync(p.pid));
        await assert.rejects(fetch(base + '/healthz', { signal: AbortSignal.timeout(1000) })); checks.push('failed-start-cleans-unregistered-child');
        const sentinel = path.join(ownerDirectory(p.data, '1'), 'synthetic.txt');
        fs.writeFileSync(sentinel, 'synthetic persistent storage', { mode: 0o600 });
        owned = true; // The isolated root belongs exclusively to this acceptance, even on partial start.
        command('start-managed.mjs');
        const firstPid = fs.readFileSync(p.pid, 'utf8');
        const health = await fetch(base + '/healthz', { signal: AbortSignal.timeout(2000) });
        assert.equal(health.status, 200);
        assert.equal((await health.json()).upstreamCommit, '084bed45cad6bb7f877455082cee82835d65671a'); checks.push('health-pinned-source');
        const ready = await fetchReady(); assert.equal(ready.status, 200);
        assert.deepEqual(await ready.json(), { status: 'ready', foundation: true, storageReady: true, businessReady: false,
            upstreamCommit: '084bed45cad6bb7f877455082cee82835d65671a' }); checks.push('foundation-ready');
        assert.equal((await fetch(base + '/readyz')).status, 401);
        const cross = await fetch(base + '/readyz', { headers: { origin: 'https://example.test', authorization: `Bearer ${token}` } });
        assert.equal(cross.status, 403); assert.equal(cross.headers.get('access-control-allow-origin'), null); checks.push('authentication-no-cors');
        const status = JSON.parse(command('status-managed.mjs'));
        assert.equal(status.memorycore.owned, true); assert.equal(status.memorycore.readiness.storageReady, true); checks.push('owned-status');
        for (const dir of [p.data, path.join(p.data, 'owners'), path.dirname(sentinel)]) assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
        for (const file of [sentinel, p.log, p.pid]) assert.equal(fs.statSync(file).mode & 0o777, 0o600);
        assert.ok(!fs.readFileSync(p.log, 'utf8').includes(token));
        assert.ok(!fs.readdirSync(p.data).some((n) => n.startsWith('.health-'))); checks.push('permissions-probe-cleanup-no-secret-log');
        command('stop-managed.mjs'); assert.ok(!fs.existsSync(p.pid)); checks.push('first-stop');
        command('assemble-managed.mjs'); assert.equal(fs.readFileSync(sentinel, 'utf8'), 'synthetic persistent storage'); checks.push('reassembly-preserves-data');
        command('start-managed.mjs'); assert.notEqual(fs.readFileSync(p.pid, 'utf8'), firstPid);
        assert.equal((await fetchReady()).status, 200); checks.push('restart-ready');
        command('stop-managed.mjs'); assert.ok(!fs.existsSync(p.pid));
        await assert.rejects(fetch(base + '/healthz', { signal: AbortSignal.timeout(1000) })); checks.push('final-stop-port-released');
        ctx.results.memorycoreFoundation = { checks, passed: checks.length, ms: Date.now() - started, foundation: true, businessReady: false };
    } finally { if (owned) command('stop-managed.mjs'); }
}

export const memorycoreFoundationScene = {
    id: 'memorycore-foundation',
    title: 'W08 MemoryCore 固定源码基础服务、鉴权、重启与数据保留',
    needs: ['memorycore'],
    default: false,
    run: sceneMemorycoreFoundation,
};
export const scenes = [memorycoreFoundationScene];
