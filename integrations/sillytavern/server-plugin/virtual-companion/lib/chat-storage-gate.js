// SX-8: local, per-owner admission and handler-lifetime drain. Never queries Go.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const epochPattern = /^[1-9][0-9]*$/;
function failure(code) { return Object.assign(new Error(code), { code }); }
function validRecord(value, ownerAccountId) {
    return value?.version === 1 && value.ownerAccountId === ownerAccountId && value.closed === true
        && typeof value.runId === 'string' && uuidPattern.test(value.runId)
        && typeof value.epoch === 'string' && epochPattern.test(value.epoch);
}
async function persist(file, record) {
    const dir = path.dirname(file);
    // Check the reserved directory and marker themselves, including dangling symlinks.
    for (const [target, type] of [[dir, 'isDirectory'], [file, 'isFile']]) {
        try {
            const info = await fsp.lstat(target);
            if (info.isSymbolicLink() || !info[type]()) throw failure('ST_CHAT_GATE_STATE_UNAVAILABLE');
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
    const directory = await fsp.open(dir, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    try {
        // Apply permissions through the no-follow descriptor rather than chmod(path).
        await directory.chmod(0o700);
        const temp = `${file}.tmp`;
        // One serialized cutover per owner. An interrupted temporary record is fail-closed on startup.
        const handle = await fsp.open(temp, 'wx', 0o600);
        try {
            await handle.writeFile(`${JSON.stringify(record)}\n`, 'utf8');
            await handle.sync();
        } finally { await handle.close(); }
        await fsp.rename(temp, file);
        await directory.sync();
    } finally { await directory.close(); }
}

export function createChatStorageGate({ accountHandles, getUserDirectories }) {
    const states = new Map();
    // Startup only: requests never read the marker or call the directory resolver.
    for (const [ownerAccountId, handle] of Object.entries(accountHandles)) {
        const file = path.join(getUserDirectories(handle).root, '.vc-f2', 'chat-cutover.json');
        const state = { file, closed: false, durable: false, active: 0, runId: null, epoch: null, waiters: new Set(), pending: null, broken: false };
        try {
            let markerPresent = false;
            for (const [target, type] of [[path.dirname(file), 'isDirectory'], [file, 'isFile']]) {
                let info;
                try { info = fs.lstatSync(target); }
                catch (error) { if (error.code !== 'ENOENT') throw error; }
                if (info && (info.isSymbolicLink() || !info[type]())) throw failure('ST_CHAT_GATE_STATE_UNAVAILABLE');
                if (target === file) markerPresent = info !== undefined;
            }
            if (markerPresent) {
                const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
                let record;
                try { record = JSON.parse(fs.readFileSync(descriptor, 'utf8')); }
                finally { fs.closeSync(descriptor); }
                if (!validRecord(record, ownerAccountId)) throw failure('ST_CHAT_GATE_STATE_UNAVAILABLE');
                Object.assign(state, { closed: true, durable: true, runId: record.runId, epoch: record.epoch });
            }
            try { fs.lstatSync(`${file}.tmp`); throw failure('ST_CHAT_GATE_STATE_UNAVAILABLE'); }
            catch (error) { if (error.code !== 'ENOENT') throw error; }
        } catch {
            Object.assign(state, { closed: true, durable: false, broken: true });
        }
        states.set(ownerAccountId, state);
    }
    function stateOf(ownerAccountId) {
        const state = states.get(ownerAccountId);
        if (!state) throw failure('ACCESS_DENIED');
        return state;
    }
    function snapshot(state) {
        return { closed: state.closed, durable: state.durable, active: state.active, runId: state.runId, epoch: state.epoch };
    }
    function notify(state) {
        if (state.closed && state.durable && state.active === 0) {
            for (const done of [...state.waiters]) done();
        }
    }
    return {
        status(ownerAccountId) { return snapshot(stateOf(ownerAccountId)); },
        enter(ownerAccountId) {
            const state = stateOf(ownerAccountId);
            if (state.closed) return null;
            state.active += 1;
            let released = false;
            return () => {
                if (released) return;
                released = true;
                state.active -= 1;
                notify(state);
            };
        },
        async closeAdmission(ownerAccountId, { runId, epoch }) {
            const state = stateOf(ownerAccountId);
            if (typeof runId !== 'string' || !uuidPattern.test(runId) || typeof epoch !== 'string' || !epochPattern.test(epoch)) throw failure('INVALID_REQUEST');
            // Must happen before the first await: delayed Go requests cannot enter while persistence runs.
            state.closed = true;
            if (state.broken) throw failure('ST_CHAT_GATE_STATE_UNAVAILABLE');
            if (state.runId && (state.runId !== runId || state.epoch !== epoch)) throw failure('CHAT_CUTOVER_CONFLICT');
            if (!state.pending && !state.durable) {
                Object.assign(state, { runId, epoch });
                state.pending = persist(state.file, { version: 1, ownerAccountId, closed: true, runId, epoch });
            }
            if (state.pending) {
                try { await state.pending; }
                catch { state.broken = true; throw failure('ST_CHAT_GATE_STATE_UNAVAILABLE'); }
                state.durable = true;
                state.pending = null;
            }
            notify(state);
            return snapshot(state);
        },
        async waitForIdle(ownerAccountId, { signal } = {}) {
            const state = stateOf(ownerAccountId);
            if (!state.closed) throw failure('ST_CHAT_GATE_OPEN');
            if (signal?.aborted) throw signal.reason ?? failure('ABORT_ERR');
            if (state.pending) {
                // The controller awaits closeAdmission before drain; reject a premature drain check.
                throw failure('ST_CHAT_GATE_NOT_DURABLE');
            }
            if (!state.durable) throw failure('ST_CHAT_GATE_STATE_UNAVAILABLE');
            if (state.active === 0) return snapshot(state);
            return new Promise((resolve, reject) => {
                const finish = () => { cleanup(); resolve(snapshot(state)); };
                const abort = () => { cleanup(); reject(signal.reason ?? failure('ABORT_ERR')); };
                const cleanup = () => { state.waiters.delete(finish); signal?.removeEventListener('abort', abort); };
                state.waiters.add(finish);
                signal?.addEventListener('abort', abort, { once: true });
            });
        },
    };
}
