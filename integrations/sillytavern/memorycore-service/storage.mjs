import fs from 'node:fs';
import path from 'node:path';

export function privateDirectory(dir) {
    if (fs.existsSync(dir) && (!fs.lstatSync(dir).isDirectory() || fs.lstatSync(dir).isSymbolicLink())) {
        throw new Error('MEMORYCORE_UNSAFE_DIRECTORY');
    }
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(dir, 0o700);
    return dir;
}

export function prepareDataRoot(dataRoot) {
    privateDirectory(dataRoot);
    privateDirectory(path.join(dataRoot, 'owners'));
}

// Owner paths are derived from trusted positive decimal IDs, never request paths.
export function ownerDirectory(dataRoot, owner) {
    if (!/^[1-9][0-9]*$/.test(String(owner))) throw new Error('MEMORYCORE_INVALID_OWNER');
    prepareDataRoot(dataRoot);
    return privateDirectory(path.join(dataRoot, 'owners', String(owner)));
}

// The same exclusive lock is used by the existing offline backup entry point.
// A live service and an all-files/SQLite snapshot can never run concurrently.
export function acquireRuntimeLock(dataRoot) {
    prepareDataRoot(dataRoot);
    const file = path.join(dataRoot, 'runtime.lock');
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const fd = fs.openSync(file, 'wx', 0o600);
            fs.writeFileSync(fd, String(process.pid)); fs.closeSync(fd);
            return () => { if (fs.readFileSync(file, 'utf8') === String(process.pid)) fs.unlinkSync(file); };
        } catch (error) {
            if (error.code !== 'EEXIST') throw error;
            const pid = Number(fs.readFileSync(file, 'utf8'));
            if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('MEMORYCORE_RUNTIME_LOCK');
            try { process.kill(pid, 0); }
            catch (e) { if (e.code === 'ESRCH') { fs.unlinkSync(file); continue; } }
            throw new Error('MEMORYCORE_RUNTIME_LOCK');
        }
    }
    throw new Error('MEMORYCORE_RUNTIME_LOCK');
}
