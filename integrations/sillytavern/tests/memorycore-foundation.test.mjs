import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createMemoryCoreServer, requireServiceToken } from '../memorycore-service/http.mjs';
import { ownerDirectory, prepareDataRoot } from '../memorycore-service/storage.mjs';
import { memorycoreBuild, assembleMemorycore, verifyMemorycoreDeployment, memorycorePaths,
    matchesMemorycoreProcess, stopMemorycore, statusMemorycore, memorycoreComponent } from '../scripts/lib/memorycore-managed.mjs';
import { sha256 } from '../scripts/lib/util.mjs';

const token = 'synthetic-memorycore-token-0123456789';
async function serverFixture(t, ready = async () => true) {
    const server = createMemoryCoreServer({ token, engine: { ready }, commit: 'test-commit' });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    t.after(() => new Promise((r) => { server.close(r); server.closeAllConnections(); }));
    assert.equal(server.address().address, '127.0.0.1');
    return `http://127.0.0.1:${server.address().port}`;
}
test('MemoryCore health/readiness distinguishes foundation from business readiness', async (t) => {
    const base = await serverFixture(t);
    assert.equal((await fetch(base + '/healthz')).status, 200);
    const r = await fetch(base + '/readyz', { headers: { authorization: `Bearer ${token}` } });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { status: 'ready', foundation: true, storageReady: true, businessReady: false, upstreamCommit: 'test-commit' });
    assert.equal(r.headers.get('cache-control'), 'no-store');
});
test('MemoryCore rejects missing/wrong/query tokens and exposes no business routes', async (t) => {
    const base = await serverFixture(t);
    for (const route of ['/readyz', '/readyz?token=' + token, '/internal/extract']) {
        assert.equal((await fetch(base + route)).status, 401);
    }
    assert.equal((await fetch(base + '/readyz', { headers: { authorization: 'Bearer wrong' } })).status, 401);
    assert.equal((await fetch(base + '/internal/extract', { headers: { authorization: `Bearer ${token}` } })).status, 404);
    assert.equal((await fetch(base + '/healthz', { method: 'POST' })).status, 405);
});
test('MemoryCore refuses browser origins and does not enable CORS', async (t) => {
    const base = await serverFixture(t);
    const r = await fetch(base + '/readyz', { method: 'OPTIONS', headers: { origin: 'https://example.test', authorization: `Bearer ${token}` } });
    assert.equal(r.status, 403);
    assert.equal(r.headers.get('access-control-allow-origin'), null);
    assert.equal(r.headers.get('access-control-allow-credentials'), null);
});
test('MemoryCore unavailable/error responses never echo exception or credentials', async (t) => {
    const base = await serverFixture(t, async () => { throw new Error(token + ' synthetic private content'); });
    const r = await fetch(base + '/readyz', { headers: { authorization: `Bearer ${token}` } });
    assert.equal(r.status, 503);
    const body = await r.text(); assert.ok(!body.includes(token)); assert.ok(!body.includes('private content'));
    assert.equal((await fetch(base + '/healthz')).status, 200);
});
test('MemoryCore refuses weak/malformed service tokens without echoing them', () => {
    for (const value of [undefined, '', 'short', token + '\n']) {
        assert.throws(() => requireServiceToken(value), { message: 'MEMORYCORE_SERVICE_TOKEN_REQUIRED' });
    }
});
function temp(t) { const p = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-memorycore-')); t.after(() => fs.rmSync(p, { recursive: true, force: true })); return p; }
test('MemoryCore owner directories are private, exact IDs and cannot escape or follow symlinks', (t) => {
    const root = path.join(temp(t), 'data'); prepareDataRoot(root);
    const a = ownerDirectory(root, '9007199254740993');
    const b = ownerDirectory(root, '9007199254740992');
    assert.notEqual(a, b);
    for (const p of [root, path.join(root, 'owners'), a, b]) assert.equal(fs.statSync(p).mode & 0o777, 0o700);
    for (const id of ['../1', '/tmp', '0', '1/2', '1e3']) assert.throws(() => ownerDirectory(root, id));
    const outside = path.join(temp(t), 'outside'); fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(root, 'owners', '7'));
    assert.throws(() => ownerDirectory(root, '7'), /UNSAFE_DIRECTORY/);
});
function buildFixture(t) {
    const root = temp(t), sourceDir = path.join(root, 'upstream'), serviceDir = path.join(root, 'service'), managedDev = path.join(root, 'managed');
    const src = { 'LICENSE': 'MIT\n', 'MemoryCore/package.json': '{"version":"fixture"}',
        'MemoryCore/src/core/storage/local-backend.ts': 'export const fixture: string = "original";\n',
        'MemoryCore/src/core/storage/list-page.ts': 'export const count: number = 1;\n' };
    for (const [rel, body] of Object.entries(src)) { fs.mkdirSync(path.dirname(path.join(sourceDir, rel)), { recursive: true }); fs.writeFileSync(path.join(sourceDir, rel), body); }
    fs.mkdirSync(serviceDir); fs.writeFileSync(path.join(serviceDir, 'server.mjs'), 'export const wrapper = true;\n');
    const lock = { components: [{ id: 'memorycore', commit: 'a'.repeat(40), version: 'fixture', artifact_sha256: Object.fromEntries(Object.entries(src).map(([f, v]) => [f, sha256(Buffer.from(v))])) }] };
    const patchIndex = path.join(root, 'index.json');
    fs.writeFileSync(patchIndex, JSON.stringify({ upstream_commit: 'a'.repeat(40), specs: [] }));
    return { sourceDir, serviceDir, managedDev, lock, patchIndex };
}
test('MemoryCore assembly is deterministic and preserves owner data across rebuilds', (t) => {
    const f = buildFixture(t), p = memorycorePaths(f.managedDev);
    assembleMemorycore(f);
    const owner = ownerDirectory(p.data, '1'), sentinel = path.join(owner, 'synthetic.txt');
    fs.writeFileSync(sentinel, 'synthetic preserved data', { mode: 0o600 });
    const first = fs.readFileSync(path.join(p.run, 'upstream/local-backend.js'), 'utf8');
    assert.ok(!first.includes(': string'));
    assembleMemorycore(f);
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'synthetic preserved data');
    assert.equal(fs.statSync(sentinel).mode & 0o777, 0o600);
    assert.equal(fs.readFileSync(path.join(p.run, 'upstream/local-backend.js'), 'utf8'), first);
    assert.equal(verifyMemorycoreDeployment(f), 'a'.repeat(40));
    fs.appendFileSync(path.join(p.run, 'server.mjs'), '/* drift */');
    assert.throws(() => verifyMemorycoreDeployment(f), /deployment differs/);
});
test('MemoryCore refuses source drift before destroying the existing run copy', (t) => {
    const f = buildFixture(t); assembleMemorycore(f);
    const runFile = path.join(memorycorePaths(f.managedDev).run, 'server.mjs');
    fs.appendFileSync(path.join(f.sourceDir, 'MemoryCore/src/core/storage/local-backend.ts'), '/* drift */');
    assert.throws(() => assembleMemorycore(f), /artifact mismatch/);
    assert.ok(fs.existsSync(runFile));
});
test('MemoryCore patch set uses shared input/output validation, scoped to its locked upstream', (t) => {
    const f = buildFixture(t);
    const target = 'MemoryCore/src/core/storage/local-backend.ts';
    const input = fs.readFileSync(path.join(f.sourceDir, target), 'utf8');
    const spec = { id: 'fixture', reason: 'synthetic patch test', upstream: { commit: 'a'.repeat(40) }, removal_condition: 'fixture only', target,
        expected_input_sha256: sha256(Buffer.from(input)), expected_output_sha256: sha256(Buffer.from(input.replace('original', 'patched'))),
        replacements: [{ from: 'original', to: 'patched', count: 1 }] };
    fs.writeFileSync(path.join(path.dirname(f.patchIndex), 'test.json'), JSON.stringify(spec));
    fs.writeFileSync(f.patchIndex, JSON.stringify({ upstream_commit: 'a'.repeat(40), specs: ['test.json'] }));
    const build = memorycoreBuild(f);
    assert.equal(build.patches.length, 1); assert.ok(build.files['upstream/local-backend.js'].includes('patched'));
    spec.replacements[0].count = 2; fs.writeFileSync(path.join(path.dirname(f.patchIndex), 'test.json'), JSON.stringify(spec));
    assert.throws(() => memorycoreBuild(f), /命中/);
});
test('MemoryCore refuses active reassembly and foreign PID stop; requires entry and data root', async (t) => {
    const f = buildFixture(t); assembleMemorycore(f); const p = memorycorePaths(f.managedDev);
    fs.writeFileSync(p.pid, String(process.pid));
    assert.throws(() => assembleMemorycore(f), /Stop MemoryCore/);
    await assert.rejects(stopMemorycore(f), /another process/);
    assert.ok(fs.existsSync(p.pid));
    assert.equal(matchesMemorycoreProcess(`${process.execPath} ${p.run}/server.mjs --dataRoot ${p.data} --port 8754`, p), true);
    assert.equal(matchesMemorycoreProcess(`${process.execPath} ${p.run}/server.mjs --dataRoot ${p.data}-other --port 8754`, p), false);
    assert.equal(matchesMemorycoreProcess(`${process.execPath} /other/server.mjs --dataRoot ${p.data} --port 8754`, p), false);
    assert.equal(matchesMemorycoreProcess(`${process.execPath} -e ' ${p.run}/server.mjs --dataRoot ${p.data} --port 8754'`, p), false);
    assert.equal(matchesMemorycoreProcess(`${process.execPath} ${p.run}/server.mjs --dataRoot ${p.data} --port 8754`, p, 8755), false);
});

test('MemoryCore status never sends its token to a different configured port', async (t) => {
    const managedDev = temp(t), p = memorycorePaths(managedDev);
    fs.mkdirSync(p.run); fs.mkdirSync(p.logs); fs.mkdirSync(p.data);
    // The controlled process matches our managed entry and data root, but its
    // actual port deliberately differs from the status target.
    fs.writeFileSync(path.join(p.run, 'server.mjs'), 'console.log("started"); setInterval(() => {}, 1000);');
    const child = spawn(process.execPath, [path.join(p.run, 'server.mjs'), '--dataRoot', p.data, '--port', '8754'], { stdio: ['ignore', 'pipe', 'pipe'] });
    t.after(async () => { child.kill(); await new Promise((resolve) => { if (child.exitCode !== null) resolve(); else child.once('exit', resolve); }); });
    await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('error', reject); });
    fs.writeFileSync(p.pid, String(child.pid));
    const received = [];
    const other = http.createServer((req, res) => { received.push(req.headers.authorization); res.end(JSON.stringify({ status: 'ok', upstreamCommit: memorycoreComponent().commit })); });
    await new Promise((resolve) => other.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => { other.close(resolve); other.closeAllConnections(); }));
    const port = other.address().port;
    const state = await statusMemorycore({ managedDev, port, token });
    assert.equal(state.alive, true); assert.equal(state.owned, false);
    assert.deepEqual(received, [undefined]);
    assert.equal(state.readiness, undefined);
});
