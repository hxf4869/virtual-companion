import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createChatStorageGate } from '../server-plugin/virtual-companion/lib/chat-storage-gate.js';

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-chat-gate-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const config = { accountHandles: { 101: 'ownerA', 202: 'ownerB' }, getUserDirectories: (handle) => ({ root: path.join(root, handle) }) };
    const marker = path.join(root, 'ownerA/.vc-f2/chat-cutover.json');
    return { root, config, marker, gate: createChatStorageGate(config) };
}
const freeze = () => ({ runId: randomUUID(), epoch: '9007199254740993123456789' });

test('close synchronously stops admission; only handler release drains; cancelled wait never opens the gate', async (t) => {
    const { gate } = await fixture(t);
    const release = gate.enter('101');
    assert.equal(gate.status('101').active, 1);
    const closing = gate.closeAdmission('101', freeze());
    assert.equal(gate.status('101').closed, true);
    assert.equal(gate.enter('101'), null);
    await assert.rejects(gate.waitForIdle('101'), { code: 'ST_CHAT_GATE_NOT_DURABLE' });
    await closing;
    const abort = new AbortController();
    const cancelled = gate.waitForIdle('101', { signal: abort.signal });
    abort.abort(new Error('synthetic-cancel'));
    await assert.rejects(cancelled, /synthetic-cancel/);
    assert.equal(gate.status('101').active, 1);
    assert.equal(gate.enter('101'), null);
    let drained = false;
    const idle = gate.waitForIdle('101').then((state) => { drained = true; return state; });
    await Promise.resolve();
    assert.equal(drained, false);
    const releaseB = gate.enter('202');
    assert.equal(typeof releaseB, 'function');
    releaseB();
    release();
    release();
    assert.equal((await idle).active, 0);
});

test('durable record is body-free and private, restores frozen after restart, and rejects conflicting run/epoch', async (t) => {
    const { gate, config, marker } = await fixture(t);
    const identity = freeze();
    await gate.closeAdmission('101', identity);
    assert.deepEqual(await gate.closeAdmission('101', identity), { closed: true, durable: true, active: 0, ...identity });
    assert.equal((await fs.stat(path.dirname(marker))).mode & 0o777, 0o700);
    assert.equal((await fs.stat(marker)).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(await fs.readFile(marker, 'utf8')), { version: 1, ownerAccountId: '101', closed: true, ...identity });
    const restarted = createChatStorageGate(config);
    assert.equal(restarted.enter('101'), null);
    assert.deepEqual(await restarted.waitForIdle('101'), { closed: true, durable: true, active: 0, ...identity });
    for (const other of [{ ...identity, runId: randomUUID() }, { ...identity, epoch: '2' }]) {
        await assert.rejects(restarted.closeAdmission('101', other), { code: 'CHAT_CUTOVER_CONFLICT' });
    }
    assert.equal(restarted.enter('101'), null);
    assert.deepEqual(JSON.parse(await fs.readFile(marker, 'utf8')).runId, identity.runId);
});

test('damaged, unreadable and interrupted marker state all fail closed and cannot be silently overwritten', async (t) => {
    for (const type of ['json', 'shape', 'directory', 'interrupted']) {
        const { config, marker } = await fixture(t);
        await fs.mkdir(path.dirname(marker), { recursive: true });
        if (type === 'directory') await fs.mkdir(marker);
        else if (type === 'interrupted') await fs.writeFile(`${marker}.tmp`, '{}');
        else await fs.writeFile(marker, type === 'json' ? '{' : '{}');
        const restored = createChatStorageGate(config);
        assert.equal(restored.enter('101'), null, type);
        assert.equal(restored.status('101').durable, false, type);
        await assert.rejects(restored.waitForIdle('101'), { code: 'ST_CHAT_GATE_STATE_UNAVAILABLE' });
        await assert.rejects(restored.closeAdmission('101', freeze()), { code: 'ST_CHAT_GATE_STATE_UNAVAILABLE' });
        assert.equal(typeof restored.enter('202'), 'function');
    }
});

test('persistence failure keeps admission closed and cannot report drained', async (t) => {
    const { gate, root } = await fixture(t);
    await fs.mkdir(path.join(root, 'ownerA'), { recursive: true });
    await fs.writeFile(path.join(root, 'ownerA/.vc-f2'), 'blocked');
    await assert.rejects(gate.closeAdmission('101', freeze()), { code: 'ST_CHAT_GATE_STATE_UNAVAILABLE' });
    assert.equal(gate.enter('101'), null);
    await assert.rejects(gate.waitForIdle('101'), { code: 'ST_CHAT_GATE_NOT_DURABLE' });
});

test('startup rejects dangling and live marker symlinks and symlink state directories', async (t) => {
    for (const type of ['dangling-marker', 'live-marker', 'state-directory']) {
        const { config, marker, root } = await fixture(t);
        const outside = path.join(root, 'outside');
        await fs.mkdir(outside, { mode: 0o755 });
        await fs.mkdir(path.dirname(path.dirname(marker)), { recursive: true });
        if (type === 'state-directory') {
            await fs.symlink(outside, path.dirname(marker));
        } else {
            await fs.mkdir(path.dirname(marker));
            const target = path.join(outside, 'marker.json');
            if (type === 'live-marker') await fs.writeFile(target, JSON.stringify({ version: 1, ownerAccountId: '101', closed: true, ...freeze() }));
            await fs.symlink(target, marker);
        }
        const restored = createChatStorageGate(config);
        assert.equal(restored.enter('101'), null, type);
        assert.equal(restored.status('101').durable, false, type);
        await assert.rejects(restored.closeAdmission('101', freeze()), { code: 'ST_CHAT_GATE_STATE_UNAVAILABLE' });
        assert.equal((await fs.stat(outside)).mode & 0o777, 0o755);
    }
});

test('persist rejects state-directory and marker symlinks introduced after startup without chmod or writes outside the owner root', async (t) => {
    for (const type of ['state-directory', 'marker']) {
        const { gate, marker, root } = await fixture(t);
        const outside = path.join(root, 'outside');
        await fs.mkdir(outside, { mode: 0o755 });
        await fs.mkdir(path.dirname(path.dirname(marker)), { recursive: true });
        if (type === 'state-directory') await fs.symlink(outside, path.dirname(marker));
        else {
            await fs.mkdir(path.dirname(marker));
            await fs.symlink(path.join(outside, 'missing-marker.json'), marker);
        }
        await assert.rejects(gate.closeAdmission('101', freeze()), { code: 'ST_CHAT_GATE_STATE_UNAVAILABLE' });
        assert.equal(gate.enter('101'), null);
        assert.equal((await fs.stat(outside)).mode & 0o777, 0o755);
        assert.deepEqual(await fs.readdir(outside), []);
    }
});
