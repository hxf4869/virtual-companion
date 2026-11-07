import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { copyIngestCheckpoint, createIngestCheckpoint, recreateEvaluationClients } from '../scripts/lib/chat-memory-isolated-stack.mjs';

const PROJECT = 'vc-cm3-0123456789abcdef';
const ROUND = 'round-checkpoint';
const VOLUMES = ['db-data', 'memorycore-data', 'st-data', 'minio-data'];

function fixture(t, overrides = {}) {
    const state = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-cm3-checkpoint-test-'));
    t.after(() => fs.rmSync(state, { recursive: true, force: true }));
    fs.writeFileSync(path.join(state, 'config.yaml'), '{}', { mode: 0o600 });
    const events = [], signal = new AbortController();
    const labels = { 'com.docker.compose.project': PROJECT, 'com.vc.cm3.round': ROUND };
    const services = ['st', 'runtime', 'engine-observer', 'memorycore', 'db', 'minio'];
    const containers = Object.fromEntries(services.filter(service => service !== overrides.missingService).map((service, index) => [String(index + 1).padStart(64, '0'), {
        name: `/${PROJECT}-${service}-1`, labels: { ...labels, 'com.docker.compose.service': service },
        running: true, status: 'running', exitCode: 0, oomKilled: false,
        mounts: VOLUMES.filter(volume => ({ 'db-data': ['db'], 'memorycore-data': ['memorycore'],
            'st-data': ['st', 'runtime'], 'minio-data': ['minio'] })[volume].includes(service))
            .map(volume => ({ Type: 'volume', Name: `${PROJECT}_${volume}` })),
    }]));
    const helperId = 'f'.repeat(64);
    let helper = false, invalidated = false, refreshes = 0;
    const helperName = `${PROJECT}-ingest-checkpoint-helper`;
    const dockerSync = args => {
        if (args[0] === 'volume' && args[1] === 'ls') return VOLUMES.map(name => `${PROJECT}_${name}`).join('\n');
        if (args[0] === 'volume' && args[1] === 'inspect') {
            const name = args.at(-1), short = name.slice(PROJECT.length + 1);
            return JSON.stringify({ Name: overrides.volumeName || name, Labels: { ...labels, 'com.docker.compose.volume': short,
                ...(overrides.volumeLabels || {}) } });
        }
        if (args[0] === 'ps') {
            if (!args.includes('--filter')) return Object.keys(containers).join('\n');
            const filter = args[args.indexOf('--filter') + 1];
            if (filter.startsWith('name=')) return helper ? helperId : '';
            throw new Error('All stopped and foreign references must be inspected');
        }
        if (args[0] === 'inspect') {
            if (args.at(-1) === helperId) return JSON.stringify({ name: `/${helperName}`,
                labels: { ...labels, 'com.vc.cm3.checkpoint': 'ingest', ...(overrides.helperLabels || {}) } });
            return args.slice(args.indexOf('--format') + 2).map(id =>
                JSON.stringify({ ...containers[id], ...(overrides.container || {}) })).join('\n');
        }
        if (args[0] === 'rm') { helper = false; events.push('helper-cleaned'); return ''; }
        throw new Error(`Unexpected offline docker command: ${args[0]}`);
    };
    const dockerAsync = async (args, activeSignal) => {
        if (args[0] === 'compose') {
            const operation = args[1];
            const selected = args.filter(arg => services.includes(arg));
            events.push(`${operation}:${selected.join(',')}`);
            for (const row of Object.values(containers)) if (selected.includes(row.labels['com.docker.compose.service'])) {
                row.running = operation === 'up'; row.status = row.running ? 'running' : 'exited';
            }
            if (operation === 'up') {
                assert.ok(args.includes('--no-deps'));
                assert.ok(args.includes('--no-recreate'));
                assert.ok(args.includes('--no-build'));
                assert.equal(args[args.indexOf('--pull') + 1], 'never');
                assert.equal(args.some(arg => ['migrate', 'bootstrap', 'minio-init', 'embedding', 'rerank'].includes(arg)), false);
            }
            return '';
        }
        assert.equal(args[0], 'run');
        assert.equal(args[args.indexOf('--network') + 1], 'none');
        assert.equal(args[args.indexOf('--pull') + 1], 'never');
        assert.ok(args.includes('--rm'));
        assert.equal(args[args.indexOf('--name') + 1], helperName);
        assert.ok(args.includes(`com.docker.compose.project=${PROJECT}`));
        assert.ok(args.includes(`com.vc.cm3.round=${ROUND}`));
        assert.equal(args.some(arg => /host-ledger|budget|models/.test(arg)), false);
        const action = args.at(-1);
        events.push(action); helper = true;
        if (action === overrides.failAction) throw new Error('private docker output must not escape');
        if (action === overrides.abortAction) { signal.abort(); throw new Error('interrupted docker CLI'); }
        if (action === 'capture') fs.writeFileSync(path.join(state, 'ingest-checkpoint', 'ingest.tar'), 'archive', { mode: 0o600 });
        helper = false;
        assert.equal(activeSignal, signal.signal);
        return action === 'size' ? String(overrides.sourceSize ?? 20) : action === 'capture'
            ? JSON.stringify({ uid: 1000, gid: 1000, mode: 0o600 }) : '';
    };
    const checkpoint = createIngestCheckpoint({ project: PROJECT, round: ROUND, state, compose: ['compose'], signal: signal.signal,
        dockerSync, dockerAsync, ready: async () => events.push('ready'),
        refreshClients: async () => { events.push('clients'); return { owner: { refresh: ++refreshes }, second: {}, judge: {} }; },
        invalidate: () => { invalidated = true; } });
    return { checkpoint, state, events, containers, signal, get invalidated() { return invalidated; } };
}

test('one ingest capture resumes the stack and two restores always clear before extract', async t => {
    const { checkpoint, state, events } = fixture(t);
    await assert.rejects(checkpoint.restoreIngestCheckpoint(), /ISOLATION_CHECKPOINT_NOT_READY/);
    assert.deepEqual(events, []);
    await checkpoint.captureIngestCheckpoint();
    assert.equal(fs.statSync(path.join(state, 'ingest-checkpoint')).mode & 0o777, 0o700);
    assert.equal(fs.statSync(path.join(state, 'ingest-checkpoint', 'ingest.tar')).mode & 0o777, 0o600);
    assert.deepEqual(events.slice(0, 6), ['stop:st', 'stop:runtime', 'stop:engine-observer,memorycore', 'stop:db,minio', 'size', 'capture']);
    assert.deepEqual(events.slice(-2), ['ready', 'clients']);
    await assert.rejects(checkpoint.captureIngestCheckpoint(), /ISOLATION_CHECKPOINT_ALREADY_CAPTURED/);
    for (let index = 0; index < 2; index++) {
        events.length = 0;
        const clients = await checkpoint.restoreIngestCheckpoint();
        assert.equal(clients.owner.refresh, index + 2);
        assert.deepEqual(events.slice(0, 6), ['stop:st', 'stop:runtime', 'stop:engine-observer,memorycore', 'stop:db,minio', 'clear', 'extract']);
        assert.deepEqual(events.slice(-2), ['ready', 'clients']);
        assert.equal(events.filter(event => event === 'capture').length, 0);
    }
});

test('a foreign volume or a foreign/running referencing container blocks copying', async t => {
    for (const overrides of [
        { volumeName: `${PROJECT}_db-data-extra` },
        { volumeLabels: { 'com.docker.compose.project': 'foreign' } },
        { volumeLabels: { 'com.vc.cm3.round': 'round-foreign' } },
        { volumeLabels: { 'com.docker.compose.volume': 'local-embedding-models' } },
        { container: { labels: { 'com.docker.compose.project': 'foreign', 'com.vc.cm3.round': ROUND } } },
        { container: { running: true, status: 'running' } },
        { container: { exitCode: 137 } },
        { missingService: 'engine-observer' },
    ]) {
        const result = fixture(t, overrides);
        await assert.rejects(result.checkpoint.captureIngestCheckpoint(), /^Error: ISOLATION_CHECKPOINT_FAILED$/);
        assert.equal(result.events.includes('size'), false);
        assert.equal(result.invalidated, true);
        assert.equal(result.events.some(event => event.startsWith('up:')), false);
    }
    assert.throws(() => createIngestCheckpoint({ project: `${PROJECT}-foreign`, round: ROUND }), /ISOLATION_INPUT_INVALID/);
});

test('source capacity is checked before the only checkpoint directory is created', async t => {
    const result = fixture(t, { sourceSize: 4 * 1024 ** 3 + 1 });
    await assert.rejects(result.checkpoint.captureIngestCheckpoint(), /ISOLATION_CHECKPOINT_LIMIT/);
    assert.equal(fs.existsSync(path.join(result.state, 'ingest-checkpoint')), false);
    assert.equal(result.events.includes('capture'), false);
    assert.equal(result.invalidated, true);
});

test('the archive actual size is checked independently of the pre-capture source size', async t => {
    const result = fixture(t);
    const stat = fs.lstatSync;
    t.mock.method(fs, 'lstatSync', function (file, ...args) {
        const value = stat(file, ...args);
        if (file === path.join(result.state, 'ingest-checkpoint', 'ingest.tar')) value.size = 4 * 1024 ** 3 + 1;
        return value;
    });
    await assert.rejects(result.checkpoint.captureIngestCheckpoint(), /ISOLATION_CHECKPOINT_LIMIT/);
    assert.equal(result.events.includes('capture'), true);
    assert.equal(result.events.some(event => event.startsWith('up:')), false);
    assert.equal(result.invalidated, true);
});

test('failed or interrupted helper is removed before exit and cannot resume a damaged fixture', async t => {
    for (const overrides of [{ failAction: 'clear' }, { failAction: 'extract' }, { abortAction: 'extract' }]) {
        const result = fixture(t, overrides);
        await result.checkpoint.captureIngestCheckpoint();
        result.events.length = 0;
        await assert.rejects(result.checkpoint.restoreIngestCheckpoint(), /ISOLATION_(CHECKPOINT_FAILED|INTERRUPTED)/);
        assert.equal(result.events.at(-1), 'helper-cleaned');
        assert.equal(result.events.some(event => event.startsWith('up:')), false);
        assert.equal(result.events.includes('clients'), false);
        assert.equal(result.invalidated, true);
        await assert.rejects(result.checkpoint.restoreIngestCheckpoint(), /ISOLATION_CHECKPOINT_NOT_READY/);
        await result.checkpoint.cleanup();
    }
});

test('cleanup refuses to remove a helper with foreign ownership labels', async t => {
    const result = fixture(t, { failAction: 'size', helperLabels: { 'com.vc.cm3.round': 'round-foreign' } });
    await assert.rejects(result.checkpoint.captureIngestCheckpoint(), /ISOLATION_CLEANUP_FAILED/);
    assert.equal(result.events.includes('helper-cleaned'), false);
    assert.equal(result.events.some(event => event.startsWith('up:')), false);
    assert.equal(result.invalidated, true);
});

test('physical archive preserves hidden files and SQLite companions, removes case additions, and excludes the host ledger', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-cm3-copy-test-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const volumes = path.join(root, 'volumes'), checkpoint = path.join(root, 'checkpoint');
    fs.mkdirSync(volumes); fs.mkdirSync(checkpoint, { mode: 0o700 });
    for (const volume of VOLUMES) {
        fs.mkdirSync(path.join(volumes, volume));
        fs.writeFileSync(path.join(volumes, volume, '.hidden'), 'baseline', { mode: 0o600 });
    }
    for (const file of ['memory.sqlite', 'memory.sqlite-wal', 'memory.sqlite-shm', 'memory.sqlite-journal']) {
        fs.writeFileSync(path.join(volumes, 'memorycore-data', file), file, { mode: 0o600 });
    }
    fs.writeFileSync(path.join(volumes, 'config.yaml'), 'baseline-config', { mode: 0o600 });
    fs.writeFileSync(path.join(volumes, 'host-ledger.json'), 'outside-fixture');
    fs.writeFileSync(path.join(volumes, 'runtime.env'), 'outside-fixture');
    assert.ok(await copyIngestCheckpoint('size', volumes, checkpoint) > 0);
    const configMetadata = await copyIngestCheckpoint('capture', volumes, checkpoint);
    const members = execFileSync('tar', ['-tf', path.join(checkpoint, 'ingest.tar')], { encoding: 'utf8' });
    assert.equal(/host-ledger|runtime\.env/.test(members), false);
    assert.match(members, /memory\.sqlite-wal/);
    fs.writeFileSync(path.join(volumes, 'st-data', 'case-added'), 'case');
    fs.writeFileSync(path.join(volumes, 'config.yaml'), 'case-config');
    fs.chmodSync(path.join(volumes, 'config.yaml'), 0o666);
    const configInode = fs.statSync(path.join(volumes, 'config.yaml')).ino;
    await copyIngestCheckpoint('clear', volumes, checkpoint);
    for (const volume of VOLUMES) assert.deepEqual(fs.readdirSync(path.join(volumes, volume)), []);
    await copyIngestCheckpoint('extract', volumes, checkpoint, configMetadata);
    assert.equal(fs.existsSync(path.join(volumes, 'st-data', 'case-added')), false);
    assert.equal(fs.readFileSync(path.join(volumes, 'config.yaml'), 'utf8'), 'baseline-config');
    assert.equal(fs.statSync(path.join(volumes, 'config.yaml')).ino, configInode, 'the existing ST bind mount keeps its config inode');
    assert.equal(fs.statSync(path.join(volumes, 'config.yaml')).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.join(volumes, 'config.yaml')).uid, configMetadata.uid);
    assert.equal(fs.statSync(path.join(volumes, 'config.yaml')).gid, configMetadata.gid);
    assert.equal(fs.readFileSync(path.join(volumes, 'st-data', '.hidden'), 'utf8'), 'baseline');
    assert.equal(fs.statSync(path.join(volumes, 'st-data', '.hidden')).mode & 0o777, 0o600);
    assert.equal(fs.readFileSync(path.join(volumes, 'host-ledger.json'), 'utf8'), 'outside-fixture');
});

test('restored clients are new objects, validate original account/session through GET, and never write consent', async () => {
    const sessions = Object.fromEntries(['owner', 'second', 'judge'].map((role, index) => [role, {
        accountId: String(index + 1), sessionId: String(index + 10), vcSession: `synthetic-${role}`, vcCsrf: 'synthetic-csrf',
    }]));
    const calls = [];
    const args = { goBase: 'http://go.test', stBase: 'http://st.test', password: 'synthetic-password', sessions,
        createAdmin: ({ session }) => ({ sessionIdentity: async () => {
            calls.push(['GET', '/api/v1/auth/session']);
            return { status: 200, ok: true, json: { accountId: session.accountId, sessionId: session.sessionId } };
        } }),
        createSt: () => ({ call: async (method, route) => { calls.push([method, route]); return { status: 200, ok: true }; },
            ensureCsrf: async () => { calls.push(['GET', '/csrf-token']); return 'synthetic-csrf'; } }) };
    const first = await recreateEvaluationClients(args), second = await recreateEvaluationClients(args);
    for (const role of ['owner', 'second', 'judge']) {
        assert.notEqual(first[role].admin, second[role].admin);
        assert.notEqual(first[role].st, second[role].st);
        assert.notEqual(first[role].session, sessions[role]);
        assert.deepEqual(second[role].session, sessions[role]);
    }
    assert.equal(calls.length, 18);
    assert.equal(calls.filter(([, route]) => route === '/csrf-token').length, 6, 'CSRF setup finishes before any timed case request');
    assert.equal(calls.every(([method]) => method === 'GET'), true);
    await assert.rejects(recreateEvaluationClients({ ...args, createAdmin: () => ({ sessionIdentity: async () => ({
        status: 200, ok: true, json: { accountId: 'other', sessionId: 'other' },
    }) }) }), /ISOLATION_SYNTHETIC_AUTH_FAILED/);
});
