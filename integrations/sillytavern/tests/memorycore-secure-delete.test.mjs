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
