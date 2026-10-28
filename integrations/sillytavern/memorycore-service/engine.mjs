import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { prepareDataRoot } from './storage.mjs';

// This import exists only in the assembled copy. Offline HTTP tests inject a
// fake engine and never depend on an upstream checkout or npm packages.
export async function openFoundationEngine(dataRoot) {
    prepareDataRoot(dataRoot);
    const { LocalStorageBackend } = await import('./upstream/local-backend.js');
    const storage = new LocalStorageBackend({ rootDir: dataRoot });
    const key = `.health-${randomUUID()}`;
    try {
        await storage.putObject(key, 'vc-memorycore-foundation');
        const value = await storage.getObject(key);
        if (value?.content.toString() !== 'vc-memorycore-foundation') throw new Error('MEMORYCORE_STORAGE_PROBE_FAILED');
        if (((await fs.stat(path.join(dataRoot, key))).mode & 0o777) !== 0o600) throw new Error('MEMORYCORE_FILE_PERMISSIONS');
    } finally { await storage.deleteObject(key); }
    return {
        async ready() {
            for (const dir of [dataRoot, path.join(dataRoot, 'owners')]) {
                const st = await fs.lstat(dir);
                if (!st.isDirectory() || st.isSymbolicLink() || (st.mode & 0o777) !== 0o700) return false;
                await fs.access(dir, fs.constants.R_OK | fs.constants.W_OK);
            }
            return true;
        },
    };
}
