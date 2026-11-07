import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { memorycoreBuild } from '../scripts/lib/memorycore-managed.mjs';
import { INTEG } from '../scripts/lib/paths.mjs';
import { createNativeFactory, OWNER_DATABASE_FILES } from '../memorycore-service/native-engine.mjs';
import { createControlledEngine, mapScope } from '../memorycore-service/business.mjs';

const MARKER = 'VcSecureDeleteMarker7f3a9c2e1b84d056aa11';
const scope = { ownerId: '1', instanceId: '7', mode: 'COMPANION', domainId: 'daily-7', profileScopeId: 'main' };
const time = '2026-10-28T12:00:00Z';

async function loadApi(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-secure-api-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const build = memorycoreBuild();
    for (const [rel, content] of Object.entries(build.files)) {
        const file = path.join(root, rel);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, content, { mode: 0o600 });
    }
    await fs.symlink(path.join(INTEG, 'node_modules'), path.join(root, 'node_modules'));
    return import(pathToFileURL(path.join(root, 'upstream-api.mjs')).href);
}

function embedding() {
    const vector = new Float32Array(8);
    vector[0] = 1;
    return vector;
}

async function markerFiles(dir) {
    const found = [];
    for (const name of ['vectors.db', 'vectors.db-wal']) {
        const file = path.join(dir, name);
        try {
            const bytes = await fs.readFile(file);
            if (bytes.includes(Buffer.from(MARKER))) found.push(name);
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
    }
    return found;
}

async function engineWithMarker(t, api) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-secure-owner-'));
    const realFactory = await createNativeFactory(api);
    let ownerDir;
    let native;
    const engine = createControlledEngine({
        dataRoot: root,
        nativeFactory: async (dir) => {
            ownerDir = dir;
            native = await realFactory(dir);
            const filter = mapScope(scope);
            native.configureSpace('space-8', 8);
            native.commitPrepared({
                operationId: 'seed-marker',
                scopeKey: `${scope.instanceId}:${scope.mode}:${scope.domainId}:${scope.profileScopeId}`,
                revision: 0,
                spaceId: 'space-8',
                filter,
                targets: [],
                records: [{
                    record: {
                        id: 'rec-marker', content: MARKER, type: 'episodic', priority: 50,
                        scene_name: 'synthetic', source_message_ids: ['source-marker'],
                        metadata: { vcDependencies: ['source-marker'] }, version: 1,
                        timestamps: [time], createdAt: time, updatedAt: time, ...filter,
                    },
                    embedding: embedding(),
                }],
                l0Records: [{
                    id: 'source-marker', ...filter, role: 'user', messageText: MARKER,
                    recordedAt: time, timestamp: Date.parse(time),
                }],
            });
            const present = await markerFiles(dir);
            assert.ok(present.length > 0, `seed marker must hit disk before forget, saw ${present.join(',') || 'none'}`);
            return native;
        },
        embeddingFactory: async () => ({}),
        runnerFactory: () => ({}),
    });
    t.after(async () => { await engine.close(); await fs.rm(root, { recursive: true, force: true }); });
    return { engine, root, ownerDir: () => ownerDir, native: () => native };
}

async function assertMarkerAbsent(file) {
    const bytes = await fs.readFile(file);
    assert.equal(bytes.includes(Buffer.from(MARKER)), false, `${path.basename(file)} still contains the forgotten marker (${bytes.length} bytes)`);
}

test('forget removes the marker from vectors.db and vectors.db-wal bytes', async (t) => {
    const api = await loadApi(t);
    const { engine, native, ownerDir } = await engineWithMarker(t, api);
    const result = await engine.invoke('forget', { scope, revision: 0, recordIds: ['rec-marker'] });
    assert.equal(result.status, 'cleared');
    assert.equal(result.removed, 1);
    assert.equal(native().list().some((row) => String(row.content).includes(MARKER)), false);
    assert.equal(native().listSources().some((row) => String(row.message_text || row.messageText || '').includes(MARKER)), false);
    const dir = ownerDir();
    await assertMarkerAbsent(path.join(dir, 'vectors.db'));
    await assertMarkerAbsent(path.join(dir, 'vectors.db-wal'));
});

test('account deletion does not leave the marker in owner sqlite files', async (t) => {
    const api = await loadApi(t);
    const { engine, ownerDir } = await engineWithMarker(t, api);
    const accountScope = { ownerId: '1', instanceId: '1', mode: 'COMPANION', domainId: 'account-rights', profileScopeId: 'account-rights' };
    const result = await engine.invoke('clear-owner', { scope: accountScope, accountDeletion: true });
    assert.equal(result.status, 'cleared');
    assert.equal(result.physicalErasure, true);
    const dir = ownerDir();
    assert.equal(JSON.parse(await fs.readFile(path.join(dir, 'deleted.json'), 'utf8')).status, 'cleared');
    for (const name of ['vectors.db', 'vectors.db-wal']) {
        const file = path.join(dir, name);
        try {
            const bytes = await fs.readFile(file);
            assert.equal(bytes.includes(Buffer.from(MARKER)), false, `${name} still contains the deleted marker`);
        } catch (error) {
            assert.equal(error.code, 'ENOENT', name);
        }
    }
    for (const name of OWNER_DATABASE_FILES) {
        await assert.rejects(fs.lstat(path.join(dir, name)), (error) => error.code === 'ENOENT');
    }
});

test('new cited windows reuse proven L0 fallback timestamps and reject conflicts', async t => {
    const api = await loadApi(t);
    const factory = await createNativeFactory(api);
    const scenarios = [
        { name: 'proven legacy fallback', expected: 'published' },
        { name: 'marked fallback', storedFallback: true, expected: 'published' },
        { name: 'unproven legacy origin', seedOperation: 'unproven-source' },
        { name: 'existing real timestamp', storedFallback: false },
        { name: 'incoming real timestamp', storedFallback: true, incomingFallback: false },
        { name: 'different text', changedText: true },
        { name: 'different scope', changedScope: true },
    ];
    for (const scenario of scenarios) await t.test(scenario.name, async t => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-source-window-'));
        let native;
        const old = 'source-41-1-1', current = 'source-42-1-1';
        const scopeKey = '7:COMPANION:daily-7:main';
        const oldScope = scenario.changedScope ? { ...scope, domainId: 'other-domain' } : scope;
        const engine = createControlledEngine({
            dataRoot: root,
            nativeFactory: async dir => {
                native = await factory(dir);
                native.configureSpace('space-8', 8);
                const filter = mapScope(oldScope);
                native.commitPrepared({
                    operationId: scenario.seedOperation ?? 'job-41-r0-a1',
                    scopeKey: scenario.changedScope ? '7:COMPANION:other-domain:main' : scopeKey,
                    revision: 0, spaceId: 'space-8', filter, targets: [], records: [],
                    l0Records: [{ id: old, role: 'user', messageText: '我周三去游泳。', ...filter,
                        recordedAt: time, timestamp: Date.parse(time), timestampFallback: scenario.storedFallback }],
                });
                return { ...native, async prepare() {
                    return { targets: [], records: [{ id: 'fact-new', content: '用户确认每周三游泳。',
                        type: 'episodic', priority: 50, scene_name: 'synthetic', version: 1,
                        source_message_ids: [old, current], timestamps: [time], createdAt: time, updatedAt: time }] };
                } };
            },
            embeddingFactory: async () => ({ embedBatch: async records => records.map(embedding) }),
            runnerFactory: () => ({}),
        });
        t.after(async () => { await engine.close(); await fs.rm(root, { recursive: true, force: true }); });
        const input = { scope, revision: 0, operationId: 'job-42-r0-a1', primarySourceId: current, allowedRecordIds: [],
            embedding: { spaceId: 'space-8', dimensions: 8, revision: 1, state: 'ENABLED' },
            messages: [{ id: old, role: 'user', content: scenario.changedText ? '我周四去游泳。' : '我周三去游泳。',
                timestamp: '2026-10-28T00:00:00Z', timestampFallback: scenario.incomingFallback ?? true },
            { id: current, role: 'user', content: '对，每周三都去。', timestamp: '2026-10-29T12:00:00Z', timestampFallback: false }] };
        const proposed = await engine.invoke('propose', input);
        assert.deepEqual(proposed.records[0].source_message_ids, [old, current]);
        if (scenario.expected) {
            assert.equal((await engine.invoke('commit', input)).status, scenario.expected);
            assert.equal((await engine.invoke('commit', input)).status, scenario.expected);
            assert.equal(native.list().length, 1);
        } else {
            await assert.rejects(engine.invoke('commit', input), /SOURCE_CONFLICT/);
            assert.equal(native.list().length, 0);
            assert.equal(native.listSources().length, 1);
        }
        assert.equal(native.listSources().find(row => row.record_id === old).timestamp, Date.parse(time));
    });
});
